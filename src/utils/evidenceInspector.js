// evidenceInspector.js — Phase 3.A pure helpers for the badge expand panel.
//
// Loaded two ways:
//   - Jest tests: `require('.../evidenceInspector')` → module.exports
//   - Renderer  : `<script src="utils/evidenceInspector.js"></script>`
//                 sets window.evidenceInspector for the Lit component
//
// No DOM / no Node / no Electron deps — pure functions only.
//
// NOTE: keep top-level identifiers (`const`, `let`, `class`) file-unique —
// sibling plain-script files in src/index.html share the global lexical
// environment, so a duplicate `const _evidenceInspectorApi` between sibling scripts breaks
// the second file at parse time with a SyntaxError. See
// tests/unit/plainScriptScope.test.js for the regression guard.

'use strict';

function formatRelativeTime(timestampMs, nowMs) {
    if (typeof timestampMs !== 'number' || Number.isNaN(timestampMs)) return '';
    const diff = Math.max(0, nowMs - timestampMs);
    if (diff < 60_000) return 'たった今';
    if (diff < 60 * 60_000) return `${Math.floor(diff / 60_000)}分前`;
    const d = new Date(timestampMs);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
}

const ELEMENT_LABELS = {
    pain: '課題',
    kpi: 'KPI / 業務量',
    authority: '決裁構造',
    budget: '予算感',
    timeline: '期限',
};

// v0.7.8 5-tier status. `detected` = a positive statement in the
// conversation (the validation team's "confirmed"); `confirmed` = the
// user's manual ✓ only. `candidate` = a tentative or conflicting value.
const STATUS_LABELS = {
    empty: '未確認',
    partial: '探り中',
    candidate: '候補（仮・要確認）',
    detected: '候補あり（未確認）',
    confirmed: '確認済み',
};

function getElementMeta(key) {
    const label = ELEMENT_LABELS[key];
    if (!label) return null;
    return {
        label,
        statusLabel: status => STATUS_LABELS[status] || STATUS_LABELS.empty,
    };
}

function getSourceMeta(source) {
    if (source === 'regex') return { icon: '🔍', label: 'keyword' };
    if (source === 'llm') return { icon: '✨', label: 'LLM refine' };
    if (source === 'user') return { icon: '👤', label: '手動' };
    return { icon: '·', label: '' };
}

// Mirrors discoveryEvidence.isLiveRow (this file cannot require it — it is
// also loaded as a plain renderer script).
function _inspectorRowIsLive(e) {
    return !e.retracted && !e.superseded && e.polarity !== 'retraction';
}

// An element that was explicitly retracted and has nothing live left shows
// 「撤回済み（履歴 N 件）」 (N = retracted rows) instead of a bare 未確認.
// null otherwise.
function getRetractedLabel(element) {
    const n = getRetractedCount(element);
    return n == null ? null : `撤回済み（履歴 ${n} 件）`;
}

// The N of getRetractedLabel (so the view can render the localized
// `assistant.evidence.retracted_label`), or null when the label does not apply.
function getRetractedCount(element) {
    const evidence = _inspectorEvidence(element);
    if (!evidence.some(e => e && e.polarity === 'retraction')) return null;
    if (evidence.some(e => e && _inspectorRowIsLive(e))) return null;
    return evidence.filter(e => e && e.retracted).length;
}

// Why a history row was withdrawn (row.retractedBy, v0.7.8 spec decision
// 2), shown next to the 取消済 tag. Inspector-side labels like
// STATUS_LABELS. null for a live row or when no reason was recorded.
const _INSPECTOR_RETRACTED_REASON_LABELS = {
    correction: '訂正',
    retraction: '撤回',
    manual: '手動取消',
};

function getRetractedReasonLabel(row) {
    if (!row || typeof row !== 'object' || !row.retracted) return null;
    // A retraction whose target amount matched more than one live row is
    // recorded as a marker without retracting anything (決定 3).
    if (row.retractionTarget === 'ambiguous') return '撤回（対象不明・未適用）';
    return _INSPECTOR_RETRACTED_REASON_LABELS[row.retractedBy] || null;
}

function _inspectorEvidence(element) {
    return element && Array.isArray(element.evidence) ? element.evidence : [];
}

function _inspectorNewest(rows) {
    return rows.length > 0 ? rows[rows.length - 1] : null;
}

// ── v0.7.8 candidate tier ──

// 「希望としては」「〜したい」: a tentative value that is the customer's wish.
const _INSPECTOR_WISH_RE = /希望|したい/;

// The sticky tag on a `candidate` badge / panel head:
//   selected         — a conflict where the user kept one value (still 要確認)
//   conflict_unknown — values differ but period / cost scope is unknown
//   conflict         — comparable values differ (n = number of values)
//   wish / tentative — a tentative-only candidate
// Returns { kind, i18nKey, n? } or null.
function getCandidateTag(element) {
    if (!element || typeof element !== 'object') return null;
    const conflict = element.conflict;
    if (conflict) {
        if (conflict.keptRowId != null) return { kind: 'selected', i18nKey: 'assistant.evidence.tag.selected' };
        if (conflict.basis === 'unknown') return { kind: 'conflict_unknown', i18nKey: 'assistant.evidence.tag.conflict_unknown' };
        const n = Array.isArray(conflict.values) ? conflict.values.length : 0;
        return { kind: 'conflict', i18nKey: 'assistant.evidence.tag.conflict', n };
    }
    const tentative = _inspectorEvidence(element).filter(e => e && _inspectorRowIsLive(e) && e.qualifier === 'tentative');
    if (tentative.some(e => typeof e.text === 'string' && _INSPECTOR_WISH_RE.test(e.text))) {
        return { kind: 'wish', i18nKey: 'assistant.evidence.tag.wish' };
    }
    return { kind: 'tentative', i18nKey: 'assistant.evidence.tag.tentative' };
}

// KPI current / target / period from the element's live rows: the newest
// live `role: 'target'` row gives target (+ period, direction), the newest
// live `role: 'current'` row gives current. A measure is a percent (number)
// or a count ({ n, unit }). null when neither row exists.
function collectKpiValues(element) {
    const live = _inspectorEvidence(element).filter(e => e && _inspectorRowIsLive(e) && e.values);
    const target = _inspectorNewest(live.filter(e => e.values.role === 'target'));
    const current = _inspectorNewest(live.filter(e => e.values.role === 'current'));
    if (!target && !current) return null;
    const tv = target ? target.values : null;
    const cv = current ? current.values : null;
    return {
        target: tv ? _inspectorKpiMeasure(tv) : null,
        current: cv ? _inspectorKpiMeasure(cv) : null,
        period: (tv && tv.period) || null,
        direction: tv ? _inspectorKpiDirection(tv.raw) : undefined,
    };
}

function _inspectorKpiMeasure(v) {
    if (typeof v.percent === 'number') return v.percent;
    if (v.count && typeof v.count === 'object') return { n: v.count.n, unit: v.count.unit };
    return null;
}

// 「以上」/「以下」 as said in the target sentence; '' when it says neither.
// undefined when there is no sentence to read it from.
function _inspectorKpiDirection(raw) {
    if (typeof raw !== 'string') return undefined;
    if (/以下|未満/.test(raw)) return '以下';
    if (/以上/.test(raw)) return '以上';
    return '';
}

function _inspectorMeasureText(m) {
    if (typeof m === 'number') return `${m}％`;
    if (m && typeof m === 'object' && m.n != null) return `${m.n}${m.unit || ''}`;
    return '';
}

const _INSPECTOR_PERIOD_PREFIX = { annual: '年間', monthly: '月額', one_time: '初期費用' };

// One display line for an element's parsed values.
//   kpi    — 「目標 12％以上（現状 8％、評価 導入後3か月間）」 /
//            「現状 8％（目標 未定）」. Accepts collectKpiValues() output
//            ({ target, current, period, direction }) or a single row's
//            values ({ percent?, count?, role, period?, raw }) with an
//            optional `current` merged in.
//   budget — the amount with its period (「年間100万円」), every amount
//            joined with 「 / 」 when the sentence states several
//            (「初期費用50万円 / 月額5万円」), tax note in parentheses; raw
//            when no amount was parsed.
//   other  — raw.
// Display only: the original wording is never rewritten into an absolute
// date or amount.
function formatValues(key, values) {
    if (!values || typeof values !== 'object') return '';
    const raw = typeof values.raw === 'string' ? values.raw : '';
    if (key === 'kpi') {
        const role = values.role;
        const ownMeasure = typeof values.percent === 'number' ? values.percent : values.count || null;
        const target = values.target !== undefined ? values.target : role === 'target' ? ownMeasure : null;
        const current = values.current !== undefined ? values.current : role === 'current' ? ownMeasure : null;
        const targetText = _inspectorMeasureText(target);
        const currentText = _inspectorMeasureText(current);
        if (targetText) {
            let direction = values.direction;
            if (direction === undefined) direction = _inspectorKpiDirection(values.raw);
            if (direction === undefined) direction = '以上';
            const notes = [];
            if (currentText) notes.push(`現状 ${currentText}`);
            if (values.period) notes.push(`評価 ${values.period}`);
            return `目標 ${targetText}${direction}${notes.length ? `（${notes.join('、')}）` : ''}`;
        }
        if (currentText) return `現状 ${currentText}（目標 未定）`;
        return raw;
    }
    if (key === 'budget') {
        if (!values.amountText) return raw;
        const entries =
            Array.isArray(values.amounts) && values.amounts.length > 1
                ? values.amounts
                : [{ text: values.amountText, period: values.amount && values.amount.period }];
        const text = entries
            .filter(a => a && typeof a.text === 'string' && a.text)
            .map(a => {
                const prefix = _INSPECTOR_PERIOD_PREFIX[a.period] || '';
                return a.text.startsWith(prefix) ? a.text : `${prefix}${a.text}`;
            })
            .join(' / ');
        return values.taxNote ? `${text}（${values.taxNote}）` : text;
    }
    return raw;
}

// i18n key of the text shown when ✓ is refused. Reasons the panel has no
// dedicated text for read as 「まだ確認できる候補がありません」.
const _INSPECTOR_REFUSAL_REASONS = ['conflict_unresolved', 'basis_unknown', 'no_candidate'];
function getConfirmRefusalKey(reason) {
    const known = _INSPECTOR_REFUSAL_REASONS.includes(reason) ? reason : 'no_candidate';
    return `assistant.evidence.refusal.${known}`;
}

// The row ✓ would record — mirrors discoveryEvidence.confirmElement so the
// confirmation step can show the value before the user commits. null when
// ✓ would be refused (unresolved conflict, unknown basis, nothing to confirm)
// or the element is already confirmed.
function getConfirmRow(element) {
    if (!element || typeof element !== 'object' || element.confirmed) return null;
    const neutralConcrete = _inspectorEvidence(element).filter(e => e && _inspectorRowIsLive(e) && e.specificity === 'concrete' && !e.polarity);
    const conflict = element.conflict;
    if (conflict) {
        if (getConfirmBlockReason(element)) return null;
        return neutralConcrete.find(e => e.id === conflict.keptRowId) || null;
    }
    const unqualified = _inspectorNewest(neutralConcrete.filter(e => !e.qualifier));
    if (unqualified) return unqualified;
    return _inspectorNewest(neutralConcrete.filter(e => e.qualifier === 'tentative'));
}

// The reason ✓ would be refused right now, for the disabled button's
// tooltip; null when ✓ is not blocked by a conflict. Mirrors
// discoveryEvidence.confirmElement: an unknown basis first, then no kept
// value, then a kept row that itself states two conflicting amounts.
function getConfirmBlockReason(element) {
    const conflict = element && element.conflict;
    if (!conflict) return null;
    if (conflict.basis !== 'comparable') return 'basis_unknown';
    if (conflict.keptRowId == null) return 'conflict_unresolved';
    const values = Array.isArray(conflict.values) ? conflict.values : [];
    if (values.filter(v => v && v.rowId === conflict.keptRowId).length > 1) return 'conflict_unresolved';
    return null;
}

const _evidenceInspectorApi = {
    formatRelativeTime,
    getElementMeta,
    getSourceMeta,
    getRetractedLabel,
    getRetractedCount,
    getRetractedReasonLabel,
    getCandidateTag,
    collectKpiValues,
    formatValues,
    getConfirmRefusalKey,
    getConfirmRow,
    getConfirmBlockReason,
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = _evidenceInspectorApi;
}
if (typeof window !== 'undefined') {
    window.evidenceInspector = _evidenceInspectorApi;
}
