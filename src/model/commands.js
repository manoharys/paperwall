// Edits to a design. Every function changes the design in place; the editor
// records a history snapshot before calling one, which is what makes undo work.

import { uid, createPage, clone } from './doc.js';
import { boundsOf, unionBounds, rotatePoint, boxCenter } from './geometry.js';

export function getPage(doc, index) {
  const p = doc.pages[index];
  if (!p) throw new Error(`No page ${index + 1}`);
  return p;
}

export function findElement(page, id) {
  return page.elements.find((e) => e.id === id) || null;
}

export function selectElements(page, ids) {
  const set = new Set(ids);
  return page.elements.filter((e) => set.has(e.id));
}

function touch(doc) {
  doc.updatedAt = Date.now();
}

// ---------- elements ----------

export function addElement(doc, pageIndex, el, { center = false } = {}) {
  if (center) {
    el.x = Math.round((doc.width - el.w) / 2);
    el.y = Math.round((doc.height - el.h) / 2);
  }
  getPage(doc, pageIndex).elements.push(el);
  touch(doc);
  return el.id;
}

export function updateElements(doc, pageIndex, ids, props) {
  for (const el of selectElements(getPage(doc, pageIndex), ids)) {
    for (const [k, v] of Object.entries(props)) {
      if (v && typeof v === 'object' && !Array.isArray(v) && el[k] && typeof el[k] === 'object' && k !== 'fill') {
        el[k] = { ...el[k], ...v };
      } else {
        el[k] = v;
      }
    }
  }
  touch(doc);
}

export function moveElements(doc, pageIndex, ids, dx, dy) {
  for (const el of selectElements(getPage(doc, pageIndex), ids)) {
    if (el.locked) continue;
    el.x += dx;
    el.y += dy;
  }
  touch(doc);
}

export function deleteElements(doc, pageIndex, ids) {
  const page = getPage(doc, pageIndex);
  const set = new Set(ids);
  const before = page.elements.length;
  page.elements = page.elements.filter((e) => !set.has(e.id) || e.locked);
  touch(doc);
  return before - page.elements.length;
}

function freshIds(el) {
  const copy = clone(el);
  const walk = (e) => {
    e.id = uid();
    if (e.type === 'group') e.children.forEach(walk);
  };
  walk(copy);
  return copy;
}

/** Copies of elements with new ids, ready to paste. */
export function copyElements(doc, pageIndex, ids) {
  return selectElements(getPage(doc, pageIndex), ids).map(clone);
}

export function pasteElements(doc, pageIndex, els, offset = 0) {
  const page = getPage(doc, pageIndex);
  const ids = [];
  for (const el of els) {
    const copy = freshIds(el);
    copy.x += offset;
    copy.y += offset;
    copy.locked = false;
    page.elements.push(copy);
    ids.push(copy.id);
  }
  touch(doc);
  return ids;
}

export function duplicateElements(doc, pageIndex, ids, offset = 24) {
  return pasteElements(doc, pageIndex, copyElements(doc, pageIndex, ids), offset);
}

// ---------- order ----------

export function reorder(doc, pageIndex, ids, how) {
  const page = getPage(doc, pageIndex);
  const set = new Set(ids);
  const els = page.elements;
  if (how === 'front' || how === 'back') {
    const moving = els.filter((e) => set.has(e.id));
    const rest = els.filter((e) => !set.has(e.id));
    page.elements = how === 'front' ? [...rest, ...moving] : [...moving, ...rest];
  } else if (how === 'forward') {
    for (let i = els.length - 2; i >= 0; i--) {
      if (set.has(els[i].id) && !set.has(els[i + 1].id)) [els[i], els[i + 1]] = [els[i + 1], els[i]];
    }
  } else if (how === 'backward') {
    for (let i = 1; i < els.length; i++) {
      if (set.has(els[i].id) && !set.has(els[i - 1].id)) [els[i], els[i - 1]] = [els[i - 1], els[i]];
    }
  } else {
    throw new Error(`Unknown order: ${how}`);
  }
  touch(doc);
}

/** Move one element to an exact position in the stack (0 = bottom). */
export function moveToIndex(doc, pageIndex, id, index) {
  const page = getPage(doc, pageIndex);
  const from = page.elements.findIndex((e) => e.id === id);
  if (from < 0) return;
  const [el] = page.elements.splice(from, 1);
  page.elements.splice(Math.max(0, Math.min(index, page.elements.length)), 0, el);
  touch(doc);
}

// ---------- scaling ----------

/** Scale an element and everything inside it (font size, borders, corners). */
export function scaleElement(el, sx, sy) {
  const s = Math.min(Math.abs(sx), Math.abs(sy));
  el.x *= sx;
  el.y *= sy;
  el.w *= sx;
  el.h *= sy;
  if (el.type === 'text') {
    el.size = Math.max(1, round(el.size * s));
    if (el.outline) el.outline = { ...el.outline, width: el.outline.width * s };
    if (el.highlight) el.highlight = { ...el.highlight, padding: (el.highlight.padding ?? 0) * s };
  }
  if (el.strokeWidth) el.strokeWidth *= s;
  if (el.radius) el.radius *= s;
  if (el.shadow) el.shadow = { ...el.shadow, x: el.shadow.x * s, y: el.shadow.y * s, blur: el.shadow.blur * s };
  if (el.type === 'group') for (const c of el.children) scaleElement(c, sx, sy);
  return el;
}

/** Resize an element to a new box. Groups scale their contents. */
export function resizeElement(el, box, { scaleContent = false } = {}) {
  const sx = el.w ? box.w / el.w : 1;
  const sy = el.h ? box.h / el.h : 1;
  if (el.type === 'group') {
    for (const c of el.children) scaleElement(c, sx, sy);
  } else if (scaleContent) {
    const keep = { x: el.x, y: el.y };
    scaleElement(el, sx, sy);
    el.x = keep.x;
    el.y = keep.y;
  }
  el.x = box.x;
  el.y = box.y;
  el.w = box.w;
  el.h = box.h;
  if (box.rotation !== undefined) el.rotation = box.rotation;
  return el;
}

function round(n) {
  return Math.round(n * 100) / 100;
}

// ---------- groups ----------

export function groupElements(doc, pageIndex, ids) {
  const page = getPage(doc, pageIndex);
  const members = selectElements(page, ids).filter((e) => !e.locked);
  if (members.length < 2) return null;
  const b = unionBounds(members);
  const children = members.map((e) => ({ ...clone(e), x: e.x - b.x, y: e.y - b.y }));
  const topIndex = Math.max(...members.map((m) => page.elements.indexOf(m)));
  const group = {
    id: uid('g'), type: 'group', x: b.x, y: b.y, w: b.w, h: b.h, rotation: 0, opacity: 1,
    locked: false, hidden: false, flipX: false, flipY: false, shadow: null, children,
  };
  const memberIds = new Set(members.map((m) => m.id));
  const before = page.elements.slice(0, topIndex + 1).filter((e) => !memberIds.has(e.id));
  const after = page.elements.slice(topIndex + 1);
  page.elements = [...before, group, ...after];
  touch(doc);
  return group.id;
}

export function ungroup(doc, pageIndex, groupId) {
  const page = getPage(doc, pageIndex);
  const index = page.elements.findIndex((e) => e.id === groupId && e.type === 'group');
  if (index < 0) return [];
  const g = page.elements[index];
  const gc = boxCenter(g);
  const fx = g.flipX ? -1 : 1;
  const fy = g.flipY ? -1 : 1;
  const out = g.children.map((c) => {
    const child = clone(c);
    const lc = { x: child.x + child.w / 2 - g.w / 2, y: child.y + child.h / 2 - g.h / 2 };
    const p = rotatePoint(lc.x * fx, lc.y * fy, 0, 0, g.rotation || 0);
    child.x = gc.x + p.x - child.w / 2;
    child.y = gc.y + p.y - child.h / 2;
    let rot = child.rotation || 0;
    if (fx * fy < 0) rot = -rot;
    if (g.flipX) child.flipX = !child.flipX;
    if (g.flipY) child.flipY = !child.flipY;
    child.rotation = ((rot + (g.rotation || 0)) % 360 + 360) % 360;
    child.opacity = (child.opacity ?? 1) * (g.opacity ?? 1);
    return child;
  });
  page.elements.splice(index, 1, ...out);
  touch(doc);
  return out.map((c) => c.id);
}

// ---------- alignment ----------

/**
 * Align elements. With one element, or toPage, they line up with the page;
 * with several, they line up with the edges of the selection.
 */
export function alignElements(doc, pageIndex, ids, how, { toPage } = {}) {
  const els = selectElements(getPage(doc, pageIndex), ids).filter((e) => !e.locked);
  if (!els.length) return;
  const usePage = toPage ?? els.length === 1;
  const ref = usePage ? { x: 0, y: 0, w: doc.width, h: doc.height } : unionBounds(els);
  for (const el of els) {
    const b = boundsOf(el);
    let dx = 0;
    let dy = 0;
    if (how === 'left') dx = ref.x - b.x;
    else if (how === 'center') dx = ref.x + ref.w / 2 - (b.x + b.w / 2);
    else if (how === 'right') dx = ref.x + ref.w - (b.x + b.w);
    else if (how === 'top') dy = ref.y - b.y;
    else if (how === 'middle') dy = ref.y + ref.h / 2 - (b.y + b.h / 2);
    else if (how === 'bottom') dy = ref.y + ref.h - (b.y + b.h);
    else throw new Error(`Unknown alignment: ${how}`);
    el.x += dx;
    el.y += dy;
  }
  touch(doc);
}

/** Space three or more elements so the gaps between them are equal. */
export function distributeElements(doc, pageIndex, ids, axis = 'x') {
  const els = selectElements(getPage(doc, pageIndex), ids).filter((e) => !e.locked);
  if (els.length < 3) return;
  const pos = axis === 'x' ? 'x' : 'y';
  const size = axis === 'x' ? 'w' : 'h';
  const items = els.map((el) => ({ el, b: boundsOf(el) })).sort((a, b) => a.b[pos] - b.b[pos]);
  const first = items[0].b;
  const last = items[items.length - 1].b;
  const total = last[pos] + last[size] - first[pos];
  const used = items.reduce((s, i) => s + i.b[size], 0);
  const gap = (total - used) / (items.length - 1);
  let cursor = first[pos];
  for (const { el, b } of items) {
    el[pos] += cursor - b[pos];
    cursor += b[size] + gap;
  }
  touch(doc);
}

export function flipElements(doc, pageIndex, ids, axis) {
  for (const el of selectElements(getPage(doc, pageIndex), ids)) {
    if (axis === 'x') el.flipX = !el.flipX;
    else el.flipY = !el.flipY;
  }
  touch(doc);
}

// ---------- style painter ----------

const STYLE_KEYS = {
  text: ['font', 'size', 'weight', 'italic', 'underline', 'strike', 'color', 'align', 'lineHeight', 'letterSpacing', 'caps', 'outline', 'highlight'],
  shape: ['fill', 'stroke', 'strokeWidth', 'dash', 'radius'],
  line: ['stroke', 'strokeWidth', 'dash', 'startCap', 'endCap'],
  image: ['filters', 'radius', 'mask'],
  icon: ['color'],
};
const SHARED_STYLE = ['opacity', 'shadow'];

export function copyStyle(el) {
  const style = { type: el.type };
  for (const k of [...(STYLE_KEYS[el.type] || []), ...SHARED_STYLE]) style[k] = clone(el[k] ?? null);
  return style;
}

/** Apply a copied style. Only properties that make sense for the target are used. */
export function pasteStyle(doc, pageIndex, ids, style) {
  for (const el of selectElements(getPage(doc, pageIndex), ids)) {
    const keys = [...SHARED_STYLE];
    if (el.type === style.type) keys.push(...(STYLE_KEYS[el.type] || []));
    else if (el.type === 'shape' && style.type === 'text') el.fill = style.color;
    else if (el.type === 'text' && style.type === 'shape' && typeof style.fill === 'string') el.color = style.fill;
    for (const k of keys) if (k in style) el[k] = clone(style[k]);
  }
  touch(doc);
}

// ---------- pages ----------

export function addPage(doc, afterIndex = doc.pages.length - 1, page) {
  const p = page || createPage(clone(doc.pages[afterIndex]?.background ?? { type: 'color', color: '#ffffff' }));
  doc.pages.splice(afterIndex + 1, 0, p);
  touch(doc);
  return afterIndex + 1;
}

export function duplicatePage(doc, index) {
  const copy = clone(getPage(doc, index));
  copy.id = uid('p');
  copy.elements = copy.elements.map(freshIds);
  doc.pages.splice(index + 1, 0, copy);
  touch(doc);
  return index + 1;
}

export function deletePage(doc, index) {
  if (doc.pages.length <= 1) throw new Error('A design needs at least one page');
  getPage(doc, index);
  doc.pages.splice(index, 1);
  touch(doc);
  return Math.min(index, doc.pages.length - 1);
}

export function movePage(doc, from, to) {
  const [p] = doc.pages.splice(from, 1);
  doc.pages.splice(Math.max(0, Math.min(to, doc.pages.length)), 0, p);
  touch(doc);
  return doc.pages.indexOf(p);
}

export function setBackground(doc, pageIndex, background) {
  getPage(doc, pageIndex).background = background;
  touch(doc);
}

// ---------- whole design ----------

/**
 * Make a copy of the design at a new size. Everything keeps its place
 * relative to the page and is scaled by the smaller of the two ratios, so
 * nothing gets stretched.
 */
export function resizeDesign(doc, width, height) {
  const out = clone(doc);
  out.id = uid('d');
  const sx = width / doc.width;
  const sy = height / doc.height;
  const s = Math.min(sx, sy);
  for (const page of out.pages) {
    for (const el of page.elements) {
      const cx = (el.x + el.w / 2) * sx;
      const cy = (el.y + el.h / 2) * sy;
      scaleElement(el, s, s);
      el.x = cx - el.w / 2;
      el.y = cy - el.h / 2;
      // Keep things on the page when the shape of the page changes a lot.
      const b = boundsOf(el);
      if (b.w <= width) el.x += Math.max(0, -b.x) - Math.max(0, b.x + b.w - width);
      if (b.h <= height) el.y += Math.max(0, -b.y) - Math.max(0, b.y + b.h - height);
    }
  }
  out.width = Math.round(width);
  out.height = Math.round(height);
  out.updatedAt = Date.now();
  return out;
}

/** Every color used in the design, most used first. */
export function collectColors(doc) {
  const counts = new Map();
  const add = (c) => {
    if (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)) counts.set(c.toLowerCase(), (counts.get(c.toLowerCase()) || 0) + 1);
    else if (c && typeof c === 'object' && Array.isArray(c.stops)) c.stops.forEach((s) => add(s.color));
  };
  const visit = (els) => {
    for (const el of els) {
      add(el.fill);
      add(el.stroke);
      add(el.color);
      if (el.highlight) add(el.highlight.color);
      if (el.outline) add(el.outline.color);
      if (el.type === 'group') visit(el.children);
    }
  };
  for (const p of doc.pages) {
    if (p.background?.type === 'color') add(p.background.color);
    if (p.background?.type === 'gradient') add(p.background.gradient);
    visit(p.elements);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
}

/**
 * Apply a brand kit: the design's colors are swapped for brand colors (most
 * used first), big text gets the heading font, the rest the body font.
 */
export function applyBrand(doc, brand) {
  const colors = (brand.colors || []).map((c) => c.toLowerCase());
  const used = collectColors(doc).filter((c) => c !== '#ffffff' && c !== '#000000');
  const map = new Map();
  used.forEach((c, i) => {
    if (colors.length) map.set(c, colors[i % colors.length]);
  });
  const swap = (c) => {
    if (typeof c === 'string') return map.get(c.toLowerCase()) || c;
    if (c && typeof c === 'object' && Array.isArray(c.stops)) return { ...c, stops: c.stops.map((s) => ({ ...s, color: swap(s.color) })) };
    return c;
  };
  const texts = [];
  const visit = (els) => {
    for (const el of els) {
      if (el.fill) el.fill = swap(el.fill);
      if (el.stroke) el.stroke = swap(el.stroke);
      if (el.color) el.color = swap(el.color);
      if (el.highlight) el.highlight = { ...el.highlight, color: swap(el.highlight.color) };
      if (el.type === 'text') texts.push(el);
      if (el.type === 'group') visit(el.children);
    }
  };
  for (const p of doc.pages) {
    if (p.background?.type === 'color') p.background.color = swap(p.background.color);
    if (p.background?.type === 'gradient') p.background.gradient = swap(p.background.gradient);
    visit(p.elements);
  }
  if (texts.length && (brand.headingFont || brand.bodyFont)) {
    const sizes = texts.map((t) => t.size).sort((a, b) => b - a);
    const cutoff = sizes[0] * 0.6;
    for (const t of texts) {
      const font = t.size >= cutoff ? brand.headingFont : brand.bodyFont;
      if (font) t.font = font;
    }
  }
  touch(doc);
}
