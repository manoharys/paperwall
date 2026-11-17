import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBackup, isBackup, backupDesigns, backupFileName, planRestore, BACKUP_KIND } from '../../src/model/backup.js';
import { TEMPLATES, templateDoc } from '../../src/templates/index.js';

test('[DOC-14] every design goes into one backup and comes back out, checked', () => {
  const docs = TEMPLATES.slice(0, 3).map((t) => templateDoc(t));
  const backup = JSON.parse(JSON.stringify(makeBackup(docs, 1700000000000)));
  assert.equal(backup.kind, BACKUP_KIND);
  assert.equal(backup.savedAt, 1700000000000);
  assert.ok(isBackup(backup));
  const { designs, unreadable } = backupDesigns(backup);
  assert.equal(unreadable, 0);
  assert.deepEqual(designs.map((d) => d.id), docs.map((d) => d.id));
  assert.deepEqual(designs.map((d) => d.name), docs.map((d) => d.name));
});

test('[DOC-14] a backup keeps only the files its designs use', () => {
  const doc = templateDoc(TEMPLATES[0]);
  doc.assets = { gone: { type: 'image', dataUrl: 'data:image/png;base64,AAAA' } };
  assert.deepEqual(makeBackup([doc]).designs[0].assets, {});
});

test('[DOC-14] a damaged design in a backup is counted, not fatal; an unknown version is refused', () => {
  const good = templateDoc(TEMPLATES[0]);
  const { designs, unreadable } = backupDesigns({ kind: BACKUP_KIND, version: 1, designs: [good, { nonsense: true }, null] });
  assert.equal(designs.length, 1);
  assert.equal(unreadable, 2);
  assert.throws(() => backupDesigns({ kind: BACKUP_KIND, version: 99, designs: [] }), /Unsupported backup version/);
  assert.deepEqual(backupDesigns({ kind: BACKUP_KIND, version: 1 }), { designs: [], unreadable: 0 });
});

test('[DOC-14] a single design file is not mistaken for a backup', () => {
  assert.equal(isBackup(templateDoc(TEMPLATES[0])), false);
  assert.equal(isBackup(null), false);
  assert.equal(isBackup([]), false);
});

test('[DOC-14] the backup file is named for the day it was made', () => {
  assert.match(backupFileName(new Date(2026, 10, 3, 12).getTime()), /^paperwall-backup-2026-11-03\.json$/);
});

const plan = (designs, here = new Map(), withHistory = new Set()) => {
  let n = 0;
  return planRestore(designs, { here, withHistory, newId: () => `dnew${++n}`, copyName: (name) => `${name} (copy)` });
};
const d = (id, updatedAt, name = id) => ({ id, updatedAt, name });

test('[DOC-14] restoring: new designs are kept as they are; the very same one already here is left alone', () => {
  const { save, same } = plan([d('a', 1), d('b', 2)], new Map([['b', 2]]));
  assert.deepEqual(save.map((x) => [x.id, x.name]), [['a', 'a']]);
  assert.equal(same, 1);
});

test('[DOC-14] restoring: another version of a design here, or history under its id, is kept beside it as a copy', () => {
  const { save, same } = plan([d('a', 5, 'Poster'), d('h', 1, 'Card')], new Map([['a', 9]]), new Set(['h']));
  assert.equal(same, 0);
  assert.deepEqual(save.map((x) => [x.id, x.name]), [['dnew1', 'Poster (copy)'], ['dnew2', 'Card (copy)']]);
});

test('[DOC-14] restoring: the same id twice in one backup never overwrites; a bad id gets a new one', () => {
  const { save, same } = plan([d('x', 1, 'One'), d('x', 2, 'Two'), d(undefined, 1, 'No id'), d('a|b', 1, 'Pipe'), d({}, 1, 'Object')]);
  const ids = save.map((x) => x.id);
  assert.equal(new Set(ids).size, ids.length, ids.join(' '));
  assert.equal(same, 0);
  assert.deepEqual(save.map((x) => x.name), ['One', 'Two (copy)', 'No id', 'Pipe', 'Object']);
  for (const id of ids) assert.match(id, /^[\w-]+$/);
});

test('[DOC-14] restoring: the very same design twice in one backup is kept once', () => {
  const { save, same } = plan([d('a', 3), d('a', 3)]);
  assert.deepEqual(save.map((x) => x.id), ['a']);
  assert.equal(same, 1);
  assert.equal(plan([d('a', 3), d('a', 3)], new Map([['a', 3]])).same, 2, 'and none at all when it is here already');
});
