import { test } from 'node:test';
import assert from 'node:assert/strict';
import { smartQuote } from '../../src/model/smart-quotes.js';

test('[TXT-24] a typed quote becomes an opening or a closing one by what is before it', () => {
  assert.equal(smartQuote('"', ''), '“');
  assert.equal(smartQuote('"', 'She said '), '“');
  assert.equal(smartQuote('"', 'Hello'), '”');
  assert.equal(smartQuote('"', 'End.'), '”');
  assert.equal(smartQuote('"', '(see '), '“');
  assert.equal(smartQuote('"', 'line\n'), '“', 'a new line opens a quote');
  assert.equal(smartQuote('"', 'wait — '), '“');
  assert.equal(smartQuote('"', 'wait—'), '“', 'right after a dash');
});

test('[TXT-24] an apostrophe is a closing single quote; a single quote opens after a space', () => {
  assert.equal(smartQuote("'", "don"), '’');
  assert.equal(smartQuote("'", 'Maya'), '’');
  assert.equal(smartQuote("'", 'He said '), '‘');
  assert.equal(smartQuote("'", 'He said “'), '‘', 'a single quote inside a double one');
  assert.equal(smartQuote("'", ''), '‘');
});

test('[TXT-24] other characters are left alone', () => {
  for (const c of ['a', '’', '“', ' ', '`', '']) assert.equal(smartQuote(c, 'x'), null);
});
