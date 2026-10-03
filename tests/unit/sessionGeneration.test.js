const { createGenerationCounter } = require('../../src/utils/sessionGeneration');

// Minimal stand-in for a streaming advice call: it writes chunks to `ui`,
// appends to `history`, and saves a turn — exactly the three sinks a stale
// result must never reach.
async function fakeAdvice(counter, chunks, sinks) {
    const token = counter.capture();
    let text = '';
    for (const c of chunks) {
        await c; // each chunk is a promise the test controls
        if (token.isStale()) return 'stale';
        text += await c;
        sinks.ui.push(text);
    }
    if (token.isStale()) return 'stale';
    sinks.history.push(text);
    sinks.saved.push({ generation: token.generation, text });
    return 'done';
}

describe('createGenerationCounter', () => {
    test('capture().isStale flips after bump', () => {
        const c = createGenerationCounter();
        const t = c.capture();
        expect(t.isStale()).toBe(false);
        c.bump();
        expect(t.isStale()).toBe(true);
        expect(c.current).toBe(1);
    });

    test('stop → immediate restart: the old stream writes nothing after the bump', async () => {
        const c = createGenerationCounter();
        const sinks = { ui: [], history: [], saved: [] };
        let r1, r2;
        const p1 = new Promise(res => (r1 = res));
        const p2 = new Promise(res => (r2 = res));
        const run = fakeAdvice(c, [p1, p2], sinks);
        r1('旧商談の');
        await Promise.resolve();
        c.bump(); // stop
        c.bump(); // restart (initializeNewSession)
        r2('予算');
        expect(await run).toBe('stale');
        expect(sinks.history).toEqual([]);
        expect(sinks.saved).toEqual([]);
    });

    test('switching to another session: only the new generation saves', async () => {
        const c = createGenerationCounter();
        const sinks = { ui: [], history: [], saved: [] };
        let rOld, rNew;
        const old = fakeAdvice(c, [new Promise(res => (rOld = res))], sinks);
        c.bump();
        const fresh = fakeAdvice(c, [new Promise(res => (rNew = res))], sinks);
        rNew('新商談');
        rOld('旧商談');
        expect(await Promise.all([old, fresh])).toEqual(['stale', 'done']);
        expect(sinks.saved).toEqual([{ generation: 1, text: '新商談' }]);
    });

    test('an uncancellable late response is dropped even long after the bump', async () => {
        const c = createGenerationCounter();
        const sinks = { ui: [], history: [], saved: [] };
        let r;
        const late = fakeAdvice(c, [new Promise(res => (r = res))], sinks);
        c.bump();
        await new Promise(res => setTimeout(res, 20));
        r('遅延応答');
        expect(await late).toBe('stale');
        expect(sinks.ui).toEqual([]);
    });
});
