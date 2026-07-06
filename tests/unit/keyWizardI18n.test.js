'use strict';
const fs = require('fs');
const path = require('path');
const read = rel => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');

describe('KeyWizard i18n (ja-only, en falls back via t())', () => {
    const ja = read('src/i18n/ja.js');
    const keys = [
        'wizard.entry_button',
        'wizard.or_direct',
        'wizard.back',
        'wizard.next',
        'wizard.skip',
        'wizard.gemini.title',
        'wizard.gemini.lead',
        'wizard.gemini.open',
        'wizard.deepgram.title',
        'wizard.deepgram.lead',
        'wizard.deepgram.open',
        'wizard.deepgram.privacy',
        'wizard.verify.checking',
        'wizard.verify.ok',
        'wizard.verify.invalid',
        'wizard.verify.network',
        'wizard.done.title',
        'wizard.done.start',
    ];
    test('ja.js defines every wizard.* key', () => {
        for (const k of keys) {
            expect(ja).toContain(`'${k}'`);
        }
    });
});
