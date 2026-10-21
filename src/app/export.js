// Downloads: PNG, JPG, SVG, PDF (vector, flattened or for print), PowerPoint,
// a zip of pages, printing, copying to the clipboard, and Paperwall project
// files. All of it happens on your device.

import { renderPage, textRuns } from '../model/render.js';
import { buildPdf } from '../model/pdf.js';
import { buildZip } from '../model/zip.js';
import { validateDesign, clone, visiblePages, printDpi, versionSnapshot, soundtrackOf, keptAssets } from '../model/doc.js';
import { measure, fontCssFor, registerDesignFonts, onPaper } from './fonts.js';
import { h, icon, dialog, download, safeFilename, toast, readFileAsText, dataUrlToBytes, loadImage, canvasScale, toBlob, blobBytes } from './ui.js';
import { section, segmented, slider, toggle } from './widgets.js';
import { exportGif, exportVideo, canMakeVideo } from './motion-export.js';
import { exportVectorPdf, exportPptx } from './pro-export.js';
import { designMoves, startsTooLate, timeline } from '../model/motion.js';
import { t, formatNumber, ltr } from './i18n.js';
import { pageLabel } from './names.js';

export function maxScale(doc, wanted) {
  return canvasScale(doc.width, doc.height, wanted);
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

export async function exportPdf(doc0, pages0, { quality = 0.92 } = {}) {
  const [doc, pages] = await onPaper(doc0, pages0);
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
export async function thumbnail(doc0) {
  // (A document's first sheet, not a strip of its whole length.)
  const [doc] = await onPaper(doc0, [0]);
  const scale = 360 / Math.max(doc.width, doc.height);
  const canvas = await rasterize(doc, 0, { scale, background: '#ffffff' });
  return canvas.toDataURL('image/jpeg', 0.82);
}

export async function copyToClipboard(doc, pageIndex) {
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error(t('export.noClipboard'));
  const blob = await exportImage(doc, pageIndex, { format: 'png', scale: 1 });
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}

export async function printDesign(doc0, pages0) {
  const [doc, pages] = await onPaper(doc0, pages0);
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
  return new Blob([JSON.stringify(keptAssets(doc))], { type: 'application/json' });
}

export function saveProjectFile(doc) {
  download(projectBlob(doc), `${safeFilename(doc.name)}.paperwall.json`);
}

export async function readProjectFile(file) {
  let doc;
  try {
    doc = JSON.parse(await readFileAsText(file));
  } catch {
    throw new Error(t('export.notDesignFile', { name: file.name }));
  }
  validateDesign(doc);
  await registerDesignFonts(doc);
  return doc;
}

// ---------- the download dialog ----------

const MOVING = new Set(['gif', 'mp4', 'webm']);

/** How long the animation will be, and a nudge when nothing moves yet. */
function motionNote(doc, pages) {
  if (!pages.length) return t('export.pickPage');
  const { total } = timeline(doc, pages);
  const length = t('export.seconds', { n: Math.round(total * 10) / 10 });
  if (!designMoves(doc, pages)) {
    return pages.length > 1
      ? t('export.lengthPages', { length })
      : t('export.lengthStill', { length });
  }
  const late = pages.find((i) => startsTooLate(doc.pages[i]));
  if (late !== undefined) return t('export.lengthLate', { length, page: late + 1 });
  return t('export.length', { length });
}

/** The design's soundtrack, decoded, or null. (Soundtracks come with video elements and audio.) */
export async function soundtrackBuffer(doc) {
  const a = soundtrackOf(doc);
  if (!a) return null;
  // Offline: decoding needs no speakers (and Safari allows only a few live contexts).
  const Ctx = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!Ctx) return null;
  // (The callback form: older Safari's has no promise.)
  return new Promise((resolve, reject) => {
    // (Newer browsers also return a promise, which fails too: heard by `reject` already.)
    new Ctx(1, 1, 48000).decodeAudioData(dataUrlToBytes(a.dataUrl).bytes.buffer, resolve, reject)?.catch?.(() => null);
  });
}

export function exportDialog(editor) {
  const doc = editor.doc;
  // Hidden pages start unticked; tick one to download it anyway. If every
  // page is hidden (or there's just one), start with all of them.
  const visible = visiblePages(doc);
  const state = { format: 'png', pdfKind: 'vector', scale: 1, transparent: false, quality: 92, pages: new Set(visible.length && doc.pages.length > 1 ? visible : doc.pages.map((_, i) => i)) };
  // The ticked pages, in page order.
  const picked = () => [...state.pages].sort((a, b) => a - b);
  const body = h('div', { class: 'export' });
  const draw = () => {
    body.replaceChildren(...[
      section(t('export.fileType'), segmented({ label: t('export.fileType'), value: state.format, testid: 'export-format', onChange: (v) => {
        if (state.busy) return; // one download at a time: the choices wait
        state.format = v;
        draw();
      }, options: [
        { value: 'png', label: t('export.png'), text: 'PNG' },
        { value: 'jpg', label: t('export.jpg'), text: 'JPG' },
        { value: 'pdf', label: t('export.pdf'), text: 'PDF' },
        { value: 'svg', label: t('export.svg'), text: 'SVG' },
        { value: 'pptx', label: t('export.pptx'), text: 'PPTX' },
        { value: 'gif', label: t('export.gif'), text: 'GIF' },
        { value: 'mp4', label: t('export.mp4'), text: 'MP4' },
        { value: 'webm', label: t('export.webm'), text: 'WebM' },
      ] }),
      h('p', { class: 'hint' }, {
        png: t('export.pngHint'),
        jpg: t('export.jpgHint'),
        pdf: {
          vector: t('export.pdfVectorHint'),
          flat: t('export.pdfFlatHint'),
          print: t('export.pdfPrintHint'),
        }[state.pdfKind],
        pptx: t('export.pptxHint'),
        svg: t('export.svgHint'),
        gif: t('export.gifHint'),
        mp4: t('export.mp4Hint'),
        webm: t('export.webmHint'),
      }[state.format]),
      MOVING.has(state.format) ? h('p', { class: 'hint', 'data-testid': 'export-length' }, motionNote(doc, picked())) : null,
      (state.format === 'mp4' || state.format === 'webm') && !canMakeVideo() ? h('p', { class: 'hint warn' }, t('export.noVideoGif')) : null),
      state.format === 'pdf' ? section(t('export.pdfType'), segmented({ label: t('export.pdfType'), value: state.pdfKind, testid: 'export-pdf-kind', onChange: (v) => {
        state.pdfKind = v;
        draw();
      }, options: [
        { value: 'vector', label: t('export.pdfVector'), text: t('export.vector') },
        { value: 'flat', label: t('export.pdfFlat'), text: t('export.flat') },
        { value: 'print', label: t('export.pdfPrint'), text: t('export.print') },
      ] })) : null,
      state.format === 'png' || state.format === 'jpg' ? section(t('common.size'), segmented({ label: t('common.size'), value: state.scale, testid: 'export-scale', onChange: (v) => {
        state.scale = v;
        draw();
      }, options: [1, 2, 3].map((s) => ({ value: s, label: `${formatNumber(s)}x`, text: ltr(`${formatNumber(s)}x · ${formatNumber(Math.round(doc.width * maxScale(doc, s)))} × ${formatNumber(Math.round(doc.height * maxScale(doc, s)))}`) })) })) : null,
      state.format === 'png' || state.format === 'svg' ? toggle({ label: t('export.transparent'), checked: state.transparent, testid: 'export-transparent', onChange: (v) => (state.transparent = v) }) : null,
      state.format === 'jpg' ? slider({ label: t('export.quality'), value: state.quality, min: 40, max: 100, unit: '%', testid: 'export-quality', onChange: (v) => (state.quality = v) }) : null,
      doc.pages.length > 1 ? section(t('export.pages'), h('div', { class: 'page-picks', 'data-testid': 'export-pages' }, doc.pages.map((_, i) => {
        const cb = h('input', { type: 'checkbox', 'data-testid': `export-page-${i + 1}` });
        cb.checked = state.pages.has(i);
        cb.disabled = !!state.busy;
        cb.addEventListener('change', () => {
          if (cb.checked) state.pages.add(i);
          else state.pages.delete(i);
          // The animation's length depends on the pages.
          const note = body.querySelector('[data-testid="export-length"]');
          if (note) note.textContent = motionNote(doc, picked());
        });
        const p = doc.pages[i];
        return h('label', { class: 'toggle' }, cb, h('span', null, pageLabel(p, i)));
      }))) : null,
      h('div', { class: 'export-actions' },
        h('button', { type: 'button', class: 'btn primary big', 'data-testid': 'export-download', onClick: () => run() }, icon('download'), t('common.download')),
        h('button', { type: 'button', class: 'btn', 'data-testid': 'export-copy', onClick: async () => {
          try {
            await copyToClipboard(doc, editor.page);
            toast(t('export.copied'));
          } catch (e) {
            toast(e.message, 'error');
          }
        } }, icon('copy'), t('export.copy')),
        h('button', { type: 'button', class: 'btn', 'data-testid': 'export-print', onClick: async () => {
          d.close();
          await printDesign(doc, picked());
        } }, t('export.print'))),
      h('p', { class: 'fine' }, t('export.fine')),
    ].filter(Boolean));
  };
  const run = async () => {
    const pages = picked();
    if (!pages.length) return toast(t('export.pickPage'));
    const name = safeFilename(doc.name);
    const btn = body.querySelector('[data-testid="export-download"]');
    btn.disabled = true;
    btn.lastChild.textContent = t('export.preparing');
    state.busy = true;
    body.classList.add('busy');
    // Everything waits (Copy and Print too: they'd close the dialog and stop
    // it); closing the dialog is how to stop.
    for (const c of body.querySelectorAll('input, select, button')) c.disabled = true;
    try {
      if (MOVING.has(state.format)) {
        // Frames take a while: say how far along it is. They're drawn from the
        // design as it was when Download was pressed (later edits don't leak
        // in), and closing the dialog stops it.
        const onProgress = (p) => (btn.lastChild.textContent = t('export.making', { format: state.format.toUpperCase(), percent: formatNumber(p, { style: 'percent', maximumFractionDigits: 0 }) }));
        const still = versionSnapshot(doc);
        const signal = stopper.signal;
        const notes = []; // everything left out, each said
        let audio = null;
        // (Whether video can be made here is known before the sound is decoded for it.)
        if (state.format !== 'gif' && !canMakeVideo()) throw new Error(t('export.noVideo'));
        if (state.format !== 'gif' && still.audio) {
          // Decoded once the video is known to be possible here.
          audio = async () => {
            const buffer = await soundtrackBuffer(still).catch(() => null);
            if (!buffer) notes.push(t('export.silentRead'));
            return buffer;
          };
        }
        const blob = state.format === 'gif'
          ? await exportGif(still, pages, { onProgress, onNote: (m) => notes.push(m), signal })
          : await exportVideo(still, pages, { container: state.format, audio, volume: still.audio?.volume ?? 1, onProgress, onNote: (m) => notes.push(m), signal });
        if (signal.aborted) return;
        download(blob, `${name}.${state.format}`);
        if (notes.length) toast(notes.join(' '));
      } else if (state.format === 'pdf' || state.format === 'pptx') {
        // Pictures of effects take a moment: say how far along it is.
        const onProgress = (p) => (btn.lastChild.textContent = t('export.preparingPercent', { percent: formatNumber(p, { style: 'percent', maximumFractionDigits: 0 }) }));
        const signal = stopper.signal;
        const file = state.format === 'pptx' ? await exportPptx(doc, pages, { signal, onProgress })
          : state.pdfKind === 'flat' ? await exportPdf(doc, pages)
            : await exportVectorPdf(doc, pages, { print: state.pdfKind === 'print', signal, onProgress });
        if (signal.aborted) return; // closed while making it
        download(file, `${name}${state.pdfKind === 'print' && state.format === 'pdf' ? '-print' : ''}.${state.format}`);
      } else {
        const ext = state.format;
        const make = (i) => (ext === 'svg' ? exportSvg(doc, i, { transparent: state.transparent }) : exportImage(doc, i, { format: ext, scale: state.scale, transparent: state.transparent, quality: state.quality / 100 }));
        if (pages.length === 1) {
          const file = await make(pages[0]);
          if (stopper.signal.aborted) return;
          download(file, `${name}${doc.pages.length > 1 ? `-${pages[0] + 1}` : ''}.${ext}`);
        } else {
          const files = [];
          for (const i of pages) {
            if (stopper.signal.aborted) return;
            files.push({ name: `${name}-${i + 1}.${ext}`, data: await blobBytes(await make(i)) });
          }
          if (stopper.signal.aborted) return;
          download(new Blob([buildZip(files)], { type: 'application/zip' }), `${name}.zip`);
        }
      }
      state.busy = false; // done: closing now isn't stopping anything
      toast(t('export.done'));
      d.close();
    } catch (e) {
      if (stopper.signal.aborted) return; // closed while making it: nothing to say
      state.busy = false;
      body.classList.remove('busy');
      draw(); // everything back as it was, ready to try again
      toast(e.message || t('export.failed'), 'error');
    }
  };
  draw();
  const stopper = new AbortController();
  // While a download is being made, only Close or Escape stop it (not a
  // stray click beside the dialog), and stopping it says so.
  const d = dialog(t('common.download'), body, {
    testid: 'export-dialog',
    steady: () => state.busy,
    onClose: () => {
      if (state.busy) toast(t('export.stopped'));
      stopper.abort();
    },
  });
  return d;
}

/** For tests and power users: everything above, without the dialog. */
export const api = { exportImage, exportSvg, exportPdf, exportVectorPdf, exportPptx, exportGif, exportVideo, soundtrackBuffer, thumbnail, projectBlob, rasterize, dataUrlToBytes, clone };
