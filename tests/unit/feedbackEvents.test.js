const { appendFeedbackEventToSession, createFeedbackEvent, VALID_FEEDBACK_RATINGS } = require('../../src/utils/feedbackEvents');

describe('createFeedbackEvent', () => {
    test('creates a sanitized event with whitelisted rating', () => {
        const event = createFeedbackEvent(
            {
                responseIndex: 2,
                rating: 'off_target',
                note: '  文脈がずれていた  ',
                profile: 'sales',
                evidenceSnapshot: { totalScore: 3 },
            },
            12345
        );

        expect(event).toEqual({
            timestamp: 12345,
            responseIndex: 2,
            rating: 'off_target',
            note: '文脈がずれていた',
            profile: 'sales',
            evidenceSnapshot: { totalScore: 3 },
        });
    });

    test('allows empty notes and null evidence snapshots', () => {
        const event = createFeedbackEvent({ responseIndex: 0, rating: 'helpful', note: '' }, 999);

        expect(event.note).toBe('');
        expect(event.evidenceSnapshot).toBeNull();
    });

    test('rejects ratings outside the local feedback contract', () => {
        expect(VALID_FEEDBACK_RATINGS).toEqual(['helpful', 'off_target', 'unsafe_or_risky']);
        expect(() => createFeedbackEvent({ responseIndex: 0, rating: 'other' })).toThrow(/Invalid feedback rating/);
    });
});

describe('appendFeedbackEventToSession', () => {
    test('appends feedback while preserving existing session data', () => {
        const session = {
            sessionId: '1',
            conversationHistory: [{ ai_response: 'A' }],
            feedbackEvents: [{ rating: 'helpful' }],
        };
        const event = createFeedbackEvent({ responseIndex: 1, rating: 'unsafe_or_risky', note: '断定が強い' }, 100);

        const out = appendFeedbackEventToSession(session, event);

        expect(out).toEqual({
            sessionId: '1',
            conversationHistory: [{ ai_response: 'A' }],
            feedbackEvents: [{ rating: 'helpful' }, event],
        });
        expect(session.feedbackEvents).toHaveLength(1);
    });

    test('repairs missing or malformed feedbackEvents to an array', () => {
        const event = createFeedbackEvent({ responseIndex: 0, rating: 'helpful' }, 100);

        expect(appendFeedbackEventToSession({ feedbackEvents: 'broken' }, event).feedbackEvents).toEqual([event]);
        expect(appendFeedbackEventToSession(null, event).feedbackEvents).toEqual([event]);
    });
});
