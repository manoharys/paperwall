// "Remove background (smart)": cuts the subject out of a busy photo with a
// small segmentation model that runs on this device. The model's weights are
// downloaded once, only after the person says yes (we show the size and
// where from), checked against a pinned SHA-256 and kept in this browser.
// Pictures never leave the device.

import { h, toast, dialog } from './ui.js';
import { get, put } from './store.js';
import { isOn, setOn, providerFor, providerFetch, PROVIDERS } from './online.js';
import { readModel } from '../model/onnx.js';
import { runModel } from '../model/onnx-ops.js';
import { modelInput, maskFromOutput, applyMask } from '../model/cutout.js';
import { glRunner } from './onnx-gl.js';

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
  if (!globalThis.crypto?.subtle) throw new Error("This browser can't check the download");
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Whether the model is on this device (and the feature turned on). */
export async function cutoutReady() {
  const spec = await cutoutModel();
  return (await isOn(FEATURE)) && !!(await get('settings', storeKey(spec.sha256)));
}

let loaded = null; // { sha, model } once read this session

/**
 * The model, ready to run: from this device, or downloaded (only when
 * `download` is true, i.e. the person said yes). onProgress(0..1) while downloading.
 */
async function loadModel({ download = false, onProgress, signal } = {}) {
  const spec = await cutoutModel();
  if (loaded?.sha === spec.sha256) return loaded.model;
  let bytes = await get('settings', storeKey(spec.sha256));
  // (Checked again when read back: a damaged copy is fetched again.)
  if (bytes && (await sha256(bytes)) !== spec.sha256) bytes = null;
  if (!bytes) {
    if (!download) throw new Error('The background removal model is not on this device yet');
    bytes = await fetchModel(spec, { onProgress, signal });
    await put('settings', storeKey(spec.sha256), bytes);
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
        throw new Error('The download is much bigger than expected, so it was stopped');
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
  if ((await sha256(bytes)) !== spec.sha256) throw new Error("The downloaded model isn't the expected file, so it wasn't used");
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
    } else if (engine === 'gpu') throw new Error('No graphics card support here');
  }
  return { out: (await runModel(model, feeds, { onProgress, signal, pause }))[name], engine: 'cpu' };
}

/** Find the subject of RGBA pixels: a mask { mask, mw, mh } from 0 (background) to 1. */
export async function findSubject(model, rgba, w, h, opts) {
  const size = model.graph.inputs[0].shape?.[2];
  const input = modelInput(rgba, w, h, Number.isInteger(size) && size > 0 ? size : undefined);
  const { out } = await runCutoutModel(model, input, opts);
  return maskFromOutput(out);
}

// What each cut-out picture was made from, this session, so its edges can be refined.
const cuts = new Map(); // new asset id → { source (data URL), mask, refine, name }

/** The cut made for a picture (for "Refine edges"), or null. */
export function cutoutOf(assetId) {
  return cuts.get(assetId) || null;
}

export const DEFAULT_REFINE = 0.5;

/** Redo a cut-out's edges, crisper or softer (refine 0..1). Slider moves merge into one undo step. */
export async function refineCutout(ed, el, refine) {
  const cut = cuts.get(el.assetId);
  if (!cut) return;
  const id = await ed.remakeImage(el.id, cut.source, (px, w, h) => void applyMask(px, w, h, cut.mask, { refine }), { key: `cutout-refine:${el.id}`, name: cut.name });
  if (id) cuts.set(id, { ...cut, refine });
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
  const d = dialog('Remove background (smart)', body, {
    testid: 'cutout-dialog',
    steady: () => busy,
    onClose: () => {
      if (busy) toast('Stopped');
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
    show(status, progress, h('div', { class: 'row end' }, h('button', { type: 'button', class: 'btn', 'data-testid': 'cutout-stop', onClick: () => d.close() }, 'Stop')));
  };
  const step = (v) => {
    progress.value = v;
  };

  const go = async (download) => {
    busy = true;
    try {
      working(download ? `Downloading the model from ${spec.host}…` : 'Getting the model ready…');
      const model = await loadModel({ download, onProgress: step, signal: stopper.signal });
      if (download) await setOn(FEATURE, true);
      working('Finding the subject… (on this device)');
      const name = `${asset.name || 'image'} (cut out)`;
      let mask = null;
      const id = await ed.remakeImage(el.id, asset.dataUrl, async (px, w, h) => {
        mask = await findSubject(model, px, w, h, { onProgress: step, signal: stopper.signal });
        if (stopper.signal.aborted) throw stopper.signal.reason;
        applyMask(px, w, h, mask, { refine: DEFAULT_REFINE });
      }, { name });
      busy = false;
      d.close();
      if (!id) return; // (the picture was changed meanwhile: nothing to put back)
      cuts.set(id, { source: asset.dataUrl, mask, refine: DEFAULT_REFINE, name });
      ed.emit('selection'); // (shows Refine edges)
      toast('Background removed. Undo if it took too much.');
    } catch (e) {
      busy = false;
      if (stopper.signal.aborted) return;
      d.close();
      toast(e?.message || 'That image could not be processed.', 'error');
    }
  };

  if (ready) return go(false);
  const mb = (spec.bytes / 1e6).toFixed(1);
  show(
    h('p', null, 'Smart removal finds the subject of a photo (a person, a pet, a product) with a small AI model that runs on this device.'),
    h('p', null, `It needs the model first, downloaded once: ${spec.name.replace(/ \(.*\)$/, '')}, ${mb} MB from ${spec.host} (${spec.license} license). After that it works offline, and your pictures never leave this device.`),
    h('div', { class: 'row end' },
      h('button', { type: 'button', class: 'btn', onClick: () => d.close() }, 'Not now'),
      h('button', { type: 'button', class: 'btn primary', 'data-testid': 'cutout-download', onClick: () => go(true) }, `Download (${mb} MB) and turn on`)));
}

/** For tests and power users. */
export const api = { cutoutModel, cutoutReady, runCutoutModel, findSubject, readModel };
