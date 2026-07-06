'use strict';

const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..', '..');
const read = relPath => fs.readFileSync(path.join(repoRoot, relPath), 'utf8');

describe('AssistantView i18n extraction', () => {
    const src = read('src/components/views/AssistantView.js');
    const ja = read('src/i18n/ja.js');

    // ── ja.js contains the new assistant.* keys ──
    describe('ja.js contains required keys', () => {
        test('assistant.rail.context_title', () => {
            expect(ja).toMatch(/'assistant\.rail\.context_title'/);
        });
        test('assistant.rail.gaps_title', () => {
            expect(ja).toMatch(/'assistant\.rail\.gaps_title'/);
        });
        test('assistant.help.discovery_start', () => {
            expect(ja).toMatch(/'assistant\.help\.discovery_start'/);
        });
        test('assistant.discovery.element.pain', () => {
            expect(ja).toMatch(/'assistant\.discovery\.element\.pain'/);
        });
        test('assistant.feedback.saved', () => {
            expect(ja).toMatch(/'assistant\.feedback\.saved'/);
        });
        test('assistant.context.field.company_product', () => {
            expect(ja).toMatch(/'assistant\.context\.field\.company_product'/);
        });
    });

    // ── AssistantView.js uses t() for the extracted strings ──
    describe('AssistantView.js uses t() for extracted keys', () => {
        test("uses t('assistant.rail.context_title')", () => {
            expect(src).toMatch(/t\('assistant\.rail\.context_title'\)/);
        });
        test("uses t('feedback.rating.helpful') (reuse from HistoryView)", () => {
            expect(src).toMatch(/t\('feedback\.rating\.helpful'\)/);
        });
        test("uses t('assistant.discovery.element.pain')", () => {
            expect(src).toMatch(/t\('assistant\.discovery\.element\.pain'\)/);
        });
    });

    // ── Raw JP literals are gone ──
    describe('AssistantView.js no longer contains raw JP literals', () => {
        test('no raw 現在のコンテキスト', () => {
            expect(src).not.toMatch(/現在のコンテキスト/);
        });
        test('no raw 不足している5要素', () => {
            expect(src).not.toMatch(/不足している5要素/);
        });
        test('no raw この場面で使えるヘルプ', () => {
            expect(src).not.toMatch(/この場面で使えるヘルプ/);
        });
        test('5-element label object is not duplicated as raw literal (pain/kpi deduped)', () => {
            // The old raw object literal { pain: '課題', kpi: 'KPI', ... } appeared twice.
            // After dedup, '課題' as a raw label value should not appear in the labels object.
            // We check that the discovery element labels go through t().
            expect(src).toMatch(/t\('assistant\.discovery\.element\.pain'\)/);
            // and there should be no standalone raw label object with 課題 still
            // (raw '課題' only ever appeared as a label value in those two objects)
            const rawObjectMatches = src.match(/pain:\s*'課題'/g) || [];
            expect(rawObjectMatches.length).toBe(0);
        });
    });

    // ── codex P2: 未確認 fallback も i18n 化（取りこぼし回帰防止）──
    describe('codex P2: unconfirmed fallback is i18n', () => {
        test('ja.js has assistant.evidence.unconfirmed', () => {
            expect(ja).toMatch(/'assistant\.evidence\.unconfirmed'/);
        });
        test('AssistantView uses t(assistant.evidence.unconfirmed)', () => {
            expect(src).toMatch(/t\('assistant\.evidence\.unconfirmed'\)/);
        });
        test('raw 未確認 literal is gone from AssistantView', () => {
            expect(src).not.toMatch(/未確認/);
        });
    });
});
