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
      this.pending = false; // part of an earlier step: there's nothing new to discard
      return;
    }
    this.past.push(snapshot(doc));
    // The oldest step is set aside, not lost, in case this one is discarded.
    this.shifted = this.past.length > this.limit ? this.past.shift() : null;
    this.discardedFuture = this.future; // brought back if this step is discarded
    this.pending = true; // the newest step is this one, until undo or redo
    this.future = [];
    this.lastKey = key;
    this.lastAt = now;
  }

  /** Forget the last recorded step, for a change that turned out to be nothing. */
  discard() {
    // Only if the newest step is still the one just recorded (an undo in
    // between already used it).
    if (!this.pending) return;
    this.pending = false;
    this.past.pop();
    if (this.shifted) this.past.unshift(this.shifted);
    this.shifted = null;
    if (this.discardedFuture) this.future = this.discardedFuture;
    this.discardedFuture = null;
    this.lastKey = null;
  }

  /**
   * Put the design back as the step just recorded had it, and forget the
   * step: for a change that was called off halfway. Null if there's no such step.
   */
  revert(doc) {
    if (!this.pending) return null;
    const snap = this.past[this.past.length - 1];
    this.discard();
    return restore(snap, doc.assets);
  }

  /**
   * Go back to the newest step and drop it, without keeping a redo: for a
   * change merged into that step that failed halfway. The step's whole run
   * goes with it (its earlier edits too), since there's no finer point to go back to.
   */
  rewind(doc) {
    if (!this.past.length) return null;
    const snap = this.past.pop();
    this.settle();
    this.lastKey = null;
    return restore(snap, doc.assets);
  }

  /** The newest step stays: let go of what was kept in case it was discarded. */
  settle() {
    this.pending = false;
    this.shifted = null;
    this.discardedFuture = null;
  }

  get canUndo() {
    return this.past.length > 0;
  }

  get canRedo() {
    return this.future.length > 0;
  }

  undo(doc) {
    if (!this.past.length) return doc;
    this.settle();
    this.future.push(snapshot(doc));
    this.lastKey = null;
    return restore(this.past.pop(), doc.assets);
  }

  redo(doc) {
    this.settle();
    if (!this.future.length) return doc;
    this.past.push(snapshot(doc));
    this.lastKey = null;
    return restore(this.future.pop(), doc.assets);
  }

  clear() {
    this.past = [];
    this.future = [];
    this.lastKey = null;
    this.pending = false;
    this.shifted = null;
    this.discardedFuture = null;
  }
}
