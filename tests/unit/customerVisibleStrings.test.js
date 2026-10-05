'use strict';

const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..', '..');
const read = relPath => fs.readFileSync(path.join(repoRoot, relPath), 'utf8');

// Commercialization Phase 0 (§0.2): no "cheating" / "daddy" in customer-visible
// strings. The upstream GPL attribution legitimately names "cheating-daddy" (a
// required credit, kept in HelpView), so this guards the one real leak — the
// helper-exe filename surfaced inside a user-facing diagnostic.
describe('Phase 0.2: diagnostics do not leak the daddyAudioCapture exe name', () => {
    for (const table of ['src/i18n/ja.js', 'src/i18n/en.js']) {
        test(`${table} has no daddyAudioCapture reference`, () => {
            expect(read(table)).not.toMatch(/daddyAudioCapture/i);
        });
    }
});

// v0.7.5 trust gates: detected candidates vs customer-confirmed elements.
// Every new user-visible string for the badge / evidence panel must exist in
// BOTH locale tables (en must not silently fall back to Japanese).
describe('v0.7.5: candidate / confirmed evidence strings exist in ja and en', () => {
    const ja = require('../../src/i18n/ja');
    const en = require('../../src/i18n/en');
    const keys = [
        'assistant.progress.title',
        'assistant.progress.counts',
        'assistant.badge.detected_hint',
        'assistant.evidence.confirm',
        'assistant.evidence.retract',
        'assistant.evidence.polarity.negated',
        'assistant.evidence.polarity.hypothetical',
        'assistant.evidence.polarity.third_party',
        'assistant.evidence.polarity.retraction',
        'assistant.evidence.retracted',
        'assistant.help.candidates_complete',
        // v0.7.8 candidate tier / conflict / ✓ confirmation step
        'assistant.badge.candidate_hint',
        'assistant.evidence.tag.tentative',
        'assistant.evidence.tag.wish',
        'assistant.evidence.tag.conflict',
        'assistant.evidence.tag.conflict_unknown',
        'assistant.evidence.tag.selected',
        'assistant.evidence.tag.set_aside',
        'assistant.evidence.tag.kept',
        'assistant.evidence.tag.current',
        'assistant.evidence.confirm_prompt',
        'assistant.evidence.confirm_yes',
        'assistant.evidence.confirm_no',
        'assistant.evidence.refusal.conflict_unresolved',
        'assistant.evidence.refusal.basis_unknown',
        'assistant.evidence.refusal.no_candidate',
        'assistant.evidence.select',
        'assistant.evidence.conflict_title',
        'assistant.evidence.conflict_unknown_title',
        'assistant.evidence.actions_section',
        'assistant.evidence.confirmation_record',
        'assistant.evidence.cleared_record',
        'assistant.evidence.cleared.retraction',
        'assistant.evidence.cleared.conflict',
        'assistant.evidence.cleared.manual',
        'assistant.evidence.retracted_label',
        'assistant.evidence.values_label',
    ];
    for (const key of keys) {
        test(`${key} is defined in ja and en`, () => {
            expect(typeof ja[key]).toBe('string');
            expect(ja[key].length).toBeGreaterThan(0);
            expect(typeof en[key]).toBe('string');
            expect(en[key].length).toBeGreaterThan(0);
        });
    }
    test('progress counts carry both placeholders in each locale', () => {
        for (const table of [ja, en]) {
            expect(table['assistant.progress.counts']).toContain('{detected}');
            expect(table['assistant.progress.counts']).toContain('{confirmed}');
            expect(table['assistant.progress.counts']).toContain('{candidate}');
        }
    });
    test('v0.7.8 placeholders survive in each locale', () => {
        for (const table of [ja, en]) {
            expect(table['assistant.evidence.tag.conflict']).toContain('{n}');
            expect(table['assistant.evidence.confirm_prompt']).toContain('{value}');
            expect(table['assistant.evidence.confirmation_record']).toContain('{value}');
            expect(table['assistant.evidence.confirmation_record']).toContain('{time}');
            expect(table['assistant.evidence.cleared_record']).toContain('{reason}');
            expect(table['assistant.evidence.cleared_record']).toContain('{time}');
            expect(table['assistant.evidence.retracted_label']).toContain('{n}');
        }
    });
    test('the ✓ button names what it attests (customer confirmation, not a value choice)', () => {
        expect(ja['assistant.evidence.confirm']).toBe('相手に確認済みにする');
        expect(ja['assistant.evidence.select']).toBe('この値を候補として残す');
        expect(ja['assistant.progress.counts']).toBe('候補 {detected} / 仮 {candidate} / 確認 {confirmed} / 5');
    });
    test('new strings never name the upstream project', () => {
        for (const table of [ja, en]) {
            for (const key of keys) {
                expect(table[key]).not.toMatch(/cheating|daddy/i);
            }
        }
    });
});

// v0.7.5 mode gating: byok / local are 検証中 and must show their constraints
// before a session starts. Every key must exist in BOTH locale tables.
describe('v0.7.5: experimental mode (byok / local) strings exist in ja and en', () => {
    const ja = require('../../src/i18n/ja');
    const en = require('../../src/i18n/en');
    const keys = [
        'main.mode_card.experimental_tag',
        'main.mode_card.byok.desc',
        'main.mode_card.local.desc',
        'onboarding.mode.byok.label',
        'onboarding.mode.byok.desc',
        'onboarding.mode.local.label',
        'onboarding.mode.local.desc',
        'experimental.title',
        'experimental.intro',
        'experimental.byok.1',
        'experimental.byok.2',
        'experimental.byok.3',
        'experimental.local.1',
        'experimental.local.2',
        'experimental.local.3',
        'experimental.accept',
        'experimental.back',
    ];
    for (const key of keys) {
        test(`${key} is defined in ja and en`, () => {
            expect(typeof ja[key]).toBe('string');
            expect(ja[key].length).toBeGreaterThan(0);
            expect(typeof en[key]).toBe('string');
            expect(en[key].length).toBeGreaterThan(0);
        });
    }
    test('experimental title carries the {mode} placeholder in each locale', () => {
        for (const table of [ja, en]) {
            expect(table['experimental.title']).toContain('{mode}');
        }
    });
    test('byok / local copy is marked 検証中 and drops the old promises', () => {
        expect(ja['main.mode_card.byok.desc']).toContain('検証中');
        expect(ja['main.mode_card.local.desc']).toContain('検証中');
        expect(ja['onboarding.mode.byok.label']).toContain('検証中');
        expect(ja['onboarding.mode.local.label']).toContain('検証中');
        expect(ja['onboarding.mode.byok.label']).not.toContain('おすすめ');
        expect(ja['onboarding.mode.local.desc']).not.toContain('外部送信ゼロ');
        expect(en['onboarding.mode.byok.label']).not.toMatch(/recommended/i);
        expect(en['onboarding.mode.local.desc']).not.toMatch(/zero outbound/i);
    });
    test('new strings never name the upstream project', () => {
        for (const table of [ja, en]) {
            for (const key of keys) {
                expect(table[key]).not.toMatch(/cheating|daddy/i);
            }
        }
    });
});

// v0.7.5 Task 7: data-flow wording must match the code. The sttMode 'local'
// option only turns Deepgram off — in byok the counterpart's audio still goes
// to Gemini Live — so it must not be called 「ローカル完結」 / "Local Privacy".
// Saved conversation data and what 「すべてのデータを削除」 covers are disclosed.
describe('v0.7.5: data-flow wording and saved-data disclosure', () => {
    const ja = require('../../src/i18n/ja');
    const en = require('../../src/i18n/en');
    const keys = [
        'customize.stt.local.title',
        'customize.stt.local.tag',
        'customize.stt.local.help',
        'customize.stt.section_help',
        'customize.privacy.saved_data_help',
        'app.live_bar.stt_badge.on_device',
        'app.live_bar.stt_badge.byok_local',
        'app.live_bar.stt_badge.cloud',
    ];
    for (const key of keys) {
        test(`${key} is defined in ja and en`, () => {
            expect(typeof ja[key]).toBe('string');
            expect(ja[key].length).toBeGreaterThan(0);
            expect(typeof en[key]).toBe('string');
            expect(en[key].length).toBeGreaterThan(0);
        });
    }
    test('the no-Deepgram option is named for what it does', () => {
        expect(ja['customize.stt.local.title']).toBe('Deepgram を使わない');
        expect(en['customize.stt.local.title']).toBe("Don't use Deepgram");
        for (const table of [ja, en]) {
            expect(table['customize.stt.local.help']).toContain('Gemini Live');
            expect(table['app.live_bar.stt_badge.byok_local']).toContain('Gemini Live');
        }
    });
    test('no locale string still promises 「ローカル完結」 / "Local Privacy"', () => {
        expect(read('src/i18n/ja.js')).not.toContain('ローカル完結');
        expect(read('src/i18n/en.js')).not.toMatch(/Local Privacy/i);
    });
    test('saved-data disclosure states the location, plain JSON, no auto-delete and the legacy folder', () => {
        const help = ja['customize.privacy.saved_data_help'];
        expect(help).toContain('%APPDATA%\\whisper-oh-kami-config\\history');
        expect(en['customize.privacy.saved_data_help']).toContain('%APPDATA%\\whisper-oh-kami-config\\history');
        expect(help).toContain('平文 JSON');
        expect(help).toContain('自動削除はありません');
        expect(help).toContain('旧バージョンの設定フォルダ');
        expect(en['customize.privacy.saved_data_help']).toContain("the previous version's settings folder");
        expect(read('src/components/views/CustomizeView.js')).toContain("t('customize.privacy.saved_data_help')");
    });
    test('badge strings never name the upstream project', () => {
        for (const table of [ja, en]) {
            for (const key of keys) {
                expect(table[key]).not.toMatch(/cheating|daddy/i);
            }
        }
    });
});

// v0.7.5 final review: copy must state the real conditions.
describe('v0.7.5 final review: copy accuracy (5-element bar, Ollama host, branding)', () => {
    const ja = require('../../src/i18n/ja');
    const en = require('../../src/i18n/en');

    test('byok: the 5-element bar needs a Deepgram key AND the cloud STT option', () => {
        expect(ja['experimental.byok.2']).toContain('Deepgram');
        expect(ja['experimental.byok.2']).toContain('音声認識エンジン');
        expect(ja['experimental.byok.2']).toContain(ja['customize.stt.cloud.title']);
        expect(en['experimental.byok.2']).toContain('Deepgram');
        expect(en['experimental.byok.2']).toContain(en['customize.stt.title']);
        expect(en['experimental.byok.2']).toContain(en['customize.stt.cloud.title']);
    });

    test('local help: "nothing leaves the device" only when the Ollama host is this PC', () => {
        expect(ja['local_ai_help.intro.body']).toContain('Ollama のホストがこの PC（既定 127.0.0.1）の場合');
        expect(en['local_ai_help.intro.body']).toMatch(/when the Ollama host is this PC \(default 127\.0\.0\.1\)/i);
    });

    test('rail: all five filled means candidates, not confirmed facts', () => {
        expect(ja['assistant.rail.gaps_filled']).toBe('5要素の候補が出揃っています');
        expect(en['assistant.rail.gaps_filled']).toBe('All five candidates are in');
    });

    test('locale strings never carry the legacy folder name; the README keeps it', () => {
        expect(ja['customize.privacy.saved_data_help']).toContain('旧バージョンの設定フォルダ');
        expect(en['customize.privacy.saved_data_help']).toContain("the previous version's settings folder");
        expect(read('src/i18n/ja.js')).not.toContain('cheating-daddy-config');
        expect(read('src/i18n/en.js')).not.toContain('cheating-daddy-config');
        expect(read('README.md')).toContain('cheating-daddy-config');
    });

    test('README: byok bar condition, Ollama host condition, English beta marking and Gemini Live disclosure', () => {
        const readme = read('README.md');
        const [jaPart, enPart] = readme.split('## English');
        expect(jaPart).toContain('クラウド優先');
        expect(jaPart).not.toMatch(/\| Deepgram 併用時のみ +\|/);
        expect(enPart).toMatch(/`byok`\*\* \(beta\)/);
        expect(enPart).toMatch(/`local`\*\* \(beta\)/);
        expect(enPart).toContain('Gemini Live');
        expect(enPart).toContain('when the Ollama host is this PC (default 127.0.0.1)');
        expect(enPart).not.toContain('fully offline (zero outbound)');
        expect(enPart).not.toContain('Trial and local keep audio on-device.');
    });

    test('legal docs: local-ollama mentions the remote-host caveat', () => {
        const policy = read('docs/legal/privacy-policy.md');
        const section = policy.slice(policy.indexOf('### 2.2 local-ollama'), policy.indexOf('### 2.3'));
        expect(section).toMatch(/127\.0\.0\.1 以外[\s\S]*送信/);
        const guidance = read('docs/legal/recording-guidance.md');
        const row = guidance.split('\n').find(l => l.startsWith('| local-whisper / local-ollama'));
        expect(row).toMatch(/Ollama のホストをこの PC 以外/);
    });
});

// v0.7.8 follow-up: trial has no speaker separation (mic only, every turn is
// treated as the counterpart's). The mode card, the onboarding choice, the
// live-bar badge hover and the README must say so before the user trusts a
// candidate. See docs/decisions/2026-10-05-trial-speaker-unidentified.md.
describe('v0.7.8: trial speaker-unidentified notice', () => {
    const ja = require('../../src/i18n/ja');
    const en = require('../../src/i18n/en');
    const keys = ['main.mode_card.trial.desc', 'onboarding.mode.trial.desc', 'app.live_bar.stt_badge.on_device'];
    for (const key of keys) {
        test(`${key} warns about speaker separation in ja and en`, () => {
            expect(ja[key]).toContain('話者');
            expect(ja[key]).toContain('区別しません');
            expect(en[key]).toMatch(/speaker separation|separate speakers/i);
            expect(ja[key]).not.toMatch(/cheating|daddy/i);
            expect(en[key]).not.toMatch(/cheating|daddy/i);
        });
    }
    test('the card keeps the short form; the hover and onboarding carry the full sentence', () => {
        expect(ja['main.mode_card.trial.desc']).toContain('話者は区別しません');
        expect(en['main.mode_card.trial.desc']).toContain('No speaker separation');
        for (const key of ['onboarding.mode.trial.desc', 'app.live_bar.stt_badge.on_device']) {
            expect(ja[key]).toContain('自分の発言も相手の発言として扱われる');
            expect(ja[key]).toContain('相手に確認してから ✓ を押してください');
            expect(en[key]).toContain("treated as the counterpart's");
            expect(en[key]).toContain('before pressing ✓');
        }
    });
    test('README states the limitation in both the Japanese and the English part', () => {
        const [jaPart, enPart] = read('README.md').split('## English');
        expect(jaPart).toContain('お試し（`trial`）は話者を区別しません。');
        expect(jaPart).toContain('候補は相手に確認してから ✓ を押してください。');
        const trialRow = jaPart.split('\n').find(l => l.startsWith('| **trial**'));
        expect(trialRow).toContain('話者は区別しません');
        expect(enPart).toContain('**No speaker separation**');
    });
});
