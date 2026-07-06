// src/utils/keyVerify.js
// Live BYOK key verification for the guided wizard. Each function makes ONE
// free/no-cost authenticated request and classifies the result. Runs in the
// Electron main process (invoked via IPC). fetchImpl is injectable for tests;
// it defaults to the Node/Electron global fetch.
//
// Result: { ok: boolean, reason?: 'invalid' | 'rate' | 'network' | 'unknown' }
// Verification is advisory — callers must never block saving a key on a
// non-ok result (offline must not brick the user).

async function verifyGeminiKey(key, fetchImpl = fetch) {
    const k = (key || '').trim();
    if (!k) return { ok: false, reason: 'invalid' };
    try {
        // models.list is free and consumes no generation tokens.
        const res = await fetchImpl('https://generativelanguage.googleapis.com/v1beta/models?key=' + encodeURIComponent(k));
        if (res.ok) return { ok: true };
        if (res.status === 400 || res.status === 401 || res.status === 403) return { ok: false, reason: 'invalid' };
        if (res.status === 429) return { ok: false, reason: 'rate' };
        return { ok: false, reason: 'unknown' };
    } catch (e) {
        return { ok: false, reason: 'network' };
    }
}

async function verifyDeepgramKey(key, fetchImpl = fetch) {
    const k = (key || '').trim();
    if (!k) return { ok: false, reason: 'invalid' };
    try {
        // projects list is free and sends no audio.
        const res = await fetchImpl('https://api.deepgram.com/v1/projects', {
            headers: { Authorization: 'Token ' + k },
        });
        if (res.ok) return { ok: true };
        if (res.status === 401 || res.status === 403) return { ok: false, reason: 'invalid' };
        if (res.status === 429) return { ok: false, reason: 'rate' };
        return { ok: false, reason: 'unknown' };
    } catch (e) {
        return { ok: false, reason: 'network' };
    }
}

module.exports = { verifyGeminiKey, verifyDeepgramKey };
