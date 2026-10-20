// The template library in the real interface, and the quality gate that
// checks every template with the real fonts in a real browser.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { openApp, waitForEditor, state, newDesign, openTab, setup, teardown } from './helpers.js';
import { startServer } from '../../scripts/serve.mjs';
import { TEMPLATES, TEMPLATE_CATEGORIES, searchTemplates } from '../../src/templates/index.js';

after(teardown);

test('[TPL-08] every template passes the quality check with real fonts', { timeout: 600000 }, async () => {
  // Serve the source so the check can load the template modules directly.
  const { browser } = await setup();
  const server = await startServer({ dir: 'src', listenPort: 0 });
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/test/qa/templates.html`);
    await page.waitForFunction(() => window.qaReady);
    const results = await page.evaluate(() => window.qa.run());
    assert.deepEqual(errors, []);
    assert.equal(results.length, TEMPLATES.length);
    const failures = results.filter((r) => r.issues.length).map((r) => `${r.id}: ${r.issues.map((i) => i.message).join('; ')}`);
    assert.deepEqual(failures, [], `${failures.length} templates fail the quality check`);
  } finally {
    await context.close();
    await new Promise((ok) => server.close(ok));
  }
});

test('[TPL-06] 300+ templates in 30+ categories, a page at a time', async () => {
  const { page, context } = await openApp();
  assert.ok(TEMPLATES.length >= 300 && TEMPLATE_CATEGORIES.length >= 30);
  assert.equal(await page.textContent('[data-testid="home-template-count"]'), `${TEMPLATES.length} templates`);
  assert.equal(await page.locator('[data-testid^="home-cat-"]').count(), TEMPLATE_CATEGORIES.length + 1);
  const cards = page.locator('[data-testid="home-templates"] .tpl');
  assert.equal(await cards.count(), 30);
  await page.click('[data-testid="home-templates-more"]');
  assert.equal(await cards.count(), 60);
  // Previews draw as they scroll into view.
  await cards.nth(0).scrollIntoViewIfNeeded();
  await page.waitForSelector('[data-testid="home-templates"] .tpl:first-child .tpl-img svg');
  await page.click('[data-testid="home-cat-Resumes"]');
  assert.equal(await cards.count(), searchTemplates({ category: 'Resumes' }).length);
  await page.click('[data-testid="template-resumes-designer-resume-a"]');
  await waitForEditor(page);
  const doc = await state(page);
  assert.deepEqual([doc.width, doc.height], [2480, 3508]);
  assert.ok(doc.pages[0].elements.some((e) => e.type === 'text' && e.text === 'Jordan Lee'));
  await context.close();
});

test('[TPL-07] multi-page templates open with all their pages', async () => {
  const { page, context } = await openApp();
  await page.fill('[data-testid="home-template-search"]', 'pitch deck');
  assert.match(await page.textContent('[data-testid="template-deck-pitch"] [data-testid="template-pages"]'), /6 pages/);
  await page.click('[data-testid="template-deck-pitch"]');
  await waitForEditor(page);
  const doc = await state(page);
  assert.equal(doc.pages.length, 6);
  assert.deepEqual([doc.width, doc.height], [1920, 1080]);
  assert.equal(await page.locator('[data-testid="page-strip"] [data-testid="page-thumb"]').count(), 6);
  await context.close();

  // From inside the editor, a set is added after the current page.
  const app = await newDesign('square');
  await openTab(app.page, 'templates');
  await app.page.fill('[data-testid="template-search"]', 'menu');
  await app.page.click('[data-testid="template-menu-bistro"]');
  await app.page.waitForFunction(() => window.paperwall.editor.doc.pages.some((p) => p.elements.length));
  await app.page.waitForTimeout(100);
  const after2 = await state(app.page);
  assert.equal(after2.pages.length, 2, 'the blank first page is replaced by both menu pages');
  assert.ok(after2.pages[1].elements.some((e) => e.type === 'text' && e.text === 'Drinks'));
  await app.context.close();
});

test('[TPL-09] filter templates by size', async () => {
  const { page, context } = await openApp();
  await page.selectOption('[data-testid="home-template-format"]', 'story');
  const formats = await page.$$eval('[data-testid="home-templates"] .tpl', (els) => els.map((e) => e.dataset.format));
  assert.ok(formats.length > 0 && formats.every((f) => f === 'story'));
  assert.equal(await page.textContent('[data-testid="home-template-count"]'), `${searchTemplates({ format: 'story' }).length} templates`);
  await page.click('[data-testid="home-cat-Sales"]');
  const both = await page.$$eval('[data-testid="home-templates"] .tpl', (els) => els.map((e) => e.dataset.testid.replace('template-', '')));
  assert.deepEqual(both, searchTemplates({ format: 'story', category: 'Sales' }).map((t) => t.id));
  await context.close();
});
