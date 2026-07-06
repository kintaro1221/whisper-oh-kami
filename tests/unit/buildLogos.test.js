'use strict';

const fs = require('fs');
const path = require('path');

const { markSvg } = require('../../scripts/build-logos');

const repoRoot = path.join(__dirname, '..', '..');

// Minimal stand-in for BRAND_MARK_SPEC (the real spec is ESM; markSvg is a pure
// function of whatever spec it's handed, so a fixture exercises the rendering).
const SPEC = {
    viewBox: '0 0 48 48',
    path: 'M 32 8 C 18 8, 12 18, 12 24 C 12 30, 18 40, 32 40',
    strokeWidth: 3.5,
    dots: [
        { cx: 36, cy: 20, r: 2.0, opacity: 1.0 },
        { cx: 40, cy: 24, r: 1.8, opacity: 0.85 },
        { cx: 43, cy: 28, r: 1.6, opacity: 0.7 },
    ],
};

describe('build-logos: markSvg (web logo rendering)', () => {
    test('renders the spec mark in the given color on a transparent canvas', () => {
        const svg = markSvg(SPEC, { markColor: '#1a1f2e' });

        expect(svg).toContain('viewBox="0 0 48 48"');
        expect(svg).toContain(SPEC.path);
        expect(svg).toMatch(/stroke="#1a1f2e"/);
        // All three trailing dots, with their cascade opacities preserved.
        expect((svg.match(/<circle/g) || []).length).toBe(3);
        expect(svg).toMatch(/opacity="0\.7"/);
        // Transparent: no opaque background rect (unlike the app icon).
        expect(svg).not.toMatch(/<rect/);
    });

    test('color is parameterized for the dark-background variant', () => {
        const svg = markSvg(SPEC, { markColor: '#ffffff' });
        expect(svg).toMatch(/stroke="#ffffff"/);
        expect(svg).toMatch(/fill="#ffffff"/);
        expect(svg).not.toMatch(/#1a1f2e/);
    });

    test('width/height are overridable for raster export', () => {
        const svg = markSvg(SPEC, { markColor: '#1a1f2e', width: 512, height: 512 });
        expect(svg).toMatch(/width="512"/);
        expect(svg).toMatch(/height="512"/);
        // viewBox keeps the mark geometry independent of pixel size.
        expect(svg).toContain('viewBox="0 0 48 48"');
    });
});

describe('build-logos: committed web logo assets exist for README/LP embed', () => {
    for (const file of [
        'docs/brand/logo-mark-light.svg',
        'docs/brand/logo-mark-dark.svg',
        'docs/brand/logo-mark-light.png',
        'docs/brand/logo-mark-dark.png',
    ]) {
        test(`${file} is present`, () => {
            expect(fs.existsSync(path.join(repoRoot, file))).toBe(true);
        });
    }
});
