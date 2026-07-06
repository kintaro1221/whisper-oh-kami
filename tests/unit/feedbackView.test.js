'use strict';

const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..', '..');
const read = relPath => fs.readFileSync(path.join(repoRoot, relPath), 'utf8');

// The Feedback screen embedded the *upstream* (sohzm) Google Form — feedback
// went to the wrong author, and a third-party iframe contradicted the
// "テレメトリゼロ / 外部送信ゼロ" privacy story. Replace it with an on-brand
// mailto contact.
describe('FeedbackView: upstream form removed, mailto contact added', () => {
    const fv = read('src/components/views/FeedbackView.js');

    test('上流 Google フォームの埋め込み（iframe / forms.gle）を撤去', () => {
        expect(fv).not.toMatch(/forms\.gle/);
        expect(fv).not.toMatch(/<iframe/i);
    });

    test('mailto ベースのメール窓口 + 設定ポイント（SUPPORT_EMAIL）を持つ', () => {
        expect(fv).toMatch(/mailto:/);
        expect(fv).toMatch(/SUPPORT_EMAIL/);
        // 外部リンクは既存 onExternalLink 経由（shell.openExternal）で開く
        expect(fv).toMatch(/onExternalLink/);
    });

    test('CheatingDaddyApp が feedback-view に外部リンクを配線', () => {
        const app = read('src/components/app/CheatingDaddyApp.js');
        expect(app).toMatch(/<feedback-view[^>]*onExternalLink/);
    });

    test('フィードバック文言が ja/en 両方にある', () => {
        for (const table of [read('src/i18n/ja.js'), read('src/i18n/en.js')]) {
            expect(table).toMatch(/'feedback\.lead'/);
            expect(table).toMatch(/'feedback\.privacy_note'/);
        }
    });
});
