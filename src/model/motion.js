// Motion: how elements come in (animations), how long each page shows and
// how one page gives way to the next (transitions). Pure: given a time, it
// says where everything is, so playing, presenting and every download
// (GIF, video) show exactly the same thing.

/** Animations an element can come in with. `loop` ones keep moving after. */
export const ANIMATIONS = {
  none: { name: 'None' },
  fade: { name: 'Fade' },
  rise: { name: 'Rise' },
  drop: { name: 'Drop' },
  pan: { name: 'Pan' },
  pop: { name: 'Pop' },
  wipe: { name: 'Wipe' },
  typewriter: { name: 'Typewriter' },
  tumble: { name: 'Tumble' },
  breathe: { name: 'Breathe', loop: true },
};

/** How one page gives way to the next. */
export const TRANSITIONS = {
  none: { name: 'None' },
  fade: { name: 'Fade' },
  slide: { name: 'Slide' },
  push: { name: 'Push' },
  zoom: { name: 'Zoom' },
};

export const DEFAULT_PAGE_DURATION = 5; // seconds
export const DEFAULT_ANIM_DURATION = 0.8;
export const DEFAULT_STAGGER = 0.15;
export const DEFAULT_TRANSITION_DURATION = 0.6;

const clamp01 = (v) => Math.max(0, Math.min(1, v));
/** Fast start, gentle landing. */
const easeOut = (t) => 1 - (1 - t) ** 3;
/** A little past the end, then back: for pops. */
const easeBack = (t) => {
  const c = 1.7;
  return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
};

/** How long a page shows, in seconds. */
export function pageDuration(page) {
  const d = Number(page?.duration);
  return Number.isFinite(d) && d > 0 ? Math.min(d, 60) : DEFAULT_PAGE_DURATION;
}

/** The transition into a page: { type, duration } (type 'none' for a cut). */
export function transitionOf(page) {
  const t = page?.transition;
  if (!t || !TRANSITIONS[t.type] || t.type === 'none') return { type: 'none', duration: 0 };
  // Never longer than half the page's time, so it always finishes on the page.
  const d = Number(t.duration);
  return { type: t.type, duration: Math.min(Number.isFinite(d) && d > 0 ? d : DEFAULT_TRANSITION_DURATION, pageDuration(page) / 2) };
}

/**
 * The order elements come in when the whole page is animated: top to
 * bottom, then left to right, as you'd read it.
 */
export function readingOrder(page) {
  const els = page.elements.filter((el) => !el.hidden);
  return [...els].sort((a, b) => (Math.abs(a.y - b.y) > 8 ? a.y - b.y : a.x - b.x)).map((el) => el.id);
}

/**
 * An element's animation on its page: its own, else the page's (each element
 * a little after the one before, in reading order). Null when it doesn't move.
 */
export function animationOf(page, el, order = readingOrder(page)) {
  const own = el.anim && ANIMATIONS[el.anim.type] && el.anim.type !== 'none' ? el.anim : null;
  const pageAnim = page.anim && ANIMATIONS[page.anim.type] && page.anim.type !== 'none' ? page.anim : null;
  const anim = own || pageAnim;
  if (!anim) return null;
  const duration = clampNum(anim.duration, 0.1, 10, DEFAULT_ANIM_DURATION);
  const at = Math.max(0, order.indexOf(el.id));
  const delay = own ? clampNum(own.delay, 0, 30, 0) : at * clampNum(pageAnim.stagger, 0, 2, DEFAULT_STAGGER);
  return { type: anim.type, duration, delay };
}

function clampNum(v, lo, hi, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback;
}

/**
 * Where an animated element is at time t (seconds since its page began):
 * { opacity, dx, dy, scale, rotate, reveal, typed }. `reveal` (0..1) is how
 * much of it a wipe shows; `typed` (0..1) how much of its text is typed.
 * `size` is the page's shorter side, so movements look the same at any size.
 */
export function motionAt(anim, t, size = 1000) {
  const still = { opacity: 1, dx: 0, dy: 0, scale: 1, rotate: 0, reveal: 1, typed: 1 };
  if (!anim) return still;
  const raw = clamp01((t - anim.delay) / anim.duration);
  const p = easeOut(raw);
  const far = size * 0.08;
  const s = { ...still };
  switch (anim.type) {
    case 'fade':
      s.opacity = p;
      break;
    case 'rise':
      s.opacity = p;
      s.dy = (1 - p) * far;
      break;
    case 'drop':
      s.opacity = p;
      s.dy = -(1 - p) * far;
      break;
    case 'pan':
      s.opacity = p;
      s.dx = -(1 - p) * far * 1.5;
      break;
    case 'pop':
      s.opacity = clamp01(raw * 3);
      s.scale = raw === 0 ? 0.001 : Math.max(0.001, easeBack(raw));
      break;
    case 'wipe':
      s.reveal = p;
      break;
    case 'typewriter':
      // Letters appear at an even pace: no easing.
      s.typed = raw;
      s.opacity = raw > 0 ? 1 : 0;
      break;
    case 'tumble':
      s.opacity = p;
      s.rotate = -(1 - p) * 30;
      s.scale = 0.6 + 0.4 * p;
      break;
    case 'breathe': {
      // Comes in with a fade, then keeps gently growing and shrinking.
      s.opacity = p;
      const since = Math.max(0, t - anim.delay);
      s.scale = 1 + 0.04 * Math.sin((since / 2) * Math.PI * 2);
      break;
    }
    default:
      break;
  }
  return s;
}

/** When a page's animations are all done (loops aside), in seconds. */
export function animationsEnd(page) {
  const order = readingOrder(page);
  let end = 0;
  for (const el of page.elements) {
    const a = animationOf(page, el, order);
    if (a) end = Math.max(end, a.delay + a.duration);
  }
  return end;
}

/** Whether anything on a page moves. */
export function pageMoves(page) {
  return page.elements.some((el) => animationOf(page, el)) || transitionOf(page).type !== 'none';
}

/** Whether anything in a design moves (so a GIF or video is worth making). */
export function designMoves(doc, pages = doc.pages.map((_, i) => i)) {
  return pages.some((i) => pageMoves(doc.pages[i]));
}

/**
 * The design played from start to end: each shown page, when it starts and
 * how long it lasts. `pages` are page indexes (visible ones, by default).
 */
export function timeline(doc, pages = doc.pages.map((p, i) => (p.hidden ? -1 : i)).filter((i) => i >= 0)) {
  let at = 0;
  const parts = pages.map((index) => {
    const duration = pageDuration(doc.pages[index]);
    const part = { index, start: at, duration };
    at += duration;
    return part;
  });
  return { parts, total: at };
}

/**
 * What to show at time t of a timeline: the page (and the time on it), and
 * during a transition the page before too, with how far the transition is.
 * { index, local, from: { index, local } | null, transition: { type, progress } | null }
 */
export function frameAt(doc, tl, t) {
  if (!tl.parts.length) return null;
  const clamped = Math.max(0, Math.min(t, tl.total - 1e-6));
  let i = tl.parts.findIndex((p) => clamped < p.start + p.duration);
  if (i < 0) i = tl.parts.length - 1;
  const part = tl.parts[i];
  const local = clamped - part.start;
  const tr = transitionOf(doc.pages[part.index]);
  if (i > 0 && tr.type !== 'none' && local < tr.duration) {
    const prev = tl.parts[i - 1];
    return { index: part.index, local, from: { index: prev.index, local: prev.duration }, transition: { type: tr.type, progress: easeOut(clamp01(local / tr.duration)) } };
  }
  return { index: part.index, local, from: null, transition: null };
}

/**
 * How the two pages of a transition are placed at `progress` (0..1):
 * { from: { opacity, dx, scale }, to: { opacity, dx, scale } }, dx as a share
 * of the page width.
 */
export function transitionAt(type, progress) {
  const p = clamp01(progress);
  const plain = { opacity: 1, dx: 0, scale: 1 };
  switch (type) {
    case 'fade':
      return { from: plain, to: { ...plain, opacity: p } };
    case 'slide':
      return { from: plain, to: { ...plain, dx: 1 - p } };
    case 'push':
      return { from: { ...plain, dx: -p }, to: { ...plain, dx: 1 - p } };
    case 'zoom':
      return { from: { ...plain, opacity: 1 - p }, to: { ...plain, opacity: p, scale: 0.85 + 0.15 * p } };
    default:
      return { from: { ...plain, opacity: 0 }, to: plain };
  }
}
