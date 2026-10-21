// Deflate and inflate (RFC 1950 and 1951), written from the specs. Used for
// PDF streams (FlateDecode) and for reading WOFF font files. Synchronous and
// dependency-free, so it works in the model, in the browser and in tests.

// Lengths 3..258 as codes 257..285: the first length of each code, and its extra bits.
const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
// Distances 1..32768 as codes 0..29.
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
// The order code length code lengths are stored in.
const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

export function adler32(bytes) {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length;) {
    const end = Math.min(bytes.length, i + 5552);
    for (; i < end; i++) {
      a += bytes[i];
      b += a;
    }
    a %= 65521;
    b %= 65521;
  }
  return ((b << 16) | a) >>> 0;
}

// ---------- reading ----------

/** Reads bits least significant first, as both deflate and Brotli store them. */
export class BitReader {
  constructor(bytes, pos = 0) {
    this.bytes = bytes;
    this.pos = pos;
    this.bit = 0; // bits already used of bytes[pos]
  }
  bits(n) {
    let v = 0;
    for (let i = 0; i < n; i++) {
      if (this.pos >= this.bytes.length) throw new Error('Compressed data ends too soon');
      v |= ((this.bytes[this.pos] >> this.bit) & 1) << i;
      if (++this.bit === 8) {
        this.bit = 0;
        this.pos++;
      }
    }
    return v >>> 0;
  }
  /** The next n bits without using them up (zeros past the end). */
  peek(n) {
    let v = 0;
    let p = this.pos;
    let b = this.bit;
    for (let i = 0; i < n && p < this.bytes.length; i++) {
      v |= ((this.bytes[p] >> b) & 1) << i;
      if (++b === 8) {
        b = 0;
        p++;
      }
    }
    return v >>> 0;
  }
  /** Skip to the next whole byte. */
  align() {
    if (this.bit) {
      this.bit = 0;
      this.pos++;
    }
  }
}

/**
 * A canonical prefix code from its code lengths (0 = symbol not used): how
 * many codes there are of each length, and the symbols in code order.
 */
export function prefixCode(lengths) {
  const count = new Uint16Array(16);
  for (const l of lengths) count[l]++;
  count[0] = 0;
  const offs = new Uint16Array(16);
  for (let l = 1; l < 16; l++) offs[l] = offs[l - 1] + count[l - 1];
  const symbol = new Uint16Array(lengths.length);
  for (let s = 0; s < lengths.length; s++) if (lengths[s]) symbol[offs[lengths[s]]++] = s;
  return { count, symbol };
}

/** Read one symbol: codes are read a bit at a time, first bit first. */
export function readSymbol(br, code) {
  let c = 0; // the code so far
  let first = 0; // the first code of this length
  let index = 0; // its place in the symbol list
  for (let len = 1; len < 16; len++) {
    c |= br.bits(1);
    const n = code.count[len];
    if (c - first < n) return code.symbol[index + c - first];
    index += n;
    first = (first + n) << 1;
    c <<= 1;
  }
  throw new Error('Bad prefix code in compressed data');
}

let FIXED = null;
function fixedCodes() {
  if (!FIXED) {
    const lit = new Array(288);
    for (let i = 0; i < 288; i++) lit[i] = i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : 8;
    FIXED = { lit: prefixCode(lit), dist: prefixCode(new Array(30).fill(5)) };
  }
  return FIXED;
}

/** Inflate zlib data (or raw deflate data with { raw: true }). */
export function inflate(bytes, { raw = false } = {}) {
  let start = 0;
  if (!raw) {
    if (bytes.length < 2 || (bytes[0] & 0x0f) !== 8 || ((bytes[0] << 8) | bytes[1]) % 31) throw new Error('Not zlib data');
    if (bytes[1] & 0x20) throw new Error('zlib data with a preset dictionary is not supported');
    start = 2;
  }
  const br = new BitReader(bytes, start);
  let out = new Uint8Array(Math.max(1024, bytes.length * 4));
  let n = 0;
  const room = (k) => {
    if (n + k <= out.length) return;
    const bigger = new Uint8Array(Math.max(out.length * 2, n + k));
    bigger.set(out.subarray(0, n));
    out = bigger;
  };
  let last = 0;
  while (!last) {
    last = br.bits(1);
    const type = br.bits(2);
    if (type === 0) {
      br.align();
      const p = br.pos;
      const len = bytes[p] | (bytes[p + 1] << 8);
      if (p + 4 + len > bytes.length) throw new Error('Compressed data ends too soon');
      room(len);
      out.set(bytes.subarray(p + 4, p + 4 + len), n);
      n += len;
      br.pos = p + 4 + len;
      continue;
    }
    let lit;
    let dist;
    if (type === 1) ({ lit, dist } = fixedCodes());
    else if (type === 2) {
      const hlit = br.bits(5) + 257;
      const hdist = br.bits(5) + 1;
      const hclen = br.bits(4) + 4;
      const cl = new Array(19).fill(0);
      for (let i = 0; i < hclen; i++) cl[CL_ORDER[i]] = br.bits(3);
      const clCode = prefixCode(cl);
      const lengths = [];
      while (lengths.length < hlit + hdist) {
        const sym = readSymbol(br, clCode);
        if (sym < 16) lengths.push(sym);
        else if (sym === 16) {
          if (!lengths.length) throw new Error('Bad deflate header');
          const prev = lengths[lengths.length - 1];
          for (let k = 3 + br.bits(2); k > 0; k--) lengths.push(prev);
        } else for (let k = sym === 17 ? 3 + br.bits(3) : 11 + br.bits(7); k > 0; k--) lengths.push(0);
      }
      lit = prefixCode(lengths.slice(0, hlit));
      dist = prefixCode(lengths.slice(hlit, hlit + hdist));
    } else throw new Error('Bad deflate block');
    for (;;) {
      const sym = readSymbol(br, lit);
      if (sym < 256) {
        room(1);
        out[n++] = sym;
      } else if (sym === 256) break;
      else {
        const li = sym - 257;
        if (li >= 29) throw new Error('Bad deflate length');
        const len = LEN_BASE[li] + br.bits(LEN_EXTRA[li]);
        const di = readSymbol(br, dist);
        if (di >= 30) throw new Error('Bad deflate distance');
        const d = DIST_BASE[di] + br.bits(DIST_EXTRA[di]);
        if (d > n) throw new Error('Bad deflate distance');
        room(len);
        for (let k = 0; k < len; k++, n++) out[n] = out[n - d];
      }
    }
  }
  return out.slice(0, n);
}

// ---------- writing ----------

class BitWriter {
  constructor(size) {
    this.out = new Uint8Array(Math.max(256, size));
    this.n = 0;
    this.acc = 0;
    this.nbits = 0;
  }
  bits(v, n) {
    this.acc |= v << this.nbits;
    this.nbits += n;
    while (this.nbits >= 8) {
      this.byte(this.acc & 0xff);
      this.acc >>>= 8;
      this.nbits -= 8;
    }
  }
  byte(b) {
    if (this.n === this.out.length) {
      const bigger = new Uint8Array(this.out.length * 2);
      bigger.set(this.out);
      this.out = bigger;
    }
    this.out[this.n++] = b;
  }
  flush() {
    if (this.nbits) this.byte(this.acc & 0xff);
    this.acc = 0;
    this.nbits = 0;
  }
}

/** Code lengths for these symbol counts, none longer than `limit`. */
export function codeLengths(freqs, limit) {
  const lengths = new Array(freqs.length).fill(0);
  let f = freqs.slice();
  for (;;) {
    const used = [];
    for (let i = 0; i < f.length; i++) if (f[i]) used.push(i);
    if (!used.length) return lengths;
    if (used.length === 1) {
      lengths[used[0]] = 1;
      return lengths;
    }
    // Build the tree by joining the two lightest nodes again and again.
    const nodes = used.map((s) => ({ w: f[s], s }));
    const heap = nodes.slice().sort((a, b) => a.w - b.w);
    const queue = []; // joined nodes come out in weight order, so a second queue keeps them sorted
    const take = () => (queue.length && (!heap.length || queue[0].w < heap[0].w) ? queue.shift() : heap.shift());
    while (heap.length + queue.length > 1) {
      const a = take();
      const b = take();
      queue.push({ w: a.w + b.w, l: a, r: b });
    }
    let max = 0;
    const walk = (node, depth) => {
      if (node.s !== undefined) {
        lengths[node.s] = depth;
        max = Math.max(max, depth);
      } else {
        walk(node.l, depth + 1);
        walk(node.r, depth + 1);
      }
    };
    walk(queue[0] || heap[0], 0);
    if (max <= limit) return lengths;
    // Too deep: flatten the counts and try again.
    f = f.map((v) => (v ? (v >> 1) | 1 : 0));
    lengths.fill(0);
  }
}

/** Codes (bit-reversed, ready to write) for canonical code lengths. */
function codesFor(lengths) {
  const count = new Array(16).fill(0);
  for (const l of lengths) if (l) count[l]++;
  const next = new Array(16).fill(0);
  let code = 0;
  for (let l = 1; l < 16; l++) {
    code = (code + count[l - 1]) << 1;
    next[l] = code;
  }
  return lengths.map((l) => {
    if (!l) return 0;
    let c = next[l]++;
    let r = 0;
    for (let i = 0; i < l; i++) {
      r = (r << 1) | (c & 1);
      c >>= 1;
    }
    return r;
  });
}

const lenCode = (len) => {
  let i = 28;
  while (LEN_BASE[i] > len) i--;
  return i;
};
const distCode = (d) => {
  let i = 29;
  while (DIST_BASE[i] > d) i--;
  return i;
};
const LEN_CODE = new Uint8Array(259);
for (let l = 3; l <= 258; l++) LEN_CODE[l] = lenCode(l);

/** Find repeats: a list of literals (< 256) and [length, distance] pairs, as numbers. */
function matches(bytes) {
  const HASH = 1 << 15;
  const head = new Int32Array(HASH).fill(-1);
  const prev = new Int32Array(Math.min(bytes.length, 1 << 15));
  const WMASK = (1 << 15) - 1;
  const out = []; // literal: byte; match: 256 + length, then distance
  const hash = (i) => ((bytes[i] << 10) ^ (bytes[i + 1] << 5) ^ bytes[i + 2]) & (HASH - 1);
  const insert = (i) => {
    if (i + 2 >= bytes.length) return;
    const h = hash(i);
    prev[i & WMASK] = head[h];
    head[h] = i;
  };
  let i = 0;
  while (i < bytes.length) {
    let best = 0;
    let bestD = 0;
    if (i + 2 < bytes.length) {
      let j = head[hash(i)];
      let chain = 48;
      const max = Math.min(258, bytes.length - i);
      while (j >= 0 && i - j <= 32768 && chain-- > 0) {
        if (bytes[j + best] === bytes[i + best]) {
          let k = 0;
          while (k < max && bytes[j + k] === bytes[i + k]) k++;
          if (k > best) {
            best = k;
            bestD = i - j;
            if (k === max) break;
          }
        }
        const p = prev[j & WMASK];
        if (p >= j) break;
        j = p;
      }
    }
    if (best >= 3) {
      out.push(256 + best, bestD);
      for (let k = 0; k < best; k++) insert(i + k);
      i += best;
    } else {
      out.push(bytes[i]);
      insert(i);
      i++;
    }
  }
  return out;
}

function writeBlock(bw, tokens, from, to, last) {
  const lf = new Array(286).fill(0);
  const df = new Array(30).fill(0);
  for (let i = from; i < to; i++) {
    const t = tokens[i];
    if (t < 256) lf[t]++;
    else {
      lf[257 + LEN_CODE[t - 256]]++;
      df[distCode(tokens[++i])]++;
    }
  }
  lf[256] = 1;
  if (!df.some(Boolean)) df[0] = 1;
  const ll = codeLengths(lf, 15);
  const dl = codeLengths(df, 15);
  // Two distance codes at least, as some decoders expect.
  if (dl.filter(Boolean).length === 1) dl[dl[0] ? 1 : 0] = 1;
  let hlit = 286;
  while (hlit > 257 && !ll[hlit - 1]) hlit--;
  let hdist = 30;
  while (hdist > 1 && !dl[hdist - 1]) hdist--;
  // The code lengths, run-length coded.
  const all = [...ll.slice(0, hlit), ...dl.slice(0, hdist)];
  const rle = [];
  for (let i = 0; i < all.length;) {
    const v = all[i];
    let run = 1;
    while (i + run < all.length && all[i + run] === v) run++;
    if (v === 0 && run >= 3) {
      const k = Math.min(run, 138);
      rle.push(k >= 11 ? [18, k - 11] : [17, k - 3]);
      i += k;
    } else if (v !== 0 && run >= 4) {
      rle.push([v]);
      const k = Math.min(run - 1, 6);
      rle.push([16, k - 3]);
      i += 1 + k;
    } else {
      rle.push([v]);
      i++;
    }
  }
  const cf = new Array(19).fill(0);
  for (const [s] of rle) cf[s]++;
  const cl = codeLengths(cf, 7);
  let hclen = 19;
  while (hclen > 4 && !cl[CL_ORDER[hclen - 1]]) hclen--;
  const lc = codesFor(ll);
  const dc = codesFor(dl);
  const cc = codesFor(cl);
  bw.bits(last ? 1 : 0, 1);
  bw.bits(2, 2);
  bw.bits(hlit - 257, 5);
  bw.bits(hdist - 1, 5);
  bw.bits(hclen - 4, 4);
  for (let i = 0; i < hclen; i++) bw.bits(cl[CL_ORDER[i]], 3);
  for (const [s, extra] of rle) {
    bw.bits(cc[s], cl[s]);
    if (s === 16) bw.bits(extra, 2);
    else if (s === 17) bw.bits(extra, 3);
    else if (s === 18) bw.bits(extra, 7);
  }
  for (let i = from; i < to; i++) {
    const t = tokens[i];
    if (t < 256) bw.bits(lc[t], ll[t]);
    else {
      const len = t - 256;
      const li = LEN_CODE[len];
      bw.bits(lc[257 + li], ll[257 + li]);
      if (LEN_EXTRA[li]) bw.bits(len - LEN_BASE[li], LEN_EXTRA[li]);
      const d = tokens[++i];
      const di = distCode(d);
      bw.bits(dc[di], dl[di]);
      if (DIST_EXTRA[di]) bw.bits(d - DIST_BASE[di], DIST_EXTRA[di]);
    }
  }
  bw.bits(lc[256], ll[256]);
}

/** Deflate bytes: zlib data (as PDF's FlateDecode wants), or raw with { raw: true }. */
export function deflate(bytes, { raw = false } = {}) {
  const bw = new BitWriter(bytes.length / 2 + 64);
  if (!raw) {
    bw.byte(0x78);
    bw.byte(0x9c);
  }
  const tokens = matches(bytes);
  const BLOCK = 1 << 15; // tokens per block, each with codes of its own
  if (!tokens.length) {
    bw.bits(1, 1);
    bw.bits(1, 2); // fixed codes: just the end of the block
    bw.bits(0, 7);
  }
  for (let i = 0; i < tokens.length;) {
    let end = Math.min(tokens.length, i + BLOCK);
    // Never split a match from its distance.
    let j = i;
    while (j < end) j += tokens[j] < 256 ? 1 : 2;
    end = j;
    writeBlock(bw, tokens, i, end, end >= tokens.length);
    i = end;
  }
  bw.flush();
  if (!raw) {
    const a = adler32(bytes);
    bw.byte(a >>> 24);
    bw.byte((a >>> 16) & 0xff);
    bw.byte((a >>> 8) & 0xff);
    bw.byte(a & 0xff);
  }
  return bw.out.slice(0, bw.n);
}
