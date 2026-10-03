#!/usr/bin/env node
'use strict';

// Fetches the Whisper model files that ship bundled with the WhisperOhKAMI
// installer (Xenova/whisper-tiny + Xenova/whisper-small, q8 ONNX weights) and
// writes them to resources/whisper-models/<org>/<model>/... — the exact
// on-disk layout @huggingface/transformers' `env.localModelPath` resolution
// expects (env.localModelPath + "/" + <org>/<model> + "/" + <file>), so
// src/utils/localai.js can load them offline with no first-run download.
//
// Overrides for the resources dir / manifest path, in priority order (for
// tests / CI / forge.config.js's prePackage hook — production/dev usage
// leaves all of these unset and gets the defaults below):
//   1. CLI args:  --dir <path>  --manifest <path>   (highest priority)
//   2. Env vars:  WHISPER_MODELS_DIR / WHISPER_MODELS_MANIFEST
//   3. Defaults:  resources/whisper-models / scripts/whisper-models.manifest.json
//
// The CLI args exist specifically so forge.config.js's prePackage hook (via
// scripts/bundled-whisper-check.js) can pin --check to the real
// resources/whisper-models/ + the real manifest regardless of what
// WHISPER_MODELS_DIR / WHISPER_MODELS_MANIFEST happen to be set to in the
// packaging environment — otherwise an env var alone could redirect the
// pre-package integrity check at an attacker-controlled fixture directory
// and bypass the guard entirely.
//
// Modes:
//   node scripts/fetch-whisper-models.mjs                 download + verify
//                                                           against the fixed
//                                                           manifest (fails
//                                                           closed if a file
//                                                           has no manifest
//                                                           entry, or a
//                                                           downloaded file's
//                                                           hash/size does
//                                                           not match it)
//   node scripts/fetch-whisper-models.mjs --write-manifest download any
//                                                           missing files,
//                                                           then (re)write
//                                                           scripts/whisper-models.manifest.json
//                                                           from what is on
//                                                           disk. Run this
//                                                           once when adding
//                                                           or updating a
//                                                           bundled model.
//                                                           Only writes if
//                                                           EVERY file
//                                                           succeeded
//                                                           (fail-closed);
//                                                           the write itself
//                                                           is atomic
//                                                           (temp file +
//                                                           rename).
//   node scripts/fetch-whisper-models.mjs --check          no downloads:
//                                                           verify the
//                                                           manifest exactly
//                                                           matches
//                                                           BUNDLED_MODEL_REPOS
//                                                           x MODEL_FILES
//                                                           (no
//                                                           missing/extra/duplicate
//                                                           entries), that
//                                                           every entry's
//                                                           shape is valid
//                                                           (repo/file in the
//                                                           allowlists, size a
//                                                           positive integer,
//                                                           sha256 64
//                                                           lowercase hex),
//                                                           that every
//                                                           manifest file
//                                                           exists on disk
//                                                           with a matching
//                                                           hash/size, and
//                                                           that no extra
//                                                           file sits under
//                                                           the models
//                                                           directory outside
//                                                           the manifest.
//                                                           Exits non-zero on
//                                                           any violation
//                                                           (fail-closed —
//                                                           used by
//                                                           forge.config.js's
//                                                           prePackage hook
//                                                           and CI).

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');

// Reads a `--flag <value>` pair out of argv. Returns undefined if the flag
// is absent (so the caller can fall through to the next priority tier).
function readFlagValue(argv, flag) {
    const idx = argv.indexOf(flag);
    if (idx === -1 || idx + 1 >= argv.length) return undefined;
    return argv[idx + 1];
}

const cliDir = readFlagValue(process.argv.slice(2), '--dir');
const cliManifest = readFlagValue(process.argv.slice(2), '--manifest');

const resourcesDir = cliDir || process.env.WHISPER_MODELS_DIR || path.join(repoRoot, 'resources', 'whisper-models');
const manifestPath = cliManifest || process.env.WHISPER_MODELS_MANIFEST || path.join(__dirname, 'whisper-models.manifest.json');

// The exact file set @huggingface/transformers' pipeline('automatic-speech-recognition', ..., { dtype: 'q8', device: 'cpu' })
// reads for a Whisper q8 model — confirmed against the runtime cache
// (%APPDATA%/WhisperOhKAMI/whisper-models/Xenova/whisper-tiny/**).
const MODEL_FILES = [
    'config.json',
    'generation_config.json',
    'preprocessor_config.json',
    'tokenizer.json',
    'tokenizer_config.json',
    'onnx/encoder_model_quantized.onnx',
    'onnx/decoder_model_merged_quantized.onnx',
];

// Bundled (installer-shipped) models only. onnx-community/kotoba-whisper-v2.2-ONNX
// is opt-in / remote-download-only and deliberately NOT listed here.
export const BUNDLED_MODEL_REPOS = ['Xenova/whisper-tiny', 'Xenova/whisper-small'];

const SHA256_RE = /^[0-9a-f]{64}$/;

function parseArgs(argv) {
    return {
        check: argv.includes('--check'),
        writeManifest: argv.includes('--write-manifest'),
    };
}

function sha256File(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(filePath);
        stream.on('data', chunk => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', reject);
    });
}

function loadManifest() {
    if (!fs.existsSync(manifestPath)) return { files: [] };
    try {
        const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        return { files: Array.isArray(parsed.files) ? parsed.files : [] };
    } catch {
        return { files: [] };
    }
}

function manifestKey(repo, file) {
    return `${repo}/${file}`;
}

function expectedKeySet() {
    const keys = new Set();
    for (const repo of BUNDLED_MODEL_REPOS) {
        for (const file of MODEL_FILES) {
            keys.add(manifestKey(repo, file));
        }
    }
    return keys;
}

// Validates the manifest as a whole: exact coverage of
// BUNDLED_MODEL_REPOS x MODEL_FILES (no missing/extra/duplicate entries) and
// per-entry shape (repo/file in the allowlists, size a positive integer,
// sha256 a 64-char lowercase hex string). Returns a list of human-readable
// error strings; empty means the manifest is structurally valid.
function validateManifestShape(manifest) {
    const errors = [];
    const seenCounts = new Map();

    for (const entry of manifest.files) {
        const key = manifestKey(entry.repo, entry.file);
        seenCounts.set(key, (seenCounts.get(key) || 0) + 1);

        if (!BUNDLED_MODEL_REPOS.includes(entry.repo)) {
            errors.push(`INVALID repo (not in allowlist): ${JSON.stringify(entry.repo)}`);
        }
        if (!MODEL_FILES.includes(entry.file)) {
            errors.push(`INVALID file (not in allowlist): ${JSON.stringify(entry.file)}`);
        }
        if (!Number.isInteger(entry.size) || entry.size <= 0) {
            errors.push(`INVALID size for ${key}: ${JSON.stringify(entry.size)} (must be a positive integer)`);
        }
        if (typeof entry.sha256 !== 'string' || !SHA256_RE.test(entry.sha256)) {
            errors.push(`INVALID sha256 for ${key}: must be 64 lowercase hex chars`);
        }
    }

    for (const [key, count] of seenCounts) {
        if (count > 1) {
            errors.push(`DUPLICATE ENTRY: ${key} (appears ${count} times)`);
        }
    }

    const expectedKeys = expectedKeySet();
    const presentKeys = new Set(manifest.files.map(f => manifestKey(f.repo, f.file)));
    for (const key of expectedKeys) {
        if (!presentKeys.has(key)) {
            errors.push(`MISSING ENTRY: ${key}`);
        }
    }
    for (const key of presentKeys) {
        if (!expectedKeys.has(key)) {
            errors.push(`UNEXPECTED ENTRY (not part of BUNDLED_MODEL_REPOS x MODEL_FILES): ${key}`);
        }
    }

    return errors;
}

async function listFilesRecursive(dir) {
    const results = [];
    async function walk(current) {
        let entries;
        try {
            entries = await fsp.readdir(current, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) {
                await walk(full);
            } else if (entry.isFile()) {
                results.push(full);
            }
        }
    }
    await walk(dir);
    return results;
}

// Detects files under resourcesDir that are not referenced by any
// (repo, file) combination in BUNDLED_MODEL_REPOS x MODEL_FILES — i.e. stray
// files that would ship inside the installer without being covered by the
// manifest (accidental inclusion / mixed-in leftovers from an old model).
async function findExtraFilesOnDisk() {
    if (!fs.existsSync(resourcesDir)) return [];
    const expectedRelPaths = new Set();
    for (const repo of BUNDLED_MODEL_REPOS) {
        for (const file of MODEL_FILES) {
            expectedRelPaths.add(path.join(repo, file));
        }
    }
    const allFiles = await listFilesRecursive(resourcesDir);
    const extras = [];
    for (const full of allFiles) {
        const rel = path.relative(resourcesDir, full);
        if (!expectedRelPaths.has(rel)) {
            extras.push(rel);
        }
    }
    return extras;
}

async function downloadFile(url, destPath) {
    await fsp.mkdir(path.dirname(destPath), { recursive: true });
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok || !res.body) {
        throw new Error(`Download failed (${res.status} ${res.statusText}): ${url}`);
    }
    const tmpPath = destPath + '.download';
    await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmpPath));
    await fsp.rename(tmpPath, destPath);
}

async function runCheck() {
    const manifest = loadManifest();
    if (manifest.files.length === 0) {
        console.error('[whisper-models:check] manifest is empty — run --write-manifest first');
        return false;
    }

    let ok = true;

    const shapeErrors = validateManifestShape(manifest);
    for (const err of shapeErrors) {
        console.error(`[whisper-models:check] ${err}`);
    }
    if (shapeErrors.length > 0) ok = false;

    const expectedKeys = expectedKeySet();
    for (const entry of manifest.files) {
        const key = manifestKey(entry.repo, entry.file);
        // Entries with an invalid repo/file were already reported above by
        // validateManifestShape; skip resolving a disk path for them (their
        // repo/file could be anything, including a path-traversal attempt).
        if (!expectedKeys.has(key)) continue;

        const destPath = path.join(resourcesDir, entry.repo, entry.file);
        const relDest = path.relative(repoRoot, destPath);
        if (!fs.existsSync(destPath)) {
            console.error(`[whisper-models:check] MISSING: ${relDest}`);
            ok = false;
            continue;
        }
        const stat = await fsp.stat(destPath);
        if (stat.size !== entry.size) {
            console.error(`[whisper-models:check] SIZE MISMATCH: ${relDest} (expected ${entry.size}, got ${stat.size})`);
            ok = false;
            continue;
        }
        const hash = await sha256File(destPath);
        if (hash !== entry.sha256) {
            console.error(`[whisper-models:check] HASH MISMATCH: ${relDest}`);
            ok = false;
            continue;
        }
        console.log(`[whisper-models:check] OK: ${relDest}`);
    }

    const extras = await findExtraFilesOnDisk();
    for (const rel of extras) {
        console.error(`[whisper-models:check] UNEXPECTED FILE ON DISK (not in manifest): ${path.join(path.relative(repoRoot, resourcesDir), rel)}`);
        ok = false;
    }

    return ok;
}

async function runWriteManifest() {
    const results = [];
    let ok = true;
    for (const repo of BUNDLED_MODEL_REPOS) {
        for (const file of MODEL_FILES) {
            const destPath = path.join(resourcesDir, repo, file);
            const relDest = path.relative(repoRoot, destPath);
            if (!fs.existsSync(destPath)) {
                const url = `https://huggingface.co/${repo}/resolve/main/${file}`;
                console.log(`[whisper-models] downloading ${url} -> ${relDest}`);
                try {
                    await downloadFile(url, destPath);
                } catch (error) {
                    console.error(`[whisper-models] download failed: ${relDest}: ${error.message}`);
                    ok = false;
                    continue;
                }
            } else {
                console.log(`[whisper-models] using existing file: ${relDest}`);
            }
            const stat = await fsp.stat(destPath);
            const sha256 = await sha256File(destPath);
            results.push({ repo, file, size: stat.size, sha256 });
        }
    }

    if (!ok) {
        console.error(
            '[whisper-models] --write-manifest aborted: not every bundled file could be fetched/verified. ' +
                'Leaving the existing manifest untouched (fail-closed).'
        );
        return false;
    }

    const newManifest = {
        generatedNote:
            'Fixed manifest of bundled Whisper model files. Generated by scripts/fetch-whisper-models.mjs --write-manifest. Do not hand-edit sizes/hashes.',
        files: results,
    };

    // Atomic update: write to a temp file in the same directory, then
    // rename over the real manifest path. A rename within the same
    // filesystem is atomic, so a crash/interrupt mid-write can never leave
    // manifestPath holding a half-written / truncated JSON file.
    await fsp.mkdir(path.dirname(manifestPath), { recursive: true });
    const tmpPath = path.join(path.dirname(manifestPath), `.${path.basename(manifestPath)}.tmp-${process.pid}`);
    await fsp.writeFile(tmpPath, JSON.stringify(newManifest, null, 2) + '\n', 'utf8');
    await fsp.rename(tmpPath, manifestPath);

    console.log(`[whisper-models] manifest written: ${manifestPath} (${results.length} files)`);
    return true;
}

async function runDownload() {
    const manifest = loadManifest();
    const manifestByKey = new Map(manifest.files.map(f => [manifestKey(f.repo, f.file), f]));

    let ok = true;
    for (const repo of BUNDLED_MODEL_REPOS) {
        for (const file of MODEL_FILES) {
            const key = manifestKey(repo, file);
            const destPath = path.join(resourcesDir, repo, file);
            const relDest = path.relative(repoRoot, destPath);
            const entry = manifestByKey.get(key);

            if (fs.existsSync(destPath) && entry) {
                const stat = await fsp.stat(destPath);
                if (stat.size === entry.size) {
                    const hash = await sha256File(destPath);
                    if (hash === entry.sha256) {
                        console.log(`[whisper-models] up to date: ${relDest}`);
                        continue;
                    }
                }
            }

            if (!entry) {
                console.error(`[whisper-models] no manifest entry for ${key} — run with --write-manifest first`);
                ok = false;
                continue;
            }

            const url = `https://huggingface.co/${repo}/resolve/main/${file}`;
            console.log(`[whisper-models] downloading ${url} -> ${relDest}`);
            try {
                await downloadFile(url, destPath);
            } catch (error) {
                console.error(`[whisper-models] download failed: ${relDest}: ${error.message}`);
                ok = false;
                continue;
            }

            const stat = await fsp.stat(destPath);
            const hash = await sha256File(destPath);
            if (stat.size !== entry.size || hash !== entry.sha256) {
                console.error(`[whisper-models] VERIFICATION FAILED after download: ${relDest}`);
                ok = false;
                continue;
            }
            console.log(`[whisper-models] verified: ${relDest}`);
        }
    }
    return ok;
}

async function main() {
    const { check, writeManifest } = parseArgs(process.argv.slice(2));

    const ok = check ? await runCheck() : writeManifest ? await runWriteManifest() : await runDownload();

    if (!ok) {
        console.error('[whisper-models] FAILED (fail-closed)');
        process.exit(1);
    }
    console.log('[whisper-models] done.');
}

main().catch(error => {
    console.error('[whisper-models] error:', error);
    process.exit(1);
});
