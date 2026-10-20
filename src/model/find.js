// Find and replace across every page: text boxes (also inside groups),
// table cells and chart labels.

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Older browsers (Safari before 16.4) can't look behind; they get \b, which
// only knows Latin letters but still works.
const LOOKBEHIND = (() => {
  try {
    return new RegExp('(?<!a)b').test('b');
  } catch {
    return false;
  }
})();

function matcher(query, { matchCase = false, wholeWord = false } = {}) {
  if (!query) return null;
  const body = escapeRe(query);
  if (wholeWord && !LOOKBEHIND) {
    // \b only works next to a letter or digit; a query starting or ending with a symbol gets none there.
    const left = /^\w/.test(query) ? '\\b' : '';
    const right = /\w$/.test(query) ? '\\b' : '';
    return new RegExp(`${left}${body}${right}`, `g${matchCase ? '' : 'i'}u`);
  }
  return new RegExp(wholeWord ? `(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])` : body, `g${matchCase ? '' : 'i'}u`);
}

/**
 * Every place with text, as { page, el, owner, groups, get(), set(v) }, in
 * reading order. `groups` are the groups around el, outermost first.
 */
function* textSlots(doc) {
  for (let page = 0; page < doc.pages.length; page++) {
    const visit = function* (els, groups) {
      for (const el of els) {
        const owner = groups[0] || el;
        // Locked and hidden things are left alone.
        if (el.hidden || el.locked || groups.some((g) => g.hidden || g.locked)) continue;
        const slot = { page, el, owner, groups };
        if (el.type === 'text') yield { ...slot, get: () => el.text, set: (v) => (el.text = v) };
        if (el.type === 'table') {
          for (const row of el.rows) for (let c = 0; c < row.length; c++) yield { ...slot, get: () => row[c], set: (v) => (row[c] = v) };
        }
        if (el.type === 'chart') for (const d of el.data) yield { ...slot, get: () => d.label, set: (v) => (d.label = v) };
        if (el.type === 'group') yield* visit(el.children, [...groups, el]);
      }
    };
    yield* visit(doc.pages[page].elements, []);
  }
}

/**
 * Where a query appears: [{ page, id, count }], one entry per top-level
 * element (a group counts as one), in page order.
 */
export function findText(doc, query, opts) {
  const re = matcher(query, opts);
  if (!re) return [];
  const hits = new Map();
  for (const slot of textSlots(doc)) {
    const n = (String(slot.get() ?? '').match(re) || []).length;
    if (!n) continue;
    const key = `${slot.page}:${slot.owner.id}`;
    const hit = hits.get(key) || { page: slot.page, id: slot.owner.id, count: 0 };
    hit.count += n;
    hits.set(key, hit);
  }
  return [...hits.values()];
}

/**
 * Replace a query everywhere (or only in `onlyId`, a top-level element).
 * Returns { count, changed: [{ page, id }] } so text boxes can be refitted.
 */
export function replaceText(doc, query, replacement, opts = {}) {
  const re = matcher(query, opts);
  const changed = new Map();
  let count = 0;
  if (!re) return { count, changed: [] };
  for (const slot of textSlots(doc)) {
    if (opts.onlyId && (slot.owner.id !== opts.onlyId || (opts.onlyPage !== undefined && slot.page !== opts.onlyPage))) continue;
    const before = String(slot.get() ?? '');
    const n = (before.match(re) || []).length;
    if (!n) continue;
    // A function replacement keeps "$" in the new text literal.
    slot.set(before.replace(re, () => replacement));
    count += n;
    changed.set(`${slot.page}:${slot.el.id}`, { page: slot.page, id: slot.el.id, el: slot.el, owner: slot.owner, groups: slot.groups });
  }
  return { count, changed: [...changed.values()] };
}
