import { html, css, LitElement } from '../../assets/lit-core-2.7.4.min.js';
import { unifiedPageStyles } from './sharedPageStyles.js';

// [要記入] サポート/フィードバック窓口のメールアドレス。設定すると「メールで送る」
// ボタンが mailto で開きます。空のあいだは「準備中」表示に graceful degrade。
// （以前はここで上流 sohzm の Google フォームを iframe 埋め込みしていたが、送信先
//  が別作者かつ第三者フォーム読み込みが privacy 訴求と矛盾するため撤去した。）
const SUPPORT_EMAIL = '';

export class FeedbackView extends LitElement {
    static styles = [
        unifiedPageStyles,
        css`
            .feedback-lead {
                font-size: var(--font-size-sm);
                color: var(--text-primary);
                line-height: var(--line-height-reading);
            }
            .feedback-note {
                font-size: var(--font-size-xs);
                color: var(--text-muted);
                line-height: 1.6;
                margin-top: var(--space-sm);
            }
            .email-btn {
                appearance: none;
                border: 1px solid var(--border-strong);
                background: var(--bg-elevated);
                color: var(--text-primary);
                font-family: var(--font);
                font-size: var(--font-size-sm);
                padding: 8px 16px;
                border-radius: var(--radius-sm);
                cursor: pointer;
                margin-top: var(--space-md);
                transition:
                    background var(--transition),
                    border-color var(--transition);
            }
            .email-btn:hover {
                background: var(--bg-hover);
                border-color: var(--accent);
            }
            .email-btn:focus-visible {
                outline: none;
                box-shadow: 0 0 0 2px var(--accent);
            }
            .feedback-pending {
                font-size: var(--font-size-sm);
                color: var(--text-muted);
                margin-top: var(--space-md);
            }
        `,
    ];

    static properties = {
        onExternalLink: { type: Function },
    };

    constructor() {
        super();
        this.onExternalLink = () => {};
    }

    _sendEmail() {
        if (!SUPPORT_EMAIL) return;
        const subject = encodeURIComponent('WhisperOhKAMI フィードバック');
        // shell.openExternal (via onExternalLink) handles mailto: — opens the
        // user's mail client. Nothing is sent automatically.
        this.onExternalLink(`mailto:${SUPPORT_EMAIL}?subject=${subject}`);
    }

    render() {
        return html`
            <div class="unified-page">
                <div class="unified-wrap">
                    <div class="page-title">${t('feedback.title')}</div>

                    <section class="surface">
                        <div class="feedback-lead">${t('feedback.lead')}</div>
                        <div class="feedback-note">${t('feedback.privacy_note')}</div>
                        <div class="feedback-note">${t('feedback.local_note')}</div>
                        ${SUPPORT_EMAIL
                            ? html`<button class="email-btn" @click=${() => this._sendEmail()}>${t('feedback.email_button')}</button>`
                            : html`<div class="feedback-pending">${t('feedback.pending')}</div>`}
                    </section>
                </div>
            </div>
        `;
    }
}

customElements.define('feedback-view', FeedbackView);
