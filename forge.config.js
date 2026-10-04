const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { runBundledWhisperCheck } = require('./scripts/bundled-whisper-check.js');

// Untracked-path allowlist for the postMake dirty-tree check (see hooks.postMake
// below). electron-packager copies the entire project directory into app.asar,
// so an untracked file under a path NOT in this list (e.g. a stray untracked
// src/ file) would ship inside the installer while being absent from
// source.zip's `git archive HEAD` output — an undetectable provenance gap.
// Everything here is a working-tool path that is never packaged (excluded by
// forge.config.js's packagerConfig.ignore allowlist above) and never archived
// (not tracked by git), so its presence is harmless noise, not a provenance
// risk:
//   out/            - build output (this very build-info.json, out/make/, out/paid-release/)
//   tmp/             - scratch/working files (see repo root tmp/)
//   artifacts/       - ad-hoc local artifacts (see repo root artifacts/)
//   .agents/         - agent working state (see repo root .agents/)
//   .claude/         - Claude Code local config/state
//   .codex/          - Codex CLI local config/state
//   .superpowers/    - superpowers skill local state
//   .wrangler/       - Wrangler (Cloudflare) local cache/state
//   start.log        - local dev-launcher log file (single file, not a dir)
const UNTRACKED_DIRTY_CHECK_ALLOWLIST_PREFIXES = ['out/', 'tmp/', 'artifacts/', '.agents/', '.claude/', '.codex/', '.superpowers/', '.wrangler/'];
const UNTRACKED_DIRTY_CHECK_ALLOWLIST_EXACT = ['start.log'];

function isAllowlistedUntrackedPath(relPath) {
    const normalized = relPath.replace(/\\/g, '/');
    if (UNTRACKED_DIRTY_CHECK_ALLOWLIST_EXACT.includes(normalized)) return true;
    return UNTRACKED_DIRTY_CHECK_ALLOWLIST_PREFIXES.some(prefix => normalized === prefix.slice(0, -1) || normalized.startsWith(prefix));
}

// Finds the Squirrel installer artifact (Setup.exe) among everything
// electron-forge's makers produced. `makeResults` is an array of
// `{ artifacts: string[], ... }` — one entry per maker/platform/arch
// combination. We prefer a path ending in `Setup.exe` (Squirrel's installer
// naming convention: `<productName>-<version> Setup.exe`) and fall back to
// any `.exe` artifact so a renamed/customized Squirrel config still resolves.
// Returns `null` if nothing matches, so the caller can fail closed.
// Only win32 maker results are searched: DMG/AppImage runs (macOS/Linux
// `npm run make`, still technically buildable per the README) legitimately
// produce no `.exe`, and must not be failed by the Windows provenance stamp.
function findInstallerArtifact(makeResults) {
    const win32Artifacts = (makeResults || []).filter(result => result?.platform === 'win32').flatMap(result => result?.artifacts || []);
    const setupExe = win32Artifacts.find(p => /Setup\.exe$/i.test(p));
    if (setupExe) return setupExe;
    return win32Artifacts.find(p => /\.exe$/i.test(p)) || null;
}

// Streaming SHA-256 of a file, so large installers do not need to be read
// fully into memory.
function sha256FileStream(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(filePath);
        stream.on('data', chunk => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', reject);
    });
}

module.exports = {
    packagerConfig: {
        asar: {
            unpack: '**/{onnxruntime-node,onnxruntime-common,@huggingface/transformers,sharp,@img}/**',
        },
        // Without this, electron-packager falls back to package.json's
        // `description` (a long marketing sentence) for the exe's
        // FileDescription, which breaks the Explorer properties dialog and
        // the installer UI. Pin the Windows resource strings explicitly.
        win32metadata: {
            ProductName: 'WhisperOhKAMI',
            FileDescription: 'WhisperOhKAMI',
            CompanyName: 'WhisperOhKAMI',
            InternalName: 'WhisperOhKAMI',
        },
        // Explorer's Properties > Details "Copyright" row (VERSIONINFO
        // LegalCopyright). @electron/packager takes this from
        // `appCopyright`, NOT from win32metadata.LegalCopyright — the 0.7.7
        // release candidate set the latter and shipped Electron's default
        // "Copyright (C) 2015 GitHub, Inc." (tests/unit/forgeConfigIgnore
        // pins appCopyright). Name the current copyright holder + license only
        // (the sohzm/cheating-daddy fork attribution lives in README/LICENSE,
        // not in the exe resource). Keep it ASCII-safe: it is written into the
        // resource verbatim.
        appCopyright: 'Copyright (C) 2026 kintaro1221. Licensed under GPL-3.0.',
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

            // `/src/i18n/__tests__` and everything under it: Jest tests
            // that live next to the i18n catalogs (jest.config.js matches
            // src/**/__tests__/**). Test code is never loaded at runtime and
            // 0.7.6 shipped it inside app.asar. Checked BEFORE the /src
            // allowlist below so the exclusion wins.
            if (p === '/src/i18n/__tests__' || p.startsWith('/src/i18n/__tests__/')) return true;

            // `/src` and everything under it: the entire app source tree
            // (main process, preload, renderer, assets, i18n).
            if (p === '/src' || p.startsWith('/src/')) return false;

            // `/node_modules` and everything under it, EXCEPT the trims
            // below. electron-forge's auto-unpack-natives plugin + the
            // `asar.unpack` glob above still apply to whatever survives this
            // allowlist.
            if (p === '/node_modules' || p.startsWith('/node_modules/')) {
                // Exclude tool/build caches that npm-installed CLIs write
                // into node_modules/.cache. These are developer-machine
                // state, not dependencies: wrangler stores the operator's
                // Cloudflare account id and account display name (derived
                // from their email) in .cache/wrangler/*.json, and a 0.7.2
                // release candidate shipped both inside app.asar, where
                // `asar extract` exposed them to every user. Nothing under
                // .cache is ever required at runtime.
                if (/^\/node_modules\/\.cache($|\/)/.test(p)) return true;

                // Exclude Vite's dependency pre-bundle cache
                // (node_modules/.vite). Like .cache above it is dev-server
                // state written on the developer machine, never required at
                // runtime; 0.7.6 shipped it inside app.asar by accident.
                if (/^\/node_modules\/\.vite($|\/)/.test(p)) return true;

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
        // macOS SystemAudioDump removed 2026-06-27 — see docs/decisions/macos-reentry.md.
        // './resources/whisper-models': bundled Xenova/whisper-tiny + -small
        // q8 ONNX weights (see scripts/fetch-whisper-models.mjs /
        // scripts/whisper-models.manifest.json), so first-run local STT
        // needs no network access. `resources/` is excluded from app.asar by
        // the `ignore` allowlist below (never explicitly allowlisted), and
        // ships instead via extraResource into the packaged app's
        // `resources/` directory, at `resources/whisper-models/<org>/<model>/...` —
        // matching the layout src/utils/localai.js's
        // getBundledWhisperModelsRoot() expects.
        // './node_modules/electron/dist/LICENSES.chromium.html': Electron's
        // own aggregate notice for Chromium / Node.js / V8 and their
        // third-party components. electron-packager already drops it next to
        // the exe, but THIRD_PARTY_NOTICES.md points readers at resources/,
        // so ship a copy there too, alongside LICENSE and the notices file.
        extraResource: [
            './src/assets/daddyAudioCapture.exe',
            './LICENSE',
            './THIRD_PARTY_NOTICES.md',
            './node_modules/electron/dist/LICENSES.chromium.html',
            './resources/whisper-models',
        ],
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
                // Setup.exe's VersionInfo is stamped by electron-winstaller from
                // these fields, NOT from packagerConfig.win32metadata (that only
                // covers the packaged app exe). Without them the Setup.exe
                // ProductName/FileDescription fall back to package.json's long
                // marketing description. Keep values ASCII-safe.
                title: 'WhisperOhKAMI',
                description: 'WhisperOhKAMI',
                authors: 'kintaro1221',
                shortcutName: 'WhisperOhKAMI',
                createDesktopShortcut: true,
                createStartMenuShortcut: true,
                // Icon of Setup.exe itself (packagerConfig.icon only covers
                // the packaged app exe).
                setupIcon: 'src/assets/logo.ico',
                // Squirrel writes this URL into the nuspec's <iconUrl>, which
                // is what Windows "Apps & features" / Add or Remove Programs
                // shows for the installed app. Without it the default
                // Squirrel/Atom icon appears there. Must be an http(s) URL
                // (file: is rejected); served from lp/public/logo.ico, a
                // copy of src/assets/logo.ico.
                iconUrl: 'https://whisperohkami.pages.dev/logo.ico',
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
    hooks: {
        // Fail-closed guard: refuse to package the app if the bundled
        // Whisper model files (resources/whisper-models/, shipped via
        // extraResource above) are missing or do not match
        // scripts/whisper-models.manifest.json. Without this, a package run
        // on a machine that never ran `npm run whisper-models` would ship
        // an installer whose local STT silently falls back to a remote
        // first-run download (or fails offline) instead of the bundled
        // model the release is supposed to guarantee.
        prePackage: async () => {
            // Delegates entirely to scripts/bundled-whisper-check.js, which
            // pins --check to the REAL resources/whisper-models/ +
            // scripts/whisper-models.manifest.json via explicit --dir/
            // --manifest CLI args and strips WHISPER_MODELS_DIR /
            // WHISPER_MODELS_MANIFEST from the child environment — so this
            // guard cannot be redirected at a forged fixture directory by
            // setting those env vars before packaging. See that module for
            // the full rationale.
            await runBundledWhisperCheck({ repoRoot: __dirname });
        },
        // Writes out/build-info.json once `npm run make` finishes. This is the
        // only thing that lets scripts/build-paid-release.mjs prove
        // installer.exe was actually built from the commit whose source.zip
        // it packages — manifest.json alone cannot show that, since
        // `--installer` accepts an arbitrary file path and source.zip is a
        // separate `git archive` of HEAD. If a hotfix commit lands between
        // `npm run make` and `npm run paid-release`, this record goes stale
        // and the paid-release builder refuses to ship (fail-closed).
        //
        // Beyond commit/version/timestamp, this also records the ACTUAL
        // Setup.exe's SHA-256 + size (installerSha256 / installerSize).
        // Without this, build-paid-release.mjs could not tell the difference
        // between the real Setup.exe and an arbitrary file passed to
        // `--installer` — both would satisfy the commit/version checks, since
        // those only look at out/build-info.json's *metadata*, never at the
        // installer bytes themselves. build-paid-release.mjs hashes whatever
        // `--installer` points at and rejects a mismatch (fail-closed).
        //
        // git failures here throw synchronously (execFileSync's default
        // behaviour) rather than being swallowed, so a broken git checkout
        // fails the make step instead of silently omitting the record. The
        // same applies to a missing installer artifact: we throw rather than
        // write a build-info.json without installer provenance.
        postMake: async (forgeConfig, makeResults) => {
            const repoRoot = __dirname;
            const commitSha = execFileSync('git', ['rev-parse', 'HEAD'], {
                cwd: repoRoot,
                encoding: 'utf8',
            }).trim();
            // `git status --porcelain` marks untracked paths with `??`.
            // Historically we ignored ALL `??` lines, but electron-packager
            // copies the entire project directory (minus the ignore
            // allowlist above) into app.asar regardless of git tracking
            // state — so an untracked src/ file would ship inside the
            // installer while being absent from source.zip's `git archive
            // HEAD` output, an undetectable provenance gap. We now only
            // ignore untracked paths that are known, constantly-present
            // working-tool paths (see UNTRACKED_DIRTY_CHECK_ALLOWLIST_*
            // above) — everything else untracked also makes the tree dirty.
            const statusOutput = execFileSync('git', ['status', '--porcelain'], {
                cwd: repoRoot,
                encoding: 'utf8',
            });
            const treeDirty = statusOutput
                .split('\n')
                .filter(line => line.length > 0)
                .some(line => {
                    if (!line.startsWith('??')) return true;
                    const rawPath = line.slice(3).trim();
                    // `git status --porcelain` quotes paths containing
                    // unusual characters; strip surrounding quotes if present.
                    const relPath = rawPath.replace(/^"(.*)"$/, '$1');
                    return !isAllowlistedUntrackedPath(relPath);
                });
            const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

            // A make run with no win32 results (macOS DMG / Linux AppImage)
            // has no installer to stamp: skip the provenance record entirely
            // instead of failing the build. build-paid-release.mjs is
            // Windows-only and will refuse to run without build-info.json,
            // so skipping stays fail-closed for the paid-release pipeline.
            const hasWin32Results = (makeResults || []).some(result => result?.platform === 'win32');
            if (!hasWin32Results) {
                return;
            }
            const installerPath = findInstallerArtifact(makeResults);
            if (!installerPath) {
                throw new Error(
                    'forge.config.js postMake: no Setup.exe (or any .exe) artifact found in ' +
                        'the win32 makeResults. Cannot record installer provenance in ' +
                        'out/build-info.json — refusing to write a build-info.json that ' +
                        'build-paid-release.mjs could not actually verify an installer against.'
                );
            }
            const installerSha256 = await sha256FileStream(installerPath);
            const installerSize = fs.statSync(installerPath).size;

            const buildInfo = {
                commitSha,
                version: pkg.version,
                builtAtUtc: new Date().toISOString(),
                treeDirty,
                installerSha256,
                installerSize,
            };
            const outDir = path.join(repoRoot, 'out');
            fs.mkdirSync(outDir, { recursive: true });
            fs.writeFileSync(path.join(outDir, 'build-info.json'), JSON.stringify(buildInfo, null, 2) + '\n', 'utf8');
            return makeResults;
        },
    },
};
