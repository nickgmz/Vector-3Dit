/* Vector 3Dit — application controller: state, selection, commands and rendering loop. */
(function () {
  'use strict';
  const V3D = globalThis.V3D;
  const { M2, Path, Doc, R3D, Color } = V3D;
  const U = V3D.U;

  const AUTOSAVE_KEY = 'vector3dit.autosave.v1';
  const PREFS_KEY = 'vector3dit.prefs.v1';

  class App {
    constructor() {
      this.bus = new U.Emitter();
      this.doc = Doc.create();
      this.idx = new Map();
      this.sel = [];
      this.rev = 0;
      this.sceneVersion = 1;
      this.draftIds = null;
      this.hoverId = null;
      this.clipboard = null;
      this.fxClipboard = null;
      // What turning edits inside a scene camera: 'camera' (every object on it) or 'object' (the selection alone).
      this.turnMode = 'camera';
      this.style = Doc.defaultStyle();
      this.prefs = Object.assign(
        {
          theme: 'system',
          grid: 'none',
          gridSize: 20,
          snapGrid: true,
          snapObjects: true,
          rulers: true,
          lockRatio: false,
          welcomed: false,
          // While 3D objects are edited on the 3D tab, the rest of the drawing shows faded (like the Inkscape extension's preview).
          otherObjects: true,
          otherFullColor: false,
        },
        U.storage.get(PREFS_KEY, {})
      );
      this.toolOpts = {
        rect: { r: 0 },
        star: { n: 5, ratio: 0.45, star: true, round: 0 },
        pencil: { smooth: 4 },
        text: { family: 'Archivo Black', size: 96, weight: 400, italic: false, spacing: 0, align: 'start' },
      };
      this.history = new V3D.History(this);
      this._renderQueued = false;
      this._overlayQueued = false;
      this.autosave = U.debounce(() => this.saveLocal(), 900);
      this.commitSoon = U.debounce((label) => this.commit(label), 450);
    }

    /* ---------------- boot ---------------- */
    init(root) {
      this.root = root;
      this.ui = new V3D.UI(this, root);
      this.canvas = new V3D.Canvas(this, this.ui.canvasHost);
      for (const id in V3D.Tools) if (V3D.Tools[id] && typeof V3D.Tools[id] === 'object' && V3D.Tools[id].id) V3D.Tools[id].app = this;
      this.applyTheme();
      const saved = U.storage.get(AUTOSAVE_KEY, null);
      let loaded = false;
      if (saved && saved.doc) {
        try {
          this.loadDoc(saved.doc, { silent: true });
          loaded = true;
        } catch (e) {
          console.warn('[V3D] could not restore autosave', e);
        }
      }
      if (!loaded) this.loadDoc(V3D.Presets.showcase(), { silent: true });
      this.setTool('select');
      this.ui.build();
      document.addEventListener('keydown', (e) => this.onKey(e));
      document.addEventListener('keyup', (e) => {
        if (e.code === 'Space') {
          this.canvas.spaceDown = false;
          this.canvas.stage.classList.remove('space');
        }
      });
      document.addEventListener('paste', (e) => this.onPaste(e));
      if (document.fonts && document.fonts.addEventListener)
        document.fonts.addEventListener('loadingdone', () => {
          V3D.Trace.clearTextCache();
          let any = false;
          Doc.walk(this.doc.objects, (o) => {
            if (o.type === 'text') {
              this.touch(o);
              Doc.cache.delete(o.id);
              any = true;
            }
          });
          if (any) this.requestRender();
        });
      if (!this.prefs.welcomed) setTimeout(() => this.ui.showWelcome(), 350);
      this.requestRender();
    }

    /* ---------------- document ---------------- */
    loadDoc(data, opts = {}) {
      const d = typeof data === 'string' ? JSON.parse(data) : data;
      if (!d || !Array.isArray(d.objects)) throw new Error('This file is not a Vector 3Dit drawing.');
      const doc = Object.assign(Doc.create(), d);
      doc.scene = Object.assign({ light: R3D.defaultLight(), seam: 1 }, d.scene || {});
      doc.scene.light = Object.assign(R3D.defaultLight(), doc.scene.light || {});
      doc.scene.cameras = Object.assign({}, doc.scene.cameras || {});
      Doc.walk(doc.objects, (o) => {
        if (o.fx) o.fx = R3D.normalize(o.fx);
        if (!o.transform) o.transform = M2.identity();
        if (!o.style) o.style = Doc.defaultStyle();
      });
      this.doc = doc;
      Doc.clearCache();
      this.reindex();
      this.sel = [];
      this.sceneVersion++;
      this.history.reset('Open');
      this.bus.emit('doc:replaced');
      this.bus.emit('selection');
      if (this.canvas) {
        this.canvas.renderPage();
        if (!opts.keepView) this.canvas.fitPage();
      }
      this.requestRender();
      if (!opts.silent) this.autosave();
    }
    newDoc(opts = {}) {
      this.loadDoc(Doc.create(opts));
      this.toast('New drawing');
    }
    saveLocal() {
      const ok = U.storage.set(AUTOSAVE_KEY, { at: Date.now(), doc: JSON.parse(U.serialize(this.doc)) });
      if (!ok && !this._saveWarned) {
        this._saveWarned = true;
        const storageWorks = U.storage.set('vector3dit.probe', 1);
        this.toast(
          storageWorks
            ? 'This drawing is too big for automatic browser saving — use File › Save project to keep it'
            : 'Browser storage is off here, so nothing is autosaved — use File › Save project to keep your work',
          'error'
        );
      }
      this.bus.emit('saved', ok);
    }
    savePrefs() {
      U.storage.set(PREFS_KEY, this.prefs);
    }
    setPref(k, v) {
      this.prefs[k] = v;
      this.savePrefs();
      if (k === 'otherObjects' || k === 'otherFullColor') this.canvas.applyFade();
      if (k === 'theme') this.applyTheme();
      if (k === 'grid' || k === 'gridSize') this.canvas.renderGrid();
      if (k === 'rulers') this.root.classList.toggle('no-rulers', !v);
      this.canvas.applyView();
      this.bus.emit('prefs');
    }
    applyTheme() {
      const t = this.prefs.theme;
      const el = document.documentElement;
      // A theme stamped by an embedding host counts as the "system" choice.
      if (this.hostTheme === undefined) this.hostTheme = el.getAttribute('data-theme');
      if (t === 'light' || t === 'dark') el.setAttribute('data-theme', t);
      else if (this.hostTheme) el.setAttribute('data-theme', this.hostTheme);
      else el.removeAttribute('data-theme');
      this.root && this.root.classList.toggle('no-rulers', !this.prefs.rulers);
    }

    reindex() {
      this.idx = Doc.index(this.doc);
    }
    get(id) {
      const e = this.idx.get(id);
      return e ? e.obj : null;
    }
    parentOf(id) {
      const e = this.idx.get(id);
      return e ? e.parent : null;
    }
    listOf(id) {
      const p = this.parentOf(id);
      return p ? p.children : this.doc.objects;
    }
    parentMatrix(id) {
      return Doc.parentMatrix(this.idx, id);
    }
    worldMatrix(o) {
      return M2.mul(this.parentMatrix(o.id), o.transform);
    }
    worldSubs(o) {
      return Doc.worldSubs(o, this.parentMatrix(o.id));
    }
    /** Shapes the 3D controls act on: selected shapes plus the shapes inside selected groups. */
    fxTargets(onlyWithFx) {
      const out = [];
      for (const o of this.selected())
        Doc.walk([o], (x) => {
          if (Doc.can3D(x) && (!onlyWithFx || x.fx) && x.visible !== false) out.push(x);
        });
      return out;
    }
    all3DIds() {
      const ids = [];
      Doc.walk(this.doc.objects, (o) => {
        if (o.fx) ids.push(o.id);
      });
      return ids;
    }

    /* ---------------- change tracking & rendering ---------------- */
    touch(o) {
      o._rev = ++this.rev;
      let p = this.parentOf(o.id);
      while (p) {
        p._rev = ++this.rev;
        p = this.parentOf(p.id);
      }
      this.changed();
    }
    changed() {
      if (this._changeQueued) return;
      this._changeQueued = true;
      requestAnimationFrame(() => {
        this._changeQueued = false;
        this.bus.emit('change');
      });
    }
    sceneChanged() {
      this.sceneVersion++;
      this.changed();
    }
    renderCtx(extra) {
      return Object.assign(
        {
          scene: this.doc.scene,
          quality: this.draftIds ? 'draft' : 'full',
          draftIds: this.draftIds,
          editor: true,
          sceneVersion: this.sceneVersion,
        },
        extra || {}
      );
    }
    requestRender() {
      if (this._renderQueued) return;
      this._renderQueued = true;
      requestAnimationFrame(() => {
        this._renderQueued = false;
        this.renderNow();
      });
    }
    renderNow() {
      if (!this.canvas) return;
      this.canvas.renderPage();
      const stats = this.canvas.renderDoc(this.renderCtx());
      this.lastStats = stats;
      this.renderOverlay();
      this.canvas.renderRulers();
      this.bus.emit('rendered', stats);
    }
    requestOverlay() {
      if (this._overlayQueued) return;
      this._overlayQueued = true;
      requestAnimationFrame(() => {
        this._overlayQueued = false;
        this.renderOverlay();
      });
    }
    renderOverlay() {
      if (!this.canvas) return;
      let out = '';
      if (this.hoverId && !this.sel.includes(this.hoverId)) {
        const o = this.get(this.hoverId);
        const b = o && this.bboxOf(o);
        if (b) {
          const [x1, y1] = this.canvas.toScreen(b.x, b.y);
          const [x2, y2] = this.canvas.toScreen(b.x2, b.y2);
          out += `<rect x="${U.fmt(x1, 1)}" y="${U.fmt(y1, 1)}" width="${U.fmt(x2 - x1, 1)}" height="${U.fmt(y2 - y1, 1)}" class="ov-hover"/>`;
        }
      }
      const t = this.tool;
      if (t && t.id !== 'select' && t.id !== 'node' && this.sel.length) {
        const b = this.selectionBBox();
        if (b) {
          const [x1, y1] = this.canvas.toScreen(b.x, b.y);
          const [x2, y2] = this.canvas.toScreen(b.x2, b.y2);
          out += `<rect x="${U.fmt(x1, 1)}" y="${U.fmt(y1, 1)}" width="${U.fmt(x2 - x1, 1)}" height="${U.fmt(y2 - y1, 1)}" class="ov-selbox faint"/>`;
        }
      }
      if (t && t.overlay) {
        try {
          out += t.overlay();
        } catch (e) {
          console.error(e);
        }
      }
      this.canvas.setOverlay(out);
    }
    hover(id) {
      if (id === this.hoverId) return;
      this.hoverId = id;
      this.requestOverlay();
    }
    /** Marks objects for fast preview quality while dragging; null returns to full quality. */
    setDraft(ids) {
      if (!ids) {
        if (this.draftIds) {
          this.draftIds = null;
          this.requestRender();
        }
        return;
      }
      // Only heavy 3D objects switch to draft; light ones stay crisp.
      const heavy = ids.filter((id) => {
        const c = Doc.cache.get(id);
        return !c || c.ms == null || c.ms > 18;
      });
      this.draftIds = heavy.length ? new Set(heavy) : null;
    }
    bboxOf(o) {
      try {
        return Doc.renderObject(o, this.renderCtx({ parentM: this.parentMatrix(o.id) })).bbox;
      } catch (e) {
        return null;
      }
    }
    selectionBBox() {
      let b = null;
      for (const o of this.selected()) b = V3D.Rect.union(b, this.bboxOf(o));
      return V3D.Rect.valid(b) ? b : null;
    }
    commit(label = 'Edit') {
      if (this.history.commit(label)) {
        this.autosave();
        this.bus.emit('doc');
      }
    }
    status(text, transient) {
      this.bus.emit('status', text, transient);
    }
    toast(msg, kind) {
      this.ui && this.ui.toast(msg, kind);
    }

    /* ---------------- tools ---------------- */
    setTool(id) {
      const t = V3D.Tools[id];
      if (!t) return;
      if (this.tool && this.tool !== t && this.tool.deactivate) this.tool.deactivate();
      if (this.tool && this.tool.cancel && this.tool.s) this.tool.cancel();
      this.tool = t;
      this.toolId = id;
      t.app = this;
      if (t.activate) t.activate();
      if (this.canvas) {
        this.canvas.stage.dataset.tool = id;
        this.canvas.stage.style.cursor = '';
      }
      this.hover(null);
      this.bus.emit('tool', id);
      this.requestOverlay();
    }

    /* ---------------- selection ---------------- */
    selected() {
      return this.sel.map((id) => this.get(id)).filter(Boolean);
    }
    primary() {
      return this.get(this.sel[this.sel.length - 1]) || null;
    }
    setSelection(ids, silent) {
      const next = ids.filter((id) => this.idx.has(id));
      const same = next.length === this.sel.length && next.every((id, i) => id === this.sel[i]);
      this.sel = next;
      if (!same || silent) {
        this.bus.emit('selection');
        this.requestOverlay();
        if (this.canvas) this.canvas.renderRulers();
      }
    }
    toggleSelect(id) {
      if (this.sel.includes(id)) this.setSelection(this.sel.filter((x) => x !== id));
      else this.setSelection(this.sel.concat([id]));
    }
    selectAll() {
      this.setSelection(this.doc.objects.filter((o) => o.visible !== false && !o.locked).map((o) => o.id));
    }

    /* ---------------- object management ---------------- */
    addObject(o, opts = {}) {
      const list = opts.parent ? opts.parent.children : this.doc.objects;
      if (opts.index == null) list.push(o);
      else list.splice(opts.index, 0, o);
      this.reindex();
      this.touch(o);
      if (opts.select !== false) this.setSelection([o.id]);
      this.requestRender();
      if (opts.commit !== false) this.commit(opts.label || 'Add ' + Doc.typeName(o).toLowerCase());
      return o;
    }
    removeObjects(ids, opts = {}) {
      const set = new Set(ids);
      const strip = (list) => list.filter((o) => !set.has(o.id)).map((o) => (o.type === 'group' ? Object.assign(o, { children: strip(o.children) }) : o));
      this.doc.objects = strip(this.doc.objects);
      for (const id of ids) Doc.cache.delete(id);
      this.reindex();
      this.setSelection(this.sel.filter((id) => !set.has(id)));
      this.requestRender();
      if (opts.commit !== false) this.commit(opts.label || 'Delete');
    }
    deleteSelection() {
      if (!this.sel.length) return;
      const n = this.sel.length;
      this.removeObjects(this.sel.slice(), { label: 'Delete' });
      this.toast(n === 1 ? 'Deleted 1 object' : `Deleted ${n} objects`);
    }
    /** Replaces an object in place (same list position). */
    replaceObject(old, neo) {
      const list = this.listOf(old.id);
      const i = list.indexOf(old);
      if (i < 0) return;
      list[i] = neo;
      Doc.cache.delete(old.id);
      this.reindex();
      this.touch(neo);
    }
    /** Serializes objects with parent transforms baked in (for clipboard / moving across groups). */
    detach(objs) {
      return objs.map((o) => {
        const c = U.clone(JSON.parse(U.serialize(o)));
        const P = this.parentMatrix(o.id);
        c.transform = M2.mul(P, o.transform);
        return c;
      });
    }
    duplicateSelection(opts = {}) {
      const objs = this.selected();
      if (!objs.length) return;
      const off = opts.offset == null ? 12 : opts.offset;
      const ids = [];
      for (const o of objs) {
        const c = Doc.cloneObject(o);
        if (off) c.transform = M2.mul(M2.translate(off, off), c.transform);
        const list = this.listOf(o.id);
        list.splice(list.indexOf(o) + 1, 0, c);
        ids.push(c.id);
      }
      this.reindex();
      ids.forEach((id) => this.touch(this.get(id)));
      this.setSelection(ids);
      this.requestRender();
      if (!opts.silent) this.commit('Duplicate');
    }
    copy() {
      const objs = this.selected();
      if (!objs.length) return false;
      this.clipboard = this.detach(objs);
      this.pasteCount = 0;
      const svg = Doc.toSVG(this.doc, { objects: this.clipboard, area: this.selectionBBox() || undefined, background: null });
      this.lastCopiedSVG = svg;
      U.copyText(svg);
      this.toast(objs.length === 1 ? 'Copied' : `Copied ${objs.length} objects`);
      return true;
    }
    cut() {
      if (this.copy()) this.removeObjects(this.sel.slice(), { label: 'Cut' });
    }
    paste(inPlace) {
      if (!this.clipboard || !this.clipboard.length) {
        this.toast('Nothing to paste yet — copy something first');
        return;
      }
      this.pasteCount = (this.pasteCount || 0) + 1;
      const off = inPlace ? 0 : 14 * this.pasteCount;
      const ids = [];
      for (const src of this.clipboard) {
        const c = Doc.cloneObject(src);
        if (off) c.transform = M2.mul(M2.translate(off, off), c.transform);
        this.doc.objects.push(c);
        ids.push(c.id);
      }
      this.reindex();
      ids.forEach((id) => this.touch(this.get(id)));
      this.setSelection(ids);
      this.requestRender();
      this.commit('Paste');
    }
    onPaste(e) {
      const tgt = e.target;
      if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable)) return;
      const dt = e.clipboardData;
      if (!dt) return;
      const files = Array.from(dt.files || []);
      if (files.length) {
        e.preventDefault();
        V3D.IO.importFiles(this, files);
        return;
      }
      const text = dt.getData('text/plain') || '';
      e.preventDefault();
      if (text && text === this.lastCopiedSVG && this.clipboard) this.paste(false);
      else if (/<svg[\s>]/i.test(text)) V3D.IO.importSVGText(this, text, 'Pasted SVG');
      else if (/^\s*M[\s\d.,-]/i.test(text) && text.length < 200000) {
        const subs = Path.parse(text);
        if (subs.length) this.addObject(Doc.make('path', { subs }, this.newStyle()), { label: 'Paste path' });
      } else this.paste(false);
    }

    newStyle() {
      return U.clone(this.style);
    }
    applyColor(color, which = 'fill') {
      const objs = this.selected();
      if (!objs.length) {
        this.style[which] = color;
        if (which === 'stroke' && !this.style.strokeWidth) this.style.strokeWidth = 2;
        this.bus.emit('style');
        return;
      }
      for (const o of objs)
        Doc.walk([o], (x) => {
          if (x.type === 'group' || x.type === 'image') return;
          x.style[which] = color;
          if (which === 'stroke' && !x.style.strokeWidth) x.style.strokeWidth = 2;
          this.touch(x);
        });
      this.style[which] = color;
      this.requestRender();
      this.commit(which === 'fill' ? 'Fill color' : 'Outline color');
      this.bus.emit('style');
    }
    /** Updates style props on the selection (or the default style). */
    setStyle(props, final = true, label = 'Style') {
      const objs = this.selected();
      if (!objs.length) {
        Object.assign(this.style, props);
        this.bus.emit('style');
        return;
      }
      for (const o of objs)
        Doc.walk([o], (x) => {
          if (x.type === 'group') {
            if ('opacity' in props && x === o) {
              x.style.opacity = props.opacity;
              this.touch(x);
            }
            return;
          }
          const p = Object.assign({}, props);
          if (x !== o) delete p.opacity;
          Object.assign(x.style, p);
          // A 3D object's stroke is its edge lines (and the shape keeps it after Remove 3D).
          if (x.fx && 'stroke' in p) {
            const c = typeof p.stroke === 'string' ? p.stroke : p.stroke ? R3D.solidOf(p.stroke) : null;
            if (c && c !== 'none') {
              x.fx.edgeColor = Color.normalize(c);
              if (!x.fx.edges || x.fx.edges === 'none') x.fx.edges = 'outline';
            } else x.fx.edges = 'none';
          }
          if (x.fx && p.strokeWidth > 0) x.fx.edgeWidth = p.strokeWidth;
          this.touch(x);
        });
      Object.assign(this.style, props);
      delete this.style.opacity;
      this.style.opacity = 1;
      this.requestRender();
      if (final) this.commit(label);
      if (objs.some((o) => o.fx || o.type === 'group')) this.bus.emit('fx');
    }
    setProps(objs, props, final = true, label = 'Edit') {
      for (const o of objs) {
        Object.assign(o, props);
        this.touch(o);
      }
      this.requestRender();
      if (final) this.commit(label);
    }

    /* ---------------- arrange ---------------- */
    arrange(how) {
      const objs = this.selected();
      if (!objs.length) return;
      const byList = new Map();
      for (const o of objs) {
        const l = this.listOf(o.id);
        (byList.get(l) || byList.set(l, []).get(l)).push(o);
      }
      for (const [list, items] of byList) {
        const set = new Set(items);
        if (how === 'top') {
          const rest = list.filter((o) => !set.has(o));
          list.splice(0, list.length, ...rest, ...items.sort((a, b) => list.indexOf(a) - list.indexOf(b)));
        } else if (how === 'bottom') {
          const rest = list.filter((o) => !set.has(o));
          list.splice(0, list.length, ...items.sort((a, b) => list.indexOf(a) - list.indexOf(b)), ...rest);
        } else if (how === 'up') {
          for (let i = list.length - 2; i >= 0; i--) if (set.has(list[i]) && !set.has(list[i + 1])) [list[i], list[i + 1]] = [list[i + 1], list[i]];
        } else if (how === 'down') {
          for (let i = 1; i < list.length; i++) if (set.has(list[i]) && !set.has(list[i - 1])) [list[i], list[i - 1]] = [list[i - 1], list[i]];
        }
      }
      this.reindex();
      this.requestRender();
      this.commit({ top: 'Bring to front', bottom: 'Send to back', up: 'Bring forward', down: 'Send backward' }[how]);
      this.bus.emit('structure');
    }
    group() {
      const objs = this.selected();
      if (objs.length < 1) return;
      const top = objs[objs.length - 1];
      const list = this.listOf(top.id);
      const sameParent = objs.every((o) => this.listOf(o.id) === list);
      const children = sameParent ? objs.sort((a, b) => list.indexOf(a) - list.indexOf(b)) : this.detach(objs);
      const g = Doc.make('group', { children: sameParent ? children : children });
      const insertAt = sameParent ? list.indexOf(children[children.length - 1]) : this.doc.objects.length;
      const ids = new Set(objs.map((o) => o.id));
      if (sameParent) {
        const rest = list.filter((o) => !ids.has(o.id));
        const at = rest.length ? Math.min(rest.length, insertAt - (children.length - 1)) : 0;
        list.splice(0, list.length, ...rest);
        list.splice(Math.max(0, at), 0, g);
      } else {
        this.removeObjects(Array.from(ids), { commit: false });
        this.doc.objects.push(g);
      }
      this.reindex();
      this.touch(g);
      this.setSelection([g.id]);
      this.requestRender();
      this.commit('Group');
      this.bus.emit('structure');
    }
    ungroup() {
      const groups = this.selected().filter((o) => o.type === 'group');
      if (!groups.length) return;
      const ids = [];
      for (const g of groups) {
        const list = this.listOf(g.id);
        const i = list.indexOf(g);
        const kids = g.children.map((c) => {
          c.transform = M2.mul(g.transform, c.transform);
          if (g.style && g.style.opacity < 1) c.style.opacity = (c.style.opacity == null ? 1 : c.style.opacity) * g.style.opacity;
          ids.push(c.id);
          return c;
        });
        list.splice(i, 1, ...kids);
        Doc.cache.delete(g.id);
      }
      this.reindex();
      ids.forEach((id) => this.touch(this.get(id)));
      this.setSelection(ids);
      this.requestRender();
      this.commit('Ungroup');
      this.bus.emit('structure');
    }
    transformSelection(M, label) {
      const objs = this.selected();
      if (!objs.length) return;
      for (const o of objs) V3D.Tools.applyWorld(this, o, M, o.transform.slice());
      this.requestRender();
      this.commit(label);
    }
    flip(axis) {
      const b = this.selectionBBox();
      if (!b) return;
      const cx = V3D.Rect.cx(b);
      const cy = V3D.Rect.cy(b);
      this.transformSelection(axis === 'h' ? M2.scale(-1, 1, cx, cy) : M2.scale(1, -1, cx, cy), axis === 'h' ? 'Flip horizontal' : 'Flip vertical');
    }
    rotateSelection(deg) {
      const b = this.selectionBBox();
      if (!b) return;
      this.transformSelection(M2.rotate(deg, V3D.Rect.cx(b), V3D.Rect.cy(b)), 'Rotate');
    }
    nudge(dx, dy) {
      const objs = this.selected();
      if (!objs.length) return;
      for (const o of objs) V3D.Tools.applyWorld(this, o, M2.translate(dx, dy), o.transform.slice());
      this.requestRender();
      this.commitSoon('Nudge');
    }
    /** Moves/resizes the selection box to the given doc rect (any field may be omitted). */
    setSelectionBox(r) {
      const b = this.selectionBBox();
      if (!b) return;
      const w = b.x2 - b.x;
      const h = b.y2 - b.y;
      const nx = r.x == null ? b.x : r.x;
      const ny = r.y == null ? b.y : r.y;
      const nw = r.w == null ? w : Math.max(0.01, r.w);
      const nh = r.h == null ? h : Math.max(0.01, r.h);
      const M = M2.mul(M2.translate(nx, ny), M2.mul(M2.scale(w ? nw / w : 1, h ? nh / h : 1), M2.translate(-b.x, -b.y)));
      this.transformSelection(M, 'Transform');
    }
    align(how, toPage) {
      const objs = this.selected();
      if (!objs.length) return;
      const ref = toPage || objs.length === 1 ? { x: 0, y: 0, x2: this.doc.width, y2: this.doc.height } : this.selectionBBox();
      for (const o of objs) {
        const b = this.bboxOf(o);
        if (!b) continue;
        let dx = 0;
        let dy = 0;
        if (how === 'left') dx = ref.x - b.x;
        if (how === 'hcenter') dx = V3D.Rect.cx(ref) - V3D.Rect.cx(b);
        if (how === 'right') dx = ref.x2 - b.x2;
        if (how === 'top') dy = ref.y - b.y;
        if (how === 'vcenter') dy = V3D.Rect.cy(ref) - V3D.Rect.cy(b);
        if (how === 'bottom') dy = ref.y2 - b.y2;
        V3D.Tools.applyWorld(this, o, M2.translate(dx, dy), o.transform.slice());
      }
      this.requestRender();
      this.commit('Align');
    }
    distribute(axis) {
      const objs = this.selected();
      if (objs.length < 3) {
        this.toast('Select three or more objects to distribute');
        return;
      }
      const items = objs.map((o) => ({ o, b: this.bboxOf(o) })).filter((i) => i.b);
      const k = axis === 'h' ? ['x', 'x2'] : ['y', 'y2'];
      items.sort((a, b) => a.b[k[0]] - b.b[k[0]]);
      const total = items[items.length - 1].b[k[1]] - items[0].b[k[0]];
      const sizes = items.reduce((s, i) => s + (i.b[k[1]] - i.b[k[0]]), 0);
      const gap = (total - sizes) / (items.length - 1);
      let at = items[0].b[k[0]];
      for (const i of items) {
        const d = at - i.b[k[0]];
        V3D.Tools.applyWorld(this, i.o, axis === 'h' ? M2.translate(d, 0) : M2.translate(0, d), i.o.transform.slice());
        at += i.b[k[1]] - i.b[k[0]] + gap;
      }
      this.requestRender();
      this.commit('Distribute');
    }
    toggleLock(objs = this.selected()) {
      if (!objs.length) return;
      const v = !objs.every((o) => o.locked);
      objs.forEach((o) => {
        o.locked = v;
        this.touch(o);
      });
      if (v) this.setSelection(this.sel.filter((id) => !objs.some((o) => o.id === id)));
      this.requestRender();
      this.commit(v ? 'Lock' : 'Unlock');
    }
    toggleVisible(objs = this.selected()) {
      if (!objs.length) return;
      const v = !objs.every((o) => o.visible !== false);
      objs.forEach((o) => {
        o.visible = v;
        this.touch(o);
      });
      this.requestRender();
      this.commit(v ? 'Show' : 'Hide');
    }

    /* ---------------- path operations ---------------- */
    shapesSelected(min = 1, msg) {
      const objs = this.selected().filter((o) => Doc.isShape(o));
      if (objs.length < min) {
        this.toast(msg || (min > 1 ? `Select at least ${min} shapes` : 'Select a shape first'));
        return null;
      }
      return objs;
    }
    convertToPath(objs = this.selected()) {
      let n = 0;
      for (const o of objs) {
        if (!Doc.isShape(o) || o.type === 'path') continue;
        this.replaceObject(o, Doc.toPath(o));
        n++;
      }
      if (!n) return;
      this.setSelection(this.sel.slice(), true);
      this.requestRender();
      this.commit('Object to path');
      this.toast(n === 1 ? 'Converted to an editable path' : `Converted ${n} shapes to paths`);
    }
    /** Creates a path object from world-space subpaths, replacing `base` in z-order. */
    pathFromWorld(subs, base, extra = {}) {
      const p = Doc.make('path', { subs, name: base.name }, U.clone(base.style));
      if (base.fx) p.fx = U.clone(base.fx);
      Object.assign(p, extra);
      // Keep the new path in the base's parent space.
      const P = this.parentMatrix(base.id);
      if (!M2.isIdentity(P)) p.subs = Path.transform(subs, M2.invert(P));
      return p;
    }
    orderedSelection(objs) {
      const order = [];
      Doc.walk(this.doc.objects, (o) => {
        order.push(o.id);
      });
      return objs.slice().sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    }
    boolean(op) {
      const min = op === 'union' ? 1 : 2;
      let objs = this.shapesSelected(min, `Select ${min === 1 ? 'shapes' : 'two or more shapes'} to combine with ${op}`);
      if (!objs) return;
      objs = this.orderedSelection(objs);
      const shapes = objs.map((o) => ({ subs: this.worldSubs(o), rule: o.style.fillRule || 'nonzero' }));
      let res;
      try {
        res = V3D.Trace.boolean(op, shapes);
      } catch (e) {
        console.error(e);
        this.toast('That operation failed on these shapes', 'error');
        return;
      }
      if (!res.length) {
        this.toast(op === 'intersection' ? 'The shapes don’t overlap — nothing left' : 'The result is empty');
        return;
      }
      const base = objs[0];
      const p = this.pathFromWorld(res, base, { name: '' });
      p.style.fillRule = 'nonzero';
      this.replaceObject(base, p);
      this.removeObjects(objs.slice(1).map((o) => o.id), { commit: false });
      this.setSelection([p.id]);
      this.requestRender();
      this.commit({ union: 'Union', difference: 'Difference', intersection: 'Intersection', exclusion: 'Exclusion' }[op]);
    }
    combine() {
      let objs = this.shapesSelected(2, 'Select two or more shapes to combine');
      if (!objs) return;
      objs = this.orderedSelection(objs);
      const base = objs[0];
      let subs = [];
      for (const o of objs) subs = subs.concat(this.worldSubs(o));
      const p = this.pathFromWorld(subs, base);
      p.style.fillRule = 'evenodd';
      this.replaceObject(base, p);
      this.removeObjects(objs.slice(1).map((o) => o.id), { commit: false });
      this.setSelection([p.id]);
      this.requestRender();
      this.commit('Combine');
    }
    breakApart() {
      const objs = this.shapesSelected(1);
      if (!objs) return;
      const ids = [];
      for (const o of objs) {
        const subs = this.worldSubs(o);
        if (subs.length < 2) {
          ids.push(o.id);
          continue;
        }
        // Each solid keeps the holes directly inside it.
        const polys = subs.map((s) => (s.closed ? Path.flatten([s], 1)[0].pts : null));
        const nest = V3D.Poly.nesting(polys);
        const parts = new Map();
        subs.forEach((s, i) => {
          if (!s.closed || nest[i].depth % 2 === 0) parts.set(i, [s]);
        });
        subs.forEach((s, i) => {
          if (!s.closed || nest[i].depth % 2 === 0) return;
          const owner = parts.get(nest[i].parent);
          if (owner) owner.push(s);
          else parts.set(i, [s]);
        });
        const list = this.listOf(o.id);
        const made = Array.from(parts.values()).map((ps) => {
          const p = this.pathFromWorld(ps, o);
          p.id = U.uid('p');
          return p;
        });
        list.splice(list.indexOf(o), 1, ...made);
        Doc.cache.delete(o.id);
        made.forEach((m) => ids.push(m.id));
      }
      this.reindex();
      ids.forEach((id) => this.get(id) && this.touch(this.get(id)));
      this.setSelection(ids);
      this.requestRender();
      this.commit('Break apart');
    }
    strokeToPath() {
      const objs = this.selected().filter((o) => Doc.isShape(o) && o.style.stroke && o.style.strokeWidth > 0);
      if (!objs.length) {
        this.toast('Select a shape that has an outline (stroke)');
        return;
      }
      const ids = [];
      for (const o of objs) {
        const width = o.style.strokeWidth;
        const res = V3D.Trace.strokeToPath(this.worldSubs(o), width, { join: o.style.strokeJoin, cap: o.style.strokeCap, dash: o.style.dash });
        if (!res.length) continue;
        const p = this.pathFromWorld(res, o);
        p.style = Object.assign(Doc.defaultStyle(), { fill: o.style.stroke, stroke: null, opacity: o.style.opacity });
        p.fx = null;
        const list = this.listOf(o.id);
        const i = list.indexOf(o);
        if (o.style.fill) {
          o.style.stroke = null;
          this.touch(o);
          list.splice(i + 1, 0, p);
        } else {
          list.splice(i, 1, p);
          Doc.cache.delete(o.id);
        }
        ids.push(p.id);
      }
      this.reindex();
      ids.forEach((id) => this.touch(this.get(id)));
      this.setSelection(ids);
      this.requestRender();
      this.commit('Stroke to path');
    }
    offsetPath(d) {
      const objs = this.shapesSelected(1);
      if (!objs) return;
      for (const o of objs) {
        const res = V3D.Trace.offset(this.worldSubs(o), d, o.style.fillRule || 'nonzero');
        if (!res.length) continue;
        this.replaceObject(o, Object.assign(this.pathFromWorld(res, o), { id: o.id }));
      }
      this.setSelection(this.sel.slice(), true);
      this.requestRender();
      this.commit(d > 0 ? 'Outset' : 'Inset');
    }
    simplify() {
      const objs = this.shapesSelected(1);
      if (!objs) return;
      for (const o of objs) {
        const subs = this.worldSubs(o);
        const b = Path.bbox(subs);
        const tol = Math.max(0.2, Math.hypot(V3D.Rect.w(b), V3D.Rect.h(b)) * 0.004);
        const runs = Path.flatten(subs, tol / 4).map((f) => ({
          closed: f.closed,
          segs: f.closed ? V3D.Fit.closed(f.pts, tol, { cornerDeg: 60 }) : V3D.Fit.open(f.pts, tol, { cornerDeg: 60 }),
        }));
        const res = Path.fromCubicRuns(runs.filter((r) => r.segs.length));
        this.replaceObject(o, Object.assign(this.pathFromWorld(res, o), { id: o.id }));
      }
      this.setSelection(this.sel.slice(), true);
      this.requestRender();
      this.commit('Simplify');
    }
    reversePath() {
      const objs = this.shapesSelected(1);
      if (!objs) return;
      for (const o of objs) {
        const p = o.type === 'path' ? o : Doc.toPath(o);
        p.subs = Path.reverse(p.subs);
        if (p !== o) this.replaceObject(o, p);
        else this.touch(o);
      }
      this.requestRender();
      this.commit('Reverse');
    }

    /* ---------------- 3D ---------------- */
    apply3D(kind) {
      const objs = this.fxTargets();
      if (!objs.length) {
        this.toast(this.sel.length ? 'Images can’t be made 3D — trace them into shapes first (Path › Trace bitmap)' : 'Select a shape first, then choose a 3D effect');
        return;
      }
      const pivots = this.groupPivots();
      for (const o of objs) {
        if (!o.fx) {
          const b = this.bboxOf(o);
          const size = b ? Math.max(V3D.Rect.w(b), V3D.Rect.h(b)) : 200;
          o.fx = R3D.defaults(kind, o.type === 'text' ? size * 0.55 : size);
          if (kind === 'revolve') {
            o.fx.rx = 12;
            o.fx.ry = 0;
          }
          if (kind === 'inflate') {
            o.fx.rx = 12;
            o.fx.ry = -18;
          }
          this.carryStroke(o);
          this.setPivot(o, pivots.get(o.id));
        } else {
          o.fx.kind = kind;
        }
        this.touch(o);
      }
      this.requestRender();
      this.commit(R3D.kinds[kind].name);
      this.bus.emit('fx');
    }
    /** A shape that has an outline keeps it in 3D: its stroke becomes the 3D object's edge lines. */
    carryStroke(o) {
      const st = o.style || {};
      const c = typeof st.stroke === 'string' ? st.stroke : st.stroke ? R3D.solidOf(st.stroke) : null;
      if (c && c !== 'none' && st.strokeWidth > 0) Object.assign(o.fx, { edges: 'outline', edgeColor: Color.normalize(c), edgeWidth: st.strokeWidth });
    }
    /** For shapes reached through a selected group: that group's centre (world space). */
    groupPivots() {
      const map = new Map();
      for (const o of this.selected()) {
        if (o.type !== 'group') continue;
        const b = this.bboxOf(o);
        if (!b) continue;
        const c = [V3D.Rect.cx(b), V3D.Rect.cy(b)];
        Doc.walk(o.children, (x) => {
          if (Doc.can3D(x)) map.set(x.id, c);
        });
      }
      return map;
    }
    /** Stores a world-space pivot in the object's local space so it follows the object. */
    setPivot(o, world) {
      if (!o.fx) return;
      if (!world) {
        o.fx.pivot = null;
        return;
      }
      const Wi = M2.invert(this.worldMatrix(o));
      o.fx.pivot = M2.apply(Wi, world[0], world[1]);
    }
    groupRotate(on) {
      const pivots = this.groupPivots();
      for (const o of this.fxTargets(true)) {
        if (on) {
          let p = pivots.get(o.id);
          if (!p) {
            const par = this.parentOf(o.id);
            const b = par && this.bboxOf(par);
            if (b) p = [V3D.Rect.cx(b), V3D.Rect.cy(b)];
          }
          this.setPivot(o, p);
        } else o.fx.pivot = null;
        this.touch(o);
      }
      this.requestRender();
      this.commit(on ? 'Rotate as a group' : 'Rotate separately');
      this.bus.emit('fx');
    }
    remove3D() {
      const objs = this.fxTargets(true);
      if (!objs.length) return;
      objs.forEach((o) => {
        o.fx = null;
        this.touch(o);
      });
      this.requestRender();
      this.commit('Remove 3D');
      this.bus.emit('fx');
    }
    /** Sets a 3D property on every selected 3D object. */
    setFx(prop, value, final = true) {
      const objs = this.fxTargets(true);
      if (!objs.length) return;
      for (const o of objs) {
        if (prop.startsWith('light.')) o.fx.light[prop.slice(6)] = value;
        else o.fx[prop] = value;
        this.touch(o);
      }
      if (!final) this.setDraft(objs.map((o) => o.id));
      else this.setDraft(null);
      this.requestRender();
      if (final) this.commitSoon('3D settings');
      this.bus.emit('fx');
    }
    setFxMany(props, label = '3D settings') {
      const objs = this.fxTargets(true);
      for (const o of objs) {
        for (const k in props) {
          if (k === 'light') Object.assign(o.fx.light, props.light);
          else o.fx[k] = props[k];
        }
        this.touch(o);
      }
      this.setDraft(null);
      this.requestRender();
      this.commit(label);
      this.bus.emit('fx');
    }
    setSceneLight(props, final = true) {
      Object.assign(this.doc.scene.light, props);
      this.sceneChanged();
      if (!final) this.setDraft(this.all3DIds());
      else this.setDraft(null);
      this.requestRender();
      if (final) this.commitSoon('Light');
      this.bus.emit('fx');
    }
    /* ---------------- scene cameras ---------------- */
    // A saved camera (doc.scene.cameras) is a view shared by every object locked to it: its angles, perspective,
    // turning point and camera distance. Inside it, each object can still turn on its own and be pushed back.
    cameraOf(o) {
      return Doc.cameraOf(o, this.doc.scene);
    }
    /** The camera the 3D selection is locked to ('' when none). */
    lockedCamera() {
      const o = this.fxTargets(true).pop();
      return o && this.cameraOf(o) ? o.fx.camera : '';
    }
    /** Where a new camera can turn around, the page's or the selection's center, and how far the scene reaches. */
    cameraPlaces() {
      let sel = null;
      for (const o of this.fxTargets(true)) sel = V3D.Rect.union(sel, Path.bbox(this.worldSubs(o)));
      const page = { x: 0, y: 0, x2: this.doc.width, y2: this.doc.height };
      if (!V3D.Rect.valid(sel)) sel = page;
      const c = (b) => [U.fmt(V3D.Rect.cx(b), 4) * 1, U.fmt(V3D.Rect.cy(b), 4) * 1];
      const reach = Math.max(Math.hypot(V3D.Rect.w(page), V3D.Rect.h(page)), Math.hypot(V3D.Rect.w(sel), V3D.Rect.h(sel))) / 2;
      return { page: c(page), selection: c(sel), reach: U.fmt(reach, 4) * 1 };
    }
    saveCamera(name, around = 'page') {
      const objs = this.fxTargets(true);
      if (!name || !objs.length) return;
      const o = objs[objs.length - 1];
      const v = Doc.view3D(o, this.worldMatrix(o), this.doc.scene).fx;
      const places = this.cameraPlaces();
      this.doc.scene.cameras[name] = { rx: v.rx, ry: v.ry, rz: v.rz, persp: v.persp, pivot: places[around] || places.page, reach: places.reach };
      for (const x of objs) {
        x.fx.camera = name;
        this.touch(x);
      }
      this.sceneChanged();
      this.requestRender();
      this.commit('Save camera');
      this.bus.emit('fx');
      this.toast(`Saved the camera “${name}”`);
    }
    /** Locks the 3D selection to a saved camera, or unlocks it (''), keeping exactly how it looks. */
    useCamera(name) {
      const cam = name && this.doc.scene.cameras[name];
      for (const o of this.fxTargets(true)) {
        if (cam) {
          Object.assign(o.fx, { camera: name, rx: cam.rx, ry: cam.ry, rz: cam.rz, persp: cam.persp });
        } else this.dropCamera(o);
        this.touch(o);
      }
      this.sceneChanged();
      this.requestRender();
      this.commit(cam ? 'Lock to camera' : 'Unlock camera');
      this.bus.emit('fx');
    }
    /** Unlocks one object and gives it the camera's view as its own, so it stays exactly where it is. */
    dropCamera(o) {
      const cam = this.cameraOf(o);
      if (cam) {
        Object.assign(o.fx, { rx: cam.rx, ry: cam.ry, rz: cam.rz, persp: cam.persp, sceneRadius: cam.reach });
        this.setPivot(o, cam.pivot);
      }
      delete o.fx.camera;
    }
    deleteCamera(name = this.lockedCamera()) {
      if (!name || !this.doc.scene.cameras[name]) return;
      Doc.walk(this.doc.objects, (o) => {
        if (o.fx && o.fx.camera === name) {
          this.dropCamera(o);
          this.touch(o);
        }
      });
      delete this.doc.scene.cameras[name];
      this.sceneChanged();
      this.requestRender();
      this.commit('Delete camera');
      this.bus.emit('fx');
    }
    /** Changes a camera's angles or perspective: every object locked to it follows. */
    setCameraView(props, final = true) {
      const name = this.lockedCamera();
      const cam = name && this.doc.scene.cameras[name];
      if (!cam) return;
      Object.assign(cam, props);
      this.sceneChanged();
      this.setDraft(final ? null : this.lockedTo(name));
      this.requestRender();
      if (final) this.commitSoon('Turn camera');
      this.bus.emit('fx');
    }
    /** Perspective of the 3D selection: its camera's when it's locked to one. */
    perspective() {
      const o = this.fxTargets(true).pop();
      if (!o) return null;
      const cam = this.cameraOf(o);
      return cam ? cam.persp : o.fx.persp;
    }
    setPerspective(v, final = true) {
      if (this.lockedCamera()) this.setCameraView({ persp: v }, final);
      else this.setFx('persp', v, final);
    }
    lockedTo(name) {
      const ids = [];
      Doc.walk(this.doc.objects, (o) => {
        if (o.fx && o.fx.camera === name) ids.push(o.id);
      });
      return ids;
    }
    /** True when an object's own turn and push back apply: inside a camera, or while they're in use. */
    placementShown(o) {
      const f = o && o.fx;
      return !!(f && (this.cameraOf(o) || f.objRx || f.objRy || f.objRz || f.objPush));
    }
    setTurnMode(mode) {
      this.turnMode = mode;
      this.bus.emit('fx');
      this.requestOverlay();
    }
    /** What turning object o changes: its own view, the camera it's locked to, or its own turn in the scene. */
    turnTarget(o) {
      if (this.turnMode === 'object' && this.placementShown(o)) return { keys: ['objRx', 'objRy', 'objRz'], obj: o };
      const cam = this.cameraOf(o);
      if (cam) return { cam, name: o.fx.camera };
      return { keys: ['rx', 'ry', 'rz'], obj: o };
    }
    /** The turn targets of several objects, each camera once. */
    turnTargets(objs = this.fxTargets(true)) {
      const out = new Map();
      for (const o of objs) {
        if (!o.fx) continue;
        const t = this.turnTarget(o);
        const key = t.cam ? 'cam:' + t.name : o.id;
        if (!out.has(key)) out.set(key, t);
      }
      return [...out.values()];
    }
    getTurn(t) {
      return t.cam ? [t.cam.rx, t.cam.ry, t.cam.rz] : t.keys.map((k) => t.obj.fx[k] || 0);
    }
    setTurn(t, r) {
      if (t.cam) {
        [t.cam.rx, t.cam.ry, t.cam.rz] = r;
        this.sceneChanged();
      } else {
        t.keys.forEach((k, i) => (t.obj.fx[k] = r[i]));
        this.touch(t.obj);
      }
    }
    /** Turns the 3D selection (camera, own view or own turn in the scene, as the turn mode says). */
    turnSelection(r, final, label = 'Rotate in 3D') {
      const objs = this.fxTargets(true);
      if (!objs.length) return;
      const draft = new Set();
      for (const t of this.turnTargets(objs)) {
        this.setTurn(t, r);
        for (const id of t.cam ? this.lockedTo(t.name) : [t.obj.id]) draft.add(id);
      }
      this.setDraft(final ? null : [...draft]);
      this.requestRender();
      if (final) this.commit(label);
      this.bus.emit('fx');
    }
    /** Ids of the objects being edited in 3D when the rest of the drawing is faded; null when nothing is. */
    fadeFocus() {
      if (!this.ui || this.ui.tab !== '3d' || (this.prefs.otherObjects && this.prefs.otherFullColor)) return null;
      const objs = this.fxTargets(true);
      return objs.length ? new Set(objs.map((o) => o.id)) : null;
    }

    copy3D() {
      const o = this.fxTargets(true).pop();
      if (!o) {
        this.toast('Select a 3D object to copy its style');
        return;
      }
      this.fxClipboard = U.clone(o.fx);
      this.toast('Copied 3D style');
    }
    paste3D() {
      if (!this.fxClipboard) {
        this.toast('Copy a 3D style first');
        return;
      }
      const objs = this.fxTargets();
      objs.forEach((o) => {
        o.fx = Object.assign(U.clone(this.fxClipboard), { pivot: o.fx ? o.fx.pivot : null, camera: o.fx ? o.fx.camera : undefined });
        this.touch(o);
      });
      this.requestRender();
      this.commit('Paste 3D style');
      this.bus.emit('fx');
    }
    /** Converts 3D objects into plain editable vector paths. */
    expand3D() {
      const objs = this.fxTargets(true);
      if (!objs.length) {
        this.toast('Select a 3D object to expand');
        return;
      }
      const ids = [];
      for (const o of objs) {
        const v = Doc.view3D(o, this.worldMatrix(o), this.doc.scene);
        const r = V3D.R3D.render(this.worldSubs(o), v.fx, o.style, this.doc.scene, { id: o.id + 'x', quality: 'full', pivot: v.pivot });
        const g = V3D.IO.markupToGroup(r.markup, this.parentMatrix(o.id));
        g.name = `3D ${R3D.kinds[o.fx.kind].name}: ${o.name || Doc.typeName(o)}`;
        this.replaceObject(o, g);
        ids.push(g.id);
      }
      this.setSelection(ids);
      this.requestRender();
      this.commit('Expand 3D');
      this.bus.emit('fx');
      this.toast('Expanded into editable vector shapes');
    }

    /* ---------------- keyboard ---------------- */
    onKey(e) {
      const t = e.target;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      if (typing) {
        if (e.key === 'Escape') t.blur();
        return;
      }
      if (this.ui.handleKey && this.ui.handleKey(e)) return;
      const mod = U.modKey(e);
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (e.code === 'Space' && !mod) {
        if (!this.canvas.spaceDown) {
          this.canvas.spaceDown = true;
          this.canvas.stage.classList.add('space');
        }
        e.preventDefault();
        return;
      }
      if (this.tool && typeof this.tool.key === 'function' && this.tool.key(e)) {
        e.preventDefault();
        return;
      }
      const run = (fn) => {
        e.preventDefault();
        fn();
      };
      if (mod) {
        if (k === 'z' && !e.shiftKey) return run(() => this.history.undo());
        if ((k === 'z' && e.shiftKey) || k === 'y') return run(() => this.history.redo());
        if (k === 'c') return run(() => this.copy());
        if (k === 'x') return run(() => this.cut());
        if (k === 'v') {
          // Let the native paste event deliver clipboard content; fall back to the internal clipboard.
          if (e.shiftKey || e.altKey) return run(() => this.paste(true));
          return;
        }
        if (k === 'd') return run(() => this.duplicateSelection());
        if (k === 'a') return run(() => this.selectAll());
        if (k === 'g' && !e.shiftKey) return run(() => this.group());
        if (k === 'g' && e.shiftKey) return run(() => this.ungroup());
        if (k === 's') return run(() => V3D.IO.saveProject(this));
        if (k === 'o') return run(() => this.ui.openFile('project'));
        if (k === 'e') return run(() => this.ui.showExport());
        if (k === 'i') return run(() => this.ui.openFile('import'));
        if (k === 'k' && !e.shiftKey) return run(() => this.combine());
        if (k === 'k' && e.shiftKey) return run(() => this.breakApart());
        if (k === '+' || k === '=') return run(() => (e.shiftKey ? this.boolean('union') : this.canvas.zoomCenter(1.25)));
        if (k === '-') return run(() => this.canvas.zoomCenter(0.8));
        if (k === '0') return run(() => this.canvas.fitPage());
        if (k === ']') return run(() => this.arrange(e.shiftKey ? 'top' : 'up'));
        if (k === '[') return run(() => this.arrange(e.shiftKey ? 'bottom' : 'down'));
        if (k === 'c' && e.shiftKey) return run(() => this.convertToPath());
        return;
      }
      if (k === 'Delete' || k === 'Backspace') return run(() => this.deleteSelection());
      if (k === 'Escape') {
        if (this.tool && this.tool.cancel && this.tool.s) this.tool.cancel();
        if (this.toolId !== 'select') this.setTool('select');
        else this.setSelection([]);
        e.preventDefault();
        return;
      }
      if (k.startsWith && k.startsWith('Arrow')) {
        const st = (e.shiftKey ? 10 : 1) * (e.altKey ? 1 / this.canvas.zoom : 1);
        const d = { ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, -st], ArrowDown: [0, st] }[k];
        if (d) return run(() => this.nudge(d[0], d[1]));
      }
      if (k === 'PageUp') return run(() => this.arrange(e.shiftKey ? 'top' : 'up'));
      if (k === 'PageDown') return run(() => this.arrange(e.shiftKey ? 'bottom' : 'down'));
      if (k === 'Home') return run(() => this.arrange('top'));
      if (k === 'End') return run(() => this.arrange('bottom'));
      if (e.shiftKey && k === 'h') return run(() => this.flip('h'));
      if (e.shiftKey && k === 'v') return run(() => this.flip('v'));
      if (k === '+' || k === '=') return run(() => this.canvas.zoomCenter(1.25));
      if (k === '-') return run(() => this.canvas.zoomCenter(0.8));
      if (k === '1') return run(() => this.canvas.setView(1, this.canvas.x, this.canvas.y));
      if (k === '3') return run(() => this.canvas.fit(this.selectionBBox()));
      if (k === '4') return run(() => this.zoomDrawing());
      if (k === '5' || k === '0') return run(() => this.canvas.fitPage());
      if (k === '#') return run(() => this.setPref('grid', this.prefs.grid === 'none' ? 'square' : 'none'));
      if (k === '?') return run(() => this.ui.showShortcuts());
      if (!e.shiftKey && !e.altKey) {
        for (const id in V3D.Tools) {
          const tl = V3D.Tools[id];
          if (tl && tl.shortcut && tl.shortcut.toLowerCase() === k) return run(() => this.setTool(id));
        }
      }
    }
    zoomDrawing() {
      let b = null;
      for (const o of this.doc.objects) if (o.visible !== false) b = V3D.Rect.union(b, this.bboxOf(o));
      if (b) this.canvas.fit(b);
    }
  }

  V3D.App = App;
  V3D.AUTOSAVE_KEY = AUTOSAVE_KEY;
})();
