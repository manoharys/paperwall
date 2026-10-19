// Form controls used by the panels: color picker, sliders, number fields.

import { h, icon, iconButton } from './ui.js';

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

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function normalizeHex(v) {
  const m = String(v).trim().match(HEX);
  if (!m) return null;
  let hex = m[1].toLowerCase();
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  return `#${hex}`;
}

let openPopover = null;

export function closePopover() {
  openPopover?.remove();
  openPopover = null;
}

document.addEventListener('pointerdown', (e) => {
  if (openPopover && !openPopover.contains(e.target) && !e.target.closest?.('.swatch-btn')) closePopover();
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
    document.body.append(pop);
    const r = btn.getBoundingClientRect();
    const top = Math.min(window.innerHeight - pop.offsetHeight - 8, r.bottom + 6);
    const left = Math.min(window.innerWidth - pop.offsetWidth - 8, Math.max(8, r.left - pop.offsetWidth + r.width));
    Object.assign(pop.style, { top: `${Math.max(8, top)}px`, left: `${left}px` });
    openPopover = pop;
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
