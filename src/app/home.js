// The home screen: start a design, pick a template, see your designs.

import { h, icon, iconButton, clear, toast, pickFile, dialog, forget } from './ui.js';
import { PRESETS, createDesign, createDesignFromPreset, toPx, uid, clone } from '../model/doc.js';
import { templateBrowser } from './insert.js';
import { readyTemplate } from './templates.js';
import * as store from './store.js';
import { readProjectFile } from './export.js';

export function renderHome(root, { openDesign, newDesign, toggleTheme, installPrompt }) {
  forget(root);
  clear(root);
  const designsGrid = h('div', { class: 'design-grid', 'data-testid': 'my-designs' });
  const templates = templateBrowser({
    state: { query: '', category: 'All', format: 'All', shown: 30 },
    ids: { search: 'home-template-search', format: 'home-template-format', cat: 'home-cat', grid: 'home-templates', more: 'home-templates-more', count: 'home-template-count' },
    pageSize: 30,
    gridClass: 'tpl-grid wide',
    onPick: async (t) => {
      const doc = await readyTemplate(t);
      doc.name = t.name;
      newDesign(doc, { fit: true });
    },
  });

  const fillDesigns = async () => {
    const rows = await store.listDesigns();
    clear(designsGrid);
    if (!rows.length) {
      designsGrid.append(h('p', { class: 'empty-note' }, 'Your designs will appear here. They are saved on this device automatically.'));
      return;
    }
    for (const row of rows) {
      const card = h('div', { class: 'design-card', 'data-testid': 'design-card', 'data-id': row.id },
        h('button', { type: 'button', class: 'design-open', 'aria-label': `Open ${row.name}`, onClick: () => openDesign(row.id) },
          h('span', { class: 'design-img', style: { aspectRatio: `${row.width} / ${row.height}` } }, row.thumb ? h('img', { src: row.thumb, alt: '' }) : icon('page', 32))),
        h('div', { class: 'design-meta' },
          h('b', { class: 'design-name', title: row.name }, row.name),
          h('small', null, `${row.width} × ${row.height} · ${row.pages} page${row.pages === 1 ? '' : 's'} · ${ago(row.updatedAt)}`)),
        h('div', { class: 'design-actions' },
          iconButton('text', 'Rename', () => renameDialog(row, fillDesigns), { 'data-testid': 'design-rename' }),
          iconButton('dup', 'Duplicate', async () => {
            const doc = await store.loadDesign(row.id);
            const copy = clone(doc);
            copy.id = uid('d');
            copy.name = `${doc.name} (copy)`;
            copy.createdAt = copy.updatedAt = Date.now();
            await store.saveDesign(copy, row.thumb);
            toast('Duplicated');
            fillDesigns();
          }, { 'data-testid': 'design-duplicate' }),
          iconButton('trash', 'Delete', () => confirmDelete(row, fillDesigns), { 'data-testid': 'design-delete' })));
      designsGrid.append(card);
    }
  };

  const custom = customSizeForm((w, hgt, unit) => newDesign(createDesign({ width: w, height: hgt, unit })));

  const install = installPrompt() ? h('button', { type: 'button', class: 'btn', 'data-testid': 'install', onClick: () => installPrompt()?.prompt() }, icon('download'), 'Install app') : null;

  root.append(
    h('header', { class: 'home-top' },
      h('a', { class: 'brand', href: '#/' }, h('span', { class: 'logo', 'aria-hidden': 'true' }), 'Paperwall'),
      h('div', { class: 'home-actions' },
        h('button', { type: 'button', class: 'btn', 'data-testid': 'open-file', onClick: async () => {
          const [file] = await pickFile('.json,.paperwall,application/json');
          if (!file) return;
          try {
            const doc = await readProjectFile(file);
            // A new id if the design is here already, or if history from a
            // deleted copy is still kept under its id (it would attach to this one).
            if ((await store.hasDesign(doc.id)) || (await store.hasVersions(doc.id))) doc.id = uid('d');
            newDesign(doc);
          } catch (e) {
            toast(e.message, 'error');
          }
        } }, icon('open'), 'Open a file'),
        install,
        iconButton('moon', 'Dark mode', toggleTheme, { 'data-testid': 'theme-toggle' }))),
    h('main', { class: 'home' },
      h('section', { class: 'hero' },
        h('h1', null, 'Design without', h('br'), h('em', null, 'the paywall.')),
        h('p', { class: 'lead' }, 'Posters, posts, invitations and slides. Free, offline and yours: no account, no watermark, and your work never leaves this device.')),
      h('section', { class: 'block' },
        h('h2', null, 'Create a design'),
        h('div', { class: 'preset-grid', 'data-testid': 'presets' }, PRESETS.map((p) => h('button', { type: 'button', class: 'preset', 'data-testid': `preset-${p.id}`, onClick: () => newDesign(createDesignFromPreset(p.id)) },
          h('span', { class: 'preset-shape', style: { aspectRatio: `${p.w} / ${p.h}` } }),
          h('b', null, p.name),
          h('small', null, p.unit === 'mm' ? `${Math.round((p.w / 300) * 25.4)} × ${Math.round((p.h / 300) * 25.4)} mm` : p.unit === 'in' ? `${p.w / 300} × ${p.h / 300} in` : `${p.w} × ${p.h} px`)))),
        custom),
      h('section', { class: 'block' },
        h('div', { class: 'block-head' }, h('h2', null, 'Start from a template')),
        ...templates,
        h('p', { class: 'fine' }, 'Every template was made for Paperwall and is free for any use, including commercial (CC0).')),
      h('section', { class: 'block' }, h('h2', null, 'Your designs'), designsGrid)),
    h('footer', { class: 'home-foot' },
      h('p', null, icon('lock', 16), ' Everything stays in this browser on this device. Paperwall makes no network requests.'),
      h('p', null, 'Open source (MIT) · ', h('a', { href: 'https://github.com/manoharys/paperwall', rel: 'noopener', target: '_blank' }, 'Code and feature scoreboard'), ' · Not affiliated with Canva.')));

  fillDesigns();
}

function customSizeForm(onCreate) {
  let unit = 'px';
  const w = h('input', { type: 'number', min: '1', value: '1200', 'aria-label': 'Width', 'data-testid': 'custom-w' });
  const hh = h('input', { type: 'number', min: '1', value: '800', 'aria-label': 'Height', 'data-testid': 'custom-h' });
  const u = h('select', { 'aria-label': 'Units', 'data-testid': 'custom-unit' }, ['px', 'mm', 'in'].map((x) => h('option', { value: x }, x)));
  u.addEventListener('change', () => (unit = u.value));
  return h('form', { class: 'custom-size', 'data-testid': 'custom-size', onSubmit: (e) => {
    e.preventDefault();
    const pw = toPx(+w.value, unit);
    const ph = toPx(+hh.value, unit);
    if (!(pw > 0 && ph > 0) || pw > 20000 || ph > 20000) return toast('Pick a size between 1 and 20000 px (about 1.6 m at print quality).', 'error');
    onCreate(pw, ph, unit);
  } }, h('span', { class: 'label' }, 'Custom size'), w, h('span', null, '×'), hh, u, h('button', { type: 'submit', class: 'btn primary', 'data-testid': 'custom-create' }, 'Create'));
}

function renameDialog(row, after) {
  const input = h('input', { type: 'text', value: row.name, maxlength: '120', 'aria-label': 'Design name', 'data-testid': 'rename-input' });
  const d = dialog('Rename design', h('form', { class: 'stack', onSubmit: async (e) => {
    e.preventDefault();
    await store.renameDesign(row.id, input.value.trim() || 'Untitled design');
    d.close();
    after();
  } }, input, h('button', { type: 'submit', class: 'btn primary', 'data-testid': 'rename-save' }, 'Save')));
  input.select();
}

function confirmDelete(row, after) {
  const d = dialog('Delete this design?', h('div', { class: 'stack' },
    h('p', null, `"${row.name}" will be deleted from this device. This can't be undone. Save it to a file first if you might want it later.`),
    h('div', { class: 'row end' },
      h('button', { type: 'button', class: 'btn', onClick: () => d.close() }, 'Keep it'),
      h('button', { type: 'button', class: 'btn danger', 'data-testid': 'confirm-delete', onClick: async () => {
        await store.deleteDesign(row.id);
        d.close();
        toast('Deleted');
        after();
      } }, 'Delete'))));
}

function ago(t) {
  const s = Math.max(1, Math.round((Date.now() - t) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const hr = Math.round(m / 60);
  if (hr < 24) return `${hr} h ago`;
  const d = Math.round(hr / 24);
  return d < 30 ? `${d} d ago` : new Date(t).toLocaleDateString();
}
