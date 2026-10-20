// The left-hand panel: everything you can add to a page.

import { h, icon, iconButton, clear, toast, pickFile, mod } from './ui.js';
import { colorButton, selectField, section } from './widgets.js';
import { FONTS, FONT_PAIRS } from '../model/fonts.js';
import { ALL_ICONS, ALL_STICKERS, searchGraphics } from '../model/graphics.js';
import { renderPage, renderElementOnly } from '../model/render.js';
import { createShape, createFrame, createIcon, createSticker, createText, createChart, createTable, TEXT_STYLES } from '../model/doc.js';
import { GRIDS, gridBoxes } from '../model/grids.js';
import { collectColors, scaleElement } from '../model/commands.js';
import { TEMPLATES, TEMPLATE_CATEGORIES, TEMPLATE_FORMATS, searchTemplates, templateFormatLabel } from '../templates/index.js';
import { measure, ensureFont, ensureDesignFonts } from './fonts.js';
import { TEXT_COMBOS, comboGroup } from '../model/text-combos.js';
import { approxMeasure } from '../model/text-layout.js';
import { readyTemplate } from './templates.js';
import * as store from './store.js';

const TABS = [
  { id: 'templates', label: 'Templates', icon: 'templates' },
  { id: 'text', label: 'Text', icon: 'text' },
  { id: 'shapes', label: 'Shapes', icon: 'shapes' },
  { id: 'graphics', label: 'Graphics', icon: 'graphics' },
  { id: 'uploads', label: 'Uploads', icon: 'uploads' },
  { id: 'charts', label: 'Charts', icon: 'chart' },
  { id: 'qr', label: 'QR code', icon: 'qr' },
  { id: 'brand', label: 'Brand', icon: 'brand' },
];

const SHAPE_ITEMS = [
  { label: 'Square', shape: 'rect', props: {} },
  { label: 'Rounded square', shape: 'rect', props: { radius: 60 } },
  { label: 'Circle', shape: 'ellipse', props: {} },
  { label: 'Triangle', shape: 'triangle', props: {} },
  { label: 'Diamond', shape: 'diamond', props: {} },
  { label: 'Pentagon', shape: 'polygon', props: { sides: 5 } },
  { label: 'Hexagon', shape: 'polygon', props: { sides: 6 } },
  { label: 'Star', shape: 'star', props: { sides: 5 } },
  { label: 'Burst', shape: 'star', props: { sides: 16, innerRatio: 0.78 } },
  { label: 'Heart', shape: 'heart', props: {} },
  { label: 'Arrow', shape: 'arrow', props: { h: 180 } },
  { label: 'Speech bubble', shape: 'bubble', props: {} },
  { label: 'Arch', shape: 'arch', props: {} },
  { label: 'Blob', shape: 'blob', props: {} },
];

const FRAME_ITEMS = [
  { label: 'Square frame', mask: 'none', props: {} },
  { label: 'Rounded frame', mask: 'none', props: { radius: 60 } },
  { label: 'Circle frame', mask: 'circle', props: {} },
  { label: 'Arch frame', mask: 'arch', props: { h: 640 } },
  { label: 'Blob frame', mask: 'blob', props: {} },
  { label: 'Heart frame', mask: 'heart', props: {} },
  { label: 'Star frame', mask: 'star', props: {} },
  { label: 'Hexagon frame', mask: 'polygon', props: {} },
  { label: 'Portrait frame', mask: 'none', props: { h: 640 } },
  { label: 'Landscape frame', mask: 'none', props: { w: 640, h: 420 } },
];

const LINE_ITEMS = [
  { label: 'Line', props: {} },
  { label: 'Arrow line', props: { endCap: 'arrow' } },
  { label: 'Dashed line', props: { dash: 'dashed' } },
  { label: 'Dotted line', props: { dash: 'dotted', strokeWidth: 8 } },
  { label: 'Double arrow', props: { startCap: 'arrow', endCap: 'arrow' } },
];

const PREVIEW_DOC = { assets: {} };

export class InsertPanel {
  constructor(editor) {
    this.ed = editor;
    this.tab = 'templates';
    this.query = '';
    this.category = 'All';
    this.body = h('div', { class: 'insert-body' });
    this.rail = h('nav', { class: 'rail', 'aria-label': 'Add to your design' },
      TABS.map((t) => h('button', { type: 'button', 'data-tab': t.id, 'data-testid': `rail-${t.id}`, onClick: () => this.open(t.id) }, icon(t.icon, 22), h('span', null, t.label))));
    this.el = h('div', { class: 'insert' }, this.rail, h('div', { class: 'insert-panel', 'data-testid': 'insert-panel' }, this.body));
    this.render();
  }

  open(tab) {
    if (window.matchMedia('(max-width: 900px)').matches) {
      // Phones: the rail always opens its sheet.
      this.tab = tab;
      this.el.classList.remove('collapsed');
      this.query = '';
      this.onOpen?.();
      return this.render();
    }
    if (this.tab === tab && !this.el.classList.contains('collapsed')) {
      this.el.classList.toggle('collapsed');
    } else {
      this.tab = tab;
      this.el.classList.remove('collapsed');
      this.query = '';
    }
    this.render();
  }

  render() {
    for (const b of this.rail.children) b.setAttribute('aria-current', String(b.dataset.tab === this.tab));
    forget(this.body);
    clear(this.body);
    const fn = {
      templates: () => this.templates(),
      text: () => this.text(),
      shapes: () => this.shapes(),
      graphics: () => this.graphics(),
      uploads: () => this.uploads(),
      charts: () => this.charts(),
      qr: () => this.qr(),
      brand: () => this.brand(),
    }[this.tab];
    this.body.append(...[].concat(fn()));
  }

  search(placeholder, onInput) {
    const input = h('input', { type: 'search', placeholder, value: this.query, 'aria-label': placeholder, 'data-testid': 'insert-search' });
    input.addEventListener('input', () => {
      this.query = input.value;
      onInput();
    });
    return h('div', { class: 'search' }, icon('search', 18), input);
  }

  // ---------- templates ----------

  templates() {
    if (!this.tplState) this.tplState = { query: '', category: 'All', format: 'All', shown: 24 };
    return [
      ...templateBrowser({
        state: this.tplState,
        ids: { search: 'template-search', format: 'template-format', cat: 'tpl-cat', grid: 'template-grid', more: 'templates-more', count: 'template-count' },
        pageSize: 24,
        onPick: (t) => this.useTemplate(t),
      }),
      h('p', { class: 'hint' }, 'Every template is original and free for any use. Click one to add its pages to your design.'),
    ];
  }

  async useTemplate(t) {
    const ed = this.ed;
    const doc = await readyTemplate(t);
    if (ed.closed) return; // the design was closed while the template loaded
    // Decide only now, after the wait: the design may have changed meanwhile.
    const blank = ed.doc.pages.length === 1 && !ed.pageData.elements.length ? ed.pageData.id : null;
    ed.addTemplatePage(doc);
    if (blank) {
      ed.change(() => ed.doc.pages.splice(ed.doc.pages.findIndex((p) => p.id === blank), 1));
      ed.page = -1;
      ed.setPage(0);
    }
    toast(`Added "${t.name}"`);
  }

  // ---------- text ----------

  text() {
    const ed = this.ed;
    const add = (style) => h('button', { type: 'button', class: `text-add ${style}`, 'data-testid': `add-${style}`, onClick: () => ed.addText(style) }, TEXT_STYLES[style].text);
    return [
      section('Add text', add('heading'), add('subheading'), add('body'), h('p', { class: 'hint' }, `Shortcut: T. Double-click text on the page to edit it.`)),
      section('Combinations', h('div', { class: 'combo-grid', 'data-testid': 'text-combos' }, TEXT_COMBOS.map((c) => {
        const b = h('button', { type: 'button', class: 'combo', title: c.name, 'aria-label': c.name, 'data-testid': `combo-${c.id}`, onClick: () => this.addCombo(c) });
        lazily(b, async () => {
          await ensureDesignFonts({ pages: [{ elements: [comboGroup(c, approxMeasure)] }] });
          const g = comboGroup(c, measure);
          b.innerHTML = renderElementOnly(PREVIEW_DOC, g, { measure, idPrefix: `cb-${c.id}` });
        });
        return b;
      }))),
      section('Font pairs',
        h('div', { class: 'pair-grid', 'data-testid': 'font-pairs' }, FONT_PAIRS.map((p) => h('button', { type: 'button', class: 'pair', 'data-testid': `pair-${p.name}`, onClick: () => this.addPair(p) },
          h('b', { style: { fontFamily: `"${p.heading}"` } }, p.name),
          h('small', { style: { fontFamily: `"${p.body}"` } }, `${p.heading} + ${p.body}`))))),
    ];
  }

  /** Add a text combination, sized to suit the page, once its fonts have loaded. */
  async addCombo(combo) {
    const ed = this.ed;
    await ensureDesignFonts({ pages: [{ elements: [comboGroup(combo, approxMeasure)] }] });
    if (ed.closed) return;
    const g = comboGroup(combo, measure);
    const s = Math.min((ed.doc.width * 0.7) / g.w, (ed.doc.height * 0.6) / g.h);
    scaleElement(g, s, s);
    ed.insert(g);
  }

  async addPair(pair) {
    const ed = this.ed;
    await Promise.all([ensureFont(pair.heading, 700), ensureFont(pair.body, 400)]);
    const k = Math.max(0.3, Math.min(ed.doc.width, ed.doc.height) / 1080);
    const w = Math.round(ed.doc.width * 0.7);
    const head = createText({ text: pair.name === 'Wedding' ? 'Save the date' : 'Make it yours', font: pair.heading, size: Math.round(88 * k), weight: 700, align: 'center', w });
    const body = createText({ text: 'Add a few words that say what this is about.', font: pair.body, size: Math.round(32 * k), align: 'center', w });
    for (const t of [head, body]) ed.fitText(t);
    const total = head.h + body.h + 24 * k;
    head.x = body.x = Math.round((ed.doc.width - w) / 2);
    head.y = Math.round((ed.doc.height - total) / 2);
    body.y = Math.round(head.y + head.h + 24 * k);
    ed.change(() => ed.pageData.elements.push(head, body));
    ed.select([head.id, body.id]);
  }

  // ---------- shapes ----------

  shapes() {
    const ed = this.ed;
    return [
      section('Shapes', h('div', { class: 'thumb-grid', 'data-testid': 'shape-grid' }, SHAPE_ITEMS.map((s) => {
        const el = createShape(s.shape, { ...s.props, w: 100, h: s.props.h ? 100 * (s.props.h / 300) : 100, radius: s.props.radius ? 20 : 0, fill: '#5b5bd6' });
        return h('button', { type: 'button', class: 'thumb', title: s.label, 'aria-label': s.label, 'data-testid': `shape-${s.label}`, onClick: () => ed.addShape(s.shape, s.props), html: renderElementOnly(PREVIEW_DOC, el) });
      }))),
      section('Frames', h('p', { class: 'hint' }, 'Drop a photo onto a frame, or double-click it to pick one.'),
        h('div', { class: 'thumb-grid', 'data-testid': 'frame-grid' }, FRAME_ITEMS.map((fr) => {
          const el = createFrame(fr.mask, { ...fr.props });
          const k = 100 / Math.max(el.w, el.h);
          Object.assign(el, { w: el.w * k, h: el.h * k, radius: (el.radius || 0) * k });
          return h('button', { type: 'button', class: 'thumb', title: fr.label, 'aria-label': fr.label, 'data-testid': `frame-${fr.label}`, onClick: () => ed.addFrame(fr.mask, fr.props), html: renderElementOnly(PREVIEW_DOC, el) });
        }))),
      section('Photo grids', h('div', { class: 'thumb-grid', 'data-testid': 'photo-grid-list' }, GRIDS.map((g) => h('button', {
        type: 'button', class: 'thumb', title: g.name, 'aria-label': g.name, 'data-testid': `grid-${g.id}`, onClick: () => ed.addGrid(g),
        html: `<svg viewBox="0 0 100 100">${gridBoxes(g, 100, 100, { margin: 6, gap: 4 }).map((b) => `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="2" fill="#dcdce6"/>`).join('')}</svg>`,
      })))),
      section('Lines', h('div', { class: 'thumb-grid', 'data-testid': 'line-grid' }, LINE_ITEMS.map((l) => h('button', {
        type: 'button', class: 'thumb', title: l.label, 'aria-label': l.label, 'data-testid': `line-${l.label}`, onClick: () => ed.addLine(l.props),
        html: `<svg viewBox="0 0 100 40"><line x1="8" y1="20" x2="92" y2="20" stroke="currentColor" stroke-width="4" ${l.props.dash === 'dashed' ? 'stroke-dasharray="12 8"' : l.props.dash === 'dotted' ? 'stroke-dasharray="0 9" stroke-linecap="round"' : ''}/>${l.props.endCap ? '<path d="M94 20 82 12v16z" fill="currentColor"/>' : ''}${l.props.startCap ? '<path d="M6 20 18 12v16z" fill="currentColor"/>' : ''}</svg>`,
      })))),
      h('p', { class: 'hint' }, `Shortcuts: R rectangle, O circle, L line. Hold Shift while resizing to keep proportions.`),
    ];
  }

  // ---------- graphics ----------

  graphics() {
    const ed = this.ed;
    const iconsGrid = h('div', { class: 'thumb-grid small', 'data-testid': 'icon-grid' });
    const stickerGrid = h('div', { class: 'thumb-grid', 'data-testid': 'sticker-grid' });
    const more = h('button', { type: 'button', class: 'btn small wide', 'data-testid': 'icons-more' });
    let shown = 120;
    const thumb = (cls, title, testid, onClick, makeSvg) => {
      const b = h('button', { type: 'button', class: cls, title, 'aria-label': title, 'data-testid': testid, onClick });
      lazily(b, () => (b.innerHTML = makeSvg()));
      return b;
    };
    const fill = () => {
      const { icons, stickers, total } = searchGraphics(this.query, { limit: shown });
      forget(iconsGrid);
      forget(stickerGrid);
      clear(iconsGrid);
      clear(stickerGrid);
      for (const i of icons) iconsGrid.append(thumb('thumb', i.name, `icon-${i.id}`, () => ed.addIcon(i.id), () => renderElementOnly(PREVIEW_DOC, createIcon(i.id, { w: 48, h: 48, color: '#2b2b38' }))));
      for (const s of stickers) stickerGrid.append(thumb('thumb', s.name, `sticker-${s.id}`, () => ed.addSticker(s.id), () => renderElementOnly(PREVIEW_DOC, createSticker(s.id, { w: 100, h: 100 }))));
      if (!icons.length && !stickers.length) iconsGrid.append(h('p', { class: 'empty-note' }, 'Nothing found. Try "heart", "star" or "party".'));
      more.hidden = total <= icons.length;
      more.textContent = `Show more icons (${total - icons.length} more)`;
    };
    more.addEventListener('click', () => {
      shown += 240;
      fill();
    });
    const search = this.search(`Search ${ALL_ICONS.length.toLocaleString()} icons and ${ALL_STICKERS.length} stickers`, () => {
      shown = 120;
      fill();
    });
    fill();
    return [
      search,
      section('Icons', h('p', { class: 'hint' }, 'Change the color of an icon after you add it.'), iconsGrid, more),
      section('Stickers', stickerGrid),
      h('p', { class: 'hint' }, "Paperwall's own icons and every sticker are free for any use (CC0). The rest of the icons are from Lucide (ISC license)."),
    ];
  }

  // ---------- uploads ----------

  uploads() {
    const ed = this.ed;
    const grid = h('div', { class: 'upload-grid', 'data-testid': 'upload-grid' });
    const load = async () => {
      const ups = await store.listUploads();
      clear(grid);
      if (!ups.length) grid.append(h('p', { class: 'empty-note' }, 'Images you add show up here, so you can use them again in any design.'));
      for (const u of ups) {
        grid.append(h('div', { class: 'upload' },
          h('button', { type: 'button', class: 'upload-img', title: u.name, 'aria-label': `Add ${u.name}`, 'data-testid': 'upload-item', draggable: 'true', onClick: () => ed.addImage(u), onDragstart: (e) => {
            // Drag onto the page to add it, or onto a frame to fill the frame.
            e.dataTransfer.setData('application/x-paperwall-upload', u.id);
            e.dataTransfer.effectAllowed = 'copy';
          } }, h('img', { src: u.dataUrl, alt: '', draggable: 'false' })),
          iconButton('trash', 'Remove from uploads', async () => {
            await store.deleteUpload(u.id);
            load();
          })));
      }
    };
    load();
    const upload = h('button', { type: 'button', class: 'btn primary wide', 'data-testid': 'upload-btn', onClick: async () => {
      const files = await pickFile('image/*', true);
      for (const f of files) {
        try {
          const u = await ed.importImageFile(f);
          await ed.addImage(u);
        } catch (e) {
          toast(e.message, 'error');
        }
      }
      load();
    } }, icon('uploads'), 'Upload images');
    return [
      upload,
      h('p', { class: 'hint' }, `Or drag images onto the page, or paste with ${mod}+V. Your images stay on this device: nothing is uploaded anywhere.`),
      grid,
    ];
  }

  // ---------- charts and tables ----------

  charts() {
    const ed = this.ed;
    const kinds = [
      { type: 'bar', label: 'Bar chart' },
      { type: 'line', label: 'Line chart' },
      { type: 'pie', label: 'Pie chart' },
      { type: 'donut', label: 'Donut chart' },
    ];
    const tables = [
      { label: 'Simple table', props: {} },
      { label: 'Price list', props: { rows: [['Service', 'Price'], ['Haircut', '25'], ['Color', '60'], ['Styling', '35']], align: 'left', headerFill: '#f25c2a' } },
      { label: 'Schedule', props: { rows: [['Day', 'Class', 'Time'], ['Mon', 'Yoga', '7 am'], ['Wed', 'Spin', '6 pm'], ['Fri', 'HIIT', '7 am']], stripes: true, align: 'center' } },
    ];
    return [
      section('Charts', h('div', { class: 'thumb-grid two', 'data-testid': 'chart-grid' }, kinds.map((k) => h('button', {
        type: 'button', class: 'thumb wide', title: k.label, 'aria-label': k.label, 'data-testid': `chart-${k.type}`, onClick: () => ed.addChart(k.type),
        html: renderElementOnly(PREVIEW_DOC, createChart(k.type, { w: 200, h: 130, showValues: false }), { measure }),
      }))), h('p', { class: 'hint' }, 'Add one, then type your own numbers.')),
      section('Tables', h('div', { class: 'thumb-grid two', 'data-testid': 'table-grid' }, tables.map((t) => h('button', {
        type: 'button', class: 'thumb wide', title: t.label, 'aria-label': t.label, 'data-testid': `table-${t.label}`, onClick: () => ed.addTable(t.props),
        html: renderElementOnly(PREVIEW_DOC, createTable({ ...t.props, w: 200, h: 120, size: 13 }), { measure }),
      })))),
    ];
  }

  // ---------- QR ----------

  qr() {
    const input = h('input', { type: 'url', placeholder: 'https://your-link.com', 'aria-label': 'Link for the QR code', 'data-testid': 'qr-input' });
    const add = () => {
      const v = input.value.trim();
      if (!v) return toast('Type a link or some text first.');
      if (new TextEncoder().encode(v).length > 200) return toast('That is too long for a QR code. Keep it under 200 characters.', 'error');
      this.ed.addQr(v);
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') add();
    });
    return [section('QR code',
      h('label', { class: 'field' }, h('span', null, 'Link or text'), input),
      h('button', { type: 'button', class: 'btn primary wide', 'data-testid': 'qr-add', onClick: add }, 'Add QR code'),
      h('p', { class: 'hint' }, 'Generated on your device. Free, no tracking links, never expires.'))];
  }

  // ---------- brand kit ----------

  brand() {
    const ed = this.ed;
    const wrap = h('div', { 'data-testid': 'brand-kit' });
    let current = { colors: [] };
    const draw = (brand) => {
      current = brand;
      clear(wrap);
      // Changes apply to the latest kit right away, so quick edits never overwrite each other.
      const save = (next) => {
        const merged = { ...current, ...next, colors: next.colors ?? current.colors };
        draw(merged);
        store.setSetting('brand', merged);
      };
      const colors = h('div', { class: 'brand-colors', 'data-testid': 'brand-colors' },
        (brand.colors || []).map((c, i) => h('div', { class: 'brand-color' },
          colorButton({ label: `Brand color ${i + 1}`, value: c, onChange: (v, live) => {
            if (live) return;
            save({ colors: current.colors.map((x, k) => (k === i ? v : x)) });
          } }),
          iconButton('close', 'Remove color', () => save({ colors: current.colors.filter((_, k) => k !== i) }))),
        ),
        (brand.colors || []).length < 10 ? h('button', { type: 'button', class: 'add-color', title: 'Add a brand color', 'aria-label': 'Add a brand color', 'data-testid': 'brand-add-color', onClick: () => {
          const used = collectColors(ed.doc).find((c) => !(current.colors || []).includes(c) && c !== '#ffffff') || '#f25c2a';
          save({ colors: [...(current.colors || []), used] });
        } }, icon('plus')) : null);
      const fontOpts = [{ value: '', label: '(keep as is)' }, ...FONTS.map((f) => ({ value: f.name, label: f.name }))];
      wrap.append(
        section('Brand colors', colors, h('p', { class: 'hint' }, 'They appear in every color picker.')),
        section('Brand fonts',
          selectField({ label: 'Headings', value: brand.headingFont || '', options: fontOpts, testid: 'brand-heading-font', onChange: (v) => save({ headingFont: v || null }) }),
          selectField({ label: 'Body text', value: brand.bodyFont || '', options: fontOpts, testid: 'brand-body-font', onChange: (v) => save({ bodyFont: v || null }) })),
        h('button', { type: 'button', class: 'btn primary wide', 'data-testid': 'brand-apply', disabled: !(brand.colors?.length || brand.headingFont || brand.bodyFont), onClick: async () => {
          await ed.applyBrand(brand);
          toast('Brand kit applied. Undo if you don\'t like it.');
        } }, 'Apply to this design'),
        h('p', { class: 'hint' }, 'Your brand kit is saved on this device and works in every design.'));
    };
    store.getSetting('brand', { colors: [] }).then((b) => draw(b || { colors: [] }));
    return wrap;
  }
}

/** A template preview. It's drawn when it scrolls into view, once its fonts have loaded. */
export function templateCard(t, onClick) {
  const img = h('span', { class: 'tpl-img', style: { aspectRatio: `${t.width} / ${t.height}` } });
  lazily(img, async () => {
    try {
      const doc = await readyTemplate(t);
      img.innerHTML = renderPage(doc, 0, { measure, noSize: true, idPrefix: `tp-${t.id}` });
    } catch (e) {
      img.classList.add('broken');
      console.warn(`Couldn't draw template ${t.id}`, e);
    }
  });
  const meta = t.pages > 1 ? `${templateFormatLabel(t)} · ${t.pages} pages` : templateFormatLabel(t);
  // Previews sit in same-sized frames so rows line up, whatever the format.
  const frame = h('span', { class: t.height / t.width > 1.25 ? 'tpl-frame tall' : 'tpl-frame' }, img);
  return h('button', { type: 'button', class: 'tpl', title: `${t.name} (${meta})`, 'data-testid': `template-${t.id}`, 'data-format': t.format, onClick: () => onClick(t) },
    frame,
    t.pages > 1 ? h('span', { class: 'tpl-badge', 'data-testid': 'template-pages' }, `${t.pages} pages`) : null,
    h('span', { class: 'tpl-name' }, t.name),
    h('small', { class: 'tpl-meta' }, meta));
}

/**
 * Search box, size filter, category chips and a grid of templates that shows
 * `pageSize` at a time. `state` ({ query, category, format, shown }) is kept
 * by the caller so the browser can be rebuilt without losing its place.
 */
export function templateBrowser({ state, ids, onPick, pageSize = 48, gridClass = 'tpl-grid' }) {
  const grid = h('div', { class: gridClass, 'data-testid': ids.grid });
  // One template at a time: a second click while the first loads does nothing.
  let busy = false;
  const pick = async (t) => {
    if (busy) return;
    busy = true;
    try {
      await onPick(t);
    } finally {
      busy = false;
    }
  };
  const count = h('p', { class: 'tpl-count', 'data-testid': ids.count, 'aria-live': 'polite' });
  const more = h('button', { type: 'button', class: 'btn more', 'data-testid': ids.more, onClick: () => {
    state.shown += pageSize;
    fill(false);
  } }, 'Show more templates');
  const search = h('input', { type: 'search', value: state.query, placeholder: `Search ${TEMPLATES.length} templates`, 'aria-label': 'Search templates', 'data-testid': ids.search });
  const format = h('select', { 'aria-label': 'Size', 'data-testid': ids.format },
    h('option', { value: 'All' }, 'All sizes'),
    TEMPLATE_FORMATS.map((f) => h('option', { value: f.id, selected: f.id === state.format }, `${f.label} (${f.count})`)));
  const chips = h('div', { class: 'chips scroll', role: 'group', 'aria-label': 'Template categories' });
  const drawChips = () => {
    clear(chips);
    for (const c of ['All', ...TEMPLATE_CATEGORIES]) {
      chips.append(h('button', { type: 'button', class: c === state.category ? 'chip on' : 'chip', 'aria-pressed': String(c === state.category), 'data-testid': `${ids.cat}-${c}`, onClick: () => {
        state.category = c;
        drawChips();
        fill();
      } }, c));
    }
  };
  const fill = (reset = true) => {
    if (reset) state.shown = pageSize;
    const list = searchTemplates(state);
    forget(grid);
    clear(grid);
    if (!list.length) grid.append(h('p', { class: 'empty-note' }, 'No templates match. Try "sale", "invite", "resume" or "menu".'));
    for (const t of list.slice(0, state.shown)) grid.append(templateCard(t, pick));
    count.textContent = `${list.length} template${list.length === 1 ? '' : 's'}`;
    more.hidden = list.length <= state.shown;
  };
  search.addEventListener('input', () => {
    state.query = search.value;
    fill();
  });
  format.addEventListener('change', () => {
    state.format = format.value;
    fill();
  });
  drawChips();
  fill(false);
  return [
    h('div', { class: 'tpl-tools' }, h('div', { class: 'search' }, icon('search', 18), search), format),
    chips,
    count,
    grid,
    more,
  ];
}

const pending = new WeakMap();
const observer = typeof IntersectionObserver !== 'undefined'
  ? new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      observer.unobserve(e.target);
      pending.get(e.target)?.();
      pending.delete(e.target);
    }
  }, { rootMargin: '400px' })
  : null;

/** Run fn when el comes near the screen (right away where that can't be observed). */
export function lazily(el, fn) {
  if (!observer) return void fn();
  pending.set(el, fn);
  el.dataset.lazy = '';
  observer.observe(el);
}

/** Stop waiting on everything inside root, before it is thrown away. */
export function forget(root) {
  if (!observer) return;
  for (const el of root.querySelectorAll('[data-lazy]')) {
    observer.unobserve(el);
    pending.delete(el);
  }
}
