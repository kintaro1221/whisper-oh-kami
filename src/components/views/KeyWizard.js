import { html, css, LitElement } from '../../assets/lit-core-2.7.4.min.js';

// ② Guided BYOK key wizard. Presentational + verification only — it never
// persists. It bubbles `key-entered` ({provider, value, verified}) whenever a
// format-valid key is typed/pasted, and `wizard-close` when finished/closed.
// MainView owns persistence (reuses _saveGeminiKey/_saveDeepgramKey) and the
// open/close flag. Globals used at runtime: t(), window.WhisperKeyFormat,
// window.whisperOhKami.keyVerify.
export class KeyWizard extends LitElement {
    static properties = {
        geminiKey: { type: String },
        deepgramKey: { type: String },
        onExternalLink: { type: Function },
        _step: { state: true },
        _geminiState: { state: true }, // 'idle'|'checking'|'ok'|'invalid'|'network' ('network' = any non-definitive could-not-verify)
        _deepgramState: { state: true },
    };

    static styles = css`
        :host {
            position: fixed;
            inset: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            background: rgba(0, 0, 0, 0.5);
            z-index: 50;
            font-family: var(--font, sans-serif);
        }
        .panel {
            background: var(--bg-base, #fff);
            color: var(--text-primary, #111);
            width: min(420px, 92vw);
            border-radius: 12px;
            padding: 20px;
            box-shadow: 0 12px 40px rgba(0, 0, 0, 0.3);
        }
        .progress {
            font-size: 12px;
            opacity: 0.65;
            margin-bottom: 8px;
        }
        h3 {
            margin: 0 0 6px;
            font-size: 16px;
        }
        .lead {
            font-size: 13px;
            line-height: 1.7;
            opacity: 0.85;
        }
        input {
            width: 100%;
            margin-top: 10px;
            padding: 8px 10px;
            border: 1px solid var(--border, #ccc);
            border-radius: 6px;
            font-family: var(--font-mono, monospace);
            box-sizing: border-box;
        }
        .status {
            font-size: 12px;
            margin-top: 6px;
            min-height: 16px;
        }
        .ok {
            color: #27ae60;
        }
        .warn {
            color: #c0392b;
        }
        .privacy {
            color: #c0392b;
            font-size: 11px;
            margin-top: 6px;
        }
        .row {
            display: flex;
            justify-content: space-between;
            gap: 8px;
            margin-top: 16px;
        }
        button {
            padding: 8px 14px;
            border-radius: 6px;
            border: 1px solid var(--border, #ccc);
            background: var(--bg-elevated, #f3f3f3);
            cursor: pointer;
            font-family: var(--font, sans-serif);
        }
        button.primary {
            background: var(--accent, #2d6cdf);
            color: #fff;
            border-color: transparent;
        }
        .link-btn {
            width: 100%;
            margin-top: 10px;
        }
    `;

    constructor() {
        super();
        this.geminiKey = '';
        this.deepgramKey = '';
        this.onExternalLink = () => {};
        this._step = 1;
        this._geminiState = 'idle';
        this._deepgramState = 'idle';
        this._debounce = null;
    }

    _emit(name, detail) {
        this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
    }

    _close() {
        this._emit('wizard-close');
    }

    // Debounced live verify; only fires when the format gate passes. Advisory:
    // a non-ok result never blocks saving (the key was already emitted upward).
    _scheduleVerify(provider, value) {
        clearTimeout(this._debounce);
        const fmtOk =
            provider === 'gemini' ? window.WhisperKeyFormat.isValidGeminiKeyFormat(value) : window.WhisperKeyFormat.isValidDeepgramKeyFormat(value);
        const stateProp = provider === 'gemini' ? '_geminiState' : '_deepgramState';
        if (!value.trim()) {
            this[stateProp] = 'idle';
            return;
        }
        if (!fmtOk) {
            this[stateProp] = 'invalid';
            return;
        }
        this[stateProp] = 'checking';
        this._debounce = setTimeout(async () => {
            const res = await window.whisperOhKami.keyVerify[provider](value);
            if (!this.isConnected) return;
            // Only a definitive 'invalid' (400/401/403) shows the ✗ invalid message.
            // 'network'/'rate'/'unknown' are non-definitive → neutral "couldn't verify" (key still saved).
            this[stateProp] = res.ok ? 'ok' : res.reason === 'invalid' ? 'invalid' : 'network';
            this._emit('key-entered', { provider, value, verified: res.ok });
        }, 600);
    }

    _onInput(provider, value) {
        if (provider === 'gemini') this.geminiKey = value;
        else this.deepgramKey = value;
        // Emit immediately on format-OK so persistence happens even if the user
        // closes before verification returns.
        const fmtOk =
            provider === 'gemini' ? window.WhisperKeyFormat.isValidGeminiKeyFormat(value) : window.WhisperKeyFormat.isValidDeepgramKeyFormat(value);
        if (fmtOk) this._emit('key-entered', { provider, value, verified: false });
        this._scheduleVerify(provider, value);
    }

    _renderStatus(state) {
        if (state === 'idle') return html`<div class="status"></div>`;
        if (state === 'checking') return html`<div class="status">${t('wizard.verify.checking')}</div>`;
        if (state === 'ok') return html`<div class="status ok">${t('wizard.verify.ok')}</div>`;
        if (state === 'network') return html`<div class="status warn">${t('wizard.verify.network')}</div>`;
        return html`<div class="status warn">${t('wizard.verify.invalid')}</div>`;
    }

    _renderGemini() {
        return html`
            <div class="progress">1 / 3</div>
            <h3>${t('wizard.gemini.title')}</h3>
            <div class="lead">${t('wizard.gemini.lead')}</div>
            <button class="link-btn" @click=${() => this.onExternalLink('https://aistudio.google.com/apikey')}>${t('wizard.gemini.open')} ↗</button>
            <input type="password" placeholder="AIza…" .value=${this.geminiKey} @input=${e => this._onInput('gemini', e.target.value)} />
            ${this._renderStatus(this._geminiState)}
            <div class="row">
                <button @click=${this._close}>${t('wizard.skip')}</button>
                <button class="primary" @click=${() => (this._step = 2)}>${t('wizard.next')}</button>
            </div>
        `;
    }

    _renderDeepgram() {
        return html`
            <div class="progress">2 / 3</div>
            <h3>${t('wizard.deepgram.title')}</h3>
            <div class="lead">${t('wizard.deepgram.lead')}</div>
            <button class="link-btn" @click=${() => this.onExternalLink('https://console.deepgram.com/')}>${t('wizard.deepgram.open')} ↗</button>
            <input type="password" placeholder="Token…" .value=${this.deepgramKey} @input=${e => this._onInput('deepgram', e.target.value)} />
            ${this._renderStatus(this._deepgramState)}
            <div class="privacy">${t('wizard.deepgram.privacy')}</div>
            <div class="row">
                <button @click=${() => (this._step = 1)}>${t('wizard.back')}</button>
                <button class="primary" @click=${() => (this._step = 3)}>${t('wizard.next')}</button>
            </div>
        `;
    }

    _renderDone() {
        return html`
            <div class="progress">3 / 3</div>
            <h3>${t('wizard.done.title')}</h3>
            <div class="row">
                <button @click=${() => (this._step = 2)}>${t('wizard.back')}</button>
                <button class="primary" @click=${this._close}>${t('wizard.done.start')}</button>
            </div>
        `;
    }

    render() {
        return html`
            <div class="panel">${this._step === 1 ? this._renderGemini() : this._step === 2 ? this._renderDeepgram() : this._renderDone()}</div>
        `;
    }
}

customElements.define('key-wizard', KeyWizard);
