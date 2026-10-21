// Documents and whiteboards: two ways a design arranges itself.
// A document's blocks (headings, paragraphs, lists, pictures, anything)
// flow down its page in order, and the page grows as they do; on paper it's
// split into sheets between blocks. A whiteboard's canvas grows as things
// are added near its edges.

import { fitHeight, layoutText, approxMeasure, notePad } from './text-layout.js';
import { clone } from './doc.js';
import { scaleElement } from './commands.js';

import { DOCUMENT } from './doc.js';

export { DOCUMENT };
export const BOARD = { grow: 1200, edge: 400, max: 24000 };

/** The blocks of a page in flow order: top to bottom (as last placed). Lines joined to things follow them, so aren't blocks (a free line is one). */
const joined = (el) => el.type === 'connector' && (el.start?.id || el.end?.id);
function blocks(page) {
  return page.elements.filter((el) => !el.hidden && !joined(el)).map((el, i) => ({ el, i })).sort((a, b) => a.el.y - b.el.y || a.i - b.i).map((b) => b.el);
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
    const reshaped = new Set(); // blocks split over sheets or made smaller
    const bottomOf = (sh) => sh.elements.reduce((b, e) => Math.max(b, e.y + e.h), 0);
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
      // Too tall for a sheet: text goes on over as many sheets as it takes
      // (starting in the room left on this one), anything else is made to
      // fit one. What follows goes just below the last of it. (Lines joined
      // to it are left out: it's no longer where they meet it.)
      reshaped.add(el.id);
      const isText = el.type === 'text' && !el.curve;
      let at = sheet.elements.length ? bottomOf(sheet) + opts.gap : opts.margin;
      let first = opts.pageHeight - opts.margin - at;
      if (!isText || first < el.size * (el.lineHeight || 1.2) * 3) {
        if (sheet.elements.length) start(el.y);
        at = opts.margin;
        first = room;
      }
      const pieces = isText ? textPieces(el, room, measure, first) : [fitted(el, room / el.h)];
      pieces.forEach((piece, k) => {
        if (k > 0) {
          start(0);
          at = opts.margin;
        }
        sheet.elements.push({ ...clone(piece), y: at });
      });
      top = el.y + el.h - (at + pieces[pieces.length - 1].h);
    }
    // Lines between blocks on the same sheet go on it (one between sheets can't be drawn).
    for (const el of page.elements) {
      if (el.hidden || el.type !== 'connector') continue;
      if (reshaped.has(el.start?.id) || reshaped.has(el.end?.id)) continue;
      const a = where.get(el.start?.id);
      const b = where.get(el.end?.id);
      const at = a || b;
      if (at && (!a || !b || a.sheet === b.sheet)) at.sheet.elements.push({ ...clone(el), y: el.y - at.top });
    }
  }
  return out;
}

/** A copy of a block made smaller as a whole (a group's insides, a table's text too), kept centred. */
function fitted(el, s) {
  const copy = clone(el);
  scaleElement(copy, s, s);
  copy.x = el.x + (el.w - copy.w) / 2;
  return copy;
}

/** A text block cut into pieces at most `room` tall, in whole lines (a paragraph cut goes on in the next). */
function textPieces(el, room, measure, first = room) {
  const { lines, lineHeight } = layoutText(el, measure);
  // (Inside a highlight's padding, or a sticky note's edges.)
  const pad = (el.highlight ? el.highlight.padding ?? 0 : 0) + notePad(el);
  const fits = (h) => Math.max(1, Math.floor((h - pad * 2) / lineHeight));
  const pieces = [];
  let items = 0; // list items so far (a numbered list carries on counting)
  // (The first piece takes the room left on its sheet; the rest, whole sheets.)
  for (let i = 0, per = fits(first); i < lines.length; i += per, per = fits(room)) {
    const chunk = lines.slice(i, i + per);
    // Lines of a paragraph join with a space, a word broken over lines with nothing.
    const text = chunk.reduce((t, l, k) => (k === 0 ? l.text : `${t}${l.start ? '\n' : l.glue ? '' : ' '}${l.text}`), '');
    // A piece that starts inside a paragraph goes on with it (no new bullet or number).
    const piece = { ...el, id: `${el.id}-${pieces.length + 1}`, text, listStart: items + 1, continues: !chunk[0].start };
    // (An item it goes on with was counted with the piece before.)
    items += chunk.filter((l, k) => l.start && l.text.trim() && !(k === 0 && piece.continues)).length;
    piece.h = Math.min(pieces.length ? room : first, Math.ceil(chunk.length * lineHeight + pad * 2));
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
