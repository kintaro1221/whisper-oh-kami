import { html, css, LitElement } from '../../assets/lit-core-2.7.4.min.js';
import { unifiedPageStyles } from './sharedPageStyles.js';

export class AICustomizeView extends LitElement {
    static styles = [
        unifiedPageStyles,
        css`
            .unified-page {
                height: 100%;
            }

            /* Header: title + plain-language framing + a single save status. */
            .page-header {
                display: flex;
                align-items: flex-start;
                justify-content: space-between;
                gap: var(--space-md);
                flex-wrap: wrap;
            }
            .page-heading {
                flex: 1;
                min-width: 260px;
            }
            .page-subtitle {
                line-height: var(--line-height-reading);
            }
            /* The bar (課題/予算/...) is what the meeting *hears*; this screen is the
               standing context. Spell that out so the two never feel contradictory. */
            .framing-note {
                margin-top: 6px;
                font-size: var(--font-size-xs);
                color: var(--text-muted);
                line-height: 1.6;
            }
            .framing-note .em {
                color: var(--accent);
                font-weight: var(--font-weight-medium);
            }
            .save-slot {
                min-height: 22px;
            }
            .save-status {
                display: inline-flex;
                align-items: center;
                gap: 5px;
                white-space: nowrap;
                border: 1px solid var(--border);
                border-radius: 999px;
                padding: 3px 10px;
                font-size: var(--font-size-xs);
                background: var(--bg-surface);
            }
            .save-status.saved {
                color: var(--success);
            }
            .save-status.saving {
                color: var(--warning);
            }

            /* Proposal-mode segment (was a bare select with technical help text). */
            .mode-bar {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: var(--space-md);
                flex-wrap: wrap;
            }
            .mode-title {
                font-size: var(--font-size-sm);
                font-weight: var(--font-weight-semibold);
                color: var(--text-primary);
            }
            .mode-desc {
                font-size: var(--font-size-xs);
                color: var(--text-muted);
                margin-top: 2px;
            }
            .seg {
                display: inline-flex;
                border: 1px solid var(--border-strong);
                border-radius: var(--radius-md);
                overflow: hidden;
            }
            .seg-btn {
                appearance: none;
                border: none;
                background: var(--bg-elevated);
                color: var(--text-secondary);
                font-family: var(--font);
                font-size: var(--font-size-sm);
                padding: 8px 16px;
                cursor: pointer;
                transition:
                    background var(--transition),
                    color var(--transition);
            }
            .seg-btn + .seg-btn {
                border-left: 1px solid var(--border-strong);
            }
            .seg-btn:hover:not(.on) {
                background: var(--bg-hover);
            }
            .seg-btn.on {
                background: var(--accent);
                color: #ffffff;
                font-weight: var(--font-weight-medium);
            }
            .seg-btn:focus-visible {
                outline: none;
                box-shadow: inset 0 0 0 2px var(--accent);
            }

            /* Grouped sections (was a flat 2-col grid of identical textareas). */
            .section-head {
                display: flex;
                align-items: center;
                gap: var(--space-sm);
            }
            .num-badge {
                color: var(--accent);
                font-size: var(--font-size-lg);
                font-weight: var(--font-weight-semibold);
                line-height: 1;
            }
            .section-name {
                font-size: var(--font-size-lg);
                font-weight: var(--font-weight-semibold);
                color: var(--text-primary);
            }
            .optional {
                color: var(--text-muted);
                font-size: var(--font-size-xs);
                font-weight: var(--font-weight-normal);
                margin-left: 4px;
            }
            .achieved {
                color: var(--success);
                font-size: var(--font-size-xs);
                font-weight: var(--font-weight-medium);
            }
            .section-desc {
                font-size: var(--font-size-xs);
                color: var(--text-muted);
                margin: 2px 0 var(--space-md) 28px;
                line-height: 1.5;
            }
            .section-fields {
                display: flex;
                flex-direction: column;
                gap: var(--space-md);
            }

            /* Reserve the active-accent gutter on every field so focusing one does
               not reflow the layout — only the color changes. */
            .field {
                display: flex;
                flex-direction: column;
                gap: 5px;
                border-left: 2px solid transparent;
                padding-left: 10px;
                margin-left: -12px;
            }
            .field.field-active {
                border-left-color: var(--accent);
            }
            .field-label {
                font-size: var(--font-size-sm);
                color: var(--text-secondary);
                font-weight: var(--font-weight-medium);
            }
            .field-help {
                font-size: var(--font-size-xs);
                color: var(--text-muted);
                line-height: 1.5;
            }
            textarea.control.oneline {
                min-height: 38px;
                resize: none;
            }

            .footer-note {
                display: flex;
                align-items: flex-start;
                gap: 7px;
                font-size: var(--font-size-xs);
                color: var(--text-muted);
                line-height: 1.6;
                margin-top: var(--space-sm);
            }
            .footer-check {
                color: var(--success);
                font-weight: var(--font-weight-semibold);
            }

            @media (max-width: 640px) {
                .seg {
                    width: 100%;
                }
                .seg-btn {
                    flex: 1;
                }
            }
        `,
    ];

    static properties = {
        selectedProfile: { type: String },
        onProfileChange: { type: Function },
        _contextProfile: { state: true },
        _legacyHint: { state: true },
        _saveStatus: { state: true },
        _activeField: { state: true },
    };

    constructor() {
        super();
        this.selectedProfile = 'sales';
        this.onProfileChange = () => {};
        this._contextProfile = {};
        // Captured from prefs.customPrompt on first load when it differs from
        // what the structured contextProfile would generate — surfaced as a
        // placeholder in the freeInstruction textarea so the user can see what
        // their legacy free-form prompt was before the first structured save
        // overwrites prefs.customPrompt with the auto-generated form.
        this._legacyHint = '';
        // 'idle' | 'saving' | 'saved' — single autosave indicator in the header.
        this._saveStatus = 'idle';
        this._activeField = '';
        this._saveStatusTimer = null;
        this._loadFromStorage();
    }

    _contextPrompt() {
        return require('./utils/contextPrompt');
    }

    _hasContextProfileContent(profile) {
        return Object.entries(profile || {}).some(([key, value]) => key !== 'updatedAt' && typeof value === 'string' && value.trim());
    }

    async _loadFromStorage() {
        try {
            const { normalizeContextProfile, buildCustomPromptFromContext } = this._contextPrompt();
            const prefs = await whisperOhKami.storage.getPreferences();
            const normalized = normalizeContextProfile(prefs.contextProfile || {});
            const legacy = (prefs.customPrompt || '').trim();
            const derivedFromContext = buildCustomPromptFromContext(normalized, '');

            if (!this._hasContextProfileContent(normalized) && legacy) {
                // Pure legacy state: pull customPrompt directly into freeInstruction
                // so the user can edit it without losing the value on first save.
                normalized.freeInstruction = legacy;
            } else if (legacy && legacy !== derivedFromContext && !normalized.freeInstruction) {
                // Mixed state: contextProfile already has content AND legacy
                // customPrompt is something different (not the auto-derived form).
                // Surface as a placeholder hint in the freeInstruction textarea
                // so the user notices before the next structured save overwrites
                // prefs.customPrompt with the auto-generated form.
                this._legacyHint = legacy;
            }

            this._contextProfile = normalized;
            this.requestUpdate();
        } catch (error) {
            console.error('Error loading AI customize storage:', error);
        }
    }

    _selectProfile(value) {
        if (value === this.selectedProfile) return;
        this.selectedProfile = value;
        this.onProfileChange(value);
    }

    async _saveField(field, value) {
        const { buildCustomPromptFromContext, normalizeContextProfile } = this._contextPrompt();
        const nextProfile = normalizeContextProfile({
            ...this._contextProfile,
            [field]: value,
            updatedAt: Date.now(),
        });
        this._contextProfile = nextProfile;
        this._saveStatus = 'saving';
        // Save contract unchanged: structured contextProfile + the prompt it
        // derives, written together so a session pickup stays consistent.
        await whisperOhKami.storage.setPreferences({
            contextProfile: nextProfile,
            customPrompt: buildCustomPromptFromContext(nextProfile, ''),
        });
        if (whisperOhKami.refreshPreferencesCache) {
            await whisperOhKami.refreshPreferencesCache();
        }
        this._saveStatus = 'saved';
        clearTimeout(this._saveStatusTimer);
        this._saveStatusTimer = setTimeout(() => {
            this._saveStatus = 'idle';
            this.requestUpdate();
        }, 1400);
    }

    // The 3 fields that make the AI's suggestions usefully grounded. When all
    // three are present we give a quiet "土台はOK" nod — no nagging meter.
    _requiredFilled() {
        const p = this._contextProfile || {};
        return ['companyProduct', 'targetCustomer', 'meetingGoal'].every(key => (p[key] || '').trim());
    }

    // Grouped in the order a salesperson thinks: self → counterpart → this
    // meeting → free instruction. All 6 keys + 2 profiles are unchanged.
    _getSections() {
        return [
            {
                n: 1,
                name: t('aicx.section1_name'),
                desc: t('aicx.section1_desc'),
                fields: [
                    {
                        key: 'companyProduct',
                        label: t('aicx.field_company_product_label'),
                        oneline: true,
                        placeholder: t('aicx.field_company_product_placeholder'),
                        help: t('aicx.field_company_product_help'),
                    },
                ],
            },
            {
                n: 2,
                name: t('aicx.section2_name'),
                desc: t('aicx.section2_desc'),
                fields: [
                    {
                        key: 'targetCustomer',
                        label: t('aicx.field_target_customer_label'),
                        oneline: true,
                        placeholder: t('aicx.field_target_customer_placeholder'),
                        help: t('aicx.field_target_customer_help'),
                    },
                    {
                        key: 'customerBackground',
                        label: t('aicx.field_customer_background_label'),
                        optional: true,
                        minHeight: 60,
                        placeholder: t('aicx.field_customer_background_placeholder'),
                        help: t('aicx.field_customer_background_help'),
                    },
                ],
            },
            {
                n: 3,
                name: t('aicx.section3_name'),
                desc: t('aicx.section3_desc'),
                achieved: true,
                fields: [
                    {
                        key: 'meetingGoal',
                        label: t('aicx.field_meeting_goal_label'),
                        oneline: true,
                        placeholder: t('aicx.field_meeting_goal_placeholder'),
                        help: t('aicx.field_meeting_goal_help'),
                    },
                    {
                        key: 'constraints',
                        label: t('aicx.field_constraints_label'),
                        optional: true,
                        minHeight: 56,
                        placeholder: t('aicx.field_constraints_placeholder'),
                        help: t('aicx.field_constraints_help'),
                    },
                ],
            },
            {
                n: 4,
                name: t('aicx.section4_name'),
                optional: true,
                desc: t('aicx.section4_desc'),
                fields: [
                    {
                        key: 'freeInstruction',
                        free: true,
                        minHeight: 110,
                        placeholder: t('aicx.field_free_instruction_placeholder'),
                    },
                ],
            },
        ];
    }

    _renderSaveStatus() {
        return html`
            <div class="save-slot" aria-live="polite">
                ${this._saveStatus === 'saving' ? html`<span class="save-status saving">${t('aicx.status_saving')}</span>` : ''}
                ${this._saveStatus === 'saved' ? html`<span class="save-status saved">${t('aicx.status_saved')}</span>` : ''}
            </div>
        `;
    }

    _renderModeBar() {
        const profiles = [
            { value: 'discovery', label: t('profile.discovery') },
            { value: 'sales', label: t('profile.sales') },
        ];
        return html`
            <section class="surface mode-bar">
                <div class="mode-label">
                    <div class="mode-title">${t('aicx.mode_title')}</div>
                    <div class="mode-desc">${t('aicx.mode_desc')}</div>
                </div>
                <div class="seg" role="radiogroup" aria-label="${t('aicx.radiogroup_label')}">
                    ${profiles.map(
                        profile => html`
                            <button
                                type="button"
                                class="seg-btn ${this.selectedProfile === profile.value ? 'on' : ''}"
                                role="radio"
                                aria-checked=${this.selectedProfile === profile.value ? 'true' : 'false'}
                                @click=${() => this._selectProfile(profile.value)}
                            >
                                ${profile.label}
                            </button>
                        `
                    )}
                </div>
            </section>
        `;
    }

    _renderField(field) {
        const value = this._contextProfile[field.key] || '';
        const showLegacyHint = field.free && this._legacyHint && !value.trim();
        const placeholder = showLegacyHint ? t('aicx.legacy_hint_template').replace('{hint}', this._legacyHint) : field.placeholder;
        const fieldId = `aicx-${field.key}`;
        const helpId = field.help ? `${fieldId}-help` : null;
        return html`
            <div class="field ${this._activeField === field.key ? 'field-active' : ''}">
                ${field.label
                    ? html`<label class="field-label" for=${fieldId}
                          >${field.label}${field.optional ? html`<span class="optional">${t('aicx.optional_label')}</span>` : ''}</label
                      >`
                    : ''}
                <textarea
                    id=${fieldId}
                    class="control ${field.oneline ? 'oneline' : ''}"
                    style=${field.oneline ? '' : `min-height:${field.minHeight || 100}px`}
                    placeholder=${placeholder}
                    aria-describedby=${helpId}
                    .value=${value}
                    @focus=${() => {
                        this._activeField = field.key;
                    }}
                    @blur=${() => {
                        if (this._activeField === field.key) this._activeField = '';
                    }}
                    @input=${e => this._saveField(field.key, e.target.value)}
                ></textarea>
                ${field.help ? html`<div class="field-help" id=${helpId}>${field.help}</div>` : ''}
            </div>
        `;
    }

    _renderSection(section) {
        const circled = ['①', '②', '③', '④'][section.n - 1] || String(section.n);
        const achieved = section.achieved && this._requiredFilled();
        return html`
            <section class="surface">
                <div class="section-head">
                    <span class="num-badge" aria-hidden="true">${circled}</span>
                    <span class="section-name">${section.name}${section.optional ? html`<span class="optional">${t('aicx.optional_label')}</span>` : ''}</span>
                    ${achieved ? html`<span class="achieved">${t('aicx.achieved_message')}</span>` : ''}
                </div>
                <div class="section-desc">${section.desc}</div>
                <div class="section-fields">${section.fields.map(field => this._renderField(field))}</div>
            </section>
        `;
    }

    render() {
        return html`
            <div class="unified-page">
                <div class="unified-wrap">
                    <div class="page-header">
                        <div class="page-heading">
                            <div class="page-title">${t('aicx.page_title')}</div>
                            <div class="page-subtitle">${t('aicx.page_subtitle')}</div>
                            <div class="framing-note">
                                ${t('aicx.framing_note_main')}<span class="em"
                                    >${t('aicx.framing_note_emphasis')}</span
                                >
                            </div>
                        </div>
                        ${this._renderSaveStatus()}
                    </div>

                    ${this._renderModeBar()} ${this._getSections().map(section => this._renderSection(section))}

                    <div class="footer-note">
                        <span class="footer-check" aria-hidden="true">✓</span>
                        <span
                            >${t('aicx.footer_note')}</span
                        >
                    </div>
                </div>
            </div>
        `;
    }
}

customElements.define('ai-customize-view', AICustomizeView);
