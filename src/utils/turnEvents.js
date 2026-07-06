// turnEvents.js — Phase 1g extracted store for chronological dialogue events.
//
// Pure CommonJS module with no Electron / Gemini / IPC / Deepgram dependencies.
// gemini.js holds the only instance via `createTurnEvents(...)` so the API is
// re-injectable by tests / dev harnesses without touching the production
// orchestration. Source-selection dedup (Deepgram vs Gemini Live) lives in
// gemini.js / future deepgramOrchestrator — *not* here.
//
// Event shape:
//   { speaker: 'self' | 'opponent', text: string, source: string, timestamp: number }
//
// Backwards compatibility note: gemini.js retains the existing
// pushTurnEvent / recentTurnsForPrompt / lastTurn / lastOpponentTurnWithin /
// hasRecentOpponentSpeech function names by delegating to a single instance
// returned from createTurnEvents().

'use strict';

const DEFAULT_MAX_EVENTS = 50;
const DEFAULT_MAX_PROMPT_TURNS = 10;
const DEFAULT_OPPONENT_RECENT_WINDOW_MS = 8000;

function createTurnEvents(options = {}) {
    const maxEvents = options.maxEvents != null ? options.maxEvents : DEFAULT_MAX_EVENTS;
    const maxPromptTurns = options.maxPromptTurns != null ? options.maxPromptTurns : DEFAULT_MAX_PROMPT_TURNS;
    const opponentRecentWindowMs = options.opponentRecentWindowMs != null ? options.opponentRecentWindowMs : DEFAULT_OPPONENT_RECENT_WINDOW_MS;
    const now = options.now || (() => Date.now());

    let events = [];

    function trim() {
        if (events.length > maxEvents) events = events.slice(-maxEvents);
    }

    function pushTurnEvent(event) {
        if (!event || event.text == null) return;
        const text = String(event.text).trim();
        if (!text) return;
        events.push({
            speaker: event.speaker,
            text,
            source: event.source,
            timestamp: event.timestamp != null ? event.timestamp : now(),
        });
        trim();
    }

    function recentTurnsForPrompt(maxTurns) {
        const n = maxTurns != null ? maxTurns : maxPromptTurns;
        return events
            .slice(-n)
            .map(t => {
                const tag = t.speaker === 'self' ? '[自分]' : '[相手]';
                return `${tag} ${t.text}`;
            })
            .join('\n');
    }

    function hasRecentOpponentSpeech(windowMs) {
        const w = windowMs != null ? windowMs : opponentRecentWindowMs;
        const cutoff = now() - w;
        return events.some(t => t.speaker === 'opponent' && t.timestamp >= cutoff);
    }

    function lastTurn() {
        return events.length > 0 ? events[events.length - 1] : null;
    }

    function lastOpponentTurnWithin(windowMs) {
        const w = windowMs != null ? windowMs : opponentRecentWindowMs;
        const cutoff = now() - w;
        for (let i = events.length - 1; i >= 0; i--) {
            const t = events[i];
            if (t.speaker === 'opponent' && t.timestamp >= cutoff) return t;
        }
        return null;
    }

    function resetForSession() {
        events = [];
    }

    // Replays a fixed dev scenario by rewriting `events` from scratch. Each
    // turn gets a synthetic timestamp 1s apart, anchored so the last turn
    // lands at "now" (matches the existing dev runner heuristic at
    // gemini.js runDevScenario). Per-turn `timestamp` overrides win when
    // provided. Blank entries are skipped, just like pushTurnEvent.
    function seedForDevScenario(turns) {
        // No-op for invalid / empty inputs — preserves prior events. Production
        // callers (runDevScenario) always pass a non-empty array; protecting
        // bad inputs here means tests and stray IPC calls cannot accidentally
        // wipe an in-progress session.
        if (!Array.isArray(turns) || turns.length === 0) return;
        events = [];
        const baseTs = now() - turns.length * 1000;
        turns.forEach((turn, i) => {
            if (!turn || turn.text == null) return;
            const text = String(turn.text).trim();
            if (!text) return;
            events.push({
                speaker: turn.speaker,
                text,
                source: turn.source,
                timestamp: turn.timestamp != null ? turn.timestamp : baseTs + i * 1000,
            });
        });
        trim();
    }

    // Returns a snapshot suitable for the dev:dump-turn-events IPC. Computes
    // ago_ms relative to the injected clock so tests can pin it deterministically.
    function dump() {
        const t = now();
        return events.map(e => ({
            speaker: e.speaker,
            source: e.source,
            text: e.text,
            timestamp: e.timestamp,
            ago_ms: t - e.timestamp,
        }));
    }

    return {
        pushTurnEvent,
        recentTurnsForPrompt,
        hasRecentOpponentSpeech,
        lastTurn,
        lastOpponentTurnWithin,
        resetForSession,
        seedForDevScenario,
        dump,
        get length() {
            return events.length;
        },
        // Limits exposed for diagnostics / config introspection. Treat as read-only.
        get maxEvents() {
            return maxEvents;
        },
        get maxPromptTurns() {
            return maxPromptTurns;
        },
        get opponentRecentWindowMs() {
            return opponentRecentWindowMs;
        },
    };
}

module.exports = { createTurnEvents };
