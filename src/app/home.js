// The home screen: start a design, pick a template, see your designs.

import { h, icon, iconButton, clear, toast, pickFile, dialog, forget } from './ui.js';
import { PRESETS, DOC_STYLES, createDesign, createDesignFromPreset, toPx, uid, clone } from '../model/doc.js';
import { templateBrowser } from './insert.js';
import { readyTemplate } from './templates.js';
import * as store from './store.js';
import { readProjectFile } from './export.js';
import { aiDesignBlock } from './ai-design.js';
import { openOnlineSettings } from './online-settings.js';
import { isOn } from './online.js';
import { languagePicker } from './widgets.js';
import { t, tn, formatAgo } from './i18n.js';
import { presetName, presetSize, sizeLabel } from './names.js';

export function renderHome(root, { openDesign, newDesign, toggleTheme, changeLanguage, installPrompt }) {
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

  // AI design is an online extra: its box shows only once it's turned on in Online extras.
  const aiSlot = h('div', { 'data-testid': 'ai-design-slot' });
  const showAi = async () => {
    if (!aiSlot.isConnected && aiSlot.dataset.ready) return window.removeEventListener('paperwall:online-changed', showAi);
    aiSlot.dataset.ready = '1';
    const on = await isOn('design').catch(() => false);
    if (on && !aiSlot.firstChild) aiSlot.append(aiDesignBlock({ newDesign }));
    else if (!on) clear(aiSlot);
  };
  window.addEventListener('paperwall:online-changed', showAi);
  showAi();

  const fillDesigns = async () => {
    const rows = await store.listDesigns();
    clear(designsGrid);
    if (!rows.length) {
      designsGrid.append(h('p', { class: 'empty-note' }, t('home.noDesigns')));
      return;
    }
    for (const row of rows) {
      const card = h('div', { class: 'design-card', 'data-testid': 'design-card', 'data-id': row.id },
        h('button', { type: 'button', class: 'design-open', 'aria-label': t('home.openDesign', { name: row.name }), onClick: () => openDesign(row.id) },
          h('span', { class: 'design-img', style: { aspectRatio: `${row.width} / ${row.height}` } }, row.thumb ? h('img', { src: row.thumb, alt: '' }) : icon('page', 32))),
        h('div', { class: 'design-meta' },
          h('b', { class: 'design-name', title: row.name }, row.name),
          h('small', null, t('home.cardMeta', { size: sizeLabel(row.width, row.height, row.unit), pages: t('common.pages', { n: row.pages }), when: formatAgo(row.updatedAt) }))),
        h('div', { class: 'design-actions' },
          iconButton('text', t('home.rename'), () => renameDialog(row, fillDesigns), { 'data-testid': 'design-rename' }),
          iconButton('dup', t('common.duplicate'), async () => {
            const doc = await store.loadDesign(row.id);
            const copy = clone(doc);
            copy.id = uid('d');
            copy.name = t('home.copyName', { name: doc.name });
            copy.createdAt = copy.updatedAt = Date.now();
            await store.saveDesign(copy, row.thumb);
            toast(t('home.duplicated'));
            fillDesigns();
          }, { 'data-testid': 'design-duplicate' }),
          iconButton('trash', t('common.delete'), () => confirmDelete(row, fillDesigns), { 'data-testid': 'design-delete' })));
      designsGrid.append(card);
    }
  };

  // A new design's placeholder words (its name, a document's title and first
  // paragraph, a whiteboard's first note) in the person's language; a document
  // in other words than English has its text measured again.
  const newBlank = (p) => {
    const name = { doc: t('common.untitledDoc'), whiteboard: t('common.untitledBoard') }[p.id] || t('common.untitled');
    const title = t('common.untitledDoc');
    const body = t('newText.docBody');
    const doc = createDesignFromPreset(p.id, { name, title, body, note: t('newText.boardNote') });
    return newDesign(doc, doc.document && (title !== DOC_STYLES.title.text || body !== DOC_STYLES.body.text) ? { fit: true } : undefined);
  };

  const custom = customSizeForm((w, hgt, unit) => newDesign(createDesign({ width: w, height: hgt, unit, name: t('common.untitled') })));

  const install = installPrompt() ? h('button', { type: 'button', class: 'btn', 'data-testid': 'install', onClick: () => installPrompt()?.prompt() }, icon('download'), t('home.install')) : null;

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
        } }, icon('open'), t('home.openFile')),
        install,
        h('label', { class: 'lang-pick' }, icon('globe', 18), languagePicker({ testid: 'language-select', onChange: changeLanguage })),
        h('button', { type: 'button', class: 'btn', 'data-testid': 'home-online', onClick: () => openOnlineSettings() }, t('home.online')),
        iconButton('moon', t('common.darkMode'), toggleTheme, { 'data-testid': 'theme-toggle' }))),
    h('main', { class: 'home' },
      h('section', { class: 'hero' },
        h('h1', null, t('home.heroA'), h('br'), h('em', null, t('home.heroB'))),
        h('p', { class: 'lead' }, t('home.lead'))),
      h('section', { class: 'block' },
        h('h2', null, t('home.create')),
        h('div', { class: 'preset-grid', 'data-testid': 'presets' }, PRESETS.map((p) => h('button', { type: 'button', class: 'preset', 'data-testid': `preset-${p.id}`, onClick: () => newBlank(p) },
          h('span', { class: 'preset-shape', style: { aspectRatio: `${p.w} / ${p.h}` } }),
          h('b', null, presetName(p)),
          h('small', null, presetSize(p))))),
        custom),
      aiSlot,
      h('section', { class: 'block' },
        h('div', { class: 'block-head' }, h('h2', null, t('home.templates'))),
        ...templates,
        h('p', { class: 'fine' }, t('home.templatesFine'))),
      h('section', { class: 'block' }, h('h2', null, t('home.yours')), designsGrid)),
    h('footer', { class: 'home-foot' },
      h('p', null, icon('lock', 16), ' ', t('home.private')),
      h('p', null, ...tn('home.footer', { code: h('a', { href: 'https://github.com/manoharys/paperwall', rel: 'noopener', target: '_blank' }, t('home.code')) }))));

  fillDesigns();
}

function customSizeForm(onCreate) {
  let unit = 'px';
  const w = h('input', { type: 'number', min: '1', value: '1200', 'aria-label': t('common.width'), 'data-testid': 'custom-w' });
  const hh = h('input', { type: 'number', min: '1', value: '800', 'aria-label': t('common.height'), 'data-testid': 'custom-h' });
  const u = h('select', { 'aria-label': t('common.units'), 'data-testid': 'custom-unit' }, ['px', 'mm', 'in'].map((x) => h('option', { value: x }, x)));
  u.addEventListener('change', () => (unit = u.value));
  return h('form', { class: 'custom-size', 'data-testid': 'custom-size', onSubmit: (e) => {
    e.preventDefault();
    const pw = toPx(+w.value, unit);
    const ph = toPx(+hh.value, unit);
    if (!(pw > 0 && ph > 0) || pw > 20000 || ph > 20000) return toast(t('home.sizeError'), 'error');
    onCreate(pw, ph, unit);
  } }, h('span', { class: 'label' }, t('common.customSize')), w, h('span', null, '×'), hh, u, h('button', { type: 'submit', class: 'btn primary', 'data-testid': 'custom-create' }, t('home.createBtn')));
}

function renameDialog(row, after) {
  const input = h('input', { type: 'text', value: row.name, maxlength: '120', 'aria-label': t('top.designName'), 'data-testid': 'rename-input' });
  const d = dialog(t('home.renameTitle'), h('form', { class: 'stack', onSubmit: async (e) => {
    e.preventDefault();
    await store.renameDesign(row.id, input.value.trim() || t('common.untitled'));
    d.close();
    after();
  } }, input, h('button', { type: 'submit', class: 'btn primary', 'data-testid': 'rename-save' }, t('common.save'))));
  input.select();
}

function confirmDelete(row, after) {
  const d = dialog(t('home.deleteTitle'), h('div', { class: 'stack' },
    h('p', null, t('home.deleteBody', { name: row.name })),
    h('div', { class: 'row end' },
      h('button', { type: 'button', class: 'btn', onClick: () => d.close() }, t('home.keep')),
      h('button', { type: 'button', class: 'btn danger', 'data-testid': 'confirm-delete', onClick: async () => {
        await store.deleteDesign(row.id);
        d.close();
        toast(t('home.deleted'));
        after();
      } }, t('common.delete')))));
}
