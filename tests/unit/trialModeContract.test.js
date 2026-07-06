'use strict';

const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..', '..');

function read(relPath) {
    return fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
}

describe('trial provider contract', () => {
    test('new installs default to the keyless trial path and fastest Whisper model', () => {
        const storage = read('src/storage.js');

        expect(storage).toMatch(/providerMode:\s*'trial'/);
        expect(storage).toMatch(/whisperModel:\s*'Xenova\/whisper-tiny'/);
    });

    test('MainView exposes trial as the first mode and does not require keys to start it', () => {
        const mainView = read('src/components/views/MainView.js');

        expect(mainView).toMatch(/this\._mode\s*=\s*'trial'/);
        expect(mainView.indexOf('_renderTrialMode()')).toBeGreaterThanOrEqual(0);
        expect(mainView.indexOf('_renderTrialMode()')).toBeLessThan(mainView.indexOf('_renderByokMode()'));
        expect(mainView).toMatch(/_mode === 'trial'[\s\S]*this\.onStart\(\)/);
    });

    test('app start routes trial around BYOK and Ollama gates', () => {
        const app = read('src/components/app/CheatingDaddyApp.js');

        expect(app).toMatch(/providerMode === 'trial'/);
        expect(app).toMatch(/prefs\.providerMode \|\| 'trial'/);
        expect(app).toMatch(/initializeTrial\(this\.selectedProfile\)/);
        expect(app).toMatch(/startTrialCapture\(/);
        expect(app).not.toMatch(/providerMode === 'trial'[\s\S]{0,300}getApiKey/);
        expect(app).not.toMatch(/providerMode === 'trial'[\s\S]{0,300}initializeLocal/);
    });

    test('local whisper trial uses CPU and avoids Ollama response generation', () => {
        const localai = read('src/utils/localai.js');

        expect(localai).toMatch(/device:\s*'cpu'/);
        expect(localai).toMatch(/initializeTrialSession/);
        expect(localai).toMatch(/pushTurnEvent\(\{\s*speaker:\s*'opponent'[\s\S]*source:\s*'trial_self_whisper'/);
        expect(localai).toMatch(/localSessionMode === 'trial'[\s\S]*return;/);
    });

    test('renderer exposes mic-only trial capture and main IPC exposes initialize-trial', () => {
        const renderer = read('src/utils/renderer.js');
        const gemini = read('src/utils/gemini.js');

        expect(renderer).toMatch(/async function initializeTrial/);
        expect(renderer).toMatch(/async function startTrialCapture/);
        expect(renderer).toMatch(/startTrialCapture[\s\S]*getUserMedia/);
        expect(renderer).not.toMatch(/startTrialCapture[\s\S]{0,500}startDeepgram/);
        expect(gemini).toMatch(/ipcMain\.handle\('initialize-trial'/);
        expect(gemini).toMatch(/currentProviderMode = 'trial'/);
        expect(gemini).toMatch(/currentProviderMode === 'trial'[\s\S]*processLocalAudio/);
    });

    test('BYOK setup shows Gemini only while preserving hidden Groq storage support', () => {
        const mainView = read('src/components/views/MainView.js');
        const byokRender = mainView.match(/_renderByokMode\(\) \{[\s\S]*?\n    \}/)[0];
        const storage = read('src/storage.js');

        expect(byokRender).toMatch(/main\.api\.gemini_label/);
        expect(byokRender).toMatch(/_saveGeminiKey/);
        expect(byokRender).toMatch(/_renderStartButton/);
        expect(byokRender).not.toMatch(/main\.api\.groq_label|main\.api\.groq_get|_groqKey|_saveGroqKey|console\.groq\.com/);
        expect(mainView).toMatch(/async _saveGroqKey/);
        expect(storage).toMatch(/getGroqApiKey/);
        expect(storage).toMatch(/setGroqApiKey/);
    });

    test('cloud provider mode is fully removed (R3), STT cloud + sanitize preserved', () => {
        const gemini = read('src/utils/gemini.js');
        const renderer = read('src/utils/renderer.js');
        const app = read('src/components/app/CheatingDaddyApp.js');
        const storage = read('src/storage.js');

        // The dead WebSocket cloud provider (api.cheatingdaddy.com) is gone.
        expect(fs.existsSync(path.join(repoRoot, 'src/utils/cloud.js'))).toBe(false);
        expect(gemini).not.toMatch(/require\('\.\/cloud'\)/);
        expect(gemini).not.toMatch(/currentProviderMode === 'cloud'/);
        expect(gemini).not.toMatch(/initialize-cloud|sendCloudAudio|connectCloud|closeCloud|sendCloudText|sendCloudImage/);
        expect(renderer).not.toMatch(/initialize-cloud|async function initializeCloud/);
        expect(app).not.toMatch(/initializeCloud\(/);

        // STT 'cloud' (Deepgram, a different concept) and the cloud->byok
        // provider-mode sanitize must stay.
        expect(storage).toMatch(/VALID_STT_MODES = \['cloud', 'local'\]/);
        expect(app).toMatch(/providerMode === 'cloud' \? 'byok'/);
    });

    test('BYOK key has a single-source format validator wired to live feedback (B1-1)', () => {
        const mainView = read('src/components/views/MainView.js');
        const ja = read('src/i18n/ja.js');
        const en = read('src/i18n/en.js');

        // Single regex source now lives in keyFormat.js; MainView delegates to it.
        const keyFormat = read('src/utils/keyFormat.js');
        expect((keyFormat.match(/\/\^AIza\[0-9A-Za-z_-\]\{30,\}\$\//g) || []).length).toBe(1);
        expect(mainView).toMatch(/_isValidGeminiKeyFormat\(key\)\s*\{/);
        expect(mainView).toMatch(/window\.WhisperKeyFormat\.isValidGeminiKeyFormat/);
        expect(mainView).toMatch(/_isValidGeminiKeyFormat\(this\._geminiKey\)/); // start guard uses it

        // The BYOK render shows live key status, backed by i18n (ja/en parity).
        const byokRender = mainView.match(/_renderByokMode\(\) \{[\s\S]*?\n    \}/)[0];
        expect(byokRender).toMatch(/_renderGeminiKeyStatus\(\)/);
        for (const table of [ja, en]) {
            expect(table).toMatch(/'main\.api\.key_hint\.invalid'/);
            expect(table).toMatch(/'main\.api\.key_hint\.ok'/);
        }
    });

    test('onboarding offers a provider-mode choice that persists to providerMode (B1-2)', () => {
        const onboarding = read('src/components/views/OnboardingView.js');
        const ja = read('src/i18n/ja.js');
        const en = read('src/i18n/en.js');

        // Mode-select step renders the three modes and persists the choice.
        expect(onboarding).toMatch(/_selectMode\(mode\)\s*\{[\s\S]*?updatePreference\('providerMode', mode\)/);
        expect(onboarding).toMatch(/this\.currentSlide === 1/);
        expect(onboarding).toMatch(/this\._selectMode\(m\.mode\)/);
        for (const m of ['trial', 'byok', 'local']) {
            expect(onboarding).toMatch(new RegExp(`mode: '${m}'`));
        }
        // Backed by i18n on both tables.
        for (const table of [ja, en]) {
            expect(table).toMatch(/'onboarding\.mode\.title'/);
            expect(table).toMatch(/'onboarding\.mode\.byok\.label'/);
            expect(table).toMatch(/'onboarding\.slide2\.skip_note'/);
        }
    });
});
