/* Vector 3Dit — snapping to grid (square or isometric), page and object bounds. */
(function () {
  'use strict';
  const V3D = globalThis.V3D;
  const Snap = (V3D.Snap = {});

  /** Nearest grid point. */
  Snap.gridPoint = (prefs, x, y) => {
    const s = prefs.gridSize || 20;
    if (prefs.grid === 'iso') {
      const hw = (s * Math.sqrt(3)) / 2; // lattice step in x
      const hh = s / 2; // lattice step in y
      const i0 = Math.round(x / hw);
      const j0 = Math.round(y / hh);
      let best = null;
      for (let i = i0 - 1; i <= i0 + 1; i++)
        for (let j = j0 - 1; j <= j0 + 1; j++) {
          if ((i + j) % 2 !== 0) continue;
          const px = i * hw;
          const py = j * hh;
          const d = Math.hypot(px - x, py - y);
          if (!best || d < best.d) best = { x: px, y: py, d };
        }
      return best;
    }
    const px = Math.round(x / s) * s;
    const py = Math.round(y / s) * s;
    return { x: px, y: py, d: Math.hypot(px - x, py - y) };
  };

  function targets(app, exclude) {
    const xs = [];
    const ys = [];
    const d = app.doc;
    xs.push(0, d.width / 2, d.width);
    ys.push(0, d.height / 2, d.height);
    if (app.prefs.snapObjects) {
      for (const o of d.objects) {
        if (o.visible === false || (exclude && exclude.has(o.id))) continue;
        const b = app.bboxOf(o);
        if (!b) continue;
        xs.push(b.x, (b.x + b.x2) / 2, b.x2);
        ys.push(b.y, (b.y + b.y2) / 2, b.y2);
      }
    }
    return { xs, ys };
  }

  const nearest = (vals, cands, thr) => {
    let best = null;
    for (const v of vals)
      for (const c of cands) {
        const dd = c - v;
        if (Math.abs(dd) <= thr && (!best || Math.abs(dd) < Math.abs(best.d))) best = { d: dd, at: c };
      }
    return best;
  };

  /** Snaps a single point. Returns { x, y, guides }. */
  Snap.point = (app, x, y, opts = {}) => {
    const thr = (opts.threshold || 7) / app.canvas.zoom;
    const guides = [];
    let rx = x;
    let ry = y;
    if (app.prefs.snapGrid && app.prefs.grid !== 'none') {
      const g = Snap.gridPoint(app.prefs, x, y);
      if (g && g.d <= thr * 1.6) {
        rx = g.x;
        ry = g.y;
        return { x: rx, y: ry, guides, grid: true };
      }
    }
    if (opts.objects === false) return { x, y, guides };
    const t = targets(app, opts.exclude);
    const bx = nearest([x], t.xs, thr);
    const by = nearest([y], t.ys, thr);
    if (bx) {
      rx = x + bx.d;
      guides.push({ v: true, at: bx.at });
    }
    if (by) {
      ry = y + by.d;
      guides.push({ v: false, at: by.at });
    }
    return { x: rx, y: ry, guides };
  };

  /** Snaps a moving box. Returns { dx, dy, guides } corrections. */
  Snap.box = (app, box, exclude) => {
    const thr = 7 / app.canvas.zoom;
    const guides = [];
    let dx = 0;
    let dy = 0;
    if (app.prefs.snapGrid && app.prefs.grid !== 'none') {
      const g = Snap.gridPoint(app.prefs, box.x, box.y);
      if (g && g.d <= thr * 1.6) return { dx: g.x - box.x, dy: g.y - box.y, guides };
    }
    const t = targets(app, exclude);
    const bx = nearest([box.x, (box.x + box.x2) / 2, box.x2], t.xs, thr);
    const by = nearest([box.y, (box.y + box.y2) / 2, box.y2], t.ys, thr);
    if (bx) {
      dx = bx.d;
      guides.push({ v: true, at: bx.at });
    }
    if (by) {
      dy = by.d;
      guides.push({ v: false, at: by.at });
    }
    return { dx, dy, guides };
  };

  /** Overlay markup for guides (screen space). */
  Snap.guideMarkup = (app, guides) => {
    if (!guides || !guides.length) return '';
    const [w, h] = app.canvas.size();
    return guides
      .map((g) => {
        if (g.v) {
          const [sx] = app.canvas.toScreen(g.at, 0);
          return `<line x1="${sx}" y1="0" x2="${sx}" y2="${h}" class="ov-guide"/>`;
        }
        const [, sy] = app.canvas.toScreen(0, g.at);
        return `<line x1="0" y1="${sy}" x2="${w}" y2="${sy}" class="ov-guide"/>`;
      })
      .join('');
  };
})();
