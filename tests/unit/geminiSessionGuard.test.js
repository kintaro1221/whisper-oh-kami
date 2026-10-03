'use strict';

// Pins the session-boundary contract of src/utils/gemini.js (v0.7.5 trust
// gates): once close-session has run, nothing that completes or arrives
// late — a Gemma advice stream, a Live generationComplete, a delayed
// send-image-content — may resurrect a "ghost" session (transcription-clear
// / save-conversation-turn to the renderer, a restarted 5s Discovery LLM
// refinement timer) or leave the in-flight gate stuck.
//
// The real gemini.js pulls in Electron, @google/genai, the native audio
// helper and Deepgram, so those are mocked; everything else (turn events,
// discovery evidence, prompt building) is the real code.

jest.mock(
    'electron',
    () => {
        const mockSend = jest.fn();
        return {
            BrowserWindow: { getAllWindows: () => [{ webContents: { send: mockSend } }] },
            ipcMain: { handle: jest.fn(), on: jest.fn() },
            __mockSend: mockSend,
        };
    },
    { virtual: true }
);

jest.mock('@google/genai', () => {
    const mockGenerateContentStream = jest.fn();
    class GoogleGenAI {
        constructor() {
            this.models = { generateContentStream: mockGenerateContentStream };
        }
    }
    return { GoogleGenAI, Modality: {}, __mockGenerateContentStream: mockGenerateContentStream };
});

jest.mock('../../src/storage', () => ({
    getAvailableModel: jest.fn(() => 'gemini-2.5-flash'),
    incrementLimitCount: jest.fn(),
    getApiKey: jest.fn(() => 'test-key'),
    getGroqApiKey: jest.fn(() => ''),
    getDeepgramApiKey: jest.fn(() => ''),
    incrementCharUsage: jest.fn(),
    getModelForToday: jest.fn(() => null),
    getSttMode: jest.fn(() => 'cloud'),
}));

jest.mock('../../src/utils/localai', () => ({ closeLocalSession: jest.fn() }));
jest.mock('../../src/utils/deepgram', () => ({ DeepgramService: jest.fn() }));
jest.mock('../../src/utils/audioCapture', () => ({
    setIpcHooks: jest.fn(),
    stop: jest.fn(),
    start: jest.fn(),
    getStatus: jest.fn(() => ({})),
}));

const electron = require('electron');
const genai = require('@google/genai');
const gemini = require('../../src/utils/gemini');

const mockSend = electron.__mockSend;
const mockGenerate = genai.__mockGenerateContentStream;

const geminiSessionRef = { current: null };
gemini.setupGeminiIpcHandlers(geminiSessionRef);
// Snapshot the registered handlers now — clearMocks (jest.config) wipes
// ipcMain.handle.mock.calls before every test.
const ipcHandlers = new Map(electron.ipcMain.handle.mock.calls.map(c => [c[0], c[1]]));

function ipcHandler(channel) {
    const handler = ipcHandlers.get(channel);
    if (!handler) throw new Error(`no ipcMain.handle for ${channel}`);
    return handler;
}

function sentChannels() {
    return mockSend.mock.calls.map(c => c[0]);
}

// An async-iterable stream whose single chunk is released by the test.
function controllableStream() {
    let release;
    const gate = new Promise(res => (release = res));
    const stream = {
        async *[Symbol.asyncIterator]() {
            const text = await gate;
            yield { text };
        },
    };
    return { stream, release };
}

const flush = () => new Promise(res => setImmediate(res));

let setIntervalSpy;
beforeEach(() => {
    jest.clearAllMocks();
    setIntervalSpy = jest.spyOn(global, 'setInterval');
});
afterEach(async () => {
    // Always leave the module with no live session (clears the 5s refiner).
    await ipcHandler('close-session')({});
    setIntervalSpy.mockRestore();
});

describe('close-session never leaves a ghost session behind', () => {
    test('a late save (stale token or no token) after close does not re-initialize a session', async () => {
        gemini.initializeNewSession('discovery', '');
        await ipcHandler('close-session')({});
        expect(gemini.getCurrentSessionData().sessionId).toBeNull();

        mockSend.mockClear();
        setIntervalSpy.mockClear();

        gemini.saveConversationTurn('x', 'y', { isStale: () => true });
        gemini.saveConversationTurn('x', 'y');

        expect(sentChannels()).not.toContain('transcription-clear');
        expect(sentChannels()).not.toContain('save-conversation-turn');
        expect(setIntervalSpy).not.toHaveBeenCalled();
        expect(gemini.getCurrentSessionData().sessionId).toBeNull();
        expect(gemini.getCurrentSessionData().history).toEqual([]);
    });

    test('a delayed send-image-content after close is refused without calling Gemini', async () => {
        gemini.initializeNewSession('discovery', '');
        await ipcHandler('close-session')({});
        mockSend.mockClear();
        setIntervalSpy.mockClear();

        const result = await gemini.sendImageToGeminiHttp('aGVsbG8=', 'describe');

        expect(result).toEqual({ success: false, error: 'session_closed' });
        expect(mockGenerate).not.toHaveBeenCalled();
        expect(sentChannels()).not.toContain('save-screen-analysis');
        expect(sentChannels()).not.toContain('transcription-clear');
        expect(setIntervalSpy).not.toHaveBeenCalled();
    });

    test('a Live generationComplete after close does not start an advice call', async () => {
        gemini.initializeNewSession('discovery', '');
        await ipcHandler('close-session')({});
        mockSend.mockClear();

        gemini.processGenerationComplete('予算はどのくらいを想定されていますか');
        await flush();

        expect(mockGenerate).not.toHaveBeenCalled();
        expect(gemini.isAiResponseInFlight()).toBe(false);
        expect(sentChannels()).not.toContain('transcription-clear');
    });
});

describe('close-session invalidates in-flight advice', () => {
    test('bumps the generation, releases the in-flight gate, and drops the late stream', async () => {
        gemini.initializeNewSession('discovery', '');
        const { stream, release } = controllableStream();
        mockGenerate.mockResolvedValueOnce(stream);

        gemini.processGenerationComplete('予算はどのくらいを想定されていますか');
        await flush();
        expect(mockGenerate).toHaveBeenCalledTimes(1);
        expect(gemini.isAiResponseInFlight()).toBe(true);

        const before = gemini.getSessionGeneration();
        await ipcHandler('close-session')({});
        expect(gemini.getSessionGeneration()).toBeGreaterThan(before);
        expect(gemini.isAiResponseInFlight()).toBe(false);

        mockSend.mockClear();
        setIntervalSpy.mockClear();
        release('旧商談の予算は100万円です');
        await flush();
        await flush();

        expect(sentChannels()).not.toContain('new-response');
        expect(sentChannels()).not.toContain('save-conversation-turn');
        expect(sentChannels()).not.toContain('transcription-clear');
        expect(setIntervalSpy).not.toHaveBeenCalled();
        expect(gemini.isAiResponseInFlight()).toBe(false);
    });
});

// v0.7.5 final review (validator L03): a request that lands while an advice
// stream is in flight is no longer dropped — the latest one is kept and
// dispatched once after the current call finishes (never a queue).
describe('requests arriving while advice is in flight', () => {
    function plainStream(text = 'ok') {
        return {
            async *[Symbol.asyncIterator]() {
                yield { text };
            },
        };
    }
    const callText = n => JSON.stringify(mockGenerate.mock.calls[n][0].contents);
    const settle = async () => {
        for (let i = 0; i < 6; i++) await flush();
    };

    test('two Live triggers while in flight → exactly one follow-up built from the latest turns', async () => {
        gemini.initializeNewSession('discovery', '');
        const first = controllableStream();
        mockGenerate.mockResolvedValueOnce(first.stream).mockResolvedValue(plainStream());

        gemini.pushTurnEvent({ speaker: 'opponent', text: '予算はどのくらいを想定されていますか', source: 'deepgram' });
        gemini.processGenerationComplete('予算はどのくらいを想定されていますか');
        await flush();
        expect(mockGenerate).toHaveBeenCalledTimes(1);

        gemini.pushTurnEvent({ speaker: 'opponent', text: '導入時期は来年の春を考えていますか', source: 'deepgram' });
        expect(gemini.processGenerationComplete('導入時期は来年の春を考えていますか').fired).toBe(false);
        gemini.pushTurnEvent({ speaker: 'opponent', text: '最終的な決裁者はどなたになりますか', source: 'deepgram' });
        expect(gemini.processGenerationComplete('最終的な決裁者はどなたになりますか').fired).toBe(false);
        expect(mockGenerate).toHaveBeenCalledTimes(1);

        first.release('一つ目の助言');
        await settle();
        expect(mockGenerate).toHaveBeenCalledTimes(2);
        expect(callText(1)).toContain('最終的な決裁者はどなたになりますか');
        await settle();
        expect(mockGenerate).toHaveBeenCalledTimes(2);
        expect(gemini.isAiResponseInFlight()).toBe(false);
    });

    test('two typed messages while in flight → exactly one follow-up with the latest text', async () => {
        gemini.initializeNewSession('discovery', '');
        geminiSessionRef.current = { sendRealtimeInput: jest.fn(async () => {}), close: jest.fn(async () => {}) };
        const first = controllableStream();
        mockGenerate.mockResolvedValueOnce(first.stream).mockResolvedValue(plainStream());
        const send = ipcHandler('send-text-message');

        await send({}, '最初のメッセージです');
        await flush();
        expect(mockGenerate).toHaveBeenCalledTimes(1);
        await send({}, '二番目のメッセージです');
        await send({}, '三番目のメッセージです');
        expect(mockGenerate).toHaveBeenCalledTimes(1);

        first.release('助言');
        await settle();
        expect(mockGenerate).toHaveBeenCalledTimes(2);
        expect(callText(1)).toContain('三番目のメッセージです');
        expect(callText(1)).not.toContain('二番目のメッセージです');
        await settle();
        expect(mockGenerate).toHaveBeenCalledTimes(2);
    });

    test('close-session drops the pending request', async () => {
        gemini.initializeNewSession('discovery', '');
        const first = controllableStream();
        mockGenerate.mockResolvedValueOnce(first.stream).mockResolvedValue(plainStream());
        gemini.processGenerationComplete('予算はどのくらいを想定されていますか');
        await flush();
        gemini.processGenerationComplete('導入時期はいつ頃をお考えですか');
        await ipcHandler('close-session')({});
        first.release('x');
        await settle();
        expect(mockGenerate).toHaveBeenCalledTimes(1);
    });

    test('a new session never dispatches the previous session’s pending request', async () => {
        gemini.initializeNewSession('discovery', '');
        const first = controllableStream();
        const second = controllableStream();
        mockGenerate.mockResolvedValueOnce(first.stream).mockResolvedValueOnce(second.stream).mockResolvedValue(plainStream());
        gemini.processGenerationComplete('予算はどのくらいを想定されていますか');
        await flush();
        gemini.processGenerationComplete('旧商談の保留リクエストです');
        gemini.initializeNewSession('discovery', '');
        gemini.processGenerationComplete('新しい商談の最初の質問です');
        await flush();
        expect(mockGenerate).toHaveBeenCalledTimes(2);
        second.release('新しい助言');
        first.release('古い助言');
        await settle();
        expect(mockGenerate).toHaveBeenCalledTimes(2);
    });
});
