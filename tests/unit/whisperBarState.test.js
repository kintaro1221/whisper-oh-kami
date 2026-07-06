'use strict';

const { whisperBarState } = require('../../src/utils/whisperBarState');

describe('whisperBarState', () => {
    test('null progress → indeterminate', () => {
        expect(whisperBarState(null)).toEqual({ indeterminate: true, percent: 0 });
    });

    test('totalBytes 0（DL開始直後の空snapshot）→ indeterminate', () => {
        expect(whisperBarState({ totalBytes: 0, percent: 0 })).toEqual({ indeterminate: true, percent: 0 });
    });

    test('totalBytes 既知だが percent 0 → determinate at 0', () => {
        expect(whisperBarState({ totalBytes: 26214400, percent: 0 })).toEqual({ indeterminate: false, percent: 0 });
    });

    test('正常な進捗 → determinate', () => {
        expect(whisperBarState({ totalBytes: 26214400, percent: 45 })).toEqual({ indeterminate: false, percent: 45 });
    });

    test('過大な percent は 100 にクランプ', () => {
        expect(whisperBarState({ totalBytes: 26214400, percent: 130 })).toEqual({ indeterminate: false, percent: 100 });
    });

    test('100% → determinate 100', () => {
        expect(whisperBarState({ totalBytes: 26214400, percent: 100 })).toEqual({ indeterminate: false, percent: 100 });
    });

    test('非有限 percent は 0 にフォールバック', () => {
        expect(whisperBarState({ totalBytes: 26214400, percent: NaN })).toEqual({ indeterminate: false, percent: 0 });
    });

    test('負の percent は 0 にクランプ', () => {
        expect(whisperBarState({ totalBytes: 26214400, percent: -5 })).toEqual({ indeterminate: false, percent: 0 });
    });
});
