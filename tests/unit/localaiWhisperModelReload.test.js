'use strict';

// Rewritten 2026-09 (external review must-fix): localai.js's
// loadWhisperPipeline() used to cache `whisperPipeline` forever once loaded,
// ignoring the `modelName` argument on every subsequent call — switching
// models in Customize (tiny <-> small <-> kotoba) silently kept using
// whichever model loaded first. That was fixed, but the OLD pipeline (and
// its ONNX runtime session) was never released on switch — a memory leak on
// every model change. This suite now exercises the real behavior: it mocks
// `electron` (virtual) and `src/utils/gemini` (real module pulls in
// audioCapture / Deepgram / native deps we don't want in a unit test), then
// drives localai.js's public API (initializeTrialSession) with a fake
// @huggingface/transformers loader injected via the test-only
// `_setTransformersLoaderForTest` DI hook.
//
// Why a DI hook instead of `jest.mock('@huggingface/transformers', ...,
// { virtual: true })`: localai.js loads transformers via a native dynamic
// `import()` (it's an ESM-only package). Confirmed empirically that Jest's
// module registry does NOT intercept a native dynamic import() the way it
// intercepts require() — even with a virtual mock registered, the import()
// call throws "A dynamic import callback was invoked without
// --experimental-vm-modules" in this project's Jest config (no
// experimental-vm-modules flag, no babel dynamic-import transform). Hence
// localai.js exposes `_setTransformersLoaderForTest` purely for this test.

jest.mock(
    'electron',
    () => ({
        app: {
            isPackaged: false,
            getPath: jest.fn(() => '/tmp/whisper-oh-kami-test-userData'),
        },
    }),
    { virtual: true }
);

jest.mock('../../src/utils/gemini', () => ({
    sendToRenderer: jest.fn(),
    initializeNewSession: jest.fn(),
    saveConversationTurn: jest.fn(),
    pushTurnEvent: jest.fn(),
}));

// localai.js keeps whisperPipeline/loadedWhisperModelName as module-level
// state with no reset function, and jest.config.js's `resetModules: true`
// only clears the module REGISTRY (so a stale `require`d reference from an
// earlier test would keep its old state) — so every test below explicitly
// re-requires a fresh instance of localai.js via jest.resetModules(), rather
// than sharing one `require` across the whole file. That keeps each test's
// "model A is currently loaded" starting state actually true.
function freshLocalai() {
    jest.resetModules();
    return require('../../src/utils/localai');
}

// Builds a fake transformers.js pipeline: a callable "function object" (like
// the real Pipeline instance, which is callable and also carries a
// `.dispose()` method) that resolves to a fixed transcription result.
function makeFakePipelineInstance(label) {
    const fn = jest.fn(async () => ({ text: `transcribed by ${label}` }));
    fn.dispose = jest.fn(async () => {});
    return fn;
}

// Builds a fake transformers.js module: { pipeline, env }. `pipeline()`
// records every call (task, modelName, opts) and every call's resulting env
// snapshot (so useFSCache can be asserted per-call), then resolves with a
// fresh fake pipeline instance for that model — unless an override map
// supplies one (used to hand back a pipeline whose dispose() is
// controllable).
function makeFakeTransformers({ instancesByModel = {} } = {}) {
    const env = {};
    const calls = []; // { modelName, envSnapshotAtCallTime }
    const pipeline = jest.fn(async (task, modelName /*, opts */) => {
        calls.push({ modelName, useFSCacheAtCallTime: env.useFSCache });
        return instancesByModel[modelName] || makeFakePipelineInstance(modelName);
    });
    return { module: { pipeline, env }, calls, env };
}

async function flushMicrotasks(times = 5) {
    for (let i = 0; i < times; i++) {
        await Promise.resolve();
    }
}

// Builds a fake pipeline instance whose calls resolve/reject only when the
// test explicitly tells them to (via the returned `.calls[N].resolve(...)`
// / `.reject(...)`), so a test can hold two concurrent "inference calls" in
// flight simultaneously and settle them in whichever order it wants — used
// to exercise transcribeInFlightSet (a Set, not a single slot) in
// localai.js's disposeWhisperPipeline / transcribeAudio.
function makeControllablePipelineInstance() {
    const calls = [];
    const fn = jest.fn(() => {
        let resolve, reject;
        const promise = new Promise((res, rej) => {
            resolve = res;
            reject = rej;
        });
        calls.push({ promise, resolve, reject });
        return promise;
    });
    fn.dispose = jest.fn(async () => {});
    fn.calls = calls;
    return fn;
}

describe('localai.js loadWhisperPipeline — model switch disposes the old pipeline', () => {
    test('switching from model A to model B calls A pipeline instance.dispose()', async () => {
        const localai = freshLocalai();
        const pipelineA = makeFakePipelineInstance('A');
        const pipelineB = makeFakePipelineInstance('B');
        const { module: fakeTransformers } = makeFakeTransformers({
            instancesByModel: { 'model-a': pipelineA, 'model-b': pipelineB },
        });
        localai._setTransformersLoaderForTest(async () => fakeTransformers);

        const initA = await localai.initializeTrialSession('model-a', 'discovery');
        expect(initA).toBe(true);
        expect(pipelineA.dispose).not.toHaveBeenCalled();

        const initB = await localai.initializeTrialSession('model-b', 'discovery');
        expect(initB).toBe(true);
        expect(pipelineA.dispose).toHaveBeenCalledTimes(1);
    });

    test('re-requesting the SAME model does not dispose it', async () => {
        const localai = freshLocalai();
        const pipelineA = makeFakePipelineInstance('A');
        const { module: fakeTransformers } = makeFakeTransformers({
            instancesByModel: { 'model-a': pipelineA },
        });
        localai._setTransformersLoaderForTest(async () => fakeTransformers);

        await localai.initializeTrialSession('model-a', 'discovery');
        await localai.initializeTrialSession('model-a', 'discovery');

        expect(pipelineA.dispose).not.toHaveBeenCalled();
    });

    test('the new pipeline is not created until the old one finishes disposing', async () => {
        const localai = freshLocalai();
        let resolveDispose;
        const disposePromise = new Promise(resolve => {
            resolveDispose = resolve;
        });
        const pipelineA = makeFakePipelineInstance('A');
        pipelineA.dispose = jest.fn(() => disposePromise);
        const pipelineB = makeFakePipelineInstance('B');

        const { module: fakeTransformers, calls } = makeFakeTransformers({
            instancesByModel: { 'model-a': pipelineA, 'model-b': pipelineB },
        });
        localai._setTransformersLoaderForTest(async () => fakeTransformers);

        await localai.initializeTrialSession('model-a', 'discovery');
        expect(calls.map(c => c.modelName)).toEqual(['model-a']);

        // Start the switch to model-b, but do not await it yet: dispose()'s
        // promise is still pending, so loadWhisperPipeline should be
        // blocked before ever calling pipeline('model-b').
        const switchPromise = localai.initializeTrialSession('model-b', 'discovery');
        await flushMicrotasks();

        expect(pipelineA.dispose).toHaveBeenCalledTimes(1);
        expect(calls.map(c => c.modelName)).toEqual(['model-a']); // still only A — B not called yet

        // Now let dispose() resolve and confirm B loads afterward.
        resolveDispose();
        const switchResult = await switchPromise;

        expect(switchResult).toBe(true);
        expect(calls.map(c => c.modelName)).toEqual(['model-a', 'model-b']);
    });

    test('a dispose() rejection is caught/logged and does not block loading the new model', async () => {
        const localai = freshLocalai();
        const pipelineA = makeFakePipelineInstance('A');
        pipelineA.dispose = jest.fn(async () => {
            throw new Error('boom: dispose failed');
        });
        const pipelineB = makeFakePipelineInstance('B');
        const { module: fakeTransformers, calls } = makeFakeTransformers({
            instancesByModel: { 'model-a': pipelineA, 'model-b': pipelineB },
        });
        localai._setTransformersLoaderForTest(async () => fakeTransformers);

        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        try {
            await localai.initializeTrialSession('model-a', 'discovery');
            const result = await localai.initializeTrialSession('model-b', 'discovery');

            expect(result).toBe(true);
            expect(calls.map(c => c.modelName)).toEqual(['model-a', 'model-b']);
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                expect.stringContaining('Failed to dispose previous Whisper pipeline'),
                'model-a',
                expect.any(Error)
            );
        } finally {
            consoleErrorSpy.mockRestore();
        }
    });
});

describe('localai.js loadWhisperPipeline — env.useFSCache (bundled models bypass the filesystem cache)', () => {
    test('sets env.useFSCache = false when loading a bundled model (Xenova/whisper-small)', async () => {
        const localai = freshLocalai();
        const { module: fakeTransformers, calls } = makeFakeTransformers();
        localai._setTransformersLoaderForTest(async () => fakeTransformers);
        // Inject the bundled check so this case does not depend on whether
        // resources/whisper-models/ has actually been fetched on this machine.
        localai._setBundledModelCheckForTest(() => true);

        await localai.initializeTrialSession('Xenova/whisper-small', 'discovery');

        expect(calls).toHaveLength(1);
        expect(calls[0].modelName).toBe('Xenova/whisper-small');
        expect(calls[0].useFSCacheAtCallTime).toBe(false);
    });

    test('sets env.useFSCache = true when loading a non-bundled (remote) model such as kotoba', async () => {
        const localai = freshLocalai();
        const { module: fakeTransformers, calls } = makeFakeTransformers();
        localai._setTransformersLoaderForTest(async () => fakeTransformers);
        localai._setBundledModelCheckForTest(() => false);

        await localai.initializeTrialSession('onnx-community/kotoba-whisper-v2.2-ONNX', 'discovery');

        expect(calls).toHaveLength(1);
        expect(calls[0].useFSCacheAtCallTime).toBe(true);
    });
});

// 2026-09 (external review must-fix #2): transcribeInFlight used to be a
// single Promise slot, but VAD's processVAD() fires handleSpeechEnd() (and
// therefore transcribeAudio()) without awaiting it — so a second speech
// segment can start transcribing before the first one resolves. With a
// single slot, starting transcription B silently overwrote the tracked
// reference to transcription A: disposeWhisperPipeline would then only wait
// for B, and could dispose the pipeline (release its ONNX session) while A
// was still running on it. transcribeInFlightSet (a Set) fixes this by
// tracking every concurrent in-flight inference and waiting for ALL of them
// (Promise.allSettled) before disposing.
describe('localai.js transcribeInFlightSet — disposal waits for ALL concurrent in-flight transcriptions', () => {
    test('B resolves first: dispose is NOT called until A also resolves', async () => {
        const localai = freshLocalai();
        const pipelineA = makeControllablePipelineInstance();
        const pipelineB = makeFakePipelineInstance('B');
        const { module: fakeTransformers } = makeFakeTransformers({
            instancesByModel: { 'model-a': pipelineA, 'model-b': pipelineB },
        });
        localai._setTransformersLoaderForTest(async () => fakeTransformers);

        await localai.initializeTrialSession('model-a', 'discovery');

        // Start two concurrent transcriptions on pipeline A, neither awaited
        // yet — mirrors VAD firing handleSpeechEnd() without awaiting it.
        const promiseA = localai._transcribeAudioForTest(Buffer.alloc(10));
        const promiseB = localai._transcribeAudioForTest(Buffer.alloc(10));
        await flushMicrotasks();
        expect(pipelineA.calls).toHaveLength(2);

        // Resolve only the second ("B") inference call.
        pipelineA.calls[1].resolve({ text: 'b result' });
        await promiseB;

        // Start a model switch — this must wait for A (still in flight)
        // before disposing pipeline A.
        const switchPromise = localai.initializeTrialSession('model-b', 'discovery');
        await flushMicrotasks();
        expect(pipelineA.dispose).not.toHaveBeenCalled();

        // Now resolve A and let everything settle.
        pipelineA.calls[0].resolve({ text: 'a result' });
        await promiseA;
        const switchResult = await switchPromise;

        expect(switchResult).toBe(true);
        expect(pipelineA.dispose).toHaveBeenCalledTimes(1);
    });

    test('A resolves first: dispose is NOT called until B also resolves', async () => {
        const localai = freshLocalai();
        const pipelineA = makeControllablePipelineInstance();
        const pipelineB = makeFakePipelineInstance('B');
        const { module: fakeTransformers } = makeFakeTransformers({
            instancesByModel: { 'model-a': pipelineA, 'model-b': pipelineB },
        });
        localai._setTransformersLoaderForTest(async () => fakeTransformers);

        await localai.initializeTrialSession('model-a', 'discovery');

        const promiseA = localai._transcribeAudioForTest(Buffer.alloc(10));
        const promiseB = localai._transcribeAudioForTest(Buffer.alloc(10));
        await flushMicrotasks();
        expect(pipelineA.calls).toHaveLength(2);

        // Resolve only the first ("A") inference call this time.
        pipelineA.calls[0].resolve({ text: 'a result' });
        await promiseA;

        const switchPromise = localai.initializeTrialSession('model-b', 'discovery');
        await flushMicrotasks();
        expect(pipelineA.dispose).not.toHaveBeenCalled();

        pipelineA.calls[1].resolve({ text: 'b result' });
        await promiseB;
        const switchResult = await switchPromise;

        expect(switchResult).toBe(true);
        expect(pipelineA.dispose).toHaveBeenCalledTimes(1);
    });
});

// 2026-09 (external review should-fix #3): isBundledModelAvailableLocally()
// used to call fs.existsSync() directly against the real
// resources/whisper-models/ directory, so a test asserting the "not
// bundled" branch (useFSCache=true, whisper-downloading sent) only actually
// passed on a checkout where that directory had not been fetched — and the
// "bundled" branch's test only passed once it had. _setBundledModelCheckForTest
// makes the bundled/not-bundled decision injectable so both branches are
// deterministic regardless of what's actually on disk.
describe('localai.js isBundledModelAvailableLocally — injectable via _setBundledModelCheckForTest', () => {
    afterEach(() => {
        // Nothing to reset here: freshLocalai() re-requires the module (via
        // jest.resetModules()) for every test, so each test's injected check
        // function only ever applies to that test's own localai instance.
    });

    test('bundled === true: useFSCache=false and no whisper-downloading event is sent', async () => {
        const localai = freshLocalai();
        const { sendToRenderer } = require('../../src/utils/gemini');
        localai._setBundledModelCheckForTest(() => true);

        const { module: fakeTransformers, calls } = makeFakeTransformers();
        localai._setTransformersLoaderForTest(async () => fakeTransformers);

        const result = await localai.initializeTrialSession('any-model-name', 'discovery');

        expect(result).toBe(true);
        expect(calls).toHaveLength(1);
        expect(calls[0].useFSCacheAtCallTime).toBe(false);
        expect(sendToRenderer).not.toHaveBeenCalledWith('whisper-downloading', true);
    });

    test('bundled === false: useFSCache=true and whisper-downloading=true is sent', async () => {
        const localai = freshLocalai();
        const { sendToRenderer } = require('../../src/utils/gemini');
        localai._setBundledModelCheckForTest(() => false);

        const { module: fakeTransformers, calls } = makeFakeTransformers();
        localai._setTransformersLoaderForTest(async () => fakeTransformers);

        const result = await localai.initializeTrialSession('any-model-name', 'discovery');

        expect(result).toBe(true);
        expect(calls).toHaveLength(1);
        expect(calls[0].useFSCacheAtCallTime).toBe(true);
        expect(sendToRenderer).toHaveBeenCalledWith('whisper-downloading', true);
    });
});
