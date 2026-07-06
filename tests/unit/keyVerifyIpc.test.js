'use strict';
const fs = require('fs');
const path = require('path');
const read = rel => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');

describe('key verification IPC wiring', () => {
    test('index.js registers both verify handlers and invokes setup', () => {
        const index = read('src/index.js');
        expect(index).toMatch(/ipcMain\.handle\('verify:gemini-key'/);
        expect(index).toMatch(/ipcMain\.handle\('verify:deepgram-key'/);
        expect(index).toMatch(/setupKeyVerifyIpcHandlers\(\)/);
    });
    test('renderer exposes whisperOhKami.keyVerify.gemini/.deepgram', () => {
        const renderer = read('src/utils/renderer.js');
        expect(renderer).toMatch(/keyVerify:\s*\{/);
        expect(renderer).toMatch(/invoke\('verify:gemini-key'/);
        expect(renderer).toMatch(/invoke\('verify:deepgram-key'/);
    });
});
