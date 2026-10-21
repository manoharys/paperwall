// Documents and whiteboards: two ways a design arranges itself.
// A document's blocks (headings, paragraphs, lists, pictures, anything)
// flow down its page in order, and the page grows as they do; on paper it's
// split into sheets between blocks. A whiteboard's canvas grows as things
// are added near its edges.

import { fitHeight, layoutText, approxMeasure } from './text-layout.js';
import { clone } from './doc.js';
import { scaleElement } from './commands.js';

export const DOCUMENT = { pageHeight: 1754, margin: 120, gap: 28, dpi: 150 };
export const BOARD = { grow: 1200, edge: 400, max: 24000 };

/** The blocks of a page in flow order: top to bottom (as last placed). Lines between things follow them, so aren't blocks. */
function blocks(page) {
  return page.elements.filter((el) => !el.hidden && el.type !== 'connector').map((el, i) => ({ el, i })).sort((a, b) => a.el.y - b.el.y || a.i - b.i).map((b) => b.el);
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
        // Smaller as a whole (a group's insides too).
        scaleElement(el, inner / el.w, inner / el.w);
        changed = true;
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
 * blocks into pages a sheet tall. Text taller than a sheet goes on over the
 * next sheets, in whole lines; anything else that tall is made to fit one.
 * A new design; the document itself is left as it is.
 */
export function paginate(doc, measure = approxMeasure) {
  const opts = { ...DOCUMENT, ...doc.document };
  const room = opts.pageHeight - opts.margin * 2; // a sheet's height for blocks
  // (Shallow: the files aren't copied, just shared.)
  const out = { ...doc, height: opts.pageHeight, document: undefined, dpi: opts.dpi, pages: [] };
  for (const page of doc.pages) {
    let sheet = null;
    let top = 0; // where this sheet starts on the long page
    const where = new Map(); // block id → the sheet and its top, for the lines between them
    const start = (y) => {
      sheet = { ...page, id: `${page.id}-${out.pages.length + 1}`, elements: [] };
      out.pages.push(sheet);
      top = y - opts.margin;
    };
    const place = (el) => {
      sheet.elements.push({ ...clone(el), y: el.y - top });
      where.set(el.id, { sheet, top });
    };
    start(opts.margin);
    for (const el of blocks(page)) {
      if (el.h <= room) {
        if (el.y + el.h - top > opts.pageHeight - opts.margin && sheet.elements.length) start(el.y);
        place(el);
        continue;
      }
      // Too tall for a sheet: text goes on over as many sheets as it takes,
      // anything else is made to fit one. What follows goes just below the
      // last of it.
      if (sheet.elements.length) start(el.y);
      const pieces = el.type === 'text' && !el.curve
        ? textPieces(el, room, measure)
        : [{ ...el, w: el.w * (room / el.h), h: room, x: el.x + (el.w - el.w * (room / el.h)) / 2 }];
      pieces.forEach((piece, k) => {
        if (k > 0) start(0);
        sheet.elements.push({ ...clone(piece), y: opts.margin });
        if (k === 0) where.set(el.id, { sheet, top: el.y - opts.margin });
      });
      const lastH = pieces[pieces.length - 1].h;
      top = el.y + el.h - (opts.margin + lastH);
    }
    // Lines between blocks: on the sheet of what they start from.
    for (const el of page.elements) {
      if (el.hidden || el.type !== 'connector') continue;
      const at = where.get(el.start?.id) || where.get(el.end?.id);
      if (at) at.sheet.elements.push({ ...clone(el), y: el.y - at.top });
    }
  }
  return out;
}

/** A text block cut into pieces at most `room` tall, in whole lines (a paragraph cut goes on in the next). */
function textPieces(el, room, measure) {
  const { lines, lineHeight } = layoutText(el, measure);
  const per = Math.max(1, Math.floor(room / lineHeight));
  const pieces = [];
  let items = 0; // list items so far (a numbered list carries on counting)
  for (let i = 0; i < lines.length; i += per) {
    const chunk = lines.slice(i, i + per);
    // Lines of a paragraph join with a space, a word broken over lines with nothing.
    const text = chunk.reduce((t, l, k) => (k === 0 ? l.text : `${t}${l.start ? '\n' : l.glue ? '' : ' '}${l.text}`), '');
    // A piece that starts inside a paragraph goes on with it (no new bullet or number).
    const piece = { ...el, id: `${el.id}-${pieces.length + 1}`, text, listStart: items + 1, continues: !chunk[0].start };
    // (An item it goes on with was counted with the piece before.)
    items += chunk.filter((l, k) => l.start && l.text.trim() && !(k === 0 && piece.continues)).length;
    piece.h = fitHeight(piece, measure);
    pieces.push(piece);
  }
  return pieces;
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
