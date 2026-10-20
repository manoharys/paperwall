// The right-hand panel: properties of what's selected, the page when nothing
// is, and the layers list.

import { h, icon, iconButton, clear, toast, pickFile, readFileAsDataUrl, dialog, mod } from './ui.js';
import { colorButton, slider, numberField, selectField, segmented, toggle, section, closePopover, popoverOpen, PALETTES } from './widgets.js';
import { FONTS } from '../model/fonts.js';
import { SHAPES, PRESETS, toPx, fromPx, DEFAULT_FILTERS, uid, parseChartData, chartDataText, parseTable, tableText } from '../model/doc.js';
import { collectColors, cropZoom } from '../model/commands.js';
import { renderElementOnly } from '../model/render.js';
import { measure, addCustomFont, customFontNames } from './fonts.js';
import { iconById, stickerById } from '../model/graphics.js';
import { getSetting } from './store.js';

const TYPE_NAMES = { text: 'Text', shape: 'Shape', line: 'Line', image: 'Image', icon: 'Icon', sticker: 'Sticker', qr: 'QR code', group: 'Group', chart: 'Chart', table: 'Table' };
const SHAPE_NAMES = { rect: 'Rectangle', ellipse: 'Circle', triangle: 'Triangle', star: 'Star', polygon: 'Polygon', heart: 'Heart', arrow: 'Arrow', bubble: 'Speech bubble', diamond: 'Diamond' };

const FILTER_PRESETS = {
  original: { ...DEFAULT_FILTERS },
  bw: { ...DEFAULT_FILTERS, grayscale: 100, contrast: 110 },
  sepia: { ...DEFAULT_FILTERS, sepia: 80, contrast: 95 },
  vivid: { ...DEFAULT_FILTERS, saturation: 150, contrast: 115 },
  fade: { ...DEFAULT_FILTERS, saturation: 70, contrast: 85, brightness: 110 },
};

export class Inspector {
  constructor(editor, canvas, { onResizeDesign }) {
    this.ed = editor;
    this.canvas = canvas;
    this.onResizeDesign = onResizeDesign;
    this.tab = 'edit';
    this.brand = { colors: [] };
    this.body = h('div', { class: 'inspector-body' });
    this.tabs = h('div', { class: 'tabs', role: 'tablist' },
      this.tabButton('edit', 'Edit'),
      this.tabButton('layers', 'Layers'));
    this.el = h('aside', { class: 'inspector', 'data-testid': 'inspector', 'aria-label': 'Properties' }, this.tabs, this.body);
    this.stale = false;
    editor.on((what) => {
      if (what === 'live') return this.refreshGeometry();
      // Don't pull the rug out from under a field or color picker in use.
      const busy = (this.el.contains(document.activeElement) && document.activeElement.tagName !== 'BUTTON') || popoverOpen();
      if (what === 'doc' && busy) {
        this.stale = true;
        return this.refreshGeometry();
      }
      this.render();
    });
    document.addEventListener('paperwall:popover-closed', () => {
      if (this.stale) this.render();
    });
    this.el.addEventListener('focusout', () => {
      setTimeout(() => {
        if (this.stale && !this.el.contains(document.activeElement) && !popoverOpen()) this.render();
      }, 0);
    });
    getSetting('brand', { colors: [] }).then((b) => (this.brand = b || { colors: [] }));
  }

  tabButton(id, label) {
    return h('button', { type: 'button', role: 'tab', 'data-tab': id, 'data-testid': `tab-${id}`, onClick: () => {
      this.tab = id;
      this.render();
    } }, label);
  }

  colorContext = () => ({ used: collectColors(this.ed.doc).slice(0, 12), brand: this.brand.colors || [] });

  render() {
    this.stale = false;
    closePopover();
    for (const b of this.tabs.children) b.setAttribute('aria-selected', String(b.dataset.tab === this.tab));
    clear(this.body);
    this.geo = null;
    if (this.tab === 'layers') return this.body.append(this.layers());
    const sel = this.ed.selected;
    if (!sel.length) return this.body.append(...this.pagePanel());
    if (sel.length > 1) return this.body.append(...this.multiPanel(sel));
    this.body.append(...this.elementPanel(sel[0]));
  }

  // ---------- helpers ----------

  up(props, key) {
    this.ed.update(props, key);
  }

  live(prop, transform = (v) => v) {
    return (v, isLive) => this.up({ [prop]: transform(v) }, isLive ? prop : null);
  }

  actions() {
    const ed = this.ed;
    const el = ed.single;
    const locked = ed.selected.every((e) => e.locked);
    return h('div', { class: 'action-row' },
      iconButton('dup', `Duplicate (${mod}+D)`, () => ed.duplicate(), { 'data-testid': 'act-duplicate' }),
      iconButton(locked ? 'unlock' : 'lock', locked ? 'Unlock' : `Lock (${mod}+L)`, () => ed.toggleLock(), { 'data-testid': 'act-lock' }),
      iconButton('paint', 'Copy style', () => ed.copyStyle(), { 'data-testid': 'act-copy-style', disabled: !el }),
      iconButton('pasteStyle', 'Paste style', () => ed.pasteStyle(), { 'data-testid': 'act-paste-style', disabled: !ed.hasStyle }),
      iconButton('trash', 'Delete (Del)', () => ed.deleteSelection(), { 'data-testid': 'act-delete' }));
  }

  arrange(count) {
    const ed = this.ed;
    const el = ed.single;
    return section('Arrange',
      h('div', { class: 'btn-grid six', 'data-testid': 'align-buttons' },
        iconButton('alignLeft', 'Align left', () => ed.align('left'), { 'data-testid': 'align-left' }),
        iconButton('alignCenter', 'Align center', () => ed.align('center'), { 'data-testid': 'align-center' }),
        iconButton('alignRight', 'Align right', () => ed.align('right'), { 'data-testid': 'align-right' }),
        iconButton('alignTop', 'Align top', () => ed.align('top'), { 'data-testid': 'align-top' }),
        iconButton('alignMiddle', 'Align middle', () => ed.align('middle'), { 'data-testid': 'align-middle' }),
        iconButton('alignBottom', 'Align bottom', () => ed.align('bottom'), { 'data-testid': 'align-bottom' })),
      count >= 3 ? h('div', { class: 'btn-grid two' },
        h('button', { type: 'button', class: 'btn small', 'data-testid': 'distribute-x', onClick: () => ed.distribute('x') }, icon('distH'), 'Space across'),
        h('button', { type: 'button', class: 'btn small', 'data-testid': 'distribute-y', onClick: () => ed.distribute('y') }, icon('distV'), 'Space down')) : null,
      h('div', { class: 'btn-grid six' },
        iconButton('front', `Bring to front (${mod}+])`, () => ed.reorder('front'), { 'data-testid': 'order-front' }),
        iconButton('up', 'Bring forward (])', () => ed.reorder('forward'), { 'data-testid': 'order-forward' }),
        iconButton('down', 'Send backward ([)', () => ed.reorder('backward'), { 'data-testid': 'order-backward' }),
        iconButton('back', `Send to back (${mod}+[)`, () => ed.reorder('back'), { 'data-testid': 'order-back' }),
        iconButton('flipH', 'Flip horizontally', () => ed.flip('x'), { 'data-testid': 'flip-x' }),
        iconButton('flipV', 'Flip vertically', () => ed.flip('y'), { 'data-testid': 'flip-y' })),
      count > 1 ? h('button', { type: 'button', class: 'btn small wide', 'data-testid': 'act-group', onClick: () => ed.group() }, icon('group'), `Group (${mod}+G)`) : null,
      el?.type === 'group' ? h('button', { type: 'button', class: 'btn small wide', 'data-testid': 'act-ungroup', onClick: () => ed.ungroup() }, icon('ungroup'), `Ungroup (${mod}+Shift+G)`) : null);
  }

  geometry(el) {
    const set = (k) => (v) => this.up({ [k]: k === 'rotation' ? ((v % 360) + 360) % 360 : v });
    const resize = (k) => (v) => {
      const props = { [k]: Math.max(1, v) };
      if (el.type === 'image' || el.type === 'icon' || el.type === 'sticker' || el.type === 'qr') {
        const r = el.w / el.h;
        if (k === 'w') props.h = Math.max(1, v / r);
        else props.w = Math.max(1, v * r);
      }
      this.up(props);
    };
    const fields = {
      x: numberField({ label: 'X position', short: 'X', value: el.x, onChange: set('x'), testid: 'geo-x' }),
      y: numberField({ label: 'Y position', short: 'Y', value: el.y, onChange: set('y'), testid: 'geo-y' }),
      w: numberField({ label: 'Width', short: 'W', value: el.w, onChange: resize('w'), min: 1, testid: 'geo-w' }),
      h: numberField({ label: 'Height', short: 'H', value: el.h, onChange: resize('h'), min: 1, testid: 'geo-h' }),
      rotation: numberField({ label: 'Rotation', short: '°', value: el.rotation || 0, onChange: set('rotation'), testid: 'geo-rotation' }),
    };
    if (el.type === 'text') fields.h.querySelector('input').disabled = true;
    this.geo = { el, fields };
    return section('Position and size', h('div', { class: 'geo-grid' }, Object.values(fields)));
  }

  refreshGeometry() {
    if (!this.geo) return;
    const { el, fields } = this.geo;
    for (const [k, f] of Object.entries(fields)) {
      const input = f.querySelector('input');
      if (document.activeElement !== input) input.value = Math.round((el[k] || 0) * 100) / 100;
    }
  }

  effects() {
    const el = this.ed.single;
    const first = this.ed.selected[0];
    const shadow = first.shadow;
    const k = Math.max(1, Math.min(this.ed.doc.width, this.ed.doc.height) / 1080);
    return section('Effects',
      slider({ label: 'Transparency', value: Math.round((1 - (first.opacity ?? 1)) * 100), min: 0, max: 100, unit: '%', testid: 'opacity', onChange: (v, isLive) => this.up({ opacity: 1 - v / 100 }, isLive ? 'opacity' : null) }),
      toggle({ label: 'Shadow', checked: !!shadow, testid: 'shadow-toggle', onChange: (on) => this.up({ shadow: on ? { x: 0, y: Math.round(8 * k), blur: Math.round(24 * k), color: '#000000', opacity: 0.35 } : null }) }),
      shadow && el ? h('div', { class: 'sub' },
        slider({ label: 'Blur', value: shadow.blur, min: 0, max: Math.round(120 * k), onChange: (v, l) => this.up({ shadow: { ...el.shadow, blur: v } }, l ? 'shadow' : null) }),
        slider({ label: 'Offset', value: shadow.y, min: Math.round(-60 * k), max: Math.round(60 * k), onChange: (v, l) => this.up({ shadow: { ...el.shadow, y: v } }, l ? 'shadow' : null) }),
        slider({ label: 'Strength', value: Math.round(shadow.opacity * 100), min: 0, max: 100, unit: '%', onChange: (v, l) => this.up({ shadow: { ...el.shadow, opacity: v / 100 } }, l ? 'shadow' : null) }),
        h('div', { class: 'field inline' }, h('span', null, 'Color'), colorButton({ label: 'Shadow color', value: shadow.color, getContext: this.colorContext, onChange: (c, l) => this.up({ shadow: { ...el.shadow, color: c } }, l ? 'shadow' : null) }))) : null);
  }

  // ---------- panels ----------

  elementPanel(el) {
    const title = el.type === 'shape' ? SHAPE_NAMES[el.shape] : el.type === 'icon' ? iconById(el.iconId)?.name || 'Icon' : el.type === 'sticker' ? stickerById(el.stickerId)?.name || 'Sticker' : TYPE_NAMES[el.type];
    const out = [h('div', { class: 'panel-head' }, h('h2', { 'data-testid': 'selection-title' }, title, el.locked ? h('span', { class: 'badge' }, 'Locked') : null), this.actions())];
    const specific = {
      text: () => this.textPanel(el),
      shape: () => this.shapePanel(el),
      line: () => this.linePanel(el),
      image: () => this.imagePanel(el),
      icon: () => [section('Color', h('div', { class: 'field inline' }, h('span', null, 'Icon color'), colorButton({ label: 'Icon color', testid: 'icon-color', value: el.color, getContext: this.colorContext, onChange: (c, l) => this.up({ color: c }, l ? 'color' : null) })),
        slider({ label: 'Line weight', value: el.strokeWidth || 1.8, min: 0.5, max: 4, step: 0.1, onChange: (v, l) => this.up({ strokeWidth: v }, l ? 'sw' : null) }))],
      qr: () => this.qrPanel(el),
      chart: () => this.chartPanel(el),
      table: () => this.tablePanel(el),
    }[el.type];
    if (specific) out.push(...specific());
    out.push(this.arrange(1), this.geometry(el), this.effects());
    return out;
  }

  multiPanel(sel) {
    return [
      h('div', { class: 'panel-head' }, h('h2', { 'data-testid': 'selection-title' }, `${sel.length} selected`), this.actions()),
      this.arrange(sel.length),
      this.effects(),
    ];
  }

  textPanel(el) {
    const ed = this.ed;
    const fonts = [...FONTS.map((f) => f.name), ...customFontNames()];
    const fontSelect = selectField({
      label: 'Font', value: el.font, testid: 'font-select',
      options: fonts.map((f) => ({ value: f, label: f })),
      renderOption: (opt, o) => (opt.style.fontFamily = `"${o.value}"`),
      onChange: (font) => this.up({ font }),
    });
    const upload = h('button', { type: 'button', class: 'link-btn', 'data-testid': 'upload-font', onClick: async () => {
      const [file] = await pickFile('.woff2,.woff,.ttf,.otf,font/*');
      if (!file) return;
      try {
        const dataUrl = await readFileAsDataUrl(file);
        const family = await addCustomFont(file.name, dataUrl);
        ed.change(() => {
          ed.doc.assets[uid('f')] = { type: 'font', family, dataUrl, name: file.name };
          for (const t of ed.selected) if (t.type === 'text') {
            t.font = family;
            ed.fitText(t);
          }
        });
        toast(`${family} added. It's saved inside this design.`);
      } catch {
        toast('That font file could not be read.', 'error');
      }
    } }, 'Use your own font…');
    const bold = (el.weight || 400) >= 600;
    return [
      section('Text',
        fontSelect,
        upload,
        h('div', { class: 'row' },
          numberField({ label: 'Font size', short: 'Size', value: el.size, min: 1, max: 2000, testid: 'font-size', onChange: (v) => this.up({ size: v }) }),
          h('div', { class: 'field inline' }, h('span', null, 'Color'), colorButton({ label: 'Text color', testid: 'text-color', value: el.color, getContext: this.colorContext, onChange: (c, l) => this.up({ color: c }, l ? 'color' : null) }))),
        h('div', { class: 'segmented', role: 'group', 'aria-label': 'Text style' },
          styleBtn('bold', 'Bold', bold, () => this.up({ weight: bold ? 400 : 700 }), 'text-bold'),
          styleBtn('italic', 'Italic', el.italic, () => this.up({ italic: !el.italic }), 'text-italic'),
          styleBtn('underline', 'Underline', el.underline, () => this.up({ underline: !el.underline }), 'text-underline'),
          styleBtn('strike', 'Strikethrough', el.strike, () => this.up({ strike: !el.strike }), 'text-strike'),
          styleBtn('caps', 'All caps', el.caps, () => this.up({ caps: !el.caps }), 'text-caps')),
        segmented({ label: 'Alignment', value: el.align, testid: 'text-align', onChange: (align) => this.up({ align }), options: [
          { value: 'left', label: 'Align text left', icon: 'tAlignLeft' },
          { value: 'center', label: 'Center text', icon: 'tAlignCenter' },
          { value: 'right', label: 'Align text right', icon: 'tAlignRight' },
        ] }),
        segmented({ label: 'List', value: el.list, testid: 'text-list', onChange: (list) => this.up({ list: el.list === list ? 'none' : list }), options: [
          { value: 'bullet', label: 'Bulleted list', icon: 'listBullet' },
          { value: 'number', label: 'Numbered list', icon: 'listNumber' },
        ] }),
        slider({ label: 'Line spacing', value: el.lineHeight, min: 0.6, max: 3, step: 0.05, testid: 'line-height', onChange: this.live('lineHeight') }),
        slider({ label: 'Letter spacing', value: el.letterSpacing, min: -Math.round(el.size * 0.1), max: Math.round(el.size * 0.8), step: 0.5, testid: 'letter-spacing', onChange: this.live('letterSpacing') })),
      section('Text effects',
        toggle({ label: 'Outline', checked: !!el.outline, testid: 'outline-toggle', onChange: (on) => this.up({ outline: on ? { width: Math.max(1, Math.round(el.size * 0.04)), color: '#ffffff' } : null }) }),
        el.outline ? h('div', { class: 'sub' },
          slider({ label: 'Outline width', value: el.outline.width, min: 0.5, max: Math.max(4, Math.round(el.size * 0.2)), step: 0.5, onChange: (v, l) => this.up({ outline: { ...el.outline, width: v } }, l ? 'outline' : null) }),
          h('div', { class: 'field inline' }, h('span', null, 'Color'), colorButton({ label: 'Outline color', value: el.outline.color, getContext: this.colorContext, onChange: (c, l) => this.up({ outline: { ...el.outline, color: c } }, l ? 'outline' : null) }))) : null,
        toggle({ label: 'Background box', checked: !!el.highlight, testid: 'highlight-toggle', onChange: (on) => this.up({ highlight: on ? { color: '#ffe066', padding: Math.round(el.size * 0.15), radius: Math.round(el.size * 0.12) } : null }) }),
        el.highlight ? h('div', { class: 'sub' },
          h('div', { class: 'field inline' }, h('span', null, 'Box color'), colorButton({ label: 'Box color', value: el.highlight.color, getContext: this.colorContext, onChange: (c, l) => this.up({ highlight: { ...el.highlight, color: c } }, l ? 'hl' : null) })),
          slider({ label: 'Roundness', value: el.highlight.radius ?? 0, min: 0, max: Math.round(el.size * 0.6), onChange: (v, l) => this.up({ highlight: { ...el.highlight, radius: v } }, l ? 'hl' : null) })) : null,
        slider({ label: 'Curve', value: el.curve || 0, min: -100, max: 100, testid: 'curve', onChange: this.live('curve') })),
    ];
  }

  shapePanel(el) {
    const isGradient = el.fill && typeof el.fill === 'object';
    const fill = isGradient ? el.fill : null;
    const solid = isGradient ? fill.stops[0].color : el.fill;
    const setStop = (i) => (c, l) => {
      const stops = fill.stops.map((s, k) => (k === i ? { ...s, color: c } : s));
      this.up({ fill: { ...fill, stops } }, l ? 'grad' : null);
    };
    return [
      section('Shape',
        selectField({ label: 'Shape', value: el.shape, testid: 'shape-select', options: SHAPES.map((s) => ({ value: s, label: SHAPE_NAMES[s] })), onChange: (shape) => this.up({ shape }) }),
        segmented({ label: 'Fill type', value: isGradient ? 'gradient' : 'solid', testid: 'fill-type', onChange: (t) => {
          if (t === 'gradient' && !isGradient) this.up({ fill: { type: 'linear', angle: 135, stops: [{ offset: 0, color: solid || '#6c5ce7' }, { offset: 1, color: '#ffd166' }] } });
          if (t === 'solid' && isGradient) this.up({ fill: solid });
        }, options: [{ value: 'solid', label: 'Solid', text: 'Solid' }, { value: 'gradient', label: 'Gradient', text: 'Gradient' }] }),
        isGradient
          ? h('div', { class: 'sub' },
            h('div', { class: 'field inline' }, h('span', null, 'From'), colorButton({ label: 'Gradient start', value: fill.stops[0].color, getContext: this.colorContext, onChange: setStop(0) }),
              h('span', null, 'to'), colorButton({ label: 'Gradient end', value: fill.stops[fill.stops.length - 1].color, getContext: this.colorContext, onChange: setStop(fill.stops.length - 1) })),
            segmented({ label: 'Gradient style', value: fill.type, onChange: (type) => this.up({ fill: { ...fill, type } }), options: [{ value: 'linear', label: 'Linear', text: 'Linear' }, { value: 'radial', label: 'Radial', text: 'Radial' }] }),
            fill.type === 'linear' ? slider({ label: 'Angle', value: fill.angle ?? 180, min: 0, max: 360, unit: '°', onChange: (v, l) => this.up({ fill: { ...el.fill, angle: v } }, l ? 'grad' : null) }) : null)
          : h('div', { class: 'field inline' }, h('span', null, 'Fill'), colorButton({ label: 'Fill color', testid: 'fill-color', value: el.fill, getContext: this.colorContext, onChange: (c, l) => this.up({ fill: c }, l ? 'fill' : null) })),
        el.shape === 'rect' ? slider({ label: 'Corner rounding', value: el.radius || 0, min: 0, max: Math.round(Math.min(el.w, el.h) / 2), testid: 'corner-radius', onChange: this.live('radius') }) : null,
        el.shape === 'polygon' || el.shape === 'star' ? slider({ label: el.shape === 'star' ? 'Points' : 'Sides', value: el.sides, min: 3, max: el.shape === 'star' ? 24 : 12, testid: 'sides', onChange: this.live('sides') }) : null,
        el.shape === 'star' ? slider({ label: 'Point depth', value: Math.round((1 - el.innerRatio) * 100), min: 5, max: 90, unit: '%', onChange: (v, l) => this.up({ innerRatio: 1 - v / 100 }, l ? 'inner' : null) }) : null),
      this.strokeSection(el),
    ];
  }

  strokeSection(el) {
    const max = Math.max(20, Math.round(Math.min(el.w, el.h) / 4));
    return section('Border',
      h('div', { class: 'row' },
        h('div', { class: 'field inline' }, h('span', null, 'Color'), colorButton({ label: 'Border color', testid: 'stroke-color', value: el.stroke, getContext: this.colorContext, onChange: (c, l) => this.up({ stroke: c, strokeWidth: el.strokeWidth || Math.max(2, Math.round(Math.min(el.w, el.h) * 0.02)) }, l ? 'stroke' : null) })),
        el.stroke ? h('button', { type: 'button', class: 'link-btn', onClick: () => this.up({ stroke: null, strokeWidth: 0 }) }, 'No border') : null),
      el.stroke ? slider({ label: 'Border width', value: el.strokeWidth || 0, min: 0, max, testid: 'stroke-width', onChange: this.live('strokeWidth') }) : null,
      el.stroke ? segmented({ label: 'Border style', value: el.dash || 'solid', testid: 'stroke-dash', onChange: (dash) => this.up({ dash }), options: [
        { value: 'solid', label: 'Solid line', text: '———' },
        { value: 'dashed', label: 'Dashed line', text: '– – –' },
        { value: 'dotted', label: 'Dotted line', text: '• • •' },
      ] }) : null);
  }

  linePanel(el) {
    return [section('Line',
      h('div', { class: 'field inline' }, h('span', null, 'Color'), colorButton({ label: 'Line color', testid: 'line-color', value: el.stroke, getContext: this.colorContext, onChange: (c, l) => this.up({ stroke: c }, l ? 'stroke' : null) })),
      slider({ label: 'Thickness', value: el.strokeWidth, min: 1, max: 80, testid: 'line-width', onChange: (v, l) => this.up({ strokeWidth: v, h: Math.max(el.h, v * 6) }, l ? 'sw' : null) }),
      segmented({ label: 'Line style', value: el.dash || 'solid', onChange: (dash) => this.up({ dash }), options: [
        { value: 'solid', label: 'Solid line', text: '———' },
        { value: 'dashed', label: 'Dashed line', text: '– – –' },
        { value: 'dotted', label: 'Dotted line', text: '• • •' },
      ] }),
      h('div', { class: 'row' },
        toggle({ label: 'Arrow at start', checked: el.startCap === 'arrow', testid: 'arrow-start', onChange: (on) => this.up({ startCap: on ? 'arrow' : 'none' }) }),
        toggle({ label: 'Arrow at end', checked: el.endCap === 'arrow', testid: 'arrow-end', onChange: (on) => this.up({ endCap: on ? 'arrow' : 'none' }) })))];
  }

  imagePanel(el) {
    const ed = this.ed;
    const f = { ...DEFAULT_FILTERS, ...el.filters };
    const asset = ed.doc.assets[el.assetId];
    const cropping = ed.cropId === el.id;
    const filt = (k) => (v, l) => this.up({ filters: { [k]: v } }, l ? `f-${k}` : null);
    const presetName = Object.entries(FILTER_PRESETS).find(([, p]) => Object.keys(p).every((k) => p[k] === f[k]))?.[0];
    return [
      section('Image',
        h('div', { class: 'btn-grid two' },
          h('button', { type: 'button', class: `btn small${cropping ? ' on' : ''}`, 'data-testid': 'crop-btn', onClick: () => {
            if (cropping) {
              ed.cropId = null;
              ed.emit('selection');
            } else this.canvas.startCrop(el);
          } }, icon('crop'), cropping ? 'Done cropping' : 'Crop'),
          h('button', { type: 'button', class: 'btn small', 'data-testid': 'replace-image', onClick: async () => {
            const [file] = await pickFile('image/*');
            if (!file) return;
            try {
              await ed.replaceImage(await ed.importImageFile(file));
            } catch (e) {
              toast(e.message, 'error');
            }
          } }, icon('image'), 'Replace')),
        cropping && asset ? h('div', { class: 'sub' },
          h('p', { class: 'hint' }, 'Drag the picture to move it inside the frame.'),
          slider({ label: 'Zoom', value: Math.round(cropZoom(el, asset.width, asset.height) * 100), min: 100, max: 400, unit: '%', testid: 'crop-zoom', onChange: (v, l) => {
            ed.change(() => this.canvas.setCropZoom(el, v / 100), { key: l ? `cropzoom:${el.id}` : null });
          } })) : null,
        h('button', { type: 'button', class: 'btn small wide', 'data-testid': 'remove-bg', onClick: async (e) => {
          const btn = e.currentTarget;
          btn.disabled = true;
          try {
            const share = await ed.removeBackground();
            toast(share > 0.01 ? 'Background removed. Undo if it took too much.' : 'No plain background found around the edges.');
          } catch {
            toast('That image could not be processed.', 'error');
          } finally {
            btn.disabled = false;
          }
        } }, icon('crop'), 'Remove plain background'),
        h('button', { type: 'button', class: 'btn small wide', 'data-testid': 'image-to-bg', onClick: () => ed.setImageAsBackground() }, icon('background'), 'Use as page background')),
      section('Adjust',
        segmented({ label: 'Filter', value: presetName, testid: 'filter-presets', onChange: (name) => this.up({ filters: { ...FILTER_PRESETS[name] } }), options: [
          { value: 'original', label: 'Original', text: 'Original' },
          { value: 'bw', label: 'Black and white', text: 'B&W' },
          { value: 'sepia', label: 'Sepia', text: 'Sepia' },
          { value: 'vivid', label: 'Vivid', text: 'Vivid' },
          { value: 'fade', label: 'Fade', text: 'Fade' },
        ] }),
        slider({ label: 'Brightness', value: f.brightness, min: 0, max: 200, testid: 'brightness', onChange: filt('brightness') }),
        slider({ label: 'Contrast', value: f.contrast, min: 0, max: 200, testid: 'contrast', onChange: filt('contrast') }),
        slider({ label: 'Saturation', value: f.saturation, min: 0, max: 200, testid: 'saturation', onChange: filt('saturation') }),
        slider({ label: 'Blur', value: f.blur, min: 0, max: 40, testid: 'blur', onChange: filt('blur') })),
      section('Shape',
        slider({ label: 'Corner rounding', value: el.radius || 0, min: 0, max: Math.round(Math.min(el.w, el.h) / 2), testid: 'image-radius', onChange: this.live('radius') }),
        toggle({ label: 'Circle crop', checked: el.mask === 'circle', testid: 'circle-mask', onChange: (on) => this.up({ mask: on ? 'circle' : 'none' }) })),
    ];
  }

  chartPanel(el) {
    const data = h('textarea', { rows: '6', 'data-testid': 'chart-data', 'aria-label': 'Chart data, one "label, value" per line', spellcheck: 'false' });
    data.value = chartDataText(el.data);
    data.addEventListener('input', () => {
      const parsed = parseChartData(data.value);
      if (parsed.length) this.up({ data: parsed }, 'chart-data');
    });
    const fonts = FONTS.map((f) => ({ value: f.name, label: f.name }));
    return [section('Chart',
      segmented({ label: 'Chart type', value: el.chartType, testid: 'chart-type', onChange: (chartType) => this.up({ chartType }), options: [
        { value: 'bar', label: 'Bars', text: 'Bars' },
        { value: 'line', label: 'Line', text: 'Line' },
        { value: 'pie', label: 'Pie', text: 'Pie' },
        { value: 'donut', label: 'Donut', text: 'Donut' },
      ] }),
      h('label', { class: 'field' }, h('span', null, 'Data: one "label, value" per line'), data),
      selectField({ label: 'Colors', value: '', testid: 'chart-palette', options: [{ value: '', label: 'Pick a palette…' }, { value: 'brand', label: 'Brand kit' }, ...PALETTES.map((p) => ({ value: p.name, label: p.name }))], onChange: (name) => {
        const colors = name === 'brand' ? this.brand.colors : PALETTES.find((p) => p.name === name)?.colors;
        if (colors?.length) this.up({ colors: [...colors] });
      } }),
      h('div', { class: 'row' },
        h('div', { class: 'field inline' }, h('span', null, 'First color'), colorButton({ label: 'Chart color', testid: 'chart-color', value: el.colors[0], getContext: this.colorContext, onChange: (c, l) => this.up({ colors: [c, ...el.colors.slice(1)] }, l ? 'cc' : null) })),
        h('div', { class: 'field inline' }, h('span', null, 'Labels'), colorButton({ label: 'Label color', value: el.textColor, getContext: this.colorContext, onChange: (c, l) => this.up({ textColor: c }, l ? 'tc' : null) }))),
      selectField({ label: 'Font', value: el.font, options: fonts, onChange: (font) => this.up({ font }) }),
      toggle({ label: el.chartType === 'pie' || el.chartType === 'donut' ? 'Show percentages' : 'Show values', checked: el.showValues, testid: 'chart-values', onChange: (showValues) => this.up({ showValues }) }))];
  }

  tablePanel(el) {
    const cells = h('textarea', { rows: '6', 'data-testid': 'table-data', 'aria-label': 'Table cells, comma between cells, one row per line', spellcheck: 'false' });
    cells.value = tableText(el.rows);
    cells.addEventListener('input', () => {
      const rows = parseTable(cells.value);
      if (!rows.length) return;
      const rh = el.h / el.rows.length;
      this.up({ rows, h: Math.max(rh, rh * rows.length) }, 'table-data');
    });
    const fonts = FONTS.map((f) => ({ value: f.name, label: f.name }));
    return [section('Table',
      h('label', { class: 'field' }, h('span', null, 'Cells: commas between cells, one row per line'), cells),
      h('div', { class: 'row' },
        toggle({ label: 'Header row', checked: el.header, testid: 'table-header', onChange: (header) => this.up({ header }) }),
        toggle({ label: 'Stripes', checked: el.stripes, testid: 'table-stripes', onChange: (stripes) => this.up({ stripes }) })),
      h('div', { class: 'row' },
        numberField({ label: 'Text size', short: 'Size', value: el.size, min: 4, max: 400, testid: 'table-size', onChange: (size) => this.up({ size }) }),
        segmented({ label: 'Cell alignment', value: el.align, onChange: (align) => this.up({ align }), options: [
          { value: 'left', label: 'Align left', icon: 'tAlignLeft' },
          { value: 'center', label: 'Center', icon: 'tAlignCenter' },
          { value: 'right', label: 'Align right', icon: 'tAlignRight' },
        ] })),
      selectField({ label: 'Font', value: el.font, options: fonts, onChange: (font) => this.up({ font }) }),
      h('div', { class: 'row' },
        h('div', { class: 'field inline' }, h('span', null, 'Header'), colorButton({ label: 'Header color', testid: 'table-header-fill', value: el.headerFill, getContext: this.colorContext, onChange: (c, l) => this.up({ headerFill: c }, l ? 'hf' : null) })),
        h('div', { class: 'field inline' }, h('span', null, 'Text'), colorButton({ label: 'Table text color', value: el.color, getContext: this.colorContext, onChange: (c, l) => this.up({ color: c }, l ? 'tc' : null) })),
        h('div', { class: 'field inline' }, h('span', null, 'Stripes'), colorButton({ label: 'Stripe color', value: el.stripeFill, getContext: this.colorContext, onChange: (c, l) => this.up({ stripeFill: c }, l ? 'sf' : null) }))))];
  }

  qrPanel(el) {
    const input = h('textarea', { rows: '3', 'data-testid': 'qr-data', 'aria-label': 'QR code link or text', maxlength: '200' });
    input.value = el.data;
    input.addEventListener('input', () => this.up({ data: input.value || ' ' }, 'qr'));
    return [section('QR code',
      h('label', { class: 'field' }, h('span', null, 'Link or text'), input),
      h('div', { class: 'row' },
        h('div', { class: 'field inline' }, h('span', null, 'Dots'), colorButton({ label: 'QR color', value: el.fg, getContext: this.colorContext, onChange: (c, l) => this.up({ fg: c }, l ? 'fg' : null) })),
        h('div', { class: 'field inline' }, h('span', null, 'Background'), colorButton({ label: 'QR background', value: el.bg, getContext: this.colorContext, onChange: (c, l) => this.up({ bg: c }, l ? 'bg' : null) }))),
      h('p', { class: 'hint' }, 'Made on your device. Test-scan it with your phone before printing.'))];
  }

  pagePanel() {
    const ed = this.ed;
    const doc = ed.doc;
    const bg = ed.pageData.background || { type: 'color', color: '#ffffff' };
    const unit = doc.unit || 'px';
    const size = unit === 'px' ? `${doc.width} × ${doc.height} px` : `${fromPx(doc.width, unit)} × ${fromPx(doc.height, unit)} ${unit}`;
    const grad = bg.type === 'gradient' ? bg.gradient : null;
    const setStop = (i) => (c, l) => ed.setBackground({ type: 'gradient', gradient: { ...grad, stops: grad.stops.map((s, k) => (k === i ? { ...s, color: c } : s)) } }, l ? 'grad' : null);
    return [
      h('div', { class: 'panel-head' }, h('h2', { 'data-testid': 'selection-title' }, `Page ${ed.page + 1} of ${doc.pages.length}`)),
      section('Background',
        segmented({ label: 'Background type', value: bg.type, testid: 'bg-type', onChange: (t) => {
          if (t === 'color') ed.setBackground({ type: 'color', color: bg.color || grad?.stops[0].color || '#ffffff' });
          if (t === 'gradient') ed.setBackground({ type: 'gradient', gradient: { type: 'linear', angle: 160, stops: [{ offset: 0, color: bg.color && bg.color !== '#ffffff' ? bg.color : '#ffd1dc' }, { offset: 1, color: '#a0c4ff' }] } });
          if (t === 'image') toast('Select an image on the page and choose "Use as page background", or add one from Uploads.');
        }, options: [{ value: 'color', label: 'Color', text: 'Color' }, { value: 'gradient', label: 'Gradient', text: 'Gradient' }, { value: 'image', label: 'Image', text: 'Image' }] }),
        bg.type === 'color' ? h('div', { class: 'field inline' }, h('span', null, 'Color'), colorButton({ label: 'Background color', testid: 'bg-color', value: bg.color, getContext: this.colorContext, onChange: (c, l) => ed.setBackground({ type: 'color', color: c }, l ? 'color' : null) })) : null,
        grad ? h('div', { class: 'sub' },
          h('div', { class: 'field inline' }, h('span', null, 'From'), colorButton({ label: 'Background gradient start', value: grad.stops[0].color, getContext: this.colorContext, onChange: setStop(0) }),
            h('span', null, 'to'), colorButton({ label: 'Background gradient end', value: grad.stops[grad.stops.length - 1].color, getContext: this.colorContext, onChange: setStop(grad.stops.length - 1) })),
          segmented({ label: 'Gradient style', value: grad.type, onChange: (type) => ed.setBackground({ type: 'gradient', gradient: { ...grad, type } }), options: [{ value: 'linear', label: 'Linear', text: 'Linear' }, { value: 'radial', label: 'Radial', text: 'Radial' }] }),
          grad.type === 'linear' ? slider({ label: 'Angle', value: grad.angle ?? 180, min: 0, max: 360, unit: '°', onChange: (v, l) => ed.setBackground({ type: 'gradient', gradient: { ...ed.pageData.background.gradient, angle: v } }, l ? 'angle' : null) }) : null) : null,
        bg.type === 'image' ? h('button', { type: 'button', class: 'btn small wide', onClick: () => ed.setBackground({ type: 'color', color: '#ffffff' }) }, 'Remove background image') : null),
      section('Design',
        h('p', { class: 'meta', 'data-testid': 'design-size' }, size),
        h('button', { type: 'button', class: 'btn wide', 'data-testid': 'resize-design', onClick: () => this.onResizeDesign() }, icon('resize'), 'Resize to another format')),
      section('Page',
        h('div', { class: 'btn-grid three' },
          h('button', { type: 'button', class: 'btn small', 'data-testid': 'page-add', onClick: () => ed.addPage() }, icon('plus'), 'Add'),
          h('button', { type: 'button', class: 'btn small', 'data-testid': 'page-duplicate', onClick: () => ed.duplicatePage() }, icon('dup'), 'Duplicate'),
          h('button', { type: 'button', class: 'btn small', 'data-testid': 'page-delete', onClick: () => ed.deletePage() }, icon('trash'), 'Delete'))),
    ];
  }

  layers() {
    const ed = this.ed;
    const els = [...ed.pageData.elements].reverse();
    if (!els.length) return h('p', { class: 'empty-note' }, 'Nothing on this page yet.');
    const list = h('ol', { class: 'layers', 'data-testid': 'layers' });
    els.forEach((el, i) => {
      const index = ed.pageData.elements.length - 1 - i;
      const thumb = h('span', { class: 'layer-thumb', html: renderElementOnly(ed.doc, el.type === 'text' ? { ...el } : el, { measure, idPrefix: `ly${i}` }) });
      const name = el.type === 'text' ? el.text.split('\n')[0].slice(0, 40) || 'Text' : el.type === 'shape' ? SHAPE_NAMES[el.shape] : el.type === 'icon' ? iconById(el.iconId)?.name : TYPE_NAMES[el.type];
      const item = h('li', {
        class: `layer${ed.selection.includes(el.id) ? ' on' : ''}${el.hidden ? ' hidden' : ''}`,
        draggable: 'true',
        'data-id': el.id,
        'data-testid': 'layer',
        onClick: (e) => ed.select([el.id], { add: e.shiftKey }),
      },
      thumb,
      h('span', { class: 'layer-name' }, name),
      el.locked ? icon('lock', 16) : null,
      iconButton(el.hidden ? 'eyeOff' : 'eye', el.hidden ? 'Show' : 'Hide', (e) => {
        e.stopPropagation();
        ed.toggleHidden(el.id);
      }, { 'data-testid': 'layer-visibility' }),
      iconButton('up', 'Move up', (e) => {
        e.stopPropagation();
        ed.moveLayer(el.id, index + 1);
      }, { 'data-testid': 'layer-up', disabled: i === 0 }),
      iconButton('down', 'Move down', (e) => {
        e.stopPropagation();
        ed.moveLayer(el.id, index - 1);
      }, { 'data-testid': 'layer-down', disabled: i === els.length - 1 }));
      item.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/plain', el.id));
      item.addEventListener('dragover', (e) => e.preventDefault());
      item.addEventListener('drop', (e) => {
        e.preventDefault();
        const id = e.dataTransfer.getData('text/plain');
        if (id && id !== el.id) ed.moveLayer(id, index);
      });
      list.append(item);
    });
    return h('div', null, h('p', { class: 'hint' }, 'Top of the list is in front. Drag to reorder.'), list);
  }
}

function styleBtn(name, label, on, onClick, testid) {
  return h('button', { type: 'button', class: on ? 'on' : '', title: label, 'aria-label': label, 'aria-pressed': String(!!on), 'data-testid': testid, onClick }, icon(name));
}

/** The "Resize to another format" dialog. */
export function resizeDialog(editor) {
  const doc = editor.doc;
  let unit = 'px';
  const wIn = h('input', { type: 'number', min: '1', value: doc.width, 'aria-label': 'New width', 'data-testid': 'resize-w' });
  const hIn = h('input', { type: 'number', min: '1', value: doc.height, 'aria-label': 'New height', 'data-testid': 'resize-h' });
  const unitSel = h('select', { 'aria-label': 'Units' }, ['px', 'mm', 'in'].map((u) => h('option', { value: u }, u)));
  unitSel.addEventListener('change', () => {
    const w = toPx(+wIn.value, unit);
    const hh = toPx(+hIn.value, unit);
    unit = unitSel.value;
    wIn.value = fromPx(w, unit);
    hIn.value = fromPx(hh, unit);
  });
  const go = async (w, hh, name) => {
    d.close();
    await editor.resizeTo(w, hh, name);
    toast('Resized copy made. Your original is untouched.');
  };
  const presets = h('div', { class: 'preset-grid' }, PRESETS.map((p) => h('button', { type: 'button', class: 'preset', 'data-testid': `resize-preset-${p.id}`, onClick: () => go(p.w, p.h, `${doc.name} (${p.name})`) },
    h('span', { class: 'preset-shape', style: { aspectRatio: `${p.w} / ${p.h}` } }), h('b', null, p.name), h('small', null, `${p.w} × ${p.h}`))));
  const custom = h('form', { class: 'custom-size', onSubmit: (e) => {
    e.preventDefault();
    const w = toPx(+wIn.value, unit);
    const hh = toPx(+hIn.value, unit);
    if (!(w > 0 && hh > 0) || w > 20000 || hh > 20000) return toast('Pick a size between 1 and 20000 px.', 'error');
    go(w, hh);
  } }, wIn, h('span', null, '×'), hIn, unitSel, h('button', { type: 'submit', class: 'btn primary', 'data-testid': 'resize-go' }, 'Resize'));
  const d = dialog('Resize to another format', h('div', null,
    h('p', { class: 'hint' }, 'Paperwall makes a resized copy and keeps everything in proportion. Your original stays as it is.'),
    presets, h('h3', null, 'Custom size'), custom), { wide: true, testid: 'resize-dialog' });
  return d;
}
