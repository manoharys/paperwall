// Downloads that move: animated GIF and video (MP4 or WebM). Frames are
// drawn from the same renderer as everything else, one moment at a time, and
// encoded on this device: GIFs by our own encoder, video by the browser's
// (WebCodecs) into files we put together ourselves.

import { renderFrame } from '../model/render.js';
import { timeline, frameAt, soundFade, animationsEnd, hasLoop, videosIn, animationOf } from '../model/motion.js';
import { hasDefaultFilters } from '../model/doc.js';
import { maskPath } from '../model/shapes.js';
import { GifEncoder } from '../model/gif.js';
import { buildWebmParts } from '../model/webm.js';
import { buildMp4Parts } from '../model/mp4.js';
import { measure, fontCssFor } from './fonts.js';
import { loadImage } from './ui.js';
import { VideoFrames, videosOn, shrinkPictures, pictureShares } from './media.js';
import { t } from './i18n.js';

/** A copy of what an encoder hands over as bytes (an ArrayBuffer or a view of one). */
function bytesOf(d) {
  return ArrayBuffer.isView(d) ? new Uint8Array(d.buffer, d.byteOffset, d.byteLength).slice() : new Uint8Array(d.slice(0));
}

const NO_AVC_DESCRIPTION = 'motion.noAvc';

/** Frames per second for each kind of download. */
export const FPS = { gif: 15, video: 30 };

/** How big frames are: GIFs stay small to share; video up to 1080p-ish (even sides, as H.264 needs). */
export function frameSize(doc, kind, wanted = null) {
  const longest = Math.max(doc.width, doc.height);
  const target = wanted || (kind === 'gif' ? 720 : 1920);
  const s = Math.min(1, target / longest);
  const even = (v) => Math.max(2, Math.round((v * s) / 2) * 2);
  return { width: even(doc.width), height: even(doc.height), scale: s };
}

/**
 * Draw every frame of the design playing, calling `each(canvas, ctx, i,
 * timeSeconds, same)` in order (`same`: the picture hasn't changed since the
 * frame before). `pages` are the page indexes to play.
 */
async function eachFrame(doc0, pages, { fps, width, height, onProgress, signal, readBack = false }, each) {
  const tl = timeline(doc0, pages);
  if (!tl.parts.length) throw new Error(t('export.pickPage'));
  // Big photos made only as big as the frames can show, once, rather than
  // decoded at full size for every frame.
  const doc = await fittedPictures(doc0, pages, width);
  const count = Math.max(1, Math.round(tl.total * fps));
  // Fonts of just the pages being played (each frame carries them).
  const fontCss = await fontCssFor({ ...doc, pages: pages.map((i) => doc.pages[i]) });
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  // GIFs read every frame's pixels back (kept on the CPU for that); videos
  // hand the canvas to the encoder as it is.
  const ctx = canvas.getContext('2d', { willReadFrequently: !!readBack });
  // Videos on the pages are shown frame by frame, each at its exact moment.
  const videos = videosOn(doc, pages).length ? new VideoFrames(doc) : null;
  let last = null; // the last frame's picture, as SVG: a still moment isn't drawn again
  let lastIndex = -1; // the page the last frame showed, settled (nothing on it can change), or -1
  // Page index → { still: when its animations are over, settled: when
  // nothing on it moves, videos included } (Infinity if never).
  const timesOf = new Map();
  const pageTimes = (index) => {
    if (!timesOf.has(index)) {
      // Never with a loop; with videos that play once, when the last has ended.
      const page = doc.pages[index];
      const still = hasLoop(page) ? Infinity : animationsEnd(page);
      let settled = still;
      for (const el of videosIn(page, doc.assets)) {
        const length = doc.assets[el.assetId].duration || 0;
        settled = Math.max(settled, el.loop === false && length > 0 ? Math.max(0, length - (el.trim?.start || 0)) + 0.1 : Infinity);
      }
      timesOf.set(index, { still, settled });
    }
    return timesOf.get(index);
  };
  const onPage = new Map(); // page index → its videos (worked out once)
  const videosOf = (index) => {
    if (!onPage.has(index)) onPage.set(index, videosOn(doc, [index]));
    return onPage.get(index);
  };
  // Once only its videos move, a page is drawn from layers: what's between
  // its videos, drawn once, and each video's picture straight from its player.
  const layered = new Map(); // page index → its layers, or null (drawn whole each frame)
  // A page's layers go once frames move past it (pages come one after another).
  const release = (keep = -1) => {
    for (const [index, layers] of layered) {
      if (index === keep) continue;
      for (const layer of layers?.list || []) {
        if (layer.canvas) layer.canvas.width = layer.canvas.height = 0;
      }
      layered.delete(index);
    }
  };
  const layersOf = async (frame) => {
    release(frame.index);
    if (frame.from || frame.local < pageTimes(frame.index).still) return null;
    // (Drawn at the first such moment: the same at any later one.)
    if (!layered.has(frame.index)) layered.set(frame.index, await stillLayers(doc, frame, { fontCss, width, height }));
    return layered.get(frame.index);
  };
  try {
    for (let i = 0; i < count; i++) {
      if (signal?.aborted) throw new Error('Stopped');
      const time = i / fps;
      const frame = frameAt(doc, tl, time);
      // A settled page shown again: the same picture, without drawing it.
      const settled = !frame.from && frame.local >= pageTimes(frame.index).settled;
      if (settled && lastIndex === frame.index) {
        await each(canvas, ctx, i, time, true);
        onProgress?.((i + 1) / count);
        continue;
      }
      const layers = videos ? await layersOf(frame) : null;
      let ready = null; // video id → whether its player is at this frame already (tried for the layers)
      if (layers) {
        const players = await Promise.all(layers.videos.map((el) => videos.at(el, frame.local)));
        ready = new Map(layers.videos.map((el, k) => [el.id, !!players[k]]));
        // (A video that can't be followed here shows its still: the whole frame drawn, below.)
        if (players.every(Boolean)) {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, width, height);
          let k = 0;
          for (const layer of layers.list) {
            if (layer.el) drawVideo(ctx, players[k++], layer.el, width / doc.width, height / doc.height);
            else ctx.drawImage(layer.canvas, 0, 0, width, height);
          }
          last = null;
          lastIndex = settled ? frame.index : -1;
          await each(canvas, ctx, i, time, false);
          onProgress?.((i + 1) / count);
          continue;
        }
      }
      const pictures = new Map();
      if (videos) {
        // Each video has its own player: they all seek at once.
        const wanted = [[frame.index, frame.local], ...(frame.from ? [[frame.from.index, frame.from.local]] : [])]
          .flatMap(([index, local]) => videosOf(index).map((el) => [el, local]));
        // (Not sent there again when it was just tried: there already, or stuck and showing its poster.)
        const got = await Promise.all(wanted.map(([el, local]) => (ready?.has(el.id) && local === frame.local
          ? (ready.get(el.id) ? videos.picture(el, width / doc.width) : null)
          : videos.seek(el, local, width / doc.width))));
        wanted.forEach(([el], k) => pictures.set(el.id, got[k]));
      }
      // Drawn at the frame's own size, not the design's (a print-size page needn't be rasterized big).
      const svg = renderFrame(doc, frame, { measure, fontCss, scale: width / doc.width, idPrefix: 'mv', videoFrame: (el) => pictures.get(el.id) });
      const same = svg === last;
      if (!same) await drawFrame(svg, { ctx, width, height });
      last = svg;
      lastIndex = settled ? frame.index : -1;
      await each(canvas, ctx, i, time, same);
      onProgress?.((i + 1) / count);
    }
  } finally {
    release();
    videos?.dispose();
  }
  return { count, total: tl.total, stuck: !!videos?.stuck };
}

/**
 * The design with each picture made only as big as it shows in frames
 * `width` px wide (a little more, for smooth scaling; a zoomed-in crop
 * counts as the whole picture shown bigger). A copy: the design itself
 * keeps its pictures.
 */
async function fittedPictures(doc, pages, width) {
  const shares = pictureShares(doc, pages, width / doc.width);
  // (A little bigger than it shows, for smooth scaling.)
  return shrinkPictures(doc, new Map([...shares].map(([id, share]) => [id, share * 1.25])));
}

/** One frame (the page(s) at their moment, as SVG) into the canvas (on white, unless `clear`). */
async function drawFrame(svg, { ctx, width, height, clear = false }) {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = await loadImage(url);
    if (img.decode) await img.decode().catch(() => null);
    if (!clear) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
    }
    ctx.drawImage(img, 0, 0, width, height);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Whether a video is drawn just as a picture is: no filters, shadow or animation of its own (those need the whole frame drawn). */
function plainVideo(page, el) {
  return hasDefaultFilters(el) && !el.shadow && !animationOf(page, el);
}

/**
 * A page at a moment when only its videos move (its animations are over,
 * and none loop), as layers: what's below, between and above its videos,
 * each drawn once, with its videos in between. { videos, list: [{ canvas }
 * | { el }] }, or null when it can't be drawn so (a video in a group, or
 * with filters).
 */
async function stillLayers(doc, frame, { fontCss, width, height }) {
  const page = doc.pages[frame.index];
  const videos = page.elements.filter((el) => el.type === 'video' && !el.hidden && doc.assets[el.assetId]);
  if (!videos.length || videosIn(page, doc.assets).length !== videos.length || !videos.every((el) => plainVideo(page, el))) return null;
  const list = [];
  let run = [];
  const flush = async () => {
    if (!run.length) return;
    const shown = new Set(run.map((el) => el.id));
    const skip = new Set(page.elements.filter((el) => !shown.has(el.id)).map((el) => el.id));
    const svg = renderFrame(doc, frame, { measure, fontCss, scale: width / doc.width, idPrefix: `ly${list.length}`, skip, transparent: list.length > 0 });
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    await drawFrame(svg, { ctx: canvas.getContext('2d'), width, height, clear: true });
    list.push({ canvas });
    run = [];
  };
  for (const el of page.elements) {
    if (!videos.includes(el)) run.push(el);
    else {
      await flush();
      // (The white and the page's background always come first.)
      if (!list.length) list.push({ canvas: await backdrop(doc, frame, { fontCss, width, height }) });
      list.push({ el });
    }
  }
  await flush();
  return { videos, list };
}

/** Just the white and the page's background. */
async function backdrop(doc, frame, { fontCss, width, height }) {
  const page = doc.pages[frame.index];
  const svg = renderFrame(doc, frame, { measure, fontCss, scale: width / doc.width, idPrefix: 'lyb', skip: new Set(page.elements.map((el) => el.id)) });
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  await drawFrame(svg, { ctx: canvas.getContext('2d'), width, height });
  return canvas;
}

/** A video's picture straight onto the frame: placed, turned, cropped and clipped to its shape as the renderer does. `kx`, `ky`: frame px per page px across and down (the frame is rounded to even sizes, as the layers are stretched to). */
function drawVideo(ctx, v, el, kx, ky) {
  const crop = el.crop || { x: 0, y: 0, w: 1, h: 1 };
  const iw = el.w / crop.w;
  const ih = el.h / crop.h;
  ctx.save();
  ctx.scale(kx, ky);
  ctx.translate(el.x + el.w / 2, el.y + el.h / 2);
  if (el.rotation) ctx.rotate((el.rotation * Math.PI) / 180);
  ctx.scale(el.flipX ? -1 : 1, el.flipY ? -1 : 1);
  ctx.translate(-el.w / 2, -el.h / 2);
  ctx.globalAlpha = el.opacity ?? 1;
  ctx.clip(new Path2D(maskPath(el)));
  ctx.drawImage(v, -crop.x * iw, -crop.y * ih, iw, ih);
  ctx.restore();
}

/** The design as an animated GIF. */
const STUCK = 'motion.stuck';

export async function exportGif(doc, pages, { size = null, onProgress, onNote, signal } = {}) {
  const { width, height } = frameSize(doc, 'gif', size);
  const fps = FPS.gif;
  const gif = new GifEncoder({ width, height });
  // GIF delays are whole hundredths of a second: each frame gets its share of
  // the clock, rounded, so the whole GIF keeps time (no drift).
  const at = (i) => Math.round((i * 100) / fps) * 10;
  const { stuck } = await eachFrame(doc, pages, { fps, width, height, onProgress, signal, readBack: true }, (canvas, ctx, i, time, same) => {
    if (same && i > 0) return gif.hold(at(i + 1) - at(i));
    gif.add(ctx.getImageData(0, 0, width, height).data, at(i + 1) - at(i));
  });
  if (stuck) onNote?.(t(STUCK));
  return new Blob([gif.finish()], { type: 'image/gif' });
}

/** Wait while more than `max` items wait in an encoder (told by its dequeue event where it has one). */
async function drain(encoder, max) {
  while (encoder.encodeQueueSize > max) {
    await new Promise((r) => ('ondequeue' in encoder ? encoder.addEventListener('dequeue', r, { once: true }) : setTimeout(r, 5)));
  }
}

/** Whether this browser can make videos (it encodes them itself). */
export function canMakeVideo() {
  return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
}

/** The best video encoding this browser offers for a container, or null. */
async function pickVideoCodec(container, width, height) {
  // VP9 level 4.0 holds frames up to about 2.2 megapixels; bigger ones need 5.0.
  const vp9 = width * height > 2228224 ? 'vp09.00.50.08' : 'vp09.00.40.08';
  const tries = container === 'mp4'
    // H.264 at level 5.1 first (big frames, up to 4K), then 4.0 and 3.1 for smaller encoders.
    ? [['avc', 'avc1.640033'], ['avc', 'avc1.640028'], ['avc', 'avc1.4d0028'], ['avc', 'avc1.42001f'], ['vp9', vp9]]
    : [['vp9', vp9], ['vp8', 'vp8']];
  // H.264 levels by how many 16×16 blocks a frame may have: 3.1, 4.0, 5.1.
  const blocks = Math.ceil(width / 16) * Math.ceil(height / 16);
  const AVC_MAX = { '1f': 3600, 28: 8192, 33: 36864 };
  for (const [codec, codecString] of tries) {
    if (codec === 'avc' && blocks > AVC_MAX[codecString.slice(-2)]) continue;
    const config = { codec: codecString, width, height, bitrate: Math.round(width * height * 30 * 0.12), framerate: FPS.video, ...(codec === 'avc' ? { avc: { format: 'avc' } } : {}) };
    try {
      if ((await VideoEncoder.isConfigSupported(config)).supported) return { codec, codecString, config };
    } catch {
      /* not this one */
    }
  }
  return null;
}

/**
 * The design as a video: 'mp4' or 'webm'. `audio` (optional) is a soundtrack
 * as an AudioBuffer (or a function giving one, called once the video is
 * known to be possible here), cut to the video's length. `onNote(message)` hears about
 * anything left out (a soundtrack this browser can't encode).
 */
export async function exportVideo(doc, pages, { container = 'mp4', size = null, audio = null, volume = 1, onProgress, onNote, signal } = {}) {
  if (!canMakeVideo()) throw new Error(t('export.noVideo'));
  const { width, height } = frameSize(doc, 'video', size);
  const pick = await pickVideoCodec(container, width, height);
  if (!pick) throw new Error(t('motion.noFormat', { format: container.toUpperCase(), other: container === 'mp4' ? 'WebM' : 'MP4' }));
  // The soundtrack is decoded only now that the video can be made.
  if (typeof audio === 'function') audio = await audio();
  const fps = FPS.video;
  const chunks = [];
  let description = null;
  let failure = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      chunks.push({ data, timestamp: chunk.timestamp, duration: chunk.duration ?? 1e6 / fps, key: chunk.type === 'key' });
      if (meta?.decoderConfig?.description && !description) description = bytesOf(meta.decoderConfig.description);
    },
    error: (e) => (failure = e),
  });
  encoder.configure(pick.config);
  let total;
  let stuck = false;
  try {
    ({ total, stuck } = await eachFrame(doc, pages, { fps, width, height, onProgress, signal }, async (canvas, ctx, i) => {
      if (failure) throw failure;
      const frame = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
      // A key frame every two seconds, so players can jump around.
      encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
      frame.close();
      await drain(encoder, 4);
      // H.264 for MP4 needs the encoder's description, which comes with its
      // first output: without it, say so now rather than after every frame.
      if (pick.codec === 'avc' && chunks.length && !description) throw new Error(t(NO_AVC_DESCRIPTION));
    }));
    // (An encoder that failed at the very end has closed: its own error says why.)
    if (failure) throw failure;
    await encoder.flush().catch((e) => {
      throw failure || e;
    });
  } finally {
    // Encoders are a limited resource: always given back, even when a download fails.
    if (encoder.state !== 'closed') encoder.close();
  }
  if (failure) throw failure;
  if (pick.codec === 'avc' && !description) throw new Error(t(NO_AVC_DESCRIPTION));
  if (stuck) onNote?.(t(STUCK));
  let sound = null;
  if (audio) {
    // The pictures are done: a sound that won't encode leaves a silent video, not nothing.
    sound = await encodeAudio(audio, total, container, volume, signal).catch((e) => {
      if (signal?.aborted) throw e;
      return null;
    });
    if (!sound) onNote?.(t('motion.silent'));
  }
  const video = { codec: pick.codec, codecString: pick.codecString, width, height, description, chunks };
  const parts = container === 'mp4' ? buildMp4Parts({ video, audio: sound, duration: total }) : buildWebmParts({ video, audio: sound, duration: total });
  return new Blob(parts, { type: container === 'mp4' ? 'video/mp4' : 'video/webm' });
}

/** A soundtrack, encoded for the container (Opus; AAC in MP4 where the browser has it). */
async function encodeAudio(buffer, seconds, container, volume = 1, signal = null) {
  if (typeof AudioEncoder === 'undefined') return null;
  const sampleRate = 48000;
  const channels = Math.min(2, buffer.numberOfChannels);
  const tries = container === 'mp4' ? [['aac', 'mp4a.40.2'], ['opus', 'opus']] : [['opus', 'opus']];
  let pick = null;
  for (const [codec, codecString] of tries) {
    const config = { codec: codecString, sampleRate, numberOfChannels: channels, bitrate: 128000 };
    try {
      if ((await AudioEncoder.isConfigSupported(config)).supported) {
        pick = { codec, config };
        break;
      }
    } catch {
      /* not this one */
    }
  }
  if (!pick) return null;
  // Resampled to 48 kHz, cut to the video's length, with a short fade at the end.
  const frames = Math.round(seconds * sampleRate);
  const offline = new OfflineAudioContext(channels, frames, sampleRate);
  const src = offline.createBufferSource();
  src.buffer = buffer;
  const gain = offline.createGain();
  const fade = soundFade(seconds);
  gain.gain.setValueAtTime(volume, 0);
  gain.gain.setValueAtTime(volume, Math.max(0, seconds - fade));
  gain.gain.linearRampToValueAtTime(0, seconds);
  src.connect(gain).connect(offline.destination);
  src.start();
  const pcm = await offline.startRendering();
  const chunks = [];
  let description = null;
  let failure = null;
  const encoder = new AudioEncoder({
    output: (chunk, meta) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      chunks.push({ data, timestamp: chunk.timestamp, duration: chunk.duration ?? null, key: true });
      if (meta?.decoderConfig?.description && !description) description = bytesOf(meta.decoderConfig.description);
    },
    error: (e) => (failure = e),
  });
  encoder.configure(pick.config);
  try {
    const block = 4800; // 0.1 s at a time
    for (let at = 0; at < frames; at += block) {
      if (signal?.aborted) throw new Error('Stopped');
      // A breath now and then, so the page stays responsive (and can be stopped).
      if (at % (block * 50) === 0) await new Promise((r) => setTimeout(r, 0));
      if (failure) throw failure; // (as with video: the encoder's own error)
      const n = Math.min(block, frames - at);
      const planar = new Float32Array(n * channels);
      for (let c = 0; c < channels; c++) planar.set(pcm.getChannelData(c).subarray(at, at + n), c * n);
      const data = new AudioData({ format: 'f32-planar', sampleRate, numberOfFrames: n, numberOfChannels: channels, timestamp: Math.round((at / sampleRate) * 1e6), data: planar });
      encoder.encode(data);
      data.close();
      await drain(encoder, 8);
    }
    if (failure) throw failure;
    await encoder.flush().catch((e) => {
      throw failure || e;
    });
  } finally {
    if (encoder.state !== 'closed') encoder.close();
  }
  if (failure) throw failure;
  // Some encoders leave a packet's length out: it runs until the next one
  // (the last as long as a usual packet: 20 ms of Opus, 1024 AAC samples).
  const usual = pick.codec === 'opus' ? 20000 : (1024 * 1e6) / sampleRate;
  chunks.forEach((c, i) => {
    if (!(c.duration > 0)) c.duration = i + 1 < chunks.length ? chunks[i + 1].timestamp - c.timestamp : usual;
  });
  return { codec: pick.codec, sampleRate, channels, description, codecPrivate: pick.codec === 'opus' ? description : null, chunks };
}
