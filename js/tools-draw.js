/* Vector 3Dit — drawing tools: rectangle, ellipse, star/polygon, pen, pencil, text,
 * plus zoom and eyedropper. */
(function () {
  'use strict';
  const V3D = globalThis.V3D;
  const { M2, Path, Doc, Snap } = V3D;
  const { fmt } = V3D.U;
  const Tools = (V3D.Tools = V3D.Tools || {});

  /** Shared drag-to-create behaviour for primitive shapes. */
  function shapeTool(def) {
    return Object.assign(
      {
        cursor: 'crosshair',
        s: null,
        down(ev) {
          const app = this.app;
          const sn = Snap.point(app, ev.x, ev.y);
          this.s = { x0: sn.x, y0: sn.y, sx0: ev.sx, sy0: ev.sy, obj: null, guides: sn.guides };
        },
        move(ev) {
          const app = this.app;
          const s = this.s;
          if (!s) {
            const sn = Snap.point(app, ev.x, ev.y);
            this.hoverGuides = sn.guides;
            app.requestOverlay();
            return;
          }
          if (!s.obj && Math.hypot(ev.sx - s.sx0, ev.sy - s.sy0) < 3) return;
          const sn = Snap.point(app, ev.x, ev.y, { exclude: s.obj ? new Set([s.obj.id]) : null });
          s.guides = sn.guides;
          let x1 = sn.x;
          let y1 = sn.y;
          if (!s.obj) {
            s.obj = Doc.make(this.type, {}, app.newStyle());
            app.addObject(s.obj, { select: true, commit: false });
          }
          this.shape(s.obj, s.x0, s.y0, x1, y1, ev);
          app.touch(s.obj);
          app.requestRender();
          const b = app.bboxOf(s.obj);
          if (b) app.status(`${Doc.typeName(s.obj)}  ${fmt(V3D.Rect.w(b), 1)} × ${fmt(V3D.Rect.h(b), 1)}`, true);
        },
        up(ev) {
          const app = this.app;
          const s = this.s;
          this.s = null;
          app.status(null);
          if (!s) return;
          if (!s.obj) {
            // A plain click selects whatever is under the pointer.
            const id = app.canvas.idFromTarget(ev.target, false);
            app.setSelection(id ? [id] : []);
            return;
          }
          const b = app.bboxOf(s.obj);
          if (!b || (V3D.Rect.w(b) < 0.5 && V3D.Rect.h(b) < 0.5)) {
            app.removeObjects([s.obj.id], { commit: false });
            return;
          }
          app.commit('Draw ' + Doc.typeName(s.obj).toLowerCase());
        },
        cancel() {
          if (this.s && this.s.obj) this.app.removeObjects([this.s.obj.id], { commit: false });
          this.s = null;
        },
        overlay() {
          const g = this.s ? this.s.guides : this.hoverGuides;
          return Snap.guideMarkup(this.app, g);
        },
      },
      def
    );
  }

  const box = (x0, y0, x1, y1, ev) => {
    let w = x1 - x0;
    let h = y1 - y0;
    if (ev.shift) {
      const m = Math.max(Math.abs(w), Math.abs(h));
      w = Math.sign(w || 1) * m;
      h = Math.sign(h || 1) * m;
    }
    if (ev.alt) return { x: x0 - Math.abs(w), y: y0 - Math.abs(h), w: Math.abs(w) * 2, h: Math.abs(h) * 2 };
    return { x: Math.min(x0, x0 + w), y: Math.min(y0, y0 + h), w: Math.abs(w), h: Math.abs(h) };
  };

  Tools.rect = shapeTool({
    id: 'rect',
    name: 'Rectangle',
    shortcut: 'R',
    type: 'rect',
    hint: 'Drag to draw a rectangle. Shift makes a square, Alt draws from the center. Set rounded corners in the bar above.',
    shape(o, x0, y0, x1, y1, ev) {
      const b = box(x0, y0, x1, y1, ev);
      Object.assign(o, b, { r: this.app.toolOpts.rect.r || 0 });
    },
  });

  Tools.ellipse = shapeTool({
    id: 'ellipse',
    name: 'Ellipse',
    shortcut: 'E',
    type: 'ellipse',
    hint: 'Drag to draw an ellipse. Shift makes a circle, Alt draws from the center.',
    shape(o, x0, y0, x1, y1, ev) {
      const b = box(x0, y0, x1, y1, ev);
      Object.assign(o, { cx: b.x + b.w / 2, cy: b.y + b.h / 2, rx: b.w / 2, ry: b.h / 2 });
    },
  });

  Tools.star = shapeTool({
    id: 'star',
    name: 'Star & polygon',
    shortcut: 'S',
    type: 'star',
    hint: 'Drag from the center outward. Choose star or polygon, corners and sharpness in the bar above. Shift snaps the angle.',
    shape(o, x0, y0, x1, y1, ev) {
      const t = this.app.toolOpts.star;
      const r1 = Math.hypot(x1 - x0, y1 - y0);
      let rot = V3D.U.deg(Math.atan2(y1 - y0, x1 - x0)) + 90;
      if (ev.shift) rot = Math.round(rot / 15) * 15;
      Object.assign(o, { cx: x0, cy: y0, r1, r2: r1 * t.ratio, n: t.n, star: t.star, round: t.round, rot });
    },
  });

  /* ---------- pen ---------- */
  Tools.pen = {
    id: 'pen',
    name: 'Pen',
    shortcut: 'P',
    cursor: 'crosshair',
    hint: 'Click for corners, drag for curves. Click the first point to close the shape. Enter finishes an open line, Backspace removes the last point, Esc cancels.',
    nodes: [],
    drag: null,
    activate() {
      this.nodes = [];
      this.drag = null;
    },
    deactivate() {
      if (this.nodes.length >= 2) this.finish(false);
      this.nodes = [];
    },
    down(ev) {
      const app = this.app;
      const sn = Snap.point(app, ev.x, ev.y);
      const n = this.nodes;
      if (n.length >= 2) {
        const f = app.canvas.toScreen(n[0].x, n[0].y);
        if (Math.hypot(f[0] - ev.sx, f[1] - ev.sy) <= 8) {
          this.finish(true);
          return;
        }
      }
      let x = sn.x;
      let y = sn.y;
      if (ev.shift && n.length) ({ x, y } = constrain(n[n.length - 1], x, y));
      n.push(Path.node(x, y, 'c'));
      this.drag = { node: n[n.length - 1] };
      app.requestOverlay();
    },
    move(ev) {
      const app = this.app;
      this.cursor = [ev.x, ev.y];
      if (this.drag && ev.buttons) {
        const nd = this.drag.node;
        nd.ox = ev.x;
        nd.oy = ev.y;
        nd.ix = 2 * nd.x - ev.x;
        nd.iy = 2 * nd.y - ev.y;
        nd.t = 'z';
      }
      app.requestOverlay();
    },
    up() {
      this.drag = null;
    },
    dblclick() {
      // The double-click's second press added a duplicate point.
      if (this.nodes.length > 2) this.nodes.pop();
      this.finish(false);
    },
    key(e) {
      if (e.key === 'Enter') {
        this.finish(false);
        return true;
      }
      if (e.key === 'Escape') {
        if (this.nodes.length >= 2) this.finish(false);
        this.nodes = [];
        this.app.requestOverlay();
        return true;
      }
      if (e.key === 'Backspace' && this.nodes.length) {
        this.nodes.pop();
        this.app.requestOverlay();
        return true;
      }
      return false;
    },
    finish(closed) {
      const app = this.app;
      const nodes = this.nodes;
      this.nodes = [];
      this.drag = null;
      if (nodes.length < 2) {
        app.requestOverlay();
        return;
      }
      const sub = { closed, nodes };
      Path.inferTypes(sub);
      const style = app.newStyle();
      if (!closed) {
        style.stroke = style.stroke || (typeof style.fill === 'string' ? style.fill : '#1b1c22');
        style.fill = null;
        style.strokeWidth = style.strokeWidth || 3;
      }
      const o = Doc.make('path', { subs: [sub] }, style);
      app.addObject(o, { select: true, commit: true, label: 'Draw path' });
      app.requestOverlay();
    },
    overlay() {
      const app = this.app;
      const c = app.canvas;
      const n = this.nodes;
      if (!n.length) return '';
      const tmp = { closed: false, nodes: n.map((x) => ({ ...x })) };
      if (this.cursor && !this.drag) tmp.nodes.push(Path.node(this.cursor[0], this.cursor[1]));
      const scr = Path.transform([tmp], [c.zoom, 0, 0, c.zoom, c.x, c.y]);
      let out = `<path d="${Path.toD(scr, 1)}" class="ov-path pen"/>`;
      n.forEach((nd, i) => {
        const p = c.toScreen(nd.x, nd.y);
        if (Path.hasOut(nd)) {
          const a = c.toScreen(nd.ix, nd.iy);
          const b = c.toScreen(nd.ox, nd.oy);
          out += `<line x1="${fmt(a[0], 1)}" y1="${fmt(a[1], 1)}" x2="${fmt(b[0], 1)}" y2="${fmt(b[1], 1)}" class="ov-hline"/><circle cx="${fmt(a[0], 1)}" cy="${fmt(a[1], 1)}" r="3" class="ov-hdot"/><circle cx="${fmt(b[0], 1)}" cy="${fmt(b[1], 1)}" r="3" class="ov-hdot"/>`;
        }
        out += `<rect x="${fmt(p[0] - 4, 1)}" y="${fmt(p[1] - 4, 1)}" width="8" height="8" class="ov-node${i === 0 && n.length > 1 ? ' first' : ''}"/>`;
      });
      return out;
    },
  };

  function constrain(prev, x, y) {
    const a = Math.atan2(y - prev.y, x - prev.x);
    const s = Math.round(a / (Math.PI / 4)) * (Math.PI / 4);
    const d = Math.hypot(x - prev.x, y - prev.y);
    return { x: prev.x + Math.cos(s) * d, y: prev.y + Math.sin(s) * d };
  }

  /* ---------- pencil ---------- */
  Tools.pencil = {
    id: 'pencil',
    name: 'Pencil',
    shortcut: 'N',
    cursor: 'crosshair',
    hint: 'Draw freehand. End near your starting point to make a closed shape. Adjust smoothing in the bar above.',
    pts: null,
    down(ev) {
      this.pts = [[ev.x, ev.y]];
      this.start = [ev.sx, ev.sy];
    },
    move(ev) {
      if (!this.pts) return;
      const l = this.pts[this.pts.length - 1];
      if (Math.hypot(ev.x - l[0], ev.y - l[1]) * this.app.canvas.zoom >= 1.5) this.pts.push([ev.x, ev.y]);
      this.last = [ev.sx, ev.sy];
      this.app.requestOverlay();
    },
    up(ev) {
      const app = this.app;
      const pts = this.pts;
      this.pts = null;
      app.requestOverlay();
      if (!pts || pts.length < 3) return;
      const z = app.canvas.zoom;
      const closed = Math.hypot(ev.sx - this.start[0], ev.sy - this.start[1]) < 14 && pts.length > 6;
      const err = (0.6 + app.toolOpts.pencil.smooth * 0.35) / z;
      const segs = closed ? V3D.Fit.closed(pts, err, { cornerDeg: 70, span: 6 / z }) : V3D.Fit.open(pts, err, { cornerDeg: 70, span: 6 / z });
      if (!segs.length) return;
      const subs = Path.fromCubicRuns([{ closed, segs }]);
      const style = app.newStyle();
      if (!closed) {
        style.stroke = style.stroke || (typeof style.fill === 'string' ? style.fill : '#1b1c22');
        style.fill = null;
        style.strokeWidth = style.strokeWidth || 3;
      }
      app.addObject(Doc.make('path', { subs }, style), { select: true, commit: true, label: 'Draw freehand' });
    },
    cancel() {
      this.pts = null;
    },
    overlay() {
      if (!this.pts) return '';
      const c = this.app.canvas;
      return `<path d="M${this.pts.map((p) => c.toScreen(p[0], p[1]).map((v) => fmt(v, 1)).join(' ')).join('L')}" class="ov-path pen"/>`;
    },
  };

  /* ---------- text ---------- */
  Tools.text = {
    id: 'text',
    name: 'Text',
    shortcut: 'T',
    cursor: 'text',
    hint: 'Click to place text, or click existing text to edit it. Text becomes real vector outlines, ready for 3D.',
    down(ev) {
      const app = this.app;
      const id = app.canvas.idFromTarget(ev.target, true);
      const o = id && app.get(id);
      if (o && o.type === 'text') {
        this.edit(o);
        return;
      }
      if (app.ui.textEditorOpen()) {
        app.ui.closeTextEditor();
        return;
      }
      const ts = app.toolOpts.text;
      const t = Doc.make(
        'text',
        { text: '', x: ev.x, y: ev.y + ts.size * 0.35, family: ts.family, size: ts.size, weight: ts.weight, italic: ts.italic, spacing: ts.spacing, align: ts.align },
        app.newStyle()
      );
      app.addObject(t, { select: true, commit: false });
      this.edit(t, true);
    },
    edit(o, isNew) {
      this.app.setSelection([o.id]);
      this.app.ui.openTextEditor(o, isNew);
    },
  };

  /* ---------- zoom ---------- */
  Tools.zoom = {
    id: 'zoom',
    name: 'Zoom',
    shortcut: 'Z',
    cursor: 'zoom-in',
    hint: 'Click to zoom in, Alt-click to zoom out, drag to zoom into an area.',
    down(ev) {
      this.s = { x0: ev.x, y0: ev.y, x1: ev.x, y1: ev.y, sx: ev.sx, sy: ev.sy };
    },
    move(ev) {
      if (!this.s) return;
      this.s.x1 = ev.x;
      this.s.y1 = ev.y;
      this.app.requestOverlay();
    },
    up(ev) {
      const s = this.s;
      this.s = null;
      if (!s) return;
      const r = V3D.Rect.fromPoints(s.x0, s.y0, s.x1, s.y1);
      if (V3D.Rect.w(r) * this.app.canvas.zoom > 8) this.app.canvas.fit(r, 10);
      else this.app.canvas.zoomAt(ev.alt || ev.button === 2 ? 0.5 : 2, ev.sx, ev.sy);
      this.app.requestOverlay();
    },
    overlay() {
      const s = this.s;
      if (!s) return '';
      const c = this.app.canvas;
      const [x1, y1] = c.toScreen(Math.min(s.x0, s.x1), Math.min(s.y0, s.y1));
      const [x2, y2] = c.toScreen(Math.max(s.x0, s.x1), Math.max(s.y0, s.y1));
      return `<rect x="${x1}" y="${y1}" width="${x2 - x1}" height="${y2 - y1}" class="ov-band"/>`;
    },
  };

  Tools.hand = {
    id: 'hand',
    name: 'Hand',
    shortcut: 'H',
    cursor: 'grab',
    hint: 'Drag to pan around. Tip: hold Space with any tool to pan.',
  };

  /* ---------- eyedropper ---------- */
  Tools.eyedropper = {
    id: 'eyedropper',
    name: 'Eyedropper',
    shortcut: 'I',
    cursor: 'copy',
    hint: 'Click any color on the canvas to apply it to the selection (or to new shapes). Shift-click sets the outline color.',
    down(ev) {
      const app = this.app;
      let color = null;
      const t = ev.target;
      if (t && t.getAttribute) {
        const f = t.getAttribute('fill');
        if (f && !f.startsWith('url') && f !== 'none' && f !== 'transparent') color = V3D.Color.normalize(f);
      }
      if (!color) {
        const id = app.canvas.idFromTarget(t, true);
        const o = id && app.get(id);
        if (o && o.style) color = V3D.R3D.solidOf(o.style.fill);
      }
      if (!color) {
        if (t === app.canvas.svg || (t && t.classList && t.classList.contains('page'))) color = app.doc.background || '#ffffff';
      }
      if (!color) return;
      app.applyColor(color, ev.shift ? 'stroke' : 'fill');
      app.toast(`Picked ${color}`);
    },
  };
})();
