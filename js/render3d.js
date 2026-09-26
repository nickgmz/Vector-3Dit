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
      // Placement inside a scene camera: the object's own turn and how far it is pushed back.
      objRx: 0,
      objRy: 0,
      objRz: 0,
      objPush: 0,
      nameColors: 'names',
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

  /* ---------------- names ---------------- */
  // Every output path is named "Fill - Light Blue - Front" or "Line - Black - Top": what it is, its color
  // and where it sits on the object, so the result is easy to find your way around in a layers panel.
  const HUE_NAMES = [
    [12, 'Red'],
    [40, 'Orange'],
    [66, 'Yellow'],
    [160, 'Green'],
    [190, 'Cyan'],
    [250, 'Blue'],
    [285, 'Purple'],
    [330, 'Magenta'],
    [361, 'Red'],
  ];

  /** CMYK code of a color, like "C80 M40 Y0 K10". */
  // Names use the color as drawn: each channel rounded to a whole 0-255 value.
  const unit = (v) => Math.floor(clamp(v, 0, 255) + 0.5) / 255;
  R3D.cmykCode = (c) => {
    const r = unit(c.r);
    const g = unit(c.g);
    const b = unit(c.b);
    const k = 1 - Math.max(r, g, b);
    const d = 1 - k || 1;
    const p = (v) => Math.floor(Math.max(0, v) * 100 + 0.5);
    return `C${p((1 - r - k) / d)} M${p((1 - g - k) / d)} Y${p((1 - b - k) / d)} K${p(k)}`;
  };

  /** A basic color name ("Light Blue", "Dark Gray"), or the CMYK code when no basic name fits or mode is 'cmyk'. */
  R3D.colorName = (c, mode) => {
    if (!c) return 'None';
    if (mode === 'cmyk') return R3D.cmykCode(c);
    const r = unit(c.r);
    const g = unit(c.g);
    const b = unit(c.b);
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    const ch = mx - mn;
    const l = (mx + mn) / 2;
    const s = ch < 1e-9 ? 0 : ch / (1 - Math.abs(2 * l - 1));
    if (l < 0.07) return 'Black';
    if (l > 0.96) return 'White';
    if (s < 0.1 || ch < 0.06) return l < 0.16 ? 'Black' : l < 0.38 ? 'Dark Gray' : l < 0.64 ? 'Gray' : l < 0.88 ? 'Light Gray' : 'White';
    if (s < 0.2 && ch < 0.12) return R3D.cmykCode(c); // a muted, grayish color: no basic name fits
    let h = mx === r ? (g - b) / ch : mx === g ? (b - r) / ch + 2 : (r - g) / ch + 4;
    h = (h * 60 + 360) % 360;
    const hue = HUE_NAMES.find((e) => h < e[0])[1];
    if (hue === 'Orange' && (l < 0.42 || (s < 0.4 && l < 0.6))) return l < 0.22 ? 'Dark Brown' : 'Brown';
    if ((hue === 'Orange' || hue === 'Yellow') && s < 0.5 && l > 0.55) return l > 0.8 ? 'Beige' : 'Tan';
    if (hue === 'Yellow' && l < 0.36) return 'Olive';
    if ((hue === 'Red' || hue === 'Magenta') && l > 0.72) return l > 0.86 ? 'Light Pink' : 'Pink';
    if (hue === 'Blue' && l < 0.2) return 'Navy';
    if (hue === 'Cyan' && l < 0.36) return 'Teal';
    if (hue === 'Magenta' && l < 0.3) return 'Purple';
    return (l < 0.28 ? 'Dark ' : l > 0.72 ? 'Light ' : '') + hue;
  };

  /** Where a face sits on the object, from its own (unturned) normal: Front, Top, Left Side… */
  R3D.facePosition = (f, flip, kind) => {
    if (flip) return kind === 'flat' ? 'Back' : 'Inside';
    if (f.cap) return f.cap === 'back' ? 'Back' : 'Front';
    if (kind === 'revolve' && f.mat === 'front') return 'Cut End';
    if (f.mat === 'bevel') return f.c[2] >= 0 ? 'Front Bevel' : 'Back Bevel';
    const [x, y, z] = f.n;
    if (Math.abs(z) >= 0.75) return z > 0 ? 'Front' : 'Back';
    if (Math.abs(x) < 1e-6 && Math.abs(y) < 1e-6) return 'Side';
    if (Math.abs(y) >= Math.abs(x)) return y > 0 ? 'Top' : 'Bottom';
    return x > 0 ? 'Right Side' : 'Left Side';
  };

  /* ---------------- hidden lines ---------------- */
  // Lines are drawn above every fill, so each one is first cut back to the parts that no fill painted
  // after its own face covers. Faces and long outlines are found through grids so big meshes stay fast.
  const BIG_POLY = 24;

  /** An occluding face: loops of flat [x, y, …] screen points. */
  function occluder(loops) {
    let n = 0;
    for (const L of loops) n += L.length / 2;
    const E = new Float64Array(n * 4);
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    let k = 0;
    for (const L of loops)
      for (let i = 0, j = L.length - 2; i < L.length; j = i, i += 2) {
        E[k++] = L[j];
        E[k++] = L[j + 1];
        E[k++] = L[i];
        E[k++] = L[i + 1];
        if (L[i] < x0) x0 = L[i];
        if (L[i] > x1) x1 = L[i];
        if (L[i + 1] < y0) y0 = L[i + 1];
        if (L[i + 1] > y1) y1 = L[i + 1];
      }
    return { E, n, x0, y0, x1, y1, grid: null };
  }

  /** Edge grid for a big face; every edge is listed in each cell within eps of it. */
  function edgeGrid(o, eps) {
    const G = Math.max(2, Math.min(64, Math.ceil(Math.sqrt(o.n / 2))));
    const cw = (o.x1 - o.x0) / G || 1;
    const ch = (o.y1 - o.y0) / G || 1;
    const cells = [];
    for (let i = 0; i < G * G; i++) cells.push([]);
    const cx = (x) => Math.min(G - 1, Math.max(0, Math.floor((x - o.x0) / cw)));
    const cy = (y) => Math.min(G - 1, Math.max(0, Math.floor((y - o.y0) / ch)));
    const E = o.E;
    for (let e = 0; e < o.n; e++) {
      const ax = E[e * 4];
      const ay = E[e * 4 + 1];
      const bx = E[e * 4 + 2];
      const by = E[e * 4 + 3];
      const i1 = cx(Math.max(ax, bx) + eps);
      const j1 = cy(Math.max(ay, by) + eps);
      for (let j = cy(Math.min(ay, by) - eps); j <= j1; j++) for (let i = cx(Math.min(ax, bx) - eps); i <= i1; i++) cells[j * G + i].push(e);
    }
    o.grid = { G, cells, cx, cy, stamp: new Int32Array(o.n).fill(-1), tick: 0 };
  }

  /** Calls fn(edge) once for each edge of o that may lie in the box. */
  function edgesNear(o, x0, y0, x1, y1, fn) {
    const g = o.grid;
    if (!g) {
      for (let e = 0; e < o.n; e++) fn(e);
      return;
    }
    const t = ++g.tick;
    const i1 = g.cx(x1);
    const j1 = g.cy(y1);
    for (let j = g.cy(y0); j <= j1; j++)
      for (let i = g.cx(x0); i <= i1; i++)
        for (const e of g.cells[j * g.G + i])
          if (g.stamp[e] !== t) {
            g.stamp[e] = t;
            fn(e);
          }
  }

  /**
   * True when (px, py) is inside face o (even-odd), unless it lies on an edge of o that runs along the
   * line's direction (ux, uy): a line along a face's outline stays visible.
   */
  function insideDeep(o, px, py, eps, ux, uy) {
    if (px < o.x0 || px > o.x1 || py < o.y0 || py > o.y1) return false;
    const E = o.E;
    const e2 = eps * eps;
    let inside = false;
    let along = false;
    const test = (e) => {
      const ax = E[e * 4];
      const ay = E[e * 4 + 1];
      const bx = E[e * 4 + 2];
      const by = E[e * 4 + 3];
      if (ay > py !== by > py && px < ax + ((py - ay) * (bx - ax)) / (by - ay)) inside = !inside;
      const ex = bx - ax;
      const ey = by - ay;
      const l2 = ex * ex + ey * ey;
      if (l2 < 1e-18) return;
      let t = ((px - ax) * ex + (py - ay) * ey) / l2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = ax + ex * t - px;
      const qy = ay + ey * t - py;
      if (qx * qx + qy * qy < e2 && Math.abs(ex * uy - ey * ux) < 0.02 * Math.sqrt(l2)) along = true;
    };
    const g = o.grid;
    if (!g) {
      for (let e = 0; e < o.n && !along; e++) test(e);
      return inside && !along;
    }
    // Only edges in this row, from here rightwards, can cross the ray; the point's own cell holds every near edge.
    const t = ++g.tick;
    const j = g.cy(py);
    for (let i = g.cx(px); i < g.G; i++)
      for (const e of g.cells[j * g.G + i])
        if (g.stamp[e] !== t) {
          g.stamp[e] = t;
          test(e);
          if (along) return false;
        }
    return inside;
  }

  /** Adds to cov the parts of segment (x0, y0)→(x1, y1), as [t0, t1] ranges, that lie well inside face o. */
  function coverBy(o, x0, y0, x1, y1, eps, cov) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const ts = [0, 1];
    const E = o.E;
    edgesNear(o, Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1), (e) => {
      const ax = E[e * 4];
      const ay = E[e * 4 + 1];
      const ex = E[e * 4 + 2] - ax;
      const ey = E[e * 4 + 3] - ay;
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-12) return;
      const t = ((ax - x0) * ey - (ay - y0) * ex) / den;
      const u = ((ax - x0) * dy - (ay - y0) * dx) / den;
      if (t > 0 && t < 1 && u >= 0 && u <= 1) ts.push(t);
    });
    ts.sort((a, b) => a - b);
    const len = Math.hypot(dx, dy) || 1;
    for (let k = 0; k + 1 < ts.length; k++) {
      const a = ts[k];
      const b = ts[k + 1];
      if (b - a < 1e-9) continue;
      const m = (a + b) / 2;
      if (insideDeep(o, x0 + dx * m, y0 + dy * m, eps, dx / len, dy / len)) cov.push([a, b]);
    }
  }

  /**
   * Hidden-line removal. segs: [{x0, y0, x1, y1, r, adj}] where r is the draw rank of the segment's face and
   * adj the ranks of the faces it borders; faces: occluders by draw rank (null for none).
   * Returns the visible pieces as [x0, y0, x1, y1, segment index].
   */
  R3D.hideLines = (segs, faces, eps) => {
    let gx0 = Infinity;
    let gy0 = Infinity;
    let gx1 = -Infinity;
    let gy1 = -Infinity;
    for (const o of faces)
      if (o) {
        gx0 = Math.min(gx0, o.x0);
        gy0 = Math.min(gy0, o.y0);
        gx1 = Math.max(gx1, o.x1);
        gy1 = Math.max(gy1, o.y1);
      }
    const out = [];
    const G = Math.max(1, Math.min(64, Math.round(Math.sqrt(faces.length / 3))));
    const cw = (gx1 - gx0) / G || 1;
    const ch = (gy1 - gy0) / G || 1;
    const cx = (x) => Math.min(G - 1, Math.max(0, Math.floor((x - gx0) / cw)));
    const cy = (y) => Math.min(G - 1, Math.max(0, Math.floor((y - gy0) / ch)));
    const cells = [];
    for (let i = 0; i < G * G; i++) cells.push([]);
    faces.forEach((o, r) => {
      if (!o) return;
      if (o.n > BIG_POLY) edgeGrid(o, eps);
      const i1 = cx(o.x1);
      const j1 = cy(o.y1);
      for (let j = cy(o.y0); j <= j1; j++) for (let i = cx(o.x0); i <= i1; i++) cells[j * G + i].push(r);
    });
    const seen = new Int32Array(faces.length).fill(-1);
    segs.forEach((s, si) => {
      const sx0 = Math.min(s.x0, s.x1) - eps;
      const sy0 = Math.min(s.y0, s.y1) - eps;
      const sx1 = Math.max(s.x0, s.x1) + eps;
      const sy1 = Math.max(s.y0, s.y1) + eps;
      const cov = [];
      let full = false;
      if (gx1 >= gx0 && sx1 >= gx0 && sx0 <= gx1 && sy1 >= gy0 && sy0 <= gy1) {
        const i1 = cx(sx1);
        const j1 = cy(sy1);
        for (let j = cy(sy0); j <= j1 && !full; j++)
          for (let i = cx(sx0); i <= i1 && !full; i++)
            for (const r of cells[j * G + i]) {
              if (seen[r] === si) continue;
              seen[r] = si;
              if (r <= s.r || s.adj.includes(r)) continue;
              const o = faces[r];
              if (o.x1 < sx0 || o.x0 > sx1 || o.y1 < sy0 || o.y0 > sy1) continue;
              const n0 = cov.length;
              coverBy(o, s.x0, s.y0, s.x1, s.y1, eps, cov);
              for (let k = n0; k < cov.length; k++) if (cov[k][0] <= 0 && cov[k][1] >= 1) full = true;
              if (full) break;
            }
      }
      if (full) return;
      cov.sort((a, b) => a[0] - b[0]);
      const len = Math.hypot(s.x1 - s.x0, s.y1 - s.y0) || 1;
      const minT = eps / len;
      let t = 0;
      const piece = (a, b) => {
        if (b - a > minT) out.push([s.x0 + (s.x1 - s.x0) * a, s.y0 + (s.y1 - s.y0) * a, s.x0 + (s.x1 - s.x0) * b, s.y0 + (s.y1 - s.y0) * b, si]);
      };
      for (const [a, b] of cov) {
        if (a > t) piece(t, a);
        if (b > t) t = b;
      }
      if (t < 1) piece(t, 1);
    });
    return out;
  };

  /** Joins line pieces [a, b] (point strings) that meet end to end into one path "d". */
  function chainD(pieces) {
    const at = new Map();
    pieces.forEach((p, i) => {
      for (const k of [p[0], p[1]]) {
        const l = at.get(k);
        if (l) l.push(i);
        else at.set(k, [i]);
      }
    });
    const used = new Uint8Array(pieces.length);
    const next = (pt) => {
      const l = at.get(pt);
      if (l) for (const i of l) if (!used[i]) return i;
      return -1;
    };
    let d = '';
    for (let i = 0; i < pieces.length; i++) {
      if (used[i]) continue;
      used[i] = 1;
      const run = [pieces[i][0], pieces[i][1]];
      // Grow forward from the end, then backward from the start.
      for (let end = run[1], j = next(end); j >= 0; j = next(end)) {
        used[j] = 1;
        end = pieces[j][0] === end ? pieces[j][1] : pieces[j][0];
        run.push(end);
      }
      for (let start = run[0], j = next(start); j >= 0; j = next(start)) {
        used[j] = 1;
        start = pieces[j][0] === start ? pieces[j][1] : pieces[j][0];
        run.unshift(start);
      }
      d += 'M' + run.join('L');
    }
    return d;
  }

  /* ---------------- rendering ---------------- */
  /**
   * subs: world-space subpaths; fx: 3D settings; style: {fill, opacity}; scene: {light, seam}
   * opts: { id, quality: 'full'|'draft', pivot }
   * Returns { markup, bbox, faces, ms }. The markup is one group holding, in drawing order, a "Shadow",
   * a "Fills" and a "Lines" group; every path has a data-name like "Fill - Light Blue - Front".
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
    const R = M3.fromEuler(fx.rx || 0, fx.ry || 0, fx.rz || 0);
    // In a scene camera an object can also turn on its own and move back or forward, leaving the camera as it is.
    const turned = fx.objRx || fx.objRy || fx.objRz;
    const Rn = turned ? M3.mul(R, M3.fromEuler(fx.objRx || 0, fx.objRy || 0, fx.objRz || 0)) : R;
    const push = fx.objPush || 0;
    const T = M3.apply(R, [off[0], off[1], -push]);
    const place = (v) => {
      const p = M3.apply(Rn, v);
      return [p[0] + T[0], p[1] + T[1], p[2] + T[2]];
    };
    const fov = clamp(fx.persp || 0, 0, 160);
    const persp = fov > 0.5;
    // A shared scene camera fixes the camera distance, so every object linked to it gets the same perspective.
    const radius = fx.sceneRadius > 0 ? fx.sceneRadius : mesh.radius + Math.sqrt(off[0] * off[0] + off[1] * off[1] + push * push);
    const dist = persp ? radius * (1.1 + 1 / Math.tan(((fov / 2) * Math.PI) / 180)) : Infinity;
    const cam = [0, 0, dist];
    // Points pulled up to the camera are held just in front of it instead of flipping behind it.
    const kOf = (z) => (persp ? dist / Math.max(dist * 0.1, dist - z) : 1);

    // Transform + project vertices.
    const nV = mesh.verts.length;
    const P = new Array(nV);
    const S = new Float64Array(nV * 2);
    const bbox = V3D.Rect.empty();
    for (let i = 0; i < nV; i++) {
      const p = place(mesh.verts[i]);
      P[i] = p;
      const k = kOf(p[2]);
      S[i * 2] = cx + p[0] * k;
      S[i * 2 + 1] = cy - p[1] * k;
      V3D.Rect.addPoint(bbox, S[i * 2], S[i * 2 + 1]);
    }
    const project = (p) => {
      const k = kOf(p[2]);
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
      const n = M3.apply(Rn, f.n);
      const c = place(f.c);
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

    const nameMode = fx.nameColors === 'cmyk' ? 'cmyk' : 'names';
    const cname = (c) => R3D.colorName(c, nameMode);
    const posOf = (v) => R3D.facePosition(v.f, v.flip, fx.kind);

    // Which mesh edges become lines, each owned by the neighbouring face drawn last.
    const allEdges = edgesMode === 'all' || wire;
    const lineEdges = [];
    if (allEdges) {
      for (const e of mesh.edges) {
        let owner = -1;
        for (const fi of e.f) if (rank[fi] >= 0 && (owner < 0 || rank[fi] > rank[owner])) owner = fi;
        if (owner >= 0) lineEdges.push(e, owner);
      }
    } else if (edgesMode === 'outline') {
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
        if (owner >= 0) lineEdges.push(e, owner);
      }
    }
    // Quick drafts draw each line right after its face; finished renders put every line on top, cut back
    // where a fill really covers it. Wireframes are see-through, so all their lines show.
    const inline = draft && !wire;
    const faceEdges = new Map();
    if (inline)
      for (let i = 0; i < lineEdges.length; i += 2) (faceEdges.get(lineEdges[i + 1]) || faceEdges.set(lineEdges[i + 1], []).get(lineEdges[i + 1])).push(lineEdges[i]);

    const seam = scene && scene.seam != null ? scene.seam : 1;
    const edgeColor = Color.normalize(fx.edgeColor, '#1b1c22');
    const ew = fmt(fx.edgeWidth == null ? 1.5 : fx.edgeWidth, 2);
    const lineName = 'Line - ' + cname(Color.parse(edgeColor)) + ' - ';
    const lineAttrs = ` fill="none" stroke="${edgeColor}" stroke-width="${ew}" stroke-linecap="round" stroke-linejoin="round"`;
    const fills = [];
    const defs = [];
    let shadowMk = '';
    let gid = 0;
    let faceCount = 0;
    const pt = (i) => fmt(S[i * 2], 1) + ' ' + fmt(S[i * 2 + 1], 1);
    const loopD = (loops) => loops.map((l) => 'M' + l.map(pt).join('L') + 'Z').join('');
    /** One loop, always wound the same way on screen, so merged faces never cancel each other out. */
    const loopD1 = (l) => {
      let a = 0;
      for (let i = 0, j = l.length - 1; i < l.length; j = i++) a += S[l[j] * 2] * S[l[i] * 2 + 1] - S[l[i] * 2] * S[l[j] * 2 + 1];
      return 'M' + (a < 0 ? l.slice().reverse() : l).map(pt).join('L') + 'Z';
    };
    const hex = (c) => Color.toHex(c);
    const seamOf = (paint) => (seam > 0 ? ` stroke="${paint}"` : '');

    // Fills. Back-to-back faces with the same plain color and name are drawn as one path.
    let pend = null;
    const flush = () => {
      if (!pend) return;
      fills.push(`<path d="${pend.d}"${pend.attrs} fill="${pend.paint}"${pend.seamed ? seamOf(pend.paint) : ''} data-name="${pend.name}"/>`);
      pend = null;
    };
    const addFill = (d, paint, name, attrs = '', merge = false, seamed = true) => {
      if (merge && pend && pend.merge && pend.paint === paint && pend.name === name) {
        pend.d += d;
        return;
      }
      flush();
      pend = { d, paint, name, attrs, merge, seamed };
    };
    const emitEdges = (fi) => {
      const list = faceEdges.get(fi);
      if (!list) return;
      flush();
      let d = '';
      for (const e of list) d += 'M' + pt(e.a) + 'L' + pt(e.b);
      fills.push(`<path class="e" d="${d}"${lineAttrs}/>`);
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
    const smoothFace = (st, d, pts, us, pos) => {
      const pl = planeFit(pts, us);
      const g = pl && gradPlane(st, pl);
      const c = rampColor(st, quant(us.reduce((a, b) => a + b, 0) / us.length, steps));
      const name = 'Fill - ' + cname(c) + ' - ' + pos;
      if (g) addFill(d, `url(#${g})`, name);
      else addFill(d, hex(c), name);
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
        const n = M3.apply(Rn, f.n);
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
      const col = Color.normalize(fx.shadowColor, '#000000');
      shadowMk = `<g class="v3d-shadow" data-name="Shadow" opacity="${fmt(clamp(fx.shadowOpacity, 0, 1), 2)}"${filt}><path d="${d}" fill="${col}" data-name="Fill - ${cname(Color.parse(col))} - Cast Shadow"/></g>`;
    } else if (fx.shadow === 'floor' && !wire) {
      const w = V3D.Rect.w(bbox);
      const rx = w * 0.46;
      const ry = Math.max(3, w * 0.07);
      const sx = V3D.Rect.cx(bbox) - rig.L[0] * w * 0.12;
      const sy = bbox.y2 + ry * 0.2;
      const col = Color.normalize(fx.shadowColor, '#000000');
      defs.push(`<radialGradient id="${id}fl"><stop offset="0" stop-color="${col}" stop-opacity="1"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></radialGradient>`);
      shadowMk = `<g class="v3d-shadow" data-name="Shadow"><ellipse cx="${fmt(sx)}" cy="${fmt(sy)}" rx="${fmt(rx)}" ry="${fmt(ry)}" fill="url(#${id}fl)" opacity="${fmt(clamp(fx.shadowOpacity * 2, 0, 1), 2)}" data-name="Fill - ${cname(Color.parse(col))} - Floor Shadow"/></g>`;
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
      faceCount++;
      if (wire) continue;
      const st = mats[v.mat] || mats.side;
      const pos = posOf(v);
      const loop = f.loops[0];
      if (smooth && f.cn && f.loops.length === 1) {
        const us = f.cn.map((cn, i) => {
          const n = M3.apply(Rn, cn);
          const nn = v.flip ? V3.scale(n, -1) : n;
          return shade(nn, persp ? V3.norm(V3.sub(cam, P[loop[i]])) : v.V, rig, mode);
        });
        const umin = Math.min(...us);
        const umax = Math.max(...us);
        const scr = loop.map((vi) => [S[vi * 2], S[vi * 2 + 1]]);
        if (umax - umin < 0.02) {
          const c = rampColor(st, quant((umin + umax) / 2, steps));
          addFill(loopD1(loop), hex(c), 'Fill - ' + cname(c) + ' - ' + pos, '', true);
        } else {
          // One gradient for the whole face when its shading is (nearly) planar, else a fan of exact triangles.
          const pl = scr.length > 3 ? planeFit(scr, us) : null;
          if (scr.length === 3 || (pl && pl.maxRes <= (steps ? 0.012 : 0.03))) smoothFace(st, loopD(f.loops), scr, us, pos);
          else
            for (let i = 1; i < scr.length - 1; i++)
              smoothFace(st, `M${pt(loop[0])}L${pt(loop[i])}L${pt(loop[i + 1])}Z`, [scr[0], scr[i], scr[i + 1]], [us[0], us[i], us[i + 1]], pos);
        }
      } else {
        const c = rampColor(st, quant(shade(v.n, v.V, rig, mode), steps));
        const name = 'Fill - ' + cname(c) + ' - ' + pos;
        if (f.loops.length > 1) addFill(loopD(f.loops), hex(c), name, ' fill-rule="evenodd"');
        else addFill(loopD1(loop), hex(c), name, '', true);
      }
      if (inline) emitEdges(v.fi);
    }

    for (const side of ['back', 'front']) {
      const list = caps[side];
      if (!list.length || wire) continue;
      const v0 = list[0];
      const st = mats[v0.mat] || mats.front;
      const pos = posOf(v0);
      let d;
      if (mesh.capExact && geom.capSubs.length && fx.kind !== 'revolve') {
        const z = side === 'front' ? mesh.capZ[0] : mesh.capZ[1];
        const pr = (x, y) => {
          const q = project(place([x, y, z]));
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
      const u = quant(shade(v0.n, v0.V, rig, mode), steps);
      const c = rampColor(st, u);
      const grad = side === 'front' && !lineart && style && style.fill && typeof style.fill === 'object' ? capGradient(style.fill, geom, place, project, id, defs, mesh.capZ[0]) : null;
      if (grad) {
        addFill(d, `url(#${grad})`, 'Fill - ' + cname(Color.parse(solidOf(style.fill))) + ' - ' + pos, ' fill-rule="evenodd"', false, false);
        // Shade the gradient face with a translucent overlay.
        const shadeDelta = u - 1;
        if (Math.abs(shadeDelta) > 0.02 && mode !== 'flat') {
          flush();
          fills.push(
            `<path d="${d}" fill-rule="evenodd" fill="${shadeDelta < 0 ? '#000' : '#fff'}" fill-opacity="${fmt(Math.min(0.7, Math.abs(shadeDelta) * 0.6), 3)}" data-name="Fill - ${shadeDelta < 0 ? 'Black' : 'White'} - ${pos} Shading"/>`
          );
        }
      } else addFill(d, hex(c), 'Fill - ' + cname(c) + ' - ' + pos, ' fill-rule="evenodd"', false, false);
      faceCount++;
      if (inline) for (const v of list) emitEdges(v.fi);
    }
    flush();

    // Lines, on top of every fill, one path per name.
    let linesMk = '';
    if (!inline && lineEdges.length) {
      const segs = [];
      for (let i = 0; i < lineEdges.length; i += 2) {
        const e = lineEdges[i];
        const r = rank[lineEdges[i + 1]];
        const adj = [];
        for (const fi of e.f) if (rank[fi] >= 0) adj.push(rank[fi]);
        segs.push({ x0: S[e.a * 2], y0: S[e.a * 2 + 1], x1: S[e.b * 2], y1: S[e.b * 2 + 1], r, adj, name: lineName + posOf(vis[r]) });
      }
      let pieces;
      if (wire) pieces = segs.map((s, i) => [s.x0, s.y0, s.x1, s.y1, i]);
      else {
        const flat = (l) => {
          const a = new Float64Array(l.length * 2);
          l.forEach((vi, i) => {
            a[i * 2] = S[vi * 2];
            a[i * 2 + 1] = S[vi * 2 + 1];
          });
          return a;
        };
        const occ = vis.map((v) => occluder(v.f.loops.map(flat)));
        const eps = Math.max(1e-3, Math.hypot(V3D.Rect.w(bbox), V3D.Rect.h(bbox)) * 1e-4);
        pieces = R3D.hideLines(segs, occ, eps);
      }
      const byName = new Map();
      for (const p of pieces) {
        const a = fmt(p[0], 1) + ' ' + fmt(p[1], 1);
        const b = fmt(p[2], 1) + ' ' + fmt(p[3], 1);
        if (a === b) continue;
        const name = segs[p[4]].name;
        const l = byName.get(name);
        if (l) l.push([a, b]);
        else byName.set(name, [[a, b]]);
      }
      for (const [name, list] of byName) linesMk += `<path class="e" d="${chainD(list)}"${lineAttrs} data-name="${name}"/>`;
    }

    const opacity = style && style.opacity != null && style.opacity < 1 ? ` opacity="${fmt(style.opacity, 3)}"` : '';
    const seamAttr = seam > 0 ? ` stroke-width="${fmt(seam, 2)}" stroke-linejoin="round"` : '';
    const markup =
      `<g class="obj3d"${opacity}>${defs.length ? '<defs>' + defs.join('') + '</defs>' : ''}${shadowMk}` +
      (fills.length ? `<g class="v3d-fills" data-name="Fills"${seamAttr}>${fills.join('')}</g>` : '') +
      (linesMk ? `<g class="v3d-lines" data-name="Lines">${linesMk}</g>` : '') +
      '</g>';
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
  function capGradient(fill, geom, place, project, id, defs, z) {
    const bb = geom.bbox;
    const [cx, cy] = geom.center;
    // Doc → screen affine for points on the cap plane.
    const map = (x, y) => project(place([x - cx, cy - y, z]));
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
