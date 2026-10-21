// Reads ONNX model files: the graph (which operations, wired how) and its
// weights. ONNX files are Protocol Buffers; this is a small reader for just
// the parts a model needs, written from the public ONNX format description
// (onnx.proto). Pure: no DOM, so it runs anywhere.

// ---------- protocol buffers ----------

const utf8 = new TextDecoder();

/** A cursor over protobuf bytes. */
class Reader {
  constructor(bytes, start = 0, end = bytes.length) {
    this.b = bytes;
    this.pos = start;
    this.end = end;
  }

  /** An unsigned varint, as a Number (exact up to 2^53). */
  varint() {
    let n = 0;
    let mul = 1;
    for (;;) {
      if (this.pos >= this.end) throw new Error('This model file is cut short');
      const byte = this.b[this.pos++];
      n += (byte & 0x7f) * mul;
      if (byte < 0x80) return n;
      mul *= 128;
      if (mul > 2 ** 70) throw new Error('This model file is damaged');
    }
  }

  /** A signed int64 varint (two's complement over 64 bits) as a Number. */
  int64() {
    // Short ones (most) as Numbers; long ones, negative numbers among them, exactly.
    let end = this.pos;
    while (end < this.end && this.b[end] >= 0x80) end++;
    if (end - this.pos < 7) return this.varint();
    if (end >= this.end) throw new Error('This model file is cut short');
    let v = 0n;
    for (let i = end; i >= this.pos; i--) v = (v << 7n) | BigInt(this.b[i] & 0x7f);
    this.pos = end + 1;
    return Number(BigInt.asIntN(64, v));
  }

  /** The next field's number and wire type, or null at the end. */
  tag() {
    if (this.pos >= this.end) return null;
    const t = this.varint();
    return { field: Math.floor(t / 8), wire: t % 8 };
  }

  /** A length-delimited field's bounds (and skip past it). */
  span() {
    const len = this.varint();
    const start = this.pos;
    if (start + len > this.end) throw new Error('This model file is cut short');
    this.pos += len;
    return [start, start + len];
  }

  bytes() {
    const [s, e] = this.span();
    return this.b.subarray(s, e);
  }

  string() {
    return utf8.decode(this.bytes());
  }

  sub() {
    const [s, e] = this.span();
    return new Reader(this.b, s, e);
  }

  float32() {
    const v = new DataView(this.b.buffer, this.b.byteOffset + this.pos, 4).getFloat32(0, true);
    this.pos += 4;
    return v;
  }

  skip(wire) {
    if (wire === 0) this.varint();
    else if (wire === 1) this.pos += 8;
    else if (wire === 2) this.span();
    else if (wire === 5) this.pos += 4;
    else throw new Error(`This model file uses an unknown encoding (${wire})`);
  }

  /** Repeated varints, packed (wire 2) or one at a time. */
  ints(wire, out, signed = true) {
    if (wire === 2) {
      const r = this.sub();
      while (r.pos < r.end) out.push(signed ? r.int64() : r.varint());
    } else out.push(signed ? this.int64() : this.varint());
  }

  /** Repeated floats, packed or one at a time. */
  floats(wire, out) {
    if (wire === 2) {
      const r = this.sub();
      while (r.pos < r.end) out.push(r.float32());
    } else out.push(this.float32());
  }

  /** Each field in turn: fn(field, wire, reader). */
  each(fn) {
    for (let t = this.tag(); t; t = this.tag()) {
      if (fn(t.field, t.wire) === false) this.skip(t.wire);
    }
  }
}

// ---------- ONNX messages ----------

/** ONNX element types, by number. */
export const DTYPE = { FLOAT: 1, UINT8: 2, INT8: 3, INT32: 6, INT64: 7, BOOL: 9, FLOAT16: 10, DOUBLE: 11 };

/** A tensor: its shape and its values (floats as Float32Array, whole numbers as Float64Array). */
export function tensor(dims, data, dtype = DTYPE.FLOAT) {
  return { dims: dims.slice(), data, dtype };
}

export const isFloat = (dtype) => dtype === DTYPE.FLOAT || dtype === DTYPE.FLOAT16 || dtype === DTYPE.DOUBLE;

const size = (dims) => dims.reduce((a, b) => a * b, 1);

function halfToFloat(h) {
  const s = h & 0x8000 ? -1 : 1;
  const e = (h >> 10) & 0x1f;
  const f = h & 0x3ff;
  if (e === 0) return s * f * 2 ** -24;
  if (e === 31) return f ? NaN : s * Infinity;
  return s * (1 + f / 1024) * 2 ** (e - 15);
}

/** Turn a tensor's raw little-endian bytes into values. */
function fromRaw(raw, dtype, count) {
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  if (dtype === DTYPE.FLOAT) {
    if (raw.byteLength < count * 4) throw new Error('A weight in this model is cut short');
    // (Copied out: the bytes may not sit on a 4-byte boundary.)
    const out = new Float32Array(count);
    for (let i = 0; i < count; i++) out[i] = view.getFloat32(i * 4, true);
    return out;
  }
  const out = new Float64Array(count);
  const read = {
    [DTYPE.INT64]: (i) => Number(view.getBigInt64(i * 8, true)),
    [DTYPE.INT32]: (i) => view.getInt32(i * 4, true),
    [DTYPE.INT8]: (i) => view.getInt8(i),
    [DTYPE.UINT8]: (i) => view.getUint8(i),
    [DTYPE.BOOL]: (i) => view.getUint8(i),
    [DTYPE.DOUBLE]: (i) => view.getFloat64(i * 8, true),
    [DTYPE.FLOAT16]: (i) => halfToFloat(view.getUint16(i * 2, true)),
  }[dtype];
  if (!read) throw new Error(`This model uses an unsupported number type (${dtype})`);
  for (let i = 0; i < count; i++) out[i] = read(i);
  return isFloat(dtype) ? Float32Array.from(out) : out;
}

function readTensor(r) {
  const dims = [];
  let dtype = DTYPE.FLOAT;
  let name = '';
  let raw = null;
  let external = false;
  const floats = [];
  const ints = [];
  r.each((field, wire) => {
    if (field === 1) r.ints(wire, dims);
    else if (field === 2) dtype = r.varint();
    else if (field === 4) r.floats(wire, floats);
    else if (field === 5 || field === 7) r.ints(wire, ints);
    else if (field === 8) name = r.string();
    else if (field === 9) raw = r.bytes();
    else if (field === 10) {
      // doubles: rare; read as 64-bit values
      const sub = wire === 2 ? r.sub() : null;
      if (sub) for (; sub.pos < sub.end; sub.pos += 8) floats.push(new DataView(sub.b.buffer, sub.b.byteOffset + sub.pos, 8).getFloat64(0, true));
      else r.skip(wire);
    } else if (field === 14) external = r.varint() === 1;
    else return false;
  });
  if (external) throw new Error('This model keeps its weights in another file');
  const count = size(dims);
  let data;
  if (raw) data = fromRaw(raw, dtype, count);
  else if (isFloat(dtype)) data = Float32Array.from(floats);
  else data = Float64Array.from(ints);
  if (data.length !== count) throw new Error(`Weight ${name || '(unnamed)'} has ${data.length} values, expected ${count}`);
  return { name, ...tensor(dims, data, isFloat(dtype) ? DTYPE.FLOAT : dtype) };
}

const ATTR = { FLOAT: 1, INT: 2, STRING: 3, TENSOR: 4, FLOATS: 6, INTS: 7, STRINGS: 8 };

function readAttribute(r) {
  let name = '';
  let type = 0;
  const v = { f: 0, i: 0, s: '', t: null, floats: [], ints: [], strings: [] };
  r.each((field, wire) => {
    if (field === 1) name = r.string();
    else if (field === 20) type = r.varint();
    else if (field === 2) v.f = r.float32();
    else if (field === 3) v.i = r.int64();
    else if (field === 4) v.s = r.string();
    else if (field === 5) v.t = readTensor(r.sub());
    else if (field === 7) r.floats(wire, v.floats);
    else if (field === 8) r.ints(wire, v.ints);
    else if (field === 9) v.strings.push(r.string());
    else return false;
  });
  // (Old files may leave the type out: go by what's there.)
  if (!type) type = v.t ? ATTR.TENSOR : v.ints.length ? ATTR.INTS : v.floats.length ? ATTR.FLOATS : v.strings.length ? ATTR.STRINGS : v.s ? ATTR.STRING : v.f ? ATTR.FLOAT : ATTR.INT;
  const value = {
    [ATTR.FLOAT]: v.f, [ATTR.INT]: v.i, [ATTR.STRING]: v.s, [ATTR.TENSOR]: v.t,
    [ATTR.FLOATS]: v.floats, [ATTR.INTS]: v.ints, [ATTR.STRINGS]: v.strings,
  }[type];
  return { name, value };
}

function readNode(r) {
  const node = { opType: '', name: '', domain: '', inputs: [], outputs: [], attrs: {} };
  r.each((field) => {
    if (field === 1) node.inputs.push(r.string());
    else if (field === 2) node.outputs.push(r.string());
    else if (field === 3) node.name = r.string();
    else if (field === 4) node.opType = r.string();
    else if (field === 7) node.domain = r.string();
    else if (field === 5) {
      const a = readAttribute(r.sub());
      node.attrs[a.name] = a.value;
    } else return false;
  });
  return node;
}

/** A graph input or output's type: TypeProto → tensor_type → elem_type, shape → dims (a number, or a name for a size that varies). */
function readType(r, info) {
  r.each((field) => {
    if (field !== 1) return false; // tensor_type
    const t = r.sub();
    t.each((f) => {
      if (f === 1) info.dtype = t.varint();
      else if (f === 2) {
        info.shape = [];
        const s = t.sub();
        s.each((g) => {
          if (g !== 1) return false;
          const d = s.sub();
          let dim = null;
          d.each((h) => {
            if (h === 1) dim = d.int64();
            else if (h === 2) dim = d.string();
            else return false;
          });
          info.shape.push(dim);
        });
      } else return false;
    });
  });
}

function readValue(r) {
  const info = { name: '', dtype: 0, shape: null };
  r.each((field) => {
    if (field === 1) info.name = r.string();
    else if (field === 2) readType(r.sub(), info);
    else return false;
  });
  return info;
}

function readGraph(r) {
  const graph = { name: '', nodes: [], initializers: new Map(), inputs: [], outputs: [] };
  r.each((field) => {
    if (field === 1) graph.nodes.push(readNode(r.sub()));
    else if (field === 2) graph.name = r.string();
    else if (field === 5) {
      const t = readTensor(r.sub());
      graph.initializers.set(t.name, t);
    } else if (field === 11) graph.inputs.push(readValue(r.sub()));
    else if (field === 12) graph.outputs.push(readValue(r.sub()));
    else return false;
  });
  // Inputs that are really weights (older files list both) aren't asked for.
  graph.inputs = graph.inputs.filter((i) => !graph.initializers.has(i.name));
  return graph;
}

/**
 * Read an ONNX model from its bytes: { irVersion, opset, producer, graph }.
 * graph: { nodes: [{ opType, inputs, outputs, attrs }], initializers: Map,
 * inputs: [{ name, shape }], outputs: [...] }.
 */
export function readModel(bytes) {
  if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
  const r = new Reader(bytes);
  const model = { irVersion: 0, opset: {}, producer: '', graph: null };
  r.each((field) => {
    if (field === 1) model.irVersion = r.varint();
    else if (field === 2) model.producer = r.string();
    else if (field === 7) model.graph = readGraph(r.sub());
    else if (field === 8) {
      const o = r.sub();
      let domain = '';
      let version = 0;
      o.each((f) => {
        if (f === 1) domain = o.string();
        else if (f === 2) version = o.varint();
        else return false;
      });
      model.opset[domain || 'ai.onnx'] = version;
    } else return false;
  });
  if (!model.graph) throw new Error("This isn't an ONNX model");
  return model;
}

/** Which operations a model uses, and how often (to check it can run). */
export function opsUsed(model) {
  const counts = {};
  for (const n of model.graph.nodes) counts[n.opType] = (counts[n.opType] || 0) + 1;
  return counts;
}

// ---------- writing (for tests, and for making tiny models) ----------

/** Builds protobuf bytes, field by field. */
export class Writer {
  constructor() {
    this.parts = [];
    this.length = 0;
  }

  raw(bytes) {
    this.parts.push(bytes);
    this.length += bytes.length;
    return this;
  }

  varint(n) {
    // (Negative numbers as 64-bit two's complement, like int64 fields.)
    let v = n < 0 ? BigInt.asUintN(64, BigInt(n)) : BigInt(n);
    const out = [];
    do {
      let byte = Number(v & 0x7fn);
      v >>= 7n;
      if (v) byte |= 0x80;
      out.push(byte);
    } while (v);
    return this.raw(Uint8Array.from(out));
  }

  tag(field, wire) {
    return this.varint(field * 8 + wire);
  }

  int(field, n) {
    return this.tag(field, 0).varint(n);
  }

  bytes(field, bytes) {
    return this.tag(field, 2).varint(bytes.length).raw(bytes);
  }

  string(field, s) {
    return this.bytes(field, new TextEncoder().encode(s));
  }

  message(field, w) {
    return this.bytes(field, w.finish());
  }

  float(field, f) {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setFloat32(0, f, true);
    return this.tag(field, 5).raw(b);
  }

  packedInts(field, list) {
    const w = new Writer();
    for (const n of list) w.varint(n);
    return this.message(field, w);
  }

  finish() {
    const out = new Uint8Array(this.length);
    let at = 0;
    for (const p of this.parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  }
}

/** A tensor message: floats go as raw bytes, whole numbers as int64s. */
export function writeTensor(name, dims, values, dtype = DTYPE.FLOAT) {
  const w = new Writer().packedInts(1, dims).int(2, dtype).string(8, name);
  if (dtype === DTYPE.FLOAT) {
    const raw = new Uint8Array(values.length * 4);
    const v = new DataView(raw.buffer);
    values.forEach((x, i) => v.setFloat32(i * 4, x, true));
    w.bytes(9, raw);
  } else w.packedInts(7, values);
  return w;
}

function writeAttribute(name, value) {
  const w = new Writer().string(1, name);
  if (value && value.dims) return w.message(5, writeTensor('', value.dims, [...value.data], value.dtype)).int(20, ATTR.TENSOR);
  if (typeof value === 'string') return w.string(4, value).int(20, ATTR.STRING);
  if (value && typeof value.f === 'number') return w.float(2, value.f).int(20, ATTR.FLOAT);
  if (Array.isArray(value)) {
    if (value.every(Number.isInteger)) return w.packedInts(8, value).int(20, ATTR.INTS);
    for (const f of value) w.float(7, f);
    return w.int(20, ATTR.FLOATS);
  }
  if (Number.isInteger(value)) return w.int(3, value).int(20, ATTR.INT);
  return w.float(2, value).int(20, ATTR.FLOAT);
}

function writeValue(name, shape, dtype = DTYPE.FLOAT) {
  const dims = new Writer();
  for (const d of shape) dims.message(1, typeof d === 'string' ? new Writer().string(2, d) : new Writer().int(1, d));
  const tt = new Writer().int(1, dtype).message(2, dims);
  return new Writer().string(1, name).message(2, new Writer().message(1, tt));
}

/**
 * Write a model as ONNX bytes. spec: { opset, inputs: [{ name, shape }],
 * outputs: [{ name, shape }], nodes: [{ op, inputs, outputs, attrs }],
 * weights: [{ name, dims, data, dtype? }] }. (A whole-number float
 * attribute, like 1.0, goes as { f: 1 }: plain whole numbers are ints.)
 */
export function writeModel({ opset = 11, inputs, outputs, nodes, weights = [], name = 'tiny' }) {
  const g = new Writer();
  for (const n of nodes) {
    const nw = new Writer();
    for (const i of n.inputs) nw.string(1, i);
    for (const o of n.outputs) nw.string(2, o);
    nw.string(4, n.op);
    for (const [k, v] of Object.entries(n.attrs || {})) nw.message(5, writeAttribute(k, v));
    g.message(1, nw);
  }
  g.string(2, name);
  for (const t of weights) g.message(5, writeTensor(t.name, t.dims, [...t.data], t.dtype));
  for (const i of inputs) g.message(11, writeValue(i.name, i.shape));
  for (const o of outputs) g.message(12, writeValue(o.name, o.shape));
  return new Writer().int(1, 7).string(2, 'paperwall').message(7, g).message(8, new Writer().string(1, '').int(2, opset)).finish();
}
