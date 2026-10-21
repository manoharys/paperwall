import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { newDesign, elements, uploadImages, makePng, mod, teardown } from './helpers.js';
import { tinyCutoutModel, opsModel } from '../fixtures/tiny-models.js';
import { PROVIDERS } from '../../src/model/providers.js';

after(teardown);

const MODEL_URL = PROVIDERS.u2netp.model.url;
const last = async (page) => (await elements(page)).at(-1);

/**
 * Serve a tiny stand-in for the model at its real address (nothing goes
 * online), and let the app accept it: tests say its hash (only honored
 * under automation). Returns how many times it was downloaded.
 */
async function mockModel(page, bytes) {
  const hits = { count: 0 };
  await page.context().route('**/*', (route) => {
    const url = route.request().url();
    if (url === MODEL_URL) {
      hits.count++;
      return route.fulfill({ status: 200, contentType: 'application/octet-stream', headers: { 'access-control-allow-origin': '*' }, body: Buffer.from(bytes) });
    }
    // Anything else off this machine: refused (no real network in tests).
    return /^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url) || !/^https?:/.test(url) ? route.continue() : route.abort();
  });
  const sha = createHash('sha256').update(bytes).digest('hex');
  await page.evaluate((s) => {
    globalThis.PAPERWALL_TEST_CUTOUT_SHA256 = s;
  }, sha);
  return hits;
}

/** The picture's alpha at a few points, drawn as it is now. */
function alphaAt(page, points) {
  return page.evaluate(async (pts) => {
    const ed = window.paperwall.editor;
    const a = ed.doc.assets[ed.single.assetId];
    const img = new Image();
    img.src = a.dataUrl;
    await img.decode();
    const cv = document.createElement('canvas');
    cv.width = img.naturalWidth;
    cv.height = img.naturalHeight;
    const g = cv.getContext('2d');
    g.drawImage(img, 0, 0);
    return pts.map(([fx, fy]) => g.getImageData(Math.min(cv.width - 1, Math.floor(fx * cv.width)), Math.min(cv.height - 1, Math.floor(fy * cv.height)), 1, 1).data[3]);
  }, points);
}

test('[IMG-11] remove a busy background with a model on this device', async () => {
  const { page, context, errors } = await newDesign('square');
  const hits = await mockModel(page, tinyCutoutModel());
  await uploadImages(page, [await makePng(page, { w: 400, h: 300, color: '#2a9d8f' })]);
  const img = await last(page);
  await page.click(`[data-testid="page"] [data-id="${img.id}"]`, { force: true }).catch(() => null);
  await page.evaluate((id) => window.paperwall.editor.select([id]), img.id);

  // Off until turned on: the first time, it says what it will download and from where.
  await page.click('[data-testid="remove-bg-smart"]');
  const ask = page.locator('[data-testid="cutout-dialog"]');
  await ask.waitFor();
  const text = await ask.innerText();
  assert.match(text, /4\.6 MB/);
  assert.match(text, /cdn\.jsdelivr\.net/);
  assert.match(text, /Apache-2\.0/);
  assert.equal(hits.count, 0, 'nothing is downloaded before saying yes');
  await page.click('[data-testid="cutout-download"]');
  await page.waitForFunction((a) => window.paperwall.editor.single?.assetId !== a, img.assetId, { timeout: 60000 });
  await ask.waitFor({ state: 'detached' });
  assert.equal(hits.count, 1);

  // The corners are see-through now, the middle (the "subject") stays.
  const [corner, corner2, middle] = await alphaAt(page, [[0.02, 0.02], [0.98, 0.98], [0.5, 0.5]]);
  assert.equal(corner, 0);
  assert.equal(corner2, 0);
  assert.equal(middle, 255);
  const cut = (await last(page)).assetId;

  // Refine edges redoes the cut from the original (still one more undo step at most).
  await page.locator('[data-testid="cutout-refine"]').fill('100');
  await page.waitForFunction((a) => window.paperwall.editor.single?.assetId !== a, cut);
  await page.evaluate(() => document.activeElement?.blur());
  assert.deepEqual(await alphaAt(page, [[0.02, 0.02], [0.5, 0.5]]), [0, 255]);
  await page.keyboard.press(`${mod}+z`);
  assert.equal((await last(page)).assetId, cut, 'undo goes back to the first cut');

  // One undo step brings the original back.
  await page.keyboard.press(`${mod}+z`);
  assert.equal((await last(page)).assetId, img.assetId, 'one undo brings the original back');

  // The model stays on this device: the second time there's no question and no download.
  await page.click('[data-testid="remove-bg-smart"]');
  await page.waitForFunction((a) => window.paperwall.editor.single?.assetId !== a, img.assetId, { timeout: 60000 });
  assert.equal(hits.count, 1, 'downloaded once');
  assert.deepEqual(await alphaAt(page, [[0.02, 0.98], [0.5, 0.5]]), [0, 255]);
  assert.deepEqual(errors, []);
  await context.close();
});

test('[IMG-11] a model file that isn\'t the pinned one is refused', async () => {
  const { page, context } = await newDesign('square');
  const hits = await mockModel(page, tinyCutoutModel());
  await page.evaluate(() => {
    globalThis.PAPERWALL_TEST_CUTOUT_SHA256 = '0'.repeat(64); // (not this file's)
  });
  await uploadImages(page, [await makePng(page, { w: 200, h: 200 })]);
  const img = await last(page);
  await page.evaluate((id) => window.paperwall.editor.select([id]), img.id);
  await page.click('[data-testid="remove-bg-smart"]');
  await page.click('[data-testid="cutout-download"]');
  await page.waitForSelector('.toast.error');
  assert.match(await page.locator('.toast.error').innerText(), /isn't the expected file/);
  assert.equal(hits.count, 1);
  assert.equal((await last(page)).assetId, img.assetId, 'the picture is untouched');
  // And nothing was kept: the next try asks again.
  await page.click('[data-testid="remove-bg-smart"]');
  await page.waitForSelector('[data-testid="cutout-download"]');
  await context.close();
});

test('[IMG-11] the graphics card and the processor give the same answers', async () => {
  const { page, context } = await newDesign('square');
  const b64 = Buffer.from(opsModel(24, 7)).toString('base64');
  const res = await page.evaluate(async (data) => {
    const { readModel, runCutoutModel } = window.paperwall.cutout;
    const model = readModel(Uint8Array.from(atob(data), (c) => c.charCodeAt(0)));
    const S = 24;
    const input = { dims: [1, 3, S, S], data: Float32Array.from({ length: 3 * S * S }, (_, i) => Math.sin(i * 0.37) * 2), dtype: 1 };
    const cpu = await runCutoutModel(model, input, { engine: 'cpu' });
    let gpu;
    try {
      gpu = await runCutoutModel(model, input, { engine: 'gpu' });
    } catch (e) {
      return { skipped: e.message };
    }
    let diff = 0;
    for (let i = 0; i < cpu.out.data.length; i++) diff = Math.max(diff, Math.abs(cpu.out.data[i] - gpu.out.data[i]));
    return { diff, n: cpu.out.data.length, engines: [cpu.engine, gpu.engine], dims: gpu.out.dims };
  }, b64);
  if (res.skipped) {
    // (A browser without WebGL2 float support uses the processor, which the unit tests check.)
    console.log(`# graphics card check skipped: ${res.skipped}`);
  } else {
    assert.deepEqual(res.engines, ['cpu', 'gpu']);
    assert.deepEqual(res.dims, [1, 1, 24, 24]);
    assert.ok(res.diff < 1e-4, `largest difference ${res.diff}`);
  }
  await context.close();
});
