'use strict';

const { EventEmitter } = require('node:events');
const { normalizeExternalUrl } = require('../../src/utils/externalUrlPolicy');
const { protectWebContents, openExternalFromMainFrame } = require('../../src/utils/externalNavigation');

test.each([
    ['https://example.com/help?q=%E6%97%A5', 'https://example.com/help?q=%E6%97%A5'],
    ['HTTP://example.com', 'http://example.com/'],
    ['mailto:support@example.com?subject=Hello%20world', 'mailto:support@example.com?subject=Hello%20world'],
    ['mailto:support@example.com?body=Line%201%0ALine%202', 'mailto:support@example.com?body=Line%201%0ALine%202'],
])('allows supported external URL %s', (input, expected) => expect(normalizeExternalUrl(input)).toBe(expected));

test.each([
    null,
    {},
    '',
    '/relative',
    '//example.com',
    'https:example.com',
    ' javascript:alert(1)',
    'java\tscript:alert(1)',
    'data:text/html,hello',
    'file:///C:/Windows/win.ini',
    'vscode://file/a',
    'https://user:password@example.com',
    'https://exa\nmple.com',
    'https://example.com/a b',
    'mailto:',
    '\\\\server\\file',
])('rejects unsafe or ambiguous URL %p', input => expect(normalizeExternalUrl(input)).toBeNull());

test('renderer navigation, subframe navigation, embedded webviews and popups are denied', () => {
    const contents = new EventEmitter();
    contents.setWindowOpenHandler = jest.fn();
    protectWebContents(contents);
    for (const name of ['will-navigate', 'will-frame-navigate', 'will-attach-webview']) {
        const event = { preventDefault: jest.fn() };
        contents.emit(name, event);
        expect(event.preventDefault).toHaveBeenCalledTimes(1);
    }
    expect(contents.setWindowOpenHandler.mock.calls[0][0]()).toEqual({ action: 'deny' });
});

test('external IPC requires both the application webContents and its main frame', async () => {
    const contents = { mainFrame: {} };
    const mainWindow = { isDestroyed: () => false, webContents: contents };
    const shell = { openExternal: jest.fn().mockResolvedValue(undefined) };
    const event = { sender: contents, senderFrame: contents.mainFrame };
    for (const invalid of [{}, { sender: {}, senderFrame: contents.mainFrame }, { sender: contents, senderFrame: {} }]) {
        expect((await openExternalFromMainFrame(invalid, 'https://example.com', mainWindow, shell)).success).toBe(false);
    }
    expect((await openExternalFromMainFrame(event, 'javascript:alert(1)', mainWindow, shell)).success).toBe(false);
    expect((await openExternalFromMainFrame(event, 'https://example.com', null, shell)).success).toBe(false);
    expect(shell.openExternal).not.toHaveBeenCalled();
    expect(await openExternalFromMainFrame(event, 'https://example.com', mainWindow, shell)).toEqual({ success: true });
    expect(shell.openExternal).toHaveBeenCalledWith('https://example.com/');
    shell.openExternal.mockRejectedValue(new Error('No handler'));
    expect(await openExternalFromMainFrame(event, 'mailto:support@example.com', mainWindow, shell)).toEqual({ success: false, error: 'No handler' });
});
