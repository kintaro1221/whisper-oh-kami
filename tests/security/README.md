# Renderer security regression

Run the Jest suite with `npm test -- --runInBand`. The real Chromium regression is separate from Jest:

```powershell
npm run test:renderer-security -- --output-dir=C:\Temp\whisper-renderer-test
```

Choose a new disposable directory. The harness uses a hidden window and an isolated Electron profile, blocks HTTP/HTTPS requests, and substitutes external-link opening. It does not access the microphone or the normal application settings. Inspect `result.json`; `ok` must be `true` (Windows GUI process wrappers may not propagate an exit code).

To inspect the exact packaged renderer, add `--root=C:\path\to\WhisperOhKAMI-win32-x64\resources\app.asar`. Run with the same Electron version as the packaged app.

The harness exercises the production AssistantView sink, streaming prefixes, raw HTML and encoded URL payloads, missing/throwing parsers, literal-text fallback, normal Japanese Markdown, external links, and main-process navigation guards. Native Whisper, installers, OS browser/mail handlers and real microphone capture require separate validation.
