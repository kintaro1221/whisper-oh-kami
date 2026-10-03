// audioHelperPolicy.js — decides whether the native WASAPI helper
// (daddyAudioCapture.exe → Deepgram system-side stream) is needed for the
// current preferences. The helper exists ONLY to feed Deepgram with the
// counterpart's audio; Gemini Live and local Whisper get system audio from
// the renderer's getDisplayMedia loopback instead. Starting the helper when
// it is not needed produced a spurious "ヘルパーを起動できませんでした"
// card on every session start in the default configuration (v0.7.4).
//
// Loaded both via require() (main process / jest) and as a plain <script>
// in src/index.html, so top-level identifiers must stay unique across the
// plain-script utils (see tests/unit/plainScriptScope.test.js).
'use strict';

function shouldStartAudioHelper(prefs) {
    const p = prefs || {};
    return (
        p.providerMode === 'byok' &&
        p.sttMode === 'cloud' &&
        p.hasDeepgramKey === true &&
        (p.systemDeviceId === 'auto' || p.systemDeviceId === undefined || p.systemDeviceId === '') &&
        p.audioMode !== 'mic_only'
    );
}

function describeAudioHelperRole(prefs) {
    return shouldStartAudioHelper(prefs) ? 'deepgram_system' : 'not_needed';
}

const _audioHelperPolicyApi = { shouldStartAudioHelper, describeAudioHelperRole };
if (typeof module !== 'undefined' && module.exports) module.exports = _audioHelperPolicyApi;
if (typeof window !== 'undefined') window.audioHelperPolicy = _audioHelperPolicyApi;
