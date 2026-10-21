import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newDesign, openApp, waitForEditor, state, addText, addShape, teardown, downloadVia, pngSize, jpgSize, pixelAt, openTab } from './helpers.js';
import { TEMPLATES, TEMPLATE_CATEGORIES, templateDoc, searchTemplates } from '../../src/templates/index.js';
import { FONTS } from '../../src/model/fonts.js';
import { iconById, stickerById } from '../../src/model/graphics.js';

after(teardown);

function hasPdftoppm() {
  try {
    execFileSync('pdftoppm', ['-v'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function twoPages() {
  const app = await newDesign('square');
  await addText(app.page);
  await app.page.click('[data-testid="strip-add-page"]');
  await addShape(app.page, 'Circle');
  return app;
}

test('[EXP-01] download as PNG, with the real fonts in the picture', async () => {
  const { page, context } = await newDesign('square');
  await addText(page);
  const { name, bytes } = await downloadVia(page);
  assert.equal(name, 'Untitled design.png');
  const size = pngSize(bytes);
  assert.deepEqual([size.width, size.height], [1080, 1080]);
  // Same text in two fonts must come out different: fonts are embedded, not substituted.
  const shot = (font) => page.evaluate(async (f) => {
    const { editor, export: ex } = window.paperwall;
    const doc = structuredClone(editor.doc);
    doc.pages[0].elements[0].font = f;
    const blob = await ex.exportImage(doc, 0, { scale: 0.25 });
    const bmp = await createImageBitmap(blob);
    const cv = document.createElement('canvas');
    cv.width = bmp.width;
    cv.height = bmp.height;
    cv.getContext('2d').drawImage(bmp, 0, 0);
    return Array.from(cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data);
  }, font);
  const a = await shot('Pacifico');
  const b = await shot('Inter');
  let diff = 0;
  for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) > 40) diff++;
  assert.ok(diff > 300, `fonts render differently (${diff} pixels differ)`);
  await context.close();
});

test('[EXP-02] PNG at 2x and 3x size', async () => {
  const { page, context } = await newDesign('thumbnail');
  for (const s of [2, 3]) {
    const { bytes } = await downloadVia(page, () => page.click(`[data-testid="export-scale"] [data-value="${s}"]`));
    const size = pngSize(bytes);
    assert.deepEqual([size.width, size.height], [1280 * s, 720 * s]);
  }
  await context.close();
});

test('[EXP-03] PNG with a transparent background', async () => {
  const { page, context } = await newDesign('square');
  await addShape(page, 'Circle');
  const solid = await downloadVia(page);
  assert.equal((await pixelAt(page, solid.bytes, 'image/png', 2, 2))[3], 255);
  const clear = await downloadVia(page, () => page.click('[data-testid="export-transparent"]'));
  assert.equal(pngSize(clear.bytes).colorType, 6, 'RGBA');
  assert.equal((await pixelAt(page, clear.bytes, 'image/png', 2, 2))[3], 0, 'corner is see-through');
  assert.equal((await pixelAt(page, clear.bytes, 'image/png', 540, 540))[3], 255, 'the circle is solid');
  await context.close();
});

test('[EXP-04] download as JPG with a quality setting', async () => {
  const { page, context } = await newDesign('square');
  await openTab(page, 'templates');
  await page.click('[data-testid="template-grand-opening"]');
  const pick = (q) => async () => {
    await page.click('[data-testid="export-format"] [data-value="jpg"]');
    const input = page.locator('[data-testid="export-quality"] + input');
    await input.fill(String(q));
    await input.press('Enter');
  };
  const low = await downloadVia(page, pick(40));
  const high = await downloadVia(page, pick(100));
  assert.match(low.name, /\.jpg$/);
  assert.deepEqual(jpgSize(high.bytes), { width: 1080, height: 1080 });
  assert.ok(low.bytes.length < high.bytes.length, `${low.bytes.length} < ${high.bytes.length}`);
  await context.close();
});

test('[EXP-05] [EXP-10] download as SVG, with the fonts inside', async () => {
  const { page, context } = await newDesign('square');
  await addText(page);
  const { name, bytes } = await downloadVia(page, () => page.click('[data-testid="export-format"] [data-value="svg"]'));
  const svg = bytes.toString();
  assert.match(name, /\.svg$/);
  assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
  assert.match(svg, /@font-face\{font-family:"Inter";font-weight:700;src:url\(data:font\/woff2;base64,/);
  assert.ok(svg.includes('Add a heading'));
  await context.close();
});

test('[EXP-06] download as PDF with all pages', async () => {
  const { page, context } = await twoPages();
  const { name, bytes } = await downloadVia(page, () => page.click('[data-testid="export-format"] [data-value="pdf"]'));
  const text = bytes.toString('latin1');
  assert.match(name, /\.pdf$/);
  assert.match(text, /^%PDF-1\.7/, 'the vector PDF, by default');
  assert.match(text, /\/Count 2/);
  if (hasPdftoppm()) {
    const dir = mkdtempSync(join(tmpdir(), 'paperwall-pdf-'));
    writeFileSync(join(dir, 'a.pdf'), bytes);
    execFileSync('pdftoppm', ['-r', '24', '-png', join(dir, 'a.pdf'), join(dir, 'p')]);
    const first = pngSize(readFileSync(join(dir, 'p-1.png')));
    assert.ok(Math.abs(first.width - first.height) <= 1, 'square page renders');
  }
  await context.close();
});

test('[EXP-07] download only the pages you pick', async () => {
  const { page, context } = await twoPages();
  const pdf = await downloadVia(page, async () => {
    await page.click('[data-testid="export-format"] [data-value="pdf"]');
    await page.click('[data-testid="export-page-1"]');
  });
  assert.match(pdf.bytes.toString('latin1'), /\/Count 1/);
  const zip = await downloadVia(page);
  assert.match(zip.name, /\.zip$/);
  assert.equal(zip.bytes.readUInt32LE(0), 0x04034b50);
  const names = [...zip.bytes.toString('latin1').matchAll(/Untitled design-(\d)\.png/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(names)], ['1', '2']);
  await context.close();
});

test('[EXP-08] print', async () => {
  const { page, context } = await twoPages();
  await page.evaluate(() => {
    window.__printed = 0;
    window.print = () => {
      window.__printed = document.querySelectorAll('#print-root img').length;
    };
  });
  await page.click('[data-testid="download"]');
  await page.click('[data-testid="export-print"]');
  await page.waitForFunction(() => window.__printed > 0);
  assert.equal(await page.evaluate(() => window.__printed), 2);
  await context.close();
});

test('the download dialog never shows stray "null" text', async () => {
  const { page, context } = await newDesign('square');
  await page.click('[data-testid="download"]');
  for (const f of ['png', 'jpg', 'pdf', 'svg']) {
    await page.click(`[data-testid="export-format"] [data-value="${f}"]`);
    assert.ok(!/null|undefined/.test(await page.innerText('[data-testid="export-dialog"]')), f);
  }
  await context.close();
});

test('[EXP-09] no watermark, ever', async () => {
  const { page, context } = await newDesign('square');
  const { bytes } = await downloadVia(page);
  for (const [x, y] of [[1, 1], [540, 540], [1078, 1078], [100, 1000], [1000, 1060], [540, 1060]]) {
    assert.deepEqual(await pixelAt(page, bytes, 'image/png', x, y), [255, 255, 255, 255], `pixel ${x},${y} is plain white`);
  }
  await context.close();
});

test('[EXP-11] copy the design to the clipboard as an image', async () => {
  const { page, context } = await newDesign('square');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await addShape(page, 'Heart');
  await page.click('[data-testid="download"]');
  await page.click('[data-testid="export-copy"]');
  let types = null;
  for (let i = 0; i < 50 && !types; i++) {
    types = await page.evaluate(async () => {
      const items = await navigator.clipboard.read().catch(() => []);
      return items.length && items[0].types.includes('image/png') ? items[0].types : null;
    });
    if (!types) await page.waitForTimeout(100);
  }
  assert.deepEqual(types, ['image/png']);
  const size = await page.evaluate(async () => {
    const [item] = await navigator.clipboard.read();
    const bmp = await createImageBitmap(await item.getType('image/png'));
    return [bmp.width, bmp.height];
  });
  assert.deepEqual(size, [1080, 1080]);
  await context.close();
});

// ---------- templates ----------

test('[TPL-01] [TPL-02] browse templates by category and search', async () => {
  const { page, context } = await openApp();
  const cards = '[data-testid="home-templates"] .tpl';
  const ids = () => page.$$eval(cards, (els) => els.map((e) => e.dataset.testid.replace('template-', '')));
  assert.equal(await page.textContent('[data-testid="home-template-count"]'), `${TEMPLATES.length} templates`);
  await page.click('[data-testid="home-cat-Birthday"]');
  assert.deepEqual(await ids(), searchTemplates({ category: 'Birthday' }).map((t) => t.id));
  await page.click('[data-testid="home-cat-All"]');
  await page.fill('[data-testid="home-template-search"]', 'menu');
  const menus = searchTemplates({ query: 'menu' }).map((t) => t.id);
  assert.ok(menus.includes('cafe-menu') && menus.length > 3);
  assert.deepEqual(await ids(), menus.slice(0, 30));
  await context.close();
});

test('[TPL-03] start a design from a template', async () => {
  const { page, context } = await openApp();
  await page.click('[data-testid="template-birthday-invite"]');
  await waitForEditor(page);
  const doc = await state(page);
  assert.deepEqual([doc.width, doc.height], [1500, 2100]);
  assert.equal(doc.name, 'Birthday party');
  assert.ok(doc.pages[0].elements.length > 5);
  await context.close();
});

test('[TPL-04] add a template as a new page in your design', async () => {
  const { page, context } = await newDesign('square');
  await addText(page);
  await openTab(page, 'templates');
  await page.click('[data-testid="template-quote-card"]');
  await page.waitForFunction(() => window.paperwall.editor.doc.pages.length === 2);
  const doc = await state(page);
  assert.equal(doc.pages.length, 2);
  assert.ok(doc.pages[1].elements.some((e) => e.type === 'text' && /Make the thing/.test(e.text)));
  assert.equal(await state(page, (ed) => ed.page), 1);
  await context.close();
});

test('[TPL-05] every template is original and free for any use (CC0)', () => {
  const fonts = new Set(FONTS.map((f) => f.name));
  assert.ok(TEMPLATES.length >= 16);
  assert.ok(TEMPLATE_CATEGORIES.length >= 6);
  for (const t of TEMPLATES) {
    const doc = templateDoc(t);
    assert.deepEqual(doc.assets, {}, `${t.id}: no outside images`);
    const visit = (els) => {
      for (const el of els) {
        if (el.type === 'text') assert.ok(fonts.has(el.font), `${t.id}: ${el.font} is bundled`);
        if (el.type === 'icon') assert.ok(iconById(el.iconId), `${t.id}: icon ${el.iconId}`);
        if (el.type === 'sticker') assert.ok(stickerById(el.stickerId), `${t.id}: sticker ${el.stickerId}`);
        assert.notEqual(el.type, 'image', `${t.id}: no photos`);
        if (el.type === 'group') visit(el.children);
      }
    };
    visit(doc.pages[0].elements);
  }
  const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
  assert.match(readme, /CC0/);
});

test('[EXP-12] PDF with real, selectable and searchable text', async () => {
  const { page, context } = await newDesign('a4');
  await addText(page);
  await page.evaluate(() => window.paperwall.editor.update({ text: 'Spring fair at Café Lumière', align: 'center' }));
  // The flattened PDF: each page a picture, with an invisible text layer. (The vector PDF's text is checked in EXP-13.)
  const { bytes } = await downloadVia(page, async () => {
    await page.click('[data-testid="export-format"] [data-value="pdf"]');
    await page.click('[data-testid="export-pdf-kind"] [data-value="flat"]');
  });
  const raw = bytes.toString('latin1');
  assert.ok(raw.includes('Caf\xe9') && raw.includes('Lumi\xe8re'), 'accents survive as single bytes');
  try {
    execFileSync('pdftotext', ['-v'], { stdio: 'ignore' });
  } catch {
    return context.close();
  }
  const dir = mkdtempSync(join(tmpdir(), 'paperwall-pdf-'));
  writeFileSync(join(dir, 'a.pdf'), bytes);
  const text = execFileSync('pdftotext', ['-enc', 'UTF-8', join(dir, 'a.pdf'), '-']).toString();
  assert.match(text.replace(/\s+/g, ' '), /Spring fair at Café Lumière/);
  // The words sit where the picture shows them: centered on an A4 page.
  const html = execFileSync('pdftotext', ['-bbox', join(dir, 'a.pdf'), '-']).toString();
  const words = [...html.matchAll(/xMin="([\d.]+)" yMin="[\d.]+" xMax="([\d.]+)"[^>]*>([^<]+)</g)].map((m) => ({ x1: +m[1], x2: +m[2], w: m[3] }));
  const left = Math.min(...words.map((w) => w.x1));
  const right = Math.max(...words.map((w) => w.x2));
  assert.ok(Math.abs((left + right) / 2 - 297.6) < 15, `centered: ${left}..${right}`);
  await context.close();
});
