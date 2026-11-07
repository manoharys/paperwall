import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { newDesign, state, elements, teardown, openTab, downloadVia, makePng, uploadImages, mod } from './helpers.js';

after(teardown);

test('[DW-01] [DW-03] a document: blocks flow as you write, and it prints on sheets', async () => {
  const { page, context } = await newDesign('doc');
  await openTab(page, 'text');
  await page.click('[data-testid="doc-add-heading"]');
  await page.click('[data-testid="doc-add-bullets"]');
  let els = await elements(page);
  assert.equal(els.length, 4, 'title, paragraph, heading, list');
  const ys = els.map((e) => e.y);
  assert.deepEqual([...ys].sort((a, b) => a - b), ys, 'in order, top to bottom');
  // Write a lot in the paragraph: what follows moves down, and the page grows.
  const before = await state(page, (ed) => ({ h: ed.doc.height, y: ed.pageData.elements[3].y }));
  await page.evaluate(() => {
    const ed = window.paperwall.editor;
    ed.update({ text: 'A long paragraph. '.repeat(900) }, null, [ed.pageData.elements[1].id]);
  });
  const now = await state(page, (ed) => ({ h: ed.doc.height, y: ed.pageData.elements[3].y }));
  assert.ok(now.y > before.y, 'the list moved down');
  assert.ok(now.h > before.h, `the page grew (${before.h} → ${now.h})`);
  // As a PDF: sheets of paper.
  const { bytes } = await downloadVia(page, () => page.click('[data-testid="export-format"] [data-value="pdf"]'));
  const sheets = Number(bytes.toString('latin1').match(/\/Count (\d+)/)[1]);
  assert.ok(sheets >= 2, `${sheets} sheets`);
  await context.close();
});

test('[DW-02] a picture in a document fills its width; dragging a block moves it', async () => {
  const { page, context } = await newDesign('doc');
  await uploadImages(page, [await makePng(page, { w: 400, h: 200 })]);
  await page.waitForFunction(() => window.paperwall.editor.pageData.elements.some((e) => e.type === 'image'));
  let els = await elements(page);
  const pic = els.find((e) => e.type === 'image');
  const width = await state(page, (ed) => ed.doc.width - ed.doc.document.margin * 2);
  assert.equal(pic.w, width);
  assert.equal(els[els.length - 1].id, pic.id, 'added at the end');
  // Moved above the title (as a drag ends): it comes first.
  await page.evaluate((id) => window.paperwall.editor.update({ y: -100 }, null, [id]), pic.id);
  els = await elements(page);
  const order = [...els].sort((a, b) => a.y - b.y).map((e) => e.id);
  assert.equal(order[0], pic.id);
  await context.close();
});

test('[DW-04] [DW-05] a whiteboard: sticky notes in colors, lines between them, and room to grow', async () => {
  const { page, context } = await newDesign('whiteboard');
  await openTab(page, 'text');
  await page.click('[data-testid="note-add-2"]');
  let els = await elements(page);
  const note = els[els.length - 1];
  assert.ok(note.note, 'a sticky note');
  // Its color changes in the panel.
  await page.click('[data-testid="note-color-4"]');
  assert.equal((await elements(page)).find((e) => e.id === note.id).note, '#ffd1a1');
  const colors = await state(page, (ed) => ed.pageData.elements.map((e) => e.note).filter(Boolean));
  assert.equal(new Set(colors).size, 2, 'two notes, two colors');
  // Written on: double-click and type.
  await page.dblclick(`[data-testid="page"] [data-id="${note.id}"]`);
  await page.waitForSelector('[data-testid="text-editor"]');
  await page.keyboard.press(`${mod}+a`);
  await page.keyboard.type('Ship it');
  await page.keyboard.press('Escape');
  assert.equal((await elements(page)).find((e) => e.id === note.id).text, 'Ship it');
  // A line from one note to the other.
  await page.evaluate(() => {
    const ed = window.paperwall.editor;
    ed.connect(ed.pageData.elements.filter((e) => e.note).map((e) => e.id));
  });
  assert.ok((await elements(page)).some((e) => e.type === 'connector'), 'a line between the notes');
  // Something near the far edge: the board grows.
  const size = await state(page, (ed) => [ed.doc.width, ed.doc.height]);
  await page.evaluate(([w, h]) => {
    const ed = window.paperwall.editor;
    const n = ed.pageData.elements.find((e) => e.note);
    ed.update({ x: w - 200, y: h - 200 }, null, [n.id]);
  }, size);
  const grown = await state(page, (ed) => [ed.doc.width, ed.doc.height]);
  assert.ok(grown[0] > size[0] && grown[1] > size[1], `grew: ${size} → ${grown}`);
  await context.close();
});
