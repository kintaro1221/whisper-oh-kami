# WhisperOhKAMI Windows インストールガイド

最終更新日: 2026-10-12
対象バージョン: v0.7 系
対象 OS: Windows 11 x64

WhisperOhKAMI は現在、GitHub Release（<https://github.com/kintaro1221/whisper-oh-kami/releases>）で無料公開しています。本ガイドはそのインストーラの入手・検証・インストール手順をまとめたものです。本ソフトはオープンソース（GPL-3.0）であり、権利と再配布上のお願いは §10 にまとめています。

なお、本ファイルは将来の有償配布バンドル用の `guide.md` としても使い回せるよう、バンドル固有の手順（§2.2・§3.2・§9）を残しています。有償配布は現在提供していないため、GitHub Release から入手した方はこれらの節を読み飛ばしてください。

---

## 1. システム要件

| 項目         | 要件                                                                                                                                                 |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| OS           | Windows 11 64-bit (x64)                                                                                                                              |
| メモリ       | 8 GB 以上推奨（Whisper ローカル推論を含めると 16 GB 推奨）                                                                                           |
| ディスク     | 2 GB 以上の空き（既定・低スペック向けの Whisper モデル tiny / small はインストーラに同梱。任意の高精度モデルを選ぶ場合は追加で約 1 GB のキャッシュ） |
| マイク       | 商談相手の音声を入力できる物理マイクまたは仮想オーディオデバイス                                                                                     |
| ネットワーク | BYOK、別PCのOllama、任意Whisperモデルの初回取得時に必要。同梱Tiny/Smallの取得通信は不要ですが、起動時の更新確認は全モード共通です（§6.3）。          |

macOS / Linux 版は本サービス v1 のスコープでは配布していません。GPL-3.0 の対応ソース（§10）からビルドすることは妨げられません。

---

## 2. 配布物の構成

### 2.1 GitHub Release（現在の入手方法）

[Releases ページ](https://github.com/kintaro1221/whisper-oh-kami/releases)の各リリースに、次のファイルを添付しています。

| ファイル                            | 内容                                                                                                        |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `WhisperOhKAMI-<version>.Setup.exe` | Windows 用インストーラ（Squirrel.Windows 形式、未署名）                                                     |
| `SHA256SUMS.txt`                    | 上記インストーラの SHA-256（§3.1 の検証に使います）                                                         |
| `Source code (zip)`                 | GitHub が自動生成するタグ `v<version>` の製品ソースアーカイブ。第三者ソースの収録範囲はビルド手順 §5 を参照 |

### 2.2 有償配布バンドル（現在は提供していません）

有償配布を再開した場合のバンドル構成です（バージョン番号は購入時にお知らせするものに置き換えてください）。

| ファイル                 | 内容                                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `installer.exe`          | Windows 用インストーラ（Squirrel.Windows 形式、未署名）                                                      |
| `source.zip`             | ビルド対象コミットの製品ソース。`.gitattributes` の `export-ignore` 対象は除外（ビルド手順 §5）              |
| `lockfiles.zip`          | 再現ビルドに必要な 2 つのロックファイル（root `package-lock.json`、`native/daddy-audio-capture/Cargo.lock`） |
| `LICENSE`                | GPL-3.0 ライセンス全文                                                                                       |
| `THIRD_PARTY_NOTICES.md` | npm 本番依存の各パッケージのライセンス通知                                                                   |
| `guide.md`               | 本ファイル                                                                                                   |
| `build-instructions.md`  | ソースからビルドする手順（`docs/distribution/build-from-source.md` のコピー）                                |
| `manifest.json`          | 上記各ファイルの SHA-256 とサイズ、コミット SHA、生成日時を記録                                              |
| `manifest.json.sha256`   | `manifest.json` 自身の SHA-256（運用者が D1 に登録する値と同一）                                             |

---

## 3. 完全性の検証（推奨）

ダウンロードしたファイルが配布元と同一であることを、SHA-256 で確認できます。

> **大文字 / 小文字の注意**: PowerShell の `Get-FileHash` は既定で **大文字** の 16 進ハッシュ (`A-F`) を返します。一方、`SHA256SUMS.txt` と `manifest.json` には **小文字** で記録しています。文字列を直接見比べると不一致に見えるため、小文字に揃えるか、大小文字を無視して比較してください。

### 3.1 GitHub Release 版

1. インストーラと同じ Release から `SHA256SUMS.txt` もダウンロードし、同じフォルダに置きます。
2. そのフォルダで次のいずれかを実行し、ハッシュ値を表示します。

```powershell
# コマンドプロンプト / PowerShell 共通（小文字で表示されます）
certutil -hashfile WhisperOhKAMI-<version>.Setup.exe SHA256

# PowerShell の場合（小文字に揃えて表示）
(Get-FileHash -Algorithm SHA256 .\WhisperOhKAMI-<version>.Setup.exe).Hash.ToLower()
```

3. `SHA256SUMS.txt` をテキストエディタで開き、`WhisperOhKAMI-<version>.Setup.exe` の行の値と一致することを確認してください。一致しない場合は実行せず、Releases ページから再ダウンロードしてください。

### 3.2 有償配布バンドル（現在は提供していません）

バンドル同梱の `manifest.json` には、`installer.exe` を含む各成果物の SHA-256 とサイズが記録されています。次のいずれかのパターンで検証してください。

```powershell
# パターン 1: 出力を小文字に揃えてから manifest.json と見比べる
(Get-FileHash -Algorithm SHA256 .\installer.exe).Hash.ToLower()
(Get-FileHash -Algorithm SHA256 .\source.zip).Hash.ToLower()
(Get-FileHash -Algorithm SHA256 .\lockfiles.zip).Hash.ToLower()
(Get-FileHash -Algorithm SHA256 .\LICENSE).Hash.ToLower()
(Get-FileHash -Algorithm SHA256 .\THIRD_PARTY_NOTICES.md).Hash.ToLower()
(Get-FileHash -Algorithm SHA256 .\guide.md).Hash.ToLower()
(Get-FileHash -Algorithm SHA256 .\build-instructions.md).Hash.ToLower()
```

```powershell
# パターン 2: 大小文字を無視 (-ieq) で 1 行検証
# manifest.json から該当 installer.exe の sha256 をコピペして '<manifest-sha256>' を置換
(Get-FileHash -Algorithm SHA256 .\installer.exe).Hash -ieq '<manifest-sha256>'
# True が返れば一致
```

`manifest.json` を任意のテキストエディタで開き、`items[]` の `sha256` 値とパターン 1 / 2 の結果が一致することを確認してください。

`manifest.json` 自身の SHA-256 は `manifest.json.sha256` ファイルに記録されています。これは運用者が D1 の `artifacts.manifest_sha256` 列に登録した値と同一であり、配布元と異なる場合は **使用を中止して連絡先メールにご連絡ください**。

---

## 4. インストール

### 4.1 SmartScreen 警告について

本ソフトのインストーラは Authenticode 署名を **行っていません**（個人開発の無償公開版であり、コード署名証明書の取得・運用コストは見送っています）。このため、インストーラ（`WhisperOhKAMI-<version>.Setup.exe`）を実行すると Windows SmartScreen が次のような警告を表示します。

> Windows によって PC が保護されました
> Microsoft Defender SmartScreen は認識されないアプリの起動を停止しました。

**手順**:

1. 警告ダイアログの「**詳細情報**」をクリック
2. 表示される「**実行**」ボタンをクリック

未署名のため、Windowsによる発行元の確認はできません。警告を無条件に無視せず、配布元を確認し、§3のSHA-256照合を行ったうえで実行を判断してください。ハッシュ一致は配布元が示したファイルとの一致を確認するもので、安全性や署名の代わりにはなりません。

### 4.2 インストール先

Squirrel.Windows の既定動作に従い、本ソフトは次のパスに展開されます。

```
%LOCALAPPDATA%\whisper-oh-kami\
```

実体的には次のサブディレクトリ・ファイルが作成されます。

| パス                                            | 内容                                                                     |
| ----------------------------------------------- | ------------------------------------------------------------------------ |
| `%LOCALAPPDATA%\whisper-oh-kami\app-<version>\` | アプリ実体（Electron、`resources\app.asar`、ネイティブ依存・同梱モデル） |
| `%LOCALAPPDATA%\whisper-oh-kami\Update.exe`     | Squirrel のアップデータ（v1 ではアップデート機能を利用しません）         |
| `%APPDATA%\whisper-oh-kami-config\`             | 設定・履歴・認証情報の保存先（後述）                                     |

### 4.3 起動

スタートメニューに「WhisperOhKAMI」が追加されます。クリックすると Electron アプリが起動します。既定の Whisper モデル（`Xenova/whisper-small`、低スペック向けの `Xenova/whisper-tiny` も選択可）はインストーラに同梱されているため、初回起動時の追加ダウンロードは発生しません。設定でより高精度な `onnx-community/kotoba-whisper-v2.2-ONNX`（任意・約 1 GB）を選んだ場合のみ、初回選択時に Hugging Face Hub からダウンロードされます。

---

## 5. BYOK セットアップ

「自前キー」（BYOK = Bring Your Own Key）モードはお客様自身のAPIキーを使います。「お試し」と「ローカルAI」にはBYOKキーは不要です。**当方はAPIキーを提供しません**。外部サービスの利用料金はお客様負担です。自前キー・ローカルAIはアプリ上で「検証中」と表示され、開始前に制約が案内されます。

| プロバイダ    | 用途                                                  | キー取得先                                                 |
| ------------- | ----------------------------------------------------- | ---------------------------------------------------------- |
| Google Gemini | Gemini Liveによる音声処理・AI応答、テキスト・画面解析 | [Google AI Studio](https://aistudio.google.com/app/apikey) |
| Deepgram      | クラウド STT（リアルタイム文字起こし）                | [Deepgram Console](https://console.deepgram.com/)          |

メイン画面の「自前キー」を選び、「🧭 はじめての方：ガイド付きで設定」または同画面の「Gemini API キー」「Deepgram API キー（任意）」欄を使います。一般利用向けのキー入力欄はこの2サービスです。接続確認時にも各社APIへ通信します。

Deepgramはキーを入力しただけでは音声送信を開始しません。「設定」の「音声認識エンジン」で「クラウド優先」を選択し、BYOKセッションで有効になった場合に使用します。**Deepgramを使わない設定でも、BYOKでは相手の音声がGemini Liveに送信されます。** 各モードの送信条件は§6.3を参照してください。

キーはElectron `safeStorage`（WindowsではDPAPI）で暗号化して `%APPDATA%\whisper-oh-kami-config\credentials.json` に保存します。暗号化が利用できない場合はディスクに書かず、そのセッション中だけメモリに保持し、次回起動時に再入力が必要です。

---

## 6. ローカル推論（Whisper / Ollama）の構成

クラウドサービスを使わずローカル推論のみで動作させることも可能です（BYOK キーは不要）。

### 6.1 Whisper（既定 STT）

Whisperの音声認識は端末内で行います。「設定」のWhisperモデル選択から、同梱Small（既定）・Tiny、任意の高精度 `kotoba-whisper-v2.2-ONNX` を選べます。任意モデルはキャッシュがない初回利用時などにHugging Face Hubから取得します。**音声認識が端末内でも、AI応答に使うtranscript等の送信先はモードによって異なります。**

### 6.2 Ollama（既定 LLM ローカルモード）

メイン画面で「ローカルAI」を選び、「Ollama Host」と「Ollama Model」を設定します。Hostの既定値は `http://127.0.0.1:11434`（このPC）です。指定先でOllamaを起動し、使用するモデルをあらかじめ `ollama pull <model>` 等で用意してください。本アプリは接続確認と推論要求をそのHostへ送り、Ollamaモデルの取得は自動実行しません。

別PCやリモートサーバをHostに指定した場合、**文字起こし、入力文、会話履歴、システムプロンプト（補足情報を含む）、画面解析時の画像はそのHostへ送信されます。** Whisperが処理する音声そのものをOllamaへ送る経路ではありません。このPCのOllamaを使う場合でも、Ollama側のクラウド連携・転送設定までは本アプリで制御しません。

### 6.3 モード別の送信先

| モード・操作           | 会話データの処理・送信先                                                                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| お試し                 | マイク音声を端末内Whisperで文字起こしし、5要素を判定。AI応答はなく、会話データを外部AIへ送りません。                                                                           |
| ローカルAI             | 音声認識は端末内Whisper。文字起こし・入力文・履歴・プロンプト、画面解析を使う場合の画像を指定したOllama Hostへ送信。このPC以外のHostなら端末外送信です。                       |
| 自前キー               | Gemini Liveへ相手音声を送信。AI応答・解析に使う入力文、transcript、プロンプトや履歴、取得した画面もGoogle Geminiへ送信します。Deepgramを無効にしてもGemini送信は止まりません。 |
| 自前キー＋Deepgram有効 | クラウド文字起こしに使うマイク／相手の音声をDeepgramへ追加送信します。入力機器と音声モードによって対象が変わります。                                                           |

全モードで、起動時に `https://whisperohkami.pages.dev/api/release/latest` へ更新確認を行います。この経路に会話音声・transcript・設定は含めませんが、接続先には通常の通信情報（IPアドレス等）が伝わります。任意Whisperモデルの取得時はHugging Face Hub等の配信先と通信します。モデル取得の通信と会話データの推論先は別です。詳しくは `docs/legal/data-flow-matrix.md` を参照してください。

---

## 7. データの保存先

| データ                            | パス                                                                        | 暗号化                                  |
| --------------------------------- | --------------------------------------------------------------------------- | --------------------------------------- |
| 設定（onboarded フラグ等）        | `%APPDATA%\whisper-oh-kami-config\config.json`                              | 平文                                    |
| BYOK 認証情報                     | `%APPDATA%\whisper-oh-kami-config\credentials.json`                         | Electron `safeStorage`（OS キーリング） |
| 動作設定                          | `%APPDATA%\whisper-oh-kami-config\preferences.json`                         | 平文                                    |
| 会話履歴（transcript / evidence） | `%APPDATA%\whisper-oh-kami-config\history\<sessionId>.json`                 | 平文                                    |
| Whisper モデルキャッシュ          | `%APPDATA%\whisper-oh-kami\whisper-models\` または Electron `userData` 配下 | 平文（ONNX バイナリ）                   |
| アプリログ（Electron 標準）       | `%APPDATA%\whisper-oh-kami\logs\`                                           | 平文                                    |

データの流れの詳細は公開リポジトリの `docs/legal/data-flow-matrix.md` を、依存パッケージのライセンスは同じく `THIRD_PARTY_NOTICES.md` を参照してください。

---

## 8. アンインストール

「設定」→「アプリ」→「インストールされているアプリ」から「WhisperOhKAMI」を選び、「アンインストール」を実行してください。

アンインストール後も、次のディレクトリは残ります。完全に削除する場合は手動で削除してください（再インストール時に履歴を引き継ぎたい場合は残してください）。

- `%APPDATA%\whisper-oh-kami-config\`（設定・履歴・認証情報）

---

## 9. アクセス URL の再発行（有償配布バンドルのみ・現在は提供していません）

本節は有償配布バンドルの購入者向けで、GitHub Release から入手した場合は該当しません。有償配布を再開した場合、購入時のアクセス URL を紛失した方は、Stripe 決済時のメールアドレスから購入時の案内に記載の連絡先へ、件名「アクセス URL 再発行依頼」・決済日を添えてご連絡ください。運用者が決済記録を照合のうえ新しい URL をお送りします（Stripe の領収書再送機能や Customer Portal は提供していません）。

---

## 10. GPL-3.0 の権利のお知らせ

本ソフトは GPL-3.0 でライセンスされています。公開リポジトリ直下の `LICENSE` 全文をお読みください。要旨を次に記しますが、本要旨は法的助言ではなく、`LICENSE` 本文が正本です。

**製品ソースの入手先**: GitHub Releaseの該当タグの `Source code (zip)` と公開リポジトリ（<https://github.com/kintaro1221/whisper-oh-kami>）、候補バンドル内の `source.zip` / `lockfiles.zip` です。バンドルでは `manifest.json.commitSha` で対象を識別します。これらは第三者依存の全ソースを含むものではありません。収録範囲、上流ソースの参照先、公開前に残る対応ソースの確認事項は `docs/distribution/build-from-source.md` §5に記載しています。

- **使用の自由**: 用途を制限せず、商用利用を含めご自由に使えます。
- **再配布の自由**: 本ソフトのバイナリまたは改変版を、対応ソースと本通知（`LICENSE` および `THIRD_PARTY_NOTICES.md`）を添付した上で再配布できます。
- **改変の自由**: 本ソフトを改変し、改変版を GPL-3.0 で配布できます。
- **対応ソースの提供義務**: バイナリだけを再配布する場合、同等の手段で対応ソースを提供する義務があります。
- **保証なし / 免責**: 本ソフトは「現状のまま」提供されます。詳細は `LICENSE` §15-17 をご参照ください。

GitHub Release 版は無償です。将来有償配布バンドルを提供する場合も、**その対価は配布ホスティングと初期セットアップに対するもの** であり、ソフトのライセンス自体に追加の制約を課すものではありません。

---

## 11. 問い合わせ

| 内容                                                | 連絡先                                                                                                     |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 不具合報告                                          | GitHub Issues（<https://github.com/kintaro1221/whisper-oh-kami/issues>）。個別サポートは提供しておりません |
| アクセス URL 再発行・返金・特定商取引法に関する事項 | 有償配布バンドルの購入者のみ（現在は提供していません）。購入時の案内に記載の連絡先                         |

個別の動作保証・カスタマイズ・専用サポートは提供しておりません。本ソフトのライセンスは `LICENSE`（GPL-3.0）、データの扱いは `docs/legal/privacy-policy.md` を参照してください。
