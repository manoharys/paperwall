// APP-08: the interface in nine languages, right to left included. The
// browser's own language picks it; the picker (home screen and More menu)
// changes it, and the choice is kept.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { openApp, newDesign, teardown, waitForEditor, addText, openTab } from './helpers.js';
import { audit } from './audit.js';
import { CATALOGS, LANGUAGES } from '../../src/app/i18n.js';

after(teardown);

const say = (code, key) => {
  const v = CATALOGS[code][key];
  return typeof v === 'object' ? v.other : v;
};

/** Text on screen that is a catalog key itself (a word that was never looked up). */
async function rawKeys(page) {
  const text = await page.innerText('body');
  return Object.keys(CATALOGS.en).filter((k) => text.includes(k));
}

/**
 * Pick a language from the home screen's picker (or the editor's More menu,
 * open already) and wait until the screen is drawn again in it.
 */
async function pick(page, code, where = 'language-select') {
  await page.selectOption(`[data-testid="${where}"]`, code);
  const [sel, words] = where === 'menu-language' ? ['[data-testid="download"]', say(code, 'common.download')] : ['.block h2', say(code, 'home.create')];
  await page.waitForFunction(([c, s, w]) => document.documentElement.lang === c && document.querySelector(s)?.textContent.trim() === w, [code, sel, words]);
}

test('[APP-08] the browser\'s language picks the interface', async () => {
  for (const [locale, code] of [['es-MX', 'es'], ['de-DE', 'de'], ['ja-JP', 'ja'], ['pt-PT', 'pt-BR']]) {
    const { page, context } = await openApp({ locale });
    assert.equal(await page.getAttribute('html', 'lang'), code, locale);
    assert.equal(await page.textContent('.block h2'), say(code, 'home.create'), locale);
    assert.equal(await page.inputValue('[data-testid="language-select"]'), code);
    await context.close();
  }
  // A language Paperwall doesn't have yet: English.
  const { page, context } = await openApp({ locale: 'sv-SE' });
  assert.equal(await page.getAttribute('html', 'lang'), 'en');
  await context.close();
});

test('[APP-08] switching language changes the interface at once and is kept after a reload', async () => {
  const { page, context, errors } = await openApp();
  assert.match(await page.innerText('main'), /Create a design/);
  await pick(page, 'de');
  const home = await page.innerText('main');
  assert.match(home, new RegExp(say('de', 'home.create')));
  assert.match(home, new RegExp(say('de', 'home.templates')));
  assert.ok(!/Create a design/.test(home), 'no English left over');
  assert.equal(await page.title(), say('de', 'app.title'));
  await page.reload();
  await page.waitForSelector('[data-testid="presets"]');
  assert.equal(await page.getAttribute('html', 'lang'), 'de');
  assert.match(await page.innerText('main'), new RegExp(say('de', 'home.create')));
  // The editor speaks it too: buttons, panels, labels, tooltips.
  await page.click('[data-testid="preset-square"]');
  await waitForEditor(page);
  assert.equal((await page.textContent('[data-testid="download"]')).trim(), say('de', 'common.download'));
  assert.equal(await page.getAttribute('[data-testid="undo"]', 'aria-label'), say('de', 'top.undo').replace('{keys}', 'Ctrl+Z'));
  assert.equal((await page.textContent('[data-testid="rail-text"]')).trim(), say('de', 'insert.tabText'));
  await addText(page);
  assert.equal(await page.textContent('[data-testid="selection-title"]'), say('de', 'type.text'));
  // Text added now starts in the language too.
  assert.equal((await page.evaluate(() => window.paperwall.editor.single.text)), say('de', 'newText.heading'));
  // Switched from the More menu, in the editor: French, kept after a reload.
  await page.click('[data-testid="main"]');
  assert.equal(await page.inputValue('[data-testid="menu-language"]'), 'de');
  await pick(page, 'fr', 'menu-language');
  await waitForEditor(page);
  // Focus is back on the More button, in the editor drawn again.
  await page.waitForFunction(() => document.activeElement?.dataset.testid === 'main');
  await page.reload();
  await waitForEditor(page);
  assert.equal(await page.getAttribute('html', 'lang'), 'fr');
  assert.equal((await page.textContent('[data-testid="download"]')).trim(), say('fr', 'common.download'));
  assert.deepEqual(await rawKeys(page), []);
  // The design's own text isn't translated: it stays as written.
  assert.equal(await page.evaluate(() => window.paperwall.editor.doc.pages[0].elements[0].text), say('de', 'newText.heading'));
  assert.deepEqual(errors, []);
  await context.close();
});

test('[APP-08] switching language in the editor keeps the design as it is: undo, selection and page', async () => {
  const { page, context, errors } = await newDesign('square');
  await page.evaluate(() => window.paperwall.editor.addPage());
  const el = await addText(page);
  const was = await page.evaluate(() => {
    const ed = window.paperwall.editor;
    window.editorBefore = ed;
    return { page: ed.page, selection: ed.selection, versions: ed.versionAt };
  });
  assert.equal(was.page, 1);
  await page.click('[data-testid="main"]');
  await pick(page, 'es', 'menu-language');
  await page.waitForFunction(() => document.activeElement?.dataset.testid === 'main');
  const now = await page.evaluate(() => {
    const ed = window.paperwall.editor;
    return { same: ed === window.editorBefore, page: ed.page, selection: ed.selection, versions: ed.versionAt, canUndo: ed.history.canUndo };
  });
  assert.deepEqual(now, { ...was, same: true, canUndo: true });
  assert.equal((await page.textContent('[data-testid="rail-text"]')).trim(), say('es', 'insert.tabText'));
  assert.equal(await page.locator('[data-testid="page-thumb"]').count(), 2);
  // Undo still takes back the text just added, on the same page.
  await page.click('[data-testid="undo"]');
  assert.deepEqual(await page.evaluate((id) => {
    const ed = window.paperwall.editor;
    return [ed.page, !!ed.find(id)];
  }, el.id), [1, false]);
  assert.deepEqual(errors, []);
  await context.close();
});

test('[APP-08] Arabic lays the interface out right to left; the page itself stays as designed', async () => {
  const { page, context, errors } = await openApp();
  await pick(page, 'ar');
  assert.equal(await page.getAttribute('html', 'dir'), 'rtl');
  assert.equal(await page.getAttribute('html', 'lang'), 'ar');
  assert.match(await page.innerText('main'), new RegExp(say('ar', 'home.create')));
  await page.click('[data-testid="preset-square"]');
  await waitForEditor(page);
  const box = (sel) => page.evaluate((s) => document.querySelector(s).getBoundingClientRect().toJSON(), sel);
  const [rail, stage, inspector, name, download] = await Promise.all(['.rail', '[data-testid="stage"]', '[data-testid="inspector"]', '[data-testid="doc-name"]', '[data-testid="download"]'].map(box));
  // Mirrored: the add rail on the right, properties on the left, Download at the left end of the top bar.
  assert.ok(rail.left > stage.right - 1, 'the rail is right of the canvas');
  assert.ok(inspector.right < stage.left + 1, 'the properties are left of the canvas');
  assert.ok(download.right < name.left, 'Download comes after the name, reading right to left');
  // The canvas and its rulers keep left to right: designs aren't mirrored.
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="stage"]')).direction), 'ltr');
  // Text being edited reads whichever way it's written.
  await addText(page);
  assert.equal(await page.textContent('[data-testid="selection-title"]'), say('ar', 'type.text'));
  assert.deepEqual(await audit(page), []);
  assert.deepEqual(await rawKeys(page), []);
  // Back to English: left to right again.
  await page.click('[data-testid="main"]');
  await pick(page, 'en', 'menu-language');
  await waitForEditor(page);
  assert.equal(await page.getAttribute('html', 'dir'), 'ltr');
  assert.deepEqual(errors, []);
  await context.close();
});

test('[APP-08] numbers, dates and counts are written the local way', async () => {
  const { page, context } = await openApp();
  await pick(page, 'de');
  // A thousands separator where German uses one.
  await page.click('[data-testid="preset-square"]');
  await waitForEditor(page);
  await openTab(page, 'graphics');
  assert.match(await page.getAttribute('[data-testid="insert-search"]', 'placeholder'), /\d\.\d{3} Symbole/);
  // Plural forms: one page, two pages.
  await page.click('[data-testid="page-grid-btn"]');
  assert.match(await page.textContent('[data-testid="page-grid-dialog"] h2'), /\(1\)/);
  await page.keyboard.press('Escape');
  // A date in the version history, and "now" on the home screen.
  await page.click('[data-testid="history-btn"]');
  await page.waitForSelector('[data-testid="version"]');
  assert.match(await page.textContent('[data-testid="version"] b'), /^Heute, \d{1,2}:\d{2}$/);
  assert.ok((await page.textContent('[data-testid="version"] small')).includes(CATALOGS.de['common.pages'].one.replace('{n}', '1')));
  await page.keyboard.press('Escape');
  await page.click('[data-testid="home-link"]');
  await page.waitForSelector('[data-testid="design-card"]');
  assert.match(await page.textContent('[data-testid="design-card"] small'), /jetzt|vor \d+ Sek\./);
  // Japanese has no plural: the same word for any number.
  await pick(page, 'ja');
  assert.match(await page.textContent('[data-testid="home-template-count"]'), /^\d+ 個のテンプレート$/);
  await context.close();
});

test('[APP-08] every language covers the whole interface', async () => {
  const { page, context, errors } = await openApp();
  for (const { code } of LANGUAGES) {
    await pick(page, code);
    const main = await page.innerText('main');
    for (const key of ['home.create', 'home.templates', 'home.yours']) assert.ok(main.includes(say(code, key)), `${code}: ${key}`);
    assert.equal(await page.getAttribute('html', 'dir'), code === 'ar' ? 'rtl' : 'ltr');
    assert.deepEqual(await rawKeys(page), [], code);
  }
  // And in the editor, each language's own words on every panel.
  await pick(page, 'kn');
  await page.click('[data-testid="preset-square"]');
  await waitForEditor(page);
  for (const tab of ['templates', 'text', 'shapes', 'graphics', 'uploads', 'charts', 'qr', 'brand']) {
    await openTab(page, tab);
    assert.equal((await page.textContent(`[data-testid="rail-${tab}"]`)).trim(), say('kn', `insert.tab${tab === 'qr' ? 'Qr' : tab[0].toUpperCase() + tab.slice(1)}`));
    assert.deepEqual(await rawKeys(page), [], tab);
  }
  await page.click('[data-testid="shortcuts-btn"]');
  assert.match(await page.innerText('[data-testid="shortcuts"]'), new RegExp(say('kn', 'shortcut.undo')));
  await page.keyboard.press('Escape');
  assert.deepEqual(errors, []);
  await context.close();
});
