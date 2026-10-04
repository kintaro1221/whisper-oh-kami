import { html, css, LitElement } from '../../assets/lit-core-2.7.4.min.js';
import { brandMark } from '../../assets/brand-mark.js';
import { KeyWizard } from './KeyWizard.js';

export class MainView extends LitElement {
    static styles = css`
        * {
            font-family: var(--font);
            cursor: default;
            user-select: none;
            box-sizing: border-box;
        }

        :host {
            height: 100%;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: var(--space-xl) var(--space-lg);
            position: relative; /* NEW: anchors .mv-aurora-layer */
        }

        .mv-aurora-layer {
            position: absolute;
            inset: 0;
            z-index: 0;
            pointer-events: none;
            border-radius: inherit;
            overflow: hidden;
        }

        .mv-aurora-layer canvas.mv-aurora {
            position: absolute;
            inset: 0;
            width: 100%;
            height: 100%;
        }

        .form-wrapper {
            position: relative;
            z-index: 2;
            width: 100%;
            max-width: 420px;
            display: flex;
            flex-direction: column;
            gap: var(--space-md);
            padding: var(--space-lg);
            background: rgba(255, 255, 255, 0.55);
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.7);
            border-radius: var(--radius-md);
            box-shadow: 0 2px 12px rgba(31, 58, 95, 0.04);
        }

        /* 狭い window では sidebar が icon-only に折りたたまれ
           (CheatingDaddyApp の @media (max-width: 820px) 参照)、
           main content 領域も狭くなる。form を full-width に開放し、
           padding も少し詰めて窮屈さを緩和。 */
        @media (max-width: 700px) {
            .form-wrapper {
                max-width: 100%;
                padding: var(--space-md);
            }
        }

        .page-title {
            display: flex;
            align-items: center;
            gap: var(--space-sm);
            font-size: var(--font-size-xl);
            font-weight: var(--font-weight-semibold);
            line-height: var(--line-height-tight);
            color: var(--text-primary);
            margin-bottom: var(--space-xs);
        }

        .page-title svg {
            flex-shrink: 0;
        }

        .page-title .mode-suffix {
            color: var(--text-muted);
            font-size: var(--font-size-sm);
            font-weight: var(--font-weight-normal);
            margin-left: 0.4em;
        }

        .page-subtitle {
            font-size: var(--font-size-sm);
            color: var(--text-muted);
            margin-bottom: var(--space-md);
        }

        /* ── Cloud promo card ── */

        .cloud-promo {
            position: relative;
            overflow: hidden;
            display: flex;
            flex-direction: column;
            gap: 10px;
            padding: 14px 16px;
            border-radius: var(--radius-md);
            border: 1px solid rgba(59, 130, 246, 0.45);
            background: linear-gradient(135deg, rgba(59, 130, 246, 0.12) 0%, rgba(139, 92, 246, 0.09) 100%);
            cursor: pointer;
            transition:
                border-color 0.2s,
                background 0.2s;
        }

        .cloud-promo:hover {
            border-color: rgba(59, 130, 246, 0.65);
            background: linear-gradient(135deg, rgba(59, 130, 246, 0.16) 0%, rgba(139, 92, 246, 0.12) 100%);
            box-shadow:
                0 0 20px rgba(59, 130, 246, 0.15),
                0 0 40px rgba(139, 92, 246, 0.08);
        }

        .cloud-promo-glow {
            position: absolute;
            top: -40%;
            right: -20%;
            width: 120px;
            height: 120px;
            background: radial-gradient(circle, rgba(59, 130, 246, 0.15) 0%, transparent 70%);
            pointer-events: none;
        }

        .cloud-promo-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
        }

        .cloud-promo-title {
            font-size: var(--font-size-sm);
            font-weight: var(--font-weight-semibold);
            color: var(--text-primary);
        }

        .cloud-promo-arrow {
            color: var(--accent);
            font-size: 16px;
            transition: transform 0.2s;
        }

        .cloud-promo:hover .cloud-promo-arrow {
            transform: translateX(2px);
        }

        .cloud-promo-desc {
            font-size: var(--font-size-xs);
            color: var(--text-secondary);
            line-height: var(--line-height);
        }

        /* ── Form controls ── */

        .form-group {
            display: flex;
            flex-direction: column;
            gap: var(--space-xs);
        }

        .form-label {
            font-size: var(--font-size-xs);
            font-weight: var(--font-weight-medium);
            color: var(--text-secondary);
            text-transform: uppercase;
        }

        input,
        select,
        textarea {
            background: var(--bg-elevated);
            color: var(--text-primary);
            border: 1px solid var(--border);
            padding: 10px 12px;
            width: 100%;
            border-radius: var(--radius-sm);
            font-size: var(--font-size-sm);
            font-family: var(--font);
            transition:
                border-color var(--transition),
                box-shadow var(--transition);
        }

        input:hover:not(:focus),
        select:hover:not(:focus),
        textarea:hover:not(:focus) {
            border-color: var(--text-muted);
        }

        input:focus,
        select:focus,
        textarea:focus {
            outline: none;
            border-color: var(--accent);
            box-shadow: 0 0 0 1px var(--accent);
        }

        input::placeholder,
        textarea::placeholder {
            color: var(--text-muted);
        }

        input.error {
            border-color: var(--danger, #ef4444);
        }

        select {
            cursor: pointer;
            appearance: none;
            background-image: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%23999' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e");
            background-position: right 8px center;
            background-repeat: no-repeat;
            background-size: 14px;
            padding-right: 28px;
        }

        textarea {
            resize: vertical;
            min-height: 80px;
            line-height: var(--line-height);
        }

        .form-hint {
            font-size: var(--font-size-xs);
            color: var(--text-muted);
        }

        .wizard-entry {
            width: 100%;
            padding: 10px;
            border-radius: 8px;
            border: 1px solid var(--accent, #2d6cdf);
            background: var(--accent-soft, rgba(45, 108, 223, 0.08));
            color: var(--accent, #2d6cdf);
            cursor: pointer;
            font-weight: 600;
        }
        .wizard-or {
            text-align: center;
            opacity: 0.5;
            font-size: 12px;
            margin: 8px 0;
        }

        .form-hint a,
        .form-hint span.link {
            color: var(--accent);
            text-decoration: none;
            cursor: pointer;
        }

        .form-hint span.link:hover {
            text-decoration: underline;
        }

        .key-hint-ok {
            color: var(--success, #1f9d57);
        }

        .key-hint-warn {
            color: var(--danger, #ef4444);
        }

        .whisper-label-row {
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .whisper-status {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }

        .whisper-status__text {
            /* 桁が増減しても % テキストの幅がぶれないように */
            font-variant-numeric: tabular-nums;
        }

        .whisper-bar {
            width: 100%;
            height: 6px;
            background: var(--border);
            border-radius: 3px;
            overflow: hidden;
        }

        .whisper-bar__fill {
            height: 100%;
            background: var(--accent);
            transition: width 0.3s ease;
        }

        .whisper-bar--indeterminate .whisper-bar__fill {
            width: 40%;
            animation: whisper-bar-indeterminate 1.1s ease-in-out infinite;
        }

        @keyframes whisper-bar-indeterminate {
            0% {
                transform: translateX(-110%);
            }
            100% {
                transform: translateX(360%);
            }
        }

        @media (prefers-reduced-motion: reduce) {
            .whisper-bar__fill {
                transition: none;
            }
            .whisper-bar--indeterminate .whisper-bar__fill {
                /* motion を切るユーザーには 100% 塗り=「完了」に誤読されるため、
                   状態不明を表す静的な部分塗り(muted)にする */
                animation: none;
                width: 40%;
                opacity: 0.65;
            }
        }

        /* ── Start button ── */

        .start-button {
            position: relative;
            overflow: hidden;
            background: linear-gradient(180deg, #3a5a82 0%, #1f3a5f 100%);
            color: #ffffff;
            border: none;
            padding: 12px var(--space-md);
            border-radius: var(--radius-sm);
            font-size: var(--font-size-base);
            font-weight: var(--font-weight-semibold);
            cursor: pointer;
            width: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: var(--space-sm);
            box-shadow:
                0 2px 8px rgba(31, 58, 95, 0.18),
                inset 0 1px 0 rgba(255, 255, 255, 0.18);
            transition:
                background var(--transition),
                box-shadow var(--transition);
        }

        .start-button .btn-label {
            position: relative;
            display: flex;
            align-items: center;
            gap: var(--space-sm);
        }

        .start-button:hover {
            background: linear-gradient(180deg, #4a6a92 0%, #2c4f7c 100%);
            box-shadow:
                0 4px 12px rgba(31, 58, 95, 0.24),
                inset 0 1px 0 rgba(255, 255, 255, 0.22);
        }

        .start-button.disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .start-button.disabled:hover {
            background: linear-gradient(180deg, #3a5a82 0%, #1f3a5f 100%);
            box-shadow:
                0 2px 8px rgba(31, 58, 95, 0.18),
                inset 0 1px 0 rgba(255, 255, 255, 0.18);
        }

        .shortcut-hint {
            display: inline-flex;
            align-items: center;
            gap: 2px;
            opacity: 0.5;
            font-family: var(--font-mono);
        }

        /* ── Divider ── */

        .divider {
            display: flex;
            align-items: center;
            gap: var(--space-md);
            margin: var(--space-sm) 0;
        }

        .divider-line {
            flex: 1;
            height: 1px;
            background: var(--border);
        }

        .divider-text {
            font-size: var(--font-size-xs);
            color: var(--text-muted);
            text-transform: lowercase;
        }

        /* ── Mode switch links ── */

        .mode-links {
            display: flex;
            justify-content: center;
            gap: var(--space-lg);
        }

        .mode-link {
            font-size: var(--font-size-sm);
            color: var(--text-secondary);
            cursor: pointer;
            background: none;
            border: none;
            padding: 0;
            transition: color var(--transition);
        }

        .mode-link:hover {
            color: var(--text-primary);
        }

        .trial-card {
            display: flex;
            flex-direction: column;
            gap: 6px;
            padding: 12px 14px;
            border: 1px solid var(--border);
            border-radius: var(--radius-md);
            background: var(--bg-elevated);
        }

        .trial-title {
            font-size: var(--font-size-sm);
            font-weight: 600;
            color: var(--text-primary);
        }

        /* ── Mode option cards ── */

        .mode-cards {
            display: flex;
            gap: var(--space-sm);
        }

        .mode-card {
            position: relative;
            flex: 1;
            display: flex;
            flex-direction: column;
            gap: 4px;
            padding: 12px 14px;
            border-radius: var(--radius-md);
            border: 1px solid var(--border);
            background: var(--bg-elevated);
            cursor: pointer;
            appearance: none;
            text-align: center;
            font-family: var(--font);
            transition:
                border-color 0.2s,
                background 0.2s;
        }

        .mode-card:hover {
            border-color: var(--text-muted);
            background: var(--bg-hover);
        }

        .mode-card:focus-visible {
            outline: none;
            box-shadow: 0 0 0 2px var(--accent);
        }

        .mode-card.active {
            border: 2px solid var(--accent);
            background: rgba(31, 58, 95, 0.06);
        }

        .mode-card-title {
            font-size: var(--font-size-sm);
            font-weight: var(--font-weight-semibold);
            color: var(--text-primary);
        }

        .mode-card-desc {
            font-size: var(--font-size-xs);
            color: var(--text-muted);
            line-height: var(--line-height);
        }

        .mode-badge {
            position: absolute;
            top: -8px;
            left: 50%;
            transform: translateX(-50%);
            background: var(--accent);
            color: #fff;
            font-size: 10px;
            font-weight: var(--font-weight-medium);
            padding: 1px 7px;
            border-radius: 999px;
            white-space: nowrap;
        }

        /* 検証中 tag on the byok / local cards. Same pill shape as .mode-badge,
           but inline (the selected badge already owns the top-center slot). */
        .mode-card-tag {
            align-self: center;
            border: 1px solid var(--warning);
            color: var(--warning);
            font-size: 10px;
            font-weight: var(--font-weight-medium);
            padding: 0 7px;
            border-radius: 999px;
            white-space: nowrap;
            line-height: 1.6;
        }

        /* ── Reassurance rows (trial: "what happens when you start") ── */

        .reassure-list {
            display: flex;
            flex-direction: column;
            gap: var(--space-sm);
            padding: 12px 14px;
            border: 1px solid var(--border);
            border-radius: var(--radius-md);
            background: var(--bg-elevated);
        }

        .reassure-row {
            display: flex;
            align-items: flex-start;
            gap: var(--space-sm);
            font-size: var(--font-size-xs);
            color: var(--text-secondary);
            line-height: 1.5;
        }

        .reassure-row svg {
            flex-shrink: 0;
            color: var(--accent);
            margin-top: 1px;
        }

        /* ── Advanced settings (progressive disclosure) ── */

        details.advanced {
            border: 1px solid var(--border);
            border-radius: var(--radius-md);
            background: var(--bg-app);
        }

        details.advanced > summary {
            list-style: none;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: var(--space-sm);
            padding: 11px 14px;
            font-size: var(--font-size-sm);
            font-weight: var(--font-weight-medium);
            color: var(--text-secondary);
        }

        details.advanced > summary::-webkit-details-marker {
            display: none;
        }

        details.advanced > summary:focus-visible {
            outline: none;
            box-shadow: 0 0 0 2px var(--accent);
            border-radius: var(--radius-md);
        }

        .advanced-summary-left {
            display: flex;
            align-items: center;
            gap: 7px;
        }

        .advanced-hint {
            display: flex;
            align-items: center;
            gap: 5px;
            font-size: var(--font-size-xs);
            font-weight: var(--font-weight-normal);
            color: var(--text-muted);
        }

        .advanced-body {
            display: flex;
            flex-direction: column;
            gap: var(--space-md);
            padding: 4px 14px 14px;
            border-top: 1px solid var(--border);
        }

        /* ── Title row with help ── */

        .title-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: var(--space-xs);
        }

        .title-row .page-title {
            margin-bottom: 0;
        }

        .help-btn {
            background: none;
            border: none;
            color: var(--text-muted);
            cursor: pointer;
            padding: 4px;
            border-radius: var(--radius-sm);
            transition: color 0.2s;
            display: flex;
            align-items: center;
        }

        .help-btn:hover {
            color: var(--text-secondary);
        }

        .help-btn * {
            pointer-events: none;
        }

        /* ── Help content ── */

        .help-content {
            display: flex;
            flex-direction: column;
            gap: var(--space-md);
            max-height: 500px;
            overflow-y: auto;
        }

        .help-section {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }

        .help-section-title {
            font-size: var(--font-size-xs);
            font-weight: var(--font-weight-semibold);
            color: var(--text-primary);
        }

        .help-section-text {
            font-size: var(--font-size-xs);
            color: var(--text-secondary);
            /* 長文ヘルプ専用、読みやすさ優先で reading 行間。 */
            line-height: var(--line-height-reading);
        }

        .help-code {
            font-family: var(--font-mono);
            font-size: 11px;
            background: var(--bg-hover);
            padding: 6px 8px;
            border-radius: var(--radius-sm);
            color: var(--text-primary);
            display: block;
        }

        .help-link {
            color: var(--accent);
            cursor: pointer;
            text-decoration: none;
        }

        .help-link:hover {
            text-decoration: underline;
        }

        .help-models {
            display: flex;
            flex-direction: column;
            gap: 2px;
        }

        .help-model {
            font-size: var(--font-size-xs);
            color: var(--text-secondary);
            display: flex;
            justify-content: space-between;
        }

        .help-model-name {
            font-family: var(--font-mono);
            font-size: 11px;
            color: var(--text-primary);
        }

        .help-divider {
            border: none;
            border-top: 1px solid var(--border);
            margin: 0;
        }

        .help-cloud-btn {
            background: #e8e8e8;
            color: #111111;
            border: none;
            padding: 10px var(--space-md);
            border-radius: var(--radius-sm);
            font-size: var(--font-size-sm);
            font-family: var(--font);
            font-weight: var(--font-weight-semibold);
            cursor: pointer;
            width: 100%;
            transition: opacity 0.15s;
        }

        .help-cloud-btn:hover {
            opacity: 0.9;
        }

        .help-warn {
            font-size: var(--font-size-xs);
            color: var(--warning);
            line-height: var(--line-height);
        }

        .trial-to-byok {
            display: block;
            width: 100%;
            margin-top: 8px;
            padding: 8px;
            border: none;
            background: none;
            color: var(--accent, #2d6cdf);
            font-size: 13px;
            cursor: pointer;
            text-decoration: underline;
        }
    `;

    static properties = {
        onStart: { type: Function },
        onExternalLink: { type: Function },
        selectedProfile: { type: String },
        onProfileChange: { type: Function },
        isInitializing: { type: Boolean },
        whisperDownloading: { type: Boolean },
        whisperProgress: { type: Object },
        whisperError: { type: Boolean },
        // Internal state
        _mode: { state: true },
        _wizardOpen: { state: true },
        _geminiKey: { state: true },
        _deepgramKey: { state: true },
        _groqKey: { state: true },
        _openaiKey: { state: true },
        _keyError: { state: true },
        _credSessionOnly: { state: true }, // keys cannot be stored encrypted on this PC
        // Local AI state
        _ollamaHost: { state: true },
        _ollamaModel: { state: true },
        _whisperModel: { state: true },
        _showLocalHelp: { state: true },
        _audioDevices: { state: true },
        _micDeviceId: { state: true },
        _systemDeviceId: { state: true },
    };

    constructor() {
        super();
        this.onStart = () => {};
        this.onExternalLink = () => {};
        this.selectedProfile = 'sales';
        this.onProfileChange = () => {};
        this.isInitializing = false;
        this.whisperDownloading = false;
        this.whisperProgress = null;
        this.whisperError = false;

        this._mode = 'trial';
        this._wizardOpen = false;
        this._geminiKey = '';
        this._deepgramKey = '';
        this._groqKey = '';
        this._openaiKey = '';
        this._keyError = false;
        this._credSessionOnly = false;
        this._showLocalHelp = false;
        this._ollamaHost = 'http://127.0.0.1:11434';
        this._ollamaModel = 'gemma3:4b';
        this._whisperModel = 'Xenova/whisper-small';
        this._audioDevices = [];
        this._micDeviceId = '';
        this._systemDeviceId = 'auto';

        this.boundKeydownHandler = this._handleKeydown.bind(this);
        this._loadFromStorage();
    }

    async _loadFromStorage() {
        try {
            const [prefs, creds] = await Promise.all([
                whisperOhKami.storage.getPreferences(),
                whisperOhKami.storage.getCredentials().catch(() => ({})),
            ]);

            const storedMode = prefs.providerMode || 'trial';
            const supportedMode = ['trial', 'byok', 'local'].includes(storedMode) ? storedMode : 'trial';
            this._mode = storedMode === 'cloud' ? 'byok' : supportedMode;

            if (storedMode === 'cloud') {
                await whisperOhKami.storage.updatePreference('providerMode', this._mode);
            }

            // Load keys
            this._geminiKey = (await whisperOhKami.storage.getApiKey().catch(() => '')) || '';
            this._groqKey = (await whisperOhKami.storage.getGroqApiKey().catch(() => '')) || '';
            this._openaiKey = creds.openaiKey || '';
            // Load from credentials directly (not getDeepgramApiKey) so a host
            // DEEPGRAM_API_KEY env var never leaks into the visible input field.
            this._deepgramKey = creds.deepgramApiKey || '';
            const credStatus =
                typeof whisperOhKami.storage.getCredentialStorageStatus === 'function'
                    ? await whisperOhKami.storage.getCredentialStorageStatus().catch(() => null)
                    : null;
            this._credSessionOnly = !!(credStatus && credStatus.sessionOnly);

            // Load local AI settings
            this._ollamaHost = prefs.ollamaHost || 'http://127.0.0.1:11434';
            this._ollamaModel = prefs.ollamaModel || 'gemma3:4b';
            this._whisperModel = prefs.whisperModel || 'Xenova/whisper-small';

            // Load saved mic / system audio selection (validated in _enumerateDevices)
            this._micDeviceId = prefs.micDeviceId || '';
            this._systemDeviceId = prefs.systemDeviceId || 'auto';

            this.requestUpdate();
        } catch (e) {
            console.error('Error loading MainView storage:', e);
        }
    }

    connectedCallback() {
        super.connectedCallback();
        document.addEventListener('keydown', this.boundKeydownHandler);
        this._enumerateDevices();
        this._boundDeviceChange = () => this._enumerateDevices();
        navigator.mediaDevices?.addEventListener?.('devicechange', this._boundDeviceChange);
    }

    firstUpdated() {
        super.firstUpdated && super.firstUpdated();
        const { startAurora } = require('./utils/aurora');
        const aurora = this.shadowRoot.querySelector('canvas.mv-aurora');
        if (aurora) {
            // No dither overlay on MainView — its pixelated grain was too sharp
            // for the always-on background. OnboardingView keeps the dither.
            this._auroraHandle = startAurora(aurora, null, { intensity: 'soft' });
        }
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        document.removeEventListener('keydown', this.boundKeydownHandler);
        if (this._boundDeviceChange) {
            navigator.mediaDevices?.removeEventListener?.('devicechange', this._boundDeviceChange);
            this._boundDeviceChange = null;
        }
        if (this._auroraHandle) {
            const { stopAurora } = require('./utils/aurora');
            stopAurora(this._auroraHandle);
            this._auroraHandle = null;
        }
    }

    async _enumerateDevices() {
        try {
            // Request mic permission once so device labels become readable.
            if (!this._micPermissionAsked) {
                this._micPermissionAsked = true;
                try {
                    const tmp = await navigator.mediaDevices.getUserMedia({ audio: true });
                    tmp.getTracks().forEach(t => t.stop());
                } catch (_) {
                    // Permission denied — labels will be empty but enumeration still works.
                }
            }
            const all = await navigator.mediaDevices.enumerateDevices();
            const inputs = all
                .filter(d => d.kind === 'audioinput')
                .map(d => ({
                    deviceId: d.deviceId,
                    label: d.label || t('main.audio.mic_label_fallback').replace('{id}', (d.deviceId || '').slice(0, 8)),
                }));
            this._audioDevices = inputs;

            // If saved selection no longer exists, fall back to the first available.
            if (this._micDeviceId && !inputs.some(d => d.deviceId === this._micDeviceId)) {
                this._micDeviceId = inputs[0]?.deviceId || '';
                if (this._micDeviceId) {
                    whisperOhKami.storage.updatePreference('micDeviceId', this._micDeviceId);
                }
            }
            this.requestUpdate();
        } catch (err) {
            console.error('[MainView] enumerateDevices failed:', err);
        }
    }

    async _saveMicDeviceId(val) {
        this._micDeviceId = val || '';
        await whisperOhKami.storage.updatePreference('micDeviceId', this._micDeviceId);
        this.requestUpdate();
    }

    async _saveSystemDeviceId(val) {
        this._systemDeviceId = val || 'auto';
        await whisperOhKami.storage.updatePreference('systemDeviceId', this._systemDeviceId);
        this.requestUpdate();
    }

    _handleKeydown(e) {
        const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
        if ((isMac ? e.metaKey : e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            this._handleStart();
        }
    }

    // ── Persistence ──

    async _saveMode(mode) {
        this._mode = mode;
        this._keyError = false;
        await whisperOhKami.storage.updatePreference('providerMode', mode);
        this.requestUpdate();
    }

    _openWizard() {
        this._wizardOpen = true;
        this.requestUpdate();
    }

    _switchToByokWithWizard() {
        this._saveMode('byok');
        this._wizardOpen = true;
        this.requestUpdate();
    }

    _onWizardKeyEntered(e) {
        const { provider, value } = e.detail;
        if (provider === 'gemini') this._saveGeminiKey(value);
        else if (provider === 'deepgram') this._saveDeepgramKey(value);
    }

    async _saveGeminiKey(val) {
        this._geminiKey = val;
        this._keyError = false;
        await whisperOhKami.storage.setApiKey(val);
        this.requestUpdate();
    }

    // Single source of truth for the Gemini key format (shared by the live
    // input hint and the start-time guard). This is a cheap shape check; actual
    // validity is only confirmed when a session starts.
    _isValidGeminiKeyFormat(key) {
        return window.WhisperKeyFormat.isValidGeminiKeyFormat(key);
    }

    // B1-1: live format feedback so the user knows the key looks right before
    // Start, instead of finding out 20 minutes in.
    _renderGeminiKeyStatus() {
        const key = (this._geminiKey || '').trim();
        if (!key) return '';
        return this._isValidGeminiKeyFormat(key)
            ? html`<div class="form-hint key-hint-ok">${t('main.api.key_hint.ok')}</div>`
            : html`<div class="form-hint key-hint-warn">${t('main.api.key_hint.invalid')}</div>`;
    }

    async _saveDeepgramKey(val) {
        this._deepgramKey = val;
        await whisperOhKami.storage.setDeepgramApiKey(val);
        this.requestUpdate();
    }

    // Deepgram keys are 32+ hex chars (no AIza prefix), so this is its own shape
    // check, separate from the Gemini validator.
    _isValidDeepgramKeyFormat(key) {
        return window.WhisperKeyFormat.isValidDeepgramKeyFormat(key);
    }

    // Optional field: an empty key is fine — cloud STT simply stays off and the
    // byok path degrades to Gemini Live. Only warn when a non-empty key is malformed.
    _renderDeepgramKeyStatus() {
        const key = (this._deepgramKey || '').trim();
        if (!key) return '';
        return this._isValidDeepgramKeyFormat(key)
            ? html`<div class="form-hint key-hint-ok">${t('main.api.deepgram_hint.ok')}</div>`
            : html`<div class="form-hint key-hint-warn">${t('main.api.deepgram_hint.invalid')}</div>`;
    }

    async _saveGroqKey(val) {
        this._groqKey = val;
        await whisperOhKami.storage.setGroqApiKey(val);
        this.requestUpdate();
    }

    async _saveOpenaiKey(val) {
        this._openaiKey = val;
        try {
            const creds = await whisperOhKami.storage.getCredentials().catch(() => ({}));
            await whisperOhKami.storage.setCredentials({ ...creds, openaiKey: val });
        } catch (e) {}
        this.requestUpdate();
    }

    async _saveOllamaHost(val) {
        this._ollamaHost = val;
        await whisperOhKami.storage.updatePreference('ollamaHost', val);
        this.requestUpdate();
    }

    async _saveOllamaModel(val) {
        this._ollamaModel = val;
        await whisperOhKami.storage.updatePreference('ollamaModel', val);
        this.requestUpdate();
    }

    _handleProfileChange(e) {
        this.onProfileChange(e.target.value);
    }

    // ── Start ──

    _handleStart() {
        if (this.isInitializing) return;

        if (this._mode === 'byok') {
            if (!this._geminiKey.trim()) {
                this._keyError = true;
                if (globalThis.whisperOhKami && globalThis.whisperOhKami.showDiagnostic) {
                    globalThis.whisperOhKami.showDiagnostic({ code: 'byok_missing_key' });
                }
                this.requestUpdate();
                return;
            }
            if (!this._isValidGeminiKeyFormat(this._geminiKey)) {
                this._keyError = true;
                if (globalThis.whisperOhKami && globalThis.whisperOhKami.showDiagnostic) {
                    globalThis.whisperOhKami.showDiagnostic({ code: 'byok_invalid_format' });
                }
                this.requestUpdate();
                return;
            }
        } else if (this._mode === 'trial') {
            this.onStart();
            return;
        } else if (this._mode === 'local') {
            // Local mode doesn't need API keys, just Ollama host
            if (!this._ollamaHost.trim()) {
                return;
            }
        }

        this.onStart();
    }

    triggerApiKeyError() {
        this._keyError = this._mode !== 'local' && this._mode !== 'trial';
        this.requestUpdate();
        setTimeout(() => {
            this._keyError = false;
            this.requestUpdate();
        }, 2000);
    }

    // ── Render helpers ──

    _renderMicSelect() {
        const devices = this._audioDevices || [];
        return html`
            <div class="form-group">
                <label class="form-label">${t('main.audio.mic_label')}</label>
                <select .value=${this._micDeviceId} @change=${e => this._saveMicDeviceId(e.target.value)}>
                    <option value="" ?selected=${!this._micDeviceId}>${t('main.audio.mic_default')}</option>
                    ${devices.map(d => html` <option value=${d.deviceId} ?selected=${this._micDeviceId === d.deviceId}>${d.label}</option> `)}
                </select>
                <div class="form-hint">${t('main.audio.mic_hint')}</div>
            </div>
        `;
    }

    _renderSystemAudioSelect() {
        const devices = this._audioDevices || [];
        return html`
            <div class="form-group">
                <label class="form-label">${t('main.audio.system_label')}</label>
                <select .value=${this._systemDeviceId} @change=${e => this._saveSystemDeviceId(e.target.value)}>
                    <option value="auto" ?selected=${this._systemDeviceId === 'auto'}>${t('main.audio.system_auto')}</option>
                    <option value="none" ?selected=${this._systemDeviceId === 'none'}>${t('main.audio.system_none')}</option>
                    ${devices.map(d => html` <option value=${d.deviceId} ?selected=${this._systemDeviceId === d.deviceId}>${d.label}</option> `)}
                </select>
                <div class="form-hint">${t('main.audio.system_hint')}</div>
            </div>
        `;
    }

    // ── Home redesign helpers ──

    // trial: 2 plain-language rows of "what happens when you start".
    _renderReassure() {
        const micIcon = html`<svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
        >
            <rect x="9" y="2" width="6" height="11" rx="3" />
            <path d="M5 10a7 7 0 0 0 14 0" />
            <path d="M12 17v4" />
            <path d="M8 21h8" />
        </svg>`;
        const barIcon = html`<svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.4"
            stroke-linecap="round"
            stroke-linejoin="round"
        >
            <path d="M5 20v-5" />
            <path d="M12 20V8" />
            <path d="M19 20v-9" />
        </svg>`;
        return html`
            <div class="reassure-list">
                <div class="reassure-row">${micIcon}<span>${t('main.reassure.mic')}</span></div>
                <div class="reassure-row">${barIcon}<span>${t('main.reassure.bar')}</span></div>
            </div>
        `;
    }

    // First-run Whisper download progress / retry (A3). Only shown when relevant.
    _renderWhisperStatus() {
        if (this.whisperDownloading) {
            const barState = (typeof window !== 'undefined' && window.whisperBarState) || (() => ({ indeterminate: true, percent: 0 }));
            const { indeterminate, percent } = barState(this.whisperProgress);
            const bar = indeterminate
                ? html`<div
                      class="whisper-bar whisper-bar--indeterminate"
                      role="progressbar"
                      aria-valuemin="0"
                      aria-valuemax="100"
                      aria-label=${t('main.whisper.downloading')}
                  >
                      <div class="whisper-bar__fill"></div>
                  </div>`
                : html`<div
                      class="whisper-bar"
                      role="progressbar"
                      aria-valuemin="0"
                      aria-valuemax="100"
                      aria-valuenow=${percent}
                      aria-label=${t('main.whisper.downloading')}
                      aria-valuetext=${this._whisperDownloadText(percent)}
                  >
                      <div class="whisper-bar__fill" style="width: ${percent}%"></div>
                  </div>`;
            return html`<div class="form-hint whisper-status">
                ${bar}
                <div class="whisper-status__text">${this._whisperDownloadText(percent)}</div>
            </div>`;
        }
        if (this.whisperError) {
            return html`<div class="form-hint">
                ${t('main.whisper.error')}
                <button class="mode-link" @click=${() => this.onStart()}>${t('main.button.retry')}</button>
            </div>`;
        }
        return '';
    }

    // Progressive disclosure: device config behind native <details>. The Whisper
    // model picker was removed — on a typical sales laptop only tiny keeps up with
    // real-time (A2 spike), so "choose quality" was a footgun; tiny is fixed.
    // trial = mic, byok = mic + system, local = mic + system.
    _renderAdvanced(mode) {
        const gearIcon = html`<svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
        >
            <circle cx="8" cy="6" r="2" />
            <path d="M2 6h4M10 6h12" />
            <circle cx="16" cy="12" r="2" />
            <path d="M2 12h12M18 12h4" />
            <circle cx="8" cy="18" r="2" />
            <path d="M2 18h4M10 18h12" />
        </svg>`;
        const chevron = html`<svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
        >
            <polyline points="6 9 12 15 18 9" />
        </svg>`;
        return html`
            <details class="advanced">
                <summary>
                    <span class="advanced-summary-left">${gearIcon}${t('main.advanced.title')}</span>
                    <span class="advanced-hint">${t('main.advanced.hint')} ${chevron}</span>
                </summary>
                <div class="advanced-body">
                    ${this._renderMicSelect()} ${mode !== 'trial' ? this._renderSystemAudioSelect() : ''}
                    ${mode === 'trial' ? html`<div class="form-hint">${t('main.advanced.accuracy_note')}</div>` : ''}
                </div>
            </details>
        `;
    }

    // Visible self-select cards (was buried text-links). Reuses .mode-card CSS.
    _renderModeCards() {
        const cards = [
            { mode: 'trial', title: t('main.mode_card.trial.title'), desc: t('main.mode_card.trial.desc'), experimental: false },
            { mode: 'byok', title: t('main.mode_card.byok.title'), desc: t('main.mode_card.byok.desc'), experimental: true },
            { mode: 'local', title: t('main.mode_card.local.title'), desc: t('main.mode_card.local.desc'), experimental: true },
        ];
        return html`
            <div class="mode-cards" role="radiogroup" aria-label=${t('main.divider.choose_mode')}>
                ${cards.map(
                    card => html`
                        <button
                            type="button"
                            class="mode-card ${this._mode === card.mode ? 'active' : ''}"
                            role="radio"
                            aria-checked=${this._mode === card.mode ? 'true' : 'false'}
                            @click=${() => this._saveMode(card.mode)}
                        >
                            ${this._mode === card.mode ? html`<span class="mode-badge">${t('main.mode_card.selected')}</span>` : ''}
                            <span class="mode-card-title">${card.title}</span>
                            ${card.experimental ? html`<span class="mode-card-tag">${t('main.mode_card.experimental_tag')}</span>` : ''}
                            <span class="mode-card-desc">${card.desc}</span>
                        </button>
                    `
                )}
            </div>
        `;
    }

    _renderStartButton() {
        const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;

        const cmdIcon = html`<svg
            xmlns="http://www.w3.org/2000/svg"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="3"
            stroke-linecap="round"
            stroke-linejoin="round"
        >
            <path
                d="M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3z"
            />
        </svg>`;
        const ctrlText = html`<span
            style="font-size: 11px; padding: 1px 5px; border: 1px solid currentColor; border-radius: 3px; line-height: 1; font-family: var(--font-mono);"
            >Ctrl</span
        >`;
        const enterIconMac = html`<svg
            xmlns="http://www.w3.org/2000/svg"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="3"
            stroke-linecap="round"
            stroke-linejoin="round"
        >
            <path d="M9 10l-5 5 5 5" />
            <path d="M20 4v7a4 4 0 0 1-4 4H4" />
        </svg>`;
        const enterText = html`<span
            style="font-size: 11px; padding: 1px 5px; border: 1px solid currentColor; border-radius: 3px; line-height: 1; font-family: var(--font-mono);"
            >Enter</span
        >`;

        return html`
            <button class="start-button ${this.isInitializing ? 'disabled' : ''}" @click=${() => this._handleStart()}>
                <span class="btn-label">
                    ${t('main.button.start_session')}
                    <span class="shortcut-hint">${isMac ? html`${cmdIcon}${enterIconMac}` : html`${ctrlText}+${enterText}`}</span>
                </span>
            </button>
        `;
    }

    _renderDivider() {
        return html`
            <div class="divider">
                <div class="divider-line"></div>
                <span class="divider-text">${t('main.divider.choose_mode')}</span>
                <div class="divider-line"></div>
            </div>
        `;
    }

    // ── Cloud mode ──
    // Cloud UI intentionally disabled. Backend cloud wiring is still present in
    // the codebase, but the renderer no longer exposes this setup path.

    // ── BYOK mode ──

    _whisperDownloadText(percent) {
        const p = this.whisperProgress;
        if (p && p.totalBytes > 0) {
            return t('main.whisper.downloading_pct').replace('{percent}', percent).replace('{loaded}', p.loadedMB).replace('{total}', p.totalMB);
        }
        return t('main.whisper.downloading');
    }

    _renderTrialMode() {
        // Zero-input default path: reassurance → big Start → (download status if
        // any) → advanced (hidden) → choose-mode cards. No config up front.
        return html`
            ${this._renderReassure()} ${this._renderStartButton()}
            <button class="trial-to-byok" @click=${this._switchToByokWithWizard}>${t('main.trial.go_byok')}</button>
            ${this._renderWhisperStatus()} ${this._renderAdvanced('trial')} ${this._renderDivider()} ${this._renderModeCards()}
        `;
    }

    _renderByokMode() {
        return html`
            <button class="wizard-entry" @click=${this._openWizard}>${t('wizard.entry_button')}</button>
            <div class="wizard-or">${t('wizard.or_direct')}</div>
            ${
                this._credSessionOnly
                    ? html`<div class="form-group help-warn" role="note">
                          <strong>${t('credentials.session_only.title')}</strong><br />${t('credentials.session_only.body')}
                      </div>`
                    : ''
            }
            <div class="form-group">
                <label class="form-label">${t('main.api.gemini_label')}</label>
                <input
                    type="password"
                    placeholder="${t('main.api.placeholder.required')}"
                    .value=${this._geminiKey}
                    @input=${e => this._saveGeminiKey(e.target.value)}
                    class=${this._keyError ? 'error' : ''}
                />
                <div class="form-hint">
                    <span class="link" @click=${() => this.onExternalLink('https://aistudio.google.com/apikey')}>${t('main.api.gemini_get')}</span>
                </div>
                ${this._renderGeminiKeyStatus()}
            </div>

            <div class="form-group">
                <label class="form-label">${t('main.api.deepgram_label')}</label>
                <input
                    type="password"
                    placeholder="${t('main.api.placeholder.optional')}"
                    .value=${this._deepgramKey}
                    @input=${e => this._saveDeepgramKey(e.target.value)}
                />
                <div class="form-hint">
                    <span class="link" @click=${() => this.onExternalLink('https://console.deepgram.com/')}>${t('main.api.deepgram_get')}</span>
                </div>
                <div class="form-hint">${t('main.api.deepgram_consent')}</div>
                ${this._renderDeepgramKeyStatus()}
            </div>

            ${this._renderStartButton()} ${this._renderAdvanced('byok')} ${this._renderDivider()} ${this._renderModeCards()}
            ${
                this._wizardOpen
                    ? html`<key-wizard
                          .geminiKey=${this._geminiKey}
                          .deepgramKey=${this._deepgramKey}
                          .onExternalLink=${this.onExternalLink}
                          @key-entered=${this._onWizardKeyEntered}
                          @wizard-close=${() => {
                              this._wizardOpen = false;
                              this.requestUpdate();
                          }}
                      ></key-wizard>`
                    : ''
            }
        `;
    }

    // ── Local AI mode ──

    _renderLocalMode() {
        return html`
            <div class="form-group">
                <label class="form-label">Ollama Host</label>
                <input
                    type="text"
                    placeholder="http://127.0.0.1:11434"
                    .value=${this._ollamaHost}
                    @input=${e => this._saveOllamaHost(e.target.value)}
                />
                <div class="form-hint">Ollama must be running locally</div>
            </div>

            <div class="form-group">
                <label class="form-label">Ollama Model</label>
                <input type="text" placeholder="gemma3:4b" .value=${this._ollamaModel} @input=${e => this._saveOllamaModel(e.target.value)} />
                <div class="form-hint">
                    Run
                    <code
                        style="font-family: var(--font-mono); font-size: 11px; background: var(--bg-elevated); padding: 1px 4px; border-radius: 3px;"
                        >ollama pull ${this._ollamaModel}</code
                    >
                    first
                </div>
            </div>

            ${this._renderStartButton()} ${this._renderWhisperStatus()} ${this._renderAdvanced('local')} ${this._renderDivider()}
            ${this._renderModeCards()}
        `;
    }

    // ── Main render ──

    render() {
        const helpIcon = html`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
            <g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2">
                <path d="M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0m9 5v.01" />
                <path d="M12 13.5a1.5 1.5 0 0 1 1-1.5a2.6 2.6 0 1 0-3-4" />
            </g>
        </svg>`;
        const closeIcon = html`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
            <path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18 6L6 18M6 6l12 12" />
        </svg>`;

        return html`
            <div class="mv-aurora-layer">
                <canvas class="mv-aurora"></canvas>
            </div>
            <div class="form-wrapper">
                <!-- Stable frame: brand + value line never shift with mode. -->
                <div class="title-row">
                    <div class="page-title">${brandMark(22)} <span>WhisperOhKAMI</span></div>
                    ${
                        this._mode === 'local'
                            ? html`<button
                                  class="help-btn"
                                  @click=${() => {
                                      this._showLocalHelp = !this._showLocalHelp;
                                  }}
                              >
                                  ${this._showLocalHelp ? closeIcon : helpIcon}
                              </button>`
                            : ''
                    }
                </div>
                <div class="page-subtitle">${t('main.subtitle.app')}</div>

                <!-- Cloud mode render branch intentionally disabled. -->
                ${this._mode === 'trial' ? this._renderTrialMode() : ''} ${this._mode === 'byok' ? this._renderByokMode() : ''}
                ${this._mode === 'local' ? (this._showLocalHelp ? this._renderLocalHelp() : this._renderLocalMode()) : ''}
            </div>
        `;
    }

    _renderLocalHelp() {
        const ollamaLink = html`<span class="help-link" @click=${() => this.onExternalLink('https://ollama.com/download')}
            >ollama.com/download</span
        >`;
        return html`
            <div class="help-content">
                <div class="help-section">
                    <div class="help-section-title">${t('local_ai_help.intro.title')}</div>
                    <div class="help-section-text">${t('local_ai_help.intro.body')}</div>
                </div>

                <div class="help-section">
                    <div class="help-section-title">${t('local_ai_help.install.title')}</div>
                    <div class="help-section-text">
                        ${t('local_ai_help.install.before_link')}${ollamaLink}${t('local_ai_help.install.after_link')}
                    </div>
                </div>

                <div class="help-section">
                    <div class="help-section-title">${t('local_ai_help.must_run.title')}</div>
                    <div class="help-section-text">${t('local_ai_help.must_run.body')}</div>
                    <code class="help-code">ollama serve</code>
                </div>

                <div class="help-section">
                    <div class="help-section-title">${t('local_ai_help.pull.title')}</div>
                    <div class="help-section-text">${t('local_ai_help.pull.body')}</div>
                    <code class="help-code">ollama pull gemma3:4b</code>
                </div>

                <div class="help-section">
                    <div class="help-section-title">${t('local_ai_help.models.title')}</div>
                    <div class="help-models">
                        <div class="help-model">
                            <span class="help-model-name">gemma3:4b</span><span>${t('local_ai_help.models.gemma_desc')}</span>
                        </div>
                        <div class="help-model">
                            <span class="help-model-name">mistral-small</span><span>${t('local_ai_help.models.mistral_desc')}</span>
                        </div>
                    </div>
                    <div class="help-section-text">${t('local_ai_help.models.image_note')}</div>
                </div>

                <div class="help-section">
                    <div class="help-warn">${t('local_ai_help.thinking_warn')}</div>
                </div>

                <div class="help-section">
                    <div class="help-section-title">${t('local_ai_help.whisper.title')}</div>
                    <div class="help-section-text">${t('local_ai_help.whisper.body')}</div>
                </div>

                <hr class="help-divider" />

                <div class="help-section">
                    <div class="help-section-title">${t('local_ai_help.slow.title')}</div>
                    <div class="help-section-text">${t('local_ai_help.slow.body')}</div>
                </div>

                <button
                    class="help-cloud-btn"
                    @click=${() => {
                        this._showLocalHelp = false;
                        this._saveMode('byok');
                    }}
                >
                    ${t('local_ai_help.switch_byok_btn')}
                </button>
            </div>
        `;
    }
}

customElements.define('main-view', MainView);
