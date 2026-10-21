// The left-hand panel: everything you can add to a page.

import { h, icon, iconButton, clear, toast, pickFile, mod, lazily, forget, pressable } from './ui.js';
import { colorButton, selectField, section, slider } from './widgets.js';
import { FONTS, FONT_PAIRS } from '../model/fonts.js';
import { ALL_ICONS, ALL_STICKERS, searchGraphics } from '../model/graphics.js';
import { renderPage, renderElementOnly } from '../model/render.js';
import { DRAW_TOOLS, createShape, createFrame, createIcon, createSticker, createText, createChart, createTable, DOC_STYLES, NOTE_COLORS, createSticky, DOCUMENT, presetById } from '../model/doc.js';
import { GRIDS, gridBoxes } from '../model/grids.js';
import { collectColors, scaleElement } from '../model/commands.js';
import { TEMPLATES, TEMPLATE_CATEGORIES, TEMPLATE_FORMATS, searchTemplates, templateFormatLabel } from '../templates/index.js';
import { measure, ensureFont } from './fonts.js';
import { TEXT_COMBOS, comboGroup, comboFonts } from '../model/text-combos.js';
import { readyTemplate } from './templates.js';
import * as store from './store.js';
import { photosView } from './photos.js';
import { t, formatNumber } from './i18n.js';
import { gridName, comboName, pairName, drawToolName, templateCategory, templateFormat, named } from './names.js';

const TABS = [
  { id: 'templates', label: 'insert.tabTemplates', icon: 'templates' },
  { id: 'text', label: 'insert.tabText', icon: 'text' },
  { id: 'shapes', label: 'insert.tabShapes', icon: 'shapes' },
  { id: 'graphics', label: 'insert.tabGraphics', icon: 'graphics' },
  { id: 'uploads', label: 'insert.tabUploads', icon: 'uploads' },
  { id: 'charts', label: 'insert.tabCharts', icon: 'chart' },
  { id: 'draw', label: 'insert.tabDraw', icon: 'draw' },
  { id: 'qr', label: 'insert.tabQr', icon: 'qr' },
  { id: 'brand', label: 'insert.tabBrand', icon: 'brand' },
];

const SHAPE_ITEMS = [
  { label: 'Square', key: 'insert.square', shape: 'rect', props: {} },
  { label: 'Rounded square', key: 'insert.roundedSquare', shape: 'rect', props: { radius: 60 } },
  { label: 'Circle', shape: 'ellipse', props: {} },
  { label: 'Triangle', shape: 'triangle', props: {} },
  { label: 'Diamond', shape: 'diamond', props: {} },
  { label: 'Pentagon', key: 'insert.pentagon', shape: 'polygon', props: { sides: 5 } },
  { label: 'Hexagon', key: 'shape.hexagon', shape: 'polygon', props: { sides: 6 } },
  { label: 'Star', shape: 'star', props: { sides: 5 } },
  { label: 'Burst', key: 'insert.burst', shape: 'star', props: { sides: 16, innerRatio: 0.78 } },
  { label: 'Heart', shape: 'heart', props: {} },
  { label: 'Arrow', shape: 'arrow', props: { h: 180 } },
  { label: 'Speech bubble', shape: 'bubble', props: {} },
  { label: 'Arch', shape: 'arch', props: {} },
  { label: 'Blob', shape: 'blob', props: {} },
];

const FRAME_ITEMS = [
  { label: 'Square frame', key: 'frame.square', mask: 'none', props: {} },
  { label: 'Rounded frame', key: 'frame.rounded', mask: 'none', props: { radius: 60 } },
  { label: 'Circle frame', key: 'frame.circle', mask: 'circle', props: {} },
  { label: 'Arch frame', key: 'frame.arch', mask: 'arch', props: { h: 640 } },
  { label: 'Blob frame', key: 'frame.blob', mask: 'blob', props: {} },
  { label: 'Heart frame', key: 'frame.heart', mask: 'heart', props: {} },
  { label: 'Star frame', key: 'frame.star', mask: 'star', props: {} },
  { label: 'Hexagon frame', key: 'frame.hexagon', mask: 'polygon', props: {} },
  { label: 'Portrait frame', key: 'frame.portrait', mask: 'none', props: { h: 640 } },
  { label: 'Landscape frame', key: 'frame.landscape', mask: 'none', props: { w: 640, h: 420 } },
];

const LINE_ITEMS = [
  { label: 'Line', key: 'type.line', props: {} },
  { label: 'Arrow line', key: 'line.arrow', props: { endCap: 'arrow' } },
  { label: 'Dashed line', key: 'line.dashed', props: { dash: 'dashed' } },
  { label: 'Dotted line', key: 'line.dotted', props: { dash: 'dotted', strokeWidth: 8 } },
  { label: 'Double arrow', key: 'line.double', props: { startCap: 'arrow', endCap: 'arrow' } },
];

const PREVIEW_DOC = { assets: {} };

// What a new document block starts with (people type over it).
const DOC_TEXT = { heading: 'newText.docHeading', body: 'newText.docBody', bullets: 'newText.docBullets', numbers: 'newText.docNumbers' };

export class InsertPanel {
  constructor(editor) {
    this.ed = editor;
    this.tab = 'templates';
    this.query = '';
    this.category = 'All';
    this.body = h('div', { class: 'insert-body' });
    this.rail = h('nav', { class: 'rail', 'aria-label': t('insert.rail') },
      TABS.map((tab) => h('button', { type: 'button', 'data-tab': tab.id, 'data-testid': `rail-${tab.id}`, onClick: () => this.open(tab.id) }, icon(tab.icon, 22), h('span', null, t(tab.label)))));
    this.el = h('div', { class: 'insert' }, this.rail, h('div', { class: 'insert-panel', 'data-testid': 'insert-panel' }, this.body));
    this.pen = { tool: 'pen', color: '#1a1a2e', size: DRAW_TOOLS.pen.strokeWidth };
    editor.on((what) => {
      // Back to Templates without reopening the panel (on phones it may have just been hidden).
      if (what === 'stop-drawing') {
        this.tab = 'templates';
        this.render();
      }
    });
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
    // The Draw tab turns drawing on; leaving it (or closing the panel) turns it off.
    const drawing = this.tab === 'draw' && !this.el.classList.contains('collapsed');
    if (!!this.ed.drawTool !== drawing || (drawing && this.ed.drawTool !== this.pen)) {
      this.ed.drawTool = drawing ? this.pen : null;
      this.ed.emit('tool');
    }
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
      draw: () => this.draw(),
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
        onPick: (tpl) => this.useTemplate(tpl),
      }),
      h('p', { class: 'hint' }, t('insert.templatesHint')),
    ];
  }

  async useTemplate(tpl) {
    const ed = this.ed;
    const doc = await readyTemplate(tpl);
    if (ed.closed) return; // the design was closed while the template loaded
    // Decide only now, after the wait: the design may have changed meanwhile.
    const blank = ed.doc.pages.length === 1 && !ed.pageData.elements.length ? ed.pageData.id : null;
    ed.addTemplatePage(doc);
    if (blank) {
      ed.change(() => ed.doc.pages.splice(ed.doc.pages.findIndex((p) => p.id === blank), 1));
      ed.page = -1;
      ed.setPage(0);
    }
    toast(t('insert.templateAdded', { name: tpl.name }));
  }

  // ---------- drawing ----------

  draw() {
    const pen = this.pen;
    const pick = (patch) => {
      Object.assign(pen, patch);
      this.render();
    };
    const COLORS = ['#1a1a2e', '#ffffff', '#f25c2a', '#ffd166', '#06d6a0', '#118ab2', '#5b5bd6', '#ff4d6d'];
    return [
      section(t('insert.draw'),
        h('p', { class: 'hint' }, t('insert.drawHint')),
        h('div', { class: 'tool-row', role: 'group', 'aria-label': t('insert.drawTool'), 'data-testid': 'draw-tools' }, Object.keys(DRAW_TOOLS).map((tool) => h('button', {
          type: 'button', class: `tool${pen.tool === tool ? ' on' : ''}`, 'aria-pressed': String(pen.tool === tool), 'data-testid': `draw-tool-${tool}`,
          onClick: () => pick({ tool, size: DRAW_TOOLS[tool].strokeWidth, color: tool === 'highlighter' && pen.color === '#1a1a2e' ? '#ffd166' : pen.color }),
        }, h('span', { class: `tool-tip ${tool}`, style: { background: pen.color } }), drawToolName(tool)))),
        h('div', { class: 'swatches draw-colors' }, COLORS.map((c) => h('button', { type: 'button', class: `swatch${pen.color === c ? ' on' : ''}`, style: { '--swatch': c }, title: c, 'aria-label': t('insert.drawIn', { color: c }), 'data-testid': `draw-color-${c.slice(1)}`, onClick: () => pick({ color: c }) })),
          // While the picker is dragged only the pen changes (the panel is redrawn once it's done).
          colorButton({ label: t('insert.drawingColor'), value: pen.color, onChange: (c, live) => (live ? (pen.color = c) : pick({ color: c })) })),
        slider({ label: t('common.size'), value: pen.size, min: 1, max: 120, testid: 'draw-size', onChange: (v) => (pen.size = v) }),
        h('button', { type: 'button', class: 'btn small wide', 'data-testid': 'draw-stop', onClick: () => this.open('templates') }, t('insert.doneDrawing'))),
    ];
  }

  // ---------- text ----------

  text() {
    const ed = this.ed;
    const add = (style) => h('button', { type: 'button', class: `text-add ${style}`, 'data-testid': `add-${style}`, onClick: () => ed.addText(style) }, t(`newText.${style}`));
    // A document's blocks go at its end, in its own sizes.
    // (Sized to the document's width: its sizes are for a 1240 px sheet.)
    const block = (style, label) => h('button', { type: 'button', class: `text-add doc-${style}`, 'data-testid': `doc-add-${style}`, onClick: () => {
      const k = ed.doc.width / DOCUMENT.width;
      ed.insert(createText({ ...DOC_STYLES[style], text: t(DOC_TEXT[style]), size: Math.round(DOC_STYLES[style].size * k) }));
    } }, label);
    const notes = section(t('insert.stickyNotes'), h('div', { class: 'note-grid', 'data-testid': 'note-colors' }, NOTE_COLORS.map((c, i) => h('button', {
      type: 'button', class: 'note-swatch', style: { background: c }, 'aria-label': t('insert.addNote', { n: i + 1 }), 'data-testid': `note-add-${i}`,
      // (As big as on a whiteboard as it began: a share of the page's shorter side.)
      onClick: () => {
        const note = createSticky(c, { text: t('newText.note') });
        return ed.insert(ed.scaled(note, ed.doc.board ? note.w / presetById('whiteboard').h : 0.3));
      },
    }))), h('p', { class: 'hint' }, t('insert.notesHint')));
    return [
      ed.doc.document
        ? section(t('insert.addToDocument'), block('heading', t('insert.docHeading')), block('body', t('insert.docParagraph')), block('bullets', t('insert.docBullets')), block('numbers', t('insert.docNumbers')),
          h('p', { class: 'hint' }, t('insert.docHint')))
        : section(t('insert.addText'), add('heading'), add('subheading'), add('body'), h('p', { class: 'hint' }, t('insert.textHint'))),
      ...(ed.doc.board ? [notes] : []),
      section(t('insert.combos'), h('div', { class: 'combo-grid', 'data-testid': 'text-combos' }, TEXT_COMBOS.map((c) => {
        const b = h('button', { type: 'button', class: 'combo', title: comboName(c), 'aria-label': comboName(c), 'data-testid': `combo-${c.id}`, onClick: () => this.addCombo(c) });
        lazily(b, async () => {
          await Promise.all(comboFonts(c).map(({ font, weight }) => ensureFont(font, weight)));
          const g = comboGroup(c, measure);
          b.innerHTML = renderElementOnly(PREVIEW_DOC, g, { measure, idPrefix: `cb-${c.id}` });
        });
        return b;
      }))),
      section(t('insert.fontPairs'),
        h('div', { class: 'pair-grid', 'data-testid': 'font-pairs' }, FONT_PAIRS.map((p) => h('button', { type: 'button', class: 'pair', 'data-testid': `pair-${p.name}`, onClick: () => this.addPair(p) },
          h('b', { style: { fontFamily: `"${p.heading}"` } }, pairName(p)),
          h('small', { style: { fontFamily: `"${p.body}"` } }, `${p.heading} + ${p.body}`))))),
      ...(ed.doc.board ? [] : [notes]),
    ];
  }

  /** Add a text combination, sized to suit the page, once its fonts have loaded. */
  async addCombo(combo) {
    const ed = this.ed;
    await Promise.all(comboFonts(combo).map(({ font, weight }) => ensureFont(font, weight)));
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
    const head = createText({ text: t(pair.name === 'Wedding' ? 'newText.pairHeadingWedding' : 'newText.pairHeading'), font: pair.heading, size: Math.round(88 * k), weight: 700, align: 'center', w });
    const body = createText({ text: t('newText.pairBody'), font: pair.body, size: Math.round(32 * k), align: 'center', w });
    for (const el of [head, body]) ed.fitText(el);
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
      section(t('insert.shapes'), h('div', { class: 'thumb-grid', 'data-testid': 'shape-grid' }, SHAPE_ITEMS.map((s) => {
        const el = createShape(s.shape, { ...s.props, w: 100, h: s.props.h ? 100 * (s.props.h / 300) : 100, radius: s.props.radius ? 20 : 0, fill: '#5b5bd6' });
        return h('button', { type: 'button', class: 'thumb', title: t(s.key || `shape.${s.shape}`), 'aria-label': t(s.key || `shape.${s.shape}`), 'data-testid': `shape-${s.label}`, onClick: () => ed.addShape(s.shape, s.props), html: renderElementOnly(PREVIEW_DOC, el) });
      }))),
      section(t('insert.frames'), h('p', { class: 'hint' }, t('insert.framesHint')),
        h('div', { class: 'thumb-grid', 'data-testid': 'frame-grid' }, FRAME_ITEMS.map((fr) => {
          const el = createFrame(fr.mask, { ...fr.props });
          const k = 100 / Math.max(el.w, el.h);
          Object.assign(el, { w: el.w * k, h: el.h * k, radius: (el.radius || 0) * k });
          return h('button', { type: 'button', class: 'thumb', title: t(fr.key), 'aria-label': t(fr.key), 'data-testid': `frame-${fr.label}`, onClick: () => ed.addFrame(fr.mask, fr.props), html: renderElementOnly(PREVIEW_DOC, el, { placeholders: true }) });
        }))),
      section(t('insert.photoGrids'), h('div', { class: 'thumb-grid', 'data-testid': 'photo-grid-list' }, GRIDS.map((g) => h('button', {
        type: 'button', class: 'thumb', title: gridName(g), 'aria-label': gridName(g), 'data-testid': `grid-${g.id}`, onClick: () => ed.addGrid(g),
        html: `<svg viewBox="0 0 100 100">${gridBoxes(g, 100, 100, { margin: 6, gap: 4 }).map((b) => `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="2" fill="#dcdce6"/>`).join('')}</svg>`,
      })))),
      section(t('insert.connectors'), h('p', { class: 'hint' }, t('insert.connectorsHint')),
        h('div', { class: 'thumb-grid', 'data-testid': 'connector-grid' }, [
          ['straight', t('insert.connStraight'), '<path d="M10 70 L90 30" stroke="currentColor" stroke-width="4" fill="none"/><path d="M90 30 l-14 2 6 12z" fill="currentColor"/>'],
          ['elbow', t('insert.connElbow'), '<path d="M10 70 H50 V30 H90" stroke="currentColor" stroke-width="4" fill="none"/><path d="M92 30 l-12 -7 v14z" fill="currentColor"/>'],
          ['curved', t('insert.connCurved'), '<path d="M10 70 C50 70 50 30 90 30" stroke="currentColor" stroke-width="4" fill="none"/><path d="M92 30 l-12 -7 v14z" fill="currentColor"/>'],
        ].map(([route, label, svg]) => h('button', { type: 'button', class: 'thumb', title: label, 'aria-label': label, 'data-testid': `connector-${route}`, onClick: () => ed.addConnector(route), html: `<svg viewBox="0 0 100 100">${svg}</svg>` })))),
      section(t('insert.lines'), h('div', { class: 'thumb-grid', 'data-testid': 'line-grid' }, LINE_ITEMS.map((l) => h('button', {
        type: 'button', class: 'thumb', title: t(l.key), 'aria-label': t(l.key), 'data-testid': `line-${l.label}`, onClick: () => ed.addLine(l.props),
        html: `<svg viewBox="0 0 100 40"><line x1="8" y1="20" x2="92" y2="20" stroke="currentColor" stroke-width="4" ${l.props.dash === 'dashed' ? 'stroke-dasharray="12 8"' : l.props.dash === 'dotted' ? 'stroke-dasharray="0 9" stroke-linecap="round"' : ''}/>${l.props.endCap ? '<path d="M94 20 82 12v16z" fill="currentColor"/>' : ''}${l.props.startCap ? '<path d="M6 20 18 12v16z" fill="currentColor"/>' : ''}</svg>`,
      })))),
      h('p', { class: 'hint' }, t('insert.shapesHint')),
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
      if (!icons.length && !stickers.length) iconsGrid.append(h('p', { class: 'empty-note' }, t('insert.noGraphics')));
      more.hidden = total <= icons.length;
      more.textContent = t('insert.moreIcons', { n: total - icons.length });
    };
    more.addEventListener('click', () => {
      shown += 240;
      fill();
    });
    const search = this.search(t('insert.searchGraphics', { icons: formatNumber(ALL_ICONS.length, { useGrouping: true }), stickers: ALL_STICKERS.length }), () => {
      shown = 120;
      fill();
    });
    fill();
    return [
      search,
      section(t('insert.icons'), h('p', { class: 'hint' }, t('insert.iconsHint')), iconsGrid, more),
      section(t('insert.stickers'), stickerGrid),
      h('p', { class: 'hint' }, t('insert.graphicsLicense')),
    ];
  }

  // ---------- uploads ----------

  uploads() {
    const ed = this.ed;
    // Your own files, or stock photos (an online extra, off until turned on).
    const views = h('div', { class: 'chips small', role: 'group', 'aria-label': t('insert.show') }, [['mine', t('insert.yourFiles')], ['photos', t('insert.photos')]].map(([id, label]) => h('button', {
      type: 'button', class: `chip${(this.uploadsView || 'mine') === id ? ' on' : ''}`, 'aria-pressed': String((this.uploadsView || 'mine') === id), 'data-testid': `uploads-view-${id}`,
      onClick: () => {
        this.uploadsView = id;
        this.render();
      },
    }, label)));
    if (this.uploadsView === 'photos') return [views, photosView(ed, (this.photos ||= {}))];
    const grid = h('div', { class: 'upload-grid', 'data-testid': 'upload-grid' });
    const load = async () => {
      const ups = await store.listUploads();
      clear(grid);
      if (!ups.length) grid.append(h('p', { class: 'empty-note' }, t('insert.uploadsEmpty')));
      for (const u of ups) {
        // A picture shows itself; a video its poster and a play mark; a sound its name.
        const look = u.kind === 'audio'
          ? h('span', { class: 'upload-sound' }, icon('music'), h('small', null, u.name))
          : h('img', { src: u.kind === 'video' ? u.poster : u.dataUrl, alt: '', draggable: 'false' });
        grid.append(h('div', { class: `upload${u.kind ? ` ${u.kind}` : ''}` },
          pressable({ class: 'upload-img', title: u.kind === 'audio' ? t('insert.useSound', { name: u.name }) : u.name, 'aria-label': u.kind === 'audio' ? t('insert.useSound', { name: u.name }) : t('insert.addNamed', { name: u.name }), 'data-testid': 'upload-item', 'data-kind': u.kind || 'image', draggable: 'true', onDragstart: (e) => {
            // Drag onto the page to add it, or onto a frame to fill the frame.
            e.dataTransfer.setData('application/x-paperwall-upload', u.id);
            e.dataTransfer.effectAllowed = 'copy';
          } }, async () => {
            try {
              // Videos and sounds are listed without their bytes: fetched when used.
              const whole = u.dataUrl ? u : await store.getUpload(u.id);
              if (!whole?.dataUrl) return toast(t('upload.missing', { name: u.name }), 'error');
              if (!ed.closed) await ed.place(whole);
            } catch (e) {
              toast(e.message, 'error');
            }
          }, look, u.kind === 'video' ? h('span', { class: 'upload-play', 'aria-hidden': 'true' }, icon('play', 14)) : null),
          iconButton('trash', t('insert.removeUpload'), async () => {
            await store.deleteUpload(u.id);
            load();
          })));
      }
    };
    load();
    const upload = h('button', { type: 'button', class: 'btn primary wide', 'data-testid': 'upload-btn', onClick: async () => {
      const files = await pickFile('image/*,video/*,audio/*', true);
      for (const f of files) {
        try {
          const u = await ed.importMediaFile(f);
          if (ed.closed) return;
          await ed.place(u);
        } catch (e) {
          toast(e.message, 'error');
        }
      }
      load();
    } }, icon('uploads'), t('insert.upload'));
    return [
      views,
      upload,
      h('p', { class: 'hint' }, t('insert.uploadHint', { keys: `${mod}+V` })),
      grid,
    ];
  }

  // ---------- charts and tables ----------

  charts() {
    const ed = this.ed;
    const kinds = [
      { type: 'bar', label: t('insert.barChart') },
      { type: 'line', label: t('insert.lineChart') },
      { type: 'pie', label: t('insert.pieChart') },
      { type: 'donut', label: t('insert.donutChart') },
    ];
    const tables = [
      { id: 'Simple table', label: t('insert.simpleTable'), props: {} },
      { id: 'Price list', label: t('insert.priceList'), props: { rows: [['Service', 'Price'], ['Haircut', '25'], ['Color', '60'], ['Styling', '35']], align: 'left', headerFill: '#f25c2a' } },
      { id: 'Schedule', label: t('insert.schedule'), props: { rows: [['Day', 'Class', 'Time'], ['Mon', 'Yoga', '7 am'], ['Wed', 'Spin', '6 pm'], ['Fri', 'HIIT', '7 am']], stripes: true, align: 'center' } },
    ];
    return [
      section(t('insert.charts'), h('div', { class: 'thumb-grid two', 'data-testid': 'chart-grid' }, kinds.map((k) => h('button', {
        type: 'button', class: 'thumb wide', title: k.label, 'aria-label': k.label, 'data-testid': `chart-${k.type}`, onClick: () => ed.addChart(k.type),
        html: renderElementOnly(PREVIEW_DOC, createChart(k.type, { w: 200, h: 130, showValues: false }), { measure }),
      }))), h('p', { class: 'hint' }, t('insert.chartsHint'))),
      section(t('insert.tables'), h('div', { class: 'thumb-grid two', 'data-testid': 'table-grid' }, tables.map((tb) => h('button', {
        type: 'button', class: 'thumb wide', title: tb.label, 'aria-label': tb.label, 'data-testid': `table-${tb.id}`, onClick: () => ed.addTable(tb.props),
        html: renderElementOnly(PREVIEW_DOC, createTable({ ...tb.props, w: 200, h: 120, size: 13 }), { measure }),
      })))),
    ];
  }

  // ---------- QR ----------

  qr() {
    const input = h('input', { type: 'url', placeholder: 'https://your-link.com', 'aria-label': t('insert.qrLink'), 'data-testid': 'qr-input' });
    const add = () => {
      const v = input.value.trim();
      if (!v) return toast(t('insert.qrEmpty'));
      if (new TextEncoder().encode(v).length > 200) return toast(t('insert.qrTooLong'), 'error');
      this.ed.addQr(v);
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') add();
    });
    return [section(t('type.qr'),
      h('label', { class: 'field' }, h('span', null, t('common.linkOrText')), input),
      h('button', { type: 'button', class: 'btn primary wide', 'data-testid': 'qr-add', onClick: add }, t('insert.addQr')),
      h('p', { class: 'hint' }, t('insert.qrHint')))];
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
          colorButton({ label: t('brand.color', { n: i + 1 }), value: c, onChange: (v, live) => {
            if (live) return;
            save({ colors: current.colors.map((x, k) => (k === i ? v : x)) });
          } }),
          iconButton('close', t('brand.removeColor'), () => save({ colors: current.colors.filter((_, k) => k !== i) }))),
        ),
        (brand.colors || []).length < 10 ? h('button', { type: 'button', class: 'add-color', title: t('brand.addColor'), 'aria-label': t('brand.addColor'), 'data-testid': 'brand-add-color', onClick: () => {
          const used = collectColors(ed.doc).find((c) => !(current.colors || []).includes(c) && c !== '#ffffff') || '#f25c2a';
          save({ colors: [...(current.colors || []), used] });
        } }, icon('plus')) : null);
      const fontOpts = [{ value: '', label: t('brand.keepFont') }, ...FONTS.map((f) => ({ value: f.name, label: f.name }))];
      wrap.append(
        section(t('brand.colors'), colors, h('p', { class: 'hint' }, t('brand.colorsHint'))),
        section(t('brand.fonts'),
          selectField({ label: t('brand.headings'), value: brand.headingFont || '', options: fontOpts, testid: 'brand-heading-font', onChange: (v) => save({ headingFont: v || null }) }),
          selectField({ label: t('brand.body'), value: brand.bodyFont || '', options: fontOpts, testid: 'brand-body-font', onChange: (v) => save({ bodyFont: v || null }) })),
        h('button', { type: 'button', class: 'btn primary wide', 'data-testid': 'brand-apply', disabled: !(brand.colors?.length || brand.headingFont || brand.bodyFont), onClick: async () => {
          await ed.applyBrand(brand);
          toast(t('brand.applied'));
        } }, t('brand.apply')),
        h('p', { class: 'hint' }, t('brand.hint')));
    };
    store.getSetting('brand', { colors: [] }).then((b) => draw(b || { colors: [] }));
    return wrap;
  }
}

/** A template preview. It's drawn when it scrolls into view, once its fonts have loaded. */
export function templateCard(tpl, onClick) {
  const img = h('span', { class: 'tpl-img', style: { aspectRatio: `${tpl.width} / ${tpl.height}` } });
  lazily(img, async () => {
    try {
      const doc = await readyTemplate(tpl);
      img.innerHTML = renderPage(doc, 0, { measure, noSize: true, idPrefix: `tp-${tpl.id}` });
    } catch (e) {
      img.classList.add('broken');
      console.warn(`Couldn't draw template ${tpl.id}`, e);
    }
  });
  const format = templateFormat(tpl, templateFormatLabel(tpl));
  const meta = tpl.pages > 1 ? t('tpl.meta', { format, pages: t('common.pages', { n: tpl.pages }) }) : format;
  // Previews sit in same-sized frames so rows line up, whatever the format.
  const frame = h('span', { class: tpl.height / tpl.width > 1.25 ? 'tpl-frame tall' : 'tpl-frame' }, img);
  // (The template's name is design content: it stays as written.)
  return h('button', { type: 'button', class: 'tpl', title: t('tpl.title', { name: tpl.name, meta }), 'data-testid': `template-${tpl.id}`, 'data-format': tpl.format, onClick: () => onClick(tpl) },
    frame,
    tpl.pages > 1 ? h('span', { class: 'tpl-badge', 'data-testid': 'template-pages' }, t('common.pages', { n: tpl.pages })) : null,
    h('span', { class: 'tpl-name' }, tpl.name),
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
  const pick = async (tpl) => {
    if (busy) return;
    busy = true;
    try {
      await onPick(tpl);
    } finally {
      busy = false;
    }
  };
  const count = h('p', { class: 'tpl-count', 'data-testid': ids.count, 'aria-live': 'polite' });
  const more = h('button', { type: 'button', class: 'btn more', 'data-testid': ids.more, onClick: () => {
    state.shown += pageSize;
    fill(false);
  } }, t('tpl.more'));
  const search = h('input', { type: 'search', value: state.query, placeholder: t('tpl.searchCount', { n: TEMPLATES.length }), 'aria-label': t('tpl.search'), 'data-testid': ids.search });
  const format = h('select', { 'aria-label': t('common.size'), 'data-testid': ids.format },
    h('option', { value: 'All' }, t('tpl.allSizes')),
    TEMPLATE_FORMATS.map((f) => h('option', { value: f.id, selected: f.id === state.format }, t('tpl.formatCount', { format: named('format', f.id, f.label), n: f.count }))));
  const chips = h('div', { class: 'chips scroll', role: 'group', 'aria-label': t('tpl.categories') });
  const drawChips = () => {
    clear(chips);
    for (const c of ['All', ...TEMPLATE_CATEGORIES]) {
      chips.append(h('button', { type: 'button', class: c === state.category ? 'chip on' : 'chip', 'aria-pressed': String(c === state.category), 'data-testid': `${ids.cat}-${c}`, onClick: () => {
        state.category = c;
        drawChips();
        fill();
      } }, c === 'All' ? t('tplCat.all') : templateCategory(c)));
    }
  };
  const fill = (reset = true) => {
    if (reset) state.shown = pageSize;
    const list = searchTemplates(state);
    forget(grid);
    clear(grid);
    if (!list.length) grid.append(h('p', { class: 'empty-note' }, t('tpl.none')));
    for (const tpl of list.slice(0, state.shown)) grid.append(templateCard(tpl, pick));
    count.textContent = t('tpl.count', { n: list.length });
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
