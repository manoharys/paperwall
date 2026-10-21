import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchUrl, authHeaders, readResults, cleanCredit, creditLine, creditText, licenseName } from '../../src/model/photos.js';
import { createDesign, createImage, addAsset, validateDesign } from '../../src/model/doc.js';
import { PROVIDERS } from '../../src/model/providers.js';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

test('[ON-01] [ON-02] each provider is searched at its own address, the key only in its own header', () => {
  assert.equal(searchUrl('openverse', ' red & blue ', 2), 'https://api.openverse.org/v1/images/?q=red%20%26%20blue&page=2&page_size=20');
  assert.equal(searchUrl('unsplash', 'cat', 1, 5), 'https://api.unsplash.com/search/photos?query=cat&page=1&per_page=5');
  assert.equal(searchUrl('pexels', 'cat', 3), 'https://api.pexels.com/v1/search?query=cat&page=3&per_page=20');
  assert.throws(() => searchUrl('claude', 'cat'));
  assert.deepEqual(authHeaders('openverse', 'x'), {});
  assert.deepEqual(authHeaders('unsplash', 'k'), { Authorization: 'Client-ID k' });
  assert.deepEqual(authHeaders('pexels', 'k'), { Authorization: 'k' });
  // Every address a search makes is one the page may reach.
  for (const id of ['openverse', 'unsplash', 'pexels']) assert.ok(PROVIDERS[id].hosts.some((h) => searchUrl(id, 'x').startsWith(`${h}/`)));
});

test('[ON-01] Openverse results: pictures through its own address, the full size asked for, credits kept', () => {
  const { photos, more } = readResults('openverse', {
    page_count: 3,
    results: [
      { id: 'abc-1', title: 'Pier', creator: 'Jo', license: 'by-sa', license_version: '4.0', license_url: 'https://creativecommons.org/licenses/by-sa/4.0/', foreign_landing_url: 'https://www.flickr.com/p/1', creator_url: 'http://insecure.example/jo', url: 'https://elsewhere.example/1.jpg' },
      { id: '../../etc', title: 'Bad id' },
    ],
  }, 1);
  assert.equal(more, true);
  assert.equal(photos.length, 1, 'odd ids are left out');
  assert.equal(photos[0].preview, 'https://api.openverse.org/v1/images/abc-1/thumb/');
  assert.equal(photos[0].full, 'https://api.openverse.org/v1/images/abc-1/thumb/?full_size=true');
  assert.equal(photos[0].fallback, photos[0].preview);
  assert.deepEqual(photos[0].credit, { provider: 'Openverse', title: 'Pier', creator: 'Jo', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', url: 'https://www.flickr.com/p/1' });
  assert.equal(readResults('openverse', { page_count: 3, results: [] }, 3).more, false);
  assert.equal(licenseName('cc0', '1.0'), 'CC0 1.0');
  assert.equal(licenseName('pdm', '1.0'), 'Public Domain Mark 1.0');
});

test('[ON-02] Unsplash and Pexels results: their own picture hosts only, credited as each asks', () => {
  const u = readResults('unsplash', { total_pages: 2, results: [
    { id: 'a', alt_description: 'hills', urls: { small: 'https://images.unsplash.com/a?w=400', regular: 'https://images.unsplash.com/a?w=1080' }, links: { html: 'https://unsplash.com/photos/a', download_location: 'https://api.unsplash.com/photos/a/download' }, user: { name: 'Ann', links: { html: 'https://unsplash.com/@ann' } } },
    { id: 'b', urls: { small: 'https://evil.example/b', regular: 'https://evil.example/b' }, links: {}, user: {} },
  ] }, 1);
  assert.equal(u.photos.length, 1);
  assert.equal(u.more, true);
  assert.equal(u.photos[0].full, 'https://images.unsplash.com/a?w=1080');
  assert.equal(u.photos[0].track, 'https://api.unsplash.com/photos/a/download');
  assert.equal(u.photos[0].credit.creatorUrl, 'https://unsplash.com/@ann?utm_source=paperwall&utm_medium=referral');
  assert.equal(creditLine(u.photos[0].credit), 'Photo by Ann on Unsplash');
  const p = readResults('pexels', { next_page: 'x', photos: [{ id: 9, alt: 'sea', photographer: 'Bo', photographer_url: 'https://www.pexels.com/@bo', url: 'https://www.pexels.com/photo/9/', src: { medium: 'https://images.pexels.com/9/m.jpg', large: 'https://images.pexels.com/9/l.jpg', large2x: 'https://images.pexels.com/9/l2.jpg' } }] }, 1);
  assert.equal(p.photos[0].full, 'https://images.pexels.com/9/l2.jpg');
  assert.equal(p.more, true);
  assert.equal(creditText(p.photos[0].credit), 'Photo by Bo on Pexels. https://www.pexels.com/photo/9/');
});

test('[ON-01] a credit is plain text and https links, in a design and in any file opened', () => {
  assert.equal(cleanCredit('nope'), null);
  assert.equal(cleanCredit({ title: '  ', url: 'ftp://x' }), null);
  assert.deepEqual(cleanCredit({ title: 'A\u0000\nB', creator: 42, url: 'javascript:alert(1)', licenseUrl: 'https://user:pw@x.example/', creatorUrl: 'https://ok.example/a b', extra: 'dropped' }), { title: 'A B', creatorUrl: 'https://ok.example/a%20b' });
  assert.equal(cleanCredit({ title: 'x'.repeat(1000) }).title.length, 300);

  const doc = createDesign({ width: 100, height: 100 });
  const id = addAsset(doc, { mime: 'image/png', dataUrl: PNG, width: 1, height: 1, credit: { provider: 'Openverse', title: 'T', url: 'https://a.example/', bad: 1 } });
  assert.deepEqual(doc.assets[id].credit, { provider: 'Openverse', title: 'T', url: 'https://a.example/' });
  doc.pages[0].elements.push(createImage(id, { w: 10, h: 10 }));
  // A file someone else made, with a credit that isn't plain.
  doc.assets[id].credit = { title: { toString: 'x' }, creator: '<b>Ann</b>', url: 'data:text/html,hi', license: 'CC BY 4.0' };
  validateDesign(doc);
  assert.deepEqual(doc.assets[id].credit, { creator: '<b>Ann</b>', license: 'CC BY 4.0' }, 'kept as text (shown as text), never as a link');
  doc.assets[id].credit = 'just a string';
  validateDesign(doc);
  assert.equal(doc.assets[id].credit, undefined);
  assert.equal(creditText({ provider: 'Openverse', title: 'T', creator: 'C', license: 'CC0 1.0', licenseUrl: 'https://l.example/', url: 'https://s.example/' }), '"T" by C, CC0 1.0 (via Openverse). https://s.example/ · License: https://l.example/');
});
