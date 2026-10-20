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
  // A connector is defined by its ends alone: never rotated or flipped.
  Object.assign(el, { x, y, w, h, rotation: 0, flipX: false, flipY: false });
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

function hasConnector(els) {
  return els.some((e) => e.type === 'connector' || (e.type === 'group' && hasConnector(e.children)));
}

/** Where the ends are drawn, taking a rotation or flip (from the panel, or ungrouping) into account. */
function visualEnds(el) {
  const cx = el.x + el.w / 2;
  const cy = el.y + el.h / 2;
  const r = ((el.rotation || 0) * Math.PI) / 180;
  return endsOf(el).map(([x, y]) => {
    let dx = (x - cx) * (el.flipX ? -1 : 1);
    let dy = (y - cy) * (el.flipY ? -1 : 1);
    [dx, dy] = [dx * Math.cos(r) - dy * Math.sin(r), dx * Math.sin(r) + dy * Math.cos(r)];
    return [cx + dx, cy + dy];
  });
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
  if (!page || !hasConnector(page.elements)) return false;
  let changed = false;
  // Every element's box on the page. Inside unrotated groups that's the
  // element's own box moved by the group; inside a rotated or flipped group
  // the end attaches to the outermost group's box instead.
  const byId = new Map();
  const index = (els, ox, oy, top) => {
    for (const e of els) {
      byId.set(e.id, top || { ...e, x: e.x + ox, y: e.y + oy });
      if (e.type !== 'group') continue;
      const plain = !top && !e.rotation && !e.flipX && !e.flipY;
      index(e.children, ox + e.x, oy + e.y, plain ? null : top || { ...e, x: e.x + ox, y: e.y + oy });
    }
  };
  index(page.elements, 0, 0, null);
  // Connectors inside an (unrotated) group are synced in page coordinates too.
  const visit = (els, ox, oy) => {
    for (const el of els) {
      if (el.type === 'group') {
        if (!el.rotation && !el.flipX && !el.flipY) visit(el.children, ox + el.x, oy + el.y);
        continue;
      }
      if (el.type === 'connector' && sync(el, ox, oy)) changed = true;
    }
  };
  const sync = (el, ox, oy) => {
    let moved = false;
    if (el.rotation || el.flipX || el.flipY) {
      // Bake a rotation or flip into the ends, where the line is actually drawn.
      const [p, q] = visualEnds(el);
      setEnds(el, p, q);
      moved = true;
    }
    const [a0, b0] = endsOf(el).map(([x, y]) => [x + ox, y + oy]);
    const sTarget = el.start?.id ? byId.get(el.start.id) : null;
    const eTarget = el.end?.id ? byId.get(el.end.id) : null;
    if (el.start?.id && !sTarget) el.start = { id: null };
    if (el.end?.id && !eTarget) el.end = { id: null };
    if (!sTarget && !eTarget) return moved;
    const a = sTarget ? anchorOn(sTarget, eTarget ? center(eTarget) : b0) : null;
    const b = eTarget ? anchorOn(eTarget, sTarget ? center(sTarget) : a0) : null;
    el.start.side = a?.side;
    el.end.side = b?.side;
    const na = a ? a.point : a0;
    const nb = b ? b.point : b0;
    if (Math.abs(na[0] - a0[0]) + Math.abs(na[1] - a0[1]) + Math.abs(nb[0] - b0[0]) + Math.abs(nb[1] - b0[1]) > 0.01) {
      setEnds(el, [na[0] - ox, na[1] - oy], [nb[0] - ox, nb[1] - oy]);
      moved = true;
    }
    return moved;
  };
  visit(page.elements, 0, 0);
  return changed;
}

/**
 * Path data in the connector's own box, plus the direction at each end (for
 * arrowheads). `trim` pulls the line back from its ends (by px) so it stops
 * inside an arrowhead instead of poking out of its tip.
 */
export function connectorGeometry(el, trim = { start: 0, end: 0 }) {
  const [a, b] = el.points.map(([fx, fy]) => [fx * el.w, fy * el.h]);
  const g = routeBetween(el, a, b);
  if (!trim.start && !trim.end) return g;
  const unit = ([x, y]) => {
    const l = Math.hypot(x, y) || 1;
    return [x / l, y / l];
  };
  const [us, ue] = [unit(g.startDir), unit(g.endDir)];
  const a2 = [a[0] + us[0] * trim.start, a[1] + us[1] * trim.start];
  const b2 = [b[0] - ue[0] * trim.end, b[1] - ue[1] * trim.end];
  return { ...routeBetween(el, a2, b2), startDir: g.startDir, endDir: g.endDir };
}

function routeBetween(el, a, b) {
  const path = (pts) => `M${f(pts[0][0])} ${f(pts[0][1])} ` + pts.slice(1).map(([x, y]) => `L${f(x)} ${f(y)}`).join(' ');
  const horizontalStart = el.start?.side ? 'lr'.includes(el.start.side) : Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]);
  if (el.route === 'elbow') {
    if (horizontalStart) {
      const mx = (a[0] + b[0]) / 2;
      const pts = [a, [mx, a[1]], [mx, b[1]], b];
      return { d: path(pts), pts, startDir: [mx - a[0], 0], endDir: [b[0] - mx, 0] };
    }
    const my = (a[1] + b[1]) / 2;
    const pts = [a, [a[0], my], [b[0], my], b];
    return { d: path(pts), pts, startDir: [0, my - a[1]], endDir: [0, b[1] - my] };
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
    // Sampled along the curve, for hit testing.
    const pts = Array.from({ length: 21 }, (_, i) => {
      const t = i / 20;
      const u = 1 - t;
      return [0, 1].map((n) => u * u * u * a[n] + 3 * u * u * t * c1[n] + 3 * u * t * t * c2[n] + t * t * t * b[n]);
    });
    return { d: `M${f(a[0])} ${f(a[1])} C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(b[0])} ${f(b[1])}`, pts, startDir: [c1[0] - a[0], c1[1] - a[1]], endDir: [b[0] - c2[0], b[1] - c2[1]] };
  }
  return { d: path([a, b]), pts: [a, b], startDir: [b[0] - a[0], b[1] - a[1]], endDir: [b[0] - a[0], b[1] - a[1]] };
}

/** Points along the drawn line, in page pixels (curves are sampled). */
export function connectorPolyline(el) {
  return connectorGeometry(el).pts.map(([x, y]) => [el.x + x, el.y + y]);
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
