// src/utils/keyFormat.js
// Single-source BYOK key format validators (B1-1). Dual export: module.exports
// for require()/Jest, and a window attachment so Lit components can use it as a
// runtime global (same pattern as src/i18n). No network, pure functions.
function isValidGeminiKeyFormat(key) {
    return /^AIza[0-9A-Za-z_-]{30,}$/.test((key || '').trim());
}

function isValidDeepgramKeyFormat(key) {
    return /^[0-9a-f]{32,}$/i.test((key || '').trim());
}

const _api = { isValidGeminiKeyFormat, isValidDeepgramKeyFormat };

if (typeof module !== 'undefined' && module.exports) {
    module.exports = _api;
}
if (typeof window !== 'undefined') {
    window.WhisperKeyFormat = _api;
}
