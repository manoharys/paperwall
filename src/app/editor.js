// The editor's state and every action you can take. The interface (canvas,
// panels, shortcuts) calls these; each change records one undo step.

import { History } from '../model/history.js';
import * as cmd from '../model/commands.js';
import {
  createText, createShape, createLine, createImage, createFrame, createDrawing, thinPoints, createIcon, createSticker, createQr, createChart, createTable, addAsset, uid,
  TEXT_STYLES, clone,
} from '../model/doc.js';
import { fitHeight } from '../model/text-layout.js';
import { curveGeometry } from '../model/render.js';
import { unionBounds, pointInBox } from '../model/geometry.js';
import { gridBoxes } from '../model/grids.js';

const VIEW_KEY = 'paperwall-view';
const DEFAULT_VIEW = { rulers: false, grid: false, gridSize: 'medium', snapGrid: true, margins: false, bleed: false };

function loadView() {
  try {
    return { ...DEFAULT_VIEW, ...JSON.parse(localStorage.getItem(VIEW_KEY) || '{}') };
  } catch {
    return { ...DEFAULT_VIEW };
  }
}

/** Grid spacing in page px: a share of the page's shorter side. */
export function gridStep(doc, size = 'medium') {
  const share = { small: 1 / 40, medium: 1 / 20, large: 1 / 10 }[size] || 1 / 20;
  return Math.max(4, Math.round(Math.min(doc.width, doc.height) * share));
}

/** Safe margin: keep important things inside it. */
export function marginSize(doc) {
  return Math.round(Math.min(doc.width, doc.height) * 0.05);
}

/** Print bleed: 3 mm at 300 dpi, the strip that may be trimmed off. */
export const BLEED = 35;
import { measure, ensureFont } from './fonts.js';
import { removePlainBackground } from '../model/bgremove.js';
import { readFileAsDataUrl, loadImage, toast, debounce } from './ui.js';
import * as store from './store.js';

let clipboard = null; // shared between designs, like a real clipboard
let styleClipboard = null;

export class Editor {
  constructor(doc, { onOpenDesign, makeThumb } = {}) {
    this.makeThumb = makeThumb;
    this.doc = doc;
    this.page = 0;
    this.selection = [];
    this.zoom = 1;
    this.history = new History();
    this.editingTextId = null;
    this.cropId = null;
    this.drawTool = null; // { tool, color, size } while drawing
    this.view = loadView();
    this.guides = [];
    this.listeners = new Set();
    this.onOpenDesign = onOpenDesign;
    this.saving = false;
    this.save = debounce(() => this.persist(), 400);
    this.thumb = debounce(() => this.persistThumb(), 1500);
  }

  // ---------- events ----------

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(what) {
    for (const fn of this.listeners) fn(what);
  }

  get pageData() {
    return this.doc.pages[this.page];
  }

  get selected() {
    return cmd.selectElements(this.pageData, this.selection);
  }

  get single() {
    const s = this.selected;
    return s.length === 1 ? s[0] : null;
  }

  // ---------- changes ----------

  /** Run a change as one undo step. `key` merges rapid repeats (typing, nudging). */
  change(fn, { key = null, quiet = false } = {}) {
    this.history.record(this.doc, key);
    const result = fn();
    this.afterChange(quiet);
    return result;
  }

  afterChange(quiet = false) {
    this.doc.updatedAt = Date.now();
    this.selection = this.selection.filter((id) => cmd.findElement(this.pageData, id));
    if (!quiet) this.emit('doc');
    this.save();
    this.thumb();
  }

  async persist() {
    try {
      await store.saveDesign(this.doc);
    } catch (e) {
      toast(`Couldn't save on this device: ${e.message}`, 'error');
    }
  }

  async persistThumb() {
    if (!this.makeThumb) return;
    try {
      await store.saveDesign(this.doc, await this.makeThumb(this.doc));
    } catch {
      /* thumbnails are optional */
    }
  }

  /** Save now. Resolves when the design is on disk. */
  flush() {
    return this.save.flush();
  }

  undo() {
    if (!this.history.canUndo) return;
    this.doc = this.history.undo(this.doc);
    this.page = Math.min(this.page, this.doc.pages.length - 1);
    this.editingTextId = null;
    this.afterChange();
  }

  redo() {
    if (!this.history.canRedo) return;
    this.doc = this.history.redo(this.doc);
    this.page = Math.min(this.page, this.doc.pages.length - 1);
    this.afterChange();
  }

  // ---------- selection ----------

  select(ids, { add = false } = {}) {
    if (add) {
      const set = new Set(this.selection);
      for (const id of ids) {
        if (set.has(id)) set.delete(id);
        else set.add(id);
      }
      this.selection = [...set];
    } else {
      this.selection = [...ids];
    }
    this.cropId = null;
    this.emit('selection');
  }

  selectAll() {
    this.select(this.pageData.elements.filter((e) => !e.hidden).map((e) => e.id));
  }

  deselect() {
    if (!this.selection.length && !this.cropId) return;
    this.selection = [];
    this.cropId = null;
    this.emit('selection');
  }

  setPage(i) {
    if (i < 0 || i >= this.doc.pages.length || i === this.page) return;
    this.page = i;
    this.selection = [];
    this.editingTextId = null;
    this.cropId = null;
    this.emit('page');
  }

  // ---------- adding things ----------

  insert(el, { center = true } = {}) {
    if (el.type === 'text') this.fitText(el);
    this.change(() => cmd.addElement(this.doc, this.page, el, { center }));
    this.select([el.id]);
    return el;
  }

  /** Scale a new element so it suits the page size. */
  scaled(el, share = 0.4) {
    const s = (Math.min(this.doc.width, this.doc.height) * share) / Math.max(el.w, el.h);
    if (Math.abs(s - 1) > 0.05) cmd.scaleElement(el, s, s);
    return el;
  }

  addText(style = 'body', props = {}) {
    const base = TEXT_STYLES[style] || TEXT_STYLES.body;
    const k = Math.max(0.3, Math.min(this.doc.width, this.doc.height) / 1080);
    const el = createText({ ...base, size: Math.round(base.size * k), w: Math.round(this.doc.width * 0.7), ...props });
    return this.insert(el);
  }

  addShape(shape, props = {}) {
    return this.insert(this.scaled(createShape(shape, props), 0.3));
  }

  addLine(props = {}) {
    const el = createLine(props);
    const s = (this.doc.width * 0.4) / el.w;
    el.w *= s;
    el.strokeWidth = Math.max(2, Math.round(el.strokeWidth * Math.max(1, s * 0.8)));
    el.h = Math.max(24, el.strokeWidth * 8);
    return this.insert(el);
  }

  addIcon(iconId, props = {}) {
    return this.insert(this.scaled(createIcon(iconId, props), 0.2));
  }

  addSticker(stickerId) {
    return this.insert(this.scaled(createSticker(stickerId), 0.3));
  }

  addQr(data) {
    return this.insert(this.scaled(createQr(data), 0.3));
  }

  addChart(chartType, props = {}) {
    return this.insert(this.scaled(createChart(chartType, props), 0.55));
  }

  addTable(props = {}) {
    const el = createTable(props);
    const s = (this.doc.width * 0.7) / el.w;
    cmd.scaleElement(el, s, s);
    return this.insert(el);
  }

  /**
   * Add an image (from a file, the clipboard or the uploads library). If an
   * empty frame is selected, the image goes into it instead.
   */
  async addImage(upload, { at } = {}) {
    const frame = this.single;
    if (!at && frame?.type === 'image' && !frame.assetId) return this.fillFrame(frame.id, upload);
    const assetId = addAsset(this.doc, upload);
    const maxW = this.doc.width * 0.6;
    const maxH = this.doc.height * 0.6;
    const s = Math.min(1, maxW / upload.width, maxH / upload.height);
    const el = createImage(assetId, { w: Math.round(upload.width * s), h: Math.round(upload.height * s) });
    if (at) {
      el.x = at.x - el.w / 2;
      el.y = at.y - el.h / 2;
      return this.insert(el, { center: false });
    }
    return this.insert(el);
  }

  async importImageFile(file) {
    if (!file.type.startsWith('image/')) throw new Error(`${file.name} isn't an image`);
    const dataUrl = await readFileAsDataUrl(file);
    const img = await loadImage(dataUrl);
    const upload = { id: uid('u'), name: file.name, mime: file.type, dataUrl, width: img.naturalWidth, height: img.naturalHeight, addedAt: Date.now() };
    await store.saveUpload(upload).catch(() => null);
    return upload;
  }

  async replaceImage(upload) {
    const el = this.single;
    if (!el || el.type !== 'image') return;
    this.fillFrame(el.id, upload);
  }

  /** Put a picture in an image or frame, keeping its place and shape: it's cropped to fill. */
  fillFrame(id, upload) {
    const el = cmd.findElement(this.pageData, id);
    if (!el || el.type !== 'image') return null;
    this.change(() => {
      el.assetId = addAsset(this.doc, upload);
      const frame = el.w / el.h;
      const pic = upload.width / upload.height;
      el.crop = pic > frame ? { x: (1 - frame / pic) / 2, y: 0, w: frame / pic, h: 1 } : { x: 0, y: (1 - pic / frame) / 2, w: 1, h: pic / frame };
    });
    this.select([el.id]);
    return el;
  }

  /** The frame at a point on the page, if any: an empty one, or a photo in a shape. */
  frameAt(p) {
    const els = this.pageData.elements;
    for (let i = els.length - 1; i >= 0; i--) {
      const el = els[i];
      if (el.type !== 'image' || el.locked || el.hidden) continue;
      if ((!el.assetId || (el.mask && el.mask !== 'none')) && pointInBox(p.x, p.y, el)) return el;
    }
    return null;
  }

  // ---------- view: rulers, guides, grid, margins, bleed ----------

  /** Change how the page is shown (not part of the design). Remembered in this browser. */
  setView(patch) {
    this.view = { ...this.view, ...patch };
    try {
      localStorage.setItem(VIEW_KEY, JSON.stringify(this.view));
    } catch {
      /* private mode: fine for this session */
    }
    this.emit('view');
  }

  /** Lines to snap to besides elements: your guides, and the grid when snapping to it. */
  snapLines() {
    const x = [];
    const y = [];
    for (const g of this.pageData.guides || []) (g.axis === 'x' ? x : y).push(g.pos);
    const v = this.view;
    if (v.grid && v.snapGrid) {
      const step = gridStep(this.doc, v.gridSize);
      for (let p = step; p < this.doc.width; p += step) x.push(p);
      for (let p = step; p < this.doc.height; p += step) y.push(p);
    }
    if (v.margins) {
      const m = marginSize(this.doc);
      x.push(m, this.doc.width - m);
      y.push(m, this.doc.height - m);
    }
    return { x, y };
  }

  /** Guides are part of the page, so they're saved and can be undone. */
  addGuide(axis, pos) {
    this.change(() => (this.pageData.guides = [...(this.pageData.guides || []), { axis, pos: Math.round(pos) }]));
    return this.pageData.guides.length - 1;
  }

  moveGuide(i, pos, live = false) {
    const g = this.pageData.guides?.[i];
    if (!g) return;
    if (live) {
      g.pos = Math.round(pos);
      return this.emit('view');
    }
    this.change(() => (g.pos = Math.round(pos)));
  }

  removeGuide(i) {
    if (!this.pageData.guides?.[i]) return;
    this.change(() => this.pageData.guides.splice(i, 1));
  }

  clearGuides() {
    if (!this.pageData.guides?.length) return;
    this.change(() => (this.pageData.guides = []));
  }

  /** Turn a freehand stroke (page points) into a drawing with the current tool. */
  addDrawing(points) {
    const t = this.drawTool;
    if (!t || !points.length) return null;
    const el = createDrawing(thinPoints(points, 1.5 / this.zoom), { tool: t.tool, stroke: t.color, strokeWidth: t.size });
    this.change(() => cmd.addElement(this.doc, this.page, el));
    return el;
  }

  addFrame(mask = 'none', props = {}) {
    return this.insert(this.scaled(createFrame(mask, props), 0.45));
  }

  /** Fill the page with a grid of empty frames, ready for photos. */
  addGrid(grid) {
    const s = Math.min(this.doc.width, this.doc.height);
    const boxes = gridBoxes(grid, this.doc.width, this.doc.height, { margin: Math.round(s * 0.04), gap: Math.round(s * 0.02) });
    const frames = boxes.map((b) => createFrame('none', b));
    this.change(() => {
      for (const el of frames) cmd.addElement(this.doc, this.page, el, { center: false });
    });
    this.select(frames.map((el) => el.id));
    return frames;
  }

  /** Make a plain background see-through. Returns how much of the picture was cleared (0..1). */
  async removeBackground(tolerance = 0.12) {
    const el = this.single;
    if (!el || el.type !== 'image') return 0;
    const asset = this.doc.assets[el.assetId];
    if (!asset) return 0;
    const img = await loadImage(asset.dataUrl);
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const g = canvas.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const pixels = g.getImageData(0, 0, canvas.width, canvas.height);
    const cleared = removePlainBackground(pixels.data, canvas.width, canvas.height, { tolerance });
    if (!cleared) return 0;
    g.putImageData(pixels, 0, 0);
    const dataUrl = canvas.toDataURL('image/png');
    this.change(() => {
      el.assetId = addAsset(this.doc, { mime: 'image/png', dataUrl, width: canvas.width, height: canvas.height, name: `${asset.name || 'image'} (no background)` });
    });
    return cleared / (canvas.width * canvas.height);
  }

  setImageAsBackground() {
    const el = this.single;
    if (!el || el.type !== 'image' || !el.assetId) return;
    this.change(() => {
      cmd.setBackground(this.doc, this.page, { type: 'image', assetId: el.assetId, color: '#ffffff' });
      cmd.deleteElements(this.doc, this.page, [el.id]);
    });
    this.selection = [];
    this.emit('selection');
  }

  // ---------- editing ----------

  /** Switch the selected text to another font, once it has loaded. */
  async setFont(font) {
    // Remember what was selected, and where: either can change while the font loads.
    const ids = this.selection;
    const pageId = this.pageData.id;
    const weights = new Set(this.selected.map((el) => el.weight || 400));
    await Promise.all([...weights].map((w) => ensureFont(font, w)));
    this.update({ font }, null, ids, pageId);
  }

  /** Change elements (the selection by default) on a page (the current one by default). */
  update(props, key = null, ids = this.selection, pageId = this.pageData.id) {
    const page = this.doc.pages.findIndex((p) => p.id === pageId);
    if (page < 0) return;
    ids = ids.filter((id) => cmd.findElement(this.doc.pages[page], id));
    if (!ids.length) return;
    this.change(() => {
      cmd.updateElements(this.doc, page, ids, props);
      for (const el of cmd.selectElements(this.doc.pages[page], ids)) if (el.type === 'text') this.fitText(el);
    }, { key: key ? `${key}:${ids.join(',')}` : null });
  }

  /** Keep a text box tall enough for its text. */
  fitText(el) {
    if (el.type !== 'text') return;
    if (el.curve) {
      const text = (el.caps ? el.text.toUpperCase() : el.text).replace(/\s*\n\s*/g, ' ');
      const tw = measure(text, el) + (el.letterSpacing || 0) * [...text].length;
      el.w = Math.max(el.w, Math.min(tw * 1.05, this.doc.width * 2));
      el.h = Math.ceil(curveGeometry(el, tw).height);
      return;
    }
    el.h = fitHeight(el, measure);
  }

  /** Measure text again (all of it, or the boxes `which` picks). Returns whether any height changed. */
  refitAllText(which = () => true) {
    let changed = false;
    const visit = (els) => {
      for (const el of els) {
        if (el.type === 'text' && which(el)) {
          const before = [el.w, el.h];
          this.fitText(el);
          if (el.w !== before[0] || el.h !== before[1]) changed = true;
        }
        if (el.type === 'group') visit(el.children);
      }
    };
    this.doc.pages.forEach((p) => visit(p.elements));
    return changed;
  }

  deleteSelection() {
    if (!this.selection.length) return;
    const ids = this.selection;
    const removed = this.change(() => cmd.deleteElements(this.doc, this.page, ids));
    if (removed < ids.length) toast('Locked elements were kept. Unlock them to delete.');
    // Whatever was locked stays selected, so it can be unlocked right away.
    this.selection = ids.filter((id) => cmd.findElement(this.pageData, id));
    this.emit('selection');
  }

  duplicate() {
    if (!this.selection.length) return;
    const ids = this.change(() => cmd.duplicateElements(this.doc, this.page, this.selection, Math.round(Math.min(this.doc.width, this.doc.height) * 0.02)));
    this.select(ids);
  }

  copy() {
    if (!this.selection.length) return false;
    clipboard = { els: cmd.copyElements(this.doc, this.page, this.selection), assets: this.assetsFor(this.selected), from: this.doc.id, page: this.page, pastes: 0 };
    return true;
  }

  cut() {
    if (!this.copy()) return;
    clipboard.pastes = -1;
    this.deleteSelection();
  }

  paste() {
    if (!clipboard) return false;
    clipboard.pastes++;
    const samePlace = clipboard.from === this.doc.id && clipboard.page === this.page;
    const offset = samePlace ? Math.round(Math.min(this.doc.width, this.doc.height) * 0.02) * Math.max(1, clipboard.pastes) : 0;
    const ids = this.change(() => {
      for (const [id, a] of Object.entries(clipboard.assets)) if (!this.doc.assets[id]) this.doc.assets[id] = a;
      return cmd.pasteElements(this.doc, this.page, clipboard.els, offset);
    });
    this.select(ids);
    return true;
  }

  assetsFor(els) {
    const out = {};
    const visit = (list) => {
      for (const el of list) {
        if (el.type === 'image' && this.doc.assets[el.assetId]) out[el.assetId] = this.doc.assets[el.assetId];
        if (el.type === 'group') visit(el.children);
      }
    };
    visit(els);
    return out;
  }

  copyStyle() {
    const el = this.single;
    if (!el) return;
    styleClipboard = cmd.copyStyle(el);
    toast('Style copied. Select something and paste the style.');
  }

  pasteStyle() {
    if (!styleClipboard || !this.selection.length) return;
    this.change(() => {
      cmd.pasteStyle(this.doc, this.page, this.selection, styleClipboard);
      for (const el of this.selected) this.fitText(el);
    });
  }

  get hasStyle() {
    return !!styleClipboard;
  }

  group() {
    const id = this.change(() => cmd.groupElements(this.doc, this.page, this.selection));
    if (id) this.select([id]);
  }

  ungroup() {
    const g = this.single;
    if (!g || g.type !== 'group') return;
    const ids = this.change(() => cmd.ungroup(this.doc, this.page, g.id));
    this.select(ids);
  }

  toggleLock() {
    const els = this.selected;
    if (!els.length) return;
    const lock = els.some((e) => !e.locked);
    this.change(() => els.forEach((e) => (e.locked = lock)));
    this.emit('selection');
  }

  toggleHidden(id) {
    const el = cmd.findElement(this.pageData, id);
    if (!el) return;
    this.change(() => (el.hidden = !el.hidden));
  }

  reorder(how) {
    if (this.selection.length) this.change(() => cmd.reorder(this.doc, this.page, this.selection, how));
  }

  moveLayer(id, index) {
    this.change(() => cmd.moveToIndex(this.doc, this.page, id, index));
  }

  align(how) {
    if (this.selection.length) this.change(() => cmd.alignElements(this.doc, this.page, this.selection, how));
  }

  distribute(axis) {
    if (this.selection.length >= 3) this.change(() => cmd.distributeElements(this.doc, this.page, this.selection, axis));
  }

  flip(axis) {
    if (this.selection.length) this.change(() => cmd.flipElements(this.doc, this.page, this.selection, axis));
  }

  nudge(dx, dy) {
    if (!this.selection.length) return;
    this.change(() => cmd.moveElements(this.doc, this.page, this.selection, dx, dy), { key: `nudge:${this.selection.join(',')}` });
  }

  selectionBounds() {
    const els = this.selected;
    return els.length ? unionBounds(els) : null;
  }

  // ---------- pages ----------

  addPage() {
    const i = this.change(() => cmd.addPage(this.doc, this.page));
    this.setPage(i);
  }

  duplicatePage(i = this.page) {
    const n = this.change(() => cmd.duplicatePage(this.doc, i));
    this.setPage(n);
  }

  deletePage(i = this.page) {
    if (this.doc.pages.length <= 1) {
      toast('A design needs at least one page.');
      return;
    }
    const n = this.change(() => cmd.deletePage(this.doc, i));
    this.page = -1;
    this.setPage(n);
  }

  movePage(from, to) {
    const n = this.change(() => cmd.movePage(this.doc, from, to));
    this.page = -1;
    this.setPage(n);
  }

  setBackground(bg, key = null) {
    this.change(() => cmd.setBackground(this.doc, this.page, bg), { key: key ? `bg:${key}:${this.page}` : null });
  }

  /**
   * Add every page of a template after the current page, resized to fit.
   * Its fonts must already be loaded (see readyTemplate).
   */
  addTemplatePage(templateDoc) {
    const resized = cmd.resizeDesign(templateDoc, this.doc.width, this.doc.height);
    const first = this.change(() => {
      for (const [id, a] of Object.entries(resized.assets || {})) this.doc.assets[id] = a;
      let at = this.page;
      let firstAdded = -1;
      for (const p of resized.pages) {
        const page = clone(p);
        page.id = uid('p');
        at = cmd.addPage(this.doc, at, page);
        if (firstAdded < 0) firstAdded = at;
      }
      return firstAdded;
    });
    this.refitAllText();
    this.setPage(first);
  }

  // ---------- whole design ----------

  rename(name) {
    const clean = name.trim().slice(0, 120) || 'Untitled design';
    if (clean === this.doc.name) return;
    this.change(() => (this.doc.name = clean), { key: 'rename' });
    this.emit('name');
  }

  /** Make a resized copy and open it; the original stays as it was. */
  async resizeTo(width, height, name) {
    const copy = cmd.resizeDesign(this.doc, width, height);
    copy.name = name || `${this.doc.name} (${width} × ${height})`;
    copy.createdAt = Date.now();
    await this.flush();
    await store.saveDesign(copy, null);
    this.onOpenDesign?.(copy.id);
    return copy;
  }

  async applyBrand(brand) {
    await Promise.all([brand.headingFont, brand.bodyFont].filter(Boolean).flatMap((f) => [ensureFont(f, 400), ensureFont(f, 700)]));
    this.change(() => {
      cmd.applyBrand(this.doc, brand);
      this.refitAllText();
    });
  }

  setZoom(z) {
    this.zoom = Math.max(0.05, Math.min(8, z));
    this.emit('view');
  }
}
