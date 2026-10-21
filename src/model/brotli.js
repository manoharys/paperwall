// A Brotli decoder (RFC 7932), written from the spec. WOFF2 font files are
// Brotli-compressed; the vector PDF needs the fonts' own outlines to embed.

import { BitReader, prefixCode, readSymbol, inflate } from './deflate.js';
import { BROTLI_DICTIONARY } from './brotli-dict.js';

// ---------- the static dictionary (RFC 7932, appendix A) ----------

// Words of each length (4..24) come in 2^NDBITS[length] entries.
const NDBITS = [0, 0, 0, 0, 10, 10, 11, 11, 10, 10, 10, 10, 10, 9, 9, 8, 7, 7, 8, 7, 7, 6, 6, 5, 5];
const DOFFSET = [];
for (let l = 0, at = 0; l <= 24; l++) {
  DOFFSET[l] = at;
  if (l >= 4) at += l << NDBITS[l];
}

let dict = null;
/** The dictionary's 122,784 bytes, unpacked the first time a stream uses it. */
function dictionary() {
  if (!dict) {
    const bin = atob(BROTLI_DICTIONARY);
    const packed = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) packed[i] = bin.charCodeAt(i);
    dict = inflate(packed, { raw: true });
    if (dict.length !== 122784) throw new Error('Brotli dictionary is damaged');
  }
  return dict;
}

// Word transforms (appendix B): [prefix, kind, suffix]. Kinds: 0 identity,
// 1..9 omit the last n bytes, 10 uppercase the first letter, 11 uppercase
// all, 12..20 omit the first n - 11 bytes.
const I = 0;
const UF = 10;
const UA = 11;
const OL = (n) => n;
const OF = (n) => 11 + n;
const TRANSFORMS = [
  ['', I, ''], ['', I, ' '], [' ', I, ' '], ['', OF(1), ''], ['', UF, ' '], ['', I, ' the '], [' ', I, ''], ['s ', I, ' '],
  ['', I, ' of '], ['', UF, ''], ['', I, ' and '], ['', OF(2), ''], ['', OL(1), ''], [', ', I, ' '], ['', I, ', '], [' ', UF, ' '],
  ['', I, ' in '], ['', I, ' to '], ['e ', I, ' '], ['', I, '"'], ['', I, '.'], ['', I, '">'], ['', I, '\n'], ['', OL(3), ''],
  ['', I, ']'], ['', I, ' for '], ['', OF(3), ''], ['', OL(2), ''], ['', I, ' a '], ['', I, ' that '], [' ', UF, ''], ['', I, '. '],
  ['.', I, ''], [' ', I, ', '], ['', OF(4), ''], ['', I, ' with '], ['', I, "'"], ['', I, ' from '], ['', I, ' by '], ['', OF(5), ''],
  ['', OF(6), ''], [' the ', I, ''], ['', OL(4), ''], ['', I, '. The '], ['', UA, ''], ['', I, ' on '], ['', I, ' as '], ['', I, ' is '],
  ['', OL(7), ''], ['', OL(1), 'ing '], ['', I, '\n\t'], ['', I, ':'], [' ', I, '. '], ['', I, 'ed '], ['', OF(9), ''], ['', OF(7), ''],
  ['', OL(6), ''], ['', I, '('], ['', UF, ', '], ['', OL(8), ''], ['', I, ' at '], ['', I, 'ly '], [' the ', I, ' of '], ['', OL(5), ''],
  ['', OL(9), ''], [' ', UF, ', '], ['', UF, '"'], ['.', I, '('], ['', UA, ' '], ['', UF, '">'], ['', I, '="'], [' ', I, '.'],
  ['.com/', I, ''], [' the ', I, ' of the '], ['', UF, "'"], ['', I, '. This '], ['', I, ','], ['.', I, ' '], ['', UF, '('], ['', UF, '.'],
  ['', I, ' not '], [' ', I, '="'], ['', I, 'er '], [' ', UA, ' '], ['', I, 'al '], [' ', UA, ''], ['', I, "='"], ['', UA, '"'],
  ['', UF, '. '], [' ', I, '('], ['', I, 'ful '], [' ', UF, '. '], ['', I, 'ive '], ['', I, 'less '], ['', UA, "'"], ['', I, 'est '],
  [' ', UF, '.'], ['', UA, '">'], [' ', I, "='"], ['', UF, ','], ['', I, 'ize '], ['', UA, '.'], ['\xc2\xa0', I, ''], [' ', I, ','],
  ['', UF, '="'], ['', UA, '="'], ['', I, 'ous '], ['', UA, ', '], ['', UF, "='"], [' ', UF, ','], [' ', UA, '="'], [' ', UA, ', '],
  ['', UA, ','], ['', UA, '('], ['', UA, '. '], [' ', UA, '.'], ['', UA, "='"], [' ', UA, '. '], [' ', UF, '="'], [' ', UA, "='"],
  [' ', UF, "='"],
].map(([p, kind, s]) => [Uint8Array.from(p, (c) => c.charCodeAt(0)), kind, Uint8Array.from(s, (c) => c.charCodeAt(0))]);

/** Uppercase the UTF-8 character at w[i] the way the spec says; returns its length. */
function upper(w, i) {
  if (w[i] < 0xc0) {
    if (w[i] >= 97 && w[i] <= 122) w[i] ^= 32;
    return 1;
  }
  if (w[i] < 0xe0) {
    if (i + 1 < w.length) w[i + 1] ^= 32;
    return 2;
  }
  if (i + 2 < w.length) w[i + 2] ^= 5;
  return 3;
}

/** A dictionary word of `len` bytes, transformed. */
export function dictionaryWord(len, index, transform) {
  const d = dictionary();
  const [prefix, kind, suffix] = TRANSFORMS[transform];
  const start = DOFFSET[len] + index * len;
  let word = d.slice(start, start + len);
  if (kind >= 1 && kind <= 9) word = word.slice(0, Math.max(0, len - kind));
  else if (kind >= 12) word = word.slice(Math.min(len, kind - 11));
  else if (kind === UF && word.length) upper(word, 0);
  else if (kind === UA) for (let i = 0; i < word.length;) i += upper(word, i);
  const out = new Uint8Array(prefix.length + word.length + suffix.length);
  out.set(prefix);
  out.set(word, prefix.length);
  out.set(suffix, prefix.length + word.length);
  return out;
}

// ---------- tables ----------

// Block counts: [base, extra bits] for each of the 26 codes.
const BLOCK_LEN = [[1, 2], [5, 2], [9, 2], [13, 2], [17, 3], [25, 3], [33, 3], [41, 3], [49, 4], [65, 4], [81, 4], [97, 4], [113, 5],
  [145, 5], [177, 5], [209, 5], [241, 6], [305, 6], [369, 7], [497, 8], [753, 9], [1265, 10], [2289, 11], [4337, 12], [8433, 13], [16625, 24]];
// Insert and copy lengths: [base, extra bits] for each of the 24 codes.
const INSERT_LEN = [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [6, 1], [8, 1], [10, 2], [14, 2], [18, 3], [26, 3], [34, 4], [50, 4],
  [66, 5], [98, 5], [130, 6], [194, 7], [322, 8], [578, 9], [1090, 10], [2114, 12], [6210, 14], [22594, 24]];
const COPY_LEN = [[2, 0], [3, 0], [4, 0], [5, 0], [6, 0], [7, 0], [8, 0], [9, 0], [10, 1], [12, 1], [14, 2], [18, 2], [22, 3], [30, 3],
  [38, 4], [54, 4], [70, 5], [102, 5], [134, 6], [198, 7], [326, 8], [582, 9], [1094, 10], [2118, 24]];
// Which insert and copy codes each block of 64 command symbols starts at.
const CELL_INSERT = [0, 0, 0, 0, 8, 8, 0, 16, 8, 16, 16];
const CELL_COPY = [0, 8, 0, 8, 0, 8, 16, 0, 16, 8, 16];
// Distance codes 0..15: which earlier distance, and what to add to it.
const DIST_SLOT = [0, 1, 2, 3, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1];
const DIST_ADD = [0, 0, 0, 0, -1, 1, -2, 2, -3, 3, -1, 1, -2, 2, -3, 3];

// Literal context lookup tables (section 7.1).
const LUT0 = new Uint8Array(256);
const LUT1 = new Uint8Array(256);
const LUT2 = new Uint8Array(256);
{
  const punct0 = { 32: 8, 33: 12, 34: 16, 37: 20, 39: 16, 40: 24, 41: 28, 44: 32, 46: 36, 58: 32, 59: 32, 60: 24, 61: 40, 62: 28, 91: 24, 93: 28, 123: 24, 125: 28 };
  for (let c = 0; c < 256; c++) {
    let v;
    if (c < 32) v = c === 9 || c === 10 || c === 13 ? 4 : 0;
    else if (c === 127) v = 0;
    else if (c < 128) {
      if (c >= 48 && c <= 57) v = 44;
      else if (c >= 65 && c <= 90) v = 'AEIOU'.includes(String.fromCharCode(c)) ? 48 : 52;
      else if (c >= 97 && c <= 122) v = 'aeiou'.includes(String.fromCharCode(c)) ? 56 : 60;
      else v = punct0[c] ?? 12;
    } else v = c < 192 ? c & 1 : 2 + (c & 1);
    LUT0[c] = v;
    let w;
    if (c <= 32 || c === 127) w = 0;
    else if (c < 128) w = c >= 48 && c <= 57 ? 2 : c >= 65 && c <= 90 ? 2 : c >= 97 && c <= 122 ? 3 : 1;
    else w = c < 224 ? 0 : 2; // a lead byte of three or four bytes: inside a letter
    LUT1[c] = w;
    LUT2[c] = c === 0 ? 0 : c < 16 ? 1 : c < 64 ? 2 : c < 128 ? 3 : c < 192 ? 4 : c < 240 ? 5 : c < 255 ? 6 : 7;
  }
}

function contextId(mode, p1, p2) {
  if (mode === 0) return p1 & 0x3f;
  if (mode === 1) return p1 >> 2;
  if (mode === 2) return LUT0[p1] | LUT1[p2];
  return (LUT2[p1] << 3) | LUT2[p2];
}

// ---------- reading codes ----------

const CL_ORDER = [1, 2, 3, 4, 0, 5, 17, 6, 16, 7, 8, 9, 10, 11, 12, 13, 14, 15];
// The fixed code for code length code lengths, by the next 4 bits: [length, value].
const CL_LEN = [2, 2, 2, 3, 2, 2, 2, 4, 2, 2, 2, 3, 2, 2, 2, 4];
const CL_VAL = [0, 4, 3, 2, 0, 4, 3, 1, 0, 4, 3, 2, 0, 4, 3, 5];

function bitsFor(n) {
  let b = 0;
  while ((1 << b) < n) b++;
  return b;
}

/** A prefix code whose lengths are known: one symbol needs no bits at all. */
function codeFrom(lengths) {
  const used = [];
  for (let s = 0; s < lengths.length; s++) if (lengths[s]) used.push(s);
  if (used.length === 1) return { single: used[0] };
  return prefixCode(lengths);
}

function read(br, code) {
  return code.single !== undefined ? code.single : readSymbol(br, code);
}

/** Read a prefix code over an alphabet of `size` symbols (section 3.4 and 3.5). */
function readCode(br, size) {
  const hskip = br.bits(2);
  const lengths = new Uint8Array(size);
  if (hskip === 1) {
    // A simple code: up to four symbols listed.
    const n = br.bits(2) + 1;
    const nb = bitsFor(size);
    const syms = [];
    for (let i = 0; i < n; i++) {
      const s = br.bits(nb);
      if (s >= size || syms.includes(s)) throw new Error('Bad Brotli code');
      syms.push(s);
    }
    if (n === 1) return { single: syms[0] };
    let lens;
    if (n === 2) lens = [1, 1];
    else if (n === 3) lens = [1, 2, 2];
    else lens = br.bits(1) ? [1, 2, 3, 3] : [2, 2, 2, 2];
    syms.forEach((s, i) => (lengths[s] = lens[i]));
    return prefixCode(lengths);
  }
  // A complex code: first the code lengths' own code.
  const clLens = new Uint8Array(18);
  let space = 32;
  let count = 0;
  for (let i = hskip; i < 18 && space > 0; i++) {
    const peek = br.peek(4);
    br.bits(CL_LEN[peek]);
    const v = CL_VAL[peek];
    clLens[CL_ORDER[i]] = v;
    if (v) {
      space -= 32 >> v;
      count++;
    }
  }
  if (count !== 1 && space !== 0) throw new Error('Bad Brotli code');
  const clCode = codeFrom(clLens);
  let sym = 0;
  let prevLen = 8;
  let repeat = 0;
  let repeatLen = 0;
  space = 32768;
  while (sym < size && space > 0) {
    const p = read(br, clCode);
    if (p < 16) {
      repeat = 0;
      lengths[sym++] = p;
      if (p) {
        prevLen = p;
        space -= 32768 >> p;
      }
    } else {
      const extra = p === 16 ? 2 : 3;
      const len = p === 16 ? prevLen : 0;
      if (repeatLen !== len) {
        repeat = 0;
        repeatLen = len;
      }
      const old = repeat;
      if (repeat > 0) repeat = (repeat - 2) << extra;
      repeat += br.bits(extra) + 3;
      const delta = repeat - old;
      if (sym + delta > size) throw new Error('Bad Brotli code');
      for (let k = 0; k < delta; k++) lengths[sym++] = repeatLen;
      if (repeatLen) space -= delta << (15 - repeatLen);
    }
  }
  if (space !== 0) throw new Error('Bad Brotli code');
  return codeFrom(lengths);
}

function readVarLen8(br) {
  if (!br.bits(1)) return 0;
  const n = br.bits(3);
  return n === 0 ? 1 : (1 << n) + br.bits(n);
}

function readBlockLength(br, code) {
  const [base, extra] = BLOCK_LEN[read(br, code)];
  return base + br.bits(extra);
}

function readContextMap(br, size, trees) {
  const map = new Uint8Array(size);
  if (trees < 2) return map;
  const rleMax = br.bits(1) ? br.bits(4) + 1 : 0;
  const code = readCode(br, trees + rleMax);
  for (let i = 0; i < size;) {
    const s = read(br, code);
    if (s === 0) map[i++] = 0;
    else if (s <= rleMax) {
      let reps = (1 << s) + br.bits(s);
      if (i + reps > size) throw new Error('Bad Brotli context map');
      while (reps--) map[i++] = 0;
    } else map[i++] = s - rleMax;
  }
  if (br.bits(1)) {
    // Undo the move-to-front transform.
    const mtf = Array.from({ length: 256 }, (_, k) => k);
    for (let i = 0; i < size; i++) {
      const idx = map[i];
      const v = mtf[idx];
      map[i] = v;
      if (idx) {
        mtf.splice(idx, 1);
        mtf.unshift(v);
      }
    }
  }
  return map;
}

/** Block types and lengths for one category (literals, commands or distances). */
function readBlocks(br) {
  const n = readVarLen8(br) + 1;
  const b = { n, type: 0, prev: 1, last: 0, left: 1 << 28 };
  if (n >= 2) {
    b.typeCode = readCode(br, n + 2);
    b.lenCode = readCode(br, 26);
    b.left = readBlockLength(br, b.lenCode);
  }
  return b;
}

function switchBlock(br, b) {
  const s = read(br, b.typeCode);
  let t = s === 0 ? b.prev : s === 1 ? b.last + 1 : s - 2;
  if (t >= b.n) t -= b.n;
  b.prev = b.last;
  b.last = t;
  b.type = t;
  b.left = readBlockLength(br, b.lenCode);
}

// ---------- decoding ----------

/** Decompress a Brotli stream. `size`, if known, is the decompressed size. */
export function brotliDecode(bytes, { size } = {}) {
  const br = new BitReader(bytes);
  // The window size (section 9.1).
  let wbits = 16;
  if (br.bits(1)) {
    const n = br.bits(3);
    if (n) wbits = 17 + n;
    else {
      const m = br.bits(3);
      if (m === 1) throw new Error('Large-window Brotli is not supported');
      wbits = m ? 8 + m : 17;
    }
  }
  const window = (1 << wbits) - 16;
  let out = new Uint8Array(size || Math.max(1024, bytes.length * 4));
  let pos = 0;
  const room = (k) => {
    if (pos + k <= out.length) return;
    const bigger = new Uint8Array(Math.max(out.length * 2, pos + k));
    bigger.set(out.subarray(0, pos));
    out = bigger;
  };
  const dist = [16, 15, 11, 4]; // the last four distances, most recent last
  let last = false;
  while (!last) {
    last = !!br.bits(1);
    if (last && br.bits(1)) break; // last and empty
    const nibbles = br.bits(2);
    if (nibbles === 3) {
      // Metadata: skipped.
      if (br.bits(1)) throw new Error('Bad Brotli stream');
      const nbytes = br.bits(2);
      let skip = 0;
      for (let i = 0; i < nbytes; i++) skip |= br.bits(8) << (i * 8);
      if (nbytes) skip += 1;
      br.align();
      br.pos += skip;
      continue;
    }
    let mlen = br.bits((nibbles + 4) * 4) + 1;
    if (!last && br.bits(1)) {
      // Stored bytes.
      br.align();
      room(mlen);
      if (br.pos + mlen > bytes.length) throw new Error('Brotli data ends too soon');
      out.set(bytes.subarray(br.pos, br.pos + mlen), pos);
      pos += mlen;
      br.pos += mlen;
      continue;
    }
    const L = readBlocks(br);
    const C = readBlocks(br);
    const D = readBlocks(br);
    const npostfix = br.bits(2);
    const ndirect = br.bits(4) << npostfix;
    const modes = [];
    for (let i = 0; i < L.n; i++) modes.push(br.bits(2));
    const treesL = readVarLen8(br) + 1;
    const mapL = readContextMap(br, 64 * L.n, treesL);
    const treesD = readVarLen8(br) + 1;
    const mapD = readContextMap(br, 4 * D.n, treesD);
    const litCodes = [];
    for (let i = 0; i < treesL; i++) litCodes.push(readCode(br, 256));
    const cmdCodes = [];
    for (let i = 0; i < C.n; i++) cmdCodes.push(readCode(br, 704));
    const distSize = 16 + ndirect + (48 << npostfix);
    const distCodes = [];
    for (let i = 0; i < treesD; i++) distCodes.push(readCode(br, distSize));
    const postMask = (1 << npostfix) - 1;
    room(mlen);
    while (mlen > 0) {
      if (C.left === 0) switchBlock(br, C);
      C.left--;
      const cmd = read(br, cmdCodes[C.type]);
      const cell = cmd >> 6;
      if (cell > 10) throw new Error('Bad Brotli command');
      const ic = CELL_INSERT[cell] + ((cmd >> 3) & 7);
      const cc = CELL_COPY[cell] + (cmd & 7);
      const insert = INSERT_LEN[ic][0] + br.bits(INSERT_LEN[ic][1]);
      const copy = COPY_LEN[cc][0] + br.bits(COPY_LEN[cc][1]);
      if (insert > mlen) throw new Error('Bad Brotli command');
      for (let k = 0; k < insert; k++) {
        if (L.left === 0) switchBlock(br, L);
        L.left--;
        const p1 = pos > 0 ? out[pos - 1] : 0;
        const p2 = pos > 1 ? out[pos - 2] : 0;
        const tree = mapL[64 * L.type + contextId(modes[L.type], p1, p2)];
        out[pos++] = read(br, litCodes[tree]);
      }
      mlen -= insert;
      if (mlen <= 0) break;
      let d;
      let code = 0;
      if (cell >= 2) {
        if (D.left === 0) switchBlock(br, D);
        D.left--;
        const ctx = copy > 4 ? 3 : copy - 2;
        code = read(br, distCodes[mapD[4 * D.type + ctx]]);
        if (code < 16) d = dist[3 - DIST_SLOT[code]] + DIST_ADD[code];
        else if (code < 16 + ndirect) d = code - 15;
        else {
          const c = code - ndirect - 16;
          const nbits = 1 + (c >> (npostfix + 1));
          const hcode = c >> npostfix;
          const lcode = c & postMask;
          const offset = ((2 + (hcode & 1)) << nbits) - 4;
          d = ((offset + br.bits(nbits)) << npostfix) + lcode + ndirect + 1;
        }
        if (d <= 0) throw new Error('Bad Brotli distance');
      } else d = dist[3];
      const max = Math.min(window, pos);
      if (d > max) {
        // A word from the dictionary.
        if (copy < 4 || copy > 24) throw new Error('Bad Brotli dictionary reference');
        const id = d - max - 1;
        const index = id & ((1 << NDBITS[copy]) - 1);
        const t = id >> NDBITS[copy];
        if (t >= TRANSFORMS.length) throw new Error('Bad Brotli dictionary reference');
        const word = dictionaryWord(copy, index, t);
        if (word.length > mlen) throw new Error('Bad Brotli dictionary reference');
        room(word.length);
        out.set(word, pos);
        pos += word.length;
        mlen -= word.length;
      } else {
        if (code !== 0) {
          dist.shift();
          dist.push(d);
        }
        if (copy > mlen) throw new Error('Bad Brotli command');
        room(copy);
        for (let k = 0; k < copy; k++, pos++) out[pos] = out[pos - d];
        mlen -= copy;
      }
    }
  }
  return pos === out.length ? out : out.slice(0, pos);
}
