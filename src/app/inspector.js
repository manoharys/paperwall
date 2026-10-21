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
import { aiWritingSection } from './ai-writing.js';
import { creditSection } from './photos.js';
import { smartRemoveBackground, cutoutOf, refineCutout } from './cutout.js';
import { t, formatNumber, language } from './i18n.js';
import { shapeName, typeName, maskName, effectName, animName, transitionName, paletteName, duotoneName, presetName } from './names.js';

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
      this.tabButton('edit', t('inspector.edit')),
      this.tabButton('layers', t('inspector.layers')));
    this.el = h('aside', { class: 'inspector', 'data-testid': 'inspector', 'aria-label': t('inspector.properties') }, this.tabs, this.body);
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
      iconButton('dup', t('inspector.duplicate', { keys: `${mod}+D` }), () => ed.duplicate(), { 'data-testid': 'act-duplicate' }),
      iconButton(locked ? 'unlock' : 'lock', locked ? t('inspector.unlock') : t('inspector.lock', { keys: `${mod}+L` }), () => ed.toggleLock(), { 'data-testid': 'act-lock' }),
      iconButton('paint', t('inspector.copyStyle'), () => ed.copyStyle(), { 'data-testid': 'act-copy-style', disabled: !el }),
      iconButton('pasteStyle', t('inspector.pasteStyle'), () => ed.pasteStyle(), { 'data-testid': 'act-paste-style', disabled: !ed.hasStyle }),
      iconButton('trash', t('inspector.delete'), () => ed.deleteSelection(), { 'data-testid': 'act-delete' }));
  }

  arrange(count) {
    const ed = this.ed;
    const el = ed.single;
    return section(t('inspector.arrange'),
      h('div', { class: 'btn-grid six', 'data-testid': 'align-buttons' },
        iconButton('alignLeft', t('inspector.alignLeft'), () => ed.align('left'), { 'data-testid': 'align-left' }),
        iconButton('alignCenter', t('inspector.alignCenter'), () => ed.align('center'), { 'data-testid': 'align-center' }),
        iconButton('alignRight', t('inspector.alignRight'), () => ed.align('right'), { 'data-testid': 'align-right' }),
        iconButton('alignTop', t('inspector.alignTop'), () => ed.align('top'), { 'data-testid': 'align-top' }),
        iconButton('alignMiddle', t('inspector.alignMiddle'), () => ed.align('middle'), { 'data-testid': 'align-middle' }),
        iconButton('alignBottom', t('inspector.alignBottom'), () => ed.align('bottom'), { 'data-testid': 'align-bottom' })),
      count >= 3 ? h('div', { class: 'btn-grid two' },
        h('button', { type: 'button', class: 'btn small', 'data-testid': 'distribute-x', onClick: () => ed.distribute('x') }, icon('distH'), t('inspector.spaceAcross')),
        h('button', { type: 'button', class: 'btn small', 'data-testid': 'distribute-y', onClick: () => ed.distribute('y') }, icon('distV'), t('inspector.spaceDown'))) : null,
      h('div', { class: 'btn-grid six' },
        iconButton('front', t('inspector.toFront', { keys: `${mod}+]` }), () => ed.reorder('front'), { 'data-testid': 'order-front' }),
        iconButton('up', t('inspector.forward'), () => ed.reorder('forward'), { 'data-testid': 'order-forward' }),
        iconButton('down', t('inspector.backward'), () => ed.reorder('backward'), { 'data-testid': 'order-backward' }),
        iconButton('back', t('inspector.toBack', { keys: `${mod}+[` }), () => ed.reorder('back'), { 'data-testid': 'order-back' }),
        iconButton('flipH', t('inspector.flipH'), () => ed.flip('x'), { 'data-testid': 'flip-x' }),
        iconButton('flipV', t('inspector.flipV'), () => ed.flip('y'), { 'data-testid': 'flip-y' })),
      count > 1 ? h('button', { type: 'button', class: 'btn small wide', 'data-testid': 'act-group', onClick: () => ed.group() }, icon('group'), t('inspector.group', { keys: `${mod}+G` })) : null,
      el?.type === 'group' ? h('button', { type: 'button', class: 'btn small wide', 'data-testid': 'act-ungroup', onClick: () => ed.ungroup() }, icon('ungroup'), t('inspector.ungroup', { keys: `${mod}+Shift+G` })) : null);
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
      x: numberField({ label: t('inspector.x'), short: 'X', value: el.x, onChange: set('x'), testid: 'geo-x' }),
      y: numberField({ label: t('inspector.y'), short: 'Y', value: el.y, onChange: set('y'), testid: 'geo-y' }),
      w: numberField({ label: t('common.width'), short: t('inspector.w'), value: el.w, onChange: resize('w'), min: 1, testid: 'geo-w' }),
      h: numberField({ label: t('common.height'), short: t('inspector.h'), value: el.h, onChange: resize('h'), min: 1, testid: 'geo-h' }),
      rotation: numberField({ label: t('inspector.rotation'), short: '°', value: el.rotation || 0, onChange: set('rotation'), testid: 'geo-rotation' }),
    };
    if (el.type === 'text') fields.h.querySelector('input').disabled = true;
    // A connector is set by its ends: turning it is just moving them.
    if (el.type === 'connector') delete fields.rotation;
    this.geo = { el, fields };
    return section(t('inspector.geometry'), h('div', { class: 'geo-grid' }, Object.values(fields)));
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
    return section(t('inspector.effects'),
      slider({ label: t('inspector.transparency'), value: Math.round((1 - (first.opacity ?? 1)) * 100), min: 0, max: 100, unit: '%', testid: 'opacity', onChange: (v, isLive) => this.up({ opacity: 1 - v / 100 }, isLive ? 'opacity' : null) }),
      toggle({ label: t('inspector.shadow'), checked: !!shadow, testid: 'shadow-toggle', onChange: (on) => this.up({ shadow: on ? { x: 0, y: Math.round(8 * k), blur: Math.round(24 * k), color: '#000000', opacity: 0.35 } : null }) }),
      shadow && el ? h('div', { class: 'sub' },
        slider({ label: t('inspector.blur'), value: shadow.blur, min: 0, max: Math.round(120 * k), onChange: (v, l) => this.up({ shadow: { ...el.shadow, blur: v } }, l ? 'shadow' : null) }),
        slider({ label: t('inspector.offset'), value: shadow.y, min: Math.round(-60 * k), max: Math.round(60 * k), onChange: (v, l) => this.up({ shadow: { ...el.shadow, y: v } }, l ? 'shadow' : null) }),
        slider({ label: t('inspector.strength'), value: Math.round(shadow.opacity * 100), min: 0, max: 100, unit: '%', onChange: (v, l) => this.up({ shadow: { ...el.shadow, opacity: v / 100 } }, l ? 'shadow' : null) }),
        h('div', { class: 'field inline' }, h('span', null, t('common.color')), colorButton({ label: t('inspector.shadowColor'), value: shadow.color, getContext: this.colorContext, onChange: (c, l) => this.up({ shadow: { ...el.shadow, color: c } }, l ? 'shadow' : null) }))) : null);
  }

  // ---------- panels ----------

  elementPanel(el) {
    const title = elementName(el);
    const out = [h('div', { class: 'panel-head' }, h('h2', { 'data-testid': 'selection-title' }, title, el.locked ? h('span', { class: 'badge' }, t('inspector.locked')) : null), this.actions())];
    const specific = {
      text: () => this.textPanel(el),
      shape: () => this.shapePanel(el),
      line: () => this.linePanel(el),
      image: () => this.imagePanel(el),
      video: () => this.videoPanel(el),
      icon: () => [section(t('common.color'), h('div', { class: 'field inline' }, h('span', null, t('inspector.iconColor')), colorButton({ label: t('inspector.iconColor'), testid: 'icon-color', value: el.color, getContext: this.colorContext, onChange: (c, l) => this.up({ color: c }, l ? 'color' : null) })),
        slider({ label: t('inspector.lineWeight'), value: el.strokeWidth || 1.8, min: 0.5, max: 4, step: 0.1, onChange: (v, l) => this.up({ strokeWidth: v }, l ? 'sw' : null) }))],
      connector: () => [
        section(t('type.connector'),
          segmented({ label: t('inspector.route'), value: el.route, testid: 'connector-route', onChange: (route) => this.up({ route }), options: [
            { value: 'straight', label: t('inspector.straight'), text: t('inspector.straight') }, { value: 'elbow', label: t('inspector.elbow'), text: t('inspector.elbow') }, { value: 'curved', label: t('inspector.curved'), text: t('inspector.curved') },
          ] }),
          h('p', { class: 'hint' }, el.start?.id || el.end?.id ? t('inspector.connAttached') : t('inspector.connFree'))),
        ...this.linePanel(el)],
      draw: () => [section(t('type.draw'),
        h('div', { class: 'field inline' }, h('span', null, t('common.color')), colorButton({ label: t('insert.drawingColor'), testid: 'draw-color', value: el.stroke, getContext: this.colorContext, onChange: (c, l) => this.up({ stroke: c }, l ? 'stroke' : null) })),
        slider({ label: t('inspector.thickness'), value: Math.round(el.strokeWidth), min: 1, max: 120, testid: 'draw-width', onChange: (v, l) => this.up(restroke(this.ed.single || el, v), l ? 'strokeWidth' : null) }))],
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
    return section(t('inspector.animate'),
      h('div', { class: 'anim-grid', role: 'group', 'aria-label': t('inspector.animation'), 'data-testid': 'anim-types' }, [
        // With a page animation (and not inside a group, which comes in as
        // one): t('inspector.withPage') follows it, None keeps this one still.
        ...(withPage ? [h('button', { type: 'button', class: `anim${!el.anim ? ' on' : ''}`, 'aria-pressed': String(!el.anim), 'data-testid': 'anim-page', onClick: () => this.up({ anim: null }) }, t('inspector.withPage'))] : []),
        ...Object.entries(ANIMATIONS).map(([type, { name }]) => {
          const on = type === 'none' ? (withPage ? el.anim?.type === 'none' : a.type === 'none') : a.type === type;
          return h('button', {
            type: 'button', class: `anim${on ? ' on' : ''}`, 'aria-pressed': String(on), 'data-testid': `anim-${type}`,
            // A whole replacement (updates merge into objects).
            onClick: () => this.up({ anim: type === 'none' ? (withPage ? { type: 'none' } : null) : { type, duration: now().duration ?? DEFAULT_ANIM_DURATION, delay: now().delay ?? 0 } }),
          }, animName(type, name));
        }),
      ]),
      withPage && !el.anim ? h('p', { class: 'hint' }, t('inspector.withPageHint', { anim: animName(pageAnim, ANIMATIONS[pageAnim].name).toLocaleLowerCase(language()) })) : null,
      a.type !== 'none' ? h('div', { class: 'sub' },
        slider({ label: t('inspector.duration'), value: a.duration ?? DEFAULT_ANIM_DURATION, min: LIMITS.duration[0], max: LIMITS.duration[1], step: 0.1, unit: 's', testid: 'anim-duration', onChange: (v, l) => this.up({ anim: { ...now(), duration: v } }, l ? 'anim' : null) }),
        slider({ label: t('inspector.delay'), value: a.delay ?? 0, min: LIMITS.delay[0], max: LIMITS.delay[1], step: 0.1, unit: 's', testid: 'anim-delay', onChange: (v, l) => this.up({ anim: { ...now(), delay: v } }, l ? 'anim' : null) })) : null,
      h('button', { type: 'button', class: 'btn small wide', 'data-testid': 'anim-play', onClick: () => this.onPlay?.({ only: true }) }, icon('play'), t('inspector.playPage')));
  }

  /** The design's soundtrack: what it is, how loud, and taking it away. */
  soundtrackRow() {
    const ed = this.ed;
    const a = soundtrackOf(ed.doc);
    if (!a) return h('p', { class: 'hint', 'data-testid': 'soundtrack-none' }, t('inspector.soundtrackNone'));
    return h('div', { class: 'sub', 'data-testid': 'soundtrack' },
      h('div', { class: 'field inline' }, h('span', null, t('inspector.soundtrack')), h('b', { class: 'ellipsis' }, a.name || t('inspector.sound')),
        iconButton('trash', t('inspector.removeSoundtrack'), () => ed.setSoundtrack(null), { 'data-testid': 'soundtrack-remove' })),
      slider({ label: t('inspector.volume'), value: Math.round((ed.doc.audio.volume ?? 1) * 100), min: 0, max: 100, unit: '%', testid: 'soundtrack-volume', onChange: (v, l) => ed.setSoundtrackVolume(v / 100, l ? 'volume' : null) }));
  }

  /** The page's own motion: an animation for everything on it, how long it shows, and how it comes in. */
  motionPanel() {
    const ed = this.ed;
    const page = ed.pageData;
    const at = ed.page;
    const pa = page.anim || { type: 'none' };
    const tr = page.transition || { type: 'none' };
    const set = (patch, key) => ed.setPageMotion(at, patch, key);
    return section(t('inspector.motion'),
      selectField({ label: t('inspector.animatePage'), value: pa.type, testid: 'page-anim', options: Object.entries(PAGE_ANIMATIONS).map(([value, { name }]) => ({ value, label: animName(value, name) })), onChange: (type) => set({ anim: type === 'none' ? undefined : { ...pa, type, stagger: pa.stagger ?? DEFAULT_STAGGER } }) }),
      slider({ label: t('inspector.showFor'), value: pageDuration(page), min: LIMITS.page[0], max: LIMITS.page[1], step: 0.5, unit: 's', testid: 'page-duration', onChange: (v, l) => set({ duration: v }, l ? `duration:${at}` : null) }),
      selectField({ label: t('inspector.transition'), value: tr.type, testid: 'page-transition', options: Object.entries(TRANSITIONS).map(([value, { name }]) => ({ value, label: transitionName(value, name) })), onChange: (type) => set({ transition: type === 'none' ? undefined : { type, duration: tr.duration ?? DEFAULT_TRANSITION_DURATION } }) }),
      at === 0 && tr.type !== 'none' ? h('p', { class: 'hint' }, t('inspector.transitionHint')) : null,
      this.soundtrackRow(),
      h('button', { type: 'button', class: 'btn small wide', 'data-testid': 'page-play', onClick: () => this.onPlay?.() }, icon('play'), t('inspector.playFrom')));
  }

  multiPanel(sel) {
    const joinable = sel.length === 2 && sel.every((e) => e.type !== 'connector');
    return [
      h('div', { class: 'panel-head' }, h('h2', { 'data-testid': 'selection-title' }, t('inspector.selected', { n: sel.length })), this.actions()),
      joinable ? section(t('inspector.connect'), h('button', { type: 'button', class: 'btn small wide', 'data-testid': 'connect', onClick: () => this.ed.connect() }, icon('connect'), t('inspector.connectLine'))) : null,
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
          for (const el of ed.selected) if (el.type === 'text') {
            el.font = family;
            ed.fitText(el);
          }
        });
        toast(t('inspector.fontAdded', { family }));
      } catch {
        toast(t('inspector.fontBad'), 'error');
      }
    } }, t('inspector.ownFont'));
    const bold = (el.weight || 400) >= 600;
    return [
      // A sticky note: its color.
      el.note ? section(t('inspector.stickyNote'), h('div', { class: 'note-grid', 'data-testid': 'note-colors-edit' }, NOTE_COLORS.map((c, i) => h('button', {
        type: 'button', class: `note-swatch${c === el.note ? ' on' : ''}`, style: { background: c }, 'aria-label': t('inspector.noteColor', { n: i + 1 }), 'aria-pressed': String(c === el.note), 'data-testid': `note-color-${i}`,
        onClick: () => this.up({ note: c }),
      })))) : null,
      section(t('type.text'),
        fontSelect,
        upload,
        h('div', { class: 'row' },
          numberField({ label: t('inspector.fontSize'), short: t('common.size'), value: el.size, min: 1, max: 2000, testid: 'font-size', onChange: (v) => this.up({ size: v }) }),
          h('div', { class: 'field inline' }, h('span', null, t('common.color')), colorButton({ label: t('inspector.textColor'), testid: 'text-color', value: el.color, getContext: this.colorContext, onChange: (c, l) => this.up({ color: c }, l ? 'color' : null) }))),
        h('div', { class: 'segmented', role: 'group', 'aria-label': t('inspector.textStyle') },
          styleBtn('bold', t('inspector.bold'), bold, () => this.up({ weight: bold ? 400 : 700 }), 'text-bold'),
          styleBtn('italic', t('inspector.italic'), el.italic, () => this.up({ italic: !el.italic }), 'text-italic'),
          styleBtn('underline', t('inspector.underline'), el.underline, () => this.up({ underline: !el.underline }), 'text-underline'),
          styleBtn('strike', t('inspector.strike'), el.strike, () => this.up({ strike: !el.strike }), 'text-strike'),
          styleBtn('caps', t('inspector.caps'), el.caps, () => this.up({ caps: !el.caps }), 'text-caps')),
        segmented({ label: t('inspector.alignment'), value: el.align, testid: 'text-align', onChange: (align) => this.up({ align }), options: [
          { value: 'left', label: t('inspector.textLeft'), icon: 'tAlignLeft' },
          { value: 'center', label: t('inspector.textCenter'), icon: 'tAlignCenter' },
          { value: 'right', label: t('inspector.textRight'), icon: 'tAlignRight' },
        ] }),
        segmented({ label: t('inspector.list'), value: el.list, testid: 'text-list', onChange: (list) => this.up({ list: el.list === list ? 'none' : list }), options: [
          { value: 'bullet', label: t('inspector.bullets'), icon: 'listBullet' },
          { value: 'number', label: t('inspector.numbers'), icon: 'listNumber' },
        ] }),
        slider({ label: t('inspector.lineSpacing'), value: el.lineHeight, min: 0.6, max: 3, step: 0.05, testid: 'line-height', onChange: this.live('lineHeight') }),
        slider({ label: t('inspector.letterSpacing'), value: el.letterSpacing, min: -Math.round(el.size * 0.1), max: Math.round(el.size * 0.8), step: 0.5, testid: 'letter-spacing', onChange: this.live('letterSpacing') })),
      aiWritingSection(ed, el),
      section(t('inspector.textEffects'),
        this.textEffects(el),
        toggle({ label: t('inspector.outline'), checked: !!el.outline, testid: 'outline-toggle', onChange: (on) => this.up({ outline: on ? { width: Math.max(1, Math.round(el.size * 0.04)), color: '#ffffff' } : null }) }),
        el.outline ? h('div', { class: 'sub' },
          slider({ label: t('inspector.outlineWidth'), value: el.outline.width, min: 0.5, max: Math.max(4, Math.round(el.size * 0.2)), step: 0.5, onChange: (v, l) => this.up({ outline: { ...el.outline, width: v } }, l ? 'outline' : null) }),
          h('div', { class: 'field inline' }, h('span', null, t('common.color')), colorButton({ label: t('inspector.outlineColor'), value: el.outline.color, getContext: this.colorContext, onChange: (c, l) => this.up({ outline: { ...el.outline, color: c } }, l ? 'outline' : null) }))) : null,
        toggle({ label: t('inspector.bgBox'), checked: !!el.highlight, testid: 'highlight-toggle', onChange: (on) => this.up({ highlight: on ? { color: '#ffe066', padding: Math.round(el.size * 0.15), radius: Math.round(el.size * 0.12) } : null }) }),
        el.highlight ? h('div', { class: 'sub' },
          h('div', { class: 'field inline' }, h('span', null, t('inspector.boxColor')), colorButton({ label: t('inspector.boxColor'), value: el.highlight.color, getContext: this.colorContext, onChange: (c, l) => this.up({ highlight: { ...el.highlight, color: c } }, l ? 'hl' : null) })),
          slider({ label: t('inspector.roundness'), value: el.highlight.radius ?? 0, min: 0, max: Math.round(el.size * 0.6), onChange: (v, l) => this.up({ highlight: { ...el.highlight, radius: v } }, l ? 'hl' : null) })) : null,
        slider({ label: t('inspector.curve'), value: el.curve || 0, min: -100, max: 100, testid: 'curve', onChange: this.live('curve') })),
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
      h('div', { class: 'fx-grid', role: 'group', 'aria-label': t('inspector.textEffect'), 'data-testid': 'text-effects' }, TEXT_EFFECTS.map((type) => h('button', {
        type: 'button', class: `fx${fx.type === type ? ' on' : ''}`, 'aria-pressed': String(fx.type === type), title: effectName(type), 'data-testid': `effect-${type}`,
        // A new effect starts with the colors its preview shows (not the last
        // effect's); the sizes carry over. Updates merge into the effect, so
        // Glitch's second color is cleared explicitly.
        onClick: () => this.up({ effect: type === 'none' ? null : { type, color: ({ splice: '#ffb703', glow: '#ffb703', neon: '#ff2d95' })[type], color2: undefined, offset: fx.offset, thickness: fx.thickness } }),
      }, h('span', { class: 'fx-img', html: preview(type) }), h('small', null, effectName(type))))),
      fx.type !== 'none' ? h('div', { class: 'sub' },
        uses.color ? h('div', { class: 'field inline' },
          h('span', null, fx.type === 'glitch' ? t('inspector.colors') : t('inspector.effectColor')),
          // Show the colors the effect actually draws with.
          colorButton({ label: t('inspector.effectColor'), testid: 'effect-color', value: fx.color || (fx.type === 'glitch' ? '#00e5ff' : el.color), getContext: this.colorContext, onChange: (c, l) => set({ color: c }, l) }),
          fx.type === 'glitch' ? colorButton({ label: t('inspector.effectColor2'), testid: 'effect-color-2', value: fx.color2 || '#ff2d95', getContext: this.colorContext, onChange: (c, l) => set({ color2: c }, l) }) : null) : null,
        uses.offset ? slider({ label: t('inspector.offset'), value: Math.round((fx.offset ?? 0.08) * 100), min: 0, max: 40, testid: 'effect-offset', onChange: (v, l) => set({ offset: v / 100 }, l) }) : null,
        uses.thickness ? slider({ label: t('inspector.thickness'), value: Math.round((fx.thickness ?? 0.035) * 1000), min: 5, max: 120, testid: 'effect-thickness', onChange: (v, l) => set({ thickness: v / 1000 }, l) }) : null) : null);
  }

  shapePanel(el) {
    const isGradient = el.fill && typeof el.fill === 'object';
    const fill = isGradient ? el.fill : null;
    const solid = isGradient ? fill.stops[0].color : el.fill;
    return [
      section(t('type.shape'),
        selectField({ label: t('type.shape'), value: el.shape, testid: 'shape-select', options: SHAPES.map((s) => ({ value: s, label: shapeName(s) })), onChange: (shape) => this.up({ shape }) }),
        segmented({ label: t('inspector.fillType'), value: isGradient ? 'gradient' : 'solid', testid: 'fill-type', onChange: (kind) => {
          if (kind === 'gradient' && !isGradient) this.up({ fill: { type: 'linear', angle: 135, stops: [{ offset: 0, color: solid || '#6c5ce7' }, { offset: 1, color: '#ffd166' }] } });
          if (kind === 'solid' && isGradient) this.up({ fill: solid });
        }, options: [{ value: 'solid', label: t('inspector.solid'), text: t('inspector.solid') }, { value: 'gradient', label: t('inspector.gradient'), text: t('inspector.gradient') }] }),
        isGradient
          ? h('div', { class: 'sub' }, gradientEditor({ label: t('inspector.fillGradient'), value: fill, getContext: this.colorContext, testid: 'fill-gradient', current: () => this.ed.single?.fill?.stops && this.ed.single.fill, onChange: (g, l) => this.up({ fill: g }, l ? 'grad' : null) }))
          : h('div', { class: 'field inline' }, h('span', null, t('inspector.fill')), colorButton({ label: t('inspector.fillColor'), testid: 'fill-color', value: el.fill, getContext: this.colorContext, onChange: (c, l) => this.up({ fill: c }, l ? 'fill' : null) })),
        el.shape === 'rect' ? slider({ label: t('inspector.cornerRounding'), value: el.radius || 0, min: 0, max: Math.round(Math.min(el.w, el.h) / 2), testid: 'corner-radius', onChange: this.live('radius') }) : null,
        el.shape === 'polygon' || el.shape === 'star' ? slider({ label: el.shape === 'star' ? t('inspector.points') : t('inspector.sides'), value: el.sides, min: 3, max: el.shape === 'star' ? 24 : 12, testid: 'sides', onChange: this.live('sides') }) : null,
        el.shape === 'star' ? slider({ label: t('inspector.pointDepth'), value: Math.round((1 - el.innerRatio) * 100), min: 5, max: 90, unit: '%', onChange: (v, l) => this.up({ innerRatio: 1 - v / 100 }, l ? 'inner' : null) }) : null),
      this.strokeSection(el),
    ];
  }

  strokeSection(el) {
    const max = Math.max(20, Math.round(Math.min(el.w, el.h) / 4));
    return section(t('inspector.border'),
      h('div', { class: 'row' },
        h('div', { class: 'field inline' }, h('span', null, t('common.color')), colorButton({ label: t('inspector.borderColor'), testid: 'stroke-color', value: el.stroke, getContext: this.colorContext, onChange: (c, l) => this.up({ stroke: c, strokeWidth: el.strokeWidth || Math.max(2, Math.round(Math.min(el.w, el.h) * 0.02)) }, l ? 'stroke' : null) })),
        el.stroke ? h('button', { type: 'button', class: 'link-btn', onClick: () => this.up({ stroke: null, strokeWidth: 0 }) }, t('inspector.noBorder')) : null),
      el.stroke ? slider({ label: t('inspector.borderWidth'), value: el.strokeWidth || 0, min: 0, max, testid: 'stroke-width', onChange: this.live('strokeWidth') }) : null,
      el.stroke ? segmented({ label: t('inspector.borderStyle'), value: el.dash || 'solid', testid: 'stroke-dash', onChange: (dash) => this.up({ dash }), options: [
        { value: 'solid', label: t('inspector.solidLine'), text: '———' },
        { value: 'dashed', label: t('line.dashed'), text: '– – –' },
        { value: 'dotted', label: t('line.dotted'), text: '• • •' },
      ] }) : null);
  }

  linePanel(el) {
    return [section(t('type.line'),
      h('div', { class: 'field inline' }, h('span', null, t('common.color')), colorButton({ label: t('inspector.lineColor'), testid: 'line-color', value: el.stroke, getContext: this.colorContext, onChange: (c, l) => this.up({ stroke: c }, l ? 'stroke' : null) })),
      slider({ label: t('inspector.thickness'), value: el.strokeWidth, min: 1, max: 80, testid: 'line-width', onChange: (v, l) => this.up(el.type === 'connector' ? { strokeWidth: v } : { strokeWidth: v, h: Math.max(el.h, v * 6) }, l ? 'sw' : null) }),
      segmented({ label: t('inspector.lineStyle'), value: el.dash || 'solid', onChange: (dash) => this.up({ dash }), options: [
        { value: 'solid', label: t('inspector.solidLine'), text: '———' },
        { value: 'dashed', label: t('line.dashed'), text: '– – –' },
        { value: 'dotted', label: t('line.dotted'), text: '• • •' },
      ] }),
      h('div', { class: 'row' },
        toggle({ label: t('inspector.arrowStart'), checked: el.startCap === 'arrow', testid: 'arrow-start', onChange: (on) => this.up({ startCap: on ? 'arrow' : 'none' }) }),
        toggle({ label: t('inspector.arrowEnd'), checked: el.endCap === 'arrow', testid: 'arrow-end', onChange: (on) => this.up({ endCap: on ? 'arrow' : 'none' }) })))];
  }

  /** Where a video starts and whether it loops; its shape, like a picture's. */
  videoPanel(el) {
    const asset = this.ed.doc.assets[el.assetId];
    const length = asset?.duration || 0;
    return [section(t('type.video'),
      h('p', { class: 'hint' }, `${length ? `${t('inspector.seconds', { n: Math.round(length * 10) / 10 })} ` : ''}${t('inspector.videoHint')}`),
      length > 0.5 ? slider({ label: t('inspector.startAt'), value: el.trim?.start || 0, min: 0, max: Math.floor((length - 0.5) * 10) / 10, step: 0.1, unit: 's', testid: 'video-start', onChange: (v, l) => this.up({ trim: { start: v } }, l ? 'trim' : null) }) : null,
      toggle({ label: t('inspector.loop'), checked: el.loop !== false, testid: 'video-loop', onChange: (on) => this.up({ loop: on }) }),
      selectField({ label: t('inspector.frameShape'), value: el.mask || 'none', testid: 'video-mask', options: FRAME_MASKS.map((m) => ({ value: m, label: maskName(m) })), onChange: (mask) => this.up({ mask }) }),
      !el.mask || el.mask === 'none' ? slider({ label: t('inspector.cornerRounding'), value: el.radius || 0, min: 0, max: Math.round(Math.min(el.w, el.h) / 2), onChange: this.live('radius') }) : null)];
  }

  imagePanel(el) {
    const ed = this.ed;
    const shape = section(t('type.shape'),
      selectField({ label: t('inspector.frameShape'), value: el.mask || 'none', testid: 'image-mask', options: FRAME_MASKS.map((m) => ({ value: m, label: maskName(m) })), onChange: (mask) => this.up({ mask }) }),
      !el.mask || el.mask === 'none'
        ? slider({ label: t('inspector.cornerRounding'), value: el.radius || 0, min: 0, max: Math.round(Math.min(el.w, el.h) / 2), testid: 'image-radius', onChange: this.live('radius') })
        : null);
    if (isEmptyFrame(ed.doc, el)) {
      return [
        section(t('inspector.frame'),
          h('p', { class: 'hint' }, t('inspector.frameHint')),
          h('button', { type: 'button', class: 'btn small wide primary', 'data-testid': 'frame-add-photo', onClick: () => this.canvas.pickPhotoFor(el, { evenLocked: true }) }, icon('image'), t('inspector.addPhoto'))),
        shape,
      ];
    }
    const f = { ...DEFAULT_FILTERS, ...el.filters };
    const asset = ed.doc.assets[el.assetId];
    const cropping = ed.cropId === el.id;
    const filt = (k) => (v, l) => this.up({ filters: { [k]: v } }, l ? `f-${k}` : null);
    const presetName = Object.entries(FILTER_PRESETS).find(([, p]) => Object.keys(p).every((k) => p[k] === f[k]))?.[0];
    return [
      section(t('type.image'),
        h('div', { class: 'btn-grid two' },
          h('button', { type: 'button', class: `btn small${cropping ? ' on' : ''}`, 'data-testid': 'crop-btn', onClick: () => {
            if (cropping) {
              ed.cropId = null;
              ed.emit('selection');
            } else this.canvas.startCrop(el);
          } }, icon('crop'), cropping ? t('inspector.doneCrop') : t('inspector.crop')),
          h('button', { type: 'button', class: 'btn small', 'data-testid': 'replace-image', onClick: () => this.canvas.pickPhotoFor(el, { evenLocked: true }) }, icon('image'), t('inspector.replace'))),
        cropping && asset ? h('div', { class: 'sub' },
          h('p', { class: 'hint' }, t('inspector.cropHint')),
          slider({ label: t('inspector.zoom'), value: Math.round(cropZoom(el, asset.width, asset.height) * 100), min: 100, max: 400, unit: '%', testid: 'crop-zoom', onChange: (v, l) => {
            ed.change(() => this.canvas.setCropZoom(el, v / 100), { key: l ? `cropzoom:${el.id}` : null });
          } })) : null,
        h('button', { type: 'button', class: 'btn small wide', 'data-testid': 'remove-bg', onClick: async (e) => {
          const btn = e.currentTarget;
          btn.disabled = true;
          try {
            const share = await ed.removeBackground();
            toast(share > 0.01 ? t('inspector.bgRemoved') : t('inspector.noPlainBg'));
          } catch {
            toast(t('inspector.imageBad'), 'error');
          } finally {
            btn.disabled = false;
          }
        } }, icon('crop'), t('inspector.removePlainBg')),
        // Busy photos: a model on this device (asks once to download it).
        h('button', { type: 'button', class: 'btn small wide', 'data-testid': 'remove-bg-smart', onClick: () => smartRemoveBackground(ed) }, icon('paint'), t('inspector.removeBgSmart')),
        cutoutOf(el.assetId) ? slider({ label: t('inspector.refine'), value: Math.round(cutoutOf(el.assetId).refine * 100), min: 0, max: 100, testid: 'cutout-refine', onChange: (v, l) => {
          if (!l) refineCutout(ed, el, v / 100);
        } }) : null,
        h('button', { type: 'button', class: 'btn small wide', 'data-testid': 'image-to-bg', onClick: () => ed.setImageAsBackground() }, icon('background'), t('inspector.useAsBg'))),
      asset?.credit ? creditSection(asset.credit) : null,
      section(t('inspector.adjust'),
        segmented({ label: t('inspector.filter'), value: presetName, testid: 'filter-presets', onChange: (name) => this.up({ filters: { ...FILTER_PRESETS[name] } }), options: [
          { value: 'original', label: t('filter.original'), text: t('filter.original') },
          { value: 'bw', label: t('filter.bw'), text: t('filter.bwShort') },
          { value: 'sepia', label: t('filter.sepia'), text: t('filter.sepia') },
          { value: 'vivid', label: t('filter.vivid'), text: t('filter.vivid') },
          { value: 'fade', label: t('filter.fade'), text: t('filter.fade') },
        ] }),
        slider({ label: t('inspector.brightness'), value: f.brightness, min: 0, max: 200, testid: 'brightness', onChange: filt('brightness') }),
        slider({ label: t('inspector.contrast'), value: f.contrast, min: 0, max: 200, testid: 'contrast', onChange: filt('contrast') }),
        slider({ label: t('inspector.saturation'), value: f.saturation, min: 0, max: 200, testid: 'saturation', onChange: filt('saturation') }),
        slider({ label: t('inspector.blur'), value: f.blur, min: 0, max: 40, testid: 'blur', onChange: filt('blur') }),
        slider({ label: t('inspector.warmth'), value: f.warmth, min: -100, max: 100, testid: 'warmth', onChange: filt('warmth') }),
        slider({ label: t('inspector.tint'), value: f.tint, min: -100, max: 100, testid: 'tint', onChange: filt('tint') }),
        slider({ label: t('inspector.hue'), value: f.hue, min: 0, max: 360, unit: '°', testid: 'hue', onChange: filt('hue') }),
        slider({ label: t('inspector.vignette'), value: f.vignette, min: 0, max: 100, testid: 'vignette', onChange: filt('vignette') })),
      section(t('inspector.duotone'),
        h('div', { class: 'duo-grid', role: 'group', 'aria-label': t('inspector.duotone'), 'data-testid': 'duotone' },
          h('button', { type: 'button', class: `duo${f.duotone ? '' : ' on'}`, 'data-testid': 'duotone-none', onClick: () => this.up({ filters: { duotone: null } }) }, t('common.none')),
          DUOTONES.map(([name, dark, light]) => h('button', { type: 'button', class: `duo${f.duotone?.dark === dark && f.duotone?.light === light ? ' on' : ''}`, title: duotoneName(name), 'aria-label': t('inspector.duotoneNamed', { name: duotoneName(name) }), 'data-testid': `duotone-${name}`, style: { background: `linear-gradient(135deg, ${dark} 50%, ${light} 50%)` }, onClick: () => this.up({ filters: { duotone: { dark, light } } }) }))),
        f.duotone ? h('div', { class: 'field inline' },
          h('span', null, t('inspector.shadows')), colorButton({ label: t('inspector.duoShadows'), value: f.duotone.dark, getContext: this.colorContext, onChange: (c, l) => this.up({ filters: { duotone: { ...this.duotoneNow(f), dark: c } } }, l ? 'duo' : null) }),
          h('span', null, t('inspector.highlights')), colorButton({ label: t('inspector.duoHighlights'), value: f.duotone.light, getContext: this.colorContext, onChange: (c, l) => this.up({ filters: { duotone: { ...this.duotoneNow(f), light: c } } }, l ? 'duo' : null) })) : null),
      shape,
    ];
  }

  chartPanel(el) {
    const data = h('textarea', { rows: '6', 'data-testid': 'chart-data', 'aria-label': t('inspector.chartData'), spellcheck: 'false' });
    data.value = chartDataText(el.data);
    data.addEventListener('input', () => {
      const parsed = parseChartData(data.value);
      if (parsed.length) this.up({ data: parsed }, 'chart-data');
    });
    return [section(t('type.chart'),
      segmented({ label: t('inspector.chartType'), value: el.chartType, testid: 'chart-type', onChange: (chartType) => this.up({ chartType }), options: [
        { value: 'bar', label: t('chart.bars'), text: t('chart.bars') },
        { value: 'line', label: t('chart.line'), text: t('chart.line') },
        { value: 'pie', label: t('chart.pie'), text: t('chart.pie') },
        { value: 'donut', label: t('chart.donut'), text: t('chart.donut') },
      ] }),
      h('label', { class: 'field' }, h('span', null, t('inspector.chartDataLabel')), data),
      selectField({ label: t('inspector.colors'), value: '', testid: 'chart-palette', options: [{ value: '', label: t('inspector.pickPalette') }, { value: 'brand', label: t('common.brandKit') }, ...PALETTES.map((p) => ({ value: p.name, label: paletteName(p.name) }))], onChange: (name) => {
        const colors = name === 'brand' ? this.brand.colors : PALETTES.find((p) => p.name === name)?.colors;
        if (colors?.length) this.up({ colors: [...colors] });
      } }),
      h('div', { class: 'row' },
        h('div', { class: 'field inline' }, h('span', null, t('inspector.firstColor')), colorButton({ label: t('inspector.chartColor'), testid: 'chart-color', value: el.colors[0], getContext: this.colorContext, onChange: (c, l) => this.up({ colors: [c, ...el.colors.slice(1)] }, l ? 'cc' : null) })),
        h('div', { class: 'field inline' }, h('span', null, t('inspector.labels')), colorButton({ label: t('inspector.labelColor'), value: el.textColor, getContext: this.colorContext, onChange: (c, l) => this.up({ textColor: c }, l ? 'tc' : null) }))),
      fontPicker({ value: el.font, fonts: FONTS, kinds: FONT_KINDS, onChange: (font) => this.setFont(font) }),
      toggle({ label: el.chartType === 'pie' || el.chartType === 'donut' ? t('inspector.showPercent') : t('inspector.showValues'), checked: el.showValues, testid: 'chart-values', onChange: (showValues) => this.up({ showValues }) }))];
  }

  tablePanel(el) {
    const cells = h('textarea', { rows: '6', 'data-testid': 'table-data', 'aria-label': t('inspector.tableData'), spellcheck: 'false' });
    cells.value = tableText(el.rows);
    cells.addEventListener('input', () => {
      const rows = parseTable(cells.value);
      if (!rows.length) return;
      const rh = el.h / el.rows.length;
      this.up({ rows, h: Math.max(rh, rh * rows.length) }, 'table-data');
    });
    return [section(t('type.table'),
      h('label', { class: 'field' }, h('span', null, t('inspector.tableDataLabel')), cells),
      h('div', { class: 'row' },
        toggle({ label: t('inspector.headerRow'), checked: el.header, testid: 'table-header', onChange: (header) => this.up({ header }) }),
        toggle({ label: t('inspector.stripes'), checked: el.stripes, testid: 'table-stripes', onChange: (stripes) => this.up({ stripes }) })),
      h('div', { class: 'row' },
        numberField({ label: t('inspector.textSize'), short: t('common.size'), value: el.size, min: 4, max: 400, testid: 'table-size', onChange: (size) => this.up({ size }) }),
        segmented({ label: t('inspector.cellAlign'), value: el.align, onChange: (align) => this.up({ align }), options: [
          { value: 'left', label: t('inspector.alignLeft'), icon: 'tAlignLeft' },
          { value: 'center', label: t('inspector.center'), icon: 'tAlignCenter' },
          { value: 'right', label: t('inspector.alignRight'), icon: 'tAlignRight' },
        ] })),
      fontPicker({ value: el.font, fonts: FONTS, kinds: FONT_KINDS, onChange: (font) => this.setFont(font) }),
      h('div', { class: 'row' },
        h('div', { class: 'field inline' }, h('span', null, t('inspector.header')), colorButton({ label: t('inspector.headerColor'), testid: 'table-header-fill', value: el.headerFill, getContext: this.colorContext, onChange: (c, l) => this.up({ headerFill: c }, l ? 'hf' : null) })),
        h('div', { class: 'field inline' }, h('span', null, t('type.text')), colorButton({ label: t('inspector.tableTextColor'), value: el.color, getContext: this.colorContext, onChange: (c, l) => this.up({ color: c }, l ? 'tc' : null) })),
        h('div', { class: 'field inline' }, h('span', null, t('inspector.stripes')), colorButton({ label: t('inspector.stripeColor'), value: el.stripeFill, getContext: this.colorContext, onChange: (c, l) => this.up({ stripeFill: c }, l ? 'sf' : null) }))))];
  }

  qrPanel(el) {
    const input = h('textarea', { rows: '3', 'data-testid': 'qr-data', 'aria-label': t('inspector.qrData'), maxlength: '200' });
    input.value = el.data;
    input.addEventListener('input', () => this.up({ data: input.value || ' ' }, 'qr'));
    return [section(t('type.qr'),
      h('label', { class: 'field' }, h('span', null, t('common.linkOrText')), input),
      h('div', { class: 'row' },
        h('div', { class: 'field inline' }, h('span', null, t('inspector.dots')), colorButton({ label: t('inspector.qrColor'), value: el.fg, getContext: this.colorContext, onChange: (c, l) => this.up({ fg: c }, l ? 'fg' : null) })),
        h('div', { class: 'field inline' }, h('span', null, t('inspector.background')), colorButton({ label: t('inspector.qrBg'), value: el.bg, getContext: this.colorContext, onChange: (c, l) => this.up({ bg: c }, l ? 'bg' : null) }))),
      h('p', { class: 'hint' }, t('inspector.qrHint')))];
  }

  pagePanel() {
    const ed = this.ed;
    const doc = ed.doc;
    const bg = ed.pageData.background || { type: 'color', color: '#ffffff' };
    const unit = doc.unit || 'px';
    const size = unit === 'px' ? `${formatNumber(doc.width)} × ${formatNumber(doc.height)} px` : `${formatNumber(fromPx(doc.width, unit))} × ${formatNumber(fromPx(doc.height, unit))} ${unit}`;
    const grad = bg.type === 'gradient' ? bg.gradient : null;
    const notesAt = ed.page; // (the page this panel was made for)
    return [
      h('div', { class: 'panel-head' }, h('h2', { 'data-testid': 'selection-title' }, t('inspector.pageOf', { n: ed.page + 1, total: doc.pages.length }))),
      section(t('inspector.page'),
        (() => {
          const input = h('input', { type: 'text', value: ed.pageData.title || '', maxlength: '120', placeholder: t('inspector.addPageTitle'), 'aria-label': t('inspector.pageTitle'), 'data-testid': 'page-title' });
          // Saved as it's typed (one undo step): the panel can be redrawn
          // before the field would report a change.
          const at = ed.page;
          input.addEventListener('input', () => ed.setPageTitle(at, input.value));
          input.addEventListener('keydown', (e) => e.key === 'Enter' && input.blur());
          return h('label', { class: 'field' }, h('span', null, t('inspector.title')), input);
        })(),
        toggle({ label: t('inspector.hidePage'), checked: !!ed.pageData.hidden, testid: 'page-hidden', onChange: (on) => ed.setPageHidden(ed.page, on) })),
      section(t('inspector.background'),
        segmented({ label: t('inspector.bgType'), value: bg.type, testid: 'bg-type', onChange: (kind) => {
          if (kind === 'color') ed.setBackground({ type: 'color', color: bg.color || grad?.stops[0].color || '#ffffff' });
          if (kind === 'gradient') ed.setBackground({ type: 'gradient', gradient: { type: 'linear', angle: 160, stops: [{ offset: 0, color: bg.color && bg.color !== '#ffffff' ? bg.color : '#ffd1dc' }, { offset: 1, color: '#a0c4ff' }] } });
          if (kind === 'image') toast(t('inspector.bgImageHint'));
        }, options: [{ value: 'color', label: t('common.color'), text: t('common.color') }, { value: 'gradient', label: t('inspector.gradient'), text: t('inspector.gradient') }, { value: 'image', label: t('type.image'), text: t('type.image') }] }),
        bg.type === 'color' ? h('div', { class: 'field inline' }, h('span', null, t('common.color')), colorButton({ label: t('inspector.bgColor'), testid: 'bg-color', value: bg.color, getContext: this.colorContext, onChange: (c, l) => ed.setBackground({ type: 'color', color: c }, l ? 'color' : null) })) : null,
        grad ? h('div', { class: 'sub' }, gradientEditor({ label: t('inspector.bgGradient'), value: grad, getContext: this.colorContext, testid: 'bg-gradient', current: () => ed.pageData.background?.gradient, onChange: (g, l) => ed.setBackground({ type: 'gradient', gradient: g }, l ? 'grad' : null) })) : null,
        bg.type === 'image' ? h('button', { type: 'button', class: 'btn small wide', onClick: () => ed.setBackground({ type: 'color', color: '#ffffff' }) }, t('inspector.removeBgImage')) : null),
      this.motionPanel(),
      section(t('inspector.notes'),
        h('textarea', { rows: '4', class: 'notes', 'data-testid': 'page-notes', 'aria-label': t('inspector.notesLabel'), placeholder: t('inspector.notesPlaceholder'), maxlength: '10000',
          onInput: (e) => ed.setPageNotes(notesAt, e.target.value, `notes:${notesAt}`) }, ed.pageData.notes || '')),
      section(t('inspector.design'),
        h('p', { class: 'meta', 'data-testid': 'design-size' }, size),
        h('button', { type: 'button', class: 'btn wide', 'data-testid': 'resize-design', onClick: () => this.onResizeDesign() }, icon('resize'), t('inspector.resize'))),
      section(t('inspector.page'),
        h('div', { class: 'btn-grid three' },
          h('button', { type: 'button', class: 'btn small', 'data-testid': 'page-add', onClick: () => ed.addPage() }, icon('plus'), t('common.add')),
          h('button', { type: 'button', class: 'btn small', 'data-testid': 'page-duplicate', onClick: () => ed.duplicatePage() }, icon('dup'), t('common.duplicate')),
          h('button', { type: 'button', class: 'btn small', 'data-testid': 'page-delete', onClick: () => ed.deletePage() }, icon('trash'), t('common.delete')))),
    ];
  }

  layers() {
    const ed = this.ed;
    const els = [...ed.pageData.elements].reverse();
    if (!els.length) return h('p', { class: 'empty-note' }, t('layers.empty'));
    const list = h('ol', { class: 'layers', 'data-testid': 'layers' });
    els.forEach((el, i) => {
      const index = ed.pageData.elements.length - 1 - i;
      const thumb = h('span', { class: 'layer-thumb', html: renderElementOnly(ed.doc, el.type === 'text' ? { ...el } : el, { measure, idPrefix: `ly${i}` }) });
      const name = layerName(el);
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
      iconButton(el.hidden ? 'eyeOff' : 'eye', el.hidden ? t('layers.show') : t('layers.hide'), (e) => {
        e.stopPropagation();
        ed.toggleHidden(el.id);
      }, { 'data-testid': 'layer-visibility' }),
      iconButton('up', t('layers.up'), (e) => {
        e.stopPropagation();
        ed.moveLayer(el.id, index + 1);
      }, { 'data-testid': 'layer-up', disabled: i === 0 }),
      iconButton('down', t('layers.down'), (e) => {
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
    return h('div', null, h('p', { class: 'hint' }, t('layers.hint')), list);
  }
}

/** What an element is called in the panel's title. */
function elementName(el) {
  if (el.type === 'shape') return shapeName(el.shape);
  if (el.type === 'icon') return iconById(el.iconId)?.name || typeName('icon');
  if (el.type === 'sticker') return stickerById(el.stickerId)?.name || typeName('sticker');
  return typeName(el.type);
}

/** A layer's name: a text's first words, else what it is. */
function layerName(el) {
  if (el.type === 'text') return el.text.split('\n')[0].slice(0, 40) || typeName('text');
  if (el.type === 'icon') return iconById(el.iconId)?.name || typeName('icon');
  return el.type === 'shape' ? shapeName(el.shape) : typeName(el.type);
}

function styleBtn(name, label, on, onClick, testid) {
  return h('button', { type: 'button', class: on ? 'on' : '', title: label, 'aria-label': label, 'aria-pressed': String(!!on), 'data-testid': testid, onClick }, icon(name));
}

/** The t('inspector.resize') dialog. */
export function resizeDialog(editor) {
  const doc = editor.doc;
  let unit = 'px';
  const wIn = h('input', { type: 'number', min: '1', value: doc.width, 'aria-label': t('resize.width'), 'data-testid': 'resize-w' });
  // (A document's height is its sheet's, not the long page it has grown to.)
  const hIn = h('input', { type: 'number', min: '1', value: doc.document?.pageHeight || doc.height, 'aria-label': t('resize.height'), 'data-testid': 'resize-h' });
  const unitSel = h('select', { 'aria-label': t('common.units') }, ['px', 'mm', 'in'].map((u) => h('option', { value: u }, u)));
  unitSel.addEventListener('change', () => {
    const w = toPx(+wIn.value, unit);
    const hh = toPx(+hIn.value, unit);
    unit = unitSel.value;
    wIn.value = fromPx(w, unit);
    hIn.value = fromPx(hh, unit);
  });
  const go = async (w, hh, name, preset = null) => {
    d.close();
    await editor.resizeTo(w, hh, name, preset);
    toast(t('resize.done'));
  };
  const presets = h('div', { class: 'preset-grid' }, PRESETS.map((p) => h('button', { type: 'button', class: 'preset', 'data-testid': `resize-preset-${p.id}`, onClick: () => go(p.w, p.h, `${doc.name} (${presetName(p)})`, p) },
    h('span', { class: 'preset-shape', style: { aspectRatio: `${p.w} / ${p.h}` } }), h('b', null, presetName(p)), h('small', null, `${formatNumber(p.w)} × ${formatNumber(p.h)}`))));
  const custom = h('form', { class: 'custom-size', onSubmit: (e) => {
    e.preventDefault();
    const w = toPx(+wIn.value, unit);
    const hh = toPx(+hIn.value, unit);
    if (!(w > 0 && hh > 0) || w > 20000 || hh > 20000) return toast(t('resize.error'), 'error');
    go(w, hh);
  } }, wIn, h('span', null, '×'), hIn, unitSel, h('button', { type: 'submit', class: 'btn primary', 'data-testid': 'resize-go' }, t('resize.go')));
  const d = dialog(t('inspector.resize'), h('div', null,
    h('p', { class: 'hint' }, t('resize.hint')),
    presets, h('h3', null, t('common.customSize')), custom), { wide: true, testid: 'resize-dialog' });
  return d;
}
