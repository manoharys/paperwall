// How the page is shown while editing: grid, safe margins and print bleed.
// None of it is part of the design or its downloads.

import { toPx } from './doc.js';

/** Grid spacing in page px: a share of the page's shorter side. */
export function gridStep(doc, size = 'medium') {
  const share = { small: 1 / 40, medium: 1 / 20, large: 1 / 10 }[size] || 1 / 20;
  return Math.max(4, Math.round(Math.min(doc.width, doc.height) * share));
}

/** Where the grid lines are, for drawing them and for snapping to them. */
export function gridLines(doc, size) {
  const step = gridStep(doc, size);
  const x = [];
  const y = [];
  for (let p = step; p < doc.width; p += step) x.push(p);
  for (let p = step; p < doc.height; p += step) y.push(p);
  return { x, y };
}

/** Safe margin: keep important things inside it. */
export function marginSize(doc) {
  return Math.round(Math.min(doc.width, doc.height) * 0.05);
}

/** Print bleed: the 3 mm strip that may be trimmed off. */
export const BLEED = toPx(3, 'mm');
