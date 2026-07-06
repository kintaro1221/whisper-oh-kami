'use strict';

const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..', '..');

function read(relPath) {
    return fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
}

// This fork targets Japanese B2B 商談. Whisper must decode Japanese audio with
// the Japanese decoder, not English. Trial mode already does this; the Ollama
// local-LLM session historically forced 'en', silently mis-transcribing JP.
describe('local Whisper language (JP fork)', () => {
    test('Ollama local session sets whisperLanguage to ja, never en', () => {
        const localai = read('src/utils/localai.js');
        const body = localai.match(/async function initializeLocalSession\([\s\S]*?\n\}/)[0];

        expect(body).toMatch(/whisperLanguage = 'ja'/);
        expect(body).not.toMatch(/whisperLanguage = 'en'/);
    });

    test('trial session also uses Japanese whisperLanguage (regression guard)', () => {
        const localai = read('src/utils/localai.js');
        const body = localai.match(/async function initializeTrialSession\([\s\S]*?\n\}/)[0];

        expect(body).toMatch(/whisperLanguage = 'ja'/);
    });
});
