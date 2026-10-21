// The interface in the person's language: t(key, vars) for words, numbers
// and dates through Intl, and right-to-left for languages written that way.
// Design content (templates, what people type) is never translated.

import { en } from './locales/en.js';
import { es } from './locales/es.js';
import { fr } from './locales/fr.js';
import { de } from './locales/de.js';
import { ptBR } from './locales/pt-BR.js';
import { hi } from './locales/hi.js';
import { ar } from './locales/ar.js';
import { ja } from './locales/ja.js';
import { kn } from './locales/kn.js';

/** Every language the interface speaks, named in itself. */
export const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Español' },
  { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' },
  { code: 'pt-BR', name: 'Português (Brasil)' },
  { code: 'hi', name: 'हिन्दी' },
  { code: 'ar', name: 'العربية', rtl: true },
  { code: 'ja', name: '日本語' },
  { code: 'kn', name: 'ಕನ್ನಡ' },
];

export const CATALOGS = { en, es, fr, de, 'pt-BR': ptBR, hi, ar, ja, kn };

let lang = 'en';

/** The best language for a list of preferred ones (like navigator.languages). */
export function pickLanguage(wanted = []) {
  const codes = Object.keys(CATALOGS);
  for (const w of [].concat(wanted).filter(Boolean)) {
    const exact = codes.find((c) => c.toLowerCase() === String(w).toLowerCase());
    if (exact) return exact;
    // (Spanish from Mexico gets Spanish; Portuguese from anywhere gets Brazil's.)
    const base = String(w).toLowerCase().split('-')[0];
    const near = codes.find((c) => c.toLowerCase().split('-')[0] === base);
    if (near) return near;
  }
  return 'en';
}

export function language() {
  return lang;
}

export function isRtl(code = lang) {
  return !!LANGUAGES.find((l) => l.code === code)?.rtl;
}

/** Switch the interface's language (and the page's lang and dir with it). */
export function setLanguage(code) {
  lang = CATALOGS[code] ? code : pickLanguage([code]);
  numbers.clear();
  plurals = null;
  if (typeof document !== 'undefined') {
    document.documentElement.lang = lang;
    document.documentElement.dir = isRtl(lang) ? 'rtl' : 'ltr';
  }
  return lang;
}

// Number formats by their options, made once per language.
const numbers = new Map();
let plurals = null;

/** A number as this language writes it (no thousands separators unless asked). */
export function formatNumber(n, opts = {}) {
  const key = JSON.stringify(opts);
  if (!numbers.has(key)) numbers.set(key, new Intl.NumberFormat(lang, { useGrouping: false, maximumFractionDigits: 2, ...opts }));
  return numbers.get(key).format(n);
}

/** A date (and maybe a time) in this language. */
export function formatDate(at, opts = { day: 'numeric', month: 'short', year: 'numeric' }) {
  return new Intl.DateTimeFormat(lang, opts).format(new Date(at));
}

/** "3 minutes ago", "yesterday": how long ago, in this language. */
export function formatAgo(at, now = Date.now()) {
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto', style: 'short' });
  const s = Math.round((at - now) / 1000);
  if (Math.abs(s) < 60) return rtf.format(0, 'second');
  const m = Math.round(s / 60);
  if (Math.abs(m) < 60) return rtf.format(m, 'minute');
  const h = Math.round(m / 60);
  if (Math.abs(h) < 24) return rtf.format(h, 'hour');
  const d = Math.round(h / 24);
  return Math.abs(d) < 30 ? rtf.format(d, 'day') : formatDate(at);
}

/** A language's name in the interface's language (for lists of languages). */
export function languageName(code) {
  try {
    return new Intl.DisplayNames([lang], { type: 'language' }).of(code) || code;
  } catch {
    return code;
  }
}

/** Whether the interface has words for a key. */
export function hasKey(key) {
  return en[key] !== undefined;
}

/** The text for a key: this language's, else English's, else the key itself. */
function lookup(key) {
  const own = CATALOGS[lang]?.[key];
  return own !== undefined ? own : en[key];
}

/** Which plural form a count takes here ('one', 'few', 'other'...). */
function pluralForm(entry, n) {
  plurals ||= new Intl.PluralRules(lang);
  const form = plurals.select(n);
  if (n === 0 && entry.zero !== undefined) return entry.zero;
  return entry[form] ?? entry.other;
}

/**
 * The words for `key`, with {placeholders} filled from `vars`. Numbers are
 * written as this language writes them. An entry with plural forms
 * ({ one, other, ... }) picks its form by vars.n.
 */
export function t(key, vars) {
  let text = lookup(key);
  if (text === undefined) return key;
  if (typeof text === 'object') text = pluralForm(text, vars?.n ?? 0);
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (all, name) => {
    const v = vars[name];
    if (v === undefined || v === null) return all;
    return typeof v === 'number' ? formatNumber(v) : String(v);
  });
}

/**
 * Like t(), but placeholders can be DOM nodes (a link in a sentence):
 * returns the pieces in order, ready to append.
 */
export function tn(key, vars = {}) {
  const nodes = {};
  const plain = {};
  for (const [k, v] of Object.entries(vars)) {
    if (v && typeof v === 'object' && 'nodeType' in v) nodes[k] = v;
    else plain[k] = v;
  }
  const text = t(key, plain);
  const out = [];
  let at = 0;
  for (const m of text.matchAll(/\{(\w+)\}/g)) {
    if (!nodes[m[1]]) continue;
    if (m.index > at) out.push(text.slice(at, m.index));
    out.push(nodes[m[1]]);
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

/** The {placeholders} a catalog entry uses (for checking translations). */
export function placeholders(entry) {
  const forms = typeof entry === 'object' ? Object.values(entry) : [entry];
  return new Set(forms.flatMap((s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1])));
}
