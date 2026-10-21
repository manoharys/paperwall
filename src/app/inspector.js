// The right-hand panel: properties of what's selected, the page when nothing
// is, and the layers list.

import { h, icon, iconButton, clear, toast, pickFile, readFileAsDataUrl, dialog, mod } from './ui.js';
import { colorButton, slider, numberField, selectField, segmented, toggle, section, closePopover, popoverOpen, PALETTES, fontPicker, gradientEditor } from './widgets.js';
import { FONTS, FONT_KINDS } from '../model/fonts.js';
import { ANIMATIONS, PAGE_ANIMATIONS, TRANSITIONS, DEFAULT_ANIM_DURATION, DEFAULT_STAGGER, DEFAULT_TRANSITION_DURATION, LIMITS, pageDuration } from '../model/motion.js';
import { SHAPES, FRAME_MASKS, createText, restroke, PRESETS, toPx, fromPx, DEFAULT_FILTERS, uid, isEmptyFrame, parseChartData, chartDataText, parseTable, tableText, soundtrackOf, KEEPS_RATIO, NOTE_COLORS } from '../model/doc.js';
import { collectColors, cropZoom } from '../model/commands.js';
import { renderElementOnly, TEXT_EFFECTS } from '../model/render.js';
import { measure, addCustomFont, customFontNames, ensureFont, fontSettled } from './fonts.js';
import { iconById, stickerById } from '../model/graphics.js';
import { getSetting } from './store.js';

const DUOTONES = [
  ['Ink', '#1a1a2e', '#f7f4ef'], ['Ocean', '#0b2a45', '#7fd1c7'], ['Sunset', '#5b1a6e', '#ffb36b'], ['Berry', '#3b1426', '#ff8fa3'],
  ['Forest', '#1f3a2e', '#e9c46a'], ['Pop', '#2a1bd6', '#ff6b9a'], ['Citrus', '#14532d', '#fde047'], ['Sepia', '#3a2418', '#f4d6a0'],
];

// Effect previews depend only on the font, so each is drawn once.
const previews = new Map();
function cached(key, keep, make) {
  if (previews.has(key)) return previews.get(key);
  const v = make();
  if (keep) previews.set(key, v);
  return v;
}

const EFFECT_NAMES = { none: 'None', lift: 'Lift', hollow: 'Hollow', splice: 'Splice', echo: 'Echo', glitch: 'Glitch', glow: 'Glow', neon: 'Neon' };

const TYPE_NAMES = { video: 'Video', text: 'Text', shape: 'Shape', line: 'Line', image: 'Image', icon: 'Icon', sticker: 'Sticker', qr: 'QR code', group: 'Group', chart: 'Chart', table: 'Table', draw: 'Drawing', connector: 'Connector' };
const SHAPE_NAMES = { rect: 'Rectangle', ellipse: 'Circle', triangle: 'Triangle', star: 'Star', polygon: 'Polygon', heart: 'Heart', arrow: 'Arrow', bubble: 'Speech bubble', diamond: 'Diamond', arch: 'Arch', blob: 'Blob' };
// Frame shapes are named as shapes are, but for these three.
const MASK_LABELS = { ...SHAPE_NAMES, none: 'Rectangle', circle: 'Circle', polygon: 'Hexagon' };

// Presets set the basic adjustments only; warmth, tint, hue, vignette and
// duotone are left as they are. Original puts everything back.
// The basic adjustments, at their defaults.
const BASIC = Object.fromEntries(['brightness', 'contrast', 'saturation', 'grayscale', 'sepia', 'blur'].map((k) => [k, DEFAULT_FILTERS[k]]));
const FILTER_PRESETS = {
  original: { ...DEFAULT_FILTERS },
  bw: { ...BASIC, grayscale: 100, contrast: 110 },
  sepia: { ...BASIC, sepia: 80, contrast: 95 },
  vivid: { ...BASIC, saturation: 150, contrast: 115 },
  fade: { ...BASIC, saturation: 70, contrast: 85, brightness: 110 },
};

export class Inspector {
  constructor(editor, canvas, { onResizeDesign, onPlay }) {
    this.ed = editor;
    this.canvas = canvas;
    this.onResizeDesign = onResizeDesign;
    this.onPlay = onPlay;
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
      if (what === 'aids' || what === 'tool' || what === 'stop-drawing' || what === 'strip') return; // not about the selection
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
    if (!sel.length) return this.body.append(...this.pagePanel().filter(Boolean));
    if (sel.length > 1) return this.body.append(...this.multiPanel(sel));
    this.body.append(...this.elementPanel(sel[0]).filter(Boolean));
  }

  // ---------- helpers ----------

  up(props, key, ids, pageId) {
    this.ed.update(props, key, ids, pageId);
  }

  /** Charts and tables draw labels in two weights; load both first. */
  async setFont(font) {
    const ids = this.ed.selection;
    const pageId = this.ed.pageData.id;
    await Promise.all([ensureFont(font, 400), ensureFont(font, 700)]);
    this.up({ font }, null, ids, pageId);
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
      if (KEEPS_RATIO.includes(el.type)) {
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
    // A connector is set by its ends: turning it is just moving them.
    if (el.type === 'connector') delete fields.rotation;
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
      video: () => this.videoPanel(el),
      icon: () => [section('Color', h('div', { class: 'field inline' }, h('span', null, 'Icon color'), colorButton({ label: 'Icon color', testid: 'icon-color', value: el.color, getContext: this.colorContext, onChange: (c, l) => this.up({ color: c }, l ? 'color' : null) })),
        slider({ label: 'Line weight', value: el.strokeWidth || 1.8, min: 0.5, max: 4, step: 0.1, onChange: (v, l) => this.up({ strokeWidth: v }, l ? 'sw' : null) }))],
      connector: () => [
        section('Connector',
          segmented({ label: 'Route', value: el.route, testid: 'connector-route', onChange: (route) => this.up({ route }), options: [
            { value: 'straight', label: 'Straight', text: 'Straight' }, { value: 'elbow', label: 'Elbow', text: 'Elbow' }, { value: 'curved', label: 'Curved', text: 'Curved' },
          ] }),
          h('p', { class: 'hint' }, el.start?.id || el.end?.id ? 'Attached ends follow their elements. Drag an end away to free it.' : 'Drag an end onto an element to attach it.')),
        ...this.linePanel(el)],
      draw: () => [section('Drawing',
        h('div', { class: 'field inline' }, h('span', null, 'Color'), colorButton({ label: 'Drawing color', testid: 'draw-color', value: el.stroke, getContext: this.colorContext, onChange: (c, l) => this.up({ stroke: c }, l ? 'stroke' : null) })),
        slider({ label: 'Thickness', value: Math.round(el.strokeWidth), min: 1, max: 120, testid: 'draw-width', onChange: (v, l) => this.up(restroke(this.ed.single || el, v), l ? 'strokeWidth' : null) }))],
      qr: () => this.qrPanel(el),
      chart: () => this.chartPanel(el),
      table: () => this.tablePanel(el),
    }[el.type];
    if (specific) out.push(...specific());
    out.push(this.arrange(1), this.geometry(el), this.effects(), this.animatePanel(el));
    return out;
  }

  /** How the element comes in when the page plays (presenting, GIF, video). */
  animatePanel(el) {
    const ed = this.ed;
    const a = el.anim || { type: 'none' };
    const now = () => this.ed.single?.anim || a;
    const pageAnim = ed.pageData.anim?.type;
    const withPage = !!pageAnim && pageAnim !== 'none' && ed.pageData.elements.some((e) => e.id === el.id);
    return section('Animate',
      h('div', { class: 'anim-grid', role: 'group', 'aria-label': 'Animation', 'data-testid': 'anim-types' }, [
        // With a page animation (and not inside a group, which comes in as
        // one): "With the page" follows it, None keeps this one still.
        ...(withPage ? [h('button', { type: 'button', class: `anim${!el.anim ? ' on' : ''}`, 'aria-pressed': String(!el.anim), 'data-testid': 'anim-page', onClick: () => this.up({ anim: null }) }, 'With the page')] : []),
        ...Object.entries(ANIMATIONS).map(([type, { name }]) => {
          const on = type === 'none' ? (withPage ? el.anim?.type === 'none' : a.type === 'none') : a.type === type;
          return h('button', {
            type: 'button', class: `anim${on ? ' on' : ''}`, 'aria-pressed': String(on), 'data-testid': `anim-${type}`,
            // A whole replacement (updates merge into objects).
            onClick: () => this.up({ anim: type === 'none' ? (withPage ? { type: 'none' } : null) : { type, duration: now().duration ?? DEFAULT_ANIM_DURATION, delay: now().delay ?? 0 } }),
          }, name);
        }),
      ]),
      withPage && !el.anim ? h('p', { class: 'hint' }, `Comes in with the page's ${ANIMATIONS[pageAnim].name.toLowerCase()} animation. Pick None to keep it still.`) : null,
      a.type !== 'none' ? h('div', { class: 'sub' },
        slider({ label: 'Duration', value: a.duration ?? DEFAULT_ANIM_DURATION, min: LIMITS.duration[0], max: LIMITS.duration[1], step: 0.1, unit: 's', testid: 'anim-duration', onChange: (v, l) => this.up({ anim: { ...now(), duration: v } }, l ? 'anim' : null) }),
        slider({ label: 'Delay', value: a.delay ?? 0, min: LIMITS.delay[0], max: LIMITS.delay[1], step: 0.1, unit: 's', testid: 'anim-delay', onChange: (v, l) => this.up({ anim: { ...now(), delay: v } }, l ? 'anim' : null) })) : null,
      h('button', { type: 'button', class: 'btn small wide', 'data-testid': 'anim-play', onClick: () => this.onPlay?.({ only: true }) }, icon('play'), 'Play this page'));
  }

  /** The design's soundtrack: what it is, how loud, and taking it away. */
  soundtrackRow() {
    const ed = this.ed;
    const a = soundtrackOf(ed.doc);
    if (!a) return h('p', { class: 'hint', 'data-testid': 'soundtrack-none' }, 'Soundtrack: add a sound from Uploads. It plays when you press Play, and in videos you download.');
    return h('div', { class: 'sub', 'data-testid': 'soundtrack' },
      h('div', { class: 'field inline' }, h('span', null, 'Soundtrack'), h('b', { class: 'ellipsis' }, a.name || 'Sound'),
        iconButton('trash', 'Remove the soundtrack', () => ed.setSoundtrack(null), { 'data-testid': 'soundtrack-remove' })),
      slider({ label: 'Volume', value: Math.round((ed.doc.audio.volume ?? 1) * 100), min: 0, max: 100, unit: '%', testid: 'soundtrack-volume', onChange: (v, l) => ed.setSoundtrackVolume(v / 100, l ? 'volume' : null) }));
  }

  /** The page's own motion: an animation for everything on it, how long it shows, and how it comes in. */
  motionPanel() {
    const ed = this.ed;
    const page = ed.pageData;
    const at = ed.page;
    const pa = page.anim || { type: 'none' };
    const tr = page.transition || { type: 'none' };
    const set = (patch, key) => ed.setPageMotion(at, patch, key);
    return section('Motion',
      selectField({ label: 'Animate the page', value: pa.type, testid: 'page-anim', options: Object.entries(PAGE_ANIMATIONS).map(([value, { name }]) => ({ value, label: name })), onChange: (type) => set({ anim: type === 'none' ? undefined : { ...pa, type, stagger: pa.stagger ?? DEFAULT_STAGGER } }) }),
      slider({ label: 'Show for', value: pageDuration(page), min: LIMITS.page[0], max: LIMITS.page[1], step: 0.5, unit: 's', testid: 'page-duration', onChange: (v, l) => set({ duration: v }, l ? `duration:${at}` : null) }),
      selectField({ label: 'Transition into this page', value: tr.type, testid: 'page-transition', options: Object.entries(TRANSITIONS).map(([value, { name }]) => ({ value, label: name })), onChange: (type) => set({ transition: type === 'none' ? undefined : { type, duration: tr.duration ?? DEFAULT_TRANSITION_DURATION } }) }),
      at === 0 && tr.type !== 'none' ? h('p', { class: 'hint' }, 'Shows when this page follows another, as when pages are moved.') : null,
      this.soundtrackRow(),
      h('button', { type: 'button', class: 'btn small wide', 'data-testid': 'page-play', onClick: () => this.onPlay?.() }, icon('play'), 'Play from this page'));
  }

  multiPanel(sel) {
    const joinable = sel.length === 2 && sel.every((e) => e.type !== 'connector');
    return [
      h('div', { class: 'panel-head' }, h('h2', { 'data-testid': 'selection-title' }, `${sel.length} selected`), this.actions()),
      joinable ? section('Connect', h('button', { type: 'button', class: 'btn small wide', 'data-testid': 'connect', onClick: () => this.ed.connect() }, icon('connect'), 'Connect with a line')) : null,
      this.arrange(sel.length),
      this.effects(),
    ].filter(Boolean);
  }

  textPanel(el) {
    const ed = this.ed;
    const fontSelect = fontPicker({ value: el.font, fonts: FONTS, kinds: FONT_KINDS, extra: customFontNames(), testid: 'font-select', onChange: (font) => ed.setFont(font) });
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
      // A sticky note: its color.
      el.note ? section('Sticky note', h('div', { class: 'note-grid', 'data-testid': 'note-colors-edit' }, NOTE_COLORS.map((c, i) => h('button', {
        type: 'button', class: `note-swatch${c === el.note ? ' on' : ''}`, style: { background: c }, 'aria-label': `Note color ${i + 1}`, 'aria-pressed': String(c === el.note), 'data-testid': `note-color-${i}`,
        onClick: () => this.up({ note: c }),
      })))) : null,
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
        this.textEffects(el),
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

  /** The duotone as it is now (the panel isn't redrawn while a picker is open). */
  duotoneNow(f) {
    return this.ed.single?.filters?.duotone || f.duotone;
  }

  /** Effect styles shown as little "Ag" previews, plus the effect's own settings. */
  textEffects(el) {
    const fx = el.effect || { type: 'none' };
    // Start from the effect as it is now: the panel isn't redrawn while a slider is in use.
    const set = (patch, live) => this.up({ effect: { ...(this.ed.single?.effect || fx), ...patch } }, live ? 'effect' : null);
    // Kept only once the font is done loading (or has failed for good, when
    // stand-in letters are all there will be). The previews use the heavy
    // weight, which the text itself may not.
    const heavy = fontSettled(el.font, 800);
    if (!heavy) ensureFont(el.font, 800).catch(() => null);
    const preview = (type) => cached(`${el.font}|${type}`, heavy, () => renderElementOnly(this.ed.doc, createText({
      text: 'Ag', w: 64, h: 44, size: 32, weight: 800, font: el.font, color: type === 'neon' ? '#ff2d95' : '#1a1a2e', align: 'center', lineHeight: 1.2,
      effect: { type, color: ['splice', 'glow'].includes(type) ? '#ffb703' : undefined },
    }), { measure, idPrefix: `fx-${type}` }));
    const uses = {
      color: ['splice', 'glitch', 'glow', 'neon'].includes(fx.type),
      offset: ['splice', 'echo', 'glitch'].includes(fx.type),
      thickness: ['hollow', 'splice'].includes(fx.type),
    };
    return h('div', null,
      h('div', { class: 'fx-grid', role: 'group', 'aria-label': 'Text effect', 'data-testid': 'text-effects' }, TEXT_EFFECTS.map((type) => h('button', {
        type: 'button', class: `fx${fx.type === type ? ' on' : ''}`, 'aria-pressed': String(fx.type === type), title: EFFECT_NAMES[type], 'data-testid': `effect-${type}`,
        // A new effect starts with the colors its preview shows (not the last
        // effect's); the sizes carry over. Updates merge into the effect, so
        // Glitch's second color is cleared explicitly.
        onClick: () => this.up({ effect: type === 'none' ? null : { type, color: ({ splice: '#ffb703', glow: '#ffb703', neon: '#ff2d95' })[type], color2: undefined, offset: fx.offset, thickness: fx.thickness } }),
      }, h('span', { class: 'fx-img', html: preview(type) }), h('small', null, EFFECT_NAMES[type])))),
      fx.type !== 'none' ? h('div', { class: 'sub' },
        uses.color ? h('div', { class: 'field inline' },
          h('span', null, fx.type === 'glitch' ? 'Colors' : 'Effect color'),
          // Show the colors the effect actually draws with.
          colorButton({ label: 'Effect color', testid: 'effect-color', value: fx.color || (fx.type === 'glitch' ? '#00e5ff' : el.color), getContext: this.colorContext, onChange: (c, l) => set({ color: c }, l) }),
          fx.type === 'glitch' ? colorButton({ label: 'Second effect color', testid: 'effect-color-2', value: fx.color2 || '#ff2d95', getContext: this.colorContext, onChange: (c, l) => set({ color2: c }, l) }) : null) : null,
        uses.offset ? slider({ label: 'Offset', value: Math.round((fx.offset ?? 0.08) * 100), min: 0, max: 40, testid: 'effect-offset', onChange: (v, l) => set({ offset: v / 100 }, l) }) : null,
        uses.thickness ? slider({ label: 'Thickness', value: Math.round((fx.thickness ?? 0.035) * 1000), min: 5, max: 120, testid: 'effect-thickness', onChange: (v, l) => set({ thickness: v / 1000 }, l) }) : null) : null);
  }

  shapePanel(el) {
    const isGradient = el.fill && typeof el.fill === 'object';
    const fill = isGradient ? el.fill : null;
    const solid = isGradient ? fill.stops[0].color : el.fill;
    return [
      section('Shape',
        selectField({ label: 'Shape', value: el.shape, testid: 'shape-select', options: SHAPES.map((s) => ({ value: s, label: SHAPE_NAMES[s] })), onChange: (shape) => this.up({ shape }) }),
        segmented({ label: 'Fill type', value: isGradient ? 'gradient' : 'solid', testid: 'fill-type', onChange: (t) => {
          if (t === 'gradient' && !isGradient) this.up({ fill: { type: 'linear', angle: 135, stops: [{ offset: 0, color: solid || '#6c5ce7' }, { offset: 1, color: '#ffd166' }] } });
          if (t === 'solid' && isGradient) this.up({ fill: solid });
        }, options: [{ value: 'solid', label: 'Solid', text: 'Solid' }, { value: 'gradient', label: 'Gradient', text: 'Gradient' }] }),
        isGradient
          ? h('div', { class: 'sub' }, gradientEditor({ label: 'Fill gradient', value: fill, getContext: this.colorContext, testid: 'fill-gradient', current: () => this.ed.single?.fill?.stops && this.ed.single.fill, onChange: (g, l) => this.up({ fill: g }, l ? 'grad' : null) }))
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
      slider({ label: 'Thickness', value: el.strokeWidth, min: 1, max: 80, testid: 'line-width', onChange: (v, l) => this.up(el.type === 'connector' ? { strokeWidth: v } : { strokeWidth: v, h: Math.max(el.h, v * 6) }, l ? 'sw' : null) }),
      segmented({ label: 'Line style', value: el.dash || 'solid', onChange: (dash) => this.up({ dash }), options: [
        { value: 'solid', label: 'Solid line', text: '———' },
        { value: 'dashed', label: 'Dashed line', text: '– – –' },
        { value: 'dotted', label: 'Dotted line', text: '• • •' },
      ] }),
      h('div', { class: 'row' },
        toggle({ label: 'Arrow at start', checked: el.startCap === 'arrow', testid: 'arrow-start', onChange: (on) => this.up({ startCap: on ? 'arrow' : 'none' }) }),
        toggle({ label: 'Arrow at end', checked: el.endCap === 'arrow', testid: 'arrow-end', onChange: (on) => this.up({ endCap: on ? 'arrow' : 'none' }) })))];
  }

  /** Where a video starts and whether it loops; its shape, like a picture's. */
  videoPanel(el) {
    const asset = this.ed.doc.assets[el.assetId];
    const length = asset?.duration || 0;
    return [section('Video',
      h('p', { class: 'hint' }, `${length ? `${Math.round(length * 10) / 10} seconds. ` : ''}Plays when the page plays, presents or downloads as a video. Videos play without their sound: add a soundtrack from Uploads.`),
      length > 0.5 ? slider({ label: 'Start at', value: el.trim?.start || 0, min: 0, max: Math.floor((length - 0.5) * 10) / 10, step: 0.1, unit: 's', testid: 'video-start', onChange: (v, l) => {
        this.up({ trim: { start: v } }, l ? 'trim' : null);
        if (!l) this.ed.refreshStill(el.id); // the still picture: where it now starts
      } }) : null,
      toggle({ label: 'Play again from the start when it ends', checked: el.loop !== false, testid: 'video-loop', onChange: (on) => this.up({ loop: on }) }),
      selectField({ label: 'Frame shape', value: el.mask || 'none', testid: 'video-mask', options: FRAME_MASKS.map((m) => ({ value: m, label: MASK_LABELS[m] })), onChange: (mask) => this.up({ mask }) }),
      !el.mask || el.mask === 'none' ? slider({ label: 'Corner rounding', value: el.radius || 0, min: 0, max: Math.round(Math.min(el.w, el.h) / 2), onChange: this.live('radius') }) : null)];
  }

  imagePanel(el) {
    const ed = this.ed;
    const shape = section('Shape',
      selectField({ label: 'Frame shape', value: el.mask || 'none', testid: 'image-mask', options: FRAME_MASKS.map((m) => ({ value: m, label: MASK_LABELS[m] })), onChange: (mask) => this.up({ mask }) }),
      !el.mask || el.mask === 'none'
        ? slider({ label: 'Corner rounding', value: el.radius || 0, min: 0, max: Math.round(Math.min(el.w, el.h) / 2), testid: 'image-radius', onChange: this.live('radius') })
        : null);
    if (isEmptyFrame(ed.doc, el)) {
      return [
        section('Frame',
          h('p', { class: 'hint' }, 'Drop a photo onto the frame, drag one from Uploads, or pick one here.'),
          h('button', { type: 'button', class: 'btn small wide primary', 'data-testid': 'frame-add-photo', onClick: () => this.canvas.pickPhotoFor(el, { evenLocked: true }) }, icon('image'), 'Add a photo')),
        shape,
      ];
    }
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
          h('button', { type: 'button', class: 'btn small', 'data-testid': 'replace-image', onClick: () => this.canvas.pickPhotoFor(el, { evenLocked: true }) }, icon('image'), 'Replace')),
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
        slider({ label: 'Blur', value: f.blur, min: 0, max: 40, testid: 'blur', onChange: filt('blur') }),
        slider({ label: 'Warmth', value: f.warmth, min: -100, max: 100, testid: 'warmth', onChange: filt('warmth') }),
        slider({ label: 'Tint', value: f.tint, min: -100, max: 100, testid: 'tint', onChange: filt('tint') }),
        slider({ label: 'Hue', value: f.hue, min: 0, max: 360, unit: '°', testid: 'hue', onChange: filt('hue') }),
        slider({ label: 'Vignette', value: f.vignette, min: 0, max: 100, testid: 'vignette', onChange: filt('vignette') })),
      section('Duotone',
        h('div', { class: 'duo-grid', role: 'group', 'aria-label': 'Duotone', 'data-testid': 'duotone' },
          h('button', { type: 'button', class: `duo${f.duotone ? '' : ' on'}`, 'data-testid': 'duotone-none', onClick: () => this.up({ filters: { duotone: null } }) }, 'None'),
          DUOTONES.map(([name, dark, light]) => h('button', { type: 'button', class: `duo${f.duotone?.dark === dark && f.duotone?.light === light ? ' on' : ''}`, title: name, 'aria-label': `Duotone ${name}`, 'data-testid': `duotone-${name}`, style: { background: `linear-gradient(135deg, ${dark} 50%, ${light} 50%)` }, onClick: () => this.up({ filters: { duotone: { dark, light } } }) }))),
        f.duotone ? h('div', { class: 'field inline' },
          h('span', null, 'Shadows'), colorButton({ label: 'Duotone shadows', value: f.duotone.dark, getContext: this.colorContext, onChange: (c, l) => this.up({ filters: { duotone: { ...this.duotoneNow(f), dark: c } } }, l ? 'duo' : null) }),
          h('span', null, 'Highlights'), colorButton({ label: 'Duotone highlights', value: f.duotone.light, getContext: this.colorContext, onChange: (c, l) => this.up({ filters: { duotone: { ...this.duotoneNow(f), light: c } } }, l ? 'duo' : null) })) : null),
      shape,
    ];
  }

  chartPanel(el) {
    const data = h('textarea', { rows: '6', 'data-testid': 'chart-data', 'aria-label': 'Chart data, one "label, value" per line', spellcheck: 'false' });
    data.value = chartDataText(el.data);
    data.addEventListener('input', () => {
      const parsed = parseChartData(data.value);
      if (parsed.length) this.up({ data: parsed }, 'chart-data');
    });
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
      fontPicker({ value: el.font, fonts: FONTS, kinds: FONT_KINDS, onChange: (font) => this.setFont(font) }),
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
      fontPicker({ value: el.font, fonts: FONTS, kinds: FONT_KINDS, onChange: (font) => this.setFont(font) }),
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
    return [
      h('div', { class: 'panel-head' }, h('h2', { 'data-testid': 'selection-title' }, `Page ${ed.page + 1} of ${doc.pages.length}`)),
      section('Page',
        (() => {
          const input = h('input', { type: 'text', value: ed.pageData.title || '', maxlength: '120', placeholder: 'Add a page title', 'aria-label': 'Page title', 'data-testid': 'page-title' });
          // Saved as it's typed (one undo step): the panel can be redrawn
          // before the field would report a change.
          const at = ed.page;
          input.addEventListener('input', () => ed.setPageTitle(at, input.value));
          input.addEventListener('keydown', (e) => e.key === 'Enter' && input.blur());
          return h('label', { class: 'field' }, h('span', null, 'Title'), input);
        })(),
        toggle({ label: 'Hide this page when presenting and downloading', checked: !!ed.pageData.hidden, testid: 'page-hidden', onChange: (on) => ed.setPageHidden(ed.page, on) })),
      section('Background',
        segmented({ label: 'Background type', value: bg.type, testid: 'bg-type', onChange: (t) => {
          if (t === 'color') ed.setBackground({ type: 'color', color: bg.color || grad?.stops[0].color || '#ffffff' });
          if (t === 'gradient') ed.setBackground({ type: 'gradient', gradient: { type: 'linear', angle: 160, stops: [{ offset: 0, color: bg.color && bg.color !== '#ffffff' ? bg.color : '#ffd1dc' }, { offset: 1, color: '#a0c4ff' }] } });
          if (t === 'image') toast('Select an image on the page and choose "Use as page background", or add one from Uploads.');
        }, options: [{ value: 'color', label: 'Color', text: 'Color' }, { value: 'gradient', label: 'Gradient', text: 'Gradient' }, { value: 'image', label: 'Image', text: 'Image' }] }),
        bg.type === 'color' ? h('div', { class: 'field inline' }, h('span', null, 'Color'), colorButton({ label: 'Background color', testid: 'bg-color', value: bg.color, getContext: this.colorContext, onChange: (c, l) => ed.setBackground({ type: 'color', color: c }, l ? 'color' : null) })) : null,
        grad ? h('div', { class: 'sub' }, gradientEditor({ label: 'Background gradient', value: grad, getContext: this.colorContext, testid: 'bg-gradient', current: () => ed.pageData.background?.gradient, onChange: (g, l) => ed.setBackground({ type: 'gradient', gradient: g }, l ? 'grad' : null) })) : null,
        bg.type === 'image' ? h('button', { type: 'button', class: 'btn small wide', onClick: () => ed.setBackground({ type: 'color', color: '#ffffff' }) }, 'Remove background image') : null),
      this.motionPanel(),
      section('Notes',
        h('textarea', { rows: '4', class: 'notes', 'data-testid': 'page-notes', 'aria-label': 'Speaker notes for this page', placeholder: 'What to say on this page. Only you see these, in the presenter view.', maxlength: '10000',
          onInput: (e) => ed.setPageNotes(ed.page, e.target.value, `notes:${ed.pageData.id}`) }, ed.pageData.notes || '')),
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
