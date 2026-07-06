'use strict';

const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..', '..');
const read = relPath => fs.readFileSync(path.join(repoRoot, relPath), 'utf8');

// Home/start screen redesign (research-grounded: Granola-style sensible defaults
// + progressive disclosure). The default (trial) path is zero-input; technical
// config (Whisper model, devices) hides behind <details>; the 3 modes become
// visible self-select cards instead of buried text-links.
describe('MainView home redesign (zero-friction default, progressive disclosure, mode cards)', () => {
    const mv = read('src/components/views/MainView.js');

    test('安定フレーム: モード非依存の固定サブタイトル、タイトルから mode-suffix を撤去', () => {
        expect(mv).toMatch(/main\.subtitle\.app/);
        expect(mv).not.toMatch(/main\.mode_suffix/); // タイトルがモードで揺れない
    });

    test('技術設定は <details> に退避、品質（Whisperモデル）選択は撤去して Tiny 固定', () => {
        expect(mv).toMatch(/<details class="advanced"/);
        expect(mv).toMatch(/_renderAdvanced\(/);
        // モデル選択は footgun（典型PCで実時間に追従するのは tiny だけ）なので撤去
        expect(mv).not.toMatch(/_renderWhisperSelect/);
        expect(mv).not.toMatch(/main\.advanced\.whisper_label/);
        // 精度アップは cloud STT が正道、と1行だけ誘導
        expect(mv).toMatch(/main\.advanced\.accuracy_note/);
    });

    test('安心2行（開始すると何が起きるか）を trial に提示', () => {
        expect(mv).toMatch(/_renderReassure\(\)/);
        expect(mv).toMatch(/main\.reassure\.mic/);
        expect(mv).toMatch(/main\.reassure\.bar/);
    });

    test('3モードは text-link でなく可視カード（self-select、role=radio）', () => {
        expect(mv).toMatch(/_renderModeCards\(\)/);
        expect(mv).toMatch(/role="radio"/);
        expect(mv).toMatch(/aria-checked/);
        expect(mv).toMatch(/main\.mode_card\.selected/);
        // 旧 text-link 群は撤去
        expect(mv).not.toMatch(/<div class="mode-links">/);
    });

    test('区切りは「開始する方法を選ぶ」に', () => {
        expect(mv).toMatch(/main\.divider\.choose_mode/);
    });

    test('不変条件: handleStart / keydown / aurora / brandMark は維持', () => {
        expect(mv).toMatch(/_handleStart\(\)/);
        expect(mv).toMatch(/_handleKeydown\(/);
        expect(mv).toMatch(/startAurora/);
        expect(mv).toMatch(/brandMark\(/);
        // byok 必須入力（Gemini キー）は維持
        expect(mv).toMatch(/main\.api\.gemini_label/);
    });

    test('新コピーが ja/en 両方にある', () => {
        for (const table of [read('src/i18n/ja.js'), read('src/i18n/en.js')]) {
            expect(table).toMatch(/'main\.subtitle\.app'/);
            expect(table).toMatch(/'main\.divider\.choose_mode'/);
            expect(table).toMatch(/'main\.advanced\.title'/);
        }
    });

    test('Whisper DL中は進捗バー（role=progressbar + aria-valuenow + aria-label + .whisper-bar）で描画', () => {
        expect(mv).toMatch(/role="progressbar"/);
        expect(mv).toMatch(/aria-valuenow/);
        expect(mv).toMatch(/aria-label=/); // progressbar に accessible name（codex P3）
        expect(mv).toMatch(/whisper-bar/);
    });

    test('旧 .whisper-spinner は撤去されている', () => {
        expect(mv).not.toMatch(/whisper-spinner/);
    });

    test('進捗バーは window.whisperBarState をグローバル消費する', () => {
        expect(mv).toMatch(/window\.whisperBarState/);
    });

    test('エラー時の再試行ボタン（main.button.retry）は残っている', () => {
        expect(mv).toMatch(/main\.button\.retry/);
    });

    test('local モードの並びに _renderWhisperStatus を挿入（start → whisperStatus → advanced）', () => {
        expect(mv).toMatch(/_renderStartButton\(\)\}\s*\$\{this\._renderWhisperStatus\(\)\}\s*\$\{this\._renderAdvanced\('local'\)/);
    });
});
