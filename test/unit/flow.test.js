import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDesignFromPreset, createText, createImage, createSticky, validateDesign, DOC_STYLES } from '../../src/model/doc.js';
import { flowDocument, paginate, growBoard, DOCUMENT } from '../../src/model/flow.js';
import { approxMeasure, layoutText, fitHeight } from '../../src/model/text-layout.js';
import { renderPage } from '../../src/model/render.js';

test('[DW-01] a document flows its blocks down the page, as wide as the page, and grows', () => {
  const doc = createDesignFromPreset('doc');
  assert.ok(doc.document, 'a document');
  const page = doc.pages[0];
  page.elements.push(createText({ ...DOC_STYLES.bullets, y: 5 }));
  flowDocument(doc, approxMeasure);
  const [title, body, list] = page.elements;
  const inner = doc.width - DOCUMENT.margin * 2;
  assert.deepEqual([title.x, title.y, title.w], [DOCUMENT.margin, DOCUMENT.margin, inner]);
  assert.equal(body.y, title.y + title.h + DOCUMENT.gap, 'one after another');
  assert.equal(list.y, body.y + body.h + DOCUMENT.gap);
  // Lots of words: the page grows to hold them.
  body.text = 'Words '.repeat(3000);
  flowDocument(doc, approxMeasure);
  assert.ok(doc.height > DOCUMENT.pageHeight, `grew to ${doc.height}`);
  assert.equal(list.y, body.y + body.h + DOCUMENT.gap, 'later blocks move down');
  assert.ok(doc.height >= list.y + list.h + DOCUMENT.margin);
});

test('[DW-02] in a document, pictures are as wide as the page and blocks move by where they are dropped', () => {
  const doc = createDesignFromPreset('doc');
  const page = doc.pages[0];
  doc.assets.a = { type: 'image', dataUrl: 'data:image/png;base64,AA==', width: 400, height: 200 };
  page.elements.push(createImage('a', { w: 400, h: 200, y: 99999 }));
  flowDocument(doc, approxMeasure);
  const pic = page.elements[2];
  assert.equal(pic.w, doc.width - DOCUMENT.margin * 2);
  assert.equal(pic.h, Math.round(pic.w / 2), 'keeps its shape');
  // Dragged above the title: it comes first.
  pic.y = -50;
  flowDocument(doc, approxMeasure);
  assert.equal(pic.y, DOCUMENT.margin);
  assert.ok(page.elements[0].y > pic.y);
});

test('[DW-03] on paper, a document is split into sheets between its blocks', () => {
  const doc = createDesignFromPreset('doc');
  const page = doc.pages[0];
  for (let i = 0; i < 12; i++) page.elements.push(createText({ ...DOC_STYLES.body, text: `Paragraph ${i} `.repeat(40), y: 10 + i }));
  flowDocument(doc, approxMeasure);
  const paper = paginate(doc);
  assert.ok(paper.pages.length > 1, `${paper.pages.length} sheets`);
  assert.equal(paper.height, DOCUMENT.pageHeight);
  assert.equal(paper.document, undefined);
  const count = paper.pages.reduce((n, p) => n + p.elements.length, 0);
  assert.equal(count, page.elements.length, 'every block once');
  for (const sheet of paper.pages) {
    for (const el of sheet.elements) {
      assert.ok(el.y >= DOCUMENT.margin - 0.01, 'below the top margin');
      if (sheet.elements.length > 1) assert.ok(el.y + el.h <= DOCUMENT.pageHeight - DOCUMENT.margin + 0.01, 'whole blocks only');
    }
  }
  assert.equal(doc.pages.length, 1, 'the document itself is unchanged');
});

test('[DW-04] a whiteboard grows when something is put near its edges', () => {
  const doc = createDesignFromPreset('whiteboard');
  assert.equal(doc.board, true);
  const w = doc.width;
  const h = doc.height;
  assert.equal(growBoard(doc), false, 'nothing near the edges yet');
  doc.pages[0].elements.push(createSticky(undefined, { x: w - 300, y: h - 100 }));
  assert.equal(growBoard(doc), true);
  assert.ok(doc.width > w && doc.height > h);
});

test('[DW-05] a sticky note: text inside a square of color, its color checked when opened', () => {
  const doc = createDesignFromPreset('whiteboard');
  const note = doc.pages[0].elements[0];
  assert.ok(note.note);
  assert.ok(layoutText(note, approxMeasure).lines.every((l) => l.width <= note.w - 32), 'wraps inside its edges');
  assert.ok(fitHeight(note, approxMeasure) >= note.w, 'keeps its square');
  const svg = renderPage(doc, 0);
  assert.match(svg, new RegExp(`fill="${note.note}"`));
  note.note = 'url(javascript:x)';
  validateDesign(doc);
  assert.equal(doc.pages[0].elements[0].note, undefined, 'not a color: a plain text box');
});
