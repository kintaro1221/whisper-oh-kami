const { Ollama } = require('ollama');
const { getSystemPrompt } = require('./prompts');
const { sendToRenderer, initializeNewSession, saveConversationTurn, pushTurnEvent } = require('./gemini');
const { classifyOllamaFailure, classifyWhisperFailure } = require('./errorDiagnostics');
const { createWhisperProgressTracker } = require('./whisperProgress');
const { createGenerationCounter } = require('./sessionGeneration');

// Transcribed text is only logged when WOK_DEBUG=1 (default: lengths only).
const VERBOSE = process.env.WOK_DEBUG === '1';

// Bumped on every local/trial session boundary (initializeLocalSession,
// initializeTrialSession, closeLocalSession). Whisper transcriptions and
// Ollama streams capture a token at start and drop their result if the
// session they started in has ended — see sessionGeneration.js.
const localGeneration = createGenerationCounter();

// ── State ──

let ollamaClient = null;
let ollamaModel = null;
let whisperPipeline = null;
let loadedWhisperModelName = null;
let isWhisperLoading = false;
let localConversationHistory = [];
let currentSystemPrompt = null;
let isLocalActive = false;
let localSessionMode = 'local';
let whisperLanguage = 'en';

// The Promises for every whisperPipeline(...) inference call currently in
// flight (transcribeAudio may be invoked more than once concurrently — VAD's
// processVAD() fires handleSpeechEnd() without awaiting it, so a second
// speech segment can start transcribing before the first one resolves).
// Tracked as a Set (not a single slot) so a model switch waits for ALL of
// them to settle before disposing the old pipeline's ONNX session out from
// under whichever one is still running.
let transcribeInFlightSet = new Set();

// Same-session freshness (v0.7.5): one Ollama chat at a time. A request
// that arrives while a response is streaming is not dropped — the LATEST
// one is kept (overwritten, never queued) and sent once the current call
// finishes. Both are reset on every session boundary.
let ollamaInFlight = false;
let pendingOllamaTranscription = null;

// Indirection around the dynamic `import('@huggingface/transformers')` so
// tests can substitute a mock loader. jest.mock(...) does not intercept a
// native dynamic import() the way it intercepts require() (confirmed: it
// throws "A dynamic import callback was invoked without
// --experimental-vm-modules" even with a virtual mock registered), so this
// explicit DI hook is the only way to unit-test loadWhisperPipeline's
// behavior around @huggingface/transformers without spinning up Electron.
let transformersLoader = () => import('@huggingface/transformers');
function _setTransformersLoaderForTest(loaderFn) {
    transformersLoader = loaderFn || (() => import('@huggingface/transformers'));
}

function sendDiagnostic(diagnostic) {
    sendToRenderer('app-diagnostic', diagnostic);
}

// VAD state
let isSpeaking = false;
let speechBuffers = [];
let silenceFrameCount = 0;
let speechFrameCount = 0;

// VAD configuration
const VAD_MODES = {
    NORMAL: { energyThreshold: 0.01, speechFramesRequired: 3, silenceFramesRequired: 30 },
    LOW_BITRATE: { energyThreshold: 0.008, speechFramesRequired: 4, silenceFramesRequired: 35 },
    AGGRESSIVE: { energyThreshold: 0.015, speechFramesRequired: 2, silenceFramesRequired: 20 },
    VERY_AGGRESSIVE: { energyThreshold: 0.02, speechFramesRequired: 2, silenceFramesRequired: 15 },
};
let vadConfig = VAD_MODES.VERY_AGGRESSIVE;

// Audio resampling buffer
let resampleRemainder = Buffer.alloc(0);

// ── Audio Resampling (24kHz → 16kHz) ──

function resample24kTo16k(inputBuffer) {
    // Combine with any leftover samples from previous call
    const combined = Buffer.concat([resampleRemainder, inputBuffer]);
    const inputSamples = Math.floor(combined.length / 2); // 16-bit = 2 bytes per sample
    // Ratio: 16000/24000 = 2/3, so for every 3 input samples we produce 2 output samples
    const outputSamples = Math.floor((inputSamples * 2) / 3);
    const outputBuffer = Buffer.alloc(outputSamples * 2);

    for (let i = 0; i < outputSamples; i++) {
        // Map output sample index to input position
        const srcPos = (i * 3) / 2;
        const srcIndex = Math.floor(srcPos);
        const frac = srcPos - srcIndex;

        const s0 = combined.readInt16LE(srcIndex * 2);
        const s1 = srcIndex + 1 < inputSamples ? combined.readInt16LE((srcIndex + 1) * 2) : s0;
        const interpolated = Math.round(s0 + frac * (s1 - s0));
        outputBuffer.writeInt16LE(Math.max(-32768, Math.min(32767, interpolated)), i * 2);
    }

    // Store remainder for next call
    const consumedInputSamples = Math.ceil((outputSamples * 3) / 2);
    const remainderStart = consumedInputSamples * 2;
    resampleRemainder = remainderStart < combined.length ? combined.slice(remainderStart) : Buffer.alloc(0);

    return outputBuffer;
}

// ── VAD (Voice Activity Detection) ──

function calculateRMS(pcm16Buffer) {
    const samples = pcm16Buffer.length / 2;
    if (samples === 0) return 0;
    let sumSquares = 0;
    for (let i = 0; i < samples; i++) {
        const sample = pcm16Buffer.readInt16LE(i * 2) / 32768;
        sumSquares += sample * sample;
    }
    return Math.sqrt(sumSquares / samples);
}

function processVAD(pcm16kBuffer) {
    const rms = calculateRMS(pcm16kBuffer);
    const isVoice = rms > vadConfig.energyThreshold;

    if (isVoice) {
        speechFrameCount++;
        silenceFrameCount = 0;

        if (!isSpeaking && speechFrameCount >= vadConfig.speechFramesRequired) {
            isSpeaking = true;
            speechBuffers = [];
            console.log('[LocalAI] Speech started (RMS:', rms.toFixed(4), ')');
            sendToRenderer('update-status', 'Listening... (speech detected)');
        }
    } else {
        silenceFrameCount++;
        speechFrameCount = 0;

        if (isSpeaking && silenceFrameCount >= vadConfig.silenceFramesRequired) {
            isSpeaking = false;
            console.log('[LocalAI] Speech ended, accumulated', speechBuffers.length, 'chunks');
            sendToRenderer('update-status', 'Transcribing...');

            // Trigger transcription with accumulated audio
            const audioData = Buffer.concat(speechBuffers);
            speechBuffers = [];
            handleSpeechEnd(audioData);
            return;
        }
    }

    // Accumulate audio during speech
    if (isSpeaking) {
        speechBuffers.push(Buffer.from(pcm16kBuffer));
    }
}

// ── Whisper Transcription ──

// Models shipped inside the installer (see scripts/fetch-whisper-models.mjs /
// scripts/whisper-models.manifest.json). Keep this list in sync with
// BUNDLED_MODEL_REPOS there. onnx-community/kotoba-whisper-v2.2-ONNX is
// deliberately absent — it is opt-in and always fetched remotely.
const BUNDLED_WHISPER_MODEL_REPOS = ['Xenova/whisper-tiny', 'Xenova/whisper-small'];

// Root directory holding the bundled model files, matching the layout
// @huggingface/transformers' env.localModelPath resolution expects
// (localModelPath + "/" + <org>/<model> + "/" + <file>).
function getBundledWhisperModelsRoot() {
    const { app } = require('electron');
    const path = require('path');
    if (app.isPackaged) {
        return path.join(process.resourcesPath, 'whisper-models');
    }
    // Dev mode: src/utils/localai.js -> repo root -> resources/whisper-models
    return path.join(__dirname, '..', '..', 'resources', 'whisper-models');
}

// Cheap existence check (not a full hash verification — that's
// `npm run whisper-models:check`'s job, run at build/package time). Used
// only to decide whether to show a "downloading" state before the pipeline
// load starts.
//
// Indirection through a module-level function reference (default:
// realIsBundledModelAvailableLocally, backed by fs.existsSync against the
// actual resources/whisper-models/ on disk) so tests can inject a fake
// check via _setBundledModelCheckForTest. Without this, a test asserting
// "bundled model NOT available -> useFSCache=true / whisper-downloading
// sent" only passes on a checkout where resources/whisper-models/ has not
// been fetched, and a test asserting the opposite only passes once it has —
// both are then at the mercy of the local dev/CI machine's fetch state
// rather than being deterministic.
function realIsBundledModelAvailableLocally(modelName) {
    if (!BUNDLED_WHISPER_MODEL_REPOS.includes(modelName)) return false;
    const fs = require('fs');
    const path = require('path');
    return fs.existsSync(path.join(getBundledWhisperModelsRoot(), modelName, 'config.json'));
}

let bundledModelCheck = realIsBundledModelAvailableLocally;
function _setBundledModelCheckForTest(checkFn) {
    bundledModelCheck = checkFn || realIsBundledModelAvailableLocally;
}

function isBundledModelAvailableLocally(modelName) {
    return bundledModelCheck(modelName);
}

// Waits for any in-flight transcription, then releases `oldPipeline`'s
// underlying ONNX session (Pipeline.dispose() -> model.dispose() ->
// session.release(), see
// node_modules/@huggingface/transformers/src/pipelines/_base.js). Disposal
// failure is caught and logged, not rethrown — a stale pipeline's dispose()
// throwing must never block loading the newly requested model.
async function disposeWhisperPipeline(oldPipeline, oldModelName) {
    if (!oldPipeline) return;

    if (transcribeInFlightSet.size > 0) {
        // Promise.allSettled (not Promise.all) so a rejected in-flight
        // transcription never blocks disposing the old pipeline —
        // transcribeAudio logs its own errors already. Snapshot the set into
        // an array first: it is a live module-level Set that new concurrent
        // transcriptions may still be added to/removed from while we await.
        await Promise.allSettled([...transcribeInFlightSet]);
    }

    if (typeof oldPipeline.dispose === 'function') {
        try {
            await oldPipeline.dispose();
            console.log('[LocalAI] Disposed previous Whisper pipeline:', oldModelName);
        } catch (error) {
            console.error('[LocalAI] Failed to dispose previous Whisper pipeline:', oldModelName, error);
        }
    }
}

async function loadWhisperPipeline(modelName) {
    if (whisperPipeline && loadedWhisperModelName === modelName) return whisperPipeline;
    if (isWhisperLoading) return null;
    isWhisperLoading = true;

    // A different model was requested than the one currently loaded — dispose
    // the stale pipeline's ONNX session (waiting for any in-flight
    // transcription first) before loading the new model, then throw away the
    // reference so the new model actually takes effect. Previously
    // `whisperPipeline` was cached forever regardless of `modelName`,
    // silently ignoring model switches; and even after that was fixed, the
    // old pipeline's ONNX runtime session was never released, leaking memory
    // on every switch.
    if (whisperPipeline && loadedWhisperModelName !== modelName) {
        const stalePipeline = whisperPipeline;
        const staleModelName = loadedWhisperModelName;
        whisperPipeline = null;
        loadedWhisperModelName = null;
        await disposeWhisperPipeline(stalePipeline, staleModelName);
    }

    console.log('[LocalAI] Loading Whisper model:', modelName);
    const progressTracker = createWhisperProgressTracker();
    const bundled = isBundledModelAvailableLocally(modelName);

    if (bundled) {
        // Shipped with the installer — no download expected. Report 100%
        // immediately instead of raising 'whisper-downloading' so the UI
        // never shows a misleading "downloading" state for a model that's
        // already on disk.
        sendToRenderer('whisper-download-progress', { ...progressTracker.snapshot(), percent: 100 });
        sendToRenderer('update-status', 'Loading Whisper model...');
    } else {
        sendToRenderer('whisper-downloading', true);
        sendToRenderer('whisper-download-progress', progressTracker.snapshot());
        sendToRenderer('update-status', 'Loading Whisper model (first time may take a while)...');
    }

    try {
        // Dynamic import for ESM module (overridable in tests — see
        // _setTransformersLoaderForTest above).
        const { pipeline, env } = await transformersLoader();
        // Cache remote (non-bundled) downloads outside the asar archive so
        // ONNX runtime can load them.
        const { app } = require('electron');
        const path = require('path');
        env.cacheDir = path.join(app.getPath('userData'), 'whisper-models');
        // Bundled models (tiny/small) resolve from resources/whisper-models
        // before any network access is attempted. allowRemoteModels stays
        // true so non-bundled models (e.g. kotoba) still fall through to a
        // remote download.
        env.allowLocalModels = true;
        env.localModelPath = getBundledWhisperModelsRoot();
        // transformers.js's hub.js resolution order is: when
        // env.useFSCache is true, check env.cacheDir FIRST and only fall
        // back to env.localModelPath on a cache miss. For a bundled model
        // (tiny/small), that means a pre-existing (possibly stale or
        // corrupt) cacheDir entry from an older release — or from the user
        // having previously used this model as a remote download before it
        // became bundled — would silently shadow the verified, same-version
        // model files we ship in resources/whisper-models/. Disabling the
        // filesystem cache for bundled models forces resolution straight to
        // localModelPath, which is exactly what "bundled" is supposed to
        // guarantee. Non-bundled models (kotoba) keep useFSCache enabled so
        // a remote download is actually cached across sessions instead of
        // being re-fetched every load. env is a module-global from
        // @huggingface/transformers, but loadWhisperPipeline calls are
        // serialized by the isWhisperLoading guard above, so setting it here
        // right before pipeline() is safe.
        env.useFSCache = !bundled;
        whisperPipeline = await pipeline('automatic-speech-recognition', modelName, {
            dtype: 'q8',
            device: 'cpu',
            // Surface real download progress so a first-run remote download
            // does not look like a hang (audit A3). Aggregated across all
            // model files. No-ops for a bundled model (nothing to download).
            progress_callback: data => {
                const snap = progressTracker.update(data);
                sendToRenderer('whisper-download-progress', snap);
            },
        });
        loadedWhisperModelName = modelName;
        console.log('[LocalAI] Whisper model loaded successfully');
        sendToRenderer('whisper-download-progress', { ...progressTracker.snapshot(), percent: 100 });
        sendToRenderer('whisper-downloading', false);
        isWhisperLoading = false;
        return whisperPipeline;
    } catch (error) {
        console.error('[LocalAI] Failed to load Whisper model:', error);
        sendToRenderer('whisper-downloading', false);
        sendToRenderer('whisper-download-error', { message: error.message });
        sendToRenderer('update-status', 'Failed to load Whisper model: ' + error.message);
        sendDiagnostic(classifyWhisperFailure(error));
        loadedWhisperModelName = null;
        isWhisperLoading = false;
        return null;
    }
}

function pcm16ToFloat32(pcm16Buffer) {
    const samples = pcm16Buffer.length / 2;
    const float32 = new Float32Array(samples);
    for (let i = 0; i < samples; i++) {
        float32[i] = pcm16Buffer.readInt16LE(i * 2) / 32768;
    }
    return float32;
}

async function transcribeAudio(pcm16kBuffer) {
    if (!whisperPipeline) {
        console.error('[LocalAI] Whisper pipeline not loaded');
        return null;
    }

    // Tracked in transcribeInFlightSet so a concurrent model switch
    // (loadWhisperPipeline -> disposeWhisperPipeline) waits for every
    // in-progress inference — not just the most recent one — to finish
    // before releasing the pipeline they are running on. VAD fires
    // handleSpeechEnd() without awaiting it (see processVAD), so a second
    // speech segment's transcription can start before the first one has
    // resolved.
    let inferencePromise;
    try {
        const float32Audio = pcm16ToFloat32(pcm16kBuffer);

        // Whisper expects audio at 16kHz which is what we have
        inferencePromise = whisperPipeline(float32Audio, {
            sampling_rate: 16000,
            language: whisperLanguage,
            task: 'transcribe',
        });
        transcribeInFlightSet.add(inferencePromise);
        const result = await inferencePromise;

        const text = result.text?.trim();
        if (VERBOSE) console.log('[LocalAI] Transcription:', text);
        else console.log('[LocalAI] Transcription', { chars: text ? text.length : 0 });
        return text;
    } catch (error) {
        console.error('[LocalAI] Transcription error:', error);
        return null;
    } finally {
        transcribeInFlightSet.delete(inferencePromise);
    }
}

// Indirection so tests can substitute a controllable transcription (via the
// test-only __setTranscribeForTest hook). Production always uses
// transcribeAudio.
let transcribeAudioImpl = transcribeAudio;

// ── Speech End Handler ──

async function handleSpeechEnd(audioData) {
    if (!isLocalActive) return;
    const token = localGeneration.capture();

    // Minimum audio length check (~0.5 seconds at 16kHz, 16-bit)
    if (audioData.length < 16000) {
        console.log('[LocalAI] Audio too short, skipping');
        sendToRenderer('update-status', 'Listening...');
        return;
    }

    const transcription = await transcribeAudioImpl(audioData);
    if (token.isStale() || !isLocalActive) {
        console.log('[LocalAI] transcription finished after session close; dropped');
        return;
    }

    if (!transcription || transcription.trim() === '' || transcription.trim().length < 2) {
        console.log('[LocalAI] Empty transcription, skipping');
        sendToRenderer('update-status', 'Listening...');
        return;
    }

    if (localSessionMode === 'trial') {
        // Trial has only the user's microphone, but the demo goal is to prove
        // the 5-element bar reacts. Treat this single stream as evidence input
        // while keeping providerMode='trial' so LLM refinement remains gated off.
        pushTurnEvent({ speaker: 'opponent', text: transcription, source: 'trial_self_whisper' });
        sendToRenderer('update-status', 'Trial listening...');
        return;
    }

    sendToRenderer('update-status', 'Generating response...');
    await sendToOllama(transcription);
}

function resetAudioState() {
    isSpeaking = false;
    speechBuffers = [];
    silenceFrameCount = 0;
    speechFrameCount = 0;
    resampleRemainder = Buffer.alloc(0);
}

// ── Ollama Chat ──

async function sendToOllama(transcription) {
    if (!ollamaClient || !ollamaModel) {
        console.error('[LocalAI] Ollama not configured');
        return;
    }
    if (ollamaInFlight) {
        pendingOllamaTranscription = transcription;
        console.log('[LocalAI] response still in flight; keeping the latest request for one follow-up');
        return;
    }
    ollamaInFlight = true;
    const token = localGeneration.capture();

    if (VERBOSE) console.log('[LocalAI] Sending to Ollama:', transcription.substring(0, 100) + '...');
    else console.log('[LocalAI] Sending to Ollama', { chars: transcription.length });

    localConversationHistory.push({
        role: 'user',
        content: transcription.trim(),
    });

    // Keep history manageable
    if (localConversationHistory.length > 20) {
        localConversationHistory = localConversationHistory.slice(-20);
    }

    try {
        const messages = [{ role: 'system', content: currentSystemPrompt || 'You are a helpful assistant.' }, ...localConversationHistory];

        const response = await ollamaClient.chat({
            model: ollamaModel,
            messages,
            stream: true,
        });

        let fullText = '';
        let isFirst = true;

        for await (const part of response) {
            if (token.isStale()) break;
            const delta = part.message?.content || '';
            if (delta) {
                fullText += delta;
                sendToRenderer(isFirst ? 'new-response' : 'update-response', fullText);
                isFirst = false;
            }
        }

        if (token.isStale()) {
            console.log('[LocalAI] stale Ollama stream dropped');
            return;
        }

        if (fullText.trim()) {
            localConversationHistory.push({
                role: 'assistant',
                content: fullText.trim(),
            });

            saveConversationTurn(transcription, fullText, token);
        }

        console.log('[LocalAI] Ollama response completed');
        sendToRenderer('update-status', 'Listening...');
    } catch (error) {
        console.error('[LocalAI] Ollama error:', error);
        if (!token.isStale()) sendToRenderer('update-status', 'Ollama error: ' + error.message);
    } finally {
        // A stale call must not release a newer session's call nor send a
        // request deferred in it.
        if (!token.isStale()) {
            ollamaInFlight = false;
            if (pendingOllamaTranscription != null) {
                const next = pendingOllamaTranscription;
                pendingOllamaTranscription = null;
                sendToOllama(next);
            }
        }
    }
}

function resetOllamaInFlight() {
    ollamaInFlight = false;
    pendingOllamaTranscription = null;
}

// ── Public API ──

async function initializeLocalSession(ollamaHost, model, whisperModel, profile, customPrompt) {
    localGeneration.bump();
    resetOllamaInFlight();
    console.log('[LocalAI] Initializing local session:', { ollamaHost, model, whisperModel, profile });

    sendToRenderer('session-initializing', true);
    localSessionMode = 'local';
    // JP fork: Ollama local mode transcribes Japanese 商談 audio, same as trial.
    whisperLanguage = 'ja';

    try {
        // Setup system prompt
        currentSystemPrompt = getSystemPrompt(profile, customPrompt, false);

        // Initialize Ollama client
        ollamaClient = new Ollama({ host: ollamaHost });
        ollamaModel = model;

        // Test Ollama connection
        try {
            await ollamaClient.list();
            console.log('[LocalAI] Ollama connection verified');
        } catch (error) {
            console.error('[LocalAI] Cannot connect to Ollama at', ollamaHost, ':', error.message);
            sendToRenderer('session-initializing', false);
            sendToRenderer('update-status', 'Cannot connect to Ollama at ' + ollamaHost);
            sendDiagnostic(classifyOllamaFailure(error));
            return false;
        }

        // Load Whisper model
        const pipeline = await loadWhisperPipeline(whisperModel);
        if (!pipeline) {
            sendToRenderer('session-initializing', false);
            return false;
        }

        // Reset VAD state
        resetAudioState();
        localConversationHistory = [];

        // Initialize conversation session
        initializeNewSession(profile, customPrompt);

        isLocalActive = true;
        sendToRenderer('session-initializing', false);
        sendToRenderer('update-status', 'Local AI ready - Listening...');

        console.log('[LocalAI] Session initialized successfully');
        return true;
    } catch (error) {
        console.error('[LocalAI] Initialization error:', error);
        sendToRenderer('session-initializing', false);
        sendToRenderer('update-status', 'Local AI error: ' + error.message);
        sendDiagnostic(classifyOllamaFailure(error));
        return false;
    }
}

async function initializeTrialSession(whisperModel, profile, customPrompt = '') {
    localGeneration.bump();
    resetOllamaInFlight();
    console.log('[LocalAI] Initializing trial session:', { whisperModel, profile });

    sendToRenderer('session-initializing', true);
    localSessionMode = 'trial';
    whisperLanguage = 'ja';
    ollamaClient = null;
    ollamaModel = null;

    try {
        currentSystemPrompt = getSystemPrompt(profile, customPrompt, false);
        const pipeline = await loadWhisperPipeline(whisperModel);
        if (!pipeline) {
            sendToRenderer('session-initializing', false);
            return false;
        }

        resetAudioState();
        localConversationHistory = [];
        initializeNewSession(profile, customPrompt);

        isLocalActive = true;
        sendToRenderer('session-initializing', false);
        sendToRenderer('update-status', 'Trial ready - microphone only');
        console.log('[LocalAI] Trial session initialized successfully');
        return true;
    } catch (error) {
        console.error('[LocalAI] Trial initialization error:', error);
        sendToRenderer('session-initializing', false);
        sendToRenderer('update-status', 'Trial error: ' + error.message);
        sendDiagnostic(classifyWhisperFailure(error));
        return false;
    }
}

function processLocalAudio(monoChunk24k) {
    if (!isLocalActive) return;

    // Resample from 24kHz to 16kHz
    const pcm16k = resample24kTo16k(monoChunk24k);
    if (pcm16k.length > 0) {
        processVAD(pcm16k);
    }
}

function closeLocalSession() {
    console.log('[LocalAI] Closing local session');
    localGeneration.bump();
    resetOllamaInFlight();
    isLocalActive = false;
    isSpeaking = false;
    speechBuffers = [];
    silenceFrameCount = 0;
    speechFrameCount = 0;
    resampleRemainder = Buffer.alloc(0);
    localConversationHistory = [];
    ollamaClient = null;
    ollamaModel = null;
    currentSystemPrompt = null;
    localSessionMode = 'local';
    whisperLanguage = 'en';
    // Note: whisperPipeline is kept loaded to avoid reloading on next session
}

function isLocalSessionActive() {
    return isLocalActive;
}

// ── Send text directly to Ollama (for manual text input) ──

async function sendLocalText(text) {
    if (!isLocalActive || !ollamaClient) {
        return { success: false, error: 'No active local session' };
    }

    try {
        await sendToOllama(text);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

async function sendLocalImage(base64Data, prompt) {
    if (!isLocalActive || !ollamaClient) {
        return { success: false, error: 'No active local session' };
    }
    const token = localGeneration.capture();

    try {
        console.log('[LocalAI] Sending image to Ollama');
        sendToRenderer('update-status', 'Analyzing image...');

        const userMessage = {
            role: 'user',
            content: prompt,
            images: [base64Data],
        };

        // Store text-only version in history
        localConversationHistory.push({ role: 'user', content: prompt });

        if (localConversationHistory.length > 20) {
            localConversationHistory = localConversationHistory.slice(-20);
        }

        const messages = [
            { role: 'system', content: currentSystemPrompt || 'You are a helpful assistant.' },
            ...localConversationHistory.slice(0, -1),
            userMessage,
        ];

        const response = await ollamaClient.chat({
            model: ollamaModel,
            messages,
            stream: true,
        });

        let fullText = '';
        let isFirst = true;

        for await (const part of response) {
            if (token.isStale()) break;
            const delta = part.message?.content || '';
            if (delta) {
                fullText += delta;
                sendToRenderer(isFirst ? 'new-response' : 'update-response', fullText);
                isFirst = false;
            }
        }

        if (token.isStale()) {
            console.log('[LocalAI] stale image response dropped');
            return { success: false, error: 'session_closed' };
        }

        if (fullText.trim()) {
            localConversationHistory.push({ role: 'assistant', content: fullText.trim() });
            saveConversationTurn(prompt, fullText, token);
        }

        console.log('[LocalAI] Image response completed');
        sendToRenderer('update-status', 'Listening...');
        return { success: true, text: fullText, model: ollamaModel };
    } catch (error) {
        console.error('[LocalAI] Image error:', error);
        if (!token.isStale()) sendToRenderer('update-status', 'Ollama error: ' + error.message);
        return { success: false, error: error.message };
    }
}

module.exports = {
    initializeLocalSession,
    initializeTrialSession,
    processLocalAudio,
    closeLocalSession,
    isLocalSessionActive,
    sendLocalText,
    sendLocalImage,
    // Test-only DI hooks (see the comments above their definitions). Not
    // used by any production code path.
    _setTransformersLoaderForTest,
    _setBundledModelCheckForTest,
    // Test-only export: transcribeAudio() is otherwise unreachable from
    // outside this module (handleSpeechEnd, its only caller, is itself
    // private, fired by VAD without being awaited). Exposed purely so tests
    // can start concurrent in-flight transcriptions to exercise
    // transcribeInFlightSet / disposeWhisperPipeline's wait-for-all-inflight
    // behavior. Not used by any production code path.
    _transcribeAudioForTest: transcribeAudio,
    // Test-only hooks for the session-generation guard
    // (tests/unit/localaiSessionGuard.test.js): swap the transcription
    // implementation, force the active/mode state without loading Whisper,
    // and drive the otherwise-private VAD speech-end handler directly. Not
    // used by any production code path.
    __setTranscribeForTest: fn => {
        transcribeAudioImpl = fn;
    },
    __setActiveForTest: (active, mode) => {
        isLocalActive = active;
        localSessionMode = mode;
    },
    __handleSpeechEndForTest: handleSpeechEnd,
    // Test-only: inject an Ollama client without a live Ollama server
    // (tests/unit/localaiSessionGuard.test.js).
    __setOllamaForTest: (client, model) => {
        ollamaClient = client;
        ollamaModel = model;
    },
};
