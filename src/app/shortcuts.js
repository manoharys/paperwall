// Keyboard shortcuts, clipboard handling, and the cheat sheet.

import { h, dialog, mod, toast } from './ui.js';

export const SHORTCUTS = [
  ['Undo', `${mod}+Z`],
  ['Redo', `${mod}+Shift+Z`],
  ['Copy, cut, paste', `${mod}+C, X, V`],
  ['Duplicate', `${mod}+D`],
  ['Delete', 'Delete or Backspace'],
  ['Select everything', `${mod}+A`],
  ['Deselect', 'Esc'],
  ['Move 1 px (10 px)', 'Arrows (with Shift)'],
  ['Group / ungroup', `${mod}+G / ${mod}+Shift+G`],
  ['Lock / unlock', `${mod}+L`],
  ['Forward / backward', '] / ['],
  ['To front / to back', `${mod}+] / ${mod}+[`],
  ['Copy / paste style', `${mod}+Alt+C / ${mod}+Alt+V`],
  ['Edit selected text', 'Enter'],
  ['Add text, rectangle, circle, line', 'T, R, O, L'],
  ['Zoom in / out / fit', `${mod}+= / ${mod}+- / ${mod}+0`],
  ['Find and replace', `${mod}+F`],
  ['Rulers on / off', 'Shift+R'],
  ['Stop drawing', 'Esc'],
  ['Zoom with the mouse', `${mod}+scroll`],
  ['Move around', 'Scroll, or hold Space and drag'],
  ['Keep proportions while resizing', 'Shift'],
  ['Rotate in 15° steps', 'Shift while rotating'],
  ['Move without snapping', 'Alt while dragging'],
  ['Download', `${mod}+E`],
  ['This cheat sheet', '?'],
];

export function cheatSheet() {
  return dialog('Keyboard shortcuts', h('table', { class: 'shortcuts', 'data-testid': 'shortcuts' },
    h('tbody', null, SHORTCUTS.map(([what, keys]) => h('tr', null, h('td', null, what), h('td', null, h('kbd', null, keys)))))));
}

function typing(e) {
  const t = e.target;
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

const MARKER = 'paperwall:elements';

/** Wire up shortcuts. Returns a function that removes them. */
export function bindShortcuts(editor, canvas, actions) {
  let pasteFallback = null;

  const onKey = (e) => {
    if (typing(e) || document.querySelector('.backdrop, .presenter')) return;
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
      return toast('Saved on this device. Use "Save to file" to keep a copy elsewhere.');
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
      if (!editor.selection.length) return;
      done();
      const step = e.shiftKey ? 10 : 1;
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
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
