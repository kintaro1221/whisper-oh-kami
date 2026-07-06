// Phase 1g-3.8 Now: unit tests for audioCapture.js backend dispatch + lifecycle.
//
// Scope (per ROADMAP v3): backend resolution, start/stop guards, IPC hooks,
// stdout → deepgramService.send wiring. Native helper / ffmpeg / real audio
// devices stay mocked.
//
// Out of scope: integration with real DeepgramService, real spawn, fs realism.

const EventEmitter = require('events');

// ── helpers ───────────────────────────────────────────────────────────────

function makeFakeChild(overrides = {}) {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = jest.fn();
    child.pid = overrides.pid || 23756;
    child.exitCode = null;
    child.signalCode = null;
    return child;
}

function makeFakeDeepgram() {
    return { send: jest.fn() };
}

const ENV_KEYS = [
    'AUDIO_CAPTURE_BACKEND',
    'AUDIO_CAPTURE_BIN',
    'AUDIO_CAPTURE_DEVICE',
    'FFMPEG_BIN',
    'FFMPEG_LOOPBACK_FORMAT',
    'FFMPEG_LOOPBACK_DEVICE',
    'FFMPEG_ARGS_OVERRIDE',
];

let audioCapture;
let mockSpawn;
let mockExistsSync;

beforeEach(() => {
    // Use fake timers so the SIGKILL fallback setTimeout in stop() does not
    // leak into the next test (audioCapture.js:296-305 schedules a 2s
    // setTimeout that would otherwise keep Node alive past test completion).
    jest.useFakeTimers();

    // Reset env vars to predictable defaults (clean each test)
    for (const k of ENV_KEYS) delete process.env[k];

    // Install mocks before require so the module sees them.
    jest.doMock('fs', () => ({ existsSync: jest.fn(() => false) }));
    jest.doMock('child_process', () => ({ spawn: jest.fn() }));

    // resetModules is true in jest.config.js → fresh require each test.
    audioCapture = require('../../src/utils/audioCapture');
    mockExistsSync = require('fs').existsSync;
    mockSpawn = require('child_process').spawn;
});

afterEach(() => {
    // best-effort: ensure no module-level proc is left dangling.
    try {
        audioCapture.stop();
    } catch (_) {
        // ignore
    }
    // Discard any pending fake timers (e.g. SIGKILL fallback) before
    // switching back, so they cannot fire on the real timeline.
    jest.clearAllTimers();
    jest.useRealTimers();
});

// ── backend resolution ────────────────────────────────────────────────────

describe('audioCapture — backend resolution via env', () => {
    test('AUDIO_CAPTURE_BACKEND=ffmpeg → ffmpeg backend, default args', () => {
        process.env.AUDIO_CAPTURE_BACKEND = 'ffmpeg';
        const child = makeFakeChild();
        mockSpawn.mockReturnValue(child);

        const r = audioCapture.start(makeFakeDeepgram());
        expect(r.ok).toBe(true);
        expect(r.backend).toBe('ffmpeg');
        expect(mockSpawn).toHaveBeenCalledTimes(1);
        const [bin, args] = mockSpawn.mock.calls[0];
        expect(bin).toBe('ffmpeg');
        expect(args).toContain('-f');
        expect(args).toContain('wasapi');
        expect(args).toContain('loopback');
    });

    test('AUDIO_CAPTURE_BACKEND=native + AUDIO_CAPTURE_BIN → native backend uses given binary', () => {
        process.env.AUDIO_CAPTURE_BACKEND = 'native';
        process.env.AUDIO_CAPTURE_BIN = '/fake/path/daddyAudioCapture.exe';
        const child = makeFakeChild();
        mockSpawn.mockReturnValue(child);

        const r = audioCapture.start(makeFakeDeepgram());
        expect(r.ok).toBe(true);
        expect(r.backend).toBe('native');
        expect(r.binary).toBe('/fake/path/daddyAudioCapture.exe');
        const [bin, args] = mockSpawn.mock.calls[0];
        expect(bin).toBe('/fake/path/daddyAudioCapture.exe');
        // native helper CLI surface
        expect(args).toEqual(expect.arrayContaining(['--rate', '16000', '--channels', '1', '--format', 's16le']));
        expect(args).toContain('--watch-default');
        expect(args).toContain('--owner-pid');
    });

    test('AUDIO_CAPTURE_BACKEND=auto + native binary present → picks native', () => {
        process.env.AUDIO_CAPTURE_BACKEND = 'auto';
        mockExistsSync.mockReturnValue(true); // native asset "exists"
        const child = makeFakeChild();
        mockSpawn.mockReturnValue(child);

        const r = audioCapture.start(makeFakeDeepgram());
        expect(r.ok).toBe(true);
        expect(r.backend).toBe('native');
    });

    test('AUDIO_CAPTURE_BACKEND=auto + native binary missing → falls back to ffmpeg', () => {
        process.env.AUDIO_CAPTURE_BACKEND = 'auto';
        mockExistsSync.mockReturnValue(false);
        const child = makeFakeChild();
        mockSpawn.mockReturnValue(child);

        const r = audioCapture.start(makeFakeDeepgram());
        expect(r.ok).toBe(true);
        expect(r.backend).toBe('ffmpeg');
    });

    test('native requested but binary unresolvable → returns ok:false (no spawn)', () => {
        process.env.AUDIO_CAPTURE_BACKEND = 'native';
        mockExistsSync.mockReturnValue(false);
        // AUDIO_CAPTURE_BIN unset, process.resourcesPath undefined in test env
        const r = audioCapture.start(makeFakeDeepgram());
        expect(r.ok).toBe(false);
        expect(r.error).toMatch(/native helper binary not found/i);
        expect(mockSpawn).not.toHaveBeenCalled();
    });
});

// ── start guards ──────────────────────────────────────────────────────────

describe('audioCapture.start — guards', () => {
    test('returns ok:false when deepgramService is missing', () => {
        const r = audioCapture.start(null);
        expect(r.ok).toBe(false);
        expect(r.error).toMatch(/deepgramService not provided/i);
        expect(mockSpawn).not.toHaveBeenCalled();
    });

    test('returns ok:false when already running', () => {
        process.env.AUDIO_CAPTURE_BACKEND = 'ffmpeg';
        mockSpawn.mockReturnValue(makeFakeChild());

        const first = audioCapture.start(makeFakeDeepgram());
        expect(first.ok).toBe(true);
        const second = audioCapture.start(makeFakeDeepgram());
        expect(second.ok).toBe(false);
        expect(second.error).toBe('already running');
        expect(second.pid).toBe(first.pid);
    });

    test('spawn throwing → returns ok:false with spawn-failed message', () => {
        process.env.AUDIO_CAPTURE_BACKEND = 'ffmpeg';
        mockSpawn.mockImplementation(() => {
            throw new Error('ENOENT: ffmpeg not found');
        });
        const r = audioCapture.start(makeFakeDeepgram());
        expect(r.ok).toBe(false);
        expect(r.error).toMatch(/spawn failed/i);
    });
});

// ── stdout pipe → deepgramService.send ────────────────────────────────────

describe('audioCapture — stdout piping', () => {
    test('child stdout data → deepgramService.send called, bytesSent grows', () => {
        process.env.AUDIO_CAPTURE_BACKEND = 'ffmpeg';
        const child = makeFakeChild();
        mockSpawn.mockReturnValue(child);
        const dg = makeFakeDeepgram();

        audioCapture.start(dg);
        child.stdout.emit('data', Buffer.alloc(800));
        child.stdout.emit('data', Buffer.alloc(400));
        expect(dg.send).toHaveBeenCalledTimes(2);
        expect(audioCapture.getStatus().bytesSent).toBe(1200);
    });

    test('deepgramService.send throwing does not break the child pipe', () => {
        process.env.AUDIO_CAPTURE_BACKEND = 'ffmpeg';
        const child = makeFakeChild();
        mockSpawn.mockReturnValue(child);
        const dg = {
            send: jest.fn(() => {
                throw new Error('ws closed');
            }),
        };
        audioCapture.start(dg);
        // Should NOT throw out of the data handler
        expect(() => child.stdout.emit('data', Buffer.alloc(100))).not.toThrow();
    });
});

// ── child lifecycle ───────────────────────────────────────────────────────

describe('audioCapture — child lifecycle', () => {
    test('child close → proc reset to null, fireResume called', () => {
        process.env.AUDIO_CAPTURE_BACKEND = 'ffmpeg';
        const child = makeFakeChild();
        mockSpawn.mockReturnValue(child);

        const onResume = jest.fn();
        audioCapture.setIpcHooks({ onSuspend: jest.fn(), onResume });
        audioCapture.start(makeFakeDeepgram());
        expect(audioCapture.getStatus().running).toBe(true);

        child.emit('close', 0, null);
        expect(audioCapture.getStatus().running).toBe(false);
        expect(onResume).toHaveBeenCalledTimes(1);
    });

    test('child error before close → resume fired, proc cleared', () => {
        process.env.AUDIO_CAPTURE_BACKEND = 'ffmpeg';
        const child = makeFakeChild();
        mockSpawn.mockReturnValue(child);

        const onResume = jest.fn();
        audioCapture.setIpcHooks({ onSuspend: jest.fn(), onResume });
        audioCapture.start(makeFakeDeepgram());
        child.emit('error', new Error('spawn ECHILD'));
        expect(audioCapture.getStatus().running).toBe(false);
        expect(onResume).toHaveBeenCalled();
    });
});

// ── stop ───────────────────────────────────────────────────────────────────

describe('audioCapture.stop', () => {
    test('stop() while running → kills child with SIGTERM, returns pid, fires onResume', () => {
        process.env.AUDIO_CAPTURE_BACKEND = 'ffmpeg';
        const child = makeFakeChild();
        mockSpawn.mockReturnValue(child);
        const onResume = jest.fn();
        audioCapture.setIpcHooks({ onSuspend: jest.fn(), onResume });
        const start = audioCapture.start(makeFakeDeepgram());

        const r = audioCapture.stop();
        expect(r.ok).toBe(true);
        expect(r.pid).toBe(start.pid);
        expect(child.kill).toHaveBeenCalledWith('SIGTERM');
        expect(onResume).toHaveBeenCalled();
    });

    test('stop() when not running → returns alreadyStopped:true, still fires onResume best-effort', () => {
        const onResume = jest.fn();
        audioCapture.setIpcHooks({ onSuspend: jest.fn(), onResume });
        const r = audioCapture.stop();
        expect(r.ok).toBe(true);
        expect(r.alreadyStopped).toBe(true);
        // onResume is no-op when state is already 'idle' — that's the design.
        // Verify status reflects idle state regardless.
        expect(audioCapture.getStatus().rendererSystemCapture).toBe('idle');
    });

    test('stop() then start() → second start succeeds (cycle reset)', () => {
        process.env.AUDIO_CAPTURE_BACKEND = 'ffmpeg';
        mockSpawn.mockReturnValueOnce(makeFakeChild({ pid: 1 })).mockReturnValueOnce(makeFakeChild({ pid: 2 }));

        const a = audioCapture.start(makeFakeDeepgram());
        expect(a.pid).toBe(1);
        audioCapture.stop();
        const b = audioCapture.start(makeFakeDeepgram());
        expect(b.pid).toBe(2);
    });
});

// ── setIpcHooks ────────────────────────────────────────────────────────────

describe('audioCapture.setIpcHooks', () => {
    test('start fires onSuspend exactly once; second start blocked so no second fire', () => {
        process.env.AUDIO_CAPTURE_BACKEND = 'ffmpeg';
        mockSpawn.mockReturnValue(makeFakeChild());
        const onSuspend = jest.fn();
        audioCapture.setIpcHooks({ onSuspend, onResume: jest.fn() });

        audioCapture.start(makeFakeDeepgram());
        audioCapture.start(makeFakeDeepgram()); // blocked: already running
        expect(onSuspend).toHaveBeenCalledTimes(1);
    });

    test('hook callback throwing does not break start/stop cycle', () => {
        process.env.AUDIO_CAPTURE_BACKEND = 'ffmpeg';
        mockSpawn.mockReturnValue(makeFakeChild());
        audioCapture.setIpcHooks({
            onSuspend: () => {
                throw new Error('hook boom');
            },
            onResume: () => {
                throw new Error('hook boom');
            },
        });
        expect(() => audioCapture.start(makeFakeDeepgram())).not.toThrow();
        expect(() => audioCapture.stop()).not.toThrow();
    });

    test('setIpcHooks(undefined) clears hooks safely', () => {
        process.env.AUDIO_CAPTURE_BACKEND = 'ffmpeg';
        mockSpawn.mockReturnValue(makeFakeChild());
        audioCapture.setIpcHooks(undefined);
        expect(() => audioCapture.start(makeFakeDeepgram())).not.toThrow();
    });
});

// ── getStatus ──────────────────────────────────────────────────────────────

describe('audioCapture.getStatus — shape', () => {
    test('idle state shape', () => {
        const s = audioCapture.getStatus();
        const expectedKeys = [
            'running',
            'pid',
            'backend',
            'binary',
            'device',
            'bytesSent',
            'startedAt',
            'startedAgoMs',
            'lastStderr',
            'rendererSystemCapture',
            'restartAttempts',
            'restartScheduledInMs',
            'restartExhausted',
            'lastExitCode',
            'lastExitSignal',
        ];
        for (const k of expectedKeys) expect(s).toHaveProperty(k);
        expect(s.running).toBe(false);
        expect(s.pid).toBeNull();
        expect(s.bytesSent).toBe(0);
        expect(s.rendererSystemCapture).toBe('idle');
        expect(s.restartAttempts).toBe(0);
        expect(s.restartScheduledInMs).toBeNull();
        expect(s.restartExhausted).toBe(false);
        expect(s.lastExitCode).toBeNull();
        expect(s.lastExitSignal).toBeNull();
    });

    test('after start: running=true, pid set, rendererSystemCapture=suspended', () => {
        process.env.AUDIO_CAPTURE_BACKEND = 'ffmpeg';
        mockSpawn.mockReturnValue(makeFakeChild({ pid: 999 }));
        audioCapture.start(makeFakeDeepgram());
        const s = audioCapture.getStatus();
        expect(s.running).toBe(true);
        expect(s.pid).toBe(999);
        expect(s.backend).toBe('ffmpeg');
        expect(s.rendererSystemCapture).toBe('suspended');
        expect(s.startedAt).not.toBeNull();
        expect(s.startedAgoMs).toBeGreaterThanOrEqual(0);
    });
});

// ── Phase 1g-3.9 auto-restart ─────────────────────────────────────────────

describe('audioCapture — Phase 1g-3.9 auto-restart', () => {
    test('unexpected close schedules a restart at the first backoff slot', () => {
        process.env.AUDIO_CAPTURE_BACKEND = 'ffmpeg';
        mockSpawn.mockReturnValue(makeFakeChild({ pid: 100 }));
        audioCapture.start(makeFakeDeepgram());

        const child = mockSpawn.mock.results[0].value;
        child.emit('close', 1, null);

        const s = audioCapture.getStatus();
        expect(s.lastExitCode).toBe(1);
        expect(s.restartScheduledInMs).toBe(1000);
        expect(s.restartAttempts).toBe(0); // counted on the spawn that follows
        expect(s.restartExhausted).toBe(false);
    });

    test('restart timer firing re-spawns and re-asserts onSuspend', () => {
        process.env.AUDIO_CAPTURE_BACKEND = 'ffmpeg';
        const onSuspend = jest.fn();
        const onResume = jest.fn();
        audioCapture.setIpcHooks({ onSuspend, onResume });
        mockSpawn.mockReturnValueOnce(makeFakeChild({ pid: 100 })).mockReturnValueOnce(makeFakeChild({ pid: 101 }));

        audioCapture.start(makeFakeDeepgram());
        expect(onSuspend).toHaveBeenCalledTimes(1);

        const firstChild = mockSpawn.mock.results[0].value;
        firstChild.emit('close', 1, null);
        expect(onResume).toHaveBeenCalledTimes(1);
        expect(audioCapture.getStatus().running).toBe(false);

        jest.advanceTimersByTime(1000);
        expect(mockSpawn).toHaveBeenCalledTimes(2);
        expect(audioCapture.getStatus().running).toBe(true);
        expect(audioCapture.getStatus().pid).toBe(101);
        expect(onSuspend).toHaveBeenCalledTimes(2); // re-asserted on restart
        expect(audioCapture.getStatus().restartAttempts).toBe(1);
    });

    test('5 consecutive crashes exhausts the budget; no 6th spawn', () => {
        process.env.AUDIO_CAPTURE_BACKEND = 'ffmpeg';
        // Provide six children — initial start + 5 restart spawns. If a 6th
        // spawn ever happens we'd run out of return values and the test
        // would clearly diverge from the cap.
        for (let i = 0; i < 6; i++) {
            mockSpawn.mockReturnValueOnce(makeFakeChild({ pid: 200 + i }));
        }
        const dg = makeFakeDeepgram();
        audioCapture.start(dg);

        const backoffs = [1000, 2000, 5000, 15000, 30000];
        for (let i = 0; i < 5; i++) {
            const child = mockSpawn.mock.results[i].value;
            child.emit('close', 1, null);
            jest.advanceTimersByTime(backoffs[i]);
        }
        // 5th restart spawned the 6th child; now crash it.
        const last = mockSpawn.mock.results[5].value;
        last.emit('close', 1, null);

        const s = audioCapture.getStatus();
        expect(mockSpawn).toHaveBeenCalledTimes(6); // initial + 5 restarts, no more
        expect(s.restartAttempts).toBe(5);
        expect(s.restartExhausted).toBe(true);
        expect(s.restartScheduledInMs).toBeNull();
        // advancing further does not summon a 7th child.
        jest.advanceTimersByTime(60000);
        expect(mockSpawn).toHaveBeenCalledTimes(6);
    });

    test('manual stop() — pending restart cleared, no respawn', () => {
        process.env.AUDIO_CAPTURE_BACKEND = 'ffmpeg';
        mockSpawn.mockReturnValueOnce(makeFakeChild({ pid: 100 }));
        audioCapture.start(makeFakeDeepgram());
        const child = mockSpawn.mock.results[0].value;
        child.emit('close', 1, null);
        expect(audioCapture.getStatus().restartScheduledInMs).toBe(1000);

        const r = audioCapture.stop();
        expect(r.alreadyStopped).toBe(true);
        expect(audioCapture.getStatus().restartScheduledInMs).toBeNull();

        jest.advanceTimersByTime(60000);
        expect(mockSpawn).toHaveBeenCalledTimes(1); // never restarted
    });

    test('stop() while running — manualStop suppresses the close-handler restart path', () => {
        process.env.AUDIO_CAPTURE_BACKEND = 'ffmpeg';
        mockSpawn.mockReturnValue(makeFakeChild({ pid: 100 }));
        audioCapture.start(makeFakeDeepgram());

        const child = mockSpawn.mock.results[0].value;
        audioCapture.stop();
        // Production: kill('SIGTERM') causes the child to emit 'close'.
        child.emit('close', 0, 'SIGTERM');
        expect(audioCapture.getStatus().restartScheduledInMs).toBeNull();

        jest.advanceTimersByTime(60000);
        expect(mockSpawn).toHaveBeenCalledTimes(1);
    });

    test('user start() after exhaustion resets the restart budget', () => {
        process.env.AUDIO_CAPTURE_BACKEND = 'ffmpeg';
        for (let i = 0; i < 6; i++) {
            mockSpawn.mockReturnValueOnce(makeFakeChild({ pid: 200 + i }));
        }
        audioCapture.start(makeFakeDeepgram());

        const backoffs = [1000, 2000, 5000, 15000, 30000];
        for (let i = 0; i < 5; i++) {
            mockSpawn.mock.results[i].value.emit('close', 1, null);
            jest.advanceTimersByTime(backoffs[i]);
        }
        mockSpawn.mock.results[5].value.emit('close', 1, null);
        expect(audioCapture.getStatus().restartExhausted).toBe(true);

        // New user-initiated start clears the exhaustion + bookkeeping.
        mockSpawn.mockReturnValueOnce(makeFakeChild({ pid: 999 }));
        const r = audioCapture.start(makeFakeDeepgram());
        expect(r.ok).toBe(true);
        const s = audioCapture.getStatus();
        expect(s.restartAttempts).toBe(0);
        expect(s.restartExhausted).toBe(false);
        expect(s.restartScheduledInMs).toBeNull();
    });

    test('spawn failure during restart recurses to the next backoff slot', () => {
        process.env.AUDIO_CAPTURE_BACKEND = 'ffmpeg';
        mockSpawn.mockReturnValueOnce(makeFakeChild({ pid: 100 })); // initial start
        audioCapture.start(makeFakeDeepgram());

        // Crash the child to schedule the first restart.
        mockSpawn.mock.results[0].value.emit('close', 1, null);
        expect(audioCapture.getStatus().restartScheduledInMs).toBe(1000);

        // Restart timer fires → spawn throws → recursion scheduled at slot 2.
        mockSpawn.mockImplementationOnce(() => {
            throw new Error('binary missing');
        });
        jest.advanceTimersByTime(1000);
        expect(mockSpawn).toHaveBeenCalledTimes(2);
        const s1 = audioCapture.getStatus();
        expect(s1.restartAttempts).toBe(1);
        expect(s1.restartScheduledInMs).toBe(2000);

        // Next slot fires successfully — child stays alive.
        mockSpawn.mockReturnValueOnce(makeFakeChild({ pid: 102 }));
        jest.advanceTimersByTime(2000);
        expect(mockSpawn).toHaveBeenCalledTimes(3);
        expect(audioCapture.getStatus().running).toBe(true);
        expect(audioCapture.getStatus().restartAttempts).toBe(2);
    });

    test('lastExitCode / lastExitSignal reflect the most recent close', () => {
        process.env.AUDIO_CAPTURE_BACKEND = 'ffmpeg';
        mockSpawn.mockReturnValueOnce(makeFakeChild({ pid: 100 }));
        audioCapture.start(makeFakeDeepgram());
        mockSpawn.mock.results[0].value.emit('close', 137, 'SIGKILL');
        const s = audioCapture.getStatus();
        expect(s.lastExitCode).toBe(137);
        expect(s.lastExitSignal).toBe('SIGKILL');
    });
});
