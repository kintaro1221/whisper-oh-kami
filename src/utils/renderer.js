// renderer.js
// Install global t() helper used by all Lit components.
// NOTE: this file is loaded via <script src="utils/renderer.js"> in index.html,
// so Electron resolves require() relative to index.html's directory (src/),
// NOT relative to this file's directory. Use './i18n' (from src/), not '../i18n'.
require('./i18n');
require('./utils/keyFormat'); // installs window.WhisperKeyFormat for components

const { ipcRenderer } = require('electron');
const { buildCustomPromptFromContext, normalizeContextProfile } = require('./utils/contextPrompt');
const { createDiagnostic, classifyByokKey, classifyGeminiInitFailure, classifyAudioHelperFailure } = require('./utils/errorDiagnostics');
const { recordDiagnosticCode, getRecentDiagnosticCodes } = require('./utils/supportExport');

let mediaStream = null;
let screenshotInterval = null;
let audioContext = null;
let audioProcessor = null;
let micAudioContext = null;
let micAudioProcessor = null;
let audioBuffer = [];
const SAMPLE_RATE = 24000;
const AUDIO_CHUNK_DURATION = 0.1; // seconds
const BUFFER_SIZE = 4096; // Increased buffer size for smoother audio

let hiddenVideo = null;
let offscreenCanvas = null;
let offscreenContext = null;
let currentImageQuality = 'medium'; // Store current image quality for manual screenshots

const isLinux = process.platform === 'linux';
const isMacOS = process.platform === 'darwin';

// ============ STORAGE API ============
// Wrapper for IPC-based storage access
const storage = {
    // Config
    async getConfig() {
        const result = await ipcRenderer.invoke('storage:get-config');
        return result.success ? result.data : {};
    },
    async setConfig(config) {
        return ipcRenderer.invoke('storage:set-config', config);
    },
    async updateConfig(key, value) {
        return ipcRenderer.invoke('storage:update-config', key, value);
    },

    // Credentials
    async getCredentials() {
        const result = await ipcRenderer.invoke('storage:get-credentials');
        return result.success ? result.data : {};
    },
    async setCredentials(credentials) {
        return ipcRenderer.invoke('storage:set-credentials', credentials);
    },
    async getApiKey() {
        const result = await ipcRenderer.invoke('storage:get-api-key');
        return result.success ? result.data : '';
    },
    async setApiKey(apiKey) {
        return ipcRenderer.invoke('storage:set-api-key', apiKey);
    },
    async getGroqApiKey() {
        const result = await ipcRenderer.invoke('storage:get-groq-api-key');
        return result.success ? result.data : '';
    },
    async setGroqApiKey(groqApiKey) {
        return ipcRenderer.invoke('storage:set-groq-api-key', groqApiKey);
    },
    async setDeepgramApiKey(deepgramApiKey) {
        return ipcRenderer.invoke('storage:set-deepgram-api-key', deepgramApiKey);
    },

    // Preferences
    async getPreferences() {
        const result = await ipcRenderer.invoke('storage:get-preferences');
        return result.success ? result.data : {};
    },
    async setPreferences(preferences) {
        return ipcRenderer.invoke('storage:set-preferences', preferences);
    },
    async updatePreference(key, value) {
        return ipcRenderer.invoke('storage:update-preference', key, value);
    },

    // Keybinds
    async getKeybinds() {
        const result = await ipcRenderer.invoke('storage:get-keybinds');
        return result.success ? result.data : null;
    },
    async setKeybinds(keybinds) {
        return ipcRenderer.invoke('storage:set-keybinds', keybinds);
    },

    // Sessions (History)
    async getAllSessions() {
        const result = await ipcRenderer.invoke('storage:get-all-sessions');
        return result.success ? result.data : [];
    },
    async getSession(sessionId) {
        const result = await ipcRenderer.invoke('storage:get-session', sessionId);
        return result.success ? result.data : null;
    },
    async saveSession(sessionId, data) {
        return ipcRenderer.invoke('storage:save-session', sessionId, data);
    },
    async deleteSession(sessionId) {
        return ipcRenderer.invoke('storage:delete-session', sessionId);
    },
    async deleteAllSessions() {
        return ipcRenderer.invoke('storage:delete-all-sessions');
    },

    // Clear all
    async clearAll() {
        return ipcRenderer.invoke('storage:clear-all');
    },

    // Limits
    async getTodayLimits() {
        const result = await ipcRenderer.invoke('storage:get-today-limits');
        return result.success ? result.data : { flash: { count: 0 }, flashLite: { count: 0 } };
    },
};

// Cache for preferences to avoid async calls in hot paths
let preferencesCache = null;
let shortcutRegistrationStatus = null;
let activeSessionId = null;

function showDiagnostic(diagnostic) {
    const visibleDiagnostic = createDiagnostic(diagnostic);
    recordDiagnosticCode(visibleDiagnostic);
    if (whisperOhKami && typeof whisperOhKami.showDiagnostic === 'function') {
        whisperOhKami.showDiagnostic(visibleDiagnostic);
    }
}

function isSuccessResult(result) {
    return result === true || (result && result.success === true);
}

function getResultError(result, fallback) {
    if (result && typeof result === 'object' && result.error) return result.error;
    return fallback;
}

async function loadPreferencesCache() {
    preferencesCache = await storage.getPreferences();
    return preferencesCache;
}

async function exportSupportDiagnostics() {
    return ipcRenderer.invoke('support:export-diagnostics', getRecentDiagnosticCodes());
}

function hasContextProfileContent(contextProfile) {
    const normalized = normalizeContextProfile(contextProfile);
    return Object.entries(normalized).some(([key, value]) => key !== 'updatedAt' && typeof value === 'string' && value.trim());
}

function buildSessionCustomPrompt(prefs = {}) {
    const contextProfile = normalizeContextProfile(prefs.contextProfile || {});
    const generatedPrompt = buildCustomPromptFromContext(contextProfile, '');
    const legacyPrompt = (prefs.customPrompt || '').trim();

    if (hasContextProfileContent(contextProfile)) {
        if (legacyPrompt && legacyPrompt !== generatedPrompt && !contextProfile.freeInstruction) {
            return buildCustomPromptFromContext(contextProfile, legacyPrompt);
        }
        return generatedPrompt;
    }

    return legacyPrompt;
}

// Initialize preferences cache
loadPreferencesCache();

function convertFloat32ToInt16(float32Array) {
    const int16Array = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
        // Improved scaling to prevent clipping
        const s = Math.max(-1, Math.min(1, float32Array[i]));
        int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return int16Array;
}

function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

// ── Deepgram-only mic pipeline: 48kHz capture → AudioWorklet 3:1 decimation → 16kHz Int16
// (Mirrors sokuroku's DownsampleProcessor; integer ratio avoids aliasing.)
// Worklet code lives at src/assets/deepgram-downsample-worklet.js — using a real file
// because the renderer CSP ("script-src 'self' 'unsafe-inline'") rejects blob: URLs,
// which silently breaks AudioWorklet.addModule().
const DEEPGRAM_WORKLET_URL = 'assets/deepgram-downsample-worklet.js';

let deepgramAudioContext = null;
let deepgramMicStream = null;
let deepgramWorkletNode = null;
let deepgramMicSource = null;

async function startDeepgramMicCapture(micDeviceId) {
    if (deepgramAudioContext) return;
    try {
        const audioConstraints = {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
        };
        if (micDeviceId) audioConstraints.deviceId = { exact: micDeviceId };
        deepgramMicStream = await navigator.mediaDevices.getUserMedia({
            audio: audioConstraints,
            video: false,
        });
        deepgramAudioContext = new AudioContext({ sampleRate: 48000 });
        await deepgramAudioContext.audioWorklet.addModule(DEEPGRAM_WORKLET_URL);
        deepgramMicSource = deepgramAudioContext.createMediaStreamSource(deepgramMicStream);
        deepgramWorkletNode = new AudioWorkletNode(deepgramAudioContext, 'deepgram-downsample-processor');
        deepgramWorkletNode.port.onmessage = e => {
            const buf = e.data; // ArrayBuffer (Int16 LE)
            if (!buf || buf.byteLength === 0) return;
            const base64 = arrayBufferToBase64(buf);
            ipcRenderer.invoke('send-deepgram-audio-content', { data: base64 }).catch(err => {
                console.error('[Deepgram mic worklet] IPC failed:', err && err.message);
            });
        };
        deepgramMicSource.connect(deepgramWorkletNode);
        // CRITICAL: AudioWorkletNode must be connected to a destination, otherwise
        // Chromium stops calling process(). The worklet writes nothing to outputs,
        // so this destination connection is silent (no feedback loop).
        deepgramWorkletNode.connect(deepgramAudioContext.destination);
        console.log('[Deepgram mic] 48kHz capture + 16kHz worklet started');
    } catch (err) {
        console.error('[Deepgram mic] setup error:', err);
        stopDeepgramMicCapture();
    }
}

function stopDeepgramMicCapture() {
    if (deepgramWorkletNode) {
        try {
            deepgramWorkletNode.port.onmessage = null;
        } catch (_) {}
        try {
            deepgramWorkletNode.disconnect();
        } catch (_) {}
        deepgramWorkletNode = null;
    }
    if (deepgramMicSource) {
        try {
            deepgramMicSource.disconnect();
        } catch (_) {}
        deepgramMicSource = null;
    }
    if (deepgramAudioContext) {
        try {
            deepgramAudioContext.close();
        } catch (_) {}
        deepgramAudioContext = null;
    }
    if (deepgramMicStream) {
        deepgramMicStream.getTracks().forEach(t => t.stop());
        deepgramMicStream = null;
    }
}

// ── Phase 1g-3: Deepgram-only system-audio pipeline (opponent voice) ──
// Mirrors the mic pipeline but pulls from a loopback virtual device the user
// picked in the system audio selector. Only started when systemDeviceId is a
// concrete deviceId (not 'auto' / 'none').
let deepgramSystemAudioContext = null;
let deepgramSystemStream = null;
let deepgramSystemWorkletNode = null;
let deepgramSystemSource = null;
// Phase 1g-3.7: remember the last loopback device the user picked so the
// renderer can resume the AudioWorklet system path after main signals a
// system-capture-resume (e.g. native helper stopped or crashed).
let lastSystemDeviceId = null;

async function startDeepgramSystemCapture(systemDeviceId) {
    if (!systemDeviceId || systemDeviceId === 'auto' || systemDeviceId === 'none') return;
    lastSystemDeviceId = systemDeviceId;
    if (deepgramSystemAudioContext) return;
    try {
        deepgramSystemStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                deviceId: { exact: systemDeviceId },
                channelCount: 1,
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
            },
            video: false,
        });
        deepgramSystemAudioContext = new AudioContext({ sampleRate: 48000 });
        await deepgramSystemAudioContext.audioWorklet.addModule(DEEPGRAM_WORKLET_URL);
        deepgramSystemSource = deepgramSystemAudioContext.createMediaStreamSource(deepgramSystemStream);
        deepgramSystemWorkletNode = new AudioWorkletNode(deepgramSystemAudioContext, 'deepgram-downsample-processor');
        deepgramSystemWorkletNode.port.onmessage = e => {
            const buf = e.data;
            if (!buf || buf.byteLength === 0) return;
            const base64 = arrayBufferToBase64(buf);
            ipcRenderer.invoke('send-deepgram-system-audio-content', { data: base64 }).catch(err => {
                console.error('[Deepgram system worklet] IPC failed:', err && err.message);
            });
        };
        deepgramSystemSource.connect(deepgramSystemWorkletNode);
        deepgramSystemWorkletNode.connect(deepgramSystemAudioContext.destination); // keep AudioWorklet alive
        console.log('[Deepgram system] 48kHz capture + 16kHz worklet started for loopback device');
    } catch (err) {
        console.error('[Deepgram system] setup error:', err);
        stopDeepgramSystemCapture();
    }
}

function stopDeepgramSystemCapture() {
    if (deepgramSystemWorkletNode) {
        try {
            deepgramSystemWorkletNode.port.onmessage = null;
        } catch (_) {}
        try {
            deepgramSystemWorkletNode.disconnect();
        } catch (_) {}
        deepgramSystemWorkletNode = null;
    }
    if (deepgramSystemSource) {
        try {
            deepgramSystemSource.disconnect();
        } catch (_) {}
        deepgramSystemSource = null;
    }
    if (deepgramSystemAudioContext) {
        try {
            deepgramSystemAudioContext.close();
        } catch (_) {}
        deepgramSystemAudioContext = null;
    }
    if (deepgramSystemStream) {
        deepgramSystemStream.getTracks().forEach(t => t.stop());
        deepgramSystemStream = null;
    }
}

async function initializeGemini(profile = 'sales', language = 'en-US') {
    const apiKey = await storage.getApiKey();
    if (apiKey) {
        const keyDiagnostic = classifyByokKey(apiKey);
        if (keyDiagnostic) {
            showDiagnostic(keyDiagnostic);
            whisperOhKami.setStatus('error');
            return false;
        }
        const prefs = await storage.getPreferences();
        const result = await ipcRenderer.invoke('initialize-gemini', apiKey, buildSessionCustomPrompt(prefs), profile, language);
        if (isSuccessResult(result)) {
            whisperOhKami.setStatus('Live');
            return true;
        } else {
            showDiagnostic(classifyGeminiInitFailure(getResultError(result, 'Gemini initialization failed')));
            whisperOhKami.setStatus('error');
            return false;
        }
    }
    showDiagnostic(classifyByokKey(apiKey));
    whisperOhKami.setStatus('error');
    return false;
}

async function initializeLocal(profile = 'sales') {
    const prefs = await storage.getPreferences();
    const ollamaHost = prefs.ollamaHost || 'http://127.0.0.1:11434';
    const ollamaModel = prefs.ollamaModel || 'gemma3:4b';
    const whisperModel = prefs.whisperModel || 'Xenova/whisper-tiny';
    const customPrompt = buildSessionCustomPrompt(prefs);

    const result = await ipcRenderer.invoke('initialize-local', ollamaHost, ollamaModel, whisperModel, profile, customPrompt);
    if (isSuccessResult(result)) {
        whisperOhKami.setStatus('Local AI Live');
        return true;
    } else {
        whisperOhKami.setStatus('error');
        return false;
    }
}

async function initializeTrial(profile = 'sales') {
    const prefs = await storage.getPreferences();
    const whisperModel = prefs.whisperModel || 'Xenova/whisper-tiny';
    const customPrompt = buildSessionCustomPrompt(prefs);

    const result = await ipcRenderer.invoke('initialize-trial', whisperModel, profile, customPrompt);
    if (isSuccessResult(result)) {
        whisperOhKami.setStatus('Trial Live');
        return true;
    } else {
        whisperOhKami.setStatus('error');
        return false;
    }
}

// Listen for status updates
ipcRenderer.on('update-status', (event, status) => {
    console.log('Status update:', status);
    whisperOhKami.setStatus(status);
});

ipcRenderer.on('app-diagnostic', (event, diagnostic) => {
    showDiagnostic(diagnostic);
});

async function startCapture(screenshotIntervalSeconds = 5, imageQuality = 'medium', micDeviceId = '', systemDeviceId = '') {
    // Store the image quality for manual screenshots
    currentImageQuality = imageQuality;

    // Refresh preferences cache
    await loadPreferencesCache();
    let audioMode = preferencesCache.audioMode || 'speaker_only';

    // Pick mic deviceId: explicit arg → preference → default (empty = browser default)
    const effectiveMicDeviceId = micDeviceId || preferencesCache.micDeviceId || '';

    // System audio source: 'auto' (current OS-specific path) | 'none' | <deviceId> (loopback virtual device)
    const effectiveSystemDeviceId = systemDeviceId || preferencesCache.systemDeviceId || 'auto';
    if (effectiveSystemDeviceId === 'none' && audioMode !== 'mic_only') {
        audioMode = 'mic_only'; // skip system audio path entirely
    }
    const useExplicitLoopbackDevice = effectiveSystemDeviceId !== 'auto' && effectiveSystemDeviceId !== 'none';

    // Start Deepgram-only mic pipeline (48kHz capture → 16kHz worklet, integer 3:1).
    // Runs alongside the existing 24kHz Gemini pipe; mic is captured twice (different
    // sample-rate streams) so neither pipeline degrades the other.
    startDeepgramMicCapture(effectiveMicDeviceId);
    // Phase 1g-3: also stand up an opponent-side Deepgram pipe when the user
    // picked a concrete loopback device. 'auto' / 'none' fall through to the
    // existing OS-specific paths and Gemini Live remains the opponent source.
    startDeepgramSystemCapture(effectiveSystemDeviceId);

    // Phase 1g-3.7 UX follow-up: auto-start the native WASAPI helper when the
    // user left system audio on 'auto'. Without this the helper had to be
    // poked from DevTools (window.devStartAudioCapture()), which silently
    // broke opponent transcription for anyone running without devtools open.
    // Explicit loopback selections are skipped on purpose — those use the
    // renderer-side AudioWorklet, and the helper's system-capture-suspend
    // IPC would tear that down.
    if (effectiveSystemDeviceId === 'auto' && audioMode !== 'mic_only') {
        ipcRenderer
            .invoke('start-audio-capture')
            .then(result => {
                const diagnostic = classifyAudioHelperFailure(result);
                if (diagnostic) showDiagnostic(diagnostic);
            })
            .catch(err => {
                console.warn('[audio-capture] helper auto-start failed:', err && err.message);
                showDiagnostic(classifyAudioHelperFailure(err));
            });
    }

    // Build mic getUserMedia constraints honoring the selected device (used by
    // macOS / Linux / Windows mic paths below).
    const micAudioConstraints = {
        sampleRate: SAMPLE_RATE,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
    };
    if (effectiveMicDeviceId) micAudioConstraints.deviceId = { exact: effectiveMicDeviceId };

    // If user explicitly picked a loopback virtual device for system audio, capture it
    // via getUserMedia and feed the existing setup function. This bypasses the
    // OS-specific getDisplayMedia / SystemAudioDump path below.
    if (useExplicitLoopbackDevice) {
        try {
            mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    deviceId: { exact: effectiveSystemDeviceId },
                    sampleRate: SAMPLE_RATE,
                    channelCount: 1,
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false,
                },
                video: false,
            });
            console.log('System audio captured via explicit loopback device');
            setupWindowsLoopbackProcessing();

            if (audioMode === 'mic_only' || audioMode === 'both') {
                try {
                    const micStream = await navigator.mediaDevices.getUserMedia({
                        audio: micAudioConstraints,
                        video: false,
                    });
                    console.log('Microphone capture started (loopback device mode)');
                    setupLinuxMicProcessing(micStream);
                } catch (micError) {
                    console.warn('Failed to get microphone access:', micError);
                }
            }

            // Done — skip OS-specific branches below.
            console.log('Capture started (explicit loopback) — system audio: yes, mic mode:', audioMode);
            return;
        } catch (loopErr) {
            console.warn('Explicit loopback device capture failed, falling back to OS path:', loopErr);
            // fall through to OS-specific branches
        }
    }

    try {
        if (isMacOS) {
            // On macOS, use SystemAudioDump for audio and getDisplayMedia for screen
            console.log('Starting macOS capture with SystemAudioDump...');

            // Start macOS audio capture
            const audioResult = await ipcRenderer.invoke('start-macos-audio');
            if (!audioResult.success) {
                throw new Error('Failed to start macOS audio capture: ' + audioResult.error);
            }

            // Get screen capture for screenshots
            mediaStream = await navigator.mediaDevices.getDisplayMedia({
                video: {
                    frameRate: 1,
                    width: { ideal: 1920 },
                    height: { ideal: 1080 },
                },
                audio: false, // Don't use browser audio on macOS
            });

            console.log('macOS screen capture started - audio handled by SystemAudioDump');

            if (audioMode === 'mic_only' || audioMode === 'both') {
                let micStream = null;
                try {
                    micStream = await navigator.mediaDevices.getUserMedia({
                        audio: micAudioConstraints,
                        video: false,
                    });
                    console.log('macOS microphone capture started');
                    setupLinuxMicProcessing(micStream);
                } catch (micError) {
                    console.warn('Failed to get microphone access on macOS:', micError);
                }
            }
        } else if (isLinux) {
            // Linux - use display media for screen capture and try to get system audio
            try {
                // First try to get system audio via getDisplayMedia (works on newer browsers)
                mediaStream = await navigator.mediaDevices.getDisplayMedia({
                    video: {
                        frameRate: 1,
                        width: { ideal: 1920 },
                        height: { ideal: 1080 },
                    },
                    audio: {
                        sampleRate: SAMPLE_RATE,
                        channelCount: 1,
                        echoCancellation: false, // Don't cancel system audio
                        noiseSuppression: false,
                        autoGainControl: false,
                    },
                });

                console.log('Linux system audio capture via getDisplayMedia succeeded');

                // Setup audio processing for Linux system audio
                setupLinuxSystemAudioProcessing();
            } catch (systemAudioError) {
                console.warn('System audio via getDisplayMedia failed, trying screen-only capture:', systemAudioError);

                // Fallback to screen-only capture
                mediaStream = await navigator.mediaDevices.getDisplayMedia({
                    video: {
                        frameRate: 1,
                        width: { ideal: 1920 },
                        height: { ideal: 1080 },
                    },
                    audio: false,
                });
            }

            // Additionally get microphone input for Linux based on audio mode
            if (audioMode === 'mic_only' || audioMode === 'both') {
                let micStream = null;
                try {
                    micStream = await navigator.mediaDevices.getUserMedia({
                        audio: micAudioConstraints,
                        video: false,
                    });

                    console.log('Linux microphone capture started');

                    // Setup audio processing for microphone on Linux
                    setupLinuxMicProcessing(micStream);
                } catch (micError) {
                    console.warn('Failed to get microphone access on Linux:', micError);
                    // Continue without microphone if permission denied
                }
            }

            console.log('Linux capture started - system audio:', mediaStream.getAudioTracks().length > 0, 'microphone mode:', audioMode);
        } else {
            // Windows - use display media with loopback for system audio
            mediaStream = await navigator.mediaDevices.getDisplayMedia({
                video: {
                    frameRate: 1,
                    width: { ideal: 1920 },
                    height: { ideal: 1080 },
                },
                audio: {
                    sampleRate: SAMPLE_RATE,
                    channelCount: 1,
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                },
            });

            console.log('Windows capture started with loopback audio');

            // Setup audio processing for Windows loopback audio only
            setupWindowsLoopbackProcessing();

            if (audioMode === 'mic_only' || audioMode === 'both') {
                let micStream = null;
                try {
                    micStream = await navigator.mediaDevices.getUserMedia({
                        audio: micAudioConstraints,
                        video: false,
                    });
                    console.log('Windows microphone capture started');
                    setupLinuxMicProcessing(micStream);
                } catch (micError) {
                    console.warn('Failed to get microphone access on Windows:', micError);
                }
            }
        }

        console.log('MediaStream obtained:', {
            hasVideo: mediaStream.getVideoTracks().length > 0,
            hasAudio: mediaStream.getAudioTracks().length > 0,
            videoTrack: mediaStream.getVideoTracks()[0]?.getSettings(),
        });

        // Manual mode only - screenshots captured on demand via shortcut
        console.log('Manual mode enabled - screenshots will be captured on demand only');
    } catch (err) {
        console.error('Error starting capture:', err);
        showDiagnostic(classifyAudioHelperFailure(err));
        whisperOhKami.setStatus('error');
    }
}

async function startTrialCapture(micDeviceId = '') {
    stopCapture();
    await loadPreferencesCache();
    const effectiveMicDeviceId = micDeviceId || preferencesCache.micDeviceId || '';
    const micAudioConstraints = {
        sampleRate: SAMPLE_RATE,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
    };
    if (effectiveMicDeviceId) micAudioConstraints.deviceId = { exact: effectiveMicDeviceId };

    try {
        mediaStream = await navigator.mediaDevices.getUserMedia({
            audio: micAudioConstraints,
            video: false,
        });
        setupLinuxMicProcessing(mediaStream);
        whisperOhKami.setStatus('Trial listening');
        console.log('Trial microphone capture started');
    } catch (err) {
        console.error('Error starting trial capture:', err);
        showDiagnostic(classifyAudioHelperFailure(err));
        whisperOhKami.setStatus('error');
    }
}

function setupLinuxMicProcessing(micStream) {
    // Setup microphone audio processing for Linux
    micAudioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
    const micSource = micAudioContext.createMediaStreamSource(micStream);
    const micProcessor = micAudioContext.createScriptProcessor(BUFFER_SIZE, 1, 1);

    let audioBuffer = [];
    const samplesPerChunk = SAMPLE_RATE * AUDIO_CHUNK_DURATION;

    micProcessor.onaudioprocess = async e => {
        const inputData = e.inputBuffer.getChannelData(0);
        audioBuffer.push(...inputData);

        // Process audio in chunks
        while (audioBuffer.length >= samplesPerChunk) {
            const chunk = audioBuffer.splice(0, samplesPerChunk);
            const pcmData16 = convertFloat32ToInt16(chunk);
            const base64Data = arrayBufferToBase64(pcmData16.buffer);

            await ipcRenderer.invoke('send-mic-audio-content', {
                data: base64Data,
                mimeType: 'audio/pcm;rate=24000',
            });
        }
    };

    micSource.connect(micProcessor);
    micProcessor.connect(micAudioContext.destination);

    // Store processor reference for cleanup
    micAudioProcessor = micProcessor;
}

function setupLinuxSystemAudioProcessing() {
    // Setup system audio processing for Linux (from getDisplayMedia)
    audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
    const source = audioContext.createMediaStreamSource(mediaStream);
    audioProcessor = audioContext.createScriptProcessor(BUFFER_SIZE, 1, 1);

    let audioBuffer = [];
    const samplesPerChunk = SAMPLE_RATE * AUDIO_CHUNK_DURATION;

    audioProcessor.onaudioprocess = async e => {
        const inputData = e.inputBuffer.getChannelData(0);
        audioBuffer.push(...inputData);

        // Process audio in chunks
        while (audioBuffer.length >= samplesPerChunk) {
            const chunk = audioBuffer.splice(0, samplesPerChunk);
            const pcmData16 = convertFloat32ToInt16(chunk);
            const base64Data = arrayBufferToBase64(pcmData16.buffer);

            await ipcRenderer.invoke('send-audio-content', {
                data: base64Data,
                mimeType: 'audio/pcm;rate=24000',
            });
        }
    };

    source.connect(audioProcessor);
    audioProcessor.connect(audioContext.destination);
}

function setupWindowsLoopbackProcessing() {
    // Setup audio processing for Windows loopback audio only
    audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
    const source = audioContext.createMediaStreamSource(mediaStream);
    audioProcessor = audioContext.createScriptProcessor(BUFFER_SIZE, 1, 1);

    let audioBuffer = [];
    const samplesPerChunk = SAMPLE_RATE * AUDIO_CHUNK_DURATION;

    audioProcessor.onaudioprocess = async e => {
        const inputData = e.inputBuffer.getChannelData(0);
        audioBuffer.push(...inputData);

        // Process audio in chunks
        while (audioBuffer.length >= samplesPerChunk) {
            const chunk = audioBuffer.splice(0, samplesPerChunk);
            const pcmData16 = convertFloat32ToInt16(chunk);
            const base64Data = arrayBufferToBase64(pcmData16.buffer);

            await ipcRenderer.invoke('send-audio-content', {
                data: base64Data,
                mimeType: 'audio/pcm;rate=24000',
            });
        }
    };

    source.connect(audioProcessor);
    audioProcessor.connect(audioContext.destination);
}

async function captureScreenshot(imageQuality = 'medium', isManual = false) {
    console.log(`Capturing ${isManual ? 'manual' : 'automated'} screenshot...`);
    if (!mediaStream) return;

    // Lazy init of video element
    if (!hiddenVideo) {
        hiddenVideo = document.createElement('video');
        hiddenVideo.srcObject = mediaStream;
        hiddenVideo.muted = true;
        hiddenVideo.playsInline = true;
        await hiddenVideo.play();

        await new Promise(resolve => {
            if (hiddenVideo.readyState >= 2) return resolve();
            hiddenVideo.onloadedmetadata = () => resolve();
        });

        // Lazy init of canvas based on video dimensions
        offscreenCanvas = document.createElement('canvas');
        offscreenCanvas.width = hiddenVideo.videoWidth;
        offscreenCanvas.height = hiddenVideo.videoHeight;
        offscreenContext = offscreenCanvas.getContext('2d');
    }

    // Check if video is ready
    if (hiddenVideo.readyState < 2) {
        console.warn('Video not ready yet, skipping screenshot');
        return;
    }

    offscreenContext.drawImage(hiddenVideo, 0, 0, offscreenCanvas.width, offscreenCanvas.height);

    // Check if image was drawn properly by sampling a pixel
    const imageData = offscreenContext.getImageData(0, 0, 1, 1);
    const isBlank = imageData.data.every((value, index) => {
        // Check if all pixels are black (0,0,0) or transparent
        return index === 3 ? true : value === 0;
    });

    if (isBlank) {
        console.warn('Screenshot appears to be blank/black');
    }

    let qualityValue;
    switch (imageQuality) {
        case 'high':
            qualityValue = 0.9;
            break;
        case 'medium':
            qualityValue = 0.7;
            break;
        case 'low':
            qualityValue = 0.5;
            break;
        default:
            qualityValue = 0.7; // Default to medium
    }

    offscreenCanvas.toBlob(
        async blob => {
            if (!blob) {
                console.error('Failed to create blob from canvas');
                return;
            }

            const reader = new FileReader();
            reader.onloadend = async () => {
                const base64data = reader.result.split(',')[1];

                // Validate base64 data
                if (!base64data || base64data.length < 100) {
                    console.error('Invalid base64 data generated');
                    return;
                }

                const result = await ipcRenderer.invoke('send-image-content', {
                    data: base64data,
                });

                if (result.success) {
                    console.log(`Image sent successfully (${offscreenCanvas.width}x${offscreenCanvas.height})`);
                } else {
                    console.error('Failed to send image:', result.error);
                }
            };
            reader.readAsDataURL(blob);
        },
        'image/jpeg',
        qualityValue
    );
}

const MANUAL_SCREENSHOT_PROMPT = `Help me on this page, give me the answer no bs, complete answer.
So if its a code question, give me the approach in few bullet points, then the entire code. Also if theres anything else i need to know, tell me.
If its a question about the website, give me the answer no bs, complete answer.
If its a mcq question, give me the answer no bs, complete answer.`;

async function captureManualScreenshot(imageQuality = null) {
    console.log('Manual screenshot triggered');
    const quality = imageQuality || currentImageQuality;

    if (!mediaStream) {
        console.error('No media stream available');
        return;
    }

    // Lazy init of video element
    if (!hiddenVideo) {
        hiddenVideo = document.createElement('video');
        hiddenVideo.srcObject = mediaStream;
        hiddenVideo.muted = true;
        hiddenVideo.playsInline = true;
        await hiddenVideo.play();

        await new Promise(resolve => {
            if (hiddenVideo.readyState >= 2) return resolve();
            hiddenVideo.onloadedmetadata = () => resolve();
        });

        // Lazy init of canvas based on video dimensions
        offscreenCanvas = document.createElement('canvas');
        offscreenCanvas.width = hiddenVideo.videoWidth;
        offscreenCanvas.height = hiddenVideo.videoHeight;
        offscreenContext = offscreenCanvas.getContext('2d');
    }

    // Check if video is ready
    if (hiddenVideo.readyState < 2) {
        console.warn('Video not ready yet, skipping screenshot');
        return;
    }

    // Downscale to max 1280px wide for faster transfer — vision models don't need 4K
    const MAX_WIDTH = 1280;
    const srcW = hiddenVideo.videoWidth;
    const srcH = hiddenVideo.videoHeight;
    let destW = srcW;
    let destH = srcH;
    if (srcW > MAX_WIDTH) {
        destW = MAX_WIDTH;
        destH = Math.round(srcH * (MAX_WIDTH / srcW));
    }
    offscreenCanvas.width = destW;
    offscreenCanvas.height = destH;
    offscreenContext.drawImage(hiddenVideo, 0, 0, destW, destH);

    let qualityValue;
    switch (quality) {
        case 'high':
            qualityValue = 0.85;
            break;
        case 'medium':
            qualityValue = 0.6;
            break;
        case 'low':
            qualityValue = 0.4;
            break;
        default:
            qualityValue = 0.6;
    }

    offscreenCanvas.toBlob(
        async blob => {
            if (!blob) {
                console.error('Failed to create blob from canvas');
                return;
            }

            const reader = new FileReader();
            reader.onloadend = async () => {
                const base64data = reader.result.split(',')[1];

                if (!base64data || base64data.length < 100) {
                    console.error('Invalid base64 data generated');
                    return;
                }

                console.log(`Sending image: ${destW}x${destH}, ~${Math.round(base64data.length / 1024)}KB`);

                // Send image with prompt to HTTP API (response streams via IPC events)
                const result = await ipcRenderer.invoke('send-image-content', {
                    data: base64data,
                    prompt: MANUAL_SCREENSHOT_PROMPT,
                });

                if (result.success) {
                    console.log(`Image response completed from ${result.model}`);
                    // Response already displayed via streaming events (new-response/update-response)
                } else {
                    console.error('Failed to get image response:', result.error);
                    whisperOhKami.addNewResponse(`Error: ${result.error}`);
                }
            };
            reader.readAsDataURL(blob);
        },
        'image/jpeg',
        qualityValue
    );
}

// Expose functions to global scope for external access
window.captureManualScreenshot = captureManualScreenshot;

function stopCapture() {
    stopDeepgramMicCapture();
    stopDeepgramSystemCapture();
    // Symmetric to the auto-start in startCapture. Idempotent — no-op when
    // the helper was never started (e.g. explicit loopback path or mic-only).
    ipcRenderer.invoke('stop-audio-capture').catch(() => {});
    // Phase 1g-3.7: clear the remembered loopback device so a later
    // `system-capture-resume` IPC (e.g. helper exit / user toggling the
    // native helper off via DevTools) can't silently re-arm the AudioWorklet
    // system path after the user has explicitly stopped capture.
    lastSystemDeviceId = null;

    if (screenshotInterval) {
        clearInterval(screenshotInterval);
        screenshotInterval = null;
    }

    if (audioProcessor) {
        audioProcessor.disconnect();
        audioProcessor = null;
    }

    // Clean up microphone audio processor.
    if (micAudioProcessor) {
        micAudioProcessor.disconnect();
        micAudioProcessor = null;
    }

    if (micAudioContext) {
        micAudioContext.close();
        micAudioContext = null;
    }

    if (audioContext) {
        audioContext.close();
        audioContext = null;
    }

    if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
        mediaStream = null;
    }

    // Stop macOS audio capture if running
    if (isMacOS) {
        ipcRenderer.invoke('stop-macos-audio').catch(err => {
            console.error('Error stopping macOS audio:', err);
        });
    }

    // Clean up hidden elements
    if (hiddenVideo) {
        hiddenVideo.pause();
        hiddenVideo.srcObject = null;
        hiddenVideo = null;
    }
    offscreenCanvas = null;
    offscreenContext = null;
}

// Send text message to Gemini
async function sendTextMessage(text) {
    if (!text || text.trim().length === 0) {
        console.warn('Cannot send empty text message');
        return { success: false, error: 'Empty message' };
    }

    try {
        const result = await ipcRenderer.invoke('send-text-message', text);
        if (result.success) {
            console.log('Text message sent successfully');
        } else {
            console.error('Failed to send text message:', result.error);
        }
        return result;
    } catch (error) {
        console.error('Error sending text message:', error);
        return { success: false, error: error.message };
    }
}

// Listen for conversation data from main process and save to storage
ipcRenderer.on('save-conversation-turn', async (event, data) => {
    try {
        await storage.saveSession(data.sessionId, { conversationHistory: data.fullHistory });
        console.log('Conversation session saved:', data.sessionId);
    } catch (error) {
        console.error('Error saving conversation session:', error);
    }
});

// Listen for session context (profile info) when session starts
ipcRenderer.on('save-session-context', async (event, data) => {
    try {
        activeSessionId = data.sessionId;
        if (window.whisperOhKami) {
            window.whisperOhKami.activeSessionId = activeSessionId;
        }
        const prefs = await storage.getPreferences();
        await storage.saveSession(data.sessionId, {
            profile: data.profile,
            customPrompt: data.customPrompt,
            contextProfile: prefs.contextProfile || {},
        });
        console.log('Session context saved:', data.sessionId, 'profile:', data.profile);
    } catch (error) {
        console.error('Error saving session context:', error);
    }
});

// Listen for screen analysis responses (from ctrl+enter)
ipcRenderer.on('save-screen-analysis', async (event, data) => {
    try {
        const prefs = await storage.getPreferences();
        await storage.saveSession(data.sessionId, {
            screenAnalysisHistory: data.fullHistory,
            profile: data.profile,
            customPrompt: data.customPrompt,
            contextProfile: prefs.contextProfile || {},
        });
        console.log('Screen analysis saved:', data.sessionId);
    } catch (error) {
        console.error('Error saving screen analysis:', error);
    }
});

// Handle shortcuts based on current view
function handleShortcut(shortcutKey) {
    const currentView = whisperOhKami.getCurrentView();

    if (shortcutKey === 'ctrl+enter' || shortcutKey === 'cmd+enter') {
        if (currentView === 'main') {
            whisperOhKami.element().handleStart();
        } else {
            captureManualScreenshot();
        }
    }
}

// Create reference to the main app element
const cheatingDaddyApp = document.querySelector('whisper-oh-kami-app');

// ============ THEME SYSTEM ============
const theme = {
    themes: {
        dark: {
            background: '#101010',
            text: '#e0e0e0',
            textSecondary: '#a0a0a0',
            // 6b6b6b on #101010 = 3.74:1, fails WCAG AA for body text.
            // 808080 lifts the contrast to ~4.82:1, passes AA, stays muted.
            textMuted: '#808080',
            border: '#2a2a2a',
            accent: '#ffffff',
            btnPrimaryBg: '#ffffff',
            btnPrimaryText: '#000000',
            btnPrimaryHover: '#e0e0e0',
            tooltipBg: '#1a1a1a',
            tooltipText: '#ffffff',
            keyBg: 'rgba(255,255,255,0.1)',
        },
        light: {
            background: '#ffffff',
            bgSurface: '#f4f6f8',
            bgElevated: '#eef1f4',
            bgHover: '#e8ebef',
            text: '#1a1f2e',
            textSecondary: '#5a6573',
            textMuted: '#5e6773',
            border: '#e3e7eb',
            // NOTE: theme.apply() maps `accent` → CSS var --border-strong /
            // --border-default (legacy alias). This is NOT the interactive
            // accent color — that lives in btnPrimaryBg below (#1f3a5f navy).
            // Field name "accent" is preserved across all themes for back-compat.
            accent: '#d3dae1',
            btnPrimaryBg: '#1f3a5f',
            btnPrimaryText: '#ffffff',
            btnPrimaryHover: '#2c4f7c',
            tooltipBg: '#1a1f2e',
            tooltipText: '#ffffff',
            keyBg: 'rgba(31,58,95,0.10)',
        },
        sepia: {
            background: '#f4ecd8',
            text: '#5c4b37',
            textSecondary: '#7a6a56',
            textMuted: '#998875',
            border: '#d4c8b0',
            accent: '#8b4513',
            btnPrimaryBg: '#5c4b37',
            btnPrimaryText: '#f4ecd8',
            btnPrimaryHover: '#7a6a56',
            tooltipBg: '#5c4b37',
            tooltipText: '#f4ecd8',
            keyBg: 'rgba(92,75,55,0.15)',
        },
    },

    current: 'light',

    get(name) {
        return this.themes[name] || this.themes.dark;
    },

    getAll() {
        const names = {
            light: 'Light',
            dark: 'Dark',
            sepia: 'Sepia',
        };
        return Object.keys(this.themes).map(key => ({
            value: key,
            name: names[key] || key,
            colors: this.themes[key],
        }));
    },

    hexToRgb(hex) {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result
            ? {
                  r: parseInt(result[1], 16),
                  g: parseInt(result[2], 16),
                  b: parseInt(result[3], 16),
              }
            : { r: 30, g: 30, b: 30 };
    },

    lightenColor(rgb, amount) {
        return {
            r: Math.min(255, rgb.r + amount),
            g: Math.min(255, rgb.g + amount),
            b: Math.min(255, rgb.b + amount),
        };
    },

    darkenColor(rgb, amount) {
        return {
            r: Math.max(0, rgb.r - amount),
            g: Math.max(0, rgb.g - amount),
            b: Math.max(0, rgb.b - amount),
        };
    },

    applyBackgrounds(colors, alpha = 0.8) {
        // Back-compat: support old call signature (just a hex string).
        // Warn in dev so accidental string-passing surfaces immediately;
        // a string-input caller skips the explicit bgSurface/bgElevated/bgHover
        // path and silently gets the lighten/darken-derived neutrals.
        if (typeof colors === 'string') {
            console.warn(
                'applyBackgrounds: received a string, expected a colors object. ' +
                    'Falling back to derived surfaces. Update callers to pass the full theme colors.'
            );
            colors = { background: colors };
        }
        const root = document.documentElement;
        const baseRgb = this.hexToRgb(colors.background);

        const isLight = (baseRgb.r + baseRgb.g + baseRgb.b) / 3 > 128;
        const adjust = isLight ? this.darkenColor.bind(this) : this.lightenColor.bind(this);

        // Prefer explicit surface tokens; fall back to lighten/darken derivation
        const surfaceRgb = colors.bgSurface ? this.hexToRgb(colors.bgSurface) : adjust(baseRgb, 10);
        const elevatedRgb = colors.bgElevated ? this.hexToRgb(colors.bgElevated) : adjust(baseRgb, 22);
        const hoverRgb = colors.bgHover ? this.hexToRgb(colors.bgHover) : adjust(baseRgb, 28);

        const bgBase = `rgba(${baseRgb.r}, ${baseRgb.g}, ${baseRgb.b}, ${alpha})`;
        const bgSurface = `rgba(${surfaceRgb.r}, ${surfaceRgb.g}, ${surfaceRgb.b}, ${alpha})`;
        const bgElevated = `rgba(${elevatedRgb.r}, ${elevatedRgb.g}, ${elevatedRgb.b}, ${alpha})`;
        const bgHover = `rgba(${hoverRgb.r}, ${hoverRgb.g}, ${hoverRgb.b}, ${alpha})`;

        // New design tokens (used by components)
        root.style.setProperty('--bg-app', bgBase);
        root.style.setProperty('--bg-surface', bgSurface);
        root.style.setProperty('--bg-elevated', bgElevated);
        root.style.setProperty('--bg-hover', bgHover);

        // Legacy aliases
        root.style.setProperty('--header-background', bgBase);
        root.style.setProperty('--main-content-background', bgBase);
        root.style.setProperty('--bg-primary', bgBase);
        root.style.setProperty('--bg-secondary', bgSurface);
        root.style.setProperty('--bg-tertiary', bgElevated);
        root.style.setProperty('--input-background', bgElevated);
        root.style.setProperty('--input-focus-background', bgElevated);
        root.style.setProperty('--hover-background', bgHover);
        root.style.setProperty('--scrollbar-background', bgBase);
    },

    apply(themeName, alpha = 0.8) {
        const colors = this.get(themeName);
        this.current = themeName;
        const root = document.documentElement;

        // New design tokens (used by components)
        root.style.setProperty('--text-primary', colors.text);
        root.style.setProperty('--text-secondary', colors.textSecondary);
        root.style.setProperty('--text-muted', colors.textMuted);
        root.style.setProperty('--border', colors.border);
        root.style.setProperty('--border-strong', colors.accent);
        root.style.setProperty('--accent', colors.btnPrimaryBg);
        root.style.setProperty('--accent-hover', colors.btnPrimaryHover);

        // Legacy aliases
        root.style.setProperty('--text-color', colors.text);
        root.style.setProperty('--border-color', colors.border);
        root.style.setProperty('--border-default', colors.accent);
        root.style.setProperty('--placeholder-color', colors.textMuted);
        root.style.setProperty('--scrollbar-thumb', colors.border);
        root.style.setProperty('--scrollbar-thumb-hover', colors.textMuted);
        root.style.setProperty('--key-background', colors.keyBg);
        // Primary button
        root.style.setProperty('--btn-primary-bg', colors.btnPrimaryBg);
        root.style.setProperty('--btn-primary-text', colors.btnPrimaryText);
        root.style.setProperty('--btn-primary-hover', colors.btnPrimaryHover);
        // Start button (same as primary)
        root.style.setProperty('--start-button-background', colors.btnPrimaryBg);
        root.style.setProperty('--start-button-color', colors.btnPrimaryText);
        root.style.setProperty('--start-button-hover-background', colors.btnPrimaryHover);
        // Tooltip
        root.style.setProperty('--tooltip-bg', colors.tooltipBg);
        root.style.setProperty('--tooltip-text', colors.tooltipText);
        // Status colors — Direction A palette (matches :root --danger / --success)
        root.style.setProperty('--error-color', '#d64545');
        root.style.setProperty('--success-color', '#1f9d57');

        // Also apply background colors from theme
        this.applyBackgrounds(colors, alpha);
    },

    async load() {
        try {
            const prefs = await storage.getPreferences();
            const stored = prefs.theme || 'light';
            // Safe fallback: if the user has a pref pointing to a removed theme
            // (e.g. they had 'tokyonight' before the 9→3 reduction), drop back
            // to 'light' and persist so the Settings UI stays consistent next
            // open. theme.get() also has a defensive fallback but this catches
            // the saved-pref drift at the source.
            const themeName = this.themes[stored] ? stored : 'light';
            if (themeName !== stored) {
                console.warn(`Theme "${stored}" no longer available; falling back to "${themeName}".`);
                try {
                    await storage.updatePreference('theme', themeName);
                } catch (_) {
                    /* non-fatal: pref write failure shouldn't break boot */
                }
            }
            const alpha = prefs.backgroundTransparency ?? 0.92;
            this.apply(themeName, alpha);
            return themeName;
        } catch (err) {
            this.apply('light');
            return 'light';
        }
    },

    async save(themeName) {
        await storage.updatePreference('theme', themeName);
        this.apply(themeName);
    },
};

// Consolidated whisperOhKami object - all functions in one place
const whisperOhKami = {
    // App version
    getVersion: async () => ipcRenderer.invoke('get-app-version'),

    // Element access
    element: () => cheatingDaddyApp,
    e: () => cheatingDaddyApp,

    // App state functions - access properties directly from the app element
    getCurrentView: () => cheatingDaddyApp.currentView,
    getLayoutMode: () => cheatingDaddyApp.layoutMode,

    // Status and response functions
    setStatus: text => cheatingDaddyApp.setStatus(text),
    showDiagnostic: diagnostic => cheatingDaddyApp.showDiagnostic(createDiagnostic(diagnostic)),
    addNewResponse: response => cheatingDaddyApp.addNewResponse(response),
    updateCurrentResponse: response => cheatingDaddyApp.updateCurrentResponse(response),

    // Core functionality
    initializeGemini,
    initializeLocal,
    initializeTrial,
    startCapture,
    startTrialCapture,
    stopCapture,
    sendTextMessage,
    handleShortcut,

    // Storage API
    storage,

    // Live BYOK key verification (guided wizard)
    keyVerify: {
        gemini: key => ipcRenderer.invoke('verify:gemini-key', key),
        deepgram: key => ipcRenderer.invoke('verify:deepgram-key', key),
    },

    // Theme API
    theme,

    // Refresh preferences cache (call after updating preferences)
    refreshPreferencesCache: loadPreferencesCache,

    // Shortcut registration state from main process
    shortcutRegistrationStatus,

    // Current session id for UI features that may mount after session start
    activeSessionId,

    // Local-only support export
    exportSupportDiagnostics,

    // Platform detection
    isLinux: isLinux,
    isMacOS: isMacOS,
};

// Make it globally available
window.whisperOhKami = whisperOhKami;

ipcRenderer.on('shortcut-registration-status', (event, data) => {
    shortcutRegistrationStatus = data || null;
    whisperOhKami.shortcutRegistrationStatus = shortcutRegistrationStatus;
    window.dispatchEvent(new CustomEvent('shortcut-registration-status', { detail: shortcutRegistrationStatus }));
});

ipcRenderer.on('transcription-clear', (event, data) => {
    activeSessionId = data?.sessionId || activeSessionId;
    whisperOhKami.activeSessionId = activeSessionId;
});

// Dev harness — replay a deterministic turnEvents scenario through the
// production processGenerationComplete path so prompt/gate/AI-call behavior
// can be verified without driving real audio. Available in DevTools as:
//   await devRunScenario('opponent_question_self_yes')
//   await devListScenarios()
window.devRunScenario = name => ipcRenderer.invoke('dev:run-scenario', name);
window.devListScenarios = () => ipcRenderer.invoke('dev:list-scenarios');
// Phase 1g-3 live observers — useful in DevTools while validating the
// opponent-side Deepgram pipeline against a real loopback device.
window.devDumpTurnEvents = () => ipcRenderer.invoke('dev:dump-turn-events');
window.devDumpDeepgramStatus = () => ipcRenderer.invoke('dev:dump-deepgram-status');
window.devDumpDiscoveryEvidence = () => ipcRenderer.invoke('dev:dump-discovery-evidence');
// Phase 1g-3.7 — control + observe the audio-capture child process (native
// WASAPI helper or ffmpeg+SCR fallback). See src/utils/audioCapture.js for
// backend selection and env-var configuration.
window.devStartAudioCapture = () => ipcRenderer.invoke('start-audio-capture');
window.devStopAudioCapture = () => ipcRenderer.invoke('stop-audio-capture');
window.devDumpAudioCaptureStatus = () => ipcRenderer.invoke('dev:dump-audio-capture-status');
// Legacy 1g-3.6 spike aliases — share the same handlers in main; kept for one
// release while DevTools snippets / wrapper scripts migrate.
window.devStartFfmpegLoopback = () => ipcRenderer.invoke('start-ffmpeg-loopback');
window.devStopFfmpegLoopback = () => ipcRenderer.invoke('stop-ffmpeg-loopback');
window.devDumpFfmpegLoopbackStatus = () => ipcRenderer.invoke('dev:dump-ffmpeg-loopback-status');

// Phase 1g-3.7 — when main starts the audio-capture helper, suspend the
// renderer-side AudioWorklet system path so we don't double-feed Deepgram
// (helper PCM via main + worklet PCM via send-deepgram-system-audio-content
// would both land on deepgramServiceSystem). Resume restarts the worklet
// using the last picked loopback device id.
ipcRenderer.on('system-capture-suspend', () => {
    console.log('[renderer] system-capture-suspend received — stopping AudioWorklet system path');
    stopDeepgramSystemCapture();
});
ipcRenderer.on('system-capture-resume', () => {
    if (!lastSystemDeviceId) {
        console.log('[renderer] system-capture-resume received — no remembered device, worklet stays idle');
        return;
    }
    console.log('[renderer] system-capture-resume received — restarting AudioWorklet for', lastSystemDeviceId);
    startDeepgramSystemCapture(lastSystemDeviceId).catch(err => {
        console.error('[renderer] system-capture-resume restart failed:', err && err.message);
    });
});

// Load theme after DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => theme.load());
} else {
    theme.load();
}
