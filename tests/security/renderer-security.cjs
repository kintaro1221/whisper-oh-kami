'use strict';

// Real Chromium regression for the shared AI-response sink. No user profile,
// microphone, external browser or network access is used.
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const args = Object.fromEntries(process.argv.slice(2).map(arg => arg.split(/=(.*)/s).slice(0, 2)));
if (!args['--output-dir']) throw new Error('--output-dir must name an isolated test directory');
const output = path.resolve(args['--output-dir']);
const root = path.resolve(args['--root'] || path.join(__dirname, '../..'));
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'profile'));
app.disableHardwareAcceleration();
const report = { electron: process.versions.electron, root, cases: [], requests: [] };
const timer = setTimeout(() => finish(new Error('Renderer regression timed out')), 90000);
function finish(error) {
    clearTimeout(timer);
    report.ok = !error;
    if (error) report.error = error.stack || String(error);
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
    app.exit(error ? 1 : 0);
}
app.whenReady()
    .then(async () => {
        session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, done) => {
            report.requests.push(details.url);
            done({ cancel: true });
        });
        const win = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false, webSecurity: true } });
        const fixture = path.join(output, 'fixture.html');
        fs.writeFileSync(fixture, '<!doctype html><meta charset="utf-8"><div id="responseContainer"></div>');
        await win.loadFile(fixture);
        await win.webContents.executeJavaScript(
            `window.require = require('node:module').createRequire(${JSON.stringify(path.join(root, 'src/index.html'))}); void 0;`
        );
        await win.webContents.executeJavaScript(
            'window.marked = window.require(' + JSON.stringify(path.join(root, 'src/assets/marked-4.3.0.min.js')) + '); void 0;'
        );
        report.cases = await win.webContents.executeJavaScript(`(async () => {
        const { AssistantView } = await import(${JSON.stringify(pathToFileURL(path.join(root, 'src/components/views/AssistantView.js')).href)});
        const p = AssistantView.prototype;
        const container = document.querySelector('#responseContainer');
        const cases = [];
        let input = '';
        window.__securitySentinel = 0;
        const view = { shadowRoot: { querySelector: () => container }, getCurrentResponse: () => input,
            renderMarkdown: p.renderMarkdown, wrapWordsInSpans: p.wrapWordsInSpans, shouldAnimateResponse: false };
        const assert = (ok, message) => { if (!ok) throw new Error(message + '\\nDOM: ' + container.innerHTML); };
        const settle = () => new Promise(resolve => setTimeout(resolve, 15));
        const render = async text => { input = text; p.updateResponseContent.call(view); await settle(); };
        const safe = () => {
            assert(window.__securitySentinel === 0, 'AI content executed JavaScript');
            assert(!container.querySelector('img,svg,math,iframe,object,embed,script,style,link,meta,form,video,audio,source,webview'), 'Resource/active element survived');
            for (const el of container.querySelectorAll('*')) for (const attr of el.attributes) {
                assert(!/^on/i.test(attr.name) && !['style', 'src', 'srcdoc', 'formaction', 'id', 'name'].includes(attr.name), 'Active attribute survived: ' + attr.name);
            }
            for (const a of container.querySelectorAll('a[href]')) assert(/^(https?:|mailto:)/.test(a.getAttribute('href')), 'Unsafe link survived');
        };
        await render('# 日本語の見出し\\n\\n**太字** と *強調*\\n改行\\n\\n- 一\\n- 二\\n\\n> 引用\\n\\n| 項目 | 値 |\\n| --- | --- |\\n| A | B |\\n\\n~~~js\\nconst n = 1;\\n~~~\\n\\n&lt;img onerror=alert(1)&gt;');
        assert(container.querySelector('h1') && container.querySelector('strong') && container.querySelector('table') && container.querySelector('pre code.language-js'), 'Markdown formatting regressed');
        assert(container.textContent.includes('<img onerror=alert(1)>'), 'Encoded text was double escaped');
        cases.push('Japanese GFM, table, code and encoded-text controls');
        const payloads = [
            '<img src=x onerror="window.__securitySentinel++">',
            '<svg onload="window.__securitySentinel++"></svg>',
            '<iframe srcdoc="<script>parent.__securitySentinel++<\\/script>"></iframe>',
            '[x](jav&#x61;script:window.__securitySentinel++)',
            '<a href="java&#9;script:window.__securitySentinel++">x</a>',
            '<a href="data:text/html,hello">x</a><a href="file:///C:/Windows/win.ini">y</a>',
            '<img src="https://example.invalid/tracker"><style>body{background:url(https://example.invalid/css)}</style>',
            '<math><mtext><table><mglyph><style><!--</style><img title="--><img src=x onerror=window.__securitySentinel++>">',
            '<form id="responseContainer"><input name="innerHTML"><button formaction="javascript:alert(1)">x</button></form>'
        ];
        for (const payload of payloads) { await render(payload); safe(); }
        cases.push('Original and alternate active-HTML/link payloads');
        for (const payload of payloads) for (let i = 1; i <= payload.length; i++) { input = payload.slice(0, i); p.updateResponseContent.call(view); safe(); }
        await settle(); safe();
        cases.push('All streaming prefixes');
        const marked = window.marked;
        for (const parser of [undefined, { parse() { throw new Error('test parser failure'); } }, { parse() { return undefined; } }]) {
            window.marked = parser;
            await render(payloads[0]);
            assert(container.textContent === payloads[0], 'Parser fallback must show literal text'); safe();
        }
        window.marked = marked;
        const renderMarkdown = view.renderMarkdown;
        view.renderMarkdown = () => { throw new Error('test helper failure'); };
        await render(payloads[0]);
        assert(container.textContent === payloads[0], 'Sink fallback must show literal text'); safe();
        view.renderMarkdown = renderMarkdown;
        cases.push('Missing/throwing/invalid parser and helper fallbacks');
        const electron = window.require('electron');
        const originalInvoke = electron.ipcRenderer.invoke;
        const opened = [];
        electron.ipcRenderer.invoke = async (...args) => { opened.push(args); return { success: true }; };
        try {
            await render('[安全なリンク](https://example.com/path?q=1) [メール](mailto:support@example.com)');
            const anchor = container.querySelector('a');
            const nested = anchor.querySelector('span') || anchor;
            assert(!nested.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })), 'Link navigation not prevented');
            anchor.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }));
            container.querySelectorAll('a')[1].click();
            assert(opened.length === 3 && opened.every(call => call[0] === 'open-external'), 'Safe links must use external IPC');
        } finally { electron.ipcRenderer.invoke = originalInvoke; }
        cases.push('Nested link clicks, middle clicks and mailto use external IPC');
        return cases;
    })()`);
        if (report.requests.length) throw new Error('AI output caused a network request: ' + report.requests.join(', '));
        const { protectWebContents } = require(path.join(root, 'src/utils/externalNavigation'));
        protectWebContents(win.webContents);
        let popups = 0;
        win.webContents.on('did-create-window', () => popups++);
        const before = win.webContents.getURL();
        await win.webContents.executeJavaScript("window.open('https://example.invalid/popup'); location.href='https://example.invalid/navigation';");
        await new Promise(resolve => setTimeout(resolve, 100));
        if (popups || win.webContents.getURL() !== before || report.requests.length) throw new Error('Navigation or popup guard failed');
        report.cases.push('Main-process navigation and popup denial');
        finish();
    })
    .catch(finish);
