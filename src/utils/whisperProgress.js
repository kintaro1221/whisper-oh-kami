'use strict';

// Aggregates @huggingface/transformers download progress events (the library
// emits one progress stream per model file) into a single overall percentage,
// so the first-run Whisper model download can show real progress instead of an
// indeterminate spinner. A non-engineer on slow Wi-Fi otherwise sees a frozen
// "downloading..." and assumes the app hung (audit A3).

function formatMB(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return 0;
    return Math.round((bytes / (1024 * 1024)) * 10) / 10;
}

function createWhisperProgressTracker() {
    // file key -> { loaded, total } in bytes
    const files = new Map();

    function snapshot() {
        let loaded = 0;
        let total = 0;
        for (const entry of files.values()) {
            loaded += entry.loaded;
            total += entry.total;
        }
        const percent = total > 0 ? Math.min(100, Math.max(0, Math.round((loaded / total) * 100))) : 0;
        return {
            percent,
            loadedBytes: loaded,
            totalBytes: total,
            loadedMB: formatMB(loaded),
            totalMB: formatMB(total),
            fileCount: files.size,
        };
    }

    function update(event) {
        if (event && typeof event === 'object') {
            const key = event.file || event.name;
            const total = Number(event.total);
            const loaded = Number(event.loaded);
            if (key && Number.isFinite(total) && total > 0) {
                if (event.status === 'done') {
                    files.set(key, { loaded: total, total });
                } else if (Number.isFinite(loaded)) {
                    const prev = files.get(key);
                    // Never let a late / out-of-order event regress a file's bytes.
                    const nextLoaded = prev ? Math.max(prev.loaded, loaded) : loaded;
                    files.set(key, { loaded: Math.min(nextLoaded, total), total });
                }
            }
        }
        return snapshot();
    }

    return {
        update,
        snapshot,
        reset() {
            files.clear();
        },
    };
}

module.exports = { createWhisperProgressTracker, formatMB };
