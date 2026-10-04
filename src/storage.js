const fs = require('fs');
const path = require('path');
const os = require('os');
const { normalizeContextProfile } = require('./utils/contextPrompt');

const CONFIG_VERSION = 1;

// Default values
const DEFAULT_CONFIG = {
    configVersion: CONFIG_VERSION,
    onboarded: false,
    layout: 'normal',
};

const DEFAULT_CREDENTIALS = {
    apiKey: '',
    groqApiKey: '',
    deepgramApiKey: '',
};

const ENCRYPTED_CREDENTIALS_VERSION = 1;
const ENCRYPTED_CREDENTIALS_MARKER = 'whisper-oh-kami.safeStorage.credentials';
let safeStorageForTest;
let credentialEncryptionWarningEmitted = false;
// Fail-closed fallback: when safeStorage cannot encrypt, credentials entered in
// this process live only here (module memory) and are never written to disk.
// Cleared on process exit, by clearAllData(), and by _setSafeStorageForTest().
let sessionCredentials = null;

const DEFAULT_PREFERENCES = {
    customPrompt: '',
    contextProfile: {},
    providerMode: 'trial',
    selectedProfile: 'sales',
    selectedLanguage: 'ja-JP',
    selectedScreenshotInterval: '5',
    selectedImageQuality: 'medium',
    advancedMode: false,
    audioMode: 'speaker_only',
    fontSize: 'medium',
    backgroundTransparency: 0.92,
    theme: 'light',
    googleSearchEnabled: false,
    ollamaHost: 'http://127.0.0.1:11434',
    ollamaModel: 'gemma3:4b',
    // Xenova/whisper-tiny and Xenova/whisper-small ship bundled with the
    // installer (see scripts/fetch-whisper-models.mjs); small is the default
    // because tiny's Japanese accuracy proved unusable in practice (2026-09
    // decision). onnx-community/kotoba-whisper-v2.2-ONNX is opt-in only
    // (~1GB first-run download) and is never a default.
    whisperModel: 'Xenova/whisper-small',
    // Tracks whether the user has explicitly picked a Whisper model via the
    // Customize UI. When false/absent, migrateWhisperModelDefaultIfNeeded()
    // is allowed to upgrade a stale on-disk 'Xenova/whisper-tiny' value to
    // the new default. Once true, the user's explicit choice (even tiny) is
    // preserved across the migration.
    whisperModelChosen: false,
    micDeviceId: '',
    systemDeviceId: 'auto',
    // STT routing for byok provider mode. Default is the privacy-safe local path.
    //   'local'  — DEFAULT. Deepgram skipped (no audio sent to Deepgram). Gemini
    //              Live still receives audio for multimodal context — see README
    //              for the full privacy story.
    //   'cloud'  — Deepgram nova-3 (opt-in). Needs a Deepgram key entered in BYOK
    //              setup; mic / counterpart audio is sent to Deepgram (US).
    sttMode: 'local',
    // Sidebar user-collapse preference. Independent of the @media (max-width: 820px)
    // auto-collapse — when true, the sidebar is pinned to icon-only mode regardless
    // of window width. When false (default), the auto-collapse behavior applies.
    sidebarUserCollapsed: false,
};

const DEFAULT_KEYBINDS = null; // null means use system defaults

const DEFAULT_LIMITS = {
    data: [], // Array of { date: 'YYYY-MM-DD', flash: { count }, flashLite: { count }, groq: { 'qwen3-32b': { chars, limit }, 'gpt-oss-120b': { chars, limit }, 'gpt-oss-20b': { chars, limit } }, gemini: { 'gemma-3-27b-it': { chars } } }
};

// Per-platform config dir for the **current** product name.
// Phase 0 rebrand (cheating-daddy → WhisperOhKAMI, 2026-05-10): callers
// must always read/write through getConfigDir(). The legacy path is only
// referenced by migrateLegacyConfigIfNeeded() during initializeStorage().
function getConfigDirForName(name) {
    const platform = os.platform();
    if (platform === 'win32') {
        return path.join(os.homedir(), 'AppData', 'Roaming', name);
    } else if (platform === 'darwin') {
        return path.join(os.homedir(), 'Library', 'Application Support', name);
    } else {
        return path.join(os.homedir(), '.config', name);
    }
}

const CONFIG_DIR_NAME = 'whisper-oh-kami-config';
const LEGACY_CONFIG_DIR_NAME = 'cheating-daddy-config';

// Test-only overrides for the two directory paths (see __setConfigDirsForTest).
// null in production: the paths are resolved lazily from os.homedir() so that
// tests which mock os.homedir() before requiring this module keep working.
let configDirOverride = null;
let legacyConfigDirOverride = null;

function getConfigDir() {
    return configDirOverride || getConfigDirForName(CONFIG_DIR_NAME);
}

function getLegacyConfigDir() {
    return legacyConfigDirOverride || getConfigDirForName(LEGACY_CONFIG_DIR_NAME);
}

// TEST-ONLY hook: point the current / legacy config directories at temp dirs.
// Never call this from application code.
function __setConfigDirsForTest({ current = null, legacy = null } = {}) {
    configDirOverride = current;
    legacyConfigDirOverride = legacy;
}

// File paths
function getConfigPath() {
    return path.join(getConfigDir(), 'config.json');
}

function getCredentialsPath() {
    return path.join(getConfigDir(), 'credentials.json');
}

function getPreferencesPath() {
    return path.join(getConfigDir(), 'preferences.json');
}

function getKeybindsPath() {
    return path.join(getConfigDir(), 'keybinds.json');
}

function getLimitsPath() {
    return path.join(getConfigDir(), 'limits.json');
}

function getHistoryDir() {
    return path.join(getConfigDir(), 'history');
}

// Helper to read JSON file safely
function readJsonFile(filePath, defaultValue) {
    try {
        if (fs.existsSync(filePath)) {
            const data = fs.readFileSync(filePath, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.warn(`Error reading ${filePath}:`, error.message);
    }
    return defaultValue;
}

// Helper to write JSON file safely
function writeJsonFile(filePath, data) {
    try {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
        return true;
    } catch (error) {
        console.error(`Error writing ${filePath}:`, error.message);
        return false;
    }
}

function getSafeStorage() {
    if (safeStorageForTest !== undefined) return safeStorageForTest;

    try {
        const electron = require('electron');
        return electron.safeStorage || null;
    } catch {
        return null;
    }
}

function getSafeStorageUnavailableReason(safeStorage = getSafeStorage()) {
    if (!safeStorage) return 'safeStorage API unavailable';
    if (typeof safeStorage.isEncryptionAvailable !== 'function') return 'safeStorage.isEncryptionAvailable unavailable';
    try {
        return safeStorage.isEncryptionAvailable() ? null : 'safeStorage encryption unavailable';
    } catch (error) {
        return error.message || 'safeStorage availability check failed';
    }
}

function warnCredentialEncryptionUnavailable(reason) {
    if (credentialEncryptionWarningEmitted) return;
    credentialEncryptionWarningEmitted = true;
    console.warn('[storage] Credential encryption unavailable; keys are kept in memory for this session only and not written to disk.', reason);
}

function hasCredentialMaterial(credentials) {
    return Object.values(credentials || {}).some(value => typeof value === 'string' && value.trim() !== '');
}

function normalizeCredentials(credentials) {
    return { ...DEFAULT_CREDENTIALS, ...(credentials && typeof credentials === 'object' ? credentials : {}) };
}

function isEncryptedCredentialsPayload(payload) {
    return !!(
        payload &&
        typeof payload === 'object' &&
        payload.__encrypted === true &&
        payload.marker === ENCRYPTED_CREDENTIALS_MARKER &&
        typeof payload.data === 'string'
    );
}

// Returns the on-disk payload, or null when the credentials must not be
// written (encryption unavailable AND there is key material). Only an empty
// credentials object may ever be written unencrypted.
function encryptCredentialsForDisk(credentials) {
    const normalized = normalizeCredentials(credentials);
    const safeStorage = getSafeStorage();
    const unavailableReason = getSafeStorageUnavailableReason(safeStorage);
    if (unavailableReason) {
        if (hasCredentialMaterial(normalized)) {
            warnCredentialEncryptionUnavailable(unavailableReason);
            return null;
        }
        return normalized;
    }

    const encrypted = safeStorage.encryptString(JSON.stringify(normalized));
    return {
        __encrypted: true,
        marker: ENCRYPTED_CREDENTIALS_MARKER,
        version: ENCRYPTED_CREDENTIALS_VERSION,
        data: Buffer.from(encrypted).toString('base64'),
    };
}

function decryptCredentialsPayload(payload) {
    const safeStorage = getSafeStorage();
    const unavailableReason = getSafeStorageUnavailableReason(safeStorage);
    if (unavailableReason) {
        warnCredentialEncryptionUnavailable(unavailableReason);
        return DEFAULT_CREDENTIALS;
    }

    try {
        const decrypted = safeStorage.decryptString(Buffer.from(payload.data, 'base64'));
        return normalizeCredentials(JSON.parse(decrypted));
    } catch (error) {
        console.warn('[storage] Failed to decrypt credentials; returning empty credentials.', error.message);
        return DEFAULT_CREDENTIALS;
    }
}

function writeCredentialsFile(credentials) {
    const payload = encryptCredentialsForDisk(credentials);
    if (payload === null) return false; // fail closed: never write keys in plaintext
    return writeJsonFile(getCredentialsPath(), payload);
}

// Lets the renderer tell the user when keys are session-only on this PC.
function getCredentialStorageStatus() {
    const reason = getSafeStorageUnavailableReason();
    return { encrypted: reason === null, reason, sessionOnly: reason !== null };
}

function migratePlaintextCredentialsIfNeeded(rawPayload, credentials) {
    if (isEncryptedCredentialsPayload(rawPayload)) return false;
    if (!fs.existsSync(getCredentialsPath())) return false;
    const safeStorage = getSafeStorage();
    const unavailableReason = getSafeStorageUnavailableReason(safeStorage);
    if (unavailableReason) {
        if (hasCredentialMaterial(credentials)) {
            warnCredentialEncryptionUnavailable(unavailableReason);
        }
        return false;
    }
    return writeCredentialsFile(credentials);
}

// Check if we need to reset (no configVersion or wrong version)
function needsReset() {
    const configPath = getConfigPath();
    if (!fs.existsSync(configPath)) {
        return true;
    }

    try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        return !config.configVersion || config.configVersion !== CONFIG_VERSION;
    } catch {
        return true;
    }
}

// Wipe and reinitialize the config directory
function resetConfigDir() {
    const configDir = getConfigDir();

    console.log('Resetting config directory...');

    // Remove existing directory if it exists
    if (fs.existsSync(configDir)) {
        fs.rmSync(configDir, { recursive: true, force: true });
    }

    // Create fresh directory structure
    fs.mkdirSync(configDir, { recursive: true });
    fs.mkdirSync(getHistoryDir(), { recursive: true });

    // Initialize with defaults
    writeJsonFile(getConfigPath(), DEFAULT_CONFIG);
    writeCredentialsFile(DEFAULT_CREDENTIALS);
    writeJsonFile(getPreferencesPath(), DEFAULT_PREFERENCES);

    console.log('Config directory initialized with defaults');
}

// Internal helper: copy oldDir → newDir if newDir missing and oldDir present.
// Exposed via module.exports for unit testing without os.homedir mocking.
//   - newDir exists  → no-op (return false), never overwrites
//   - oldDir missing → no-op (return false), clean install
//   - both ok        → recursive copy via fs.cpSync (Node 16.7+; Electron 42 ships Node 24)
//   - oldDir is preserved (NOT deleted) so the user can restore manually if needed
function _migrateBetween(oldDir, newDir) {
    if (fs.existsSync(newDir)) return false;
    if (!fs.existsSync(oldDir)) return false;
    try {
        fs.cpSync(oldDir, newDir, { recursive: true });
        console.log(`[storage] Migrated legacy config: ${oldDir} → ${newDir}`);
        console.log('[storage] Legacy directory preserved (not deleted).');
        return true;
    } catch (error) {
        console.error('[storage] Migration failed:', error.message);
        return false;
    }
}

// Phase 0 rebrand migration: cheating-daddy-config → whisper-oh-kami-config.
// Must be called BEFORE needsReset() — otherwise needsReset() sees the missing
// new dir and triggers a fresh resetConfigDir(), losing the user's data.
function migrateLegacyConfigIfNeeded() {
    return _migrateBetween(getLegacyConfigDir(), getConfigDir());
}

// Whisper default-model migration (2026-09): Xenova/whisper-tiny's Japanese
// accuracy proved unusable, so the default changed to Xenova/whisper-small.
// Existing users' preferences.json has 'Xenova/whisper-tiny' written
// explicitly by an earlier initializeStorage()/resetConfigDir() run — that
// stale value must be upgraded to small UNLESS the user explicitly picked
// tiny via the Customize UI (whisperModelChosen === true), in which case
// their choice is preserved. A fresh install / a reset config never has this
// problem: DEFAULT_PREFERENCES.whisperModel is already 'Xenova/whisper-small'.
function migrateWhisperModelDefaultIfNeeded() {
    const prefsPath = getPreferencesPath();
    if (!fs.existsSync(prefsPath)) return false;

    const saved = readJsonFile(prefsPath, null);
    if (!saved || typeof saved !== 'object') return false;

    if (saved.whisperModel === 'Xenova/whisper-tiny' && !saved.whisperModelChosen) {
        return writeJsonFile(prefsPath, { ...saved, whisperModel: 'Xenova/whisper-small' });
    }
    return false;
}

// Initialize storage - call this on app startup
function initializeStorage() {
    // 1. Migrate legacy cheating-daddy-config → whisper-oh-kami-config
    //    (no-op when the new dir exists, or when neither dir exists)
    migrateLegacyConfigIfNeeded();

    // 2. Then run the normal reset/init flow against the new dir
    if (needsReset()) {
        resetConfigDir();
    } else {
        // Ensure history directory exists
        const historyDir = getHistoryDir();
        if (!fs.existsSync(historyDir)) {
            fs.mkdirSync(historyDir, { recursive: true });
        }
        // 3. Upgrade a stale tiny default left over from before this change.
        migrateWhisperModelDefaultIfNeeded();
    }

    getCredentials();
}

// ============ CONFIG ============

function getConfig() {
    return readJsonFile(getConfigPath(), DEFAULT_CONFIG);
}

function setConfig(config) {
    const current = getConfig();
    const updated = { ...current, ...config, configVersion: CONFIG_VERSION };
    return writeJsonFile(getConfigPath(), updated);
}

function updateConfig(key, value) {
    const config = getConfig();
    config[key] = value;
    return writeJsonFile(getConfigPath(), config);
}

// ============ CREDENTIALS ============

function getCredentials() {
    if (sessionCredentials) return { ...sessionCredentials };
    return readCredentialsFromDisk();
}

function readCredentialsFromDisk() {
    const rawPayload = readJsonFile(getCredentialsPath(), DEFAULT_CREDENTIALS);
    if (isEncryptedCredentialsPayload(rawPayload)) {
        return decryptCredentialsPayload(rawPayload);
    }

    const credentials = normalizeCredentials(rawPayload);
    migratePlaintextCredentialsIfNeeded(rawPayload, credentials);
    return credentials;
}

function setCredentials(credentials) {
    const current = getCredentials();
    const updated = { ...current, ...credentials };
    const unavailableReason = getSafeStorageUnavailableReason();
    if (unavailableReason) {
        // Fail closed: keep the keys for this session only. An existing legacy
        // plaintext file is left untouched (still readable on the next launch),
        // except when the user has cleared every key: the empty defaults hold
        // no key material, so writing them removes the old plaintext keys from
        // disk as the user expects. An encrypted file is never touched here —
        // it may just be undecryptable right now.
        sessionCredentials = updated;
        if (hasCredentialMaterial(updated)) {
            warnCredentialEncryptionUnavailable(unavailableReason);
        } else {
            const rawPayload = readJsonFile(getCredentialsPath(), null);
            if (rawPayload && !isEncryptedCredentialsPayload(rawPayload) && hasCredentialMaterial(rawPayload)) {
                writeCredentialsFile(DEFAULT_CREDENTIALS);
            }
        }
        return true;
    }
    sessionCredentials = null;
    return writeCredentialsFile(updated);
}

function getApiKey() {
    return getCredentials().apiKey || '';
}

function setApiKey(apiKey) {
    return setCredentials({ apiKey });
}

function getGroqApiKey() {
    return getCredentials().groqApiKey || '';
}

function setGroqApiKey(groqApiKey) {
    return setCredentials({ groqApiKey });
}

function getDeepgramApiKey() {
    return process.env.DEEPGRAM_API_KEY || getCredentials().deepgramApiKey || '';
}

function setDeepgramApiKey(deepgramApiKey) {
    return setCredentials({ deepgramApiKey });
}

// STT mode helpers — single read path for the gemini.js init guards.
// Unknown / legacy values (e.g. the never-shipped 'hybrid' placeholder) sanitize
// to the privacy-safe 'local' default, never 'cloud'.
const VALID_STT_MODES = ['cloud', 'local'];

function getSttMode() {
    const raw = getPreferences().sttMode;
    return VALID_STT_MODES.includes(raw) ? raw : 'local';
}

function setSttMode(mode) {
    const next = VALID_STT_MODES.includes(mode) ? mode : 'local';
    return updatePreference('sttMode', next);
}

// ============ PREFERENCES ============

function getPreferences() {
    const saved = readJsonFile(getPreferencesPath(), {});
    return { ...DEFAULT_PREFERENCES, ...saved, contextProfile: normalizeContextProfile(saved.contextProfile || {}) };
}

function setPreferences(preferences) {
    const current = getPreferences();
    const updated = {
        ...current,
        ...preferences,
        contextProfile: normalizeContextProfile(preferences.contextProfile ?? current.contextProfile),
    };
    return writeJsonFile(getPreferencesPath(), updated);
}

function updatePreference(key, value) {
    const preferences = getPreferences();
    preferences[key] = key === 'contextProfile' ? normalizeContextProfile(value) : value;
    return writeJsonFile(getPreferencesPath(), preferences);
}

// ============ KEYBINDS ============

function getKeybinds() {
    return readJsonFile(getKeybindsPath(), DEFAULT_KEYBINDS);
}

function setKeybinds(keybinds) {
    return writeJsonFile(getKeybindsPath(), keybinds);
}

// ============ LIMITS (Rate Limiting) ============

function getLimits() {
    return readJsonFile(getLimitsPath(), DEFAULT_LIMITS);
}

function setLimits(limits) {
    return writeJsonFile(getLimitsPath(), limits);
}

function getTodayDateString() {
    const now = new Date();
    return now.toISOString().split('T')[0]; // YYYY-MM-DD
}

function getTodayLimits() {
    const limits = getLimits();
    const today = getTodayDateString();

    // Find today's entry
    const todayEntry = limits.data.find(entry => entry.date === today);

    if (todayEntry) {
        // ensure new fields exist
        if (!todayEntry.groq) {
            todayEntry.groq = {
                'qwen3-32b': { chars: 0, limit: 1500000 },
                'gpt-oss-120b': { chars: 0, limit: 600000 },
                'gpt-oss-20b': { chars: 0, limit: 600000 },
                'kimi-k2-instruct': { chars: 0, limit: 600000 },
            };
        }
        if (!todayEntry.gemini) {
            todayEntry.gemini = {
                'gemma-3-27b-it': { chars: 0 },
            };
        }
        setLimits(limits);
        return todayEntry;
    }

    // No entry for today - clean old entries and create new one
    limits.data = limits.data.filter(entry => entry.date === today);
    const newEntry = {
        date: today,
        flash: { count: 0 },
        flashLite: { count: 0 },
        groq: {
            'qwen3-32b': { chars: 0, limit: 1500000 },
            'gpt-oss-120b': { chars: 0, limit: 600000 },
            'gpt-oss-20b': { chars: 0, limit: 600000 },
            'kimi-k2-instruct': { chars: 0, limit: 600000 },
        },
        gemini: {
            'gemma-3-27b-it': { chars: 0 },
        },
    };
    limits.data.push(newEntry);
    setLimits(limits);

    return newEntry;
}

function incrementLimitCount(model) {
    const limits = getLimits();
    const today = getTodayDateString();

    // Find or create today's entry
    let todayEntry = limits.data.find(entry => entry.date === today);

    if (!todayEntry) {
        // Clean old entries and create new one
        limits.data = [];
        todayEntry = {
            date: today,
            flash: { count: 0 },
            flashLite: { count: 0 },
        };
        limits.data.push(todayEntry);
    } else {
        // Clean old entries, keep only today
        limits.data = limits.data.filter(entry => entry.date === today);
    }

    // Increment the appropriate model count
    if (model === 'gemini-2.5-flash') {
        todayEntry.flash.count++;
    } else if (model === 'gemini-2.5-flash-lite') {
        todayEntry.flashLite.count++;
    }

    setLimits(limits);
    return todayEntry;
}

function incrementCharUsage(provider, model, charCount) {
    getTodayLimits();

    const limits = getLimits();
    const today = getTodayDateString();
    const todayEntry = limits.data.find(entry => entry.date === today);

    if (todayEntry[provider] && todayEntry[provider][model]) {
        todayEntry[provider][model].chars += charCount;
        setLimits(limits);
    }

    return todayEntry;
}

function getAvailableModel() {
    const todayLimits = getTodayLimits();

    // RPD limits: flash = 20, flash-lite = 20
    // After both exhausted, fall back to flash (for paid API users)
    if (todayLimits.flash.count < 20) {
        return 'gemini-2.5-flash';
    } else if (todayLimits.flashLite.count < 20) {
        return 'gemini-2.5-flash-lite';
    }

    return 'gemini-2.5-flash'; // Default to flash for paid API users
}

function getModelForToday() {
    const todayEntry = getTodayLimits();
    const groq = todayEntry.groq;

    if (groq['qwen3-32b'].chars < groq['qwen3-32b'].limit) {
        return 'qwen/qwen3-32b';
    }
    if (groq['gpt-oss-120b'].chars < groq['gpt-oss-120b'].limit) {
        return 'openai/gpt-oss-120b';
    }
    if (groq['gpt-oss-20b'].chars < groq['gpt-oss-20b'].limit) {
        return 'openai/gpt-oss-20b';
    }
    if (groq['kimi-k2-instruct'].chars < groq['kimi-k2-instruct'].limit) {
        return 'moonshotai/kimi-k2-instruct';
    }

    // All limits exhausted
    return null;
}

// ============ HISTORY ============

function getSessionPath(sessionId) {
    return path.join(getHistoryDir(), `${sessionId}.json`);
}

function saveSession(sessionId, data) {
    const sessionPath = getSessionPath(sessionId);

    // Load existing session to preserve metadata
    const existingSession = readJsonFile(sessionPath, null);

    const sessionData = {
        sessionId,
        createdAt: existingSession?.createdAt || parseInt(sessionId),
        lastUpdated: Date.now(),
        // Profile context - set once when session starts
        profile: data.profile || existingSession?.profile || null,
        customPrompt: data.customPrompt !== undefined ? data.customPrompt || null : existingSession?.customPrompt || null,
        contextProfile:
            data.contextProfile !== undefined
                ? normalizeContextProfile(data.contextProfile)
                : normalizeContextProfile(existingSession?.contextProfile || {}),
        // Conversation data
        conversationHistory: data.conversationHistory || existingSession?.conversationHistory || [],
        screenAnalysisHistory: data.screenAnalysisHistory || existingSession?.screenAnalysisHistory || [],
        feedbackEvents: Array.isArray(data.feedbackEvents) ? data.feedbackEvents : existingSession?.feedbackEvents || [],
    };
    return writeJsonFile(sessionPath, sessionData);
}

function getSession(sessionId) {
    return readJsonFile(getSessionPath(sessionId), null);
}

function getAllSessions() {
    const historyDir = getHistoryDir();

    try {
        if (!fs.existsSync(historyDir)) {
            return [];
        }

        const files = fs
            .readdirSync(historyDir)
            .filter(f => f.endsWith('.json'))
            .sort((a, b) => {
                // Sort by timestamp descending (newest first)
                const tsA = parseInt(a.replace('.json', ''));
                const tsB = parseInt(b.replace('.json', ''));
                return tsB - tsA;
            });

        return files
            .map(file => {
                const sessionId = file.replace('.json', '');
                const data = readJsonFile(path.join(historyDir, file), null);
                if (data) {
                    return {
                        sessionId,
                        createdAt: data.createdAt,
                        lastUpdated: data.lastUpdated,
                        messageCount: data.conversationHistory?.length || 0,
                        screenAnalysisCount: data.screenAnalysisHistory?.length || 0,
                        feedbackCount: data.feedbackEvents?.length || 0,
                        profile: data.profile || null,
                        customPrompt: data.customPrompt || null,
                    };
                }
                return null;
            })
            .filter(Boolean);
    } catch (error) {
        console.error('Error reading sessions:', error.message);
        return [];
    }
}

function deleteSession(sessionId) {
    const sessionPath = getSessionPath(sessionId);
    try {
        if (fs.existsSync(sessionPath)) {
            fs.unlinkSync(sessionPath);
            return true;
        }
    } catch (error) {
        console.error('Error deleting session:', error.message);
    }
    return false;
}

function deleteAllSessions() {
    const historyDir = getHistoryDir();
    try {
        if (fs.existsSync(historyDir)) {
            const files = fs.readdirSync(historyDir).filter(f => f.endsWith('.json'));
            files.forEach(file => {
                fs.unlinkSync(path.join(historyDir, file));
            });
        }
        return true;
    } catch (error) {
        console.error('Error deleting all sessions:', error.message);
        return false;
    }
}

// ============ CLEAR ALL DATA ============

// 「すべてのデータを削除」: removes the whole config dir (history, API keys,
// settings) AND the legacy config dir that the rebrand migration preserved —
// otherwise the next launch would migrate the old data straight back in.
// The current dir is not re-created here; initializeStorage() re-initializes
// defaults on the next launch (the renderer quits the app right after this).
// Not covered: the Whisper model cache and files the user exported for support.
// Removes the current and the legacy config directories independently: a
// failure on one (e.g. a file locked by another process) must not leave the
// other — which can hold old API keys — in place. Returns the paths that
// could not be removed so the UI can say so instead of claiming success.
function clearAllData() {
    console.log('[storage] Clearing all local data');
    sessionCredentials = null;
    const failed = [];
    for (const dir of [getConfigDir(), getLegacyConfigDir()]) {
        try {
            fs.rmSync(dir, { recursive: true, force: true });
        } catch (error) {
            console.error('[storage] Could not remove a data directory:', error.code || error.message);
            failed.push(dir);
        }
    }
    return { success: failed.length === 0, failed };
}

function _setSafeStorageForTest(safeStorage) {
    safeStorageForTest = safeStorage;
    credentialEncryptionWarningEmitted = false;
    sessionCredentials = null;
}

module.exports = {
    // Initialization
    initializeStorage,
    getConfigDir,
    getLegacyConfigDir,
    migrateLegacyConfigIfNeeded,
    migrateWhisperModelDefaultIfNeeded,
    _migrateBetween,
    _setSafeStorageForTest,
    __setConfigDirsForTest,
    CONFIG_DIR_NAME,
    LEGACY_CONFIG_DIR_NAME,

    // Config
    getConfig,
    setConfig,
    updateConfig,

    // Credentials
    getCredentials,
    setCredentials,
    getCredentialStorageStatus,
    getApiKey,
    setApiKey,
    getGroqApiKey,
    setGroqApiKey,
    getDeepgramApiKey,
    setDeepgramApiKey,
    getSttMode,
    setSttMode,
    VALID_STT_MODES,

    // Preferences
    getPreferences,
    setPreferences,
    updatePreference,

    // Keybinds
    getKeybinds,
    setKeybinds,

    // Limits (Rate Limiting)
    getLimits,
    setLimits,
    getTodayLimits,
    incrementLimitCount,
    getAvailableModel,
    incrementCharUsage,
    getModelForToday,

    // History
    saveSession,
    getSession,
    getAllSessions,
    deleteSession,
    deleteAllSessions,

    // Clear all
    clearAllData,
};
