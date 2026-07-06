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

    test('safeStorage unavailable falls back to plaintext with a warning and no crash', () => {
        storage._setSafeStorageForTest(makeSafeStorage({ available: false }));
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
        storage.initializeStorage();

        expect(() => storage.setCredentials({ apiKey: 'fallback-gemini-secret' })).not.toThrow();
        const credentialsPath = path.join(storage.getConfigDir(), 'credentials.json');
        const rawText = fs.readFileSync(credentialsPath, 'utf8');
        expect(rawText).toContain('fallback-gemini-secret');
        expect(storage.getCredentials().apiKey).toBe('fallback-gemini-secret');
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[storage] Credential encryption unavailable'), expect.any(String));
    });
});
