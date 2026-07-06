'use strict';

const { createWhisperProgressTracker, formatMB } = require('../../src/utils/whisperProgress');

describe('createWhisperProgressTracker', () => {
    test('starts at 0% with no files', () => {
        const t = createWhisperProgressTracker();
        expect(t.snapshot()).toMatchObject({ percent: 0, loadedBytes: 0, totalBytes: 0, fileCount: 0 });
    });

    test('reflects a single file download progress', () => {
        const t = createWhisperProgressTracker();
        t.update({ status: 'progress', file: 'model.onnx', loaded: 25, total: 100 });
        const snap = t.snapshot();
        expect(snap.percent).toBe(25);
        expect(snap.fileCount).toBe(1);
    });

    test('aggregates across multiple files', () => {
        const t = createWhisperProgressTracker();
        t.update({ status: 'progress', file: 'a', loaded: 50, total: 100 });
        t.update({ status: 'progress', file: 'b', loaded: 0, total: 100 });
        // 50 / 200 = 25%
        expect(t.snapshot().percent).toBe(25);
        t.update({ status: 'progress', file: 'b', loaded: 100, total: 100 });
        // 150 / 200 = 75%
        expect(t.snapshot().percent).toBe(75);
    });

    test('a done event marks that file complete', () => {
        const t = createWhisperProgressTracker();
        t.update({ status: 'progress', file: 'a', loaded: 10, total: 100 });
        t.update({ status: 'done', file: 'a', total: 100 });
        expect(t.snapshot().percent).toBe(100);
    });

    test('ignores malformed / totalless events without crashing', () => {
        const t = createWhisperProgressTracker();
        expect(() => {
            t.update(null);
            t.update(undefined);
            t.update({});
            t.update({ status: 'initiate', file: 'a' });
            t.update({ status: 'progress', file: 'a', loaded: 5 }); // no total
        }).not.toThrow();
        expect(t.snapshot().percent).toBe(0);
    });

    test('does not regress on out-of-order events', () => {
        const t = createWhisperProgressTracker();
        t.update({ status: 'progress', file: 'a', loaded: 90, total: 100 });
        t.update({ status: 'progress', file: 'a', loaded: 40, total: 100 }); // stale
        expect(t.snapshot().percent).toBe(90);
    });

    test('clamps loaded to total', () => {
        const t = createWhisperProgressTracker();
        t.update({ status: 'progress', file: 'a', loaded: 150, total: 100 });
        expect(t.snapshot().percent).toBe(100);
    });

    test('reset clears all files', () => {
        const t = createWhisperProgressTracker();
        t.update({ status: 'progress', file: 'a', loaded: 50, total: 100 });
        t.reset();
        expect(t.snapshot()).toMatchObject({ percent: 0, fileCount: 0 });
    });

    test('formatMB converts bytes to one-decimal megabytes', () => {
        expect(formatMB(1024 * 1024)).toBe(1);
        expect(formatMB(1.5 * 1024 * 1024)).toBe(1.5);
        expect(formatMB(0)).toBe(0);
        expect(formatMB(-5)).toBe(0);
        expect(formatMB(NaN)).toBe(0);
    });
});
