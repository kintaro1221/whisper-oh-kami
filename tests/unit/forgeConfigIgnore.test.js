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
});
