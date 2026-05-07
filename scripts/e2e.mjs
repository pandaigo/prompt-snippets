// E2E テスト: Puppeteer で Prompt Snippets の主要画面を自動撮影
//
// 使い方:
//   WSL2 (推奨): wsl -u root -d Ubuntu -- bash -lc 'cd /root/ps && xvfb-run --auto-servernum npm run e2e'
//   Windows: npm run e2e   ← プロファイルロックで失敗するケース多数
import puppeteer from 'puppeteer';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdtempSync, rmSync, mkdirSync, existsSync } from 'fs';
import { tmpdir } from 'os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const userDataDir = mkdtempSync(join(tmpdir(), 'ps-e2e-'));

const screenshotDir = join(root, 'screenshots');
if (existsSync(screenshotDir)) rmSync(screenshotDir, { recursive: true, force: true });
mkdirSync(screenshotDir, { recursive: true });

let shotCount = 0;
async function shot(page, label) {
  shotCount++;
  const num = String(shotCount).padStart(2, '0');
  const safeLabel = label.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  try {
    await page.screenshot({ path: join(screenshotDir, `${num}-${safeLabel}.png`), fullPage: false });
  } catch (_) {}
}

let passed = 0;
let failed = 0;
const failures = [];

function pass(name) { passed++; console.log(`  ✓ ${name}`); }
function fail(name, err) {
  failed++;
  failures.push(`${name}: ${err.message}`);
  console.log(`  ✗ ${name}`);
  console.log(`     ${err.message}`);
}

async function run(name, fn) {
  try { await fn(); pass(name); } catch (e) { fail(name, e); }
}

async function freshPopup(browser, extensionId, options = {}) {
  const page = await browser.newPage();
  // popup の実寸サイズに viewport を合わせる（position:fixed モーダルを popup 領域内に収める）
  await page.setViewport({ width: 380, height: options.height || 600 });
  if (options.dark) await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  page.on('pageerror', err => console.log(`  [POPUP ERROR] ${err.message}`));
  page.on('console', msg => {
    if (msg.type() === 'error') console.log(`  [POPUP CONSOLE error] ${msg.text()}`);
  });
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  if (!options.keepStorage) {
    await page.evaluate(() => new Promise(r => chrome.storage.local.clear(r)));
    await page.reload();
  }
  await page.waitForSelector('#btn-add', { visible: true });
  return page;
}

async function seedFreeAtLimit(page) {
  // Free 上限（5件）まで埋めた状態を作る
  await page.evaluate(() => {
    const now = Date.now();
    return new Promise(r => chrome.storage.local.set({
      snippets: [
        { id: 's1', name: 'Blog Outline', content: 'Write a SEO outline about {topic}', category: 'Writing', createdAt: now, updatedAt: now },
        { id: 's2', name: 'Email Reply', content: 'Rewrite this email more {tone}', category: 'Email', createdAt: now, updatedAt: now },
        { id: 's3', name: 'Code Review', content: 'Review this {language} code', category: 'Coding', createdAt: now, updatedAt: now },
        { id: 's4', name: 'Summarize', content: 'Summarize in 3 bullets', category: 'Writing', createdAt: now, updatedAt: now },
        { id: 's5', name: 'Twitter Thread', content: 'Turn into a {n}-tweet thread', category: 'Writing', createdAt: now, updatedAt: now }
      ],
      isPaid: false
    }, r));
  });
  await page.reload();
  await page.waitForSelector('#snippet-list .snip-card', { visible: true });
}

console.log('\n=== E2E Test ===\n');
console.log('Launching Chromium with extension loaded...');

const isLinux = process.platform === 'linux';
const headless = isLinux || process.env.E2E_HEADLESS === '1';

const browser = await puppeteer.launch({
  headless,
  userDataDir,
  protocolTimeout: 60000,
  args: [
    `--disable-extensions-except=${root}`,
    `--load-extension=${root}`,
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-features=DialogFocusManagement'
  ],
  defaultViewport: { width: 800, height: 700 }
});

let extensionId;
const swTarget = await browser.waitForTarget(t => t.type() === 'service_worker', { timeout: 10000 }).catch(() => null);
if (swTarget) extensionId = swTarget.url().split('/')[2];
else {
  for (const t of browser.targets()) {
    if (t.url().startsWith('chrome-extension://')) {
      extensionId = t.url().split('/')[2];
      break;
    }
  }
}

if (!extensionId) {
  console.error('FAIL: Could not detect extension ID');
  await browser.close();
  process.exit(1);
}
console.log(`Extension ID: ${extensionId}\n`);

// =================== TESTS ===================

await run('popup: 起動して空状態が表示される', async () => {
  const page = await freshPopup(browser, extensionId);
  await shot(page, 'popup-empty');
  const empty = await page.$('.empty-state');
  if (!empty) throw new Error('.empty-state が見つからない');
  await page.close();
});

await run('popup: サンプル4件＋カテゴリピルが表示される', async () => {
  const page = await freshPopup(browser, extensionId);
  // 自動投入が onInstalled で動かなかった場合に備え手動シード
  await page.evaluate(() => {
    const now = Date.now();
    return new Promise(r => chrome.storage.local.set({
      snippets: [
        { id: 's1', name: 'Blog Outline', content: 'Write a SEO outline about {topic} for {audience}', category: 'Writing', createdAt: now, updatedAt: now },
        { id: 's2', name: 'Email Reply', content: 'Rewrite this email more {tone}', category: 'Email', createdAt: now, updatedAt: now },
        { id: 's3', name: 'Code Review', content: 'Review this {language} code for bugs', category: 'Coding', createdAt: now, updatedAt: now },
        { id: 's4', name: 'Summarize', content: 'Summarize in 3 bullets', category: 'Writing', createdAt: now, updatedAt: now }
      ]
    }, r));
  });
  await page.reload();
  await page.waitForSelector('#snippet-list .snip-card', { visible: true });
  await shot(page, 'popup-list');
  const cards = await page.$$('#snippet-list .snip-card');
  if (cards.length !== 4) throw new Error(`expected 4 cards, got ${cards.length}`);
  await page.close();
});

await run('popup: 検索で絞り込みできる（複数件ヒット）', async () => {
  const page = await freshPopup(browser, extensionId);
  await page.evaluate(() => {
    const now = Date.now();
    return new Promise(r => chrome.storage.local.set({
      snippets: [
        { id: 's1', name: 'Blog Outline', content: 'Write a SEO outline about {topic} for {audience}', category: 'Writing', createdAt: now, updatedAt: now },
        { id: 's2', name: 'Email Reply', content: 'Rewrite this email more {tone}', category: 'Email', createdAt: now, updatedAt: now },
        { id: 's3', name: 'Code Review', content: 'Review this {language} code for bugs', category: 'Coding', createdAt: now, updatedAt: now },
        { id: 's4', name: 'Summarize', content: 'Summarize in 3 bullets', category: 'Writing', createdAt: now, updatedAt: now }
      ]
    }, r));
  });
  await page.reload();
  await page.waitForSelector('#snippet-list .snip-card');
  await page.click('#search');
  await page.type('#search', 'write'); // Blog "Write" + Email "Rewrite" の2件ヒット
  await new Promise(r => setTimeout(r, 200));
  await shot(page, 'popup-search');
  const cards = await page.$$('#snippet-list .snip-card');
  if (cards.length < 2) throw new Error(`expected >=2 results, got ${cards.length}`);
  await page.close();
});

await run('popup: ダークモード表示', async () => {
  const page = await freshPopup(browser, extensionId, { dark: true });
  await page.evaluate(() => {
    const now = Date.now();
    return new Promise(r => chrome.storage.local.set({
      snippets: [
        { id: 's1', name: 'Blog Outline', content: 'Write a blog outline about {topic}', category: 'Writing', createdAt: now, updatedAt: now },
        { id: 's2', name: 'Email Reply', content: 'Rewrite this email more professional', category: 'Email', createdAt: now, updatedAt: now },
        { id: 's3', name: 'Code Review', content: 'Review this {language} code for bugs', category: 'Coding', createdAt: now, updatedAt: now }
      ]
    }, r));
  });
  await page.reload();
  await page.waitForSelector('#snippet-list .snip-card');
  await shot(page, 'popup-dark');
  await page.close();
});

await run('popup: 5件埋まると + New で課金モーダル表示', async () => {
  const page = await freshPopup(browser, extensionId);
  await seedFreeAtLimit(page);
  await page.click('#btn-add');
  await page.waitForSelector('#upgrade-modal:not(.hidden)', { visible: true });
  await shot(page, 'upgrade-modal');
  const modalText = await page.evaluate(() => document.querySelector('#upgrade-msg')?.textContent || '');
  if (!modalText.toLowerCase().includes('5')) throw new Error('upgrade modal does not mention free limit');
  await page.close();
});

await run('popup: Pro 状態で無制限表示', async () => {
  const page = await freshPopup(browser, extensionId);
  await page.evaluate(() => new Promise(r => chrome.storage.local.set({
    isPaid: true,
    snippets: [
      { id: 'p1', name: 'Pro Test', content: 'I am pro', category: 'Writing', createdAt: Date.now(), updatedAt: Date.now() }
    ]
  }, r)));
  await page.reload();
  await page.waitForSelector('#snippet-list .snip-card');
  await shot(page, 'popup-pro');
  const quota = await page.evaluate(() => document.querySelector('#quota-info')?.textContent || '');
  if (!quota.toLowerCase().includes('pro')) throw new Error('Pro 表示が出ていない');
  await page.close();
});

await run('options: 既存スニペット一覧＋編集フォーム同時表示', async () => {
  const page = await browser.newPage();
  page.on('pageerror', err => console.log(`  [OPTIONS ERROR] ${err.message}`));
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  // 左ペインの空白問題回避：先にサンプルスニペットを投入してから編集画面を開く
  await page.evaluate(() => {
    const now = Date.now();
    return new Promise(r => chrome.storage.local.set({
      snippets: [
        { id: 's1', name: 'Blog Outline', content: 'Write a SEO outline about {topic}', category: 'Writing', createdAt: now, updatedAt: now },
        { id: 's2', name: 'Email Reply', content: 'Rewrite this email more {tone}', category: 'Email', createdAt: now, updatedAt: now },
        { id: 's3', name: 'Code Review', content: 'Review this {language} code', category: 'Coding', createdAt: now, updatedAt: now }
      ]
    }, r));
  });
  await page.reload();
  await page.waitForSelector('#btn-add');
  // 既存「Blog Outline」を選択して編集モードに
  await page.click('#snippet-list .snip-row');
  await page.waitForSelector('#edit-form:not(.hidden)', { visible: true });
  await shot(page, 'options-edit');
  await page.close();
});

await run('options: スニペット一覧が表示される', async () => {
  const page = await browser.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await page.evaluate(() => {
    const now = Date.now();
    return new Promise(r => chrome.storage.local.set({
      snippets: [
        { id: 's1', name: 'Blog Outline', content: 'Write a SEO outline about {topic} for {audience}', category: 'Writing', createdAt: now, updatedAt: now },
        { id: 's2', name: 'Email Reply', content: 'Rewrite this email more {tone}', category: 'Email', createdAt: now, updatedAt: now },
        { id: 's3', name: 'Code Review', content: 'Review this {language} code', category: 'Coding', createdAt: now, updatedAt: now }
      ]
    }, r));
  });
  await page.reload();
  await page.waitForSelector('#snippet-list .snip-row');
  await page.click('#snippet-list .snip-row');
  await page.waitForSelector('#edit-form:not(.hidden)');
  await shot(page, 'options-list');
  await page.close();
});

// =============================================

await browser.close();
try { rmSync(userDataDir, { recursive: true, force: true }); } catch (_) {}

console.log(`\n=== Result ===`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach(f => console.log(`  - ${f}`));
  process.exit(1);
}
process.exit(0);
