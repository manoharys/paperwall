// Quality checks for designs, used as the gate every template must pass:
// no word broken across lines, text inside the page, text boxes not on top
// of each other, and readable contrast against whatever is behind the text.

import { layoutText } from './text-layout.js';
import { boundsOf, rectsIntersect } from './geometry.js';
import { hexToRgb, contrast } from './color.js';

/** A representative color for a fill: the color itself, or the average of a gradient. */
export function paintColor(p) {
  if (typeof p === 'string') return hexToRgb(p);
  if (p && Array.isArray(p.stops) && p.stops.length) {
    const cs = p.stops.map((s) => hexToRgb(s.color)).filter(Boolean);
    if (!cs.length) return null;
    return [0, 1, 2].map((k) => cs.reduce((s, c) => s + c[k], 0) / cs.length);
  }
  return null;
}

/** For gradients, the worst case: the stop with the lowest contrast to the text. */
function worstContrast(text, fill) {
  if (typeof fill === 'string') return contrast(text, hexToRgb(fill));
  const cs = (fill?.stops || []).map((s) => hexToRgb(s.color)).filter(Boolean);
  return cs.length ? Math.min(...cs.map((c) => contrast(text, c))) : 21;
}

function backdropFor(page, index, el) {
  const b = boundsOf(el);
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  for (let i = index - 1; i >= 0; i--) {
    const o = page.elements[i];
    if (o.hidden || (o.opacity ?? 1) < 0.85) continue;
    const ob = boundsOf(o);
    if (cx < ob.x || cx > ob.x + ob.w || cy < ob.y || cy > ob.y + ob.h) continue;
    if (o.type === 'shape' && o.shape === 'ellipse' && !o.rotation) {
      const dx = (cx - (ob.x + ob.w / 2)) / (ob.w / 2);
      const dy = (cy - (ob.y + ob.h / 2)) / (ob.h / 2);
      if (dx * dx + dy * dy > 1) continue;
    }
    if (o.type === 'shape' && o.fill) return o.fill;
    if (o.type === 'text' && o.highlight) return o.highlight.color;
    // Pictures, groups, tables and codes have many colors: can't judge, so don't guess.
    if (['image', 'sticker', 'chart', 'group', 'table', 'qr'].includes(o.type)) return null;
  }
  const bg = page.background;
  if (bg?.type === 'color') return bg.color;
  if (bg?.type === 'gradient') return bg.gradient;
  return null;
}

/**
 * Problems on one page, each { id, kind, message }. An empty list means the
 * page passes.
 */
export function lintPage(doc, pageIndex, measure, { minContrast = 3, overlapShare = 0.06 } = {}) {
  const page = doc.pages[pageIndex];
  const issues = [];
  const texts = [];
  page.elements.forEach((el, i) => {
    if (el.hidden || el.type !== 'text') return;
    texts.push(el);
    const { brokeWord } = layoutText(el, measure);
    if (brokeWord && !el.curve) issues.push({ id: el.id, kind: 'broken-word', message: `"${el.text.slice(0, 30)}" breaks a word across lines` });
    const b = boundsOf(el);
    if (b.x < -1 || b.y < -1 || b.x + b.w > doc.width + 1 || b.y + b.h > doc.height + 1) {
      issues.push({ id: el.id, kind: 'off-page', message: `"${el.text.slice(0, 30)}" goes past the edge of the page` });
    }
    const textColor = hexToRgb(el.color);
    const behind = el.highlight ? el.highlight.color : backdropFor(page, i, el);
    if (textColor && behind && !el.outline) {
      const ratio = worstContrast(textColor, behind);
      if (ratio < minContrast) issues.push({ id: el.id, kind: 'contrast', message: `"${el.text.slice(0, 30)}" has low contrast (${ratio.toFixed(2)}:1)` });
    }
  });
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const a = boundsOf(texts[i]);
      const b = boundsOf(texts[j]);
      if (!rectsIntersect(a, b)) continue;
      const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      const share = (ix * iy) / Math.min(a.w * a.h, b.w * b.h);
      if (share > overlapShare) issues.push({ id: texts[j].id, kind: 'overlap', message: `"${texts[i].text.slice(0, 20)}" and "${texts[j].text.slice(0, 20)}" overlap` });
    }
  }
  return issues;
}

export function lintDesign(doc, measure, opts) {
  return doc.pages.flatMap((_, i) => lintPage(doc, i, measure, opts).map((x) => ({ ...x, page: i })));
}
