import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { newDesign, state, elements, addText, elementCenter, teardown, mod, openTab } from './helpers.js';

after(teardown);

const el = async (page) => (await elements(page)).at(-1);
const dom = (page, id) => page.locator(`[data-testid="page"] [data-id="${id}"]`);

async function heading() {
  const app = await newDesign('square');
  const t = await addText(app.page, 'heading');
  return { ...app, t };
}

async function setNumber(page, testid, value) {
  const input = page.locator(`[data-testid="${testid}"] + input, label:has([data-testid="${testid}"]) input[type="number"]`).first();
  await input.fill(String(value));
  await input.press('Enter');
}

test('[TXT-01] add a heading, a subheading and body text', async () => {
  const { page, context } = await newDesign('square');
  for (const s of ['heading', 'subheading', 'body']) await addText(page, s);
  const els = await elements(page);
  assert.deepEqual(els.map((e) => e.type), ['text', 'text', 'text']);
  assert.ok(els[0].size > els[1].size && els[1].size > els[2].size);
  assert.equal(await page.locator('[data-testid="page"] [data-type="text"]').count(), 3);
  await context.close();
});

test('[TXT-02] [TXT-18] double-click to edit in place; the box grows as you type', async () => {
  const { page, context, t } = await heading();
  const c = await elementCenter(page, t.id);
  await page.mouse.dblclick(c.x, c.y);
  await page.waitForSelector('[data-testid="text-editor"]');
  await page.keyboard.press(`${mod}+a`);
  await page.keyboard.type('Bake sale this Saturday, everything homemade and delicious');
  const tall = (await el(page)).h;
  await page.keyboard.press('Escape');
  const after = await el(page);
  assert.equal(after.text, 'Bake sale this Saturday, everything homemade and delicious');
  assert.ok(tall > t.h, `height grew from ${t.h} to ${tall}`);
  assert.equal(await page.locator('[data-testid="text-editor"]').count(), 0);
  // Editing is one undo step.
  await page.keyboard.press(`${mod}+z`);
  assert.equal((await el(page)).text, t.text);
  await context.close();
});

test('[TXT-03] text wraps inside its box', async () => {
  const { page, context, t } = await heading();
  assert.equal(await dom(page, t.id).locator('tspan').count(), 1);
  await page.fill('[data-testid="geo-w"]', '300');
  await page.press('[data-testid="geo-w"]', 'Enter');
  assert.ok((await dom(page, t.id).locator('tspan').count()) >= 2);
  await context.close();
});

test('[TXT-04] [TXT-05] choose a bundled font and a size', async () => {
  const { page, context, t } = await heading();
  const fonts = await page.$$eval('[data-testid="font-select"] option', (o) => o.map((x) => x.value));
  assert.ok(fonts.length >= 14);
  await page.selectOption('[data-testid="font-select"]', 'Playfair Display');
  await page.fill('[data-testid="font-size"]', '120');
  await page.press('[data-testid="font-size"]', 'Enter');
  const e = await el(page);
  assert.equal(e.font, 'Playfair Display');
  assert.equal(e.size, 120);
  assert.match(await dom(page, t.id).locator('text').getAttribute('font-family'), /Playfair Display/);
  const loaded = await page.evaluate(() => document.fonts.check('700 40px "Playfair Display"'));
  assert.equal(loaded, true, 'the font file is loaded, not a fallback');
  await context.close();
});

test('[TXT-06] [TXT-07] bold, italic, underline and strikethrough', async () => {
  const { page, context, t } = await heading();
  await page.click('[data-testid="text-bold"]');
  await page.click('[data-testid="text-italic"]');
  await page.click('[data-testid="text-underline"]');
  await page.click('[data-testid="text-strike"]');
  const e = await el(page);
  assert.equal(e.weight, 400, 'heading was bold; toggled off');
  assert.deepEqual([e.italic, e.underline, e.strike], [true, true, true]);
  const text = dom(page, t.id).locator('text');
  assert.equal(await text.getAttribute('font-style'), 'italic');
  assert.equal(await dom(page, t.id).locator('rect').count(), 2, 'underline and strike lines');
  await context.close();
});

test('[TXT-08] [CLR-01] text color from the picker with a hex code', async () => {
  const { page, context, t } = await heading();
  await page.click('[data-testid="text-color"]');
  await page.waitForSelector('[data-testid="color-popover"]');
  await page.fill('[data-testid="hex-input"]', '#e11d48');
  await page.press('[data-testid="hex-input"]', 'Enter');
  assert.equal((await el(page)).color, '#e11d48');
  assert.equal(await dom(page, t.id).locator('text').getAttribute('fill'), '#e11d48');
  // Three-digit codes work too.
  await page.fill('[data-testid="hex-input"]', '0a0');
  await page.press('[data-testid="hex-input"]', 'Enter');
  assert.equal((await el(page)).color, '#00aa00');
  await context.close();
});

test('[TXT-09] [TXT-10] [TXT-11] alignment, line spacing and letter spacing', async () => {
  const { page, context } = await heading();
  await page.click('[data-testid="text-align"] [data-value="center"]');
  await setNumber(page, 'line-height', 1.8);
  await setNumber(page, 'letter-spacing', 6);
  const e = await el(page);
  assert.deepEqual([e.align, e.lineHeight, e.letterSpacing], ['center', 1.8, 6]);
  await page.click('[data-testid="text-align"] [data-value="right"]');
  assert.equal((await el(page)).align, 'right');
  await context.close();
});

test('[TXT-12] all caps', async () => {
  const { page, context, t } = await heading();
  await page.click('[data-testid="text-caps"]');
  assert.equal((await dom(page, t.id).locator('tspan').allTextContents()).join(' '), t.text.toUpperCase());
  assert.equal((await el(page)).text, t.text, 'the stored text keeps its case');
  await context.close();
});

test('[TXT-13] bulleted and numbered lists', async () => {
  const { page, context, t } = await heading();
  await page.evaluate(() => window.placard.editor.update({ text: 'Eggs\nFlour\nSugar', size: 40 }));
  await page.click('[data-testid="text-list"] [data-value="number"]');
  let spans = await dom(page, t.id).locator('tspan').allTextContents();
  assert.ok(['1.', '2.', '3.'].every((n) => spans.includes(n)), spans.join('|'));
  await page.click('[data-testid="text-list"] [data-value="bullet"]');
  spans = await dom(page, t.id).locator('tspan').allTextContents();
  assert.equal(spans.filter((s) => s === '•').length, 3);
  await context.close();
});

test('[TXT-14] [TXT-15] [TXT-16] text shadow, outline and a colored box behind', async () => {
  const { page, context, t } = await heading();
  await page.click('[data-testid="shadow-toggle"]');
  await page.click('[data-testid="outline-toggle"]');
  await page.click('[data-testid="highlight-toggle"]');
  const e = await el(page);
  assert.ok(e.shadow && e.outline && e.highlight);
  assert.match(await dom(page, t.id).getAttribute('filter'), /^url\(#/);
  assert.equal(await dom(page, t.id).locator('text').getAttribute('paint-order'), 'stroke fill');
  assert.equal(await dom(page, t.id).locator('rect').count(), 1, 'box behind the text');
  await context.close();
});

test('[TXT-17] curved text', async () => {
  const { page, context, t } = await heading();
  await setNumber(page, 'curve', 60);
  assert.equal((await el(page)).curve, 60);
  assert.equal(await dom(page, t.id).locator('textPath').count(), 1);
  await setNumber(page, 'curve', -40);
  assert.equal(await dom(page, t.id).locator('textPath').count(), 1);
  await context.close();
});

test('[TXT-19] ready-made heading and body font pairs', async () => {
  const { page, context } = await newDesign('square');
  await openTab(page, 'text');
  await page.click('[data-testid="pair-Classic"]');
  const els = await elements(page);
  assert.deepEqual(els.map((e) => e.font), ['Playfair Display', 'Lora']);
  assert.equal((await state(page, (ed) => ed.selection)).length, 2);
  await context.close();
});

test('[TXT-20] use your own font file', async () => {
  const { page, context } = await heading();
  const chooser = page.waitForEvent('filechooser');
  await page.click('[data-testid="upload-font"]');
  const font = readFileSync(new URL('../../assets/fonts/caveat-400.woff2', import.meta.url));
  await (await chooser).setFiles({ name: 'My Hand.woff2', mimeType: 'font/woff2', buffer: font });
  await page.waitForFunction(() => window.placard.editor.single?.font === 'My Hand');
  const doc = await state(page);
  assert.ok(Object.values(doc.assets).some((a) => a.type === 'font' && a.family === 'My Hand'), 'stored inside the design');
  const svg = await page.evaluate(async () => (await window.placard.export.exportSvg(window.placard.editor.doc, 0)).text());
  assert.ok(svg.includes('font-family:"My Hand"'), 'embedded in exports');
  await context.close();
});
