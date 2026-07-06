// Phase 1g extracted store unit tests.
//
// Pure module under test — no Electron / Gemini / IPC. The injected `now`
// callback lets tests pin clock progression deterministically without fake
// timers (avoids the SIGKILL-style timer-leak class entirely for this file).

const { createTurnEvents } = require('../../src/utils/turnEvents');

// Test clock helper: a controllable monotonic now() that we can advance.
function makeClock(start = 1_000_000_000) {
    let t = start;
    const fn = () => t;
    fn.advance = ms => {
        t += ms;
    };
    fn.set = ms => {
        t = ms;
    };
    return fn;
}

// ── pushTurnEvent / blank skip / trim ─────────────────────────────────────

describe('createTurnEvents.pushTurnEvent', () => {
    test('skips events without text', () => {
        const store = createTurnEvents();
        store.pushTurnEvent(null);
        store.pushTurnEvent(undefined);
        store.pushTurnEvent({ speaker: 'self' });
        store.pushTurnEvent({ speaker: 'self', text: '' });
        store.pushTurnEvent({ speaker: 'self', text: '   ' });
        expect(store.length).toBe(0);
    });

    test('trims surrounding whitespace from text', () => {
        const clock = makeClock();
        const store = createTurnEvents({ now: clock });
        store.pushTurnEvent({ speaker: 'self', text: '  hello world  ', source: 'deepgram' });
        const t = store.lastTurn();
        expect(t.text).toBe('hello world');
        expect(t.speaker).toBe('self');
        expect(t.source).toBe('deepgram');
        expect(t.timestamp).toBe(1_000_000_000);
    });

    test('uses provided timestamp over now()', () => {
        const clock = makeClock(2_000_000_000);
        const store = createTurnEvents({ now: clock });
        store.pushTurnEvent({ speaker: 'opponent', text: 'hi', source: 'deepgram', timestamp: 1_500_000_000 });
        expect(store.lastTurn().timestamp).toBe(1_500_000_000);
    });

    test('caps at maxEvents (default 50) — oldest dropped', () => {
        const clock = makeClock();
        const store = createTurnEvents({ now: clock });
        for (let i = 0; i < 60; i++) {
            store.pushTurnEvent({ speaker: 'self', text: `t${i}`, source: 'deepgram' });
            clock.advance(10);
        }
        expect(store.length).toBe(50);
        // oldest retained should be t10 (first 10 trimmed)
        expect(store.dump()[0].text).toBe('t10');
        expect(store.lastTurn().text).toBe('t59');
    });

    test('respects custom maxEvents', () => {
        const store = createTurnEvents({ maxEvents: 5 });
        for (let i = 0; i < 8; i++) {
            store.pushTurnEvent({ speaker: 'self', text: `t${i}`, source: 'deepgram' });
        }
        expect(store.length).toBe(5);
        expect(store.lastTurn().text).toBe('t7');
    });

    test('coerces non-string text via String() and trims', () => {
        const store = createTurnEvents();
        store.pushTurnEvent({ speaker: 'self', text: 42, source: 'deepgram' });
        expect(store.lastTurn().text).toBe('42');
    });
});

// ── recentTurnsForPrompt ──────────────────────────────────────────────────

describe('createTurnEvents.recentTurnsForPrompt', () => {
    test('formats with [自分]/[相手] tags joined by newlines', () => {
        const store = createTurnEvents();
        store.pushTurnEvent({ speaker: 'opponent', text: 'q1', source: 'deepgram' });
        store.pushTurnEvent({ speaker: 'self', text: 'a1', source: 'deepgram' });
        store.pushTurnEvent({ speaker: 'opponent', text: 'q2', source: 'deepgram' });
        const out = store.recentTurnsForPrompt();
        expect(out).toBe('[相手] q1\n[自分] a1\n[相手] q2');
    });

    test('respects maxTurns argument', () => {
        const store = createTurnEvents();
        for (let i = 0; i < 5; i++) {
            store.pushTurnEvent({ speaker: 'self', text: `t${i}`, source: 'deepgram' });
        }
        const out = store.recentTurnsForPrompt(2);
        expect(out).toBe('[自分] t3\n[自分] t4');
    });

    test('falls back to maxPromptTurns option when no arg given', () => {
        const store = createTurnEvents({ maxPromptTurns: 3 });
        for (let i = 0; i < 5; i++) {
            store.pushTurnEvent({ speaker: 'self', text: `t${i}`, source: 'deepgram' });
        }
        const out = store.recentTurnsForPrompt();
        expect(out.split('\n')).toHaveLength(3);
    });

    test('empty store returns empty string', () => {
        const store = createTurnEvents();
        expect(store.recentTurnsForPrompt()).toBe('');
    });
});

// ── recent opponent window ────────────────────────────────────────────────

describe('createTurnEvents — opponent recent window', () => {
    test('hasRecentOpponentSpeech: true when opponent within window', () => {
        const clock = makeClock();
        const store = createTurnEvents({ opponentRecentWindowMs: 8000, now: clock });
        store.pushTurnEvent({ speaker: 'opponent', text: 'hello', source: 'deepgram' });
        clock.advance(5000);
        expect(store.hasRecentOpponentSpeech()).toBe(true);
    });

    test('hasRecentOpponentSpeech: false when opponent outside window', () => {
        const clock = makeClock();
        const store = createTurnEvents({ opponentRecentWindowMs: 8000, now: clock });
        store.pushTurnEvent({ speaker: 'opponent', text: 'hello', source: 'deepgram' });
        clock.advance(9000);
        expect(store.hasRecentOpponentSpeech()).toBe(false);
    });

    test('hasRecentOpponentSpeech: false when only self spoke recently', () => {
        const clock = makeClock();
        const store = createTurnEvents({ opponentRecentWindowMs: 8000, now: clock });
        store.pushTurnEvent({ speaker: 'self', text: 'I said something', source: 'deepgram' });
        expect(store.hasRecentOpponentSpeech()).toBe(false);
    });

    test('lastOpponentTurnWithin: returns most-recent opponent within window', () => {
        const clock = makeClock();
        const store = createTurnEvents({ opponentRecentWindowMs: 8000, now: clock });
        store.pushTurnEvent({ speaker: 'opponent', text: 'old', source: 'deepgram' });
        clock.advance(2000);
        store.pushTurnEvent({ speaker: 'self', text: 'me', source: 'deepgram' });
        clock.advance(2000);
        store.pushTurnEvent({ speaker: 'opponent', text: 'new', source: 'deepgram' });
        clock.advance(1000);
        expect(store.lastOpponentTurnWithin().text).toBe('new');
    });

    test('lastOpponentTurnWithin: null when none within window', () => {
        const clock = makeClock();
        const store = createTurnEvents({ opponentRecentWindowMs: 1000, now: clock });
        store.pushTurnEvent({ speaker: 'opponent', text: 'too old', source: 'deepgram' });
        clock.advance(2000);
        expect(store.lastOpponentTurnWithin()).toBeNull();
    });

    test('explicit windowMs overrides constructor option', () => {
        const clock = makeClock();
        const store = createTurnEvents({ opponentRecentWindowMs: 8000, now: clock });
        store.pushTurnEvent({ speaker: 'opponent', text: 'q', source: 'deepgram' });
        clock.advance(3000);
        expect(store.hasRecentOpponentSpeech(2000)).toBe(false);
        expect(store.hasRecentOpponentSpeech(8000)).toBe(true);
    });
});

// ── lastTurn ───────────────────────────────────────────────────────────────

describe('createTurnEvents.lastTurn', () => {
    test('null when empty', () => {
        expect(createTurnEvents().lastTurn()).toBeNull();
    });

    test('returns the latest pushed event', () => {
        const store = createTurnEvents();
        store.pushTurnEvent({ speaker: 'self', text: 'a', source: 'deepgram' });
        store.pushTurnEvent({ speaker: 'opponent', text: 'b', source: 'deepgram' });
        expect(store.lastTurn().text).toBe('b');
        expect(store.lastTurn().speaker).toBe('opponent');
    });
});

// ── resetForSession ───────────────────────────────────────────────────────

describe('createTurnEvents.resetForSession', () => {
    test('clears all events', () => {
        const store = createTurnEvents();
        for (let i = 0; i < 3; i++) {
            store.pushTurnEvent({ speaker: 'self', text: `t${i}`, source: 'deepgram' });
        }
        store.resetForSession();
        expect(store.length).toBe(0);
        expect(store.lastTurn()).toBeNull();
        expect(store.recentTurnsForPrompt()).toBe('');
    });

    test('subsequent push works after reset', () => {
        const store = createTurnEvents();
        store.pushTurnEvent({ speaker: 'self', text: 'before', source: 'deepgram' });
        store.resetForSession();
        store.pushTurnEvent({ speaker: 'self', text: 'after', source: 'deepgram' });
        expect(store.length).toBe(1);
        expect(store.lastTurn().text).toBe('after');
    });
});

// ── seedForDevScenario ────────────────────────────────────────────────────

describe('createTurnEvents.seedForDevScenario', () => {
    test('wipes existing events then seeds', () => {
        const clock = makeClock();
        const store = createTurnEvents({ now: clock });
        store.pushTurnEvent({ speaker: 'self', text: 'pre', source: 'deepgram' });
        store.seedForDevScenario([
            { speaker: 'opponent', text: 'q', source: 'scenario' },
            { speaker: 'self', text: 'a', source: 'scenario' },
        ]);
        expect(store.length).toBe(2);
        expect(store.dump().map(e => e.text)).toEqual(['q', 'a']);
    });

    test('seeded timestamps are 1s apart, ending near now()', () => {
        const clock = makeClock(2_000_000);
        const store = createTurnEvents({ now: clock });
        store.seedForDevScenario([
            { speaker: 'opponent', text: 'q1', source: 's' },
            { speaker: 'self', text: 'a1', source: 's' },
            { speaker: 'opponent', text: 'q2', source: 's' },
        ]);
        const dumped = store.dump();
        // baseTs = now - 3*1000 = 1_997_000; then +0, +1000, +2000.
        expect(dumped[0].timestamp).toBe(1_997_000);
        expect(dumped[1].timestamp).toBe(1_998_000);
        expect(dumped[2].timestamp).toBe(1_999_000);
    });

    test('per-turn timestamp override wins', () => {
        const clock = makeClock(5_000);
        const store = createTurnEvents({ now: clock });
        store.seedForDevScenario([
            { speaker: 'opponent', text: 'q', source: 's', timestamp: 999 },
            { speaker: 'self', text: 'a', source: 's' },
        ]);
        expect(store.dump()[0].timestamp).toBe(999);
    });

    test('skips blank entries (matches pushTurnEvent contract)', () => {
        const store = createTurnEvents();
        store.seedForDevScenario([
            { speaker: 'opponent', text: '   ', source: 's' },
            { speaker: 'self', text: 'real', source: 's' },
            { speaker: 'opponent', text: '', source: 's' },
            null,
        ]);
        expect(store.length).toBe(1);
        expect(store.lastTurn().text).toBe('real');
    });

    test('seeding more than maxEvents trims to cap', () => {
        const store = createTurnEvents({ maxEvents: 4 });
        const turns = [];
        for (let i = 0; i < 10; i++) turns.push({ speaker: 'self', text: `t${i}`, source: 's' });
        store.seedForDevScenario(turns);
        expect(store.length).toBe(4);
        // last entries retained
        expect(store.dump().map(e => e.text)).toEqual(['t6', 't7', 't8', 't9']);
    });

    test('non-array argument is a no-op (does not throw)', () => {
        const store = createTurnEvents();
        store.pushTurnEvent({ speaker: 'self', text: 'before', source: 's' });
        expect(() => store.seedForDevScenario(null)).not.toThrow();
        expect(() => store.seedForDevScenario(undefined)).not.toThrow();
        expect(() => store.seedForDevScenario('hello')).not.toThrow();
        // empty array is no-op too — and per contract we wipe events first.
        store.seedForDevScenario([]);
        expect(store.length).toBe(1); // wipe is skipped on empty input
    });
});

// ── dump ──────────────────────────────────────────────────────────────────

describe('createTurnEvents.dump', () => {
    test('returns shape with ago_ms relative to injected clock', () => {
        const clock = makeClock(10_000);
        const store = createTurnEvents({ now: clock });
        store.pushTurnEvent({ speaker: 'opponent', text: 'q', source: 'deepgram' });
        clock.advance(2500);
        const out = store.dump();
        expect(out).toHaveLength(1);
        expect(out[0]).toEqual({
            speaker: 'opponent',
            source: 'deepgram',
            text: 'q',
            timestamp: 10_000,
            ago_ms: 2500,
        });
    });

    test('returns a fresh array — internal events not aliased', () => {
        const store = createTurnEvents();
        store.pushTurnEvent({ speaker: 'self', text: 'a', source: 's' });
        const out = store.dump();
        out.push({ speaker: 'self', text: 'injected', source: 's', timestamp: 0, ago_ms: 0 });
        expect(store.length).toBe(1);
        expect(store.dump()).toHaveLength(1);
    });
});

// ── option introspection ──────────────────────────────────────────────────

describe('createTurnEvents — option getters', () => {
    test('exposes maxEvents / maxPromptTurns / opponentRecentWindowMs', () => {
        const store = createTurnEvents({
            maxEvents: 7,
            maxPromptTurns: 3,
            opponentRecentWindowMs: 4000,
        });
        expect(store.maxEvents).toBe(7);
        expect(store.maxPromptTurns).toBe(3);
        expect(store.opponentRecentWindowMs).toBe(4000);
    });

    test('default option values when none provided', () => {
        const store = createTurnEvents();
        expect(store.maxEvents).toBe(50);
        expect(store.maxPromptTurns).toBe(10);
        expect(store.opponentRecentWindowMs).toBe(8000);
    });
});
