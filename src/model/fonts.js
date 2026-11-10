// Fonts bundled with Paperwall. All are open-license (SIL OFL 1.1 or Apache
// 2.0); license files sit next to the font files in assets/fonts.

import { FONT_CATALOG } from './font-catalog.js';

// Two display fonts are everywhere already, so they stay available but sit at
// the end of every list instead of leading it.
const LESS_SUGGESTED = new Set(['Lobster', 'Pacifico']);
export const FONTS = [
  ...FONT_CATALOG.filter((f) => !LESS_SUGGESTED.has(f.name)),
  ...FONT_CATALOG.filter((f) => LESS_SUGGESTED.has(f.name)),
];

export const FONT_KINDS = ['Sans', 'Serif', 'Display', 'Script', 'Mono'];

/** Heading + body pairings that look good together. */
export const FONT_PAIRS = [
  { name: 'Classic', heading: 'Playfair Display', body: 'Lora' },
  { name: 'Modern', heading: 'Montserrat', body: 'Inter' },
  { name: 'Bold poster', heading: 'Bebas Neue', body: 'Poppins' },
  { name: 'Friendly', heading: 'Poppins', body: 'Inter' },
  { name: 'Editorial', heading: 'DM Serif Display', body: 'Inter' },
  { name: 'Handmade', heading: 'Caveat', body: 'Poppins' },
  { name: 'Tech', heading: 'Space Grotesk', body: 'Space Grotesk' },
  { name: 'Headline', heading: 'Archivo Black', body: 'Roboto Slab' },
  { name: 'Wedding', heading: 'Dancing Script', body: 'Playfair Display' },
  { name: 'Elegant', heading: 'Cormorant Garamond', body: 'Raleway' },
  { name: 'Startup', heading: 'Plus Jakarta Sans', body: 'DM Sans' },
  { name: 'Playful', heading: 'Fredoka', body: 'Nunito' },
  { name: 'Magazine', heading: 'Abril Fatface', body: 'Lato' },
  { name: 'Retro', heading: 'Righteous', body: 'Work Sans' },
  { name: 'Luxury', heading: 'Cinzel', body: 'Marcellus' },
  { name: 'Notebook', heading: 'Permanent Marker', body: 'Patrick Hand' },
  { name: 'Impact', heading: 'Anton', body: 'Barlow' },
  { name: 'Clean', heading: 'Outfit', body: 'Manrope' },
  { name: 'Bookish', heading: 'EB Garamond', body: 'Crimson Pro' },
  { name: 'Calligraphy', heading: 'Great Vibes', body: 'Josefin Sans' },
  { name: 'Arcade', heading: 'Press Start 2P', body: 'Space Mono' },
  { name: 'Hindi friendly', heading: 'Mukta', body: 'Hind' },
  { name: 'Script', heading: 'Pacifico', body: 'Montserrat' },
];

export function fontByName(name) {
  return FONTS.find((f) => f.name === name) || null;
}

/** The bundled weight closest to the one asked for. */
export function nearestWeight(name, weight) {
  const font = fontByName(name);
  if (!font) return weight;
  return font.weights.reduce((best, w) => (Math.abs(w - weight) < Math.abs(best - weight) ? w : best), font.weights[0]);
}

export function fontFile(slug, weight) {
  return `${slug}-${weight}.woff2`;
}

/** Every file of a family at one weight: the Latin file plus any extra scripts, with their character ranges. */
export function fontFiles(font, weight) {
  const files = [{ file: fontFile(font.slug, weight), range: null }];
  for (const x of font.extra || []) if (x.weight === weight) files.push({ file: x.file, range: x.range });
  return files;
}

/** Every (font, weight) file a design uses, so exports can embed just those. */
export function fontsUsed(doc) {
  const used = new Map();
  const visit = (els) => {
    for (const el of els) {
      const add = (name, weight) => {
        const font = fontByName(name);
        if (!font) return;
        const w = nearestWeight(name, weight);
        used.set(`${font.slug}-${w}`, { font, weight: w });
      };
      if (el.type === 'text') add(el.font, el.weight || 400);
      if (el.type === 'chart' || el.type === 'table') {
        add(el.font, 400);
        add(el.font, 700);
      }
      if (el.type === 'group') visit(el.children);
    }
  };
  doc.pages.forEach((p) => visit(p.elements));
  return [...used.values()];
}
