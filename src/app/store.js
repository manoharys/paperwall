// Everything is stored in this browser, on this device: designs, the images
// you've added, and your brand kit. Nothing is ever sent anywhere.

const DB_NAME = 'paperwall';
const DB_VERSION = 2;
const STORES = ['designs', 'uploads', 'settings', 'versions'];

let dbPromise = null;
const memory = Object.fromEntries(STORES.map((s) => [s, new Map()]));
let persistent = true;
let outdated = false; // a newer Paperwall upgraded storage in another tab

const OUTDATED = 'Paperwall was updated in another tab. Reload this tab to keep using your designs.';

function open() {
  // Once another tab has upgraded storage, this tab can't use it: every read
  // and write fails (and says why) instead of quietly using an empty memory store.
  if (outdated) return Promise.reject(new Error(OUTDATED));
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    let req;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      persistent = false;
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
    };
    // Let a newer version of Paperwall in another tab upgrade the database;
    // the next read or write here opens it again.
    const watch = (db) => {
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      db.onclose = () => {
        dbPromise = null;
      };
      return db;
    };
    req.onsuccess = () => resolve(watch(req.result));
    req.onblocked = () => {
      // An older Paperwall tab still has the database open and doesn't know to
      // let go (newer tabs do). The browser holds every request here until it
      // closes, so say what to do; everything continues once it's closed.
      globalThis.dispatchEvent?.(new CustomEvent('paperwall:storage-blocked'));
    };
    req.onerror = () => {
      if (req.error?.name === 'VersionError') {
        // A newer Paperwall in another tab upgraded the database. Don't fall
        // back to memory (edits would vanish): stop saving and say so.
        outdated = true;
        globalThis.dispatchEvent?.(new CustomEvent('paperwall:storage-outdated'));
        dbPromise = null;
        reject(new Error(OUTDATED));
        return;
      }
      persistent = false;
      resolve(null);
    };
  });
  return dbPromise;
}

/**
 * One read or write: a transaction on the database (opened again once if
 * another tab closed it), or `inMemory()` when this browser can't store.
 */
function run(store, mode, fn, inMemory) {
  return withDb((db) => (db ? tx(db, store, mode, fn) : inMemory()));
}

/** Run fn(db) with the open database, reopening once if another tab closed it. */
async function withDb(fn) {
  try {
    return await fn(await open());
  } catch (e) {
    if (e?.name !== 'InvalidStateError') throw e;
    dbPromise = null;
    const db = await open();
    if (!db) throw e; // storage went away altogether: say what really happened
    return fn(db);
  }
}

function tx(db, store, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    const req = fn(s);
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Storage is full'));
  });
}

export function isPersistent() {
  return persistent;
}

export async function put(store, key, value) {
  await run(store, 'readwrite', (s) => void s.put(value, key), () => void memory[store].set(key, value));
}

/** Several puts (value set) and deletes (value undefined) in one transaction. */
async function batch(store, ops) {
  if (!ops.length) return;
  await run(store, 'readwrite', (s) => {
    for (const [k, v] of ops) v === undefined ? s.delete(k) : s.put(v, k);
  }, () => {
    for (const [k, v] of ops) v === undefined ? memory[store].delete(k) : memory[store].set(k, v);
  });
}

export function get(store, key) {
  return run(store, 'readonly', (s) => s.get(key), () => memory[store].get(key));
}

export async function del(store, key) {
  await run(store, 'readwrite', (s) => void s.delete(key), () => void memory[store].delete(key));
}

export function all(store) {
  return run(store, 'readonly', (s) => s.getAll(), () => [...memory[store].values()]);
}

// ---------- designs ----------

/** Save a design with a small preview image. */
export async function saveDesign(doc, thumb) {
  const prev = thumb === undefined ? await get('designs', doc.id) : null;
  await put('designs', doc.id, { id: doc.id, name: doc.name, updatedAt: doc.updatedAt, width: doc.width, height: doc.height, pages: doc.pages.length, thumb: thumb ?? prev?.thumb ?? null, doc });
}

export async function loadDesign(id) {
  return (await get('designs', id))?.doc || null;
}

export async function listDesigns() {
  const rows = await all('designs');
  return rows.map(({ doc, ...meta }) => meta).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteDesign(id) {
  await del('designs', id);
  // The design is gone either way; its history is cleaned up as well as it can be.
  await deleteVersions(id).catch(() => null);
}

// ---------- version history (per design, on this device) ----------
// Keys: "<designId>|v|<time>" for a version's details (small: shown in the
// list), "<designId>|d|<time>" for the design itself without its images,
// and "<designId>|a|<assetId>" for each image, stored once and shared by
// every version that uses it.

export const MAX_VERSIONS = 30;
const stamp = (at) => String(at).padStart(15, '0');
// Each tab tags its keys, so two tabs saving in the same millisecond don't
// overwrite each other (the time still comes first, so keys sort by time).
const TAB = Math.random().toString(36).slice(2, 6);
const vKey = (designId, at) => `${designId}|v|${stamp(at)}~${TAB}`;
const dKey = (designId, at) => `${designId}|d|${stamp(at)}~${TAB}`;
const aKey = (designId, assetId) => `${designId}|a|${assetId}`;
const range = (prefix) => [prefix, `${prefix}\uffff`];

/** Without IndexedDB: the in-memory versions under a prefix, as [key, value] in key order. */
const inMemory = (prefix) => {
  const [lo, hi] = range(prefix);
  return [...memory.versions.entries()].filter(([k]) => k >= lo && k <= hi).sort(([a], [b]) => (a < b ? -1 : 1));
};

function keysIn(prefix) {
  const [lo, hi] = range(prefix);
  return run('versions', 'readonly', (s) => s.getAllKeys(IDBKeyRange.bound(lo, hi)), () => inMemory(prefix).map(([k]) => k));
}

function valuesIn(prefix) {
  const [lo, hi] = range(prefix);
  return run('versions', 'readonly', (s) => s.getAll(IDBKeyRange.bound(lo, hi)), () => inMemory(prefix).map(([, v]) => v));
}

/** Several values by key, in one transaction (undefined where missing). */
async function getMany(store, keys) {
  if (!keys.length) return [];
  let reqs = null;
  const kept = await run(store, 'readonly', (s) => void (reqs = keys.map((k) => s.get(k))), () => keys.map((k) => memory[store].get(k)));
  return reqs ? reqs.map((r) => r.result) : kept;
}

// Versions are saved one at a time, so one save's clean-up can't remove
// images another save has written but not yet pointed to.
let versionQueue = Promise.resolve();

/** Keep a copy of the design as it is now. The oldest beyond MAX_VERSIONS are dropped. */
export function saveVersion(doc, opts) {
  const job = versionQueue.then(() => writeVersion(doc, opts));
  versionQueue = job.catch(() => null);
  return job;
}

let lastAt = 0;

async function writeVersion(doc, { label = '', thumb = null } = {}) {
  // Keyed by time: two versions in the same millisecond mustn't share a key.
  const at = (lastAt = Math.max(Date.now(), lastAt + 1));
  // `doc` is a copy nobody changes (versionSnapshot); the images are stored separately, once.
  const { assets, ...rest } = doc;
  const details = { key: vKey(doc.id, at), designId: doc.id, at, label, thumb, name: doc.name, pages: doc.pages.length, width: doc.width, height: doc.height, assetIds: Object.keys(assets || {}) };
  // Which images are already stored is checked in the same transaction that
  // writes the version, so another tab's clean-up can't remove one in between.
  const [alo, ahi] = range(`${doc.id}|a|`);
  await run('versions', 'readwrite', (s) => {
    const have = s.getAllKeys(IDBKeyRange.bound(alo, ahi));
    have.onsuccess = () => {
      const stored = new Set(have.result);
      for (const [id, a] of Object.entries(assets || {})) if (!stored.has(aKey(doc.id, id))) s.put(a, aKey(doc.id, id));
      s.put(rest, dKey(doc.id, at));
      s.put(details, vKey(doc.id, at));
    };
  }, () => {
    for (const [id, a] of Object.entries(assets || {})) if (!memory.versions.has(aKey(doc.id, id))) memory.versions.set(aKey(doc.id, id), a);
    memory.versions.set(dKey(doc.id, at), rest);
    memory.versions.set(vKey(doc.id, at), details);
  });
  const keys = await keysIn(`${doc.id}|v|`);
  const drop = keys.slice(0, Math.max(0, keys.length - MAX_VERSIONS));
  if (drop.length) await prune(doc.id, drop);
  return vKey(doc.id, at);
}

/**
 * Drop old versions, then images no remaining version uses. It all happens
 * in one transaction, so another tab can't add a version (and its images)
 * between deciding what's unused and deleting it.
 */
async function prune(designId, drop) {
  const [vlo, vhi] = range(`${designId}|v|`);
  const [alo, ahi] = range(`${designId}|a|`);
  await run('versions', 'readwrite', (s) => {
    for (const k of drop) {
      s.delete(k);
      s.delete(k.replace('|v|', '|d|'));
    }
    const kept = s.getAll(IDBKeyRange.bound(vlo, vhi));
    kept.onsuccess = () => {
      const used = new Set(kept.result.flatMap((v) => v.assetIds || []));
      const images = s.getAllKeys(IDBKeyRange.bound(alo, ahi));
      images.onsuccess = () => {
        for (const k of images.result) if (!used.has(k.slice(alo.length))) s.delete(k);
      };
    };
  }, () => {
    const m = memory.versions;
    for (const k of drop) {
      m.delete(k);
      m.delete(k.replace('|v|', '|d|'));
    }
    const used = new Set(inMemory(`${designId}|v|`).flatMap(([, v]) => v.assetIds || []));
    for (const [k] of inMemory(`${designId}|a|`)) if (!used.has(k.slice(alo.length))) m.delete(k);
  });
}

/** Whether a design has any versions yet (just counts them). */
export async function hasVersions(designId) {
  const [lo, hi] = range(`${designId}|v|`);
  return (await run('versions', 'readonly', (s) => s.count(IDBKeyRange.bound(lo, hi)), () => inMemory(`${designId}|v|`).length)) > 0;
}

/** A design's saved versions (just their details), newest first. */
export async function listVersions(designId) {
  return (await valuesIn(`${designId}|v|`)).sort((a, b) => b.at - a.at);
}

/** A version as a whole design again, images included. */
export async function versionDoc(version) {
  const doc = await get('versions', version.key.replace('|v|', '|d|'));
  if (!doc) throw new Error('This version is missing');
  // Just the images this version uses, in one read.
  const ids = version.assetIds || [];
  const found = await getMany('versions', ids.map((id) => aKey(version.designId, id)));
  const assets = {};
  ids.forEach((id, i) => {
    if (found[i]) assets[id] = found[i];
  });
  return { ...doc, assets };
}

function deleteVersions(designId) {
  // After any version still being saved, so it can't land once the rest is gone.
  const job = versionQueue.then(async () => batch('versions', (await keysIn(`${designId}|`)).map((k) => [k, undefined])));
  versionQueue = job.catch(() => null);
  return job;
}

// ---------- uploads (reusable across designs) ----------

// A video's or sound's bytes are kept apart from its details ("~data|<id>",
// sorting after every upload id), so listing Uploads doesn't read every video.
const DATA = '~data|';
const isMedia = (u) => u.kind === 'video' || u.kind === 'audio';

export async function saveUpload(upload) {
  if (!isMedia(upload)) return put('uploads', upload.id, upload);
  const { dataUrl, ...details } = upload;
  await batch('uploads', [[`${DATA}${upload.id}`, { dataUrl }], [upload.id, details]]);
}

/** Every upload, newest first: pictures whole, videos and sounds without their bytes (getUpload has them). */
export async function listUploads() {
  const rows = await run('uploads', 'readonly', (s) => s.getAll(IDBKeyRange.upperBound('~', true)),
    () => [...memory.uploads].filter(([k]) => !k.startsWith(DATA)).map(([, v]) => v));
  return rows.sort((a, b) => b.addedAt - a.addedAt);
}

/** An upload, whole. */
export async function getUpload(id) {
  const [upload, data] = await getMany('uploads', [id, `${DATA}${id}`]);
  if (!upload) return upload;
  return data ? { ...upload, ...data } : upload;
}

export async function deleteUpload(id) {
  await batch('uploads', [[id, undefined], [`${DATA}${id}`, undefined]]);
}

// ---------- settings ----------

export async function getSetting(key, fallback = null) {
  const v = await get('settings', key);
  return v === undefined ? fallback : v;
}

export async function setSetting(key, value) {
  await put('settings', key, value);
}
