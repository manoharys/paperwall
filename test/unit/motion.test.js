import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDesign, createText, createShape, createPage, validateDesign } from '../../src/model/doc.js';
import { ANIMATIONS, TRANSITIONS, animationOf, motionAt, readingOrder, timeline, frameAt, transitionAt, pageDuration, animationsEnd, designMoves } from '../../src/model/motion.js';
import { renderPage, renderFrame } from '../../src/model/render.js';

const design = () => {
  const doc = createDesign({ width: 1000, height: 1000 });
  return doc;
};

test('[MOT-01] element animations: each kind starts hidden or away and lands in place', () => {
  for (const type of Object.keys(ANIMATIONS).filter((t) => t !== 'none')) {
    const anim = { type, duration: 1, delay: 0.5 };
    const start = motionAt(anim, 0, 1000);
    const end = motionAt(anim, 2, 1000);
    const moved = start.opacity < 1 || start.dx || start.dy || start.scale !== 1 || start.rotate || start.reveal < 1 || start.typed < 1;
    assert.ok(moved, `${type} starts somewhere else`);
    assert.equal(end.opacity, 1, `${type} ends visible`);
    assert.ok(Math.abs(end.dx) < 1e-9 && Math.abs(end.dy) < 1e-9 && end.reveal === 1 && end.typed === 1, `${type} ends in place`);
    if (type !== 'breathe') assert.ok(Math.abs(end.scale - 1) < 1e-9, `${type} ends at full size`);
  }
});

test('[MOT-02] animate a whole page: elements come in one after another, in reading order', () => {
  const doc = design();
  const page = doc.pages[0];
  const lower = createShape('rect', { x: 100, y: 600, w: 100, h: 100 });
  const top = createText({ text: 'Title', x: 100, y: 100, w: 400 });
  page.elements.push(lower, top);
  page.anim = { type: 'rise', stagger: 0.2 };
  assert.deepEqual(readingOrder(page), [top.id, lower.id]);
  assert.equal(animationOf(page, top).delay, 0);
  assert.equal(animationOf(page, lower).delay, 0.2);
  // An element's own animation wins over the page's.
  lower.anim = { type: 'pop', duration: 0.5, delay: 1 };
  assert.deepEqual(animationOf(page, lower), { type: 'pop', duration: 0.5, delay: 1 });
  assert.equal(animationsEnd(page), 1.5);
  assert.ok(designMoves(doc));
});

test('[MOT-01] drawn at a moment: hidden before, moving during, as designed after', () => {
  const doc = design();
  const s = createShape('rect', { x: 100, y: 100, w: 200, h: 200, fill: '#ff0000' });
  s.anim = { type: 'rise', duration: 1, delay: 0 };
  doc.pages[0].elements.push(s);
  assert.ok(!/#ff0000/.test(renderPage(doc, 0, { time: 0 })), 'not there yet');
  const mid = renderPage(doc, 0, { time: 0.5 });
  assert.match(mid, /translate\(0 [\d.]+\)/, 'on its way up');
  assert.match(mid, /opacity="0\.\d+"/);
  assert.equal(renderPage(doc, 0, { time: 5 }), renderPage(doc, 0), 'in place: as the still page');
});

test('[MOT-01] typewriter types text out letter by letter without moving letters', () => {
  const doc = design();
  const t = createText({ text: 'Hello world', x: 0, y: 0, w: 900, align: 'center' });
  t.anim = { type: 'typewriter', duration: 1 };
  doc.pages[0].elements.push(t);
  const half = renderPage(doc, 0, { time: 0.5 });
  assert.match(half, />Hello ?</);
  assert.ok(!/world/.test(half));
  const x = (svg) => svg.match(/<tspan x="([\d.]+)"/)[1];
  assert.equal(x(half), x(renderPage(doc, 0)), 'the first letter stays where it ends up');
});

test('[MOT-03] page durations, transitions and the timeline', () => {
  const doc = design();
  doc.pages.push(createPage(), createPage());
  doc.pages[0].duration = 2;
  doc.pages[1].transition = { type: 'push', duration: 1 };
  doc.pages[2].hidden = true;
  const tl = timeline(doc);
  assert.deepEqual(tl.parts.map((p) => [p.index, p.start, p.duration]), [[0, 0, 2], [1, 2, 5]], 'hidden pages are left out');
  assert.equal(tl.total, 7);
  assert.equal(pageDuration({}), 5);
  const mid = frameAt(doc, tl, 2.5);
  assert.equal(mid.index, 1);
  assert.equal(mid.from.index, 0);
  assert.equal(mid.transition.type, 'push');
  assert.equal(frameAt(doc, tl, 4).transition, null, 'after the transition, just the page');
  const push = transitionAt('push', 0.5);
  assert.ok(push.from.dx < 0 && push.to.dx > 0, 'push: one goes left as the other comes in');
  for (const type of Object.keys(TRANSITIONS)) assert.ok(transitionAt(type, 1).to.opacity === 1 && transitionAt(type, 1).to.dx === 0, `${type} ends on the new page`);
  const svg = renderFrame(doc, mid, {});
  assert.equal((svg.match(/<g transform="translate\(/g) || []).length >= 1, true, 'both pages placed');
});

test('[MOT-03] motion settings from a file are checked', () => {
  const doc = design();
  const s = createShape('rect');
  s.anim = { type: 'explode', duration: 1 };
  const t = createShape('rect');
  t.anim = { type: 'fade', duration: 999, delay: -4 };
  doc.pages[0].elements.push(s, t);
  Object.assign(doc.pages[0], { duration: 'x', transition: { type: 'slide', duration: 0.3 }, anim: { type: 'pop', stagger: 9 } });
  validateDesign(doc);
  assert.equal(s.anim, undefined);
  assert.deepEqual(t.anim, { type: 'fade', duration: 10, delay: 0 });
  assert.equal(doc.pages[0].duration, undefined);
  assert.deepEqual(doc.pages[0].transition, { type: 'slide', duration: 0.3 });
  assert.deepEqual(doc.pages[0].anim, { type: 'pop', stagger: 2 });
});

/** A small GIF reader, to check what the encoder writes. */
function readGif(bytes) {
  let p = 0;
  const u8 = () => bytes[p++];
  const u16 = () => bytes[p++] | (bytes[p++] << 8);
  const sig = String.fromCharCode(...bytes.slice(0, 6));
  p = 6;
  const width = u16();
  const height = u16();
  const packed = u8();
  p += 2;
  const gct = [];
  if (packed & 0x80) for (let i = 0; i < 2 << (packed & 7); i++) gct.push([u8(), u8(), u8()]);
  const screen = new Array(width * height).fill(null); // the picture so far, as [r, g, b]
  const frames = [];
  let delay = 0;
  let loop = null;
  for (;;) {
    const b = u8();
    if (b === 0x3b) break;
    if (b === 0x21) {
      const label = u8();
      const blocks = [];
      for (let n = u8(); n; n = u8()) {
        blocks.push(bytes.slice(p, p + n));
        p += n;
      }
      if (label === 0xf9) delay = (blocks[0][1] | (blocks[0][2] << 8)) * 10;
      if (label === 0xff && blocks[1]) loop = blocks[1][1] | (blocks[1][2] << 8);
      continue;
    }
    if (b !== 0x2c) throw new Error(`bad block ${b}`);
    const x = u16();
    const y = u16();
    const w = u16();
    const h = u16();
    const lp = u8();
    const lct = [];
    if (lp & 0x80) for (let i = 0; i < 2 << (lp & 7); i++) lct.push([u8(), u8(), u8()]);
    const colors = lct.length ? lct : gct;
    const min = u8();
    const data = [];
    for (let n = u8(); n; n = u8()) {
      data.push(...bytes.slice(p, p + n));
      p += n;
    }
    // LZW decode.
    const clear = 1 << min;
    const eoi = clear + 1;
    let size = min + 1;
    let dict = [];
    const reset = () => {
      dict = [];
      for (let i = 0; i < clear; i++) dict[i] = [i];
      dict[clear] = [];
      dict[eoi] = null;
      size = min + 1;
    };
    reset();
    const out = [];
    let bit = 0;
    let prev = null;
    const read = () => {
      let v = 0;
      for (let i = 0; i < size; i++, bit++) v |= ((data[bit >> 3] >> (bit & 7)) & 1) << i;
      return v;
    };
    for (;;) {
      const code = read();
      if (code === clear) {
        reset();
        prev = null;
        continue;
      }
      if (code === eoi) break;
      let entry;
      if (code < dict.length && dict[code]) entry = dict[code];
      else entry = [...prev, prev[0]];
      out.push(...entry);
      if (prev) dict.push([...prev, entry[0]]);
      prev = entry;
      if (dict.length === 1 << size && size < 12) size++;
    }
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) screen[(y + j) * width + x + i] = colors[out[j * w + i]];
    frames.push({ x, y, w, h, delay, pixels: out.length, image: screen.slice() });
  }
  return { sig, width, height, gct, frames, loop };
}

test('[MOT-05] GIF: a valid animated file; still stretches are one frame, changes only their box', async () => {
  const { encodeGif } = await import('../../src/model/gif.js');
  const W = 40;
  const H = 30;
  const frame = (fill) => {
    const d = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i++) d.set([255, 255, 255, 255], i * 4);
    fill(d);
    return d;
  };
  const red = (x0, y0) => (d) => {
    for (let y = y0; y < y0 + 5; y++) for (let x = x0; x < x0 + 5; x++) d.set([255, 0, 0, 255], (y * W + x) * 4);
  };
  const frames = [
    { data: frame(() => null), delay: 100 },
    { data: frame(() => null), delay: 100 }, // no change: merged into the first
    { data: frame(red(10, 10)), delay: 200 },
    { data: frame(red(12, 10)), delay: 300 },
  ];
  const gif = readGif(encodeGif(frames, { width: W, height: H, dither: false }));
  assert.equal(gif.sig, 'GIF89a');
  assert.equal(gif.loop, 0, 'loops forever');
  assert.deepEqual([gif.width, gif.height], [W, H]);
  assert.equal(gif.frames.length, 3);
  assert.equal(gif.frames[0].delay, 200, 'the unchanged frame made the first last longer');
  assert.deepEqual([gif.frames[1].x, gif.frames[1].y, gif.frames[1].w, gif.frames[1].h], [10, 10, 5, 5], 'just the square');
  assert.deepEqual([gif.frames[2].x, gif.frames[2].w], [10, 7], 'just what moved');
  // The last picture: red where the square is now, white where it was.
  const color = (i) => gif.frames[2].image[i];
  assert.deepEqual(color(12 * W + 15), [255, 0, 0]);
  assert.deepEqual(color(12 * W + 10), [255, 255, 255]);
});

test('[MOT-05] GIF: LZW survives long runs and a full code table', async () => {
  const { lzwEncode, encodeGif } = await import('../../src/model/gif.js');
  const W = 300;
  const H = 200;
  const d = new Uint8ClampedArray(W * H * 4);
  // Many colors in a pattern that fills the code table several times over.
  for (let i = 0; i < W * H; i++) d.set([(i * 7) & 255, (i * 13) & 255, (i * 31) & 255, 255], i * 4);
  const gif = readGif(encodeGif([{ data: d, delay: 100 }], { width: W, height: H, dither: false }));
  assert.equal(gif.frames[0].pixels, W * H, 'every pixel decodes');
  assert.ok(lzwEncode(8, new Uint8Array(0)).length > 0);
});
