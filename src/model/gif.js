// Animated GIFs, written from scratch and frame by frame (nothing but the
// last frame is kept): each frame is stored as just the box that changed,
// with its own palette of up to 256 colors (median cut) and a light ordered
// dither so gradients don't band. A still stretch costs nothing: the frame
// before just shows longer.

/** Writes a GIF as frames arrive: add(rgba, delayMs) for each, then finish() for the bytes. */
export class GifEncoder {
  constructor({ width, height, loop = 0, dither = true }) {
    Object.assign(this, { width, height, dither });
    this.out = new ByteWriter();
    this.prev = null; // the last frame's pixels (RGBA), to see what changed
    this.pending = null; // the last frame's box and pixels, written once its delay is known
    const o = this.out;
    o.text('GIF89a');
    o.u16(width);
    o.u16(height);
    o.byte(0x70); // no global palette: each frame brings its own
    o.byte(0);
    o.byte(0);
    // Loop forever (or `loop` times): the Netscape extension.
    o.bytes([0x21, 0xff, 0x0b]);
    o.text('NETSCAPE2.0');
    o.bytes([0x03, 0x01]);
    o.u16(loop);
    o.byte(0);
  }

  add(data, delay) {
    const box = this.prev ? changedBox(this.prev, data, this.width, this.height) : { x: 0, y: 0, w: this.width, h: this.height };
    if (!box) {
      if (this.pending) this.pending.delay += delay;
      return;
    }
    this.flush();
    // Just the box's pixels.
    const px = new Uint8ClampedArray(box.w * box.h * 4);
    for (let y = 0; y < box.h; y++) px.set(data.subarray(((box.y + y) * this.width + box.x) * 4, ((box.y + y) * this.width + box.x + box.w) * 4), y * box.w * 4);
    this.pending = { box, px, delay };
    this.prev = data.slice();
  }

  /** Write the frame held back (now that its delay is final). */
  flush() {
    const f = this.pending;
    if (!f) return;
    this.pending = null;
    const { box, px, delay } = f;
    const o = this.out;
    const palette = buildPalette([px], 256);
    const bits = Math.max(1, Math.ceil(Math.log2(Math.max(2, palette.length))));
    const map = paletteMapper(palette);
    const idx = indexFrame(px, box.w, box.h, map, this.dither, box.x, box.y);
    // Graphic control: keep what's there (only this box is drawn over it).
    o.bytes([0x21, 0xf9, 0x04, 0x04]);
    o.u16(Math.max(2, Math.round(delay / 10)));
    o.bytes([0x00, 0x00]);
    // The box, with its own palette.
    o.byte(0x2c);
    o.u16(box.x);
    o.u16(box.y);
    o.u16(box.w);
    o.u16(box.h);
    o.byte(0x80 | (bits - 1));
    for (let i = 0; i < 1 << bits; i++) {
      const c = palette[i] || [0, 0, 0];
      o.byte(c[0]);
      o.byte(c[1]);
      o.byte(c[2]);
    }
    const min = Math.max(2, bits);
    o.byte(min);
    const lzw = lzwEncode(min, idx);
    for (let i = 0; i < lzw.length; i += 255) {
      const n = Math.min(255, lzw.length - i);
      o.byte(n);
      o.bytes(lzw.subarray(i, i + n));
    }
    o.byte(0);
  }

  finish() {
    this.flush();
    this.out.byte(0x3b);
    return this.out.done();
  }
}

/** frames: [{ data: RGBA bytes (width × height), delay: ms }]. All at once; see GifEncoder. */
export function encodeGif(frames, opts) {
  if (!frames.length) throw new Error('A GIF needs at least one frame');
  const gif = new GifEncoder(opts);
  for (const f of frames) gif.add(f.data, f.delay);
  return gif.finish();
}

class ByteWriter {
  constructor() {
    this.buf = new Uint8Array(1 << 16);
    this.n = 0;
  }

  room(k) {
    if (this.n + k <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.n + k) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.n));
    this.buf = next;
  }

  byte(v) {
    this.room(1);
    this.buf[this.n++] = v & 255;
  }

  bytes(list) {
    this.room(list.length);
    this.buf.set(list, this.n);
    this.n += list.length;
  }

  u16(v) {
    this.byte(v & 255);
    this.byte((v >> 8) & 255);
  }

  text(s) {
    for (const c of s) this.byte(c.charCodeAt(0));
  }

  done() {
    return this.buf.slice(0, this.n);
  }
}

/** Up to `max` colors that stand for the frames well (median cut over a sample of pixels). */
export function buildPalette(datas, max = 256) {
  const total = datas.reduce((n, d) => n + d.length / 4, 0);
  const step = Math.max(1, Math.floor(total / 60000));
  const px = [];
  let k = 0;
  for (const d of datas) {
    for (let i = 0; i < d.length; i += 4, k++) if (k % step === 0) px.push((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
  }
  // Few colors (a flat design): use them as they are.
  const distinct = [...new Set(px)];
  if (distinct.length <= max) return distinct.map((c) => [(c >> 16) & 255, (c >> 8) & 255, c & 255]);
  // A box knows its widest channel and how much it would gain from a split,
  // worked out once when the box is made.
  const makeBox = (list) => {
    const lo = [255, 255, 255];
    const hi = [0, 0, 0];
    for (const c of list) {
      const r = (c >> 16) & 255;
      const g = (c >> 8) & 255;
      const b = c & 255;
      if (r < lo[0]) lo[0] = r;
      if (r > hi[0]) hi[0] = r;
      if (g < lo[1]) lo[1] = g;
      if (g > hi[1]) hi[1] = g;
      if (b < lo[2]) lo[2] = b;
      if (b > hi[2]) hi[2] = b;
    }
    const spans = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
    const ch = spans.indexOf(Math.max(...spans));
    return { list, ch, score: list.length < 2 ? 0 : spans[ch] * Math.sqrt(list.length) };
  };
  const boxes = [makeBox(px)];
  while (boxes.length < max) {
    // Split the box with the most spread (for its size) along its widest channel.
    let best = 0;
    for (let i = 1; i < boxes.length; i++) if (boxes[i].score > boxes[best].score) best = i;
    const box = boxes[best];
    if (box.score <= 0) break;
    const shift = 16 - box.ch * 8;
    const sorted = box.list.sort((x, y) => ((x >> shift) & 255) - ((y >> shift) & 255));
    const mid = sorted.length >> 1;
    boxes.splice(best, 1, makeBox(sorted.slice(0, mid)), makeBox(sorted.slice(mid)));
  }
  return boxes.filter((b) => b.list.length).map(({ list }) => {
    let r = 0;
    let g = 0;
    let bl = 0;
    for (const c of list) {
      r += (c >> 16) & 255;
      g += (c >> 8) & 255;
      bl += c & 255;
    }
    return [Math.round(r / list.length), Math.round(g / list.length), Math.round(bl / list.length)];
  });
}

/** Nearest palette color for an RGB color, remembered per 5-bit-per-channel cell. */
function paletteMapper(palette) {
  const cache = new Int16Array(32768).fill(-1);
  return (r, g, b) => {
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    let hit = cache[key];
    if (hit >= 0) return hit;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < palette.length; i++) {
      const c = palette[i];
      const d = (c[0] - r) ** 2 + (c[1] - g) ** 2 + (c[2] - b) ** 2;
      if (d < bestD) [best, bestD] = [i, d];
    }
    cache[key] = best;
    hit = best;
    return hit;
  };
}

// A 4×4 ordered dither: small, fixed nudges (the same in every frame, so
// still areas don't shimmer).
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v / 16 - 0.47) * 10);

/** Palette indexes for RGBA pixels. (ox, oy): where they sit, so the dither lines up across frames. */
function indexFrame(data, width, height, map, dither, ox = 0, oy = 0) {
  const idx = new Uint8Array(width * height);
  const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);
  for (let y = 0, p = 0; y < height; y++) {
    for (let x = 0; x < width; x++, p++) {
      const n = dither ? BAYER[(((y + oy) & 3) << 2) | ((x + ox) & 3)] : 0;
      const q = p * 4;
      idx[p] = map(clamp(data[q] + n), clamp(data[q + 1] + n), clamp(data[q + 2] + n));
    }
  }
  return idx;
}

/** The smallest box around every pixel that differs (RGBA), or null if none do. */
function changedBox(a, b, width, height) {
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  // Compared four bytes at a time.
  const a32 = new Uint32Array(a.buffer, a.byteOffset, width * height);
  const b32 = new Uint32Array(b.buffer, b.byteOffset, width * height);
  for (let y = 0, p = 0; y < height; y++) {
    for (let x = 0; x < width; x++, p++) {
      if (a32[p] !== b32[p]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** GIF's variable-length LZW, as the format describes it. */
export function lzwEncode(minCodeSize, indices) {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  let nextCode = eoiCode + 1;
  let codeSize = minCodeSize + 1;
  let table = new Map();
  const out = new ByteWriter();
  let cur = 0;
  let shift = 0;
  const emit = (code) => {
    cur |= code << shift;
    shift += codeSize;
    while (shift >= 8) {
      out.byte(cur & 255);
      cur >>>= 8;
      shift -= 8;
    }
  };
  emit(clearCode);
  if (!indices.length) {
    emit(eoiCode);
    if (shift > 0) out.byte(cur & 255);
    return out.done();
  }
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = (prefix << 8) | k;
    const code = table.get(key);
    if (code !== undefined) {
      prefix = code;
      continue;
    }
    emit(prefix);
    if (nextCode === 4096) {
      emit(clearCode);
      nextCode = eoiCode + 1;
      codeSize = minCodeSize + 1;
      table = new Map();
    } else {
      if (nextCode >= 1 << codeSize) codeSize++;
      table.set(key, nextCode++);
    }
    prefix = k;
  }
  emit(prefix);
  emit(eoiCode);
  if (shift > 0) out.byte(cur & 255);
  return out.done();
}
