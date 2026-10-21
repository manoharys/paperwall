import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { newDesign, state, elements, addShape, clickElement, teardown, downloadVia, openTab } from './helpers.js';

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
  // "Play this page" (in an element's Animate panel) plays just that page.
  await page.evaluate(() => {
    const ed = window.paperwall.editor;
    ed.select([ed.pageData.elements.find((e) => e.anim).id]);
  });
  await page.click('[data-testid="anim-play"]');
  await page.waitForSelector('[data-testid="presenter"]');
  assert.equal(await page.textContent('.slide-count'), '1 / 1');
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

/** A one-second WebM made here by Paperwall itself: a red square popping in on white. */
async function makeClip(page) {
  const bytes = await page.evaluate(async () => {
    const ed = window.paperwall.editor;
    const doc = JSON.parse(JSON.stringify(ed.doc));
    doc.width = 320;
    doc.height = 240;
    doc.pages = [{ id: 'clip', elements: [{ id: 'sq', type: 'shape', shape: 'rect', x: 110, y: 70, w: 100, h: 100, rotation: 0, opacity: 1, fill: '#ff0000', anim: { type: 'pop', duration: 0.5 } }], background: { type: 'color', color: '#ffffff' }, duration: 1 }];
    const blob = await window.paperwall.export.exportVideo(doc, [0], { container: 'webm' });
    return [...new Uint8Array(await blob.arrayBuffer())];
  });
  return Buffer.from(bytes);
}

/** A one-second 440 Hz tone as a WAV file. */
function makeTone() {
  const rate = 44100;
  const n = rate;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((i / rate) * 2 * Math.PI * 440) * 12000), 44 + i * 2);
  return buf;
}

test('[MOT-07] add a video: it shows its poster, plays when presenting and moves in downloads', async () => {
  const { page, context } = await newDesign('square');
  const clip = await makeClip(page);
  await openTab(page, 'uploads');
  const chooser = page.waitForEvent('filechooser');
  await page.click('[data-testid="upload-btn"]');
  await (await chooser).setFiles({ name: 'clip.webm', mimeType: 'video/webm', buffer: clip });
  await page.waitForFunction(() => window.paperwall.editor.pageData.elements.some((e) => e.type === 'video'));
  const v = (await elements(page)).find((e) => e.type === 'video');
  const asset = await state(page, (ed, id) => ed.doc.assets[id], v.assetId);
  assert.equal(asset.type, 'video');
  assert.ok(asset.duration > 0.8 && asset.duration < 1.3, `${asset.duration} seconds`);
  assert.match(asset.poster, /^data:image\/jpeg/);
  assert.equal(Math.round(v.w / v.h * 100), Math.round(320 / 240 * 100), 'its own shape');
  await page.waitForSelector('[data-testid="upload-item"][data-kind="video"]');
  // Its still picture (on the page and in still downloads) is taken full size from where it starts,
  // and again when its start point moves.
  await page.waitForFunction(() => {
    const ed = window.paperwall.editor;
    const v = ed.pageData.elements.find((e) => e.type === 'video');
    return v?.still && ed.doc.assets[v.still]?.type !== 'video' && ed.doc.assets[v.still]?.width === 320;
  });
  const stills = await page.evaluate(async () => {
    const ed = window.paperwall.editor;
    const v = ed.pageData.elements.find((e) => e.type === 'video');
    const first = v.still;
    const firstPicture = ed.doc.assets[first].dataUrl;
    ed.update({ trim: { start: 0.6 } }, null, [v.id]);
    await ed.refreshStill(v.id);
    const now = ed.pageData.elements.find((e) => e.type === 'video');
    // (The old still is let go of: nothing shows it now.)
    return [first, now.still, firstPicture !== ed.doc.assets[now.still].dataUrl && !ed.doc.assets[first]];
  });
  assert.notEqual(stills[0], stills[1], 'a new still for the new start');
  assert.ok(stills[2], 'a different picture');
  await page.evaluate(() => {
    const ed = window.paperwall.editor;
    ed.update({ trim: { start: 0 } }, null, [ed.pageData.elements.find((e) => e.type === 'video').id]);
  });
  // Its panel: where it starts, looping.
  await page.click('[data-testid="video-loop"]');
  assert.equal((await elements(page)).find((e) => e.type === 'video').loop, false);
  // Uploads lists it without its bytes; using it from there still adds it whole.
  await page.click('[data-testid="upload-item"][data-kind="video"]');
  await page.waitForFunction(() => window.paperwall.editor.pageData.elements.filter((e) => e.type === 'video').length === 2);
  await page.evaluate(() => window.paperwall.editor.undo());
  // Presenting shows it playing, live, in its own place in the slide.
  await page.click('[data-testid="present"]');
  await page.waitForFunction(() => {
    const v = document.querySelector('[data-testid="slide"] foreignObject[data-video] video');
    return v && v.currentTime > 0.2;
  });
  await page.keyboard.press('Escape');
  // A GIF of the page has the square popping in, from the video alone.
  const gif = await page.evaluate(async () => {
    const ed = window.paperwall.editor;
    ed.setPageMotion(0, { duration: 1 });
    const blob = await window.paperwall.export.exportGif(ed.doc, [0]);
    return [...new Uint8Array(await blob.arrayBuffer())];
  });
  const frames = Buffer.from(gif).toString('latin1').split('\x21\xf9\x04').length - 1;
  assert.ok(frames > 3, `${frames} frames: the video moves`);
  await context.close();
});

test('[MOT-08] a soundtrack: a sound from Uploads plays in downloaded videos', async () => {
  const { page, context } = await newDesign('square');
  await openTab(page, 'uploads');
  const chooser = page.waitForEvent('filechooser');
  await page.click('[data-testid="upload-btn"]');
  await (await chooser).setFiles({ name: 'tone.wav', mimeType: 'audio/wav', buffer: makeTone() });
  await page.waitForFunction(() => !!window.paperwall.editor.doc.audio);
  // The Uploads list shows it once it's refreshed.
  await page.waitForSelector('[data-testid="upload-item"][data-kind="audio"]');
  // The page panel shows it, with a volume.
  await page.evaluate(() => window.paperwall.editor.deselect());
  assert.match(await page.textContent('[data-testid="soundtrack"]'), /tone\.wav/);
  // A WebM download carries it as Opus.
  const webm = await page.evaluate(async () => {
    const ed = window.paperwall.editor;
    ed.setPageMotion(0, { duration: 1 });
    const blob = await window.paperwall.export.exportVideo(ed.doc, [0], { container: 'webm', audio: await window.paperwall.export.soundtrackBuffer(ed.doc) });
    return [...new Uint8Array(await blob.arrayBuffer())];
  });
  const bytes = Buffer.from(webm);
  assert.ok(bytes.includes(Buffer.from('A_OPUS')), 'an Opus sound track');
  // Removing it.
  await page.click('[data-testid="soundtrack-remove"]');
  assert.equal(await state(page, (ed) => !!ed.doc.audio), false);
  await context.close();
});

test('[MOT-05] closing the download dialog stops a GIF being made', async () => {
  const { page, context } = await newDesign('square');
  await shortMovie(page);
  await page.click('[data-testid="download"]');
  await page.click('[data-testid="export-format"] [data-value="gif"]');
  let downloaded = false;
  page.on('download', () => (downloaded = true));
  await page.click('[data-testid="export-download"]');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(4000);
  assert.equal(downloaded, false, 'nothing arrives after closing');
  await context.close();
});
