import { html, css, LitElement } from '../../assets/lit-core-2.7.4.min.js';
import { brandMark } from '../../assets/brand-mark.js';
import { MainView } from '../views/MainView.js';
import { CustomizeView } from '../views/CustomizeView.js';
import { HelpView } from '../views/HelpView.js';
import { HistoryView } from '../views/HistoryView.js';
import { AssistantView } from '../views/AssistantView.js';
import { OnboardingView } from '../views/OnboardingView.js';
import { AICustomizeView } from '../views/AICustomizeView.js';
import { FeedbackView } from '../views/FeedbackView.js';

export class CheatingDaddyApp extends LitElement {
    static styles = css`
        * {
            box-sizing: border-box;
            font-family: var(--font);
            margin: 0;
            padding: 0;
            cursor: default;
            user-select: none;
        }

        :host {
            display: block;
            width: 100%;
            height: 100vh;
            background: var(--bg-app);
            color: var(--text-primary);
        }

        /* ── Full app shell: top bar + sidebar/content ── */

        .app-shell {
            display: flex;
            height: 100vh;
            overflow: hidden;
        }

        .top-drag-bar {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            z-index: 9999;
            display: flex;
            align-items: center;
            height: 38px;
            background: transparent;
        }

        .drag-region {
            flex: 1;
            height: 100%;
            -webkit-app-region: drag;
        }

        .top-drag-bar.hidden {
            display: none;
        }

        .window-controls {
            display: flex;
            align-items: center;
            height: 100%;
            -webkit-app-region: no-drag;
        }

        .win-control {
            width: 46px;
            height: 32px;
            border: none;
            background: transparent;
            color: var(--text-primary, #ffffff);
            cursor: pointer;
            padding: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            transition:
                background 0.1s ease,
                color 0.1s ease;
        }

        .win-control svg {
            width: 14px;
            height: 14px;
        }

        .win-control.hide:hover {
            background: rgba(255, 255, 255, 0.1);
        }

        .win-control.close:hover {
            background: #e81123;
            color: #ffffff;
        }

        .sidebar {
            width: var(--sidebar-width);
            min-width: var(--sidebar-width);
            background: var(--bg-surface);
            border-right: 1px solid var(--border);
            display: flex;
            flex-direction: column;
            padding: 42px 0 var(--space-md) 0;
            transition:
                width var(--transition),
                min-width var(--transition),
                opacity var(--transition);
        }

        .sidebar.hidden {
            width: 0;
            min-width: 0;
            padding: 0;
            overflow: hidden;
            border-right: none;
            opacity: 0;
        }

        /* ── Auto-collapse to icon-only at narrow windows ──
           Electron 最小幅 700px だが sidebar 200px 級 + form 420px 級が並ぶ
           と main content が窮屈になるので、820px 以下では icon-only に
           折りたたむ。ラベル要素は <span class="nav-item-label"> 等で
           wrap し、ここで display: none する。
           .sidebar.hidden (live mode) は別状態なので除外。 */
        @media (max-width: 820px) {
            .sidebar:not(.hidden) {
                width: var(--sidebar-width-collapsed);
                min-width: var(--sidebar-width-collapsed);
            }
            .sidebar:not(.hidden) .sidebar-brand {
                padding: var(--space-md) 0 var(--space-md) 0;
                margin-bottom: var(--space-md);
                justify-content: center;
                gap: 0;
            }
            .sidebar:not(.hidden) .sidebar-brand h1 {
                display: none;
            }
            .sidebar:not(.hidden) .nav-item {
                padding: var(--space-sm);
                justify-content: center;
                gap: 0;
            }
            .sidebar:not(.hidden) .nav-item-label {
                display: none;
            }
            .sidebar:not(.hidden) .update-btn {
                padding: var(--space-sm);
                justify-content: center;
                gap: 0;
            }
            .sidebar:not(.hidden) .update-btn-label {
                display: none;
            }
            .sidebar:not(.hidden) .version-text {
                font-size: 9px;
                text-align: center;
            }
            .sidebar:not(.hidden) .sidebar-collapse-toggle {
                padding: var(--space-sm);
                justify-content: center;
                gap: 0;
            }
            .sidebar:not(.hidden) .sidebar-collapse-toggle-label {
                display: none;
            }
        }

        /* ── User-pinned collapse override ──
           Mirrors the @media (max-width: 820px) icon-only rules but applies at any
           window width when the user has explicitly collapsed via the toggle button.
           CSS doesn't allow combining @media + class selectors in one rule, so the
           rules are duplicated. .sidebar.hidden (live mode) still takes precedence. */
        .sidebar.user-collapsed:not(.hidden) {
            width: var(--sidebar-width-collapsed);
            min-width: var(--sidebar-width-collapsed);
        }
        .sidebar.user-collapsed:not(.hidden) .sidebar-brand {
            padding: var(--space-md) 0 var(--space-md) 0;
            margin-bottom: var(--space-md);
            justify-content: center;
            gap: 0;
        }
        .sidebar.user-collapsed:not(.hidden) .sidebar-brand h1 {
            display: none;
        }
        .sidebar.user-collapsed:not(.hidden) .nav-item {
            padding: var(--space-sm);
            justify-content: center;
            gap: 0;
        }
        .sidebar.user-collapsed:not(.hidden) .nav-item-label {
            display: none;
        }
        .sidebar.user-collapsed:not(.hidden) .update-btn {
            padding: var(--space-sm);
            justify-content: center;
            gap: 0;
        }
        .sidebar.user-collapsed:not(.hidden) .update-btn-label {
            display: none;
        }
        .sidebar.user-collapsed:not(.hidden) .version-text {
            font-size: 9px;
            text-align: center;
        }
        .sidebar.user-collapsed:not(.hidden) .sidebar-collapse-toggle {
            padding: var(--space-sm);
            justify-content: center;
            gap: 0;
        }
        .sidebar.user-collapsed:not(.hidden) .sidebar-collapse-toggle-label {
            display: none;
        }

        .sidebar-brand {
            display: flex;
            align-items: center;
            gap: var(--space-sm);
            padding: var(--space-sm) var(--space-lg);
            padding-top: var(--space-md);
            margin-bottom: var(--space-lg);
            color: var(--text-primary);
        }

        .sidebar-brand h1 {
            font-size: var(--font-size-sm);
            font-weight: var(--font-weight-semibold);
            color: var(--text-primary);
        }

        .sidebar-brand svg {
            flex-shrink: 0;
        }

        .sidebar-nav {
            flex: 1;
            display: flex;
            flex-direction: column;
            gap: var(--space-xs);
            padding: 0 var(--space-sm);
            -webkit-app-region: no-drag;
        }

        .nav-item {
            display: flex;
            align-items: center;
            gap: var(--space-sm);
            padding: var(--space-sm) var(--space-md);
            border-radius: var(--radius-md);
            color: var(--text-secondary);
            font-size: var(--font-size-sm);
            font-weight: var(--font-weight-medium);
            cursor: pointer;
            transition:
                color var(--transition),
                background var(--transition);
            border: none;
            background: none;
            width: 100%;
            text-align: left;
        }

        .nav-item:hover {
            color: var(--text-primary);
            background: var(--bg-hover);
        }

        .nav-item.active {
            color: var(--text-primary);
            background: var(--bg-elevated);
        }

        .nav-item svg {
            width: 20px;
            height: 20px;
            flex-shrink: 0;
        }

        .sidebar-footer {
            padding: var(--space-sm);
            margin-top: var(--space-sm);
            -webkit-app-region: no-drag;
        }

        .update-btn {
            display: flex;
            align-items: center;
            gap: var(--space-sm);
            width: 100%;
            padding: var(--space-sm) var(--space-md);
            border-radius: var(--radius-md);
            border: 1px solid rgba(239, 68, 68, 0.2);
            background: rgba(239, 68, 68, 0.08);
            color: var(--danger);
            font-size: var(--font-size-sm);
            font-weight: var(--font-weight-medium);
            cursor: pointer;
            text-align: left;
            transition:
                background var(--transition),
                border-color var(--transition);
            animation: update-wobble 5s ease-in-out infinite;
        }

        .update-btn:hover {
            background: rgba(239, 68, 68, 0.14);
            border-color: rgba(239, 68, 68, 0.35);
        }

        @keyframes update-wobble {
            0%,
            90%,
            100% {
                transform: rotate(0deg);
            }
            92% {
                transform: rotate(-2deg);
            }
            94% {
                transform: rotate(2deg);
            }
            96% {
                transform: rotate(-1.5deg);
            }
            98% {
                transform: rotate(1.5deg);
            }
        }

        .update-btn svg {
            width: 20px;
            height: 20px;
            flex-shrink: 0;
        }

        .version-text {
            font-size: var(--font-size-xs);
            color: var(--text-muted);
            padding: var(--space-xs) var(--space-md);
        }

        .sidebar-collapse-toggle {
            display: flex;
            align-items: center;
            gap: var(--space-sm);
            width: 100%;
            padding: var(--space-sm) var(--space-md);
            margin-bottom: var(--space-xs);
            border-radius: var(--radius-md);
            border: none;
            background: none;
            color: var(--text-muted);
            font-size: var(--font-size-sm);
            font-weight: var(--font-weight-medium);
            cursor: pointer;
            text-align: left;
            transition:
                color var(--transition),
                background var(--transition);
        }

        .sidebar-collapse-toggle:hover {
            color: var(--text-primary);
            background: var(--bg-hover);
        }

        .sidebar-collapse-toggle svg {
            width: 16px;
            height: 16px;
            flex-shrink: 0;
        }

        /* ── Main content area ── */

        .content {
            flex: 1;
            overflow: hidden;
            display: flex;
            flex-direction: column;
            background: var(--bg-app);
        }

        /* Live mode top bar */
        .live-bar {
            position: relative;
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0 var(--space-md);
            background: var(--bg-surface);
            border-bottom: 1px solid var(--border);
            height: 36px;
            -webkit-app-region: drag;
        }

        .live-bar-left {
            display: flex;
            align-items: center;
            -webkit-app-region: no-drag;
            z-index: 1;
        }

        .live-bar-back {
            display: flex;
            align-items: center;
            justify-content: center;
            color: var(--text-muted);
            cursor: pointer;
            background: none;
            border: none;
            padding: var(--space-xs);
            border-radius: var(--radius-sm);
            transition: color var(--transition);
        }

        .live-bar-back:hover {
            color: var(--text-primary);
        }

        .live-bar-back svg {
            width: 14px;
            height: 14px;
        }

        .live-bar-center {
            position: absolute;
            left: 50%;
            transform: translateX(-50%);
            font-size: var(--font-size-xs);
            color: var(--text-muted);
            font-weight: var(--font-weight-medium);
            white-space: nowrap;
            pointer-events: none;
        }

        .live-bar-right {
            display: flex;
            align-items: center;
            gap: var(--space-md);
            -webkit-app-region: no-drag;
            z-index: 1;
        }

        .live-bar-text {
            font-size: var(--font-size-xs);
            color: var(--text-muted);
            font-family: var(--font-mono);
            white-space: nowrap;
        }

        .live-bar-text.clickable {
            cursor: pointer;
            transition: color var(--transition);
        }

        .live-bar-text.clickable:hover {
            color: var(--text-primary);
        }

        .live-bar-badge {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 1px 8px;
            border-radius: var(--radius-sm);
            font-size: var(--font-size-xs);
            font-family: var(--font-mono);
            border: 1px solid var(--border);
            background: var(--bg-elevated);
            color: var(--text-muted);
            white-space: nowrap;
        }

        .live-bar-badge.stt-cloud {
            color: var(--text-secondary);
        }

        .live-bar-badge.stt-hybrid {
            color: var(--accent);
            border-color: var(--accent);
        }

        .live-bar-badge.stt-local {
            color: var(--success);
            border-color: var(--success);
        }

        /* Content inner */
        .content-inner {
            flex: 1;
            overflow-y: auto;
            overflow-x: hidden;
        }

        .content-inner.live {
            overflow: hidden;
            display: flex;
            flex-direction: column;
        }

        .diagnostic-panel {
            margin: var(--space-md) var(--space-md) 0;
            padding: 12px 14px;
            border: 1px solid rgba(214, 69, 69, 0.35);
            border-left: 4px solid var(--danger);
            border-radius: var(--radius-md);
            background: rgba(214, 69, 69, 0.06);
            color: var(--text-primary);
            -webkit-app-region: no-drag;
        }

        .diagnostic-header {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: var(--space-md);
            margin-bottom: 6px;
        }

        .diagnostic-title {
            font-size: var(--font-size-sm);
            font-weight: 700;
            line-height: var(--line-height-tight);
        }

        .diagnostic-close {
            border: none;
            background: transparent;
            color: var(--text-muted);
            font-size: var(--font-size-xs);
            cursor: pointer;
            padding: 0;
        }

        .diagnostic-body {
            display: flex;
            flex-direction: column;
            gap: 4px;
            font-size: var(--font-size-sm);
            line-height: var(--line-height-reading);
            color: var(--text-secondary);
        }

        .diagnostic-detail {
            font-family: var(--font-mono);
            font-size: var(--font-size-xs);
            color: var(--text-muted);
            overflow-wrap: anywhere;
        }

        .diagnostic-link {
            color: var(--accent);
            cursor: pointer;
            text-decoration: underline;
        }

        /* Onboarding fills everything */
        .fullscreen {
            position: fixed;
            inset: 0;
            z-index: 100;
            background: var(--bg-app);
        }

        /* ── Recording-consent modal (replaces window.confirm — see
           confirmRecordingConsent()) ── */
        .consent-overlay {
            position: fixed;
            inset: 0;
            z-index: 10000;
            display: flex;
            align-items: center;
            justify-content: center;
            background: rgba(0, 0, 0, 0.45);
            -webkit-app-region: no-drag;
        }

        .consent-card {
            width: min(360px, calc(100vw - 48px));
            background: var(--bg-elevated);
            border: 1px solid var(--border-strong);
            border-radius: var(--radius-lg);
            padding: var(--space-lg);
            box-shadow: 0 12px 32px rgba(0, 0, 0, 0.3);
        }

        .consent-message {
            font-size: var(--font-size-sm);
            line-height: var(--line-height-reading);
            color: var(--text-primary);
            white-space: pre-line;
            margin-bottom: var(--space-lg);
        }

        .consent-actions {
            display: flex;
            justify-content: flex-end;
            gap: var(--space-sm);
        }

        .consent-btn {
            cursor: pointer;
            padding: 8px 16px;
            border-radius: var(--radius-sm);
            font-size: var(--font-size-sm);
            font-weight: var(--font-weight-semibold);
            border: 1px solid transparent;
            transition:
                background var(--transition),
                border-color var(--transition);
        }

        .consent-btn-secondary {
            background: transparent;
            border-color: var(--border-strong);
            color: var(--text-secondary);
        }

        .consent-btn-secondary:hover {
            background: var(--bg-hover);
        }

        .consent-btn-primary {
            background: var(--accent);
            border-color: var(--accent);
            color: #ffffff;
        }

        .consent-btn-primary:hover {
            background: var(--accent-hover);
            border-color: var(--accent-hover);
        }

        /* Pre-start constraint modal for 検証中 modes (byok / local) — reuses
           the consent-overlay / consent-card / consent-btn styles above. */
        .experimental-title {
            font-size: var(--font-size-sm);
            font-weight: var(--font-weight-semibold);
            color: var(--text-primary);
            margin-bottom: var(--space-sm);
        }

        .experimental-intro {
            margin-bottom: 0;
        }

        .experimental-list {
            margin: var(--space-sm) 0 var(--space-lg);
            padding-left: 1.2em;
            font-size: var(--font-size-sm);
            line-height: var(--line-height-reading);
            color: var(--text-primary);
        }

        .experimental-list li + li {
            margin-top: 4px;
        }

        .consent-btn:focus-visible {
            outline: 2px solid var(--accent);
            outline-offset: 2px;
        }

        ::-webkit-scrollbar {
            width: 6px;
            height: 6px;
        }

        ::-webkit-scrollbar-track {
            background: transparent;
        }

        ::-webkit-scrollbar-thumb {
            background: var(--border-strong);
            border-radius: 3px;
        }

        ::-webkit-scrollbar-thumb:hover {
            background: #444444;
        }
    `;

    static properties = {
        currentView: { type: String },
        statusText: { type: String },
        startTime: { type: Number },
        isRecording: { type: Boolean },
        sessionActive: { type: Boolean },
        selectedProfile: { type: String },
        selectedLanguage: { type: String },
        responses: { type: Array },
        currentResponseIndex: { type: Number },
        selectedScreenshotInterval: { type: String },
        selectedImageQuality: { type: String },
        layoutMode: { type: String },
        sttMode: { type: String },
        _viewInstances: { type: Object, state: true },
        _isClickThrough: { state: true },
        _awaitingNewResponse: { state: true },
        shouldAnimateResponse: { type: Boolean },
        _storageLoaded: { state: true },
        _updateAvailable: { state: true },
        _whisperDownloading: { state: true },
        _whisperProgress: { state: true },
        _whisperError: { state: true },
        _sidebarUserCollapsed: { state: true },
        _diagnostic: { state: true },
        _recordingConsentOpen: { state: true },
        _experimentalOpen: { state: true },
        _experimentalMode: { state: true },
    };

    constructor() {
        super();
        this.currentView = 'main';
        this.statusText = '';
        this.startTime = null;
        this.isRecording = false;
        this.sessionActive = false;
        this.selectedProfile = 'sales';
        this.selectedLanguage = 'ja-JP';
        this.selectedScreenshotInterval = '5';
        this.selectedImageQuality = 'medium';
        this.layoutMode = 'normal';
        this.sttMode = 'local';
        this._sessionProviderMode = null;
        this.responses = [];
        this.currentResponseIndex = -1;
        this._viewInstances = new Map();
        this._isClickThrough = false;
        this._awaitingNewResponse = false;
        this._currentResponseIsComplete = true;
        this.shouldAnimateResponse = false;
        this._storageLoaded = false;
        this._timerInterval = null;
        this._updateAvailable = false;
        this._whisperDownloading = false;
        this._whisperProgress = null;
        this._whisperError = false;
        this._localVersion = '';
        this._sidebarUserCollapsed = false;
        this._diagnostic = null;

        // Recording-consent modal state — see confirmRecordingConsent().
        // RecordingConsentGate is loaded as a plain <script> global (see
        // src/utils/recordingConsentGate.js + index.html), same pattern as
        // whisperBarState / discoveryPhase. Guarded so a headless / test
        // environment without that global fails closed instead of throwing.
        const ConsentGate = (typeof window !== 'undefined' && window.RecordingConsentGate) || null;
        this._recordingConsentGate = ConsentGate ? new ConsentGate() : null;
        this._recordingConsentOpen = false;

        // 検証中-mode constraint modal — see confirmExperimentalMode(). A
        // second, independent instance of the same generic gate (no new state
        // machine); same fail-closed guard when the global is missing.
        this._experimentalGate = ConsentGate ? new ConsentGate() : null;
        this._experimentalOpen = false;
        this._experimentalMode = null;

        this._loadFromStorage();
        this._checkForUpdates();
    }

    async _checkForUpdates() {
        // The update check points at the LP (Cloudflare Pages) sales
        // infrastructure, not the GitHub Releases REST API: the source repo
        // is private, so that endpoint always 404ed and no purchaser ever
        // saw an update notice. `/api/release/latest` reads
        // the same D1 `artifact_channels` row that `/api/download` already
        // uses as the entitlement source of truth, so activating a release
        // there (see docs/operations/paid-build-release.md §8) makes this
        // check follow automatically. Before any release has been activated,
        // or on any network hiccup, the endpoint 404s and this silently
        // no-ops — same fail-quiet shape as before.
        const RELEASE_API = 'https://whisperohkami.pages.dev/api/release/latest';
        try {
            this._localVersion = await whisperOhKami.getVersion();
            this.requestUpdate();

            const res = await fetch(RELEASE_API);
            if (!res.ok) return;
            const release = await res.json();
            const remoteVersion = String(release.version || '').replace(/^v/, '');
            if (!remoteVersion) return;

            const toNum = v =>
                String(v)
                    .replace(/^v/, '')
                    .split('.')
                    .map(n => parseInt(n, 10) || 0);
            const [rMaj, rMin, rPatch] = toNum(remoteVersion);
            const [lMaj, lMin, lPatch] = toNum(this._localVersion);

            if (rMaj > lMaj || (rMaj === lMaj && rMin > lMin) || (rMaj === lMaj && rMin === lMin && rPatch > lPatch)) {
                this._updateAvailable = true;
                this.requestUpdate();
            }
        } catch (e) {
            // silently ignore (offline / LP unreachable / no release activated yet)
        }
    }

    async _loadFromStorage() {
        try {
            const [config, prefs] = await Promise.all([whisperOhKami.storage.getConfig(), whisperOhKami.storage.getPreferences()]);

            this.currentView = config.onboarded ? 'main' : 'onboarding';
            // Only discovery / sales ship today. Sanitize any legacy stored
            // profile (interview / meeting / exam / …) to 'sales' so the picker
            // and prompt never reference a removed profile.
            this.selectedProfile = ['discovery', 'sales'].includes(prefs.selectedProfile) ? prefs.selectedProfile : 'sales';
            this.selectedLanguage = prefs.selectedLanguage || 'ja-JP';
            this.selectedScreenshotInterval = prefs.selectedScreenshotInterval || '5';
            this.selectedImageQuality = prefs.selectedImageQuality || 'medium';
            this.layoutMode = config.layout || 'normal';
            this.sttMode = ['cloud', 'local'].includes(prefs.sttMode) ? prefs.sttMode : 'local';
            this._sidebarUserCollapsed = !!prefs.sidebarUserCollapsed;

            this._storageLoaded = true;
            this.requestUpdate();
        } catch (error) {
            console.error('Error loading from storage:', error);
            this._storageLoaded = true;
            this.requestUpdate();
        }
    }

    connectedCallback() {
        super.connectedCallback();

        if (window.require) {
            const { ipcRenderer } = window.require('electron');
            ipcRenderer.on('new-response', (_, response) => this.addNewResponse(response));
            ipcRenderer.on('update-response', (_, response) => this.updateCurrentResponse(response));
            ipcRenderer.on('update-status', (_, status) => this.setStatus(status));
            ipcRenderer.on('app-diagnostic', (_, diagnostic) => this.showDiagnostic(diagnostic));
            ipcRenderer.on('click-through-toggled', (_, isEnabled) => {
                this._isClickThrough = isEnabled;
            });
            ipcRenderer.on('reconnect-failed', (_, data) => this.addNewResponse(data.message));
            ipcRenderer.on('whisper-downloading', (_, downloading) => {
                this._whisperDownloading = downloading;
                if (downloading) this._whisperError = false;
            });
            ipcRenderer.on('whisper-download-progress', (_, progress) => {
                this._whisperProgress = progress;
            });
            ipcRenderer.on('whisper-download-error', () => {
                this._whisperError = true;
            });
        }
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        this._stopTimer();
        if (window.require) {
            const { ipcRenderer } = window.require('electron');
            ipcRenderer.removeAllListeners('new-response');
            ipcRenderer.removeAllListeners('update-response');
            ipcRenderer.removeAllListeners('update-status');
            ipcRenderer.removeAllListeners('app-diagnostic');
            ipcRenderer.removeAllListeners('click-through-toggled');
            ipcRenderer.removeAllListeners('reconnect-failed');
            ipcRenderer.removeAllListeners('whisper-downloading');
            ipcRenderer.removeAllListeners('whisper-download-progress');
            ipcRenderer.removeAllListeners('whisper-download-error');
        }
    }

    // ── Timer ──

    _startTimer() {
        this._stopTimer();
        if (this.startTime) {
            this._timerInterval = setInterval(() => this.requestUpdate(), 1000);
        }
    }

    _stopTimer() {
        if (this._timerInterval) {
            clearInterval(this._timerInterval);
            this._timerInterval = null;
        }
    }

    getElapsedTime() {
        if (!this.startTime) return '0:00';
        const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
        const h = Math.floor(elapsed / 3600);
        const m = Math.floor((elapsed % 3600) / 60);
        const s = elapsed % 60;
        const pad = n => String(n).padStart(2, '0');
        if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
        return `${m}:${pad(s)}`;
    }

    // ── Status & Responses ──

    setStatus(text) {
        this.statusText = text;
        if (text.includes('Ready') || text.includes('Listening') || text.includes('Error')) {
            this._currentResponseIsComplete = true;
        }
    }

    showDiagnostic(diagnostic) {
        if (!diagnostic || !diagnostic.code) return;
        const code = diagnostic.code;
        this._diagnostic = {
            ...diagnostic,
            titleKey: diagnostic.titleKey || `diagnostic.${code}.title`,
            causeKey: diagnostic.causeKey || `diagnostic.${code}.cause`,
            actionKey: diagnostic.actionKey || `diagnostic.${code}.action`,
        };
        this.requestUpdate();
    }

    clearDiagnostic() {
        this._diagnostic = null;
        this.requestUpdate();
    }

    addNewResponse(response) {
        const wasOnLatest = this.currentResponseIndex === this.responses.length - 1;
        this.responses = [...this.responses, response];
        if (wasOnLatest || this.currentResponseIndex === -1) {
            this.currentResponseIndex = this.responses.length - 1;
        }
        this._awaitingNewResponse = false;
        this.requestUpdate();
    }

    updateCurrentResponse(response) {
        if (this.responses.length > 0) {
            this.responses = [...this.responses.slice(0, -1), response];
        } else {
            this.addNewResponse(response);
        }
        this.requestUpdate();
    }

    // ── Navigation ──

    navigate(view) {
        this.currentView = view;
        this.requestUpdate();
    }

    async handleClose() {
        if (this.currentView === 'assistant') {
            whisperOhKami.stopCapture();
            if (window.require) {
                const { ipcRenderer } = window.require('electron');
                await ipcRenderer.invoke('close-session');
            }
            this.sessionActive = false;
            this._stopTimer();
            this.currentView = 'main';
        } else {
            if (window.require) {
                const { ipcRenderer } = window.require('electron');
                await ipcRenderer.invoke('quit-application');
            }
        }
    }

    async _handleMinimize() {
        if (window.require) {
            const { ipcRenderer } = window.require('electron');
            await ipcRenderer.invoke('window-minimize');
        }
    }

    async handleHideToggle() {
        if (window.require) {
            const { ipcRenderer } = window.require('electron');
            await ipcRenderer.invoke('toggle-window-visibility');
        }
    }

    // ── Session start ──

    // Phase 1g (post-3.8): recording-consent gate. Per ROADMAP v3 short-term
    // #4 — block both UI Start and the ctrl/cmd+enter keyboard shortcut from
    // spinning up provider init or capture without an explicit confirm.
    //
    // Originally used window.confirm(). In the packaged, transparent /
    // frameless overlay window, Windows renders window.confirm() as a
    // body-less, button-less ~160x28px dialog placed off-screen instead of a
    // real prompt, and the renderer blocks synchronously on it — every
    // session start looked frozen until that invisible dialog was dismissed.
    // Replaced with an in-app Lit modal (rendered via _renderRecordingConsent(),
    // driven by RecordingConsentGate — src/utils/recordingConsentGate.js —
    // which owns the Promise<boolean> + de-dup state machine so it stays
    // unit-testable without Lit/DOM). Persistent consent log, audit trail,
    // and regional legal text are still deferred to long-term Phase 0'
    // (法務確認枠 / individual-sale launch prep).
    //
    // Extracted into a method so tests / Phase 0' replacement can override
    // without touching handleStart's downstream branching.
    async confirmRecordingConsent() {
        if (!this._recordingConsentGate) {
            // Headless / test environments without the gate global loaded:
            // fail-closed (treat as not consented) so capture cannot start
            // unattended.
            return false;
        }
        return this._recordingConsentGate.request(() => {
            if (!this.shadowRoot) {
                // Fail-closed: nothing to render the modal into.
                throw new Error('recording consent modal unavailable (no shadowRoot)');
            }
            this._recordingConsentOpen = true;
            this.requestUpdate();
        });
    }

    // Called by the modal's primary button (and Enter, via native <button>
    // keyboard activation once it is focused).
    _acceptRecordingConsent() {
        this._recordingConsentOpen = false;
        if (this._recordingConsentGate) this._recordingConsentGate.accept();
        this.requestUpdate();
    }

    // Called by the modal's secondary button and by Escape.
    _cancelRecordingConsent() {
        this._recordingConsentOpen = false;
        if (this._recordingConsentGate) this._recordingConsentGate.cancel();
        this.requestUpdate();
    }

    _handleRecordingConsentKeydown(e) {
        if (e.key === 'Escape' || e.key === 'Esc') {
            e.preventDefault();
            e.stopPropagation();
            this._cancelRecordingConsent();
        }
    }

    // v0.7.5: byok (Gemini) and local (Ollama) are 検証中 — only trial is a
    // verified mode. Before every byok / local session start (no "don't show
    // again"), show the mode's constraints in an in-app modal driven by a
    // second RecordingConsentGate instance. Resolves true when the user
    // accepts, false when they go back to trial (button or Escape). Fails
    // closed like confirmRecordingConsent() when the gate or shadowRoot is
    // unavailable.
    async confirmExperimentalMode(mode) {
        if (!this._experimentalGate) {
            return false;
        }
        return this._experimentalGate.request(() => {
            if (!this.shadowRoot) {
                throw new Error('experimental mode modal unavailable (no shadowRoot)');
            }
            this._experimentalMode = mode;
            this._experimentalOpen = true;
            this.requestUpdate();
        });
    }

    // Primary button: 「制約を理解して開始」.
    _acceptExperimental() {
        this._experimentalOpen = false;
        if (this._experimentalGate) this._experimentalGate.accept();
        this.requestUpdate();
    }

    // Secondary button 「お試しモードに戻る」 and Escape.
    _cancelExperimental() {
        this._experimentalOpen = false;
        if (this._experimentalGate) this._experimentalGate.cancel();
        this.requestUpdate();
    }

    _handleExperimentalKeydown(e) {
        if (e.key === 'Escape' || e.key === 'Esc') {
            e.preventDefault();
            e.stopPropagation();
            this._cancelExperimental();
        }
    }

    async handleStart() {
        // Re-entry guard: a double click / double Ctrl+Enter while the
        // consent or 検証中 modal is showing must not run a second start
        // (the modals de-dup, so both calls would otherwise init twice).
        if (this._startInFlight) return;
        this._startInFlight = true;
        try {
            // Recording-consent gate — must run before *any* provider init or
            // capture call so a cancelled confirm leaves zero side effects.
            const consented = await this.confirmRecordingConsent();
            if (!consented) {
                return;
            }

            const prefs = await whisperOhKami.storage.getPreferences();
            const providerMode = prefs.providerMode === 'cloud' ? 'byok' : prefs.providerMode || 'trial';

            // 検証中 modes: show the constraints before any provider init or
            // capture. Declining switches the saved mode back to trial and aborts
            // this start (the user presses Start again in trial).
            if (providerMode !== 'trial') {
                const ok = await this.confirmExperimentalMode(providerMode);
                if (!ok) {
                    // Reflect the switch on the home mode cards right away
                    // (MainView._saveMode also persists providerMode).
                    const mainView = this.shadowRoot && this.shadowRoot.querySelector('main-view');
                    if (mainView && typeof mainView._saveMode === 'function') {
                        await mainView._saveMode('trial');
                    } else {
                        await whisperOhKami.storage.updatePreference('providerMode', 'trial');
                        if (mainView) {
                            mainView._mode = 'trial';
                            mainView._keyError = false;
                        }
                    }
                    this.requestUpdate();
                    return;
                }
            }

            if (providerMode === 'trial') {
                const success = await whisperOhKami.initializeTrial(this.selectedProfile);
                if (!success) {
                    const mainView = this.shadowRoot.querySelector('main-view');
                    if (mainView && mainView.triggerApiKeyError) {
                        mainView.triggerApiKeyError();
                    }
                    return;
                }
            } else if (providerMode === 'local') {
                const success = await whisperOhKami.initializeLocal(this.selectedProfile);
                if (!success) {
                    const mainView = this.shadowRoot.querySelector('main-view');
                    if (mainView && mainView.triggerApiKeyError) {
                        mainView.triggerApiKeyError();
                    }
                    return;
                }
            } else {
                const apiKey = await whisperOhKami.storage.getApiKey();
                if (!apiKey || apiKey === '') {
                    const mainView = this.shadowRoot.querySelector('main-view');
                    if (mainView && mainView.triggerApiKeyError) {
                        mainView.triggerApiKeyError();
                    }
                    return;
                }

                await whisperOhKami.initializeGemini(this.selectedProfile, this.selectedLanguage);
            }

            if (providerMode === 'trial') {
                whisperOhKami.startTrialCapture(prefs.micDeviceId || '');
            } else {
                whisperOhKami.startCapture(
                    this.selectedScreenshotInterval,
                    this.selectedImageQuality,
                    prefs.micDeviceId || '',
                    prefs.systemDeviceId || 'auto'
                );
            }
            // Remembered for the live-bar STT badge (where the audio goes).
            this._sessionProviderMode = providerMode;
            this.responses = [];
            this.currentResponseIndex = -1;
            this.startTime = Date.now();
            this.sessionActive = true;
            this.currentView = 'assistant';
            this._startTimer();
        } finally {
            this._startInFlight = false;
        }
    }

    async handleAPIKeyHelp() {
        if (window.require) {
            const { ipcRenderer } = window.require('electron');
            await ipcRenderer.invoke('open-external', 'https://aistudio.google.com/apikey');
        }
    }

    async handleGroqAPIKeyHelp() {
        if (window.require) {
            const { ipcRenderer } = window.require('electron');
            await ipcRenderer.invoke('open-external', 'https://console.groq.com/keys');
        }
    }

    // ── Settings handlers ──

    async handleProfileChange(profile) {
        this.selectedProfile = profile;
        await whisperOhKami.storage.updatePreference('selectedProfile', profile);
    }

    async handleLanguageChange(language) {
        this.selectedLanguage = language;
        await whisperOhKami.storage.updatePreference('selectedLanguage', language);
    }

    async handleScreenshotIntervalChange(interval) {
        this.selectedScreenshotInterval = interval;
        await whisperOhKami.storage.updatePreference('selectedScreenshotInterval', interval);
    }

    async handleImageQualityChange(quality) {
        this.selectedImageQuality = quality;
        await whisperOhKami.storage.updatePreference('selectedImageQuality', quality);
    }

    async handleLayoutModeChange(layoutMode) {
        this.layoutMode = layoutMode;
        await whisperOhKami.storage.updateConfig('layout', layoutMode);
        this.requestUpdate();
    }

    async handleSttModeChange(sttMode) {
        const next = ['cloud', 'local'].includes(sttMode) ? sttMode : 'local';
        this.sttMode = next;
        await whisperOhKami.storage.updatePreference('sttMode', next);
        this.requestUpdate();
    }

    async handleExternalLinkClick(url) {
        if (window.require) {
            const { ipcRenderer } = window.require('electron');
            await ipcRenderer.invoke('open-external', url);
        }
    }

    async handleSendText(message) {
        const result = await window.whisperOhKami.sendTextMessage(message);
        if (!result.success) {
            this.setStatus('Error sending message: ' + result.error);
        } else {
            this.setStatus('Message sent...');
            this._awaitingNewResponse = true;
        }
    }

    handleResponseIndexChanged(e) {
        this.currentResponseIndex = e.detail.index;
        this.shouldAnimateResponse = false;
        this.requestUpdate();
    }

    handleOnboardingComplete() {
        this.currentView = 'main';
    }

    updated(changedProperties) {
        super.updated(changedProperties);

        if (changedProperties.has('currentView') && window.require) {
            const { ipcRenderer } = window.require('electron');
            ipcRenderer.send('view-changed', this.currentView);
        }

        if (changedProperties.has('_recordingConsentOpen') && this._recordingConsentOpen) {
            // Focus the accept button so Enter agrees and Escape (handled by
            // the overlay's keydown listener) cancels.
            const acceptBtn = this.shadowRoot && this.shadowRoot.querySelector('.consent-btn-primary');
            if (acceptBtn) acceptBtn.focus();
        }

        if (changedProperties.has('_experimentalOpen') && this._experimentalOpen) {
            // Same as the consent modal: Enter accepts the constraints, Escape
            // (overlay keydown) goes back to trial.
            const acceptBtn = this.shadowRoot && this.shadowRoot.querySelector('.experimental-overlay .consent-btn-primary');
            if (acceptBtn) acceptBtn.focus();
        }
    }

    // ── Helpers ──

    _isLiveMode() {
        return this.currentView === 'assistant';
    }

    async _toggleSidebarCollapse() {
        this._sidebarUserCollapsed = !this._sidebarUserCollapsed;
        try {
            await whisperOhKami.storage.updatePreference('sidebarUserCollapsed', this._sidebarUserCollapsed);
        } catch (e) {
            // non-blocking: state still flips for current session even if persist fails
            console.warn('[CheatingDaddyApp] sidebarUserCollapsed persist failed:', e);
        }
        this.requestUpdate();
    }

    // ── Render ──

    renderCurrentView() {
        switch (this.currentView) {
            case 'onboarding':
                return html`
                    <onboarding-view .onComplete=${() => this.handleOnboardingComplete()} .onClose=${() => this.handleClose()}></onboarding-view>
                `;

            case 'main':
                return html`
                    <main-view
                        .selectedProfile=${this.selectedProfile}
                        .onProfileChange=${p => this.handleProfileChange(p)}
                        .onStart=${() => this.handleStart()}
                        .onExternalLink=${url => this.handleExternalLinkClick(url)}
                        .whisperDownloading=${this._whisperDownloading}
                        .whisperProgress=${this._whisperProgress}
                        .whisperError=${this._whisperError}
                    ></main-view>
                `;

            case 'ai-customize':
                return html`
                    <ai-customize-view
                        .selectedProfile=${this.selectedProfile}
                        .onProfileChange=${p => this.handleProfileChange(p)}
                    ></ai-customize-view>
                `;

            case 'customize':
                return html`
                    <customize-view
                        .selectedProfile=${this.selectedProfile}
                        .selectedLanguage=${this.selectedLanguage}
                        .selectedScreenshotInterval=${this.selectedScreenshotInterval}
                        .selectedImageQuality=${this.selectedImageQuality}
                        .layoutMode=${this.layoutMode}
                        .sttMode=${this.sttMode}
                        .onProfileChange=${p => this.handleProfileChange(p)}
                        .onLanguageChange=${l => this.handleLanguageChange(l)}
                        .onScreenshotIntervalChange=${i => this.handleScreenshotIntervalChange(i)}
                        .onImageQualityChange=${q => this.handleImageQualityChange(q)}
                        .onLayoutModeChange=${lm => this.handleLayoutModeChange(lm)}
                        .onSttModeChange=${m => this.handleSttModeChange(m)}
                    ></customize-view>
                `;

            case 'feedback':
                return html`<feedback-view .onExternalLink=${url => this.handleExternalLinkClick(url)}></feedback-view>`;

            case 'help':
                return html`<help-view .onExternalLinkClick=${url => this.handleExternalLinkClick(url)}></help-view>`;

            case 'history':
                return html`<history-view></history-view>`;

            case 'assistant':
                return html`
                    <assistant-view
                        .responses=${this.responses}
                        .currentResponseIndex=${this.currentResponseIndex}
                        .selectedProfile=${this.selectedProfile}
                        .onSendText=${msg => this.handleSendText(msg)}
                        .shouldAnimateResponse=${this.shouldAnimateResponse}
                        @response-index-changed=${this.handleResponseIndexChanged}
                        @response-animation-complete=${() => {
                            this.shouldAnimateResponse = false;
                            this._currentResponseIsComplete = true;
                            this.requestUpdate();
                        }}
                    ></assistant-view>
                `;

            default:
                return html`<div>Unknown view: ${this.currentView}</div>`;
        }
    }

    _renderDiagnostic() {
        const diagnostic = this._diagnostic;
        if (!diagnostic) return '';
        return html`
            <div class="diagnostic-panel" role="alert" aria-live="polite">
                <div class="diagnostic-header">
                    <div class="diagnostic-title">${t(diagnostic.titleKey)}</div>
                    <button class="diagnostic-close" @click=${() => this.clearDiagnostic()}>${t('common.dismiss')}</button>
                </div>
                <div class="diagnostic-body">
                    <div>${t(diagnostic.causeKey)}</div>
                    <div>${t(diagnostic.actionKey)}</div>
                    ${diagnostic.detail ? html`<div class="diagnostic-detail">${diagnostic.detail}</div>` : ''}
                    ${
                        diagnostic.actionUrl
                            ? html`<div>
                                  <span class="diagnostic-link" @click=${() => this.handleExternalLinkClick(diagnostic.actionUrl)}
                                      >${diagnostic.actionUrl}</span
                                  >
                              </div>`
                            : ''
                    }
                </div>
            </div>
        `;
    }

    _renderRecordingConsent() {
        if (!this._recordingConsentOpen) return '';
        return html`
            <div class="consent-overlay" @keydown=${e => this._handleRecordingConsentKeydown(e)}>
                <div class="consent-card" role="alertdialog" aria-modal="true" aria-labelledby="consent-message">
                    <div id="consent-message" class="consent-message">${t('app.recording_consent.message')}</div>
                    <div class="consent-actions">
                        <button class="consent-btn consent-btn-secondary" @click=${() => this._cancelRecordingConsent()}>
                            ${t('app.recording_consent.cancel')}
                        </button>
                        <button class="consent-btn consent-btn-primary" @click=${() => this._acceptRecordingConsent()}>
                            ${t('app.recording_consent.accept')}
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    _renderExperimentalMode() {
        if (!this._experimentalOpen) return '';
        const mode = this._experimentalMode === 'local' ? 'local' : 'byok';
        const modeName = t(`main.mode_card.${mode}.title`);
        return html`
            <div class="consent-overlay experimental-overlay" @keydown=${e => this._handleExperimentalKeydown(e)}>
                <div class="consent-card" role="alertdialog" aria-modal="true" aria-labelledby="experimental-title">
                    <div id="experimental-title" class="experimental-title">${t('experimental.title').replace('{mode}', modeName)}</div>
                    <div class="consent-message experimental-intro">${t('experimental.intro')}</div>
                    <ul class="experimental-list">
                        ${[1, 2, 3].map(i => html`<li>${t(`experimental.${mode}.${i}`)}</li>`)}
                    </ul>
                    <div class="consent-actions">
                        <button class="consent-btn consent-btn-secondary" @click=${() => this._cancelExperimental()}>
                            ${t('experimental.back')}
                        </button>
                        <button class="consent-btn consent-btn-primary" @click=${() => this._acceptExperimental()}>
                            ${t('experimental.accept')}
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    renderSidebar() {
        const items = [
            {
                id: 'main',
                label: t('nav.home'),
                icon: html`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24">
                    <g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2">
                        <path
                            d="m19 8.71l-5.333-4.148a2.666 2.666 0 0 0-3.274 0L5.059 8.71a2.67 2.67 0 0 0-1.029 2.105v7.2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.2c0-.823-.38-1.6-1.03-2.105"
                        />
                        <path d="M16 15c-2.21 1.333-5.792 1.333-8 0" />
                    </g>
                </svg>`,
            },
            {
                id: 'ai-customize',
                label: t('nav.ai_customize'),
                icon: html`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24">
                    <path
                        fill="none"
                        stroke="currentColor"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M13 3v7h6l-8 11v-7H5z"
                    />
                </svg>`,
            },
            {
                id: 'history',
                label: t('nav.history'),
                icon: html`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24">
                    <g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2">
                        <path
                            d="M10 20.777a9 9 0 0 1-2.48-.969M14 3.223a9.003 9.003 0 0 1 0 17.554m-9.421-3.684a9 9 0 0 1-1.227-2.592M3.124 10.5c.16-.95.468-1.85.9-2.675l.169-.305m2.714-2.941A9 9 0 0 1 10 3.223"
                        />
                        <path d="M12 8v4l3 3" />
                    </g>
                </svg>`,
            },
            {
                id: 'customize',
                label: t('nav.settings'),
                icon: html`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24">
                    <g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2">
                        <path
                            d="M19.875 6.27A2.23 2.23 0 0 1 21 8.218v7.284c0 .809-.443 1.555-1.158 1.948l-6.75 4.27a2.27 2.27 0 0 1-2.184 0l-6.75-4.27A2.23 2.23 0 0 1 3 15.502V8.217c0-.809.443-1.554 1.158-1.947l6.75-3.98a2.33 2.33 0 0 1 2.25 0l6.75 3.98z"
                        />
                        <path d="M9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0" />
                    </g>
                </svg>`,
            },
            {
                id: 'feedback',
                label: t('nav.feedback'),
                icon: html`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24">
                    <g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2">
                        <path d="M18 4a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3h-5l-5 3v-3H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3zM9.5 9h.01m4.99 0h.01" />
                        <path d="M9.5 13a3.5 3.5 0 0 0 5 0" />
                    </g>
                </svg>`,
            },
            {
                id: 'help',
                label: t('nav.help'),
                icon: html`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24">
                    <g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2">
                        <path d="M12 3c7.2 0 9 1.8 9 9s-1.8 9-9 9s-9-1.8-9-9s1.8-9 9-9m0 13v.01" />
                        <path d="M12 13a2 2 0 0 0 .914-3.782a1.98 1.98 0 0 0-2.414.483" />
                    </g>
                </svg>`,
            },
        ];

        const sidebarClasses = ['sidebar', this._isLiveMode() ? 'hidden' : '', this._sidebarUserCollapsed ? 'user-collapsed' : '']
            .filter(Boolean)
            .join(' ');

        const toggleLabel = t(this._sidebarUserCollapsed ? 'nav.sidebar.expand' : 'nav.sidebar.collapse');
        // Chevron-left when expanded ("click to collapse"), chevron-right when collapsed
        // ("click to expand") — matches the direction the sidebar will move on click.
        const toggleIcon = this._sidebarUserCollapsed
            ? html`<svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
              >
                  <polyline points="9 18 15 12 9 6"></polyline>
              </svg>`
            : html`<svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
              >
                  <polyline points="15 18 9 12 15 6"></polyline>
              </svg>`;

        return html`
            <div class=${sidebarClasses}>
                <div class="sidebar-brand">
                    ${brandMark(22)}
                    <h1>WhisperOhKAMI</h1>
                </div>
                <nav class="sidebar-nav">
                    ${items.map(
                        item => html`
                            <button
                                class="nav-item ${this.currentView === item.id ? 'active' : ''}"
                                @click=${() => this.navigate(item.id)}
                                title=${item.label}
                            >
                                ${item.icon}
                                <span class="nav-item-label">${item.label}</span>
                            </button>
                        `
                    )}
                </nav>
                <div class="sidebar-footer">
                    <button
                        class="sidebar-collapse-toggle"
                        @click=${() => this._toggleSidebarCollapse()}
                        title=${toggleLabel}
                        aria-label=${toggleLabel}
                    >
                        ${toggleIcon}
                        <span class="sidebar-collapse-toggle-label">${toggleLabel}</span>
                    </button>
                    ${
                        this._updateAvailable
                            ? html`
                                  <button class="update-btn" @click=${() => this.handleExternalLinkClick('https://whisperohkami.pages.dev/')}>
                                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                                          <path
                                              fill="none"
                                              stroke="currentColor"
                                              stroke-linecap="round"
                                              stroke-linejoin="round"
                                              stroke-width="2"
                                              d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M7 11l5 5l5-5m-5-7v12"
                                          />
                                      </svg>
                                      <span class="update-btn-label">${t('common.update_available')}</span>
                                  </button>
                              `
                            : html`<div class="version-text">v${this._localVersion}</div>`
                    }
                </div>
            </div>
        `;
    }

    renderLiveBar() {
        if (!this._isLiveMode()) return '';

        const profileLabels = {
            discovery: t('profile.discovery'),
            sales: t('profile.sales'),
        };

        // The badge must describe where audio actually goes. Trial / local
        // (Ollama) never use Deepgram or Gemini Live — audio stays on this PC
        // (Whisper) whatever sttMode says. sttMode only matters in byok, where
        // the counterpart's audio always reaches Gemini Live.
        const onDevice = this._sessionProviderMode === 'trial' || this._sessionProviderMode === 'local';
        const sttBadgeKey = onDevice ? 'local' : this.sttMode;
        const sttBadge = onDevice
            ? { label: 'LOCAL', glyph: '🔒', title: t('app.live_bar.stt_badge.on_device') }
            : {
                  cloud: { label: 'CLOUD', glyph: '☁', title: t('app.live_bar.stt_badge.cloud') },
                  local: { label: 'LOCAL', glyph: '🔒', title: t('app.live_bar.stt_badge.byok_local') },
              }[this.sttMode] || null;

        return html`
            <div class="live-bar">
                <div class="live-bar-left">
                    <button class="live-bar-back" @click=${() => this.handleClose()} title=${t('app.live_bar.end_session')}>
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                            <path
                                fill-rule="evenodd"
                                d="M12.79 5.23a.75.75 0 0 1-.02 1.06L8.832 10l3.938 3.71a.75.75 0 1 1-1.04 1.08l-4.5-4.25a.75.75 0 0 1 0-1.08l4.5-4.25a.75.75 0 0 1 1.06.02Z"
                                clip-rule="evenodd"
                            />
                        </svg>
                    </button>
                </div>
                <div class="live-bar-center">${profileLabels[this.selectedProfile] || t('app.live_bar.session_fallback')}</div>
                <div class="live-bar-right">
                    ${
                        sttBadge
                            ? html`<span class="live-bar-badge stt-${sttBadgeKey}" title=${sttBadge.title}>${sttBadge.glyph} ${sttBadge.label}</span>`
                            : ''
                    }
                    ${this.statusText ? html`<span class="live-bar-text">${this.statusText}</span>` : ''}
                    <span class="live-bar-text">${this.getElapsedTime()}</span>
                    ${this._isClickThrough ? html`<span class="live-bar-text">${t('app.live_bar.click_through')}</span>` : ''}
                    <span class="live-bar-text clickable" @click=${() => this.handleHideToggle()}>${t('app.live_bar.hide')}</span>
                </div>
            </div>
        `;
    }

    render() {
        // Onboarding is fullscreen, no sidebar
        if (this.currentView === 'onboarding') {
            return html` <div class="fullscreen">${this.renderCurrentView()}</div> `;
        }

        const isLive = this._isLiveMode();

        return html`
            <div class="app-shell">
                <div class="top-drag-bar ${isLive ? 'hidden' : ''}">
                    <div class="drag-region"></div>
                    <div class="window-controls">
                        <button class="win-control hide" @click=${() => this.handleHideToggle()} title=${t('app.window_control.hide_tooltip')}>
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                viewBox="0 0 16 16"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="1.3"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                            >
                                <path
                                    d="M3.5 5.5C5 4 6.5 3.5 8 3.5s3 .5 4.5 2c1 1 1.5 2 1.5 2.5s-.5 1.5-1.5 2.5c-1.5 1.5-3 2-4.5 2s-3-.5-4.5-2C2.5 9.5 2 8.5 2 8s.5-1.5 1.5-2.5z"
                                />
                                <circle cx="8" cy="8" r="2" />
                                <line x1="2" y1="14" x2="14" y2="2" />
                            </svg>
                        </button>
                        <button class="win-control close" @click=${() => this.handleClose()} title=${t('app.window_control.close_tooltip')}>
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1">
                                <path d="M2 2 L10 10 M10 2 L2 10" />
                            </svg>
                        </button>
                    </div>
                </div>
                ${this.renderSidebar()}
                <div class="content">
                    ${isLive ? this.renderLiveBar() : ''} ${this._renderDiagnostic()}
                    <div class="content-inner ${isLive ? 'live' : ''}">${this.renderCurrentView()}</div>
                </div>
            </div>
            ${this._renderRecordingConsent()} ${this._renderExperimentalMode()}
        `;
    }
}

customElements.define('whisper-oh-kami-app', CheatingDaddyApp);
