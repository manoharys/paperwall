// The template kit: color palettes, and layouts that turn a piece of content
// into a page at any size. Text is marked to shrink to fit and grouped into
// flows (see src/model/layout.js), so a layout works for short and long copy
// alike and on square, tall and wide pages.

import { createText, createShape, createLine, createIcon, createSticker, createTable } from '../model/doc.js';
import { fontByName, nearestWeight } from '../model/fonts.js';

/**
 * Palettes. `ink` is for text on `bg` and `surface`, `muted` for quieter text,
 * `accent` for color blocks and `onAccent` for text on them. `accent2` is for
 * decoration only. `stickers` names the sticker colorway that goes with it.
 * The unit tests check every pairing meets its contrast floor.
 */
export const PALETTES = {
  paper: { bg: '#f7f3ec', surface: '#ffffff', ink: '#1d1b26', muted: '#5e5a6b', accent: '#c63f16', accent2: '#ffd166', onAccent: '#ffffff', stickers: 'ember' },
  midnight: { bg: '#12121c', surface: '#1f1f2e', ink: '#ffffff', muted: '#b7b7cc', accent: '#8e7dff', accent2: '#ffd166', onAccent: '#12121c', stickers: 'night' },
  mint: { bg: '#e9f7f1', surface: '#ffffff', ink: '#0f3d33', muted: '#3f6b60', accent: '#0b7a5f', accent2: '#ffcf5c', onAccent: '#ffffff', stickers: 'forest' },
  blush: { bg: '#fff1f3', surface: '#ffffff', ink: '#3b1426', muted: '#7a4a5c', accent: '#c93468', accent2: '#ffd6a5', onAccent: '#ffffff', stickers: 'berry' },
  ocean: { bg: '#eaf4fb', surface: '#ffffff', ink: '#0b2a45', muted: '#3d5d78', accent: '#1f6fb2', accent2: '#7fd1c7', onAccent: '#ffffff', stickers: 'lagoon' },
  sunset: { bg: '#2a1638', surface: '#3a2150', ink: '#fff4e6', muted: '#e6c8d8', accent: '#ff7a45', accent2: '#ffd166', onAccent: '#2a1638', stickers: 'ember' },
  forest: { bg: '#1f3a2e', surface: '#2b4d3d', ink: '#f4f1e8', muted: '#c5d6c9', accent: '#e9c46a', accent2: '#f4a261', onAccent: '#1f3a2e', stickers: 'forest' },
  lemon: { bg: '#fff8d6', surface: '#ffffff', ink: '#1d1b16', muted: '#5c5636', accent: '#1d1b16', accent2: '#ff6b35', onAccent: '#fff8d6', stickers: 'ember' },
  mono: { bg: '#ffffff', surface: '#f2f2f2', ink: '#111111', muted: '#555555', accent: '#111111', accent2: '#d9d9d9', onAccent: '#ffffff', stickers: 'mono' },
  lavender: { bg: '#f3f0ff', surface: '#ffffff', ink: '#241b4d', muted: '#5a5185', accent: '#5b4bd6', accent2: '#ffb3c7', onAccent: '#ffffff', stickers: 'berry' },
  terracotta: { bg: '#f4e9df', surface: '#fffaf5', ink: '#3a2418', muted: '#6e5546', accent: '#a84a22', accent2: '#e9c46a', onAccent: '#ffffff', stickers: 'ember' },
  navy: { bg: '#0f1e3d', surface: '#18294d', ink: '#ffffff', muted: '#c3cde3', accent: '#d4a64a', accent2: '#f3e3b5', onAccent: '#0f1e3d', stickers: 'night' },
  coral: { bg: '#fff5ef', surface: '#ffffff', ink: '#2c1a14', muted: '#6d5047', accent: '#d63a2f', accent2: '#2ec4b6', onAccent: '#ffffff', stickers: 'ember' },
  sage: { bg: '#eef2ea', surface: '#ffffff', ink: '#26332a', muted: '#56655a', accent: '#4f6e52', accent2: '#d9a679', onAccent: '#ffffff', stickers: 'forest' },
  electric: { bg: '#0a0a0a', surface: '#1a1a1a', ink: '#ffffff', muted: '#bdbdbd', accent: '#c6ff3d', accent2: '#ff3dc6', onAccent: '#0a0a0a', stickers: 'night' },
  sky: { bg: '#ffffff', surface: '#eef5ff', ink: '#0b1b33', muted: '#4a5a70', accent: '#2a5fe6', accent2: '#ffc53d', onAccent: '#ffffff', stickers: 'lagoon' },
  burgundy: { bg: '#fbf6ee', surface: '#ffffff', ink: '#3d0f1d', muted: '#6f4b55', accent: '#7a1f3d', accent2: '#e8b4a0', onAccent: '#ffffff', stickers: 'berry' },
  teal: { bg: '#0d2b2f', surface: '#133b40', ink: '#eafcfb', muted: '#a7cfcd', accent: '#3dd6c4', accent2: '#ffb703', onAccent: '#0d2b2f', stickers: 'lagoon' },
};

const r = (n) => Math.round(n);
const lin = (angle, a, b) => ({ type: 'linear', angle, stops: [{ offset: 0, color: a }, { offset: 1, color: b }] });

/** Text roles for a page: the same sizes and colors across every layout. */
function kitFor(W, H, p, pair) {
  const S = Math.min(W, H);
  const headingFont = fontByName(pair.heading);
  const hw = nearestWeight(pair.heading, 700);
  const bw = nearestWeight(pair.body, 400);
  const bb = nearestWeight(pair.body, 700);
  const lh = headingFont?.kind === 'Script' ? 1.25 : headingFont?.kind === 'Display' ? 1.02 : 1.1;
  const T = (text, props) => createText({ text, lineHeight: 1.3, ...props });
  return {
    W, H, S, p, pair, wide: W / H >= 1.25, tall: H / W >= 1.5,
    m: r(S * 0.085),
    kicker: (text, o) => T(text, { font: pair.body, weight: bb, size: r(S * 0.03), caps: true, letterSpacing: r(S * 0.005), color: p.accent, fit: { maxLines: 2, minSize: r(S * 0.018) }, ...o }),
    // Tall pages (stories, pins) have room for bigger headlines.
    title: (text, o = {}) => T(text, { font: pair.heading, weight: hw, lineHeight: lh, color: p.ink, fit: { maxLines: 3, minSize: r(S * 0.045) }, ...o, size: r((o.size || S * 0.13) * (H / W >= 1.5 ? 1.2 : 1)) }),
    sub: (text, o) => T(text, { font: pair.body, weight: bw, size: r(S * 0.044), color: p.muted, fit: { maxLines: 3, minSize: r(S * 0.026) }, ...o }),
    body: (text, o) => T(text, { font: pair.body, weight: bw, size: r(S * 0.034), lineHeight: 1.45, color: p.muted, fit: { maxLines: 8, minSize: r(S * 0.02) }, ...o }),
    info: (text, o) => T(text, { font: pair.body, weight: bb, size: r(S * 0.034), color: p.ink, fit: { maxLines: 2, minSize: r(S * 0.02) }, ...o }),
    cta: (text, o = {}) => {
      const size = r(S * 0.036);
      return T(text, { font: pair.body, weight: bb, size, lineHeight: 2, color: p.onAccent, highlight: { color: p.accent, padding: r(size * 0.7), radius: r(size) }, fit: { maxLines: 1, minSize: r(S * 0.022) }, ...o });
    },
    icon: (id, size, o) => createIcon(id, { w: r(size), h: r(size), color: p.accent, strokeWidth: 1.6, ...o }),
    rule: (w, o) => createLine({ w: r(w), h: r(S * 0.02), stroke: p.accent, strokeWidth: Math.max(2, r(S * 0.005)), ...o }),
    sticker: (design, o) => createSticker(`${design}-${p.stickers}`, o),
    shape: (shape, o) => createShape(shape, o),
  };
}

/** Put a run of elements into a flow, with the given gaps before each. */
function flow(name, items) {
  return items.filter(Boolean).map(([el, gap = 0]) => Object.assign(el, { flow: name, gap }));
}

/** Common stacked copy: kicker, title, rule, subtitle, call to action, info. */
function copyStack(k, c, { x, w, align = 'left', title = {}, rule = false, color } = {}) {
  const pill = (el) => {
    // A pill's background reaches past the text box on the left, so inset it.
    const pad = el.highlight.padding;
    return Object.assign(el, align === 'left' ? { x: x + pad, w: w - pad * 2 } : { x, w });
  };
  const ink = color ? { color } : {};
  const iconSize = k.S * (k.tall ? 0.11 : 0.08);
  return [
    c.icon && c.showIcon !== false && [k.icon(c.icon, iconSize, { x: align === 'center' ? r(x + (w - iconSize) / 2) : x, ...(color ? { color } : {}) })],
    c.kicker && [k.kicker(c.kicker, { x, w, align, ...(color ? { color } : {}) }), k.S * 0.03],
    [k.title(c.title, { x, w, align, ...ink, ...title }), k.S * 0.02],
    rule && [k.rule(k.S * 0.12, { x: align === 'center' ? r(x + (w - k.S * 0.12) / 2) : x, ...(color ? { stroke: color } : {}) }), k.S * 0.03],
    c.sub && [k.sub(c.sub, { x, w, align, ...(color ? { color } : {}) }), k.S * 0.03],
    c.cta && [pill(k.cta(c.cta, { align })), k.S * 0.05],
    c.info && [k.info(c.info, { x, w, align, ...ink }), k.S * 0.035],
  ];
}

// ---------- layouts ----------
// Each takes the kit (k) and content (c) and returns { background, elements, flows }.

export const LAYOUTS = {
  center(k, c) {
    const { W, H, S, m, p } = k;
    return {
      background: { type: 'color', color: p.bg },
      elements: [
        k.sticker(c.deco || 'blob', { x: r(-S * 0.16), y: r(-S * 0.16), w: r(S * 0.42), h: r(S * 0.42), opacity: 0.9 }),
        k.sticker(c.deco2 || 'dots', { x: r(W - S * 0.3), y: r(H - S * 0.3), w: r(S * 0.4), h: r(S * 0.4), opacity: 0.9 }),
        ...flow('main', copyStack(k, c, { x: m * 1.4, w: W - m * 2.8, align: 'center', rule: true })),
      ],
      flows: { main: { y: r(S * 0.13), h: r(H - S * 0.26), align: 'center' } },
    };
  },

  split(k, c) {
    const { W, H, S, m, p, wide } = k;
    const panel = wide ? { x: 0, y: 0, w: r(W * 0.42), h: H } : { x: 0, y: 0, w: W, h: r(H * 0.42) };
    const iconSize = Math.min(panel.w, panel.h) * 0.42;
    const text = wide ? { x: panel.w + m, w: W - panel.w - m * 2 } : { x: m, w: W - m * 2 };
    const region = wide ? { y: m, h: H - m * 2 } : { y: panel.h + m * 0.8, h: H - panel.h - m * 1.6 };
    return {
      background: { type: 'color', color: p.bg },
      elements: [
        k.shape('rect', { ...panel, fill: p.accent }),
        k.shape('ellipse', { x: r(panel.w / 2 - iconSize * 0.95), y: r(panel.h / 2 - iconSize * 0.95), w: r(iconSize * 1.9), h: r(iconSize * 1.9), fill: p.onAccent, opacity: 0.14 }),
        k.icon(c.icon || 'sparkle', iconSize, { x: r(panel.w / 2 - iconSize / 2), y: r(panel.h / 2 - iconSize / 2), color: p.onAccent, strokeWidth: 1.2 }),
        ...flow('main', copyStack(k, { ...c, showIcon: false }, { ...text, title: { size: r(S * 0.11) } })),
      ],
      flows: { main: { ...region, align: 'center' } },
    };
  },

  poster(k, c) {
    const { W, H, S, m, p } = k;
    const strip = r(Math.max(S * 0.2, H * 0.17));
    return {
      background: { type: 'color', color: p.accent },
      elements: [
        k.shape('ellipse', { x: r(W - S * 0.55), y: r(-S * 0.3), w: r(S * 0.8), h: r(S * 0.8), fill: p.onAccent, opacity: 0.12 }),
        k.icon(c.icon || 'sparkle', S * 0.16, { x: r(W - m - S * 0.16), y: m, color: p.onAccent, strokeWidth: 1.4 }),
        ...flow('main', [
          c.kicker && [k.kicker(c.kicker, { x: m, w: W - m * 2, color: p.onAccent })],
          [k.title(c.title, { x: m, w: W - m * 2, color: p.onAccent, size: r(S * 0.17), fit: { maxLines: 4, minSize: r(S * 0.05) } }), S * 0.02],
          c.sub && [k.sub(c.sub, { x: m, w: W - m * 2, color: p.onAccent }), S * 0.03],
        ]),
        k.shape('rect', { x: 0, y: H - strip, w: W, h: strip, fill: p.ink }),
        ...flow('foot', [
          c.info && [k.info(c.info || '', { x: m, w: W - m * 2, color: p.bg })],
          c.cta && [k.info(c.cta, { x: m, w: W - m * 2, color: p.bg, weight: 400 }), S * 0.012],
        ]),
      ],
      flows: {
        main: { y: r(m + S * 0.2), h: r(H - strip - m * 1.6 - S * 0.2), align: 'bottom' },
        foot: { y: H - strip + r(strip * 0.18), h: r(strip * 0.64), align: 'center' },
      },
    };
  },

  card(k, c) {
    const { W, H, S, m, p } = k;
    const card = { x: m, y: r(m * 1.2), w: W - m * 2, h: H - r(m * 2.4) };
    const pad = r(S * 0.07);
    return {
      background: { type: 'gradient', gradient: lin(135, p.accent, p.accent2) },
      elements: [
        k.sticker(c.deco || 'sparkle-trio', { x: r(W - S * 0.3), y: r(-S * 0.04), w: r(S * 0.3), h: r(S * 0.3) }),
        k.shape('rect', { ...card, radius: r(S * 0.04), fill: p.surface, shadow: { x: 0, y: r(S * 0.02), blur: r(S * 0.06), color: '#000000', opacity: 0.18 } }),
        ...flow('main', copyStack(k, c, { x: card.x + pad, w: card.w - pad * 2, align: 'center', rule: true, title: { size: r(S * 0.11) } })),
      ],
      flows: { main: { y: card.y + pad, h: card.h - pad * 2, align: 'center' } },
    };
  },

  frame(k, c) {
    const { W, H, S, m, p } = k;
    const o = r(m * 0.45);
    const i = r(m * 0.65);
    const pair = k.pair;
    return {
      background: { type: 'color', color: p.bg },
      elements: [
        k.shape('rect', { x: o, y: o, w: W - o * 2, h: H - o * 2, fill: null, stroke: p.accent, strokeWidth: Math.max(2, r(S * 0.006)) }),
        k.shape('rect', { x: i, y: i, w: W - i * 2, h: H - i * 2, fill: null, stroke: p.accent, strokeWidth: Math.max(1, r(S * 0.002)) }),
        ...flow('main', [
          c.kicker && [k.kicker(c.kicker, { x: m * 1.5, w: W - m * 3, align: 'center' })],
          [k.title(c.title, { x: m * 1.5, w: W - m * 3, align: 'center', font: c.script || pair.heading, weight: nearestWeight(c.script || pair.heading, 700), size: r(S * 0.12) }), S * 0.03],
          [k.sticker('divider-ornate', { x: r(W / 2 - S * 0.2), w: r(S * 0.4), h: r(S * 0.1) }), S * 0.03],
          c.sub && [k.sub(c.sub, { x: m * 1.5, w: W - m * 3, align: 'center', color: p.ink }), S * 0.03],
          c.info && [k.info(c.info, { x: m * 1.5, w: W - m * 3, align: 'center' }), S * 0.04],
          c.cta && [k.body(c.cta, { x: m * 1.5, w: W - m * 3, align: 'center', italic: false }), S * 0.025],
        ]),
      ],
      flows: { main: { y: m * 1.5, h: H - m * 3, align: 'center' } },
    };
  },

  corner(k, c) {
    const { W, H, S, m, p, wide } = k;
    const d = r(S * 0.9);
    const circle = { x: r(W - d * 0.72), y: r(-d * 0.28), w: d, h: d };
    const iconSize = S * 0.26;
    const text = wide ? { x: m, w: r(W * 0.55) - m } : { x: m, w: W - m * 2 };
    const region = wide ? { y: m, h: H - m * 2, align: 'center' } : { y: r(circle.y + d + S * 0.06), h: r(H - (circle.y + d + S * 0.06) - m), align: 'bottom' };
    return {
      background: { type: 'color', color: p.bg },
      elements: [
        k.shape('ellipse', { ...circle, fill: p.accent }),
        k.icon(c.icon || 'sparkle', iconSize, { x: r(circle.x + d * 0.36 - iconSize / 2), y: r(circle.y + d * 0.64 - iconSize / 2), color: p.onAccent, strokeWidth: 1.3 }),
        k.sticker(c.deco || 'sparkle-trio', { x: r(m * 0.6), y: r(m * 0.6), w: r(S * 0.16), h: r(S * 0.16) }),
        ...flow('main', copyStack(k, { ...c, showIcon: false }, { ...text })),
      ],
      flows: { main: region },
    };
  },

  marker(k, c) {
    const { W, H, S, m, p, wide } = k;
    const size = r(S * (wide ? 0.17 : 0.12));
    const pad = r(size * 0.22);
    const tw = wide ? r(W * 0.64) : W - m * 2;
    return {
      background: { type: 'color', color: p.bg },
      elements: [
        k.sticker(c.deco || 'arrow-curve', { x: r(W - m - S * 0.22), y: r(m * 0.7), w: r(S * 0.22), h: r(S * 0.22) }),
        ...flow('main', [
          c.kicker && [k.kicker(c.kicker, { x: m, w: W - m * 2, color: p.ink })],
          [k.title(c.title, { x: m + pad, w: tw - pad * 2, size, lineHeight: 1.3, color: p.onAccent, highlight: { color: p.accent, padding: pad, radius: r(size * 0.12) }, fit: { maxLines: 4, minSize: r(S * 0.045) } }), S * 0.03],
          c.sub && [k.sub(c.sub, { x: m, w: W - m * 2 }), S * 0.03],
          c.cta && [k.info(c.cta, { x: m, w: W - m * 2, color: p.accent }), S * 0.04],
        ]),
        ...flow('foot', [c.info && [k.info(c.info, { x: m, w: W - m * 2, weight: nearestWeight(k.pair.body, 400), color: p.muted })]]),
      ],
      flows: {
        main: wide ? { y: m, h: r(H - m * 2 - S * 0.1), align: 'center' } : { y: r(m + S * 0.22), h: r(H - m * 2 - S * 0.36), align: 'center' },
        foot: { y: r(H - m - S * 0.1), h: r(S * 0.1), align: 'bottom' },
      },
    };
  },

  list(k, c) {
    const { W, H, S, m, p } = k;
    const items = c.items || [];
    return {
      background: { type: 'color', color: c.boxed ? p.surface : p.bg },
      elements: [
        k.shape('rect', { x: 0, y: 0, w: r(S * 0.025), h: H, fill: p.accent }),
        k.sticker(c.deco || 'dots', { x: r(W - S * 0.28), y: r(-S * 0.08), w: r(S * 0.36), h: r(S * 0.36), opacity: 0.9 }),
        ...flow('main', [
          c.kicker && [k.kicker(c.kicker, { x: m, w: W - m * 2.4 })],
          [k.title(c.title, { x: m, w: W - m * 2.4, size: r(S * 0.095), fit: { maxLines: 3, minSize: r(S * 0.045) } }), S * 0.02],
          c.sub && [k.sub(c.sub, { x: m, w: W - m * 2 }), S * 0.02],
          [k.rule(S * 0.1, { x: m }), S * 0.035],
          [k.body(items.join('\n'), { x: m, w: W - m * 2, size: r(S * 0.042), lineHeight: 1.65, color: p.ink, list: c.numbered === false ? 'bullet' : 'number', fit: { maxLines: items.length * 2, minSize: r(S * 0.022) } }), S * 0.035],
          c.cta && [k.info(c.cta, { x: m, w: W - m * 2, color: p.accent }), S * 0.045],
        ]),
      ],
      flows: { main: { y: m, h: H - m * 2, align: 'center' } },
    };
  },

  quote(k, c) {
    const { W, H, S, m, p } = k;
    return {
      background: { type: 'color', color: c.dark ? p.ink : p.bg },
      elements: [
        k.sticker(c.deco || 'leaves', { x: r(-S * 0.1), y: r(H - S * 0.3), w: r(S * 0.4), h: r(S * 0.4), opacity: 0.9 }),
        ...flow('main', [
          [k.icon('quote', S * 0.13, { x: r(W / 2 - S * 0.065), strokeWidth: 2 })],
          [k.title(c.title, { x: m * 1.3, w: W - m * 2.6, align: 'center', size: r(S * 0.075), lineHeight: 1.3, color: c.dark ? p.bg : p.ink, fit: { maxLines: 7, minSize: r(S * 0.035) } }), S * 0.04],
          [k.rule(S * 0.1, { x: r(W / 2 - S * 0.05) }), S * 0.04],
          c.kicker && [k.kicker(c.kicker, { x: m, w: W - m * 2, align: 'center' }), S * 0.035],
          c.sub && [k.sub(c.sub, { x: m, w: W - m * 2, align: 'center', size: r(S * 0.032), color: c.dark ? p.bg : p.muted }), S * 0.012],
        ]),
      ],
      flows: { main: { y: m * 1.2, h: H - m * 2.4, align: 'center' } },
    };
  },

  stats(k, c) {
    const { W, H, S, m, p } = k;
    const stats = c.stats || [];
    const row = (n, label, i) => [
      [k.title(n, { x: m, w: W - m * 2, color: p.accent, size: r(S * 0.12), fit: { maxLines: 1, minSize: r(S * 0.05) } }), i ? S * 0.045 : S * 0.05],
      [k.sub(label, { x: m, w: W - m * 2, color: p.ink, fit: { maxLines: 2, minSize: r(S * 0.022) } }), S * 0.004],
    ];
    return {
      background: { type: 'color', color: p.bg },
      elements: [
        k.shape('rect', { x: r(W - S * 0.06), y: 0, w: r(S * 0.06), h: H, fill: p.accent }),
        ...flow('main', [
          c.kicker && [k.kicker(c.kicker, { x: m, w: W - m * 2 })],
          [k.title(c.title, { x: m, w: W - m * 2.4, size: r(S * 0.08), fit: { maxLines: 3, minSize: r(S * 0.04) } }), S * 0.02],
          ...stats.flatMap(([n, label], i) => row(n, label, i)),
          c.info && [k.info(c.info, { x: m, w: W - m * 2, color: p.muted, weight: nearestWeight(k.pair.body, 400) }), S * 0.06],
        ]),
      ],
      flows: { main: { y: m, h: H - m * 2, align: 'center' } },
    };
  },

  minimal(k, c) {
    const { W, H, S, m, p } = k;
    return {
      background: { type: 'color', color: p.bg },
      elements: [
        k.shape('rect', { x: r(W - m - S * 0.06), y: m, w: r(S * 0.06), h: r(S * 0.06), fill: p.accent }),
        ...flow('top', [c.kicker && [k.kicker(c.kicker, { x: m, w: W - m * 3, color: p.ink })]]),
        ...flow('main', [
          [k.title(c.title, { x: m, w: W - m * 2, size: r(S * 0.14), fit: { maxLines: 4, minSize: r(S * 0.05) } })],
          [k.rule(S * 0.16, { x: m }), S * 0.04],
          c.sub && [k.sub(c.sub, { x: m, w: W - m * 2 }), S * 0.035],
          c.cta && [k.info(c.cta, { x: m, w: W - m * 2, color: p.accent }), S * 0.04],
        ]),
        ...flow('bottom', [c.info && [k.info(c.info, { x: m, w: W - m * 2, color: p.muted, weight: nearestWeight(k.pair.body, 400) })]]),
      ],
      flows: {
        top: { y: m, h: r(S * 0.08), align: 'top' },
        main: { y: r(m + S * 0.14), h: r(H - m * 2 - S * 0.28), align: 'center' },
        bottom: { y: r(H - m - S * 0.1), h: r(S * 0.1), align: 'bottom' },
      },
    };
  },

  badge(k, c) {
    const { W, H, S, m, p, wide } = k;
    const d = r(S * (wide ? 0.62 : 0.5));
    const badge = wide ? { x: r(W - m - d), y: r((H - d) / 2) } : { x: r(W - m * 0.6 - d), y: r(H * 0.44) };
    const textW = wide ? W - m * 2.5 - d : W - m * 2;
    const footW = wide ? textW : W - m * 1.6 - d;
    return {
      background: { type: 'color', color: p.bg },
      elements: [
        k.shape('star', { ...badge, w: d, h: d, sides: 14, innerRatio: 0.84, fill: p.accent, rotation: 8 }),
        k.title(c.offer || 'SALE', { x: r(badge.x + d * 0.17), y: r(badge.y + d * 0.3), w: r(d * 0.66), h: r(d * 0.4), align: 'center', color: p.onAccent, size: r(d * 0.2), rotation: 8, lineHeight: 1, fit: { maxLines: 2, minSize: r(d * 0.08) } }),
        ...flow('main', [
          c.kicker && [k.kicker(c.kicker, { x: m, w: textW })],
          [k.title(c.title, { x: m, w: textW, size: r(S * 0.13), fit: { maxLines: 3, minSize: r(S * 0.05) } }), S * 0.02],
          c.sub && [k.sub(c.sub, { x: m, w: textW }), S * 0.025],
        ]),
        ...flow('foot', [
          c.cta && [Object.assign(k.cta(c.cta), { x: m + r(S * 0.036 * 0.9), w: footW - r(S * 0.036 * 1.8) })],
          c.info && [k.info(c.info, { x: m, w: footW, color: p.muted, weight: nearestWeight(k.pair.body, 400) }), S * 0.03],
        ]),
      ],
      flows: wide
        ? { main: { y: m, h: r(H * 0.6) - m, align: 'center' }, foot: { y: r(H * 0.62), h: r(H * 0.38) - m, align: 'center' } }
        : { main: { y: m, h: r(H * 0.42) - m, align: 'center' }, foot: { y: r(badge.y + S * 0.08), h: r(H - badge.y - S * 0.08 - m), align: 'bottom' } },
    };
  },

  // ---------- special formats ----------

  /** Wide, short banners: three looks, picked by the content's variant. */
  banner(k, c) {
    const { W, H, S, m, p } = k;
    const look = (c.variant || 0) % 3;
    const onColor = look === 1;
    const ink = onColor ? p.onAccent : p.ink;
    const textW = look === 1 ? W - m * 6 : r(W * (look === 2 ? 0.5 : 0.6));
    const x = look === 1 ? m * 3 : look === 2 ? m * 1.6 : m;
    const align = look === 1 ? 'center' : 'left';
    const d = r(H * 1.1);
    const deco = [
      [
        k.shape('ellipse', { x: r(W - d * 0.85), y: r((H - d) / 2), w: d, h: d, fill: p.accent }),
        k.icon(c.icon || 'sparkle', H * 0.36, { x: r(W - d * 0.85 + d * 0.38 - H * 0.18), y: r(H / 2 - H * 0.18), color: p.onAccent, strokeWidth: 1.4 }),
        k.sticker(c.deco || 'sparkle-trio', { x: r(W - d * 0.95 - H * 0.2), y: r(H * 0.08), w: r(H * 0.28), h: r(H * 0.28) }),
      ],
      [
        k.sticker(c.deco || 'blob', { x: r(-H * 0.3), y: r(-H * 0.3), w: r(H * 0.9), h: r(H * 0.9), opacity: 0.9 }),
        k.sticker(c.deco2 || 'dots', { x: r(W - H * 0.6), y: r(H * 0.4), w: r(H * 0.8), h: r(H * 0.8), opacity: 0.9 }),
      ],
      [
        k.shape('rect', { x: 0, y: 0, w: r(m * 0.5), h: H, fill: p.accent }),
        k.shape('ellipse', { x: r(W - H * 1.3), y: r(H * 0.15), w: r(H * 0.7), h: r(H * 0.7), fill: p.accent2 }),
        k.shape('rect', { x: r(W - H * 0.85), y: r(-H * 0.1), w: r(H * 0.6), h: r(H * 0.6), fill: p.accent, rotation: 12 }),
        k.icon(c.icon || 'sparkle', H * 0.3, { x: r(W - H * 0.7), y: r(H * 0.55), color: p.ink, strokeWidth: 1.6 }),
      ],
    ][look];
    return {
      background: { type: 'color', color: onColor ? p.accent : p.bg },
      elements: [
        ...deco,
        ...flow('main', [
          c.kicker && [k.kicker(c.kicker, { x, w: textW, align, size: r(H * 0.05), color: onColor ? ink : p.accent })],
          [k.title(c.title, { x, w: textW, align, color: ink, size: r(H * 0.2), fit: { maxLines: 2, minSize: r(H * 0.09) } }), H * 0.03],
          c.sub && [k.sub(c.sub, { x, w: textW, align, color: onColor ? ink : p.muted, size: r(H * 0.065), fit: { maxLines: 2, minSize: r(H * 0.04) } }), H * 0.035],
          c.cta && [k.info(c.cta, { x, w: textW, align, color: onColor ? ink : p.accent, size: r(H * 0.06) }), H * 0.045],
        ]),
      ],
      flows: { main: { y: r(H * 0.1), h: r(H * 0.8), align: 'center' } },
    };
  },

  bizcard(k, c) {
    const { W, H, S, m, p } = k;
    const side = r(W * 0.36);
    return {
      background: { type: 'color', color: p.bg },
      elements: [
        k.shape('rect', { x: 0, y: 0, w: side, h: H, fill: p.accent }),
        k.icon(c.icon || 'sparkle', S * 0.3, { x: r(side / 2 - S * 0.15), y: r(H / 2 - S * 0.15), color: p.onAccent, strokeWidth: 1.4 }),
        ...flow('main', [
          [k.title(c.title, { x: side + m, w: W - side - m * 2, size: r(S * 0.11), fit: { maxLines: 2, minSize: r(S * 0.05) } })],
          c.kicker && [k.kicker(c.kicker, { x: side + m, w: W - side - m * 2, size: r(S * 0.045) }), S * 0.02],
          [k.rule(S * 0.12, { x: side + m }), S * 0.04],
          c.info && [k.body(c.info, { x: side + m, w: W - side - m * 2, size: r(S * 0.05), color: p.ink, lineHeight: 1.5, fit: { maxLines: 4, minSize: r(S * 0.03) } }), S * 0.03],
        ]),
      ],
      flows: { main: { y: m, h: H - m * 2, align: 'center' } },
    };
  },

  bizcardCenter(k, c) {
    const { W, H, S, m, p } = k;
    return {
      background: { type: 'color', color: p.bg },
      elements: [
        k.shape('rect', { x: 0, y: H - r(S * 0.05), w: W, h: r(S * 0.05), fill: p.accent }),
        ...flow('main', [
          [k.icon(c.icon || 'sparkle', S * 0.16, { x: r(W / 2 - S * 0.08) })],
          [k.title(c.title, { x: m, w: W - m * 2, align: 'center', size: r(S * 0.11), fit: { maxLines: 2, minSize: r(S * 0.05) } }), S * 0.04],
          c.kicker && [k.kicker(c.kicker, { x: m, w: W - m * 2, align: 'center', size: r(S * 0.042) }), S * 0.02],
          c.info && [k.body(c.info.replace(/\n/g, '  ·  '), { x: m, w: W - m * 2, align: 'center', size: r(S * 0.042), color: p.muted, fit: { maxLines: 3, minSize: r(S * 0.028) } }), S * 0.05],
        ]),
      ],
      flows: { main: { y: m, h: H - m * 2 - r(S * 0.05), align: 'center' } },
    };
  },

  bizcardBold(k, c) {
    const { W, H, S, m, p } = k;
    return {
      background: { type: 'color', color: p.accent },
      elements: [
        k.shape('ellipse', { x: r(W - S * 0.7), y: r(H - S * 0.6), w: r(S * 1.1), h: r(S * 1.1), fill: p.onAccent, opacity: 0.12 }),
        ...flow('main', [
          [k.title(c.title, { x: m, w: W - m * 2, color: p.onAccent, size: r(S * 0.13), fit: { maxLines: 2, minSize: r(S * 0.05) } })],
          c.kicker && [k.kicker(c.kicker, { x: m, w: W - m * 2, color: p.onAccent, size: r(S * 0.045) }), S * 0.02],
        ]),
        ...flow('foot', [c.info && [k.body(c.info, { x: m, w: W - m * 2, size: r(S * 0.045), color: p.onAccent, lineHeight: 1.45, fit: { maxLines: 4, minSize: r(S * 0.028) } })]]),
      ],
      flows: { main: { y: m, h: r(H * 0.45) - m, align: 'top' }, foot: { y: r(H * 0.5), h: r(H * 0.5) - m, align: 'bottom' } },
    };
  },

  logo(k, c) {
    const { W, H, S, m, p } = k;
    const d = r(S * 0.46);
    return {
      background: { type: 'color', color: p.bg },
      elements: [
        ...flow('main', [
          [k.shape('ellipse', { x: r(W / 2 - d / 2), w: d, h: d, fill: p.accent })],
          [k.title(c.title, { x: m, w: W - m * 2, align: 'center', size: r(S * 0.12), fit: { maxLines: 2, minSize: r(S * 0.06) } }), S * 0.05],
          c.kicker && [k.kicker(c.kicker, { x: m, w: W - m * 2, align: 'center', size: r(S * 0.04), color: p.muted }), S * 0.02],
        ]),
      ],
      flows: { main: { y: m, h: H - m * 2, align: 'center' } },
      after: (els) => {
        // The icon sits on the circle, wherever the flow put it.
        const circle = els[0];
        els.push(k.icon(c.icon || 'sparkle', d * 0.5, { x: r(circle.x + d * 0.25), y: r(circle.y + d * 0.25), color: p.onAccent, strokeWidth: 1.5 }));
      },
    };
  },

  logoWord(k, c) {
    const { W, H, S, m, p } = k;
    return {
      background: { type: 'color', color: p.accent },
      elements: [
        ...flow('main', [
          [k.icon(c.icon || 'sparkle', S * 0.2, { x: r(W / 2 - S * 0.1), color: p.onAccent, strokeWidth: 1.6 })],
          [k.title(c.title, { x: m, w: W - m * 2, align: 'center', color: p.onAccent, size: r(S * 0.15), fit: { maxLines: 2, minSize: r(S * 0.06) } }), S * 0.04],
          c.kicker && [k.kicker(c.kicker, { x: m, w: W - m * 2, align: 'center', size: r(S * 0.04), color: p.onAccent, letterSpacing: r(S * 0.012) }), S * 0.025],
        ]),
      ],
      flows: { main: { y: m, h: H - m * 2, align: 'center' } },
    };
  },

  logoBadge(k, c) {
    const { W, H, S, p } = k;
    const o = r(S * 0.08);
    return {
      background: { type: 'color', color: p.bg },
      elements: [
        k.shape('ellipse', { x: o, y: o, w: W - o * 2, h: H - o * 2, fill: p.surface, stroke: p.accent, strokeWidth: r(S * 0.016) }),
        k.shape('ellipse', { x: r(o * 1.7), y: r(o * 1.7), w: r(W - o * 3.4), h: r(H - o * 3.4), fill: null, stroke: p.accent, strokeWidth: r(S * 0.005) }),
        ...flow('main', [
          [k.icon(c.icon || 'sparkle', S * 0.18, { x: r(W / 2 - S * 0.09) })],
          [k.title(c.title, { x: r(S * 0.24), w: r(W - S * 0.48), align: 'center', size: r(S * 0.1), fit: { maxLines: 2, minSize: r(S * 0.05) } }), S * 0.03],
          c.kicker && [k.kicker(c.kicker, { x: r(S * 0.26), w: r(W - S * 0.52), align: 'center', size: r(S * 0.034) }), S * 0.02],
        ]),
      ],
      flows: { main: { y: r(S * 0.22), h: r(H - S * 0.44), align: 'center' } },
    };
  },

  menu(k, c) {
    const { W, H, S, m, p } = k;
    const rows = (c.items || []).map((line) => line.split(' | '));
    const tw = W - m * 3;
    return {
      background: { type: 'color', color: p.bg },
      elements: [
        k.shape('rect', { x: r(m * 0.45), y: r(m * 0.45), w: W - r(m * 0.9), h: H - r(m * 0.9), fill: null, stroke: p.accent, strokeWidth: Math.max(2, r(S * 0.004)) }),
        ...flow('main', [
          c.kicker && [k.kicker(c.kicker, { x: m * 1.5, w: tw, align: 'center' })],
          [k.title(c.title, { x: m * 1.5, w: tw, align: 'center', size: r(S * 0.12) }), S * 0.02],
          [k.sticker('divider-ornate', { x: r(W / 2 - S * 0.18), w: r(S * 0.36), h: r(S * 0.09) }), S * 0.02],
          [createTable({ x: m * 1.5, w: tw, h: r(rows.length * S * 0.075), rows, header: false, stripes: false, font: k.pair.body, size: r(S * 0.032), color: p.ink, lineColor: p.accent2, stripeFill: p.surface, headerFill: p.accent, headerColor: p.onAccent }), S * 0.05],
          c.info && [k.info(c.info, { x: m * 1.5, w: tw, align: 'center', color: p.muted, weight: nearestWeight(k.pair.body, 400) }), S * 0.05],
        ]),
      ],
      flows: { main: { y: m * 1.3, h: H - m * 2.6, align: 'center' } },
    };
  },

  calendar(k, c) {
    const { W, H, S, m, p } = k;
    const [year, month] = c.month || [2027, 0];
    const first = new Date(Date.UTC(year, month, 1)).getUTCDay();
    const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const rows = [['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']];
    let week = Array(first).fill('');
    for (let d = 1; d <= days; d++) {
      week.push(String(d));
      if (week.length === 7) {
        rows.push(week);
        week = [];
      }
    }
    if (week.length) rows.push([...week, ...Array(7 - week.length).fill('')]);
    const tw = W - m * 2;
    return {
      background: { type: 'color', color: p.bg },
      elements: [
        k.sticker(c.deco || 'leaves', { x: r(W - S * 0.36), y: r(-S * 0.06), w: r(S * 0.4), h: r(S * 0.4), opacity: 0.9 }),
        ...flow('main', [
          [k.kicker(String(year), { x: m, w: tw })],
          [k.title(c.title, { x: m, w: W - m * 2 - S * 0.3, size: r(S * 0.14), fit: { maxLines: 1, minSize: r(S * 0.06) } }), S * 0.01],
          c.sub && [k.sub(c.sub, { x: m, w: tw }), S * 0.015],
          [createTable({ x: m, w: tw, h: r(Math.min(H * 0.6, tw * 0.95) * (rows.length / 7)), rows, header: true, stripes: true, font: k.pair.body, size: r(S * 0.032), color: p.ink, headerFill: p.accent, headerColor: p.onAccent, stripeFill: p.surface, lineColor: p.accent2, align: 'center' }), S * 0.05],
        ]),
      ],
      flows: { main: { y: m, h: H - m * 2, align: 'center' } },
    };
  },

  resume(k, c) {
    const { W, H, S, m, p } = k;
    const side = r(W * 0.34);
    const sm = r(m * 0.7);
    const sections = c.sections || [];
    return {
      background: { type: 'color', color: p.bg },
      elements: [
        k.shape('rect', { x: 0, y: 0, w: side, h: H, fill: p.surface }),
        ...flow('side', [
          [k.shape('ellipse', { x: r(side / 2 - S * 0.09), w: r(S * 0.18), h: r(S * 0.18), fill: p.accent })],
          [k.kicker('Contact', { x: sm, w: side - sm * 2 }), S * 0.06],
          [k.body(c.info || '', { x: sm, w: side - sm * 2, color: p.ink, size: r(S * 0.022), lineHeight: 1.6, fit: { maxLines: 8, minSize: r(S * 0.014) } }), S * 0.015],
          [k.kicker('Skills', { x: sm, w: side - sm * 2 }), S * 0.05],
          [k.body((c.items || []).join('\n'), { x: sm, w: side - sm * 2, color: p.ink, size: r(S * 0.022), lineHeight: 1.7, list: 'bullet', fit: { maxLines: 14, minSize: r(S * 0.014) } }), S * 0.015],
        ]),
        ...flow('main', [
          [k.title(c.title, { x: side + sm, w: W - side - sm * 2, size: r(S * 0.06), fit: { maxLines: 2, minSize: r(S * 0.035) } })],
          c.kicker && [k.kicker(c.kicker, { x: side + sm, w: W - side - sm * 2, size: r(S * 0.024) }), S * 0.012],
          c.sub && [k.body(c.sub, { x: side + sm, w: W - side - sm * 2, size: r(S * 0.022), color: p.ink }), S * 0.03],
          ...sections.flatMap(([head, text]) => [
            [k.kicker(head, { x: side + sm, w: W - side - sm * 2, color: p.ink, size: r(S * 0.024) }), S * 0.045],
            [k.rule(W - side - sm * 2, { x: side + sm, strokeWidth: Math.max(1, r(S * 0.0015)), h: r(S * 0.012) }), S * 0.008],
            [k.body(text, { x: side + sm, w: W - side - sm * 2, size: r(S * 0.021), lineHeight: 1.55, fit: { maxLines: 12, minSize: r(S * 0.015) } }), S * 0.01],
          ]),
        ]),
      ],
      flows: { side: { y: sm, h: H - sm * 2, align: 'top' }, main: { y: sm * 1.2, h: H - sm * 2.4, align: 'top' } },
      after: (els) => {
        const avatar = els.find((el) => el.type === 'shape' && el.shape === 'ellipse');
        els.push(k.icon('user', S * 0.1, { x: r(avatar.x + S * 0.04), y: r(avatar.y + S * 0.04), color: p.onAccent }));
      },
    };
  },
};

/** One page from a layout. */
export function makePage(layoutName, { W, H, palette, pair, content }) {
  const k = kitFor(W, H, palette, pair);
  const page = LAYOUTS[layoutName](k, content);
  return page;
}
