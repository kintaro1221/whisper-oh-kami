#!/usr/bin/env node
//
// lp-crop-screenshots.mjs — generate close-up crop cards for the LP
// screenshot carousel (lp/src/pages/index.astro).
//
// Why: the carousel previously overlaid numbered anchor dots + gutter
// labels + SVG leader lines directly on each screenshot to point out key
// UI regions. That was rejected twice by product review as "cluttered"
// (「余計見づらくなった」). The replacement format is close-up crop cards:
// small cropped enlargements of the same key regions, rendered as clean
// cards below the full (now unmarked) screenshot.
//
// This script is the single source of truth for the crop rectangles.
// Coordinates are pixel rects on the *source* screenshots
// (lp/public/app-*.png, all 2200x1600) and were chosen by visual
// inspection — see the crop map below for what each one shows.
//
// Run:  node scripts/lp-crop-screenshots.mjs   (from repo root; sharp is a
//       root devDependency, not an lp/ dependency)
// Output: lp/public/crops/app-<shot>-crop-<n>.png, resized to 900px wide.

import sharp from 'sharp';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(REPO_ROOT, 'lp', 'public');
const OUT_DIR = path.join(REPO_ROOT, 'lp', 'public', 'crops');

// Output width in px. Source screenshots are 2200x1600; crops are narrow
// regions of that, so 900px keeps them crisp at the card sizes the LP
// renders them at (desktop row of 2-3, ~350-420px each).
const OUTPUT_WIDTH = 900;

// left/top/width/height are pixel rects on the 2200x1600 source PNG.
// `id` becomes the crop-N suffix in the output filename and must match
// the `crops` array in lp/src/pages/index.astro for each shot.
const CROP_MAP = [
  {
    source: 'app-hero-whisper.png',
    crops: [
      // 5要素の進捗行: "ヒアリング進捗 3/5" + 課題/KPI/決裁/予算/期限 pill row,
      // top-left of the app window.
      { id: 1, left: 0, top: 50, width: 1050, height: 130 },
      // ささやきヒントのテキストブロック: the AI's suggested next question,
      // bottom-left transcript panel.
      { id: 2, left: 0, top: 830, width: 1300, height: 180 },
      // Listening ステータス: "CLOUD / Listening... / elapsed time" chip,
      // top-right of the app window.
      { id: 3, left: 1650, top: 0, width: 550, height: 70 },
    ],
  },
  {
    source: 'app-evidence-panel.png',
    crops: [
      // 引用つきの根拠表示: "課題 確認済み" card with the quoted customer
      // utterance and its keyword-detection provenance line.
      { id: 1, left: 0, top: 165, width: 1500, height: 155 },
      // 不足している5要素パネル: right-rail card listing still-missing
      // hearing elements (予算 / 期限 in this shot).
      { id: 2, left: 1650, top: 470, width: 550, height: 130 },
    ],
  },
  {
    source: 'app-home-mode-select.png',
    crops: [
      // モード選択カード群: the three start-mode cards (お試し / 自前キー /
      // ローカルAI) with the "選択中" badge on the active one.
      { id: 1, left: 850, top: 1080, width: 1100, height: 280 },
      // セッション開始ボタン: the primary "セッションを開始" CTA button.
      { id: 2, left: 900, top: 690, width: 700, height: 100 },
    ],
  },
];

function outputName(source, cropId) {
  const stem = source.replace(/\.png$/, '');
  return `${stem}-crop-${cropId}.png`;
}

async function main() {
  const { mkdir } = await import('node:fs/promises');
  await mkdir(OUT_DIR, { recursive: true });

  for (const shot of CROP_MAP) {
    const srcPath = path.join(SRC_DIR, shot.source);
    for (const crop of shot.crops) {
      const outName = outputName(shot.source, crop.id);
      const outPath = path.join(OUT_DIR, outName);
      await sharp(srcPath)
        .extract({ left: crop.left, top: crop.top, width: crop.width, height: crop.height })
        .resize({ width: OUTPUT_WIDTH })
        .png({ quality: 90 })
        .toFile(outPath);
      console.log(`wrote lp/public/crops/${outName}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
