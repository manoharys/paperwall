// The canvas: draws the current page and handles selecting, moving,
// resizing, rotating, cropping and editing text directly on it.

import { renderPage } from '../model/render.js';
import {
  boundsOf, unionBounds, boxCorners, handlePosition, resizeBox, angleTo, snapAngle, snapMove,
  pointInBox, rectFromPoints, rectsIntersect, HANDLES,
} from '../model/geometry.js';
import { resizeElement, coverCrop, topmost, findElement } from '../model/commands.js';
import { clone, DRAW_TOOLS, pxPerUnit, isEmptyFrame, restroke } from '../model/doc.js';
import { gridLines, marginSize, bleedSize } from '../model/view.js';
import { endsOf, setEnds, isLine, lineHit } from '../model/connectors.js';
import { measure } from './fonts.js';
import { mediaKind } from './media.js';
import { h, dataUrlToBlob, toast, pickFile } from './ui.js';
import * as store from './store.js';

const PAD = 64;
const RATIO_LOCKED = new Set(['image', 'video', 'icon', 'sticker', 'qr', 'group']);


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
    // Whatever waited for a drag to end runs once it has.
    const settle = () => {
      if (!this.drag) editor.dragEnded();
    };
    this.el.addEventListener('pointerup', (e) => {
      this.onUp(e);
      settle();
    });
    this.el.addEventListener('pointercancel', (e) => {
      this.onCancel(e);
      settle();
    });
    // Capture lost without a pointerup (the browser or a system gesture): the
    // drag is over, or every later touch would be taken for a second finger.
    this.el.addEventListener('lostpointercapture', (e) => {
      if (this.drag && e.pointerId === this.drag.pointerId) this.onCancel(e);
      settle();
    });
    // Undo and redo wait while a drag is going (it holds parts of the design).
    editor.isDragging = () => !!this.drag;
    // A change arrives mid-drag (see Editor.change). Drags that hold no part of
    // the design (marquee, pan, a stroke not yet added) just carry on. One that
    // has moved things is finished first. One that hasn't moved yet hands back
    // its undo step and takes a fresh one, from the changed design, afterwards.
    editor.pauseDrag = () => {
      const d = this.drag;
      if (!d?.recorded) return null;
      if (d.moved) {
        this.onUp();
        settle();
        return null;
      }
      // A guide just pulled out of a ruler isn't part of the design yet: it
      // steps aside while the change is recorded, and comes back after.
      const pulled = d.mode === 'guide' && d.isNew ? editor.pageData.guides.splice(d.index, 1)[0] : null;
      editor.history.discard();
      return () => {
        if (this.drag !== d) return;
        editor.history.record(editor.doc);
        if (pulled) {
          editor.pageData.guides = [...(editor.pageData.guides || []), pulled];
          d.index = editor.pageData.guides.length - 1;
        }
        // The guide being dragged went with that change (Clear guides): the drag is over.
        if (d.mode === 'guide' && !editor.pageData.guides?.[d.index]) {
          editor.history.discard();
          this.drag = null;
          settle();
          return;
        }
        restart(d);
      };
    };
    // Start values a drag works from, read again from the elements as they are now.
    const restart = (d) => {
      for (const it of d.items || []) {
        if ('x' in it) Object.assign(it, { x: it.el.x, y: it.el.y });
        if (it.shape) it.shape = { w: it.el.w, h: it.el.h, points: clone(it.el.points) };
        if (it.orig) it.orig = clone(it.el);
      }
      if (d.mode === 'resize') d.orig = clone(d.el);
      if (d.mode === 'resize-many') d.box = unionBounds(d.items.map((it) => it.el));
      if (d.mode === 'crop') d.crop = { ...d.el.crop };
      if (d.mode === 'guide' && !d.isNew) d.orig = editor.pageData.guides?.[d.index]?.pos;
    };
    // Something needs the drag over now (leaving the design, another page):
    // it ends as if let go.
    editor.endDrag = () => {
      if (this.drag) this.onUp();
      settle();
    };
    // The design was replaced under a drag that hadn't moved: drop it quietly.
    editor.abandonDrag = () => {
      this.drag = null;
      editor.guides = [];
      settle();
    };
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
      // Mid-drag: attached connector ends follow what's being moved (group
      // boxes are refitted once the drag ends, in afterChange).
      if (what === 'live') {
        this.liveSync = true; // once per drawn frame, not per pointer event
        return this.schedule();
      }
      if (what === 'tool') return void this.el.classList.toggle('drawing', !!editor.drawTool);
      if (what === 'aids') {
        this.drawRulers(); // switching rulers on or off shows at once (cheap: cached)
        return void this.scheduleOverlay();
      }
      if (what === 'strip' || what === 'stop-drawing') return; // nothing on the canvas changed
      // Discrete changes draw right away; drags are batched per frame.
      if (this.frame) cancelAnimationFrame(this.frame);
      this.frame = 0;
      this.render();
    });
  }

  // ---------- drawing ----------

  /** Redraw just the overlay (guides, grid) once this frame. */
  scheduleOverlay() {
    if (this.overlayFrame) return;
    this.overlayFrame = requestAnimationFrame(() => {
      this.overlayFrame = 0;
      this.drawOverlay();
    });
  }

  schedule() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      if (this.liveSync) this.ed.syncConnectors();
      this.liveSync = false;
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
    this.layout();
    const skip = ed.editingTextId ? new Set([ed.editingTextId]) : null;
    this.svgHost.innerHTML = renderPage(ed.doc, ed.page, { measure, assetHref: this.assetHref, editor: true, scale: ed.zoom, skip, idPrefix: 'cv' });
    this.drawOverlay();
    if (this.textarea) this.positionTextarea();
    // The page changed size (a restored version, resizing, undoing either): fit it in view again.
    const size = `${ed.doc.width}x${ed.doc.height}`;
    const resized = this.pageSize && this.pageSize !== size;
    this.pageSize = size;
    if (resized) this.zoomToFit();
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
    // Grid, margins and guides go underneath, so selection handles stay on top.
    this.drawViewAids(parts);
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
    const margin = 4 / this.ed.zoom;
    return topmost(this.ed.pageData, (el) => {
      if (el.hidden) return false;
      // Lines you draw or connect are picked near the line, not anywhere in their box.
      if (isLine(el)) return lineHit(el, p, this.ed.zoom);
      return pointInBox(p.x, p.y, el, el.type === 'line' ? Math.max(margin, 10 / this.ed.zoom) : margin);
    });
  }


  // ---------- pointer ----------

  onDown(e) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (this.textarea && e.target === this.textarea) return;
    const ed = this.ed;
    // A second finger or a palm while any drag is going is ignored (even on a ruler).
    if (this.drag && e.pointerId !== this.drag.pointerId) return void e.preventDefault();
    if (this.textarea) this.finishTextEdit();
    if (this.spaceDown || e.button === 1) {
      this.drag = { mode: 'pan', sx: e.clientX, sy: e.clientY, left: this.el.scrollLeft, top: this.el.scrollTop };
      this.capture(e);
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
      this.drag = { recorded: true, mode: 'guide', index: ed.pageData.guides.length - 1, axis, isNew: true, moved: false };
      this.capture(e);
      return;
    }
    if (ed.drawTool) {
      // Drawing: every press on the page starts a new stroke (not one beside
      // it, which wouldn't show in downloads, nor a scrollbar).
      e.preventDefault();
      if (p.x < 0 || p.y < 0 || p.x > ed.doc.width || p.y > ed.doc.height) return;
      ed.deselect();
      this.drag = { mode: 'draw', points: [[p.x, p.y]], tool: { ...ed.drawTool } };
      this.capture(e);
      this.drawStroke();
      return;
    }
    const handle = e.target.closest?.('[data-handle]')?.getAttribute('data-handle');
    if (handle) {
      e.preventDefault();
      this.startTransform(handle, p, e);
      return;
    }
    let guide = e.target.closest?.('[data-guide]');
    if (guide) {
      // Next to an element lined up on the guide, the element wins unless the
      // press is right on the line.
      const g = ed.pageData.guides?.[+guide.getAttribute('data-guide')];
      // The overlay can be a frame behind (a guide just went away).
      if (!g) guide = null;
      else {
        const off = Math.abs((g.axis === 'x' ? p.x : p.y) - g.pos) * ed.zoom;
        const hit = off > 1.5 ? this.hitTest(p) : null;
        if (hit) {
          // Only an element with an edge or middle on the guide (one snapped to it).
          const b = boundsOf(hit);
          const [lo, size] = g.axis === 'x' ? [b.x, b.w] : [b.y, b.h];
          if ([lo, lo + size / 2, lo + size].some((v) => Math.abs(v - g.pos) < 1)) guide = null;
        }
      }
    }
    if (guide) {
      e.preventDefault();
      const index = +guide.getAttribute('data-guide');
      ed.history.record(ed.doc);
      this.drag = { recorded: true, mode: 'guide', index, axis: ed.pageData.guides[index].axis, moved: false, orig: ed.pageData.guides[index].pos };
      this.capture(e);
      return;
    }
    if (ed.cropId) {
      const el = ed.single;
      if (el && el.id === ed.cropId && pointInBox(p.x, p.y, el)) {
        ed.history.record(ed.doc);
        this.drag = { recorded: true, mode: 'crop', start: p, crop: { ...el.crop }, el, moved: false };
        this.capture(e);
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
      const movable = ed.movable.map((id) => findElement(ed.pageData, id)).filter((el) => !el.locked);
      if (!movable.length) return;
      ed.history.record(ed.doc);
      // A connector's box changes as its attached ends follow: keep its shape
      // at the start, so each frame moves it from there (not from the last frame).
      this.drag = { recorded: true, mode: 'move', start: p, items: movable.map((el) => ({ el, x: el.x, y: el.y, shape: el.type === 'connector' ? { w: el.w, h: el.h, points: clone(el.points) } : null })), moved: false };
      this.capture(e);
    } else {
      if (!e.shiftKey) ed.deselect();
      this.drag = { mode: 'marquee', start: p, base: e.shiftKey ? [...ed.selection] : [] };
      this.capture(e);
    }
  }

  startTransform(handle, p, e) {
    const ed = this.ed;
    const sel = ed.selected.filter((el) => !el.locked);
    if (!sel.length) return;
    ed.history.record(ed.doc);
    if (handle === 'end0' || handle === 'end1') {
      const el = sel[0];
      this.drag = { recorded: true, mode: 'end', el, which: +handle.slice(3), start: p, moved: false, target: null };
    } else if (handle === 'rotate') {
      this.drag = { recorded: true, mode: 'rotate', el: sel[0], moved: false };
    } else if (sel.length === 1) {
      this.drag = { recorded: true, mode: 'resize', handle, start: p, el: sel[0], orig: clone(sel[0]), moved: false };
    } else {
      this.drag = { recorded: true, mode: 'resize-many', handle, start: p, box: unionBounds(sel), items: sel.map((el) => ({ el, orig: clone(el) })), moved: false };
    }
    this.capture(e);
  }

  /** The pointer that started a drag is the one that moves and ends it. */
  capture(e) {
    this.drag.pointerId = e.pointerId;
    try {
      this.el.setPointerCapture(e.pointerId);
    } catch {
      // The pointer is already gone, so nothing will end this drag: drop it now.
      const d = this.drag;
      this.drag = null;
      if (d.recorded) this.ed.revertPending(); // e.g. a guide already pulled out
      this.ed.dragEnded();
    }
  }

  onMove(e) {
    const ed = this.ed;
    const d = this.drag;
    if (d && e.pointerId !== d.pointerId) return; // another finger
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
      ed.moveGuide(d.index, d.axis === 'x' ? p.x : p.y);
      return;
    }
    if (d.mode === 'end') {
      // Move one end; let go over an element to attach it there. A press that
      // barely moves (a click on the handle) leaves it attached.
      if (!d.moved && Math.hypot(p.x - d.start.x, p.y - d.start.y) * ed.zoom < 3) return;
      d.moved = true;
      const ends = endsOf(d.el);
      ends[d.which] = [p.x, p.y];
      const key = d.which ? 'end' : 'start';
      d.el[key] = { id: null, side: d.el[key]?.side }; // loose ends keep the side they left from
      setEnds(d.el, ends[0], ends[1]);
      d.target = this.attachTarget(p, d.el, d.which);
      ed.emit('live');
      return;
    }
    if (d.mode === 'draw') {
      const coalesced = e.getCoalescedEvents?.(); // can be empty (synthetic events)
      for (const ev of coalesced?.length ? coalesced : [e]) {
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
      // Connectors stretch as their far ends stay put, so the box that snaps is
      // the rest of the selection (unless it's only connectors).
      const solid = d.items.filter(({ el }) => el.type !== 'connector');
      const moving = unionBounds((solid.length ? solid : d.items).map(({ el, x, y }) => ({ ...el, x: x + dx, y: y + dy })));
      ed.guides = [];
      if (!e.altKey) {
        // Connectors follow what's being moved, so they aren't something to snap to.
        const others = ed.pageData.elements.filter((el) => !el.hidden && el.type !== 'connector' && !ed.selection.includes(el.id));
        d.lines ??= ed.snapLines(); // the same for the whole drag
        const snap = snapMove(moving, others, { w: ed.doc.width, h: ed.doc.height }, 6 / ed.zoom, d.lines);
        dx += snap.dx;
        dy += snap.dy;
        ed.guides = snap.guides;
      }
      for (const it of d.items) {
        if (it.shape) Object.assign(it.el, it.shape, { points: it.shape.points.map((q) => [...q]) });
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
        const asset = (o.type === 'image' || o.type === 'video') && !keepRatio ? ed.doc.assets[o.assetId] : null;
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

  /** The browser took the pointer away (palm rejection, a system gesture): the drag is called off. */
  onCancel(e) {
    const d = this.drag;
    if (d && e.pointerId !== d.pointerId) return; // another finger's
    if (d?.mode === 'draw') {
      this.drag = null;
      this.stroke?.remove();
      this.stroke = null;
      return;
    }
    // Drags that took an undo step when they began (`recorded`) put the design
    // back as it was then (a cancel is the system or a palm, not the person finishing).
    if (d?.recorded) {
      this.drag = null;
      this.ed.guides = [];
      this.ed.revertPending();
      return;
    }
    this.onUp(e);
  }

  onUp(e) {
    const ed = this.ed;
    const d = this.drag;
    if (d && e && e.pointerId !== d.pointerId) return; // another finger lifting
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
      // A new guide that was only clicked goes again too.
      const drop = off || (d.isNew && !d.moved);
      if (drop) ed.pageData.guides.splice(d.index, 1);
      // Nothing happened: a new guide that didn't stay, or one that stays
      // where it was (not moved, or dragged back). Removing one is a change.
      const nothing = d.isNew ? drop : !drop && (!d.moved || g.pos === d.orig);
      if (nothing) {
        ed.history.discard();
        ed.emit('aids');
      } else ed.afterChange();
      return;
    }
    if (d.mode === 'draw') {
      this.stroke?.remove();
      this.stroke = null;
      ed.addDrawing(d.points, d.tool);
      return;
    }
    ed.guides = [];
    // A resized drawing keeps its line width: its box is padded for it again.
    if (d.moved && (d.mode === 'resize' || d.mode === 'resize-many')) {
      for (const el of d.mode === 'resize' ? [d.el] : d.items.map((it) => it.el)) {
        if (el.type === 'draw' && !el.rotation) Object.assign(el, restroke(el, el.strokeWidth));
      }
    }
    if (d.moved) ed.afterChange();
    else {
      ed.history.discard();
      this.drawOverlay();
    }
  }

  onDouble(e) {
    if (this.ed.drawTool) return; // two quick dots are two strokes, nothing more
    const p = this.toPage(e);
    const hit = this.hitTest(p);
    if (!hit || hit.locked) return;
    if (hit.type === 'text') this.startTextEdit(hit);
    else if (isEmptyFrame(this.ed.doc, hit)) this.pickPhotoFor(hit);
    else if (hit.type === 'image') this.startCrop(hit);
    else if (hit.type === 'group') {
      // An empty frame inside a group (a grouped photo grid) still asks for a photo.
      const frame = this.ed.frameAt(p);
      if (isEmptyFrame(this.ed.doc, frame)) this.pickPhotoFor(frame);
    }
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
      // Videos and sounds go where they belong (the page; the soundtrack).
      if (upload.kind === 'video' || upload.kind === 'audio') return this.ed.place(upload, { at });
      const frame = filled ? null : this.ed.frameAt(at);
      if (frame) {
        this.ed.fillFrame(frame.id, upload);
        filled = true;
      } else await this.ed.addImage(upload, { at });
    };
    const uploadId = e.dataTransfer?.getData('application/x-paperwall-upload');
    if (uploadId) {
      try {
        const upload = await store.getUpload(uploadId);
        if (upload && !this.ed.closed) await place(upload);
      } catch (err) {
        toast(err.message, 'error');
      }
      return;
    }
    const files = [...(e.dataTransfer?.files || [])].filter((f) => mediaKind(f));
    if (!files.length) return;
    for (const file of files) {
      try {
        const upload = await this.ed.importMediaFile(file);
        if (this.ed.closed) return;
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
      // The overlay is redrawn every frame of a drag: the grid only when it changes.
      const key = `${W}|${H}|${z}|${v.gridSize}|${ed.doc.unit}`;
      if (this.gridKey !== key) {
        const g = gridLines(ed.doc, v.gridSize);
        this.gridKey = key;
        this.gridPath = [...g.x.map((x) => `M${x * z} 0V${H * z}`), ...g.y.map((y) => `M0 ${y * z}H${W * z}`)].join('');
      }
      parts.push(`<path class="grid-lines" data-testid="grid-lines" d="${this.gridPath}"/>`);
    }
    if (v.margins) {
      const m = marginSize(ed.doc) * z;
      parts.push(`<rect class="margin-box" data-testid="margin-box" x="${m}" y="${m}" width="${W * z - m * 2}" height="${H * z - m * 2}"/>`);
    }
    if (v.bleed) {
      const b = bleedSize(ed.doc) * z;
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
    const perUnit = pxPerUnit(unit);
    const raw = 60 / (z * perUnit);
    const pow = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 5, 10].map((k) => k * pow).find((s) => s >= raw);
    // Enough decimals for the labelled step (0.05 → two, 0.5 → one, 5 → none).
    const digits = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
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

  /**
   * The element a connector end would attach to at p: not a connector, and
   * not the element the other end is already on.
   */
  attachTarget(p, connector, which) {
    const other = (which ? connector.start : connector.end)?.id;
    // Not the other end's element, nor a group holding it.
    const holds = (el) => el.id === other || (el.type === 'group' && el.children.some(holds));
    // A little past the edge counts, since the handle sits on it.
    const reach = 8 / this.ed.zoom;
    return topmost(this.ed.pageData, (el) => !el.hidden && el.type !== 'connector' && !holds(el) && pointInBox(p.x, p.y, el, reach));
  }


  /** Show the stroke being drawn, on top of the page. */
  drawStroke() {
    const d = this.drag;
    const t = d?.tool; // the pen the stroke began with, even if drawing was turned off since
    if (!t || !d) return;
    const z = this.ed.zoom;
    if (!this.stroke?.isConnected) {
      this.stroke = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      this.stroke.setAttribute('class', 'live-stroke');
      Object.entries({ fill: 'none', stroke: t.color, 'stroke-width': t.size * z, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: DRAW_TOOLS[t.tool].opacity })
        .forEach(([k, v]) => this.stroke.setAttribute(k, v));
      this.overlay.append(this.stroke);
      d.shown = 0;
    }
    // Only the new points are added, so a long stroke stays quick to draw.
    const list = this.stroke.points;
    for (; d.shown < d.points.length; d.shown++) {
      const pt = this.overlay.createSVGPoint();
      pt.x = d.points[d.shown][0] * z;
      pt.y = d.points[d.shown][1] * z;
      list.appendItem(pt);
    }
  }

  /** Pick a photo for a frame or picture. `evenLocked` for an explicit Replace. */
  async pickPhotoFor(frame, { evenLocked = false } = {}) {
    // Which picture and page, decided now: either can change while a file is picked.
    const pageId = this.ed.pageData.id;
    const [file] = await pickFile('image/*');
    if (!file || this.ed.closed) return;
    try {
      const upload = await this.ed.importImageFile(file);
      if (this.ed.closed) return; // the design was closed while the photo loaded
      this.ed.fillFrame(frame.id, upload, pageId, { evenLocked });
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
