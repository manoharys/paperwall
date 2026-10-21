// Runs ONNX models: the operations a small image model needs, on plain typed
// arrays, written from the public ONNX operator descriptions. Pure: no DOM.
// Big convolutions are done a slice at a time, so a page can stay responsive
// (it passes `pause`), show progress and stop early.

import { tensor, DTYPE, isFloat } from './onnx.js';

const size = (dims) => dims.reduce((a, b) => a * b, 1);
const floats = (dims, data) => tensor(dims, data || new Float32Array(size(dims)), DTYPE.FLOAT);
const ints = (dims, list) => tensor(dims, Float64Array.from(list), DTYPE.INT64);

/** A tensor's values as plain whole numbers (shapes, indices and the like). */
const intList = (t) => (t ? Array.from(t.data, (v) => Math.trunc(v)) : []);

/** Where a value's own axis lands, for negative axes. */
const axisOf = (axis, rank) => (axis < 0 ? axis + rank : axis);

// ---------- element-wise ----------

function unary(fn) {
  return (x) => {
    const out = new Float32Array(x.data.length);
    for (let i = 0; i < out.length; i++) out[i] = fn(x.data[i]);
    return [tensor(x.dims, out, x.dtype === DTYPE.INT64 ? DTYPE.FLOAT : x.dtype)];
  };
}

/** The shape two shapes broadcast to (numpy rules). */
export function broadcastShape(a, b) {
  const rank = Math.max(a.length, b.length);
  const out = [];
  for (let i = 0; i < rank; i++) {
    const da = a[a.length - rank + i] ?? 1;
    const db = b[b.length - rank + i] ?? 1;
    if (da !== db && da !== 1 && db !== 1) throw new Error(`Shapes ${a} and ${b} don't fit together`);
    out.push(da === 1 ? db : da);
  }
  return out;
}

/** For each output position, where it reads from in a broadcast input. */
function strideMap(dims, outDims) {
  const rank = outDims.length;
  const strides = new Array(rank).fill(0);
  let s = 1;
  for (let i = dims.length - 1; i >= 0; i--) {
    const o = rank - dims.length + i;
    strides[o] = dims[i] === 1 ? 0 : s;
    s *= dims[i];
  }
  return strides;
}

function binary(fn) {
  return (a, b) => {
    const dims = broadcastShape(a.dims, b.dims);
    const n = size(dims);
    const floaty = isFloat(a.dtype) || isFloat(b.dtype);
    const out = floaty ? new Float32Array(n) : new Float64Array(n);
    const A = a.data;
    const B = b.data;
    if (A.length === n && B.length === n) for (let i = 0; i < n; i++) out[i] = fn(A[i], B[i]);
    else if (B.length === 1) for (let i = 0, v = B[0]; i < n; i++) out[i] = fn(A[i], v);
    else if (A.length === 1) for (let i = 0, v = A[0]; i < n; i++) out[i] = fn(v, B[i]);
    else {
      const sa = strideMap(a.dims, dims);
      const sb = strideMap(b.dims, dims);
      const idx = new Array(dims.length).fill(0);
      let ia = 0;
      let ib = 0;
      for (let i = 0; i < n; i++) {
        out[i] = fn(A[ia], B[ib]);
        // Count up the position, last axis first.
        for (let d = dims.length - 1; d >= 0; d--) {
          idx[d]++;
          ia += sa[d];
          ib += sb[d];
          if (idx[d] < dims[d]) break;
          ia -= sa[d] * dims[d];
          ib -= sb[d] * dims[d];
          idx[d] = 0;
        }
      }
    }
    return [tensor(dims, out, floaty ? DTYPE.FLOAT : a.dtype)];
  };
}

const intDiv = (a, b) => Math.trunc(a / b);

// ---------- convolution and pooling ----------

/** Padding for each side of each spatial axis: [top, left, bottom, right] for 2-D. */
function padsFor(attrs, inSize, kernel, strides, dilations) {
  const n = inSize.length;
  const mode = attrs.auto_pad || 'NOTSET';
  if (mode === 'NOTSET') return attrs.pads?.length ? attrs.pads.slice() : new Array(2 * n).fill(0);
  if (mode === 'VALID') return new Array(2 * n).fill(0);
  const pads = new Array(2 * n).fill(0);
  for (let i = 0; i < n; i++) {
    const out = Math.ceil(inSize[i] / strides[i]);
    const total = Math.max(0, (out - 1) * strides[i] + (kernel[i] - 1) * dilations[i] + 1 - inSize[i]);
    const small = Math.floor(total / 2);
    pads[i] = mode === 'SAME_LOWER' ? total - small : small;
    pads[i + n] = total - pads[i];
  }
  return pads;
}

/** Each 2-D plane of x copied into a zero border (so convolutions needn't check edges). */
function padPlanes(x, C, H, W, top, left, bottom, right) {
  if (!top && !left && !bottom && !right) return { data: x, PH: H, PW: W };
  const PH = H + top + bottom;
  const PW = W + left + right;
  const out = new Float32Array(C * PH * PW);
  for (let c = 0; c < C; c++) {
    for (let y = 0; y < H; y++) {
      const src = (c * H + y) * W;
      out.set(x.subarray(src, src + W), (c * PH + y + top) * PW + left);
    }
  }
  return { data: out, PH, PW };
}

const BAND = 32; // rows

/** One input plane's 3×3 kernel (stride 1, any dilation) added into rows y0..y1 of one output plane. */
function taps3x3(o, ob, P, pc, W, w, y0, y1, OW, PW, dh, dw) {
  const a0 = W[w], a1 = W[w + 1], a2 = W[w + 2], a3 = W[w + 3], a4 = W[w + 4], a5 = W[w + 5], a6 = W[w + 6], a7 = W[w + 7], a8 = W[w + 8];
  const d2 = 2 * dw;
  for (let oy = y0; oy < y1; oy++) {
    const r = pc + oy * PW;
    const s = r + dh * PW;
    const t = s + dh * PW;
    const orow = ob + oy * OW;
    for (let x = 0; x < OW; x++) {
      o[orow + x] += a0 * P[r + x] + a1 * P[r + x + dw] + a2 * P[r + x + d2] +
        a3 * P[s + x] + a4 * P[s + x + dw] + a5 * P[s + x + d2] +
        a6 * P[t + x] + a7 * P[t + x + dw] + a8 * P[t + x + d2];
    }
  }
}

/** Any kernel, stride and dilation: one input plane into rows y0..y1 of one output plane. */
function taps(o, ob, P, pc, W, wb, y0, y1, OW, PW, KH, KW, sh, sw, dh, dw) {
  for (let ky = 0; ky < KH; ky++) {
    for (let kx = 0; kx < KW; kx++) {
      const wv = W[wb + ky * KW + kx];
      if (wv === 0) continue;
      for (let oy = y0; oy < y1; oy++) {
        const r = pc + (oy * sh + ky * dh) * PW + kx * dw;
        const orow = ob + oy * OW;
        if (sw === 1) for (let ox = 0; ox < OW; ox++) o[orow + ox] += wv * P[r + ox];
        else for (let ox = 0; ox < OW; ox++) o[orow + ox] += wv * P[r + ox * sw];
      }
    }
  }
}

/** The same for two output planes at once (about twice as fast: the input is read once). */
function taps3x3Pair(o, ob, ob2, P, pc, W, w, v, y0, y1, OW, PW, dh, dw) {
  const a0 = W[w], a1 = W[w + 1], a2 = W[w + 2], a3 = W[w + 3], a4 = W[w + 4], a5 = W[w + 5], a6 = W[w + 6], a7 = W[w + 7], a8 = W[w + 8];
  const b0 = W[v], b1 = W[v + 1], b2 = W[v + 2], b3 = W[v + 3], b4 = W[v + 4], b5 = W[v + 5], b6 = W[v + 6], b7 = W[v + 7], b8 = W[v + 8];
  const d2 = 2 * dw;
  for (let oy = y0; oy < y1; oy++) {
    const r = pc + oy * PW;
    const s = r + dh * PW;
    const t = s + dh * PW;
    const orow = ob + oy * OW;
    const orow2 = ob2 + oy * OW;
    for (let x = 0; x < OW; x++) {
      const p0 = P[r + x], p1 = P[r + x + dw], p2 = P[r + x + d2];
      const p3 = P[s + x], p4 = P[s + x + dw], p5 = P[s + x + d2];
      const p6 = P[t + x], p7 = P[t + x + dw], p8 = P[t + x + d2];
      o[orow + x] += a0 * p0 + a1 * p1 + a2 * p2 + a3 * p3 + a4 * p4 + a5 * p5 + a6 * p6 + a7 * p7 + a8 * p8;
      o[orow2 + x] += b0 * p0 + b1 * p1 + b2 * p2 + b3 * p3 + b4 * p4 + b5 * p5 + b6 * p6 + b7 * p7 + b8 * p8;
    }
  }
}

/** A 2-D window's padding, strides, dilations and output size (for convolutions and pooling). */
function windowGeometry(dims, kernel, attrs, ceil = false) {
  if (dims.length !== 4) throw new Error('Only 2-D convolutions and pooling are supported');
  const [, , H, W] = dims;
  const [KH, KW] = kernel;
  const [sh, sw] = attrs.strides?.length ? attrs.strides : [1, 1];
  const [dh, dw] = attrs.dilations?.length ? attrs.dilations : [1, 1];
  const pads = padsFor(attrs, [H, W], [KH, KW], [sh, sw], [dh, dw]);
  const [pt, pl, pb, pr] = pads;
  const round = ceil ? Math.ceil : Math.floor;
  let OH = round((H + pt + pb - (KH - 1) * dh - 1) / sh) + 1;
  let OW = round((W + pl + pr - (KW - 1) * dw - 1) / sw) + 1;
  // (With ceil_mode, a last window must still start inside the input or its padding.)
  if (ceil && (OH - 1) * sh >= H + pt) OH--;
  if (ceil && (OW - 1) * sw >= W + pl) OW--;
  return { KH, KW, sh, sw, dh, dw, pads, OH, OW };
}

/** A convolution's shapes: input N×C×H×W, weights M×CG×KH×KW, and what comes out. */
export function convGeometry(xDims, wDims, attrs = {}) {
  const [N, C, H, W] = xDims;
  const [M, CG] = wDims;
  const group = attrs.group || 1;
  if (wDims.length !== 4 || CG * group !== C) throw new Error('Convolution weights don\'t fit the input');
  return { N, C, H, W, M, CG, group, ...windowGeometry(xDims, wDims.slice(2), attrs) };
}

/** A pooling window's shapes. */
export function poolGeometry(xDims, attrs) {
  const [N, C, H, W] = xDims;
  return { N, C, H, W, ...windowGeometry(xDims, attrs.kernel_shape, attrs, !!attrs.ceil_mode) };
}

/**
 * Plan a 2-D convolution: shapes and a `step(from, to)` that computes output
 * channels from..to (so it can be done in slices). Inputs NCHW, weights
 * [M, C/group, kH, kW].
 */
export function convPlan(x, w, b, attrs = {}) {
  const { N, C, H, W, M, CG, KH, KW, group, sh, dh, dw, sw, pads: [pt, pl, pb, pr], OH, OW } = convGeometry(x.dims, w.dims, attrs);
  const out = floats([N, M, OH, OW]);
  const MG = M / group;
  const plane = OH * OW;
  const Wt = w.data;
  const bias = b?.data;
  const padded = [];
  for (let n = 0; n < N; n++) padded.push(padPlanes(x.data.subarray(n * C * H * W, (n + 1) * C * H * W), C, H, W, pt, pl, pb, pr));
  const { PH, PW } = padded[0];
  const o = out.data;
  // Output channels from..to, for every image in the batch.
  const fast = KH === 3 && KW === 3 && sh === 1 && sw === 1;
  // Output channels from..to, rows ya..yb, for every image in the batch.
  const step = (from, to, ya = 0, yb = OH) => {
    for (let n = 0; n < N; n++) {
      const P = padded[n].data;
      for (let m = from; m < to;) {
        const g = Math.floor(m / MG);
        // 3×3 kernels go two output channels at a time (each input read once for both).
        const two = fast && m + 1 < to && Math.floor((m + 1) / MG) === g;
        const ob = (n * M + m) * plane;
        o.fill(bias ? bias[m] : 0, ob + ya * OW, ob + yb * OW);
        if (two) o.fill(bias ? bias[m + 1] : 0, ob + plane + ya * OW, ob + plane + yb * OW);
        // A band of rows at a time, through every input channel, so the
        // output being added to stays in the processor's cache.
        for (let y0 = ya; y0 < yb; y0 += BAND) {
          const y1 = Math.min(yb, y0 + BAND);
          for (let cg = 0; cg < CG; cg++) {
            const pc = (g * CG + cg) * PH * PW;
            const wb = (m * CG + cg) * KH * KW;
            if (two) taps3x3Pair(o, ob, ob + plane, P, pc, Wt, wb, wb + CG * 9, y0, y1, OW, PW, dh, dw);
            else if (fast) taps3x3(o, ob, P, pc, Wt, wb, y0, y1, OW, PW, dh, dw);
            else taps(o, ob, P, pc, Wt, wb, y0, y1, OW, PW, KH, KW, sh, sw, dh, dw);
          }
        }
        m += two ? 2 : 1;
      }
    }
  };
  return { out, channels: M, rows: OH, step, work: N * M * plane * CG * KH * KW };
}

function conv(x, w, b, attrs) {
  const plan = convPlan(x, w, b, attrs);
  plan.step(0, plan.channels);
  return [plan.out];
}

function pool(kind) {
  return (x, attrs) => {
    const { N, C, H, W, KH, KW, sh, sw, dh, dw, pads: [pt, pl, pb, pr], OH, OW } = poolGeometry(x.dims, attrs);
    const out = floats([N, C, OH, OW]);
    const X = x.data;
    const o = out.data;
    const countPad = !!attrs.count_include_pad;
    for (let nc = 0; nc < N * C; nc++) {
      const ib = nc * H * W;
      for (let oy = 0; oy < OH; oy++) {
        for (let ox = 0; ox < OW; ox++) {
          let best = -Infinity;
          let sum = 0;
          let count = 0;
          let padCount = 0;
          for (let ky = 0; ky < KH; ky++) {
            const iy = oy * sh - pt + ky * dh;
            for (let kx = 0; kx < KW; kx++) {
              const ix = ox * sw - pl + kx * dw;
              if (iy < 0 || iy >= H || ix < 0 || ix >= W) {
                // (Padding counts for averages only inside the padded area.)
                if (iy < H + pb && ix < W + pr) padCount++;
                continue;
              }
              const v = X[ib + iy * W + ix];
              if (v > best) best = v;
              sum += v;
              count++;
            }
          }
          o[(nc * OH + oy) * OW + ox] = kind === 'max' ? best : sum / Math.max(1, countPad ? count + padCount : count);
        }
      }
    }
    return [out];
  };
}

function globalAveragePool(x) {
  const [N, C] = x.dims;
  const plane = size(x.dims.slice(2));
  const out = floats([N, C, ...x.dims.slice(2).map(() => 1)]);
  for (let i = 0; i < N * C; i++) {
    let s = 0;
    for (let j = 0; j < plane; j++) s += x.data[i * plane + j];
    out.data[i] = s / plane;
  }
  return [out];
}

function batchNorm(x, scale, bias, mean, variance, attrs) {
  const eps = attrs.epsilon ?? 1e-5;
  const [N, C] = x.dims;
  const plane = size(x.dims.slice(2));
  const out = new Float32Array(x.data.length);
  for (let n = 0; n < N; n++) {
    for (let c = 0; c < C; c++) {
      const k = scale.data[c] / Math.sqrt(variance.data[c] + eps);
      const s = bias.data[c] - mean.data[c] * k;
      const base = (n * C + c) * plane;
      for (let i = 0; i < plane; i++) out[base + i] = x.data[base + i] * k + s;
    }
  }
  return [floats(x.dims, out)];
}

// ---------- resizing ----------

/**
 * Where an output position samples the input, for each way of lining the two
 * up (ONNX's coordinate_transformation_mode).
 */
function sourceCoord(mode, outPos, scale, inLen, outLen) {
  switch (mode) {
    case 'align_corners': return outLen === 1 ? 0 : (outPos * (inLen - 1)) / (outLen - 1);
    case 'asymmetric': return outPos / scale;
    case 'pytorch_half_pixel': return outLen > 1 ? (outPos + 0.5) / scale - 0.5 : 0;
    case 'tf_half_pixel_for_nn': return (outPos + 0.5) / scale;
    default: return (outPos + 0.5) / scale - 0.5; // half_pixel
  }
}

/** For one axis: each output position's two input neighbours and the weight of the second. */
function linearTaps(mode, scale, inLen, outLen) {
  const lo = new Int32Array(outLen);
  const hi = new Int32Array(outLen);
  const t = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    let s = sourceCoord(mode, i, scale, inLen, outLen);
    s = Math.min(Math.max(s, 0), inLen - 1);
    const f = Math.floor(s);
    lo[i] = f;
    hi[i] = Math.min(f + 1, inLen - 1);
    t[i] = s - f;
  }
  return { lo, hi, t };
}

function nearestIndex(mode, rounding, scale, inLen, outLen) {
  const idx = new Int32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const s = sourceCoord(mode, i, scale, inLen, outLen);
    let k;
    if (rounding === 'floor') k = Math.floor(s);
    else if (rounding === 'ceil') k = Math.ceil(s);
    else if (rounding === 'round_prefer_ceil') k = Math.floor(s + 0.5);
    else k = Math.ceil(s - 0.5); // round_prefer_floor (the default)
    idx[i] = Math.min(Math.max(k, 0), inLen - 1);
  }
  return idx;
}

/**
 * Resize the last two axes of x to OH×OW (the others must stay the same).
 * mode: 'linear' or 'nearest'.
 */
export function resize2d(x, OH, OW, { mode = 'linear', coord = 'half_pixel', nearest = 'round_prefer_floor', scaleH = OH / x.dims.at(-2), scaleW = OW / x.dims.at(-1) } = {}) {
  const H = x.dims.at(-2);
  const W = x.dims.at(-1);
  const planes = size(x.dims.slice(0, -2));
  const out = floats([...x.dims.slice(0, -2), OH, OW]);
  const X = x.data;
  const o = out.data;
  if (mode === 'nearest') {
    const ys = nearestIndex(coord, nearest, scaleH, H, OH);
    const xs = nearestIndex(coord, nearest, scaleW, W, OW);
    for (let p = 0; p < planes; p++) {
      for (let oy = 0; oy < OH; oy++) {
        const row = p * H * W + ys[oy] * W;
        const orow = (p * OH + oy) * OW;
        for (let ox = 0; ox < OW; ox++) o[orow + ox] = X[row + xs[ox]];
      }
    }
    return out;
  }
  const ty = linearTaps(coord, scaleH, H, OH);
  const tx = linearTaps(coord, scaleW, W, OW);
  for (let p = 0; p < planes; p++) {
    const base = p * H * W;
    for (let oy = 0; oy < OH; oy++) {
      const r0 = base + ty.lo[oy] * W;
      const r1 = base + ty.hi[oy] * W;
      const fy = ty.t[oy];
      const orow = (p * OH + oy) * OW;
      for (let ox = 0; ox < OW; ox++) {
        const a = tx.lo[ox];
        const b = tx.hi[ox];
        const fx = tx.t[ox];
        const top = X[r0 + a] + (X[r0 + b] - X[r0 + a]) * fx;
        const bottom = X[r1 + a] + (X[r1 + b] - X[r1 + a]) * fx;
        o[orow + ox] = top + (bottom - top) * fy;
      }
    }
  }
  return out;
}

function resizeOp(x, roi, scales, sizes, attrs) {
  // (Opset 10 has just X and scales.)
  if (scales === undefined && roi && !sizes) {
    scales = roi;
    roi = null;
  }
  const rank = x.dims.length;
  let outDims;
  let sc;
  if (sizes && sizes.data.length) {
    outDims = intList(sizes);
    sc = outDims.map((d, i) => d / x.dims[i]);
  } else {
    sc = Array.from(scales.data);
    outDims = x.dims.map((d, i) => Math.floor(d * sc[i]));
  }
  for (let i = 0; i < rank - 2; i++) {
    if (outDims[i] !== x.dims[i]) throw new Error('Only resizing the last two axes is supported');
  }
  const mode = attrs.mode === 'nearest' ? 'nearest' : attrs.mode === 'cubic' ? null : 'linear';
  if (!mode) throw new Error('Cubic resizing is not supported');
  return [resize2d(x, outDims[rank - 2], outDims[rank - 1], {
    mode,
    coord: attrs.coordinate_transformation_mode || 'half_pixel',
    nearest: attrs.nearest_mode || 'round_prefer_floor',
    scaleH: sc[rank - 2],
    scaleW: sc[rank - 1],
  })];
}

function upsample(x, scales, attrs) {
  // (Opset 7 and before: scales as an attribute.)
  const sc = scales ? Array.from(scales.data) : attrs.scales;
  const rank = x.dims.length;
  const mode = attrs.mode === 'linear' || attrs.mode === 'bilinear' ? 'linear' : 'nearest';
  return [resize2d(x, Math.floor(x.dims[rank - 2] * sc[rank - 2]), Math.floor(x.dims[rank - 1] * sc[rank - 1]), {
    mode, coord: 'asymmetric', nearest: 'floor', scaleH: sc[rank - 2], scaleW: sc[rank - 1],
  })];
}

/**
 * The output size and sampling of a 4-D Resize or Upsample node that only
 * resizes the last two axes, or null if it isn't one.
 */
export function resizeTarget(op, dims, args, a) {
  let OH;
  let OW;
  let scaleH;
  let scaleW;
  if (op === 'Upsample') {
    const sc = args[1] ? Array.from(args[1].data) : a.scales;
    if (!sc || sc[0] !== 1 || sc[1] !== 1) return null;
    [scaleH, scaleW] = [sc[2], sc[3]];
    OH = Math.floor(dims[2] * scaleH);
    OW = Math.floor(dims[3] * scaleW);
    const mode = a.mode === 'linear' || a.mode === 'bilinear' ? 'linear' : 'nearest';
    return { OH, OW, scaleH, scaleW, mode, coord: 'asymmetric', nearest: 'floor' };
  }
  let [, roi, scales, sizes] = args;
  if (scales === undefined && roi && !sizes) {
    scales = roi;
    roi = null;
  }
  if (sizes && sizes.data.length) {
    const s = Array.from(sizes.data, Math.trunc);
    if (s[0] !== dims[0] || s[1] !== dims[1]) return null;
    [OH, OW] = [s[2], s[3]];
    scaleH = OH / dims[2];
    scaleW = OW / dims[3];
  } else if (scales && scales.data.length === 4) {
    const sc = Array.from(scales.data);
    if (sc[0] !== 1 || sc[1] !== 1) return null;
    [scaleH, scaleW] = [sc[2], sc[3]];
    OH = Math.floor(dims[2] * scaleH);
    OW = Math.floor(dims[3] * scaleW);
  } else return null;
  if (a.mode === 'cubic' || (a.coordinate_transformation_mode || 'half_pixel') === 'tf_crop_and_resize') return null;
  return { OH, OW, scaleH, scaleW, mode: a.mode === 'nearest' ? 'nearest' : 'linear', coord: a.coordinate_transformation_mode || 'half_pixel', nearest: a.nearest_mode || 'round_prefer_floor' };
}

// ---------- shapes ----------

function concat(attrs, ...xs) {
  // (Empty parts add nothing, unless every part is empty.)
  const some = xs.filter((t) => size(t.dims) > 0);
  if (some.length) xs = some;
  const rank = xs[0].dims.length;
  const axis = axisOf(attrs.axis ?? 0, rank);
  const dims = xs[0].dims.slice();
  dims[axis] = xs.reduce((s, t) => s + t.dims[axis], 0);
  const floaty = xs.some((t) => isFloat(t.dtype));
  const out = floaty ? new Float32Array(size(dims)) : new Float64Array(size(dims));
  const outer = size(dims.slice(0, axis));
  const inner = size(dims.slice(axis + 1));
  let at = 0;
  for (let o = 0; o < outer; o++) {
    for (const t of xs) {
      const len = t.dims[axis] * inner;
      out.set(t.data.subarray(o * len, (o + 1) * len), at);
      at += len;
    }
  }
  return [tensor(dims, out, floaty ? DTYPE.FLOAT : xs[0].dtype)];
}

function gather(x, indices, attrs) {
  const rank = x.dims.length;
  const axis = axisOf(attrs.axis || 0, rank);
  const idx = intList(indices).map((i) => (i < 0 ? i + x.dims[axis] : i));
  const dims = [...x.dims.slice(0, axis), ...indices.dims, ...x.dims.slice(axis + 1)];
  const outer = size(x.dims.slice(0, axis));
  const inner = size(x.dims.slice(axis + 1));
  const out = new x.data.constructor(size(dims));
  let at = 0;
  for (let o = 0; o < outer; o++) {
    for (const i of idx) {
      const src = (o * x.dims[axis] + i) * inner;
      out.set(x.data.subarray(src, src + inner), at);
      at += inner;
    }
  }
  return [tensor(dims, out, x.dtype)];
}

function unsqueeze(x, axesIn, attrs) {
  const axes = axesIn ? intList(axesIn) : attrs.axes;
  const rank = x.dims.length + axes.length;
  const dims = x.dims.slice();
  for (const a of axes.map((a) => axisOf(a, rank)).sort((p, q) => p - q)) dims.splice(a, 0, 1);
  return [tensor(dims, x.data, x.dtype)];
}

function squeeze(x, axesIn, attrs) {
  const axes = (axesIn ? intList(axesIn) : attrs.axes || []).map((a) => axisOf(a, x.dims.length));
  const dims = x.dims.filter((d, i) => (axes.length ? !axes.includes(i) : d !== 1));
  return [tensor(dims, x.data, x.dtype)];
}

function reshape(x, shape) {
  const want = intList(shape).map((d, i) => (d === 0 ? x.dims[i] : d));
  const known = want.filter((d) => d !== -1).reduce((a, b) => a * b, 1);
  const dims = want.map((d) => (d === -1 ? size(x.dims) / known : d));
  return [tensor(dims, x.data, x.dtype)];
}

function flatten(x, attrs) {
  const axis = axisOf(attrs.axis ?? 1, x.dims.length);
  return [tensor([size(x.dims.slice(0, axis)), size(x.dims.slice(axis))], x.data, x.dtype)];
}

function slice(x, startsT, endsT, axesT, stepsT, attrs) {
  // (Opset 9 and before: starts, ends and axes as attributes.)
  const starts = startsT ? intList(startsT) : attrs.starts;
  const ends = endsT ? intList(endsT) : attrs.ends;
  const rank = x.dims.length;
  const axes = (axesT ? intList(axesT) : attrs.axes || starts.map((_, i) => i)).map((a) => axisOf(a, rank));
  const steps = stepsT ? intList(stepsT) : axes.map(() => 1);
  const begin = x.dims.map(() => 0);
  const stride = x.dims.map(() => 1);
  const dims = x.dims.slice();
  axes.forEach((a, i) => {
    const d = x.dims[a];
    const st = steps[i];
    const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
    let s = starts[i] < 0 ? starts[i] + d : starts[i];
    let e = ends[i] < 0 ? ends[i] + d : ends[i];
    s = st > 0 ? clamp(s, 0, d) : clamp(s, 0, d - 1);
    e = st > 0 ? clamp(e, 0, d) : clamp(e, -1, d - 1);
    begin[a] = s;
    stride[a] = st;
    dims[a] = Math.max(0, Math.ceil((e - s) / st));
  });
  const out = new x.data.constructor(size(dims));
  const inStrides = x.dims.map((_, i) => size(x.dims.slice(i + 1)));
  const idx = dims.map(() => 0);
  for (let i = 0; i < out.length; i++) {
    let src = 0;
    for (let d = 0; d < rank; d++) src += (begin[d] + idx[d] * stride[d]) * inStrides[d];
    out[i] = x.data[src];
    for (let d = rank - 1; d >= 0; d--) {
      if (++idx[d] < dims[d]) break;
      idx[d] = 0;
    }
  }
  return [tensor(dims, out, x.dtype)];
}

function transpose(x, attrs) {
  const rank = x.dims.length;
  const perm = attrs.perm?.length ? attrs.perm : x.dims.map((_, i) => rank - 1 - i);
  const dims = perm.map((p) => x.dims[p]);
  const inStrides = x.dims.map((_, i) => size(x.dims.slice(i + 1)));
  const out = new x.data.constructor(x.data.length);
  const idx = dims.map(() => 0);
  for (let i = 0; i < out.length; i++) {
    let src = 0;
    for (let d = 0; d < rank; d++) src += idx[d] * inStrides[perm[d]];
    out[i] = x.data[src];
    for (let d = rank - 1; d >= 0; d--) {
      if (++idx[d] < dims[d]) break;
      idx[d] = 0;
    }
  }
  return [tensor(dims, out, x.dtype)];
}

function cast(x, attrs) {
  const to = attrs.to;
  if (isFloat(to)) return [tensor(x.dims, Float32Array.from(x.data), DTYPE.FLOAT)];
  const out = Float64Array.from(x.data, (v) => (to === DTYPE.BOOL ? (v ? 1 : 0) : Math.trunc(v)));
  return [tensor(x.dims, out, to)];
}

/**
 * Every supported operation: (inputs..., attrs) → outputs. Missing optional
 * inputs come as undefined.
 */
export const OPS = {
  Conv: (x, w, b, attrs) => conv(x, w, b, attrs),
  Relu: unary((v) => (v > 0 ? v : 0)),
  LeakyRelu: (x, attrs) => unary((v) => (v > 0 ? v : v * (attrs.alpha ?? 0.01)))(x),
  Sigmoid: unary((v) => 1 / (1 + Math.exp(-v))),
  Tanh: unary(Math.tanh),
  Clip: (x, lo, hi, attrs) => {
    const a = lo ? lo.data[0] : attrs?.min ?? -Infinity;
    const b = hi ? hi.data[0] : attrs?.max ?? Infinity;
    return unary((v) => Math.min(Math.max(v, a), b))(x);
  },
  Add: binary((a, b) => a + b),
  Sub: binary((a, b) => a - b),
  Mul: binary((a, b) => a * b),
  Div: (a, b) => binary(isFloat(a.dtype) || isFloat(b.dtype) ? (p, q) => p / q : intDiv)(a, b),
  Floor: (x) => [tensor(x.dims, x.data.map(Math.floor), x.dtype)],
  MaxPool: (x, attrs) => pool('max')(x, attrs),
  AveragePool: (x, attrs) => pool('avg')(x, attrs),
  GlobalAveragePool: (x) => globalAveragePool(x),
  BatchNormalization: (x, s, b, m, v, attrs) => batchNorm(x, s, b, m, v, attrs),
  Resize: (x, roi, scales, sizes, attrs) => resizeOp(x, roi, scales, sizes, attrs),
  Upsample: (x, scales, attrs) => upsample(x, scales, attrs),
  Concat: (...args) => concat(args.pop(), ...args),
  Shape: (x) => [ints([x.dims.length], x.dims)],
  Gather: (x, i, attrs) => gather(x, i, attrs),
  Unsqueeze: (x, axes, attrs) => unsqueeze(x, axes, attrs),
  Squeeze: (x, axes, attrs) => squeeze(x, axes, attrs),
  Reshape: (x, shape) => reshape(x, shape),
  Flatten: (x, attrs) => flatten(x, attrs),
  Slice: (x, s, e, a, st, attrs) => slice(x, s, e, a, st, attrs),
  Transpose: (x, attrs) => transpose(x, attrs),
  Cast: (x, attrs) => cast(x, attrs),
  Identity: (x) => [x],
  Constant: (attrs) => [attrs.value || (attrs.value_float !== undefined ? floats([], Float32Array.of(attrs.value_float)) : ints([], [attrs.value_int]))],
};

/** How many inputs each operation takes at most (the rest of its arguments are attributes). */
const ARITY = {
  Conv: 3, Clip: 3, BatchNormalization: 5, Resize: 4, Upsample: 2, Gather: 2, Unsqueeze: 2, Squeeze: 2,
  Reshape: 2, Slice: 5, Add: 2, Sub: 2, Mul: 2, Div: 2, Constant: 0,
};

/** Run one node on the processor: its input values (missing ones undefined) → its outputs. */
export function applyOp(node, args) {
  const arity = ARITY[node.opType] ?? (node.opType === 'Concat' ? args.length : 1);
  const list = args.slice(0, arity);
  while (list.length < arity) list.push(undefined);
  return OPS[node.opType](...list, node.attrs);
}

/** Whether a model can run here: the operations it uses that aren't supported. */
export function unsupported(model) {
  return [...new Set(model.graph.nodes.map((n) => n.opType).filter((op) => !OPS[op]))];
}

// ---------- running ----------

const SAME_SHAPE = new Set(['Relu', 'LeakyRelu', 'Sigmoid', 'Tanh', 'Clip', 'Floor', 'Identity', 'BatchNormalization', 'Cast']);
const BROADCAST = new Set(['Add', 'Sub', 'Mul', 'Div']);

/**
 * How much work each node is (multiply-adds; convolutions are nearly all
 * of it), worked out from shapes alone, without running anything big: the
 * picture-sized values are stand-ins with just a shape, while small ones
 * (shapes, sizes) are worked out for real. { work: [per node], total }, or
 * null for a model this can't follow.
 */
export function workPlan(model, feeds) {
  const { graph } = model;
  const values = new Map(graph.initializers);
  const shape = (dims) => ({ dims, dtype: DTYPE.FLOAT, shapeOnly: true });
  for (const i of graph.inputs) if (feeds[i.name]) values.set(i.name, shape(feeds[i.name].dims));
  const work = [];
  let total = 0;
  try {
    for (const n of graph.nodes) {
      const args = n.inputs.map((name) => (name ? values.get(name) : undefined));
      if (n.inputs.some((name, k) => name && !args[k])) return null;
      const x = args[0];
      let outs;
      let w = 0;
      if (!args.some((a) => a?.shapeOnly)) outs = applyOp(n, args); // (small, or made from weights)
      else if (n.opType === 'Shape') outs = applyOp(n, args);
      else if (n.opType === 'Conv') {
        const g = convGeometry(x.dims, args[1].dims, n.attrs);
        outs = [shape([g.N, g.M, g.OH, g.OW])];
        w = g.N * g.M * g.OH * g.OW * size(args[1].dims.slice(1));
      } else if (n.opType === 'MaxPool' || n.opType === 'AveragePool') {
        const g = poolGeometry(x.dims, n.attrs);
        outs = [shape([g.N, g.C, g.OH, g.OW])];
      } else if (SAME_SHAPE.has(n.opType)) outs = [shape(x.dims)];
      else if (BROADCAST.has(n.opType)) outs = [shape(broadcastShape(x.dims, args[1].dims))];
      else if (n.opType === 'Concat') {
        const parts = args.filter((t) => t && size(t.dims) > 0);
        const axis = axisOf(n.attrs.axis ?? 0, parts[0].dims.length);
        const dims = parts[0].dims.slice();
        dims[axis] = parts.reduce((sum, t) => sum + t.dims[axis], 0);
        outs = [shape(dims)];
      } else if (n.opType === 'Resize' || n.opType === 'Upsample') {
        const how = resizeTarget(n.opType, x.dims, args, n.attrs);
        if (!how) return null;
        outs = [shape([x.dims[0], x.dims[1], how.OH, how.OW])];
      } else return null;
      n.outputs.forEach((name, k) => {
        if (name && outs[k]) values.set(name, outs[k]);
      });
      work.push(w);
      total += w;
    }
  } catch {
    return null;
  }
  return { work, total };
}

const now = () => globalThis.performance?.now?.() ?? Date.now();
const SLICE = 2e7; // multiply-adds between checks (a few hundredths of a second)

/**
 * Run a model. feeds: { inputName: tensor }. Returns { outputName: tensor }.
 * opts: onProgress(0..1), signal (an AbortSignal: stops between slices),
 * pause (awaited every ~`budget` ms, so a page can repaint), budget.
 */
export async function runModel(model, feeds, { onProgress, signal, pause, budget = 30 } = {}) {
  const { graph } = model;
  const values = new Map(graph.initializers);
  for (const i of graph.inputs) {
    if (!feeds[i.name]) throw new Error(`The model needs an input called ${i.name}`);
    values.set(i.name, feeds[i.name]);
  }
  const missing = unsupported(model);
  if (missing.length) throw new Error(`This model uses operations Paperwall can't run yet: ${missing.join(', ')}`);
  // When each value is last used, so it can be let go of after.
  const lastUse = new Map();
  graph.nodes.forEach((n, i) => n.inputs.forEach((name) => lastUse.set(name, i)));
  const keep = new Set([...graph.outputs.map((o) => o.name), ...graph.initializers.keys()]);
  // Progress goes by multiply-adds (or, for a model the plan can't follow, by weights).
  const plan = workPlan(model, feeds);
  const weights = (n) => (n.opType === 'Conv' && values.get(n.inputs[1]) ? size(values.get(n.inputs[1]).dims) : 0);
  const workOf = (n, i) => (plan ? plan.work[i] : weights(n));
  const totalWork = (plan ? plan.total : graph.nodes.reduce((s, n) => s + weights(n), 0)) || 1;
  let done = 0;
  let last = now();
  const check = async () => {
    if (signal?.aborted) throw signal.reason || new DOMException('Stopped', 'AbortError');
    if (pause && now() - last > budget) {
      await pause();
      last = now();
      if (signal?.aborted) throw signal.reason || new DOMException('Stopped', 'AbortError');
    }
  };
  for (let i = 0; i < graph.nodes.length; i++) {
    const n = graph.nodes[i];
    const args = n.inputs.map((name) => {
      if (!name) return undefined;
      if (!values.has(name)) throw new Error(`The model refers to a missing value, ${name}`);
      return values.get(name);
    });
    let outs;
    if (n.opType === 'Conv') {
      // Big ones a slice at a time: pairs of output channels, bands of rows.
      const conv = convPlan(args[0], args[1], args[2], n.attrs);
      const share = workOf(n, i) / totalWork;
      const pairs = Math.ceil(conv.channels / 2);
      const perPair = conv.work / pairs;
      const bands = Math.max(1, Math.min(conv.rows, Math.ceil(perPair / SLICE)));
      const rowsPer = Math.ceil(conv.rows / bands);
      const pairsPer = Math.max(1, Math.floor(SLICE / perPair));
      const slices = Math.ceil(pairs / pairsPer) * Math.ceil(conv.rows / rowsPer);
      let sliced = 0;
      for (let p = 0; p < pairs; p += pairsPer) {
        const from = p * 2;
        const to = Math.min(conv.channels, (p + pairsPer) * 2);
        for (let y = 0; y < conv.rows; y += rowsPer) {
          conv.step(from, to, y, Math.min(conv.rows, y + rowsPer));
          onProgress?.(Math.min(1, done + (share * ++sliced) / slices));
          await check();
        }
      }
      done += share;
      outs = [conv.out];
    } else {
      outs = applyOp(n, args);
      await check();
    }
    n.outputs.forEach((name, k) => {
      if (name && outs[k]) values.set(name, outs[k]);
    });
    for (const name of n.inputs) if (lastUse.get(name) === i && !keep.has(name)) values.delete(name);
  }
  onProgress?.(1);
  const result = {};
  for (const o of graph.outputs) result[o.name] = values.get(o.name);
  return result;
}
