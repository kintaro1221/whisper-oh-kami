// Phase 0 rebrand (cheating-daddy → WhisperOhKAMI, 2026-05-10).
//
// Scope: cover the two correctness invariants Codex flagged as risky.
//   1. Migration runs BEFORE needsReset() — so an existing user's data
//      survives the rename instead of being wiped by resetConfigDir().
//   2. The legacy dir is preserved (not deleted) so the user can manually
//      restore if migration goes wrong.
//   3. The new dir is never overwritten — once the user is on the new
//      brand, re-running migrate must be a no-op.
//
// We test _migrateBetween() directly with tmpdir paths to avoid os.homedir()
// mocking. config-dir-naming is checked via getConfigDir/getLegacyConfigDir
// asserting the right basename per platform.

const fs = require('fs');
const path = require('path');
const os = require('os');

const storage = require('../../src/storage');

let testRoot;

beforeEach(() => {
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wok-migration-test-'));
});

afterEach(() => {
    if (testRoot && fs.existsSync(testRoot)) {
        fs.rmSync(testRoot, { recursive: true, force: true });
    }
});

function seedLegacy(dir) {
    fs.mkdirSync(path.join(dir, 'history'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ configVersion: 1, onboarded: true, layout: 'normal' }));
    fs.writeFileSync(path.join(dir, 'credentials.json'), JSON.stringify({ apiKey: 'sk-legacy-test', deepgramApiKey: 'dg-legacy' }));
    fs.writeFileSync(path.join(dir, 'preferences.json'), JSON.stringify({ selectedProfile: 'discovery', selectedLanguage: 'ja-JP' }));
    fs.writeFileSync(
        path.join(dir, 'history', '1700000000.json'),
        JSON.stringify({ sessionId: '1700000000', conversationHistory: [{ transcription: 'hello', ai_response: 'hi' }] })
    );
}

describe('storage._migrateBetween — copy semantics', () => {
    test('copies oldDir → newDir when newDir is missing and oldDir exists', () => {
        const oldDir = path.join(testRoot, 'old');
        const newDir = path.join(testRoot, 'new');
        seedLegacy(oldDir);

        const result = storage._migrateBetween(oldDir, newDir);

        expect(result).toBe(true);
        expect(fs.existsSync(newDir)).toBe(true);
        expect(fs.existsSync(path.join(newDir, 'config.json'))).toBe(true);
    });

    test('copies credentials file content verbatim', () => {
        const oldDir = path.join(testRoot, 'old');
        const newDir = path.join(testRoot, 'new');
        seedLegacy(oldDir);

        storage._migrateBetween(oldDir, newDir);

        const creds = JSON.parse(fs.readFileSync(path.join(newDir, 'credentials.json'), 'utf8'));
        expect(creds.apiKey).toBe('sk-legacy-test');
        expect(creds.deepgramApiKey).toBe('dg-legacy');
    });

    test('copies history subdirectory recursively', () => {
        const oldDir = path.join(testRoot, 'old');
        const newDir = path.join(testRoot, 'new');
        seedLegacy(oldDir);

        storage._migrateBetween(oldDir, newDir);

        const sessionPath = path.join(newDir, 'history', '1700000000.json');
        expect(fs.existsSync(sessionPath)).toBe(true);
        const session = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
        expect(session.sessionId).toBe('1700000000');
        expect(session.conversationHistory).toHaveLength(1);
    });

    test('copies preferences file content verbatim', () => {
        const oldDir = path.join(testRoot, 'old');
        const newDir = path.join(testRoot, 'new');
        seedLegacy(oldDir);

        storage._migrateBetween(oldDir, newDir);

        const prefs = JSON.parse(fs.readFileSync(path.join(newDir, 'preferences.json'), 'utf8'));
        expect(prefs.selectedProfile).toBe('discovery');
        expect(prefs.selectedLanguage).toBe('ja-JP');
    });
});

describe('storage._migrateBetween — invariants', () => {
    test('preserves oldDir after successful migration (does not delete)', () => {
        const oldDir = path.join(testRoot, 'old');
        const newDir = path.join(testRoot, 'new');
        seedLegacy(oldDir);

        storage._migrateBetween(oldDir, newDir);

        expect(fs.existsSync(oldDir)).toBe(true);
        expect(fs.existsSync(path.join(oldDir, 'config.json'))).toBe(true);
        expect(fs.existsSync(path.join(oldDir, 'credentials.json'))).toBe(true);
        expect(fs.existsSync(path.join(oldDir, 'history', '1700000000.json'))).toBe(true);
    });

    test('does NOT overwrite newDir when it already exists', () => {
        const oldDir = path.join(testRoot, 'old');
        const newDir = path.join(testRoot, 'new');
        seedLegacy(oldDir);

        // Pre-existing new dir with different credentials — must remain untouched
        fs.mkdirSync(newDir, { recursive: true });
        fs.writeFileSync(path.join(newDir, 'credentials.json'), JSON.stringify({ apiKey: 'sk-already-on-new-brand' }));

        const result = storage._migrateBetween(oldDir, newDir);

        expect(result).toBe(false);
        const creds = JSON.parse(fs.readFileSync(path.join(newDir, 'credentials.json'), 'utf8'));
        expect(creds.apiKey).toBe('sk-already-on-new-brand');
    });

    test('returns false (no-op) when oldDir does not exist (clean install)', () => {
        const oldDir = path.join(testRoot, 'never-existed');
        const newDir = path.join(testRoot, 'new');

        const result = storage._migrateBetween(oldDir, newDir);

        expect(result).toBe(false);
        expect(fs.existsSync(newDir)).toBe(false);
    });

    test('returns false when both dirs are missing', () => {
        const oldDir = path.join(testRoot, 'never-existed-old');
        const newDir = path.join(testRoot, 'never-existed-new');

        expect(storage._migrateBetween(oldDir, newDir)).toBe(false);
    });
});

describe('storage config dir naming', () => {
    test('getConfigDir() ends with whisper-oh-kami-config', () => {
        expect(path.basename(storage.getConfigDir())).toBe('whisper-oh-kami-config');
        expect(storage.CONFIG_DIR_NAME).toBe('whisper-oh-kami-config');
    });

    test('getLegacyConfigDir() ends with cheating-daddy-config', () => {
        expect(path.basename(storage.getLegacyConfigDir())).toBe('cheating-daddy-config');
        expect(storage.LEGACY_CONFIG_DIR_NAME).toBe('cheating-daddy-config');
    });

    test('legacy and current config dirs share the same parent (per-platform AppData / Library / .config)', () => {
        // Both dirs only differ by the trailing config-dir-name segment, so
        // the migration runs against the same OS storage location.
        expect(path.dirname(storage.getConfigDir())).toBe(path.dirname(storage.getLegacyConfigDir()));
    });
});

// ---------------------------------------------------------------------------
// initializeStorage() ordering invariant (regression test for Codex feedback)
//
// _migrateBetween() tests above prove the copy logic in isolation. This block
// proves the *call order* in initializeStorage(): migrate must run BEFORE
// needsReset(). If the order is reversed:
//   1. needsReset() sees no config.json in the new dir, returns true
//   2. resetConfigDir() initializes the new dir with empty defaults
//   3. then migration runs → new dir already exists → copy is skipped
//   4. user's credentials / history / preferences are silently lost
// We seed a VALID legacy config (configVersion=1) so needsReset() would
// naturally return false; only the correct order preserves the data.
//
// os.homedir is mocked so getConfigDir() resolves under a tmp dir; we
// jest.resetModules() before re-requiring storage so the mock is in place
// when the module captures its `os` reference.
// ---------------------------------------------------------------------------

describe('storage.initializeStorage — migration order invariant', () => {
    let tmpHome;
    let freshStorage;
    let legacyDir;
    let newDir;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'wok-init-order-test-'));
        jest.spyOn(os, 'homedir').mockReturnValue(tmpHome);
        jest.resetModules();
        freshStorage = require('../../src/storage');
        legacyDir = freshStorage.getLegacyConfigDir();
        newDir = freshStorage.getConfigDir();
    });

    afterEach(() => {
        jest.restoreAllMocks();
        if (tmpHome && fs.existsSync(tmpHome)) {
            fs.rmSync(tmpHome, { recursive: true, force: true });
        }
    });

    test('preserves seeded credentials/history/preferences when legacy is valid', () => {
        // Seed the legacy dir with a VALID config (configVersion=1). This is
        // the case where migration order matters most — if migration runs
        // AFTER resetConfigDir, the user's data is replaced with empty
        // defaults silently.
        fs.mkdirSync(path.join(legacyDir, 'history'), { recursive: true });
        fs.writeFileSync(path.join(legacyDir, 'config.json'), JSON.stringify({ configVersion: 1, onboarded: true, layout: 'normal' }));
        fs.writeFileSync(
            path.join(legacyDir, 'credentials.json'),
            JSON.stringify({ apiKey: 'sk-from-legacy-must-survive', deepgramApiKey: 'dg-legacy' })
        );
        fs.writeFileSync(path.join(legacyDir, 'preferences.json'), JSON.stringify({ selectedProfile: 'discovery', selectedLanguage: 'ja-JP' }));
        fs.writeFileSync(
            path.join(legacyDir, 'history', '1700000000.json'),
            JSON.stringify({
                sessionId: '1700000000',
                conversationHistory: [{ transcription: 'legacy-q', ai_response: 'legacy-a' }],
            })
        );

        // Drive the actual entry point — not _migrateBetween directly.
        freshStorage.initializeStorage();

        // Credentials survived the rename. If order is reversed, this would
        // be the empty default ('') from DEFAULT_CREDENTIALS in resetConfigDir.
        const creds = JSON.parse(fs.readFileSync(path.join(newDir, 'credentials.json'), 'utf8'));
        expect(creds.apiKey).toBe('sk-from-legacy-must-survive');
        expect(creds.deepgramApiKey).toBe('dg-legacy');

        // Preferences kept the user's discovery / ja-JP choices, not defaults.
        const prefs = JSON.parse(fs.readFileSync(path.join(newDir, 'preferences.json'), 'utf8'));
        expect(prefs.selectedProfile).toBe('discovery');
        expect(prefs.selectedLanguage).toBe('ja-JP');

        // History session is reachable from the new dir.
        const sessionPath = path.join(newDir, 'history', '1700000000.json');
        expect(fs.existsSync(sessionPath)).toBe(true);
        const session = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
        expect(session.conversationHistory[0].transcription).toBe('legacy-q');

        // Legacy dir is preserved (safety net for manual restore).
        expect(fs.existsSync(legacyDir)).toBe(true);
        expect(fs.existsSync(path.join(legacyDir, 'credentials.json'))).toBe(true);
    });

    test('falls through to fresh init on clean install (no legacy, no new)', () => {
        freshStorage.initializeStorage();

        // New dir is created with default config (configVersion stamped, not onboarded).
        expect(fs.existsSync(newDir)).toBe(true);
        const config = JSON.parse(fs.readFileSync(path.join(newDir, 'config.json'), 'utf8'));
        expect(config.configVersion).toBe(1);
        expect(config.onboarded).toBe(false);

        // No legacy dir was conjured out of nowhere.
        expect(fs.existsSync(legacyDir)).toBe(false);
    });
});
