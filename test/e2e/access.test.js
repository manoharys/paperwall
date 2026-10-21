// APP-09: Paperwall works with a keyboard alone and with screen readers.
// An automated audit of every screen, then whole tasks done without a mouse.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { openApp, newDesign, teardown, waitForEditor, elements, selection, state, settled, addText, addShape, openTab, makePng, uploadImages } from './helpers.js';
import { audit, contrastProblems, tabTo, focused } from './audit.js';

after(teardown);

// The interface text worth checking for contrast, everywhere it shows.
const TEXT = [
  'body', 'h1', 'h2', 'h3', '.lead', '.hint', '.fine', '.empty-note', '.btn', '.btn.primary', '.chip', '.chip.on', '.link-btn', 'a',
  '.preset b', '.preset small', '.design-meta small', '.tpl-name', '.tpl-meta', '.tpl-count', '.rail button span', '.tabs button',
  '.panel-section h3', '.field > span', '.toggle span', '.segmented button', '.badge', '.layer-name', '.zoom-label', '.toast',
  '.shortcuts td', 'kbd', '.dialog h2', '.home-foot p', '.custom-size .label', '.text-add', '.pair small', '.fx small', '.anim', '.duo',
];

async function noProblems(page, where) {
  const found = await audit(page);
  assert.deepEqual(found, [], `${where}: ${found.join('; ')}`);
}

test('the audit itself catches what it looks for', async () => {
  const { page, context } = await openApp();
  await page.evaluate(() => {
    const bad = document.createElement('div');
    bad.innerHTML = '<button id="twice"></button><input id="twice"><img src="data:,"><div class="dialog">x</div><p class="hint" style="color:#ddd;background:#fff">faint</p>';
    document.querySelector('main').append(bad);
  });
  const found = (await audit(page)).join('\n');
  for (const want of ['no accessible name: <button', 'no accessible name: <input', 'id used 2 times: #twice', 'image without alt', 'dialog without role=dialog', 'dialog without aria-modal']) assert.ok(found.includes(want), want);
  const { problems } = await contrastProblems(page, ['.hint']);
  assert.ok(problems.some((p) => p.includes('faint')), 'low contrast found');
  await context.close();
});

test('[APP-09] every screen passes the audit: names, ids, alt text, dialogs', async () => {
  const { page, context, errors } = await openApp();
  await noProblems(page, 'home');
  await page.click('[data-testid="preset-square"]');
  await waitForEditor(page);
  await noProblems(page, 'editor, page panel');
  await addText(page);
  await noProblems(page, 'text selected');
  await addShape(page, 'Star');
  await noProblems(page, 'shape selected');
  await page.click('[data-testid="fill-color"]');
  await page.waitForSelector('[data-testid="color-popover"]');
  await noProblems(page, 'color picker');
  await page.keyboard.press('Escape');
  await uploadImages(page, [await makePng(page)]);
  await noProblems(page, 'image selected, uploads open');
  await page.click('[data-testid="tab-layers"]');
  await noProblems(page, 'layers');
  for (const tab of ['templates', 'graphics', 'charts', 'draw', 'qr', 'brand']) {
    await openTab(page, tab);
    await noProblems(page, `${tab} panel`);
  }
  await openTab(page, 'templates');
  const dialogs = [
    ['download', 'export-dialog'], ['find-btn', 'find-dialog'], ['history-btn', 'history-dialog'], ['shortcuts-btn', 'shortcuts'],
    ['resize-design', 'resize-dialog'], ['page-grid-btn', 'page-grid-dialog'],
  ];
  await page.click('[data-testid="tab-edit"]');
  await page.keyboard.press('Escape');
  for (const [button, shows] of dialogs) {
    await page.click(`[data-testid="${button}"]`);
    await page.waitForSelector(`[data-testid="${shows}"]`);
    await noProblems(page, shows);
    await page.keyboard.press('Escape');
    await page.waitForSelector('.backdrop', { state: 'detached' });
  }
  for (const menu of ['main', 'view']) {
    await page.click(`[data-testid="${menu}"]`);
    await noProblems(page, `${menu} menu`);
    await page.keyboard.press('Escape');
  }
  await page.click('[data-testid="main"]');
  await page.click('[data-testid="menu-online"]');
  await page.waitForSelector('[data-testid="online-settings"] [data-testid="online-test-writing"]');
  await noProblems(page, 'online extras');
  await page.keyboard.press('Escape');
  assert.deepEqual(errors, []);
  await context.close();
});

test('[APP-09] interface text meets WCAG AA contrast, light and dark', async () => {
  for (const scheme of ['light', 'dark']) {
    const { page, context } = await openApp({ colorScheme: scheme });
    const checked = new Set();
    const look = async (where) => {
      const { problems, checked: seen } = await contrastProblems(page, TEXT);
      for (const s of seen) checked.add(s);
      assert.deepEqual(problems, [], `${scheme}, ${where}: ${problems.join('\n')}`);
    };
    await look('home');
    await page.click('[data-testid="preset-square"]');
    await waitForEditor(page);
    await look('editor');
    await addText(page);
    await look('text panel');
    await page.click('[data-testid="tab-layers"]');
    await look('layers');
    await page.click('[data-testid="download"]');
    await page.waitForSelector('[data-testid="export-dialog"]');
    await look('download dialog');
    await page.keyboard.press('Escape');
    await page.click('[data-testid="shortcuts-btn"]');
    await look('shortcuts');
    await page.keyboard.press('Escape');
    // Enough of the interface was looked at to mean something.
    for (const s of ['h2', '.hint', '.btn', '.btn.primary', '.tabs button', '.field > span', '.layer-name', 'kbd']) assert.ok(checked.has(s), `${scheme}: ${s} was checked`);
    await context.close();
  }
});

test('[APP-09] dialogs keep focus inside, close with Escape and give focus back', async () => {
  const { page, context } = await newDesign('square');
  await page.focus('[data-testid="download"]');
  await page.keyboard.press('Enter');
  await page.waitForSelector('[data-testid="export-dialog"]');
  const inside = () => page.evaluate(() => !!document.activeElement?.closest('[data-testid="export-dialog"]'));
  assert.ok(await inside(), 'focus moves into the dialog');
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press(i % 3 ? 'Tab' : 'Shift+Tab');
    assert.ok(await inside(), `focus stays in the dialog (press ${i + 1})`);
  }
  const box = await page.$('[data-testid="export-dialog"]');
  assert.equal(await box.getAttribute('role'), 'dialog');
  assert.equal(await box.getAttribute('aria-modal'), 'true');
  assert.ok(await box.getAttribute('aria-label'));
  await page.keyboard.press('Escape');
  await page.waitForSelector('[data-testid="export-dialog"]', { state: 'detached' });
  assert.equal(await focused(page), 'download', 'focus is back on the button that opened it');
  // The same for a popover: Escape closes it and focus returns to its button.
  await page.focus('[data-testid="bg-color"]');
  await page.keyboard.press('Enter');
  await page.waitForSelector('[data-testid="color-popover"]');
  assert.equal(await focused(page), 'hex-input', 'the color picker opens on its hex code');
  await page.keyboard.press('Escape');
  await page.waitForSelector('[data-testid="color-popover"]', { state: 'detached' });
  assert.equal(await focused(page), 'bg-color');
  // A dialog opened from a menu gives focus back to the menu's button.
  await page.focus('[data-testid="main"]');
  await page.keyboard.press('Enter');
  await page.waitForSelector('[data-testid="menu-online"]');
  await page.focus('[data-testid="menu-online"]');
  await page.keyboard.press('Enter');
  await page.waitForSelector('[role="dialog"]');
  await page.keyboard.press('Escape');
  await page.waitForSelector('[role="dialog"]', { state: 'detached' });
  assert.equal(await focused(page), 'main', 'More > Online extras…, then Escape: back on More');
  await context.close();
});

test('[APP-09] every control shows where keyboard focus is', async () => {
  const { page, context } = await newDesign('square');
  await addShape(page, 'Square');
  await page.focus('[data-testid="home-link"]');
  const missing = [];
  const seen = new Set();
  for (let i = 0; i < 90; i++) {
    await page.keyboard.press('Tab');
    const r = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      const outlined = (s) => s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0;
      // (A search box rings the whole box around its field.)
      const box = el.closest('.search');
      const ring = outlined(cs) || (cs.boxShadow && cs.boxShadow !== 'none') || (box && outlined(getComputedStyle(box)));
      // (A text box shows its caret and border instead.)
      const field = el.matches('input, textarea, select') && (cs.borderStyle !== 'none' || cs.backgroundColor !== 'rgba(0, 0, 0, 0)');
      return { id: el.dataset.testid || el.getAttribute('aria-label') || el.tagName, ok: ring || field };
    });
    if (!r) continue;
    seen.add(r.id);
    if (!r.ok) missing.push(r.id);
  }
  assert.ok(seen.size > 30, `Tab reached ${seen.size} controls`);
  assert.deepEqual(missing, [], 'controls without a visible focus outline');
  await context.close();
});

test('[APP-09] keyboard alone: create a design, add text and a shape, select, move, resize, recolor and download', async () => {
  const { page, context, errors } = await openApp();
  // Home: Tab to a preset and press Enter.
  await tabTo(page, '[data-testid="preset-square"]');
  await page.keyboard.press('Enter');
  await waitForEditor(page);
  // The first Tab stop is "skip to the canvas".
  await page.keyboard.press('Tab');
  assert.equal(await focused(page), 'skip-to-canvas');
  // Add a heading from the Text panel.
  await tabTo(page, '[data-testid="rail-text"]');
  await page.keyboard.press('Enter');
  await tabTo(page, '[data-testid="add-heading"]');
  await page.keyboard.press('Enter');
  assert.equal((await elements(page)).length, 1);
  // And a square from Shapes.
  await tabTo(page, '[data-testid="rail-shapes"]');
  await page.keyboard.press('Enter');
  await tabTo(page, '[data-testid="shape-Square"]');
  await page.keyboard.press('Enter');
  let els = await elements(page);
  assert.equal(els.length, 2);
  const [text, square] = els;
  // On the canvas, Tab picks elements one by one, and each is announced.
  await tabTo(page, '[data-testid="stage"]');
  await page.keyboard.press('Escape');
  assert.deepEqual(await selection(page), []);
  await page.keyboard.press('Tab');
  assert.deepEqual(await selection(page), [text.id]);
  await page.waitForFunction(() => /selected, 1 of 2/.test(document.querySelector('[data-testid="announcer"]').textContent));
  await page.keyboard.press('Tab');
  assert.deepEqual(await selection(page), [square.id]);
  assert.equal(await focused(page), 'stage', 'Tab stays on the canvas while it picks');
  await page.waitForFunction(() => /^Rectangle selected, 2 of 2$/.test(document.querySelector('[data-testid="announcer"]').textContent));
  await page.keyboard.press('Shift+Tab');
  assert.deepEqual(await selection(page), [text.id], 'Shift+Tab goes back');
  await page.keyboard.press('Tab');
  // Arrows move it; with Shift by 10; with Alt they resize.
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Alt+ArrowRight');
  await page.keyboard.press('Alt+Shift+ArrowDown');
  const moved = (await elements(page)).find((e) => e.id === square.id);
  assert.equal(moved.x, square.x + 3);
  assert.equal(moved.y, square.y + 10);
  assert.equal(moved.w, square.w + 1);
  assert.equal(moved.h, square.h + 10);
  assert.equal(await page.evaluate(() => document.querySelector('[data-testid="stage"]').getAttribute('role')), 'application');
  // Past the last element, Tab leaves the canvas and the selection stays.
  await page.keyboard.press('Tab');
  assert.notEqual(await focused(page), 'stage');
  assert.deepEqual(await selection(page), [square.id]);
  // Change its color: the swatch opens the picker on its hex code.
  await tabTo(page, '[data-testid="fill-color"]');
  await page.keyboard.press('Enter');
  assert.equal(await focused(page), 'hex-input');
  await page.keyboard.type('#1d6f42');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await page.waitForSelector('[data-testid="color-popover"]', { state: 'detached' });
  assert.equal((await elements(page)).find((e) => e.id === square.id).fill, '#1d6f42');
  assert.equal(await focused(page), 'fill-color', 'focus is back on the swatch');
  // The Layers list: a button per layer, pressed when selected.
  await tabTo(page, '[data-testid="tab-layers"]', { back: true });
  await page.keyboard.press('Enter');
  await tabTo(page, `[data-testid="layer"][data-id="${text.id}"] [data-testid="layer-select"]`);
  await page.keyboard.press('Enter');
  assert.deepEqual(await selection(page), [text.id]);
  assert.equal(await page.getAttribute(`[data-testid="layer"][data-id="${text.id}"] [data-testid="layer-select"]`, 'aria-pressed'), 'true');
  assert.equal(await focused(page), 'layer-select', 'focus stays on the layer after the list is redrawn');
  // Download: Tab back to the button, Enter, Tab to Download in the dialog, Enter.
  await tabTo(page, '[data-testid="download"]', { back: true });
  await page.keyboard.press('Enter');
  await page.waitForSelector('[data-testid="export-dialog"]');
  await tabTo(page, '[data-testid="export-download"]');
  const download = page.waitForEvent('download');
  await page.keyboard.press('Enter');
  assert.match((await download).suggestedFilename(), /\.png$/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('[APP-09] toasts and errors are spoken: live regions from the start', async () => {
  const { page, context } = await newDesign('square');
  const regions = await page.evaluate(() => ['toasts', 'announcer'].map((id) => {
    const el = document.getElementById(id);
    return el && { role: el.getAttribute('role'), live: el.getAttribute('aria-live') };
  }));
  assert.deepEqual(regions, [{ role: 'status', live: 'polite' }, { role: 'status', live: 'polite' }]);
  // The app itself isn't one big live region (it would read everything out).
  assert.equal(await page.getAttribute('#app', 'aria-live'), null);
  await page.keyboard.press('Control+s');
  await page.waitForSelector('#toasts .toast:not(.error)');
  assert.equal(await page.getAttribute('#toasts .toast', 'role'), null);
  // An error interrupts whatever is being read: role=alert.
  await openTab(page, 'qr');
  await page.fill('[data-testid="qr-input"]', 'x'.repeat(250));
  await page.click('[data-testid="qr-add"]');
  await page.waitForSelector('#toasts .toast.error[role="alert"]');
  // Selection and page changes are announced.
  await addShape(page, 'Square');
  await page.waitForFunction(() => /selected/.test(document.querySelector('#announcer').textContent));
  await page.click('[data-testid="strip-add-page"]');
  await page.waitForFunction(() => /^Page 2 of 2$/.test(document.querySelector('#announcer').textContent));
  await context.close();
});

test('[APP-09] reduced motion turns the interface\'s animations off', async () => {
  const { page, context } = await openApp({ reducedMotion: 'reduce' });
  const timing = await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.className = 'toast';
    document.body.append(probe);
    const t = getComputedStyle(probe).transitionDuration;
    const spin = document.createElement('span');
    spin.className = 'ai-spinner';
    document.body.append(spin);
    const s = getComputedStyle(spin).animationDuration;
    probe.remove();
    spin.remove();
    return { t, s };
  });
  assert.ok(parseFloat(timing.t) < 0.001, `toast transition ${timing.t}`);
  assert.ok(parseFloat(timing.s) < 0.001, `spinner ${timing.s}`);
  await context.close();
  // Without the setting, they move as before.
  const normal = await openApp();
  const t = await normal.page.evaluate(() => {
    const probe = document.createElement('div');
    probe.className = 'toast';
    document.body.append(probe);
    return getComputedStyle(probe).transitionDuration;
  });
  assert.ok(parseFloat(t) >= 0.3, `toast transition ${t}`);
  await normal.context.close();
});

test('[APP-09] the canvas is a labelled, described place on the page', async () => {
  const { page, context } = await newDesign('square');
  const stage = await page.evaluate(() => {
    const s = document.querySelector('[data-testid="stage"]');
    return { tab: s.tabIndex, label: s.getAttribute('aria-label'), help: document.getElementById(s.getAttribute('aria-describedby'))?.textContent };
  });
  assert.equal(stage.tab, 0);
  assert.equal(stage.label, 'Page canvas');
  assert.match(stage.help, /Tab and Shift\+Tab/);
  // The skip link reaches it.
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  assert.equal(await focused(page), 'stage');
  // Enter on a selected text edits it; Escape comes back to the canvas.
  const el = await addText(page);
  await page.focus('[data-testid="stage"]');
  await page.keyboard.press('Enter');
  await page.waitForSelector('[data-testid="text-editor"]');
  await page.keyboard.type('Hi');
  await page.keyboard.press('Escape');
  await settled(page);
  assert.equal(await focused(page), 'stage');
  assert.equal((await state(page, (ed, id) => ed.find(id), el.id)).text, 'Hi');
  await context.close();
});

test('[APP-09] a color picker opened by touch leaves the on-screen keyboard down', async () => {
  const { page, context } = await newDesign('square', { hasTouch: true });
  await page.tap('[data-testid="bg-color"]');
  await page.waitForSelector('[data-testid="color-popover"]');
  assert.notEqual(await focused(page), 'hex-input', 'no text box focused by a tap');
  // From the keyboard it still opens on its hex code.
  await page.tap('[data-testid="bg-color"]');
  await page.waitForSelector('[data-testid="color-popover"]', { state: 'detached' });
  await page.focus('[data-testid="bg-color"]');
  await page.keyboard.press('Enter');
  await page.waitForSelector('[data-testid="color-popover"]');
  assert.equal(await focused(page), 'hex-input');
  await context.close();
});

test('[APP-09] Alt+Left with nothing selected stays in the editor (not the browser\'s Back)', async () => {
  const { page, context } = await newDesign('square');
  const url = page.url();
  await page.focus('[data-testid="stage"]');
  await page.keyboard.press('Escape');
  const prevented = await page.evaluate(() => new Promise((ok) => {
    window.addEventListener('keydown', (e) => setTimeout(() => ok(e.defaultPrevented)), { once: true });
    document.querySelector('[data-testid="stage"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, bubbles: true, cancelable: true }));
  }));
  assert.equal(prevented, true);
  await page.keyboard.press('Alt+ArrowLeft');
  await page.waitForTimeout(300);
  assert.equal(page.url(), url);
  assert.ok(await page.evaluate(() => !!window.paperwall?.editor));
  await context.close();
});

test('[APP-09] Alt+Arrows resize a turned element in place; a hidden one is announced as hidden', async () => {
  const { page, context } = await newDesign('square');
  const sq = await addShape(page, 'Square');
  await page.evaluate((id) => window.paperwall.editor.update({ rotation: 40 }, null, [id]), sq.id);
  // Its top-left corner (as turned) stays where it is, as with dragging the opposite handle.
  const corner = () => page.evaluate((id) => {
    const e = window.paperwall.editor.find(id);
    const a = (e.rotation * Math.PI) / 180;
    const [cx, cy] = [e.x + e.w / 2, e.y + e.h / 2];
    return [cx - (e.w / 2) * Math.cos(a) + (e.h / 2) * Math.sin(a), cy - (e.w / 2) * Math.sin(a) - (e.h / 2) * Math.cos(a)];
  }, sq.id);
  const before = await corner();
  await page.focus('[data-testid="stage"]');
  for (let i = 0; i < 5; i++) await page.keyboard.press('Alt+Shift+ArrowRight');
  await page.keyboard.press('Alt+Shift+ArrowDown');
  const now = (await elements(page)).find((e) => e.id === sq.id);
  assert.ok(now.w > sq.w + 40, 'it got bigger');
  const after = await corner();
  assert.ok(Math.hypot(after[0] - before[0], after[1] - before[1]) < 0.01, `corner stayed: ${before} → ${after}`);
  // At its smallest, a smaller size changes nothing: no empty undo step, nothing saved.
  await page.evaluate((id) => window.paperwall.editor.update({ w: 1, h: 1 }, null, [id]), sq.id);
  await page.waitForTimeout(900); // (past the time repeats merge into one step)
  const steps = () => page.evaluate(() => ({ undo: window.paperwall.editor.history.past.length, at: window.paperwall.editor.doc.updatedAt }));
  const was = await steps();
  await page.keyboard.press('Alt+ArrowLeft');
  await page.keyboard.press('Alt+ArrowUp');
  assert.deepEqual(await steps(), was);
  // Hidden, it isn't counted among the elements Tab goes through.
  await addText(page);
  await page.evaluate((id) => {
    const ed = window.paperwall.editor;
    ed.update({ hidden: true }, null, [id]);
    ed.select([id]);
  }, sq.id);
  await page.waitForFunction(() => /^Rectangle selected \(hidden\)$/.test(document.querySelector('[data-testid="announcer"]').textContent));
  await context.close();
});
