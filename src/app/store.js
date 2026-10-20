// Everything is stored in this browser, on this device: designs, the images
// you've added, and your brand kit. Nothing is ever sent anywhere.

const DB_NAME = 'paperwall';
const DB_VERSION = 2;
const STORES = ['designs', 'uploads', 'settings', 'versions'];

let dbPromise = null;
const memory = Object.fromEntries(STORES.map((s) => [s, new Map()]));
let persistent = true;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
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
      persistent = false;
      resolve(null);
    };
  });
  return dbPromise;
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
  await tx(db, store, 'readwrite', (s) => s.put(value, key));
}

/** Several puts (value set) and deletes (value undefined) in one transaction. */
async function batch(store, ops) {
  if (!ops.length) return;
  const db = await open();
  if (!db) {
    for (const [k, v] of ops) v === undefined ? memory[store].delete(k) : memory[store].set(k, v);
    return;
  }
  await tx(db, store, 'readwrite', (s) => {
    for (const [k, v] of ops) v === undefined ? s.delete(k) : s.put(v, k);
  });
}

export async function get(store, key) {
  const db = await open();
  if (!db) return memory[store].get(key);
  return tx(db, store, 'readonly', (s) => s.get(key));
}

export async function del(store, key) {
  const db = await open();
  if (!db) return void memory[store].delete(key);
  await tx(db, store, 'readwrite', (s) => s.delete(key));
}

export async function all(store) {
  const db = await open();
  if (!db) return [...memory[store].values()];
  return tx(db, store, 'readonly', (s) => s.getAll());
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
  return tx(db, 'versions', 'readonly', (s) => s.getAllKeys(IDBKeyRange.bound(lo, hi)));
}

async function valuesIn(prefix) {
  const [lo, hi] = range(prefix);
  const db = await open();
  if (!db) return [...memory.versions.entries()].filter(([k]) => k >= lo && k <= hi).map(([, v]) => v);
  return tx(db, 'versions', 'readonly', (s) => s.getAll(IDBKeyRange.bound(lo, hi)));
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
  const have = new Set(await keysIn(`${doc.id}|a|`));
  const meta2 = { key: vKey(doc.id, at), designId: doc.id, at, label, name: doc.name, pages: doc.pages.length, width: doc.width, height: doc.height, assetIds: Object.keys(assets || {}) };
  // New images, the design and its details, all in one transaction.
  await batch('versions', [
    ...Object.entries(assets || {}).filter(([id]) => !have.has(aKey(doc.id, id))).map(([id, a]) => [aKey(doc.id, id), a]),
    [dKey(doc.id, at), rest],
    [vKey(doc.id, at), meta2],
  ]);
  const keys = await keysIn(`${doc.id}|v|`);
  const drop = keys.slice(0, Math.max(0, keys.length - MAX_VERSIONS));
  if (drop.length) {
    // Old versions, and images no kept version uses, go in one transaction too.
    const kept = new Set(keys.slice(drop.length));
    const used = new Set((await valuesIn(`${doc.id}|v|`)).filter((v) => kept.has(v.key)).flatMap((v) => v.assetIds || []));
    const orphans = (await keysIn(`${doc.id}|a|`)).filter((k) => !used.has(k.slice(`${doc.id}|a|`.length)));
    await batch('versions', [...drop.flatMap((k) => [[k, undefined], [k.replace('|v|', '|d|'), undefined]]), ...orphans.map((k) => [k, undefined])]);
  }
  return vKey(doc.id, at);
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
  for (const id of version.assetIds || []) {
    const a = await get('versions', aKey(version.designId, id));
    if (a) assets[id] = a;
  }
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
