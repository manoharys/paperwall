// The strip of pages along the bottom, and presenting pages full screen.

import { h, icon, iconButton, clear, debounce, dialog, toast } from './ui.js';
import { renderPage } from '../model/render.js';
import { measure } from './fonts.js';
import { visiblePages } from '../model/doc.js';

export class PageStrip {
  constructor(editor, canvas) {
    this.ed = editor;
    this.canvas = canvas;
    this.list = h('ol', { class: 'page-list', 'data-testid': 'page-strip' });
    this.zoomLabel = h('button', { type: 'button', class: 'zoom-label', title: 'Zoom to fit', 'data-testid': 'zoom-label', onClick: () => canvas.zoomToFit() }, '100%');
    this.el = h('footer', { class: 'pages-bar' },
      this.list,
      iconButton('plus', 'Add page', () => editor.addPage(), { 'data-testid': 'strip-add-page' }),
      iconButton('grid', 'All pages in a grid', () => pageGrid(editor, canvas), { 'data-testid': 'page-grid-btn' }),
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
      const name = pageName(p, i);
      const item = h('li', { class: `${i === ed.page ? 'on' : ''}${p.hidden ? ' hidden-page' : ''}`, draggable: 'true', 'data-testid': 'page-thumb' },
        h('button', { type: 'button', class: 'page-thumb', title: p.hidden ? `${name} (hidden)` : name, 'aria-label': p.hidden ? `${name} (hidden)` : name, 'aria-current': String(i === ed.page), onClick: () => ed.setPage(i) },
          h('span', { class: 'page-img', style: { aspectRatio: `${ed.doc.width} / ${ed.doc.height}` }, html: renderPage(ed.doc, i, { measure, noSize: true, idPrefix: `ps${i}`, assetHref: this.canvas.assetHref }) }),
          h('span', { class: 'page-no' }, String(i + 1)),
          p.hidden ? h('span', { class: 'page-hidden-mark', 'aria-hidden': 'true' }, icon('eyeOff', 14)) : null),
        p.title ? h('span', { class: 'page-title', 'data-testid': 'page-title-label' }, p.title) : null);
      pageDrag(item, i, (from) => ed.movePage(from, i));
      this.list.append(item);
    });
    this.zoomLabel.textContent = `${Math.round(ed.zoom * 100)}%`;
  }
}

/** Let a page's thumbnail be dragged onto another to move it there. */
function pageDrag(el, i, onMove) {
  el.addEventListener('dragstart', (e) => e.dataTransfer.setData('application/x-paperwall-page', String(i)));
  el.addEventListener('dragover', (e) => e.preventDefault());
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData('application/x-paperwall-page');
    const from = raw === '' ? NaN : Number(raw); // other drags (an upload, a file) carry no page
    if (Number.isInteger(from) && from !== i) onMove(from);
  });
}

export function pageName(page, i) {
  return page.title ? `Page ${i + 1}: ${page.title}` : `Page ${i + 1}`;
}

/** Every page large, in a grid: click one to go to it, drag to reorder. */
export function pageGrid(editor, canvas) {
  const grid = h('ol', { class: 'page-grid', 'data-testid': 'page-grid' });
  const fill = () => {
    clear(grid);
    editor.doc.pages.forEach((p, i) => {
      const card = h('li', { class: `pg-card${i === editor.page ? ' on' : ''}${p.hidden ? ' hidden-page' : ''}`, draggable: 'true', 'data-testid': 'page-grid-card' },
        h('button', { type: 'button', class: 'pg-open', 'aria-label': `Open ${pageName(p, i)}`, onClick: () => {
          editor.setPage(i);
          d.close();
        } }, h('span', { class: 'page-img', style: { aspectRatio: `${editor.doc.width} / ${editor.doc.height}` }, html: renderPage(editor.doc, i, { measure, noSize: true, idPrefix: `pg${i}`, assetHref: canvas.assetHref }) })),
        h('div', { class: 'pg-meta' },
          h('b', null, String(i + 1)),
          h('span', null, p.title || ''),
          p.hidden ? h('small', null, 'Hidden') : null,
          iconButton(p.hidden ? 'eye' : 'eyeOff', p.hidden ? 'Show page' : 'Hide page', () => {
            editor.setPageHidden(i, !p.hidden);
            fill();
          }, { 'data-testid': 'page-grid-hide' })));
      pageDrag(card, i, (from) => {
        editor.movePage(from, i);
        fill();
      });
      grid.append(card);
    });
  };
  fill();
  const d = dialog(`All pages (${editor.doc.pages.length})`, grid, { wide: true, testid: 'page-grid-dialog' });
  return d;
}

/** Show pages full screen, one at a time. Arrow keys move, Escape leaves. Hidden pages are skipped. */
export function present(editor, canvas) {
  const doc = editor.doc;
  const shown = visiblePages(doc);
  if (!shown.length) return toast('Every page is hidden. Show a page to present it.');
  let at = Math.max(0, shown.indexOf(editor.page));
  const slide = h('div', { class: 'slide' });
  const counter = h('div', { class: 'slide-count' });
  const root = h('div', { class: 'presenter', 'data-testid': 'presenter', tabindex: '-1' }, slide, counter,
    h('button', { type: 'button', class: 'presenter-close', 'aria-label': 'Stop presenting', onClick: () => close() }, icon('close')));
  const show = () => {
    const i = shown[at];
    slide.innerHTML = renderPage(doc, i, { measure, noSize: true, idPrefix: `pr${i}`, assetHref: canvas.assetHref });
    slide.style.aspectRatio = `${doc.width} / ${doc.height}`;
    counter.textContent = `${at + 1} / ${shown.length}`;
  };
  const last = shown.length - 1;
  const onKey = (e) => {
    if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key)) at = Math.min(last, at + 1);
    else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) at = Math.max(0, at - 1);
    else if (e.key === 'Home') at = 0;
    else if (e.key === 'End') at = last;
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
    at = left ? Math.max(0, at - 1) : Math.min(last, at + 1);
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
