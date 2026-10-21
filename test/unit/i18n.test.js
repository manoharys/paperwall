// The interface's languages: every locale has every key, with the same
// {placeholders}, plural forms its language uses, and nothing extra.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { CATALOGS, LANGUAGES, t, setLanguage, pickLanguage, placeholders, formatNumber, language } from '../../src/app/i18n.js';

const en = CATALOGS.en;
const same = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
const show = (s) => `{${[...s].join(', ')}}`;

for (const { code } of LANGUAGES.filter((l) => l.code !== 'en')) {
  test(`${code} has every key, with the same placeholders`, () => {
    const cat = CATALOGS[code];
    const missing = Object.keys(en).filter((k) => !(k in cat));
    const extra = Object.keys(cat).filter((k) => !(k in en));
    assert.deepEqual(missing, [], `${code} is missing keys`);
    assert.deepEqual(extra, [], `${code} has keys English doesn't`);
    const forms = new Set(new Intl.PluralRules(code).resolvedOptions().pluralCategories);
    for (const [key, want] of Object.entries(en)) {
      const got = cat[key];
      if (typeof want === 'string') {
        assert.equal(typeof got, 'string', `${code} ${key}: a string`);
        assert.ok(got.trim().length || !want.trim().length, `${code} ${key}: empty`);
        assert.ok(same(placeholders(got), placeholders(want)), `${code} ${key}: ${show(placeholders(got))}, English has ${show(placeholders(want))}`);
      } else {
        assert.equal(typeof got, 'object', `${code} ${key}: plural forms`);
        assert.ok(typeof got.other === 'string' && got.other.trim(), `${code} ${key}: an "other" form`);
        assert.ok(same(placeholders(got.other), placeholders(want.other)), `${code} ${key}: ${show(placeholders(got.other))} in "other", English has ${show(placeholders(want.other))}`);
        for (const [form, text] of Object.entries(got)) {
          assert.ok(forms.has(form), `${code} ${key}: "${form}" isn't a plural form in ${code} (${[...forms]})`);
          for (const p of placeholders(text)) assert.ok(placeholders(want.other).has(p), `${code} ${key}.${form}: unknown {${p}}`);
        }
      }
    }
  });
}

test('every t() key in the app is in the English catalog', () => {
  const dir = new URL('../../src/app/', import.meta.url);
  const missing = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    const src = readFileSync(new URL(f, dir), 'utf8');
    for (const m of src.matchAll(/\btn?\(\s*'([^']+)'/g)) if (!(m[1] in en)) missing.push(`${f}: ${m[1]}`);
  }
  assert.deepEqual(missing, []);
});

test('the browser\'s language picks the interface, near matches included', () => {
  assert.equal(pickLanguage(['es-MX', 'en']), 'es');
  assert.equal(pickLanguage(['zz', 'fr-CA']), 'fr');
  assert.equal(pickLanguage(['zz']), 'en');
  assert.equal(pickLanguage([]), 'en');
});

test('t fills placeholders, picks plural forms and falls back to English', () => {
  try {
    setLanguage('en');
    assert.equal(t('common.pages', { n: 1 }), '1 page');
    assert.equal(t('common.pages', { n: 3 }), '3 pages');
    assert.equal(t('home.openDesign', { name: 'Flyer' }), 'Open Flyer');
    assert.equal(t('no.such.key'), 'no.such.key');
    setLanguage('es');
    assert.equal(language(), 'es');
    assert.equal(t('common.pages', { n: 2 }), '2 páginas');
    assert.equal(formatNumber(1.5), '1,5');
  } finally {
    setLanguage('en');
  }
});
