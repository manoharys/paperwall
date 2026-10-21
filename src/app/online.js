// Online extras (opt-in). Paperwall works without them; each one talks to a
// provider the person picks, and nothing goes online until they turn it on.
// Keys stay on this device (in its settings) and go only to their provider.

import { getSetting, setSetting, del } from './store.js';
import { PROVIDERS, FEATURES } from '../model/providers.js';

export { PROVIDERS, FEATURES };

/** Providers that can do a feature. */
export function providersFor(feature) {
  return Object.entries(PROVIDERS).filter(([, p]) => p.for.includes(feature)).map(([id, p]) => ({ id, ...p }));
}

/** Whether the person has turned a feature on (off until they do). */
export async function isOn(feature) {
  return (await getSetting(`online|on|${feature}`, false)) === true;
}

export async function setOn(feature, on) {
  await setSetting(`online|on|${feature}`, !!on);
}

/** The provider picked for a feature. */
export async function providerFor(feature) {
  const id = await getSetting(`online|provider|${feature}`, null);
  return PROVIDERS[id]?.for.includes(feature) ? id : FEATURES[feature].default;
}

export async function setProviderFor(feature, id) {
  if (!PROVIDERS[id]?.for.includes(feature)) throw new Error(`${id} can't do ${feature}`);
  await setSetting(`online|provider|${feature}`, id);
}

/** A provider's key, or '' (only on this device). */
export async function keyFor(id) {
  return (await getSetting(`online|key|${id}`, '')) || '';
}

export async function setKey(id, key) {
  const k = String(key || '').trim();
  // (An empty key isn't kept at all.)
  await (k ? setSetting(`online|key|${id}`, k) : del('settings', `online|key|${id}`));
}

/** Forget every key on this device. */
export async function forgetKeys() {
  await Promise.all(Object.keys(PROVIDERS).map((id) => del('settings', `online|key|${id}`)));
}

/** Ollama's address (it runs on the person's own computer). */
export async function ollamaUrl() {
  return (await getSetting('online|ollama', 'http://localhost:11434')) || 'http://localhost:11434';
}

/** Keep Ollama's address, if it's one Paperwall can reach (returns whether it was kept). */
export async function setOllamaUrl(url) {
  const clean = String(url || '').trim().replace(/\/+$/, '');
  if (!PROVIDERS.ollama.hosts.includes(clean)) return false;
  await setSetting('online|ollama', clean);
  return true;
}

/**
 * Fetch from a provider, with a readable error. Only its own hosts: anything
 * else is refused here (and by the page's security policy).
 */
export async function providerFetch(id, url, init = {}) {
  const p = PROVIDERS[id];
  if (!p || !p.hosts.some((h) => url.startsWith(`${h}/`) || url === h)) throw new Error(`Not a ${p?.name || id} address`);
  let res;
  try {
    res = await fetch(url, { ...init, credentials: 'omit', referrerPolicy: 'no-referrer' });
  } catch {
    throw new Error(id === 'ollama' ? "Couldn't reach Ollama. Is it running, with OLLAMA_ORIGINS set to allow this page?" : `Couldn't reach ${p.name}. Are you online?`);
  }
  if (res.status === 401 || res.status === 403) throw new Error(`${p.name} didn't accept the key. Check it in Settings → Online extras.`);
  if (res.status === 429) throw new Error(`${p.name} says too many requests. Try again in a little while.`);
  if (!res.ok) throw new Error(`${p.name} answered ${res.status}.`);
  return res;
}
