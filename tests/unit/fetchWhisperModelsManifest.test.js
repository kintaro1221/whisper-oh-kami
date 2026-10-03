'use strict';

// Rewritten 2026-09 (external review must-fix): the previous version of this
// suite only exercised `scripts/fetch-whisper-models.mjs --check` against the
// REAL `resources/whisper-models/` fixture files fetched by
// `npm run whisper-models` (~282 MB, network-fetched, absent on a fresh
// checkout — those cases silently `test.skip`ped there). This rewrite never
// touches `resources/`: it builds a throwaway 14-file fixture + matching
// manifest under a temp directory for every test, and points the script at
// it via the `WHISPER_MODELS_DIR` / `WHISPER_MODELS_MANIFEST` env var
// overrides the script now supports. `npm test` is now fully green on a
// fresh checkout with no bundled models fetched.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const repoRoot = path.join(__dirname, '..', '..');
const scriptPath = path.join(repoRoot, 'scripts', 'fetch-whisper-models.mjs');
const realManifestPath = path.join(repoRoot, 'scripts', 'whisper-models.manifest.json');

// Mirrors scripts/fetch-whisper-models.mjs's BUNDLED_MODEL_REPOS / MODEL_FILES.
// Duplicated deliberately (same rationale as the pre-existing EXPECTED_FILES
// constant this file already had): the script is an ESM .mjs module invoked
// as a subprocess in these tests, not imported, so there is nothing to
// require() the constants from without adding an export surface purely for
// tests.
const BUNDLED_MODEL_REPOS = ['Xenova/whisper-tiny', 'Xenova/whisper-small'];
const MODEL_FILES = [
    'config.json',
    'generation_config.json',
    'preprocessor_config.json',
    'tokenizer.json',
    'tokenizer_config.json',
    'onnx/encoder_model_quantized.onnx',
    'onnx/decoder_model_merged_quantized.onnx',
];

function sha256(content) {
    return crypto.createHash('sha256').update(content).digest('hex');
}

// Writes 14 small dummy files under <resourcesDir>/<repo>/<file> and returns
// the manifest entries that exactly describe them (size + sha256 computed
// from the actual bytes written, so "normal" fixtures are self-consistent
// by construction).
function writeFixtureFiles(resourcesDir) {
    const entries = [];
    for (const repo of BUNDLED_MODEL_REPOS) {
        for (const file of MODEL_FILES) {
            const destPath = path.join(resourcesDir, repo, file);
            fs.mkdirSync(path.dirname(destPath), { recursive: true });
            const content = `dummy-fixture-content:${repo}/${file}`;
            fs.writeFileSync(destPath, content, 'utf8');
            entries.push({
                repo,
                file,
                size: Buffer.byteLength(content, 'utf8'),
                sha256: sha256(content),
            });
        }
    }
    return entries;
}

function writeManifest(manifestPath, entries) {
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(manifestPath, JSON.stringify({ files: entries }, null, 2) + '\n', 'utf8');
}

// Exercises the --dir/--manifest CLI args (the primary, higher-priority
// override path used by scripts/bundled-whisper-check.js — see that file
// and forge.config.js's prePackage hook). Kept as the default for these
// fixture tests since it's what production code now relies on.
function runCheck(resourcesDir, manifestPath) {
    return execFileSync('node', [scriptPath, '--check', '--dir', resourcesDir, '--manifest', manifestPath], {
        cwd: repoRoot,
        stdio: 'pipe',
    });
}

function runWriteManifest(resourcesDir, manifestPath) {
    return execFileSync('node', [scriptPath, '--write-manifest', '--dir', resourcesDir, '--manifest', manifestPath], {
        cwd: repoRoot,
        stdio: 'pipe',
    });
}

// Exercises the WHISPER_MODELS_DIR / WHISPER_MODELS_MANIFEST env-var
// override path (still supported as a lower-priority fallback below --dir/
// --manifest — see scripts/fetch-whisper-models.mjs's priority-ordered
// resolution comment).
function runCheckViaEnvVars(resourcesDir, manifestPath) {
    return execFileSync('node', [scriptPath, '--check'], {
        cwd: repoRoot,
        stdio: 'pipe',
        env: { ...process.env, WHISPER_MODELS_DIR: resourcesDir, WHISPER_MODELS_MANIFEST: manifestPath },
    });
}

function makeTmpDir() {
    // Unique per test (mkdtempSync appends a random suffix) so parallel Jest
    // workers never share a fixture directory.
    return fs.mkdtempSync(path.join(os.tmpdir(), 'whisper-models-fixture-'));
}

// Structural sanity of the actual, checked-in manifest that ships with the
// repo (scripts/whisper-models.manifest.json). Reads the file directly —
// no subprocess, no dependency on resources/ being fetched.
describe('scripts/whisper-models.manifest.json (checked-in manifest, structural)', () => {
    let manifest;

    beforeAll(() => {
        manifest = JSON.parse(fs.readFileSync(realManifestPath, 'utf8'));
    });

    test('covers both bundled repos (Xenova/whisper-tiny, Xenova/whisper-small)', () => {
        const repos = new Set(manifest.files.map(f => f.repo));
        expect(repos.has('Xenova/whisper-tiny')).toBe(true);
        expect(repos.has('Xenova/whisper-small')).toBe(true);
        expect(repos.size).toBe(2);
    });

    test('has exactly 14 entries (2 repos x 7 files, no more, no less)', () => {
        expect(manifest.files.length).toBe(14);
    });

    test.each(BUNDLED_MODEL_REPOS)('%s has the exact q8 file set', repo => {
        const files = manifest.files.filter(f => f.repo === repo).map(f => f.file);
        expect(files.sort()).toEqual([...MODEL_FILES].sort());
    });

    test('every entry has a positive integer size and a 64-char lowercase hex sha256', () => {
        for (const entry of manifest.files) {
            expect(Number.isInteger(entry.size)).toBe(true);
            expect(entry.size).toBeGreaterThan(0);
            expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
        }
    });

    test('has no duplicate repo/file entries', () => {
        const keys = manifest.files.map(f => `${f.repo}/${f.file}`);
        expect(new Set(keys).size).toBe(keys.length);
    });
});

// Fixture-driven --check tests. Every test builds its own temp
// resources dir + manifest, so nothing here depends on
// `npm run whisper-models` having been run and nothing touches the real
// resources/whisper-models/ directory.
describe('fetch-whisper-models.mjs --check (fixture-based, offline, no real resources/)', () => {
    let tmpDir, resourcesDir, manifestPath;

    beforeEach(() => {
        tmpDir = makeTmpDir();
        resourcesDir = path.join(tmpDir, 'resources', 'whisper-models');
        manifestPath = path.join(tmpDir, 'manifest.json');
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('passes (exit 0) when all 14 bundled files exist and match the manifest exactly', () => {
        const entries = writeFixtureFiles(resourcesDir);
        writeManifest(manifestPath, entries);
        expect(() => runCheck(resourcesDir, manifestPath)).not.toThrow();
    });

    test('passes via the WHISPER_MODELS_DIR / WHISPER_MODELS_MANIFEST env-var override path too', () => {
        const entries = writeFixtureFiles(resourcesDir);
        writeManifest(manifestPath, entries);
        expect(() => runCheckViaEnvVars(resourcesDir, manifestPath)).not.toThrow();
    });

    test('--dir/--manifest CLI args take priority over WHISPER_MODELS_DIR / WHISPER_MODELS_MANIFEST env vars', () => {
        // Valid fixture at resourcesDir/manifestPath (via --dir/--manifest).
        const entries = writeFixtureFiles(resourcesDir);
        writeManifest(manifestPath, entries);

        // A bogus env-var override pointing at a directory with no files and
        // no manifest at all — if the env vars won over the CLI args, this
        // would fail (empty manifest / missing files).
        const bogusDir = path.join(tmpDir, 'bogus-resources');
        const bogusManifest = path.join(tmpDir, 'bogus-manifest.json');

        expect(() =>
            execFileSync('node', [scriptPath, '--check', '--dir', resourcesDir, '--manifest', manifestPath], {
                cwd: repoRoot,
                stdio: 'pipe',
                env: { ...process.env, WHISPER_MODELS_DIR: bogusDir, WHISPER_MODELS_MANIFEST: bogusManifest },
            })
        ).not.toThrow();
    });

    test('fails when a bundled file is missing from disk (1 件欠落)', () => {
        const entries = writeFixtureFiles(resourcesDir);
        writeManifest(manifestPath, entries);
        fs.unlinkSync(path.join(resourcesDir, 'Xenova', 'whisper-small', 'config.json'));
        expect(() => runCheck(resourcesDir, manifestPath)).toThrow();
    });

    test('fails on a hash mismatch (on-disk content does not match the manifest sha256)', () => {
        const entries = writeFixtureFiles(resourcesDir);
        writeManifest(manifestPath, entries);
        fs.writeFileSync(path.join(resourcesDir, 'Xenova', 'whisper-tiny', 'tokenizer.json'), 'tampered content, wrong hash', 'utf8');
        expect(() => runCheck(resourcesDir, manifestPath)).toThrow();
    });

    test('fails when the manifest has only 13 entries (one repo/file combo missing from the manifest itself)', () => {
        const entries = writeFixtureFiles(resourcesDir);
        writeManifest(manifestPath, entries.slice(0, 13));
        expect(() => runCheck(resourcesDir, manifestPath)).toThrow();
    });

    test('fails when an extra file exists under resources/whisper-models/ that is not in the manifest', () => {
        const entries = writeFixtureFiles(resourcesDir);
        writeManifest(manifestPath, entries);
        fs.writeFileSync(path.join(resourcesDir, 'Xenova', 'whisper-small', 'stray-extra-file.txt'), 'should not be here', 'utf8');
        expect(() => runCheck(resourcesDir, manifestPath)).toThrow();
    });

    test('fails on a duplicate manifest entry for the same repo/file', () => {
        const entries = writeFixtureFiles(resourcesDir);
        writeManifest(manifestPath, [...entries, { ...entries[0] }]);
        expect(() => runCheck(resourcesDir, manifestPath)).toThrow();
    });

    test('fails on a malformed sha256 (wrong case / not 64 hex chars)', () => {
        const entries = writeFixtureFiles(resourcesDir);
        entries[0] = { ...entries[0], sha256: entries[0].sha256.toUpperCase() };
        writeManifest(manifestPath, entries);
        expect(() => runCheck(resourcesDir, manifestPath)).toThrow();
    });

    test('fails on an entry with a repo not in the allowed repo list', () => {
        const entries = writeFixtureFiles(resourcesDir);
        entries[0] = { ...entries[0], repo: 'Xenova/whisper-medium' };
        writeManifest(manifestPath, entries);
        expect(() => runCheck(resourcesDir, manifestPath)).toThrow();
    });

    test('fails on a non-positive-integer size', () => {
        const entries = writeFixtureFiles(resourcesDir);
        entries[0] = { ...entries[0], size: -1 };
        writeManifest(manifestPath, entries);
        expect(() => runCheck(resourcesDir, manifestPath)).toThrow();
    });
});

// --write-manifest: only exercised in the "no download needed" path (every
// fixture file already present and correct on disk), since these tests must
// stay network-free. The failure-and-leave-manifest-untouched behavior for a
// download failure is covered by code inspection (temp-file + rename, only
// reached after every file succeeds) rather than a live network test here.
describe('fetch-whisper-models.mjs --write-manifest (fixture-based, no network needed)', () => {
    let tmpDir, resourcesDir, manifestPath;

    beforeEach(() => {
        tmpDir = makeTmpDir();
        resourcesDir = path.join(tmpDir, 'resources', 'whisper-models');
        manifestPath = path.join(tmpDir, 'manifest.json');
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('rewrites the manifest to match what is already on disk when every file is already present', () => {
        const entries = writeFixtureFiles(resourcesDir);
        // Start with no manifest at all at manifestPath.
        expect(fs.existsSync(manifestPath)).toBe(false);

        expect(() => runWriteManifest(resourcesDir, manifestPath)).not.toThrow();

        expect(fs.existsSync(manifestPath)).toBe(true);
        const written = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        const writtenKeys = written.files.map(f => `${f.repo}/${f.file}`).sort();
        const expectedKeys = entries.map(f => `${f.repo}/${f.file}`).sort();
        expect(writtenKeys).toEqual(expectedKeys);
        for (const entry of written.files) {
            const matching = entries.find(e => e.repo === entry.repo && e.file === entry.file);
            expect(entry.size).toBe(matching.size);
            expect(entry.sha256).toBe(matching.sha256);
        }
    });

    test('does not leave a stray .tmp file behind after a successful write', () => {
        writeFixtureFiles(resourcesDir);
        runWriteManifest(resourcesDir, manifestPath);
        const siblingFiles = fs.readdirSync(path.dirname(manifestPath));
        const strays = siblingFiles.filter(name => name !== path.basename(manifestPath) && name !== 'resources');
        expect(strays).toEqual([]);
    });
});
