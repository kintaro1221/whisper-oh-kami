'use strict';

const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..', '..');
const read = relPath => fs.readFileSync(path.join(repoRoot, relPath), 'utf8');

// AI コンテキスト画面リデザイン: 6個の同じ縦長 textarea の「壁」を、商談の思考順に
// 並んだ4セクション + ガイド + 単一の保存ステータスに再構成。さらに「コンテキスト=
// 前提 / 5要素バー=商談中の聞き取り」を明示して自己矛盟を解消する。
// Note: JP literals moved to ja.js (aicx.* keys) in the i18n refactor; tests
// now check t() keys in src and the string values in ja.js.
describe('AICustomizeView redesign (grouped + guided, 前提/聞き取り 切り分け)', () => {
    const src = read('src/components/views/AICustomizeView.js');
    const ja = read('src/i18n/ja.js');

    test('4 つの意味グループに再構成されている', () => {
        // JP strings live in ja.js; src uses aicx.* t() keys
        for (const key of ['aicx.section1_name', 'aicx.section2_name', 'aicx.section3_name', 'aicx.section4_name']) {
            expect(src).toContain(key);
        }
        // ja.js holds the actual names
        for (const name of ['あなた・自社', '相手のこと', 'この商談', '自由指示']) {
            expect(ja).toContain(name);
        }
    });

    test('提案モードのラベルがあり、技術語（Discovery / 5要素の聞き取り）を出さない', () => {
        // mode_title key used in src; value lives in ja.js
        expect(src).toMatch(/aicx\.mode_title/);
        expect(ja).toMatch(/提案モード/);
        // プロファイル値は不変
        expect(src).toMatch(/'discovery'/);
        expect(src).toMatch(/'sales'/);
    });

    test('単一の保存ステータス state を持つ（自動保存の手応え）', () => {
        expect(src).toMatch(/_saveStatus/);
        expect(src).toMatch(/saving/);
        expect(src).toMatch(/saved/);
    });

    test('コンテキスト=前提 / 5要素バー=商談中の聞き取り を明示する', () => {
        // The framing note text lives in ja.js; src references it via t()
        expect(ja).toMatch(/5要素バー|バーが.*聞き取/);
        expect(ja).toMatch(/前提/);
        expect(src).toMatch(/aicx\.framing_note_main/);
    });

    test('顧客背景は「課題の当て推量」でなく事実の前提として案内する', () => {
        // help text lives in ja.js after i18n extraction
        expect(ja).toMatch(/業界・規模|事前に分かっている前提/);
    });

    test('開発者ジャーゴンのフッターを平易なコピーに置換', () => {
        expect(src).not.toMatch(/構造化項目は contextProfile に保存/);
        // footer text lives in ja.js; src uses aicx.footer_note key
        expect(ja).toMatch(/次の商談から反映/);
        expect(src).toMatch(/aicx\.footer_note/);
    });

    test('短い項目は1行扱い（縦長の壁を解消）', () => {
        expect(src).toMatch(/oneline/);
    });

    test('保存ロジックの不変条件を維持（contextProfile + customPrompt 同時保存）', () => {
        expect(src).toMatch(/buildCustomPromptFromContext/);
        expect(src).toMatch(/setPreferences/);
        expect(src).toMatch(/contextProfile:/);
        expect(src).toMatch(/customPrompt:/);
    });
});
