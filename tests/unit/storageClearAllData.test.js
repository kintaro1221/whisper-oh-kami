// Task 7 (v0.7.5 trust gates): 「すべてのデータを削除」 must also remove the
// legacy config directory that the Phase 0 rebrand migration preserved, because
// it can still hold the user's old API keys and conversation history.

const fs = require('fs');
const os = require('os');
const path = require('path');

let base;

afterEach(() => {
    if (base && fs.existsSync(base)) {
        fs.rmSync(base, { recursive: true, force: true });
    }
});

test('clearAllData removes both the current and the legacy config directories', () => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'wok-'));
    const current = path.join(base, 'whisper-oh-kami-config');
    const legacy = path.join(base, 'cheating-daddy-config');
    fs.mkdirSync(current);
    fs.mkdirSync(legacy);
    fs.writeFileSync(path.join(current, 'credentials.json'), '{"apiKey":"x"}');
    fs.writeFileSync(path.join(legacy, 'credentials.json'), '{}');
    const storage = require('../../src/storage');
    storage.__setConfigDirsForTest({ current, legacy });
    storage.clearAllData();
    // The current dir is wiped; it may be re-created empty-with-defaults only
    // if the implementation chooses to — the brief requires it to be gone.
    expect(fs.existsSync(current)).toBe(false);
    expect(fs.existsSync(legacy)).toBe(false);
});

test('clearAllData returns success with no failures when both directories are removed', () => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'wok-'));
    const current = path.join(base, 'whisper-oh-kami-config');
    const legacy = path.join(base, 'cheating-daddy-config');
    fs.mkdirSync(current);
    fs.mkdirSync(legacy);
    const storage = require('../../src/storage');
    storage.__setConfigDirsForTest({ current, legacy });
    expect(storage.clearAllData()).toEqual({ success: true, failed: [] });
});

test('the legacy directory is still removed when removing the current one throws, and the failure is reported', () => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'wok-'));
    const current = path.join(base, 'whisper-oh-kami-config');
    const legacy = path.join(base, 'cheating-daddy-config');
    fs.mkdirSync(current);
    fs.mkdirSync(legacy);
    fs.writeFileSync(path.join(legacy, 'credentials.json'), '{}');
    const storage = require('../../src/storage');
    storage.__setConfigDirsForTest({ current, legacy });
    const realRmSync = fs.rmSync;
    const spy = jest.spyOn(fs, 'rmSync').mockImplementation((p, opts) => {
        if (p === current) throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' });
        return realRmSync(p, opts);
    });
    try {
        const result = storage.clearAllData();
        expect(result).toEqual({ success: false, failed: [current] });
        expect(fs.existsSync(legacy)).toBe(false);
        expect(fs.existsSync(current)).toBe(true);
    } finally {
        spy.mockRestore();
    }
});

// CustomizeView is a Lit ESM component; run the real clearLocalData body
// against a fake `this` / whisperOhKami (same technique as
// experimentalModeGate.test.js).
describe('CustomizeView.clearLocalData result handling', () => {
    const viewSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'src/components/views/CustomizeView.js'), 'utf8');
    const start = viewSrc.indexOf('async clearLocalData() {');
    const end = viewSrc.indexOf('async exportSupportDiagnostics()', start);
    const chunk = viewSrc.slice(start + 'async clearLocalData() {'.length, end);
    const body = chunk.slice(0, chunk.lastIndexOf('}'));
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const ja = require('../../src/i18n/ja');
    const dict = ja.default || ja.ja || ja;
    const t = key => dict[key] || key;

    function run(clearResult) {
        const invoked = [];
        const timers = [];
        const view = { isClearing: false, requestUpdate: () => {} };
        const whisperOhKami = { storage: { clearAll: async () => clearResult } };
        const win = { require: () => ({ ipcRenderer: { invoke: async ch => invoked.push(ch) } }) };
        const fakeSetTimeout = fn => timers.push(fn);
        const fn = new AsyncFunction('whisperOhKami', 't', 'window', 'setTimeout', body).bind(view, whisperOhKami, t, win, fakeSetTimeout);
        return { view, invoked, timers, done: fn() };
    }

    test('a partial failure shows the failed paths and never quits', async () => {
        const r = run({ success: false, failed: ['C:\\x\\whisper-oh-kami-config'] });
        await r.done;
        expect(r.view.clearStatusType).toBe('error');
        expect(r.view.clearStatusMessage).toContain('C:\\x\\whisper-oh-kami-config');
        expect(r.view.clearStatusMessage).toContain('削除できませんでした');
        expect(r.timers).toHaveLength(0);
        expect(r.invoked).not.toContain('quit-application');
    });

    test('success still reports cleared and schedules the quit', async () => {
        const r = run({ success: true, failed: [] });
        await r.done;
        expect(r.view.clearStatusType).toBe('success');
        expect(r.timers).toHaveLength(1);
    });
});
