// Generated stickers: decorative drawings made in code for Paperwall (CC0).
// Each design comes in several colorways. Drawn on a 100 × 100 grid.

const COLORWAYS = [
  { id: 'ember', name: 'Ember', c: ['#f25c2a', '#ffd166', '#16161d', '#fff3e6'] },
  { id: 'lagoon', name: 'Lagoon', c: ['#0a9396', '#94d2bd', '#005f73', '#e9f5f2'] },
  { id: 'berry', name: 'Berry', c: ['#d1495b', '#ffb3c1', '#590d22', '#fff0f3'] },
  { id: 'night', name: 'Night', c: ['#3a86ff', '#8ecae6', '#14213d', '#eaf4ff'] },
  { id: 'forest', name: 'Forest', c: ['#52b788', '#d8f3dc', '#1b4332', '#f1faee'] },
  { id: 'mono', name: 'Mono', c: ['#16161d', '#9a9aab', '#16161d', '#ffffff'] },
];

const f = (n) => Math.round(n * 100) / 100;

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** A smooth closed blob through n points around the center. */
function blobPath(seed, n = 7, wobble = 0.22) {
  const r = rng(seed);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rad = 40 * (1 - wobble + r() * wobble * 2);
    pts.push([50 + Math.cos(a) * rad, 50 + Math.sin(a) * rad]);
  }
  let d = '';
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    if (i === 0) d += `M${f(p1[0])} ${f(p1[1])}`;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(p2[0])} ${f(p2[1])}`;
  }
  return d + ' Z';
}

function burst(points, inner, cx = 50, cy = 50, r = 46) {
  const pts = [];
  for (let i = 0; i < points * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    const rr = i % 2 ? r * inner : r;
    pts.push(`${f(cx + Math.cos(a) * rr)} ${f(cy + Math.sin(a) * rr)}`);
  }
  return `M${pts.join(' L')} Z`;
}

function scallop(n, cx = 50, cy = 50, r = 40, bump = 6) {
  let d = '';
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) d = `M${f(x)} ${f(y)}`;
    else {
      const am = ((i - 0.5) / n) * Math.PI * 2;
      d += ` Q${f(cx + Math.cos(am) * (r + bump * 2))} ${f(cy + Math.sin(am) * (r + bump * 2))} ${f(x)} ${f(y)}`;
    }
  }
  return d + ' Z';
}

function petals(n, len, width, color, cx = 50, cy = 50) {
  let out = '';
  for (let i = 0; i < n; i++) {
    out += `<ellipse cx="${cx}" cy="${f(cy - len / 2)}" rx="${width}" ry="${f(len / 2)}" fill="${color}" transform="rotate(${f((360 / n) * i)} ${cx} ${cy})"/>`;
  }
  return out;
}

// Each design: (colors, seed) => svg markup. c = [main, light, dark, paper].
const DESIGNS = [
  { id: 'blob', name: 'Blob', tags: 'shape organic background soft', draw: (c, s) => `<path d="${blobPath(s * 7 + 1)}" fill="${c[0]}"/>` },
  { id: 'blob-duo', name: 'Layered blob', tags: 'shape organic background', draw: (c, s) => `<path d="${blobPath(s * 11 + 3)}" fill="${c[1]}"/><path d="${blobPath(s * 13 + 5, 6, 0.18)}" fill="${c[0]}" transform="translate(12 12) scale(.76)"/>` },
  { id: 'seal', name: 'Seal', tags: 'badge award sale new quality', draw: (c) => `<path d="${scallop(16)}" fill="${c[0]}"/><circle cx="50" cy="50" r="31" fill="none" stroke="${c[3]}" stroke-width="2" stroke-dasharray="3 3"/>` },
  { id: 'starburst', name: 'Starburst', tags: 'badge sale offer explosion', draw: (c) => `<path d="${burst(18, 0.8)}" fill="${c[0]}"/><path d="${burst(18, 0.8, 50, 50, 36)}" fill="${c[1]}"/>` },
  { id: 'rosette', name: 'Rosette', tags: 'award winner ribbon prize', draw: (c) => `<path d="M38 60 30 96 44 88 50 98 52 64Z" fill="${c[2]}"/><path d="M62 60 70 96 56 88 50 98 48 64Z" fill="${c[2]}"/><path d="${scallop(14, 50, 42, 30, 5)}" fill="${c[0]}"/><circle cx="50" cy="42" r="20" fill="${c[1]}"/>` },
  { id: 'ribbon-wide', name: 'Wide ribbon', tags: 'banner label title', draw: (c) => `<path d="M0 34h14v34H0l7-17z" fill="${c[2]}"/><path d="M100 34H86v34h14l-7-17z" fill="${c[2]}"/><path d="M8 28h84v34H8z" fill="${c[0]}"/>` },
  { id: 'tag', name: 'Label', tags: 'price tag label sale shop', draw: (c) => `<path d="M8 50 34 22h58v56H34z" fill="${c[0]}"/><circle cx="30" cy="50" r="6" fill="${c[3]}"/>` },
  { id: 'arrow-curve', name: 'Curved arrow', tags: 'arrow pointer doodle hand drawn', draw: (c) => `<path d="M12 82C20 44 50 22 84 26" fill="none" stroke="${c[0]}" stroke-width="5" stroke-linecap="round"/><path d="M70 14l16 12-13 15" fill="none" stroke="${c[0]}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>` },
  { id: 'arrow-loop', name: 'Loop arrow', tags: 'arrow pointer doodle fun', draw: (c) => `<path d="M10 70c18 6 30-6 26-18s-18-8-14 4 26 18 54 6" fill="none" stroke="${c[0]}" stroke-width="4.5" stroke-linecap="round"/><path d="M70 50l12 12-16 6" fill="none" stroke="${c[0]}" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>` },
  { id: 'circle-scribble', name: 'Hand-drawn circle', tags: 'highlight doodle circle mark', draw: (c) => `<path d="M20 52C16 30 38 14 62 16c22 2 30 18 26 36-4 20-26 32-50 30C20 80 8 64 14 44c4-14 18-24 34-28" fill="none" stroke="${c[0]}" stroke-width="3.5" stroke-linecap="round"/>` },
  { id: 'underline-scribble', name: 'Scribble underline', tags: 'highlight doodle underline', draw: (c) => `<path d="M6 58c16-8 30-8 44-2s30 6 44-2M10 70c22-6 46-6 76-2" fill="none" stroke="${c[0]}" stroke-width="4.5" stroke-linecap="round"/>` },
  { id: 'highlight', name: 'Marker highlight', tags: 'highlight marker brush stroke', draw: (c) => `<path d="M6 38c30-4 60-6 88-2l-2 26c-28-4-58-2-86 2z" fill="${c[1]}" opacity=".85"/>` },
  { id: 'sparkle-trio', name: 'Sparkles', tags: 'shine star magic new', draw: (c) => `<path d="M38 12l5 20 20 5-20 5-5 20-5-20-20-5 20-5z" fill="${c[0]}"/><path d="M74 52l3 11 11 3-11 3-3 11-3-11-11-3 11-3z" fill="${c[1]}"/><path d="M76 12l2 7 7 2-7 2-2 7-2-7-7-2 7-2z" fill="${c[0]}"/>` },
  { id: 'flower', name: 'Flower', tags: 'flower spring nature garden', draw: (c) => `${petals(8, 40, 9, c[0])}<circle cx="50" cy="50" r="10" fill="${c[1]}"/>` },
  { id: 'daisy', name: 'Daisy', tags: 'flower daisy spring', draw: (c) => `${petals(14, 44, 6, c[3] === '#ffffff' ? '#f4f4f4' : c[3])}<circle cx="50" cy="50" r="12" fill="${c[0]}"/>` },
  { id: 'sun', name: 'Sun', tags: 'sun summer weather happy', draw: (c) => `${Array.from({ length: 12 }, (_, i) => `<rect x="47" y="4" width="6" height="16" rx="3" fill="${c[0]}" transform="rotate(${i * 30} 50 50)"/>`).join('')}<circle cx="50" cy="50" r="22" fill="${c[0]}"/>` },
  { id: 'cloud', name: 'Cloud', tags: 'cloud sky weather', draw: (c) => `<path d="M24 74a16 16 0 0 1-1-32 22 22 0 0 1 42-6 16 16 0 0 1 14 38z" fill="${c[1]}"/>` },
  { id: 'mountains', name: 'Mountains', tags: 'mountain travel outdoor nature', draw: (c) => `<path d="M0 86 32 38l22 30 14-18 32 36z" fill="${c[0]}"/><path d="M32 38l-8 12h16z" fill="${c[3]}"/>` },
  { id: 'waves', name: 'Waves', tags: 'wave sea water divider', draw: (c) => `<path d="M0 50c12-10 25-10 37 0s25 10 37 0 19-8 26-4V100H0z" fill="${c[0]}"/><path d="M0 68c12-8 25-8 37 0s25 8 37 0 19-6 26-3V100H0z" fill="${c[1]}"/>` },
  { id: 'dots', name: 'Dot pattern', tags: 'pattern texture background dots', draw: (c) => Array.from({ length: 36 }, (_, i) => `<circle cx="${10 + (i % 6) * 16}" cy="${10 + Math.floor(i / 6) * 16}" r="3.5" fill="${c[0]}"/>`).join('') },
  { id: 'stripes', name: 'Stripes', tags: 'pattern texture background lines', draw: (c) => Array.from({ length: 8 }, (_, i) => `<rect x="${i * 13}" y="0" width="6" height="100" fill="${c[0]}" transform="skewX(-20) translate(18 0)"/>`).join('') },
  { id: 'zigzag', name: 'Zigzag', tags: 'pattern memphis fun line', draw: (c) => `<path d="M4 50 16 34 28 50 40 34 52 50 64 34 76 50 88 34 96 44" fill="none" stroke="${c[0]}" stroke-width="6" stroke-linejoin="round" stroke-linecap="round"/>` },
  { id: 'memphis', name: 'Memphis shapes', tags: 'memphis geometric fun 80s pattern', draw: (c) => `<circle cx="22" cy="24" r="12" fill="${c[0]}"/><path d="M60 12l22 38H38z" fill="${c[1]}"/><rect x="14" y="58" width="26" height="26" fill="none" stroke="${c[2]}" stroke-width="5" transform="rotate(14 27 71)"/><path d="M56 78c6-8 12-8 18 0s12 8 18 0" fill="none" stroke="${c[0]}" stroke-width="5" stroke-linecap="round"/>` },
  { id: 'confetti-burst', name: 'Confetti', tags: 'party celebrate birthday confetti', draw: (c, s) => {
    const r = rng(s * 17 + 9);
    return Array.from({ length: 22 }, (_, i) => {
      const x = f(8 + r() * 84);
      const y = f(8 + r() * 84);
      const col = c[i % 3];
      return i % 3 ? `<rect x="${x}" y="${y}" width="9" height="4" rx="2" fill="${col}" transform="rotate(${f(r() * 180)} ${x} ${y})"/>` : `<circle cx="${x}" cy="${y}" r="3" fill="${col}"/>`;
    }).join('');
  } },
  { id: 'heart', name: 'Heart', tags: 'love valentine heart', draw: (c) => `<path d="M50 88C24 68 8 54 8 36 8 22 19 12 32 12c8 0 14 4 18 11 4-7 10-11 18-11 13 0 24 10 24 24 0 18-16 32-42 52z" fill="${c[0]}"/>` },
  { id: 'speech', name: 'Speech bubble', tags: 'comment talk quote bubble', draw: (c) => `<path d="M50 12c24 0 42 13 42 30S74 72 50 72c-5 0-10-.6-14-1.7L16 84l6-17C13 61 8 52 8 42c0-17 18-30 42-30z" fill="${c[0]}"/>` },
  { id: 'frame-round', name: 'Round frame', tags: 'frame border circle', draw: (c) => `<circle cx="50" cy="50" r="44" fill="none" stroke="${c[0]}" stroke-width="5"/><circle cx="50" cy="50" r="37" fill="none" stroke="${c[1]}" stroke-width="2"/>` },
  { id: 'frame-corners', name: 'Corner frame', tags: 'frame border elegant', draw: (c) => `<path d="M6 30V6h24M70 6h24v24M94 70v24H70M30 94H6V70" fill="none" stroke="${c[0]}" stroke-width="3"/>` },
  { id: 'divider-ornate', name: 'Ornament divider', tags: 'divider line ornament elegant wedding', draw: (c) => `<path d="M4 50h34M62 50h34" stroke="${c[0]}" stroke-width="2"/><path d="M50 40l10 10-10 10-10-10z" fill="${c[0]}"/><circle cx="38" cy="50" r="3" fill="${c[0]}"/><circle cx="62" cy="50" r="3" fill="${c[0]}"/>` },
  { id: 'leaves', name: 'Leaves', tags: 'leaf nature botanical eco plant', draw: (c) => `<path d="M14 90C34 66 56 40 88 12" fill="none" stroke="${c[2]}" stroke-width="3" stroke-linecap="round"/><path d="M30 72c-12-2-18-10-18-20 12 0 18 8 18 20zM46 54c-12-2-18-10-18-20 12 0 18 8 18 20zM62 36c-12-2-18-10-18-20 12 0 18 8 18 20zM38 66c2-12 10-18 20-18 0 12-8 18-20 18zM54 48c2-12 10-18 20-18 0 12-8 18-20 18z" fill="${c[0]}"/>` },
];

export const GENERATED_STICKERS = DESIGNS.flatMap((d, di) => COLORWAYS.map((cw, ci) => ({
  id: `${d.id}-${cw.id}`,
  name: `${d.name} (${cw.name.toLowerCase()})`,
  tags: `${d.tags} ${cw.name.toLowerCase()}`,
  svg: d.draw(cw.c, di * 10 + ci + 1),
})));
