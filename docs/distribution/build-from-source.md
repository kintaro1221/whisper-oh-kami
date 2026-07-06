# WhisperOhKAMI ソースからのビルド手順

最終更新日: 2026-06-30
対象バージョン: 配布バンドルの `manifest.json.version` に記載のバージョン
対象 OS: Windows 11 x64（macOS / Linux も技術的にはビルド可能ですが、招待制先行販売のスコープ外です）

このファイルは購入時にお渡しする配布バンドル（`out/paid-release/<version>/build-instructions.md`）に同梱されます。本ソフトは GPL-3.0 でライセンスされており、本ファイルは GPL §6 で要求される「対応ソース（Corresponding Source）に容易にアクセスするための指示」の一部です。

---

## 1. 対応ソースの構成

配布バンドルには次の 2 つの ZIP が同梱されています。

| ZIP | 内容 | git archive プレフィックス |
|---|---|---|
| `source.zip` | リリース時点での Git 全トラッキングファイル（src、native、docs、設定、3 つのロックファイルすべて） | `whisper-oh-kami-<version>/` |
| `lockfiles.zip` | 3 つのロックファイルだけを抜き出したもの（再現ビルドの参照用） | `lockfiles-<version>/` |

`source.zip` 内のすべてのファイルは、`manifest.json.commitSha` に記録された Git コミット時点の内容と完全に一致します。コミット SHA は `git archive HEAD` で固定したものであり、リリース後に改変されることはありません。

### 1.1 同梱ロックファイル

| パス | 用途 |
|---|---|
| `package-lock.json` | Electron アプリ本体の npm 依存（@google/genai、@huggingface/transformers、electron-squirrel-startup、ollama、ws ほか） |
| `lp/package-lock.json` | ランディングページ（Astro）と Cloudflare Pages Functions の npm 依存 |
| `native/daddy-audio-capture/Cargo.lock` | Rust 製ネイティブヘルパ（WASAPI loopback 録音）の Cargo 依存 |

これらは `npm ci` および `cargo build --locked` に渡すことで、リリース時と同一の依存ツリーを再現できます。

---

## 2. 必要なツール

| ツール | バージョン要件 | 確認方法 |
|---|---|---|
| Node.js | 22.12 以上 | `node --version` |
| npm | Node 22.12 付属のもの（10.x 以上） | `npm --version` |
| Rust toolchain | stable（1.74 以上推奨） | `rustc --version` |
| Cargo | stable | `cargo --version` |
| Git | 2.40 以上 | `git --version` |
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

### 3.3 LP 依存のインストール（任意）

LP（Astro）部分は、配布物の購入後の運用では再ビルド不要です。LP を自前でプレビューする場合のみインストールしてください。

```powershell
cd lp
npm ci
cd ..
```

### 3.4 ネイティブヘルパのビルド

```powershell
cd native\daddy-audio-capture
cargo build --release --locked
cd ..\..
```

`--locked` フラグは `Cargo.lock` を厳密に使うことを Cargo に強制します。ビルド成果物は `native\daddy-audio-capture\target\release\daddy_audio_capture.exe`（または .dll）に出力されます。

Electron Forge の `extraResource` 設定がこれを `resources\` に取り込みますので、ビルド前にこの場所に配置されている必要があります（リポジトリの `forge.config.js` を参照してください）。

### 3.5 THIRD_PARTY_NOTICES.md の再生成（任意）

配布バンドルに同梱の `THIRD_PARTY_NOTICES.md` は、リリース時点で `npm run notices` により生成され、`npm run notices:check` のゲートを通過した状態で凍結されています。再生成して同一バイトであることを確認するには次のコマンドを使います。

```powershell
npm run notices
git diff -- THIRD_PARTY_NOTICES.md
```

差分が 0 行であればリリース時点と同一です。

### 3.6 Electron アプリのパッケージング

```powershell
npm run make
```

Electron Forge が起動し、`out\make\squirrel.windows\x64\` 配下に Squirrel.Windows 形式のインストーラ（`WhisperOhKAMI-<version> Setup.exe`）を生成します。

---

## 4. 配布バンドルとのバイナリ一致

理論上、上記手順で得られたインストーラの SHA-256 は配布バンドル同梱の `installer.exe` の SHA-256（`manifest.json.items[].sha256`）と一致するはずです。実際には次の要因で一致しない場合があります。

| 要因 | 対策 |
|---|---|
| Node.js / Rust のパッチバージョン違い | 同じパッチバージョンを使ってください |
| ローカルの環境変数（`SOURCE_DATE_EPOCH` 未設定など） | 再現ビルド用の環境変数を揃えてください（電子署名なし版では現状未設定） |
| Electron バージョンのタイミング差（電子署名・タイムスタンプの非決定性） | `manifest.json.expectedAuthenticodeState` が `unsigned-beta` であることを前提とした上で、署名関連を含まないため通常は一致します |
| 一時ファイルの差（ビルドホストの `tmp` 経路） | Electron Forge の出力は決定的ですが、Squirrel が埋め込む CRC や zip タイムスタンプにより数バイト差が出る場合があります |

完全な byte-for-byte の再現性は本サービス v1 のスコープでは保証していません。**機能等価性**および**ソース等価性**（`source.zip` の内容が手元の作業ツリーと同一であること）は保証します。

---

## 5. GPL-3.0 対応ソース（Corresponding Source）の到達手段

GPL-3.0 §6 で要求される「対応ソースの提供」は次の手段で果たしています。

1. **§6(a) - 物理メディア配布**: 本サービスでは行っていません。
2. **§6(b) - 同等の手段による対応ソースの提供義務**: 該当しません（再配布ではなく初版配布のため）。
3. **§6(d) - サーバからのダウンロード**: 配布バンドルに `source.zip` を直接同梱しています。`/api/download` の `source` ArtifactKind 経由でいつでも再取得できます。
4. **§6(c) - 個別の対応ソース申し出**: 申し出は不要です（同梱しているため）。

`source.zip` には次のものが含まれます。

- すべての `*.js` / `*.ts` / `*.astro` / `*.rs` ファイル
- ビルドに必要な `package.json` / `Cargo.toml` / `Cargo.lock` / `package-lock.json`（root と `lp/`）
- ライセンス（`LICENSE`）と第三者通知（`THIRD_PARTY_NOTICES.md`）
- 本ガイド（`docs/distribution/build-from-source.md`）と Windows インストールガイド（`docs/distribution/windows-install-guide.md`）
- リポジトリの設定ファイル（`forge.config.js`、`.prettierrc` 等）

`node_modules/` は同梱しません（GPL §6 上、ロックファイルから機械的に再現できる依存は対応ソースに含める必要はありません）。

---

## 6. 改変版を配布する場合

GPL-3.0 §5（改変版の配布）に従ってください。要旨は次の通りです（本要旨は法的助言ではなく、`LICENSE` 本文が正本です）。

- 改変日と改変者を明示してください
- 改変版も GPL-3.0 で配布してください
- 対応ソースを併せて提供してください（本ガイドが参考になります）
- 本配布バンドルに含まれない追加コンポーネント（独自ロゴ・独自ブランド名など）を加える場合、それらは本プロジェクトの商標的なご利用ではなく、お客様の責任において管理してください

商標的な紛らわしさを避けるため、改変版を配布する場合は本ソフトと識別可能な名称（例: 「WhisperOhKAMI ベースの XX 版」）を採用していただくようお願いします。これは GPL の要件ではなく、当方からのお願いです。
