import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shareLink, readShareHash, MAX_LINK, SHARE_PREFIX } from '../../src/model/share-link.js';
import { deflate, inflate } from '../../src/model/deflate.js';
import { validateDesign } from '../../src/model/doc.js';
import { TEMPLATES, templateDoc } from '../../src/templates/index.js';

const BASE = 'https://example.org/paperwall/';

test('[DOC-13] a design goes into a link and comes back the same', () => {
  const doc = templateDoc(TEMPLATES[0]);
  const { link, fits } = shareLink(doc, `${BASE}#/d/${doc.id}`);
  assert.ok(fits, `${link.length} characters`);
  assert.ok(link.startsWith(`${BASE}${SHARE_PREFIX}`), 'on the same page, its own place swapped for the design');
  assert.match(link.slice(link.indexOf('#')), /^#share=[A-Za-z0-9_-]+$/, 'only characters a link keeps as they are');
  const back = readShareHash(link.slice(link.indexOf('#')));
  assert.deepEqual(back, JSON.parse(JSON.stringify(doc)));
  validateDesign(back);
});

test('[DOC-13] every template fits in a link', () => {
  for (const t of TEMPLATES) {
    const { link, fits } = shareLink(templateDoc(t), BASE);
    assert.ok(fits, `${t.id}: ${link.length} of ${MAX_LINK}`);
  }
});

test('[DOC-13] a design too big for a link says so instead of making one that breaks', () => {
  const doc = templateDoc(TEMPLATES[0]);
  // A photo's worth of bytes that don't compress.
  const bytes = new Uint8Array(200000);
  for (let i = 0; i < bytes.length; i += 65536) crypto.getRandomValues(bytes.subarray(i, i + 65536));
  const noise = btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''));
  doc.assets = { photo: { type: 'image', dataUrl: `data:image/jpeg;base64,${noise}` } };
  doc.pages[0].elements.push({ id: 'pic', type: 'image', assetId: 'photo', x: 0, y: 0, w: 10, h: 10, rotation: 0, opacity: 1 });
  assert.deepEqual(shareLink(doc, BASE), { link: null, fits: false }, 'told without packing it all first');
});

test('[DOC-13] a link that is not a design, or is damaged, is turned away with a plain message', () => {
  assert.equal(readShareHash('#/d/abc'), null, 'an ordinary place in the app');
  assert.equal(readShareHash(''), null);
  for (const bad of ['#share=', '#share=@@@', '#share=AAAA', `#share=${btoa('not compressed')}`]) {
    assert.throws(() => readShareHash(bad), /does not hold a design/, bad);
  }
  // Valid compression, but not a design object.
  const notDoc = btoa(String.fromCharCode(...deflate(new TextEncoder().encode('[1,2,3]')))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  assert.throws(() => readShareHash(`#share=${notDoc}`), /does not hold a design/);
});

const hashOf = (value) => `#share=${btoa(String.fromCharCode(...deflate(new TextEncoder().encode(JSON.stringify(value))))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;

test('[DOC-13] a tiny link can not unpack into something huge', () => {
  // A valid design object, padded out to 5 MB: only the cap stops it.
  const hash = hashOf({ version: 1, width: 10, height: 10, pages: [{ elements: [] }], name: 'x'.repeat(5 * 1024 * 1024) });
  assert.ok(hash.length < 64000, `a short link: ${hash.length}`);
  assert.throws(() => readShareHash(hash), /does not hold a design/);
  assert.throws(() => inflate(deflate(new Uint8Array(4096)), { max: 1024 }), /too big/);
  assert.equal(inflate(deflate(new Uint8Array(500)), { max: 500 }).length, 500, 'right at the cap is fine');
});

test('[DOC-13] a link made to slow the page down is turned away: too long, too many elements, too deep', () => {
  assert.throws(() => readShareHash(`#share=${'A'.repeat(MAX_LINK + 1)}`), /does not hold a design/);
  const rect = { id: 'r', type: 'shape', x: 0, y: 0, w: 1, h: 1 };
  assert.throws(() => readShareHash(hashOf({ pages: [{ elements: Array.from({ length: 20001 }, () => rect) }] })), /does not hold a design/);
  assert.throws(() => readShareHash(hashOf({ pages: Array.from({ length: 501 }, () => ({ elements: [] })) })), /does not hold a design/);
  let deep = rect;
  for (let i = 0; i < 60; i++) deep = { id: `g${i}`, type: 'group', children: [deep] };
  assert.throws(() => readShareHash(hashOf({ pages: [{ elements: [deep] }] })), /does not hold a design/);
  // An ordinary design with groups is fine.
  let shallow = rect;
  for (let i = 0; i < 5; i++) shallow = { id: `g${i}`, type: 'group', children: [shallow] };
  assert.ok(readShareHash(hashOf({ pages: [{ elements: [shallow] }] })));
});
