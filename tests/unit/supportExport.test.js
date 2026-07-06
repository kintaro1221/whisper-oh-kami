const { buildSupportSnapshot, recordDiagnosticCode, getRecentDiagnosticCodes } = require('../../src/utils/supportExport');
const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..', '..');

function read(relPath) {
    return fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
}

describe('support export snapshot', () => {
    test('includes only non-PII diagnostics and configuration state', () => {
        const snapshot = buildSupportSnapshot({
            now: () => 1710000000000,
            appVersion: '0.7.0',
            electronVersion: '42.5.0',
            osInfo: {
                platform: 'win32',
                release: '10.0.22631',
                arch: 'x64',
            },
            safeStorageAvailable: true,
            preferences: {
                providerMode: 'byok',
                sttMode: 'cloud',
                whisperModel: 'Xenova/whisper-tiny',
                selectedProfile: 'discovery',
                customPrompt: 'SECRET custom prompt',
                contextProfile: { company: 'SECRET customer background' },
                micDeviceLabel: 'SECRET microphone label',
                systemDeviceLabel: 'SECRET speaker label',
            },
            credentials: {
                apiKey: 'SECRET_GEMINI_KEY',
                groqApiKey: '',
                deepgramApiKey: 'SECRET_DEEPGRAM_KEY',
            },
            sessions: [
                {
                    sessionId: '1710000000000',
                    profile: 'sales',
                    messageCount: 3,
                    screenAnalysisCount: 2,
                    feedbackCount: 1,
                    customPrompt: 'SECRET session prompt',
                    conversationHistory: [{ transcription: 'SECRET transcript', response: 'SECRET response' }],
                    screenAnalysisHistory: [{ prompt: 'SECRET image prompt', response: 'SECRET screen response' }],
                },
            ],
            diagnostics: [{ code: 'gemini_auth_failed', timestamp: 1709999999000, detail: 'SECRET detail', message: 'SECRET message' }],
        });

        expect(snapshot).toMatchObject({
            schemaVersion: 1,
            generatedAt: '2024-03-09T16:00:00.000Z',
            app: {
                version: '0.7.0',
                electronVersion: '42.5.0',
            },
            runtime: {
                platform: 'win32',
                release: '10.0.22631',
                arch: 'x64',
                safeStorageAvailable: true,
            },
            settings: {
                providerMode: 'byok',
                sttMode: 'cloud',
                whisperModel: 'Xenova/whisper-tiny',
                selectedProfile: 'discovery',
            },
            credentialPresence: {
                geminiApiKey: true,
                groqApiKey: false,
                deepgramApiKey: true,
            },
            diagnostics: [{ code: 'gemini_auth_failed', timestamp: '2024-03-09T15:59:59.000Z' }],
            sessionSummary: {
                sessionCount: 1,
                totalMessages: 3,
                totalScreenAnalyses: 2,
                totalFeedbackEvents: 1,
                profiles: { sales: 1 },
            },
        });

        const serialized = JSON.stringify(snapshot);
        expect(serialized).not.toContain('SECRET');
        expect(serialized).not.toMatch(/customPrompt|contextProfile|conversationHistory|screenAnalysisHistory|transcript|deviceLabel/i);
    });

    test('keeps a code and timestamp only diagnostic ring buffer', () => {
        for (let i = 0; i < 25; i += 1) {
            recordDiagnosticCode({
                code: `code_${i}`,
                timestamp: 1710000000000 + i,
                detail: `SECRET detail ${i}`,
                message: `SECRET message ${i}`,
            });
        }

        const recent = getRecentDiagnosticCodes();

        expect(recent).toHaveLength(20);
        expect(recent[0]).toEqual({ code: 'code_5', timestamp: 1710000000005 });
        expect(recent[19]).toEqual({ code: 'code_24', timestamp: 1710000000024 });
        expect(JSON.stringify(recent)).not.toContain('SECRET');
    });

    test('wires export through local IPC and settings UI without network senders', () => {
        const index = read('src/index.js');
        const renderer = read('src/utils/renderer.js');
        const customizeView = read('src/components/views/CustomizeView.js');
        const ja = require('../../src/i18n/ja');
        const en = require('../../src/i18n/en');

        expect(index).toMatch(/support:export-diagnostics/);
        expect(index).toMatch(/buildSupportSnapshot/);
        expect(index).toMatch(/shell\.openPath/);
        expect(index).not.toMatch(/fetch\(|http\.request|https\.request/);
        expect(renderer).toMatch(/recordDiagnosticCode/);
        expect(renderer).toMatch(/getRecentDiagnosticCodes/);
        expect(renderer).toMatch(/support:export-diagnostics/);
        expect(customizeView).toMatch(/exportSupportDiagnostics/);
        expect(customizeView).toMatch(/customize\.support_export\.button/);
        expect(ja['customize.support_export.button']).toEqual(expect.any(String));
        expect(en['customize.support_export.button']).toEqual(expect.any(String));
    });
});
