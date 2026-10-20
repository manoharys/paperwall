import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  newDesign, state, elements, selection, addText, addShape, clickElement, elementCenter, screenPoint, drag, handle, teardown, mod, settled,
} from './helpers.js';

after(teardown);

const near = (a, b, tol = 1.5) => Math.abs(a - b) <= tol;

/** A design with three squares placed apart. */
async function threeSquares() {
  const app = await newDesign('square');
  const ids = [];
  for (const x of [100, 450, 800]) {
    const s = await addShape(app.page, 'Square');
    await app.page.evaluate(([id, px]) => {
      const ed = window.paperwall.editor;
      ed.change(() => Object.assign(ed.pageData.elements.find((e) => e.id === id), { x: px, y: 200, w: 150, h: 150 }));
    }, [s.id, x]);
    ids.push(s.id);
  }
  await app.page.keyboard.press('Escape');
  return { ...app, ids };
}

test('[SEL-01] [SEL-13] click to select; Escape and empty space deselect', async () => {
  const { page, context, ids } = await threeSquares();
  await clickElement(page, ids[1]);
  assert.deepEqual(await selection(page), [ids[1]]);
  assert.equal(await page.textContent('[data-testid="selection-title"]'), 'Rectangle');
  await page.keyboard.press('Escape');
  assert.deepEqual(await selection(page), []);
  await clickElement(page, ids[0]);
  const empty = await screenPoint(page, 540, 900);
  await page.mouse.click(empty.x, empty.y);
  assert.deepEqual(await selection(page), []);
  await context.close();
});

test('[SEL-02] shift-click selects several', async () => {
  const { page, context, ids } = await threeSquares();
  await clickElement(page, ids[0]);
  await clickElement(page, ids[2], ['Shift']);
  assert.deepEqual((await selection(page)).sort(), [ids[0], ids[2]].sort());
  assert.equal(await page.textContent('[data-testid="selection-title"]'), '2 selected');
  await clickElement(page, ids[0], ['Shift']);
  assert.deepEqual(await selection(page), [ids[2]]);
  await context.close();
});

test('[SEL-03] drag a box over empty space to select', async () => {
  const { page, context, ids } = await threeSquares();
  const a = await screenPoint(page, 50, 120);
  const b = await screenPoint(page, 700, 420);
  await drag(page, a, b);
  assert.deepEqual((await selection(page)).sort(), [ids[0], ids[1]].sort());
  await context.close();
});

test('[SEL-04] select everything on the page', async () => {
  const { page, context, ids } = await threeSquares();
  await page.locator('[data-testid="stage"]').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press(`${mod}+a`);
  assert.deepEqual((await selection(page)).sort(), [...ids].sort());
  await context.close();
});

test('[SEL-05] [SEL-11] drag to move, snapping to the page center with a guide', async () => {
  const { page, context, ids } = await threeSquares();
  const from = await elementCenter(page, ids[0]);
  // Square center starts at x=175; aim for a few px off the page center (540).
  const to = await screenPoint(page, 537, 600);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  const guides = await page.locator('.overlay .guide').count();
  await page.mouse.up();
  const el = (await elements(page)).find((e) => e.id === ids[0]);
  assert.ok(near(el.x + el.w / 2, 540, 0.01), `snapped to center, got ${el.x + el.w / 2}`);
  assert.ok(guides >= 1, 'a guide line showed while snapping');
  await context.close();
});

test('[SEL-12] snap to the edges of other elements', async () => {
  const { page, context, ids } = await threeSquares();
  const from = await elementCenter(page, ids[0]);
  // Others' tops are at y=200; drop this one with its top ~3px off.
  const to = await screenPoint(page, 175, 278);
  await drag(page, from, to);
  const el = (await elements(page)).find((e) => e.id === ids[0]);
  assert.ok(near(el.y, 200, 0.01) || near(el.y + el.h, 350, 0.01), `y=${el.y}`);
  await context.close();
});

test('[SEL-06] nudge with arrow keys, bigger steps with Shift', async () => {
  const { page, context, ids } = await threeSquares();
  await clickElement(page, ids[1]);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowDown');
  const el = (await elements(page)).find((e) => e.id === ids[1]);
  assert.deepEqual([el.x, el.y], [452, 210]);
  // Rapid nudges undo as one step.
  await page.keyboard.press(`${mod}+z`);
  const back = (await elements(page)).find((e) => e.id === ids[1]);
  assert.deepEqual([back.x, back.y], [450, 200]);
  await context.close();
});

test('[SEL-07] [SEL-08] resize from corner and side handles; corners can keep proportions', async () => {
  const { page, context, ids } = await threeSquares();
  await clickElement(page, ids[1]);
  const e = await handle(page, 'e');
  await drag(page, e, { x: e.x + 60, y: e.y });
  let el = (await elements(page)).find((x) => x.id === ids[1]);
  const z = await state(page, (ed) => ed.zoom);
  assert.ok(near(el.w, 150 + 60 / z, 1), `width ${el.w}`);
  assert.equal(el.h, 150);
  assert.equal(el.x, 450, 'left edge stayed put');
  const w0 = el.w;
  const se = await handle(page, 'se');
  await drag(page, se, { x: se.x + 40, y: se.y + 10 }, { modifiers: ['Shift'] });
  el = (await elements(page)).find((x) => x.id === ids[1]);
  assert.ok(near(el.w / el.h, w0 / 150, 0.01), 'kept proportions');
  await context.close();
});

test('[SEL-09] rotate with the handle, snapping to 15 degrees with Shift', async () => {
  const { page, context, ids } = await threeSquares();
  await clickElement(page, ids[1]);
  const c = await elementCenter(page, ids[1]);
  const r = await handle(page, 'rotate');
  await page.mouse.move(r.x, r.y);
  await page.mouse.down();
  await page.keyboard.down('Shift');
  await page.mouse.move(c.x + 200, c.y - 20, { steps: 8 });
  await page.keyboard.up('Shift');
  await page.mouse.up();
  const el = (await elements(page)).find((x) => x.id === ids[1]);
  assert.ok(el.rotation > 0 && el.rotation % 15 === 0, `rotation ${el.rotation}`);
  await context.close();
});

test('[SEL-10] type an exact position, size and angle', async () => {
  const { page, context, ids } = await threeSquares();
  await clickElement(page, ids[0]);
  for (const [k, v] of [['x', '12'], ['y', '34'], ['w', '222'], ['h', '111'], ['rotation', '30']]) {
    await page.fill(`[data-testid="geo-${k}"]`, v);
    await page.press(`[data-testid="geo-${k}"]`, 'Enter');
  }
  const el = (await elements(page)).find((x) => x.id === ids[0]);
  assert.deepEqual([el.x, el.y, el.w, el.h, el.rotation], [12, 34, 222, 111, 30]);
  await context.close();
});

test('[EDIT-01] [EDIT-02] undo and redo with buttons and keys', async () => {
  const { page, context, ids } = await threeSquares();
  await clickElement(page, ids[0]);
  await page.keyboard.press('Delete');
  assert.equal((await elements(page)).length, 2);
  await page.click('[data-testid="undo"]');
  assert.equal((await elements(page)).length, 3);
  await page.click('[data-testid="redo"]');
  assert.equal((await elements(page)).length, 2);
  await page.keyboard.press(`${mod}+z`);
  assert.equal((await elements(page)).length, 3);
  await page.keyboard.press(`${mod}+Shift+z`);
  assert.equal((await elements(page)).length, 2);
  await context.close();
});

test('[EDIT-03] delete the selection', async () => {
  const { page, context, ids } = await threeSquares();
  await clickElement(page, ids[0]);
  await clickElement(page, ids[1], ['Shift']);
  await page.keyboard.press('Backspace');
  assert.deepEqual((await elements(page)).map((e) => e.id), [ids[2]]);
  await clickElement(page, ids[2]);
  await page.click('[data-testid="act-delete"]');
  assert.equal((await elements(page)).length, 0);
  await context.close();
});

test('[EDIT-04] duplicate the selection', async () => {
  const { page, context, ids } = await threeSquares();
  await clickElement(page, ids[0]);
  await page.keyboard.press(`${mod}+d`);
  await page.click('[data-testid="act-duplicate"]');
  const els = await elements(page);
  assert.equal(els.length, 5);
  assert.notDeepEqual(await selection(page), [ids[0]], 'the copy is selected');
  await context.close();
});

test('[EDIT-05] [EDIT-06] copy, cut and paste, including onto another page', async () => {
  const { page, context, ids } = await threeSquares();
  await clickElement(page, ids[0]);
  await page.keyboard.press(`${mod}+c`);
  await page.keyboard.press(`${mod}+v`);
  await page.waitForFunction(() => window.paperwall.editor.pageData.elements.length === 4);
  await clickElement(page, ids[2]);
  await page.keyboard.press(`${mod}+x`);
  await page.waitForFunction(() => window.paperwall.editor.pageData.elements.length === 3);
  await page.click('[data-testid="strip-add-page"]');
  await page.waitForFunction(() => window.paperwall.editor.page === 1);
  await page.locator('[data-testid="stage"]').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press(`${mod}+v`);
  await page.waitForFunction(() => window.paperwall.editor.doc.pages[1].elements.length === 1);
  const pasted = (await state(page)).pages[1].elements[0];
  assert.equal(pasted.x, 800, 'pasted onto another page in the same place');
  await context.close();
});

test('[EDIT-07] group and ungroup', async () => {
  const { page, context, ids } = await threeSquares();
  await clickElement(page, ids[0]);
  await clickElement(page, ids[1], ['Shift']);
  await page.click('[data-testid="act-group"]');
  let els = await elements(page);
  assert.equal(els.length, 2);
  const g = els.find((e) => e.type === 'group');
  assert.equal(g.children.length, 2);
  // Move the group as one.
  const c = await elementCenter(page, g.id);
  await drag(page, c, { x: c.x + 30, y: c.y + 30 });
  await page.keyboard.press(`${mod}+Shift+g`);
  els = await elements(page);
  assert.equal(els.length, 3);
  assert.ok(els.every((e) => e.type === 'shape'));
  await context.close();
});

test('[EDIT-08] lock an element so it cannot move', async () => {
  const { page, context, ids } = await threeSquares();
  await clickElement(page, ids[0]);
  await page.click('[data-testid="act-lock"]');
  const c = await elementCenter(page, ids[0]);
  await drag(page, c, { x: c.x + 80, y: c.y });
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Delete');
  const el = (await elements(page)).find((e) => e.id === ids[0]);
  assert.ok(el, 'locked element was not deleted');
  assert.equal(el.x, 100);
  assert.equal(el.locked, true);
  await page.keyboard.press(`${mod}+l`);
  assert.equal((await elements(page)).find((e) => e.id === ids[0]).locked, false);
  await context.close();
});

test('[EDIT-09] [EDIT-10] bring forward, send backward, to front, to back', async () => {
  const { page, context, ids } = await threeSquares();
  const order = async () => (await elements(page)).map((e) => e.id);
  await clickElement(page, ids[0]);
  await page.click('[data-testid="order-forward"]');
  assert.deepEqual(await order(), [ids[1], ids[0], ids[2]]);
  await page.click('[data-testid="order-front"]');
  assert.deepEqual(await order(), [ids[1], ids[2], ids[0]]);
  await page.keyboard.press('[');
  assert.deepEqual(await order(), [ids[1], ids[0], ids[2]]);
  await page.click('[data-testid="order-back"]');
  assert.deepEqual(await order(), [ids[0], ids[1], ids[2]]);
  await context.close();
});

test('[EDIT-11] layers list: select, reorder and hide', async () => {
  const { page, context, ids } = await threeSquares();
  await page.click('[data-testid="tab-layers"]');
  assert.equal(await page.locator('[data-testid="layer"]').count(), 3);
  // Top of the list is the front-most element.
  await page.locator('[data-testid="layer"]').first().click();
  assert.deepEqual(await selection(page), [ids[2]]);
  await page.locator('[data-testid="layer"]').first().locator('[data-testid="layer-down"]').click();
  assert.deepEqual((await elements(page)).map((e) => e.id), [ids[0], ids[2], ids[1]]);
  await page.locator('[data-testid="layer"]').last().locator('[data-testid="layer-visibility"]').click();
  const hidden = (await elements(page)).find((e) => e.id === ids[0]);
  assert.equal(hidden.hidden, true);
  await settled(page);
  assert.equal(await page.locator(`[data-testid="page"] [data-id="${ids[0]}"]`).count(), 0, 'hidden elements are not drawn');
  await context.close();
});

test('[EDIT-12] align to the page', async () => {
  const { page, context, ids } = await threeSquares();
  await clickElement(page, ids[0]);
  await page.click('[data-testid="align-center"]');
  await page.click('[data-testid="align-bottom"]');
  const el = (await elements(page)).find((e) => e.id === ids[0]);
  assert.deepEqual([el.x, el.y], [465, 930]);
  await context.close();
});

test('[EDIT-13] [EDIT-14] align several to each other, and space them evenly', async () => {
  const { page, context, ids } = await threeSquares();
  await page.evaluate((id) => {
    const ed = window.paperwall.editor;
    ed.change(() => Object.assign(ed.pageData.elements.find((e) => e.id === id), { x: 300, y: 500 }));
  }, ids[1]);
  for (const id of ids) await clickElement(page, id, ['Shift']);
  await page.click('[data-testid="align-top"]');
  let els = await elements(page);
  assert.ok(els.every((e) => e.y === 200));
  await page.click('[data-testid="distribute-x"]');
  els = await elements(page);
  const sorted = [...els].sort((a, b) => a.x - b.x);
  const gap1 = sorted[1].x - (sorted[0].x + sorted[0].w);
  const gap2 = sorted[2].x - (sorted[1].x + sorted[1].w);
  assert.ok(near(gap1, gap2, 0.01));
  await context.close();
});

test('[EDIT-15] [EDIT-16] flip and transparency', async () => {
  const { page, context, ids } = await threeSquares();
  await clickElement(page, ids[0]);
  await page.click('[data-testid="flip-x"]');
  await page.click('[data-testid="flip-y"]');
  await page.fill('[data-testid="opacity"] + input', '40');
  await page.press('[data-testid="opacity"] + input', 'Enter');
  const el = (await elements(page)).find((e) => e.id === ids[0]);
  assert.equal(el.flipX, true);
  assert.equal(el.flipY, true);
  assert.ok(near(el.opacity, 0.6, 0.001));
  await settled(page);
  const g = await page.getAttribute(`[data-testid="page"] [data-id="${ids[0]}"]`, 'opacity');
  assert.equal(g, '0.6');
  await context.close();
});

test('[EDIT-17] copy the style of one element onto another', async () => {
  const { page, context, ids } = await threeSquares();
  await page.evaluate((id) => {
    const ed = window.paperwall.editor;
    ed.change(() => Object.assign(ed.pageData.elements.find((e) => e.id === id), { fill: '#ff0055', stroke: '#000000', strokeWidth: 9, opacity: 0.5 }));
  }, ids[0]);
  await clickElement(page, ids[0]);
  await page.click('[data-testid="act-copy-style"]');
  await clickElement(page, ids[2]);
  await page.click('[data-testid="act-paste-style"]');
  const el = (await elements(page)).find((e) => e.id === ids[2]);
  assert.deepEqual([el.fill, el.stroke, el.strokeWidth, el.opacity], ['#ff0055', '#000000', 9, 0.5]);
  await context.close();
});

test('[EDIT-18] keyboard shortcuts cheat sheet', async () => {
  const { page, context } = await newDesign();
  await page.keyboard.press('?');
  await page.waitForSelector('[data-testid="shortcuts"]');
  assert.ok((await page.locator('[data-testid="shortcuts"] tr').count()) >= 20);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('[data-testid="shortcuts"]').count(), 0);
  // Shortcuts for adding things work.
  await page.keyboard.press('t');
  await page.keyboard.press('Escape');
  await page.keyboard.press('r');
  await page.keyboard.press('Escape');
  await page.keyboard.press('o');
  await page.keyboard.press('Escape');
  await page.keyboard.press('l');
  assert.deepEqual((await elements(page)).map((e) => e.type), ['text', 'shape', 'shape', 'line']);
  await context.close();
});

// ---------- rulers, guides, grid ----------

test('[VIEW-06] rulers and guides you drag out, which elements snap to', async () => {
  const { page, context } = await newDesign('square');
  await page.keyboard.press('Shift+R');
  assert.ok(await page.locator('[data-testid="ruler-x"]').isVisible());
  // Pull a vertical guide out of the left ruler to x = 300.
  const ruler = await page.locator('[data-testid="ruler-y"]').boundingBox();
  const to = await screenPoint(page, 300, 500);
  await drag(page, { x: ruler.x + 10, y: to.y }, to, { steps: 10 });
  let guides = await state(page, (ed) => ed.pageData.guides || []);
  assert.equal(guides.length, 1);
  assert.equal(guides[0].axis, 'x');
  assert.ok(Math.abs(guides[0].pos - 300) <= 2, `guide at ${guides[0].pos}`);
  assert.equal(await page.locator('[data-testid="guide"]').count(), 1);
  // A shape dragged near the guide snaps its left edge to it.
  const s = await addShape(page, 'Square');
  const c = await elementCenter(page, s.id);
  const target = await screenPoint(page, 300 + s.w / 2 + 3, 400);
  await drag(page, c, target, { steps: 12 });
  const moved = (await elements(page)).find((e) => e.id === s.id);
  assert.equal(Math.round(moved.x), Math.round(guides[0].pos), 'snapped to the guide');
  // Guides are part of the design: undo removes them; dragging one off the page deletes it.
  for (let i = 0; i < 3; i++) await page.keyboard.press(`${mod}+z`); // move, add shape, add guide
  assert.equal((await state(page, (ed) => ed.pageData.guides || [])).length, 0);
  await page.keyboard.press(`${mod}+Shift+z`);
  guides = await state(page, (ed) => ed.pageData.guides || []);
  assert.equal(guides.length, 1);
  const g = await screenPoint(page, guides[0].pos, 900);
  await page.mouse.click(10, 10);
  await drag(page, g, { x: g.x - 2000, y: g.y }, { steps: 6 });
  assert.equal((await state(page, (ed) => ed.pageData.guides || [])).length, 0);
  await context.close();
});

test('[VIEW-07] grid with snapping, safe margins and print bleed', async () => {
  const { page, context } = await newDesign('square');
  await page.click('[data-testid="view"]');
  await page.click('[data-testid="view-grid"]');
  await page.click('[data-testid="view-margins"]');
  await page.click('[data-testid="view-bleed"]');
  // The overlay is drawn on the next animation frame: wait for it.
  const shown = async (sel) => {
    await page.locator(sel).first().waitFor({ state: 'attached', timeout: 5000 });
    return page.locator(sel).count();
  };
  assert.equal(await shown('[data-testid="grid-lines"]'), 1);
  assert.equal(await shown('[data-testid="margin-box"]'), 1);
  assert.equal(await shown('[data-testid="bleed-zone"]'), 1);
  await page.keyboard.press('Escape');
  // Settings are remembered after a reload; none of it shows in exports.
  await page.reload();
  await page.waitForFunction(() => window.paperwall?.editor);
  assert.equal(await shown('[data-testid="grid-lines"]'), 1);
  const svg = await page.evaluate(async () => (await window.paperwall.export.exportSvg(window.paperwall.editor.doc, 0)).text());
  assert.ok(!/grid-lines|margin-box|bleed/.test(svg));
  // Elements snap to grid lines (every 54 px on a 1080 px page).
  const s = await addShape(page, 'Square');
  const c = await elementCenter(page, s.id);
  await drag(page, c, await screenPoint(page, 220 + s.w / 2, 300 + s.h / 2), { steps: 12 });
  const moved = (await elements(page)).find((e) => e.id === s.id);
  assert.equal(Math.round(moved.x) % 54, 0, `x ${moved.x} is on the grid`);
  await context.close();
});

// ---------- find and replace, spelling ----------

test('[EDIT-19] find and replace text across every page', async () => {
  const { page, context } = await newDesign('square');
  await addText(page);
  await page.evaluate(() => {
    const ed = window.paperwall.editor;
    ed.change(() => (ed.pageData.elements[0].text = 'Summer sale'));
  });
  await page.click('[data-testid="strip-add-page"]');
  await addText(page);
  await page.evaluate(() => {
    const ed = window.paperwall.editor;
    ed.change(() => (ed.pageData.elements[0].text = 'See you this summer'));
  });
  await page.keyboard.press(`${mod}+f`);
  await page.fill('[data-testid="find-input"]', 'summer');
  assert.match(await page.textContent('[data-testid="find-status"]'), /^2 matches in 2 places/);
  // Previous, before anything is shown, goes to the last match.
  await page.click('[data-testid="find-prev"]');
  assert.match(await page.textContent('[data-testid="find-status"]'), /showing 2 of 2/);
  assert.equal(await state(page, (ed) => ed.page), 1);
  await page.click('[data-testid="find-next"]');
  assert.equal(await state(page, (ed) => ed.page), 0, 'jumps to the first page');
  await page.click('[data-testid="find-next"]');
  assert.equal(await state(page, (ed) => ed.page), 1);
  await page.fill('[data-testid="replace-input"]', 'winter');
  await page.click('[data-testid="replace-all"]');
  const texts = await state(page, (ed) => ed.doc.pages.map((p) => p.elements[0].text));
  assert.deepEqual(texts, ['winter sale', 'See you this winter']);
  await page.keyboard.press('Escape');
  await page.keyboard.press(`${mod}+z`);
  assert.deepEqual(await state(page, (ed) => ed.doc.pages.map((p) => p.elements[0].text)), ['Summer sale', 'See you this summer'], 'one undo puts it all back');
  await context.close();
});

test('[EDIT-20] spell check while editing text', async () => {
  const { page, context } = await newDesign('square');
  const t = await addText(page);
  const p = await elementCenter(page, t.id);
  await page.mouse.dblclick(p.x, p.y);
  assert.equal(await page.getAttribute('[data-testid="text-editor"]', 'spellcheck'), 'true');
  await context.close();
});

test('clicking a ruler without dragging leaves no guide and no undo step', async () => {
  const { page, context } = await newDesign('square');
  await page.keyboard.press('Shift+R');
  const r = await page.locator('[data-testid="ruler-x"]').boundingBox();
  await page.mouse.click(r.x + 100, r.y + 10);
  assert.equal((await state(page, (ed) => ed.pageData.guides || [])).length, 0);
  assert.equal(await state(page, (ed) => ed.history.canUndo), false);
  await context.close();
});

test('[EDIT-01] a drag the system calls off puts everything back, with no undo step', async () => {
  const { page, context } = await newDesign('square');
  const s = await addShape(page, 'Square');
  const steps = await state(page, (ed) => ed.history.past.length);
  const c = await elementCenter(page, s.id);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x + 120, c.y + 80, { steps: 6 });
  assert.notEqual((await elements(page)).find((e) => e.id === s.id).x, s.x, 'moving');
  // A palm or a system gesture: the browser cancels the pointer.
  await page.evaluate(() => document.querySelector('[data-testid="stage"]').dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 1 })));
  await page.mouse.up();
  const back = (await elements(page)).find((e) => e.id === s.id);
  assert.deepEqual([back.x, back.y], [s.x, s.y]);
  assert.equal(await state(page, (ed) => ed.history.past.length), steps);
  await context.close();
});

test('[VIEW-06] undo waits while a guide is being dragged', async () => {
  const { page, context } = await newDesign('square');
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.keyboard.press('Shift+R');
  const ruler = await page.locator('[data-testid="ruler-y"]').boundingBox();
  const to = await screenPoint(page, 300, 500);
  await page.mouse.move(ruler.x + 10, to.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.keyboard.press(`${mod}+z`);
  await page.mouse.up();
  assert.deepEqual(errors, []);
  assert.equal((await state(page, (ed) => ed.pageData.guides || [])).length, 1, 'the guide was placed');
  await context.close();
});
