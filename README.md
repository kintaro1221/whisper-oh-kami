<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/brand/logo-mark-dark.svg" />
    <img src="docs/brand/logo-mark-light.svg" alt="WhisperOhKAMI" width="84" height="84" />
  </picture>
</p>

# WhisperOhKAMI

> **「次は、予算を聞いて」 — 商談中、横でささやく Windows デスクトップ AI**
>
> Whispering copilot for Japanese B2B sales discovery (商談ヒアリング).
>
> **LP**: <https://whisperohkami.pages.dev> · **Download**: [GitHub Releases](https://github.com/kintaro1221/whisper-oh-kami/releases/latest) · 自己責任でご利用ください。

## 何をするのか

商談中の相手の発話を聞き取って、5 つの確認したい要素 (**課題 / KPI / 決裁 / 予算 / 期限**) のうち **まだ聞けていない要素を色で気づかせます**。固定のセリフや応答候補は提示しません。**頭が真っ白になっても、横で「次の一手」を耳打ちする** — そんな設計です。

精度を上げたいときは BYOK モードで Gemini を繋ぐと、語彙のゆれ(例:「KPIにしても良いかな」「来期の予算」)も意味カテゴリとして拾い直してくれます。Gemini が応答しないときや、`trial` / `local` モードでは、決まった単語パターンの即時判定だけで動き続けます。

## 3 つのモード

起動後のメイン画面（またはオンボーディング）でモードを切り替えます。**既定は `trial`（キー不要）**。

| モード | キー | 文字起こし | 進捗バー | AI 応答 |
| --- | --- | --- | --- | --- |
| **trial** (既定) | 不要 | マイクのみ、端末内 Whisper | 動く | なし |
| **byok** | Gemini API キー | Deepgram nova-3 (任意) または Gemini Live | 動く + Gemini で補正 | あり |
| **local** | 不要 (Ollama) | 端末内 Whisper | 動く | Ollama (外部送信ゼロ) |

非エンジニアの方は、BYOK 画面の「🧭 はじめての方：ガイド付きで設定」から、キー取得〜貼り付け〜接続確認まで画面内ガイドで完了できます。

## セットアップ

```bash
npm install
npm start
```

`npm install` で依存をインストール、`npm start` で起動。初回起動時のオンボーディングで「はじめ方」を 3 モードから選びます（あとから設定でいつでも変更可）。配布版が欲しい方は [Releases](https://github.com/kintaro1221/whisper-oh-kami/releases/latest) からどうぞ。

**動作環境**: Windows 主対象（macOS は限定検証、Linux はマイク入力のみ）。端末内 Whisper は CPU で動作（GPU 任意 / 推奨は Tiny モデル）。システム音声取り込み（画面共有 / loopback）+ マイクの OS 権限が必要。

## プライバシー・文字起こし

- **`trial` と `local` は端末内で完結** — マイクや相手の音声、文字起こし結果を外部に送りません。`byok` モードのときだけ、自分で設定した Gemini キー宛に送信します。**テレメトリや開発元サーバへの常時接続はなし**。
- **文字起こし**: 既定は端末内 Whisper。Deepgram nova-3 は任意（BYOK 設定の Deepgram キー入力欄、または環境変数 `DEEPGRAM_API_KEY`）。Deepgram を使ったときだけ音声が米国に送信されます。
- **自分の声と相手の声を分けて取り込み**: マイク（自分）と Windows ループバック（相手）を別々のチャネルで処理。**進捗バーは相手の発話だけを対象** にします。
- **対応プロファイル**: Discovery / Sales の 2 種類（既定 `sales`）。日本語 B2B 商談向けにプロンプトを調整し、AI が提案や押し売り表現を出さないようにガードしています。

## 困ったときは

アプリ内 **ヘルプ →「よくある質問・困ったとき」** にトラブルシュート集約。バグ・要望は [GitHub Issues](https://github.com/kintaro1221/whisper-oh-kami/issues) へ、返事は best effort。

## ライセンス

**GPL-3.0** (同梱の `LICENSE` に全文)。著作者 kintaro1221、ソースは [github.com/kintaro1221/whisper-oh-kami](https://github.com/kintaro1221/whisper-oh-kami)。依存パッケージライセンス一覧は `THIRD_PARTY_NOTICES.md` に、同梱フォント Noto Sans JP は SIL Open Font License 1.1 で提供。本ソフトは [cheating-daddy](https://github.com/sohzm/cheating-daddy)(© sohzm, GPL-3.0)を基盤とするフォークを大幅に改変したものです。

---

## English

WhisperOhKAMI is a real-time **whispering** copilot for Japanese B2B sales discovery calls (商談). It shadow-displays which of the five discovery elements (Pain / KPI / Decision / Budget / Timing) are **still missing** from the opponent's speech — whispering "what to ask next" by color. No canned lines, no fixed talk-scripts: the rep keeps the conversation, the AI keeps the checklist by their side.

### Three modes

- **`trial`** (default, keyless) — on-device Whisper on the mic only + regex 5-element bar. No API key, no AI replies, nothing sent off-device.
- **`byok`** — your own Gemini key unlocks AI replies and LLM hybrid refinement. The key field shows live format feedback before you start.
- **`local`** — Ollama + on-device Whisper, fully offline (zero outbound).

### Setup

```bash
npm install && npm start
```

Pick a mode in onboarding. Windows-first (macOS limited, Linux mic-only). Trial mode is fully keyless — only the on-device Whisper model auto-downloads on first run (Tiny recommended).

### Privacy notes

- STT: on-device Whisper (default). Deepgram nova-3 is opt-in via the BYOK Deepgram key (or `DEEPGRAM_API_KEY`); cloud mode sends audio to Deepgram (US).
- Trial and local keep audio on-device. BYOK sends only to your own Gemini / Deepgram. No telemetry, no developer server.
- Profiles: `discovery` / `sales` only (default `sales`); JP-tuned prompts that ban proposing or scripted talk.

GPL-3.0. Source at [github.com/kintaro1221/whisper-oh-kami](https://github.com/kintaro1221/whisper-oh-kami). Based on a heavily modified fork of [cheating-daddy](https://github.com/sohzm/cheating-daddy) © sohzm, GPL-3.0.
