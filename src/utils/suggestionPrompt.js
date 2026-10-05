// suggestionPrompt.js — Phase 2.A extracted pure module.
//
// The AI-suggestion prompt builder + its evidence-inject helpers, lifted
// out of gemini.js so Jest can require them without pulling in Electron,
// @google/genai, audioCapture, deepgram, or the rest of the live
// orchestration tree. gemini.js re-requires this module and uses the
// exports verbatim — call sites are unchanged.
//
// Follows the same pure-module pattern as turnEvents.js, devHarness.js,
// and discoveryEvidence.js: no Electron / Gemini / IPC / Deepgram imports.

'use strict';

// discoveryEvidence.js is itself a pure CommonJS module (no Electron / IPC),
// so pulling the live-row predicate from it keeps "which row is the current
// value" defined in exactly one place.
const { isLiveRow } = require('./discoveryEvidence');

// Explicit whitelist resolver for which profiles get the 5-element evidence
// inject. Returns the canonical profile name when it matches the
// discovery/sales family, otherwise null (= no inject).
//
// Intentionally does NOT fall back to 'discovery' on null/undefined.
// devHarness.js seeds currentSystemPrompt with `getCurrentProfile() || 'discovery'`
// for its own bootstrapping convenience, but production `currentProfile === null`
// (session not yet initialized, or a code path that forgot to set it) must
// stay safe — no inject — rather than risk leaking the evidence block into
// prompts for any non-discovery/sales profile.
function resolveSuggestionProfile(profile) {
    if (profile === 'discovery' || profile === 'sales') return profile;
    return null;
}

// Build the 5-element / BANT evidence block prepended to the AI suggestion
// prompt. Mirrors the labels in AssistantView's discovery-progress strip
// so UI and LLM see the same vocabulary, and pairs each Japanese element
// with its BANT equivalent so the prompt connects directly to the policy
// rules baked into the system prompt (prompts.js #会話の優先順位).
//
// Status comes from discoveryEvidenceStore.getState() (5 tiers:
// empty < partial < candidate < detected < confirmed):
//   - 'empty'     → label only
//   - 'partial'   → label + most recent quote (truncated to 40 chars)
//   - 'candidate' → 'candidate（仮・未合意・要確認）' + most recent quote
//                   (tentative / not agreed / conflicting value — the model
//                   must not state it as settled)
//   - 'detected'  → label + most recent quote (affirmative evidence in the
//                   conversation, not yet confirmed with the customer; this
//                   is what external validation calls "confirmed")
//   - 'confirmed' → label + most recent quote (only the user's manual ✓)
//
// The trailing instruction is intentionally minimal — eventKind-specific
// output shaping ("返答候補" vs "次に聞くとよいこと", forbidden sections on
// self_finished, etc.) stays in prompts.js system prompt + the
// stripForbiddenSections / ensureSectionHeaders post-processors. Keeping
// that logic in one place avoids double-management between the user-prompt
// block and the system prompt.
//
// Phase 2.D reframe: the instruction explicitly demotes 5要素 / BANT from
// "drive the suggestion" to "background quality indicator". Surfacing
// rules (when to put a BANT residual in 第1項目) live in the system
// prompt — this block just hands the model the measured values and
// reminds it not to repeat-question confirmed elements. Pre-2.D wording
// said "第1項目は empty/partial から選べ" which combined with the system
// prompt's now-removed "BANT 厳守" rule to over-prioritize budget /
// decision-maker / timeline questions during normal pain-探り flow.
const EVIDENCE_LABELS = {
    pain: ['課題', 'Need 痛み'],
    kpi: ['KPI', 'Need 規模'],
    authority: ['決裁', 'Authority'],
    budget: ['予算', 'Budget'],
    timeline: ['期限', 'Timeline'],
};
const EVIDENCE_ORDER = ['pain', 'kpi', 'authority', 'budget', 'timeline'];
const EVIDENCE_QUOTE_MAX = 40;
// Statuses that need a qualifier in the prompt. Everything else is printed
// verbatim (empty / partial / detected / confirmed).
const EVIDENCE_STATUS_LABELS = {
    candidate: 'candidate（仮・未合意・要確認）',
};

function buildEvidenceBlock(evidenceState) {
    if (!evidenceState || !evidenceState.elements) return '';
    const lines = EVIDENCE_ORDER.map(key => {
        const el = evidenceState.elements[key];
        const status = (el && el.status) || 'empty';
        const [jp, bant] = EVIDENCE_LABELS[key];
        if (status === 'empty') return `- ${jp} (${bant}): empty`;
        // Retracted / superseded rows and the retraction marker row are history,
        // not the current value — quote only the newest live row (isLiveRow).
        const evList = ((el && el.evidence) || []).filter(isLiveRow);
        const lastQuote = evList.length > 0 ? evList[evList.length - 1].text : '';
        const snippet = lastQuote ? ` ・ 直近: "${lastQuote.slice(0, EVIDENCE_QUOTE_MAX)}"` : '';
        return `- ${jp} (${bant}): ${EVIDENCE_STATUS_LABELS[status] || status}${snippet}`;
    });
    return (
        `# ヒアリング進捗 (5要素 / BANT 実測、背景チェック指標)\n` +
        lines.join('\n') +
        `\n→ 5要素 / BANT は会話品質を測る背景チェック。通常は会話の流れを最優先し、` +
        `confirmed 要素の重複質問だけ避ける。detected は候補であり未確認なので、自然な流れで一言確認する質問を混ぜてよい。` +
        `candidate は仮・未合意・競合なので、確認質問の優先度を上げる（値を断定して話さない）。` +
        `自分が解決策提示済 / 相手が BANT 関連表現 (予算・決裁・期限等) に触れた / 次アクションへ進む段階でだけ、` +
        `未確認要素を「次に聞くとよいこと」に自然に補う。\n\n`
    );
}

// Pure prompt builder. When `profile` resolves to discovery/sales AND
// `evidenceState` is supplied, prepend the 5-element / BANT block to the
// existing "直近の対話" + "イベント" structure. All other profiles get the
// unchanged prompt — verified by suggestionPrompt.test.js.
function buildSuggestionPrompt({ recent, eventKind, last, profile, evidenceState }) {
    const resolved = resolveSuggestionProfile(profile);
    const evidenceBlock = resolved ? buildEvidenceBlock(evidenceState) : '';
    return evidenceBlock + `# 商談の直近の対話\n${recent}\n\n` + `# 今回のイベント\n${eventKind} (直近の発話: ${last ? last.speaker : 'none'})`;
}

module.exports = {
    resolveSuggestionProfile,
    buildEvidenceBlock,
    buildSuggestionPrompt,
    // Exposed for tests / future callers that need the canonical label set
    // (e.g. AssistantView could in principle re-use these instead of its own
    // local labels dict — out of scope for Phase 2.A).
    EVIDENCE_LABELS,
    EVIDENCE_ORDER,
    EVIDENCE_QUOTE_MAX,
};
