import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { newDesign, state, elements, addShape, addText, elementCenter, teardown, mod, handle, waitForEditor } from './helpers.js';

after(teardown);

async function pickColor(page, testid, hex) {
  await page.click(`[data-testid="${testid}"]`);
  await page.fill('[data-testid="hex-input"]', hex);
  await page.press('[data-testid="hex-input"]', 'Enter');
  await page.keyboard.press('Escape');
}

test('[PAGE-01] [PAGE-08] add a blank page and move between pages', async () => {
  const { page, context } = await newDesign('slides');
  await addText(page);
  await page.click('[data-testid="strip-add-page"]');
  let s = await state(page, (ed) => ({ n: ed.doc.pages.length, page: ed.page, els: ed.pageData.elements.length }));
  assert.deepEqual(s, { n: 2, page: 1, els: 0 });
  assert.equal(await page.locator('[data-testid="page-thumb"]').count(), 2);
  await page.locator('[data-testid="page-thumb"]').first().locator('button').click();
  s = await state(page, (ed) => ({ page: ed.page, els: ed.pageData.elements.length }));
  assert.deepEqual(s, { page: 0, els: 1 });
  assert.equal(await page.locator('[data-testid="page"] [data-type="text"]').count(), 1);
  await context.close();
});

test('[PAGE-02] [PAGE-03] duplicate and delete a page', async () => {
  const { page, context } = await newDesign('slides');
  await addShape(page, 'Star');
  await page.keyboard.press('Escape');
  await page.click('[data-testid="page-duplicate"]');
  let doc = await state(page);
  assert.equal(doc.pages.length, 2);
  assert.equal(doc.pages[1].elements[0].shape, 'star');
  assert.notEqual(doc.pages[1].elements[0].id, doc.pages[0].elements[0].id);
  await page.click('[data-testid="page-delete"]');
  doc = await state(page);
  assert.equal(doc.pages.length, 1);
  await page.click('[data-testid="page-delete"]');
  assert.equal((await state(page)).pages.length, 1, 'the last page cannot be deleted');
  await context.close();
});

test('[PAGE-04] reorder pages by dragging in the page strip', async () => {
  const { page, context } = await newDesign('slides');
  await page.click('[data-testid="strip-add-page"]');
  await page.click('[data-testid="strip-add-page"]');
  const ids = (await state(page)).pages.map((p) => p.id);
  await page.locator('[data-testid="page-thumb"]').nth(2).dragTo(page.locator('[data-testid="page-thumb"]').nth(0));
  const after = (await state(page)).pages.map((p) => p.id);
  assert.deepEqual(after, [ids[2], ids[0], ids[1]]);
  await context.close();
});

test('[PAGE-05] [PAGE-06] page background color and gradient', async () => {
  const { page, context } = await newDesign('square');
  await pickColor(page, 'bg-color', '#ffd166');
  let bg = (await state(page)).pages[0].background;
  assert.deepEqual(bg, { type: 'color', color: '#ffd166' });
  assert.equal(await page.locator('[data-testid="page"] svg > rect').first().getAttribute('fill'), '#ffd166');
  await page.click('[data-testid="bg-type"] [data-value="gradient"]');
  bg = (await state(page)).pages[0].background;
  assert.equal(bg.type, 'gradient');
  assert.equal(bg.gradient.stops[0].color, '#ffd166', 'starts from the current color');
  await context.close();
});

test('[VIEW-01] [VIEW-02] zoom in, out, and to fit', async () => {
  const { page, context } = await newDesign('square');
  const z0 = await state(page, (ed) => ed.zoom);
  await page.click('[data-testid="zoom-in"]');
  const z1 = await state(page, (ed) => ed.zoom);
  assert.ok(Math.abs(z1 / z0 - 1.25) < 0.001);
  await page.click('[data-testid="zoom-out"]');
  await page.click('[data-testid="zoom-out"]');
  assert.ok((await state(page, (ed) => ed.zoom)) < z0);
  const box = await page.locator('[data-testid="stage"]').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.down(mod);
  await page.mouse.wheel(0, -300);
  await page.keyboard.up(mod);
  assert.ok((await state(page, (ed) => ed.zoom)) > z0 * 0.8);
  await page.click('[data-testid="zoom-fit"]');
  const fit = await state(page, (ed) => ed.zoom);
  assert.ok(Math.abs(fit - z0) < 0.001, 'fit returns to the fitted zoom');
  const pageBox = await page.locator('[data-testid="page"]').boundingBox();
  assert.ok(pageBox.width <= box.width && pageBox.height <= box.height, 'whole page visible');
  assert.match(await page.textContent('[data-testid="zoom-label"]'), /^\d+%$/);
  await context.close();
});

test('[VIEW-03] scroll around a zoomed-in page', async () => {
  const { page, context } = await newDesign('square');
  for (let i = 0; i < 6; i++) await page.click('[data-testid="zoom-in"]');
  const stage = page.locator('[data-testid="stage"]');
  const dims = await stage.evaluate((s) => ({ sw: s.scrollWidth, cw: s.clientWidth }));
  assert.ok(dims.sw > dims.cw, 'the page is bigger than the view');
  const before = await stage.evaluate((s) => s.scrollLeft);
  const box = await stage.boundingBox();
  // Hold Space and drag to pan.
  await page.mouse.move(box.x + 300, box.y + 300);
  await page.keyboard.down('Space');
  await page.mouse.down();
  await page.mouse.move(box.x + 100, box.y + 300, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up('Space');
  const after = await stage.evaluate((s) => s.scrollLeft);
  assert.ok(after > before, `panned from ${before} to ${after}`);
  await context.close();
});

test('[VIEW-04] dark mode, remembered', async () => {
  const { page, context } = await newDesign('square');
  const before = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await page.click('[data-testid="theme-toggle"]');
  assert.equal(await page.getAttribute('html', 'data-theme'), 'dark');
  const after = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  assert.notEqual(before, after);
  await page.reload();
  await waitForEditor(page);
  assert.equal(await page.getAttribute('html', 'data-theme'), 'dark');
  await context.close();
});

test('[VIEW-05] present pages full screen, move with the arrow keys', async () => {
  const { page, context } = await newDesign('slides');
  await addText(page);
  await page.click('[data-testid="strip-add-page"]');
  await page.locator('[data-testid="page-thumb"]').first().locator('button').click();
  await page.click('[data-testid="present"]');
  await page.waitForSelector('[data-testid="presenter"] svg');
  assert.equal(await page.textContent('.slide-count'), '1 / 2');
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.textContent('.slide-count'), '2 / 2');
  await page.keyboard.press('ArrowLeft');
  assert.equal(await page.textContent('.slide-count'), '1 / 2');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('[data-testid="presenter"]').count(), 0);
  await context.close();
});

/** Real touch input through the DevTools protocol. */
async function touchDrag(page, from, to, steps = 6) {
  const cdp = await page.context().newCDPSession(page);
  const pt = (p) => [{ x: p.x, y: p.y, id: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(from) });
  for (let i = 1; i <= steps; i++) {
    const p = { x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(p) });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

test('[APP-03] works on a phone: tap, drag and resize with touch', async () => {
  const { page, context } = await newDesign('square', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const s = await addShape(page, 'Square');
  await page.keyboard.press('Escape');
  const c = await elementCenter(page, s.id);
  await page.touchscreen.tap(c.x, c.y);
  assert.deepEqual(await state(page, (ed) => ed.selection), [s.id]);
  await touchDrag(page, c, { x: c.x + 40, y: c.y + 30 });
  let el = (await elements(page))[0];
  assert.ok(el.x > s.x && el.y > s.y, 'moved by touch');
  const se = await handle(page, 'se');
  await touchDrag(page, se, { x: se.x + 30, y: se.y + 30 });
  el = (await elements(page))[0];
  assert.ok(el.w > s.w, 'resized by touch');
  // The editor fits on the phone screen without sideways scrolling.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 0, `page is ${overflow}px too wide`);
  await context.close();
});
