const {
    detectDuplicateKeybinds,
    formatShortcutRegistrationResult,
    getDefaultKeybinds,
    getShortcutActions,
    getShortcutRowsForHelp,
} = require('../../src/utils/shortcutPolicy');

describe('getDefaultKeybinds', () => {
    test('does not expose the removed emergency-erase shortcut', () => {
        const keybinds = getDefaultKeybinds('win32');
        const actions = getShortcutActions('win32');

        expect(keybinds.emergencyErase).toBeUndefined();
        expect(actions.find(action => action.key === 'emergencyErase')).toBeUndefined();
    });

    test('uses mac modifier labels for macOS defaults', () => {
        expect(getDefaultKeybinds('darwin').toggleVisibility).toBe('Cmd+\\');
        expect(getDefaultKeybinds('darwin').nextStep).toBe('Cmd+Enter');
    });
});

describe('shortcut display policy', () => {
    test('only start/next, hide, and click-through are primary live shortcuts', () => {
        const primary = getShortcutActions('win32')
            .filter(action => action.visibility === 'primary_live')
            .map(action => action.key);

        expect(primary).toEqual(['toggleVisibility', 'toggleClickThrough', 'nextStep']);
    });

    test('help rows include registration status and hide movement shortcuts by default', () => {
        const rows = getShortcutRowsForHelp(getDefaultKeybinds('win32'), {
            moveUp: { success: true },
            nextStep: { success: false, error: 'already registered' },
        });

        expect(rows.some(row => row.key === 'moveUp')).toBe(false);
        expect(rows.find(row => row.key === 'nextStep')).toMatchObject({
            keybind: 'Ctrl+Enter',
            registration: { success: false, error: 'already registered' },
        });
    });
});

describe('shortcut registration helpers', () => {
    test('formats registration success and failure consistently', () => {
        expect(formatShortcutRegistrationResult('nextStep', 'Ctrl+Enter', true)).toEqual({
            action: 'nextStep',
            keybind: 'Ctrl+Enter',
            success: true,
            error: null,
        });
        expect(formatShortcutRegistrationResult('nextStep', 'Ctrl+Enter', false, new Error('taken'))).toEqual({
            action: 'nextStep',
            keybind: 'Ctrl+Enter',
            success: false,
            error: 'taken',
        });
    });

    test('detects duplicate non-empty keybinds', () => {
        const duplicates = detectDuplicateKeybinds({
            nextStep: 'Ctrl+Enter',
            toggleVisibility: 'Ctrl+\\',
            scrollDown: 'Ctrl+Enter',
            empty: '',
        });

        expect(duplicates).toEqual([{ keybind: 'Ctrl+Enter', actions: ['nextStep', 'scrollDown'] }]);
    });
});
