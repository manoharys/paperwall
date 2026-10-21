// The interface's names for things the model knows by id (presets, shapes,
// animations, template categories...), in the person's language. Anything
// without a translation keeps the model's own English name.

import { t, hasKey, formatNumber, languageName, ltr } from './i18n.js';
import { iconById, stickerById } from '../model/graphics.js';
import { fromPx } from '../model/doc.js';

/** A key made from a name: "Tips & lists" → "tips-lists". */
export function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** t(`${prefix}.${id}`) when there is one, else the fallback. */
export function named(prefix, id, fallback = id) {
  const key = `${prefix}.${id}`;
  return hasKey(key) ? t(key) : fallback;
}

export const presetName = (p) => named('preset', p.id, p.name);

/** A size (px) in a unit, written the same everywhere: "1080 × 1080 px", "210 × 297 mm". */
export function sizeLabel(w, h, unit = 'px') {
  const u = unit === 'mm' || unit === 'in' ? unit : 'px';
  return ltr(`${formatNumber(fromPx(w, u))} × ${formatNumber(fromPx(h, u))} ${u}`);
}

/** A preset's size in its own units. */
export const presetSize = (p) => sizeLabel(p.w, p.h, p.unit);

export const shapeName = (shape) => named('shape', shape);
export const typeName = (type) => named('type', type);
export const animName = (type, fallback) => named('anim', type, fallback);
export const transitionName = (type, fallback) => named('transition', type, fallback);
export const effectName = (type) => named('effect', type);
export const fontKind = (kind) => named('fontKind', slug(kind), kind);
export const templateCategory = (c) => named('tplCat', slug(c), c);
export const gridName = (g) => named('grid', g.id, g.name);
export const comboName = (c) => named('combo', c.id, c.name);
export const pairName = (p) => named('pair', slug(p.name), p.name);
export const drawToolName = (tool) => named('drawTool', tool, tool[0].toUpperCase() + tool.slice(1));
export const featureName = (f, fallback) => named('feature', f, fallback);
export const writingActionName = (a) => named('aiAction', a.id, a.name);
export const toneName = (tone) => named('tone', tone, tone[0].toUpperCase() + tone.slice(1));
export const paletteName = (name) => named('palette', slug(name), name);
export const gradientName = (name) => named('gradient', slug(name), name);
export const duotoneName = (name) => named('duotone', slug(name), name);

/** A frame's shape: named as shapes are, but for these three. */
export function maskName(mask) {
  if (mask === 'none') return t('shape.rect');
  if (mask === 'circle') return t('shape.ellipse');
  if (mask === 'polygon') return t('shape.hexagon');
  return shapeName(mask);
}

/** What an element is called (the panel's title, what's said when it's selected). */
export function elementName(el) {
  if (el.type === 'shape') return shapeName(el.shape);
  if (el.type === 'icon') return iconById(el.iconId)?.name || typeName('icon');
  if (el.type === 'sticker') return stickerById(el.stickerId)?.name || typeName('sticker');
  return typeName(el.type);
}

/** A layer's name: a text's first words, else what it is. */
export function layerName(el) {
  if (el.type === 'text') return el.text.split('\n')[0].slice(0, 40) || typeName('text');
  if (el.type === 'icon') return iconById(el.iconId)?.name || typeName('icon');
  return el.type === 'shape' ? shapeName(el.shape) : typeName(el.type);
}

/** A template's size, like "Story", or its pixels when it has no named format. */
export function templateFormat(tpl, fallback) {
  return tpl.format ? named('format', tpl.format, fallback) : fallback;
}

/** How a page is named in lists: its number, and its title if it has one. */
export function pageName(page, i) {
  return page.title ? t('page.nameTitled', { n: i + 1, title: page.title }) : t('page.name', { n: i + 1 });
}

/** Its name, saying so when it's hidden. */
export function pageLabel(page, i) {
  return page.hidden ? t('page.hiddenLabel', { name: pageName(page, i) }) : pageName(page, i);
}

/** Versions kept by Paperwall itself are labelled in English when saved; shown in the person's language. */
export function versionLabel(label) {
  if (label === 'Original') return t('history.original');
  if (label === 'Saved by you') return t('history.savedByYou');
  return label;
}

// The AI writing languages (named in English for the model) as the person's language names them.
const AI_LANGUAGE_CODES = {
  English: 'en', Spanish: 'es', French: 'fr', German: 'de', Italian: 'it', Portuguese: 'pt', Dutch: 'nl', Swedish: 'sv', Polish: 'pl', Turkish: 'tr', Russian: 'ru',
  Arabic: 'ar', Hindi: 'hi', Bengali: 'bn', Tamil: 'ta', Kannada: 'kn', Indonesian: 'id', Vietnamese: 'vi', Japanese: 'ja', Korean: 'ko', 'Chinese (Simplified)': 'zh-Hans',
};

export function aiLanguageName(name) {
  const code = AI_LANGUAGE_CODES[name];
  return code ? languageName(code) : name;
}
