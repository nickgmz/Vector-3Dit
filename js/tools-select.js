/* Vector 3Dit — Select and Node tools. */
(function () {
  'use strict';
  const V3D = globalThis.V3D;
  const { M2, Path, Doc, Snap } = V3D;
  const { fmt } = V3D.U;
  const Tools = (V3D.Tools = V3D.Tools || {});

  const HANDLE_R = 7;
  const handleSpots = [
    ['nw', 0, 0, 'nwse-resize'],
    ['n', 0.5, 0, 'ns-resize'],
    ['ne', 1, 0, 'nesw-resize'],
    ['e', 1, 0.5, 'ew-resize'],
    ['se', 1, 1, 'nwse-resize'],
    ['s', 0.5, 1, 'ns-resize'],
    ['sw', 0, 1, 'nesw-resize'],
    ['w', 0, 0.5, 'ew-resize'],
  ];

  /** Applies a doc-space matrix to an object given its transform at drag start. */
  function applyWorld(app, o, M, T0) {
    const P = app.parentMatrix(o.id);
    const Pi = M2.invert(P);
    o.transform = M2.mul(Pi, M2.mul(M, M2.mul(P, T0)));
    app.touch(o);
  }
  Tools.applyWorld = applyWorld;

  /* ======================= Select ======================= */
  Tools.select = {
    id: 'select',
    name: 'Select',
    shortcut: 'V',
    cursor: 'default',
    hint: 'Click a shape to select it, drag to move. Drag the square handles to resize and the round knob to rotate. Shift-click adds to the selection.',
    s: null,

    handles(app) {
      const b = app.selectionBBox();
      if (!b) return [];
      const c = app.canvas;
      const [x1, y1] = c.toScreen(b.x, b.y);
      const [x2, y2] = c.toScreen(b.x2, b.y2);
      const out = handleSpots.map(([id, hx, hy, cur]) => ({ id, hx, hy, cur, x: x1 + (x2 - x1) * hx, y: y1 + (y2 - y1) * hy }));
      out.push({ id: 'rot', x: (x1 + x2) / 2, y: y1 - 28, cur: 'grab' });
      return out;
    },
    handleAt(app, ev) {
      if (!app.sel.length) return null;
      for (const h of this.handles(app)) if (Math.hypot(h.x - ev.sx, h.y - ev.sy) <= HANDLE_R + 2) return h;
      return null;
    },

    down(ev) {
      const app = this.app;
      const h = this.handleAt(app, ev);
      const origin = () => new Map(app.selected().map((o) => [o.id, o.transform.slice()]));
      if (h) {
        const b = app.selectionBBox();
        this.s = { mode: h.id === 'rot' ? 'rotate' : 'scale', h, b, x0: ev.x, y0: ev.y, T: origin(), moved: false };
        app.setDraft(app.sel);
        return;
      }
      const id = app.canvas.idFromTarget(ev.target, ev.mod) || (ev.target === app.canvas.stage ? null : null);
      if (id) {
        const wasSelected = app.sel.includes(id);
        if (ev.shift) app.toggleSelect(id);
        else if (!wasSelected) app.setSelection([id]);
        this.s = {
          mode: 'move-pending',
          id,
          wasSelected,
          x0: ev.x,
          y0: ev.y,
          sx0: ev.sx,
          sy0: ev.sy,
          alt: ev.alt,
        };
        return;
      }
      if (!ev.shift) app.setSelection([]);
      this.s = { mode: 'band', x0: ev.x, y0: ev.y, x1: ev.x, y1: ev.y, add: ev.shift };
    },

    move(ev) {
      const app = this.app;
      const s = this.s;
      if (!s) {
        const h = this.handleAt(app, ev);
        app.canvas.stage.style.cursor = h ? h.cur : '';
        app.hover(ev.buttons ? null : app.canvas.idFromTarget(ev.target, ev.mod));
        return;
      }
      if (s.mode === 'move-pending') {
        if (Math.hypot(ev.sx - s.sx0, ev.sy - s.sy0) < 3) return;
        if (!app.sel.includes(s.id)) return;
        if (s.alt) {
          app.duplicateSelection({ offset: 0, silent: true });
        }
        const objs = app.selected();
        s.mode = 'move';
        s.T = new Map(objs.map((o) => [o.id, o.transform.slice()]));
        s.b = app.selectionBBox();
        s.top = objs.every((o) => !app.idx.get(o.id).parent);
        app.hover(null);
      }
      if (s.mode === 'move') {
        let dx = ev.x - s.x0;
        let dy = ev.y - s.y0;
        if (ev.shift) {
          if (Math.abs(dx) > Math.abs(dy)) dy = 0;
          else dx = 0;
        }
        s.guides = [];
        if (s.b && !ev.alt) {
          const moved = { x: s.b.x + dx, y: s.b.y + dy, x2: s.b.x2 + dx, y2: s.b.y2 + dy };
          const sn = Snap.box(app, moved, new Set(app.sel));
          dx += sn.dx;
          dy += sn.dy;
          s.guides = sn.guides;
        }
        s.dx = dx;
        s.dy = dy;
        s.moved = true;
        if (s.top) {
          app.canvas.previewTranslate(app.sel, dx, dy);
          s.previewBox = s.b ? { x: s.b.x + dx, y: s.b.y + dy, x2: s.b.x2 + dx, y2: s.b.y2 + dy } : null;
          app.requestOverlay();
        } else {
          const M = M2.translate(dx, dy);
          for (const o of app.selected()) applyWorld(app, o, M, s.T.get(o.id));
          app.requestRender();
        }
        app.status(`Move  Δx ${fmt(dx, 1)}  Δy ${fmt(dy, 1)}`, true);
        return;
      }
      if (s.mode === 'scale') {
        const { b, h } = s;
        const W = b.x2 - b.x;
        const H = b.y2 - b.y;
        let ax = b.x + (1 - h.hx) * W;
        let ay = b.y + (1 - h.hy) * H;
        const hx0 = b.x + h.hx * W;
        const hy0 = b.y + h.hy * H;
        let px = ev.x;
        let py = ev.y;
        const sn = Snap.point(app, px, py, { exclude: new Set(app.sel) });
        px = sn.x;
        py = sn.y;
        s.guides = sn.guides;
        if (ev.alt) {
          ax = (b.x + b.x2) / 2;
          ay = (b.y + b.y2) / 2;
        }
        let sx = h.hx === 0.5 || Math.abs(hx0 - ax) < 1e-9 ? 1 : (px - ax) / (hx0 - ax);
        let sy = h.hy === 0.5 || Math.abs(hy0 - ay) < 1e-9 ? 1 : (py - ay) / (hy0 - ay);
        const corner = h.hx !== 0.5 && h.hy !== 0.5;
        if (ev.shift || (corner && app.prefs.lockRatio)) {
          if (corner) {
            const k = Math.max(Math.abs(sx), Math.abs(sy));
            sx = Math.sign(sx || 1) * k;
            sy = Math.sign(sy || 1) * k;
          } else if (h.hx === 0.5) sx = Math.abs(sy);
          else sy = Math.abs(sx);
        }
        const clampS = (v) => (Math.abs(v) < 0.002 ? (v < 0 ? -0.002 : 0.002) : v);
        sx = clampS(sx);
        sy = clampS(sy);
        const M = M2.scale(sx, sy, ax, ay);
        for (const o of app.selected()) applyWorld(app, o, M, s.T.get(o.id));
        s.moved = true;
        app.requestRender();
        app.status(`Scale  ${fmt(Math.abs(sx) * 100, 1)}% × ${fmt(Math.abs(sy) * 100, 1)}%   ${fmt(Math.abs(W * sx), 1)} × ${fmt(Math.abs(H * sy), 1)}`, true);
        return;
      }
      if (s.mode === 'rotate') {
        const cx = (s.b.x + s.b.x2) / 2;
        const cy = (s.b.y + s.b.y2) / 2;
        let a = V3D.U.deg(Math.atan2(ev.y - cy, ev.x - cx) - Math.atan2(s.y0 - cy, s.x0 - cx));
        if (ev.shift) a = Math.round(a / 15) * 15;
        const M = M2.rotate(a, cx, cy);
        for (const o of app.selected()) applyWorld(app, o, M, s.T.get(o.id));
        s.moved = true;
        s.angle = a;
        app.requestRender();
        app.status(`Rotate ${fmt(a, 1)}°`, true);
        return;
      }
      if (s.mode === 'band') {
        s.x1 = ev.x;
        s.y1 = ev.y;
        app.requestOverlay();
      }
    },

    up(ev) {
      const app = this.app;
      const s = this.s;
      this.s = null;
      if (!s) return;
      app.status(null);
      if (s.mode === 'move-pending') {
        // Plain click on an already-selected object narrows the selection to it.
        if (s.wasSelected && !ev.shift && app.sel.length > 1) app.setSelection([s.id]);
        return;
      }
      if (s.mode === 'move') {
        if (s.moved && (s.dx || s.dy)) {
          const M = M2.translate(s.dx, s.dy);
          for (const o of app.selected()) applyWorld(app, o, M, s.T.get(o.id));
          app.commit(s.alt ? 'Duplicate' : 'Move');
        }
        app.requestRender();
        app.requestOverlay();
        return;
      }
      if (s.mode === 'scale' || s.mode === 'rotate') {
        app.setDraft(null);
        if (s.moved) app.commit(s.mode === 'scale' ? 'Resize' : 'Rotate');
        return;
      }
      if (s.mode === 'band') {
        const r = V3D.Rect.fromPoints(s.x0, s.y0, s.x1, s.y1);
        if (V3D.Rect.w(r) * app.canvas.zoom < 3 && V3D.Rect.h(r) * app.canvas.zoom < 3) {
          app.requestOverlay();
          return;
        }
        const hits = app.doc.objects
          .filter((o) => o.visible !== false && !o.locked)
          .filter((o) => {
            const b = app.bboxOf(o);
            return b && V3D.Rect.intersects(r, b);
          })
          .map((o) => o.id);
        app.setSelection(s.add ? Array.from(new Set(app.sel.concat(hits))) : hits);
        app.requestOverlay();
      }
    },

    cancel() {
      if (this.s && this.s.T) {
        for (const o of this.app.selected()) if (this.s.T.has(o.id)) (o.transform = this.s.T.get(o.id)), this.app.touch(o);
      }
      this.s = null;
      this.app.setDraft(null);
      this.app.requestRender();
    },

    dblclick(ev) {
      const app = this.app;
      const top = app.canvas.idFromTarget(ev.target, false);
      if (!top) return;
      const o = app.get(top);
      if (o.type === 'group') {
        const deep = app.canvas.idFromTarget(ev.target, true);
        if (deep && deep !== top) app.setSelection([deep]);
        return;
      }
      if (o.type === 'text') {
        app.setTool('text');
        V3D.Tools.text.edit(o);
        return;
      }
      if (Doc.isShape(o)) app.setTool('node');
    },

    overlay() {
      const app = this.app;
      const s = this.s;
      let out = '';
      if (s && s.mode === 'band') {
        const [x1, y1] = app.canvas.toScreen(Math.min(s.x0, s.x1), Math.min(s.y0, s.y1));
        const [x2, y2] = app.canvas.toScreen(Math.max(s.x0, s.x1), Math.max(s.y0, s.y1));
        out += `<rect x="${x1}" y="${y1}" width="${x2 - x1}" height="${y2 - y1}" class="ov-band"/>`;
      }
      if (s && s.guides) out += Snap.guideMarkup(app, s.guides);
      const b = s && s.mode === 'move' && s.previewBox ? s.previewBox : app.selectionBBox();
      if (!b || !app.sel.length) return out;
      const c = app.canvas;
      const [x1, y1] = c.toScreen(b.x, b.y);
      const [x2, y2] = c.toScreen(b.x2, b.y2);
      out += `<rect x="${fmt(x1, 1)}" y="${fmt(y1, 1)}" width="${fmt(x2 - x1, 1)}" height="${fmt(y2 - y1, 1)}" class="ov-selbox"/>`;
      if (s && s.mode === 'move') return out;
      // Per-object outlines when several objects are selected.
      if (app.sel.length > 1)
        for (const o of app.selected()) {
          const ob = app.bboxOf(o);
          if (!ob) continue;
          const [a1, b1] = c.toScreen(ob.x, ob.y);
          const [a2, b2] = c.toScreen(ob.x2, ob.y2);
          out += `<rect x="${fmt(a1, 1)}" y="${fmt(b1, 1)}" width="${fmt(a2 - a1, 1)}" height="${fmt(b2 - b1, 1)}" class="ov-subbox"/>`;
        }
      const hs = this.handles(app);
      const rot = hs.find((h) => h.id === 'rot');
      out += `<line x1="${fmt(rot.x, 1)}" y1="${fmt(y1, 1)}" x2="${fmt(rot.x, 1)}" y2="${fmt(rot.y, 1)}" class="ov-stem"/>`;
      for (const h of hs) {
        if (h.id === 'rot') out += `<circle cx="${fmt(h.x, 1)}" cy="${fmt(h.y, 1)}" r="5.5" class="ov-rot"/>`;
        else out += `<rect x="${fmt(h.x - 4.5, 1)}" y="${fmt(h.y - 4.5, 1)}" width="9" height="9" rx="1.5" class="ov-handle"/>`;
      }
      return out;
    },
  };

  /* ======================= Node ======================= */
  const key = (si, ni) => si + ':' + ni;
  const parseKey = (k) => k.split(':').map(Number);

  Tools.node = {
    id: 'node',
    name: 'Edit nodes',
    shortcut: 'A',
    cursor: 'default',
    hint: 'Drag nodes and their handles to reshape. Double-click a segment to add a node. Delete removes selected nodes. Drag a segment to bend it.',
    sel: new Set(),
    s: null,

    activate() {
      this.sel = new Set();
      const t = this.target();
      if (t && t.type !== 'path' && t.type !== 'text' && !['rect', 'ellipse', 'star'].includes(t.type)) this.app.setSelection([]);
    },
    target() {
      const app = this.app;
      if (app.sel.length !== 1) return null;
      const o = app.get(app.sel[0]);
      return o && Doc.isShape(o) ? o : null;
    },
    W(o) {
      return M2.mul(this.app.parentMatrix(o.id), o.transform);
    },
    /** Screen positions of nodes/handles for a path object. */
    geo(o) {
      const W = this.W(o);
      const c = this.app.canvas;
      const scr = (x, y) => {
        const p = M2.apply(W, x, y);
        return c.toScreen(p[0], p[1]);
      };
      return { W, scr };
    },
    visibleHandles(o) {
      const out = [];
      if (o.type !== 'path') return out;
      o.subs.forEach((sp, si) => {
        const n = sp.nodes.length;
        sp.nodes.forEach((nd, ni) => {
          const selHere = this.sel.has(key(si, ni));
          const prevSel = this.sel.has(key(si, (ni - 1 + n) % n)) && (sp.closed || ni > 0);
          const nextSel = this.sel.has(key(si, (ni + 1) % n)) && (sp.closed || ni < n - 1);
          if ((selHere || prevSel) && Path.hasIn(nd) && (sp.closed || ni > 0)) out.push({ si, ni, which: 'in' });
          if ((selHere || nextSel) && Path.hasOut(nd) && (sp.closed || ni < n - 1)) out.push({ si, ni, which: 'out' });
        });
      });
      return out;
    },
    /** Parametric handles for primitive shapes (local coords). */
    paramHandles(o) {
      if (o.type === 'rect') return [{ id: 'r', x: o.x + Math.min(o.r || 0, o.w / 2), y: o.y, tip: 'Corner radius' }];
      if (o.type === 'ellipse')
        return [
          { id: 'rx', x: o.cx + o.rx, y: o.cy, tip: 'Width' },
          { id: 'ry', x: o.cx, y: o.cy - o.ry, tip: 'Height' },
        ];
      if (o.type === 'star') {
        const a1 = V3D.U.rad(o.rot - 90);
        const a2 = V3D.U.rad(o.rot + 180 / o.n - 90);
        const hs = [{ id: 'tip', x: o.cx + o.r1 * Math.cos(a1), y: o.cy + o.r1 * Math.sin(a1), tip: 'Size & rotation' }];
        if (o.star) hs.push({ id: 'inner', x: o.cx + o.r2 * Math.cos(a2), y: o.cy + o.r2 * Math.sin(a2), tip: 'Inner radius' });
        return hs;
      }
      return [];
    },

    down(ev) {
      const app = this.app;
      let o = this.target();
      const hitId = app.canvas.idFromTarget(ev.target, true);
      if (!o) {
        if (hitId && Doc.isShape(app.get(hitId))) {
          app.setSelection([hitId]);
          this.sel = new Set();
        } else if (hitId) app.setSelection([hitId]);
        return;
      }
      const { W, scr } = this.geo(o);
      const Wi = M2.invert(W);
      const local = (x, y) => M2.apply(Wi, x, y);
      // Primitive shape handles.
      if (o.type !== 'path') {
        for (const h of this.paramHandles(o)) {
          const p = scr(h.x, h.y);
          if (Math.hypot(p[0] - ev.sx, p[1] - ev.sy) <= HANDLE_R + 2) {
            this.s = { mode: 'param', h, local, orig: V3D.U.clone(o) };
            app.setDraft([o.id]);
            return;
          }
        }
        if (hitId && hitId !== o.id) app.setSelection([hitId]);
        else if (!hitId) app.setSelection([]);
        return;
      }
      // Handles.
      for (const h of this.visibleHandles(o)) {
        const nd = o.subs[h.si].nodes[h.ni];
        const p = h.which === 'in' ? scr(nd.ix, nd.iy) : scr(nd.ox, nd.oy);
        if (Math.hypot(p[0] - ev.sx, p[1] - ev.sy) <= HANDLE_R) {
          this.s = { mode: 'handle', h, local, alt: ev.alt };
          app.setDraft([o.id]);
          return;
        }
      }
      // Nodes.
      let best = null;
      o.subs.forEach((sp, si) =>
        sp.nodes.forEach((nd, ni) => {
          const p = scr(nd.x, nd.y);
          const d = Math.hypot(p[0] - ev.sx, p[1] - ev.sy);
          if (d <= HANDLE_R && (!best || d < best.d)) best = { si, ni, d };
        })
      );
      if (best) {
        const k = key(best.si, best.ni);
        if (ev.shift) {
          if (this.sel.has(k)) this.sel.delete(k);
          else this.sel.add(k);
        } else if (!this.sel.has(k)) this.sel = new Set([k]);
        this.s = { mode: 'nodes', local, x0: ev.x, y0: ev.y, orig: Path.clone(o.subs), moved: false };
        app.setDraft([o.id]);
        app.requestOverlay();
        app.bus.emit('nodes');
        return;
      }
      // Segments.
      const [lx, ly] = local(ev.x, ev.y);
      const near = Path.nearest(o.subs, lx, ly);
      if (near) {
        const np = M2.apply(W, near.x, near.y);
        const sp = app.canvas.toScreen(np[0], np[1]);
        if (Math.hypot(sp[0] - ev.sx, sp[1] - ev.sy) <= 6) {
          const sub = o.subs[near.sub];
          const a = near.seg;
          const b = (near.seg + 1) % sub.nodes.length;
          if (!ev.shift) this.sel = new Set();
          this.sel.add(key(near.sub, a));
          this.sel.add(key(near.sub, b));
          this.s = { mode: 'segment', near, local, x0: ev.x, y0: ev.y, orig: Path.clone(o.subs), moved: false };
          app.setDraft([o.id]);
          app.requestOverlay();
          app.bus.emit('nodes');
          return;
        }
      }
      if (hitId && hitId !== o.id && Doc.isShape(app.get(hitId))) {
        app.setSelection([hitId]);
        this.sel = new Set();
        return;
      }
      if (!ev.shift) this.sel = new Set();
      this.s = { mode: 'band', x0: ev.x, y0: ev.y, x1: ev.x, y1: ev.y };
      app.bus.emit('nodes');
    },

    move(ev) {
      const app = this.app;
      const s = this.s;
      const o = this.target();
      if (!s || !o) {
        if (!s) app.hover(ev.buttons ? null : app.canvas.idFromTarget(ev.target, true));
        return;
      }
      if (s.mode === 'band') {
        s.x1 = ev.x;
        s.y1 = ev.y;
        app.requestOverlay();
        return;
      }
      const sn = Snap.point(app, ev.x, ev.y, { exclude: new Set([o.id]) });
      const [lx, ly] = s.local(sn.x, sn.y);
      if (s.mode === 'param') {
        const h = s.h;
        const org = s.orig;
        if (h.id === 'r') o.r = Math.max(0, Math.min(lx - org.x, org.w / 2, org.h / 2));
        else if (h.id === 'rx') o.rx = Math.max(0.5, Math.abs(lx - org.cx));
        else if (h.id === 'ry') o.ry = Math.max(0.5, Math.abs(ly - org.cy));
        else if (h.id === 'tip') {
          o.r1 = Math.max(1, Math.hypot(lx - org.cx, ly - org.cy));
          let rot = V3D.U.deg(Math.atan2(ly - org.cy, lx - org.cx)) + 90;
          if (ev.shift) rot = Math.round(rot / 15) * 15;
          o.rot = rot;
          o.r2 = (org.r2 / org.r1) * o.r1;
        } else if (h.id === 'inner') o.r2 = Math.max(0.5, Math.hypot(lx - org.cx, ly - org.cy));
        app.touch(o);
        app.requestRender();
        return;
      }
      if (s.mode === 'handle') {
        const nd = o.subs[s.h.si].nodes[s.h.ni];
        const alt = ev.alt || s.alt;
        if (s.h.which === 'in') {
          nd.ix = lx;
          nd.iy = ly;
        } else {
          nd.ox = lx;
          nd.oy = ly;
        }
        if (alt) nd.t = 'c';
        else if (nd.t === 'z' || nd.t === 's') {
          const [hx, hy] = s.h.which === 'in' ? [nd.ix, nd.iy] : [nd.ox, nd.oy];
          const vx = nd.x - hx;
          const vy = nd.y - hy;
          const vl = Math.hypot(vx, vy) || 1;
          const other = s.h.which === 'in' ? [nd.ox, nd.oy] : [nd.ix, nd.iy];
          const ol = nd.t === 'z' ? vl : Math.hypot(other[0] - nd.x, other[1] - nd.y);
          const ox = nd.x + (vx / vl) * ol;
          const oy = nd.y + (vy / vl) * ol;
          if (s.h.which === 'in') {
            nd.ox = ox;
            nd.oy = oy;
          } else {
            nd.ix = ox;
            nd.iy = oy;
          }
        }
        app.touch(o);
        app.requestRender();
        return;
      }
      if (s.mode === 'nodes') {
        const [x0, y0] = s.local(s.x0, s.y0);
        let dx = lx - x0;
        let dy = ly - y0;
        if (ev.shift) {
          if (Math.abs(dx) > Math.abs(dy)) dy = 0;
          else dx = 0;
        }
        o.subs = Path.clone(s.orig);
        for (const k of this.sel) {
          const [si, ni] = parseKey(k);
          const nd = o.subs[si] && o.subs[si].nodes[ni];
          if (!nd) continue;
          nd.x += dx;
          nd.y += dy;
          nd.ix += dx;
          nd.iy += dy;
          nd.ox += dx;
          nd.oy += dy;
        }
        s.moved = true;
        app.touch(o);
        app.requestRender();
        return;
      }
      if (s.mode === 'segment') {
        const n = s.near;
        o.subs = Path.clone(s.orig);
        const sub = o.subs[n.sub];
        const a = sub.nodes[n.seg];
        const b = sub.nodes[(n.seg + 1) % sub.nodes.length];
        const [x0, y0] = s.local(s.x0, s.y0);
        const dx = lx - x0;
        const dy = ly - y0;
        if (!Path.hasOut(a) && !Path.hasIn(b)) {
          a.ox = a.x + (b.x - a.x) / 3;
          a.oy = a.y + (b.y - a.y) / 3;
          b.ix = a.x + ((b.x - a.x) * 2) / 3;
          b.iy = a.y + ((b.y - a.y) * 2) / 3;
        }
        const t = Math.min(0.9, Math.max(0.1, n.t));
        const k = 1 / (3 * t * (1 - t) * ((1 - t) * (1 - t) + t * t));
        a.ox += dx * k * (1 - t);
        a.oy += dy * k * (1 - t);
        b.ix += dx * k * t;
        b.iy += dy * k * t;
        if (a.t === 'c' && Path.hasIn(a)) a.t = 'c';
        s.moved = true;
        app.touch(o);
        app.requestRender();
      }
    },

    up() {
      const app = this.app;
      const s = this.s;
      this.s = null;
      if (!s) return;
      app.setDraft(null);
      const o = this.target();
      if (s.mode === 'band' && o && o.type === 'path') {
        const { scr } = this.geo(o);
        const [a1, b1] = app.canvas.toScreen(Math.min(s.x0, s.x1), Math.min(s.y0, s.y1));
        const [a2, b2] = app.canvas.toScreen(Math.max(s.x0, s.x1), Math.max(s.y0, s.y1));
        o.subs.forEach((sp, si) =>
          sp.nodes.forEach((nd, ni) => {
            const p = scr(nd.x, nd.y);
            if (p[0] >= a1 && p[0] <= a2 && p[1] >= b1 && p[1] <= b2) this.sel.add(key(si, ni));
          })
        );
        app.bus.emit('nodes');
        app.requestOverlay();
        return;
      }
      if (s.mode === 'param') app.commit('Edit shape');
      else if (s.mode === 'handle') app.commit('Move handle');
      else if ((s.mode === 'nodes' || s.mode === 'segment') && s.moved) app.commit(s.mode === 'nodes' ? 'Move nodes' : 'Bend segment');
      app.requestRender();
    },

    cancel() {
      this.s = null;
      this.app.setDraft(null);
    },

    dblclick(ev) {
      const app = this.app;
      const o = this.target();
      if (!o) return;
      if (o.type !== 'path') {
        app.convertToPath([o]);
        return;
      }
      const { W, scr } = this.geo(o);
      // Toggle a node's type…
      for (let si = 0; si < o.subs.length; si++)
        for (let ni = 0; ni < o.subs[si].nodes.length; ni++) {
          const nd = o.subs[si].nodes[ni];
          const p = scr(nd.x, nd.y);
          if (Math.hypot(p[0] - ev.sx, p[1] - ev.sy) <= HANDLE_R) {
            this.sel = new Set([key(si, ni)]);
            this.setType(nd.t === 'c' ? 's' : 'c');
            return;
          }
        }
      // …or insert a node on a segment.
      const Wi = M2.invert(W);
      const [lx, ly] = M2.apply(Wi, ev.x, ev.y);
      const near = Path.nearest(o.subs, lx, ly);
      if (!near) return;
      const np = M2.apply(W, near.x, near.y);
      const sp = app.canvas.toScreen(np[0], np[1]);
      if (Math.hypot(sp[0] - ev.sx, sp[1] - ev.sy) > 8) return;
      const ni = Path.splitSegment(o.subs[near.sub], near.seg, near.t);
      this.sel = new Set([key(near.sub, ni)]);
      app.touch(o);
      app.requestRender();
      app.commit('Add node');
      app.bus.emit('nodes');
    },

    key(e) {
      const o = this.target();
      if (!o || o.type !== 'path') return false;
      if ((e.key === 'Delete' || e.key === 'Backspace') && this.sel.size) {
        this.deleteNodes();
        return true;
      }
      if (V3D.U.modKey(e) && e.key.toLowerCase() === 'a') {
        this.sel = new Set();
        o.subs.forEach((sp, si) => sp.nodes.forEach((_, ni) => this.sel.add(key(si, ni))));
        this.app.requestOverlay();
        this.app.bus.emit('nodes');
        return true;
      }
      if (e.key.startsWith('Arrow') && this.sel.size) {
        const step = (e.shiftKey ? 10 : 1) / this.app.canvas.zoom;
        const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
        const Wi = M2.invert(this.W(o));
        const [dx, dy] = M2.applyVec(Wi, d[0], d[1]);
        for (const k of this.sel) {
          const [si, ni] = parseKey(k);
          const nd = o.subs[si] && o.subs[si].nodes[ni];
          if (!nd) continue;
          for (const [a, b] of [['x', 'y'], ['ix', 'iy'], ['ox', 'oy']]) {
            nd[a] += dx;
            nd[b] += dy;
          }
        }
        this.app.touch(o);
        this.app.requestRender();
        this.app.commitSoon('Nudge nodes');
        return true;
      }
      if (e.key === 'Escape' && this.sel.size) {
        this.sel = new Set();
        this.app.requestOverlay();
        this.app.bus.emit('nodes');
        return true;
      }
      return false;
    },

    /* ----- node operations (also used by the tool controls bar) ----- */
    selectedNodes() {
      const o = this.target();
      if (!o || o.type !== 'path') return [];
      return Array.from(this.sel)
        .map(parseKey)
        .filter(([si, ni]) => o.subs[si] && o.subs[si].nodes[ni])
        .map(([si, ni]) => ({ si, ni, nd: o.subs[si].nodes[ni], sub: o.subs[si] }));
    },
    setType(t) {
      const o = this.target();
      if (!o || o.type !== 'path') return;
      for (const { nd, sub, ni } of this.selectedNodes()) {
        nd.t = t;
        if (t === 'c') continue;
        const n = sub.nodes.length;
        const prev = sub.nodes[(ni - 1 + n) % n];
        const next = sub.nodes[(ni + 1) % n];
        let tx = next.x - prev.x;
        let ty = next.y - prev.y;
        if (Path.hasIn(nd) && Path.hasOut(nd)) {
          tx = nd.ox - nd.ix;
          ty = nd.oy - nd.iy;
        }
        const tl = Math.hypot(tx, ty) || 1;
        tx /= tl;
        ty /= tl;
        const li = Path.hasIn(nd) ? Math.hypot(nd.ix - nd.x, nd.iy - nd.y) : Math.hypot(prev.x - nd.x, prev.y - nd.y) / 3;
        const lo = Path.hasOut(nd) ? Math.hypot(nd.ox - nd.x, nd.oy - nd.y) : Math.hypot(next.x - nd.x, next.y - nd.y) / 3;
        const L = t === 'z' ? (li + lo) / 2 : null;
        nd.ix = nd.x - tx * (L || li);
        nd.iy = nd.y - ty * (L || li);
        nd.ox = nd.x + tx * (L || lo);
        nd.oy = nd.y + ty * (L || lo);
      }
      this.app.touch(o);
      this.app.requestRender();
      this.app.commit('Node type');
    },
    segments(kind) {
      const o = this.target();
      if (!o || o.type !== 'path') return;
      for (const { si, ni } of this.selectedNodes()) {
        const sub = o.subs[si];
        const n = sub.nodes.length;
        const nj = (ni + 1) % n;
        if (!this.sel.has(key(si, nj)) || (!sub.closed && nj === 0)) continue;
        const a = sub.nodes[ni];
        const b = sub.nodes[nj];
        if (kind === 'line') {
          a.ox = a.x;
          a.oy = a.y;
          b.ix = b.x;
          b.iy = b.y;
          a.t = 'c';
          b.t = 'c';
        } else if (!Path.hasOut(a) && !Path.hasIn(b)) {
          a.ox = a.x + (b.x - a.x) / 3;
          a.oy = a.y + (b.y - a.y) / 3;
          b.ix = a.x + ((b.x - a.x) * 2) / 3;
          b.iy = a.y + ((b.y - a.y) * 2) / 3;
        }
      }
      this.app.touch(o);
      this.app.requestRender();
      this.app.commit(kind === 'line' ? 'Make lines' : 'Make curves');
    },
    insertNodes() {
      const o = this.target();
      if (!o || o.type !== 'path') return;
      const picks = this.selectedNodes().sort((p, q) => q.si - p.si || q.ni - p.ni);
      const next = new Set();
      for (const { si, ni, sub } of picks) {
        const n = sub.nodes.length;
        const nj = (ni + 1) % n;
        if (!this.sel.has(key(si, nj)) || (!sub.closed && nj === 0)) continue;
        const idx = Path.splitSegment(sub, ni, 0.5);
        next.add(key(si, idx));
      }
      if (next.size) this.sel = next;
      this.app.touch(o);
      this.app.requestRender();
      this.app.commit('Add nodes');
      this.app.bus.emit('nodes');
    },
    deleteNodes() {
      const app = this.app;
      const o = this.target();
      if (!o || o.type !== 'path') return;
      const bySub = new Map();
      for (const { si, ni } of this.selectedNodes()) (bySub.get(si) || bySub.set(si, []).get(si)).push(ni);
      for (const [si, list] of bySub) {
        const sub = o.subs[si];
        sub.nodes = sub.nodes.filter((_, i) => !list.includes(i));
      }
      o.subs = o.subs.filter((sp) => sp.nodes.length >= 2);
      this.sel = new Set();
      if (!o.subs.length) {
        app.deleteSelection();
        return;
      }
      app.touch(o);
      app.requestRender();
      app.commit('Delete nodes');
      app.bus.emit('nodes');
    },
    breakAtNodes() {
      const o = this.target();
      if (!o || o.type !== 'path') return;
      const picks = this.selectedNodes();
      if (!picks.length) return;
      const { si, ni, sub } = picks[0];
      const nodes = sub.nodes;
      let pieces;
      if (sub.closed) {
        const rot = nodes.slice(ni).concat(nodes.slice(0, ni));
        const end = Object.assign({}, rot[0]);
        rot[0] = Object.assign({}, rot[0], { ix: rot[0].x, iy: rot[0].y });
        end.ox = end.x;
        end.oy = end.y;
        pieces = [{ closed: false, nodes: rot.concat([end]) }];
      } else {
        if (ni === 0 || ni === nodes.length - 1) return;
        const a = nodes.slice(0, ni + 1).map((n) => ({ ...n }));
        const b = nodes.slice(ni).map((n) => ({ ...n }));
        a[a.length - 1].ox = a[a.length - 1].x;
        a[a.length - 1].oy = a[a.length - 1].y;
        b[0].ix = b[0].x;
        b[0].iy = b[0].y;
        pieces = [
          { closed: false, nodes: a },
          { closed: false, nodes: b },
        ];
      }
      o.subs.splice(si, 1, ...pieces);
      this.sel = new Set();
      this.app.touch(o);
      this.app.requestRender();
      this.app.commit('Break path');
      this.app.bus.emit('nodes');
    },
    joinNodes() {
      const o = this.target();
      if (!o || o.type !== 'path') return;
      const picks = this.selectedNodes().filter(({ sub, ni }) => !sub.closed && (ni === 0 || ni === sub.nodes.length - 1));
      if (picks.length !== 2) {
        this.app.toast('Select two end nodes to join');
        return;
      }
      const [p, q] = picks;
      if (p.si === q.si) {
        p.sub.closed = true;
      } else {
        let a = p.sub.nodes;
        let b = q.sub.nodes;
        if (p.ni === 0) a = Path.reverse([{ closed: false, nodes: a }])[0].nodes;
        if (q.ni !== 0) b = Path.reverse([{ closed: false, nodes: b }])[0].nodes;
        const merged = { closed: false, nodes: a.concat(b) };
        const keep = o.subs.filter((_, i) => i !== p.si && i !== q.si);
        o.subs = keep.concat([merged]);
      }
      this.sel = new Set();
      this.app.touch(o);
      this.app.requestRender();
      this.app.commit('Join nodes');
      this.app.bus.emit('nodes');
    },
    toggleClosed() {
      const o = this.target();
      if (!o || o.type !== 'path') return;
      const subs = new Set(this.selectedNodes().map((p) => p.si));
      if (!subs.size) o.subs.forEach((_, i) => subs.add(i));
      for (const si of subs) o.subs[si].closed = !o.subs[si].closed;
      this.app.touch(o);
      this.app.requestRender();
      this.app.commit('Open/close path');
    },

    overlay() {
      const app = this.app;
      const o = this.target();
      let out = '';
      const s = this.s;
      if (!o) return out;
      const { W, scr } = this.geo(o);
      const subs = Doc.worldSubs(o, app.parentMatrix(o.id));
      // Outline of the editable path, mapped to screen.
      const c = app.canvas;
      const screenSubs = Path.transform(subs, [c.zoom, 0, 0, c.zoom, c.x, c.y]);
      out += `<path d="${Path.toD(screenSubs, 1)}" class="ov-path"/>`;
      if (o.type !== 'path') {
        for (const h of this.paramHandles(o)) {
          const p = scr(h.x, h.y);
          out += `<circle cx="${fmt(p[0], 1)}" cy="${fmt(p[1], 1)}" r="5.5" class="ov-param"><title>${h.tip}</title></circle>`;
        }
        return out;
      }
      for (const h of this.visibleHandles(o)) {
        const nd = o.subs[h.si].nodes[h.ni];
        const a = scr(nd.x, nd.y);
        const b = h.which === 'in' ? scr(nd.ix, nd.iy) : scr(nd.ox, nd.oy);
        out += `<line x1="${fmt(a[0], 1)}" y1="${fmt(a[1], 1)}" x2="${fmt(b[0], 1)}" y2="${fmt(b[1], 1)}" class="ov-hline"/><circle cx="${fmt(b[0], 1)}" cy="${fmt(b[1], 1)}" r="3.5" class="ov-hdot"/>`;
      }
      o.subs.forEach((sp, si) =>
        sp.nodes.forEach((nd, ni) => {
          const p = scr(nd.x, nd.y);
          const cls = this.sel.has(key(si, ni)) ? 'ov-node sel' : 'ov-node';
          if (nd.t === 'c') out += `<rect x="${fmt(p[0] - 4, 1)}" y="${fmt(p[1] - 4, 1)}" width="8" height="8" class="${cls}"/>`;
          else if (nd.t === 'z') out += `<path d="M${fmt(p[0], 1)} ${fmt(p[1] - 5.5, 1)}l5.5 5.5l-5.5 5.5l-5.5 -5.5Z" class="${cls}"/>`;
          else out += `<circle cx="${fmt(p[0], 1)}" cy="${fmt(p[1], 1)}" r="4.5" class="${cls}"/>`;
        })
      );
      if (s && s.mode === 'band') {
        const [x1, y1] = c.toScreen(Math.min(s.x0, s.x1), Math.min(s.y0, s.y1));
        const [x2, y2] = c.toScreen(Math.max(s.x0, s.x1), Math.max(s.y0, s.y1));
        out += `<rect x="${x1}" y="${y1}" width="${x2 - x1}" height="${y2 - y1}" class="ov-band"/>`;
      }
      void W;
      return out;
    },
  };
})();
