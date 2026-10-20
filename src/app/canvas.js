// The canvas: draws the current page and handles selecting, moving,
// resizing, rotating, cropping and editing text directly on it.

import { renderPage } from '../model/render.js';
import {
  boundsOf, unionBounds, boxCorners, handlePosition, resizeBox, angleTo, snapAngle, snapMove,
  pointInBox, rectFromPoints, rectsIntersect, HANDLES,
} from '../model/geometry.js';
import { resizeElement, coverCrop } from '../model/commands.js';
import { clone, DRAW_TOOLS, DPI } from '../model/doc.js';
import { gridStep, marginSize, BLEED } from './editor.js';
import { endsOf, setEnds, connectorHit } from '../model/connectors.js';
import { measure } from './fonts.js';
import { h, dataUrlToBlob, toast, pickFile } from './ui.js';
import * as store from './store.js';

const PAD = 64;
const RATIO_LOCKED = new Set(['image', 'icon', 'sticker', 'qr', 'group']);

export class Canvas {
  constructor(editor) {
    this.ed = editor;
    this.urls = new Map();
    this.hover = null;
    this.drag = null;
    this.marquee = null;
    this.spaceDown = false;
    this.svgHost = h('div', { class: 'page-svg' });
    this.overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.overlay.setAttribute('class', 'overlay');
    // Rulers sit just outside the page's top and left edges and scroll with it.
    this.rulerX = h('div', { class: 'ruler x', 'data-testid': 'ruler-x', title: 'Drag down to add a guide' });
    this.rulerY = h('div', { class: 'ruler y', 'data-testid': 'ruler-y', title: 'Drag right to add a guide' });
    this.wrap = h('div', { class: 'page-wrap', 'data-testid': 'page' }, this.svgHost, this.overlay, this.rulerX, this.rulerY);
    this.board = h('div', { class: 'board' }, this.wrap);
    this.el = h('div', { class: 'stage', 'data-testid': 'stage', tabindex: '-1' }, this.board);
    this.textarea = null;
    this.frame = 0;

    this.el.addEventListener('pointerdown', (e) => this.onDown(e));
    this.el.addEventListener('pointermove', (e) => this.onMove(e));
    this.el.addEventListener('pointerup', (e) => this.onUp(e));
    this.el.addEventListener('pointercancel', (e) => this.onCancel(e));
    this.el.addEventListener('dblclick', (e) => this.onDouble(e));
    this.el.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    this.el.addEventListener('dragover', (e) => {
      e.preventDefault();
      this.el.classList.add('dropping');
    });
    this.el.addEventListener('dragleave', () => this.el.classList.remove('dropping'));
    this.el.addEventListener('drop', (e) => this.onDrop(e));
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !isTyping(e)) this.spaceDown = true;
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') this.spaceDown = false;
    });
    editor.on((what) => {
      if (what === 'live') return this.schedule();
      if (what === 'tool') return void this.el.classList.toggle('drawing', !!editor.drawTool);
      if (what === 'aids') return void this.drawOverlay();
      // Discrete changes draw right away; drags are batched per frame.
      if (this.frame) cancelAnimationFrame(this.frame);
      this.frame = 0;
      this.render();
    });
  }

  // ---------- drawing ----------

  schedule() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  assetHref = (assetId) => {
    const a = this.ed.doc.assets[assetId];
    if (!a) return '';
    let entry = this.urls.get(assetId);
    if (!entry || entry.dataUrl !== a.dataUrl) {
      entry = { dataUrl: a.dataUrl, url: URL.createObjectURL(dataUrlToBlob(a.dataUrl)) };
      this.urls.set(assetId, entry);
    }
    return entry.url;
  };

  layout() {
    const { doc, zoom } = this.ed;
    const w = doc.width * zoom;
    const hgt = doc.height * zoom;
    const vw = this.el.clientWidth;
    const vh = this.el.clientHeight;
    const bw = Math.max(vw, w + PAD * 2);
    const bh = Math.max(vh, hgt + PAD * 2);
    Object.assign(this.board.style, { width: `${bw}px`, height: `${bh}px` });
    Object.assign(this.wrap.style, { width: `${w}px`, height: `${hgt}px`, left: `${(bw - w) / 2}px`, top: `${(bh - hgt) / 2}px` });
  }

  render() {
    const ed = this.ed;
    ed.syncConnectors();
    this.layout();
    const skip = ed.editingTextId ? new Set([ed.editingTextId]) : null;
    this.svgHost.innerHTML = renderPage(ed.doc, ed.page, { measure, assetHref: this.assetHref, editor: true, scale: ed.zoom, skip, idPrefix: 'cv' });
    this.drawOverlay();
    if (this.textarea) this.positionTextarea();
  }

  zoomToFit() {
    const { doc } = this.ed;
    const vw = Math.max(200, this.el.clientWidth - PAD * 2);
    const vh = Math.max(200, this.el.clientHeight - PAD * 2);
    this.ed.setZoom(Math.min(vw / doc.width, vh / doc.height));
    requestAnimationFrame(() => {
      this.el.scrollLeft = (this.board.offsetWidth - this.el.clientWidth) / 2;
      this.el.scrollTop = (this.board.offsetHeight - this.el.clientHeight) / 2;
    });
  }

  zoomBy(factor, around) {
    const old = this.ed.zoom;
    const rect = this.el.getBoundingClientRect();
    const ax = around ? around.x - rect.left : this.el.clientWidth / 2;
    const ay = around ? around.y - rect.top : this.el.clientHeight / 2;
    const p = this.toPage({ clientX: rect.left + ax, clientY: rect.top + ay });
    this.ed.setZoom(old * factor);
    this.layout();
    const wr = this.wrap.getBoundingClientRect();
    const nx = wr.left + p.x * this.ed.zoom;
    const ny = wr.top + p.y * this.ed.zoom;
    this.el.scrollLeft += nx - (rect.left + ax);
    this.el.scrollTop += ny - (rect.top + ay);
  }

  drawOverlay() {
    const ed = this.ed;
    const z = ed.zoom;
    const parts = [];
    const poly = (b, cls) => {
      const pts = boxCorners(b).map((p) => `${p.x * z},${p.y * z}`).join(' ');
      parts.push(`<polygon class="${cls}" points="${pts}"/>`);
    };
    if (this.hover && !ed.selection.includes(this.hover)) {
      const el = ed.pageData.elements.find((e) => e.id === this.hover);
      if (el) poly(el, 'hover-box');
    }
    const sel = ed.selected;
    for (const el of sel) poly(el, el.locked ? 'sel-box locked' : 'sel-box');
    if (ed.cropId) {
      const el = sel.find((e) => e.id === ed.cropId);
      if (el) this.drawCrop(el, parts);
    } else if (sel.length === 1 && sel[0].type === 'connector' && !sel[0].locked) {
      // Connectors are reshaped by their two ends.
      endsOf(sel[0]).forEach(([x, y], i) => {
        const attached = !!(i ? sel[0].end : sel[0].start)?.id;
        parts.push(`<circle class="handle end${attached ? ' attached' : ''}" data-handle="end${i}" data-testid="connector-end-${i}" cx="${x * z}" cy="${y * z}" r="7"/>`);
      });
      if (this.drag?.mode === 'end' && this.drag.target) poly(this.drag.target, 'drop-target');
    } else if (sel.length === 1 && !sel[0].locked && !ed.editingTextId) {
      const el = sel[0];
      const top = handlePosition(el, 'n');
      const c = { x: el.x + el.w / 2, y: el.y + el.h / 2 };
      const len = 28 / z;
      const dx = top.x - c.x;
      const dy = top.y - c.y;
      const d = Math.hypot(dx, dy) || 1;
      const rot = { x: top.x + (dx / d) * len, y: top.y + (dy / d) * len };
      parts.push(`<line class="rot-stem" x1="${top.x * z}" y1="${top.y * z}" x2="${rot.x * z}" y2="${rot.y * z}"/>`);
      parts.push(`<circle class="handle rot" data-handle="rotate" cx="${rot.x * z}" cy="${rot.y * z}" r="7"/>`);
      const handles = el.type === 'text' ? ['nw', 'ne', 'se', 'sw', 'e', 'w'] : el.type === 'line' ? ['e', 'w'] : HANDLES;
      for (const hd of handles) {
        const p = handlePosition(el, hd);
        parts.push(`<rect class="handle${hd.length === 1 ? ' side' : ''}" data-handle="${hd}" x="${p.x * z - 6}" y="${p.y * z - 6}" width="12" height="12" rx="3" transform="rotate(${el.rotation || 0} ${p.x * z} ${p.y * z})"/>`);
      }
    } else if (sel.length > 1) {
      const b = unionBounds(sel);
      parts.push(`<rect class="group-box" x="${b.x * z}" y="${b.y * z}" width="${b.w * z}" height="${b.h * z}"/>`);
      for (const hd of ['nw', 'ne', 'se', 'sw']) {
        const p = handlePosition({ ...b, rotation: 0 }, hd);
        parts.push(`<rect class="handle" data-handle="${hd}" x="${p.x * z - 6}" y="${p.y * z - 6}" width="12" height="12" rx="3"/>`);
      }
    }
    this.drawViewAids(parts);
    for (const g of ed.guides) {
      if (g.axis === 'x') parts.push(`<line class="guide" x1="${g.pos * z}" y1="-10000" x2="${g.pos * z}" y2="10000"/>`);
      else parts.push(`<line class="guide" x1="-10000" y1="${g.pos * z}" x2="10000" y2="${g.pos * z}"/>`);
    }
    if (this.marquee) {
      const m = this.marquee;
      parts.push(`<rect class="marquee" x="${m.x * z}" y="${m.y * z}" width="${m.w * z}" height="${m.h * z}"/>`);
    }
    this.overlay.setAttribute('width', ed.doc.width * z);
    this.overlay.setAttribute('height', ed.doc.height * z);
    this.overlay.innerHTML = parts.join('');
  }

  drawCrop(el, parts) {
    const z = this.ed.zoom;
    const c = el.crop;
    const iw = el.w / c.w;
    const ih = el.h / c.h;
    const full = { x: el.x - c.x * iw, y: el.y - c.y * ih, w: iw, h: ih, rotation: 0 };
    parts.push(`<image class="crop-ghost" href="${this.assetHref(el.assetId)}" x="${full.x * z}" y="${full.y * z}" width="${full.w * z}" height="${full.h * z}" preserveAspectRatio="none"/>`);
    parts.push(`<rect class="crop-frame" x="${el.x * z}" y="${el.y * z}" width="${el.w * z}" height="${el.h * z}"/>`);
  }

  // ---------- coordinates and hit testing ----------

  toPage(e) {
    const r = this.wrap.getBoundingClientRect();
    return { x: (e.clientX - r.left) / this.ed.zoom, y: (e.clientY - r.top) / this.ed.zoom };
  }

  hitTest(p) {
    const els = this.ed.pageData.elements;
    const margin = 4 / this.ed.zoom;
    for (let i = els.length - 1; i >= 0; i--) {
      const el = els[i];
      if (el.hidden) continue;
      if (el.type === 'connector') {
        if (connectorHit(el, p, Math.max(el.strokeWidth / 2, 0) + Math.max(margin, 8 / this.ed.zoom))) return el;
        continue;
      }
      if (pointInBox(p.x, p.y, el, el.type === 'line' ? Math.max(margin, 10 / this.ed.zoom) : margin)) return el;
    }
    return null;
  }

  // ---------- pointer ----------

  onDown(e) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (this.textarea && e.target === this.textarea) return;
    const ed = this.ed;
    if (this.textarea) this.finishTextEdit();
    if (this.spaceDown || e.button === 1) {
      this.drag = { mode: 'pan', sx: e.clientX, sy: e.clientY, left: this.el.scrollLeft, top: this.el.scrollTop };
      this.el.setPointerCapture(e.pointerId);
      return;
    }
    const p = this.toPage(e);
    const ruler = e.target.closest?.('.ruler');
    if (ruler) {
      // Pull a new guide out of a ruler.
      e.preventDefault();
      const axis = ruler === this.rulerX ? 'y' : 'x';
      // One undo step for the whole drag, taken now; dropped again if the guide doesn't stay.
      ed.history.record(ed.doc);
      ed.pageData.guides = [...(ed.pageData.guides || []), { axis, pos: Math.round(axis === 'x' ? p.x : p.y) }];
      this.drag = { mode: 'guide', index: ed.pageData.guides.length - 1, axis, isNew: true, moved: false };
      this.el.setPointerCapture(e.pointerId);
      return;
    }
    const guide = e.target.closest?.('[data-guide]');
    if (guide && !ed.drawTool) {
      e.preventDefault();
      const index = +guide.getAttribute('data-guide');
      ed.history.record(ed.doc);
      this.drag = { mode: 'guide', index, axis: ed.pageData.guides[index].axis, moved: false, orig: ed.pageData.guides[index].pos };
      this.el.setPointerCapture(e.pointerId);
      return;
    }
    if (ed.drawTool) {
      // Drawing: every press on the page starts a new stroke.
      e.preventDefault();
      ed.deselect();
      this.drag = { mode: 'draw', points: [[p.x, p.y]] };
      this.el.setPointerCapture(e.pointerId);
      this.drawStroke();
      return;
    }
    const handle = e.target.closest?.('[data-handle]')?.getAttribute('data-handle');
    if (handle) {
      e.preventDefault();
      this.startTransform(handle, p, e);
      return;
    }
    if (ed.cropId) {
      const el = ed.single;
      if (el && el.id === ed.cropId && pointInBox(p.x, p.y, el)) {
        ed.history.record(ed.doc);
        this.drag = { mode: 'crop', start: p, crop: { ...el.crop }, el, moved: false };
        this.el.setPointerCapture(e.pointerId);
        return;
      }
      ed.cropId = null;
    }
    const hit = this.hitTest(p);
    if (hit) {
      if (e.shiftKey) {
        ed.select([hit.id], { add: true });
        return;
      }
      if (!ed.selection.includes(hit.id)) ed.select([hit.id]);
      const movable = ed.selected.filter((el) => !el.locked);
      if (!movable.length) return;
      ed.history.record(ed.doc);
      this.drag = { mode: 'move', start: p, items: movable.map((el) => ({ el, x: el.x, y: el.y })), moved: false };
      this.el.setPointerCapture(e.pointerId);
    } else {
      if (!e.shiftKey) ed.deselect();
      this.drag = { mode: 'marquee', start: p, base: e.shiftKey ? [...ed.selection] : [] };
      this.el.setPointerCapture(e.pointerId);
    }
  }

  startTransform(handle, p, e) {
    const ed = this.ed;
    const sel = ed.selected.filter((el) => !el.locked);
    if (!sel.length) return;
    ed.history.record(ed.doc);
    if (handle === 'end0' || handle === 'end1') {
      this.drag = { mode: 'end', el: sel[0], which: +handle.slice(3), moved: false, target: null };
    } else if (handle === 'rotate') {
      this.drag = { mode: 'rotate', el: sel[0], moved: false };
    } else if (sel.length === 1) {
      this.drag = { mode: 'resize', handle, start: p, el: sel[0], orig: clone(sel[0]), moved: false };
    } else {
      this.drag = { mode: 'resize-many', handle, start: p, box: unionBounds(sel), items: sel.map((el) => ({ el, orig: clone(el) })), moved: false };
    }
    this.el.setPointerCapture(e.pointerId);
  }

  onMove(e) {
    const ed = this.ed;
    const d = this.drag;
    const p = this.toPage(e);
    if (!d) {
      const hit = e.pointerType === 'mouse' ? this.hitTest(p) : null;
      const id = hit ? hit.id : null;
      if (id !== this.hover) {
        this.hover = id;
        this.drawOverlay();
      }
      return;
    }
    if (d.mode === 'guide') {
      d.moved = true;
      ed.moveGuide(d.index, d.axis === 'x' ? p.x : p.y, true);
      return;
    }
    if (d.mode === 'end') {
      // Move one end; let go over an element to attach it there.
      d.moved = true;
      const ends = endsOf(d.el);
      ends[d.which] = [p.x, p.y];
      d.el[d.which ? 'end' : 'start'] = { id: null };
      setEnds(d.el, ends[0], ends[1]);
      d.target = this.attachTarget(p, d.el);
      ed.emit('live');
      return;
    }
    if (d.mode === 'draw') {
      for (const ev of e.getCoalescedEvents?.() || [e]) {
        const q = this.toPage(ev);
        d.points.push([q.x, q.y]);
      }
      this.drawStroke();
      return;
    }
    if (d.mode === 'pan') {
      this.el.scrollLeft = d.left - (e.clientX - d.sx);
      this.el.scrollTop = d.top - (e.clientY - d.sy);
      return;
    }
    if (d.mode === 'marquee') {
      this.marquee = rectFromPoints(d.start, p);
      const hits = ed.pageData.elements.filter((el) => !el.hidden && rectsIntersect(boundsOf(el), this.marquee)).map((el) => el.id);
      ed.selection = [...new Set([...d.base, ...hits])];
      ed.emit('selection');
      return;
    }
    let dx = p.x - d.start?.x;
    let dy = p.y - d.start?.y;
    if (d.mode === 'move') {
      if (!d.moved && Math.hypot(dx, dy) * ed.zoom < 3) return;
      d.moved = true;
      const moving = unionBounds(d.items.map(({ el, x, y }) => ({ ...el, x: x + dx, y: y + dy })));
      ed.guides = [];
      if (!e.altKey) {
        const others = ed.pageData.elements.filter((el) => !el.hidden && !ed.selection.includes(el.id));
        const snap = snapMove(moving, others, { w: ed.doc.width, h: ed.doc.height }, 6 / ed.zoom, ed.snapLines());
        dx += snap.dx;
        dy += snap.dy;
        ed.guides = snap.guides;
      }
      for (const it of d.items) {
        it.el.x = it.x + dx;
        it.el.y = it.y + dy;
      }
    } else if (d.mode === 'resize') {
      d.moved = true;
      const el = d.el;
      const o = d.orig;
      const corner = d.handle.length === 2;
      const keepRatio = corner && (RATIO_LOCKED.has(o.type) || o.type === 'text' ? !e.shiftKey : e.shiftKey);
      const box = resizeBox(o, d.handle, dx, dy, { keepRatio, minSize: 4 });
      Object.assign(el, clone(o));
      if (o.type === 'text') {
        if (corner) {
          resizeElement(el, box, { scaleContent: true });
        } else {
          resizeElement(el, { ...box, h: o.h });
        }
        ed.fitText(el);
      } else if (o.type === 'line') {
        resizeElement(el, { ...box, h: o.h, y: box.y + (box.h - o.h) / 2 });
      } else {
        resizeElement(el, box, { scaleContent: o.type === 'group' || o.type === 'qr' });
        const asset = o.type === 'image' && !keepRatio ? ed.doc.assets[o.assetId] : null;
        if (asset) coverCrop(el, asset.width, asset.height);
      }
    } else if (d.mode === 'resize-many') {
      d.moved = true;
      const nb = resizeBox({ ...d.box, rotation: 0 }, d.handle, dx, dy, { keepRatio: true, minSize: 4 });
      const s = nb.w / d.box.w;
      for (const it of d.items) {
        Object.assign(it.el, clone(it.orig));
        resizeElement(it.el, {
          x: nb.x + (it.orig.x - d.box.x) * s,
          y: nb.y + (it.orig.y - d.box.y) * s,
          w: it.orig.w * s,
          h: it.orig.h * s,
        }, { scaleContent: true });
      }
    } else if (d.mode === 'rotate') {
      d.moved = true;
      let a = angleTo(d.el, p.x, p.y);
      if (e.shiftKey) a = snapAngle(a, 15);
      else for (const t of [0, 90, 180, 270, 360]) if (Math.abs(a - t) < 3) a = t % 360;
      d.el.rotation = a;
    } else if (d.mode === 'crop') {
      d.moved = true;
      const el = d.el;
      const iw = el.w / d.crop.w;
      const ih = el.h / d.crop.h;
      el.crop = {
        ...d.crop,
        x: Math.max(0, Math.min(1 - d.crop.w, d.crop.x - dx / iw)),
        y: Math.max(0, Math.min(1 - d.crop.h, d.crop.y - dy / ih)),
      };
    }
    this.schedule();
    ed.emit('live');
  }

  /** The browser took the pointer away (palm rejection, a system gesture): throw away strokes and guide drags. */
  onCancel(e) {
    const d = this.drag;
    if (d?.mode === 'draw') {
      this.drag = null;
      this.stroke?.remove();
      this.stroke = null;
      return;
    }
    if (d?.mode === 'guide') {
      this.drag = null;
      const ed = this.ed;
      if (d.isNew) ed.pageData.guides.splice(d.index, 1);
      else if (d.orig !== undefined) ed.pageData.guides[d.index].pos = d.orig;
      ed.history.discard();
      ed.emit('aids');
      return;
    }
    this.onUp(e);
  }

  onUp() {
    const ed = this.ed;
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    if (d.mode === 'marquee') {
      this.marquee = null;
      this.drawOverlay();
      return;
    }
    if (d.mode === 'pan') return;
    if (d.mode === 'end') {
      if (d.target) d.el[d.which ? 'end' : 'start'] = { id: d.target.id };
      if (d.moved) ed.afterChange();
      else ed.history.discard();
      return;
    }
    if (d.mode === 'guide') {
      // A guide dragged off the page is removed. A new guide that never made
      // it onto the page, or a guide that wasn't moved, leaves no undo step.
      const g = ed.pageData.guides[d.index];
      const size = d.axis === 'x' ? ed.doc.width : ed.doc.height;
      const off = !g || g.pos < 0 || g.pos > size;
      if (off) ed.pageData.guides.splice(d.index, 1);
      if ((d.isNew && off) || !d.moved) {
        ed.history.discard();
        ed.emit('aids');
      } else ed.afterChange();
      return;
    }
    if (d.mode === 'draw') {
      this.stroke?.remove();
      this.stroke = null;
      ed.addDrawing(d.points);
      return;
    }
    ed.guides = [];
    if (d.moved) ed.afterChange();
    else {
      ed.history.discard();
      this.drawOverlay();
    }
  }

  onDouble(e) {
    const p = this.toPage(e);
    const hit = this.hitTest(p);
    if (!hit || hit.locked) return;
    if (hit.type === 'text') this.startTextEdit(hit);
    else if (hit.type === 'image' && !hit.assetId) this.pickPhotoFor(hit);
    else if (hit.type === 'image') this.startCrop(hit);
  }

  onWheel(e) {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      this.zoomBy(Math.exp(-e.deltaY * 0.0025), { x: e.clientX, y: e.clientY });
    }
  }

  async onDrop(e) {
    e.preventDefault();
    this.el.classList.remove('dropping');
    let at = this.toPage(e);
    // A picture dropped on a frame goes into the frame; anywhere else (and
    // every picture after the first, when several are dropped) it's added.
    let filled = false;
    const place = async (upload) => {
      const frame = filled ? null : this.ed.frameAt(at);
      if (frame) {
        this.ed.fillFrame(frame.id, upload);
        filled = true;
      } else await this.ed.addImage(upload, { at });
    };
    const uploadId = e.dataTransfer?.getData('application/x-paperwall-upload');
    if (uploadId) {
      const upload = await store.getUpload(uploadId);
      if (upload) await place(upload);
      return;
    }
    const files = [...(e.dataTransfer?.files || [])].filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    for (const file of files) {
      try {
        const upload = await this.ed.importImageFile(file);
        await place(upload);
        at = { x: at.x + 30, y: at.y + 30 };
      } catch (err) {
        toast(err.message, 'error');
      }
    }
  }

  // ---------- text editing ----------

  startTextEdit(el) {
    const ed = this.ed;
    ed.select([el.id]);
    ed.history.record(ed.doc);
    ed.editingTextId = el.id;
    this.textBefore = el.text;
    const ta = h('textarea', { class: 'text-editor', 'data-testid': 'text-editor', spellcheck: 'true', 'aria-label': 'Edit text' });
    ta.value = el.text;
    ta.addEventListener('input', () => {
      el.text = ta.value;
      ed.fitText(el);
      this.positionTextarea();
      ed.emit('live');
    });
    ta.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape' || ((e.metaKey || e.ctrlKey) && e.key === 'Enter')) {
        e.preventDefault();
        this.finishTextEdit();
      }
    });
    ta.addEventListener('blur', () => this.finishTextEdit());
    this.textarea = ta;
    this.wrap.append(ta);
    this.render();
    ta.focus();
    ta.select();
  }

  positionTextarea() {
    const ed = this.ed;
    const el = ed.pageData.elements.find((x) => x.id === ed.editingTextId);
    if (!el || !this.textarea) return;
    const z = ed.zoom;
    const pad = el.highlight ? (el.highlight.padding ?? 0) : 0;
    Object.assign(this.textarea.style, {
      left: `${el.x * z}px`,
      top: `${el.y * z}px`,
      width: `${el.w * z}px`,
      height: `${el.h * z}px`,
      font: `${el.italic ? 'italic ' : ''}${el.weight || 400} ${el.size * z}px "${el.font}", sans-serif`,
      lineHeight: String(el.lineHeight || 1.2),
      letterSpacing: `${(el.letterSpacing || 0) * z}px`,
      color: el.color,
      textAlign: el.align,
      textTransform: el.caps ? 'uppercase' : 'none',
      paddingTop: `${pad * z}px`,
      transform: `rotate(${el.rotation || 0}deg)${el.flipX ? ' scaleX(-1)' : ''}${el.flipY ? ' scaleY(-1)' : ''}`,
    });
  }

  finishTextEdit() {
    const ed = this.ed;
    const ta = this.textarea;
    if (!ta) return;
    this.textarea = null;
    ta.remove();
    const id = ed.editingTextId;
    ed.editingTextId = null;
    const el = ed.pageData.elements.find((x) => x.id === id);
    if (el && !el.text.trim()) {
      ed.pageData.elements = ed.pageData.elements.filter((x) => x.id !== id);
      ed.selection = [];
      ed.afterChange();
    } else if (el && el.text === this.textBefore) {
      ed.history.discard();
      this.render();
    } else {
      ed.afterChange();
    }
    this.el.focus({ preventScroll: true });
  }

  /** Grid, margins, bleed and your guides, plus the rulers. None of it is exported. */
  drawViewAids(parts) {
    const ed = this.ed;
    const v = ed.view;
    const z = ed.zoom;
    const W = ed.doc.width;
    const H = ed.doc.height;
    if (v.grid) {
      const step = gridStep(ed.doc, v.gridSize);
      const d = [];
      for (let x = step; x < W; x += step) d.push(`M${x * z} 0V${H * z}`);
      for (let y = step; y < H; y += step) d.push(`M0 ${y * z}H${W * z}`);
      parts.push(`<path class="grid-lines" data-testid="grid-lines" d="${d.join('')}"/>`);
    }
    if (v.margins) {
      const m = marginSize(ed.doc) * z;
      parts.push(`<rect class="margin-box" data-testid="margin-box" x="${m}" y="${m}" width="${W * z - m * 2}" height="${H * z - m * 2}"/>`);
    }
    if (v.bleed) {
      const b = BLEED * z;
      parts.push(`<path class="bleed-zone" data-testid="bleed-zone" fill-rule="evenodd" d="M0 0H${W * z}V${H * z}H0Z M${b} ${b}V${H * z - b}H${W * z - b}V${b}Z"/>`);
      parts.push(`<rect class="bleed-line" x="${b}" y="${b}" width="${W * z - b * 2}" height="${H * z - b * 2}"/>`);
    }
    (ed.pageData.guides || []).forEach((g, i) => {
      const line = g.axis === 'x' ? `x1="${g.pos * z}" y1="0" x2="${g.pos * z}" y2="${H * z}"` : `x1="0" y1="${g.pos * z}" x2="${W * z}" y2="${g.pos * z}"`;
      parts.push(`<g class="user-guide ${g.axis}" data-guide="${i}" data-testid="guide"><line class="hit" ${line}/><line ${line}/></g>`);
    });
    this.drawRulers();
  }

  drawRulers() {
    const ed = this.ed;
    const on = ed.view.rulers;
    this.rulerX.hidden = this.rulerY.hidden = !on;
    if (!on) return;
    const z = ed.zoom;
    const { width: W, height: H } = ed.doc;
    const unit = ed.doc.unit || 'px';
    // Only redraw when something the rulers show has changed.
    const key = `${z}|${W}|${H}|${unit}`;
    if (key === this.rulerKey) return;
    this.rulerKey = key;
    // Ticks in the design's own unit, on a step that stays readable: 1, 2 or 5 × a power of ten.
    const perUnit = unit === 'mm' ? DPI / 25.4 : unit === 'in' ? DPI : 1;
    const raw = 60 / (z * perUnit);
    const pow = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 5, 10].map((k) => k * pow).find((s) => s >= raw);
    const digits = step < 1 ? 1 : 0;
    const ticks = (lenPx, vertical) => {
      const out = [];
      const len = lenPx / perUnit;
      for (let k = 0; k * (step / 5) <= len + 1e-9; k++) {
        const v = k * (step / 5);
        const major = k % 5 === 0;
        const p = v * perUnit * z;
        out.push(vertical ? `<line x1="${major ? 0 : 14}" y1="${p}" x2="20" y2="${p}"/>` : `<line x1="${p}" y1="${major ? 0 : 14}" x2="${p}" y2="20"/>`);
        if (major) {
          const label = v.toFixed(digits);
          out.push(vertical ? `<text x="2" y="${p + 10}">${label}</text>` : `<text x="${p + 3}" y="10">${label}</text>`);
        }
      }
      return out.join('');
    };
    this.rulerX.innerHTML = `<svg width="${W * z}" height="20">${ticks(W, false)}</svg>`;
    this.rulerY.innerHTML = `<svg width="20" height="${H * z}">${ticks(H, true)}</svg>`;
  }

  /** The element a connector end would attach to at p (not connectors, not itself). */
  attachTarget(p, connector) {
    const els = this.ed.pageData.elements;
    for (let i = els.length - 1; i >= 0; i--) {
      const el = els[i];
      if (el.hidden || el.type === 'connector' || el === connector) continue;
      if (pointInBox(p.x, p.y, el)) return el;
    }
    return null;
  }

  /** Show the stroke being drawn, on top of the page. */
  drawStroke() {
    const t = this.ed.drawTool;
    const d = this.drag;
    if (!t || !d) return;
    const z = this.ed.zoom;
    if (!this.stroke?.isConnected) {
      this.stroke = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      this.stroke.setAttribute('class', 'live-stroke');
      this.overlay.append(this.stroke);
    }
    Object.entries({ points: d.points.map(([x, y]) => `${x * z},${y * z}`).join(' '), fill: 'none', stroke: t.color, 'stroke-width': t.size * z, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: DRAW_TOOLS[t.tool].opacity })
      .forEach(([k, v]) => this.stroke.setAttribute(k, v));
  }

  /** Choose a photo from the device for an empty frame. */
  async pickPhotoFor(frame) {
    const [file] = await pickFile('image/*');
    if (!file) return;
    try {
      this.ed.fillFrame(frame.id, await this.ed.importImageFile(file));
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // ---------- cropping ----------

  startCrop(el) {
    this.ed.select([el.id]);
    this.ed.cropId = el.id;
    this.ed.emit('selection');
  }

  /** Zoom the picture inside its frame (1 = as much of it as fits). */
  setCropZoom(el, zoom) {
    const asset = this.ed.doc.assets[el.assetId];
    if (asset) coverCrop(el, asset.width, asset.height, zoom);
  }
}

function isTyping(e) {
  const t = e.target;
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}
