'use strict';

const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..', '..');
const read = relPath => fs.readFileSync(path.join(repoRoot, relPath), 'utf8');

// Whisper default-model change (2026-09): Xenova/whisper-tiny's Japanese
// accuracy proved unusable, so the default is now Xenova/whisper-small.
// Regression guard: no src/ fallback literal (`|| 'Xenova/whisper-tiny'`,
// `= 'Xenova/whisper-tiny'`) should reintroduce tiny as a default. tiny
// remains a valid, selectable model — this only guards the *fallback*
// literals, not the model id itself, which is why storage.js's migration
// comments (which mention the string for documentation) are excluded.
describe('Whisper default-model fallback literals (JP accuracy fix)', () => {
    const filesToCheck = ['src/utils/renderer.js', 'src/components/views/MainView.js', 'src/utils/localai.js'];

    test.each(filesToCheck)('%s has no whisper-tiny fallback/default literal', file => {
        const body = read(file);
        expect(body).not.toMatch(/\|\|\s*'Xenova\/whisper-tiny'/);
        expect(body).not.toMatch(/=\s*'Xenova\/whisper-tiny'\s*;/);
    });

    test('storage.js default preference is whisper-small', () => {
        const body = read('src/storage.js');
        expect(body).toMatch(/whisperModel:\s*'Xenova\/whisper-small'/);
    });

    test('renderer.js and MainView.js fall back to whisper-small', () => {
        expect(read('src/utils/renderer.js')).toMatch(/\|\|\s*'Xenova\/whisper-small'/);
        expect(read('src/components/views/MainView.js')).toMatch(/'Xenova\/whisper-small'/);
    });
});
