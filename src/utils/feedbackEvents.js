'use strict';

const VALID_FEEDBACK_RATINGS = ['helpful', 'off_target', 'unsafe_or_risky'];

function createFeedbackEvent(input = {}, now = Date.now()) {
    const rating = input.rating;
    if (!VALID_FEEDBACK_RATINGS.includes(rating)) {
        throw new Error(`Invalid feedback rating: ${rating}`);
    }

    const responseIndex = Number.isInteger(input.responseIndex) && input.responseIndex >= 0 ? input.responseIndex : 0;
    const note = input.note === undefined || input.note === null ? '' : String(input.note).trim();
    const profile = input.profile || null;
    const evidenceSnapshot = input.evidenceSnapshot === undefined ? null : input.evidenceSnapshot;

    return {
        timestamp: now,
        responseIndex,
        rating,
        note,
        profile,
        evidenceSnapshot,
    };
}

function appendFeedbackEventToSession(session, event) {
    const base = session && typeof session === 'object' && !Array.isArray(session) ? { ...session } : {};
    const existing = Array.isArray(base.feedbackEvents) ? base.feedbackEvents : [];
    return {
        ...base,
        feedbackEvents: [...existing, event],
    };
}

module.exports = {
    VALID_FEEDBACK_RATINGS,
    appendFeedbackEventToSession,
    createFeedbackEvent,
};
