'use strict';

const { computeDiscoveryPhase, getPhaseMeta, RECENT_SEGMENTS_WINDOW } = require('../../src/utils/discoveryPhase');

describe('computeDiscoveryPhase', () => {
    test('empty segments → digging (default phase)', () => {
        expect(computeDiscoveryPhase({ segments: [] })).toBe('digging');
    });

    test('opponent mentions 予算 → bant_unlocked', () => {
        const segments = [{ speakerId: 1, text: '予算は来期で500万くらいを想定しています' }];
        expect(computeDiscoveryPhase({ segments })).toBe('bant_unlocked');
    });

    test('opponent mentions 決裁 → bant_unlocked', () => {
        const segments = [{ speakerId: 1, text: '決裁プロセスについてですが' }];
        expect(computeDiscoveryPhase({ segments })).toBe('bant_unlocked');
    });

    test('opponent mentions コスト → bant_unlocked', () => {
        const segments = [{ speakerId: 1, text: 'コスト面が気になっていて' }];
        expect(computeDiscoveryPhase({ segments })).toBe('bant_unlocked');
    });

    test('self pitches solution (ご紹介 keyword in self segment) → bant_unlocked', () => {
        const segments = [{ speakerId: 2, text: '弊社の事例をご紹介しますと、A 社では月100時間の削減を実現しました' }];
        expect(computeDiscoveryPhase({ segments })).toBe('bant_unlocked');
    });

    test('self pitches solution (機能 + 事例 keywords) → bant_unlocked', () => {
        const segments = [{ speakerId: 2, text: 'こちらの機能は事例でも実証されていまして、A 社では工数を半減できました' }];
        expect(computeDiscoveryPhase({ segments })).toBe('bant_unlocked');
    });

    test('opponent mentions 持ち帰り → closing (closing beats bant_unlocked)', () => {
        const segments = [{ speakerId: 1, text: '予算については持ち帰って確認します' }];
        expect(computeDiscoveryPhase({ segments })).toBe('closing');
    });

    test('opponent mentions 次回 → closing', () => {
        const segments = [{ speakerId: 1, text: '次回の打ち合わせで詳細を' }];
        expect(computeDiscoveryPhase({ segments })).toBe('closing');
    });

    test('self mentions ご提案 → closing', () => {
        const segments = [{ speakerId: 2, text: '正式にご提案させていただきます' }];
        expect(computeDiscoveryPhase({ segments })).toBe('closing');
    });

    test('only opponent pain mention without BANT / closing → digging', () => {
        const segments = [
            { speakerId: 1, text: '人手不足で困っています' },
            { speakerId: 1, text: '残業が多くて' },
        ];
        expect(computeDiscoveryPhase({ segments })).toBe('digging');
    });

    test('self ack / filler does NOT count as pitch → digging', () => {
        const segments = [
            { speakerId: 2, text: 'はい' },
            { speakerId: 2, text: 'なるほど' },
            { speakerId: 1, text: '人手不足で' },
        ];
        expect(computeDiscoveryPhase({ segments })).toBe('digging');
    });

    test('non-input segment types (output / system) are ignored', () => {
        const segments = [
            { type: 'output', text: '予算は500万円' },
            { speakerId: 1, text: '人手不足で困っています', type: 'input' },
        ];
        expect(computeDiscoveryPhase({ segments })).toBe('digging');
    });

    test('only the last RECENT_SEGMENTS_WINDOW segments are scanned', () => {
        const oldBant = Array.from({ length: 30 }, () => ({
            speakerId: 1,
            text: '予算の話',
        }));
        const recentNeutral = Array.from({ length: 20 }, () => ({
            speakerId: 1,
            text: '人手不足で',
        }));
        const segments = [...oldBant, ...recentNeutral];
        // Default window is RECENT_SEGMENTS_WINDOW; old BANT mentions outside the window should be ignored
        expect(computeDiscoveryPhase({ segments })).toBe('digging');
        // Sanity: shrink to within-window if needed; assertion above relies on default
        expect(RECENT_SEGMENTS_WINDOW).toBeGreaterThanOrEqual(5);
    });

    test('closing keyword on most recent segment wins even if earlier BANT', () => {
        const segments = [
            { speakerId: 1, text: '予算は来期で' },
            { speakerId: 1, text: '次回の打ち合わせで' },
        ];
        expect(computeDiscoveryPhase({ segments })).toBe('closing');
    });

    test('missing / null segments argument → digging (defensive default)', () => {
        expect(computeDiscoveryPhase({})).toBe('digging');
        expect(computeDiscoveryPhase({ segments: null })).toBe('digging');
        expect(computeDiscoveryPhase()).toBe('digging');
    });
});

describe('getPhaseMeta', () => {
    test('digging meta', () => {
        const meta = getPhaseMeta('digging');
        expect(meta.label).toBe('探り中');
        expect(meta.title).toMatch(/痛み/);
        expect(meta.tone).toBe('neutral');
    });

    test('bant_unlocked meta', () => {
        const meta = getPhaseMeta('bant_unlocked');
        expect(meta.label).toBe('BANT 解禁');
        expect(meta.tone).toBe('accent');
    });

    test('closing meta', () => {
        const meta = getPhaseMeta('closing');
        expect(meta.label).toBe('クロージング');
        expect(meta.tone).toBe('success');
    });

    test('unknown phase falls back to digging meta', () => {
        expect(getPhaseMeta('foo')).toEqual(getPhaseMeta('digging'));
        expect(getPhaseMeta(undefined)).toEqual(getPhaseMeta('digging'));
    });
});
