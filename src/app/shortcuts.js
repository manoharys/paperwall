// Keyboard shortcuts, clipboard handling, and the cheat sheet.

import { h, dialog, mod, toast } from './ui.js';
import { t } from './i18n.js';

// [what it does (a key in the catalog), the keys], read when shown.
export const SHORTCUTS = [
  ['shortcut.undo', () => `${mod}+Z`],
  ['shortcut.redo', () => `${mod}+Shift+Z`],
  ['shortcut.copy', () => `${mod}+C, X, V`],
  ['shortcut.duplicate', () => `${mod}+D`],
  ['shortcut.delete', () => t('keys.deleteOrBackspace')],
  ['shortcut.selectAll', () => `${mod}+A`],
  ['shortcut.deselect', () => 'Esc'],
  ['shortcut.nudge', () => t('keys.arrows')],
  ['shortcut.resize', () => t('keys.altArrows')],
  ['shortcut.cycle', () => t('keys.tab')],
  ['shortcut.group', () => `${mod}+G / ${mod}+Shift+G`],
  ['shortcut.lock', () => `${mod}+L`],
  ['shortcut.order', () => '] / ['],
  ['shortcut.frontBack', () => `${mod}+] / ${mod}+[`],
  ['shortcut.style', () => `${mod}+Alt+C / ${mod}+Alt+V`],
  ['shortcut.editText', () => 'Enter'],
  ['shortcut.add', () => 'T, R, O, L'],
  ['shortcut.zoom', () => `${mod}+= / ${mod}+- / ${mod}+0`],
  ['shortcut.find', () => `${mod}+F`],
  ['shortcut.rulers', () => 'Shift+R'],
  ['shortcut.stopDrawing', () => 'Esc'],
  ['shortcut.wheelZoom', () => t('keys.modScroll', { mod })],
  ['shortcut.pan', () => t('keys.pan')],
  ['shortcut.keepRatio', () => 'Shift'],
  ['shortcut.rotate', () => t('keys.shiftRotating')],
  ['shortcut.noSnap', () => t('keys.altDragging')],
  ['shortcut.download', () => `${mod}+E`],
  ['shortcut.cheatSheet', () => '?'],
];

export function cheatSheet() {
  return dialog(t('shortcuts.title'), h('table', { class: 'shortcuts', 'data-testid': 'shortcuts' },
    h('tbody', null, SHORTCUTS.map(([what, keys]) => h('tr', null, h('td', null, t(what)), h('td', null, h('kbd', null, keys())))))));
}

function typing(e) {
  const el = e.target;
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

const MARKER = 'paperwall:elements';

/** Wire up shortcuts. Returns a function that removes them. */
export function bindShortcuts(editor, canvas, actions) {
  let pasteFallback = null;

  const onKey = (e) => {
    // (Presenting, or the presenter view: keys move the slides, never edit.)
    if (typing(e) || document.querySelector('.backdrop, .presenter, .presenter-view')) return;
    // Enter and Space press the button that has focus (they don't edit the
    // selected text from there).
    if ((e.key === 'Enter' || e.key === ' ') && e.target.closest?.('button, a[href], [role="button"], [role="tab"]')) return;
    // While a drag is going it holds parts of the design: keys wait (and a
    // cancelled drag then puts back exactly what it changed).
    if (editor.isDragging?.()) {
      if (/^[a-z]$|^(delete|backspace|arrow\w+)$/.test(e.key.toLowerCase())) e.preventDefault();
      return;
    }
    const m = e.metaKey || e.ctrlKey;
    const k = e.key.toLowerCase();
    const done = () => e.preventDefault();
    if (m && k === 'z' && !e.shiftKey) return done(), editor.undo();
    if ((m && k === 'z' && e.shiftKey) || (m && k === 'y')) return done(), editor.redo();
    if (m && e.altKey && e.code === 'KeyC') return done(), editor.copyStyle();
    if (m && e.altKey && e.code === 'KeyV') return done(), editor.pasteStyle();
    if (m && k === 'c') return void editor.copy();
    if (m && k === 'x') return void editor.cut();
    if (m && k === 'v') {
      clearTimeout(pasteFallback);
      pasteFallback = setTimeout(() => editor.paste(), 120);
      return;
    }
    if (m && k === 'd') return done(), editor.duplicate();
    if (m && k === 'a') return done(), editor.selectAll();
    if (m && k === 'g' && e.shiftKey) return done(), editor.ungroup();
    if (m && k === 'g') return done(), editor.group();
    if (m && k === 'l') return done(), editor.toggleLock();
    if (m && e.key === ']') return done(), editor.reorder('front');
    if (m && e.key === '[') return done(), editor.reorder('back');
    if (m && (e.key === '=' || e.key === '+')) return done(), canvas.zoomBy(1.25);
    if (m && e.key === '-') return done(), canvas.zoomBy(1 / 1.25);
    if (m && e.key === '0') return done(), canvas.zoomToFit();
    if (m && k === 'e') return done(), actions.exportDialog();
    if (m && k === 'f') return done(), actions.findDialog();
    if (m && k === 's') {
      done();
      editor.flush();
      return toast(t('shortcuts.saved'));
    }
    if (m) return;
    if (e.key === 'Delete' || e.key === 'Backspace') return done(), editor.deleteSelection();
    if (e.key === 'Escape') {
      if (editor.drawTool) return editor.emit('stop-drawing');
      if (editor.cropId) {
        editor.cropId = null;
        return editor.emit('selection');
      }
      return editor.deselect();
    }
    if (e.key === ']') return done(), editor.reorder('forward');
    if (e.key === '[') return done(), editor.reorder('backward');
    if (e.key.startsWith('Arrow')) {
      // (Alt+Left and Right are the browser's Back and Forward: never here, where they'd close the editor.)
      if (!editor.selection.length) return void (e.altKey && done());
      done();
      const step = e.shiftKey ? 10 : 1;
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      // With Alt the selection grows or shrinks instead (right and down: bigger).
      if (e.altKey) return editor.resizeBy(dx, dy);
      return editor.nudge(dx, dy);
    }
    if (e.key === 'Enter') {
      const el = editor.single;
      if (el?.type === 'text' && !el.locked) return done(), canvas.startTextEdit(el);
      return;
    }
    if (e.key === '?') return done(), cheatSheet();
    if (k === 't') return done(), editor.addText('body');
    if (k === 'r' && e.shiftKey) return done(), editor.setView({ rulers: !editor.view.rulers });
    if (k === 'r') return done(), editor.addShape('rect');
    if (k === 'o') return done(), editor.addShape('ellipse');
    if (k === 'l') return done(), editor.addLine();
  };

  const onCopy = (e) => {
    if (typing(e) || !editor.selection.length) return;
    editor.copy();
    e.clipboardData?.setData('text/plain', MARKER);
    e.preventDefault();
  };
  const onCut = (e) => {
    if (typing(e) || !editor.selection.length) return;
    e.clipboardData?.setData('text/plain', MARKER);
    e.preventDefault();
  };
  const onPaste = async (e) => {
    if (typing(e)) return;
    clearTimeout(pasteFallback);
    e.preventDefault();
    const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
    if (files.length) {
      for (const f of files) {
        try {
          await editor.addImage(await editor.importImageFile(f));
        } catch (err) {
          toast(err.message, 'error');
        }
      }
      return;
    }
    const text = e.clipboardData?.getData('text/plain') || '';
    if (text && text !== MARKER) {
      editor.addText('body', { text: text.slice(0, 2000) });
      return;
    }
    editor.paste();
  };

  document.addEventListener('keydown', onKey);
  document.addEventListener('copy', onCopy);
  document.addEventListener('cut', onCut);
  document.addEventListener('paste', onPaste);
  return () => {
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('copy', onCopy);
    document.removeEventListener('cut', onCut);
    document.removeEventListener('paste', onPaste);
  };
}
