// Staying quick with big designs: many pages of photos, long documents, and
// motion downloads with videos. Times are generous (CI machines are slow);
// what's drawn again, and what isn't, is checked exactly.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { newDesign, waitForEditor, settled, teardown } from './helpers.js';

after(teardown);

/** Make a design of `pages` pages, each with a title and three photos from `photos` big JPEGs, and open it. Resolves to how long opening took (ms). */
async function openPhotoDesign(page, { pages = 60, photos = 12 } = {}) {
  const id = await page.evaluate(async ([n, m]) => {
    const photo = (seed) => {
      const c = document.createElement('canvas');
      c.width = 1600;
      c.height = 1200;
      const g = c.getContext('2d');
      for (let i = 0; i < 40; i++) {
        g.fillStyle = `hsl(${(seed * 47 + i * 23) % 360} 70% ${30 + (i % 5) * 10}%)`;
        g.fillRect((i * 131 + seed * 17) % 1500, (i * 71 + seed * 29) % 1100, 300, 260);
      }
      return c.toDataURL('image/jpeg', 0.92);
    };
    const filters = { brightness: 100, contrast: 100, saturation: 100, grayscale: 0, sepia: 0, blur: 0, warmth: 0, tint: 0, hue: 0, vignette: 0, duotone: null };
    const img = (id, assetId, x, y) => ({ id, type: 'image', x, y, w: 480, h: 360, rotation: 0, opacity: 1, assetId, crop: { x: 0, y: 0, w: 1, h: 1 }, filters, radius: 0, mask: 'none' });
    const text = (id, t) => ({ id, type: 'text', x: 80, y: 40, w: 900, h: 70, rotation: 0, opacity: 1, text: t, font: 'Inter', size: 56, weight: 700, italic: false, color: '#111111', align: 'left', lineHeight: 1.2, letterSpacing: 0, caps: false, list: 'none', outline: null, highlight: null, curve: 0 });
    const assets = {};
    for (let i = 0; i < m; i++) assets[`ph${i}`] = { type: 'image', mime: 'image/jpeg', dataUrl: photo(i), width: 1600, height: 1200, name: `photo-${i}.jpg` };
    const list = [];
    for (let p = 0; p < n; p++) {
      list.push({ id: `pg${p}`, background: { type: 'color', color: '#ffffff' }, elements: [text(`t${p}`, `Page ${p + 1}`), img(`a${p}`, `ph${p % m}`, 40, 160), img(`b${p}`, `ph${(p + 5) % m}`, 560, 160), img(`c${p}`, `ph${(p + 9) % m}`, 300, 600)] });
    }
    const now = Date.now();
    const doc = { version: 1, id: `dbig${now}`, name: 'Many photos', width: 1080, height: 1080, unit: 'px', pages: list, assets, createdAt: now, updatedAt: now };
    await window.paperwall.store.saveDesign(doc, null);
    return doc.id;
  }, [pages, photos]);
  await page.evaluate((d) => {
    window.openedAt = performance.now();
    location.hash = `#/d/${d}`;
  }, id);
  await page.waitForFunction((d) => window.paperwall?.editor?.doc.id === d, id, { timeout: 30000 });
  await page.waitForSelector('[data-testid="page"] svg image');
  await settled(page);
  return page.evaluate(() => performance.now() - window.openedAt);
}

test('[APP-07] a 60-page design full of photos opens, moves between pages and redraws only what changed', async () => {
  const { page, context, errors } = await newDesign('square');
  const opened = await openPhotoDesign(page);
  assert.ok(opened < 15000, `opened in ${Math.round(opened)} ms`);
  assert.equal(await page.locator('[data-testid="page-thumb"]').count(), 60);
  // Only the thumbnails near the screen are drawn.
  await settled(page);
  const drawn = await page.locator('[data-testid="page-thumb"] .page-img svg').count();
  assert.ok(drawn > 0 && drawn < 60, `${drawn} of 60 thumbnails drawn`);
  // Moving between pages.
  const times = await page.evaluate(async () => {
    const ed = window.paperwall.editor;
    const out = [];
    for (const i of [7, 23, 41, 59, 2, 30, 0, 15, 45]) {
      const t = performance.now();
      ed.setPage(i);
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
      out.push(performance.now() - t);
    }
    return out.sort((a, b) => a - b);
  });
  const median = times[times.length >> 1];
  assert.ok(median < 400, `switching pages: median ${Math.round(median)} ms (${times.map(Math.round).join(', ')})`);
  // An edit on one page: its thumbnail is drawn again, the others are kept.
  await page.evaluate(() => {
    for (const img of document.querySelectorAll('[data-testid="page-thumb"] .page-img')) img.kept = true;
  });
  const edit = await page.evaluate(() => {
    const ed = window.paperwall.editor;
    const t = performance.now();
    ed.update({ color: '#ff0066' }, null, [ed.pageData.elements[0].id]);
    return performance.now() - t;
  });
  assert.ok(edit < 400, `an edit took ${Math.round(edit)} ms`);
  await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="page-thumb"] .page-img')].some((img) => !img.kept));
  const fresh = await page.evaluate(() => [...document.querySelectorAll('[data-testid="page-thumb"] .page-img')].map((img, i) => (img.kept ? null : i)).filter((i) => i !== null));
  assert.deepEqual(fresh, [45], 'just the edited page');
  // On the canvas, only the changed element is drawn again.
  const kept = await page.evaluate(() => {
    const ed = window.paperwall.editor;
    const nodes = [...document.querySelectorAll('[data-testid="page"] [data-id]')];
    for (const n of nodes) n.kept = true;
    ed.update({ x: 50 }, null, [ed.pageData.elements[1].id]);
    return [...document.querySelectorAll('[data-testid="page"] svg > g[data-id]')].map((n) => !!n.kept);
  });
  assert.deepEqual(kept, [true, false, true, true]);
  // The design's preview is drawn from small copies of its photos: quick.
  const thumb = await page.evaluate(async () => {
    const ed = window.paperwall.editor;
    await ed.persistThumb(); // (the copies are made the first time)
    const t = performance.now();
    await ed.persistThumb();
    return performance.now() - t;
  });
  assert.ok(thumb < 1000, `a preview took ${Math.round(thumb)} ms`);
  // Undo steps share the photos: each is small.
  const step = await page.evaluate(() => {
    const ed = window.paperwall.editor;
    return ed.history.past.at(-1).length;
  });
  assert.ok(step < 200000, `an undo step is ${step} characters`);
  assert.deepEqual(errors, []);
  await context.close();
});

test('[APP-07] typing in a 200-paragraph document stays quick', async () => {
  const { page, context, errors } = await newDesign('doc');
  await page.evaluate(() => {
    const ed = window.paperwall.editor;
    const body = ed.pageData.elements[1];
    const more = Array.from({ length: 200 }, (_, i) => ({ ...JSON.parse(JSON.stringify(body)), id: `para${i}`, y: 10000 + i, text: `Paragraph ${i + 1}. ${'Words that wrap over a few lines of the page. '.repeat(5)}` }));
    ed.change(() => ed.pageData.elements.push(...more));
  });
  await settled(page);
  const id = await page.evaluate(() => {
    const ed = window.paperwall.editor;
    const el = ed.pageData.elements[198]; // (near the end: a new line moves just the few below)
    window.paperwall.canvas.startTextEdit(el);
    return el.id;
  });
  await page.waitForSelector('[data-testid="text-editor"]');
  await page.keyboard.press('End');
  // Every other block stays as it was drawn.
  await page.evaluate(() => {
    for (const n of document.querySelectorAll('[data-testid="page"] svg > g[data-id]')) n.kept = true;
  });
  const times = await page.evaluate(async () => {
    const ta = document.querySelector('[data-testid="text-editor"]');
    const out = [];
    for (let i = 0; i < 20; i++) {
      const t = performance.now();
      ta.value += i % 5 === 4 ? ' ' : 'x';
      ta.dispatchEvent(new Event('input'));
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
      out.push(performance.now() - t);
    }
    return out.sort((a, b) => a - b);
  });
  const median = times[times.length >> 1];
  assert.ok(median < 100, `a keystroke: median ${Math.round(median)} ms (${times.map(Math.round).join(', ')})`);
  const redrawn = await page.evaluate(() => [...document.querySelectorAll('[data-testid="page"] svg > g[data-id]')].filter((n) => !n.kept).length);
  assert.ok(redrawn <= 4, `${redrawn} blocks drawn again`);
  await page.keyboard.press('Escape');
  const text = await page.evaluate((i) => window.paperwall.editor.pageData.elements.find((e) => e.id === i).text, id);
  assert.match(text, /xxxx xxxx/);
  assert.deepEqual(errors, []);
  await context.close();
});

/** Put a one-second video of a square popping up on a blue screen on the page (made here, as a WebM), at `box`. Resolves to its element id. */
function addClip(page, box) {
  return page.evaluate(async (b) => {
    const ed = window.paperwall.editor;
    const clipDoc = JSON.parse(JSON.stringify(ed.doc));
    Object.assign(clipDoc, { width: 320, height: 240, document: undefined, board: undefined });
    clipDoc.pages = [{ id: 'clip', background: { type: 'color', color: '#2040ff' }, duration: 1, elements: [{ id: 'sq', type: 'shape', shape: 'rect', x: 110, y: 70, w: 100, h: 100, rotation: 0, opacity: 1, fill: '#ffff00', anim: { type: 'pop', duration: 0.5 } }] }];
    const blob = await window.paperwall.export.exportVideo(clipDoc, [0], { container: 'webm' });
    const dataUrl = await new Promise((ok) => {
      const r = new FileReader();
      r.onload = () => ok(r.result.replace(/^data:[^;,]*/, 'data:video/webm'));
      r.readAsDataURL(blob);
    });
    const filters = { brightness: 100, contrast: 100, saturation: 100, grayscale: 0, sepia: 0, blur: 0, warmth: 0, tint: 0, hue: 0, vignette: 0, duotone: null };
    const el = { id: 'clip-el', type: 'video', x: b.x, y: b.y, w: b.w, h: b.h, rotation: 0, opacity: 1, assetId: 'clip', crop: { x: 0, y: 0, w: 1, h: 1 }, filters, radius: 0, mask: 'none', trim: { start: 0 }, loop: true };
    ed.change(() => {
      ed.doc.assets.clip = { type: 'video', mime: 'video/webm', dataUrl, width: 320, height: 240, duration: 1 };
      ed.pageData.elements.push(el);
    });
    return el.id;
  }, box);
}

test('[APP-07] a video download draws what is still once, with the video and what is over it in place', async () => {
  const { page, context, errors } = await newDesign('square');
  await addClip(page, { x: 0, y: 0, w: 1080, h: 810 });
  // A red bar over the video, and a green one below it.
  await page.evaluate(() => {
    const ed = window.paperwall.editor;
    const bar = (id, y, fill) => ({ id, type: 'shape', shape: 'rect', x: 0, y, w: 1080, h: 120, rotation: 0, opacity: 1, fill });
    ed.change(() => {
      ed.pageData.elements.unshift(bar('under', 900, '#00c000'));
      ed.pageData.elements.push(bar('over', 600, '#ff0000'));
    });
    ed.setPageMotion(0, { duration: 3 });
  });
  const out = await page.evaluate(async () => {
    const ed = window.paperwall.editor;
    const t = performance.now();
    const blob = await window.paperwall.export.exportVideo(ed.doc, [0], { container: 'webm' });
    const took = performance.now() - t;
    const v = document.createElement('video');
    v.muted = true;
    v.src = URL.createObjectURL(blob);
    await new Promise((ok) => (v.onloadeddata = ok));
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    const g = c.getContext('2d', { willReadFrequently: true });
    const at = async (time) => {
      v.currentTime = time;
      await new Promise((ok) => (v.onseeked = ok));
      g.drawImage(v, 0, 0);
      const px = (x, y) => [...g.getImageData(Math.round((x * c.width) / 1080), Math.round((y * c.height) / 1080), 1, 1).data].slice(0, 3);
      // (The video fills 1080 × 810: its square's corner, then the blue around it.)
      return { over: px(540, 660), under: px(540, 960), square: px(400, 270), video: px(100, 100) };
    };
    return { took, a: await at(0.1), b: await at(0.8) };
  });
  assert.ok(out.took < 60000, `made in ${Math.round(out.took)} ms`);
  const near = (p, q) => p.every((v, i) => Math.abs(v - q[i]) < 60);
  for (const f of [out.a, out.b]) {
    assert.ok(near(f.over, [255, 0, 0]), `the bar over the video stays over it: ${f.over}`);
    assert.ok(near(f.under, [0, 192, 0]), `the bar below it shows: ${f.under}`);
    assert.ok(near(f.video, [32, 64, 255]), `the video shows: ${JSON.stringify(out)}`);
  }
  assert.ok(near(out.a.square, [32, 64, 255]) && near(out.b.square, [255, 255, 0]), `and moves: ${out.a.square} → ${out.b.square}`);
  assert.deepEqual(errors, []);
  await context.close();
});

test('[APP-07] previews shrink every photo to the size it shows (cropped too), empty frames before them or not', async () => {
  const { page, context, errors } = await newDesign('square');
  const sizes = await page.evaluate(async () => {
    const photo = (color) => {
      const c = document.createElement('canvas');
      c.width = 2400;
      c.height = 1600;
      const g = c.getContext('2d');
      g.fillStyle = color;
      g.fillRect(0, 0, 2400, 1600);
      return c.toDataURL('image/jpeg', 0.9);
    };
    const filters = { brightness: 100, contrast: 100, saturation: 100, grayscale: 0, sepia: 0, blur: 0, warmth: 0, tint: 0, hue: 0, vignette: 0, duotone: null };
    const img = (id, assetId, x, crop = { x: 0, y: 0, w: 1, h: 1 }) => ({ id, type: 'image', x, y: 100, w: 300, h: 200, rotation: 0, opacity: 1, assetId, crop, filters, radius: 0, mask: 'none' });
    const doc = JSON.parse(JSON.stringify(window.paperwall.editor.doc));
    doc.assets = { a: { type: 'image', mime: 'image/jpeg', dataUrl: photo('#c04020'), width: 2400, height: 1600 }, b: { type: 'image', mime: 'image/jpeg', dataUrl: photo('#2040c0'), width: 2400, height: 1600 } };
    // Two empty frames (no picture yet) first, then the photos: one whole,
    // one zoomed in to a quarter of it (all of it shows four times bigger).
    doc.pages[0].elements = [img('e1', null, 0), img('e2', null, 300), img('p1', 'a', 600), img('p2', 'b', 0, { x: 0.375, y: 0.375, w: 0.25, h: 0.25 })];
    const small = await window.paperwall.withSmallPictures(doc);
    // Asked again, bigger: its own copy, not the small one kept from before.
    const bigger = await window.paperwall.withSmallPictures(doc, 1200);
    const again = await window.paperwall.withSmallPictures(doc);
    return [small, bigger, again].map((d) => ['a', 'b'].map((id) => d.assets[id].width));
  });
  // A 720 px preview of the 1080 px page shows them 200 and 800 px wide; 1200 px, 333 and 1333.
  const want = [[200, 800], [333, 1333], [200, 800]];
  assert.ok(sizes.every((pair, i) => pair.every((w, k) => Math.abs(w - want[i][k]) <= 3)), JSON.stringify(sizes));
  assert.deepEqual(errors, []);
  await context.close();
});

test('[APP-07] a video that never shows its picture where it is sent: a download gives up on it once, and says so', async () => {
  const { page, context, errors } = await newDesign('square');
  await addClip(page, { x: 0, y: 0, w: 1080, h: 810 });
  await page.evaluate(() => window.paperwall.editor.setPageMotion(0, { duration: 2 }));
  const out = await page.evaluate(async () => {
    const ed = window.paperwall.editor;
    const proto = HTMLMediaElement.prototype;
    const ready = Object.getOwnPropertyDescriptor(proto, 'readyState');
    const time = Object.getOwnPropertyDescriptor(proto, 'currentTime');
    let sent = 0;
    // Every video seeks, but never has its picture there; and each time one is sent somewhere is counted.
    Object.defineProperty(proto, 'readyState', { configurable: true, get() { return Math.min(1, ready.get.call(this)); } });
    Object.defineProperty(proto, 'currentTime', { configurable: true, get() { return time.get.call(this); }, set(v) { sent++; time.set.call(this, v); } });
    const notes = [];
    const t0 = performance.now();
    try {
      await window.paperwall.export.exportVideo(ed.doc, [0], { container: 'webm', onNote: (m) => notes.push(m) });
    } finally {
      Object.defineProperty(proto, 'readyState', ready);
      Object.defineProperty(proto, 'currentTime', time);
    }
    return { took: performance.now() - t0, notes, sent };
  });
  // 60 frames: one wait of 1.5 s, not one each.
  assert.ok(out.took < 20000, `made in ${Math.round(out.took)} ms`);
  assert.ok(out.sent <= 3, `sent to a time ${out.sent} times, then left alone`);
  assert.equal(out.notes.length, 1, 'the download says a video couldn\'t be followed');
  assert.deepEqual(errors, []);
  await context.close();
});

test('[APP-07] a video seeks again and again without waiting out a timeout', async () => {
  const { page, context, errors } = await newDesign('square');
  await addClip(page, { x: 0, y: 0, w: 1080, h: 810 });
  const out = await page.evaluate(async () => {
    const ed = window.paperwall.editor;
    const el = ed.find('clip-el');
    const frames = new window.paperwall.VideoFrames(ed.doc);
    const took = [];
    let shown = 0;
    try {
      // Back and forth, then frame by frame: each seek waits for its picture there.
      for (const at of [0.9, 0.1, 0.5, 0.2, 0.8, ...Array.from({ length: 20 }, (_, i) => i / 30)]) {
        const t0 = performance.now();
        if (await frames.at(el, at)) shown++;
        took.push(performance.now() - t0);
      }
    } finally {
      frames.dispose();
    }
    return { shown, slowest: Math.max(...took.slice(1)), stuck: !!frames.stuck };
  });
  assert.equal(out.shown, 25, 'a picture each time');
  assert.equal(out.stuck, false);
  assert.ok(out.slowest < 2000, `no seek waits out the 5 s timeout: slowest ${Math.round(out.slowest)} ms`);
  assert.deepEqual(errors, []);
  await context.close();
});

test('[MOT-07] in Safari, a presented video plays live over the slide, where it is on the page', async () => {
  const safari = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
  const { page, context } = await newDesign('square', { userAgent: safari });
  await addClip(page, { x: 270, y: 135, w: 540, h: 405 });
  await page.click('[data-testid="present"]');
  await page.waitForFunction(() => {
    const v = document.querySelector('[data-testid="slide-video-box"] video');
    return v && v.currentTime > 0.2;
  });
  const placed = await page.evaluate(() => {
    const svg = document.querySelector('[data-testid="slide"] svg').getBoundingClientRect();
    const box = document.querySelector('[data-testid="slide-video-box"]').getBoundingClientRect();
    const k = svg.width / 1080;
    return [box.left - svg.left - 270 * k, box.top - svg.top - 135 * k, box.width - 540 * k, box.height - 405 * k];
  });
  assert.ok(placed.every((d) => Math.abs(d) < 2), `over its place in the slide: ${placed}`);
  assert.equal(await page.locator('[data-testid="slide"] foreignObject video').count(), 0, 'not inside the slide');
  await page.keyboard.press('Escape');
  // Turned, it can't be laid over the slide as it looks: it shows as pictures.
  await page.evaluate(() => {
    const ed = window.paperwall.editor;
    ed.update({ rotation: 20 }, null, ['clip-el']);
  });
  await page.click('[data-testid="present"]');
  await page.waitForFunction(() => document.querySelector('[data-testid="slide"] image'));
  await page.waitForTimeout(600);
  assert.equal(await page.locator('[data-testid="slide-video-box"]').count(), 0);
  await page.keyboard.press('Escape');
  // Hanging off the page, it couldn't be cut to the slide over it: pictures too.
  await page.evaluate(() => window.paperwall.editor.update({ rotation: 0, x: 800 }, null, ['clip-el']));
  await page.click('[data-testid="present"]');
  await page.waitForFunction(() => document.querySelector('[data-testid="slide"] image'));
  await page.waitForTimeout(600);
  assert.equal(await page.locator('[data-testid="slide-video-box"]').count(), 0, 'not laid over past the slide');
  await page.keyboard.press('Escape');
  await context.close();
});

test('[APP-07] a picture whose file changes under the same id lets its old blob: URL go, and going home lets them all go', async () => {
  const { page, context } = await newDesign('square');
  const gone = await page.evaluate(async () => {
    const { editor: ed, canvas } = window.paperwall;
    const png = (color) => {
      const c = document.createElement('canvas');
      c.width = c.height = 8;
      const g = c.getContext('2d');
      g.fillStyle = color;
      g.fillRect(0, 0, 8, 8);
      return c.toDataURL('image/png');
    };
    ed.doc.assets.swap = { type: 'image', mime: 'image/png', dataUrl: png('#ff0000'), width: 8, height: 8, name: 'swap.png' };
    const first = canvas.assetHref('swap');
    const again = canvas.assetHref('swap');
    ed.doc.assets.swap = { ...ed.doc.assets.swap, dataUrl: png('#0000ff') };
    const second = canvas.assetHref('swap');
    window.lastHref = second;
    const loads = (url) => new Promise((ok) => {
      const img = new Image();
      img.onload = () => ok(true);
      img.onerror = () => ok(false);
      img.src = url;
    });
    return { same: first === again, changed: first !== second, oldLoads: await loads(first), newLoads: await loads(second) };
  });
  assert.deepEqual(gone, { same: true, changed: true, oldLoads: false, newLoads: true });
  // Back home, the design's blob: URLs go too.
  await page.click('[data-testid="home-link"]');
  await page.waitForSelector('[data-testid="presets"]');
  assert.equal(await page.evaluate(() => new Promise((ok) => {
    const img = new Image();
    img.onload = () => ok(true);
    img.onerror = () => ok(false);
    img.src = window.lastHref;
  })), false);
  await context.close();
});
