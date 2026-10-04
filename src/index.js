if (require('electron-squirrel-startup')) {
    process.exit(0);
}

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow, shell, ipcMain, safeStorage } = require('electron');
const { createWindow, updateGlobalShortcuts } = require('./utils/window');
const {
    setupGeminiIpcHandlers,
    stopMacOSAudioCapture,
    stopAudioCapture,
    sendToRenderer,
    runDevScenario,
    DEV_SCENARIOS,
    initializeNewSession,
} = require('./utils/gemini');
const storage = require('./storage');
const { buildSupportSnapshot } = require('./utils/supportExport');

const geminiSessionRef = { current: null };
let mainWindow = null;

function isSafeStorageAvailable() {
    try {
        return !!(safeStorage && safeStorage.isEncryptionAvailable && safeStorage.isEncryptionAvailable());
    } catch {
        return false;
    }
}

// Single-instance lock: 2回目以降の起動 (Ctrl+Alt+C ホットキー再押下等) で
// 新しいElectronを立ち上げず、既存ウィンドウを呼び出す
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
    process.exit(0);
} else {
    app.on('second-instance', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            if (!mainWindow.isVisible()) mainWindow.showInactive();
            mainWindow.focus();
        }
    });
}

function createMainWindow() {
    mainWindow = createWindow(sendToRenderer, geminiSessionRef);
    return mainWindow;
}

app.whenReady().then(async () => {
    // Initialize storage (checks version, resets if needed)
    storage.initializeStorage();

    // Trigger screen recording permission prompt on macOS if not already granted
    if (process.platform === 'darwin') {
        const { desktopCapturer } = require('electron');
        desktopCapturer.getSources({ types: ['screen'] }).catch(() => {});
    }

    createMainWindow();
    setupGeminiIpcHandlers(geminiSessionRef);
    setupStorageIpcHandlers();
    setupGeneralIpcHandlers();
    setupKeyVerifyIpcHandlers();

    // Auto-run dev scenarios when DEV_RUN_SCENARIOS is set.
    // Examples:
    //   DEV_RUN_SCENARIOS=all npm start
    //   DEV_RUN_SCENARIOS=opponent_question_self_yes,self_short_no_context npm start
    // Each scenario is awaited (runDevScenario waits for AI response completion)
    // so mutex/sequencing behavior is exercised honestly.
    if (process.env.DEV_RUN_SCENARIOS) {
        const requested = process.env.DEV_RUN_SCENARIOS.trim();
        const names =
            requested === 'all'
                ? Object.keys(DEV_SCENARIOS)
                : requested
                      .split(',')
                      .map(s => s.trim())
                      .filter(Boolean);
        setTimeout(async () => {
            console.log(`\n##### [dev] auto-running ${names.length} scenario(s) #####`);

            // Phase 1g-3.7 smoke: confirm src/utils/audioCapture loads and
            // getStatus() returns a structured shape (no spawn, no side
            // effects). Harness wrapper scripts can grep for
            // `[dev] audio-capture-smoke` to verify the new IPC backend
            // wires up alongside the existing scenario regression.
            try {
                const audioCaptureMod = require('./utils/audioCapture');
                const s = audioCaptureMod.getStatus();
                const backend = s.backend == null ? 'unset-until-start' : s.backend;
                console.log(`[dev] audio-capture-smoke OK: running=${s.running} backend=${backend} renderer=${s.rendererSystemCapture}`);
            } catch (err) {
                console.error('[dev] audio-capture-smoke FAILED:', err && err.message);
            }

            // Seed a session so saveConversationTurn etc. don't reinitialize mid-run.
            initializeNewSession('discovery', '');
            const summaries = [];
            for (const name of names) {
                const summary = await runDevScenario(name);
                summaries.push(summary);
            }
            const rateLimited = summaries.filter(s => s && s.aiErrorKind === 'rate_limited').length;
            const passed = summaries.filter(s => s && s.assertions && s.assertions.allPass).length;
            const failed = summaries.length - passed;
            console.log(`\n##### [dev] all scenarios dispatched — pass=${passed} fail=${failed} rate_limited=${rateLimited} #####\n`);
            for (const s of summaries) {
                if (!s || !s.assertions) continue;
                const tag =
                    s.aiErrorKind === 'rate_limited' ? 'PASS (rate_limited — response checks skipped)' : s.assertions.allPass ? 'PASS' : 'FAIL';
                console.log(`[dev summary] ${tag} ${s.scenario}`);
                if (!s.assertions.allPass && s.aiErrorKind !== 'rate_limited') {
                    for (const c of s.assertions.checks.filter(c => !c.pass)) {
                        console.log(`  - ${c.name}: expected=${JSON.stringify(c.expected)} actual=${JSON.stringify(c.actual)}`);
                    }
                }
            }

            // Persist a machine-readable run summary so wrapper scripts can
            // reliably read pass/fail even when npm/electron-forge swallow the
            // child exit code. Always write, regardless of DEV_EXIT_AFTER_SCENARIOS.
            try {
                const fs = require('fs');
                const path = require('path');
                const os = require('os');
                const dir = path.join(os.homedir(), 'cheating-daddy-dev-runs');
                if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                const lastRunPath = path.join(dir, 'last-run.json');
                fs.writeFileSync(
                    lastRunPath,
                    JSON.stringify(
                        {
                            timestamp: Date.now(),
                            requested: names,
                            passed,
                            failed,
                            rateLimited,
                            exitCode: failed === 0 ? 0 : 1,
                            summaries: summaries.map(s =>
                                s
                                    ? {
                                          scenario: s.scenario,
                                          allPass: s.assertions ? s.assertions.allPass : null,
                                          aiErrorKind: s.aiErrorKind,
                                          checks: s.assertions ? s.assertions.checks : null,
                                      }
                                    : null
                            ),
                        },
                        null,
                        2
                    )
                );
                console.log(`[dev] last-run summary: ${lastRunPath}`);
            } catch (e) {
                console.error('[dev] last-run write failed:', e.message);
            }

            // CI / scripted mode: exit cleanly with 0 (all pass) or 1 (any fail)
            // when DEV_EXIT_AFTER_SCENARIOS=1, so harness runs are unambiguous.
            if (process.env.DEV_EXIT_AFTER_SCENARIOS === '1') {
                const exitCode = failed === 0 ? 0 : 1;
                console.log(`[dev] DEV_EXIT_AFTER_SCENARIOS set → exit ${exitCode}`);
                // Quit Electron then force-exit to override window-all-closed handlers.
                app.quit();
                setTimeout(() => process.exit(exitCode), 500);
            }
        }, 2500);
    }
});

app.on('window-all-closed', () => {
    stopMacOSAudioCapture();
    stopAudioCapture();
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('before-quit', () => {
    stopMacOSAudioCapture();
    stopAudioCapture();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
    }
});

function setupStorageIpcHandlers() {
    // ============ CONFIG ============
    ipcMain.handle('storage:get-config', async () => {
        try {
            return { success: true, data: storage.getConfig() };
        } catch (error) {
            console.error('Error getting config:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('storage:set-config', async (event, config) => {
        try {
            storage.setConfig(config);
            return { success: true };
        } catch (error) {
            console.error('Error setting config:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('storage:update-config', async (event, key, value) => {
        try {
            storage.updateConfig(key, value);
            return { success: true };
        } catch (error) {
            console.error('Error updating config:', error);
            return { success: false, error: error.message };
        }
    });

    // ============ CREDENTIALS ============
    ipcMain.handle('storage:get-credentials', async () => {
        try {
            return { success: true, data: storage.getCredentials() };
        } catch (error) {
            console.error('Error getting credentials:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('storage:get-credential-storage-status', async () => {
        try {
            return { success: true, data: storage.getCredentialStorageStatus() };
        } catch (error) {
            console.error('Error getting credential storage status:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('storage:set-credentials', async (event, credentials) => {
        try {
            storage.setCredentials(credentials);
            return { success: true };
        } catch (error) {
            console.error('Error setting credentials:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('storage:get-api-key', async () => {
        try {
            return { success: true, data: storage.getApiKey() };
        } catch (error) {
            console.error('Error getting API key:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('storage:set-api-key', async (event, apiKey) => {
        try {
            storage.setApiKey(apiKey);
            return { success: true };
        } catch (error) {
            console.error('Error setting API key:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('storage:get-groq-api-key', async () => {
        try {
            return { success: true, data: storage.getGroqApiKey() };
        } catch (error) {
            console.error('Error getting Groq API key:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('storage:set-groq-api-key', async (event, groqApiKey) => {
        try {
            storage.setGroqApiKey(groqApiKey);
            return { success: true };
        } catch (error) {
            console.error('Error setting Groq API key:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('storage:set-deepgram-api-key', async (event, deepgramApiKey) => {
        try {
            storage.setDeepgramApiKey(deepgramApiKey);
            return { success: true };
        } catch (error) {
            console.error('Error setting Deepgram API key:', error);
            return { success: false, error: error.message };
        }
    });

    // ============ PREFERENCES ============
    ipcMain.handle('storage:get-preferences', async () => {
        try {
            return { success: true, data: storage.getPreferences() };
        } catch (error) {
            console.error('Error getting preferences:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('storage:set-preferences', async (event, preferences) => {
        try {
            storage.setPreferences(preferences);
            return { success: true };
        } catch (error) {
            console.error('Error setting preferences:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('storage:update-preference', async (event, key, value) => {
        try {
            storage.updatePreference(key, value);
            return { success: true };
        } catch (error) {
            console.error('Error updating preference:', error);
            return { success: false, error: error.message };
        }
    });

    // ============ KEYBINDS ============
    ipcMain.handle('storage:get-keybinds', async () => {
        try {
            return { success: true, data: storage.getKeybinds() };
        } catch (error) {
            console.error('Error getting keybinds:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('storage:set-keybinds', async (event, keybinds) => {
        try {
            storage.setKeybinds(keybinds);
            return { success: true };
        } catch (error) {
            console.error('Error setting keybinds:', error);
            return { success: false, error: error.message };
        }
    });

    // ============ HISTORY ============
    ipcMain.handle('storage:get-all-sessions', async () => {
        try {
            return { success: true, data: storage.getAllSessions() };
        } catch (error) {
            console.error('Error getting sessions:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('storage:get-session', async (event, sessionId) => {
        try {
            return { success: true, data: storage.getSession(sessionId) };
        } catch (error) {
            console.error('Error getting session:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('storage:save-session', async (event, sessionId, data) => {
        try {
            storage.saveSession(sessionId, data);
            return { success: true };
        } catch (error) {
            console.error('Error saving session:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('storage:delete-session', async (event, sessionId) => {
        try {
            storage.deleteSession(sessionId);
            return { success: true };
        } catch (error) {
            console.error('Error deleting session:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('storage:delete-all-sessions', async () => {
        try {
            storage.deleteAllSessions();
            return { success: true };
        } catch (error) {
            console.error('Error deleting all sessions:', error);
            return { success: false, error: error.message };
        }
    });

    // ============ LIMITS ============
    ipcMain.handle('storage:get-today-limits', async () => {
        try {
            return { success: true, data: storage.getTodayLimits() };
        } catch (error) {
            console.error('Error getting today limits:', error);
            return { success: false, error: error.message };
        }
    });

    // ============ CLEAR ALL ============
    ipcMain.handle('storage:clear-all', async () => {
        try {
            const result = storage.clearAllData();
            return { success: !!(result && result.success), failed: (result && result.failed) || [] };
        } catch (error) {
            console.error('Error clearing all data:', error);
            return { success: false, error: error.message };
        }
    });
}

function setupGeneralIpcHandlers() {
    ipcMain.handle('get-app-version', async () => {
        return app.getVersion();
    });

    ipcMain.handle('support:export-diagnostics', async (event, diagnostics = []) => {
        try {
            const snapshot = buildSupportSnapshot({
                appVersion: app.getVersion(),
                electronVersion: process.versions.electron,
                osInfo: {
                    platform: os.platform(),
                    release: os.release(),
                    arch: os.arch(),
                },
                safeStorageAvailable: isSafeStorageAvailable(),
                credentialStorageSessionOnly: storage.getCredentialStorageStatus().sessionOnly,
                preferences: storage.getPreferences(),
                credentials: storage.getCredentials(),
                sessions: storage.getAllSessions(),
                diagnostics,
            });

            const exportDir = path.join(app.getPath('downloads'), 'WhisperOhKAMI Support');
            fs.mkdirSync(exportDir, { recursive: true });
            const timestamp = snapshot.generatedAt.replace(/[:.]/g, '-');
            const exportPath = path.join(exportDir, `support-diagnostics-${timestamp}.json`);
            fs.writeFileSync(exportPath, JSON.stringify(snapshot, null, 2), 'utf8');
            await shell.openPath(exportDir);
            return { success: true, path: exportPath };
        } catch (error) {
            console.error('Error exporting support diagnostics:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('quit-application', async event => {
        try {
            stopMacOSAudioCapture();
            app.quit();
            return { success: true };
        } catch (error) {
            console.error('Error quitting application:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('open-external', async (event, url) => {
        try {
            await shell.openExternal(url);
            return { success: true };
        } catch (error) {
            console.error('Error opening external URL:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.on('update-keybinds', (event, newKeybinds) => {
        if (mainWindow) {
            // Also save to storage
            storage.setKeybinds(newKeybinds);
            updateGlobalShortcuts(newKeybinds, mainWindow, sendToRenderer, geminiSessionRef);
        }
    });

    // Debug logging from renderer
    ipcMain.on('log-message', (event, msg) => {
        console.log(msg);
    });
}

function setupKeyVerifyIpcHandlers() {
    const { verifyGeminiKey, verifyDeepgramKey } = require('./utils/keyVerify');
    ipcMain.handle('verify:gemini-key', async (event, key) => verifyGeminiKey(key));
    ipcMain.handle('verify:deepgram-key', async (event, key) => verifyDeepgramKey(key));
}
