'use strict';

const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..', '..');
const read = relPath => fs.readFileSync(path.join(repoRoot, relPath), 'utf8');

// Commercialization Phase 0 (§0.2): no "cheating" / "daddy" in customer-visible
// strings. The upstream GPL attribution legitimately names "cheating-daddy" (a
// required credit, kept in HelpView), so this guards the one real leak — the
// helper-exe filename surfaced inside a user-facing diagnostic.
describe('Phase 0.2: diagnostics do not leak the daddyAudioCapture exe name', () => {
    for (const table of ['src/i18n/ja.js', 'src/i18n/en.js']) {
        test(`${table} has no daddyAudioCapture reference`, () => {
            expect(read(table)).not.toMatch(/daddyAudioCapture/i);
        });
    }
});
