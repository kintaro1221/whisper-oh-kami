# Brand assets

WhisperOhKAMI の δ-B「聞き取る耳 + 3 dots 余韻」ロゴマーク。README / LP / ストア素材への埋め込み用。すべて透過背景。

| ファイル | 用途 |
| --- | --- |
| `logo-mark-light.svg` / `.png` | ライト背景用（navy `#1a1f2e`）。SVG が primary、PNG は 512px ラスタ fallback |
| `logo-mark-dark.svg` / `.png` | ダーク背景用（white `#ffffff`） |

テーマ追従の埋め込みは `<picture>` + `prefers-color-scheme` で:

```html
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/brand/logo-mark-dark.svg" />
  <img src="docs/brand/logo-mark-light.svg" alt="WhisperOhKAMI" width="84" />
</picture>
```

## 再生成

ジオメトリの単一ソースは [`src/assets/brand-mark-spec.mjs`](../../src/assets/brand-mark-spec.mjs)。spec を変えたら:

```
npm run build:logos
```

で 4 ファイルを再生成する（アプリアイコン logo.{png,ico,icns} は `npm run build:icons` で別管理）。
