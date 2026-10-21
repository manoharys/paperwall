// Readers for the files Paperwall writes, used by the tests: a PDF's
// objects (through its cross-reference table) and a zip's parts.

import { inflateSync, inflateRawSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';

/**
 * A PDF's structure: its objects, read through the cross-reference table.
 * Throws if an xref offset doesn't point at the object it names.
 * objects: Map(number -> { dict, data }) with streams inflated.
 */
export function readPdf(bytes) {
  const buf = Buffer.from(bytes);
  const text = buf.toString('latin1');
  const header = text.slice(0, 8);
  const sx = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(text);
  if (!sx) throw new Error('No startxref');
  const xrefAt = +sx[1];
  if (!text.startsWith('xref', xrefAt)) throw new Error('startxref does not point at the xref table');
  const m = /^xref\s+0\s+(\d+)\s+/.exec(text.slice(xrefAt));
  const count = +m[1];
  let p = xrefAt + m[0].length;
  const objects = new Map();
  for (let i = 0; i < count; i++) {
    const entry = text.slice(p, p + 20);
    p += 20;
    if (i === 0) continue;
    const [, off, gen, kind] = /^(\d{10}) (\d{5}) ([nf])/.exec(entry) || [];
    if (kind !== 'n') continue;
    const at = +off;
    const head = `${i} ${+gen} obj`;
    if (!text.startsWith(head, at)) throw new Error(`xref offset for object ${i} is wrong`);
    const end = text.indexOf('endobj', at);
    const body = text.slice(at + head.length, end);
    const si = body.indexOf('stream');
    const dict = (si >= 0 ? body.slice(0, si) : body).trim();
    let data = null;
    if (si >= 0) {
      const len = +/\/Length (\d+)/.exec(dict)[1];
      let start = at + head.length + si + 'stream'.length;
      if (text[start] === '\r') start++;
      if (text[start] === '\n') start++;
      data = buf.subarray(start, start + len);
      if (!text.startsWith('endstream', start + len + 1) && !text.startsWith('endstream', start + len)) throw new Error(`Stream length of object ${i} is wrong`);
      if (/\/Filter \/FlateDecode/.test(dict)) data = inflateSync(data);
    }
    objects.set(i, { dict, data });
  }
  const trailer = text.slice(text.indexOf('trailer', xrefAt));
  return { header, objects, trailer, count };
}

/** Objects whose dictionary matches a pattern. */
export function find(pdf, re) {
  return [...pdf.objects.values()].filter((o) => re.test(o.dict));
}

/** Each page's content stream, as text, in page order. */
export function pageContents(pdf) {
  return find(pdf, /\/Type \/Page\b/).map((p) => pdf.objects.get(+/\/Contents (\d+) 0 R/.exec(p.dict)[1]).data.toString('latin1'));
}

/** The parts of a zip file (stored or deflated) by name. */
export function unzip(bytes) {
  const buf = Buffer.from(bytes);
  let end = buf.length - 22;
  while (end >= 0 && buf.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error('Not a zip file');
  const n = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const out = new Map();
  for (let i = 0; i < n; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Bad zip directory');
    const method = buf.readUInt16LE(p + 10);
    const packed = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extra = buf.readUInt16LE(p + 30);
    const comment = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const lname = buf.readUInt16LE(local + 26);
    const lextra = buf.readUInt16LE(local + 28);
    const raw = buf.subarray(local + 30 + lname + lextra, local + 30 + lname + lextra + packed);
    out.set(name, method === 8 ? inflateRawSync(raw) : raw);
    p += 46 + nameLen + extra + comment;
  }
  return out;
}

/** Whether XML is well-formed: tags nest and close, attributes are quoted. Throws if not. */
export function checkXml(xml, name = 'XML') {
  const s = xml.replace(/^<\?xml[^?]*\?>/, '');
  const stack = [];
  const tag = /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"<]*"|'[^'<]*'))*)\s*(\/?)>/g;
  let at = 0;
  let m;
  while ((m = tag.exec(s))) {
    const between = s.slice(at, m.index);
    if (/[<>]/.test(between)) throw new Error(`${name}: stray < or > near ${between.slice(0, 40)}`);
    if (/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);)/i.test(between)) throw new Error(`${name}: bare & in text`);
    at = tag.lastIndex;
    if (m[1]) {
      if (stack.pop() !== m[2]) throw new Error(`${name}: </${m[2]}> closes the wrong element`);
    } else if (!m[4]) stack.push(m[2]);
  }
  if (/[<>]/.test(s.slice(at).trim())) throw new Error(`${name}: unparsed markup at the end`);
  if (stack.length) throw new Error(`${name}: <${stack.pop()}> is never closed`);
  return true;
}

/** Whether a command-line tool is installed (tests that use one skip that part without it). */
export function has(cmd, args = ['--version']) {
  try {
    execFileSync(cmd, args, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
