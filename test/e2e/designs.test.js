import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { openApp, newDesign, waitForEditor, state, elements, addText, teardown, setup, distFile, mod, openTab, makePng, uploadImages } from './helpers.js';
import { onlineHosts } from '../../src/model/providers.js';

after(teardown);

test('[DOC-01] start a design from a size preset', async () => {
  const { page, context, errors } = await openApp();
  await page.click('[data-testid="preset-story"]');
  await waitForEditor(page);
  const doc = await state(page);
  assert.deepEqual([doc.width, doc.height], [1080, 1920]);
  assert.deepEqual(errors, []);
  await context.close();
});

test('[DOC-02] start a design at a custom size', async () => {
  const { page, context } = await openApp();
  await page.fill('[data-testid="custom-w"]', '1600');
  await page.fill('[data-testid="custom-h"]', '900');
  await page.click('[data-testid="custom-create"]');
  await waitForEditor(page);
  const doc = await state(page);
  assert.deepEqual([doc.width, doc.height], [1600, 900]);
  await context.close();
});

test('[DOC-11] print sizes in millimetres and inches', async () => {
  const { page, context } = await openApp();
  await page.fill('[data-testid="custom-w"]', '148');
  await page.fill('[data-testid="custom-h"]', '210');
  await page.selectOption('[data-testid="custom-unit"]', 'mm');
  await page.click('[data-testid="custom-create"]');
  await waitForEditor(page);
  const doc = await state(page);
  assert.deepEqual([doc.width, doc.height, doc.unit], [1748, 2480, 'mm']);
  assert.equal(await page.textContent('[data-testid="design-size"]'), '148 × 210 mm');
  // The same size reads the same on its card at home and in its versions.
  await page.click('[data-testid="history-btn"]');
  await page.waitForFunction(() => /148 × 210 mm/.test(document.querySelector('[role="dialog"]')?.textContent || ''));
  await page.keyboard.press('Escape');
  await page.click('[data-testid="home-link"]');
  await page.waitForSelector('[data-testid="design-card"]');
  assert.match(await page.textContent('[data-testid="design-card"]'), /148 × 210 mm/);
  // A document of several sheets reads as one sheet's size, in its versions and at home.
  await page.click('[data-testid="preset-doc"]');
  await waitForEditor(page);
  await page.evaluate(async () => {
    const ed = window.paperwall.editor;
    const body = ed.pageData.elements[1];
    ed.update({ text: 'Words that fill the sheet and run on to the next. '.repeat(400) }, null, [body.id]);
    await ed.saveVersion('');
    // One kept without a preview picture: drawn from the version itself.
    await window.paperwall.store.saveVersion(JSON.parse(JSON.stringify(ed.doc)), { label: 'No picture', thumb: null });
  });
  assert.ok(await page.evaluate(() => window.paperwall.editor.doc.height > window.paperwall.editor.doc.document.pageHeight), 'several sheets long');
  await page.click('[data-testid="history-btn"]');
  await page.waitForFunction(() => [...document.querySelectorAll('[role="dialog"] small')].length >= 2);
  const sizes = await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] small')].map((s) => s.textContent.match(/\d+ × \d+ px/)?.[0]).filter(Boolean));
  assert.ok(sizes.length >= 2 && sizes.every((s) => s === '1240 × 1754 px'), `every version: ${sizes}`);
  // Its preview is the first sheet, filling its one-sheet box (not the whole long page squeezed in).
  const drawn = await page.waitForFunction(() => document.querySelector('[data-testid="version"] .version-img svg')?.getAttribute('viewBox'));
  assert.equal(await drawn.jsonValue(), '0 0 1240 1754');
  await page.keyboard.press('Escape');
  await page.click('[data-testid="home-link"]');
  await page.waitForSelector('[data-testid="design-card"]');
  assert.match(await page.textContent('[data-testid="design-card"]'), /1240 × 1754 px/);
  await context.close();
});

test('[DOC-03] [DOC-07] rename a design; it saves automatically', async () => {
  const { page, context } = await newDesign();
  await page.fill('[data-testid="doc-name"]', 'Bake sale poster');
  await page.press('[data-testid="doc-name"]', 'Enter');
  await addText(page);
  await page.waitForTimeout(700);
  await page.click('[data-testid="home-link"]');
  await page.waitForSelector('[data-testid="design-card"]');
  assert.match(await page.textContent('[data-testid="design-card"] .design-name'), /Bake sale poster/);
  // Rename again from the home screen.
  await page.click('[data-testid="design-rename"]');
  await page.fill('[data-testid="rename-input"]', 'Bake sale v2');
  await page.click('[data-testid="rename-save"]');
  await page.waitForFunction(() => document.querySelector('[data-testid="design-card"] .design-name')?.textContent === 'Bake sale v2');
  await context.close();
});

test('[DOC-04] [DOC-05] [DOC-06] home screen lists designs; duplicate and delete', async () => {
  const { page, context } = await newDesign();
  await addText(page);
  await page.waitForTimeout(600);
  await page.click('[data-testid="home-link"]');
  await page.waitForSelector('[data-testid="design-card"]');
  assert.equal(await page.locator('[data-testid="design-card"]').count(), 1);
  await page.click('[data-testid="design-duplicate"]');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="design-card"]').length === 2);
  const names = await page.$$eval('[data-testid="design-card"] .design-name', (els) => els.map((e) => e.textContent));
  assert.ok(names.some((n) => n.endsWith('(copy)')));
  await page.locator('[data-testid="design-delete"]').first().click();
  await page.click('[data-testid="confirm-delete"]');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="design-card"]').length === 1);
  await context.close();
});

test('[DOC-08] reopen a design exactly as you left it after closing the tab', async () => {
  const { page, context, url } = await newDesign();
  const t = await addText(page);
  await openTab(page, 'shapes');
  await page.click('[data-testid="shape-Heart"]');
  await page.waitForTimeout(700);
  const before = await state(page);
  const hash = await page.evaluate(() => location.hash);
  await page.close();
  const again = await context.newPage();
  await again.goto(url + hash);
  await waitForEditor(again);
  const after = await state(again);
  assert.deepEqual(after.pages, before.pages);
  assert.equal(after.pages[0].elements[0].id, t.id);
  await context.close();
});

test('[DOC-07] [DOC-08] pictures are kept apart from the saved design, and come back with it', async () => {
  const { page, context, url } = await newDesign();
  await uploadImages(page, [await makePng(page, { w: 300, h: 200 })]);
  await page.waitForFunction(() => window.paperwall.editor.pageData.elements.some((e) => e.type === 'image'));
  await page.waitForTimeout(800);
  const hash = await page.evaluate(() => location.hash);
  const stored = await page.evaluate(async () => {
    const req = indexedDB.open('paperwall');
    const db = await new Promise((ok) => (req.onsuccess = () => ok(req.result)));
    const all = (store) => new Promise((ok) => (db.transaction(store).objectStore(store).getAll().onsuccess = (e) => ok(e.target.result)));
    const rows = await all('designs');
    const media = await all('media');
    db.close();
    const id = window.paperwall.editor.doc.id;
    const row = rows.find((r) => r.id === id);
    return { inline: JSON.stringify(row.doc).includes('data:image'), files: media.filter((m) => typeof m === 'string' && m.startsWith('data:image')).length };
  });
  assert.equal(stored.inline, false, 'no picture inside the saved design');
  assert.ok(stored.files >= 1, 'the picture is in its own row');
  await page.close();
  const again = await context.newPage();
  await again.goto(url + hash);
  await waitForEditor(again);
  const back = await again.evaluate(() => {
    const ed = window.paperwall.editor;
    const img = ed.pageData.elements.find((e) => e.type === 'image');
    return img && ed.doc.assets[img.assetId]?.dataUrl?.startsWith('data:image/png');
  });
  assert.ok(back, 'the picture comes back');
  await context.close();
});

test('[DOC-09] save a design to a file and open it again', async () => {
  const { page, context } = await newDesign();
  await addText(page);
  const dl = page.waitForEvent('download');
  await page.click('[data-testid="save-file"]');
  const d = await dl;
  assert.match(d.suggestedFilename(), /\.paperwall\.json$/);
  const file = readFileSync(await d.path());
  const saved = JSON.parse(file.toString());
  assert.equal(saved.pages[0].elements[0].type, 'text');

  // Open it in a brand-new browser profile.
  const fresh = await openApp();
  const chooser = fresh.page.waitForEvent('filechooser');
  await fresh.page.click('[data-testid="open-file"]');
  await (await chooser).setFiles({ name: d.suggestedFilename(), mimeType: 'application/json', buffer: file });
  await waitForEditor(fresh.page);
  const opened = await state(fresh.page);
  assert.equal(opened.pages[0].elements[0].text, saved.pages[0].elements[0].text);
  await fresh.context.close();
  await context.close();
});

test('[DOC-10] resize a design to another format', async () => {
  const { page, context } = await newDesign('square');
  await addText(page);
  await page.keyboard.press('Escape');
  await page.click('[data-testid="resize-design"]');
  await page.click('[data-testid="resize-preset-story"]');
  await page.waitForFunction(() => window.paperwall?.editor?.doc.height === 1920);
  const doc = await state(page);
  assert.equal(doc.width, 1080);
  assert.equal(doc.pages[0].elements.length, 1);
  assert.match(doc.name, /Story/);
  // The original square design still exists unchanged, and both have previews.
  await page.click('[data-testid="home-link"]');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="design-card"]').length === 2);
  assert.equal(await page.locator('[data-testid="design-card"] .design-img img').count(), 2, 'every design shows a preview');
  await context.close();
});

test('[APP-04] no account and no sign-in anywhere', async () => {
  const { page, context } = await openApp();
  const homeText = await page.innerText('body');
  await page.click('[data-testid="preset-square"]');
  await waitForEditor(page);
  const editorText = await page.innerText('body');
  for (const text of [homeText, editorText]) assert.ok(!/sign in|log in|sign up|create an account|password/i.test(text));
  assert.equal(await page.locator('input[type="password"], input[type="email"]').count(), 0);
  await context.close();
});

test('[APP-02] one HTML file that works when opened from disk', async () => {
  const { browser } = await setup();
  const html = readFileSync(distFile('paperwall.html'), 'utf8');
  assert.ok(!/<script[^>]+src=/.test(html), 'no external scripts');
  assert.ok(!/<link[^>]+stylesheet/.test(html), 'no external styles');
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(pathToFileURL(distFile('paperwall.html')).href);
  await page.click('[data-testid="preset-square"]');
  await waitForEditor(page);
  await openTab(page, 'text');
  await page.click('[data-testid="add-heading"]');
  assert.equal((await elements(page)).length, 1);
  assert.deepEqual(errors, []);
  await context.close();
});

test('[APP-05] makes no network requests after loading, enforced by the browser', async () => {
  const { browser, baseUrl } = await setup();
  const context = await browser.newContext();
  const page = await context.newPage();
  const requests = [];
  page.on('request', (r) => requests.push(r.url()));
  await page.goto(baseUrl + 'paperwall.html');
  await page.click('[data-testid="template-grand-opening"]');
  await waitForEditor(page);
  await openTab(page, 'graphics');
  await page.click('[data-testid="icon-heart"]');
  const network = requests.filter((u) => u.startsWith('http') && !u.endsWith('/paperwall.html'));
  assert.deepEqual(network, []);
  // And the page's security policy forbids it outright.
  const csp = await page.getAttribute('meta[http-equiv="Content-Security-Policy"]', 'content');
  // (Only the opt-in online extras' providers, each by its exact address.)
  const connect = csp.match(/connect-src ([^;]*)/)[1].trim().split(/\s+/);
  assert.deepEqual(connect.sort(), onlineHosts().sort());
  assert.ok(connect.every((h) => /^https?:\/\/[a-z0-9.-]+(:\d+)?(\/[\w@.\/-]+)?$/.test(h) && !h.includes('*')), 'no wildcards');
  assert.match(csp, /default-src 'none'/);
  const blocked = await page.evaluate(() => fetch('https://example.com/').then(() => 'sent', () => 'blocked'));
  assert.equal(blocked, 'blocked');
  await context.close();
});

test('[APP-01] [APP-06] installable, and works offline after the first visit', async () => {
  const { browser, baseUrl } = await setup();
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(baseUrl);
  // A boot screen is in the page's first bytes and leaves once the app is ready, so nothing sits over the home screen.
  assert.match(readFileSync(distFile('index.html'), 'utf8'), /<div id="boot" role="status">[\s\S]*<div id="app">/);
  await page.waitForSelector('[data-testid="presets"]');
  await page.waitForFunction(() => !document.getElementById('boot'));
  const manifestHref = await page.getAttribute('link[rel="manifest"]', 'href');
  const manifest = JSON.parse(readFileSync(distFile(manifestHref), 'utf8'));
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.icons.some((i) => i.sizes === '512x512'));
  assert.ok(manifest.icons.some((i) => i.sizes === '192x192'));
  // Link previews need absolute URLs: X, Bluesky and chat apps ignore relative ones.
  const og = async (prop) => page.getAttribute(`meta[property="${prop}"]`, 'content');
  assert.equal(await og('og:url'), 'https://manoharys.github.io/paperwall/');
  assert.equal(await og('og:image'), 'https://manoharys.github.io/paperwall/og.png');
  // The service worker takes control and caches the app.
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  // The hosted page is light: fonts live beside it, not inside it...
  const hosted = readFileSync(distFile('index.html'), 'utf8');
  assert.ok(!/data:font\/woff2;base64,[A-Za-z0-9+/]{64}/.test(hosted) && hosted.includes('PAPERWALL_FONTS = "fonts/"'), 'hosted page without embedded fonts');
  // ...and the worker fetches the whole set in the background, so every design works offline later.
  const fontCount = readdirSync(new URL('../../dist/fonts', import.meta.url)).filter((f) => f.endsWith('.woff2')).length;
  await page.waitForFunction(async (n) => (await (await caches.open('paperwall-fonts')).keys()).length >= n, fontCount, { timeout: 60000 });
  await context.setOffline(true);
  await page.reload();
  await page.waitForSelector('[data-testid="presets"]');
  await page.click('[data-testid="template-summer-sale"]');
  await waitForEditor(page);
  await page.waitForFunction(() => [...document.fonts].some((f) => f.family.replace(/"/g, '') === 'Archivo Black' && f.status === 'loaded'));
  await context.close();
});

test('[EDIT-01] undo works across a reload-free session and the button reflects it', async () => {
  const { page, context } = await newDesign();
  assert.equal(await page.isDisabled('[data-testid="undo"]'), true);
  await addText(page);
  assert.equal(await page.isDisabled('[data-testid="undo"]'), false);
  await page.keyboard.press(`${mod}+z`);
  assert.equal((await elements(page)).length, 0);
  await context.close();
});

test('[DOC-12] version history on your device', async () => {
  const { page, context } = await newDesign('square');
  await addText(page);
  await page.evaluate(() => {
    const ed = window.paperwall.editor;
    ed.change(() => (ed.pageData.elements[0].text = 'First draft'));
  });
  await page.click('[data-testid="history-btn"]');
  await page.click('[data-testid="version-save"]');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="version"]').length >= 2);
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    const ed = window.paperwall.editor;
    ed.change(() => (ed.pageData.elements[0].text = 'Second draft'));
  });
  await page.click('[data-testid="history-btn"]');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="version"]').length >= 2);
  // Newest first: the one we saved has "First draft"; the oldest is the blank original.
  const labels = await page.$$eval('[data-testid="version"] small', (els) => els.map((e) => e.textContent));
  assert.match(labels[0], /Saved by you/);
  assert.match(labels.at(-1), /Original/);
  await page.click('[data-testid="version-restore"] >> nth=0');
  await page.waitForSelector('[data-testid="history-dialog"]', { state: 'detached' });
  assert.equal(await state(page, (ed) => ed.pageData.elements[0].text), 'First draft');
  await page.keyboard.press(`${mod}+z`);
  assert.equal(await state(page, (ed) => ed.pageData.elements[0].text), 'Second draft', 'restoring can be undone');
  // Leaving a changed design keeps a version too.
  await page.click('[data-testid="home-link"]');
  await page.waitForSelector('[data-testid="my-designs"] [data-testid="design-card"]');
  const count = await page.evaluate(async () => {
    const req = indexedDB.open('paperwall');
    const db = await new Promise((ok) => (req.onsuccess = () => ok(req.result)));
    return new Promise((ok) => (db.transaction('versions').objectStore('versions').count().onsuccess = (e) => ok(e.target.result)));
  });
  assert.ok(count >= 3, `${count} versions`);
  await context.close();
});
