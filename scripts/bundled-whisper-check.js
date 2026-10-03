'use strict';

// Runs `fetch-whisper-models.mjs --check` pinned to the REAL bundled model
// directory / manifest, regardless of whatever WHISPER_MODELS_DIR /
// WHISPER_MODELS_MANIFEST happen to be set to in the calling environment.
//
// Why this module exists (2026-09 external review must-fix): forge.config.js's
// prePackage hook used to invoke fetch-whisper-models.mjs --check with
// `env: process.env` passed straight through. fetch-whisper-models.mjs reads
// WHISPER_MODELS_DIR / WHISPER_MODELS_MANIFEST from the environment, so
// anyone (or anything) able to set those two environment variables before
// `npm run make` / `npm run package` could point --check at a throwaway
// fixture directory containing forged manifest+model files and have the
// pre-package integrity guard pass while the REAL resources/whisper-models/
// (the directory that actually ships via extraResource) goes completely
// unverified — a silent bypass of the fail-closed guard.
//
// The fix: --dir/--manifest CLI args on fetch-whisper-models.mjs take
// priority over the env vars (see that file), and this module always passes
// them explicitly, pointing at the real resources/whisper-models/ and the
// real scripts/whisper-models.manifest.json — while also stripping
// WHISPER_MODELS_DIR / WHISPER_MODELS_MANIFEST out of the child process's
// environment so they cannot silently participate even if the CLI-arg
// priority ordering in fetch-whisper-models.mjs ever regressed.
//
// forge.config.js's hooks.prePackage should do nothing but call
// runBundledWhisperCheck() — see forge.config.js.

const path = require('node:path');
const child_process = require('node:child_process');

/**
 * @param {object} [opts]
 * @param {typeof child_process.execFileSync} [opts.execFileSync] - injectable for tests
 * @param {string} [opts.nodePath] - injectable for tests (defaults to process.execPath)
 * @param {string} [opts.repoRoot] - injectable for tests (defaults to the real repo root)
 * @returns {Promise<void>} resolves if the check passes, rejects otherwise
 */
async function runBundledWhisperCheck({
    execFileSync = child_process.execFileSync,
    nodePath = process.execPath,
    repoRoot = path.join(__dirname, '..'),
} = {}) {
    const scriptPath = path.join(repoRoot, 'scripts', 'fetch-whisper-models.mjs');
    const dir = path.join(repoRoot, 'resources', 'whisper-models');
    const manifest = path.join(repoRoot, 'scripts', 'whisper-models.manifest.json');

    // Strip WHISPER_MODELS_DIR / WHISPER_MODELS_MANIFEST from the child's
    // environment. --dir/--manifest already take priority in
    // fetch-whisper-models.mjs, but removing the env vars entirely is
    // defense in depth: this check must never be satisfiable by anything
    // other than the real bundled files.
    const env = { ...process.env };
    delete env.WHISPER_MODELS_DIR;
    delete env.WHISPER_MODELS_MANIFEST;

    try {
        execFileSync(nodePath, [scriptPath, '--check', '--dir', dir, '--manifest', manifest], {
            cwd: repoRoot,
            stdio: 'inherit',
            env,
        });
    } catch (error) {
        throw new Error(
            'scripts/bundled-whisper-check.js: bundled Whisper model files failed verification ' +
                '(npm run whisper-models:check). Run `npm run whisper-models` to fetch them ' +
                'before packaging. Refusing to ship without the bundled models. ' +
                `Underlying error: ${error.message}`
        );
    }
}

module.exports = { runBundledWhisperCheck };
