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

    test('LLM empty with a grounded retraction quote downgrades; ungrounded empty is a no-op', () => {
        const store = createDiscoveryEvidence();
        store.processNewTurn(opp('予算は100万円です'));
        let r = store.applyLLMResult(
            { budget: { status: 'empty', quote: '予算は未定です' } },
            '[相手] 予算は100万円です [相手] やはり予算は未定です'
        );
        expect(r.changed).toBe(true);
        expect(r.state.elements.budget.status).toBe('partial');
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
        expect(state.elements.budget.status).toBe('partial');
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
        expect(state.elements.budget.status).toBe('partial');
    });

    test('(d) an automatic retraction never clears a user confirmation', () => {
        const store = createDiscoveryEvidence();
        store.processNewTurn(opp('予算は500万円です'));
        store.confirmElement('budget');
        const { state } = store.processNewTurn(opp('予算は撤回します'));
        expect(state.elements.budget.status).toBe('confirmed');
        expect(state.elements.budget.confirmed).toBe(true);
        const nonRetractionRows = state.elements.budget.evidence.filter(e => e.polarity !== 'retraction');
        expect(nonRetractionRows.length).toBeGreaterThan(0);
        expect(nonRetractionRows.every(e => e.retracted)).toBe(true);
    });

    test('(e) LLM empty with a grounded negation keeps a confirmed element confirmed', () => {
        const store = createDiscoveryEvidence();
        store.processNewTurn(opp('予算は100万円です'));
        store.confirmElement('budget');
        const r = store.applyLLMResult(
            { budget: { status: 'empty', quote: '予算は未定です' } },
            '[相手] 予算は100万円です [相手] やはり予算は未定です'
        );
        expect(r.state.elements.budget.status).toBe('confirmed');
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

    test('「当社は…未定です」 global correction retracts everything but never clears a confirmation', () => {
        const { store } = run('予算は500万円です。部長が決めます。');
        store.confirmElement('authority');
        const { state } = store.processNewTurn(opp('当社の案件は各項目とも未定です'));
        expect(state.elements.budget.status).toBe('partial');
        expect(state.elements.authority.status).toBe('confirmed');
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
        expect(state.elements.budget.status).toBe('partial');
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
        expect(r.state.elements.budget.status).toBe('partial');
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
