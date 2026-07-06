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

const STATUS_LABELS = {
    empty: '未確認',
    partial: '探り中',
    filled: '確認済',
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
    return { icon: '·', label: '' };
}

const _evidenceInspectorApi = { formatRelativeTime, getElementMeta, getSourceMeta };

if (typeof module !== 'undefined' && module.exports) {
    module.exports = _evidenceInspectorApi;
}
if (typeof window !== 'undefined') {
    window.evidenceInspector = _evidenceInspectorApi;
}
