// Loading fonts in the browser, measuring text with them, and embedding them
// in exports. In the one-file build the font files are inlined as data URLs;
// the hosted page fetches them from fonts/ as designs need them.

import { FONTS, fontFiles, fontsUsed, nearestWeight } from '../model/fonts.js';
import { forgetLayouts } from '../model/text-layout.js';
import { bytesToBase64, dataUrlToBytes } from './ui.js';
import { onPaper as sheetsOf } from '../model/flow.js';

const inlined = () => globalThis.PAPERWALL_ASSETS?.fonts || null;
const dataCache = new Map();
const customFonts = new Map(); // family -> dataUrl

/** Where a bundled font file is: inlined, beside the hosted page, or in the source tree. */
export function fontUrl(file) {
  return inlined()?.[file] || `${globalThis.PAPERWALL_FONTS || '/assets/fonts/'}${file}`;
}

const faces = new Map(); // "Family|weight" -> [FontFace]

/**
 * Register every bundled font without downloading it. A font is fetched the
 * first time something needs it; call ensureFont() before measuring text.
 */
export function registerFonts() {
  if (faces.size) return;
  for (const font of FONTS) {
    for (const w of font.weights) {
      const list = fontFiles(font, w).map(({ file, range }) => {
        const desc = { weight: String(w), display: 'block' };
        if (range) desc.unicodeRange = range;
        const face = new FontFace(font.name, `url(${fontUrl(file)})`, desc);
        document.fonts.add(face);
        return face;
      });
      faces.set(`${font.name}|${w}`, list);
    }
  }
}

/** Make sure a font is downloaded and ready to measure and draw. */
export async function ensureFont(name, weight = 400) {
  const w = nearestWeight(name, weight);
  const list = faces.get(`${name}|${w}`);
  if (!list) return;
  await Promise.all(list.map((f) => (f.status === 'loaded' ? null : f.load().catch(() => null))));
}

/** Whether a font is done loading, either way (loaded, or failed for good). */
export function fontSettled(name, weight = 400) {
  const list = faces.get(`${name}|${nearestWeight(name, weight)}`);
  return !list || list.every((f) => f.status === 'loaded' || f.status === 'error');
}

/** Whether a font is downloaded and usable (false if it failed to load). */
export function fontLoaded(name, weight = 400) {
  const list = faces.get(`${name}|${nearestWeight(name, weight)}`);
  return !list || list.every((f) => f.status === 'loaded');
}

/** Every font a design uses, ready before its text is measured. */
export async function ensureDesignFonts(doc) {
  await Promise.all(fontsUsed(doc).map(({ font, weight }) => ensureFont(font.name, weight)));
}

/**
 * On paper (every PDF, printing, PowerPoint), a document is sheets, split
 * between its blocks; anything else is as it is. Split once its fonts are
 * in: they decide where lines break. Returns [design, page indexes].
 */
export async function onPaper(doc, pages) {
  if (!doc.document) return [doc, pages]; // (nothing to split: no fonts to wait for)
  await ensureDesignFonts(doc);
  return sheetsOf(doc, pages, measure);
}

/** Boot: register everything, load the interface font. */
export async function loadFonts() {
  registerFonts();
  await Promise.all([ensureFont('Inter', 400), ensureFont('Inter', 700)]);
}

/** Add a font from a file the user picked. Returns its family name. */
export async function addCustomFont(name, dataUrl) {
  const family = name.replace(/\.(woff2?|ttf|otf)$/i, '').replace(/[^\w\s-]/g, '').trim() || 'My font';
  const face = new FontFace(family, `url(${dataUrl})`);
  await face.load();
  document.fonts.add(face);
  customFonts.set(family, dataUrl);
  return family;
}

export function customFontNames() {
  return [...customFonts.keys()];
}

/** Make sure fonts stored inside a design are registered. */
export async function registerDesignFonts(doc) {
  for (const a of Object.values(doc.assets || {})) {
    if (a.type === 'font' && !customFonts.has(a.family)) {
      try {
        await addCustomFont(a.family, a.dataUrl);
      } catch {
        /* a broken font file falls back to the default font */
      }
    }
  }
}

let ctx2d = null;
const widthCache = new Map();

/** Width of a run of text in px, measured with the real font. */
export function measure(text, el) {
  if (!ctx2d) ctx2d = document.createElement('canvas').getContext('2d');
  const font = `${el.italic ? 'italic ' : ''}${el.weight || 400} 100px "${el.font}", sans-serif`;
  const key = font + '\u0000' + text;
  let w = widthCache.get(key);
  if (w === undefined) {
    ctx2d.font = font;
    w = ctx2d.measureText(text).width;
    if (widthCache.size > 20000) widthCache.clear();
    widthCache.set(key, w);
  }
  return (w * el.size) / 100;
}

let measured = 0; // counts up each time the widths are measured afresh

/** Which widths text is measured with: changes when a font arrives (so pictures of text are drawn again). */
export function measureVersion() {
  return measured;
}

export function clearMeasureCache() {
  measured++;
  widthCache.clear();
  forgetLayouts(); // (worked out from the old widths)
}

async function fileAsDataUrl(file) {
  const direct = inlined()?.[file];
  if (direct) return direct;
  if (dataCache.has(file)) return dataCache.get(file);
  const res = await fetch(fontUrl(file));
  if (!res.ok) throw new Error(`Font ${file}: ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const url = `data:font/woff2;base64,${bytesToBase64(bytes)}`;
  dataCache.set(file, url);
  return url;
}

/**
 * The font files a design's text uses, as bytes, for writers that embed
 * them (the vector PDF): "Family|weight" for bundled fonts (their main,
 * Latin file), "Family|*" for fonts stored in the design.
 */
export async function designFontFiles(doc) {
  const out = new Map();
  for (const { font, weight } of fontsUsed(doc)) {
    try {
      out.set(`${font.name}|${weight}`, dataUrlToBytes(await fileAsDataUrl(fontFiles(font, weight)[0].file)).bytes);
    } catch {
      /* a font that can't be read: its text comes as a picture */
    }
  }
  for (const a of Object.values(doc.assets || {})) {
    if (a.type !== 'font') continue;
    try {
      out.set(`${a.family}|*`, dataUrlToBytes(a.dataUrl).bytes);
    } catch {
      /* its file is gone: its text comes as a picture */
    }
  }
  return out;
}

/** Every distinct character of text in a design, as code points. */
function designChars(doc) {
  const set = new Set();
  const add = (s) => {
    for (const ch of String(s ?? '')) set.add(ch.codePointAt(0));
  };
  const visit = (els) => {
    for (const el of els) {
      if (el.type === 'text') add(el.text);
      if (el.type === 'table') el.rows.flat().forEach(add);
      if (el.type === 'chart') el.data.forEach((d) => add(d.label));
      if (el.type === 'group') visit(el.children);
    }
  };
  doc.pages.forEach((p) => visit(p.elements));
  return [...set];
}

/** Whether a code point is inside a CSS unicode-range like "U+0900-097F, U+20B9". */
function inRange(cp, range) {
  return range.split(',').some((part) => {
    const [a, b = a] = part.trim().replace(/^U\+/i, '').split('-').map((x) => parseInt(x, 16));
    return cp >= a && cp <= b;
  });
}

/** @font-face rules for just the fonts a design uses, with the files inlined. */
export async function fontCssFor(doc) {
  const rules = [];
  const chars = designChars(doc);
  for (const { font, weight } of fontsUsed(doc)) {
    for (const { file, range } of fontFiles(font, weight)) {
      // Files for other scripts go in only if the design uses that script.
      if (range && !chars.some((c) => inRange(c, range))) continue;
      const url = await fileAsDataUrl(file);
      rules.push(`@font-face{font-family:"${font.name}";font-weight:${weight};src:url(${url}) format("woff2");${range ? `unicode-range:${range};` : ''}}`);
    }
  }
  for (const a of Object.values(doc.assets || {})) {
    if (a.type === 'font') rules.push(`@font-face{font-family:"${a.family}";src:url(${a.dataUrl});}`);
  }
  return rules.join('');
}
