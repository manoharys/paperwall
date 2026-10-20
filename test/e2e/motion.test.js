import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { newDesign, state, elements, addShape, clickElement, teardown, downloadVia } from './helpers.js';

after(teardown);

/** Set a slider as if dragged and let go. */
async function setRange(page, testid, value) {
  await page.$eval(`[data-testid="${testid}"]`, (el, v) => {
    el.value = String(v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

test('[MOT-01] animate an element: pick how it comes in, its duration and delay', async () => {
  const { page, context } = await newDesign('square');
  const s = await addShape(page, 'Square');
  assert.ok(await page.locator('[data-testid="anim-types"] button').count() >= 9);
  await page.click('[data-testid="anim-rise"]');
  let el = (await elements(page)).find((e) => e.id === s.id);
  assert.equal(el.anim.type, 'rise');
  await setRange(page, 'anim-duration', 1.5);
  await setRange(page, 'anim-delay', 2);
  el = (await elements(page)).find((e) => e.id === s.id);
  assert.deepEqual([el.anim.duration, el.anim.delay], [1.5, 2]);
  // Another kind keeps its timing; None takes it away.
  await page.click('[data-testid="anim-pop"]');
  el = (await elements(page)).find((e) => e.id === s.id);
  assert.deepEqual([el.anim.type, el.anim.delay], ['pop', 2]);
  await page.click('[data-testid="anim-none"]');
  assert.ok(!(await elements(page)).find((e) => e.id === s.id).anim);
  // Undo brings it back.
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
  assert.equal((await elements(page)).find((e) => e.id === s.id).anim.type, 'pop');
  await context.close();
});

test('[MOT-02] [MOT-03] page motion: animate the page, how long it shows, its transition', async () => {
  const { page, context } = await newDesign('square');
  await addShape(page, 'Square');
  await page.evaluate(() => window.paperwall.editor.deselect()); // nothing selected: the page panel
  await page.selectOption('[data-testid="page-anim"]', 'fade');
  await setRange(page, 'page-duration', 3);
  await page.selectOption('[data-testid="page-transition"]', 'slide');
  const p = await state(page, (ed) => ed.pageData);
  assert.equal(p.anim.type, 'fade');
  assert.equal(p.duration, 3);
  assert.equal(p.transition.type, 'slide');
  // An element without its own animation says it comes in with the page.
  const s = (await elements(page))[0];
  await clickElement(page, s.id);
  assert.match(await page.textContent('.inspector-body'), /Comes in with the page's fade animation/);
  await context.close();
});

test('[MOT-04] play: elements come in over time, and pages move on by themselves', async () => {
  const { page, context } = await newDesign('square');
  await page.evaluate(() => {
    const ed = window.paperwall.editor;
    const s = ed.addShape('rect');
    ed.update({ fill: '#ff0000', anim: { type: 'fade', duration: 0.6, delay: 0.3 } }, null, [s.id]);
    ed.setPageMotion(0, { duration: 1.2 });
    ed.addPage();
    ed.setPageMotion(1, { transition: { type: 'fade', duration: 0.3 } });
    ed.setPage(0);
  });
  await page.click('[data-testid="play"]');
  await page.waitForSelector('[data-testid="presenter"]');
  // At first the red square isn't there yet; a moment later it is.
  const early = await page.innerHTML('[data-testid="slide"]');
  assert.ok(!/#ff0000/.test(early), 'not in yet');
  await page.waitForFunction(() => /#ff0000/.test(document.querySelector('[data-testid="slide"]').innerHTML));
  // After its 1.2 seconds, the next page.
  await page.waitForFunction(() => document.querySelector('.slide-count').textContent.startsWith('2 /'), null, { timeout: 5000 });
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('[data-testid="presenter"]').count(), 0);
  await context.close();
});

test('[MOT-04] presenting plays a page\'s animations too (without moving on by itself)', async () => {
  const { page, context } = await newDesign('square');
  await page.evaluate(() => {
    const ed = window.paperwall.editor;
    const s = ed.addShape('rect');
    ed.update({ fill: '#00aa00', anim: { type: 'rise', duration: 0.4, delay: 0.2 } }, null, [s.id]);
    ed.setPageMotion(0, { duration: 1 });
    ed.addPage();
    ed.setPage(0);
  });
  await page.click('[data-testid="present"]');
  await page.waitForFunction(() => /#00aa00/.test(document.querySelector('[data-testid="slide"]')?.innerHTML || ''));
  await page.waitForTimeout(1500);
  assert.ok((await page.textContent('.slide-count')).startsWith('1 /'), 'still on the first page');
  await page.keyboard.press('Escape');
  await context.close();
});

/** A short animated design: a red square that pops in, then a second page. */
async function shortMovie(page) {
  await page.evaluate(() => {
    const ed = window.paperwall.editor;
    const s = ed.addShape('rect');
    ed.update({ fill: '#ff0000', anim: { type: 'pop', duration: 0.5 } }, null, [s.id]);
    ed.setPageMotion(0, { duration: 1 });
    ed.addPage();
    ed.setPageMotion(1, { duration: 1, transition: { type: 'fade', duration: 0.4 } });
    ed.setPage(0);
  });
}

test('[MOT-05] download as an animated GIF', async () => {
  const { page, context } = await newDesign('square');
  await shortMovie(page);
  const { name, bytes } = await downloadVia(page, async () => {
    await page.click('[data-testid="export-format"] [data-value="gif"]');
    assert.match(await page.textContent('[data-testid="export-length"]'), /2 seconds long/);
  });
  assert.match(name, /\.gif$/);
  assert.equal(bytes.subarray(0, 6).toString('latin1'), 'GIF89a');
  // The browser can open it, at the GIF size (long side 720 at most).
  const size = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/gif;base64,${b64}`;
    await img.decode();
    return [img.naturalWidth, img.naturalHeight];
  }, bytes.toString('base64'));
  assert.deepEqual(size, [720, 720]);
  // More than one frame: the square pops in.
  const frames = bytes.toString('latin1').split('\x21\xf9\x04').length - 1;
  assert.ok(frames > 3, `${frames} frames`);
  await context.close();
});

test('[MOT-06] download as a video: WebM and MP4', async () => {
  const { page, context } = await newDesign('square');
  await shortMovie(page);
  const can = await page.evaluate(() => typeof VideoEncoder !== 'undefined');
  assert.ok(can, 'this browser encodes video');
  // WebM: plays back here, two seconds long.
  const { name, bytes } = await downloadVia(page, () => page.click('[data-testid="export-format"] [data-value="webm"]'));
  assert.match(name, /\.webm$/);
  assert.equal(bytes.readUInt32BE(0), 0x1a45dfa3, 'a Matroska/WebM file');
  const played = await page.evaluate(async (b64) => {
    const v = document.createElement('video');
    v.muted = true;
    v.src = `data:video/webm;base64,${b64}`;
    await new Promise((ok, fail) => {
      v.onloadedmetadata = ok;
      v.onerror = () => fail(new Error('could not load'));
    });
    return { w: v.videoWidth, h: v.videoHeight, d: v.duration };
  }, bytes.toString('base64'));
  assert.deepEqual([played.w, played.h], [1080, 1080]);
  assert.ok(Math.abs(played.d - 2) < 0.2, `duration ${played.d}`);
  // MP4: the boxes are there, with a sample for every frame.
  const mp4 = await page.evaluate(async () => {
    const blob = await window.paperwall.export.exportVideo(window.paperwall.editor.doc, [0, 1], { container: 'mp4' });
    return [...new Uint8Array(await blob.arrayBuffer())];
  });
  const buf = Buffer.from(mp4);
  assert.equal(buf.subarray(4, 8).toString(), 'ftyp');
  const types = [];
  for (let p = 0; p < buf.length;) {
    const size = buf.readUInt32BE(p);
    types.push(buf.subarray(p + 4, p + 8).toString());
    p += size;
  }
  assert.deepEqual(types, ['ftyp', 'moov', 'mdat']);
  const stsz = buf.indexOf('stsz');
  assert.equal(buf.readUInt32BE(stsz + 12), 60, '2 seconds at 30 frames a second');
  await context.close();
});
