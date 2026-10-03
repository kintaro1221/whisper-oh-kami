// discoveryEvidenceLLM.js unit tests — commit 2 of Phase 1.A+ LLM hybrid.
//
// Mocks the llmClient (no real Gemini call) and the providerMode getter.
// Verifies: parser tolerance, scheduler debounce / cooldown / cap, privacy
// gate (only 'byok' mode triggers LLM refinement), happy-path apply.

const {
    createDiscoveryEvidenceLLM,
    parseLLMResponse,
    buildPrompt,
    shouldNotifyDiscoveryLLMRefiner,
    COOLDOWN_MS,
    TURN_THRESHOLD,
    MAX_CALLS_PER_SESSION,
} = require('../../src/utils/discoveryEvidenceLLM');

function makeClock(start = 1_700_000_000_000) {
    let t = start;
    const fn = () => t;
    fn.advance = ms => {
        t += ms;
    };
    fn.set = ms => {
        t = ms;
    };
    return fn;
}

// ── parseLLMResponse ─────────────────────────────────────────────────────

describe('parseLLMResponse', () => {
    test('valid JSON with all 5 elements parses correctly', () => {
        const raw = JSON.stringify({
            pain: { status: 'partial', quote: '人手不足' },
            kpi: { status: 'empty', quote: '' },
            authority: { status: 'filled', quote: '部長の決済' },
            budget: { status: 'filled', quote: '一千万円' },
            timeline: { status: 'empty', quote: '' },
        });
        const result = parseLLMResponse(raw);
        expect(result).not.toBeNull();
        expect(result.pain.status).toBe('partial');
        expect(result.budget.quote).toBe('一千万円');
        expect(result.kpi.status).toBe('empty');
    });

    test('JSON wrapped in ```json fence is extracted', () => {
        const raw = '前置きあり\n```json\n{"pain":{"status":"partial","quote":"x"}}\n```\n後置き';
        const result = parseLLMResponse(raw);
        expect(result).not.toBeNull();
        expect(result.pain.status).toBe('partial');
    });

    test('JSON wrapped in plain text (no fence) is extracted via {} fallback', () => {
        const raw = 'Sure, here it is: {"kpi":{"status":"filled","quote":"100件"}} done.';
        const result = parseLLMResponse(raw);
        expect(result).not.toBeNull();
        expect(result.kpi.status).toBe('filled');
    });

    test('completely invalid input → null', () => {
        expect(parseLLMResponse('not json at all')).toBeNull();
        expect(parseLLMResponse('')).toBeNull();
        expect(parseLLMResponse(null)).toBeNull();
        expect(parseLLMResponse(undefined)).toBeNull();
    });

    test('unknown status values are dropped (not defaulted)', () => {
        const raw = JSON.stringify({
            pain: { status: 'huh', quote: 'x' },
            kpi: { status: 'partial', quote: 'y' },
        });
        const result = parseLLMResponse(raw);
        expect(result.pain).toBeUndefined();
        expect(result.kpi.status).toBe('partial');
    });

    test('returns null when no element survives validation', () => {
        const raw = JSON.stringify({ pain: { status: 'wat' }, foo: { status: 'partial' } });
        expect(parseLLMResponse(raw)).toBeNull();
    });
});

// ── buildPrompt ──────────────────────────────────────────────────────────

describe('buildPrompt', () => {
    test('embeds the transcript between header and footer', () => {
        const t = '[相手] 予算は厳しい\n[自分] そうですか';
        const prompt = buildPrompt(t);
        expect(prompt).toContain(t);
        expect(prompt).toContain('JSON のみで返答');
        expect(prompt).toContain('5要素');
    });
});

// ── scheduler ────────────────────────────────────────────────────────────

describe('createDiscoveryEvidenceLLM scheduler', () => {
    function makeMockLLM(response) {
        return { generateContent: jest.fn().mockResolvedValue(response) };
    }

    test('privacy gate: providerMode "local" never fires the LLM', async () => {
        const llmClient = makeMockLLM('');
        const refiner = createDiscoveryEvidenceLLM({
            llmClient,
            getProviderMode: () => 'local',
            getTranscript: () => '[相手] 予算は厳しい',
        });
        for (let i = 0; i < 10; i++) refiner.notifyTurn();
        const r = await refiner.maybeRefine();
        expect(r.fired).toBe(false);
        expect(r.reason).toBe('privacy-gate');
        expect(llmClient.generateContent).not.toHaveBeenCalled();
    });

    test('privacy gate: providerMode "cloud" (Groq) never fires the LLM', async () => {
        const llmClient = makeMockLLM('');
        const refiner = createDiscoveryEvidenceLLM({
            llmClient,
            getProviderMode: () => 'cloud',
            getTranscript: () => '[相手] x',
        });
        for (let i = 0; i < 10; i++) refiner.notifyTurn();
        const r = await refiner.maybeRefine();
        expect(r.fired).toBe(false);
        expect(r.reason).toBe('privacy-gate');
        expect(llmClient.generateContent).not.toHaveBeenCalled();
    });

    test('cooldown: skipped within COOLDOWN_MS when turn threshold not met', async () => {
        const clock = makeClock();
        const llmClient = makeMockLLM(JSON.stringify({ pain: { status: 'partial', quote: 'x' } }));
        const refiner = createDiscoveryEvidenceLLM({
            llmClient,
            now: clock,
            getProviderMode: () => 'byok',
            getTranscript: () => '[相手] x',
        });
        // First fire (TURN_THRESHOLD met).
        for (let i = 0; i < TURN_THRESHOLD; i++) refiner.notifyTurn();
        await refiner.maybeRefine();
        expect(llmClient.generateContent).toHaveBeenCalledTimes(1);
        // Within cooldown, only 1 new turn → must skip.
        refiner.notifyTurn();
        const r = await refiner.maybeRefine();
        expect(r.fired).toBe(false);
        expect(r.reason).toBe('cooldown');
        expect(llmClient.generateContent).toHaveBeenCalledTimes(1);
    });

    test('cap: stops firing after MAX_CALLS_PER_SESSION', async () => {
        const llmClient = makeMockLLM(JSON.stringify({ pain: { status: 'partial', quote: 'x' } }));
        const clock = makeClock();
        const refiner = createDiscoveryEvidenceLLM({
            llmClient,
            now: clock,
            getProviderMode: () => 'byok',
            getTranscript: () => '[相手] x',
        });
        for (let i = 0; i < MAX_CALLS_PER_SESSION; i++) {
            for (let j = 0; j < TURN_THRESHOLD; j++) refiner.notifyTurn();
            await refiner.maybeRefine();
            clock.advance(COOLDOWN_MS + 1);
        }
        expect(llmClient.generateContent).toHaveBeenCalledTimes(MAX_CALLS_PER_SESSION);
        for (let j = 0; j < TURN_THRESHOLD; j++) refiner.notifyTurn();
        const r = await refiner.maybeRefine();
        expect(r.fired).toBe(false);
        expect(r.reason).toBe('cap-exceeded');
        expect(llmClient.generateContent).toHaveBeenCalledTimes(MAX_CALLS_PER_SESSION);
    });

    test('happy path: fires, parses, calls applyResult with parsed + transcript', async () => {
        const llmResponse = JSON.stringify({
            budget: { status: 'filled', quote: '一千万円' },
        });
        const llmClient = makeMockLLM(llmResponse);
        const applied = jest.fn();
        const refiner = createDiscoveryEvidenceLLM({
            llmClient,
            getProviderMode: () => 'byok',
            getTranscript: () => '[相手] 予算は一千万円程度です',
            applyResult: applied,
        });
        for (let i = 0; i < TURN_THRESHOLD; i++) refiner.notifyTurn();
        const r = await refiner.maybeRefine();
        expect(r.fired).toBe(true);
        expect(r.applied).toBe(true);
        expect(applied).toHaveBeenCalledTimes(1);
        const [parsed, transcript] = applied.mock.calls[0];
        expect(parsed.budget.status).toBe('filled');
        expect(transcript).toContain('一千万円');
    });

    test('parse failure: applyResult NOT called, no crash, reason recorded', async () => {
        const llmClient = makeMockLLM('completely not JSON');
        const applied = jest.fn();
        const refiner = createDiscoveryEvidenceLLM({
            llmClient,
            getProviderMode: () => 'byok',
            getTranscript: () => '[相手] x',
            applyResult: applied,
        });
        for (let i = 0; i < TURN_THRESHOLD; i++) refiner.notifyTurn();
        const r = await refiner.maybeRefine();
        expect(r.fired).toBe(true);
        expect(r.applied).toBe(false);
        expect(r.reason).toBe('parse-failed');
        expect(applied).not.toHaveBeenCalled();
    });

    test('reset() clears all scheduler state', async () => {
        const llmClient = makeMockLLM(JSON.stringify({ pain: { status: 'partial', quote: 'x' } }));
        const clock = makeClock();
        const refiner = createDiscoveryEvidenceLLM({
            llmClient,
            now: clock,
            getProviderMode: () => 'byok',
            getTranscript: () => '[相手] x',
        });
        for (let i = 0; i < TURN_THRESHOLD; i++) refiner.notifyTurn();
        await refiner.maybeRefine();
        expect(refiner.getStats().callCount).toBe(1);
        refiner.reset();
        expect(refiner.getStats()).toEqual({
            lastRunAt: 0,
            inFlight: false,
            callCount: 0,
            turnsSinceLastRun: 0,
            // generation is monotonic across resets (v0.7.5 stale-refinement guard)
            generation: 1,
            pendingRerun: false,
        });
    });
});

// ── shouldNotifyDiscoveryLLMRefiner (PR-γ Phase 2.B) ──────────────────────
//
// Pins the policy contract: only opponent turns warrant a refiner
// notification. The predicate lives next to the scheduler it gates so
// any future change to MAX_CALLS_PER_SESSION / TURN_THRESHOLD / cooldown
// accounting has one obvious place to consult. Production caller is
// gemini.js#pushTurnEvent.

describe('shouldNotifyDiscoveryLLMRefiner', () => {
    test('opponent → true (only speaker that can contribute new 5-element evidence)', () => {
        expect(shouldNotifyDiscoveryLLMRefiner({ speaker: 'opponent', text: '残業が月50時間で' })).toBe(true);
    });

    test('self → false (pitch / ack / filler is never opponent evidence)', () => {
        expect(shouldNotifyDiscoveryLLMRefiner({ speaker: 'self', text: '弊社のソリューションは...' })).toBe(false);
        expect(shouldNotifyDiscoveryLLMRefiner({ speaker: 'self', text: 'はい' })).toBe(false);
    });

    test('missing event / missing speaker → false (defensive: refiner quota is precious)', () => {
        expect(shouldNotifyDiscoveryLLMRefiner(null)).toBe(false);
        expect(shouldNotifyDiscoveryLLMRefiner(undefined)).toBe(false);
        expect(shouldNotifyDiscoveryLLMRefiner({})).toBe(false);
        expect(shouldNotifyDiscoveryLLMRefiner({ text: 'no speaker', source: 'deepgram' })).toBe(false);
        // Unknown speaker values fall through to false — whitelist semantics.
        expect(shouldNotifyDiscoveryLLMRefiner({ speaker: 'system', text: 'foo' })).toBe(false);
        expect(shouldNotifyDiscoveryLLMRefiner({ speaker: 'Opponent', text: 'foo' })).toBe(false);
    });
});

describe('generation guard (v0.7.5)', () => {
    function deferredClient() {
        let release;
        const pending = new Promise(res => {
            release = res;
        });
        return { client: { generateContent: () => pending }, release };
    }
    function armed(deps) {
        const clock = makeClock();
        const refiner = createDiscoveryEvidenceLLM({
            getProviderMode: () => 'byok',
            getTranscript: () => '[相手] 予算は100万円です',
            now: clock,
            ...deps,
        });
        for (let i = 0; i < TURN_THRESHOLD; i++) refiner.notifyTurn();
        clock.advance(COOLDOWN_MS + 1);
        return refiner;
    }

    test('reset() while in flight discards the old response', async () => {
        const { client, release } = deferredClient();
        const applyResult = jest.fn();
        const refiner = armed({ llmClient: client, applyResult });
        const p = refiner.maybeRefine();
        refiner.reset();
        release(JSON.stringify({ budget: { status: 'filled', quote: '予算は100万円です' } }));
        const r = await p;
        expect(r).toEqual({ fired: true, applied: false, reason: 'stale' });
        expect(applyResult).not.toHaveBeenCalled();
    });

    test('stop → immediate restart: only the newest generation applies', async () => {
        const first = deferredClient();
        const second = deferredClient();
        const applyResult = jest.fn();
        let current = first.client;
        const refiner = armed({ llmClient: { generateContent: p => current.generateContent(p) }, applyResult });
        const p1 = refiner.maybeRefine();
        refiner.reset(); // stop
        current = second.client; // restart with a new call
        for (let i = 0; i < TURN_THRESHOLD; i++) refiner.notifyTurn();
        const p2 = refiner.maybeRefine();
        first.release(JSON.stringify({ budget: { status: 'filled', quote: 'OLD' } }));
        second.release(JSON.stringify({ budget: { status: 'filled', quote: '予算は100万円です' } }));
        const [r1, r2] = await Promise.all([p1, p2]);
        expect(r1.reason).toBe('stale');
        expect(r2.applied).toBe(true);
        expect(applyResult).toHaveBeenCalledTimes(1);
        expect(applyResult.mock.calls[0][0].budget.quote).toBe('予算は100万円です');
    });

    test('an uncancellable late response after two resets is dropped and inFlight is not stuck', async () => {
        const { client, release } = deferredClient();
        const applyResult = jest.fn();
        const refiner = armed({ llmClient: client, applyResult });
        const p = refiner.maybeRefine();
        refiner.reset();
        refiner.reset();
        expect(refiner.getStats().inFlight).toBe(false);
        release('{"budget":{"status":"filled","quote":"予算は100万円です"}}');
        expect((await p).reason).toBe('stale');
        expect(applyResult).not.toHaveBeenCalled();
        expect(refiner.getStats().generation).toBe(2);
    });
});

describe('final-review fixes: prompt contract + same-session freshness (v0.7.5)', () => {
    test('prompt forbids filled for negated / hypothetical / third-party / retracted content and asks for the retraction quote', () => {
        const prompt = buildPrompt('[相手] x');
        expect(prompt).toContain('否定・仮定・他社の話・撤回された内容は filled にしない');
        expect(prompt).toContain('撤回・否定された要素は status を empty にし、その撤回・否定の発話を quote に入れる');
        expect(prompt).not.toContain('無ければ空文字');
    });

    test('parseLLMResponse keeps a non-empty quote on an empty status', () => {
        const r = parseLLMResponse(JSON.stringify({ budget: { status: 'empty', quote: '予算は未定です' } }));
        expect(r.budget).toEqual({ status: 'empty', quote: '予算は未定です' });
    });

    test('a refine requested while in flight is coalesced into one rerun on the newest transcript', async () => {
        const { createDiscoveryEvidence } = require('../../src/utils/discoveryEvidence');
        const store = createDiscoveryEvidence();
        const turns = [];
        const say = text => {
            turns.push(`[相手] ${text}`);
            store.processNewTurn({ speaker: 'opponent', text });
        };
        const releases = [];
        const llmClient = {
            generateContent: jest.fn(
                () =>
                    new Promise(res => {
                        releases.push(res);
                    })
            ),
        };
        const clock = makeClock();
        const refiner = createDiscoveryEvidenceLLM({
            llmClient,
            getProviderMode: () => 'byok',
            getTranscript: () => turns.join('\n'),
            applyResult: (parsed, transcript) => store.applyLLMResult(parsed, transcript),
            now: clock,
        });

        say('予算は100万円です');
        for (let i = 0; i < TURN_THRESHOLD; i++) refiner.notifyTurn();
        clock.advance(COOLDOWN_MS + 1);
        const p1 = refiner.maybeRefine();
        expect(llmClient.generateContent).toHaveBeenCalledTimes(1);

        say('先ほどの予算は撤回します。予算は未定です');
        refiner.notifyTurn();
        const r2 = await refiner.maybeRefine();
        expect(r2).toEqual({ fired: false, reason: 'in-flight', pending: true });
        // A second request while still in flight does not queue another run.
        refiner.notifyTurn();
        expect(await refiner.maybeRefine()).toEqual({ fired: false, reason: 'in-flight', pending: true });

        releases[0](JSON.stringify({ budget: { status: 'filled', quote: '予算は100万円' } }));
        await new Promise(r => setImmediate(r));
        expect(llmClient.generateContent).toHaveBeenCalledTimes(2);
        expect(llmClient.generateContent.mock.calls[1][0]).toContain('先ほどの予算は撤回します');
        releases[1](JSON.stringify({ budget: { status: 'empty', quote: '予算は未定です' } }));
        const r1 = await p1;
        expect(r1.applied).toBe(false);
        expect(r1.reason).toBe('superseded');
        expect(r1.rerun.applied).toBe(true);
        expect(llmClient.generateContent).toHaveBeenCalledTimes(2);
        expect(store.getState().elements.budget.status).toBe('partial');
        expect(store.getState().totalScore).toBe(0);
        expect(refiner.getStats().inFlight).toBe(false);
    });

    test('no rerun when nothing new arrived while in flight', async () => {
        let release;
        const llmClient = { generateContent: jest.fn(() => new Promise(res => (release = res))) };
        const clock = makeClock();
        const applyResult = jest.fn();
        const refiner = createDiscoveryEvidenceLLM({
            llmClient,
            getProviderMode: () => 'byok',
            getTranscript: () => '[相手] 予算は100万円です',
            applyResult,
            now: clock,
        });
        for (let i = 0; i < TURN_THRESHOLD; i++) refiner.notifyTurn();
        clock.advance(COOLDOWN_MS + 1);
        const p = refiner.maybeRefine();
        await refiner.maybeRefine(); // in flight, but no new turn
        release(JSON.stringify({ budget: { status: 'filled', quote: '予算は100万円です' } }));
        const r = await p;
        expect(r.applied).toBe(true);
        expect(r.rerun).toBeUndefined();
        expect(llmClient.generateContent).toHaveBeenCalledTimes(1);
        expect(applyResult).toHaveBeenCalledTimes(1);
    });

    test('reset() drops a pending rerun', async () => {
        let release;
        const llmClient = { generateContent: jest.fn(() => new Promise(res => (release = res))) };
        const clock = makeClock();
        const refiner = createDiscoveryEvidenceLLM({
            llmClient,
            getProviderMode: () => 'byok',
            getTranscript: () => '[相手] 予算は100万円です',
            now: clock,
        });
        for (let i = 0; i < TURN_THRESHOLD; i++) refiner.notifyTurn();
        clock.advance(COOLDOWN_MS + 1);
        const p = refiner.maybeRefine();
        refiner.notifyTurn();
        await refiner.maybeRefine();
        refiner.reset();
        release('{}');
        expect((await p).reason).toBe('stale');
        expect(llmClient.generateContent).toHaveBeenCalledTimes(1);
    });

    test('the raw LLM output is only logged on parse failure when WOK_DEBUG=1', async () => {
        const run = async () => {
            const log = jest.fn();
            const refiner = createDiscoveryEvidenceLLM({
                llmClient: { generateContent: async () => 'SECRET-TRANSCRIPT-ECHO' },
                getProviderMode: () => 'byok',
                getTranscript: () => '[相手] x',
                log,
            });
            for (let i = 0; i < TURN_THRESHOLD; i++) refiner.notifyTurn();
            await refiner.maybeRefine();
            return log.mock.calls.flat().join(' ');
        };
        const prev = process.env.WOK_DEBUG;
        try {
            delete process.env.WOK_DEBUG;
            expect(await run()).not.toContain('SECRET-TRANSCRIPT-ECHO');
            process.env.WOK_DEBUG = '1';
            expect(await run()).toContain('SECRET-TRANSCRIPT-ECHO');
        } finally {
            if (prev === undefined) delete process.env.WOK_DEBUG;
            else process.env.WOK_DEBUG = prev;
        }
    });
});
