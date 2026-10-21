// Form controls used by the panels: color picker, sliders, number fields.

import { h, icon, iconButton } from './ui.js';
import { mixHex, sortedStops, normalizeHex } from '../model/color.js';

export const PALETTES = [
  { name: 'Ink', colors: ['#16161d', '#3d3d4e', '#8a8a9e', '#d9d9e3', '#ffffff'] },
  { name: 'Ember', colors: ['#f25c2a', '#ff9f43', '#ffd166', '#2b2d42', '#fef9f2'] },
  { name: 'Lagoon', colors: ['#0a9396', '#94d2bd', '#e9d8a6', '#005f73', '#001219'] },
  { name: 'Candy', colors: ['#ff70a6', '#ff9770', '#ffd670', '#e9ff70', '#70d6ff'] },
  { name: 'Forest', colors: ['#283618', '#606c38', '#dda15e', '#bc6c25', '#fefae0'] },
  { name: 'Night', colors: ['#03045e', '#0077b6', '#00b4d8', '#90e0ef', '#caf0f8'] },
  { name: 'Berry', colors: ['#590d22', '#a4133c', '#ff4d6d', '#ffb3c1', '#fff0f3'] },
  { name: 'Mono pop', colors: ['#000000', '#ffffff', '#ffe600', '#ff2e63', '#08d9d6'] },
];

let openPopover = null;

export function closePopover() {
  if (!openPopover) return;
  openPopover.cleanup?.();
  openPopover.remove();
  openPopover = null;
  document.dispatchEvent(new Event('paperwall:popover-closed'));
}

/**
 * Show a popover under the button that opened it, kept on screen. Escape
 * closes it and puts focus back on the button.
 */
function showPopover(pop, btn, { alignRight = false } = {}) {
  pop.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closePopover();
      btn.focus();
    }
  });
  document.body.append(pop);
  const r = btn.getBoundingClientRect();
  const left = alignRight ? r.left - pop.offsetWidth + r.width : r.left;
  Object.assign(pop.style, {
    top: `${Math.max(8, Math.min(window.innerHeight - pop.offsetHeight - 8, r.bottom + 6))}px`,
    left: `${Math.max(8, Math.min(window.innerWidth - pop.offsetWidth - 8, left))}px`,
  });
  openPopover = pop;
}

export function popoverOpen() {
  return !!openPopover;
}

document.addEventListener('pointerdown', (e) => {
  // A popover's own button toggles it on click, so leave those clicks to it.
  if (openPopover && !openPopover.contains(e.target) && !e.target.closest?.('.swatch-btn, .font-btn, .menu-btn')) closePopover();
});

/**
 * A color swatch button. Opening it shows a picker with hex input, this
 * design's colors, brand colors, palettes and an eyedropper.
 * getContext() returns { used: [], brand: [] }.
 */
export function colorButton({ label, value, onChange, getContext = () => ({}), testid }) {
  const btn = h('button', { type: 'button', class: 'swatch-btn', title: label, 'aria-label': label, 'data-testid': testid });
  const paint = (v) => {
    btn.style.setProperty('--swatch', v || 'transparent');
    btn.classList.toggle('empty', !v);
  };
  paint(value);
  btn.addEventListener('click', () => {
    if (openPopover?.dataset.for === label) return closePopover();
    closePopover();
    const ctx = getContext();
    let current = value || '#000000';
    const set = (v, live = false) => {
      const hex = normalizeHex(v);
      if (!hex) return;
      current = hex;
      value = hex;
      paint(hex);
      native.value = hex;
      if (document.activeElement !== hexInput) hexInput.value = hex;
      onChange(hex, live);
    };
    const native = h('input', { type: 'color', value: current, 'aria-label': `${label}: color wheel` });
    native.addEventListener('input', () => set(native.value, true));
    native.addEventListener('change', () => set(native.value));
    const hexInput = h('input', { type: 'text', class: 'hex', value: current, maxlength: '7', spellcheck: 'false', 'aria-label': `${label}: hex code`, 'data-testid': 'hex-input' });
    hexInput.addEventListener('change', () => set(hexInput.value));
    hexInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') set(hexInput.value);
    });
    const row = (title, colors) => colors?.length
      ? h('div', { class: 'swatch-group' }, h('p', null, title), h('div', { class: 'swatches' }, colors.map((c) => h('button', { type: 'button', class: 'swatch', style: { '--swatch': c }, title: c, 'aria-label': c, onClick: () => set(c) }))))
      : null;
    const dropper = 'EyeDropper' in window
      ? iconButton('dropper', 'Pick a color from the screen', async () => {
        try {
          const res = await new window.EyeDropper().open();
          set(res.sRGBHex);
        } catch {
          /* cancelled */
        }
      })
      : null;
    const pop = h('div', { class: 'popover color-pop', 'data-for': label, 'data-testid': 'color-popover' },
      h('div', { class: 'color-top' }, native, hexInput, dropper),
      row('In this design', ctx.used),
      row('Brand kit', ctx.brand),
      PALETTES.map((p) => row(p.name, p.colors)));
    showPopover(pop, btn, { alignRight: true });
  });
  return btn;
}

/** A slider with a number box next to it. onChange(value, live). */
export function slider({ label, value, min, max, step = 1, onChange, unit = '', testid }) {
  const range = h('input', { type: 'range', min, max, step, value, 'aria-label': label, 'data-testid': testid });
  const num = h('input', { type: 'number', min, max, step, value: round(value), 'aria-label': `${label} value` });
  range.addEventListener('input', () => {
    num.value = round(+range.value);
    onChange(+range.value, true);
  });
  range.addEventListener('change', () => onChange(+range.value, false));
  num.addEventListener('change', () => {
    const v = clamp(+num.value, +min, +max);
    range.value = v;
    num.value = round(v);
    onChange(v, false);
  });
  return h('label', { class: 'field slider' }, h('span', null, label), h('div', { class: 'slider-row' }, range, num, unit ? h('small', null, unit) : null));
}

/** A labelled number box. */
export function numberField({ label, value, onChange, step = 1, min, max, testid, short }) {
  const input = h('input', { type: 'number', value: round(value), step, min, max, 'aria-label': label, 'data-testid': testid });
  const commit = () => {
    let v = +input.value;
    if (!Number.isFinite(v)) return;
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    onChange(v);
  };
  input.addEventListener('change', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      commit();
      input.blur();
    }
  });
  return h('label', { class: 'field num' }, h('span', null, short || label), input);
}

export function selectField({ label, value, options, onChange, testid, renderOption }) {
  const sel = h('select', { 'aria-label': label, 'data-testid': testid },
    options.map((o) => {
      const opt = h('option', { value: o.value }, o.label);
      if (o.value === value) opt.selected = true;
      if (renderOption) renderOption(opt, o);
      return opt;
    }));
  sel.addEventListener('change', () => onChange(sel.value));
  return h('label', { class: 'field' }, h('span', null, label), sel);
}

/** Buttons where one (or none) is active, like text alignment. */
export function segmented({ label, value, options, onChange, testid }) {
  return h('div', { class: 'segmented', role: 'group', 'aria-label': label, 'data-testid': testid },
    options.map((o) => h('button', {
      type: 'button',
      class: o.value === value ? 'on' : '',
      title: o.label,
      'aria-label': o.label,
      'aria-pressed': String(o.value === value),
      'data-value': o.value,
      onClick: () => onChange(o.value),
    }, o.icon ? icon(o.icon) : o.text || o.label)));
}

export function toggle({ label, checked, onChange, testid }) {
  const input = h('input', { type: 'checkbox', 'data-testid': testid });
  input.checked = !!checked;
  input.addEventListener('change', () => onChange(input.checked));
  return h('label', { class: 'toggle' }, input, h('span', null, label));
}

export function section(title, ...children) {
  return h('section', { class: 'panel-section' }, title ? h('h3', null, title) : null, ...children);
}

function round(v) {
  return Math.round(v * 100) / 100;
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

/**
 * A font chooser: a button showing the current font, opening a searchable
 * list where every name is drawn in its own font (loaded as it scrolls by).
 */
export function fontPicker({ label = 'Font', value, fonts, kinds, onChange, testid, extra = [] }) {
  const btn = h('button', { type: 'button', class: 'font-btn', 'aria-label': `${label}: ${value}`, 'data-testid': testid, style: { fontFamily: `"${value}"` } }, value, icon('down', 16));
  btn.addEventListener('click', () => {
    if (openPopover?.dataset.for === label) return closePopover();
    closePopover();
    let kind = 'All';
    const list = h('div', { class: 'font-list', role: 'listbox', 'aria-label': label });
    const search = h('input', { type: 'search', placeholder: `Search ${fonts.length + extra.length} fonts`, 'aria-label': 'Search fonts', 'data-testid': 'font-search' });
    const seen = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.style.fontFamily = `"${e.target.dataset.font}"`;
        seen.unobserve(e.target);
      }
    }, { root: list, rootMargin: '200px' });
    const fill = () => {
      list.replaceChildren();
      const q = search.value.trim().toLowerCase();
      const all = [...extra.map((name) => ({ name, kind: 'Yours' })), ...fonts];
      for (const f of all.filter((f) => (kind === 'All' || f.kind === kind) && (!q || f.name.toLowerCase().includes(q)))) {
        const item = h('button', { type: 'button', class: `font-item${f.name === value ? ' on' : ''}`, role: 'option', 'aria-selected': String(f.name === value), 'data-font': f.name, 'data-testid': `font-option-${f.name}`, onClick: () => {
          value = f.name;
          btn.firstChild.textContent = f.name;
          btn.style.fontFamily = `"${f.name}"`;
          closePopover();
          onChange(f.name);
        } }, f.name, h('small', null, f.kind));
        list.append(item);
        seen.observe(item);
      }
      if (!list.children.length) list.append(h('p', { class: 'empty-note' }, 'No fonts match.'));
    };
    search.addEventListener('input', fill);
    const chips = h('div', { class: 'chips small' }, ['All', ...kinds].map((k) => h('button', { type: 'button', class: k === kind ? 'chip on' : 'chip', onClick: (e) => {
      kind = k;
      for (const c of chips.children) c.classList.toggle('on', c === e.currentTarget);
      fill();
    } }, k)));
    const pop = h('div', { class: 'popover font-pop', 'data-for': label, 'data-testid': 'font-popover' }, search, chips, list);
    pop.cleanup = () => seen.disconnect();
    fill();
    showPopover(pop, btn);
    search.focus();
    list.querySelector('.on')?.scrollIntoView({ block: 'center' });
  });
  return h('div', { class: 'field' }, h('span', null, label), btn);
}

/** Ready-made gradients, two to four colors each. */
export const GRADIENT_PRESETS = [
  ['Sunset', '#ff7a45', '#ff4d6d', '#8e44ad'],
  ['Peach', '#ffecd2', '#fcb69f'],
  ['Ocean', '#2193b0', '#6dd5ed'],
  ['Lagoon', '#43cea2', '#185a9d'],
  ['Citrus', '#f9d423', '#ff4e50'],
  ['Berry', '#8e2de2', '#ff0080', '#ffb199'],
  ['Mint', '#d4fc79', '#96e6a1'],
  ['Night', '#0f2027', '#203a43', '#2c5364'],
  ['Candy', '#a18cd1', '#fbc2eb'],
  ['Fire', '#f12711', '#f5af19'],
  ['Rainbow', '#ff5f6d', '#ffc371', '#47e891', '#3a86ff'],
  ['Mono', '#ffffff', '#d9d9d9'],
].map(([name, ...colors]) => ({ name, stops: colors.map((color, i) => ({ offset: i / (colors.length - 1), color })) }));

function cssGradient(g, angle = 90) {
  const stops = sortedStops(g).map((s) => `${s.color} ${Math.round(s.offset * 100)}%`).join(', ');
  return `linear-gradient(${angle}deg, ${stops})`;
}

/**
 * Edit a gradient with any number of colors: each stop has a color and a
 * position; add and remove stops, switch linear/radial, set the angle, or
 * start from a preset. onChange(gradient, isLive).
 */
export function gradientEditor({ label, value, onChange, getContext, testid, current }) {
  const g = value;
  const stops = sortedStops(g);
  // Each change starts from the gradient as it is now (`current()`), not as it
  // was when the panel was drawn: the panel isn't redrawn while a slider is in use.
  const now = () => current?.() || g;
  const nowStops = () => sortedStops(now());
  const emit = (patch, live = false) => onChange({ ...now(), ...patch }, live);
  // Where each row's stop is now: re-sorting moves stops around, and the
  // panel isn't redrawn mid-drag, so rows follow their own stop.
  let order = stops.map((_, i) => i);
  // Stops are kept in order, so the page draws the same gradient as the bar above.
  const setStop = (i, patch, live) => {
    const tagged = nowStops().map((s, k) => ({ s: k === order[i] ? { ...s, ...patch } : s, k }));
    tagged.sort((a, b) => a.s.offset - b.s.offset);
    order = order.map((k) => tagged.findIndex((t) => t.k === k));
    emit({ stops: tagged.map((t) => t.s) }, live);
  };
  const addStop = () => {
    const stops = nowStops();
    // Put the new color in the middle of the widest gap.
    let at = 0;
    for (let i = 1; i < stops.length - 1; i++) if (stops[i + 1].offset - stops[i].offset > stops[at + 1].offset - stops[at].offset) at = i;
    const [a, b] = [stops[at], stops[at + 1]];
    emit({ stops: [...stops.slice(0, at + 1), { offset: Math.round(((a.offset + b.offset) / 2) * 100) / 100, color: mixHex(a.color, b.color, 0.5) }, ...stops.slice(at + 1)] });
  };
  return h('div', { class: 'grad-editor', 'data-testid': testid },
    h('div', { class: 'grad-bar', style: { background: cssGradient(g) } }),
    stops.map((s, i) => h('div', { class: 'grad-stop', 'data-testid': 'grad-stop' },
      colorButton({ label: `${label} color ${i + 1}`, value: s.color, getContext, testid: `grad-color-${i}`, onChange: (c, l) => setStop(i, { color: c }, l) }),
      h('input', { type: 'range', min: 0, max: 100, value: Math.round(s.offset * 100), 'aria-label': `${label} color ${i + 1} position`, 'data-testid': `grad-pos-${i}`, onInput: (e) => setStop(i, { offset: +e.target.value / 100 }, true), onChange: (e) => setStop(i, { offset: +e.target.value / 100 }) }),
      stops.length > 2 ? iconButton('close', `Remove color ${i + 1}`, () => emit({ stops: nowStops().filter((_, k) => k !== order[i]) }), { 'data-testid': `grad-remove-${i}` }) : h('span', { class: 'grad-spacer' }))),
    stops.length < 8 ? h('button', { type: 'button', class: 'link-btn', 'data-testid': 'grad-add', onClick: addStop }, '+ Add a color') : null,
    segmented({ label: 'Gradient style', value: g.type, onChange: (type) => emit({ type }), options: [{ value: 'linear', label: 'Linear', text: 'Linear' }, { value: 'radial', label: 'Radial', text: 'Radial' }] }),
    g.type === 'linear' ? slider({ label: 'Angle', value: g.angle ?? 180, min: 0, max: 360, unit: '°', testid: 'grad-angle', onChange: (v, l) => emit({ angle: v }, l) }) : null,
    h('div', { class: 'grad-presets', role: 'group', 'aria-label': 'Ready-made gradients' }, GRADIENT_PRESETS.map((p) => h('button', {
      type: 'button', class: 'grad-preset', title: p.name, 'aria-label': p.name, 'data-testid': `grad-preset-${p.name}`, style: { background: cssGradient(p, 135) },
      onClick: () => emit({ stops: p.stops.map((s) => ({ ...s })) }),
    }))));
}

/**
 * A small menu that opens under a button, built by `content()` each time it
 * opens. Clicking the button again closes it.
 */
export function menuButton({ iconName, label, testid, content }) {
  const btn = iconButton(iconName, label, () => {
    if (openPopover?.dataset.for === label) return closePopover();
    closePopover();
    const pop = h('div', { class: 'popover menu-pop', 'data-for': label, 'data-testid': `${testid}-menu` }, content());
    showPopover(pop, btn, { alignRight: true });
  }, { 'data-testid': testid, class: 'icon-btn menu-btn' });
  return btn;
}
