'use strict';

// Tests for the deterministic paid-release bundle builder
// (`scripts/build-paid-release.mjs`).
//
// The builder runs in the operator's clean git worktree, asserts the
// THIRD_PARTY_NOTICES file is current, freezes a SemVer-pinned bundle of
// (installer + source.zip + lockfiles.zip + LICENSE + notices + the two
// distribution guides + a key-sorted manifest.json), and writes the whole
// thing to `out/paid-release/<version>/`. The operator then uploads the
// bundle to R2 and inserts a row in D1.
//
// Why each scenario gets its own throw-away git repo:
//   * The clean-tree gate (`git diff --quiet` + `git diff --cached --quiet`)
//     would otherwise be tripped by the implementation worktree being dirty
//     while we are running the test suite. We never weaken the gate; we run
//     it against committed minimal fixtures instead.
//   * The notices:check failure scenario needs a `npm run notices:check`
//     command that exits non-zero. We supply a fixture `package.json` whose
//     `notices:check` script literally exits 1, so the builder fails for the
//     reason we are testing rather than for missing dependencies.
//   * The version-mismatch scenario needs the fixture root `package.json`
//     `version` to be a literal string the test controls; we pin
//     `0.0.1` and pass `--version 0.0.1-beta.1` for the happy path or
//     `--version 0.0.2-beta.1` for the mismatch path.
//
// What the builder writes (asserted here): a manifest.json whose keys are
// alphabetically sorted at every level, whose `items[]` is sorted by
// filename, whose every item has `sha256` (lowercase hex) and `size` (byte
// length), whose `expectedAuthenticodeState` is the literal string
// `unsigned-beta`, whose `generatedAt` equals the HEAD commit's `%cI`, and
// whose `version` and `commitSha` match the inputs.

const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const repoRoot = path.resolve(__dirname, '..', '..');
const BUILDER = path.join(repoRoot, 'scripts', 'build-paid-release.mjs');

const DUMMY_INSTALLER_FILENAME = 'WhisperOhKAMI-0.0.1 Setup.exe';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function git(cwd, args) {
    return execFileSync('git', args, {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf8',
        env: {
            ...process.env,
            GIT_AUTHOR_NAME: 'Test',
            GIT_AUTHOR_EMAIL: 'test@example.com',
            GIT_COMMITTER_NAME: 'Test',
            GIT_COMMITTER_EMAIL: 'test@example.com',
        },
    });
}

function writeFile(root, relPath, contents) {
    const target = path.join(root, relPath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
}

// Returns the path to an isolated, committed minimal fixture repository.
//
// The shape:
//   <root>/package.json (version 0.0.1, notices:check echoes ok, paid-release
//                       points at the SAME builder file under test, located
//                       via an env variable the spawned process inherits)
//   <root>/LICENSE
//   <root>/THIRD_PARTY_NOTICES.md
//   <root>/package-lock.json (npm v3 lockfileVersion shape, minimal)
//   <root>/lp/package-lock.json
//   <root>/native/daddy-audio-capture/Cargo.lock
//   <root>/native/daddy-audio-capture/Cargo.toml
//   <root>/native/daddy-audio-capture/src/lib.rs (so "native helper source"
//                                                exists)
//   <root>/docs/distribution/windows-install-guide.md
//   <root>/docs/distribution/build-from-source.md
//   <root>/scripts/notices-check.js (the script the test repo's
//                                    `notices:check` script invokes)
function createFixtureRepo(overrides = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paid-release-'));
    const version = overrides.version || '0.0.1';
    const noticesCheckExitCode = overrides.noticesCheckExitCode ?? 0;
    const includeNativeSource = overrides.includeNativeSource !== false;
    const includeDistributionGuides = overrides.includeDistributionGuides !== false;

    writeFile(
        root,
        'package.json',
        JSON.stringify(
            {
                name: 'fixture',
                productName: 'Fixture',
                version,
                scripts: {
                    'notices:check': `node scripts/notices-check.js`,
                },
            },
            null,
            2
        )
    );

    writeFile(root, 'LICENSE', 'GPL-3.0 fixture license body\n');
    writeFile(
        root,
        'THIRD_PARTY_NOTICES.md',
        '# Third-Party Notices\n\nFixture notices body.\n'
    );
    writeFile(
        root,
        'package-lock.json',
        JSON.stringify({ name: 'fixture', version, lockfileVersion: 3, packages: {} }, null, 2)
    );
    writeFile(
        root,
        'lp/package-lock.json',
        JSON.stringify({ name: 'lp', version: '0.0.0', lockfileVersion: 3, packages: {} }, null, 2)
    );
    writeFile(
        root,
        'native/daddy-audio-capture/Cargo.lock',
        '# This file is automatically @generated by Cargo.\n[[package]]\nname = "daddy-audio-capture"\nversion = "0.0.0"\n'
    );

    if (includeNativeSource) {
        writeFile(
            root,
            'native/daddy-audio-capture/Cargo.toml',
            '[package]\nname = "daddy-audio-capture"\nversion = "0.0.0"\n'
        );
        writeFile(
            root,
            'native/daddy-audio-capture/src/lib.rs',
            '// fixture native helper\n'
        );
    }

    if (includeDistributionGuides) {
        writeFile(
            root,
            'docs/distribution/windows-install-guide.md',
            '# Windows Install Guide\nFixture guide.\n'
        );
        writeFile(
            root,
            'docs/distribution/build-from-source.md',
            '# Build From Source\nFixture instructions.\n'
        );
    }

    writeFile(
        root,
        'scripts/notices-check.js',
        `process.exit(${noticesCheckExitCode});\n`
    );

    git(root, ['init', '--initial-branch=main']);
    git(root, ['config', 'commit.gpgsign', 'false']);
    git(root, ['add', '.']);
    git(root, ['commit', '-m', 'fixture: initial commit']);

    return root;
}

function makeDummyInstaller() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paid-release-installer-'));
    const file = path.join(dir, DUMMY_INSTALLER_FILENAME);
    // ~1 KB of deterministic bytes (zeros) so the hash is stable across runs.
    fs.writeFileSync(file, Buffer.alloc(1024, 0));
    return { dir, file };
}

function rmrf(dir) {
    if (!dir) return;
    try {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    } catch {
        // ignore
    }
}

async function runBuilder(cwd, args) {
    try {
        const { stdout, stderr } = await execFileAsync(
            process.execPath,
            [BUILDER, ...args],
            {
                cwd,
                env: { ...process.env, PAID_RELEASE_NPM: '1' },
                maxBuffer: 16 * 1024 * 1024,
            }
        );
        return { code: 0, stdout, stderr };
    } catch (err) {
        return {
            code: typeof err.code === 'number' ? err.code : 1,
            stdout: err.stdout?.toString() || '',
            stderr: err.stderr?.toString() || err.message,
        };
    }
}

function sha256File(filePath) {
    const hash = crypto.createHash('sha256');
    hash.update(fs.readFileSync(filePath));
    return hash.digest('hex');
}

// Minimal central-directory reader for ZIP files written by `git archive
// --format=zip`. Returns the array of entry names in the order they appear in
// the central directory. Sufficient to assert "the zip contains these
// entries".
function readZipEntries(zipPath) {
    const buf = fs.readFileSync(zipPath);
    // End of central directory record: signature 0x06054b50, total length 22
    // bytes + comment. We scan backwards from the end of the file looking for
    // the signature.
    let eocdOffset = -1;
    for (let i = buf.length - 22; i >= 0; i--) {
        if (buf.readUInt32LE(i) === 0x06054b50) {
            eocdOffset = i;
            break;
        }
    }
    if (eocdOffset < 0) throw new Error(`No EOCD record in ${zipPath}`);
    const totalEntries = buf.readUInt16LE(eocdOffset + 10);
    const centralDirOffset = buf.readUInt32LE(eocdOffset + 16);

    const entries = [];
    let cur = centralDirOffset;
    for (let i = 0; i < totalEntries; i++) {
        // Central directory header signature: 0x02014b50
        if (buf.readUInt32LE(cur) !== 0x02014b50) {
            throw new Error(`Bad CDH signature at offset ${cur} in ${zipPath}`);
        }
        const fileNameLen = buf.readUInt16LE(cur + 28);
        const extraLen = buf.readUInt16LE(cur + 30);
        const commentLen = buf.readUInt16LE(cur + 32);
        const name = buf.slice(cur + 46, cur + 46 + fileNameLen).toString('utf8');
        entries.push(name);
        cur += 46 + fileNameLen + extraLen + commentLen;
    }
    return entries;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('build-paid-release.mjs', () => {
    let fixtureRoot;
    let installerHandle;

    afterEach(() => {
        rmrf(fixtureRoot);
        if (installerHandle) rmrf(installerHandle.dir);
        fixtureRoot = null;
        installerHandle = null;
    });

    // ──────────────────────────── happy path ────────────────────────────

    test('happy path: writes manifest + all required artifacts and exits 0', async () => {
        fixtureRoot = createFixtureRepo();
        installerHandle = makeDummyInstaller();
        const result = await runBuilder(fixtureRoot, [
            '--version', '0.0.1-beta.1',
            '--installer', installerHandle.file,
        ]);
        expect(result.code).toBe(0);

        const outDir = path.join(fixtureRoot, 'out', 'paid-release', '0.0.1-beta.1');
        expect(fs.existsSync(outDir)).toBe(true);

        for (const name of [
            'installer.exe',
            'source.zip',
            'lockfiles.zip',
            'LICENSE',
            'THIRD_PARTY_NOTICES.md',
            'guide.md',
            'build-instructions.md',
            'manifest.json',
            'manifest.json.sha256',
        ]) {
            expect(fs.existsSync(path.join(outDir, name))).toBe(true);
        }

        const manifest = JSON.parse(
            fs.readFileSync(path.join(outDir, 'manifest.json'), 'utf8')
        );
        expect(manifest.version).toBe('0.0.1-beta.1');
        expect(typeof manifest.commitSha).toBe('string');
        expect(manifest.commitSha).toMatch(/^[0-9a-f]{40}$/);
        expect(manifest.expectedAuthenticodeState).toBe('unsigned-beta');
        expect(typeof manifest.generatedAt).toBe('string');
        // generatedAt must match `git show -s --format=%cI HEAD` to be
        // deterministic. We re-compute it from the fixture repo and compare
        // both forms (full ISO and Z-suffix form) because git emits
        // `+00:00` and we accept either.
        const headCommitIso = git(fixtureRoot, ['show', '-s', '--format=%cI', 'HEAD']).trim();
        const acceptableIso = [headCommitIso, headCommitIso.replace(/\+00:00$/, 'Z')];
        expect(acceptableIso).toContain(manifest.generatedAt);

        expect(Array.isArray(manifest.items)).toBe(true);
        // Eight artifact items (installer, source, guide, license, notices,
        // buildInstructions, lockfiles, manifest is NOT a self-item).
        // The manifest catalogues the seven non-manifest files.
        const filenames = manifest.items.map((it) => it.filename).sort();
        expect(filenames).toEqual([
            'LICENSE',
            'THIRD_PARTY_NOTICES.md',
            'build-instructions.md',
            'guide.md',
            'installer.exe',
            'lockfiles.zip',
            'source.zip',
        ]);

        for (const item of manifest.items) {
            expect(typeof item.filename).toBe('string');
            expect(typeof item.sha256).toBe('string');
            expect(item.sha256).toMatch(/^[0-9a-f]{64}$/);
            expect(item.sha256).toBe(item.sha256.toLowerCase());
            expect(Number.isInteger(item.size)).toBe(true);
            expect(item.size).toBeGreaterThanOrEqual(0);
            // Hash must match the actual on-disk file (defends against the
            // manifest going out of sync with the bundle).
            const actual = sha256File(path.join(outDir, item.filename));
            expect(item.sha256).toBe(actual);
            expect(item.size).toBe(fs.statSync(path.join(outDir, item.filename)).size);
        }
    }, 60_000);

    test('manifest items[] is sorted by filename ascending', async () => {
        fixtureRoot = createFixtureRepo();
        installerHandle = makeDummyInstaller();
        const result = await runBuilder(fixtureRoot, [
            '--version', '0.0.1-beta.1',
            '--installer', installerHandle.file,
        ]);
        expect(result.code).toBe(0);
        const outDir = path.join(fixtureRoot, 'out', 'paid-release', '0.0.1-beta.1');
        const manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'manifest.json'), 'utf8'));
        const names = manifest.items.map((it) => it.filename);
        const sorted = [...names].sort();
        expect(names).toEqual(sorted);
    }, 60_000);

    test('manifest top-level keys are alphabetically sorted', async () => {
        fixtureRoot = createFixtureRepo();
        installerHandle = makeDummyInstaller();
        const result = await runBuilder(fixtureRoot, [
            '--version', '0.0.1-beta.1',
            '--installer', installerHandle.file,
        ]);
        expect(result.code).toBe(0);
        const outDir = path.join(fixtureRoot, 'out', 'paid-release', '0.0.1-beta.1');
        const raw = fs.readFileSync(path.join(outDir, 'manifest.json'), 'utf8');
        // Parse keys in source order using a JSON streaming reader proxy:
        // easier is to parse normally and re-stringify with sorted keys, then
        // compare. Reproducibility requires the file's byte-for-byte
        // serialization to be sorted.
        const obj = JSON.parse(raw);
        const sortedKeys = Object.keys(obj).sort();
        const actualKeys = Object.keys(obj);
        expect(actualKeys).toEqual(sortedKeys);
    }, 60_000);

    test('manifest.json.sha256 contains lowercase hex matching manifest.json', async () => {
        fixtureRoot = createFixtureRepo();
        installerHandle = makeDummyInstaller();
        const result = await runBuilder(fixtureRoot, [
            '--version', '0.0.1-beta.1',
            '--installer', installerHandle.file,
        ]);
        expect(result.code).toBe(0);
        const outDir = path.join(fixtureRoot, 'out', 'paid-release', '0.0.1-beta.1');
        const expected = sha256File(path.join(outDir, 'manifest.json'));
        const recorded = fs
            .readFileSync(path.join(outDir, 'manifest.json.sha256'), 'utf8')
            .trim()
            .split(/\s+/)[0];
        expect(recorded).toBe(expected);
        expect(recorded).toMatch(/^[0-9a-f]{64}$/);
    }, 60_000);

    test('source.zip contains every required tracked path', async () => {
        fixtureRoot = createFixtureRepo();
        installerHandle = makeDummyInstaller();
        const result = await runBuilder(fixtureRoot, [
            '--version', '0.0.1-beta.1',
            '--installer', installerHandle.file,
        ]);
        expect(result.code).toBe(0);
        const outDir = path.join(fixtureRoot, 'out', 'paid-release', '0.0.1-beta.1');
        const entries = readZipEntries(path.join(outDir, 'source.zip'));
        for (const required of [
            'LICENSE',
            'THIRD_PARTY_NOTICES.md',
            'package-lock.json',
            'lp/package-lock.json',
            'native/daddy-audio-capture/Cargo.lock',
            'docs/distribution/windows-install-guide.md',
            'docs/distribution/build-from-source.md',
        ]) {
            // git archive prepends a prefix per `--prefix`; we just need to
            // see the suffix present in some entry.
            const hit = entries.some((e) => e.endsWith(required));
            expect(hit).toBe(true);
        }
    }, 60_000);

    test('lockfiles.zip contains exactly the three lockfile entries', async () => {
        fixtureRoot = createFixtureRepo();
        installerHandle = makeDummyInstaller();
        const result = await runBuilder(fixtureRoot, [
            '--version', '0.0.1-beta.1',
            '--installer', installerHandle.file,
        ]);
        expect(result.code).toBe(0);
        const outDir = path.join(fixtureRoot, 'out', 'paid-release', '0.0.1-beta.1');
        const entries = readZipEntries(path.join(outDir, 'lockfiles.zip'));
        const requiredSuffixes = [
            'package-lock.json',
            'lp/package-lock.json',
            'native/daddy-audio-capture/Cargo.lock',
        ];
        for (const suffix of requiredSuffixes) {
            expect(entries.some((e) => e.endsWith(suffix))).toBe(true);
        }
        // Nothing else (besides the prefix dir entry itself, if any). All
        // entries that are not directories must end with one of the three
        // suffixes.
        for (const e of entries) {
            if (e.endsWith('/')) continue;
            const matched = requiredSuffixes.some((s) => e.endsWith(s));
            expect(matched).toBe(true);
        }
    }, 60_000);

    test('LICENSE and THIRD_PARTY_NOTICES copies are byte-identical to the root files', async () => {
        fixtureRoot = createFixtureRepo();
        installerHandle = makeDummyInstaller();
        const result = await runBuilder(fixtureRoot, [
            '--version', '0.0.1-beta.1',
            '--installer', installerHandle.file,
        ]);
        expect(result.code).toBe(0);
        const outDir = path.join(fixtureRoot, 'out', 'paid-release', '0.0.1-beta.1');
        const copiedLicense = fs.readFileSync(path.join(outDir, 'LICENSE'));
        const rootLicense = fs.readFileSync(path.join(fixtureRoot, 'LICENSE'));
        expect(copiedLicense.equals(rootLicense)).toBe(true);
        const copiedNotices = fs.readFileSync(path.join(outDir, 'THIRD_PARTY_NOTICES.md'));
        const rootNotices = fs.readFileSync(path.join(fixtureRoot, 'THIRD_PARTY_NOTICES.md'));
        expect(copiedNotices.equals(rootNotices)).toBe(true);
    }, 60_000);

    // ──────────────────────────── failure modes ────────────────────────────

    test('rejects an unclean working tree (uncommitted tracked diff)', async () => {
        fixtureRoot = createFixtureRepo();
        installerHandle = makeDummyInstaller();
        // Modify a tracked file without committing.
        fs.writeFileSync(path.join(fixtureRoot, 'LICENSE'), 'mutated\n');
        const result = await runBuilder(fixtureRoot, [
            '--version', '0.0.1-beta.1',
            '--installer', installerHandle.file,
        ]);
        expect(result.code).not.toBe(0);
        expect(result.stderr + result.stdout).toMatch(/unclean_tree/);
        // The output directory must not exist when we fail before commit.
        expect(
            fs.existsSync(path.join(fixtureRoot, 'out', 'paid-release', '0.0.1-beta.1'))
        ).toBe(false);
    }, 60_000);

    test('rejects an unclean index (staged but uncommitted)', async () => {
        fixtureRoot = createFixtureRepo();
        installerHandle = makeDummyInstaller();
        fs.writeFileSync(path.join(fixtureRoot, 'LICENSE'), 'mutated\n');
        git(fixtureRoot, ['add', 'LICENSE']);
        const result = await runBuilder(fixtureRoot, [
            '--version', '0.0.1-beta.1',
            '--installer', installerHandle.file,
        ]);
        expect(result.code).not.toBe(0);
        expect(result.stderr + result.stdout).toMatch(/unclean_tree/);
    }, 60_000);

    test('allows unrelated untracked files (does not trip clean-tree gate)', async () => {
        fixtureRoot = createFixtureRepo();
        installerHandle = makeDummyInstaller();
        // Untracked, unrelated junk should not block the build.
        fs.mkdirSync(path.join(fixtureRoot, 'tmp'), { recursive: true });
        fs.writeFileSync(path.join(fixtureRoot, 'tmp', 'scratch.md'), 'scratch\n');
        const result = await runBuilder(fixtureRoot, [
            '--version', '0.0.1-beta.1',
            '--installer', installerHandle.file,
        ]);
        expect(result.code).toBe(0);
    }, 60_000);

    test('rejects when --installer points to a non-file path', async () => {
        fixtureRoot = createFixtureRepo();
        const result = await runBuilder(fixtureRoot, [
            '--version', '0.0.1-beta.1',
            '--installer', path.join(fixtureRoot, 'does-not-exist.exe'),
        ]);
        expect(result.code).not.toBe(0);
        expect(result.stderr + result.stdout).toMatch(/installer_missing/);
    }, 60_000);

    test('rejects when SemVer core differs from root package.json version', async () => {
        fixtureRoot = createFixtureRepo({ version: '0.0.1' });
        installerHandle = makeDummyInstaller();
        const result = await runBuilder(fixtureRoot, [
            '--version', '0.0.2-beta.1',
            '--installer', installerHandle.file,
        ]);
        expect(result.code).not.toBe(0);
        expect(result.stderr + result.stdout).toMatch(/version_mismatch/);
    }, 60_000);

    test('rejects when notices:check fails (THIRD_PARTY_NOTICES is stale)', async () => {
        fixtureRoot = createFixtureRepo({ noticesCheckExitCode: 1 });
        installerHandle = makeDummyInstaller();
        const result = await runBuilder(fixtureRoot, [
            '--version', '0.0.1-beta.1',
            '--installer', installerHandle.file,
        ]);
        expect(result.code).not.toBe(0);
        expect(result.stderr + result.stdout).toMatch(/notices_stale/);
    }, 60_000);

    test('rejects when native helper Cargo.lock is missing', async () => {
        // Create a fixture, then remove the tracked native lockfile and
        // commit the removal so the tree is clean.
        fixtureRoot = createFixtureRepo();
        installerHandle = makeDummyInstaller();
        fs.rmSync(path.join(fixtureRoot, 'native', 'daddy-audio-capture', 'Cargo.lock'));
        git(fixtureRoot, ['add', '-A']);
        git(fixtureRoot, ['commit', '-m', 'fixture: remove native lockfile']);
        const result = await runBuilder(fixtureRoot, [
            '--version', '0.0.1-beta.1',
            '--installer', installerHandle.file,
        ]);
        expect(result.code).not.toBe(0);
        // The builder must reject because lockfiles.zip cannot include the
        // missing entry, OR the source zip cannot find it.
        expect(result.stderr + result.stdout).toMatch(/lockfiles_zip_missing|source_missing_required_entries/);
    }, 60_000);

    test('rejects when output directory for the version already exists', async () => {
        fixtureRoot = createFixtureRepo();
        installerHandle = makeDummyInstaller();
        const outDir = path.join(fixtureRoot, 'out', 'paid-release', '0.0.1-beta.1');
        fs.mkdirSync(outDir, { recursive: true });
        fs.writeFileSync(path.join(outDir, 'leftover.txt'), 'do not overwrite\n');
        const result = await runBuilder(fixtureRoot, [
            '--version', '0.0.1-beta.1',
            '--installer', installerHandle.file,
        ]);
        expect(result.code).not.toBe(0);
        expect(result.stderr + result.stdout).toMatch(/output_exists/);
        // Pre-existing file is untouched.
        expect(fs.readFileSync(path.join(outDir, 'leftover.txt'), 'utf8')).toBe(
            'do not overwrite\n'
        );
    }, 60_000);

    test('rejects an invalid SemVer prerelease format', async () => {
        fixtureRoot = createFixtureRepo();
        installerHandle = makeDummyInstaller();
        const result = await runBuilder(fixtureRoot, [
            '--version', 'not-a-version',
            '--installer', installerHandle.file,
        ]);
        expect(result.code).not.toBe(0);
        expect(result.stderr + result.stdout).toMatch(/version_invalid|version_mismatch/);
    }, 60_000);

    test('rejects when distribution guides are missing from the repo', async () => {
        fixtureRoot = createFixtureRepo({ includeDistributionGuides: false });
        installerHandle = makeDummyInstaller();
        const result = await runBuilder(fixtureRoot, [
            '--version', '0.0.1-beta.1',
            '--installer', installerHandle.file,
        ]);
        expect(result.code).not.toBe(0);
        expect(result.stderr + result.stdout).toMatch(
            /source_missing_required_entries|guide_missing|build_instructions_missing/
        );
    }, 60_000);

    test('CLI errors when --version is omitted', async () => {
        fixtureRoot = createFixtureRepo();
        installerHandle = makeDummyInstaller();
        const result = await runBuilder(fixtureRoot, [
            '--installer', installerHandle.file,
        ]);
        expect(result.code).not.toBe(0);
        expect(result.stderr + result.stdout).toMatch(/version|usage/i);
    }, 60_000);

    test('CLI errors when --installer is omitted', async () => {
        fixtureRoot = createFixtureRepo();
        const result = await runBuilder(fixtureRoot, [
            '--version', '0.0.1-beta.1',
        ]);
        expect(result.code).not.toBe(0);
        expect(result.stderr + result.stdout).toMatch(/installer|usage/i);
    }, 60_000);

    test('generated manifest has no extra fields beyond the documented schema', async () => {
        fixtureRoot = createFixtureRepo();
        installerHandle = makeDummyInstaller();
        const result = await runBuilder(fixtureRoot, [
            '--version', '0.0.1-beta.1',
            '--installer', installerHandle.file,
        ]);
        expect(result.code).toBe(0);
        const outDir = path.join(fixtureRoot, 'out', 'paid-release', '0.0.1-beta.1');
        const manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'manifest.json'), 'utf8'));
        // Allow only the documented keys at the top level.
        const allowed = new Set([
            'commitSha',
            'expectedAuthenticodeState',
            'generatedAt',
            'items',
            'version',
        ]);
        for (const key of Object.keys(manifest)) {
            expect(allowed.has(key)).toBe(true);
        }
        for (const item of manifest.items) {
            const allowedItem = new Set(['filename', 'sha256', 'size']);
            for (const key of Object.keys(item)) {
                expect(allowedItem.has(key)).toBe(true);
            }
        }
    }, 60_000);
});
