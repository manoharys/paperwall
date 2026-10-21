// Pro downloads: the vector PDF, the print PDF and PowerPoint. The writers
// are in the model; the browser gives them what they can't make on their
// own: the font files, decoded pictures, and pictures of the elements that
// can't be drawn any other way (shadows, glows, filters, charts...).

import { renderPage } from '../model/render.js';
import { stillIsCurrent } from '../model/doc.js';
import { planVectorPdf, buildVectorPdf, rasterScale } from '../model/pdf-vector.js';
import { planPptx, buildPptx } from '../model/pptx.js';
import { jpegInfo } from '../model/jpeg.js';
import { deflate } from '../model/deflate.js';
import { bleedSize } from '../model/view.js';
import { measure, fontCssFor, designFontFiles, ensureDesignFonts, onPaper } from './fonts.js';
import { dataUrlToBytes, loadImage, canvasScale, toBlob, blobBytes } from './ui.js';

const MAX_PHOTO_SIDE = 4096;

/** Deflate (zlib) for PDF streams: the browser's own where it has one. */
async function flate(bytes) {
  if (typeof CompressionStream === 'function') {
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch {
      /* fall through to ours */
    }
  }
  return deflate(bytes);
}

/** A canvas's pixels as deflated RGB, plus deflated alpha when any of it is see-through. */
async function canvasPixels(canvas) {
  const { width, height } = canvas;
  const rgba = canvas.getContext('2d').getImageData(0, 0, width, height).data;
  const rgb = new Uint8Array(width * height * 3);
  const alpha = new Uint8Array(width * height);
  let clear = false;
  for (let i = 0, j = 0, k = 0; i < rgba.length; i += 4, j += 3, k++) {
    const a = rgba[i + 3];
    // Unpremultiplied already; fully clear pixels are left white (no dark fringes when scaled).
    rgb[j] = a ? rgba[i] : 255;
    rgb[j + 1] = a ? rgba[i + 1] : 255;
    rgb[j + 2] = a ? rgba[i + 2] : 255;
    alpha[k] = a;
    if (a < 255) clear = true;
  }
  return { width, height, data: await flate(rgb), alpha: clear ? await flate(alpha) : null };
}

async function canvasPng(canvas) {
  return blobBytes(await toBlob(canvas, 'image/png'));
}

/**
 * Draw a picture (a data: URL) into a canvas, never bigger than its own
 * size: no bigger than MAX_PHOTO_SIDE on a side, or, given `cover` (output
 * px), than it takes to cover that, within the canvas limits.
 */
async function decode(src, cover = null) {
  const img = await loadImage(src);
  if (img.decode) await img.decode().catch(() => null);
  const w = img.naturalWidth || img.width || 1;
  const h = img.naturalHeight || img.height || 1;
  const want = cover?.w > 0 && cover?.h > 0 ? Math.max(cover.w / w, cover.h / h) : MAX_PHOTO_SIDE / Math.max(w, h);
  const s = Math.min(1, want, canvasScale(w, h, 1));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * s));
  canvas.height = Math.max(1, Math.round(h * s));
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/**
 * Draw an SVG picture into a canvas big enough to cover `shown` (output px):
 * an SVG has no pixels of its own, and its own size is often tiny, or none
 * at all. Its shape is its own (or its viewBox's).
 */
async function decodeSvg(src, bytes, shown) {
  const img = await loadImage(src);
  if (img.decode) await img.decode().catch(() => null);
  let w = img.naturalWidth;
  let h = img.naturalHeight;
  if (!(w > 0 && h > 0)) {
    const vb = /viewBox\s*=\s*["']\s*[-+\d.e]+[\s,]+[-+\d.e]+[\s,]+([+\d.e]+)[\s,]+([+\d.e]+)/i.exec(new TextDecoder().decode(bytes));
    [w, h] = vb && +vb[1] > 0 && +vb[2] > 0 ? [+vb[1], +vb[2]] : [shown.w, shown.h];
  }
  const aspect = w / h;
  const cw = Math.max(shown.w, shown.h * aspect, 1);
  const ch = cw / aspect;
  const s = canvasScale(cw, ch, 1);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(cw * s));
  canvas.height = Math.max(1, Math.round(ch * s));
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/**
 * A picture to draw again (not as its file): SVGs at the size they're shown,
 * others at their own (up to MAX_PHOTO_SIDE; for print, as much of it as
 * 300 DPI needs where it's shown).
 */
function redraw({ url, bytes, mime, shown }, { print = false } = {}) {
  if (/^image\/svg\+xml\b/i.test(mime)) return decodeSvg(url, bytes, shown);
  return decode(url, print ? shown : null);
}

/**
 * Every picture the pages show, by the name writers know it by:
 * "asset:<id>:file" (a video's still is a picture of its own), or
 * "asset:<id>:poster" for a video's small poster; with its data: URL and the
 * largest size it's shown at (page px, w and h each). A background photo
 * covers the page and `bleed` px past each edge.
 */
function pictureTokens(doc, pages, bleed = 0) {
  const out = new Map(); // token -> { url, w, h }
  const add = (token, url, w, h) => {
    const was = out.get(token);
    out.set(token, { url, w: Math.max(w || 0, was?.w || 0), h: Math.max(h || 0, was?.h || 0) });
  };
  // (Its whole picture, cropped to the frame.)
  const shown = (el) => [el.w / (el.crop?.w || 1), el.h / (el.crop?.h || 1)];
  const visit = (els) => {
    for (const el of els) {
      if (el.hidden) continue;
      if (el.type === 'group') visit(el.children);
      const a = doc.assets[el.assetId];
      if (el.type === 'image' && a?.dataUrl) add(`asset:${el.assetId}:file`, a.dataUrl, ...shown(el));
      if (el.type === 'video' && stillIsCurrent(doc, el) && doc.assets[el.still].dataUrl) add(`asset:${el.still}:file`, doc.assets[el.still].dataUrl, ...shown(el));
      else if (el.type === 'video' && a?.poster) add(`asset:${el.assetId}:poster`, a.poster, ...shown(el));
    }
  };
  for (const i of pages) {
    const p = doc.pages[i];
    visit(p.elements);
    const bg = doc.assets[p.background?.type === 'image' ? p.background.assetId : null];
    if (bg?.dataUrl) add(`asset:${p.background.assetId}:file`, bg.dataUrl, doc.width + bleed * 2, doc.height + bleed * 2);
  }
  return out;
}

/**
 * The pages' pictures, each made ready for a writer by encode({ bytes, mime,
 * url, jpeg, shown }) (jpeg: the file's details when it's a JPEG that can go
 * in as it is; shown: the largest size it's shown at, in output px, at
 * `scale` per page px; a background's with `bleed` page px past each edge).
 * One that can't be read is left out: the element then comes as a picture of
 * itself.
 */
async function readPictures(doc, pages, check, { scale, bleed = 0 }, encode) {
  const out = new Map();
  for (const [token, { url, w, h }] of pictureTokens(doc, pages, bleed)) {
    check();
    try {
      const { bytes, mime } = dataUrlToBytes(url);
      const info = mime === 'image/jpeg' ? jpegInfo(bytes) : null;
      out.set(token, await encode({ bytes, mime, url, jpeg: info && info.orientation === 1 ? info : null, shown: { w: w * scale, h: h * scale } }));
    } catch {
      /* unreadable: left out */
    }
  }
  return out;
}

/** For the PDF: JPEGs as they are, anything else decoded and deflated. */
async function pdfPicture(p, opts) {
  const { bytes, jpeg } = p;
  if (jpeg) return { kind: 'jpeg', bytes, width: jpeg.width, height: jpeg.height, components: jpeg.components, inverted: jpeg.inverted };
  return { kind: 'flate', ...(await canvasPixels(await redraw(p, opts))) };
}

/** For PowerPoint: JPEG and PNG files as they are, others as PNG. */
async function pptxPicture(p) {
  const { bytes, mime, jpeg } = p;
  if (jpeg) return { bytes, ext: 'jpeg', width: jpeg.width, height: jpeg.height };
  if (mime === 'image/png' && bytes.length > 24) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { bytes, ext: 'png', width: dv.getUint32(16), height: dv.getUint32(20) };
  }
  const canvas = await redraw(p);
  return { bytes: await canvasPng(canvas), ext: 'png', width: canvas.width, height: canvas.height };
}

/** Ids to leave out so only `key` (an element, or '@bg' for the background) is drawn. */
function allBut(page, key) {
  const skip = new Set();
  const contains = (el) => el.id === key || (el.type === 'group' && el.children.some(contains));
  const visit = (els) => {
    for (const el of els) {
      if (el.id === key) continue;
      if (el.type === 'group' && contains(el)) visit(el.children);
      else skip.add(el.id);
    }
  };
  visit(page.elements);
  return skip;
}

/**
 * A part of a page (one element, or the background) drawn by the browser
 * into a canvas. The background runs `bleed` px past the page's edges, as
 * the print PDF's does.
 */
async function drawPart(doc, want, scale, fontCss, bleed = 0) {
  const { box } = want;
  const s = canvasScale(box.w, box.h, scale);
  const svg = renderPage(doc, want.page, {
    measure,
    fontCss,
    transparent: want.key !== '@bg',
    bleed,
    skip: allBut(doc.pages[want.page], want.key),
    view: box,
    scale: s,
    idPrefix: `part${want.page}`,
  });
  const img = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
  if (img.decode) await img.decode().catch(() => null);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(box.w * s));
  canvas.height = Math.max(1, Math.round(box.h * s));
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function stopper(signal) {
  return () => {
    if (signal?.aborted) throw new DOMException('Stopped', 'AbortError');
  };
}

/**
 * A vector PDF of these pages; with { print: true } a print PDF (bleed, crop
 * marks, pictures at 300 DPI). A document comes as its sheets. onProgress(0..1)
 * as it goes.
 */
export async function exportVectorPdf(doc0, pages0, { print = false, signal, onProgress } = {}) {
  const check = stopper(signal);
  // (Every design's fonts, document or not: its text is measured to be written.)
  await ensureDesignFonts(doc0);
  const [doc, pages] = await onPaper(doc0, pages0);
  const fonts = await designFontFiles(doc);
  check();
  // (For print, the background runs into the bleed: its photo and its picture cover that too.)
  const bleed = print ? bleedSize(doc) : 0;
  const images = await readPictures(doc, pages, check, { scale: rasterScale(doc, { print }), bleed }, (p) => pdfPicture(p, { print }));
  const env = { fonts, images, measure, print, title: doc.name };
  const wants = planVectorPdf(doc, pages, env);
  const rasters = new Map();
  if (wants.length) {
    const fontCss = await fontCssFor(doc);
    const scale = rasterScale(doc, { print });
    for (const [n, w] of wants.entries()) {
      check();
      onProgress?.(n / (wants.length + 1));
      rasters.set(`${w.page}:${w.key}`, await canvasPixels(await drawPart(doc, w, scale, fontCss, bleed)));
    }
  }
  check();
  onProgress?.(1);
  return new Blob([buildVectorPdf(doc, pages, { ...env, rasters })], { type: 'application/pdf' });
}

/** A PowerPoint file of these pages, one slide each (a document's sheets, one slide each). */
export async function exportPptx(doc0, pages0, { signal, onProgress } = {}) {
  const check = stopper(signal);
  await ensureDesignFonts(doc0);
  const [doc, pages] = await onPaper(doc0, pages0);
  const media = await readPictures(doc, pages, check, { scale: rasterScale(doc) }, pptxPicture);
  // (A photo whose picture couldn't be read comes as a picture of itself.)
  const wants = planPptx(doc, pages, media);
  const pictures = new Map();
  if (wants.length) {
    const fontCss = await fontCssFor(doc);
    const scale = rasterScale(doc);
    for (const [n, w] of wants.entries()) {
      check();
      onProgress?.(n / (wants.length + 1));
      pictures.set(`${w.page}:${w.key}`, await canvasPng(await drawPart(doc, w, scale, fontCss)));
    }
  }
  check();
  onProgress?.(1);
  return new Blob([buildPptx(doc, pages, { media, pictures, title: doc.name })], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
}
