// Loading fonts in the browser, measuring text with them, and embedding them
// in exports. In the one-file build the font files are inlined as data URLs.

import { FONTS, fontFiles, fontsUsed, nearestWeight } from '../model/fonts.js';
import { bytesToBase64 } from './ui.js';

const inlined = () => globalThis.PAPERWALL_ASSETS?.fonts || null;
const dataCache = new Map();
const customFonts = new Map(); // family -> dataUrl

export function fontUrl(file) {
  return inlined()?.[file] || `/assets/fonts/${file}`;
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

/** Every font a design uses, ready before its text is measured. */
export async function ensureDesignFonts(doc) {
  await Promise.all(fontsUsed(doc).map(({ font, weight }) => ensureFont(font.name, weight)));
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

export function clearMeasureCache() {
  widthCache.clear();
}

async function fileAsDataUrl(file) {
  const direct = inlined()?.[file];
  if (direct) return direct;
  if (dataCache.has(file)) return dataCache.get(file);
  const res = await fetch(fontUrl(file));
  const bytes = new Uint8Array(await res.arrayBuffer());
  const url = `data:font/woff2;base64,${bytesToBase64(bytes)}`;
  dataCache.set(file, url);
  return url;
}

/** @font-face rules for just the fonts a design uses, with the files inlined. */
export async function fontCssFor(doc) {
  const rules = [];
  for (const { font, weight } of fontsUsed(doc)) {
    for (const { file, range } of fontFiles(font, weight)) {
      const url = await fileAsDataUrl(file);
      rules.push(`@font-face{font-family:"${font.name}";font-weight:${weight};src:url(${url}) format("woff2");${range ? `unicode-range:${range};` : ''}}`);
    }
  }
  for (const a of Object.values(doc.assets || {})) {
    if (a.type === 'font') rules.push(`@font-face{font-family:"${a.family}";src:url(${a.dataUrl});}`);
  }
  return rules.join('');
}
