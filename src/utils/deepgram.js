// Lightweight Deepgram WebSocket client for real-time STT.
// Ported from C:\my-fs-pj\sokuroku\src\main\deepgram.ts (CommonJS / JS).
// Adds 24kHz Int16 PCM resampling helper since cheating-daddy captures at 24kHz
// while Deepgram is connected at 16kHz for nova-3 (Japanese).

const WebSocket = require('ws');

const DEEPGRAM_URL =
    'wss://api.deepgram.com/v1/listen' +
    '?model=nova-3' +
    '&language=ja' +
    '&punctuate=true' +
    '&interim_results=true' +
    '&smart_format=true' +
    '&encoding=linear16' +
    '&sample_rate=16000';

const MAX_RETRIES = 5;
const RETRY_INTERVAL_MS = 3000;
const EVENT_RING_MAX = 20;

class DeepgramService {
    constructor() {
        this.ws = null;
        this.apiKey = '';
        this.retryCount = 0;
        this.retryTimer = null;
        this.shouldReconnect = false;
        this.onTranscript = null;
        this.onStatus = null;
        // Observability lane: per-instance state for one-command WS diagnosis.
        this.lastConnectAt = null;
        this.lastDisconnectAt = null;
        this.lastError = null;
        this.lastCloseCode = null;
        this.lastCloseReason = null;
        this.bytesSentAttempted = 0;
        this.bytesSentDropped = 0;
        this.connectAttempts = 0;
        this.recentEvents = [];
    }

    connect(apiKey, onTranscript, onStatus) {
        if (!apiKey) {
            console.warn('[Deepgram] connect() called without API key');
            return;
        }
        this.apiKey = apiKey;
        this.onTranscript = onTranscript || null;
        this.onStatus = onStatus || null;
        this.shouldReconnect = true;
        this.retryCount = 0;
        this._pushEvent('connect_called');
        this._createConnection();
    }

    send(audioBuffer) {
        const len = audioBuffer && audioBuffer.length ? audioBuffer.length : 0;
        this.bytesSentAttempted += len;
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(audioBuffer);
        } else {
            this.bytesSentDropped += len;
        }
    }

    isConnected() {
        return !!(this.ws && this.ws.readyState === WebSocket.OPEN);
    }

    disconnect() {
        this.shouldReconnect = false;
        if (this.retryTimer) {
            clearTimeout(this.retryTimer);
            this.retryTimer = null;
        }
        this._pushEvent('disconnect_called');
        if (this.ws) {
            try {
                this.ws.send(new Uint8Array(0));
            } catch (_e) {
                // close-frame send failure is fine
            }
            this.ws.close();
            this.ws = null;
        }
        this.lastDisconnectAt = Date.now();
        if (this.onStatus) this.onStatus('disconnected');
    }

    _pushEvent(kind, detail) {
        const entry = { kind, at: Date.now() };
        if (detail) entry.detail = detail;
        this.recentEvents.push(entry);
        if (this.recentEvents.length > EVENT_RING_MAX) {
            this.recentEvents = this.recentEvents.slice(-EVENT_RING_MAX);
        }
    }

    getStatus() {
        const now = Date.now();
        return {
            instantiated: true,
            connected: this.isConnected(),
            readyState: this.ws ? this.ws.readyState : null,
            lastConnectAt: this.lastConnectAt,
            lastConnectAgoMs: this.lastConnectAt ? now - this.lastConnectAt : null,
            lastDisconnectAt: this.lastDisconnectAt,
            lastDisconnectAgoMs: this.lastDisconnectAt ? now - this.lastDisconnectAt : null,
            lastError: this.lastError,
            lastCloseCode: this.lastCloseCode,
            lastCloseReason: this.lastCloseReason,
            retryCount: this.retryCount,
            connectAttempts: this.connectAttempts,
            shouldReconnect: this.shouldReconnect,
            bytesSentAttempted: this.bytesSentAttempted,
            bytesSentDropped: this.bytesSentDropped,
            recentEvents: this.recentEvents.slice(),
        };
    }

    _createConnection() {
        // Tear down any prior socket safely (only call close when fully OPEN to avoid
        // ws@8 throwing "WebSocket was closed before the connection was established"
        // as an uncaught exception).
        if (this.ws) {
            const prev = this.ws;
            this.ws = null;
            try {
                prev.removeAllListeners();
            } catch (_) {}
            if (prev.readyState === WebSocket.OPEN) {
                try {
                    prev.close();
                } catch (_) {}
            } else {
                try {
                    prev.terminate();
                } catch (_) {}
            }
        }

        this.connectAttempts++;
        this._pushEvent('connecting');
        console.log('[Deepgram] Connecting...');
        let ws;
        try {
            ws = new WebSocket(DEEPGRAM_URL, {
                headers: { Authorization: `Token ${this.apiKey}` },
            });
        } catch (err) {
            const msg = err && err.message;
            console.error('[Deepgram] WebSocket construct error:', msg);
            this.lastError = { message: msg, at: Date.now() };
            this._pushEvent('error', { phase: 'construct', message: msg });
            if (this.onStatus) this.onStatus('error', msg);
            this._attemptReconnect();
            return;
        }
        this.ws = ws;

        // Register 'error' FIRST so connect-phase failures don't bubble to main as uncaught.
        ws.on('error', err => {
            const msg = err && err.message;
            console.error('[Deepgram] Error:', msg);
            this.lastError = { message: msg, at: Date.now() };
            this._pushEvent('error', { phase: 'runtime', message: msg });
            if (this.onStatus) this.onStatus('error', msg);
        });

        ws.on('open', () => {
            console.log('[Deepgram] Connected');
            this.retryCount = 0;
            this.lastConnectAt = Date.now();
            this._pushEvent('open');
            if (this.onStatus) this.onStatus('connected');
        });

        ws.on('message', data => {
            try {
                const message = JSON.parse(data.toString());
                if (message.type === 'Results') {
                    const alt = message.channel && message.channel.alternatives && message.channel.alternatives[0];
                    if (alt) {
                        const transcript = alt.transcript || '';
                        const isFinal = !!message.is_final;
                        if (transcript.trim().length > 0 && this.onTranscript) {
                            this.onTranscript({ transcript, is_final: isFinal });
                        }
                    }
                }
            } catch (err) {
                console.error('[Deepgram] Failed to parse message:', err);
            }
        });

        ws.on('close', (code, reason) => {
            const reasonStr = reason ? reason.toString() : '';
            console.log(`[Deepgram] Closed: ${code} ${reasonStr}`);
            this.lastCloseCode = code;
            this.lastCloseReason = reasonStr;
            this.lastDisconnectAt = Date.now();
            this._pushEvent('close', { code, reason: reasonStr });
            if (this.ws === ws) this.ws = null;
            this._attemptReconnect();
        });
    }

    _attemptReconnect() {
        if (!this.shouldReconnect) return;
        if (this.retryCount >= MAX_RETRIES) {
            console.error(`[Deepgram] Max retries (${MAX_RETRIES}) exceeded. Giving up.`);
            this._pushEvent('max_retries_exceeded', { retries: MAX_RETRIES });
            if (this.onStatus) this.onStatus('error', `再接続に${MAX_RETRIES}回失敗しました`);
            this.shouldReconnect = false;
            return;
        }
        this.retryCount++;
        this._pushEvent('reconnect_attempt', { attempt: this.retryCount, max: MAX_RETRIES, inMs: RETRY_INTERVAL_MS });
        console.log(`[Deepgram] Reconnecting in ${RETRY_INTERVAL_MS}ms (attempt ${this.retryCount}/${MAX_RETRIES})...`);
        this.retryTimer = setTimeout(() => {
            this.retryTimer = null;
            if (this.shouldReconnect) this._createConnection();
        }, RETRY_INTERVAL_MS);
    }
}

module.exports = {
    DeepgramService,
};
