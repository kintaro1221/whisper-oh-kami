'use strict';

// Regression test for src/utils/discoveryPhase.js boot-time SyntaxError
// ("Identifier '_api' has already been declared").
//
// Root cause: src/index.html loads evidenceInspector.js and discoveryPhase.js
// as plain <script> tags. Plain (non-module) scripts share the realm's
// top-level "global declarative environment record", so two files declaring
// `const _api` at the top level cause the second file to fail to parse.
//
// vm.Script reproduces this: when both files are concatenated and parsed as
// a single script, V8 applies the same top-level lexical declaration check
// the browser does across sibling <script> tags. If both files declare the
// same top-level lexical name, vm.Script throws at construction time.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PLAIN_SCRIPT_FILES = ['src/utils/evidenceInspector.js', 'src/utils/discoveryPhase.js', 'src/utils/whisperBarState.js'];

function readPlainScript(relPath) {
    return fs.readFileSync(path.join(__dirname, '..', '..', relPath), 'utf8');
}

describe('plain-script UMD files in index.html', () => {
    test('can be concatenated and parsed without top-level identifier collisions', () => {
        const combined = PLAIN_SCRIPT_FILES.map(readPlainScript).join('\n;\n');
        expect(() => new vm.Script(combined)).not.toThrow();
    });

    test('each plain-script file still exposes its window.* alias after the fix', () => {
        const context = vm.createContext({ window: {}, module: undefined });
        for (const relPath of PLAIN_SCRIPT_FILES) {
            vm.runInContext(readPlainScript(relPath), context);
        }
        expect(context.window.evidenceInspector).toEqual(expect.objectContaining({ formatRelativeTime: expect.any(Function) }));
        expect(context.window.discoveryPhase).toEqual(expect.objectContaining({ computeDiscoveryPhase: expect.any(Function) }));
        expect(typeof context.window.whisperBarState).toBe('function');
    });
});
