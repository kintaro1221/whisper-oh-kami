import { html, css, LitElement } from '../../assets/lit-core-2.7.4.min.js';
import { unifiedPageStyles } from './sharedPageStyles.js';

export class HelpView extends LitElement {
    static styles = [
        unifiedPageStyles,
        css`
            .help-grid {
                display: grid;
                grid-template-columns: repeat(2, minmax(0, 1fr));
                gap: var(--space-md);
            }

            .help-grid .wide {
                grid-column: 1 / -1;
            }

            .list {
                display: grid;
                gap: var(--space-sm);
            }

            .list-item {
                padding: var(--space-sm);
                border: 1px solid var(--border);
                border-radius: var(--radius-sm);
                color: var(--text-secondary);
                font-size: var(--font-size-sm);
                line-height: 1.45;
                background: var(--bg-elevated);
            }

            .shortcut-grid {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: var(--space-sm);
            }

            .shortcut-row {
                display: flex;
                align-items: flex-start;
                justify-content: space-between;
                gap: var(--space-sm);
                padding: var(--space-sm);
                border: 1px solid var(--border);
                border-radius: var(--radius-sm);
                background: var(--bg-elevated);
            }

            .shortcut-labels {
                display: flex;
                flex-direction: column;
                gap: 2px;
                min-width: 0;
            }

            .shortcut-label {
                color: var(--text-primary);
                font-size: var(--font-size-xs);
                line-height: 1.4;
            }

            .shortcut-status {
                color: var(--text-muted);
                font-size: var(--font-size-xs);
                line-height: 1.35;
            }

            .shortcut-status.error {
                color: var(--danger);
            }

            .shortcut-keys {
                display: inline-flex;
                gap: 4px;
                flex-wrap: wrap;
                justify-content: flex-end;
                flex-shrink: 0;
            }

            .key {
                border: 1px solid var(--border);
                border-radius: var(--radius-sm);
                padding: 2px 6px;
                font-size: var(--font-size-xs);
                color: var(--text-primary);
                background: var(--bg-surface);
                font-family: var(--font-mono);
            }

            .link-row {
                display: flex;
                flex-wrap: wrap;
                gap: var(--space-sm);
            }

            .link-button {
                border: 1px solid var(--border);
                border-radius: var(--radius-sm);
                padding: 8px 10px;
                background: var(--bg-elevated);
                color: var(--text-primary);
                font-size: var(--font-size-sm);
                cursor: pointer;
                transition:
                    border-color var(--transition),
                    color var(--transition),
                    background var(--transition);
            }

            .link-button:hover {
                color: var(--text-primary);
                border-color: var(--accent);
                background: rgba(31, 58, 95, 0.1);
            }

            @media (max-width: 820px) {
                .help-grid,
                .shortcut-grid {
                    grid-template-columns: 1fr;
                }

                .help-grid .wide {
                    grid-column: auto;
                }
            }
        `,
    ];

    static properties = {
        onExternalLinkClick: { type: Function },
        keybinds: { type: Object },
        shortcutRegistrationStatus: { type: Object },
    };

    constructor() {
        super();
        this.onExternalLinkClick = () => {};
        this.keybinds = this.getDefaultKeybinds();
        this.shortcutRegistrationStatus = null;
        this._loadKeybinds();
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

    async _loadKeybinds() {
        try {
            const keybinds = await whisperOhKami.storage.getKeybinds();
            if (keybinds) {
                this.keybinds = { ...this.getDefaultKeybinds(), ...keybinds };
                this.requestUpdate();
            }
        } catch (error) {
            console.error('Error loading keybinds:', error);
        }
    }

    getDefaultKeybinds() {
        const { getDefaultKeybinds } = this._shortcutPolicy();
        return getDefaultKeybinds(this._shortcutPlatform());
    }

    _formatKeybind(keybind) {
        if (!keybind) return html`<span class="key">${t('help.keybind.unset')}</span>`;
        return keybind.split('+').map(key => html`<span class="key">${key}</span>`);
    }

    _open(url) {
        this.onExternalLinkClick(url);
    }

    _getShortcutRows() {
        const { getShortcutRowsForHelp } = this._shortcutPolicy();
        return getShortcutRowsForHelp(this.keybinds, this.shortcutRegistrationStatus?.byAction || {}, this._shortcutPlatform());
    }

    renderShortcutSection() {
        const rows = this._getShortcutRows();
        return html`
            <section class="surface wide">
                <div class="surface-title">${t('help.section.shortcuts')}</div>
                <div class="shortcut-grid">
                    ${rows.map(
                        row => html`
                            <div class="shortcut-row">
                                <div class="shortcut-labels">
                                    <span class="shortcut-label">${row.name}</span>
                                    ${row.registration
                                        ? html`<span class="shortcut-status ${row.registration.success ? '' : 'error'}">
                                              ${row.registration.success
                                                  ? t('help.keybind.registered')
                                                  : `${t('help.keybind.unregistered')}: ${row.registration.error || t('help.keybind.register_failed')}`}
                                          </span>`
                                        : ''}
                                </div>
                                <span class="shortcut-keys">${this._formatKeybind(row.keybind)}</span>
                            </div>
                        `
                    )}
                </div>
            </section>
        `;
    }

    render() {
        return html`
            <div class="unified-page">
                <div class="unified-wrap">
                    <div class="page-title">${t('help.title')}</div>

                    <div class="help-grid">
                        <section class="surface">
                            <div class="surface-title">${t('help.section.during_negotiation')}</div>
                            <div class="list">
                                <div class="list-item">${t('help.negotiation.right_rail_desc')}</div>
                                <div class="list-item">${t('help.negotiation.feedback_recording_desc')}</div>
                            </div>
                        </section>

                        <section class="surface">
                            <div class="surface-title">${t('help.section.preparation')}</div>
                            <div class="list">
                                <div class="list-item">${t('help.preparation.context_setup_desc')}</div>
                                <div class="list-item">${t('help.preparation.consent_desc')}</div>
                            </div>
                        </section>

                        <section class="surface wide">
                            <div class="surface-title">${t('help.section.faq')}</div>
                            <div class="list">
                                <div class="list-item">${t('help.faq.gemini_key_format')}</div>
                                <div class="list-item">${t('help.faq.gemini_auth_connection')}</div>
                                <div class="list-item">${t('help.faq.trial_slow')}</div>
                                <div class="list-item">${t('help.faq.speaker_audio_not_captured')}</div>
                                <div class="list-item">${t('help.faq.ollama_connection')}</div>
                                <div class="list-item">${t('help.faq.whisper_download')}</div>
                                <div class="list-item">${t('help.faq.audio_helper_failed')}</div>
                                <div class="list-item">${t('help.faq.transcription_stopped')}</div>
                                <div class="list-item">${t('help.faq.shortcut_not_working')}</div>
                            </div>
                        </section>

                        <!-- A7 (interim): the support link-row pointed to the upstream
                             cheatingdaddy.com / sohzm GitHub / sohzm Google Form — all
                             off-brand or dead for this product. Removed until we have our
                             own support destination (tracked under the commercialization
                             roadmap, post Gate 0). -->

                        <section class="surface">
                            <div class="surface-title">${t('help.section.license')}</div>
                            <div class="list">
                                <div class="list-item">${t('help.license.gpl_notice')}</div>
                                <div class="list-item">${t('help.license.fork_notice')}</div>
                                <div class="list-item">${t('help.license.font_notice')}</div>
                                <div class="list-item">${t('help.license.packages_notice')}</div>
                            </div>
                            <div class="link-row">
                                <button class="link-button" @click=${() => this._open('https://github.com/kintaro1221/whisper-oh-kami')}>
                                    ${t('help.link.source_code')}
                                </button>
                            </div>
                        </section>

                        ${this.renderShortcutSection()}
                    </div>
                </div>
            </div>
        `;
    }
}

customElements.define('help-view', HelpView);
