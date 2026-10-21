// The strip of pages along the bottom, and presenting pages full screen.

import { h, icon, iconButton, clear, debounce, dialog, toast, lazily, forget, pressable } from './ui.js';
import { renderPage, renderFrame } from '../model/render.js';
import { animationsEnd, keepsMoving, hasLoop, soundFade, pageDuration, pageFrame, transitionOf, timeline } from '../model/motion.js';
import { VideoFrames, videosOn, blobUrlFor } from './media.js';
import { measure, measureVersion, fontCssFor } from './fonts.js';
import { visiblePages, soundtrackOf, hasDefaultFilters } from '../model/doc.js';
import { boundsOf, rectsIntersect } from '../model/geometry.js';
import { t, formatNumber } from './i18n.js';
import { pageName, pageLabel } from './names.js';

export class PageStrip {
  constructor(editor, canvas) {
    this.ed = editor;
    this.canvas = canvas;
    this.list = h('ol', { class: 'page-list', 'data-testid': 'page-strip' });
    this.zoomLabel = h('button', { type: 'button', class: 'zoom-label', title: t('zoom.fit'), 'data-testid': 'zoom-label', onClick: () => canvas.zoomToFit() }, '100%');
    this.el = h('footer', { class: 'pages-bar' },
      this.list,
      iconButton('plus', t('pages.add'), () => editor.addPage(), { 'data-testid': 'strip-add-page' }),
      iconButton('grid', t('pages.grid'), () => pageGrid(editor, canvas), { 'data-testid': 'page-grid-btn' }),
      h('div', { class: 'zoom' },
        iconButton('minus', t('zoom.out'), () => canvas.zoomBy(1 / 1.25), { 'data-testid': 'zoom-out' }),
        this.zoomLabel,
        iconButton('plus', t('zoom.in'), () => canvas.zoomBy(1.25), { 'data-testid': 'zoom-in' }),
        iconButton('fit', t('zoom.fit'), () => canvas.zoomToFit(), { 'data-testid': 'zoom-fit' })));
    this.images = new Map(); // page id → { looks, img }: each page's picture as last drawn
    this.contents = new WeakMap(); // page → { at, json }: its contents as of the editor's last change
    this.drawnCount = 0;
    this.redraw = debounce(() => this.render(), 250);
    this.unlisten = editor.on((what) => {
      if (what === 'view') this.zoomLabel.textContent = zoomText(editor.zoom);
      else if (what === 'page') this.redraw.flush(); // now, and once (a 'doc' redraw may be waiting too)
      else if (what === 'doc') this.redraw();
      else if (what === 'strip') this.relabel();
    });
    this.render();
  }

  /** Let go of the editor (the editor's screen is being taken down). */
  destroy() {
    this.unlisten();
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

  /**
   * A page's picture for the strip: the one already drawn if the page looks
   * the same, else a new one, drawn once it scrolls into view. (A change to
   * one page of a long design draws just that page again.)
   */
  pageImage(p, i, keep) {
    const ed = this.ed;
    // (Its contents are written out again only after a change, not on every redraw.)
    let seen = this.contents.get(p);
    if (!seen || seen.at !== ed.looks) this.contents.set(p, (seen = { at: ed.looks, json: JSON.stringify(p) }));
    const looks = `${ed.doc.width}x${ed.doc.height}|${measureVersion()}|${this.canvas.hrefsChanged || 0}|${seen.json}`;
    const kept = keep ? this.images.get(p.id) : null;
    if (kept?.looks === looks) return kept.img;
    if (kept) forget(kept.img);
    const img = h('span', { class: 'page-img', style: { aspectRatio: `${ed.doc.width} / ${ed.doc.height}` } });
    // (Ids in each picture are its own, wherever the page moves to.)
    const prefix = `ps${++this.drawnCount}`;
    lazily(img, () => {
      // The page as it is now, wherever it is (undo brings back copies of pages).
      const pages = this.ed.doc.pages;
      const at = pages[i]?.id === p.id ? i : pages.findIndex((q) => q.id === p.id);
      if (at >= 0) img.innerHTML = renderPage(this.ed.doc, at, { measure, noSize: true, placeholders: true, idPrefix: prefix, assetHref: this.canvas.assetHref });
    });
    if (keep) this.images.set(p.id, { looks, img });
    return img;
  }

  render() {
    const ed = this.ed;
    clear(this.list);
    // Pictures of pages no longer in the design go.
    const ids = new Set(ed.doc.pages.map((p) => p.id));
    for (const [id, kept] of this.images) {
      if (ids.has(id)) continue;
      forget(kept.img);
      this.images.delete(id);
    }
    const seen = new Set(); // (two pages with one id, from an odd file: the second's picture isn't kept)
    ed.doc.pages.forEach((p, i) => {
      const label = pageLabel(p, i);
      const keep = !seen.has(p.id);
      seen.add(p.id);
      const item = h('li', { class: `${i === ed.page ? 'on' : ''}${p.hidden ? ' hidden-page' : ''}`, draggable: 'true', 'data-testid': 'page-thumb' },
        pressable({ class: 'page-thumb', title: label, 'aria-label': label, 'aria-current': String(i === ed.page) }, () => ed.setPage(i),
          this.pageImage(p, i, keep),
          h('span', { class: 'page-no' }, String(i + 1)),
          p.hidden ? h('span', { class: 'page-hidden-mark', 'aria-hidden': 'true' }, icon('eyeOff', 14)) : null),
        p.title ? h('span', { class: 'page-title', 'data-testid': 'page-title-label' }, p.title) : null);
      pageDrag(item, i, (from) => ed.movePage(from, i));
      this.list.append(item);
    });
    this.zoomLabel.textContent = zoomText(ed.zoom);
  }
}

/** The zoom as a percentage, as this language writes one. */
function zoomText(z) {
  return formatNumber(Math.round(z * 100) / 100, { style: 'percent' }).replace(/\s/g, '');
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
        pressable({ class: 'pg-open', 'aria-label': t('pages.open', { name: pageName(p, i) }) }, () => {
          editor.setPage(i);
          d.close();
        }, img),
        h('div', { class: 'pg-meta' },
          h('b', null, String(i + 1)),
          h('span', null, p.title || ''),
          p.hidden ? h('small', null, t('pages.hidden')) : null,
          iconButton(p.hidden ? 'eye' : 'eyeOff', p.hidden ? t('pages.show') : t('pages.hide'), () => {
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
  const d = dialog(t('pages.all', { n: editor.doc.pages.length }), grid, { wide: true, testid: 'page-grid-dialog', onClose: () => forget(grid) });
  return d;
}

/**
 * Show pages full screen, one at a time, playing their animations and the
 * transitions between them. Arrow keys move, Escape leaves. Hidden pages are
 * skipped. `autoplay` moves on by itself after each page's time (Play).
 * `only`: just the page in view, once (a preview of its motion, no soundtrack).
 * `host`: the window to show them in (another one, for the presenter view);
 * `onPage(index, shownIndexes)` hears each page change, `onClose` the end.
 * Returns { close, go(position) }.
 */
export function present(editor, canvas, { autoplay = false, only = false, host = window, onPage = null, onClose = null } = {}) {
  const hostDoc = host.document;
  // Timed by this window's clock, whichever window draws (another window's
  // frame times count from when it opened).
  const raf = (fn) => host.requestAnimationFrame(() => fn(performance.now()));
  const unraf = (id) => host.cancelAnimationFrame(id);
  const doc = editor.doc;
  const shown = only ? [editor.page] : visiblePages(doc);
  if (!shown.length) return toast(t('present.allHidden'));
  // Start on the page in view, or the next visible one after it (the last
  // visible one if none come after).
  const next = shown.findIndex((k) => k >= editor.page);
  let at = next >= 0 ? next : shown.length - 1;
  const slide = h('div', { class: 'slide', 'data-testid': 'slide' });
  const counter = h('div', { class: 'slide-count' });
  const root = h('div', { class: 'presenter', 'data-testid': 'presenter', tabindex: '-1' }, slide, counter,
    h('button', { type: 'button', class: 'presenter-close', 'aria-label': t('present.stop'), onClick: () => close() }, icon('close')));
  // Videos play along, and with Play the soundtrack too.
  const videos = new VideoFrames(doc);
  const tl = timeline(doc, shown);
  // The soundtrack plays with Play (as the panel says), not plain presenting.
  const sound = autoplay && !only ? soundtrackPlayer(doc) : null;
  // The sound starts with the page Play starts on (as in a download of the
  // pages from there); moving to another page moves it along with them.
  let soundFrom = tl.parts[at].start;
  // Videos are taken at the size they show on screen (the slide fits the
  // screen both ways), and at most 30 times a second, however fast the screen.
  const shownScale = () => Math.min(host.innerWidth / doc.width, host.innerHeight / doc.height) * (host.devicePixelRatio || 1);
  const taken = new Map(); // element id → { at, picture }
  const capture = (el) => {
    const now = performance.now();
    const last = taken.get(el.id);
    if (last && now - last.at < 33) return last.picture;
    // While a video seeks (starting, looping) it has no picture: the last one
    // stays (not the poster, a jump to another moment).
    const picture = videos.capture(el, shownScale()) || last?.picture || null;
    taken.set(el.id, { at: now, picture });
    return picture;
  };
  const opts = { measure, noSize: true, assetHref: canvas.assetHref, videoFrame: capture };
  let frame = 0;
  let info = null; // the shown page's motion, worked out once when it comes up
  let started = 0;
  let from = null; // the page before, when moving forward (its transition plays)
  let fromAt = null; // how far into it it was left (it stays as it was then)
  let drawn = 0; // when the slide was last drawn
  let wait = 0; // a still page's timer, when playing
  let fading = 0; // when playing the last page: the soundtrack's fade-out, as downloads end
  let live = false; // the page's videos are playing in place: nothing to redraw
  // Safari: live videos laid over the slide, each in a box of its own (see shownPlainly).
  const overlays = [];
  const placeOverlays = () => {
    const svg = slide.querySelector('svg');
    if (!svg || !overlays.length) return;
    const r = svg.getBoundingClientRect();
    const s = slide.getBoundingClientRect();
    const k = r.width / doc.width;
    for (const { el, box, v } of overlays) {
      const crop = el.crop || { x: 0, y: 0, w: 1, h: 1 };
      const iw = (el.w / crop.w) * k;
      const ih = (el.h / crop.h) * k;
      Object.assign(box.style, { left: `${r.left - s.left + el.x * k}px`, top: `${r.top - s.top + el.y * k}px`, width: `${el.w * k}px`, height: `${el.h * k}px`, borderRadius: `${(el.radius || 0) * k}px`, opacity: String(el.opacity ?? 1) });
      Object.assign(v.style, { left: `${-crop.x * iw}px`, top: `${-crop.y * ih}px`, width: `${iw}px`, height: `${ih}px` });
    }
  };
  const draw = (now) => {
    frame = 0;
    const i = shown[at];
    const page = doc.pages[i];
    const local = (now - started) / 1000;
    const tr = transitionOf(page);
    // Once only videos or looping animations move, 30 frames a second is plenty.
    const settled = local >= Math.max(info.end, from !== null ? tr.duration : 0);
    if ((LIVE_VIDEO || info.plain) && settled && info.keeps && !info.loops && !live) {
      // Only videos move now: drawn once more, with each live video in its
      // own place in the slide (layered and clipped as designed), so no
      // picture is taken of them frame by frame. (In Safari, over the slide.)
      live = true;
      slide.innerHTML = renderFrame(doc, pageFrame(doc, i, local, null), { ...opts, idPrefix: `pr${i}`, videoSlots: true });
      overlays.length = 0;
      for (const box of slide.querySelectorAll('foreignObject[data-video]')) {
        const v = videos.videoOf({ id: box.dataset.video });
        if (!v) continue;
        v.className = 'slide-video';
        const playing = !v.paused;
        if (LIVE_VIDEO) box.append(v);
        else {
          const over = h('div', { class: 'slide-video-box', 'data-testid': 'slide-video-box' }, v);
          slide.append(over);
          overlays.push({ el: info.videos.find((el) => el.id === box.dataset.video), box: over, v });
        }
        if (playing && v.paused) v.play().catch(() => null); // (moved to another window, a video can stop)
        // The picture under it goes once the video shows (it'd show through
        // a see-through video).
        const under = box.parentNode.querySelector(`image[data-under="${CSS.escape(box.dataset.video)}"]`);
        if (under) {
          // Once it's playing from this visit's start (not still showing a
          // picture from an earlier one): 'playing' says so.
          if (videos.isPlaying({ id: box.dataset.video }) || videos.hasEnded({ id: box.dataset.video })) under.remove();
          else v.addEventListener('playing', () => under.remove(), { once: true });
        }
      }
      placeOverlays();
    } else if (live) {
      // Nothing to draw: the videos play themselves.
    } else if ((settled && info.keeps) || info.videos.length ? now - drawn < 33 && drawn : false) {
      // (With videos on the page, 30 a second while things come in too: each
      // frame carries their pictures.)
      frame = raf(draw);
      return;
    } else {
      drawn = now;
      // The same rule for transitions as downloads use.
      slide.innerHTML = renderFrame(doc, pageFrame(doc, i, local, from, fromAt), { ...opts, idPrefix: `pr${i}` });
    }
    root.dataset.time = local.toFixed(2);
    if (autoplay && local >= pageDuration(page)) {
      if (at < shown.length - 1) return go(at + 1, true, { auto: true });
      // The end: the last page stays, and sound and videos stop with it (as in a download).
      videos.pauseAll();
      sound?.pause();
      return;
    }
    // Keep drawing while anything moves. When playing a page that's now still,
    // just wait for its time to be up.
    // (A page whose videos have all played once, to the end, is still now.)
    const ended = info.keeps && !info.loops && videos.allEnded(info.videos);
    const moving = !settled || (info.keeps && !live && !ended);
    if (moving) frame = raf(draw);
    else if (autoplay) {
      wait = setTimeout(() => {
        wait = 0;
        frame = raf(draw);
      }, Math.max(0, (pageDuration(page) - local) * 1000));
    }
  };
  // `auto`: moving on by itself, when the sound is already in the right place.
  const go = (to, forward, { auto = false } = {}) => {
    unraf(frame);
    clearTimeout(wait);
    // Moving on by itself keeps to the show's clock: a fade under way goes on.
    if (!auto) clearTimeout(fading);
    from = forward && to !== at ? shown[at] : null;
    fromAt = from !== null ? (performance.now() - started) / 1000 : null;
    // Moving on by itself, the next page starts when the last one's time was
    // up (not a frame later), so pages keep time with the soundtrack.
    started = auto ? started + pageDuration(doc.pages[shown[at]]) * 1000 : performance.now();
    // Back from a tab in the background, long overdue: the show picks up from
    // here (the next page from its start, the sound with it), rather than
    // racing through the pages it missed.
    if (auto && performance.now() - started > 1000) {
      auto = false;
      started = performance.now();
      clearTimeout(fading); // timed afresh below
    }
    at = to;
    drawn = 0;
    live = false;
    taken.clear(); // a page's videos start afresh: no picture from an earlier visit
    const page = doc.pages[shown[at]];
    info = { end: animationsEnd(page), keeps: keepsMoving(page, doc.assets), loops: hasLoop(page), videos: videosOn(doc, [shown[at]]) };
    info.plain = !LIVE_VIDEO && shownPlainly(doc, page, info.videos);
    videos.pauseAll();
    videos.start(info.videos, started);
    // Back before the page Play started on: the sound starts over from there
    // (as if Play had started there), so later pages meet it where they did.
    if (tl.parts[at].start < soundFrom) soundFrom = tl.parts[at].start;
    if (!auto) sound?.seek(tl.parts[at].start - soundFrom);
    if (sound && !auto) {
      // The sound fades over the end of the show (as in a download of these
      // pages), which may begin a page or more before the last.
      const fade = soundFade(tl.total - soundFrom);
      const end = started + (tl.total - tl.parts[at].start) * 1000;
      fading = setTimeout(() => sound.fadeOut(Math.max(0.05, (end - performance.now()) / 1000)), Math.max(0, end - fade * 1000 - performance.now()));
    }
    slide.style.aspectRatio = `${doc.width} / ${doc.height}`;
    counter.textContent = `${at + 1} / ${shown.length}`;
    onPage?.(shown[at], shown);
    draw(started);
  };
  const last = shown.length - 1;
  const onKey = (e) => {
    const k = presentingKey(e.key);
    if (k === 'stop') return close();
    if (!k) return;
    const to = k === 'first' ? 0 : k === 'last' ? last : Math.max(0, Math.min(last, at + k));
    e.preventDefault();
    e.stopPropagation();
    if (to !== at) go(to, to === at + 1); // at either end, nothing happens (the page doesn't start over)
  };
  const close = () => {
    unraf(frame);
    clearTimeout(wait);
    clearTimeout(fading);
    videos.dispose();
    sound?.stop();
    hostDoc.removeEventListener('keydown', onKey, true);
    hostDoc.removeEventListener('fullscreenchange', onFullscreen);
    host.removeEventListener('resize', placeOverlays);
    window.removeEventListener('hashchange', close);
    if (hostDoc.fullscreenElement) hostDoc.exitFullscreen().catch(() => null);
    root.remove();
    onClose?.();
  };
  // Leaving full screen (Escape, which the browser keeps for itself) ends
  // presenting too: nothing plays on behind it.
  let wentFull = false;
  const onFullscreen = () => {
    if (hostDoc.fullscreenElement) wentFull = true;
    else if (wentFull) close();
  };
  root.addEventListener('click', (e) => {
    if (e.target.closest('.presenter-close')) return;
    const left = e.clientX < host.innerWidth / 3;
    const to = left ? Math.max(0, at - 1) : Math.min(last, at + 1);
    if (to !== at) go(to, to === at + 1);
  });
  hostDoc.addEventListener('keydown', onKey, true);
  hostDoc.addEventListener('fullscreenchange', onFullscreen);
  host.addEventListener('resize', placeOverlays);
  // Leaving the editor (Back, say) ends presenting too.
  window.addEventListener('hashchange', close);
  hostDoc.body.append(root);
  go(at, false);
  root.focus();
  root.requestFullscreen?.().catch(() => null);
  return {
    close,
    /** Move to `to` (a position among the shown pages), as the arrow keys do. */
    go(to) {
      const k = Math.max(0, Math.min(last, to));
      if (k !== at) go(k, k === at + 1);
    },
    get at() {
      return at;
    },
  };
}

/** What a key does when presenting: 1 or -1 (a page on or back), 'first', 'last', 'stop', or null. */
function presentingKey(key) {
  if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(key)) return 1;
  if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(key)) return -1;
  return { Home: 'first', End: 'last', Escape: 'stop' }[key] || null;
}

// (This tab's own: another tab presenting keeps its slides window.)
const SLIDES_WINDOW = `paperwall-slides-${Math.random().toString(36).slice(2, 8)}`;

/**
 * The presenter view: the slides in a window of their own (for the
 * audience: drag it to the projector), and here the page now, the next one,
 * its notes and a timer. Either window moves the slides on.
 */
export function presenterView(editor, canvas) {
  const doc = editor.doc;
  if (!visiblePages(doc).length) return toast(t('present.allHidden'));
  // Opened first, while the click still counts (pop-up blockers allow that).
  const audience = window.open('', SLIDES_WINDOW, 'popup,width=960,height=600');
  if (!audience) {
    toast(t('present.popups'), 'error');
    return present(editor, canvas);
  }
  // The slides' window: this page's look, and the design's fonts.
  const adoc = audience.document;
  adoc.title = t('present.slidesTitle', { name: doc.name });
  adoc.head.replaceChildren(...[...document.querySelectorAll('style, link[rel="stylesheet"]')].map((n) => n.cloneNode(true)));
  adoc.body.replaceChildren();
  adoc.body.style.margin = '0';
  adoc.body.style.background = '#000';
  fontCssFor(doc).then((css) => {
    if (css && !audience.closed) adoc.head.append(Object.assign(adoc.createElement('style'), { textContent: css }));
  }).catch(() => null);

  const current = h('div', { class: 'pv-slide', 'data-testid': 'pv-current' });
  const upcoming = h('div', { class: 'pv-slide small', 'data-testid': 'pv-next' });
  const notes = h('div', { class: 'pv-notes', 'data-testid': 'pv-notes' });
  const clock = h('span', { class: 'pv-timer', 'data-testid': 'pv-timer', role: 'timer' }, '0:00');
  const count = h('span', { class: 'pv-count', 'data-testid': 'pv-count' });
  let ctl = null;
  const move = (by) => ctl && ctl.go(ctl.at + by);
  const view = h('div', { class: 'presenter-view', 'data-testid': 'presenter-view', tabindex: '-1' },
    h('header', null,
      clock,
      h('button', { type: 'button', class: 'btn small', 'data-testid': 'pv-reset', onClick: () => (begun = performance.now()) }, t('present.restartTimer')),
      count,
      h('button', { type: 'button', class: 'btn small', 'data-testid': 'pv-end', onClick: () => ctl?.close() }, t('present.end'))),
    h('div', { class: 'pv-main' },
      current,
      h('aside', null, h('h3', null, t('common.next')), upcoming, h('h3', null, t('inspector.notes')), notes)),
    h('footer', null,
      h('button', { type: 'button', class: 'btn', 'data-testid': 'pv-prev', onClick: () => move(-1) }, t('common.previous')),
      h('button', { type: 'button', class: 'btn primary', 'data-testid': 'pv-next-btn', onClick: () => move(1) }, t('common.next'))));
  const render = (i) => renderPage(doc, i, { measure, noSize: true, assetHref: canvas.assetHref, idPrefix: `pv${i}` });
  const show = (i, list) => {
    const k = list.indexOf(i);
    current.innerHTML = render(i);
    if (k + 1 < list.length) upcoming.innerHTML = render(list[k + 1]);
    else upcoming.replaceChildren(h('p', { class: 'pv-end' }, t('present.theEnd')));
    notes.textContent = doc.pages[i].notes || t('present.noNotes');
    notes.classList.toggle('empty', !doc.pages[i].notes);
    count.textContent = `${k + 1} / ${list.length}`;
  };
  // The time since the start (minutes:seconds); and if the slides' window
  // is closed, presenting ends.
  let begun = performance.now();
  const tick = setInterval(() => {
    if (audience.closed) return ctl?.close();
    const s = Math.floor((performance.now() - begun) / 1000);
    clock.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }, 250);
  // The same keys as presenting.
  const onKey = (e) => {
    const k = presentingKey(e.key);
    if (!k) return;
    // (Enter or Space on a focused button presses it.)
    if ((e.key === 'Enter' || e.key === ' ') && e.target.closest?.('button')) return;
    if (k === 'stop') ctl?.close();
    else if (k === 'first') ctl?.go(0);
    else if (k === 'last') ctl?.go(Infinity);
    else move(k);
    e.preventDefault();
    e.stopPropagation();
  };
  // Leaving or reloading this page closes the slides' window too (it'd be left stuck).
  const onLeave = () => ctl?.close();
  window.addEventListener('pagehide', onLeave);
  const end = () => {
    clearInterval(tick);
    window.removeEventListener('pagehide', onLeave);
    document.removeEventListener('keydown', onKey, true);
    view.remove();
    if (!audience.closed) audience.close();
  };
  document.body.append(view);
  document.addEventListener('keydown', onKey, true);
  try {
    ctl = present(editor, canvas, { host: audience, onPage: show, onClose: end });
  } catch (e) {
    end(); // (nothing left open that can't be closed)
    throw e;
  }
  view.focus();
  return ctl;
}

// Safari draws HTML inside SVG (the live video's place) without the page's
// moves, turns and clipping, so there videos play over the slide when they
// can (see shownPlainly), else are shown as pictures throughout.
// (Every browser on iPhones and iPads is Safari inside: any WebKit that isn't Chrome's Blink.)
const LIVE_VIDEO = typeof navigator === 'undefined' || !(/AppleWebKit/.test(navigator.userAgent) && !/Chrome\/|Chromium\//.test(navigator.userAgent));

/**
 * Whether a page's videos can play over its slide, as they look on it: each
 * on the page itself (not in a group) and wholly inside it (nothing clips
 * what's laid over the slide), not turned, flipped, clipped to a shape,
 * filtered or shadowed, and with nothing over it.
 */
function shownPlainly(doc, page, videos) {
  return videos.length > 0 && videos.every((el) => {
    const at = page.elements.indexOf(el);
    if (at < 0 || el.rotation % 360 || el.flipX || el.flipY || (el.mask && el.mask !== 'none') || el.shadow) return false;
    if (el.x < 0 || el.y < 0 || el.x + el.w > doc.width || el.y + el.h > doc.height) return false;
    if (!hasDefaultFilters(el)) return false;
    return page.elements.slice(at + 1).every((o) => o.hidden || !rectsIntersect(boundsOf(o), boundsOf(el)));
  });
}

/** The design's soundtrack as something to play from a point, or null if it has none. */
function soundtrackPlayer(doc) {
  const asset = soundtrackOf(doc);
  if (!asset) return null;
  const audio = new Audio();
  let url = '';
  try {
    url = blobUrlFor(asset.dataUrl); // let go of when presenting ends
    audio.src = url;
  } catch {
    /* a damaged sound: the slides play in silence */
  }
  // Volume through Web Audio where there is one (iPhones and iPads ignore a
  // player's own volume), else the player's.
  const volume = doc.audio.volume ?? 1;
  let mixer = null;
  let gain = null;
  let fadeTurn = 0; // a fade without Web Audio stops when this moves on
  const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
  try {
    mixer = new Ctx();
    gain = mixer.createGain();
    gain.gain.value = volume;
    mixer.createMediaElementSource(audio).connect(gain).connect(mixer.destination);
    mixer.resume?.().catch(() => null); // in case it starts held
  } catch {
    mixer?.close?.().catch(() => null);
    mixer = null;
    gain = null;
    audio.volume = volume;
  }
  // Asked to play now, while the click that pressed Play still counts:
  // Safari only lets a sound play later if it was started by a click.
  audio.play().catch(() => null);
  let stopped = false;
  let wanted = null; // the latest place asked for, played once the sound is ready
  let wantedAt = 0; // when it was asked for: the sound has been due to play since
  const play = () => {
    if (stopped || wanted === null) return;
    // Where the slides are now, not where they were when asked (the sound
    // may take a moment to load).
    const t = wanted + (performance.now() - wantedAt) / 1000;
    // Past the end of the sound: silence (as in a download), not its last moment.
    if (audio.duration && t >= audio.duration) return audio.pause();
    audio.currentTime = t;
    audio.play().catch(() => null);
  };
  audio.addEventListener('loadedmetadata', play);
  return {
    seek(t) {
      fadeTurn++; // back from any fade
      if (gain) {
        gain.gain.cancelScheduledValues(0);
        gain.gain.value = volume;
      } else audio.volume = volume;
      wanted = t;
      wantedAt = performance.now();
      if (audio.readyState >= 1) play();
    },
    /** Fade to silence over `seconds` (as downloads end). */
    fadeOut(seconds) {
      if (!gain) {
        // No Web Audio: the player's own volume, stepped down (until a seek
        // starts the fade's turn over).
        const turn = ++fadeTurn;
        const from = audio.volume;
        const start = performance.now();
        const step = () => {
          if (turn !== fadeTurn || stopped || wanted === null) return;
          const k = Math.min(1, (performance.now() - start) / 1000 / Math.max(0.05, seconds));
          audio.volume = from * (1 - k);
          if (k < 1) setTimeout(step, 50);
        };
        return step();
      }
      const now = mixer.currentTime;
      gain.gain.setValueAtTime(volume, now);
      gain.gain.linearRampToValueAtTime(0, now + Math.max(0.05, seconds));
    },
    pause() {
      wanted = null; // and it doesn't start once it has loaded, either
      audio.pause();
    },
    stop() {
      stopped = true;
      audio.pause();
      mixer?.close?.().catch(() => null);
      audio.removeEventListener('loadedmetadata', play);
      if (url) URL.revokeObjectURL(url);
    },
  };
}
