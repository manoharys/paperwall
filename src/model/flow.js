// Documents and whiteboards: two ways a design arranges itself.
// A document's blocks (headings, paragraphs, lists, pictures, anything)
// flow down its page in order, and the page grows as they do; on paper it's
// split into sheets between blocks. A whiteboard's canvas grows as things
// are added near its edges.

import { fitHeight } from './text-layout.js';
import { clone } from './doc.js';

export const DOCUMENT = { pageHeight: 1754, margin: 120, gap: 28 };
export const BOARD = { grow: 1200, edge: 400, max: 24000 };

/** The blocks of a page in flow order: top to bottom (as last placed). */
function blocks(page) {
  return page.elements.filter((el) => !el.hidden).map((el, i) => ({ el, i })).sort((a, b) => a.el.y - b.el.y || a.i - b.i).map((b) => b.el);
}

/**
 * Lay a document out: each block on its own line, one after another down the
 * page, text as wide as the page allows (and as tall as its words), pictures
 * and videos as wide too (keeping their shape), anything else kept to the
 * page. The page grows (never below a sheet) to fit. Returns whether anything moved.
 */
export function flowDocument(doc, measure) {
  const opts = { ...DOCUMENT, ...doc.document };
  const inner = doc.width - opts.margin * 2;
  let height = opts.pageHeight;
  let changed = false;
  const set = (el, k, v) => {
    if (Math.abs((el[k] ?? 0) - v) > 0.01) {
      el[k] = v;
      changed = true;
    }
  };
  for (const page of doc.pages) {
    let y = opts.margin;
    for (const el of blocks(page)) {
      if (el.type === 'text' && !el.curve) {
        set(el, 'w', inner);
        set(el, 'h', fitHeight(el, measure));
      } else if (el.type === 'image' || el.type === 'video') {
        const ratio = el.h / el.w || 1;
        set(el, 'w', inner);
        set(el, 'h', Math.round(inner * ratio));
      } else if (el.w > inner) {
        const s = inner / el.w;
        set(el, 'w', inner);
        set(el, 'h', Math.round(el.h * s));
      }
      set(el, 'x', opts.margin);
      set(el, 'y', y);
      set(el, 'rotation', 0);
      y += el.h + opts.gap;
    }
    height = Math.max(height, Math.ceil(y - opts.gap + opts.margin));
  }
  if (doc.height !== height) {
    doc.height = height;
    changed = true;
  }
  return changed;
}

/**
 * A document as sheets of paper, for PDF and print: each page split between
 * blocks into pages a sheet tall (a block taller than a sheet gets one of
 * its own). A new design; the document itself is left as it is.
 */
export function paginate(doc) {
  const opts = { ...DOCUMENT, ...doc.document };
  const out = clone(doc);
  out.height = opts.pageHeight;
  delete out.document;
  out.pages = [];
  for (const page of doc.pages) {
    let sheet = null;
    let top = 0; // where this sheet starts on the long page
    const start = (y) => {
      sheet = { ...clone({ ...page, elements: [] }), id: `${page.id}-${out.pages.length + 1}` };
      out.pages.push(sheet);
      top = y - opts.margin;
    };
    start(opts.margin);
    for (const el of blocks(page)) {
      const bottom = el.y + el.h - top;
      if (bottom > opts.pageHeight - opts.margin && sheet.elements.length) start(el.y);
      sheet.elements.push({ ...clone(el), y: el.y - top });
    }
  }
  return out;
}

/**
 * Let a whiteboard grow: when something is placed near its right or bottom
 * edge, the canvas gets bigger that way. Returns whether it grew.
 */
export function growBoard(doc) {
  let right = 0;
  let bottom = 0;
  for (const page of doc.pages) {
    for (const el of page.elements) {
      right = Math.max(right, el.x + el.w);
      bottom = Math.max(bottom, el.y + el.h);
    }
  }
  let grew = false;
  while (right > doc.width - BOARD.edge && doc.width < BOARD.max) {
    doc.width = Math.min(BOARD.max, doc.width + BOARD.grow);
    grew = true;
  }
  while (bottom > doc.height - BOARD.edge && doc.height < BOARD.max) {
    doc.height = Math.min(BOARD.max, doc.height + BOARD.grow);
    grew = true;
  }
  return grew;
}
