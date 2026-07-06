const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..', '..');

function read(relPath) {
    return fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
}

describe('visible error diagnostics integration contract', () => {
    test('app shell keeps a persistent diagnostic panel fed by app-diagnostic events', () => {
        const app = read('src/components/app/CheatingDaddyApp.js');

        expect(app).toMatch(/ipcRenderer\.on\('app-diagnostic'/);
        expect(app).toMatch(/showDiagnostic\(diagnostic\)/);
        expect(app).toMatch(/_renderDiagnostic\(\)/);
        expect(app).toMatch(/diagnostic-panel/);
        expect(app).toMatch(/common\.dismiss/);
    });

    test('renderer classifies user-facing startup and capture failures', () => {
        const renderer = read('src/utils/renderer.js');

        expect(renderer).toMatch(/classifyByokKey/);
        expect(renderer).toMatch(/classifyGeminiInitFailure/);
        expect(renderer).toMatch(/classifyAudioHelperFailure/);
        expect(renderer).toMatch(/showDiagnostic\(/);
    });

    test('main-process local, trial, and Deepgram failures emit diagnostics', () => {
        const localai = read('src/utils/localai.js');
        const gemini = read('src/utils/gemini.js');

        expect(localai).toMatch(/classifyOllamaFailure/);
        expect(localai).toMatch(/classifyWhisperFailure/);
        expect(localai).toMatch(/app-diagnostic/);
        expect(gemini).toMatch(/classifyDeepgramStatus/);
        expect(gemini).toMatch(/app-diagnostic/);
    });
});
