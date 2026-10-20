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
    req.onsuccess = () => resolve(req.result);
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
  for (const v of await listVersions(id)) await del('versions', v.key);
}

// ---------- version history (per design, on this device) ----------

export const MAX_VERSIONS = 30;
const versionKey = (designId, at) => `${designId}|${String(at).padStart(15, '0')}`;

/** Keep a copy of the design as it is now. The oldest copies beyond MAX_VERSIONS are dropped. */
export async function saveVersion(doc, { label = '' } = {}) {
  const at = Date.now();
  const key = versionKey(doc.id, at);
  await put('versions', key, { key, designId: doc.id, at, label, name: doc.name, pages: doc.pages.length, width: doc.width, height: doc.height, doc: JSON.parse(JSON.stringify(doc)) });
  const list = await listVersions(doc.id);
  for (const old of list.slice(MAX_VERSIONS)) await del('versions', old.key);
  return key;
}

/** A design's saved versions, newest first. */
export async function listVersions(designId) {
  const db = await open();
  const lo = `${designId}|`;
  const hi = `${designId}|\uffff`;
  let rows;
  if (!db) rows = [...memory.versions.values()].filter((v) => v.key >= lo && v.key <= hi);
  else rows = await tx(db, 'versions', 'readonly', (s) => s.getAll(IDBKeyRange.bound(lo, hi)));
  return rows.sort((a, b) => b.at - a.at);
}

export async function loadVersion(key) {
  return get('versions', key);
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
