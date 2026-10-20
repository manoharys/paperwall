// The design document: pages of elements, plus the images they use.

import { boxAround } from './geometry.js';
import { ANIMATIONS, TRANSITIONS } from './motion.js';

export const FORMAT_VERSION = 1;
export const DPI = 300;

export function uid(prefix = 'e') {
  return prefix + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-3);
}

export const PRESETS = [
  { id: 'square', name: 'Square post', group: 'Social', w: 1080, h: 1080 },
  { id: 'portrait', name: 'Portrait post', group: 'Social', w: 1080, h: 1350 },
  { id: 'story', name: 'Story', group: 'Social', w: 1080, h: 1920 },
  { id: 'thumbnail', name: 'Video thumbnail', group: 'Social', w: 1280, h: 720 },
  { id: 'banner', name: 'Web banner', group: 'Social', w: 1500, h: 500 },
  { id: 'slides', name: 'Presentation', group: 'Work', w: 1920, h: 1080 },
  { id: 'a4', name: 'A4 document', group: 'Print', w: 2480, h: 3508, unit: 'mm' },
  { id: 'letter', name: 'US Letter', group: 'Print', w: 2550, h: 3300, unit: 'in' },
  { id: 'poster', name: 'Poster (18 × 24 in)', group: 'Print', w: 5400, h: 7200, unit: 'in' },
  { id: 'flyer', name: 'Flyer (A5)', group: 'Print', w: 1748, h: 2480, unit: 'mm' },
  { id: 'card', name: 'Business card', group: 'Print', w: 1050, h: 600, unit: 'in' },
  { id: 'invite', name: 'Invitation (5 × 7 in)', group: 'Print', w: 1500, h: 2100, unit: 'in' },
  { id: 'logo', name: 'Logo', group: 'Brand', w: 500, h: 500 },
];

/** Indexes of the pages that aren't hidden (shown when presenting and downloading). */
export function visiblePages(doc) {
  return doc.pages.map((p, i) => (p.hidden ? -1 : i)).filter((i) => i >= 0);
}

export function presetById(id) {
  return PRESETS.find((p) => p.id === id) || null;
}

/** How a page is named in lists: its number, and its title if it has one. */
export function pageName(page, i) {
  return page.title ? `Page ${i + 1}: ${page.title}` : `Page ${i + 1}`;
}

/** Its name, saying so when it's hidden. */
export function pageLabel(page, i) {
  return page.hidden ? `${pageName(page, i)} (hidden)` : pageName(page, i);
}

/** Page px in one mm or inch (or 1 for px), unrounded. */
export function pxPerUnit(unit, dpi = DPI) {
  return unit === 'mm' ? dpi / 25.4 : unit === 'in' ? dpi : 1;
}

/** The resolution a design prints and exports at: print units at DPI, px designs as screens see them. */
export function printDpi(doc) {
  return doc.unit === 'mm' || doc.unit === 'in' ? DPI : 96;
}

/** Convert a print size to pixels at 300 DPI. */
export function toPx(value, unit = 'px', dpi = DPI) {
  if (unit === 'mm') return Math.round((value / 25.4) * dpi);
  if (unit === 'in') return Math.round(value * dpi);
  return Math.round(value);
}

export function fromPx(px, unit = 'px', dpi = DPI) {
  if (unit === 'mm') return Math.round(((px / dpi) * 25.4) * 10) / 10;
  if (unit === 'in') return Math.round((px / dpi) * 100) / 100;
  return Math.round(px);
}

export function createPage(background) {
  return { id: uid('p'), background: background || { type: 'color', color: '#ffffff' }, elements: [] };
}

export function createDesign({ width = 1080, height = 1080, name = 'Untitled design', unit = 'px' } = {}) {
  if (!(width > 0 && height > 0)) throw new Error('A design needs a width and height above zero');
  if (width > 20000 || height > 20000) throw new Error('Designs can be at most 20000 px on a side');
  const now = Date.now();
  return {
    version: FORMAT_VERSION,
    id: uid('d'),
    name,
    width: Math.round(width),
    height: Math.round(height),
    unit,
    pages: [createPage()],
    assets: {},
    createdAt: now,
    updatedAt: now,
  };
}

export function createDesignFromPreset(presetId) {
  const p = presetById(presetId);
  if (!p) throw new Error(`Unknown size preset: ${presetId}`);
  return createDesign({ width: p.w, height: p.h, unit: p.unit || 'px' });
}

function base(type, props) {
  return {
    id: uid(),
    type,
    x: 0,
    y: 0,
    w: 100,
    h: 100,
    rotation: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    flipX: false,
    flipY: false,
    shadow: null,
    ...props,
  };
}

export const TEXT_STYLES = {
  heading: { text: 'Add a heading', size: 96, weight: 700 },
  subheading: { text: 'Add a subheading', size: 56, weight: 600 },
  body: { text: 'Add a little bit of body text', size: 32, weight: 400 },
};

export function createText(props = {}) {
  return base('text', {
    w: 600,
    h: 120,
    text: 'Your text',
    font: 'Inter',
    size: 48,
    weight: 400,
    italic: false,
    underline: false,
    strike: false,
    color: '#1a1a2e',
    align: 'left',
    lineHeight: 1.2,
    letterSpacing: 0,
    caps: false,
    list: 'none',
    outline: null,
    highlight: null,
    curve: 0,
    ...props,
  });
}

export const SHAPES = ['rect', 'ellipse', 'triangle', 'star', 'polygon', 'heart', 'arrow', 'bubble', 'diamond', 'arch', 'blob'];

/** Shapes a photo can be framed in. 'none' is a plain (optionally rounded) rectangle. */
export const FRAME_MASKS = ['none', 'circle', 'arch', 'blob', 'heart', 'star', 'polygon', 'triangle', 'diamond'];

export function createShape(shape = 'rect', props = {}) {
  if (!SHAPES.includes(shape)) throw new Error(`Unknown shape: ${shape}`);
  return base('shape', {
    w: 300,
    h: 300,
    shape,
    fill: '#6c5ce7',
    stroke: null,
    strokeWidth: 0,
    dash: 'solid',
    radius: 0,
    sides: shape === 'polygon' ? 6 : 5,
    innerRatio: 0.45,
    ...props,
  });
}

export function createLine(props = {}) {
  return base('line', {
    w: 400,
    h: 24,
    stroke: '#1a1a2e',
    strokeWidth: 6,
    dash: 'solid',
    startCap: 'none',
    endCap: 'none',
    ...props,
  });
}

export const DEFAULT_FILTERS = { brightness: 100, contrast: 100, saturation: 100, grayscale: 0, sepia: 0, blur: 0, warmth: 0, tint: 0, hue: 0, vignette: 0, duotone: null };

export function createImage(assetId, props = {}) {
  return base('image', {
    w: 400,
    h: 300,
    assetId,
    crop: { x: 0, y: 0, w: 1, h: 1 },
    filters: { ...DEFAULT_FILTERS },
    radius: 0,
    mask: 'none',
    ...props,
  });
}

/**
 * A video on the page: shown like a picture (crop, filters, rounding, frame
 * shapes), playing from `trim.start` seconds when the page plays; `loop`
 * starts it over if it's shorter than the page.
 */
export function createVideo(assetId, props = {}) {
  return base('video', {
    w: 640,
    h: 360,
    assetId,
    crop: { x: 0, y: 0, w: 1, h: 1 },
    filters: { ...DEFAULT_FILTERS },
    radius: 0,
    mask: 'none',
    trim: { start: 0 },
    loop: true,
    ...props,
  });
}

/** Where a video is (seconds into its file) at `local` seconds into its page. */
export function videoTime(el, local, duration) {
  // A start point at or past the end means just before the end.
  const start = Math.max(0, duration > 0 ? Math.min(el.trim?.start || 0, duration - 0.04) : el.trim?.start || 0);
  const t = start + Math.max(0, local);
  if (!(duration > 0)) return t;
  if (el.loop === false) return Math.min(t, Math.max(0, duration - 0.04));
  return start + ((t - start) % Math.max(0.04, duration - start));
}

export const DRAW_TOOLS = {
  pen: { strokeWidth: 6, opacity: 1 },
  marker: { strokeWidth: 18, opacity: 1 },
  highlighter: { strokeWidth: 36, opacity: 0.4 },
};

/**
 * A freehand stroke from points in page pixels. The points are stored as
 * shares of the stroke's box, so the drawing stretches when it's resized.
 */
export function createDrawing(points, { tool = 'pen', stroke = '#1a1a2e', strokeWidth, ...props } = {}) {
  const width = strokeWidth ?? DRAW_TOOLS[tool]?.strokeWidth ?? 6;
  const { x, y, w, h, shares } = boxAround(points, width / 2);
  return base('draw', {
    x, y, w, h, tool, stroke, strokeWidth: width,
    opacity: DRAW_TOOLS[tool]?.opacity ?? 1,
    points: shares,
    ...props,
  });
}

/**
 * The same drawing with a different line width: the box is padded again so
 * the thicker (or thinner) line still fits inside it, with the line in place.
 */
export function restroke(el, width) {
  if (!el.points?.length) return { strokeWidth: width }; // nothing drawn: no box to fit
  const abs = el.points.map(([x, y]) => [el.x + x * el.w, el.y + y * el.h]);
  const { x, y, w, h, shares } = boxAround(abs, width / 2);
  return { x, y, w, h, points: shares, strokeWidth: width };
}

/** Drop points closer than `min` px to the last kept one (they add size, not shape). */
export function thinPoints(points, min = 2) {
  const out = [];
  for (const p of points) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) >= min) out.push(p);
  }
  const last = points[points.length - 1];
  if (last && out[out.length - 1] !== last) out.push(last);
  return out;
}

/** A photo frame: an image in a shape, empty until a photo is dropped in. */
export function createFrame(mask = 'none', props = {}) {
  return createImage(null, { w: 500, h: 500, mask, ...props });
}

export function createIcon(iconId, props = {}) {
  return base('icon', { w: 200, h: 200, iconId, color: '#1a1a2e', ...props });
}

export function createSticker(stickerId, props = {}) {
  return base('sticker', { w: 300, h: 300, stickerId, ...props });
}

export function createQr(data, props = {}) {
  return base('qr', { w: 300, h: 300, data, fg: '#000000', bg: '#ffffff', ...props });
}

export const CHART_TYPES = ['bar', 'line', 'pie', 'donut'];

export function createChart(chartType = 'bar', props = {}) {
  if (!CHART_TYPES.includes(chartType)) throw new Error(`Unknown chart: ${chartType}`);
  return base('chart', {
    w: 640,
    h: 420,
    chartType,
    data: [
      { label: 'Mon', value: 12 },
      { label: 'Tue', value: 19 },
      { label: 'Wed', value: 8 },
      { label: 'Thu', value: 15 },
      { label: 'Fri', value: 22 },
    ],
    colors: ['#f25c2a', '#ff9f43', '#ffd166', '#06d6a0', '#118ab2', '#5b5bd6'],
    font: 'Inter',
    textColor: '#16161d',
    showValues: true,
    ...props,
  });
}

export function createTable(props = {}) {
  return base('table', {
    w: 640,
    h: 240,
    rows: [
      ['Item', 'Size', 'Price'],
      ['Coffee', 'Small', '3.00'],
      ['Coffee', 'Large', '4.20'],
    ],
    header: true,
    stripes: true,
    font: 'Inter',
    size: 26,
    color: '#16161d',
    headerColor: '#ffffff',
    headerFill: '#16161d',
    stripeFill: '#f3f0ea',
    lineColor: '#e6e1d8',
    align: 'left',
    ...props,
  });
}

/** "Label, value" lines → chart data. Lines that don't parse are skipped. */
export function parseChartData(text) {
  const out = [];
  for (const line of String(text).split('\n')) {
    const m = line.match(/^\s*(.*?)\s*[,\t:]\s*(-?[\d.]+)\s*$/);
    if (m && Number.isFinite(+m[2])) out.push({ label: m[1], value: +m[2] });
  }
  return out;
}

export function chartDataText(data) {
  return data.map((d) => `${d.label}, ${d.value}`).join('\n');
}

/** Rows of text, cells split by tabs or commas → table rows (all the same width). */
export function parseTable(text) {
  const rows = String(text).split('\n').filter((l) => l.trim()).map((l) => l.split(l.includes('\t') ? '\t' : ',').map((c) => c.trim()));
  const cols = Math.max(1, ...rows.map((r) => r.length));
  return rows.map((r) => [...r, ...Array(cols - r.length).fill('')]);
}

export function tableText(rows) {
  return rows.map((r) => r.join(', ')).join('\n');
}

export function createGroup(children, props = {}) {
  return base('group', { children, ...props });
}

/** Add a picture, video or sound to the design (once: the same file is shared). Returns the asset id. */
export function addAsset(doc, { mime, dataUrl, width, height, name = '', kind = 'image', duration, poster }) {
  for (const [id, a] of Object.entries(doc.assets)) {
    if (a.dataUrl === dataUrl) return id;
  }
  const id = uid('a');
  doc.assets[id] = { type: kind, mime, dataUrl, width, height, name, ...(duration !== undefined ? { duration } : {}), ...(poster ? { poster } : {}) };
  return id;
}

/** The ids of the images a design actually shows (on elements, in groups, as backgrounds). */
export function usedAssetIds(doc) {
  const used = new Set();
  const visit = (els) => {
    for (const el of els) {
      if (el.type === 'image' || el.type === 'video') used.add(el.assetId);
      if (el.type === 'group') visit(el.children);
    }
  };
  if (doc.audio?.assetId) used.add(doc.audio.assetId);
  for (const p of doc.pages) {
    visit(p.elements);
    if (p.background?.type === 'image') used.add(p.background.assetId);
  }
  return used;
}

/** Remove images that no element or background uses any more. */
export function pruneAssets(doc) {
  const used = usedAssetIds(doc);
  for (const id of Object.keys(doc.assets)) if (!used.has(id)) delete doc.assets[id];
  return doc;
}

/** Whether an image element is an empty frame: no picture yet, or its picture is missing. */
export function isEmptyFrame(doc, el) {
  return el?.type === 'image' && !doc.assets[el.assetId];
}

/** An animation or transition from a file: a known type and numbers in range, else nothing. */
function cleanMotion(m, kinds, ranges) {
  if (!m || typeof m !== 'object' || !Object.hasOwn(kinds, m.type) || m.type === 'none') return undefined;
  const out = { type: m.type };
  for (const [k, [lo, hi]] of Object.entries(ranges)) if (Number.isFinite(+m[k])) out[k] = Math.max(lo, Math.min(hi, +m[k]));
  return out;
}

/** Check that a parsed file looks like a Paperwall design. Throws a readable error if not. */
export function validateDesign(doc) {
  if (!doc || typeof doc !== 'object') throw new Error('This file is not a Paperwall design');
  doc.width = Number(doc.width);
  doc.height = Number(doc.height);
  if (typeof doc.name !== 'string') doc.name = 'Untitled design';
  if (doc.version !== FORMAT_VERSION) throw new Error(`Unsupported design version: ${doc.version}`);
  if (!(doc.width > 0 && doc.height > 0)) throw new Error('This design has no size');
  if (!Array.isArray(doc.pages) || !doc.pages.length) throw new Error('This design has no pages');
  if (!doc.assets || typeof doc.assets !== 'object') doc.assets = {};
  // Files can come from anyone: keep only well-formed elements with numeric geometry.
  const NUMERIC = ['x', 'y', 'w', 'h', 'rotation', 'opacity', 'size', 'weight', 'lineHeight', 'letterSpacing', 'curve', 'strokeWidth', 'radius', 'sides', 'innerRatio'];
  const clean = (els) => els.filter((el) => el && typeof el === 'object' && typeof el.type === 'string' && typeof el.id === 'string').map((el) => {
    for (const k of NUMERIC) if (k in el && el[k] !== null) el[k] = Number.isFinite(+el[k]) ? +el[k] : 0;
    if (el.type === 'group') el.children = Array.isArray(el.children) ? clean(el.children) : [];
    if (el.type === 'draw' || el.type === 'connector') el.points = (Array.isArray(el.points) ? el.points : []).filter((p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite));
    if (el.type === 'connector') {
      if (el.points.length !== 2) el.points = [[0, 0], [1, 1]];
      for (const k of ['start', 'end']) el[k] = { id: typeof el[k]?.id === 'string' ? el[k].id : null, side: ['l', 'r', 't', 'b'].includes(el[k]?.side) ? el[k].side : undefined };
    }
    if (el.anim !== undefined) el.anim = cleanMotion(el.anim, ANIMATIONS, { duration: [0.1, 10], delay: [0, 30] });
    if (el.type === 'video') {
      el.trim = { start: Math.max(0, Number.isFinite(+el.trim?.start) ? +el.trim.start : 0) };
      el.loop = el.loop !== false;
    }
    return el;
  });
  for (const p of doc.pages) {
    if (!p || !Array.isArray(p.elements)) throw new Error('A page in this design is damaged');
    p.elements = clean(p.elements);
    if (p.title !== undefined) p.title = typeof p.title === 'string' ? p.title.slice(0, 120) : undefined;
    if (p.hidden !== undefined) p.hidden = p.hidden === true || undefined;
    if (p.guides !== undefined) p.guides = (Array.isArray(p.guides) ? p.guides : []).filter((g) => g && (g.axis === 'x' || g.axis === 'y') && Number.isFinite(+g.pos)).map((g) => ({ axis: g.axis, pos: +g.pos }));
    if (p.anim !== undefined) p.anim = cleanMotion(p.anim, ANIMATIONS, { duration: [0.1, 10], stagger: [0, 2] });
    if (p.transition !== undefined) p.transition = cleanMotion(p.transition, TRANSITIONS, { duration: [0.1, 5] });
    if (p.duration !== undefined) p.duration = Number.isFinite(+p.duration) ? Math.max(0.5, Math.min(60, +p.duration)) : undefined;
  }
  for (const [id, a] of Object.entries(doc.assets)) {
    if (!a || typeof a.dataUrl !== 'string' || !/^data:(image|font|video|audio)\//.test(a.dataUrl)) delete doc.assets[id];
    else if (a.type === 'font') a.family = String(a.family || 'My font').replace(/[^\w\s-]/g, '').trim() || 'My font';
    else if (a.type === 'video' && !(typeof a.poster === 'string' && a.poster.startsWith('data:image/'))) a.poster = undefined;
  }
  // The soundtrack: a sound the design has, at a volume from 0 to 1.
  if (doc.audio !== undefined) {
    const a = doc.audio && doc.assets[doc.audio.assetId];
    doc.audio = a && a.type === 'audio' ? { assetId: doc.audio.assetId, volume: Number.isFinite(+doc.audio.volume) ? Math.max(0, Math.min(1, +doc.audio.volume)) : 1 } : undefined;
  }
  return doc;
}

export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

/** A copy of a design for its version history. Images never change once added, so they're shared, not copied. */
export function versionSnapshot(doc) {
  // Only the images it shows (ones replaced long ago needn't be kept by every
  // version), and every font it carries.
  const used = usedAssetIds(doc);
  const assets = Object.fromEntries(Object.entries(doc.assets || {}).filter(([id, a]) => used.has(id) || a?.type === 'font'));
  return { ...clone({ ...doc, assets: undefined }), assets };
}
