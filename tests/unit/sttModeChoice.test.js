'use strict';

const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..', '..');

function read(relPath) {
    return fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
}

// B1-3: STT becomes a real choice.
//  - Default flips cloud -> local: a fresh, key-less install is privacy-safe by
//    default (no audio to Deepgram) and the misleading "Recommended cloud" that
//    needs an env-only key is gone.
//  - Deepgram stays as a *working* paid opt-in: a real in-app key field in BYOK
//    with explicit cross-border consent (audio leaves the device to Deepgram US).
describe('B1-3: local-default STT + working Deepgram opt-in', () => {
    test('fresh installs default to local STT, and resolution is privacy-safe', () => {
        const storage = read('src/storage.js');

        expect(storage).toMatch(/sttMode:\s*'local'/);
        expect(storage).not.toMatch(/sttMode:\s*'cloud'/);

        // Unknown/legacy values sanitize to local (safe), not cloud (sends audio).
        const getBody = storage.match(/function getSttMode\(\)[\s\S]*?\n\}/)[0];
        expect(getBody).toMatch(/:\s*'local'/);
        expect(getBody).not.toMatch(/:\s*'cloud'/);

        // VALID_STT_MODES literal stays (trialModeContract depends on it).
        expect(storage).toMatch(/VALID_STT_MODES = \['cloud', 'local'\]/);
    });

    test('STT-aware components default to local in their constructors', () => {
        expect(read('src/components/views/CustomizeView.js')).toMatch(/this\.sttMode = 'local'/);
        expect(read('src/components/app/CheatingDaddyApp.js')).toMatch(/this\.sttMode = 'local'/);
    });

    test('the Recommended tag moves to local privacy, off cloud', () => {
        const ja = read('src/i18n/ja.js');
        const en = read('src/i18n/en.js');

        expect(ja).toMatch(/'customize\.stt\.local\.tag':\s*'推奨'/);
        expect(en).toMatch(/'customize\.stt\.local\.tag':\s*'Recommended'/);
        expect(ja).not.toMatch(/'customize\.stt\.cloud\.tag':\s*'推奨'/);
        expect(en).not.toMatch(/'customize\.stt\.cloud\.tag':\s*'Recommended'/);
    });

    test('BYOK setup offers an OPTIONAL Deepgram key field with cross-border consent', () => {
        const mainView = read('src/components/views/MainView.js');
        const byok = mainView.match(/_renderByokMode\(\) \{[\s\S]*?\n    \}/)[0];

        expect(byok).toMatch(/_saveDeepgramKey/);
        expect(byok).toMatch(/_renderDeepgramKeyStatus\(\)/);
        expect(byok).toMatch(/main\.api\.deepgram_label/);
        expect(byok).toMatch(/main\.api\.deepgram_consent/);
        expect(byok).toMatch(/console\.deepgram\.com/);

        // Its own format validator, separate from the Gemini AIza check.
        expect(mainView).toMatch(/_isValidDeepgramKeyFormat\(key\)\s*\{/);
        // Optional field: an empty key must NOT warn (unlike the required Gemini key).
        expect(mainView).toMatch(/_renderDeepgramKeyStatus\(\)\s*\{[\s\S]*?if \(!key\) return ''/);
    });

    test('Deepgram key persists through a dedicated set bridge + IPC handler', () => {
        expect(read('src/utils/renderer.js')).toMatch(/async setDeepgramApiKey\(/);
        expect(read('src/index.js')).toMatch(/storage:set-deepgram-api-key/);
    });

    test('Deepgram opt-in strings exist on both i18n tables (ja/en parity)', () => {
        for (const table of [read('src/i18n/ja.js'), read('src/i18n/en.js')]) {
            expect(table).toMatch(/'main\.api\.deepgram_label'/);
            expect(table).toMatch(/'main\.api\.deepgram_get'/);
            expect(table).toMatch(/'main\.api\.deepgram_consent'/);
            expect(table).toMatch(/'main\.api\.deepgram_hint\.invalid'/);
            expect(table).toMatch(/'main\.api\.deepgram_hint\.ok'/);
        }
    });
});
