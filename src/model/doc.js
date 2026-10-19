// The design document: pages of elements, plus the images they use.

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

export function presetById(id) {
  return PRESETS.find((p) => p.id === id) || null;
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

export const SHAPES = ['rect', 'ellipse', 'triangle', 'star', 'polygon', 'heart', 'arrow', 'bubble', 'diamond'];

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

export const DEFAULT_FILTERS = { brightness: 100, contrast: 100, saturation: 100, grayscale: 0, sepia: 0, blur: 0 };

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

export function createIcon(iconId, props = {}) {
  return base('icon', { w: 200, h: 200, iconId, color: '#1a1a2e', ...props });
}

export function createSticker(stickerId, props = {}) {
  return base('sticker', { w: 300, h: 300, stickerId, ...props });
}

export function createQr(data, props = {}) {
  return base('qr', { w: 300, h: 300, data, fg: '#000000', bg: '#ffffff', ...props });
}

export function createGroup(children, props = {}) {
  return base('group', { children, ...props });
}

/** Add an image's bytes to the design. Returns the asset id. */
export function addAsset(doc, { mime, dataUrl, width, height, name = '' }) {
  for (const [id, a] of Object.entries(doc.assets)) {
    if (a.dataUrl === dataUrl) return id;
  }
  const id = uid('a');
  doc.assets[id] = { type: 'image', mime, dataUrl, width, height, name };
  return id;
}

/** Remove images that no element or background uses any more. */
export function pruneAssets(doc) {
  const used = new Set();
  const visit = (els) => {
    for (const el of els) {
      if (el.type === 'image') used.add(el.assetId);
      if (el.type === 'group') visit(el.children);
    }
  };
  for (const p of doc.pages) {
    visit(p.elements);
    if (p.background?.type === 'image') used.add(p.background.assetId);
  }
  for (const id of Object.keys(doc.assets)) if (!used.has(id)) delete doc.assets[id];
  return doc;
}

/** Check that a parsed file looks like a Placard design. Throws a readable error if not. */
export function validateDesign(doc) {
  if (!doc || typeof doc !== 'object') throw new Error('This file is not a Placard design');
  if (doc.version !== FORMAT_VERSION) throw new Error(`Unsupported design version: ${doc.version}`);
  if (!(doc.width > 0 && doc.height > 0)) throw new Error('This design has no size');
  if (!Array.isArray(doc.pages) || !doc.pages.length) throw new Error('This design has no pages');
  if (!doc.assets || typeof doc.assets !== 'object') doc.assets = {};
  for (const p of doc.pages) {
    if (!Array.isArray(p.elements)) throw new Error('A page in this design is damaged');
  }
  return doc;
}

export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
