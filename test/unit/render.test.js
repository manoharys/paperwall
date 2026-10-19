import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDesign, createText, createShape, createLine, createImage, createIcon, createSticker, createQr, addAsset } from '../../src/model/doc.js';
import { addElement, setBackground } from '../../src/model/commands.js';
import { renderPage, esc } from '../../src/model/render.js';
import { layoutText, fitHeight, approxMeasure } from '../../src/model/text-layout.js';
import { shapePath } from '../../src/model/shapes.js';
import { qrMatrix, pickVersion } from '../../src/model/qr.js';
import { ICONS, STICKERS, searchGraphics } from '../../src/model/graphics.js';
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
  assert.ok(!/placard/i.test(svg));
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
  assert.ok(ICONS.length >= 60, `${ICONS.length} icons`);
  assert.ok(STICKERS.length >= 15);
  const ids = new Set([...ICONS, ...STICKERS].map((g) => g.id));
  assert.equal(ids.size, ICONS.length + STICKERS.length, 'unique ids');
  for (const i of ICONS) assert.ok(!/fill="#/.test(i.body), `${i.id} must take the element color`);
  assert.ok(searchGraphics('birthday').icons.some((i) => i.id === 'cake'));
  assert.ok(searchGraphics('sale').stickers.some((s) => s.id === 'burst'));
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
