// Layout for templates: text that shrinks to fit, and blocks that stack in a
// region. A template marks text with `fit` and groups elements into `flows`;
// layoutDesign() runs with real font measurements, then removes the marks so
// the result is an ordinary design.

import { layoutText, fitHeight } from './text-layout.js';

/** Shrink text until it fits in `maxLines` lines without breaking a word. */
export function shrinkToFit(el, measure, { maxLines = Infinity, minSize = 8, maxHeight = Infinity } = {}) {
  for (let i = 0; i < 80; i++) {
    const { lines, brokeWord, height } = layoutText(el, measure);
    el.h = Math.ceil(height + (el.highlight ? (el.highlight.padding ?? 0) * 2 : 0)); // as fitHeight()
    if (!brokeWord && lines.length <= maxLines && el.h <= maxHeight) return true;
    if (el.size <= minSize) return false;
    shrink(el, 0.95, minSize);
  }
  return false;
}

function shrink(el, k, minSize = 8) {
  el.size = Math.max(minSize, Math.round(el.size * k * 100) / 100);
  if (el.letterSpacing) el.letterSpacing = Math.round(el.letterSpacing * k * 100) / 100;
  if (el.highlight) el.highlight = { ...el.highlight, padding: Math.round((el.highlight.padding ?? 0) * k * 100) / 100 };
}

function flowHeight(items) {
  return items.reduce((s, el, i) => s + el.h + (i ? el.gap ?? 0 : 0), 0);
}

/**
 * Lay out every page: fit text, then stack each flow inside its region
 * (top, center or bottom), shrinking its text further if the stack is too tall.
 */
export function layoutDesign(doc, measure) {
  for (const page of doc.pages) {
    for (const el of page.elements) {
      if (el.type !== 'text') continue;
      if (el.fit) shrinkToFit(el, measure, el.fit);
      else el.h = fitHeight(el, measure);
    }
    for (const [name, region] of Object.entries(page.flows || {})) {
      const items = page.elements.filter((el) => el.flow === name);
      // Too tall: shrink the biggest text first (usually the headline), so
      // small print keeps its size for as long as possible.
      for (let i = 0; i < 120 && flowHeight(items) > region.h; i++) {
        const texts = items.filter((el) => el.type === 'text' && el.fit && el.size > (el.fit.minSize || 8));
        if (!texts.length) break;
        const biggest = Math.max(...texts.map((el) => el.size));
        for (const el of texts) {
          if (el.size < biggest * 0.7) continue;
          shrink(el, 0.95, el.fit.minSize || 8);
          shrinkToFit(el, measure, el.fit);
        }
      }
      const total = flowHeight(items);
      let y = region.y;
      if (region.align === 'center') y = region.y + (region.h - total) / 2;
      else if (region.align === 'bottom') y = region.y + region.h - total;
      items.forEach((el, i) => {
        if (i) y += el.gap ?? 0;
        el.y = Math.round(y);
        y += el.h;
      });
    }
    delete page.flows;
    if (page.after) {
      page.after(page.elements);
      delete page.after;
    }
    for (const el of page.elements) {
      delete el.fit;
      delete el.flow;
      delete el.gap;
    }
  }
  return doc;
}
