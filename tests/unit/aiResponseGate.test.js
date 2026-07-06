// aiResponseGate.js unit tests — Phase 2.C (PR-β) shadow detectors.
//
// Phase 2.C is shadow-only: these tests pin the boolean contracts for
// each detector and the composer that aggregates them into a reason
// list. Production wiring in gemini.js#processGenerationComplete is
// expected to log the composer's output without gating; the follow-up
// PR that flips shadow → skip will rely on these contracts staying
// stable, so freezing them now is the point.

const { detectShadowConsecutiveSelf, detectShadowNoRecentOpponent, detectShadowReasons } = require('../../src/utils/aiResponseGate');

// ── detectShadowConsecutiveSelf ──────────────────────────────────────────

describe('detectShadowConsecutiveSelf', () => {
    test('self_finished after a previous self_finished dispatch → true', () => {
        expect(detectShadowConsecutiveSelf('self_finished', 'self_finished')).toBe(true);
    });

    test('first self_finished of the session (no previous dispatch) → false', () => {
        expect(detectShadowConsecutiveSelf('self_finished', null)).toBe(false);
        expect(detectShadowConsecutiveSelf('self_finished', undefined)).toBe(false);
    });

    test('self_finished after opponent_finished → false (customer just spoke)', () => {
        expect(detectShadowConsecutiveSelf('self_finished', 'opponent_finished')).toBe(false);
    });

    test('opponent_finished is never consecutive-self (regardless of previous)', () => {
        expect(detectShadowConsecutiveSelf('opponent_finished', 'self_finished')).toBe(false);
        expect(detectShadowConsecutiveSelf('opponent_finished', 'opponent_finished')).toBe(false);
        expect(detectShadowConsecutiveSelf('opponent_finished', null)).toBe(false);
    });

    test('idle / unknown event kinds → false (whitelist semantics)', () => {
        expect(detectShadowConsecutiveSelf('idle', 'self_finished')).toBe(false);
        expect(detectShadowConsecutiveSelf('self_finished', 'idle')).toBe(false);
        expect(detectShadowConsecutiveSelf(null, null)).toBe(false);
    });

    test('cross-session reset contract: after initializeNewSession sets lastDispatchedEventKind=null, the first self_finished of the new session is NOT consecutive_self', () => {
        // Paired contract with gemini.js#initializeNewSession, which sets
        // lastDispatchedEventKind = null on every session start. Without
        // that reset, the module-scope variable would carry over from the
        // previous session — and if that session happened to end on
        // self_finished, the first dispatch of the new session would be
        // mis-flagged as consecutive_self and pollute the shadow
        // observation data. This test pins the predicate side of that
        // contract so a regression on either side surfaces immediately.
        expect(detectShadowConsecutiveSelf('self_finished', null)).toBe(false);
        const reasons = detectShadowReasons({
            currentEventKind: 'self_finished',
            lastDispatchedEventKind: null,
            hasRecentOpponentSpeech: true,
        });
        expect(reasons).not.toContain('shadow_consecutive_self');
    });
});

// ── detectShadowNoRecentOpponent ─────────────────────────────────────────

describe('detectShadowNoRecentOpponent', () => {
    test('opponent has spoken in window → false (no shadow)', () => {
        expect(detectShadowNoRecentOpponent(true)).toBe(false);
    });

    test('opponent has NOT spoken in window → true (shadow fires)', () => {
        expect(detectShadowNoRecentOpponent(false)).toBe(true);
    });

    test('defensive on non-boolean input: any falsy → true, any truthy → false', () => {
        // Designed so the call site can hand off whatever
        // turnEventsStore.hasRecentOpponentSpeech() returns without
        // wrapping it in Boolean(). The contract is "shadow fires unless
        // we have proof the opponent spoke recently".
        expect(detectShadowNoRecentOpponent(undefined)).toBe(true);
        expect(detectShadowNoRecentOpponent(null)).toBe(true);
        expect(detectShadowNoRecentOpponent(0)).toBe(true);
        expect(detectShadowNoRecentOpponent('')).toBe(true);
        expect(detectShadowNoRecentOpponent(1)).toBe(false);
        expect(detectShadowNoRecentOpponent('yes')).toBe(false);
    });
});

// ── detectShadowReasons (composer) ───────────────────────────────────────

describe('detectShadowReasons', () => {
    test('healthy dispatch (opponent_finished, opponent spoke recently) → []', () => {
        const reasons = detectShadowReasons({
            currentEventKind: 'opponent_finished',
            lastDispatchedEventKind: 'opponent_finished',
            hasRecentOpponentSpeech: true,
        });
        expect(reasons).toEqual([]);
    });

    test('consecutive self only → ["shadow_consecutive_self"]', () => {
        const reasons = detectShadowReasons({
            currentEventKind: 'self_finished',
            lastDispatchedEventKind: 'self_finished',
            hasRecentOpponentSpeech: true, // opponent spoke at some point in window
        });
        expect(reasons).toEqual(['shadow_consecutive_self']);
    });

    test('no recent opponent only → ["shadow_no_recent_opponent"]', () => {
        const reasons = detectShadowReasons({
            currentEventKind: 'opponent_finished',
            lastDispatchedEventKind: 'opponent_finished',
            hasRecentOpponentSpeech: false,
        });
        expect(reasons).toEqual(['shadow_no_recent_opponent']);
    });

    test('both conditions fire → reasons appear in detector order', () => {
        // Order is the same as the composer's internal check sequence so
        // log greps can rely on it. shadow_consecutive_self comes first.
        const reasons = detectShadowReasons({
            currentEventKind: 'self_finished',
            lastDispatchedEventKind: 'self_finished',
            hasRecentOpponentSpeech: false,
        });
        expect(reasons).toEqual(['shadow_consecutive_self', 'shadow_no_recent_opponent']);
    });

    test('first dispatch of the session (lastDispatchedEventKind = null) without opponent yet → no_recent_opponent only', () => {
        // Edge case at session start: nothing has dispatched yet AND no
        // opponent turn has been seen. consecutive_self can't fire (no
        // previous), but no_recent_opponent does — which is the right
        // signal (we'd be answering ourselves into a void).
        const reasons = detectShadowReasons({
            currentEventKind: 'self_finished',
            lastDispatchedEventKind: null,
            hasRecentOpponentSpeech: false,
        });
        expect(reasons).toEqual(['shadow_no_recent_opponent']);
    });
});
