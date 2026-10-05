const { GoogleGenAI, Modality } = require('@google/genai');
const { BrowserWindow, ipcMain } = require('electron');
const { spawn } = require('child_process');
const { saveDebugAudio } = require('../audioUtils');
const { getSystemPrompt } = require('./prompts');
const {
    getAvailableModel,
    incrementLimitCount,
    getApiKey,
    getGroqApiKey,
    getDeepgramApiKey,
    incrementCharUsage,
    getModelForToday,
    getSttMode,
} = require('../storage');
const { DeepgramService } = require('./deepgram');
const audioCapture = require('./audioCapture');
const { createTurnEvents } = require('./turnEvents');
const { createDevHarness } = require('./devHarness');
const { createDiscoveryEvidence } = require('./discoveryEvidence');

// Conversation text (transcripts, AI replies, screen-analysis results, raw
// Gemini Live messages) is only logged when WOK_DEBUG=1. Default logs carry
// lengths / counts only, so a shared console or log file does not leak the call.
const VERBOSE = process.env.WOK_DEBUG === '1';
const { createDiscoveryEvidenceLLM, shouldNotifyDiscoveryLLMRefiner } = require('./discoveryEvidenceLLM');
const { buildSuggestionPrompt, resolveSuggestionProfile, buildEvidenceBlock } = require('./suggestionPrompt');
const { detectShadowReasons } = require('./aiResponseGate');
const { classifyDeepgramStatus } = require('./errorDiagnostics');

// Lazy-loaded to avoid circular dependency (localai.js imports from gemini.js)
let _localai = null;
function getLocalAi() {
    if (!_localai) _localai = require('./localai');
    return _localai;
}

// Provider mode: 'byok', 'local', or 'trial'
let currentProviderMode = 'byok';

// Groq conversation history for context
let groqConversationHistory = [];

// Conversation tracking variables
let currentSessionId = null;
let currentTranscription = '';
// Deepgram-derived transcript (mic only, higher accuracy than Gemini Live's
// inputTranscription). Used as the primary source for AI-response prompts;
// falls back to currentTranscription (Gemini Live) when empty (e.g. only the
// other party spoke during this turn).
let currentDeepgramTranscription = '';
let conversationHistory = [];
let screenAnalysisHistory = [];
let currentProfile = null;
let currentCustomPrompt = null;
let isInitializingSession = false;
let currentSystemPrompt = null;

function formatSpeakerResults(results) {
    let text = '';
    for (const result of results) {
        if (result.transcript && result.speakerId) {
            const speakerLabel = result.speakerId === 1 ? 'Interviewer' : 'Candidate';
            text += `[${speakerLabel}]: ${result.transcript}\n`;
        }
    }
    return text;
}

module.exports.formatSpeakerResults = formatSpeakerResults;

// Audio capture variables
let systemAudioProc = null;
let messageBuffer = '';

// Reconnection variables
let isUserClosing = false;
let sessionParams = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_DELAY = 2000;

function sendToRenderer(channel, data) {
    const windows = BrowserWindow.getAllWindows();
    if (windows.length > 0) {
        windows[0].webContents.send(channel, data);
    }
}

// ── Deepgram (low-latency STT, runs in parallel with Gemini Live) ──
// Two independent instances:
//   - deepgramService (mic / "self"): driven by send-deepgram-audio-content
//   - deepgramServiceSystem (loopback / "opponent"): driven by
//     send-deepgram-system-audio-content. Only started when the user picked
//     a specific loopback device for system audio (Phase 1d-2 'auto'/'none'
//     paths fall back to Gemini Live for the opponent transcript).
let deepgramService = null;
let deepgramServiceSystem = null;
let deepgramKeyMissingWarned = false;
let deepgramConnectionInFlight = false;
let deepgramSystemConnectionInFlight = false;
let lastGeminiInitError = null;

function sendDiagnostic(diagnostic) {
    if (diagnostic) sendToRenderer('app-diagnostic', diagnostic);
}

function ensureDeepgramConnected() {
    // Deepgram is a byok-only path: trial / local (Ollama) never send audio to
    // Deepgram, even when a leftover key is stored.
    if (currentProviderMode !== 'byok') return false;
    if (deepgramService && deepgramService.isConnected()) return true;
    // STT mode gate: 'local' opts out of Deepgram entirely. Audio still flows
    // to Gemini Live for multimodal context (see README "STT モードの考え方")
    // — disabling Deepgram is the no-third-party-STT slice of the privacy
    // story, not a full local-only mode.
    if (getSttMode() === 'local') return false;
    if (deepgramConnectionInFlight) return false; // CONNECTING — don't kick off another connect()
    const apiKey = getDeepgramApiKey();
    if (!apiKey) {
        if (!deepgramKeyMissingWarned) {
            console.warn('[Deepgram] No API key found (DEEPGRAM_API_KEY env or credentials.json). Skipping Deepgram tee.');
            deepgramKeyMissingWarned = true;
        }
        return false;
    }
    if (!deepgramService) deepgramService = new DeepgramService();
    if (deepgramService.isConnected()) return true;
    deepgramConnectionInFlight = true;
    deepgramService.connect(
        apiKey,
        ({ transcript, is_final }) => {
            sendToRenderer('transcription-update', {
                type: is_final ? 'deepgram-final' : 'deepgram-interim',
                segments: [{ speakerId: 2, text: transcript }],
            });
            // Accumulate finals as the primary AI-response source + structured turn event.
            if (is_final && transcript && transcript.trim()) {
                currentDeepgramTranscription += (currentDeepgramTranscription ? ' ' : '') + transcript.trim();
                pushTurnEvent({ speaker: 'self', text: transcript, source: 'deepgram' });
            }
        },
        (status, message) => {
            console.log('[Deepgram mic status]', status, message || '');
            if (status === 'connected' || status === 'error' || status === 'disconnected') {
                deepgramConnectionInFlight = false;
            }
            if (status === 'error') {
                sendToRenderer('update-status', `Deepgram: ${message || 'error'}`);
                sendDiagnostic(classifyDeepgramStatus(status, message));
            }
        }
    );
    return false;
}

function ensureDeepgramSystemConnected() {
    // byok-only gate (see ensureDeepgramConnected).
    if (currentProviderMode !== 'byok') return false;
    if (deepgramServiceSystem && deepgramServiceSystem.isConnected()) return true;
    // STT mode gate (see ensureDeepgramConnected for the rationale).
    if (getSttMode() === 'local') return false;
    if (deepgramSystemConnectionInFlight) return false;
    const apiKey = getDeepgramApiKey();
    if (!apiKey) return false; // mic-side already warned; stay quiet
    if (!deepgramServiceSystem) deepgramServiceSystem = new DeepgramService();
    if (deepgramServiceSystem.isConnected()) return true;
    deepgramSystemConnectionInFlight = true;
    deepgramServiceSystem.connect(
        apiKey,
        ({ transcript, is_final }) => {
            // Phase 1g-3.5: surface opponent-side Deepgram in the UI as well.
            // Only finals are emitted (interim noise is rarely useful for the
            // other party — keeps the panel calmer than the mic side).
            if (is_final && transcript && transcript.trim()) {
                pushTurnEvent({ speaker: 'opponent', text: transcript, source: 'deepgram' });
                sendToRenderer('transcription-update', {
                    type: 'deepgram-final',
                    segments: [{ speakerId: 1, text: transcript }],
                });
            }
        },
        (status, message) => {
            console.log('[Deepgram system status]', status, message || '');
            if (status === 'connected' || status === 'error' || status === 'disconnected') {
                deepgramSystemConnectionInFlight = false;
            }
            if (status === 'error') {
                sendToRenderer('update-status', `Deepgram(system): ${message || 'error'}`);
                sendDiagnostic(classifyDeepgramStatus(status, message));
            }
        }
    );
    return false;
}

function disconnectDeepgram() {
    if (deepgramService) {
        try {
            deepgramService.disconnect();
        } catch (e) {
            console.warn('[Deepgram mic] disconnect error:', e.message);
        }
        deepgramService = null;
        deepgramConnectionInFlight = false;
    }
    if (deepgramServiceSystem) {
        try {
            deepgramServiceSystem.disconnect();
        } catch (e) {
            console.warn('[Deepgram system] disconnect error:', e.message);
        }
        deepgramServiceSystem = null;
        deepgramSystemConnectionInFlight = false;
    }
    deepgramKeyMissingWarned = false;
}

// Build context message for session restoration
function buildContextMessage() {
    const lastTurns = conversationHistory.slice(-20);
    const validTurns = lastTurns.filter(turn => turn.transcription?.trim() && turn.ai_response?.trim());

    if (validTurns.length === 0) return null;

    const contextLines = validTurns.map(turn => `[Interviewer]: ${turn.transcription.trim()}\n[Your answer]: ${turn.ai_response.trim()}`);

    return `Session reconnected. Here's the conversation so far:\n\n${contextLines.join('\n\n')}\n\nContinue from here.`;
}

// Conversation management functions
function initializeNewSession(profile = null, customPrompt = null) {
    sessionGeneration.bump();
    // A response still streaming from the previous session is now stale and
    // its finally{} will no longer clear the in-flight flag (so it cannot
    // clobber a newer call's flag) — release it here so the new session is
    // not blocked behind a dead stream.
    aiResponseInFlight = false;
    clearPendingAi();
    currentSessionId = Date.now().toString();
    currentTranscription = '';
    currentDeepgramTranscription = '';
    turnEventsStore.resetForSession();
    discoveryEvidenceStore.reset();
    stopDiscoveryLLMRefiner();
    discoveryLLMInterval = setInterval(() => {
        discoveryLLMRefiner.maybeRefine().catch(() => {});
    }, 5000);
    conversationHistory = [];
    screenAnalysisHistory = [];
    groqConversationHistory = [];
    currentProfile = profile;
    currentCustomPrompt = customPrompt;
    // PR-β Phase 2.C: reset lastDispatchedEventKind so the shadow
    // detector (aiResponseGate.detectShadowConsecutiveSelf) cannot
    // misclassify the first dispatch of this new session as a
    // consecutive_self continuation of whatever the previous session
    // ended on. The predicate-side contract — null prev kind never
    // flags consecutive_self — is anchored by the matching unit test
    // in aiResponseGate.test.js.
    lastDispatchedEventKind = null;
    console.log('New conversation session started:', currentSessionId, 'profile:', profile);

    sendToRenderer('transcription-clear', { sessionId: currentSessionId });
    sendToRenderer('discovery-evidence-update', discoveryEvidenceStore.getState());

    // Save initial session with profile context
    if (profile) {
        sendToRenderer('save-session-context', {
            sessionId: currentSessionId,
            profile: profile,
            customPrompt: customPrompt || '',
        });
    }
}

function saveConversationTurn(transcription, aiResponse, token) {
    if (token && token.isStale()) {
        console.log('[history] dropped turn from a closed session');
        return;
    }
    // Never lazily start a session from a save: after close-session a late
    // save would otherwise resurrect a ghost session (transcription-clear to
    // the renderer, a restarted Discovery LLM refinement timer).
    if (!currentSessionId) {
        console.log('[history] dropped: no active session');
        return;
    }

    const conversationTurn = {
        timestamp: Date.now(),
        transcription: transcription.trim(),
        ai_response: aiResponse.trim(),
    };

    conversationHistory.push(conversationTurn);
    if (VERBOSE) {
        console.log('Saved conversation turn:', conversationTurn);
    } else {
        console.log('[history] saved turn', {
            chars: conversationTurn.transcription.length,
            responseChars: conversationTurn.ai_response.length,
        });
    }

    // Send to renderer to save in IndexedDB
    sendToRenderer('save-conversation-turn', {
        sessionId: currentSessionId,
        turn: conversationTurn,
        fullHistory: conversationHistory,
    });
}

function saveScreenAnalysis(prompt, response, model, token) {
    if (token && token.isStale()) {
        console.log('[history] dropped screen analysis from a closed session');
        return;
    }
    // See saveConversationTurn: no lazy session start from a save.
    if (!currentSessionId) {
        console.log('[history] dropped: no active session');
        return;
    }

    const analysisEntry = {
        timestamp: Date.now(),
        prompt: prompt,
        response: response.trim(),
        model: model,
    };

    screenAnalysisHistory.push(analysisEntry);
    if (VERBOSE) {
        console.log('Saved screen analysis:', analysisEntry);
    } else {
        console.log('[history] saved screen analysis', { model, responseChars: analysisEntry.response.length });
    }

    // Send to renderer to save
    sendToRenderer('save-screen-analysis', {
        sessionId: currentSessionId,
        analysis: analysisEntry,
        fullHistory: screenAnalysisHistory,
        profile: currentProfile,
        customPrompt: currentCustomPrompt,
    });
}

function getCurrentSessionData() {
    return {
        sessionId: currentSessionId,
        history: conversationHistory,
    };
}

async function getEnabledTools() {
    const tools = [];

    // Check if Google Search is enabled (default: true)
    const googleSearchEnabled = await getStoredSetting('googleSearchEnabled', 'true');
    console.log('Google Search enabled:', googleSearchEnabled);

    if (googleSearchEnabled === 'true') {
        tools.push({ googleSearch: {} });
        console.log('Added Google Search tool');
    } else {
        console.log('Google Search tool disabled');
    }

    return tools;
}

async function getStoredSetting(key, defaultValue) {
    try {
        const windows = BrowserWindow.getAllWindows();
        if (windows.length > 0) {
            // Wait a bit for the renderer to be ready
            await new Promise(resolve => setTimeout(resolve, 100));

            // Try to get setting from renderer process localStorage
            const value = await windows[0].webContents.executeJavaScript(`
                (function() {
                    try {
                        if (typeof localStorage === 'undefined') {
                            console.log('localStorage not available yet for ${key}');
                            return '${defaultValue}';
                        }
                        const stored = localStorage.getItem('${key}');
                        console.log('Retrieved setting ${key}:', stored);
                        return stored || '${defaultValue}';
                    } catch (e) {
                        console.error('Error accessing localStorage for ${key}:', e);
                        return '${defaultValue}';
                    }
                })()
            `);
            return value;
        }
    } catch (error) {
        console.error('Error getting stored setting for', key, ':', error.message);
    }
    console.log('Using default value for', key, ':', defaultValue);
    return defaultValue;
}

// helper to check if groq has been configured
function hasGroqKey() {
    const key = getGroqApiKey();
    return key && key.trim() != '';
}

// ── AI response throttle: serialize Groq/Gemma calls + context-aware gate ──
// Phase 1g-1': structured turn events instead of opaque concatenated buffers.
// turnEvents holds the recent dialogue history with speaker labels so the AI
// can act as a "side-by-side high performer" — answering opponent questions,
// suggesting deeper questions after the user speaks, flagging missed items.
let aiResponseInFlight = false;
// Same-session freshness (v0.7.5): a request that arrives while a response
// is in flight is not dropped — the LATEST one is kept here (overwritten,
// never queued) and dispatched once when the current call finishes.
// `pendingAiFromTurnEvents` marks a Live trigger, whose follow-up re-enters
// processGenerationComplete so the prompt is rebuilt from the newest turns;
// typed text is re-sent as-is through the same entry. Cleared on every
// session boundary (initializeNewSession, close-session).
let pendingAiTranscription = null;
let pendingAiFromTurnEvents = false;
// Session-generation guard: every session boundary (initializeNewSession,
// close-session) bumps this counter; Groq / Gemma / screen-analysis streams
// capture a token at start and drop their result once it is stale, so a
// stopped session's late response never reaches the UI, history, or the
// next session. See sessionGeneration.js.
const { createGenerationCounter } = require('./sessionGeneration');
const sessionGeneration = createGenerationCounter();
// Dev tooling only (harness / diagnostics).
function getSessionGeneration() {
    return sessionGeneration.current;
}
const AI_MIN_TRANSCRIPT_CHARS = parseInt(process.env.AI_MIN_TRANSCRIPT_CHARS || '5', 10);
const AI_MAX_TURN_HISTORY = parseInt(process.env.AI_MAX_TURN_HISTORY || '10', 10);
const AI_OPPONENT_RECENT_WINDOW_MS = parseInt(process.env.AI_OPPONENT_RECENT_WINDOW_MS || '8000', 10);
// PR-β Phase 2.C: window for the shadow_no_recent_opponent detector.
// Deliberately wider than AI_OPPONENT_RECENT_WINDOW_MS (8s) — at 8s the
// signal fires on almost every longish self-turn and stops being useful
// as a shadow indicator. 30s flags genuinely opponent-silent stretches.
// Tunable per session via env in case observation suggests otherwise.
const AI_SHADOW_NO_OPPONENT_WINDOW_MS = parseInt(process.env.AI_SHADOW_NO_OPPONENT_WINDOW_MS || '30000', 10);

// turnEvents: chronological dialogue events with speaker labels.
// { speaker: 'self' | 'opponent', text: string, source: 'deepgram' | 'gemini_live', timestamp: number }
// Phase 1g (post-3.8): extracted into utils/turnEvents.js. The store is the
// single source of truth; the module-level wrappers below preserve the call
// sites that already read by name. Source-selection dedup (Deepgram vs
// Gemini Live) stays here in gemini.js / future deepgramOrchestrator — *not*
// inside turnEventsStore.
const turnEventsStore = createTurnEvents({
    maxPromptTurns: AI_MAX_TURN_HISTORY,
    opponentRecentWindowMs: AI_OPPONENT_RECENT_WINDOW_MS,
});

// Phase 1.A: 5-element shadow extractor. Lives next to turnEventsStore so
// pushTurnEvent can fan out to both stores in a single hook. AI response
// generation does NOT consult this store — it is purely a renderer-facing
// progress signal for the discovery / sales flagship UI.
const discoveryEvidenceStore = createDiscoveryEvidence();

// Phase 1.A+: LLM hybrid refiner. The privacy gate inside
// createDiscoveryEvidenceLLM ensures the Gemini Flash call only fires when
// providerMode === 'byok'; 'local' (Ollama) and 'trial' modes skip
// refinement entirely so transcripts never leave the device unexpectedly.
const discoveryLLMRefiner = createDiscoveryEvidenceLLM({
    llmClient: {
        async generateContent(prompt) {
            const apiKey = getApiKey();
            if (!apiKey) throw new Error('discoveryLLM: no API key configured');
            const ai = new GoogleGenAI({ apiKey });
            const response = await ai.models.generateContent({
                model: 'gemini-2.0-flash',
                contents: [{ text: prompt }],
            });
            return response.text || '';
        },
    },
    getTranscript: () => turnEventsStore.recentTurnsForPrompt(20),
    getProviderMode: () => currentProviderMode,
    applyResult: (parsed, transcript) => {
        const result = discoveryEvidenceStore.applyLLMResult(parsed, transcript);
        if (result.changed) sendToRenderer('discovery-evidence-update', result.state);
    },
    log: (...args) => console.warn(...args),
});

let discoveryLLMInterval = null;

// Stop the LLM refinement polling and clear in-flight scheduler state.
// Called from initializeNewSession (before re-arming the timer for the
// new session) and from close-session (so the refiner does not outlive
// the audio / Deepgram pipeline). Without this, a closed BYOK session
// would leak a 5s timer that could re-fire Gemini Flash against stale
// transcript data — a privacy regression for the WhisperOhKAMI axis.
function stopDiscoveryLLMRefiner() {
    if (discoveryLLMInterval) {
        clearInterval(discoveryLLMInterval);
        discoveryLLMInterval = null;
    }
    discoveryLLMRefiner.reset();
}

function pushTurnEvent(event) {
    const pushed = turnEventsStore.pushTurnEvent(event);
    const { state, changed } = discoveryEvidenceStore.processNewTurn(event);
    if (changed) sendToRenderer('discovery-evidence-update', state);
    // PR-γ (Phase 2.B): only opponent turns can contribute new 5-element
    // evidence. Gating the refiner notification avoids spending BYOK Gemini
    // calls / scheduler quota on self pitches and ack-only turns.
    // Contract is pinned in discoveryEvidenceLLM.test.js.
    if (shouldNotifyDiscoveryLLMRefiner(event)) {
        discoveryLLMRefiner.notifyTurn();
    }
    return pushed;
}

const DEV_PUSH_TURN_SPEAKERS = new Set(['opponent', 'self']);

// Backs the dev:push-turn IPC handler (WOK_DEV=1 only). Validates the turn
// and feeds it through pushTurnEvent exactly like a transcription result.
function devPushTurn(payload) {
    if (process.env.WOK_DEV !== '1') return { success: false, reason: 'dev_disabled' };
    const { speaker, text } = payload && typeof payload === 'object' ? payload : {};
    if (!DEV_PUSH_TURN_SPEAKERS.has(speaker)) return { success: false, reason: 'invalid_speaker' };
    if (typeof text !== 'string' || !text.trim()) return { success: false, reason: 'empty_text' };
    pushTurnEvent({ speaker, text: text.trim(), source: 'dev_push_turn' });
    return { success: true, state: discoveryEvidenceStore.getState() };
}

function recentTurnsForPrompt(maxTurns) {
    return turnEventsStore.recentTurnsForPrompt(maxTurns);
}

function hasRecentOpponentSpeech(windowMs) {
    return turnEventsStore.hasRecentOpponentSpeech(windowMs);
}

function lastTurn() {
    return turnEventsStore.lastTurn();
}

function lastOpponentTurnWithin(windowMs) {
    return turnEventsStore.lastOpponentTurnWithin(windowMs);
}

// Phase 1g-1.6: classify a short user utterance based on what the opponent
// just said. Drives a more accurate short-skip decision than pure length:
//   - closed_question_reply: opponent asked a question → AI should fire
//   - ack_after_pain_point: opponent shared a pain point → AI should fire
//   - noise: opponent silent / unrelated statement → AI should skip
const QUESTION_RE =
    /[?？]\s*$|(ですか|でしょうか|いただけますか|いかがでしょうか|いかがですか|お聞かせください|教えてください|お聞きしても|ご検討|可能ですか|ありますか|どうですか)[\s?？。.]*$/;
const PAIN_POINT_RE = /(困っ|悩ん|疲弊|大変|厳しい|難しい|問題|課題|不安|懸念|離職|辞め|残業|ストレス|ボトルネック|ミス|失敗|遅れ|赤字)/;

function classifyShortUtterance() {
    const recentOpponent = lastOpponentTurnWithin();
    if (!recentOpponent) return 'noise';
    const text = recentOpponent.text || '';
    if (QUESTION_RE.test(text)) return 'closed_question_reply';
    if (PAIN_POINT_RE.test(text)) return 'ack_after_pain_point';
    return 'noise';
}

// Context-aware short-utterance gate (Phase 1g-1.6).
// For short user utterances, classify the most recent opponent turn:
//   - closed_question_reply / ack_after_pain_point → fire (worth a suggestion)
//   - noise → skip (e.g. opponent just stated a fact, user said "うん")
// Long utterances (>= AI_MIN_TRANSCRIPT_CHARS) always fire.
let lastShortClassification = null;
function getLastShortClassification() {
    return lastShortClassification;
}

function shouldSkipAiResponse(transcription, { fromTurnEvents = false } = {}) {
    if (aiResponseInFlight) {
        pendingAiTranscription = transcription;
        pendingAiFromTurnEvents = fromTurnEvents;
        console.log('[AI deferred] previous response still in flight; keeping the latest request for one follow-up');
        return true;
    }
    const text = (transcription || '').trim();
    if (text.length === 0) return true;
    if (text.length < AI_MIN_TRANSCRIPT_CHARS) {
        const classification = classifyShortUtterance();
        lastShortClassification = classification;
        if (classification === 'noise') {
            console.log(
                `[AI skipped] short utterance classified as noise (no relevant opponent context): ${VERBOSE ? `"${text}"` : `chars=${text.length}`}`
            );
            return true;
        }
        console.log(`[AI allowed] short utterance ${VERBOSE ? `"${text}"` : `chars=${text.length}`} → classified as ${classification}`);
        return false;
    }
    lastShortClassification = null;
    return false;
}

function clearPendingAi() {
    pendingAiTranscription = null;
    pendingAiFromTurnEvents = false;
}

// Called from the finally{} of sendToGroq / sendToGemma once the in-flight
// flag of a non-stale call is released: dispatch the one deferred request.
function dispatchPendingAi(entry) {
    if (pendingAiTranscription == null) return;
    const text = pendingAiTranscription;
    const fromTurnEvents = pendingAiFromTurnEvents;
    clearPendingAi();
    if (fromTurnEvents) {
        processGenerationComplete(text);
    } else {
        entry(text);
    }
}

function trimConversationHistoryForGemma(history, maxChars = 42000) {
    if (!history || history.length === 0) return [];
    let totalChars = 0;
    const trimmed = [];

    for (let i = history.length - 1; i >= 0; i--) {
        const turn = history[i];
        const turnChars = (turn.content || '').length;

        if (totalChars + turnChars > maxChars) break;
        totalChars += turnChars;
        trimmed.unshift(turn);
    }
    return trimmed;
}

function stripThinkingTags(text) {
    return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

// On self_finished events the system prompt forbids the "返答候補" section.
// If the model emits both sections, drop the "返答候補" block. If the model
// emits ONLY "返答候補" (single-section reply), rename the header to
// "次に聞くとよいこと" instead of erasing the whole reply — otherwise the
// user gets blank suggestions.
function stripForbiddenSections(text, eventKind) {
    if (!text || eventKind !== 'self_finished') return text;
    const hasDive = /\*{0,2}次に聞くとよいこと[:：]/.test(text);
    if (hasDive) {
        const reply = /\*{0,2}返答候補[:：]\*{0,2}[\s\S]*?(?=\*{0,2}次に聞くとよいこと[:：]|$)/g;
        return text.replace(reply, '').trim();
    }
    // No dive section — rename the forbidden 返答候補 header in place.
    return text.replace(/\*{0,2}返答候補[:：]\*{0,2}/g, '**次に聞くとよいこと:**').trim();
}

// When the model returns plain text without either section header, prepend the
// appropriate header so the UI / assertions see a consistent structure.
// Gemini 2.5 Flash sometimes drops headers when the answer is a single line.
function ensureSectionHeaders(text, eventKind) {
    if (!text) return text;
    const hasReply = text.includes('返答候補:') || text.includes('返答候補：');
    const hasDive = text.includes('次に聞くとよいこと:') || text.includes('次に聞くとよいこと：');
    if (hasReply || hasDive) return text;
    if (eventKind === 'opponent_finished') return '**返答候補:**\n' + text;
    if (eventKind === 'self_finished') return '**次に聞くとよいこと:**\n' + text;
    return text;
}

// Inject the most recent screen-analysis results into the AI-response system
// prompt so that the conversational AI (Groq / Gemma) is aware of what the user
// asked about the current screen. Without this, B/C and D run with independent
// context and the conversation AI may answer in a way that contradicts what was
// just shown on screen.
function buildSystemPromptWithScreenContext(basePrompt) {
    const base = basePrompt || 'You are a helpful assistant.';
    // OFF by default — Gemma 3 27B tends to echo / summarize the injected screen
    // analysis text rather than answer the user's actual utterance, especially
    // when the screen analysis was rich English markdown. Re-enable explicitly
    // with ENABLE_SCREEN_CONTEXT=1 once we have a model with stronger system-prompt
    // adherence (e.g. Groq qwen3-32b) configured.
    if (process.env.ENABLE_SCREEN_CONTEXT !== '1') {
        return base;
    }
    if (!Array.isArray(screenAnalysisHistory) || screenAnalysisHistory.length === 0) {
        return base;
    }
    const MAX_ENTRIES = 2;
    const MAX_CHARS_PER_ENTRY = 1500;
    const recent = screenAnalysisHistory.slice(-MAX_ENTRIES);
    const formatted = recent
        .map(entry => {
            if (!entry || !entry.response) return null;
            let body = String(entry.response).trim();
            if (body.length > MAX_CHARS_PER_ENTRY) {
                body = body.slice(0, MAX_CHARS_PER_ENTRY) + ' …(truncated)';
            }
            const ts = entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : '';
            return `[画面分析 ${ts}]\n${body}`;
        })
        .filter(Boolean);
    if (formatted.length === 0) return base;
    return (
        `${base}\n\n` +
        `# 直近の画面分析結果（最新 ${formatted.length} 件、参考用）\n` +
        `以下はユーザーが直前に画面について確認した内容のメモです。\n` +
        `重要なルール:\n` +
        `1. これは背景情報にすぎません。**この内容そのものを要約・翻訳・反復しないこと**。\n` +
        `2. ユーザーが直前にマイクで話した内容（user メッセージ）に対する自然な提案・回答だけを返すこと。\n` +
        `3. 画面分析が英語で書かれていても、**回答は必ず日本語**で行うこと（専門用語のみ英語可）。\n` +
        `4. 画面分析が現在の会話と無関係に見える場合は、参照せずに通常通り user メッセージに答えること。\n\n` +
        formatted.join('\n\n')
    );
}

async function sendToGroq(transcription) {
    // No advice outside a live session (e.g. a Live generationComplete that
    // lands while close-session is awaiting the Live socket close).
    if (!currentSessionId) return;
    const groqApiKey = getGroqApiKey();
    if (!groqApiKey) {
        console.log('No Groq API key configured, skipping Groq response');
        return;
    }

    if (shouldSkipAiResponse(transcription)) return;

    const modelToUse = getModelForToday();
    if (!modelToUse) {
        console.log('All Groq daily limits exhausted');
        sendToRenderer('update-status', 'Groq limits reached for today');
        return;
    }

    aiResponseInFlight = true;
    const token = sessionGeneration.capture();
    if (VERBOSE) {
        console.log(`Sending to Groq (${modelToUse}):`, transcription.substring(0, 100) + '...');
    } else {
        console.log(`Sending to Groq (${modelToUse})`, { chars: transcription.length });
    }

    groqConversationHistory.push({
        role: 'user',
        content: transcription.trim(),
    });

    if (groqConversationHistory.length > 20) {
        groqConversationHistory = groqConversationHistory.slice(-20);
    }

    try {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${groqApiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: modelToUse,
                messages: [{ role: 'system', content: buildSystemPromptWithScreenContext(currentSystemPrompt) }, ...groqConversationHistory],
                stream: true,
                temperature: 0.7,
                max_tokens: 1024,
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Groq API error:', response.status, errorText);
            if (!token.isStale()) sendToRenderer('update-status', `Groq error: ${response.status}`);
            return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullText = '';
        let isFirst = true;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (token.isStale()) {
                reader.cancel().catch(() => {});
                break;
            }

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n').filter(line => line.trim() !== '');

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.slice(6);
                    if (data === '[DONE]') continue;

                    try {
                        const json = JSON.parse(data);
                        const delta = json.choices?.[0]?.delta?.content || '';
                        if (delta) {
                            fullText += delta;
                            const displayText = stripThinkingTags(fullText);
                            if (displayText && !token.isStale()) {
                                sendToRenderer(isFirst ? 'new-response' : 'update-response', displayText);
                                isFirst = false;
                            }
                        }
                    } catch (parseError) {
                        // Skip invalid JSON chunks
                    }
                }
            }
        }

        const eventKindNow = getLastDispatchedEventKind();
        const cleanedResponse = ensureSectionHeaders(stripForbiddenSections(stripThinkingTags(fullText), eventKindNow), eventKindNow);
        const modelKey = modelToUse.split('/').pop();

        const systemPromptChars = (currentSystemPrompt || 'You are a helpful assistant.').length;
        const historyChars = groqConversationHistory.reduce((sum, msg) => sum + (msg.content || '').length, 0);
        const inputChars = systemPromptChars + historyChars;
        const outputChars = cleanedResponse.length;

        incrementCharUsage('groq', modelKey, inputChars + outputChars);

        if (token.isStale()) {
            console.log('[AI] stale stream dropped');
            return;
        }

        if (cleanedResponse) {
            groqConversationHistory.push({
                role: 'assistant',
                content: cleanedResponse,
            });

            saveConversationTurn(transcription, cleanedResponse, token);
        }

        console.log(`Groq response completed (${modelToUse})`);
        sendToRenderer('update-status', 'Listening...');
    } catch (error) {
        console.error('Error calling Groq API:', error);
        lastAiErrorKind = classifyAiError(error);
        if (!token.isStale()) sendToRenderer('update-status', `Groq ${lastAiErrorKind}: ` + error.message);
    } finally {
        // A stale call must not clear the flag of a newer session's call
        // (nor dispatch a request deferred in that newer session).
        if (!token.isStale()) {
            aiResponseInFlight = false;
            dispatchPendingAi(sendToGroq);
        }
    }
}

async function sendToGemma(transcription) {
    // No advice outside a live session (see sendToGroq).
    if (!currentSessionId) return;
    const apiKey = getApiKey();
    if (!apiKey) {
        console.log('No Gemini API key configured');
        return;
    }

    if (shouldSkipAiResponse(transcription)) return;

    aiResponseInFlight = true;
    const token = sessionGeneration.capture();
    if (VERBOSE) {
        console.log('Sending to Gemma:', transcription.substring(0, 100) + '...');
    } else {
        console.log('Sending to Gemma', { chars: transcription.length });
    }

    groqConversationHistory.push({
        role: 'user',
        content: transcription.trim(),
    });

    const trimmedHistory = trimConversationHistoryForGemma(groqConversationHistory, 42000);

    try {
        const ai = new GoogleGenAI({ apiKey: apiKey });

        const messages = trimmedHistory.map(msg => ({
            role: msg.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: msg.content }],
        }));

        const systemPrompt = buildSystemPromptWithScreenContext(currentSystemPrompt);
        const messagesWithSystem = [
            { role: 'user', parts: [{ text: systemPrompt }] },
            { role: 'model', parts: [{ text: 'Understood. I will follow these instructions.' }] },
            ...messages,
        ];

        // Phase 1g-2.2: try flash, fall back to flash-lite on rate-limit (429).
        // Each Gemini Free Tier model has its own RPD (20/day each), so the
        // fallback effectively doubles the headroom for harness runs and gives
        // production users another shot before they see a quota wall.
        const FLASH_MODEL_FALLBACK_CHAIN = ['gemini-2.5-flash', 'gemini-2.5-flash-lite'];
        let fullText = '';
        let modelUsed = null;
        let lastModelErr = null;
        for (let i = 0; i < FLASH_MODEL_FALLBACK_CHAIN.length; i++) {
            const model = FLASH_MODEL_FALLBACK_CHAIN[i];
            try {
                if (i === 0) {
                    console.log(`Sending to Gemma using model=${model}`);
                } else {
                    console.log(`[Gemma fallback] previous failed (${classifyAiError(lastModelErr)}), retrying with model=${model}`);
                }
                const response = await ai.models.generateContentStream({
                    model,
                    contents: messagesWithSystem,
                });
                let stream = '';
                let isFirst = true;
                for await (const chunk of response) {
                    if (token.isStale()) break;
                    const chunkText = chunk.text;
                    if (chunkText) {
                        stream += chunkText;
                        sendToRenderer(isFirst ? 'new-response' : 'update-response', stream);
                        isFirst = false;
                    }
                }
                fullText = stream;
                modelUsed = model;
                break;
            } catch (err) {
                lastModelErr = err;
                // Do not spend another fallback call on a closed session.
                if (token.isStale()) break;
                if (classifyAiError(err) === 'rate_limited') {
                    console.warn(`[Gemma] ${model} rate-limited; trying next fallback`);
                    continue;
                }
                throw err;
            }
        }
        if (modelUsed === null && token.isStale()) {
            console.log('[AI] stale stream dropped');
            return;
        }
        if (modelUsed === null) {
            throw lastModelErr || new Error('All Gemma fallback models failed');
        }

        const systemPromptChars = (currentSystemPrompt || 'You are a helpful assistant.').length;
        const historyChars = trimmedHistory.reduce((sum, msg) => sum + (msg.content || '').length, 0);
        const inputChars = systemPromptChars + historyChars;
        const outputChars = fullText.length;

        incrementCharUsage('gemini', modelUsed, inputChars + outputChars);

        if (token.isStale()) {
            console.log('[AI] stale stream dropped');
            return;
        }

        const eventKindNow = getLastDispatchedEventKind();
        const cleanedFullText = ensureSectionHeaders(stripForbiddenSections(fullText, eventKindNow), eventKindNow);
        if (cleanedFullText.trim()) {
            groqConversationHistory.push({
                role: 'assistant',
                content: cleanedFullText.trim(),
            });

            if (groqConversationHistory.length > 40) {
                groqConversationHistory = groqConversationHistory.slice(-40);
            }

            saveConversationTurn(transcription, cleanedFullText, token);
        }

        console.log('Gemma response completed');
        sendToRenderer('update-status', 'Listening...');
    } catch (error) {
        console.error('Error calling Gemma API:', error);
        lastAiErrorKind = classifyAiError(error);
        if (!token.isStale()) sendToRenderer('update-status', `Gemma ${lastAiErrorKind}: ` + error.message);
    } finally {
        // A stale call must not clear the flag of a newer session's call
        // (nor dispatch a request deferred in that newer session).
        if (!token.isStale()) {
            aiResponseInFlight = false;
            dispatchPendingAi(sendToGemma);
        }
    }
}

// Track the most recent event kind so the AI response post-processor can
// hard-strip forbidden sections (e.g. 返答候補 on self_finished) when the
// model misses the system-prompt instruction.
let lastDispatchedEventKind = null;
function getLastDispatchedEventKind() {
    return lastDispatchedEventKind;
}

// Track terminal AI-call errors (currently only 429 / rate-limited) so the
// dev harness can distinguish "logic failure" from "infrastructure failure".
let lastAiErrorKind = null;
function getLastAiErrorKind() {
    return lastAiErrorKind;
}
function clearLastAiErrorKind() {
    lastAiErrorKind = null;
}
function classifyAiError(err) {
    const msg = (err && (err.message || err.toString())) || '';
    if (/\b429\b|RESOURCE_EXHAUSTED|Too Many Requests|rate.?limit|exceeded your current quota/i.test(msg)) {
        return 'rate_limited';
    }
    return 'error';
}

// Phase 2.A: buildSuggestionPrompt / resolveSuggestionProfile / buildEvidenceBlock
// were extracted to src/utils/suggestionPrompt.js so Jest can require them
// without dragging in Electron / @google/genai / audioCapture / deepgram.
// See the top of this file for the `require('./suggestionPrompt')`.

// Production trigger logic, extracted so dev harness can replay scenarios through
// the exact same path (turnEvents → shouldSkipAiResponse → Groq/Gemma) without
// going through the audio capture pipeline.
function processGenerationComplete(triggerText) {
    const last = lastTurn();
    const eventKind = !last ? 'idle' : last.speaker === 'self' ? 'self_finished' : 'opponent_finished';
    const trigger = (triggerText || '').trim();

    // Run the gate FIRST so dev/observability can see skip-vs-allow decisions
    // even when AI dispatch itself is disabled via DISABLE_AI_RESPONSE.
    if (shouldSkipAiResponse(trigger, { fromTurnEvents: true })) {
        return { fired: false, reason: 'skipped', eventKind, classification: getLastShortClassification() };
    }
    // Snapshot classification BEFORE dispatching: sendToGroq/sendToGemma each
    // call shouldSkipAiResponse(prompt) on the (long) prompt string, which
    // hits the long-utterance branch and resets lastShortClassification = null.
    // Without the snapshot the returned result loses the short classification.
    const classification = getLastShortClassification();
    if (process.env.DISABLE_AI_RESPONSE === '1') {
        console.log(`[AI disabled] event=${eventKind} trigger="${trigger.slice(0, 40)}" (would-fire)`);
        return { fired: false, reason: 'disabled', eventKind, classification };
    }
    // PR-β Phase 2.C (shadow phase): compute named reasons that future
    // gating *would* trigger on, but DO NOT gate. Log only. We read
    // lastDispatchedEventKind BEFORE the assignment below so the shadow
    // check sees the previous dispatch's kind. The composer takes
    // pre-computed booleans so the detectors stay decoupled from the
    // turnEvents store's internal event shape.
    const shadowReasons = detectShadowReasons({
        currentEventKind: eventKind,
        lastDispatchedEventKind,
        hasRecentOpponentSpeech: hasRecentOpponentSpeech(AI_SHADOW_NO_OPPONENT_WINDOW_MS),
    });
    if (shadowReasons.length > 0) {
        console.log(
            `[AI shadow] would-gate reasons=${shadowReasons.join(',')} event=${eventKind} prev_dispatch=${lastDispatchedEventKind || 'none'} turns=${turnEventsStore.length}`
        );
    }
    const recent = recentTurnsForPrompt();
    // Phase 2.A: snapshot evidence + currentProfile and let the pure builder
    // decide whether to inject the 5-element block. resolveSuggestionProfile
    // gates the inject to discovery/sales only — other profiles see no change.
    const evidenceState = discoveryEvidenceStore.getState();
    const prompt = buildSuggestionPrompt({
        recent,
        eventKind,
        last,
        profile: currentProfile,
        evidenceState,
    });
    console.log(`[AI source=turnEvents event=${eventKind}] turns=${turnEventsStore.length} trigger_len=${trigger.length}`);
    lastDispatchedEventKind = eventKind;
    if (hasGroqKey()) {
        sendToGroq(prompt);
    } else {
        sendToGemma(prompt);
    }
    return { fired: true, eventKind, prompt, classification, shadowReasons };
}

// Phase 1g (post-3.8): dev harness extracted to src/utils/devHarness.js. The
// scenarios + assertion + replay loop live there as a pure module driven by
// injected dependencies, so Jest can exercise it without spinning up Electron.
// gemini.js retains the existing runDevScenario / DEV_SCENARIOS exports and
// the dev:* IPC handlers untouched by delegating to a single instance.
const devHarness = createDevHarness({
    turnEvents: turnEventsStore,
    processGenerationComplete,
    isAiResponseInFlight: () => aiResponseInFlight,
    getCurrentSystemPrompt: () => currentSystemPrompt,
    setCurrentSystemPrompt: s => {
        currentSystemPrompt = s;
    },
    getCurrentProfile: () => currentProfile,
    getCurrentCustomPrompt: () => currentCustomPrompt,
    getSystemPrompt,
    getConversationHistory: () => conversationHistory,
    clearLastAiErrorKind,
    getLastAiErrorKind,
});
const DEV_SCENARIOS = devHarness.DEV_SCENARIOS;
const runDevScenario = devHarness.runDevScenario;

async function initializeGeminiSession(apiKey, customPrompt = '', profile = 'sales', language = 'en-US', isReconnect = false) {
    if (isInitializingSession) {
        console.log('Session initialization already in progress');
        return false;
    }

    isInitializingSession = true;
    lastGeminiInitError = null;
    if (!isReconnect) {
        sendToRenderer('session-initializing', true);
    }

    // Store params for reconnection
    if (!isReconnect) {
        sessionParams = { apiKey, customPrompt, profile, language };
        reconnectAttempts = 0;
    }

    const client = new GoogleGenAI({
        vertexai: false,
        apiKey: apiKey,
        httpOptions: { apiVersion: 'v1alpha' },
    });

    // Get enabled tools first to determine Google Search status
    const enabledTools = await getEnabledTools();
    const googleSearchEnabled = enabledTools.some(tool => tool.googleSearch);

    const systemPrompt = getSystemPrompt(profile, customPrompt, googleSearchEnabled);
    currentSystemPrompt = systemPrompt; // Store for Groq

    // Initialize new conversation session only on first connect
    if (!isReconnect) {
        initializeNewSession(profile, customPrompt);
    }

    try {
        const session = await client.live.connect({
            model: 'gemini-2.5-flash-native-audio-preview-09-2025',
            callbacks: {
                onopen: function () {
                    sendToRenderer('update-status', 'Live session connected');
                },
                onmessage: function (message) {
                    if (VERBOSE) console.log('----------------', message);

                    // Handle input transcription (what was spoken).
                    // When Deepgram is active we suppress UI emission of Gemini Live's
                    // inputTranscription because Gemini's speaker diarization sometimes
                    // labels the user's own voice as speaker-1 (which slips past the
                    // speaker-2 dedup in AssistantView and shows up duplicated). The
                    // AI prompt path already prefers currentDeepgramTranscription, so we
                    // still keep the Gemini-Live text accumulated as a fallback only.
                    const dgMicActive = !!(deepgramService && deepgramService.isConnected());
                    const dgSystemActive = !!(deepgramServiceSystem && deepgramServiceSystem.isConnected());
                    // Phase 1g-3.5 dedup: when the opponent-side Deepgram is
                    // also up, we already get a cleaner opponent stream from
                    // there, so skip the Gemini-Live opponent push to avoid
                    // double turnEvents. When only the mic-side Deepgram is up,
                    // Gemini Live remains the sole opponent source.
                    const pushGeminiLiveAsOpponent = dgMicActive && !dgSystemActive;
                    if (message.serverContent?.inputTranscription?.results) {
                        const results = message.serverContent.inputTranscription.results;
                        currentTranscription += formatSpeakerResults(results);
                        if (pushGeminiLiveAsOpponent) {
                            for (const r of results) {
                                if (r && r.transcript) {
                                    pushTurnEvent({ speaker: 'opponent', text: r.transcript, source: 'gemini_live' });
                                }
                            }
                        }
                        if (!dgMicActive) {
                            const segments = results.filter(r => r.transcript).map(r => ({ speakerId: r.speakerId || 1, text: r.transcript }));
                            if (segments.length > 0) {
                                sendToRenderer('transcription-update', { type: 'input', segments });
                            }
                        }
                    } else if (message.serverContent?.inputTranscription?.text) {
                        const text = message.serverContent.inputTranscription.text;
                        if (text.trim() !== '') {
                            currentTranscription += text;
                            if (pushGeminiLiveAsOpponent) {
                                pushTurnEvent({ speaker: 'opponent', text, source: 'gemini_live' });
                            }
                            if (!dgMicActive) {
                                sendToRenderer('transcription-update', {
                                    type: 'input',
                                    segments: [{ speakerId: 1, text }],
                                });
                            }
                        }
                    }

                    // Surface Gemini's outputTranscription to the panel as well (kept separate from Groq)
                    if (message.serverContent?.outputTranscription?.text) {
                        const text = message.serverContent.outputTranscription.text;
                        if (text.trim() !== '') {
                            sendToRenderer('transcription-update', {
                                type: 'output',
                                segments: [{ text }],
                            });
                        }
                    }

                    if (message.serverContent?.generationComplete) {
                        // Phase 1g-1' trigger: defer to the shared processor so dev
                        // scenarios go through the exact same path.
                        const triggerText = (currentDeepgramTranscription || currentTranscription).trim();
                        processGenerationComplete(triggerText);
                        // Clear per-turn accumulators (turnEvents history is preserved
                        // across turns so the AI keeps context).
                        currentTranscription = '';
                        currentDeepgramTranscription = '';
                        messageBuffer = '';
                    }

                    if (message.serverContent?.turnComplete) {
                        sendToRenderer('update-status', 'Listening...');
                    }
                },
                onerror: function (e) {
                    console.log('Session error:', e.message);
                    sendToRenderer('update-status', 'Error: ' + e.message);
                },
                onclose: function (e) {
                    console.log('Session closed:', e.reason);

                    // Don't reconnect if user intentionally closed
                    if (isUserClosing) {
                        isUserClosing = false;
                        sendToRenderer('update-status', 'Session closed');
                        return;
                    }

                    // Attempt reconnection
                    if (sessionParams && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                        attemptReconnect();
                    } else {
                        sendToRenderer('update-status', 'Session closed');
                    }
                },
            },
            config: {
                responseModalities: [Modality.AUDIO],
                proactivity: { proactiveAudio: true },
                outputAudioTranscription: {},
                tools: enabledTools,
                // Enable speaker diarization
                inputAudioTranscription: {
                    enableSpeakerDiarization: true,
                    minSpeakerCount: 2,
                    maxSpeakerCount: 2,
                },
                contextWindowCompression: { slidingWindow: {} },
                speechConfig: { languageCode: language },
                systemInstruction: {
                    parts: [{ text: systemPrompt }],
                },
            },
        });

        isInitializingSession = false;
        if (!isReconnect) {
            sendToRenderer('session-initializing', false);
        }
        return session;
    } catch (error) {
        console.error('Failed to initialize Gemini session:', error);
        lastGeminiInitError = error;
        isInitializingSession = false;
        if (!isReconnect) {
            sendToRenderer('session-initializing', false);
        }
        return null;
    }
}

async function attemptReconnect() {
    reconnectAttempts++;
    console.log(`Reconnection attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}`);

    // Clear stale buffers
    messageBuffer = '';
    currentTranscription = '';
    currentDeepgramTranscription = '';
    // Don't reset groqConversationHistory to preserve context across reconnects

    sendToRenderer('update-status', `Reconnecting... (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
    sendDiagnostic(classifyDeepgramStatus('reconnecting', `Gemini session reconnect ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}`));

    // Wait before attempting
    await new Promise(resolve => setTimeout(resolve, RECONNECT_DELAY));

    try {
        const session = await initializeGeminiSession(
            sessionParams.apiKey,
            sessionParams.customPrompt,
            sessionParams.profile,
            sessionParams.language,
            true // isReconnect
        );

        if (session && global.geminiSessionRef) {
            global.geminiSessionRef.current = session;

            // Restore context from conversation history via text message
            const contextMessage = buildContextMessage();
            if (contextMessage) {
                try {
                    console.log('Restoring conversation context...');
                    await session.sendRealtimeInput({ text: contextMessage });
                } catch (contextError) {
                    console.error('Failed to restore context:', contextError);
                    // Continue without context - better than failing
                }
            }

            // Don't reset reconnectAttempts here - let it reset on next fresh session
            sendToRenderer('update-status', 'Reconnected! Listening...');
            console.log('Session reconnected successfully');
            return true;
        }
    } catch (error) {
        console.error(`Reconnection attempt ${reconnectAttempts} failed:`, error);
    }

    // If we still have attempts left, try again
    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        return attemptReconnect();
    }

    // Max attempts reached - notify frontend
    console.log('Max reconnection attempts reached');
    sendDiagnostic(classifyDeepgramStatus('disconnected', 'Gemini session reconnect failed'));
    sendToRenderer('reconnect-failed', {
        message: 'Tried 3 times to reconnect. Must be upstream/network issues. Try restarting or download updated app from site.',
    });
    sessionParams = null;
    return false;
}

function killExistingSystemAudioDump() {
    return new Promise(resolve => {
        console.log('Checking for existing SystemAudioDump processes...');

        // Kill any existing SystemAudioDump processes
        const killProc = spawn('pkill', ['-f', 'SystemAudioDump'], {
            stdio: 'ignore',
        });

        killProc.on('close', code => {
            if (code === 0) {
                console.log('Killed existing SystemAudioDump processes');
            } else {
                console.log('No existing SystemAudioDump processes found');
            }
            resolve();
        });

        killProc.on('error', err => {
            console.log('Error checking for existing processes (this is normal):', err.message);
            resolve();
        });

        // Timeout after 2 seconds
        setTimeout(() => {
            killProc.kill();
            resolve();
        }, 2000);
    });
}

async function startMacOSAudioCapture(geminiSessionRef) {
    if (process.platform !== 'darwin') return false;

    // Kill any existing SystemAudioDump processes first
    await killExistingSystemAudioDump();

    console.log('Starting macOS audio capture with SystemAudioDump...');

    const { app } = require('electron');
    const path = require('path');

    let systemAudioPath;
    if (app.isPackaged) {
        systemAudioPath = path.join(process.resourcesPath, 'SystemAudioDump');
    } else {
        systemAudioPath = path.join(__dirname, '../assets', 'SystemAudioDump');
    }

    console.log('SystemAudioDump path:', systemAudioPath);

    const spawnOptions = {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
            ...process.env,
        },
    };

    systemAudioProc = spawn(systemAudioPath, [], spawnOptions);

    if (!systemAudioProc.pid) {
        console.error('Failed to start SystemAudioDump');
        return false;
    }

    console.log('SystemAudioDump started with PID:', systemAudioProc.pid);

    const CHUNK_DURATION = 0.1;
    const SAMPLE_RATE = 24000;
    const BYTES_PER_SAMPLE = 2;
    const CHANNELS = 2;
    const CHUNK_SIZE = SAMPLE_RATE * BYTES_PER_SAMPLE * CHANNELS * CHUNK_DURATION;

    let audioBuffer = Buffer.alloc(0);

    systemAudioProc.stdout.on('data', data => {
        audioBuffer = Buffer.concat([audioBuffer, data]);

        while (audioBuffer.length >= CHUNK_SIZE) {
            const chunk = audioBuffer.slice(0, CHUNK_SIZE);
            audioBuffer = audioBuffer.slice(CHUNK_SIZE);

            const monoChunk = CHANNELS === 2 ? convertStereoToMono(chunk) : chunk;

            if (currentProviderMode === 'local') {
                getLocalAi().processLocalAudio(monoChunk);
            } else {
                const base64Data = monoChunk.toString('base64');
                sendAudioToGemini(base64Data, geminiSessionRef);
            }

            if (process.env.DEBUG_AUDIO) {
                console.log(`Processed audio chunk: ${chunk.length} bytes`);
                saveDebugAudio(monoChunk, 'system_audio');
            }
        }

        const maxBufferSize = SAMPLE_RATE * BYTES_PER_SAMPLE * 1;
        if (audioBuffer.length > maxBufferSize) {
            audioBuffer = audioBuffer.slice(-maxBufferSize);
        }
    });

    systemAudioProc.stderr.on('data', data => {
        console.error('SystemAudioDump stderr:', data.toString());
    });

    systemAudioProc.on('close', code => {
        console.log('SystemAudioDump process closed with code:', code);
        systemAudioProc = null;
    });

    systemAudioProc.on('error', err => {
        console.error('SystemAudioDump process error:', err);
        systemAudioProc = null;
    });

    return true;
}

function convertStereoToMono(stereoBuffer) {
    const samples = stereoBuffer.length / 4;
    const monoBuffer = Buffer.alloc(samples * 2);

    for (let i = 0; i < samples; i++) {
        const leftSample = stereoBuffer.readInt16LE(i * 4);
        monoBuffer.writeInt16LE(leftSample, i * 2);
    }

    return monoBuffer;
}

function stopMacOSAudioCapture() {
    if (systemAudioProc) {
        console.log('Stopping SystemAudioDump...');
        systemAudioProc.kill('SIGTERM');
        systemAudioProc = null;
    }
}

async function sendAudioToGemini(base64Data, geminiSessionRef) {
    if (!geminiSessionRef.current) return;

    try {
        process.stdout.write('.');
        await geminiSessionRef.current.sendRealtimeInput({
            audio: {
                data: base64Data,
                mimeType: 'audio/pcm;rate=24000',
            },
        });
    } catch (error) {
        console.error('Error sending audio to Gemini:', error);
    }
}

async function sendImageToGeminiHttp(base64Data, prompt) {
    // A screenshot delivered after close-session must not reach Gemini or
    // the history of a session that no longer exists.
    if (!currentSessionId) return { success: false, error: 'session_closed' };
    // Get available model based on rate limits
    const model = getAvailableModel();

    const apiKey = getApiKey();
    if (!apiKey) {
        return { success: false, error: 'No API key configured' };
    }

    // Force Japanese reply. The renderer-supplied prompt is built in English
    // by the upstream cheating-daddy template, which causes Gemini Flash to
    // respond in English. Prepending an explicit language directive overrides it.
    const localizedPrompt = '回答は必ず日本語で行ってください。コードや英語固有名詞・専門用語のみ英語のまま使用可。\n\n' + prompt;

    const token = sessionGeneration.capture();
    try {
        const ai = new GoogleGenAI({ apiKey: apiKey });

        const contents = [
            {
                inlineData: {
                    mimeType: 'image/jpeg',
                    data: base64Data,
                },
            },
            { text: localizedPrompt },
        ];

        console.log(`Sending image to ${model} (streaming)...`);
        const response = await ai.models.generateContentStream({
            model: model,
            contents: contents,
        });

        // Increment count after successful call
        incrementLimitCount(model);

        // Stream the response
        let fullText = '';
        let isFirst = true;
        for await (const chunk of response) {
            if (token.isStale()) break;
            const chunkText = chunk.text;
            if (chunkText) {
                fullText += chunkText;
                // Send to renderer - new response for first chunk, update for subsequent
                sendToRenderer(isFirst ? 'new-response' : 'update-response', fullText);
                isFirst = false;
            }
        }

        if (token.isStale()) {
            console.log('[AI] stale screen analysis dropped');
            return { success: false, error: 'session_closed' };
        }

        console.log(`Image response completed from ${model}`);

        // Save screen analysis to history (store the original prompt without the
        // Japanese-forcing prefix so history stays clean).
        saveScreenAnalysis(prompt, fullText, model, token);

        return { success: true, text: fullText, model: model };
    } catch (error) {
        console.error('Error sending image to Gemini HTTP:', error);
        return { success: false, error: error.message };
    }
}

function setupGeminiIpcHandlers(geminiSessionRef) {
    // Store the geminiSessionRef globally for reconnection access
    global.geminiSessionRef = geminiSessionRef;

    // Phase 1g-3.7: tell renderer to suspend / resume its AudioWorklet
    // system-capture path while the native/ffmpeg helper is the active
    // opponent feeder. Registered here (rather than in audioCapture.js) so
    // that module stays free of the gemini.js → BrowserWindow circular
    // import. sendToRenderer broadcasts to every BrowserWindow so this works
    // for the single-window setup without needing a mainWindow handle.
    audioCapture.setIpcHooks({
        onSuspend: () => sendToRenderer('system-capture-suspend'),
        onResume: () => sendToRenderer('system-capture-resume'),
    });

    ipcMain.handle('initialize-gemini', async (event, apiKey, customPrompt, profile = 'sales', language = 'en-US') => {
        currentProviderMode = 'byok';
        const session = await initializeGeminiSession(apiKey, customPrompt, profile, language);
        if (session) {
            geminiSessionRef.current = session;
            return { success: true };
        }
        return { success: false, error: lastGeminiInitError ? lastGeminiInitError.message : 'Gemini initialization failed' };
    });

    ipcMain.handle('initialize-local', async (event, ollamaHost, ollamaModel, whisperModel, profile, customPrompt) => {
        currentProviderMode = 'local';
        const success = await getLocalAi().initializeLocalSession(ollamaHost, ollamaModel, whisperModel, profile, customPrompt);
        if (!success) {
            currentProviderMode = 'byok';
        }
        return success;
    });

    ipcMain.handle('initialize-trial', async (event, whisperModel, profile, customPrompt) => {
        currentProviderMode = 'trial';
        const success = await getLocalAi().initializeTrialSession(whisperModel, profile, customPrompt);
        if (!success) {
            currentProviderMode = 'byok';
        }
        return success;
    });

    ipcMain.handle('send-audio-content', async (event, { data, mimeType }) => {
        if (currentProviderMode === 'local') {
            try {
                const pcmBuffer = Buffer.from(data, 'base64');
                getLocalAi().processLocalAudio(pcmBuffer);
                return { success: true };
            } catch (error) {
                console.error('Error sending local audio:', error);
                return { success: false, error: error.message };
            }
        }
        if (!geminiSessionRef.current) return { success: false, error: 'No active Gemini session' };
        try {
            process.stdout.write('.');
            await geminiSessionRef.current.sendRealtimeInput({
                audio: { data: data, mimeType: mimeType },
            });
            return { success: true };
        } catch (error) {
            console.error('Error sending system audio:', error);
            return { success: false, error: error.message };
        }
    });

    // Dedicated 16kHz mic stream from the renderer's AudioWorklet (Deepgram only).
    // Renderer sends Int16 LE base64 already at 16kHz so no resample needed here.
    ipcMain.handle('send-deepgram-audio-content', async (event, { data }) => {
        if (!ensureDeepgramConnected()) return { success: false, error: 'no key or connecting' };
        try {
            const pcm16k = Buffer.from(data, 'base64');
            deepgramService.send(pcm16k);
            return { success: true };
        } catch (err) {
            console.error('[Deepgram] send error:', err.message);
            return { success: false, error: err.message };
        }
    });

    // Phase 1g-3: dedicated 16kHz system-audio (loopback) stream → opponent-side
    // Deepgram. Renderer only enables this when systemDeviceId points to an
    // explicit loopback device.
    ipcMain.handle('send-deepgram-system-audio-content', async (event, { data }) => {
        if (!ensureDeepgramSystemConnected()) return { success: false, error: 'no key or connecting' };
        try {
            const pcm16k = Buffer.from(data, 'base64');
            deepgramServiceSystem.send(pcm16k);
            return { success: true };
        } catch (err) {
            console.error('[Deepgram system] send error:', err.message);
            return { success: false, error: err.message };
        }
    });

    // Phase 1g-3.7: backend-dispatched opponent audio capture (native WASAPI
    // helper or ffmpeg+SCR fallback). Bypasses the renderer AudioWorklet path
    // entirely and streams 16kHz s16le mono PCM directly into the system-side
    // DeepgramService. See src/utils/audioCapture.js for backend selection
    // and env-var configuration. Opt-in via DevTools console:
    //   await window.devStartAudioCapture()
    //   await window.devStopAudioCapture()
    //   await window.devDumpAudioCaptureStatus()
    //
    // The legacy `*-ffmpeg-loopback` channels are kept as 1-release aliases
    // so external/dev callers (DevTools snippets, wrapper scripts, etc.)
    // keep working. All four channels share the same handler. Scheduled
    // removal in Phase 1g-3.8.
    const startAudioCaptureHandler = async () => {
        // Initiate the Deepgram system WS first; bytes that arrive before it
        // is OPEN are silently dropped (deepgram.js:46), which is acceptable
        // for the helper start-up window.
        ensureDeepgramSystemConnected();
        return audioCapture.start(deepgramServiceSystem);
    };
    const stopAudioCaptureHandler = async () => {
        return audioCapture.stop();
    };
    ipcMain.handle('start-audio-capture', startAudioCaptureHandler);
    ipcMain.handle('stop-audio-capture', stopAudioCaptureHandler);
    ipcMain.handle('start-ffmpeg-loopback', startAudioCaptureHandler);
    ipcMain.handle('stop-ffmpeg-loopback', stopAudioCaptureHandler);

    // Handle microphone audio on a separate channel (Gemini Live, 24kHz)
    ipcMain.handle('send-mic-audio-content', async (event, { data, mimeType }) => {
        if (currentProviderMode === 'local' || currentProviderMode === 'trial') {
            try {
                const pcmBuffer = Buffer.from(data, 'base64');
                getLocalAi().processLocalAudio(pcmBuffer);
                return { success: true };
            } catch (error) {
                console.error('Error sending local mic audio:', error);
                return { success: false, error: error.message };
            }
        }
        if (!geminiSessionRef.current) return { success: false, error: 'No active Gemini session' };
        try {
            process.stdout.write(',');
            await geminiSessionRef.current.sendRealtimeInput({
                audio: { data: data, mimeType: mimeType },
            });
            return { success: true };
        } catch (error) {
            console.error('Error sending mic audio:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('send-image-content', async (event, { data, prompt }) => {
        try {
            if (!data || typeof data !== 'string') {
                console.error('Invalid image data received');
                return { success: false, error: 'Invalid image data' };
            }

            const buffer = Buffer.from(data, 'base64');

            if (buffer.length < 1000) {
                console.error(`Image buffer too small: ${buffer.length} bytes`);
                return { success: false, error: 'Image buffer too small' };
            }

            process.stdout.write('!');

            if (currentProviderMode === 'local') {
                const result = await getLocalAi().sendLocalImage(data, prompt);
                return result;
            }

            // Use HTTP API instead of realtime session
            const result = await sendImageToGeminiHttp(data, prompt);
            return result;
        } catch (error) {
            console.error('Error sending image:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('send-text-message', async (event, text) => {
        if (!text || typeof text !== 'string' || text.trim().length === 0) {
            return { success: false, error: 'Invalid text message' };
        }

        if (currentProviderMode === 'local') {
            try {
                if (VERBOSE) console.log('Sending text to local Ollama:', text);
                else console.log('Sending text to local Ollama', { chars: text.length });
                return await getLocalAi().sendLocalText(text.trim());
            } catch (error) {
                console.error('Error sending local text:', error);
                return { success: false, error: error.message };
            }
        }

        if (!geminiSessionRef.current) return { success: false, error: 'No active Gemini session' };

        try {
            if (VERBOSE) console.log('Sending text message:', text);
            else console.log('Sending text message', { chars: text.length });

            if (hasGroqKey()) {
                sendToGroq(text.trim());
            } else {
                sendToGemma(text.trim());
            }

            await geminiSessionRef.current.sendRealtimeInput({ text: text.trim() });
            return { success: true };
        } catch (error) {
            console.error('Error sending text:', error);
            return { success: false, error: error.message };
        }
    });

    // Dev-only: replay a fixed turnEvents scenario through the production
    // processGenerationComplete path. Invoked from the renderer DevTools console
    // via window.devRunScenario('opponent_question_self_yes') etc.
    ipcMain.handle('dev:run-scenario', async (event, name) => {
        try {
            return runDevScenario(name);
        } catch (err) {
            console.error('[dev] scenario error:', err);
            return { ok: false, error: err.message };
        }
    });

    ipcMain.handle('dev:list-scenarios', async () => {
        return Object.entries(DEV_SCENARIOS).map(([name, def]) => ({
            name,
            description: def.description,
        }));
    });

    // Phase 1g-3 live verification helpers — observe turn events and Deepgram
    // connection state from the renderer DevTools console without spinning up a
    // scenario harness. Used to confirm that the opponent-side Deepgram actually
    // receives audio and pushes turn events when a loopback device is selected.
    ipcMain.handle('dev:dump-turn-events', async () => {
        return turnEventsStore.dump();
    });

    ipcMain.handle('dev:dump-discovery-evidence', async () => {
        return discoveryEvidenceStore.getState();
    });

    // Real-machine UI check without audio: push one transcribed turn through
    // the same pushTurnEvent hook every STT producer calls, so it reaches the
    // turn log, the 5-element store, the renderer's discovery-evidence-update
    // and (opponent turns) the Discovery LLM refiner. The other dev:* handlers
    // only read state; this one writes, so it is refused unless the app was
    // launched with WOK_DEV=1 (checked per call — a packaged build without the
    // env var never accepts it). DevTools: await devPushTurn({ speaker: 'opponent', text: '予算は年間100万円です' })
    ipcMain.handle('dev:push-turn', async (event, payload) => {
        return devPushTurn(payload);
    });

    ipcMain.handle('dev:dump-deepgram-status', async () => {
        return {
            keyConfigured: !!getDeepgramApiKey(),
            mic: {
                instantiated: !!deepgramService,
                connected: !!(deepgramService && deepgramService.isConnected()),
                connectionInFlight: deepgramConnectionInFlight,
                detail: deepgramService ? deepgramService.getStatus() : null,
            },
            system: {
                instantiated: !!deepgramServiceSystem,
                connected: !!(deepgramServiceSystem && deepgramServiceSystem.isConnected()),
                connectionInFlight: deepgramSystemConnectionInFlight,
                detail: deepgramServiceSystem ? deepgramServiceSystem.getStatus() : null,
            },
        };
    });

    // Phase 1g-3.7: observe audio-capture child-process state from DevTools
    // without spinning up a scenario harness. Both channel names share the
    // same handler so legacy DevTools snippets keep working.
    const dumpAudioCaptureHandler = async () => audioCapture.getStatus();
    ipcMain.handle('dev:dump-audio-capture-status', dumpAudioCaptureHandler);
    ipcMain.handle('dev:dump-ffmpeg-loopback-status', dumpAudioCaptureHandler);

    ipcMain.handle('start-macos-audio', async event => {
        if (process.platform !== 'darwin') {
            return {
                success: false,
                error: 'macOS audio capture only available on macOS',
            };
        }

        try {
            const success = await startMacOSAudioCapture(geminiSessionRef);
            return { success };
        } catch (error) {
            console.error('Error starting macOS audio capture:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('stop-macos-audio', async event => {
        try {
            stopMacOSAudioCapture();
            return { success: true };
        } catch (error) {
            console.error('Error stopping macOS audio capture:', error);
            return { success: false, error: error.message };
        }
    });

    // v0.7.5 manual evidence actions. Automatic detection tops out at
    // 'detected'; only the user (after hearing it from the customer) can mark an
    // element 'confirmed', and retract clears a wrong candidate back to empty.
    //
    // v0.7.8: select and confirm both return { success, reason }. reason is
    // null on success, otherwise the store's refusal reason —
    //   select:  'no_conflict' | 'row_not_live' | 'unknown_row'
    //   confirm: 'already_confirmed' | 'no_candidate' | 'conflict_unresolved' | 'basis_unknown'
    // Selecting a conflict value is not the customer's confirmation: the
    // element stays 'candidate' until the user presses ✓ (policy §6 T3/T4).
    // Contract pinned in tests/unit/evidenceIpc.test.js.
    ipcMain.handle('discovery-evidence-select', async (event, key, rowId) => {
        const result = discoveryEvidenceStore.selectEvidence(String(key || ''), Number(rowId));
        if (result.changed) sendToRenderer('discovery-evidence-update', result.state);
        return { success: result.changed, reason: result.reason || null };
    });

    ipcMain.handle('discovery-evidence-confirm', async (event, key) => {
        const result = discoveryEvidenceStore.confirmElement(String(key || ''));
        if (result.changed) sendToRenderer('discovery-evidence-update', result.state);
        return { success: result.changed, reason: result.reason || null };
    });

    ipcMain.handle('discovery-evidence-retract', async (event, key) => {
        const result = discoveryEvidenceStore.retractElement(String(key || ''), 'manual');
        if (result.changed) sendToRenderer('discovery-evidence-update', result.state);
        return { success: result.changed };
    });

    // Renderer asks this before deciding whether the native audio helper is
    // needed (src/utils/audioHelperPolicy.js). Returns only a boolean — the
    // key itself never leaves the main process.
    ipcMain.handle('has-deepgram-key', () => !!getDeepgramApiKey());

    ipcMain.handle('close-session', async event => {
        try {
            stopMacOSAudioCapture();
            // Phase 1g-3.7: also stop any audio-capture helper child so it
            // does not outlive the Deepgram sink that is about to be torn
            // down. Without this, the helper would keep streaming PCM into
            // a disconnected DeepgramService and the renderer would remain
            // in the suspended state until another stop path runs.
            audioCapture.stop();
            // Phase 1.A+: tear down the LLM refinement timer + state at the
            // same boundary as the audio / Deepgram cleanup so a closed
            // BYOK session cannot keep firing Gemini Flash against stale
            // transcript data.
            stopDiscoveryLLMRefiner();
            // Invalidate every in-flight async result (advice streams,
            // screen analysis) of the session being closed, and release the
            // in-flight gate so the next session is not blocked by them.
            sessionGeneration.bump();
            aiResponseInFlight = false;
            clearPendingAi();
            currentSessionId = null;
            disconnectDeepgram();
            // v0.7.8 (regression fixture L05): closing is a reset of the
            // hearing state, not just of the audio paths. Clear the turn log
            // and the 5-element evidence now — not at the next start — and
            // push the empty state to the renderer, so a late result of the
            // closed session finds nothing to resurrect and the badges read
            // empty immediately. The conversation itself was already saved
            // through save-conversation-turn.
            turnEventsStore.resetForSession();
            discoveryEvidenceStore.reset();
            sendToRenderer('discovery-evidence-update', discoveryEvidenceStore.getState());

            if (currentProviderMode === 'local' || currentProviderMode === 'trial') {
                getLocalAi().closeLocalSession();
                currentProviderMode = 'byok';
                return { success: true };
            }

            // Set flag to prevent reconnection attempts
            isUserClosing = true;
            sessionParams = null;

            // Cleanup session
            if (geminiSessionRef.current) {
                await geminiSessionRef.current.close();
                geminiSessionRef.current = null;
            }

            return { success: true };
        } catch (error) {
            console.error('Error closing session:', error);
            return { success: false, error: error.message };
        }
    });

    // Conversation history IPC handlers
    ipcMain.handle('get-current-session', async event => {
        try {
            return { success: true, data: getCurrentSessionData() };
        } catch (error) {
            console.error('Error getting current session:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('start-new-session', async event => {
        try {
            initializeNewSession();
            return { success: true, sessionId: currentSessionId };
        } catch (error) {
            console.error('Error starting new session:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('update-google-search-setting', async (event, enabled) => {
        try {
            console.log('Google Search setting updated to:', enabled);
            // The setting is already saved in localStorage by the renderer
            // This is just for logging/confirmation
            return { success: true };
        } catch (error) {
            console.error('Error updating Google Search setting:', error);
            return { success: false, error: error.message };
        }
    });
}

module.exports = {
    initializeGeminiSession,
    getEnabledTools,
    getStoredSetting,
    sendToRenderer,
    initializeNewSession,
    saveConversationTurn,
    getCurrentSessionData,
    // Dev tooling / tests only.
    getSessionGeneration,
    isAiResponseInFlight: () => aiResponseInFlight,
    killExistingSystemAudioDump,
    startMacOSAudioCapture,
    convertStereoToMono,
    stopMacOSAudioCapture,
    stopAudioCapture: audioCapture.stop,
    // Legacy alias retained for one release; index.js still references it.
    stopFfmpegLoopbackCapture: audioCapture.stop,
    sendAudioToGemini,
    sendImageToGeminiHttp,
    setupGeminiIpcHandlers,
    runDevScenario,
    DEV_SCENARIOS,
    processGenerationComplete,
    pushTurnEvent,
    formatSpeakerResults,
    // Phase 2.A — re-exported from suggestionPrompt.js for any consumer
    // that already imports from gemini.js. New tests should import
    // directly from src/utils/suggestionPrompt.
    buildSuggestionPrompt,
    resolveSuggestionProfile,
    buildEvidenceBlock,
};
