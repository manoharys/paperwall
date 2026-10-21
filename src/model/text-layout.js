// Line breaking for text boxes. `measure(text, style)` returns a width in px;
// the browser passes one backed by canvas, tests pass a simple fake.

export function fontString(el) {
  return `${el.italic ? 'italic ' : ''}${el.weight || 400} ${el.size}px "${el.font}"`;
}

export function displayText(el) {
  return el.caps ? el.text.toUpperCase() : el.text;
}

export function measureWith(measure, el) {
  const spacing = el.letterSpacing || 0;
  return (s) => measure(s, el) + spacing * [...s].length;
}

function breakWord(word, width, m) {
  const parts = [];
  let cur = '';
  for (const ch of word) {
    if (cur && m(cur + ch) > width) {
      parts.push(cur);
      cur = ch;
    } else {
      cur += ch;
    }
  }
  if (cur) parts.push(cur);
  return parts;
}

/** How far a sticky note's text sits in from its edges (0 for plain text). */
export function notePad(el) {
  return el.note ? Math.round(Math.max(16, el.size * 0.6)) : 0;
}

/** A sticky note's words as plain text in the box inside its edges (the same middle). */
export function noteInner(el) {
  const p = notePad(el);
  return { ...el, note: null, x: el.x + p, y: el.y + p, w: Math.max(1, el.w - p * 2), h: Math.max(1, el.h - p * 2) };
}

/**
 * Lay out a text element.
 * Returns lines with their text, left offset (x, for list indents) and width,
 * plus the line height and the total height.
 */
export function layoutText(el, measure) {
  // A sticky note's text wraps inside its edges.
  if (el.note) return layoutText(noteInner(el), measure);
  const m = measureWith(measure, el);
  const lineHeight = el.size * (el.lineHeight || 1.2);
  const lines = [];
  let brokeWord = false;
  const paragraphs = displayText(el).split('\n');
  // (A piece of a longer text, on a later sheet: `listStart` numbers on from
  // there, and `continues` means its first paragraph began before it.)
  let number = (el.listStart || 1) - 1;
  for (const [pi, para] of paragraphs.entries()) {
    let prefix = '';
    const goesOn = pi === 0 && el.continues;
    if (el.list === 'bullet' && para.trim()) prefix = '•  ';
    if (el.list === 'number' && para.trim()) prefix = goesOn ? `${Math.max(1, number)}.  ` : `${++number}.  `;
    const indent = prefix ? m(prefix) : 0;
    if (goesOn && prefix) prefix = ''; // in line with the rest of its item, without its mark again
    const avail = Math.max(1, el.w - indent);
    const words = para.split(/(\s+)/).filter((w) => w.length);
    let cur = '';
    let first = true;
    let glue = false; // the next line goes on with a word broken over lines
    const push = (text) => {
      const t = text.replace(/\s+$/, '');
      lines.push({ text: t, prefix: first ? prefix : '', indent, width: m(t), start: first, glue });
      first = false;
      glue = false;
    };
    if (!words.length) {
      lines.push({ text: '', prefix: '', indent: 0, width: 0, start: true });
      continue;
    }
    for (const word of words) {
      const next = cur + word;
      if (!cur.trim() && /^\s+$/.test(word)) {
        cur = next;
        continue;
      }
      if (m(next.replace(/\s+$/, '')) <= avail) {
        cur = next;
        continue;
      }
      if (cur.trim()) push(cur);
      cur = '';
      if (/^\s+$/.test(word)) continue;
      if (m(word) > avail) {
        const parts = breakWord(word, avail, m);
        brokeWord = true;
        for (let i = 0; i < parts.length - 1; i++) {
          push(parts[i]);
          glue = true;
        }
        cur = parts[parts.length - 1];
      } else {
        cur = word;
      }
    }
    push(cur);
  }
  return { lines, lineHeight, height: Math.max(lineHeight, lines.length * lineHeight), brokeWord };
}

/** Height a text box needs to show all its text (plus highlight padding). */
export function fitHeight(el, measure) {
  const { height } = layoutText(el, measure);
  const pad = el.highlight ? (el.highlight.padding ?? 0) * 2 : 0;
  // A sticky note keeps its size, and grows only when its words need more.
  if (el.note) return Math.max(Math.ceil(height + notePad(el) * 2), el.h || el.w);
  return Math.ceil(height + pad);
}

/** A rough measurer for tests and for the first paint before fonts load. */
export function approxMeasure(text, el) {
  let w = 0;
  for (const ch of text) {
    if (ch === ' ') w += 0.28;
    else if ('il.,:;|!\'`'.includes(ch)) w += 0.25;
    else if ('mwMW@'.includes(ch)) w += 0.85;
    else if (ch >= 'A' && ch <= 'Z') w += 0.65;
    else w += 0.52;
  }
  return w * el.size * ((el.weight || 400) >= 600 ? 1.06 : 1);
}
