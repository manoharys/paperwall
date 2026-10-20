// Downloads: PNG, JPG, SVG, PDF, a zip of pages, printing, copying to the
// clipboard, and Paperwall project files. All of it happens on your device.

import { renderPage, textRuns } from '../model/render.js';
import { buildPdf } from '../model/pdf.js';
import { buildZip } from '../model/zip.js';
import { validateDesign, clone, visiblePages, printDpi, pageLabel } from '../model/doc.js';
import { measure, fontCssFor, registerDesignFonts } from './fonts.js';
import { h, icon, dialog, download, safeFilename, toast, readFileAsText, dataUrlToBytes, loadImage } from './ui.js';
import { section, segmented, slider, toggle } from './widgets.js';
import { exportGif, exportVideo, canMakeVideo } from './motion-export.js';
import { designMoves, timeline } from '../model/motion.js';

const MAX_SIDE = 16000;
const MAX_PIXELS = 120e6;

export function maxScale(doc, wanted) {
  const side = MAX_SIDE / Math.max(doc.width, doc.height);
  const area = Math.sqrt(MAX_PIXELS / (doc.width * doc.height));
  return Math.max(0.05, Math.min(wanted, side, area));
}

/** The page as a standalone SVG with its fonts and images inside. */
export async function pageSvg(doc, pageIndex, { transparent = false, scale = 1 } = {}) {
  const fontCss = await fontCssFor(doc);
  return renderPage(doc, pageIndex, { measure, fontCss, transparent, scale, idPrefix: `ex${pageIndex}` });
}

/** Draw a page into a canvas at the given scale. */
export async function rasterize(doc, pageIndex, { scale = 1, transparent = false, background = null } = {}) {
  const s = maxScale(doc, scale);
  const svg = await pageSvg(doc, pageIndex, { transparent, scale: s });
  const img = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
  if (img.decode) await img.decode().catch(() => null);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(doc.width * s);
  canvas.height = Math.round(doc.height * s);
  const ctx = canvas.getContext('2d');
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function toBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Export failed: the image is too large for this browser'))), type, quality));
}

async function blobBytes(blob) {
  return new Uint8Array(await blob.arrayBuffer());
}

export async function exportImage(doc, pageIndex, { format = 'png', scale = 1, transparent = false, quality = 0.92 } = {}) {
  const jpg = format === 'jpg';
  const canvas = await rasterize(doc, pageIndex, { scale, transparent: transparent && !jpg, background: jpg ? '#ffffff' : null });
  return toBlob(canvas, jpg ? 'image/jpeg' : 'image/png', jpg ? quality : undefined);
}

export async function exportSvg(doc, pageIndex, { transparent = false } = {}) {
  return new Blob([await pageSvg(doc, pageIndex, { transparent })], { type: 'image/svg+xml' });
}

/** Print designs (mm/in sizes) are 300 DPI; screen designs are 96 DPI. */
export function pagePoints(doc) {
  const dpi = printDpi(doc);
  return { ptWidth: (doc.width / dpi) * 72, ptHeight: (doc.height / dpi) * 72, renderScale: dpi === 300 ? 1 : 2 };
}

export async function exportPdf(doc, pages, { quality = 0.92 } = {}) {
  const pts = pagePoints(doc);
  const out = [];
  for (const i of pages) {
    const canvas = await rasterize(doc, i, { scale: pts.renderScale, background: '#ffffff' });
    const jpeg = await blobBytes(await toBlob(canvas, 'image/jpeg', quality));
    const k = pts.ptWidth / doc.width;
    const text = textRuns(doc, i, measure).map((r) => ({ ...r, x: r.x * k, y: r.y * k, size: r.size * k, width: r.width * k }));
    out.push({ jpeg, pxWidth: canvas.width, pxHeight: canvas.height, ptWidth: pts.ptWidth, ptHeight: pts.ptHeight, text });
  }
  return new Blob([buildPdf(out, { title: doc.name })], { type: 'application/pdf' });
}

/** A small preview for the home screen. */
export async function thumbnail(doc) {
  const scale = 360 / Math.max(doc.width, doc.height);
  const canvas = await rasterize(doc, 0, { scale, background: '#ffffff' });
  return canvas.toDataURL('image/jpeg', 0.82);
}

export async function copyToClipboard(doc, pageIndex) {
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error("This browser can't copy images. Download instead.");
  const blob = await exportImage(doc, pageIndex, { format: 'png', scale: 1 });
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}

export async function printDesign(doc, pages) {
  const imgs = [];
  for (const i of pages) imgs.push((await rasterize(doc, i, { scale: maxScale(doc, 2), background: '#ffffff' })).toDataURL('image/png'));
  const root = h('div', { id: 'print-root' }, imgs.map((src) => h('img', { src, alt: '' })));
  const pts = pagePoints(doc);
  const style = h('style', null, `@page{size:${pts.ptWidth}pt ${pts.ptHeight}pt;margin:0}`);
  document.body.append(root, style);
  document.body.classList.add('printing');
  const done = () => {
    document.body.classList.remove('printing');
    root.remove();
    style.remove();
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  await Promise.all([...root.querySelectorAll('img')].map((im) => (im.decode ? im.decode().catch(() => null) : null)));
  window.print();
  setTimeout(done, 1000);
}

// ---------- project files ----------

export function projectBlob(doc) {
  return new Blob([JSON.stringify(doc)], { type: 'application/json' });
}

export function saveProjectFile(doc) {
  download(projectBlob(doc), `${safeFilename(doc.name)}.paperwall.json`);
}

export async function readProjectFile(file) {
  let doc;
  try {
    doc = JSON.parse(await readFileAsText(file));
  } catch {
    throw new Error(`${file.name} isn't a Paperwall design file`);
  }
  validateDesign(doc);
  await registerDesignFonts(doc);
  return doc;
}

// ---------- the download dialog ----------

const MOVING = new Set(['gif', 'mp4', 'webm']);

/** How long the animation will be, and a nudge when nothing moves yet. */
function motionNote(doc, pages) {
  const { total } = timeline(doc, pages);
  const length = `${Math.round(total * 10) / 10} seconds`;
  return designMoves(doc, pages) ? `${length} long. Set each page's time and transition with nothing selected.` : `${length} long. Nothing moves yet: pick an animation in the Animate panel.`;
}

/** The design's soundtrack, decoded, or null. (Soundtracks come with video elements and audio.) */
export async function soundtrackBuffer(doc) {
  const a = doc.audio && doc.assets[doc.audio.assetId];
  if (!a) return null;
  const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Ctx) return null;
  const ctx = new Ctx();
  try {
    return await ctx.decodeAudioData(dataUrlToBytes(a.dataUrl).buffer);
  } finally {
    ctx.close?.();
  }
}

export function exportDialog(editor) {
  const doc = editor.doc;
  // Hidden pages start unticked; tick one to download it anyway. If every
  // page is hidden (or there's just one), start with all of them.
  const visible = visiblePages(doc);
  const state = { format: 'png', scale: 1, transparent: false, quality: 92, pages: new Set(visible.length && doc.pages.length > 1 ? visible : doc.pages.map((_, i) => i)) };
  const body = h('div', { class: 'export' });
  const draw = () => {
    body.replaceChildren(...[
      section('File type', segmented({ label: 'File type', value: state.format, testid: 'export-format', onChange: (v) => {
        state.format = v;
        draw();
      }, options: [
        { value: 'png', label: 'PNG: best for sharing', text: 'PNG' },
        { value: 'jpg', label: 'JPG: smaller files', text: 'JPG' },
        { value: 'pdf', label: 'PDF: for printing', text: 'PDF' },
        { value: 'svg', label: 'SVG: vector, any size', text: 'SVG' },
        { value: 'gif', label: 'GIF: a short animation', text: 'GIF' },
        { value: 'mp4', label: 'MP4: video', text: 'MP4' },
        { value: 'webm', label: 'WebM: video', text: 'WebM' },
      ] }),
      h('p', { class: 'hint' }, {
        png: 'Sharp images for social media and the web.',
        jpg: 'Smaller files, no transparency.',
        pdf: 'One file with every page you pick. Great for printing.',
        svg: 'Vector file that stays sharp at any size. Fonts are included.',
        gif: 'Plays your animations and pages on a loop. Kept small to share.',
        mp4: 'A video of your animations and pages, with your soundtrack. Plays everywhere.',
        webm: 'A video of your animations and pages, with your soundtrack. Smaller; plays in browsers.',
      }[state.format]),
      MOVING.has(state.format) ? h('p', { class: 'hint', 'data-testid': 'export-length' }, motionNote(doc, [...state.pages].sort((a, b) => a - b))) : null,
      (state.format === 'mp4' || state.format === 'webm') && !canMakeVideo() ? h('p', { class: 'hint warn' }, "This browser can't make videos. Try a recent Chrome, Edge, Safari or Firefox, or download a GIF.") : null),
      state.format === 'png' || state.format === 'jpg' ? section('Size', segmented({ label: 'Size', value: state.scale, testid: 'export-scale', onChange: (v) => {
        state.scale = v;
        draw();
      }, options: [1, 2, 3].map((s) => ({ value: s, label: `${s}x`, text: `${s}x · ${Math.round(doc.width * maxScale(doc, s))} × ${Math.round(doc.height * maxScale(doc, s))}` })) })) : null,
      state.format === 'png' || state.format === 'svg' ? toggle({ label: 'Transparent background', checked: state.transparent, testid: 'export-transparent', onChange: (v) => (state.transparent = v) }) : null,
      state.format === 'jpg' ? slider({ label: 'Quality', value: state.quality, min: 40, max: 100, unit: '%', testid: 'export-quality', onChange: (v) => (state.quality = v) }) : null,
      doc.pages.length > 1 ? section('Pages', h('div', { class: 'page-picks', 'data-testid': 'export-pages' }, doc.pages.map((_, i) => {
        const cb = h('input', { type: 'checkbox', 'data-testid': `export-page-${i + 1}` });
        cb.checked = state.pages.has(i);
        cb.addEventListener('change', () => (cb.checked ? state.pages.add(i) : state.pages.delete(i)));
        const p = doc.pages[i];
        return h('label', { class: 'toggle' }, cb, h('span', null, pageLabel(p, i)));
      }))) : null,
      h('div', { class: 'export-actions' },
        h('button', { type: 'button', class: 'btn primary big', 'data-testid': 'export-download', onClick: () => run() }, icon('download'), 'Download'),
        h('button', { type: 'button', class: 'btn', 'data-testid': 'export-copy', onClick: async () => {
          try {
            await copyToClipboard(doc, editor.page);
            toast('Copied. Paste it anywhere.');
          } catch (e) {
            toast(e.message, 'error');
          }
        } }, icon('copy'), 'Copy image'),
        h('button', { type: 'button', class: 'btn', 'data-testid': 'export-print', onClick: async () => {
          d.close();
          await printDesign(doc, [...state.pages].sort((a, b) => a - b));
        } }, 'Print')),
      h('p', { class: 'fine' }, 'No watermark. Made on your device; nothing is uploaded.'),
    ].filter(Boolean));
  };
  const run = async () => {
    const pages = [...state.pages].sort((a, b) => a - b);
    if (!pages.length) return toast('Pick at least one page.');
    const name = safeFilename(doc.name);
    const btn = body.querySelector('[data-testid="export-download"]');
    btn.disabled = true;
    btn.lastChild.textContent = 'Preparing…';
    try {
      if (MOVING.has(state.format)) {
        // Frames take a while: say how far along it is.
        const onProgress = (p) => (btn.lastChild.textContent = `Making ${state.format.toUpperCase()}… ${Math.round(p * 100)}%`);
        const blob = state.format === 'gif'
          ? await exportGif(doc, pages, { onProgress })
          : await exportVideo(doc, pages, { container: state.format, audio: await soundtrackBuffer(doc).catch(() => null), onProgress });
        download(blob, `${name}.${state.format}`);
      } else if (state.format === 'pdf') {
        download(await exportPdf(doc, pages), `${name}.pdf`);
      } else {
        const ext = state.format;
        const make = (i) => (ext === 'svg' ? exportSvg(doc, i, { transparent: state.transparent }) : exportImage(doc, i, { format: ext, scale: state.scale, transparent: state.transparent, quality: state.quality / 100 }));
        if (pages.length === 1) {
          download(await make(pages[0]), `${name}${doc.pages.length > 1 ? `-${pages[0] + 1}` : ''}.${ext}`);
        } else {
          const files = [];
          for (const i of pages) files.push({ name: `${name}-${i + 1}.${ext}`, data: await blobBytes(await make(i)) });
          download(new Blob([buildZip(files)], { type: 'application/zip' }), `${name}.zip`);
        }
      }
      toast('Downloaded');
      d.close();
    } catch (e) {
      toast(e.message || 'Export failed', 'error');
      btn.disabled = false;
      btn.lastChild.textContent = 'Download';
    }
  };
  draw();
  const d = dialog('Download', body, { testid: 'export-dialog' });
  return d;
}

/** For tests and power users: everything above, without the dialog. */
export const api = { exportImage, exportSvg, exportPdf, exportGif, exportVideo, thumbnail, projectBlob, rasterize, dataUrlToBytes, clone };
