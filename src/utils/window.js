const { BrowserWindow, globalShortcut, ipcMain, screen } = require('electron');
const path = require('node:path');
const storage = require('../storage');
const { detectDuplicateKeybinds, formatShortcutRegistrationResult, getDefaultKeybinds: getPolicyDefaultKeybinds } = require('./shortcutPolicy');

let mouseEventsIgnored = false;

const DEFAULT_MAIN_WINDOW_SIZE = { width: 1100, height: 800 };
const MIN_WINDOW_SIZE = { width: 700, height: 320 };

function createWindow(sendToRenderer, geminiSessionRef) {
    let windowWidth = DEFAULT_MAIN_WINDOW_SIZE.width;
    let windowHeight = DEFAULT_MAIN_WINDOW_SIZE.height;

    const mainWindow = new BrowserWindow({
        width: windowWidth,
        height: windowHeight,
        minWidth: MIN_WINDOW_SIZE.width,
        minHeight: MIN_WINDOW_SIZE.height,
        resizable: true,
        frame: false,
        transparent: true,
        hasShadow: false,
        alwaysOnTop: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false, // TODO: change to true
            backgroundThrottling: false,
            enableBlinkFeatures: 'GetDisplayMedia',
            webSecurity: true,
            allowRunningInsecureContent: false,
        },
        backgroundColor: '#00000000',
    });

    const { session, desktopCapturer } = require('electron');
    session.defaultSession.setDisplayMediaRequestHandler(
        (request, callback) => {
            desktopCapturer.getSources({ types: ['screen'] }).then(sources => {
                callback({ video: sources[0], audio: 'loopback' });
            });
        },
        { useSystemPicker: true }
    );

    mainWindow.setContentProtection(true);
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    // Hide from Windows taskbar
    if (process.platform === 'win32') {
        try {
            mainWindow.setSkipTaskbar(true);
        } catch (error) {
            console.warn('Could not hide from taskbar:', error.message);
        }
    }

    // Hide from Mission Control on macOS
    if (process.platform === 'darwin') {
        try {
            mainWindow.setHiddenInMissionControl(true);
        } catch (error) {
            console.warn('Could not hide from Mission Control:', error.message);
        }
    }

    if (process.platform === 'win32') {
        mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
    }

    mainWindow.loadFile(path.join(__dirname, '../index.html'));

    // After window is created, initialize keybinds
    mainWindow.webContents.once('dom-ready', () => {
        setTimeout(() => {
            const defaultKeybinds = getDefaultKeybinds();
            let keybinds = defaultKeybinds;

            // Load keybinds from storage
            const savedKeybinds = storage.getKeybinds();
            if (savedKeybinds) {
                keybinds = { ...defaultKeybinds, ...savedKeybinds };
            }

            updateGlobalShortcuts(keybinds, mainWindow, sendToRenderer, geminiSessionRef);
        }, 150);
    });

    setupWindowIpcHandlers(mainWindow, sendToRenderer, geminiSessionRef);

    return mainWindow;
}

function getDefaultKeybinds() {
    return getPolicyDefaultKeybinds(process.platform);
}

function updateGlobalShortcuts(keybinds, mainWindow, sendToRenderer, geminiSessionRef) {
    console.log('Updating global shortcuts with:', keybinds);

    // Unregister all existing shortcuts
    globalShortcut.unregisterAll();
    const registrationResults = [];
    const duplicates = detectDuplicateKeybinds(keybinds);
    const duplicateActions = new Set(duplicates.flatMap(entry => entry.actions));

    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.workAreaSize;
    const moveIncrement = Math.floor(Math.min(width, height) * 0.1);

    const registerShortcut = (action, callback) => {
        const keybind = keybinds[action];
        if (!keybind) {
            registrationResults.push(formatShortcutRegistrationResult(action, keybind || '', false, '未設定'));
            return;
        }

        if (duplicateActions.has(action)) {
            registrationResults.push(formatShortcutRegistrationResult(action, keybind, false, '同じキーが複数の操作に設定されています'));
            console.warn(`Skipped duplicate shortcut ${action}: ${keybind}`);
            return;
        }

        try {
            const success = globalShortcut.register(keybind, callback);
            registrationResults.push(
                formatShortcutRegistrationResult(action, keybind, success, success ? null : 'OSまたは他アプリとの衝突で登録できませんでした')
            );
            if (success) {
                console.log(`Registered ${action}: ${keybind}`);
            } else {
                console.error(`Failed to register ${action} (${keybind})`);
            }
        } catch (error) {
            registrationResults.push(formatShortcutRegistrationResult(action, keybind, false, error));
            console.error(`Failed to register ${action} (${keybind}):`, error);
        }
    };

    const movementActions = {
        moveUp: () => {
            if (!mainWindow.isVisible()) return;
            const [currentX, currentY] = mainWindow.getPosition();
            mainWindow.setPosition(currentX, currentY - moveIncrement);
        },
        moveDown: () => {
            if (!mainWindow.isVisible()) return;
            const [currentX, currentY] = mainWindow.getPosition();
            mainWindow.setPosition(currentX, currentY + moveIncrement);
        },
        moveLeft: () => {
            if (!mainWindow.isVisible()) return;
            const [currentX, currentY] = mainWindow.getPosition();
            mainWindow.setPosition(currentX - moveIncrement, currentY);
        },
        moveRight: () => {
            if (!mainWindow.isVisible()) return;
            const [currentX, currentY] = mainWindow.getPosition();
            mainWindow.setPosition(currentX + moveIncrement, currentY);
        },
    };

    Object.keys(movementActions).forEach(action => {
        registerShortcut(action, movementActions[action]);
    });

    // Register toggle visibility shortcut
    registerShortcut('toggleVisibility', () => {
        if (mainWindow.isVisible()) {
            mainWindow.hide();
        } else {
            mainWindow.showInactive();
        }
    });

    // Register toggle click-through shortcut
    registerShortcut('toggleClickThrough', () => {
        mouseEventsIgnored = !mouseEventsIgnored;
        if (mouseEventsIgnored) {
            mainWindow.setIgnoreMouseEvents(true, { forward: true });
            console.log('Mouse events ignored');
        } else {
            mainWindow.setIgnoreMouseEvents(false);
            console.log('Mouse events enabled');
        }
        mainWindow.webContents.send('click-through-toggled', mouseEventsIgnored);
    });

    // Register next step shortcut (either starts session or takes screenshot based on view)
    registerShortcut('nextStep', async () => {
        console.log('Next step shortcut triggered');
        try {
            // Determine the shortcut key format
            const isMac = process.platform === 'darwin';
            const shortcutKey = isMac ? 'cmd+enter' : 'ctrl+enter';

            // Use the new handleShortcut function
            mainWindow.webContents.executeJavaScript(`
                whisperOhKami.handleShortcut('${shortcutKey}');
            `);
        } catch (error) {
            console.error('Error handling next step shortcut:', error);
        }
    });

    // Register previous response shortcut
    registerShortcut('previousResponse', () => {
        console.log('Previous response shortcut triggered');
        sendToRenderer('navigate-previous-response');
    });

    // Register next response shortcut
    registerShortcut('nextResponse', () => {
        console.log('Next response shortcut triggered');
        sendToRenderer('navigate-next-response');
    });

    // Register scroll up shortcut
    registerShortcut('scrollUp', () => {
        console.log('Scroll up shortcut triggered');
        sendToRenderer('scroll-response-up');
    });

    // Register scroll down shortcut
    registerShortcut('scrollDown', () => {
        console.log('Scroll down shortcut triggered');
        sendToRenderer('scroll-response-down');
    });

    const status = {
        results: registrationResults,
        byAction: Object.fromEntries(registrationResults.map(result => [result.action, result])),
        duplicates,
        updatedAt: Date.now(),
    };
    sendToRenderer('shortcut-registration-status', status);
    return status;
}

function setupWindowIpcHandlers(mainWindow, sendToRenderer, geminiSessionRef) {
    ipcMain.on('view-changed', (event, view) => {
        if (!mainWindow.isDestroyed()) {
            if (view !== 'assistant') {
                mainWindow.setIgnoreMouseEvents(false);
            }
        }
    });

    ipcMain.handle('window-minimize', () => {
        if (!mainWindow.isDestroyed()) {
            mainWindow.minimize();
        }
    });

    ipcMain.on('update-keybinds', (event, newKeybinds) => {
        if (!mainWindow.isDestroyed()) {
            updateGlobalShortcuts(newKeybinds, mainWindow, sendToRenderer, geminiSessionRef);
        }
    });

    ipcMain.handle('toggle-window-visibility', async event => {
        try {
            if (mainWindow.isDestroyed()) {
                return { success: false, error: 'Window has been destroyed' };
            }

            if (mainWindow.isVisible()) {
                mainWindow.hide();
            } else {
                mainWindow.showInactive();
            }
            return { success: true };
        } catch (error) {
            console.error('Error toggling window visibility:', error);
            return { success: false, error: error.message };
        }
    });
}

module.exports = {
    createWindow,
    getDefaultKeybinds,
    updateGlobalShortcuts,
    setupWindowIpcHandlers,
};
