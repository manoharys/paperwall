// The strip of pages along the bottom, and presenting pages full screen.

import { h, icon, iconButton, clear, debounce, dialog, toast, lazily, forget, pressable } from './ui.js';
import { renderPage, renderFrame } from '../model/render.js';
import { animationsEnd, keepsMoving, hasLoop, soundFade, pageDuration, pageFrame, transitionOf, timeline } from '../model/motion.js';
import { VideoFrames, videosOn, blobUrlFor } from './media.js';
import { measure } from './fonts.js';
import { visiblePages, pageName, pageLabel, soundtrackOf } from '../model/doc.js';

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
 * `only`: just the page in view, once (a preview of its motion, no soundtrack).
 */
export function present(editor, canvas, { autoplay = false, only = false } = {}) {
  const doc = editor.doc;
  const shown = only ? [editor.page] : visiblePages(doc);
  if (!shown.length) return toast('Every page is hidden. Show a page to present it.');
  // Start on the page in view, or the next visible one after it (the last
  // visible one if none come after).
  const next = shown.findIndex((k) => k >= editor.page);
  let at = next >= 0 ? next : shown.length - 1;
  const slide = h('div', { class: 'slide', 'data-testid': 'slide' });
  const counter = h('div', { class: 'slide-count' });
  const root = h('div', { class: 'presenter', 'data-testid': 'presenter', tabindex: '-1' }, slide, counter,
    h('button', { type: 'button', class: 'presenter-close', 'aria-label': 'Stop presenting', onClick: () => close() }, icon('close')));
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
  const shownScale = () => Math.min(window.innerWidth / doc.width, window.innerHeight / doc.height) * (window.devicePixelRatio || 1);
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
  let drawn = 0; // when the slide was last drawn
  let wait = 0; // a still page's timer, when playing
  let fading = 0; // when playing the last page: the soundtrack's fade-out, as downloads end
  let live = false; // the page's videos are playing in place: nothing to redraw
  const draw = (now) => {
    frame = 0;
    const i = shown[at];
    const page = doc.pages[i];
    const local = (now - started) / 1000;
    const tr = transitionOf(page);
    // Once only videos or looping animations move, 30 frames a second is plenty.
    const settled = local >= Math.max(info.end, from !== null ? tr.duration : 0);
    if (LIVE_VIDEO && settled && info.keeps && !info.loops && !live) {
      // Only videos move now: drawn once more, with each live video in its
      // own place in the slide (layered and clipped as designed), so no
      // picture is taken of them frame by frame.
      live = true;
      slide.innerHTML = renderFrame(doc, pageFrame(doc, i, local, null), { ...opts, idPrefix: `pr${i}`, videoSlots: true });
      for (const box of slide.querySelectorAll('foreignObject[data-video]')) {
        const v = videos.videoOf({ id: box.dataset.video });
        if (!v) continue;
        v.className = 'slide-video';
        box.append(v);
        // The picture under it goes once the video shows (it'd show through
        // a see-through video).
        const under = box.parentNode.querySelector(`image[data-under="${CSS.escape(box.dataset.video)}"]`);
        if (under) {
          if (v.readyState >= 2) under.remove();
          else v.addEventListener('loadeddata', () => under.remove(), { once: true });
        }
      }
    } else if (live) {
      // Nothing to draw: the videos play themselves.
    } else if (settled && info.keeps && now - drawn < 33 && drawn) {
      frame = requestAnimationFrame(draw);
      return;
    } else {
      drawn = now;
      // The same rule for transitions as downloads use.
      slide.innerHTML = renderFrame(doc, pageFrame(doc, i, local, from), { ...opts, idPrefix: `pr${i}` });
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
    const moving = local < Math.max(info.end, from !== null ? tr.duration : 0) || (info.keeps && !live && !ended);
    if (moving) frame = requestAnimationFrame(draw);
    else if (autoplay) {
      wait = setTimeout(() => {
        wait = 0;
        frame = requestAnimationFrame(draw);
      }, Math.max(0, (pageDuration(page) - local) * 1000));
    }
  };
  // `auto`: moving on by itself, when the sound is already in the right place.
  const go = (to, forward, { auto = false } = {}) => {
    cancelAnimationFrame(frame);
    clearTimeout(wait);
    clearTimeout(fading);
    from = forward && to !== at ? shown[at] : null;
    // Moving on by itself, the next page starts when the last one's time was
    // up (not a frame later), so pages keep time with the soundtrack.
    started = auto ? started + pageDuration(doc.pages[shown[at]]) * 1000 : performance.now();
    at = to;
    drawn = 0;
    live = false;
    const page = doc.pages[shown[at]];
    info = { end: animationsEnd(page), keeps: keepsMoving(page, doc.assets), loops: hasLoop(page), videos: videosOn(doc, [shown[at]]) };
    videos.pauseAll();
    videos.start(info.videos, started);
    // Back before the page Play started on: the sound starts over from there
    // (as if Play had started there), so later pages meet it where they did.
    if (tl.parts[at].start < soundFrom) soundFrom = tl.parts[at].start;
    if (!auto) sound?.seek(tl.parts[at].start - soundFrom);
    if (sound && at === shown.length - 1) {
      // The sound fades over the end, as in a download of these pages.
      const fade = soundFade(tl.total - soundFrom);
      fading = setTimeout(() => sound.fadeOut(fade), Math.max(0, started + (pageDuration(page) - fade) * 1000 - performance.now()));
    }
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
    if (to !== at) go(to, to === at + 1); // at either end, nothing happens (the page doesn't start over)
  };
  const close = () => {
    cancelAnimationFrame(frame);
    clearTimeout(wait);
    clearTimeout(fading);
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
    if (to !== at) go(to, to === at + 1);
  });
  document.addEventListener('keydown', onKey, true);
  document.body.append(root);
  go(at, false);
  root.focus();
  root.requestFullscreen?.().catch(() => null);
}

// Safari draws HTML inside SVG (the live video's place) without the page's
// moves, turns and clipping, so there videos are shown as pictures throughout.
// (Every browser on iPhones and iPads is Safari inside: any WebKit that isn't Chrome's Blink.)
const LIVE_VIDEO = typeof navigator === 'undefined' || !(/AppleWebKit/.test(navigator.userAgent) && !/Chrome\/|Chromium\//.test(navigator.userAgent));

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
      if (gain) {
        gain.gain.cancelScheduledValues(0); // back from any fade
        gain.gain.value = volume;
      }
      wanted = t;
      wantedAt = performance.now();
      if (audio.readyState >= 1) play();
    },
    /** Fade to silence over `seconds` (as downloads end). */
    fadeOut(seconds) {
      if (!gain) return;
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
