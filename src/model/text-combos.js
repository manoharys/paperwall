// Ready-made text combinations: headings, labels and small print styled to
// go together. Each is laid out with the template layout engine and added as
// one group. Written for Paperwall (CC0).

import { createText, createLine, createGroup } from './doc.js';
import { layoutDesign } from './layout.js';
import { unionBounds } from './geometry.js';

const INK = '#1a1a2e';
const ACCENT = '#f25c2a';
const W = 800;

// [text, props] pairs stacked top to bottom, centered unless they say otherwise.
const T = (text, props) => ({ text, ...props });

export const TEXT_COMBOS = [
  { id: 'big-sale', name: 'Big sale', items: [
    T('LIMITED TIME', { font: 'Montserrat', weight: 700, size: 34, letterSpacing: 10, color: ACCENT }),
    T('BIG SALE', { font: 'Anton', size: 190, lineHeight: 1, color: INK, gap: 8 }),
    T('Up to 50% off everything', { font: 'Poppins', weight: 700, size: 40, color: '#ffffff', highlight: { color: INK, padding: 16, radius: 12 }, gap: 22 }),
  ] },
  { id: 'save-the-date', name: 'Save the date', items: [
    T('Save the date', { font: 'Great Vibes', size: 120, color: INK }),
    T('— 06 · 21 · 2027 —', { font: 'Cormorant Garamond', weight: 600, size: 46, letterSpacing: 6, color: INK, gap: 10 }),
    T('Rosewood Gardens', { font: 'Raleway', size: 30, letterSpacing: 8, caps: true, color: '#6b6b7b', gap: 14 }),
  ] },
  { id: 'grand-opening', name: 'Grand opening', items: [
    T('NOW OPEN', { font: 'Montserrat', weight: 700, size: 36, letterSpacing: 16, color: ACCENT }),
    T('GRAND\nOPENING', { font: 'Bebas Neue', size: 170, lineHeight: 0.92, color: INK, gap: 10 }),
    T('Saturday · 10 am', { font: 'Poppins', weight: 700, size: 38, color: INK, highlight: { color: '#ffd166', padding: 14, radius: 40 }, gap: 22 }),
  ] },
  { id: 'thank-you', name: 'Thank you', items: [
    T('Thank you', { font: 'Pacifico', size: 130, color: ACCENT }),
    T('FOR SHOPPING SMALL', { font: 'Josefin Sans', weight: 700, size: 32, letterSpacing: 10, color: INK, gap: 6 }),
  ] },
  { id: 'happy-birthday', name: 'Happy birthday', items: [
    T('Happy', { font: 'Fredoka', weight: 700, size: 110, color: '#ff4d6d', lineHeight: 1 }),
    T('BIRTHDAY!', { font: 'Fredoka', weight: 700, size: 140, color: INK, lineHeight: 1 }),
    T('Hope your day is as sweet as you', { font: 'Nunito', size: 36, color: '#6b6b7b', gap: 16 }),
  ] },
  { id: 'quote', name: 'Quote', items: [
    T('“Make the thing you wish existed.”', { font: 'Playfair Display', weight: 700, italic: true, size: 70, lineHeight: 1.25, color: INK }),
    { line: true, w: 100, gap: 24 },
    T('A. MAKER', { font: 'Montserrat', weight: 700, size: 28, letterSpacing: 8, color: '#6b6b7b', gap: 22 }),
  ] },
  { id: 'coming-soon', name: 'Coming soon', items: [
    T('COMING', { font: 'Space Grotesk', weight: 700, size: 120, letterSpacing: 24, color: INK, lineHeight: 1 }),
    T('SOON', { font: 'Space Grotesk', weight: 700, size: 120, letterSpacing: 24, color: 'none', lineHeight: 1, effect: { type: 'hollow', thickness: 0.03 } }),
    T('Stay tuned', { font: 'Inter', size: 34, color: '#6b6b7b', gap: 18 }),
  ] },
  { id: 'new-collection', name: 'New collection', items: [
    T('Autumn / Winter', { font: 'Lato', size: 34, letterSpacing: 6, caps: true, color: '#6b6b7b' }),
    T('The New\nCollection', { font: 'Abril Fatface', size: 130, lineHeight: 1, color: INK, gap: 12 }),
    T('Shop the lookbook →', { font: 'Lato', weight: 700, size: 34, color: INK, underline: true, gap: 24 }),
  ] },
  { id: 'webinar', name: 'Webinar', items: [
    T('FREE LIVE WORKSHOP', { font: 'Inter', weight: 700, size: 30, letterSpacing: 6, color: '#5b5bd6', align: 'left' }),
    T('Design your first poster', { font: 'Poppins', weight: 700, size: 80, lineHeight: 1.1, color: INK, align: 'left', gap: 12 }),
    T('Thursday · 5 pm UTC · Online', { font: 'Inter', size: 34, color: '#3d3d4e', align: 'left', gap: 16 }),
  ] },
  { id: 'menu-title', name: 'Menu heading', items: [
    T('The Corner Café', { font: 'Playfair Display', weight: 700, size: 96, color: INK }),
    { line: true, w: 160, gap: 16 },
    T('MENU', { font: 'Montserrat', weight: 700, size: 30, letterSpacing: 14, color: '#8a6446', gap: 16 }),
  ] },
  { id: 'hello', name: 'Introduction', items: [
    T('Hello, I’m', { font: 'Caveat', weight: 700, size: 80, color: ACCENT, align: 'left' }),
    T('Jordan Lee', { font: 'Outfit', weight: 700, size: 130, lineHeight: 1, color: INK, align: 'left' }),
    T('Designer · writer · tea drinker', { font: 'Manrope', size: 36, color: '#6b6b7b', align: 'left', gap: 16 }),
  ] },
  { id: 'tip', name: 'Tip of the day', items: [
    T('TIP #12', { font: 'Poppins', weight: 700, size: 34, letterSpacing: 4, color: '#ffffff', highlight: { color: ACCENT, padding: 14, radius: 8 }, align: 'left' }),
    T('Write tomorrow’s list before you finish today.', { font: 'Poppins', weight: 700, size: 64, lineHeight: 1.2, color: INK, align: 'left', gap: 22 }),
  ] },
  { id: 'neon-open', name: 'Neon sign', items: [
    T('open late', { font: 'Pacifico', size: 140, color: '#ff2d95', effect: { type: 'neon' } }),
    T('BAR · KITCHEN · MUSIC', { font: 'Montserrat', weight: 700, size: 30, letterSpacing: 10, color: '#00e5ff', effect: { type: 'glow' }, gap: 16 }),
  ] },
  { id: 'retro', name: 'Retro title', items: [
    T('SUMMER', { font: 'Righteous', size: 150, color: '#ffb703', effect: { type: 'splice', color: '#fb5607', offset: 0.06 } }),
    T('VIBES ONLY', { font: 'Righteous', size: 60, letterSpacing: 12, color: '#3a86ff', gap: 8 }),
  ] },
];

/** The fonts a combination uses, as [{ font, weight }], without laying it out. */
export function comboFonts(combo) {
  return combo.items.filter((it) => it.font).map((it) => ({ font: it.font, weight: it.weight || 400 }));
}

/**
 * A combination as one group of elements, laid out with `measure` and
 * centered on (cx, cy).
 */
export function comboGroup(combo, measure, { cx = 0, cy = 0 } = {}) {
  const elements = combo.items.map((it) => {
    const gap = it.gap ?? 0;
    if (it.line) return Object.assign(createLine({ x: (W - it.w) / 2, w: it.w, h: 12, stroke: INK, strokeWidth: 3 }), { flow: 'main', gap });
    const { gap: _g, ...props } = it;
    const align = props.align || 'center';
    const el = createText({ x: 0, w: W, align, ...props, color: props.color === 'none' ? INK : props.color });
    // Shrink anything that would break a word; a pill's background reaches past the box, so inset it.
    if (el.highlight && align === 'left') Object.assign(el, { x: el.highlight.padding, w: W - el.highlight.padding * 2 });
    return Object.assign(el, { flow: 'main', gap, fit: { maxLines: 4, minSize: 12 } });
  });
  const doc = { pages: [{ elements, flows: { main: { y: 0, h: 10000, align: 'top' } } }] };
  layoutDesign(doc, measure);
  const b = unionBounds(elements);
  const children = elements.map((el) => ({ ...el, x: el.x - b.x, y: el.y - b.y }));
  return createGroup(children, { x: Math.round(cx - b.w / 2), y: Math.round(cy - b.h / 2), w: Math.round(b.w), h: Math.round(b.h) });
}
