// SVG path data for shapes, drawn to fill a w × h box.

import { nearPolyline } from './geometry.js';

const f = (n) => Math.round(n * 100) / 100;

function poly(points) {
  return 'M' + points.map(([x, y]) => `${f(x)} ${f(y)}`).join(' L') + ' Z';
}

function roundedRect(w, h, r) {
  r = Math.max(0, Math.min(r || 0, w / 2, h / 2));
  if (!r) return `M0 0 H${f(w)} V${f(h)} H0 Z`;
  return [
    `M${f(r)} 0`, `H${f(w - r)}`, `A${f(r)} ${f(r)} 0 0 1 ${f(w)} ${f(r)}`,
    `V${f(h - r)}`, `A${f(r)} ${f(r)} 0 0 1 ${f(w - r)} ${f(h)}`,
    `H${f(r)}`, `A${f(r)} ${f(r)} 0 0 1 0 ${f(h - r)}`,
    `V${f(r)}`, `A${f(r)} ${f(r)} 0 0 1 ${f(r)} 0`, 'Z',
  ].join(' ');
}

function regular(n, w, h, start = -Math.PI / 2) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = start + (i * 2 * Math.PI) / n;
    pts.push([w / 2 + (Math.cos(a) * w) / 2, h / 2 + (Math.sin(a) * h) / 2]);
  }
  return pts;
}

function star(n, inner, w, h) {
  const pts = [];
  for (let i = 0; i < n * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / n;
    const r = i % 2 ? inner : 1;
    pts.push([w / 2 + (Math.cos(a) * w * r) / 2, h / 2 + (Math.sin(a) * h * r) / 2]);
  }
  return pts;
}

export function shapePath(el) {
  const { w, h } = el;
  switch (el.shape) {
    case 'rect':
      return roundedRect(w, h, el.radius);
    case 'ellipse':
      return `M0 ${f(h / 2)} A${f(w / 2)} ${f(h / 2)} 0 1 0 ${f(w)} ${f(h / 2)} A${f(w / 2)} ${f(h / 2)} 0 1 0 0 ${f(h / 2)} Z`;
    case 'triangle':
      return poly([[w / 2, 0], [w, h], [0, h]]);
    case 'diamond':
      return poly([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]);
    case 'polygon':
      return poly(regular(Math.max(3, Math.min(12, el.sides || 6)), w, h));
    case 'star':
      return poly(star(Math.max(3, Math.min(24, el.sides || 5)), el.innerRatio ?? 0.45, w, h));
    case 'heart': {
      const p = (x, y) => `${f(x * w)} ${f(y * h)}`;
      return `M${p(0.5, 0.95)} C${p(0.1, 0.65)} ${p(-0.05, 0.35)} ${p(0.18, 0.13)} C${p(0.32, 0)} ${p(0.46, 0.06)} ${p(0.5, 0.2)} C${p(0.54, 0.06)} ${p(0.68, 0)} ${p(0.82, 0.13)} C${p(1.05, 0.35)} ${p(0.9, 0.65)} ${p(0.5, 0.95)} Z`;
    }
    case 'arrow':
      return poly([[0, h * 0.3], [w * 0.62, h * 0.3], [w * 0.62, 0], [w, h / 2], [w * 0.62, h], [w * 0.62, h * 0.7], [0, h * 0.7]]);
    case 'bubble': {
      const bh = h * 0.8;
      const r = Math.min(w, bh) * 0.18;
      return [
        `M${f(r)} 0`, `H${f(w - r)}`, `Q${f(w)} 0 ${f(w)} ${f(r)}`, `V${f(bh - r)}`, `Q${f(w)} ${f(bh)} ${f(w - r)} ${f(bh)}`,
        `H${f(w * 0.38)}`, `L${f(w * 0.18)} ${f(h)}`, `L${f(w * 0.22)} ${f(bh)}`,
        `H${f(r)}`, `Q0 ${f(bh)} 0 ${f(bh - r)}`, `V${f(r)}`, `Q0 0 ${f(r)} 0`, 'Z',
      ].join(' ');
    }
    case 'arch': {
      // A doorway: straight sides and a round top.
      const r = Math.min(w / 2, h);
      return `M0 ${f(h)} V${f(r)} A${f(w / 2)} ${f(r)} 0 0 1 ${f(w)} ${f(r)} V${f(h)} Z`;
    }
    case 'blob': {
      // A soft, uneven round shape through eight points.
      const k = [1, 0.86, 0.97, 0.84, 1, 0.9, 0.95, 0.83];
      const pts = k.map((r, i) => {
        const a = -Math.PI / 2 + (i * Math.PI) / 4;
        return [w / 2 + (Math.cos(a) * w * r) / 2, h / 2 + (Math.sin(a) * h * r) / 2];
      });
      const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const start = mid(pts[7], pts[0]);
      let d = `M${f(start[0])} ${f(start[1])}`;
      pts.forEach((p, i) => {
        const m = mid(p, pts[(i + 1) % pts.length]);
        d += ` Q${f(p[0])} ${f(p[1])} ${f(m[0])} ${f(m[1])}`;
      });
      return `${d} Z`;
    }
    default:
      return roundedRect(w, h, 0);
  }
}

/** A smooth path through a drawing's points (stored as shares of its box). */
export function drawPath(el) {
  const pts = (el.points || []).map(([x, y]) => [x * el.w, y * el.h]);
  if (!pts.length) return '';
  if (pts.length === 1) return `M${f(pts[0][0])} ${f(pts[0][1])} l0.01 0`;
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2;
    const my = (pts[i][1] + pts[i + 1][1]) / 2;
    d += ` Q${f(pts[i][0])} ${f(pts[i][1])} ${f(mx)} ${f(my)}`;
  }
  const z = pts[pts.length - 1];
  return `${d} L${f(z[0])} ${f(z[1])}`;
}

/** Whether point p (page px) is within `tol` px of a drawing's stroke (unrotated drawings). */
export function drawHit(el, p, tol) {
  // A flipped drawing is drawn mirrored about its centre; mirror the point to match.
  const q = { x: el.flipX ? 2 * el.x + el.w - p.x : p.x, y: el.flipY ? 2 * el.y + el.h - p.y : p.y };
  return nearPolyline((el.points || []).map(([x, y]) => [el.x + x * el.w, el.y + y * el.h]), q, tol);
}

/** The outline a photo is clipped to: its frame shape, or a (rounded) rectangle. */
export function maskPath(el) {
  const shape = !el.mask || el.mask === 'none' ? 'rect' : el.mask === 'circle' ? 'ellipse' : el.mask;
  return shapePath({ w: el.w, h: el.h, shape, radius: shape === 'rect' ? el.radius : 0, sides: el.sides, innerRatio: el.innerRatio });
}

export function dashArray(dash, width) {
  const wd = Math.max(1, width || 1);
  if (dash === 'dashed') return `${f(wd * 3)} ${f(wd * 2)}`;
  if (dash === 'dotted') return `0 ${f(wd * 2)}`;
  return null;
}
