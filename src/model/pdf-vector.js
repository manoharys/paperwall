// The vector PDF: pages drawn with PDF's own paths, gradients and pictures,
// and text in embedded fonts (subsets of them), so everything stays sharp
// and the text can be selected and searched. Each element is drawn from the
// renderer's own markup, so the PDF matches what you see. Whatever PDF can't
// draw directly (shadows, glows, photo filters, curved text, letters a font
// doesn't have) comes as a picture of just that element: planVectorPdf says
// which, the app draws them, and buildVectorPdf puts them in place.
// Written from the PDF 1.7 spec (ISO 32000-1).
//
// A "print" PDF is the same, with the page grown by the bleed so pictures
// and backgrounds run past the edge, a TrimBox and BleedBox, and crop marks.

import { elementMarkup, backgroundMarkup, transformOf } from './render.js';
import { parseSvg, byId } from './svg-read.js';
import { parseFont, subsetFont, glyphFor } from './sfnt.js';
import { deflate } from './deflate.js';
import { fontByName, nearestWeight } from './fonts.js';
import { printDpi } from './doc.js';
import { bleedSize } from './view.js';
import { concat } from './bytes.js';

const enc = new TextEncoder();

/** Something PDF can't draw as vectors here: the element becomes a picture. */
export class Unsupported extends Error {}
const no = (why) => {
  throw new Unsupported(why);
};

const num = (v) => {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) || !Number.isFinite(r) ? '0' : String(r);
};

// ---------- matrices ([a b c d e f], as PDF writes them) ----------

const ID = [1, 0, 0, 1, 0, 0];
/** m, then n. */
export function mul(m, n) {
  return [
    m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5],
  ];
}
function invert(m) {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!det) return ID;
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
}
const apply = (m, x, y) => [x * m[0] + y * m[2] + m[4], x * m[1] + y * m[3] + m[5]];
const isId = (m) => m.every((v, i) => Math.abs(v - ID[i]) < 1e-9);
const cm = (m) => `${m.map(num).join(' ')} cm`;

/** An SVG transform list as one matrix. */
export function parseTransform(s) {
  let m = ID;
  if (!s) return m;
  for (const [, kind, args] of s.matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const a = (args.match(/[-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/gi) || []).map(Number);
    let t;
    if (kind === 'translate') t = [1, 0, 0, 1, a[0] || 0, a[1] || 0];
    else if (kind === 'scale') t = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0];
    else if (kind === 'rotate') {
      const r = ((a[0] || 0) * Math.PI) / 180;
      const [c, sn] = [Math.cos(r), Math.sin(r)];
      t = [c, sn, -sn, c, 0, 0];
      if (a.length >= 3) t = mul(mul([1, 0, 0, 1, -a[1], -a[2]], t), [1, 0, 0, 1, a[1], a[2]]);
    } else if (kind === 'matrix' && a.length === 6) t = a;
    else if (kind === 'skewX') t = [1, 0, Math.tan(((a[0] || 0) * Math.PI) / 180), 1, 0, 0];
    else if (kind === 'skewY') t = [1, Math.tan(((a[0] || 0) * Math.PI) / 180), 0, 1, 0, 0];
    else no(`transform ${kind}`);
    m = mul(t, m);
  }
  return m;
}

// ---------- paths ----------

/**
 * SVG path data as absolute moves, lines and cubic curves:
 * [['M', x, y], ['L', x, y], ['C', x1, y1, x2, y2, x, y], ['Z']].
 */
export function parsePath(d) {
  const out = [];
  let i = 0;
  const s = String(d || '');
  const ws = () => {
    while (i < s.length && /[\s,]/.test(s[i])) i++;
  };
  const number = () => {
    ws();
    const m = /^[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/.exec(s.slice(i, i + 40));
    if (!m) return null;
    i += m[0].length;
    return +m[0];
  };
  const flag = () => {
    ws();
    const c = s[i];
    if (c !== '0' && c !== '1') return null;
    i++;
    return c === '1';
  };
  let cmd = null;
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  let lastC = null; // last cubic control point, for S
  let lastQ = null; // last quadratic control point, for T
  while (i < s.length) {
    ws();
    if (i >= s.length) break;
    if (/[a-zA-Z]/.test(s[i])) cmd = s[i++];
    else if (!cmd) no('path data');
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const ox = rel ? x : 0;
    const oy = rel ? y : 0;
    if (C === 'Z') {
      out.push(['Z']);
      x = sx;
      y = sy;
      lastC = lastQ = null;
      cmd = null;
      continue;
    }
    const need = (v) => (v === null ? no('path data') : v);
    if (C === 'M' || C === 'L' || C === 'T') {
      const px = need(number()) + ox;
      const py = need(number()) + oy;
      if (C === 'T') {
        const [qx, qy] = lastQ ? [2 * x - lastQ[0], 2 * y - lastQ[1]] : [x, y];
        out.push(['C', x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), px + (2 / 3) * (qx - px), py + (2 / 3) * (qy - py), px, py]);
        lastQ = [qx, qy];
      } else {
        out.push([C === 'M' ? 'M' : 'L', px, py]);
        lastQ = null;
      }
      if (C === 'M') {
        sx = px;
        sy = py;
        cmd = rel ? 'l' : 'L'; // more pairs after a move are lines
      }
      x = px;
      y = py;
      lastC = null;
      if (C !== 'T') lastQ = null;
    } else if (C === 'H' || C === 'V') {
      const v = need(number());
      if (C === 'H') x = v + ox;
      else y = v + oy;
      out.push(['L', x, y]);
      lastC = lastQ = null;
    } else if (C === 'C' || C === 'S') {
      let x1;
      let y1;
      if (C === 'C') {
        x1 = need(number()) + ox;
        y1 = need(number()) + oy;
      } else [x1, y1] = lastC ? [2 * x - lastC[0], 2 * y - lastC[1]] : [x, y];
      const x2 = need(number()) + ox;
      const y2 = need(number()) + oy;
      const px = need(number()) + ox;
      const py = need(number()) + oy;
      out.push(['C', x1, y1, x2, y2, px, py]);
      lastC = [x2, y2];
      lastQ = null;
      x = px;
      y = py;
    } else if (C === 'Q') {
      const qx = need(number()) + ox;
      const qy = need(number()) + oy;
      const px = need(number()) + ox;
      const py = need(number()) + oy;
      out.push(['C', x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), px + (2 / 3) * (qx - px), py + (2 / 3) * (qy - py), px, py]);
      lastQ = [qx, qy];
      lastC = null;
      x = px;
      y = py;
    } else if (C === 'A') {
      const rx = need(number());
      const ry = need(number());
      const rot = need(number());
      const large = need(flag());
      const sweep = need(flag());
      const px = need(number()) + ox;
      const py = need(number()) + oy;
      for (const c of arcToCubics(x, y, rx, ry, rot, large, sweep, px, py)) out.push(c);
      x = px;
      y = py;
      lastC = lastQ = null;
    } else no(`path command ${cmd}`);
  }
  return out;
}

/** An elliptical arc as cubic curves (SVG 1.1, implementation notes F.6). */
function arcToCubics(x1, y1, rx, ry, angle, large, sweep, x2, y2) {
  if (x1 === x2 && y1 === y2) return [];
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  if (!rx || !ry) return [['L', x2, y2]];
  const phi = (angle * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const xp = cos * dx + sin * dy;
  const yp = -sin * dx + cos * dy;
  const lambda = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const numr = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp;
  const den = rx * rx * yp * yp + ry * ry * xp * xp;
  const coef = (large !== sweep ? 1 : -1) * Math.sqrt(Math.max(0, numr / den));
  const cxp = (coef * rx * yp) / ry;
  const cyp = (-coef * ry * xp) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const ang = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t1 = ang(1, 0, (xp - cxp) / rx, (yp - cyp) / ry);
  let dt = ang((xp - cxp) / rx, (yp - cyp) / ry, (-xp - cxp) / rx, (-yp - cyp) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  if (sweep && dt < 0) dt += 2 * Math.PI;
  const n = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2) - 1e-9));
  const d = dt / n;
  const k = (4 / 3) * Math.tan(d / 4);
  const pt = (ux, uy) => [cx + rx * ux * cos - ry * uy * sin, cy + rx * ux * sin + ry * uy * cos];
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = t1 + i * d;
    const b = a + d;
    const c1 = pt(Math.cos(a) - k * Math.sin(a), Math.sin(a) + k * Math.cos(a));
    const c2 = pt(Math.cos(b) + k * Math.sin(b), Math.sin(b) - k * Math.cos(b));
    const end = i === n - 1 ? [x2, y2] : pt(Math.cos(b), Math.sin(b));
    out.push(['C', ...c1, ...c2, ...end]);
  }
  return out;
}

/** Path segments as PDF path operators, optionally moved by a matrix first. */
function pathOps(segs, m = null) {
  const p = (x, y) => (m ? apply(m, x, y) : [x, y]).map(num).join(' ');
  return segs.map((s) => (s[0] === 'M' ? `${p(s[1], s[2])} m` : s[0] === 'L' ? `${p(s[1], s[2])} l` : s[0] === 'C' ? `${p(s[1], s[2])} ${p(s[3], s[4])} ${p(s[5], s[6])} c` : 'h')).join(' ');
}

/** The box around path segments (curves by their actual extremes). */
function pathBox(segs) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const add = (x, y) => {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  };
  let cx = 0;
  let cy = 0;
  for (const s of segs) {
    if (s[0] === 'M' || s[0] === 'L') {
      add(s[1], s[2]);
      [cx, cy] = [s[1], s[2]];
    } else if (s[0] === 'C') {
      add(s[5], s[6]);
      // Where the curve turns, in x and in y.
      for (const axis of [0, 1]) {
        const p0 = axis ? cy : cx;
        const p1 = s[1 + axis];
        const p2 = s[3 + axis];
        const p3 = s[5 + axis];
        const a = -p0 + 3 * p1 - 3 * p2 + p3;
        const b = 2 * (p0 - 2 * p1 + p2);
        const c = p1 - p0;
        const roots = Math.abs(a) < 1e-12 ? (Math.abs(b) < 1e-12 ? [] : [-c / b]) : (() => {
          const disc = b * b - 4 * a * c;
          if (disc < 0) return [];
          const r = Math.sqrt(disc);
          return [(-b + r) / (2 * a), (-b - r) / (2 * a)];
        })();
        for (const t of roots) {
          if (t <= 0 || t >= 1) continue;
          const u = 1 - t;
          const bez = (q0, q1, q2, q3) => u * u * u * q0 + 3 * u * u * t * q1 + 3 * u * t * t * q2 + t * t * t * q3;
          add(bez(cx, s[1], s[3], s[5]), bez(cy, s[2], s[4], s[6]));
        }
      }
      [cx, cy] = [s[5], s[6]];
    }
  }
  return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** The outline of a basic shape element (path, rect, circle...) as path segments. */
function shapeSegs(node) {
  const a = node.attrs;
  const n = (k, d = 0) => (a[k] === undefined || a[k] === '' ? d : parseFloat(a[k]));
  switch (node.tag) {
    case 'path':
      return parsePath(a.d);
    case 'rect': {
      const x = n('x');
      const y = n('y');
      const w = n('width');
      const h = n('height');
      if (!(w > 0 && h > 0)) return [];
      let rx = a.rx !== undefined ? n('rx') : a.ry !== undefined ? n('ry') : 0;
      let ry = a.ry !== undefined ? n('ry') : rx;
      rx = Math.min(Math.max(0, rx), w / 2);
      ry = Math.min(Math.max(0, ry), h / 2);
      if (!rx || !ry) return [['M', x, y], ['L', x + w, y], ['L', x + w, y + h], ['L', x, y + h], ['Z']];
      return parsePath(`M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`);
    }
    case 'circle':
    case 'ellipse': {
      const cx = n('cx');
      const cy = n('cy');
      const rx = node.tag === 'circle' ? n('r') : n('rx');
      const ry = node.tag === 'circle' ? n('r') : n('ry');
      if (!(rx > 0 && ry > 0)) return [];
      return parsePath(`M${cx - rx} ${cy}A${rx} ${ry} 0 0 1 ${cx + rx} ${cy}A${rx} ${ry} 0 0 1 ${cx - rx} ${cy}Z`);
    }
    case 'line':
      return [['M', n('x1'), n('y1')], ['L', n('x2'), n('y2')]];
    case 'polyline':
    case 'polygon': {
      const v = (a.points || '').match(/[-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/gi)?.map(Number) || [];
      const segs = [];
      for (let i = 0; i + 1 < v.length; i += 2) segs.push([i ? 'L' : 'M', v[i], v[i + 1]]);
      if (node.tag === 'polygon' && segs.length) segs.push(['Z']);
      return segs;
    }
    default:
      return no(`<${node.tag}>`);
  }
}

// ---------- colors ----------

const NAMED = { black: [0, 0, 0], white: [255, 255, 255], red: [255, 0, 0], green: [0, 128, 0], blue: [0, 0, 255], gray: [128, 128, 128], grey: [128, 128, 128], yellow: [255, 255, 0], orange: [255, 165, 0] };

/** A CSS color as [r, g, b, alpha] (0..1), null for none, or { url } for a gradient. */
export function parseColor(v, current = '#000000') {
  const s = String(v ?? '').trim();
  if (!s || s === 'none' || s === 'transparent') return null;
  if (s === 'currentColor') return parseColor(current);
  const u = /^url\(\s*['"]?#([^)'"]+)['"]?\s*\)/.exec(s);
  if (u) return { url: u[1] };
  let m = /^#([0-9a-f]{3,8})$/i.exec(s);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    if (h.length !== 6 && h.length !== 8) no(`color ${s}`);
    const n = (i) => parseInt(h.slice(i, i + 2), 16) / 255;
    return [n(0), n(2), n(4), h.length === 8 ? n(6) : 1];
  }
  m = /^rgba?\(([^)]*)\)$/i.exec(s);
  if (m) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean);
    const c = (t) => (t.endsWith('%') ? parseFloat(t) / 100 : parseFloat(t) / 255);
    const a = p[3] === undefined ? 1 : p[3].endsWith('%') ? parseFloat(p[3]) / 100 : parseFloat(p[3]);
    return [c(p[0]), c(p[1]), c(p[2]), a].map((x) => Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0)));
  }
  if (NAMED[s.toLowerCase()]) return [...NAMED[s.toLowerCase()].map((x) => x / 255), 1];
  return no(`color ${s}`);
}

const rgb = (c) => c.slice(0, 3).map(num).join(' ');

// ---------- style ----------

const INHERITED = ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset',
  'fill-opacity', 'stroke-opacity', 'color', 'font-family', 'font-size', 'font-weight', 'font-style', 'letter-spacing', 'text-anchor', 'paint-order',
  'fill-rule', 'clip-rule', 'xml:space'];
const ROOT_STYLE = { fill: '#000000', stroke: 'none', 'stroke-width': '1', 'stroke-linecap': 'butt', 'stroke-linejoin': 'miter', 'stroke-miterlimit': '4', color: '#000000', 'font-size': '16', 'font-weight': '400' };
// Attributes that change how a picture looks in ways PDF doesn't do.
const UNSUPPORTED_ATTRS = ['filter', 'mask', 'mix-blend-mode', 'style'];

function inherit(parent, node) {
  const s = { ...parent };
  for (const k of INHERITED) if (node.attrs[k] !== undefined && node.attrs[k] !== 'inherit') s[k] = node.attrs[k];
  return s;
}

// ---------- the PDF file ----------

class PdfFile {
  constructor() {
    this.objects = [null]; // by number; each a list of parts
  }
  alloc() {
    this.objects.push(null);
    return this.objects.length - 1;
  }
  set(n, body) {
    this.objects[n] = [].concat(body);
  }
  stream(n, dict, data, { compress = true } = {}) {
    let bytes = typeof data === 'string' ? latin1(data) : data;
    let d = dict;
    if (compress && bytes.length > 64) {
      bytes = deflate(bytes);
      d = `${dict.slice(0, -2)} /Filter /FlateDecode >>`;
    }
    this.set(n, [`${d.slice(0, -2)} /Length ${bytes.length} >>\nstream\n`, bytes, '\nendstream']);
  }
  bytes(root, info) {
    const chunks = [];
    const offsets = [];
    let length = 0;
    const write = (data) => {
      const b = typeof data === 'string' ? enc.encode(data) : data;
      chunks.push(b);
      length += b.length;
    };
    write('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n');
    for (let i = 1; i < this.objects.length; i++) {
      offsets[i] = length;
      write(`${i} 0 obj\n`);
      for (const p of this.objects[i] || ['null']) write(p);
      write('\nendobj\n');
    }
    const xref = length;
    let table = `xref\n0 ${this.objects.length}\n0000000000 65535 f \n`;
    for (let i = 1; i < this.objects.length; i++) table += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    write(table);
    write(`trailer\n<< /Size ${this.objects.length} /Root ${root} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    return concat(chunks);
  }
}

function latin1(s) {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

/** Text for the document info: UTF-16 with a byte-order mark, as hex. */
function pdfTextString(s) {
  let hex = 'FEFF';
  for (let i = 0; i < s.length; i++) hex += s.charCodeAt(i).toString(16).padStart(4, '0');
  return `<${hex.toUpperCase()}>`;
}

const hex4 = (n) => n.toString(16).padStart(4, '0').toUpperCase();
function utf16Hex(str) {
  let out = '';
  for (let i = 0; i < str.length; i++) out += hex4(str.charCodeAt(i));
  return out;
}

// Scripts whose letters need shaping (joining, reordering) that we don't do:
// text in them comes as a picture, drawn by the browser.
const COMPLEX = /[֐-ࣿऀ-෿฀-࿿က-႟ក-៿᠀-᢯‌‍‪-‮יִ-﷿ﹰ-﻿]/;

/** Everything shared by the pages of one PDF: fonts, pictures, opacities, gradients. */
class Resources {
  constructor(file, env) {
    this.file = file;
    this.env = env;
    this.fonts = new Map(); // key -> { name, font, glyphs: Map(gid -> text) }
    this.images = new Map(); // token -> { name, ref }
    this.gstates = new Map(); // "ca|CA" -> name
    this.shadings = new Map(); // dict -> name
    this.forms = []; // [name, ref]
    this.rasters = []; // [name, ref]
    // Font key -> parsed font, or the Error; kept on env so planning and building read each font once.
    this.parsed = env.parsedFonts ||= new Map();
    this.ref = file.alloc();
  }
  gs(ca, CA = ca) {
    const key = `${num(ca)}|${num(CA)}`;
    if (!this.gstates.has(key)) this.gstates.set(key, `GS${this.gstates.size + 1}`);
    return this.gstates.get(key);
  }
  shading(dict) {
    if (!this.shadings.has(dict)) this.shadings.set(dict, `Sh${this.shadings.size + 1}`);
    return this.shadings.get(dict);
  }
  /** The font for a family and weight, or Unsupported. */
  font(familyList, weightAttr) {
    const family = String(familyList || '').split(',')[0].trim().replace(/^['"]|['"]$/g, '');
    const weight = weightAttr === 'bold' ? 700 : weightAttr === 'normal' ? 400 : parseInt(weightAttr, 10) || 400;
    let key;
    let face = 400;
    if (fontByName(family)) {
      face = nearestWeight(family, weight);
      key = `${family}|${face}`;
    } else key = `${family}|*`;
    if (!this.parsed.has(key)) {
      const bytes = this.env.fonts?.get(key);
      let font;
      try {
        if (!bytes) throw new Error(`No font file for ${family}`);
        font = parseFont(bytes);
        if (font.restricted) throw new Error(`${family} doesn't allow embedding`);
      } catch (e) {
        font = e;
      }
      this.parsed.set(key, font);
    }
    const font = this.parsed.get(key);
    if (font instanceof Error) no(font.message);
    return { key, font, fakeBold: weight >= 600 && face < 600 };
  }
  /** Write everything out; returns the resources dictionary's object number. */
  finish() {
    const f = this.file;
    const fontDict = [];
    // (A font only an element drawn as a picture asked for isn't embedded.)
    for (const [, r] of this.fonts) if (r.committed) fontDict.push(`/${r.name} ${this.embedFont(r)} 0 R`);
    const xobjects = [...this.images.values()].filter((r) => r.used).map((r) => `/${r.name} ${r.ref} 0 R`)
      .concat(this.forms.map(([n, ref]) => `/${n} ${ref} 0 R`), this.rasters.map(([n, ref]) => `/${n} ${ref} 0 R`));
    const gs = [...this.gstates].map(([k, n]) => {
      const [ca, CA] = k.split('|');
      return `/${n} << /Type /ExtGState /ca ${ca} /CA ${CA} >>`;
    });
    const sh = [...this.shadings].map(([d, n]) => `/${n} ${d}`);
    f.set(this.ref, `<< /ProcSet [/PDF /Text /ImageB /ImageC] /Font << ${fontDict.join(' ')} >> /XObject << ${xobjects.join(' ')} >> /ExtGState << ${gs.join(' ')} >> /Shading << ${sh.join(' ')} >> >>`);
    return this.ref;
  }
  /** A Type 0 font with an embedded TrueType subset, Identity-H, and a ToUnicode map. */
  embedFont(r) {
    const f = this.file;
    const { font } = r;
    const gids = [...r.glyphs.keys()].sort((a, b) => a - b);
    const tag = subsetTag(gids, font.name);
    const base = `${tag}+${font.name}`;
    const k = 1000 / font.unitsPerEm;
    const program = subsetFont(font, gids);
    const [type0, cid, desc, file, tounicode] = [f.alloc(), f.alloc(), f.alloc(), f.alloc(), f.alloc()];
    f.stream(file, `<< /Length1 ${program.length} >>`, program);
    // Widths, in runs of glyphs next to each other.
    const w = [];
    for (let i = 0; i < gids.length;) {
      let j = i;
      while (j + 1 < gids.length && gids[j + 1] === gids[j] + 1) j++;
      w.push(`${gids[i]} [${gids.slice(i, j + 1).map((g) => num(font.advances[g] * k)).join(' ')}]`);
      i = j + 1;
    }
    const flags = (font.fixed ? 1 : 0) | 4 | (font.italicAngle ? 64 : 0);
    f.set(desc, `<< /Type /FontDescriptor /FontName /${base} /Flags ${flags} /FontBBox [${font.bbox.map((v) => num(v * k)).join(' ')}] /ItalicAngle ${num(font.italicAngle)} /Ascent ${num(font.ascent * k)} /Descent ${num(font.descent * k)} /CapHeight ${num(font.capHeight * k)} /StemV ${font.weightClass >= 600 ? 140 : 80} /FontFile2 ${file} 0 R >>`);
    f.set(cid, `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${base} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${desc} 0 R /DW ${num(font.advances[0] * k)} /W [${w.join(' ')}] /CIDToGIDMap /Identity >>`);
    // ToUnicode: which text each glyph stands for, so copying and searching work.
    const pairs = gids.filter((g) => r.glyphs.get(g)).map((g) => `<${hex4(g)}> <${utf16Hex(r.glyphs.get(g))}>`);
    const blocks = [];
    for (let i = 0; i < pairs.length; i += 100) blocks.push(`${pairs.slice(i, i + 100).length} beginbfchar\n${pairs.slice(i, i + 100).join('\n')}\nendbfchar`);
    const cmap = `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n${blocks.join('\n')}\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend`;
    f.stream(tounicode, '<< >>', cmap);
    f.set(type0, `<< /Type /Font /Subtype /Type0 /BaseFont /${base} /Encoding /Identity-H /DescendantFonts [${cid} 0 R] /ToUnicode ${tounicode} 0 R >>`);
    return type0;
  }
  /** A picture from env.images, as an image XObject (written once, when first drawn). */
  image(token) {
    if (!this.images.has(token)) {
      const img = this.env.images?.get(token);
      if (!img) no('picture not ready');
      this.images.set(token, { name: `Im${this.images.size + 1}`, img, ref: null, used: false });
    }
    return this.images.get(token);
  }
  useImage(r) {
    if (r.used) return;
    r.used = true;
    r.ref = writeImage(this.file, r.img);
  }
}

/** Six capital letters from the glyphs used, for a subset font's name (as the spec asks). */
function subsetTag(gids, name) {
  let h = 2166136261;
  for (const v of [...gids, ...[...name].map((c) => c.charCodeAt(0))]) {
    h ^= v;
    h = Math.imul(h, 16777619) >>> 0;
  }
  let s = '';
  for (let i = 0; i < 6; i++) {
    s += String.fromCharCode(65 + (h % 26));
    h = Math.floor(h / 26) + i * 7919;
  }
  return s;
}

/**
 * An image XObject. img: { kind: 'jpeg', bytes, width, height, components? }
 * or { kind: 'flate', data (deflated RGB), width, height, alpha? (deflated gray) }.
 */
function writeImage(file, img) {
  const ref = file.alloc();
  if (img.kind === 'jpeg') {
    const comps = img.components || 3;
    const cs = comps === 1 ? '/DeviceGray' : comps === 4 ? '/DeviceCMYK' : '/DeviceRGB';
    // Adobe's CMYK JPEGs are stored inverted.
    const decode = comps === 4 && img.inverted ? ' /Decode [1 0 1 0 1 0 1 0]' : '';
    file.stream(ref, `<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace ${cs} /BitsPerComponent 8 /Filter /DCTDecode${decode} >>`, img.bytes, { compress: false });
    return ref;
  }
  let smask = '';
  if (img.alpha) {
    const m = file.alloc();
    file.set(m, [`<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${img.alpha.length} >>\nstream\n`, img.alpha, '\nendstream']);
    smask = ` /SMask ${m} 0 R`;
  }
  file.set(ref, [`<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode${smask} /Length ${img.data.length} >>\nstream\n`, img.data, '\nendstream']);
  return ref;
}

// ---------- gradients ----------

/** A gradient's stops as a PDF function (stitched when there are more than two). */
function gradientFunction(stops) {
  const fn = (a, b) => `<< /FunctionType 2 /Domain [0 1] /C0 [${rgb(a.color)}] /C1 [${rgb(b.color)}] /N 1 >>`;
  if (stops.length === 2) return fn(stops[0], stops[1]);
  const parts = [];
  const bounds = [];
  for (let i = 0; i + 1 < stops.length; i++) {
    parts.push(fn(stops[i], stops[i + 1]));
    if (i) bounds.push(num(stops[i].offset));
  }
  return `<< /FunctionType 3 /Domain [0 1] /Functions [${parts.join(' ')}] /Bounds [${bounds.join(' ')}] /Encode [${parts.map(() => '0 1').join(' ')}] >>`;
}

function readStops(node, current) {
  const stops = [];
  let last = 0;
  for (const s of node.children.filter((c) => c.tag === 'stop')) {
    let off = s.attrs.offset ?? '0';
    off = String(off).trim().endsWith('%') ? parseFloat(off) / 100 : parseFloat(off);
    off = Math.max(last, Math.min(1, Math.max(0, Number.isFinite(off) ? off : 0)));
    last = off;
    const color = parseColor(s.attrs['stop-color'] ?? '#000000', current);
    const op = s.attrs['stop-opacity'] === undefined ? 1 : parseFloat(s.attrs['stop-opacity']);
    if (!color || color.url || color[3] * op < 0.999) no('see-through gradient');
    stops.push({ offset: off, color });
  }
  if (!stops.length) return null;
  if (stops[0].offset > 0) stops.unshift({ ...stops[0], offset: 0 });
  if (stops[stops.length - 1].offset < 1) stops.push({ ...stops[stops.length - 1], offset: 1 });
  if (stops.length === 1) stops.push({ ...stops[0], offset: 1 });
  // Two stops at one place make a hard edge: nudge them apart a hair. In
  // thousandths, as the file writes them, so the stitching function's
  // Bounds rise and stay inside its Domain (0 and 1, the ends' places).
  const end = stops.length - 1;
  if (end > 1000) no('gradient with too many stops');
  const t = stops.map((s, i) => (i === 0 ? 0 : i === end ? 1000 : Math.round(s.offset * 1000)));
  for (let i = 1; i < end; i++) t[i] = Math.max(t[i], t[i - 1] + 1);
  for (let i = end - 1; i > 0; i--) t[i] = Math.min(t[i], t[i + 1] - 1);
  return stops.map((s, i) => (s.offset === t[i] / 1000 ? s : { ...s, offset: t[i] / 1000 }));
}

// ---------- drawing a page ----------

class Painter {
  constructor(res, env, ctm) {
    this.res = res;
    this.env = env;
    this.ops = [];
    this.ctm = ctm;
    this.defs = new Map();
    this.glyphs = []; // [fontRecord key, gid, text] used, committed with the element
    this.images = [];
  }

  /** Draw a parsed markup tree (one element of the page). */
  draw(root, defs) {
    this.defs = byId(defs);
    for (const c of root.children) if (c.tag) this.node(c, ROOT_STYLE);
  }

  node(node, parent) {
    const a = node.attrs;
    for (const k of UNSUPPORTED_ATTRS) if (a[k] !== undefined && !(k === 'style' && !a[k].trim())) no(`${k} on <${node.tag}>`);
    if (a.display === 'none' || a.visibility === 'hidden') return;
    const style = inherit(parent, node);
    switch (node.tag) {
      case 'g':
      case 'svg':
        return this.group(node, style);
      case 'defs':
      case 'title':
      case 'desc':
      case 'metadata':
        return;
      case 'text':
        return this.wrap(node, style, () => this.text(node, style));
      case 'image':
        return this.wrap(node, style, () => this.image(node));
      case 'path':
      case 'rect':
      case 'circle':
      case 'ellipse':
      case 'line':
      case 'polyline':
      case 'polygon':
        return this.wrap(node, style, () => this.shape(node, style));
      default:
        return no(`<${node.tag}>`);
    }
  }

  /** transform, clip-path and opacity around something drawn. */
  wrap(node, style, draw) {
    const a = node.attrs;
    const m = parseTransform(a.transform);
    const opacity = a.opacity === undefined ? 1 : Math.max(0, Math.min(1, parseFloat(a.opacity)));
    if (opacity <= 0.001) return;
    const clip = a['clip-path'];
    const plain = isId(m) && opacity >= 0.999 && !clip;
    if (plain) return draw();
    const outer = this.ctm;
    this.ops.push('q');
    if (!isId(m)) {
      this.ops.push(cm(m));
      this.ctm = mul(m, this.ctm);
    }
    if (clip) this.clip(clip);
    if (opacity < 0.999) {
      // See-through as one: a transparency group, painted at that opacity.
      const ops = this.ops;
      this.ops = [];
      draw();
      const inner = this.ops;
      this.ops = ops;
      const form = this.form(inner);
      this.ops.push(`/${this.res.gs(opacity)} gs /${form} Do`);
    } else draw();
    this.ops.push('Q');
    this.ctm = outer;
  }

  group(node, style) {
    this.wrap(node, style, () => {
      for (const c of node.children) if (c.tag) this.node(c, style);
    });
  }

  form(ops) {
    const name = `Fm${this.res.forms.length + this.pendingForms().length + 1}`;
    this.pendingForms().push([name, ops.join('\n')]);
    return name;
  }
  pendingForms() {
    if (!this.formsPending) this.formsPending = [];
    return this.formsPending;
  }

  clip(ref) {
    const m = /url\(\s*#([^)\s]+)\s*\)/.exec(ref);
    const cp = m && this.defs.get(m[1]);
    if (!cp || cp.tag !== 'clipPath') no('clip path');
    if (cp.attrs.clipPathUnits === 'objectBoundingBox') no('clip path units');
    const paths = [];
    let rule = 'W';
    for (const c of cp.children) {
      if (!c.tag) continue;
      const t = parseTransform(c.attrs.transform);
      paths.push(pathOps(shapeSegs(c), isId(t) ? null : t));
      if (c.attrs['clip-rule'] === 'evenodd') rule = 'W*';
    }
    this.ops.push(`${paths.join(' ') || '0 0 m'} ${rule} n`);
  }

  /** The paint for fill or stroke: a color [r,g,b,a], { gradient }, or null. */
  paint(value, style) {
    const c = parseColor(value, style.color);
    if (!c || !c.url) return c;
    const g = this.defs.get(c.url);
    if (!g || (g.tag !== 'linearGradient' && g.tag !== 'radialGradient')) no('paint server');
    if (g.attrs.href || g.attrs['xlink:href']) no('linked gradient');
    if (g.attrs.spreadMethod && g.attrs.spreadMethod !== 'pad') no('repeating gradient');
    const stops = readStops(g, style.color);
    return stops ? { gradient: g, stops } : null;
  }

  shape(node, style) {
    const segs = shapeSegs(node);
    if (!segs.length) return;
    const isLine = node.tag === 'line' || node.tag === 'polyline';
    const fill = isLine ? null : this.paint(style.fill, style);
    const stroke = this.paint(style.stroke, style);
    const sw = parseFloat(style['stroke-width']);
    this.fillAndStroke(segs, fill, stroke && sw > 0 ? stroke : null, style);
  }

  strokeState(style, stroke) {
    const ops = [`${num(parseFloat(style['stroke-width']))} w`];
    ops.push(`${{ butt: 0, round: 1, square: 2 }[style['stroke-linecap']] ?? 0} J`);
    ops.push(`${{ miter: 0, round: 1, bevel: 2 }[style['stroke-linejoin']] ?? 0} j`);
    ops.push(`${num(parseFloat(style['stroke-miterlimit']) || 4)} M`);
    const dash = style['stroke-dasharray'];
    if (dash && dash !== 'none') {
      let parts = dash.split(/[\s,]+/).filter(Boolean).map(parseFloat).filter((v) => Number.isFinite(v) && v >= 0);
      if (parts.length % 2) parts = parts.concat(parts);
      if (parts.some((v) => v > 0)) ops.push(`[${parts.map(num).join(' ')}] ${num(parseFloat(style['stroke-dashoffset']) || 0)} d`);
    }
    ops.push(`${rgb(stroke)} RG`);
    return ops.join(' ');
  }

  fillAndStroke(segs, fill, stroke, style) {
    const path = pathOps(segs);
    const evenodd = style['fill-rule'] === 'evenodd';
    const fo = style['fill-opacity'] === undefined ? 1 : parseFloat(style['fill-opacity']);
    const so = style['stroke-opacity'] === undefined ? 1 : parseFloat(style['stroke-opacity']);
    if (fill?.gradient) {
      if (fo < 0.999) no('see-through gradient');
      const box = pathBox(segs);
      if (box && box.w > 1e-9 && box.h > 1e-9) {
        this.ops.push(`q ${path} ${evenodd ? 'W*' : 'W'} n`);
        this.ops.push(this.gradient(fill, box));
        this.ops.push('Q');
      }
    }
    const solidFill = fill && !fill.gradient ? fill : null;
    if (stroke?.gradient) no('gradient stroke');
    if (!solidFill && !stroke) return;
    const ops = ['q'];
    const ca = solidFill ? solidFill[3] * fo : 1;
    const CA = stroke ? stroke[3] * so : 1;
    if (ca < 0.999 || CA < 0.999) ops.push(`/${this.res.gs(ca, CA)} gs`);
    if (solidFill) ops.push(`${rgb(solidFill)} rg`);
    if (stroke) ops.push(this.strokeState(style, stroke));
    if (solidFill && stroke && style['paint-order']?.startsWith('stroke')) {
      // The outline under the fill.
      ops.push(`${path} S ${path} ${evenodd ? 'f*' : 'f'}`);
    } else {
      ops.push(path);
      ops.push(solidFill && stroke ? (evenodd ? 'B*' : 'B') : solidFill ? (evenodd ? 'f*' : 'f') : 'S');
    }
    ops.push('Q');
    this.ops.push(ops.join(' '));
  }

  /** Paint a gradient over the (already clipped) area; box is the shape's own box. */
  gradient({ gradient: g, stops }, box) {
    const a = g.attrs;
    const user = a.gradientUnits === 'userSpaceOnUse';
    const len = (v, d, size) => {
      if (v === undefined) return d;
      const s = String(v).trim();
      if (s.endsWith('%')) return (parseFloat(s) / 100) * (user ? size : 1);
      return parseFloat(s);
    };
    let m = user ? ID : [box.w, 0, 0, box.h, box.x, box.y];
    if (a.gradientTransform) m = mul(parseTransform(a.gradientTransform), m);
    const fn = gradientFunction(stops);
    let dict;
    if (g.tag === 'linearGradient') {
      const coords = [len(a.x1, 0, box.w), len(a.y1, 0, box.h), len(a.x2, user ? box.w : 1, box.w), len(a.y2, 0, box.h)];
      dict = `<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [${coords.map(num).join(' ')}] /Function ${fn} /Extend [true true] >>`;
    } else {
      const cx = len(a.cx, user ? box.w / 2 : 0.5, box.w);
      const cy = len(a.cy, user ? box.h / 2 : 0.5, box.h);
      const r = len(a.r, user ? Math.hypot(box.w, box.h) / 2 / Math.SQRT2 : 0.5, Math.hypot(box.w, box.h) / Math.SQRT2);
      const fx = len(a.fx, cx, box.w);
      const fy = len(a.fy, cy, box.h);
      dict = `<< /ShadingType 3 /ColorSpace /DeviceRGB /Coords [${[fx, fy, 0, cx, cy, r].map(num).join(' ')}] /Function ${fn} /Extend [true true] >>`;
    }
    return `${cm(m)} /${this.res.shading(dict)} sh`;
  }

  image(node) {
    const a = node.attrs;
    const href = a.href ?? a['xlink:href'];
    if (!href) return;
    const r = this.res.image(href);
    this.images.push(r);
    const x = parseFloat(a.x) || 0;
    const y = parseFloat(a.y) || 0;
    const w = parseFloat(a.width);
    const h = parseFloat(a.height);
    if (!(w > 0 && h > 0)) return;
    const [align, mode] = (a.preserveAspectRatio || 'xMidYMid meet').trim().split(/\s+/);
    let [ix, iy, iw, ih] = [x, y, w, h];
    if (align !== 'none') {
      const s = (mode === 'slice' ? Math.max : Math.min)(w / r.img.width, h / r.img.height);
      iw = r.img.width * s;
      ih = r.img.height * s;
      const ax = /xMin/.test(align) ? 0 : /xMax/.test(align) ? 1 : 0.5;
      const ay = /YMin/.test(align) ? 0 : /YMax/.test(align) ? 1 : 0.5;
      ix = x + (w - iw) * ax;
      iy = y + (h - ih) * ay;
    }
    const clip = align !== 'none' && mode === 'slice' ? `${num(x)} ${num(y)} ${num(w)} ${num(h)} re W n ` : '';
    this.ops.push(`q ${clip}${cm([iw, 0, 0, -ih, ix, iy + ih])} /${r.name} Do Q`);
  }

  // ---------- text ----------

  /** The runs of a <text>: each tspan (or the text itself) with its place and style. */
  runs(node, style) {
    const out = [];
    const preserve = style['xml:space'] === 'preserve';
    const clean = (t) => (preserve ? t.replace(/[\n\r\t]/g, ' ') : t.replace(/[\n\r\t]/g, ' ').replace(/ {2,}/g, ' '));
    const at = (n, k) => (n.attrs[k] === undefined ? null : parseFloat(String(n.attrs[k]).split(/[\s,]+/)[0]));
    let x = at(node, 'x') ?? 0;
    let y = at(node, 'y') ?? 0;
    for (const c of node.children) {
      if (c.tag === 'tspan') {
        const s = inherit(style, c);
        for (const k of UNSUPPORTED_ATTRS) if (c.attrs[k] !== undefined) no(`${k} on <tspan>`);
        if (c.attrs.dx || c.attrs.dy || c.attrs.rotate) no('shifted letters');
        x = at(c, 'x') ?? x;
        y = at(c, 'y') ?? y;
        const text = clean(c.children.map((t) => (t.text ?? (t.tag ? no('nested tspan') : ''))).join(''));
        out.push({ text, x, y, style: s, start: c.attrs.x !== undefined });
      } else if (c.tag) no(`<${c.tag}> in text`);
      else if (c.text) out.push({ text: clean(c.text), x, y, style, start: !out.length });
    }
    if (!preserve && out.length) {
      out[0].text = out[0].text.replace(/^ +/, '');
      out[out.length - 1].text = out[out.length - 1].text.replace(/ +$/, '');
    }
    return out.filter((r) => r.text);
  }

  text(node, style) {
    for (const run of this.runs(node, style)) this.textRun(run);
  }

  textRun({ text, x, y, style }) {
    if (COMPLEX.test(text)) no('text that needs shaping');
    const size = parseFloat(style['font-size']) || 16;
    const italic = style['font-style'] === 'italic' || style['font-style'] === 'oblique';
    const { key, font, fakeBold } = this.res.font(style['font-family'], style['font-weight']);
    const spacing = parseFloat(style['letter-spacing']) || 0;
    const chars = [...text];
    const space = glyphFor(font, 32);
    const gids = chars.map((ch) => {
      const g = glyphFor(font, ch.codePointAt(0));
      if (g) return g;
      if (/\s/.test(ch) && space) return space;
      return no(`${font.name} has no "${ch}"`);
    });
    // Width as PDF will set it, and as the browser measured it.
    const natural = gids.reduce((s, g) => s + font.advances[g], 0) * (size / font.unitsPerEm) + spacing * chars.length;
    const measured = this.env.measure ? this.env.measure(text, { font: String(style['font-family']).split(',')[0].trim().replace(/^['"]|['"]$/g, ''), size, weight: parseInt(style['font-weight'], 10) || 400, italic }) + spacing * chars.length : natural;
    let extra = (measured - natural) / chars.length;
    if (!Number.isFinite(extra) || Math.abs(extra) > size * 0.25) extra = 0;
    const width = natural + extra * chars.length;
    const anchor = style['text-anchor'];
    const x0 = anchor === 'middle' ? x - width / 2 : anchor === 'end' ? x - width : x;
    const fill = this.paint(style.fill, style);
    const stroke = this.paint(style.stroke, style);
    if (fill?.gradient || stroke?.gradient) no('gradient text');
    const sw = parseFloat(style['stroke-width']) || 0;
    const fo = style['fill-opacity'] === undefined ? 1 : parseFloat(style['fill-opacity']);
    const so = style['stroke-opacity'] === undefined ? 1 : parseFloat(style['stroke-opacity']);
    const name = this.fontName(key, font);
    for (let i = 0; i < gids.length; i++) this.glyphs.push([key, gids[i], chars[i]]);
    const glyphHex = gids.map(hex4).join('');
    // Synthetic italic leans the letters a quarter; synthetic bold thickens their outline (as browsers do).
    const tm = `1 0 ${italic && !/italic|oblique/i.test(font.name) ? 0.25 : 0} -1 ${num(x0)} ${num(y)} Tm`;
    const bold = fakeBold ? size * (size <= 9 ? 1 / 24 : size >= 36 ? 1 / 32 : 1 / 24 + ((size - 9) / 27) * (1 / 32 - 1 / 24)) : 0;
    const passes = [];
    const strokeOn = stroke && sw > 0;
    if (strokeOn && style['paint-order']?.startsWith('stroke') && fill) {
      passes.push({ mode: 1, stroke, width: sw + bold });
      passes.push({ mode: bold ? 2 : 0, fill, stroke: bold ? fill : null, width: bold });
    } else if (fill || strokeOn) {
      const mode = fill && (strokeOn || bold) ? 2 : fill ? 0 : 1;
      passes.push({ mode, fill, stroke: strokeOn ? stroke : bold ? fill : null, width: strokeOn ? sw : bold });
    } else passes.push({ mode: 3 });
    for (const p of passes) {
      const ops = ['q'];
      const ca = p.fill ? p.fill[3] * fo : 1;
      const CA = p.stroke ? p.stroke[3] * (p.stroke === fill ? fo : so) : 1;
      if (ca < 0.999 || CA < 0.999) ops.push(`/${this.res.gs(ca, CA)} gs`);
      if (p.fill) ops.push(`${rgb(p.fill)} rg`);
      if (p.stroke) ops.push(`${rgb(p.stroke)} RG ${num(p.width)} w 1 j`);
      ops.push(`BT /${name} ${num(size)} Tf ${num(spacing + extra)} Tc ${p.mode} Tr ${tm} <${glyphHex}> Tj ET Q`);
      this.ops.push(ops.join(' '));
    }
  }

  fontName(key, font) {
    if (!this.res.fonts.has(key)) this.res.fonts.set(key, { name: `F${this.res.fonts.size + 1}`, font, glyphs: new Map(), committed: false });
    return this.res.fonts.get(key).name;
  }

  /** Keep what this element used: its glyphs, pictures and see-through groups. */
  commit() {
    for (const [key, gid, ch] of this.glyphs) {
      const r = this.res.fonts.get(key);
      r.committed = true;
      if (!r.glyphs.has(gid)) r.glyphs.set(gid, ch);
    }
    for (const img of this.images) this.res.useImage(img);
    for (const [name, ops] of this.formsPending || []) {
      const ref = this.res.file.alloc();
      this.res.file.stream(ref, `<< /Type /XObject /Subtype /Form /BBox [-100000 -100000 100000 100000] /Group << /S /Transparency >> /Resources ${this.res.ref} 0 R >>`, ops);
      this.res.forms.push([name, ref]);
    }
  }
}

// ---------- pages ----------

/** Where things are measured: page px to PDF points, bleed and the marks around it. */
function geometry(doc, print) {
  const k = 72 / printDpi(doc);
  const W = doc.width * k;
  const H = doc.height * k;
  if (!print) return { k, W, H, bleed: 0, margin: 0, media: [W, H] };
  const bleed = bleedSize(doc); // page px
  const b = bleed * k;
  const margin = b + 21; // the bleed, a gap, 15 pt marks and a little room
  return { k, W, H, bleed, b, margin, media: [W + margin * 2, H + margin * 2] };
}

/** How sharp the pictures of elements are: 300 per inch for print, else as the flattened PDF. */
export function rasterScale(doc, { print = false } = {}) {
  if (print) return 300 / printDpi(doc);
  return printDpi(doc) === 300 ? 1 : 2;
}

/** The page-px box a picture of `el` needs (under the matrix m of the groups around it). */
function rasterBox(el, m, area) {
  let pad = 2 + (el.strokeWidth || 0) + (el.outline?.width || 0) * 2;
  if (el.type === 'text') pad += (el.size || 16) * 0.8;
  if (el.shadow) pad += Math.abs(el.shadow.x ?? 0) + Math.abs(el.shadow.y ?? 8) + (el.shadow.blur ?? 16) * 1.5;
  const t = mul(parseTransform(transformOf(el)), m);
  const pts = [[-pad, -pad], [el.w + pad, -pad], [el.w + pad, el.h + pad], [-pad, el.h + pad]].map(([x, y]) => apply(t, x, y));
  const x0 = Math.max(area.x, Math.min(...pts.map((p) => p[0])));
  const y0 = Math.max(area.y, Math.min(...pts.map((p) => p[1])));
  const x1 = Math.min(area.x + area.w, Math.max(...pts.map((p) => p[0])));
  const y1 = Math.min(area.y + area.h, Math.max(...pts.map((p) => p[1])));
  if (!(x1 - x0 > 0.5 && y1 - y0 > 0.5)) return null;
  const box = { x: Math.floor(x0), y: Math.floor(y0) };
  box.w = Math.ceil(x1) - box.x;
  box.h = Math.ceil(y1) - box.y;
  return box;
}

/**
 * Draw one page into a content stream. Elements that can't be drawn as
 * vectors are listed in `wants` (planning) or drawn from env.rasters.
 */
function drawPage(doc, index, env, res, geo, wants) {
  const page = doc.pages[index];
  const ops = [];
  const { k, H, bleed, margin } = geo;
  const area = { x: -bleed, y: -bleed, w: doc.width + bleed * 2, h: doc.height + bleed * 2 };
  if (env.print) ops.push(`1 0 0 1 ${num(margin)} ${num(margin)} cm`);
  const base = [k, 0, 0, -k, 0, H];
  ops.push(`q ${cm(base)}`);
  // Nothing past the trim (or, for print, past the bleed).
  ops.push(`${num(area.x)} ${num(area.y)} ${num(area.w)} ${num(area.h)} re W n`);
  const opts = { measure: env.measure, assetHref: (id, part) => `asset:${id}:${part === 'poster' ? 'poster' : 'file'}` };
  const picture = (key, box, m) => {
    const r = env.rasters?.get(`${index}:${key}`);
    if (wants) {
      wants.push({ page: index, key, box });
      return;
    }
    if (!r) return;
    const name = `Ra${res.rasters.length + 1}`;
    res.rasters.push([name, writeImage(res.file, r)]);
    // Undo the groups' turns: pictures are drawn upright, in page px.
    const inv = invert(m);
    ops.push(`q ${isId(inv) ? '' : `${cm(inv)} `}${cm([box.w, 0, 0, -box.h, box.x, box.y + box.h])} /${name} Do Q`);
  };
  const vector = (markup, m) => {
    const p = new Painter(res, env, mul(m, base));
    p.draw(parseSvg(markup.markup), parseSvg(markup.defs));
    return p;
  };
  // The background, run into the bleed for print.
  try {
    const p = vector(backgroundMarkup(doc, page, area.w, area.h, opts), [1, 0, 0, 1, area.x, area.y]);
    p.commit();
    ops.push(`q 1 0 0 1 ${num(area.x)} ${num(area.y)} cm`, ...p.ops, 'Q');
  } catch (e) {
    if (!(e instanceof Unsupported)) throw e;
    picture('@bg', { x: area.x, y: area.y, w: area.w, h: area.h }, ID);
  }
  const visit = (el, m) => {
    if (el.hidden) return;
    // A plain group: its elements one by one, each a picture only if it must
    // be. (A see-through group, or one with a shadow, draws whole, as one.)
    if (el.type === 'group' && !el.shadow && (el.opacity ?? 1) >= 1) {
      const t = parseTransform(transformOf(el));
      ops.push(`q ${cm(t)}`);
      for (const c of el.children) visit(c, mul(t, m));
      ops.push('Q');
      return;
    }
    try {
      const p = vector(elementMarkup(doc, el, opts), m);
      p.commit();
      ops.push(...p.ops);
    } catch (e) {
      if (!(e instanceof Unsupported)) throw e;
      const box = rasterBox(el, m, area);
      if (box) picture(el.id, box, m);
    }
  };
  for (const el of page.elements) visit(el, ID);
  ops.push('Q');
  if (env.print) ops.push(cropMarks(geo));
  return ops.join('\n');
}

/**
 * Thin lines at each corner, outside the bleed, where the page is cut. Drawn
 * in points from the trim's bottom-left corner, in registration color (on
 * every printing plate).
 */
function cropMarks({ W, H, b }) {
  const gap = b + 3;
  const len = 15;
  const lines = [];
  for (const [cx, sx] of [[0, -1], [W, 1]]) {
    for (const [cy, sy] of [[0, -1], [H, 1]]) {
      lines.push(`${num(cx + sx * gap)} ${num(cy)} m ${num(cx + sx * (gap + len))} ${num(cy)} l`);
      lines.push(`${num(cx)} ${num(cy + sy * gap)} m ${num(cx)} ${num(cy + sy * (gap + len))} l`);
    }
  }
  return `q 0.3 w 0 J [] 0 d 1 1 1 1 K ${lines.join(' ')} S Q`;
}

function walk(doc, pages, env, wants) {
  const file = new PdfFile();
  const res = new Resources(file, env);
  const geo = geometry(doc, env.print);
  const contents = pages.map((i) => drawPage(doc, i, env, res, geo, wants));
  return { file, res, geo, contents };
}

/**
 * Which elements on these pages need a picture: [{ page, key, box }], key
 * being an element id (or '@bg' for the background) and box in page px.
 * env: { fonts: Map("Family|weight" or "Family|*" -> font file bytes),
 *        images: Map(token -> picture), measure, print }.
 * Pictures are named "asset:<id>:file" (or ":poster" for a video's).
 */
export function planVectorPdf(doc, pages, env = {}) {
  const wants = [];
  walk(doc, pages, env, wants);
  return wants;
}

/**
 * The PDF itself. env as for planVectorPdf, plus rasters: Map("<page>:<key>"
 * -> { width, height, data, alpha? } (deflated RGB and gray), as planned).
 */
export function buildVectorPdf(doc, pages, env = {}) {
  if (!pages.length) throw new Error('A PDF needs at least one page');
  const { file, res, geo, contents } = walk(doc, pages, env, null);
  const catalog = file.alloc();
  const tree = file.alloc();
  const info = file.alloc();
  const resRef = res.ref;
  const kids = [];
  const [mw, mh] = geo.media;
  for (const content of contents) {
    const pageRef = file.alloc();
    const contentRef = file.alloc();
    file.stream(contentRef, '<< >>', content);
    let boxes = '';
    if (env.print) {
      const { margin: m, b, W, H } = geo;
      boxes = ` /TrimBox [${[m, m, m + W, m + H].map(num).join(' ')}] /BleedBox [${[m - b, m - b, m + W + b, m + H + b].map(num).join(' ')}]`;
    }
    file.set(pageRef, `<< /Type /Page /Parent ${tree} 0 R /MediaBox [0 0 ${num(mw)} ${num(mh)}]${boxes} /Resources ${resRef} 0 R /Contents ${contentRef} 0 R /Group << /S /Transparency /CS /DeviceRGB >> >>`);
    kids.push(`${pageRef} 0 R`);
  }
  res.finish();
  file.set(catalog, `<< /Type /Catalog /Pages ${tree} 0 R >>`);
  file.set(tree, `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${kids.length} >>`);
  file.set(info, `<< /Title ${pdfTextString(env.title || doc.name || 'Paperwall design')} /Producer (Paperwall) >>`);
  return file.bytes(catalog, info);
}
