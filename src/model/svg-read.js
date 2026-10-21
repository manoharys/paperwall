// Reads back the SVG markup our renderer makes (with the icons and stickers
// inside it) as a tree, for writers of other formats. Not a general XML
// parser: no DTDs or namespaces, which our markup never has.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) && cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    }
    return ENTITIES[e] ?? m;
  });
}

/** Markup → { tag: '#root', attrs: {}, children: [...] }; text nodes are { text }. */
export function parseSvg(markup) {
  const root = { tag: '#root', attrs: {}, children: [] };
  const stack = [root];
  let i = 0;
  const n = markup.length;
  while (i < n) {
    const lt = markup.indexOf('<', i);
    const textEnd = lt < 0 ? n : lt;
    if (textEnd > i) stack[stack.length - 1].children.push({ text: decodeEntities(markup.slice(i, textEnd)) });
    if (lt < 0) break;
    if (markup.startsWith('<!--', lt)) {
      const end = markup.indexOf('-->', lt + 4);
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (markup.startsWith('<![CDATA[', lt)) {
      const end = markup.indexOf(']]>', lt + 9);
      stack[stack.length - 1].children.push({ text: markup.slice(lt + 9, end < 0 ? n : end) });
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (markup[lt + 1] === '?' || markup[lt + 1] === '!') {
      const end = markup.indexOf('>', lt);
      i = end < 0 ? n : end + 1;
      continue;
    }
    if (markup[lt + 1] === '/') {
      const end = markup.indexOf('>', lt);
      const tag = markup.slice(lt + 2, end).trim();
      // Close up to the matching element (tolerating a stray close).
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].tag === tag) {
          stack.length = k;
          break;
        }
      }
      i = end < 0 ? n : end + 1;
      continue;
    }
    // An opening tag and its attributes.
    let j = lt + 1;
    while (j < n && !/[\s/>]/.test(markup[j])) j++;
    const node = { tag: markup.slice(lt + 1, j), attrs: {}, children: [] };
    for (;;) {
      while (j < n && /\s/.test(markup[j])) j++;
      if (j >= n) break;
      if (markup[j] === '>' || markup[j] === '/') break;
      let k = j;
      while (k < n && !/[\s=/>]/.test(markup[k])) k++;
      const name = markup.slice(j, k);
      while (k < n && /\s/.test(markup[k])) k++;
      if (markup[k] === '=') {
        k++;
        while (k < n && /\s/.test(markup[k])) k++;
        const q = markup[k];
        if (q === '"' || q === "'") {
          const end = markup.indexOf(q, k + 1);
          node.attrs[name] = decodeEntities(markup.slice(k + 1, end < 0 ? n : end));
          j = end < 0 ? n : end + 1;
        } else {
          let e = k;
          while (e < n && !/[\s>]/.test(markup[e])) e++;
          node.attrs[name] = decodeEntities(markup.slice(k, e));
          j = e;
        }
      } else {
        node.attrs[name] = '';
        j = k;
      }
    }
    const selfClosing = markup[j] === '/';
    const end = markup.indexOf('>', j);
    i = end < 0 ? n : end + 1;
    stack[stack.length - 1].children.push(node);
    if (!selfClosing) stack.push(node);
  }
  return root;
}

/** Every element with an id, by id (for gradients and clip paths in <defs>). */
export function byId(root, out = new Map()) {
  for (const c of root.children || []) {
    if (c.tag) {
      if (c.attrs.id) out.set(c.attrs.id, c);
      byId(c, out);
    }
  }
  return out;
}
