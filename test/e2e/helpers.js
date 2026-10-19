// Shared setup for the end-to-end tests: build once, serve dist/, drive
// Chromium through the real interface.

import { chromium } from 'playwright';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { build } from '../../scripts/build.mjs';
import { startServer } from '../../scripts/serve.mjs';

const root = new URL('../..', import.meta.url).pathname;
let server = null;
let browser = null;
let baseUrl = null;

function needsBuild() {
  const out = join(root, 'dist/index.html');
  return !existsSync(out) || process.env.PLACARD_FORCE_BUILD === '1';
}

export async function setup() {
  if (!browser) {
    if (needsBuild()) build();
    server = await startServer({ dir: 'dist', listenPort: 0 });
    baseUrl = `http://127.0.0.1:${server.address().port}/`;
    browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  }
  return { browser, baseUrl };
}

export async function teardown() {
  await browser?.close();
  await new Promise((ok) => (server ? server.close(ok) : ok()));
  browser = null;
  server = null;
}

export function distFile(name) {
  const p = join(root, 'dist', name);
  if (!existsSync(p) || !statSync(p).size) throw new Error(`Missing ${name}`);
  return p;
}

/** A fresh browser profile (empty storage) with the app open on the home screen. */
export async function openApp(opts = {}) {
  const { browser: b, baseUrl: url } = await setup();
  const context = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, ...opts });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(url);
  await page.waitForSelector('[data-testid="presets"]');
  return { page, context, errors, url };
}

/** Open the app and start a design from a preset. */
export async function newDesign(presetId = 'square', opts) {
  const app = await openApp(opts);
  await app.page.click(`[data-testid="preset-${presetId}"]`);
  await waitForEditor(app.page);
  return app;
}

export async function waitForEditor(page) {
  await page.waitForFunction(() => window.placard?.editor);
  await page.waitForSelector('[data-testid="page"] svg');
}

/** Read editor state in the page. */
export function state(page, fn = (ed) => ed.doc, arg) {
  return page.evaluate(([src, a]) => {
    const f = new Function('ed', 'arg', `return (${src})(ed, arg)`);
    return JSON.parse(JSON.stringify(f(window.placard.editor, a)));
  }, [fn.toString(), arg]);
}

export async function elements(page) {
  return state(page, (ed) => ed.doc.pages[ed.page].elements);
}

export async function selection(page) {
  return state(page, (ed) => ed.selection);
}

/** Center of an element on screen (page coordinates -> client coordinates). */
export async function screenPoint(page, x, y) {
  return page.evaluate(([px, py]) => {
    const r = document.querySelector('[data-testid="page"]').getBoundingClientRect();
    const z = window.placard.editor.zoom;
    return { x: r.left + px * z, y: r.top + py * z };
  }, [x, y]);
}

export async function elementCenter(page, id) {
  const el = (await elements(page)).find((e) => e.id === id);
  return screenPoint(page, el.x + el.w / 2, el.y + el.h / 2);
}

export async function clickElement(page, id, modifiers) {
  const p = await elementCenter(page, id);
  await page.mouse.click(p.x, p.y, { modifiers });
}

export async function drag(page, from, to, { steps = 8, modifiers = [] } = {}) {
  for (const m of modifiers) await page.keyboard.down(m);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps });
  await page.mouse.up();
  for (const m of modifiers) await page.keyboard.up(m);
}

/** Screen position of a selection handle (n, se, rotate, ...). */
export async function handle(page, name) {
  const box = await page.locator(`.overlay [data-handle="${name}"]`).boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export async function addText(page, style = 'heading') {
  await page.click('[data-testid="rail-text"]');
  await page.click(`[data-testid="add-${style}"]`);
  return (await elements(page)).at(-1);
}

export async function addShape(page, label = 'Square') {
  await page.click('[data-testid="rail-shapes"]');
  await page.click(`[data-testid="shape-${label}"]`);
  return (await elements(page)).at(-1);
}

export const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

/** A small PNG made in the page, as a file Playwright can upload. */
export async function makePng(page, { w = 400, h = 300, color = '#3a86ff', name = 'photo.png' } = {}) {
  const b64 = await page.evaluate(([W, H, c]) => {
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const g = cv.getContext('2d');
    g.fillStyle = c;
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#ffffff';
    g.fillRect(W / 4, H / 4, W / 2, H / 2);
    return cv.toDataURL('image/png').split(',')[1];
  }, [w, h, color]);
  return { name, mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') };
}

/** Upload images through the Uploads panel. */
export async function uploadImages(page, files) {
  await page.click('[data-testid="rail-uploads"]');
  const chooser = page.waitForEvent('filechooser');
  await page.click('[data-testid="upload-btn"]');
  await (await chooser).setFiles(files);
  await page.waitForFunction((n) => window.placard.editor.pageData.elements.filter((e) => e.type === 'image').length >= n, files.length);
}

/** Click Download in the export dialog and return the saved file's bytes and name. */
export async function downloadVia(page, setup) {
  await page.click('[data-testid="download"]');
  await page.waitForSelector('[data-testid="export-dialog"]');
  if (setup) await setup();
  const dl = page.waitForEvent('download');
  await page.click('[data-testid="export-download"]');
  const d = await dl;
  const path = await d.path();
  const { readFileSync } = await import('node:fs');
  return { name: d.suggestedFilename(), bytes: readFileSync(path) };
}

export function pngSize(bytes) {
  if (bytes.readUInt32BE(0) !== 0x89504e47) throw new Error('Not a PNG');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), colorType: bytes[25] };
}

export function jpgSize(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('Not a JPEG');
  let i = 2;
  while (i < bytes.length) {
    if (bytes[i] !== 0xff) throw new Error('Bad JPEG');
    const marker = bytes[i + 1];
    const len = bytes.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xc2) return { height: bytes.readUInt16BE(i + 5), width: bytes.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  throw new Error('No JPEG size found');
}

/** Pixel color of an exported image at (x, y), decoded in the browser. */
export async function pixelAt(page, bytes, mime, x, y) {
  return page.evaluate(async ([b64, type, px, py]) => {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const bmp = await createImageBitmap(new Blob([arr], { type }));
    const cv = document.createElement('canvas');
    cv.width = bmp.width;
    cv.height = bmp.height;
    const g = cv.getContext('2d');
    g.drawImage(bmp, 0, 0);
    return Array.from(g.getImageData(px, py, 1, 1).data);
  }, [bytes.toString('base64'), mime, x, y]);
}
