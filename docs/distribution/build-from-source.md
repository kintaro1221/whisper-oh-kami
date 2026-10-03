# WhisperOhKAMI ソースからのビルド手順

最終更新日: 2026-07-07
対象バージョン: 配布バンドルの `manifest.json.version` に記載のバージョン
対象 OS: Windows 11 x64（macOS / Linux も技術的にはビルド可能ですが、配布のスコープ外です）

このファイルは GitHub Release のタグ（対応ソース）と、有償配布バンドル（`out/paid-release/<version>/build-instructions.md`）の両方に適用されます。本ソフトは GPL-3.0 でライセンスされており、本ファイルは GPL §6 で要求される「対応ソース（Corresponding Source）に容易にアクセスするための指示」の一部です。

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

これらは `npm ci` および `cargo build --locked` に渡すことで、リリース時と同一の依存ツリーを再現できます。

### 1.2 同梱されないもの（ランディングページ・社内運用ドキュメント）

`lp/`（ランディングページの Astro / Cloudflare Pages Functions ソース）は `source.zip` に含まれません。`lp/` は本ソフト（配布される Electron バイナリ）の一部ではなく、運用者が別途ホストする決済・配布用の Web サービスであるため、本ソフトの GPL-3.0 対応ソース（Corresponding Source）の範囲外です。同様に、社内限定の運用手順書・意思決定ログなども対応ソースに含まれません。

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
copy /Y native\daddy-audio-capture\target\release\daddy-audio-capture.exe src\assets\daddyAudioCapture.exe
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

## 5. GPL-3.0 対応ソース（Corresponding Source）の到達手段

GPL-3.0 §6 で要求される「対応ソースの提供」は次の手段で果たしています。

1. **§6(a) - 物理メディア配布**: 本サービスでは行っていません。
2. **§6(b) - 同等の手段による対応ソースの提供義務**: 該当しません（再配布ではなく初版配布のため）。
3. **§6(d) - サーバからのダウンロード**: 配布バンドルに `source.zip` を直接同梱しています。`/api/download` の `source` ArtifactKind 経由でいつでも再取得できます。
4. **§6(c) - 個別の対応ソース申し出**: 申し出は不要です（同梱しているため）。

`source.zip` には次のものが含まれます。

- すべての `*.js` / `*.ts` / `*.rs` ファイル（`src/`、`native/`、`scripts/`、`tests/`）
- ビルドに必要な `package.json` / `Cargo.toml` / `Cargo.lock` / `package-lock.json`（root）
- ライセンス（`LICENSE`）と第三者通知（`THIRD_PARTY_NOTICES.md`）
- 本ガイド（`docs/distribution/build-from-source.md`）と Windows インストールガイド（`docs/distribution/windows-install-guide.md`）、その他 `docs/legal/`・`docs/brand/`・`docs/distribution/` 配下の公開ドキュメント
- リポジトリの設定ファイル（`forge.config.js`、`.prettierrc`、`.github/`（CI 設定）等）
- ビルド済みのネイティブヘルパ `src/assets/daddyAudioCapture.exe`（Rust ツールチェーン無しでもビルドできるようリポジトリに同梱しています。対応するソースは `native/daddy-audio-capture/` にあり、§3.3 の手順で再ビルド・差し替えできます）

`node_modules/` は同梱しません（GPL §6 上、ロックファイルから機械的に再現できる依存は対応ソースに含める必要はありません）。

`lp/`（ランディングページ・決済インフラのソース）および社内限定の運用ドキュメント（`docs/operations/`、`docs/superpowers/`、`docs/decisions/`、`docs/legal/REVIEW-NOTES.md` ほか）は同梱しません。これらは本ソフト（配布される Electron バイナリ）の対応ソースではなく、運用者側のインフラ・内部意思決定記録です（`.gitattributes` の `export-ignore` により `git archive` の時点で除外されます）。

---

## 6. 改変版を配布する場合

GPL-3.0 §5（改変版の配布）に従ってください。要旨は次の通りです（本要旨は法的助言ではなく、`LICENSE` 本文が正本です）。

- 改変日と改変者を明示してください
- 改変版も GPL-3.0 で配布してください
- 対応ソースを併せて提供してください（本ガイドが参考になります）
- 本配布バンドルに含まれない追加コンポーネント（独自ロゴ・独自ブランド名など）を加える場合、それらは本プロジェクトの商標的なご利用ではなく、お客様の責任において管理してください

商標的な紛らわしさを避けるため、改変版を配布する場合は本ソフトと識別可能な名称（例: 「WhisperOhKAMI ベースの XX 版」）を採用していただくようお願いします。これは GPL の要件ではなく、当方からのお願いです。
