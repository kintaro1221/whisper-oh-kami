import { html, css, LitElement } from '../../assets/lit-core-2.7.4.min.js';
import { unifiedPageStyles } from './sharedPageStyles.js';

export class HistoryView extends LitElement {
    static styles = [
        unifiedPageStyles,
        css`
            .unified-page {
                overflow-y: hidden;
            }

            .unified-wrap {
                height: 100%;
            }

            .search-wrap {
                position: relative;
                max-width: 280px;
            }

            .search-icon {
                position: absolute;
                left: 10px;
                top: 50%;
                transform: translateY(-50%);
                width: 14px;
                height: 14px;
                color: var(--text-muted);
                pointer-events: none;
            }

            .search-wrap .control {
                padding-left: 30px;
            }

            .list-shell {
                border: 1px solid var(--border);
                border-radius: var(--radius-md);
                background: var(--bg-surface);
                overflow: hidden;
                flex: 1;
                display: flex;
                flex-direction: column;
                min-height: 0;
            }

            .sessions-list {
                overflow-y: auto;
                flex: 1;
            }

            .session-card {
                width: 100%;
                border: none;
                border-bottom: 1px solid var(--border);
                background: transparent;
                text-align: left;
                padding: var(--space-sm) var(--space-md);
                cursor: pointer;
                transition: background var(--transition);
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: var(--space-sm);
            }

            .session-card:hover {
                background: var(--bg-hover);
            }

            .session-left {
                display: flex;
                flex-direction: column;
                gap: 2px;
            }

            .session-profile {
                color: var(--text-primary);
                font-size: var(--font-size-sm);
            }

            .session-date {
                color: var(--text-muted);
                font-size: var(--font-size-xs);
            }

            .session-badge {
                color: var(--text-secondary);
                font-size: var(--font-size-xs);
                background: var(--bg-elevated);
                border: 1px solid var(--border);
                border-radius: var(--radius-sm);
                padding: 2px 8px;
                white-space: nowrap;
            }

            .detail-top {
                display: flex;
                align-items: center;
                gap: var(--space-sm);
            }

            .back-btn {
                border: none;
                background: none;
                color: var(--text-muted);
                padding: 0;
                font-size: var(--font-size-sm);
                cursor: pointer;
                display: flex;
                align-items: center;
            }

            .back-btn svg {
                cursor: pointer;
            }

            .back-btn:hover {
                color: var(--text-primary);
            }

            .detail-info {
                color: var(--text-secondary);
                font-size: var(--font-size-sm);
            }

            .tab-row {
                display: flex;
                gap: 6px;
            }

            .tab-btn {
                border: 1px solid var(--border);
                border-radius: var(--radius-sm);
                background: transparent;
                color: var(--text-muted);
                padding: 6px 10px;
                cursor: pointer;
                font-size: var(--font-size-xs);
            }

            .tab-btn:hover {
                color: var(--text-secondary);
            }

            .tab-btn.active {
                color: var(--text-primary);
                border-color: var(--text-secondary);
            }

            .details-scroll {
                overflow-y: auto;
                flex: 1;
                min-height: 0;
                display: flex;
                flex-direction: column;
                gap: var(--space-sm);
                padding: var(--space-sm) 0;
            }

            .message-row {
                display: flex;
            }

            .message-row.user {
                justify-content: flex-end;
            }

            .message-row.ai,
            .message-row.screen {
                justify-content: flex-start;
            }

            .message {
                max-width: 75%;
                border-radius: 16px;
                padding: 8px 12px;
                word-break: break-word;
                user-select: text;
                cursor: text;
                font-size: var(--font-size-sm);
                line-height: 1.45;
            }

            .message-body {
                white-space: pre-wrap;
            }

            .message-meta {
                font-size: 10px;
                margin-top: 4px;
                opacity: 0.5;
            }

            .message-row.user .message {
                background: var(--accent);
                color: var(--bg-app);
                border-bottom-right-radius: 4px;
            }

            .message-row.user .message-meta {
                text-align: right;
            }

            .message-row.ai .message {
                background: var(--bg-elevated);
                color: var(--text-primary);
                border: 1px solid var(--border);
                border-bottom-left-radius: 4px;
            }

            .message-row.screen .message {
                background: var(--bg-elevated);
                color: var(--text-primary);
                border: 1px solid var(--border);
                border-bottom-left-radius: 4px;
            }

            .context-row {
                display: flex;
                align-items: flex-start;
                gap: var(--space-sm);
                padding: var(--space-sm);
                border: 1px solid var(--border);
                border-radius: var(--radius-sm);
                background: var(--bg-elevated);
            }

            .context-key {
                width: 84px;
                color: var(--text-muted);
                font-size: var(--font-size-xs);
                text-transform: uppercase;
                flex-shrink: 0;
            }

            .context-value {
                color: var(--text-primary);
                font-size: var(--font-size-sm);
                line-height: 1.45;
                white-space: pre-wrap;
                word-break: break-word;
                user-select: text;
                cursor: text;
            }

            .feedback-row {
                display: flex;
                flex-direction: column;
                gap: 4px;
                padding: var(--space-sm);
                border: 1px solid var(--border);
                border-radius: var(--radius-sm);
                background: var(--bg-elevated);
            }

            .feedback-head {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: var(--space-sm);
                color: var(--text-muted);
                font-size: var(--font-size-xs);
            }

            .rating-badge {
                border: 1px solid var(--border);
                border-radius: var(--radius-sm);
                background: var(--bg-surface);
                color: var(--text-primary);
                padding: 2px 8px;
                font-size: var(--font-size-xs);
            }

            .feedback-note {
                color: var(--text-primary);
                font-size: var(--font-size-sm);
                line-height: 1.45;
                white-space: pre-wrap;
                word-break: break-word;
            }

            .empty {
                color: var(--text-muted);
                font-size: var(--font-size-sm);
                display: flex;
                align-items: center;
                justify-content: center;
                min-height: 120px;
                border: 1px dashed var(--border);
                border-radius: var(--radius-sm);
            }
        `,
    ];

    static properties = {
        sessions: { type: Array },
        selectedSession: { type: Object },
        selectedSessionId: { type: String },
        loading: { type: Boolean },
        activeTab: { type: String },
        searchQuery: { type: String },
    };

    constructor() {
        super();
        this.sessions = [];
        this.selectedSession = null;
        this.selectedSessionId = null;
        this.loading = true;
        this.activeTab = 'conversation';
        this.searchQuery = '';
        this.loadSessions();
    }

    async loadSessions() {
        try {
            this.loading = true;
            this.sessions = await whisperOhKami.storage.getAllSessions();
        } catch (error) {
            console.error('Error loading sessions:', error);
            this.sessions = [];
        } finally {
            this.loading = false;
            this.requestUpdate();
        }
    }

    async openSession(sessionId) {
        try {
            const session = await whisperOhKami.storage.getSession(sessionId);
            if (session) {
                this.selectedSession = session;
                this.selectedSessionId = sessionId;
                this.activeTab = 'conversation';
                this.requestUpdate();
            }
        } catch (error) {
            console.error('Error loading session:', error);
        }
    }

    closeSession() {
        this.selectedSession = null;
        this.selectedSessionId = null;
        this.activeTab = 'conversation';
    }

    handleSearchInput(e) {
        this.searchQuery = e.target.value;
    }

    formatDate(timestamp) {
        const date = new Date(timestamp);
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }

    formatTime(timestamp) {
        const date = new Date(timestamp);
        return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    }

    formatTimestamp(timestamp) {
        const date = new Date(timestamp);
        return date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    }

    getProfileNames() {
        return {
            // Shipped profiles.
            discovery: t('profile.discovery'),
            sales: t('profile.sales'),
            // Legacy labels: sessions recorded under now-removed profiles still
            // render a readable name in history instead of the raw stored value.
            interview: t('profile.interview'),
            meeting: t('profile.meeting'),
            presentation: t('profile.presentation'),
            negotiation: t('profile.negotiation'),
            exam: t('profile.exam'),
        };
    }

    _getProfileLabel(session) {
        if (session.profile) {
            const names = this.getProfileNames();
            return names[session.profile] || session.profile;
        }
        return t('history.session.fallback');
    }

    getSessionPreview(session) {
        const parts = [];
        if (session.messageCount > 0) parts.push(t('history.session.messages').replace('{count}', session.messageCount));
        if (session.screenAnalysisCount > 0) parts.push(t('history.session.screen').replace('{count}', session.screenAnalysisCount));
        if (session.profile) {
            const profileNames = this.getProfileNames();
            parts.push(profileNames[session.profile] || session.profile);
        }
        return parts.length > 0 ? parts.join(' · ') : t('history.session.empty');
    }

    getFilteredSessions() {
        if (!this.searchQuery.trim()) return this.sessions;
        const q = this.searchQuery.toLowerCase();
        return this.sessions.filter(session => {
            const preview = this.getSessionPreview(session).toLowerCase();
            const date = this.formatDate(session.createdAt).toLowerCase();
            return preview.includes(q) || date.includes(q);
        });
    }

    collectConversation(session) {
        const messages = [];
        const history = session.conversationHistory || [];
        history.forEach(turn => {
            if (turn.transcription) messages.push({ type: 'user', content: turn.transcription, timestamp: turn.timestamp });
            if (turn.ai_response) messages.push({ type: 'ai', content: turn.ai_response, timestamp: turn.timestamp });
        });
        return messages;
    }

    renderTabContent() {
        if (!this.selectedSession) return html`<div class="empty">${t('history.empty.select')}</div>`;

        if (this.activeTab === 'conversation') {
            const messages = this.collectConversation(this.selectedSession);
            if (!messages.length) return html`<div class="empty">${t('history.empty.no_conversation')}</div>`;
            return messages.map(
                msg => html`
                    <div class="message-row ${msg.type}">
                        <div class="message">
                            <div class="message-body">${msg.content}</div>
                            <div class="message-meta">${this.formatTime(msg.timestamp)}</div>
                        </div>
                    </div>
                `
            );
        }

        if (this.activeTab === 'screen') {
            const screen = this.selectedSession.screenAnalysisHistory || [];
            if (!screen.length) return html`<div class="empty">${t('history.empty.no_screen')}</div>`;
            return screen.map(
                entry => html`
                    <div class="message-row screen">
                        <div class="message">
                            <div class="message-body">${entry.response || ''}</div>
                            <div class="message-meta">${this.formatTime(entry.timestamp)}</div>
                        </div>
                    </div>
                `
            );
        }

        if (this.activeTab === 'feedback') {
            const feedbackEvents = Array.isArray(this.selectedSession.feedbackEvents) ? this.selectedSession.feedbackEvents : [];
            if (!feedbackEvents.length) return html`<div class="empty">${t('history.empty.no_feedback')}</div>`;
            const ratingLabels = {
                helpful: t('feedback.rating.helpful'),
                off_target: t('feedback.rating.off_target'),
                unsafe_or_risky: t('feedback.rating.unsafe'),
            };
            return feedbackEvents.map(
                event => html`
                    <div class="feedback-row">
                        <div class="feedback-head">
                            <span class="rating-badge">${ratingLabels[event.rating] || event.rating}</span>
                            <span>${this.formatTimestamp(event.timestamp)} · ${t('history.feedback.response_label')} ${Number(event.responseIndex ?? 0) + 1}</span>
                        </div>
                        <div class="feedback-note">${event.note || t('history.feedback.note_empty')}</div>
                    </div>
                `
            );
        }

        const profile = this.selectedSession.profile;
        const prompt = this.selectedSession.customPrompt;
        if (!profile && !prompt) return html`<div class="empty">${t('history.empty.no_context')}</div>`;

        return html`
            ${profile
                ? html`
                      <div class="context-row">
                          <span class="context-key">${t('history.context.profile')}</span>
                          <span class="context-value">${this.getProfileNames()[profile] || profile}</span>
                      </div>
                  `
                : ''}
            ${prompt
                ? html`
                      <div class="context-row">
                          <span class="context-key">${t('history.context.prompt')}</span>
                          <span class="context-value">${prompt}</span>
                      </div>
                  `
                : ''}
        `;
    }

    renderListView() {
        const filteredSessions = this.getFilteredSessions();
        return html`
            <div class="page-title">${t('history.title')}</div>

            <div class="search-wrap">
                <svg
                    class="search-icon"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                >
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                    class="control"
                    type="text"
                    placeholder=${t('history.search.placeholder')}
                    .value=${this.searchQuery}
                    @input=${this.handleSearchInput}
                />
            </div>

            <section class="list-shell">
                <div class="sessions-list">
                    ${this.loading ? html`<div class="empty" style="margin:var(--space-md);">${t('history.loading')}</div>` : ''}
                    ${!this.loading && filteredSessions.length === 0
                        ? html`<div class="empty" style="margin:var(--space-md);">${t('history.empty.no_match')}</div>`
                        : ''}
                    ${!this.loading
                        ? filteredSessions.map(
                              session => html`
                                  <button class="session-card" @click=${() => this.openSession(session.sessionId)}>
                                      <div class="session-left">
                                          <span class="session-profile">${this._getProfileLabel(session)}</span>
                                          <span class="session-date"
                                              >${this.formatDate(session.createdAt)} · ${this.formatTime(session.createdAt)}</span
                                          >
                                      </div>
                                      ${session.messageCount > 0 ? html`<span class="session-badge">${session.messageCount}</span>` : ''}
                                  </button>
                              `
                          )
                        : ''}
                </div>
            </section>
        `;
    }

    renderDetailView() {
        const conversationCount = this.collectConversation(this.selectedSession).length;
        const screenCount = this.selectedSession?.screenAnalysisHistory?.length || 0;
        const feedbackCount = this.selectedSession?.feedbackEvents?.length || 0;

        return html`
            <div class="page-title">${t('history.detail.title')}</div>
            <div class="detail-top">
                <button class="back-btn" @click=${this.closeSession}>
                    <svg
                        width="20"
                        height="20"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                    >
                        <polyline points="15 18 9 12 15 6" />
                    </svg>
                </button>
                <span class="detail-info"
                    >${this._getProfileLabel(this.selectedSession)} · ${this.formatDate(this.selectedSession.createdAt)} ·
                    ${this.formatTime(this.selectedSession.createdAt)}</span
                >
            </div>
            <div class="tab-row">
                <button
                    class="tab-btn ${this.activeTab === 'conversation' ? 'active' : ''}"
                    @click=${() => {
                        this.activeTab = 'conversation';
                    }}
                >
                    ${t('history.tab.conversation')} (${conversationCount})
                </button>
                <button
                    class="tab-btn ${this.activeTab === 'screen' ? 'active' : ''}"
                    @click=${() => {
                        this.activeTab = 'screen';
                    }}
                >
                    ${t('history.tab.screen')} (${screenCount})
                </button>
                <button
                    class="tab-btn ${this.activeTab === 'context' ? 'active' : ''}"
                    @click=${() => {
                        this.activeTab = 'context';
                    }}
                >
                    ${t('history.tab.context')}
                </button>
                <button
                    class="tab-btn ${this.activeTab === 'feedback' ? 'active' : ''}"
                    @click=${() => {
                        this.activeTab = 'feedback';
                    }}
                >
                    ${t('history.tab.feedback')} (${feedbackCount})
                </button>
            </div>
            <section class="details-scroll">${this.renderTabContent()}</section>
        `;
    }

    render() {
        return html`
            <div class="unified-page">
                <div class="unified-wrap">${this.selectedSession ? this.renderDetailView() : this.renderListView()}</div>
            </div>
        `;
    }
}

customElements.define('history-view', HistoryView);
