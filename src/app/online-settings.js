// Settings → Online extras: turn each one on or off, pick its provider, add
// or test a key, or forget them all. Built from FEATURES and PROVIDERS, so a
// new provider or feature shows up here by itself.

import { h, toast, dialog } from './ui.js';
import { toggle, selectField } from './widgets.js';
import { PROVIDERS, FEATURES, providersFor, isOn, setOn, providerFor, setProviderFor, keyFor, setKey, forgetKeys, ollamaUrl, setOllamaUrl, providerFetch } from './online.js';
import { searchUrl, authHeaders } from '../model/photos.js';

/** What each feature sends to its provider, in plain words. */
const SENDS = {
  photos: 'your search words',
  writing: 'the text you ask it to work on',
  design: 'what you describe',
};

/**
 * Check a provider answers (and takes the key) with the cheapest call it
 * has: a one-photo search, or the list of its models.
 */
export async function testProvider(id) {
  const p = PROVIDERS[id];
  const key = p.key ? await keyFor(id) : '';
  if (p.key && !key) throw new Error(`Add your ${p.name} key first.`);
  if (p.for.includes('photos')) return providerFetch(id, searchUrl(id, 'flower', 1, 1), { headers: authHeaders(id, key) });
  if (id === 'claude') return providerFetch(id, 'https://api.anthropic.com/v1/models', { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' } });
  if (id === 'openai') return providerFetch(id, 'https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${key}` } });
  if (id === 'gemini') return providerFetch(id, `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`);
  if (id === 'ollama') return providerFetch(id, `${await ollamaUrl()}/api/tags`);
  throw new Error(`There's no test for ${p.name} yet.`);
}

/** Tell whatever shows online extras (the Photos panel) that a setting changed. */
function changed() {
  window.dispatchEvent(new Event('paperwall:online-changed'));
}

/** The Online extras dialog; `feature` is shown first (when another feature sends someone here). */
export function openOnlineSettings(feature) {
  const body = h('div', { class: 'stack online-settings' });
  dialog('Online extras', body, { testid: 'online-settings', onClose: changed });

  const featureBlock = async (f) => {
    const [on, pid] = await Promise.all([isOn(f), providerFor(f)]);
    const p = PROVIDERS[pid];
    const status = h('p', { class: 'hint', role: 'status', 'data-testid': `online-status-${f}` });
    const key = p.key ? h('input', { type: 'password', value: await keyFor(pid), autocomplete: 'off', spellcheck: 'false', placeholder: `Your ${p.name} key`, 'aria-label': `${p.name} key`, 'data-provider': pid, 'data-testid': `online-key-${f}` }) : null;
    const address = pid === 'ollama' ? h('input', { type: 'url', value: await ollamaUrl(), spellcheck: 'false', 'aria-label': 'Ollama address', 'data-testid': `online-ollama-${f}` }) : null;
    // What's typed is kept as it's typed (keys are long; nobody should lose one to a stray click).
    const keep = async () => {
      if (key) await setKey(pid, key.value);
      if (address) await setOllamaUrl(address.value);
    };
    key?.addEventListener('input', () => {
      // (Another feature using the same provider shows the same key.)
      for (const other of body.querySelectorAll(`input[data-provider="${pid}"]`)) if (other !== key) other.value = key.value;
      keep();
    });
    key?.addEventListener('change', changed);
    address?.addEventListener('input', keep);
    const test = h('button', { type: 'button', class: 'btn small', 'data-testid': `online-test-${f}`, onClick: async () => {
      test.disabled = true;
      status.textContent = 'Testing…';
      try {
        await keep();
        await testProvider(pid);
        status.textContent = `${p.name} answered. All set.`;
      } catch (e) {
        status.textContent = e.message;
      } finally {
        test.disabled = false;
      }
    } }, 'Test');
    return h('section', { class: 'online-feature', 'data-testid': `online-${f}` },
      h('h3', null, FEATURES[f].name),
      toggle({ label: `Turn on ${FEATURES[f].name.replace(/^[A-Z](?=[a-z])/, (c) => c.toLowerCase())}`, checked: on, testid: `online-on-${f}`, onChange: async (v) => {
        await setOn(f, v);
        changed();
      } }),
      selectField({ label: 'Provider', value: pid, testid: `online-provider-${f}`, options: providersFor(f).map((x) => ({ value: x.id, label: x.name })), onChange: async (id) => {
        await setProviderFor(f, id);
        changed();
        draw();
      } }),
      // (One that runs on this device downloads its model once, and sends nothing.)
      h('p', { class: 'hint' }, f === 'cutout'
        ? `Runs on this device: your pictures never leave it. Its model (${p.name}) is downloaded once from ${p.hosts.join(', ')} the first time you use it.`
        : `Sends ${SENDS[f] || 'what you ask it'} to ${p.name}, and only when you use it.`),
      key ? h('label', { class: 'field' }, h('span', null, `${p.name} key`), key) : null,
      address ? h('label', { class: 'field' }, h('span', null, 'Ollama address'), address,
        h('small', null, `Paperwall can reach Ollama at ${p.hosts.join(' or ')}.`)) : null,
      h('div', { class: 'row' },
        f === 'cutout' ? null : test,
        p.key && p.keyUrl ? h('a', { href: p.keyUrl, target: '_blank', rel: 'noopener noreferrer', 'data-testid': `online-get-key-${f}` }, 'Get a key') : null,
        !p.key && p.site ? h('a', { href: p.site, target: '_blank', rel: 'noopener noreferrer' }, `About ${p.name}`) : null),
      status);
  };

  const draw = async () => {
    // The feature asked about first, then the rest.
    const order = Object.keys(FEATURES).sort((a, b) => (b === feature) - (a === feature));
    const blocks = await Promise.all(order.map(featureBlock));
    body.replaceChildren(
      h('p', null, 'Paperwall works fully offline. These extras are off until you turn them on, and each one talks only to the provider you pick.'),
      h('p', { class: 'hint' }, 'Keys stay on this device and go only to their own provider. No ads, no accounts, nothing in between.'),
      ...blocks,
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn small', 'data-testid': 'online-forget-keys', onClick: async () => {
          await forgetKeys();
          toast('All keys are forgotten on this device.');
          changed();
          draw();
        } }, 'Forget all keys')));
  };
  draw();
}
