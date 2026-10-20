// A small PDF writer: one JPEG image per page, with an invisible text layer
// on top so the text can be selected, searched and copied. No dependencies.

const enc = new TextEncoder();

/** Points (1/72 in) for a page that is `px` pixels at `dpi`. */
export function pxToPt(px, dpi = 96) {
  return (px / dpi) * 72;
}

// Glyph widths of Helvetica (a standard PDF font, never embedded) for
// printable ASCII, in 1/1000 em. Used to stretch the invisible text layer so
// selections line up with the text in the picture.
const HELVETICA = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015,
  667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611,
  278, 278, 278, 469, 556, 333,
  556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500,
  334, 260, 334, 584];

export function helveticaWidth(text, size) {
  let w = 0;
  for (const ch of text) {
    const c = ch.charCodeAt(0);
    w += c >= 32 && c <= 126 ? HELVETICA[c - 32] : 556;
  }
  return (w * size) / 1000;
}

/** Text that Helvetica with WinAnsi encoding can carry; other characters become '?'. */
export function pdfText(s) {
  return String(s).replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/[\u2013\u2014]/g, '-').replace(/\u2022/g, '*')
    .replace(/[^\x20-\x7e\xa0-\xff]/g, '?').replace(/([\\()])/g, '\\$1');
}

/**
 * Invisible, selectable text: runs of { text, x, y, size, width, angle } in
 * points, with (x, y) the left end of the baseline measured from the top-left.
 */
function textLayer(runs, pageHeight) {
  const ops = [];
  for (const r of runs) {
    const text = pdfText(r.text);
    if (!text.trim()) continue;
    const natural = helveticaWidth(r.text, r.size) || 1;
    const scale = Math.max(1, Math.min(1000, (r.width / natural) * 100));
    const a = ((r.angle || 0) * Math.PI) / 180;
    const cos = round(Math.cos(a));
    const sin = round(Math.sin(a));
    // PDF's y axis points up; rotation is clockwise on the page.
    ops.push(`BT 3 Tr /F1 ${round(r.size)} Tf ${round(scale)} Tz ${cos} ${-sin} ${sin} ${cos} ${round(r.x)} ${round(pageHeight - r.y)} Tm (${text}) Tj ET`);
  }
  return ops.join('\n');
}

/**
 * pages: [{ jpeg: Uint8Array, pxWidth, pxHeight, ptWidth, ptHeight, text?: runs }]
 * Returns the PDF file as a Uint8Array.
 */
export function buildPdf(pages, { title = 'Paperwall design' } = {}) {
  if (!pages.length) throw new Error('A PDF needs at least one page');
  const chunks = [];
  const offsets = [];
  let length = 0;
  const write = (data) => {
    const bytes = typeof data === 'string' ? enc.encode(data) : data;
    chunks.push(bytes);
    length += bytes.length;
  };
  const obj = (n, body) => {
    offsets[n] = length;
    write(`${n} 0 obj\n`);
    for (const part of [].concat(body)) write(part);
    write('\nendobj\n');
  };

  // Objects: 1 catalog, 2 page tree, 3 info, 4 font, then 3 per page (page, content, image).
  const first = 5;
  const kids = pages.map((_, i) => `${first + i * 3} 0 R`).join(' ');
  write('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  obj(3, `<< /Title (${pdfString(title)}) /Producer (Paperwall) >>`);
  obj(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  pages.forEach((p, i) => {
    const pageNo = first + i * 3;
    const w = round(p.ptWidth);
    const h = round(p.ptHeight);
    const layer = p.text?.length ? `\n${textLayer(p.text, h)}` : '';
    const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q${layer}`;
    obj(pageNo, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${pageNo + 2} 0 R >> /Font << /F1 4 0 R >> >> /Contents ${pageNo + 1} 0 R >>`);
    const bytes = latin1(content);
    obj(pageNo + 1, [`<< /Length ${bytes.length} >>\nstream\n`, bytes, '\nendstream']);
    obj(pageNo + 2, [
      `<< /Type /XObject /Subtype /Image /Width ${p.pxWidth} /Height ${p.pxHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`,
      p.jpeg,
      '\nendstream',
    ]);
  });
  const count = first + pages.length * 3;
  const xref = length;
  let table = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let i = 1; i < count; i++) table += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  write(table);
  write(`trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }
  return out;
}

function latin1(s) {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

function round(n) {
  return Math.round(n * 100) / 100;
}

function pdfString(s) {
  return String(s).replace(/[^\x20-\x7e]/g, '').replace(/([\\()])/g, '\\$1');
}
