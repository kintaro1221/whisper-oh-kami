/**
 * WhisperOhKAMI brand mark spec — single source of truth.
 *
 * Both the UI helper (`src/assets/brand-mark.js`, ESM in Chromium renderer)
 * and the app icon build script (`scripts/build-icons.js`, CJS in Node)
 * import this spec to render the δ-B「手当て耳 + 3 dots 余韻」mark.
 *
 * Tweak path / strokeWidth / dots / centroid / iconCanvasScale here once;
 * both consumers stay in sync automatically. (Pre-集約: PR #27 のように 2
 * ファイルを手動同期する必要があった。)
 *
 * Loading:
 *   - Renderer (ESM in Chromium): static `import { BRAND_MARK_SPEC } from './brand-mark-spec.mjs'`
 *   - Node CJS (build-icons.js):  dynamic `await import(pathToFileURL(...).href)`
 *
 * Stroke / dot geometry tuning (post PR #27 clarity-pass for 22px display):
 *   - sidebar / MainView title は 22px 表示 → scale 0.46 で stroke ~1.6px、
 *     最小 dot 半径 ~0.74px。
 *   - 旧 PR #19 A3 = stroke 2.5 / 最小 dot r=1.2 op=0.5 は 22px / app icon
 *     16-24px で sub-pixel 化していたため、stroke 3.5 / dots r=2.0/1.8/1.6
 *     op=1.0/0.85/0.7 に強化。72px hero ではやや太めだが cascade の意図は保持。
 */
export const BRAND_MARK_SPEC = {
    viewBox: '0 0 48 48',
    path: 'M 32 8 C 18 8, 12 18, 12 24 C 12 30, 18 40, 32 40',
    strokeWidth: 3.5,
    // Centroid of the visual bounding box (path + dots), used by the app icon
    // build to center the mark on a 1024x1024 canvas with scale=iconCanvasScale.
    centroid: { x: 27.5, y: 24 },
    iconCanvasScale: 22,
    dots: [
        { cx: 36, cy: 20, r: 2.0, opacity: 1.0 },
        { cx: 40, cy: 24, r: 1.8, opacity: 0.85 },
        { cx: 43, cy: 28, r: 1.6, opacity: 0.7 },
    ],
};
