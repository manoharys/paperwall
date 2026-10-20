// The strip of pages along the bottom, and presenting pages full screen.

import { h, icon, iconButton, clear, debounce, dialog, toast, lazily, forget, pressable } from './ui.js';
import { renderPage, renderFrame } from '../model/render.js';
import { ANIMATIONS, animationOf, animationsEnd, pageDuration, transitionOf, timeline } from '../model/motion.js';
import { VideoFrames, videosOn, blobUrl } from './media.js';
import { measure } from './fonts.js';
import { visiblePages, pageName, pageLabel } from '../model/doc.js';

export class PageStrip {
  constructor(editor, canvas) {
    this.ed = editor;
    this.canvas = canvas;
    this.list = h('ol', { class: 'page-list', 'data-testid': 'page-strip' });
    this.zoomLabel = h('button', { type: 'button', class: 'zoom-label', title: 'Zoom to fit', 'data-testid': 'zoom-label', onClick: () => canvas.zoomToFit() }, '100%');
    this.el = h('footer', { class: 'pages-bar' },
      this.list,
      iconButton('plus', 'Add page', () => editor.addPage(), { 'data-testid': 'strip-add-page' }),
      iconButton('grid', 'All pages in a grid', () => pageGrid(editor, canvas), { 'data-testid': 'page-grid-btn' }),
      h('div', { class: 'zoom' },
        iconButton('minus', 'Zoom out', () => canvas.zoomBy(1 / 1.25), { 'data-testid': 'zoom-out' }),
        this.zoomLabel,
        iconButton('plus', 'Zoom in', () => canvas.zoomBy(1.25), { 'data-testid': 'zoom-in' }),
        iconButton('fit', 'Zoom to fit', () => canvas.zoomToFit(), { 'data-testid': 'zoom-fit' })));
    this.redraw = debounce(() => this.render(), 250);
    editor.on((what) => {
      if (what === 'view') this.zoomLabel.textContent = `${Math.round(editor.zoom * 100)}%`;
      else if (what === 'page') this.redraw.flush(); // now, and once (a 'doc' redraw may be waiting too)
      else if (what === 'doc') this.redraw();
      else if (what === 'strip') this.relabel();
    });
    this.render();
  }

  /** Titles changed: update the labels, without drawing every page again. */
  relabel() {
    const items = this.list.querySelectorAll('[data-testid="page-thumb"]');
    if (items.length !== this.ed.doc.pages.length) return this.redraw();
    this.ed.doc.pages.forEach((p, i) => {
      const item = items[i];
      const label = pageLabel(p, i);
      const thumb = item.querySelector('.page-thumb');
      thumb.title = label;
      thumb.setAttribute('aria-label', label);
      let span = item.querySelector('.page-title');
      if (!p.title) return void span?.remove();
      if (!span) item.append((span = h('span', { class: 'page-title', 'data-testid': 'page-title-label' })));
      span.textContent = p.title;
    });
  }

  render() {
    const ed = this.ed;
    clear(this.list);
    ed.doc.pages.forEach((p, i) => {
      const label = pageLabel(p, i);
      const item = h('li', { class: `${i === ed.page ? 'on' : ''}${p.hidden ? ' hidden-page' : ''}`, draggable: 'true', 'data-testid': 'page-thumb' },
        pressable({ class: 'page-thumb', title: label, 'aria-label': label, 'aria-current': String(i === ed.page) }, () => ed.setPage(i),
          h('span', { class: 'page-img', style: { aspectRatio: `${ed.doc.width} / ${ed.doc.height}` }, html: renderPage(ed.doc, i, { measure, noSize: true, placeholders: true, idPrefix: `ps${i}`, assetHref: this.canvas.assetHref }) }),
          h('span', { class: 'page-no' }, String(i + 1)),
          p.hidden ? h('span', { class: 'page-hidden-mark', 'aria-hidden': 'true' }, icon('eyeOff', 14)) : null),
        p.title ? h('span', { class: 'page-title', 'data-testid': 'page-title-label' }, p.title) : null);
      pageDrag(item, i, (from) => ed.movePage(from, i));
      this.list.append(item);
    });
    this.zoomLabel.textContent = `${Math.round(ed.zoom * 100)}%`;
  }
}

/** Let a page's thumbnail be dragged onto another to move it there. */
function pageDrag(el, i, onMove) {
  el.addEventListener('dragstart', (e) => e.dataTransfer.setData('application/x-paperwall-page', String(i)));
  el.addEventListener('dragover', (e) => e.preventDefault());
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData('application/x-paperwall-page');
    const from = raw === '' ? NaN : Number(raw); // other drags (an upload, a file) carry no page
    if (Number.isInteger(from) && from !== i) onMove(from);
  });
}


/** Every page large, in a grid: click one to go to it, drag to reorder. */
export function pageGrid(editor, canvas) {
  const grid = h('ol', { class: 'page-grid', 'data-testid': 'page-grid' });
  const fill = () => {
    forget(grid);
    clear(grid);
    editor.doc.pages.forEach((p, i) => {
      // Each page is drawn once it scrolls into view: a long design opens at once.
      const img = h('span', { class: 'page-img', style: { aspectRatio: `${editor.doc.width} / ${editor.doc.height}` } });
      lazily(img, () => (img.innerHTML = renderPage(editor.doc, i, { measure, noSize: true, placeholders: true, idPrefix: `pg${i}`, assetHref: canvas.assetHref })));
      const card = h('li', { class: `pg-card${i === editor.page ? ' on' : ''}${p.hidden ? ' hidden-page' : ''}`, draggable: 'true', 'data-testid': 'page-grid-card' },
        pressable({ class: 'pg-open', 'aria-label': `Open ${pageName(p, i)}` }, () => {
          editor.setPage(i);
          d.close();
        }, img),
        h('div', { class: 'pg-meta' },
          h('b', null, String(i + 1)),
          h('span', null, p.title || ''),
          p.hidden ? h('small', null, 'Hidden') : null,
          iconButton(p.hidden ? 'eye' : 'eyeOff', p.hidden ? 'Show page' : 'Hide page', () => {
            editor.setPageHidden(i, !p.hidden);
            fill();
          }, { 'data-testid': 'page-grid-hide' })));
      pageDrag(card, i, (from) => {
        editor.movePage(from, i);
        fill();
      });
      grid.append(card);
    });
  };
  fill();
  const d = dialog(`All pages (${editor.doc.pages.length})`, grid, { wide: true, testid: 'page-grid-dialog', onClose: () => forget(grid) });
  return d;
}

/**
 * Show pages full screen, one at a time, playing their animations and the
 * transitions between them. Arrow keys move, Escape leaves. Hidden pages are
 * skipped. `autoplay` moves on by itself after each page's time (Play).
 */
export function present(editor, canvas, { autoplay = false } = {}) {
  const doc = editor.doc;
  const shown = visiblePages(doc);
  if (!shown.length) return toast('Every page is hidden. Show a page to present it.');
  // Start on the page in view, or the next visible one after it (the last
  // visible one if none come after).
  const next = shown.findIndex((k) => k >= editor.page);
  let at = next >= 0 ? next : shown.length - 1;
  const slide = h('div', { class: 'slide', 'data-testid': 'slide' });
  const counter = h('div', { class: 'slide-count' });
  const root = h('div', { class: 'presenter', 'data-testid': 'presenter', tabindex: '-1' }, slide, counter,
    h('button', { type: 'button', class: 'presenter-close', 'aria-label': 'Stop presenting', onClick: () => close() }, icon('close')));
  // Videos play along (their picture taken each frame), and the soundtrack
  // plays from where the shown page starts in the whole design.
  const videos = new VideoFrames(doc);
  const tl = timeline(doc, shown);
  const sound = soundtrackPlayer(doc);
  const opts = { measure, noSize: true, assetHref: canvas.assetHref, videoFrame: (el) => videos.capture(el) };
  let frame = 0;
  let started = 0;
  let from = null; // the page before, when moving forward (its transition plays)
  const draw = (now) => {
    frame = 0;
    const i = shown[at];
    const page = doc.pages[i];
    const local = (now - started) / 1000;
    const tr = transitionOf(page);
    if (from !== null && tr.type !== 'none' && local < tr.duration) {
      const progress = Math.max(0, Math.min(1, local / tr.duration));
      slide.innerHTML = renderFrame(doc, { index: i, local, from: { index: from, local: pageDuration(doc.pages[from]) }, transition: { type: tr.type, progress: 1 - (1 - progress) ** 3 } }, { ...opts, idPrefix: `pr${i}` });
    } else slide.innerHTML = renderPage(doc, i, { ...opts, idPrefix: `pr${i}`, time: local });
    root.dataset.time = local.toFixed(2);
    if (autoplay && local >= pageDuration(page)) {
      if (at < shown.length - 1) return go(at + 1, true);
      return; // the end: the last page stays
    }
    // Keep drawing while anything moves (or until the page's time is up, when playing).
    const moving = local < Math.max(animationsEnd(page), from !== null ? tr.duration : 0) || page.elements.some((el) => ANIMATIONS[animationOf(page, el)?.type]?.loop) || videosOn(doc, [i]).length > 0;
    if (moving || autoplay) frame = requestAnimationFrame(draw);
  };
  const go = (to, forward) => {
    cancelAnimationFrame(frame);
    from = forward && to !== at ? shown[at] : null;
    at = to;
    started = performance.now();
    videos.pauseAll();
    videos.start(videosOn(doc, [shown[at]]));
    sound?.seek(tl.parts[at].start);
    slide.style.aspectRatio = `${doc.width} / ${doc.height}`;
    counter.textContent = `${at + 1} / ${shown.length}`;
    draw(started);
  };
  const last = shown.length - 1;
  const onKey = (e) => {
    let to = at;
    if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key)) to = Math.min(last, at + 1);
    else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) to = Math.max(0, at - 1);
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = last;
    else if (e.key === 'Escape') return close();
    else return;
    e.preventDefault();
    e.stopPropagation();
    go(to, to === at + 1);
  };
  const close = () => {
    cancelAnimationFrame(frame);
    videos.dispose();
    sound?.stop();
    document.removeEventListener('keydown', onKey, true);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => null);
    root.remove();
  };
  root.addEventListener('click', (e) => {
    if (e.target.closest('.presenter-close')) return;
    const left = e.clientX < window.innerWidth / 3;
    const to = left ? Math.max(0, at - 1) : Math.min(last, at + 1);
    go(to, to === at + 1);
  });
  document.addEventListener('keydown', onKey, true);
  document.body.append(root);
  go(at, false);
  root.focus();
  root.requestFullscreen?.().catch(() => null);
}

/** The design's soundtrack as something to play from a point, or null if it has none. */
function soundtrackPlayer(doc) {
  const asset = doc.audio && doc.assets[doc.audio.assetId];
  if (!asset) return null;
  const url = blobUrl(asset.dataUrl);
  const audio = new Audio(url);
  audio.volume = doc.audio.volume ?? 1;
  return {
    seek(t) {
      const go = () => {
        audio.currentTime = Math.min(t, Math.max(0, (audio.duration || t) - 0.05));
        audio.play().catch(() => null);
      };
      if (audio.readyState >= 1) go();
      else audio.addEventListener('loadedmetadata', go, { once: true });
    },
    stop() {
      audio.pause();
      URL.revokeObjectURL(url);
    },
  };
}
