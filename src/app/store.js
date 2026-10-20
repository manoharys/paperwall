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
 * Run a transaction, opening the database again once if it was closed under
 * us (another tab upgraded it).
 */
async function txRetry(db, store, mode, fn) {
  try {
    return await tx(db, store, mode, fn);
  } catch (e) {
    if (e?.name !== 'InvalidStateError') throw e;
    dbPromise = null;
    const fresh = await open();
    if (!fresh) throw e;
    return tx(fresh, store, mode, fn);
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
  const db = await open();
  if (!db) return void memory[store].set(key, value);
  await txRetry(db, store, 'readwrite', (s) => s.put(value, key));
}

/** Several puts (value set) and deletes (value undefined) in one transaction. */
async function batch(store, ops) {
  if (!ops.length) return;
  const db = await open();
  if (!db) {
    for (const [k, v] of ops) v === undefined ? memory[store].delete(k) : memory[store].set(k, v);
    return;
  }
  await txRetry(db, store, 'readwrite', (s) => {
    for (const [k, v] of ops) v === undefined ? s.delete(k) : s.put(v, k);
  });
}

export async function get(store, key) {
  const db = await open();
  if (!db) return memory[store].get(key);
  return txRetry(db, store, 'readonly', (s) => s.get(key));
}

export async function del(store, key) {
  const db = await open();
  if (!db) return void memory[store].delete(key);
  await txRetry(db, store, 'readwrite', (s) => s.delete(key));
}

export async function all(store) {
  const db = await open();
  if (!db) return [...memory[store].values()];
  return txRetry(db, store, 'readonly', (s) => s.getAll());
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
  await deleteVersions(id);
}

// ---------- version history (per design, on this device) ----------
// Keys: "<designId>|v|<time>" for a version's details (small: shown in the
// list), "<designId>|d|<time>" for the design itself without its images,
// and "<designId>|a|<assetId>" for each image, stored once and shared by
// every version that uses it.

export const MAX_VERSIONS = 30;
const stamp = (at) => String(at).padStart(15, '0');
const vKey = (designId, at) => `${designId}|v|${stamp(at)}`;
const dKey = (designId, at) => `${designId}|d|${stamp(at)}`;
const aKey = (designId, assetId) => `${designId}|a|${assetId}`;
const range = (prefix) => [prefix, `${prefix}\uffff`];

async function keysIn(prefix) {
  const [lo, hi] = range(prefix);
  const db = await open();
  if (!db) return [...memory.versions.keys()].filter((k) => k >= lo && k <= hi).sort();
  return txRetry(db, 'versions', 'readonly', (s) => s.getAllKeys(IDBKeyRange.bound(lo, hi)));
}

async function valuesIn(prefix) {
  const [lo, hi] = range(prefix);
  const db = await open();
  if (!db) return [...memory.versions.entries()].filter(([k]) => k >= lo && k <= hi).map(([, v]) => v);
  return txRetry(db, 'versions', 'readonly', (s) => s.getAll(IDBKeyRange.bound(lo, hi)));
}

// Versions are saved one at a time, so one save's clean-up can't remove
// images another save has written but not yet pointed to.
let versionQueue = Promise.resolve();

/** Keep a copy of the design as it is now. The oldest beyond MAX_VERSIONS are dropped. */
export function saveVersion(doc, opts) {
  const run = versionQueue.then(() => writeVersion(doc, opts));
  versionQueue = run.catch(() => null);
  return run;
}

async function writeVersion(doc, { label = '' } = {}) {
  const at = Date.now();
  const { assets, ...meta } = doc;
  const rest = JSON.parse(JSON.stringify(meta)); // the images are stored separately, once
  const details = { key: vKey(doc.id, at), designId: doc.id, at, label, name: doc.name, pages: doc.pages.length, width: doc.width, height: doc.height, assetIds: Object.keys(assets || {}) };
  // Which images are already stored is checked in the same transaction that
  // writes the version, so another tab's clean-up can't remove one in between.
  const db = await open();
  const [alo, ahi] = range(`${doc.id}|a|`);
  if (!db) {
    for (const [id, a] of Object.entries(assets || {})) if (!memory.versions.has(aKey(doc.id, id))) memory.versions.set(aKey(doc.id, id), a);
    memory.versions.set(dKey(doc.id, at), rest);
    memory.versions.set(vKey(doc.id, at), details);
  } else {
    await new Promise((resolve, reject) => {
      const t = db.transaction('versions', 'readwrite');
      const s = t.objectStore('versions');
      const have = s.getAllKeys(IDBKeyRange.bound(alo, ahi));
      have.onsuccess = () => {
        const stored = new Set(have.result);
        for (const [id, a] of Object.entries(assets || {})) if (!stored.has(aKey(doc.id, id))) s.put(a, aKey(doc.id, id));
        s.put(rest, dKey(doc.id, at));
        s.put(details, vKey(doc.id, at));
      };
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('Storage is full'));
    });
  }
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
  const db = await open();
  if (!db) {
    const m = memory.versions;
    for (const k of drop) {
      m.delete(k);
      m.delete(k.replace('|v|', '|d|'));
    }
    const used = new Set([...m.entries()].filter(([k]) => k >= vlo && k <= vhi).flatMap(([, v]) => v.assetIds || []));
    for (const k of [...m.keys()]) if (k >= alo && k <= ahi && !used.has(k.slice(alo.length))) m.delete(k);
    return;
  }
  await new Promise((resolve, reject) => {
    const t = db.transaction('versions', 'readwrite');
    const s = t.objectStore('versions');
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
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Storage is full'));
  });
}

/** Whether a design has any versions yet (reads keys only). */
export async function hasVersions(designId) {
  return (await keysIn(`${designId}|v|`)).length > 0;
}

/** A design's saved versions (just their details), newest first. */
export async function listVersions(designId) {
  return (await valuesIn(`${designId}|v|`)).sort((a, b) => b.at - a.at);
}

/** A version as a whole design again, images included. */
export async function versionDoc(version) {
  const doc = await get('versions', dKey(version.designId, version.at));
  if (!doc) throw new Error('This version is missing');
  const assets = {};
  const found = await Promise.all((version.assetIds || []).map((id) => get('versions', aKey(version.designId, id))));
  (version.assetIds || []).forEach((id, i) => {
    if (found[i]) assets[id] = found[i];
  });
  return { ...doc, assets };
}

async function deleteVersions(designId) {
  await batch('versions', (await keysIn(`${designId}|`)).map((k) => [k, undefined]));
}

// ---------- uploads (reusable across designs) ----------

export async function saveUpload(upload) {
  await put('uploads', upload.id, upload);
}

export async function listUploads() {
  return (await all('uploads')).sort((a, b) => b.addedAt - a.addedAt);
}

export async function getUpload(id) {
  return get('uploads', id);
}

export async function deleteUpload(id) {
  await del('uploads', id);
}

// ---------- settings ----------

export async function getSetting(key, fallback = null) {
  const v = await get('settings', key);
  return v === undefined ? fallback : v;
}

export async function setSetting(key, value) {
  await put('settings', key, value);
}
