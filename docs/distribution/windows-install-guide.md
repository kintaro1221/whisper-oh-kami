# WhisperOhKAMI Windows インストールガイド

最終更新日: 2026-10-04
対象バージョン: v0.7 系
対象 OS: Windows 11 x64

WhisperOhKAMI は現在、GitHub Release（<https://github.com/kintaro1221/whisper-oh-kami/releases>）で無料公開しています。本ガイドはそのインストーラの入手・検証・インストール手順をまとめたものです。本ソフトはオープンソース（GPL-3.0）であり、権利と再配布上のお願いは §10 にまとめています。

なお、本ファイルは将来の有償配布バンドル用の `guide.md` としても使い回せるよう、バンドル固有の手順（§2.2・§3.2・§9）を残しています。有償配布は現在提供していないため、GitHub Release から入手した方はこれらの節を読み飛ばしてください。

---

## 1. システム要件

| 項目         | 要件                                                                                                                                                                        |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OS           | Windows 11 64-bit (x64)                                                                                                                                                     |
| メモリ       | 8 GB 以上推奨（Whisper ローカル推論を含めると 16 GB 推奨）                                                                                                                  |
| ディスク     | 2 GB 以上の空き（既定・低スペック向けの Whisper モデル tiny / small はインストーラに同梱。任意の高精度モデルを選ぶ場合は追加で約 1 GB のキャッシュ）                        |
| マイク       | 商談相手の音声を入力できる物理マイクまたは仮想オーディオデバイス                                                                                                            |
| ネットワーク | BYOK 経路の利用時、または任意の高精度 Whisper モデル（kotoba-whisper-v2.2、初回選択時のみ）を使う場合に必要。既定・Tiny の Whisper モデルは同梱のため初回起動時の通信は不要 |

macOS / Linux 版は本サービス v1 のスコープでは配布していません。GPL-3.0 の対応ソース（§10）からビルドすることは妨げられません。

---

## 2. 配布物の構成

### 2.1 GitHub Release（現在の入手方法）

[Releases ページ](https://github.com/kintaro1221/whisper-oh-kami/releases)の各リリースに、次のファイルを添付しています。

| ファイル                            | 内容                                                                    |
| ----------------------------------- | ----------------------------------------------------------------------- |
| `WhisperOhKAMI-<version>.Setup.exe` | Windows 用インストーラ（Squirrel.Windows 形式、未署名）                 |
| `SHA256SUMS.txt`                    | 上記インストーラの SHA-256（§3.1 の検証に使います）                     |
| `Source code (zip)`                 | GitHub が自動生成するタグ `v<version>` のソースアーカイブ（対応ソース） |

### 2.2 有償配布バンドル（現在は提供していません）

有償配布を再開した場合のバンドル構成です（バージョン番号は購入時にお知らせするものに置き換えてください）。

| ファイル                 | 内容                                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `installer.exe`          | Windows 用インストーラ（Squirrel.Windows 形式、未署名）                                                      |
| `source.zip`             | リリース時点での Git 全トラッキングファイルのアーカイブ（対応ソース）                                        |
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

この手順は GPL-3.0 ソフトを未署名で配布する際の通常運用です。SmartScreen は実行ファイルの SHA-256 をクラウドで照合しているだけであり、警告が出ること自体はソフトの安全性とは独立しています。事前に手順 3（SHA-256 検証）を行っていただければ、配布元と同一バイナリであることをお客様自身で確認した上で実行できます。

### 4.2 インストール先

Squirrel.Windows の既定動作に従い、本ソフトは次のパスに展開されます。

```
%LOCALAPPDATA%\whisper-oh-kami\
```

実体的には次のサブディレクトリ・ファイルが作成されます。

| パス                                            | 内容                                                             |
| ----------------------------------------------- | ---------------------------------------------------------------- |
| `%LOCALAPPDATA%\whisper-oh-kami\app-<version>\` | アプリ実体（Electron バイナリ、`resources\app\`）                |
| `%LOCALAPPDATA%\whisper-oh-kami\Update.exe`     | Squirrel のアップデータ（v1 ではアップデート機能を利用しません） |
| `%APPDATA%\whisper-oh-kami-config\`             | 設定・履歴・認証情報の保存先（後述）                             |

### 4.3 起動

スタートメニューに「WhisperOhKAMI」が追加されます。クリックすると Electron アプリが起動します。既定の Whisper モデル（`Xenova/whisper-small`、低スペック向けの `Xenova/whisper-tiny` も選択可）はインストーラに同梱されているため、初回起動時の追加ダウンロードは発生しません。設定でより高精度な `onnx-community/kotoba-whisper-v2.2-ONNX`（任意・約 1 GB）を選んだ場合のみ、初回選択時に Hugging Face Hub からダウンロードされます。

---

## 5. BYOK セットアップ

本ソフトはお客様自身の API キーを使う（BYOK = Bring Your Own Key）構成です。**当方は API キーを提供しません**。各サービスのコストはお客様負担です。

| プロバイダ    | 用途                                   | キー取得先                                                 |
| ------------- | -------------------------------------- | ---------------------------------------------------------- |
| Google Gemini | クラウド LLM（提案文生成等）           | [Google AI Studio](https://aistudio.google.com/app/apikey) |
| Deepgram      | クラウド STT（リアルタイム文字起こし） | [Deepgram Console](https://console.deepgram.com/)          |
| Groq          | クラウド LLM（開発者向け隠しレーン）   | [Groq Console](https://console.groq.com/keys)              |

設定方法はアプリ内の「設定」→「BYOK キー設定」から行ってください。キーは Electron `safeStorage` 経由で OS のキーリングに暗号化保存されます（`%APPDATA%\whisper-oh-kami-config\credentials.json`）。

---

## 6. ローカル推論（Whisper / Ollama）の構成

クラウドサービスを使わずローカル推論のみで動作させることも可能です（BYOK キーは不要）。

### 6.1 Whisper（既定 STT）

何もしなくても、既定モデル（Small、同梱済み）で端末内完結の文字起こしが動作します。設定 → STT → Whisper（既定）を維持してください。低スペック PC では同梱済みの Tiny に切り替え可能です。設定でより高精度な `kotoba-whisper-v2.2-ONNX`（任意）を選んだ場合のみ、初回選択時に Hugging Face Hub からのダウンロードが発生します。

### 6.2 Ollama（既定 LLM ローカルモード）

設定 → プロバイダ → ローカル に切り替えると、`http://127.0.0.1:11434` 上の Ollama サーバに接続します。事前に Ollama 公式インストーラで Ollama 本体を導入し、`ollama pull <model>` で利用したいモデル（例: `llama3.2:3b`、`qwen2.5:3b`）を取得しておく必要があります。

ローカル推論モードでは、商談音声・transcript は **端末外に送信されません**（モデル初回ダウンロード時を除く）。

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

**対応ソースの入手先**: GitHub Release 版の対応ソースは、Releases ページの該当リリースにある `Source code (zip)`（タグ `v<version>`）と、公開リポジトリ（<https://github.com/kintaro1221/whisper-oh-kami>）の同タグです。ビルド手順は `docs/distribution/build-from-source.md` を参照してください。有償配布バンドル（現在は提供していません）では、同梱の `source.zip` と `lockfiles.zip` が対応ソースです（リリース時点のコミット SHA は `manifest.json.commitSha` に記録）。

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
