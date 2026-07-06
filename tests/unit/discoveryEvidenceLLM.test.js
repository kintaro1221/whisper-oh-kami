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
