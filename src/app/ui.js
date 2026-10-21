// Small DOM helpers and the app's own interface icons.

import { t } from './i18n.js';

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') {
        // Custom properties (--name) only work through setProperty.
        for (const [p, val] of Object.entries(v)) {
          if (p.startsWith('--')) el.style.setProperty(p, val);
          else el.style[p] = val;
        }
      }
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'html') el.innerHTML = v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el) {
  while (el.firstChild) el.firstChild.remove();
  return el;
}

const UI_ICONS = {
  undo: '<path d="M9 7H5V3"/><path d="M5.5 7A8 8 0 1 1 4.6 15"/>',
  redo: '<path d="M15 7h4V3"/><path d="M18.5 7A8 8 0 1 0 19.4 15"/>',
  text: '<path d="M5 6V4.5h14V6M12 4.5v15M9 19.5h6"/>',
  shapes: '<rect x="3.5" y="11" width="9" height="9" rx="1"/><circle cx="16" cy="8" r="4.5"/>',
  graphics: '<path d="M12 3.5l2.4 5 5.4.6-4 3.8 1.1 5.4L12 15.6l-4.9 2.7 1.1-5.4-4-3.8 5.4-.6z"/>',
  uploads: '<path d="M12 15V4M7.5 8.5L12 4l4.5 4.5M4.5 15v4.5h15V15"/>',
  templates: '<rect x="3.5" y="3.5" width="7" height="9" rx="1"/><rect x="13.5" y="3.5" width="7" height="5" rx="1"/><rect x="13.5" y="11.5" width="7" height="9" rx="1"/><rect x="3.5" y="15.5" width="7" height="5" rx="1"/>',
  background: '<rect x="3.5" y="3.5" width="17" height="17" rx="2"/><path d="M3.5 15l5-5 4 4 3-3 5 5"/>',
  layers: '<path d="M12 4l8.5 4.5L12 13 3.5 8.5z"/><path d="M3.5 12.5L12 17l8.5-4.5M3.5 16.5L12 21l8.5-4.5"/>',
  qr: '<rect x="4" y="4" width="6" height="6"/><rect x="14" y="4" width="6" height="6"/><rect x="4" y="14" width="6" height="6"/><path d="M14 14h2v2h-2zM18 18h2v2h-2zM14 18h2M18 14h2"/>',
  brand: '<circle cx="8" cy="9" r="3.5"/><circle cx="16" cy="9" r="3.5"/><circle cx="12" cy="15.5" r="3.5"/>',
  download: '<path d="M12 4v11M7 10.5l5 5 5-5M4.5 19.5h15"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="1.5"/><path d="M15.5 8.5V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v9.5a1 1 0 0 0 1 1h3.5"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  unlock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 6.8-1.2"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  eyeOff: '<path d="M4 4l16 16M10 6c.6-.3 1.3-.5 2-.5 6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.8 3.6M6.5 7.6A16 16 0 0 0 2.5 12s3.5 6.5 9.5 6.5c1.4 0 2.6-.3 3.7-.8"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  alignLeft: '<path d="M4 3.5v17M8 7h11v4H8zM8 13h7v4H8z"/>',
  alignCenter: '<path d="M12 3.5v17M5.5 7h13v4h-13zM8 13h8v4H8z"/>',
  alignRight: '<path d="M20 3.5v17M5 7h11v4H5zM9 13h7v4H9z"/>',
  alignTop: '<path d="M3.5 4h17M7 8h4v11H7zM13 8h4v7h-4z"/>',
  alignMiddle: '<path d="M3.5 12h17M7 5.5h4v13H7zM13 8h4v8h-4z"/>',
  alignBottom: '<path d="M3.5 20h17M7 5h4v11H7zM13 9h4v7h-4z"/>',
  distH: '<path d="M4 4v16M20 4v16M9.5 8h5v8h-5z"/>',
  distV: '<path d="M4 4h16M4 20h16M8 9.5h8v5H8z"/>',
  flipH: '<path d="M12 3.5v17M9 6.5L4 17h5zM15 6.5L20 17h-5z"/>',
  flipV: '<path d="M3.5 12h17M6.5 9L17 4v5zM6.5 15L17 20v-5z"/>',
  front: '<rect x="8" y="8" width="11" height="11" rx="1"/><path d="M5 15.5V5h10.5"/>',
  back: '<rect x="5" y="5" width="11" height="11" rx="1"/><path d="M19 8.5V19H8.5"/>',
  group: '<rect x="3.5" y="3.5" width="17" height="17" rx="2" stroke-dasharray="2 2"/><rect x="7" y="7" width="5" height="5"/><rect x="12" y="12" width="5" height="5"/>',
  ungroup: '<rect x="4" y="4" width="7" height="7"/><rect x="13" y="13" width="7" height="7"/>',
  bold: '<path d="M7 4.5h6a3.8 3.8 0 0 1 0 7.5H7zM7 12h7a4 4 0 0 1 0 8H7z"/>',
  italic: '<path d="M10 4.5h8M6 19.5h8M14.5 4.5l-5 15"/>',
  underline: '<path d="M7 4v7a5 5 0 0 0 10 0V4M5 20h14"/>',
  strike: '<path d="M4 12h16M16.5 7.5c-.5-2-2.3-3-4.5-3-2.6 0-4.5 1.4-4.5 3.4 0 4.3 9 3 9 7.6 0 2.1-2 3.5-4.5 3.5-2.4 0-4.2-1.1-4.8-3.2"/>',
  tAlignLeft: '<path d="M4 6h16M4 10h10M4 14h16M4 18h10"/>',
  tAlignCenter: '<path d="M4 6h16M7 10h10M4 14h16M7 18h10"/>',
  tAlignRight: '<path d="M4 6h16M10 10h10M4 14h16M10 18h10"/>',
  listBullet: '<circle cx="5" cy="7" r="1"/><circle cx="5" cy="12" r="1"/><circle cx="5" cy="17" r="1"/><path d="M9 7h11M9 12h11M9 17h11"/>',
  listNumber: '<path d="M9 7h11M9 12h11M9 17h11M4 5.5l1.5-1V9M3.8 14.5c.3-.9 2.4-.9 2.4.4 0 1-2.4 1.6-2.4 3.1h2.6"/>',
  caps: '<path d="M3 18l4.5-12L12 18M4.6 14h5.8M13 18l3.5-9 3.5 9M14.2 15h4.6"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  present: '<rect x="3.5" y="4.5" width="17" height="11" rx="1"/><path d="M12 15.5V20M8.5 20h7M10.5 8l4 2-4 2z"/>',
  speaker: '<rect x="2.5" y="4.5" width="12" height="9" rx="1"/><path d="M8.5 13.5V18M5.5 18h6M17 7h4.5M17 10.5h4.5M17 14h3"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h1M9.5 10h1M13 10h1M16.5 10h1M7 14h10"/>',
  moon: '<path d="M19.5 14.5A8 8 0 1 1 9.5 4.5a6.3 6.3 0 0 0 10 10z"/>',
  home: '<path d="M4 11l8-6.5 8 6.5M6.5 9.5V19h11V9.5"/>',
  open: '<path d="M3.5 7.5V18.5h17v-9h-9l-2-2z"/>',
  save: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>',
  crop: '<path d="M7 3v14h14M3 7h14v14"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>',
  ruler: '<path d="M3 8h18v8H3z"/><path d="M7 8v3M11 8v4M15 8v3M19 8v4"/>',
  connect: '<rect x="3" y="4" width="6" height="6" rx="1"/><rect x="15" y="14" width="6" height="6" rx="1"/><path d="M9 7h4v10h2"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>',
  play: '<path d="M7 4.5v15l12.5-7.5z"/>',
  music: '<path d="M9 18V6l11-2v12"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
  motion: '<path d="M4 12h3M2.5 8h5M3.5 16h4"/><circle cx="14.5" cy="12" r="5.5"/>',
  history: '<path d="M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4"/><path d="M12 8v4l3 2"/>',
  draw: '<path d="M4 20c2-1 3-4 5-4s2 3 4 3 3-5 7-8"/><path d="M15 4l5 5"/>',
  paint: '<rect x="4" y="3.5" width="14" height="6" rx="1"/><path d="M18 6.5h2v5h-8v3M11 14.5h2v6h-2z"/>',
  pasteStyle: '<rect x="3.5" y="3.5" width="11" height="5" rx="1"/><path d="M14.5 6h2v4h-6.5v2.5M9 12.5h2v5H9z"/><path d="M16 15.5h5M18.5 13v5"/>',
  dropper: '<path d="M14.5 5.5l4 4M17 3.5a2.1 2.1 0 0 1 3 3l-2 2-3-3zM15 7.5l-9 9-1.5 3.5L8 18.5l9-9"/>',
  resize: '<path d="M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7"/>',
  page: '<path d="M6 3.5h8.5l3.5 3.5v13.5H6z"/><path d="M14 3.5V7.5h4"/>',
  up: '<path d="M6 15l6-6 6 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  dup: '<rect x="4" y="4" width="11" height="11" rx="1.5"/><path d="M9 20h10a1 1 0 0 0 1-1V9"/>',
  more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  search: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c-2.6 2.4-3.6 5.3-3.6 8.5s1 6.1 3.6 8.5M12 3.5c2.6 2.4 3.6 5.3 3.6 8.5s-1 6.1-3.6 8.5"/>',
  chart: '<path d="M4 20V4M4 20h16"/><rect x="7" y="11" width="3" height="6"/><rect x="12" y="7" width="3" height="10"/><rect x="17" y="13" width="3" height="4"/>',
};

export function icon(name, size = 20) {
  const span = document.createElement('span');
  span.className = 'ic';
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${UI_ICONS[name] || ''}</svg>`;
  return span;
}

/**
 * Something to press that can also be dragged: a div acting as a button
 * (Firefox never starts a drag from a <button>). Enter and Space press it.
 */
export function pressable(attrs, onPress, ...children) {
  return h('div', {
    role: 'button', tabindex: '0', ...attrs, onClick: onPress,
    onKeydown: (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      onPress(e);
    },
  }, ...children);
}

export function iconButton(name, label, onClick, attrs = {}) {
  return h('button', { type: 'button', class: 'icon-btn', title: label, 'aria-label': label, onClick, ...attrs }, icon(name));
}

export function debounce(fn, ms) {
  let t = null;
  const wrapped = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => {
      t = null;
      fn(...args);
    }, ms);
  };
  wrapped.flush = () => {
    clearTimeout(t);
    t = null;
    return fn();
  };
  /** Run now only if a call is waiting. */
  wrapped.flushPending = () => {
    if (t === null) return Promise.resolve();
    return wrapped.flush();
  };
  return wrapped;
}

// ---------- toasts and dialogs ----------

export function toast(message, kind = 'info') {
  let host = document.getElementById('toasts');
  if (!host) {
    host = h('div', { id: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(host);
  }
  const t = h('div', { class: `toast ${kind}` }, message);
  host.append(t);
  setTimeout(() => t.classList.add('out'), 2600);
  setTimeout(() => t.remove(), 3000);
}

/**
 * A modal dialog. Returns { el, close }. `steady()`: while it says so, a
 * click beside the dialog doesn't close it (Close and Escape still do).
 */
export function dialog(title, body, { onClose, wide = false, testid, steady = null } = {}) {
  const backdrop = h('div', { class: 'backdrop' });
  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey, true);
    onClose?.();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  const box = h('div', { class: `dialog${wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title, 'data-testid': testid },
    h('header', null, h('h2', null, title), iconButton('close', t('common.close'), close)),
    h('div', { class: 'dialog-body' }, body));
  backdrop.append(box);
  backdrop.addEventListener('pointerdown', (e) => {
    if (e.target === backdrop && !steady?.()) close();
  });
  document.addEventListener('keydown', onKey, true);
  document.body.append(backdrop);
  const first = box.querySelector('input, select, button:not(.icon-btn)');
  first?.focus();
  return { el: box, close };
}

// ---------- files and data ----------

export function dataUrlToBytes(dataUrl) {
  const comma = dataUrl.indexOf(',');
  const meta = dataUrl.slice(5, comma);
  const data = dataUrl.slice(comma + 1);
  if (meta.endsWith(';base64')) {
    // The browser's own decoder where it has one (much quicker for videos).
    if (typeof Uint8Array.fromBase64 === 'function') return { bytes: Uint8Array.fromBase64(data), mime: meta.slice(0, -7) };
    const bin = atob(data);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return { bytes: out, mime: meta.slice(0, -7) };
  }
  return { bytes: new TextEncoder().encode(decodeURIComponent(data)), mime: meta };
}

export function dataUrlToBlob(dataUrl) {
  const { bytes, mime } = dataUrlToBytes(dataUrl);
  return new Blob([bytes], { type: mime || 'application/octet-stream' });
}

export function bytesToBase64(bytes) {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return btoa(bin);
}

export function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(t('error.imageOpen')));
    img.src = src;
  });
}

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename, style: { display: 'none' } });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export function safeFilename(name) {
  return (name || 'design').replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'design';
}

export function pickFile(accept, multiple = false) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, multiple, style: { display: 'none' } });
    input.addEventListener('change', () => {
      resolve([...input.files]);
      input.remove();
    });
    document.body.append(input);
    input.click();
  });
}

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const mod = isMac ? '⌘' : 'Ctrl';

// ---------- lazy loading ----------

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

/** Stop waiting on root and everything inside it, before it is thrown away. */
export function forget(root) {
  if (!observer) return;
  for (const el of [root, ...root.querySelectorAll('[data-lazy]')]) {
    observer.unobserve(el);
    pending.delete(el);
  }
}
