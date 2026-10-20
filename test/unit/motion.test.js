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

test('[MOT-07] a video plays from its start point, looping or holding its last frame', async () => {
  const { createVideo, videoTime, createDesign, validateDesign, usedAssetIds } = await import('../../src/model/doc.js');
  const v = createVideo('a1', { trim: { start: 2 } });
  assert.equal(videoTime(v, 0, 10), 2);
  assert.equal(videoTime(v, 3, 10), 5);
  assert.equal(videoTime(v, 9, 10), 3, 'past the end: from the start point again');
  v.loop = false;
  assert.ok(videoTime(v, 9, 10) < 10 && videoTime(v, 9, 10) > 9.9, 'holds near the end');
  // In a design: its asset is kept, and the soundtrack's too.
  const doc = createDesign({ width: 100, height: 100 });
  doc.assets = { a1: { type: 'video', dataUrl: 'data:video/webm;base64,AA', poster: 'data:image/jpeg;base64,AA' }, s1: { type: 'audio', dataUrl: 'data:audio/wav;base64,AA' } };
  doc.pages[0].elements.push(v);
  doc.audio = { assetId: 's1', volume: 3 };
  validateDesign(doc);
  assert.deepEqual(doc.audio, { assetId: 's1', volume: 1 }, 'volume kept between 0 and 1');
  assert.deepEqual([...usedAssetIds(doc)].sort(), ['a1', 's1']);
  doc.audio = { assetId: 'gone' };
  validateDesign(doc);
  assert.equal(doc.audio, undefined, 'a soundtrack whose sound is gone is dropped');
});

test('[MOT-05] GIF palette: many colors are reduced quickly to at most 256', async () => {
  const { buildPalette } = await import('../../src/model/gif.js');
  const d = new Uint8ClampedArray(720 * 720 * 4);
  for (let i = 0; i < 720 * 720; i++) d.set([(i * 7) & 255, (i >> 3) & 255, (i * 13) & 255, 255], i * 4);
  const t0 = performance.now();
  const p = buildPalette([d], 256);
  const ms = performance.now() - t0;
  assert.ok(p.length <= 256 && p.length > 200, `${p.length} colors`);
  assert.ok(ms < 1500, `took ${Math.round(ms)} ms`);
});

test('[MOT-03] a transition never runs longer than half its page', async () => {
  const { transitionOf } = await import('../../src/model/motion.js');
  assert.equal(transitionOf({ duration: 0.5, transition: { type: 'fade' } }).duration, 0.25);
  assert.equal(transitionOf({ duration: 5, transition: { type: 'fade' } }).duration, 0.6);
});

test('[MOT-03] motion types are checked as the design\'s own names, not inherited ones', async () => {
  const { transitionOf, animationOf, pageMoves } = await import('../../src/model/motion.js');
  const { createDesign, createVideo, validateDesign } = await import('../../src/model/doc.js');
  assert.equal(transitionOf({ transition: { type: 'toString' } }).type, 'none');
  assert.equal(animationOf({ elements: [], anim: { type: 'constructor' } }, { id: 'x', anim: { type: '__proto__' } }), null);
  const doc = createDesign({ width: 100, height: 100 });
  doc.pages[0].transition = { type: 'toString' };
  validateDesign(doc);
  assert.equal(doc.pages[0].transition, undefined);
  // A page whose only motion is a video moves.
  doc.pages[0].elements.push(createVideo('a'));
  assert.ok(pageMoves(doc.pages[0]));
});

test('[MOT-02] reading order is the same whatever the layer order', async () => {
  const { readingOrder } = await import('../../src/model/motion.js');
  const A = { id: 'A', x: 300, y: 0 };
  const B = { id: 'B', x: 200, y: 6 };
  const C = { id: 'C', x: 100, y: 12 };
  const D = { id: 'D', x: 0, y: 200 };
  const orders = [[A, B, C, D], [D, C, B, A], [B, D, A, C]].map((els) => readingOrder({ elements: els }).join(''));
  assert.equal(new Set(orders).size, 1, orders.join(' / '));
  assert.equal(orders[0].at(-1), 'D', 'the lower row comes last');
});

test('[MOT-01] typewriter counts an emoji as one letter', async () => {
  const { createDesign, createText } = await import('../../src/model/doc.js');
  const { renderPage } = await import('../../src/model/render.js');
  const doc = createDesign({ width: 1000, height: 1000 });
  const t = createText({ text: 'a🎉b', w: 900 });
  t.anim = { type: 'typewriter', duration: 3 };
  doc.pages[0].elements.push(t);
  const svg = renderPage(doc, 0, { time: 2 }); // two of three letters
  assert.match(svg, />a🎉</);
  assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(svg), 'no half an emoji');
});

test('[MOT-01] an element in a group plays its own animation; hidden ones don\'t count', async () => {
  const { createDesign, createShape, createGroup } = await import('../../src/model/doc.js');
  const { renderPage } = await import('../../src/model/render.js');
  const { animationsEnd, keepsMoving, pageMoves } = await import('../../src/model/motion.js');
  const doc = createDesign({ width: 1000, height: 1000 });
  const a = createShape('rect', { x: 0, y: 0, w: 100, h: 100, fill: '#ff0000' });
  a.anim = { type: 'fade', duration: 1, delay: 0.5 };
  const g = createGroup([a, createShape('rect', { x: 200, y: 0, w: 100, h: 100, fill: '#0000ff' })]);
  doc.pages[0].elements.push(g);
  assert.ok(!/#ff0000/.test(renderPage(doc, 0, { time: 0.2 })), 'not in yet, inside its group');
  assert.match(renderPage(doc, 0, { time: 0.2 }), /#0000ff/, 'its neighbour shows');
  assert.equal(animationsEnd(doc.pages[0]), 1.5);
  const loop = createShape('rect');
  loop.anim = { type: 'breathe' };
  loop.hidden = true;
  const page = { elements: [loop] };
  assert.equal(keepsMoving(page), false, 'a hidden loop keeps nothing moving');
  assert.equal(pageMoves(page), false);
});

test('[MOT-07] a video started at or past its end shows just before the end', async () => {
  const { createVideo, videoTime } = await import('../../src/model/doc.js');
  const v = createVideo('a', { trim: { start: 6 } });
  assert.ok(Math.abs(videoTime(v, 0, 6) - 5.96) < 1e-9);
  assert.ok(Math.abs(videoTime(v, 3, 6) - 5.96) < 0.05);
});

test('[MOT-07] presenting live keeps a video\'s place even when it has no poster', async () => {
  const { createDesign, createVideo } = await import('../../src/model/doc.js');
  const doc = createDesign({ width: 400, height: 300 });
  doc.assets.a = { type: 'video', dataUrl: 'data:video/webm;base64,AA==', duration: 2 };
  doc.pages[0].elements.push(createVideo('a', { x: 10, y: 10, w: 200, h: 150 }));
  const svg = renderFrame(doc, frameAt(doc, timeline(doc), 0.5), { videoSlots: true });
  assert.match(svg, /<foreignObject[^>]+data-video=/, 'a place for the playing video');
  assert.doesNotMatch(svg, /#e5e5ef/, 'not the grey box of a missing picture');
});

test('[MOT-06] MP4: the last sample lasts as long as the frame shown last', async () => {
  const { buildMp4, readBoxes } = await import('../../src/model/mp4.js');
  // Decode order I P B: the P frame (shown last) says 50 ms, the B frame 10 ms.
  const chunk = (timestamp, duration, key = false) => ({ data: new Uint8Array(4), timestamp, duration, key });
  const bytes = buildMp4({ video: { codec: 'vp9', width: 2, height: 2, chunks: [chunk(0, 33333, true), chunk(66666, 50000), chunk(33333, 10000)] }, duration: 0.12 });
  const find = (type, start = 0, end = bytes.length) => readBoxes(bytes, start, end).find((b) => b.type === type);
  let box = find('moov');
  for (const t of ['trak', 'mdia', 'minf', 'stbl', 'stts']) box = find(t, t === 'trak' ? box.start : box.start, box.end) || box;
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  const runs = view.getUint32(box.start + 4);
  const entries = Array.from({ length: runs }, (_, i) => [view.getUint32(box.start + 8 + i * 8), view.getUint32(box.start + 12 + i * 8)]);
  const last = entries[entries.length - 1];
  assert.equal(last[1], 4500, '50 ms at 90 kHz');
});

test('[MOT-05] GIF: close tints stay apart (a #fafafa card on white)', async () => {
  const { encodeGif } = await import('../../src/model/gif.js');
  const W = 20;
  const H = 10;
  const d = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) d.set(i % W < 10 ? [255, 255, 255, 255] : [250, 250, 250, 255], i * 4);
  const gif = readGif(encodeGif([{ data: d, delay: 100 }], { width: W, height: H, dither: false }));
  const img = gif.frames[0].image;
  assert.deepEqual(img[0], [255, 255, 255]);
  assert.deepEqual(img[15], [250, 250, 250]);
});

test('[MOT-06] MP4: reordered frames get offsets of zero or more, and an edit list', async () => {
  const { buildMp4, readBoxes } = await import('../../src/model/mp4.js');
  const chunk = (timestamp, key = false) => ({ data: new Uint8Array(4), timestamp, duration: 33333, key });
  // Decode order I P B B: shown at 0, 99, 33, 66 ms.
  const bytes = buildMp4({ video: { codec: 'vp9', width: 2, height: 2, chunks: [chunk(0, true), chunk(99999), chunk(33333), chunk(66666)] }, duration: 0.13 });
  const inside = (b, type) => readBoxes(bytes, b.start, b.end).find((x) => x.type === type);
  const moov = readBoxes(bytes).find((b) => b.type === 'moov');
  const trak = inside(moov, 'trak');
  const edts = inside(trak, 'edts');
  assert.ok(edts, 'an edit list');
  const stbl = inside(inside(inside(trak, 'mdia'), 'minf'), 'stbl');
  const ctts = inside(stbl, 'ctts');
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  assert.equal(bytes[ctts.start], 0, 'version 0');
  const n = view.getUint32(ctts.start + 4);
  for (let i = 0, k = 0; k < n; k++) {
    const count = view.getUint32(ctts.start + 8 + k * 8);
    const offset = view.getInt32(ctts.start + 12 + k * 8);
    assert.ok(offset >= 0, `sample ${i}: offset ${offset}`);
    i += count;
  }
  const elst = inside(edts, 'elst');
  assert.equal(view.getUint32(elst.start + 12), 3000, 'starts a frame in (33 ms at 90 kHz)');
});

test('[MOT-03] the first page\'s transition alone doesn\'t make a design move', () => {
  const doc = createDesign({ width: 100, height: 100 });
  doc.pages[0].transition = { type: 'fade' };
  assert.equal(designMoves(doc, [0]), false, 'nothing comes before it');
  doc.pages.push(createPage());
  doc.pages[1].transition = { type: 'fade' };
  assert.equal(designMoves(doc, [0, 1]), true);
});
