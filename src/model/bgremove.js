// Removes a plain, single-color background from a picture: logos, product
// shots on white, screenshots. Works on raw RGBA pixels, so it runs on your
// device and can be tested without a browser. (Cutting people out of busy
// photos needs a machine-learning model; that's a separate feature.)

function dist(r1, g1, b1, r2, g2, b2) {
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return Math.sqrt(dr * dr + dg * dg + db * db) / 441.7; // 0..1
}

/** The most common color along the edges, which is the background in plain shots. */
export function edgeColor(data, w, h) {
  const counts = new Map();
  const add = (x, y) => {
    const i = (y * w + x) * 4;
    if (data[i + 3] < 128) return;
    const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
    const c = counts.get(key) || { n: 0, r: 0, g: 0, b: 0 };
    c.n++;
    c.r += data[i];
    c.g += data[i + 1];
    c.b += data[i + 2];
    counts.set(key, c);
  };
  for (let x = 0; x < w; x++) {
    add(x, 0);
    add(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    add(0, y);
    add(w - 1, y);
  }
  let best = null;
  for (const c of counts.values()) if (!best || c.n > best.n) best = c;
  if (!best) return null;
  return [best.r / best.n, best.g / best.n, best.b / best.n];
}

/**
 * Make the background transparent, in place. The background is everything
 * connected to the edges that's within `tolerance` (0..1) of the edge color.
 * Pixels just past the tolerance fade out, for smooth edges.
 * Returns how many pixels were cleared.
 */
export function removePlainBackground(data, w, h, { tolerance = 0.12, soft = 0.08 } = {}) {
  const bg = edgeColor(data, w, h);
  if (!bg) return 0;
  const [br, bgc, bb] = bg;
  const seen = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let head = 0;
  let tail = 0;
  const near = (p) => {
    const i = p * 4;
    return data[i + 3] > 0 && dist(data[i], data[i + 1], data[i + 2], br, bgc, bb) <= tolerance;
  };
  const push = (p) => {
    if (seen[p]) return;
    seen[p] = 1;
    if (near(p)) queue[tail++] = p;
  };
  for (let x = 0; x < w; x++) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    push(y * w);
    push(y * w + w - 1);
  }
  let cleared = 0;
  while (head < tail) {
    const p = queue[head++];
    data[p * 4 + 3] = 0;
    cleared++;
    const x = p % w;
    const y = (p / w) | 0;
    if (x > 0) push(p - 1);
    if (x < w - 1) push(p + 1);
    if (y > 0) push(p - w);
    if (y < h - 1) push(p + w);
  }
  // Soften the border: pixels touching the cleared area fade by how close they are to the background.
  if (soft > 0) {
    for (let p = 0; p < w * h; p++) {
      const i = p * 4;
      if (data[i + 3] === 0) continue;
      const x = p % w;
      const y = (p / w) | 0;
      const touches = (x > 0 && data[i - 1] === 0) || (x < w - 1 && data[i + 7] === 0) ||
        (y > 0 && data[i - w * 4 + 3] === 0) || (y < h - 1 && data[i + w * 4 + 3] === 0);
      if (!touches) continue;
      const d = dist(data[i], data[i + 1], data[i + 2], br, bgc, bb);
      if (d < tolerance + soft) data[i + 3] = Math.round(data[i + 3] * Math.min(1, (d - tolerance) / soft + 0.15));
    }
  }
  return cleared;
}
