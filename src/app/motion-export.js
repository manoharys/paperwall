// Downloads that move: animated GIF and video (MP4 or WebM). Frames are
// drawn from the same renderer as everything else, one moment at a time, and
// encoded on this device: GIFs by our own encoder, video by the browser's
// (WebCodecs) into files we put together ourselves.

import { renderFrame } from '../model/render.js';
import { timeline, frameAt } from '../model/motion.js';
import { GifEncoder } from '../model/gif.js';
import { buildWebm } from '../model/webm.js';
import { buildMp4 } from '../model/mp4.js';
import { measure, fontCssFor } from './fonts.js';
import { loadImage } from './ui.js';
import { VideoFrames, videosOn } from './media.js';

/** A copy of what an encoder hands over as bytes (an ArrayBuffer or a view of one). */
function bytesOf(d) {
  return ArrayBuffer.isView(d) ? new Uint8Array(d.buffer, d.byteOffset, d.byteLength).slice() : new Uint8Array(d.slice(0));
}

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
 * Draw every frame of the design playing, calling `each(canvas, i, timeSeconds)`
 * in order. `pages` are the page indexes to play.
 */
async function eachFrame(doc, pages, { fps, width, height, onProgress, signal }, each) {
  const tl = timeline(doc, pages);
  const count = Math.max(1, Math.round(tl.total * fps));
  const fontCss = await fontCssFor(doc);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  // Videos on the pages are shown frame by frame, each at its exact moment.
  const videos = videosOn(doc, pages).length ? new VideoFrames(doc) : null;
  try {
    for (let i = 0; i < count; i++) {
      if (signal?.aborted) throw new Error('Stopped');
      const t = i / fps;
      const frame = frameAt(doc, tl, t);
      const pictures = new Map();
      if (videos) {
        for (const [index, local] of [[frame.index, frame.local], ...(frame.from ? [[frame.from.index, frame.from.local]] : [])]) {
          for (const el of videosOn(doc, [index])) pictures.set(el.id, await videos.seek(el, local));
        }
      }
      await drawFrame(doc, frame, pictures, { fontCss, ctx, width, height });
      await each(canvas, ctx, i, t);
      onProgress?.((i + 1) / count);
    }
  } finally {
    videos?.dispose();
  }
  return { count, total: tl.total };
}

/** One frame into the canvas: the page(s) at their moment, videos at theirs. */
async function drawFrame(doc, frame, pictures, { fontCss, ctx, width, height }) {
  const svg = renderFrame(doc, frame, { measure, fontCss, idPrefix: 'mv', videoFrame: (el) => pictures.get(el.id) });
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = await loadImage(url);
    if (img.decode) await img.decode().catch(() => null);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** The design as an animated GIF. */
export async function exportGif(doc, pages, { size = null, onProgress, signal } = {}) {
  const { width, height } = frameSize(doc, 'gif', size);
  const fps = FPS.gif;
  const gif = new GifEncoder({ width, height });
  // GIF delays are whole hundredths of a second: each frame gets its share of
  // the clock, rounded, so the whole GIF keeps time (no drift).
  const at = (i) => Math.round((i * 100) / fps) * 10;
  await eachFrame(doc, pages, { fps, width, height, onProgress, signal }, (canvas, ctx, i) => {
    gif.add(ctx.getImageData(0, 0, width, height).data, at(i + 1) - at(i));
  });
  return new Blob([gif.finish()], { type: 'image/gif' });
}

/** Whether this browser can make videos (it encodes them itself). */
export function canMakeVideo() {
  return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
}

/** The best video encoding this browser offers for a container, or null. */
async function pickVideoCodec(container, width, height) {
  const tries = container === 'mp4'
    // H.264 at level 5.1 first (big frames, up to 4K), then 4.0 and 3.1 for smaller encoders.
    ? [['avc', 'avc1.640033'], ['avc', 'avc1.640028'], ['avc', 'avc1.4d0028'], ['avc', 'avc1.42001f'], ['vp9', 'vp09.00.40.08']]
    : [['vp9', 'vp09.00.40.08'], ['vp8', 'vp8']];
  for (const [codec, codecString] of tries) {
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
 * as an AudioBuffer, cut to the video's length.
 */
export async function exportVideo(doc, pages, { container = 'mp4', size = null, audio = null, volume = 1, onProgress, signal } = {}) {
  if (!canMakeVideo()) throw new Error("This browser can't make videos. Try a recent Chrome, Edge, Safari or Firefox.");
  const { width, height } = frameSize(doc, 'video', size);
  const pick = await pickVideoCodec(container, width, height);
  if (!pick) throw new Error(`This browser can't make ${container.toUpperCase()} videos. Try ${container === 'mp4' ? 'WebM' : 'MP4'} instead.`);
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
  const { total } = await eachFrame(doc, pages, { fps, width, height, onProgress, signal }, async (canvas, ctx, i) => {
    if (failure) throw failure;
    const frame = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
    // A key frame every two seconds, so players can jump around.
    encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
    frame.close();
    while (encoder.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 5));
  });
  await encoder.flush();
  encoder.close();
  if (failure) throw failure;
  const sound = audio ? await encodeAudio(audio, total, container, volume) : null;
  const video = { codec: pick.codec, codecString: pick.codecString, width, height, description, chunks };
  const bytes = container === 'mp4' ? buildMp4({ video, audio: sound, duration: total }) : buildWebm({ video, audio: sound, duration: total });
  return new Blob([bytes], { type: container === 'mp4' ? 'video/mp4' : 'video/webm' });
}

/** A soundtrack, encoded for the container (Opus; AAC in MP4 where the browser has it). */
async function encodeAudio(buffer, seconds, container, volume = 1) {
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
  const fade = Math.min(1, seconds / 4);
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
      chunks.push({ data, timestamp: chunk.timestamp, duration: chunk.duration, key: true });
      if (meta?.decoderConfig?.description && !description) description = bytesOf(meta.decoderConfig.description);
    },
    error: (e) => (failure = e),
  });
  encoder.configure(pick.config);
  const block = 4800; // 0.1 s at a time
  for (let at = 0; at < frames; at += block) {
    const n = Math.min(block, frames - at);
    const planar = new Float32Array(n * channels);
    for (let c = 0; c < channels; c++) planar.set(pcm.getChannelData(c).subarray(at, at + n), c * n);
    const data = new AudioData({ format: 'f32-planar', sampleRate, numberOfFrames: n, numberOfChannels: channels, timestamp: Math.round((at / sampleRate) * 1e6), data: planar });
    encoder.encode(data);
    data.close();
  }
  await encoder.flush();
  encoder.close();
  if (failure) throw failure;
  return { codec: pick.codec, sampleRate, channels, description, codecPrivate: pick.codec === 'opus' ? description : null, chunks };
}
