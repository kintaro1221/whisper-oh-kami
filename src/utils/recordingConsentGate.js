// Recording-consent gate: a tiny, dependency-free state machine backing
// CheatingDaddyApp#confirmRecordingConsent().
//
// Background: the gate used to be `window.confirm()` directly. In the
// packaged, transparent/frameless overlay window, Windows renders
// window.confirm() as a body-less, button-less ~160x28px dialog placed
// off-screen (observed y ~1004px) instead of a real prompt, and the
// renderer blocks synchronously on it — every session start looked frozen
// until that invisible dialog was dismissed. See ROADMAP v3 short-term #4.
//
// This module owns only the request/accept/cancel/de-dup bookkeeping so it
// can be unit tested directly under Jest (no DOM, no Lit — same dual
// CJS/window export shape as evidenceInspector.js / discoveryPhase.js /
// whisperBarState.js). CheatingDaddyApp renders the actual in-app modal and
// calls accept()/cancel() from its button handlers and Escape key handling.
class RecordingConsentGate {
    constructor() {
        this._pending = null;
    }

    // True while a consent request is in flight (modal should be showing).
    get isOpen() {
        return this._pending !== null;
    }

    // Starts a new consent request unless one is already in flight, in
    // which case the same in-flight Promise is returned and `onOpen` is
    // NOT called again — this is the de-dup guard against a second modal
    // appearing if confirmRecordingConsent() is invoked twice (e.g. a
    // double click / double Ctrl+Enter) while the first is still showing.
    //
    // `onOpen` runs synchronously, exactly once per new request, so the
    // caller can render its UI. If it throws (e.g. no shadowRoot to render
    // into), the request fails closed — resolves false, same as declining.
    request(onOpen) {
        if (this._pending) {
            return this._pending.promise;
        }

        let resolveFn;
        const promise = new Promise(resolve => {
            resolveFn = resolve;
        });
        this._pending = { resolve: resolveFn, promise };

        try {
            if (typeof onOpen === 'function') onOpen();
        } catch (e) {
            this._settle(false);
        }

        return promise;
    }

    // User explicitly agreed — resolves the pending request's Promise true.
    accept() {
        this._settle(true);
    }

    // User cancelled / pressed Escape / dismissed — resolves false.
    cancel() {
        this._settle(false);
    }

    _settle(result) {
        if (!this._pending) return;
        const { resolve } = this._pending;
        this._pending = null;
        resolve(result);
    }
}

const _recordingConsentGateApi = { RecordingConsentGate };

if (typeof module !== 'undefined' && module.exports) {
    module.exports = _recordingConsentGateApi;
}
if (typeof window !== 'undefined') {
    window.RecordingConsentGate = RecordingConsentGate;
}
