// Reading TrueType fonts (and their WOFF and WOFF2 wrappings) and making a
// subset with just the letters a PDF uses. Written from the OpenType, WOFF
// and WOFF2 specs.

import { brotliDecode } from './brotli.js';
import { inflate } from './deflate.js';

const tagOf = (b, p) => String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3]);

// WOFF2's table tags, by their number in the directory.
const KNOWN_TAGS = ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT',
  'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH', 'CBDT', 'CBLC',
  'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar', 'gvar', 'hsty', 'just', 'lcar',
  'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill'];

/** A cursor over big-endian bytes. */
class Reader {
  constructor(bytes, pos = 0) {
    this.b = bytes;
    this.pos = pos;
  }
  u8() {
    if (this.pos >= this.b.length) throw new Error('Font file ends too soon');
    return this.b[this.pos++];
  }
  u16() {
    return (this.u8() << 8) | this.u8();
  }
  i16() {
    const v = this.u16();
    return v & 0x8000 ? v - 0x10000 : v;
  }
  u32() {
    return ((this.u16() << 16) | this.u16()) >>> 0;
  }
  bytes(n) {
    if (this.pos + n > this.b.length) throw new Error('Font file ends too soon');
    const out = this.b.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
  base128() {
    let v = 0;
    for (let i = 0; i < 5; i++) {
      const c = this.u8();
      if (i === 0 && c === 0x80) throw new Error('Bad WOFF2 number');
      v = v * 128 + (c & 0x7f);
      if (!(c & 0x80)) return v;
    }
    throw new Error('Bad WOFF2 number');
  }
  u255() {
    const c = this.u8();
    if (c === 253) return this.u16();
    if (c === 255) return this.u8() + 253;
    if (c === 254) return this.u8() + 506;
    return c;
  }
}

/** Grows as bytes are written; big-endian numbers. */
class Writer {
  constructor(size = 1024) {
    this.b = new Uint8Array(size);
    this.n = 0;
  }
  room(k) {
    if (this.n + k <= this.b.length) return;
    const bigger = new Uint8Array(Math.max(this.b.length * 2, this.n + k));
    bigger.set(this.b.subarray(0, this.n));
    this.b = bigger;
  }
  u8(v) {
    this.room(1);
    this.b[this.n++] = v & 0xff;
  }
  u16(v) {
    this.u8(v >> 8);
    this.u8(v);
  }
  u32(v) {
    this.u16(v >>> 16);
    this.u16(v & 0xffff);
  }
  bytes(a) {
    this.room(a.length);
    this.b.set(a, this.n);
    this.n += a.length;
  }
  pad4() {
    while (this.n % 4) this.u8(0);
  }
  done() {
    return this.b.slice(0, this.n);
  }
}

function checksum(bytes) {
  let sum = 0;
  for (let i = 0; i < bytes.length; i += 4) {
    sum = (sum + (((bytes[i] << 24) | ((bytes[i + 1] || 0) << 16) | ((bytes[i + 2] || 0) << 8) | (bytes[i + 3] || 0)) >>> 0)) >>> 0;
  }
  return sum;
}

/** A font file from tables: { tag: bytes }. */
export function writeSfnt(tables, flavor = 0x00010000) {
  const tags = Object.keys(tables).sort();
  const n = tags.length;
  let pow = 1;
  let log = 0;
  while (pow * 2 <= n) {
    pow *= 2;
    log++;
  }
  const w = new Writer(12 + n * 16 + tags.reduce((s, t) => s + tables[t].length + 3, 0));
  w.u32(flavor);
  w.u16(n);
  w.u16(pow * 16);
  w.u16(log);
  w.u16(n * 16 - pow * 16);
  let offset = 12 + n * 16;
  for (const t of tags) {
    for (let i = 0; i < 4; i++) w.u8(t.charCodeAt(i));
    w.u32(t === 'head' ? checksum(zeroAdjustment(tables[t])) : checksum(tables[t]));
    w.u32(offset);
    w.u32(tables[t].length);
    offset += (tables[t].length + 3) & ~3;
  }
  let headAt = -1;
  for (const t of tags) {
    if (t === 'head') headAt = w.n;
    w.bytes(t === 'head' ? zeroAdjustment(tables[t]) : tables[t]);
    w.pad4();
  }
  const out = w.done();
  if (headAt >= 0 && tables.head.length >= 12) {
    const adj = (0xb1b0afba - checksum(out)) >>> 0;
    out[headAt + 8] = adj >>> 24;
    out[headAt + 9] = (adj >>> 16) & 0xff;
    out[headAt + 10] = (adj >>> 8) & 0xff;
    out[headAt + 11] = adj & 0xff;
  }
  return out;
}

function zeroAdjustment(head) {
  const h = head.slice();
  if (h.length >= 12) h.fill(0, 8, 12);
  return h;
}

// ---------- unwrapping ----------

/** The tables of a font file (TrueType, OpenType, WOFF or WOFF2) as { tag: bytes }, plus its flavor. */
export function readTables(bytes) {
  const sig = tagOf(bytes, 0);
  if (sig === 'wOF2') return readWoff2(bytes);
  if (sig === 'wOFF') return readWoff(bytes);
  if (sig === 'ttcf') throw new Error('Font collections are not supported');
  const r = new Reader(bytes);
  const flavor = r.u32();
  if (flavor !== 0x00010000 && sig !== 'true' && sig !== 'OTTO') throw new Error('Not a font file');
  const n = r.u16();
  r.pos = 12;
  const tables = {};
  for (let i = 0; i < n; i++) {
    const tag = tagOf(bytes, r.pos);
    r.pos += 8;
    const off = r.u32();
    const len = r.u32();
    if (off + len > bytes.length) throw new Error('Font file is damaged');
    tables[tag] = bytes.subarray(off, off + len);
  }
  return { flavor, tables };
}

function readWoff(bytes) {
  const r = new Reader(bytes, 4);
  const flavor = r.u32();
  r.u32(); // length
  const n = r.u16();
  r.pos = 44;
  const tables = {};
  for (let i = 0; i < n; i++) {
    const tag = tagOf(bytes, r.pos);
    r.pos += 4;
    const off = r.u32();
    const comp = r.u32();
    const orig = r.u32();
    r.u32(); // checksum
    const data = bytes.subarray(off, off + comp);
    tables[tag] = comp < orig ? inflate(data) : data;
    if (tables[tag].length !== orig) throw new Error('Font file is damaged');
  }
  return { flavor, tables };
}

function readWoff2(bytes) {
  const r = new Reader(bytes, 4);
  const flavor = r.u32();
  if (flavor === 0x74746366) throw new Error('Font collections are not supported');
  r.u32(); // length
  const n = r.u16();
  r.u16(); // reserved
  r.u32(); // totalSfntSize
  const compressed = r.u32();
  r.pos = 48;
  const dir = [];
  for (let i = 0; i < n; i++) {
    const flags = r.u8();
    const tag = (flags & 63) === 63 ? tagOf(bytes, (r.pos += 4) - 4) : KNOWN_TAGS[flags & 63];
    const version = flags >> 6;
    const orig = r.base128();
    // glyf and loca are transformed unless version is 3; others only if not 0.
    const transformed = tag === 'glyf' || tag === 'loca' ? version === 0 : version !== 0;
    const length = transformed ? r.base128() : orig;
    dir.push({ tag, orig, length, transformed });
  }
  const data = brotliDecode(bytes.subarray(r.pos, r.pos + compressed));
  const raw = {};
  let at = 0;
  for (const t of dir) {
    raw[t.tag] = data.subarray(at, at + t.length);
    at += t.length;
  }
  const tables = {};
  for (const t of dir) if (!t.transformed) tables[t.tag] = raw[t.tag];
  const glyf = dir.find((t) => t.tag === 'glyf');
  if (glyf?.transformed) {
    const { glyf: g, loca, xMins } = untransformGlyf(raw.glyf, tables.head);
    tables.glyf = g;
    tables.loca = loca;
    const hmtx = dir.find((t) => t.tag === 'hmtx');
    if (hmtx?.transformed) tables.hmtx = untransformHmtx(raw.hmtx, tables.hhea, xMins);
  } else if (dir.find((t) => t.tag === 'hmtx')?.transformed) throw new Error('Font file is damaged');
  return { flavor, tables };
}

// Simple glyph flags.
const ON_CURVE = 1;
const X_SHORT = 2;
const Y_SHORT = 4;
const REPEAT = 8;
const X_SAME = 16;
const Y_SAME = 32;
const OVERLAP = 64;

/** One point's movement from WOFF2's triplet encoding. */
function triplet(flag, r) {
  const sign = (f, v) => (f & 1 ? v : -v);
  if (flag < 10) return [0, sign(flag, ((flag & 14) << 7) + r.u8())];
  if (flag < 20) return [sign(flag, (((flag - 10) & 14) << 7) + r.u8()), 0];
  if (flag < 84) {
    const b0 = flag - 20;
    const b1 = r.u8();
    return [sign(flag, 1 + (b0 & 0x30) + (b1 >> 4)), sign(flag >> 1, 1 + ((b0 & 0x0c) << 2) + (b1 & 0x0f))];
  }
  if (flag < 120) {
    const b0 = flag - 84;
    const x = r.u8();
    const y = r.u8();
    return [sign(flag, 1 + (Math.floor(b0 / 12) << 8) + x), sign(flag >> 1, 1 + (((b0 % 12) >> 2) << 8) + y)];
  }
  if (flag < 124) {
    const a = r.u8();
    const b = r.u8();
    const c = r.u8();
    return [sign(flag, (a << 4) + (b >> 4)), sign(flag >> 1, ((b & 0x0f) << 8) + c)];
  }
  const a = r.u16();
  const b = r.u16();
  return [sign(flag, a), sign(flag >> 1, b)];
}

/** A simple glyph in TrueType's own layout. */
function writeSimple(w, ends, pts, bbox, instructions, overlap) {
  w.u16(ends.length);
  for (const v of bbox) w.u16(v & 0xffff);
  for (const e of ends) w.u16(e);
  w.u16(instructions.length);
  w.bytes(instructions);
  const flags = [];
  const xs = [];
  const ys = [];
  let px = 0;
  let py = 0;
  pts.forEach(([x, y, on], i) => {
    let fl = on ? ON_CURVE : 0;
    if (i === 0 && overlap) fl |= OVERLAP;
    const dx = x - px;
    const dy = y - py;
    if (dx === 0) fl |= X_SAME;
    else if (Math.abs(dx) < 256) {
      fl |= X_SHORT | (dx > 0 ? X_SAME : 0);
      xs.push([Math.abs(dx), 1]);
    } else xs.push([dx, 2]);
    if (dy === 0) fl |= Y_SAME;
    else if (Math.abs(dy) < 256) {
      fl |= Y_SHORT | (dy > 0 ? Y_SAME : 0);
      ys.push([Math.abs(dy), 1]);
    } else ys.push([dy, 2]);
    flags.push(fl);
    px = x;
    py = y;
  });
  for (let i = 0; i < flags.length;) {
    let run = 1;
    while (i + run < flags.length && flags[i + run] === flags[i] && run < 256) run++;
    if (run > 1) {
      w.u8(flags[i] | REPEAT);
      w.u8(run - 1);
    } else w.u8(flags[i]);
    i += run;
  }
  for (const [v, n] of xs) n === 1 ? w.u8(v) : w.u16(v & 0xffff);
  for (const [v, n] of ys) n === 1 ? w.u8(v) : w.u16(v & 0xffff);
}

/** WOFF2's transformed glyf table back to glyf and loca (WOFF2 spec, section 5). */
function untransformGlyf(data, head) {
  const r = new Reader(data);
  r.u16(); // reserved
  const options = r.u16();
  const numGlyphs = r.u16();
  const indexFormat = r.u16();
  const sizes = [];
  for (let i = 0; i < 7; i++) sizes.push(r.u32());
  let at = r.pos;
  const streams = sizes.map((s) => {
    const sub = new Reader(data.subarray(at, at + s));
    at += s;
    return sub;
  });
  const [nContours, nPoints, flagS, glyphS, compS, bboxS, instrS] = streams;
  const bitmapLen = 4 * Math.floor((numGlyphs + 31) / 32);
  const bboxBits = bboxS.bytes(bitmapLen);
  const overlapBits = options & 1 ? data.subarray(at, at + ((numGlyphs + 7) >> 3)) : null;
  const w = new Writer(data.length * 2);
  const offsets = [];
  const xMins = new Int16Array(numGlyphs);
  for (let g = 0; g < numGlyphs; g++) {
    offsets.push(w.n);
    const nc = nContours.i16();
    const hasBox = bboxBits[g >> 3] & (0x80 >> (g & 7));
    if (nc === 0) {
      if (hasBox) throw new Error('Font file is damaged');
      continue;
    }
    if (nc > 0) {
      const ends = [];
      let total = 0;
      for (let c = 0; c < nc; c++) {
        total += nPoints.u255();
        ends.push(total - 1);
      }
      const pts = [];
      let x = 0;
      let y = 0;
      for (let p = 0; p < total; p++) {
        const flag = flagS.u8();
        const [dx, dy] = triplet(flag & 0x7f, glyphS);
        x += dx;
        y += dy;
        pts.push([x, y, !(flag & 0x80)]);
      }
      const instructions = instrS.bytes(glyphS.u255());
      let bbox;
      if (hasBox) bbox = [bboxS.i16(), bboxS.i16(), bboxS.i16(), bboxS.i16()];
      else {
        bbox = [Infinity, Infinity, -Infinity, -Infinity];
        for (const [px, py] of pts) {
          bbox[0] = Math.min(bbox[0], px);
          bbox[1] = Math.min(bbox[1], py);
          bbox[2] = Math.max(bbox[2], px);
          bbox[3] = Math.max(bbox[3], py);
        }
        if (!pts.length) bbox = [0, 0, 0, 0];
      }
      xMins[g] = bbox[0];
      writeSimple(w, ends, pts, bbox, instructions, overlapBits && overlapBits[g >> 3] & (0x80 >> (g & 7)));
    } else {
      // A composite: its parts are copied as they are.
      if (!hasBox) throw new Error('Font file is damaged');
      const bbox = [bboxS.i16(), bboxS.i16(), bboxS.i16(), bboxS.i16()];
      xMins[g] = bbox[0];
      const start = compS.pos;
      let more = true;
      let instr = false;
      while (more) {
        const flags = compS.u16();
        compS.u16(); // glyph
        compS.pos += flags & 1 ? 4 : 2;
        if (flags & 8) compS.pos += 2;
        else if (flags & 0x40) compS.pos += 4;
        else if (flags & 0x80) compS.pos += 8;
        more = !!(flags & 0x20);
        if (flags & 0x100) instr = true;
      }
      w.u16(0xffff);
      for (const v of bbox) w.u16(v & 0xffff);
      w.bytes(compS.b.subarray(start, compS.pos));
      if (instr) {
        const instructions = instrS.bytes(glyphS.u255());
        w.u16(instructions.length);
        w.bytes(instructions);
      }
    }
    w.pad4();
  }
  offsets.push(w.n);
  const long = indexFormat || (head && new Reader(head, 50).i16() === 1);
  const loca = new Writer((numGlyphs + 1) * 4);
  for (const o of offsets) long ? loca.u32(o) : loca.u16(o / 2);
  return { glyf: w.done(), loca: loca.done(), xMins };
}

function untransformHmtx(data, hhea, xMins) {
  const r = new Reader(data);
  const flags = r.u8();
  const numH = new Reader(hhea, 34).u16();
  const numGlyphs = xMins.length;
  const adv = [];
  for (let i = 0; i < numH; i++) adv.push(r.u16());
  const lsb = [];
  for (let i = 0; i < numH; i++) lsb.push(flags & 1 ? xMins[i] : r.i16());
  for (let i = numH; i < numGlyphs; i++) lsb.push(flags & 2 ? xMins[i] : r.i16());
  const w = new Writer(numH * 4 + (numGlyphs - numH) * 2);
  for (let i = 0; i < numGlyphs; i++) {
    if (i < numH) w.u16(adv[i]);
    w.u16(lsb[i] & 0xffff);
  }
  return w.done();
}

// ---------- reading ----------

function readCmap(t) {
  const map = new Map();
  if (!t) return map;
  const r = new Reader(t);
  r.u16();
  const n = r.u16();
  const subs = [];
  for (let i = 0; i < n; i++) subs.push({ platform: r.u16(), encoding: r.u16(), offset: r.u32() });
  // Prefer full Unicode, then the basic plane, then old Mac Roman.
  const rank = (s) => (s.platform === 3 && s.encoding === 10 ? 0 : s.platform === 0 && s.encoding >= 4 ? 1 : s.platform === 3 && s.encoding === 1 ? 2 : s.platform === 0 ? 3 : s.platform === 3 && s.encoding === 0 ? 4 : 9);
  subs.sort((a, b) => rank(a) - rank(b));
  for (const s of subs) {
    if (rank(s) === 9) continue;
    const sr = new Reader(t, s.offset);
    const format = sr.u16();
    if (format === 4) {
      sr.u16();
      sr.u16();
      const segs = sr.u16() / 2;
      sr.pos += 6;
      const base = sr.pos;
      const end = (i) => new Reader(t, base + i * 2).u16();
      const start = (i) => new Reader(t, base + segs * 2 + 2 + i * 2).u16();
      const delta = (i) => new Reader(t, base + segs * 4 + 2 + i * 2).i16();
      const rangeAt = base + segs * 6 + 2;
      for (let i = 0; i < segs; i++) {
        const a = start(i);
        const b = end(i);
        const d = delta(i);
        const ro = new Reader(t, rangeAt + i * 2).u16();
        for (let c = a; c <= b && c !== 0xffff; c++) {
          let g;
          if (!ro) g = (c + d) & 0xffff;
          else {
            const p = rangeAt + i * 2 + ro + (c - a) * 2;
            g = p + 1 < t.length ? new Reader(t, p).u16() : 0;
            if (g) g = (g + d) & 0xffff;
          }
          if (g && !map.has(c)) map.set(c, g);
        }
      }
    } else if (format === 12) {
      sr.u16();
      sr.u32();
      sr.u32();
      const groups = sr.u32();
      for (let i = 0; i < groups; i++) {
        const a = sr.u32();
        const b = sr.u32();
        const g = sr.u32();
        for (let c = a; c <= b && c - a < 0x10000; c++) if (!map.has(c)) map.set(c, g + c - a);
      }
    } else if (format === 0) {
      sr.u16();
      sr.u16();
      for (let c = 0; c < 256; c++) {
        const g = sr.u8();
        if (g && !map.has(c)) map.set(c, g);
      }
    } else if (format === 6) {
      sr.u16();
      sr.u16();
      const first = sr.u16();
      const count = sr.u16();
      for (let i = 0; i < count; i++) {
        const g = sr.u16();
        if (g && !map.has(first + i)) map.set(first + i, g);
      }
    }
  }
  return map;
}

function psName(t) {
  if (!t) return null;
  const r = new Reader(t);
  r.u16();
  const n = r.u16();
  const strOff = r.u16();
  for (let i = 0; i < n; i++) {
    const platform = r.u16();
    const encoding = r.u16();
    r.u16();
    const id = r.u16();
    const len = r.u16();
    const off = r.u16();
    if (id !== 6) continue;
    const raw = t.subarray(strOff + off, strOff + off + len);
    let s = '';
    if (platform === 3 || platform === 0) for (let k = 0; k + 1 < raw.length; k += 2) s += String.fromCharCode((raw[k] << 8) | raw[k + 1]);
    else if (platform === 1 && encoding === 0) s = String.fromCharCode(...raw);
    s = s.replace(/[^\x21-\x7e]/g, '').replace(/[[\](){}<>/%#]/g, '');
    if (s) return s;
  }
  return null;
}

/**
 * A font ready for embedding: its tables, how many units an em has, each
 * glyph's advance, which glyph each character is, and the metrics a PDF
 * font descriptor wants. Throws for fonts it can't embed.
 */
export function parseFont(bytes) {
  const { flavor, tables } = readTables(bytes);
  if (!tables.glyf || !tables.loca) throw new Error(tables['CFF '] ? 'Fonts with PostScript outlines are not supported' : 'This font has no outlines');
  for (const t of ['head', 'hhea', 'hmtx', 'maxp']) if (!tables[t]) throw new Error('Font file is damaged');
  const head = new Reader(tables.head);
  head.pos = 18;
  const unitsPerEm = head.u16() || 1000;
  head.pos = 36;
  const bbox = [head.i16(), head.i16(), head.i16(), head.i16()];
  const macStyle = head.u16();
  head.pos = 50;
  const longLoca = head.i16() === 1;
  const numGlyphs = new Reader(tables.maxp, 4).u16();
  const hhea = new Reader(tables.hhea, 4);
  let ascent = hhea.i16();
  let descent = hhea.i16();
  const numH = new Reader(tables.hhea, 34).u16();
  const hm = new Reader(tables.hmtx);
  const advances = new Uint16Array(numGlyphs);
  let last = 0;
  for (let g = 0; g < numGlyphs; g++) {
    if (g < numH) {
      last = hm.u16();
      hm.u16();
    }
    advances[g] = last;
  }
  let capHeight = ascent * 0.7;
  let weightClass = 400;
  let fsType = 0;
  if (tables['OS/2'] && tables['OS/2'].length >= 72) {
    const os2 = new Reader(tables['OS/2']);
    os2.pos = 4;
    weightClass = os2.u16();
    os2.pos = 8;
    fsType = os2.u16();
    os2.pos = 68;
    const typoAsc = os2.i16();
    const typoDesc = os2.i16();
    if (typoAsc) {
      ascent = typoAsc;
      descent = typoDesc;
    }
    if (tables['OS/2'].length >= 90 && new Reader(tables['OS/2']).u16() >= 2) capHeight = new Reader(tables['OS/2'], 88).i16() || capHeight;
  }
  let italicAngle = 0;
  let fixed = false;
  if (tables.post && tables.post.length >= 16) {
    const post = new Reader(tables.post, 4);
    const whole = post.i16();
    italicAngle = whole + post.u16() / 65536;
    post.pos = 12;
    fixed = post.u32() !== 0;
  }
  const loca = new Reader(tables.loca);
  const offsets = new Uint32Array(numGlyphs + 1);
  for (let g = 0; g <= numGlyphs; g++) offsets[g] = longLoca ? loca.u32() : loca.u16() * 2;
  return {
    flavor,
    tables,
    unitsPerEm,
    bbox,
    ascent,
    descent,
    capHeight,
    italicAngle,
    weightClass,
    fixed,
    bold: !!(macStyle & 1),
    // Bit 1 alone: the license doesn't allow embedding.
    restricted: (fsType & 0x0f) === 2,
    numGlyphs,
    advances,
    offsets,
    cmap: readCmap(tables.cmap),
    name: psName(tables.name) || 'Font',
  };
}

/** The glyph for a character, or 0 (the "missing" box). */
export function glyphFor(font, cp) {
  return font.cmap.get(cp) || 0;
}

/** Glyphs a composite glyph is made of. */
function parts(font, g) {
  const { glyf } = font.tables;
  const a = font.offsets[g];
  const b = font.offsets[g + 1];
  if (b - a < 10) return [];
  const r = new Reader(glyf, a);
  if (r.i16() >= 0) return [];
  r.pos = a + 10;
  const out = [];
  let more = true;
  while (more && r.pos < b) {
    const flags = r.u16();
    out.push(r.u16());
    r.pos += flags & 1 ? 4 : 2;
    if (flags & 8) r.pos += 2;
    else if (flags & 0x40) r.pos += 4;
    else if (flags & 0x80) r.pos += 8;
    more = !!(flags & 0x20);
  }
  return out;
}

/**
 * A copy of the font with only these glyphs drawn (glyph numbers stay the
 * same, so a PDF can use them directly); every other glyph is left empty.
 */
export function subsetFont(font, glyphs) {
  const keep = new Set([0, ...glyphs]);
  for (const g of [...keep]) {
    const stack = [g];
    while (stack.length) {
      for (const p of parts(font, stack.pop())) {
        if (p < font.numGlyphs && !keep.has(p)) {
          keep.add(p);
          stack.push(p);
        }
      }
    }
  }
  const { glyf } = font.tables;
  const w = new Writer(1024);
  const loca = new Writer((font.numGlyphs + 1) * 4);
  for (let g = 0; g < font.numGlyphs; g++) {
    loca.u32(w.n);
    if (!keep.has(g)) continue;
    w.bytes(glyf.subarray(font.offsets[g], font.offsets[g + 1]));
    w.pad4();
  }
  loca.u32(w.n);
  const head = font.tables.head.slice();
  head[50] = 0;
  head[51] = 1; // long offsets
  const tables = { head, glyf: w.done(), loca: loca.done() };
  for (const t of ['hhea', 'hmtx', 'maxp', 'cvt ', 'fpgm', 'prep', 'cmap', 'OS/2', 'post', 'name']) if (font.tables[t]) tables[t] = font.tables[t];
  return writeSfnt(tables);
}
