// Phase 1g-3.7: this module is retained as a thin alias for one release so any
// out-of-tree callers (custom scripts, copy-pasted DevTools snippets, etc.)
// keep working while the codebase migrates to `./audioCapture`. New code MUST
// require './audioCapture' directly.
//
// Scheduled removal: Phase 1g-3.8.
//
// IPC aliases that resolve to the same handlers are kept in `gemini.js`:
//   start-ffmpeg-loopback             → start-audio-capture
//   stop-ffmpeg-loopback              → stop-audio-capture
//   dev:dump-ffmpeg-loopback-status   → dev:dump-audio-capture-status

module.exports = require('./audioCapture');
