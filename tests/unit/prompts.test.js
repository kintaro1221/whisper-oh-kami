'use strict';

// prompts.js system-prompt vocabulary contract (v0.7.5 trust gates).
// The evidence store no longer has a 'filled' status: automatic detection
// tops out at 'detected' (an unconfirmed candidate) and only the user can
// mark an element 'confirmed'. The system prompt must use the same
// vocabulary as the user-prompt evidence block (suggestionPrompt.js) so the
// model is never told that a mere candidate is already confirmed.

const { getSystemPrompt } = require('../../src/utils/prompts');

describe('system prompt uses the detected / confirmed vocabulary', () => {
    for (const profile of ['discovery', 'sales']) {
        test(`${profile}: no 'filled', mentions both confirmed and detected`, () => {
            const prompt = getSystemPrompt(profile);
            expect(prompt).not.toContain('filled');
            expect(prompt).toContain('confirmed');
            expect(prompt).toContain('detected');
        });
    }

    test('partial is not treated as already confirmed', () => {
        const prompt = getSystemPrompt('discovery');
        expect(prompt).not.toMatch(/確認済（[^）]*partial[^）]*）/);
        expect(prompt).toContain('partial は探り中として扱う');
    });
});
