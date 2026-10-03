'use strict';

// v0.7.5 mode gating: byok / local are 検証中. handleStart must show the
// constraint modal (second RecordingConsentGate instance) before any provider
// init or capture, and "お試しモードに戻る" must switch the saved mode to trial
// and abort the start. CheatingDaddyApp is a Lit ESM component that cannot be
// imported under the node test env, so the real handleStart body is extracted
// from source and run against a fake `whisperOhKami` + `this`.

const fs = require('fs');
const path = require('path');
const { RecordingConsentGate } = require('../../src/utils/recordingConsentGate');

const appSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'src/components/app/CheatingDaddyApp.js'), 'utf8');

function extractMethodBody(src, signature, nextSignature) {
    const start = src.indexOf(signature);
    const end = src.indexOf(nextSignature, start);
    if (start < 0 || end < 0) throw new Error(`cannot locate ${signature}`);
    const chunk = src.slice(start + signature.length, end);
    return chunk.slice(0, chunk.lastIndexOf('}'));
}

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const handleStartBody = extractMethodBody(appSrc, 'async handleStart() {', 'async handleAPIKeyHelp()');
const confirmExperimentalBody = extractMethodBody(appSrc, 'async confirmExperimentalMode(mode) {', '_acceptExperimental() {');

function makeHarness(providerMode) {
    const calls = [];
    const mainView = { _mode: providerMode, _keyError: true, triggerApiKeyError: () => calls.push('triggerApiKeyError') };
    const whisperOhKami = {
        storage: {
            getPreferences: async () => ({ providerMode, micDeviceId: '' }),
            updatePreference: async (k, v) => calls.push(`updatePreference:${k}=${v}`),
            getApiKey: async () => 'AIzaFAKE',
        },
        initializeTrial: async () => (calls.push('initializeTrial'), true),
        initializeLocal: async () => (calls.push('initializeLocal'), true),
        initializeGemini: async () => calls.push('initializeGemini'),
        startTrialCapture: () => calls.push('startTrialCapture'),
        startCapture: () => calls.push('startCapture'),
    };
    const app = {
        shadowRoot: { querySelector: sel => (sel === 'main-view' ? mainView : null) },
        _experimentalGate: new RecordingConsentGate(),
        _experimentalOpen: false,
        _experimentalMode: null,
        confirmRecordingConsent: async () => true,
        requestUpdate: () => {},
        _startTimer: () => calls.push('_startTimer'),
    };
    app.confirmExperimentalMode = new AsyncFunction('mode', confirmExperimentalBody).bind(app);
    const handleStart = new AsyncFunction('whisperOhKami', handleStartBody).bind(app, whisperOhKami);
    return { app, calls, mainView, handleStart };
}

const flush = () => new Promise(r => setImmediate(r));

describe('handleStart experimental-mode gate (byok / local)', () => {
    for (const mode of ['byok', 'local']) {
        test(`${mode}: back-to-trial writes providerMode=trial and starts nothing`, async () => {
            const h = makeHarness(mode);
            const done = h.handleStart();
            await flush();
            expect(h.app._experimentalOpen).toBe(true);
            expect(h.app._experimentalMode).toBe(mode);
            expect(h.calls).toEqual([]); // nothing ran while the modal is showing
            h.app._experimentalGate.cancel();
            await done;
            expect(h.calls).toEqual(['updatePreference:providerMode=trial']);
            expect(h.mainView._mode).toBe('trial');
            expect(h.app.sessionActive).toBeUndefined();
        });

        test(`${mode}: accepting proceeds to init + capture`, async () => {
            const h = makeHarness(mode);
            const done = h.handleStart();
            await flush();
            h.app._experimentalGate.accept();
            await done;
            expect(h.calls).toContain(mode === 'local' ? 'initializeLocal' : 'initializeGemini');
            expect(h.calls).toContain('startCapture');
            expect(h.calls.some(c => c.startsWith('updatePreference'))).toBe(false);
            expect(h.app.sessionActive).toBe(true);
        });
    }

    test("legacy 'cloud' is gated as byok", async () => {
        const h = makeHarness('cloud');
        const done = h.handleStart();
        await flush();
        expect(h.app._experimentalMode).toBe('byok');
        h.app._experimentalGate.cancel();
        await done;
    });

    test('trial never opens the modal', async () => {
        const h = makeHarness('trial');
        await h.handleStart();
        expect(h.app._experimentalOpen).toBe(false);
        expect(h.app._experimentalGate.isOpen).toBe(false);
        expect(h.calls).toEqual(['initializeTrial', 'startTrialCapture', '_startTimer']);
    });

    test('modal focuses the primary button on open and Escape goes back to trial', () => {
        expect(appSrc).toMatch(
            /has\('_experimentalOpen'\) && this\._experimentalOpen[\s\S]{0,400}\.experimental-overlay \.consent-btn-primary[\s\S]{0,80}\.focus\(\)/
        );
        const keydown = extractMethodBody(appSrc, '_handleExperimentalKeydown(e) {', 'async handleStart() {');
        expect(keydown).toMatch(/Escape/);
        expect(keydown).toMatch(/this\._cancelExperimental\(\)/);
        expect(appSrc).not.toMatch(/experimental[\s\S]{0,40}(dont_show|don't show|skip_next)/i);
    });
});

describe('handleStart re-entry guard (v0.7.5 final review)', () => {
    test('a second concurrent handleStart returns without a second consent / init', async () => {
        const h = makeHarness('byok');
        let consentCalls = 0;
        h.app.confirmRecordingConsent = async () => (consentCalls++, true);
        const first = h.handleStart();
        const second = h.handleStart();
        await second;
        await flush();
        expect(consentCalls).toBe(1);
        expect(h.app._experimentalOpen).toBe(true);
        h.app._experimentalGate.accept();
        await first;
        expect(h.calls.filter(c => c === 'initializeGemini')).toHaveLength(1);
        expect(h.calls.filter(c => c === 'startCapture')).toHaveLength(1);
        expect(h.app._startInFlight).toBe(false);
    });

    test('the guard is released after a cancelled start so the next press works', async () => {
        const h = makeHarness('local');
        const first = h.handleStart();
        await flush();
        h.app._experimentalGate.cancel();
        await first;
        expect(h.app._startInFlight).toBe(false);
        const again = h.handleStart();
        await flush();
        expect(h.app._experimentalOpen).toBe(true);
        h.app._experimentalGate.accept();
        await again;
        expect(h.calls).toContain('initializeLocal');
    });

    test('back-to-trial goes through MainView._saveMode when it exists', async () => {
        const h = makeHarness('byok');
        const saved = [];
        h.mainView._saveMode = async mode => {
            saved.push(mode);
            h.mainView._mode = mode;
        };
        const done = h.handleStart();
        await flush();
        h.app._experimentalGate.cancel();
        await done;
        expect(saved).toEqual(['trial']);
        expect(h.mainView._mode).toBe('trial');
        expect(h.calls.filter(c => c.startsWith('updatePreference'))).toHaveLength(0);
    });
});
