#!/usr/bin/env node
//
// lp-release-manifest.mjs — regenerate lp/src/release-manifest.json for the
// free LP's direct installer download button.
//
// Usage (repo root, after `npm run paid-release`):
//   node scripts/lp-release-manifest.mjs --version 0.7.5
//   node scripts/lp-release-manifest.mjs --version 0.7.5 --manifest <path/to/manifest.json>
//
// Reads the `installer.exe` item of out/paid-release/<version>/manifest.json
// (sha256 + size, as measured by build-paid-release.mjs) and the root
// package.json version, then writes:
//   { version, assetName, sizeBytes, sha256, tag }
// where assetName = WhisperOhKAMI-<version>.Setup.exe (the GitHub Release
// asset name) and tag = v<version>.
//
// Fail-closed: --version must equal package.json's version and the bundle
// manifest's version; the installer item must exist with a 64-hex sha256 and
// a positive integer size. The LP build (lp/src/release.ts) re-checks the
// version against package.json, so a stale file also fails `astro build`.
//
// The file is written to the working tree only; nothing is uploaded.

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_REL_PATH = 'lp/src/release-manifest.json';
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const SHA256_RE = /^[0-9a-f]{64}$/;

function fail(message) {
    console.error(`lp-release-manifest: ${message}`);
    process.exit(1);
}

function parseArgs(argv) {
    const out = {};
    for (let i = 0; i < argv.length; i++) {
        const flag = argv[i];
        if (flag === '--version') out.version = argv[++i];
        else if (flag === '--manifest') out.manifest = argv[++i];
        else fail(`unknown argument ${flag}\nUsage: node scripts/lp-release-manifest.mjs --version <semver> [--manifest <path>]`);
    }
    if (!out.version) fail('missing --version <semver>');
    return out;
}

const args = parseArgs(process.argv.slice(2));
if (!SEMVER_RE.test(args.version)) fail(`--version is not SemVer: ${args.version}`);

const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
if (pkg.version !== args.version) {
    fail(`--version ${args.version} does not match package.json version ${pkg.version}`);
}

const bundleManifestPath = args.manifest
    ? path.resolve(args.manifest)
    : path.join(repoRoot, 'out', 'paid-release', args.version, 'manifest.json');
let bundle;
try {
    bundle = JSON.parse(readFileSync(bundleManifestPath, 'utf8'));
} catch (err) {
    fail(`cannot read ${bundleManifestPath} (run \`npm run paid-release\` first): ${err.message}`);
}
if (bundle.version !== args.version) {
    fail(`${bundleManifestPath} is for version ${bundle.version}, expected ${args.version}`);
}
const installer = Array.isArray(bundle.items) ? bundle.items.find(item => item.filename === 'installer.exe') : undefined;
if (!installer) fail(`${bundleManifestPath} has no installer.exe item`);
if (typeof installer.sha256 !== 'string' || !SHA256_RE.test(installer.sha256)) {
    fail('installer.exe sha256 must be 64 lowercase hex characters');
}
if (!Number.isInteger(installer.size) || installer.size <= 0) {
    fail('installer.exe size must be a positive integer');
}

const lpManifest = {
    version: args.version,
    assetName: `WhisperOhKAMI-${args.version}.Setup.exe`,
    sizeBytes: installer.size,
    sha256: installer.sha256,
    tag: `v${args.version}`,
};

writeFileSync(path.join(repoRoot, OUTPUT_REL_PATH), `${JSON.stringify(lpManifest, null, 2)}\n`, 'utf8');
console.log(`lp-release-manifest: wrote ${OUTPUT_REL_PATH}`);
console.log(`  ${lpManifest.assetName}  ${lpManifest.sizeBytes} bytes  sha256=${lpManifest.sha256}`);
console.log('  Check that the GitHub Release asset has the same SHA-256 (SHA256SUMS.txt) before deploying the LP.');
