// Pins the trial-mode contract: a Whisper transcription that completes after
// closeLocalSession() must not push a turn event.
jest.mock('../../src/utils/gemini', () => ({
    sendToRenderer: jest.fn(),
    initializeNewSession: jest.fn(),
    saveConversationTurn: jest.fn(),
    pushTurnEvent: jest.fn(),
}));
const gemini = require('../../src/utils/gemini');
const localai = require('../../src/utils/localai');

beforeEach(() => jest.clearAllMocks());

test('trial transcription finishing after close is dropped', async () => {
    let release;
    localai.__setTranscribeForTest(() => new Promise(res => (release = res)));
    localai.__setActiveForTest(true, 'trial');
    const p = localai.__handleSpeechEndForTest(Buffer.alloc(32000));
    localai.closeLocalSession();
    release('予算は100万円です');
    await p;
    expect(gemini.pushTurnEvent).not.toHaveBeenCalled();
});

// The test above also holds by accident on the pre-guard code (closeLocalSession
// resets localSessionMode to 'local', so the trial branch is skipped). This one
// pins the real defect: stop → immediate restart while Whisper is still
// running. The old segment's transcription must not leak into the new session,
// even though a session (same mode) is live again when it completes.
test('transcription from a closed session is dropped even after an immediate restart', async () => {
    let release;
    localai.__setTranscribeForTest(() => new Promise(res => (release = res)));
    localai.__setActiveForTest(true, 'trial');
    const p = localai.__handleSpeechEndForTest(Buffer.alloc(32000));
    localai.closeLocalSession(); // stop
    localai.__setActiveForTest(true, 'trial'); // restart before Whisper returns
    release('旧商談の予算は100万円です');
    await p;
    expect(gemini.pushTurnEvent).not.toHaveBeenCalled();
    expect(gemini.sendToRenderer).not.toHaveBeenCalledWith('update-status', 'Trial listening...');
    localai.closeLocalSession();
});

// v0.7.5 final review (validator L03): Ollama requests that arrive while a
// response is streaming keep only the latest one and dispatch it once.
test('two Ollama requests while in flight → exactly one follow-up with the latest text', async () => {
    const releases = [];
    const chat = jest.fn(
        () =>
            new Promise(res => {
                releases.push(res);
            })
    );
    const streamOf = text => ({
        async *[Symbol.asyncIterator]() {
            yield { message: { content: text } };
        },
    });
    localai.__setOllamaForTest({ chat }, 'gemma3:4b');
    localai.__setActiveForTest(true, 'local');

    const p1 = localai.sendLocalText('最初の発話です');
    await new Promise(r => setImmediate(r));
    expect(chat).toHaveBeenCalledTimes(1);
    await localai.sendLocalText('二番目の発話です');
    await localai.sendLocalText('三番目の発話です');
    expect(chat).toHaveBeenCalledTimes(1);

    releases[0](streamOf('一つ目の助言'));
    await p1;
    for (let i = 0; i < 4; i++) await new Promise(r => setImmediate(r));
    expect(chat).toHaveBeenCalledTimes(2);
    const msgs = JSON.stringify(chat.mock.calls[1][0].messages);
    expect(msgs).toContain('三番目の発話です');
    expect(msgs).not.toContain('二番目の発話です');

    releases[1](streamOf('二つ目の助言'));
    for (let i = 0; i < 4; i++) await new Promise(r => setImmediate(r));
    expect(chat).toHaveBeenCalledTimes(2);
    localai.closeLocalSession();
});

test('closeLocalSession drops a pending Ollama request', async () => {
    let release;
    const chat = jest.fn(() => new Promise(res => (release = res)));
    localai.__setOllamaForTest({ chat }, 'gemma3:4b');
    localai.__setActiveForTest(true, 'local');
    const p1 = localai.sendLocalText('最初の発話です');
    await new Promise(r => setImmediate(r));
    await localai.sendLocalText('保留される発話です');
    localai.closeLocalSession();
    release({ async *[Symbol.asyncIterator]() {} });
    await p1;
    for (let i = 0; i < 4; i++) await new Promise(r => setImmediate(r));
    expect(chat).toHaveBeenCalledTimes(1);
});
