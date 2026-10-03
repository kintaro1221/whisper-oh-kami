/**
 * Build app icons (logo.png / logo.ico / logo.icns) from the WhisperOhKAMI
 * δ-B brand mark.
 *
 * Master design:
 *   - 1024x1024 canvas, solid white bg, mark in #1a1f2e (Direction A navy)
 *   - δ-B mark centered using BRAND_MARK_SPEC.centroid + iconCanvasScale
 *   - Geometry (path / strokeWidth / dot trail / opacity) は
 *     `src/assets/brand-mark-spec.mjs` から dynamic import で取得し、UI helper
 *     (`src/assets/brand-mark.js`) と source-of-truth を共有する。tweak したい
 *     場合は spec ファイル 1 箇所だけ触る (dual-source の手動同期が不要)。
 *
 * Pipeline:
 *   1. sharp rasterizes SVG → 1024px PNG (master)
 *   2. png2icons creates multi-res ICO (Windows) + ICNS (macOS) from master
 *
 * Run:  npm run build:icons
 * Output: src/assets/logo.{png,ico,icns}
 */

const sharp = require('sharp');
const png2icons = require('png2icons');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

async function main() {
    // Dynamic ESM import from CJS — brand-mark-spec.mjs is force-ESM by its
    // .mjs extension so Node loads it regardless of package.json "type".
    const specPath = path.resolve(__dirname, '..', 'src', 'assets', 'brand-mark-spec.mjs');
    const { BRAND_MARK_SPEC } = await import(pathToFileURL(specPath).href);

    // Build the icon SVG from the spec. White background + navy mark, centered
    // via the spec's centroid + canvas scale.
    const dotsXml = BRAND_MARK_SPEC.dots
        .map(d => `    <circle cx="${d.cx}" cy="${d.cy}" r="${d.r}" fill="#1a1f2e" opacity="${d.opacity}"/>`)
        .join('\n');
    const ICON_SVG = `<svg width="1024" height="1024" xmlns="http://www.w3.org/2000/svg">
  <rect width="1024" height="1024" fill="#ffffff"/>
  <g transform="translate(512 512) scale(${BRAND_MARK_SPEC.iconCanvasScale}) translate(-${BRAND_MARK_SPEC.centroid.x} -${BRAND_MARK_SPEC.centroid.y})">
    <path d="${BRAND_MARK_SPEC.path}"
          stroke="#1a1f2e" stroke-width="${BRAND_MARK_SPEC.strokeWidth}" stroke-linecap="round" fill="none"/>
${dotsXml}
  </g>
</svg>`;

    const ASSETS = path.resolve(__dirname, '..', 'src', 'assets');

    console.log('[1/3] Rasterizing SVG → 1024×1024 PNG (sharp)');
    const masterPng = await sharp(Buffer.from(ICON_SVG)).resize(1024, 1024).png({ compressionLevel: 9 }).toBuffer();
    const pngPath = path.join(ASSETS, 'logo.png');
    await fs.promises.writeFile(pngPath, masterPng);
    console.log(`      wrote ${pngPath} (${masterPng.length.toLocaleString()} bytes)`);

    console.log('[2/3] Generating Windows ICO (multi-resolution, BMP storage)');
    const ico = png2icons.createICO(masterPng, png2icons.BEZIER, 0, false);
    if (!ico) throw new Error('png2icons.createICO returned null');
    const icoPath = path.join(ASSETS, 'logo.ico');
    await fs.promises.writeFile(icoPath, ico);
    console.log(`      wrote ${icoPath} (${ico.length.toLocaleString()} bytes)`);

    console.log('[3/3] Generating macOS ICNS (multi-resolution, retina set)');
    const icns = png2icons.createICNS(masterPng, png2icons.BEZIER, 0);
    if (!icns) throw new Error('png2icons.createICNS returned null');
    const icnsPath = path.join(ASSETS, 'logo.icns');
    await fs.promises.writeFile(icnsPath, icns);
    console.log(`      wrote ${icnsPath} (${icns.length.toLocaleString()} bytes)`);

    console.log('Done.');
}

main().catch(e => {
    console.error('build-icons failed:', e);
    process.exit(1);
});
