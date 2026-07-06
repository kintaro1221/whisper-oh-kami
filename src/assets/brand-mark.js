import { svg } from './lit-core-2.7.4.min.js';
import { BRAND_MARK_SPEC } from './brand-mark-spec.mjs';

/**
 * WhisperOhKAMI brand mark — δ-B「手当て耳 + 3 dots 余韻」
 *
 * 深い C curve = 耳に手を当てて聞き入る active listening のジェスチャ。
 * 右側 3 dots の opacity フェード (1.0 → 0.85 → 0.7) = 囁きが空中に漂って消える余韻。
 *
 * Geometry (path / strokeWidth / dots) は `brand-mark-spec.mjs` で一元管理。
 * 同じ spec を `scripts/build-icons.js` も import するため、UI mark と app icon
 * mark は自動で同期する (PR #27 までの dual-source 手動同期問題を解消)。
 *
 * `currentColor` を使うため、surrounding text の `color` を継承する。
 * theme system の `--text-primary` に追従させたい場合は、親要素に
 * `color: var(--text-primary)` を指定する。
 *
 * @param {number} size - SVG width/height in px. Default 24.
 */
export const brandMark = (size = 24) => svg`
    <svg viewBox="${BRAND_MARK_SPEC.viewBox}" width="${size}" height="${size}" fill="none" aria-hidden="true">
        <path d="${BRAND_MARK_SPEC.path}"
              stroke="currentColor" stroke-width="${BRAND_MARK_SPEC.strokeWidth}" stroke-linecap="round"/>
        ${BRAND_MARK_SPEC.dots.map(
            d => svg`<circle cx="${d.cx}" cy="${d.cy}" r="${d.r}" fill="currentColor" opacity="${d.opacity}"/>`
        )}
    </svg>
`;
