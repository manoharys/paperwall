// Stock photos (an online extra, off until turned on): what each provider is
// asked, what its answers mean, and the credit every photo keeps. Pure: the
// app does the fetching (src/app/photos.js).

import { PROVIDERS } from './providers.js';

/** Photos asked for at a time. */
export const PAGE_SIZE = 20;

/** The address that searches a provider's photos (pages count from 1). */
export function searchUrl(provider, query, page = 1, perPage = PAGE_SIZE) {
  const q = encodeURIComponent(String(query || '').trim());
  if (provider === 'openverse') return `https://api.openverse.org/v1/images/?q=${q}&page=${page}&page_size=${perPage}`;
  if (provider === 'unsplash') return `https://api.unsplash.com/search/photos?query=${q}&page=${page}&per_page=${perPage}`;
  if (provider === 'pexels') return `https://api.pexels.com/v1/search?query=${q}&page=${page}&per_page=${perPage}`;
  throw new Error(`${provider} doesn't search photos`);
}

/** The headers that carry the person's key (only ever to the provider's own API). */
export function authHeaders(provider, key) {
  if (provider === 'unsplash') return { Authorization: `Client-ID ${key}` };
  if (provider === 'pexels') return { Authorization: key };
  return {};
}

/** Unsplash asks for links back to it to say where they came from. */
const UTM = 'utm_source=paperwall&utm_medium=referral';
const tagged = (url) => (url ? `${url}${url.includes('?') ? '&' : '?'}${UTM}` : url);

/** "CC BY 2.0", "CC0 1.0" and so on, from Openverse's codes. */
export function licenseName(code, version) {
  const c = String(code || '').toLowerCase();
  const v = version ? ` ${version}` : '';
  if (!c) return '';
  if (c === 'cc0') return `CC0${v}`;
  if (c === 'pdm') return `Public Domain Mark${v}`;
  return `CC ${c.toUpperCase()}${v}`;
}

/**
 * A provider's answer as { photos, more }. Each photo: { id, preview (a
 * small picture for the list), full (what's added), fallback (used if
 * `full` can't be had), track (an address to tell the provider it was used),
 * credit }. Only pictures on the provider's own hosts are kept.
 */
export function readResults(provider, json, page = 1) {
  const own = (url) => typeof url === 'string' && PROVIDERS[provider].hosts.some((h) => h.startsWith('https://') && url.startsWith(`${h}/`));
  let photos = [];
  let more = false;
  if (provider === 'openverse') {
    photos = (json?.results || []).filter((r) => typeof r?.id === 'string' && /^[\w-]+$/.test(r.id)).map((r) => {
      // Openverse shows every picture through its own address, wherever it's
      // from: a small one by default, the original size when asked.
      const thumb = `https://api.openverse.org/v1/images/${r.id}/thumb/`;
      return {
        id: r.id, preview: thumb, full: `${thumb}?full_size=true`, fallback: thumb,
        credit: cleanCredit({ provider: 'Openverse', title: r.title, creator: r.creator, creatorUrl: r.creator_url, license: licenseName(r.license, r.license_version), licenseUrl: r.license_url, url: r.foreign_landing_url }),
      };
    });
    more = page < (+json?.page_count || 0);
  } else if (provider === 'unsplash') {
    photos = (json?.results || []).filter((r) => r && own(r.urls?.small) && own(r.urls?.regular)).map((r) => ({
      id: String(r.id), preview: r.urls.small, full: r.urls.regular, track: own(r.links?.download_location) ? r.links.download_location : null,
      credit: cleanCredit({ provider: 'Unsplash', title: r.alt_description || r.description, creator: r.user?.name, creatorUrl: tagged(r.user?.links?.html), license: 'Unsplash License', licenseUrl: 'https://unsplash.com/license', url: tagged(r.links?.html) }),
    }));
    more = page < (+json?.total_pages || 0);
  } else if (provider === 'pexels') {
    photos = (json?.photos || []).filter((p) => p && own(p.src?.medium) && own(p.src?.large2x || p.src?.large)).map((p) => ({
      id: String(p.id), preview: p.src.medium, full: own(p.src.large2x) ? p.src.large2x : p.src.large,
      credit: cleanCredit({ provider: 'Pexels', title: p.alt, creator: p.photographer, creatorUrl: p.photographer_url, license: 'Pexels License', licenseUrl: 'https://www.pexels.com/license/', url: p.url }),
    }));
    more = !!json?.next_page;
  }
  return { photos, more };
}

const TEXT = ['provider', 'title', 'creator', 'license'];
const LINKS = ['creatorUrl', 'licenseUrl', 'url'];

/** A line of plain text: no control characters, not too long. */
function plain(v, max = 300) {
  return typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

/** A web address, only if it's https. */
function https(v) {
  if (typeof v !== 'string' || v.length > 2000) return '';
  try {
    const u = new URL(v);
    return u.protocol === 'https:' && !u.username && !u.password ? u.href : '';
  } catch {
    return '';
  }
}

/**
 * A photo's credit as kept in a design: plain strings and https links only
 * (files can come from anyone). Null when there's nothing to keep.
 */
export function cleanCredit(c) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) return null;
  const out = {};
  for (const k of TEXT) if (plain(c[k])) out[k] = plain(c[k]);
  for (const k of LINKS) if (https(c[k])) out[k] = https(c[k]);
  return Object.keys(out).length ? out : null;
}

/** The credit as one short line ("Photo by Ann on Unsplash"). */
export function creditLine(c) {
  if (!c) return '';
  if ((c.provider === 'Unsplash' || c.provider === 'Pexels') && c.creator) return `Photo by ${c.creator} on ${c.provider}`;
  const what = c.title ? `"${c.title}"` : 'Photo';
  return `${what}${c.creator ? ` by ${c.creator}` : ''}${c.license ? `, ${c.license}` : ''}`;
}

/** The credit to paste wherever the design goes: the line, then its links. */
export function creditText(c) {
  if (!c) return '';
  const links = [];
  if (c.url) links.push(c.url);
  if (c.licenseUrl && c.provider !== 'Unsplash' && c.provider !== 'Pexels') links.push(`License: ${c.licenseUrl}`);
  const via = c.provider && c.provider !== 'Unsplash' && c.provider !== 'Pexels' ? ` (via ${c.provider})` : '';
  return `${creditLine(c)}${via}${links.length ? `. ${links.join(' · ')}` : ''}`;
}
