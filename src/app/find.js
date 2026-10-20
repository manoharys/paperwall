// The Find and replace dialog: search every page, jump to each place, and
// replace one at a time or all at once (one undo step).

import { h, dialog, toast } from './ui.js';
import { toggle } from './widgets.js';
import { findText, replaceText, countMatches } from '../model/find.js';

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
    say();
  };
  // Just the status line, from the matches already found.
  const say = () => {
    const n = total();
    status.textContent = !find.value ? 'Searches text on every page, in tables and chart labels too.'
      : n ? `${n} match${n === 1 ? '' : 'es'} in ${hits.length} place${hits.length === 1 ? '' : 's'}${at >= 0 ? ` · showing ${at + 1} of ${n}` : ''}`
        : 'No matches.';
  };
  const show = (i) => {
    if (!matches.length) return;
    // Previous before anything is shown goes to the last match.
    at = ((at < 0 && i < 0 ? -1 : i) + matches.length) % matches.length;
    const hit = matches[at];
    if (editor.page !== hit.page) editor.setPage(hit.page);
    editor.select([hit.id]);
    say();
  };
  // Replacing changes text, so boxes are measured again for their new size.
  // (refitAllText refits the groups around them too.)
  const refit = (changed) => {
    const els = new Set(changed.map((c) => c.el));
    editor.refitAllText((el) => els.has(el));
  };
  const replaceOne = () => {
    if (!matches.length) return;
    if (at < 0) return show(0);
    const hit = matches[at];
    // An undo step only if something was replaced (the place may be locked by now).
    const r = editor.change(() => {
      const res = replaceText(editor.doc, find.value, repl.value, { ...opts, onlyId: hit.id, onlyPage: hit.page, nth: hit.nth });
      refit(res.changed);
      return res;
    }, { unchanged: (res) => !res.count });
    // Move on to the next match. It slides into this one's place, unless the
    // new text contains the query too: then step past it, or it never ends.
    // (Worked out before the list shrinks, so the last match wraps to the first.)
    const again = r.count ? countMatches(repl.value, find.value, opts) : 1;
    const next = at + again;
    refresh();
    if (matches.length) show(next);
  };
  const replaceAll = () => {
    // One walk over the design, one undo step (none if nothing matched).
    const { count } = editor.change(() => {
      const res = replaceText(editor.doc, find.value, repl.value, opts);
      refit(res.changed);
      return res;
    }, { unchanged: (res) => !res.count });
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
      toggle({ label: 'Match case', checked: false, testid: 'find-case', onChange: (v) => { opts.matchCase = v; at = -1; refresh(); } }),
      toggle({ label: 'Whole words', checked: false, testid: 'find-word', onChange: (v) => { opts.wholeWord = v; at = -1; refresh(); } })),
    status,
    h('div', { class: 'row' },
      h('button', { type: 'button', class: 'btn small', 'data-testid': 'find-prev', onClick: () => show(at - 1) }, 'Previous'),
      h('button', { type: 'button', class: 'btn small', 'data-testid': 'find-next', onClick: () => show(at + 1) }, 'Next')),
    repl,
    h('div', { class: 'row' },
      h('button', { type: 'button', class: 'btn small', 'data-testid': 'replace-one', onClick: replaceOne }, 'Replace'),
      h('button', { type: 'button', class: 'btn small primary', 'data-testid': 'replace-all', onClick: replaceAll }, 'Replace all'))), { testid: 'find-dialog' });
}
