// Asking an AI provider for text: one complete() over Claude, OpenAI, Gemini
// and Ollama, each with the person's own key (or their own computer, for
// Ollama), and a small setup prompt for when a feature isn't ready yet.
// The requests and answers are shaped in src/model/ai.js.

import { h, clear } from './ui.js';
import { getSetting, setSetting } from './store.js';
import { PROVIDERS, FEATURES, providersFor, isOn, setOn, providerFor, setProviderFor, keyFor, setKey, ollamaUrl, providerFetch } from './online.js';
import { openOnlineSettings } from './online-settings.js';
import { buildRequest, parseResponse, ollamaModelNames, DEFAULT_MODELS, MODEL_CHOICES } from '../model/ai.js';

/** The model picked for a provider (its default until another is). */
export async function modelFor(id) {
  return String((await getSetting(`online|model|${id}`, '')) || '').trim() || DEFAULT_MODELS[id];
}

export async function setModelFor(id, model) {
  await setSetting(`online|model|${id}`, String(model || '').trim());
}

/** Whether a feature can be used now: turned on, and with a key if its provider needs one. */
export async function aiReady(feature) {
  if (!(await isOn(feature))) return false;
  const id = await providerFor(feature);
  return !PROVIDERS[id].key || !!(await keyFor(id));
}

/** Whether an error is the person stopping the request. */
export function isAbort(e) {
  return e?.name === 'AbortError';
}

function aborted() {
  return new DOMException('Stopped', 'AbortError');
}

/**
 * One answer from the provider picked for a feature. Refused (before anything
 * is sent) while the feature is off. `signal` stops it.
 */
export async function complete({ feature, system, prompt, json = false, maxTokens = 4096, signal }) {
  if (!(await isOn(feature))) throw new Error(`${FEATURES[feature].name} is off. Turn it on first.`);
  const id = await providerFor(feature);
  const key = PROVIDERS[id].key ? await keyFor(id) : '';
  if (PROVIDERS[id].key && !key) throw new Error(`Add your ${PROVIDERS[id].name} key first.`);
  const { url, init } = buildRequest(id, { model: await modelFor(id), key, base: await ollamaUrl(), system, prompt, json, maxTokens });
  if (signal?.aborted) throw aborted();
  let data;
  try {
    const res = await providerFetch(id, url, { ...init, signal });
    data = await res.json();
  } catch (e) {
    if (signal?.aborted) throw aborted();
    // (A wrong model name: no such model, or the provider says it's the model.)
    if (/answered 404\b/.test(e.message) || (/answered 400\b/.test(e.message) && /model/i.test(e.message))) throw new Error(`${e.message} Check the model name (${await modelFor(id)}) in the AI setup.`);
    if (e instanceof SyntaxError) throw new Error(`${PROVIDERS[id].name} sent an answer that couldn't be read.`);
    throw e;
  }
  return parseResponse(id, data);
}

/** The models installed in Ollama on this computer. */
export async function ollamaModels() {
  const res = await providerFetch('ollama', `${(await ollamaUrl()).replace(/\/+$/, '')}/api/tags`);
  return ollamaModelNames(await res.json());
}

/**
 * A small inline setup for a feature: turn it on, pick a provider, paste a
 * key, pick a model. `onDone()` once it's saved and ready.
 */
export function aiSetup(feature, { onDone, onCancel } = {}) {
  const box = h('div', { class: 'ai-setup', 'data-testid': 'ai-setup' });
  (async () => {
    const providers = providersFor(feature);
    let id = await providerFor(feature);
    const on = h('input', { type: 'checkbox', 'data-testid': 'ai-setup-on' });
    on.checked = await isOn(feature);
    const pick = h('select', { 'aria-label': 'Provider', 'data-testid': 'ai-setup-provider' }, providers.map((p) => h('option', { value: p.id }, p.name)));
    pick.value = id;
    const keyRow = h('div', { class: 'field' });
    const modelRow = h('div', { class: 'field' });
    const error = h('p', { class: 'ai-error', role: 'alert', 'data-testid': 'ai-setup-error', hidden: true });
    let keyInput = null;
    let modelInput = null;
    let filling = 0;
    const fill = async () => {
      const p = PROVIDERS[id];
      // (Only the latest provider picked fills the rows: arrowing through them starts several.)
      const turn = ++filling;
      const [saved, model] = await Promise.all([p.key ? keyFor(id) : '', modelFor(id)]);
      if (turn !== filling) return;
      clear(keyRow);
      clear(modelRow);
      keyInput = null;
      if (p.key) {
        keyInput = h('input', { type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: saved ? 'Saved on this device (paste to change)' : 'Paste your key', 'aria-label': `${p.name} key`, 'data-testid': 'ai-setup-key' });
        keyRow.append(h('span', null, 'Your key'), keyInput,
          h('small', { class: 'hint' }, 'Kept on this device and sent only to ', p.name, '. ', h('a', { href: p.keyUrl, target: '_blank', rel: 'noopener noreferrer' }, 'Get a key')));
      } else {
        keyRow.append(h('small', { class: 'hint' }, 'No key needed: Ollama runs on your own computer. Start it with OLLAMA_ORIGINS set to allow this page.'));
      }
      const list = h('datalist', { id: `ai-models-${feature}` }, (MODEL_CHOICES[id] || []).map((m) => h('option', { value: m })));
      modelInput = h('input', { type: 'text', value: model, list: list.id, spellcheck: 'false', 'aria-label': 'Model', 'data-testid': 'ai-setup-model' });
      const find = id === 'ollama' ? h('button', { type: 'button', class: 'link-btn', 'data-testid': 'ai-setup-find-models', onClick: async () => {
        // (A request to this computer: only once the feature is turned on.)
        if (!on.checked) return show(`Turn on ${FEATURES[feature].name} first.`);
        try {
          // (Not saved as turned on until Save: Cancel leaves it as it was.)
          const names = await ollamaModels();
          clear(list).append(...names.map((m) => h('option', { value: m })));
          if (names.length && !names.includes(modelInput.value)) modelInput.value = names[0];
          show(names.length ? '' : 'Ollama has no models yet. Run "ollama pull llama3.2" first.');
        } catch (e) {
          show(e.message);
        }
      } }, 'Find installed models') : null;
      modelRow.append(...[h('span', null, 'Model'), modelInput, list, find].filter(Boolean));
    };
    const show = (msg) => {
      error.textContent = msg;
      error.hidden = !msg;
    };
    let filled = null; // the latest fill, which Save waits for (its rows are the ones read)
    pick.addEventListener('change', () => {
      if (pick.value === id) return; // (the same one again: what's typed stays)
      id = pick.value;
      show('');
      filled = fill();
    });
    await (filled = fill());
    box.append(
      h('p', { class: 'hint' }, `${FEATURES[feature].name} is an online extra. What you ask goes to the provider you pick here, and nothing is sent until you turn it on.`),
      h('label', { class: 'toggle' }, on, h('span', null, `Turn on ${FEATURES[feature].name}`)),
      h('label', { class: 'field' }, h('span', null, 'Provider'), pick),
      keyRow,
      modelRow,
      error,
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn small primary', 'data-testid': 'ai-setup-save', onClick: async () => {
          if (!on.checked) return show(`Turn on ${FEATURES[feature].name} to use it.`);
          await filled;
          const typed = keyInput?.value.trim();
          if (PROVIDERS[id].key && !typed && !(await keyFor(id))) return show(`Paste your ${PROVIDERS[id].name} key.`);
          await setOn(feature, true);
          await setProviderFor(feature, id);
          if (typed) await setKey(id, typed);
          await setModelFor(id, modelInput.value);
          onDone?.();
        } }, 'Save and continue'),
        onCancel ? h('button', { type: 'button', class: 'btn small', 'data-testid': 'ai-setup-cancel', onClick: onCancel }, 'Cancel') : null,
        // (Turning it off, forgetting keys, Ollama's address: all the online settings.)
        h('button', { type: 'button', class: 'link-btn', 'data-testid': 'ai-setup-all', onClick: () => openOnlineSettings(feature) }, 'All online settings…')));
  })();
  return box;
}
