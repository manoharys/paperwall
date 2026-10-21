import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newDesign, state, addText, addShape, teardown, downloadVia, makePng, uploadImages, pixelAt } from './helpers.js';
import { readPdf, find, pageContents, unzip, checkXml, has } from '../formats.js';
import { planVectorPdf, rasterScale } from '../../src/model/pdf-vector.js';

after(teardown);

const pdfKind = (page, kind) => async () => {
  await page.click('[data-testid="export-format"] [data-value="pdf"]');
  if (kind) await page.click(`[data-testid="export-pdf-kind"] [data-value="${kind}"]`);
};

/** Render page 1 of a PDF with poppler, as PNG bytes (or null without poppler). */
function renderPdf(bytes, dpi = 36) {
  if (!has('pdftoppm', ['-v'])) return null;
  const dir = mkdtempSync(join(tmpdir(), 'paperwall-vpdf-'));
  writeFileSync(join(dir, 'a.pdf'), bytes);
  execFileSync('pdftoppm', ['-r', String(dpi), '-f', '1', '-l', '1', '-png', join(dir, 'a.pdf'), join(dir, 'p')]);
  const file = ['p-1.png', 'p-01.png', 'p-001.png'].map((f) => join(dir, f)).find(existsSync);
  return readFileSync(file);
}

test('[EXP-13] vector PDF with embedded fonts: real text, shapes and pictures, effects as pictures', async () => {
  const { page, context } = await newDesign('a4');
  await page.click('[data-testid="download"]');
  // Vector is the default PDF.
  await page.click('[data-testid="export-format"] [data-value="pdf"]');
  assert.equal(await page.getAttribute('[data-testid="export-pdf-kind"] [data-value="vector"]', 'aria-pressed'), 'true');
  assert.match(await page.innerText('[data-testid="export-dialog"]'), /Flattened/);
  await page.keyboard.press('Escape');
  await addText(page);
  await page.evaluate(() => window.paperwall.editor.update({ text: 'Spring fair at Café Lumière', align: 'center' }));
  const circle = await addShape(page, 'Circle');
  await page.evaluate(() => window.paperwall.editor.update({ x: 200, y: 2600, w: 500, h: 500 }));
  await uploadImages(page, [await makePng(page, { w: 300, h: 200, color: '#ff006e' })]);
  // A glowing word: PDF has no glow, so it comes as a picture of just that word.
  await addText(page, 'body');
  await page.evaluate(() => window.paperwall.editor.update({ text: 'Glow', effect: { type: 'glow', color: '#ffcc00' } }));
  const doc = await state(page);
  const { name, bytes } = await downloadVia(page, pdfKind(page));
  assert.match(name, /\.pdf$/);
  const pdf = readPdf(bytes); // every xref offset checked
  assert.equal(pdf.header, '%PDF-1.7');
  assert.match(pdf.trailer, /\/Root \d+ 0 R/);
  // Fonts: Type 0 with Identity-H, a CID TrueType program embedded, and a ToUnicode map.
  const type0 = find(pdf, /\/Subtype \/Type0/);
  assert.ok(type0.length >= 1);
  for (const f of type0) {
    assert.match(f.dict, /\/Encoding \/Identity-H/);
    assert.match(f.dict, /\/BaseFont \/[A-Z]{6}\+Inter-/, 'a subset of Inter');
    assert.match(f.dict, /\/ToUnicode \d+ 0 R/);
  }
  const programs = find(pdf, /\/Length1 \d+/);
  assert.ok(programs.length >= 1);
  for (const p of programs) assert.equal(p.data.readUInt32BE(0), 0x00010000, 'a TrueType font program');
  // Text is drawn with text operators, not as a picture.
  const content = pageContents(pdf).join('\n');
  assert.match(content, /BT \/F\d+ [\d.]+ Tf .* Tj ET/);
  // The circle is a path; the photo and the glowing word are images.
  assert.match(content, / c /, 'curves for the circle');
  const images = find(pdf, /\/Subtype \/Image/);
  assert.ok(images.some((o) => /\/Width 300 \/Height 200/.test(o.dict)), 'the photo at its own size');
  const plan = planVectorPdf(doc, [0], {});
  const glow = plan.find((w) => w.key === doc.pages[0].elements.at(-1).id);
  assert.ok(glow, 'the glow is planned as a picture');
  assert.ok(images.some((o) => /\/SMask/.test(o.dict) && new RegExp(`/Width ${Math.round(glow.box.w * rasterScale(doc))} `).test(o.dict)), 'the glowing word as a see-through picture');
  if (has('pdftotext', ['-v'])) {
    const dir = mkdtempSync(join(tmpdir(), 'paperwall-vpdf-'));
    writeFileSync(join(dir, 'a.pdf'), bytes);
    const text = execFileSync('pdftotext', ['-enc', 'UTF-8', join(dir, 'a.pdf'), '-']).toString();
    assert.match(text.replace(/\s+/g, ' '), /Spring fair at Café Lumière/, 'selectable, searchable text');
    const fonts = execFileSync('pdffonts', [join(dir, 'a.pdf')]).toString();
    assert.match(fonts, /Inter-Bold\s+CID TrueType\s+Identity-H\s+yes\s+yes\s+yes/, 'embedded, subset, with Unicode');
    // Centered on the A4 page, where the editor shows it.
    const html = execFileSync('pdftotext', ['-bbox', join(dir, 'a.pdf'), '-']).toString();
    const words = [...html.matchAll(/xMin="([\d.]+)" yMin="[\d.]+" xMax="([\d.]+)"[^>]*>([^<]+)</g)].filter((m) => /Spring|Lumi/.test(m[3])).map((m) => [+m[1], +m[2]]);
    const mid = (Math.min(...words.map((w) => w[0])) + Math.max(...words.map((w) => w[1]))) / 2;
    assert.ok(Math.abs(mid - 297.6) < 6, `centered: ${mid}`);
  }
  const png = renderPdf(bytes);
  if (png) {
    // The circle's color where the editor draws it.
    const c = doc.pages[0].elements.find((e) => e.id === circle.id);
    const k = 36 / 300;
    const px = await pixelAt(page, png, 'image/png', Math.round((c.x + c.w / 2) * k), Math.round((c.y + c.h / 2) * k));
    const want = [parseInt(c.fill.slice(1, 3), 16), parseInt(c.fill.slice(3, 5), 16), parseInt(c.fill.slice(5, 7), 16)];
    assert.ok(px.slice(0, 3).every((v, i) => Math.abs(v - want[i]) < 12), `circle color ${px} vs ${want}`);
  }
  await context.close();
});

test('[EXP-13] the flattened PDF is still there', async () => {
  const { page, context } = await newDesign('square');
  await addText(page);
  const { bytes } = await downloadVia(page, pdfKind(page, 'flat'));
  const pdf = readPdf(bytes);
  assert.equal(pdf.header, '%PDF-1.4');
  assert.ok(find(pdf, /\/Filter \/DCTDecode/).length === 1, 'the page as one picture');
  assert.equal(find(pdf, /\/FontFile2/).length, 0);
  await context.close();
});

test('[EXP-14] print PDF with bleed, trim and crop marks', async () => {
  const { page, context } = await newDesign('flyer');
  // A background to the edge and a shape running off the page.
  await page.evaluate(() => window.paperwall.editor.setBackground({ type: 'color', color: '#0a9396' }));
  const s = await addShape(page, 'Square');
  await page.evaluate(() => window.paperwall.editor.update({ x: -200, y: 100, w: 600, h: 400, fill: '#ffd166', shadow: { x: 10, y: 10, blur: 20, color: '#000000', opacity: 0.4 } }));
  const doc = await state(page);
  const { name, bytes } = await downloadVia(page, pdfKind(page, 'print'));
  assert.match(name, /-print\.pdf$/);
  const pdf = readPdf(bytes);
  const [pg] = find(pdf, /\/Type \/Page\b/);
  const box = (k) => new RegExp(`/${k} \\[([^\\]]+)\\]`).exec(pg.dict)[1].split(' ').map(Number);
  const media = box('MediaBox');
  const trim = box('TrimBox');
  const bleed = box('BleedBox');
  // A5 trimmed (148 × 210 mm), with 3 mm of bleed on every side.
  const mm = 72 / 25.4;
  assert.ok(Math.abs(trim[2] - trim[0] - 1748 * 72 / 300) < 0.1 && Math.abs(trim[3] - trim[1] - 2480 * 72 / 300) < 0.1, `trim ${trim}`);
  for (const i of [0, 1]) assert.ok(Math.abs(trim[i] - bleed[i] - 3 * mm) < 0.05, 'bleed 3 mm');
  for (const i of [2, 3]) assert.ok(Math.abs(bleed[i] - trim[i] - 3 * mm) < 0.05, 'bleed 3 mm');
  assert.ok(media[0] < bleed[0] && media[2] > bleed[2], 'room for crop marks around the bleed');
  const content = pageContents(pdf).join('\n');
  assert.match(content, /1 1 1 1 K( [\d.-]+ [\d.-]+ m [\d.-]+ [\d.-]+ l){8} S/, 'eight crop marks in registration color');
  // The shadowed shape is a picture at 300 DPI, running into the bleed.
  const plan = planVectorPdf(doc, [0], { print: true });
  const want = plan.find((w) => w.key === s.id);
  assert.ok(want.box.x < 0, 'the picture runs into the bleed');
  assert.equal(rasterScale(doc, { print: true }), 1, 'an A5 design is drawn at 300 DPI already');
  assert.ok(find(pdf, /\/Subtype \/Image/).some((o) => new RegExp(`/Width ${want.box.w} /Height ${want.box.h}`).test(o.dict)));
  const png = renderPdf(bytes, 72);
  if (png) {
    // In the bleed: the background; outside it: white paper with marks.
    const bleedPx = Math.round((trim[2] + bleed[2]) / 2);
    const midY = Math.round(media[3] - (trim[1] + trim[3]) / 2);
    assert.deepEqual((await pixelAt(page, png, 'image/png', bleedPx, midY)).slice(0, 3), [10, 147, 150], 'background runs into the bleed');
    assert.deepEqual((await pixelAt(page, png, 'image/png', Math.round(media[2]) - 2, midY)).slice(0, 3), [255, 255, 255], 'paper outside the bleed');
  }
  await context.close();
});

test('[EXP-14] print PDF pictures are 300 DPI for screen-sized designs too', async () => {
  const { page, context } = await newDesign('square');
  await addText(page);
  await page.evaluate(() => window.paperwall.editor.update({ text: 'Neon', effect: { type: 'neon', color: '#ff2d95' } }));
  const doc = await state(page);
  const { bytes } = await downloadVia(page, pdfKind(page, 'print'));
  const pdf = readPdf(bytes);
  const want = planVectorPdf(doc, [0], { print: true }).find((w) => w.key === doc.pages[0].elements[0].id);
  assert.equal(rasterScale(doc, { print: true }), 300 / 96);
  assert.ok(find(pdf, /\/Subtype \/Image/).some((o) => new RegExp(`/Width ${Math.round(want.box.w * 300 / 96)} `).test(o.dict)), '300 DPI picture of the neon text');
  await context.close();
});

test('[EXP-15] download as PowerPoint: slides with real text boxes, shapes and pictures', async () => {
  const { page, context } = await newDesign('slides');
  await addText(page);
  await page.evaluate(() => window.paperwall.editor.update({ text: 'Quarterly review & plans', italic: true, align: 'center' }));
  await addShape(page, 'Circle');
  await addShape(page, 'Star');
  await uploadImages(page, [await makePng(page, { w: 400, h: 300 })]);
  // An icon has no PowerPoint shape: it comes as a picture.
  await page.evaluate(() => {
    const ed = window.paperwall.editor;
    ed.addIcon('heart', { color: '#d1495b' });
    ed.select([]);
  });
  // Speaker notes, typed where the presenter view reads them.
  await page.fill('[data-testid="page-notes"]', 'Thank everyone for coming\nThen the <numbers> & dates');
  await page.click('[data-testid="strip-add-page"]');
  await addText(page, 'subheading');
  const { name, bytes } = await downloadVia(page, () => page.click('[data-testid="export-format"] [data-value="pptx"]'));
  assert.match(name, /\.pptx$/);
  const parts = unzip(bytes);
  for (const p of ['[Content_Types].xml', '_rels/.rels', 'ppt/presentation.xml', 'ppt/_rels/presentation.xml.rels', 'ppt/slideMasters/slideMaster1.xml', 'ppt/slideLayouts/slideLayout1.xml', 'ppt/theme/theme1.xml', 'ppt/slides/slide1.xml', 'ppt/slides/slide2.xml']) {
    assert.ok(parts.has(p), `has ${p}`);
  }
  for (const [n, data] of parts) if (/\.(xml|rels)$/.test(n)) checkXml(data.toString('utf8'), n);
  // Every relationship points at a part that's there; every part has a content type.
  const types = parts.get('[Content_Types].xml').toString();
  for (const [n, data] of parts) {
    if (!n.endsWith('.rels')) continue;
    const dir = n.replace(/_rels\/[^/]+$/, '');
    for (const [, target] of data.toString().matchAll(/Target="([^"]+)"/g)) {
      const resolved = join('/', dir, target).slice(1);
      assert.ok(parts.has(resolved), `${n} points at ${resolved}`);
    }
  }
  for (const n of parts.keys()) {
    if (/\.(png|jpeg|rels)$/.test(n) || n === '[Content_Types].xml' || n.endsWith('.xml') && types.includes(`PartName="/${n}"`)) continue;
    assert.fail(`no content type for ${n}`);
  }
  const pres = parts.get('ppt/presentation.xml').toString();
  assert.equal([...pres.matchAll(/<p:sldId /g)].length, 2);
  assert.match(pres, /<p:sldSz cx="18288000" cy="10287000"\/>/, '1920 × 1080 px at 96 per inch: 20 × 11.25 in');
  const slide = parts.get('ppt/slides/slide1.xml').toString();
  assert.match(slide, /<a:t>Quarterly review &amp; plans<\/a:t>/, 'real, editable text');
  assert.match(slide, /<a:rPr [^>]*sz="\d+"[^>]*b="1"[^>]*i="1"/, 'size, bold and italic');
  assert.match(slide, /<a:pPr algn="ctr"/);
  assert.match(slide, /<a:latin typeface="Inter"\/>/);
  assert.match(slide, /<a:prstGeom prst="ellipse">/, 'the circle as a PowerPoint ellipse');
  assert.match(slide, /<a:custGeom>/, 'the star drawn as its outline');
  assert.equal([...slide.matchAll(/<p:pic>/g)].length, 2, 'the photo and the icon as pictures');
  assert.ok([...parts.keys()].filter((n) => n.startsWith('ppt/media/')).length >= 2);
  assert.match(parts.get('ppt/notesSlides/notesSlide1.xml')?.toString() || '', /<a:t>Thank everyone for coming<\/a:t>.*<a:t>Then the &lt;numbers&gt; &amp; dates<\/a:t>/, 'speaker notes, a paragraph a line');
  assert.match(parts.get('ppt/slides/_rels/slide1.xml.rels').toString(), /Target="\.\.\/notesSlides\/notesSlide1\.xml"/, 'on the first slide');
  assert.doesNotMatch(parts.get('ppt/slides/_rels/slide2.xml.rels').toString(), /notesSlide/, 'the second page has none');
  if (has('soffice', ['--version'])) {
    // LibreOffice opens it: two pages with the text on them.
    const dir = mkdtempSync(join(tmpdir(), 'paperwall-pptx-'));
    writeFileSync(join(dir, 'deck.pptx'), bytes);
    execFileSync('soffice', [`-env:UserInstallation=file://${dir}/profile`, '--headless', '--convert-to', 'pdf', '--outdir', dir, join(dir, 'deck.pptx')], { stdio: 'ignore', timeout: 120000 });
    if (has('pdftotext', ['-v'])) {
      const text = execFileSync('pdftotext', [join(dir, 'deck.pdf'), '-']).toString();
      assert.match(text, /Quarterly review & plans/);
      assert.match(execFileSync('pdfinfo', [join(dir, 'deck.pdf')]).toString(), /Pages:\s+2/);
    }
  }
  await context.close();
});

test('[EXP-13] [EXP-14] [EXP-15] a document comes on its sheets in every PDF and in PowerPoint', async () => {
  const { page, context } = await newDesign('doc');
  await page.evaluate(() => {
    const ed = window.paperwall.editor;
    ed.update({ text: 'A long paragraph about the spring fair. '.repeat(500) }, null, [ed.pageData.elements[1].id]);
    ed.select([]);
  });
  await page.fill('[data-testid="page-notes"]', 'Read it slowly');
  assert.equal(await state(page, (ed) => ed.doc.pages.length), 1, 'one long page');
  const counts = {};
  for (const kind of ['vector', 'flat', 'print']) {
    const { bytes } = await downloadVia(page, pdfKind(page, kind));
    const pdf = readPdf(bytes);
    const pages = find(pdf, /\/Type \/Page\b/);
    counts[kind] = pages.length;
    // A4 sheets (the document's 1240 × 1754 px at 150 per inch), not one long strip.
    const box = (k) => new RegExp(`/${k} \\[([^\\]]+)\\]`).exec(pages[0].dict)[1].split(' ').map(Number);
    const [x0, y0, x1, y1] = box(kind === 'print' ? 'TrimBox' : 'MediaBox');
    assert.ok(Math.abs(x1 - x0 - 595.2) < 0.5 && Math.abs(y1 - y0 - 841.92) < 0.5, `${kind}: an A4 sheet, ${x1 - x0} × ${y1 - y0}`);
    if (kind === 'vector') assert.match(pageContents(pdf).join('\n'), /BT \/F\d+ [\d.]+ Tf .* Tj ET/, 'real text on the sheets');
  }
  assert.ok(counts.vector >= 2, `${counts.vector} sheets`);
  assert.deepEqual(counts, { vector: counts.vector, flat: counts.vector, print: counts.vector }, 'the same sheets in every PDF');
  const { bytes } = await downloadVia(page, () => page.click('[data-testid="export-format"] [data-value="pptx"]'));
  const parts = unzip(bytes);
  const pres = parts.get('ppt/presentation.xml').toString();
  assert.equal([...pres.matchAll(/<p:sldId /g)].length, counts.vector, 'a slide a sheet');
  assert.match(pres, /<p:sldSz cx="7559040" cy="10692384"\/>/, 'slides the size of the sheets');
  assert.equal([...parts.keys()].filter((n) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(n)).length, 1, 'the notes once');
  assert.match(parts.get('ppt/notesSlides/notesSlide1.xml').toString(), /Read it slowly/);
  await context.close();
});

test('[EXP-13] [EXP-15] a whiteboard\'s sticky notes as vectors in the PDF and as notes in PowerPoint', async () => {
  const { page, context } = await newDesign('whiteboard');
  const note = (await state(page, (ed) => ed.pageData.elements)).find((e) => e.note);
  assert.ok(note, 'a whiteboard starts with a sticky note');
  const { bytes } = await downloadVia(page, pdfKind(page, 'vector'));
  const pdf = readPdf(bytes);
  const content = pageContents(pdf).join('\n');
  const rgb = [1, 3, 5].map((i) => Math.round((parseInt(note.note.slice(i, i + 2), 16) / 255) * 1000) / 1000).join(' ');
  assert.ok(content.includes(`${rgb} rg`), `the note's color (${rgb})`);
  assert.match(content, /BT \/F\d+ [\d.]+ Tf .* Tj ET/, 'its words as text');
  assert.ok(find(pdf, /\/Subtype \/Type0/).length >= 1, 'in an embedded font');
  if (has('pdftotext', ['-v'])) {
    const dir = mkdtempSync(join(tmpdir(), 'paperwall-vpdf-'));
    writeFileSync(join(dir, 'a.pdf'), bytes);
    assert.match(execFileSync('pdftotext', ['-enc', 'UTF-8', join(dir, 'a.pdf'), '-']).toString().replace(/\s+/g, ' '), new RegExp(note.text));
  }
  const deck = unzip((await downloadVia(page, () => page.click('[data-testid="export-format"] [data-value="pptx"]'))).bytes);
  const slide = deck.get('ppt/slides/slide1.xml').toString();
  checkXml(slide, 'slide1.xml');
  assert.match(slide, new RegExp(`name="Sticky note \\d+".*<a:srgbClr val="${note.note.slice(1).toUpperCase()}"/>.*<a:t>${note.text}</a:t>`), 'a shape of its color, its text editable inside');
  await context.close();
});

/** Run an export function in the page on a changed copy of the design (page 1); the file's bytes come back. */
async function exportCopy(page, fn, change, opts = {}) {
  const b64 = await page.evaluate(async ([fnName, src, o]) => {
    const { export: ex, editor } = window.paperwall;
    const doc = ex.clone(editor.doc);
    new Function('doc', `return (${src})(doc)`)(doc);
    const blob = await ex[fnName](doc, [0], o);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }, [fn, change.toString(), opts]);
  return Buffer.from(b64, 'base64');
}

test('[EXP-14] print PDF: a background drawn as a picture runs into the bleed too', async () => {
  const { page, context } = await newDesign('flyer');
  // PDF shadings can't be see-through: this background comes as a picture.
  await page.evaluate(() => window.paperwall.editor.setBackground({ type: 'gradient', gradient: { type: 'linear', angle: 90, stops: [{ offset: 0, color: '#0a9396', opacity: 0.9 }, { offset: 1, color: '#0a9396', opacity: 0.9 }] } }));
  const doc = await state(page);
  assert.ok(planVectorPdf(doc, [0], { print: true }).some((w) => w.key === '@bg'), 'the background as a picture');
  const { bytes } = await downloadVia(page, pdfKind(page, 'print'));
  const pdf = readPdf(bytes);
  const [pg] = find(pdf, /\/Type \/Page\b/);
  const box = (k) => new RegExp(`/${k} \\[([^\\]]+)\\]`).exec(pg.dict)[1].split(' ').map(Number);
  const [media, trim, bleed] = [box('MediaBox'), box('TrimBox'), box('BleedBox')];
  const png = renderPdf(bytes, 72);
  if (png) {
    const y = Math.round(media[3] - (trim[1] + trim[3]) / 2);
    const inside = (await pixelAt(page, png, 'image/png', Math.round(trim[2]) - 6, y)).slice(0, 3);
    assert.ok(inside[0] < 100, `the background on the page: ${inside}`);
    for (const x of [(trim[2] + bleed[2]) / 2, (trim[0] + bleed[0]) / 2]) {
      const px = (await pixelAt(page, png, 'image/png', Math.round(x), y)).slice(0, 3);
      assert.ok(px.every((v, i) => Math.abs(v - inside[i]) < 8), `the background in the bleed too: ${px} vs ${inside}`);
    }
    assert.deepEqual((await pixelAt(page, png, 'image/png', Math.round(media[2]) - 2, y)).slice(0, 3), [255, 255, 255], 'paper outside the bleed');
  }
  await context.close();
});

test('[EXP-13] [EXP-14] a design font whose file is gone: its text comes as a picture, the PDF is still made', async () => {
  const { page, context, errors } = await newDesign('square');
  await addText(page);
  await page.evaluate(() => window.paperwall.editor.update({ text: 'Lost font' }));
  const missing = (doc) => {
    // An uploaded font whose stored file is gone (no data).
    doc.assets.lost = { type: 'font', family: 'Lost Font', name: 'lost.woff2' };
    doc.pages[0].elements[0].font = 'Lost Font';
  };
  for (const print of [false, true]) {
    const pdf = readPdf(await exportCopy(page, 'exportVectorPdf', missing, { print }));
    assert.equal(find(pdf, /\/Subtype \/Type0/).length, 0, 'no font for it');
    assert.ok(find(pdf, /\/Subtype \/Image/).length >= 1, 'the text as a picture');
  }
  assert.deepEqual(errors, []);
  await context.close();
});

test('[EXP-15] PowerPoint: a photo whose picture can\'t be read comes as a picture of itself', async () => {
  const { page, context } = await newDesign('slides');
  await uploadImages(page, [await makePng(page, { w: 400, h: 300 })]);
  const bytes = await exportCopy(page, 'exportPptx', (doc) => {
    const photo = doc.pages[0].elements.find((e) => e.type === 'image');
    doc.assets[photo.assetId].dataUrl = 'data:image/png;base64,AAAA'; // not a picture the browser can open
  });
  const slide = unzip(bytes).get('ppt/slides/slide1.xml').toString();
  checkXml(slide, 'slide1.xml');
  assert.equal([...slide.matchAll(/<p:pic>/g)].length, 1, 'not left off the slide');
  await context.close();
});

test('[EXP-13] the flattened PDF splits a document into sheets with its fonts in', async () => {
  const { page, context } = await newDesign('doc');
  // A font the page hasn't loaded yet, much wider than the fallback.
  // (Taller than a sheet: its lines, as measured, decide how many sheets it takes.)
  const wide = (doc) => {
    const el = doc.pages[0].elements[1];
    el.text = 'A long paragraph about the spring fair. '.repeat(120);
    el.font = 'Press Start 2P';
    el.h = 20000;
  };
  const sheets = async (pg, fn) => {
    assert.equal(await pg.evaluate(() => [...document.fonts].some((f) => f.family === 'Press Start 2P' && f.status === 'loaded')), false, 'not loaded yet');
    return find(readPdf(await exportCopy(pg, fn, wide)), /\/Type \/Page\b/).length;
  };
  const flat = await sheets(page, 'exportPdf');
  await context.close();
  // (In a page of its own: nothing measured there before.)
  const other = await newDesign('doc');
  const vector = await sheets(other.page, 'exportVectorPdf');
  assert.ok(vector >= 2, `${vector} sheets`);
  assert.equal(flat, vector, 'the same sheets as the vector PDF');
  await other.context.close();
});

test('[EXP-13] [EXP-15] SVG pictures are drawn at the size they\'re shown, in the PDF and in PowerPoint', async () => {
  const { page, context } = await newDesign('square');
  // A tiny SVG (40 × 30 of its own), shown 600 × 450.
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30" viewBox="0 0 40 30"><rect width="40" height="30" fill="#2a9d8f"/><circle cx="20" cy="15" r="10" fill="#e9c46a"/></svg>';
  await uploadImages(page, [{ name: 'logo.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(svg) }]);
  await page.evaluate(() => window.paperwall.editor.update({ x: 100, y: 100, w: 600, h: 450 }));
  const doc = await state(page);
  assert.equal(rasterScale(doc), 2);
  const widths = (pdf) => find(pdf, /\/Subtype \/Image/).map((o) => +/\/Width (\d+)/.exec(o.dict)[1]);
  const pdf = readPdf((await downloadVia(page, pdfKind(page, 'vector'))).bytes);
  assert.deepEqual(widths(pdf), [1200], 'shown 600 px wide, at twice that');
  const deck = unzip((await downloadVia(page, () => page.click('[data-testid="export-format"] [data-value="pptx"]'))).bytes);
  const pngs = [...deck.keys()].filter((n) => n.startsWith('ppt/media/'));
  assert.equal(pngs.length, 1);
  assert.deepEqual([deck.get(pngs[0]).readUInt32BE(16), deck.get(pngs[0]).readUInt32BE(20)], [1200, 900]);
  // One with no size of its own (just a viewBox): its shape from the viewBox, not a blank 1 × 1.
  const bare = (d) => {
    const el = d.pages[0].elements.find((e) => e.type === 'image');
    d.assets[el.assetId].dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 30"><rect width="40" height="30" fill="#2a9d8f"/></svg>')}`;
  };
  const one = readPdf(await exportCopy(page, 'exportVectorPdf', bare));
  const [img] = find(one, /\/Subtype \/Image/);
  assert.match(img.dict, /\/Width 1200 \/Height 900 /);
  const png = renderPdf(await exportCopy(page, 'exportVectorPdf', bare), 72);
  if (png) {
    // The middle of the picture is its color, not blank (600 px at 96 per inch: 450 pt).
    const at = Math.round((100 + 300) * 0.75);
    const px = (await pixelAt(page, png, 'image/png', at, at)).slice(0, 3);
    assert.ok(Math.abs(px[0] - 0x2a) < 6 && Math.abs(px[1] - 0x9d) < 6 && Math.abs(px[2] - 0x8f) < 6, `${px}`);
  }
  await context.close();
});

test('[EXP-14] print PDF photos are as sharp as 300 DPI needs where they\'re shown', async () => {
  const { page, context } = await newDesign('a4');
  // A 5000 × 3000 PNG, cropped to its middle and shown the A4's width: 4960 px of it at 300 DPI.
  await uploadImages(page, [await makePng(page, { w: 5000, h: 3000 })]);
  await page.evaluate(() => window.paperwall.editor.update({ x: 0, y: 0, w: 2480, h: 1488, crop: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } }));
  const doc = await state(page);
  assert.equal(rasterScale(doc, { print: true }), 1, 'an A4 design is 300 per inch already');
  const size = (bytes) => /\/Width (\d+) \/Height (\d+)/.exec(find(readPdf(bytes), /\/Subtype \/Image/)[0].dict).slice(1).map(Number);
  assert.deepEqual(size(await exportCopy(page, 'exportVectorPdf', () => {}, { print: true })), [4960, 2976], 'what 300 DPI needs, not 4096');
  assert.deepEqual(size(await exportCopy(page, 'exportVectorPdf', () => {})), [4096, 2458], 'the screen PDF as before');
  // Shown smaller, only as much as it needs.
  const small = (d) => Object.assign(d.pages[0].elements[0], { w: 1240, h: 744, crop: null });
  assert.deepEqual(size(await exportCopy(page, 'exportVectorPdf', small, { print: true })), [1240, 744]);
  await context.close();
});

test('[EXP-15] PowerPoint: a background photo that can\'t be read comes as a picture of the background', async () => {
  const { page, context } = await newDesign('slides');
  const bytes = await exportCopy(page, 'exportPptx', (d) => {
    d.assets.broken = { type: 'image', mime: 'image/png', dataUrl: 'data:image/png;base64,AAAA', width: 1920, height: 1080 };
    d.pages[0].background = { type: 'image', assetId: 'broken', color: '#264653' };
  });
  const deck = unzip(bytes);
  const slide = deck.get('ppt/slides/slide1.xml').toString();
  checkXml(slide, 'slide1.xml');
  assert.match(slide, /<p:spTree>.*?<\/p:grpSpPr><p:pic>.*?<a:off x="0" y="0"\/><a:ext cx="18288000" cy="10287000"\/>/, 'a picture of the whole background, behind everything');
  const media = [...deck.keys()].filter((n) => n.startsWith('ppt/media/'));
  assert.equal(media.length, 1);
  await context.close();
});

test('[EXP-14] print PDF: a background photo is as sharp as 300 DPI needs over the bleed too', async () => {
  const { page, context } = await newDesign('a4');
  await uploadImages(page, [await makePng(page, { w: 3000, h: 4000 })]);
  const toBackground = (d) => {
    const p = d.pages[0];
    const photo = p.elements.find((el) => el.type === 'image');
    p.background = { type: 'image', assetId: photo.assetId, color: '#ffffff' };
    p.elements = [];
  };
  const doc = await state(page);
  const bleed = (3 / 25.4) * 300; // 3 mm at 300 per inch, in page px
  // Covering the page and its bleed, 2480 + 2 × bleed by 3508 + 2 × bleed, at the photo's 3:4.
  const s = Math.max((doc.width + bleed * 2) / 3000, (doc.height + bleed * 2) / 4000);
  const [img] = find(readPdf(await exportCopy(page, 'exportVectorPdf', toBackground, { print: true })), /\/Subtype \/Image/);
  assert.match(img.dict, new RegExp(`/Width ${Math.round(3000 * s)} /Height ${Math.round(4000 * s)} `), img.dict);
  await context.close();
});

test('[EXP-13] [EXP-15] the PDF and PowerPoint are of the design as it was when Download was pressed', async () => {
  const { page, context } = await newDesign('slides');
  await addText(page);
  await page.evaluate(() => window.paperwall.editor.update({ text: 'Before' }));
  // A glowing word: a picture to draw, so the file takes a moment.
  await addText(page, 'body');
  await page.evaluate(() => window.paperwall.editor.update({ text: 'Glow', effect: { type: 'glow', color: '#ffcc00' } }));
  const id = (await state(page)).pages[0].elements[0].id;
  for (const fmt of ['pptx', 'pdf']) {
    await page.click('[data-testid="download"]');
    await page.waitForSelector('[data-testid="export-dialog"]');
    await page.click(`[data-testid="export-format"] [data-value="${fmt}"]`);
    const dl = page.waitForEvent('download');
    await page.click('[data-testid="export-download"]');
    // An edit while it's being made.
    await page.evaluate((el) => window.paperwall.editor.update({ text: 'After' }, null, [el]), id);
    const bytes = readFileSync(await (await dl).path());
    if (fmt === 'pptx') {
      const slide = unzip(bytes).get('ppt/slides/slide1.xml').toString();
      assert.match(slide, /<a:t>Before<\/a:t>/);
      assert.doesNotMatch(slide, /After/);
    } else if (has('pdftotext', ['-v'])) {
      const dir = mkdtempSync(join(tmpdir(), 'paperwall-vpdf-'));
      writeFileSync(join(dir, 'a.pdf'), bytes);
      const text = execFileSync('pdftotext', [join(dir, 'a.pdf'), '-']).toString();
      assert.match(text, /Before/);
      assert.doesNotMatch(text, /After/);
    }
    await page.evaluate((el) => window.paperwall.editor.update({ text: 'Before' }, null, [el]), id);
  }
  await context.close();
});

test('[EXP-13] a glowing heading drawn as a picture is still selectable and searchable text, once', async () => {
  const { page, context } = await newDesign('a4');
  await addText(page);
  await page.evaluate(() => window.paperwall.editor.update({ text: 'Lanterns over the harbour', effect: { type: 'glow', color: '#ffcc00' } }));
  const doc = await state(page);
  assert.deepEqual(planVectorPdf(doc, [0], {}).map((w) => w.key), [doc.pages[0].elements[0].id], 'drawn as a picture');
  for (const kind of ['vector', 'print']) {
    const { bytes } = await downloadVia(page, pdfKind(page, kind));
    if (!has('pdftotext', ['-v'])) break;
    const dir = mkdtempSync(join(tmpdir(), 'paperwall-vpdf-'));
    writeFileSync(join(dir, 'a.pdf'), bytes);
    const text = execFileSync('pdftotext', ['-enc', 'UTF-8', join(dir, 'a.pdf'), '-']).toString().replace(/\s+/g, ' ');
    assert.equal(text.match(/Lanterns over the harbour/g)?.length, 1, `${kind}: ${text}`);
  }
  await context.close();
});
