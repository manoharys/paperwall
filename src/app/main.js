// Paperwall: boot, routing between the home screen and the editor, and the
// editor's top bar.

import { h, icon, iconButton, clear, toast, mod } from './ui.js';
import { Editor } from './editor.js';
import { Canvas } from './canvas.js';
import { Inspector, resizeDialog } from './inspector.js';
import { InsertPanel, forget } from './insert.js';
import { PageStrip, present } from './pages.js';
import { bindShortcuts, cheatSheet } from './shortcuts.js';
import { exportDialog, saveProjectFile, thumbnail, api as exportApi } from './export.js';
import { renderHome } from './home.js';
import { loadFonts, registerDesignFonts, ensureDesignFonts, clearMeasureCache } from './fonts.js';
import * as store from './store.js';
import { validateDesign } from '../model/doc.js';
import { fontsUsed } from '../model/fonts.js';

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
  editor.closed = true;
  unbind();
  window.paperwall = null;
  await editor.flush();
  // Make sure the home screen has a preview, even for a design opened and left unchanged.
  await editor.thumb.flush();
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
      iconButton('keyboard', 'Keyboard shortcuts (?)', () => cheatSheet(), { 'data-testid': 'shortcuts-btn' }),
      iconButton('moon', 'Dark mode', toggleTheme, { 'data-testid': 'theme-toggle' }),
      h('button', { type: 'button', class: 'btn primary', 'data-testid': 'download', onClick: () => exportDialog(editor) }, icon('download'), h('span', null, 'Download'))));

  // On small screens one sheet shows at a time: "insert" (add things) or "edit" (properties).
  const workspace = h('div', { class: 'workspace', 'data-sheet': 'none' }, insert.el, canvas.el, inspector.el);
  const setSheet = (name) => {
    if (workspace.dataset.sheet === name) return;
    workspace.dataset.sheet = name;
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
  const unbindKeys = bindShortcuts(editor, canvas, { exportDialog: () => exportDialog(editor) });
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
    if (editor.refitAllText((el) => families.has(el.font))) editor.afterChange(true);
    canvas.render();
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
window.addEventListener('beforeunload', () => current?.editor.flush());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') current?.editor.flush();
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
