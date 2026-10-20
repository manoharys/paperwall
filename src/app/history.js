// Version history: copies of this design kept on this device while you work.

import { h, dialog, clear, toast, lazily, forget } from './ui.js';
import { renderPage } from '../model/render.js';
import { measure, ensureDesignFonts } from './fonts.js';
import * as store from './store.js';

function when(at) {
  const d = new Date(at);
  const today = new Date();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === today.toDateString()) return `Today, ${time}`;
  const y = new Date(today);
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `Yesterday, ${time}`;
  return `${d.toLocaleDateString([], { day: 'numeric', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' })}, ${time}`;
}

export function historyDialog(editor) {
  const list = h('ol', { class: 'versions', 'data-testid': 'versions' });
  const fill = async () => {
    let rows;
    try {
      rows = await store.listVersions(editor.doc.id);
    } catch (e) {
      forget(list);
      clear(list);
      list.append(h('p', { class: 'empty-note' }, `Couldn't read the versions: ${e.message}`));
      return;
    }
    forget(list);
    clear(list);
    if (!rows.length) list.append(h('p', { class: 'empty-note' }, 'No versions yet. One is kept every few minutes while you work, and whenever you leave a design you changed.'));
    for (const v of rows) {
      const img = h('span', { class: 'version-img', style: { aspectRatio: `${v.width} / ${v.height}` } });
      // The saved thumbnail if there is one; otherwise drawn from the version
      // as it scrolls into view.
      if (v.thumb) img.append(h('img', { src: v.thumb, alt: '' }));
      else lazily(img, () => store.versionDoc(v).then(async (doc) => {
        await ensureDesignFonts(doc);
        img.innerHTML = renderPage(doc, 0, { measure, noSize: true, placeholders: true, idPrefix: `v${v.at}` });
      }).catch(() => img.classList.add('broken')));
      list.append(h('li', { class: 'version', 'data-testid': 'version' },
        img,
        h('div', { class: 'version-meta' },
          h('b', null, when(v.at)),
          h('small', null, `${v.label ? `${v.label} · ` : ''}${v.pages} page${v.pages === 1 ? '' : 's'} · ${v.width} × ${v.height}`)),
        h('button', { type: 'button', class: 'btn small', 'data-testid': 'version-restore', onClick: async () => {
          try {
            const doc = await store.versionDoc(v);
            await ensureDesignFonts(doc);
            if (editor.closed) return;
            editor.restoreVersion(doc);
            d.close();
            toast('Restored. Undo to go back to how it was.');
          } catch (e) {
            toast(`Couldn't restore this version: ${e.message}`, 'error');
          }
        } }, 'Restore')));
    }
  };
  const d = dialog('Version history', h('div', { class: 'stack' },
    h('p', { class: 'hint' }, `The last ${store.MAX_VERSIONS} versions are kept in this browser, on this device.`),
    h('button', { type: 'button', class: 'btn small', 'data-testid': 'version-save', onClick: async () => {
      // After the first check for versions, so the Original comes first.
      await editor.versionsChecked;
      // Saving the design mustn't start a timed version of its own as well.
      editor.versionAt = Date.now();
      await editor.flush();
      if (!(await editor.saveVersion('Saved by you'))) toast("Couldn't save a version on this device.", 'error');
      fill();
    } }, 'Save a version now'),
    list), { wide: true, testid: 'history-dialog', onClose: () => forget(list) });
  fill();
  return d;
}
