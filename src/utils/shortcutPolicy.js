'use strict';

function isMacPlatform(platform = process.platform) {
    return platform === 'darwin';
}

function getDefaultKeybinds(platform = process.platform) {
    const isMac = isMacPlatform(platform);
    return {
        moveUp: isMac ? 'Alt+Up' : 'Ctrl+Up',
        moveDown: isMac ? 'Alt+Down' : 'Ctrl+Down',
        moveLeft: isMac ? 'Alt+Left' : 'Ctrl+Left',
        moveRight: isMac ? 'Alt+Right' : 'Ctrl+Right',
        toggleVisibility: isMac ? 'Cmd+\\' : 'Ctrl+\\',
        toggleClickThrough: isMac ? 'Cmd+M' : 'Ctrl+M',
        nextStep: isMac ? 'Cmd+Enter' : 'Ctrl+Enter',
        previousResponse: isMac ? 'Cmd+[' : 'Ctrl+[',
        nextResponse: isMac ? 'Cmd+]' : 'Ctrl+]',
        scrollUp: isMac ? 'Cmd+Shift+Up' : 'Ctrl+Shift+Up',
        scrollDown: isMac ? 'Cmd+Shift+Down' : 'Ctrl+Shift+Down',
    };
}

function getShortcutActions(platform = process.platform) {
    return [
        { key: 'toggleVisibility', name: '表示・非表示切替', category: 'live', visibility: 'primary_live' },
        { key: 'toggleClickThrough', name: 'クリックスルー切替', category: 'live', visibility: 'primary_live' },
        { key: 'nextStep', name: 'AI に次のステップを尋ねる', category: 'live', visibility: 'primary_live' },
        { key: 'previousResponse', name: '前の回答', category: 'response', visibility: 'help' },
        { key: 'nextResponse', name: '次の回答', category: 'response', visibility: 'help' },
        { key: 'scrollUp', name: '回答を上にスクロール', category: 'response', visibility: 'help' },
        { key: 'scrollDown', name: '回答を下にスクロール', category: 'response', visibility: 'help' },
        { key: 'moveUp', name: 'ウィンドウを上へ移動', category: 'window_movement', visibility: 'hidden' },
        { key: 'moveDown', name: 'ウィンドウを下へ移動', category: 'window_movement', visibility: 'hidden' },
        { key: 'moveLeft', name: 'ウィンドウを左へ移動', category: 'window_movement', visibility: 'hidden' },
        { key: 'moveRight', name: 'ウィンドウを右へ移動', category: 'window_movement', visibility: 'hidden' },
    ].map(action => ({ ...action, platform }));
}

function normalizeRegistrationMap(registrationStatus = {}) {
    const out = {};
    if (!registrationStatus || typeof registrationStatus !== 'object') return out;
    for (const [key, value] of Object.entries(registrationStatus)) {
        if (value && typeof value === 'object') {
            out[key] = {
                success: value.success !== false,
                error: value.error || null,
            };
        }
    }
    return out;
}

function getShortcutRowsForHelp(keybinds = {}, registrationStatus = {}, platform = process.platform) {
    const defaults = getDefaultKeybinds(platform);
    const merged = { ...defaults, ...(keybinds || {}) };
    const registrations = normalizeRegistrationMap(registrationStatus);
    return getShortcutActions(platform)
        .filter(action => action.visibility !== 'hidden')
        .map(action => ({
            ...action,
            keybind: merged[action.key] || '',
            registration: registrations[action.key] || null,
        }));
}

function formatShortcutRegistrationResult(action, keybind, success, error = null) {
    return {
        action,
        keybind,
        success: !!success,
        error: success ? null : error instanceof Error ? error.message : error ? String(error) : null,
    };
}

function detectDuplicateKeybinds(keybinds = {}) {
    const byKeybind = new Map();
    for (const [action, keybind] of Object.entries(keybinds || {})) {
        if (!keybind) continue;
        const list = byKeybind.get(keybind) || [];
        list.push(action);
        byKeybind.set(keybind, list);
    }
    return Array.from(byKeybind.entries())
        .filter(([, actions]) => actions.length > 1)
        .map(([keybind, actions]) => ({ keybind, actions }));
}

module.exports = {
    detectDuplicateKeybinds,
    formatShortcutRegistrationResult,
    getDefaultKeybinds,
    getShortcutActions,
    getShortcutRowsForHelp,
};
