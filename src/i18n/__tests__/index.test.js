const { t, setLanguage, STRINGS } = require('../index');

describe('i18n: t()', () => {
    beforeEach(() => {
        setLanguage('ja');
    });

    test('returns Japanese string for known key', () => {
        expect(t('nav.home')).toBe('ホーム');
    });

    test('returns English string when language is set to en', () => {
        setLanguage('en');
        expect(t('nav.home')).toBe('Home');
    });

    test('falls back to en when current language has no key', () => {
        setLanguage('ja');
        expect(t('__test.enOnly')).toBe('en-only fixture');
    });

    test('en falls back to ja (primary) for ja-only keys, not the raw key', () => {
        setLanguage('en');
        // A key present only in ja must degrade to Japanese, never to the key.
        expect(t('__test.jaOnly')).toBe('ja-only fixture');
        // Regression guard: the recording-consent dialog is ja-only and must
        // not surface its raw key in en.
        expect(t('app.recording_consent.message')).not.toBe('app.recording_consent.message');
        expect(t('app.recording_consent.message')).toBe(STRINGS.ja['app.recording_consent.message']);
    });

    test('falls back to provided fallback string when nothing matches', () => {
        expect(t('totally.unknown.key', 'デフォルト文言')).toBe('デフォルト文言');
    });

    test('falls back to key itself when no fallback provided', () => {
        expect(t('totally.unknown.key')).toBe('totally.unknown.key');
    });

    test('STRINGS exposes both ja and en maps', () => {
        expect(STRINGS.ja).toBeDefined();
        expect(STRINGS.en).toBeDefined();
        expect(typeof STRINGS.ja['nav.home']).toBe('string');
    });

    test('STRINGS maps are frozen against runtime mutation', () => {
        expect(Object.isFrozen(STRINGS)).toBe(true);
        expect(Object.isFrozen(STRINGS.ja)).toBe(true);
        expect(Object.isFrozen(STRINGS.en)).toBe(true);
    });
});

describe('i18n: getLanguage()', () => {
    const { getLanguage } = require('../index');

    test('returns the current language after setLanguage', () => {
        setLanguage('en');
        expect(getLanguage()).toBe('en');
        setLanguage('ja');
        expect(getLanguage()).toBe('ja');
    });

    test('silently no-ops on unknown language, keeping previous', () => {
        setLanguage('ja');
        setLanguage('klingon');
        expect(getLanguage()).toBe('ja');
    });
});
