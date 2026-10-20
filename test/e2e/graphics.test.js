import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { newDesign, state, elements, addShape, clickElement, elementCenter, drag, teardown, makePng, uploadImages, mod, openTab, screenPoint } from './helpers.js';

after(teardown);

const last = async (page) => (await elements(page)).at(-1);
const dom = (page, id) => page.locator(`[data-testid="page"] [data-id="${id}"]`);

async function setNumber(page, testid, value) {
  const input = page.locator(`[data-testid="${testid}"] + input`);
  await input.fill(String(value));
  await input.press('Enter');
}

async function pickColor(page, testid, hex) {
  await page.click(`[data-testid="${testid}"]`);
  await page.fill('[data-testid="hex-input"]', hex);
  await page.press('[data-testid="hex-input"]', 'Enter');
  await page.keyboard.press('Escape');
}

async function withImage() {
  const app = await newDesign('square');
  await uploadImages(app.page, [await makePng(app.page, { w: 800, h: 400 })]);
  const img = await last(app.page);
  return { ...app, img };
}

// ---------- shapes ----------

test('[SHP-01] [SHP-02] rectangles, circles, triangles, stars, polygons, hearts, arrows, speech bubbles', async () => {
  const { page, context } = await newDesign('square');
  const labels = ['Square', 'Rounded square', 'Circle', 'Triangle', 'Diamond', 'Pentagon', 'Star', 'Heart', 'Arrow', 'Speech bubble'];
  for (const l of labels) await addShape(page, l);
  const shapes = (await elements(page)).map((e) => e.shape);
  assert.deepEqual(shapes, ['rect', 'rect', 'ellipse', 'triangle', 'diamond', 'polygon', 'star', 'heart', 'arrow', 'bubble']);
  assert.equal(await page.locator('[data-testid="page"] [data-type="shape"] path').count(), labels.length);
  await context.close();
});

test('[SHP-03] lines with optional arrowheads', async () => {
  const { page, context } = await newDesign('square');
  await openTab(page, 'shapes');
  await page.click('[data-testid="line-Arrow line"]');
  let line = await last(page);
  assert.equal(line.type, 'line');
  assert.equal(line.endCap, 'arrow');
  await page.click('[data-testid="arrow-start"]');
  line = await last(page);
  assert.equal(line.startCap, 'arrow');
  assert.equal(await dom(page, line.id).locator('path').count(), 2, 'two arrowheads drawn');
  await context.close();
});

test('[SHP-04] [SHP-05] fill color, border color, width and dashes', async () => {
  const { page, context } = await newDesign('square');
  const s = await addShape(page, 'Circle');
  await pickColor(page, 'fill-color', '#06d6a0');
  await pickColor(page, 'stroke-color', '#16161d');
  await setNumber(page, 'stroke-width', 12);
  await page.click('[data-testid="stroke-dash"] [data-value="dashed"]');
  const e = await last(page);
  assert.deepEqual([e.fill, e.stroke, e.strokeWidth, e.dash], ['#06d6a0', '#16161d', 12, 'dashed']);
  const path = dom(page, s.id).locator('path');
  assert.equal(await path.getAttribute('fill'), '#06d6a0');
  assert.ok(await path.getAttribute('stroke-dasharray'));
  await context.close();
});

test('[SHP-06] [SHP-08] rounded corners, and the number of star points', async () => {
  const { page, context } = await newDesign('square');
  await addShape(page, 'Square');
  await setNumber(page, 'corner-radius', 40);
  assert.equal((await last(page)).radius, 40);
  await addShape(page, 'Star');
  await setNumber(page, 'sides', 8);
  const star = await last(page);
  assert.equal(star.sides, 8);
  const d = await dom(page, star.id).locator('path').getAttribute('d');
  assert.equal(d.split(/[ML]/).filter((x) => x.trim()).length, 16);
  await context.close();
});

test('[SHP-07] gradient fill', async () => {
  const { page, context } = await newDesign('square');
  const s = await addShape(page, 'Square');
  await page.click('[data-testid="fill-type"] [data-value="gradient"]');
  const e = await last(page);
  assert.equal(e.fill.type, 'linear');
  assert.equal(e.fill.stops.length, 2);
  assert.match(await dom(page, s.id).locator('path').getAttribute('fill'), /^url\(#/);
  assert.equal(await page.locator('[data-testid="page"] linearGradient').count(), 1);
  await context.close();
});

// ---------- images ----------

test('[IMG-01] add an image from your device', async () => {
  const { page, context, img } = await withImage();
  assert.equal(img.type, 'image');
  assert.equal(img.w / img.h, 2, 'keeps the picture shape');
  const doc = await state(page);
  assert.equal(Object.keys(doc.assets).length, 1);
  assert.equal(await dom(page, img.id).locator('image').count(), 1);
  await context.close();
});

async function fileHandle(page, name) {
  return page.evaluateHandle(async (n) => {
    const cv = document.createElement('canvas');
    cv.width = 300;
    cv.height = 300;
    const g = cv.getContext('2d');
    g.fillStyle = '#ff006e';
    g.fillRect(0, 0, 300, 300);
    const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], n, { type: 'image/png' }));
    return dt;
  }, name);
}

test('[IMG-02] drag and drop images onto the page', async () => {
  const { page, context } = await newDesign('square');
  const dt = await fileHandle(page, 'dropped.png');
  const box = await page.locator('[data-testid="page"]').boundingBox();
  await page.dispatchEvent('[data-testid="stage"]', 'drop', { dataTransfer: dt, clientX: box.x + box.width * 0.25, clientY: box.y + box.height * 0.25 });
  await page.waitForFunction(() => window.paperwall.editor.pageData.elements.some((e) => e.type === 'image'));
  const img = await last(page);
  assert.ok(Math.abs(img.x + img.w / 2 - 270) < 2, 'centered where it was dropped');
  await context.close();
});

test('[IMG-03] paste an image from the clipboard', async () => {
  const { page, context } = await newDesign('square');
  const dt = await fileHandle(page, 'pasted.png');
  await page.evaluate((d) => document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: d, bubbles: true })), dt);
  await page.waitForFunction(() => window.paperwall.editor.pageData.elements.some((e) => e.type === 'image'));
  await context.close();
});

test('[IMG-04] reuse images you added before, in any design', async () => {
  const { page, context } = await withImage();
  await page.click('[data-testid="home-link"]');
  await page.click('[data-testid="preset-story"]');
  await page.waitForFunction(() => window.paperwall?.editor?.doc.height === 1920);
  await openTab(page, 'uploads');
  await page.waitForSelector('[data-testid="upload-item"]');
  await page.click('[data-testid="upload-item"]');
  assert.equal((await last(page)).type, 'image');
  await context.close();
});

test('[IMG-05] crop an image', async () => {
  const { page, context, img } = await withImage();
  await page.click('[data-testid="crop-btn"]');
  await setNumber(page, 'crop-zoom', 200);
  let e = await last(page);
  assert.ok(Math.abs(e.crop.w - 0.5) < 0.001 && Math.abs(e.crop.h - 0.5) < 0.001, JSON.stringify(e.crop));
  const c = await elementCenter(page, img.id);
  await drag(page, c, { x: c.x + 40, y: c.y });
  e = await last(page);
  assert.ok(e.crop.x < 0.25, 'dragging moved the picture inside the frame');
  assert.deepEqual([e.x, e.y], [img.x, img.y], 'the frame stayed put');
  await context.close();
});

test('[IMG-06] [IMG-07] brightness, contrast, saturation; black and white, sepia, blur', async () => {
  const { page, context, img } = await withImage();
  await setNumber(page, 'brightness', 130);
  await setNumber(page, 'contrast', 80);
  await setNumber(page, 'saturation', 40);
  let f = (await last(page)).filters;
  assert.deepEqual([f.brightness, f.contrast, f.saturation], [130, 80, 40]);
  assert.match(await dom(page, img.id).locator('image').getAttribute('filter'), /^url\(#/);
  await page.click('[data-testid="filter-presets"] [data-value="bw"]');
  assert.equal((await last(page)).filters.grayscale, 100);
  await page.click('[data-testid="filter-presets"] [data-value="sepia"]');
  assert.equal((await last(page)).filters.sepia, 80);
  await setNumber(page, 'blur', 6);
  f = (await last(page)).filters;
  assert.equal(f.blur, 6);
  assert.equal(await page.locator('[data-testid="page"] feGaussianBlur').count(), 1);
  await context.close();
});

test('[IMG-08] rounded corners and circle crop', async () => {
  const { page, context, img } = await withImage();
  await setNumber(page, 'image-radius', 30);
  assert.equal((await last(page)).radius, 30);
  await page.selectOption('[data-testid="image-mask"]', 'circle');
  assert.equal((await last(page)).mask, 'circle');
  assert.equal(await page.locator('[data-testid="page"] clipPath path').count(), 1);
  assert.ok(img);
  await context.close();
});

test('[IMG-09] replace an image and keep its place and size', async () => {
  const { page, context, img } = await withImage();
  const chooser = page.waitForEvent('filechooser');
  await page.click('[data-testid="replace-image"]');
  await (await chooser).setFiles(await makePng(page, { w: 300, h: 600, color: '#ff006e', name: 'tall.png' }));
  await page.waitForFunction((a) => window.paperwall.editor.single?.assetId !== a, img.assetId);
  const e = await last(page);
  assert.deepEqual([e.x, e.y, e.w, e.h], [img.x, img.y, img.w, img.h]);
  assert.ok(e.crop.h < 1, 'cropped to fit the frame without stretching');
  await context.close();
});

test('[IMG-10] [PAGE-07] use an image as the page background', async () => {
  const { page, context } = await withImage();
  await page.click('[data-testid="image-to-bg"]');
  const doc = await state(page);
  assert.equal(doc.pages[0].background.type, 'image');
  assert.equal(doc.pages[0].elements.length, 0);
  assert.equal(await page.locator('[data-testid="page"] svg > image').count(), 1);
  await context.close();
});

test('[IMG-12] drop shadow on images and shapes', async () => {
  const { page, context, img } = await withImage();
  await page.click('[data-testid="shadow-toggle"]');
  assert.ok((await last(page)).shadow);
  assert.match(await dom(page, img.id).getAttribute('filter'), /^url\(#/);
  const s = await addShape(page, 'Circle');
  await page.click('[data-testid="shadow-toggle"]');
  assert.ok((await last(page)).shadow);
  assert.equal(await page.locator('[data-testid="page"] feDropShadow').count(), 2);
  assert.ok(s);
  await context.close();
});

// ---------- graphics ----------

test('[ELM-01] [ELM-02] [ELM-07] icons, searchable, in any color', async () => {
  const { page, context } = await newDesign('square');
  await openTab(page, 'graphics');
  const [, icons] = (await page.getAttribute('[data-testid="insert-search"]', 'placeholder')).match(/Search ([\d,]+) icons/);
  assert.ok(+icons.replace(/,/g, '') >= 1500, `${icons} icons`);
  assert.equal(await page.locator('[data-testid="icon-grid"] .thumb').count(), 120, 'first 120 shown');
  await page.click('[data-testid="icons-more"]');
  assert.equal(await page.locator('[data-testid="icon-grid"] .thumb').count(), 360);
  await page.fill('[data-testid="insert-search"]', 'birthday');
  assert.ok(await page.locator('[data-testid="icon-cake"]').isVisible());
  assert.equal(await page.locator('[data-testid="icon-phone"]').count(), 0);
  await page.click('[data-testid="icon-cake"]');
  const icon = await last(page);
  assert.equal(icon.type, 'icon');
  await pickColor(page, 'icon-color', '#ff006e');
  assert.equal((await last(page)).color, '#ff006e');
  assert.equal(await dom(page, icon.id).locator('g[stroke]').getAttribute('stroke'), '#ff006e');
  await context.close();
});

test('[ELM-03] [ELM-08] stickers', async () => {
  const { page, context } = await newDesign('square');
  await openTab(page, 'graphics');
  assert.ok((await page.locator('[data-testid="sticker-grid"] .thumb').count()) >= 150);
  await page.click('[data-testid="sticker-confetti"]');
  assert.equal((await last(page)).type, 'sticker');
  await context.close();
});

test('[ELM-04] QR code generator', async () => {
  const { page, context } = await newDesign('square');
  await openTab(page, 'qr');
  await page.fill('[data-testid="qr-input"]', 'https://example.org/menu');
  await page.click('[data-testid="qr-add"]');
  const qr = await last(page);
  assert.equal(qr.type, 'qr');
  assert.equal(qr.data, 'https://example.org/menu');
  assert.ok((await dom(page, qr.id).locator('path').getAttribute('d')).length > 200);
  // Editing the link redraws the code.
  const before = await dom(page, qr.id).locator('path').getAttribute('d');
  await page.fill('[data-testid="qr-data"]', 'https://example.org/other');
  await page.waitForFunction((d) => document.querySelector('[data-testid="page"] [data-type="qr"] path').getAttribute('d') !== d, before);
  await context.close();
});

// ---------- color ----------

test('[CLR-02] [CLR-04] colors already in the design and ready-made palettes', async () => {
  const { page, context } = await newDesign('square');
  await addShape(page, 'Square');
  await pickColor(page, 'fill-color', '#123456');
  await addShape(page, 'Circle');
  await page.click('[data-testid="fill-color"]');
  const used = page.locator('.swatch-group', { hasText: 'In this design' }).locator('.swatch[title="#123456"]');
  assert.equal(await used.count(), 1);
  assert.equal(await used.evaluate((el) => getComputedStyle(el).backgroundColor), 'rgb(18, 52, 86)', 'swatches show their color');
  await used.click();
  assert.equal((await last(page)).fill, '#123456');
  const palettes = await page.locator('.color-pop .swatch-group').count();
  assert.ok(palettes >= 8);
  await page.locator('.swatch-group', { hasText: 'Lagoon' }).locator('.swatch').first().click();
  assert.equal((await last(page)).fill, '#0a9396');
  await context.close();
});

test('[CLR-03] pick a color from anywhere on screen (browser eyedropper)', async () => {
  const { page, context } = await newDesign('square');
  await page.evaluate(() => {
    window.EyeDropper = class {
      open() {
        return Promise.resolve({ sRGBHex: '#abcdef' });
      }
    };
  });
  await addShape(page, 'Square');
  await page.click('[data-testid="fill-color"]');
  await page.click('.color-pop [aria-label="Pick a color from the screen"]');
  await page.waitForFunction(() => window.paperwall.editor.single.fill === '#abcdef');
  await context.close();
});

// ---------- brand kit ----------

test('[BRD-01] [BRD-02] [BRD-03] brand kit: colors, fonts, apply in one click', async () => {
  const { page, context } = await newDesign('square');
  await openTab(page, 'text');
  await page.click('[data-testid="add-heading"]');
  await page.click('[data-testid="add-body"]');
  await addShape(page, 'Square');
  await pickColor(page, 'fill-color', '#336699');
  await openTab(page, 'brand');
  await page.click('[data-testid="brand-add-color"]');
  await page.waitForSelector('[data-testid="brand-colors"] .swatch-btn');
  await page.click('[data-testid="brand-colors"] .swatch-btn');
  await page.fill('[data-testid="hex-input"]', '#ee9b00');
  await page.press('[data-testid="hex-input"]', 'Enter');
  await page.keyboard.press('Escape');
  await page.selectOption('[data-testid="brand-heading-font"]', 'Bebas Neue');
  await page.selectOption('[data-testid="brand-body-font"]', 'Lora');
  await page.click('[data-testid="brand-apply"]');
  // Applying waits for the brand fonts to load first.
  await page.waitForFunction(() => window.paperwall.editor.pageData.elements[0].font === 'Bebas Neue');
  const els = await elements(page);
  assert.equal(els[0].font, 'Bebas Neue');
  assert.equal(els[1].font, 'Lora');
  assert.ok(els.some((e) => e.fill === '#ee9b00' || e.color === '#ee9b00'));
  // The kit is remembered and shows in every color picker, in other designs too.
  await page.click('[data-testid="home-link"]');
  await page.click('[data-testid="preset-square"]');
  await page.waitForFunction(() => window.paperwall?.editor);
  await addShape(page, 'Circle');
  await page.click('[data-testid="fill-color"]');
  assert.equal(await page.locator('.swatch-group', { hasText: 'Brand kit' }).locator('.swatch[title="#ee9b00"]').count(), 1);
  await page.keyboard.press('Escape');
  await openTab(page, 'brand');
  assert.equal(await page.inputValue('[data-testid="brand-heading-font"]'), 'Bebas Neue');
  await context.close();
});

test('nothing else is selected after undoing an image insert', async () => {
  const { page, context } = await withImage();
  await page.keyboard.press(`${mod}+z`);
  assert.equal((await elements(page)).length, 0);
  await context.close();
});

test('no panel ever shows stray "null" or "undefined" text', async () => {
  const { page, context } = await newDesign('square');
  const check = async (what) => {
    const text = await page.innerText('body');
    const at = text.search(/\bnull\b|\bundefined\b|NaN/);
    assert.ok(at < 0, `${what}: ${JSON.stringify(text.slice(Math.max(0, at - 40), at + 30))}`);
  };
  await check('page panel');
  await addShape(page, 'Star');
  await check('shape');
  await openTab(page, 'shapes');
  await page.click('[data-testid="line-Arrow line"]');
  await check('line');
  await openTab(page, 'graphics');
  await page.click('[data-testid="icon-heart"]');
  await check('icon');
  await page.click('[data-testid="sticker-burst"]');
  await check('sticker');
  await openTab(page, 'qr');
  await page.fill('[data-testid="qr-input"]', 'hello');
  await page.click('[data-testid="qr-add"]');
  await check('qr');
  await openTab(page, 'charts');
  await page.click('[data-testid="chart-donut"]');
  await check('chart');
  await page.click('[data-testid="table-Schedule"]');
  await check('table');
  await uploadImages(page, [await makePng(page)]);
  await check('image');
  await page.click('[data-testid="crop-btn"]');
  await check('cropping');
  await page.keyboard.press(`${mod}+a`);
  await check('many selected');
  await page.click('[data-testid="act-group"]');
  await check('group');
  await page.click('[data-testid="tab-layers"]');
  await check('layers');
  await page.click('[data-testid="tab-edit"]').catch(() => {});
  await openTab(page, 'shapes');
  await page.click('[data-testid="frame-Circle frame"]');
  await check('empty frame');
  await page.click('[data-testid="connector-elbow"]');
  await check('connector');
  await page.click('[data-testid="view"]');
  await check('view menu');
  await page.keyboard.press('Escape');
  for (const tab of ['templates', 'text', 'uploads', 'brand', 'draw']) {
    await openTab(page, tab);
    await check(tab);
  }
  await context.close();
});

test('[ELM-05] charts from your numbers', async () => {
  const { page, context } = await newDesign('slides');
  await openTab(page, 'charts');
  await page.click('[data-testid="chart-bar"]');
  const chart = await last(page);
  assert.equal(chart.type, 'chart');
  await page.fill('[data-testid="chart-data"]', 'North, 40\nSouth, 25\nEast, 60\nWest, 10');
  await page.waitForFunction(() => window.paperwall.editor.single.data.length === 4);
  assert.deepEqual((await last(page)).data.map((d) => d.value), [40, 25, 60, 10]);
  assert.equal(await dom(page, chart.id).locator('rect').count(), 4, 'one bar per value');
  assert.ok((await dom(page, chart.id).locator('text').allTextContents()).includes('East'));
  await page.click('[data-testid="chart-type"] [data-value="pie"]');
  assert.equal((await last(page)).chartType, 'pie');
  assert.equal(await dom(page, chart.id).locator('path').count(), 4, 'one slice per value');
  assert.ok((await dom(page, chart.id).locator('text').allTextContents()).some((t) => /East · 44%/.test(t)));
  await page.selectOption('[data-testid="chart-palette"]', 'Lagoon');
  assert.equal((await last(page)).colors[0], '#0a9396');
  await page.keyboard.press(`${mod}+z`);
  assert.notEqual((await last(page)).colors[0], '#0a9396');
  await context.close();
});

test('[ELM-06] tables', async () => {
  const { page, context } = await newDesign('slides');
  await openTab(page, 'charts');
  await page.click('[data-testid="table-Simple table"]');
  const table = await last(page);
  assert.equal(table.type, 'table');
  await page.fill('[data-testid="table-data"]', 'Name, Role, City\nAda, Engineer, London\nGrace, Admiral, Arlington\nLinus, Maintainer, Portland');
  await page.waitForFunction(() => window.paperwall.editor.single.rows.length === 4);
  const t = await last(page);
  assert.deepEqual(t.rows[2], ['Grace', 'Admiral', 'Arlington']);
  assert.ok(t.h > table.h, 'the table grew for the new row');
  const cells = await dom(page, table.id).locator('text').allTextContents();
  assert.equal(cells.length, 12);
  assert.ok(cells.includes('Portland'));
  await page.click('[data-testid="table-header"]');
  assert.equal((await last(page)).header, false);
  // It exports with its fonts like everything else.
  const svg = await page.evaluate(async () => (await window.paperwall.export.exportSvg(window.paperwall.editor.doc, 0)).text());
  assert.match(svg, /font-family:"Inter";font-weight:700/);
  await context.close();
});

test('[IMG-13] remove a plain background on your device', async () => {
  const { page, context, img } = await withImage();
  await page.click('[data-testid="remove-bg"]');
  await page.waitForFunction((a) => window.paperwall.editor.single?.assetId !== a, img.assetId);
  // Export with a transparent page: the blue surround is gone, the white center stays.
  const png = await page.evaluate(async () => {
    const { editor, export: ex } = window.paperwall;
    const doc = structuredClone(editor.doc);
    const el = doc.pages[0].elements[0];
    Object.assign(el, { x: 0, y: 0, w: doc.width, h: doc.width / 2 });
    const blob = await ex.exportImage(doc, 0, { transparent: true, scale: 0.5 });
    const bmp = await createImageBitmap(blob);
    const cv = document.createElement('canvas');
    cv.width = bmp.width;
    cv.height = bmp.height;
    const g = cv.getContext('2d');
    g.drawImage(bmp, 0, 0);
    const a = (x, y) => g.getImageData(x, y, 1, 1).data[3];
    return { corner: a(5, 5), center: a(cv.width / 2, cv.width / 4) };
  });
  assert.deepEqual(png, { corner: 0, center: 255 });
  await page.keyboard.press(`${mod}+z`);
  assert.equal((await last(page)).assetId, img.assetId, 'one undo brings the original back');
  await context.close();
});

// ---------- frames and grids ----------

/** Drag an upload from the Uploads panel onto a point of an element on the page. */
async function dragUploadOnto(page, id) {
  await openTab(page, 'uploads');
  const at = await elementCenter(page, id);
  const box = await page.locator('[data-testid="page"]').boundingBox();
  await page.dragAndDrop('[data-testid="upload-item"] >> nth=0', '[data-testid="page"]', { targetPosition: { x: at.x - box.x, y: at.y - box.y } });
}

test('[IMG-14] photo frames: drop a photo into a shape', async () => {
  const { page, context } = await newDesign('square');
  await openTab(page, 'shapes');
  assert.ok((await page.locator('[data-testid="frame-grid"] .thumb').count()) >= 8);
  assert.ok((await page.locator('[data-testid="frame-Heart frame"] svg path').count()) >= 1, 'tiles show their shape');
  await page.click('[data-testid="frame-Heart frame"]');
  let frame = await last(page);
  assert.equal(frame.type, 'image');
  assert.equal(frame.mask, 'heart');
  assert.equal(frame.assetId, null, 'starts empty');
  assert.ok(await page.locator('[data-testid="frame-add-photo"]').isVisible());
  // Double-click an empty frame to pick a photo for it.
  const chooser = page.waitForEvent('filechooser');
  const p = await elementCenter(page, frame.id);
  await page.mouse.dblclick(p.x, p.y);
  await (await chooser).setFiles(await makePng(page, { w: 900, h: 300 }));
  await page.waitForFunction((id) => window.paperwall.editor.pageData.elements.find((e) => e.id === id).assetId, frame.id);
  frame = (await elements(page)).find((e) => e.id === frame.id);
  assert.equal(frame.w, frame.h, 'the frame keeps its size');
  assert.ok(frame.crop.w < 0.5 && frame.crop.h === 1, 'the wide photo is cropped to fill the frame');
  assert.equal(await page.locator('[data-testid="page"] clipPath path').count(), 1);
  // The shape can change after the photo is in.
  await page.selectOption('[data-testid="image-mask"]', 'arch');
  assert.equal((await last(page)).mask, 'arch');
  // Dragging an upload onto another frame fills that frame.
  await openTab(page, 'shapes');
  await page.click('[data-testid="frame-Circle frame"]');
  const circle = await last(page);
  // A drop counts only inside the frame's shape: a circle's corners are outside it.
  const hits = await page.evaluate((c) => {
    const ed = window.paperwall.editor;
    return [ed.frameAt({ x: c.x + c.w / 2, y: c.y + c.h / 2 })?.id, ed.frameAt({ x: c.x + 2, y: c.y + 2 })?.id ?? null];
  }, circle);
  assert.deepEqual(hits, [circle.id, null]);
  await dragUploadOnto(page, circle.id);
  await page.waitForFunction((id) => window.paperwall.editor.pageData.elements.find((e) => e.id === id).assetId, circle.id);
  assert.equal((await elements(page)).filter((e) => e.type === 'image').length, 2, 'filled, not added');
  await context.close();
});

test('[IMG-15] photo grids for collages', async () => {
  const { page, context } = await newDesign('square');
  await openTab(page, 'shapes');
  assert.ok((await page.locator('[data-testid="photo-grid-list"] .thumb').count()) >= 10);
  await page.click('[data-testid="grid-four"]');
  const frames = (await elements(page)).filter((e) => e.type === 'image');
  assert.equal(frames.length, 4);
  assert.equal(await state(page, (ed) => ed.selection.length), 4, 'the new frames are selected');
  for (const a of frames) {
    assert.ok(a.x >= 0 && a.y >= 0 && a.x + a.w <= 1080 && a.y + a.h <= 1080, 'inside the page');
    for (const b of frames) if (a !== b) assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, 'no overlap');
  }
  await uploadImages(page, [await makePng(page, { w: 400, h: 400 })]);
  await dragUploadOnto(page, frames[2].id);
  await page.waitForFunction((id) => window.paperwall.editor.pageData.elements.find((e) => e.id === id).assetId, frames[2].id);
  // Grouped, the grid still takes photos frame by frame.
  const group = await page.evaluate((ids) => {
    const ed = window.paperwall.editor;
    ed.select(ids);
    ed.group();
    return ed.pageData.elements.find((e) => e.type === 'group');
  }, frames.map((f) => f.id));
  const before = (await elements(page)).length; // the upload itself was also added to the page
  const inner = group.children.find((c) => c.id === frames[1].id);
  const at = await screenPoint(page, group.x + inner.x + inner.w / 2, group.y + inner.y + inner.h / 2);
  await openTab(page, 'uploads');
  const box = await page.locator('[data-testid="page"]').boundingBox();
  await page.dragAndDrop('[data-testid="upload-item"] >> nth=0', '[data-testid="page"]', { targetPosition: { x: at.x - box.x, y: at.y - box.y } });
  await page.waitForFunction((id) => window.paperwall.editor.pageData.elements.find((e) => e.type === 'group').children.find((e) => e.id === id)?.assetId, frames[1].id);
  assert.equal((await elements(page)).length, before, 'filled, not added on top');
  await context.close();
});

// ---------- gradients, photo color, drawing ----------

test('[CLR-05] gradients with any number of colors, and ready-made gradients', async () => {
  const { page, context } = await newDesign('square');
  const s = await addShape(page, 'Square');
  await page.click('[data-testid="fill-type"] [data-value="gradient"]');
  assert.equal(await page.locator('[data-testid="fill-gradient"] [data-testid="grad-stop"]').count(), 2);
  await page.click('[data-testid="grad-add"]');
  let fill = (await last(page)).fill;
  assert.equal(fill.stops.length, 3);
  assert.equal(fill.stops[1].offset, 0.5, 'a new color goes in the middle');
  await page.locator('[data-testid="grad-pos-1"]').fill('30');
  fill = (await last(page)).fill;
  assert.equal(fill.stops[1].offset, 0.3);
  await page.click('[data-testid="grad-preset-Rainbow"]');
  fill = (await last(page)).fill;
  assert.equal(fill.stops.length, 4);
  assert.equal(await dom(page, s.id).locator('stop').count(), 0, 'stops live in defs');
  assert.equal(await page.locator('[data-testid="page"] linearGradient stop').count(), 4);
  await page.click('[data-testid="grad-remove-0"]');
  assert.equal((await last(page)).fill.stops.length, 3);
  await context.close();
});

test('[IMG-16] duotone, warmth, tint, hue and vignette', async () => {
  const { page, context } = await withImage();
  await page.click('[data-testid="duotone-Ocean"]');
  const f = (await last(page)).filters;
  assert.deepEqual(f.duotone, { dark: '#0b2a45', light: '#7fd1c7' });
  assert.ok((await page.locator('[data-testid="page"] filter feFuncR[type="table"]').count()) >= 1);
  await setNumber(page, 'warmth', 40);
  await setNumber(page, 'vignette', 60);
  const g = (await last(page)).filters;
  assert.equal(g.warmth, 40);
  assert.equal(g.vignette, 60);
  assert.ok(g.duotone, 'other adjustments stay');
  assert.equal(await page.locator('[data-testid="page"] radialGradient').count(), 1, 'vignette shade');
  await page.click('[data-testid="duotone-none"]');
  assert.equal((await last(page)).filters.duotone, null);
  await context.close();
});

test('[ELM-09] freehand drawing with a pen, marker or highlighter', async () => {
  const { page, context } = await newDesign('square');
  await openTab(page, 'draw');
  assert.equal(await state(page, (ed) => ed.drawTool?.tool), 'pen');
  const a = await screenPoint(page, 200, 300);
  const b = await screenPoint(page, 700, 500);
  await drag(page, a, b, { steps: 20 });
  let d = await last(page);
  assert.equal(d.type, 'draw');
  assert.ok(d.points.length >= 3, `${d.points.length} points`);
  assert.ok(Math.abs(d.x - 197) < 6 && Math.abs(d.x + d.w - 703) < 6, 'the box wraps the stroke');
  assert.equal(await page.locator(`[data-testid="page"] [data-id="${d.id}"] path`).count(), 1);
  await page.click('[data-testid="draw-tool-highlighter"]');
  await drag(page, await screenPoint(page, 200, 800), await screenPoint(page, 800, 800), { steps: 10 });
  d = await last(page);
  assert.equal(d.tool, 'highlighter');
  assert.equal(d.opacity, 0.4);
  assert.equal(d.strokeWidth, 36);
  assert.equal((await elements(page)).filter((e) => e.type === 'draw').length, 2);
  // Esc stops drawing; then a stroke can be selected and recolored like anything else.
  await page.keyboard.press('Escape');
  assert.equal(await state(page, (ed) => ed.drawTool), null);
  const first = (await elements(page))[0];
  await clickElement(page, first.id);
  await pickColor(page, 'draw-color', '#ff006e');
  assert.equal((await elements(page))[0].stroke, '#ff006e');
  await context.close();
});

test('[ELM-10] connector lines that stay attached to elements', async () => {
  const { page, context } = await newDesign('square');
  const a = await addShape(page, 'Square');
  await drag(page, await elementCenter(page, a.id), await screenPoint(page, 200, 200), { steps: 8 });
  const b = await addShape(page, 'Circle');
  await drag(page, await elementCenter(page, b.id), await screenPoint(page, 800, 800), { steps: 8 });
  await clickElement(page, a.id);
  await clickElement(page, b.id, ['Shift']);
  await page.click('[data-testid="connect"]');
  let c = (await elements(page)).find((e) => e.type === 'connector');
  assert.ok(c, 'a connector was added');
  assert.equal(c.start.id, a.id);
  assert.equal(c.end.id, b.id);
  assert.equal(c.route, 'elbow');
  const before = c.points.map(([fx, fy]) => [c.x + fx * c.w, c.y + fy * c.h]);
  // Move the circle: the connector follows.
  await drag(page, await elementCenter(page, b.id), await screenPoint(page, 800, 500), { steps: 8 });
  c = (await elements(page)).find((e) => e.type === 'connector');
  const after2 = c.points.map(([fx, fy]) => [c.x + fx * c.w, c.y + fy * c.h]);
  assert.notDeepEqual(after2[1], before[1], 'the end moved with the circle');
  assert.deepEqual(after2[0].map(Math.round), before[0].map(Math.round), 'the other end stayed');
  // Switch the route, then pull one end free and drop it on empty page.
  await page.evaluate((id) => window.paperwall.editor.select([id]), c.id);
  await page.click('[data-testid="connector-route"] [data-value="curved"]');
  assert.equal((await elements(page)).find((e) => e.type === 'connector').route, 'curved');
  const endHandle = await page.locator('[data-testid="connector-end-1"]').boundingBox();
  await drag(page, { x: endHandle.x + 7, y: endHandle.y + 7 }, await screenPoint(page, 900, 100), { steps: 8 });
  c = (await elements(page)).find((e) => e.type === 'connector');
  assert.equal(c.end.id, null, 'freed');
  // Adding one from the Shapes panel works too.
  await openTab(page, 'shapes');
  await page.click('[data-testid="connector-straight"]');
  assert.equal((await elements(page)).filter((e) => e.type === 'connector').length, 2);
  await context.close();
});
