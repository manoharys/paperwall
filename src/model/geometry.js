// Geometry for boxes that can rotate around their center.
// An element's box is (x, y, w, h) before rotation; `rotation` is in degrees,
// clockwise, around the box center.

const RAD = Math.PI / 180;

export function rotatePoint(px, py, cx, cy, deg) {
  if (!deg) return { x: px, y: py };
  const r = deg * RAD;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const dx = px - cx;
  const dy = py - cy;
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
}

export function boxCenter(b) {
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

/** The four corners of a (possibly rotated) box: top-left, top-right, bottom-right, bottom-left. */
export function boxCorners(b) {
  const c = boxCenter(b);
  const pts = [
    [b.x, b.y],
    [b.x + b.w, b.y],
    [b.x + b.w, b.y + b.h],
    [b.x, b.y + b.h],
  ];
  return pts.map(([x, y]) => rotatePoint(x, y, c.x, c.y, b.rotation || 0));
}

/** Axis-aligned bounds of a rotated box. */
export function boundsOf(b) {
  if (!b.rotation) return { x: b.x, y: b.y, w: b.w, h: b.h };
  const cs = boxCorners(b);
  const xs = cs.map((p) => p.x);
  const ys = cs.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

export function unionBounds(boxes) {
  if (!boxes.length) return null;
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const b of boxes) {
    const r = boundsOf(b);
    x1 = Math.min(x1, r.x);
    y1 = Math.min(y1, r.y);
    x2 = Math.max(x2, r.x + r.w);
    y2 = Math.max(y2, r.y + r.h);
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/** Is the point inside the rotated box (with an optional margin in px)? */
export function pointInBox(px, py, b, margin = 0) {
  const c = boxCenter(b);
  const p = rotatePoint(px, py, c.x, c.y, -(b.rotation || 0));
  return p.x >= b.x - margin && p.x <= b.x + b.w + margin && p.y >= b.y - margin && p.y <= b.y + b.h + margin;
}

export function rectsIntersect(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function rectContains(outer, inner) {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
}

/** Normalize a drag rectangle from two points. */
export function rectFromPoints(a, b) {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

// Handle names: n, s, e, w, ne, nw, se, sw.
const HANDLE_DIRS = {
  nw: [-1, -1], n: [0, -1], ne: [1, -1], e: [1, 0],
  se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0],
};

export const HANDLES = Object.keys(HANDLE_DIRS);

/** Position of a resize handle in page coordinates. */
export function handlePosition(b, handle) {
  const [dx, dy] = HANDLE_DIRS[handle];
  const c = boxCenter(b);
  return rotatePoint(c.x + (dx * b.w) / 2, c.y + (dy * b.h) / 2, c.x, c.y, b.rotation || 0);
}

/**
 * Resize a box by dragging one handle.
 * start: the box when the drag began. (dx, dy): pointer movement in page coordinates.
 * keepRatio: keep width/height proportional (corner handles only).
 * The opposite handle stays fixed in place, even when the box is rotated.
 */
export function resizeBox(start, handle, dx, dy, { keepRatio = false, minSize = 1 } = {}) {
  const [hx, hy] = HANDLE_DIRS[handle];
  const rot = start.rotation || 0;
  // Movement in the box's own (unrotated) frame.
  const local = rotatePoint(dx, dy, 0, 0, -rot);
  let w = start.w + hx * local.x;
  let h = start.h + hy * local.y;
  if (hx === 0) w = start.w;
  if (hy === 0) h = start.h;
  if (keepRatio && hx !== 0 && hy !== 0 && start.w > 0 && start.h > 0) {
    const ratio = start.w / start.h;
    // Follow whichever axis moved proportionally more.
    if (Math.abs(w / start.w) > Math.abs(h / start.h)) h = w / ratio;
    else w = h * ratio;
  }
  w = Math.max(minSize, w);
  h = Math.max(minSize, h);
  // Keep the opposite anchor fixed.
  const anchorHandle = Object.keys(HANDLE_DIRS).find((k) => HANDLE_DIRS[k][0] === -hx && HANDLE_DIRS[k][1] === -hy);
  const anchorBefore = anchorHandle ? handlePosition(start, anchorHandle) : boxCenter(start);
  const next = { x: start.x, y: start.y, w, h, rotation: rot };
  // Where the anchor would be if the new box had the same top-left, then shift.
  next.x = start.x + (start.w - w) / 2;
  next.y = start.y + (start.h - h) / 2;
  const anchorAfter = anchorHandle ? handlePosition(next, anchorHandle) : boxCenter(next);
  next.x += anchorBefore.x - anchorAfter.x;
  next.y += anchorBefore.y - anchorAfter.y;
  return next;
}

/** Angle in degrees from the box center to a point, where straight up is 0. */
export function angleTo(b, px, py) {
  const c = boxCenter(b);
  const deg = Math.atan2(py - c.y, px - c.x) / RAD + 90;
  return normalizeAngle(deg);
}

export function normalizeAngle(deg) {
  let d = deg % 360;
  if (d < 0) d += 360;
  return Math.round(d * 100) / 100 + 0;
}

export function snapAngle(deg, step = 15) {
  return normalizeAngle(Math.round(deg / step) * step);
}

/**
 * Snap a moving box to the page edges and center, other elements, and any
 * `extra` lines ({ x: [], y: [] }: your guides, grid lines). Returns the
 * correction (dx, dy) and the guide lines to draw.
 */
export function snapMove(moving, others, page, threshold = 6, extra = {}) {
  const m = boundsOf(moving);
  const xs = [m.x, m.x + m.w / 2, m.x + m.w];
  const ys = [m.y, m.y + m.h / 2, m.y + m.h];
  const targetsX = [0, page.w / 2, page.w, ...(extra.x || [])];
  const targetsY = [0, page.h / 2, page.h, ...(extra.y || [])];
  for (const o of others) {
    const b = boundsOf(o);
    targetsX.push(b.x, b.x + b.w / 2, b.x + b.w);
    targetsY.push(b.y, b.y + b.h / 2, b.y + b.h);
  }
  const best = (vals, targets) => {
    let pick = null;
    for (const v of vals) {
      for (const t of targets) {
        const d = t - v;
        if (Math.abs(d) <= threshold && (!pick || Math.abs(d) < Math.abs(pick.d))) pick = { d, t };
      }
    }
    return pick;
  };
  const bx = best(xs, targetsX);
  const by = best(ys, targetsY);
  const guides = [];
  if (bx) guides.push({ axis: 'x', pos: bx.t });
  if (by) guides.push({ axis: 'y', pos: by.t });
  return { dx: bx ? bx.d : 0, dy: by ? by.d : 0, guides };
}

/** Round to 4 decimals (positions stored as shares of a box). */
export function round4(n) {
  return Math.round(n * 10000) / 10000;
}

export function round2(n) {
  return Math.round(n * 100) / 100;
}

/** Whether point p is within `tol` of a polyline through pts ([[x, y], ...]). */
export function nearPolyline(pts, p, tol) {
  if (pts.length === 1) return Math.hypot(p.x - pts[0][0], p.y - pts[0][1]) <= tol;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i];
    const len2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1;
    const t = Math.max(0, Math.min(1, ((p.x - ax) * (bx - ax) + (p.y - ay) * (by - ay)) / len2));
    if (Math.hypot(p.x - (ax + t * (bx - ax)), p.y - (ay + t * (by - ay))) <= tol) return true;
  }
  return false;
}

/**
 * Make a group's box fit its children again (after their sizes changed),
 * keeping everything where it is on the page, turned or mirrored groups too.
 */
export function refitGroup(group) {
  if (group.type !== 'group' || !group.children.length) return;
  const b = unionBounds(group.children); // in the group's own (unturned) space
  for (const c of group.children) {
    c.x -= b.x;
    c.y -= b.y;
  }
  // How far the centre moves, in the group's space, then turned onto the page.
  let dx = b.x + b.w / 2 - group.w / 2;
  let dy = b.y + b.h / 2 - group.h / 2;
  if (group.flipX) dx = -dx;
  if (group.flipY) dy = -dy;
  const r = ((group.rotation || 0) * Math.PI) / 180;
  const cx = group.x + group.w / 2 + dx * Math.cos(r) - dy * Math.sin(r);
  const cy = group.y + group.h / 2 + dx * Math.sin(r) + dy * Math.cos(r);
  Object.assign(group, { x: cx - b.w / 2, y: cy - b.h / 2, w: b.w, h: b.h });
}

/**
 * A box around points (padded by `pad`), with each point stored as a share
 * of the box (0..1), so the shape stretches when the box is resized.
 */
export function boxAround(points, pad = 0) {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const x = Math.min(...xs) - pad;
  const y = Math.min(...ys) - pad;
  const w = Math.max(1, Math.max(...xs) + pad - x);
  const h = Math.max(1, Math.max(...ys) + pad - y);
  return { x, y, w, h, shares: points.map(([px, py]) => [round4((px - x) / w), round4((py - y) / h)]) };
}
