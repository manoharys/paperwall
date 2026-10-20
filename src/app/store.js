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
    req.onsuccess = () => {
      const db = req.result;
      // Let a newer version of Paperwall in another tab upgrade the database.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onblocked = () => {
      // An older tab still has the database open; it upgrades once that tab closes.
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
// Keys: "<designId>|v|<time>" for a version (the design without its images)
// and "<designId>|a|<assetId>" for each image, stored once and shared by
// every version that uses it.

export const MAX_VERSIONS = 30;
const vKey = (designId, at) => `${designId}|v|${String(at).padStart(15, '0')}`;
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

/** Keep a copy of the design as it is now. The oldest beyond MAX_VERSIONS are dropped. */
export async function saveVersion(doc, { label = '' } = {}) {
  const at = Date.now();
  const key = vKey(doc.id, at);
  const { assets, ...rest } = JSON.parse(JSON.stringify(doc));
  const have = new Set(await keysIn(`${doc.id}|a|`));
  for (const [id, a] of Object.entries(assets || {})) {
    if (!have.has(aKey(doc.id, id))) await put('versions', aKey(doc.id, id), a);
  }
  await put('versions', key, { key, designId: doc.id, at, label, name: doc.name, pages: doc.pages.length, width: doc.width, height: doc.height, assetIds: Object.keys(assets || {}), doc: rest });
  const keys = await keysIn(`${doc.id}|v|`);
  for (const old of keys.slice(0, Math.max(0, keys.length - MAX_VERSIONS))) await del('versions', old);
  return key;
}

/** A design's saved versions (without their images), newest first. */
export async function listVersions(designId) {
  return (await valuesIn(`${designId}|v|`)).sort((a, b) => b.at - a.at);
}

/** A version as a whole design again, images included. */
export async function versionDoc(version) {
  const assets = {};
  for (const id of version.assetIds || []) {
    const a = await get('versions', aKey(version.designId, id));
    if (a) assets[id] = a;
  }
  return { ...version.doc, assets };
}

async function deleteVersions(designId) {
  for (const k of await keysIn(`${designId}|`)) await del('versions', k);
}

// ---------- uploads (reusable across designs) ----------

export async function saveUpload(upload) {
  await put('uploads', upload.id, upload);
}

export async function listUploads() {
  return (await all('uploads')).sort((a, b) => b.addedAt - a.addedAt);
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
