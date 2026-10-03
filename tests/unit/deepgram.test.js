// Phase 1g-3.8 Now: unit tests for DeepgramService observability lane.
//
// Scope (per ROADMAP v3): pure logic + state transitions only.
//   - _pushEvent ring buffer trim
//   - send() attempted/dropped counters
//   - getStatus() shape + non-aliased copy
//   - WS lifecycle hooks (open / close / error) update observability fields
//
// Out of scope: real network, real `ws` module, _attemptReconnect timer
// (we set shouldReconnect=false to suppress reconnect loops).

// ── ws mock ────────────────────────────────────────────────────────────────
// Jest hoists jest.mock() to the top of the file, before top-level imports
// run. Requiring 'events' lazily *inside* the factory avoids the
// "out-of-scope variable" guard (only `mock`-prefixed externals are exempted).
// Instances are exposed via FakeWebSocket._instances so the test scope can
// reach the live socket without an external array.
jest.mock('ws', () => {
    const { EventEmitter } = require('events');
    class FakeWebSocket extends EventEmitter {
        constructor(url, options) {
            super();
            this.url = url;
            this.options = options;
            this.readyState = FakeWebSocket.CONNECTING;
            this.sent = [];
            this.terminated = false;
            this.closed = false;
            FakeWebSocket._instances.push(this);
        }
        send(buf) {
            this.sent.push(buf);
        }
        close() {
            this.closed = true;
            this.readyState = FakeWebSocket.CLOSED;
        }
        terminate() {
            this.terminated = true;
            this.readyState = FakeWebSocket.CLOSED;
        }
    }
    FakeWebSocket._instances = [];
    FakeWebSocket.CONNECTING = 0;
    FakeWebSocket.OPEN = 1;
    FakeWebSocket.CLOSING = 2;
    FakeWebSocket.CLOSED = 3;
    return FakeWebSocket;
});

// require *after* jest.mock so the module's `require('ws')` resolves to the fake.
const FakeWebSocket = require('ws');
const { DeepgramService } = require('../../src/utils/deepgram');

beforeEach(() => {
    FakeWebSocket._instances.length = 0;
});

// ── Initial state ─────────────────────────────────────────────────────────

describe('DeepgramService — constructor', () => {
    test('initial observability fields are zero/null', () => {
        const dg = new DeepgramService();
        expect(dg.lastConnectAt).toBeNull();
        expect(dg.lastDisconnectAt).toBeNull();
        expect(dg.lastError).toBeNull();
        expect(dg.lastCloseCode).toBeNull();
        expect(dg.lastCloseReason).toBeNull();
        expect(dg.bytesSentAttempted).toBe(0);
        expect(dg.bytesSentDropped).toBe(0);
        expect(dg.connectAttempts).toBe(0);
        expect(dg.recentEvents).toEqual([]);
        expect(dg.retryCount).toBe(0);
        expect(dg.shouldReconnect).toBe(false);
    });
});

// ── _pushEvent ring buffer ────────────────────────────────────────────────

describe('DeepgramService._pushEvent — ring buffer', () => {
    test('keeps last 20 entries when 25 are pushed', () => {
        const dg = new DeepgramService();
        for (let i = 0; i < 25; i++) {
            dg._pushEvent('marker', { i });
        }
        expect(dg.recentEvents.length).toBe(20);
        // oldest retained is i=5 (since first 5 were trimmed)
        expect(dg.recentEvents[0].detail.i).toBe(5);
        expect(dg.recentEvents[19].detail.i).toBe(24);
    });

    test('omits detail key when no detail passed', () => {
        const dg = new DeepgramService();
        dg._pushEvent('marker');
        expect(dg.recentEvents[0]).toHaveProperty('kind', 'marker');
        expect(dg.recentEvents[0]).toHaveProperty('at');
        expect(dg.recentEvents[0].detail).toBeUndefined();
    });
});

// ── send() counters ───────────────────────────────────────────────────────

describe('DeepgramService.send — attempted/dropped counters', () => {
    test('ws=null → attempted+=len, dropped+=len, no transmission', () => {
        const dg = new DeepgramService();
        const buf = Buffer.alloc(1024);
        dg.send(buf);
        expect(dg.bytesSentAttempted).toBe(1024);
        expect(dg.bytesSentDropped).toBe(1024);
    });

    test('ws.readyState=OPEN → attempted+=len, dropped unchanged, ws.send called', () => {
        const dg = new DeepgramService();
        const fakeWs = { readyState: FakeWebSocket.OPEN, send: jest.fn() };
        dg.ws = fakeWs;
        const buf = Buffer.alloc(512);
        dg.send(buf);
        expect(dg.bytesSentAttempted).toBe(512);
        expect(dg.bytesSentDropped).toBe(0);
        expect(fakeWs.send).toHaveBeenCalledWith(buf);
    });

    test('ws.readyState=CONNECTING → attempted+=len, dropped+=len, ws.send NOT called', () => {
        const dg = new DeepgramService();
        const fakeWs = { readyState: FakeWebSocket.CONNECTING, send: jest.fn() };
        dg.ws = fakeWs;
        const buf = Buffer.alloc(256);
        dg.send(buf);
        expect(dg.bytesSentAttempted).toBe(256);
        expect(dg.bytesSentDropped).toBe(256);
        expect(fakeWs.send).not.toHaveBeenCalled();
    });

    test('ws.readyState=CLOSED → dropped+=len', () => {
        const dg = new DeepgramService();
        const fakeWs = { readyState: FakeWebSocket.CLOSED, send: jest.fn() };
        dg.ws = fakeWs;
        dg.send(Buffer.alloc(128));
        expect(dg.bytesSentDropped).toBe(128);
        expect(fakeWs.send).not.toHaveBeenCalled();
    });

    test('null/empty buffer → counters increment by 0, no crash', () => {
        const dg = new DeepgramService();
        dg.send(null);
        dg.send(Buffer.alloc(0));
        expect(dg.bytesSentAttempted).toBe(0);
        expect(dg.bytesSentDropped).toBe(0);
    });
});

// ── getStatus() shape ─────────────────────────────────────────────────────

describe('DeepgramService.getStatus — shape contract', () => {
    test('returns all expected keys', () => {
        const dg = new DeepgramService();
        const s = dg.getStatus();
        const expectedKeys = [
            'instantiated',
            'connected',
            'readyState',
            'lastConnectAt',
            'lastConnectAgoMs',
            'lastDisconnectAt',
            'lastDisconnectAgoMs',
            'lastError',
            'lastCloseCode',
            'lastCloseReason',
            'retryCount',
            'connectAttempts',
            'shouldReconnect',
            'bytesSentAttempted',
            'bytesSentDropped',
            'recentEvents',
        ];
        for (const k of expectedKeys) {
            expect(s).toHaveProperty(k);
        }
        expect(s.instantiated).toBe(true);
        expect(s.connected).toBe(false);
    });

    test('recentEvents is a copy — mutating it does not affect internal state', () => {
        const dg = new DeepgramService();
        dg._pushEvent('test');
        const s = dg.getStatus();
        s.recentEvents.push({ kind: 'injected' });
        expect(dg.recentEvents.length).toBe(1);
        expect(dg.recentEvents[0].kind).toBe('test');
    });

    test('lastConnectAgoMs becomes a positive number after lastConnectAt is set', () => {
        const dg = new DeepgramService();
        dg.lastConnectAt = Date.now() - 1000;
        const s = dg.getStatus();
        expect(s.lastConnectAgoMs).toBeGreaterThanOrEqual(1000);
    });
});

// ── WS lifecycle ──────────────────────────────────────────────────────────

describe('DeepgramService.connect — lifecycle observability', () => {
    test('connect() pushes connect_called → connecting, increments connectAttempts', () => {
        const dg = new DeepgramService();
        dg.connect('FAKEKEY');
        // After connect(), shouldReconnect set to true and a fake ws was constructed.
        expect(dg.shouldReconnect).toBe(true);
        expect(dg.connectAttempts).toBe(1);
        expect(FakeWebSocket._instances.length).toBe(1);
        const kinds = dg.recentEvents.map(e => e.kind);
        expect(kinds).toEqual(expect.arrayContaining(['connect_called', 'connecting']));
        // suppress reconnect to avoid timer leak in subsequent tests
        dg.shouldReconnect = false;
    });

    test('ws.emit("open") → lastConnectAt set, retryCount reset, "open" event recorded', () => {
        const dg = new DeepgramService();
        dg.retryCount = 3;
        dg.connect('FAKEKEY');
        const ws = FakeWebSocket._instances[0];
        ws.readyState = FakeWebSocket.OPEN;
        ws.emit('open');
        expect(dg.lastConnectAt).not.toBeNull();
        expect(dg.retryCount).toBe(0);
        const kinds = dg.recentEvents.map(e => e.kind);
        expect(kinds).toContain('open');
        dg.shouldReconnect = false;
    });

    test('ws.emit("close") → lastCloseCode/Reason captured, "close" event recorded', () => {
        const dg = new DeepgramService();
        dg.connect('FAKEKEY');
        // suppress reconnect *before* the close event fires inside the listener
        dg.shouldReconnect = false;
        const ws = FakeWebSocket._instances[0];
        ws.emit('close', 1006, Buffer.from('abnormal closure'));
        expect(dg.lastCloseCode).toBe(1006);
        expect(dg.lastCloseReason).toBe('abnormal closure');
        expect(dg.lastDisconnectAt).not.toBeNull();
        const closeEvent = dg.recentEvents.find(e => e.kind === 'close');
        expect(closeEvent).toBeDefined();
        expect(closeEvent.detail.code).toBe(1006);
        expect(closeEvent.detail.reason).toBe('abnormal closure');
    });

    test('ws.emit("close") with empty reason buffer → lastCloseReason is empty string', () => {
        const dg = new DeepgramService();
        dg.connect('FAKEKEY');
        dg.shouldReconnect = false;
        const ws = FakeWebSocket._instances[0];
        ws.emit('close', 1000, undefined);
        expect(dg.lastCloseCode).toBe(1000);
        expect(dg.lastCloseReason).toBe('');
    });

    test('ws.emit("error") → lastError captured, "error" event recorded', () => {
        const dg = new DeepgramService();
        dg.connect('FAKEKEY');
        const ws = FakeWebSocket._instances[0];
        ws.emit('error', new Error('boom'));
        expect(dg.lastError).not.toBeNull();
        expect(dg.lastError.message).toBe('boom');
        const errEvent = dg.recentEvents.find(e => e.kind === 'error');
        expect(errEvent).toBeDefined();
        expect(errEvent.detail.phase).toBe('runtime');
        expect(errEvent.detail.message).toBe('boom');
        dg.shouldReconnect = false;
    });
});

// ── isConnected ────────────────────────────────────────────────────────────

describe('DeepgramService.isConnected', () => {
    test('false when ws is null', () => {
        const dg = new DeepgramService();
        expect(dg.isConnected()).toBe(false);
    });

    test('true when ws.readyState === OPEN', () => {
        const dg = new DeepgramService();
        dg.ws = { readyState: FakeWebSocket.OPEN };
        expect(dg.isConnected()).toBe(true);
    });

    test('false when ws.readyState !== OPEN', () => {
        const dg = new DeepgramService();
        dg.ws = { readyState: FakeWebSocket.CONNECTING };
        expect(dg.isConnected()).toBe(false);
    });
});

// ── disconnect detaches callbacks (session-generation guard, v0.7.5) ──────

describe('DeepgramService.disconnect — detaches callbacks', () => {
    test('a final arriving during the close handshake does not reach onTranscript', () => {
        const dg = new DeepgramService();
        const onTranscript = jest.fn();
        const onStatus = jest.fn();
        dg.connect('FAKEKEY', onTranscript, onStatus);
        const ws = FakeWebSocket._instances[0];
        dg.disconnect();
        ws.emit(
            'message',
            Buffer.from(
                JSON.stringify({
                    type: 'Results',
                    is_final: true,
                    channel: { alternatives: [{ transcript: '予算は100万円です' }] },
                })
            )
        );
        ws.emit('error', new Error('late'));
        expect(onTranscript).not.toHaveBeenCalled();
        // The 'disconnected' notification itself is still delivered exactly once.
        expect(onStatus).toHaveBeenCalledTimes(1);
        expect(onStatus).toHaveBeenCalledWith('disconnected');
    });
});
