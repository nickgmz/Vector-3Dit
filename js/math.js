/* Vector 3Dit — vectors, 2D affine matrices and 3D rotations. */
(function () {
  'use strict';
  const V3D = globalThis.V3D;
  const { rad, deg } = V3D.U;

  /* ---------- 3D vectors (plain arrays) ---------- */
  const V3 = (V3D.V3 = {
    add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
    sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
    scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
    dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    len: (a) => Math.hypot(a[0], a[1], a[2]),
    norm: (a) => {
      const l = Math.hypot(a[0], a[1], a[2]) || 1;
      return [a[0] / l, a[1] / l, a[2] / l];
    },
    /** Light direction from azimuth/elevation in degrees (view space, y up, z toward viewer). */
    fromAngles: (az, el) => {
      const a = rad(az);
      const e = rad(el);
      return [Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)];
    },
    toAngles: (v) => {
      const n = V3.norm(v);
      return { az: deg(Math.atan2(n[0], n[2])), el: deg(Math.asin(Math.max(-1, Math.min(1, n[1])))) };
    },
  });

  /* ---------- 3x3 rotation matrices (row-major flat arrays) ---------- */
  const M3 = (V3D.M3 = {
    identity: () => [1, 0, 0, 0, 1, 0, 0, 0, 1],
    mul(a, b) {
      const r = new Array(9);
      for (let i = 0; i < 3; i++)
        for (let j = 0; j < 3; j++)
          r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
      return r;
    },
    apply: (m, v) => [
      m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
      m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
      m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
    ],
    transpose: (m) => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]],
    /** Tilt: rotation about the horizontal screen axis. */
    rotX(d) {
      const c = Math.cos(rad(d));
      const s = Math.sin(rad(d));
      return [1, 0, 0, 0, c, -s, 0, s, c];
    },
    /** Turn: rotation about the vertical screen axis. */
    rotY(d) {
      const c = Math.cos(rad(d));
      const s = Math.sin(rad(d));
      return [c, 0, s, 0, 1, 0, -s, 0, c];
    },
    /** Spin: rotation within the drawing plane. */
    rotZ(d) {
      const c = Math.cos(rad(d));
      const s = Math.sin(rad(d));
      return [c, -s, 0, s, c, 0, 0, 0, 1];
    },
    /** R = Rx(tilt) · Ry(turn) · Rz(spin): spin the art, turn it, then tilt it toward the viewer. */
    fromEuler(rx, ry, rz) {
      return M3.mul(M3.rotX(rx), M3.mul(M3.rotY(ry), M3.rotZ(rz)));
    },
    toEuler(m) {
      const sb = Math.max(-1, Math.min(1, m[2]));
      const b = Math.asin(sb);
      let a;
      let c;
      if (Math.abs(sb) < 0.99999) {
        a = Math.atan2(-m[5], m[8]);
        c = Math.atan2(-m[1], m[0]);
      } else {
        c = 0;
        a = sb > 0 ? Math.atan2(m[3], m[4]) : -Math.atan2(m[3], m[4]);
      }
      const clean = (v) => {
        let d = Math.round(deg(v) * 100) / 100;
        if (d === 0) d = 0;
        return d;
      };
      return { rx: clean(a), ry: clean(b), rz: clean(c) };
    },
    fromAxisAngle(axis, angleRad) {
      const [x, y, z] = V3.norm(axis);
      const c = Math.cos(angleRad);
      const s = Math.sin(angleRad);
      const t = 1 - c;
      return [
        t * x * x + c, t * x * y - s * z, t * x * z + s * y,
        t * x * y + s * z, t * y * y + c, t * y * z - s * x,
        t * x * z - s * y, t * y * z + s * x, t * z * z + c,
      ];
    },
  });

  /* ---------- 2D affine matrices [a b c d e f] (SVG convention) ---------- */
  const M2 = (V3D.M2 = {
    identity: () => [1, 0, 0, 1, 0, 0],
    isIdentity: (m) => m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0,
    /** m1 ∘ m2: applies m2 first, then m1. */
    mul: (m1, m2) => [
      m1[0] * m2[0] + m1[2] * m2[1],
      m1[1] * m2[0] + m1[3] * m2[1],
      m1[0] * m2[2] + m1[2] * m2[3],
      m1[1] * m2[2] + m1[3] * m2[3],
      m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
      m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
    ],
    invert(m) {
      const det = m[0] * m[3] - m[1] * m[2];
      if (Math.abs(det) < 1e-12) return M2.identity();
      const id = 1 / det;
      return [
        m[3] * id,
        -m[1] * id,
        -m[2] * id,
        m[0] * id,
        (m[2] * m[5] - m[3] * m[4]) * id,
        (m[1] * m[4] - m[0] * m[5]) * id,
      ];
    },
    apply: (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]],
    applyVec: (m, x, y) => [m[0] * x + m[2] * y, m[1] * x + m[3] * y],
    translate: (tx, ty) => [1, 0, 0, 1, tx, ty],
    scale: (sx, sy, cx = 0, cy = 0) => [sx, 0, 0, sy, cx - sx * cx, cy - sy * cy],
    rotate(d, cx = 0, cy = 0) {
      const c = Math.cos(rad(d));
      const s = Math.sin(rad(d));
      return [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy];
    },
    det: (m) => m[0] * m[3] - m[1] * m[2],
    /** Mean linear scale factor (for stroke widths, tolerances). */
    scaleFactor: (m) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1,
    rotation: (m) => deg(Math.atan2(m[1], m[0])),
    toString: (m) => 'matrix(' + m.map((v) => V3D.U.fmt(v, 5)).join(' ') + ')',
    equal: (a, b, eps = 1e-9) => a.every((v, i) => Math.abs(v - b[i]) < eps),
    /** Parses an SVG transform attribute into a matrix. */
    parse(str) {
      let m = M2.identity();
      if (!str) return m;
      const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
      let r;
      while ((r = re.exec(str))) {
        const a = (r[2].match(/[+-]?(?:\d*\.\d+|\d+\.?)(?:[eE][+-]?\d+)?/g) || []).map(Number);
        let t;
        switch (r[1]) {
          case 'matrix':
            t = a.length === 6 ? a : M2.identity();
            break;
          case 'translate':
            t = M2.translate(a[0] || 0, a[1] || 0);
            break;
          case 'scale':
            t = M2.scale(a[0] == null ? 1 : a[0], a[1] == null ? (a[0] == null ? 1 : a[0]) : a[1]);
            break;
          case 'rotate':
            t = M2.rotate(a[0] || 0, a[1] || 0, a[2] || 0);
            break;
          case 'skewX':
            t = [1, 0, Math.tan(rad(a[0] || 0)), 1, 0, 0];
            break;
          case 'skewY':
            t = [1, Math.tan(rad(a[0] || 0)), 0, 1, 0, 0];
            break;
        }
        m = M2.mul(m, t);
      }
      return m;
    },
  });

  /* ---------- rectangles ---------- */
  V3D.Rect = {
    empty: () => ({ x: Infinity, y: Infinity, x2: -Infinity, y2: -Infinity }),
    addPoint(r, x, y) {
      if (x < r.x) r.x = x;
      if (y < r.y) r.y = y;
      if (x > r.x2) r.x2 = x;
      if (y > r.y2) r.y2 = y;
      return r;
    },
    union(a, b) {
      if (!a) return b;
      if (!b) return a;
      return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), x2: Math.max(a.x2, b.x2), y2: Math.max(a.y2, b.y2) };
    },
    valid: (r) => r && isFinite(r.x) && isFinite(r.x2) && r.x2 >= r.x,
    w: (r) => r.x2 - r.x,
    h: (r) => r.y2 - r.y,
    cx: (r) => (r.x + r.x2) / 2,
    cy: (r) => (r.y + r.y2) / 2,
    fromPoints(x1, y1, x2, y2) {
      return { x: Math.min(x1, x2), y: Math.min(y1, y2), x2: Math.max(x1, x2), y2: Math.max(y1, y2) };
    },
    transform(r, m) {
      const out = V3D.Rect.empty();
      for (const [x, y] of [
        [r.x, r.y],
        [r.x2, r.y],
        [r.x2, r.y2],
        [r.x, r.y2],
      ]) {
        const p = M2.apply(m, x, y);
        V3D.Rect.addPoint(out, p[0], p[1]);
      }
      return out;
    },
    intersects: (a, b) => a.x <= b.x2 && a.x2 >= b.x && a.y <= b.y2 && a.y2 >= b.y,
    contains: (a, b) => b.x >= a.x && b.x2 <= a.x2 && b.y >= a.y && b.y2 <= a.y2,
    inflate: (r, d) => ({ x: r.x - d, y: r.y - d, x2: r.x2 + d, y2: r.y2 + d }),
  };
})();
