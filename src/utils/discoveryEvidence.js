// discoveryEvidence.js — Phase 1.A Discovery 5-element evidence extraction.
//
// Pure CommonJS module with no Electron / Gemini / IPC dependencies — same
// shape as turnEvents.js. gemini.js holds the only instance via
// createDiscoveryEvidence() and re-pushes the snapshot to the renderer over
// the new `discovery-evidence-update` IPC channel whenever a turn matches.
//
// Goal: surface a Japanese-only progress bar for the 5 hearing elements that
// the Discovery / Sales prompts already track internally (see prompts.js
// L55-62 and the BANT block at L347-378). regex stays as the instant
// first-pass — LLM hybrid refinement (Phase 1.A+) lands via applyLLMResult()
// and overrides regex state when grounded against the transcript.
//
// Vocabulary policy: keyword / regex stay Japanese-focused with a small set
// of business acronyms (KPI / ROI / KGI / CVR) used verbatim in Japanese B2B
// speech. Generic English fallbacks (problem / deadline / cost) remain
// forbidden — the long tail of business vocabulary (利益率 / 継続率 / 単価 /
// NPS / シェア etc.) is delegated to LLM refinement, NOT to regex expansion.

'use strict';

const ELEMENT_KEYS = ['pain', 'kpi', 'authority', 'budget', 'timeline'];

// Partial: opponent mentioned the topic (keyword hit) but specifics may be
// missing. Filled: opponent quantified or named concrete decision-makers /
// dates / amounts. Both regex sets are evaluated against opponent.text only.
// KPI vocab is intentionally narrow (件 / 工数 / リードタイム / 稼働 / 商談数 /
// 受注率 etc.) — bare 日 / 月 / 年 belong to timeline, 円 / 万 / 億 to budget,
// and 人 / 人手 to pain. Letting any of those bleed into KPI causes "3月末" or
// "500万円" to falsely fill the KPI badge alongside the correct element.
const PARTIAL_PATTERNS = {
    pain: /困っ|悩|課題|問題|大変|疲弊|限界|属人|手作業|ミス|漏れ|失敗|遅[いれ]|止ま|追いつか|不足|離職|人手|人材/,
    // KPI / ROI / KGI literals are accepted because real B2B Japanese
    // transcripts use these acronyms verbatim. The actual figure (利益率,
    // CVR, 継続率, 単価, NPS, シェア etc.) is left to LLM refinement.
    kpi: /件|工数|リードタイム|稼働|商談数|受注率|解約率|離職率|CVR|工程|業務量|処理量|生産性|時間|KPI|ROI|KGI/,
    // 決済 is accepted as an STT homophone of 決裁 — Deepgram nova-3 commonly
    // mis-transcribes 決裁 as 決済 in Japanese business speech.
    authority: /決裁|決済|決定|承認|役員|取締役|部長|課長|マネージャ|社長|稟議|経営会議|常務|専務|本部長|関係部署/,
    budget: /予算|コスト|費用|投資|ROI|回収|償却|申請|稟議枠|既存予算/,
    timeline: /来月|今期|期末|来年度|上期|下期|Q[1-4]|期限|締切|スケジュール|急ぎ|緊急|までに|今年中|年内/,
};

// Numeric matchers accept either ASCII digits or 漢数字 (一二三四五六七八九十百千万億).
// Real Japanese sales speech mixes both forms ("一千万円" vs "10000000円").
const FILLED_PATTERNS = {
    pain: /(?:営業|経理|開発|人事|総務|事務|現場|工場|店舗|物流|サポート|顧客対応|採用|請求|決算|月次|年次).{0,20}(?:困|大変|疲弊|属人|遅|止|手作業|ミス|漏れ)|できない|難しい/,
    kpi: /(?:\d+|[一二三四五六七八九十百千万億]+)\s*(?:件|時間|工数|％|%)/,
    authority: /(?:役員|取締役|部長|課長|マネージャ|社長|常務|専務|本部長).{0,12}(?:が|は|で)?(?:決め|判断|承認|です|になり|担当)/,
    budget: /(?:\d+|[一二三四五六七八九十百千万億]+)\s*(?:円|万円|千万|億|億円)/,
    timeline:
        /(?:\d+|[一二三四五六七八九十百千万億]+)\s*月(?:末|まで|頃)?|\d+\/\d+|(?:\d+|[一二三四五六七八九十百千万億]+)\s*年度|までに.{0,20}(?:したい|必要|決めたい|入れたい)/,
};

const MAX_EVIDENCE_PER_ELEMENT = 10;

// Quote-grounding normalizer: strips whitespace and Japanese / ASCII
// punctuation so STT and LLM rephrasings of the same quote still match
// against the underlying transcript. Used by quoteIsGrounded() to defend
// against LLM hallucinations (the LLM occasionally invents quotes that
// were not actually said).
const GROUNDING_NORMALIZE_RE = /[\s　、。．，「」『』()（）\[\]【】〈〉《》]/g;

function normalizeForGrounding(s) {
    if (typeof s !== 'string') return '';
    return s.replace(GROUNDING_NORMALIZE_RE, '');
}

function quoteIsGrounded(quote, transcript) {
    const nq = normalizeForGrounding(quote);
    if (nq.length === 0) return false;
    const nt = normalizeForGrounding(transcript);
    return nt.includes(nq);
}

function createInitialState() {
    return ELEMENT_KEYS.reduce((acc, key) => {
        acc[key] = { status: 'empty', evidence: [], selfMentions: [], lastUpdate: null };
        return acc;
    }, {});
}

// Returns `'concrete'` (filled hit), `'keyword'` (partial hit only), or null.
function matchElement(key, text) {
    if (!text || typeof text !== 'string') return null;
    if (FILLED_PATTERNS[key].test(text)) return 'concrete';
    if (PARTIAL_PATTERNS[key].test(text)) return 'keyword';
    return null;
}

function computeStatus(evidence) {
    if (evidence.length === 0) return 'empty';
    if (evidence.some(e => e.specificity === 'concrete')) return 'filled';
    return 'partial';
}

function deepCloneState(state) {
    return ELEMENT_KEYS.reduce((acc, key) => {
        acc[key] = {
            status: state[key].status,
            evidence: state[key].evidence.map(e => ({ ...e })),
            selfMentions: state[key].selfMentions.map(e => ({ ...e })),
            lastUpdate: state[key].lastUpdate,
        };
        return acc;
    }, {});
}

function totalScore(state) {
    return ELEMENT_KEYS.filter(key => state[key].status === 'filled').length;
}

function createDiscoveryEvidence(options = {}) {
    const now = options.now || (() => Date.now());
    let state = createInitialState();

    function dump() {
        return {
            elements: deepCloneState(state),
            totalScore: totalScore(state),
            updatedAt: now(),
        };
    }

    function processNewTurn(event) {
        if (!event || !event.text) return { state: dump(), changed: false };
        const speaker = event.speaker;
        if (speaker !== 'opponent' && speaker !== 'self') {
            return { state: dump(), changed: false };
        }
        const text = String(event.text).trim();
        if (!text) return { state: dump(), changed: false };
        const ts = event.timestamp != null ? event.timestamp : now();

        let anyMatch = false;
        for (const key of ELEMENT_KEYS) {
            const specificity = matchElement(key, text);
            if (!specificity) continue;
            anyMatch = true;
            if (speaker === 'opponent') {
                state[key].evidence.push({ text, timestamp: ts, specificity, source: 'regex' });
                if (state[key].evidence.length > MAX_EVIDENCE_PER_ELEMENT) {
                    state[key].evidence = state[key].evidence.slice(-MAX_EVIDENCE_PER_ELEMENT);
                }
                state[key].status = computeStatus(state[key].evidence);
            } else {
                // speaker === 'self' — track to selfMentions channel only.
                // No source field (always regex here); no status mutation
                // (status reflects opponent-confirmed evidence per Phase 2.B
                // contract — self never upgrades the badge).
                state[key].selfMentions.push({ text, timestamp: ts, specificity });
                if (state[key].selfMentions.length > MAX_EVIDENCE_PER_ELEMENT) {
                    state[key].selfMentions = state[key].selfMentions.slice(-MAX_EVIDENCE_PER_ELEMENT);
                }
            }
            state[key].lastUpdate = ts;
        }

        return { state: dump(), changed: anyMatch };
    }

    // Apply LLM refinement output. llmResult shape:
    //   { pain: { status, quote }, kpi: ..., authority: ..., budget: ..., timeline: ... }
    // Each element with status 'partial' or 'filled' contributes a new
    // evidence row IFF the quote can be grounded against the supplied
    // transcript. status 'empty' is a no-op (we never downgrade — regex
    // remains the floor, LLM only upgrades / refines).
    function applyLLMResult(llmResult, transcript) {
        if (!llmResult || typeof llmResult !== 'object') {
            return { state: dump(), changed: false };
        }
        const ts = now();
        const transcriptStr = typeof transcript === 'string' ? transcript : '';
        let anyChange = false;
        for (const key of ELEMENT_KEYS) {
            const r = llmResult[key];
            if (!r || typeof r !== 'object') continue;
            if (r.status !== 'partial' && r.status !== 'filled') continue;
            const quote = typeof r.quote === 'string' ? r.quote.trim() : '';
            if (!quote) continue;
            if (!quoteIsGrounded(quote, transcriptStr)) continue;
            const specificity = r.status === 'filled' ? 'concrete' : 'keyword';
            state[key].evidence.push({ text: quote, timestamp: ts, specificity, source: 'llm' });
            if (state[key].evidence.length > MAX_EVIDENCE_PER_ELEMENT) {
                state[key].evidence = state[key].evidence.slice(-MAX_EVIDENCE_PER_ELEMENT);
            }
            state[key].status = computeStatus(state[key].evidence);
            state[key].lastUpdate = ts;
            anyChange = true;
        }
        return { state: dump(), changed: anyChange };
    }

    function getState() {
        return dump();
    }

    function reset() {
        state = createInitialState();
    }

    return {
        processNewTurn,
        applyLLMResult,
        getState,
        dump,
        reset,
        get totalScore() {
            return totalScore(state);
        },
    };
}

module.exports = {
    createDiscoveryEvidence,
    ELEMENT_KEYS,
    matchElement,
    normalizeForGrounding,
    quoteIsGrounded,
    PARTIAL_PATTERNS,
    FILLED_PATTERNS,
    MAX_EVIDENCE_PER_ELEMENT,
};
