// The Find and replace dialog: search every page, jump to each place, and
// replace one at a time or all at once (one undo step).

import { h, dialog, toast } from './ui.js';
import { toggle } from './widgets.js';
import { findText, replaceText } from '../model/find.js';
import { refitGroup } from '../model/geometry.js';

export function findDialog(editor) {
  const opts = { matchCase: false, wholeWord: false };
  let hits = []; // places: { page, id, count }
  let matches = []; // every match, one by one: { page, id, nth }
  let at = -1; // which match is shown
  const find = h('input', { type: 'search', placeholder: 'Find', 'aria-label': 'Find', 'data-testid': 'find-input' });
  const repl = h('input', { type: 'text', placeholder: 'Replace with', 'aria-label': 'Replace with', 'data-testid': 'replace-input' });
  const status = h('p', { class: 'hint', 'data-testid': 'find-status', 'aria-live': 'polite' });
  const total = () => hits.reduce((s, x) => s + x.count, 0);
  const refresh = () => {
    hits = findText(editor.doc, find.value, opts);
    matches = hits.flatMap((x) => Array.from({ length: x.count }, (_, nth) => ({ page: x.page, id: x.id, nth })));
    at = Math.min(at, matches.length - 1);
    const n = total();
    status.textContent = !find.value ? 'Searches text on every page, in tables and chart labels too.'
      : n ? `${n} match${n === 1 ? '' : 'es'} in ${hits.length} place${hits.length === 1 ? '' : 's'}${at >= 0 ? ` · showing ${at + 1} of ${n}` : ''}`
        : 'No matches.';
  };
  const show = (i) => {
    if (!matches.length) return;
    at = (i + matches.length) % matches.length;
    const hit = matches[at];
    if (editor.page !== hit.page) editor.setPage(hit.page);
    editor.select([hit.id]);
    refresh();
  };
  // Replacing changes text, so boxes are measured again for their new size.
  const refit = (changed) => {
    for (const c of changed) if (c.el.type === 'text') editor.fitText(c.el);
    // Then every group around changed text, innermost first, so boxes nest again.
    const depth = new Map();
    for (const c of changed) c.groups.forEach((g, d) => depth.set(g, Math.max(d, depth.get(g) ?? 0)));
    for (const g of [...depth.keys()].sort((a, b) => depth.get(b) - depth.get(a))) refitGroup(g);
  };
  const replaceOne = () => {
    if (!matches.length) return;
    if (at < 0) return show(0);
    const hit = matches[at];
    // An undo step only if something was replaced (the place may be locked by now).
    editor.history.record(editor.doc);
    const r = replaceText(editor.doc, find.value, repl.value, { ...opts, onlyId: hit.id, onlyPage: hit.page, nth: hit.nth });
    if (r.count) {
      refit(r.changed);
      editor.afterChange();
    } else editor.history.discard();
    refresh();
    if (!matches.length) return;
    // Move on to the next match. It slides into this one's place, unless the
    // new text contains the query too: then step past it, or it never ends.
    const again = r.count ? findText({ pages: [{ elements: [{ id: 'x', type: 'text', text: repl.value }] }] }, find.value, opts)[0]?.count || 0 : 1;
    show(at + again);
  };
  const replaceAll = () => {
    // One walk over the design: record an undo step, replace, and drop the
    // step again if nothing matched.
    editor.history.record(editor.doc);
    const r = replaceText(editor.doc, find.value, repl.value, opts);
    const count = r.count;
    if (count) {
      refit(r.changed);
      editor.afterChange();
    } else editor.history.discard();
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
