// What a JPEG file says about itself, read from its markers (JPEG, JFIF and
// Exif specs): size, color channels, and which way up it goes. A PDF or a
// PowerPoint file can carry a JPEG as it is, but only when nothing else
// (like an Exif turn, which browsers apply) changes how it looks.

/**
 * { width, height, components, progressive, inverted, orientation }, or null
 * when the bytes aren't a JPEG we can pass along as they are.
 */
export function jpegInfo(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const info = { orientation: 1, inverted: false };
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    if (marker === 0xff) {
      i++; // fill byte
      continue;
    }
    i += 2;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (marker === 0xd9 || marker === 0xda) break;
    const len = (bytes[i] << 8) | bytes[i + 1];
    if (len < 2 || i + len > bytes.length) return null;
    const seg = bytes.subarray(i + 2, i + len);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      // Baseline, extended and progressive Huffman only (what every PDF reader decodes).
      if (marker > 0xc2) return null;
      if (seg[0] !== 8) return null;
      info.height = (seg[1] << 8) | seg[2];
      info.width = (seg[3] << 8) | seg[4];
      info.components = seg[5];
      info.progressive = marker === 0xc2;
    } else if (marker === 0xee && seg.length >= 12 && String.fromCharCode(...seg.subarray(0, 5)) === 'Adobe') {
      info.inverted = true;
    } else if (marker === 0xe1 && seg.length > 14 && String.fromCharCode(...seg.subarray(0, 4)) === 'Exif') {
      info.orientation = exifOrientation(seg.subarray(6)) || 1;
    }
    i += len;
  }
  if (!(info.width > 0 && info.height > 0) || ![1, 3, 4].includes(info.components)) return null;
  return info;
}

/** The Orientation tag (1..8) of an Exif TIFF block, if it has one. */
function exifOrientation(t) {
  if (t.length < 8) return 0;
  const le = t[0] === 0x49;
  const u16 = (p) => (le ? t[p] | (t[p + 1] << 8) : (t[p] << 8) | t[p + 1]);
  const u32 = (p) => (le ? (t[p] | (t[p + 1] << 8) | (t[p + 2] << 16) | (t[p + 3] << 24)) >>> 0 : ((t[p] << 24) | (t[p + 1] << 16) | (t[p + 2] << 8) | t[p + 3]) >>> 0);
  const ifd = u32(4);
  if (ifd + 2 > t.length) return 0;
  const n = u16(ifd);
  for (let k = 0; k < n; k++) {
    const e = ifd + 2 + k * 12;
    if (e + 12 > t.length) return 0;
    if (u16(e) === 0x0112) return u16(e + 8);
  }
  return 0;
}
