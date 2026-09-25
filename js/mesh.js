/* Vector 3Dit — 3D mesh builders.
 * Object space: x right, y up, z toward the viewer. Meshes are centred on the origin.
 * mesh = { verts: [[x,y,z]], faces: [{ loops: [[vi...], ...holes], mat, cap?, ds? }], closed }
 * finalize() adds face normals, centroids, edge adjacency and smooth per-corner normals. */
(function () {
  'use strict';
  const V3D = globalThis.V3D;
  const Poly = V3D.Poly;
  const Mesh = (V3D.Mesh = {});

  /* ---------- bevel profiles: [o, z] from the front edge (o = 1 inset, z = 0) to the side wall (0, 1) ---------- */
  Mesh.bevels = {
    classic: { name: 'Classic', pts: () => [[1, 0], [0, 1]] },
    round: {
      name: 'Round',
      pts: (n) => arc(n, (t) => [1 - Math.sin(t), 1 - Math.cos(t)]),
    },
    cove: {
      name: 'Cove',
      pts: (n) => arc(n, (t) => [Math.cos(t), Math.sin(t)]),
    },
    ogee: {
      name: 'Ogee',
      pts: (n) => {
        const h = Math.max(2, Math.ceil(n / 2));
        const a = arc(h, (t) => [1 - 0.5 * Math.sin(t), 0.5 - 0.5 * Math.cos(t)]);
        const b = arc(h, (t) => [0.5 * Math.cos(t), 0.5 + 0.5 * Math.sin(t)]);
        return a.concat(b.slice(1));
      },
    },
    step: { name: 'Step', pts: () => [[1, 0], [1, 0.5], [0.5, 0.5], [0.5, 1], [0, 1]] },
    chisel: { name: 'Chisel', pts: () => [[1, 0], [0.35, 0.18], [0, 1]] },
  };
  function arc(n, f) {
    const pts = [];
    const steps = Math.max(1, n);
    for (let i = 0; i <= steps; i++) pts.push(f((i / steps) * (Math.PI / 2)));
    return pts;
  }

  /* ---------- inflate profiles: height fraction for t = distance / radius in [0, 1] ---------- */
  Mesh.inflateProfiles = {
    round: { name: 'Round', f: (t) => Math.sqrt(Math.max(0, 1 - (1 - t) * (1 - t))) },
    pillow: { name: 'Pillow', f: (t) => 1 - (1 - t) * (1 - t) },
    dome: { name: 'Dome', f: (t) => Math.sin((t * Math.PI) / 2) },
    soft: { name: 'Soft', f: (t) => t * t * (3 - 2 * t) },
    cone: { name: 'Sharp', f: (t) => t },
  };

  /* ---------- extrude ---------- */
  /**
   * rings: classify() output in object space. open: [[x,y]...] open polylines (ribbons).
   * o: { depth, bevel, bevelW, bevelH, bevelSides: 'front'|'both', bevelOut, bevelSegs, caps }
   */
  Mesh.extrude = (rings, open, o) => {
    const verts = [];
    const faces = [];
    const D = Math.max(0, o.depth || 0);
    const zf = D / 2;
    const zb = -D / 2;
    const hasBevel = o.bevel && o.bevel !== 'none' && Mesh.bevels[o.bevel] && o.bevelW > 0;
    let prof = [];
    let Hb = 0;
    if (hasBevel) {
      Hb = Math.max(0, o.bevelH == null ? o.bevelW : o.bevelH);
      const maxH = o.bevelSides === 'both' ? D / 2 : D;
      if (Hb > maxH) Hb = maxH;
      prof = Mesh.bevels[o.bevel].pts(o.bevelSegs || 4);
    }
    const W = hasBevel ? o.bevelW : 0;
    const off = (ov) => (o.bevelOut ? (ov - 1) * W : ov * W);
    // Ring stack: [offset, z, isBase]. isBase marks where a bevel meets the side wall.
    const stack = [];
    if (hasBevel) {
      prof.forEach(([ov, zv], i) => stack.push([off(ov), zf - zv * Hb, i === prof.length - 1]));
      if (o.bevelSides === 'both') {
        const back = prof.slice().reverse();
        back.forEach(([ov, zv], i) => stack.push([off(ov), zb + zv * Hb, i === 0]));
      } else stack.push([off(0), zb, true]);
    } else {
      stack.push([0, zf, true], [0, zb, true]);
    }
    // Drop consecutive duplicate rings (zero-height bevels on thin extrusions).
    const rs = stack.filter((r, i) => i === 0 || Math.abs(r[0] - stack[i - 1][0]) > 1e-9 || Math.abs(r[1] - stack[i - 1][1]) > 1e-9);

    const allPts = rings.map((r) => r.pts);
    const miters = allPts.map((p) => Poly.miters(p));
    const needsLimit = rs.some((r) => r[0] > 1e-9);
    const limits = needsLimit ? Poly.maxInset(allPts, miters) : null;

    const ringIdx = []; // ringIdx[ri][k] = array of vertex indices
    rings.forEach((ring, ri) => {
      const idx = [];
      rs.forEach(([ov, z]) => {
        const pts = Math.abs(ov) < 1e-9 ? ring.pts : Poly.offsetRing(ring.pts, miters[ri], ov, limits && limits[ri]);
        const base = verts.length;
        pts.forEach((p) => verts.push([p[0], p[1], z]));
        idx.push(pts.map((_, i) => base + i));
      });
      ringIdx.push(idx);
      const n = ring.pts.length;
      for (let k = 0; k < rs.length - 1; k++) {
        const A = idx[k];
        const B = idx[k + 1];
        const mat = rs[k][2] && rs[k + 1][2] ? 'side' : 'bevel';
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n;
          faces.push({ loops: [[A[i], B[i], B[j], A[j]]], mat });
        }
      }
    });

    if (o.caps !== false) {
      const solids = rings.filter((r) => !r.hole);
      for (const s of solids) {
        const si = rings.indexOf(s);
        const holes = rings.filter((r) => r.hole && r.parent === s).map((r) => rings.indexOf(r));
        const front = [ringIdx[si][0]].concat(holes.map((h) => ringIdx[h][0]));
        const last = rs.length - 1;
        const back = [ringIdx[si][last].slice().reverse()].concat(holes.map((h) => ringIdx[h][last].slice().reverse()));
        faces.push({ loops: front, mat: 'front', cap: 'front' });
        faces.push({ loops: back, mat: 'back', cap: 'back' });
      }
      // Orphan holes (no solid parent) are skipped: they have nothing to cut.
    }

    // Ribbons from open paths: double-sided walls.
    for (const pts of open || []) {
      if (pts.length < 2) continue;
      const base = verts.length;
      pts.forEach((p) => verts.push([p[0], p[1], zf]));
      pts.forEach((p) => verts.push([p[0], p[1], zb]));
      const n = pts.length;
      for (let i = 0; i < n - 1; i++) faces.push({ loops: [[base + i, base + n + i, base + n + i + 1, base + i + 1]], mat: 'side', ds: true });
    }

    const closed = o.caps !== false;
    if (!closed) faces.forEach((f) => (f.ds = true));
    return {
      verts,
      faces,
      closed,
      // Bezier caps are exact only when the cap outline is the original contour.
      capExact: !hasBevel || !!o.bevelOut,
      capZ: [zf, zb],
    };
  };

  /* ---------- revolve ---------- */
  /**
   * profile: classify() rings in (r, h) space (r >= 0), openRuns: open polylines in (r, h).
   * o: { angle, segments, caps }
   */
  Mesh.revolve = (rings, openRuns, o) => {
    const verts = [];
    const faces = [];
    const A = Math.max(1, Math.min(360, o.angle == null ? 360 : o.angle));
    const full = A >= 359.99;
    const N = Math.max(3, Math.round(o.segments || 48 * (A / 360)));
    const steps = full ? N : N + 1;
    const th = (k) => ((k * A) / N) * (Math.PI / 180);
    const eps = 1e-6;
    const sweep = (pts, closedProfile, mat, ds) => {
      const n = pts.length;
      const idx = pts.map((p) => {
        const r = Math.max(0, p[0]);
        if (r < eps) {
          verts.push([0, p[1], 0]);
          const v = verts.length - 1;
          return new Array(steps).fill(v);
        }
        const row = [];
        for (let k = 0; k < steps; k++) {
          const t = th(k);
          verts.push([r * Math.cos(t), p[1], -r * Math.sin(t)]);
          row.push(verts.length - 1);
        }
        return row;
      });
      const segs = closedProfile ? n : n - 1;
      for (let j = 0; j < segs; j++) {
        const a = idx[j];
        const b = idx[(j + 1) % n];
        if (a[0] === b[0] && a[1] === b[1]) continue; // both on the axis
        for (let k = 0; k < N; k++) {
          const k2 = full ? (k + 1) % N : k + 1;
          const loop = dedupeLoop([a[k], a[k2], b[k2], b[k]]);
          if (loop.length >= 3) faces.push({ loops: [loop], mat, ds });
        }
      }
      return idx;
    };
    const ringIdx = rings.map((r) => sweep(r.pts, true, 'side', false));
    for (const run of openRuns || []) sweep(run, false, 'side', true);
    if (!full && o.caps !== false) {
      const solids = rings.filter((r) => !r.hole);
      for (const s of solids) {
        const si = rings.indexOf(s);
        const holes = rings.filter((r) => r.hole && r.parent === s).map((r) => rings.indexOf(r));
        const loop0 = [ringIdx[si].map((row) => row[0])].concat(holes.map((h) => ringIdx[h].map((row) => row[0])));
        const loop1 = [ringIdx[si].map((row) => row[steps - 1]).reverse()].concat(
          holes.map((h) => ringIdx[h].map((row) => row[steps - 1]).reverse())
        );
        faces.push({ loops: loop0.map(dedupeLoop).filter((l) => l.length >= 3), mat: 'front' });
        faces.push({ loops: loop1.map(dedupeLoop).filter((l) => l.length >= 3), mat: 'front' });
      }
    }
    const closed = (full || o.caps !== false) && !(openRuns && openRuns.length);
    if (!closed) faces.forEach((f) => (f.ds = true));
    return { verts, faces: faces.filter((f) => f.loops.length && f.loops[0].length >= 3), closed };
  };

  function dedupeLoop(l) {
    const out = [];
    for (const v of l) if (out[out.length - 1] !== v) out.push(v);
    while (out.length > 1 && out[0] === out[out.length - 1]) out.pop();
    return out;
  }

  /* ---------- inflate ---------- */
  /**
   * Puffs a flat shape into a pillow using a signed-distance height field.
   * o: { height, profile, spread (0–1), sides: 'both'|'front', detail }
   */
  Mesh.inflate = (rings, o) => {
    const verts = [];
    const faces = [];
    let bb = null;
    for (const r of rings) bb = V3D.Rect.union(bb, Poly.bbox(r.pts));
    if (!V3D.Rect.valid(bb)) return { verts, faces, closed: true };
    const Nd = Math.max(8, Math.min(160, Math.round(o.detail || 48)));
    const size = Math.max(V3D.Rect.w(bb), V3D.Rect.h(bb));
    const cs = size / Nd;
    const x0 = bb.x - cs;
    const y0 = bb.y - cs;
    const nx = Math.ceil(V3D.Rect.w(bb) / cs) + 3;
    const ny = Math.ceil(V3D.Rect.h(bb) / cs) + 3;
    // Flattened segment list.
    const segs = [];
    for (const r of rings) {
      const p = r.pts;
      for (let i = 0; i < p.length; i++) {
        const a = p[i];
        const b = p[(i + 1) % p.length];
        segs.push(a[0], a[1], b[0], b[1]);
      }
    }
    const S = segs.length / 4;
    const sd = new Float64Array(nx * ny);
    let maxD = 0;
    for (let j = 0; j < ny; j++) {
      const y = y0 + j * cs;
      // Even-odd crossings for the row.
      const xs = [];
      for (let s = 0; s < S; s++) {
        const ax = segs[s * 4];
        const ay = segs[s * 4 + 1];
        const bx = segs[s * 4 + 2];
        const by = segs[s * 4 + 3];
        if (ay > y !== by > y) xs.push(ax + ((y - ay) * (bx - ax)) / (by - ay));
      }
      xs.sort((a, b) => a - b);
      let ci = 0;
      for (let i = 0; i < nx; i++) {
        const x = x0 + i * cs;
        while (ci < xs.length && xs[ci] < x) ci++;
        const inside = ci % 2 === 1;
        let best = Infinity;
        for (let s = 0; s < S; s++) {
          const ax = segs[s * 4];
          const ay = segs[s * 4 + 1];
          const dx = segs[s * 4 + 2] - ax;
          const dy = segs[s * 4 + 3] - ay;
          const l2 = dx * dx + dy * dy;
          let t = l2 ? ((x - ax) * dx + (y - ay) * dy) / l2 : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const ex = ax + t * dx - x;
          const ey = ay + t * dy - y;
          const d2 = ex * ex + ey * ey;
          if (d2 < best) best = d2;
        }
        const d = Math.sqrt(best) * (inside ? 1 : -1);
        sd[j * nx + i] = d;
        if (d > maxD) maxD = d;
      }
    }
    const prof = (Mesh.inflateProfiles[o.profile] || Mesh.inflateProfiles.round).f;
    const R = Math.max(1e-6, maxD * Math.max(0.05, Math.min(1, o.spread == null ? 1 : o.spread)));
    const H = o.height == null ? 40 : o.height;
    const both = o.sides !== 'front';
    const hAt = (d) => H * prof(Math.min(1, Math.max(0, d) / R));
    const zShift = both ? 0 : -H / 2;
    const fIdx = new Int32Array(nx * ny).fill(-1);
    const bIdx = new Int32Array(nx * ny).fill(-1);
    const eIdx = new Map();
    const corner = (i, j, front) => {
      const g = j * nx + i;
      const arr = front ? fIdx : bIdx;
      if (arr[g] < 0) {
        const h = hAt(sd[g]);
        verts.push([x0 + i * cs, y0 + j * cs, (front ? h : both ? -h : 0) + zShift]);
        arr[g] = verts.length - 1;
      }
      return arr[g];
    };
    const edgeV = (i1, j1, i2, j2) => {
      const g1 = j1 * nx + i1;
      const g2 = j2 * nx + i2;
      const key = g1 < g2 ? g1 * nx * ny + g2 : g2 * nx * ny + g1;
      let v = eIdx.get(key);
      if (v == null) {
        const d1 = sd[g1];
        const d2 = sd[g2];
        const t = d1 / (d1 - d2);
        verts.push([x0 + (i1 + (i2 - i1) * t) * cs, y0 + (j1 + (j2 - j1) * t) * cs, zShift]);
        v = verts.length - 1;
        eIdx.set(key, v);
      }
      return v;
    };
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        // Corners counter-clockwise in the y-up frame.
        const cs4 = [
          [i, j],
          [i + 1, j],
          [i + 1, j + 1],
          [i, j + 1],
        ];
        const ins = cs4.map(([a, b]) => sd[b * nx + a] > 0);
        const cnt = ins.filter(Boolean).length;
        if (!cnt) continue;
        const build = (front) => {
          const poly = [];
          for (let k = 0; k < 4; k++) {
            const [a, b] = cs4[k];
            const [c, d] = cs4[(k + 1) % 4];
            if (ins[k]) poly.push(corner(a, b, front));
            if (ins[k] !== ins[(k + 1) % 4]) poly.push(edgeV(a, b, c, d));
          }
          return poly;
        };
        const emit = (poly, front) => {
          if (poly.length < 3) return;
          const loop = front ? poly : poly.slice().reverse();
          faces.push({ loops: [loop], mat: front ? 'front' : 'back' });
        };
        const saddle = cnt === 2 && ins[0] === ins[2];
        if (saddle) {
          const centre = (sd[j * nx + i] + sd[j * nx + i + 1] + sd[(j + 1) * nx + i + 1] + sd[(j + 1) * nx + i]) / 4;
          if (centre <= 0) {
            // Two separate corners.
            for (const front of [true, false]) {
              for (let k = 0; k < 4; k++) {
                if (!ins[k]) continue;
                const [a, b] = cs4[k];
                const prev = cs4[(k + 3) % 4];
                const next = cs4[(k + 1) % 4];
                emit([edgeV(prev[0], prev[1], a, b), corner(a, b, front), edgeV(a, b, next[0], next[1])], front);
              }
            }
            continue;
          }
        }
        emit(build(true), true);
        emit(build(false), false);
      }
    }
    return { verts, faces, closed: true };
  };

  /* ---------- flat (rotate only) ---------- */
  Mesh.flat = (rings, open) => {
    const verts = [];
    const faces = [];
    const idx = rings.map((r) => r.pts.map((p) => (verts.push([p[0], p[1], 0]), verts.length - 1)));
    for (const s of rings.filter((r) => !r.hole)) {
      const si = rings.indexOf(s);
      const loops = [idx[si]].concat(rings.filter((r) => r.hole && r.parent === s).map((r) => idx[rings.indexOf(r)]));
      faces.push({ loops, mat: 'front', cap: 'front', ds: true });
    }
    return { verts, faces, closed: false, capExact: true, capZ: [0, 0], open: open || [] };
  };

  /* ---------- finalize: normals, adjacency, smoothing ---------- */
  Mesh.finalize = (mesh, smoothDeg = 35) => {
    const V = mesh.verts;
    const nV = V.length;
    // Drop spatially duplicate consecutive vertices and degenerate faces.
    const same = (a, b) => Math.abs(V[a][0] - V[b][0]) < 1e-7 && Math.abs(V[a][1] - V[b][1]) < 1e-7 && Math.abs(V[a][2] - V[b][2]) < 1e-7;
    const faces = [];
    for (const f of mesh.faces) {
      const loops = [];
      for (const l of f.loops) {
        const out = [];
        for (const v of l) if (!out.length || !same(out[out.length - 1], v)) out.push(v);
        while (out.length > 1 && same(out[0], out[out.length - 1])) out.pop();
        if (out.length >= 3) loops.push(out);
      }
      if (!loops.length) continue;
      f.loops = loops;
      // Newell normal of the outer loop.
      const l = loops[0];
      let nx = 0;
      let ny = 0;
      let nz = 0;
      let cx = 0;
      let cy = 0;
      let cz = 0;
      let cnt = 0;
      for (let i = 0; i < l.length; i++) {
        const a = V[l[i]];
        const b = V[l[(i + 1) % l.length]];
        nx += (a[1] - b[1]) * (a[2] + b[2]);
        ny += (a[2] - b[2]) * (a[0] + b[0]);
        nz += (a[0] - b[0]) * (a[1] + b[1]);
      }
      for (const lp of loops)
        for (const v of lp) {
          cx += V[v][0];
          cy += V[v][1];
          cz += V[v][2];
          cnt++;
        }
      const nl = Math.hypot(nx, ny, nz);
      if (nl < 1e-10) continue;
      f.n = [nx / nl, ny / nl, nz / nl];
      f.area = nl / 2;
      f.c = [cx / cnt, cy / cnt, cz / cnt];
      faces.push(f);
    }
    mesh.faces = faces;
    // Radius for perspective.
    let r = 0;
    for (const v of V) r = Math.max(r, Math.hypot(v[0], v[1], v[2]));
    mesh.radius = r || 1;
    // Vertex → incident faces.
    const inc = new Array(nV);
    faces.forEach((f, fi) => {
      for (const l of f.loops) for (const v of l) (inc[v] || (inc[v] = [])).push(fi);
    });
    // Edge adjacency.
    const edges = new Map();
    faces.forEach((f, fi) => {
      for (const l of f.loops)
        for (let i = 0; i < l.length; i++) {
          const a = l[i];
          const b = l[(i + 1) % l.length];
          const key = a < b ? a * nV + b : b * nV + a;
          let e = edges.get(key);
          if (!e) edges.set(key, (e = { a, b, f: [] }));
          e.f.push(fi);
        }
    });
    mesh.edges = Array.from(edges.values());
    // Per-corner smooth normals (only polygon faces with a single loop).
    const cosT = Math.cos((smoothDeg * Math.PI) / 180);
    faces.forEach((f) => {
      if (f.loops.length !== 1 || f.cap) return;
      f.cn = f.loops[0].map((v) => {
        let sx = 0;
        let sy = 0;
        let sz = 0;
        for (const gi of inc[v]) {
          const g = faces[gi];
          if (g.n[0] * f.n[0] + g.n[1] * f.n[1] + g.n[2] * f.n[2] < cosT) continue;
          const w = Math.sqrt(g.area) + 1e-9;
          sx += g.n[0] * w;
          sy += g.n[1] * w;
          sz += g.n[2] * w;
        }
        const l = Math.hypot(sx, sy, sz) || 1;
        return [sx / l, sy / l, sz / l];
      });
    });
    return mesh;
  };
})();
