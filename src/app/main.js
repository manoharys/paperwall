// Paperwall: boot, routing between the home screen and the editor, and the
// editor's top bar.

import { h, icon, iconButton, clear, toast, mod, forget } from './ui.js';
import { Editor } from './editor.js';
import { Canvas } from './canvas.js';
import { Inspector, resizeDialog } from './inspector.js';
import { InsertPanel } from './insert.js';
import { PageStrip, present } from './pages.js';
import { bindShortcuts, cheatSheet } from './shortcuts.js';
import { exportDialog, saveProjectFile, thumbnail, api as exportApi } from './export.js';
import { renderHome } from './home.js';
import { loadFonts, registerDesignFonts, ensureDesignFonts, clearMeasureCache } from './fonts.js';
import * as store from './store.js';
import { validateDesign, versionSnapshot } from '../model/doc.js';
import { fontsUsed } from '../model/fonts.js';
import { menuButton, toggle, segmented } from './widgets.js';
import { findDialog } from './find.js';
import { historyDialog } from './history.js';

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

// ---------- routing ----------

function route() {
  const m = location.hash.match(/^#\/d\/([\w-]+)/);
  if (m) openEditor(m[1]);
  else showHome();
}

async function closeEditor() {
  if (!current) return;
  const { editor, unbind } = current;
  current = null;
  // A drag still going (leaving by a key or the back button) ends as if let go.
  editor.endDrag?.();
  editor.closed = true;
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
  document.title = 'Paperwall: design without the paywall';
  renderHome(root, {
    openDesign: (id) => (location.hash = `#/d/${id}`),
    newDesign: async (doc, opts) => {
      await registerDesignFonts(doc);
      await store.saveDesign(doc, null);
      pendingFit = !!opts?.fit;
      location.hash = `#/d/${doc.id}`;
    },
    toggleTheme,
    installPrompt: () => deferredInstall,
  });
}

let pendingFit = false;

async function openEditor(id) {
  await closeEditor();
  let doc = await store.loadDesign(id);
  if (!doc) {
    toast("That design isn't on this device.", 'error');
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
    makeThumb: thumbnail,
  });
  if (pendingFit) {
    editor.refitAllText();
    pendingFit = false;
  }
  // The first time a design is opened, keep its original as a version; after
  // that, the next version comes after a few minutes of work. The original is
  // copied now (text measured), before any edit can land while storage answers.
  const original = versionSnapshot(doc);
  // (Closing waits for this, so the Original always comes first.)
  editor.versionsChecked = store.hasVersions(doc.id).then((has) => (has ? (editor.versionAt = Date.now()) : editor.saveVersion('Original', { snapshot: original }))).catch(() => {
    editor.versionAt = Date.now(); // can't tell: carry on keeping versions every few minutes
  });
  const meta = (await store.listDesigns()).find((d) => d.id === doc.id);
  if (!meta?.thumb) editor.thumb();
  const canvas = new Canvas(editor);
  const inspector = new Inspector(editor, canvas, { onResizeDesign: () => resizeDialog(editor) });
  const insert = new InsertPanel(editor);
  const strip = new PageStrip(editor, canvas);
  const nameInput = h('input', { class: 'doc-name', value: doc.name, 'aria-label': 'Design name', 'data-testid': 'doc-name', maxlength: '120' });
  nameInput.addEventListener('change', () => editor.rename(nameInput.value));
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') nameInput.blur();
  });
  const undoBtn = iconButton('undo', `Undo (${mod}+Z)`, () => editor.undo(), { 'data-testid': 'undo' });
  const redoBtn = iconButton('redo', `Redo (${mod}+Shift+Z)`, () => editor.redo(), { 'data-testid': 'redo' });
  const syncTop = () => {
    undoBtn.disabled = !editor.history.canUndo;
    redoBtn.disabled = !editor.history.canRedo;
    if (document.activeElement !== nameInput) nameInput.value = editor.doc.name;
    document.title = `${editor.doc.name} · Paperwall`;
  };
  const top = h('header', { class: 'topbar' },
    h('a', { class: 'brand small', href: '#/', title: 'All designs', 'data-testid': 'home-link' }, h('span', { class: 'logo', 'aria-hidden': 'true' }), h('span', { class: 'brand-word' }, 'Paperwall')),
    nameInput,
    h('div', { class: 'top-group' }, undoBtn, redoBtn),
    h('div', { class: 'top-group right' },
      iconButton('present', 'Present', () => present(editor, canvas), { 'data-testid': 'present' }),
      iconButton('save', 'Save to file', () => saveProjectFile(editor.doc), { 'data-testid': 'save-file' }),
      iconButton('search', 'Find and replace (Ctrl+F)', () => findDialog(editor), { 'data-testid': 'find-btn' }),
      iconButton('history', 'Version history', () => historyDialog(editor), { 'data-testid': 'history-btn' }),
      menuButton({ iconName: 'ruler', label: 'View: rulers, guides, grid', testid: 'view', content: () => viewMenu(editor) }),
      iconButton('keyboard', 'Keyboard shortcuts (?)', () => cheatSheet(), { 'data-testid': 'shortcuts-btn' }),
      iconButton('moon', 'Dark mode', toggleTheme, { 'data-testid': 'theme-toggle' }),
      h('button', { type: 'button', class: 'btn primary', 'data-testid': 'download', onClick: () => exportDialog(editor) }, icon('download'), h('span', null, 'Download'))));

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
  editor.on((what) => {
    if (what === 'selection' && editor.selection.length) setSheet('edit');
  });
  const closeSheet = iconButton('down', 'Hide panel', () => setSheet('none'), { class: 'icon-btn sheet-close', 'data-testid': 'sheet-close' });
  inspector.el.prepend(closeSheet);
  insert.el.querySelector('.insert-panel').prepend(closeSheet.cloneNode(true));
  insert.el.querySelector('.insert-panel .sheet-close').addEventListener('click', () => setSheet('none'));
  forget(root);
  clear(root);
  root.append(h('div', { class: 'editor' }, top, workspace, strip.el));
  const unbindKeys = bindShortcuts(editor, canvas, { exportDialog: () => exportDialog(editor), findDialog: () => findDialog(editor) });
  const offTop = editor.on(syncTop);
  const onResize = () => canvas.layout();
  window.addEventListener('resize', onResize);
  syncTop();
  inspector.render();
  canvas.zoomToFit();
  canvas.render();
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
  current = {
    editor,
    unbind: () => {
      document.fonts.removeEventListener('loadingdone', onFontsLoaded);
      unbindKeys();
      offTop();
      window.removeEventListener('resize', onResize);
    },
  };
  // Handy in the console, and used by the end-to-end tests.
  window.paperwall = { editor, canvas, inspector, export: exportApi, store };
}

window.addEventListener('hashchange', route);
window.addEventListener('paperwall:storage-outdated', () => toast('Paperwall was updated in another tab. Reload this tab to keep saving your work.', 'error'));
window.addEventListener('paperwall:storage-blocked', () => toast('Paperwall is updating its storage. Close any other Paperwall tabs to finish.', 'error'));
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

async function boot() {
  await applyTheme();
  await loadFonts();
  route();
  if ('serviceWorker' in navigator && window.isSecureContext && location.protocol !== 'file:' && globalThis.PAPERWALL_SW) {
    navigator.serviceWorker.register(globalThis.PAPERWALL_SW).catch(() => null);
  }
  document.body.classList.add('ready');
}

boot();

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
    toggle({ label: 'Rulers (Shift+R)', checked: v.rulers, testid: 'view-rulers', onChange: (rulers) => set({ rulers }) }),
    h('p', { class: 'hint' }, 'Drag from a ruler to add a guide. Drag a guide off the page to remove it.'),
    h('button', { type: 'button', class: 'btn small', 'data-testid': 'view-clear-guides', onClick: () => editor.clearGuides() }, 'Clear guides on this page'),
    toggle({ label: 'Grid', checked: v.grid, testid: 'view-grid', onChange: (grid) => set({ grid }) }),
    v.grid ? segmented({ label: 'Grid size', value: v.gridSize, testid: 'view-grid-size', onChange: (gridSize) => set({ gridSize }), options: [
      { value: 'small', label: 'Small grid', text: 'Small' }, { value: 'medium', label: 'Medium grid', text: 'Medium' }, { value: 'large', label: 'Large grid', text: 'Large' },
    ] }) : null,
    v.grid ? toggle({ label: 'Snap to grid', checked: v.snapGrid, testid: 'view-snap-grid', onChange: (snapGrid) => set({ snapGrid }) }) : null,
    toggle({ label: 'Safe margins', checked: v.margins, testid: 'view-margins', onChange: (margins) => set({ margins }) }),
    toggle({ label: 'Print bleed (3 mm)', checked: v.bleed, testid: 'view-bleed', onChange: (bleed) => set({ bleed }) }),
    v.bleed ? h('p', { class: 'hint' }, 'Anything past the dashed red line may be trimmed when printed; let backgrounds run to the edge.') : null);
}
