'use strict';

// Pins the IPC contract between the evidence store (src/utils/discoveryEvidence.js)
// and the renderer for the v0.7.8 manual evidence actions:
//   discovery-evidence-select (key, rowId) → { success, reason }
//   discovery-evidence-confirm (key)       → { success, reason }
// reason is null on success and carries the store's refusal reason otherwise
// (select: no_conflict | row_not_live | unknown_row; confirm: already_confirmed
// | no_candidate | conflict_unresolved | basis_unknown). Terminology: the
// product's 'confirmed' is only the user's manual ✓; automatic detection
// ('detected') is the verification side's "confirmed".
//
// Same mock setup as geminiSessionGuard.test.js: Electron, @google/genai, the
// native audio helper and Deepgram are mocked; the evidence store is real.

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
const gemini = require('../../src/utils/gemini');

const mockSend = electron.__mockSend;

gemini.setupGeminiIpcHandlers({ current: null });
// Snapshot the registered handlers now — clearMocks (jest.config) wipes
// ipcMain.handle.mock.calls before every test.
const ipcHandlers = new Map(electron.ipcMain.handle.mock.calls.map(c => [c[0], c[1]]));

function ipcHandler(channel) {
    const handler = ipcHandlers.get(channel);
    if (!handler) throw new Error(`no ipcMain.handle for ${channel}`);
    return handler;
}

function evidenceUpdates() {
    return mockSend.mock.calls.filter(c => c[0] === 'discovery-evidence-update');
}

async function budgetRows() {
    const state = await ipcHandler('dev:dump-discovery-evidence')({});
    return state.elements.budget.evidence.filter(e => !e.retracted && e.polarity !== 'retraction');
}

function opponent(text) {
    gemini.pushTurnEvent({ speaker: 'opponent', text, source: 'deepgram' });
}

beforeEach(() => {
    // Fresh session = empty evidence store.
    gemini.initializeNewSession('discovery', '');
    mockSend.mockClear();
});
afterEach(async () => {
    // Always leave the module with no live session (clears the 5s refiner).
    await ipcHandler('close-session')({});
});

describe('evidence IPC contract (v0.7.8)', () => {
    test('discovery-evidence-confirm returns success=false with the store reason; select is registered', async () => {
        expect(ipcHandler('discovery-evidence-select')).toEqual(expect.any(Function));
        const r = await ipcHandler('discovery-evidence-confirm')({}, 'budget');
        expect(r).toEqual({ success: false, reason: 'no_candidate' });
        expect(evidenceUpdates()).toHaveLength(0);
    });

    test('select with a bogus rowId is refused (unknown_row) and pushes no update', async () => {
        opponent('本件の承認済み予算は年間100万円と認識しています。');
        mockSend.mockClear();
        const r = await ipcHandler('discovery-evidence-select')({}, 'budget', 999999);
        expect(r).toEqual({ success: false, reason: 'unknown_row' });
        expect(evidenceUpdates()).toHaveLength(0);
    });

    test('select on a row that is not part of a conflict is refused with no_conflict', async () => {
        opponent('本件の承認済み予算は年間100万円と認識しています。');
        const [row] = await budgetRows();
        mockSend.mockClear();
        const r = await ipcHandler('discovery-evidence-select')({}, 'budget', row.id);
        expect(r).toEqual({ success: false, reason: 'no_conflict' });
        expect(evidenceUpdates()).toHaveLength(0);
    });

    test('conflict: confirm refused (conflict_unresolved) → select succeeds → confirm succeeds; each success pushes an update', async () => {
        opponent('本件の承認済み予算は年間100万円と認識しています。');
        opponent('私の手元の承認資料では、本件の年間予算は50万円です。');
        const rows = await budgetRows();
        expect(rows).toHaveLength(2);
        mockSend.mockClear();

        expect(await ipcHandler('discovery-evidence-confirm')({}, 'budget')).toEqual({
            success: false,
            reason: 'conflict_unresolved',
        });
        expect(evidenceUpdates()).toHaveLength(0);

        // The renderer may pass rowId as a string (e.g. a dataset attribute); the handler coerces it.
        expect(await ipcHandler('discovery-evidence-select')({}, 'budget', String(rows[1].id))).toEqual({
            success: true,
            reason: null,
        });
        expect(evidenceUpdates()).toHaveLength(1);
        const afterSelect = evidenceUpdates()[0][1].elements.budget;
        expect(afterSelect.status).toBe('candidate');
        expect(afterSelect.conflict.keptRowId).toBe(rows[1].id);

        expect(await ipcHandler('discovery-evidence-confirm')({}, 'budget')).toEqual({ success: true, reason: null });
        expect(evidenceUpdates()).toHaveLength(2);
        expect(evidenceUpdates()[1][1].elements.budget.confirmed).toBe(true);

        expect(await ipcHandler('discovery-evidence-confirm')({}, 'budget')).toEqual({
            success: false,
            reason: 'already_confirmed',
        });
        expect(evidenceUpdates()).toHaveLength(2);
    });
});
