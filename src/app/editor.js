// The editor's state and every action you can take. The interface (canvas,
// panels, shortcuts) calls these; each change records one undo step.

import { History } from '../model/history.js';
import * as cmd from '../model/commands.js';
import {
  createText, createShape, createLine, createImage, createIcon, createSticker, createQr, addAsset, uid,
  TEXT_STYLES, clone,
} from '../model/doc.js';
import { fitHeight } from '../model/text-layout.js';
import { curveGeometry } from '../model/render.js';
import { unionBounds } from '../model/geometry.js';
import { measure } from './fonts.js';
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

  flush() {
    this.save.flush();
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

  /** Add an image (from a file, the clipboard or the uploads library). */
  async addImage(upload, { at } = {}) {
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
    this.change(() => {
      el.assetId = addAsset(this.doc, upload);
      // Keep the frame; fit the new picture inside it by cropping.
      const frame = el.w / el.h;
      const pic = upload.width / upload.height;
      el.crop = pic > frame ? { x: (1 - frame / pic) / 2, y: 0, w: frame / pic, h: 1 } : { x: 0, y: (1 - pic / frame) / 2, w: 1, h: pic / frame };
    });
  }

  setImageAsBackground() {
    const el = this.single;
    if (!el || el.type !== 'image') return;
    this.change(() => {
      cmd.setBackground(this.doc, this.page, { type: 'image', assetId: el.assetId, color: '#ffffff' });
      cmd.deleteElements(this.doc, this.page, [el.id]);
    });
    this.selection = [];
    this.emit('selection');
  }

  // ---------- editing ----------

  update(props, key = null) {
    const ids = this.selection;
    if (!ids.length) return;
    this.change(() => {
      cmd.updateElements(this.doc, this.page, ids, props);
      for (const el of this.selected) if (el.type === 'text') this.fitText(el);
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

  refitAllText() {
    const visit = (els) => {
      for (const el of els) {
        if (el.type === 'text') this.fitText(el);
        if (el.type === 'group') visit(el.children);
      }
    };
    this.doc.pages.forEach((p) => visit(p.elements));
  }

  deleteSelection() {
    if (!this.selection.length) return;
    const ids = this.selection;
    const removed = this.change(() => cmd.deleteElements(this.doc, this.page, ids));
    if (removed < ids.length) toast('Locked elements were kept. Unlock them to delete.');
    this.selection = [];
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

  addTemplatePage(templateDoc) {
    const resized = cmd.resizeDesign(templateDoc, this.doc.width, this.doc.height);
    const page = clone(resized.pages[0]);
    page.id = uid('p');
    const i = this.change(() => {
      for (const [id, a] of Object.entries(resized.assets || {})) this.doc.assets[id] = a;
      return cmd.addPage(this.doc, this.page, page);
    });
    this.refitAllText();
    this.setPage(i);
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
    this.flush();
    await store.saveDesign(copy, null);
    this.onOpenDesign?.(copy.id);
    return copy;
  }

  applyBrand(brand) {
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
