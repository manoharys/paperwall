// Videos and sounds: reading them in (size, length, a poster frame), and
// turning a video's picture at a moment into an image the renderer can draw,
// for playing, presenting and downloading.

import { videoTime } from '../model/doc.js';
import { dataUrlToBlob } from './ui.js';

const LIMITS = { video: 60e6, audio: 25e6 };

/** What kind of media a file is: 'image', 'video', 'audio', or null. */
export function mediaKind(file) {
  const t = file.type || '';
  if (t.startsWith('image/')) return 'image';
  if (t.startsWith('video/')) return 'video';
  if (t.startsWith('audio/')) return 'audio';
  return null;
}

/** Refuse files too big to keep inside a design (they're stored with it). */
export function checkSize(file, kind) {
  const max = LIMITS[kind];
  if (max && file.size > max) throw new Error(`${file.name} is too big: up to ${max / 1e6} MB for ${kind === 'video' ? 'videos' : 'sounds'}.`);
}

function once(target, ok, bad = 'error', ms = 15000) {
  return new Promise((resolve, reject) => {
    const done = (fn, v) => {
      clearTimeout(timer);
      target.removeEventListener(ok, onOk);
      target.removeEventListener(bad, onBad);
      fn(v);
    };
    const onOk = () => done(resolve);
    const onBad = () => done(reject, new Error("This file can't be played in this browser"));
    const timer = setTimeout(() => done(reject, new Error('The file took too long to open')), ms);
    target.addEventListener(ok, onOk);
    target.addEventListener(bad, onBad);
  });
}

/**
 * Wait for a video's first picture. iPhones and iPads load nothing until a
 * video plays: a muted one may play by itself, so it's asked to, and stopped
 * as soon as there's a picture.
 */
async function firstPicture(v) {
  v.autoplay = true;
  try {
    await once(v, 'loadeddata');
  } finally {
    v.autoplay = false;
    v.pause();
  }
}

/** A video's size, length and a poster (a small JPEG of an early frame). */
export async function videoInfo(file) {
  const url = URL.createObjectURL(file);
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.preload = 'auto';
  try {
    v.src = url;
    await firstPicture(v);
    // Some recordings (from a browser's recorder, say) don't say how long they
    // are until the player has been to the end: send it there to find out.
    if (!Number.isFinite(v.duration)) {
      const known = once(v, 'durationchange', 'error', 5000).catch(() => null);
      v.currentTime = 1e101;
      await known;
    }
    const duration = Number.isFinite(v.duration) ? v.duration : 0;
    v.currentTime = Math.min(0.2, duration / 2 || 0);
    await once(v, 'seeked').catch(() => null);
    const s = Math.min(1, 640 / Math.max(v.videoWidth, v.videoHeight, 1));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(v.videoWidth * s));
    c.height = Math.max(1, Math.round(v.videoHeight * s));
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
    // `sound`: a file with no picture at all (music saved as .webm or .mp4).
    if (!v.videoWidth || !v.videoHeight) return { sound: true, duration };
    return { width: v.videoWidth, height: v.videoHeight, duration, poster: c.toDataURL('image/jpeg', 0.82) };
  } finally {
    v.removeAttribute('src');
    v.load();
    URL.revokeObjectURL(url);
  }
}

/** A sound's length. */
export async function audioInfo(file) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('audio');
  a.preload = 'metadata';
  try {
    a.src = url;
    await once(a, 'loadedmetadata');
    return { duration: Number.isFinite(a.duration) ? a.duration : 0 };
  } finally {
    a.removeAttribute('src');
    a.load();
    URL.revokeObjectURL(url);
  }
}

/** A blob: URL for a stored data: URL (much quicker for players than the long string). */
// (Not by fetch: the page's security policy allows no fetching at all, data: included.)
export function blobUrlFor(dataUrl) {
  return URL.createObjectURL(dataUrlToBlob(dataUrl));
}

/**
 * The design's videos, ready to show at any moment: `seek` (for downloads,
 * exact) or `capture` (while playing, whatever frame is showing). Each gives a
 * data: URL of the picture, sized for the element.
 */
export class VideoFrames {
  /** `hrefFor(assetId)`: a blob: URL kept elsewhere (the canvas's), used instead of making another. */
  constructor(doc, { hrefFor = null } = {}) {
    this.doc = doc;
    this.hrefFor = hrefFor;
    // One player per element (two elements may show the same file from
    // different points): element id → { video, url, ready (resolves to whether it loaded) }.
    this.players = new Map();
    this.urls = new Map(); // assetId → blob: URL (made once, shared by the players of that file)
    this.canvas = document.createElement('canvas');
  }

  urlFor(assetId) {
    if (!this.urls.has(assetId)) {
      const asset = this.doc.assets[assetId];
      let url = '';
      try {
        url = asset ? this.hrefFor?.(assetId) || blobUrlFor(asset.dataUrl) : '';
        if (url && url === this.hrefFor?.(assetId)) this.borrowed = (this.borrowed || new Set()).add(url);
      } catch {
        /* a damaged file: its poster shows */
      }
      this.urls.set(assetId, url);
    }
    return this.urls.get(assetId);
  }

  player(el) {
    let p = this.players.get(el.id);
    if (p) return p;
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    p = {
      video,
      // Resolves to whether it can play here; a damaged file just shows its poster.
      ready: Promise.resolve().then(() => {
        if (this.disposed) return false; // (no file made for a player already let go)
        const url = this.urlFor(el.assetId);
        if (!url) return false;
        video.src = url;
        return firstPicture(video).then(() => {
          p.alpha = seeThrough(video);
          return true;
        }, () => false);
      }).catch(() => false),
    };
    this.players.set(el.id, p);
    return p;
  }

  /**
   * The picture of `el` at `local` seconds into its page, exactly (waits for
   * the seek), at `scale` (output px per page px). Null if it can't be played here.
   */
  async seek(el, local, scale = 1.5) {
    const p = this.player(el);
    if (!(await p.ready)) return null; // the poster shows instead
    const v = p.video;
    const t = videoTime(el, local, this.lengthOf(el, v));
    if (Math.abs(v.currentTime - t) > 0.001) {
      const seeked = once(v, 'seeked', 'error', 5000).catch(() => null);
      v.currentTime = t;
      await seeked;
    }
    return this.grab(p, el, scale);
  }

  /**
   * Start the videos of a page playing, in time with the page: `since` is
   * when the page began (performance.now()), so a video that takes a while
   * to load joins where the page is by then.
   */
  start(els, since = performance.now()) {
    const turn = (this.turn = (this.turn || 0) + 1);
    for (const el of els) {
      const p = this.player(el);
      p.ready.then((ok) => {
        // Not if the page was left (or playing stopped) while it loaded.
        if (!ok || turn !== this.turn) return;
        const v = p.video;
        // Looping goes back to the start point (as downloads do), not to 0.
        v.loop = false;
        const length = this.lengthOf(el, v);
        v.onended = el.loop === false ? null : () => {
          v.currentTime = videoTime(el, 0, length);
          v.play().catch(() => null);
        };
        v.currentTime = videoTime(el, Math.max(0, (performance.now() - since) / 1000), length);
        v.play().catch(() => null);
      });
    }
  }

  /** How long `el`'s video is: the player's word, else what was found when it was added. */
  lengthOf(el, v) {
    return Number.isFinite(v.duration) ? v.duration : this.doc.assets[el.assetId]?.duration || 0;
  }

  /** The `<video>` playing `el`, once one has been made for it (to show it live). */
  videoOf(el) {
    return this.players.get(el.id)?.video || null;
  }

  /** Whatever `el`'s video is showing now, at `scale` (screen px per page px). */
  capture(el, scale = 1.5) {
    const p = this.players.get(el.id);
    return p && p.video.readyState >= 2 ? this.grab(p, el, scale) : null;
  }

  grab({ video: v, alpha }, el, scale = 1.5) {
    if (!v.videoWidth) return null;
    // As sharp as it shows (cropped, the whole video shows bigger than the
    // element), but no sharper than the video.
    const crop = el.crop || { w: 1, h: 1 };
    const s = Math.min(1, Math.max((el.w / (crop.w || 1)) * scale / v.videoWidth, (el.h / (crop.h || 1)) * scale / v.videoHeight));
    const c = this.canvas;
    c.width = Math.max(1, Math.round(v.videoWidth * s));
    c.height = Math.max(1, Math.round(v.videoHeight * s));
    const g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height);
    g.drawImage(v, 0, 0, c.width, c.height);
    // A see-through video keeps its see-through parts (WebP, or PNG where
    // there's no WebP); the rest are JPEGs, much quicker to make.
    return alpha ? c.toDataURL('image/webp', 0.85) : c.toDataURL('image/jpeg', 0.85);
  }

  pauseAll() {
    this.turn = (this.turn || 0) + 1; // videos still loading won't start after this
    for (const { video } of this.players.values()) video.pause();
  }

  dispose() {
    this.disposed = true;
    for (const { video } of this.players.values()) {
      video.pause();
      video.removeAttribute('src');
      video.load();
    }
    this.players.clear();
    for (const url of this.urls.values()) if (url && !this.borrowed?.has(url)) URL.revokeObjectURL(url);
    this.urls.clear();
  }
}

/** Whether a video's first picture has see-through parts. */
function seeThrough(v) {
  try {
    const c = document.createElement('canvas');
    c.width = 16;
    c.height = 16;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(v, 0, 0, 16, 16);
    const d = g.getImageData(0, 0, 16, 16).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] < 250) return true;
  } catch {
    /* can't tell: as most videos, solid */
  }
  return false;
}

/** Every video element on the given pages (inside groups too). */
export function videosOn(doc, pageIndexes) {
  const out = [];
  const walk = (els) => {
    for (const el of els) {
      if (el.hidden) continue;
      if (el.type === 'video' && doc.assets[el.assetId]) out.push(el);
      if (el.type === 'group') walk(el.children);
    }
  };
  for (const i of pageIndexes) if (doc.pages[i]) walk(doc.pages[i].elements);
  return out;
}
