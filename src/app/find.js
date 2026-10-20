// The Find and replace dialog: search every page, jump to each place, and
// replace one at a time or all at once (one undo step).

import { h, dialog, toast } from './ui.js';
import { toggle } from './widgets.js';
import { findText, replaceText } from '../model/find.js';
import { refitGroup } from '../model/commands.js';

export function findDialog(editor) {
  const opts = { matchCase: false, wholeWord: false };
  let hits = [];
  let at = -1;
  const find = h('input', { type: 'search', placeholder: 'Find', 'aria-label': 'Find', 'data-testid': 'find-input' });
  const repl = h('input', { type: 'text', placeholder: 'Replace with', 'aria-label': 'Replace with', 'data-testid': 'replace-input' });
  const status = h('p', { class: 'hint', 'data-testid': 'find-status', 'aria-live': 'polite' });
  const total = () => hits.reduce((s, x) => s + x.count, 0);
  const refresh = () => {
    hits = findText(editor.doc, find.value, opts);
    at = Math.min(at, hits.length - 1);
    const n = total();
    status.textContent = !find.value ? 'Searches text on every page, in tables and chart labels too.'
      : n ? `${n} match${n === 1 ? '' : 'es'} in ${hits.length} place${hits.length === 1 ? '' : 's'}${at >= 0 ? ` · showing ${at + 1} of ${hits.length}` : ''}`
        : 'No matches.';
  };
  const show = (i) => {
    if (!hits.length) return;
    at = (i + hits.length) % hits.length;
    const hit = hits[at];
    if (editor.page !== hit.page) editor.setPage(hit.page);
    editor.select([hit.id]);
    refresh();
  };
  // Replacing changes text, so boxes are measured again for their new size.
  const refit = (changed) => {
    for (const c of changed) if (c.el.type === 'text') editor.fitText(c.el);
    for (const g of new Set(changed.map((c) => c.owner).filter((o) => o.type === 'group'))) refitGroup(g);
  };
  const replaceOne = () => {
    if (!hits.length) return;
    if (at < 0) return show(0);
    const hit = hits[at];
    editor.change(() => refit(replaceText(editor.doc, find.value, repl.value, { ...opts, onlyId: hit.id }).changed));
    refresh();
    if (hits.length) show(at);
  };
  const replaceAll = () => {
    let count = 0;
    editor.change(() => {
      const r = replaceText(editor.doc, find.value, repl.value, opts);
      count = r.count;
      refit(r.changed);
    });
    refresh();
    toast(count ? `Replaced ${count} time${count === 1 ? '' : 's'}. Undo to put it back.` : 'Nothing to replace.');
  };
  find.addEventListener('input', () => {
    at = -1;
    refresh();
  });
  find.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') show(e.shiftKey ? at - 1 : at + 1);
  });
  refresh();
  return dialog('Find and replace', h('div', { class: 'stack find' },
    find,
    h('div', { class: 'row' },
      toggle({ label: 'Match case', checked: false, testid: 'find-case', onChange: (v) => { opts.matchCase = v; refresh(); } }),
      toggle({ label: 'Whole words', checked: false, testid: 'find-word', onChange: (v) => { opts.wholeWord = v; refresh(); } })),
    status,
    h('div', { class: 'row' },
      h('button', { type: 'button', class: 'btn small', 'data-testid': 'find-prev', onClick: () => show(at - 1) }, 'Previous'),
      h('button', { type: 'button', class: 'btn small', 'data-testid': 'find-next', onClick: () => show(at + 1) }, 'Next')),
    repl,
    h('div', { class: 'row' },
      h('button', { type: 'button', class: 'btn small', 'data-testid': 'replace-one', onClick: replaceOne }, 'Replace'),
      h('button', { type: 'button', class: 'btn small primary', 'data-testid': 'replace-all', onClick: replaceAll }, 'Replace all'))), { testid: 'find-dialog' });
}
