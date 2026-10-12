'use strict';

const { normalizeExternalUrl } = require('./externalUrlPolicy');

function protectWebContents(contents) {
    // Renderer content never replaces the privileged application document.
    contents.on('will-navigate', event => event.preventDefault());
    contents.on('will-frame-navigate', event => event.preventDefault());
    contents.on('will-attach-webview', event => event.preventDefault());
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

async function openExternalFromMainFrame(event, value, mainWindow, shell) {
    const url = normalizeExternalUrl(value);
    if (
        !url ||
        !mainWindow ||
        mainWindow.isDestroyed() ||
        event.sender !== mainWindow.webContents ||
        event.senderFrame !== mainWindow.webContents.mainFrame
    ) {
        return { success: false, error: 'External link is not allowed' };
    }
    try {
        await shell.openExternal(url);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

module.exports = { protectWebContents, openExternalFromMainFrame };
