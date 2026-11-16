// A design inside a link. The part of a link after # is never sent to any
// server, so the design itself travels there, compressed: sharing needs no
// upload and no account, and opening the link opens a copy.

import { deflate, inflate } from './deflate.js';
import { keptAssets } from './doc.js';

export const SHARE_PREFIX = '#share=';
/** The longest link offered: it still fits a chat message or an email. */
export const MAX_LINK = 64000;
/** The most a shared design may unpack to: far more than any real link holds. */
const MAX_UNPACKED = 4 * 1024 * 1024;
/** The most a shared design may hold, and how deep its groups may go. */
const MAX_PAGES = 500;
const MAX_ELEMENTS = 20000;
const MAX_DEPTH = 40;

function toBase64Url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text) {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** The link that carries `doc`, on the page at `base`: { link, fits }. */
export function shareLink(doc, base) {
  const kept = keptAssets(doc);
  // Photos and videos hardly compress: when they alone can't fit, don't pack it all to find out.
  const media = Object.values(kept.assets || {}).reduce((n, a) => n + (typeof a?.dataUrl === 'string' ? a.dataUrl.length : 0), 0);
  if (media * 0.7 > MAX_LINK) return { link: null, fits: false };
  const packed = deflate(new TextEncoder().encode(JSON.stringify(kept)));
  const link = `${String(base).split('#')[0]}${SHARE_PREFIX}${toBase64Url(packed)}`;
  return { link, fits: link.length <= MAX_LINK };
}

/**
 * The design a location hash carries: null when it isn't a shared link, and
 * an error when it is one that can't be read. (The design still needs
 * validateDesign, like any file from anyone.)
 */
export function readShareHash(hash) {
  if (typeof hash !== 'string' || !hash.startsWith(SHARE_PREFIX)) return null;
  try {
    if (hash.length > MAX_LINK) throw new Error('too long');
    const text = new TextDecoder('utf-8', { fatal: true }).decode(inflate(fromBase64Url(hash.slice(SHARE_PREFIX.length)), { max: MAX_UNPACKED }));
    const doc = JSON.parse(text);
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new Error('not a design');
    if (tooMuch(doc)) throw new Error('too much');
    return doc;
  } catch {
    throw new Error('This link does not hold a design that can be opened');
  }
}

/** Whether a design is more than any real one: a link made to slow the page down. */
function tooMuch(doc) {
  if (Array.isArray(doc.pages) && doc.pages.length > MAX_PAGES) return true;
  let count = 0;
  const visit = (els, depth) => {
    if (!Array.isArray(els)) return false;
    if (depth > MAX_DEPTH) return true;
    for (const el of els) {
      if (++count > MAX_ELEMENTS) return true;
      if (el && typeof el === 'object' && el.children && visit(el.children, depth + 1)) return true;
    }
    return false;
  };
  return (doc.pages || []).some((p) => p && typeof p === 'object' && visit(p.elements, 0));
}
