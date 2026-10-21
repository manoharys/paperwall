// Tiny ONNX models for tests, made here (no real weights anywhere in the repo).

import { writeModel, DTYPE } from '../../src/model/onnx.js';

const zeros = (n) => new Array(n).fill(0);
const ints = (name, list) => ({ name, dims: [list.length], data: list, dtype: DTYPE.INT64 });

/**
 * A stand-in for a background removal model, shaped like U²-Net's export:
 * 1×3×S×S in, 1×1×S×S out. It ignores the picture (its weights are zero)
 * and always answers "the subject is the middle square" (the middle half
 * each way), through the same kinds of operations the real one uses.
 */
export function tinyCutoutModel(S = 320) {
  const half = S / 2;
  const pattern = [];
  for (let y = 0; y < half; y++) {
    for (let x = 0; x < half; x++) {
      const inside = x >= half / 4 && x < (3 * half) / 4 && y >= half / 4 && y < (3 * half) / 4;
      pattern.push(inside ? 8 : -8);
    }
  }
  return writeModel({
    name: 'tiny-cutout',
    inputs: [{ name: 'input.1', shape: [1, 3, S, S] }],
    outputs: [{ name: 'mask', shape: [1, 1, S, S] }],
    weights: [
      { name: 'w1', dims: [4, 3, 3, 3], data: zeros(4 * 3 * 9) },
      { name: 'b1', dims: [4], data: zeros(4) },
      { name: 'w2', dims: [1, 4, 1, 1], data: zeros(4) },
      { name: 'b2', dims: [1], data: [0] },
      { name: 'pattern', dims: [1, 1, half, half], data: pattern },
      ints('from', [0]), ints('to', [2]), ints('axis0', [0]),
    ],
    nodes: [
      { op: 'Conv', inputs: ['input.1', 'w1', 'b1'], outputs: ['c1'], attrs: { dilations: [1, 1], group: 1, kernel_shape: [3, 3], pads: [1, 1, 1, 1], strides: [1, 1] } },
      { op: 'Relu', inputs: ['c1'], outputs: ['r1'] },
      { op: 'MaxPool', inputs: ['r1'], outputs: ['p1'], attrs: { ceil_mode: 1, kernel_shape: [2, 2], pads: [0, 0, 0, 0], strides: [2, 2] } },
      { op: 'Conv', inputs: ['p1', 'w2', 'b2'], outputs: ['c2'], attrs: { kernel_shape: [1, 1] } },
      { op: 'Add', inputs: ['c2', 'pattern'], outputs: ['a1'] },
      // The output size, worked out from the input's shape (as exported models do).
      { op: 'Shape', inputs: ['input.1'], outputs: ['s0'] },
      { op: 'Constant', inputs: [], outputs: ['two'], attrs: { value: { dims: [], data: [2], dtype: DTYPE.INT64 } } },
      { op: 'Constant', inputs: [], outputs: ['three'], attrs: { value: { dims: [], data: [3], dtype: DTYPE.INT64 } } },
      { op: 'Gather', inputs: ['s0', 'two'], outputs: ['h'], attrs: { axis: 0 } },
      { op: 'Gather', inputs: ['s0', 'three'], outputs: ['w'], attrs: { axis: 0 } },
      { op: 'Unsqueeze', inputs: ['h'], outputs: ['h1'], attrs: { axes: [0] } },
      { op: 'Unsqueeze', inputs: ['w'], outputs: ['w1u'], attrs: { axes: [0] } },
      { op: 'Concat', inputs: ['h1', 'w1u'], outputs: ['hw'], attrs: { axis: 0 } },
      { op: 'Shape', inputs: ['a1'], outputs: ['s1'] },
      { op: 'Slice', inputs: ['s1', 'from', 'to', 'axis0'], outputs: ['nc'] },
      { op: 'Cast', inputs: ['hw'], outputs: ['hw64'], attrs: { to: DTYPE.INT64 } },
      { op: 'Concat', inputs: ['nc', 'hw64'], outputs: ['sizes'], attrs: { axis: 0 } },
      { op: 'Constant', inputs: [], outputs: ['empty'], attrs: { value: { dims: [0], data: [], dtype: DTYPE.FLOAT } } },
      { op: 'Resize', inputs: ['a1', 'empty', 'empty', 'sizes'], outputs: ['big'], attrs: { coordinate_transformation_mode: 'pytorch_half_pixel', cubic_coeff_a: { f: -0.75 }, mode: 'linear', nearest_mode: 'floor' } },
      { op: 'Sigmoid', inputs: ['big'], outputs: ['mask'] },
    ],
  });
}

/**
 * A model that goes through every operation the graphics card runs, with
 * awkward channel counts (not multiples of four) and many kinds of padding,
 * to check it against the processor. Its weights come from `seed`.
 */
export function opsModel(S = 24, seed = 1) {
  let s = seed;
  const rnd = () => {
    s = (s * 16807) % 2147483647;
    return (s / 2147483647) * 2 - 1;
  };
  const w = (name, dims) => ({ name, dims, data: Array.from({ length: dims.reduce((a, b) => a * b, 1) }, () => rnd() * 0.5) });
  return writeModel({
    name: 'ops',
    inputs: [{ name: 'x', shape: [1, 3, S, S] }],
    outputs: [{ name: 'y', shape: [1, 1, S, S] }, { name: 'side', shape: [1, 5, S / 2, S / 2] }],
    weights: [
      w('w1', [6, 3, 3, 3]), w('b1', [6]),
      w('w2', [5, 6, 3, 3]), w('b2', [5]),
      w('w3', [5, 5, 3, 3]),
      w('w4', [7, 5, 3, 3]), w('b4', [7]),
      w('w6', [6, 3, 5, 3]), w('b6', [6]),
      w('w5', [1, 19, 1, 1]), w('b5', [1]),
      ints('sizes', [1, 5, S, S]), ints('sizes19', [1, 19, S, S]),
    ],
    nodes: [
      { op: 'Conv', inputs: ['x', 'w1', 'b1'], outputs: ['c1'], attrs: { kernel_shape: [3, 3], pads: [1, 1, 1, 1] } },
      { op: 'Relu', inputs: ['c1'], outputs: ['r1'] },
      // Dilated, and used twice (so the Relu after isn't folded in).
      { op: 'Conv', inputs: ['r1', 'w2', 'b2'], outputs: ['c2'], attrs: { kernel_shape: [3, 3], pads: [2, 2, 2, 2], dilations: [2, 2] } },
      { op: 'Relu', inputs: ['c2'], outputs: ['r2'] },
      { op: 'Sigmoid', inputs: ['c2'], outputs: ['g2'] },
      { op: 'Add', inputs: ['r2', 'g2'], outputs: ['a2'] },
      // Down with a stride, pooled with ceil_mode, then back up.
      { op: 'Conv', inputs: ['a2', 'w3'], outputs: ['c3'], attrs: { kernel_shape: [3, 3], pads: [1, 1, 1, 1], strides: [2, 2] } },
      { op: 'MaxPool', inputs: ['c3'], outputs: ['m3'], attrs: { kernel_shape: [3, 3], strides: [2, 2], ceil_mode: 1 } },
      { op: 'AveragePool', inputs: ['c3'], outputs: ['side'], attrs: { kernel_shape: [3, 3], strides: [1, 1], pads: [1, 1, 1, 1] } },
      { op: 'Resize', inputs: ['m3', '', '', 'sizes'], outputs: ['u3'], attrs: { mode: 'linear', coordinate_transformation_mode: 'pytorch_half_pixel' } },
      { op: 'Conv', inputs: ['u3', 'w4', 'b4'], outputs: ['c4'], attrs: { kernel_shape: [3, 3], auto_pad: 'SAME_UPPER' } },
      // A taller kernel with uneven padding.
      { op: 'Conv', inputs: ['x', 'w6', 'b6'], outputs: ['c6'], attrs: { kernel_shape: [5, 3], pads: [2, 0, 2, 2] } },
      { op: 'Concat', inputs: ['c4', 'r1', 'c6'], outputs: ['cat'], attrs: { axis: 1 } },
      { op: 'Resize', inputs: ['cat', '', '', 'sizes19'], outputs: ['cat2'], attrs: { mode: 'nearest', coordinate_transformation_mode: 'asymmetric', nearest_mode: 'floor' } },
      { op: 'Conv', inputs: ['cat2', 'w5', 'b5'], outputs: ['c5'], attrs: { kernel_shape: [1, 1] } },
      { op: 'Sigmoid', inputs: ['c5'], outputs: ['y'] },
    ],
  });
}
