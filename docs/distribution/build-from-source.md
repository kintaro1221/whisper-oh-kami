# WhisperOhKAMI ソースからのビルド手順

最終更新日: 2026-10-12
対象バージョン: 配布バンドルの `manifest.json.version` に記載のバージョン
対象 OS: Windows 11 x64（macOS / Linux も技術的にはビルド可能ですが、配布のスコープ外です）

このファイルはGitHub Releaseの製品ソースと、候補バンドル（`out/paid-release/<version>/build-instructions.md`）に適用されます。本ソフトの適用ライセンスはリポジトリの `LICENSE`（GNU GPL version 3）です。以下は取得・ビルド方法と収録範囲の説明であり、第三者依存を含む法的適合性全体を保証するものではありません。対応ソースの未確認事項は§5.3を参照してください。

---

## 1. 対応ソースの構成

配布バンドルには次の 2 つの ZIP が同梱されています。

| ZIP             | 内容                                                                                                                                                                                                                                                                                                                                      | git archive プレフィックス   |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `source.zip`    | リリース時点での Git トラッキングファイルのうち、本ソフト（Electron アプリ）のビルドに必要な製品ソースのみ（src、native、docs、設定、2 つのロックファイル）。社内限定の運用ドキュメントやランディングページ（`lp/`）のインフラソースなど、配布バイナリと無関係な内部ファイルは `.gitattributes` の `export-ignore` により除外されています | `whisper-oh-kami-<version>/` |
| `lockfiles.zip` | 2 つのロックファイルだけを抜き出したもの（再現ビルドの参照用）                                                                                                                                                                                                                                                                            | `lockfiles-<version>/`       |

`source.zip` 内のすべてのファイルは、`manifest.json.commitSha` に記録された Git コミット時点の内容と完全に一致します（`export-ignore` で除外されたパスを除く）。コミット SHA は `git archive HEAD` で固定したものであり、リリース後に改変されることはありません。

### 1.1 同梱ロックファイル

| パス                                    | 用途                                                                                                                   |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `package-lock.json`                     | Electron アプリ本体の npm 依存（@google/genai、@huggingface/transformers、electron-squirrel-startup、ollama、ws ほか） |
| `native/daddy-audio-capture/Cargo.lock` | Rust 製ネイティブヘルパ（WASAPI loopback 録音）の Cargo 依存                                                           |

これらは `npm ci` および `cargo build --locked` で使用する依存バージョン・取得先・整合性情報を記録します。依存の取得には外部配布元へのアクセスが必要です。lockfile自体は第三者ソースの複製ではなく、取得先の継続提供やソース一式の完全性を保証しません。

### 1.2 同梱されないもの（ランディングページ・社内運用ドキュメント）

`lp/`、社内運用ドキュメント、エージェント設定、非公開の回帰fixtureとそれに依存するテスト等は `.gitattributes` の `export-ignore` により除外します。これらは現在のElectronアプリのビルド入力として使用していません。「すべての追跡ファイル／すべてのテストが入る」という意味ではありません。除外設定を変更した場合は、生成・インストール・実行・改変に必要なソースやスクリプトを除いていないか再点検してください。

---

## 2. 必要なツール

| ツール            | バージョン要件                                                     | 確認方法                                         |
| ----------------- | ------------------------------------------------------------------ | ------------------------------------------------ |
| Node.js           | 22.12 以上                                                         | `node --version`                                 |
| npm               | Node 22.12 付属のもの（10.x 以上）                                 | `npm --version`                                  |
| Rust toolchain    | stable（1.74 以上推奨）                                            | `rustc --version`                                |
| Cargo             | stable                                                             | `cargo --version`                                |
| Git               | 2.40 以上                                                          | `git --version`                                  |
| MSVC ビルドツール | Visual Studio Build Tools 2022（C++ デスクトップ開発ワークロード） | `cl.exe`（VS Developer Command Prompt 内で確認） |

ネイティブヘルパ（`native/daddy-audio-capture`）は WASAPI loopback 録音のため Windows SDK と MSVC を必須とします。

---

## 3. ビルド手順

### 3.1 ソースの展開

```powershell
# 配布バンドルが C:\release\<version>\ にあるとして
cd C:\release\<version>
Expand-Archive -Path source.zip -DestinationPath C:\build
cd C:\build\whisper-oh-kami-<version>
```

### 3.2 npm 依存のインストール（ルート）

```powershell
npm ci
```

`npm install` ではなく `npm ci` を使ってください。`npm ci` は `package-lock.json` を厳密に再現し、ロックファイルとずれる依存変更を行いません。

### 3.3 ネイティブヘルパのビルド

```powershell
cd native\daddy-audio-capture
$env:RUSTFLAGS = "--remap-path-prefix $env:USERPROFILE=/build --remap-path-prefix $(Resolve-Path ..\..)=/src"
cargo build --release --locked
Remove-Item Env:\RUSTFLAGS
cd ..\..
Copy-Item -LiteralPath native\daddy-audio-capture\target\release\daddy-audio-capture.exe -Destination src\assets\daddyAudioCapture.exe -Force
```

`--locked` フラグは `Cargo.lock` を厳密に使うことを Cargo に強制します。ビルド成果物は `native\daddy-audio-capture\target\release\daddy-audio-capture.exe` に出力されます。

`RUSTFLAGS` の `--remap-path-prefix` は**配布用ビルドでは必須**です。Rust は panic 位置の文字列にソースの絶対パスを埋め込むため、これを省くとビルドしたマシンのホームディレクトリ（＝ユーザー名）がバイナリに残ります（`strip = true` では除去されません）。自分の環境で動かすだけなら省略しても構いませんが、配布物を作る場合は必ず指定し、ビルド後にバイナリを文字列検索してユーザー名が含まれていないことを確認してください。

**最後のコピーは必須です。** Electron Forge の `extraResource` は `src\assets\daddyAudioCapture.exe` を読み込むよう設定されており（`forge.config.js` 参照）、`target\release\` を直接見ているわけではありません。コピーを省くと、リポジトリに同梱されているビルド済みバイナリ（§5 参照）がそのまま再パッケージされ、**自分でビルドしたヘルパが成果物に反映されません**。

このコピーを `npm run make` に自動化していないのは意図的です。ヘルパのビルド済みバイナリを同梱しているおかげで、Rust ツールチェーン（MSVC + Windows SDK）を導入していない環境でも `npm start` / `npm run make` が動きます。自動コピーにすると全員に Rust の導入を強制することになるため、ヘルパを自分でビルドする場合のみ手動で上書きする方式にしています。

### 3.4 THIRD_PARTY_NOTICES.md の再生成（任意）

配布バンドルに同梱の `THIRD_PARTY_NOTICES.md` は、リリース時点で `npm run notices` により生成され、`npm run notices:check` のゲートを通過した状態で凍結されています。再生成して同一バイトであることを確認するには次のコマンドを使います。

```powershell
cargo fetch --locked --manifest-path native/daddy-audio-capture/Cargo.toml
npm run notices:check
git diff -- THIRD_PARTY_NOTICES.md
```

差分が 0 行であればリリース時点と同一です。

通知の再生成は配布対象と同じ Windows x64 の `npm ci` 環境で実施します。インストール済みの optional dependencies も対象になるため、他の OS の依存ツリーでは出力が異なることがあります。Rust のロック済みライセンス原文を読むため、この手順には Cargo が必要です（ヘルパのコンパイルは不要）。`scripts/licenses/` の版固定原文と未解決表示も通知に含まれます。生成コマンドの成功は、未解決項目を含む配布ライセンス監査の合格を意味しません。

### 3.5 Whisper モデルの取得（オフライン文字起こし用、同梱モデル）

```powershell
npm run whisper-models
npm run whisper-models:check
```

`npm run whisper-models` は Xenova/whisper-tiny と Xenova/whisper-small の q8 ONNX 重み一式（合計約 282 MB）を huggingface.co から取得し、`resources/whisper-models/`（`.gitignore` 対象、ソース展開には含まれない）へ配置します。ローカル STT がインストーラに同梱するオフラインモデルなので、次節の `npm run make` を実行する前に必須です。**未実行のまま `npm run make` すると、forge.config.js の `hooks.prePackage` が `npm run whisper-models:check` 相当の検証で失敗し、パッケージングが止まります**（`docs/decisions/whisper-model-selection-2026-09.md` 参照）。

必要なディスク容量の目安: ダウンロード分（約 282 MB）＋展開後のファイル本体（約 282 MB）で、作業ディレクトリに **1 GB 程度の空き**を見込んでください。

オフライン環境（ビルドマシンが huggingface.co に到達できない場合）: ネットワークに接続できる別の PC で同じコマンドを実行し、生成された `resources/whisper-models/` ディレクトリをそのままビルドマシンの同じ相対パスにコピーしてください。`npm run whisper-models:check` は `resources/whisper-models/` の中身を `scripts/whisper-models.manifest.json` と突き合わせて検証するだけで、ネットワークアクセスを行いません。

### 3.6 Electron アプリのパッケージング

```powershell
npm run make
```

Electron Forge が起動し、`out\make\squirrel.windows\x64\` 配下に Squirrel.Windows 形式のインストーラ（`WhisperOhKAMI-<version> Setup.exe`）を生成します。

---

## 4. 配布バンドルとのバイナリ一致

理論上、上記手順で得られたインストーラの SHA-256 は配布バンドル同梱の `installer.exe` の SHA-256（`manifest.json.items[].sha256`）と一致するはずです。実際には次の要因で一致しない場合があります。

| 要因                                                                               | 対策                                                                                                                            |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Node.js / Rust のパッチバージョン違い                                              | 同じパッチバージョンを使ってください                                                                                            |
| ローカルの環境変数（`SOURCE_DATE_EPOCH` 未設定など）                               | 再現ビルド用の環境変数を揃えてください（電子署名なし版では現状未設定）                                                          |
| ネイティブヘルパのビルド時に `RUSTFLAGS` の `--remap-path-prefix` を指定していない | §3.3 のとおり指定してください。指定しないとビルドマシンの絶対パスがバイナリに埋め込まれ、配布物と一致しません                   |
| Electron バージョンのタイミング差（電子署名・タイムスタンプの非決定性）            | `manifest.json.expectedAuthenticodeState` が `unsigned-beta` であることを前提とした上で、署名関連を含まないため通常は一致します |
| 一時ファイルの差（ビルドホストの `tmp` 経路）                                      | Electron Forge の出力は決定的ですが、Squirrel が埋め込む CRC や zip タイムスタンプにより数バイト差が出る場合があります          |

完全な byte-for-byte の再現性は本サービス v1 のスコープでは保証していません。**機能等価性**および**ソース等価性**（`source.zip` の内容が手元の作業ツリーと同一であること）は保証します。

---

## 5. ソースの提供方法と確認範囲

### 5.1 参照するライセンスと提供方法

一次資料は [GNU GPLv3本文](https://www.gnu.org/licenses/gpl-3.0.html)（同内容の `LICENSE` を同梱）です。GNU公式プロジェクトの [Emacs COPYING](https://git.savannah.gnu.org/cgit/emacs.git/plain/COPYING) でも本文を確認できます。

GPLv3 §1は、改変に適した形式のソースと、生成・インストール・実行・改変に必要なソース／制御スクリプトを対応ソースの基準とし、System Libraries等の除外条件を定めています。**外部からlockfileで再取得できることだけを理由に、依存のソースが不要になるわけではありません。** 同じ対応ソースの他の部分から自動再生成できるものの扱いと、外部パッケージのダウンロードは区別してください。

オンライン配布では§6(d)の条件を確認します。バイナリの入手場所で、追加料金なく同等の方法で対応ソースへアクセスできるようにし、別サーバを使う場合もバイナリの近くに明確な取得案内を置き、必要な期間の入手可能性を確保する必要があります。§6(b)は物理製品等に書面によるソース提供の申し出を伴わせる方法、§6(c)はその申し出を受け取った場合の限定的な非商業的再配布の方法です。「初版だから免除」とは説明しません。

現在の製品ソースの案内先は [GitHub Releases](https://github.com/kintaro1221/whisper-oh-kami/releases) の対象タグと公開リポジトリです。候補バンドルでは `source.zip` と `lockfiles.zip` を生成し、`manifest.json.commitSha` と各SHA-256で対象を識別します。**ローカル候補の生成は公開配布経路の提供確認ではありません。** 公開時には、最終バイナリと同じコミットを指す製品ソース、および以下の第三者ソースの提供案内が受領者から取得できることを確認してください。現在提供していない有償配信APIを、取得保証の根拠にはしません。

### 5.2 実際に含まれるもの／含まれないもの

| 区分                        | 候補 `source.zip` の内容と参照先                                                                                                                                                                                                                                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| アプリ本体                  | `src/` のJavaScript・画面・アセット、`forge.config.js`、公開ビルドスクリプト、公開テスト、設定・公開文書。§1.2の除外あり。                                                                                                                                                                                                      |
| 録音ヘルパ                  | `native/daddy-audio-capture/` のRustソース、Cargo.toml／Cargo.lockと、配布用 `src/assets/daddyAudioCapture.exe`。再ビルド手順は§3.3。                                                                                                                                                                                           |
| npm依存                     | package.json／package-lock.jsonを収録。`node_modules/`、各依存の上流ソースアーカイブ一式は未収録。lockfileのversion／resolved／integrityはパッケージ取得の手掛かりです。                                                                                                                                                        |
| Rust依存                    | Cargo.lockを収録。依存crateのソースをvendorしたディレクトリは未収録。lockfileの版・registry・checksumを参照。                                                                                                                                                                                                                   |
| sharp Windowsネイティブ依存 | `scripts/licenses/sharp-win32-x64-0.35.5.json` に29ライブラリの版とライセンス出典を記録。これはライセンスinventoryであり、完全なソース／ビルドスクリプト一式ではありません。上流は [sharp v0.35.5](https://github.com/lovell/sharp/tree/v0.35.5)、[sharp-libvips v1.3.4](https://github.com/lovell/sharp-libvips/tree/v1.3.4)。 |
| Electron・ONNX等            | 版はlockfileに記録。インストーラには実行用バイナリを同梱しますが、これらの上流開発ソース一式はsource.zipに収録していません。ライセンスと出典はTHIRD_PARTY_NOTICESおよびElectronのLICENSES.chromium.htmlを参照。                                                                                                                 |
| Whisperモデル               | 取得スクリプトと `scripts/whisper-models.manifest.json`（取得元・版・SHA-256）を収録。モデルファイルはsource.zipに含めず、Tiny/Smallをインストーラへ別添します。                                                                                                                                                                |
| 通知・ライセンス            | LICENSE、THIRD_PARTY_NOTICES、同梱アセットのライセンス。通知の収録自体は、対応ソース全体の提供確認とは別です。                                                                                                                                                                                                                  |

### 5.3 公開前に残る確認

製品ソースのGit一致・ビルド入力の収録と、第三者を含む対応ソースの完全性は別の確認です。この候補では、特に `@img/sharp-win32-x64` に含まれるLGPL対象のlibvips等について、実際のバイナリに対応する改変用ソース・ビルド手順・パッチ一式を収集／照合し、必要範囲と継続提供方法を確定する確認が残っています。npmパッケージ内の配布コードだけで改変用の元ソースを満たすか、各依存がGPL §1の除外条件に該当するかも一律には判定していません。

上記の上流リンクやlockfileだけで全義務を満たすと断定せず、対象ごとのライセンス条件と実ファイルを確認し、必要なソース・取得案内を補ってから公開してください。これは不足や適法性を一律に断定するものではなく、現在確認できた収録範囲と未解決事項の明示です。

---

## 6. 改変版を配布する場合

GPL-3.0 §5（改変版の配布）に従ってください。要旨は次の通りです（本要旨は法的助言ではなく、`LICENSE` 本文が正本です）。

- 改変日と改変者を明示してください
- 改変版も GPL-3.0 で配布してください
- 対応ソースを併せて提供してください（本ガイドが参考になります）
- 本配布バンドルに含まれない追加コンポーネント（独自ロゴ・独自ブランド名など）を加える場合、それらは本プロジェクトの商標的なご利用ではなく、お客様の責任において管理してください

商標的な紛らわしさを避けるため、改変版を配布する場合は本ソフトと識別可能な名称（例: 「WhisperOhKAMI ベースの XX 版」）を採用していただくようお願いします。これは GPL の要件ではなく、当方からのお願いです。
