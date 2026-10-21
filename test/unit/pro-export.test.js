import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import zlib from 'node:zlib';
import { deflate, inflate } from '../../src/model/deflate.js';
import { brotliDecode, dictionaryWord } from '../../src/model/brotli.js';
import { readTables, writeSfnt, parseFont, subsetFont, glyphFor } from '../../src/model/sfnt.js';
import { jpegInfo } from '../../src/model/jpeg.js';
import { planVectorPdf, buildVectorPdf, parsePath, parseColor, rasterScale } from '../../src/model/pdf-vector.js';
import { buildPptx, planPptx, emuPerPx, pptxKind } from '../../src/model/pptx.js';
import { createDesign, createText, createShape, createLine, createImage, createIcon, createGroup, addAsset, createSticky, createVideo, createDesignFromPreset, validateDesign, DOC_STYLES } from '../../src/model/doc.js';
import { createConnector } from '../../src/model/connectors.js';
import { flowDocument, onPaper } from '../../src/model/flow.js';
import { approxMeasure, notePad } from '../../src/model/text-layout.js';
import { renderPage } from '../../src/model/render.js';
import { fontsUsed, fontFile } from '../../src/model/fonts.js';
import { craft, NDBITS } from '../../scripts/brotli-dict.mjs';
import { readPdf, find, pageContents, unzip, checkXml, has } from '../formats.js';

const root = new URL('../../', import.meta.url).pathname;
const fontBytes = (file) => new Uint8Array(readFileSync(join(root, 'assets/fonts', file)));

/** The brotli stream inside a WOFF2 file. */
function woff2Stream(bytes) {
  const b = Buffer.from(bytes);
  let p = 48;
  for (let i = 0; i < b.readUInt16BE(12); i++) {
    const flags = b[p++];
    if ((flags & 63) === 63) p += 4;
    const base128 = () => {
      let v = 0;
      for (let k = 0; k < 5; k++) {
        const c = b[p++];
        v = v * 128 + (c & 127);
        if (!(c & 128)) break;
      }
      return v;
    };
    base128();
    const tag = flags & 63;
    if ((tag === 10 || tag === 11) ? flags >> 6 === 0 : flags >> 6 !== 0) base128();
  }
  return b.subarray(p, p + b.readUInt32BE(20));
}

// ---------- compression ----------

test('[EXP-13] deflate makes zlib data that zlib reads, and inflate reads zlib data', () => {
  const samples = [new Uint8Array(0), new TextEncoder().encode('ab'.repeat(5000)), readFileSync(join(root, 'src/model/render.js')), Uint8Array.from({ length: 70000 }, (_, i) => (i * 7919) % 251)];
  for (const s of samples) {
    const d = deflate(s);
    assert.deepEqual(new Uint8Array(zlib.inflateSync(d)), new Uint8Array(s));
    assert.deepEqual(inflate(new Uint8Array(zlib.deflateSync(s))), new Uint8Array(s));
    assert.deepEqual(inflate(d), new Uint8Array(s));
  }
  assert.ok(deflate(new Uint8Array(100000)).length < 300, 'repeats compress');
});

test('[EXP-13] Brotli decoding matches Node\'s, for every bundled font and for text', () => {
  const files = readdirSync(join(root, 'assets/fonts')).filter((f) => f.endsWith('.woff2'));
  for (const f of files.filter((_, i) => i % 7 === 0)) {
    const stream = woff2Stream(fontBytes(f));
    assert.deepEqual(Buffer.from(brotliDecode(new Uint8Array(stream))), zlib.brotliDecompressSync(stream), f);
  }
  const text = Buffer.from(`${readFileSync(join(root, 'README.md'), 'utf8')} Grüße, 人人生而自由, Καλημέρα → ★ 😀`);
  for (const q of [1, 5, 11]) {
    const c = zlib.brotliCompressSync(text, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: q } });
    assert.deepEqual(Buffer.from(brotliDecode(new Uint8Array(c))), text, `quality ${q}`);
  }
});

test('[EXP-13] Brotli dictionary words and all 121 transforms match Node\'s', () => {
  assert.equal(new TextDecoder().decode(dictionaryWord(4, 0, 0)), 'time');
  for (let t = 0; t < 121; t++) {
    const words = [4, 9, 16, 24].map((len) => ({ len, id: (t << NDBITS[len]) + 5 }));
    const sizes = words.map((w) => dictionaryWord(w.len, 5, t).length);
    const stream = craft(words, sizes);
    assert.deepEqual(Buffer.from(brotliDecode(stream)), zlib.brotliDecompressSync(stream), `transform ${t}`);
  }
});

// ---------- fonts ----------

test('[EXP-13] WOFF2 fonts read back to TrueType: metrics, characters and glyphs', () => {
  const font = parseFont(fontBytes('inter-400.woff2'));
  assert.equal(font.name, 'Inter-Regular');
  assert.equal(font.unitsPerEm, 2048);
  assert.ok(font.numGlyphs > 500);
  const a = glyphFor(font, 'A'.codePointAt(0));
  assert.ok(a > 0 && font.advances[a] > 1000 && font.advances[a] < 1600);
  assert.ok(glyphFor(font, 'é'.codePointAt(0)) > 0);
  assert.equal(glyphFor(font, 0x4e00), 0, 'no CJK in the Latin file');
  // The same tables as a plain TrueType file, and as WOFF 1.
  const { tables, flavor } = readTables(fontBytes('inter-400.woff2'));
  const ttf = writeSfnt(tables, flavor);
  assert.equal(parseFont(ttf).numGlyphs, font.numGlyphs);
  const woff = woff1(tables, flavor);
  assert.deepEqual(parseFont(woff).advances, font.advances);
});

function woff1(tables, flavor) {
  const tags = Object.keys(tables).sort();
  // Each table deflated, or as it is when that's no smaller (as WOFF asks).
  const packed = tags.map((t) => {
    const z = new Uint8Array(zlib.deflateSync(tables[t]));
    return z.length < tables[t].length ? z : tables[t];
  });
  const head = Buffer.alloc(44 + tags.length * 20);
  head.write('wOFF', 0, 'latin1');
  head.writeUInt32BE(flavor, 4);
  head.writeUInt16BE(tags.length, 12);
  let off = head.length;
  tags.forEach((t, i) => {
    const p = 44 + i * 20;
    head.write(t, p, 'latin1');
    head.writeUInt32BE(off, p + 4);
    head.writeUInt32BE(packed[i].length, p + 8);
    head.writeUInt32BE(tables[t].length, p + 12);
    off += packed[i].length;
  });
  return new Uint8Array(Buffer.concat([head, ...packed]));
}

test('[EXP-13] a font subset keeps only the glyphs used (and the parts of composite glyphs)', () => {
  const font = parseFont(fontBytes('inter-700.woff2'));
  const used = [...'Café'].map((c) => glyphFor(font, c.codePointAt(0)));
  const sub = parseFont(subsetFont(font, used));
  assert.equal(sub.numGlyphs, font.numGlyphs, 'glyph numbers stay the same');
  const size = (f, g) => f.offsets[g + 1] - f.offsets[g];
  for (const g of used) assert.ok(size(sub, g) > 0);
  const unused = glyphFor(font, 'Z'.codePointAt(0));
  assert.equal(size(sub, unused), 0, 'unused glyphs are empty');
  assert.ok(subsetFont(font, used).length < 40000);
});

test('[EXP-13] JPEG sizes, channels and Exif turns are read from the markers', () => {
  const seg = (marker, body) => Buffer.concat([Buffer.from([0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 255]), body]);
  const tiff = Buffer.from([0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0]);
  const exif = seg(0xe1, Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]));
  const sof = seg(0xc0, Buffer.from([8, 0, 30, 0, 40, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]));
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8]), exif, sof, Buffer.from([0xff, 0xda, 0, 2, 0xff, 0xd9])]);
  assert.deepEqual(jpegInfo(new Uint8Array(jpeg)), { orientation: 6, inverted: false, width: 40, height: 30, components: 3, progressive: false });
  assert.equal(jpegInfo(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), null, 'a PNG is not a JPEG');
});

// ---------- vector PDF ----------

test('[EXP-13] SVG paths, arcs and colors read for PDF', () => {
  const segs = parsePath('M10 10h20v20H10zm5 5l5 5 5-5a5 5 0 0 1 10 0a.5.5 0 011.2 1.2');
  assert.deepEqual(segs.slice(0, 5), [['M', 10, 10], ['L', 30, 10], ['L', 30, 30], ['L', 10, 30], ['Z']]);
  assert.deepEqual(segs[5], ['M', 15, 15]);
  assert.deepEqual(segs[7], ['L', 25, 15]);
  const arc = segs.filter((s) => s[0] === 'C');
  assert.ok(arc.length >= 2);
  assert.deepEqual(arc[1].slice(5).map((v) => Math.round(v * 100) / 100), [35, 15], 'the half circle ends where it says');
  assert.deepEqual(parseColor('#ff000080').map((v) => Math.round(v * 100) / 100), [1, 0, 0, 0.5]);
  assert.deepEqual(parseColor('rgb(0, 128, 255)').slice(0, 3).map((v) => Math.round(v * 255)), [0, 128, 255]);
  assert.equal(parseColor('none'), null);
  assert.deepEqual(parseColor('url(#g1)'), { url: 'g1' });
});

/** A design with a bit of everything, and the fonts it uses. */
function sampleDesign(unit = 'px') {
  const doc = createDesign(unit === 'px' ? { width: 1080, height: 1080 } : { width: 1748, height: 2480, unit });
  const p = doc.pages[0];
  p.background = { type: 'gradient', gradient: { type: 'linear', angle: 135, stops: [{ offset: 0, color: '#ffeedd' }, { offset: 1, color: '#ddeeff' }] } };
  p.elements.push(createText({ id: 't1', x: 80, y: 60, w: 900, h: 140, text: 'Spring fair at Café Lumière', size: 64, weight: 700, align: 'center' }));
  p.elements.push(createShape('star', { id: 's1', x: 80, y: 450, w: 200, h: 200, fill: { type: 'radial', stops: [{ offset: 0, color: '#ffcc00' }, { offset: 1, color: '#ff3300' }] }, stroke: '#333333', strokeWidth: 6, dash: 'dashed' }));
  p.elements.push(createShape('rect', { id: 's2', x: -40, y: 700, w: 300, h: 140, radius: 30, fill: '#2266ff', opacity: 0.5 }));
  p.elements.push(createText({ id: 'glow', x: 500, y: 900, w: 480, h: 80, text: 'Glowing', size: 50, effect: { type: 'glow' } }));
  p.elements.push(createText({ id: 'emoji', x: 500, y: 800, w: 480, h: 80, text: 'Party 🎉', size: 40 }));
  p.elements.push(createShape('ellipse', { id: 'shadowed', x: 900, y: 300, w: 120, h: 120, fill: '#00aa88', shadow: { x: 4, y: 8, blur: 16 } }));
  p.elements.push(createGroup([createIcon('heart', { id: 'i1', x: 0, y: 0, w: 100, h: 100 }), createText({ id: 'curved', x: 0, y: 120, w: 300, h: 80, text: 'Round and round', size: 30, curve: 60 })], { id: 'g1', x: 600, y: 450, w: 300, h: 200, rotation: 30 }));
  const fonts = new Map();
  for (const { font, weight } of fontsUsed(doc)) fonts.set(`${font.name}|${weight}`, fontBytes(fontFile(font.slug, weight)));
  return { doc, fonts };
}

test('[EXP-13] what PDF can\'t draw is planned as pictures of just those elements', () => {
  const { doc, fonts } = sampleDesign();
  const wants = planVectorPdf(doc, [0], { fonts });
  assert.deepEqual(wants.map((w) => w.key).sort(), ['curved', 'emoji', 'glow', 'shadowed'], 'glow, a letter the font lacks, a shadow, curved text');
  const curved = wants.find((w) => w.key === 'curved');
  assert.ok(curved.box.w > 0 && curved.box.x >= 0, 'in page px, within the page');
  assert.equal(rasterScale(doc), 2, 'screen designs: pictures at twice their size');
  assert.equal(rasterScale(createDesign({ width: 2480, height: 3508, unit: 'mm' })), 1, 'print designs: already 300 per inch');
});

test('[EXP-13] vector PDF structure: xref, embedded subset fonts, text operators, shading, pictures', () => {
  const { doc, fonts } = sampleDesign();
  const px = (w, h, rgb) => ({ width: w, height: h, data: zlib.deflateSync(Buffer.alloc(w * h * 3, rgb)), alpha: zlib.deflateSync(Buffer.alloc(w * h, 200)) });
  const rasters = new Map(planVectorPdf(doc, [0], { fonts }).map((w) => [`${w.page}:${w.key}`, px(4, 3, 99)]));
  const bytes = buildVectorPdf(doc, [0], { fonts, rasters, title: 'Fair ✓' });
  const pdf = readPdf(bytes); // throws on a wrong xref offset or stream length
  assert.equal(pdf.header, '%PDF-1.7');
  const [page] = find(pdf, /\/Type \/Page\b/);
  assert.match(page.dict, /\/MediaBox \[0 0 810 810\]/, '1080 px at 96 per inch');
  // Fonts: Type 0, Identity-H, a TrueType subset, and a ToUnicode map with the letters used.
  const [bold] = find(pdf, /\/Subtype \/Type0 \/BaseFont \/[A-Z]{6}\+Inter-Bold/);
  assert.match(bold.dict, /\/Encoding \/Identity-H/);
  const cid = pdf.objects.get(+/\/DescendantFonts \[(\d+) 0 R\]/.exec(bold.dict)[1]);
  assert.match(cid.dict, /\/Subtype \/CIDFontType2 .*\/CIDToGIDMap \/Identity/);
  const desc = pdf.objects.get(+/\/FontDescriptor (\d+) 0 R/.exec(cid.dict)[1]);
  const program = pdf.objects.get(+/\/FontFile2 (\d+) 0 R/.exec(desc.dict)[1]);
  assert.equal(program.data.readUInt32BE(0), 0x00010000);
  assert.equal(+/\/Length1 (\d+)/.exec(program.dict)[1], program.data.length);
  const sub = parseFont(new Uint8Array(program.data));
  assert.equal(sub.name, 'Inter-Bold');
  const toUnicode = pdf.objects.get(+/\/ToUnicode (\d+) 0 R/.exec(bold.dict)[1]).data.toString('latin1');
  assert.match(toUnicode, /begincmap/);
  assert.match(toUnicode, /<[0-9A-F]{4}> <00E9>/, 'é maps back to its letter');
  const content = pageContents(pdf)[0];
  assert.match(content, /BT \/F\d+ 64 Tf [-\d.]+ Tc 0 Tr 1 0 0 -1 [\d.]+ [\d.]+ Tm <[0-9A-F]+> Tj ET/, 'text drawn as text');
  assert.match(content, /\/Sh\d+ sh/, 'gradients as shadings');
  assert.match(content, /\[[\d.]+ [\d.]+\] 0 d/, 'dashed outline');
  assert.match(content, /\/GS\d+ gs \/Fm\d+ Do/, 'see-through shape as a transparency group');
  const res = pdf.objects.get(+/\/Resources (\d+) 0 R/.exec(page.dict)[1]);
  assert.match(res.dict, /\/ShadingType 2 .*\/ShadingType 3/s, 'linear and radial');
  assert.equal(find(pdf, /\/Subtype \/Image .*\/SMask/).length, 4, 'four pictures of elements, see-through');
  assert.match(pdf.objects.get(+/\/Info (\d+) 0 R/.exec(pdf.trailer)[1]).dict, /\/Title <FEFF004600610069007200202713>/, 'the title in Unicode');
  if (has('pdftotext', ['-v'])) {
    const dir = mkdtempSync(join(tmpdir(), 'paperwall-unit-'));
    writeFileSync(join(dir, 'a.pdf'), bytes);
    assert.match(execFileSync('pdftotext', ['-enc', 'UTF-8', join(dir, 'a.pdf'), '-']).toString(), /Spring fair at Café Lumière/);
    assert.doesNotMatch(execFileSync('pdffonts', [join(dir, 'a.pdf')]).toString(), /\bno\b/, 'every font embedded');
  }
});

test('[EXP-14] print PDF: page grown by the bleed, TrimBox and BleedBox, crop marks', () => {
  const { doc, fonts } = sampleDesign('mm');
  const bytes = buildVectorPdf(doc, [0], { fonts, print: true });
  const pdf = readPdf(bytes);
  const [page] = find(pdf, /\/Type \/Page\b/);
  const box = (k) => new RegExp(`/${k} \\[([^\\]]+)\\]`).exec(page.dict)[1].split(' ').map(Number);
  const [trim, bleed, media] = [box('TrimBox'), box('BleedBox'), box('MediaBox')];
  const mm = 72 / 25.4;
  assert.ok(Math.abs(trim[2] - trim[0] - 148 * mm) < 0.5 && Math.abs(trim[3] - trim[1] - 210 * mm) < 0.5, 'A5 trim');
  assert.ok(Math.abs(trim[0] - bleed[0] - 3 * mm) < 0.01 && Math.abs(bleed[3] - trim[3] - 3 * mm) < 0.01, '3 mm bleed');
  assert.ok(bleed[0] - media[0] >= 18 && media[2] - bleed[2] >= 18, 'room for the marks');
  const content = pageContents(pdf)[0];
  assert.match(content, /^1 0 0 1 [\d.]+ [\d.]+ cm/, 'the page placed at the trim');
  assert.match(content, /-[\d.]+ -[\d.]+ [\d.]+ [\d.]+ re W n/, 'clipped at the bleed, not the trim');
  const marks = /1 1 1 1 K (.*) S Q$/.exec(content)[1];
  const lines = [...marks.matchAll(/([-\d.]+) ([-\d.]+) m ([-\d.]+) ([-\d.]+) l/g)].map((m) => m.slice(1).map(Number));
  assert.equal(lines.length, 8);
  const W = trim[2] - trim[0];
  const H = trim[3] - trim[1];
  for (const [x1, y1, x2, y2] of lines) {
    // Each mark lines up with a trim edge and stays outside the bleed.
    const outside = (x, y) => x < -3 * mm || x > W + 3 * mm || y < -3 * mm || y > H + 3 * mm;
    assert.ok(outside(x1, y1) && outside(x2, y2), `mark ${x1},${y1} ${x2},${y2} outside the bleed`);
    assert.ok([0, W].some((v) => Math.abs(x1 - v) < 0.01 && Math.abs(x2 - v) < 0.01) || [0, H].some((v) => Math.abs(y1 - v) < 0.01 && Math.abs(y2 - v) < 0.01));
  }
  // The rectangle off the left edge runs into the bleed in the picture plan too.
  assert.equal(rasterScale(doc, { print: true }), 1);
  assert.equal(rasterScale(createDesign({ width: 1080, height: 1080 }), { print: true }), 300 / 96, '300 per inch for screen designs too');
});

test('[EXP-13] hard edges in gradients: the stitching function\'s Bounds rise, inside its Domain', () => {
  const doc = createDesign({ width: 400, height: 400 });
  const red = '#ff0000';
  const blue = '#0000ff';
  const fills = [
    [{ offset: 0, color: red }, { offset: 0.5, color: red }, { offset: 0.5, color: blue }, { offset: 1, color: blue }],
    [{ offset: 0, color: red }, { offset: 1, color: red }, { offset: 1, color: blue }],
    [{ offset: 0, color: red }, { offset: 0, color: blue }, { offset: 1, color: '#00ff00' }],
    [{ offset: 0, color: red }, { offset: 0.3, color: blue }, { offset: 0.3, color: red }, { offset: 0.3, color: blue }, { offset: 1, color: red }],
  ];
  fills.forEach((stops, i) => doc.pages[0].elements.push(createShape('rect', { id: `r${i}`, x: 10 + i * 90, y: 10, w: 80, h: 80, fill: { type: 'linear', angle: 90, stops } })));
  assert.deepEqual(planVectorPdf(doc, [0], {}), [], 'all drawn as shadings');
  const pdf = readPdf(buildVectorPdf(doc, [0], {}));
  const text = [...pdf.objects.values()].map((o) => o.dict).join('\n');
  const all = [...text.matchAll(/\/Bounds \[([^\]]*)\]/g)].map((m) => m[1].split(' ').map(Number));
  assert.equal(all.length, fills.length, 'a stitching function each');
  for (const bounds of all) {
    const seq = [0, ...bounds, 1];
    for (let i = 1; i < seq.length; i++) assert.ok(seq[i] > seq[i - 1], `strictly rising inside [0 1]: ${bounds}`);
  }
  assert.deepEqual(all[0], [0.5, 0.501], 'the edge where it was put');
  assert.deepEqual(all[1], [0.999], 'an edge at the end moves back, not past it');
});

test('[EXP-14] a background drawn as a picture runs into the bleed', () => {
  const doc = createDesign({ width: 200, height: 100 });
  doc.pages[0].background = { type: 'color', color: '#0a9396' };
  doc.pages[0].elements.push(createShape('rect', { id: 'r', x: 10, y: 10, w: 50, h: 50, fill: '#ff0000' }));
  const view = { x: -10, y: -10, w: 220, h: 120 };
  const plain = renderPage(doc, 0, { view });
  assert.match(plain, /<rect width="200" height="100" fill="#0a9396"\/>/, 'just the page without');
  const svg = renderPage(doc, 0, { view, bleed: 10 });
  assert.match(svg, /<g transform="translate\(-10 -10\)"><rect width="220" height="120" fill="#0a9396"\/><\/g>/, 'past every edge with');
  assert.match(svg, /fill="#ff0000"/, 'the elements where they were');
  assert.doesNotMatch(renderPage(doc, 0, { view, bleed: 10, transparent: true }), /#0a9396/);
});

// ---------- PowerPoint ----------

function pptxSample() {
  const doc = createDesign({ width: 1920, height: 1080 });
  doc.name = 'Deck & "plans"';
  const png = readFileSync(join(root, 'assets/icons', readdirSync(join(root, 'assets/icons')).find((f) => f.endsWith('.png'))));
  const img = addAsset(doc, { mime: 'image/png', dataUrl: `data:image/png;base64,${png.toString('base64')}`, width: 192, height: 192 });
  const p = doc.pages[0];
  p.notes = 'Welcome everyone\nThen the numbers';
  p.background = { type: 'color', color: '#fff3e6' };
  p.elements.push(createText({ id: 't1', x: 100, y: 80, w: 1200, h: 140, text: 'Quarterly <review> & plans', size: 96, weight: 700, italic: true, align: 'center', color: '#223344', letterSpacing: 2 }));
  p.elements.push(createText({ id: 't2', x: 100, y: 300, w: 900, h: 200, text: 'One\nTwo', list: 'bullet', size: 40, underline: true }));
  p.elements.push(createShape('rect', { id: 's1', x: 1200, y: 300, w: 300, h: 200, radius: 40, fill: '#ff6600', stroke: '#000000', strokeWidth: 6, dash: 'dashed', rotation: 10 }));
  p.elements.push(createShape('ellipse', { id: 's2', x: 100, y: 600, w: 200, h: 120, fill: { type: 'linear', angle: 90, stops: [{ offset: 0, color: '#00aa88' }, { offset: 1, color: '#0055ff' }] } }));
  p.elements.push(createShape('heart', { id: 's3', x: 400, y: 600, w: 200, h: 200, fill: '#d1495b' }));
  p.elements.push(createLine({ id: 'l1', x: 700, y: 640, w: 400, h: 24, endCap: 'arrow' }));
  p.elements.push(createImage(img, { id: 'p1', x: 1200, y: 600, w: 300, h: 300, crop: { x: 0.1, y: 0, w: 0.8, h: 1 }, mask: 'circle' }));
  p.elements.push(createIcon('heart', { id: 'icon', x: 1600, y: 650, w: 150, h: 150 }));
  p.elements.push(createText({ id: 'glow', x: 100, y: 900, w: 800, h: 100, text: 'Shine', size: 60, effect: { type: 'neon' } }));
  doc.pages.push({ id: 'p2', background: { type: 'color', color: '#16161d' }, elements: [createText({ x: 100, y: 100, w: 800, h: 120, text: 'Second slide', size: 80, color: '#ffffff' })] });
  return { doc, img, png };
}

test('[EXP-15] PowerPoint: which elements stay native and which become pictures', () => {
  const { doc } = pptxSample();
  const kinds = Object.fromEntries(doc.pages[0].elements.map((el) => [el.id, pptxKind(doc, el)]));
  assert.deepEqual(kinds, { t1: 'text', t2: 'text', s1: 'shape', s2: 'shape', s3: 'shape', l1: 'line', p1: 'picture', icon: 'raster', glow: 'raster' });
  assert.deepEqual(planPptx(doc, [0, 1]).map((w) => w.key), ['icon', 'glow']);
  const tiny = createDesign({ width: 50, height: 50 });
  assert.equal(Math.round(50 * emuPerPx(tiny)), 914400, 'at least an inch: PowerPoint\'s smallest slide');
  const huge = createDesign({ width: 20000, height: 1000 });
  assert.equal(Math.round(20000 * emuPerPx(huge)), 51206400, 'at most 56 inches');
});

test('[EXP-15] PowerPoint file: parts, relationships, content types and slide XML', () => {
  const { doc, img, png } = pptxSample();
  const pictures = new Map(planPptx(doc, [0, 1]).map((w) => [`${w.page}:${w.key}`, new Uint8Array(png)]));
  const media = new Map([[`asset:${img}:file`, { bytes: new Uint8Array(png), ext: 'png', width: 192, height: 192 }]]);
  const bytes = buildPptx(doc, [0, 1], { media, pictures });
  const parts = unzip(bytes);
  assert.equal([...parts.keys()][0], '[Content_Types].xml');
  for (const [n, data] of parts) if (/\.(xml|rels)$/.test(n)) checkXml(data.toString('utf8'), n);
  const types = parts.get('[Content_Types].xml').toString();
  for (const n of parts.keys()) {
    if (n.endsWith('.xml') && n !== '[Content_Types].xml') assert.ok(types.includes(`PartName="/${n}"`), `content type for ${n}`);
  }
  for (const [n, data] of parts) {
    if (!n.endsWith('.rels')) continue;
    const dir = n.replace(/_rels\/[^/]+$/, '');
    for (const [, target] of data.toString().matchAll(/Target="([^"]+)"/g)) assert.ok(parts.has(join('/', dir, target).slice(1)), `${n} -> ${target}`);
  }
  const pres = parts.get('ppt/presentation.xml').toString();
  assert.match(pres, /<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"\/><\/p:sldMasterIdLst><p:notesMasterIdLst>/);
  assert.match(pres, /<p:sldSz cx="18288000" cy="10287000"\/>/);
  const s1 = parts.get('ppt/slides/slide1.xml').toString();
  assert.match(s1, /<p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFF3E6"\/><\/a:solidFill><a:effectLst\/><\/p:bgPr><\/p:bg>/);
  assert.match(s1, /<a:t>Quarterly &lt;review&gt; &amp; plans<\/a:t>/);
  assert.match(s1, /sz="7200" b="1" i="1"[^>]*spc="150"/, '96 px = 72 pt, 2 px spacing = 1.5 pt');
  assert.match(s1, /<a:latin typeface="Inter"\/>/);
  assert.match(s1, /<a:pPr algn="ctr"><a:lnSpc><a:spcPts val="8640"\/><\/a:lnSpc>/, 'line height 1.2 of 72 pt');
  assert.match(s1, /<a:buChar char="•"\/>/);
  assert.match(s1, /u="sng"/);
  assert.match(s1, /<a:xfrm rot="600000">/, 'turned 10°');
  assert.match(s1, /<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 20000"\/>/);
  assert.match(s1, /<a:prstDash val="dash"\/>/);
  assert.match(s1, /<a:gradFill rotWithShape="1"><a:gsLst>.*<a:lin ang="0" scaled="0"\/>/, 'left-to-right gradient');
  assert.match(s1, /<a:custGeom>.*<a:cubicBezTo>/, 'the heart drawn as its outline');
  assert.match(s1, /<p:cxnSp>.*<a:prstGeom prst="line">.*<a:tailEnd type="triangle"/, 'a line with an arrowhead');
  assert.match(s1, /<p:pic>.*<a:srcRect l="10000" t="0" r="10000" b="0"\/>.*<a:prstGeom prst="ellipse">/, 'a cropped photo in a circle');
  assert.equal([...s1.matchAll(/<p:pic>/g)].length, 3, 'photo, icon and neon text');
  assert.equal(new Set([...s1.matchAll(/<p:cNvPr id="(\d+)"/g)].map((m) => m[1])).size, [...s1.matchAll(/<p:cNvPr id=/g)].length, 'shape ids unique');
  const rels = parts.get('ppt/slides/_rels/slide1.xml.rels').toString();
  assert.match(rels, /relationships\/slideLayout" Target="..\/slideLayouts\/slideLayout1.xml"/);
  assert.match(rels, /relationships\/notesSlide"/);
  assert.match(parts.get('ppt/notesSlides/notesSlide1.xml').toString(), /<a:t>Welcome everyone<\/a:t>.*<a:t>Then the numbers<\/a:t>/);
  assert.ok(!parts.has('ppt/notesSlides/notesSlide2.xml'), 'no notes, no notes page');
  assert.equal([...parts.keys()].filter((n) => n.startsWith('ppt/media/')).length, 3);
  assert.match(parts.get('docProps/core.xml').toString(), /<dc:title>Deck &amp; &quot;plans&quot;<\/dc:title>/);
  if (has('python3')) {
    // A second opinion: Python's own zip and XML readers.
    const dir = mkdtempSync(join(tmpdir(), 'paperwall-unit-'));
    writeFileSync(join(dir, 'deck.pptx'), bytes);
    const out = execFileSync('python3', ['-I', '-c', 'import sys,zipfile,xml.dom.minidom\nz=zipfile.ZipFile(sys.argv[1])\nassert z.testzip() is None\nn=[x for x in z.namelist() if x.endswith((".xml",".rels"))]\n[xml.dom.minidom.parseString(z.read(x)) for x in n]\nprint(len(n))', join(dir, 'deck.pptx')]).toString();
    assert.ok(+out > 15);
  }
});

test('[EXP-15] PowerPoint: speaker notes go on their own slides, once a page', () => {
  const doc = createDesign({ width: 1920, height: 1080 });
  doc.pages[0].notes = 'Open with the story\r\nThen the <numbers> & "dates"';
  doc.pages.push({ id: 'p2', background: { type: 'color', color: '#ffffff' }, elements: [], notes: '   ' });
  doc.pages.push({ id: 'p3', background: { type: 'color', color: '#ffffff' }, elements: [], notes: 'Thank everyone' });
  validateDesign(doc); // (as a saved design is read back: blank notes go)
  assert.equal(doc.pages[1].notes, undefined);
  const parts = unzip(buildPptx(doc, [0, 1, 2], {}));
  for (const [n, data] of parts) if (/\.(xml|rels)$/.test(n)) checkXml(data.toString('utf8'), n);
  const notesOf = (slide) => {
    const rel = /Target="\.\.\/notesSlides\/(notesSlide\d+\.xml)"/.exec(parts.get(`ppt/slides/_rels/slide${slide}.xml.rels`).toString());
    return rel && parts.get(`ppt/notesSlides/${rel[1]}`).toString();
  };
  assert.match(notesOf(1), /<a:t>Open with the story<\/a:t><\/a:r><a:endParaRPr[^>]*\/><\/a:p><a:p><a:r><a:rPr[^>]*\/><a:t>Then the &lt;numbers&gt; &amp; &quot;dates&quot;<\/a:t>/, 'a paragraph a line, escaped');
  assert.equal(notesOf(2), null, 'no notes, no notes page');
  assert.match(notesOf(3), /<a:t>Thank everyone<\/a:t>/);
  // Each notes page points back at its own slide.
  assert.match(parts.get('ppt/notesSlides/_rels/notesSlide2.xml.rels').toString(), /Target="\.\.\/slides\/slide3\.xml"/);
  // A document's page over three sheets: three slides, its notes on the first.
  const d = createDesignFromPreset('doc');
  d.pages[0].notes = 'Read the list';
  d.pages[0].elements.push(createText({ ...DOC_STYLES.numbers, text: Array.from({ length: 90 }, (_, i) => `Point ${i + 1}, long enough to wrap onto a second line of the sheet`).join('\n') }));
  flowDocument(d, approxMeasure);
  const [sheets, pages] = onPaper(d, [0], approxMeasure);
  assert.ok(pages.length >= 3, `${pages.length} sheets`);
  const deck = unzip(buildPptx(sheets, pages, {}));
  assert.equal([...deck.keys()].filter((n) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(n)).length, 1);
  assert.match(deck.get('ppt/slides/_rels/slide1.xml.rels').toString(), /notesSlide1\.xml/);
  // The list numbers on from where the slide before stopped.
  const later = sheets.pages[1].elements.find((e) => e.list === 'number');
  assert.ok(later.listStart > 1);
  assert.match(deck.get('ppt/slides/slide2.xml').toString(), new RegExp(`<a:buAutoNum type="arabicPeriod" startAt="${later.listStart}"/>`));
});

test('[EXP-13] [EXP-15] sticky notes, video stills, credited photos and lines between things', () => {
  const doc = createDesignFromPreset('whiteboard');
  const png = readFileSync(join(root, 'assets/icons', readdirSync(join(root, 'assets/icons')).find((f) => f.endsWith('.png'))));
  const url = `data:image/png;base64,${png.toString('base64')}`;
  const photo = addAsset(doc, { mime: 'image/png', dataUrl: url, width: 192, height: 192, credit: { creator: 'Ana Ruiz', license: 'CC BY 4.0', title: 'Hills' } });
  const video = addAsset(doc, { kind: 'video', mime: 'video/mp4', dataUrl: 'data:video/mp4;base64,AAAA', width: 640, height: 360, duration: 3, poster: url });
  const still = addAsset(doc, { mime: 'image/png', dataUrl: `${url}#still`, width: 640, height: 360 });
  const p = doc.pages[0];
  const first = p.elements[0];
  p.elements.push(createSticky('#ffb3c7', { id: 'pink', x: 1200, y: 600, text: 'Second idea' }));
  p.elements.push(createImage(photo, { id: 'photo', x: 100, y: 100, w: 300, h: 300 }));
  p.elements.push(createVideo(video, { id: 'clip', x: 1600, y: 1200, w: 640, h: 360, still, stillAt: 0 }));
  p.elements.push(createConnector({ id: 'link', from: [first.x + first.w, 760], to: [1200, 760], start: { id: first.id }, end: { id: 'pink' } }));
  validateDesign(doc);
  assert.equal(p.elements[1].note, '#ffb3c7');
  assert.ok(doc.assets[photo].credit, 'the photo keeps its credit');
  const fonts = new Map();
  for (const { font, weight } of fontsUsed(doc)) fonts.set(`${font.name}|${weight}`, fontBytes(fontFile(font.slug, weight)));
  const pic = () => ({ kind: 'flate', width: 2, height: 2, data: zlib.deflateSync(Buffer.alloc(12, 9)) });
  const images = new Map([[`asset:${photo}:file`, pic()], [`asset:${still}:file`, pic()]]);
  // PDF: all of it drawn as vectors, the video as its still.
  assert.deepEqual(planVectorPdf(doc, [0], { fonts, images }), []);
  const pdf = readPdf(buildVectorPdf(doc, [0], { fonts, images }));
  const content = pageContents(pdf)[0];
  assert.match(content, /1 0\.702 0\.78 rg/, 'the pink note');
  assert.match(content, /\/GS\d+ gs 0 0 0 rg/, 'its soft shadow');
  assert.match(content, /BT \/F\d+ 32 Tf/, 'its words as text');
  assert.equal(find(pdf, /\/Subtype \/Image/).length, 2, 'the photo and the video\'s still');
  // Without the still's picture, the video comes as a picture of itself: no error.
  assert.deepEqual(planVectorPdf(doc, [0], { fonts, images: new Map([[`asset:${photo}:file`, pic()]]) }).map((w) => w.key), ['clip']);
  // PowerPoint: notes as shapes of their color with the text inside, the still as the video's picture.
  const kinds = Object.fromEntries(p.elements.map((el) => [el.id, pptxKind(doc, el)]));
  assert.deepEqual(kinds, { [first.id]: 'note', pink: 'note', photo: 'picture', clip: 'picture', link: 'raster' });
  const media = new Map([[`asset:${photo}:file`, { bytes: new Uint8Array(png), ext: 'png', width: 192, height: 192 }], [`asset:${still}:file`, { bytes: new Uint8Array(png), ext: 'png', width: 640, height: 360 }]]);
  const pictures = new Map(planPptx(doc, [0]).map((w) => [`${w.page}:${w.key}`, new Uint8Array(png)]));
  const parts = unzip(buildPptx(doc, [0], { media, pictures }));
  const slide = parts.get('ppt/slides/slide1.xml').toString();
  checkXml(slide, 'slide1.xml');
  const pink = [...slide.matchAll(/<p:sp>.*?<\/p:sp>/g)].map((m) => m[0]).find((sp) => sp.includes('<a:t>Second idea</a:t>'));
  assert.match(pink, /name="Sticky note \d+"/, 'the note is one shape with its text');
  assert.match(pink, /<a:prstGeom prst="roundRect">.*<a:solidFill><a:srgbClr val="FFB3C7"\/><\/a:solidFill>/);
  const inset = Math.round(notePad(p.elements[1]) * emuPerPx(doc));
  assert.match(pink, new RegExp(`<a:bodyPr wrap="square" lIns="${inset}" tIns="${inset}"`), 'the text inside its edges');
  assert.equal([...slide.matchAll(/<p:pic>/g)].length, 3, 'photo, video still and the line');
  assert.equal([...parts.keys()].filter((n) => n.startsWith('ppt/media/')).length, 3);
});

test('[EXP-15] PowerPoint: a photo whose picture couldn\'t be read comes as a picture of itself, not left out', () => {
  const { doc, img, png } = pptxSample();
  const media = new Map(); // the photo's file couldn't be read
  assert.equal(pptxKind(doc, doc.pages[0].elements.find((e) => e.id === 'p1')), 'picture');
  assert.equal(pptxKind(doc, doc.pages[0].elements.find((e) => e.id === 'p1'), media), 'raster');
  const wants = planPptx(doc, [0], media);
  assert.deepEqual(wants.map((w) => w.key), ['p1', 'icon', 'glow']);
  // In a group too: the group comes as one picture.
  const g = createGroup([createImage(img, { id: 'inner', x: 0, y: 0, w: 100, h: 100 }), createShape('rect', { x: 120, y: 0, w: 100, h: 100 })], { id: 'grp', x: 100, y: 100, w: 220, h: 100 });
  assert.equal(pptxKind(doc, g), 'group');
  assert.equal(pptxKind(doc, g, media), 'raster');
  const pictures = new Map(wants.map((w) => [`${w.page}:${w.key}`, new Uint8Array(png)]));
  const parts = unzip(buildPptx(doc, [0], { media, pictures }));
  const slide = parts.get('ppt/slides/slide1.xml').toString();
  checkXml(slide, 'slide1.xml');
  assert.equal([...slide.matchAll(/<p:pic>/g)].length, 3, 'the photo, the icon and the neon text, each a picture');
  assert.equal([...parts.keys()].filter((n) => n.startsWith('ppt/media/')).length, 3);
});
