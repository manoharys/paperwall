import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { openApp, newDesign, teardown } from './helpers.js';

after(teardown);

const look = (page) => page.evaluate(async () => {
  await document.fonts.ready;
  const visible = [...document.querySelectorAll('body *')].filter((e) => e.offsetParent && e.textContent.trim() && !e.closest('[data-testid="page"]'));
  return {
    font: getComputedStyle(document.body).fontFamily,
    plexLoaded: document.fonts.check('16px "IBM Plex Sans"'),
    shouted: visible.filter((e) => getComputedStyle(e).textTransform === 'uppercase').map((e) => e.textContent.trim().slice(0, 30)),
    shapes: [...document.querySelectorAll('.preset-shape')].map((e) => getComputedStyle(e).backgroundImage),
  };
});

test('the interface speaks in IBM Plex Sans, in sentence case, with size cards drawn to shape', async () => {
  const { page, context, errors } = await openApp();
  const home = await look(page);
  assert.match(home.font, /^"?IBM Plex Sans"?/, home.font);
  assert.ok(home.plexLoaded, 'the interface font is loaded');
  assert.deepEqual(home.shouted, [], 'no all-caps labels on the home screen');
  assert.ok(home.shapes.length > 5);
  for (const bg of home.shapes) assert.equal(bg, 'none', 'size cards are outlines, not one gradient for all');
  await context.close();
  const { page: ed, context: c2 } = await newDesign('square');
  assert.deepEqual((await look(ed)).shouted, [], 'no all-caps labels in the editor');
  assert.deepEqual(errors, []);
  await c2.close();
});
