'use strict';

const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..', '..');
const read = relPath => fs.readFileSync(path.join(repoRoot, relPath), 'utf8');

// i18n extraction: HelpView FAQ / license / section JP strings routed through t()
describe('HelpView i18n extraction (FAQ, license, section headings)', () => {
    const hv = read('src/components/views/HelpView.js');
    const ja = read('src/i18n/ja.js');

    // ── ja.js contains all new keys ──────────────────────────────────────────
    describe('ja.js new keys', () => {
        test('help.keybind.unset is present', () => {
            expect(ja).toMatch(/'help\.keybind\.unset'/);
        });

        test('help.section.shortcuts is present', () => {
            expect(ja).toMatch(/'help\.section\.shortcuts'/);
        });

        test('help.section.during_negotiation is present', () => {
            expect(ja).toMatch(/'help\.section\.during_negotiation'/);
        });

        test('help.negotiation.right_rail_desc is present', () => {
            expect(ja).toMatch(/'help\.negotiation\.right_rail_desc'/);
        });

        test('help.negotiation.feedback_recording_desc is present', () => {
            expect(ja).toMatch(/'help\.negotiation\.feedback_recording_desc'/);
        });

        test('help.section.preparation is present', () => {
            expect(ja).toMatch(/'help\.section\.preparation'/);
        });

        test('help.preparation.context_setup_desc is present', () => {
            expect(ja).toMatch(/'help\.preparation\.context_setup_desc'/);
        });

        test('help.preparation.consent_desc is present', () => {
            expect(ja).toMatch(/'help\.preparation\.consent_desc'/);
        });

        test('help.section.faq is present', () => {
            expect(ja).toMatch(/'help\.section\.faq'/);
        });

        test('help.faq.gemini_key_format is present', () => {
            expect(ja).toMatch(/'help\.faq\.gemini_key_format'/);
        });

        test('help.faq.gemini_auth_connection is present', () => {
            expect(ja).toMatch(/'help\.faq\.gemini_auth_connection'/);
        });

        test('help.faq.trial_slow is present', () => {
            expect(ja).toMatch(/'help\.faq\.trial_slow'/);
        });

        test('help.faq.speaker_audio_not_captured is present', () => {
            expect(ja).toMatch(/'help\.faq\.speaker_audio_not_captured'/);
        });

        test('help.faq.ollama_connection is present', () => {
            expect(ja).toMatch(/'help\.faq\.ollama_connection'/);
        });

        test('help.faq.whisper_download is present', () => {
            expect(ja).toMatch(/'help\.faq\.whisper_download'/);
        });

        test('help.faq.audio_helper_failed is present', () => {
            expect(ja).toMatch(/'help\.faq\.audio_helper_failed'/);
        });

        test('help.faq.transcription_stopped is present', () => {
            expect(ja).toMatch(/'help\.faq\.transcription_stopped'/);
        });

        test('help.faq.shortcut_not_working is present', () => {
            expect(ja).toMatch(/'help\.faq\.shortcut_not_working'/);
        });

        test('help.section.license is present', () => {
            expect(ja).toMatch(/'help\.section\.license'/);
        });

        test('help.license.gpl_notice is present', () => {
            expect(ja).toMatch(/'help\.license\.gpl_notice'/);
        });

        test('help.license.fork_notice is present', () => {
            expect(ja).toMatch(/'help\.license\.fork_notice'/);
        });

        test('help.license.font_notice is present', () => {
            expect(ja).toMatch(/'help\.license\.font_notice'/);
        });

        test('help.license.packages_notice is present', () => {
            expect(ja).toMatch(/'help\.license\.packages_notice'/);
        });

        test('help.link.source_code is present', () => {
            expect(ja).toMatch(/'help\.link\.source_code'/);
        });
    });

    // ── HelpView.js uses t() for the new keys ────────────────────────────────
    describe('HelpView.js uses t() for extracted keys', () => {
        test('uses t(\'help.faq.gemini_key_format\')', () => {
            expect(hv).toMatch(/t\('help\.faq\.gemini_key_format'\)/);
        });

        test('uses t(\'help.license.fork_notice\')', () => {
            expect(hv).toMatch(/t\('help\.license\.fork_notice'\)/);
        });

        test('uses t(\'help.section.faq\')', () => {
            expect(hv).toMatch(/t\('help\.section\.faq'\)/);
        });

        test('uses t(\'help.keybind.unset\')', () => {
            expect(hv).toMatch(/t\('help\.keybind\.unset'\)/);
        });

        test('uses t(\'help.license.gpl_notice\')', () => {
            expect(hv).toMatch(/t\('help\.license\.gpl_notice'\)/);
        });

        test('uses t(\'help.faq.whisper_download\')', () => {
            expect(hv).toMatch(/t\('help\.faq\.whisper_download'\)/);
        });

        test('uses t(\'help.link.source_code\')', () => {
            expect(hv).toMatch(/t\('help\.link\.source_code'\)/);
        });
    });

    // ── HelpView.js no longer contains raw JP literals ───────────────────────
    describe('HelpView.js raw JP literals removed', () => {
        test('does not contain raw literal よくある質問・困ったとき', () => {
            expect(hv).not.toMatch(/よくある質問・困ったとき/);
        });

        test('does not contain raw literal ライセンス・オープンソース', () => {
            expect(hv).not.toMatch(/ライセンス・オープンソース/);
        });

        test('does not contain raw literal ソースコード (bare string)', () => {
            // The button label should be routed through t(), not a bare literal
            expect(hv).not.toMatch(/>\s*ソースコード\s*</);
        });
    });
});
