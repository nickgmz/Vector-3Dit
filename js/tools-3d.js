/* Vector 3Dit — 3D tools: Orbit (rotate objects in 3D by dragging) and Light (aim the light). */
(function () {
  'use strict';
  const V3D = globalThis.V3D;
  const { M3, V3, Doc, R3D } = V3D;
  const { fmt, clamp } = V3D.U;
  const Tools = (V3D.Tools = V3D.Tools || {});

  Tools.orbit = {
    id: 'orbit',
    name: '3D orbit',
    shortcut: 'O',
    cursor: 'grab',
    hint: 'Drag a shape to spin it in 3D. Flat shapes are extruded automatically. Shift locks to one axis, Alt spins in the drawing plane.',
    s: null,
    down(ev) {
      const app = this.app;
      const id = app.canvas.idFromTarget(ev.target, false);
      if (id && !app.sel.includes(id)) app.setSelection([id]);
      const objs = app.fxTargets();
      if (!objs.length) {
        if (!id) app.toast('Select a shape, then drag to rotate it in 3D');
        else app.toast('Images can’t be rotated in 3D — trace them into shapes first.');
        return;
      }
      let added = false;
      const pivots = app.groupPivots();
      for (const o of objs)
        if (!o.fx) {
          const b = app.bboxOf(o);
          o.fx = R3D.defaults('extrude', b ? Math.max(V3D.Rect.w(b), V3D.Rect.h(b)) * (o.type === 'text' ? 0.55 : 1) : 200);
          o.fx.rx = 0;
          o.fx.ry = 0;
          app.setPivot(o, pivots.get(o.id));
          app.touch(o);
          added = true;
        }
      if (added) app.toast('Extruded — keep dragging to rotate');
      this.s = {
        sx: ev.sx,
        sy: ev.sy,
        objs,
        R0: new Map(objs.map((o) => [o.id, M3.fromEuler(o.fx.rx, o.fx.ry, o.fx.rz)])),
        moved: false,
      };
      app.setDraft(objs.map((o) => o.id));
      app.canvas.stage.classList.add('grabbing');
      app.bus.emit('fx');
    },
    move(ev) {
      const app = this.app;
      const s = this.s;
      if (!s) {
        app.hover(ev.buttons ? null : app.canvas.idFromTarget(ev.target, false));
        return;
      }
      let dx = ev.sx - s.sx;
      let dy = ev.sy - s.sy;
      if (ev.shift) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      const k = 0.45;
      let Rd;
      if (ev.alt) Rd = M3.rotZ(-dx * k);
      else Rd = M3.mul(M3.rotX(dy * k), M3.rotY(dx * k));
      for (const o of s.objs) {
        const e = M3.toEuler(M3.mul(Rd, s.R0.get(o.id)));
        o.fx.rx = e.rx;
        o.fx.ry = e.ry;
        o.fx.rz = e.rz;
        app.touch(o);
      }
      s.moved = true;
      const f = s.objs[0].fx;
      app.status(`Tilt ${fmt(f.rx, 1)}°   Turn ${fmt(f.ry, 1)}°   Spin ${fmt(f.rz, 1)}°`, true);
      app.requestRender();
      app.bus.emit('fx');
    },
    up() {
      const app = this.app;
      const s = this.s;
      this.s = null;
      app.canvas.stage.classList.remove('grabbing');
      app.setDraft(null);
      app.status(null);
      if (s) app.commit(s.moved ? 'Rotate in 3D' : 'Make 3D');
      app.bus.emit('fx');
    },
    cancel() {
      if (this.s) {
        for (const o of this.s.objs) {
          const e = M3.toEuler(this.s.R0.get(o.id));
          Object.assign(o.fx, { rx: e.rx, ry: e.ry, rz: e.rz });
          this.app.touch(o);
        }
      }
      this.s = null;
      this.app.setDraft(null);
    },
    overlay() {
      const app = this.app;
      let out = '';
      for (const o of app.fxTargets(true).slice(0, 12)) {
        const b = app.bboxOf(o);
        if (!b) continue;
        const [cx, cy] = app.canvas.toScreen(V3D.Rect.cx(b), V3D.Rect.cy(b));
        const r = Math.max(26, Math.min(70, (Math.max(V3D.Rect.w(b), V3D.Rect.h(b)) * app.canvas.zoom) / 4));
        out += `<circle cx="${fmt(cx, 1)}" cy="${fmt(cy, 1)}" r="${fmt(r * 1.25, 1)}" class="ov-orbit"/>`;
        const axes = R3D.axes(o.fx.rx, o.fx.ry, o.fx.rz).sort((a, c) => a.z - c.z);
        for (const a of axes) {
          const x2 = cx + a.x * r;
          const y2 = cy + a.y * r;
          out += `<line x1="${fmt(cx, 1)}" y1="${fmt(cy, 1)}" x2="${fmt(x2, 1)}" y2="${fmt(y2, 1)}" class="ov-axis ax-${a.axis}"/><circle cx="${fmt(x2, 1)}" cy="${fmt(y2, 1)}" r="3.5" class="ov-axdot ax-${a.axis}"/>`;
        }
      }
      return out;
    },
  };

  Tools.light = {
    id: 'light',
    name: 'Light',
    shortcut: 'L',
    cursor: 'crosshair',
    hint: 'Drag around a 3D shape to aim the light. The middle lights it from the front, the circle’s edge gives a raking side light, and beyond the circle the light moves behind it.',
    s: null,
    center() {
      const app = this.app;
      const b = app.selectionBBox() || { x: 0, y: 0, x2: app.doc.width, y2: app.doc.height };
      const [cx, cy] = app.canvas.toScreen(V3D.Rect.cx(b), V3D.Rect.cy(b));
      const r = Math.max(110, Math.min(260, (Math.max(V3D.Rect.w(b), V3D.Rect.h(b)) * app.canvas.zoom) / 2));
      return { cx, cy, r };
    },
    /** The light settings object the tool edits: the scene light unless the target uses its own. */
    targetLight() {
      const app = this.app;
      const o = app.fxTargets(true).pop();
      if (o && o.fx.useSceneLight === false) return { light: o.fx.light, scene: false, obj: o };
      return { light: app.doc.scene.light, scene: true };
    },
    apply(ev) {
      const app = this.app;
      const { cx, cy, r } = this.center();
      let x = (ev.sx - cx) / r;
      let y = -(ev.sy - cy) / r;
      const d = Math.hypot(x, y);
      let z;
      if (d <= 1) z = Math.sqrt(1 - d * d);
      else {
        const k = Math.min(d, 2);
        x /= d;
        y /= d;
        const behind = k - 1;
        z = -behind;
        const s = Math.sqrt(Math.max(0, 1 - z * z));
        x *= s;
        y *= s;
      }
      const a = V3.toAngles([x, y, z]);
      const t = this.targetLight();
      t.light.az = Math.round(a.az);
      t.light.el = Math.round(clamp(a.el, -89, 89));
      if (t.scene) app.sceneChanged();
      else app.touch(t.obj);
      app.requestRender();
      app.bus.emit('fx');
      app.status(`Light  direction ${t.light.az}°  height ${t.light.el}°${t.scene ? '  (all objects)' : ''}`, true);
    },
    down(ev) {
      const app = this.app;
      if (!app.all3DIds().length) {
        app.toast('Make a shape 3D first — the light only affects 3D objects');
        return;
      }
      const t = this.targetLight();
      this.s = { moved: false };
      app.setDraft(t.scene ? app.all3DIds() : [t.obj.id]);
      this.apply(ev);
    },
    move(ev) {
      this.pointer = [ev.sx, ev.sy];
      if (this.s) this.apply(ev);
      this.app.requestOverlay();
    },
    up() {
      const app = this.app;
      if (!this.s) return;
      this.s = null;
      app.setDraft(null);
      app.status(null);
      app.commit('Move light');
    },
    cancel() {
      this.s = null;
      this.app.setDraft(null);
    },
    overlay() {
      const { cx, cy, r } = this.center();
      const t = this.targetLight();
      const L = V3.fromAngles(t.light.az, t.light.el);
      let px = cx + L[0] * r;
      let py = cy - L[1] * r;
      if (L[2] < 0) {
        const d = Math.hypot(L[0], L[1]) || 1;
        const k = 1 + -L[2];
        px = cx + (L[0] / d) * r * k;
        py = cy - (L[1] / d) * r * k;
      }
      let out = `<circle cx="${fmt(cx, 1)}" cy="${fmt(cy, 1)}" r="${fmt(r, 1)}" class="ov-orbit"/><circle cx="${fmt(cx, 1)}" cy="${fmt(cy, 1)}" r="${fmt(r * 2, 1)}" class="ov-orbit faint"/>`;
      out += `<line x1="${fmt(px, 1)}" y1="${fmt(py, 1)}" x2="${fmt(cx, 1)}" y2="${fmt(cy, 1)}" class="ov-lightray"/>`;
      out += `<g transform="translate(${fmt(px, 1)} ${fmt(py, 1)})" class="ov-sun"><circle r="8"/>${[0, 45, 90, 135, 180, 225, 270, 315]
        .map((a) => {
          const c = Math.cos((a * Math.PI) / 180);
          const s = Math.sin((a * Math.PI) / 180);
          return `<line x1="${fmt(c * 11, 1)}" y1="${fmt(s * 11, 1)}" x2="${fmt(c * 15, 1)}" y2="${fmt(s * 15, 1)}"/>`;
        })
        .join('')}</g>`;
      return out;
    },
  };
})();
