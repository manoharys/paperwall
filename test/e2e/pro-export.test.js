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
