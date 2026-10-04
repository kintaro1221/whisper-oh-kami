const fs = require('fs');
const path = require('path');
const os = require('os');

function makeSafeStorage({ available = true } = {}) {
    return {
        isEncryptionAvailable: () => available,
        encryptString: plaintext => Buffer.from(`enc:${Buffer.from(plaintext, 'utf8').toString('base64')}`, 'utf8'),
        decryptString: buffer => {
            const raw = Buffer.from(buffer).toString('utf8');
            if (!raw.startsWith('enc:')) throw new Error('invalid encrypted payload');
            return Buffer.from(raw.slice(4), 'base64').toString('utf8');
        },
    };
}

describe('storage credentials encryption', () => {
    let tmpHome;
    let storage;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'wok-credentials-test-'));
        jest.spyOn(os, 'homedir').mockReturnValue(tmpHome);
        jest.resetModules();
        storage = require('../../src/storage');
    });

    afterEach(() => {
        if (storage && storage._setSafeStorageForTest) {
            storage._setSafeStorageForTest(null);
        }
        jest.restoreAllMocks();
        if (tmpHome && fs.existsSync(tmpHome)) {
            fs.rmSync(tmpHome, { recursive: true, force: true });
        }
    });

    test('setCredentials stores API keys as an encrypted payload and getCredentials decrypts them', () => {
        storage._setSafeStorageForTest(makeSafeStorage());
        storage.initializeStorage();

        storage.setCredentials({
            apiKey: 'gemini-secret',
            groqApiKey: 'groq-secret',
            deepgramApiKey: 'deepgram-secret',
        });

        const credentialsPath = path.join(storage.getConfigDir(), 'credentials.json');
        const rawText = fs.readFileSync(credentialsPath, 'utf8');
        expect(rawText).not.toContain('gemini-secret');
        expect(rawText).not.toContain('groq-secret');
        expect(rawText).not.toContain('deepgram-secret');
        expect(JSON.parse(rawText)).toMatchObject({ __encrypted: true, version: 1 });

        expect(storage.getCredentials()).toMatchObject({
            apiKey: 'gemini-secret',
            groqApiKey: 'groq-secret',
            deepgramApiKey: 'deepgram-secret',
        });
    });

    test('initializeStorage migrates existing plaintext credentials without requiring key re-entry', () => {
        storage._setSafeStorageForTest(makeSafeStorage());
        const configDir = storage.getConfigDir();
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ configVersion: 1, onboarded: true, layout: 'normal' }));
        fs.writeFileSync(
            path.join(configDir, 'credentials.json'),
            JSON.stringify({
                apiKey: 'legacy-gemini-secret',
                groqApiKey: 'legacy-groq-secret',
                deepgramApiKey: 'legacy-deepgram-secret',
            })
        );
        fs.writeFileSync(path.join(configDir, 'preferences.json'), JSON.stringify({ selectedProfile: 'sales' }));

        storage.initializeStorage();

        const credentialsPath = path.join(configDir, 'credentials.json');
        const rawText = fs.readFileSync(credentialsPath, 'utf8');
        expect(rawText).not.toContain('legacy-gemini-secret');
        expect(JSON.parse(rawText).__encrypted).toBe(true);
        expect(storage.getCredentials()).toMatchObject({
            apiKey: 'legacy-gemini-secret',
            groqApiKey: 'legacy-groq-secret',
            deepgramApiKey: 'legacy-deepgram-secret',
        });
    });

    function encryptionWarnings(warnSpy) {
        return warnSpy.mock.calls.filter(([message]) => String(message).includes('[storage] Credential encryption unavailable'));
    }

    function writeLegacyPlaintextConfig(configDir, credentials) {
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ configVersion: 1, onboarded: true, layout: 'normal' }));
        fs.writeFileSync(path.join(configDir, 'preferences.json'), JSON.stringify({ selectedProfile: 'sales' }));
        const credentialsPath = path.join(configDir, 'credentials.json');
        fs.writeFileSync(credentialsPath, JSON.stringify(credentials));
        return credentialsPath;
    }

    test('safeStorage unavailable keeps keys in memory for the session and never writes them to disk', () => {
        storage._setSafeStorageForTest(makeSafeStorage({ available: false }));
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
        storage.initializeStorage();

        expect(() => storage.setCredentials({ apiKey: 'fallback-gemini-secret' })).not.toThrow();

        const credentialsPath = path.join(storage.getConfigDir(), 'credentials.json');
        if (fs.existsSync(credentialsPath)) {
            expect(fs.readFileSync(credentialsPath, 'utf8')).not.toContain('fallback-gemini-secret');
        }
        expect(storage.getCredentials().apiKey).toBe('fallback-gemini-secret');
        expect(storage.getApiKey()).toBe('fallback-gemini-secret');

        storage.setCredentials({ deepgramApiKey: 'fallback-deepgram-secret' });
        expect(storage.getCredentials()).toMatchObject({ apiKey: 'fallback-gemini-secret', deepgramApiKey: 'fallback-deepgram-secret' });
        if (fs.existsSync(credentialsPath)) {
            expect(fs.readFileSync(credentialsPath, 'utf8')).not.toContain('fallback-deepgram-secret');
        }

        const status = storage.getCredentialStorageStatus();
        expect(status).toEqual({ encrypted: false, sessionOnly: true, reason: expect.any(String) });
        expect(status.reason.length).toBeGreaterThan(0);

        const warnings = encryptionWarnings(warnSpy);
        expect(warnings).toHaveLength(1);
        expect(warnings[0][0]).toContain('kept in memory for this session only and not written to disk');
    });

    test('safeStorage unavailable never creates credentials.json with key material', () => {
        storage._setSafeStorageForTest(makeSafeStorage({ available: false }));
        jest.spyOn(console, 'warn').mockImplementation(() => {});

        const credentialsPath = path.join(storage.getConfigDir(), 'credentials.json');
        expect(fs.existsSync(credentialsPath)).toBe(false);

        storage.setCredentials({ apiKey: 'fresh-gemini-secret' });

        expect(fs.existsSync(credentialsPath)).toBe(false);
        expect(storage.getCredentials().apiKey).toBe('fresh-gemini-secret');
    });

    test('safeStorage available reports encrypted status and writes an encrypted file', () => {
        storage._setSafeStorageForTest(makeSafeStorage());
        storage.initializeStorage();

        expect(storage.getCredentialStorageStatus()).toEqual({ encrypted: true, sessionOnly: false, reason: null });

        storage.setCredentials({ apiKey: 'available-gemini-secret' });
        const rawText = fs.readFileSync(path.join(storage.getConfigDir(), 'credentials.json'), 'utf8');
        expect(rawText).not.toContain('available-gemini-secret');
        expect(JSON.parse(rawText).__encrypted).toBe(true);
    });

    test('safeStorage unavailable still reads a legacy plaintext file and does not rewrite it', () => {
        storage._setSafeStorageForTest(makeSafeStorage({ available: false }));
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
        const credentialsPath = writeLegacyPlaintextConfig(storage.getConfigDir(), {
            apiKey: 'legacy-gemini-secret',
            groqApiKey: '',
            deepgramApiKey: 'legacy-deepgram-secret',
        });
        const past = new Date(Date.now() - 60_000);
        fs.utimesSync(credentialsPath, past, past);
        const before = { content: fs.readFileSync(credentialsPath, 'utf8'), mtimeMs: fs.statSync(credentialsPath).mtimeMs };

        storage.initializeStorage();
        expect(storage.getCredentials()).toMatchObject({ apiKey: 'legacy-gemini-secret', deepgramApiKey: 'legacy-deepgram-secret' });
        expect(fs.readFileSync(credentialsPath, 'utf8')).toBe(before.content);
        expect(fs.statSync(credentialsPath).mtimeMs).toBe(before.mtimeMs);

        // A new key entered this session stays in memory; the legacy file is left as is.
        storage.setCredentials({ apiKey: 'new-gemini-secret' });
        expect(storage.getCredentials()).toMatchObject({ apiKey: 'new-gemini-secret', deepgramApiKey: 'legacy-deepgram-secret' });
        expect(fs.readFileSync(credentialsPath, 'utf8')).toBe(before.content);
        expect(fs.readFileSync(credentialsPath, 'utf8')).not.toContain('new-gemini-secret');
        expect(encryptionWarnings(warnSpy)).toHaveLength(1);
    });

    test('safeStorage unavailable: clearing every key removes legacy plaintext keys from disk', () => {
        storage._setSafeStorageForTest(makeSafeStorage({ available: false }));
        jest.spyOn(console, 'warn').mockImplementation(() => {});
        const credentialsPath = writeLegacyPlaintextConfig(storage.getConfigDir(), {
            apiKey: 'legacy-gemini-secret',
            groqApiKey: '',
            deepgramApiKey: '',
        });
        storage.initializeStorage();

        storage.setCredentials({ apiKey: '' });

        expect(storage.getCredentials().apiKey).toBe('');
        expect(fs.readFileSync(credentialsPath, 'utf8')).not.toContain('legacy-gemini-secret');
    });

    test('safeStorage unavailable: an existing encrypted file is never overwritten', () => {
        storage._setSafeStorageForTest(makeSafeStorage());
        storage.initializeStorage();
        storage.setCredentials({ apiKey: 'encrypted-gemini-secret' });
        const credentialsPath = path.join(storage.getConfigDir(), 'credentials.json');
        const before = fs.readFileSync(credentialsPath, 'utf8');

        storage._setSafeStorageForTest(makeSafeStorage({ available: false }));
        jest.spyOn(console, 'warn').mockImplementation(() => {});
        storage.setCredentials({ apiKey: '' });
        storage.setCredentials({ apiKey: 'session-gemini-secret' });

        expect(fs.readFileSync(credentialsPath, 'utf8')).toBe(before);
        expect(storage.getCredentials().apiKey).toBe('session-gemini-secret');
    });

    test('clearAllData drops session-only credentials', () => {
        storage._setSafeStorageForTest(makeSafeStorage({ available: false }));
        jest.spyOn(console, 'warn').mockImplementation(() => {});
        jest.spyOn(console, 'log').mockImplementation(() => {});
        storage.initializeStorage();
        storage.setCredentials({ apiKey: 'session-gemini-secret' });

        storage.clearAllData();

        expect(storage.getCredentials().apiKey).toBe('');
    });
});
