// discoveryEvidenceLLM.js — Phase 1.A+ LLM hybrid refiner.
//
// Pure CommonJS. No Electron / IPC / direct Gemini SDK import — gemini.js
// owns one instance and injects an llmClient adapter (typically a thin
// wrapper over @google/genai's generateContent). The applyResult callback
// is wired to the discoveryEvidence store's applyLLMResult().
//
// Design: regex (in discoveryEvidence.js) stays as the instant first-pass
// for badge updates. This module fires async, debounced, capped, and
// gated on providerMode === 'byok' — the only mode where transcripts
// already leave the device for AI response. 'local' (Ollama) and 'cloud'
// (Groq) modes skip refinement entirely; the bar stays at regex-only
// state (degraded but functional). This preserves the WhisperOhKAMI
// privacy / local-first product axis.

'use strict';

const { ELEMENT_KEYS } = require('./discoveryEvidence');

const COOLDOWN_MS = 30_000;
const TURN_THRESHOLD = 5;
const MAX_CALLS_PER_SESSION = 20;
const TRANSCRIPT_TURN_LIMIT = 20;

// PR-γ (Phase 2.B): policy gate for which turn events warrant a refiner
// notification. The 5 elements (pain / KPI / decision-maker / budget /
// timeline) come from *customer* utterances by definition — self turns
// are pitch, ack, or filler that never contain new evidence for them.
// Calling notifyTurn() on self turns therefore:
//   1. wastes a slot toward MAX_CALLS_PER_SESSION,
//   2. inflates the TURN_THRESHOLD counter so the next refiner call fires
//      on stale (mostly-self) context,
//   3. in the worst case spends a BYOK Gemini call on guaranteed no-op
//      work when the cooldown happens to be expired.
//
// Lives here (not at the call site in gemini.js) so the contract is
// pinned by a unit test and any future refiner / scheduler change has
// one obvious place to consult. Scope is intentionally narrow to the
// LLM refiner — the regex side in discoveryEvidence.js#processNewTurn
// has different speed/coverage trade-offs and is out of scope for this PR.
function shouldNotifyDiscoveryLLMRefiner(event) {
    return !!(event && event.speaker === 'opponent');
}

const PROMPT_HEADER = [
    'B2B商談の事実確認担当として、下記の対話履歴の opponent 発話から 5 要素を判定してください。',
    '',
    '5要素:',
    '- pain (課題・痛み): 何に困っているか、どの業務が止まっているか',
    '- kpi (KPI / 業務量): どれくらいの規模で困っているか (件数 / 工数 / 利益率 / 継続率 / 単価 / NPS / CVR / シェア / 稼働率 等の業界 KPI)',
    '- authority (決裁構造): 予算判断者・関係部署・上司・上長 (役職 + 動詞「決める/判断/承認/担当」が揃えば filled)',
    '- budget (予算感): 年間予算枠・想定投資額・ROI 閾値 (具体的金額があれば filled)',
    '- timeline (期限・タイミング): いつまでに決めたいか (具体的時期があれば filled)',
    '',
    '判定値:',
    '- "empty": 言及なし',
    '- "partial": 言及あるが具体性弱い',
    '- "filled": 具体的な数値・固有名・期日が出ている',
    '',
    'quote は該当する opponent 発話を transcript から原文ママで返す (substring が後で transcript と照合される)。無ければ空文字。',
    '',
    '直近の対話:',
].join('\n');

const PROMPT_FOOTER = [
    '',
    'JSON のみで返答 (他文出力禁止):',
    '{',
    '  "pain": {"status": "...", "quote": "..."},',
    '  "kpi": {"status": "...", "quote": "..."},',
    '  "authority": {"status": "...", "quote": "..."},',
    '  "budget": {"status": "...", "quote": "..."},',
    '  "timeline": {"status": "...", "quote": "..."}',
    '}',
].join('\n');

function buildPrompt(transcript) {
    return `${PROMPT_HEADER}\n${transcript}\n${PROMPT_FOOTER}`;
}

// Extract a 5-element JSON object from raw LLM output. Tolerates surrounding
// text and ```json fences. Returns null if no valid shape is found. Each
// element with an unknown status is dropped (NOT defaulted to empty).
function parseLLMResponse(text) {
    if (!text || typeof text !== 'string') return null;
    let candidate = text.trim();
    const fenceMatch = candidate.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) candidate = fenceMatch[1].trim();
    let parsed;
    try {
        parsed = JSON.parse(candidate);
    } catch (_) {
        const objMatch = candidate.match(/\{[\s\S]*\}/);
        if (!objMatch) return null;
        try {
            parsed = JSON.parse(objMatch[0]);
        } catch (_) {
            return null;
        }
    }
    if (!parsed || typeof parsed !== 'object') return null;
    const result = {};
    for (const key of ELEMENT_KEYS) {
        const r = parsed[key];
        if (!r || typeof r !== 'object') continue;
        const status = typeof r.status === 'string' ? r.status : null;
        if (status !== 'empty' && status !== 'partial' && status !== 'filled') continue;
        const quote = typeof r.quote === 'string' ? r.quote : '';
        result[key] = { status, quote };
    }
    return Object.keys(result).length > 0 ? result : null;
}

function createDiscoveryEvidenceLLM(deps = {}) {
    const { llmClient, getTranscript = () => '', getProviderMode = () => 'byok', applyResult = () => {}, log = () => {} } = deps;
    const now = deps.now || (() => Date.now());

    let lastRunAt = 0;
    let inFlight = false;
    let callCount = 0;
    let turnsSinceLastRun = 0;

    function notifyTurn() {
        turnsSinceLastRun++;
    }

    function reset() {
        lastRunAt = 0;
        inFlight = false;
        callCount = 0;
        turnsSinceLastRun = 0;
    }

    function getStats() {
        return { lastRunAt, inFlight, callCount, turnsSinceLastRun };
    }

    async function maybeRefine() {
        // Hard gates first (cheapest checks that block unconditionally).
        if (getProviderMode() !== 'byok') return { fired: false, reason: 'privacy-gate' };
        if (inFlight) return { fired: false, reason: 'in-flight' };
        if (callCount >= MAX_CALLS_PER_SESSION) return { fired: false, reason: 'cap-exceeded' };

        const t = now();
        const cooldownPassed = t - lastRunAt >= COOLDOWN_MS;
        const turnThresholdPassed = turnsSinceLastRun >= TURN_THRESHOLD;
        if (!cooldownPassed && !turnThresholdPassed) {
            return { fired: false, reason: 'cooldown' };
        }
        if (turnsSinceLastRun === 0) return { fired: false, reason: 'no-new-turns' };

        const transcript = String(getTranscript() || '').trim();
        if (!transcript) return { fired: false, reason: 'empty-transcript' };

        inFlight = true;
        callCount++;
        lastRunAt = t;
        turnsSinceLastRun = 0;
        try {
            if (!llmClient || typeof llmClient.generateContent !== 'function') {
                throw new Error('llmClient.generateContent missing');
            }
            const prompt = buildPrompt(transcript);
            const raw = await llmClient.generateContent(prompt);
            const parsed = parseLLMResponse(raw);
            if (!parsed) {
                log('[discoveryEvidenceLLM] parse failed; raw head:', String(raw || '').slice(0, 200));
                return { fired: true, applied: false, reason: 'parse-failed' };
            }
            applyResult(parsed, transcript);
            return { fired: true, applied: true, parsed };
        } catch (err) {
            log('[discoveryEvidenceLLM] call failed:', err && err.message);
            return { fired: true, applied: false, reason: 'error', error: err && err.message };
        } finally {
            inFlight = false;
        }
    }

    return { notifyTurn, maybeRefine, reset, getStats };
}

module.exports = {
    createDiscoveryEvidenceLLM,
    buildPrompt,
    parseLLMResponse,
    shouldNotifyDiscoveryLLMRefiner,
    COOLDOWN_MS,
    TURN_THRESHOLD,
    MAX_CALLS_PER_SESSION,
    TRANSCRIPT_TURN_LIMIT,
};
