// A backup: every design on this device in one file, and back again.
// Designs live in the browser's storage, which clearing site data wipes;
// a backup file is the copy that survives that, or moves to another computer.

import { keptAssets, validateDesign } from './doc.js';

export const BACKUP_KIND = 'paperwall-backup';
export const BACKUP_VERSION = 1;

/** The backup of these designs (whole, with their files), as an object to save as JSON. */
export function makeBackup(designs, savedAt = Date.now()) {
  return { kind: BACKUP_KIND, version: BACKUP_VERSION, savedAt, designs: designs.map((d) => keptAssets(d)) };
}

/** Whether parsed JSON is a backup (rather than a single design). */
export function isBackup(data) {
  return !!data && typeof data === 'object' && data.kind === BACKUP_KIND;
}

/**
 * The designs in a backup, each checked like any file from anyone: the ones
 * that pass, and how many didn't. Throws for a backup this version can't read.
 */
export function backupDesigns(data) {
  if (data.version !== BACKUP_VERSION) throw new Error(`Unsupported backup version: ${data.version}`);
  const designs = [];
  let unreadable = 0;
  // (Checked in place: freshly parsed, nothing in it is shared.)
  for (const doc of Array.isArray(data.designs) ? data.designs : []) {
    try {
      validateDesign(doc);
      designs.push(doc);
    } catch {
      unreadable++;
    }
  }
  return { designs, unreadable };
}

/** A usable design id: a word, never one with the | that storage keys are built with. */
const usableId = (id) => typeof id === 'string' && /^[\w-]{1,100}$/.test(id);

/**
 * What restoring a backup does with each design, decided before anything is
 * stored. `here` maps the ids of designs on this device to when they were
 * last changed; `withHistory` holds ids that still have version history.
 * The very same design (same id, same last change, here or earlier in the
 * backup) is left alone. Any other clash (here in another version, history
 * under that id, or the same id twice in one backup) keeps the backup's design beside it, under a new id and
 * `copyName`. A design with an unusable id gets a new one.
 * Returns { save: [designs to store], same }.
 */
export function planRestore(designs, { here, withHistory, newId, copyName }) {
  const save = [];
  const taken = new Map(); // id → last change, of the designs this restore keeps
  let same = 0;
  for (const doc of designs) {
    if (!usableId(doc.id)) doc.id = newId();
    else if (here.get(doc.id) === doc.updatedAt || taken.get(doc.id) === doc.updatedAt) {
      same++;
      continue;
    } else if (here.has(doc.id) || taken.has(doc.id) || withHistory.has(doc.id)) {
      doc.id = newId();
      doc.name = copyName(doc.name);
    }
    taken.set(doc.id, doc.updatedAt);
    save.push(doc);
  }
  return { save, same };
}

/** The backup file's name, with the day it was made. */
export function backupFileName(savedAt = Date.now()) {
  const day = new Date(savedAt);
  const pad = (n) => String(n).padStart(2, '0');
  return `paperwall-backup-${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}.json`;
}
