// A small PDF writer: one JPEG image per page. Enough for print-quality PDFs
// with no dependencies. (PDFs with selectable text are on the roadmap.)

const enc = new TextEncoder();

/** Points (1/72 in) for a page that is `px` pixels at `dpi`. */
export function pxToPt(px, dpi = 96) {
  return (px / dpi) * 72;
}

/**
 * pages: [{ jpeg: Uint8Array, pxWidth, pxHeight, ptWidth, ptHeight }]
 * Returns the PDF file as a Uint8Array.
 */
export function buildPdf(pages, { title = 'Placard design' } = {}) {
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

  // Objects: 1 catalog, 2 page tree, 3 info, then 3 per page (page, content, image).
  const first = 4;
  const kids = pages.map((_, i) => `${first + i * 3} 0 R`).join(' ');
  write('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  obj(3, `<< /Title (${pdfString(title)}) /Producer (Placard) >>`);
  pages.forEach((p, i) => {
    const pageNo = first + i * 3;
    const w = round(p.ptWidth);
    const h = round(p.ptHeight);
    const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
    obj(pageNo, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${pageNo + 2} 0 R >> >> /Contents ${pageNo + 1} 0 R >>`);
    obj(pageNo + 1, [`<< /Length ${content.length} >>\nstream\n`, content, '\nendstream']);
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

function round(n) {
  return Math.round(n * 100) / 100;
}

function pdfString(s) {
  return String(s).replace(/[^\x20-\x7e]/g, '').replace(/([\\()])/g, '\\$1');
}
