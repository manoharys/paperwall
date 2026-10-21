// Writes src/model/brotli-dict.js: Brotli's static dictionary (RFC 7932,
// appendix A), which our decoder needs for WOFF2 fonts. Rather than typing in
// 122,784 bytes, this asks Node's own Brotli decoder for them: it makes a
// Brotli stream whose every command is "copy dictionary word n", decodes it
// with node:zlib and keeps the result, packed with deflate.
//
//   node scripts/brotli-dict.mjs
//
// craft() is also used by the unit tests to check our decoder's word
// transforms against Node's.

import { brotliDecompressSync, deflateRawSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const NDBITS = [0, 0, 0, 0, 10, 10, 11, 11, 10, 10, 10, 10, 10, 9, 9, 8, 7, 7, 8, 7, 7, 6, 6, 5, 5];

class Bits {
  constructor() {
    this.bytes = [];
    this.acc = 0;
    this.n = 0;
  }
  put(v, n) {
    for (let i = 0; i < n; i++) {
      this.acc |= ((v >>> i) & 1) << this.n;
      if (++this.n === 8) {
        this.bytes.push(this.acc);
        this.acc = 0;
        this.n = 0;
      }
    }
  }
  /** A prefix code, its first bit first. */
  code(c, len) {
    for (let i = len - 1; i >= 0; i--) this.put((c >> i) & 1, 1);
  }
  done() {
    if (this.n) this.bytes.push(this.acc);
    return Uint8Array.from(this.bytes);
  }
}

// The fixed code for code length code lengths: value -> [bits, length].
const CL_FIXED = { 0: [0, 2], 1: [7, 4], 2: [3, 3], 3: [2, 2], 4: [1, 2], 5: [15, 4] };
const CL_ORDER = [1, 2, 3, 4, 0, 5, 17, 6, 16, 7, 8, 9, 10, 11, 12, 13, 14, 15];
const COPY = [[2, 0], [3, 0], [4, 0], [5, 0], [6, 0], [7, 0], [8, 0], [9, 0], [10, 1], [12, 1], [14, 2], [18, 2], [22, 3], [30, 3]];

/** Write a complex prefix code where `used` symbols (a power of two of them) all get the same length. */
function evenCode(b, used, size) {
  const len = Math.log2(used.length);
  // Code length code: just the symbols 0 and `len`, one bit each.
  b.put(0, 2); // HSKIP 0
  let space = 32;
  for (const s of CL_ORDER) {
    if (space <= 0) break;
    const v = s === 0 || s === len ? 1 : 0;
    const [bits, n] = CL_FIXED[v];
    b.put(bits, n);
    if (v) space -= 32 >> v;
  }
  // Then each symbol's length, up to the last used one (the rest are zero).
  const last = Math.max(...used);
  for (let s = 0; s <= last && s < size; s++) b.code(used.includes(s) ? 1 : 0, 1);
  // Canonical codes: the used symbols in order.
  return new Map(used.slice().sort((x, y) => x - y).map((s, i) => [s, [i, len]]));
}

/**
 * A Brotli stream that outputs dictionary words: each { len, id } is a copy
 * of `len` bytes at dictionary entry `id` (word index plus transform << NDBITS).
 * `sizes` gives each word's length once transformed (its len, untransformed).
 */
export function craft(words, sizes = words.map((w) => w.len)) {
  const mlen = sizes.reduce((s, n) => s + n, 0);
  const b = new Bits();
  b.put(1, 1);
  b.put(7, 3); // WBITS 24
  b.put(1, 1); // ISLAST
  b.put(0, 1); // not empty
  const nibbles = Math.max(4, Math.ceil(Math.log2(mlen) / 4));
  b.put(nibbles - 4, 2);
  b.put(mlen - 1, nibbles * 4);
  b.put(0, 1); // NBLTYPESL = 1
  b.put(0, 1); // NBLTYPESI = 1
  b.put(0, 1); // NBLTYPESD = 1
  b.put(0, 2); // NPOSTFIX
  b.put(0, 4); // NDIRECT
  b.put(0, 2); // context mode
  b.put(0, 1); // NTREESL = 1
  b.put(0, 1); // NTREESD = 1
  // Literals: never used, a one-symbol simple code.
  b.put(1, 2);
  b.put(0, 2);
  b.put(0, 8);
  // Commands: insert nothing, copy 4..24 bytes, with a distance.
  const cmdOf = (len) => {
    let c = COPY.length - 1;
    while (COPY[c][0] > len) c--;
    return { sym: (c < 8 ? 2 : 3) * 64 + (c & 7), extra: len - COPY[c][0], nbits: COPY[c][1] };
  };
  const cmds = new Set();
  for (const w of words) cmds.add(cmdOf(w.len).sym);
  const used = [...cmds];
  for (let s = 128; used.length < 16; s++) if (!cmds.has(s)) used.push(s);
  const cmdCode = evenCode(b, used, 704);
  // Distances: all 64 codes, six bits each.
  const distCode = evenCode(b, Array.from({ length: 64 }, (_, i) => i), 64);
  let pos = 0;
  words.forEach((w, i) => {
    const c = cmdOf(w.len);
    b.code(...cmdCode.get(c.sym));
    b.put(c.extra, c.nbits);
    const d = pos + 1 + w.id;
    // Find the distance code (NPOSTFIX and NDIRECT are 0).
    let code = 16;
    for (;; code++) {
      const k = code - 16;
      const nbits = 1 + (k >> 1);
      const offset = ((2 + (k & 1)) << nbits) - 4;
      if (d - 1 >= offset && d - 1 < offset + (1 << nbits)) {
        b.code(...distCode.get(code));
        b.put(d - 1 - offset, nbits);
        break;
      }
    }
    pos += sizes[i];
  });
  return b.done();
}

/** Every word of the dictionary, untransformed, in order. */
export function dictionaryWords() {
  const words = [];
  for (let len = 4; len <= 24; len++) for (let i = 0; i < 1 << NDBITS[len]; i++) words.push({ len, id: i });
  return words;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dict = brotliDecompressSync(craft(dictionaryWords()));
  if (dict.length !== 122784) throw new Error(`Expected 122784 bytes, got ${dict.length}`);
  const packed = deflateRawSync(dict, { level: 9 }).toString('base64');
  const lines = packed.match(/.{1,120}/g).map((l) => `  '${l}' +`);
  lines[lines.length - 1] = lines[lines.length - 1].replace(/ \+$/, ';');
  const out = join(new URL('..', import.meta.url).pathname, 'src/model/brotli-dict.js');
  writeFileSync(out, `// Brotli's static dictionary (RFC 7932, appendix A): 122,784 bytes, packed
// with deflate and base64. Made by scripts/brotli-dict.mjs; don't edit.

export const BROTLI_DICTIONARY =
${lines.join('\n')}
`);
  console.log(`Wrote ${out} (${packed.length} characters)`);
}
