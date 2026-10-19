// QR code encoder: byte mode, error correction level M, versions 1–10
// (up to 213 bytes, plenty for a link). Written from the public QR spec.

const VERSIONS = [
  null,
  { ec: 10, blocks: [[1, 16]], align: [] },
  { ec: 16, blocks: [[1, 28]], align: [6, 18] },
  { ec: 26, blocks: [[1, 44]], align: [6, 22] },
  { ec: 18, blocks: [[2, 32]], align: [6, 26] },
  { ec: 24, blocks: [[2, 43]], align: [6, 30] },
  { ec: 16, blocks: [[4, 27]], align: [6, 34] },
  { ec: 18, blocks: [[4, 31]], align: [6, 22, 38] },
  { ec: 22, blocks: [[2, 38], [2, 39]], align: [6, 24, 42] },
  { ec: 22, blocks: [[3, 36], [2, 37]], align: [6, 26, 46] },
  { ec: 26, blocks: [[4, 43], [1, 44]], align: [6, 28, 50] },
];

const VERSION_INFO = { 7: 0x07c94, 8: 0x085bc, 9: 0x09a99, 10: 0x0a4d3 };

// ---------- Reed–Solomon over GF(256) ----------

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}

function mul(a, b) {
  return a && b ? EXP[LOG[a] + LOG[b]] : 0;
}

function generator(n) {
  let g = [1];
  for (let i = 0; i < n; i++) {
    const next = new Array(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) {
      next[j] ^= g[j];
      next[j + 1] ^= mul(g[j], EXP[i]);
    }
    g = next;
  }
  return g;
}

function ecBytes(data, n) {
  const g = generator(n);
  const res = new Array(n).fill(0);
  for (const byte of data) {
    const factor = byte ^ res[0];
    res.shift();
    res.push(0);
    for (let i = 0; i < n; i++) res[i] ^= mul(g[i + 1], factor);
  }
  return res;
}

// ---------- data ----------

function utf8(text) {
  return Array.from(new TextEncoder().encode(text));
}

function dataCapacity(v) {
  return VERSIONS[v].blocks.reduce((s, [n, k]) => s + n * k, 0);
}

export function pickVersion(byteLength) {
  for (let v = 1; v <= 10; v++) {
    const countBits = v < 10 ? 8 : 16;
    if (4 + countBits + byteLength * 8 <= dataCapacity(v) * 8) return v;
  }
  throw new Error('That text is too long for a QR code here (213 bytes at most)');
}

function encodeData(bytes, v) {
  const cap = dataCapacity(v);
  const bits = [];
  const put = (val, len) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  put(0b0100, 4);
  put(bytes.length, v < 10 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  put(0, Math.min(4, cap * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const out = [];
  for (let i = 0; i < bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  for (let pad = 0; out.length < cap; pad++) out.push(pad % 2 ? 0x11 : 0xec);
  return out;
}

function interleave(data, v) {
  const { ec, blocks } = VERSIONS[v];
  const dataBlocks = [];
  let pos = 0;
  for (const [n, k] of blocks) {
    for (let i = 0; i < n; i++) {
      dataBlocks.push(data.slice(pos, pos + k));
      pos += k;
    }
  }
  const ecBlocks = dataBlocks.map((b) => ecBytes(b, ec));
  const out = [];
  const maxLen = Math.max(...dataBlocks.map((b) => b.length));
  for (let i = 0; i < maxLen; i++) for (const b of dataBlocks) if (i < b.length) out.push(b[i]);
  for (let i = 0; i < ec; i++) for (const b of ecBlocks) out.push(b[i]);
  return out;
}

// ---------- matrix ----------

function makeGrid(size) {
  return { size, mod: Array.from({ length: size }, () => new Array(size).fill(false)), fn: Array.from({ length: size }, () => new Array(size).fill(false)) };
}

function setFn(g, r, c, dark) {
  if (r < 0 || c < 0 || r >= g.size || c >= g.size) return;
  g.mod[r][c] = dark;
  g.fn[r][c] = true;
}

function finder(g, r0, c0) {
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const inside = r >= 0 && r <= 6 && c >= 0 && c <= 6;
      const dark = inside && (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4));
      setFn(g, r0 + r, c0 + c, dark);
    }
  }
}

function functionPatterns(g, v) {
  const n = g.size;
  finder(g, 0, 0);
  finder(g, 0, n - 7);
  finder(g, n - 7, 0);
  for (let i = 8; i < n - 8; i++) {
    setFn(g, 6, i, i % 2 === 0);
    setFn(g, i, 6, i % 2 === 0);
  }
  const al = VERSIONS[v].align;
  for (const r of al) {
    for (const c of al) {
      if ((r === 6 && c === 6) || (r === 6 && c === n - 7) || (r === n - 7 && c === 6)) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) setFn(g, r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
      }
    }
  }
  // Reserve format areas (filled in later) and the dark module.
  for (let i = 0; i < 9; i++) {
    if (i === 6) continue; // timing pattern
    setFn(g, 8, i, false);
    setFn(g, i, 8, false);
  }
  for (let i = 0; i < 8; i++) {
    setFn(g, 8, n - 1 - i, false);
    setFn(g, n - 1 - i, 8, false);
  }
  setFn(g, n - 8, 8, true);
  if (v >= 7) {
    const info = VERSION_INFO[v];
    for (let i = 0; i < 18; i++) {
      const bit = ((info >>> i) & 1) === 1;
      const a = Math.floor(i / 3);
      const b = (i % 3) + n - 11;
      setFn(g, a, b, bit);
      setFn(g, b, a, bit);
    }
  }
}

function placeData(g, codewords) {
  const n = g.size;
  const bits = [];
  for (const cw of codewords) for (let i = 7; i >= 0; i--) bits.push((cw >>> i) & 1);
  let k = 0;
  let upward = true;
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let i = 0; i < n; i++) {
      const row = upward ? n - 1 - i : i;
      for (let j = 0; j < 2; j++) {
        const col = right - j;
        if (g.fn[row][col]) continue;
        g.mod[row][col] = k < bits.length ? bits[k] === 1 : false;
        k++;
      }
    }
    upward = !upward;
  }
}

const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function applyMask(g, m) {
  const f = MASKS[m];
  for (let r = 0; r < g.size; r++) for (let c = 0; c < g.size; c++) if (!g.fn[r][c] && f(r, c)) g.mod[r][c] = !g.mod[r][c];
}

function formatBits(mask) {
  const data = (0b00 << 3) | mask; // level M
  let rem = data << 10;
  for (let i = 14; i >= 10; i--) if ((rem >>> i) & 1) rem ^= 0x537 << (i - 10);
  return ((data << 10) | rem) ^ 0x5412;
}

function drawFormat(g, mask) {
  const n = g.size;
  const bits = formatBits(mask);
  const bit = (i) => ((bits >>> i) & 1) === 1;
  // Copy one, around the top-left finder.
  for (let i = 0; i <= 5; i++) g.mod[i][8] = bit(i);
  g.mod[7][8] = bit(6);
  g.mod[8][8] = bit(7);
  g.mod[8][7] = bit(8);
  for (let i = 9; i < 15; i++) g.mod[8][14 - i] = bit(i);
  // Copy two, split between the top-right and bottom-left finders.
  for (let i = 0; i < 8; i++) g.mod[8][n - 1 - i] = bit(i);
  for (let i = 8; i < 15; i++) g.mod[n - 15 + i][8] = bit(i);
  g.mod[n - 8][8] = true;
}

function penalty(m) {
  const n = m.length;
  let score = 0;
  const lines = (get) => {
    for (let a = 0; a < n; a++) {
      let run = 1;
      for (let b = 1; b < n; b++) {
        if (get(a, b) === get(a, b - 1)) {
          run++;
          if (run === 5) score += 3;
          else if (run > 5) score++;
        } else {
          run = 1;
        }
      }
      for (let b = 0; b + 10 < n + 1; b++) {
        const seq = [];
        for (let k = 0; k < 11 && b + k < n; k++) seq.push(get(a, b + k) ? 1 : 0);
        const s = seq.join('');
        if (s === '10111010000' || s === '00001011101') score += 40;
      }
    }
  };
  lines((a, b) => m[a][b]);
  lines((a, b) => m[b][a]);
  for (let r = 0; r < n - 1; r++) {
    for (let c = 0; c < n - 1; c++) {
      const v = m[r][c];
      if (v === m[r + 1][c] && v === m[r][c + 1] && v === m[r + 1][c + 1]) score += 3;
    }
  }
  let dark = 0;
  for (const row of m) for (const v of row) if (v) dark++;
  score += Math.floor(Math.abs((dark * 20) / (n * n) - 10)) * 10;
  return score;
}

/**
 * Encode text as a QR code. Returns a square matrix of booleans (true = dark).
 * Pass a mask (0–7) to force one; otherwise the best-scoring mask is used.
 */
export function qrMatrix(text, { mask, version } = {}) {
  const bytes = utf8(text);
  const v = version || pickVersion(bytes.length);
  const codewords = interleave(encodeData(bytes, v), v);
  const build = (m) => {
    const g = makeGrid(17 + 4 * v);
    functionPatterns(g, v);
    placeData(g, codewords);
    applyMask(g, m);
    drawFormat(g, m);
    return g.mod;
  };
  if (mask !== undefined) return build(mask);
  let best = null;
  for (let m = 0; m < 8; m++) {
    const mat = build(m);
    const p = penalty(mat);
    if (!best || p < best.p) best = { p, mat };
  }
  return best.mat;
}

/** SVG path for the dark modules, one unit per module. */
export function qrPath(matrix) {
  const parts = [];
  matrix.forEach((row, r) => {
    let c = 0;
    while (c < row.length) {
      if (!row[c]) {
        c++;
        continue;
      }
      const start = c;
      while (c < row.length && row[c]) c++;
      parts.push(`M${start} ${r}h${c - start}v1h${start - c}z`);
    }
  });
  return parts.join('');
}
