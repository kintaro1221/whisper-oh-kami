const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');

module.exports = {
    packagerConfig: {
        asar: {
            unpack: '**/{onnxruntime-node,onnxruntime-common,@huggingface/transformers,sharp,@img}/**',
        },
        // ── Packager ignore: FAIL-CLOSED ALLOWLIST ──────────────────────────
        //
        // electron-packager copies the entire project directory into
        // `app.asar` except whatever `ignore` excludes. Historically this was
        // a denylist (a single regex excluding `onnxruntime-web`), which
        // meant every other root-level file/directory shipped by default —
        // including internal ops docs (HANDOFF_*.md, AGENTS.md, docs/),
        // `lp/` (the marketing site, complete with its own `node_modules/`),
        // dotfiles for local tooling (`.claude/`, `.codex/`, `.agents/`,
        // `.superpowers/`, `.wrangler/`), `tests/`, `scripts/`, shell/vbs dev
        // launchers, and a 358 MB `.cache/whisper-models` directory that the
        // app never reads from at runtime (Whisper models are cached under
        // `app.getPath('userData')` — see src/utils/localai.js:140 — not
        // from anywhere inside the packaged app).
        //
        // We now invert the policy: `ignore` is a function that returns
        // `true` (exclude) for anything NOT explicitly allowlisted below.
        // New root-level files/directories are excluded by default — nobody
        // has to remember to add an ignore entry for the next stray
        // HANDOFF_*.md or docs/ subfolder. Anything the packaged app
        // actually needs at runtime must be added to the allowlist here.
        //
        // electron-packager calls `ignore` once per path (both files and
        // directories) with a POSIX-style string starting with `/`, relative
        // to the project root (e.g. `/src/index.js`, `/node_modules`). The
        // empty string `''` is passed for the project root itself and must
        // NOT be excluded, or nothing gets copied at all.
        //
        // LICENSE and THIRD_PARTY_NOTICES.md are NOT in the allowlist below
        // on purpose — they ship via `extraResource` (see below), landing in
        // `resources/` instead of inside `app.asar`, which is what GPL
        // distribution + audit tooling expect.
        ignore: relativePath => {
            const p = '/' + relativePath.replace(/\\/g, '/').replace(/^\/+/, '');

            // Root itself: never exclude.
            if (p === '/') return false;

            // `/package.json`: required by Electron itself to resolve `main`.
            if (p === '/package.json') return false;

            // `/src` and everything under it: the entire app source tree
            // (main process, preload, renderer, assets, i18n).
            if (p === '/src' || p.startsWith('/src/')) return false;

            // `/node_modules` and everything under it, EXCEPT the trims
            // below. electron-forge's auto-unpack-natives plugin + the
            // `asar.unpack` glob above still apply to whatever survives this
            // allowlist.
            if (p === '/node_modules' || p.startsWith('/node_modules/')) {
                // Exclude `onnxruntime-web` entirely. The
                // @huggingface/transformers backend resolver picks
                // `onnxruntime-node` at runtime on the Electron main process
                // (see src/utils/localai.js:136); `onnxruntime-web` is the
                // browser/WebAssembly backend shipped by Transformers 4.x for
                // environments that lack `onnxruntime-node`. We never reach
                // it.
                //
                // Trims ~29 MB from Setup.exe (measured 2026-06-27: 777 → 748
                // MB on Electron 30 + Transformers 4.2.0). The raw
                // `node_modules/onnxruntime-web` directory is ~130 MB on dev
                // disk, but Squirrel LZMA compresses the high-entropy WASM
                // bundles heavily and `app.asar` dedupes — so the shipping
                // delta is much smaller than the dev-disk delta.
                //
                // If a future code path needs `onnxruntime-web` (e.g. a
                // headless Node worker that explicitly imports it), revert
                // this entry. The Transformers backend resolver in the node
                // bundle is statically pinned to `onnxruntime-node`; a
                // Transformers minor bump COULD in theory flip the default
                // backend, so smoke-test the packaged app when bumping
                // `@huggingface/transformers`.
                if (/^\/node_modules\/onnxruntime-web($|\/)/.test(p)) return true;

                // Exclude the non-Windows onnxruntime-node native binaries.
                // This is a Windows-only build (Squirrel maker only; the
                // darwin/linux makers are unused/aspirational — see the
                // makers list below), so the linux/darwin napi binaries are
                // pure dead weight: ~53 MB (linux) + ~35 MB (darwin) on dev
                // disk. Revisit if macOS/Linux builds return (see
                // docs/decisions/macos-reentry.md for prior removal of the
                // macOS SystemAudioDump helper along similar lines).
                if (/^\/node_modules\/onnxruntime-node\/bin\/napi-v6\/(linux|darwin)($|\/)/.test(p)) {
                    return true;
                }

                return false;
            }

            // Everything else (docs/, lp/, scripts/, tests/, .cache/,
            // .claude/, .codex/, .agents/, .superpowers/, .wrangler/, tmp/,
            // out/, HANDOFF_*.md, AGENTS.md, start.log, start.bat,
            // start-hidden.vbs, README.md, etc.) is excluded by default.
            return true;
        },
        // Phase 1g-3.7: bundle the Rust WASAPI loopback helper. audioCapture.js
        // resolves the packaged path via process.resourcesPath at runtime
        // (dev mode falls through to src/assets/ via __dirname).
        // Ship the GPL-3.0 license and the generated third-party notices inside
        // the packaged app (resources/) so binary recipients get the license +
        // corresponding notices, as GPL distribution requires.
        // macOS SystemAudioDump removed 2026-06-27.
        extraResource: ['./src/assets/daddyAudioCapture.exe', './LICENSE', './THIRD_PARTY_NOTICES.md'],
        name: 'WhisperOhKAMI',
        appBundleId: 'ai.whisperohkami.app',
        icon: 'src/assets/logo',
        // use `security find-identity -v -p codesigning` to find your identity
        // for macos signing
        // osxSign: {
        //    identity: '<paste your identity here>',
        //   optionsForFile: (filePath) => {
        //       return {
        //           entitlements: 'entitlements.plist',
        //       };
        //   },
        // },
        // notarize if off cuz i ran this for 6 hours and it still didnt finish
        // osxNotarize: {
        //    appleId: 'your apple id',
        //    appleIdPassword: 'app specific password',
        //    teamId: 'your team id',
        // },
    },
    rebuildConfig: {},
    makers: [
        {
            name: '@electron-forge/maker-squirrel',
            config: {
                name: 'whisper-oh-kami',
                productName: 'WhisperOhKAMI',
                shortcutName: 'WhisperOhKAMI',
                createDesktopShortcut: true,
                createStartMenuShortcut: true,
            },
        },
        {
            name: '@electron-forge/maker-dmg',
            platforms: ['darwin'],
        },
        {
            name: '@reforged/maker-appimage',
            platforms: ['linux'],
            config: {
                options: {
                    name: 'WhisperOhKAMI',
                    productName: 'WhisperOhKAMI',
                    genericName: 'AI Sales Discovery Copilot',
                    description: 'Real-time AI hearing copilot for B2B sales discovery — 商談ヒアリングのささやきの神',
                    categories: ['Office', 'Network'],
                    icon: 'src/assets/logo.png',
                },
            },
        },
    ],
    plugins: [
        {
            name: '@electron-forge/plugin-auto-unpack-natives',
            config: {},
        },
        // Fuses are used to enable/disable various Electron functionality
        // at package time, before code signing the application
        new FusesPlugin({
            version: FuseVersion.V1,
            [FuseV1Options.RunAsNode]: false,
            [FuseV1Options.EnableCookieEncryption]: true,
            [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
            [FuseV1Options.EnableNodeCliInspectArguments]: false,
            [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
            [FuseV1Options.OnlyLoadAppFromAsar]: true,
        }),
    ],
};
