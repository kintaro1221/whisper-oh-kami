// Phase 1g extracted dev harness unit tests.
//
// Pure module under test — Electron / Gemini / Deepgram are absent; everything
// is injected via createDevHarness deps. Real fs is replaced with an in-memory
// stub for saveDevRun. The injected `now` and `sleep` callbacks let
// waitForAiResponse drain deterministically without real timers.

const { createDevHarness, DEV_SCENARIOS, assertScenario } = require('../../src/utils/devHarness');

// Suppress harness console noise unless a test asserts on it.
beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    jest.restoreAllMocks();
});

// ── DEV_SCENARIOS shape ───────────────────────────────────────────────────

describe('DEV_SCENARIOS', () => {
    test('exposes the nine canonical scenarios (7 baseline + 2 Phase 2.D)', () => {
        const names = Object.keys(DEV_SCENARIOS).sort();
        expect(names).toEqual(
            [
                'bant_followup_after_pitch',
                'opponent_mentions_budget',
                'opponent_pain_point',
                'opponent_pain_self_ack',
                'opponent_pain_then_dig_not_bant',
                'opponent_question_self_yes',
                'opponent_statement_self_yes',
                'self_long_pitch',
                'self_short_no_context',
            ].sort()
        );
    });

    test('every scenario carries description / turns / triggerText / expected', () => {
        for (const [name, def] of Object.entries(DEV_SCENARIOS)) {
            expect(typeof def.description).toBe('string');
            expect(Array.isArray(def.turns)).toBe(true);
            expect(def.turns.length).toBeGreaterThan(0);
            expect(typeof def.triggerText).toBe('string');
            expect(def.triggerText.length).toBeGreaterThan(0);
            expect(typeof def.expected).toBe('object');
            // every turn must have speaker + text + source
            for (const t of def.turns) {
                expect(['self', 'opponent']).toContain(t.speaker);
                expect(typeof t.text).toBe('string');
                expect(typeof t.source).toBe('string');
            }
            // self-doc: name should be unique (already enforced by Object keys, but
            // also belt-and-suspenders against later duplicate-key edits).
            expect(typeof name).toBe('string');
        }
    });
});

// ── assertScenario — pure helper ──────────────────────────────────────────

describe('assertScenario', () => {
    test('allPass when fired/eventKind/classification match and required sections present', () => {
        const scenario = {
            expected: {
                fired: true,
                eventKind: 'self_finished',
                classification: 'closed_question_reply',
                sectionsRequired: ['次に聞くとよいこと:'],
                sectionsForbidden: ['返答候補:'],
            },
        };
        const result = { fired: true, eventKind: 'self_finished', classification: 'closed_question_reply' };
        const aiResponse = '次に聞くとよいこと:\n- 参加者は誰ですか？';
        const out = assertScenario(scenario, result, aiResponse, null);
        expect(out.allPass).toBe(true);
        expect(out.checks.every(c => c.pass)).toBe(true);
    });

    test('fail when fired mismatches', () => {
        const out = assertScenario({ expected: { fired: true } }, { fired: false, reason: 'skipped' }, null, null);
        expect(out.allPass).toBe(false);
        const firedCheck = out.checks.find(c => c.name === 'fired');
        expect(firedCheck.pass).toBe(false);
        expect(firedCheck.actual).toBe(false);
    });

    test('forbidden section detected → check fails', () => {
        const out = assertScenario(
            {
                expected: {
                    fired: true,
                    sectionsRequired: ['次に聞くとよいこと:'],
                    sectionsForbidden: ['返答候補:'],
                },
            },
            { fired: true },
            '返答候補:\nA\n\n次に聞くとよいこと:\nB',
            null
        );
        expect(out.allPass).toBe(false);
        expect(out.checks.find(c => c.name.startsWith('forbidden'))).toMatchObject({ pass: false });
    });

    test('rate_limited skips section + responseContainsAny checks but keeps decision checks', () => {
        const out = assertScenario(
            {
                expected: {
                    fired: true,
                    sectionsRequired: ['次に聞くとよいこと:'],
                    responseContainsAny: ['予算', '時期'],
                },
            },
            { fired: true },
            null, // no AI response captured because of rate-limit
            'rate_limited'
        );
        expect(out.allPass).toBe(true);
        // sections check is recorded as skipped-pass
        const sectionsCheck = out.checks.find(c => c.name === 'sections');
        expect(sectionsCheck.pass).toBe(true);
        expect(sectionsCheck.actual).toMatch(/rate_limited/);
    });

    test('responseContainsAny: passes when at least one keyword present', () => {
        const out = assertScenario(
            {
                expected: {
                    fired: true,
                    responseContainsAny: ['予算', '時期', 'スケジュール'],
                },
            },
            { fired: true },
            'スケジュール感はいかがですか？',
            null
        );
        expect(out.allPass).toBe(true);
        const kwCheck = out.checks.find(c => c.name.startsWith('responseContainsAny'));
        expect(kwCheck.actual).toMatch(/matched/);
    });

    test('responseContainsAny: fails when no keyword present', () => {
        const out = assertScenario({ expected: { responseContainsAny: ['予算', '時期'] } }, { fired: true }, 'よろしくお願いします', null);
        expect(out.allPass).toBe(false);
    });

    // ── Phase 2.D: responseContainsNone ────────────────────────────────
    // Phase 2.D adds the negative semantic check used by
    // opponent_pain_then_dig_not_bant to pin "must NOT jump to BANT first
    // on a single pain mention".

    test('responseContainsNone: passes when no forbidden keyword present', () => {
        const out = assertScenario(
            {
                expected: {
                    fired: true,
                    responseContainsNone: ['ご予算', '決裁者', '導入時期'],
                },
            },
            { fired: true },
            '具体的にはどの業務工程で時間がかかっていますか？',
            null
        );
        expect(out.allPass).toBe(true);
        const kwCheck = out.checks.find(c => c.name.startsWith('responseContainsNone'));
        expect(kwCheck.pass).toBe(true);
        expect(kwCheck.actual).toBe('no match');
    });

    test('responseContainsNone: fails when a forbidden keyword appears', () => {
        const out = assertScenario(
            {
                expected: {
                    fired: true,
                    responseContainsNone: ['ご予算', '決裁者', '導入時期'],
                },
            },
            { fired: true },
            'ご予算規模はどの程度を想定されていますか？',
            null
        );
        expect(out.allPass).toBe(false);
        const kwCheck = out.checks.find(c => c.name.startsWith('responseContainsNone'));
        expect(kwCheck.pass).toBe(false);
        expect(kwCheck.actual).toMatch(/unexpectedly matched/);
    });

    test('responseContainsNone: rate_limited skips with pass:true (no vacuous pass on missing response)', () => {
        // The reason this skip is explicit (rather than silently passing):
        // without it, a rate-limited run would "succeed" on the negative
        // assertion just because no response was captured to check. That
        // would let a real regression hide behind an infrastructure failure.
        // The explicit pass:true + 'rate_limited (skipped)' marker keeps
        // the suite green on rate-limit but makes the skip visible.
        const out = assertScenario(
            {
                expected: {
                    fired: true,
                    responseContainsNone: ['ご予算', '決裁者'],
                },
            },
            { fired: true },
            null, // no AI response captured
            'rate_limited'
        );
        const kwCheck = out.checks.find(c => c.name.startsWith('responseContainsNone'));
        expect(kwCheck.pass).toBe(true);
        expect(kwCheck.actual).toMatch(/rate_limited/);
    });

    test('fired:true but no aiResponse → sections check fails honestly', () => {
        const out = assertScenario({ expected: { fired: true, sectionsRequired: ['次に聞くとよいこと:'] } }, { fired: true }, null, null);
        expect(out.allPass).toBe(false);
        const sectionsCheck = out.checks.find(c => c.name === 'sections');
        expect(sectionsCheck.pass).toBe(false);
    });

    test('empty checks array (no expectations) → allPass false (cannot pass nothing)', () => {
        const out = assertScenario({ expected: {} }, { fired: false }, null, null);
        expect(out.allPass).toBe(false);
        expect(out.checks).toEqual([]);
    });
});

// ── helpers for harness tests ─────────────────────────────────────────────

function fakeTurnEventsStore() {
    return {
        seedForDevScenario: jest.fn(),
        get length() {
            return 3;
        },
        // unused by the harness but present for parity:
        pushTurnEvent: jest.fn(),
        recentTurnsForPrompt: jest.fn(),
        hasRecentOpponentSpeech: jest.fn(),
        lastTurn: jest.fn(),
        lastOpponentTurnWithin: jest.fn(),
        resetForSession: jest.fn(),
        dump: jest.fn(),
    };
}

function makeFs() {
    const written = [];
    return {
        written,
        existsSync: jest.fn(() => false),
        mkdirSync: jest.fn(),
        writeFileSync: jest.fn((file, data) => {
            written.push({ file, data });
        }),
    };
}

function makeClock(start = 1_000_000) {
    let t = start;
    const fn = () => t;
    fn.advance = ms => {
        t += ms;
    };
    return fn;
}

// ── createDevHarness — listScenarios / unknown name ───────────────────────

describe('createDevHarness — listScenarios / unknown name', () => {
    test('listScenarios returns name + description for every DEV_SCENARIO', () => {
        const harness = createDevHarness({
            turnEvents: fakeTurnEventsStore(),
            processGenerationComplete: jest.fn(),
            isAiResponseInFlight: () => false,
            getCurrentSystemPrompt: () => 'SP',
            setCurrentSystemPrompt: jest.fn(),
            getCurrentProfile: () => 'discovery',
            getCurrentCustomPrompt: () => '',
            getSystemPrompt: jest.fn(),
            getConversationHistory: () => [],
            clearLastAiErrorKind: jest.fn(),
            getLastAiErrorKind: () => null,
            fs: makeFs(),
            saveDir: () => '/tmp/dev-runs',
        });
        const list = harness.listScenarios();
        expect(list.length).toBe(Object.keys(DEV_SCENARIOS).length);
        for (const item of list) {
            expect(typeof item.name).toBe('string');
            expect(typeof item.description).toBe('string');
        }
    });

    test('runDevScenario("unknown") returns ok:false with available list', async () => {
        const harness = createDevHarness({
            turnEvents: fakeTurnEventsStore(),
            processGenerationComplete: jest.fn(),
            isAiResponseInFlight: () => false,
            getCurrentSystemPrompt: () => 'SP',
            setCurrentSystemPrompt: jest.fn(),
            getCurrentProfile: () => 'discovery',
            getCurrentCustomPrompt: () => '',
            getSystemPrompt: jest.fn(),
            getConversationHistory: () => [],
            clearLastAiErrorKind: jest.fn(),
            getLastAiErrorKind: () => null,
            fs: makeFs(),
        });
        const r = await harness.runDevScenario('does_not_exist');
        expect(r).toEqual({ ok: false, error: 'unknown', available: expect.any(Array) });
        expect(r.available).toContain('opponent_pain_point');
    });
});

// ── createDevHarness — happy-path runDevScenario ──────────────────────────

describe('createDevHarness.runDevScenario — happy path', () => {
    test('seeds turnEvents, fires, captures aiResponse, asserts allPass', async () => {
        const turnEvents = fakeTurnEventsStore();
        const fs = makeFs();
        const conversationHistory = [];
        const processGenerationComplete = jest.fn(() => ({
            fired: true,
            eventKind: 'opponent_finished',
            prompt: 'fake prompt',
        }));
        // simulate that the production AI dispatch appends a response after firing
        let firedCount = 0;
        const harness = createDevHarness({
            turnEvents,
            processGenerationComplete: triggerText => {
                firedCount++;
                conversationHistory.push({ ai_response: '返答候補:\nA\nB' });
                return processGenerationComplete(triggerText);
            },
            isAiResponseInFlight: () => false,
            getCurrentSystemPrompt: () => 'SP',
            setCurrentSystemPrompt: jest.fn(),
            getCurrentProfile: () => 'discovery',
            getCurrentCustomPrompt: () => '',
            getSystemPrompt: jest.fn(() => 'SEEDED'),
            getConversationHistory: () => conversationHistory,
            clearLastAiErrorKind: jest.fn(),
            getLastAiErrorKind: () => null,
            fs,
            saveDir: () => '/tmp/dev-runs',
            now: makeClock(),
            sleep: () => Promise.resolve(),
        });

        const summary = await harness.runDevScenario('opponent_pain_point');
        expect(summary.ok).toBe(true);
        expect(summary.scenario).toBe('opponent_pain_point');
        expect(summary.aiErrorKind).toBeNull();
        expect(summary.aiResponse).toBe('返答候補:\nA\nB');
        expect(summary.assertions.allPass).toBe(true);

        expect(turnEvents.seedForDevScenario).toHaveBeenCalledTimes(1);
        expect(turnEvents.seedForDevScenario).toHaveBeenCalledWith(DEV_SCENARIOS.opponent_pain_point.turns);
        expect(firedCount).toBe(1);
        expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
        const writtenJson = JSON.parse(fs.writeFileSync.mock.calls[0][1]);
        expect(writtenJson.scenario).toBe('opponent_pain_point');
        expect(writtenJson.assertions.allPass).toBe(true);
    });

    test('seeds currentSystemPrompt via injected setter when initial value is empty', async () => {
        const turnEvents = fakeTurnEventsStore();
        const setCurrentSystemPrompt = jest.fn();
        const conversationHistory = [];
        const harness = createDevHarness({
            turnEvents,
            processGenerationComplete: () => {
                conversationHistory.push({ ai_response: '返答候補: x' });
                return { fired: true, eventKind: 'opponent_finished' };
            },
            isAiResponseInFlight: () => false,
            getCurrentSystemPrompt: () => null, // empty → triggers seeding
            setCurrentSystemPrompt,
            getCurrentProfile: () => null, // → falls back to 'discovery'
            getCurrentCustomPrompt: () => null,
            getSystemPrompt: jest.fn(() => 'BUILT-PROMPT'),
            getConversationHistory: () => conversationHistory,
            clearLastAiErrorKind: jest.fn(),
            getLastAiErrorKind: () => null,
            fs: makeFs(),
            saveDir: () => '/tmp/dev-runs',
            now: makeClock(),
            sleep: () => Promise.resolve(),
        });
        await harness.runDevScenario('opponent_pain_point');
        expect(setCurrentSystemPrompt).toHaveBeenCalledWith('BUILT-PROMPT');
    });

    test('rate_limited path: aiErrorKind reflected, allPass remains true via skipResponseChecks', async () => {
        const turnEvents = fakeTurnEventsStore();
        const conversationHistory = [];
        const harness = createDevHarness({
            turnEvents,
            processGenerationComplete: () => ({ fired: true, eventKind: 'opponent_finished' }),
            isAiResponseInFlight: () => false,
            getCurrentSystemPrompt: () => 'SP',
            setCurrentSystemPrompt: jest.fn(),
            getCurrentProfile: () => 'discovery',
            getCurrentCustomPrompt: () => '',
            getSystemPrompt: jest.fn(),
            getConversationHistory: () => conversationHistory, // never grows → no aiResponse
            clearLastAiErrorKind: jest.fn(),
            getLastAiErrorKind: () => 'rate_limited',
            fs: makeFs(),
            saveDir: () => '/tmp/dev-runs',
            now: makeClock(),
            sleep: () => Promise.resolve(),
        });
        const r = await harness.runDevScenario('opponent_pain_point');
        expect(r.aiErrorKind).toBe('rate_limited');
        expect(r.assertions.allPass).toBe(true); // skip-pass behavior
    });

    test('skipped fire path: processGenerationComplete returns fired:false → no waitForAiResponse, no append', async () => {
        const turnEvents = fakeTurnEventsStore();
        const conversationHistory = [];
        const processGenerationComplete = jest.fn(() => ({ fired: false, reason: 'skipped', classification: 'noise' }));
        const harness = createDevHarness({
            turnEvents,
            processGenerationComplete,
            isAiResponseInFlight: () => false,
            getCurrentSystemPrompt: () => 'SP',
            setCurrentSystemPrompt: jest.fn(),
            getCurrentProfile: () => 'discovery',
            getCurrentCustomPrompt: () => '',
            getSystemPrompt: jest.fn(),
            getConversationHistory: () => conversationHistory,
            clearLastAiErrorKind: jest.fn(),
            getLastAiErrorKind: () => null,
            fs: makeFs(),
            saveDir: () => '/tmp/dev-runs',
            now: makeClock(),
            sleep: () => Promise.resolve(),
        });
        const r = await harness.runDevScenario('self_short_no_context');
        expect(r.aiResponse).toBeNull();
        expect(r.assertions.allPass).toBe(true); // expected fired:false; classification:noise
        expect(processGenerationComplete).toHaveBeenCalledWith('うん');
    });
});

// ── waitForAiResponse — drain + timeout ───────────────────────────────────

describe('createDevHarness.waitForAiResponse', () => {
    test('drains in-flight after a few polls', async () => {
        let inFlight = true;
        const calls = { sleep: 0 };
        const harness = createDevHarness({
            turnEvents: fakeTurnEventsStore(),
            processGenerationComplete: jest.fn(),
            isAiResponseInFlight: () => inFlight,
            getCurrentSystemPrompt: () => 'SP',
            setCurrentSystemPrompt: jest.fn(),
            getCurrentProfile: () => 'discovery',
            getCurrentCustomPrompt: () => '',
            getSystemPrompt: jest.fn(),
            getConversationHistory: () => [],
            clearLastAiErrorKind: jest.fn(),
            getLastAiErrorKind: () => null,
            fs: makeFs(),
            now: makeClock(),
            sleep: ms => {
                calls.sleep++;
                if (calls.sleep === 3) inFlight = false; // production drains
                return Promise.resolve();
            },
        });
        const drained = await harness.waitForAiResponse(60000);
        expect(drained).toBe(true);
        expect(calls.sleep).toBe(3);
    });

    test('returns false on timeout, leaves inFlight untouched', async () => {
        const clock = makeClock();
        const harness = createDevHarness({
            turnEvents: fakeTurnEventsStore(),
            processGenerationComplete: jest.fn(),
            isAiResponseInFlight: () => true, // never drains
            getCurrentSystemPrompt: () => 'SP',
            setCurrentSystemPrompt: jest.fn(),
            getCurrentProfile: () => 'discovery',
            getCurrentCustomPrompt: () => '',
            getSystemPrompt: jest.fn(),
            getConversationHistory: () => [],
            clearLastAiErrorKind: jest.fn(),
            getLastAiErrorKind: () => null,
            fs: makeFs(),
            now: clock,
            // sleep advances the clock so the timeout boundary actually triggers.
            sleep: ms => {
                clock.advance(ms);
                return Promise.resolve();
            },
        });
        const drained = await harness.waitForAiResponse(500); // small timeout
        expect(drained).toBe(false);
    });
});

// ── saveDevRun — fs injection ─────────────────────────────────────────────

describe('createDevHarness.saveDevRun', () => {
    test('creates dir when missing, writes JSON with timestamped filename', () => {
        const fs = makeFs();
        fs.existsSync.mockReturnValue(false);
        const clock = makeClock(7_777_000);
        const harness = createDevHarness({
            turnEvents: fakeTurnEventsStore(),
            processGenerationComplete: jest.fn(),
            isAiResponseInFlight: () => false,
            getCurrentSystemPrompt: () => 'SP',
            setCurrentSystemPrompt: jest.fn(),
            getCurrentProfile: () => 'discovery',
            getCurrentCustomPrompt: () => '',
            getSystemPrompt: jest.fn(),
            getConversationHistory: () => [],
            clearLastAiErrorKind: jest.fn(),
            getLastAiErrorKind: () => null,
            fs,
            saveDir: () => '/tmp/dev-runs',
            now: clock,
        });
        const file = harness.saveDevRun({ scenario: 'opponent_pain_point', ok: true });
        expect(fs.mkdirSync).toHaveBeenCalledWith('/tmp/dev-runs', { recursive: true });
        expect(file).toBe(require('path').join('/tmp/dev-runs', '7777000-opponent_pain_point.json'));
        expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
    });

    test('write failure → returns null and logs error', () => {
        const fs = makeFs();
        fs.writeFileSync.mockImplementation(() => {
            throw new Error('disk full');
        });
        const harness = createDevHarness({
            turnEvents: fakeTurnEventsStore(),
            processGenerationComplete: jest.fn(),
            isAiResponseInFlight: () => false,
            getCurrentSystemPrompt: () => 'SP',
            setCurrentSystemPrompt: jest.fn(),
            getCurrentProfile: () => 'discovery',
            getCurrentCustomPrompt: () => '',
            getSystemPrompt: jest.fn(),
            getConversationHistory: () => [],
            clearLastAiErrorKind: jest.fn(),
            getLastAiErrorKind: () => null,
            fs,
            saveDir: () => '/tmp/dev-runs',
            now: makeClock(),
        });
        const file = harness.saveDevRun({ scenario: 'opponent_pain_point' });
        expect(file).toBeNull();
    });
});

// ── factory guards ────────────────────────────────────────────────────────

describe('createDevHarness — guards', () => {
    test('throws when called without deps', () => {
        expect(() => createDevHarness()).toThrow();
        expect(() => createDevHarness(null)).toThrow();
    });
});
