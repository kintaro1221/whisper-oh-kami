// aiResponseGate.js — Phase 2.C shadow detectors (PR-β).
//
// Pure CommonJS. No Electron / Gemini / IPC / store-internal-shape deps.
// Inputs are pre-computed primitive booleans / strings; the call site
// (gemini.js#processGenerationComplete) is responsible for materializing
// those values via the existing turnEvents store API
// (hasRecentOpponentSpeech) and the existing lastDispatchedEventKind
// module variable. Keeping the detectors independent of the store's
// internal event shape means any future change to that shape — e.g.
// turnEvents.dump() growing display fields like ago_ms — can't silently
// break the gate.
//
// Phase 2.C is intentionally LOG-ONLY: production still dispatches as
// before, we only emit named `shadow_*` reasons so a couple of real
// sessions can show us how often each condition triggers. A follow-up PR
// flips the gate from log to actual skip once observation data is in.
// Matches memory feedback_shadow_first — keyword/pattern shadow →
// 運用観測 → 昇格.

'use strict';

// shadow_consecutive_self: the previous AI dispatch fired on self_finished
// AND the current event is also self_finished. Two self-turns in a row
// means the customer hasn't spoken back yet, so a second "次に聞くとよい
// こと" suggestion is mostly redundant with the first. Flagging this
// in shadow lets us see how often we're double-prompting.
function detectShadowConsecutiveSelf(currentEventKind, lastDispatchedEventKind) {
    return currentEventKind === 'self_finished' && lastDispatchedEventKind === 'self_finished';
}

// shadow_no_recent_opponent: the opponent has not spoken within the
// configured window. Caller computes the boolean via
// turnEventsStore.hasRecentOpponentSpeech(windowMs) so this detector
// stays a one-liner predicate independent of the store's internal
// event shape.
function detectShadowNoRecentOpponent(hasRecentOpponentSpeech) {
    return !hasRecentOpponentSpeech;
}

// Compose the active shadow signals into a list. Empty array means the
// dispatch looks healthy to all detectors. Adding a new detector later
// is a one-line push here plus the corresponding pure helper above —
// no shape changes to the input object are needed for current callers.
function detectShadowReasons({ currentEventKind, lastDispatchedEventKind, hasRecentOpponentSpeech }) {
    const reasons = [];
    if (detectShadowConsecutiveSelf(currentEventKind, lastDispatchedEventKind)) {
        reasons.push('shadow_consecutive_self');
    }
    if (detectShadowNoRecentOpponent(hasRecentOpponentSpeech)) {
        reasons.push('shadow_no_recent_opponent');
    }
    return reasons;
}

module.exports = {
    detectShadowConsecutiveSelf,
    detectShadowNoRecentOpponent,
    detectShadowReasons,
};
