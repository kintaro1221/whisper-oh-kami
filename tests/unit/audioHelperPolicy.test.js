const { shouldStartAudioHelper, describeAudioHelperRole } = require('../../src/utils/audioHelperPolicy');

const base = { providerMode: 'byok', sttMode: 'cloud', hasDeepgramKey: true, systemDeviceId: 'auto', audioMode: 'speaker_only' };

describe('shouldStartAudioHelper', () => {
    test.each([
        ['byok + cloud + key + auto → start', base, true],
        ['byok + cloud + key + both → start', { ...base, audioMode: 'both' }, true],
        ['default byok (sttMode local) → not needed', { ...base, sttMode: 'local' }, false],
        ['no Deepgram key → not needed', { ...base, hasDeepgramKey: false }, false],
        ['trial → never', { ...base, providerMode: 'trial' }, false],
        ['local (Ollama) → never, even with a leftover key', { ...base, providerMode: 'local' }, false],
        ['explicit loopback device → renderer worklet handles it', { ...base, systemDeviceId: 'dev-1' }, false],
        ['system audio none → not needed', { ...base, systemDeviceId: 'none' }, false],
        ['mic only → no system capture', { ...base, audioMode: 'mic_only' }, false],
        ['missing prefs → not needed', undefined, false],
    ])('%s', (_n, prefs, expected) => {
        expect(shouldStartAudioHelper(prefs)).toBe(expected);
    });
});

describe('describeAudioHelperRole', () => {
    test('names the Deepgram system-side role only when the helper is needed', () => {
        expect(describeAudioHelperRole(base)).toBe('deepgram_system');
        expect(describeAudioHelperRole({ ...base, sttMode: 'local' })).toBe('not_needed');
        expect(describeAudioHelperRole({ ...base, providerMode: 'trial' })).toBe('not_needed');
    });
});

describe('wiring contract', () => {
    const fs = require('fs');
    const path = require('path');
    const read = rel => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');

    test('renderer starts the helper only through the policy, and Deepgram capture only for byok + cloud', () => {
        const renderer = read('src/utils/renderer.js');
        expect(renderer).toMatch(
            /if \(helperPolicy && helperPolicy\.shouldStartAudioHelper\(helperPrefs\)\) \{\s*ipcRenderer\s*\.invoke\('start-audio-capture'\)/
        );
        // A missing policy script is treated as "helper not needed", never a crash.
        expect(renderer).toMatch(/const helperPolicy = window\.audioHelperPolicy;/);
        expect(renderer).not.toMatch(/if \(window\.audioHelperPolicy\.shouldStartAudioHelper/);
        expect(renderer).not.toMatch(/effectiveSystemDeviceId === 'auto' && audioMode !== 'mic_only'/);
        expect(renderer).toMatch(/const deepgramCaptureEnabled = helperPrefs\.providerMode === 'byok' && helperPrefs\.sttMode === 'cloud';/);
        expect(renderer).toMatch(
            /if \(deepgramCaptureEnabled\) \{[\s\S]{0,400}startDeepgramMicCapture\(effectiveMicDeviceId\);[\s\S]{0,400}startDeepgramSystemCapture\(effectiveSystemDeviceId\);\s*\}/
        );
        expect(read('src/index.html')).toMatch(
            /<script src="utils\/audioHelperPolicy\.js"><\/script>[\s\S]*<script src="utils\/renderer\.js"><\/script>/
        );
    });

    test('main process never connects Deepgram outside byok and exposes only a has-key boolean', () => {
        const gemini = read('src/utils/gemini.js');
        expect(gemini).toMatch(/function ensureDeepgramConnected\(\) \{[\s\S]{0,200}if \(currentProviderMode !== 'byok'\) return false;/);
        expect(gemini).toMatch(/function ensureDeepgramSystemConnected\(\) \{[\s\S]{0,200}if \(currentProviderMode !== 'byok'\) return false;/);
        expect(gemini).toMatch(/ipcMain\.handle\('has-deepgram-key', \(\) => !!getDeepgramApiKey\(\)\)/);
    });
});
