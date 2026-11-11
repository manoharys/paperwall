import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRequest, parseResponse, ollamaModelNames, DEFAULT_MODELS, writingPrompt, cleanWriting, WRITING_ACTIONS,
  designPrompt, parseJsonReply, designSpecs, specToDesign, designsFromReply, specFonts, iconFor, clampOntoPage, DESIGN_SIZES,
} from '../../src/model/ai.js';
import { PROVIDERS } from '../../src/model/providers.js';
import { iconById } from '../../src/model/graphics.js';
import { FONTS } from '../../src/model/fonts.js';

const ask = { system: 'Be brief.', prompt: 'Say hi', key: 'KEY-123', base: 'http://localhost:11434' };

test('[ON-03] each provider gets a request in its own format, the key only where it goes', () => {
  const claude = buildRequest('claude', ask);
  assert.equal(claude.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(claude.init.headers['x-api-key'], 'KEY-123');
  assert.equal(claude.init.headers['anthropic-version'], '2023-06-01');
  assert.equal(claude.init.headers['anthropic-dangerous-direct-browser-access'], 'true');
  const cb = JSON.parse(claude.init.body);
  assert.equal(cb.model, 'claude-opus-5-5');
  assert.ok(cb.max_tokens >= 16000, 'room to think and answer');
  assert.equal(cb.output_config.effort, 'low');
  assert.equal(cb.fallbacks, 'default');
  assert.equal(claude.init.headers['anthropic-beta'], 'server-side-fallback-2026-07-01');
  assert.equal(cb.system, 'Be brief.');
  assert.deepEqual(cb.messages, [{ role: 'user', content: 'Say hi' }]);
  assert.ok(cb.max_tokens > 0);

  const openai = buildRequest('openai', { ...ask, json: true, model: 'gpt-4.1' });
  assert.equal(openai.url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(openai.init.headers.authorization, 'Bearer KEY-123');
  const ob = JSON.parse(openai.init.body);
  assert.equal(ob.model, 'gpt-4.1');
  assert.deepEqual(ob.response_format, { type: 'json_object' });
  assert.deepEqual(ob.messages.map((m) => m.role), ['system', 'user']);

  const gemini = buildRequest('gemini', { ...ask, json: true });
  assert.equal(gemini.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent');
  const gb = JSON.parse(gemini.init.body);
  assert.equal(gb.systemInstruction.parts[0].text, 'Be brief.');
  assert.equal(gb.contents[0].parts[0].text, 'Say hi');
  assert.equal(gb.generationConfig.responseMimeType, 'application/json');
  assert.equal(gemini.init.headers['x-goog-api-key'], 'KEY-123', 'the key in a header, not the address');

  const ollama = buildRequest('ollama', { ...ask, base: 'http://localhost:11434/', json: true });
  assert.equal(ollama.url, 'http://localhost:11434/api/chat');
  const lb = JSON.parse(ollama.init.body);
  assert.equal(lb.stream, false);
  assert.equal(lb.model, 'llama3.2');
  assert.equal(lb.format, 'json');
  assert.ok(!JSON.stringify(ollama).includes('KEY-123'), 'Ollama never sees a key');

  // Every request goes to one of its provider's own hosts.
  for (const id of ['claude', 'openai', 'gemini', 'ollama']) {
    const { url } = buildRequest(id, ask);
    assert.ok(PROVIDERS[id].hosts.some((h) => url.startsWith(`${h}/`)), url);
    assert.ok(DEFAULT_MODELS[id]);
  }
  assert.throws(() => buildRequest('openverse', ask));
});

test('[ON-03] answers are read from each format, with readable errors', () => {
  assert.equal(parseResponse('claude', { content: [{ type: 'thinking', thinking: '…' }, { type: 'text', text: 'Hi' }] }), 'Hi');
  assert.equal(parseResponse('openai', { choices: [{ message: { content: 'Hi' } }] }), 'Hi');
  assert.equal(parseResponse('gemini', { candidates: [{ content: { parts: [{ text: 'H' }, { text: 'i' }] } }] }), 'Hi');
  assert.equal(parseResponse('ollama', { message: { content: 'Hi' } }), 'Hi');
  assert.throws(() => parseResponse('claude', { content: [] }), /empty/);
  assert.throws(() => parseResponse('gemini', { promptFeedback: { blockReason: 'SAFETY' } }), /declined.*safety/);
  assert.throws(() => parseResponse('openai', { error: { message: 'model not found' } }), /model not found/);
  assert.throws(() => parseResponse('ollama', null), /couldn't be read/);
  assert.deepEqual(ollamaModelNames({ models: [{ name: 'llama3.2:latest' }, { model: 'qwen3' }, {}] }), ['llama3.2:latest', 'qwen3']);
  assert.deepEqual(ollamaModelNames({}), []);
});

test('[ON-03] writing prompts: every action, the text fenced off as text', () => {
  const el = { size: 96, list: 'none' };
  for (const { id } of WRITING_ACTIONS) {
    const { system, prompt } = writingPrompt(id, { text: 'Bake sale', brief: 'a cake fair', tone: 'playful', language: 'French', el });
    assert.ok(system.length > 50);
    assert.ok(prompt.includes('<text>\nBake sale\n</text>'), id);
  }
  assert.match(writingPrompt('write', { brief: 'a cake fair', el }).prompt, /a cake fair.*headline|headline.*a cake fair/s);
  assert.match(writingPrompt('tone', { text: 'x', tone: 'professional' }).prompt, /professional/);
  assert.match(writingPrompt('translate', { text: 'x', language: 'Japanese' }).prompt, /into Japanese/);
  assert.match(writingPrompt('shorten', { text: 'x', el: { size: 20, list: 'bullet' } }).system, /one item per line/);
  assert.throws(() => writingPrompt('sing', { text: 'x' }), /Unknown/);
});

test('[ON-03] the new text is cleaned of fences, quotes and lead-ins', () => {
  assert.equal(cleanWriting('"Bake sale today"'), 'Bake sale today');
  assert.equal(cleanWriting('“Bake sale”'), 'Bake sale');
  assert.equal(cleanWriting('"Quoted" stays', '"Quoted" stays'), '"Quoted" stays');
  assert.equal(cleanWriting('```\nLine one\nLine two\n```'), 'Line one\nLine two');
  assert.equal(cleanWriting("Here's a shorter version:\nBake sale"), 'Bake sale');
  assert.equal(cleanWriting('<text>\nHola\n</text>'), 'Hola');
  assert.equal(cleanWriting('  Plain  '), 'Plain');
});

test('[ON-04] the design prompt names the size, the schema, real fonts and real icons', () => {
  const { system, prompt } = designPrompt('a bake sale poster', { width: 1080, height: 1920 });
  assert.match(prompt, /1080 × 1920 px \(tall\)/);
  assert.match(prompt, /a bake sale poster/);
  assert.match(system, /"texts"/);
  assert.match(system, /Playfair Display/);
  for (const id of system.match(/Icon ids \(use only these\): (.*)\./)[1].split(', ')) assert.ok(iconById(id), id);
  assert.match(designPrompt('x', { count: 3 }).prompt, /3 clearly different designs/);
});

test('[ON-04] JSON is found in fenced, chatty or slightly broken answers', () => {
  assert.deepEqual(parseJsonReply('{"a":1}'), { a: 1 });
  assert.deepEqual(parseJsonReply('```json\n{"a": 1}\n```'), { a: 1 });
  assert.deepEqual(parseJsonReply('Sure! Here it is: {"a": {"b": "a } in a string"}} Hope you like it.'), { a: { b: 'a } in a string' } });
  assert.deepEqual(parseJsonReply('{"a": [1, 2,], }'), { a: [1, 2] });
  assert.deepEqual(parseJsonReply('```\n{"a": 1}'), { a: 1 }, 'an unclosed fence');
  assert.equal(parseJsonReply('no json here'), null);
  assert.equal(parseJsonReply('{"a": '), null);
  assert.equal(parseJsonReply(''), null);
  assert.equal(designSpecs({ designs: [{ a: 1 }, null, 'x', { b: 2 }] }).length, 2);
  assert.equal(designSpecs([{ a: 1 }]).length, 1);
  assert.equal(designSpecs({ name: 'one' }).length, 1);
  assert.equal(designSpecs(null).length, 0);
});

test('[ON-04] a spec becomes a real, valid design, clamped onto the page', () => {
  const doc = specToDesign({
    name: 'Bake sale',
    background: { from: '#FFE4EC', to: 'not a color', colors: ['#ffe4ec', '#e0f0ff'], angle: 120 },
    shapes: [
      { shape: 'circle', x: 0.9, y: 0.9, w: 0.5, h: 0.5, color: '#ffc8dd' },
      { shape: 'rect', x: -1, y: 'x', w: 3, h: 0.2, color: 'pink', rounded: 0.25 },
    ],
    icons: [{ id: 'cake', x: 0.99, y: 0.99, size: 0.2 }, { id: 'nonsense-icon-xyz-123' }, { id: 'coffee', size: 40 }],
    texts: [
      { role: 'title', text: 'Bake Sale', font: 'playfair display', size: 0.12, x: 0.1, y: 0.3, w: 0.8, align: 'center' },
      { role: 'body', text: 'All homemade '.repeat(80), font: 'Comic Sans', x: 0.1, y: 0.9, w: 0.8 },
      { role: 'button', text: 'Saturday', box: '#c93468', y: 5 },
      { role: 'title', text: '   ' },
    ],
  }, { preset: 'portrait' });
  assert.equal(doc.name, 'Bake sale');
  assert.deepEqual([doc.width, doc.height], [1080, 1350]);
  const page = doc.pages[0];
  assert.equal(page.background.type, 'gradient');
  assert.equal(page.background.gradient.angle, 120);
  assert.deepEqual(page.background.gradient.stops.map((s) => s.color), ['#ffe4ec', '#e0f0ff']);
  const els = page.elements;
  assert.deepEqual(els.map((e) => e.type), ['shape', 'shape', 'icon', 'icon', 'text', 'text', 'text']);
  assert.equal(els[0].shape, 'ellipse');
  assert.equal(els[1].fill, '#6c5ce7', 'an unreadable color gets a default');
  assert.equal(els[1].radius, Math.round(0.25 * Math.min(els[1].w, els[1].h)));
  assert.equal(els[2].iconId, 'cake');
  assert.equal(els[3].iconId, 'coffee');
  assert.equal(els[3].w, Math.round(0.4 * 1080), '40 reads as 40%');
  const [title, body, button] = els.filter((e) => e.type === 'text');
  assert.equal(title.font, 'Playfair Display');
  assert.equal(title.weight, 700);
  assert.equal(title.size, Math.round(0.12 * 1080));
  assert.equal(body.font, 'Inter', 'an unknown font falls back');
  assert.ok(body.size < Math.round(0.034 * 1080), 'long text shrinks to fit the space below it');
  assert.equal(button.highlight.color, '#c93468');
  assert.equal(button.color, '#ffffff', 'readable on its box');
  for (const e of els) {
    assert.ok(e.x >= 0 && e.y >= 0 && e.x + e.w <= doc.width && e.y + e.h <= doc.height, `${e.type} ${JSON.stringify([e.x, e.y, e.w, e.h])}`);
    assert.equal(e.fit, undefined, 'no layout marks left');
  }
  // Every id is its own.
  assert.equal(new Set(els.map((e) => e.id)).size, els.length);
});

test('[ON-04] bad specs fall back gracefully', () => {
  // Nothing usable: a readable error.
  assert.throws(() => specToDesign({ texts: [{ text: '' }], icons: [{ id: 'zzzz-qqqq-xxxx' }] }), /nothing to put on the page/);
  assert.throws(() => specToDesign(null), /wasn't a design/);
  assert.throws(() => designsFromReply('I would rather not.'), /wasn't a design/);
  // Unknown sizes are square; documents and whiteboards aren't offered.
  const doc = specToDesign({ background: 42, texts: [{ text: 'Hi' }] }, { preset: 'whiteboard', description: 'a quick hello' });
  assert.deepEqual([doc.width, doc.height], [1080, 1080]);
  assert.equal(doc.document, undefined);
  assert.equal(doc.board, undefined);
  assert.deepEqual(doc.pages[0].elements.map((e) => e.type), ['text']);
  assert.equal(doc.pages[0].background.color, '#ffffff');
  assert.equal(doc.pages[0].elements[0].color, '#1a1a2e', 'dark text on a light page');
  assert.equal(doc.name, 'a quick hello');
  assert.ok(!DESIGN_SIZES.some((p) => p.id === 'doc' || p.id === 'whiteboard'));
  // Light text on a dark page.
  assert.equal(specToDesign({ background: '#111111', texts: [{ text: 'Hi' }] }).pages[0].elements[0].color, '#ffffff');
  // Several in one answer; one broken one is skipped.
  const docs = designsFromReply('```json\n{"designs": [{"texts": [{"text": "One"}]}, {"oops": true}, {"texts": [{"text": "Three"}]}]}\n```', { preset: 'story' });
  assert.deepEqual(docs.map((d) => d.pages[0].elements[0].text), ['One', 'Three']);
  assert.ok(docs.every((d) => d.height === 1920));
});

test('[ON-04] helpers: icons by id or name, fonts to load, clamping', () => {
  assert.equal(iconFor('cake'), 'cake');
  assert.equal(iconFor('lu-anchor'), 'lu-anchor');
  assert.equal(iconFor('anchor'), 'lu-anchor');
  assert.equal(iconFor(''), null);
  const fonts = specFonts({ texts: [{ font: 'Lora', role: 'title' }, { font: 'lora', bold: true }, { font: 'Nope' }] });
  assert.deepEqual(fonts, [{ font: 'Lora', weight: 700 }, { font: 'Inter', weight: 400 }]);
  assert.ok(fonts.every((f) => FONTS.some((x) => x.name === f.font)));
  assert.deepEqual(clampOntoPage({ x: -50, y: 900, w: 300, h: 300 }, 1000, 1000), { x: 0, y: 700, w: 300, h: 300 });
  assert.deepEqual(clampOntoPage({ x: 10, y: 10, w: 3000, h: 50 }, 1000, 1000), { x: 0, y: 10, w: 1000, h: 50 });
});

test('[ON-06] a prompt for any AI chat: the rules, the size and the request in one piece of text', async () => {
  const { chatPrompt, designPrompt } = await import('../../src/model/ai.js');
  const text = chatPrompt('a poster for a bake sale', { width: 1080, height: 1350 });
  const { system, prompt } = designPrompt('a poster for a bake sale', { width: 1080, height: 1350 });
  assert.ok(text.includes(system) && text.includes(prompt), 'everything the provider would get');
  assert.match(text, /1080 × 1350/);
  assert.match(text, /bake sale/);
  assert.match(text, /JSON/);
});
