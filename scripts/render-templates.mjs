// Renders every template with the real fonts into PNGs and one contact
// sheet, for checking them by eye. Needs the dev server (npm run dev).
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';

const url = process.env.URL || 'http://127.0.0.1:5173/';
const out = process.argv[2] || 'test-results/templates';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto(url);
await page.waitForSelector('[data-testid="home-templates"] .tpl');
const ids = await page.$$eval('[data-testid="home-templates"] .tpl', (els) => els.map((e) => e.dataset.testid.replace('template-', '')));
const cells = [];
for (const id of ids) {
  await page.goto(url);
  await page.click(`[data-testid="template-${id}"]`);
  await page.waitForFunction(() => window.paperwall?.editor);
  await page.waitForTimeout(150);
  const data = await page.evaluate(async () => {
    const { editor, export: ex } = window.paperwall;
    const doc = editor.doc;
    const blob = await ex.exportImage(doc, 0, { format: 'png', scale: 600 / Math.max(doc.width, doc.height) });
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (const b of buf) s += String.fromCharCode(b);
    return btoa(s);
  });
  writeFileSync(`${out}/${id}.png`, Buffer.from(data, 'base64'));
  cells.push(id);
  console.log('rendered', id);
}
await browser.close();
writeFileSync(`${out}/index.json`, JSON.stringify(cells));
