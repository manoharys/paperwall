// PowerPoint (.pptx) files, written from ECMA-376 (Office Open XML). Each
// page is a slide at the design's size. Text becomes real text boxes,
// shapes become PowerPoint shapes (preset ones where they match, drawn
// outlines otherwise), photos become pictures; anything else (effects,
// charts, icons, stickers, QR codes...) comes as a PNG picture of that
// element, which the app draws (planPptx says which).

import { buildZip } from './zip.js';
import { shapePath, maskPath, drawPath } from './shapes.js';
import { sortedStops, normalizeHex } from './color.js';
import { printDpi, DEFAULT_FILTERS, stillIsCurrent } from './doc.js';
import { notePad } from './text-layout.js';
import { parsePath } from './pdf-vector.js';
import { effectPad } from './render.js';

const enc = new TextEncoder();

const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'application/vnd.openxmlformats-officedocument.presentationml';
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS = `xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"`;

const EMU_PER_INCH = 914400;
// PowerPoint's limits on a slide's size.
const MIN_SIDE = 914400;
const MAX_SIDE = 51206400;

/** Text for XML: escaped, without the control characters XML forbids. */
export function xmlText(s) {
  return String(s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** EMU per page px: the design at its print size, shrunk or grown to fit PowerPoint's limits. */
export function emuPerPx(doc) {
  let k = EMU_PER_INCH / printDpi(doc);
  const big = Math.max(doc.width, doc.height) * k;
  const small = Math.min(doc.width, doc.height) * k;
  if (big > MAX_SIDE) k *= MAX_SIDE / big;
  else if (small < MIN_SIDE) k *= Math.min(MIN_SIDE / small, MAX_SIDE / big);
  return k;
}

const hasFilters = (el) => el.filters && Object.entries(DEFAULT_FILTERS).some(([k, v]) => {
  const cur = el.filters[k];
  return k === 'duotone' ? !!(cur?.dark && cur?.light) : cur !== undefined && cur !== null && cur !== v;
});

const PRESET_TEXT = new Set(['none', undefined, null]);

/** The picture a photo or video shows: "asset:<id>:file" (a video's still, where it starts) or a video's ":poster". */
function pictureToken(doc, el) {
  if (el.type !== 'video') return `asset:${el.assetId}:file`;
  return stillIsCurrent(doc, el) ? `asset:${el.still}:file` : `asset:${el.assetId}:poster`;
}

/**
 * How an element goes into a slide: 'text', 'note', 'shape', 'line',
 * 'picture', 'path', 'group', or 'raster'. With `media` (the pictures there
 * are, as buildPptx takes them), a photo whose picture isn't there is a
 * 'raster' too.
 */
export function pptxKind(doc, el, media = null) {
  if (el.shadow) return 'raster';
  switch (el.type) {
    case 'text':
      if (el.curve || !PRESET_TEXT.has(el.effect?.type ?? 'none')) return 'raster';
      // A sticky note: a square of its color with the text inside.
      return el.note ? 'note' : 'text';
    case 'shape':
      return 'shape';
    case 'line':
      return 'line';
    case 'draw':
      return 'path';
    case 'image':
    case 'video': {
      const asset = doc.assets[el.assetId];
      if (!asset) return el.assetId ? 'raster' : 'skip'; // an empty frame shows nothing in downloads
      if (el.type === 'video' && !asset.poster && !stillIsCurrent(doc, el)) return 'raster';
      if (media && !media.has(pictureToken(doc, el))) return 'raster';
      return hasFilters(el) ? 'raster' : 'picture';
    }
    case 'group':
      return (el.opacity ?? 1) >= 1 && el.children.every((c) => c.hidden || ['text', 'note', 'shape', 'line', 'path', 'picture', 'group', 'skip'].includes(pptxKind(doc, c, media))) ? 'group' : 'raster';
    default:
      return 'raster';
  }
}

/** The page-px box of an element turned by its rotation, padded for shadows and glows. */
function pictureBox(doc, el) {
  const pad = effectPad(el);
  const r = ((el.rotation || 0) * Math.PI) / 180;
  const cw = Math.abs(el.w * Math.cos(r)) + Math.abs(el.h * Math.sin(r));
  const ch = Math.abs(el.w * Math.sin(r)) + Math.abs(el.h * Math.cos(r));
  const cx = el.x + el.w / 2;
  const cy = el.y + el.h / 2;
  const x0 = Math.max(0, Math.floor(cx - cw / 2 - pad));
  const y0 = Math.max(0, Math.floor(cy - ch / 2 - pad));
  const x1 = Math.min(doc.width, Math.ceil(cx + cw / 2 + pad));
  const y1 = Math.min(doc.height, Math.ceil(cy + ch / 2 + pad));
  return x1 - x0 > 0 && y1 - y0 > 0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/** Which elements of these pages need a picture: [{ page, key, box }] (box in page px). media as for pptxKind. */
export function planPptx(doc, pages, media = null) {
  const wants = [];
  for (const i of pages) {
    for (const el of doc.pages[i].elements) {
      if (el.hidden || pptxKind(doc, el, media) !== 'raster') continue;
      const box = pictureBox(doc, el);
      if (box) wants.push({ page: i, key: el.id, box });
    }
  }
  return wants;
}

// ---------- DrawingML pieces ----------

/** A color as <a:srgbClr>, with its see-through amount. */
function color(hex, alpha = 1) {
  const h = (normalizeHex(hex) || '#000000').slice(1).toUpperCase();
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 100000);
  return a < 100000 ? `<a:srgbClr val="${h}"><a:alpha val="${a}"/></a:srgbClr>` : `<a:srgbClr val="${h}"/>`;
}

/** A fill for a w × h box: a color, a gradient, or none. */
function fill(paint, alpha = 1, w = 1, h = 1) {
  if (!paint) return '<a:noFill/>';
  if (typeof paint === 'string') {
    if (!normalizeHex(paint)) return '<a:noFill/>';
    return `<a:solidFill>${color(paint, alpha)}</a:solidFill>`;
  }
  const sorted = sortedStops(paint);
  if (!sorted.length) return '<a:noFill/>';
  let stops = (sorted.length === 1 ? [sorted[0], { ...sorted[0], offset: 1 }] : sorted).map((s) => ({ ...s, offset: Math.max(0, Math.min(1, s.offset)) }));
  const gs = () => stops.map((s) => `<a:gs pos="${Math.round(s.offset * 100000)}">${color(s.color, alpha * (s.opacity ?? 1))}</a:gs>`).join('');
  if (paint.type === 'radial') return `<a:gradFill rotWithShape="1"><a:gsLst>${gs()}</a:gsLst><a:path path="circle"><a:fillToRect l="50000" t="50000" r="50000" b="50000"/></a:path></a:gradFill>`;
  // The page draws it in the box's own units (objectBoundingBox): from one
  // side of the middle to the other along our angle (0 up, 90 right) in a
  // unit square, stretched to w × h. So the colors run, on the slide, along
  // (sin a / w, -cos a / h); PowerPoint's angle turns clockwise from "right".
  const a = ((paint.angle ?? 180) * Math.PI) / 180;
  const ang = ((((Math.atan2(-Math.cos(a) / (h || 1), Math.sin(a) / (w || 1)) * 180) / Math.PI) % 360) + 360) % 360;
  // PowerPoint's run of colors reaches the box's corners, |sin a| + |cos a|
  // times the page's: the stops move in toward the middle by as much, with
  // the end colors on beyond them, as the page pads them.
  const reach = Math.abs(Math.sin(a)) + Math.abs(Math.cos(a));
  if (reach > 1.0001) {
    stops = stops.map((s) => ({ ...s, offset: 0.5 + (s.offset - 0.5) / reach }));
    stops = [{ ...stops[0], offset: 0 }, ...stops, { ...stops[stops.length - 1], offset: 1 }];
  }
  return `<a:gradFill rotWithShape="1"><a:gsLst>${gs()}</a:gsLst><a:lin ang="${Math.round(ang * 60000) % 21600000}" scaled="0"/></a:gradFill>`;
}

function line(el, emu, alpha) {
  const sw = el.type === 'shape' ? (el.stroke ? el.strokeWidth || 0 : 0) : el.strokeWidth || 0;
  if (!sw || !el.stroke) return '<a:ln><a:noFill/></a:ln>';
  const dash = el.dash === 'dashed' ? '<a:prstDash val="dash"/>' : el.dash === 'dotted' ? '<a:prstDash val="sysDot"/>' : '';
  const round = el.type === 'draw' || el.dash === 'dotted' || el.dash === 'dashed';
  const ends = el.type === 'line' ? `${el.startCap === 'arrow' ? '<a:headEnd type="triangle" w="med" len="med"/>' : ''}${el.endCap === 'arrow' ? '<a:tailEnd type="triangle" w="med" len="med"/>' : ''}` : '';
  return `<a:ln w="${Math.round(sw * emu)}"${round ? ' cap="rnd"' : ''}><a:solidFill>${color(el.stroke, alpha)}</a:solidFill>${dash}<a:round/>${ends}</a:ln>`;
}

/** Where an element sits: offset, size, turn and flips. */
function xfrm(el, emu, tag = 'a:xfrm', extra = '') {
  const rot = Math.round((((el.rotation || 0) % 360) + 360) % 360 * 60000);
  const attrs = `${rot ? ` rot="${rot}"` : ''}${el.flipX ? ' flipH="1"' : ''}${el.flipY ? ' flipV="1"' : ''}`;
  return `<${tag}${attrs}><a:off x="${Math.round(el.x * emu)}" y="${Math.round(el.y * emu)}"/><a:ext cx="${Math.max(0, Math.round(el.w * emu))}" cy="${Math.max(0, Math.round(el.h * emu))}"/>${extra}</${tag}>`;
}

/** An outline (SVG path data in the element's box) as a PowerPoint drawn shape. */
function custGeom(d, w, h, emu, { open = false } = {}) {
  const pt = (x, y) => `<a:pt x="${Math.round(x * emu)}" y="${Math.round(y * emu)}"/>`;
  const parts = parsePath(d).map((s) => {
    if (s[0] === 'M') return `<a:moveTo>${pt(s[1], s[2])}</a:moveTo>`;
    if (s[0] === 'L') return `<a:lnTo>${pt(s[1], s[2])}</a:lnTo>`;
    if (s[0] === 'C') return `<a:cubicBezTo>${pt(s[1], s[2])}${pt(s[3], s[4])}${pt(s[5], s[6])}</a:cubicBezTo>`;
    return '<a:close/>';
  });
  const W = Math.max(1, Math.round(w * emu));
  const H = Math.max(1, Math.round(h * emu));
  return `<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="${W}" b="${H}"/><a:pathLst><a:path w="${W}" h="${H}"${open ? ' fill="none"' : ''}>${parts.join('')}</a:path></a:pathLst></a:custGeom>`;
}

/** Preset geometry where one matches the shape, else its outline drawn. */
function geometry(shape, el, emu, d) {
  const preset = (name, adj = '') => `<a:prstGeom prst="${name}"><a:avLst>${adj}</a:avLst></a:prstGeom>`;
  if (shape === 'rect') {
    const r = Math.max(0, Math.min(el.radius || 0, el.w / 2, el.h / 2));
    if (!r) return preset('rect');
    return preset('roundRect', `<a:gd name="adj" fmla="val ${Math.round((r / Math.min(el.w, el.h)) * 100000)}"/>`);
  }
  if (shape === 'ellipse') return preset('ellipse');
  if (shape === 'triangle') return preset('triangle');
  if (shape === 'diamond') return preset('diamond');
  return custGeom(d, el.w, el.h, emu);
}

// ---------- slides ----------

class Slide {
  constructor(doc, emu, media, have) {
    this.doc = doc;
    this.emu = emu;
    this.media = media; // token -> the picture, with its file name once used
    this.have = have; // the pictures there are (env.media), for pptxKind
    this.rels = []; // [rId, type, target]
    this.nextId = 2;
    this.images = new Map(); // media name -> rId
  }
  id() {
    return this.nextId++;
  }
  rel(type, target) {
    const rid = `rId${this.rels.length + 1}`;
    this.rels.push([rid, type, target]);
    return rid;
  }
  /** The relationship to a picture in ppt/media. */
  imageRel(name) {
    if (!this.images.has(name)) this.images.set(name, this.rel(`${REL}/image`, `../media/${name}`));
    return this.images.get(name);
  }

  element(el) {
    switch (pptxKind(this.doc, el, this.have)) {
      case 'text':
        return this.text(el);
      case 'note':
        return this.text(el, { note: true });
      case 'shape':
        return this.shape(el);
      case 'line':
        return this.line(el);
      case 'path':
        return this.path(el);
      case 'picture':
        return this.picture(el);
      case 'group':
        return this.group(el);
      default:
        return '';
    }
  }

  nv(kind, name, extra = '') {
    return `<p:nv${kind}Pr><p:cNvPr id="${this.id()}" name="${xmlText(name)}"/><p:cNv${kind}Pr${extra}/><p:nvPr/></p:nv${kind}Pr>`;
  }

  shape(el) {
    const a = el.opacity ?? 1;
    return `<p:sp>${this.nv('Sp', `Shape ${this.nextId}`)}<p:spPr>${xfrm(el, this.emu)}${geometry(el.shape, el, this.emu, shapePath(el))}${fill(el.fill, a, el.w, el.h)}${line(el, this.emu, a)}</p:spPr></p:sp>`;
  }

  line(el) {
    // A straight line across the middle of its box.
    const box = { ...el, y: el.y + el.h / 2, h: 0 };
    return `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="${this.id()}" name="Line ${this.nextId - 1}"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr>${xfrm(box, this.emu)}<a:prstGeom prst="line"><a:avLst/></a:prstGeom>${line({ ...el, stroke: el.stroke || '#000000', strokeWidth: el.strokeWidth || 4 }, this.emu, el.opacity ?? 1)}</p:spPr></p:cxnSp>`;
  }

  path(el) {
    const d = drawPath(el);
    if (!d) return '';
    return `<p:sp>${this.nv('Sp', `Drawing ${this.nextId}`)}<p:spPr>${xfrm(el, this.emu)}${custGeom(d, el.w, el.h, this.emu, { open: true })}<a:noFill/>${line(el, this.emu, el.opacity ?? 1)}</p:spPr></p:sp>`;
  }

  picture(el) {
    // (A video shows its still, where it starts, else the poster taken when it was added.)
    const m = this.media(pictureToken(this.doc, el));
    if (!m) return '';
    const rid = this.imageRel(m.name);
    const c = el.crop || { x: 0, y: 0, w: 1, h: 1 };
    const pct = (v) => Math.round(v * 100000);
    const src = c.x || c.y || c.w !== 1 || c.h !== 1 ? `<a:srcRect l="${pct(c.x)}" t="${pct(c.y)}" r="${pct(1 - c.x - c.w)}" b="${pct(1 - c.y - c.h)}"/>` : '';
    const a = el.opacity ?? 1;
    const blip = `<a:blip r:embed="${rid}">${a < 1 ? `<a:alphaModFix amt="${Math.round(a * 100000)}"/>` : ''}</a:blip>`;
    const mask = !el.mask || el.mask === 'none' ? 'rect' : el.mask === 'circle' ? 'ellipse' : el.mask;
    return `<p:pic><p:nvPicPr><p:cNvPr id="${this.id()}" name="Picture ${this.nextId - 1}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill>${blip}${src}<a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm(el, this.emu)}${geometry(mask, el, this.emu, maskPath(el))}</p:spPr></p:pic>`;
  }

  /** A PNG of an element (made by the app), upright in its page box. */
  raster(name, box) {
    const rid = this.imageRel(name);
    return `<p:pic><p:nvPicPr><p:cNvPr id="${this.id()}" name="Picture ${this.nextId - 1}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm(box, this.emu)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
  }

  group(el) {
    const kids = el.children.filter((c) => !c.hidden).map((c) => this.element(c)).join('');
    const ext = `<a:chOff x="0" y="0"/><a:chExt cx="${Math.max(1, Math.round(el.w * this.emu))}" cy="${Math.max(1, Math.round(el.h * this.emu))}"/>`;
    return `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="${this.id()}" name="Group ${this.nextId - 1}"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr>${xfrm(el, this.emu, 'a:xfrm', ext)}</p:grpSpPr>${kids}</p:grpSp>`;
  }

  /** A text box; with { note: true } a sticky note (its color behind, the text inside its edges). */
  text(el, { note = false } = {}) {
    const emu = this.emu;
    const pt = (px) => (px * emu) / 12700; // points
    const size = Math.max(1, Math.min(4000, Math.round(pt(el.size) * 100) / 100));
    const a = el.opacity ?? 1;
    const run = [
      'lang="en-US"',
      `sz="${Math.round(size * 100)}"`,
      (el.weight || 400) >= 600 ? 'b="1"' : 'b="0"',
      el.italic ? 'i="1"' : '',
      el.underline ? 'u="sng"' : '',
      el.strike ? 'strike="sngStrike"' : '',
      el.caps ? 'cap="all"' : '',
      el.letterSpacing ? `spc="${Math.round(pt(el.letterSpacing) * 100)}"` : '',
      'dirty="0"',
    ].filter(Boolean).join(' ');
    const outline = el.outline?.width ? `<a:ln w="${Math.round(el.outline.width * 2 * emu)}"><a:solidFill>${color(el.outline.color, a)}</a:solidFill></a:ln>` : '';
    const highlight = el.highlight?.color && normalizeHex(el.highlight.color) ? `<a:highlight>${color(el.highlight.color)}</a:highlight>` : '';
    const font = xmlText(el.font || 'Inter');
    const rPr = (tag) => `<a:${tag} ${run}>${outline}<a:solidFill>${color(el.color, a)}</a:solidFill>${highlight}<a:latin typeface="${font}"/><a:cs typeface="${font}"/></a:${tag}>`;
    const algn = { left: 'l', center: 'ctr', right: 'r', justify: 'just' }[el.align] || 'l';
    const spacing = `<a:lnSpc><a:spcPts val="${Math.round(pt(el.size * (el.lineHeight || 1.2)) * 100)}"/></a:lnSpc>`;
    const indent = Math.round(el.size * 1.1 * emu);
    // (A document's text cut for its sheets numbers on from `listStart`, and
    // when it `continues` a list item, its first line has no mark of its own.)
    // Numbers count on over blank lines, as the page counts them. A paragraph
    // without a number ends PowerPoint's run of numbers, so the run after it
    // starts where the count is (startAt), as does a piece that starts later.
    let next = Math.max(1, Math.round(el.listStart || 1));
    let runStart = 0; // the number the run of numbered paragraphs began at (0: not in one)
    const paras = String(el.text ?? '').split('\n').map((t, i) => {
      let bullet = '<a:buNone/>';
      let margin = '';
      if (el.list && t.trim() && i === 0 && el.continues) {
        margin = ` marL="${indent}" indent="0"`;
      } else if (el.list === 'bullet' && t.trim()) {
        bullet = '<a:buFont typeface="Arial"/><a:buChar char="•"/>';
        margin = ` marL="${indent}" indent="-${indent}"`;
      } else if (el.list === 'number' && t.trim()) {
        if (!runStart) runStart = next;
        next++;
        bullet = `<a:buFont typeface="+mj-lt"/><a:buAutoNum type="arabicPeriod"${runStart > 1 ? ` startAt="${runStart}"` : ''}/>`;
        margin = ` marL="${indent}" indent="-${indent}"`;
      }
      if (!bullet.includes('buAutoNum')) runStart = 0;
      const pPr = `<a:pPr algn="${algn}"${margin}>${spacing}${bullet}</a:pPr>`;
      return `<a:p>${pPr}${t ? `<a:r>${rPr('rPr')}<a:t>${xmlText(t)}</a:t></a:r>` : ''}${rPr('endParaRPr')}</a:p>`;
    }).join('');
    const pad = el.highlight ? Math.round((el.highlight.padding ?? 0) * emu) : 0;
    const body = (l, t) => `<p:txBody><a:bodyPr wrap="square" lIns="${l}" tIns="${t}" rIns="${l}" bIns="${t}" rtlCol="0" anchor="t"><a:noAutofit/></a:bodyPr><a:lstStyle/>${paras}</p:txBody></p:sp>`;
    if (note) {
      // As the page draws it: rounded a little, lifted off the page by a soft shadow.
      const r = Math.min(8, el.w * 0.02);
      const adj = Math.round((r / Math.max(1, Math.min(el.w, el.h))) * 100000);
      const inset = Math.round(notePad(el) * emu);
      const lift = Math.round((el.h * 0.012 + 2) * emu);
      return `<p:sp>${this.nv('Sp', `Sticky note ${this.nextId}`)}<p:spPr>${xfrm(el, emu)}<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val ${adj}"/></a:avLst></a:prstGeom>${fill(el.note, a)}<a:ln><a:noFill/></a:ln>` +
        `<a:effectLst><a:outerShdw dist="${lift}" dir="5400000" algn="t" rotWithShape="0"><a:srgbClr val="000000"><a:alpha val="${Math.round(12000 * a)}"/></a:srgbClr></a:outerShdw></a:effectLst></p:spPr>` +
        body(inset, inset + pad);
    }
    return `<p:sp>${this.nv('Sp', `Text ${this.nextId}`, ' txBox="1"')}<p:spPr>${xfrm(el, emu)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>` +
      body(0, pad);
  }

  /** The slide's background fill: its color or gradient (a photo's color behind it). */
  background(page) {
    const bg = page.background;
    if (!bg) return '';
    const f = bg.type === 'color' ? fill(bg.color) : bg.type === 'gradient' ? fill(bg.gradient, 1, this.doc.width, this.doc.height) : bg.type === 'image' ? fill(bg.color || '#ffffff') : null;
    return f ? `<p:bg><p:bgPr>${f}<a:effectLst/></p:bgPr></p:bg>` : '';
  }

  /**
   * A background photo: a locked picture filling the slide behind everything,
   * its overflow cropped evenly as the page does. (Slide backgrounds can't be
   * cropped in every app; pictures can.)
   */
  backgroundPicture(page) {
    const bg = page.background;
    const m = bg?.type === 'image' ? this.media(`asset:${bg.assetId}:file`) : null;
    if (!m) return '';
    const { width: W, height: H } = this.doc;
    const s = Math.max(W / (m.width || 1), H / (m.height || 1));
    const cx = (1 - W / ((m.width || 1) * s)) / 2;
    const cy = (1 - H / ((m.height || 1) * s)) / 2;
    const p = (v) => Math.round(v * 100000);
    return `<p:pic><p:nvPicPr><p:cNvPr id="${this.id()}" name="Background"/><p:cNvPicPr><a:picLocks noGrp="1" noSelect="1" noRot="1" noChangeAspect="1" noMove="1" noResize="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>` +
      `<p:blipFill><a:blip r:embed="${this.imageRel(m.name)}"/><a:srcRect l="${p(cx)}" t="${p(cy)}" r="${p(cx)}" b="${p(cy)}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
      `<p:spPr>${xfrm({ x: 0, y: 0, w: W, h: H }, this.emu)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
  }
}

const GROUP_ROOT = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';

function relsXml(rels) {
  return `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.map(([id, type, target]) => `<Relationship Id="${id}" Type="${type}" Target="${xmlText(target)}"/>`).join('')}</Relationships>`;
}

// Paperwall's own theme: its colors and fonts, three of each style PowerPoint asks for.
function themeXml(name) {
  const c = (n, hex) => `<a:${n}><a:srgbClr val="${hex}"/></a:${n}>`;
  const solid = (hex) => `<a:solidFill><a:srgbClr val="${hex}"/></a:solidFill>`;
  const ln = (w) => `<a:ln w="${w}" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/><a:miter lim="800000"/></a:ln>`;
  const phFill = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
  return `${XML}<a:theme xmlns:a="${NS_A}" name="${name}"><a:themeElements>` +
    `<a:clrScheme name="Paperwall">${c('dk1', '16161D')}${c('lt1', 'FFFFFF')}${c('dk2', '2B2B3A')}${c('lt2', 'F3F0EA')}${c('accent1', 'F25C2A')}${c('accent2', 'FF9F43')}${c('accent3', 'FFD166')}${c('accent4', '06D6A0')}${c('accent5', '118AB2')}${c('accent6', '5B5BD6')}${c('hlink', '118AB2')}${c('folHlink', '5B5BD6')}</a:clrScheme>` +
    '<a:fontScheme name="Paperwall"><a:majorFont><a:latin typeface="Inter"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Inter"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>' +
    `<a:fmtScheme name="Paperwall"><a:fillStyleLst>${phFill}${phFill}${phFill}</a:fillStyleLst><a:lnStyleLst>${ln(6350)}${ln(12700)}${ln(19050)}</a:lnStyleLst>` +
    '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>' +
    `<a:bgFillStyleLst>${phFill}${solid('F3F0EA')}${solid('16161D')}</a:bgFillStyleLst></a:fmtScheme>` +
    '</a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>';
}

const CLR_MAP = 'bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"';

function masterXml() {
  const lvl = (sz) => `<a:lvl1pPr><a:defRPr sz="${sz}"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl1pPr>`;
  return `${XML}<p:sldMaster ${NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${GROUP_ROOT}</p:spTree></p:cSld>` +
    `<p:clrMap ${CLR_MAP}/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>` +
    `<p:txStyles><p:titleStyle>${lvl(4400)}</p:titleStyle><p:bodyStyle>${lvl(2800)}</p:bodyStyle><p:otherStyle>${lvl(1800)}</p:otherStyle></p:txStyles></p:sldMaster>`;
}

function layoutXml() {
  return `${XML}<p:sldLayout ${NS} type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>${GROUP_ROOT}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
}

function notesMasterXml() {
  const ph = (id, name, type, x, y, w, h, extra = '') => `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="${type}"${extra}/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>${type === 'body' ? '<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody>' : ''}</p:sp>`;
  return `${XML}<p:notesMaster ${NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${GROUP_ROOT}` +
    `${ph(2, 'Slide picture', 'sldImg', 381000, 685800, 6096000, 3429000)}${ph(3, 'Notes', 'body', 685800, 4343400, 5486400, 4114800, ' idx="1"')}</p:spTree></p:cSld>` +
    `<p:clrMap ${CLR_MAP}/><p:notesStyle><a:lvl1pPr marL="0" algn="l"><a:defRPr sz="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl1pPr></p:notesStyle></p:notesMaster>`;
}

function notesSlideXml(text) {
  const paras = String(text).split(/\r\n?|\n/).map((t) => `<a:p>${t ? `<a:r><a:rPr lang="en-US" dirty="0"/><a:t>${xmlText(t)}</a:t></a:r>` : ''}<a:endParaRPr lang="en-US" dirty="0"/></a:p>`).join('');
  return `${XML}<p:notes ${NS}><p:cSld><p:spTree>${GROUP_ROOT}` +
    '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide picture"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp>' +
    `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${paras}</p:txBody></p:sp>` +
    '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>';
}

/** Speaker notes worth keeping: plain text only. */
function notesOf(page) {
  return typeof page.notes === 'string' && page.notes.trim() ? page.notes : null;
}

/**
 * The .pptx file. env: { media: Map(token -> { bytes, ext: 'png'|'jpeg',
 * width, height }) for the design's pictures ("asset:<id>:file", or
 * ":poster" for a video's), pictures: Map("<page>:<key>" -> PNG bytes) for
 * the elements planPptx (given the same media) listed, title }.
 */
export function buildPptx(doc, pages, env = {}) {
  if (!pages.length) throw new Error('A presentation needs at least one slide');
  const emu = emuPerPx(doc);
  const files = [];
  const add = (name, text) => files.push({ name, data: typeof text === 'string' ? enc.encode(text) : text });
  // Pictures go in ppt/media once each, named in order of first use.
  const mediaFiles = [];
  const named = new Map();
  const media = (token) => {
    const m = env.media?.get(token);
    if (!m) return null;
    if (!named.has(token)) {
      const name = `image${mediaFiles.length + 1}.${m.ext === 'jpeg' ? 'jpeg' : 'png'}`;
      named.set(token, { ...m, name });
      mediaFiles.push([name, m.bytes]);
    }
    return named.get(token);
  };
  const plan = new Map(planPptx(doc, pages, env.media).map((w) => [`${w.page}:${w.key}`, w.box]));
  const withNotes = pages.filter((i) => notesOf(doc.pages[i]));
  const slides = pages.map((index, n) => {
    const page = doc.pages[index];
    const s = new Slide(doc, emu, media, env.media);
    s.rel(`${REL}/slideLayout`, '../slideLayouts/slideLayout1.xml');
    const behind = s.backgroundPicture(page);
    const shapes = page.elements.filter((el) => !el.hidden).map((el) => {
      const key = `${index}:${el.id}`;
      if (plan.has(key)) {
        const png = env.pictures?.get(key);
        if (!png) return '';
        const name = `image${mediaFiles.length + 1}.png`;
        mediaFiles.push([name, png]);
        return s.raster(name, plan.get(key));
      }
      return s.element(el);
    }).join('');
    if (notesOf(page)) s.rel(`${REL}/notesSlide`, `../notesSlides/notesSlide${withNotes.indexOf(index) + 1}.xml`);
    const xml = `${XML}<p:sld ${NS}><p:cSld>${s.background(page)}<p:spTree>${GROUP_ROOT}${behind}${shapes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
    return { xml, rels: s.rels, n: n + 1, index };
  });
  const cx = Math.round(doc.width * emu);
  const cy = Math.round(doc.height * emu);
  const presRels = [[`rId1`, `${REL}/slideMaster`, 'slideMasters/slideMaster1.xml']];
  slides.forEach((s) => presRels.push([`rId${presRels.length + 1}`, `${REL}/slide`, `slides/slide${s.n}.xml`]));
  const themeRid = `rId${presRels.length + 1}`;
  presRels.push([themeRid, `${REL}/theme`, 'theme/theme1.xml']);
  presRels.push([`rId${presRels.length + 1}`, `${REL}/presProps`, 'presProps.xml']);
  presRels.push([`rId${presRels.length + 1}`, `${REL}/viewProps`, 'viewProps.xml']);
  let notesMaster = '';
  if (withNotes.length) {
    const rid = `rId${presRels.length + 1}`;
    presRels.push([rid, `${REL}/notesMaster`, 'notesMasters/notesMaster1.xml']);
    notesMaster = `<p:notesMasterIdLst><p:notesMasterId r:id="${rid}"/></p:notesMasterIdLst>`;
  }
  const types = [
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Default Extension="png" ContentType="image/png"/>',
    '<Default Extension="jpeg" ContentType="image/jpeg"/>',
    `<Override PartName="/ppt/presentation.xml" ContentType="${CT}.presentation.main+xml"/>`,
    `<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="${CT}.slideMaster+xml"/>`,
    `<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="${CT}.slideLayout+xml"/>`,
    ...slides.map((s) => `<Override PartName="/ppt/slides/slide${s.n}.xml" ContentType="${CT}.slide+xml"/>`),
    '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>',
    `<Override PartName="/ppt/presProps.xml" ContentType="${CT}.presProps+xml"/>`,
    `<Override PartName="/ppt/viewProps.xml" ContentType="${CT}.viewProps+xml"/>`,
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>',
    '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>',
  ];
  if (withNotes.length) {
    types.push(`<Override PartName="/ppt/notesMasters/notesMaster1.xml" ContentType="${CT}.notesMaster+xml"/>`);
    types.push('<Override PartName="/ppt/theme/theme2.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>');
    withNotes.forEach((_, k) => types.push(`<Override PartName="/ppt/notesSlides/notesSlide${k + 1}.xml" ContentType="${CT}.notesSlide+xml"/>`));
  }
  add('[Content_Types].xml', `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${types.join('')}</Types>`);
  add('_rels/.rels', relsXml([
    ['rId1', `${REL}/officeDocument`, 'ppt/presentation.xml'],
    ['rId2', 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties', 'docProps/core.xml'],
    ['rId3', `${REL}/extended-properties`, 'docProps/app.xml'],
  ]));
  const title = xmlText(env.title || doc.name || 'Paperwall design');
  add('docProps/core.xml', `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${title}</dc:title><dc:creator>Paperwall</dc:creator></cp:coreProperties>`);
  add('docProps/app.xml', `${XML}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Paperwall</Application><Slides>${slides.length}</Slides><Notes>${withNotes.length}</Notes></Properties>`);
  add('ppt/presentation.xml', `${XML}<p:presentation ${NS} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>${notesMaster}` +
    `<p:sldIdLst>${slides.map((s) => `<p:sldId id="${255 + s.n}" r:id="rId${s.n + 1}"/>`).join('')}</p:sldIdLst>` +
    `<p:sldSz cx="${cx}" cy="${cy}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`);
  add('ppt/_rels/presentation.xml.rels', relsXml(presRels));
  add('ppt/presProps.xml', `${XML}<p:presentationPr ${NS}/>`);
  add('ppt/viewProps.xml', `${XML}<p:viewPr ${NS}/>`);
  add('ppt/theme/theme1.xml', themeXml('Paperwall'));
  add('ppt/slideMasters/slideMaster1.xml', masterXml());
  add('ppt/slideMasters/_rels/slideMaster1.xml.rels', relsXml([['rId1', `${REL}/slideLayout`, '../slideLayouts/slideLayout1.xml'], ['rId2', `${REL}/theme`, '../theme/theme1.xml']]));
  add('ppt/slideLayouts/slideLayout1.xml', layoutXml());
  add('ppt/slideLayouts/_rels/slideLayout1.xml.rels', relsXml([['rId1', `${REL}/slideMaster`, '../slideMasters/slideMaster1.xml']]));
  for (const s of slides) {
    add(`ppt/slides/slide${s.n}.xml`, s.xml);
    add(`ppt/slides/_rels/slide${s.n}.xml.rels`, relsXml(s.rels));
  }
  if (withNotes.length) {
    add('ppt/theme/theme2.xml', themeXml('Paperwall notes'));
    add('ppt/notesMasters/notesMaster1.xml', notesMasterXml());
    add('ppt/notesMasters/_rels/notesMaster1.xml.rels', relsXml([['rId1', `${REL}/theme`, '../theme/theme2.xml']]));
    withNotes.forEach((index, k) => {
      const slide = slides.find((s) => s.index === index);
      add(`ppt/notesSlides/notesSlide${k + 1}.xml`, notesSlideXml(notesOf(doc.pages[index])));
      add(`ppt/notesSlides/_rels/notesSlide${k + 1}.xml.rels`, relsXml([['rId1', `${REL}/notesMaster`, '../notesMasters/notesMaster1.xml'], ['rId2', `${REL}/slide`, `../slides/slide${slide.n}.xml`]]));
    });
  }
  for (const [name, bytes] of mediaFiles) add(`ppt/media/${name}`, bytes);
  return buildZip(files);
}
