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

/** A video's size, length and a poster (a small JPEG of an early frame). */
export async function videoInfo(file) {
  const url = URL.createObjectURL(file);
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.preload = 'auto';
  try {
    v.src = url;
    await once(v, 'loadeddata');
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
    return { width: v.videoWidth || 640, height: v.videoHeight || 360, duration, poster: c.toDataURL('image/jpeg', 0.82) };
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
    URL.revokeObjectURL(url);
  }
}

/**
 * A blob: URL for a stored data: URL (much quicker for players than the long
 * string). The browser decodes it (fetch), not a byte-by-byte loop here.
 */
export async function blobUrlFor(dataUrl) {
  return URL.createObjectURL(await dataUrlBlob(dataUrl));
}

/** A stored data: URL as a Blob, decoded by the browser where it can. */
export async function dataUrlBlob(dataUrl) {
  try {
    return await (await fetch(dataUrl)).blob();
  } catch {
    return dataUrlToBlob(dataUrl); // where data: can't be fetched
  }
}

/**
 * The design's videos, ready to show at any moment: `seek` (for downloads,
 * exact) or `capture` (while playing, whatever frame is showing). Each gives a
 * data: URL of the picture, sized for the element.
 */
export class VideoFrames {
  constructor(doc) {
    this.doc = doc;
    // One player per element (two elements may show the same file from
    // different points): element id → { video, url, ready (resolves to whether it loaded) }.
    this.players = new Map();
    this.urls = new Map(); // assetId → blob: URL (made once, shared by the players of that file)
    this.canvas = document.createElement('canvas');
  }

  urlFor(assetId) {
    if (!this.urls.has(assetId)) {
      const asset = this.doc.assets[assetId];
      this.urls.set(assetId, asset ? blobUrlFor(asset.dataUrl) : Promise.resolve(''));
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
      ready: this.urlFor(el.assetId).then((url) => {
        if (!url || this.disposed) return false;
        video.src = url;
        return once(video, 'loadeddata').then(() => true, () => false);
      }).catch(() => false),
    };
    this.players.set(el.id, p);
    return p;
  }

  /** The picture of `el` at `local` seconds into its page, exactly (waits for the seek). Null if it can't be played here. */
  async seek(el, local) {
    const p = this.player(el);
    if (!(await p.ready)) return null; // the poster shows instead
    const v = p.video;
    const t = videoTime(el, local, this.lengthOf(el, v));
    if (Math.abs(v.currentTime - t) > 0.001) {
      const seeked = once(v, 'seeked', 'error', 5000).catch(() => null);
      v.currentTime = t;
      await seeked;
    }
    return this.grab(v, el);
  }

  /** Start the videos of a page playing, from where the page begins. */
  start(els) {
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
        v.currentTime = videoTime(el, 0, length);
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
    return p && p.video.readyState >= 2 ? this.grab(p.video, el, scale) : null;
  }

  grab(v, el, scale = 1.5) {
    if (!v.videoWidth) return null;
    // As sharp as it shows, but no sharper than the video.
    const s = Math.min(1, (Math.max(el.w, el.h) * scale) / Math.max(v.videoWidth, v.videoHeight));
    const c = this.canvas;
    c.width = Math.max(1, Math.round(v.videoWidth * s));
    c.height = Math.max(1, Math.round(v.videoHeight * s));
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.85);
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
    for (const url of this.urls.values()) url.then((u) => u && URL.revokeObjectURL(u), () => null);
    this.urls.clear();
  }
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
