'use strict';

// v0.7.8 follow-ups to the lifecycle regression (tests/unit/regressionLifecycle.test.js):
// the fixture's L03 / L04 mix several properties in one case and stop as
// BLOCKED_OBSERVABILITY where the product deliberately behaves differently
// (the refiner coalesces a same-session request instead of running two in
// parallel; gemini.js has no API to seed a legacy state). These tests pin
// each property on its own.
//
//   L03'  要求の併合 → 最新入力の再解析: a refine requested while one is in
//         flight is coalesced; the in-flight result (read from an older
//         transcript) is superseded, not applied, and exactly one rerun reads
//         the newest transcript.
//   L04a  現在の降格・復活防止: an LLM 'empty' downgrades only with a grounded
//         retraction quote, and a retracted sentence is never resurrected.
//   L04b  旧状態の移行検証: what is persisted, and whether a pre-v0.7.8
//         evidence snapshot is ever read back.
//
// Mocks follow regressionLifecycle.test.js: Electron, @google/genai (Live
// connect + the refiner's generateContent as controllable promises — no
// network), storage (except where the real module is loaded explicitly),
// Deepgram and the native audio helper. gemini.js, turn events, the evidence
// store and the refiner are the real code.

jest.mock(
    'electron',
    () => {
        const mockSend = jest.fn();
        return {
            app: { isPackaged: false, getPath: jest.fn(() => '/tmp/whisper-oh-kami-followups-userData') },
            BrowserWindow: { getAllWindows: () => [{ webContents: { send: mockSend, executeJavaScript: async () => 'true' } }] },
            ipcMain: { handle: jest.fn(), on: jest.fn() },
            __mockSend: mockSend,
        };
    },
    { virtual: true }
);

jest.mock('@google/genai', () => {
    const mockGenerateContentStream = jest.fn();
    const mockGenerateContent = jest.fn();
    const mockLiveConnect = jest.fn(async () => ({ close: jest.fn(async () => {}), sendRealtimeInput: jest.fn(async () => {}) }));
    class GoogleGenAI {
        constructor() {
            this.models = { generateContentStream: mockGenerateContentStream, generateContent: mockGenerateContent };
            this.live = { connect: mockLiveConnect };
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
    getSttMode: jest.fn(() => 'local'),
}));

jest.mock('../../src/utils/deepgram', () => ({ DeepgramService: jest.fn() }));
jest.mock('../../src/utils/audioCapture', () => ({
    setIpcHooks: jest.fn(),
    stop: jest.fn(),
    start: jest.fn(),
    getStatus: jest.fn(() => ({})),
}));

const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..');
const REFINER_INTERVAL_MS = 5000;

const flush = () => new Promise(res => setImmediate(res));
const settle = async (n = 6) => {
    for (let i = 0; i < n; i++) await flush();
};

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

// Boots gemini.js (fresh module registry per test, jest.config resetModules)
// with the refiner's generateContent as a controllable promise and its 5s
// scheduler tick captured instead of a real timer.
function bootGemini() {
    const electron = require('electron');
    const genai = require('@google/genai');
    const gemini = require('../../src/utils/gemini');
    gemini.setupGeminiIpcHandlers({ current: null });
    const handlers = new Map(electron.ipcMain.handle.mock.calls.map(c => [c[0], c[1]]));
    const ipc = channel => {
        const h = handlers.get(channel);
        if (!h) throw new Error(`no ipcMain.handle for ${channel}`);
        return h;
    };

    const llmCalls = [];
    genai.__mockGenerateContent.mockImplementation(req => {
        const d = deferred();
        llmCalls.push({ d, prompt: JSON.stringify(req && req.contents) });
        return d.promise;
    });

    const realSetInterval = global.setInterval;
    const ticks = { refiner: null };
    const setIntervalSpy = jest.spyOn(global, 'setInterval').mockImplementation((fn, ms, ...rest) => {
        if (ms === REFINER_INTERVAL_MS) {
            ticks.refiner = fn;
            return { refinerTimer: true };
        }
        return realSetInterval(fn, ms, ...rest);
    });

    return { gemini, ipc, llmCalls, ticks, mockSend: electron.__mockSend, restore: () => setIntervalSpy.mockRestore() };
}

const llmRows = (state, key) => state.elements[key].evidence.filter(r => r.source === 'llm');

describe("L03' 要求の併合 → 最新入力の再解析", () => {
    const OLD = '予算は年間300万円で考えています';
    const NEW = '訂正します、予算は年間500万円です';

    test('through gemini.js (BYOK, stub LLM): the in-flight result is superseded and exactly one rerun reads the newest transcript', async () => {
        const g = bootGemini();
        try {
            const started = await g.ipc('initialize-gemini')({}, 'test-key', '', 'sales', 'ja-JP');
            expect(started).toEqual({ success: true });
            expect(typeof g.ticks.refiner).toBe('function');

            // Request 1 reads the old transcript.
            g.gemini.pushTurnEvent({ speaker: 'opponent', text: OLD, source: 'deepgram' });
            g.ticks.refiner();
            await settle();
            expect(g.llmCalls).toHaveLength(1);
            expect(g.llmCalls[0].prompt).toContain(OLD);
            expect(g.llmCalls[0].prompt).not.toContain(NEW);

            // Newer input arrives and a second refine is requested while
            // request 1 is in flight: coalesced, no parallel call.
            g.gemini.pushTurnEvent({ speaker: 'opponent', text: NEW, source: 'deepgram' });
            g.ticks.refiner();
            await settle();
            expect(g.llmCalls).toHaveLength(1);

            // Request 1 completes with 予算 filled for the OLD value.
            g.llmCalls[0].d.resolve({ text: JSON.stringify({ budget: { status: 'filled', quote: OLD } }) });
            await settle();

            // Not applied as final: no LLM row exists yet ...
            const afterFirst = await g.ipc('dev:dump-discovery-evidence')();
            expect(llmRows(afterFirst, 'budget')).toEqual([]);
            // ... and exactly one rerun started, on the newest transcript.
            expect(g.llmCalls).toHaveLength(2);
            expect(g.llmCalls[1].prompt).toContain(NEW);

            g.llmCalls[1].d.resolve({ text: JSON.stringify({ budget: { status: 'filled', quote: NEW } }) });
            await settle();

            const final = await g.ipc('dev:dump-discovery-evidence')();
            const rows = llmRows(final, 'budget');
            expect(rows.map(r => r.text)).toEqual([NEW]);
            expect(rows[0].values.amount).toMatchObject({ yen: 5000000, period: 'annual' });
            expect(rows.some(r => r.text === OLD)).toBe(false);

            // No further rerun: nothing pending, no new turns.
            g.ticks.refiner();
            await settle();
            expect(g.llmCalls).toHaveLength(2);
        } finally {
            await g.ipc('close-session')({});
            g.restore();
        }
    });

    test('refiner level: the first call reports superseded with the rerun applied; the stats show two calls and nothing pending', async () => {
        const { createDiscoveryEvidenceLLM } = require('../../src/utils/discoveryEvidenceLLM');
        const { createDiscoveryEvidence } = require('../../src/utils/discoveryEvidence');
        const store = createDiscoveryEvidence();
        const calls = [];
        let transcript = `[相手] ${OLD}`;
        const applied = [];
        const refiner = createDiscoveryEvidenceLLM({
            llmClient: {
                generateContent(prompt) {
                    const d = deferred();
                    calls.push({ d, prompt });
                    return d.promise;
                },
            },
            getTranscript: () => transcript,
            getProviderMode: () => 'byok',
            applyResult: (parsed, t) => {
                applied.push(t);
                store.applyLLMResult(parsed, t);
            },
            now: () => 1_000_000,
        });

        refiner.notifyTurn();
        const first = refiner.maybeRefine();
        await flush();
        expect(calls).toHaveLength(1);

        transcript = `[相手] ${OLD}\n[相手] ${NEW}`;
        refiner.notifyTurn();
        const second = await refiner.maybeRefine();
        expect(second).toEqual({ fired: false, reason: 'in-flight', pending: true });
        expect(refiner.getStats().pendingRerun).toBe(true);

        calls[0].d.resolve(JSON.stringify({ budget: { status: 'filled', quote: OLD } }));
        await settle();
        expect(calls).toHaveLength(2);
        expect(calls[1].prompt).toContain(NEW);
        calls[1].d.resolve(JSON.stringify({ budget: { status: 'filled', quote: NEW } }));
        const result = await first;

        expect(result.applied).toBe(false);
        expect(result.reason).toBe('superseded');
        expect(result.rerun).toMatchObject({ fired: true, applied: true });
        expect(applied).toEqual([transcript]);
        expect(refiner.getStats()).toMatchObject({ callCount: 2, inFlight: false, pendingRerun: false, turnsSinceLastRun: 0 });
        expect(store.getState().elements.budget.evidence.map(r => r.text)).toEqual([NEW]);
    });
});

describe('L04a 現在の降格・復活防止 (store-direct)', () => {
    const STATED = '予算は年間300万円です';
    const RETRACTION = '先ほどの予算の話は撤回させてください';

    function detectedStore() {
        const { createDiscoveryEvidence } = require('../../src/utils/discoveryEvidence');
        const store = createDiscoveryEvidence();
        store.processNewTurn({ speaker: 'opponent', text: STATED });
        expect(store.getState().elements.budget.status).toBe('detected');
        return store;
    }

    test('an LLM empty without a grounded retraction quote never downgrades', () => {
        const store = detectedStore();
        const transcript = `[相手] ${STATED}`;
        for (const quote of ['', '予算は撤回します' /* not in the transcript */, STATED /* grounded but not a retraction */]) {
            const r = store.applyLLMResult({ budget: { status: 'empty', quote } }, transcript);
            expect(r.changed).toBe(false);
            expect(r.state.elements.budget.status).toBe('detected');
        }
    });

    test('a grounded retraction quote downgrades to empty and leaves a retraction marker', () => {
        const store = detectedStore();
        const transcript = `[相手] ${STATED}\n[相手] ${RETRACTION}`;
        const r = store.applyLLMResult({ budget: { status: 'empty', quote: RETRACTION } }, transcript);

        expect(r.changed).toBe(true);
        const budget = r.state.elements.budget;
        expect(budget.status).toBe('empty');
        expect(budget.evidence.find(e => e.text === STATED).retracted).toBe(true);
        expect(budget.evidence.filter(e => e.polarity === 'retraction')).toEqual([
            expect.objectContaining({ text: RETRACTION, source: 'llm', retracted: false }),
        ]);
    });

    test('after the retraction, an LLM filled quoting the retracted sentence does not resurrect it', () => {
        const store = detectedStore();
        const transcript = `[相手] ${STATED}\n[相手] ${RETRACTION}`;
        store.applyLLMResult({ budget: { status: 'empty', quote: RETRACTION } }, transcript);
        const before = store.getState().elements.budget.evidence.length;

        const r = store.applyLLMResult({ budget: { status: 'filled', quote: STATED } }, transcript);

        expect(r.changed).toBe(false);
        expect(r.state.elements.budget.status).toBe('empty');
        expect(r.state.elements.budget.evidence).toHaveLength(before);
        expect(r.state.elements.budget.evidence.some(e => e.text === STATED && !e.retracted)).toBe(false);
    });
});

describe('L04b 旧状態の移行検証', () => {
    // Pre-v0.7.8 evidence snapshot (v0.7.7 dump(): no candidateCount; rows
    // without id / qualifier / conflictBasis / selection / superseded /
    // values; elements without actions / confirmation / conflict).
    const LEGACY_SNAPSHOT = {
        elements: {
            pain: {
                status: 'detected',
                evidence: [
                    {
                        text: '請求書の転記ミスが毎月起きています',
                        timestamp: 1759600000000,
                        source: 'regex',
                        retracted: false,
                        specificity: 'concrete',
                        polarity: null,
                    },
                ],
                selfMentions: [],
                lastUpdate: 1759600000000,
                confirmed: false,
            },
            kpi: { status: 'empty', evidence: [], selfMentions: [], lastUpdate: null, confirmed: false },
            authority: {
                status: 'partial',
                evidence: [
                    {
                        text: '部長にも相談します',
                        timestamp: 1759600001000,
                        source: 'regex',
                        retracted: false,
                        specificity: 'keyword',
                        polarity: null,
                    },
                ],
                selfMentions: [],
                lastUpdate: 1759600001000,
                confirmed: false,
            },
            budget: {
                status: 'confirmed',
                evidence: [
                    {
                        text: '予算は年間100万円です',
                        timestamp: 1759600002000,
                        source: 'llm',
                        retracted: false,
                        specificity: 'concrete',
                        polarity: null,
                    },
                ],
                selfMentions: [],
                lastUpdate: 1759600002000,
                confirmed: true,
            },
            timeline: { status: 'empty', evidence: [], selfMentions: [], lastUpdate: null, confirmed: false },
        },
        totalScore: 2,
        confirmedCount: 1,
        updatedAt: 1759600003000,
    };
    const LEGACY_SESSION_ID = '1759600000000';

    let base;
    afterEach(() => {
        if (base && fs.existsSync(base)) fs.rmSync(base, { recursive: true, force: true });
        base = null;
    });

    test('persisted: a legacy snapshot inside a saved session reads back unchanged and survives a later feedback append', () => {
        // The real storage module (the file-level mock only serves gemini.js).
        const storage = jest.requireActual('../../src/storage');
        const { appendFeedbackEventToSession, createFeedbackEvent } = require('../../src/utils/feedbackEvents');
        base = fs.mkdtempSync(path.join(os.tmpdir(), 'wok-l04b-'));
        const current = path.join(base, 'whisper-oh-kami-config');
        storage.__setConfigDirsForTest({ current, legacy: path.join(base, 'legacy-config') });
        try {
            const legacyEvent = {
                timestamp: 1759600004000,
                responseIndex: 0,
                rating: 'helpful',
                note: '',
                profile: 'sales',
                evidenceSnapshot: LEGACY_SNAPSHOT,
            };
            fs.mkdirSync(path.join(current, 'history'), { recursive: true });
            fs.writeFileSync(
                path.join(current, 'history', `${LEGACY_SESSION_ID}.json`),
                JSON.stringify({
                    sessionId: LEGACY_SESSION_ID,
                    createdAt: 1759600000000,
                    profile: 'sales',
                    conversationHistory: [],
                    feedbackEvents: [legacyEvent],
                })
            );

            const loaded = storage.getSession(LEGACY_SESSION_ID);
            expect(loaded.feedbackEvents[0].evidenceSnapshot).toEqual(LEGACY_SNAPSHOT);

            // The renderer's feedback path: append a new event to the loaded
            // session and save (AssistantView → storage:save-session).
            const next = appendFeedbackEventToSession(loaded, createFeedbackEvent({ rating: 'off_target', evidenceSnapshot: null }, 1759600005000));
            expect(storage.saveSession(LEGACY_SESSION_ID, { feedbackEvents: next.feedbackEvents })).toBe(true);

            const reread = storage.getSession(LEGACY_SESSION_ID);
            expect(reread.feedbackEvents).toHaveLength(2);
            // Pass-through: nothing is migrated, nothing is invented.
            expect(reread.feedbackEvents[0].evidenceSnapshot).toEqual(LEGACY_SNAPSHOT);
            const snap = reread.feedbackEvents[0].evidenceSnapshot;
            expect(snap).not.toHaveProperty('candidateCount');
            for (const el of Object.values(snap.elements)) {
                expect(el.status).not.toBe('candidate');
                for (const row of el.evidence) {
                    expect(row).not.toHaveProperty('id');
                    expect(row).not.toHaveProperty('qualifier');
                }
            }
            expect(
                Object.entries(snap.elements)
                    .filter(([, el]) => el.confirmed)
                    .map(([k]) => k)
            ).toEqual(['budget']);
            expect(storage.getAllSessions()).toEqual([expect.objectContaining({ sessionId: LEGACY_SESSION_ID, feedbackCount: 2 })]);
        } finally {
            storage.__setConfigDirsForTest({});
        }
    });

    test('never read back: no product code consumes evidenceSnapshot, HistoryView ignores it, and the store has no hydrate API', () => {
        const srcFiles = [];
        const walk = dir => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const p = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    if (entry.name !== '__tests__' && entry.name !== 'assets') walk(p);
                } else if (entry.name.endsWith('.js')) srcFiles.push(p);
            }
        };
        walk(path.join(REPO_ROOT, 'src'));

        const uses = [];
        for (const file of srcFiles) {
            const rel = path.relative(REPO_ROOT, file).replace(/\\/g, '/');
            fs.readFileSync(file, 'utf8')
                .split('\n')
                .forEach(line => {
                    if (line.includes('evidenceSnapshot')) uses.push({ rel, line: line.trim() });
                });
        }
        // Only the writer module and object-literal writes (evidenceSnapshot: …).
        for (const u of uses) {
            if (u.rel === 'src/utils/feedbackEvents.js') continue;
            expect(u.line).toMatch(/^evidenceSnapshot\s*:/);
        }
        expect(uses.some(u => u.rel === 'src/components/views/HistoryView.js')).toBe(false);

        const { createDiscoveryEvidence } = require('../../src/utils/discoveryEvidence');
        const api = Object.keys(createDiscoveryEvidence());
        expect(api.filter(k => /load|hydrate|restore|import|setState/i.test(k))).toEqual([]);
    });

    test('the live store starts empty after close-session and after a new session — no state carries over', async () => {
        const g = bootGemini();
        try {
            await g.ipc('initialize-gemini')({}, 'test-key', '', 'sales', 'ja-JP');
            g.gemini.pushTurnEvent({ speaker: 'opponent', text: '予算は年間100万円です', source: 'deepgram' });
            expect((await g.ipc('dev:dump-discovery-evidence')()).elements.budget.status).toBe('detected');

            await g.ipc('close-session')({});
            const afterClose = await g.ipc('dev:dump-discovery-evidence')();
            expect(afterClose.totalScore).toBe(0);
            expect(afterClose.candidateCount).toBe(0);
            expect(Object.values(afterClose.elements).every(el => el.status === 'empty' && el.evidence.length === 0)).toBe(true);
            expect(await g.ipc('dev:dump-turn-events')()).toEqual([]);

            await g.ipc('initialize-gemini')({}, 'test-key', '', 'sales', 'ja-JP');
            const afterStart = await g.ipc('dev:dump-discovery-evidence')();
            expect(Object.values(afterStart.elements).every(el => el.status === 'empty' && el.evidence.length === 0)).toBe(true);
        } finally {
            await g.ipc('close-session')({});
            g.restore();
        }
    });
});
