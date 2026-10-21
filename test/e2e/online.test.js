import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { openApp, newDesign, waitForEditor, state, elements, teardown, openTab, makePng } from './helpers.js';

after(teardown);

// There's no real network here: every provider is a stand-in, answering
// from these routes. Each request is noted, with its headers.

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'authorization, x-api-key, anthropic-version, anthropic-dangerous-direct-browser-access, content-type',
};

const json = (route, body, status = 200) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) });
const picture = (route, buffer) => route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'image/png' }, body: buffer });

function openverseResults(page, count = 20) {
  return {
    result_count: 40, page_count: 2, page_size: count, page,
    results: Array.from({ length: count }, (_, i) => {
      const n = (page - 1) * count + i;
      return {
        id: `ov-${n}`, title: `Lighthouse ${n}`, creator: 'Ada', license: 'by', license_version: '2.0',
        license_url: 'https://creativecommons.org/licenses/by/2.0/', foreign_landing_url: `https://photos.example.org/${n}`,
        // (Not a web address: never kept.)
        creator_url: n === 0 ? 'javascript:alert(1)' : 'https://photos.example.org/ada',
        url: `https://elsewhere.example.org/${n}.jpg`, width: 400, height: 300,
      };
    }),
  };
}

/** Stand-ins for every provider; returns the list of requests they got. */
async function mockProviders(context, page) {
  const small = (await makePng(page, { w: 60, h: 40, color: '#ff4d6d' })).buffer;
  const big = (await makePng(page, { w: 400, h: 300, color: '#06d6a0' })).buffer;
  const other = (await makePng(page, { w: 300, h: 200, color: '#5b5bd6' })).buffer;
  const seen = [];
  const note = (route) => {
    const r = route.request();
    seen.push({ url: r.url(), method: r.method(), headers: r.headers() });
    return r.method() === 'OPTIONS' ? route.fulfill({ status: 204, headers: CORS }) : null;
  };
  await context.route(/^https:\/\/api\.openverse\.org\//, (route) => {
    if (note(route)) return;
    const url = new URL(route.request().url());
    const thumb = url.pathname.match(/^\/v1\/images\/([\w-]+)\/thumb\/$/);
    if (thumb) {
      // (The third photo's original is missing: its small picture stands in.)
      if (url.searchParams.get('full_size') === 'true') return thumb[1] === 'ov-2' ? route.fulfill({ status: 404, headers: CORS, body: '' }) : picture(route, big);
      return picture(route, small);
    }
    if (url.pathname === '/v1/images/') return json(route, openverseResults(+url.searchParams.get('page'), +url.searchParams.get('page_size')));
    return json(route, {}, 404);
  });
  await context.route(/^https:\/\/api\.unsplash\.com\//, (route) => {
    if (note(route)) return;
    const url = new URL(route.request().url());
    if (route.request().headers().authorization !== 'Client-ID unsplash-secret') return json(route, { errors: ['OAuth error'] }, 401);
    if (url.pathname === '/search/photos') {
      return json(route, { total: 2, total_pages: 1, results: [1, 2].map((n) => ({
        id: `us${n}`, width: 4000, height: 3000, alt_description: `a mountain ${n}`,
        urls: { small: `https://images.unsplash.com/photo-us${n}?w=400`, regular: `https://images.unsplash.com/photo-us${n}?w=1080` },
        links: { html: `https://unsplash.com/photos/us${n}`, download_location: `https://api.unsplash.com/photos/us${n}/download?ixid=abc` },
        user: { name: 'Ann Lee', links: { html: 'https://unsplash.com/@annlee' } },
      })) });
    }
    if (url.pathname.endsWith('/download')) return json(route, { url: 'https://images.unsplash.com/photo-us1' });
    return json(route, {}, 404);
  });
  await context.route(/^https:\/\/api\.pexels\.com\//, (route) => {
    if (note(route)) return;
    if (route.request().headers().authorization !== 'pexels-secret') return json(route, { error: 'nope' }, 401);
    return json(route, { page: 1, per_page: 20, photos: [7, 8].map((n) => ({
      id: n, width: 3000, height: 2000, alt: `A beach ${n}`, url: `https://www.pexels.com/photo/${n}/`, photographer: 'Bo Kim', photographer_url: 'https://www.pexels.com/@bo',
      src: { medium: `https://images.pexels.com/photos/${n}/m.jpeg`, large: `https://images.pexels.com/photos/${n}/l.jpeg`, large2x: `https://images.pexels.com/photos/${n}/l2.jpeg` },
    })) });
  });
  await context.route(/^https:\/\/images\.unsplash\.com\//, (route) => note(route) || picture(route, big));
  await context.route(/^https:\/\/images\.pexels\.com\//, (route) => note(route) || picture(route, other));
  await context.route(/^https:\/\/api\.anthropic\.com\//, (route) => note(route) || json(route, { data: [{ id: 'claude-x' }] }));
  await context.route(/^https:\/\/api\.openai\.com\//, (route) => note(route) || json(route, { error: 'bad key' }, 401));
  await context.route(/^https:\/\/generativelanguage\.googleapis\.com\//, (route) => note(route) || json(route, { models: [] }));
  await context.route(/^http:\/\/(localhost|127\.0\.0\.1):11434\//, (route) => note(route) || json(route, { models: [{ name: 'llama' }] }));
  return seen;
}

const onPage = (page) => state(page, (ed) => ed.doc.pages[ed.page].elements.filter((e) => e.type === 'image').map((e) => ({ id: e.id, ...ed.doc.assets[e.assetId], dataUrl: undefined })));

/** Wait for the design to be saved, then open it again from storage. */
async function reopen(page) {
  await page.evaluate(() => window.paperwall.editor.flush());
  await page.reload();
  await waitForEditor(page);
}

/** Wait (a few seconds at most) for fn() to give something. */
async function until(fn) {
  for (let i = 0; i < 50; i++) {
    const v = fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
  return fn();
}

/** Wait for a feature's line in Online extras to say something (and show what it said if it doesn't). */
async function statusSays(page, feature, re) {
  const sel = `[data-testid="online-status-${feature}"]`;
  try {
    await page.waitForFunction(([s, src]) => new RegExp(src).test(document.querySelector(s)?.textContent), [sel, re.source], { timeout: 5000 });
  } catch {
    assert.fail(`${feature}: expected ${re}, got "${await page.textContent(sel).catch(() => '(none)')}"`);
  }
}

async function openSettings(page) {
  await page.click('[data-testid="main"]');
  await page.click('[data-testid="menu-online"]');
  await page.waitForSelector('[data-testid="online-settings"] [data-testid="online-photos"]');
}

test('[ON-01] stock photos from Openverse: off until turned on, added with their credit', async () => {
  const { page, context, errors } = await newDesign('square');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const seen = await mockProviders(context, page);
  await openTab(page, 'uploads');
  await page.click('[data-testid="uploads-view-photos"]');
  // Off: a note on what turning it on means, and nothing fetched.
  assert.match(await page.textContent('[data-testid="photos-note"]'), /search words to Openverse/);
  assert.equal(await page.locator('[data-testid="photos-search"]').count(), 0);
  await page.waitForTimeout(300);
  assert.deepEqual(seen, [], 'nothing goes online before it is turned on');

  await page.click('[data-testid="photos-turn-on"]');
  await page.fill('[data-testid="photos-search"]', 'light house');
  await page.press('[data-testid="photos-search"]', 'Enter');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="photo-item"]').length === 20);
  assert.equal(seen[0].url, 'https://api.openverse.org/v1/images/?q=light%20house&page=1&page_size=20');
  assert.ok(seen.every((r) => !r.headers.authorization), 'no key, no account');
  // Previews come through Openverse's own address, shown from this page's memory.
  await page.waitForFunction(() => document.querySelector('[data-testid="photo-item"] img')?.src.startsWith('blob:'));
  assert.ok(seen.some((r) => r.url === 'https://api.openverse.org/v1/images/ov-0/thumb/'));
  // More.
  await page.click('[data-testid="photos-more"]');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="photo-item"]').length === 40);
  assert.ok(seen.some((r) => r.url.endsWith('&page=2&page_size=20')));
  assert.equal(await page.isHidden('[data-testid="photos-more"]'), true, 'no more pages');

  // Click: added at its original size, with its credit (unsafe links left out).
  await page.click('[data-testid="photo-item"] >> nth=0');
  await page.waitForFunction(() => window.paperwall.editor.pageData.elements.some((e) => e.type === 'image'));
  assert.ok(seen.some((r) => r.url === 'https://api.openverse.org/v1/images/ov-0/thumb/?full_size=true'));
  let [img] = await onPage(page);
  assert.deepEqual([img.width, img.height], [400, 300]);
  assert.deepEqual(img.credit, {
    provider: 'Openverse', title: 'Lighthouse 0', creator: 'Ada', license: 'CC BY 2.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/2.0/', url: 'https://photos.example.org/0',
  });
  // The credit in the image's settings, and copied.
  const credit = await page.textContent('[data-testid="image-credit"]');
  assert.match(credit, /"Lighthouse 0" by Ada, CC BY 2.0/);
  assert.equal(await page.getAttribute('[data-testid="image-credit"] a >> nth=0', 'href'), 'https://photos.example.org/0');
  await page.click('[data-testid="copy-credit"]');
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(copied, /"Lighthouse 0" by Ada, CC BY 2\.0 \(via Openverse\)\. https:\/\/photos\.example\.org\/0/);
  // Kept in Uploads too, credit and all.
  await page.click('[data-testid="uploads-view-mine"]');
  await page.waitForSelector('[data-testid="upload-item"]');
  await page.click('[data-testid="uploads-view-photos"]');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="photo-item"]').length === 40);

  // Drag one onto the page; the third one's original is missing, so its small picture is used.
  const box = await page.locator('[data-testid="page"]').boundingBox();
  await page.dragAndDrop('[data-testid="photo-item"] >> nth=2', '[data-testid="page"]', { targetPosition: { x: box.width / 4, y: box.height / 4 } });
  await page.waitForFunction(() => window.paperwall.editor.pageData.elements.filter((e) => e.type === 'image').length === 2);
  img = (await onPage(page))[1];
  assert.deepEqual([img.width, img.height], [60, 40]);
  assert.equal(img.credit.title, 'Lighthouse 2');
  assert.equal(img.credit.creatorUrl, 'https://photos.example.org/ada');

  // Only Openverse was asked, and the credit survives saving and opening again.
  assert.ok(seen.every((r) => r.url.startsWith('https://api.openverse.org/')));
  await reopen(page);
  const back = await onPage(page);
  assert.deepEqual(back.map((a) => a.credit.title), ['Lighthouse 0', 'Lighthouse 2']);
  assert.equal(back[0].credit.license, 'CC BY 2.0');
  assert.deepEqual(errors.filter((e) => !/404/.test(e)), []);
  await context.close();
});

test('[ON-02] Unsplash and Pexels with your own key, credited as each asks', async () => {
  const { page, context, errors } = await newDesign('square');
  const seen = await mockProviders(context, page);
  await openSettings(page);
  await page.check('[data-testid="online-on-photos"]');
  await page.selectOption('[data-testid="online-provider-photos"]', 'unsplash');
  await page.waitForSelector('[data-testid="online-key-photos"]');
  assert.equal(await page.getAttribute('[data-testid="online-key-photos"]', 'type'), 'password');
  assert.equal(await page.getAttribute('[data-testid="online-get-key-photos"]', 'href'), 'https://unsplash.com/developers');
  await page.keyboard.press('Escape');

  // Turned on, but no key yet: the panel asks for one.
  await openTab(page, 'uploads');
  await page.click('[data-testid="uploads-view-photos"]');
  await page.click('[data-testid="photos-add-key"]');
  await page.fill('[data-testid="online-key-photos"]', 'unsplash-secret');
  await page.click('[data-testid="online-test-photos"]');
  await statusSays(page, 'photos', /answered/);
  assert.ok(seen.some((r) => r.url === 'https://api.unsplash.com/search/photos?query=flower&page=1&per_page=1'), 'a one-photo search tests the key');
  await page.keyboard.press('Escape');

  await page.fill('[data-testid="photos-search"]', 'mountain');
  await page.press('[data-testid="photos-search"]', 'Enter');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="photo-item"]').length === 2);
  await page.click('[data-testid="photo-item"] >> nth=0');
  await page.waitForFunction(() => window.paperwall.editor.pageData.elements.some((e) => e.type === 'image'));
  let [img] = await onPage(page);
  assert.equal(img.credit.provider, 'Unsplash');
  assert.equal(img.credit.creator, 'Ann Lee');
  assert.equal(img.credit.creatorUrl, 'https://unsplash.com/@annlee?utm_source=paperwall&utm_medium=referral');
  assert.equal(await page.textContent('[data-testid="image-credit"]'), 'Photo by Ann Lee on Unsplash');
  assert.equal(await page.getAttribute('[data-testid="image-credit"] a >> nth=1', 'href'), 'https://unsplash.com/photos/us1?utm_source=paperwall&utm_medium=referral');
  // The regular-size picture, and Unsplash told it was used.
  assert.ok(seen.some((r) => r.url === 'https://images.unsplash.com/photo-us1?w=1080'));
  const told = await until(() => seen.find((r) => r.url === 'https://api.unsplash.com/photos/us1/download?ixid=abc' && r.method === 'GET'));
  assert.equal(told?.headers.authorization, 'Client-ID unsplash-secret');

  // Now Pexels.
  await openSettings(page);
  await page.selectOption('[data-testid="online-provider-photos"]', 'pexels');
  await page.waitForSelector('[data-testid="online-get-key-photos"][href="https://www.pexels.com/api/"]');
  await page.fill('[data-testid="online-key-photos"]', 'pexels-secret');
  await page.keyboard.press('Escape');
  await page.waitForSelector('[data-testid="photos-search"][placeholder="Search Pexels"]');
  await page.fill('[data-testid="photos-search"]', 'beach');
  await page.press('[data-testid="photos-search"]', 'Enter');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="photo-item"]').length === 2);
  await page.click('[data-testid="photo-item"] >> nth=1');
  await page.waitForFunction(() => window.paperwall.editor.pageData.elements.filter((e) => e.type === 'image').length === 2);
  img = (await onPage(page))[1];
  assert.deepEqual(img.credit, {
    provider: 'Pexels', title: 'A beach 8', creator: 'Bo Kim', license: 'Pexels License',
    creatorUrl: 'https://www.pexels.com/@bo', licenseUrl: 'https://www.pexels.com/license/', url: 'https://www.pexels.com/photo/8/',
  });
  assert.equal(await page.textContent('[data-testid="image-credit"]'), 'Photo by Bo Kim on Pexels');
  assert.ok(seen.some((r) => r.url === 'https://images.pexels.com/photos/8/l2.jpeg'));

  // Each key went only to its own provider's API, never to picture hosts or anywhere else.
  const carries = (r, key) => r.url.includes(key) || Object.values(r.headers).some((v) => v.includes(key));
  const hostsWith = (key) => [...new Set(seen.filter((r) => carries(r, key)).map((r) => new URL(r.url).origin))];
  assert.deepEqual(hostsWith('unsplash-secret'), ['https://api.unsplash.com']);
  assert.deepEqual(hostsWith('pexels-secret'), ['https://api.pexels.com']);

  await reopen(page);
  const back = await onPage(page);
  assert.deepEqual(back.map((a) => a.credit.provider), ['Unsplash', 'Pexels']);
  assert.equal(back[0].credit.url, 'https://unsplash.com/photos/us1?utm_source=paperwall&utm_medium=referral');
  assert.deepEqual(errors, []);
  await context.close();
});

test('[ON-05] online settings: each feature off until turned on, a provider each, test a key, forget keys', async () => {
  const { page, context, errors } = await openApp();
  const seen = await mockProviders(context, page);
  await page.click('[data-testid="home-online"]');
  const dlg = page.locator('[data-testid="online-settings"]');
  await dlg.locator('[data-testid="online-writing"]').waitFor();
  assert.match(await dlg.textContent(), /Keys stay on this device/);
  for (const f of ['photos', 'writing', 'design']) assert.equal(await page.isChecked(`[data-testid="online-on-${f}"]`), false, `${f} is off`);
  assert.equal(await page.inputValue('[data-testid="online-provider-photos"]'), 'openverse');
  assert.equal(await page.locator('[data-testid="online-key-photos"]').count(), 0, 'Openverse needs no key');
  assert.equal(await page.inputValue('[data-testid="online-provider-writing"]'), 'claude');

  // Claude: a list of models, with the key and the headers it asks for.
  await page.fill('[data-testid="online-key-writing"]', 'sk-ant-test');
  assert.equal(await page.inputValue('[data-testid="online-key-design"]'), 'sk-ant-test', 'the same provider, the same key');
  await page.click('[data-testid="online-test-writing"]');
  await statusSays(page, 'writing', /answered/);
  const claude = seen.find((r) => r.url === 'https://api.anthropic.com/v1/models' && r.method === 'GET');
  assert.equal(claude.headers['x-api-key'], 'sk-ant-test');
  assert.equal(claude.headers['anthropic-version'], '2023-06-01');
  assert.equal(claude.headers['anthropic-dangerous-direct-browser-access'], 'true');

  // OpenAI: a key it doesn't accept says so.
  await page.selectOption('[data-testid="online-provider-design"]', 'openai');
  await page.waitForSelector('[data-testid="online-get-key-design"][href="https://platform.openai.com/api-keys"]');
  await page.fill('[data-testid="online-key-design"]', 'sk-wrong');
  await page.click('[data-testid="online-test-design"]');
  await statusSays(page, 'design', /didn't accept the key/);
  assert.equal(seen.find((r) => r.url === 'https://api.openai.com/v1/models' && r.method === 'GET').headers.authorization, 'Bearer sk-wrong');

  // Gemini: its key in the address, as it asks.
  await page.selectOption('[data-testid="online-provider-design"]', 'gemini');
  await page.waitForSelector('[data-testid="online-get-key-design"][href="https://aistudio.google.com/apikey"]');
  await page.fill('[data-testid="online-key-design"]', 'g-key');
  await page.click('[data-testid="online-test-design"]');
  await statusSays(page, 'design', /answered/);
  assert.ok(seen.some((r) => r.url === 'https://generativelanguage.googleapis.com/v1beta/models' && r.headers['x-goog-api-key'] === 'g-key'));

  // Ollama: no key, an address on this computer.
  await page.selectOption('[data-testid="online-provider-writing"]', 'ollama');
  await page.waitForSelector('[data-testid="online-ollama-writing"]');
  assert.equal(await page.locator('[data-testid="online-key-writing"]').count(), 0);
  await page.fill('[data-testid="online-ollama-writing"]', 'http://127.0.0.1:11434/');
  await page.click('[data-testid="online-test-writing"]');
  await statusSays(page, 'writing', /answered/);
  assert.ok(seen.some((r) => r.url === 'http://127.0.0.1:11434/api/tags'));

  // Openverse: a one-photo search.
  await page.click('[data-testid="online-test-photos"]');
  await statusSays(page, 'photos', /answered/);
  assert.ok(seen.some((r) => r.url === 'https://api.openverse.org/v1/images/?q=flower&page=1&page_size=1'));

  // Turned on stays on; picks stay picked.
  await page.check('[data-testid="online-on-photos"]');
  // (Kept on this device before the page goes: saving is quick, not instant.)
  await page.waitForFunction(() => new Promise((ok) => {
    const req = indexedDB.open('paperwall');
    req.onsuccess = () => {
      const get = req.result.transaction('settings').objectStore('settings').get('online|on|photos');
      get.onsuccess = () => ok(get.result === true);
    };
  }));
  await page.keyboard.press('Escape');
  await page.reload();
  await page.click('[data-testid="home-online"]');
  await dlg.locator('[data-testid="online-photos"]').waitFor();
  assert.equal(await page.isChecked('[data-testid="online-on-photos"]'), true);
  assert.equal(await page.isChecked('[data-testid="online-on-writing"]'), false);
  assert.equal(await page.inputValue('[data-testid="online-provider-design"]'), 'gemini');
  assert.equal(await page.inputValue('[data-testid="online-key-design"]'), 'g-key');

  // Forget all keys: gone from the fields and from this device.
  await page.click('[data-testid="online-forget-keys"]');
  await page.waitForFunction(() => document.querySelector('[data-testid="online-key-design"]')?.value === '');
  await page.keyboard.press('Escape');
  await page.reload();
  await page.click('[data-testid="home-online"]');
  await dlg.locator('[data-testid="online-design"]').waitFor();
  assert.equal(await page.inputValue('[data-testid="online-key-design"]'), '');
  await page.selectOption('[data-testid="online-provider-writing"]', 'claude');
  await page.waitForSelector('[data-testid="online-key-writing"]');
  assert.equal(await page.inputValue('[data-testid="online-key-writing"]'), '');
  const before = seen.length;
  await page.click('[data-testid="online-test-writing"]');
  await statusSays(page, 'writing', /Add your Claude \(Anthropic\) key first/);
  assert.equal(seen.length, before, 'no key, nothing sent');
  const keys = await page.evaluate(() => new Promise((ok) => {
    const req = indexedDB.open('paperwall');
    req.onsuccess = () => {
      const all = req.result.transaction('settings').objectStore('settings').getAllKeys();
      all.onsuccess = () => ok(all.result.filter((k) => String(k).startsWith('online|key|')));
    };
  }));
  assert.deepEqual(keys, []);
  assert.deepEqual(errors.filter((e) => !/401/.test(e)), []);
  await context.close();
});
