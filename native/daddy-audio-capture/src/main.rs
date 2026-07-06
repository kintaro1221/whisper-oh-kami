// daddy-audio-capture: Phase 1g-3.7 native helper for cheating-daddy.
//
// Captures the Windows default render endpoint via WASAPI loopback, downmixes
// the device-native stereo float stream to mono, resamples to 16 kHz with
// rubato (FFT-based fixed ratio), converts f32 → s16le, and streams the
// resulting bytes to stdout in the exact shape DeepgramService expects.
//
// Phase B progress:
//   Step 1 ✅ raw passthrough (device-native rate / channels / format)
//   Step 2 ✅ fixed pipeline to 16 kHz mono s16le
//   Step 3 ⏳ this commit — structured JSON-line stderr logs
//   Step 4 ⏳ this commit — --owner-pid (1 s polling) + --watch-default
//   Step 5    bundle daddyAudioCapture.exe via forge.config.js extraResource
//
// Smoke test (raw):
//   cargo run --release > capture.raw
//   ffplay -f s16le -ar 16000 -ac 1 capture.raw
//
// Smoke test (with watch + owner monitoring):
//   cargo run --release -- --watch-default --owner-pid <PID> > capture.raw

use std::collections::VecDeque;
use std::error::Error;
use std::io::{self, Write};
use std::time::{Duration, Instant};

use clap::Parser;
use rubato::{FftFixedInOut, Resampler};
use serde_json::json;
use wasapi::{DeviceEnumerator, Direction, StreamMode, initialize_mta};
use windows::Win32::Foundation::{CloseHandle, STILL_ACTIVE};
use windows::Win32::System::Threading::{
    GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
};

type Res<T> = Result<T, Box<dyn Error>>;

/// Output sample rate. Matches Deepgram's expected ingest rate for nova-3
/// Japanese (deepgram.js:8-16 hard-codes 16 kHz mono int16le).
const TARGET_SAMPLE_RATE: usize = 16000;

/// Resampler chunk in milliseconds. 100 ms at 48 kHz = 4800 frames in,
/// 1600 frames out — divisible by rubato's internal FFT block size and
/// keeps end-to-end latency well under the conversational threshold.
const CHUNK_MS: usize = 100;

/// How often to check --owner-pid liveness and --watch-default device id.
const HEALTH_CHECK_INTERVAL: Duration = Duration::from_secs(1);

/// Inactivity timeout on the WASAPI capture event handle. Long enough that
/// a device that genuinely went silent doesn't burn CPU; short enough that
/// the 1 s health check still fires when no audio is flowing.
const CAPTURE_EVENT_TIMEOUT_MS: u32 = 500;

#[derive(Parser, Debug)]
#[command(
    name = "daddy-audio-capture",
    version,
    about = "Bundled WASAPI loopback helper for cheating-daddy (Phase 1g-3.7)"
)]
struct Cli {
    /// Output sample rate (Hz). Currently only 16000 is supported; other
    /// values will trigger an error at startup.
    #[arg(long, default_value_t = 16000)]
    rate: usize,

    /// Output channel count. Currently only 1 (mono downmix) is supported.
    #[arg(long, default_value_t = 1)]
    channels: usize,

    /// Output sample format. Currently only s16le is supported.
    #[arg(long, default_value = "s16le")]
    format: String,

    /// Target render device. `default` follows the OS default render
    /// endpoint. Specific device names are accepted but currently fall
    /// back to `default` with a warning (Phase 1g-3.8 will honour them).
    #[arg(long, default_value = "default")]
    device: String,

    /// Watch the OS default render endpoint and re-open capture if it
    /// changes (1 s polling, no IMMNotificationClient yet).
    #[arg(long)]
    watch_default: bool,

    /// Parent process PID. Helper exits cleanly if this process is no
    /// longer alive (1 s polling). Required for orphan recovery so a
    /// crashed Daddy doesn't leave a streaming child behind.
    #[arg(long)]
    owner_pid: Option<u32>,
}

/// Emit a structured JSON-line log record to stderr. Single-line so log
/// collectors can split on '\n', and each record is self-contained so
/// out-of-order delivery doesn't corrupt parsing.
fn jlog(level: &str, msg: &str, fields: serde_json::Value) {
    let mut record = json!({
        "level": level,
        "msg": msg,
    });
    if let (Some(obj), Some(extra)) = (record.as_object_mut(), fields.as_object()) {
        for (k, v) in extra {
            obj.insert(k.clone(), v.clone());
        }
    }
    eprintln!("{}", record);
}

/// Returns true if the given Windows pid is currently a live process. Used
/// for orphan recovery: we poll once per second and exit cleanly when the
/// owner (cheating-daddy main) is gone.
fn is_pid_alive(pid: u32) -> bool {
    unsafe {
        let handle = match OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
            Ok(h) if !h.is_invalid() => h,
            // Open failed: either the pid is gone or we lack permission.
            // We treat both as "owner is no longer reachable" — exiting
            // is the safer default for a leaf helper process.
            _ => return false,
        };
        let mut exit_code: u32 = 0;
        let alive = match GetExitCodeProcess(handle, &mut exit_code) {
            Ok(_) => exit_code == STILL_ACTIVE.0 as u32,
            Err(_) => false,
        };
        let _ = CloseHandle(handle);
        alive
    }
}

/// Snapshot the OS default render endpoint id. Returns None if the call
/// fails (which we treat as "no change observable" rather than a fatal
/// error — the next poll will retry).
fn current_default_render_id(enumerator: &DeviceEnumerator) -> Option<String> {
    enumerator
        .get_default_device(&Direction::Render)
        .ok()
        .and_then(|d| d.get_id().ok())
}

#[derive(Debug)]
enum SessionOutcome {
    /// `--watch-default` detected the OS default render endpoint changed.
    /// Caller should jlog and re-enter the capture session.
    DefaultChanged { new_id: String },
    /// `--owner-pid` detected the parent is gone. Caller should jlog and
    /// std::process::exit(0).
    OwnerDead,
}

fn main() -> Res<()> {
    let cli = Cli::parse();

    // CLI validation. Phase 1g-3.7 fixes the output shape; Phase 1g-3.8
    // will widen this. Failing fast (and loudly via JSON) is the right
    // thing for a leaf helper.
    if cli.rate != TARGET_SAMPLE_RATE {
        jlog(
            "error",
            "unsupported_rate",
            json!({"requested": cli.rate, "supported": TARGET_SAMPLE_RATE}),
        );
        std::process::exit(2);
    }
    if cli.channels != 1 {
        jlog(
            "error",
            "unsupported_channels",
            json!({"requested": cli.channels, "supported": 1}),
        );
        std::process::exit(2);
    }
    if cli.format != "s16le" {
        jlog(
            "error",
            "unsupported_format",
            json!({"requested": cli.format, "supported": "s16le"}),
        );
        std::process::exit(2);
    }
    if cli.device != "default" {
        jlog(
            "warn",
            "device_name_ignored",
            json!({
                "requested": cli.device,
                "fallback": "default",
                "note": "Phase 1g-3.8 will honour explicit device names"
            }),
        );
    }

    // COM init: ignored failure — some hosts (e.g. an Electron parent) may
    // already have entered STA, in which case initialize_mta returns
    // RPC_E_CHANGED_MODE. WASAPI works fine either way for our purposes.
    let _ = initialize_mta();
    let enumerator = DeviceEnumerator::new()?;

    jlog(
        "info",
        "started",
        json!({
            "version": env!("CARGO_PKG_VERSION"),
            "rate": cli.rate,
            "channels": cli.channels,
            "format": cli.format,
            "watch_default": cli.watch_default,
            "owner_pid": cli.owner_pid,
        }),
    );

    let stdout = io::stdout();
    let mut out = stdout.lock();

    // Outer loop: re-enters when --watch-default detects a default device
    // change. Each iteration brings up a fresh AudioClient + resampler.
    loop {
        let device = match enumerator.get_default_device(&Direction::Render) {
            Ok(d) => d,
            Err(e) => {
                jlog(
                    "error",
                    "open_failed",
                    json!({"stage": "get_default_device", "reason": format!("{:?}", e)}),
                );
                std::process::exit(1);
            }
        };
        let device_id = device.get_id().unwrap_or_else(|_| "<unknown>".to_string());
        let device_name = device
            .get_friendlyname()
            .unwrap_or_else(|_| "<unknown>".to_string());

        match run_capture_session(&cli, &enumerator, &device, &device_id, &device_name, &mut out)? {
            SessionOutcome::DefaultChanged { new_id } => {
                jlog(
                    "info",
                    "default_changed",
                    json!({"old_id": device_id, "new_id": new_id}),
                );
                // Loop back; the next iteration grabs the new default.
                continue;
            }
            SessionOutcome::OwnerDead => {
                jlog(
                    "info",
                    "shutdown",
                    json!({"reason": "owner_pid_dead", "owner_pid": cli.owner_pid}),
                );
                // Clean exit so wrappers see code 0 (graceful) rather than
                // signal-terminated. The capture session already stopped
                // its WASAPI stream on its way out.
                return Ok(());
            }
        }
    }
}

fn run_capture_session(
    cli: &Cli,
    enumerator: &DeviceEnumerator,
    device: &wasapi::Device,
    device_id: &str,
    device_name: &str,
    out: &mut std::io::StdoutLock,
) -> Res<SessionOutcome> {
    let mut audio_client = device.get_iaudioclient()?;
    let format = audio_client.get_mixformat()?;
    let samples_per_sec = format.get_samplespersec() as usize;
    let channels = format.get_nchannels() as usize;
    let bits_per_sample = format.get_bitspersample() as usize;
    let blockalign = format.get_blockalign() as usize;

    // Phase 1g-3.7 supports f32 mix formats only. Almost all modern
    // Windows configs report IEEE_FLOAT 32-bit; if this changes we'll
    // surface a structured error and let the caller retry with a
    // different backend.
    if bits_per_sample != 32 {
        jlog(
            "error",
            "unsupported_input_format",
            json!({"bits_per_sample": bits_per_sample, "expected": 32}),
        );
        return Err("unsupported input bits/sample".into());
    }

    let desired_chunk_in = (samples_per_sec * CHUNK_MS) / 1000;
    let mut resampler: FftFixedInOut<f32> = FftFixedInOut::new(
        samples_per_sec,
        TARGET_SAMPLE_RATE,
        desired_chunk_in,
        1,
    )?;
    let actual_chunk_in = resampler.input_frames_next();
    let actual_chunk_out = resampler.output_frames_next();

    jlog(
        "info",
        "opened",
        json!({
            "device_id": device_id,
            "device_name": device_name,
            "input_rate": samples_per_sec,
            "input_channels": channels,
            "input_bits": bits_per_sample,
            "input_blockalign": blockalign,
            "output_rate": TARGET_SAMPLE_RATE,
            "output_channels": 1,
            "output_format": "s16le",
            "chunk_in_frames": actual_chunk_in,
            "chunk_out_frames": actual_chunk_out,
        }),
    );

    let (_def_period, min_period) = audio_client.get_device_period()?;
    let mode = StreamMode::EventsShared {
        autoconvert: false,
        buffer_duration_hns: min_period,
    };
    audio_client.initialize_client(&format, &Direction::Capture, &mode)?;

    let h_event = audio_client.set_get_eventhandle()?;
    let capture_client = audio_client.get_audiocaptureclient()?;
    audio_client.start_stream()?;

    jlog("info", "streaming", json!({"device_id": device_id}));

    // Buffers reused across iterations to avoid per-chunk allocation.
    let mut byte_queue: VecDeque<u8> = VecDeque::with_capacity(64 * 1024);
    let mut mono_accumulator: Vec<f32> = Vec::with_capacity(actual_chunk_in * 4);
    let mut input_chunk: Vec<Vec<f32>> = vec![vec![0.0f32; actual_chunk_in]];
    let mut output_chunk: Vec<Vec<f32>> = resampler.output_buffer_allocate(true);
    let mut emit_buf: Vec<u8> = Vec::with_capacity(actual_chunk_out * 2);
    let mut last_health_check = Instant::now();

    loop {
        // Health check (--owner-pid + --watch-default) at most once per
        // HEALTH_CHECK_INTERVAL, regardless of audio activity. The
        // CAPTURE_EVENT_TIMEOUT_MS lets us re-enter the loop even when
        // the system is silent, so we don't miss a parent-dies-without-
        // killing-us scenario.
        if last_health_check.elapsed() >= HEALTH_CHECK_INTERVAL {
            if let Some(pid) = cli.owner_pid {
                if !is_pid_alive(pid) {
                    let _ = audio_client.stop_stream();
                    return Ok(SessionOutcome::OwnerDead);
                }
            }
            if cli.watch_default {
                if let Some(current_id) = current_default_render_id(enumerator) {
                    if current_id != device_id {
                        let _ = audio_client.stop_stream();
                        return Ok(SessionOutcome::DefaultChanged { new_id: current_id });
                    }
                }
            }
            last_health_check = Instant::now();
        }

        if h_event.wait_for_event(CAPTURE_EVENT_TIMEOUT_MS).is_err() {
            // Timeout — silent system. Loop back so the health check fires.
            continue;
        }

        capture_client.read_from_device_to_deque(&mut byte_queue)?;

        // Drain bytes → mono f32 frames. Each WASAPI frame is
        // `channels` * 4 bytes (f32 LE on every platform we care about).
        while byte_queue.len() >= blockalign {
            let mut sum = 0.0f32;
            for _ in 0..channels {
                let b0 = byte_queue.pop_front().unwrap();
                let b1 = byte_queue.pop_front().unwrap();
                let b2 = byte_queue.pop_front().unwrap();
                let b3 = byte_queue.pop_front().unwrap();
                sum += f32::from_le_bytes([b0, b1, b2, b3]);
            }
            mono_accumulator.push(sum / channels as f32);
        }

        // Resample chunk-by-chunk. The accumulator may hold several chunks
        // worth if WASAPI delivered a backlog; loop until under one chunk.
        while mono_accumulator.len() >= actual_chunk_in {
            input_chunk[0].copy_from_slice(&mono_accumulator[..actual_chunk_in]);
            mono_accumulator.drain(..actual_chunk_in);

            let _ = resampler.process_into_buffer(&input_chunk, &mut output_chunk, None)?;

            // f32 mono 16k → s16le. Single batched write so stdout block
            // buffering can absorb the call.
            emit_buf.clear();
            for &sample in &output_chunk[0] {
                let clamped = sample.clamp(-1.0, 1.0);
                // Standard f32→i16 conversion: scale by 32767 (positive
                // peak) and 32768 (negative peak) to avoid wrap on -1.0.
                let s16 = if clamped < 0.0 {
                    (clamped * 32768.0) as i16
                } else {
                    (clamped * 32767.0) as i16
                };
                emit_buf.extend_from_slice(&s16.to_le_bytes());
            }
            out.write_all(&emit_buf)?;
            out.flush()?;
        }
    }
}
