import { html, css, LitElement } from '../../assets/lit-core-2.7.4.min.js';
import { unifiedPageStyles } from './sharedPageStyles.js';

export class CustomizeView extends LitElement {
    static styles = [
        unifiedPageStyles,
        css`
            .danger-surface {
                border-color: var(--danger);
            }

            .warning-callout {
                position: relative;
                margin-top: 4px;
                padding: 8px 12px;
                border: 1px solid var(--danger);
                border-radius: var(--radius-sm);
                color: var(--danger);
                font-size: var(--font-size-xs);
                line-height: 1.4;
                background: rgba(239, 68, 68, 0.06);
            }

            .warning-callout::before {
                content: '';
                position: absolute;
                top: -6px;
                left: 16px;
                width: 10px;
                height: 10px;
                background: var(--bg-surface);
                border-top: 1px solid var(--danger);
                border-left: 1px solid var(--danger);
                transform: rotate(45deg);
            }

            .toggle-row {
                display: flex;
                align-items: center;
                gap: var(--space-sm);
                padding: var(--space-sm);
                border: 1px solid var(--border);
                border-radius: var(--radius-sm);
                background: var(--bg-elevated);
            }

            .toggle-input {
                width: 14px;
                height: 14px;
                accent-color: var(--text-primary);
                cursor: pointer;
            }

            .toggle-label {
                color: var(--text-primary);
                font-size: var(--font-size-sm);
                cursor: pointer;
                user-select: none;
            }

            .slider-wrap {
                display: flex;
                flex-direction: column;
                align-items: stretch;
                gap: var(--space-xs);
            }

            .slider-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: var(--space-sm);
            }

            .slider-value {
                font-family: var(--font-mono);
                font-size: var(--font-size-xs);
                color: var(--text-secondary);
                background: var(--bg-elevated);
                border: 1px solid var(--border);
                border-radius: var(--radius-sm);
                padding: 2px 8px;
            }

            .slider-input {
                -webkit-appearance: none;
                appearance: none;
                width: 100%;
                height: 4px;
                border-radius: 2px;
                background: var(--border);
                outline: none;
                cursor: pointer;
            }

            .slider-input::-webkit-slider-thumb {
                -webkit-appearance: none;
                appearance: none;
                width: 14px;
                height: 14px;
                border-radius: 50%;
                background: var(--text-primary);
                border: none;
            }

            .slider-input::-moz-range-thumb {
                width: 14px;
                height: 14px;
                border-radius: 50%;
                background: var(--text-primary);
                border: none;
            }

            .keybind-row {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: var(--space-sm) 0;
                border-bottom: 1px solid var(--border);
            }

            .keybind-row:last-of-type {
                border-bottom: none;
            }

            .keybind-name {
                color: var(--text-secondary);
                font-size: var(--font-size-sm);
            }

            .keybind-meta {
                display: flex;
                flex-direction: column;
                gap: 2px;
            }

            .keybind-status {
                color: var(--text-muted);
                font-size: var(--font-size-xs);
            }

            .keybind-status.error {
                color: var(--danger);
            }

            .keybind-input {
                width: 140px;
                text-align: center;
                font-family: var(--font-mono);
                font-size: var(--font-size-xs);
            }

            .danger-button {
                border: 1px solid var(--danger);
                color: var(--danger);
                background: transparent;
                border-radius: var(--radius-sm);
                padding: 9px 12px;
                font-size: var(--font-size-sm);
                cursor: pointer;
                transition: background var(--transition);
            }

            .danger-button:hover {
                background: rgba(214, 69, 69, 0.1);
            }

            .danger-button:disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }

            .status {
                margin-top: var(--space-sm);
                padding: var(--space-sm);
                border-radius: var(--radius-sm);
                border: 1px solid var(--border);
                font-size: var(--font-size-xs);
            }

            .status.success {
                border-color: var(--success);
                color: var(--success);
            }

            .status.error {
                border-color: var(--danger);
                color: var(--danger);
            }

            .status.warning {
                border-color: var(--warning);
                color: var(--warning);
            }

            .stt-mode-grid {
                display: flex;
                flex-direction: column;
                gap: var(--space-sm);
            }

            .stt-mode-row {
                display: flex;
                flex-direction: column;
                gap: var(--space-xs);
                padding: var(--space-md);
                border: 1px solid var(--border);
                border-radius: var(--radius-sm);
                background: var(--bg-elevated);
                cursor: pointer;
                transition:
                    border-color var(--transition),
                    background var(--transition);
            }

            .stt-mode-row:hover {
                border-color: var(--border-strong);
            }

            .stt-mode-row.selected {
                border-color: var(--accent);
                background: rgba(31, 58, 95, 0.08);
            }

            .stt-mode-row.selected.local {
                border-color: var(--success);
                background: rgba(31, 157, 87, 0.08);
            }

            .stt-mode-row input[type='radio'] {
                position: absolute;
                opacity: 0;
                pointer-events: none;
            }

            .stt-mode-head {
                display: flex;
                align-items: center;
                gap: var(--space-sm);
            }

            .stt-mode-glyph {
                font-size: var(--font-size-base);
            }

            .stt-mode-title {
                font-weight: var(--font-weight-semibold);
                font-size: var(--font-size-sm);
                color: var(--text-primary);
            }

            .stt-mode-tag {
                font-size: var(--font-size-xs);
                color: var(--text-muted);
                border: 1px solid var(--border);
                border-radius: var(--radius-sm);
                padding: 1px 6px;
            }

            .stt-mode-help {
                font-size: var(--font-size-xs);
                color: var(--text-secondary);
                line-height: 1.5;
            }

            .stt-mode-section-help {
                font-size: var(--font-size-xs);
                color: var(--text-secondary);
                margin: 0 0 var(--space-sm) 0;
                line-height: 1.5;
            }
        `,
    ];

    static properties = {
        selectedProfile: { type: String },
        selectedLanguage: { type: String },
        selectedImageQuality: { type: String },
        layoutMode: { type: String },
        sttMode: { type: String },
        keybinds: { type: Object },
        googleSearchEnabled: { type: Boolean },
        backgroundTransparency: { type: Number },
        fontSize: { type: Number },
        theme: { type: String },
        onProfileChange: { type: Function },
        onLanguageChange: { type: Function },
        onImageQualityChange: { type: Function },
        onLayoutModeChange: { type: Function },
        onSttModeChange: { type: Function },
        isClearing: { type: Boolean },
        isRestoring: { type: Boolean },
        isExportingSupport: { type: Boolean },
        clearStatusMessage: { type: String },
        clearStatusType: { type: String },
        supportExportMessage: { type: String },
        supportExportType: { type: String },
        shortcutRegistrationStatus: { type: Object },
        shortcutDuplicates: { type: Array },
    };

    constructor() {
        super();
        this.selectedProfile = 'sales';
        this.selectedLanguage = 'en-US';
        this.selectedImageQuality = 'medium';
        this.layoutMode = 'normal';
        this.sttMode = 'local';
        this.keybinds = this.getDefaultKeybinds();
        this.onProfileChange = () => {};
        this.onLanguageChange = () => {};
        this.onImageQualityChange = () => {};
        this.onLayoutModeChange = () => {};
        this.onSttModeChange = () => {};
        this.googleSearchEnabled = true;
        this.isClearing = false;
        this.isRestoring = false;
        this.isExportingSupport = false;
        this.clearStatusMessage = '';
        this.clearStatusType = '';
        this.supportExportMessage = '';
        this.supportExportType = '';
        this.backgroundTransparency = 0.92;
        this.fontSize = 20;
        this.audioMode = 'speaker_only';
        this.customPrompt = '';
        this.theme = 'light';
        this.shortcutRegistrationStatus = null;
        this.shortcutDuplicates = [];
        this._loadFromStorage();
    }

    connectedCallback() {
        super.connectedCallback();
        this._handleShortcutStatus = event => {
            this.shortcutRegistrationStatus = event.detail || null;
            this.requestUpdate();
        };
        window.addEventListener('shortcut-registration-status', this._handleShortcutStatus);
        this.shortcutRegistrationStatus = whisperOhKami.shortcutRegistrationStatus || null;
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        if (this._handleShortcutStatus) {
            window.removeEventListener('shortcut-registration-status', this._handleShortcutStatus);
        }
    }

    _shortcutPolicy() {
        return require('./utils/shortcutPolicy');
    }

    _shortcutPlatform() {
        return whisperOhKami.isMacOS || navigator.platform.includes('Mac') ? 'darwin' : window.process?.platform || 'win32';
    }

    _refreshShortcutDiagnostics() {
        const { detectDuplicateKeybinds } = this._shortcutPolicy();
        this.shortcutDuplicates = detectDuplicateKeybinds(this.keybinds);
    }

    getThemes() {
        return whisperOhKami.theme.getAll();
    }

    async _loadFromStorage() {
        try {
            const [prefs, keybinds] = await Promise.all([whisperOhKami.storage.getPreferences(), whisperOhKami.storage.getKeybinds()]);
            this.googleSearchEnabled = prefs.googleSearchEnabled ?? true;
            this.backgroundTransparency = prefs.backgroundTransparency ?? 0.92;
            this.fontSize = prefs.fontSize ?? 20;
            this.audioMode = prefs.audioMode ?? 'speaker_only';
            this.customPrompt = prefs.customPrompt ?? '';
            this.theme = prefs.theme ?? 'light';
            this.sttMode = ['cloud', 'local'].includes(prefs.sttMode) ? prefs.sttMode : 'local';
            if (keybinds) {
                this.keybinds = { ...this.getDefaultKeybinds(), ...keybinds };
            }
            this._refreshShortcutDiagnostics();
            this.updateBackgroundAppearance();
            this.updateFontSize();
            this.requestUpdate();
        } catch (error) {
            console.error('Error loading settings:', error);
        }
    }

    getProfiles() {
        return [
            { value: 'discovery', name: t('profile.discovery') },
            { value: 'sales', name: t('profile.sales') },
        ];
    }

    getLanguages() {
        return [
            { value: 'en-US', name: 'English (US)' },
            { value: 'en-GB', name: 'English (UK)' },
            { value: 'en-AU', name: 'English (Australia)' },
            { value: 'en-IN', name: 'English (India)' },
            { value: 'de-DE', name: 'German (Germany)' },
            { value: 'es-US', name: 'Spanish (US)' },
            { value: 'es-ES', name: 'Spanish (Spain)' },
            { value: 'fr-FR', name: 'French (France)' },
            { value: 'fr-CA', name: 'French (Canada)' },
            { value: 'hi-IN', name: 'Hindi (India)' },
            { value: 'pt-BR', name: 'Portuguese (Brazil)' },
            { value: 'ar-XA', name: 'Arabic (Generic)' },
            { value: 'id-ID', name: 'Indonesian (Indonesia)' },
            { value: 'it-IT', name: 'Italian (Italy)' },
            { value: 'ja-JP', name: 'Japanese (Japan)' },
            { value: 'tr-TR', name: 'Turkish (Turkey)' },
            { value: 'vi-VN', name: 'Vietnamese (Vietnam)' },
            { value: 'bn-IN', name: 'Bengali (India)' },
            { value: 'gu-IN', name: 'Gujarati (India)' },
            { value: 'kn-IN', name: 'Kannada (India)' },
            { value: 'ml-IN', name: 'Malayalam (India)' },
            { value: 'mr-IN', name: 'Marathi (India)' },
            { value: 'ta-IN', name: 'Tamil (India)' },
            { value: 'te-IN', name: 'Telugu (India)' },
            { value: 'nl-NL', name: 'Dutch (Netherlands)' },
            { value: 'ko-KR', name: 'Korean (South Korea)' },
            { value: 'cmn-CN', name: 'Mandarin Chinese (China)' },
            { value: 'pl-PL', name: 'Polish (Poland)' },
            { value: 'ru-RU', name: 'Russian (Russia)' },
            { value: 'th-TH', name: 'Thai (Thailand)' },
        ];
    }

    getDefaultKeybinds() {
        const { getDefaultKeybinds } = this._shortcutPolicy();
        return getDefaultKeybinds(this._shortcutPlatform());
    }

    getKeybindActions() {
        const { getShortcutActions } = this._shortcutPolicy();
        return getShortcutActions(this._shortcutPlatform());
    }

    async saveKeybinds() {
        this._refreshShortcutDiagnostics();
        await whisperOhKami.storage.setKeybinds(this.keybinds);
        if (window.require) {
            const { ipcRenderer } = window.require('electron');
            ipcRenderer.send('update-keybinds', this.keybinds);
        }
    }

    handleProfileSelect(e) {
        this.selectedProfile = e.target.value;
        this.onProfileChange(this.selectedProfile);
    }

    handleLanguageSelect(e) {
        this.selectedLanguage = e.target.value;
        this.onLanguageChange(this.selectedLanguage);
    }

    handleImageQualitySelect(e) {
        this.selectedImageQuality = e.target.value;
        this.onImageQualityChange(this.selectedImageQuality);
    }

    handleLayoutModeSelect(e) {
        this.layoutMode = e.target.value;
        this.onLayoutModeChange(this.layoutMode);
    }

    async handleCustomPromptInput(e) {
        this.customPrompt = e.target.value;
        await whisperOhKami.storage.updatePreference('customPrompt', this.customPrompt);
    }

    async handleAudioModeSelect(e) {
        this.audioMode = e.target.value;
        await whisperOhKami.storage.updatePreference('audioMode', this.audioMode);
        this.requestUpdate();
    }

    handleSttModeSelect(e) {
        const next = e.target.value;
        this.sttMode = next;
        this.onSttModeChange(next);
        this.requestUpdate();
    }

    async handleThemeChange(e) {
        this.theme = e.target.value;
        await whisperOhKami.theme.save(this.theme);
        this.updateBackgroundAppearance();
        this.requestUpdate();
    }

    async handleGoogleSearchChange(e) {
        this.googleSearchEnabled = e.target.checked;
        await whisperOhKami.storage.updatePreference('googleSearchEnabled', this.googleSearchEnabled);
        if (window.require) {
            try {
                const { ipcRenderer } = window.require('electron');
                await ipcRenderer.invoke('update-google-search-setting', this.googleSearchEnabled);
            } catch (error) {
                console.error('Failed to notify main process:', error);
            }
        }
        this.requestUpdate();
    }

    async handleBackgroundTransparencyChange(e) {
        this.backgroundTransparency = parseFloat(e.target.value);
        await whisperOhKami.storage.updatePreference('backgroundTransparency', this.backgroundTransparency);
        this.updateBackgroundAppearance();
        this.requestUpdate();
    }

    updateBackgroundAppearance() {
        const colors = whisperOhKami.theme.get(this.theme);
        whisperOhKami.theme.applyBackgrounds(colors, this.backgroundTransparency);
    }

    async handleFontSizeChange(e) {
        this.fontSize = parseInt(e.target.value, 10);
        await whisperOhKami.storage.updatePreference('fontSize', this.fontSize);
        this.updateFontSize();
        this.requestUpdate();
    }

    updateFontSize() {
        document.documentElement.style.setProperty('--response-font-size', `${this.fontSize}px`);
    }

    handleKeybindChange(action, value) {
        this.keybinds = { ...this.keybinds, [action]: value };
        this._refreshShortcutDiagnostics();
        this.saveKeybinds();
        this.requestUpdate();
    }

    handleKeybindFocus(e) {
        e.target.placeholder = t('customize.keybind.placeholder');
        e.target.select();
    }

    handleKeybindInput(e) {
        e.preventDefault();
        const modifiers = [];
        if (e.ctrlKey) modifiers.push('Ctrl');
        if (e.metaKey) modifiers.push('Cmd');
        if (e.altKey) modifiers.push('Alt');
        if (e.shiftKey) modifiers.push('Shift');
        let mainKey = e.key;

        switch (e.code) {
            case 'ArrowUp':
                mainKey = 'Up';
                break;
            case 'ArrowDown':
                mainKey = 'Down';
                break;
            case 'ArrowLeft':
                mainKey = 'Left';
                break;
            case 'ArrowRight':
                mainKey = 'Right';
                break;
            case 'Enter':
                mainKey = 'Enter';
                break;
            case 'Space':
                mainKey = 'Space';
                break;
            case 'Backslash':
                mainKey = '\\';
                break;
            default:
                if (e.key.length === 1) mainKey = e.key.toUpperCase();
                break;
        }

        if (['Control', 'Meta', 'Alt', 'Shift'].includes(e.key)) return;

        const action = e.target.dataset.action;
        const keybind = [...modifiers, mainKey].join('+');
        this.handleKeybindChange(action, keybind);
        e.target.value = keybind;
        e.target.blur();
    }

    async resetKeybinds() {
        this.keybinds = this.getDefaultKeybinds();
        this._refreshShortcutDiagnostics();
        await whisperOhKami.storage.setKeybinds(null);
        if (window.require) {
            const { ipcRenderer } = window.require('electron');
            ipcRenderer.send('update-keybinds', this.keybinds);
        }
        this.requestUpdate();
    }

    async restoreAllSettings() {
        if (this.isRestoring) return;
        this.isRestoring = true;
        this.clearStatusMessage = '';
        this.clearStatusType = '';
        this.requestUpdate();
        try {
            // Restore all preferences to defaults
            const defaults = {
                customPrompt: '',
                contextProfile: {},
                selectedProfile: 'sales',
                selectedLanguage: 'en-US',
                selectedScreenshotInterval: '5',
                selectedImageQuality: 'medium',
                audioMode: 'speaker_only',
                fontSize: 20,
                backgroundTransparency: 0.92,
                googleSearchEnabled: false,
                theme: 'light',
                sttMode: 'local',
            };
            for (const [key, value] of Object.entries(defaults)) {
                await whisperOhKami.storage.updatePreference(key, value);
            }

            // Restore keybinds
            this.keybinds = this.getDefaultKeybinds();
            this._refreshShortcutDiagnostics();
            await whisperOhKami.storage.setKeybinds(null);
            if (window.require) {
                const { ipcRenderer } = window.require('electron');
                ipcRenderer.send('update-keybinds', this.keybinds);
            }

            // Apply to local state
            this.selectedProfile = defaults.selectedProfile;
            this.selectedLanguage = defaults.selectedLanguage;
            this.selectedImageQuality = defaults.selectedImageQuality;
            this.audioMode = defaults.audioMode;
            this.fontSize = defaults.fontSize;
            this.backgroundTransparency = defaults.backgroundTransparency;
            this.googleSearchEnabled = defaults.googleSearchEnabled;
            this.customPrompt = defaults.customPrompt;
            this.theme = defaults.theme;
            this.sttMode = defaults.sttMode;

            // Notify parent callbacks
            this.onProfileChange(defaults.selectedProfile);
            this.onLanguageChange(defaults.selectedLanguage);
            this.onImageQualityChange(defaults.selectedImageQuality);
            this.onSttModeChange(defaults.sttMode);

            // Apply visual changes
            this.updateBackgroundAppearance();
            this.updateFontSize();
            await whisperOhKami.theme.save(defaults.theme);

            this.clearStatusMessage = 'All settings restored to defaults';
            this.clearStatusType = 'success';
        } catch (error) {
            console.error('Error restoring settings:', error);
            this.clearStatusMessage = `Error restoring settings: ${error.message}`;
            this.clearStatusType = 'error';
        } finally {
            this.isRestoring = false;
            this.requestUpdate();
        }
    }

    async clearLocalData() {
        if (this.isClearing) return;
        this.isClearing = true;
        this.clearStatusMessage = '';
        this.clearStatusType = '';
        this.requestUpdate();
        try {
            await whisperOhKami.storage.clearAll();
            this.clearStatusMessage = t('customize.privacy.cleared_local');
            this.clearStatusType = 'success';
            this.requestUpdate();
            setTimeout(() => {
                this.clearStatusMessage = t('customize.privacy.quitting');
                this.requestUpdate();
                setTimeout(async () => {
                    if (window.require) {
                        const { ipcRenderer } = window.require('electron');
                        await ipcRenderer.invoke('quit-application');
                    }
                }, 1000);
            }, 2000);
        } catch (error) {
            console.error('Error clearing data:', error);
            this.clearStatusMessage = t('customize.privacy.clear_error').replace('{message}', error.message);
            this.clearStatusType = 'error';
        } finally {
            this.isClearing = false;
            this.requestUpdate();
        }
    }

    async exportSupportDiagnostics() {
        if (this.isExportingSupport) return;
        this.isExportingSupport = true;
        this.supportExportMessage = '';
        this.supportExportType = '';
        this.requestUpdate();
        try {
            const result = await whisperOhKami.exportSupportDiagnostics();
            if (result && result.success) {
                this.supportExportMessage = t('customize.support_export.success').replace('{path}', result.path);
                this.supportExportType = 'success';
            } else {
                this.supportExportMessage = t('customize.support_export.error').replace('{message}', result?.error || 'unknown error');
                this.supportExportType = 'error';
            }
        } catch (error) {
            this.supportExportMessage = t('customize.support_export.error').replace('{message}', error.message);
            this.supportExportType = 'error';
        } finally {
            this.isExportingSupport = false;
            this.requestUpdate();
        }
    }

    renderSttModeSection() {
        const modes = [
            {
                value: 'cloud',
                glyph: '☁',
                title: t('customize.stt.cloud.title'),
                tag: t('customize.stt.cloud.tag'),
                help: t('customize.stt.cloud.help'),
            },
            {
                value: 'local',
                glyph: '🔒',
                title: t('customize.stt.local.title'),
                tag: t('customize.stt.local.tag'),
                help: t('customize.stt.local.help'),
            },
        ];
        return html`
            <section class="surface">
                <div class="surface-title">${t('customize.stt.title')}</div>
                <p class="stt-mode-section-help">${t('customize.stt.section_help')}</p>
                <div class="stt-mode-grid">
                    ${modes.map(
                        mode => html`
                            <label class="stt-mode-row ${this.sttMode === mode.value ? 'selected' : ''} ${mode.value}">
                                <input
                                    type="radio"
                                    name="sttMode"
                                    value=${mode.value}
                                    .checked=${this.sttMode === mode.value}
                                    @change=${this.handleSttModeSelect}
                                />
                                <div class="stt-mode-head">
                                    <span class="stt-mode-glyph">${mode.glyph}</span>
                                    <span class="stt-mode-title">${mode.title}</span>
                                    <span class="stt-mode-tag">${mode.tag}</span>
                                </div>
                                <div class="stt-mode-help">${mode.help}</div>
                            </label>
                        `
                    )}
                </div>
            </section>
        `;
    }

    renderAudioSection() {
        return html`
            <section class="surface">
                <div class="surface-title">${t('customize.audio.title')}</div>
                <div class="form-grid">
                    <div class="form-group">
                        <label class="form-label">${t('customize.audio.mode_label')}</label>
                        <select class="control" .value=${this.audioMode} @change=${this.handleAudioModeSelect}>
                            <option value="speaker_only">${t('customize.audio.mode.speaker_only')}</option>
                            <option value="mic_only">${t('customize.audio.mode.mic_only')}</option>
                            <option value="both">${t('customize.audio.mode.both')}</option>
                        </select>
                    </div>
                    ${this.audioMode !== 'speaker_only' ? html` <div class="warning-callout">${t('customize.audio.mode.warning')}</div> ` : ''}
                    <div class="form-group">
                        <label class="form-label">${t('customize.audio.quality_label')}</label>
                        <select class="control" .value=${this.selectedImageQuality} @change=${this.handleImageQualitySelect}>
                            <option value="high">${t('customize.audio.quality.high')}</option>
                            <option value="medium">${t('customize.audio.quality.medium')}</option>
                            <option value="low">${t('customize.audio.quality.low')}</option>
                        </select>
                    </div>
                </div>
            </section>
        `;
    }

    renderLanguageSection() {
        return html`
            <section class="surface">
                <div class="surface-title">${t('customize.language.title')}</div>
                <div class="form-grid">
                    <div class="form-group">
                        <label class="form-label">${t('customize.language.stt_label')}</label>
                        <select class="control" .value=${this.selectedLanguage} @change=${this.handleLanguageSelect}>
                            ${this.getLanguages().map(language => html`<option value=${language.value}>${language.name}</option>`)}
                        </select>
                    </div>
                </div>
            </section>
        `;
    }

    renderAppearanceSection() {
        return html`
            <section class="surface">
                <div class="surface-title">${t('customize.appearance.title')}</div>
                <div class="form-grid">
                    <div class="form-group">
                        <label class="form-label">${t('customize.appearance.theme_label')}</label>
                        <select class="control" .value=${this.theme} @change=${this.handleThemeChange}>
                            ${this.getThemes().map(theme => html`<option value=${theme.value}>${theme.name}</option>`)}
                        </select>
                    </div>
                    <div class="form-group slider-wrap">
                        <div class="slider-header">
                            <label class="form-label">${t('customize.appearance.transparency_label')}</label>
                            <span class="slider-value">${Math.round(this.backgroundTransparency * 100)}%</span>
                        </div>
                        <input
                            class="slider-input"
                            type="range"
                            min="0"
                            max="1"
                            step="0.01"
                            .value=${this.backgroundTransparency}
                            @input=${this.handleBackgroundTransparencyChange}
                        />
                    </div>
                    <div class="form-group slider-wrap">
                        <div class="slider-header">
                            <label class="form-label">${t('customize.appearance.font_size_label')}</label>
                            <span class="slider-value">${this.fontSize}px</span>
                        </div>
                        <input
                            class="slider-input"
                            type="range"
                            min="12"
                            max="32"
                            step="1"
                            .value=${this.fontSize}
                            @input=${this.handleFontSizeChange}
                        />
                    </div>
                </div>
            </section>
        `;
    }

    renderKeyboardSection() {
        const statusByAction = this.shortcutRegistrationStatus?.byAction || {};
        const duplicateText = this.shortcutDuplicates.map(entry => `${entry.keybind}: ${entry.actions.join(' / ')}`).join('、');
        return html`
            <section class="surface">
                <div class="surface-title">${t('customize.keybind.title')}</div>
                ${this.shortcutDuplicates.length
                    ? html`<div class="status warning">同じキーが複数の操作に設定されています: ${duplicateText}</div>`
                    : ''}
                ${this.getKeybindActions().map(action => {
                    const status = statusByAction[action.key];
                    return html`
                        <div class="keybind-row">
                            <span class="keybind-meta">
                                <span class="keybind-name">${action.name}</span>
                                ${status
                                    ? html`<span class="keybind-status ${status.success ? '' : 'error'}">
                                          ${status.success ? '登録済み' : `未登録: ${status.error || '登録に失敗しました'}`}
                                      </span>`
                                    : html`<span class="keybind-status"
                                          >${action.category === 'window_movement' ? '表示は控えめ。必要な場合だけ変更' : ''}</span
                                      >`}
                            </span>
                            <input
                                type="text"
                                class="control keybind-input"
                                .value=${this.keybinds[action.key]}
                                data-action=${action.key}
                                @keydown=${this.handleKeybindInput}
                                @focus=${this.handleKeybindFocus}
                                readonly
                            />
                        </div>
                    `;
                })}
                <div style="margin-top: var(--space-sm);">
                    <button class="control" style="width:auto;padding:8px 10px;" @click=${this.resetKeybinds}>${t('customize.keybind.reset')}</button>
                </div>
            </section>
        `;
    }
    renderPrivacySection() {
        return html`
            <section class="surface danger-surface">
                <div class="surface-title danger">${t('customize.privacy.title')}</div>
                <div style="display:flex;gap:var(--space-sm);flex-wrap:wrap;">
                    <button
                        class="control"
                        style="width:auto;padding:9px 12px;"
                        @click=${this.exportSupportDiagnostics}
                        ?disabled=${this.isExportingSupport}
                    >
                        ${this.isExportingSupport ? t('customize.support_export.exporting') : t('customize.support_export.button')}
                    </button>
                    <button class="danger-button" @click=${this.restoreAllSettings} ?disabled=${this.isRestoring}>
                        ${this.isRestoring ? t('customize.privacy.restoring') : t('customize.privacy.restore_all')}
                    </button>
                    <button class="danger-button" @click=${this.clearLocalData} ?disabled=${this.isClearing}>
                        ${this.isClearing ? t('customize.privacy.clearing') : t('customize.privacy.clear_all')}
                    </button>
                </div>
                ${this.clearStatusMessage
                    ? html` <div class="status ${this.clearStatusType === 'success' ? 'success' : 'error'}">${this.clearStatusMessage}</div> `
                    : ''}
                ${this.supportExportMessage
                    ? html` <div class="status ${this.supportExportType === 'success' ? 'success' : 'error'}">${this.supportExportMessage}</div> `
                    : ''}
            </section>
        `;
    }

    render() {
        return html`
            <div class="unified-page">
                <div class="unified-wrap">
                    <div class="page-title">${t('customize.page.title')}</div>
                    ${this.renderSttModeSection()} ${this.renderAudioSection()} ${this.renderLanguageSection()} ${this.renderAppearanceSection()}
                    ${this.renderKeyboardSection()} ${this.renderPrivacySection()}
                </div>
            </div>
        `;
    }
}

customElements.define('customize-view', CustomizeView);
