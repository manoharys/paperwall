// Renders README and social images from the real app: the editor
// screenshot, the share card (from docs/scoreboard.svg) and og.png.
import { chromium } from 'playwright';
import { readFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { startServer } from './serve.mjs';

const root = new URL('..', import.meta.url).pathname;
const assets = join(root, 'docs/assets');
mkdirSync(assets, { recursive: true });
const server = await startServer({ dir: 'dist', listenPort: 0 });
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});

// Editor screenshot.
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await page.goto(url);
await page.click('[data-testid="template-grand-opening"]');
await page.waitForFunction(() => window.paperwall?.editor);
await page.waitForTimeout(400);
const id = await page.evaluate(() => window.paperwall.editor.pageData.elements.find((e) => /GRAND/.test(e.text || '')).id);
await page.evaluate((i) => window.paperwall.editor.select([i]), id);
await page.waitForTimeout(300);
await page.screenshot({ path: join(assets, 'editor.png') });

// Share card from the generated scoreboard SVG (fonts come from the app's own files).
const svg = readFileSync(join(root, 'docs/scoreboard.svg'), 'utf8');
const card = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await card.goto(url);
await card.evaluate((s) => {
  document.body.innerHTML = s;
  document.body.style.margin = '0';
}, svg);
await card.waitForTimeout(300);
await card.screenshot({ path: join(assets, 'share-card.png') });
copyFileSync(join(assets, 'share-card.png'), join(root, 'assets/icons/og.png'));
await browser.close();
server.close();
console.log('wrote docs/assets/editor.png, docs/assets/share-card.png, assets/icons/og.png');
