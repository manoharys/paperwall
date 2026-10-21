// Settings → Online extras: turn each one on or off, pick its provider, add
// or test a key, or forget them all. Built from FEATURES and PROVIDERS, so a
// new provider or feature shows up here by itself.

import { h, toast, dialog } from './ui.js';
import { toggle, selectField } from './widgets.js';
import { PROVIDERS, FEATURES, providersFor, isOn, setOn, providerFor, setProviderFor, keyFor, setKey, forgetKeys, ollamaUrl, setOllamaUrl, providerFetch } from './online.js';
import { searchUrl, authHeaders } from '../model/photos.js';
import { authHeaders as aiHeaders } from '../model/ai.js';
import { t } from './i18n.js';
import { featureName } from './names.js';

/** What each feature sends to its provider, in plain words. */
const SENDS = {
  photos: 'online.sends.photos',
  writing: 'online.sends.writing',
  design: 'online.sends.design',
};

/**
 * Check a provider answers (and takes the key) with the cheapest call it
 * has: a one-photo search, or the list of its models.
 */
export async function testProvider(id) {
  const p = PROVIDERS[id];
  const key = p.key ? await keyFor(id) : '';
  if (p.key && !key) throw new Error(t('ai.addKey', { name: p.name }));
  if (p.for.includes('photos')) return providerFetch(id, searchUrl(id, 'flower', 1, 1), { headers: authHeaders(id, key) });
  // (The same headers real requests send: src/model/ai.js.)
  if (id === 'claude') return providerFetch(id, 'https://api.anthropic.com/v1/models', { headers: aiHeaders(id, key) });
  if (id === 'openai') return providerFetch(id, 'https://api.openai.com/v1/models', { headers: aiHeaders(id, key) });
  if (id === 'gemini') return providerFetch(id, 'https://generativelanguage.googleapis.com/v1beta/models', { headers: aiHeaders(id, key) });
  if (id === 'ollama') return providerFetch(id, `${await ollamaUrl()}/api/tags`);
  throw new Error(t('online.noTest', { name: p.name }));
}

/** Tell whatever shows online extras (the Photos panel) that a setting changed. */
function changed() {
  window.dispatchEvent(new Event('paperwall:online-changed'));
}

/** The Online extras dialog; `feature` is shown first (when another feature sends someone here). */
export function openOnlineSettings(feature) {
  const body = h('div', { class: 'stack online-settings' });
  dialog(t('home.online'), body, { testid: 'online-settings', onClose: changed });

  const featureBlock = async (f) => {
    const [on, pid] = await Promise.all([isOn(f), providerFor(f)]);
    const p = PROVIDERS[pid];
    const status = h('p', { class: 'hint', role: 'status', 'data-testid': `online-status-${f}` });
    const key = p.key ? h('input', { type: 'password', value: await keyFor(pid), autocomplete: 'off', spellcheck: 'false', placeholder: t('online.yourKey', { name: p.name }), 'aria-label': t('ai.keyLabel', { name: p.name }), 'data-provider': pid, 'data-testid': `online-key-${f}` }) : null;
    const address = pid === 'ollama' ? h('input', { type: 'url', value: await ollamaUrl(), spellcheck: 'false', 'aria-label': t('online.ollamaAddress'), 'data-testid': `online-ollama-${f}` }) : null;
    // What's typed is kept as it's typed (keys are long; nobody should lose one to a stray click).
    const keep = async () => {
      // (Throws for an Ollama address it can't use: Test says so, typing just shows it.)
      if (key) await setKey(pid, key.value);
      // (Only addresses the page may reach are kept: anything else would always fail.)
      if (address && !(await setOllamaUrl(address.value))) throw new Error(t('online.ollamaOnly', { hosts: p.hosts.join(t('online.or')) }));
    };
    key?.addEventListener('input', () => {
      // (Another feature using the same provider shows the same key.)
      for (const other of body.querySelectorAll(`input[data-provider="${pid}"]`)) if (other !== key) other.value = key.value;
      keep();
    });
    key?.addEventListener('change', changed);
    address?.addEventListener('input', () => keep().then(() => (status.textContent = ''), (e) => (status.textContent = e.message)));
    const test = h('button', { type: 'button', class: 'btn small', 'data-testid': `online-test-${f}`, onClick: async () => {
      test.disabled = true;
      status.textContent = t('online.testing');
      try {
        await keep();
        await testProvider(pid);
        status.textContent = t('online.allSet', { name: p.name });
      } catch (e) {
        status.textContent = e.message;
      } finally {
        test.disabled = false;
      }
    } }, t('online.test'));
    return h('section', { class: 'online-feature', 'data-testid': `online-${f}` },
      h('h3', null, featureName(f, FEATURES[f].name)),
      toggle({ label: t(`online.turnOn.${f}`), checked: on, testid: `online-on-${f}`, onChange: async (v) => {
        await setOn(f, v);
        changed();
      } }),
      selectField({ label: t('ai.provider'), value: pid, testid: `online-provider-${f}`, options: providersFor(f).map((x) => ({ value: x.id, label: x.name })), onChange: async (id) => {
        await setProviderFor(f, id);
        changed();
        draw();
      } }),
      // (One that runs on this device downloads its model once, and sends nothing.)
      h('p', { class: 'hint' }, f === 'cutout'
        ? t('online.cutoutHint', { name: p.name, host: new URL(p.hosts[0]).host })
        : t(SENDS[f] || 'online.sends.other', { name: p.name })),
      key ? h('label', { class: 'field' }, h('span', null, t('ai.keyLabel', { name: p.name })), key) : null,
      address ? h('label', { class: 'field' }, h('span', null, t('online.ollamaAddress')), address,
        h('small', null, t('online.ollamaAt', { hosts: p.hosts.join(t('online.or')) }))) : null,
      h('div', { class: 'row' },
        f === 'cutout' ? null : test,
        p.key && p.keyUrl ? h('a', { href: p.keyUrl, target: '_blank', rel: 'noopener noreferrer', 'data-testid': `online-get-key-${f}` }, t('ai.getKey')) : null,
        !p.key && p.site ? h('a', { href: p.site, target: '_blank', rel: 'noopener noreferrer' }, t('online.about', { name: p.name })) : null),
      status);
  };

  const draw = async () => {
    // The feature asked about first, then the rest.
    const order = Object.keys(FEATURES).sort((a, b) => (b === feature) - (a === feature));
    const blocks = await Promise.all(order.map(featureBlock));
    body.replaceChildren(
      h('p', null, t('online.intro')),
      h('p', { class: 'hint' }, t('online.keysHint')),
      ...blocks,
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn small', 'data-testid': 'online-forget-keys', onClick: async () => {
          await forgetKeys();
          toast(t('online.forgotten'));
          changed();
          draw();
        } }, t('online.forget'))));
  };
  draw();
}
