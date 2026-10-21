import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readModel, writeModel, opsUsed, tensor, DTYPE } from '../../src/model/onnx.js';
import { runModel, applyOp, broadcastShape, unsupported, workPlan } from '../../src/model/onnx-ops.js';
import { modelInput, maskFromOutput, applyMask, alphaFromMask, resizePlanes } from '../../src/model/cutout.js';
import { tinyCutoutModel, opsModel } from '../fixtures/tiny-models.js';

// ---------- a tiny protobuf encoder of its own (so the reader isn't checked against its own writer) ----------

const varint = (n) => {
  let v = BigInt.asUintN(64, BigInt(n));
  const out = [];
  do {
    const b = Number(v & 127n);
    v >>= 7n;
    out.push(v ? b | 128 : b);
  } while (v);
  return out;
};
const key = (field, wire) => varint(field * 8 + wire);
const vint = (field, n) => [...key(field, 0), ...varint(n)];
const len = (field, bytes) => [...key(field, 2), ...varint(bytes.length), ...bytes];
const str = (field, s) => len(field, [...Buffer.from(s, 'utf8')]);
const f32 = (x) => [...new Uint8Array(Float32Array.of(x).buffer)];
const fixed32 = (field, x) => [...key(field, 5), ...f32(x)];
const packed = (field, list) => len(field, list.flatMap(varint));

const f = (x) => Math.fround(x);
const close = (a, b, eps = 1e-5) => {
  assert.equal(a.length, b.length, `length ${a.length} vs ${b.length}`);
  for (let i = 0; i < a.length; i++) assert.ok(Math.abs(a[i] - b[i]) <= eps, `at ${i}: ${a[i]} vs ${b[i]}`);
};
const T = (dims, data) => tensor(dims, Float32Array.from(data));
const I = (dims, data) => tensor(dims, Float64Array.from(data), DTYPE.INT64);
const op = (name, inputs, attrs = {}) => applyOp({ opType: name, attrs }, inputs)[0];

test('[IMG-11] the ONNX reader reads a hand-written model: nodes, attributes, weights, shapes', () => {
  const node = [
    ...str(1, 'x'), ...str(1, 'w'), ...str(2, 'y'), ...str(3, 'conv0'), ...str(4, 'Conv'),
    ...len(5, [...str(1, 'kernel_shape'), ...packed(8, [3, 3]), ...vint(20, 7)]),
    ...len(5, [...str(1, 'alpha'), ...fixed32(2, 0.5), ...vint(20, 1)]),
    ...len(5, [...str(1, 'mode'), ...str(4, 'linear'), ...vint(20, 3)]),
    ...len(5, [...str(1, 'axis'), ...vint(3, -1), ...vint(20, 2)]),
    // (Ints one at a time, not packed, are fine too.)
    ...len(5, [...str(1, 'pads'), ...vint(8, 1), ...vint(8, 2), ...vint(20, 7)]),
    ...len(5, [...str(1, 'value'), ...len(5, [...vint(1, 2), ...vint(2, 7), ...packed(7, [5, -6])]), ...vint(20, 4)]),
    ...vint(99, 12345), // an unknown field: skipped
  ];
  const weightFloats = [...vint(1, 2), ...vint(1, 2), ...vint(2, 1), ...len(4, [1.5, -2, 3, 0.25].flatMap(f32)), ...str(8, 'w')];
  const weightRaw = [...packed(1, [3]), ...vint(2, 1), ...str(8, 'raw'), ...len(9, [7, 8, 9].flatMap(f32))];
  const weightInts = [...packed(1, [2]), ...vint(2, 7), ...str(8, 'ints'), ...packed(7, [-3, 4000000000])];
  const dim = (d) => len(1, typeof d === 'string' ? str(2, d) : vint(1, d));
  const valueInfo = (name, dims) => [...str(1, name), ...len(2, len(1, [...vint(1, 1), ...len(2, dims.flatMap(dim))]))];
  const graph = [
    ...len(1, node), ...str(2, 'g'),
    ...len(5, weightFloats), ...len(5, weightRaw), ...len(5, weightInts),
    ...len(11, valueInfo('x', [1, 3, 'height', 'width'])),
    ...len(11, valueInfo('w', [2, 2])), // (a weight listed as an input too: not asked for)
    ...len(12, valueInfo('y', [1, 2, 4, 4])),
    ...key(98, 1), 1, 2, 3, 4, 5, 6, 7, 8, // an unknown 64-bit field: skipped
  ];
  const model = [...vint(1, 7), ...str(2, 'hand'), ...len(8, [...str(1, ''), ...vint(2, 13)]), ...len(7, graph)];
  const m = readModel(Uint8Array.from(model));
  assert.equal(m.irVersion, 7);
  assert.equal(m.producer, 'hand');
  assert.deepEqual(m.opset, { 'ai.onnx': 13 });
  const n = m.graph.nodes[0];
  assert.deepEqual([n.opType, n.name, n.inputs, n.outputs], ['Conv', 'conv0', ['x', 'w'], ['y']]);
  assert.deepEqual(n.attrs.kernel_shape, [3, 3]);
  assert.equal(n.attrs.alpha, 0.5);
  assert.equal(n.attrs.mode, 'linear');
  assert.equal(n.attrs.axis, -1);
  assert.deepEqual(n.attrs.pads, [1, 2]);
  assert.deepEqual([n.attrs.value.dims, [...n.attrs.value.data], n.attrs.value.dtype], [[2], [5, -6], DTYPE.INT64]);
  const w = m.graph.initializers.get('w');
  assert.deepEqual(w.dims, [2, 2]);
  assert.ok(w.data instanceof Float32Array);
  assert.deepEqual([...w.data], [1.5, -2, 3, 0.25]);
  assert.deepEqual([...m.graph.initializers.get('raw').data], [7, 8, 9]);
  assert.deepEqual([...m.graph.initializers.get('ints').data], [-3, 4000000000]);
  assert.deepEqual(m.graph.inputs.map((i) => [i.name, i.shape]), [['x', [1, 3, 'height', 'width']]]);
  assert.deepEqual(m.graph.outputs[0].shape, [1, 2, 4, 4]);
  assert.deepEqual(opsUsed(m), { Conv: 1 });
  // Cut short or not a model: a readable error, not a crash.
  assert.throws(() => readModel(Uint8Array.from(model.slice(0, model.length - 3))), /cut short/);
  assert.throws(() => readModel(Uint8Array.from([8, 1])), /isn't an ONNX model/);
});

test('[IMG-11] models written with writeModel read back the same', () => {
  const bytes = writeModel({
    inputs: [{ name: 'a', shape: [1, 2] }],
    outputs: [{ name: 'b', shape: [1, 2] }],
    weights: [{ name: 'k', dims: [2], data: [0.5, -1.25] }, { name: 'n', dims: [3], data: [-1, 0, 7], dtype: DTYPE.INT64 }],
    nodes: [{ op: 'Mul', inputs: ['a', 'k'], outputs: ['b'], attrs: { eps: { f: 2 }, alpha: 0.25, list: [1, -2], names: 'x' } }],
  });
  const m = readModel(bytes);
  assert.deepEqual(m.graph.nodes[0].attrs, { eps: 2, alpha: 0.25, list: [1, -2], names: 'x' });
  assert.deepEqual([...m.graph.initializers.get('k').data], [0.5, -1.25]);
  assert.deepEqual([...m.graph.initializers.get('n').data], [-1, 0, 7]);
});

test('[IMG-11] Conv: padding, stride, dilation, groups and bias, against sums worked out by hand', () => {
  const x = T([1, 1, 3, 3], [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const ones = T([1, 1, 3, 3], new Array(9).fill(1));
  // Each output is the sum of its 3×3 neighbourhood (zeros past the edge), plus the bias.
  const y = op('Conv', [x, ones, T([1], [1])], { kernel_shape: [3, 3], pads: [1, 1, 1, 1] });
  assert.deepEqual(y.dims, [1, 1, 3, 3]);
  close(y.data, [12, 21, 16, 27, 45, 33, 24, 39, 28].map((v) => v + 1));
  // Every other one.
  close(op('Conv', [x, ones], { kernel_shape: [3, 3], pads: [1, 1, 1, 1], strides: [2, 2] }).data, [12, 16, 24, 28]);
  // Spread out by 2: the corners of the picture land on the corner taps.
  const d = op('Conv', [x, ones], { kernel_shape: [3, 3], pads: [2, 2, 2, 2], dilations: [2, 2] });
  close(d.data, [1 + 3 + 7 + 9, 2 + 8, 1 + 3 + 7 + 9, 4 + 6, 5, 4 + 6, 1 + 3 + 7 + 9, 2 + 8, 1 + 3 + 7 + 9]);
  // No padding: one output.
  close(op('Conv', [x, ones], { kernel_shape: [3, 3] }).data, [45]);
  // SAME_UPPER pads to keep the size.
  close(op('Conv', [x, ones], { kernel_shape: [3, 3], auto_pad: 'SAME_UPPER' }).data, [12, 21, 16, 27, 45, 33, 24, 39, 28]);
  // Groups: each output channel sees only its own input channel.
  const g = op('Conv', [T([1, 2, 1, 1], [2, 3]), T([2, 1, 1, 1], [10, 100])], { group: 2, kernel_shape: [1, 1] });
  close(g.data, [20, 300]);
  // Two input channels into three outputs (an odd count, so the paired fast path ends on a single).
  const two = op('Conv', [T([1, 2, 1, 1], [1, 2]), T([3, 2, 1, 1], [1, 1, 2, -1, 0, 3])], { kernel_shape: [1, 1] });
  close(two.data, [3, 0, 6]);
  // A wide kernel with uneven padding: [a b] taps on each row.
  const wide = op('Conv', [x, T([1, 1, 1, 2], [1, 10])], { kernel_shape: [1, 2], pads: [0, 1, 0, 0] });
  close(wide.data, [10, 21, 32, 40, 54, 65, 70, 87, 98]);
  // 3×3 with three outputs and two inputs, against a plain loop.
  const xs = T([1, 2, 4, 5], Array.from({ length: 40 }, (_, i) => Math.sin(i)));
  const ws = T([3, 2, 3, 3], Array.from({ length: 54 }, (_, i) => Math.cos(i)));
  const got = op('Conv', [xs, ws, T([3], [0.5, -1, 2])], { kernel_shape: [3, 3], pads: [2, 2, 2, 2], dilations: [2, 2] });
  const want = [];
  for (let m = 0; m < 3; m++) {
    for (let oy = 0; oy < 4; oy++) {
      for (let ox = 0; ox < 5; ox++) {
        let s = [0.5, -1, 2][m];
        for (let c = 0; c < 2; c++) {
          for (let ky = 0; ky < 3; ky++) {
            for (let kx = 0; kx < 3; kx++) {
              const iy = oy - 2 + ky * 2;
              const ix = ox - 2 + kx * 2;
              if (iy >= 0 && iy < 4 && ix >= 0 && ix < 5) s += f(Math.sin((c * 4 + iy) * 5 + ix)) * f(Math.cos(((m * 2 + c) * 3 + ky) * 3 + kx));
            }
          }
        }
        want.push(s);
      }
    }
  }
  close(got.data, want, 1e-4);
});

test('[IMG-11] Relu, Sigmoid, Add, Mul and BatchNormalization', () => {
  close(op('Relu', [T([4], [-1, 0, 2, -0.5])]).data, [0, 0, 2, 0]);
  close(op('Sigmoid', [T([3], [0, 2, -2])]).data, [0.5, 1 / (1 + Math.exp(-2)), 1 / (1 + Math.exp(2))]);
  // Broadcasting: a row added to every row; a single number times everything.
  const sum = op('Add', [T([2, 3], [1, 2, 3, 4, 5, 6]), T([3], [10, 20, 30])]);
  assert.deepEqual(sum.dims, [2, 3]);
  close(sum.data, [11, 22, 33, 14, 25, 36]);
  close(op('Mul', [T([1, 2, 1, 2], [1, 2, 3, 4]), T([1, 2, 1, 1], [10, 100])]).data, [10, 20, 300, 400]);
  close(op('Mul', [T([2], [3, 4]), T([], [0.5])]).data, [1.5, 2]);
  assert.deepEqual(broadcastShape([4, 1, 3], [2, 1]), [4, 2, 3]);
  assert.throws(() => broadcastShape([2], [3]), /don't fit/);
  // (x - mean) / sqrt(var + eps) * scale + bias, per channel.
  const bn = op('BatchNormalization', [T([1, 2, 1, 1], [1, 2]), T([2], [2, 1]), T([2], [0, 1]), T([2], [1, 0]), T([2], [3, 0])], { epsilon: 1 });
  close(bn.data, [0, 3]);
});

test('[IMG-11] MaxPool and AveragePool, with ceil_mode and padding', () => {
  const x = T([1, 1, 3, 3], [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  close(op('MaxPool', [x], { kernel_shape: [2, 2], strides: [2, 2] }).data, [5]);
  const ceil = op('MaxPool', [x], { kernel_shape: [2, 2], strides: [2, 2], ceil_mode: 1 });
  assert.deepEqual(ceil.dims, [1, 1, 2, 2]);
  close(ceil.data, [5, 6, 8, 9]);
  // Averages leave padding out unless told to count it.
  const avg = op('AveragePool', [x], { kernel_shape: [3, 3], pads: [1, 1, 1, 1] });
  close(avg.data, [3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7]);
  const withPad = op('AveragePool', [x], { kernel_shape: [3, 3], pads: [1, 1, 1, 1], count_include_pad: 1 });
  close(withPad.data.slice(0, 2), [12 / 9, 21 / 9]);
  close(op('GlobalAveragePool', [x]).data, [5]);
});

test('[IMG-11] Resize and Upsample: bilinear and nearest, each way of lining up pixels', () => {
  const x = T([1, 1, 2, 2], [0, 1, 2, 3]); // value = 2·row + column
  const s = [0, 0.25, 0.75, 1]; // where each of 4 outputs samples 2 inputs (pytorch_half_pixel, clamped)
  const big = op('Resize', [x, undefined, undefined, I([4], [1, 1, 4, 4])], { mode: 'linear', coordinate_transformation_mode: 'pytorch_half_pixel' });
  assert.deepEqual(big.dims, [1, 1, 4, 4]);
  close(big.data, s.flatMap((r) => s.map((c) => 2 * r + c)));
  // half_pixel (the default) is the same here; align_corners spreads the ends to the ends.
  close(op('Resize', [x, undefined, T([4], [1, 1, 2, 2])], { mode: 'linear' }).data, big.data);
  const ac = [0, 0.5, 1];
  close(op('Resize', [x, undefined, undefined, I([4], [1, 1, 3, 3])], { mode: 'linear', coordinate_transformation_mode: 'align_corners' }).data, ac.flatMap((r) => ac.map((c) => 2 * r + c)));
  // Nearest, asymmetric, floor: each pixel doubled.
  close(op('Resize', [x, undefined, T([4], [1, 1, 2, 2])], { mode: 'nearest', coordinate_transformation_mode: 'asymmetric', nearest_mode: 'floor' }).data,
    [0, 0, 1, 1, 0, 0, 1, 1, 2, 2, 3, 3, 2, 2, 3, 3]);
  // Opset 10's Resize (X, scales) and the older Upsample.
  close(op('Resize', [x, T([4], [1, 1, 2, 2])], { mode: 'nearest' }).dims, [1, 1, 4, 4]);
  close(op('Upsample', [x, T([4], [1, 1, 2, 2])], { mode: 'nearest' }).data, [0, 0, 1, 1, 0, 0, 1, 1, 2, 2, 3, 3, 2, 2, 3, 3]);
  close(op('Upsample', [x, T([4], [1, 1, 1, 2])], { mode: 'linear' }).data, [0, 0.5, 1, 1, 2, 2.5, 3, 3]);
});

test('[IMG-11] shape operations: Shape, Gather, Unsqueeze, Slice, Concat, Cast, Reshape, Transpose', () => {
  const x = T([1, 3, 4, 5], new Array(60).fill(0));
  const shape = op('Shape', [x]);
  assert.deepEqual([...shape.data], [1, 3, 4, 5]);
  assert.equal(shape.dtype, DTYPE.INT64);
  const h = op('Gather', [shape, I([], [2])], { axis: 0 });
  assert.deepEqual([h.dims, [...h.data]], [[], [4]]);
  assert.deepEqual(op('Unsqueeze', [h], { axes: [0] }).dims, [1]);
  assert.deepEqual(op('Unsqueeze', [h, I([1], [0])]).dims, [1]);
  assert.deepEqual([...op('Slice', [shape, I([1], [0]), I([1], [2]), I([1], [0])]).data], [1, 3]);
  assert.deepEqual([...op('Slice', [shape, I([1], [-2]), I([1], [100])]).data], [4, 5]);
  assert.deepEqual([...op('Slice', [shape, I([1], [-1]), I([1], [-100]), I([1], [0]), I([1], [-2])]).data], [5, 3]);
  const sizes = op('Concat', [I([2], [1, 3]), I([2], [8, 10])], { axis: 0 });
  assert.deepEqual([...sizes.data], [1, 3, 8, 10]);
  const cat = op('Concat', [T([1, 1, 1, 2], [1, 2]), T([1, 2, 1, 2], [3, 4, 5, 6])], { axis: 1 });
  assert.deepEqual(cat.dims, [1, 3, 1, 2]);
  close(cat.data, [1, 2, 3, 4, 5, 6]);
  close(op('Concat', [T([2, 2], [1, 2, 3, 4]), T([2, 1], [9, 8])], { axis: -1 }).data, [1, 2, 9, 3, 4, 8]);
  const cast = op('Cast', [T([2], [2.7, -1.5])], { to: DTYPE.INT64 });
  assert.deepEqual([cast.dtype, [...cast.data]], [DTYPE.INT64, [2, -1]]);
  assert.deepEqual(op('Reshape', [x, I([3], [0, -1, 5])]).dims, [1, 12, 5]);
  const t = op('Transpose', [T([2, 3], [1, 2, 3, 4, 5, 6])], { perm: [1, 0] });
  assert.deepEqual([t.dims, [...t.data]], [[3, 2], [1, 4, 2, 5, 3, 6]]);
  const k = op('Constant', [], { value: T([2], [1, 2]) });
  close(k.data, [1, 2]);
});

test('[IMG-11] runs a small model end to end: Conv → Relu → Conv → Sigmoid', async () => {
  const bytes = writeModel({
    inputs: [{ name: 'x', shape: [1, 1, 2, 2] }],
    outputs: [{ name: 'y', shape: [1, 1, 2, 2] }],
    weights: [
      { name: 'w1', dims: [2, 1, 1, 1], data: [2, -1] }, { name: 'b1', dims: [2], data: [0, 1] },
      { name: 'w2', dims: [1, 2, 1, 1], data: [1, 1] }, { name: 'b2', dims: [1], data: [-3] },
    ],
    nodes: [
      { op: 'Conv', inputs: ['x', 'w1', 'b1'], outputs: ['c1'], attrs: { kernel_shape: [1, 1] } },
      { op: 'Relu', inputs: ['c1'], outputs: ['r1'] },
      { op: 'Conv', inputs: ['r1', 'w2', 'b2'], outputs: ['c2'], attrs: { kernel_shape: [1, 1] } },
      { op: 'Sigmoid', inputs: ['c2'], outputs: ['y'] },
    ],
  });
  // x = [1, -2, 3, -4]: first layer [2, -4, 6, -8] and [0, 3, -2, 5]; after Relu
  // [2, 0, 6, 0] and [0, 3, 0, 5]; summed less 3: [-1, 0, 3, 2].
  const seen = [];
  const out = await runModel(readModel(bytes), { x: T([1, 1, 2, 2], [1, -2, 3, -4]) }, { onProgress: (p) => seen.push(p) });
  close(out.y.data, [-1, 0, 3, 2].map((v) => 1 / (1 + Math.exp(-v))));
  assert.equal(seen.at(-1), 1);
  assert.ok(seen.every((p, i) => i === 0 || p >= seen[i - 1]), 'progress only goes up');
  // Missing inputs and unknown operations say so.
  await assert.rejects(runModel(readModel(bytes), {}), /needs an input called x/);
  const odd = readModel(writeModel({ inputs: [{ name: 'x', shape: [1] }], outputs: [{ name: 'y', shape: [1] }], nodes: [{ op: 'Einsum', inputs: ['x'], outputs: ['y'] }] }));
  assert.deepEqual(unsupported(odd), ['Einsum']);
  await assert.rejects(runModel(odd, { x: T([1], [1]) }), /can't run yet: Einsum/);
});

test('[IMG-11] the work a model will take is known from shapes alone (for honest progress)', () => {
  const plan = workPlan(readModel(tinyCutoutModel(32)), { 'input.1': { dims: [1, 3, 32, 32] } });
  // 4 outputs × 32×32 × (3 channels × 3×3), then 1 × 16×16 × 4.
  assert.equal(plan.total, 4 * 32 * 32 * 27 + 16 * 16 * 4);
  assert.equal(plan.work.filter((w) => w > 0).length, 2);
});

test('[IMG-11] a run can be stopped, and gives way to the page while it works', async () => {
  const model = readModel(opsModel(24, 3));
  const x = T([1, 3, 24, 24], Array.from({ length: 3 * 576 }, (_, i) => Math.cos(i)));
  const stop = new AbortController();
  let pauses = 0;
  const run = runModel(model, { x }, { signal: stop.signal, budget: 0, pause: async () => {
    pauses++;
    if (pauses === 3) stop.abort();
  } });
  await assert.rejects(run, (e) => e.name === 'AbortError');
  assert.equal(pauses, 3);
  // Unstopped, the same model gives the same answer each time.
  const a = await runModel(model, { x });
  const b = await runModel(model, { x }, { pause: async () => null, budget: 0 });
  close(a.y.data, b.y.data, 0);
  assert.deepEqual(a.side.dims, [1, 5, 12, 12]);
});

test('[IMG-11] cut-out: picture in, model, mask out, see-through corners', async () => {
  const S = 32;
  const model = readModel(tinyCutoutModel(S));
  const w = 64;
  const h = 48;
  const rgba = new Uint8ClampedArray(w * h * 4).fill(200);
  const input = modelInput(rgba, w, h, S);
  assert.deepEqual(input.dims, [1, 3, S, S]);
  // An even grey: every value is the brightest, so 1, normalized per color.
  close(input.data.slice(0, 1), [(1 - 0.485) / 0.229]);
  close(input.data.slice(2 * S * S, 2 * S * S + 1), [(1 - 0.406) / 0.225]);
  const out = await runModel(model, { 'input.1': input });
  const mask = maskFromOutput(out.mask);
  assert.deepEqual([mask.mw, mask.mh], [S, S]);
  assert.equal(Math.min(...mask.mask), 0);
  assert.equal(Math.max(...mask.mask), 1);
  const cleared = applyMask(rgba, w, h, mask);
  const a = (x, y) => rgba[(y * w + x) * 4 + 3];
  assert.equal(a(0, 0), 0);
  assert.equal(a(w - 1, h - 1), 0);
  assert.equal(a(w / 2, h / 2), 200, 'the subject keeps its own alpha');
  assert.ok(cleared > 0.6 && cleared < 0.85, `cleared ${cleared}`);
  assert.equal(rgba[0], 200, 'colors are kept, only alpha changes');
});

test('[IMG-11] refining edges: soft as the model says, or crisp', () => {
  // A ramp from 0 to 1 across: soft keeps the ramp, crisp makes nearly a step.
  const ramp = { mask: Float32Array.from({ length: 11 }, (_, i) => i / 10), mw: 11, mh: 1 };
  const soft = alphaFromMask(ramp, 11, 1, { refine: 0, feather: 0 });
  close([soft[0], soft[5], soft[10]], [0, 0.5, 1]);
  const crisp = alphaFromMask(ramp, 11, 1, { refine: 1, feather: 0 });
  close([crisp[4], crisp[5], crisp[6]], [0, 0.5, 1]);
  // All one value: nothing stands out, so nothing is the subject.
  assert.deepEqual([...maskFromOutput(T([1, 1, 1, 3], [0.4, 0.4, 0.4])).mask], [0, 0, 0]);
});

test('[IMG-11] resizing: shrinking averages areas, growing blends neighbours', () => {
  close(resizePlanes(Float32Array.from([1, 3, 5, 7]), 4, 1, 1, 2, 1), [2, 6]);
  close(resizePlanes(Float32Array.from([0, 1]), 2, 1, 1, 4, 1), [0, 0.25, 0.75, 1]);
  close(resizePlanes(Float32Array.from([0, 3, 6]), 3, 1, 1, 2, 1), [1, 5]);
  close(resizePlanes(Float32Array.from([1, 2, 3, 4]), 2, 2, 1, 1, 1), [2.5]);
});
