'use strict';

// Shared by the response renderer and the main-process IPC boundary.
function normalizeExternalUrl(value) {
    if (typeof value !== 'string' || /[\u0000-\u0020\u007f]/.test(value)) return null;
    if (!/^(https?:\/\/|mailto:)/i.test(value)) return null;
    try {
        const url = new URL(value);
        if (url.protocol === 'http:' || url.protocol === 'https:') {
            if (!url.hostname || url.username || url.password) return null;
        } else if (url.protocol === 'mailto:') {
            if (!url.pathname) return null;
        } else {
            return null;
        }
        return url.href;
    } catch {
        return null;
    }
}

module.exports = { normalizeExternalUrl };
