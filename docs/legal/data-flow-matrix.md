# WhisperOhKAMI データフロー マトリクス

最終更新日: 2026-06-30
参照対象: WhisperOhKAMI v1（招待制先行販売向け）および本サービスのランディングページ・販売バックエンド

本書は、本ソフトおよび本サービスを構成する各実行モード・各処理経路で、**どのデータが・どこへ・いつ・誰の責任で移動するか** を、現行リポジトリのコード位置とともに整理した「事実テーブル」です。プライバシーポリシー（`docs/legal/privacy-policy.md`）および利用規約（`docs/legal/terms-and-sales.md`）は本書を truth anchor として参照します。

> 用語: 「端末内」とは、お客様が本ソフトを実行している Windows PC のローカルファイルシステム・RAM・ローカルプロセス間通信を指します。「端末外に送信される」とは、HTTPS / WebSocket を介して当該 PC 以外のサーバへ送信されることを指します。
>
> **重要な留保**: 「端末外に出ない」という記述は、当該モードを当該設定で利用した場合のみ成立します。BYOK 経路を有効にした時点で、その経路が扱うデータは外部サービスへ送信されます（お客様の選択に基づきます）。

---

## 1. 本ソフト（Electron デスクトップアプリ）の実行モード別データフロー

本ソフトの動作モードは `providerMode`（`trial` | `byok` | `local`）と `sttMode`（`local` | `cloud`）の組み合わせで決まります。両者は `preferences.json` に保存されます（`src/storage.js`）。BYOK 経路は **お客様自身の API キーを設定した場合のみ** 有効になります。

| モード ID | 入力データ | 局所処理 | 端末外送信 | 送信先 | 当方の受領 | コード証跡 |
|---|---|---|---|---|---|---|
| `trial`（既定起動時） | マイク音声、画面（任意で取得） | Whisper ローカル推論で文字起こし → 5要素 regex 判定 | **なし**（Whisper モデルの初回ダウンロード時を除く / 後述） | — | なし | `src/storage.js` (`DEFAULT_PREFERENCES.providerMode='trial'`)、`src/utils/localai.js` (`loadWhisperPipeline`, `handleSpeechEnd`)、`src/utils/discoveryEvidence.js` |
| `byok-gemini`（`providerMode='byok'`, Gemini API キー設定済み） | マイク音声、画面（任意）、文字起こし transcript | regex 5要素判定（端末内） | 音声・transcript・画面（取得時）が Gemini Live / generateContent へ送信 | Google Gemini API（米国） | なし（お客様のキーで直送） | `src/utils/gemini.js` (`GoogleGenAI`, `sendToGroq` ではなく Gemini Live セッション化)、`src/utils/discoveryEvidenceLLM.js`、`src/utils/keyVerify.js` (`https://generativelanguage.googleapis.com/v1beta/models`) |
| `byok-deepgram`（`sttMode='cloud'`, Deepgram API キー設定済み） | マイク音声、商談相手の音声（WASAPI loopback） | 24kHz→16kHz リサンプリング | 16kHz PCM が Deepgram WebSocket へ送信 | Deepgram（米国） | なし（お客様のキーで直送） | `src/utils/deepgram.js` (`wss://api.deepgram.com/v1/listen` URL 定数、`send()`)、`src/utils/audioCapture.js`（WASAPI loopback ネイティブヘルパ）、`src/utils/keyVerify.js` (`https://api.deepgram.com/v1/projects` キー検証) |
| `local-ollama`（`providerMode='local'`） | マイク音声 → 文字起こし transcript | Whisper ローカル推論、Ollama ローカル推論 | **なし**（既定 `127.0.0.1:11434` 通信は端末内）。Ollama モデル初回 `pull` 時を除く（後述） | — | なし | `src/storage.js` (`DEFAULT_PREFERENCES.ollamaHost='http://127.0.0.1:11434'`)、`src/utils/localai.js` (`initializeLocalSession`, `Ollama` クライアント) |
| `local-whisper`（既定 STT） | マイク音声、商談相手の音声 | `@huggingface/transformers` の Whisper パイプライン（端末内推論） | **なし**（モデル初回ダウンロード時を除く / 後述） | — | なし | `src/utils/localai.js` (`loadWhisperPipeline`, `transcribeAudio`, `env.cacheDir`) |
| Groq クラウド LLM（隠しレーン） | transcript | — | transcript が Groq Chat Completions へ送信 | Groq（米国） | なし（お客様の Groq キーで直送） | `src/utils/gemini.js` (`sendToGroq`, `https://api.groq.com/openai/v1/chat/completions`)。UI からは未公開の開発者向けレーン（`trialModeContract.test.js` で契約化）。 |

### 1.1 モデル初回ダウンロード（trial / local-whisper / local-ollama 共通）

- **Whisper モデル**: `@huggingface/transformers` 経由で Hugging Face Hub（`huggingface.co`）から取得（既定モデル: `Xenova/whisper-tiny`）。`src/utils/localai.js` の `pipeline('automatic-speech-recognition', modelName, …)` 呼び出し時。キャッシュ先は `app.getPath('userData')/whisper-models` で、以後の起動では再ダウンロードは発生しません。
- **Ollama モデル**: お客様が手動で `ollama pull <model>` を実行された場合のみ、Ollama サーバ（既定では端末内 `127.0.0.1:11434`）からのモデル取得が発生します。本ソフトは Ollama 既存セッションを利用するのみで、本ソフト側から `pull` をトリガしません。

### 1.2 端末内に永続化される情報

| データ | 保存場所 | 暗号化 | 用途 | コード証跡 |
|---|---|---|---|---|
| 設定（`config.json`） | `%APPDATA%/whisper-oh-kami-config/config.json` | プレーン | onboarded フラグ、レイアウト | `src/storage.js` (`getConfigPath`, `setConfig`) |
| 認証情報（`credentials.json`） | `%APPDATA%/whisper-oh-kami-config/credentials.json` | Electron `safeStorage`（OS のキーリングを使用。利用不可な環境ではプレーン警告付き） | Gemini / Groq / Deepgram API キー | `src/storage.js` (`encryptCredentialsForDisk`, `decryptCredentialsPayload`, `ENCRYPTED_CREDENTIALS_MARKER`) |
| 設定値（`preferences.json`） | `%APPDATA%/whisper-oh-kami-config/preferences.json` | プレーン | provider mode、STT mode、Ollama host、Whisper モデル、UI 設定 | `src/storage.js` (`getPreferencesPath`, `DEFAULT_PREFERENCES`) |
| 会話履歴 | `%APPDATA%/whisper-oh-kami-config/history/<sessionId>.json` | プレーン | セッション内 transcript・5要素 evidence・feedbackEvents | `src/storage.js` (`getHistoryDir`, `saveSession`, `getAllSessions`) |
| Whisper モデルキャッシュ | `<Electron userData>/whisper-models/` | プレーン（ONNX バイナリ） | ローカル推論用モデル | `src/utils/localai.js` (`env.cacheDir = path.join(app.getPath('userData'), 'whisper-models')`) |

### 1.3 当方が運営するサーバへの送信（テレメトリ・クラッシュレポート・自動更新）

本ソフトは、**当方が運営するサーバ** への以下の送信を行いません。

- テレメトリ（利用状況の自動送信）
- 自動クラッシュレポート
- 自動更新チェック（本サービス v1 のスコープでは未実装）

ただし、当方が運営するサーバ以外への通信（モデル初回ダウンロード、BYOK 経路、各 SDK の内部通信）はモードと設定によって発生します。本表の各行を必ずご参照ください。

---

## 2. 本サービス（ランディングページ・販売バックエンド）のデータフロー

本サービスのバックエンドは **Cloudflare Pages（静的配信）+ Cloudflare Pages Functions（API）+ Cloudflare D1（注文状態）+ Cloudflare R2（成果物保管）+ Cloudflare Turnstile（ボット検証）+ Stripe（決済）+ Gmail（事務連絡）** から構成されます。

| 経路 | 入力データ | 局所処理 | 送信先 | 用途 | データクラス | コード証跡 |
|---|---|---|---|---|---|---|
| ランディングページ閲覧 | ブラウザ HTTP リクエスト | 静的 HTML 配信 | — | LP 表示 | アクセスログ（Cloudflare 側の通常ログ範囲） | `lp/src/pages/index.astro` |
| 招待リクエスト | お客様のメールアドレス（任意の本文） | mailto: リンクで起動するだけ | Gmail（運用窓口） | 招待制販売の応募・事務連絡 | メールアドレス、本文 | `lp/src/components/PaidBetaCta.astro` (`mailto:`) |
| Stripe Checkout 決済 | カード情報、請求先情報 | Stripe 側で処理 | Stripe（米国） | 決済処理 | 決済情報、メールアドレス | Stripe Payment Link（招待時にメールで送付）。`lp/functions/api/stripe/webhook.ts` が `checkout.session.completed` を受領 |
| Stripe Webhook 受領 | Stripe イベント payload（session_id、payment_intent_id、price_id、amount、currency 等） | HMAC-SHA-256 署名検証 → Cloudflare D1 への注文行挿入 | Cloudflare D1（`orders` テーブル、`stripe_events` テーブル） | 注文状態の永続化 | Stripe 識別子（PII を含まない）、注文ステータス、access_generation、claim_open_until 等 | `lp/functions/api/stripe/webhook.ts` (`handleStripeWebhook`)、`lp/functions/_lib/orders.ts` (`recordPaidOrder`, `beginStripeEvent`) |
| 注文クレーム | `session_id`、Turnstile token | Cloudflare D1 で注文を CAS 取得し、access_id を発行 | Cloudflare D1、Cloudflare Turnstile（米国） | アクセス URL の発行 | session_id、access_id、access_generation | `lp/functions/api/orders/claim.ts`、`lp/functions/_lib/orders.ts` (`claimPaidOrder`)、`lp/functions/_lib/turnstile.ts` (`verifyTurnstile`) |
| 成果物ダウンロード | access_id、HMAC 署名、Turnstile token、artifact 種別 | 署名検証 → Cloudflare D1 で entitlement 確認 → Cloudflare R2 から presigned URL を発行 | Cloudflare D1、Cloudflare R2、Cloudflare Turnstile | バイナリ・対応ソース・ライセンス等の配信 | access_id、artifact key | `lp/functions/api/download.ts`、`lp/functions/_lib/r2.ts` (`signR2Download`, `headR2Object`)、`lp/functions/_lib/crypto.ts` (`verifyAccessLink`) |

### 2.1 各サービスが扱うデータと当方の責務

| サービス | 取り扱うデータ | 当方が読める? | データの所在 |
|---|---|---|---|
| Stripe | カード情報、請求先情報、購入者のメールアドレス、決済額 | カード情報は読めません（PCI DSS 上、Stripe が処理）。メールアドレスは Stripe ダッシュボードで参照可能。 | Stripe（米国） |
| Cloudflare D1（`orders` テーブル） | Stripe `session_id`、Stripe `payment_intent_id`、`payment_link_id`、`price_id`、`amount_total`、`currency`、注文ステータス（`paid` / `refunded` / `disputed` / `revoked`）、`access_id`（不透明）、`access_generation`、`claim_open_until`、`claimed_at`、`created_at`、`updated_at`、`revoked_at`、`revoked_reason`、`entitlement_line` | はい（管理者として） | Cloudflare（グローバル分散、`wrangler.jsonc` で region 設定） |
| Cloudflare D1（`stripe_events` テーブル） | Stripe `event_id`（不透明）、`event_type`、`status`、`outcome_code`、`attempt_count`、`received_at`、`processed_at`、`last_error` | はい | Cloudflare |
| Cloudflare R2 | 配布成果物（インストーラ、対応ソース zip、ライセンス、NOTICES、ガイド、ビルド手順、ロックファイル zip、マニフェスト JSON）、各成果物の SHA-256 メタデータ | はい（管理者として） | Cloudflare |
| Cloudflare Turnstile | お客様の IP アドレス、ブラウザフィンガープリント（Turnstile 内部処理）、Turnstile token | Turnstile 内部処理に依存。当方は token の検証結果のみ受領。 | Cloudflare（Turnstile） |
| Gmail | 事務連絡メール（アクセスリンク再発行・問い合わせ・返金申請）の本文、お客様のメールアドレス | はい（運用者として） | Google（Gmail） |

### 2.2 Cloudflare D1 に保存される情報の制限

Cloudflare D1 の `orders` テーブルには、**お客様の氏名・住所・電話番号・カード情報は一切保存しません**。保存されるのは Stripe 識別子（不透明な文字列）、不透明なアクセス状態、entitlement 状態、クレームタイムスタンプ等です。お客様のメールアドレスも D1 には保存しません（Stripe 側に残ります）。

実装: `lp/functions/_lib/orders.ts` の `OrderRow` 型定義および `recordPaidOrder` の `INSERT` 文を参照。

### 2.3 カード情報の取扱い

カード情報は **Cloudflare には一切入りません**。Stripe Checkout がカード情報を Stripe 内部で処理し、当方は Stripe Dashboard 上のマスクされた表示のみ参照可能です。Cloudflare Pages Functions が Stripe Webhook を受領した際にも、カード情報は payload に含まれません（Stripe Webhook の通常仕様）。

---

## 3. 保持期間

| データ種別 | 保持期間 | 根拠 |
|---|---|---|
| 処理済み Stripe `event_id` および安定な `outcome_code`（`stripe_events` テーブル） | **90日** 後に削除 | 重複配信防止のための idempotency window。長期保持は不要。 |
| `orders` テーブルの注文識別子・entitlement 状態 | 本サービスの有償ダウンロードアクセスが稼働している間、保持 | アクセス URL の有効性検証・事務的再発行に必要 |
| 終了後の取引証跡（金額・日時・取引相手・取引対価等、会計・税務上必要な範囲のもの） | 取引の発生から **最長 7年** | 国税庁の「取引に関して相手方から受け取った注文書、契約書、送り状、領収書、見積書その他これらに準ずる書類」の保存期間（法人税法施行規則第59条、所得税法施行規則第63条、消費税法施行令第50条等）に準じます。D1 自体が法定の正式な会計帳簿である旨を主張するものではなく、当方が別途保管する会計記録の補助情報として、最長 7年 までこれを保持することがあります。 |
| 返金・チャージバック（dispute）・法的保全（legal hold）の対象となる取引記録 | 上記期間によらず、保全の必要が解消するまで | 法的保全・紛争対応 |
| Gmail 上の事務連絡 | 必要に応じて随時整理（事務上の必要性が消滅した時点で削除を検討） | 個人開発・趣味スコープでの運用負荷を踏まえた合理的範囲 |

実装証跡: `lp/functions/_lib/orders.ts` の `INSERT` および `UPDATE` 文には現時点で自動削除のスケジュールは含まれていません。90日の `stripe_events` パージは別途運用スクリプト（後続タスクで実装予定）で実行します。

---

## 4. 「端末外に出ない」と書ける条件のチェックリスト

プライバシーポリシーで「端末外に出ない」と書ける条件は、次のすべてを満たした場合に限られます。

1. `providerMode` が `trial` または `local` であること（`byok` ではない）
2. `sttMode` が `local` であること（`cloud` = Deepgram 経由ではない）
3. Whisper モデル・Ollama モデルの初回ダウンロードが完了していること（以後の起動では追加通信は発生しない）
4. 開発者向け Groq レーンが有効化されていないこと（UI からは未公開。`getGroqApiKey()` がキーを返さない）

上記いずれかが満たされない場合、該当する経路で端末外への送信が発生します。各経路の送信先は本書 §1 の表を参照してください。

---

## 5. 参考: 関連テスト

本書の各記述は、次の自動テストで部分的に契約化されています。

- `tests/unit/trialModeContract.test.js` — trial / local / byok の各モードで外部送信が発生しない条件を契約化
- `tests/unit/deepgram.test.js` — Deepgram URL と send 動作の契約
- `tests/unit/paidCloudflareConfig.test.js` — Cloudflare 側の env / D1 / R2 / Turnstile の構成契約
- `lp/test/orders.test.ts` 系 — D1 注文状態遷移
- `lp/test/webhook.test.ts` 系 — Stripe webhook の payload 検証
