'use strict';
const fs = require('fs');
const path = require('path');
const read = rel => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');

describe('KeyWizard component contract', () => {
    const src = read('src/components/views/KeyWizard.js');
    test('registers <key-wizard>', () => {
        expect(src).toMatch(/customElements\.define\('key-wizard'/);
    });
    test('guides Gemini (required) and Deepgram (optional/skippable)', () => {
        expect(src).toMatch(/wizard\.gemini\.title/);
        expect(src).toMatch(/wizard\.deepgram\.title/);
        expect(src).toMatch(/wizard\.skip/);
    });
    test('uses live verification (dynamic, both providers) and format gate', () => {
        // The component calls verification dynamically: keyVerify[provider](value)
        expect(src).toMatch(/whisperOhKami\.keyVerify\[provider\]/);
        // …and wires BOTH providers through _onInput, so both endpoints are reachable.
        expect(src).toMatch(/_onInput\('gemini'/);
        expect(src).toMatch(/_onInput\('deepgram'/);
        // Format gate uses the shared validators for both providers.
        expect(src).toMatch(/WhisperKeyFormat\.isValidGeminiKeyFormat/);
        expect(src).toMatch(/WhisperKeyFormat\.isValidDeepgramKeyFormat/);
    });
    test('emits key-entered and wizard-close', () => {
        expect(src).toMatch(/key-entered/);
        expect(src).toMatch(/wizard-close/);
    });
    test('opens external links via the injected handler (no raw window.open)', () => {
        expect(src).toMatch(/this\.onExternalLink/);
        expect(src).not.toMatch(/window\.open\(/);
    });
});

describe('MainView integrates the wizard (hybrid C)', () => {
    const mv = read('src/components/views/MainView.js');
    test('imports and renders <key-wizard>', () => {
        expect(mv).toMatch(/import \{ KeyWizard \} from '\.\/KeyWizard\.js'/);
        expect(mv).toMatch(/<key-wizard/);
    });
    test('byok mode exposes the guide entry button + keeps direct fields', () => {
        const byok = mv.match(/_renderByokMode\(\) \{[\s\S]*?\n    \}/)[0];
        expect(byok).toMatch(/wizard\.entry_button/);
        expect(byok).toMatch(/_openWizard|_wizardOpen\s*=\s*true/);
        expect(byok).toMatch(/_renderGeminiKeyStatus\(\)/); // direct fields still present
    });
    test('wizard key-entered routes to existing savers', () => {
        expect(mv).toMatch(/_onWizardKeyEntered/);
        expect(mv).toMatch(/_saveGeminiKey/);
        expect(mv).toMatch(/_saveDeepgramKey/);
    });
});

describe('trial → byok conversion CTA (opens wizard)', () => {
    const mv = read('src/components/views/MainView.js');
    test('trial mode renders the go_byok CTA bound to the switch+wizard handler', () => {
        const trial = mv.match(/_renderTrialMode\(\) \{[\s\S]*?\n    \}/)[0];
        expect(trial).toMatch(/main\.trial\.go_byok/);
        expect(trial).toMatch(/_switchToByokWithWizard/);
    });
    test('the handler switches to byok AND opens the wizard', () => {
        const m = mv.match(/_switchToByokWithWizard\(\)\s*\{[\s\S]*?\n    \}/)[0];
        expect(m).toMatch(/_saveMode\('byok'\)/);
        expect(m).toMatch(/_wizardOpen\s*=\s*true/);
    });
});
