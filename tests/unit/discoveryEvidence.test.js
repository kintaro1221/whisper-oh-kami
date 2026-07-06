// discoveryEvidence.js unit tests — Stage 1 of Phase 1.A.
//
// These tests pin the keyword / regex behavior of the 5-element extractor.
// The injected `now` callback lets tests pin timestamps deterministically
// without fake timers (matches turnEvents.test.js style).

const { createDiscoveryEvidence, ELEMENT_KEYS, matchElement } = require('../../src/utils/discoveryEvidence');

function makeClock(start = 1_700_000_000_000) {
    let t = start;
    const fn = () => t;
    fn.advance = ms => {
        t += ms;
    };
    return fn;
}

// ── initialization ────────────────────────────────────────────────────────

describe('createDiscoveryEvidence.initial state', () => {
    test('all 5 elements start empty with no evidence', () => {
        const store = createDiscoveryEvidence();
        const state = store.getState();
        expect(state.totalScore).toBe(0);
        expect(Object.keys(state.elements).sort()).toEqual([...ELEMENT_KEYS].sort());
        for (const key of ELEMENT_KEYS) {
            expect(state.elements[key].status).toBe('empty');
            expect(state.elements[key].evidence).toEqual([]);
            expect(state.elements[key].lastUpdate).toBeNull();
        }
    });

    test('updatedAt reflects injected clock', () => {
        const clock = makeClock();
        const store = createDiscoveryEvidence({ now: clock });
        clock.advance(5000);
        expect(store.getState().updatedAt).toBe(1_700_000_005_000);
    });
});

// ── opponent → element transitions ─────────────────────────────────────────

describe('createDiscoveryEvidence.processNewTurn (opponent)', () => {
    test('opponent pain confession → pain becomes partial', () => {
        const store = createDiscoveryEvidence({ now: makeClock() });
        const result = store.processNewTurn({
            speaker: 'opponent',
            text: '人手不足で疲弊しています',
            source: 'gemini_live',
        });
        expect(result.changed).toBe(true);
        expect(result.state.elements.pain.status).toBe('partial');
        expect(result.state.elements.pain.evidence).toHaveLength(1);
        expect(result.state.elements.pain.evidence[0].specificity).toBe('keyword');
        expect(result.state.elements.pain.evidence[0].text).toBe('人手不足で疲弊しています');
    });

    test('opponent quantified scale → kpi becomes filled', () => {
        const store = createDiscoveryEvidence({ now: makeClock() });
        const result = store.processNewTurn({
            speaker: 'opponent',
            text: '月100件処理しています',
            source: 'gemini_live',
        });
        expect(result.state.elements.kpi.status).toBe('filled');
        expect(result.state.elements.kpi.evidence[0].specificity).toBe('concrete');
        expect(result.state.totalScore).toBe(1);
    });

    test('opponent role mention only → authority becomes partial', () => {
        const store = createDiscoveryEvidence({ now: makeClock() });
        const result = store.processNewTurn({
            speaker: 'opponent',
            text: '部長と相談します',
            source: 'gemini_live',
        });
        expect(result.state.elements.authority.status).toBe('partial');
    });

    test('opponent role + decision verb → authority becomes filled', () => {
        const store = createDiscoveryEvidence({ now: makeClock() });
        const result = store.processNewTurn({
            speaker: 'opponent',
            text: '最終判断は社長になります',
            source: 'gemini_live',
        });
        expect(result.state.elements.authority.status).toBe('filled');
        expect(result.state.totalScore).toBe(1);
    });

    test('opponent budget amount → budget becomes filled', () => {
        const store = createDiscoveryEvidence({ now: makeClock() });
        const result = store.processNewTurn({
            speaker: 'opponent',
            text: '年間予算500万円です',
            source: 'gemini_live',
        });
        expect(result.state.elements.budget.status).toBe('filled');
        expect(result.state.elements.budget.evidence[0].specificity).toBe('concrete');
    });

    test('opponent date phrase → timeline becomes filled', () => {
        const store = createDiscoveryEvidence({ now: makeClock() });
        const result = store.processNewTurn({
            speaker: 'opponent',
            text: '3月末までに導入したい',
            source: 'gemini_live',
        });
        expect(result.state.elements.timeline.status).toBe('filled');
    });

    test('partial → filled progression accumulates evidence', () => {
        const store = createDiscoveryEvidence({ now: makeClock() });
        const r1 = store.processNewTurn({
            speaker: 'opponent',
            text: '予算については慎重に検討しています',
            source: 'gemini_live',
        });
        expect(r1.state.elements.budget.status).toBe('partial');

        const r2 = store.processNewTurn({
            speaker: 'opponent',
            text: '500万円程度を考えています',
            source: 'gemini_live',
        });
        expect(r2.state.elements.budget.status).toBe('filled');
        expect(r2.state.elements.budget.evidence).toHaveLength(2);
    });

    test('multi-element single utterance updates several at once', () => {
        const store = createDiscoveryEvidence({ now: makeClock() });
        const result = store.processNewTurn({
            speaker: 'opponent',
            text: '年間予算500万円で月100件処理しています',
            source: 'gemini_live',
        });
        expect(result.state.elements.budget.status).toBe('filled');
        expect(result.state.elements.kpi.status).toBe('filled');
        expect(result.state.totalScore).toBe(2);
    });
});

// ── speaker filter (self ignored) ─────────────────────────────────────────

describe('createDiscoveryEvidence.processNewTurn — non-opponent speakers', () => {
    test('self speech with matching keywords does NOT mutate evidence/status (Phase 3.B selfMentions channel only)', () => {
        // Phase 3.B.1: self speech now writes to the parallel selfMentions
        // channel, but evidence/status remain opponent-only. The Phase 2.B
        // contract (status reflects opponent-confirmed evidence) is preserved.
        const store = createDiscoveryEvidence({ now: makeClock() });
        const result = store.processNewTurn({
            speaker: 'self',
            text: 'はい、500万円ですね',
            source: 'deepgram',
        });
        expect(result.state.totalScore).toBe(0);
        expect(result.state.elements.budget.status).toBe('empty');
        expect(result.state.elements.budget.evidence).toEqual([]);
    });

    test('blank or missing text does not change state', () => {
        const store = createDiscoveryEvidence({ now: makeClock() });
        expect(store.processNewTurn({ speaker: 'opponent', text: '   ' }).changed).toBe(false);
        expect(store.processNewTurn({ speaker: 'opponent', text: '' }).changed).toBe(false);
        expect(store.processNewTurn({ speaker: 'opponent' }).changed).toBe(false);
        expect(store.processNewTurn(null).changed).toBe(false);
        expect(store.getState().totalScore).toBe(0);
    });
});

// ── reset ────────────────────────────────────────────────────────────────

describe('createDiscoveryEvidence.reset', () => {
    test('reset() clears all elements back to empty', () => {
        const store = createDiscoveryEvidence({ now: makeClock() });
        store.processNewTurn({
            speaker: 'opponent',
            text: '年間予算500万円で月100件処理しています',
            source: 'gemini_live',
        });
        expect(store.getState().totalScore).toBeGreaterThan(0);

        store.reset();
        const state = store.getState();
        expect(state.totalScore).toBe(0);
        for (const key of ELEMENT_KEYS) {
            expect(state.elements[key].status).toBe('empty');
            expect(state.elements[key].evidence).toEqual([]);
            expect(state.elements[key].lastUpdate).toBeNull();
        }
    });
});

// ── KPI false-positive guards (post-review tighten 2026-05-10) ──────────

describe('createDiscoveryEvidence — KPI false-positive guards', () => {
    test('"3月末までに導入したい" → timeline filled, KPI stays empty', () => {
        const store = createDiscoveryEvidence({ now: makeClock() });
        const result = store.processNewTurn({
            speaker: 'opponent',
            text: '3月末までに導入したい',
            source: 'gemini_live',
        });
        expect(result.state.elements.timeline.status).toBe('filled');
        expect(result.state.elements.kpi.status).toBe('empty');
    });

    test('"2026年度までに決めたい" → timeline filled, KPI stays empty', () => {
        const store = createDiscoveryEvidence({ now: makeClock() });
        const result = store.processNewTurn({
            speaker: 'opponent',
            text: '2026年度までに決めたい',
            source: 'gemini_live',
        });
        expect(result.state.elements.timeline.status).toBe('filled');
        expect(result.state.elements.kpi.status).toBe('empty');
    });

    test('"年間500万円です" → budget filled, KPI stays empty', () => {
        const store = createDiscoveryEvidence({ now: makeClock() });
        const result = store.processNewTurn({
            speaker: 'opponent',
            text: '年間500万円です',
            source: 'gemini_live',
        });
        expect(result.state.elements.budget.status).toBe('filled');
        expect(result.state.elements.kpi.status).toBe('empty');
    });

    test('"人手不足で疲弊しています" → pain partial, KPI stays empty', () => {
        const store = createDiscoveryEvidence({ now: makeClock() });
        const result = store.processNewTurn({
            speaker: 'opponent',
            text: '人手不足で疲弊しています',
            source: 'gemini_live',
        });
        expect(result.state.elements.pain.status).toBe('partial');
        expect(result.state.elements.kpi.status).toBe('empty');
    });
});

// ── Vocabulary policy guard ──────────────────────────────────────────────

describe('discoveryEvidence vocabulary policy', () => {
    test('keyword/regex use Japanese-only vocab (no English fallback creep)', () => {
        const { PARTIAL_PATTERNS, FILLED_PATTERNS } = require('../../src/utils/discoveryEvidence');
        const allPatterns = [...Object.values(PARTIAL_PATTERNS), ...Object.values(FILLED_PATTERNS)].map(r => r.source);

        // Generic English fallback nouns stay forbidden. Business acronyms
        // (KPI / ROI / KGI / CVR) are now allowed because real Japanese B2B
        // speech uses them verbatim — see discoveryEvidence.js header.
        const englishWordRe = /(?<![A-Za-z])(?:problem|issue|budget|cost|deadline|decision|authority|priority|need)(?![A-Za-z])/i;
        for (const src of allPatterns) {
            expect(src).not.toMatch(englishWordRe);
        }
    });

    test('matchElement is exported and behaves as a pure function', () => {
        expect(matchElement('pain', '人手不足で疲弊')).toBe('keyword');
        expect(matchElement('kpi', '月100件')).toBe('concrete');
        expect(matchElement('budget', '予算が')).toBe('keyword');
        expect(matchElement('timeline', '雨が降ってきた')).toBeNull();
    });
});

// ── Phase 1.A+ extensions: kanji digits, business acronyms, homophones ──

describe('createDiscoveryEvidence — Phase 1.A+ regex primitives', () => {
    test('"KPIを重視" → kpi partial (literal acronym accepted)', () => {
        const store = createDiscoveryEvidence({ now: makeClock() });
        const r = store.processNewTurn({
            speaker: 'opponent',
            text: 'KPIを重視しています',
            source: 'gemini_live',
        });
        expect(r.state.elements.kpi.status).toBe('partial');
    });

    test('"部長の決済がいります" → authority partial (決済 homophone of 決裁)', () => {
        const store = createDiscoveryEvidence({ now: makeClock() });
        const r = store.processNewTurn({
            speaker: 'opponent',
            text: '部長の決済がいります',
            source: 'gemini_live',
        });
        expect(r.state.elements.authority.status).toBe('partial');
    });

    test('"一千万円" → budget filled (kanji digits)', () => {
        const store = createDiscoveryEvidence({ now: makeClock() });
        const r = store.processNewTurn({
            speaker: 'opponent',
            text: '予算が一千万円程度あります',
            source: 'gemini_live',
        });
        expect(r.state.elements.budget.status).toBe('filled');
    });

    test('"十月末まで" → timeline filled (kanji digits)', () => {
        const store = createDiscoveryEvidence({ now: makeClock() });
        const r = store.processNewTurn({
            speaker: 'opponent',
            text: '十月末までに導入したい',
            source: 'gemini_live',
        });
        expect(r.state.elements.timeline.status).toBe('filled');
    });
});

// ── Phase 1.A+ LLM hybrid: applyLLMResult / quote grounding ──

describe('normalizeForGrounding', () => {
    const { normalizeForGrounding } = require('../../src/utils/discoveryEvidence');

    test('strips ASCII whitespace, full-width space, and Japanese punctuation', () => {
        expect(normalizeForGrounding('予算 は 500万円')).toBe('予算は500万円');
        expect(normalizeForGrounding('予算　は　500万円')).toBe('予算は500万円');
        expect(normalizeForGrounding('予算は、500万円。')).toBe('予算は500万円');
        expect(normalizeForGrounding('「予算は500万円」')).toBe('予算は500万円');
    });

    test('returns empty string for null / non-string', () => {
        expect(normalizeForGrounding(null)).toBe('');
        expect(normalizeForGrounding(undefined)).toBe('');
        expect(normalizeForGrounding(123)).toBe('');
    });
});

describe('createDiscoveryEvidence.applyLLMResult', () => {
    test('LLM filled with grounded quote → element status filled, source: llm', () => {
        const store = createDiscoveryEvidence({ now: makeClock() });
        const transcript = '[相手] 予算は一千万円程度あります';
        const result = store.applyLLMResult({ budget: { status: 'filled', quote: '予算は一千万円程度あります' } }, transcript);
        expect(result.changed).toBe(true);
        expect(result.state.elements.budget.status).toBe('filled');
        const evidence = result.state.elements.budget.evidence;
        expect(evidence).toHaveLength(1);
        expect(evidence[0].source).toBe('llm');
        expect(evidence[0].specificity).toBe('concrete');
    });

    test('ungrounded LLM quote (hallucination) is silently skipped', () => {
        const store = createDiscoveryEvidence({ now: makeClock() });
        const transcript = '[相手] 予算は厳しいです';
        const result = store.applyLLMResult({ budget: { status: 'filled', quote: '予算は3000万円です' } }, transcript);
        expect(result.changed).toBe(false);
        expect(result.state.elements.budget.status).toBe('empty');
    });

    test('quote grounding uses normalized comparison (whitespace / punctuation)', () => {
        const store = createDiscoveryEvidence({ now: makeClock() });
        const transcript = '[相手] 予算は、500万円です。';
        const result = store.applyLLMResult({ budget: { status: 'filled', quote: '予算は500万円です' } }, transcript);
        expect(result.changed).toBe(true);
        expect(result.state.elements.budget.status).toBe('filled');
    });

    test('LLM result with status: empty is a no-op (no downgrade)', () => {
        const store = createDiscoveryEvidence({ now: makeClock() });
        store.processNewTurn({
            speaker: 'opponent',
            text: '人手不足で疲弊しています',
            source: 'gemini_live',
        });
        expect(store.getState().elements.pain.status).toBe('partial');
        const transcript = '[相手] 人手不足で疲弊しています';
        const result = store.applyLLMResult({ pain: { status: 'empty', quote: '' } }, transcript);
        expect(result.state.elements.pain.status).toBe('partial');
    });

    test('regex source: regex / LLM source: llm are distinguishable in evidence', () => {
        const store = createDiscoveryEvidence({ now: makeClock() });
        store.processNewTurn({
            speaker: 'opponent',
            text: '予算は厳しいです',
            source: 'gemini_live',
        });
        const transcript = '[相手] 予算は厳しいです\n[相手] 一千万円程度あります';
        store.applyLLMResult({ budget: { status: 'filled', quote: '一千万円程度あります' } }, transcript);
        const evidence = store.getState().elements.budget.evidence;
        expect(evidence.some(e => e.source === 'regex')).toBe(true);
        expect(evidence.some(e => e.source === 'llm')).toBe(true);
        expect(store.getState().elements.budget.status).toBe('filled');
    });
});

describe('processNewTurn — self-mention channel (Phase 3.B / B-1)', () => {
    test('self speaker text matching pain regex pushes to selfMentions, NOT evidence', () => {
        const store = createDiscoveryEvidence({ now: () => 1000 });
        // "人手不足で困っています" matches PARTIAL pain regex (keyword 困), not FILLED.
        // FILLED would require a department noun (現場/経理/...) within 20 chars
        // of a pain verb — keep this test on the keyword specificity rung.
        const result = store.processNewTurn({ speaker: 'self', text: '人手不足で困っています' });
        const state = result.state;
        expect(state.elements.pain.evidence).toEqual([]);
        expect(state.elements.pain.status).toBe('empty');
        expect(state.elements.pain.selfMentions).toHaveLength(1);
        expect(state.elements.pain.selfMentions[0]).toMatchObject({
            text: '人手不足で困っています',
            timestamp: 1000,
            specificity: 'keyword',
        });
        expect(result.changed).toBe(true);
    });

    test('self speaker on multiple elements pushes to each channel independently', () => {
        const store = createDiscoveryEvidence({ now: () => 2000 });
        store.processNewTurn({ speaker: 'self', text: '予算500万円くらいで困っている件は' });
        const state = store.getState();
        expect(state.elements.pain.selfMentions).toHaveLength(1);
        expect(state.elements.budget.selfMentions).toHaveLength(1);
        expect(state.elements.pain.evidence).toEqual([]);
        expect(state.elements.budget.evidence).toEqual([]);
    });

    test('self speaker text with no element keyword does not mutate state', () => {
        const store = createDiscoveryEvidence({ now: () => 3000 });
        const result = store.processNewTurn({ speaker: 'self', text: 'こんにちは、よろしくお願いします' });
        expect(result.changed).toBe(false);
        const state = result.state;
        for (const key of ['pain', 'kpi', 'authority', 'budget', 'timeline']) {
            expect(state.elements[key].selfMentions).toEqual([]);
            expect(state.elements[key].evidence).toEqual([]);
        }
    });

    test('selfMentions capped at MAX_EVIDENCE_PER_ELEMENT (10)', () => {
        const store = createDiscoveryEvidence({ now: () => 4000 });
        for (let i = 0; i < 15; i++) {
            store.processNewTurn({ speaker: 'self', text: `予算の話 ${i}` });
        }
        const state = store.getState();
        expect(state.elements.budget.selfMentions).toHaveLength(10);
        // Oldest dropped: last 10 should be indices 5..14
        expect(state.elements.budget.selfMentions[0].text).toBe('予算の話 5');
        expect(state.elements.budget.selfMentions[9].text).toBe('予算の話 14');
    });

    test('opponent channel unchanged: pushes only to evidence, not selfMentions', () => {
        const store = createDiscoveryEvidence({ now: () => 5000 });
        store.processNewTurn({ speaker: 'opponent', text: '現場で困っています' });
        const state = store.getState();
        expect(state.elements.pain.evidence).toHaveLength(1);
        expect(state.elements.pain.selfMentions).toEqual([]);
    });

    test('lastUpdate is updated by self-mention as well as opponent evidence', () => {
        const store = createDiscoveryEvidence({ now: () => 6000 });
        store.processNewTurn({ speaker: 'self', text: '予算の話で恐縮ですが' });
        const state = store.getState();
        expect(state.elements.budget.lastUpdate).toBe(6000);
    });

    test('initial state has empty selfMentions on every element', () => {
        const store = createDiscoveryEvidence();
        const state = store.getState();
        for (const key of ['pain', 'kpi', 'authority', 'budget', 'timeline']) {
            expect(state.elements[key].selfMentions).toEqual([]);
        }
    });

    test('reset() clears selfMentions on every element', () => {
        const store = createDiscoveryEvidence({ now: () => 7000 });
        store.processNewTurn({ speaker: 'self', text: '予算の話' });
        store.reset();
        const state = store.getState();
        for (const key of ['pain', 'kpi', 'authority', 'budget', 'timeline']) {
            expect(state.elements[key].selfMentions).toEqual([]);
            expect(state.elements[key].evidence).toEqual([]);
        }
    });

    test('dump() returns deep-cloned selfMentions (mutation on result does not affect store)', () => {
        const store = createDiscoveryEvidence({ now: () => 8000 });
        store.processNewTurn({ speaker: 'self', text: '予算500万円' });
        const dump1 = store.dump();
        dump1.elements.budget.selfMentions[0].text = 'MUTATED';
        const dump2 = store.dump();
        expect(dump2.elements.budget.selfMentions[0].text).toBe('予算500万円');
    });
});
