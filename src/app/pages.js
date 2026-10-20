// The strip of pages along the bottom, and presenting pages full screen.

import { h, icon, iconButton, clear, debounce } from './ui.js';
import { renderPage } from '../model/render.js';
import { measure } from './fonts.js';

export class PageStrip {
  constructor(editor, canvas) {
    this.ed = editor;
    this.canvas = canvas;
    this.list = h('ol', { class: 'page-list', 'data-testid': 'page-strip' });
    this.zoomLabel = h('button', { type: 'button', class: 'zoom-label', title: 'Zoom to fit', 'data-testid': 'zoom-label', onClick: () => canvas.zoomToFit() }, '100%');
    this.el = h('footer', { class: 'pages-bar' },
      this.list,
      iconButton('plus', 'Add page', () => editor.addPage(), { 'data-testid': 'strip-add-page' }),
      h('div', { class: 'zoom' },
        iconButton('minus', 'Zoom out', () => canvas.zoomBy(1 / 1.25), { 'data-testid': 'zoom-out' }),
        this.zoomLabel,
        iconButton('plus', 'Zoom in', () => canvas.zoomBy(1.25), { 'data-testid': 'zoom-in' }),
        iconButton('fit', 'Zoom to fit', () => canvas.zoomToFit(), { 'data-testid': 'zoom-fit' })));
    this.redraw = debounce(() => this.render(), 250);
    editor.on((what) => {
      if (what === 'view') this.zoomLabel.textContent = `${Math.round(editor.zoom * 100)}%`;
      else if (what === 'page') this.render();
      else if (what === 'doc') this.redraw();
    });
    this.render();
  }

  render() {
    const ed = this.ed;
    clear(this.list);
    ed.doc.pages.forEach((p, i) => {
      const item = h('li', { class: i === ed.page ? 'on' : '', draggable: 'true', 'data-testid': 'page-thumb' },
        h('button', { type: 'button', class: 'page-thumb', title: `Page ${i + 1}`, 'aria-label': `Page ${i + 1}`, 'aria-current': String(i === ed.page), onClick: () => ed.setPage(i) },
          h('span', { class: 'page-img', style: { aspectRatio: `${ed.doc.width} / ${ed.doc.height}` }, html: renderPage(ed.doc, i, { measure, noSize: true, idPrefix: `ps${i}`, assetHref: this.canvas.assetHref }) }),
          h('span', { class: 'page-no' }, String(i + 1))));
      item.addEventListener('dragstart', (e) => e.dataTransfer.setData('application/x-paperwall-page', String(i)));
      item.addEventListener('dragover', (e) => e.preventDefault());
      item.addEventListener('drop', (e) => {
        e.preventDefault();
        const from = Number(e.dataTransfer.getData('application/x-paperwall-page'));
        if (Number.isInteger(from) && from !== i) ed.movePage(from, i);
      });
      this.list.append(item);
    });
    this.zoomLabel.textContent = `${Math.round(ed.zoom * 100)}%`;
  }
}

/** Show pages full screen, one at a time. Arrow keys move, Escape leaves. */
export function present(editor, canvas) {
  const doc = editor.doc;
  let i = editor.page;
  const slide = h('div', { class: 'slide' });
  const counter = h('div', { class: 'slide-count' });
  const root = h('div', { class: 'presenter', 'data-testid': 'presenter', tabindex: '-1' }, slide, counter,
    h('button', { type: 'button', class: 'presenter-close', 'aria-label': 'Stop presenting', onClick: () => close() }, icon('close')));
  const show = () => {
    slide.innerHTML = renderPage(doc, i, { measure, noSize: true, idPrefix: `pr${i}`, assetHref: canvas.assetHref });
    slide.style.aspectRatio = `${doc.width} / ${doc.height}`;
    counter.textContent = `${i + 1} / ${doc.pages.length}`;
  };
  const onKey = (e) => {
    if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key)) i = Math.min(doc.pages.length - 1, i + 1);
    else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) i = Math.max(0, i - 1);
    else if (e.key === 'Home') i = 0;
    else if (e.key === 'End') i = doc.pages.length - 1;
    else if (e.key === 'Escape') return close();
    else return;
    e.preventDefault();
    e.stopPropagation();
    show();
  };
  const close = () => {
    document.removeEventListener('keydown', onKey, true);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => null);
    root.remove();
  };
  root.addEventListener('click', (e) => {
    if (e.target.closest('.presenter-close')) return;
    const left = e.clientX < window.innerWidth / 3;
    i = left ? Math.max(0, i - 1) : Math.min(doc.pages.length - 1, i + 1);
    show();
  });
  document.addEventListener('keydown', onKey, true);
  document.body.append(root);
  show();
  root.focus();
  root.requestFullscreen?.().catch(() => null);
  document.addEventListener('fullscreenchange', function onFs() {
    if (!document.fullscreenElement && root.isConnected) {
      document.removeEventListener('fullscreenchange', onFs);
    }
  });
  return { close };
}
