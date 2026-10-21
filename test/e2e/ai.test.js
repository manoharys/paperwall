import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { openApp, newDesign, waitForEditor, elements, addText, teardown, mod, clickElement } from './helpers.js';

after(teardown);

// No real network: every provider is answered here, in its own format.
const HOSTS = {
  claude: 'https://api.anthropic.com',
  openai: 'https://api.openai.com',
  gemini: 'https://generativelanguage.googleapis.com',
  ollama: 'http://localhost:11434',
};
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS' };

const answer = {
  claude: (text) => ({ id: 'msg_1', type: 'message', role: 'assistant', content: [{ type: 'text', text }], stop_reason: 'end_turn' }),
  openai: (text) => ({ id: 'chatcmpl-1', choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }] }),
  gemini: (text) => ({ candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP' }] }),
  ollama: (text) => ({ model: 'llama3.2', message: { role: 'assistant', content: text }, done: true }),
};

/**
 * Answer every provider. `reply(provider, req)` gives the text (or
 * { status, body } for a raw answer, or a promise). Returns the requests seen.
 */
async function mockProviders(context, reply) {
  const seen = [];
  for (const [provider, host] of Object.entries(HOSTS)) {
    await context.route(`${host}/**`, async (route) => {
      const req = route.request();
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
      const entry = { provider, url: req.url(), method: req.method(), headers: req.headers(), body: req.postData() || '' };
      seen.push(entry);
      let out;
      if (provider === 'ollama' && req.url().endsWith('/api/tags')) out = { status: 200, body: { models: [{ name: 'qwen3:4b' }, { name: 'llama3.2:latest' }] } };
      else {
        const r = await reply(provider, entry);
        out = typeof r === 'string' ? { status: 200, body: answer[provider](r) } : r;
      }
      await route.fulfill({ status: out.status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(out.body) }).catch(() => null);
    });
  }
  return seen;
}

/** Fill in the setup prompt: turn on, pick a provider, paste a key. */
async function setUp(page, provider, key) {
  await page.waitForSelector('[data-testid="ai-setup"] [data-testid="ai-setup-provider"]');
  const on = page.locator('[data-testid="ai-setup-on"]');
  if (!(await on.isChecked())) await on.check();
  await page.selectOption('[data-testid="ai-setup-provider"]', provider);
  // (Its own key field, once the rows have changed over to it.)
  const names = { claude: 'Claude (Anthropic)', openai: 'OpenAI', gemini: 'Gemini (Google)' };
  if (key) await page.fill(`[data-testid="ai-setup-key"][aria-label="${names[provider]} key"]`, key);
  else await page.waitForSelector('[data-testid="ai-setup-key"]', { state: 'detached' });
}

const textEl = async (page, id) => (await elements(page)).find((e) => e.id === id);

/** Every key goes only to its own provider. */
function keysStayHome(seen, keys) {
  for (const r of seen) {
    const all = `${r.url} ${JSON.stringify(r.headers)} ${r.body}`;
    for (const [provider, key] of Object.entries(keys)) {
      if (provider !== r.provider) assert.ok(!all.includes(key), `${provider}'s key was sent to ${r.provider}`);
    }
  }
}

test('[ON-03] AI writing: off until turned on; a text action replaces the text as one undo step and keeps its style', async () => {
  const { page, context } = await newDesign('square');
  const seen = await mockProviders(context, (p, r) => (JSON.parse(r.body).messages.at(-1).content.includes('shorter') ? 'Bake sale!' : 'Something else'));
  const t = await addText(page, 'heading');
  await page.click('[data-testid="ai-menu"]');
  await page.click('[data-testid="ai-shorten"]');
  // Not turned on: a setup prompt, and nothing sent.
  await page.waitForSelector('[data-testid="ai-setup"]');
  assert.equal(seen.length, 0);
  // Saving without turning it on doesn't send anything either.
  await page.fill('[data-testid="ai-setup-key"]', 'sk-ant-test-key');
  await page.click('[data-testid="ai-setup-save"]');
  await page.waitForSelector('[data-testid="ai-setup-error"]:not([hidden])');
  assert.equal(seen.length, 0);
  await setUp(page, 'claude', 'sk-ant-test-key');
  await page.click('[data-testid="ai-setup-save"]');
  // Then the action goes ahead.
  await page.waitForFunction((id) => window.paperwall.editor.pageData.elements.find((e) => e.id === id)?.text === 'Bake sale!', t.id);
  assert.equal(seen.length, 1);
  const r = seen[0];
  assert.equal(r.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(r.headers['x-api-key'], 'sk-ant-test-key');
  assert.equal(r.headers['anthropic-version'], '2023-06-01');
  assert.equal(r.headers['anthropic-dangerous-direct-browser-access'], 'true');
  const body = JSON.parse(r.body);
  assert.equal(body.model, 'claude-opus-5-5');
  assert.ok(body.messages[0].content.includes('Add a heading'), 'the text is sent to be shortened');
  const after = await textEl(page, t.id);
  for (const k of ['font', 'size', 'weight', 'color', 'align', 'x', 'w']) assert.deepEqual(after[k], t[k], `${k} kept`);
  // One undo step puts the text back.
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press(`${mod}+z`);
  assert.equal((await textEl(page, t.id)).text, 'Add a heading');
  await page.keyboard.press(`${mod}+Shift+z`);
  assert.equal((await textEl(page, t.id)).text, 'Bake sale!');

  // Write from a few words.
  await clickElement(page, t.id);
  await page.click('[data-testid="ai-menu"]');
  await page.fill('[data-testid="ai-write-prompt"]', 'a headline for a bake sale');
  await page.click('[data-testid="ai-write"]');
  await page.waitForFunction((id) => window.paperwall.editor.pageData.elements.find((e) => e.id === id)?.text === 'Something else', t.id);
  assert.match(JSON.parse(seen.at(-1).body).messages[0].content, /a headline for a bake sale/);
  await context.close();
});

test('[ON-03] Claude, OpenAI, Gemini and Ollama each get their own request, and each key goes only to its provider', async () => {
  const { page, context } = await newDesign('square');
  const replies = { claude: 'Hello from Claude', openai: 'Hello, friend!', gemini: 'Bonjour à tous', ollama: 'Fixed text.' };
  const seen = await mockProviders(context, (p) => replies[p]);
  const t = await addText(page, 'body');
  const keys = { claude: 'sk-ant-AAA111', openai: 'sk-openai-BBB222', gemini: 'gm-CCC333' };
  const waitText = (text) => page.waitForFunction(([id, s]) => window.paperwall.editor.pageData.elements.find((e) => e.id === id)?.text === s, [t.id, text]);

  // Claude: rewrite.
  await page.click('[data-testid="ai-settings"]');
  await setUp(page, 'claude', keys.claude);
  await page.click('[data-testid="ai-setup-save"]');
  await page.click('[data-testid="ai-menu"]');
  await page.click('[data-testid="ai-rewrite"]');
  await waitText(replies.claude);

  // OpenAI, with another model: a friendlier tone.
  await page.click('[data-testid="ai-settings"]');
  await setUp(page, 'openai', keys.openai);
  await page.fill('[data-testid="ai-setup-model"]', 'gpt-4.1');
  await page.click('[data-testid="ai-setup-save"]');
  await page.click('[data-testid="ai-menu"]');
  await page.click('[data-testid="ai-tone-friendly"]');
  await waitText(replies.openai);
  const o = seen.at(-1);
  assert.equal(o.url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(o.headers.authorization, `Bearer ${keys.openai}`);
  assert.equal(JSON.parse(o.body).model, 'gpt-4.1');
  assert.match(JSON.parse(o.body).messages[1].content, /friendly/);

  // Gemini: translate into French.
  await page.click('[data-testid="ai-settings"]');
  await setUp(page, 'gemini', keys.gemini);
  await page.click('[data-testid="ai-setup-save"]');
  await page.click('[data-testid="ai-menu"]');
  await page.selectOption('[data-testid="ai-language"]', 'French');
  await page.click('[data-testid="ai-translate"]');
  await waitText(replies.gemini);
  const g = seen.at(-1);
  assert.equal(g.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent');
  assert.equal(g.headers['x-goog-api-key'], keys.gemini);
  assert.match(JSON.parse(g.body).contents[0].parts[0].text, /French/);

  // Ollama: no key; its installed models listed; fix spelling.
  await page.click('[data-testid="ai-settings"]');
  await setUp(page, 'ollama', null);
  await page.click('[data-testid="ai-setup-find-models"]');
  await page.waitForFunction(() => document.querySelector('[data-testid="ai-setup-model"]').value === 'qwen3:4b');
  await page.click('[data-testid="ai-setup-save"]');
  await page.click('[data-testid="ai-menu"]');
  await page.click('[data-testid="ai-fix"]');
  await waitText(replies.ollama);
  const l = seen.at(-1);
  assert.equal(l.url, 'http://localhost:11434/api/chat');
  assert.equal(JSON.parse(l.body).stream, false);
  assert.equal(JSON.parse(l.body).model, 'qwen3:4b');
  assert.ok(seen.some((r) => r.url === 'http://localhost:11434/api/tags'));

  assert.deepEqual([...new Set(seen.map((r) => r.provider))].sort(), ['claude', 'gemini', 'ollama', 'openai']);
  keysStayHome(seen, keys);
  assert.ok(seen.filter((r) => r.provider === 'claude').every((r) => r.headers['x-api-key'] === keys.claude));
  await context.close();
});

test('[ON-03] AI writing shows progress, can be cancelled, and says what went wrong', async () => {
  const { page, context, errors } = await newDesign('square');
  let release;
  let mode = 'hang';
  await mockProviders(context, () => {
    if (mode === 'hang') return new Promise((ok) => (release = ok)).then(() => 'Too late');
    return typeof mode === 'object' ? mode : { status: 401, body: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } };
  });
  const t = await addText(page, 'heading');
  await page.click('[data-testid="ai-settings"]');
  await setUp(page, 'claude', 'sk-ant-wrong');
  await page.click('[data-testid="ai-setup-save"]');
  await page.click('[data-testid="ai-menu"]');
  await page.click('[data-testid="ai-longer"]');
  await page.waitForSelector('[data-testid="ai-progress"]');
  await page.click('[data-testid="ai-cancel"]');
  await page.waitForSelector('[data-testid="ai-progress"]', { state: 'detached' });
  release?.();
  await page.waitForTimeout(200);
  assert.equal((await textEl(page, t.id)).text, 'Add a heading', 'a cancelled request changes nothing');
  assert.equal(await page.locator('[data-testid="ai-error"]').count(), 0);
  // A key the provider turns down: a readable error, text as it was.
  mode = 'reject';
  await page.click('[data-testid="ai-menu"]');
  await page.click('[data-testid="ai-rewrite"]');
  const msg = await page.locator('[data-testid="ai-error"]').textContent();
  assert.match(msg, /didn't accept the key/);
  assert.equal((await textEl(page, t.id)).text, 'Add a heading');
  // A request turned down: the model-name hint only when the provider's own words are about the model.
  const turnedDown = async (detail) => {
    mode = { status: 400, body: { type: 'error', error: { type: 'invalid_request_error', message: detail } } };
    await page.click('[data-testid="ai-menu"]');
    await page.click('[data-testid="ai-rewrite"]');
    await page.waitForFunction((d) => document.querySelector('[data-testid="ai-error"]')?.textContent.includes(d), detail.slice(0, 40));
    return page.locator('[data-testid="ai-error"]').textContent();
  };
  assert.doesNotMatch(await turnedDown('max_tokens is too large'), /Check the model name/);
  assert.match(await turnedDown('model: claude-nope not found'), /Check the model name/);
  // (Said after the part of the provider's words that's shown, still read.)
  assert.match(await turnedDown(`The request was turned down for this reason: ${'and that reason, '.repeat(12)}which is the model.`), /Check the model name/);
  assert.equal((await textEl(page, t.id)).text, 'Add a heading');
  assert.deepEqual(errors.filter((e) => !/401|400|Failed to load resource/.test(e)), []);
  await context.close();
});

// An answer in the AI design schema, fenced as models often do.
const SPEC = {
  name: 'Bake sale poster',
  background: { from: '#ffe4ec', to: '#e0f0ff', angle: 160 },
  shapes: [
    { shape: 'ellipse', x: 0.7, y: 0.85, w: 0.6, h: 0.4, color: '#ffc8dd', opacity: 0.8 },
    { shape: 'rect', x: 0.06, y: 0.06, w: 0.88, h: 0.88, color: '#ffffff', opacity: 0.5, rounded: 0.05 },
  ],
  icons: [{ id: 'cake', x: 0.42, y: 0.1, size: 0.16, color: '#c93468' }, { id: 'no-such-icon-anywhere-xyz', x: 0.1, y: 0.1 }],
  texts: [
    { role: 'title', text: 'Bake Sale', font: 'Playfair Display', size: 0.14, bold: true, color: '#3b1426', align: 'center', x: 0.08, y: 0.3, w: 0.84 },
    { role: 'subtitle', text: 'Cakes, cookies and pies, all homemade', font: 'Lora', color: '#7a4a5c', align: 'center', x: 0.1, y: 0.5, w: 0.8 },
    { role: 'button', text: 'Saturday 10am', font: 'Poppins', box: '#c93468', align: 'center', x: 0.3, y: 1.3, w: 0.4 },
  ],
};

test('[ON-04] AI design: describe a design, pick a size, and it opens as an editable design', async () => {
  const { page, context } = await openApp();
  const seen = await mockProviders(context, () => `Here you go:\n\`\`\`json\n${JSON.stringify(SPEC, null, 2)}\n\`\`\``);
  await page.fill('[data-testid="ai-design-prompt"]', 'a poster for a bake sale on Saturday, pastel');
  await page.selectOption('[data-testid="ai-design-size"]', 'portrait');
  await page.click('[data-testid="ai-design-go"]');
  await page.waitForSelector('[data-testid="ai-setup"]');
  assert.equal(seen.length, 0, 'nothing sent before AI design is turned on');
  await setUp(page, 'claude', 'sk-ant-design');
  await page.click('[data-testid="ai-setup-save"]');
  await waitForEditor(page);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].headers['x-api-key'], 'sk-ant-design');
  assert.match(JSON.parse(seen[0].body).messages[0].content, /bake sale/);
  const doc = await page.evaluate(() => JSON.parse(JSON.stringify(window.paperwall.editor.doc)));
  assert.equal(doc.name, 'Bake sale poster');
  assert.deepEqual([doc.width, doc.height], [1080, 1350]);
  assert.equal(doc.pages[0].background.type, 'gradient');
  const els = doc.pages[0].elements;
  assert.deepEqual(els.map((e) => e.type), ['shape', 'shape', 'icon', 'text', 'text', 'text']);
  assert.equal(els[2].iconId, 'cake');
  const texts = els.filter((e) => e.type === 'text');
  assert.deepEqual(texts.map((e) => e.text), SPEC.texts.map((s) => s.text));
  assert.equal(texts[0].font, 'Playfair Display');
  assert.equal(texts[0].align, 'center');
  assert.equal(texts[2].highlight.color, '#c93468');
  for (const e of els) {
    assert.ok(e.x >= 0 && e.y >= 0 && e.x + e.w <= doc.width && e.y + e.h <= doc.height, `${e.type} on the page`);
    assert.equal(e.locked, false);
  }
  // Fully editable: select the title and change its size.
  await clickElement(page, texts[0].id);
  await page.waitForFunction((id) => window.paperwall.editor.selection.includes(id), texts[0].id);
  await page.fill('[data-testid="font-size"]', '90');
  await page.press('[data-testid="font-size"]', 'Enter');
  assert.equal((await elements(page)).find((e) => e.id === texts[0].id).size, 90);
  await context.close();
});

test('[ON-04] AI design offers three to pick from, and explains an answer it can\'t use', async () => {
  const { page, context } = await openApp();
  let bad = false;
  const seen = await mockProviders(context, () => (bad ? 'Sorry, I cannot design that { not json' : JSON.stringify({
    designs: [SPEC, { ...SPEC, name: 'Second take', background: '#1f3a2e' }, { ...SPEC, name: 'Third take', background: '#fff8d6' }],
  })));
  await page.click('[data-testid="ai-design-settings"]');
  await setUp(page, 'gemini', 'gm-design-key');
  await page.click('[data-testid="ai-setup-save"]');
  // An answer that isn't a design: a readable error, and nothing opens.
  bad = true;
  await page.fill('[data-testid="ai-design-prompt"]', 'a menu for a cafe');
  await page.click('[data-testid="ai-design-go"]');
  assert.match(await page.locator('[data-testid="ai-design-error"]').textContent(), /wasn't a design/);
  assert.equal(await page.evaluate(() => location.hash), '');
  // Three at once.
  bad = false;
  await page.selectOption('[data-testid="ai-design-size"]', 'square');
  await page.selectOption('[data-testid="ai-design-count"]', '3');
  await page.click('[data-testid="ai-design-go"]');
  await page.waitForSelector('[data-testid="ai-design-choices"]');
  assert.equal(await page.locator('[data-testid="ai-design-choice"]').count(), 3);
  const req = JSON.parse(seen.at(-1).body);
  assert.equal(req.generationConfig.responseMimeType, 'application/json');
  assert.match(req.contents[0].parts[0].text, /3 clearly different designs/);
  assert.equal(seen.at(-1).headers['x-goog-api-key'], 'gm-design-key');
  await page.locator('[data-testid="ai-design-choice"]').nth(1).click();
  await waitForEditor(page);
  const doc = await page.evaluate(() => JSON.parse(JSON.stringify(window.paperwall.editor.doc)));
  assert.equal(doc.name, 'Second take');
  assert.deepEqual([doc.width, doc.height], [1080, 1080]);
  assert.deepEqual(doc.pages[0].background, { type: 'color', color: '#1f3a2e' });
  assert.equal(doc.pages[0].elements.filter((e) => e.type === 'text').length, 3);
  await context.close();
});
