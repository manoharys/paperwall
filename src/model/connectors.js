// Connectors: lines whose ends can be attached to elements. An attached end
// sits on the middle of the target's side that faces the other end, and
// follows the target when it moves. Routes: straight, elbow or curved.

import { uid } from './doc.js';
import { drawHit } from './shapes.js';
import { boxCenter, rotatePoint, nearPolyline, round2, boxAround, refitGroup } from './geometry.js';

const f = round2;

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
  const { x, y, w, h, shares } = boxAround([a, b]);
  // A connector is defined by its ends alone: never rotated or flipped.
  Object.assign(el, { x, y, w, h, rotation: 0, flipX: false, flipY: false, points: shares });
}

/**
 * Where a connector meets a box: the middle of the side facing `toward`.
 * On a turned box that's the middle of its own (turned) side.
 */
export function anchorOn(box, toward) {
  const rot = box.rotation || 0;
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  // Work in the box's own frame, then turn the point back.
  const t = rot ? rotatePoint(toward[0], toward[1], cx, cy, -rot) : { x: toward[0], y: toward[1] };
  // Leave by the side facing the main direction of travel, as flowcharts do.
  const dx = t.x - cx;
  const dy = t.y - cy;
  const [px, py, side] = Math.abs(dx) >= Math.abs(dy)
    ? [dx >= 0 ? box.x + box.w : box.x, cy, dx >= 0 ? 'r' : 'l']
    : [cx, dy >= 0 ? box.y + box.h : box.y, dy >= 0 ? 'b' : 't'];
  if (!rot) return { point: [px, py], side };
  const p = rotatePoint(px, py, cx, cy, rot);
  // The side as the line sees it on the page: the turned side's outward direction.
  const a = (rot * Math.PI) / 180;
  const [nx, ny] = { r: [1, 0], l: [-1, 0], b: [0, 1], t: [0, -1] }[side];
  const ox = nx * Math.cos(a) - ny * Math.sin(a);
  const oy = nx * Math.sin(a) + ny * Math.cos(a);
  const pageSide = Math.abs(ox) >= Math.abs(oy) ? (ox >= 0 ? 'r' : 'l') : oy >= 0 ? 'b' : 't';
  return { point: [p.x, p.y], side: pageSide };
}

function hasConnector(els) {
  return els.some((e) => e.type === 'connector' || (e.type === 'group' && hasConnector(e.children)));
}

/** Where the ends are drawn, taking a rotation or flip (from the panel, or ungrouping) into account. */
function visualEnds(el) {
  const cx = el.x + el.w / 2;
  const cy = el.y + el.h / 2;
  return endsOf(el).map(([x, y]) => {
    // Mirror first, then turn: the same order the renderer uses.
    const mx = el.flipX ? 2 * cx - x : x;
    const my = el.flipY ? 2 * cy - y : y;
    const p = rotatePoint(mx, my, cx, cy, el.rotation || 0);
    return [p.x, p.y];
  });
}

const center = (box) => {
  const c = boxCenter(box);
  return [c.x, c.y];
};

/**
 * Put every attached end of every connector on a page back on its target.
 * Ends whose target is gone become free. Returns whether anything moved.
 */
export function updateConnectors(page, { refit = true } = {}) {
  if (!page || !hasConnector(page.elements)) return false;
  let changed = false;
  // Every element's box on the page. Inside unrotated groups that's the
  // element's own box moved by the group; inside a rotated or flipped group
  // the end attaches to the outermost group's box instead.
  // Only the elements some connector is attached to are looked up.
  const refs = new Set();
  const collect = (els) => {
    for (const e of els) {
      if (e.type === 'connector') for (const k of ['start', 'end']) if (e[k]?.id) refs.add(e[k].id);
      if (e.type === 'group') collect(e.children);
    }
  };
  collect(page.elements);
  const byId = new Map();
  let refitted = false;
  const index = (els, ox, oy, top) => {
    for (const e of els) {
      if (refs.has(e.id)) byId.set(e.id, top || { ...e, x: e.x + ox, y: e.y + oy });
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
        // A turned or mirrored group moves as one picture, connectors and all.
        // An end on an element outside it (or one that's gone) comes loose:
        // it can't follow without bending the picture.
        // Only once a change is committed (refit): a live preview passing
        // through a turn (a rotate drag that ends at 0°) mustn't detach anything.
        if (el.rotation || el.flipX || el.flipY) {
          if (refit) freeOutside(el.children, idsIn(el.children));
        }
        else {
          const before = changed;
          changed = false;
          visit(el.children, ox + el.x, oy + el.y);
          // A connector inside that moved may now reach past the group's box.
          // Not mid-drag (refit false): the drag code owns the group's box then.
          if (changed && refit) {
            refitGroup(el);
            refitted = true;
          }
          changed = changed || before;
        }
        continue;
      }
      if (el.type === 'connector' && sync(el, ox, oy)) changed = true;
    }
  };
  const idsIn = (els, out = new Set()) => {
    for (const e of els) {
      out.add(e.id);
      if (e.type === 'group') idsIn(e.children, out);
    }
    return out;
  };
  const freeOutside = (els, inside) => {
    for (const e of els) {
      if (e.type === 'group') freeOutside(e.children, inside);
      if (e.type !== 'connector') continue;
      for (const k of ['start', 'end']) {
        if (e[k]?.id && !inside.has(e[k].id)) {
          e[k] = { id: null, side: e[k].side };
          changed = true;
        }
      }
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
    // A deleted target frees the end where it was, keeping the side it left from.
    // (Only when committing, like freeOutside: live previews never detach.)
    if (refit && el.start?.id && !sTarget) {
      el.start = { id: null, side: el.start.side };
      moved = true; // a change too, if the line itself stays put
    }
    if (refit && el.end?.id && !eTarget) {
      el.end = { id: null, side: el.end.side };
      moved = true;
    }
    if (!sTarget && !eTarget) return moved;
    // Both elements inside the same turned group: both ends would land on the
    // group's one box. Leave the line as it is until the group is undone.
    if (sTarget && sTarget === eTarget) return moved;
    const a = sTarget ? anchorOn(sTarget, eTarget ? center(eTarget) : b0) : null;
    const b = eTarget ? anchorOn(eTarget, sTarget ? center(sTarget) : a0) : null;
    // Attached ends take the side they meet; loose ends keep the one they had.
    if (a) el.start.side = a.side;
    if (b) el.end.side = b.side;
    const na = a ? a.point : a0;
    const nb = b ? b.point : b0;
    if (Math.abs(na[0] - a0[0]) + Math.abs(na[1] - a0[1]) + Math.abs(nb[0] - b0[0]) + Math.abs(nb[1] - b0[1]) > 0.01) {
      setEnds(el, [na[0] - ox, na[1] - oy], [nb[0] - ox, nb[1] - oy]);
      moved = true;
    }
    return moved;
  };
  visit(page.elements, 0, 0);
  if (refitted) {
    // A refitted group may itself be a target: place ends on its new box.
    // (Once: this second pass only moves ends onto boxes that are settled now.)
    byId.clear();
    index(page.elements, 0, 0, null);
    refit = false;
    visit(page.elements, 0, 0);
  }
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
  // On a short line, trim less so the ends never cross.
  const room = Math.hypot(b[0] - a[0], b[1] - a[1]) * 0.9;
  if (trim.start + trim.end > room) {
    const k = room / (trim.start + trim.end);
    trim = { start: trim.start * k, end: trim.end * k };
  }
  // An elbow's first and last legs can be shorter than the trim: trim no more
  // than each, so the line never doubles back past its own end.
  if (el.route === 'elbow') {
    const leg = (p, q) => Math.hypot(q[0] - p[0], q[1] - p[1]) * 0.9;
    const n = g.pts.length;
    trim = { start: Math.min(trim.start, leg(g.pts[0], g.pts[1])), end: Math.min(trim.end, leg(g.pts[n - 2], g.pts[n - 1])) };
  }
  // A curve is cut out of itself: the same curve, just shorter.
  if (el.route === 'curved' && g.bend) return { ...trimCurve([a, g.bend.c1, g.bend.c2, b], trim), startDir: g.startDir, endDir: g.endDir, horizontal: g.horizontal, bend: g.bend };
  const unit = ([x, y]) => {
    const l = Math.hypot(x, y) || 1;
    return [x / l, y / l];
  };
  const [us, ue] = [unit(g.startDir), unit(g.endDir)];
  const a2 = [a[0] + us[0] * trim.start, a[1] + us[1] * trim.start];
  const b2 = [b[0] - ue[0] * trim.end, b[1] - ue[1] * trim.end];
  // Same route shape (and bend) as the untrimmed line, so it still meets the
  // arrowheads and runs where clicks find it.
  return { ...routeBetween(el, a2, b2, g.horizontal, g.bend), startDir: g.startDir, endDir: g.endDir };
}

const lerp = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];

/** The point at t on a cubic curve (four control points). */
function onCubic([p0, p1, p2, p3], t) {
  const u = 1 - t;
  return [0, 1].map((n) => u * u * u * p0[n] + 3 * u * u * t * p1[n] + 3 * u * t * t * p2[n] + t * t * t * p3[n]);
}

/** The part of a cubic curve between t0 and t1, as its own four control points (de Casteljau). */
function cubicPart(c, t0, t1) {
  const split = ([p0, p1, p2, p3], t) => {
    const a = lerp(p0, p1, t);
    const b = lerp(p1, p2, t);
    const e = lerp(p2, p3, t);
    const d = lerp(a, b, t);
    const g = lerp(b, e, t);
    const m = lerp(d, g, t);
    return [[p0, a, d, m], [m, g, e, p3]];
  };
  const [left] = split(c, t1);
  return t1 > 0 ? split(left, t0 / t1)[1] : left;
}

/** A cubic curve shortened by `trim` px of its length at each end. */
function trimCurve(c, trim) {
  // Lengths along the curve, from samples.
  const N = 64;
  const at = [onCubic(c, 0)];
  const len = [0];
  for (let i = 1; i <= N; i++) {
    at.push(onCubic(c, i / N));
    len.push(len[i - 1] + Math.hypot(at[i][0] - at[i - 1][0], at[i][1] - at[i - 1][1]));
  }
  const total = len[N];
  const tAt = (s) => {
    const i = len.findIndex((l) => l >= s);
    if (i <= 0) return i === 0 ? 0 : 1;
    return (i - 1 + (s - len[i - 1]) / (len[i] - len[i - 1] || 1)) / N;
  };
  const part = cubicPart(c, tAt(trim.start), tAt(total - trim.end));
  const [p0, p1, p2, p3] = part;
  const pts = Array.from({ length: 21 }, (_, i) => onCubic(part, i / 20));
  return { d: `M${f(p0[0])} ${f(p0[1])} C${f(p1[0])} ${f(p1[1])} ${f(p2[0])} ${f(p2[1])} ${f(p3[0])} ${f(p3[1])}`, pts };
}

function routeBetween(el, a, b, horizontal, bend) {
  const r = route(el, a, b, horizontal, bend);
  // A route can fold flat (two boxes side by side): point the arrows along the line between the ends.
  const along = Math.hypot(b[0] - a[0], b[1] - a[1]) > 1e-6 ? [b[0] - a[0], b[1] - a[1]] : [1, 0];
  const some = (d) => (Math.hypot(d[0], d[1]) > 1e-6 ? d : along);
  return { ...r, startDir: some(r.startDir), endDir: some(r.endDir) };
}

function route(el, a, b, horizontal, bend) {
  const path = (pts) => `M${f(pts[0][0])} ${f(pts[0][1])} ` + pts.slice(1).map(([x, y]) => `L${f(x)} ${f(y)}`).join(' ');
  // An attached end sets the way the line leaves (the start's side first; an
  // elbow's two outer legs run the same way). With neither, the way it mostly runs.
  const side = el.start?.id && el.start.side ? el.start.side : el.end?.id && el.end.side ? el.end.side : null;
  const horizontalStart = horizontal ?? (side ? 'lr'.includes(side) : Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]));
  const done = (r) => ({ ...r, horizontal: horizontalStart });
  if (el.route === 'elbow') {
    if (horizontalStart) {
      const mx = bend ?? (a[0] + b[0]) / 2;
      const pts = [a, [mx, a[1]], [mx, b[1]], b];
      return done({ d: path(pts), pts, bend: mx, startDir: [mx - a[0], 0], endDir: [b[0] - mx, 0] });
    }
    const my = bend ?? (a[1] + b[1]) / 2;
    const pts = [a, [a[0], my], [b[0], my], b];
    return done({ d: path(pts), pts, bend: my, startDir: [0, my - a[1]], endDir: [0, b[1] - my] });
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
    const pts = Array.from({ length: 21 }, (_, i) => onCubic([a, c1, c2, b], i / 20));
    return done({ bend: { c1, c2 }, d: `M${f(a[0])} ${f(a[1])} C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(b[0])} ${f(b[1])}`, pts, startDir: [c1[0] - a[0], c1[1] - a[1]], endDir: [b[0] - c2[0], b[1] - c2[1]] });
  }
  return done({ d: path([a, b]), pts: [a, b], startDir: [b[0] - a[0], b[1] - a[1]], endDir: [b[0] - a[0], b[1] - a[1]] });
}

/** Points along the drawn line, in page pixels (curves are sampled). */
const polylines = new WeakMap(); // hover hit tests ask on every mouse move

export function connectorPolyline(el) {
  const key = `${el.x},${el.y},${el.w},${el.h},${el.points},${el.route},${el.start?.side},${el.end?.side},${el.start?.id},${el.end?.id}`;
  const hit = polylines.get(el);
  if (hit?.key === key) return hit.pts;
  const pts = connectorGeometry(el).pts.map(([x, y]) => [el.x + x, el.y + y]);
  polylines.set(el, { key, pts });
  return pts;
}

/** Connectors and drawings are picked (and block drops) near their line only, not anywhere in their box. */
export function isLine(el) {
  return el.type === 'connector' || el.type === 'draw';
}

/** Whether point p is on a connector's or drawing's line, at a zoom (the reach stays the same on screen). */
export function lineHit(el, p, zoom) {
  const tol = (el.strokeWidth || 0) / 2 + 8 / zoom;
  return el.type === 'connector' ? connectorHit(el, p, tol) : drawHit(el, p, tol);
}

/** Whether point p is within `tol` px of the connector's line. */
export function connectorHit(el, p, tol) {
  return nearPolyline(connectorPolyline(el), p, tol);
}

/** An arrowhead at point p, pointing along direction dir. */
export function arrowHead(p, dir, size) {
  const len = Math.hypot(dir[0], dir[1]) || 1;
  const [ux, uy] = [dir[0] / len, dir[1] / len];
  const back = [p[0] - ux * size, p[1] - uy * size];
  const side = [-uy * size * 0.6, ux * size * 0.6];
  return `M${f(p[0])} ${f(p[1])} L${f(back[0] + side[0])} ${f(back[1] + side[1])} L${f(back[0] - side[0])} ${f(back[1] - side[1])} Z`;
}
