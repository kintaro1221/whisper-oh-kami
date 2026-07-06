// Phase 1g-3.7: Backend-dispatchable opponent audio capture for Daddy.
//
// Spawns a child process that captures Windows playback-device loopback audio
// and streams 16kHz s16le mono PCM into the existing opponent-side
// DeepgramService instance. Two backends are supported:
//
//   - native: bundled `daddyAudioCapture.exe` (WASAPI loopback via Rust +
//     wasapi crate, see native/daddy-audio-capture/). No extra install
//     required for users; planned bundle target via forge.config.js
//     extraResource. The helper itself implements --owner-pid + --watch-default
//     and emits structured JSON-line logs on stderr.
//   - ffmpeg: legacy spike path using ffmpeg + Screen Capture Recorder
//     (dshow virtual-audio-capturer). Requires SCR to be installed locally;
//     retained as a developer fallback while the native helper is rolled out.
//
// Environment variables (set BEFORE `npm start`):
//   AUDIO_CAPTURE_BACKEND   'auto' (default) | 'native' | 'ffmpeg'
//                           auto: native if helper binary exists, else ffmpeg.
//   AUDIO_CAPTURE_BIN       absolute path to backend binary (overrides
//                           default resolution for both native and ffmpeg).
//   AUDIO_CAPTURE_DEVICE    target playback device name (native: passed via
//                           --device; ffmpeg: substituted into wasapi-named /
//                           dshow-named formats; default = OS default render
//                           endpoint).
//
// Legacy aliases (kept for one release; scheduled removal in Phase 1g-3.8):
//   FFMPEG_BIN              alias for AUDIO_CAPTURE_BIN (ffmpeg backend only)
//   FFMPEG_LOOPBACK_FORMAT  ffmpeg input format selector (still used)
//   FFMPEG_LOOPBACK_DEVICE  alias for AUDIO_CAPTURE_DEVICE
//   FFMPEG_ARGS_OVERRIDE    full custom ffmpeg args (debug only)
//
// IPC entry points (registered in gemini.js):
//   start-audio-capture                 -> start(deepgramService)
//   stop-audio-capture                  -> stop()
//   dev:dump-audio-capture-status       -> getStatus()
//
// Legacy IPC aliases (same handlers, same semantics):
//   start-ffmpeg-loopback
//   stop-ffmpeg-loopback
//   dev:dump-ffmpeg-loopback-status
//
// Renderer dedup: when the native helper / ffmpeg child is running, the
// renderer-side AudioWorklet system-capture path would double-feed Deepgram.
// Callers register `setIpcHooks({ onSuspend, onResume })` so this module can
// notify the renderer to suspend/resume without creating a circular require
// against gemini.js (which owns sendToRenderer).

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// stderr ring buffer: 16 KiB so the native helper's structured JSON-line logs
// (info / error / default_changed) are recoverable for debugging without
// unbounded memory growth. Spike kept this at 4 KiB which truncated to ~20
// JSON entries; 16 KiB holds ~80.
const STDERR_RING_MAX = 16384;
const SIGKILL_TIMEOUT_MS = 2000;
const NATIVE_BIN_NAME = 'daddyAudioCapture.exe';

// Phase 1g-3.9: exponential backoff for unexpected helper exits. Length of
// this array also caps total restart attempts before declaring the helper
// permanently exhausted (no further restart loop). Matches ROADMAP v3 spec:
// 1s → 2s → 5s → 15s → 30s, max 5 attempts.
const RESTART_BACKOFF_MS = [1000, 2000, 5000, 15000, 30000];
const MAX_RESTART_ATTEMPTS = RESTART_BACKOFF_MS.length;

// ── binary resolution ──────────────────────────────────────────────────────

function resolveNativeBinary() {
    if (process.env.AUDIO_CAPTURE_BIN) return process.env.AUDIO_CAPTURE_BIN;
    // Packaged build: extraResource lands under process.resourcesPath.
    if (process.resourcesPath) {
        const packaged = path.join(process.resourcesPath, NATIVE_BIN_NAME);
        if (fs.existsSync(packaged)) return packaged;
    }
    // Dev: live in src/assets so the same path layout works inside
    // electron-forge start.
    const dev = path.join(__dirname, '..', 'assets', NATIVE_BIN_NAME);
    if (fs.existsSync(dev)) return dev;
    return null;
}

function resolveFfmpegBinary() {
    return process.env.AUDIO_CAPTURE_BIN || process.env.FFMPEG_BIN || 'ffmpeg';
}

function resolveBackend() {
    const requested = (process.env.AUDIO_CAPTURE_BACKEND || 'auto').toLowerCase();
    if (requested === 'native') return 'native';
    if (requested === 'ffmpeg') return 'ffmpeg';
    // auto: prefer native if helper binary exists; else fall back to ffmpeg.
    if (resolveNativeBinary()) return 'native';
    return 'ffmpeg';
}

function resolveDevice(backend) {
    const explicit = process.env.AUDIO_CAPTURE_DEVICE || process.env.FFMPEG_LOOPBACK_DEVICE || '';
    if (explicit) return explicit;
    return backend === 'native' ? 'default' : '';
}

// ── ffmpeg backend (legacy spike path, retained as dev fallback) ──────────

function buildFfmpegArgs() {
    const override = process.env.FFMPEG_ARGS_OVERRIDE;
    if (override) return override.split(/\s+/).filter(Boolean);

    const baseIn = ['-hide_banner', '-loglevel', 'warning'];
    const baseOut = ['-ar', '16000', '-ac', '1', '-f', 's16le', 'pipe:1'];
    const format = process.env.FFMPEG_LOOPBACK_FORMAT || 'wasapi-default';
    const device = process.env.AUDIO_CAPTURE_DEVICE || process.env.FFMPEG_LOOPBACK_DEVICE || '';

    switch (format) {
        case 'wasapi-default':
            return [...baseIn, '-f', 'wasapi', '-i', 'loopback', ...baseOut];
        case 'wasapi-named':
            if (!device) throw new Error('AUDIO_CAPTURE_DEVICE required for wasapi-named format');
            return [...baseIn, '-f', 'wasapi', '-i', `loopback=${device}`, ...baseOut];
        case 'dshow-virtual':
            return [...baseIn, '-f', 'dshow', '-i', 'audio=virtual-audio-capturer', ...baseOut];
        case 'dshow-named':
            if (!device) throw new Error('AUDIO_CAPTURE_DEVICE required for dshow-named format');
            return [...baseIn, '-f', 'dshow', '-i', `audio=${device}`, ...baseOut];
        default:
            throw new Error(`Unknown FFMPEG_LOOPBACK_FORMAT: ${format}`);
    }
}

function buildFfmpegSpawn() {
    return { binary: resolveFfmpegBinary(), args: buildFfmpegArgs() };
}

// ── native backend (Phase 1g-3.7 helper) ──────────────────────────────────

function buildNativeSpawn() {
    const binary = resolveNativeBinary();
    if (!binary) {
        throw new Error(
            'native helper binary not found — set AUDIO_CAPTURE_BIN, build native/daddy-audio-capture, or set AUDIO_CAPTURE_BACKEND=ffmpeg'
        );
    }
    const device = resolveDevice('native');
    // CLI surface kept minimal so the helper stays a leaf process: PCM on
    // stdout, JSON on stderr, --owner-pid for orphan recovery, and
    // --watch-default to reopen on default endpoint changes.
    const args = [
        '--rate',
        '16000',
        '--channels',
        '1',
        '--format',
        's16le',
        '--device',
        device,
        '--watch-default',
        '--owner-pid',
        String(process.pid),
    ];
    return { binary, args };
}

// ── lifecycle state ───────────────────────────────────────────────────────

let proc = null;
let backendInUse = null;
let binaryInUse = null;
let deviceInUse = null;
let bytesSent = 0;
let startedAt = null;
let lastStderr = '';
let rendererSystemCapture = 'idle'; // 'idle' | 'suspended'
let _ipcHooks = { onSuspend: null, onResume: null };

// Phase 1g-3.9: auto-restart bookkeeping. `restartAttempts` counts only
// consecutive *unexpected* close events; user-initiated start() resets it.
// `manualStop` is set inside stop() so the close handler distinguishes
// expected exits from crashes. `serviceForRestart` retains the deepgram
// service reference between spawn cycles so the restart timer doesn't need
// the caller to re-supply it.
let restartAttempts = 0;
let restartTimer = null;
let restartScheduledInMs = null;
let restartExhausted = false;
let lastExitCode = null;
let lastExitSignal = null;
let manualStop = false;
let serviceForRestart = null;

function setIpcHooks(hooks) {
    _ipcHooks = {
        onSuspend: (hooks && hooks.onSuspend) || null,
        onResume: (hooks && hooks.onResume) || null,
    };
}

function appendStderr(chunk) {
    lastStderr = (lastStderr + chunk.toString()).slice(-STDERR_RING_MAX);
}

function fireSuspend() {
    if (rendererSystemCapture === 'suspended') return;
    rendererSystemCapture = 'suspended';
    if (_ipcHooks.onSuspend) {
        try {
            _ipcHooks.onSuspend();
        } catch (err) {
            console.warn('[audio-capture] onSuspend hook threw:', err && err.message);
        }
    }
}

function fireResume() {
    if (rendererSystemCapture === 'idle') return;
    rendererSystemCapture = 'idle';
    if (_ipcHooks.onResume) {
        try {
            _ipcHooks.onResume();
        } catch (err) {
            console.warn('[audio-capture] onResume hook threw:', err && err.message);
        }
    }
}

// Public entry. User-initiated starts reset all restart bookkeeping so the
// helper has a fresh budget; internal _spawn() is what the restart timer
// invokes for the actual child re-creation without resetting the budget.
function start(deepgramService) {
    if (proc) {
        return { ok: false, error: 'already running', pid: proc.pid };
    }
    if (!deepgramService) {
        return { ok: false, error: 'deepgramService not provided' };
    }
    // Cancel any pending restart from a prior fault sequence — user start
    // takes precedence and resets the budget.
    if (restartTimer) {
        clearTimeout(restartTimer);
        restartTimer = null;
    }
    restartScheduledInMs = null;
    restartAttempts = 0;
    restartExhausted = false;
    manualStop = false;
    serviceForRestart = deepgramService;
    lastExitCode = null;
    lastExitSignal = null;

    return _spawn(deepgramService);
}

function _spawn(deepgramService) {
    let plan;
    let backend;
    try {
        backend = resolveBackend();
        plan = backend === 'native' ? buildNativeSpawn() : buildFfmpegSpawn();
    } catch (err) {
        return { ok: false, error: err.message };
    }

    backendInUse = backend;
    binaryInUse = plan.binary;
    deviceInUse = resolveDevice(backend);

    console.log(`[audio-capture] backend=${backend} spawn: ${plan.binary} ${plan.args.join(' ')}`);

    let child;
    try {
        child = spawn(plan.binary, plan.args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
        return { ok: false, error: `spawn failed: ${err.message}` };
    }

    proc = child;
    bytesSent = 0;
    startedAt = Date.now();
    lastStderr = '';

    child.on('error', err => {
        console.error('[audio-capture] process error:', err.message);
        appendStderr(`process error: ${err.message}\n`);
        if (proc === child) {
            proc = null;
            // Auto-clear suspend if start failed mid-flight so the renderer
            // worklet path can recover instead of staying silently muted.
            // Restart scheduling waits for the close event that follows
            // (Node child_process semantics) so we don't double-schedule.
            fireResume();
        }
    });

    child.stdout.on('data', buf => {
        try {
            deepgramService.send(buf);
            bytesSent += buf.length;
        } catch (err) {
            console.error('[audio-capture] deepgram send error:', err.message);
        }
    });

    child.stderr.on('data', buf => {
        appendStderr(buf);
    });

    child.on('close', (code, signal) => {
        console.log(`[audio-capture] closed: code=${code} signal=${signal}`);
        appendStderr(`closed: code=${code} signal=${signal}\n`);
        lastExitCode = code;
        lastExitSignal = signal;
        if (proc === child) {
            proc = null;
            // Resume the renderer worklet first so the meeting is never left
            // silently muted while restart attempts pile up. fireSuspend is
            // re-asserted by the next _spawn() if/when restart succeeds.
            fireResume();
        }
        scheduleRestartIfNeeded();
    });

    fireSuspend();

    return { ok: true, pid: child.pid, backend, binary: binaryInUse };
}

// Restart policy: only on *unexpected* close, never on stop()-initiated
// exit, and only while the budget is non-exhausted. Spawn-failure during
// the restart timer recurses through this same helper so the next backoff
// slot is consumed honestly.
function scheduleRestartIfNeeded() {
    if (manualStop) {
        // Expected exit (stop() initiated). Reset the flag so a future
        // user-initiated start can use a fresh budget without further
        // bookkeeping.
        manualStop = false;
        return;
    }
    if (restartExhausted) return;
    if (restartAttempts >= MAX_RESTART_ATTEMPTS) {
        restartExhausted = true;
        console.warn(`[audio-capture] restart exhausted after ${restartAttempts} attempts`);
        return;
    }
    if (!serviceForRestart) {
        // Nothing to restart against (start() was never called or the
        // captured reference was cleared). Treat as exhausted.
        restartExhausted = true;
        return;
    }
    const ms = RESTART_BACKOFF_MS[restartAttempts];
    restartScheduledInMs = ms;
    console.log(`[audio-capture] schedule restart in ${ms}ms (attempt ${restartAttempts + 1}/${MAX_RESTART_ATTEMPTS})`);
    restartTimer = setTimeout(() => {
        restartTimer = null;
        restartScheduledInMs = null;
        restartAttempts++;
        const r = _spawn(serviceForRestart);
        if (!r.ok) {
            console.error(`[audio-capture] restart spawn failed: ${r.error}`);
            // No close event will follow a failed spawn; recurse so the
            // next backoff slot still drains the budget.
            scheduleRestartIfNeeded();
        }
        // On successful spawn, the new child's close handler will drive the
        // next restart attempt if it crashes again.
    }, ms);
}

function stop() {
    // Always kill the restart timer first — stop() must override any pending
    // backoff (the user explicitly asked to stop, or a clean shutdown is in
    // progress). Without this, a pending restart could revive the helper
    // *after* stop() returned and surprise downstream code.
    if (restartTimer) {
        clearTimeout(restartTimer);
        restartTimer = null;
        restartScheduledInMs = null;
    }
    // Forget the captured service so a stray scheduleRestartIfNeeded()
    // (e.g. from a child whose close has not yet drained) cannot revive.
    serviceForRestart = null;
    // Stop fully resets the restart budget — a subsequent user-initiated
    // start() should begin from a clean state regardless of prior failures.
    restartAttempts = 0;
    restartExhausted = false;

    if (!proc) {
        // Even with no child running, a renderer suspend may have leaked from
        // a prior fault path. Best-effort resume so the worklet pipeline can
        // recover without the user having to restart Daddy.
        fireResume();
        return { ok: true, alreadyStopped: true };
    }

    // Mark this exit as expected so the close handler does not schedule a
    // restart. The flag self-clears inside scheduleRestartIfNeeded().
    manualStop = true;

    const target = proc;
    const pid = target.pid;
    proc = null;

    try {
        target.kill('SIGTERM');
    } catch (err) {
        console.error('[audio-capture] SIGTERM error:', err.message);
    }

    setTimeout(() => {
        if (target.exitCode === null && target.signalCode === null) {
            try {
                target.kill('SIGKILL');
                console.log(`[audio-capture] force-killed pid=${pid}`);
            } catch (_) {
                // already gone — ignore
            }
        }
    }, SIGKILL_TIMEOUT_MS);

    fireResume();

    return { ok: true, pid };
}

function getStatus() {
    return {
        running: !!proc,
        pid: proc ? proc.pid : null,
        backend: backendInUse,
        binary: binaryInUse,
        device: deviceInUse,
        bytesSent,
        startedAt,
        startedAgoMs: startedAt ? Date.now() - startedAt : null,
        lastStderr: lastStderr.slice(-2048),
        rendererSystemCapture,
        // Phase 1g-3.9 restart observability. Use these to diagnose whether
        // the helper is currently mid-recovery from a crash or has given up.
        restartAttempts,
        restartScheduledInMs,
        restartExhausted,
        lastExitCode,
        lastExitSignal,
    };
}

module.exports = { start, stop, getStatus, setIpcHooks };
