// Undo and redo by snapshot. Images live in doc.assets and are only ever
// added during a session, so snapshots leave them out and stay small.

function snapshot(doc) {
  const { assets, ...rest } = doc;
  return JSON.stringify(rest);
}

function restore(snap, assets) {
  const doc = JSON.parse(snap);
  doc.assets = assets;
  return doc;
}

export class History {
  constructor(limit = 200) {
    this.limit = limit;
    this.past = [];
    this.future = [];
    this.lastKey = null;
    this.lastAt = 0;
  }

  /**
   * Call before changing the design. Changes with the same key in quick
   * succession (like nudging with arrow keys) become one undo step.
   */
  record(doc, key = null, now = Date.now()) {
    if (key && key === this.lastKey && now - this.lastAt < 800) {
      this.lastAt = now;
      return;
    }
    this.past.push(snapshot(doc));
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
    this.lastKey = key;
    this.lastAt = now;
  }

  /** Forget the last recorded step, for a change that turned out to be nothing. */
  discard() {
    this.past.pop();
    this.lastKey = null;
  }

  get canUndo() {
    return this.past.length > 0;
  }

  get canRedo() {
    return this.future.length > 0;
  }

  undo(doc) {
    if (!this.past.length) return doc;
    this.future.push(snapshot(doc));
    this.lastKey = null;
    return restore(this.past.pop(), doc.assets);
  }

  redo(doc) {
    if (!this.future.length) return doc;
    this.past.push(snapshot(doc));
    this.lastKey = null;
    return restore(this.future.pop(), doc.assets);
  }

  clear() {
    this.past = [];
    this.future = [];
    this.lastKey = null;
  }
}
