// Tiny i18n helper. Lookup chain: current lang → ja (primary) → en → caller
// fallback → key itself. The product is Japanese-first and ja is the complete
// table, so a key missing in the current language degrades to Japanese rather
// than leaking the raw key (e.g. "aicx.page_title") into the UI. Follows the
// evidenceInspector dual-export pattern so it works in both Renderer
// (nodeIntegration on, plain require) and Jest.
const ja = require('./ja');
const en = require('./en');

// Freeze the lookup maps so accidental runtime mutation
// (`window.WhisperI18n.STRINGS.ja['nav.home'] = ...`) fails loudly in strict
// mode rather than silently corrupting subsequent renders.
Object.freeze(ja);
Object.freeze(en);
const STRINGS = Object.freeze({ ja, en });
let _lang = 'ja';

function t(key, fallback) {
    const fromCurrent = STRINGS[_lang] && STRINGS[_lang][key];
    if (fromCurrent !== undefined) return fromCurrent;
    // Primary-language (ja) fallback before en: ja is the complete table, so an
    // untranslated key shows Japanese instead of the raw key string.
    const fromJa = STRINGS.ja && STRINGS.ja[key];
    if (fromJa !== undefined) return fromJa;
    const fromEn = STRINGS.en && STRINGS.en[key];
    if (fromEn !== undefined) return fromEn;
    if (fallback !== undefined) return fallback;
    return key;
}

function setLanguage(l) {
    if (STRINGS[l]) _lang = l;
}

function getLanguage() {
    return _lang;
}

const _api = { t, setLanguage, getLanguage, STRINGS };

if (typeof module !== 'undefined' && module.exports) {
    module.exports = _api;
}
if (typeof window !== 'undefined') {
    window.t = t;
    window.WhisperI18n = _api;
}
