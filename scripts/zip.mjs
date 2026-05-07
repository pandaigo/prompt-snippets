import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { existsSync, unlinkSync, mkdirSync, copyFileSync } from 'fs';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const name = 'prompt-snippets';
const outZip = join(root, `${name}.zip`);
const tmp = join(root, '_zip_tmp');

if (existsSync(outZip)) unlinkSync(outZip);

const include = [
  'manifest.json',
  'background.js',
  'ExtPay.js',
  'popup.html',
  'popup.css',
  'popup.js',
  'icons/icon16.png',
  'icons/icon48.png',
  'icons/icon128.png'
];

// オプショナル: 存在すれば自動で同梱（options 編集ページ、welcome オンボーディング、CSV ユーティリティ等）
const optional = [
  'options.html',
  'options.css',
  'options.js',
  'welcome.html',
  'welcome.js',
  'lib/csv-utils.js'
];
for (const file of optional) {
  if (existsSync(join(root, file))) include.push(file);
}

if (existsSync(tmp)) execSync(`cmd /c "rmdir /s /q ${tmp}"`, { stdio: 'ignore' });

for (const file of include) {
  const src = join(root, file);
  const dest = join(tmp, file);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
}

execSync(
  `powershell -Command "Compress-Archive -Path '${join(tmp, '*')}' -DestinationPath '${outZip}' -Force"`,
  { stdio: 'inherit' }
);

execSync(`cmd /c "rmdir /s /q ${tmp}"`, { stdio: 'ignore' });

console.log(`\nCreated: ${outZip}`);
