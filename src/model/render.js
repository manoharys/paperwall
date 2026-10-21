// Turns a page into SVG markup. The editor and every export use this same
// renderer, so what you see is exactly what you download.

import { shapePath, dashArray, maskPath, drawPath } from './shapes.js';
import { connectorGeometry, arrowHead } from './connectors.js';
import { hexToRgb, mixHex, sortedStops } from './color.js';
import { layoutText, displayText, approxMeasure, measureWith, notePad } from './text-layout.js';
import { iconById, stickerById } from './graphics.js';
import { qrMatrix, qrPath } from './qr.js';
import { animationOf, motionAt, readingOrder, transitionAt } from './motion.js';
import { boundsOf } from './geometry.js';
import { stillIsCurrent } from './doc.js';

const f = (n) => Math.round(n * 100) / 100;
const num = (v, fallback) => (Number.isFinite(+v) ? +v : fallback);

export function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function makeCtx(doc, opts) {
  let n = 0;
  return {
    doc,
    defs: [],
    id: (kind) => `${opts.idPrefix || 'pl'}-${kind}-${n++}`,
    measure: opts.measure || approxMeasure,
    // `part`: 'poster' for a video's poster picture, else the file itself.
    href: opts.assetHref || ((assetId, part) => doc.assets[assetId]?.[part === 'poster' ? 'poster' : 'dataUrl'] || ''),
    editor: !!opts.editor,
    // Empty-frame placeholders: while editing and in page previews, never in downloads.
    placeholders: !!(opts.editor || opts.placeholders),
    skip: opts.skip || null,
    // While playing or downloading: the picture for each video at this moment.
    videoFrame: opts.videoFrame || null,
    // Presenting: places for the live videos (see renderVideo).
    videoSlots: !!opts.videoSlots,
  };
}

// ---------- paint ----------

function paint(ctx, p) {
  if (!p) return 'none';
  if (typeof p === 'string') return esc(p);
  if (p.type === 'linear' || p.type === 'radial') {
    const id = ctx.id('grad');
    const stops = sortedStops(p)
      .map((s) => `<stop offset="${f(s.offset)}" stop-color="${esc(s.color)}"${s.opacity !== undefined ? ` stop-opacity="${f(s.opacity)}"` : ''}/>`)
      .join('');
    if (p.type === 'radial') {
      ctx.defs.push(`<radialGradient id="${id}" cx="0.5" cy="0.5" r="0.7">${stops}</radialGradient>`);
    } else {
      const a = ((p.angle ?? 180) * Math.PI) / 180;
      const x1 = 0.5 - Math.sin(a) / 2;
      const y1 = 0.5 + Math.cos(a) / 2;
      const x2 = 0.5 + Math.sin(a) / 2;
      const y2 = 0.5 - Math.cos(a) / 2;
      ctx.defs.push(`<linearGradient id="${id}" x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}">${stops}</linearGradient>`);
    }
    return `url(#${id})`;
  }
  return 'none';
}

function shadowFilter(ctx, s) {
  const id = ctx.id('shadow');
  ctx.defs.push(
    `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%" color-interpolation-filters="sRGB">` +
      `<feDropShadow dx="${f(s.x ?? 0)}" dy="${f(s.y ?? 8)}" stdDeviation="${f((s.blur ?? 16) / 2)}" flood-color="${esc(s.color || '#000000')}" flood-opacity="${f(s.opacity ?? 0.35)}"/></filter>`,
  );
  return id;
}

function imageFilter(ctx, fl) {
  if (!fl) return null;
  const parts = [];
  const b = (fl.brightness ?? 100) / 100;
  const c = (fl.contrast ?? 100) / 100;
  if (b !== 1 || c !== 1) {
    const slope = b * c;
    const intercept = (1 - c) / 2;
    const fn = `type="linear" slope="${f(slope)}" intercept="${f(intercept)}"`;
    parts.push(`<feComponentTransfer><feFuncR ${fn}/><feFuncG ${fn}/><feFuncB ${fn}/></feComponentTransfer>`);
  }
  const sat = ((fl.saturation ?? 100) / 100) * (1 - (fl.grayscale ?? 0) / 100);
  if (sat !== 1) parts.push(`<feColorMatrix type="saturate" values="${f(Math.max(0, sat))}"/>`);
  const sp = (fl.sepia ?? 0) / 100;
  if (sp > 0) {
    const m = [
      0.393 + 0.607 * (1 - sp), 0.769 - 0.769 * (1 - sp), 0.189 - 0.189 * (1 - sp), 0, 0,
      0.349 - 0.349 * (1 - sp), 0.686 + 0.314 * (1 - sp), 0.168 - 0.168 * (1 - sp), 0, 0,
      0.272 - 0.272 * (1 - sp), 0.534 - 0.534 * (1 - sp), 0.131 + 0.869 * (1 - sp), 0, 0,
      0, 0, 0, 1, 0,
    ];
    parts.push(`<feColorMatrix type="matrix" values="${m.map(f).join(' ')}"/>`);
  }
  // Warmth shifts red against blue; tint shifts green against magenta (-100..100).
  const warm = (fl.warmth ?? 0) / 100 * 0.12;
  const tint = (fl.tint ?? 0) / 100 * 0.1;
  if (warm || tint) parts.push(`<feColorMatrix type="matrix" values="1 0 0 0 ${f(warm)} 0 1 0 0 ${f(tint)} 0 0 1 0 ${f(-warm)} 0 0 0 1 0"/>`);
  if (fl.hue) parts.push(`<feColorMatrix type="hueRotate" values="${f(fl.hue)}"/>`);
  if (fl.duotone?.dark && fl.duotone?.light) {
    // Shadows become one color, highlights another, by brightness.
    const rgb = (hex) => (hexToRgb(hex) || [0, 0, 0]).map((v) => v / 255);
    const [d, l] = [rgb(fl.duotone.dark), rgb(fl.duotone.light)];
    parts.push('<feColorMatrix type="matrix" values="0.2126 0.7152 0.0722 0 0 0.2126 0.7152 0.0722 0 0 0.2126 0.7152 0.0722 0 0 0 0 0 1 0"/>');
    parts.push(`<feComponentTransfer>${['R', 'G', 'B'].map((c, i) => `<feFunc${c} type="table" tableValues="${f(d[i])} ${f(l[i])}"/>`).join('')}</feComponentTransfer>`);
  }
  if ((fl.blur ?? 0) > 0) parts.push(`<feGaussianBlur stdDeviation="${f(fl.blur)}"/>`);
  if (!parts.length) return null;
  const id = ctx.id('fx');
  ctx.defs.push(`<filter id="${id}" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB">${parts.join('')}</filter>`);
  return id;
}

// ---------- elements ----------

function transformOf(el) {
  const cx = el.x + el.w / 2;
  const cy = el.y + el.h / 2;
  const sx = el.flipX ? -1 : 1;
  const sy = el.flipY ? -1 : 1;
  let t = `translate(${f(cx)} ${f(cy)})`;
  if (el.rotation) t += ` rotate(${f(el.rotation)})`;
  if (sx !== 1 || sy !== 1) t += ` scale(${sx} ${sy})`;
  return t + ` translate(${f(-el.w / 2)} ${f(-el.h / 2)})`;
}

function renderShape(ctx, el) {
  const d = shapePath(el);
  const sw = el.stroke ? el.strokeWidth || 0 : 0;
  const dash = sw ? dashArray(el.dash, sw) : null;
  return `<path d="${d}" fill="${paint(ctx, el.fill)}"${sw ? ` stroke="${esc(el.stroke)}" stroke-width="${f(sw)}" stroke-linejoin="round"${dash ? ` stroke-dasharray="${dash}" stroke-linecap="round"` : ''}` : ''}/>`;
}

function renderLine(ctx, el) {
  const sw = el.strokeWidth || 4;
  const y = el.h / 2;
  const head = sw * 3.2;
  const x1 = el.startCap === 'arrow' ? head * 0.8 : 0;
  const x2 = el.endCap === 'arrow' ? el.w - head * 0.8 : el.w;
  const dash = dashArray(el.dash, sw);
  const color = esc(el.stroke || '#000000');
  let out = `<line x1="${f(x1)}" y1="${f(y)}" x2="${f(x2)}" y2="${f(y)}" stroke="${color}" stroke-width="${f(sw)}" stroke-linecap="${dash ? 'round' : 'butt'}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
  if (el.endCap === 'arrow') out += `<path d="M${f(el.w)} ${f(y)} L${f(el.w - head)} ${f(y - head * 0.6)} L${f(el.w - head)} ${f(y + head * 0.6)} Z" fill="${color}"/>`;
  if (el.startCap === 'arrow') out += `<path d="M0 ${f(y)} L${f(head)} ${f(y - head * 0.6)} L${f(head)} ${f(y + head * 0.6)} Z" fill="${color}"/>`;
  return out;
}

function renderImage(ctx, el) {
  return renderPicture(ctx, el, el.assetId ? ctx.href(el.assetId) : '');
}

/**
 * A video shows like a picture: the frame for this moment when playing (or
 * downloading), else its poster. While editing it wears a small play badge.
 */
function renderVideo(ctx, el) {
  const asset = ctx.doc.assets[el.assetId];
  // Playing: the moment's picture; else its still (where it starts, full
  // size), else the small poster taken when it was added.
  const still = stillIsCurrent(ctx.doc, el) ? ctx.href(el.still) : '';
  const href = ctx.videoFrame?.(el) || still || (asset ? ctx.href(el.assetId, 'poster') : '');
  // Presenting a page whose videos play live: a place for the playing video
  // itself (put in after drawing), framed and clipped like a picture.
  const pic = renderPicture(ctx, el, href, ctx.videoSlots && asset ? 'slot' : 'image'); // no picture at all: the grey box of a missing image
  if (!ctx.editor) return pic;
  const s = Math.max(14, Math.min(el.w, el.h) * 0.14);
  return `${pic}<g transform="translate(${f(el.w - s * 1.35)} ${f(s * 0.35)})"><circle cx="${f(s / 2)}" cy="${f(s / 2)}" r="${f(s / 2)}" fill="#000" fill-opacity="0.55"/><path d="M${f(s * 0.4)} ${f(s * 0.3)}L${f(s * 0.72)} ${f(s / 2)}L${f(s * 0.4)} ${f(s * 0.7)}Z" fill="#fff"/></g>`;
}

function renderPicture(ctx, el, href, as = 'image') {
  const outline = maskPath(el);
  // A picture whose image is missing (damaged file) keeps a grey box everywhere.
  // (A live video's place is kept even without a poster: the video fills it.)
  if (el.assetId && !href && as !== 'slot') return `<path d="${outline}" fill="#e5e5ef"/>`;
  if (!href && as !== 'slot') {
    // An empty frame shows a soft placeholder while editing; downloads leave it out.
    if (!ctx.placeholders) return '';
    const s = Math.min(el.w, el.h) * 0.22;
    const ox = (el.w - s) / 2;
    const oy = (el.h - s) / 2;
    return `<path d="${outline}" fill="#dcdce6"/><g transform="translate(${f(ox)} ${f(oy)}) scale(${f(s / 24)})" fill="none" stroke="#9a9aab" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/></g>`;
  }
  const crop = el.crop || { x: 0, y: 0, w: 1, h: 1 };
  const iw = el.w / crop.w;
  const ih = el.h / crop.h;
  const clip = ctx.id('clip');
  ctx.defs.push(`<clipPath id="${clip}"><path d="${outline}"/></clipPath>`);
  const fx = imageFilter(ctx, el.filters);
  // A vignette darkens the edges with a soft radial shade on top.
  const v = (el.filters?.vignette ?? 0) / 100;
  let shade = '';
  if (v > 0) {
    const id = ctx.id('vig');
    ctx.defs.push(`<radialGradient id="${id}" cx="50%" cy="50%" r="72%"><stop offset="${f(0.75 - v * 0.45)}" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="${f(0.25 + v * 0.6)}"/></radialGradient>`);
    shade = `<rect width="${f(el.w)}" height="${f(el.h)}" fill="url(#${id})"/>`;
  }
  const at = `x="${f(-crop.x * iw)}" y="${f(-crop.y * ih)}" width="${f(iw)}" height="${f(ih)}"`;
  const media = as === 'slot'
    // Under the live video, its picture until the video shows (then taken away).
    ? `${href ? `<image data-under="${esc(el.id)}" href="${esc(href)}" ${at} preserveAspectRatio="none"${fx ? ` filter="url(#${fx})"` : ''}/>` : ''}<foreignObject ${at} data-video="${esc(el.id)}"${fx ? ` filter="url(#${fx})"` : ''}></foreignObject>`
    : `<image href="${esc(href)}" ${at} preserveAspectRatio="none"${fx ? ` filter="url(#${fx})"` : ''}/>`;
  return `<g clip-path="url(#${clip})">${media}${shade}</g>`;
}

function renderConnector(ctx, el) {
  const sw = el.strokeWidth || 4;
  const head = sw * 3.2;
  const { d, startDir, endDir } = connectorGeometry(el, { start: el.startCap === 'arrow' ? head * 0.8 : 0, end: el.endCap === 'arrow' ? head * 0.8 : 0 });
  const dash = dashArray(el.dash, sw);
  const color = esc(el.stroke || '#000000');
  const [a, b] = el.points.map(([fx, fy]) => [fx * el.w, fy * el.h]);
  let out = `<path d="${d}" fill="none" stroke="${color}" stroke-width="${f(sw)}" stroke-linejoin="round" stroke-linecap="${dash ? 'round' : 'butt'}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
  if (el.endCap === 'arrow') out += `<path d="${arrowHead(b, endDir, head)}" fill="${color}"/>`;
  if (el.startCap === 'arrow') out += `<path d="${arrowHead(a, [-startDir[0], -startDir[1]], head)}" fill="${color}"/>`;
  return out;
}

function renderIcon(ctx, el) {
  const icon = iconById(el.iconId);
  if (!icon) return '';
  const s = Math.min(el.w, el.h) / 24;
  const ox = (el.w - 24 * s) / 2;
  const oy = (el.h - 24 * s) / 2;
  // color= lets icon parts drawn with currentColor (dots, filled shapes) match the stroke.
  const color = esc(el.color || '#000000');
  return `<g transform="translate(${f(ox)} ${f(oy)}) scale(${f(s)})" color="${color}" fill="none" stroke="${color}" stroke-width="${f(el.strokeWidth || 1.8)}" stroke-linecap="round" stroke-linejoin="round">${icon.body}</g>`;
}

function renderSticker(ctx, el) {
  const st = stickerById(el.stickerId);
  if (!st) return '';
  return `<g transform="scale(${f(el.w / 100)} ${f(el.h / 100)})">${st.svg}</g>`;
}

function renderQr(ctx, el) {
  let m;
  try {
    m = qrMatrix(el.data || ' ');
  } catch {
    return `<rect width="${f(el.w)}" height="${f(el.h)}" fill="#ffe0e0"/>`;
  }
  const quiet = 2;
  const n = m.length + quiet * 2;
  const s = Math.min(el.w, el.h) / n;
  return `<rect width="${f(el.w)}" height="${f(el.h)}" fill="${esc(el.bg || '#ffffff')}"/>` +
    `<g transform="translate(${f((el.w - n * s) / 2 + quiet * s)} ${f((el.h - n * s) / 2 + quiet * s)}) scale(${f(s)})"><path d="${qrPath(m)}" fill="${esc(el.fg || '#000000')}" shape-rendering="crispEdges"/></g>`;
}

export function textAttrs(el) {
  return `font-family="${esc(el.font)}, sans-serif" font-size="${f(el.size)}" font-weight="${num(el.weight, 400)}"${el.italic ? ' font-style="italic"' : ''}${el.letterSpacing ? ` letter-spacing="${f(el.letterSpacing)}"` : ''}`;
}

/** Radius and height for curved text. curve is -100…100. */
export function curveGeometry(el, textWidth) {
  const c = Math.max(1, Math.abs(el.curve));
  const r = Math.max(el.size, textWidth / (Math.PI * (c / 100)));
  const half = Math.min(textWidth / 2, r);
  const sag = r - Math.sqrt(Math.max(0, r * r - half * half));
  return { r, sag, height: sag + el.size * 1.3 };
}

function renderCurvedText(ctx, el) {
  const text = displayText(el).replace(/\s*\n\s*/g, ' ');
  const tw = ctx.measure(text, el) + (el.letterSpacing || 0) * [...text].length;
  const { r } = curveGeometry(el, tw);
  const id = ctx.id('arc');
  const cx = el.w / 2;
  let d;
  let offset;
  if (el.curve > 0) {
    const cy = el.size * 0.95 + r;
    d = `M${f(cx - r)} ${f(cy)} A${f(r)} ${f(r)} 0 1 1 ${f(cx + r)} ${f(cy)} A${f(r)} ${f(r)} 0 1 1 ${f(cx - r)} ${f(cy)}`;
    offset = '25%';
  } else {
    const cy = el.h - el.size * 0.3 - r;
    d = `M${f(cx - r)} ${f(cy)} A${f(r)} ${f(r)} 0 1 0 ${f(cx + r)} ${f(cy)} A${f(r)} ${f(r)} 0 1 0 ${f(cx - r)} ${f(cy)}`;
    offset = '25%';
  }
  ctx.defs.push(`<path id="${id}" d="${d}" fill="none"/>`);
  return textEffect(ctx, el, (paint) => `<text ${textAttrs(el)}${paint}><textPath href="#${id}" startOffset="${offset}" text-anchor="middle">${esc(text)}</textPath></text>`);
}

export const TEXT_EFFECTS = ['none', 'lift', 'hollow', 'splice', 'echo', 'glitch', 'glow', 'neon'];

/** Mix a #rrggbb color toward white by t (0..1). */
function lighten(hex, t) {
  return mixHex(hex, '#ffffff', t);
}

/**
 * Draw text with its effect. `draw(paint)` returns the <text> element with
 * the given fill/stroke attributes; effects layer copies of it.
 * el.effect = { type, color, offset (share of font size), thickness }.
 */
function textEffect(ctx, el, draw) {
  const outline = el.outline ? ` stroke="${esc(el.outline.color)}" stroke-width="${f(el.outline.width * 2)}" stroke-linejoin="round" paint-order="stroke fill"` : '';
  const plain = ` fill="${esc(el.color)}"${outline}`;
  const fx = el.effect;
  if (!fx || !fx.type || fx.type === 'none') return draw(plain);
  const s = el.size;
  const color = esc(fx.color || el.color);
  const off = (fx.offset ?? 0.08) * s;
  const thick = Math.max(1, (fx.thickness ?? 0.035) * s);
  const hollow = ` fill="none" stroke="${esc(el.color)}" stroke-width="${f(thick)}" stroke-linejoin="round"`;
  const at = (dx, dy, paint, extra = '') => `<g transform="translate(${f(dx)} ${f(dy)})"${extra}>${draw(paint)}</g>`;
  const glowFilter = (blur, strength) => {
    const id = ctx.id('glow');
    const blurs = strength > 1 ? `<feGaussianBlur in="SourceAlpha" stdDeviation="${f(blur)}" result="b1"/><feGaussianBlur in="SourceAlpha" stdDeviation="${f(blur / 3)}" result="b2"/>` : `<feGaussianBlur in="SourceAlpha" stdDeviation="${f(blur)}" result="b1"/>`;
    const merge = strength > 1 ? '<feMergeNode in="g1"/><feMergeNode in="g2"/>' : '<feMergeNode in="g1"/>';
    ctx.defs.push(`<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%" color-interpolation-filters="sRGB">${blurs}` +
      `<feFlood flood-color="${color}" flood-opacity="0.9"/><feComposite in2="b1" operator="in" result="g1"/>` +
      (strength > 1 ? `<feFlood flood-color="${color}"/><feComposite in2="b2" operator="in" result="g2"/>` : '') +
      `<feMerge>${merge}<feMergeNode in="SourceGraphic"/></feMerge></filter>`);
    return id;
  };
  switch (fx.type) {
    case 'lift':
      return `<g filter="url(#${shadowFilter(ctx, { x: 0, y: s * 0.06, blur: s * 0.25, color: '#000000', opacity: 0.3 })})">${draw(plain)}</g>`;
    case 'hollow':
      return draw(hollow);
    case 'splice':
      return at(off, off, ` fill="${color}"`) + draw(hollow);
    case 'echo':
      return at(off * 2, off * 2, plain, ' opacity="0.25"') + at(off, off, plain, ' opacity="0.5"') + draw(plain);
    case 'glitch':
      return at(-off / 2, 0, ` fill="${esc(fx.color || '#00e5ff')}"`) + at(off / 2, 0, ` fill="${esc(fx.color2 || '#ff2d95')}"`) + draw(plain);
    case 'glow':
      return `<g filter="url(#${glowFilter(s * 0.12, 1)})">${draw(plain)}</g>`;
    case 'neon':
      return `<g filter="url(#${glowFilter(s * 0.2, 2)})">${draw(` fill="${esc(lighten(fx.color || el.color, 0.65))}"${outline}`)}</g>`;
    default:
      return draw(plain);
  }
}

function renderText(ctx, el) {
  if (el.note) {
    // A sticky note: its square of color (lifted a little off the page), and
    // the text inside its edges.
    const p = notePad(el);
    const inner = renderText(ctx, { ...el, note: null, w: Math.max(1, el.w - p * 2), h: Math.max(1, el.h - p * 2) });
    const r = Math.min(8, el.w * 0.02);
    return `<rect x="0" y="${f(el.h * 0.012 + 2)}" width="${f(el.w)}" height="${f(el.h)}" rx="${f(r)}" fill="#000" fill-opacity="0.12"/>` +
      `<rect width="${f(el.w)}" height="${f(el.h)}" rx="${f(r)}" fill="${esc(el.note)}"/><g transform="translate(${f(p)} ${f(p)})">${inner}</g>`;
  }
  if (el.curve) return renderCurvedText(ctx, el);
  const { lines, lineHeight } = layoutText(el, ctx.measure);
  const pad = el.highlight ? el.highlight.padding ?? 0 : 0;
  const ascent = el.size * 0.8;
  const parts = [];
  const deco = [];
  const marks = [];
  const tspans = [];
  // Typing it out (an animation): only the first letters show. Lines are
  // laid out in full first, so letters never move as more appear.
  // Counted in characters (an emoji is one), not UTF-16 units.
  let left = el._typed === undefined ? Infinity : Math.round(lines.reduce((n, l) => n + [...(l.text || '')].length, 0) * el._typed);
  lines.forEach((line0, i) => {
    let line = line0;
    if (left !== Infinity) {
      const all = [...(line.text || '')];
      const before = left;
      const shown = all.slice(0, Math.max(0, before));
      left -= all.length;
      // Not reached yet (a blank line, its bullet say, shows once typing gets to it).
      if (all.length ? !shown.length : before <= 0) return;
      // Same place as the whole line; underlines and boxes only under what's
      // typed (measured, as the letters are).
      const text = shown.join('');
      line = { ...line, text, width: shown.length === all.length ? line.width : measureWith(ctx.measure, el)(text), fullWidth: line.width };
    }
    const top = pad + i * lineHeight;
    const baseline = top + (lineHeight - el.size) / 2 + ascent;
    const avail = el.w - line.indent;
    const placed = line.fullWidth ?? line.width;
    let x = line.indent;
    if (el.align === 'center') x = line.indent + (avail - placed) / 2;
    else if (el.align === 'right') x = el.w - placed;
    if (el.highlight && line.width > 0) {
      const hp = Math.max(pad, el.size * 0.15);
      marks.push(`<rect x="${f(x - hp)}" y="${f(top)}" width="${f(line.width + hp * 2)}" height="${f(lineHeight)}" rx="${f(el.highlight.radius ?? 0)}" fill="${esc(el.highlight.color)}"/>`);
    }
    if (line.prefix) tspans.push(`<tspan x="${f(x - line.indent)}" y="${f(baseline)}">${esc(line.prefix.trim())}</tspan>`);
    if (line.text) tspans.push(`<tspan x="${f(x)}" y="${f(baseline)}">${esc(line.text)}</tspan>`);
    const thick = Math.max(1, el.size * 0.06);
    if (el.underline && line.width) deco.push(`<rect x="${f(x)}" y="${f(baseline + el.size * 0.1)}" width="${f(line.width)}" height="${f(thick)}"`);
    if (el.strike && line.width) deco.push(`<rect x="${f(x)}" y="${f(baseline - el.size * 0.3)}" width="${f(line.width)}" height="${f(thick)}"`);
  });
  parts.push(...marks);
  // Underlines and strike lines are painted like the letters, so effects apply to them too.
  parts.push(textEffect(ctx, el, (paint) => `<text ${textAttrs(el)}${paint} xml:space="preserve">${tspans.join('')}</text>${deco.map((r) => `${r}${paint}/>`).join('')}`));
  return parts.join('');
}

function chartText(el, x, y, text, size, { anchor = 'middle', weight = 400, color } = {}) {
  return `<text x="${f(x)}" y="${f(y)}" font-family="${esc(el.font)}, sans-serif" font-size="${f(size)}" font-weight="${weight}" fill="${esc(color || el.textColor)}" text-anchor="${anchor}">${esc(text)}</text>`;
}

function renderChart(ctx, el) {
  const data = (el.data || []).filter((d) => Number.isFinite(d.value));
  if (!data.length) return `<rect width="${f(el.w)}" height="${f(el.h)}" fill="none" stroke="${esc(el.textColor)}" stroke-dasharray="6 6"/>`;
  const colors = el.colors?.length ? el.colors : ['#f25c2a'];
  const color = (i) => esc(colors[i % colors.length]);
  const fs = Math.max(8, Math.min(el.h, el.w) * 0.055);
  const out = [];
  if (el.chartType === 'pie' || el.chartType === 'donut') {
    const total = data.reduce((s, d) => s + Math.max(0, d.value), 0) || 1;
    const legend = el.w > el.h * 1.25;
    const d = Math.min(el.h, legend ? el.w * 0.55 : el.w) * 0.94;
    const cx = legend ? d / 2 + el.h * 0.03 : el.w / 2;
    const cy = el.h / 2;
    const r = d / 2;
    let a = -Math.PI / 2;
    data.forEach((item, i) => {
      const share = Math.max(0, item.value) / total;
      if (share <= 0) return;
      if (share >= 0.9999) {
        out.push(`<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" fill="${color(i)}"/>`);
        return;
      }
      const b = a + share * Math.PI * 2;
      const large = b - a > Math.PI ? 1 : 0;
      out.push(`<path d="M${f(cx)} ${f(cy)} L${f(cx + r * Math.cos(a))} ${f(cy + r * Math.sin(a))} A${f(r)} ${f(r)} 0 ${large} 1 ${f(cx + r * Math.cos(b))} ${f(cy + r * Math.sin(b))} Z" fill="${color(i)}"/>`);
      a = b;
    });
    if (el.chartType === 'donut') out.push(`<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r * 0.55)}" fill="${esc(el.holeColor || '#ffffff')}"/>`);
    if (legend) {
      const lx = cx + r + el.w * 0.05;
      const row = Math.min(fs * 1.9, el.h / data.length);
      const top = cy - (row * data.length) / 2;
      data.forEach((item, i) => {
        const y = top + i * row + row / 2;
        out.push(`<rect x="${f(lx)}" y="${f(y - fs * 0.4)}" width="${f(fs * 0.8)}" height="${f(fs * 0.8)}" rx="${f(fs * 0.15)}" fill="${color(i)}"/>`);
        const pct = Math.round((Math.max(0, item.value) / total) * 100);
        out.push(chartText(el, lx + fs * 1.2, y + fs * 0.35, el.showValues ? `${item.label} · ${pct}%` : item.label, fs, { anchor: 'start' }));
      });
    }
    return out.join('');
  }
  const max = Math.max(...data.map((d) => d.value), 0) || 1;
  const min = Math.min(...data.map((d) => d.value), 0);
  const top = el.showValues ? fs * 1.6 : fs * 0.5;
  const bottom = el.h - fs * 1.8;
  const span = max - min || 1;
  const y = (v) => bottom - ((v - min) / span) * (bottom - top);
  const slot = el.w / data.length;
  out.push(`<line x1="0" y1="${f(y(0))}" x2="${f(el.w)}" y2="${f(y(0))}" stroke="${esc(el.textColor)}" stroke-opacity="0.25" stroke-width="${f(Math.max(1, fs * 0.08))}"/>`);
  if (el.chartType === 'line') {
    const pts = data.map((d, i) => [slot * i + slot / 2, y(d.value)]);
    out.push(`<polyline points="${pts.map(([px, py]) => `${f(px)},${f(py)}`).join(' ')}" fill="none" stroke="${color(0)}" stroke-width="${f(Math.max(2, fs * 0.22))}" stroke-linejoin="round" stroke-linecap="round"/>`);
    pts.forEach(([px, py], i) => {
      out.push(`<circle cx="${f(px)}" cy="${f(py)}" r="${f(Math.max(3, fs * 0.3))}" fill="${color(0)}"/>`);
      if (el.showValues) out.push(chartText(el, px, py - fs * 0.6, String(data[i].value), fs * 0.9, { weight: 700 }));
    });
  } else {
    data.forEach((d, i) => {
      const bw = slot * 0.62;
      const x = slot * i + (slot - bw) / 2;
      const y1 = Math.min(y(d.value), y(0));
      const hgt = Math.abs(y(d.value) - y(0));
      out.push(`<rect x="${f(x)}" y="${f(y1)}" width="${f(bw)}" height="${f(Math.max(0.5, hgt))}" rx="${f(Math.min(bw * 0.12, hgt / 2))}" fill="${color(i)}"/>`);
      if (el.showValues) out.push(chartText(el, x + bw / 2, y1 - fs * 0.4, String(d.value), fs * 0.9, { weight: 700 }));
    });
  }
  data.forEach((d, i) => out.push(chartText(el, slot * i + slot / 2, el.h - fs * 0.35, d.label, fs)));
  return out.join('');
}

function fitCell(ctx, text, width, el, weight) {
  const style = { ...el, weight, letterSpacing: 0 };
  if (ctx.measure(text, style) <= width) return text;
  let t = text;
  while (t.length > 1 && ctx.measure(t + '…', style) > width) t = t.slice(0, -1);
  return t + '…';
}

function renderTable(ctx, el) {
  const rows = el.rows?.length ? el.rows : [['']];
  const cols = Math.max(1, ...rows.map((r) => r.length));
  const rh = el.h / rows.length;
  const cw = el.w / cols;
  const pad = Math.min(cw * 0.12, el.size * 0.6);
  const out = [];
  rows.forEach((row, r) => {
    const isHead = el.header && r === 0;
    const fill = isHead ? el.headerFill : el.stripes && r % 2 === (el.header ? 0 : 1) ? el.stripeFill : null;
    if (fill) out.push(`<rect x="0" y="${f(r * rh)}" width="${f(el.w)}" height="${f(rh)}" fill="${esc(fill)}"/>`);
    for (let c = 0; c < cols; c++) {
      const text = fitCell(ctx, String(row[c] ?? ''), cw - pad * 2, el, isHead ? 700 : 400);
      const x = el.align === 'center' ? c * cw + cw / 2 : el.align === 'right' ? (c + 1) * cw - pad : c * cw + pad;
      const anchor = el.align === 'center' ? 'middle' : el.align === 'right' ? 'end' : 'start';
      out.push(`<text x="${f(x)}" y="${f(r * rh + rh / 2 + el.size * 0.35)}" font-family="${esc(el.font)}, sans-serif" font-size="${f(el.size)}" font-weight="${isHead ? 700 : 400}" fill="${esc(isHead ? el.headerColor : el.color)}" text-anchor="${anchor}">${esc(text)}</text>`);
    }
  });
  const line = esc(el.lineColor || '#dddddd');
  const lw = Math.max(1, el.size * 0.05);
  for (let r = 1; r < rows.length; r++) out.push(`<line x1="0" y1="${f(r * rh)}" x2="${f(el.w)}" y2="${f(r * rh)}" stroke="${line}" stroke-width="${f(lw)}"/>`);
  out.push(`<rect width="${f(el.w)}" height="${f(el.h)}" fill="none" stroke="${line}" stroke-width="${f(lw)}"/>`);
  return out.join('');
}

const RENDERERS = {
  chart: renderChart,
  table: renderTable,
  shape: renderShape,
  line: renderLine,
  image: renderImage,
  video: renderVideo,
  icon: renderIcon,
  sticker: renderSticker,
  qr: renderQr,
  text: renderText,
  connector: renderConnector,
  draw: (ctx, el) => `<path d="${drawPath(el)}" fill="none" stroke="${esc(el.stroke)}" stroke-width="${f(el.strokeWidth)}" stroke-linecap="round" stroke-linejoin="round"/>`,
  // While playing, a group's elements move by their own animations.
  group: (ctx, el) => {
    if (!ctx.motion) return el.children.map((c) => renderElement(ctx, c)).join('');
    // Children move as seen on the page: the group's turn and flips (and
    // those of groups around it) are taken back out of their motion.
    const outer = ctx.motion.turn;
    ctx.motion.turn = mul(outer || IDENTITY, turnOf(el));
    try {
      return el.children.map((c) => renderMoving(ctx, c, true)).join('');
    } finally {
      ctx.motion.turn = outer;
    }
  },
};

export function renderElement(ctx, el) {
  if (el.hidden || ctx.skip?.has(el.id)) return '';
  const body = (RENDERERS[el.type] || (() => ''))(ctx, el);
  const attrs = [`transform="${transformOf(el)}"`];
  if ((el.opacity ?? 1) < 1) attrs.push(`opacity="${f(el.opacity)}"`);
  if (el.shadow) attrs.push(`filter="url(#${shadowFilter(ctx, el.shadow)})"`);
  if (ctx.editor) attrs.push(`data-id="${esc(el.id)}" data-type="${esc(el.type)}"`);
  return `<g ${attrs.join(' ')}>${body}</g>`;
}

function renderBackground(ctx, bg, w, h) {
  if (!bg) return '';
  if (bg.type === 'color') return `<rect width="${w}" height="${h}" fill="${esc(bg.color)}"/>`;
  if (bg.type === 'gradient') return `<rect width="${w}" height="${h}" fill="${paint(ctx, bg.gradient)}"/>`;
  if (bg.type === 'image') {
    const href = ctx.href(bg.assetId);
    return `<rect width="${w}" height="${h}" fill="${esc(bg.color || '#ffffff')}"/>` +
      (href ? `<image href="${esc(href)}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice"/>` : '');
  }
  return '';
}

/**
 * Render one page as a complete SVG document.
 * opts: measure, assetHref, fontCss (embedded @font-face rules), transparent,
 * editor (adds data-id attributes), idPrefix, scale (output size multiplier).
 */
export function renderPage(doc, pageIndex, opts = {}) {
  const page = doc.pages[pageIndex];
  if (!page) throw new Error(`No page ${pageIndex + 1}`);
  const ctx = makeCtx(doc, opts);
  const w = num(doc.width, 1);
  const h = num(doc.height, 1);
  return svgDocument(ctx, pageBody(ctx, page, w, h, opts), w, h, opts);
}

/** The outer SVG around a page's (or frame's) contents: size, fonts, definitions. */
function svgDocument(ctx, body, w, h, opts, extra = '') {
  const style = opts.fontCss ? `<style>${opts.fontCss}</style>` : '';
  const scale = opts.scale || 1;
  const size = opts.noSize ? '' : ` width="${f(w * scale)}" height="${f(h * scale)}"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"${size} viewBox="0 0 ${w} ${h}"${extra}>` +
    `<defs>${style}${ctx.defs.join('')}</defs>${body}</svg>`;
}

/**
 * A page's background and elements. With `opts.time` (seconds since the page
 * began), animated elements are drawn where they are at that moment.
 */
function pageBody(ctx, page, w, h, opts) {
  const bg = opts.transparent ? '' : renderBackground(ctx, page.background, w, h);
  if (opts.time === undefined) return bg + page.elements.map((el) => renderElement(ctx, el)).join('');
  const before = ctx.motion;
  ctx.motion = { page, order: readingOrder(page), time: opts.time, size: Math.min(w, h) };
  try {
    return bg + page.elements.map((el) => renderMoving(ctx, el, false)).join('');
  } finally {
    ctx.motion = before;
  }
}

// 2×2 matrices [a, b, c, d] (x' = a·x + c·y, y' = b·x + d·y): how a group
// turns and flips what's inside it.
const IDENTITY = [1, 0, 0, 1];
function turnOf(el) {
  const r = ((el.rotation || 0) * Math.PI) / 180;
  const sx = el.flipX ? -1 : 1;
  const sy = el.flipY ? -1 : 1;
  return [Math.cos(r) * sx, Math.sin(r) * sx, -Math.sin(r) * sy, Math.cos(r) * sy];
}
function mul([a, b, c, d], [e, g, h, k]) {
  return [a * e + c * g, b * e + d * g, a * h + c * k, b * h + d * k];
}
const isIdentity = (m) => !m || (Math.abs(m[0] - 1) < 1e-9 && Math.abs(m[1]) < 1e-9 && Math.abs(m[2]) < 1e-9 && Math.abs(m[3] - 1) < 1e-9);

/** One element at a moment of its page's animations (`nested`: inside a group). */
function renderMoving(ctx, el, nested) {
  const { page, order, time, size } = ctx.motion;
  const anim = animationOf(page, el, order, { nested });
  if (!anim || el.hidden) return renderElement(ctx, el);
  const m = motionAt(anim, time, size);
  const typing = anim.type === 'typewriter';
  // Only straight text types out; anything else given Typewriter (curved
  // text too) fades in at the same pace.
  const types = el.type === 'text' && !el.curve;
  const opacity = typing && !types ? m.typed : m.opacity;
  if (opacity <= 0.001 || m.reveal <= 0.001) return '';
  const body = renderElement(ctx, typing && types && m.typed < 1 ? { ...el, _typed: m.typed } : el);
  const b = boundsOf(el);
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const attrs = [];
  // Inside a turned or flipped group: page directions in the group's own terms.
  const turn = nested && !isIdentity(ctx.motion.turn) ? ctx.motion.turn : null;
  let { dx, dy, rotate } = m;
  let inv = null;
  if (turn) {
    const [a, b2, c, d] = turn;
    const det = a * d - b2 * c;
    inv = [d / det, -b2 / det, -c / det, a / det];
    [dx, dy] = [inv[0] * m.dx + inv[2] * m.dy, inv[1] * m.dx + inv[3] * m.dy];
    if (det < 0) rotate = -rotate; // a mirror turns the other way
  }
  if (dx || dy || m.scale !== 1 || rotate) {
    attrs.push(`transform="translate(${f(dx)} ${f(dy)}) translate(${f(cx)} ${f(cy)}) rotate(${f(rotate)}) scale(${m.scale}) translate(${f(-cx)} ${f(-cy)})"`);
  }
  if (opacity < 1) attrs.push(`opacity="${f(opacity)}"`);
  if (m.reveal < 1 && turn) {
    // A wipe from the page's left, inside a turned group: a square around the
    // element, uncovered left to right as the page sees it.
    const side = Math.hypot(b.w, b.h) + 80;
    const id = ctx.id('wipe');
    ctx.defs.push(`<clipPath id="${id}"><rect x="${f(-side / 2)}" y="${f(-side / 2)}" width="${f(side * m.reveal)}" height="${f(side)}" transform="translate(${f(cx)} ${f(cy)}) matrix(${inv.map(f).join(' ')} 0 0)"/></clipPath>`);
    attrs.push(`clip-path="url(#${id})"`);
  } else if (m.reveal < 1) {
    // A wipe: shown from the left edge across.
    // Room around the box for strokes, arrowheads, shadows and glows: only
    // the moving right edge cuts.
    const room = Math.max(b.w, b.h) * 0.5 + 40;
    const id = ctx.id('wipe');
    ctx.defs.push(`<clipPath id="${id}"><rect x="${f(b.x - room)}" y="${f(b.y - room)}" width="${f(room + b.w * m.reveal)}" height="${f(b.h + room * 2)}"/></clipPath>`);
    attrs.push(`clip-path="url(#${id})"`);
  }
  return attrs.length ? `<g ${attrs.join(' ')}>${body}</g>` : body;
}

/**
 * One frame of a design playing (see motion.frameAt): the page at its moment,
 * and during a transition the page before it too, placed by the transition.
 */
export function renderFrame(doc, frame, opts = {}) {
  const ctx = makeCtx(doc, opts);
  const w = num(doc.width, 1);
  const h = num(doc.height, 1);
  const layer = (index, local, place) => {
    const body = pageBody(ctx, doc.pages[index], w, h, { ...opts, time: local });
    if (!place) return body;
    if (place.opacity <= 0.001) return '';
    const attrs = [];
    if (place.dx || place.scale !== 1) attrs.push(`transform="translate(${f(place.dx * w)} 0) translate(${f(w / 2)} ${f(h / 2)}) scale(${place.scale}) translate(${f(-w / 2)} ${f(-h / 2)})"`);
    if (place.opacity < 1) attrs.push(`opacity="${f(place.opacity)}"`);
    return attrs.length ? `<g ${attrs.join(' ')}>${body}</g>` : body;
  };
  let body;
  if (frame.transition) {
    const tr = transitionAt(frame.transition.type, frame.transition.progress);
    body = layer(frame.from.index, frame.from.local, tr.from) + layer(frame.index, frame.local, tr.to);
  } else body = layer(frame.index, frame.local, null);
  // On white, as in every download (so a see-through moment of a transition
  // looks the same played, presented or downloaded).
  return svgDocument(ctx, `<rect width="${f(w)}" height="${f(h)}" fill="#ffffff"/>${body}`, w, h, opts, ' overflow="hidden"');
}

/** Render a single element on its own, for previews (layers list, thumbnails). */
export function renderElementOnly(doc, el, opts = {}) {
  const ctx = makeCtx(doc, opts);
  const body = renderElement(ctx, { ...el, x: 0, y: 0, rotation: 0 });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${f(el.w)} ${f(el.h)}"><defs>${ctx.defs.join('')}</defs>${body}</svg>`;
}

/**
 * Where every line of text sits on a page, for the PDF text layer.
 * Returns runs in page pixels: { text, x, y (baseline), size, width, angle }.
 */
export function textRuns(doc, pageIndex, measure = approxMeasure) {
  const runs = [];
  const visit = (els, ox, oy) => {
    for (const el0 of els) {
      if (el0.hidden) continue;
      if (el0.type === 'group') {
        if (!el0.rotation) visit(el0.children, ox + el0.x, oy + el0.y);
        continue;
      }
      if (el0.type !== 'text') continue;
      // A sticky note's words sit inside its edges (the same middle, so it turns the same).
      const inset = notePad(el0);
      const el = inset ? { ...el0, note: null, x: el0.x + inset, y: el0.y + inset, w: Math.max(1, el0.w - inset * 2), h: Math.max(1, el0.h - inset * 2) } : el0;
      const x0 = ox + el.x;
      const y0 = oy + el.y;
      const cx = x0 + el.w / 2;
      const cy = y0 + el.h / 2;
      const rot = ((el.rotation || 0) * Math.PI) / 180;
      const place = (lx, ly) => {
        const dx = x0 + lx - cx;
        const dy = y0 + ly - cy;
        return { x: cx + dx * Math.cos(rot) - dy * Math.sin(rot), y: cy + dx * Math.sin(rot) + dy * Math.cos(rot) };
      };
      if (el.curve) {
        const text = displayText(el).replace(/\s*\n\s*/g, ' ');
        const p = place(0, el.h * 0.6);
        runs.push({ text, x: p.x, y: p.y, size: el.size, width: el.w, angle: el.rotation || 0 });
        continue;
      }
      const { lines, lineHeight } = layoutText(el, measure);
      const pad = el.highlight ? el.highlight.padding ?? 0 : 0;
      lines.forEach((line, i) => {
        if (!line.text) return;
        const baseline = pad + i * lineHeight + (lineHeight - el.size) / 2 + el.size * 0.8;
        let x = line.indent;
        if (el.align === 'center') x = line.indent + (el.w - line.indent - line.width) / 2;
        else if (el.align === 'right') x = el.w - line.width;
        const p = place(x, baseline);
        runs.push({ text: (line.prefix ? line.prefix.trim() + ' ' : '') + line.text, x: p.x, y: p.y, size: el.size, width: line.width, angle: el.rotation || 0 });
      });
    }
  };
  visit(doc.pages[pageIndex].elements, 0, 0);
  return runs;
}
