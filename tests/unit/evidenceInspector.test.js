'use strict';

const { formatRelativeTime, getElementMeta, getSourceMeta } = require('../../src/utils/evidenceInspector');

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
        expect(meta.statusLabel('filled')).toBe('確認済');
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

    test('unknown source falls back to neutral marker', () => {
        expect(getSourceMeta('')).toEqual({ icon: '·', label: '' });
        expect(getSourceMeta(undefined)).toEqual({ icon: '·', label: '' });
        expect(getSourceMeta('something')).toEqual({ icon: '·', label: '' });
    });
});
