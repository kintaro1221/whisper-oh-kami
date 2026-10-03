// sessionGeneration.js — monotonic counter that lets long-running async
// work (Gemini / Groq / Ollama streams, LLM refinement, screen analysis,
// Whisper transcription) detect that the session it started in has ended.
//
// Usage:
//   const token = sessionGeneration.capture();   // at the start of the work
//   ...await something...
//   if (token.isStale()) return;                  // session changed meanwhile
//
// bump() is called on every session boundary (initializeNewSession and
// close-session). A token is stale as soon as ANY bump happened after it
// was captured, so "stop → immediately restart" invalidates the old work
// even though a new session is already live.
'use strict';

function createGenerationCounter() {
    let generation = 0;
    return {
        get current() {
            return generation;
        },
        bump() {
            generation += 1;
            return generation;
        },
        capture() {
            const g = generation;
            return { generation: g, isStale: () => g !== generation };
        },
    };
}

module.exports = { createGenerationCounter };
