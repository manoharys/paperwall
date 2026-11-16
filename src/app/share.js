// Share a design as a link, and open one. The design rides in the link
// itself (src/model/share-link.js): nothing is uploaded, and opening a link
// asks first, then keeps a copy on this device.

import { shareLink, readShareHash } from '../model/share-link.js';
import { renderPage } from '../model/render.js';
import { validateDesign, uid } from '../model/doc.js';
import { measure, ensureDesignFonts } from './fonts.js';
import { saveProjectFile } from './export.js';
import { h, dialog, toast } from './ui.js';
import { t } from './i18n.js';

/** Where a link should point when Paperwall was opened from a file on disk. */
const HOSTED = 'https://manoharys.github.io/paperwall/';

/** The Share dialog: the link to copy, or, for a design too big for one, a file instead. */
export function shareDialog(doc) {
  const base = location.protocol === 'file:' ? HOSTED : location.href;
  const { link, fits } = shareLink(doc, base);
  const body = h('div', { class: 'stack share' });
  const { close } = dialog(t('share.title'), body, { testid: 'share-dialog' });
  if (!fits) {
    body.append(
      h('p', { 'data-testid': 'share-too-big' }, t('share.tooBig')),
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn primary', 'data-testid': 'share-save-file', onClick: () => {
        saveProjectFile(doc);
        close();
      } }, t('top.saveFile'))));
    body.querySelector('button')?.focus();
    return;
  }
  const field = h('input', { type: 'text', readonly: true, spellcheck: 'false', 'aria-label': t('share.link'), 'data-testid': 'share-link' });
  field.value = link;
  const copy = h('button', { type: 'button', class: 'btn primary', 'data-testid': 'share-copy', onClick: async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast(t('share.copied'));
    } catch {
      // (No clipboard here: the link is selected, ready to copy by hand.)
      field.focus();
      field.select();
    }
  } }, t('share.copy'));
  body.append(h('p', { class: 'hint' }, t('share.how')), field, h('div', { class: 'row' }, copy));
  copy.focus();
}

/**
 * When the page was opened from a shared link: show the design and ask
 * before keeping a copy. The link is taken off the address bar first, so a
 * reload or Back doesn't ask again. The preview uses bundled fonts only: a
 * shared design's own fonts come in only once it's opened. Returns whether
 * there was a link.
 */
export async function offerSharedDesign(hash, { newDesign }) {
  if (typeof hash !== 'string' || !hash.startsWith('#share=')) return false;
  history.replaceState(null, '', `${location.pathname}${location.search}#/`);
  let doc;
  let preview;
  try {
    doc = readShareHash(hash);
    validateDesign(doc);
    await ensureDesignFonts(doc);
    // (Its first page that isn't hidden.)
    const first = Math.max(0, doc.pages.findIndex((p) => !p.hidden));
    preview = renderPage(doc, first, { measure, noSize: true, idPrefix: 'shared-' });
  } catch {
    toast(t('share.broken'), 'error');
    return true;
  }
  // (Somewhere else by now, like a design opened meanwhile: not asked over it.)
  if (location.hash !== '#/') return true;
  const body = h('div', { class: 'stack share' });
  const { close } = dialog(t('share.openTitle'), body, { testid: 'share-open-dialog' });
  body.append(
    h('span', { class: 'share-preview', style: { aspectRatio: `${doc.width} / ${doc.height}` }, html: preview }),
    h('p', { class: 'share-name' }, doc.name),
    h('p', { class: 'hint' }, t('share.openHint')),
    h('div', { class: 'row' },
      h('button', { type: 'button', class: 'btn primary', 'data-testid': 'share-open', onClick: () => {
        close();
        const now = Date.now();
        // Always its own copy: a new id, so it never lands on a design already here.
        Promise.resolve(newDesign({ ...doc, id: uid('d'), createdAt: now, updatedAt: now })).catch((e) => toast(e.message, 'error'));
      } }, t('share.open')),
      h('button', { type: 'button', class: 'btn', 'data-testid': 'share-cancel', onClick: () => close() }, t('common.cancel'))));
  body.querySelector('[data-testid="share-open"]').focus();
  return true;
}
