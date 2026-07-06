// Aurora + dither animation utility.
// Started life inside OnboardingView; extracted so MainView can reuse
// the same look. Pure DOM/canvas — no app state, no IPC.
//
// Usage:
//   const handle = startAurora(auroraCanvasEl, ditherCanvasEl, { intensity: 'strong' });
//   // ...
//   stopAurora(handle);
//
// `intensity` accepts 'strong' (default, matches OnboardingView original)
// — additional presets like 'subtle' can be plugged in here later
// without touching call sites.

function drawDither(canvas, blockSize = 5) {
    if (!canvas) return;
    const cols = Math.ceil(canvas.offsetWidth / blockSize);
    const rows = Math.ceil(canvas.offsetHeight / blockSize);
    canvas.width = cols;
    canvas.height = rows;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(cols, rows);
    for (let i = 0; i < img.data.length; i += 4) {
        const v = Math.random() > 0.5 ? 255 : 0;
        img.data[i] = v;
        img.data[i + 1] = v;
        img.data[i + 2] = v;
        img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
}

const INTENSITY_PRESETS = {
    // OnboardingView の初回 delight。色味がはっきり乗る。
    strong: {
        scale: 0.35,
        baseRadius: 0.32,
        stops: [
            { at: 0, alpha: 0.55 },
            { at: 0.4, alpha: 0.3 },
            { at: 0.7, alpha: 0.1 },
            { at: 1, alpha: 0 },
        ],
    },
    // MainView 用「気配」レベル。Direction A の clean enterprise を
    // 崩さない範囲で、起動毎に "ふっ" と何か息づいてる程度の hint。
    soft: {
        scale: 0.35,
        baseRadius: 0.32,
        stops: [
            { at: 0, alpha: 0.2 },
            { at: 0.4, alpha: 0.1 },
            { at: 0.7, alpha: 0.04 },
            { at: 1, alpha: 0 },
        ],
    },
};

const BLOB_PRESET = [
    {
        parts: [
            { ox: 0, oy: 0, r: 1.0 },
            { ox: 0.22, oy: 0.1, r: 0.85 },
            { ox: 0.11, oy: 0.05, r: 0.5 },
        ],
        color: [180, 200, 230],
        x: 0.15,
        y: 0.2,
        vx: 0.35,
        vy: 0.25,
        phase: 0,
    },
    {
        parts: [
            { ox: 0, oy: 0, r: 0.95 },
            { ox: 0.18, oy: -0.08, r: 0.75 },
            { ox: 0.09, oy: -0.04, r: 0.4 },
        ],
        color: [190, 180, 220],
        x: 0.75,
        y: 0.2,
        vx: -0.3,
        vy: 0.35,
        phase: 1.2,
    },
    {
        parts: [
            { ox: 0, oy: 0, r: 0.9 },
            { ox: 0.24, oy: 0.12, r: 0.9 },
            { ox: 0.12, oy: 0.06, r: 0.35 },
        ],
        color: [210, 195, 215],
        x: 0.5,
        y: 0.65,
        vx: 0.25,
        vy: -0.3,
        phase: 2.4,
    },
    {
        parts: [
            { ox: 0, oy: 0, r: 0.8 },
            { ox: -0.15, oy: 0.18, r: 0.7 },
            { ox: -0.07, oy: 0.09, r: 0.45 },
        ],
        color: [175, 210, 210],
        x: 0.1,
        y: 0.75,
        vx: 0.4,
        vy: 0.2,
        phase: 3.6,
    },
    {
        parts: [
            { ox: 0, oy: 0, r: 0.75 },
            { ox: 0.12, oy: -0.15, r: 0.65 },
            { ox: 0.06, oy: -0.07, r: 0.35 },
        ],
        color: [220, 210, 195],
        x: 0.85,
        y: 0.55,
        vx: -0.28,
        vy: -0.32,
        phase: 4.8,
    },
    {
        parts: [
            { ox: 0, oy: 0, r: 0.95 },
            { ox: -0.2, oy: -0.12, r: 0.75 },
            { ox: -0.1, oy: -0.06, r: 0.4 },
        ],
        color: [170, 190, 225],
        x: 0.6,
        y: 0.1,
        vx: -0.2,
        vy: 0.38,
        phase: 6.0,
    },
    {
        parts: [
            { ox: 0, oy: 0, r: 0.85 },
            { ox: 0.17, oy: 0.15, r: 0.75 },
            { ox: 0.08, oy: 0.07, r: 0.35 },
        ],
        color: [200, 190, 220],
        x: 0.35,
        y: 0.4,
        vx: 0.32,
        vy: -0.22,
        phase: 7.2,
    },
    {
        parts: [
            { ox: 0, oy: 0, r: 0.75 },
            { ox: -0.13, oy: 0.18, r: 0.65 },
            { ox: -0.06, oy: 0.1, r: 0.4 },
        ],
        color: [215, 205, 200],
        x: 0.9,
        y: 0.85,
        vx: -0.35,
        vy: -0.25,
        phase: 8.4,
    },
    {
        parts: [
            { ox: 0, oy: 0, r: 0.7 },
            { ox: 0.16, oy: -0.1, r: 0.6 },
            { ox: 0.08, oy: -0.05, r: 0.35 },
        ],
        color: [185, 210, 205],
        x: 0.45,
        y: 0.9,
        vx: 0.22,
        vy: -0.4,
        phase: 9.6,
    },
];
Object.freeze(BLOB_PRESET);
BLOB_PRESET.forEach(blob => {
    Object.freeze(blob);
    Object.freeze(blob.color);
    blob.parts.forEach(part => Object.freeze(part));
    Object.freeze(blob.parts);
});

function startAurora(auroraCanvas, ditherCanvas, options = {}) {
    const intensity = options.intensity || 'strong';
    const preset = INTENSITY_PRESETS[intensity] || INTENSITY_PRESETS.strong;

    if (ditherCanvas) drawDither(ditherCanvas);

    const ctx = auroraCanvas.getContext('2d');
    const scale = preset.scale;
    auroraCanvas.width = Math.floor(auroraCanvas.offsetWidth * scale);
    auroraCanvas.height = Math.floor(auroraCanvas.offsetHeight * scale);

    const blobs = BLOB_PRESET;
    const handle = { time: 0, animId: null, stopped: false };

    const draw = () => {
        if (handle.stopped) return;
        handle.time += 0.012;
        const w = auroraCanvas.width;
        const h = auroraCanvas.height;
        const dim = Math.min(w, h);

        ctx.fillStyle = '#f0f0f0';
        ctx.fillRect(0, 0, w, h);

        for (const blob of blobs) {
            const t = handle.time;
            const cx = (blob.x + Math.sin(t * blob.vx + blob.phase) * 0.22) * w;
            const cy = (blob.y + Math.cos(t * blob.vy + blob.phase * 0.7) * 0.22) * h;
            for (const part of blob.parts) {
                const wobble = Math.sin(t * 2.5 + part.ox * 25 + blob.phase) * 0.02;
                const px = cx + (part.ox + wobble) * dim;
                const py = cy + (part.oy + wobble * 0.7) * dim;
                const pr = part.r * preset.baseRadius * dim;

                const grad = ctx.createRadialGradient(px, py, 0, px, py, pr);
                for (const s of preset.stops) {
                    grad.addColorStop(s.at, `rgba(${blob.color[0]}, ${blob.color[1]}, ${blob.color[2]}, ${s.alpha})`);
                }
                ctx.fillStyle = grad;
                ctx.fillRect(0, 0, w, h);
            }
        }
        handle.animId = requestAnimationFrame(draw);
    };

    draw();
    return handle;
}

function stopAurora(handle) {
    if (!handle) return;
    handle.stopped = true;
    if (handle.animId) cancelAnimationFrame(handle.animId);
}

const _api = { startAurora, stopAurora, drawDither };

if (typeof module !== 'undefined' && module.exports) {
    module.exports = _api;
}
if (typeof window !== 'undefined') {
    window.WhisperAurora = _api;
}
