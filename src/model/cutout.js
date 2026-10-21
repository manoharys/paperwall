// Cutting the subject out of a photo with a segmentation model (U²-Net
// style: a picture in, a "how likely is this the subject" map out). This is
// the part before and after the model: shrinking the photo to the model's
// size, and turning its answer into see-through edges at full size. Pure:
// works on raw RGBA pixels, so it runs anywhere.

import { tensor } from './onnx.js';

/** The side the model looks at (U²-Net was trained on 320×320). */
export const MODEL_SIZE = 320;

// The usual photo statistics these models are trained with (per color: mean, spread).
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

/**
 * For one axis: which source positions make each output position, and how
 * much each counts. Shrinking averages the area covered; growing blends the
 * two nearest (pixel centers lined up).
 */
function axisWeights(from, to) {
  const idx = [];
  const wts = [];
  const scale = from / to;
  for (let i = 0; i < to; i++) {
    const ii = [];
    const ww = [];
    if (scale > 1) {
      const a = i * scale;
      const b = a + scale;
      for (let s = Math.floor(a); s < Math.min(from, Math.ceil(b)); s++) {
        const w = Math.min(b, s + 1) - Math.max(a, s);
        if (w > 0) {
          ii.push(s);
          ww.push(w / scale);
        }
      }
    } else {
      const s = Math.min(Math.max((i + 0.5) * scale - 0.5, 0), from - 1);
      const lo = Math.floor(s);
      const hi = Math.min(lo + 1, from - 1);
      const t = s - lo;
      ii.push(lo, hi);
      ww.push(1 - t, t);
    }
    idx.push(ii);
    wts.push(ww);
  }
  return { idx, wts };
}

/**
 * Resize planes of floats (`planes` of them, each sw×sh, one after another)
 * to dw×dh: area-averaged when shrinking, blended when growing.
 */
export function resizePlanes(src, sw, sh, planes, dw, dh) {
  const xw = axisWeights(sw, dw);
  const yw = axisWeights(sh, dh);
  const mid = new Float32Array(sh * dw);
  const out = new Float32Array(planes * dw * dh);
  for (let p = 0; p < planes; p++) {
    const base = p * sw * sh;
    // Across first, then down.
    for (let y = 0; y < sh; y++) {
      const row = base + y * sw;
      for (let x = 0; x < dw; x++) {
        const ii = xw.idx[x];
        const ww = xw.wts[x];
        let v = 0;
        for (let k = 0; k < ii.length; k++) v += src[row + ii[k]] * ww[k];
        mid[y * dw + x] = v;
      }
    }
    for (let y = 0; y < dh; y++) {
      const ii = yw.idx[y];
      const ww = yw.wts[y];
      const o = p * dw * dh + y * dw;
      for (let x = 0; x < dw; x++) {
        let v = 0;
        for (let k = 0; k < ii.length; k++) v += mid[ii[k] * dw + x] * ww[k];
        out[o + x] = v;
      }
    }
  }
  return out;
}

/**
 * RGBA pixels → the model's input, 1×3×size×size: the photo squeezed to a
 * square, each value divided by the brightest one, then normalized by the
 * usual photo statistics. (Transparent pixels count as black.)
 */
export function modelInput(rgba, w, h, size = MODEL_SIZE) {
  const planes = new Float32Array(3 * w * h);
  let max = 0;
  for (let p = 0; p < w * h; p++) {
    const a = rgba[p * 4 + 3] / 255;
    for (let c = 0; c < 3; c++) {
      const v = rgba[p * 4 + c] * a;
      planes[c * w * h + p] = v;
      if (v > max) max = v;
    }
  }
  const small = resizePlanes(planes, w, h, 3, size, size);
  const k = 1 / (max || 1);
  const n = size * size;
  for (let c = 0; c < 3; c++) {
    for (let i = 0; i < n; i++) small[c * n + i] = (small[c * n + i] * k - MEAN[c]) / STD[c];
  }
  return tensor([1, 3, size, size], small);
}

/**
 * The model's answer (1×1×H×W, any range) → a mask from 0 (background) to 1
 * (subject), stretched so the least likely pixel is 0 and the most likely 1.
 */
export function maskFromOutput(t) {
  const [, , mh, mw] = t.dims;
  const n = mw * mh;
  const src = t.data.subarray(0, n);
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < n; i++) {
    if (src[i] < lo) lo = src[i];
    if (src[i] > hi) hi = src[i];
  }
  const span = hi - lo;
  const mask = new Float32Array(n);
  // (All one value: nothing stands out, so nothing is the subject.)
  if (span > 1e-6) for (let i = 0; i < n; i++) mask[i] = (src[i] - lo) / span;
  return { mask, mw, mh };
}

/** Box-blur a plane in place, `r` pixels each way (across, then down). */
function blur(plane, w, h, r) {
  if (r < 1) return;
  const tmp = new Float32Array(Math.max(w, h));
  const pass = (len, count, at) => {
    for (let k = 0; k < count; k++) {
      let sum = 0;
      for (let i = -r; i <= r; i++) sum += plane[at(k, Math.min(len - 1, Math.max(0, i)))];
      for (let i = 0; i < len; i++) {
        tmp[i] = sum / (2 * r + 1);
        sum += plane[at(k, Math.min(len - 1, i + r + 1))] - plane[at(k, Math.max(0, i - r))];
      }
      for (let i = 0; i < len; i++) plane[at(k, i)] = tmp[i];
    }
  };
  pass(w, h, (row, x) => row * w + x);
  pass(h, w, (col, y) => y * w + col);
}

/**
 * The see-through amount for every pixel of a w×h picture, from a model's
 * mask. refine: 0 keeps the model's soft edges as they are, 1 makes them
 * crisp (and drops faint haze). feather: softens the final edge by this many
 * pixels (scaled up for big pictures).
 */
export function alphaFromMask({ mask, mw, mh }, w, h, { refine = 0.5, feather = 1 } = {}) {
  const alpha = resizePlanes(mask, mw, mh, 1, w, h);
  const width = Math.max(0.04, 1 - Math.min(1, Math.max(0, refine)) * 0.96);
  const lo = 0.5 - width / 2;
  for (let i = 0; i < alpha.length; i++) {
    const t = Math.min(1, Math.max(0, (alpha[i] - lo) / width));
    alpha[i] = t * t * (3 - 2 * t); // (eased, so edges fade rather than step)
  }
  blur(alpha, w, h, Math.round(feather * Math.max(1, Math.min(w, h) / 600)));
  return alpha;
}

/**
 * Apply a mask to RGBA pixels, in place (multiplying what's there, so parts
 * already see-through stay so). Returns the share of the picture cleared (0..1).
 */
export function applyMask(rgba, w, h, mask, opts) {
  const alpha = alphaFromMask(mask, w, h, opts);
  let cleared = 0;
  for (let p = 0; p < w * h; p++) {
    const a = alpha[p];
    rgba[p * 4 + 3] = Math.round(rgba[p * 4 + 3] * a);
    cleared += 1 - a;
  }
  return cleared / (w * h);
}
