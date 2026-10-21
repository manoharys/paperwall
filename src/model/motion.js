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

/** What a whole page can come in with: the animations that don't loop (it'd never be still). */
export const PAGE_ANIMATIONS = Object.fromEntries(Object.entries(ANIMATIONS).filter(([, a]) => !a.loop));

/** How one page gives way to the next. */
export const TRANSITIONS = {
  none: { name: 'None' },
  fade: { name: 'Fade' },
  slide: { name: 'Slide' },
  push: { name: 'Push' },
  zoom: { name: 'Zoom' },
};

export const DEFAULT_PAGE_DURATION = 5; // seconds
/** The allowed range of each setting, in seconds (files are held to these too). */
export const LIMITS = { duration: [0.1, 10], delay: [0, 30], stagger: [0, 2], transition: [0.1, 5], page: [0.5, 60] };
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
  return clampNum(page?.duration, ...LIMITS.page, DEFAULT_PAGE_DURATION);
}

/** The transition into a page: { type, duration } (type 'none' for a cut). */
export function transitionOf(page) {
  const t = page?.transition;
  if (!t || !Object.hasOwn(TRANSITIONS, t.type) || t.type === 'none') return { type: 'none', duration: 0 };
  // Never longer than half the page's time, so it always finishes on the page.
  return { type: t.type, duration: Math.min(clampNum(t.duration, ...LIMITS.transition, DEFAULT_TRANSITION_DURATION), pageDuration(page) / 2) };
}

/**
 * The order elements come in when the whole page is animated: top to
 * bottom, then left to right, as you'd read it.
 */
export function readingOrder(page) {
  // Rows first (an element within 8 px of the row's top joins it), then each
  // row left to right: the same order whatever the layers' order.
  const els = page.elements.filter((el) => !el.hidden).sort((a, b) => a.y - b.y || a.x - b.x);
  const rows = [];
  for (const el of els) {
    const row = rows[rows.length - 1];
    if (row && el.y - row.top <= 8) row.els.push(el);
    else rows.push({ top: el.y, els: [el] });
  }
  return rows.flatMap((r) => r.els.sort((a, b) => a.x - b.x || a.y - b.y)).map((el) => el.id);
}

/**
 * An element's animation on its page: its own, else the page's (each element
 * a little after the one before, in reading order). Null when it doesn't move.
 */
export function animationOf(page, el, order = readingOrder(page), { nested = false } = {}) {
  const known = (a) => a && Object.hasOwn(ANIMATIONS, a.type) && a.type !== 'none';
  const own = known(el.anim) ? el.anim : null;
  // Inside a group, only an element's own animation (the group comes in as one).
  const pageAnim = !nested && known(page.anim) && Object.hasOwn(PAGE_ANIMATIONS, page.anim.type) ? page.anim : null;
  const anim = own || pageAnim;
  if (!anim) return null;
  const duration = clampNum(anim.duration, ...LIMITS.duration, DEFAULT_ANIM_DURATION);
  const at = rankIn(order, el.id);
  // A page's elements all come in within its time: with many of them, closer together.
  const fit = order.length > 1 ? Math.max(0, pageDuration(page) - duration) / (order.length - 1) : Infinity;
  const delay = own ? clampNum(own.delay, ...LIMITS.delay, 0) : at * Math.min(fit, clampNum(pageAnim.stagger, ...LIMITS.stagger, DEFAULT_STAGGER));
  return { type: anim.type, duration, delay };
}

// Each reading order's positions, looked up by id (worked out once per order).
const ranks = new WeakMap();
function rankIn(order, id) {
  let r = ranks.get(order);
  if (!r) ranks.set(order, (r = new Map(order.map((k, i) => [k, i]))));
  return r.get(id) ?? 0;
}

/** A number kept within [lo, hi]; `fallback` when missing, empty or not a number. */
export function clampNum(v, lo, hi, fallback) {
  const n = v === undefined || v === null || v === '' || typeof v === 'boolean' ? NaN : Number(v);
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

/** Every shown element's animation on a page, inside groups too. */
function animations(page) {
  const order = readingOrder(page);
  const out = [];
  const walk = (els, nested) => {
    for (const el of els) {
      if (el.hidden) continue;
      const a = animationOf(page, el, order, { nested });
      if (a) out.push(a);
      if (el.type === 'group') walk(el.children, true);
    }
  };
  walk(page.elements, false);
  return out;
}

/** How long a soundtrack fades out over the end of something `seconds` long (downloads and Play alike). */
export function soundFade(seconds) {
  return Math.min(1, seconds / 4);
}

/** Whether something on a page starts coming in only after the page's time is up (so it never shows). */
export function startsTooLate(page) {
  return animations(page).some((a) => a.delay >= pageDuration(page));
}

/** When a page's animations are all done (loops aside), in seconds. */
export function animationsEnd(page) {
  return animations(page).reduce((end, a) => Math.max(end, a.delay + a.duration), 0);
}

/** A page's shown videos (inside groups too) that can play: their file is in `assets`, when given. */
export function videosIn(page, assets = null) {
  const out = [];
  const walk = (els) => {
    for (const el of els) {
      if (el.hidden) continue;
      if (el.type === 'video' && (!assets || assets[el.assetId])) out.push(el);
      if (el.type === 'group') walk(el.children);
    }
  };
  walk(page.elements);
  return out;
}

/** Whether a page has a video that can play (see videosIn). */
export function hasVideo(page, assets = null) {
  return videosIn(page, assets).length > 0;
}

/** Whether a page has an animation that never ends (breathing, say). */
export function hasLoop(page) {
  return animations(page).some((a) => ANIMATIONS[a.type].loop);
}

/** Whether a page keeps moving after its animations are done (a looping one, or a video). */
export function keepsMoving(page, assets = null) {
  return hasVideo(page, assets) || hasLoop(page);
}

/** Whether anything on a page moves. */
export function pageMoves(page, assets = null) {
  return animations(page).length > 0 || transitionOf(page).type !== 'none' || hasVideo(page, assets);
}

/** Whether anything in a design moves (so a GIF or video is worth making). */
export function designMoves(doc, pages = doc.pages.map((p, i) => (p.hidden ? -1 : i)).filter((i) => i >= 0)) {
  // The first page's transition never plays: nothing comes before it.
  return pages.some((i, k) => (k === 0 ? animations(doc.pages[i]).length > 0 || hasVideo(doc.pages[i], doc.assets) : pageMoves(doc.pages[i], doc.assets)));
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
  return pageFrame(doc, part.index, clamped - part.start, i > 0 ? tl.parts[i - 1].index : null);
}

/**
 * What to show `local` seconds into page `index`, having come from page
 * `from` (or from nowhere: null). The one rule for transitions, used by
 * downloads (frameAt) and presenting alike.
 */
export function pageFrame(doc, index, local, from) {
  const tr = transitionOf(doc.pages[index]);
  if (from !== null && from !== undefined && tr.type !== 'none' && local < tr.duration) {
    return { index, local, from: { index: from, local: pageDuration(doc.pages[from]) }, transition: { type: tr.type, progress: easeOut(clamp01(local / tr.duration)) } };
  }
  return { index, local, from: null, transition: null };
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
