/* Vector 3Dit — vector 3D renderer.
 * Turns a flat shape + 3D effect settings into plain SVG: projected polygons,
 * lit with a scalar shading ramp so smooth surfaces can be drawn as exact
 * per-triangle linear gradients (still 100% vector). */
(function () {
  'use strict';
  const V3D = globalThis.V3D;
  const { V3, M3, Color, Path, Poly, Mesh } = V3D;
  const { fmt, clamp } = V3D.U;

  const R3D = (V3D.R3D = {});

  R3D.kinds = {
    flat: { name: 'Flat', hint: 'Tilt and turn the shape in 3D space' },
    extrude: { name: 'Extrude', hint: 'Push the shape back into a solid' },
    revolve: { name: 'Revolve', hint: 'Spin the shape around an axis, like a lathe' },
    inflate: { name: 'Inflate', hint: 'Puff the shape up like a balloon' },
  };

  R3D.shadings = {
    flat: { name: 'Flat', hint: 'Solid colors, no light' },
    matte: { name: 'Matte', hint: 'Soft, diffuse light' },
    plastic: { name: 'Glossy', hint: 'Diffuse light with a shiny highlight' },
    toon: { name: 'Toon', hint: 'Cel-shaded color bands' },
    metal: { name: 'Metal', hint: 'Reflective chrome-like bands' },
    lineart: { name: 'Line art', hint: 'Paper fill with ink outlines' },
    wire: { name: 'Wireframe', hint: 'Mesh edges only' },
  };

  R3D.defaultLight = () => ({ az: -45, el: 40, intensity: 1, ambient: 0.35, fill: 0.25, specular: 0.45, gloss: 55 });

  R3D.defaults = (kind = 'extrude', size = 200) => {
    const depth = Math.round(clamp(size * 0.22, 8, 90));
    return {
      kind,
      rx: kind === 'flat' ? 30 : 20,
      ry: kind === 'flat' ? -25 : -30,
      rz: 0,
      persp: 0,
      depth,
      caps: true,
      bevel: 'none',
      bevelW: Math.max(1, Math.round(depth * 0.18)),
      bevelH: Math.max(1, Math.round(depth * 0.18)),
      bevelSides: 'front',
      bevelOut: false,
      bevelSegs: 5,
      revAngle: 360,
      revAxis: 'left',
      revOffset: 0,
      revSegs: 48,
      revCaps: true,
      infH: Math.round(clamp(size * 0.2, 6, 80)),
      infProfile: 'round',
      infSpread: 1,
      infSides: 'both',
      infDetail: 40,
      shading: 'plastic',
      smooth: true,
      smoothAngle: 35,
      steps: 0,
      sideColor: null,
      bevelColor: null,
      backColor: null,
      shadowTint: 'auto',
      highlight: '#ffffff',
      useSceneLight: true,
      light: R3D.defaultLight(),
      edges: 'none',
      edgeColor: '#1b1c22',
      edgeWidth: 1.5,
      creaseAngle: 40,
      shadow: 'none',
      shadowOpacity: 0.28,
      shadowBlur: 6,
      shadowDist: 40,
      shadowColor: '#10121a',
    };
  };

  /** Fills missing keys (older files, partial presets). */
  R3D.normalize = (fx) => {
    const d = R3D.defaults(fx.kind || 'extrude');
    const out = Object.assign(d, fx);
    out.light = Object.assign(R3D.defaultLight(), fx.light || {});
    return out;
  };

  /* ---------------- view presets ---------------- */
  const iso = 35.2644;
  const eul = (m) => M3.toEuler(m);
  R3D.presets = [
    { id: 'front', name: 'Front', r: [0, 0, 0] },
    { id: 'offaxis', name: 'Off-axis', r: [20, -30, 0] },
    { id: 'offaxis-l', name: 'Off-axis left', r: [20, 30, 0] },
    { id: 'hero', name: 'Low angle', r: [-18, -32, 0] },
    { id: 'iso-l', name: 'Isometric left', r: [iso, -45, 0] },
    { id: 'iso-r', name: 'Isometric right', r: [iso, 45, 0] },
    { id: 'iso-t', name: 'Isometric top', m: () => M3.mul(M3.rotX(iso), M3.mul(M3.rotY(-45), M3.rotX(-90))) },
    { id: 'top', name: 'Top down', r: [58, 0, 0] },
    { id: 'turn-l', name: 'Turned left', r: [0, 48, 0] },
    { id: 'turn-r', name: 'Turned right', r: [0, -48, 0] },
    { id: 'tilt', name: 'Tilted back', r: [-40, 0, 0] },
    { id: 'dimetric', name: 'Dimetric', r: [20.7, -41.4, 0] },
  ].map((p) => {
    if (p.m) {
      const e = eul(p.m());
      p.r = [e.rx, e.ry, e.rz];
    }
    return p;
  });

  /* ---------------- caches ---------------- */
  class LRU {
    constructor(n) {
      this.n = n;
      this.m = new Map();
    }
    get(k) {
      const v = this.m.get(k);
      if (v !== undefined) {
        this.m.delete(k);
        this.m.set(k, v);
      }
      return v;
    }
    set(k, v) {
      this.m.set(k, v);
      if (this.m.size > this.n) this.m.delete(this.m.keys().next().value);
    }
  }
  const geomCache = new LRU(60);
  const meshCache = new LRU(40);
  R3D.clearCaches = () => {
    geomCache.m.clear();
    meshCache.m.clear();
  };

  /* ---------------- geometry preparation ---------------- */
  /**
   * World-space bezier subpaths → object-space contours for the chosen kind.
   * The cached part is translation-invariant (hashed relative to the bbox centre),
   * so moving an object never rebuilds its mesh.
   */
  R3D.prepare = (subs, fx, quality) => {
    const draft = quality === 'draft';
    const bb = Path.bbox(subs);
    if (!V3D.Rect.valid(bb)) return null;
    const bcx = V3D.Rect.cx(bb);
    const bcy = V3D.Rect.cy(bb);
    const diag = Math.hypot(V3D.Rect.w(bb), V3D.Rect.h(bb)) || 1;
    const tol = Math.max(0.05, diag * (draft ? 0.004 : 0.0015));
    let maxSeg = Infinity;
    if (fx.kind === 'extrude') maxSeg = clamp((fx.depth || 20) * 1.4, diag / 70, diag / 8) * (draft ? 2 : 1);
    // Complexity budget: contour points × sweep steps stays bounded so huge inputs
    // (text revolved, detailed traced art) remain responsive and export at sane sizes.
    let budget = Infinity;
    if (fx.kind === 'revolve') budget = (draft ? 5000 : 14000) / Math.max(6, fx.revSegs || 48);
    else if (fx.kind === 'extrude') {
      const hasBevel = fx.bevel && fx.bevel !== 'none' && fx.bevelW > 0;
      const rings = hasBevel ? (fx.bevelSegs || 4) * (fx.bevelSides === 'both' ? 2 : 1) + 2 : 2;
      budget = (draft ? 4000 : 10000) / rings;
    } else if (fx.kind === 'flat') budget = 20000;
    const h = new V3D.U.Hasher().str(fx.kind).num(tol).num(maxSeg === Infinity ? -1 : maxSeg).num(budget === Infinity ? -1 : budget);
    if (fx.kind === 'revolve') h.str(fx.revAxis || 'left').num(fx.revOffset || 0);
    for (const s of subs) {
      h.num(s.closed ? 1 : 0);
      for (const n of s.nodes) h.num(n.x - bcx).num(n.y - bcy).num(n.ix - bcx).num(n.iy - bcy).num(n.ox - bcx).num(n.oy - bcy);
    }
    const key = h.key;
    let g = geomCache.get(key);
    if (!g) {
      g = buildGeom(Path.transform(subs, [1, 0, 0, 1, -bcx, -bcy]), fx, tol, maxSeg, budget, diag);
      g.key = key;
      geomCache.set(key, g);
    }
    // Per-call placement: the cached geometry is centred on the bbox centre.
    return Object.assign({}, g, {
      center: [g.center[0] + bcx, g.center[1] + bcy],
      bbox: V3D.Rect.transform(g.bbox, [1, 0, 0, 1, bcx, bcy]),
    });
  };

  /** Builds contours from subpaths already centred on their bbox centre. */
  function buildGeom(subs, fx, tol, maxSeg, budget, diag) {
    const bb = Path.bbox(subs);
    let flat = Path.flatten(subs, tol, maxSeg);
    const count = (fl) => fl.reduce((a, f) => a + f.pts.length, 0);
    let guard = 0;
    while (count(flat) > budget && guard++ < 12) {
      // Coarser curves first, then fewer sort-helper subdivisions.
      if (tol < diag * 0.02) tol *= 1.6;
      else maxSeg = maxSeg === Infinity ? Infinity : maxSeg * 1.8;
      flat = Path.flatten(subs, tol, maxSeg);
      if (count(flat) > budget && tol >= diag * 0.02) {
        // Still too dense (very detailed art): thin the polylines directly.
        flat = flat.map((f) => ({ closed: f.closed, pts: f.closed ? Poly.rdp(f.pts.concat([f.pts[0]]), tol).slice(0, -1) : Poly.rdp(f.pts, tol) }));
        break;
      }
    }
    let cx = V3D.Rect.cx(bb);
    const cy = V3D.Rect.cy(bb);
    const closedC = [];
    const openC = [];
    let startAngle = 0;
    if (fx.kind === 'revolve') {
      const axis = fx.revAxis || 'left';
      const ax = axis === 'right' ? bb.x2 : axis === 'center' ? cx : bb.x;
      const sign = axis === 'right' ? -1 : 1;
      startAngle = axis === 'right' ? 180 : 0;
      const off = fx.revOffset || 0;
      for (const f of flat) {
        let pts = f.pts;
        if (axis === 'center') {
          if (f.closed) pts = Poly.clipX(pts, ax, 1);
          else pts = pts.map((p) => [Math.max(ax, p[0]), p[1]]);
        }
        const prof = pts.map((p) => [Math.max(0, sign * (p[0] - ax) + off), cy - p[1]]);
        if (f.closed) {
          const dd = Poly.dedupe(prof);
          if (dd.length >= 3) closedC.push(dd);
        } else if (prof.length >= 2) openC.push(prof);
      }
      cx = ax;
    } else {
      for (const f of flat) {
        const pts = f.pts.map((p) => [p[0] - cx, cy - p[1]]);
        if (f.closed) {
          const dd = Poly.dedupe(pts);
          if (dd.length >= 3) closedC.push(dd);
        } else if (pts.length >= 2) openC.push(pts);
      }
    }
    const rings = Poly.classify(closedC);
    // Object-space bezier outlines for exact caps.
    const capSubs = subs
      .filter((s) => s.closed)
      .map((s) => ({
        closed: true,
        nodes: s.nodes.map((n) => ({ x: n.x - cx, y: cy - n.y, ix: n.ix - cx, iy: cy - n.iy, ox: n.ox - cx, oy: cy - n.oy })),
      }));
    return { rings, open: openC, center: [cx, cy], bbox: bb, capSubs, startAngle, diag: Math.hypot(V3D.Rect.w(bb), V3D.Rect.h(bb)) };
  }

  R3D.buildMesh = (geom, fx, quality) => {
    const draft = quality === 'draft';
    const k = fx.kind;
    const smoothAngle = fx.smoothAngle == null ? 35 : fx.smoothAngle;
    let params;
    if (k === 'extrude')
      params = [fx.depth, fx.caps !== false, fx.bevel, fx.bevelW, fx.bevelH, fx.bevelSides, !!fx.bevelOut, draft ? Math.min(3, fx.bevelSegs) : fx.bevelSegs];
    else if (k === 'revolve') params = [fx.revAngle, draft ? Math.max(12, Math.round(fx.revSegs / 2)) : fx.revSegs, fx.revCaps !== false];
    else if (k === 'inflate') params = [fx.infH, fx.infProfile, fx.infSpread, fx.infSides, draft ? Math.max(14, Math.round(fx.infDetail / 2)) : fx.infDetail];
    else params = [];
    const key = geom.key + '|' + k + '|' + JSON.stringify(params) + '|' + smoothAngle;
    const hit = meshCache.get(key);
    if (hit) return hit;
    let mesh;
    if (k === 'extrude')
      mesh = Mesh.extrude(geom.rings, geom.open, {
        depth: params[0],
        caps: params[1],
        bevel: params[2],
        bevelW: params[3],
        bevelH: params[4],
        bevelSides: params[5],
        bevelOut: params[6],
        bevelSegs: params[7],
      });
    else if (k === 'revolve') {
      mesh = Mesh.revolve(geom.rings, geom.open, { angle: params[0], segments: params[1], caps: params[2] });
      if (geom.startAngle) {
        // Right-hand axis: start the sweep on the left so the silhouette matches the drawing.
        for (const v of mesh.verts) {
          v[0] = -v[0];
          v[2] = -v[2];
        }
      }
      // Centre vertically is already done (h measured from the bbox centre).
    } else if (k === 'inflate')
      mesh = Mesh.inflate(geom.rings, { height: params[0], profile: params[1], spread: params[2], sides: params[3], detail: params[4] });
    else mesh = Mesh.flat(geom.rings, geom.open);
    Mesh.finalize(mesh, smoothAngle);
    meshCache.set(key, mesh);
    return mesh;
  };

  /* ---------------- shading ---------------- */
  const WHITE = { r: 255, g: 255, b: 255, a: 1 };
  /** Shading ramp: sorted stops [{u, c}] over u in [0, 2]. */
  function ramp(base, fx) {
    const sh = fx.shading;
    if (sh === 'flat' || sh === 'lineart' || sh === 'wire') return [{ u: 0, c: base }];
    const hi = Color.parse(fx.highlight) || WHITE;
    if (sh === 'metal') {
      const k = (f) => Color.scale(base, f);
      return [
        { u: 0, c: k(0.1) },
        { u: 0.32, c: k(0.55) },
        { u: 0.47, c: k(0.22) },
        { u: 0.53, c: Color.mix(base, hi, 0.55) },
        { u: 0.78, c: k(1.0) },
        { u: 1.0, c: Color.mix(base, hi, 0.8) },
        { u: 1.25, c: hi },
        { u: 2, c: hi },
      ];
    }
    let shadow;
    if (fx.shadowTint === 'black') shadow = { r: 0, g: 0, b: 0, a: 1 };
    else if (fx.shadowTint && fx.shadowTint !== 'auto') shadow = Color.parse(fx.shadowTint) || Color.autoShadow(base);
    else shadow = Color.autoShadow(base);
    return [
      { u: 0, c: shadow },
      { u: 1, c: base },
      { u: 2, c: hi },
    ];
  }
  function rampColor(st, u) {
    if (u <= st[0].u) return st[0].c;
    for (let i = 1; i < st.length; i++) {
      if (u <= st[i].u) {
        const a = st[i - 1];
        const b = st[i];
        return Color.mix(a.c, b.c, (u - a.u) / (b.u - a.u || 1));
      }
    }
    return st[st.length - 1].c;
  }

  function lightRig(fx, scene) {
    const L0 = fx.useSceneLight !== false && scene && scene.light ? scene.light : fx.light || R3D.defaultLight();
    const Lt = Object.assign(R3D.defaultLight(), L0);
    const L = V3.fromAngles(Lt.az, Lt.el);
    const L2 = V3.norm([-L[0], -L[1] * 0.3, Math.max(0.25, L[2])]);
    const amb = clamp(Lt.ambient, 0, 1);
    const ref = Math.max(0.45, amb + (1 - amb) * (Math.max(0, L[2]) + Lt.fill * Math.max(0, L2[2])));
    const shin = 2 + Math.pow(clamp(Lt.gloss, 0, 100) / 100, 2) * 180;
    return { L, L2, amb, ref, I: Lt.intensity, F: Lt.fill, S: Lt.specular, shin, az: Lt.az, el: Lt.el };
  }

  /** Scalar shade for normal n at view-space point p. */
  function shade(n, V, rig, mode) {
    if (mode === 'metal') {
      const nv = V3.dot(n, V);
      const r = [2 * nv * n[0] - V[0], 2 * nv * n[1] - V[1], 2 * nv * n[2] - V[2]];
      let u = (r[1] + 1) / 2;
      const H = V3.norm(V3.add(rig.L, V));
      const sp = Math.pow(Math.max(0, V3.dot(n, H)), rig.shin * 1.5) * rig.S * 1.6;
      return u + sp;
    }
    const d = Math.max(0, V3.dot(n, rig.L));
    const f = Math.max(0, V3.dot(n, rig.L2));
    let u = (rig.amb + (1 - rig.amb) * (rig.I * d + rig.F * f)) / rig.ref;
    if (u > 1.8) u = 1.8;
    if (mode === 'plastic' || mode === 'toon') {
      const H = V3.norm(V3.add(rig.L, V));
      const sp = Math.pow(Math.max(0, V3.dot(n, H)), rig.shin) * rig.S * (mode === 'toon' ? 1 : 1.2);
      u += mode === 'toon' ? (sp > 0.35 ? 1 : 0) : sp;
    }
    return u;
  }

  const quant = (u, steps) => {
    if (!steps) return u;
    const bw = 2 / steps;
    const b = Math.min(steps - 1, Math.max(0, Math.floor(u / bw)));
    return (b + 0.5) * bw;
  };

  /* ---------------- rendering ---------------- */
  /**
   * subs: world-space subpaths; fx: 3D settings; style: {fill, opacity}; scene: {light, seam}
   * opts: { id, quality: 'full'|'draft' }
   * Returns { markup, bbox, faces, ms }.
   */
  R3D.render = (subs, fxIn, style, scene, opts = {}) => {
    const t0 = globalThis.performance ? performance.now() : Date.now();
    const fx = R3D.normalize(fxIn);
    const quality = opts.quality || 'full';
    const draft = quality === 'draft';
    const geom = R3D.prepare(subs, fx, quality);
    if (!geom || (!geom.rings.length && !geom.open.length)) return { markup: '', bbox: null, faces: 0, ms: 0 };
    const mesh = R3D.buildMesh(geom, fx, quality);
    const id = (opts.id || 'o') + (draft ? 'd' : '');
    // Rotation centre: the shape's own centre, or a shared pivot (shapes rotated as a group).
    const [gcx, gcy] = geom.center;
    const [cx, cy] = opts.pivot || geom.center;
    const off = [gcx - cx, cy - gcy, 0];
    const hasOff = Math.abs(off[0]) > 1e-9 || Math.abs(off[1]) > 1e-9;
    const R = M3.fromEuler(fx.rx || 0, fx.ry || 0, fx.rz || 0);
    const fov = clamp(fx.persp || 0, 0, 160);
    const persp = fov > 0.5;
    const radius = mesh.radius + Math.hypot(off[0], off[1]);
    const dist = persp ? radius * (1.1 + 1 / Math.tan(((fov / 2) * Math.PI) / 180)) : Infinity;
    const cam = [0, 0, dist];

    // Transform + project vertices.
    const nV = mesh.verts.length;
    const P = new Array(nV);
    const S = new Float64Array(nV * 2);
    const bbox = V3D.Rect.empty();
    for (let i = 0; i < nV; i++) {
      const v = mesh.verts[i];
      const p = M3.apply(R, hasOff ? [v[0] + off[0], v[1] + off[1], v[2]] : v);
      P[i] = p;
      const k = persp ? dist / Math.max(1e-6, dist - p[2]) : 1;
      S[i * 2] = cx + p[0] * k;
      S[i * 2 + 1] = cy - p[1] * k;
      V3D.Rect.addPoint(bbox, S[i * 2], S[i * 2 + 1]);
    }
    const project = (p) => {
      const k = persp ? dist / Math.max(1e-6, dist - p[2]) : 1;
      return [cx + p[0] * k, cy - p[1] * k];
    };

    const rig = lightRig(fx, scene);
    const mode = fx.shading || 'plastic';
    const steps = mode === 'toon' ? fx.steps || 3 : fx.steps || 0;
    const smooth = !!fx.smooth && !draft && mode !== 'flat' && mode !== 'lineart' && mode !== 'wire';
    const baseColor = Color.parse(solidOf(style && style.fill)) || { r: 200, g: 200, b: 210, a: 1 };
    const lineart = mode === 'lineart';
    const paper = lineart ? Color.parse(fx.paperColor || '#ffffff') : null;
    const mats = {};
    const matBase = {
      front: paper || baseColor,
      side: paper || Color.parse(fx.sideColor) || baseColor,
    };
    matBase.bevel = paper || Color.parse(fx.bevelColor) || matBase.side;
    matBase.back = paper || Color.parse(fx.backColor) || matBase.front;
    matBase.inner = paper || Color.mix(matBase.side, { r: 0, g: 0, b: 0, a: 1 }, 0.15);
    for (const m in matBase) mats[m] = ramp(matBase[m], fx);

    const viewDir = (c) => (persp ? V3.norm(V3.sub(cam, c)) : [0, 0, 1]);
    const wire = mode === 'wire';
    const edgesMode = lineart && fx.edges === 'none' ? 'outline' : fx.edges || 'none';

    // Visibility, orientation and depth per face.
    const vis = [];
    mesh.faces.forEach((f, fi) => {
      const n = M3.apply(R, f.n);
      const c = M3.apply(R, hasOff ? [f.c[0] + off[0], f.c[1] + off[1], f.c[2]] : f.c);
      const V = viewDir(c);
      const facing = V3.dot(n, V) > 0;
      let flip = false;
      if (!facing) {
        if (!wire && mesh.closed && !f.ds) return;
        flip = true;
      }
      let mat = f.mat;
      if (flip) mat = f.mat === 'front' ? 'back' : fx.kind === 'flat' ? 'back' : 'inner';
      const depth = persp ? -V3.len(V3.sub(cam, c)) : c[2];
      vis.push({ f, fi, n: flip ? V3.scale(n, -1) : n, c, V, mat, flip, key: f.cap && !flip ? Infinity : depth });
    });
    vis.sort((a, b) => a.key - b.key);
    const rank = new Int32Array(mesh.faces.length).fill(-1);
    vis.forEach((v, i) => (rank[v.fi] = i));

    // Feature edges attached to the face drawn last.
    const faceEdges = new Map();
    if (edgesMode === 'outline' && !wire) {
      const cosC = Math.cos(((fx.creaseAngle == null ? 40 : fx.creaseAngle) * Math.PI) / 180);
      for (const e of mesh.edges) {
        const vf = e.f.filter((fi) => rank[fi] >= 0);
        if (!vf.length) continue;
        let owner = -1;
        if (vf.length === 1 || e.f.length === 1) owner = vf[0];
        else {
          const a = vis[rank[vf[0]]];
          const b = vis[rank[vf[1]]];
          if (V3.dot(a.n, b.n) < cosC) owner = rank[vf[0]] > rank[vf[1]] ? vf[0] : vf[1];
        }
        if (owner < 0) continue;
        (faceEdges.get(owner) || faceEdges.set(owner, []).get(owner)).push(e.a, e.b);
      }
    }

    const seam = scene && scene.seam != null ? scene.seam : 1;
    const edgeColor = Color.normalize(fx.edgeColor, '#1b1c22');
    const ew = fmt(fx.edgeWidth == null ? 1.5 : fx.edgeWidth, 2);
    const allEdges = edgesMode === 'all' || wire;
    const out = [];
    const defs = [];
    let gid = 0;
    let faceCount = 0;
    const pt = (i) => fmt(S[i * 2], 1) + ' ' + fmt(S[i * 2 + 1], 1);
    const loopD = (loops) => loops.map((l) => 'M' + l.map(pt).join('L') + 'Z').join('');
    const hex = (c) => Color.toHex(c);
    const strokeFor = (color) =>
      allEdges
        ? ` class="e" stroke="${edgeColor}" stroke-width="${ew}" stroke-linejoin="round"`
        : seam > 0
          ? ` stroke="${color}"`
          : '';
    const emitEdges = (fi) => {
      const list = faceEdges.get(fi);
      if (!list) return;
      let d = '';
      for (let i = 0; i < list.length; i += 2) d += 'M' + pt(list[i]) + 'L' + pt(list[i + 1]);
      out.push(`<path class="e" d="${d}" fill="none" stroke="${edgeColor}" stroke-width="${ew}" stroke-linecap="round" stroke-linejoin="round"/>`);
    };

    /** Least-squares plane u = u0 + gx·(x−px) + gy·(y−py) through screen points; exact for triangles. */
    const planeFit = (pts, us) => {
      const n = pts.length;
      let mx = 0;
      let my = 0;
      let mu = 0;
      for (let i = 0; i < n; i++) {
        mx += pts[i][0];
        my += pts[i][1];
        mu += us[i];
      }
      mx /= n;
      my /= n;
      mu /= n;
      let sxx = 0;
      let sxy = 0;
      let syy = 0;
      let sxu = 0;
      let syu = 0;
      for (let i = 0; i < n; i++) {
        const x = pts[i][0] - mx;
        const y = pts[i][1] - my;
        const u = us[i] - mu;
        sxx += x * x;
        sxy += x * y;
        syy += y * y;
        sxu += x * u;
        syu += y * u;
      }
      const det = sxx * syy - sxy * sxy;
      if (Math.abs(det) < 1e-9) return null;
      const gx = (sxu * syy - syu * sxy) / det;
      const gy = (syu * sxx - sxu * sxy) / det;
      let maxRes = 0;
      let umin = Infinity;
      let umax = -Infinity;
      for (let i = 0; i < n; i++) {
        const pred = mu + gx * (pts[i][0] - mx) + gy * (pts[i][1] - my);
        maxRes = Math.max(maxRes, Math.abs(pred - us[i]));
        if (pred < umin) umin = pred;
        if (pred > umax) umax = pred;
      }
      return { px: mx, py: my, u0: mu, gx, gy, maxRes, umin, umax };
    };

    /** Linear gradient following a shading plane (exact vector Gouraud shading). */
    const gradPlane = (st, pl) => {
      const { px, py, u0, gx, gy, umin, umax } = pl;
      const g2 = gx * gx + gy * gy;
      if (g2 < 1e-14 || umax - umin < 1e-6) return null;
      const x1 = px + (gx * (umin - u0)) / g2;
      const y1 = py + (gy * (umin - u0)) / g2;
      const x2 = px + (gx * (umax - u0)) / g2;
      const y2 = py + (gy * (umax - u0)) / g2;
      const span = umax - umin;
      const stops = [];
      const add = (u, c) => stops.push(`<stop offset="${fmt((u - umin) / span, 3)}" stop-color="${hex(c)}"/>`);
      if (steps) {
        const bw = 2 / steps;
        add(umin, rampColor(st, quant(umin, steps)));
        let b = (Math.floor(umin / bw) + 1) * bw;
        while (b < umax) {
          add(b, rampColor(st, quant(b - 1e-6, steps)));
          add(b, rampColor(st, quant(b + 1e-6, steps)));
          b += bw;
        }
        add(umax, rampColor(st, quant(umax, steps)));
      } else {
        add(umin, rampColor(st, umin));
        for (const s of st) if (s.u > umin && s.u < umax) add(s.u, s.c);
        add(umax, rampColor(st, umax));
      }
      const gidS = `${id}g${gid++}`;
      defs.push(`<linearGradient id="${gidS}" gradientUnits="userSpaceOnUse" x1="${fmt(x1, 1)}" y1="${fmt(y1, 1)}" x2="${fmt(x2, 1)}" y2="${fmt(y2, 1)}">${stops.join('')}</linearGradient>`);
      return gidS;
    };
    const smoothFace = (st, d, pts, us) => {
      const pl = planeFit(pts, us);
      const g = pl && gradPlane(st, pl);
      if (g) out.push(`<path d="${d}" fill="url(#${g})"${strokeFor(`url(#${g})`)}/>`);
      else {
        const c = hex(rampColor(st, quant(us.reduce((a, b) => a + b, 0) / us.length, steps)));
        out.push(`<path d="${d}" fill="${c}"${strokeFor(c)}/>`);
      }
    };

    // Cast shadow on a backdrop plane behind the object.
    if (fx.shadow === 'drop' && !wire) {
      const L = rig.L.slice();
      if (L[2] < 0.2) L[2] = 0.2;
      let zmin = Infinity;
      for (const p of P) if (p[2] < zmin) zmin = p[2];
      const zp = zmin - Math.max(0, fx.shadowDist || 0);
      let d = '';
      for (const f of mesh.faces) {
        const n = M3.apply(R, f.n);
        const lit = V3.dot(n, L);
        if (!(lit > 0 || f.ds)) continue;
        for (const l of f.loops) {
          d += 'M';
          l.forEach((vi, i) => {
            const p = P[vi];
            const t = (p[2] - zp) / L[2];
            const q = project([p[0] - L[0] * t, p[1] - L[1] * t, zp]);
            V3D.Rect.addPoint(bbox, q[0], q[1]);
            d += (i ? 'L' : '') + fmt(q[0], 1) + ' ' + fmt(q[1], 1);
          });
          d += 'Z';
        }
      }
      const blur = Math.max(0, fx.shadowBlur || 0);
      let filt = '';
      if (blur > 0.1) {
        defs.push(`<filter id="${id}sh" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${fmt(blur, 1)}"/></filter>`);
        filt = ` filter="url(#${id}sh)"`;
      }
      out.push(`<g opacity="${fmt(clamp(fx.shadowOpacity, 0, 1), 2)}"${filt}><path d="${d}" fill="${Color.normalize(fx.shadowColor, '#000000')}"/></g>`);
    } else if (fx.shadow === 'floor' && !wire) {
      const w = V3D.Rect.w(bbox);
      const rx = w * 0.46;
      const ry = Math.max(3, w * 0.07);
      const sx = V3D.Rect.cx(bbox) - rig.L[0] * w * 0.12;
      const sy = bbox.y2 + ry * 0.2;
      defs.push(`<radialGradient id="${id}fl"><stop offset="0" stop-color="${Color.normalize(fx.shadowColor, '#000000')}" stop-opacity="1"/><stop offset="1" stop-color="${Color.normalize(fx.shadowColor, '#000000')}" stop-opacity="0"/></radialGradient>`);
      out.push(`<ellipse cx="${fmt(sx)}" cy="${fmt(sy)}" rx="${fmt(rx)}" ry="${fmt(ry)}" fill="url(#${id}fl)" opacity="${fmt(clamp(fx.shadowOpacity * 2, 0, 1), 2)}"/>`);
      V3D.Rect.addPoint(bbox, sx - rx, sy + ry);
      V3D.Rect.addPoint(bbox, sx + rx, sy + ry);
    }

    // Faces, back to front. Visible caps come last and are merged per side.
    const caps = { front: [], back: [] };
    for (const v of vis) {
      const f = v.f;
      if (f.cap && !v.flip) {
        caps[f.cap].push(v);
        continue;
      }
      const st = mats[v.mat] || mats.side;
      if (wire) {
        out.push(`<path class="e" d="${loopD(f.loops)}" fill="none" stroke="${edgeColor}" stroke-width="${ew}" stroke-linejoin="round"/>`);
        faceCount++;
        continue;
      }
      const loop = f.loops[0];
      if (smooth && f.cn && f.loops.length === 1) {
        const us = f.cn.map((cn, i) => {
          const n = M3.apply(R, cn);
          const nn = v.flip ? V3.scale(n, -1) : n;
          return shade(nn, persp ? V3.norm(V3.sub(cam, P[loop[i]])) : v.V, rig, mode);
        });
        const umin = Math.min(...us);
        const umax = Math.max(...us);
        const scr = loop.map((vi) => [S[vi * 2], S[vi * 2 + 1]]);
        if (umax - umin < 0.02) {
          const c = hex(rampColor(st, quant((umin + umax) / 2, steps)));
          out.push(`<path d="${loopD(f.loops)}" fill="${c}"${strokeFor(c)}/>`);
        } else {
          // One gradient for the whole face when its shading is (nearly) planar, else a fan of exact triangles.
          const pl = scr.length > 3 ? planeFit(scr, us) : null;
          if (scr.length === 3 || (pl && pl.maxRes <= (steps ? 0.012 : 0.03))) smoothFace(st, loopD(f.loops), scr, us);
          else
            for (let i = 1; i < scr.length - 1; i++)
              smoothFace(st, `M${pt(loop[0])}L${pt(loop[i])}L${pt(loop[i + 1])}Z`, [scr[0], scr[i], scr[i + 1]], [us[0], us[i], us[i + 1]]);
        }
      } else {
        const u = quant(shade(v.n, v.V, rig, mode), steps);
        const c = hex(rampColor(st, u));
        out.push(`<path d="${loopD(f.loops)}"${f.loops.length > 1 ? ' fill-rule="evenodd"' : ''} fill="${c}"${strokeFor(c)}/>`);
      }
      faceCount++;
      emitEdges(v.fi);
    }

    for (const side of ['back', 'front']) {
      const list = caps[side];
      if (!list.length) continue;
      const v0 = list[0];
      const st = mats[v0.mat] || mats.front;
      let d;
      if (mesh.capExact && geom.capSubs.length && fx.kind !== 'revolve') {
        const z = side === 'front' ? mesh.capZ[0] : mesh.capZ[1];
        const pr = (x, y) => {
          const q = project(M3.apply(R, [x + off[0], y + off[1], z]));
          return fmt(q[0], 2) + ' ' + fmt(q[1], 2);
        };
        d = '';
        for (const s of geom.capSubs) {
          const ns = s.nodes;
          if (!ns.length) continue;
          d += 'M' + pr(ns[0].x, ns[0].y);
          for (let i = 0; i < ns.length; i++) {
            const a = ns[i];
            const b = ns[(i + 1) % ns.length];
            d += 'C' + pr(a.ox, a.oy) + ' ' + pr(b.ix, b.iy) + ' ' + pr(b.x, b.y);
          }
          d += 'Z';
        }
      } else d = list.map((v) => loopD(v.f.loops)).join('');
      if (wire) {
        out.push(`<path class="e" d="${d}" fill="none" stroke="${edgeColor}" stroke-width="${ew}"/>`);
        continue;
      }
      const u = quant(shade(v0.n, v0.V, rig, mode), steps);
      const c = hex(rampColor(st, u));
      const grad = side === 'front' && !lineart && style && style.fill && typeof style.fill === 'object' ? capGradient(style.fill, geom, R, project, fx, id, defs, side === 'front' ? mesh.capZ[0] : 0, off) : null;
      if (grad) {
        out.push(`<path d="${d}" fill-rule="evenodd" fill="url(#${grad})"/>`);
        // Shade the gradient face with a translucent overlay.
        const shadeDelta = u - 1;
        if (Math.abs(shadeDelta) > 0.02 && mode !== 'flat')
          out.push(`<path d="${d}" fill-rule="evenodd" fill="${shadeDelta < 0 ? '#000' : '#fff'}" fill-opacity="${fmt(Math.min(0.7, Math.abs(shadeDelta) * 0.6), 3)}"/>`);
      } else out.push(`<path d="${d}" fill-rule="evenodd" fill="${c}"${allEdges ? strokeFor(c) : ''}/>`);
      faceCount++;
      for (const v of list) emitEdges(v.fi);
    }

    const opacity = style && style.opacity != null && style.opacity < 1 ? ` opacity="${fmt(style.opacity, 3)}"` : '';
    const seamAttr = seam > 0 && !allEdges ? ` stroke-width="${fmt(seam, 2)}" stroke-linejoin="round"` : '';
    const markup = `<g class="obj3d"${opacity}${seamAttr}>${defs.length ? '<defs>' + defs.join('') + '</defs>' : ''}${out.join('')}</g>`;
    const t1 = globalThis.performance ? performance.now() : Date.now();
    return { markup, bbox: V3D.Rect.valid(bbox) ? bbox : null, faces: faceCount, ms: t1 - t0 };
  };

  function solidOf(fill) {
    if (!fill) return null;
    if (typeof fill === 'string') return fill;
    if (fill.stops && fill.stops.length) {
      // Average of the gradient stops.
      let r = 0;
      let g = 0;
      let b = 0;
      for (const s of fill.stops) {
        const c = Color.parse(s.color) || { r: 0, g: 0, b: 0 };
        r += c.r;
        g += c.g;
        b += c.b;
      }
      const n = fill.stops.length;
      return Color.toHex({ r: r / n, g: g / n, b: b / n });
    }
    return null;
  }
  R3D.solidOf = solidOf;

  /** Maps a 2D gradient fill onto the projected front cap (exact in orthographic views). */
  function capGradient(fill, geom, R, project, fx, id, defs, z, off) {
    const bb = geom.bbox;
    const [cx, cy] = geom.center;
    // Doc → screen affine for points on the cap plane.
    const map = (x, y) => project(M3.apply(R, [x - cx + off[0], cy - y + off[1], z]));
    const o = map(0, 0);
    const ex = map(1, 0);
    const ey = map(0, 1);
    const m = [ex[0] - o[0], ex[1] - o[1], ey[0] - o[0], ey[1] - o[1], o[0], o[1]];
    const W = V3D.Rect.w(bb);
    const H = V3D.Rect.h(bb);
    const stops = (fill.stops || [])
      .map((s) => `<stop offset="${fmt(s.offset, 4)}" stop-color="${Color.normalize(s.color)}"${s.opacity != null && s.opacity < 1 ? ` stop-opacity="${fmt(s.opacity, 3)}"` : ''}/>`)
      .join('');
    const gidS = `${id}cap`;
    const tr = ` gradientTransform="matrix(${m.map((v) => fmt(v, 5)).join(' ')})"`;
    if (fill.type === 'radial') {
      const r = (fill.r == null ? 0.5 : fill.r) * Math.max(W, H);
      defs.push(`<radialGradient id="${gidS}" gradientUnits="userSpaceOnUse" cx="${fmt(bb.x + (fill.cx == null ? 0.5 : fill.cx) * W)}" cy="${fmt(bb.y + (fill.cy == null ? 0.5 : fill.cy) * H)}" r="${fmt(r)}"${tr}>${stops}</radialGradient>`);
    } else {
      defs.push(`<linearGradient id="${gidS}" gradientUnits="userSpaceOnUse" x1="${fmt(bb.x + (fill.x1 || 0) * W)}" y1="${fmt(bb.y + (fill.y1 || 0) * H)}" x2="${fmt(bb.x + (fill.x2 == null ? 1 : fill.x2) * W)}" y2="${fmt(bb.y + (fill.y2 || 0) * H)}"${tr}>${stops}</linearGradient>`);
    }
    return gidS;
  }

  /** Draws a mini orientation cube (used by the trackball widget). */
  R3D.cubeMarkup = (rx, ry, rz, size, colors) => {
    const R = M3.fromEuler(rx, ry, rz);
    const s = size * 0.3;
    const faces = [
      { n: [0, 0, 1], v: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]], c: colors.front, label: 'F' },
      { n: [0, 0, -1], v: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]], c: colors.back },
      { n: [1, 0, 0], v: [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]], c: colors.side },
      { n: [-1, 0, 0], v: [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]], c: colors.side },
      { n: [0, 1, 0], v: [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]], c: colors.top },
      { n: [0, -1, 0], v: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]], c: colors.top },
    ];
    const c = size / 2;
    let out = '';
    const drawn = faces
      .map((f) => ({ f, n: M3.apply(R, f.n), pts: f.v.map((p) => M3.apply(R, [p[0] * s, p[1] * s, p[2] * s * 0.55])) }))
      .filter((f) => f.n[2] > 0.001)
      .sort((a, b) => a.n[2] - b.n[2]);
    for (const d of drawn) {
      const k = 0.55 + 0.45 * d.n[2];
      const col = Color.toHex(Color.scale(Color.parse(d.f.c), k));
      out += `<path d="M${d.pts.map((p) => fmt(c + p[0], 1) + ' ' + fmt(c - p[1], 1)).join('L')}Z" fill="${col}" stroke="${colors.edge}" stroke-width="1" stroke-linejoin="round"/>`;
    }
    return out;
  };

  /** Axis tripod end-points for overlays: returns [{axis, x, y, z}] unit vectors in screen space (y down). */
  R3D.axes = (rx, ry, rz) => {
    const R = M3.fromEuler(rx, ry, rz);
    return [
      ['x', [1, 0, 0]],
      ['y', [0, 1, 0]],
      ['z', [0, 0, 1]],
    ].map(([a, v]) => {
      const p = M3.apply(R, v);
      return { axis: a, x: p[0], y: -p[1], z: p[2] };
    });
  };
})();
