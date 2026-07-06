import { html, css, LitElement } from '../../assets/lit-core-2.7.4.min.js';
import { brandMark } from '../../assets/brand-mark.js';

export class OnboardingView extends LitElement {
    static styles = css`
        * {
            font-family: var(--font);
            cursor: default;
            user-select: none;
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        :host {
            display: block;
            height: 100%;
            width: 100%;
            position: fixed;
            top: 0;
            left: 0;
            overflow: hidden;
        }

        .onboarding {
            width: 100%;
            height: 100%;
            position: relative;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 12px;
            border: 1px solid var(--border);
            overflow: hidden;
            background: var(--bg-app);
        }

        canvas.aurora {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            z-index: 0;
        }

        canvas.dither {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            z-index: 1;
            opacity: 0.12;
            mix-blend-mode: overlay;
            pointer-events: none;
            image-rendering: pixelated;
        }

        .slide {
            position: relative;
            z-index: 2;
            display: flex;
            flex-direction: column;
            align-items: center;
            text-align: center;
            max-width: 400px;
            padding: var(--space-xl);
            gap: var(--space-md);
        }

        /* 狭い window では slide を full-width に開放、padding も少し詰める。 */
        @media (max-width: 700px) {
            .slide {
                max-width: 100%;
                padding: var(--space-md);
            }
        }

        .slide-title {
            font-size: 28px;
            font-weight: 600;
            color: var(--text-primary);
            line-height: 1.2;
        }

        .slide-brand-mark {
            color: var(--text-primary);
            display: inline-flex;
            margin-bottom: var(--space-xs);
        }

        .slide-brand-sub {
            font-size: 13px;
            color: var(--text-muted);
            letter-spacing: 0.04em;
            margin-top: calc(-1 * var(--space-xs));
        }

        .slide-text {
            font-size: 13px;
            line-height: 1.5;
            color: var(--text-muted);
        }

        .context-input {
            width: 100%;
            min-height: 120px;
            padding: 12px;
            border: 1px solid var(--border);
            border-radius: 8px;
            /* aurora-through を意図した translucent overlay。token 化は dark theme 復活時に再検討。 */
            background: rgba(255, 255, 255, 0.7);
            backdrop-filter: blur(8px);
            color: var(--text-primary);
            font-size: 13px;
            font-family: var(--font);
            line-height: 1.5;
            resize: vertical;
            text-align: left;
        }

        .context-input::placeholder {
            color: var(--text-muted);
        }

        .context-input:focus {
            outline: none;
            border-color: var(--border-strong);
        }

        .actions {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 8px;
            margin-top: 8px;
        }

        .btn-primary {
            background: var(--btn-primary-bg);
            border: none;
            color: var(--btn-primary-text);
            padding: 10px 32px;
            border-radius: 8px;
            font-size: 13px;
            font-weight: 500;
            cursor: pointer;
            transition: opacity 0.15s;
        }

        .btn-primary:hover {
            opacity: 0.85;
        }

        .btn-back {
            background: none;
            border: none;
            color: var(--text-muted);
            font-size: 11px;
            cursor: pointer;
            padding: 4px 8px;
        }

        .btn-back:hover {
            color: var(--text-secondary);
        }

        .mode-cards {
            display: flex;
            flex-direction: column;
            gap: var(--space-sm);
            width: 100%;
        }

        .mode-card {
            text-align: left;
            padding: 12px 14px;
            border: 1px solid var(--border);
            border-radius: 8px;
            background: rgba(255, 255, 255, 0.7);
            backdrop-filter: blur(8px);
            cursor: pointer;
            transition:
                border-color 0.15s,
                background 0.15s;
        }

        .mode-card:hover {
            border-color: var(--border-strong);
            background: rgba(255, 255, 255, 0.85);
        }

        .mode-card-label {
            font-size: 14px;
            font-weight: 600;
            color: var(--text-primary);
        }

        .mode-card-desc {
            font-size: 12px;
            color: var(--text-muted);
            margin-top: 2px;
            line-height: 1.4;
        }

        .slide-note {
            font-size: 11px;
            color: var(--text-muted);
            line-height: 1.4;
        }
    `;

    static properties = {
        currentSlide: { type: Number },
        contextText: { type: String },
        onComplete: { type: Function },
    };

    constructor() {
        super();
        this.currentSlide = 0;
        this.contextText = '';
        this.onComplete = () => {};
    }

    firstUpdated() {
        const { startAurora } = require('./utils/aurora');
        this._auroraHandle = startAurora(this.shadowRoot.querySelector('canvas.aurora'), this.shadowRoot.querySelector('canvas.dither'), {
            intensity: 'strong',
        });
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        if (this._auroraHandle) {
            const { stopAurora } = require('./utils/aurora');
            stopAurora(this._auroraHandle);
            this._auroraHandle = null;
        }
    }

    handleContextInput(e) {
        this.contextText = e.target.value;
    }

    // B1-2: persist the chosen provider mode so MainView opens in it, then
    // advance to the context step.
    async _selectMode(mode) {
        await whisperOhKami.storage.updatePreference('providerMode', mode);
        this.currentSlide = 2;
    }

    async completeOnboarding() {
        if (this.contextText.trim()) {
            const { normalizeContextProfile } = require('./utils/contextPrompt');
            const freeInstruction = this.contextText.trim();
            await whisperOhKami.storage.setPreferences({
                customPrompt: freeInstruction,
                contextProfile: normalizeContextProfile({
                    freeInstruction,
                    updatedAt: Date.now(),
                }),
            });
        }
        await whisperOhKami.storage.updateConfig('onboarded', true);
        this.onComplete();
    }

    renderSlide() {
        if (this.currentSlide === 0) {
            return html`
                <div class="slide">
                    <div class="slide-brand-mark">${brandMark(72)}</div>
                    <div class="slide-title">WhisperOhKAMI</div>
                    <div class="slide-brand-sub">${t('brand.tagline')}</div>
                    <div class="slide-text">${t('onboarding.slide1.body')}</div>
                    <div class="actions">
                        <button
                            class="btn-primary"
                            @click=${() => {
                                this.currentSlide = 1;
                            }}
                        >
                            ${t('onboarding.button.continue')}
                        </button>
                    </div>
                </div>
            `;
        }

        if (this.currentSlide === 1) {
            const modes = [
                { mode: 'trial', label: t('onboarding.mode.trial.label'), desc: t('onboarding.mode.trial.desc') },
                { mode: 'byok', label: t('onboarding.mode.byok.label'), desc: t('onboarding.mode.byok.desc') },
                { mode: 'local', label: t('onboarding.mode.local.label'), desc: t('onboarding.mode.local.desc') },
            ];
            return html`
                <div class="slide">
                    <div class="slide-title">${t('onboarding.mode.title')}</div>
                    <div class="mode-cards">
                        ${modes.map(
                            m => html`
                                <button class="mode-card" @click=${() => this._selectMode(m.mode)}>
                                    <div class="mode-card-label">${m.label}</div>
                                    <div class="mode-card-desc">${m.desc}</div>
                                </button>
                            `
                        )}
                    </div>
                    <div class="slide-note">${t('onboarding.mode.note')}</div>
                    <div class="actions">
                        <button
                            class="btn-back"
                            @click=${() => {
                                this.currentSlide = 0;
                            }}
                        >
                            ${t('onboarding.button.back')}
                        </button>
                    </div>
                </div>
            `;
        }

        return html`
            <div class="slide">
                <div class="slide-title">${t('onboarding.slide2.title')}</div>
                <div class="slide-text">${t('onboarding.slide2.body')}</div>
                <textarea
                    class="context-input"
                    placeholder=${t('onboarding.slide2.placeholder')}
                    .value=${this.contextText}
                    @input=${this.handleContextInput}
                ></textarea>
                <div class="slide-note">${t('onboarding.slide2.skip_note')}</div>
                <div class="actions">
                    <button class="btn-primary" @click=${this.completeOnboarding}>${t('onboarding.button.get_started')}</button>
                    <button
                        class="btn-back"
                        @click=${() => {
                            this.currentSlide = 1;
                        }}
                    >
                        ${t('onboarding.button.back')}
                    </button>
                </div>
            </div>
        `;
    }

    render() {
        return html`
            <div class="onboarding">
                <canvas class="aurora"></canvas>
                <canvas class="dither"></canvas>
                ${this.renderSlide()}
            </div>
        `;
    }
}

customElements.define('onboarding-view', OnboardingView);
