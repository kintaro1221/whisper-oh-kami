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

    // ── v0.7.8: candidate / conflict / ✓ confirmation step go through t() ──
    describe('v0.7.8 evidence panel strings go through t()', () => {
        for (const key of [
            'assistant.badge.candidate_hint',
            'assistant.evidence.confirm_prompt',
            'assistant.evidence.confirm_yes',
            'assistant.evidence.confirm_no',
            'assistant.evidence.select',
            'assistant.evidence.conflict_title',
            'assistant.evidence.conflict_unknown_title',
            'assistant.evidence.actions_section',
            'assistant.evidence.confirmation_record',
            'assistant.evidence.cleared_record',
            'assistant.evidence.retracted_label',
            'assistant.evidence.values_label',
            'assistant.evidence.tag.kept',
            'assistant.evidence.tag.set_aside',
        ]) {
            test(`ja.js has ${key} and AssistantView uses t('${key}')`, () => {
                const escaped = key.replace(/\./g, '\\.');
                expect(ja).toMatch(new RegExp(`'${escaped}'`));
                expect(src).toMatch(new RegExp(`t\\('${escaped}'\\)`));
            });
        }
        test('refusal / tag / cleared texts are looked up through dynamic keys', () => {
            expect(src).toMatch(/t\(getConfirmRefusalKey\(/);
            expect(src).toMatch(/t\(tag\.i18nKey\)/);
            expect(src).toMatch(/t\('assistant\.evidence\.cleared\.' \+/);
        });
        test('the candidate count placeholder is filled from candidateCount', () => {
            expect(src).toMatch(/\.replace\('\{candidate\}', /);
            expect(src).toMatch(/candidateCount/);
        });
    });

    // ── 未確認 fallback も i18n 化（取りこぼし回帰防止）──
    describe('unconfirmed fallback is i18n', () => {
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
