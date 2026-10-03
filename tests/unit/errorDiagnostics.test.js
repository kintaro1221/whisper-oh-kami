const {
    DIAGNOSTIC_CODES,
    createDiagnostic,
    classifyByokKey,
    classifyGeminiInitFailure,
    classifyOllamaFailure,
    classifyWhisperFailure,
    classifyAudioHelperFailure,
    classifyDeepgramStatus,
} = require('../../src/utils/errorDiagnostics');
const ja = require('../../src/i18n/ja');
const en = require('../../src/i18n/en');

describe('errorDiagnostics classification', () => {
    test('classifies missing and malformed BYOK keys before provider startup', () => {
        expect(classifyByokKey('')).toMatchObject({ code: 'byok_missing_key' });
        expect(classifyByokKey('not-a-google-api-key')).toMatchObject({ code: 'byok_invalid_format' });
        expect(classifyByokKey('AIzaSyA12345678901234567890123456789012345')).toBeNull();
    });

    test('classifies Gemini initialization errors into auth vs network', () => {
        expect(classifyGeminiInitFailure('API key not valid. 403 Permission denied')).toMatchObject({ code: 'gemini_auth_failed' });
        expect(classifyGeminiInitFailure('fetch failed: ECONNRESET')).toMatchObject({ code: 'gemini_network_failed' });
    });

    test('classifies Ollama, Whisper, Deepgram, and WASAPI helper failures', () => {
        expect(classifyOllamaFailure('connect ECONNREFUSED 127.0.0.1:11434')).toMatchObject({ code: 'ollama_unavailable' });
        expect(classifyWhisperFailure('ENOSPC: no space left on device')).toMatchObject({ code: 'whisper_download_disk_failed' });
        expect(classifyWhisperFailure('fetch failed while downloading model')).toMatchObject({ code: 'whisper_download_network_failed' });
        expect(classifyDeepgramStatus('reconnecting', 'attempt 2/5')).toMatchObject({ code: 'deepgram_reconnecting' });
        expect(classifyDeepgramStatus('error', 'websocket closed')).toMatchObject({ code: 'deepgram_disconnected' });
        expect(classifyAudioHelperFailure({ ok: false, error: 'native helper binary not found' })).toMatchObject({ code: 'audio_helper_failed' });
    });

    test('audio_helper_failed states the impact (Deepgram → Gemini Live fallback) and the remedy in both locales', () => {
        const d = createDiagnostic('audio_helper_failed');
        expect(ja[d.causeKey]).toMatch(/Deepgram/);
        expect(ja[d.causeKey]).toMatch(/Gemini Live/);
        expect(ja[d.actionKey]).toMatch(/再起動/);
        expect(ja[d.actionKey]).toContain(ja['customize.stt.local.title']);
        expect(en[d.causeKey]).toMatch(/Deepgram/);
        expect(en[d.causeKey]).toMatch(/Gemini Live/);
        expect(en[d.actionKey]).toMatch(/[Rr]estart/);
        expect(en[d.actionKey]).toContain(en['customize.stt.local.title']);
    });

    test('every diagnostic code has Japanese and English title/cause/action strings', () => {
        for (const code of DIAGNOSTIC_CODES) {
            const diagnostic = createDiagnostic({ code });
            expect(ja[diagnostic.titleKey]).toEqual(expect.any(String));
            expect(ja[diagnostic.causeKey]).toEqual(expect.any(String));
            expect(ja[diagnostic.actionKey]).toEqual(expect.any(String));
            expect(en[diagnostic.titleKey]).toEqual(expect.any(String));
            expect(en[diagnostic.causeKey]).toEqual(expect.any(String));
            expect(en[diagnostic.actionKey]).toEqual(expect.any(String));
        }
    });
});
