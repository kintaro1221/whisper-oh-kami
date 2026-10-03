// Regression guard for forge.config.js's packagerConfig.ignore allowlist.
//
// Context: electron-packager (via @electron/packager) copies the entire
// project directory into app.asar except what `ignore` excludes. Before this
// test existed, `ignore` was a denylist (a single regex excluding
// onnxruntime-web), so every other root-level file/directory — internal ops
// docs, lp/ (with its own node_modules), dotfiles for local tooling, tests/,
// scripts/, and a 358 MB .cache/whisper-models directory — shipped inside
// app.asar by default. This test locks in the fail-closed allowlist so a
// future edit cannot silently regress back to "ship everything".
//
// `ignore` receives each path as a POSIX-style string starting with '/',
// relative to the project root, for every file AND directory (see
// @electron/packager's copy-filter.js: `name = fullPath.split(resolve(dir))[1]`,
// which yields '' for the project root itself, not '/'). Returns true to
// EXCLUDE the path from the packaged app.

const { ignore } = require('../../forge.config.js').packagerConfig;

describe('forge.config.js packagerConfig.ignore (fail-closed allowlist)', () => {
    test('is a function, not a denylist array/regex', () => {
        expect(typeof ignore).toBe('function');
    });

    test('never excludes the project root', () => {
        // electron-packager passes '' for the root itself.
        expect(ignore('')).toBe(false);
    });

    test('keeps package.json (Electron resolves `main` from it)', () => {
        expect(ignore('/package.json')).toBe(false);
    });

    test('keeps everything under /src', () => {
        expect(ignore('/src')).toBe(false);
        expect(ignore('/src/index.js')).toBe(false);
        expect(ignore('/src/index.html')).toBe(false);
        expect(ignore('/src/utils/localai.js')).toBe(false);
        expect(ignore('/src/assets/daddyAudioCapture.exe')).toBe(false);
    });

    test('keeps node_modules in general', () => {
        expect(ignore('/node_modules')).toBe(false);
        expect(ignore('/node_modules/ws')).toBe(false);
        expect(ignore('/node_modules/ws/index.js')).toBe(false);
        expect(ignore('/node_modules/@huggingface/transformers')).toBe(false);
    });

    // A 0.7.2 release candidate shipped node_modules/.cache/wrangler/*.json
    // inside app.asar, leaking the operator's Cloudflare account id and an
    // account display name derived from their email address to every user
    // (recoverable with `asar extract`). Tool caches under node_modules are
    // developer-machine state and are never needed at runtime.
    test('excludes tool caches under node_modules/.cache', () => {
        expect(ignore('/node_modules/.cache')).toBe(true);
        expect(ignore('/node_modules/.cache/wrangler')).toBe(true);
        expect(ignore('/node_modules/.cache/wrangler/wrangler-account.json')).toBe(true);
        expect(ignore('/node_modules/.cache/wrangler/pages.json')).toBe(true);
    });

    test('does not over-match packages whose name merely starts with .cache', () => {
        // The guard is anchored on a path segment, so a real package
        // directory like `.cache-something` must still be packaged.
        expect(ignore('/node_modules/.cache-manifest')).toBe(false);
    });

    test('excludes onnxruntime-web under node_modules', () => {
        expect(ignore('/node_modules/onnxruntime-web')).toBe(true);
        expect(ignore('/node_modules/onnxruntime-web/dist/ort-web.min.js')).toBe(true);
    });

    test('excludes non-Windows onnxruntime-node native binaries', () => {
        expect(ignore('/node_modules/onnxruntime-node/bin/napi-v6/linux')).toBe(true);
        expect(ignore('/node_modules/onnxruntime-node/bin/napi-v6/linux/onnxruntime_binding.node')).toBe(true);
        expect(ignore('/node_modules/onnxruntime-node/bin/napi-v6/darwin')).toBe(true);
    });

    test('keeps the Windows onnxruntime-node native binaries', () => {
        expect(ignore('/node_modules/onnxruntime-node/bin/napi-v6/win32')).toBe(false);
        expect(ignore('/node_modules/onnxruntime-node/bin/napi-v6/win32/onnxruntime_binding.node')).toBe(false);
    });

    test('excludes internal ops docs and dev-only root files', () => {
        expect(ignore('/HANDOFF_2026-05-06.md')).toBe(true);
        expect(ignore('/AGENTS.md')).toBe(true);
        expect(ignore('/GATE1_PRE_MEETING.md')).toBe(true);
        expect(ignore('/start.log')).toBe(true);
        expect(ignore('/start.bat')).toBe(true);
        expect(ignore('/start-hidden.vbs')).toBe(true);
    });

    test('excludes docs/, lp/ (including its own node_modules), scripts/, and tests/', () => {
        expect(ignore('/docs')).toBe(true);
        expect(ignore('/docs/decisions/macos-reentry.md')).toBe(true);
        expect(ignore('/lp')).toBe(true);
        expect(ignore('/lp/node_modules')).toBe(true);
        expect(ignore('/lp/node_modules/miniflare')).toBe(true);
        expect(ignore('/scripts')).toBe(true);
        expect(ignore('/scripts/build-paid-release.mjs')).toBe(true);
        expect(ignore('/tests')).toBe(true);
        expect(ignore('/tests/unit/localWhisperLanguage.test.js')).toBe(true);
    });

    test('excludes local tool state and dead-weight model cache', () => {
        expect(ignore('/.claude')).toBe(true);
        expect(ignore('/.codex')).toBe(true);
        expect(ignore('/.agents')).toBe(true);
        expect(ignore('/.superpowers')).toBe(true);
        expect(ignore('/.wrangler')).toBe(true);
        expect(ignore('/.cache')).toBe(true);
        expect(ignore('/.cache/whisper-models')).toBe(true);
        expect(ignore('/tmp')).toBe(true);
        expect(ignore('/out')).toBe(true);
    });

    test('does not accidentally match "/src" or "/scripts" as prefixes of each other', () => {
        // A bare startsWith('/src') would wrongly keep something like
        // `/srcfoo` or fail to exclude `/scripts` if the check order were
        // sloppy. Confirm the exact-or-child-with-slash semantics hold.
        expect(ignore('/scripts')).toBe(true);
        expect(ignore('/srcbogus')).toBe(true);
    });

    // Bundled Whisper models (scripts/fetch-whisper-models.mjs) ship via
    // extraResource, landing in the packaged app's resources/ directory
    // directly — NOT via app.asar. /resources must stay excluded from the
    // asar allowlist just like LICENSE / THIRD_PARTY_NOTICES.md above.
    test('excludes /resources from the asar allowlist (ships via extraResource instead)', () => {
        expect(ignore('/resources')).toBe(true);
        expect(ignore('/resources/whisper-models')).toBe(true);
        expect(ignore('/resources/whisper-models/Xenova/whisper-small/onnx/encoder_model_quantized.onnx')).toBe(true);
    });
});

describe('forge.config.js packagerConfig.extraResource (bundled Whisper models)', () => {
    const { extraResource } = require('../../forge.config.js').packagerConfig;

    test('includes ./resources/whisper-models alongside the existing audio helper / license files', () => {
        expect(extraResource).toContain('./resources/whisper-models');
        expect(extraResource).toContain('./src/assets/daddyAudioCapture.exe');
        expect(extraResource).toContain('./LICENSE');
        expect(extraResource).toContain('./THIRD_PARTY_NOTICES.md');
    });
});

// 2026-09 rewrite (external review must-fix #2): forge.config.js's
// prePackage hook used to pass `env: process.env` straight through to
// fetch-whisper-models.mjs --check, so WHISPER_MODELS_DIR /
// WHISPER_MODELS_MANIFEST set in the calling environment could redirect the
// pre-package integrity check at a forged fixture directory, bypassing
// verification of the REAL resources/whisper-models/ that actually ships
// via extraResource. The fix moved the check into
// scripts/bundled-whisper-check.js's runBundledWhisperCheck(), which pins
// --dir/--manifest to the real paths and strips the two env vars from the
// child process's environment. hooks.prePackage now does nothing but call
// that module. These tests mock execFileSync (DI-injected) — no real child
// process, no real ~282 MB fixture.
describe('forge.config.js hooks.prePackage (delegates to scripts/bundled-whisper-check.js)', () => {
    const { hooks } = require('../../forge.config.js');

    test('prePackage hook is present', () => {
        expect(typeof hooks.prePackage).toBe('function');
    });
});

describe('scripts/bundled-whisper-check.js runBundledWhisperCheck (env-var bypass guard)', () => {
    const path = require('node:path');
    const { runBundledWhisperCheck } = require('../../scripts/bundled-whisper-check.js');
    const repoRoot = path.join(__dirname, '..', '..');

    let prevDir, prevManifest;
    beforeEach(() => {
        prevDir = process.env.WHISPER_MODELS_DIR;
        prevManifest = process.env.WHISPER_MODELS_MANIFEST;
    });
    afterEach(() => {
        if (prevDir === undefined) delete process.env.WHISPER_MODELS_DIR;
        else process.env.WHISPER_MODELS_DIR = prevDir;
        if (prevManifest === undefined) delete process.env.WHISPER_MODELS_MANIFEST;
        else process.env.WHISPER_MODELS_MANIFEST = prevManifest;
    });

    test('invokes execFileSync with args pinned to the real resources/whisper-models/ dir and manifest', async () => {
        const execFileSync = jest.fn();
        await runBundledWhisperCheck({ execFileSync, nodePath: 'node', repoRoot });

        expect(execFileSync).toHaveBeenCalledTimes(1);
        const [nodePath, args, opts] = execFileSync.mock.calls[0];
        expect(nodePath).toBe('node');
        expect(args).toEqual([
            path.join(repoRoot, 'scripts', 'fetch-whisper-models.mjs'),
            '--check',
            '--dir',
            path.join(repoRoot, 'resources', 'whisper-models'),
            '--manifest',
            path.join(repoRoot, 'scripts', 'whisper-models.manifest.json'),
        ]);
        expect(opts.cwd).toBe(repoRoot);
    });

    test('strips WHISPER_MODELS_DIR / WHISPER_MODELS_MANIFEST from the child env even when set in process.env', async () => {
        process.env.WHISPER_MODELS_DIR = '/attacker/controlled/fixture-dir';
        process.env.WHISPER_MODELS_MANIFEST = '/attacker/controlled/fixture-manifest.json';

        const execFileSync = jest.fn();
        await runBundledWhisperCheck({ execFileSync, nodePath: 'node', repoRoot });

        const [, , opts] = execFileSync.mock.calls[0];
        expect(opts.env).not.toHaveProperty('WHISPER_MODELS_DIR');
        expect(opts.env).not.toHaveProperty('WHISPER_MODELS_MANIFEST');
        // Also proves the args (not just env) stay pinned to the real paths
        // regardless of the env var overrides.
        const args = execFileSync.mock.calls[0][1];
        expect(args).toContain(path.join(repoRoot, 'resources', 'whisper-models'));
        expect(args).not.toContain('/attacker/controlled/fixture-dir');
    });

    test('rejects when execFileSync throws (bundled model verification failed)', async () => {
        const execFileSync = jest.fn(() => {
            throw new Error('boom: check failed');
        });

        await expect(runBundledWhisperCheck({ execFileSync, nodePath: 'node', repoRoot })).rejects.toThrow(/failed verification/i);
    });

    test('forge.config.js hooks.prePackage calls runBundledWhisperCheck (module wiring, mocked child process)', async () => {
        // Exercise the real forge.config.js prePackage hook end-to-end, but
        // with node:child_process's execFileSync mocked so no real child
        // process runs. Proves prePackage is wired through
        // scripts/bundled-whisper-check.js rather than shelling out
        // directly, and that a process.env override of
        // WHISPER_MODELS_DIR/WHISPER_MODELS_MANIFEST does not change what
        // gets passed to the child process.
        jest.resetModules();
        process.env.WHISPER_MODELS_DIR = '/attacker/controlled/fixture-dir';

        const execFileSyncSpy = jest.fn();
        jest.doMock('node:child_process', () => ({
            execFileSync: execFileSyncSpy,
        }));

        const { hooks } = require('../../forge.config.js');
        await hooks.prePackage();

        expect(execFileSyncSpy).toHaveBeenCalledTimes(1);
        const [, args, opts] = execFileSyncSpy.mock.calls[0];
        expect(args).toContain(path.join(repoRoot, 'resources', 'whisper-models'));
        expect(args).not.toContain('/attacker/controlled/fixture-dir');
        expect(opts.env).not.toHaveProperty('WHISPER_MODELS_DIR');

        jest.dontMock('node:child_process');
        jest.resetModules();
    });
});
