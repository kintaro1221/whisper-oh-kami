/**
 * Build web/README/LP logo files from the WhisperOhKAMI δ-B brand mark.
 *
 * Unlike `build-icons.js` (which produces the app icon: white background, navy
 * mark, packed into logo.{png,ico,icns} for the OS), this emits *transparent*,
 * theme-adaptive logos for documents and the landing page:
 *
 *   docs/brand/logo-mark-light.svg  navy mark   (for light backgrounds)
 *   docs/brand/logo-mark-dark.svg   white mark  (for dark backgrounds)
 *   docs/brand/logo-mark-{light,dark}.png  512px transparent raster fallbacks
 *
 * Geometry (path / strokeWidth / dot trail / opacity) comes from
 * `src/assets/brand-mark-spec.mjs` — the same single source of truth the UI
 * helper and the app-icon build use. Tweak the spec once; every output follows.
 *
 * This is a separate script (not folded into build-icons.js) so generating web
 * logos can never perturb the committed app icons.
 *
 * Run:  npm run build:logos
 */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

/**
 * Render the brand mark as a standalone, transparent-background SVG string.
 * Pure function of the spec + options — no I/O, no bundled background.
 *
 * @param {object} spec  BRAND_MARK_SPEC-shaped object (viewBox/path/strokeWidth/dots)
 * @param {object} opts
 * @param {string} opts.markColor  stroke/fill color for the mark + dots
 * @param {number} [opts.width=48]
 * @param {number} [opts.height=48]
 */
function markSvg(spec, { markColor, width = 48, height = 48 }) {
    const dotsXml = spec.dots.map(d => `  <circle cx="${d.cx}" cy="${d.cy}" r="${d.r}" fill="${markColor}" opacity="${d.opacity}"/>`).join('\n');
    return `<svg width="${width}" height="${height}" viewBox="${spec.viewBox}" xmlns="http://www.w3.org/2000/svg">
  <path d="${spec.path}" stroke="${markColor}" stroke-width="${spec.strokeWidth}" stroke-linecap="round" fill="none"/>
${dotsXml}
</svg>
`;
}

async function main() {
    const sharp = require('sharp');
    const specPath = path.resolve(__dirname, '..', 'src', 'assets', 'brand-mark-spec.mjs');
    const { BRAND_MARK_SPEC } = await import(pathToFileURL(specPath).href);

    const outDir = path.resolve(__dirname, '..', 'docs', 'brand');
    await fs.promises.mkdir(outDir, { recursive: true });

    // Navy for light backgrounds (matches the app icon), white for dark.
    const variants = [
        { name: 'light', markColor: '#1a1f2e' },
        { name: 'dark', markColor: '#ffffff' },
    ];

    for (const v of variants) {
        const svg = markSvg(BRAND_MARK_SPEC, { markColor: v.markColor });
        const svgPath = path.join(outDir, `logo-mark-${v.name}.svg`);
        await fs.promises.writeFile(svgPath, svg);
        console.log(`wrote ${path.relative(process.cwd(), svgPath)}`);

        const pngSvg = markSvg(BRAND_MARK_SPEC, { markColor: v.markColor, width: 512, height: 512 });
        const png = await sharp(Buffer.from(pngSvg)).png({ compressionLevel: 9 }).toBuffer();
        const pngPath = path.join(outDir, `logo-mark-${v.name}.png`);
        await fs.promises.writeFile(pngPath, png);
        console.log(`wrote ${path.relative(process.cwd(), pngPath)} (${png.length.toLocaleString()} bytes)`);
    }

    console.log('Done.');
}

if (require.main === module) {
    main().catch(e => {
        console.error('build-logos failed:', e);
        process.exit(1);
    });
}

module.exports = { markSvg };
