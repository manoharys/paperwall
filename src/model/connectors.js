// Connectors: lines whose ends can be attached to elements. An attached end
// sits on the middle of the target's side that faces the other end, and
// follows the target when it moves. Routes: straight, elbow or curved.

import { uid } from './doc.js';
import { boundsOf } from './geometry.js';

const f = (n) => Math.round(n * 100) / 100;

export const ROUTES = ['straight', 'elbow', 'curved'];

/** A connector between two points; `start`/`end` may name an element id to attach to. */
export function createConnector({ from, to, start = null, end = null, route = 'straight', ...props }) {
  const el = {
    id: uid('e'), type: 'connector', x: 0, y: 0, w: 1, h: 1, rotation: 0, opacity: 1,
    locked: false, hidden: false, flipX: false, flipY: false, shadow: null,
    points: [[0, 0], [1, 1]], start: { id: start }, end: { id: end }, route,
    stroke: '#1a1a2e', strokeWidth: 6, dash: 'solid', startCap: 'none', endCap: 'arrow',
    ...props,
  };
  setEnds(el, from, to);
  return el;
}

/** The two ends in page pixels. */
export function endsOf(el) {
  return el.points.map(([fx, fy]) => [el.x + fx * el.w, el.y + fy * el.h]);
}

/** Move the ends: the box wraps them, and the ends are stored as shares of it. */
export function setEnds(el, a, b) {
  const x = Math.min(a[0], b[0]);
  const y = Math.min(a[1], b[1]);
  const w = Math.max(1, Math.abs(a[0] - b[0]));
  const h = Math.max(1, Math.abs(a[1] - b[1]));
  Object.assign(el, { x, y, w, h, rotation: 0 });
  el.points = [a, b].map(([px, py]) => [Math.round(((px - x) / w) * 10000) / 10000, Math.round(((py - y) / h) * 10000) / 10000]);
}

/** Where a connector meets a box: the middle of the side facing `toward`. */
export function anchorOn(box, toward) {
  const b = boundsOf(box);
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  // Leave by the side facing the main direction of travel, as flowcharts do.
  const dx = toward[0] - cx;
  const dy = toward[1] - cy;
  if (Math.abs(dx) >= Math.abs(dy)) return { point: [dx >= 0 ? b.x + b.w : b.x, cy], side: dx >= 0 ? 'r' : 'l' };
  return { point: [cx, dy >= 0 ? b.y + b.h : b.y], side: dy >= 0 ? 'b' : 't' };
}

const center = (box) => {
  const b = boundsOf(box);
  return [b.x + b.w / 2, b.y + b.h / 2];
};

/**
 * Put every attached end of every connector on a page back on its target.
 * Ends whose target is gone become free. Returns whether anything moved.
 */
export function updateConnectors(page) {
  let changed = false;
  // An element inside a group is reached through its group: the end
  // attaches to the group's box and follows the group.
  const byId = new Map();
  const index = (els, top) => {
    for (const e of els) {
      byId.set(e.id, top || e);
      if (e.type === 'group') index(e.children, top || e);
    }
  };
  index(page.elements, null);
  for (const el of page.elements) {
    if (el.type !== 'connector') continue;
    const [a0, b0] = endsOf(el);
    const sTarget = el.start?.id ? byId.get(el.start.id) : null;
    const eTarget = el.end?.id ? byId.get(el.end.id) : null;
    if (el.start?.id && !sTarget) el.start = { id: null };
    if (el.end?.id && !eTarget) el.end = { id: null };
    if (!sTarget && !eTarget) continue;
    const a = sTarget ? anchorOn(sTarget, eTarget ? center(eTarget) : b0) : null;
    const b = eTarget ? anchorOn(eTarget, sTarget ? center(sTarget) : a0) : null;
    el.start.side = a?.side;
    el.end.side = b?.side;
    const na = a ? a.point : a0;
    const nb = b ? b.point : b0;
    if (Math.abs(na[0] - a0[0]) + Math.abs(na[1] - a0[1]) + Math.abs(nb[0] - b0[0]) + Math.abs(nb[1] - b0[1]) > 0.01) {
      setEnds(el, na, nb);
      changed = true;
    }
  }
  return changed;
}

/** Path data in the connector's own box, plus the direction at each end (for arrowheads). */
export function connectorGeometry(el) {
  const [a, b] = el.points.map(([fx, fy]) => [fx * el.w, fy * el.h]);
  const horizontalStart = el.start?.side ? 'lr'.includes(el.start.side) : Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]);
  if (el.route === 'elbow') {
    if (horizontalStart) {
      const mx = (a[0] + b[0]) / 2;
      return { d: `M${f(a[0])} ${f(a[1])} H${f(mx)} V${f(b[1])} H${f(b[0])}`, startDir: [mx - a[0], 0], endDir: [b[0] - mx, 0] };
    }
    const my = (a[1] + b[1]) / 2;
    return { d: `M${f(a[0])} ${f(a[1])} V${f(my)} H${f(b[0])} V${f(b[1])}`, startDir: [0, my - a[1]], endDir: [0, b[1] - my] };
  }
  if (el.route === 'curved') {
    const dist = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const k = Math.max(20, dist / 2);
    const dirFor = (side, from, to) => {
      if (side === 'l') return [-1, 0];
      if (side === 'r') return [1, 0];
      if (side === 't') return [0, -1];
      if (side === 'b') return [0, 1];
      return horizontalStart ? [Math.sign(to[0] - from[0]) || 1, 0] : [0, Math.sign(to[1] - from[1]) || 1];
    };
    const ds = dirFor(el.start?.side, a, b);
    const de = dirFor(el.end?.side, b, a);
    const c1 = [a[0] + ds[0] * k, a[1] + ds[1] * k];
    const c2 = [b[0] + de[0] * k, b[1] + de[1] * k];
    return { d: `M${f(a[0])} ${f(a[1])} C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(b[0])} ${f(b[1])}`, startDir: [c1[0] - a[0], c1[1] - a[1]], endDir: [b[0] - c2[0], b[1] - c2[1]] };
  }
  return { d: `M${f(a[0])} ${f(a[1])} L${f(b[0])} ${f(b[1])}`, startDir: [b[0] - a[0], b[1] - a[1]], endDir: [b[0] - a[0], b[1] - a[1]] };
}

/** Points along the drawn line, in page pixels (curves are sampled). */
export function connectorPolyline(el) {
  const [a, b] = el.points.map(([fx, fy]) => [fx * el.w, fy * el.h]);
  const { d } = connectorGeometry(el);
  let pts;
  if (el.route === 'curved') {
    const nums = d.match(/-?[\d.]+/g).map(Number);
    const [c1, c2] = [[nums[2], nums[3]], [nums[4], nums[5]]];
    pts = Array.from({ length: 21 }, (_, i) => {
      const t = i / 20;
      const u = 1 - t;
      return [0, 1].map((k) => u * u * u * a[k] + 3 * u * u * t * c1[k] + 3 * u * t * t * c2[k] + t * t * t * b[k]);
    });
  } else if (el.route === 'elbow') {
    pts = [a];
    let cur = a;
    for (const [, cmd, v] of d.matchAll(/([HV])(-?[\d.]+)/g)) {
      cur = cmd === 'H' ? [+v, cur[1]] : [cur[0], +v];
      pts.push(cur);
    }
  } else pts = [a, b];
  return pts.map(([x, y]) => [el.x + x, el.y + y]);
}

/** Whether point p is within `tol` px of the connector's line. */
export function connectorHit(el, p, tol) {
  const pts = connectorPolyline(el);
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i];
    const len2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1;
    const t = Math.max(0, Math.min(1, ((p.x - ax) * (bx - ax) + (p.y - ay) * (by - ay)) / len2));
    if (Math.hypot(p.x - (ax + t * (bx - ax)), p.y - (ay + t * (by - ay))) <= tol) return true;
  }
  return false;
}

/** An arrowhead at point p, pointing along direction dir. */
export function arrowHead(p, dir, size) {
  const len = Math.hypot(dir[0], dir[1]) || 1;
  const [ux, uy] = [dir[0] / len, dir[1] / len];
  const back = [p[0] - ux * size, p[1] - uy * size];
  const side = [-uy * size * 0.6, ux * size * 0.6];
  return `M${f(p[0])} ${f(p[1])} L${f(back[0] + side[0])} ${f(back[1] + side[1])} L${f(back[0] - side[0])} ${f(back[1] - side[1])} Z`;
}
