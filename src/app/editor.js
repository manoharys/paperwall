// The editor's state and every action you can take. The interface (canvas,
// panels, shortcuts) calls these; each change records one undo step.

import { History } from '../model/history.js';
import * as cmd from '../model/commands.js';
import {
  createText, createShape, createLine, createImage, createVideo, createFrame, createDrawing, thinPoints, createIcon, createSticker, createQr, createChart, createTable, addAsset, uid,
  TEXT_STYLES, versionSnapshot, isEmptyFrame, DOCUMENT, stillIsCurrent,
} from '../model/doc.js';
import { fitHeight } from '../model/text-layout.js';
import { flowDocument, growBoard } from '../model/flow.js';
import { curveGeometry } from '../model/render.js';
import { unionBounds, pointInBox, toLocal, refitGroup } from '../model/geometry.js';
import { gridBoxes } from '../model/grids.js';
import { createConnector, updateConnectors, isLine, lineHit } from '../model/connectors.js';
import { gridLines, marginSize } from '../model/view.js';
import { maskPath } from '../model/shapes.js';

import { measure, ensureFont } from './fonts.js';
import { mediaKind, checkSize, videoInfo, audioInfo, VideoFrames } from './media.js';
import { removePlainBackground } from '../model/bgremove.js';
import { readFileAsDataUrl, loadImage, toast, debounce } from './ui.js';
import * as store from './store.js';

const VIEW_KEY = 'paperwall-view';
const VERSION_EVERY = 5 * 60 * 1000;
const DEFAULT_VIEW = { rulers: false, grid: false, gridSize: 'medium', snapGrid: true, margins: false, bleed: false };

function loadView() {
  try {
    return { ...DEFAULT_VIEW, ...JSON.parse(localStorage.getItem(VIEW_KEY) || '{}') };
  } catch {
    return { ...DEFAULT_VIEW };
  }
}

/**
 * An element anywhere in the design, inside groups too, in one pass:
 * { page, el, top } (top is the page-level element holding it). Its own
 * page, if it's still there, else wherever it is now.
 */
function locate(doc, id, pageId) {
  let other = null;
  for (const page of doc.pages) {
    for (const top of page.elements) {
      const el = deepFind([top], id);
      if (!el) continue;
      if (page.id === pageId) return { page, el, top };
      other ||= { page, el, top };
    }
  }
  return other;
}

/** An element anywhere on a page, inside groups too. */
function deepFind(els, id) {
  for (const el of els) {
    if (el.id === id) return el;
    const inner = el.type === 'group' && deepFind(el.children, id);
    if (inner) return inner;
  }
  return null;
}

let maskCtx = null;
const maskPaths = new WeakMap();

/** Whether page point p falls inside a frame's shape (a circle frame's corners don't count). */
function inMask(el, p) {
  if (!el.mask || el.mask === 'none' || el.mask === 'rect') return true;
  maskCtx ||= document.createElement('canvas').getContext('2d');
  if (!maskCtx || typeof Path2D === 'undefined') return true;
  // Into the frame's own box. Its outline is kept until the frame changes shape.
  const q = toLocal(el, p);
  const key = `${el.w},${el.h},${el.mask},${el.sides},${el.innerRatio},${el.radius}`;
  let shape = maskPaths.get(el);
  if (shape?.key !== key) maskPaths.set(el, (shape = { key, path: new Path2D(maskPath(el)) }));
  return maskCtx.isPointInPath(shape.path, q.x - el.x, q.y - el.y);
}

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
    // A design from elsewhere (a file, an older version) may have connector
    // ends out of place: put them on their elements before anything is drawn.
    this.syncAllConnectors();
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

  /**
   * Make a change as one undo step. `key` merges rapid repeats (typing,
   * nudging). `unchanged(result)` says when fn turned out to change nothing:
   * then no step is left and nothing is saved.
   */
  change(fn, { key = null, quiet = false, unchanged = null } = {}) {
    // A change that comes in mid-drag (a field committing as focus leaves it,
    // a button, a timer) gets its own undo step, never the drag's: the canvas
    // either lets a drag that hasn't moved carry on afterwards, or finishes one
    // that has, first. Either way the change happens now.
    const resume = this.isDragging?.() ? this.pauseDrag?.() : null;
    this.history.record(this.doc, key);
    this.changing = (this.changing || 0) + 1;
    try {
      let result;
      try {
        result = fn();
      } catch (e) {
        // Put back whatever fn changed before it failed, and leave no step.
        // (Merged into the step before, there's only that step to go back to.)
        const back = this.history.revert(this.doc) || (key ? this.history.rewind(this.doc) : null);
        if (back) {
          this.doc = back;
          // A paused drag holds elements of the design just replaced: it can't go on.
          if (resume) this.abandonDrag?.();
        }
        this.emit('doc');
        throw e;
      }
      if (unchanged?.(result)) this.history.discard();
      else this.afterChange(quiet);
      return result;
    } finally {
      this.changing -= 1;
      resume?.();
    }
  }

  /** After any change: save, refresh, keep connectors attached. `edit: false` for corrections (re-measuring), which don't call for a new version. */
  afterChange(quiet = false, { edit = true } = {}) {
    // Mid-drag, outside change() (text refitted as a font loads): after the
    // drag, which it mustn't cut short.
    if (this.isDragging?.() && !this.changing) return void this.whenIdle(() => this.afterChange(quiet, { edit }));
    this.arrange();
    this.retakeStills();
    // Connectors on every page follow what they're attached to (pages
    // without connectors return at once).
    this.syncAllConnectors();
    this.doc.updatedAt = Date.now();
    if (edit) this.changedSinceVersion = true;
    this.selection = this.selection.filter((id) => cmd.findElement(this.pageData, id));
    if (!quiet) this.emit('doc');
    this.save();
    this.thumb();
  }

  async persist() {
    try {
      await store.saveDesign(this.doc);
      // Every few minutes of work, keep a version to go back to.
      // Not awaited: saving the design itself shouldn't wait on history.
      // (versionAt is set once we know whether the design has versions yet.)
      // (Not mid-drag: the design is half-moved then; the next save tries again.)
      this.maybeSaveVersion(VERSION_EVERY);
    } catch (e) {
      toast(`Couldn't save on this device: ${e.message}`, 'error');
    }
  }

  async persistThumb() {
    if (!this.makeThumb) return;
    if (this.isDragging?.() && !this.closed) return void this.thumb(); // not a half-moved picture: after the drag
    try {
      const at = this.doc.updatedAt;
      const url = await this.makeThumb(this.doc);
      // Reused by a version saved soon after, if it's known to show that state
      // (nothing changed while it was drawn).
      if (this.doc.updatedAt === at) this.lastThumb = { url, at };
      // Just the preview: the design itself is saved by persist.
      await store.saveThumb(this.doc.id, url);
    } catch {
      /* thumbnails are optional */
    }
  }

  /** Save now. Resolves when the design is on disk. */
  flush() {
    return this.save.flush();
  }

  /**
   * Keep a version if there's work since the last one, at least `gap` ms
   * after it, the first check for versions is done and no drag is going.
   * The one rule for timed, tab-hidden and closing versions.
   */
  maybeSaveVersion(gap, opts) {
    if (!this.changedSinceVersion || !this.versionAt || this.isDragging?.() || Date.now() - this.versionAt <= gap) return null;
    return this.saveVersion('', opts);
  }

  /**
   * Keep a copy of the design as it is now (or `snapshot`, taken earlier) in
   * its version history. `quick` skips drawing a new thumbnail (the tab is
   * closing); the history list draws one from the version instead.
   * Resolves to whether it was saved.
   */
  async saveVersion(label = '', { snapshot = null, quick = false } = {}) {
    this.versionAt = Date.now();
    // Edits made after an earlier snapshot was taken still need a version of their own.
    const covers = !snapshot || snapshot.updatedAt >= this.doc.updatedAt;
    if (covers) this.changedSinceVersion = false;
    // The design as it is right now, before anything below waits.
    snapshot ||= versionSnapshot(this.doc);
    try {
      // A small picture of the first page, so the history list needn't load
      // whole designs: the home-screen one if it's up to date, else a new one.
      const fresh = () => (this.lastThumb?.at === snapshot.updatedAt ? this.lastThumb.url : null);
      // A home-screen thumbnail is usually on its way: draw it now and use it for both.
      if (!fresh() && !quick) await this.thumb.flushPending();
      const thumb = fresh() || (quick || !this.makeThumb ? null : await this.makeThumb(snapshot).catch(() => null));
      await store.saveVersion(snapshot, { label, thumb });
      return true;
    } catch {
      // History is a convenience; saving the design itself matters more. The
      // work still needs a version, so the next chance (closing, say) tries again.
      if (covers) this.changedSinceVersion = true;
      return false;
    }
  }

  /** Put the design back the way a version had it, as one undo step. */
  restoreVersion(versionDoc) {
    // Copied: without IndexedDB, versions live in memory and would share
    // their pages with the design. (Images aren't copied: they never change.)
    const v = versionSnapshot(versionDoc);
    this.change(() => {
      // Keep today's images too: undo snapshots share the design's assets.
      Object.assign(this.doc, { name: v.name, width: v.width, height: v.height, unit: v.unit, pages: v.pages, assets: { ...this.doc.assets, ...v.assets } });
      // The soundtrack too, as the version had it (none, if it had none).
      if (v.audio) this.doc.audio = v.audio;
      else delete this.doc.audio;
      this.page = 0; // the version may have fewer pages than the one in view
    });
    this.selection = [];
    this.page = -1;
    this.setPage(0);
    this.emit('name');
  }

  undo() {
    if (!this.history.canUndo || this.isDragging?.()) return;
    this.doc = this.history.undo(this.doc);
    this.page = Math.min(this.page, this.doc.pages.length - 1);
    this.editingTextId = null;
    this.afterChange();
  }

  /** Run fn now, or once the drag that's going is over. */
  whenIdle(fn) {
    if (!this.isDragging?.()) return void fn();
    (this.idle ||= []).push(fn);
  }

  /** The drag is over: run what waited for it. */
  dragEnded() {
    const waiting = this.idle || [];
    this.idle = [];
    for (const fn of waiting) fn();
  }

  /** Call off a change halfway: the design goes back to its last recorded step, which is forgotten. */
  revertPending() {
    const back = this.history.revert(this.doc);
    if (!back) return;
    this.doc = back;
    this.selection = this.selection.filter((id) => cmd.findElement(this.pageData, id));
    this.emit('doc');
    this.emit('aids');
    // A save may have run mid-drag: store the design as it is again.
    this.save();
    this.thumb();
  }

  redo() {
    if (!this.history.canRedo || this.isDragging?.()) return;
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
    if (this.isDragging?.()) this.endDrag?.(); // a drag belongs to the page it began on
    this.page = i;
    this.selection = [];
    this.editingTextId = null;
    this.cropId = null;
    this.emit('page');
  }

  // ---------- adding things ----------

  /** A document's blocks flow down its page; a whiteboard grows to hold what's on it (see flow.js). */
  arrange() {
    if (this.doc.document) flowDocument(this.doc, measure);
    else if (this.doc.board) {
      // (Grown on the left or top: the canvas scrolls by as much, so nothing seems to move.)
      const moved = growBoard(this.doc);
      if (moved && (moved.dx || moved.dy)) this.boardMoved = { dx: (this.boardMoved?.dx || 0) + moved.dx, dy: (this.boardMoved?.dy || 0) + moved.dy };
    }
  }

  insert(el, { center = true } = {}) {
    if (el.type === 'text') this.fitText(el);
    // On a whiteboard, something new goes in the middle of what's in view.
    if (this.doc.board && center && this.viewCenter) {
      const at = this.viewCenter();
      center = false;
      el.x = Math.round(at.x - el.w / 2);
      el.y = Math.round(at.y - el.h / 2);
    }
    // In a document, something new goes at the end (where it flows to),
    // unless it was put somewhere (dropped between two blocks, say).
    if (this.doc.document && center) {
      center = false;
      el.y = this.pageData.elements.reduce((end, e) => Math.max(end, e.y + e.h), 0) + 1;
    }
    this.change(() => cmd.addElement(this.doc, this.page, el, { center }));
    this.select([el.id]);
    return el;
  }

  /** Scale a new element so it suits the page size. */
  /** How big the page is for sizing new things: its shorter side (a whiteboard's as it began, however it has grown). */
  get sizeRef() {
    return Math.min(this.fitW, this.fitH);
  }

  /** The page's width and height for sizing new things (a whiteboard's as it began, however it has grown). */
  get fitW() {
    return this.doc.board ? Math.min(3600, this.doc.width) : this.doc.width;
  }

  get fitH() {
    return this.doc.board ? Math.min(2400, this.doc.height) : this.doc.height;
  }

  scaled(el, share = 0.4) {
    const s = (this.sizeRef * share) / Math.max(el.w, el.h);
    if (Math.abs(s - 1) > 0.05) cmd.scaleElement(el, s, s);
    return el;
  }

  addText(style = 'body', props = {}) {
    const base = TEXT_STYLES[style] || TEXT_STYLES.body;
    const k = Math.max(0.3, this.sizeRef / 1080);
    // (On a whiteboard, as wide as on its first canvas.)
    const el = createText({ ...base, size: Math.round(base.size * k), w: Math.round(this.fitW * 0.7), ...props });
    return this.insert(el);
  }

  addShape(shape, props = {}) {
    return this.insert(this.scaled(createShape(shape, props), 0.3));
  }

  addLine(props = {}) {
    const el = createLine(props);
    const s = (this.fitW * 0.4) / el.w;
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
    const s = (this.fitW * 0.7) / el.w;
    cmd.scaleElement(el, s, s);
    return this.insert(el);
  }

  /**
   * Add an image (from a file, the clipboard or the uploads library). If an
   * empty frame is selected, the image goes into it instead.
   */
  async addImage(upload, { at } = {}) {
    const frame = this.single;
    if (!at && isEmptyFrame(this.doc, frame) && !frame.locked) return this.fillFrame(frame.id, upload);
    const assetId = addAsset(this.doc, upload);
    const maxW = this.fitW * 0.6;
    const maxH = this.fitH * 0.6;
    const s = Math.min(1, maxW / upload.width, maxH / upload.height);
    const el = createImage(assetId, { w: Math.round(upload.width * s), h: Math.round(upload.height * s) });
    if (at) {
      el.x = at.x - el.w / 2;
      el.y = at.y - el.h / 2;
      return this.insert(el, { center: false });
    }
    return this.insert(el);
  }

  /**
   * Take a video's still picture (what shows on the page, in thumbnails and
   * in still downloads) from where it starts, full size (up to 1920 px).
   * Not an undo step of its own: it follows the video's start point. A
   * moment after the last call for a video (a start point stepped through
   * quickly loads the video once). Resolves when it's done.
   */
  refreshStill(id) {
    this.stills ||= new Map(); // video id → { timer, done }
    const before = this.stills.get(id);
    if (before) {
      clearTimeout(before.timer);
      before.done();
    }
    return new Promise((done) => {
      const timer = setTimeout(() => {
        // (Still listed while it's taken, so changes meanwhile don't start another.)
        this.takeStill(id).finally(() => {
          if (this.stills.get(id)?.timer === timer) this.stills.delete(id);
          this.retakeStills(); // (its start may have moved while it was taken)
          done();
        });
      }, 250);
      this.stills.set(id, { timer, done });
    });
  }

  /** Videos whose still isn't from where they start now (moved, undone, pasted) get a new one. */
  retakeStills() {
    // (One at a time, and none once the editor has closed: each loads its whole video.)
    if (this.closed || this.stills?.size) return;
    this.stillFailed ||= new Map(); // video id → a start no still could be taken from (not tried again and again)
    const walk = (els) => {
      for (const el of els) {
        if (el.type === 'group' && walk(el.children)) return true;
        if (el.type !== 'video' || !this.doc.assets[el.assetId]) continue;
        const start = el.trim?.start || 0;
        if (stillIsCurrent(this.doc, el) || this.stillFailed.get(el.id) === start) continue;
        this.refreshStill(el.id);
        return true;
      }
    };
    for (const page of this.doc.pages) if (walk(page.elements)) return;
  }

  async takeStill(id) {
    const found = locate(this.doc, id, this.pageData.id);
    if (found?.el.type !== 'video') return;
    const start = found.el.trim?.start || 0;
    const frames = new VideoFrames(this.doc);
    try {
      const url = await frames.seek(found.el, 0, 1920 / Math.max(found.el.w, found.el.h));
      if (!url) this.stillFailed?.set(id, start);
      if (!url || this.closed) return;
      const img = await loadImage(url);
      if (this.closed) return;
      const now = locate(this.doc, id, this.pageData.id)?.el;
      if (!now) return;
      if ((now.trim?.start || 0) !== start) return; // moved on meanwhile: retaken from where it starts now, once this is done
      // (The still it replaces stays while the design is open: undo can bring
      // it back. Saving leaves it out.)
      now.still = addAsset(this.doc, { dataUrl: url, mime: url.slice(5, url.indexOf(';')), width: img.naturalWidth, height: img.naturalHeight });
      now.stillAt = start; // (shown only while it still starts there: an undo can part them)
      this.afterChange(false, { edit: false });
    } catch {
      this.stillFailed?.set(id, start); // the poster stays (and it isn't tried again from there)
    } finally {
      frames.dispose();
    }
  }

  /** A video from Uploads, at its own shape, as big as fits nicely (or dropped `at` a point). */
  addVideo(upload, { at } = {}) {
    const assetId = addAsset(this.doc, { ...upload, kind: 'video' });
    // (A size it doesn't know: the usual 16:9.)
    const [vw, vh] = upload.width > 0 && upload.height > 0 ? [upload.width, upload.height] : [640, 360];
    const s = Math.min(1, (this.fitW * 0.7) / vw, (this.fitH * 0.7) / vh);
    const el = createVideo(assetId, { w: Math.round(vw * s), h: Math.round(vh * s) });
    if (at) {
      el.x = at.x - el.w / 2;
      el.y = at.y - el.h / 2;
    }
    this.insert(el, { center: !at }); // (its full-size still is taken once it's in: see retakeStills)
    return el;
  }

  /** Use a sound from Uploads as the design's soundtrack (null takes it away). */
  setSoundtrack(upload, volume = this.doc.audio?.volume ?? 1) {
    this.change(() => {
      if (!upload) delete this.doc.audio;
      else this.doc.audio = { assetId: addAsset(this.doc, { ...upload, kind: 'audio' }), volume };
    });
  }

  /** The soundtrack's volume (0 to 1). */
  setSoundtrackVolume(volume, key = null) {
    if (!this.doc.audio) return;
    this.change(() => (this.doc.audio = { ...this.doc.audio, volume }), { key });
  }

  /** A picture, video or sound from this device, kept in Uploads too. */
  async importMediaFile(file) {
    const kind = mediaKind(file);
    if (kind === 'image') return this.importImageFile(file);
    if (!kind) throw new Error(`${file.name} isn't a picture, video or sound`);
    checkSize(file, kind);
    // Checked first: a file that can't be used isn't read in whole for nothing.
    const info = await (kind === 'video' ? videoInfo(file) : audioInfo(file));
    // A "video" with no picture this browser can show: either a video it
    // can't play (an iPhone's HEVC, say) or music in a video file. There's no
    // telling which, so neither is guessed (a guess could replace the soundtrack).
    if (info.noPicture) throw new Error(`This browser can't show a picture in ${file.name}. A video plays here as MP4 (H.264) or WebM; a sound as MP3, M4A, OGG or WAV.`);
    const dataUrl = await readFileAsDataUrl(file);
    const upload = { id: uid('u'), name: file.name, mime: file.type, dataUrl, kind, ...info, addedAt: Date.now() };
    // It's used either way; Uploads just can't keep a copy when storage is full.
    await store.saveUpload(upload).catch(() => toast(`${file.name} couldn't be kept in Uploads: this browser's storage is full.`, 'error'));
    return upload;
  }

  /** Put an upload where it belongs: a picture or video on the page, a sound as the soundtrack. */
  async place(upload, opts) {
    if (upload.kind === 'video') return this.addVideo(upload, opts);
    if (upload.kind === 'audio') {
      this.setSoundtrack(upload);
      toast(`${upload.name} is the soundtrack now. It plays when you press Play, and in videos you download.`);
      return null;
    }
    return this.addImage(upload, opts);
  }

  async importImageFile(file) {
    if (!file.type.startsWith('image/')) throw new Error(`${file.name} isn't an image`);
    const dataUrl = await readFileAsDataUrl(file);
    const img = await loadImage(dataUrl);
    const upload = { id: uid('u'), name: file.name, mime: file.type, dataUrl, width: img.naturalWidth, height: img.naturalHeight, addedAt: Date.now() };
    await store.saveUpload(upload).catch(() => null);
    return upload;
  }

  /** Put a picture in an image or frame, keeping its place and shape: it's cropped to fill. */
  fillFrame(id, upload, pageId = this.pageData.id, { evenLocked = false } = {}) {
    // The frame's own page (it may not be in view any more: the page can change
    // while a photo is being picked), else wherever it is now.
    // Frames inside groups count too (a grouped photo grid).
    const found = locate(this.doc, id, pageId);
    const { page, el, top } = found || {};
    if (!el || el.type !== 'image' || (el.locked && !evenLocked)) return null;
    this.change(() => {
      el.assetId = addAsset(this.doc, upload);
      el.crop = null; // centred, cropped to fill the frame
      cmd.coverCrop(el, upload.width, upload.height);
    });
    // A frame in a group: the group is what's selected.
    if (page === this.pageData) this.select([top.id]);
    return el;
  }

  /**
   * The frame at a point on the page, if any: an empty one, or a photo in a
   * shape. Frames inside (unturned, unlocked) groups count too.
   */
  frameAt(p) {
    // The topmost thing at the point decides: a frame under a text box or a
    // plain photo isn't reached through it. (A frame's corners outside its
    // shape let the point through.)
    const BLOCKED = 0;
    const find = (els, ox, oy) => {
      for (let i = els.length - 1; i >= 0; i--) {
        const el = els[i];
        if (el.hidden) continue;
        // The point in this element's own (group) coordinates, so the element
        // itself is tested (and its cached outline reused).
        const q = { x: p.x - ox, y: p.y - oy };
        // Lines you draw or connect only cover what's near the line, as for clicks.
        if (isLine(el) ? !lineHit(el, q, this.zoom) : !pointInBox(q.x, q.y, el)) continue;
        if (el.type === 'group') {
          if (el.locked || el.rotation || el.flipX || el.flipY) return BLOCKED;
          const hit = find(el.children, ox + el.x, oy + el.y);
          if (hit !== null) return hit;
          continue; // a gap between the group's parts
        }
        // Any picture takes a dropped photo (a filled frame or photo is refilled).
        const frame = el.type === 'image';
        if (!frame) return BLOCKED;
        if (!inMask(el, q)) continue;
        return el.locked ? BLOCKED : el;
      }
      return null;
    };
    return find(this.pageData.elements, 0, 0) || null;
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
    this.emit('aids');
  }

  /** Lines to snap to besides elements: your guides, and the grid when snapping to it. */
  snapLines() {
    const x = [];
    const y = [];
    for (const g of this.pageData.guides || []) (g.axis === 'x' ? x : y).push(g.pos);
    const v = this.view;
    if (v.grid && v.snapGrid) {
      const g = gridLines(this.doc, v.gridSize);
      x.push(...g.x);
      y.push(...g.y);
    }
    if (v.margins) {
      const m = marginSize(this.doc);
      x.push(m, this.doc.width - m);
      y.push(m, this.doc.height - m);
    }
    return { x, y };
  }

  /** Move a guide while it's dragged (the drag records one undo step for the whole move). */
  moveGuide(i, pos) {
    const g = this.pageData.guides?.[i];
    if (!g) return;
    g.pos = Math.round(pos);
    this.emit('aids');
  }

  clearGuides() {
    if (!this.pageData.guides?.length) return;
    this.change(() => (this.pageData.guides = []));
  }

  // ---------- connectors ----------

  /** A free connector across the middle of the page. */
  addConnector(route = 'straight') {
    const { width: W, height: H } = this.doc;
    const s = Math.min(W, H);
    const el = createConnector({ from: [W / 2 - s * 0.2, H / 2], to: [W / 2 + s * 0.2, H / 2], route, strokeWidth: Math.max(2, Math.round(s * 0.006)) });
    this.change(() => cmd.addElement(this.doc, this.page, el));
    this.select([el.id]);
    return el;
  }

  /** Connect two selected elements with a line that follows them when they move. */
  connect(ids = this.selection, route = 'elbow') {
    const [a, b] = ids.map((id) => cmd.findElement(this.pageData, id)).filter((e) => e && e.type !== 'connector');
    if (!a || !b) return null;
    const s = this.sizeRef;
    const el = createConnector({ from: [a.x + a.w / 2, a.y + a.h / 2], to: [b.x + b.w / 2, b.y + b.h / 2], start: a.id, end: b.id, route, strokeWidth: Math.max(2, Math.round(s * 0.004)) });
    this.change(() => {
      // Just under the upper of the two: above the lower one (which may be a
      // big card or backdrop that would hide it), tucked under the other.
      const page = this.pageData;
      const at = Math.max(page.elements.indexOf(a), page.elements.indexOf(b));
      page.elements.splice(at, 0, el); // afterChange attaches its ends
    });
    this.select([el.id]);
    return el;
  }

  /** Re-attach connectors on every page, after a change that touched several pages. */
  syncAllConnectors() {
    for (const p of this.doc.pages) updateConnectors(p);
  }

  /**
   * Keep attached connector ends on their elements while drawing, including
   * mid-drag. Group boxes are refitted only when a change is finished.
   */
  syncConnectors() {
    return updateConnectors(this.pageData, { refit: false });
  }

  /**
   * Turn a freehand stroke (page points) into a drawing. `tool` is the pen
   * the stroke began with (drawing may have been turned off since).
   */
  addDrawing(points, tool = this.drawTool) {
    if (!tool || !points.length) return null;
    const el = createDrawing(thinPoints(points, 1.5 / this.zoom), { tool: tool.tool, stroke: tool.color, strokeWidth: tool.size });
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
    // Found again by id: the design may have changed (undo, a restore) while the photo was worked on.
    const now = locate(this.doc, el.id)?.el;
    if (!now || now.assetId !== el.assetId || this.closed) return 0;
    this.change(() => {
      now.assetId = addAsset(this.doc, { mime: 'image/png', dataUrl, width: canvas.width, height: canvas.height, name: `${asset.name || 'image'} (no background)` });
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
    // Returns whether anything inside changed, so groups around it are
    // refitted too (innermost first: each group's children are done first).
    const visit = (els) => {
      let here = false;
      for (const el of els) {
        if (el.type === 'text' && which(el)) {
          const before = [el.w, el.h];
          this.fitText(el);
          if (el.w !== before[0] || el.h !== before[1]) here = true;
        }
        if (el.type === 'group' && visit(el.children)) {
          refitGroup(el);
          here = true;
        }
      }
      changed ||= here;
      return here;
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
        if ((el.type === 'image' || el.type === 'video') && this.doc.assets[el.assetId]) out[el.assetId] = this.doc.assets[el.assetId];
        if (el.type === 'video' && this.doc.assets[el.still]) out[el.still] = this.doc.assets[el.still];
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

  /**
   * The selected ids that moving can affect: a connector held at both ends
   * goes wherever its elements go (moving it alone would snap straight back).
   */
  get movable() {
    return this.selection.filter((id) => {
      const el = cmd.findElement(this.pageData, id);
      return el && !(el.type === 'connector' && el.start?.id && el.end?.id);
    });
  }

  // Align and distribute work on what can move; flip mirrors the whole
  // selection (its bounds include held connectors, which then follow their
  // elements). A selection of nothing but held connectors is left alone.
  align(how) {
    // What can move, along the edges of the selection: locked elements count
    // (they stay), held connectors don't (they follow, so they'd shift the
    // edges with every press). To the page when that's one thing.
    const ids = this.movable;
    if (ids.length) this.change(() => cmd.alignElements(this.doc, this.page, ids, how));
  }

  distribute(axis) {
    const ids = this.movable;
    if (ids.length >= 3) this.change(() => cmd.distributeElements(this.doc, this.page, ids, axis));
  }

  flip(axis) {
    if (this.movable.length) this.change(() => cmd.flipElements(this.doc, this.page, this.selection, axis));
  }

  nudge(dx, dy) {
    const ids = this.movable;
    if (!ids.length) return;
    this.change(() => cmd.moveElements(this.doc, this.page, ids, dx, dy), { key: `nudge:${ids.join(',')}` });
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

  /** A page's title shows in the page strip and grid view; it isn't printed on the page. */
  setPageTitle(i, title) {
    const clean = String(title || '').trim().slice(0, 120);
    if ((this.doc.pages[i].title || '') === clean) return;
    // Titles aren't on the canvas: no redraw there, only the page strip's
    // (which batches them, rather than one per keystroke).
    this.change(() => (this.doc.pages[i].title = clean || undefined), { key: `title:${i}`, quiet: true });
    this.emit('strip');
  }

  /** A page's speaker notes (shown in the presenter view, never on the page). */
  setPageNotes(i, text, key = null) {
    const page = this.doc.pages[i];
    const next = text.trim() ? text.slice(0, 10000) : undefined;
    if (!page || (page.notes || undefined) === next) return;
    // Notes aren't on the page: nothing to redraw.
    this.change(() => {
      if (next) page.notes = next;
      else delete page.notes;
    }, { key, quiet: true });
  }

  /** Change a page's motion (anim, duration, transition); undefined clears one. */
  setPageMotion(i, patch, key = null) {
    const page = this.doc.pages[i];
    if (!page) return;
    this.change(() => {
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) delete page[k];
        else page[k] = v;
      }
    }, { key });
  }

  /** Hidden pages stay in the design but are skipped when presenting and downloading. */
  setPageHidden(i, hidden) {
    this.change(() => (this.doc.pages[i].hidden = hidden || undefined));
    this.emit('page');
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
        // New ids, so adding the same template twice never repeats an id.
        at = cmd.addPage(this.doc, at, cmd.freshPage(p));
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
  async resizeTo(width, height, name, preset = null) {
    // What the copy is: to Document or Whiteboard, one of those; a document to
    // a paper size stays a document (on that paper); to any other size, a
    // design of just that size. A custom size keeps the kind it was.
    const kind = preset?.id === 'doc' ? 'doc'
      : preset?.id === 'whiteboard' ? 'board'
      : preset ? (this.doc.document && preset.unit ? 'doc' : 'plain')
      : this.doc.document ? 'doc' : this.doc.board ? 'board' : 'plain';
    const copy = cmd.resizeDesign(this.doc, width, height, { asDocument: kind === 'doc' });
    delete copy.board;
    if (kind === 'board') copy.board = true;
    if (kind === 'doc') {
      // (Its margins in proportion to its width; its sheets at the paper's
      // resolution: print sizes 300 dpi, the Document size 150.)
      const k = width / DOCUMENT.width;
      copy.document ||= { pageHeight: height, margin: Math.round(DOCUMENT.margin * k), gap: Math.round(DOCUMENT.gap * k), dpi: DOCUMENT.dpi };
      if (preset) copy.document.dpi = preset.unit ? 300 : DOCUMENT.dpi;
    }
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
