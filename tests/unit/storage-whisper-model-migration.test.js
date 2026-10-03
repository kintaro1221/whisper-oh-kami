'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// Whisper default-model migration (2026-09): DEFAULT_PREFERENCES.whisperModel
// changed from 'Xenova/whisper-tiny' to 'Xenova/whisper-small' because tiny's
// Japanese accuracy proved unusable. Existing users have 'Xenova/whisper-tiny'
// written explicitly to preferences.json by an earlier install — that value
// must be upgraded UNLESS the user explicitly chose it via the Customize UI
// (tracked by whisperModelChosen).
//
// os.homedir is mocked so getConfigDir() resolves under a tmp dir; each test
// resets modules so the mock is captured fresh.
describe('storage whisper-model default migration', () => {
    let tmpHome;
    let storage;
    let prefsPath;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'wok-whisper-migration-test-'));
        jest.spyOn(os, 'homedir').mockReturnValue(tmpHome);
        jest.resetModules();
        storage = require('../../src/storage');
        prefsPath = path.join(storage.getConfigDir(), 'preferences.json');
    });

    afterEach(() => {
        jest.restoreAllMocks();
        if (tmpHome && fs.existsSync(tmpHome)) {
            fs.rmSync(tmpHome, { recursive: true, force: true });
        }
    });

    function seedPrefs(data) {
        fs.mkdirSync(path.dirname(prefsPath), { recursive: true });
        fs.writeFileSync(prefsPath, JSON.stringify(data));
    }

    test('DEFAULT_PREFERENCES.whisperModel is Xenova/whisper-small', () => {
        const prefs = storage.getPreferences();
        expect(prefs.whisperModel).toBe('Xenova/whisper-small');
        expect(prefs.whisperModelChosen).toBe(false);
    });

    test('case 1: tiny saved, not explicitly chosen -> migrated to small', () => {
        seedPrefs({ whisperModel: 'Xenova/whisper-tiny' });
        const changed = storage.migrateWhisperModelDefaultIfNeeded();
        expect(changed).toBe(true);
        const onDisk = JSON.parse(fs.readFileSync(prefsPath, 'utf8'));
        expect(onDisk.whisperModel).toBe('Xenova/whisper-small');
    });

    test('case 2: tiny saved AND explicitly chosen -> preserved', () => {
        seedPrefs({ whisperModel: 'Xenova/whisper-tiny', whisperModelChosen: true });
        const changed = storage.migrateWhisperModelDefaultIfNeeded();
        expect(changed).toBe(false);
        const onDisk = JSON.parse(fs.readFileSync(prefsPath, 'utf8'));
        expect(onDisk.whisperModel).toBe('Xenova/whisper-tiny');
    });

    test('case 3: small already saved -> no change', () => {
        seedPrefs({ whisperModel: 'Xenova/whisper-small', whisperModelChosen: true });
        const changed = storage.migrateWhisperModelDefaultIfNeeded();
        expect(changed).toBe(false);
        const onDisk = JSON.parse(fs.readFileSync(prefsPath, 'utf8'));
        expect(onDisk.whisperModel).toBe('Xenova/whisper-small');
    });

    test('no preferences.json on disk -> no-op, returns false', () => {
        expect(fs.existsSync(prefsPath)).toBe(false);
        const changed = storage.migrateWhisperModelDefaultIfNeeded();
        expect(changed).toBe(false);
    });

    test('initializeStorage() runs the migration for an existing, valid config dir', () => {
        fs.mkdirSync(path.join(storage.getConfigDir(), 'history'), { recursive: true });
        fs.writeFileSync(path.join(storage.getConfigDir(), 'config.json'), JSON.stringify({ configVersion: 1, onboarded: true, layout: 'normal' }));
        seedPrefs({ whisperModel: 'Xenova/whisper-tiny', selectedProfile: 'discovery' });

        storage.initializeStorage();

        const onDisk = JSON.parse(fs.readFileSync(prefsPath, 'utf8'));
        expect(onDisk.whisperModel).toBe('Xenova/whisper-small');
        // Unrelated preferences are untouched.
        expect(onDisk.selectedProfile).toBe('discovery');
    });
});
