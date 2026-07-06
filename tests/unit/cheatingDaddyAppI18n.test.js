'use strict';

const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..', '..');
const read = relPath => fs.readFileSync(path.join(repoRoot, relPath), 'utf8');

describe('CheatingDaddyApp i18n extraction (ja-only)', () => {
    const ja = read('src/i18n/ja.js');
    const app = read('src/components/app/CheatingDaddyApp.js');

    // ── ja.js contains all new keys ──
    test('ja.js contains app.recording_consent.message', () => {
        expect(ja).toMatch(/'app\.recording_consent\.message'/);
    });

    test('ja.js contains app.live_bar.end_session', () => {
        expect(ja).toMatch(/'app\.live_bar\.end_session'/);
    });

    test('ja.js contains app.live_bar.session_fallback', () => {
        expect(ja).toMatch(/'app\.live_bar\.session_fallback'/);
    });

    test('ja.js contains app.live_bar.click_through', () => {
        expect(ja).toMatch(/'app\.live_bar\.click_through'/);
    });

    test('ja.js contains app.live_bar.hide', () => {
        expect(ja).toMatch(/'app\.live_bar\.hide'/);
    });

    test('ja.js contains app.window_control.hide_tooltip', () => {
        expect(ja).toMatch(/'app\.window_control\.hide_tooltip'/);
    });

    test('ja.js contains app.window_control.close_tooltip', () => {
        expect(ja).toMatch(/'app\.window_control\.close_tooltip'/);
    });

    // ── CheatingDaddyApp.js uses t() for new keys ──
    test("CheatingDaddyApp.js uses t('app.recording_consent.message')", () => {
        expect(app).toMatch(/t\('app\.recording_consent\.message'\)/);
    });

    test("CheatingDaddyApp.js uses t('app.live_bar.end_session')", () => {
        expect(app).toMatch(/t\('app\.live_bar\.end_session'\)/);
    });

    test("CheatingDaddyApp.js uses t('profile.discovery') for profileLabels.discovery", () => {
        expect(app).toMatch(/t\('profile\.discovery'\)/);
    });

    // ── Raw JP literals are gone from CheatingDaddyApp.js ──
    test("CheatingDaddyApp.js no longer has raw literal 'セッション終了'", () => {
        expect(app).not.toMatch(/'セッション終了'/);
    });

    test("CheatingDaddyApp.js no longer has raw literal '[クリックスルー]'", () => {
        expect(app).not.toMatch(/'\[クリックスルー\]'/);
    });

    test("CheatingDaddyApp.js no longer has hardcoded '課題ヒアリング' in profileLabels object", () => {
        // The profileLabels object previously had: discovery: '課題ヒアリング'
        expect(app).not.toMatch(/discovery:\s*'課題ヒアリング'/);
    });
});
