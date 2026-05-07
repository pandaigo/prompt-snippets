import sharp from 'sharp';
import { mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'icons');
mkdirSync(outDir, { recursive: true });

// プロンプトテンプレートを表す { } 記号 + 中央のカーソル線（テキスト入力示唆）
// アクセント赤線でアイコン認識性向上（CTR）
const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#4A90D9"/>
      <stop offset="100%" style="stop-color:#2563EB"/>
    </linearGradient>
  </defs>
  <rect x="4" y="4" width="120" height="120" rx="26" fill="url(#bg)"/>
  <!-- { } 記号（白） -->
  <text x="36" y="92" text-anchor="middle" font-family="ui-monospace, Menlo, Consolas, monospace" font-size="80" font-weight="700" fill="white">{</text>
  <text x="92" y="92" text-anchor="middle" font-family="ui-monospace, Menlo, Consolas, monospace" font-size="80" font-weight="700" fill="white">}</text>
  <!-- 中央のカーソル線（赤・プロンプト入力カーソルを示唆、CTR向上） -->
  <rect x="61" y="40" width="6" height="48" rx="2" fill="#EF4444"/>
</svg>`;

for (const size of [16, 48, 128]) {
  await sharp(Buffer.from(svg))
    .resize(size, size)
    .png()
    .toFile(join(outDir, `icon${size}.png`));
  console.log(`Generated icon${size}.png`);
}
