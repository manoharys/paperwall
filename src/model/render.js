// Turns a page into SVG markup. The editor and every export use this same
// renderer, so what you see is exactly what you download.

import { shapePath, dashArray } from './shapes.js';
import { layoutText, displayText, approxMeasure } from './text-layout.js';
import { iconById, stickerById } from './graphics.js';
import { qrMatrix, qrPath } from './qr.js';

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
