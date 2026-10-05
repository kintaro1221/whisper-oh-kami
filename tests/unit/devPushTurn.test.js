'use strict';

// Pins the dev:push-turn IPC handler (src/utils/gemini.js): a real-machine
// UI check without audio. With WOK_DEV=1 a pushed turn goes through the same
// pushTurnEvent hook as a transcription result (turn log, 5-element store,
// renderer discovery-evidence-update); without it the handler is registered
// but refuses with { success: false, reason: 'dev_disabled' } and touches
// nothing.
//
// Same mock setup as geminiSessionGuard.test.js: Electron, @google/genai,
// storage, the native audio helper and Deepgram are mocked; turn events and
// the evidence store are the real code.

const fs = require('fs');
const path = require('path');

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
    const mockGenerateContent = jest.fn();
    class GoogleGenAI {
        constructor() {
            this.models = { generateContentStream: mockGenerateContentStream, generateContent: mockGenerateContent };
        }
    }
    return { GoogleGenAI, Modality: {}, __mockGenerateContent: mockGenerateContent };
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
const gemini = require('../../src/utils/gemini');

const mockSend = electron.__mockSend;

gemini.setupGeminiIpcHandlers({ current: null });
// Snapshot now — clearMocks (jest.config) wipes ipcMain.handle.mock.calls.
const ipcHandlers = new Map(electron.ipcMain.handle.mock.calls.map(c => [c[0], c[1]]));

function ipcHandler(channel) {
    const handler = ipcHandlers.get(channel);
    if (!handler) throw new Error(`no ipcMain.handle for ${channel}`);
    return handler;
}

const pushTurn = payload => ipcHandler('dev:push-turn')({}, payload);
const evidenceUpdates = () => mockSend.mock.calls.filter(c => c[0] === 'discovery-evidence-update');

const ORIGINAL_WOK_DEV = process.env.WOK_DEV;

beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.WOK_DEV;
    gemini.initializeNewSession('sales', '');
    mockSend.mockClear();
});

afterEach(async () => {
    await ipcHandler('close-session')({});
    if (ORIGINAL_WOK_DEV === undefined) delete process.env.WOK_DEV;
    else process.env.WOK_DEV = ORIGINAL_WOK_DEV;
});

describe('dev:push-turn with WOK_DEV=1', () => {
    beforeEach(() => {
        process.env.WOK_DEV = '1';
    });

    test('the handler is registered next to the other dev:* handlers', () => {
        expect(ipcHandlers.has('dev:push-turn')).toBe(true);
        expect(ipcHandlers.has('dev:dump-discovery-evidence')).toBe(true);
    });

    test('an opponent turn 「予算は年間100万円です」 detects the budget and reaches every consumer', async () => {
        const result = await pushTurn({ speaker: 'opponent', text: '予算は年間100万円です' });

        expect(result.success).toBe(true);
        expect(result.state.elements.budget.status).toBe('detected');
        expect(result.state.elements.budget.evidence.some(r => r.text === '予算は年間100万円です')).toBe(true);

        // Same store the dev dump (and the real transcription path) reads.
        const dumped = await ipcHandler('dev:dump-discovery-evidence')();
        expect(dumped.elements.budget.status).toBe('detected');

        // Turn log, as the transcription path would have recorded it.
        const events = await ipcHandler('dev:dump-turn-events')();
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ speaker: 'opponent', text: '予算は年間100万円です', source: 'dev_push_turn' });

        // The renderer was told, so the badges update on a real machine.
        const updates = evidenceUpdates();
        expect(updates).toHaveLength(1);
        expect(updates[0][1].elements.budget.status).toBe('detected');
    });

    test('a self turn is recorded as the salesperson and never raises the badge', async () => {
        const result = await pushTurn({ speaker: 'self', text: '予算は年間100万円ですか' });

        expect(result.success).toBe(true);
        expect(result.state.elements.budget.status).toBe('empty');
        expect(result.state.elements.budget.selfMentions).toHaveLength(1);
        const events = await ipcHandler('dev:dump-turn-events')();
        expect(events[0]).toMatchObject({ speaker: 'self', source: 'dev_push_turn' });
    });

    test.each([
        [{ speaker: 'customer', text: '予算は年間100万円です' }, 'invalid_speaker'],
        [{ speaker: undefined, text: '予算は年間100万円です' }, 'invalid_speaker'],
        [{ speaker: 'opponent', text: '' }, 'empty_text'],
        [{ speaker: 'opponent', text: '   ' }, 'empty_text'],
        [{ speaker: 'opponent', text: 100 }, 'empty_text'],
        [undefined, 'invalid_speaker'],
    ])('rejects %j with %s and changes nothing', async (payload, reason) => {
        const result = await pushTurn(payload);

        expect(result).toEqual({ success: false, reason });
        expect(await ipcHandler('dev:dump-turn-events')()).toEqual([]);
        expect(evidenceUpdates()).toHaveLength(0);
    });
});

describe('dev:push-turn without WOK_DEV=1', () => {
    test.each([[undefined], ['0'], ['true'], ['']])('WOK_DEV=%j refuses with dev_disabled and touches no store', async value => {
        if (value === undefined) delete process.env.WOK_DEV;
        else process.env.WOK_DEV = value;

        const result = await pushTurn({ speaker: 'opponent', text: '予算は年間100万円です' });

        expect(result).toEqual({ success: false, reason: 'dev_disabled' });
        expect(await ipcHandler('dev:dump-turn-events')()).toEqual([]);
        const dumped = await ipcHandler('dev:dump-discovery-evidence')();
        expect(dumped.elements.budget.status).toBe('empty');
        expect(evidenceUpdates()).toHaveLength(0);
    });
});

describe('renderer exposes devPushTurn', () => {
    test('window.devPushTurn invokes dev:push-turn with { speaker, text }', () => {
        const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'utils', 'renderer.js'), 'utf8');
        expect(src).toMatch(/window\.devPushTurn = \(\{ speaker, text \} = \{\}\) => ipcRenderer\.invoke\('dev:push-turn', \{ speaker, text \}\)/);
    });
});
