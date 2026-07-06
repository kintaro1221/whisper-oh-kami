// whisperBarState.js — 初回 Whisper DL の進捗バー表示状態を決める純関数。
//
// Loaded two ways（evidenceInspector / discoveryPhase と同じ plain-script 方式）:
//   - Jest tests: `require('.../whisperBarState')` → module.exports
//   - Renderer  : `<script src="utils/whisperBarState.js"></script>` →
//                 window.whisperBarState（Lit の MainView が render 時に読む）
//
// No DOM / no Node / no Electron deps — pure function only.
//
// NOTE: トップレベル識別子（`function`/`const`）は file-unique にすること。
// src/index.html の sibling plain-script は global lexical 環境を共有するため、
// 重複した `const _whisperBarStateApi` 等は 2 つ目のファイルを parse 時に壊す。
// 回帰ガード: tests/unit/plainScriptScope.test.js。

'use strict';

// progress: whisperProgress.js の snapshot（{ percent, totalBytes, loadedMB, totalMB, ... }）。
// 判定は totalBytes 境界で行う（percent===0 だけで indeterminate にしない）:
//   totalBytes が未確定（null/非有限/<=0）→ indeterminate
//   totalBytes が正 → determinate（percent 0 でも determinate）、percent は 0..100 にクランプ
function whisperBarState(progress) {
    const totalBytes = Number(progress && progress.totalBytes);
    if (!Number.isFinite(totalBytes) || totalBytes <= 0) {
        return { indeterminate: true, percent: 0 };
    }

    const rawPercent = Number(progress && progress.percent);
    const percent = Number.isFinite(rawPercent) ? Math.min(100, Math.max(0, rawPercent)) : 0;
    return { indeterminate: false, percent };
}

const _whisperBarStateApi = { whisperBarState };

if (typeof module !== 'undefined' && module.exports) {
    module.exports = _whisperBarStateApi;
}
if (typeof window !== 'undefined') {
    window.whisperBarState = whisperBarState;
}
