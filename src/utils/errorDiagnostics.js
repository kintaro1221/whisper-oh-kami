const DIAGNOSTIC_CODES = [
    'byok_missing_key',
    'byok_invalid_format',
    'gemini_auth_failed',
    'gemini_network_failed',
    'ollama_unavailable',
    'whisper_download_network_failed',
    'whisper_download_disk_failed',
    'deepgram_reconnecting',
    'deepgram_disconnected',
    'audio_helper_failed',
];

const ACTION_URLS = {
    byok_missing_key: 'https://aistudio.google.com/apikey',
    byok_invalid_format: 'https://aistudio.google.com/apikey',
    gemini_auth_failed: 'https://aistudio.google.com/apikey',
    ollama_unavailable: 'https://ollama.com/download',
};

function normalizeMessage(message) {
    if (message == null) return '';
    if (typeof message === 'string') return message;
    if (message && typeof message.message === 'string') return message.message;
    return String(message);
}

function createDiagnostic(input) {
    const code = typeof input === 'string' ? input : input && input.code;
    const safeCode = DIAGNOSTIC_CODES.includes(code) ? code : 'gemini_network_failed';
    const detail = typeof input === 'object' && input ? input.detail || input.message || '' : '';
    return {
        code: safeCode,
        titleKey: `diagnostic.${safeCode}.title`,
        causeKey: `diagnostic.${safeCode}.cause`,
        actionKey: `diagnostic.${safeCode}.action`,
        detail: normalizeMessage(detail),
        actionUrl: ACTION_URLS[safeCode] || '',
    };
}

function classifyByokKey(apiKey) {
    const key = (apiKey || '').trim();
    if (!key) return createDiagnostic('byok_missing_key');
    if (!/^AIza[0-9A-Za-z_-]{30,}$/.test(key)) return createDiagnostic('byok_invalid_format');
    return null;
}

function classifyGeminiInitFailure(message) {
    const text = normalizeMessage(message);
    const lower = text.toLowerCase();
    if (/401|403|api key|apikey|unauthori[sz]ed|permission|forbidden|invalid key|not valid/.test(lower)) {
        return createDiagnostic({ code: 'gemini_auth_failed', detail: text });
    }
    return createDiagnostic({ code: 'gemini_network_failed', detail: text });
}

function classifyOllamaFailure(message) {
    return createDiagnostic({ code: 'ollama_unavailable', detail: normalizeMessage(message) });
}

function classifyWhisperFailure(message) {
    const text = normalizeMessage(message);
    const lower = text.toLowerCase();
    if (/enospc|no space|disk|quota|eacces|permission denied/.test(lower)) {
        return createDiagnostic({ code: 'whisper_download_disk_failed', detail: text });
    }
    return createDiagnostic({ code: 'whisper_download_network_failed', detail: text });
}

function classifyAudioHelperFailure(resultOrMessage) {
    if (resultOrMessage && resultOrMessage.ok) return null;
    return createDiagnostic({
        code: 'audio_helper_failed',
        detail: normalizeMessage(resultOrMessage && resultOrMessage.error ? resultOrMessage.error : resultOrMessage),
    });
}

function classifyDeepgramStatus(status, message) {
    if (status === 'reconnecting') return createDiagnostic({ code: 'deepgram_reconnecting', detail: normalizeMessage(message) });
    if (status === 'error' || status === 'disconnected')
        return createDiagnostic({ code: 'deepgram_disconnected', detail: normalizeMessage(message) });
    return null;
}

module.exports = {
    DIAGNOSTIC_CODES,
    createDiagnostic,
    classifyByokKey,
    classifyGeminiInitFailure,
    classifyOllamaFailure,
    classifyWhisperFailure,
    classifyAudioHelperFailure,
    classifyDeepgramStatus,
};
