const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');

module.exports = {
    packagerConfig: {
        asar: {
            unpack: '**/{onnxruntime-node,onnxruntime-common,@huggingface/transformers,sharp,@img}/**',
        },
        // Exclude `onnxruntime-web` from the packaged app entirely. The
        // @huggingface/transformers backend resolver picks `onnxruntime-node`
        // at runtime on Electron main process (see src/utils/localai.js:136);
        // `onnxruntime-web` is the browser/WebAssembly backend shipped by
        // Transformers 4.x for environments that lack `onnxruntime-node`.
        // We never reach it.
        //
        // Trims ~29 MB from Setup.exe (measured 2026-06-27: 777 → 748 MB on
        // Electron 30 + Transformers 4.2.0). The raw
        // `node_modules/onnxruntime-web` directory is ~130 MB on dev disk,
        // but Squirrel LZMA compresses the high-entropy WASM bundles heavily
        // and `app.asar` dedupes — so the shipping delta is much smaller
        // than the dev-disk delta.
        //
        // electron-packager normalises paths to POSIX before matching the
        // `ignore` regex, so the leading forward slash is correct on Windows
        // builds. The `(^|\/)` prefix defensively catches nested copies in
        // case npm hoisting changes in the future.
        //
        // If a future code path needs `onnxruntime-web` (e.g. a headless Node
        // worker that explicitly imports it), revert this entry. The
        // Transformers backend resolver in the node bundle is statically
        // pinned to `onnxruntime-node`; a Transformers minor bump COULD in
        // theory flip the default backend, so smoke-test the packaged app
        // when bumping `@huggingface/transformers`.
        ignore: [
            /(^|\/)node_modules\/onnxruntime-web($|\/)/,
        ],
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
