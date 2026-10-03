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
    '- "empty": 言及なし、または撤回・否定された',
    '- "partial": 言及あるが具体性弱い',
    '- "filled": 具体的な数値・固有名・期日が出ている',
    '',
    '否定・仮定・他社の話・撤回された内容は filled にしない。撤回・否定された要素は status を empty にし、その撤回・否定の発話を quote に入れる。',
    '',
    'quote は該当する opponent 発話を transcript から原文ママで返す (substring が後で transcript と照合される)。言及が全く無い empty の場合だけ quote は空文字。',
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
// element with an unknown status is dropped (NOT defaulted to empty). An
// 'empty' status may carry a non-empty quote (the retraction / negation
// utterance) — applyLLMResult uses it for a grounded downgrade.
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
    let generation = 0;
    let callCount = 0;
    let turnsSinceLastRun = 0;
    // Same-session freshness: a maybeRefine() that lands while a call is in
    // flight records one pending rerun (coalesced — never a queue). Each
    // call carries a revision; a result older than one already applied is
    // never applied.
    let pendingRerun = false;
    let callRevision = 0;
    let appliedRevision = 0;

    function notifyTurn() {
        turnsSinceLastRun++;
    }

    function reset() {
        generation++;
        lastRunAt = 0;
        inFlight = false;
        callCount = 0;
        turnsSinceLastRun = 0;
        pendingRerun = false;
    }

    function getStats() {
        return { lastRunAt, inFlight, callCount, turnsSinceLastRun, generation, pendingRerun };
    }

    async function maybeRefine() {
        // Hard gates first (cheapest checks that block unconditionally).
        if (getProviderMode() !== 'byok') return { fired: false, reason: 'privacy-gate' };
        if (inFlight) {
            pendingRerun = true;
            return { fired: false, reason: 'in-flight', pending: true };
        }
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
        return runCall(transcript);
    }

    // The coalesced rerun skips the cooldown / turn threshold (the request
    // already passed them while the previous call was in flight) but keeps
    // the privacy gate and the per-session cap.
    async function runPendingRerun() {
        if (getProviderMode() !== 'byok') return { fired: false, reason: 'privacy-gate' };
        if (callCount >= MAX_CALLS_PER_SESSION) return { fired: false, reason: 'cap-exceeded' };
        const transcript = String(getTranscript() || '').trim();
        if (!transcript) return { fired: false, reason: 'empty-transcript' };
        return runCall(transcript);
    }

    async function runCall(transcript) {
        inFlight = true;
        const gen = generation;
        const rev = ++callRevision;
        callCount++;
        lastRunAt = now();
        turnsSinceLastRun = 0;
        let result;
        try {
            if (!llmClient || typeof llmClient.generateContent !== 'function') {
                throw new Error('llmClient.generateContent missing');
            }
            const prompt = buildPrompt(transcript);
            const raw = await llmClient.generateContent(prompt);
            if (gen !== generation) {
                log('[discoveryEvidenceLLM] stale result dropped (generation changed during call)');
                return { fired: true, applied: false, reason: 'stale' };
            }
            const parsed = parseLLMResponse(raw);
            if (!parsed) {
                // The raw output can echo transcript text — only with WOK_DEBUG=1.
                if (process.env.WOK_DEBUG === '1') {
                    log('[discoveryEvidenceLLM] parse failed; raw head:', String(raw || '').slice(0, 200));
                } else {
                    log('[discoveryEvidenceLLM] parse failed', { chars: String(raw || '').length });
                }
                result = { fired: true, applied: false, reason: 'parse-failed' };
            } else if (rev < appliedRevision || (pendingRerun && turnsSinceLastRun > 0)) {
                // Newer turns arrived while this call was in flight (or a newer
                // call already applied): the rerun below sees the newest
                // transcript, so this older result is not applied.
                result = { fired: true, applied: false, reason: 'superseded', parsed };
            } else {
                applyResult(parsed, transcript);
                appliedRevision = rev;
                result = { fired: true, applied: true, parsed };
            }
        } catch (err) {
            log('[discoveryEvidenceLLM] call failed:', err && err.message);
            result = { fired: true, applied: false, reason: 'error', error: err && err.message };
        } finally {
            if (gen === generation) inFlight = false;
        }
        if (gen === generation && pendingRerun) {
            pendingRerun = false;
            if (turnsSinceLastRun > 0) result.rerun = await runPendingRerun();
        }
        return result;
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
