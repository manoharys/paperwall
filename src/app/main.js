// Paperwall: boot, routing between the home screen and the editor, and the
// editor's top bar.

import { h, icon, iconButton, clear, toast, mod, forget, announce, liveRegions } from './ui.js';
import { Editor } from './editor.js';
import { Canvas, forgetBlobUrls } from './canvas.js';
import { Inspector, resizeDialog } from './inspector.js';
import { InsertPanel } from './insert.js';
import { PageStrip, present, presenterView } from './pages.js';
import { bindShortcuts, cheatSheet } from './shortcuts.js';
import { exportDialog, saveProjectFile, thumbnail, api as exportApi } from './export.js';
import { renderHome } from './home.js';
import { loadFonts, registerDesignFonts, ensureDesignFonts, clearMeasureCache } from './fonts.js';
import * as store from './store.js';
import { validateDesign, versionSnapshot, clone } from '../model/doc.js';
import { fontsUsed } from '../model/fonts.js';
import { menuButton, toggle, segmented, closePopover, languagePicker } from './widgets.js';
import { findDialog } from './find.js';
import { historyDialog } from './history.js';
import { openOnlineSettings } from './online-settings.js';
import { api as cutoutApi, forgetCuts } from './cutout.js';
import { withSmallPictures, VideoFrames } from './media.js';
import { elementName } from './names.js';
import { t, setLanguage, pickLanguage } from './i18n.js';

const root = document.getElementById('app');
let current = null; // { editor, unbind }
let deferredInstall = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstall = e;
});

// ---------- theme ----------

function quickTheme(value) {
  // A synchronous copy, so the theme survives closing the tab right after a switch.
  try {
    if (value === undefined) return localStorage.getItem('paperwall-theme');
    localStorage.setItem('paperwall-theme', value);
  } catch {
    /* storage can be blocked; IndexedDB still has it */
  }
  return null;
}

async function applyTheme() {
  const theme = quickTheme() || (await store.getSetting('theme', null));
  if (theme) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}

async function toggleTheme() {
  const dark = document.documentElement.dataset.theme
    ? document.documentElement.dataset.theme === 'dark'
    : window.matchMedia('(prefers-color-scheme: dark)').matches;
  const next = dark ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  quickTheme(next);
  await store.setSetting('theme', next);
}

// ---------- language ----------

function quickLanguage(value) {
  // A synchronous copy, as for the theme.
  try {
    if (value === undefined) return localStorage.getItem('paperwall-language');
    localStorage.setItem('paperwall-language', value);
  } catch {
    /* storage can be blocked; IndexedDB still has it */
  }
  return null;
}

/** The words that live in the page itself, in the interface's language. */
function relabelPage() {
  document.querySelector('meta[name="description"]')?.setAttribute('content', t('app.description'));
  const loading = document.querySelector('.boot');
  if (loading) loading.textContent = t('app.loading');
}

/** The language picked before, or else the browser's own. */
async function applyLanguage() {
  const saved = quickLanguage() || (await store.getSetting('language', null).catch(() => null));
  setLanguage(saved || pickLanguage(navigator.languages?.length ? navigator.languages : [navigator.language]));
  relabelPage();
}

/** Switch the interface's language, keep the choice, and draw everything again in it. */
async function changeLanguage(code, { focus } = {}) {
  closePopover();
  setLanguage(code);
  quickLanguage(code);
  relabelPage();
  await store.setSetting('language', code).catch(() => null);
  // In the editor, just its screen is drawn again: the design stays open as it is (undo, selection, page).
  if (current) {
    const view = current.unbind.view();
    current.unbind();
    current.unbind = drawEditor(current.editor, view);
  } else await route();
  // Back where the person was (the screen was drawn again under them).
  document.querySelector(`[data-testid="${focus}"]`)?.focus();
}

// ---------- routing ----------

function route() {
  const m = location.hash.match(/^#\/d\/([\w-]+)/);
  return m ? openEditor(m[1]) : showHome();
}

async function closeEditor() {
  if (!current) return;
  const { editor, unbind } = current;
  current = null;
  // A drag still going (leaving by a key or the back button) ends as if let go.
  editor.endDrag?.();
  editor.closed = true;
  editor.stopStills();
  forgetCuts();
  unbind();
  window.paperwall = null;
  // Save the design and its thumbnail first; then, if it changed, keep a
  // version of it (reusing that thumbnail).
  await editor.flush();
  await editor.thumb.flush();
  // After the first check for versions (it may still be saving the Original).
  await editor.versionsChecked;
  await editor.maybeSaveVersion(-1);
}

async function showHome() {
  await closeEditor();
  forgetBlobUrls();
  document.title = t('app.title');
  renderHome(root, {
    openDesign: (id) => (location.hash = `#/d/${id}`),
    newDesign: async (doc, opts) => {
      await registerDesignFonts(doc);
      await store.saveDesign(doc, null);
      pendingFit = !!opts?.fit;
      location.hash = `#/d/${doc.id}`;
    },
    toggleTheme,
    changeLanguage: (code) => changeLanguage(code, { focus: 'language-select' }),
    installPrompt: () => deferredInstall,
  });
}

let pendingFit = false;

async function openEditor(id) {
  await closeEditor();
  let doc = await store.loadDesign(id);
  if (!doc) {
    toast(t('editor.missingDesign'), 'error');
    location.hash = '#/';
    return;
  }
  try {
    validateDesign(doc);
  } catch (e) {
    toast(e.message, 'error');
    location.hash = '#/';
    return;
  }
  await registerDesignFonts(doc);
  await ensureDesignFonts(doc);
  const editor = new Editor(doc, {
    onOpenDesign: (newId) => (location.hash = `#/d/${newId}`),
    // (From smaller copies of its photos: quicker, and just as sharp that small.)
    // (Its pages copied first: a drag starting while its pictures are made
    // smaller doesn't land half-done in the preview.)
    makeThumb: async (d) => thumbnail(await withSmallPictures({ ...d, pages: clone(d.pages) })),
  });
  if (pendingFit) {
    editor.refitAllText();
    pendingFit = false;
  }
  editor.arrange(); // a document laid out with its fonts measured (before its first look and version)
  editor.retakeStills(); // (videos saved without a full-size still get one)
  // The first time a design is opened, keep its original as a version; after
  // that, the next version comes after a few minutes of work. The original is
  // copied now (text measured), before any edit can land while storage answers.
  const original = versionSnapshot(doc);
  // (Closing waits for this, so the Original always comes first.)
  editor.versionsChecked = store.hasVersions(doc.id).then((has) => (has ? (editor.versionAt = Date.now()) : editor.saveVersion('original', { snapshot: original }))).catch(() => {
    editor.versionAt = Date.now(); // can't tell: carry on keeping versions every few minutes
  });
  // (Just its preview: not every design, videos and all.)
  if (!(await store.getThumb(doc.id).catch(() => null))) editor.thumb();
  current = { editor, unbind: drawEditor(editor) };
}

/**
 * The editor's screen for `editor`: top bar, panels, canvas and page strip.
 * Returns what takes it down again (the editor itself, its undo history,
 * selection and page, stay as they are), with .view(): how it's looked at
 * (zoom, scroll, open panels), for `view` when it's drawn again.
 */
function drawEditor(editor, view = null) {
  const canvas = new Canvas(editor);
  const inspector = new Inspector(editor, canvas, { onResizeDesign: () => resizeDialog(editor), onPlay: (how) => present(editor, canvas, { autoplay: true, ...how }) });
  const insert = new InsertPanel(editor);
  const strip = new PageStrip(editor, canvas);
  const nameInput = h('input', { class: 'doc-name', value: editor.doc.name, 'aria-label': t('top.designName'), 'data-testid': 'doc-name', maxlength: '120' });
  nameInput.addEventListener('change', () => editor.rename(nameInput.value));
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') nameInput.blur();
  });
  const undoBtn = iconButton('undo', t('top.undo', { keys: `${mod}+Z` }), () => editor.undo(), { 'data-testid': 'undo' });
  const redoBtn = iconButton('redo', t('top.redo', { keys: `${mod}+Shift+Z` }), () => editor.redo(), { 'data-testid': 'redo' });
  const syncTop = () => {
    undoBtn.disabled = !editor.history.canUndo;
    redoBtn.disabled = !editor.history.canRedo;
    if (document.activeElement !== nameInput) nameInput.value = editor.doc.name;
    document.title = t('app.editorTitle', { name: editor.doc.name });
  };
  const top = h('header', { class: 'topbar' },
    h('a', { class: 'brand small', href: '#/', title: t('top.allDesigns'), 'data-testid': 'home-link' }, h('span', { class: 'logo', 'aria-hidden': 'true' }), h('span', { class: 'brand-word' }, 'Paperwall')),
    nameInput,
    h('div', { class: 'top-group' }, undoBtn, redoBtn),
    h('div', { class: 'top-group right' },
      iconButton('play', t('top.play'), () => present(editor, canvas, { autoplay: true }), { 'data-testid': 'play' }),
      iconButton('present', t('top.present'), () => present(editor, canvas), { 'data-testid': 'present' }),
      iconButton('speaker', t('top.presenterView'), () => presenterView(editor, canvas), { 'data-testid': 'presenter-view-btn' }),
      iconButton('save', t('top.saveFile'), () => saveProjectFile(editor.doc), { 'data-testid': 'save-file' }),
      iconButton('search', t('top.find'), () => findDialog(editor), { 'data-testid': 'find-btn' }),
      iconButton('history', t('top.history'), () => historyDialog(editor), { 'data-testid': 'history-btn' }),
      menuButton({ iconName: 'ruler', label: t('top.view'), testid: 'view', content: () => viewMenu(editor) }),
      iconButton('keyboard', t('top.shortcuts'), () => cheatSheet(), { 'data-testid': 'shortcuts-btn' }),
      menuButton({ iconName: 'more', label: t('top.more'), testid: 'main', content: mainMenu }),
      iconButton('moon', t('common.darkMode'), toggleTheme, { 'data-testid': 'theme-toggle' }),
      h('button', { type: 'button', class: 'btn primary', 'data-testid': 'download', onClick: () => exportDialog(editor) }, icon('download'), h('span', null, t('common.download')))));

  // On small screens one sheet shows at a time: "insert" (add things) or "edit" (properties).
  const workspace = h('div', { class: 'workspace', 'data-sheet': 'none' }, insert.el, canvas.el, inspector.el);
  const setSheet = (name) => {
    if (workspace.dataset.sheet === name) return;
    workspace.dataset.sheet = name;
    // Hiding the Draw panel ends drawing, as on bigger screens.
    if (name !== 'insert' && editor.drawTool) editor.emit('stop-drawing');
    // The canvas just changed size on phones; fit the page into it again.
    if (window.matchMedia('(max-width: 900px)').matches) requestAnimationFrame(() => canvas.zoomToFit());
  };
  insert.onOpen = () => setSheet('insert');
  const offSheet = editor.on((what) => {
    if (what === 'selection' && editor.selection.length) setSheet('edit');
  });
  const closeSheet = iconButton('down', t('top.hidePanel'), () => setSheet('none'), { class: 'icon-btn sheet-close', 'data-testid': 'sheet-close' });
  inspector.el.prepend(closeSheet);
  insert.el.querySelector('.insert-panel').prepend(closeSheet.cloneNode(true));
  insert.el.querySelector('.insert-panel .sheet-close').addEventListener('click', () => setSheet('none'));
  forget(root);
  clear(root);
  // First in the tab order: straight to the canvas, past the top bar and panels.
  const skip = h('button', { type: 'button', class: 'skip-link', 'data-testid': 'skip-to-canvas', onClick: () => canvas.el.focus() }, t('a11y.skip'));
  root.append(h('div', { class: 'editor' }, skip, top, workspace, strip.el));
  const unbindKeys = bindShortcuts(editor, canvas, { exportDialog: () => exportDialog(editor), findDialog: () => findDialog(editor) });
  const offTop = editor.on(syncTop);
  const offSay = editor.on(sayChanges(editor));
  const onResize = () => canvas.layout();
  window.addEventListener('resize', onResize);
  syncTop();
  if (view) {
    // Drawn again (in another language): as it was looked at.
    Object.assign(insert, view.insert);
    insert.el.classList.toggle('collapsed', view.collapsed);
    insert.render();
    inspector.tab = view.inspectorTab;
    workspace.dataset.sheet = view.sheet;
  }
  inspector.render();
  if (!view) canvas.zoomToFit();
  canvas.render();
  if (view) {
    canvas.el.scrollLeft = view.left;
    canvas.el.scrollTop = view.top;
  }
  // A font can finish loading after the first paint (a slow device, a font
  // picked from the list). When one this design uses arrives, measure its
  // text again and redraw. Fonts loading for previews elsewhere are ignored.
  const onFontsLoaded = (e) => {
    const used = new Set(fontsUsed(editor.doc).map(({ font, weight }) => `${font.name}|${weight}`));
    const loaded = new Set((e.fontfaces || []).map((f) => `${f.family.replace(/^["']|["']$/g, '')}|${f.weight}`).filter((k) => used.has(k)));
    if (!loaded.size) return;
    clearMeasureCache();
    const families = new Set([...loaded].map((k) => k.split('|')[0]));
    // A correction to measurements, not an edit: saved, but not an undo step.
    // Not mid-drag: that would cut the drag short (or be undone with it).
    editor.whenIdle(() => {
      if (editor.closed) return;
      if (editor.refitAllText((el) => families.has(el.font))) editor.afterChange(true, { edit: false });
      canvas.render();
    });
  };
  document.fonts.addEventListener('loadingdone', onFontsLoaded);
  // Handy in the console, and used by the end-to-end tests.
  window.paperwall = { editor, canvas, inspector, export: exportApi, store, cutout: cutoutApi, VideoFrames, withSmallPictures };
  const unbind = () => {
    document.fonts.removeEventListener('loadingdone', onFontsLoaded);
    unbindKeys();
    offSheet();
    offTop();
    offSay();
    for (const part of [canvas, inspector, insert, strip]) part.destroy();
    window.removeEventListener('resize', onResize);
  };
  unbind.view = () => ({
    left: canvas.el.scrollLeft,
    top: canvas.el.scrollTop,
    insert: { tab: insert.tab, query: insert.query, category: insert.category, pen: insert.pen },
    collapsed: insert.el.classList.contains('collapsed'),
    inspectorTab: inspector.tab,
    sheet: workspace.dataset.sheet,
  });
  return unbind;
}

window.addEventListener('hashchange', route);
window.addEventListener('paperwall:storage-outdated', () => toast(t('storage.outdated'), 'error'));
window.addEventListener('paperwall:storage-blocked', () => toast(t('storage.blocked'), 'error'));
window.addEventListener('beforeunload', () => current?.editor.flush());
// Hidden comes before a tab is closed or reloaded (beforeunload may not
// come at all), so that's when work since the last version is kept too.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'hidden' || !current) return;
  const { editor } = current;
  editor.flush();
  // Not on every quick switch to another tab (at most once a minute), not
  // mid-drag, and not before the first check for versions is done.
  editor.maybeSaveVersion(60_000, { quick: true });
});

/**
 * What screen readers hear as the editor changes under them: what's
 * selected (its name, and where it is among the page's elements) and which
 * page is showing. The same words aren't said twice in a row.
 */
function sayChanges(editor) {
  let last = '';
  const say = (words) => {
    if (words === last) return;
    last = words;
    announce(words);
  };
  return (what) => {
    if (what === 'page') return say(t('a11y.page', { n: editor.page + 1, total: editor.doc.pages.length }));
    if (what !== 'selection') return;
    const sel = editor.selected;
    if (!sel.length) return say(t('a11y.nothing'));
    if (sel.length > 1) return say(t('a11y.selectedMany', { n: sel.length }));
    // (Only elements on the page itself are selected, never one inside a group: its place is on the page.)
    const els = editor.pageData.elements.filter((el) => !el.hidden);
    let name = elementName(sel[0]);
    if (sel[0].locked) name = t('a11y.locked', { name });
    // (A hidden one isn't among those N goes through: no place to count.)
    if (sel[0].hidden) return say(t('a11y.selectedHidden', { name }));
    say(t('a11y.selected', { name, n: els.indexOf(sel[0]) + 1 || 1, total: els.length || 1 }));
  };
}

async function boot() {
  liveRegions();
  await applyTheme();
  await applyLanguage();
  await loadFonts();
  route();
  if ('serviceWorker' in navigator && window.isSecureContext && location.protocol !== 'file:' && globalThis.PAPERWALL_SW) {
    navigator.serviceWorker.register(globalThis.PAPERWALL_SW).catch(() => null);
  }
  document.body.classList.add('ready');
}

boot();

/** The top bar's More menu: settings that aren't about this design. */
function mainMenu() {
  const item = (label, testid, run) => h('button', { type: 'button', class: 'btn small wide', 'data-testid': testid, onClick: () => {
    closePopover();
    run();
  } }, label);
  return h('div', { class: 'stack' },
    item(t('menu.online'), 'menu-online', () => openOnlineSettings()),
    h('label', { class: 'field' }, h('span', null, t('common.language')),
      languagePicker({ testid: 'menu-language', onChange: (code) => changeLanguage(code, { focus: 'main' }) })));
}

/** Rulers, guides, grid, margins and bleed: how the page is shown, not part of the design. */
function viewMenu(editor) {
  const v = editor.view;
  const set = (patch) => {
    editor.setView(patch);
    // Rebuild the menu so dependent settings appear and disappear.
    const pop = document.querySelector('[data-testid="view-menu"]');
    pop?.replaceChildren(viewMenu(editor));
  };
  return h('div', { class: 'stack' },
    toggle({ label: t('view.rulers'), checked: v.rulers, testid: 'view-rulers', onChange: (rulers) => set({ rulers }) }),
    h('p', { class: 'hint' }, t('view.rulersHint')),
    h('button', { type: 'button', class: 'btn small', 'data-testid': 'view-clear-guides', onClick: () => editor.clearGuides() }, t('view.clearGuides')),
    toggle({ label: t('view.grid'), checked: v.grid, testid: 'view-grid', onChange: (grid) => set({ grid }) }),
    v.grid ? segmented({ label: t('view.gridSize'), value: v.gridSize, testid: 'view-grid-size', onChange: (gridSize) => set({ gridSize }), options: [
      { value: 'small', label: t('view.gridSmall'), text: t('view.small') }, { value: 'medium', label: t('view.gridMedium'), text: t('view.medium') }, { value: 'large', label: t('view.gridLarge'), text: t('view.large') },
    ] }) : null,
    v.grid ? toggle({ label: t('view.snapGrid'), checked: v.snapGrid, testid: 'view-snap-grid', onChange: (snapGrid) => set({ snapGrid }) }) : null,
    toggle({ label: t('view.margins'), checked: v.margins, testid: 'view-margins', onChange: (margins) => set({ margins }) }),
    toggle({ label: t('view.bleed'), checked: v.bleed, testid: 'view-bleed', onChange: (bleed) => set({ bleed }) }),
    v.bleed ? h('p', { class: 'hint' }, t('view.bleedHint')) : null);
}
