// discoveryPhase.js — Phase 3.B / B-2: client-side Discovery phase indicator.
//
// Computes the current Discovery conversation phase from the renderer's
// `transcriptionSegments` array (`AssistantView.transcriptionSegments`).
// Mirrors the Phase 2.D prompt rule that gates BANT first-priority to
// 3 specific triggers — but as a shadow indicator only (the AI prompt
// itself already enforces the rule on the LLM side).
//
// Loaded two ways (UMD, same as evidenceInspector.js — Phase 3.A.1):
//   - Jest: `require('.../discoveryPhase')` → module.exports
//   - Renderer: `<script src="utils/discoveryPhase.js">` → window.discoveryPhase
//
// No DOM / no Electron deps — pure function over an array.

'use strict';

const RECENT_SEGMENTS_WINDOW = 20;

// Trigger (b) — opponent voluntarily mentions BANT-adjacent term.
// Keep aligned with prompts.js Phase 2.D wording; small drift is OK
// since prompts.js is LLM instruction and this is renderer heuristic.
const OPPONENT_BANT_RE = /予算|コスト|決裁|導入|いつまでに|スケジュール|判断|決定/;

// Trigger (a) — self pitched solution / value proposition.
// Heuristic: a self segment containing solution / case / function keywords.
// Pure acks ("はい" / "なるほど") are excluded by minimum-length check.
const SELF_PITCH_RE = /ご紹介|事例|機能|実績|削減|改善|実証|提案/;
const SELF_MIN_PITCH_LEN = 10;

// Trigger (c) — moving toward next-action / closing.
// '持ち帰' matches both 持ち帰り (連用形/名詞) and 持ち帰って (te-form).
const CLOSING_RE = /持ち帰|次回|ご提案|お見積り|ご検討/;

const PHASE_META = {
    digging: {
        label: '探り中',
        title: '痛み掘り段階。AI は BANT 質問を保留し、課題の深掘りを優先します。',
        tone: 'neutral',
    },
    bant_unlocked: {
        label: 'BANT 解禁',
        title: 'BANT (予算 / 決裁 / 期限) を聞き出してよい段階に達しました。',
        tone: 'accent',
    },
    closing: {
        label: 'クロージング',
        title: '次アクション / クロージングフェーズ。BANT 確認や持ち帰りを促す質問が適切です。',
        tone: 'success',
    },
};

function computeDiscoveryPhase(input) {
    const segments = input && Array.isArray(input.segments) ? input.segments : [];
    if (segments.length === 0) return 'digging';

    const recent = segments.slice(-RECENT_SEGMENTS_WINDOW);

    // Closing takes priority — appears later in flow, dominant signal.
    let sawBant = false;
    let sawSelfPitch = false;

    for (const seg of recent) {
        if (!seg || typeof seg.text !== 'string') continue;
        // 'output' / 'system' types are AI responses, not human speech — skip.
        if (seg.type && seg.type !== 'input') continue;
        const text = seg.text;
        const isOpponent = seg.speakerId === 1;
        const isSelf = seg.speakerId === 2;

        if (CLOSING_RE.test(text)) return 'closing';
        if (isOpponent && OPPONENT_BANT_RE.test(text)) sawBant = true;
        if (isSelf && text.length >= SELF_MIN_PITCH_LEN && SELF_PITCH_RE.test(text)) sawSelfPitch = true;
    }

    if (sawBant || sawSelfPitch) return 'bant_unlocked';
    return 'digging';
}

function getPhaseMeta(phase) {
    return PHASE_META[phase] || PHASE_META.digging;
}

const _discoveryPhaseApi = { computeDiscoveryPhase, getPhaseMeta, RECENT_SEGMENTS_WINDOW };

if (typeof module !== 'undefined' && module.exports) {
    module.exports = _discoveryPhaseApi;
}
if (typeof window !== 'undefined') {
    window.discoveryPhase = _discoveryPhaseApi;
}
