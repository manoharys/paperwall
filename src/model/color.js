// Color maths shared by the renderer, the color picker and the design checks.

/** #rrggbb, or the short #rgb (as files from elsewhere may have), as lowercase #rrggbb; anything else as null. */
export function normalizeHex(v) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(v ?? '').trim());
  if (!m) return null;
  const hex = m[1].toLowerCase();
  return `#${hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex}`;
}

export function hexToRgb(hex) {
  const full = normalizeHex(hex);
  if (!full) return null;
  const n = parseInt(full.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance([r, g, b]) {
  const c = [r, g, b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/** Mix two #rrggbb colors: t = 0 gives a, 1 gives b. Unreadable colors are returned as they are. */
export function mixHex(a, b, t) {
  const [x, y] = [hexToRgb(a), hexToRgb(b)];
  if (!x || !y) return a;
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
}

/** WCAG contrast ratio between two colors (1–21). */
export function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** A gradient's stops in order along it (stops without an offset count as 0). */
export function sortedStops(g) {
  // A stop's position as a number (text like "0.5" too); none, or a broken one, is 0.
  const at = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(+v) ? 0 : +v);
  return (g?.stops || []).map((s) => (s.offset === at(s.offset) ? s : { ...s, offset: at(s.offset) })).sort((a, b) => a.offset - b.offset);
}
