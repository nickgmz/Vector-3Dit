/* Vector 3Dit — polygon utilities: orientation, containment, simplification, offsetting, clipping. */
(function () {
  'use strict';
  const V3D = globalThis.V3D;
  const Poly = (V3D.Poly = {});

  /** Signed area (positive = counter-clockwise in a y-up frame). */
  Poly.area = (pts) => {
    let a = 0;
    for (let i = 0, n = pts.length, j = n - 1; i < n; j = i++) a += (pts[j][0] - pts[i][0]) * (pts[j][1] + pts[i][1]);
    return a / 2;
  };

  Poly.bbox = (pts) => {
    const r = V3D.Rect.empty();
    for (const p of pts) V3D.Rect.addPoint(r, p[0], p[1]);
    return r;
  };

  Poly.contains = (pts, x, y) => {
    let inside = false;
    for (let i = 0, n = pts.length, j = n - 1; i < n; j = i++) {
      const xi = pts[i][0];
      const yi = pts[i][1];
      const xj = pts[j][0];
      const yj = pts[j][1];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };

  /** A point strictly inside the polygon (for containment tests between contours). */
  Poly.interiorPoint = (pts) => {
    // Try the midpoints of short chords across the first edges.
    const n = pts.length;
    const sgn = Poly.area(pts) >= 0 ? 1 : -1;
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const l = Math.hypot(dx, dy);
      if (l < 1e-9) continue;
      const eps = Math.max(1e-4, l * 1e-3);
      // Left normal points inside for CCW (y-up math convention).
      const x = (a[0] + b[0]) / 2 + (-dy / l) * eps * sgn;
      const y = (a[1] + b[1]) / 2 + (dx / l) * eps * sgn;
      if (Poly.contains(pts, x, y)) return [x, y];
    }
    return pts[0];
  };

  /**
   * Groups contours into solids with holes using even-odd nesting depth.
   * contours: [[x,y]...] (closed). Returns { rings: [{pts, hole, depth, parent}] }
   * with outer rings counter-clockwise and holes clockwise (y-up frame).
   */
  Poly.classify = (contours) => {
    const rings = contours
      .filter((c) => c.length >= 3 && Math.abs(Poly.area(c)) > 1e-9)
      .map((pts) => ({ pts, bbox: Poly.bbox(pts), absArea: Math.abs(Poly.area(pts)) }));
    for (const r of rings) {
      const p = Poly.interiorPoint(r.pts);
      r.depth = 0;
      r.parent = null;
      let best = Infinity;
      for (const o of rings) {
        if (o === r || o.absArea < r.absArea) continue;
        if (!V3D.Rect.contains(o.bbox, r.bbox)) continue;
        if (Poly.contains(o.pts, p[0], p[1])) {
          r.depth++;
          if (o.absArea < best) {
            best = o.absArea;
            r.parent = o;
          }
        }
      }
      r.hole = r.depth % 2 === 1;
      const a = Poly.area(r.pts);
      if ((a > 0) === r.hole) r.pts = r.pts.slice().reverse();
    }
    // Holes attach to their nearest solid ancestor.
    for (const r of rings) {
      if (!r.hole) continue;
      let p = r.parent;
      while (p && p.hole) p = p.parent;
      r.parent = p;
    }
    return rings;
  };

  /**
   * Nesting depth and direct container of each polygon (null entries are skipped).
   * Returns [{ depth, parent }] aligned with the input.
   */
  Poly.nesting = (polys) => {
    const info = polys.map((p) => (p && p.length >= 3 ? { bbox: Poly.bbox(p), area: Math.abs(Poly.area(p)), pt: Poly.interiorPoint(p) } : null));
    return polys.map((p, i) => {
      const me = info[i];
      if (!me) return { depth: 0, parent: null };
      let depth = 0;
      let parent = null;
      let best = Infinity;
      polys.forEach((q, j) => {
        const o = info[j];
        if (j === i || !o || o.area < me.area || !V3D.Rect.contains(o.bbox, me.bbox)) return;
        if (Poly.contains(q, me.pt[0], me.pt[1])) {
          depth++;
          if (o.area < best) {
            best = o.area;
            parent = j;
          }
        }
      });
      return { depth, parent };
    });
  };

  /** Ramer–Douglas–Peucker simplification of an open polyline. */
  Poly.rdp = (pts, eps) => {
    if (pts.length < 3) return pts.slice();
    const keep = new Uint8Array(pts.length);
    keep[0] = keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
      const [s, e] = stack.pop();
      let md = -1;
      let mi = -1;
      const ax = pts[s][0];
      const ay = pts[s][1];
      const bx = pts[e][0];
      const by = pts[e][1];
      const dx = bx - ax;
      const dy = by - ay;
      const L = Math.hypot(dx, dy);
      for (let i = s + 1; i < e; i++) {
        const d = L < 1e-12 ? Math.hypot(pts[i][0] - ax, pts[i][1] - ay) : Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / L;
        if (d > md) {
          md = d;
          mi = i;
        }
      }
      if (md > eps) {
        keep[mi] = 1;
        stack.push([s, mi], [mi, e]);
      }
    }
    return pts.filter((_, i) => keep[i]);
  };

  Poly.distToSeg = (px, py, ax, ay, bx, by) => {
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const x = ax + t * dx - px;
    const y = ay + t * dy - py;
    return Math.sqrt(x * x + y * y);
  };

  /** Distance along ray (ox,oy)+t(dx,dy) to segment ab, or Infinity. */
  Poly.raySeg = (ox, oy, dx, dy, ax, ay, bx, by) => {
    const ex = bx - ax;
    const ey = by - ay;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-12) return Infinity;
    const t = ((ax - ox) * ey - (ay - oy) * ex) / den;
    const u = ((ax - ox) * dy - (ay - oy) * dx) / den;
    return t > 1e-9 && u >= -1e-9 && u <= 1 + 1e-9 ? t : Infinity;
  };

  /**
   * Per-vertex inward miter vectors for rings in the classify() orientation
   * (material always on the left of travel). Returns [[mx,my], ...].
   */
  Poly.miters = (pts, limit = 4) => {
    const n = pts.length;
    const out = new Array(n);
    for (let i = 0; i < n; i++) {
      const p = pts[(i - 1 + n) % n];
      const c = pts[i];
      const q = pts[(i + 1) % n];
      let ax = c[0] - p[0];
      let ay = c[1] - p[1];
      let bx = q[0] - c[0];
      let by = q[1] - c[1];
      const la = Math.hypot(ax, ay) || 1;
      const lb = Math.hypot(bx, by) || 1;
      ax /= la;
      ay /= la;
      bx /= lb;
      by /= lb;
      // Left normals.
      const n1x = -ay;
      const n1y = ax;
      const n2x = -by;
      const n2y = bx;
      let mx = n1x + n2x;
      let my = n1y + n2y;
      const ml = Math.hypot(mx, my);
      if (ml < 1e-6) {
        // 180° reversal: push along the edge normal.
        out[i] = [n1x, n1y];
        continue;
      }
      mx /= ml;
      my /= ml;
      const cosHalf = mx * n1x + my * n1y;
      const s = 1 / Math.max(cosHalf, 1 / limit);
      out[i] = [mx * s, my * s];
    }
    return out;
  };

  /**
   * Maximum safe inward offset per vertex of a set of rings, found by casting
   * each miter ray against all edges. Keeps bevels from folding through thin parts.
   */
  Poly.maxInset = (rings, miters) => {
    const edges = [];
    rings.forEach((r) => {
      const n = r.length;
      for (let i = 0; i < n; i++) edges.push(r[i], r[(i + 1) % n]);
    });
    return rings.map((r, ri) => {
      const n = r.length;
      const res = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        const m = miters[ri][i];
        const ml = Math.hypot(m[0], m[1]) || 1;
        const dx = m[0] / ml;
        const dy = m[1] / ml;
        let best = Infinity;
        const px = r[i][0];
        const py = r[i][1];
        for (let k = 0; k < edges.length; k += 2) {
          const a = edges[k];
          const b = edges[k + 1];
          if (a === r[i] || b === r[i]) continue;
          const t = Poly.raySeg(px, py, dx, dy, a[0], a[1], b[0], b[1]);
          if (t < best) best = t;
        }
        res[i] = (best * 0.5) / ml;
      }
      return res;
    });
  };

  /**
   * Offsets a ring inward by `o` (negative = outward) using precomputed miters,
   * clamping each vertex to `limits` and collapsing reversed edges so the ring
   * never loops over itself. Vertex count is preserved.
   */
  Poly.offsetRing = (pts, miters, o, limits) => {
    const n = pts.length;
    const out = new Array(n);
    for (let i = 0; i < n; i++) {
      let d = o;
      if (limits && d > 0 && d > limits[i]) d = limits[i];
      out[i] = [pts[i][0] + miters[i][0] * d, pts[i][1] + miters[i][1] * d];
    }
    if (Math.abs(o) < 1e-9) return out;
    // Collapse edges that flipped direction (swallowtails at tight curves).
    for (let pass = 0; pass < 6; pass++) {
      let changed = false;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const ox = pts[j][0] - pts[i][0];
        const oy = pts[j][1] - pts[i][1];
        const nx = out[j][0] - out[i][0];
        const ny = out[j][1] - out[i][1];
        if (ox * nx + oy * ny < -1e-9) {
          const mx = (out[i][0] + out[j][0]) / 2;
          const my = (out[i][1] + out[j][1]) / 2;
          out[i] = [mx, my];
          out[j] = [mx, my];
          changed = true;
        }
      }
      if (!changed) break;
    }
    return out;
  };

  /** Sutherland–Hodgman clip against the half-plane x >= x0 (keep = +1) or x <= x0 (keep = -1). */
  Poly.clipX = (pts, x0, keep = 1) => {
    const inside = (p) => (keep > 0 ? p[0] >= x0 - 1e-9 : p[0] <= x0 + 1e-9);
    const out = [];
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      const ia = inside(a);
      const ib = inside(b);
      if (ia) out.push(a);
      if (ia !== ib) {
        const t = (x0 - a[0]) / (b[0] - a[0]);
        out.push([x0, a[1] + (b[1] - a[1]) * t]);
      }
    }
    return out;
  };

  /** Removes consecutive duplicate points (and a duplicate closing point). */
  Poly.dedupe = (pts, eps = 1e-7, closed = true) => {
    const out = [];
    for (const p of pts) {
      const l = out[out.length - 1];
      if (!l || Math.abs(l[0] - p[0]) > eps || Math.abs(l[1] - p[1]) > eps) out.push(p);
    }
    if (closed && out.length > 1) {
      const f = out[0];
      const l = out[out.length - 1];
      if (Math.abs(l[0] - f[0]) <= eps && Math.abs(l[1] - f[1]) <= eps) out.pop();
    }
    return out;
  };

  Poly.perimeter = (pts, closed = true) => {
    let s = 0;
    for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (closed && pts.length > 2) s += Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]);
    return s;
  };
})();
