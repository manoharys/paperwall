import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createDesign, createDesignFromPreset, createText, createShape, createImage, createGroup, PRESETS,
  toPx, fromPx, addAsset, pruneAssets, validateDesign, clone,
} from '../../src/model/doc.js';
import {
  addElement, moveElements, deleteElements, duplicateElements, copyElements, pasteElements, reorder,
  groupElements, ungroup, alignElements, distributeElements, flipElements, copyStyle, pasteStyle,
  addPage, duplicatePage, deletePage, movePage, resizeDesign, collectColors, applyBrand, updateElements,
  resizeElement, moveToIndex,
} from '../../src/model/commands.js';
import { History } from '../../src/model/history.js';
import { boundsOf } from '../../src/model/geometry.js';

function design() {
  const doc = createDesign({ width: 1000, height: 800 });
  return doc;
}

function rect(props) {
  return createShape('rect', { w: 100, h: 100, ...props });
}

test('[DOC-01] every size preset makes a design of that size', () => {
  assert.ok(PRESETS.length >= 9);
  for (const p of PRESETS) {
    const d = createDesignFromPreset(p.id);
    assert.equal(d.width, p.w);
    assert.equal(d.height, p.h);
    assert.equal(d.pages.length, 1);
  }
  assert.throws(() => createDesignFromPreset('nope'), /Unknown size preset/);
});

test('[DOC-02] custom sizes are rounded and bounded', () => {
  const d = createDesign({ width: 640.4, height: 480.6 });
  assert.equal(d.width, 640);
  assert.equal(d.height, 481);
  assert.throws(() => createDesign({ width: 0, height: 10 }), /above zero/);
  assert.throws(() => createDesign({ width: 30000, height: 10 }), /at most/);
});

test('[DOC-11] millimetres and inches convert at 300 DPI', () => {
  assert.equal(toPx(210, 'mm'), 2480);
  assert.equal(toPx(297, 'mm'), 3508);
  assert.equal(toPx(8.5, 'in'), 2550);
  assert.equal(fromPx(2480, 'mm'), 210);
  assert.equal(fromPx(3300, 'in'), 11);
});

test('[DOC-09] a saved design survives a round trip through JSON', () => {
  const doc = design();
  addElement(doc, 0, createText({ text: 'Hello' }));
  const back = validateDesign(JSON.parse(JSON.stringify(doc)));
  assert.equal(back.pages[0].elements[0].text, 'Hello');
  assert.throws(() => validateDesign({ version: 99 }), /Unsupported/);
  assert.throws(() => validateDesign(null), /not a Paperwall design/);
});

test('[SEL-05] moving skips locked elements', () => {
  const doc = design();
  const a = rect({ x: 10, y: 10 });
  const b = rect({ x: 10, y: 10, locked: true });
  addElement(doc, 0, a);
  addElement(doc, 0, b);
  moveElements(doc, 0, [a.id, b.id], 5, 7);
  assert.deepEqual([a.x, a.y], [15, 17]);
  assert.deepEqual([b.x, b.y], [10, 10]);
});

test('[EDIT-03] delete removes the selection but not locked elements', () => {
  const doc = design();
  const a = rect();
  const b = rect({ locked: true });
  addElement(doc, 0, a);
  addElement(doc, 0, b);
  assert.equal(deleteElements(doc, 0, [a.id, b.id]), 1);
  assert.deepEqual(doc.pages[0].elements.map((e) => e.id), [b.id]);
});

test('[EDIT-04] duplicate makes offset copies with new ids', () => {
  const doc = design();
  const a = rect({ x: 50, y: 60 });
  addElement(doc, 0, a);
  const [id] = duplicateElements(doc, 0, [a.id]);
  const copy = doc.pages[0].elements[1];
  assert.notEqual(id, a.id);
  assert.equal(copy.id, id);
  assert.deepEqual([copy.x, copy.y], [74, 84]);
});

test('[EDIT-05] copy and paste onto another page keeps the element', () => {
  const doc = design();
  addPage(doc);
  const a = createText({ text: 'Copy me' });
  addElement(doc, 0, a);
  const clip = copyElements(doc, 0, [a.id]);
  const [id] = pasteElements(doc, 1, clip);
  assert.equal(doc.pages[1].elements[0].text, 'Copy me');
  assert.notEqual(id, a.id);
});

test('[EDIT-09] [EDIT-10] layer order: forward, backward, front, back', () => {
  const doc = design();
  const [a, b, c] = [rect(), rect(), rect()];
  [a, b, c].forEach((e) => addElement(doc, 0, e));
  const order = () => doc.pages[0].elements.map((e) => e.id);
  reorder(doc, 0, [a.id], 'forward');
  assert.deepEqual(order(), [b.id, a.id, c.id]);
  reorder(doc, 0, [a.id], 'front');
  assert.deepEqual(order(), [b.id, c.id, a.id]);
  reorder(doc, 0, [a.id], 'back');
  assert.deepEqual(order(), [a.id, b.id, c.id]);
  reorder(doc, 0, [c.id], 'backward');
  assert.deepEqual(order(), [a.id, c.id, b.id]);
  moveToIndex(doc, 0, a.id, 2);
  assert.deepEqual(order(), [c.id, b.id, a.id]);
});

test('[EDIT-07] group and ungroup keep everything where it was', () => {
  const doc = design();
  const a = rect({ x: 100, y: 100, rotation: 30 });
  const b = createText({ x: 300, y: 200, w: 200, h: 60 });
  addElement(doc, 0, a);
  addElement(doc, 0, b);
  const before = [boundsOf(a), boundsOf(b)];
  const gid = groupElements(doc, 0, [a.id, b.id]);
  assert.ok(gid);
  assert.equal(doc.pages[0].elements.length, 1);
  const g = doc.pages[0].elements[0];
  assert.equal(g.type, 'group');
  // Rotate the group, then ungroup: children land rotated around the group center.
  g.rotation = 0;
  const ids = ungroup(doc, 0, gid);
  assert.equal(ids.length, 2);
  const after = doc.pages[0].elements.map(boundsOf);
  for (let i = 0; i < 2; i++) {
    for (const k of ['x', 'y', 'w', 'h']) assert.ok(Math.abs(after[i][k] - before[i][k]) < 0.01, `${k} moved`);
  }
});

test('[EDIT-07] ungrouping a rotated group rotates the children with it', () => {
  const doc = design();
  const a = rect({ x: 0, y: 0, w: 100, h: 100 });
  const b = rect({ x: 200, y: 0, w: 100, h: 100 });
  addElement(doc, 0, a);
  addElement(doc, 0, b);
  const gid = groupElements(doc, 0, [a.id, b.id]);
  const g = doc.pages[0].elements[0];
  g.rotation = 90;
  ungroup(doc, 0, gid);
  const [ca, cb] = doc.pages[0].elements;
  // Group center is (150, 50). Rotated 90°, a sits above b.
  assert.ok(Math.abs(ca.x + 50 - 150) < 0.01 && Math.abs(ca.y + 50 - -50) < 0.01);
  assert.ok(Math.abs(cb.x + 50 - 150) < 0.01 && Math.abs(cb.y + 50 - 150) < 0.01);
  assert.equal(ca.rotation, 90);
});

test('[EDIT-12] align a single element to the page', () => {
  const doc = design();
  const a = rect({ x: 10, y: 10, w: 100, h: 50 });
  addElement(doc, 0, a);
  alignElements(doc, 0, [a.id], 'center');
  assert.equal(a.x, 450);
  alignElements(doc, 0, [a.id], 'bottom');
  assert.equal(a.y, 750);
  alignElements(doc, 0, [a.id], 'right');
  assert.equal(a.x, 900);
  alignElements(doc, 0, [a.id], 'top');
  alignElements(doc, 0, [a.id], 'left');
  assert.deepEqual([a.x, a.y], [0, 0]);
  alignElements(doc, 0, [a.id], 'middle');
  assert.equal(a.y, 375);
});

test('[EDIT-13] align several elements to each other', () => {
  const doc = design();
  const a = rect({ x: 10, y: 10 });
  const b = rect({ x: 300, y: 200, w: 50 });
  addElement(doc, 0, a);
  addElement(doc, 0, b);
  alignElements(doc, 0, [a.id, b.id], 'right');
  assert.equal(a.x + a.w, 350);
  assert.equal(b.x + b.w, 350);
  alignElements(doc, 0, [a.id, b.id], 'top');
  assert.equal(b.y, 10);
});

test('[EDIT-14] distribute spaces elements evenly', () => {
  const doc = design();
  const a = rect({ x: 0, w: 100 });
  const b = rect({ x: 130, w: 50 });
  const c = rect({ x: 500, w: 100 });
  [a, b, c].forEach((e) => addElement(doc, 0, e));
  distributeElements(doc, 0, [a.id, b.id, c.id], 'x');
  const gap1 = b.x - (a.x + a.w);
  const gap2 = c.x - (b.x + b.w);
  assert.ok(Math.abs(gap1 - gap2) < 0.001);
  assert.equal(a.x, 0);
  assert.equal(c.x, 500);
});

test('[EDIT-15] flip toggles', () => {
  const doc = design();
  const a = rect();
  addElement(doc, 0, a);
  flipElements(doc, 0, [a.id], 'x');
  flipElements(doc, 0, [a.id], 'y');
  assert.equal(a.flipX, true);
  assert.equal(a.flipY, true);
  flipElements(doc, 0, [a.id], 'x');
  assert.equal(a.flipX, false);
});

test('[EDIT-17] style painter copies only what fits the target', () => {
  const doc = design();
  const t1 = createText({ font: 'Lora', size: 80, color: '#ff0000', italic: true, opacity: 0.5 });
  const t2 = createText({ text: 'keep me' });
  const s = rect({ fill: '#00ff00' });
  [t1, t2, s].forEach((e) => addElement(doc, 0, e));
  const style = copyStyle(t1);
  pasteStyle(doc, 0, [t2.id, s.id], style);
  assert.equal(t2.font, 'Lora');
  assert.equal(t2.size, 80);
  assert.equal(t2.text, 'keep me');
  assert.equal(t2.italic, true);
  assert.equal(s.fill, '#ff0000');
  assert.equal(s.opacity, 0.5);
});

test('[PAGE-01] [PAGE-02] [PAGE-03] [PAGE-04] pages: add, duplicate, delete, reorder', () => {
  const doc = design();
  const a = rect();
  addElement(doc, 0, a);
  assert.equal(addPage(doc), 1);
  assert.equal(doc.pages.length, 2);
  assert.equal(duplicatePage(doc, 0), 1);
  assert.equal(doc.pages[1].elements.length, 1);
  assert.notEqual(doc.pages[1].elements[0].id, a.id);
  const firstId = doc.pages[0].id;
  assert.equal(movePage(doc, 0, 2), 2);
  assert.equal(doc.pages[2].id, firstId);
  deletePage(doc, 2);
  deletePage(doc, 1);
  assert.throws(() => deletePage(doc, 0), /at least one page/);
});

test('[DOC-10] resizing a design keeps elements in place and unstretched', () => {
  const doc = createDesign({ width: 1080, height: 1080 });
  const title = createText({ x: 140, y: 100, w: 800, h: 120, size: 100 });
  const dot = createShape('ellipse', { x: 980, y: 980, w: 100, h: 100 });
  addElement(doc, 0, title);
  addElement(doc, 0, dot);
  const wide = resizeDesign(doc, 1920, 1080);
  assert.notEqual(wide.id, doc.id);
  assert.equal(wide.width, 1920);
  const [t, d] = wide.pages[0].elements;
  assert.equal(t.size, 100);
  assert.equal(d.w, d.h, 'circle stays a circle');
  // Centered title stays centered.
  assert.ok(Math.abs(t.x + t.w / 2 - 960) < 1);
  // The corner dot stays on the page.
  assert.ok(d.x + d.w <= 1920 && d.y + d.h <= 1080);
  // Original untouched.
  assert.equal(doc.width, 1080);
  const small = resizeDesign(doc, 540, 540);
  assert.equal(small.pages[0].elements[0].size, 50);
});

test('[EDIT-01] [EDIT-02] undo and redo restore exact states', () => {
  let doc = design();
  const h = new History();
  h.record(doc);
  const a = rect({ x: 1 });
  addElement(doc, 0, a);
  h.record(doc);
  moveElements(doc, 0, [a.id], 10, 0);
  assert.equal(doc.pages[0].elements[0].x, 11);
  doc = h.undo(doc);
  assert.equal(doc.pages[0].elements[0].x, 1);
  doc = h.undo(doc);
  assert.equal(doc.pages[0].elements.length, 0);
  assert.equal(h.canUndo, false);
  doc = h.redo(doc);
  doc = h.redo(doc);
  assert.equal(doc.pages[0].elements[0].x, 11);
  assert.equal(h.canRedo, false);
});

test('[EDIT-01] nudges in quick succession are one undo step', () => {
  let doc = design();
  const a = rect({ x: 0 });
  addElement(doc, 0, a);
  const h = new History();
  for (let i = 0; i < 5; i++) {
    h.record(doc, 'nudge', 1000 + i * 100);
    moveElements(doc, 0, [doc.pages[0].elements[0].id], 1, 0);
  }
  assert.equal(doc.pages[0].elements[0].x, 5);
  doc = h.undo(doc);
  assert.equal(doc.pages[0].elements[0].x, 0);
});

test('[EDIT-01] undo keeps images without copying them', () => {
  let doc = design();
  const h = new History();
  const id = addAsset(doc, { mime: 'image/png', dataUrl: 'data:image/png;base64,AAAA', width: 1, height: 1 });
  h.record(doc);
  addElement(doc, 0, createImage(id));
  assert.ok(!h.past[0].includes('base64'));
  doc = h.undo(doc);
  assert.ok(doc.assets[id]);
});

test('[IMG-04] adding the same image twice stores it once, and unused images are pruned', () => {
  const doc = design();
  const a = addAsset(doc, { mime: 'image/png', dataUrl: 'data:x', width: 1, height: 1 });
  const b = addAsset(doc, { mime: 'image/png', dataUrl: 'data:x', width: 1, height: 1 });
  assert.equal(a, b);
  const c = addAsset(doc, { mime: 'image/png', dataUrl: 'data:y', width: 1, height: 1 });
  addElement(doc, 0, createImage(a));
  pruneAssets(doc);
  assert.ok(doc.assets[a]);
  assert.ok(!doc.assets[c]);
});

test('[CLR-02] colors used in the design, most used first', () => {
  const doc = design();
  addElement(doc, 0, rect({ fill: '#ABCDEF' }));
  addElement(doc, 0, rect({ fill: '#abcdef' }));
  addElement(doc, 0, createText({ color: '#111111' }));
  const colors = collectColors(doc);
  assert.equal(colors[0], '#abcdef');
  assert.ok(colors.includes('#111111'));
  assert.ok(colors.includes('#ffffff'));
});

test('[BRD-03] applying a brand kit swaps colors and fonts', () => {
  const doc = design();
  const big = createText({ size: 120, color: '#222222' });
  const small = createText({ size: 30, color: '#222222' });
  const s = rect({ fill: '#6c5ce7' });
  [big, small, s].forEach((e) => addElement(doc, 0, e));
  applyBrand(doc, { colors: ['#0a9396', '#ee9b00'], headingFont: 'Playfair Display', bodyFont: 'Lora' });
  assert.equal(big.font, 'Playfair Display');
  assert.equal(small.font, 'Lora');
  const used = new Set([big.color, s.fill]);
  assert.ok(used.has('#0a9396') && used.has('#ee9b00'));
});

test('[SEL-07] resizing a group scales what is inside', () => {
  const t = createText({ x: 0, y: 0, w: 100, h: 40, size: 20 });
  const g = createGroup([t], { x: 0, y: 0, w: 100, h: 40 });
  resizeElement(g, { x: 0, y: 0, w: 200, h: 80 });
  assert.equal(g.children[0].size, 40);
  assert.equal(g.children[0].w, 200);
});

test('updateElements merges nested objects but replaces fills', () => {
  const doc = design();
  const img = createImage('a1');
  const s = rect({ fill: { type: 'linear', stops: [] } });
  addElement(doc, 0, img);
  addElement(doc, 0, s);
  updateElements(doc, 0, [img.id], { filters: { blur: 3 } });
  assert.equal(img.filters.blur, 3);
  assert.equal(img.filters.brightness, 100);
  updateElements(doc, 0, [s.id], { fill: '#ffffff' });
  assert.equal(s.fill, '#ffffff');
  assert.deepEqual(clone(s).fill, '#ffffff');
});

test('[ELM-05] [ELM-06] chart and table data parse from plain text', async () => {
  const { parseChartData, chartDataText, parseTable, tableText, createChart } = await import('../../src/model/doc.js');
  assert.deepEqual(parseChartData('Mon, 3\nTue: 4.5\nbroken line\nWed\t-2'), [
    { label: 'Mon', value: 3 }, { label: 'Tue', value: 4.5 }, { label: 'Wed', value: -2 },
  ]);
  assert.deepEqual(parseChartData(chartDataText(createChart('bar').data)), createChart('bar').data);
  assert.deepEqual(parseTable('a, b, c\nd\n\ne\tf'), [['a', 'b', 'c'], ['d', '', ''], ['e', 'f', '']]);
  assert.equal(tableText([['x', 'y']]), 'x, y');
});

test('[IMG-13] plain backgrounds are removed; the subject and enclosed areas stay', async () => {
  const { removePlainBackground, edgeColor } = await import('../../src/model/bgremove.js');
  const w = 20;
  const h = 20;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let p = 0; p < w * h; p++) {
    const x = p % w;
    const y = (p / w) | 0;
    const ring = x >= 5 && x < 15 && y >= 5 && y < 15 && !(x >= 8 && x < 12 && y >= 8 && y < 12);
    const c = ring ? [200, 20, 20] : [250, 250, 248];
    data.set([...c, 255], p * 4);
  }
  assert.deepEqual(edgeColor(data, w, h).map(Math.round), [250, 250, 248]);
  const cleared = removePlainBackground(data, w, h);
  const alpha = (x, y) => data[(y * w + x) * 4 + 3];
  assert.equal(alpha(0, 0), 0);
  assert.equal(alpha(19, 10), 0);
  assert.equal(alpha(6, 6), 255, 'the subject stays');
  assert.equal(alpha(10, 10), 255, 'a white area inside the subject is not background');
  assert.equal(cleared, 20 * 20 - 10 * 10);
});

test('[EDIT-19] find and replace across pages, groups, tables and charts', async () => {
  const { findText, replaceText } = await import('../../src/model/find.js');
  const { createDesign, createText, createTable, createChart, createGroup, createPage } = await import('../../src/model/doc.js');
  const doc = createDesign({ width: 500, height: 500 });
  doc.pages.push(createPage());
  doc.pages[0].elements.push(createText({ text: 'Summer sale: summer prices' }), createTable({ rows: [['Item', 'Summer'], ['Hat', '5']] }));
  doc.pages[1].elements.push(createGroup([createText({ text: 'Last summer' }), createText({ text: 'Summertime' })]), createChart('bar', { data: [{ label: 'summer', value: 3 }] }));
  const hits = findText(doc, 'summer');
  assert.deepEqual(hits.map((h) => [h.page, h.count]), [[0, 2], [0, 1], [1, 2], [1, 1]]);
  assert.equal(findText(doc, 'summer', { matchCase: true }).reduce((s, h) => s + h.count, 0), 3);
  assert.equal(findText(doc, 'summer', { wholeWord: true }).reduce((s, h) => s + h.count, 0), 5, 'not "Summertime"');
  const r = replaceText(doc, 'summer', 'Winter $5', { wholeWord: true });
  assert.equal(r.count, 5);
  assert.equal(doc.pages[0].elements[0].text, 'Winter $5 sale: Winter $5 prices');
  assert.equal(doc.pages[1].elements[0].children[1].text, 'Summertime');
  assert.deepEqual(findText(doc, ''), []);
  assert.deepEqual(findText(doc, 'a.b'), [], 'the query is plain text, not a pattern');
});
