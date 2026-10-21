// t('inspector.removeBgSmart'): cuts the subject out of a busy photo with a
// small segmentation model that runs on this device. The model's weights are
// downloaded once, only after the person says yes (we show the size and
// where from), checked against a pinned SHA-256 and kept in this browser.
// Pictures never leave the device.

import { h, toast, dialog } from './ui.js';
import { get, put, del } from './store.js';
import { isOn, setOn, providerFor, providerFetch, PROVIDERS } from './online.js';
import { readModel } from '../model/onnx.js';
import { runModel } from '../model/onnx-ops.js';
import { modelInput, maskFromOutput, applyMask } from '../model/cutout.js';
import { glRunner } from './onnx-gl.js';
import { t, formatNumber } from './i18n.js';

const FEATURE = 'cutout';
const MAX_BYTES = 64 * 1024 * 1024; // (no model this feature uses comes near)
const storeKey = (sha) => `cutout|model|${sha}`;

/** The model file picked for this feature: { id, name, url, sha256, bytes, license, host }. */
export async function cutoutModel() {
  const id = await providerFor(FEATURE);
  const p = PROVIDERS[id];
  return { id, name: p.name, site: p.site, ...p.model, sha256: expectedHash(p.model), host: new URL(p.model.url).host };
}

/**
 * The SHA-256 the file must have. Automated browser tests serve a tiny model
 * of their own and say its hash; only a browser under automation (which says
 * so: navigator.webdriver) is listened to.
 */
function expectedHash(spec) {
  const test = globalThis.PAPERWALL_TEST_CUTOUT_SHA256;
  return typeof test === 'string' && /^[0-9a-f]{64}$/.test(test) && globalThis.navigator?.webdriver === true ? test : spec.sha256;
}

async function sha256(bytes) {
  if (!globalThis.crypto?.subtle) throw new Error(t('cutout.noCrypto'));
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Whether the model is on this device (and the feature turned on), without reading it. */
export async function cutoutReady() {
  const spec = await cutoutModel();
  if (!(await isOn(FEATURE))) return false;
  if (loaded?.sha === spec.sha256) return true;
  return (await get('settings', okKey(spec.sha256))) === true;
}

// (A small mark that the model is stored, so checking needn't read 4.6 MB.)
const okKey = (sha) => `cutout|ok|${sha}`;

let loaded = null; // { sha, model } once read this session

/**
 * The model, ready to run: from this device, or downloaded (only when
 * `download` is true, i.e. the person said yes). onProgress(0..1) while downloading.
 */
async function loadModel({ download = false, onProgress, signal } = {}) {
  const spec = await cutoutModel();
  if (loaded?.sha === spec.sha256) return loaded.model;
  let bytes = await get('settings', storeKey(spec.sha256));
  // (Checked again when read back: a damaged copy goes, and is fetched again.)
  if (bytes && (await sha256(bytes)) !== spec.sha256) {
    bytes = null;
    await Promise.all([del('settings', storeKey(spec.sha256)), del('settings', okKey(spec.sha256))]);
  }
  if (!bytes) {
    if (!download) throw Object.assign(new Error(t('cutout.missing')), { missing: true });
    bytes = await fetchModel(spec, { onProgress, signal });
    await put('settings', storeKey(spec.sha256), bytes);
    await put('settings', okKey(spec.sha256), true);
  }
  const model = readModel(new Uint8Array(bytes));
  loaded = { sha: spec.sha256, model };
  return model;
}

/** Download the pinned file, showing progress, and refuse it unless its hash matches. */
async function fetchModel(spec, { onProgress, signal }) {
  const res = await providerFetch(spec.id, spec.url, { signal });
  const total = Number(res.headers.get('content-length')) || spec.bytes;
  let bytes;
  if (res.body?.getReader) {
    const reader = res.body.getReader();
    const parts = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      got += value.length;
      if (got > MAX_BYTES) {
        reader.cancel().catch(() => null);
        throw new Error(t('cutout.tooBig'));
      }
      parts.push(value);
      onProgress?.(Math.min(1, got / total));
    }
    bytes = new Uint8Array(got);
    let at = 0;
    for (const p of parts) {
      bytes.set(p, at);
      at += p.length;
    }
  } else bytes = new Uint8Array(await res.arrayBuffer());
  if ((await sha256(bytes)) !== spec.sha256) throw new Error(t('cutout.badHash'));
  return bytes.buffer;
}

const pause = () => new Promise((r) => setTimeout(r, 0));

/**
 * Run the model: on the graphics card when this browser can, else on the
 * processor. engine: 'auto', 'gpu' or 'cpu'. Returns { out, engine }.
 */
export async function runCutoutModel(model, input, { onProgress, signal, engine = 'auto' } = {}) {
  const feeds = { [model.graph.inputs[0].name]: input };
  const name = model.graph.outputs[0].name;
  if (engine !== 'cpu') {
    const gl = glRunner({ software: engine === 'gpu' });
    if (gl) {
      try {
        return { out: (await gl.run(model, feeds, { onProgress, signal, pause }))[name], engine: 'gpu' };
      } catch (e) {
        if (signal?.aborted || engine === 'gpu') throw e;
        // (Something the graphics card couldn't do: the processor can.)
      }
    } else if (engine === 'gpu') throw new Error(t('cutout.noGpu'));
  }
  return { out: (await runModel(model, feeds, { onProgress, signal, pause }))[name], engine: 'cpu' };
}

/** RGBA pixels at most `max` on a side (as they are when smaller already). */
function shrink(rgba, w, h, max) {
  if (Math.max(w, h) <= max || typeof document === 'undefined') return { rgba, w, h };
  const s = max / Math.max(w, h);
  const [sw, sh] = [Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s))];
  const full = document.createElement('canvas');
  full.width = w;
  full.height = h;
  full.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, w * h * 4), w, h), 0, 0);
  const out = document.createElement('canvas');
  out.width = sw;
  out.height = sh;
  const g = out.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingQuality = 'high';
  g.drawImage(full, 0, 0, sw, sh);
  full.width = full.height = 0;
  return { rgba: g.getImageData(0, 0, sw, sh).data, w: sw, h: sh };
}

/** Find the subject of RGBA pixels: a mask { mask, mw, mh } from 0 (background) to 1. */
export async function findSubject(model, rgba, w, h, opts) {
  const size = model.graph.inputs[0].shape?.[2];
  const side = Number.isInteger(size) && size > 0 ? size : undefined;
  // (A big photo is made smaller first: the model sees only a small square.)
  const small = shrink(rgba, w, h, 2 * (side || 320));
  const input = modelInput(small.rgba, small.w, small.h, side);
  const { out } = await runCutoutModel(model, input, opts);
  return maskFromOutput(out);
}

// What each cut-out picture was made from, this session, so its edges can be refined.
const cuts = new Map(); // new asset id → { source (data URL), mask, refine, name }

/** Let go of every cut kept for refining (the editor is closing). */
export function forgetCuts() {
  cuts.clear();
}

/** The cut made for a picture (for "Refine edges"), or null. */
export function cutoutOf(assetId) {
  return cuts.get(assetId) || null;
}

export const DEFAULT_REFINE = 0.5;

const refining = new Map(); // element id → its latest refine

/**
 * Redo a cut-out's edges, crisper or softer (refine 0..1). Slider moves
 * merge into one undo step, and each waits for the one before (the last
 * one wins), working from the picture as it is by then.
 */
export function refineCutout(ed, el, refine) {
  const job = (refining.get(el.id) || Promise.resolve()).then(async () => {
    const now = ed.find(el.id);
    const cut = now && cuts.get(now.assetId);
    if (!cut) return;
    const id = await ed.remakeImage(el.id, cut.source, (px, w, h) => void applyMask(px, w, h, cut.mask, { refine }), { key: `cutout-refine:${el.id}`, name: cut.name, from: now.assetId });
    if (!id) return;
    cuts.set(id, { ...cut, refine });
    ed.emit('selection'); // (the panel shows Refine edges for the new picture)
  }).catch(() => null);
  refining.set(el.id, job);
  job.then(() => refining.get(el.id) === job && refining.delete(el.id));
  return job;
}

/**
 * The inspector's button: asks once to download the model (showing its size
 * and source), then cuts the selected picture out, with progress and Stop.
 */
export async function smartRemoveBackground(ed) {
  const el = ed.single;
  const asset = el?.type === 'image' ? ed.doc.assets[el.assetId] : null;
  if (!asset) return;
  const spec = await cutoutModel();
  const ready = await cutoutReady();
  const stopper = new AbortController();
  let busy = false;
  const body = h('div', { class: 'stack cutout' });
  const d = dialog(t('inspector.removeBgSmart'), body, {
    testid: 'cutout-dialog',
    steady: () => busy,
    onClose: () => {
      if (busy) toast(t('common.stopped'));
      stopper.abort();
    },
  });
  const show = (...children) => {
    body.replaceChildren(...children);
  };
  const progress = h('progress', { max: 1, value: 0, 'data-testid': 'cutout-progress' });
  const status = h('p', { class: 'hint', 'data-testid': 'cutout-status' });
  const working = (text) => {
    status.textContent = text;
    progress.removeAttribute('value'); // (moving, until there's a share to show)
    show(status, progress, h('div', { class: 'row end' }, h('button', { type: 'button', class: 'btn', 'data-testid': 'cutout-stop', onClick: () => d.close() }, t('common.stop'))));
  };
  const step = (v) => {
    progress.value = v;
  };

  const go = async (download) => {
    busy = true;
    try {
      working(download ? t('cutout.downloading', { host: spec.host }) : t('cutout.preparing'));
      const model = await loadModel({ download, onProgress: step, signal: stopper.signal });
      if (download) await setOn(FEATURE, true);
      working(t('cutout.finding'));
      const name = `${asset.name || 'image'} (cut out)`;
      let mask = null;
      const id = await ed.remakeImage(el.id, asset.dataUrl, async (px, w, h) => {
        mask = await findSubject(model, px, w, h, { onProgress: step, signal: stopper.signal });
        if (stopper.signal.aborted) throw stopper.signal.reason;
        applyMask(px, w, h, mask, { refine: DEFAULT_REFINE });
      }, { name, from: el.assetId }); // (the picture asked about, even if it changed during the download)
      busy = false;
      d.close();
      if (!id) return; // (the picture was changed meanwhile: nothing to put back)
      cuts.set(id, { source: asset.dataUrl, mask, refine: DEFAULT_REFINE, name });
      ed.emit('selection'); // (shows Refine edges)
      toast(t('inspector.bgRemoved'));
    } catch (e) {
      busy = false;
      if (stopper.signal.aborted) return;
      if (e?.missing) return offer(); // (gone or damaged here: asked again)
      d.close();
      toast(e?.message || t('inspector.imageBad'), 'error');
    }
  };

  const mb = formatNumber(spec.bytes / 1e6, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const offer = () => show(
    h('p', null, t('cutout.intro')),
    h('p', null, t('cutout.ask', { name: spec.name.replace(/ \(.*\)$/, ''), mb, host: spec.host, license: spec.license })),
    h('div', { class: 'row end' },
      h('button', { type: 'button', class: 'btn', onClick: () => d.close() }, t('cutout.notNow')),
      h('button', { type: 'button', class: 'btn primary', 'data-testid': 'cutout-download', onClick: () => go(true) }, t('cutout.download', { mb }))));
  if (ready) return go(false);
  offer();
}

/** For tests and power users. */
export const api = { cutoutModel, cutoutReady, runCutoutModel, findSubject, readModel };
