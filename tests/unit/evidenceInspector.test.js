'use strict';

const {
    formatRelativeTime,
    getElementMeta,
    getSourceMeta,
    getRetractedLabel,
    getRetractedCount,
    getCandidateTag,
    collectKpiValues,
    formatValues,
    getConfirmRefusalKey,
    getConfirmRow,
    getConfirmBlockReason,
    getRetractedReasonLabel,
} = require('../../src/utils/evidenceInspector');

describe('formatRelativeTime', () => {
    test('returns 「たった今」 within 60 seconds', () => {
        const now = 1_000_000;
        expect(formatRelativeTime(now - 5_000, now)).toBe('たった今');
        expect(formatRelativeTime(now - 59_000, now)).toBe('たった今');
    });

    test('returns 「N分前」 from 1min up to 59min', () => {
        const now = 1_000_000;
        expect(formatRelativeTime(now - 60_000, now)).toBe('1分前');
        expect(formatRelativeTime(now - 5 * 60_000, now)).toBe('5分前');
        expect(formatRelativeTime(now - 59 * 60_000, now)).toBe('59分前');
    });

    test('returns HH:mm timestamp at or beyond 60min', () => {
        const ts = new Date(2026, 4, 13, 9, 7).getTime(); // local 09:07
        const now = ts + 60 * 60_000; // exactly 60 min later
        expect(formatRelativeTime(ts, now)).toBe('09:07');
    });

    test('returns empty string for null / undefined / non-number timestamp', () => {
        expect(formatRelativeTime(null, 1_000_000)).toBe('');
        expect(formatRelativeTime(undefined, 1_000_000)).toBe('');
        expect(formatRelativeTime('not-a-number', 1_000_000)).toBe('');
    });

    test('clamps negative diff (future timestamp) to 「たった今」', () => {
        const now = 1_000_000;
        expect(formatRelativeTime(now + 5_000, now)).toBe('たった今');
    });
});

describe('getElementMeta', () => {
    test('returns Japanese label for each of the 5 known keys', () => {
        expect(getElementMeta('pain').label).toBe('課題');
        expect(getElementMeta('kpi').label).toBe('KPI / 業務量');
        expect(getElementMeta('authority').label).toBe('決裁構造');
        expect(getElementMeta('budget').label).toBe('予算感');
        expect(getElementMeta('timeline').label).toBe('期限');
    });

    test('statusLabel maps status string → Japanese', () => {
        const meta = getElementMeta('pain');
        expect(meta.statusLabel('empty')).toBe('未確認');
        expect(meta.statusLabel('partial')).toBe('探り中');
        expect(meta.statusLabel('detected')).toBe('候補あり（未確認）');
        expect(meta.statusLabel('confirmed')).toBe('確認済み');
    });

    test('status labels distinguish detected candidates from user confirmation', () => {
        const meta = getElementMeta('budget');
        expect(meta.statusLabel('detected')).toBe('候補あり（未確認）');
        expect(meta.statusLabel('confirmed')).toBe('確認済み');
        expect(meta.statusLabel('partial')).toBe('探り中');
        expect(meta.statusLabel('filled')).toBe('未確認'); // legacy value falls back
    });

    test('statusLabel knows the v0.7.8 candidate tier', () => {
        expect(getElementMeta('budget').statusLabel('candidate')).toBe('候補（仮・要確認）');
    });

    test('statusLabel falls back to 「未確認」 on unknown status', () => {
        const meta = getElementMeta('pain');
        expect(meta.statusLabel('weird')).toBe('未確認');
        expect(meta.statusLabel(undefined)).toBe('未確認');
    });

    test('returns null for unknown element key', () => {
        expect(getElementMeta('foo')).toBeNull();
        expect(getElementMeta(undefined)).toBeNull();
    });
});

describe('getSourceMeta', () => {
    test('regex → keyword label with 🔍 icon', () => {
        expect(getSourceMeta('regex')).toEqual({ icon: '🔍', label: 'keyword' });
    });

    test('llm → LLM refine label with ✨ icon', () => {
        expect(getSourceMeta('llm')).toEqual({ icon: '✨', label: 'LLM refine' });
    });

    test('source meta knows user actions', () => {
        expect(getSourceMeta('user').label).toBe('手動');
    });

    test('unknown source falls back to neutral marker', () => {
        expect(getSourceMeta('')).toEqual({ icon: '·', label: '' });
        expect(getSourceMeta(undefined)).toEqual({ icon: '·', label: '' });
        expect(getSourceMeta('something')).toEqual({ icon: '·', label: '' });
    });
});

describe('getRetractedLabel', () => {
    const row = fields => ({ retracted: false, superseded: false, polarity: null, specificity: 'concrete', ...fields });

    test('retraction marker with no live rows → 「撤回済み（履歴 N 件）」 counting retracted rows', () => {
        const element = {
            evidence: [row({ retracted: true }), row({ retracted: true }), row({ polarity: 'retraction', specificity: 'keyword' })],
        };
        expect(getRetractedLabel(element)).toBe('撤回済み（履歴 2 件）');
    });

    test('manual retraction (marker itself retracted) counts every retracted row', () => {
        const element = { evidence: [row({ retracted: true }), row({ polarity: 'retraction', specificity: 'keyword', retracted: true })] };
        expect(getRetractedLabel(element)).toBe('撤回済み（履歴 2 件）');
    });

    test('null when a live row remains after the retraction', () => {
        const element = { evidence: [row({ retracted: true }), row({ polarity: 'retraction', specificity: 'keyword' }), row({})] };
        expect(getRetractedLabel(element)).toBeNull();
    });

    test('null without a retraction marker, and for empty / malformed input', () => {
        expect(getRetractedLabel({ evidence: [row({ retracted: true })] })).toBeNull();
        expect(getRetractedLabel({ evidence: [] })).toBeNull();
        expect(getRetractedLabel(null)).toBeNull();
        expect(getRetractedLabel({})).toBeNull();
    });

    test('matches the store: an explicitly retracted budget gets the label', () => {
        const { createDiscoveryEvidence } = require('../../src/utils/discoveryEvidence');
        const store = createDiscoveryEvidence();
        store.processNewTurn({ speaker: 'opponent', text: '予算は500万円です' });
        const { state } = store.processNewTurn({ speaker: 'opponent', text: '先ほどの予算は撤回します' });
        expect(state.elements.budget.status).toBe('empty');
        expect(getRetractedLabel(state.elements.budget)).toBe('撤回済み（履歴 1 件）');
    });
});

describe('getCandidateTag', () => {
    test('getCandidateTag distinguishes conflict / unknown basis / selected / wish / tentative', () => {
        const base = { status: 'candidate', confirmed: false, conflict: null, evidence: [] };
        expect(getCandidateTag({ ...base, conflict: { basis: 'comparable', values: [{}, {}], keptRowId: null } })).toMatchObject({
            kind: 'conflict',
        });
        expect(getCandidateTag({ ...base, conflict: { basis: 'unknown', values: [{}, {}], keptRowId: null } })).toMatchObject({
            kind: 'conflict_unknown',
        });
        expect(getCandidateTag({ ...base, conflict: { basis: 'comparable', values: [{}, {}], keptRowId: 2 } })).toMatchObject({ kind: 'selected' });
        expect(
            getCandidateTag({
                ...base,
                evidence: [
                    {
                        qualifier: 'tentative',
                        text: '希望としては11月中に',
                        retracted: false,
                        superseded: false,
                        polarity: null,
                        specificity: 'concrete',
                    },
                ],
            })
        ).toMatchObject({ kind: 'wish' });
        expect(
            getCandidateTag({
                ...base,
                evidence: [
                    { qualifier: 'tentative', text: '申請する案', retracted: false, superseded: false, polarity: null, specificity: 'concrete' },
                ],
            })
        ).toMatchObject({ kind: 'tentative' });
    });

    test('carries the i18n key and the conflict size', () => {
        const base = { status: 'candidate', confirmed: false, conflict: null, evidence: [] };
        expect(getCandidateTag({ ...base, conflict: { basis: 'comparable', values: [{}, {}, {}], keptRowId: null } })).toEqual({
            kind: 'conflict',
            i18nKey: 'assistant.evidence.tag.conflict',
            n: 3,
        });
        expect(getCandidateTag({ ...base, conflict: { basis: 'unknown', values: [{}, {}], keptRowId: 5 } })).toMatchObject({
            kind: 'selected',
            i18nKey: 'assistant.evidence.tag.selected',
        });
    });

    test('a retracted wish row does not make the tag 希望; null for malformed input', () => {
        const el = {
            conflict: null,
            evidence: [
                { qualifier: 'tentative', text: '希望としては11月中に', retracted: true, superseded: false, polarity: null },
                { qualifier: 'tentative', text: '仮で12月', retracted: false, superseded: false, polarity: null },
            ],
        };
        expect(getCandidateTag(el)).toMatchObject({ kind: 'tentative', i18nKey: 'assistant.evidence.tag.tentative' });
        expect(getCandidateTag(null)).toBeNull();
    });
});

describe('formatValues', () => {
    test('formatValues renders KPI current / target / period separately', () => {
        expect(formatValues('kpi', { percent: 12, role: 'target', period: '導入後3か月間', current: 8 })).toBe(
            '目標 12％以上（現状 8％、評価 導入後3か月間）'
        );
    });

    test('KPI with only a current value says the target is undecided', () => {
        expect(formatValues('kpi', { current: 8, target: null, period: null })).toBe('現状 8％（目標 未定）');
    });

    test('KPI keeps the direction said in the sentence and counts with their unit', () => {
        expect(formatValues('kpi', { raw: '処理時間を5時間以下にしたい', count: { n: 5, unit: '時間' }, role: 'target' })).toBe('目標 5時間以下');
    });

    test('budget shows the amount with its period, falling back to raw', () => {
        expect(
            formatValues('budget', {
                raw: '予算は年間100万円です',
                amountText: '100万円',
                amount: { yen: 1e6, period: 'annual', scope: null },
                taxNote: null,
            })
        ).toBe('年間100万円');
        expect(
            formatValues('budget', {
                raw: '月額10万円で税抜です',
                amountText: '10万円',
                amount: { yen: 1e5, period: 'monthly', scope: 'recurring' },
                taxNote: '税抜',
            })
        ).toBe('月額10万円（税抜）');
        expect(formatValues('budget', { raw: '予算はこれからです' })).toBe('予算はこれからです');
    });

    test('budget with several amounts in one sentence shows them all joined with 「 / 」', () => {
        const { extractValues } = require('../../src/utils/discoveryEvidence');
        expect(formatValues('budget', extractValues('budget', '初期費用50万円、月額5万円です'))).toBe('初期費用50万円 / 月額5万円');
        expect(formatValues('budget', extractValues('budget', '予算は100万円か50万円です'))).toBe('100万円 / 50万円');
        expect(formatValues('budget', extractValues('budget', '初期費用50万円、月額5万円、いずれも税抜です'))).toBe(
            '初期費用50万円 / 月額5万円（税抜）'
        );
        expect(formatValues('budget', extractValues('budget', '年間100万円です'))).toBe('年間100万円');
    });

    test('other elements show raw; empty / malformed input gives an empty string', () => {
        expect(formatValues('timeline', { raw: '来年4月に稼働したい', date: '来年4月' })).toBe('来年4月に稼働したい');
        expect(formatValues('kpi', null)).toBe('');
        expect(formatValues('budget', undefined)).toBe('');
    });
});

describe('collectKpiValues', () => {
    const row = fields => ({ retracted: false, superseded: false, polarity: null, specificity: 'concrete', qualifier: null, ...fields });

    test('newest live target row gives target / period, newest live current row gives current', () => {
        const el = {
            evidence: [
                row({ id: 1, qualifier: 'current', values: { raw: '現状は5%', percent: 5, role: 'current' } }),
                row({ id: 2, values: { raw: '目標は10%以上', percent: 10, role: 'target' } }),
                row({ id: 3, qualifier: 'current', values: { raw: '今の解約率は8%', percent: 8, role: 'current' } }),
                row({ id: 4, values: { raw: '導入後3か月間で12%以上にしたい', percent: 12, role: 'target', period: '導入後3か月間' } }),
                row({ id: 5, retracted: true, values: { raw: '目標は20%以上', percent: 20, role: 'target' } }),
            ],
        };
        const v = collectKpiValues(el);
        expect(v).toMatchObject({ current: 8, target: 12, period: '導入後3か月間' });
        expect(formatValues('kpi', v)).toBe('目標 12％以上（現状 8％、評価 導入後3か月間）');
    });

    test('null when there is neither a target nor a current row', () => {
        expect(collectKpiValues({ evidence: [row({ values: { raw: 'KPIはまだ', role: null } })] })).toBeNull();
        expect(collectKpiValues(null)).toBeNull();
    });

    test('works on a KPI element produced by the store', () => {
        const { createDiscoveryEvidence } = require('../../src/utils/discoveryEvidence');
        const store = createDiscoveryEvidence();
        store.processNewTurn({ speaker: 'opponent', text: '現状の解約率は8%です' });
        const { state } = store.processNewTurn({ speaker: 'opponent', text: '導入後3か月間で解約率を12%以上改善する目標です' });
        const v = collectKpiValues(state.elements.kpi);
        expect(v).not.toBeNull();
        expect(v.current).toBe(8);
        expect(v.target).toBe(12);
    });
});

describe('getConfirmRefusalKey / getConfirmRow / getRetractedCount', () => {
    test('maps a refusal reason to its i18n key, unknown reasons to no_candidate', () => {
        expect(getConfirmRefusalKey('conflict_unresolved')).toBe('assistant.evidence.refusal.conflict_unresolved');
        expect(getConfirmRefusalKey('basis_unknown')).toBe('assistant.evidence.refusal.basis_unknown');
        expect(getConfirmRefusalKey('no_candidate')).toBe('assistant.evidence.refusal.no_candidate');
        expect(getConfirmRefusalKey('something_else')).toBe('assistant.evidence.refusal.no_candidate');
        expect(getConfirmRefusalKey(undefined)).toBe('assistant.evidence.refusal.no_candidate');
    });

    test('getConfirmRow picks the row the store would record on ✓', () => {
        const { createDiscoveryEvidence } = require('../../src/utils/discoveryEvidence');
        const store = createDiscoveryEvidence();
        store.processNewTurn({ speaker: 'opponent', text: '予算は年間100万円です' });
        let state = store.processNewTurn({ speaker: 'opponent', text: '予算は年間150万円です' }).state;
        const budget = state.elements.budget;
        expect(budget.conflict).not.toBeNull();
        expect(getConfirmRow(budget)).toBeNull(); // unresolved conflict: ✓ is refused
        const keep = budget.conflict.values[1].rowId;
        state = store.selectEvidence('budget', keep).state;
        expect(getConfirmRow(state.elements.budget).id).toBe(keep);
        const confirmed = store.confirmElement('budget').state.elements.budget;
        expect(confirmed.confirmation.rowIds).toEqual([keep]);
    });

    test('getRetractedCount mirrors getRetractedLabel', () => {
        const row = fields => ({ retracted: false, superseded: false, polarity: null, ...fields });
        expect(getRetractedCount({ evidence: [row({ retracted: true }), row({ polarity: 'retraction' })] })).toBe(1);
        expect(getRetractedCount({ evidence: [row({})] })).toBeNull();
    });
});

describe('getRetractedReasonLabel', () => {
    test('maps retractedBy to 訂正 / 撤回 / 手動取消; null for live rows and unknown reasons', () => {
        expect(getRetractedReasonLabel({ retracted: true, retractedBy: 'correction' })).toBe('訂正');
        expect(getRetractedReasonLabel({ retracted: true, retractedBy: 'retraction' })).toBe('撤回');
        expect(getRetractedReasonLabel({ retracted: true, retractedBy: 'manual' })).toBe('手動取消');
        expect(getRetractedReasonLabel({ retracted: true, retractedBy: null })).toBeNull();
        expect(getRetractedReasonLabel({ retracted: true, retractedBy: 'something' })).toBeNull();
        expect(getRetractedReasonLabel({ retracted: false, retractedBy: 'correction' })).toBeNull();
        expect(getRetractedReasonLabel(null)).toBeNull();
    });

    test('labels the rows the store retracts by correction, explicit retraction and manual ✕', () => {
        const { createDiscoveryEvidence } = require('../../src/utils/discoveryEvidence');
        const opp = text => ({ speaker: 'opponent', text });
        const store = createDiscoveryEvidence();
        store.processNewTurn(opp('予算は300万円です。'));
        store.processNewTurn(opp('300万円ではなく30万円です。'));
        let rows = store.getState().elements.budget.evidence;
        expect(rows.map(getRetractedReasonLabel)).toEqual(['訂正', null]);
        store.processNewTurn(opp('先ほどの予算は撤回します。'));
        rows = store.getState().elements.budget.evidence;
        expect(rows.slice(0, 2).map(getRetractedReasonLabel)).toEqual(['訂正', '撤回']);
        store.processNewTurn(opp('期限は来月末です。'));
        rows = store.retractElement('timeline', 'manual').state.elements.timeline.evidence;
        expect(getRetractedReasonLabel(rows[0])).toBe('手動取消');
    });
});

describe('getConfirmBlockReason', () => {
    test('mirrors confirmElement: unknown basis first, then no kept value, then a kept row with two conflicting amounts', () => {
        const { createDiscoveryEvidence } = require('../../src/utils/discoveryEvidence');
        const opp = text => ({ speaker: 'opponent', text });
        let store = createDiscoveryEvidence();
        store.processNewTurn(opp('予算は100万円です。'));
        let el = store.processNewTurn(opp('資料には50万円とあります。')).state.elements.budget;
        expect(getConfirmBlockReason(el)).toBe('basis_unknown');
        expect(store.confirmElement('budget').reason).toBe('basis_unknown');

        store = createDiscoveryEvidence();
        store.processNewTurn(opp('予算は100万円か50万円です。'));
        el = store.processNewTurn(opp('どちらも年額です。')).state.elements.budget;
        expect(getConfirmBlockReason(el)).toBe('conflict_unresolved');
        el = store.selectEvidence('budget', el.evidence[0].id).state.elements.budget;
        expect(getConfirmBlockReason(el)).toBe('conflict_unresolved');
        expect(getConfirmRow(el)).toBeNull();
        expect(store.confirmElement('budget').reason).toBe('conflict_unresolved');
        expect(getConfirmBlockReason({ conflict: null })).toBeNull();
    });
});

describe('getRetractedReasonLabel: ambiguous retraction marker', () => {
    const { getRetractedReasonLabel } = require('../../src/utils/evidenceInspector');
    test('an ambiguous (unapplied) retraction marker is labelled as such', () => {
        expect(getRetractedReasonLabel({ retracted: true, polarity: 'retraction', retractionTarget: 'ambiguous', retractedBy: null })).toBe(
            '撤回（対象不明・未適用）'
        );
    });
});
