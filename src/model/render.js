// Turns a page into SVG markup. The editor and every export use this same
// renderer, so what you see is exactly what you download.

import { shapePath, dashArray } from './shapes.js';
import { layoutText, displayText, approxMeasure } from './text-layout.js';
import { iconById, stickerById } from './graphics.js';
import { qrMatrix, qrPath } from './qr.js';

const f = (n) => Math.round(n * 100) / 100;

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
    href: opts.assetHref || ((assetId) => doc.assets[assetId]?.dataUrl || ''),
    editor: !!opts.editor,
    skip: opts.skip || null,
  };
}

// ---------- paint ----------

function paint(ctx, p) {
  if (!p) return 'none';
  if (typeof p === 'string') return esc(p);
  if (p.type === 'linear' || p.type === 'radial') {
    const id = ctx.id('grad');
    const stops = (p.stops || [])
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
  const href = ctx.href(el.assetId);
  if (!href) return `<rect width="${f(el.w)}" height="${f(el.h)}" fill="#e5e5ef"/>`;
  const crop = el.crop || { x: 0, y: 0, w: 1, h: 1 };
  const iw = el.w / crop.w;
  const ih = el.h / crop.h;
  const clip = ctx.id('clip');
  const shape = el.mask === 'circle'
    ? `<ellipse cx="${f(el.w / 2)}" cy="${f(el.h / 2)}" rx="${f(el.w / 2)}" ry="${f(el.h / 2)}"/>`
    : `<rect width="${f(el.w)}" height="${f(el.h)}" rx="${f(Math.min(el.radius || 0, el.w / 2, el.h / 2))}"/>`;
  ctx.defs.push(`<clipPath id="${clip}">${shape}</clipPath>`);
  const fx = imageFilter(ctx, el.filters);
  return `<g clip-path="url(#${clip})"><image href="${esc(href)}" x="${f(-crop.x * iw)}" y="${f(-crop.y * ih)}" width="${f(iw)}" height="${f(ih)}" preserveAspectRatio="none"${fx ? ` filter="url(#${fx})"` : ''}/></g>`;
}

function renderIcon(ctx, el) {
  const icon = iconById(el.iconId);
  if (!icon) return '';
  const s = Math.min(el.w, el.h) / 24;
  const ox = (el.w - 24 * s) / 2;
  const oy = (el.h - 24 * s) / 2;
  return `<g transform="translate(${f(ox)} ${f(oy)}) scale(${f(s)})" fill="none" stroke="${esc(el.color || '#000000')}" stroke-width="${f(el.strokeWidth || 1.8)}" stroke-linecap="round" stroke-linejoin="round">${icon.body}</g>`;
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
  return `font-family="${esc(el.font)}, sans-serif" font-size="${f(el.size)}" font-weight="${el.weight || 400}"${el.italic ? ' font-style="italic"' : ''}${el.letterSpacing ? ` letter-spacing="${f(el.letterSpacing)}"` : ''}`;
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
  const stroke = el.outline ? ` stroke="${esc(el.outline.color)}" stroke-width="${f(el.outline.width * 2)}" stroke-linejoin="round" paint-order="stroke fill"` : '';
  return `<text ${textAttrs(el)} fill="${esc(el.color)}"${stroke}><textPath href="#${id}" startOffset="${offset}" text-anchor="middle">${esc(text)}</textPath></text>`;
}

function renderText(ctx, el) {
  if (el.curve) return renderCurvedText(ctx, el);
  const { lines, lineHeight } = layoutText(el, ctx.measure);
  const pad = el.highlight ? el.highlight.padding ?? 0 : 0;
  const ascent = el.size * 0.8;
  const parts = [];
  const deco = [];
  const marks = [];
  const tspans = [];
  lines.forEach((line, i) => {
    const top = pad + i * lineHeight;
    const baseline = top + (lineHeight - el.size) / 2 + ascent;
    const avail = el.w - line.indent;
    let x = line.indent;
    if (el.align === 'center') x = line.indent + (avail - line.width) / 2;
    else if (el.align === 'right') x = el.w - line.width;
    if (el.highlight && line.width > 0) {
      const hp = Math.max(pad, el.size * 0.15);
      marks.push(`<rect x="${f(x - hp)}" y="${f(top)}" width="${f(line.width + hp * 2)}" height="${f(lineHeight)}" rx="${f(el.highlight.radius ?? 0)}" fill="${esc(el.highlight.color)}"/>`);
    }
    if (line.prefix) tspans.push(`<tspan x="${f(x - line.indent)}" y="${f(baseline)}">${esc(line.prefix.trim())}</tspan>`);
    if (line.text) tspans.push(`<tspan x="${f(x)}" y="${f(baseline)}">${esc(line.text)}</tspan>`);
    const thick = Math.max(1, el.size * 0.06);
    if (el.underline && line.width) deco.push(`<rect x="${f(x)}" y="${f(baseline + el.size * 0.1)}" width="${f(line.width)}" height="${f(thick)}" fill="${esc(el.color)}"/>`);
    if (el.strike && line.width) deco.push(`<rect x="${f(x)}" y="${f(baseline - el.size * 0.3)}" width="${f(line.width)}" height="${f(thick)}" fill="${esc(el.color)}"/>`);
  });
  parts.push(...marks);
  const stroke = el.outline ? ` stroke="${esc(el.outline.color)}" stroke-width="${f(el.outline.width * 2)}" stroke-linejoin="round" paint-order="stroke fill"` : '';
  parts.push(`<text ${textAttrs(el)} fill="${esc(el.color)}"${stroke} xml:space="preserve">${tspans.join('')}</text>`);
  parts.push(...deco);
  return parts.join('');
}

const RENDERERS = {
  shape: renderShape,
  line: renderLine,
  image: renderImage,
  icon: renderIcon,
  sticker: renderSticker,
  qr: renderQr,
  text: renderText,
  group: (ctx, el) => el.children.map((c) => renderElement(ctx, c)).join(''),
};

export function renderElement(ctx, el) {
  if (el.hidden || ctx.skip?.has(el.id)) return '';
  const body = (RENDERERS[el.type] || (() => ''))(ctx, el);
  const attrs = [`transform="${transformOf(el)}"`];
  if ((el.opacity ?? 1) < 1) attrs.push(`opacity="${f(el.opacity)}"`);
  if (el.shadow) attrs.push(`filter="url(#${shadowFilter(ctx, el.shadow)})"`);
  if (ctx.editor) attrs.push(`data-id="${esc(el.id)}" data-type="${el.type}"`);
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
  const w = doc.width;
  const h = doc.height;
  const bg = opts.transparent ? '' : renderBackground(ctx, page.background, w, h);
  const body = page.elements.map((el) => renderElement(ctx, el)).join('');
  const style = opts.fontCss ? `<style>${opts.fontCss}</style>` : '';
  const scale = opts.scale || 1;
  const size = opts.noSize ? '' : ` width="${f(w * scale)}" height="${f(h * scale)}"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"${size} viewBox="0 0 ${w} ${h}">` +
    `<defs>${style}${ctx.defs.join('')}</defs>${bg}${body}</svg>`;
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
    for (const el of els) {
      if (el.hidden) continue;
      if (el.type === 'group') {
        if (!el.rotation) visit(el.children, ox + el.x, oy + el.y);
        continue;
      }
      if (el.type !== 'text') continue;
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
