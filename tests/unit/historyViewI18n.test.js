'use strict';

const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..', '..');
const read = p => fs.readFileSync(path.join(repoRoot, p), 'utf8');

describe('HistoryView i18n extraction', () => {
    const ja = read('src/i18n/ja.js');
    const hv = read('src/components/views/HistoryView.js');

    // ── Group A: legacy profile keys in ja.js ──
    describe('ja.js contains new profile keys', () => {
        test("profile.interview key exists", () => {
            expect(ja).toMatch(/'profile\.interview'/);
        });
        test("profile.meeting key exists", () => {
            expect(ja).toMatch(/'profile\.meeting'/);
        });
        test("profile.presentation key exists", () => {
            expect(ja).toMatch(/'profile\.presentation'/);
        });
        test("profile.negotiation key exists", () => {
            expect(ja).toMatch(/'profile\.negotiation'/);
        });
        test("profile.exam key exists", () => {
            expect(ja).toMatch(/'profile\.exam'/);
        });
    });

    // ── Group B: feedback rating keys in ja.js ──
    describe('ja.js contains new feedback rating keys', () => {
        test("feedback.rating.helpful key exists", () => {
            expect(ja).toMatch(/'feedback\.rating\.helpful'/);
        });
        test("feedback.rating.off_target key exists", () => {
            expect(ja).toMatch(/'feedback\.rating\.off_target'/);
        });
        test("feedback.rating.unsafe key exists", () => {
            expect(ja).toMatch(/'feedback\.rating\.unsafe'/);
        });
    });

    // ── Group C: history-local keys in ja.js ──
    describe('ja.js contains new history keys', () => {
        test("history.empty.no_feedback key exists", () => {
            expect(ja).toMatch(/'history\.empty\.no_feedback'/);
        });
        test("history.feedback.response_label key exists", () => {
            expect(ja).toMatch(/'history\.feedback\.response_label'/);
        });
        test("history.feedback.note_empty key exists", () => {
            expect(ja).toMatch(/'history\.feedback\.note_empty'/);
        });
    });

    // ── HistoryView uses t() calls ──
    describe('HistoryView uses t() for extracted strings', () => {
        test("uses t('profile.interview')", () => {
            expect(hv).toMatch(/t\('profile\.interview'\)/);
        });
        test("uses t('feedback.rating.helpful')", () => {
            expect(hv).toMatch(/t\('feedback\.rating\.helpful'\)/);
        });
        test("uses t('history.empty.no_feedback')", () => {
            expect(hv).toMatch(/t\('history\.empty\.no_feedback'\)/);
        });
    });

    // ── HistoryView no longer contains raw JP literals ──
    describe('HistoryView does NOT contain raw JP literals', () => {
        test("raw literal '面接' is gone", () => {
            expect(hv).not.toMatch(/['"`]面接['"`]/);
        });
        test("raw literal '役立つ' is gone", () => {
            expect(hv).not.toMatch(/['"`]役立つ['"`]/);
        });
        test("raw literal '保存されたフィードバックはありません' is gone", () => {
            expect(hv).not.toMatch(/保存されたフィードバックはありません/);
        });
    });

    // ── codex P2: feedback タブラベルも i18n 化（取りこぼし回帰防止）──
    describe('codex P2: feedback tab label is i18n', () => {
        test('ja.js has history.tab.feedback', () => {
            expect(ja).toMatch(/'history\.tab\.feedback'/);
        });
        test('HistoryView tab uses t(history.tab.feedback)', () => {
            expect(hv).toMatch(/t\('history\.tab\.feedback'\)/);
        });
        test('raw feedback tab literal is gone', () => {
            expect(hv).not.toMatch(/>\s*フィードバック\s*\(/);
        });
    });
});
