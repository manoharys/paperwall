// Runs ONNX models on the graphics card (WebGL2), many times faster than on
// the processor. Each picture-like value (1×C×H×W) lives in a float texture,
// four channels to a texel, the groups of four laid out side by side as
// tiles. Small values (shapes, sizes) stay on the processor, and anything
// the graphics card can't do here falls back to src/model/onnx-ops.js.
// Written from the public ONNX operator descriptions and the WebGL2 spec.

import { applyOp, unsupported, convGeometry, poolGeometry, resizeTarget, workPlan } from '../model/onnx-ops.js';
import { tensor, DTYPE, isFloat } from '../model/onnx.js';

const VERTEX = `#version 300 es
void main() {
  // One triangle that covers the whole target.
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// Shared by every operation: where this texel is (group of four channels, y,
// x), reading a texel of an input, and zeroing channels past the last one.
const PRELUDE = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
out vec4 color;
uniform ivec4 u_o; // output: width, height, tiles across, groups
uniform int u_oc; // output channels
vec4 at(sampler2D t, ivec4 s, int g, int y, int x) {
  return texelFetch(t, ivec2((g % s.z) * s.x + x, (g / s.z) * s.y + y), 0);
}
vec4 compute(int g, int y, int x);
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  int tx = p.x / u_o.x;
  int ty = p.y / u_o.y;
  int g = ty * u_o.z + tx;
  if (g >= u_o.w) { color = vec4(0.0); return; }
  vec4 v = compute(g, p.y - ty * u_o.y, p.x - tx * u_o.x);
  int c = g * 4;
  color = vec4(c < u_oc ? v.x : 0.0, c + 1 < u_oc ? v.y : 0.0, c + 2 < u_oc ? v.z : 0.0, c + 3 < u_oc ? v.w : 0.0);
}
`;

const SHADERS = {
  conv: `
uniform sampler2D u_x; uniform ivec4 u_xs;
uniform sampler2D u_w; uniform int u_ww;
uniform sampler2D u_b;
uniform ivec2 u_k; uniform ivec2 u_s; uniform ivec2 u_d; uniform ivec2 u_p;
uniform int u_relu;
vec4 wt(int i) { return texelFetch(u_w, ivec2(i % u_ww, i / u_ww), 0); }
vec4 compute(int g, int y, int x) {
  vec4 acc = texelFetch(u_b, ivec2(g, 0), 0);
  int taps = u_k.x * u_k.y;
  for (int ig = 0; ig < u_xs.w; ig++) {
    for (int ky = 0; ky < u_k.x; ky++) {
      int iy = y * u_s.x - u_p.x + ky * u_d.x;
      if (iy < 0 || iy >= u_xs.y) continue;
      for (int kx = 0; kx < u_k.y; kx++) {
        int ix = x * u_s.y - u_p.y + kx * u_d.y;
        if (ix < 0 || ix >= u_xs.x) continue;
        int i = ((g * u_xs.w + ig) * taps + ky * u_k.y + kx) * 4;
        acc += mat4(wt(i), wt(i + 1), wt(i + 2), wt(i + 3)) * at(u_x, u_xs, ig, iy, ix);
      }
    }
  }
  return u_relu == 1 ? max(acc, 0.0) : acc;
}`,
  unary: `
uniform sampler2D u_x; uniform ivec4 u_xs;
uniform int u_fn; uniform vec2 u_ab;
vec4 compute(int g, int y, int x) {
  vec4 v = at(u_x, u_xs, g, y, x);
  if (u_fn == 0) return max(v, 0.0);
  if (u_fn == 1) return 1.0 / (1.0 + exp(-v));
  if (u_fn == 2) return mix(v * u_ab.x, v, step(0.0, v));
  if (u_fn == 3) return clamp(v, u_ab.x, u_ab.y);
  if (u_fn == 4) return tanh(v);
  return v;
}`,
  binary: `
uniform sampler2D u_x; uniform ivec4 u_xs;
uniform sampler2D u_y; uniform ivec4 u_ys;
uniform int u_fn;
vec4 compute(int g, int y, int x) {
  vec4 a = at(u_x, u_xs, g, y, x);
  vec4 b = at(u_y, u_ys, g, y, x);
  if (u_fn == 0) return a + b;
  if (u_fn == 1) return a - b;
  if (u_fn == 2) return a * b;
  return a / b;
}`,
  pool: `
uniform sampler2D u_x; uniform ivec4 u_xs;
uniform ivec2 u_k; uniform ivec2 u_s; uniform ivec2 u_d; uniform ivec2 u_p; uniform ivec2 u_end;
uniform int u_max; uniform int u_countpad;
vec4 compute(int g, int y, int x) {
  vec4 best = vec4(-3.4e38);
  vec4 sum = vec4(0.0);
  int n = 0;
  int pads = 0;
  for (int ky = 0; ky < u_k.x; ky++) {
    int iy = y * u_s.x - u_p.x + ky * u_d.x;
    for (int kx = 0; kx < u_k.y; kx++) {
      int ix = x * u_s.y - u_p.y + kx * u_d.y;
      if (iy < 0 || iy >= u_xs.y || ix < 0 || ix >= u_xs.x) {
        if (iy < u_end.x && ix < u_end.y) pads++;
        continue;
      }
      vec4 v = at(u_x, u_xs, g, iy, ix);
      best = max(best, v);
      sum += v;
      n++;
    }
  }
  if (u_max == 1) return best;
  return sum / float(max(1, u_countpad == 1 ? n + pads : n));
}`,
  resize: `
uniform sampler2D u_x; uniform ivec4 u_xs;
uniform int u_mode; uniform int u_coord; uniform int u_round; uniform vec2 u_scale;
float source(float o, float scale, int inLen, int outLen) {
  if (u_coord == 2) return outLen == 1 ? 0.0 : o * float(inLen - 1) / float(outLen - 1);
  if (u_coord == 3) return o / scale;
  if (u_coord == 1) return outLen > 1 ? (o + 0.5) / scale - 0.5 : 0.0;
  if (u_coord == 4) return (o + 0.5) / scale;
  return (o + 0.5) / scale - 0.5;
}
int nearest(float s, int len) {
  int k;
  if (u_round == 1) k = int(floor(s));
  else if (u_round == 2) k = int(ceil(s));
  else if (u_round == 3) k = int(floor(s + 0.5));
  else k = int(ceil(s - 0.5));
  return clamp(k, 0, len - 1);
}
vec4 compute(int g, int y, int x) {
  float sy = source(float(y), u_scale.x, u_xs.y, u_o.y);
  float sx = source(float(x), u_scale.y, u_xs.x, u_o.x);
  if (u_mode == 1) return at(u_x, u_xs, g, nearest(sy, u_xs.y), nearest(sx, u_xs.x));
  sy = clamp(sy, 0.0, float(u_xs.y - 1));
  sx = clamp(sx, 0.0, float(u_xs.x - 1));
  int y0 = int(floor(sy));
  int x0 = int(floor(sx));
  int y1 = min(y0 + 1, u_xs.y - 1);
  int x1 = min(x0 + 1, u_xs.x - 1);
  float fy = sy - float(y0);
  float fx = sx - float(x0);
  vec4 top = mix(at(u_x, u_xs, g, y0, x0), at(u_x, u_xs, g, y0, x1), fx);
  vec4 bottom = mix(at(u_x, u_xs, g, y1, x0), at(u_x, u_xs, g, y1, x1), fx);
  return mix(top, bottom, fy);
}`,
  concat: `
uniform sampler2D u_x; uniform ivec4 u_xs; uniform int u_xc;
uniform sampler2D u_y; uniform ivec4 u_ys;
vec4 compute(int g, int y, int x) {
  vec4 v;
  for (int k = 0; k < 4; k++) {
    int c = g * 4 + k;
    v[k] = c < u_xc ? at(u_x, u_xs, c / 4, y, x)[c % 4] : at(u_y, u_ys, (c - u_xc) / 4, y, x)[(c - u_xc) % 4];
  }
  return v;
}`,
};

const COORDS = { half_pixel: 0, pytorch_half_pixel: 1, align_corners: 2, asymmetric: 3, tf_half_pixel_for_nn: 4 };
const ROUNDING = { round_prefer_floor: 0, floor: 1, ceil: 2, round_prefer_ceil: 3 };
const UNARY = { Relu: 0, Sigmoid: 1, LeakyRelu: 2, Clip: 3, Tanh: 4, Identity: 5 };
const BINARY = { Add: 0, Sub: 1, Mul: 2, Div: 3 };

const size = (dims) => dims.reduce((a, b) => a * b, 1);
const STRIP = 3e8; // multiply-adds per draw, at most (so no one draw holds the graphics card long)
const CATCH_UP = 1e9; // multiply-adds sent before waiting for the graphics card to finish them
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const stopped = (signal) => signal?.reason || new DOMException('Stopped', 'AbortError');

/**
 * A runner on the graphics card, or null when this browser can't (no WebGL2,
 * or no float textures to draw into). Unless `software` is true, a graphics
 * card emulated on the processor doesn't count: it's slower than running on
 * the processor directly.
 */
export function glRunner({ software = false } = {}) {
  let canvas;
  try {
    canvas = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(1, 1) : document.createElement('canvas');
  } catch {
    return null;
  }
  const gl = canvas.getContext('webgl2', { antialias: false, depth: false, stencil: false, alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
  if (!gl || !gl.getExtension('EXT_color_buffer_float')) return null;
  if (!software && isSoftware(gl)) {
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return null;
  }
  return new GlRunner(gl);
}

/** Whether "the graphics card" is really the processor pretending (browsers don't always say so otherwise). */
function isSoftware(gl) {
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const name = `${gl.getParameter(gl.RENDERER)} ${info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : ''}`;
  return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(name);
}

class GlRunner {
  constructor(gl) {
    this.gl = gl;
    this.max = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), 8192);
    this.programs = {};
    this.textures = new Set();
    this.free = new Map(); // "w×h" → textures to reuse
    this.fb = gl.createFramebuffer();
    this.vao = gl.createVertexArray();
  }

  // ---------- textures ----------

  texture(w, h) {
    const gl = this.gl;
    const key = `${w}x${h}`;
    const reuse = this.free.get(key)?.pop();
    if (reuse) return reuse;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, w, h);
    for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.NEAREST);
    for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, p, gl.CLAMP_TO_EDGE);
    t.key = key;
    t.w = w;
    t.h = h;
    this.textures.add(t);
    return t;
  }

  release(t) {
    if (!t) return;
    if (!this.free.has(t.key)) this.free.set(t.key, []);
    this.free.get(t.key).push(t);
  }

  /** Values for a plain data texture (weights, biases): RGBA texels, `width` across. */
  dataTexture(texels, width) {
    const gl = this.gl;
    const h = Math.max(1, Math.ceil(texels.length / 4 / width));
    const data = new Float32Array(width * h * 4);
    data.set(texels);
    const t = this.texture(width, h);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, h, gl.RGBA, gl.FLOAT, data);
    return t;
  }

  /** How a 1×C×H×W value is laid out: groups of four channels, as tiles. */
  layout(dims) {
    if (dims.length !== 4 || dims[0] !== 1) return null;
    const [, C, H, W] = dims;
    const groups = Math.ceil(C / 4);
    let across = Math.min(groups, Math.ceil(Math.sqrt(groups)));
    if (across * W > this.max) across = Math.floor(this.max / W);
    if (!across) return null;
    const down = Math.ceil(groups / across);
    if (down * H > this.max) return null;
    return { C, H, W, groups, across, down, w: across * W, h: down * H };
  }

  /** A processor value onto the graphics card (null if it can't be). */
  upload(t) {
    const L = this.layout(t.dims);
    if (!L || !isFloat(t.dtype)) return null;
    const { C, H, W, across } = L;
    const data = new Float32Array(L.w * L.h * 4);
    const src = t.data;
    for (let c = 0; c < C; c++) {
      const g = c >> 2;
      const ox = (g % across) * W;
      const oy = Math.floor(g / across) * H;
      for (let y = 0; y < H; y++) {
        let i = ((oy + y) * L.w + ox) * 4 + (c & 3);
        let j = (c * H + y) * W;
        for (let x = 0; x < W; x++, i += 4, j++) data[i] = src[j];
      }
    }
    const tex = this.texture(L.w, L.h);
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, L.w, L.h, gl.RGBA, gl.FLOAT, data);
    return { gpu: true, dims: t.dims.slice(), dtype: DTYPE.FLOAT, L, tex };
  }

  /** A graphics-card value back to the processor. */
  download(v) {
    const gl = this.gl;
    const { L } = v;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, v.tex, 0);
    const data = new Float32Array(L.w * L.h * 4);
    gl.readPixels(0, 0, L.w, L.h, gl.RGBA, gl.FLOAT, data);
    const { C, H, W, across } = L;
    const out = new Float32Array(C * H * W);
    for (let c = 0; c < C; c++) {
      const g = c >> 2;
      const ox = (g % across) * W;
      const oy = Math.floor(g / across) * H;
      for (let y = 0; y < H; y++) {
        let i = ((oy + y) * L.w + ox) * 4 + (c & 3);
        let j = (c * H + y) * W;
        for (let x = 0; x < W; x++, i += 4, j++) out[j] = data[i];
      }
    }
    return tensor(v.dims, out, DTYPE.FLOAT);
  }

  // ---------- drawing ----------

  program(name) {
    if (this.programs[name]) return this.programs[name];
    const gl = this.gl;
    const compile = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) throw new Error(`Shader ${name}: ${gl.getShaderInfoLog(s)}`);
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, PRELUDE + SHADERS[name]));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error(`Shader ${name}: ${gl.getProgramInfoLog(p)}`);
    const where = new Map();
    p.loc = (n) => {
      if (!where.has(n)) where.set(n, gl.getUniformLocation(p, n));
      return where.get(n);
    };
    this.programs[name] = p;
    return p;
  }

  /**
   * Draw one operation into a new value of shape `dims`. uniforms: { name:
   * value }, where a value is a texture (bound in turn), an int, [ints] or
   * { f: [floats] }. rows: draw in strips of this many texel rows (so no
   * single draw takes the graphics card too long).
   */
  draw(name, dims, uniforms, rows = 0) {
    const gl = this.gl;
    const L = this.layout(dims);
    if (!L) throw new Error('Too big for the graphics card');
    const out = this.texture(L.w, L.h);
    const p = this.program(name);
    gl.useProgram(p);
    gl.bindVertexArray(this.vao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, out, 0);
    gl.viewport(0, 0, L.w, L.h);
    let unit = 0;
    const all = { u_o: [L.W, L.H, L.across, L.groups], u_oc: L.C, ...uniforms };
    for (const [k, v] of Object.entries(all)) {
      const loc = p.loc(k);
      if (loc === null) continue;
      if (v instanceof WebGLTexture) {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, v);
        gl.uniform1i(loc, unit++);
      } else if (typeof v === 'number') gl.uniform1i(loc, v);
      else if (Array.isArray(v)) gl[`uniform${v.length}iv`](loc, v);
      else gl[`uniform${v.f.length}fv`](loc, v.f);
    }
    if (rows && rows < L.h) {
      gl.enable(gl.SCISSOR_TEST);
      for (let y = 0; y < L.h; y += rows) {
        gl.scissor(0, y, L.w, Math.min(rows, L.h - y));
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.flush();
      }
      gl.disable(gl.SCISSOR_TEST);
    } else gl.drawArrays(gl.TRIANGLES, 0, 3);
    return { gpu: true, dims: dims.slice(), dtype: DTYPE.FLOAT, L, tex: out };
  }

  /** Wait (without blocking the page) until the graphics card has caught up. */
  async settle(pause, signal) {
    const gl = this.gl;
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    try {
      for (;;) {
        const r = gl.clientWaitSync(sync, 0, 0);
        if (r === gl.ALREADY_SIGNALED || r === gl.CONDITION_SATISFIED || r === gl.WAIT_FAILED) break;
        if (gl.isContextLost()) throw new Error('The graphics card stopped');
        await (pause ? pause() : wait(4));
        if (signal?.aborted) throw stopped(signal);
      }
    } finally {
      gl.deleteSync(sync);
    }
    if (gl.isContextLost()) throw new Error('The graphics card stopped');
  }

  // ---------- operations ----------

  /** Weights packed for the conv shader: per output group, input group and tap, a 4×4 block. */
  convWeights(w, b) {
    const [M, C, KH, KW] = w.dims;
    const og = Math.ceil(M / 4);
    const ig = Math.ceil(C / 4);
    const taps = KH * KW;
    const texels = new Float32Array(og * ig * taps * 4 * 4);
    const W = w.data;
    for (let m = 0; m < M; m++) {
      for (let c = 0; c < C; c++) {
        for (let t = 0; t < taps; t++) {
          // Texel (column) j of a block holds input channel j's weight for each of the four outputs.
          const texel = ((((m >> 2) * ig + (c >> 2)) * taps + t) * 4 + (c & 3));
          texels[texel * 4 + (m & 3)] = W[(m * C + c) * taps + t];
        }
      }
    }
    const width = Math.min(this.max, 4096);
    const bias = new Float32Array(og * 4);
    if (b) bias.set(b.data);
    return { w: this.dataTexture(texels, width), ww: width, b: this.dataTexture(bias, og) };
  }

  conv(x, w, b, attrs, relu, rows) {
    const { M, KH, KW, sh, sw, dh, dw, pads: [pt, pl], OH, OW } = convGeometry(x.dims, w.dims, attrs);
    const pack = this.convWeights(w, b);
    const out = this.draw('conv', [1, M, OH, OW], {
      u_x: x.tex, u_xs: shapeOf(x), u_w: pack.w, u_ww: pack.ww, u_b: pack.b,
      u_k: [KH, KW], u_s: [sh, sw], u_d: [dh, dw], u_p: [pt, pl], u_relu: relu ? 1 : 0,
    }, rows);
    this.release(pack.w);
    this.release(pack.b);
    return out;
  }

  pool(x, attrs, max) {
    const { C, H, W, KH, KW, sh, sw, dh, dw, pads: [pt, pl, pb, pr], OH, OW } = poolGeometry(x.dims, attrs);
    return this.draw('pool', [1, C, OH, OW], {
      u_x: x.tex, u_xs: shapeOf(x), u_k: [KH, KW], u_s: [sh, sw], u_d: [dh, dw], u_p: [pt, pl], u_end: [H + pb, W + pr],
      u_max: max ? 1 : 0, u_countpad: attrs.count_include_pad ? 1 : 0,
    });
  }

  resize(x, OH, OW, { mode, coord, nearest, scaleH, scaleW }) {
    return this.draw('resize', [x.dims[0], x.dims[1], OH, OW], {
      u_x: x.tex, u_xs: shapeOf(x), u_mode: mode === 'nearest' ? 1 : 0, u_coord: COORDS[coord] ?? 0,
      u_round: ROUNDING[nearest] ?? 0, u_scale: { f: [scaleH, scaleW] },
    });
  }

  concat(a, b) {
    const dims = [1, a.dims[1] + b.dims[1], a.dims[2], a.dims[3]];
    return this.draw('concat', dims, { u_x: a.tex, u_xs: shapeOf(a), u_xc: a.dims[1], u_y: b.tex, u_ys: shapeOf(b) });
  }

  /**
   * One node on the graphics card, if it can be: returns its outputs, or null
   * (then it runs on the processor). Inputs may be on either.
   */
  node(n, args, fuseRelu, rows) {
    const gpu = (t) => (t?.gpu ? t : t && isFloat(t.dtype) ? this.upload(t) : null);
    const op = n.opType;
    const a = n.attrs;
    const x = args[0];
    if (op === 'Shape') return [tensor([x.dims.length], Float64Array.from(x.dims), DTYPE.INT64)];
    if (!x || !isFloat(x.dtype) || !this.layout(x.dims)) return null;
    if (op === 'Conv') {
      if ((a.group || 1) !== 1 || args[1].dims.length !== 4) return null;
      const X = gpu(x);
      return X && [this.conv(X, args[1], args[2], a, fuseRelu, rows)];
    }
    if (op in UNARY) {
      const X = gpu(x);
      if (!X) return null;
      const lo = op === 'Clip' ? (args[1] ? args[1].data[0] : a.min ?? -3.4e38) : a.alpha ?? 0.01;
      const hi = op === 'Clip' ? (args[2] ? args[2].data[0] : a.max ?? 3.4e38) : 0;
      return [this.draw('unary', x.dims, { u_x: X.tex, u_xs: shapeOf(X), u_fn: UNARY[op], u_ab: { f: [lo, hi] } })];
    }
    if (op in BINARY) {
      const y = args[1];
      if (!y || !isFloat(y.dtype) || y.dims.join() !== x.dims.join()) return null;
      const X = gpu(x);
      const Y = gpu(y);
      return X && Y && [this.draw('binary', x.dims, { u_x: X.tex, u_xs: shapeOf(X), u_y: Y.tex, u_ys: shapeOf(Y), u_fn: BINARY[op] })];
    }
    if (op === 'MaxPool' || op === 'AveragePool') {
      if (n.outputs.length > 1 && n.outputs[1]) return null; // (indices: processor only)
      const X = gpu(x);
      return X && [this.pool(X, a, op === 'MaxPool')];
    }
    if (op === 'Concat') {
      const parts = args.filter((t) => t && size(t.dims) > 0);
      if (axisOf(a.axis ?? 0, 4) !== 1 || !parts.every((t) => isFloat(t.dtype) && t.dims.length === 4 && t.dims[2] === x.dims[2] && t.dims[3] === x.dims[3])) return null;
      const on = parts.map(gpu);
      if (on.some((t) => !t)) return null;
      let acc = on[0];
      for (let i = 1; i < on.length; i++) {
        const next = this.concat(acc, on[i]);
        if (i > 1) this.release(acc.tex);
        acc = next;
      }
      return [acc === on[0] ? this.draw('unary', acc.dims, { u_x: acc.tex, u_xs: shapeOf(acc), u_fn: 5, u_ab: { f: [0, 0] } }) : acc];
    }
    if (op === 'Resize' || op === 'Upsample') {
      const how = resizeTarget(op, x.dims, args, a);
      if (!how) return null;
      const X = gpu(x);
      return X && [this.resize(X, how.OH, how.OW, how)];
    }
    return null;
  }

  destroy() {
    const gl = this.gl;
    for (const t of this.textures) gl.deleteTexture(t);
    for (const p of Object.values(this.programs)) gl.deleteProgram(p);
    gl.deleteFramebuffer(this.fb);
    gl.deleteVertexArray(this.vao);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }

  /**
   * Run a model, like runModel (src/model/onnx-ops.js): feeds { name: tensor }
   * → { output: tensor }, with onProgress, signal and pause.
   */
  async run(model, feeds, { onProgress, signal, pause } = {}) {
    const { graph } = model;
    const missing = unsupported(model);
    if (missing.length) throw new Error(`This model uses operations Paperwall can't run yet: ${missing.join(', ')}`);
    const values = new Map(graph.initializers);
    for (const i of graph.inputs) {
      if (!feeds[i.name]) throw new Error(`The model needs an input called ${i.name}`);
      values.set(i.name, feeds[i.name]);
    }
    const uses = new Map();
    const lastUse = new Map();
    graph.nodes.forEach((n, i) => n.inputs.forEach((name) => {
      uses.set(name, (uses.get(name) || 0) + 1);
      lastUse.set(name, i);
    }));
    const outputs = new Set(graph.outputs.map((o) => o.name));
    const keep = new Set([...outputs, ...graph.initializers.keys()]);
    // Multiply-adds per node (or, for a model the plan can't follow, a guess from the weights).
    const plan = workPlan(model, feeds);
    const work = (n, i) => (plan ? plan.work[i] : n.opType === 'Conv' && values.get(n.inputs[1]) ? size(values.get(n.inputs[1]).dims) * 1e4 : 0);
    const total = graph.nodes.reduce((s, n, i) => s + work(n, i), 0) || 1;
    let done = 0;
    let queued = 0; // work sent to the graphics card since it last caught up
    const drop = (name) => {
      const v = values.get(name);
      if (v?.gpu) this.release(v.tex);
      values.delete(name);
    };
    try {
      for (let i = 0; i < graph.nodes.length; i++) {
        if (signal?.aborted) throw stopped(signal);
        if (this.gl.isContextLost()) throw new Error('The graphics card stopped');
        const n = graph.nodes[i];
        const args = n.inputs.map((name) => {
          if (!name) return undefined;
          if (!values.has(name)) throw new Error(`The model refers to a missing value, ${name}`);
          return values.get(name);
        });
        // A Relu straight after a Conv (and nothing else using the Conv) is done in the same pass.
        const next = graph.nodes[i + 1];
        const fuse = n.opType === 'Conv' && next?.opType === 'Relu' && next.inputs[0] === n.outputs[0] && uses.get(n.outputs[0]) === 1 && !outputs.has(n.outputs[0]);
        const macs = work(n, i);
        // (Big convolutions in strips of texel rows, each about STRIP multiply-adds.)
        const tall = n.opType === 'Conv' && args[0]?.dims.length === 4 ? this.layout([1, args[1].dims[0], args[0].dims[2], args[0].dims[3]])?.h : 0;
        const rows = tall ? Math.max(1, Math.floor(STRIP / (macs / tall))) : 0;
        let outs = this.node(n, args, fuse, rows);
        // On the processor otherwise (fetching anything on the graphics card first).
        if (!outs) outs = applyOp(n, args.map((t) => (t?.gpu ? this.download(t) : t)));
        n.outputs.forEach((name, k) => {
          if (name && outs[k]) values.set(name, outs[k]);
        });
        const end = fuse ? i + 1 : i;
        if (fuse) {
          values.set(next.outputs[0], values.get(n.outputs[0]));
          values.delete(n.outputs[0]);
        }
        // Let go of values nothing later uses.
        for (const name of fuse ? [...n.inputs, ...next.inputs] : n.inputs) {
          if (name && name !== n.outputs[0] && lastUse.get(name) <= end && !keep.has(name) && values.has(name)) drop(name);
        }
        i = end;
        // Let the graphics card catch up every so often: shows real progress, lets a stop happen.
        queued += macs;
        done += macs / total;
        if (queued > CATCH_UP || i === graph.nodes.length - 1) {
          await this.settle(pause, signal);
          queued = 0;
          onProgress?.(Math.min(1, done));
        }
      }
      const result = {};
      for (const o of graph.outputs) {
        const v = values.get(o.name);
        result[o.name] = v?.gpu ? this.download(v) : v;
      }
      onProgress?.(1);
      return result;
    } finally {
      this.destroy();
    }
  }
}

function axisOf(axis, rank) {
  return axis < 0 ? axis + rank : axis;
}

function shapeOf(v) {
  return [v.L.W, v.L.H, v.L.across, v.L.groups];
}
