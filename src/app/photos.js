// Stock photos, in Uploads (an online extra): search Openverse, or Unsplash
// or Pexels with your own key, and add a photo with its credit. Off until the
// person turns it on; then only the search words (and the key, to its own
// provider) go out. Photos are kept in the design, so they work offline after.

import { h, icon, toast, pressable, lazily, loadImage, readFileAsDataUrl } from './ui.js';
import { section } from './widgets.js';
import { PROVIDERS, isOn, setOn, providerFor, keyFor, providerFetch } from './online.js';
import { openOnlineSettings } from './online-settings.js';
import { searchUrl, authHeaders, readResults, creditLine, creditText } from '../model/photos.js';
import { uid } from '../model/doc.js';
import * as store from './store.js';
import { t, tn } from './i18n.js';

const PICTURE = /^image\/(jpeg|png|webp|gif)\b/;

/** A picture from a provider, as a Blob of a kind the design can keep. */
async function pictureBlob(provider, url) {
  const res = await providerFetch(provider, url);
  const blob = await res.blob();
  const mime = (blob.type || res.headers.get('content-type') || '').toLowerCase().match(PICTURE)?.[0];
  if (!mime) throw new Error(t('photos.badKind'));
  return new Blob([blob], { type: mime });
}

let listening = null; // the Photos view showing now, told when online settings change

/**
 * The Photos view of the Uploads tab. `state` lives on the insert panel, so
 * results stay while other tabs are open.
 */
export function photosView(ed, state) {
  const wrap = h('div', { class: 'photos', 'data-testid': 'photos' });
  state.previews ||= new Map(); // preview address → blob: URL
  const forgetPreviews = () => {
    for (const url of state.previews.values()) URL.revokeObjectURL(url);
    state.previews.clear();
  };

  let shown = null; // what the view was last built for
  const fill = async () => {
    const [on, provider] = await Promise.all([isOn('photos'), providerFor('photos')]);
    const p = PROVIDERS[provider];
    const key = p.key ? await keyFor(provider) : '';
    // (Built again only when something it shows has changed: a search keeps going.)
    const now = `${on}|${provider}|${!!key}`;
    if (now === shown) return;
    shown = now;
    if (state.provider !== provider) {
      // Another provider: its own results.
      forgetPreviews();
      Object.assign(state, { provider, results: [], page: 0, more: false, error: '', search: (state.search || 0) + 1 });
    }
    const settings = h('button', { type: 'button', class: 'link-btn', 'data-testid': 'photos-settings', onClick: () => openOnlineSettings('photos') }, t('menu.online'));
    if (!on) {
      wrap.replaceChildren(
        h('p', { class: 'hint', 'data-testid': 'photos-note' }, t('photos.note', { name: p.name })),
        h('div', { class: 'row' },
          h('button', { type: 'button', class: 'btn small primary', 'data-testid': 'photos-turn-on', onClick: async () => {
            await setOn('photos', true);
            fill();
          } }, t('photos.turnOn')),
          settings));
      return;
    }
    if (p.key && !key) {
      wrap.replaceChildren(
        h('p', { class: 'hint' }, t('photos.needsKey', { name: p.name })),
        h('button', { type: 'button', class: 'btn small primary', 'data-testid': 'photos-add-key', onClick: () => openOnlineSettings('photos') }, t('photos.addKey')));
      return;
    }

    const input = h('input', { type: 'search', placeholder: t('photos.search', { name: p.name }), value: state.query || '', 'aria-label': t('photos.searchLabel', { name: p.name }), 'data-testid': 'photos-search', enterkeyhint: 'search' });
    const grid = h('div', { class: 'upload-grid photo-grid', 'data-testid': 'photos-grid' });
    const status = h('p', { class: 'hint', 'data-testid': 'photos-status', role: 'status' });
    const more = h('button', { type: 'button', class: 'btn small wide', 'data-testid': 'photos-more', hidden: true, onClick: () => search(state.page + 1) }, t('photos.more'));

    const tile = (r) => {
      const img = h('img', { alt: '', draggable: 'false' });
      const label = creditLine(r.credit) || t('photos.from', { name: p.name });
      const el = pressable({ class: 'upload-img photo', title: label, 'aria-label': t('insert.addNamed', { name: label }), 'data-testid': 'photo-item', draggable: 'true',
        onDragstart: (e) => {
          // Fetched while it's dragged: the page waits for it when it's dropped.
          r.uploadId ||= uid('u');
          store.comingUploads.set(r.uploadId, ready(r));
          e.dataTransfer.setData('application/x-paperwall-upload', r.uploadId);
          e.dataTransfer.effectAllowed = 'copy';
        },
        onDragend: (e) => {
          store.comingUploads.delete(r.uploadId);
          if (e.dataTransfer.dropEffect !== 'none') used(r);
        },
      }, async () => {
        el.classList.add('busy');
        try {
          const upload = await ready(r);
          if (ed.closed) return;
          await ed.place(upload);
          used(r);
        } catch (e) {
          toast(e.message, 'error');
        } finally {
          el.classList.remove('busy');
        }
      }, img);
      const shown = state.previews.get(r.preview);
      if (shown) img.src = shown;
      else {
        lazily(el, async () => {
          try {
            const url = URL.createObjectURL(await pictureBlob(provider, r.preview));
            state.previews.set(r.preview, url);
            img.src = url;
          } catch {
            el.classList.add('missing');
          }
        });
      }
      return el;
    };

    const show = () => {
      grid.replaceChildren(...state.results.map(tile));
      more.hidden = !state.more;
      status.textContent = state.error || (state.page && !state.results.length ? t('photos.none') : '');
    };

    const search = async (page) => {
      // (More of the same search, whatever's been typed in the box since.)
      const query = page > 1 ? state.query : input.value.trim();
      if (!query) return;
      if (page === 1) {
        forgetPreviews();
        Object.assign(state, { query, results: [], page: 0, more: false, search: (state.search || 0) + 1 });
        grid.replaceChildren();
      }
      const mine = state.search; // (more of an earlier search, answering late, isn't mixed in)
      status.textContent = t('photos.searching');
      more.disabled = true;
      try {
        const key = p.key ? await keyFor(provider) : '';
        const res = await providerFetch(provider, searchUrl(provider, query, page), { headers: authHeaders(provider, key) });
        const { photos, more: hasMore } = readResults(provider, await res.json(), page);
        // (A later search may have started meanwhile.)
        if (state.query !== query || state.provider !== provider || state.search !== mine) return;
        const seen = new Set(state.results.map((r) => r.id));
        Object.assign(state, { results: [...state.results, ...photos.filter((r) => !seen.has(r.id))], page, more: hasMore, error: '' });
      } catch (e) {
        // (An earlier search failing late doesn't put its error on this one.)
        if (state.search === mine) state.error = e.message;
      } finally {
        more.disabled = false;
      }
      // (The view may have been built again meanwhile: it shows the results then.)
      if (grid.isConnected) show();
      else if (wrap.isConnected) {
        shown = null;
        fill();
      }
    };

    const form = h('form', { class: 'search', role: 'search', onSubmit: (e) => {
      e.preventDefault();
      search(1);
    } }, icon('search', 18), input);
    wrap.replaceChildren(
      form,
      h('p', { class: 'hint' }, t('photos.hint', { name: p.name }), ' ', settings),
      // (Openverse passes every picture through its own address: the original
      // size when its source still has it, else a preview 600 px wide.)
      provider === 'openverse' ? h('p', { class: 'hint', 'data-testid': 'photos-size-note' }, t('photos.openverseSize')) : null,
      status,
      grid,
      more);
    show();
  };

  /** The photo as an upload, fetched once (and kept in Uploads too). */
  const ready = (r) => {
    r.ready ||= (async () => {
      const provider = state.provider;
      let blob;
      try {
        blob = await pictureBlob(provider, r.full);
      } catch (e) {
        // (Openverse's original-size picture can be missing; its smaller one is all there is then.)
        if (!r.fallback) throw e;
        blob = await pictureBlob(provider, r.fallback);
      }
      const dataUrl = await readFileAsDataUrl(blob);
      const img = await loadImage(dataUrl);
      r.uploadId ||= uid('u');
      const upload = { id: r.uploadId, name: (r.credit?.title || `${PROVIDERS[provider].name} photo`).slice(0, 120), mime: blob.type, dataUrl, width: img.naturalWidth, height: img.naturalHeight, addedAt: Date.now(), credit: r.credit };
      await store.saveUpload(upload).catch(() => null);
      return upload;
    })();
    r.ready.catch(() => (r.ready = null)); // (tried again next time)
    return r.ready;
  };

  /** Unsplash asks to be told each time one of its photos is used. */
  const used = async (r) => {
    if (!r.track) return;
    const key = await keyFor('unsplash');
    providerFetch('unsplash', r.track, { headers: authHeaders('unsplash', key) }).catch(() => null);
  };

  // Settings changed elsewhere (the Online extras dialog): show them, while this is on screen.
  // (One view listens at a time: an older one, replaced, stops.)
  window.removeEventListener('paperwall:online-changed', listening);
  const onChange = () => (wrap.isConnected ? fill() : window.removeEventListener('paperwall:online-changed', onChange));
  listening = onChange;
  window.addEventListener('paperwall:online-changed', onChange);
  fill();
  return wrap;
}

/** A stock photo's credit in the image's settings, with a button to copy it. */
export function creditSection(credit) {
  const link = (text, href) => (href ? h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, text) : text);
  // (A plain name goes into a sentence as a text node.)
  const wrap = (x) => (typeof x === 'string' ? document.createTextNode(x) : x);
  const c = credit;
  const words = (c.provider === 'Unsplash' || c.provider === 'Pexels') && c.creator
    ? tn('credit.byOn', { creator: wrap(link(c.creator, c.creatorUrl)), provider: wrap(link(c.provider, c.url)) })
    : [link(c.title ? `"${c.title}"` : t('credit.photo'), c.url), ...(c.creator ? tn('credit.by', { creator: wrap(link(c.creator, c.creatorUrl)) }) : []), c.license ? ', ' : '', c.license ? link(c.license, c.licenseUrl) : '', c.provider ? t('credit.via', { provider: c.provider }) : ''];
  return section(t('credit.title'),
    h('p', { class: 'credit', 'data-testid': 'image-credit' }, ...words),
    h('button', { type: 'button', class: 'btn small wide', 'data-testid': 'copy-credit', onClick: () => copyText(creditText(c)) }, icon('copy'), t('credit.copy')),
    h('p', { class: 'hint' }, t('credit.hint')));
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // (Without clipboard access: the old way, from a hidden text box.)
    const box = h('textarea', { style: { position: 'fixed', opacity: '0' } });
    box.value = text;
    document.body.append(box);
    box.select();
    const ok = document.execCommand('copy');
    box.remove();
    if (!ok) return toast(t('credit.copyFailed'), 'error');
  }
  toast(t('credit.copied'));
}
