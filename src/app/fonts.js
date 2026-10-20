// Loading fonts in the browser, measuring text with them, and embedding them
// in exports. In the one-file build the font files are inlined as data URLs.

import { FONTS, fontFile, fontsUsed } from '../model/fonts.js';
import { bytesToBase64 } from './ui.js';

const inlined = () => globalThis.PAPERWALL_ASSETS?.fonts || null;
const dataCache = new Map();
const customFonts = new Map(); // family -> dataUrl

export function fontUrl(file) {
  return inlined()?.[file] || `/assets/fonts/${file}`;
}

/** Register every bundled font. Resolves when they are ready to draw. */
export async function loadFonts() {
  const faces = [];
  for (const font of FONTS) {
    for (const w of font.weights) {
      const face = new FontFace(font.name, `url(${fontUrl(fontFile(font.slug, w))})`, { weight: String(w), display: 'block' });
      document.fonts.add(face);
      faces.push(face.load().catch(() => null));
    }
  }
  await Promise.all(faces);
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
    const url = await fileAsDataUrl(fontFile(font.slug, weight));
    rules.push(`@font-face{font-family:"${font.name}";font-weight:${weight};src:url(${url}) format("woff2");}`);
  }
  for (const a of Object.values(doc.assets || {})) {
    if (a.type === 'font') rules.push(`@font-face{font-family:"${a.family}";src:url(${a.dataUrl});}`);
  }
  return rules.join('');
}
