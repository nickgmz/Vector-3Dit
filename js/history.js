/* Vector 3Dit — snapshot-based undo/redo. */
(function () {
  'use strict';
  const V3D = globalThis.V3D;

  V3D.History = class {
    constructor(app, limit = 150) {
      this.app = app;
      this.limit = limit;
      this.stack = [];
      this.pos = -1;
    }
    snapshot() {
      const d = this.app.doc;
      return V3D.U.serialize({
        name: d.name,
        width: d.width,
        height: d.height,
        background: d.background,
        objects: d.objects,
        scene: d.scene,
      });
    }
    reset(label = 'Open') {
      this.stack = [{ state: this.snapshot(), label, sel: this.app.sel.slice() }];
      this.pos = 0;
      this.app.bus.emit('history');
    }
    /** Records the current document state if it changed. */
    commit(label = 'Edit') {
      const state = this.snapshot();
      const cur = this.stack[this.pos];
      if (cur && cur.state === state) return false;
      this.stack.length = this.pos + 1;
      this.stack.push({ state, label, sel: this.app.sel.slice() });
      if (this.stack.length > this.limit) this.stack.shift();
      this.pos = this.stack.length - 1;
      this.app.bus.emit('history');
      this.app.bus.emit('committed', label);
      return true;
    }
    get canUndo() {
      return this.pos > 0;
    }
    get canRedo() {
      return this.pos < this.stack.length - 1;
    }
    get undoLabel() {
      return this.canUndo ? this.stack[this.pos].label : '';
    }
    get redoLabel() {
      return this.canRedo ? this.stack[this.pos + 1].label : '';
    }
    undo() {
      if (!this.canUndo) return;
      const label = this.stack[this.pos].label;
      this.pos--;
      this.restore(this.stack[this.pos], this.stack[this.pos + 1].sel);
      this.app.toast(`Undid ${label.toLowerCase()}`);
    }
    redo() {
      if (!this.canRedo) return;
      this.pos++;
      this.restore(this.stack[this.pos], this.stack[this.pos].sel);
      this.app.toast(`Redid ${this.stack[this.pos].label.toLowerCase()}`);
    }
    restore(entry, sel) {
      const data = JSON.parse(entry.state);
      Object.assign(this.app.doc, data);
      this.app.reindex();
      this.app.setSelection((sel || []).filter((id) => this.app.idx.has(id)), true);
      this.app.bus.emit('doc:replaced');
      this.app.sceneChanged();
      this.app.requestRender();
      this.app.bus.emit('history');
      this.app.autosave();
    }
  };
})();
