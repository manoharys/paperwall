// Pro downloads: the vector PDF, the print PDF and PowerPoint. The writers
// are in the model; the browser gives them what they can't make on their
// own: the font files, decoded pictures, and pictures of the elements that
// can't be drawn any other way (shadows, glows, filters, charts...).

import { renderPage } from '../model/render.js';
import { onPaper } from '../model/flow.js';
import { stillIsCurrent } from '../model/doc.js';
import { planVectorPdf, buildVectorPdf, rasterScale } from '../model/pdf-vector.js';
import { planPptx, buildPptx } from '../model/pptx.js';
import { jpegInfo } from '../model/jpeg.js';
import { deflate } from '../model/deflate.js';
import { measure, fontCssFor, designFontFiles, ensureDesignFonts } from './fonts.js';
import { dataUrlToBytes, loadImage } from './ui.js';

// Pictures are kept to a size every browser's canvas can hold.
const MAX_SIDE = 12000;
const MAX_PIXELS = 60e6;
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

function canvasPng(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? b.arrayBuffer().then((a) => resolve(new Uint8Array(a)), reject) : reject(new Error('Export failed: the image is too large for this browser'))), 'image/png'));
}

/** Draw a picture (a data: URL) into a canvas, no bigger than `max` on a side. */
async function decode(src, max = MAX_PHOTO_SIDE) {
  const img = await loadImage(src);
  if (img.decode) await img.decode().catch(() => null);
  const w = img.naturalWidth || img.width || 1;
  const h = img.naturalHeight || img.height || 1;
  const s = Math.min(1, max / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * s));
  canvas.height = Math.max(1, Math.round(h * s));
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/**
 * Every picture the pages show, by the name writers know it by:
 * "asset:<id>:file" (a video's still is a picture of its own), or
 * "asset:<id>:poster" for a video's small poster.
 */
function pictureTokens(doc, pages) {
  const out = new Map(); // token -> data: URL
  const visit = (els) => {
    for (const el of els) {
      if (el.hidden) continue;
      if (el.type === 'group') visit(el.children);
      const a = doc.assets[el.assetId];
      if (el.type === 'image' && a?.dataUrl) out.set(`asset:${el.assetId}:file`, a.dataUrl);
      if (el.type === 'video' && stillIsCurrent(doc, el) && doc.assets[el.still].dataUrl) out.set(`asset:${el.still}:file`, doc.assets[el.still].dataUrl);
      else if (el.type === 'video' && a?.poster) out.set(`asset:${el.assetId}:poster`, a.poster);
    }
  };
  for (const i of pages) {
    const p = doc.pages[i];
    visit(p.elements);
    const bg = doc.assets[p.background?.type === 'image' ? p.background.assetId : null];
    if (bg?.dataUrl) out.set(`asset:${p.background.assetId}:file`, bg.dataUrl);
  }
  return out;
}

/** Pictures for the PDF: JPEGs as they are, anything else decoded and deflated. */
async function pdfPictures(doc, pages, check) {
  const out = new Map();
  for (const [token, url] of pictureTokens(doc, pages)) {
    check();
    try {
      const { bytes, mime } = dataUrlToBytes(url);
      const info = mime === 'image/jpeg' ? jpegInfo(bytes) : null;
      if (info && info.orientation === 1) {
        out.set(token, { kind: 'jpeg', bytes, width: info.width, height: info.height, components: info.components, inverted: info.inverted });
        continue;
      }
      out.set(token, { kind: 'flate', ...(await canvasPixels(await decode(url))) });
    } catch {
      /* unreadable: the element comes as a picture of itself, or not at all */
    }
  }
  return out;
}

/** Pictures for PowerPoint: JPEG and PNG files as they are, others as PNG. */
async function pptxPictures(doc, pages, check) {
  const out = new Map();
  for (const [token, url] of pictureTokens(doc, pages)) {
    check();
    try {
      const { bytes, mime } = dataUrlToBytes(url);
      const info = mime === 'image/jpeg' ? jpegInfo(bytes) : null;
      if (info && info.orientation === 1) {
        out.set(token, { bytes, ext: 'jpeg', width: info.width, height: info.height });
        continue;
      }
      if (mime === 'image/png' && bytes.length > 24) {
        const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        out.set(token, { bytes, ext: 'png', width: dv.getUint32(16), height: dv.getUint32(20) });
        continue;
      }
      const canvas = await decode(url);
      out.set(token, { bytes: await canvasPng(canvas), ext: 'png', width: canvas.width, height: canvas.height });
    } catch {
      /* unreadable: left out, as a missing picture is */
    }
  }
  return out;
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

/** A part of a page (one element, or the background) drawn by the browser into a canvas. */
async function drawPart(doc, want, scale, fontCss) {
  const { box } = want;
  const s = Math.max(0.05, Math.min(scale, MAX_SIDE / Math.max(box.w, box.h), Math.sqrt(MAX_PIXELS / (box.w * box.h))));
  const svg = renderPage(doc, want.page, {
    measure,
    fontCss,
    transparent: want.key !== '@bg',
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
  await ensureDesignFonts(doc0);
  // (Split into sheets once its fonts are in: they decide where lines break.)
  const [doc, pages] = onPaper(doc0, pages0, measure);
  const fonts = await designFontFiles(doc);
  check();
  const images = await pdfPictures(doc, pages, check);
  const env = { fonts, images, measure, print, title: doc.name };
  const wants = planVectorPdf(doc, pages, env);
  const rasters = new Map();
  if (wants.length) {
    const fontCss = await fontCssFor(doc);
    const scale = rasterScale(doc, { print });
    for (const [n, w] of wants.entries()) {
      check();
      onProgress?.(n / (wants.length + 1));
      rasters.set(`${w.page}:${w.key}`, await canvasPixels(await drawPart(doc, w, scale, fontCss)));
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
  const [doc, pages] = onPaper(doc0, pages0, measure);
  const media = await pptxPictures(doc, pages, check);
  const wants = planPptx(doc, pages);
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
