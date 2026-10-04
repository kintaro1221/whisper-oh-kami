const DIAGNOSTIC_RING_LIMIT = 20;

const diagnosticRing = [];

function normalizeTimestamp(timestamp) {
    const value = typeof timestamp === 'number' ? timestamp : Date.parse(timestamp);
    if (Number.isFinite(value)) return value;
    return Date.now();
}

function toIso(timestamp) {
    return new Date(normalizeTimestamp(timestamp)).toISOString();
}

function hasValue(value) {
    return typeof value === 'string' && value.trim() !== '';
}

function sanitizeDiagnostic(diagnostic) {
    if (!diagnostic || typeof diagnostic !== 'object' || !diagnostic.code) return null;
    return {
        code: String(diagnostic.code),
        timestamp: toIso(diagnostic.timestamp || Date.now()),
    };
}

function summarizeSessions(sessions = []) {
    const summary = {
        sessionCount: 0,
        totalMessages: 0,
        totalScreenAnalyses: 0,
        totalFeedbackEvents: 0,
        profiles: {},
    };

    for (const session of Array.isArray(sessions) ? sessions : []) {
        if (!session || typeof session !== 'object') continue;
        summary.sessionCount += 1;
        summary.totalMessages += Number(session.messageCount) || 0;
        summary.totalScreenAnalyses += Number(session.screenAnalysisCount) || 0;
        summary.totalFeedbackEvents += Number(session.feedbackCount) || 0;
        const profile = typeof session.profile === 'string' && session.profile ? session.profile : 'unknown';
        summary.profiles[profile] = (summary.profiles[profile] || 0) + 1;
    }

    return summary;
}

function buildSupportSnapshot({
    now = Date.now,
    appVersion = '',
    electronVersion = '',
    osInfo = {},
    safeStorageAvailable = false,
    credentialStorageSessionOnly = false,
    preferences = {},
    credentials = {},
    sessions = [],
    diagnostics = [],
} = {}) {
    const generatedAtMs = typeof now === 'function' ? now() : Date.now();

    return {
        schemaVersion: 1,
        generatedAt: toIso(generatedAtMs),
        app: {
            version: appVersion,
            electronVersion,
        },
        runtime: {
            platform: osInfo.platform || '',
            release: osInfo.release || '',
            arch: osInfo.arch || '',
            safeStorageAvailable: !!safeStorageAvailable,
            credentialStorageSessionOnly: !!credentialStorageSessionOnly,
        },
        settings: {
            providerMode: preferences.providerMode || '',
            sttMode: preferences.sttMode || '',
            whisperModel: preferences.whisperModel || '',
            selectedProfile: preferences.selectedProfile || '',
        },
        credentialPresence: {
            geminiApiKey: hasValue(credentials.apiKey),
            groqApiKey: hasValue(credentials.groqApiKey),
            deepgramApiKey: hasValue(credentials.deepgramApiKey),
        },
        diagnostics: (Array.isArray(diagnostics) ? diagnostics : []).map(sanitizeDiagnostic).filter(Boolean).slice(-DIAGNOSTIC_RING_LIMIT),
        sessionSummary: summarizeSessions(sessions),
    };
}

function recordDiagnosticCode(diagnostic) {
    if (!diagnostic || typeof diagnostic !== 'object' || !diagnostic.code) return;
    diagnosticRing.push({
        code: String(diagnostic.code),
        timestamp: normalizeTimestamp(diagnostic.timestamp || Date.now()),
    });
    if (diagnosticRing.length > DIAGNOSTIC_RING_LIMIT) {
        diagnosticRing.splice(0, diagnosticRing.length - DIAGNOSTIC_RING_LIMIT);
    }
}

function getRecentDiagnosticCodes() {
    return diagnosticRing.map(item => ({ ...item }));
}

module.exports = {
    buildSupportSnapshot,
    recordDiagnosticCode,
    getRecentDiagnosticCodes,
};
