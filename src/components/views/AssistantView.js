import { html, css, LitElement } from '../../assets/lit-core-2.7.4.min.js';

export class AssistantView extends LitElement {
    static styles = css`
        :host {
            height: 100%;
            display: flex;
            flex-direction: column;
        }

        * {
            font-family: var(--font);
            cursor: default;
        }

        .workbench {
            flex: 1;
            min-height: 0;
            display: grid;
            grid-template-columns: minmax(0, 1fr) 280px;
            background: var(--bg-app);
        }

        .workbench-main {
            min-width: 0;
            min-height: 0;
            display: flex;
            flex-direction: column;
            border-right: 1px solid var(--border);
        }

        .workbench-rail {
            min-width: 0;
            overflow-y: auto;
            background: var(--bg-surface);
            padding: var(--space-sm);
            display: flex;
            flex-direction: column;
            gap: var(--space-sm);
        }

        .rail-section {
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
            background: var(--bg-elevated);
            padding: var(--space-sm);
            display: flex;
            flex-direction: column;
            gap: var(--space-xs);
        }

        .rail-title {
            /* <h3> for screen-reader heading navigation; reset browser defaults
               so the rail-section gap and visual rhythm match the original
               <div>-based layout. */
            margin: 0;
            color: var(--text-primary);
            font-weight: var(--font-weight-semibold);
            font-size: var(--font-size-xs);
            line-height: 1.45;
        }

        .rail-muted,
        .rail-line {
            color: var(--text-secondary);
            font-size: var(--font-size-xs);
            line-height: 1.45;
            word-break: break-word;
        }

        .rail-context-row {
            display: grid;
            grid-template-columns: 72px minmax(0, 1fr);
            gap: var(--space-xs);
            font-size: var(--font-size-xs);
            line-height: 1.45;
        }

        .rail-context-key {
            color: var(--text-muted);
            white-space: nowrap;
        }

        .rail-context-value {
            color: var(--text-primary);
            word-break: break-word;
        }

        .rail-chip-row {
            display: flex;
            flex-wrap: wrap;
            gap: 4px;
        }

        .rail-chip {
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
            padding: 2px 6px;
            color: var(--text-secondary);
            background: var(--bg-surface);
            font-size: var(--font-size-xs);
        }

        .rail-chip.partial {
            border-color: var(--warning);
            color: var(--warning);
        }

        .feedback-actions {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 4px;
        }

        .feedback-btn {
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
            background: var(--bg-surface);
            color: var(--text-primary);
            font-size: var(--font-size-xs);
            padding: 5px 4px;
            cursor: pointer;
            white-space: nowrap;
        }

        .feedback-btn:hover:not(:disabled) {
            border-color: var(--accent);
        }

        .feedback-btn:disabled {
            opacity: 0.45;
            cursor: default;
        }

        .feedback-note {
            min-height: 56px;
            resize: vertical;
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
            background: var(--bg-surface);
            color: var(--text-primary);
            font-size: var(--font-size-xs);
            line-height: 1.45;
            padding: 6px;
            outline: none;
        }

        .feedback-note:focus {
            border-color: var(--accent);
        }

        .feedback-status {
            min-height: 16px;
            color: var(--text-muted);
            font-size: var(--font-size-xs);
        }

        /* ── Transcription panel (live STT) ── */

        .transcription-panel {
            flex: 1;
            overflow-y: auto;
            font-size: var(--response-font-size, 15px);
            line-height: var(--line-height);
            background: var(--bg-surface);
            padding: var(--space-sm) var(--space-md);
            scroll-behavior: smooth;
            user-select: text;
            cursor: text;
            color: var(--text-primary);
            border-bottom: 1px solid var(--border);
            display: flex;
            flex-direction: column;
            gap: 4px;
        }

        .transcription-panel::-webkit-scrollbar {
            width: 6px;
        }

        .transcription-panel::-webkit-scrollbar-track {
            background: transparent;
        }

        .transcription-panel::-webkit-scrollbar-thumb {
            background: var(--border-strong);
            border-radius: 3px;
        }

        .transcription-empty {
            color: var(--text-muted);
            font-size: var(--font-size-xs);
            font-style: italic;
            text-align: center;
            margin-top: var(--space-md);
        }

        .transcription-segment {
            padding: 4px 8px;
            border-radius: var(--radius-sm);
            white-space: pre-wrap;
            word-break: break-word;
        }

        .transcription-segment.speaker-1 {
            /* 相手 — success系 (Direction A palette) */
            background: rgba(31, 157, 87, 0.1);
            border-left: 3px solid var(--success);
            align-self: flex-start;
            max-width: 92%;
        }

        .transcription-segment.speaker-2 {
            /* 自分 — accent (navy) 系 */
            background: rgba(31, 58, 95, 0.1);
            border-left: 3px solid var(--accent);
            align-self: flex-end;
            max-width: 92%;
        }

        .transcription-segment.output {
            background: rgba(160, 174, 192, 0.1);
            border-left: 3px solid var(--text-muted);
            color: var(--text-muted);
            font-size: 0.92em;
            font-style: italic;
            align-self: stretch;
        }

        .transcription-interim {
            padding: 4px 8px;
            border-radius: var(--radius-sm);
            background: rgba(31, 58, 95, 0.06);
            border-left: 3px dashed var(--accent);
            color: var(--text-muted);
            opacity: 0.75;
            font-style: italic;
            align-self: flex-end;
            max-width: 92%;
            white-space: pre-wrap;
            word-break: break-word;
        }

        /* ── Response area ── */

        .response-container {
            flex: 1;
            overflow-y: auto;
            font-size: var(--response-font-size, 15px);
            line-height: var(--line-height);
            background: var(--bg-app);
            padding: var(--space-sm) var(--space-md);
            scroll-behavior: smooth;
            user-select: text;
            cursor: text;
            color: var(--text-primary);
        }

        .response-container * {
            user-select: text;
            cursor: text;
        }

        .response-container a {
            cursor: pointer;
        }

        .response-container [data-word] {
            display: inline-block;
        }

        /* ── Markdown ── */

        .response-container h1,
        .response-container h2,
        .response-container h3,
        .response-container h4,
        .response-container h5,
        .response-container h6 {
            margin: 1em 0 0.5em 0;
            color: var(--text-primary);
            font-weight: var(--font-weight-semibold);
        }

        .response-container h1 {
            font-size: 1.5em;
        }
        .response-container h2 {
            font-size: 1.3em;
        }
        .response-container h3 {
            font-size: 1.15em;
        }
        .response-container h4 {
            font-size: 1.05em;
        }
        .response-container h5,
        .response-container h6 {
            font-size: 1em;
        }

        .response-container p {
            margin: 0.6em 0;
            color: var(--text-primary);
        }

        .response-container ul,
        .response-container ol {
            margin: 0.6em 0;
            padding-left: 1.5em;
            color: var(--text-primary);
        }

        .response-container li {
            margin: 0.3em 0;
        }

        .response-container blockquote {
            margin: 0.8em 0;
            padding: 0.5em 1em;
            border-left: 2px solid var(--border-strong);
            background: var(--bg-surface);
            border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
        }

        .response-container code {
            background: var(--bg-elevated);
            padding: 0.15em 0.4em;
            border-radius: var(--radius-sm);
            font-family: var(--font-mono);
            font-size: 0.85em;
        }

        .response-container pre {
            background: var(--bg-surface);
            border: 1px solid var(--border);
            border-radius: var(--radius-md);
            padding: var(--space-md);
            overflow-x: auto;
            margin: 0.8em 0;
        }

        .response-container pre code {
            background: none;
            padding: 0;
        }

        .response-container a {
            color: var(--accent);
            text-decoration: underline;
            text-underline-offset: 2px;
        }

        .response-container strong,
        .response-container b {
            font-weight: var(--font-weight-semibold);
        }

        .response-container hr {
            border: none;
            border-top: 1px solid var(--border);
            margin: 1.5em 0;
        }

        .response-container table {
            border-collapse: collapse;
            width: 100%;
            margin: 0.8em 0;
        }

        .response-container th,
        .response-container td {
            border: 1px solid var(--border);
            padding: var(--space-sm);
            text-align: left;
        }

        .response-container th {
            background: var(--bg-surface);
            font-weight: var(--font-weight-semibold);
        }

        .response-container::-webkit-scrollbar {
            width: 6px;
        }

        .response-container::-webkit-scrollbar-track {
            background: transparent;
        }

        .response-container::-webkit-scrollbar-thumb {
            background: var(--border-strong);
            border-radius: 3px;
        }

        .response-container::-webkit-scrollbar-thumb:hover {
            background: #444444;
        }

        /* ── Response navigation strip ── */

        .response-nav {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: var(--space-sm);
            padding: var(--space-xs) var(--space-md);
            border-top: 1px solid var(--border);
            background: var(--bg-app);
        }

        .nav-btn {
            background: none;
            border: none;
            color: var(--text-muted);
            cursor: pointer;
            padding: var(--space-xs);
            border-radius: var(--radius-sm);
            display: flex;
            align-items: center;
            justify-content: center;
            transition: color var(--transition);
        }

        .nav-btn:hover:not(:disabled) {
            color: var(--text-primary);
        }

        .nav-btn:disabled {
            opacity: 0.25;
            cursor: default;
        }

        .nav-btn svg {
            width: 14px;
            height: 14px;
        }

        .response-counter {
            font-size: var(--font-size-xs);
            color: var(--text-muted);
            font-family: var(--font-mono);
            min-width: 40px;
            text-align: center;
        }

        /* ── Bottom input bar ── */

        .input-bar {
            display: flex;
            align-items: center;
            gap: var(--space-sm);
            padding: var(--space-md);
            background: var(--bg-app);
        }

        .input-bar-inner {
            display: flex;
            align-items: center;
            flex: 1;
            background: var(--bg-elevated);
            border: 1px solid var(--border);
            border-radius: 100px;
            padding: 0 var(--space-md);
            height: 32px;
            transition: border-color var(--transition);
        }

        .input-bar-inner:focus-within {
            border-color: var(--accent);
        }

        .input-bar-inner input {
            flex: 1;
            background: none;
            color: var(--text-primary);
            border: none;
            padding: 0;
            font-size: var(--font-size-sm);
            font-family: var(--font);
            height: 100%;
            outline: none;
        }

        .input-bar-inner input::placeholder {
            color: var(--text-muted);
        }

        .analyze-btn {
            position: relative;
            background: var(--bg-elevated);
            border: 1px solid var(--border);
            color: var(--text-primary);
            cursor: pointer;
            font-size: var(--font-size-xs);
            font-family: var(--font-mono);
            white-space: nowrap;
            padding: var(--space-xs) var(--space-md);
            border-radius: 100px;
            height: 32px;
            display: flex;
            align-items: center;
            gap: 4px;
            transition:
                border-color 0.4s ease,
                background var(--transition);
            flex-shrink: 0;
            overflow: hidden;
        }

        .analyze-btn:hover:not(.analyzing) {
            border-color: var(--accent);
            background: var(--bg-surface);
        }

        .analyze-btn.analyzing {
            cursor: default;
            border-color: transparent;
        }

        .analyze-btn-content {
            display: flex;
            align-items: center;
            gap: 4px;
            transition: opacity 0.4s ease;
            z-index: 1;
            position: relative;
        }

        .analyze-btn.analyzing .analyze-btn-content {
            opacity: 0;
        }

        .analyze-canvas {
            position: absolute;
            inset: -1px;
            width: calc(100% + 2px);
            height: calc(100% + 2px);
            pointer-events: none;
        }

        /* ── Discovery progress strip (Phase 1.A) ── */

        .discovery-progress {
            display: flex;
            align-items: center;
            gap: var(--space-md);
            padding: 4px var(--space-md);
            height: 32px;
            background: var(--bg-elevated);
            border-bottom: 1px solid var(--border);
            font-size: var(--font-size-xs);
            flex-shrink: 0;
        }

        .discovery-progress-title {
            color: var(--text-muted);
            font-weight: var(--font-weight-semibold);
            white-space: nowrap;
        }

        .discovery-progress-count {
            color: var(--text-primary);
            font-family: var(--font-mono);
            margin-left: 4px;
        }

        .discovery-progress-badges {
            display: flex;
            gap: 6px;
            flex: 1;
            min-width: 0;
        }

        .dp-badge {
            position: relative; /* anchors the ::after tooltip */
            display: inline-flex;
            align-items: center;
            gap: 4px;
            height: 22px;
            padding: 0 8px;
            border-radius: 11px;
            font-size: var(--font-size-xs);
            border: 1px solid var(--border);
            background: transparent;
            color: var(--text-muted);
            cursor: pointer;
            font-family: inherit;
            transition:
                background var(--transition),
                border-color var(--transition),
                color var(--transition),
                box-shadow var(--transition);
        }

        /* State-transition pulse is driven JS-side via Web Animations API
           (_pulseBadge), so the pulse re-fires reliably even on rapid
           empty→partial→detected successions within the same animation window.
           prefers-reduced-motion is honored inside _pulseBadge (no JS-side
           start when reduced-motion is set). */

        /* Instant hover/focus tooltip — no native-title delay. Shows the most
           recent quote for that element so the user can confirm what's been
           captured without opening the full evidence panel. */
        .dp-badge[data-tooltip]:hover::after,
        .dp-badge[data-tooltip]:focus-visible::after {
            content: attr(data-tooltip);
            position: absolute;
            top: calc(100% + 6px);
            left: 0;
            z-index: 10;
            background: var(--tooltip-bg, #1a1f2e);
            color: var(--tooltip-text, #ffffff);
            font-size: var(--font-size-xs);
            line-height: var(--line-height-tight, 1.45);
            padding: 4px 8px;
            border-radius: var(--radius-sm);
            max-width: 320px;
            white-space: normal;
            word-break: break-word;
            pointer-events: none;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
        }

        .dp-badge:hover {
            background: var(--bg-elevated);
        }

        .dp-badge:focus-visible {
            outline: 2px solid var(--accent);
            outline-offset: 1px;
        }

        .dp-badge.dp-expanded {
            box-shadow: 0 0 0 1px var(--accent) inset;
        }

        .dp-badge.dp-status-partial {
            /* partial (●) — warning系 */
            background: rgba(168, 122, 26, 0.12);
            border-color: var(--warning);
            color: var(--text-primary);
        }

        .dp-badge.dp-status-detected {
            /* detected (◐) — 自動検出の候補。accent と同じ色相だが塗らずに枠線のみ
               (相手にまだ確認していないので「確認済み」と見分けがつくように) */
            border-color: var(--accent);
            border-style: dashed;
            color: var(--accent);
        }

        .dp-badge.dp-status-confirmed {
            /* confirmed (✓) — ユーザーが相手に確認済み。accent (navy) 塗り、白文字 */
            background: var(--accent);
            border-color: var(--accent);
            color: #ffffff;
        }

        .dp-badge-label {
            font-weight: var(--font-weight-semibold);
        }

        .dp-badge-icon {
            font-size: 10px;
            line-height: 1;
        }

        .dp-badge-self-dot {
            width: 6px;
            height: 6px;
            border-radius: 50%;
            background: var(--warning);
            opacity: 0.7;
            flex-shrink: 0;
        }

        /* ── Evidence inspector panel (Phase 3.A) ── */

        .evidence-panel {
            display: flex;
            flex-direction: column;
            gap: var(--space-xs);
            padding: var(--space-sm) var(--space-md);
            background: var(--bg-elevated);
            border-bottom: 1px solid var(--border);
            flex-shrink: 0;
            max-height: 35vh;
            overflow-y: auto;
        }

        .evidence-panel-head {
            display: flex;
            align-items: center;
            gap: var(--space-sm);
        }

        .evidence-panel-title {
            font-weight: var(--font-weight-semibold);
            font-size: var(--font-size-sm);
            color: var(--text-primary);
        }

        .evidence-panel-status {
            font-size: var(--font-size-xs);
            padding: 1px 6px;
            border-radius: var(--radius-sm);
            border: 1px solid var(--border);
            color: var(--text-muted);
        }

        .evidence-panel-status-partial {
            color: var(--warning);
            border-color: var(--warning);
        }

        .evidence-panel-status-detected {
            color: var(--accent);
            border-color: var(--accent);
            border-style: dashed;
        }

        .evidence-panel-status-confirmed {
            color: var(--success);
            border-color: var(--success);
        }

        .evidence-panel-action {
            background: none;
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
            color: var(--text-secondary);
            cursor: pointer;
            font-size: var(--font-size-xs);
            line-height: 1.4;
            padding: 1px 8px;
            transition:
                color var(--transition),
                background var(--transition),
                border-color var(--transition);
        }

        .evidence-panel-action:hover {
            background: var(--bg-hover);
            color: var(--text-primary);
        }

        .evidence-panel-action:focus-visible {
            outline: 2px solid var(--accent);
            outline-offset: 1px;
        }

        .evidence-confirm {
            border-color: var(--success);
            color: var(--success);
        }

        .evidence-retract {
            color: var(--text-muted);
        }

        .evidence-panel-close {
            margin-left: auto;
            background: none;
            border: none;
            color: var(--text-muted);
            cursor: pointer;
            font-size: var(--font-size-base);
            line-height: 1;
            padding: 2px 6px;
            border-radius: var(--radius-sm);
            transition:
                color var(--transition),
                background var(--transition);
        }

        .evidence-panel-close:hover {
            color: var(--text-primary);
            background: var(--bg-hover);
        }

        .evidence-empty {
            font-size: var(--font-size-xs);
            color: var(--text-muted);
            font-style: italic;
        }

        .evidence-list {
            list-style: none;
            margin: 0;
            padding: 0;
            display: flex;
            flex-direction: column;
            gap: var(--space-xs);
        }

        .evidence-row {
            padding: var(--space-xs) var(--space-sm);
            border-left: 2px solid var(--border-strong);
            background: var(--bg-surface);
            border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
        }

        .evidence-quote {
            font-size: var(--font-size-sm);
            color: var(--text-primary);
            line-height: 1.5;
            word-break: break-word;
        }

        .evidence-meta {
            display: flex;
            gap: var(--space-sm);
            margin-top: 2px;
            font-size: var(--font-size-xs);
            color: var(--text-muted);
            font-family: var(--font-mono);
        }

        .evidence-self-section {
            margin-top: var(--space-sm);
            padding-top: var(--space-sm);
            border-top: 1px dashed var(--border);
            display: flex;
            flex-direction: column;
            gap: var(--space-xs);
        }

        .evidence-self-section-title {
            font-size: var(--font-size-xs);
            color: var(--text-muted);
            font-weight: var(--font-weight-semibold);
        }

        .evidence-row-self {
            border-left-color: var(--warning);
            opacity: 0.75;
        }

        .evidence-row-retracted {
            opacity: 0.55;
        }

        .evidence-row-retracted .evidence-quote {
            text-decoration: line-through;
            color: var(--text-muted);
        }

        .evidence-tag {
            display: inline-block;
            padding: 0 5px;
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
            font-family: inherit;
            line-height: 1.4;
            color: var(--text-secondary);
        }

        .evidence-tag-retracted {
            border-style: dashed;
        }

        .discovery-phase-badge {
            display: inline-flex;
            align-items: center;
            height: 18px;
            padding: 0 8px;
            border-radius: 9px;
            font-size: var(--font-size-xs);
            font-weight: var(--font-weight-medium);
            border: 1px solid var(--border);
            background: var(--bg-elevated);
            margin-left: var(--space-sm);
            white-space: nowrap;
        }

        .discovery-phase-badge.tone-neutral {
            color: var(--text-muted);
        }

        .discovery-phase-badge.tone-accent {
            color: var(--accent);
            border-color: var(--accent);
        }

        .discovery-phase-badge.tone-success {
            color: var(--success);
            border-color: var(--success);
        }

        @media (max-width: 900px) {
            .workbench {
                grid-template-columns: 1fr;
                grid-template-rows: minmax(0, 1fr) auto;
            }

            .workbench-main {
                border-right: none;
            }

            .workbench-rail {
                border-top: 1px solid var(--border);
                max-height: 34vh;
                display: grid;
                grid-template-columns: repeat(2, minmax(0, 1fr));
            }
        }

        @media (max-width: 700px) {
            .workbench-rail {
                grid-template-columns: 1fr;
            }
        }
    `;

    static properties = {
        responses: { type: Array },
        currentResponseIndex: { type: Number },
        selectedProfile: { type: String },
        onSendText: { type: Function },
        shouldAnimateResponse: { type: Boolean },
        isAnalyzing: { type: Boolean, state: true },
        transcriptionSegments: { type: Array, state: true },
        interimText: { type: String, state: true },
        discoveryEvidence: { type: Object, state: true },
        expandedElement: { type: String, state: true },
        contextProfile: { type: Object, state: true },
        feedbackNote: { type: String, state: true },
        feedbackStatus: { type: String, state: true },
    };

    constructor() {
        super();
        this.responses = [];
        this.currentResponseIndex = -1;
        this.selectedProfile = 'sales';
        this.onSendText = () => {};
        this.isAnalyzing = false;
        this.transcriptionSegments = [];
        this.interimText = '';
        this.discoveryEvidence = null;
        this.expandedElement = null;
        this.contextProfile = {};
        this.feedbackNote = '';
        this.feedbackStatus = '';
        this.currentSessionId = null;
        this._animFrame = null;
    }

    getProfileNames() {
        return {
            discovery: t('profile.discovery'),
            sales: t('profile.sales'),
        };
    }

    getCurrentResponse() {
        const profileNames = this.getProfileNames();
        return this.responses.length > 0 && this.currentResponseIndex >= 0
            ? this.responses[this.currentResponseIndex]
            : `${profileNames[this.selectedProfile] || t('assistant.session.label')}${t('assistant.status.listening')}`;
    }

    renderMarkdown(content) {
        if (typeof window !== 'undefined' && window.marked) {
            try {
                window.marked.setOptions({
                    breaks: true,
                    gfm: true,
                    sanitize: false,
                });
                let rendered = window.marked.parse(content);
                rendered = this.wrapWordsInSpans(rendered);
                return rendered;
            } catch (error) {
                console.warn('Error parsing markdown:', error);
                return content;
            }
        }
        return content;
    }

    wrapWordsInSpans(html) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const tagsToSkip = ['PRE'];

        function wrap(node) {
            if (node.nodeType === Node.TEXT_NODE && node.textContent.trim() && !tagsToSkip.includes(node.parentNode.tagName)) {
                const words = node.textContent.split(/(\s+)/);
                const frag = document.createDocumentFragment();
                words.forEach(word => {
                    if (word.trim()) {
                        const span = document.createElement('span');
                        span.setAttribute('data-word', '');
                        span.textContent = word;
                        frag.appendChild(span);
                    } else {
                        frag.appendChild(document.createTextNode(word));
                    }
                });
                node.parentNode.replaceChild(frag, node);
            } else if (node.nodeType === Node.ELEMENT_NODE && !tagsToSkip.includes(node.tagName)) {
                Array.from(node.childNodes).forEach(wrap);
            }
        }
        Array.from(doc.body.childNodes).forEach(wrap);
        return doc.body.innerHTML;
    }

    navigateToPreviousResponse() {
        if (this.currentResponseIndex > 0) {
            this.currentResponseIndex--;
            this.dispatchEvent(
                new CustomEvent('response-index-changed', {
                    detail: { index: this.currentResponseIndex },
                })
            );
            this.requestUpdate();
        }
    }

    navigateToNextResponse() {
        if (this.currentResponseIndex < this.responses.length - 1) {
            this.currentResponseIndex++;
            this.dispatchEvent(
                new CustomEvent('response-index-changed', {
                    detail: { index: this.currentResponseIndex },
                })
            );
            this.requestUpdate();
        }
    }

    scrollResponseUp() {
        const container = this.shadowRoot.querySelector('.response-container');
        if (container) {
            const scrollAmount = container.clientHeight * 0.3;
            container.scrollTop = Math.max(0, container.scrollTop - scrollAmount);
        }
    }

    scrollResponseDown() {
        const container = this.shadowRoot.querySelector('.response-container');
        if (container) {
            const scrollAmount = container.clientHeight * 0.3;
            container.scrollTop = Math.min(container.scrollHeight - container.clientHeight, container.scrollTop + scrollAmount);
        }
    }

    connectedCallback() {
        super.connectedCallback();
        this.currentSessionId = whisperOhKami.activeSessionId || this.currentSessionId;
        this._loadContextProfile();

        if (window.require) {
            const { ipcRenderer } = window.require('electron');

            this.handlePreviousResponse = () => this.navigateToPreviousResponse();
            this.handleNextResponse = () => this.navigateToNextResponse();
            this.handleScrollUp = () => this.scrollResponseUp();
            this.handleScrollDown = () => this.scrollResponseDown();
            this.handleTranscriptionUpdate = (_, data) => this.appendTranscription(data);
            this.handleTranscriptionClear = (_, data) => this.clearTranscription(data);
            this.handleDiscoveryEvidence = (_, state) => {
                this.discoveryEvidence = state;
            };

            ipcRenderer.on('navigate-previous-response', this.handlePreviousResponse);
            ipcRenderer.on('navigate-next-response', this.handleNextResponse);
            ipcRenderer.on('scroll-response-up', this.handleScrollUp);
            ipcRenderer.on('scroll-response-down', this.handleScrollDown);
            ipcRenderer.on('transcription-update', this.handleTranscriptionUpdate);
            ipcRenderer.on('transcription-clear', this.handleTranscriptionClear);
            ipcRenderer.on('discovery-evidence-update', this.handleDiscoveryEvidence);
        }
    }

    async _loadContextProfile() {
        try {
            const { normalizeContextProfile } = require('./utils/contextPrompt');
            const prefs = await whisperOhKami.storage.getPreferences();
            this.contextProfile = normalizeContextProfile(prefs.contextProfile || {});
        } catch (error) {
            console.error('Error loading assistant context profile:', error);
            this.contextProfile = {};
        }
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        this._stopWaveformAnimation();

        if (window.require) {
            const { ipcRenderer } = window.require('electron');
            if (this.handlePreviousResponse) ipcRenderer.removeListener('navigate-previous-response', this.handlePreviousResponse);
            if (this.handleNextResponse) ipcRenderer.removeListener('navigate-next-response', this.handleNextResponse);
            if (this.handleScrollUp) ipcRenderer.removeListener('scroll-response-up', this.handleScrollUp);
            if (this.handleScrollDown) ipcRenderer.removeListener('scroll-response-down', this.handleScrollDown);
            if (this.handleTranscriptionUpdate) ipcRenderer.removeListener('transcription-update', this.handleTranscriptionUpdate);
            if (this.handleTranscriptionClear) ipcRenderer.removeListener('transcription-clear', this.handleTranscriptionClear);
            if (this.handleDiscoveryEvidence) ipcRenderer.removeListener('discovery-evidence-update', this.handleDiscoveryEvidence);
        }
    }

    appendTranscription(data) {
        if (!data || !Array.isArray(data.segments)) return;

        // Deepgram interim: replace, do not accumulate
        if (data.type === 'deepgram-interim') {
            this.interimText = data.segments.map(s => s.text).join('');
            this.scrollTranscriptionToBottom();
            return;
        }

        // Deepgram final: clear interim (only if it was the mic side), push
        // each segment per speakerId so opponent-side (1, green) and mic-side
        // (2, blue) appear in their own colors. Phase 1g-3.5 wires this for
        // both pipelines.
        if (data.type === 'deepgram-final') {
            const segments = this.transcriptionSegments.map(s => ({ ...s }));
            for (const seg of data.segments) {
                if (!seg || !seg.text) continue;
                const speakerId = seg.speakerId || 2;
                const text = seg.text;
                if (speakerId === 2) this.interimText = '';
                const last = segments[segments.length - 1];
                if (last && last.type === 'input' && last.speakerId === speakerId && last.source === 'deepgram') {
                    last.text += (last.text.endsWith(' ') || text.startsWith(' ') ? '' : ' ') + text;
                } else {
                    segments.push({ type: 'input', speakerId, text, source: 'deepgram' });
                }
            }
            this.transcriptionSegments = segments;
            this.scrollTranscriptionToBottom();
            return;
        }

        // Gemini input/output transcription (slower; keep as-is for speaker 1)
        const segments = this.transcriptionSegments.map(s => ({ ...s }));
        for (const seg of data.segments) {
            if (!seg || !seg.text) continue;
            // Suppress Gemini's own transcription per-speaker when a Deepgram
            // pipeline is already feeding that speaker. Phase 1g-3.5 widens the
            // earlier mic-only check to opponent (speaker 1) too.
            if (data.type === 'input' && this._hasDeepgramFinalsForSpeaker(segments, seg.speakerId)) {
                continue;
            }
            const last = segments[segments.length - 1];
            const sameType = last && last.type === data.type;
            const sameSpeaker = data.type !== 'input' || last?.speakerId === seg.speakerId;
            const sameSource = (last?.source || 'gemini') === 'gemini';
            if (sameType && sameSpeaker && sameSource) {
                last.text += seg.text;
            } else {
                segments.push({
                    type: data.type,
                    speakerId: seg.speakerId,
                    text: seg.text,
                    source: 'gemini',
                });
            }
        }
        this.transcriptionSegments = segments;
        this.scrollTranscriptionToBottom();
    }

    _hasDeepgramFinals(segments) {
        return segments.some(s => s.source === 'deepgram');
    }

    _hasDeepgramFinalsForSpeaker(segments, speakerId) {
        if (speakerId === undefined || speakerId === null) {
            return this._hasDeepgramFinals(segments);
        }
        return segments.some(s => s.source === 'deepgram' && s.speakerId === speakerId);
    }

    clearTranscription(data = {}) {
        this.transcriptionSegments = [];
        this.interimText = '';
        this.currentSessionId = data?.sessionId || null;
        this.feedbackNote = '';
        this.feedbackStatus = '';
    }

    scrollTranscriptionToBottom() {
        setTimeout(() => {
            const panel = this.shadowRoot?.querySelector('.transcription-panel');
            if (panel) {
                panel.scrollTop = panel.scrollHeight;
            }
        }, 0);
    }

    async handleSendText() {
        const textInput = this.shadowRoot.querySelector('#textInput');
        if (textInput && textInput.value.trim()) {
            const message = textInput.value.trim();
            textInput.value = '';
            await this.onSendText(message);
        }
    }

    handleTextKeydown(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            this.handleSendText();
        }
    }

    async handleScreenAnswer() {
        if (this.isAnalyzing) return;
        if (window.captureManualScreenshot) {
            this.isAnalyzing = true;
            this._responseCountWhenStarted = this.responses.length;
            window.captureManualScreenshot();
        }
    }

    _startWaveformAnimation() {
        const canvas = this.shadowRoot.querySelector('.analyze-canvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;

        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.scale(dpr, dpr);

        const dangerColor = getComputedStyle(this).getPropertyValue('--danger').trim() || '#EF4444';
        const startTime = performance.now();
        const FADE_IN = 0.5; // seconds
        const PARTICLE_SPREAD = 4; // px inward from border
        const PARTICLE_COUNT = 250;

        // Pill perimeter helpers
        const w = rect.width;
        const h = rect.height;
        const r = h / 2; // pill radius = half height
        const straightLen = w - 2 * r;
        const arcLen = Math.PI * r;
        const perimeter = 2 * straightLen + 2 * arcLen;

        // Given a distance along the perimeter, return {x, y, nx, ny} (position + inward normal)
        const pointOnPerimeter = d => {
            d = ((d % perimeter) + perimeter) % perimeter;
            // Top straight: left to right
            if (d < straightLen) {
                return { x: r + d, y: 0, nx: 0, ny: 1 };
            }
            d -= straightLen;
            // Right arc
            if (d < arcLen) {
                const angle = -Math.PI / 2 + (d / arcLen) * Math.PI;
                return {
                    x: w - r + Math.cos(angle) * r,
                    y: r + Math.sin(angle) * r,
                    nx: -Math.cos(angle),
                    ny: -Math.sin(angle),
                };
            }
            d -= arcLen;
            // Bottom straight: right to left
            if (d < straightLen) {
                return { x: w - r - d, y: h, nx: 0, ny: -1 };
            }
            d -= straightLen;
            // Left arc
            const angle = Math.PI / 2 + (d / arcLen) * Math.PI;
            return {
                x: r + Math.cos(angle) * r,
                y: r + Math.sin(angle) * r,
                nx: -Math.cos(angle),
                ny: -Math.sin(angle),
            };
        };

        // Pre-seed random offsets for stable particles
        const seeds = [];
        for (let i = 0; i < PARTICLE_COUNT; i++) {
            seeds.push({ pos: Math.random(), drift: Math.random(), depthSeed: Math.random() });
        }

        const draw = now => {
            const elapsed = (now - startTime) / 1000;
            const fade = Math.min(1, elapsed / FADE_IN);

            ctx.clearRect(0, 0, w, h);

            // ── Particle border ──
            ctx.fillStyle = dangerColor;
            for (let i = 0; i < PARTICLE_COUNT; i++) {
                const s = seeds[i];
                const along = (s.pos + s.drift * elapsed * 0.03) * perimeter;
                const depth = s.depthSeed * PARTICLE_SPREAD;
                const density = 1 - depth / PARTICLE_SPREAD;

                if (Math.random() > density) continue;

                const p = pointOnPerimeter(along);
                const px = p.x + p.nx * depth;
                const py = p.y + p.ny * depth;
                const size = 0.8 + density * 0.6;

                ctx.globalAlpha = fade * density * 0.85;
                ctx.beginPath();
                ctx.arc(px, py, size, 0, Math.PI * 2);
                ctx.fill();
            }

            // ── Waveform ──
            const midY = h / 2;
            const waves = [
                { freq: 3, amp: 0.35, speed: 2.5, opacity: 0.9, width: 1.8 },
                { freq: 5, amp: 0.2, speed: 3.5, opacity: 0.5, width: 1.2 },
                { freq: 7, amp: 0.12, speed: 5, opacity: 0.3, width: 0.8 },
            ];

            for (const wave of waves) {
                ctx.beginPath();
                ctx.strokeStyle = dangerColor;
                ctx.globalAlpha = wave.opacity * fade;
                ctx.lineWidth = wave.width;
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';

                for (let x = 0; x <= w; x++) {
                    const norm = x / w;
                    const envelope = Math.sin(norm * Math.PI);
                    const y = midY + Math.sin(norm * Math.PI * 2 * wave.freq + elapsed * wave.speed) * (midY * wave.amp) * envelope;
                    if (x === 0) ctx.moveTo(x, y);
                    else ctx.lineTo(x, y);
                }
                ctx.stroke();
            }

            ctx.globalAlpha = 1;
            this._animFrame = requestAnimationFrame(draw);
        };

        this._animFrame = requestAnimationFrame(draw);
    }

    _stopWaveformAnimation() {
        if (this._animFrame) {
            cancelAnimationFrame(this._animFrame);
            this._animFrame = null;
        }
        const canvas = this.shadowRoot.querySelector('.analyze-canvas');
        if (canvas) {
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
    }

    scrollToBottom() {
        setTimeout(() => {
            const container = this.shadowRoot.querySelector('.response-container');
            if (container) {
                container.scrollTop = container.scrollHeight;
            }
        }, 0);
    }

    firstUpdated() {
        super.firstUpdated();
        this.updateResponseContent();
    }

    updated(changedProperties) {
        super.updated(changedProperties);
        if (changedProperties.has('responses') || changedProperties.has('currentResponseIndex')) {
            this.updateResponseContent();
        }

        if (changedProperties.has('isAnalyzing')) {
            if (this.isAnalyzing) {
                this._startWaveformAnimation();
            } else {
                this._stopWaveformAnimation();
            }
        }

        if (changedProperties.has('responses') && this.isAnalyzing) {
            if (this.responses.length > this._responseCountWhenStarted) {
                this.isAnalyzing = false;
            }
        }

        if (changedProperties.has('selectedProfile')) {
            this.expandedElement = null;
        }

        // Detect 5要素 status upgrades (empty→partial, partial→detected, detected→confirmed, etc.)
        // and fire a one-shot outline pulse on each affected badge via Web
        // Animations API. Downgrades and no-ops are skipped. Using
        // element.animate() instead of a CSS class lets rapid consecutive
        // upgrades on the same element each get their own visible pulse
        // (the previous pulse is cancelled before the new one starts).
        if (changedProperties.has('discoveryEvidence')) {
            const prev = changedProperties.get('discoveryEvidence');
            const curr = this.discoveryEvidence;
            if (prev && curr && curr.elements) {
                const order = ['pain', 'kpi', 'authority', 'budget', 'timeline'];
                const rank = { empty: 0, partial: 1, detected: 2, confirmed: 3 };
                for (const key of order) {
                    const oldStatus = prev.elements?.[key]?.status || 'empty';
                    const newStatus = curr.elements?.[key]?.status || 'empty';
                    if ((rank[newStatus] ?? 0) > (rank[oldStatus] ?? 0)) {
                        this._pulseBadge(key);
                    }
                }
            }
        }
    }

    updateResponseContent() {
        const container = this.shadowRoot.querySelector('#responseContainer');
        if (container) {
            const currentResponse = this.getCurrentResponse();
            const renderedResponse = this.renderMarkdown(currentResponse);
            container.innerHTML = renderedResponse;
            if (this.shouldAnimateResponse) {
                this.dispatchEvent(new CustomEvent('response-animation-complete', { bubbles: true, composed: true }));
            }
        }
    }

    _discoveryElementLabels() {
        return {
            pain: t('assistant.discovery.element.pain'),
            kpi: t('assistant.discovery.element.kpi'),
            authority: t('assistant.discovery.element.authority'),
            budget: t('assistant.discovery.element.budget'),
            timeline: t('assistant.discovery.element.timeline'),
        };
    }

    _renderDiscoveryProgress() {
        if (this.selectedProfile !== 'discovery' && this.selectedProfile !== 'sales') return '';
        const labels = this._discoveryElementLabels();
        const order = ['pain', 'kpi', 'authority', 'budget', 'timeline'];
        const ev = this.discoveryEvidence;
        // totalScore = detected + confirmed; confirmedCount = only elements the
        // user confirmed with the customer. The header shows the two disjoint
        // groups: candidates still unconfirmed, and confirmed.
        const confirmed = ev?.confirmedCount ?? 0;
        const candidates = Math.max(0, (ev?.totalScore ?? 0) - confirmed);
        const counts = t('assistant.progress.counts').replace('{detected}', candidates).replace('{confirmed}', confirmed);
        const inspector = (typeof window !== 'undefined' && window.evidenceInspector) || null;
        return html`
            <div class="discovery-progress">
                <span class="discovery-progress-title">${t('assistant.progress.title')} <span class="discovery-progress-count">${counts}</span></span>
                ${this._renderDiscoveryPhaseBadge()}
                <div class="discovery-progress-badges">
                    ${order.map(key => {
                        const el = ev?.elements?.[key];
                        const status = el?.status || 'empty';
                        // Retracted rows (and the user's retraction marker) are history, not
                        // the current value — the tooltip shows the newest live quote only.
                        const live = el?.evidence ? el.evidence.filter(e => !e.retracted) : [];
                        const lastQuote = live.length ? live[live.length - 1].text : '';
                        const icon = status === 'confirmed' ? '✓' : status === 'detected' ? '◐' : status === 'partial' ? '●' : '';
                        const isExpanded = this.expandedElement === key;
                        const statusText =
                            status === 'empty' || !inspector
                                ? t('assistant.evidence.unconfirmed')
                                : inspector.getElementMeta(key).statusLabel(status);
                        const tooltip =
                            status === 'detected'
                                ? `${lastQuote || `${labels[key]}: ${statusText}`} — ${t('assistant.badge.detected_hint')}`
                                : lastQuote || `${labels[key]}: ${statusText}`;
                        const ariaLabel = lastQuote ? `${labels[key]}: ${statusText}: ${lastQuote}` : `${labels[key]}: ${statusText}`;
                        return html`
                            <button
                                type="button"
                                class="dp-badge dp-status-${status} ${isExpanded ? 'dp-expanded' : ''}"
                                data-element="${key}"
                                data-tooltip="${tooltip}"
                                aria-label="${ariaLabel}"
                                aria-expanded=${isExpanded ? 'true' : 'false'}
                                @click=${() => this._handleBadgeClick(key)}
                            >
                                <span class="dp-badge-label">${labels[key]}</span>
                                ${
                                    status === 'empty' && el?.selfMentions?.length > 0
                                        ? html`<span class="dp-badge-self-dot" title="${t('assistant.badge.self_mention_hint')}"></span>`
                                        : ''
                                }
                                ${icon ? html`<span class="dp-badge-icon">${icon}</span>` : ''}
                            </button>
                        `;
                    })}
                </div>
            </div>
        `;
    }

    _renderEvidencePanel() {
        if (this.selectedProfile !== 'discovery' && this.selectedProfile !== 'sales') return '';
        if (!this.expandedElement) return '';

        const inspector = (typeof window !== 'undefined' && window.evidenceInspector) || null;
        if (!inspector) return '';
        const { getElementMeta, formatRelativeTime, getSourceMeta } = inspector;

        const key = this.expandedElement;
        const meta = getElementMeta(key);
        if (!meta) return '';

        const el = this.discoveryEvidence?.elements?.[key];
        const status = el?.status || 'empty';
        const evidenceList = el?.evidence ? [...el.evidence].reverse() : [];
        const selfMentionsList = el?.selfMentions ? [...el.selfMentions].reverse() : [];
        const now = Date.now();

        return html`
            <div class="evidence-panel" role="region" aria-label="${meta.label} evidence">
                <div class="evidence-panel-head">
                    <span class="evidence-panel-title">${meta.label}</span>
                    <span class="evidence-panel-status evidence-panel-status-${status}">${meta.statusLabel(status)}</span>
                    ${
                        status === 'detected' || status === 'partial'
                            ? html`<button type="button" class="evidence-panel-action evidence-confirm" @click=${() => this._confirmEvidence(key)}>
                                  ✓ ${t('assistant.evidence.confirm')}
                              </button>`
                            : ''
                    }
                    ${
                        status !== 'empty'
                            ? html`<button type="button" class="evidence-panel-action evidence-retract" @click=${() => this._retractEvidence(key)}>
                                  ${t('assistant.evidence.retract')}
                              </button>`
                            : ''
                    }
                    <button
                        type="button"
                        class="evidence-panel-close"
                        @click=${() => (this.expandedElement = null)}
                        title="${t('common.close')}"
                        aria-label="${t('common.close')}"
                    >
                        ×
                    </button>
                </div>
                ${
                    evidenceList.length === 0
                        ? html`<div class="evidence-empty">${t('assistant.evidence.empty')}</div>`
                        : html`
                              <ul class="evidence-list">
                                  ${evidenceList.map(e => {
                                      const sourceMeta = getSourceMeta(e.source);
                                      // A manual retraction is logged as a user-sourced marker row
                                      // (text '[manual]'); show it as an action, not as a quote.
                                      const isUserMarker = e.source === 'user';
                                      return html`
                                          <li class="evidence-row ${e.retracted ? 'evidence-row-retracted' : ''}">
                                              ${isUserMarker ? '' : html`<div class="evidence-quote">${e.text}</div>`}
                                              <div class="evidence-meta">
                                                  <span class="evidence-source">${sourceMeta.icon} ${sourceMeta.label}</span>
                                                  ${
                                                      e.polarity
                                                          ? html`<span class="evidence-tag evidence-tag-polarity"
                                                                >${t('assistant.evidence.polarity.' + e.polarity)}</span
                                                            >`
                                                          : ''
                                                  }
                                                  ${
                                                      e.retracted && !isUserMarker
                                                          ? html`<span class="evidence-tag evidence-tag-retracted"
                                                                >${t('assistant.evidence.retracted')}</span
                                                            >`
                                                          : ''
                                                  }
                                                  <span class="evidence-time">${formatRelativeTime(e.timestamp, now)}</span>
                                              </div>
                                          </li>
                                      `;
                                  })}
                              </ul>
                          `
                }
                ${
                    selfMentionsList.length > 0
                        ? html`
                              <div class="evidence-self-section">
                                  <div class="evidence-self-section-title">${t('assistant.evidence.self_mentions_section')}</div>
                                  <ul class="evidence-list">
                                      ${selfMentionsList.map(
                                          e => html`
                                              <li class="evidence-row evidence-row-self">
                                                  <div class="evidence-quote">${e.text}</div>
                                                  <div class="evidence-meta">
                                                      <span class="evidence-time">${formatRelativeTime(e.timestamp, now)}</span>
                                                  </div>
                                              </li>
                                          `
                                      )}
                                  </ul>
                              </div>
                          `
                        : ''
                }
            </div>
        `;
    }

    _renderDiscoveryPhaseBadge() {
        if (this.selectedProfile !== 'discovery' && this.selectedProfile !== 'sales') return '';

        const inspector = (typeof window !== 'undefined' && window.discoveryPhase) || null;
        if (!inspector) return '';
        const { computeDiscoveryPhase, getPhaseMeta } = inspector;

        const phase = computeDiscoveryPhase({ segments: this.transcriptionSegments || [] });
        const meta = getPhaseMeta(phase);
        return html`<span class="discovery-phase-badge tone-${meta.tone}" title="${meta.title}">${meta.label}</span>`;
    }

    _handleBadgeClick(key) {
        this.expandedElement = this.expandedElement === key ? null : key;
    }

    // Manual evidence actions. The main process applies them to the store and
    // pushes the new state back on 'discovery-evidence-update', so the view
    // does not mutate discoveryEvidence locally.
    async _confirmEvidence(key) {
        try {
            await window.whisperOhKami?.confirmEvidence?.(key);
        } catch (error) {
            console.error('Failed to confirm discovery evidence:', error);
        }
    }

    async _retractEvidence(key) {
        try {
            await window.whisperOhKami?.retractEvidence?.(key);
        } catch (error) {
            console.error('Failed to retract discovery evidence:', error);
        }
    }

    // One-shot outline pulse for a dp-badge after a status upgrade.
    // Uses Web Animations API instead of a CSS class so:
    //   - rapid consecutive upgrades on the same element each get a fresh
    //     visible pulse (any in-flight pulse is cancelled before the new
    //     one starts; CSS-class approach silently skipped the second one)
    //   - no state/timer bookkeeping needed in the component
    // Honors prefers-reduced-motion at the JS layer.
    _pulseBadge(key) {
        if (typeof window === 'undefined') return;
        if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            return;
        }
        requestAnimationFrame(() => {
            const badge = this.shadowRoot && this.shadowRoot.querySelector(`.dp-badge[data-element="${key}"]`);
            if (!badge || typeof badge.animate !== 'function') return;
            if (badge._dpPulseAnim) {
                try {
                    badge._dpPulseAnim.cancel();
                } catch (_) {
                    /* cancelling a finished animation can throw on some impls — safe to ignore */
                }
            }
            badge._dpPulseAnim = badge.animate(
                [
                    { boxShadow: '0 0 0 0 rgba(31, 58, 95, 0)' },
                    { boxShadow: '0 0 0 4px rgba(31, 58, 95, 0.20)', offset: 0.4 },
                    { boxShadow: '0 0 0 0 rgba(31, 58, 95, 0)' },
                ],
                { duration: 600, easing: 'ease-out' }
            );
        });
    }

    _getContextFields() {
        return [
            { key: 'companyProduct', label: t('assistant.context.field.company_product') },
            { key: 'targetCustomer', label: t('assistant.context.field.target_customer') },
            { key: 'meetingGoal', label: t('assistant.context.field.meeting_goal') },
            { key: 'customerBackground', label: t('assistant.context.field.customer_background') },
            { key: 'constraints', label: t('assistant.context.field.constraints') },
            { key: 'freeInstruction', label: t('assistant.context.field.free_instruction') },
        ];
    }

    _getDiscoveryGaps() {
        const labels = this._discoveryElementLabels();
        const order = ['pain', 'kpi', 'authority', 'budget', 'timeline'];
        return (
            order
                .map(key => {
                    const status = this.discoveryEvidence?.elements?.[key]?.status || 'empty';
                    return { key, label: labels[key], status };
                })
                // Not a gap once there is at least a detected candidate; confirmation
                // is shown on the badge, the rail only lists what is still missing.
                .filter(item => item.status !== 'detected' && item.status !== 'confirmed')
        );
    }

    _getRailHelpText() {
        if (this.selectedProfile === 'discovery' || this.selectedProfile === 'sales') {
            const gaps = this._getDiscoveryGaps();
            if (!this.responses.length) {
                return t('assistant.help.discovery_start');
            }
            if (gaps.length) {
                return `${gaps[0].label}${t('assistant.help.discovery_gap')}`;
            }
            // No gaps only means every element has at least a candidate. Say
            // "confirmed" only when the user has confirmed all five.
            if (this.discoveryEvidence?.confirmedCount === 5) {
                return t('assistant.help.discovery_complete');
            }
            return t('assistant.help.candidates_complete');
        }
        return t('assistant.help.default');
    }

    async _saveFeedback(rating) {
        if (this.currentResponseIndex < 0 || !this.responses.length) {
            this.feedbackStatus = t('assistant.feedback.no_response');
            return;
        }
        if (!this.currentSessionId) {
            this.feedbackStatus = t('assistant.feedback.session_not_ready');
            return;
        }

        try {
            const { appendFeedbackEventToSession, createFeedbackEvent } = require('./utils/feedbackEvents');
            const event = createFeedbackEvent({
                responseIndex: this.currentResponseIndex,
                rating,
                note: this.feedbackNote,
                profile: {
                    selectedProfile: this.selectedProfile,
                    contextProfile: this.contextProfile,
                },
                evidenceSnapshot: this.discoveryEvidence || null,
            });
            const currentSession = (await whisperOhKami.storage.getSession(this.currentSessionId)) || { sessionId: this.currentSessionId };
            const nextSession = appendFeedbackEventToSession(currentSession, event);
            await whisperOhKami.storage.saveSession(this.currentSessionId, {
                feedbackEvents: nextSession.feedbackEvents,
            });
            this.feedbackNote = '';
            this.feedbackStatus = t('assistant.feedback.saved');
        } catch (error) {
            console.error('Error saving feedback:', error);
            this.feedbackStatus = `${t('assistant.feedback.save_error')}${error.message}`;
        }
    }

    _renderContextRail() {
        const fields = this._getContextFields()
            .map(field => ({ ...field, value: this.contextProfile?.[field.key] || '' }))
            .filter(field => field.value.trim());

        return html`
            <section class="rail-section">
                <h3 class="rail-title">${t('assistant.rail.context_title')}</h3>
                ${
                    fields.length
                        ? fields.slice(0, 5).map(
                              field => html`
                                  <div class="rail-context-row">
                                      <span class="rail-context-key">${field.label}</span>
                                      <span class="rail-context-value">${field.value}</span>
                                  </div>
                              `
                          )
                        : html`<div class="rail-muted">${t('assistant.rail.context_empty')}</div>`
                }
            </section>
        `;
    }

    _renderGapsRail() {
        if (this.selectedProfile !== 'discovery' && this.selectedProfile !== 'sales') {
            return html`
                <section class="rail-section">
                    <h3 class="rail-title">${t('assistant.progress.title')}</h3>
                    <div class="rail-muted">${t('assistant.rail.gaps_empty_profile')}</div>
                </section>
            `;
        }

        const gaps = this._getDiscoveryGaps();
        return html`
            <section class="rail-section">
                <h3 class="rail-title">${t('assistant.rail.gaps_title')}</h3>
                ${
                    gaps.length
                        ? html`
                              <div class="rail-chip-row">
                                  ${gaps.map(gap => html`<span class="rail-chip ${gap.status === 'partial' ? 'partial' : ''}">${gap.label}</span>`)}
                              </div>
                          `
                        : html`<div class="rail-muted">${t('assistant.rail.gaps_filled')}</div>`
                }
            </section>
        `;
    }

    _renderHelpRail() {
        return html`
            <section class="rail-section">
                <h3 class="rail-title">${t('assistant.rail.help_title')}</h3>
                <div class="rail-line">${this._getRailHelpText()}</div>
            </section>
        `;
    }

    _renderFeedbackRail() {
        const disabled = this.currentResponseIndex < 0 || !this.responses.length;
        return html`
            <section class="rail-section">
                <h3 class="rail-title">${t('assistant.rail.feedback_title')}</h3>
                <div class="feedback-actions">
                    <button class="feedback-btn" ?disabled=${disabled} @click=${() => this._saveFeedback('helpful')}>
                        ${t('feedback.rating.helpful')}
                    </button>
                    <button class="feedback-btn" ?disabled=${disabled} @click=${() => this._saveFeedback('off_target')}>
                        ${t('feedback.rating.off_target')}
                    </button>
                    <button class="feedback-btn" ?disabled=${disabled} @click=${() => this._saveFeedback('unsafe_or_risky')}>
                        ${t('feedback.rating.unsafe')}
                    </button>
                </div>
                <textarea
                    class="feedback-note"
                    placeholder="${t('assistant.feedback.note_placeholder')}"
                    .value=${this.feedbackNote}
                    @input=${e => {
                        this.feedbackNote = e.target.value;
                    }}
                ></textarea>
                <div class="feedback-status">${this.feedbackStatus}</div>
            </section>
        `;
    }

    _renderWorkbenchRail() {
        return html`
            <aside class="workbench-rail" aria-label="${t('assistant.rail.aria_label')}">
                ${this._renderContextRail()} ${this._renderGapsRail()} ${this._renderHelpRail()} ${this._renderFeedbackRail()}
            </aside>
        `;
    }

    render() {
        const hasMultipleResponses = this.responses.length > 1;

        return html`
            ${this._renderDiscoveryProgress()} ${this._renderEvidencePanel()}
            <div class="workbench">
                <div class="workbench-main">
                    <div class="transcription-panel">
                        ${
                            this.transcriptionSegments.length === 0 && !this.interimText
                                ? html`<div class="transcription-empty">${t('assistant.empty.waiting_audio')}</div>`
                                : html`
                                      ${this.transcriptionSegments.map(
                                          seg => html`
                                              <div
                                                  class="transcription-segment ${seg.type === 'output' ? 'output' : 'speaker-' + (seg.speakerId || 1)}"
                                              >
                                                  ${seg.text}
                                              </div>
                                          `
                                      )}
                                      ${this.interimText ? html`<div class="transcription-interim">${this.interimText}</div>` : ''}
                                  `
                        }
                    </div>
                    <div class="response-container" id="responseContainer"></div>

                    ${
                        hasMultipleResponses
                            ? html`
                                  <div class="response-nav">
                                      <button
                                          class="nav-btn"
                                          @click=${this.navigateToPreviousResponse}
                                          ?disabled=${this.currentResponseIndex <= 0}
                                          title=${t('assistant.tooltip.previous_response')}
                                      >
                                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                                              <path
                                                  fill-rule="evenodd"
                                                  d="M11.78 5.22a.75.75 0 0 1 0 1.06L8.06 10l3.72 3.72a.75.75 0 1 1-1.06 1.06l-4.25-4.25a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 0Z"
                                                  clip-rule="evenodd"
                                              />
                                          </svg>
                                      </button>
                                      <span class="response-counter">${this.currentResponseIndex + 1} / ${this.responses.length}</span>
                                      <button
                                          class="nav-btn"
                                          @click=${this.navigateToNextResponse}
                                          ?disabled=${this.currentResponseIndex >= this.responses.length - 1}
                                          title=${t('assistant.tooltip.next_response')}
                                      >
                                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                                              <path
                                                  fill-rule="evenodd"
                                                  d="M8.22 5.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L11.94 10 8.22 6.28a.75.75 0 0 1 0-1.06Z"
                                                  clip-rule="evenodd"
                                              />
                                          </svg>
                                      </button>
                                  </div>
                              `
                            : ''
                    }

                    <div class="input-bar">
                        <div class="input-bar-inner">
                            <input type="text" id="textInput" placeholder=${t('assistant.input.placeholder')} @keydown=${this.handleTextKeydown} />
                        </div>
                        <button class="analyze-btn ${this.isAnalyzing ? 'analyzing' : ''}" @click=${this.handleScreenAnswer}>
                            <canvas class="analyze-canvas"></canvas>
                            <span class="analyze-btn-content">
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24">
                                    <path
                                        fill="none"
                                        stroke="currentColor"
                                        stroke-linecap="round"
                                        stroke-linejoin="round"
                                        stroke-width="2"
                                        d="M13 3v7h6l-8 11v-7H5z"
                                    />
                                </svg>
                                ${t('assistant.button.analyze_screen')}
                            </span>
                        </button>
                    </div>
                </div>
                ${this._renderWorkbenchRail()}
            </div>
        `;
    }
}

customElements.define('assistant-view', AssistantView);
