import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDesign, createText, createShape, createTable } from '../../src/model/doc.js';
import { approxMeasure, layoutText } from '../../src/model/text-layout.js';
import { shrinkToFit, layoutDesign } from '../../src/model/layout.js';
import { lintPage } from '../../src/model/lint.js';
import { contrast, hexToRgb } from '../../src/model/color.js';
import { iconById, stickerById } from '../../src/model/graphics.js';
import { fontByName } from '../../src/model/fonts.js';
import { PALETTES } from '../../src/templates/kit.js';
import { TEMPLATES, TEMPLATE_CATEGORIES, TEMPLATE_FORMATS, templateDoc, searchTemplates, templateById } from '../../src/templates/index.js';

const design = (elements, bg = '#ffffff') => {
  const doc = createDesign({ width: 1000, height: 1000 });
  doc.pages[0].background = { type: 'color', color: bg };
  doc.pages[0].elements = elements;
  return doc;
};

test('[TPL-08] text shrinks to fit its line limit without breaking words', () => {
  const el = createText({ text: 'Extraordinarily wonderful headline', w: 400, size: 120 });
  assert.ok(layoutText(el, approxMeasure).brokeWord, 'too big to start with');
  assert.ok(shrinkToFit(el, approxMeasure, { maxLines: 2, minSize: 10 }));
  const { lines, brokeWord } = layoutText(el, approxMeasure);
  assert.ok(lines.length <= 2);
  assert.equal(brokeWord, false);
  assert.ok(el.size < 120);
});

test('[TPL-08] flows stack blocks in their region and shrink text that does not fit', () => {
  const doc = design([
    createText({ text: 'Kicker', x: 100, w: 800, size: 30, flow: 'main', fit: { maxLines: 1 } }),
    createText({ text: 'A much longer headline that needs room', x: 100, w: 800, size: 200, flow: 'main', gap: 20, fit: { maxLines: 3, minSize: 20 } }),
    createText({ text: 'Footer', x: 100, w: 800, size: 30, flow: 'main', gap: 20, fit: { maxLines: 1 } }),
  ]);
  doc.pages[0].flows = { main: { y: 300, h: 400, align: 'center' } };
  layoutDesign(doc, approxMeasure);
  const [a, b, c] = doc.pages[0].elements;
  assert.ok(a.y >= 300 && c.y + c.h <= 700, 'stays inside its region');
  assert.equal(b.y, a.y + a.h + 20);
  assert.equal(c.y, b.y + b.h + 20);
  assert.ok(b.size < 200, 'the headline shrank');
  assert.equal(a.size, 30, 'small print kept its size');
  for (const el of doc.pages[0].elements) assert.ok(!('flow' in el) && !('fit' in el) && !('gap' in el), 'layout marks are removed');
  assert.ok(!('flows' in doc.pages[0]));
});

test('[TPL-08] the quality check finds broken words, overflow, overlap and low contrast', () => {
  assert.ok(Math.abs(contrast(hexToRgb('#000000'), hexToRgb('#ffffff')) - 21) < 0.01);
  const ok = design([createText({ text: 'Fine', x: 100, y: 100, w: 400, h: 60, size: 40, color: '#111111' })]);
  assert.deepEqual(lintPage(ok, 0, approxMeasure), []);
  const bad = design([
    createText({ text: 'Unbreakablewordthatistoolong', x: 100, y: 100, w: 100, h: 60, size: 40, color: '#111111' }),
    createText({ text: 'Off the edge', x: 900, y: 500, w: 400, h: 60, size: 40, color: '#111111' }),
    createText({ text: 'Pale', x: 100, y: 700, w: 300, h: 60, size: 40, color: '#eeeeee' }),
    createText({ text: 'On top', x: 120, y: 710, w: 300, h: 60, size: 40, color: '#111111' }),
  ]);
  const kinds = lintPage(bad, 0, approxMeasure).map((x) => x.kind).sort();
  assert.deepEqual(kinds, ['broken-word', 'contrast', 'off-page', 'overlap']);
  // Contrast is judged against the shape behind the text, not just the page.
  const onShape = design([
    createShape('rect', { x: 0, y: 0, w: 1000, h: 500, fill: '#111111' }),
    createText({ text: 'Dark on dark', x: 100, y: 100, w: 600, h: 60, size: 40, color: '#222222' }),
  ]);
  assert.deepEqual(lintPage(onShape, 0, approxMeasure).map((x) => x.kind), ['contrast']);
  // A table or group behind the text can't be judged, so it isn't guessed at.
  const onTable = design([
    createTable({ x: 0, y: 0, w: 1000, h: 500 }),
    createText({ text: 'Over a table', x: 100, y: 100, w: 600, h: 60, size: 40, color: '#eeeeee' }),
  ]);
  assert.deepEqual(lintPage(onTable, 0, approxMeasure), []);
});

test('[TPL-08] every palette has readable pairings', () => {
  for (const [name, p] of Object.entries(PALETTES)) {
    const c = (a, b) => contrast(hexToRgb(a), hexToRgb(b));
    assert.ok(c(p.ink, p.bg) >= 7, `${name}: ink on bg`);
    assert.ok(c(p.ink, p.surface) >= 7, `${name}: ink on surface`);
    assert.ok(c(p.muted, p.bg) >= 4.5, `${name}: muted on bg`);
    assert.ok(c(p.muted, p.surface) >= 4.5, `${name}: muted on surface`);
    assert.ok(c(p.accent, p.bg) >= 3, `${name}: accent on bg`);
    assert.ok(c(p.accent, p.surface) >= 3, `${name}: accent on surface`);
    assert.ok(c(p.onAccent, p.accent) >= 4.5, `${name}: text on accent`);
    assert.ok(stickerById(`blob-${p.stickers}`), `${name}: sticker colorway`);
  }
});

test('[TPL-06] 300+ templates in 30+ categories, all valid', () => {
  assert.ok(TEMPLATES.length >= 300, `${TEMPLATES.length} templates`);
  assert.ok(TEMPLATE_CATEGORIES.length >= 30, `${TEMPLATE_CATEGORIES.length} categories`);
  assert.equal(new Set(TEMPLATES.map((t) => t.id)).size, TEMPLATES.length, 'ids are unique');
  for (const t of TEMPLATES) {
    const doc = templateDoc(t);
    assert.equal(doc.pages.length, t.pages, t.id);
    assert.equal(doc.width, t.width, t.id);
    for (const page of doc.pages) {
      for (const el of page.elements) {
        if (el.type === 'icon') assert.ok(iconById(el.iconId), `${t.id}: icon ${el.iconId}`);
        if (el.type === 'sticker') assert.ok(stickerById(el.stickerId), `${t.id}: sticker ${el.stickerId}`);
        if (el.type === 'text') {
          assert.ok(fontByName(el.font), `${t.id}: font ${el.font}`);
          assert.ok(Number.isFinite(el.y) && el.size > 0, `${t.id}: text placed`);
        }
        assert.ok(!('flow' in el) && !('fit' in el), `${t.id}: layout marks removed`);
      }
    }
  }
});

test('[TPL-07] multi-page sets: decks, a full-year calendar, menus and planners', () => {
  const sets = TEMPLATES.filter((t) => t.pages > 1);
  assert.ok(sets.length >= 10, `${sets.length} sets`);
  assert.equal(templateById('calendar-2027').pages, 12);
  assert.ok(templateById('deck-pitch').pages >= 5);
  const months = templateDoc(templateById('calendar-2027')).pages.map((p) => p.elements.find((e) => e.type === 'text' && e.size > 100)?.text);
  assert.equal(months[0], 'January');
  assert.equal(months[11], 'December');
});

test('[TPL-09] search and filter templates by category and size', () => {
  assert.ok(TEMPLATE_FORMATS.length >= 10);
  const stories = searchTemplates({ format: 'story' });
  assert.ok(stories.length > 20 && stories.every((t) => t.width === 1080 && t.height === 1920));
  const resumes = searchTemplates({ category: 'Resumes' });
  assert.ok(resumes.length >= 3 && resumes.every((t) => t.category === 'Resumes'));
  const both = searchTemplates({ query: 'birthday invitation' });
  assert.ok(both.length >= 1 && both.every((t) => /birthday/i.test(`${t.name} ${t.tags}`)));
  assert.deepEqual(searchTemplates({ query: 'zzzz-nothing' }), []);
});

test('[APP-08] templates are found by words in every language: the hint\'s, the common kinds\' and the categories\'', async () => {
  const { CATALOGS, LANGUAGES, setLanguage } = await import('../../src/app/i18n.js');
  const { templateCategory } = await import('../../src/app/names.js');
  const { templateWords, TEMPLATE_WORD_LANGUAGES } = await import('../../src/app/template-words.js');
  const KINDS = ['invitation', 'resume', 'menu', 'poster', 'flyer', 'birthday', 'wedding', 'business card', 'logo', 'presentation', 'sale'];
  assert.deepEqual(TEMPLATE_WORD_LANGUAGES.sort(), LANGUAGES.map((l) => l.code).filter((c) => c !== 'en').sort());
  try {
    for (const { code } of LANGUAGES) {
      setLanguage(code);
      const words = templateWords(code);
      const find = (query) => searchTemplates({ query, categoryName: templateCategory, synonyms: words });
      // Every kind has a word here (English needs none), and every word finds templates.
      if (code !== 'en') for (const kind of KINDS) assert.ok(Object.values(words).includes(kind), `${code}: a word for ${kind}`);
      for (const word of Object.keys(words)) assert.ok(find(word).length, `${code}: "${word}"`);
      // The words the "no match" hint suggests, each as written there.
      const hinted = [...CATALOGS[code]['tpl.none'].matchAll(/["“„«「]\s*([^"”“»」]+?)\s*["”“»」]/g)].map((m) => m[1]);
      assert.equal(hinted.length, 4, `${code}: ${hinted}`);
      for (const word of hinted) assert.ok(find(word).length, `${code}: hint "${word}"`);
      // Categories as they're named here.
      for (const c of TEMPLATE_CATEGORIES) assert.ok(find(templateCategory(c)).some((tpl) => tpl.category === c), `${code}: ${templateCategory(c)}`);
    }
  } finally {
    setLanguage('en');
  }
});
