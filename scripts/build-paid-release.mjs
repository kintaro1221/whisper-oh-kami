#!/usr/bin/env node
//
// build-paid-release.mjs — deterministic paid-release bundle builder.
//
// What this script writes:
//   out/paid-release/<version>/
//     ├── installer.exe                 (copy of --installer)
//     ├── source.zip                    (git archive HEAD, all tracked files
//     │                                  minus .gitattributes export-ignore
//     │                                  paths — buyer-facing product source
//     │                                  only, no internal ops/lp/ docs)
//     ├── lockfiles.zip                 (git archive HEAD, two lockfiles)
//     ├── LICENSE                       (copy of repo root LICENSE)
//     ├── THIRD_PARTY_NOTICES.md        (copy of repo root notices)
//     ├── guide.md                      (Windows install guide for the buyer)
//     ├── build-instructions.md         (build-from-source for the buyer)
//     ├── manifest.json                 (key-sorted, item-sorted; also carries
//     │                                  installerBuiltFromSha /
//     │                                  installerBuiltAtUtc — see below)
//     └── manifest.json.sha256          (operator pastes into D1.manifest_sha256)
//
// Determinism guarantees (audited by paidReleaseBundle.test.js):
//   * Manifest top-level keys and `items[]` are alphabetically sorted.
//   * `generatedAt` is the HEAD commit's `%cI` (committer ISO timestamp),
//     NOT wall-clock time.
//   * `commitSha` is `git rev-parse HEAD`.
//   * SHA-256 hashes are lowercase hex; sizes are byte lengths.
//   * `expectedAuthenticodeState` is the literal string `unsigned-beta`; the
//     operator must change this to `signed` only after wiring up a real
//     Authenticode signing pipeline.
//   * `installerBuiltFromSha` / `installerBuiltAtUtc` come from
//     out/build-info.json (written by forge.config.js's `hooks.postMake` at
//     `npm run make` time) and prove --installer was actually built from the
//     current HEAD — see the build_info_* gates below.
//
// Fail-closed gates (stable error codes printed on stderr for the operator's
// runbook to grep):
//   * version_invalid       — --version is not a parseable SemVer.
//   * version_mismatch      — SemVer core differs from root package.json.
//   * installer_missing     — --installer path is not a file.
//   * unclean_tree          — git diff / git diff --cached is non-empty.
//   * build_info_missing    — out/build-info.json does not exist. Run
//     `npm run make` first (its postMake hook writes this file).
//   * build_info_invalid    — out/build-info.json is not valid JSON, is
//     missing a required field, or a field fails its schema check (commitSha
//     is not 40 lowercase hex chars, version is not a non-empty string,
//     builtAtUtc does not parse as a date, treeDirty is not a boolean,
//     installerSha256 is not 64 lowercase hex chars, or installerSize is not
//     a positive integer).
//   * build_info_commit_mismatch — out/build-info.json's commitSha differs
//     from the current HEAD. --installer was built from a different commit
//     than the one source.zip is archived from (e.g. a commit landed between
//     `npm run make` and `npm run paid-release`). Re-run `npm run make` at
//     the release commit.
//   * build_info_version_mismatch — out/build-info.json's version differs
//     from root package.json's version.
//   * build_info_installer_mismatch — the SHA-256/size actually measured on
//     the `--installer` file differ from out/build-info.json's
//     installerSha256/installerSize. Without this check, --installer accepts
//     an arbitrary file path and nothing would stop packaging a file that was
//     never the Setup.exe built at `npm run make` time. Re-run `npm run make`
//     and point `--installer` at the fresh Setup.exe it produced.
//   * build_info_tree_dirty — out/build-info.json recorded a dirty tracked
//     tree at `npm run make` time. The installer may not match any commit at
//     all; re-run `npm run make` on a clean tree.
//   * notices_stale         — `npm run notices:check` exited non-zero.
//   * output_exists         — out/paid-release/<version>/ already exists.
//   * source_missing_required_entries — git archive of HEAD did not include
//     one of LICENSE / THIRD_PARTY_NOTICES.md / both distribution guides /
//     one of the two lockfiles.
//   * source_contains_excluded_entries — git archive of HEAD included a path
//     that must never reach a buyer (internal handoff/ops docs, the lp/
//     payment-infrastructure source, etc. — see EXCLUDED_SOURCE_PREFIXES).
//     This means .gitattributes export-ignore regressed or a new internal
//     path was added without an export-ignore entry; fix .gitattributes,
//     do not weaken this gate.
//   * lockfiles_zip_missing — lockfiles.zip is missing one of the two.
//   * license_mismatch      — copied LICENSE bytes differ from root.
//   * notices_mismatch      — copied THIRD_PARTY_NOTICES.md bytes differ.
//   * lockfile_entry_mismatch — a lockfiles.zip entry's bytes differ from
//     the tracked lockfile on disk.
//   * guide_missing / build_instructions_missing — the buyer guides are not
//     present at the expected paths under docs/distribution/.
//
// Why no external npm dependencies:
//   * This is a release-time tool that ships nothing to the buyer; we use
//     only Node 22.12+ built-ins + `git archive` shell-outs. The fewer
//     supply-chain surfaces, the better.
//
// Why we never bypass the clean-tree gate:
//   * A release bundle whose `commitSha` does not represent the actual
//     contents would let an operator ship a hotfix that the public source
//     zip does not contain — and that would violate GPL Corresponding
//     Source. The gate also stops a hand-edited THIRD_PARTY_NOTICES.md from
//     escaping the notices:check.
//
// Cleanup behaviour:
//   * Any failure after the output directory has been created removes the
//     incomplete directory recursively (`finally` block). The operator can
//     re-run the builder immediately without manual cleanup.

import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import path from 'node:path';
import zlib from 'node:zlib';

// We do not need a require() shim for any external module; the zlib import
// above suffices. createRequire is imported only to keep the file's intent
// (Node built-ins only, no npm) auditable at the top.
void createRequire;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REQUIRED_LOCKFILES = ['package-lock.json', 'native/daddy-audio-capture/Cargo.lock'];

const REQUIRED_SOURCE_ENTRIES = [
    'LICENSE',
    'THIRD_PARTY_NOTICES.md',
    ...REQUIRED_LOCKFILES,
    'docs/distribution/windows-install-guide.md',
    'docs/distribution/build-from-source.md',
];

// Internal-only paths that must NEVER appear in source.zip. These mirror the
// export-ignore entries in .gitattributes (which is what actually keeps them
// out of `git archive`'s output); this gate exists so a regression in
// .gitattributes — or a future internal file added without an export-ignore
// entry — fails the release build instead of silently shipping to a buyer.
// Prefixes ending in `/` match a directory and everything under it; entries
// without a trailing `/` match a single file (exact name, or for the
// HANDOFF_* case, a fixed prefix + suffix pattern handled specially below).
const EXCLUDED_SOURCE_PREFIXES = [
    'GATE1_PRE_MEETING.md',
    'AGENTS.md',
    'CLAUDE.md',
    '.claude/',
    'start.bat',
    'start-hidden.vbs',
    'docs/operations/',
    'docs/superpowers/',
    'docs/decisions/',
    'docs/legal/REVIEW-NOTES.md',
    // Free-phase exclusions (2026-10-03): sales-only disclosures + internal
    // legal index, and the tests that read export-ignored trees.
    'docs/legal/tokushoho.md',
    'docs/legal/terms-and-sales.md',
    'docs/legal/README.md',
    'tests/unit/paidBetaLpContract.test.js',
    'tests/unit/paidCloudflareConfig.test.js',
    'tests/unit/paidLegalContract.test.js',
    'tests/unit/paidReleaseBundle.test.js',
    'lp/',
];

// HANDOFF_2026-05-*.md is a glob, not a fixed name; matched separately.
const EXCLUDED_SOURCE_GLOB_RE = /^HANDOFF_2026-05-.*\.md$/;

const GUIDE_REL_PATH = 'docs/distribution/windows-install-guide.md';
const BUILD_INSTRUCTIONS_REL_PATH = 'docs/distribution/build-from-source.md';
const BUILD_INFO_REL_PATH = 'out/build-info.json';
const BUILD_INFO_REQUIRED_FIELDS = ['commitSha', 'version', 'builtAtUtc', 'treeDirty', 'installerSha256', 'installerSize'];

// commitSha: full 40-char lowercase hex git SHA-1.
const COMMIT_SHA_RE = /^[0-9a-f]{40}$/;
// installerSha256: lowercase hex SHA-256 digest (64 chars).
const SHA256_HEX_RE = /^[0-9a-f]{64}$/;
// Exact shape of Date.prototype.toISOString() output (what postMake writes).
const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const MANIFEST_FILENAME = 'manifest.json';
const MANIFEST_SHA_FILENAME = 'manifest.json.sha256';
const EXPECTED_AUTHENTICODE_STATE = 'unsigned-beta';

// SemVer 2.0.0 with the optional prerelease/build metadata suffixes. We
// extract group 1 as the core (MAJOR.MINOR.PATCH) so we can compare it
// against the root package.json version.
const SEMVER_RE =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

// ---------------------------------------------------------------------------
// Fatal error helper
// ---------------------------------------------------------------------------

class BuildError extends Error {
    constructor(code, message) {
        super(`${code}: ${message}`);
        this.code = code;
    }
}

function fail(code, message) {
    throw new BuildError(code, message);
}

// ---------------------------------------------------------------------------
// Subprocess helper. We use spawnSync with `shell: false` so untrusted
// argument values (paths, version strings) can never invoke a sub-shell.
// ---------------------------------------------------------------------------

function run(cmd, args, opts = {}) {
    const result = spawnSync(cmd, args, {
        cwd: opts.cwd,
        env: opts.env,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        shell: false,
    });
    return {
        status: result.status,
        signal: result.signal,
        stdout: result.stdout || '',
        stderr: result.stderr || '',
        error: result.error,
    };
}

function spawnNpm(args, opts) {
    // On Windows, npm is `npm.cmd`. spawnSync with shell:false cannot run
    // `.cmd` files reliably across Node versions, so on Windows we shell out
    // through cmd.exe with the /d /s /c sequence (matches Node's own
    // node:child_process behaviour internally). We only ever pass our own
    // hardcoded args here; the operator/test author cannot inject through
    // this code path.
    if (process.platform === 'win32') {
        const cmdline = ['/d', '/s', '/c', 'npm', ...args];
        return spawnSync('cmd.exe', cmdline, {
            cwd: opts.cwd,
            env: opts.env,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
            shell: false,
            windowsVerbatimArguments: false,
        });
    }
    return spawnSync('npm', args, {
        cwd: opts.cwd,
        env: opts.env,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        shell: false,
    });
}

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
    const out = {};
    for (let i = 0; i < argv.length; i++) {
        const flag = argv[i];
        if (flag === '--version') {
            out.version = argv[++i];
        } else if (flag === '--installer') {
            out.installer = argv[++i];
        } else if (flag === '--output') {
            out.output = argv[++i];
        } else if (flag === '--help' || flag === '-h') {
            out.help = true;
        } else {
            fail('usage', `Unknown argument: ${flag}\nUsage: node scripts/build-paid-release.mjs --version <semver> --installer <path>`);
        }
    }
    if (!out.version) {
        fail('usage', 'Missing required --version flag.\nUsage: node scripts/build-paid-release.mjs --version <semver> --installer <path>');
    }
    if (!out.installer) {
        fail('usage', 'Missing required --installer flag.\nUsage: node scripts/build-paid-release.mjs --version <semver> --installer <path>');
    }
    return out;
}

// ---------------------------------------------------------------------------
// SemVer helpers
// ---------------------------------------------------------------------------

function parseSemver(version) {
    const match = SEMVER_RE.exec(version);
    if (!match) return null;
    const [, major, minor, patch, prerelease, build] = match;
    return {
        core: `${major}.${minor}.${patch}`,
        major,
        minor,
        patch,
        prerelease: prerelease || null,
        build: build || null,
    };
}

// ---------------------------------------------------------------------------
// Repo state helpers
// ---------------------------------------------------------------------------

async function readRootPackageJson(repoRoot) {
    const raw = await readFile(path.join(repoRoot, 'package.json'), 'utf8');
    try {
        return JSON.parse(raw);
    } catch (err) {
        fail('package_json_invalid', `Could not parse package.json: ${err.message}`);
    }
}

function assertCleanTree(repoRoot) {
    // `git diff --quiet` exits 0 if clean, 1 if dirty, 128 on error.
    for (const flags of [
        ['diff', '--quiet'],
        ['diff', '--cached', '--quiet'],
    ]) {
        const result = run('git', flags, { cwd: repoRoot });
        if (result.status === 0) continue;
        if (result.status === 1) {
            fail('unclean_tree', 'Working tree or index has uncommitted changes. Commit or stash before releasing.');
        }
        fail('unclean_tree', `git ${flags.join(' ')} failed (status ${result.status}, signal ${result.signal}): ${result.stderr.trim()}`);
    }
}

function getCommitSha(repoRoot) {
    const r = run('git', ['rev-parse', 'HEAD'], { cwd: repoRoot });
    if (r.status !== 0) {
        fail('git_unavailable', `git rev-parse HEAD failed: ${r.stderr.trim()}`);
    }
    return r.stdout.trim();
}

function getCommitIsoTimestamp(repoRoot) {
    // %cI = strict ISO-8601 committer date in UTC offset notation.
    const r = run('git', ['show', '-s', '--format=%cI', 'HEAD'], { cwd: repoRoot });
    if (r.status !== 0) {
        fail('git_unavailable', `git show HEAD failed: ${r.stderr.trim()}`);
    }
    return r.stdout.trim();
}

// ---------------------------------------------------------------------------
// out/build-info.json: proves --installer was built from the commit whose
// source.zip we are about to archive. Written by forge.config.js's
// `hooks.postMake` at `npm run make` time; read-only here.
// ---------------------------------------------------------------------------

async function readBuildInfo(repoRoot) {
    const buildInfoPath = path.join(repoRoot, BUILD_INFO_REL_PATH);
    if (!existsSync(buildInfoPath)) {
        fail(
            'build_info_missing',
            `${BUILD_INFO_REL_PATH} not found. Run "npm run make" first — its postMake ` +
                'hook writes this file, and it is the only proof that --installer was ' +
                'built from the current commit.'
        );
    }
    let raw;
    try {
        raw = await readFile(buildInfoPath, 'utf8');
    } catch (err) {
        fail('build_info_missing', `Could not read ${BUILD_INFO_REL_PATH}: ${err.message}`);
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (err) {
        fail('build_info_invalid', `${BUILD_INFO_REL_PATH} is not valid JSON: ${err.message}`);
    }
    for (const field of BUILD_INFO_REQUIRED_FIELDS) {
        if (!(field in parsed)) {
            fail('build_info_invalid', `${BUILD_INFO_REL_PATH} is missing required field "${field}".`);
        }
    }
    // Schema validation beyond mere key presence: a field of the wrong type
    // (e.g. treeDirty as the string "true") must not silently pass through
    // to the semantic checks below, several of which only guard against the
    // literal value `true` and would let a truthy-but-non-boolean value
    // slip past.
    if (typeof parsed.commitSha !== 'string' || !COMMIT_SHA_RE.test(parsed.commitSha)) {
        fail('build_info_invalid', `${BUILD_INFO_REL_PATH} field "commitSha" must be a 40-character lowercase hex string.`);
    }
    if (typeof parsed.version !== 'string' || parsed.version.length === 0) {
        fail('build_info_invalid', `${BUILD_INFO_REL_PATH} field "version" must be a non-empty string.`);
    }
    // Date.parse() alone is NOT ISO validation — it happily accepts
    // "August 30, 2026", "08/30/2026", and "0". Require the exact UTC
    // shape postMake writes (toISOString output) plus a round-trip so
    // impossible dates like 2026-13-45 are rejected too.
    const builtAtDate = typeof parsed.builtAtUtc === 'string' ? new Date(parsed.builtAtUtc) : null;
    if (
        typeof parsed.builtAtUtc !== 'string' ||
        !ISO_UTC_RE.test(parsed.builtAtUtc) ||
        Number.isNaN(builtAtDate.getTime()) ||
        builtAtDate.toISOString() !== parsed.builtAtUtc
    ) {
        fail('build_info_invalid', `${BUILD_INFO_REL_PATH} field "builtAtUtc" must be a UTC ISO 8601 string of the form YYYY-MM-DDTHH:mm:ss.sssZ.`);
    }
    if (typeof parsed.treeDirty !== 'boolean') {
        fail('build_info_invalid', `${BUILD_INFO_REL_PATH} field "treeDirty" must be a boolean.`);
    }
    if (typeof parsed.installerSha256 !== 'string' || !SHA256_HEX_RE.test(parsed.installerSha256)) {
        fail('build_info_invalid', `${BUILD_INFO_REL_PATH} field "installerSha256" must be a 64-character lowercase hex string.`);
    }
    if (!Number.isInteger(parsed.installerSize) || parsed.installerSize <= 0) {
        fail('build_info_invalid', `${BUILD_INFO_REL_PATH} field "installerSize" must be a positive integer.`);
    }
    return parsed;
}

function assertBuildInfoMatches(buildInfo, { commitSha, packageVersion }) {
    if (buildInfo.commitSha !== commitSha) {
        fail(
            'build_info_commit_mismatch',
            `${BUILD_INFO_REL_PATH} commitSha (${buildInfo.commitSha}) does not match the ` +
                `current HEAD (${commitSha}). A commit landed between "npm run make" and ` +
                '"npm run paid-release" (or the installer was built elsewhere) — re-run ' +
                '"npm run make" at the release commit before packaging.'
        );
    }
    if (buildInfo.version !== packageVersion) {
        fail(
            'build_info_version_mismatch',
            `${BUILD_INFO_REL_PATH} version (${buildInfo.version}) does not match root ` +
                `package.json version (${packageVersion}). Re-run "npm run make" after bumping ` +
                'the version.'
        );
    }
    if (buildInfo.treeDirty === true) {
        fail(
            'build_info_tree_dirty',
            `${BUILD_INFO_REL_PATH} recorded a dirty tracked working tree at "npm run make" ` +
                'time, so the installer may not correspond to any single commit. Commit or ' +
                'stash, then re-run "npm run make".'
        );
    }
}

// Confirms the file passed via --installer is actually the Setup.exe that
// forge.config.js's postMake hook hashed into out/build-info.json. Without
// this, --installer accepts an arbitrary file path — even a 1 KB dummy —
// and only the commit/version *metadata* in build-info.json (not the
// installer bytes) would be checked.
async function assertInstallerMatchesBuildInfo(buildInfo, installerPath, installerSize) {
    if (installerSize !== buildInfo.installerSize) {
        fail(
            'build_info_installer_mismatch',
            `--installer file size (${installerSize}) does not match ${BUILD_INFO_REL_PATH} ` +
                `installerSize (${buildInfo.installerSize}). The file passed to --installer is not ` +
                'the Setup.exe that "npm run make" produced for this commit.'
        );
    }
    const actualSha256 = await sha256File(installerPath);
    if (actualSha256 !== buildInfo.installerSha256) {
        fail(
            'build_info_installer_mismatch',
            `--installer file SHA-256 (${actualSha256}) does not match ${BUILD_INFO_REL_PATH} ` +
                `installerSha256 (${buildInfo.installerSha256}). The file passed to --installer is not ` +
                'the Setup.exe that "npm run make" produced for this commit. Re-run "npm run make" ' +
                'and pass the fresh Setup.exe.'
        );
    }
}

async function runNoticesCheck(repoRoot) {
    const r = spawnNpm(['run', 'notices:check'], { cwd: repoRoot, env: process.env });
    if (r.status !== 0) {
        const stderr = (r.stderr || '').toString().trim();
        const stdout = (r.stdout || '').toString().trim();
        fail(
            'notices_stale',
            `npm run notices:check failed (status ${r.status}). Regenerate THIRD_PARTY_NOTICES.md and commit before releasing.\n${stderr}\n${stdout}`
        );
    }
}

// ---------------------------------------------------------------------------
// git archive helpers
// ---------------------------------------------------------------------------

function gitArchiveSource(repoRoot, version, outputPath) {
    const prefix = `whisper-oh-kami-${version}/`;
    const r = run('git', ['archive', '--format=zip', `--prefix=${prefix}`, '-o', outputPath, 'HEAD'], { cwd: repoRoot });
    if (r.status !== 0) {
        fail('git_archive_failed', `git archive of source failed: ${r.stderr.trim() || r.stdout.trim()}`);
    }
}

function gitArchiveLockfiles(repoRoot, version, outputPath) {
    const prefix = `lockfiles-${version}/`;
    const r = run('git', ['archive', '--format=zip', `--prefix=${prefix}`, '-o', outputPath, 'HEAD', '--', ...REQUIRED_LOCKFILES], { cwd: repoRoot });
    if (r.status !== 0) {
        fail('lockfiles_zip_missing', `git archive of lockfiles failed. Are both lockfiles tracked at HEAD?\n${r.stderr.trim() || r.stdout.trim()}`);
    }
}

// ---------------------------------------------------------------------------
// ZIP central-directory reader. We need the entry list (and per-entry byte
// length) without taking an external dependency. The reader implements just
// enough of the ZIP spec (APPNOTE.TXT) to inspect what `git archive` writes:
// no Zip64, no encryption, no spanning. If git ever switches output mode we
// will need to revisit; for now this is the leanest reliable parser.
// ---------------------------------------------------------------------------

async function readZipEntries(zipPath) {
    const buf = await readFile(zipPath);
    let eocdOffset = -1;
    const minEocd = 22;
    for (let i = buf.length - minEocd; i >= 0; i--) {
        if (buf.readUInt32LE(i) === 0x06054b50) {
            eocdOffset = i;
            break;
        }
    }
    if (eocdOffset < 0) {
        fail('zip_corrupt', `No EOCD record in ${zipPath}`);
    }
    const totalEntries = buf.readUInt16LE(eocdOffset + 10);
    const centralDirOffset = buf.readUInt32LE(eocdOffset + 16);
    const entries = [];
    let cur = centralDirOffset;
    for (let i = 0; i < totalEntries; i++) {
        if (buf.readUInt32LE(cur) !== 0x02014b50) {
            fail('zip_corrupt', `Bad CDH signature at offset ${cur} in ${zipPath}`);
        }
        const compressionMethod = buf.readUInt16LE(cur + 10);
        const compressedSize = buf.readUInt32LE(cur + 20);
        const uncompressedSize = buf.readUInt32LE(cur + 24);
        const fileNameLen = buf.readUInt16LE(cur + 28);
        const extraLen = buf.readUInt16LE(cur + 30);
        const commentLen = buf.readUInt16LE(cur + 32);
        const localHeaderOffset = buf.readUInt32LE(cur + 42);
        const name = buf.slice(cur + 46, cur + 46 + fileNameLen).toString('utf8');
        entries.push({
            name,
            compressionMethod,
            compressedSize,
            uncompressedSize,
            localHeaderOffset,
        });
        cur += 46 + fileNameLen + extraLen + commentLen;
    }
    return { buf, entries };
}

function extractZipEntry(zipBuf, entry) {
    // Local file header signature 0x04034b50. fileName length and extra
    // length at this point are usually duplicates of the CDH but the spec
    // allows them to differ, so we read from the local header.
    const off = entry.localHeaderOffset;
    if (zipBuf.readUInt32LE(off) !== 0x04034b50) {
        fail('zip_corrupt', `Bad LFH signature at offset ${off}`);
    }
    const compressionMethod = zipBuf.readUInt16LE(off + 8);
    const compressedSize = zipBuf.readUInt32LE(off + 18);
    const fileNameLen = zipBuf.readUInt16LE(off + 26);
    const extraLen = zipBuf.readUInt16LE(off + 28);
    const dataStart = off + 30 + fileNameLen + extraLen;
    const dataEnd = dataStart + compressedSize;
    const data = zipBuf.slice(dataStart, dataEnd);
    if (compressionMethod === 0) {
        return data; // stored
    }
    if (compressionMethod === 8) {
        // deflate (raw, no zlib header)
        return zlib.inflateRawSync(data);
    }
    fail('zip_corrupt', `Unsupported zip compression method ${compressionMethod} for entry ${entry.name}`);
}

// ---------------------------------------------------------------------------
// SHA-256 + size + copy helpers
// ---------------------------------------------------------------------------

async function sha256File(filePath) {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    for await (const chunk of stream) {
        hash.update(chunk);
    }
    return hash.digest('hex');
}

function sha256Buffer(buf) {
    return createHash('sha256').update(buf).digest('hex');
}

async function fileSize(filePath) {
    const s = await stat(filePath);
    return s.size;
}

async function copyFileStream(srcPath, destPath) {
    await mkdir(path.dirname(destPath), { recursive: true });
    await new Promise((resolve, reject) => {
        const src = createReadStream(srcPath);
        const dest = createWriteStream(destPath);
        src.on('error', reject);
        dest.on('error', reject);
        dest.on('finish', resolve);
        src.pipe(dest);
    });
}

// ---------------------------------------------------------------------------
// Deterministic JSON stringify (sort keys at every level)
// ---------------------------------------------------------------------------

function sortKeysDeep(value) {
    if (Array.isArray(value)) return value.map(sortKeysDeep);
    if (value && typeof value === 'object') {
        const out = {};
        for (const key of Object.keys(value).sort()) {
            out[key] = sortKeysDeep(value[key]);
        }
        return out;
    }
    return value;
}

function stringifyDeterministic(value) {
    return JSON.stringify(sortKeysDeep(value), null, 2) + '\n';
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

async function main() {
    const args = parseArgs(process.argv.slice(2));

    // Resolve the repository root: prefer `git rev-parse --show-toplevel`
    // (so an operator running the script from a subdirectory still works,
    // and so the test harness can run the script from a fixture repo). Fall
    // back to two-up from the script path when git is unavailable.
    let repoRoot;
    const toplevel = run('git', ['rev-parse', '--show-toplevel'], { cwd: process.cwd() });
    if (toplevel.status === 0) {
        repoRoot = toplevel.stdout.trim();
    } else {
        const scriptDir = path.dirname(fileURLToPath(import.meta.url));
        repoRoot = path.resolve(scriptDir, '..');
    }

    // --- argument validation
    const semver = parseSemver(args.version);
    if (!semver) {
        fail('version_invalid', `--version "${args.version}" is not a parseable SemVer string.`);
    }

    const installerPath = path.resolve(repoRoot, args.installer);
    let installerStat;
    try {
        installerStat = await stat(installerPath);
    } catch {
        fail('installer_missing', `Installer not found at ${installerPath}.`);
    }
    if (!installerStat.isFile()) {
        fail('installer_missing', `Installer path ${installerPath} is not a regular file.`);
    }

    const rootPkg = await readRootPackageJson(repoRoot);
    if (semver.core !== rootPkg.version) {
        fail('version_mismatch', `--version core (${semver.core}) does not equal root package.json version (${rootPkg.version}).`);
    }

    // --- clean tree gate (allows untracked files; rejects modified tracked
    //                     files or staged changes)
    assertCleanTree(repoRoot);

    // --- pull commit metadata for deterministic manifest fields
    const commitSha = getCommitSha(repoRoot);
    const generatedAt = getCommitIsoTimestamp(repoRoot);

    // --- installer↔source provenance gate: out/build-info.json (written by
    // forge.config.js's postMake hook at `npm run make` time) must exist,
    // must record the current HEAD commit and package.json version, and must
    // not have been produced on a dirty tracked tree. Without this, nothing
    // stops an operator from packaging installer.exe alongside a source.zip
    // for a commit the installer was never actually built from.
    const buildInfo = await readBuildInfo(repoRoot);
    assertBuildInfoMatches(buildInfo, { commitSha, packageVersion: rootPkg.version });

    // --- installer↔build-info provenance gate: the actual --installer file's
    // SHA-256 + size must equal what forge.config.js's postMake hook
    // recorded for the real Setup.exe. This is what stops an arbitrary file
    // (even one that happens to satisfy the commit/version checks above)
    // from being packaged as installer.exe.
    await assertInstallerMatchesBuildInfo(buildInfo, installerPath, installerStat.size);

    // --- notices:check (THIRD_PARTY_NOTICES.md must be current)
    await runNoticesCheck(repoRoot);

    // --- determine output directory; refuse to overwrite
    const outDir = args.output ? path.resolve(args.output) : path.join(repoRoot, 'out', 'paid-release', args.version);
    if (existsSync(outDir)) {
        fail('output_exists', `Output directory ${outDir} already exists. Move or delete it before re-running.`);
    }

    let outDirCreated = false;
    try {
        await mkdir(outDir, { recursive: true });
        outDirCreated = true;

        // --- source.zip
        const sourceZipPath = path.join(outDir, 'source.zip');
        gitArchiveSource(repoRoot, args.version, sourceZipPath);
        const sourceZip = await readZipEntries(sourceZipPath);
        const sourcePrefixCheck = `whisper-oh-kami-${args.version}/`;
        const sourceNames = new Set(sourceZip.entries.map(e => e.name));
        for (const required of REQUIRED_SOURCE_ENTRIES) {
            if (!sourceNames.has(`${sourcePrefixCheck}${required}`)) {
                fail(
                    'source_missing_required_entries',
                    `source.zip is missing required tracked file ${required} (expected entry ${sourcePrefixCheck}${required}).`
                );
            }
        }

        // --- fail-closed: source.zip must NEVER contain internal-only paths.
        // We strip the `<prefix>/` from every entry name and test the
        // remainder against EXCLUDED_SOURCE_PREFIXES / the HANDOFF_* glob.
        // This catches a regressed or missing .gitattributes export-ignore
        // entry before a buyer ever sees the bundle.
        for (const name of sourceNames) {
            if (!name.startsWith(sourcePrefixCheck)) continue;
            const rel = name.slice(sourcePrefixCheck.length);
            if (rel === '') continue; // the prefix directory entry itself
            const isExcluded =
                EXCLUDED_SOURCE_GLOB_RE.test(rel) ||
                EXCLUDED_SOURCE_PREFIXES.some(prefix => rel === prefix || (prefix.endsWith('/') && rel.startsWith(prefix)));
            if (isExcluded) {
                fail(
                    'source_contains_excluded_entries',
                    `source.zip contains excluded internal path ${rel}. Check .gitattributes export-ignore entries.`
                );
            }
        }

        // --- lockfiles.zip
        const lockfilesZipPath = path.join(outDir, 'lockfiles.zip');
        const lockfilesPrefix = `lockfiles-${args.version}/`;
        gitArchiveLockfiles(repoRoot, args.version, lockfilesZipPath);
        const lockZip = await readZipEntries(lockfilesZipPath);
        // We need exact-path matching against the prefix, NOT endsWith —
        // even with only two lockfiles today, a future third lockfile nested
        // under a subdirectory could otherwise collide on a shared
        // `package-lock.json` / `Cargo.lock` suffix.
        for (const required of REQUIRED_LOCKFILES) {
            const expectedName = `${lockfilesPrefix}${required}`;
            const found = lockZip.entries.some(e => e.name === expectedName);
            if (!found) {
                fail('lockfiles_zip_missing', `lockfiles.zip is missing required lockfile ${required} (expected entry ${expectedName}).`);
            }
        }
        // Cross-check that every lockfiles.zip entry's bytes equal the same
        // path's bytes in source.zip. This is a defence-in-depth audit that
        // both zips agree (we built them from the same HEAD via two
        // `git archive` invocations) without depending on the working-tree
        // EOL state, which differs from `git archive` output when
        // core.autocrlf is on.
        const sourcePrefix = `whisper-oh-kami-${args.version}/`;
        for (const required of REQUIRED_LOCKFILES) {
            const lockEntry = lockZip.entries.find(e => e.name === `${lockfilesPrefix}${required}`);
            if (!lockEntry) continue; // already failed above
            const sourceEntry = sourceZip.entries.find(e => e.name === `${sourcePrefix}${required}`);
            if (!sourceEntry) {
                fail('lockfile_entry_mismatch', `source.zip is missing ${sourcePrefix}${required}, so lockfiles.zip cannot be cross-verified.`);
            }
            const lockBytes = extractZipEntry(lockZip.buf, lockEntry);
            const sourceBytes = extractZipEntry(sourceZip.buf, sourceEntry);
            if (!lockBytes.equals(sourceBytes)) {
                fail(
                    'lockfile_entry_mismatch',
                    `lockfiles.zip and source.zip disagree on ${required} (lockfiles=${lockBytes.length} source=${sourceBytes.length}).`
                );
            }
        }

        // --- installer copy + post-copy revalidation. The source Setup.exe
        // was validated against build-info.json much earlier (before the
        // notices check and ZIP generation), so a concurrent `npm run make`
        // could have rewritten it in between — a TOCTOU window where
        // unverified bytes land in the bundle. Hash the COPIED file and
        // require it to still match build-info, so whatever actually ships
        // is what was verified.
        const installerDest = path.join(outDir, 'installer.exe');
        await copyFileStream(installerPath, installerDest);
        const installerDestSha256 = await sha256File(installerDest);
        const installerDestSize = (await stat(installerDest)).size;
        if (installerDestSha256 !== buildInfo.installerSha256 || installerDestSize !== buildInfo.installerSize) {
            fail(
                'build_info_installer_mismatch',
                `Copied installer.exe (sha256=${installerDestSha256}, size=${installerDestSize}) no longer matches ` +
                    `build-info.json (sha256=${buildInfo.installerSha256}, size=${buildInfo.installerSize}). ` +
                    'The Setup.exe changed between validation and copy — rerun "npm run make" and retry without concurrent builds.'
            );
        }

        // --- LICENSE copy + verify
        const licenseSrc = path.join(repoRoot, 'LICENSE');
        const licenseDest = path.join(outDir, 'LICENSE');
        await copyFileStream(licenseSrc, licenseDest);
        const licenseSrcHash = await sha256File(licenseSrc);
        const licenseDestHash = await sha256File(licenseDest);
        if (licenseSrcHash !== licenseDestHash) {
            fail('license_mismatch', `Copied LICENSE hash ${licenseDestHash} does not match root ${licenseSrcHash}.`);
        }

        // --- THIRD_PARTY_NOTICES copy + verify
        const noticesSrc = path.join(repoRoot, 'THIRD_PARTY_NOTICES.md');
        const noticesDest = path.join(outDir, 'THIRD_PARTY_NOTICES.md');
        await copyFileStream(noticesSrc, noticesDest);
        const noticesSrcHash = await sha256File(noticesSrc);
        const noticesDestHash = await sha256File(noticesDest);
        if (noticesSrcHash !== noticesDestHash) {
            fail('notices_mismatch', `Copied THIRD_PARTY_NOTICES.md hash ${noticesDestHash} does not match root ${noticesSrcHash}.`);
        }

        // --- guide + build-instructions copies
        const guideSrc = path.join(repoRoot, GUIDE_REL_PATH);
        if (!existsSync(guideSrc)) {
            fail('guide_missing', `Distribution guide not found at ${GUIDE_REL_PATH}.`);
        }
        await copyFileStream(guideSrc, path.join(outDir, 'guide.md'));

        const buildInstrSrc = path.join(repoRoot, BUILD_INSTRUCTIONS_REL_PATH);
        if (!existsSync(buildInstrSrc)) {
            fail('build_instructions_missing', `Build instructions not found at ${BUILD_INSTRUCTIONS_REL_PATH}.`);
        }
        await copyFileStream(buildInstrSrc, path.join(outDir, 'build-instructions.md'));

        // --- Compute manifest items (every output file except manifest.json
        //     itself + manifest.json.sha256).
        const manifestItems = [];
        for (const filename of [
            'LICENSE',
            'THIRD_PARTY_NOTICES.md',
            'build-instructions.md',
            'guide.md',
            'installer.exe',
            'lockfiles.zip',
            'source.zip',
        ]) {
            const full = path.join(outDir, filename);
            const sha = await sha256File(full);
            const size = await fileSize(full);
            manifestItems.push({ filename, sha256: sha, size });
        }
        manifestItems.sort((a, b) => (a.filename < b.filename ? -1 : a.filename > b.filename ? 1 : 0));

        const manifest = {
            commitSha,
            expectedAuthenticodeState: EXPECTED_AUTHENTICODE_STATE,
            generatedAt,
            installerBuiltAtUtc: buildInfo.builtAtUtc,
            installerBuiltFromSha: buildInfo.commitSha,
            items: manifestItems,
            version: args.version,
        };

        const manifestText = stringifyDeterministic(manifest);
        await writeFile(path.join(outDir, MANIFEST_FILENAME), manifestText, 'utf8');

        const manifestSha = sha256Buffer(Buffer.from(manifestText, 'utf8'));
        await writeFile(path.join(outDir, MANIFEST_SHA_FILENAME), `${manifestSha}  ${MANIFEST_FILENAME}\n`, 'utf8');

        // --- summary (no PII, no secrets)
        console.log(`paid-release: wrote ${outDir}`);
        console.log(`  version=${args.version}`);
        console.log(`  commitSha=${commitSha}`);
        console.log(`  generatedAt=${generatedAt}`);
        console.log(`  installerBuiltFromSha=${buildInfo.commitSha}`);
        console.log(`  installerBuiltAtUtc=${buildInfo.builtAtUtc}`);
        console.log(`  manifest.json.sha256=${manifestSha}`);
        for (const it of manifestItems) {
            console.log(`  ${it.filename}  ${it.sha256}  ${it.size}`);
        }
    } catch (err) {
        // Cleanup: remove the partial output directory so the operator can
        // re-run without manual cleanup. We only remove if we created it
        // (output_exists case must NOT touch the pre-existing directory).
        if (outDirCreated) {
            try {
                await rm(outDir, { recursive: true, force: true });
            } catch {
                // ignore — best-effort cleanup
            }
        }
        throw err;
    }
}

main().catch(err => {
    if (err instanceof BuildError) {
        console.error(`paid-release: ${err.message}`);
        process.exit(2);
    }
    console.error(`paid-release: unexpected_error: ${err.stack || err.message}`);
    process.exit(1);
});
