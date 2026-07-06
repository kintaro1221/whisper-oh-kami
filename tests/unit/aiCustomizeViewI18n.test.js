'use strict';

const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..', '..');
const read = relPath => fs.readFileSync(path.join(repoRoot, relPath), 'utf8');

// i18n extraction: AICustomizeView JP literals → aicx.* keys in ja.js
describe('AICustomizeView i18n (aicx.*) extraction', () => {
    const src = read('src/components/views/AICustomizeView.js');
    const ja = read('src/i18n/ja.js');

    // ── ja.js must contain the new aicx.* keys ──
    describe('ja.js contains aicx.* keys', () => {
        test('aicx.page_title', () => {
            expect(ja).toMatch(/'aicx\.page_title'/);
        });

        test('aicx.section1_name', () => {
            expect(ja).toMatch(/'aicx\.section1_name'/);
        });

        test('aicx.field_company_product_label', () => {
            expect(ja).toMatch(/'aicx\.field_company_product_label'/);
        });

        test('aicx.framing_note_main', () => {
            expect(ja).toMatch(/'aicx\.framing_note_main'/);
        });

        test('aicx.optional_label', () => {
            expect(ja).toMatch(/'aicx\.optional_label'/);
        });

        test('aicx.legacy_hint_template', () => {
            expect(ja).toMatch(/'aicx\.legacy_hint_template'/);
        });
    });

    // ── AICustomizeView.js uses t() for these keys ──
    describe('AICustomizeView.js uses t() calls', () => {
        test("uses t('aicx.page_title')", () => {
            expect(src).toMatch(/t\('aicx\.page_title'\)/);
        });

        test("uses t('aicx.field_company_product_label')", () => {
            expect(src).toMatch(/t\('aicx\.field_company_product_label'\)/);
        });
    });

    // ── Raw JP literals must be gone ──
    describe('raw JP literals removed from AICustomizeView.js', () => {
        test('no raw "AI コンテキスト" page title literal', () => {
            // Allow it only as part of a t() value (it won't appear in the JS source at all)
            expect(src).not.toMatch(/['"`]AI コンテキスト['"`]/);
        });

        test('no raw "自社・商材" label literal', () => {
            expect(src).not.toMatch(/['"`]自社・商材['"`]/);
        });

        test('no raw "これで土台はOK" literal', () => {
            expect(src).not.toMatch(/['"`]これで土台はOK['"`]/);
        });
    });
});
