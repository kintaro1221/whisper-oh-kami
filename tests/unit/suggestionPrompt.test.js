// suggestionPrompt.js unit tests — Phase 2.A.
//
// Pins three things the prompt builder must guarantee:
//   1. Only discovery / sales profiles get the evidence block injected.
//      Everything else (null, undefined, interview, meeting, ...) keeps
//      the existing prompt byte-for-byte. This is the production safety
//      contract: `currentProfile === null` (session not initialized) must
//      not leak the block into prompts for users on other profiles.
//   2. resolveSuggestionProfile is an explicit whitelist, not a `||
//      'discovery'` fallback. devHarness.js uses the fallback for its
//      own bootstrapping but production must stay safe.
//   3. detected / confirmed / partial elements carry their most recent quote so the
//      model can avoid re-asking; empty elements get a label-only line;
//      the trailing instruction is present.

const { resolveSuggestionProfile, buildEvidenceBlock, buildSuggestionPrompt } = require('../../src/utils/suggestionPrompt');

// ── helpers ──────────────────────────────────────────────────────────────

function makeElement(status, text) {
    return {
        status,
        evidence: text
            ? [{ text, timestamp: 0, specificity: status === 'detected' || status === 'confirmed' ? 'concrete' : 'keyword', source: 'regex' }]
            : [],
        lastUpdate: text ? 0 : null,
    };
}

function makeEvidence(overrides = {}) {
    const keys = ['pain', 'kpi', 'authority', 'budget', 'timeline'];
    const elements = {};
    for (const k of keys) {
        const o = overrides[k] || { status: 'empty' };
        elements[k] = makeElement(o.status, o.text);
    }
    return {
        elements,
        totalScore: keys.filter(k => elements[k].status === 'detected' || elements[k].status === 'confirmed').length,
        confirmedCount: keys.filter(k => elements[k].status === 'confirmed').length,
        updatedAt: 0,
    };
}

const BASE_ARGS = {
    recent: '[相手] 残業が月50時間で\n[自分] そうですか',
    eventKind: 'self_finished',
    last: { speaker: 'self', text: 'そうですか' },
};

// ── resolveSuggestionProfile — whitelist semantics ────────────────────────

describe('resolveSuggestionProfile — whitelist semantics (Phase 2.A)', () => {
    test('discovery → "discovery"', () => {
        expect(resolveSuggestionProfile('discovery')).toBe('discovery');
    });

    test('sales → "sales"', () => {
        expect(resolveSuggestionProfile('sales')).toBe('sales');
    });

    test('null → null (production safety: no inject when profile not yet initialized)', () => {
        expect(resolveSuggestionProfile(null)).toBeNull();
    });

    test('undefined → null', () => {
        expect(resolveSuggestionProfile(undefined)).toBeNull();
    });

    test('empty string → null', () => {
        expect(resolveSuggestionProfile('')).toBeNull();
    });

    test('non-sales profiles → null', () => {
        for (const profile of ['interview', 'meeting', 'presentation', 'negotiation', 'exam']) {
            expect(resolveSuggestionProfile(profile)).toBeNull();
        }
    });

    test('unknown / typo / arbitrary strings → null (whitelist is closed)', () => {
        for (const profile of ['Discovery', 'SALES', 'discovery ', ' sales', 'foo', 'sales_v2']) {
            expect(resolveSuggestionProfile(profile)).toBeNull();
        }
    });
});

// ── buildEvidenceBlock — defensive on bad input ──────────────────────────

describe('buildEvidenceBlock — defensive on missing / malformed state', () => {
    test('returns empty string for null / undefined / shapeless state', () => {
        expect(buildEvidenceBlock(null)).toBe('');
        expect(buildEvidenceBlock(undefined)).toBe('');
        expect(buildEvidenceBlock({})).toBe('');
        expect(buildEvidenceBlock({ elements: null })).toBe('');
    });

    test('missing element keys default to empty (no crash)', () => {
        const out = buildEvidenceBlock({ elements: { pain: { status: 'detected', evidence: [{ text: '残業' }] } } });
        expect(out).toContain('# ヒアリング進捗 (5要素 / BANT 実測、背景チェック指標)');
        // The 4 missing keys still render as empty lines (no quote).
        expect(out).toMatch(/- KPI \(Need 規模\): empty/);
        expect(out).toMatch(/- 決裁 \(Authority\): empty/);
        expect(out).toMatch(/- 予算 \(Budget\): empty/);
        expect(out).toMatch(/- 期限 \(Timeline\): empty/);
    });
});

// ── buildSuggestionPrompt — discovery/sales inject ───────────────────────

describe('buildSuggestionPrompt — discovery / sales get the evidence block (Phase 2.A / 2.D)', () => {
    test('discovery: evidence block is prepended, ahead of "直近の対話"', () => {
        const ev = makeEvidence({ pain: { status: 'detected', text: '残業が月50時間で離職が続いている' } });
        const out = buildSuggestionPrompt({ ...BASE_ARGS, profile: 'discovery', evidenceState: ev });
        // Phase 2.D updated the header from "(5要素 / BANT 実測)" to
        // "(5要素 / BANT 実測、背景チェック指標)" to make the reframe visible
        // in the prompt itself — the trailing "背景チェック指標" tells the
        // model this block is a quality indicator, not a directive.
        expect(out.startsWith('# ヒアリング進捗 (5要素 / BANT 実測、背景チェック指標)')).toBe(true);
        expect(out.indexOf('# ヒアリング進捗')).toBeLessThan(out.indexOf('# 商談の直近の対話'));
        expect(out).toContain('# 今回のイベント');
    });

    test('sales: same inject path as discovery', () => {
        const ev = makeEvidence({ pain: { status: 'detected', text: '人手不足' } });
        const out = buildSuggestionPrompt({ ...BASE_ARGS, profile: 'sales', evidenceState: ev });
        expect(out.startsWith('# ヒアリング進捗')).toBe(true);
    });

    test('discovery with all-empty state: block exists but every line is label-only (no quote markers)', () => {
        const ev = makeEvidence();
        const out = buildSuggestionPrompt({ ...BASE_ARGS, profile: 'discovery', evidenceState: ev });
        expect(out).toContain('# ヒアリング進捗');
        // No quote-marker substring before the dialogue section.
        const blockEnd = out.indexOf('# 商談の直近の対話');
        const block = out.slice(0, blockEnd);
        expect(block).not.toContain('直近: "');
    });
});

// ── buildSuggestionPrompt — non-discovery/sales unchanged ─────────────────

describe('buildSuggestionPrompt — non-discovery/sales profiles are byte-unchanged', () => {
    const ev = makeEvidence({ pain: { status: 'detected', text: 'painful' } });
    const baseline = '# 商談の直近の対話\n[相手] 残業が月50時間で\n[自分] そうですか\n\n# 今回のイベント\nself_finished (直近の発話: self)';

    test('interview / meeting / presentation / negotiation / exam: no evidence block', () => {
        for (const profile of ['interview', 'meeting', 'presentation', 'negotiation', 'exam']) {
            const out = buildSuggestionPrompt({ ...BASE_ARGS, profile, evidenceState: ev });
            expect(out).toBe(baseline);
        }
    });

    test('null / undefined profile: no evidence block (production safety)', () => {
        for (const profile of [null, undefined]) {
            const out = buildSuggestionPrompt({ ...BASE_ARGS, profile, evidenceState: ev });
            expect(out).toBe(baseline);
        }
    });

    test('discovery without evidenceState: degrades gracefully (no inject, no crash)', () => {
        const out = buildSuggestionPrompt({ ...BASE_ARGS, profile: 'discovery', evidenceState: undefined });
        expect(out).toBe(baseline);
    });
});

// ── buildSuggestionPrompt — empty/partial prioritized, detected/confirmed marked ─

describe('buildSuggestionPrompt — evidence block content + conversation-first instruction (Phase 2.D refinement of 2.A)', () => {
    test('detected element exposes its last quote so the model can avoid re-asking; instruction is conversation-first', () => {
        const ev = makeEvidence({
            pain: { status: 'detected', text: '人手不足で離職が出ている' },
            kpi: { status: 'partial', text: '件数は感覚値で月10件くらい' },
            authority: { status: 'empty' },
            budget: { status: 'empty' },
            timeline: { status: 'empty' },
        });
        const out = buildSuggestionPrompt({ ...BASE_ARGS, profile: 'discovery', evidenceState: ev });

        // detected quote visible — drives the "重複質問を避ける" decision
        expect(out).toContain('人手不足で離職');
        // partial quote visible — same driver, different status
        expect(out).toContain('件数は感覚値');

        // empty elements: label only, no quote
        expect(out).toMatch(/- 決裁 \(Authority\): empty/);
        expect(out).toMatch(/- 予算 \(Budget\): empty/);
        expect(out).toMatch(/- 期限 \(Timeline\): empty/);

        // Phase 2.D conversation-first instruction (replaces the old
        // Phase 2.A "empty/partial 優先" rule). The block now positions
        // 5要素 / BANT as a *background quality indicator* and instructs
        // surfacing only in the 3 limited Phase-2 timings.
        expect(out).toContain('背景チェック');
        expect(out).toContain('会話の流れを最優先');
        expect(out).toContain('confirmed 要素の重複質問だけ避ける');
        expect(out).not.toContain('filled 要素');
        expect(out).toContain('解決策提示済');

        // The old Phase 2.A directives must NOT appear — they conflicted
        // with the conversation-first reframe (would have re-introduced
        // the over-prioritization of BANT residuals).
        expect(out).not.toContain('empty または partial の要素から選ぶこと');
        expect(out).not.toContain('filled の要素を更に深堀る質問は 2 番目以降');
    });

    test('quote is truncated to 40 chars (prompt-budget guard)', () => {
        const longQuote = 'あ'.repeat(80);
        const ev = makeEvidence({ pain: { status: 'detected', text: longQuote } });
        const out = buildSuggestionPrompt({ ...BASE_ARGS, profile: 'discovery', evidenceState: ev });
        const match = out.match(/- 課題 \(Need 痛み\): detected ・ 直近: "([^"]*)"/);
        expect(match).not.toBeNull();
        expect(match[1].length).toBeLessThanOrEqual(40);
    });

    test('5要素 / BANT vocabulary pairing: each line carries both labels', () => {
        const ev = makeEvidence();
        const out = buildSuggestionPrompt({ ...BASE_ARGS, profile: 'discovery', evidenceState: ev });
        // The pairing is the bridge between AssistantView's 5-element UI and
        // prompts.js's BANT rules. Pin both halves explicitly.
        expect(out).toContain('課題 (Need 痛み)');
        expect(out).toContain('KPI (Need 規模)');
        expect(out).toContain('決裁 (Authority)');
        expect(out).toContain('予算 (Budget)');
        expect(out).toContain('期限 (Timeline)');
    });
});

describe('buildEvidenceBlock — detected candidates vs customer-confirmed elements', () => {
    test('evidence block distinguishes detected from confirmed and asks to verify candidates', () => {
        const block = buildEvidenceBlock({
            elements: {
                pain: { status: 'empty', evidence: [] },
                kpi: { status: 'empty', evidence: [] },
                authority: { status: 'empty', evidence: [] },
                budget: { status: 'detected', evidence: [{ text: '予算は100万円です' }] },
                timeline: { status: 'confirmed', evidence: [{ text: '3月末まで' }] },
            },
        });
        expect(block).toContain('予算 (Budget): detected ・ 直近: "予算は100万円です"');
        expect(block).toContain('期限 (Timeline): confirmed');
        expect(block).toContain('confirmed 要素の重複質問だけ避ける');
        expect(block).toContain('detected は候補');
    });
});

describe('buildEvidenceBlock — retracted rows are history, not the current quote', () => {
    test('latest quote skips retracted rows and the manual retraction marker', () => {
        const block = buildEvidenceBlock({
            elements: {
                budget: {
                    status: 'partial',
                    evidence: [
                        { text: '予算は300万円くらい', retracted: false },
                        { text: '予算は500万円です', retracted: true },
                        { text: '[manual]', source: 'user', polarity: 'retraction', retracted: true },
                    ],
                },
            },
        });
        expect(block).toContain('予算 (Budget): partial ・ 直近: "予算は300万円くらい"');
        expect(block).not.toContain('500万円');
        expect(block).not.toContain('[manual]');
    });

    test('an element whose rows are all retracted carries no quote', () => {
        const block = buildEvidenceBlock({
            elements: { budget: { status: 'partial', evidence: [{ text: '予算は500万円です', retracted: true }] } },
        });
        expect(block).toContain('- 予算 (Budget): partial\n');
        expect(block).not.toContain('500万円');
    });
});
