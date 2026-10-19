// Placard: boot, routing between the home screen and the editor, and the
// editor's top bar.

import { h, icon, iconButton, clear, toast, mod } from './ui.js';
import { Editor } from './editor.js';
import { Canvas } from './canvas.js';
import { Inspector, resizeDialog } from './inspector.js';
import { InsertPanel } from './insert.js';
import { PageStrip, present } from './pages.js';
import { bindShortcuts, cheatSheet } from './shortcuts.js';
import { exportDialog, saveProjectFile, thumbnail, api as exportApi } from './export.js';
import { renderHome } from './home.js';
import { loadFonts, registerDesignFonts, clearMeasureCache } from './fonts.js';
import * as store from './store.js';
import { validateDesign } from '../model/doc.js';

const root = document.getElementById('app');
let current = null; // { editor, unbind }
let deferredInstall = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstall = e;
});

// ---------- theme ----------

async function applyTheme() {
  const theme = await store.getSetting('theme', null);
  if (theme) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}

async function toggleTheme() {
  const dark = document.documentElement.dataset.theme
    ? document.documentElement.dataset.theme === 'dark'
    : window.matchMedia('(prefers-color-scheme: dark)').matches;
  const next = dark ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  await store.setSetting('theme', next);
}

// ---------- routing ----------

function route() {
  const m = location.hash.match(/^#\/d\/([\w-]+)/);
  if (m) openEditor(m[1]);
  else showHome();
}

function closeEditor() {
  if (!current) return;
  current.editor.flush();
  current.unbind();
  current = null;
  window.placard = null;
}

function showHome() {
  closeEditor();
  document.title = 'Placard: free design tool that works offline';
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
  closeEditor();
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
  const editor = new Editor(doc, {
    onOpenDesign: (newId) => (location.hash = `#/d/${newId}`),
    makeThumb: thumbnail,
  });
  if (pendingFit) {
    editor.refitAllText();
    pendingFit = false;
  }
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
    document.title = `${editor.doc.name} · Placard`;
  };
  const top = h('header', { class: 'topbar' },
    h('a', { class: 'brand small', href: '#/', title: 'All designs', 'data-testid': 'home-link' }, h('span', { class: 'logo', 'aria-hidden': 'true' }), h('span', { class: 'brand-word' }, 'Placard')),
    nameInput,
    h('div', { class: 'top-group' }, undoBtn, redoBtn),
    h('div', { class: 'top-group right' },
      iconButton('present', 'Present', () => present(editor, canvas), { 'data-testid': 'present' }),
      iconButton('save', 'Save to file', () => saveProjectFile(editor.doc), { 'data-testid': 'save-file' }),
      iconButton('keyboard', 'Keyboard shortcuts (?)', () => cheatSheet(), { 'data-testid': 'shortcuts-btn' }),
      iconButton('moon', 'Dark mode', toggleTheme, { 'data-testid': 'theme-toggle' }),
      h('button', { type: 'button', class: 'btn primary', 'data-testid': 'download', onClick: () => exportDialog(editor) }, icon('download'), h('span', null, 'Download'))));

  clear(root);
  root.append(h('div', { class: 'editor' }, top, h('div', { class: 'workspace' }, insert.el, canvas.el, inspector.el), strip.el));
  const unbindKeys = bindShortcuts(editor, canvas, { exportDialog: () => exportDialog(editor) });
  const offTop = editor.on(syncTop);
  const onResize = () => canvas.layout();
  window.addEventListener('resize', onResize);
  syncTop();
  inspector.render();
  canvas.zoomToFit();
  canvas.render();
  // Fonts can finish loading after the first paint; re-measure then.
  document.fonts.ready.then(() => {
    clearMeasureCache();
    canvas.render();
  });
  current = {
    editor,
    unbind: () => {
      unbindKeys();
      offTop();
      window.removeEventListener('resize', onResize);
    },
  };
  // Handy in the console, and used by the end-to-end tests.
  window.placard = { editor, canvas, inspector, export: exportApi, store };
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
  if ('serviceWorker' in navigator && location.protocol === 'https:' && globalThis.PLACARD_SW) {
    navigator.serviceWorker.register(globalThis.PLACARD_SW).catch(() => null);
  }
  document.body.classList.add('ready');
}

boot();
