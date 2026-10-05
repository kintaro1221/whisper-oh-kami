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

    test('opponent quantified scale → kpi becomes detected', () => {
        const store = createDiscoveryEvidence({ now: makeClock() });
        const result = store.processNewTurn({
            speaker: 'opponent',
            text: '月100件処理しています',
            source: 'gemini_live',
        });
        expect(result.state.elements.kpi.status).toBe('detected');
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

    test('opponent role + decision verb → authority becomes detected', () => {
        const store = createDiscoveryEvidence({ now: makeClock() });
        const result = store.processNewTurn({
            speaker: 'opponent',
            text: '最終判断は社長になります',
            source: 'gemini_live',
        });
        expect(result.state.elements.authority.status).toBe('detected');
        expect(result.state.totalScore).toBe(1);
    });

    test('opponent budget amount → budget becomes detected', () => {
        const store = createDiscoveryEvidence({ now: makeClock() });
        const result = store.processNewTurn({
            speaker: 'opponent',
            text: '年間予算500万円です',
            source: 'gemini_live',
        });
        expect(result.state.elements.budget.status).toBe('detected');
        expect(result.state.elements.budget.evidence[0].specificity).toBe('concrete');
    });

    test('opponent date phrase → timeline becomes detected', () => {
        const store = createDiscoveryEvidence({ now: makeClock() });
        const result = store.processNewTurn({
            speaker: 'opponent',
            text: '3月末までに導入したい',
            source: 'gemini_live',
        });
        expect(result.state.elements.timeline.status).toBe('detected');
    });

    test('partial → detected progression accumulates evidence', () => {
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
        expect(r2.state.elements.budget.status).toBe('detected');
        expect(r2.state.elements.budget.evidence).toHaveLength(2);
    });

    test('multi-element single utterance updates several at once', () => {
        const store = createDiscoveryEvidence({ now: makeClock() });
        const result = store.processNewTurn({
            speaker: 'opponent',
            text: '年間予算500万円で月100件処理しています',
            source: 'gemini_live',
        });
        expect(result.state.elements.budget.status).toBe('detected');
        expect(result.state.elements.kpi.status).toBe('detected');
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
    test('"3月末までに導入したい" → timeline detected, KPI stays empty', () => {
        const store = createDiscoveryEvidence({ now: makeClock() });
        const result = store.processNewTurn({
            speaker: 'opponent',
            text: '3月末までに導入したい',
            source: 'gemini_live',
        });
        expect(result.state.elements.timeline.status).toBe('detected');
        expect(result.state.elements.kpi.status).toBe('empty');
    });

    test('"2026年度までに決めたい" → timeline detected, KPI stays empty', () => {
        const store = createDiscoveryEvidence({ now: makeClock() });
        const result = store.processNewTurn({
            speaker: 'opponent',
            text: '2026年度までに決めたい',
            source: 'gemini_live',
        });
        expect(result.state.elements.timeline.status).toBe('detected');
        expect(result.state.elements.kpi.status).toBe('empty');
    });

    test('"年間500万円です" → budget detected, KPI stays empty', () => {
        const store = createDiscoveryEvidence({ now: makeClock() });
        const result = store.processNewTurn({
            speaker: 'opponent',
            text: '年間500万円です',
            source: 'gemini_live',
        });
        expect(result.state.elements.budget.status).toBe('detected');
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

    test('"一千万円" → budget detected (kanji digits)', () => {
        const store = createDiscoveryEvidence({ now: makeClock() });
        const r = store.processNewTurn({
            speaker: 'opponent',
            text: '予算が一千万円程度あります',
            source: 'gemini_live',
        });
        expect(r.state.elements.budget.status).toBe('detected');
    });

    test('"十月末まで" → timeline detected (kanji digits)', () => {
        const store = createDiscoveryEvidence({ now: makeClock() });
        const r = store.processNewTurn({
            speaker: 'opponent',
            text: '十月末までに導入したい',
            source: 'gemini_live',
        });
        expect(r.state.elements.timeline.status).toBe('detected');
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
    test('LLM filled with grounded quote → element status detected, source: llm', () => {
        const store = createDiscoveryEvidence({ now: makeClock() });
        const transcript = '[相手] 予算は一千万円程度あります';
        const result = store.applyLLMResult({ budget: { status: 'filled', quote: '予算は一千万円程度あります' } }, transcript);
        expect(result.changed).toBe(true);
        expect(result.state.elements.budget.status).toBe('detected');
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
        expect(result.state.elements.budget.status).toBe('detected');
    });

    test('LLM status: empty without a grounded negation / retraction quote is a no-op (no downgrade)', () => {
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
        expect(store.getState().elements.budget.status).toBe('detected');
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

// ── v0.7.5 trust gates ───────────────────────────────────────────────────

describe('polarity / retraction / confirmation (v0.7.5 trust gates)', () => {
    const opp = text => ({ speaker: 'opponent', text });

    test.each([
        ['A negation', '予算は100万円ではありません。金額は未定です', 'negated'],
        ['B hypothetical', '仮に100万円の予算があれば検討できますが、まだ予算はありません', 'hypothetical'],
        ['C third party', '隣の会社の広告費は100万円らしいです。弊社の予算は未定です', 'third_party'],
    ])('%s does not detect budget (status partial, score 0)', (_label, text, polarity) => {
        const store = createDiscoveryEvidence();
        const { state } = store.processNewTurn(opp(text));
        expect(state.elements.budget.status).toBe('partial');
        expect(state.totalScore).toBe(0);
        const row = state.elements.budget.evidence[0];
        expect(row.specificity).toBe('keyword');
        expect(row.polarity).toBe(polarity);
    });

    test('D retraction clears a detected budget', () => {
        const store = createDiscoveryEvidence();
        store.processNewTurn(opp('予算は100万円です'));
        expect(store.getState().elements.budget.status).toBe('detected');
        const { state } = store.processNewTurn(opp('先ほどの予算は撤回します。予算は未定です'));
        expect(state.elements.budget.status).toBe('partial');
        expect(state.totalScore).toBe(0);
        expect(state.elements.budget.evidence.every(e => e.polarity !== null || e.retracted)).toBe(true);
    });

    test('plain concrete opponent statement is detected, never confirmed automatically', () => {
        const store = createDiscoveryEvidence();
        const { state } = store.processNewTurn(opp('予算は100万円です'));
        expect(state.elements.budget.status).toBe('detected');
        expect(state.confirmedCount).toBe(0);
        expect(state.totalScore).toBe(1);
    });

    test('a later affirmative turn does not undo detection', () => {
        const store = createDiscoveryEvidence();
        store.processNewTurn(opp('予算は100万円です'));
        const { state } = store.processNewTurn(opp('それで進めます'));
        expect(state.elements.budget.status).toBe('detected');
    });

    test('self statements still never change status', () => {
        const store = createDiscoveryEvidence();
        const { state } = store.processNewTurn({ speaker: 'self', text: '予算は100万円です' });
        expect(state.elements.budget.status).toBe('empty');
    });

    test('confirmElement / retractElement round trip', () => {
        const store = createDiscoveryEvidence();
        store.processNewTurn(opp('予算は100万円です'));
        let r = store.confirmElement('budget');
        expect(r.changed).toBe(true);
        expect(r.state.elements.budget.status).toBe('confirmed');
        expect(r.state.confirmedCount).toBe(1);
        r = store.retractElement('budget', 'manual');
        expect(r.state.elements.budget.status).toBe('empty');
        expect(r.state.elements.budget.evidence.every(e => e.retracted)).toBe(true);
        expect(store.confirmElement('nope').changed).toBe(false);
    });

    test('confirmElement on an element without live evidence is a no-op', () => {
        const store = createDiscoveryEvidence();
        let r = store.confirmElement('budget');
        expect(r.changed).toBe(false);
        expect(r.state.elements.budget.status).toBe('empty');
        expect(r.state.elements.budget.confirmed).toBe(false);
        expect(r.state.confirmedCount).toBe(0);
        // Only retracted rows left: still nothing to confirm.
        store.processNewTurn(opp('予算は100万円です'));
        store.retractElement('budget', 'manual');
        r = store.confirmElement('budget');
        expect(r.changed).toBe(false);
        expect(r.state.elements.budget.status).toBe('empty');
    });

    test('LLM empty with a grounded retraction quote downgrades; ungrounded empty is a no-op', () => {
        const store = createDiscoveryEvidence();
        store.processNewTurn(opp('予算は100万円です'));
        let r = store.applyLLMResult(
            { budget: { status: 'empty', quote: '予算は未定です' } },
            '[相手] 予算は100万円です [相手] やはり予算は未定です'
        );
        expect(r.changed).toBe(true);
        // v0.7.8: a retraction marker is history, not a live row → empty.
        expect(r.state.elements.budget.status).toBe('empty');
        expect(r.state.elements.budget.evidence.some(e => e.polarity === 'retraction' && e.source === 'llm')).toBe(true);
        const store2 = createDiscoveryEvidence();
        store2.processNewTurn(opp('予算は100万円です'));
        r = store2.applyLLMResult({ budget: { status: 'empty', quote: '' } }, '予算は100万円です');
        expect(r.changed).toBe(false);
        expect(r.state.elements.budget.status).toBe('detected');
    });

    test('LLM filled maps to detected and a negated quote maps to partial', () => {
        const store = createDiscoveryEvidence();
        let r = store.applyLLMResult({ budget: { status: 'filled', quote: '予算は300万円です' } }, '[相手] 予算は300万円です');
        expect(r.state.elements.budget.status).toBe('detected');
        const store2 = createDiscoveryEvidence();
        r = store2.applyLLMResult({ budget: { status: 'filled', quote: '予算は300万円ではありません' } }, '[相手] 予算は300万円ではありません');
        expect(r.state.elements.budget.status).toBe('partial');
    });

    test('classifyPolarity / isRetraction helpers', () => {
        const { classifyPolarity, isRetraction } = require('../../src/utils/discoveryEvidence');
        expect(classifyPolarity('予算は100万円ではありません')).toBe('negated');
        expect(classifyPolarity('仮に100万円なら')).toBe('hypothetical');
        expect(classifyPolarity('他社は100万円らしい')).toBe('third_party');
        expect(classifyPolarity('予算は100万円です')).toBeNull();
        expect(isRetraction('先ほどの予算は撤回します')).toBe(true);
        expect(isRetraction('予算は100万円です')).toBe(false);
    });
});

describe('review fixes: pain negation, scoped retraction, third-party narrowing (v0.7.5 trust gates)', () => {
    const opp = text => ({ speaker: 'opponent', text });

    test.each([['Excelでは集計できない'], ['経理の手作業が多くてミスが減らないです'], ['現場の手作業が多くて余裕がありません']])(
        'pain stated in negative phrasing stays detected: %s',
        text => {
            expect(matchElement('pain', text)).toBe('concrete');
            const store = createDiscoveryEvidence();
            const { state } = store.processNewTurn(opp(text));
            expect(state.elements.pain.status).toBe('detected');
            expect(state.elements.pain.evidence[0].polarity).toBeNull();
        }
    );

    test('third-party pain still drops to partial', () => {
        const store = createDiscoveryEvidence();
        const { state } = store.processNewTurn(opp('他社では現場が困っているらしいです'));
        expect(state.elements.pain.status).toBe('partial');
        expect(state.elements.pain.evidence[0].polarity).toBe('third_party');
    });

    test('(a) a retraction that names no topic retracts nothing', () => {
        const store = createDiscoveryEvidence();
        store.processNewTurn(opp('月100件処理しています'));
        store.processNewTurn(opp('予算は500万円です'));
        const { state } = store.processNewTurn(opp('先ほどの件は撤回します'));
        expect(state.elements.kpi.status).toBe('detected');
        expect(state.elements.budget.status).toBe('detected');
    });

    test('(b) a retraction naming the budget retracts only the budget', () => {
        const store = createDiscoveryEvidence();
        store.processNewTurn(opp('月100件処理しています'));
        store.processNewTurn(opp('予算は500万円です'));
        const { state } = store.processNewTurn(opp('先ほどの予算は撤回します'));
        // v0.7.8: retraction-only element is empty; the marker stays as history.
        expect(state.elements.budget.status).toBe('empty');
        expect(state.elements.budget.evidence.some(e => e.polarity === 'retraction')).toBe(true);
        expect(state.elements.kpi.status).toBe('detected');
    });

    test('(c) a retraction naming the old value by amount retracts it and re-detects the corrected value', () => {
        const store = createDiscoveryEvidence();
        store.processNewTurn(opp('予算は500万円です'));
        const { state } = store.processNewTurn(opp('500万円は撤回して、300万円でお願いします'));
        expect(state.elements.budget.status).toBe('detected');
        const ev = state.elements.budget.evidence;
        expect(ev.find(e => e.text === '予算は500万円です').retracted).toBe(true);
        const live = ev.filter(e => !e.retracted && e.specificity === 'concrete');
        expect(live).toHaveLength(1);
        expect(live[0].text).toContain('300万円');
        expect(live[0].polarity).toBeNull();
    });

    test('(c3) a topic-named retraction with a corrected value retracts the old row and re-detects', () => {
        const store = createDiscoveryEvidence();
        store.processNewTurn(opp('予算は500万円です'));
        const { state } = store.processNewTurn(opp('予算の500万円は撤回して、300万円でお願いします'));
        expect(state.elements.budget.status).toBe('detected');
        const ev = state.elements.budget.evidence;
        expect(ev.find(e => e.text === '予算は500万円です').retracted).toBe(true);
        const live = ev.filter(e => !e.retracted && e.specificity === 'concrete');
        expect(live).toHaveLength(1);
        expect(live[0].text).toContain('300万円');
        expect(live[0].polarity).toBeNull();
    });

    test('(c2) a retraction that only restates the old value does not re-detect it', () => {
        const store = createDiscoveryEvidence();
        store.processNewTurn(opp('予算は500万円です'));
        const { state } = store.processNewTurn(opp('500万円の予算は撤回します'));
        // v0.7.8: retraction-only element is empty; the marker stays as history.
        expect(state.elements.budget.status).toBe('empty');
        expect(state.elements.budget.evidence.some(e => e.polarity === 'retraction')).toBe(true);
        expect(state.elements.budget.evidence.some(e => !e.retracted && e.specificity === 'concrete')).toBe(false);
    });

    test('(d) an automatic retraction clears a user confirmation (v0.7.8 policy: ✓ is cleared by explicit retraction)', () => {
        const store = createDiscoveryEvidence();
        store.processNewTurn(opp('予算は500万円です'));
        store.confirmElement('budget');
        const { state } = store.processNewTurn(opp('予算は撤回します'));
        expect(state.elements.budget.status).toBe('empty');
        expect(state.elements.budget.confirmed).toBe(false);
        expect(state.elements.budget.confirmedClearedBy).toBe('retraction');
        const nonRetractionRows = state.elements.budget.evidence.filter(e => e.polarity !== 'retraction');
        expect(nonRetractionRows.length).toBeGreaterThan(0);
        expect(nonRetractionRows.every(e => e.retracted)).toBe(true);
    });

    test('(e) LLM empty with a grounded negation clears a confirmed element (v0.7.8 policy: ✓ is cleared by explicit retraction)', () => {
        const store = createDiscoveryEvidence();
        store.processNewTurn(opp('予算は100万円です'));
        store.confirmElement('budget');
        const r = store.applyLLMResult(
            { budget: { status: 'empty', quote: '予算は未定です' } },
            '[相手] 予算は100万円です [相手] やはり予算は未定です'
        );
        expect(r.state.elements.budget.status).toBe('empty');
        expect(r.state.elements.budget.confirmed).toBe(false);
        expect(r.state.elements.budget.confirmedClearedBy).toBe('retraction');
        const nonRetractionRows = r.state.elements.budget.evidence.filter(e => e.polarity !== 'retraction');
        expect(nonRetractionRows.length).toBeGreaterThan(0);
        expect(nonRetractionRows.every(e => e.retracted)).toBe(true);
    });

    test('「素晴らしい」 is not a third-party marker', () => {
        const store = createDiscoveryEvidence();
        const { state } = store.processNewTurn(opp('素晴らしいですね、予算は300万円です'));
        expect(state.elements.budget.status).toBe('detected');
    });

    test('「試してみたい」 is not a third-party marker', () => {
        const store = createDiscoveryEvidence();
        const { state } = store.processNewTurn(opp('3月までに試してみたい'));
        expect(state.elements.timeline.evidence[0].polarity).not.toBe('third_party');
    });
});

describe('final-review fixes: sentence-scoped polarity / retraction (v0.7.5 trust gates)', () => {
    const opp = text => ({ speaker: 'opponent', text });
    const run = (...texts) => {
        const store = createDiscoveryEvidence();
        let state;
        for (const t of texts) state = store.processNewTurn(opp(t)).state;
        return { store, state };
    };

    test('「問題ありません」 in an earlier sentence does not negate the budget', () => {
        const { state } = run('はい、問題ありません。予算は500万円です');
        expect(state.elements.budget.status).toBe('detected');
    });

    test('「申し訳ございません」 is politeness, not negation', () => {
        const { state } = run('申し訳ございません、予算は300万円でお願いします');
        expect(state.elements.budget.status).toBe('detected');
    });

    test('「もしよければ」 in a later sentence is not hypothetical framing', () => {
        const { state } = run('予算は300万円で、部長が決めます。もしよければ資料ください');
        expect(state.elements.budget.status).toBe('detected');
        expect(state.elements.authority.status).toBe('detected');
    });

    test('「伝え忘れて」 is not a retraction and does not retract the authority', () => {
        const { state } = run('課長が決裁します。予算は伝え忘れていましたが300万円です');
        expect(state.elements.authority.status).toBe('detected');
        expect(state.elements.budget.status).toBe('detected');
        expect(state.elements.authority.evidence.some(e => e.retracted)).toBe(false);
    });

    test('「来年度から始めたいので予算は未定です」: timeline has no concrete date → partial, budget partial', () => {
        // 「来年度」 has no digit, so the FILLED timeline pattern does not match.
        expect(matchElement('timeline', '来年度から始めたいので予算は未定です')).toBe('keyword');
        const { state } = run('来年度から始めたいので予算は未定です');
        expect(state.elements.timeline.status).toBe('partial');
        expect(state.elements.budget.status).toBe('partial');
    });

    test('negation exclusions / 「もしよければ」 / 「伝え忘れて」 at the helper level', () => {
        const { classifyPolarity, isRetraction } = require('../../src/utils/discoveryEvidence');
        expect(classifyPolarity('問題ありません')).toBeNull();
        expect(classifyPolarity('間違いありません、予算は300万円です')).toBeNull();
        expect(classifyPolarity('構いません')).toBeNull();
        expect(classifyPolarity('差し支えありません')).toBeNull();
        expect(classifyPolarity('申し訳ありません')).toBeNull();
        expect(classifyPolarity('もしよろしければ資料ください')).toBeNull();
        expect(classifyPolarity('予算はありません')).toBe('negated');
        expect(isRetraction('予算は伝え忘れていました')).toBe(false);
        expect(isRetraction('言い忘れていましたが300万円です')).toBe(false);
        expect(isRetraction('さっきの予算は忘れてください')).toBe(true);
        expect(isRetraction('予算の件は忘れていただいて結構です')).toBe(true);
    });

    test('broadened third-party markers', () => {
        const { classifyPolarity } = require('../../src/utils/discoveryEvidence');
        for (const t of [
            '別会社は500万円です',
            '他の会社は500万円です',
            'ほかの会社は500万円',
            '競合他社は500万円',
            '500万円と聞きました',
            '500万円と伺っています',
            '500万円とのことです',
            '500万円だそうです',
        ]) {
            expect(classifyPolarity(t)).toBe('third_party');
        }
    });

    test("validator C07: another company's figures then a global correction leave score 0", () => {
        const { store, state: s1 } = run('その別会社は誤差を月1件以下にするKPIで、社長決裁、予算500万円、2026年11月末の稼働と聞きました。');
        for (const key of ['kpi', 'budget', 'timeline']) {
            expect(s1.elements[key].status).toBe('partial');
            expect(s1.elements[key].evidence[0].polarity).toBe('third_party');
        }
        expect(s1.elements.authority.status).toBe('partial');
        const { state } = store.processNewTurn(opp('いいえ、すべてその別会社の話です。当社の案件は各項目とも未定です。'));
        for (const key of ELEMENT_KEYS) {
            expect(['partial', 'empty']).toContain(state.elements[key].status);
        }
        expect(state.totalScore).toBe(0);
    });

    test('a global correction retracts every live concrete row even when the third-party marker was missed', () => {
        const { store, state: s1 } = run('誤差を月1件以下にしたいです。社長が決めます。予算は500万円です。2026年11月末に稼働したいです。');
        expect(s1.totalScore).toBe(4);
        const { state } = store.processNewTurn(opp('いいえ、すべてその別会社の話です。'));
        for (const key of ELEMENT_KEYS) {
            expect(['partial', 'empty']).toContain(state.elements[key].status);
            expect(state.elements[key].evidence.filter(e => e.specificity === 'concrete').every(e => e.retracted)).toBe(true);
        }
        expect(state.totalScore).toBe(0);
    });

    test('「当社は…未定です」 global correction retracts everything and clears a confirmation (v0.7.8 policy: ✓ is cleared by explicit retraction)', () => {
        const { store } = run('予算は500万円です。部長が決めます。');
        store.confirmElement('authority');
        const { state } = store.processNewTurn(opp('当社の案件は各項目とも未定です'));
        // v0.7.8: retraction-only element is empty; the marker stays as history.
        expect(state.elements.budget.status).toBe('empty');
        expect(state.elements.budget.evidence.some(e => e.polarity === 'retraction')).toBe(true);
        expect(state.elements.authority.status).toBe('empty');
        expect(state.elements.authority.confirmed).toBe(false);
        expect(state.elements.authority.confirmedClearedBy).toBe('retraction');
    });

    test('「他社の話ですが…」 that continues with content is not a global correction', () => {
        const { store } = run('予算は500万円です');
        const { state } = store.processNewTurn(opp('他社の話ですが、導入に半年かかったそうです'));
        expect(state.elements.budget.status).toBe('detected');
    });

    test('topic words after the retraction keyword do not retract', () => {
        const { store } = run('月100件処理しています', '予算は500万円です');
        const { state } = store.processNewTurn(opp('先ほどの話は撤回して、件数の目標と予算は変わりません'));
        expect(state.elements.kpi.status).toBe('detected');
        expect(state.elements.budget.status).toBe('detected');
    });

    test('the retracted part stops at the previous sentence boundary', () => {
        const { store } = run('予算は500万円です');
        const { state } = store.processNewTurn(opp('予算は500万円で変わりません。先ほどの件は撤回します'));
        expect(state.elements.budget.status).toBe('detected');
    });

    test('(A) a concrete value in the retraction sentence picks the element; topic words do not drag others in (C23 t4)', () => {
        const { store, state: s1 } = run(
            '初期費用の予算は80万円で承認済みです。本稼働の期限は2026年11月30日で社内合意済みです。',
            '最終決裁者は事業部長です。'
        );
        expect(s1.elements.budget.status).toBe('detected');
        expect(s1.elements.authority.status).toBe('detected');
        expect(s1.elements.timeline.status).toBe('detected');
        const { state } = store.processNewTurn(opp('80万円の予算は承認が取り消されたので撤回します。新しい金額は未定です。'));
        // v0.7.8: retraction-only element is empty; the marker stays as history.
        expect(state.elements.budget.status).toBe('empty');
        expect(state.elements.budget.evidence.some(e => e.polarity === 'retraction')).toBe(true);
        expect(state.elements.authority.status).toBe('detected');
        expect(state.elements.timeline.status).toBe('detected');
        expect(state.elements.authority.evidence.some(e => e.retracted)).toBe(false);
    });

    test('(B) 「AではなくB」 with a value on both sides is a correction (C23 t4)', () => {
        const { store, state: s1 } = run('成功目標は見積の作成時間30％削減です');
        expect(s1.elements.kpi.status).toBe('detected');
        const { state } = store.processNewTurn(opp('成功目標は30％ではなく10％削減に訂正します。'));
        expect(state.elements.kpi.status).toBe('detected');
        const live = state.elements.kpi.evidence.filter(e => !e.retracted && e.specificity === 'concrete');
        expect(live.length).toBeGreaterThan(0);
        expect(live.every(e => e.text.includes('10％'))).toBe(true);
        expect(live.every(e => e.polarity === null)).toBe(true);
        expect(state.elements.kpi.evidence.find(e => e.text === '成功目標は見積の作成時間30％削減です').retracted).toBe(true);
    });

    test('(B) 「ではなく」 with a value on one side only stays negated', () => {
        const { state } = run('予算は100万円ではなく、まだ決まっていません');
        expect(state.elements.budget.status).toBe('partial');
        expect(state.elements.budget.evidence[0].polarity).toBe('negated');
    });
});

describe('final-review fixes: LLM path parity (v0.7.5 trust gates)', () => {
    const opp = text => ({ speaker: 'opponent', text });

    test('a manually retracted element is not resurrected by the same LLM quote', () => {
        const store = createDiscoveryEvidence();
        store.processNewTurn(opp('予算は100万円です'));
        store.retractElement('budget');
        const r = store.applyLLMResult({ budget: { status: 'filled', quote: '予算は100万円です' } }, '[相手] 予算は100万円です');
        expect(['empty', 'partial']).toContain(r.state.elements.budget.status);
        expect(r.state.totalScore).toBe(0);
    });

    test('an automatically retracted element is not resurrected by the same LLM quote', () => {
        const store = createDiscoveryEvidence();
        store.processNewTurn(opp('予算は100万円です'));
        store.processNewTurn(opp('先ほどの予算は撤回します'));
        const r = store.applyLLMResult(
            { budget: { status: 'filled', quote: '予算は100万円です' } },
            '[相手] 予算は100万円です\n[相手] 先ほどの予算は撤回します'
        );
        // v0.7.8: retraction-only element is empty; the marker stays as history.
        expect(r.state.elements.budget.status).toBe('empty');
        expect(r.state.elements.budget.evidence.some(e => e.polarity === 'retraction')).toBe(true);
        expect(r.state.totalScore).toBe(0);
    });

    test('LLM polarity is classified on the transcript sentence that contains the quote', () => {
        const store = createDiscoveryEvidence();
        const r = store.applyLLMResult({ budget: { status: 'filled', quote: '広告費は100万円' } }, '[相手] 隣の会社の広告費は100万円らしいです');
        expect(r.state.elements.budget.status).toBe('partial');
        expect(r.state.elements.budget.evidence[0].polarity).toBe('third_party');
    });

    test('a neutral transcript sentence still lets an LLM filled quote detect', () => {
        const store = createDiscoveryEvidence();
        const r = store.applyLLMResult(
            { budget: { status: 'filled', quote: '予算は300万円' } },
            '[相手] 他社の話は置いておきます。\n[相手] 予算は300万円です'
        );
        expect(r.state.elements.budget.status).toBe('detected');
    });
});

// External validator backlog (30 B2B cases): concrete customer statements
// that stayed keyword-only. Pain now also fills on a symptom + frequency /
// volume / process marker in the same sentence; timeline also fills on
// relative deadlines (kept as said, not resolved to absolute dates).
describe('concrete pain / timeline: frequency-marked symptoms and relative dates', () => {
    const opp = text => ({ speaker: 'opponent', text });
    const lastRow = (state, key) => state.elements[key].evidence[state.elements[key].evidence.length - 1];

    test.each([
        ['当社では受注内容を二重入力していて、毎週入力ミスが起きています。'],
        ['私たちの担当者は、毎月の締め作業で手入力に5時間かかって困っています。'],
        ['問い合わせが個人の受信箱に分散していて、返信漏れが出ています。'],
    ])('counterpart pain with a frequency/process marker is detected: %s', text => {
        const store = createDiscoveryEvidence();
        const { state } = store.processNewTurn(opp(text));
        expect(state.elements.pain.status).toBe('detected');
        expect(lastRow(state, 'pain')).toMatchObject({ specificity: 'concrete', polarity: null });
    });

    test('counterpart relative deadline (C20) is detected', () => {
        const store = createDiscoveryEvidence();
        const { state } = store.processNewTurn(opp('社内で決定しました。今月30日を本稼働の期限にします。'));
        expect(state.elements.timeline.status).toBe('detected');
        expect(lastRow(state, 'timeline')).toMatchObject({ specificity: 'concrete', polarity: null });
    });

    test.each([
        ['来月末'],
        ['再来月10日'],
        ['今月中'],
        ['年内'],
        ['今年中'],
        ['今期中'],
        ['来期初'],
        ['下期末'],
        ['2週間以内'],
        ['三か月以内'],
        ['3ヶ月以内'],
    ])('relative deadline form is concrete: %s', text => {
        expect(matchElement('timeline', `${text}に導入したいです`)).toBe('concrete');
    });

    test('negation still wins: denied pain stays partial (negated)', () => {
        const store = createDiscoveryEvidence();
        const { state } = store.processNewTurn(opp('毎週ミスが出ているわけではありません'));
        expect(state.elements.pain.status).toBe('partial');
        expect(lastRow(state, 'pain').polarity).toBe('negated');
    });

    test('negation still wins: a deadline that cannot be decided stays partial (negated)', () => {
        const store = createDiscoveryEvidence();
        const { state } = store.processNewTurn(opp('今月30日までには決められません'));
        expect(state.elements.timeline.status).toBe('partial');
        expect(lastRow(state, 'timeline').polarity).toBe('negated');
    });

    test('pain voiced in the negative is still pain (not a denial)', () => {
        const store = createDiscoveryEvidence();
        const { state } = store.processNewTurn(opp('毎月の手入力でミスが減らないです'));
        expect(state.elements.pain.status).toBe('detected');
    });

    test("third-party still wins: another company's symptom does not detect", () => {
        const store = createDiscoveryEvidence();
        const { state } = store.processNewTurn(opp('別会社では毎週入力ミスが出ていると聞きました'));
        expect(state.elements.pain.status).toBe('partial');
        expect(lastRow(state, 'pain').polarity).toBe('third_party');
    });

    test("salesperson's own speech never raises status", () => {
        const store = createDiscoveryEvidence();
        const { state } = store.processNewTurn({ speaker: 'self', text: '毎週入力ミスが起きていて、今月30日が期限ですよね' });
        expect(state.elements.pain.status).toBe('empty');
        expect(state.elements.timeline.status).toBe('empty');
        expect(state.elements.pain.selfMentions).toHaveLength(1);
    });

    test('keyword-only speech without a marker or date stays partial', () => {
        const store = createDiscoveryEvidence();
        let { state } = store.processNewTurn(opp('ミスが心配です'));
        expect(state.elements.pain.status).toBe('partial');
        expect(lastRow(state, 'pain').specificity).toBe('keyword');
        ({ state } = store.processNewTurn(opp('期限はまだ決めていません')));
        expect(state.elements.timeline.status).toBe('partial');
        expect(lastRow(state, 'timeline').specificity).toBe('keyword');
    });

    test('a bare marker without a symptom does not fill pain', () => {
        expect(matchElement('pain', '毎週月曜に定例があります')).toBeNull();
        expect(matchElement('pain', '担当は3人です')).toBeNull();
    });

    test('a one-off delay with a bare duration is not a pain (duration alone is not a marker)', () => {
        expect(matchElement('pain', '会議が1時間遅れました')).not.toBe('concrete');
        expect(matchElement('pain', '締め作業で手入力に5時間かかって困っています')).toBe('concrete');
    });
});

// v0.7.8 state model. Vocabulary: the validation team's "confirmed" (a
// positive statement in the conversation) is the product's `detected`; the
// product's `confirmed` is only the user's manual ✓. `candidate` sits between
// partial and detected and is not counted in totalScore.
describe('v0.7.8 state model: candidate tier, retraction-only is empty, counts', () => {
    const { createDiscoveryEvidence, computeStatus, isLiveRow, candidateCount } = require('../../src/utils/discoveryEvidence');
    const opp = text => ({ speaker: 'opponent', text });

    test('a concrete row tagged tentative yields status candidate, counted in candidateCount but not totalScore', () => {
        const el = {
            status: 'empty',
            confirmed: false,
            evidence: [{ id: 1, specificity: 'concrete', polarity: null, qualifier: 'tentative', retracted: false, superseded: false }],
        };
        expect(computeStatus(el)).toBe('candidate');
    });
    test('a concrete row tagged current is only partial', () => {
        const el = {
            status: 'empty',
            confirmed: false,
            evidence: [{ id: 1, specificity: 'concrete', polarity: null, qualifier: 'current', retracted: false, superseded: false }],
        };
        expect(computeStatus(el)).toBe('partial');
    });
    test('a concrete row tagged conflict yields candidate; an untagged neutral concrete row still wins as detected', () => {
        const conflictRow = { id: 1, specificity: 'concrete', polarity: null, qualifier: 'conflict', retracted: false, superseded: false };
        expect(computeStatus({ confirmed: false, evidence: [conflictRow] })).toBe('candidate');
        const plainRow = { id: 2, specificity: 'concrete', polarity: null, qualifier: null, retracted: false, superseded: false };
        expect(computeStatus({ confirmed: false, evidence: [conflictRow, plainRow] })).toBe('detected');
    });
    test('superseded rows and retraction markers are not live', () => {
        expect(isLiveRow({ retracted: false, superseded: true, polarity: null })).toBe(false);
        expect(isLiveRow({ retracted: false, superseded: false, polarity: 'retraction' })).toBe(false);
        expect(isLiveRow({ retracted: true, superseded: false, polarity: null })).toBe(false);
        expect(isLiveRow({ retracted: false, superseded: false, polarity: 'negated' })).toBe(true);
        const el = {
            confirmed: false,
            evidence: [{ id: 1, specificity: 'concrete', polarity: null, qualifier: null, retracted: false, superseded: true }],
        };
        expect(computeStatus(el)).toBe('empty');
    });
    test('after an explicit retraction the element is empty (retraction marker is history, not a live row)', () => {
        const store = createDiscoveryEvidence();
        store.processNewTurn(opp('予算は500万円です'));
        const { state } = store.processNewTurn(opp('先ほどの予算は撤回します'));
        expect(state.elements.budget.status).toBe('empty');
        expect(state.elements.budget.evidence.some(e => e.polarity === 'retraction')).toBe(true);
        expect(state.elements.budget.evidence.filter(isLiveRow)).toHaveLength(0);
    });
    test('every evidence row carries a unique numeric id', () => {
        const store = createDiscoveryEvidence();
        store.processNewTurn(opp('予算は500万円です'));
        const { state } = store.processNewTurn(opp('期限は来月末です'));
        const ids = [...state.elements.budget.evidence, ...state.elements.timeline.evidence].map(e => e.id);
        expect(new Set(ids).size).toBe(ids.length);
        ids.forEach(id => expect(typeof id).toBe('number'));
    });
    test('regex, LLM, retraction-marker and user-marker rows all get unique ids and the v0.7.8 row defaults', () => {
        const store = createDiscoveryEvidence();
        store.processNewTurn(opp('予算は500万円です'));
        store.processNewTurn(opp('先ほどの予算は撤回します'));
        store.applyLLMResult({ timeline: { status: 'filled', quote: '期限は来月末です' } }, '[相手] 期限は来月末です');
        const { state } = store.retractElement('timeline', 'manual');
        const rows = [...state.elements.budget.evidence, ...state.elements.timeline.evidence];
        expect(rows.map(e => e.source).sort()).toEqual(['llm', 'regex', 'regex', 'user']);
        const ids = rows.map(e => e.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const row of rows) {
            expect(typeof row.id).toBe('number');
            expect(row).toMatchObject({ qualifier: null, conflictBasis: null, selection: null, superseded: false });
            // Task 4: statement rows carry their parsed value; retraction
            // marker rows carry none.
            if (row.polarity === 'retraction') expect(row.values).toBeNull();
            else expect(row.values).toEqual(expect.objectContaining({ raw: expect.any(String) }));
        }
    });
    test('elements start with the v0.7.8 confirmation / conflict fields and dump deep-copies them', () => {
        const store = createDiscoveryEvidence();
        const s1 = store.getState();
        for (const key of ELEMENT_KEYS) {
            expect(s1.elements[key]).toMatchObject({
                actions: [],
                confirmation: null,
                confirmedClearedBy: null,
                confirmationHistory: [],
                conflict: null,
            });
        }
        s1.elements.budget.actions.push({ kind: 'x' });
        s1.elements.budget.confirmationHistory.push({ kind: 'confirmed' });
        const s2 = store.getState();
        expect(s2.elements.budget.actions).toEqual([]);
        expect(s2.elements.budget.confirmationHistory).toEqual([]);
    });
    test('evidence trimming keeps the newest rows with increasing ids', () => {
        const store = createDiscoveryEvidence();
        let state;
        for (let i = 1; i <= 15; i++) state = store.processNewTurn(opp(`予算は${i}00万円です`)).state;
        const ids = state.elements.budget.evidence.map(e => e.id);
        expect(ids).toHaveLength(10);
        expect([...ids].sort((a, b) => a - b)).toEqual(ids);
        expect(new Set(ids).size).toBe(10);
        expect(state.elements.budget.evidence[9].text).toBe('予算は1500万円です');
    });
    test('dump exposes candidateCount and keeps totalScore = detected + confirmed', () => {
        const store = createDiscoveryEvidence();
        const { state } = store.processNewTurn(opp('予算は500万円です'));
        expect(state.candidateCount).toBe(0);
        expect(state.totalScore).toBe(1);
        expect(state.confirmedCount).toBe(0);
    });
    test('candidateCount counts candidate elements only', () => {
        const el = status => ({ status });
        const fake = { pain: el('candidate'), kpi: el('detected'), authority: el('candidate'), budget: el('partial'), timeline: el('empty') };
        expect(candidateCount(fake)).toBe(2);
    });
});

describe('v0.7.8 qualifiers (C11 / C15 / C19 / C21)', () => {
    const { createDiscoveryEvidence, classifyQualifier } = require('../../src/utils/discoveryEvidence');
    const opp = text => ({ speaker: 'opponent', text });
    const live = (state, key) => state.elements[key].evidence.filter(e => !e.retracted);

    test('C11: an unapproved budget proposal is candidate (tentative), not detected', () => {
        const store = createDiscoveryEvidence();
        const { state } = store.processNewTurn(opp('本件は年間100万円で申請する案を社内検討しています。金額はまだ仮で、申請も承認もこれからです。'));
        expect(state.elements.budget.status).toBe('candidate');
        expect(live(state, 'budget').some(e => e.specificity === 'concrete' && e.qualifier === 'tentative')).toBe(true);
    });
    test('C11 control: 「仮に100万円なら」 stays hypothetical (unknown), not candidate', () => {
        const store = createDiscoveryEvidence();
        const { state } = store.processNewTurn(opp('仮に100万円なら稟議は通るかもしれません。'));
        expect(state.elements.budget.status).toBe('partial');
        expect(live(state, 'budget')[0].polarity).toBe('hypothetical');
    });
    test('C15 t1: a current value with no target is partial (current), t3 target is detected', () => {
        const store = createDiscoveryEvidence();
        let r = store.processNewTurn(opp('いまの商談から受注への転換率は8％です。導入後に何を目標にするかは、まだ決めていません。'));
        expect(r.state.elements.kpi.status).toBe('partial');
        expect(live(r.state, 'kpi').some(e => e.qualifier === 'current')).toBe(true);
        store.processNewTurn({ speaker: 'self', text: '現在8％という数字だけでは、成功目標は未定ですね。' });
        r = store.processNewTurn(
            opp('社内で合意したので追記します。本件の成功指標は、導入後3か月間の商談から受注への転換率を12％以上にすることです。')
        );
        expect(r.state.elements.kpi.status).toBe('detected');
        expect(r.state.elements.timeline.status).toBe('empty');
    });
    test('C19: a wished, unagreed deadline stated across two sentences is candidate', () => {
        const store = createDiscoveryEvidence();
        const { state } = store.processNewTurn(
            opp('希望としては2026年11月中に使い始めたいです。ただ、その時期は社内で合意しておらず、変更になるかもしれません。')
        );
        expect(state.elements.timeline.status).toBe('candidate');
    });
    test('C21: a document-submission date goes to actions, not timeline; the deadline stays unknown', () => {
        const store = createDiscoveryEvidence();
        const { state } = store.processNewTurn(opp('御社からの提案資料は2026年10月15日までに送ってください。当社の導入時期はまだ決まっていません。'));
        expect(state.elements.timeline.status).not.toBe('detected');
        expect(state.elements.timeline.status).not.toBe('candidate');
        expect(state.elements.timeline.actions).toHaveLength(1);
        expect(state.elements.timeline.actions[0].kind).toBe('sales_action');
    });
    test('C21: an action entry carries an id, the sentence, the timestamp and its source; no evidence row', () => {
        const store = createDiscoveryEvidence();
        const { state } = store.processNewTurn({ ...opp('御社からの提案資料は2026年10月15日までに送ってください。'), timestamp: 42 });
        expect(state.elements.timeline.actions).toEqual([
            {
                id: expect.any(Number),
                text: '御社からの提案資料は2026年10月15日までに送ってください',
                timestamp: 42,
                kind: 'sales_action',
                source: 'regex',
            },
        ]);
        expect(state.elements.timeline.evidence).toHaveLength(0);
        expect(state.elements.timeline.status).toBe('empty');
    });
    test('classifyQualifier: 仮説 / 仮想 / ご提案です are not tentative markers', () => {
        expect(classifyQualifier('budget', '仮説としては年間100万円で足りると見ています。')).toBeNull();
        expect(classifyQualifier('budget', 'ご提案です。年間100万円でお願いします。')).toBeNull();
        expect(classifyQualifier('timeline', '仮想環境は来月末に用意します。')).toBeNull();
        expect(classifyQualifier('budget', '金額はまだ仮で、年間100万円の案です。')).toBe('tentative');
    });

    test('classifyQualifier: agreed wording is neutral', () => {
        expect(classifyQualifier('budget', '社内で合意済みの予算は年間100万円です。', ['社内で合意済みの予算は年間100万円です。'], 0)).toBeNull();
    });
    test('classifyQualifier: 「…しています」 is not the word いま (no current qualifier)', () => {
        expect(classifyQualifier('kpi', '月100件処理しています')).toBeNull();
        expect(classifyQualifier('kpi', 'いまは月100件です')).toBe('current');
    });
    test('classifyQualifier: a reference sentence from another position does not qualify the value', () => {
        const s = ['導入は2026年11月です', '別の話ですが、その件は未合意です'];
        expect(classifyQualifier('timeline', s[0], s, 0)).toBeNull();
    });
    test('a neutral concrete value in the same utterance still outranks a tentative one', () => {
        const store = createDiscoveryEvidence();
        const { state } = store.processNewTurn(opp('予算は年間100万円です。来期は200万円で申請する案もあります。'));
        expect(state.elements.budget.status).toBe('detected');
    });
    test('C22: a symptom with a 週N回 frequency is concrete pain; the denied symptom is not', () => {
        const store = createDiscoveryEvidence();
        const { state } = store.processNewTurn(opp('速度では困っていません。問題は夜間バッチが週2回止まり、翌朝の出荷処理を始められないことです。'));
        expect(state.elements.pain.status).toBe('detected');
        expect(state.elements.kpi.status).toBe('empty');
    });
});

describe('v0.7.8 qualifiers on the LLM path', () => {
    const { createDiscoveryEvidence } = require('../../src/utils/discoveryEvidence');

    test('applyLLMResult: filled quote inside a tentative sentence lands as candidate, not detected', () => {
        const store = createDiscoveryEvidence();
        const transcript = '本件は年間100万円で申請する案を社内検討しています。金額はまだ仮で、申請も承認もこれからです。';
        const { state } = store.applyLLMResult({ budget: { status: 'filled', quote: '年間100万円で申請する案' } }, transcript);
        expect(state.elements.budget.status).toBe('candidate');
    });
    test('applyLLMResult: a wished deadline is resolved through the following reference sentence', () => {
        const store = createDiscoveryEvidence();
        const transcript = '[相手] 希望としては2026年11月中に使い始めたいです。ただ、その時期は社内で合意しておらず、変更になるかもしれません。';
        const { state } = store.applyLLMResult({ timeline: { status: 'filled', quote: '2026年11月中' } }, transcript);
        expect(state.elements.timeline.status).toBe('candidate');
    });
    test('applyLLMResult: an unqualified date whose next sentence defers it via reference is candidate', () => {
        const store = createDiscoveryEvidence();
        const transcript = '導入は2026年11月を予定しています。ただ、その時期は社内で合意しておらず、変更になるかもしれません。';
        const { state } = store.applyLLMResult({ timeline: { status: 'filled', quote: '2026年11月を予定' } }, transcript);
        expect(state.elements.timeline.status).toBe('candidate');
    });
    test('applyLLMResult: a document-submission date goes to actions, not timeline', () => {
        const store = createDiscoveryEvidence();
        const transcript = '御社からの提案資料は2026年10月15日までに送ってください。';
        const { state } = store.applyLLMResult({ timeline: { status: 'filled', quote: '2026年10月15日までに送ってください' } }, transcript);
        expect(state.elements.timeline.status).toBe('empty');
        expect(state.elements.timeline.evidence).toHaveLength(0);
        expect(state.elements.timeline.actions).toEqual([expect.objectContaining({ kind: 'sales_action', source: 'llm', id: expect.any(Number) })]);
    });
    test('applyLLMResult: a current KPI with no target is partial (current)', () => {
        const store = createDiscoveryEvidence();
        const { state } = store.applyLLMResult({ kpi: { status: 'filled', quote: '転換率は8％' } }, 'いまの商談から受注への転換率は8％です。');
        expect(state.elements.kpi.status).toBe('partial');
        expect(state.elements.kpi.evidence[0].qualifier).toBe('current');
    });
});

describe('v0.7.8 values and budget conflicts (C24 / C13 / C14 / C07)', () => {
    const { createDiscoveryEvidence, extractValues } = require('../../src/utils/discoveryEvidence');
    const opp = text => ({ speaker: 'opponent', text });

    test('extractValues: amounts, periods, scopes, kanji numerals', () => {
        expect(extractValues('budget', '年間100万円です').amount).toEqual({ yen: 1_000_000, period: 'annual', scope: null });
        expect(extractValues('budget', '月額5万円、税抜です').amount).toEqual({ yen: 50_000, period: 'monthly', scope: 'recurring' });
        expect(extractValues('budget', '初期費用は50万円です').amount).toEqual({ yen: 500_000, period: 'one_time', scope: 'initial' });
        expect(extractValues('budget', '一千万円の枠です').amount.yen).toBe(10_000_000);
        expect(extractValues('budget', '予算は300万円です').amount.period).toBeNull();
        expect(extractValues('kpi', '導入後3か月間の転換率を12％以上にする')).toMatchObject({ percent: 12, role: 'target', period: '導入後3か月間' });
        expect(extractValues('kpi', 'いまの転換率は8％です')).toMatchObject({ percent: 8, role: 'current' });
    });
    test('C24: two comparable annual amounts → candidate(conflict) with both values; t4 leaves it unchanged; no retraction', () => {
        const store = createDiscoveryEvidence();
        let r = store.processNewTurn(opp('本件の承認済み予算は年間100万円と認識しています。'));
        expect(r.state.elements.budget.status).toBe('detected');
        r = store.processNewTurn(opp('私の手元の承認資料では、本件の年間予算は50万円です。どちらが最新か、いまは確認できません。'));
        expect(r.state.elements.budget.status).toBe('candidate');
        expect(r.state.elements.budget.conflict).toMatchObject({ basis: 'comparable', keptRowId: null });
        expect(r.state.elements.budget.conflict.values.map(v => v.yenAnnual).sort((a, b) => a - b)).toEqual([500_000, 1_000_000]);
        store.processNewTurn({ speaker: 'self', text: '同じ案件の金額が食い違っていますね。' });
        r = store.processNewTurn(opp('はい、今ここではどちらが正しいか決められません。正式な金額は持ち帰って確認します。'));
        expect(r.state.elements.budget.status).toBe('candidate');
        expect(r.state.elements.budget.evidence.some(e => e.polarity === 'retraction')).toBe(false);
    });
    test('a breakdown of the total (そのうち) is not a competing amount', () => {
        const store = createDiscoveryEvidence();
        store.processNewTurn(opp('今期の予算は500万円です。'));
        const { state } = store.processNewTurn(opp('そのうち今回使えるのは200万円です。'));
        expect(state.elements.budget.status).toBe('detected');
        expect(state.elements.budget.conflict).toBeNull();
    });

    test('C14: initial fee plus monthly fee are different scopes, not a conflict', () => {
        const store = createDiscoveryEvidence();
        store.processNewTurn(opp('初期費用は50万円です。'));
        const { state } = store.processNewTurn(opp('月額は5万円、税抜で考えています。'));
        expect(state.elements.budget.status).toBe('detected');
        expect(state.elements.budget.conflict).toBeNull();
    });
    test('C13: an explicit 「ではなく」 correction replaces, it is not a conflict', () => {
        const store = createDiscoveryEvidence();
        store.processNewTurn(opp('予算は300万円です。'));
        const { state } = store.processNewTurn(opp('失礼しました、300万円ではなく30万円です。'));
        expect(state.elements.budget.status).toBe('detected');
        expect(state.elements.budget.conflict).toBeNull();
        const live = state.elements.budget.evidence.filter(e => !e.retracted && !e.superseded && e.polarity !== 'retraction');
        expect(live).toHaveLength(1);
        expect(live[0].values.amount.yen).toBe(300_000);
    });
    test('C07: a third-party amount never conflicts with the own amount', () => {
        const store = createDiscoveryEvidence();
        store.processNewTurn(opp('当社の予算は年間100万円です。'));
        const { state } = store.processNewTurn(opp('他社では年間300万円だと聞きました。'));
        expect(state.elements.budget.status).toBe('detected');
        expect(state.elements.budget.conflict).toBeNull();
    });
    test('monthly 10万 vs annual 120万 normalize to the same amount → no conflict', () => {
        const store = createDiscoveryEvidence();
        store.processNewTurn(opp('月額10万円です。'));
        const { state } = store.processNewTurn(opp('年額では120万円になります。'));
        expect(state.elements.budget.conflict).toBeNull();
    });
    test('different amounts with unknown periods → candidate with conflictBasis unknown', () => {
        const store = createDiscoveryEvidence();
        store.processNewTurn(opp('予算は100万円です。'));
        const { state } = store.processNewTurn(opp('資料には50万円とあります。'));
        expect(state.elements.budget.status).toBe('candidate');
        expect(state.elements.budget.conflict.basis).toBe('unknown');
    });
    test("a later sentence that fixes the period upgrades the basis (T4'')", () => {
        const store = createDiscoveryEvidence();
        store.processNewTurn(opp('予算は100万円です。'));
        store.processNewTurn(opp('資料には50万円とあります。'));
        const { state } = store.processNewTurn(opp('どちらも年額の予算です。'));
        expect(state.elements.budget.conflict.basis).toBe('comparable');
    });
});

describe('v0.7.8 value parsing and conflict bookkeeping (Task 4)', () => {
    const { createDiscoveryEvidence, extractValues, kanjiToNumber } = require('../../src/utils/discoveryEvidence');
    const opp = text => ({ speaker: 'opponent', text });
    const filler = (store, n) => {
        for (let i = 0; i < n; i++) store.processNewTurn(opp('予算の件は持ち帰ります。'));
    };

    test('kanjiToNumber handles kanji numerals, commas and full-width digits', () => {
        expect(kanjiToNumber('一千万')).toBe(10_000_000);
        expect(kanjiToNumber('三百')).toBe(300);
        expect(kanjiToNumber('十二')).toBe(12);
        expect(kanjiToNumber('1,000')).toBe(1000);
        expect(kanjiToNumber('１０')).toBe(10);
        expect(kanjiToNumber('二億五千万')).toBe(250_000_000);
        expect(Number.isNaN(kanjiToNumber('abc'))).toBe(true);
    });
    test('extractValues: compound / full-width / vague amounts, tax note, timeline date, other keys', () => {
        expect(extractValues('budget', '総額は1億2000万円です').amount.yen).toBe(120_000_000);
        expect(extractValues('budget', '予算は１，０００万円です').amount.yen).toBe(10_000_000);
        expect(extractValues('budget', '数百万円くらいです')).toEqual({ raw: '数百万円くらいです' });
        expect(extractValues('budget', '月額5万円、税込です').taxNote).toBe('税込');
        expect(extractValues('budget', '初期費用は50万円、月額は5万円です').amount).toEqual({ yen: 500_000, period: 'one_time', scope: 'initial' });
        expect(extractValues('budget', '年間100万円です').amountText).toBe('100万円');
        expect(extractValues('timeline', '来月末までに決めたいです')).toEqual({ raw: '来月末までに決めたいです', date: '来月末' });
        expect(extractValues('pain', '入力ミスが毎週起きています')).toEqual({ raw: '入力ミスが毎週起きています' });
        expect(extractValues('kpi', '月300件の処理を目標にしています')).toMatchObject({ count: { n: 300, unit: '件' }, role: 'target' });
    });
    test('a row stores the value of the sentence that carries it, not of the whole utterance', () => {
        const store = createDiscoveryEvidence();
        const { state } = store.processNewTurn(opp('ありがとうございます。今期の予算は年間200万円です。'));
        expect(state.elements.budget.evidence[0].values).toMatchObject({
            raw: '今期の予算は年間200万円です',
            amount: { yen: 2_000_000, period: 'annual' },
        });
    });
    test('tentative amounts never enter a conflict', () => {
        const store = createDiscoveryEvidence();
        store.processNewTurn(opp('予算は年間100万円です。'));
        const { state } = store.processNewTurn(opp('年間50万円で申請する案です。'));
        expect(state.elements.budget.conflict).toBeNull();
        expect(state.elements.budget.status).toBe('detected');
    });
    test('a further conflicting row joins the conflict with keptRowId reset (T8)', () => {
        const store = createDiscoveryEvidence();
        store.processNewTurn(opp('予算は年間100万円です。'));
        store.processNewTurn(opp('資料では年間50万円です。'));
        let r = store.processNewTurn(opp('予算の件は持ち帰ります。'));
        expect(r.state.elements.budget.conflict.values).toHaveLength(2);
        r = store.processNewTurn(opp('別の資料では年間70万円です。'));
        expect(r.state.elements.budget.conflict.values.map(v => v.yenAnnual)).toEqual([1_000_000, 500_000, 700_000]);
        expect(r.state.elements.budget.conflict.keptRowId).toBeNull();
        expect(r.state.elements.budget.evidence.filter(e => e.qualifier === 'conflict')).toHaveLength(3);
    });
    test('a new conflict clears the user ✓ and records why', () => {
        const store = createDiscoveryEvidence();
        store.processNewTurn(opp('予算は年間100万円です。'));
        store.confirmElement('budget');
        const { state } = store.processNewTurn(opp('資料では年間50万円です。'));
        const b = state.elements.budget;
        expect(b.confirmed).toBe(false);
        expect(b.status).toBe('candidate');
        expect(b.confirmedClearedBy).toBe('conflict');
        expect(b.confirmationHistory).toEqual([
            expect.objectContaining({ kind: 'confirmed', reason: null }),
            expect.objectContaining({ kind: 'cleared', reason: 'conflict', quote: '資料では年間50万円です。' }),
        ]);
    });
    test('a leftover conflict row keeps its conflict until a same-amount restatement affirms it', () => {
        const store = createDiscoveryEvidence();
        store.processNewTurn(opp('予算は年間100万円です。'));
        filler(store, 8);
        let b = store.processNewTurn(opp('資料では年間50万円です。')).state.elements.budget;
        expect(b.conflict.values).toHaveLength(2);
        // One more budget row pushes the 100万 row out of the 10-row window;
        // the 50万 row stays in conflict on its own.
        filler(store, 1);
        b = store.getState().elements.budget;
        expect(b.evidence.some(e => e.values && e.values.amount && e.values.amount.yen === 500_000)).toBe(true);
        expect(b.evidence.some(e => e.values && e.values.amount && e.values.amount.yen === 1_000_000)).toBe(false);
        expect(b.status).toBe('candidate');
        expect(b.conflict.values).toEqual([expect.objectContaining({ yenAnnual: 500_000 })]);
        b = store.processNewTurn(opp('年間50万円で間違いありません。')).state.elements.budget;
        expect(b.conflict).toBeNull();
        expect(b.status).toBe('detected');
        expect(b.evidence.some(e => e.qualifier === 'conflict')).toBe(false);
    });
    test('a restatement of one side does not resolve a conflict while the other side is live', () => {
        const store = createDiscoveryEvidence();
        store.processNewTurn(opp('予算は年間100万円です。'));
        store.processNewTurn(opp('資料では年間50万円です。'));
        const { state } = store.processNewTurn(opp('年間100万円で間違いありません。'));
        expect(state.elements.budget.status).toBe('candidate');
        expect(state.elements.budget.conflict.values.map(v => v.yenAnnual)).toEqual([1_000_000, 500_000, 1_000_000]);
    });
    test('the LLM path extracts values from the transcript sentence and joins the conflict', () => {
        const store = createDiscoveryEvidence();
        store.processNewTurn(opp('予算は年間100万円です。'));
        const { state } = store.applyLLMResult(
            { budget: { status: 'filled', quote: '年間予算は50万円' } },
            '[相手] 予算は年間100万円です。\n[相手] 私の資料では年間予算は50万円です。'
        );
        const llmRow = state.elements.budget.evidence.find(e => e.source === 'llm');
        expect(llmRow.values).toMatchObject({ raw: '私の資料では年間予算は50万円です', amount: { yen: 500_000, period: 'annual' } });
        expect(state.elements.budget.status).toBe('candidate');
        expect(state.elements.budget.conflict.basis).toBe('comparable');
    });
    test('a regex retraction and a manual retract both clear the conflict', () => {
        let store = createDiscoveryEvidence();
        store.processNewTurn(opp('予算は年間100万円です。'));
        store.processNewTurn(opp('資料では年間50万円です。'));
        let { state } = store.processNewTurn(opp('先ほどの予算は撤回します。'));
        expect(state.elements.budget.conflict).toBeNull();
        expect(state.elements.budget.status).toBe('empty');

        store = createDiscoveryEvidence();
        store.processNewTurn(opp('予算は年間100万円です。'));
        store.processNewTurn(opp('資料では年間50万円です。'));
        ({ state } = store.retractElement('budget'));
        expect(state.elements.budget.conflict).toBeNull();
        expect(state.elements.budget.status).toBe('empty');
    });
    test('dump deep-copies row values', () => {
        const store = createDiscoveryEvidence();
        const s1 = store.processNewTurn(opp('予算は年間100万円です。')).state;
        s1.elements.budget.evidence[0].values.amount.yen = 1;
        expect(store.getState().elements.budget.evidence[0].values.amount.yen).toBe(1_000_000);
    });
});

describe('v0.7.8 transitions T1–T12 (選択と ✓ の分離)', () => {
    const { createDiscoveryEvidence } = require('../../src/utils/discoveryEvidence');
    const opp = text => ({ speaker: 'opponent', text });
    const budgetRows = s => s.elements.budget.evidence.filter(e => !e.retracted && !e.superseded && e.polarity !== 'retraction');
    const seedConflict = () => {
        const store = createDiscoveryEvidence();
        store.processNewTurn(opp('本件の承認済み予算は年間100万円と認識しています。'));
        store.processNewTurn(opp('私の手元の承認資料では、本件の年間予算は50万円です。'));
        return store;
    };

    test('T1/T5: comparable conflict → candidate; ✓ refused with conflict_unresolved', () => {
        const store = seedConflict();
        const r = store.confirmElement('budget');
        expect(r.changed).toBe(false);
        expect(r.reason).toBe('conflict_unresolved');
        expect(r.state.elements.budget.status).toBe('candidate');
    });
    test('T3: selecting a value keeps status candidate, keeps the conflict qualifier, and sets aside the other row', () => {
        const store = seedConflict();
        const rows = budgetRows(store.getState());
        const r = store.selectEvidence('budget', rows[1].id);
        expect(r.changed).toBe(true);
        expect(r.state.elements.budget.status).toBe('candidate');
        expect(r.state.elements.budget.conflict.keptRowId).toBe(rows[1].id);
        const after = budgetRows(r.state);
        expect(after.find(e => e.id === rows[1].id)).toMatchObject({ selection: 'kept', qualifier: 'conflict' });
        expect(after.find(e => e.id === rows[0].id)).toMatchObject({ selection: 'set_aside', qualifier: 'conflict' });
        expect(r.state.totalScore).toBe(0);
        expect(r.state.candidateCount).toBe(1);
        expect(r.state.confirmedCount).toBe(0);
    });
    test('T4: ✓ after selection confirms and records value, rowIds, quote, time', () => {
        const store = createDiscoveryEvidence({ now: () => 1234 });
        store.processNewTurn(opp('本件の承認済み予算は年間100万円と認識しています。'));
        store.processNewTurn(opp('私の手元の承認資料では、本件の年間予算は50万円です。'));
        const rows = budgetRows(store.getState());
        store.selectEvidence('budget', rows[0].id);
        const r = store.confirmElement('budget');
        expect(r.changed).toBe(true);
        expect(r.state.elements.budget.status).toBe('confirmed');
        expect(r.state.elements.budget.confirmation).toMatchObject({ rowIds: [rows[0].id], confirmedAt: 1234 });
        expect(r.state.elements.budget.confirmation.quote).toContain('年間100万円');
        expect(r.state.elements.budget.confirmationHistory[0]).toMatchObject({ kind: 'confirmed' });
        expect(r.state.confirmedCount).toBe(1);
    });
    test("T3'/T4': with unknown basis, ✓ is refused even after selection", () => {
        const store = createDiscoveryEvidence();
        store.processNewTurn(opp('予算は100万円です。'));
        store.processNewTurn(opp('資料には50万円とあります。'));
        const rows = budgetRows(store.getState());
        store.selectEvidence('budget', rows[0].id);
        const r = store.confirmElement('budget');
        expect(r.changed).toBe(false);
        expect(r.reason).toBe('basis_unknown');
    });
    test("T4'': the customer fixing the period makes the basis comparable; ✓ then succeeds", () => {
        const store = createDiscoveryEvidence();
        store.processNewTurn(opp('予算は100万円です。'));
        store.processNewTurn(opp('資料には50万円とあります。'));
        store.processNewTurn(opp('どちらも年額の予算です。'));
        const rows = budgetRows(store.getState());
        store.selectEvidence('budget', rows[0].id);
        expect(store.confirmElement('budget').changed).toBe(true);
    });
    test('T6: an explicit 「ではなく」 correction resolves the conflict to detected', () => {
        const store = seedConflict();
        const { state } = store.processNewTurn(opp('確認しました。100万円ではなく50万円が正式です。'));
        expect(state.elements.budget.status).toBe('detected');
        expect(state.elements.budget.conflict).toBeNull();
    });
    test('T7: retracting one of two conflicting values leaves the other as detected', () => {
        const store = seedConflict();
        const { state } = store.processNewTurn(opp('100万円の方は撤回します。'));
        expect(state.elements.budget.status).toBe('detected');
        // detected, never confirmed: only the user's ✓ confirms (spec decision 4c)
        expect(state.elements.budget.confirmed).toBe(false);
        expect(state.confirmedCount).toBe(0);
    });
    test('T8: a new conflicting value after a selection clears the selection', () => {
        const store = seedConflict();
        const rows = budgetRows(store.getState());
        store.selectEvidence('budget', rows[0].id);
        const { state } = store.processNewTurn(opp('もう一つの資料では年間80万円です。'));
        // 3 値の競合、選択は解除
        expect(state.elements.budget.conflict.keptRowId).toBeNull();
        expect(state.elements.budget.conflict.values).toHaveLength(3);
        expect(state.elements.budget.status).toBe('candidate');
    });
    test('in-house hearsay alone is a candidate (tentative), not third-party and not detected (spec decision 1)', () => {
        const store = createDiscoveryEvidence();
        const { state } = store.processNewTurn(opp('別の部門では年間80万円と聞いています。'));
        const b = state.elements.budget;
        expect(b.status).toBe('candidate');
        expect(b.evidence).toHaveLength(1);
        expect(b.evidence[0]).toMatchObject({ specificity: 'concrete', polarity: null, qualifier: 'tentative' });
        expect(state.totalScore).toBe(0);
        expect(state.candidateCount).toBe(1);
    });
    test('a tentative in-house hearsay value does not join a conflict', () => {
        const store = createDiscoveryEvidence();
        store.processNewTurn(opp('予算は年間100万円です。'));
        const { state } = store.processNewTurn(opp('別の部門では年間80万円と聞いています。'));
        expect(state.elements.budget.conflict).toBeNull();
        expect(state.elements.budget.status).toBe('detected');
    });
    test('T9: a comparable conflicting value after ✓ clears the confirmation with reason conflict', () => {
        const store = createDiscoveryEvidence();
        store.processNewTurn(opp('本件の承認済み予算は年間100万円と認識しています。'));
        expect(store.confirmElement('budget').changed).toBe(true);
        const { state } = store.processNewTurn(opp('私の手元の承認資料では、本件の年間予算は50万円です。'));
        expect(state.elements.budget.status).toBe('candidate');
        expect(state.elements.budget.confirmed).toBe(false);
        expect(state.elements.budget.confirmedClearedBy).toBe('conflict');
        expect(state.elements.budget.confirmationHistory.at(-1)).toMatchObject({ kind: 'cleared', reason: 'conflict' });
        expect(state.confirmedCount).toBe(0);
    });
    test('T9 (other scope): a ✓ on the initial fee is cleared when a recurring conflict appears later (spec decision 5)', () => {
        const store = createDiscoveryEvidence();
        store.processNewTurn(opp('初期費用は50万円です。'));
        let r = store.confirmElement('budget');
        expect(r.changed).toBe(true);
        expect(r.state.elements.budget.confirmation.value).toBe('50万円');
        r = store.processNewTurn(opp('月額は5万円です。'));
        expect(r.state.elements.budget.confirmed).toBe(true);
        const { state } = store.processNewTurn(opp('資料では月額8万円とあります。'));
        const b = state.elements.budget;
        expect(b.conflict).toMatchObject({ basis: 'comparable', keptRowId: null });
        expect(b.conflict.values.map(v => v.yenAnnual)).toEqual([600_000, 960_000]);
        expect(b.confirmed).toBe(false);
        expect(b.confirmedClearedBy).toBe('conflict');
        expect(state.confirmedCount).toBe(0);
        const refused = store.confirmElement('budget');
        expect(refused).toMatchObject({ changed: false, reason: 'conflict_unresolved' });
        expect(refused.state.elements.budget.confirmed).toBe(false);
    });
    test('T10: an explicit retraction after ✓ clears the confirmation and empties the element', () => {
        const store = createDiscoveryEvidence();
        store.processNewTurn(opp('予算は年間100万円です。'));
        store.confirmElement('budget');
        const { state } = store.processNewTurn(opp('先ほどの予算は撤回します。'));
        expect(state.elements.budget.status).toBe('empty');
        expect(state.elements.budget.confirmedClearedBy).toBe('retraction');
    });
    test('T10 (LLM path): a grounded empty with a retraction quote also clears ✓', () => {
        const store = createDiscoveryEvidence();
        const transcript = '予算は年間100万円です。先ほどの予算は撤回します。';
        store.processNewTurn(opp('予算は年間100万円です。'));
        store.confirmElement('budget');
        const { state } = store.applyLLMResult({ budget: { status: 'empty', quote: '先ほどの予算は撤回します' } }, transcript);
        expect(state.elements.budget.confirmed).toBe(false);
        expect(state.elements.budget.confirmedClearedBy).toBe('retraction');
    });
    test('T11: retracting the kept value leaves the set-aside value as a candidate needing confirmation (not detected)', () => {
        const store = seedConflict();
        const rows = budgetRows(store.getState());
        store.selectEvidence('budget', rows[1].id); // 50万 を kept
        const { state } = store.processNewTurn(opp('50万円の方は撤回します。'));
        expect(state.elements.budget.status).toBe('candidate');
        expect(state.elements.budget.conflict.keptRowId).toBeNull();
    });
    test('T12: manual ✕ empties the element and records manual as the clear reason', () => {
        const store = createDiscoveryEvidence();
        store.processNewTurn(opp('予算は年間100万円です。'));
        store.confirmElement('budget');
        const { state } = store.retractElement('budget', 'manual');
        expect(state.elements.budget.status).toBe('empty');
        expect(state.elements.budget.confirmedClearedBy).toBe('manual');
    });
    test('two clicks (select → ✓) cannot cross an unknown basis', () => {
        const store = createDiscoveryEvidence();
        store.processNewTurn(opp('予算は100万円です。'));
        store.processNewTurn(opp('資料には50万円とあります。'));
        const rows = budgetRows(store.getState());
        store.selectEvidence('budget', rows[1].id);
        store.selectEvidence('budget', rows[0].id);
        expect(store.confirmElement('budget').reason).toBe('basis_unknown');
        expect(store.getState().elements.budget.status).toBe('candidate');
    });
    test('✓ on a tentative-only candidate (C11) is allowed: the user attests the customer confirmed it', () => {
        const store = createDiscoveryEvidence();
        store.processNewTurn(opp('本件は年間100万円で申請する案を社内検討しています。金額はまだ仮で、申請も承認もこれからです。'));
        expect(store.confirmElement('budget').changed).toBe(true);
    });
    test('✓ is refused while a conflict in another cost scope is unresolved, even if the status reads detected', () => {
        const store = createDiscoveryEvidence();
        store.processNewTurn(opp('初期費用は50万円です。'));
        store.processNewTurn(opp('資料では初期費用は80万円とあります。'));
        const { state } = store.processNewTurn(opp('月額は5万円です。'));
        expect(state.elements.budget.conflict).not.toBeNull();
        const r = store.confirmElement('budget');
        expect(r.changed).toBe(false);
        expect(r.reason).toBe('conflict_unresolved');
    });

    test('✓ on partial / empty is refused with no_candidate', () => {
        const store = createDiscoveryEvidence();
        store.processNewTurn(opp('予算はまだ決まっていません。'));
        expect(store.confirmElement('budget').reason).toBe('no_candidate');
    });
});

describe('v0.7.8 transitions — selection / confirmation bookkeeping (Task 5)', () => {
    const { createDiscoveryEvidence, classifyPolarity } = require('../../src/utils/discoveryEvidence');
    const opp = text => ({ speaker: 'opponent', text });
    const liveBudget = s => s.elements.budget.evidence.filter(e => !e.retracted && !e.superseded && e.polarity !== 'retraction');
    const seedConflict = (options = {}) => {
        const store = createDiscoveryEvidence(options);
        store.processNewTurn(opp('本件の承認済み予算は年間100万円と認識しています。'));
        store.processNewTurn(opp('私の手元の承認資料では、本件の年間予算は50万円です。'));
        return store;
    };

    test('selectEvidence refuses unknown rows, non-live rows and rows outside a conflict', () => {
        const store = seedConflict();
        expect(store.selectEvidence('budget', 9999)).toMatchObject({ changed: false, reason: 'unknown_row' });
        expect(store.selectEvidence('nope', 1)).toMatchObject({ changed: false, reason: 'unknown_row' });
        const plain = createDiscoveryEvidence();
        plain.processNewTurn(opp('予算は年間100万円です。'));
        const row = liveBudget(plain.getState())[0];
        expect(plain.selectEvidence('budget', row.id)).toMatchObject({ changed: false, reason: 'no_conflict' });
        const retracted = seedConflict();
        const [a] = liveBudget(retracted.getState());
        retracted.retractElement('budget', 'manual');
        expect(retracted.selectEvidence('budget', a.id)).toMatchObject({ changed: false, reason: 'row_not_live' });
    });
    test('re-selecting the kept row is a no-op; selecting the other row swaps kept / set_aside', () => {
        const store = seedConflict();
        const [a, b] = liveBudget(store.getState());
        store.selectEvidence('budget', a.id);
        expect(store.selectEvidence('budget', a.id).changed).toBe(false);
        const r = store.selectEvidence('budget', b.id);
        expect(r.changed).toBe(true);
        const rows = liveBudget(r.state);
        expect(rows.find(e => e.id === a.id).selection).toBe('set_aside');
        expect(rows.find(e => e.id === b.id).selection).toBe('kept');
    });
    test('T8: a new value resets every selection and remembers the previous choice', () => {
        const store = seedConflict();
        const [a] = liveBudget(store.getState());
        store.selectEvidence('budget', a.id);
        const { state } = store.processNewTurn(opp('もう一つの資料では年間80万円です。'));
        expect(state.elements.budget.conflict.values).toHaveLength(3);
        expect(state.elements.budget.conflict.previousKeptRowId).toBe(a.id);
        expect(liveBudget(state).every(e => e.selection === null)).toBe(true);
    });
    test('internal hearsay is the customer’s own figure; outside hearsay stays third-party', () => {
        expect(classifyPolarity('別の部門では年間80万円と聞いています')).toBeNull();
        expect(classifyPolarity('他社の部門では年間80万円と聞いています')).toBe('third_party');
        expect(classifyPolarity('予算は80万円らしいです')).toBe('third_party');
    });
    test('classifyQualifier: in-house hearsay is tentative; 「素晴らしい」 is not hearsay', () => {
        const { classifyQualifier } = require('../../src/utils/discoveryEvidence');
        expect(classifyQualifier('budget', '別の部門では年間80万円と聞いています')).toBe('tentative');
        expect(classifyQualifier('budget', '社内では年間80万円とのことです')).toBe('tentative');
        expect(classifyQualifier('budget', '当社の予算は年間80万円だそうです')).toBe('tentative');
        expect(classifyQualifier('budget', '素晴らしい、予算は年間80万円です')).toBeNull();
    });
    test('「A ではなく B」 keeps the old value with reason correction and the correction sentence (spec decision 2)', () => {
        const store = createDiscoveryEvidence();
        store.processNewTurn(opp('予算は300万円です。'));
        const { state } = store.processNewTurn(opp('失礼しました、300万円ではなく30万円です。'));
        const rows = state.elements.budget.evidence;
        const old = rows.find(e => e.values && e.values.amountText === '300万円');
        expect(old).toMatchObject({ retracted: true, retractedBy: 'correction', retractedQuote: '失礼しました、300万円ではなく30万円です' });
        expect(old.text).toBe('予算は300万円です。');
        const live = liveBudget(state);
        expect(live).toHaveLength(1);
        expect(live[0]).toMatchObject({ retracted: false, retractedBy: null, retractedQuote: null });
    });
    test('an explicit retraction records reason retraction and its sentence; manual ✕ records manual (spec decision 2)', () => {
        let store = seedConflict();
        let state = store.processNewTurn(opp('ありがとうございます。100万円の方は撤回します。')).state;
        let rows = state.elements.budget.evidence;
        expect(rows.find(e => e.values && e.values.amountText === '100万円')).toMatchObject({
            retracted: true,
            retractedBy: 'retraction',
            retractedQuote: '100万円の方は撤回します',
        });
        expect(rows.find(e => e.polarity === 'retraction')).toMatchObject({ retractionTarget: 'row' });

        store = createDiscoveryEvidence();
        store.processNewTurn(opp('予算は年間100万円です。'));
        state = store.processNewTurn(opp('先ほどの予算は撤回します。')).state;
        rows = state.elements.budget.evidence;
        expect(rows[0]).toMatchObject({ retracted: true, retractedBy: 'retraction', retractedQuote: '先ほどの予算は撤回します' });
        expect(rows.find(e => e.polarity === 'retraction')).toMatchObject({ retractionTarget: 'element' });

        store = createDiscoveryEvidence();
        store.processNewTurn(opp('予算は年間100万円です。'));
        state = store.retractElement('budget', 'manual').state;
        rows = state.elements.budget.evidence;
        expect(rows[0]).toMatchObject({ retracted: true, retractedBy: 'manual', retractedQuote: null });
        expect(rows.at(-1)).toMatchObject({ source: 'user', retractedBy: 'manual', retractionTarget: 'element' });
    });
    test('a grounded LLM empty records reason retraction with the quote; an earlier reason is never overwritten', () => {
        const store = createDiscoveryEvidence();
        store.processNewTurn(opp('予算は300万円です。'));
        store.processNewTurn(opp('300万円ではなく30万円です。'));
        const { state } = store.applyLLMResult(
            { budget: { status: 'empty', quote: '先ほどの予算は撤回します' } },
            '[相手] 300万円ではなく30万円です。\n[相手] 先ほどの予算は撤回します。'
        );
        const rows = state.elements.budget.evidence;
        expect(rows.find(e => e.values && e.values.amountText === '300万円')).toMatchObject({ retractedBy: 'correction' });
        expect(rows.find(e => e.values && e.values.amountText === '30万円')).toMatchObject({
            retracted: true,
            retractedBy: 'retraction',
            retractedQuote: '先ほどの予算は撤回します',
        });
        expect(rows.at(-1)).toMatchObject({ source: 'llm', polarity: 'retraction', retractionTarget: 'element' });
    });
    test('an amount-named retraction that matches more than one value retracts none (spec decision 3)', () => {
        const store = createDiscoveryEvidence();
        store.processNewTurn(opp('初期費用は50万円です。'));
        store.processNewTurn(opp('月額は50万円です。'));
        let r = store.confirmElement('budget');
        expect(r.changed).toBe(true);
        const before = liveBudget(r.state).map(e => e.id);
        expect(before).toHaveLength(2);
        const { state } = store.processNewTurn(opp('すみません、50万円の方は撤回します。'));
        const el = state.elements.budget;
        expect(liveBudget(state).map(e => e.id)).toEqual(before);
        expect(el.status).toBe('confirmed');
        expect(el.confirmed).toBe(true);
        expect(el.confirmedClearedBy).toBeNull();
        const marker = el.evidence.at(-1);
        expect(marker).toMatchObject({
            text: 'すみません、50万円の方は撤回します',
            polarity: 'retraction',
            retracted: true,
            retractionTarget: 'ambiguous',
            retractedBy: null,
        });
        // Without a ✓ the status stays as it was, too.
        const plain = createDiscoveryEvidence();
        plain.processNewTurn(opp('初期費用は50万円です。'));
        plain.processNewTurn(opp('月額は50万円です。'));
        r = plain.processNewTurn(opp('50万円の方は撤回します。'));
        expect(r.state.elements.budget.status).toBe('detected');
        expect(liveBudget(r.state)).toHaveLength(2);
    });
    test('restating the same value twice is not an ambiguity: the named amount still withdraws it', () => {
        const store = createDiscoveryEvidence();
        store.processNewTurn(opp('予算は年間100万円です。'));
        store.processNewTurn(opp('初期費用は30万円です。'));
        store.processNewTurn(opp('年間100万円で間違いありません。'));
        const { state } = store.processNewTurn(opp('100万円の方は撤回します。'));
        expect(liveBudget(state).map(e => e.values.amountText)).toEqual(['30万円']);
        expect(state.elements.budget.evidence.at(-1)).toMatchObject({ retractionTarget: 'row' });
    });
    test('T7 vs T11: the leftover row is detected only when no selection was voided', () => {
        // T7: no selection, the customer withdraws 100万 → 50万 is the stated value.
        let store = seedConflict();
        let state = store.processNewTurn(opp('100万円の方は撤回します。')).state;
        let rows = liveBudget(state);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ qualifier: null, conflictBasis: null, selection: null });
        expect(state.elements.budget.conflict).toBeNull();
        expect(state.elements.budget.status).toBe('detected');

        // T11: 50万 was kept, the customer withdraws 50万 → 100万 was never affirmed.
        store = seedConflict();
        const [a, b] = liveBudget(store.getState());
        store.selectEvidence('budget', b.id);
        state = store.processNewTurn({ speaker: 'opponent', text: '50万円の方は撤回します。', timestamp: 5000 }).state;
        rows = liveBudget(state);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ id: a.id, qualifier: 'conflict', conflictBasis: 'comparable', selection: null });
        expect(state.elements.budget.conflict).toMatchObject({ keptRowId: null, previousKeptRowId: b.id, unresolvedSince: 5000 });
        expect(store.confirmElement('budget').reason).toBe('conflict_unresolved');
        // A same-amount restatement affirms it.
        state = store.processNewTurn(opp('年間100万円で間違いありません。')).state;
        expect(state.elements.budget.status).toBe('detected');
    });
    test('T11b: retracting the set-aside value does not promote the kept value', () => {
        const store = seedConflict();
        const [a, b] = liveBudget(store.getState());
        store.selectEvidence('budget', b.id);
        const { state } = store.processNewTurn(opp('100万円の方は撤回します。'));
        const el = state.elements.budget;
        // The user's selection is not the customer's confirmation: the kept
        // value stays a candidate needing confirmation (spec decision 4b).
        expect(el.status).toBe('candidate');
        expect(liveBudget(state)).toEqual([expect.objectContaining({ id: b.id, qualifier: 'conflict', selection: 'kept' })]);
        expect(el.conflict).toMatchObject({ keptRowId: b.id, basis: 'comparable' });
        expect(el.conflict.values).toEqual([expect.objectContaining({ rowId: b.id, yenAnnual: 500_000 })]);
        expect(el.evidence.find(e => e.id === a.id)).toMatchObject({ retracted: true, retractedBy: 'retraction' });
        expect(state.totalScore).toBe(0);
        expect(state.confirmedCount).toBe(0);
        // ✓ stays available (kept value, comparable basis) — the user attests it.
        expect(store.confirmElement('budget').changed).toBe(true);
    });
    test('confirmation record, already_confirmed, and re-confirming after a clear', () => {
        const store = createDiscoveryEvidence({ now: () => 77 });
        store.processNewTurn(opp('予算は年間100万円です。'));
        let r = store.confirmElement('budget');
        const rowId = liveBudget(r.state)[0].id;
        expect(r.state.elements.budget.confirmation).toEqual({
            value: '100万円',
            rowIds: [rowId],
            quote: '予算は年間100万円です。',
            confirmedAt: 77,
            basis: 'customer_confirmed',
        });
        expect(r.state.elements.budget.confirmationHistory).toEqual([
            { kind: 'confirmed', reason: null, at: 77, quote: '予算は年間100万円です。', value: '100万円' },
        ]);
        expect(store.confirmElement('budget')).toMatchObject({ changed: false, reason: 'already_confirmed' });
        r = store.processNewTurn(opp('資料では年間50万円です。'));
        expect(r.state.elements.budget.confirmation).toBeNull();
        expect(r.state.elements.budget.confirmationHistory.at(-1)).toMatchObject({ kind: 'cleared', reason: 'conflict', value: '100万円' });
        const rows = liveBudget(r.state);
        store.selectEvidence('budget', rows[1].id);
        r = store.confirmElement('budget');
        expect(r.changed).toBe(true);
        expect(r.state.elements.budget.confirmedClearedBy).toBeNull();
        expect(r.state.elements.budget.confirmation).toMatchObject({ value: '50万円', rowIds: [rows[1].id] });
    });
    test('a retraction that names a different, unconfirmed amount keeps the ✓', () => {
        const store = createDiscoveryEvidence();
        store.processNewTurn(opp('初期費用は50万円です。'));
        store.processNewTurn(opp('月額の利用料は10万円です。'));
        expect(store.confirmElement('budget').state.elements.budget.confirmation.value).toBe('10万円');
        const { state } = store.processNewTurn(opp('50万円の方は撤回します。'));
        expect(state.elements.budget.confirmed).toBe(true);
        expect(state.elements.budget.status).toBe('confirmed');
        expect(liveBudget(state).map(e => e.values.amountText)).toEqual(['10万円']);
    });
    test('a manual ✕ after ✓ records manual in the history', () => {
        const store = createDiscoveryEvidence();
        store.processNewTurn(opp('予算は年間100万円です。'));
        store.confirmElement('budget');
        const { state } = store.retractElement('budget', 'manual');
        expect(state.elements.budget.confirmationHistory.at(-1)).toMatchObject({
            kind: 'cleared',
            reason: 'manual',
            quote: '予算は年間100万円です。',
        });
        expect(state.confirmedCount).toBe(0);
    });
    test('✓ on a detected element ignores tagged rows and confirms the newest neutral one', () => {
        const store = createDiscoveryEvidence();
        store.processNewTurn(opp('予算は年間100万円です。'));
        store.processNewTurn(opp('他社の予算は年間300万円らしいです。'));
        const r = store.confirmElement('budget');
        expect(r.changed).toBe(true);
        expect(r.state.elements.budget.confirmation.value).toBe('100万円');
    });
});

describe('v0.7.8 several amounts in one sentence (spec decision 6)', () => {
    const { createDiscoveryEvidence, extractValues } = require('../../src/utils/discoveryEvidence');
    const opp = text => ({ speaker: 'opponent', text });
    const live = s => s.elements.budget.evidence.filter(e => !e.retracted && !e.superseded && e.polarity !== 'retraction');

    test('extractValues returns every amount with its own clause-based period / scope; amount stays the first one', () => {
        const two = extractValues('budget', '初期費用50万円、月額5万円です');
        expect(two.amounts).toEqual([
            { text: '50万円', yen: 500_000, period: 'one_time', scope: 'initial' },
            { text: '5万円', yen: 50_000, period: 'monthly', scope: 'recurring' },
        ]);
        expect(two.amount).toEqual({ yen: 500_000, period: 'one_time', scope: 'initial' });
        expect(two.amountText).toBe('50万円');
        // No comma: the previous amount still bounds the clause.
        expect(extractValues('budget', '初期費用50万円と月額5万円です').amounts.map(a => [a.period, a.scope])).toEqual([
            ['one_time', 'initial'],
            ['monthly', 'recurring'],
        ]);
        expect(extractValues('budget', '予算は100万円か50万円です').amounts).toEqual([
            { text: '100万円', yen: 1_000_000, period: null, scope: null },
            { text: '50万円', yen: 500_000, period: null, scope: null },
        ]);
        expect(extractValues('budget', '年間100万円です').amounts).toEqual([{ text: '100万円', yen: 1_000_000, period: 'annual', scope: null }]);
    });

    test('「100万円か50万円」 is a within-row conflict with unknown basis until the period is stated', () => {
        const store = createDiscoveryEvidence();
        let { state } = store.processNewTurn(opp('予算は100万円か50万円です。'));
        let b = state.elements.budget;
        expect(b.status).toBe('candidate');
        expect(b.evidence).toHaveLength(1);
        expect(b.evidence[0]).toMatchObject({ qualifier: 'conflict', conflictBasis: 'unknown' });
        expect(b.evidence[0].values.raw).toBe('予算は100万円か50万円です');
        expect(b.conflict.basis).toBe('unknown');
        expect(b.conflict.values).toEqual([
            { rowId: b.evidence[0].id, amountIndex: 0, raw: '100万円', yenAnnual: null, period: null, scope: null },
            { rowId: b.evidence[0].id, amountIndex: 1, raw: '50万円', yenAnnual: null, period: null, scope: null },
        ]);
        expect(store.confirmElement('budget')).toMatchObject({ changed: false, reason: 'basis_unknown' });

        ({ state } = store.processNewTurn(opp('どちらも年額です。')));
        b = state.elements.budget;
        expect(b.status).toBe('candidate');
        expect(b.conflict.basis).toBe('comparable');
        expect(b.conflict.values.map(v => [v.raw, v.yenAnnual, v.period])).toEqual([
            ['100万円', 1_000_000, 'annual'],
            ['50万円', 500_000, 'annual'],
        ]);
        // Selecting the only row does not say which of its two amounts was kept.
        expect(store.confirmElement('budget')).toMatchObject({ changed: false, reason: 'conflict_unresolved' });
        store.selectEvidence('budget', b.evidence[0].id);
        expect(store.confirmElement('budget')).toMatchObject({ changed: false, reason: 'conflict_unresolved' });
    });

    test('「初期費用50万円、月額5万円」 is two units, not a conflict; restating the monthly fee keeps it so', () => {
        const store = createDiscoveryEvidence();
        let { state } = store.processNewTurn(opp('初期費用50万円、月額5万円です。'));
        let b = state.elements.budget;
        expect(b.status).toBe('detected');
        expect(b.conflict).toBeNull();
        expect(b.evidence[0].values.amounts.map(a => a.scope)).toEqual(['initial', 'recurring']);
        ({ state } = store.processNewTurn(opp('月額は5万円で変わりません。')));
        b = state.elements.budget;
        expect(b.conflict).toBeNull();
        expect(b.status).toBe('detected');
        // ✓ confirms the newest neutral row (the restatement).
        const confirmed = store.confirmElement('budget').state.elements.budget;
        expect(confirmed.status).toBe('confirmed');
        expect(confirmed.confirmation.value).toBe('5万円');
    });

    test('a different monthly fee later conflicts with exactly the recurring amounts', () => {
        const store = createDiscoveryEvidence();
        store.processNewTurn(opp('初期費用50万円、月額5万円です。'));
        const { state } = store.processNewTurn(opp('月額は8万円です。'));
        const b = state.elements.budget;
        expect(b.status).toBe('candidate');
        expect(b.conflict.basis).toBe('comparable');
        const [first, second] = live(state);
        expect(b.conflict.values).toEqual([
            { rowId: first.id, amountIndex: 1, raw: '5万円', yenAnnual: 600_000, period: 'monthly', scope: 'recurring' },
            { rowId: second.id, amountIndex: 0, raw: '8万円', yenAnnual: 960_000, period: 'monthly', scope: 'recurring' },
        ]);
        // Keeping the first row and confirming records its conflicting amount.
        store.selectEvidence('budget', first.id);
        const r = store.confirmElement('budget');
        expect(r.changed).toBe(true);
        expect(r.state.elements.budget.confirmation.value).toBe('5万円');
    });

    test('✓ on a multi-amount row without a conflict records every amount', () => {
        const store = createDiscoveryEvidence();
        store.processNewTurn(opp('初期費用50万円、月額5万円です。'));
        expect(store.confirmElement('budget').state.elements.budget.confirmation.value).toBe('50万円 / 5万円');
    });

    test('a retraction naming one amount of a two-amount sentence withdraws that row only when unambiguous', () => {
        const store = createDiscoveryEvidence();
        store.processNewTurn(opp('初期費用50万円、月額5万円です。'));
        store.processNewTurn(opp('月額は8万円です。'));
        const { state } = store.processNewTurn(opp('8万円の方は撤回します。'));
        expect(state.elements.budget.conflict).toBeNull();
        expect(state.elements.budget.status).toBe('detected');
        expect(live(state)).toHaveLength(1);
    });
});
