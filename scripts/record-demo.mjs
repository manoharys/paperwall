// Records the demo video by driving the real built app in Chromium, then
// makes an MP4 and a GIF with ffmpeg. Run: npm run build && node scripts/record-demo.mjs
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { startServer } from './serve.mjs';

const root = new URL('..', import.meta.url).pathname;
const out = join(root, 'docs/assets');
const tmp = join(root, 'test-results/video');
rmSync(tmp, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
mkdirSync(tmp, { recursive: true });

const server = await startServer({ dir: 'dist', listenPort: 0 });
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const size = { width: 1280, height: 800 };
const context = await browser.newContext({ viewport: size, recordVideo: { dir: tmp, size } });
const page = await context.newPage();
const pause = (ms) => page.waitForTimeout(ms);

async function caption(text) {
  await page.evaluate((t) => {
    let el = document.getElementById('demo-caption');
    if (!el) {
      el = document.createElement('div');
      el.id = 'demo-caption';
      el.style.cssText = 'position:fixed;left:50%;bottom:92px;transform:translateX(-50%);z-index:99;background:#16161d;color:#fff;font:600 22px Inter,sans-serif;padding:12px 22px;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.3);pointer-events:none;transition:opacity .25s';
      document.body.append(el);
    }
    el.textContent = t;
    el.style.opacity = t ? '1' : '0';
  }, text);
}

async function moveTo(selector) {
  const box = await page.locator(selector).first().boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 12 });
  return box;
}

async function click(selector, wait = 350) {
  await moveTo(selector);
  await page.click(selector);
  await pause(wait);
}

async function pagePoint(x, y) {
  return page.evaluate(([px, py]) => {
    const r = document.querySelector('[data-testid="page"]').getBoundingClientRect();
    const z = window.paperwall.editor.zoom;
    return { x: r.left + px * z, y: r.top + py * z };
  }, [x, y]);
}

await page.goto(url);
await page.waitForSelector('[data-testid="presets"]');
await caption('A free design tool that runs on your device');
await pause(1800);
await page.mouse.wheel(0, 650);
await pause(600);
await caption('Original templates, free for any use');
await click('[data-testid="template-summer-sale"]', 1200);
await page.waitForFunction(() => window.paperwall?.editor);

await caption('Double-click to edit text');
const sale = await page.evaluate(() => window.paperwall.editor.pageData.elements.find((e) => e.text === 'SUMMER'));
const p = await pagePoint(sale.x + 200, sale.y + 70);
await page.mouse.move(p.x, p.y, { steps: 12 });
await page.mouse.dblclick(p.x, p.y);
await pause(300);
await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
await page.keyboard.type('WINTER', { delay: 90 });
await page.keyboard.press('Escape');
await pause(500);

await caption('Change colors in a click');
const empty = await pagePoint(900, 1850);
await page.mouse.move(empty.x, empty.y, { steps: 10 });
await page.mouse.click(empty.x, empty.y);
await pause(300);
await click('[data-testid="bg-type"] [data-value="gradient"]', 400);
await click('[data-testid="bg-gradient"] [data-testid="grad-preset-Night"]', 700);

await caption('Icons and stickers, drawn for Paperwall');
await click('[data-testid="rail-graphics"]', 300);
await click('[data-testid="sticker-sparkles"]', 500);
await page.evaluate(() => {
  const ed = window.paperwall.editor;
  ed.update({ x: 120, y: 260, w: 220, h: 220 });
});
await pause(600);

await caption('Resize to any format, free');
await page.keyboard.press('Escape');
await click('[data-testid="resize-design"]', 500);
await click('[data-testid="resize-preset-square"]', 1400);

await caption('Transparent PNG, PDF, SVG. No watermark.');
await click('[data-testid="download"]', 500);
await click('[data-testid="export-transparent"]', 300);
await click('[data-testid="export-scale"] [data-value="2"]', 500);
const dl = page.waitForEvent('download');
await click('[data-testid="export-download"]', 200);
await dl;
await pause(900);

await caption('No account. No upload. Works offline. Open source.');
await pause(2400);
await caption('');
await context.close();
await browser.close();
server.close();

const [video] = readdirSync(tmp).filter((f) => f.endsWith('.webm'));
renameSync(join(tmp, video), join(tmp, 'demo.webm'));
const ff = (args) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args]);
ff(['-i', join(tmp, 'demo.webm'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '24', '-movflags', '+faststart', join(out, 'demo.mp4')]);
ff(['-i', join(tmp, 'demo.webm'), '-vf', 'fps=10,scale=800:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=4', join(out, 'demo.gif')]);
console.log('wrote docs/assets/demo.mp4 and docs/assets/demo.gif');
