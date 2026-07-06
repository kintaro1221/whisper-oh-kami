// Jest configuration for cheating-daddy
//
// Phase 1g-3.8 Now: minimal Jest infra. Targets the existing standalone
// modules (deepgram.js, audioCapture.js) only. Renderer / Electron / Gemini
// Live / native helper / live Deepgram are out of scope and stay mocked.
//
// testEnvironment is fixed to 'node' — no jsdom yet (renderer.js tests come
// later, after gemini.js split).

module.exports = {
    testEnvironment: 'node',
    testMatch: ['<rootDir>/tests/**/*.test.js', '<rootDir>/src/**/__tests__/**/*.test.js'],
    testPathIgnorePatterns: ['/node_modules/', '/out/', '/native/'],
    collectCoverageFrom: ['src/utils/deepgram.js', 'src/utils/audioCapture.js'],
    coverageDirectory: '<rootDir>/coverage',
    clearMocks: true,
    resetModules: true,
    verbose: true,
};
