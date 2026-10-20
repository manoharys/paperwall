import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDesign, createText, createShape, createLine, createImage, createIcon, createSticker, createQr, addAsset } from '../../src/model/doc.js';
import { addElement, setBackground } from '../../src/model/commands.js';
import { renderPage, esc } from '../../src/model/render.js';
import { layoutText, fitHeight, approxMeasure } from '../../src/model/text-layout.js';
import { shapePath } from '../../src/model/shapes.js';
import { qrMatrix, pickVersion } from '../../src/model/qr.js';
import { ICONS, ALL_ICONS, ALL_STICKERS, searchGraphics } from '../../src/model/graphics.js';
import { buildPdf } from '../../src/model/pdf.js';
import { resizeBox, rotatePoint, snapMove, angleTo, snapAngle, pointInBox } from '../../src/model/geometry.js';

const fixed = (text, el) => [...text].length * el.size * 0.5;

test('[TXT-03] text wraps at word boundaries inside its box', () => {
  const el = createText({ text: 'one two three four', size: 10, w: 48 });
  const { lines } = layoutText(el, fixed);
  assert.deepEqual(lines.map((l) => l.text), ['one two', 'three', 'four']);
  for (const l of lines) assert.ok(l.width <= 48);
});

test('[TXT-03] very long words break across lines', () => {
  const el = createText({ text: 'abcdefghijklmnop', size: 10, w: 30 });
  const { lines } = layoutText(el, fixed);
  assert.deepEqual(lines.map((l) => l.text), ['abcdef', 'ghijkl', 'mnop']);
});

test('[TXT-12] all caps changes what is shown, not what is stored', () => {
  const el = createText({ text: 'quiet', caps: true, size: 10, w: 500 });
  assert.equal(layoutText(el, fixed).lines[0].text, 'QUIET');
  assert.equal(el.text, 'quiet');
});

test('[TXT-13] bullets and numbers with hanging indents', () => {
  const el = createText({ text: 'first\nsecond item here\n\nthird', list: 'number', size: 10, w: 90 });
  const { lines } = layoutText(el, fixed);
  assert.equal(lines[0].prefix, '1.  ');
  assert.equal(lines[1].prefix, '2.  ');
  const wrapped = lines.find((l) => l.text === 'here');
  assert.ok(wrapped && wrapped.prefix === '' && wrapped.indent > 0);
  assert.equal(lines.find((l) => l.text === 'third').prefix, '3.  ');
});

test('[TXT-18] text box height grows with its text', () => {
  const short = createText({ text: 'hi', size: 20, w: 200, lineHeight: 1.5 });
  const long = createText({ text: 'hi '.repeat(40), size: 20, w: 200, lineHeight: 1.5 });
  assert.equal(fitHeight(short, fixed), 30);
  assert.ok(fitHeight(long, fixed) > 100);
});

test('[TXT-11] letter spacing widens lines', () => {
  const a = createText({ text: 'spacing', size: 10, w: 1000 });
  const b = { ...a, letterSpacing: 5 };
  assert.equal(layoutText(b, fixed).lines[0].width - layoutText(a, fixed).lines[0].width, 35);
});

test('[SHP-01] [SHP-02] every shape has a closed path', () => {
  for (const shape of ['rect', 'ellipse', 'triangle', 'star', 'polygon', 'heart', 'arrow', 'bubble', 'diamond']) {
    const d = shapePath(createShape(shape, { w: 120, h: 80 }));
    assert.match(d, /^M/);
    assert.match(d, /Z$/);
    assert.ok(!d.includes('NaN'), shape);
  }
});

test('[SHP-08] stars and polygons follow their point count', () => {
  const pts = (d) => d.split(/[ML]/).filter((s) => s.trim()).length;
  assert.equal(pts(shapePath(createShape('polygon', { sides: 8 }))), 8);
  assert.equal(pts(shapePath(createShape('star', { sides: 7 }))), 14);
});

test('[SHP-06] rounded corners are clamped to the box', () => {
  const d = shapePath(createShape('rect', { w: 100, h: 40, radius: 500 }));
  assert.match(d, /A20 20/);
});

test('render: a page with every element type is valid, escaped SVG', () => {
  const doc = createDesign({ width: 800, height: 600 });
  const asset = addAsset(doc, { mime: 'image/png', dataUrl: 'data:image/png;base64,iVBOR', width: 10, height: 10 });
  addElement(doc, 0, createText({ text: 'Tom & Jerry <3 "quotes"', outline: { width: 2, color: '#fff' }, highlight: { color: '#ff0', padding: 4 }, underline: true, strike: true, shadow: { x: 2, y: 2, blur: 4, color: '#000', opacity: 0.4 } }));
  addElement(doc, 0, createShape('star', { fill: { type: 'linear', angle: 90, stops: [{ offset: 0, color: '#f00' }, { offset: 1, color: '#00f' }] }, stroke: '#000', strokeWidth: 3, dash: 'dashed' }));
  addElement(doc, 0, createLine({ endCap: 'arrow', startCap: 'arrow' }));
  addElement(doc, 0, createImage(asset, { mask: 'circle', filters: { brightness: 120, contrast: 90, saturation: 50, grayscale: 0, sepia: 30, blur: 2 } }));
  addElement(doc, 0, createIcon('heart', { color: '#e11d48' }));
  addElement(doc, 0, createSticker('burst'));
  addElement(doc, 0, createQr('https://example.com'));
  addElement(doc, 0, createText({ text: 'curved', curve: 60 }));
  addElement(doc, 0, createText({ text: 'hidden', hidden: true }));
  setBackground(doc, 0, { type: 'gradient', gradient: { type: 'radial', stops: [{ offset: 0, color: '#fff' }, { offset: 1, color: '#000' }] } });
  const svg = renderPage(doc, 0, { measure: approxMeasure, editor: true });
  assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
  assert.ok(svg.includes('Tom &amp; Jerry &lt;3 &quot;quotes&quot;'));
  assert.ok(!svg.includes('hidden<'), 'hidden elements are not drawn');
  assert.ok(!svg.includes('NaN') && !svg.includes('undefined') && !svg.includes('null'));
  assert.equal((svg.match(/data-id=/g) || []).length, 8);
  for (const tag of ['linearGradient', 'radialGradient', 'feDropShadow', 'clipPath', 'textPath', 'feGaussianBlur', 'stroke-dasharray']) {
    assert.ok(svg.includes(tag), tag);
  }
  // Balanced tags.
  const opens = (svg.match(/<g[ >]/g) || []).length;
  const closes = (svg.match(/<\/g>/g) || []).length;
  assert.equal(opens, closes);
});

test('[EXP-03] transparent render leaves out the background', () => {
  const doc = createDesign({ width: 100, height: 100 });
  setBackground(doc, 0, { type: 'color', color: '#123456' });
  assert.ok(renderPage(doc, 0).includes('#123456'));
  assert.ok(!renderPage(doc, 0, { transparent: true }).includes('#123456'));
});

test('[EXP-09] exports never carry a watermark', () => {
  const doc = createDesign({ width: 100, height: 100 });
  const svg = renderPage(doc, 0);
  assert.ok(!/paperwall/i.test(svg));
});

test('esc escapes markup', () => {
  assert.equal(esc('<a href="x">&</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
});

test('[ELM-04] QR codes match a reference encoder module for module', () => {
  const golden = JSON.parse(readFileSync(new URL('../fixtures/qr-golden.json', import.meta.url)));
  for (const g of golden) {
    const m = qrMatrix(g.text, { version: g.version, mask: g.mask });
    assert.deepEqual(m.map((r) => r.map((c) => (c ? '1' : '0')).join('')), g.rows, g.text);
  }
  assert.equal(pickVersion(14), 1);
  assert.equal(pickVersion(213), 10);
  assert.throws(() => pickVersion(214), /too long/);
  // Automatic mask choice still produces a full-size matrix.
  assert.equal(qrMatrix('auto mask').length, 21);
});

test('[ELM-01] [ELM-02] [ELM-03] icon and sticker library is searchable and well-formed', () => {
  assert.ok(ICONS.length >= 60, `${ICONS.length} of our own icons`);
  assert.ok(ALL_ICONS.length >= 1500, `${ALL_ICONS.length} icons in all`);
  assert.ok(ALL_STICKERS.length >= 150, `${ALL_STICKERS.length} stickers`);
  const ids = new Set([...ALL_ICONS, ...ALL_STICKERS].map((g) => g.id));
  assert.equal(ids.size, ALL_ICONS.length + ALL_STICKERS.length, 'unique ids');
  for (const i of ALL_ICONS) assert.ok(!/(fill|stroke)="#/.test(i.body), `${i.id} must take the element color`);
  for (const s of ALL_STICKERS) assert.ok(!/NaN|undefined/.test(s.svg), s.id);
  assert.ok(searchGraphics('birthday').icons.some((i) => i.id === 'cake'));
  assert.ok(searchGraphics('sale').stickers.some((s) => s.id === 'burst'));
  const cart = searchGraphics('shopping cart');
  assert.ok(cart.icons.some((i) => i.id === 'lu-shopping-cart'), 'multi-word search across Lucide');
  assert.equal(searchGraphics('', { limit: 10 }).icons.length, 10);
  assert.equal(searchGraphics('', { limit: 10 }).icons[0].source, 'paperwall', 'our own icons come first');
});

test('[EXP-06] PDF writer produces a well-formed file with a correct cross-reference table', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);
  const pdf = buildPdf([
    { jpeg, pxWidth: 2, pxHeight: 2, ptWidth: 200, ptHeight: 100 },
    { jpeg, pxWidth: 2, pxHeight: 2, ptWidth: 200, ptHeight: 100 },
  ]);
  const text = Buffer.from(pdf).toString('latin1');
  assert.ok(text.startsWith('%PDF-1.4'));
  assert.ok(text.trimEnd().endsWith('%%EOF'));
  assert.match(text, /\/Count 2/);
  const startxref = Number(text.match(/startxref\n(\d+)/)[1]);
  assert.ok(text.slice(startxref).startsWith('xref'));
  const entries = [...text.slice(startxref).matchAll(/(\d{10}) 00000 n/g)].map((m) => Number(m[1]));
  entries.forEach((off, i) => assert.ok(text.slice(off).startsWith(`${i + 1} 0 obj`), `object ${i + 1}`));
});

test('[SEL-07] [SEL-08] resizing from a corner keeps the opposite corner fixed, even rotated', () => {
  const start = { x: 100, y: 100, w: 200, h: 100, rotation: 0 };
  const r = resizeBox(start, 'se', 50, 20);
  assert.deepEqual([r.x, r.y, r.w, r.h], [100, 100, 250, 120]);
  const k = resizeBox(start, 'se', 100, 0, { keepRatio: true });
  assert.equal(k.w / k.h, 2);
  const rot = { x: 100, y: 100, w: 200, h: 100, rotation: 90 };
  const before = rotatePoint(100, 100, 200, 150, 90); // the nw corner, rotated
  const after = resizeBox(rot, 'se', 0, 60);
  const c = { x: after.x + after.w / 2, y: after.y + after.h / 2 };
  const nw = rotatePoint(after.x, after.y, c.x, c.y, 90);
  assert.ok(Math.abs(nw.x - before.x) < 0.001 && Math.abs(nw.y - before.y) < 0.001);
  assert.equal(after.w, 260);
});

test('[SEL-09] rotation angle and 15 degree snapping', () => {
  const b = { x: 0, y: 0, w: 100, h: 100 };
  assert.equal(angleTo(b, 50, -100), 0);
  assert.equal(angleTo(b, 200, 50), 90);
  assert.equal(snapAngle(52), 45);
  assert.equal(snapAngle(-7), 0);
  assert.ok(pointInBox(50, 0, { ...b, rotation: 45 }) === true);
  assert.ok(pointInBox(0, 0, { ...b, rotation: 45 }) === false);
});

test('[SEL-11] [SEL-12] snapping to the page center and to other elements', () => {
  const page = { w: 1000, h: 800 };
  const s = snapMove({ x: 447, y: 100, w: 100, h: 50 }, [], page);
  assert.equal(s.dx, 3);
  assert.deepEqual(s.guides, [{ axis: 'x', pos: 500 }]);
  const o = snapMove({ x: 0, y: 203, w: 10, h: 10 }, [{ x: 300, y: 200, w: 50, h: 50 }], page);
  assert.equal(o.dy, -3);
  assert.equal(snapMove({ x: 100, y: 100, w: 10, h: 10 }, [], page, 6).guides.length, 0);
});

test('[EXP-12] PDF text layer: selectable text, placed on the page, Latin-1 safe', async () => {
  const { textRuns } = await import('../../src/model/render.js');
  const doc = createDesign({ width: 1000, height: 500 });
  addElement(doc, 0, createText({ text: 'Café menu (today)', x: 100, y: 50, w: 800, size: 40, align: 'center' }));
  const runs = textRuns(doc, 0, fixed);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].text, 'Café menu (today)');
  assert.ok(Math.abs(runs[0].x + runs[0].width / 2 - 500) < 0.01, 'centered like the picture');
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const pdf = buildPdf([{ jpeg, pxWidth: 1, pxHeight: 1, ptWidth: 750, ptHeight: 375, text: runs }]);
  const text = Buffer.from(pdf).toString('latin1');
  assert.match(text, /\/BaseFont \/Helvetica/);
  assert.ok(text.includes('(Caf\xe9 menu \\(today\\)) Tj'), 'escaped and single-byte');
  assert.match(text, /BT 3 Tr/, 'invisible over the picture');
  const startxref = Number(text.match(/startxref\n(\d+)/)[1]);
  const entries = [...text.slice(startxref).matchAll(/(\d{10}) 00000 n/g)].map((m) => Number(m[1]));
  entries.forEach((off, i) => assert.ok(text.slice(off).startsWith(`${i + 1} 0 obj`)));
});

test('[ELM-05] [ELM-06] charts and tables render as valid SVG', async () => {
  const { createChart, createTable } = await import('../../src/model/doc.js');
  const doc = createDesign({ width: 800, height: 800 });
  for (const t of ['bar', 'line', 'pie', 'donut']) addElement(doc, 0, createChart(t, { data: [{ label: 'A', value: 5 }, { label: 'B', value: 0 }, { label: 'C & D', value: 10 }] }));
  addElement(doc, 0, createChart('bar', { data: [{ label: 'Up', value: 4 }, { label: 'Down', value: -3 }] }));
  addElement(doc, 0, createTable({ rows: [['Name', 'Note'], ['A very long cell that will not fit', '<b>']] }));
  const svg = renderPage(doc, 0, { measure: fixed });
  assert.ok(!svg.includes('NaN') && !svg.includes('undefined'));
  assert.ok(svg.includes('C &amp; D'));
  assert.ok(svg.includes('&lt;b&gt;'));
  assert.ok(svg.includes('…'), 'long cells are shortened to fit');
  assert.equal((svg.match(/<g /g) || []).length, (svg.match(/<\/g>/g) || []).length);
});

test('a hostile design file cannot inject markup into the page', async () => {
  const { validateDesign } = await import('../../src/model/doc.js');
  const evil = '"><img src=x onerror=alert(1)>';
  const doc = createDesign({ width: 400, height: 400 });
  const t = createText({ text: evil, font: evil, color: evil, weight: evil, size: evil });
  const s = createShape('rect', { fill: evil, stroke: evil, strokeWidth: 3, x: evil });
  doc.pages[0].elements.push(t, s, { ...createIcon('heart'), type: evil });
  doc.pages[0].background = { type: 'color', color: evil };
  doc.assets.bad = { type: 'image', dataUrl: 'javascript:alert(1)' };
  const parsed = validateDesign(JSON.parse(JSON.stringify(doc)));
  assert.ok(!parsed.assets.bad, 'non-data URLs are dropped');
  const svg = renderPage(parsed, 0, { measure: fixed, editor: true });
  assert.ok(!svg.includes('<img'), 'no raw tags');
  assert.ok(!/onerror=/.test(svg.replace(/&quot;&gt;&lt;img src=x onerror=alert\(1\)&gt;/g, '')), 'only escaped copies remain');
});

test('[ELM-07] icon parts drawn in currentColor follow the icon color', () => {
  const doc = createDesign({ width: 200, height: 200 });
  const filled = ALL_ICONS.find((i) => i.body.includes('currentColor'));
  assert.ok(filled, 'some icons use currentColor');
  addElement(doc, 0, createIcon(filled.id, { x: 0, y: 0, w: 100, h: 100, color: '#ff006e' }));
  assert.match(renderPage(doc, 0, { measure: approxMeasure }), /<g [^>]*color="#ff006e"[^>]*stroke="#ff006e"/);
});

test('[IMG-14] frames clip photos to their shape and show a placeholder when empty', async () => {
  const { createFrame, FRAME_MASKS } = await import('../../src/model/doc.js');
  const { maskPath } = await import('../../src/model/shapes.js');
  for (const mask of FRAME_MASKS) {
    const d = maskPath({ w: 200, h: 300, mask, radius: 20 });
    assert.match(d, /^M[\d.\s-]/, mask);
    assert.match(d, /Z$/, mask);
    assert.ok(!/NaN|undefined/.test(d), mask);
  }
  const doc = createDesign({ width: 400, height: 400 });
  addElement(doc, 0, createFrame('heart', { x: 0, y: 0, w: 200, h: 200 }));
  const svg = renderPage(doc, 0, { measure: approxMeasure, editor: true });
  assert.match(svg, /fill="#dcdce6"/, 'empty frames draw a placeholder while editing');
  assert.ok(!svg.includes('<image'), 'and no picture');
  assert.ok(!renderPage(doc, 0, { measure: approxMeasure }).includes('#dcdce6'), 'but not in downloads');
});

test('[IMG-15] grid cells tile the page with even gaps', async () => {
  const { GRIDS, gridBoxes } = await import('../../src/model/grids.js');
  assert.ok(GRIDS.length >= 10);
  for (const g of GRIDS) {
    const boxes = gridBoxes(g, 1000, 800, { margin: 40, gap: 20 });
    assert.equal(boxes.length, g.cells.length);
    const area = boxes.reduce((s, b) => s + b.w * b.h, 0);
    assert.ok(area > 0.85 * 920 * 720 && area <= 920 * 720, `${g.id} covers the area inside the margin`);
    for (const b of boxes) assert.ok(b.x >= 40 && b.y >= 40 && b.x + b.w <= 960 && b.y + b.h <= 760, `${g.id} stays inside the margin`);
  }
});

test('[TXT-22] text effects draw the right layers', async () => {
  const { TEXT_EFFECTS } = await import('../../src/model/render.js');
  const svgFor = (effect) => {
    const doc = createDesign({ width: 600, height: 300 });
    addElement(doc, 0, createText({ text: 'Hello', x: 0, y: 0, w: 600, size: 80, color: '#123456', effect }));
    return renderPage(doc, 0, { measure: approxMeasure });
  };
  const texts = (svg) => (svg.match(/<text /g) || []).length;
  assert.equal(texts(svgFor(null)), 1);
  assert.match(svgFor({ type: 'hollow' }), /<text [^>]*fill="none" stroke="#123456"/);
  assert.equal(texts(svgFor({ type: 'splice', color: '#ff0000' })), 2);
  assert.equal(texts(svgFor({ type: 'echo' })), 3);
  assert.equal(texts(svgFor({ type: 'glitch' })), 3);
  assert.match(svgFor({ type: 'glow' }), /<feGaussianBlur/);
  assert.match(svgFor({ type: 'neon', color: '#ff2d95' }), /fill="#ffb0d5"|fill="#ff[0-9a-f]{4}"/);
  assert.match(svgFor({ type: 'lift' }), /<feDropShadow/);
  for (const type of TEXT_EFFECTS) assert.ok(!/NaN|undefined/.test(svgFor({ type })), type);
});

test('[TXT-23] text combinations use bundled fonts and stack without overlapping', async () => {
  const { TEXT_COMBOS, comboGroup } = await import('../../src/model/text-combos.js');
  const { fontByName } = await import('../../src/model/fonts.js');
  assert.ok(TEXT_COMBOS.length >= 12);
  for (const c of TEXT_COMBOS) {
    const g = comboGroup(c, approxMeasure, { cx: 500, cy: 500 });
    assert.equal(g.type, 'group');
    assert.equal(g.children.length, c.items.length);
    let bottom = -1;
    for (const el of g.children) {
      if (el.type === 'text') assert.ok(fontByName(el.font), `${c.id}: ${el.font}`);
      assert.ok(el.y >= bottom - 0.5, `${c.id}: stacked`);
      bottom = el.y + el.h;
      assert.ok(!('flow' in el) && !('fit' in el));
    }
    assert.ok(Math.abs(g.x + g.w / 2 - 500) <= 1 && Math.abs(g.y + g.h / 2 - 500) <= 1, `${c.id}: centered`);
  }
});

test('[ELM-09] drawings keep their shape when resized', async () => {
  const { createDrawing, thinPoints } = await import('../../src/model/doc.js');
  const { scaleElement } = await import('../../src/model/commands.js');
  const pts = thinPoints([[100, 100], [100.5, 100.2], [150, 120], [200, 200], [300, 150]], 2);
  assert.equal(pts.length, 4, 'near-duplicate points are dropped');
  const d = createDrawing(pts, { tool: 'marker', stroke: '#ff006e' });
  assert.equal(d.strokeWidth, 18);
  assert.deepEqual([d.x, d.y, d.w, d.h], [91, 91, 218, 118]);
  assert.ok(d.points.every(([x, y]) => x >= 0 && x <= 1 && y >= 0 && y <= 1));
  const doc = createDesign({ width: 600, height: 400 });
  addElement(doc, 0, d);
  const before = renderPage(doc, 0, { measure: approxMeasure }).match(/<path d="([^"]+)" fill="none" stroke="#ff006e"/)[1];
  scaleElement(d, 2, 2);
  assert.equal(d.strokeWidth, 36);
  const after2 = renderPage(doc, 0, { measure: approxMeasure }).match(/<path d="([^"]+)" fill="none" stroke="#ff006e"/)[1];
  assert.notEqual(before, after2);
  assert.equal(after2.split(' ').length, before.split(' ').length, 'same points, twice the size');
});

test('[ELM-10] connectors attach to elements and follow them', async () => {
  const { createConnector, updateConnectors, endsOf, connectorGeometry } = await import('../../src/model/connectors.js');
  const doc = createDesign({ width: 1000, height: 1000 });
  const a = createShape('rect', { x: 100, y: 100, w: 200, h: 100 });
  const b = createShape('rect', { x: 600, y: 400, w: 200, h: 100 });
  const c = createConnector({ from: [0, 0], to: [1, 1], start: a.id, end: b.id, route: 'elbow' });
  doc.pages[0].elements.push(c, a, b);
  assert.ok(updateConnectors(doc.pages[0]));
  let [s, e] = endsOf(c);
  assert.deepEqual(s.map(Math.round), [300, 150], 'leaves a from its right side');
  assert.deepEqual(e.map(Math.round), [600, 450], 'enters b from its left side');
  const { pts } = connectorGeometry(c);
  assert.equal(pts.length, 4);
  assert.ok(pts[0][1] === pts[1][1] && pts[1][0] === pts[2][0] && pts[2][1] === pts[3][1], 'elbow goes across, down, across');
  // Move b below a: the ends switch to the facing sides.
  Object.assign(b, { x: 100, y: 700 });
  updateConnectors(doc.pages[0]);
  [s, e] = endsOf(c);
  assert.deepEqual(s.map(Math.round), [200, 200], 'bottom of a');
  assert.deepEqual(e.map(Math.round), [200, 700], 'top of b');
  // Delete b: that end stays where it was, now free.
  doc.pages[0].elements = doc.pages[0].elements.filter((x) => x !== b);
  updateConnectors(doc.pages[0]);
  assert.equal(c.end.id, null);
  const svg = renderPage(doc, 0, { measure: approxMeasure });
  assert.ok(!/NaN|undefined/.test(svg));
  for (const route of ['straight', 'curved']) {
    c.route = route;
    assert.ok(!/NaN/.test(connectorGeometry(c).d), route);
  }
});

test('[ELM-10] connectors are clicked on their line, and can attach inside groups', async () => {
  const { createConnector, connectorHit, updateConnectors, endsOf } = await import('../../src/model/connectors.js');
  const c = createConnector({ from: [100, 100], to: [900, 900] });
  assert.ok(connectorHit(c, { x: 500, y: 500 }, 5), 'on the line');
  assert.ok(!connectorHit(c, { x: 800, y: 200 }, 5), 'inside the box but far from the line');
  c.route = 'elbow';
  assert.ok(connectorHit(c, { x: 500, y: 700 }, 5), 'on the elbow');
  c.route = 'curved';
  assert.ok(!connectorHit(c, { x: 850, y: 150 }, 5));
  // An end attached to a shape that gets grouped follows the group.
  const page = { elements: [] };
  const a = createShape('rect', { x: 0, y: 0, w: 100, h: 100 });
  const b = createShape('rect', { x: 600, y: 0, w: 100, h: 100 });
  const k = createConnector({ from: [0, 0], to: [1, 1], start: a.id, end: b.id });
  page.elements.push({ id: 'g1', type: 'group', x: 0, y: 0, w: 100, h: 100, rotation: 0, children: [{ ...a, x: 0, y: 0 }] }, b, k);
  updateConnectors(page);
  assert.equal(k.start.id, a.id, 'still attached');
  page.elements[0].y = 300;
  updateConnectors(page);
  assert.ok(endsOf(k)[0][1] > 300, 'follows the group');
});

test('[ELM-10] a rotated or flipped connector is straightened where it is drawn', async () => {
  const { createConnector, updateConnectors, endsOf } = await import('../../src/model/connectors.js');
  const c = createConnector({ from: [100, 100], to: [300, 100] });
  c.flipX = true;
  updateConnectors({ elements: [c] });
  assert.equal(c.flipX, false);
  assert.deepEqual(endsOf(c).map((p) => p.map(Math.round)), [[300, 100], [100, 100]], 'ends swapped by the flip');
  c.rotation = 90;
  updateConnectors({ elements: [c] });
  assert.equal(c.rotation, 0);
  const near = (p, q) => Math.abs(p[0] - q[0]) <= 1.5 && Math.abs(p[1] - q[1]) <= 1.5;
  const [r0, r1] = endsOf(c);
  assert.ok(near(r0, [200, 200]) && near(r1, [200, 0]), `turned a quarter: ${r0} ${r1}`);
  // Inside a plain group, a connector follows a target in the same group.
  const a = createShape('rect', { x: 0, y: 0, w: 50, h: 50 });
  const b = createShape('rect', { x: 400, y: 0, w: 50, h: 50 });
  const k = createConnector({ from: [0, 0], to: [1, 1], start: a.id, end: b.id });
  const g = { id: 'g', type: 'group', x: 100, y: 100, w: 450, h: 50, rotation: 0, children: [a, k] };
  updateConnectors({ elements: [g, b] });
  const [s, e] = endsOf(k);
  // The group's box grows to hold the re-routed connector, so read positions through it.
  assert.deepEqual([s[0] + g.x, s[1] + g.y].map(Math.round), [150, 125], 'starts on a, in page terms');
  assert.deepEqual([e[0] + g.x, e[1] + g.y].map(Math.round), [400, 25], 'ends on b outside the group');
  const right = Math.max(...g.children.map((c) => c.x + c.w));
  assert.ok(right <= g.w + 0.5, 'the group still wraps its children');
});

test('[ELM-09] drawings are picked near their stroke, not anywhere in their box', async () => {
  const { createDrawing } = await import('../../src/model/doc.js');
  const { drawHit } = await import('../../src/model/shapes.js');
  const d = createDrawing([[0, 0], [400, 0], [400, 400]], { tool: 'pen' });
  assert.ok(drawHit(d, { x: 200, y: 2 }, 6));
  assert.ok(drawHit(d, { x: 398, y: 300 }, 6));
  assert.ok(!drawHit(d, { x: 100, y: 300 }, 6), 'inside the box, far from the stroke');
});

test('[TXT-22] underlines follow text effects', () => {
  const doc = createDesign({ width: 600, height: 300 });
  addElement(doc, 0, createText({ text: 'Hello', w: 600, size: 80, color: '#123456', underline: true, effect: { type: 'hollow' } }));
  const svg = renderPage(doc, 0, { measure: approxMeasure });
  assert.match(svg, /<rect [^>]*fill="none" stroke="#123456"/, 'a hollow underline');
});

test('[ELM-09] a thicker drawing line grows its box', async () => {
  const { createDrawing, restroke } = await import('../../src/model/doc.js');
  const d = createDrawing([[100, 100], [300, 100]], { strokeWidth: 6 });
  const r = restroke(d, 40);
  assert.equal(r.strokeWidth, 40);
  assert.deepEqual([r.x, r.y, r.w, r.h].map((n) => Math.round(n)), [80, 80, 240, 40]);
});

test('[ELM-09] pasting a thicker line style onto a drawing grows its box too', async () => {
  const { createDrawing, createDesign } = await import('../../src/model/doc.js');
  const { copyStyle, pasteStyle } = await import('../../src/model/commands.js');
  const doc = createDesign({ width: 1000, height: 1000 });
  const thin = createDrawing([[100, 100], [300, 100]], { strokeWidth: 6 });
  const thick = createDrawing([[500, 500], [600, 500]], { strokeWidth: 40 });
  doc.pages[0].elements = [thin, thick];
  pasteStyle(doc, 0, [thin.id], copyStyle(thick));
  assert.equal(thin.strokeWidth, 40);
  assert.deepEqual([thin.x, thin.y, thin.w, thin.h].map((n) => Math.round(n)), [80, 80, 240, 40]);
});

test('[ELM-10] an elbow with a short first or last leg never runs backwards under its arrow', async () => {
  const { createConnector, connectorGeometry } = await import('../../src/model/connectors.js');
  const el = createConnector({ from: [0, 0], to: [10, 200], route: 'elbow', strokeWidth: 6 });
  el.start.side = 'r';
  const g = connectorGeometry(el, { start: 0, end: 15.4 });
  const xs = g.pts.map(([x]) => x);
  assert.ok(xs.every((x, i) => i === 0 || x >= xs[i - 1]), `heads right all the way: ${g.d}`);
  assert.ok(xs.at(-1) <= 10);
});

test('[ELM-10] a trimmed elbow keeps its bend where the untrimmed line has it', async () => {
  const { createConnector, connectorGeometry } = await import('../../src/model/connectors.js');
  const el = createConnector({ from: [0, 0], to: [100, 40], route: 'elbow', strokeWidth: 20 });
  const plain = connectorGeometry(el);
  const trimmed = connectorGeometry(el, { start: 0, end: 25 });
  assert.equal(trimmed.pts[1][0], plain.pts[1][0], 'the middle leg stays put');
});

test('[ELM-10] a loose end runs the way the line goes, not the side it once left from', async () => {
  const { createConnector, connectorGeometry } = await import('../../src/model/connectors.js');
  const el = createConnector({ from: [0, 0], to: [10, 200], route: 'elbow' });
  el.start = { id: null, side: 'r' };
  const g = connectorGeometry(el);
  assert.equal(g.endDir[0], 0, 'the end arrow points down');
  assert.ok(g.endDir[1] > 0);
});

test('[ELM-10] an elbow into an attached end comes in through that end\'s side', async () => {
  const { createConnector, updateConnectors, connectorGeometry } = await import('../../src/model/connectors.js');
  const { createShape } = await import('../../src/model/doc.js');
  const box = createShape('rect', { x: 10, y: 80, w: 180, h: 20 });
  const c = createConnector({ from: [0, 0], to: [10, 90], end: box.id, route: 'elbow' });
  updateConnectors({ elements: [box, c] });
  assert.equal(c.end.side, 'l');
  const g = connectorGeometry(c);
  assert.equal(g.endDir[1], 0, 'the arrow points into the left side');
  assert.ok(g.endDir[0] > 0);
});

test('[ELM-10] a route folded flat points its arrows straight along the line', async () => {
  const { createConnector, connectorGeometry } = await import('../../src/model/connectors.js');
  const c = createConnector({ from: [200, 50], to: [200, 200], route: 'elbow' });
  c.start = { id: 'a', side: 'r' };
  c.end = { id: 'b', side: 'l' };
  const g = connectorGeometry(c);
  assert.equal(g.endDir[0], 0);
  assert.ok(g.endDir[1] > 0);
});

test('[ELM-10] an end on a turned shape sits on its turned side', async () => {
  const { anchorOn } = await import('../../src/model/connectors.js');
  const box = { x: 0, y: 0, w: 200, h: 100, rotation: 30 };
  const { point, side } = anchorOn(box, [1000, 50 + 1000 * Math.tan(Math.PI / 6)]);
  assert.equal(side, 'r');
  const dist = Math.hypot(point[0] - 100, point[1] - 50);
  assert.ok(Math.abs(dist - 100) < 0.01, `on the edge, half the width from the middle (${dist})`);
});

test('[ELM-10] an end attached to a group follows the group when it is refitted in the same sync', async () => {
  const { createConnector, updateConnectors, endsOf } = await import('../../src/model/connectors.js');
  const { createShape, createGroup } = await import('../../src/model/doc.js');
  const a = createShape('rect', { x: 0, y: 0, w: 100, h: 100 });
  const x = createShape('rect', { x: 0, y: 200, w: 100, h: 100 });
  const inner = createConnector({ from: [50, 100], to: [50, 200], start: a.id, end: x.id });
  const g = createGroup([a, inner]);
  const z = createShape('rect', { x: 600, y: 0, w: 100, h: 100 });
  const outer = createConnector({ from: [600, 50], to: [100, 50], start: z.id, end: g.id });
  const page = { elements: [g, x, z, outer] };
  updateConnectors(page);
  x.y = 800; // the inner connector stretches, so the group grows
  updateConnectors(page);
  const [, end] = endsOf(outer);
  const box = { x: g.x, y: g.y, w: g.w, h: g.h };
  assert.ok(Math.abs(end[1] - (box.y + box.h / 2)) < 0.01, `on the grown group's side (${end[1]} vs ${box.y + box.h / 2})`);
});

test('[VIEW-07] print bleed is 3 mm at the size the design prints at', async () => {
  const { bleedSize } = await import('../../src/model/view.js');
  assert.ok(Math.abs(bleedSize({ unit: 'px' }) - (3 / 25.4) * 96) < 1e-9, 'px designs print at 96 per inch');
  assert.ok(Math.abs(bleedSize({ unit: 'mm' }) - (3 / 25.4) * 300) < 0.5, 'mm designs at 300 per inch');
});

test('[ELM-10] a connector in a turned group comes loose when its element is deleted', async () => {
  const { createConnector, updateConnectors } = await import('../../src/model/connectors.js');
  const { createShape, createGroup } = await import('../../src/model/doc.js');
  const a = createShape('rect', { x: 0, y: 0, w: 100, h: 100 });
  const c = createConnector({ from: [100, 50], to: [400, 50], start: a.id, end: 'gone' });
  const g = createGroup([a, c], { rotation: 10 });
  updateConnectors({ elements: [g] });
  assert.equal(c.start.id, a.id, 'still on its element');
  assert.equal(c.end.id, null, 'loose: its element is gone');
});

test('[ELM-10] in a turned group, an end on an element outside the group comes loose', async () => {
  const { createConnector, updateConnectors } = await import('../../src/model/connectors.js');
  const { createShape, createGroup } = await import('../../src/model/doc.js');
  const a = createShape('rect', { x: 0, y: 0, w: 100, h: 100 });
  const b = createShape('rect', { x: 400, y: 0, w: 100, h: 100 });
  const c = createConnector({ from: [100, 50], to: [400, 50], start: a.id, end: b.id });
  const g = createGroup([a, c], { flipX: true });
  updateConnectors({ elements: [g, b] });
  assert.equal(c.start.id, a.id);
  assert.equal(c.end.id, null);
});

test('[ELM-10] a connector between two elements of one turned group keeps its length', async () => {
  const { createConnector, updateConnectors, endsOf } = await import('../../src/model/connectors.js');
  const { createShape, createGroup } = await import('../../src/model/doc.js');
  const a = createShape('rect', { x: 100, y: 100, w: 100, h: 100 });
  const b = createShape('rect', { x: 600, y: 100, w: 100, h: 100 });
  const c = createConnector({ from: [200, 150], to: [600, 150], start: a.id, end: b.id });
  const g = createGroup([a, b], { rotation: 30 });
  updateConnectors({ elements: [g, c] });
  const [p, q] = endsOf(c);
  assert.ok(Math.hypot(q[0] - p[0], q[1] - p[1]) > 100, 'not folded to a point');
});

test('[ELM-10] freeing the ends of deleted elements counts as a change', async () => {
  const { createConnector, updateConnectors } = await import('../../src/model/connectors.js');
  const c = createConnector({ from: [0, 0], to: [100, 0], start: 'gone-a', end: 'gone-b' });
  assert.equal(updateConnectors({ elements: [c] }), true);
  assert.equal(c.start.id, null);
});

test('[ELM-10] a connector leaves a turned shape the way it faces on the page', async () => {
  const { anchorOn } = await import('../../src/model/connectors.js');
  const box = { x: 0, y: 0, w: 100, h: 100, rotation: 90 };
  const { side } = anchorOn(box, [400, 50]);
  assert.equal(side, 'r', 'toward the right on the page, whichever of its own sides that is');
});

test('[ELM-09] a turned drawing is hit only near its stroke', async () => {
  const { createDrawing } = await import('../../src/model/doc.js');
  const { drawHit } = await import('../../src/model/shapes.js');
  const d = createDrawing([[0, 0], [400, 400]], { strokeWidth: 6 });
  d.rotation = 10;
  const c = { x: d.x + d.w / 2, y: d.y + d.h / 2 };
  assert.ok(drawHit(d, c, 8), 'on the line (its middle stays put)');
  assert.ok(!drawHit(d, { x: d.x + 10, y: d.y + d.h - 10 }, 8), 'a far corner of its box is not');
});

test('[ELM-10] a live drag passing through a turn detaches nothing', async () => {
  const { createConnector, updateConnectors } = await import('../../src/model/connectors.js');
  const { createShape, createGroup } = await import('../../src/model/doc.js');
  const a = createShape('rect', { x: 0, y: 0, w: 100, h: 100 });
  const b = createShape('rect', { x: 400, y: 0, w: 100, h: 100 });
  const c = createConnector({ from: [100, 50], to: [400, 50], start: a.id, end: b.id });
  const g = createGroup([a, c]);
  const page = { elements: [g, b] };
  g.rotation = 5;
  updateConnectors(page, { refit: false }); // a frame of a rotate drag
  g.rotation = 0;
  updateConnectors(page);
  assert.equal(c.end.id, b.id);
});
