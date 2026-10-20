// Find and replace across every page: text boxes (also inside groups),
// table cells and chart labels.

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Older browsers (Safari before 16.4) can't look behind; they get wordMatcher.
const LOOKBEHIND = (() => {
  try {
    return new RegExp('(?<!a)b').test('b');
  } catch {
    return false;
  }
})();

const WORD_CHAR = /[\p{L}\p{N}]/u;

/**
 * Without look-behind: matches of `re` (which checks the character after)
 * whose character before isn't a letter or digit either, checked by hand so
 * that no character is used up (two matches may share the one between them).
 * Works with String match and replace, like a RegExp.
 */
function wordMatcher(re) {
  const find = (text) => {
    const out = [];
    re.lastIndex = 0;
    for (let m; (m = re.exec(text)); ) {
      if (!m[0]) {
        re.lastIndex++;
        continue;
      }
      if (m.index === 0 || !WORD_CHAR.test(text[m.index - 1])) out.push(m);
      re.lastIndex = m.index + 1;
    }
    // Overlapping matches (a query like "--" in "---") count once, left first:
    // each is checked against the last one kept.
    const kept = [];
    for (const m of out) {
      const last = kept[kept.length - 1];
      if (!last || m.index >= last.index + last[0].length) kept.push(m);
    }
    return kept;
  };
  return {
    [Symbol.match]: (text) => {
      const all = find(text);
      return all.length ? all.map((m) => m[0]) : null;
    },
    [Symbol.replace]: (text, fn) => {
      let out = '';
      let at = 0;
      for (const m of find(text)) {
        out += text.slice(at, m.index) + fn(m[0]);
        at = m.index + m[0].length;
      }
      return out + text.slice(at);
    },
  };
}

// (Exported for tests, which can't turn look-behind off.)
export { wordMatcher };

function matcher(query, { matchCase = false, wholeWord = false } = {}) {
  if (!query) return null;
  const body = escapeRe(query);
  if (wholeWord && !LOOKBEHIND) return wordMatcher(new RegExp(`${body}(?![\\p{L}\\p{N}])`, `g${matchCase ? '' : 'i'}u`));
  return new RegExp(wholeWord ? `(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])` : body, `g${matchCase ? '' : 'i'}u`);
}

/** How many times a query appears in a piece of text. */
export function countMatches(text, query, opts) {
  const re = matcher(query, opts);
  return re ? (String(text).match(re) || []).length : 0;
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
        // Tables and charts from older or hand-made files may lack rows or data.
        if (el.type === 'table') {
          for (const row of Array.isArray(el.rows) ? el.rows : []) {
            if (Array.isArray(row)) for (let c = 0; c < row.length; c++) yield { ...slot, get: () => row[c], set: (v) => (row[c] = v) };
          }
        }
        if (el.type === 'chart') for (const d of Array.isArray(el.data) ? el.data : []) if (d) yield { ...slot, get: () => d.label, set: (v) => (d.label = v) };
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
 * Replace a query everywhere (or only in `onlyId`, a top-level element; with
 * `nth` too, only that element's nth match, counting from 0 in reading order).
 * Returns { count, changed: [{ page, id }] } so text boxes can be refitted.
 */
export function replaceText(doc, query, replacement, opts = {}) {
  const re = matcher(query, opts);
  const changed = new Map();
  let count = 0;
  if (!re) return { count, changed: [] };
  let skip = opts.nth ?? -1; // matches still to pass before the one to replace
  for (const slot of textSlots(doc)) {
    if (opts.onlyId && (slot.owner.id !== opts.onlyId || (opts.onlyPage !== undefined && slot.page !== opts.onlyPage))) continue;
    const before = String(slot.get() ?? '');
    const n = (before.match(re) || []).length;
    if (!n) continue;
    if (skip >= n) {
      skip -= n;
      continue;
    }
    // A function replacement keeps "$" in the new text literal.
    let seen = 0;
    slot.set(before.replace(re, (m) => (skip < 0 || seen++ === skip ? replacement : m)));
    count += skip < 0 ? n : 1;
    changed.set(`${slot.page}:${slot.el.id}`, { page: slot.page, id: slot.el.id, el: slot.el, owner: slot.owner, groups: slot.groups });
    if (skip >= 0) break; // the one match is done
  }
  return { count, changed: [...changed.values()] };
}
