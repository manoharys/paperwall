// Fonts bundled with Placard. All are open-license (SIL OFL 1.1, or Apache 2.0
// for Roboto Slab); license files sit next to the font files in assets/fonts.

export const FONTS = [
  { name: 'Inter', slug: 'inter', weights: [400, 700], kind: 'Sans' },
  { name: 'Poppins', slug: 'poppins', weights: [400, 700], kind: 'Sans' },
  { name: 'Montserrat', slug: 'montserrat', weights: [400, 700], kind: 'Sans' },
  { name: 'Space Grotesk', slug: 'space-grotesk', weights: [400, 700], kind: 'Sans' },
  { name: 'Oswald', slug: 'oswald', weights: [400, 700], kind: 'Condensed' },
  { name: 'Bebas Neue', slug: 'bebas-neue', weights: [400], kind: 'Display' },
  { name: 'Archivo Black', slug: 'archivo-black', weights: [400], kind: 'Display' },
  { name: 'Playfair Display', slug: 'playfair-display', weights: [400, 700], kind: 'Serif' },
  { name: 'DM Serif Display', slug: 'dm-serif-display', weights: [400], kind: 'Serif' },
  { name: 'Lora', slug: 'lora', weights: [400, 700], kind: 'Serif' },
  { name: 'Roboto Slab', slug: 'roboto-slab', weights: [400, 700], kind: 'Slab' },
  { name: 'Pacifico', slug: 'pacifico', weights: [400], kind: 'Script' },
  { name: 'Dancing Script', slug: 'dancing-script', weights: [400, 700], kind: 'Script' },
  { name: 'Caveat', slug: 'caveat', weights: [400, 700], kind: 'Handwriting' },
];

/** Heading + body pairings that look good together. */
export const FONT_PAIRS = [
  { name: 'Classic', heading: 'Playfair Display', body: 'Lora' },
  { name: 'Modern', heading: 'Montserrat', body: 'Inter' },
  { name: 'Bold poster', heading: 'Bebas Neue', body: 'Poppins' },
  { name: 'Friendly', heading: 'Poppins', body: 'Inter' },
  { name: 'Editorial', heading: 'DM Serif Display', body: 'Inter' },
  { name: 'Handmade', heading: 'Caveat', body: 'Poppins' },
  { name: 'Script', heading: 'Pacifico', body: 'Montserrat' },
  { name: 'Tech', heading: 'Space Grotesk', body: 'Space Grotesk' },
  { name: 'Headline', heading: 'Archivo Black', body: 'Roboto Slab' },
  { name: 'Wedding', heading: 'Dancing Script', body: 'Playfair Display' },
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
