/* Vector 3Dit — bezier path model.
 * A path is a list of subpaths: { closed, nodes: [{x, y, ix, iy, ox, oy, t}] }
 * (ix,iy) is the incoming handle and (ox,oy) the outgoing handle, both absolute.
 * A handle equal to its node means "no handle". Node type t: 'c' corner, 's' smooth, 'z' symmetric. */
(function () {
  'use strict';
  const V3D = globalThis.V3D;
  const { fmt } = V3D.U;
  const M2 = V3D.M2;

  /* ---------- cubic bezier helpers ---------- */
  const Bez = (V3D.Bez = {
    point(p0, p1, p2, p3, t) {
      const mt = 1 - t;
      const a = mt * mt * mt;
      const b = 3 * mt * mt * t;
      const c = 3 * mt * t * t;
      const d = t * t * t;
      return [a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]];
    },
    deriv(p0, p1, p2, p3, t) {
      const mt = 1 - t;
      const a = 3 * mt * mt;
      const b = 6 * mt * t;
      const c = 3 * t * t;
      return [
        a * (p1[0] - p0[0]) + b * (p2[0] - p1[0]) + c * (p3[0] - p2[0]),
        a * (p1[1] - p0[1]) + b * (p2[1] - p1[1]) + c * (p3[1] - p2[1]),
      ];
    },
    /** de Casteljau split → [left, right] each [p0,p1,p2,p3]. */
    split(p0, p1, p2, p3, t) {
      const l = (a, b) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      const p01 = l(p0, p1);
      const p12 = l(p1, p2);
      const p23 = l(p2, p3);
      const p012 = l(p01, p12);
      const p123 = l(p12, p23);
      const m = l(p012, p123);
      return [
        [p0, p01, p012, m],
        [m, p123, p23, p3],
      ];
    },
    /** Parameter values of the x/y extrema in (0,1). */
    extrema(p0, p1, p2, p3) {
      const ts = [];
      for (let k = 0; k < 2; k++) {
        const a = -p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k];
        const b = 2 * (p0[k] - 2 * p1[k] + p2[k]);
        const c = p1[k] - p0[k];
        if (Math.abs(a) < 1e-12) {
          if (Math.abs(b) > 1e-12) ts.push(-c / b);
        } else {
          const disc = b * b - 4 * a * c;
          if (disc >= 0) {
            const sq = Math.sqrt(disc);
            ts.push((-b + sq) / (2 * a), (-b - sq) / (2 * a));
          }
        }
      }
      return ts.filter((t) => t > 0 && t < 1);
    },
    flatness(p0, p1, p2, p3) {
      const ux = 3 * p1[0] - 2 * p0[0] - p3[0];
      const uy = 3 * p1[1] - 2 * p0[1] - p3[1];
      const vx = 3 * p2[0] - 2 * p3[0] - p0[0];
      const vy = 3 * p2[1] - 2 * p3[1] - p0[1];
      return Math.max(ux * ux, vx * vx) + Math.max(uy * uy, vy * vy);
    },
  });

  const Path = (V3D.Path = {});

  Path.node = (x, y, t = 'c') => ({ x, y, ix: x, iy: y, ox: x, oy: y, t });
  Path.hasIn = (n) => Math.abs(n.ix - n.x) > 1e-9 || Math.abs(n.iy - n.y) > 1e-9;
  Path.hasOut = (n) => Math.abs(n.ox - n.x) > 1e-9 || Math.abs(n.oy - n.y) > 1e-9;
  Path.segCount = (sub) => (sub.nodes.length < 2 ? 0 : sub.closed ? sub.nodes.length : sub.nodes.length - 1);
  /** Segment i as [p0, c1, c2, p3, isLine]. */
  Path.seg = (sub, i) => {
    const a = sub.nodes[i];
    const b = sub.nodes[(i + 1) % sub.nodes.length];
    const line = !Path.hasOut(a) && !Path.hasIn(b);
    return [[a.x, a.y], [a.ox, a.oy], [b.ix, b.iy], [b.x, b.y], line];
  };
  Path.clone = (subs) => subs.map((s) => ({ closed: s.closed, nodes: s.nodes.map((n) => ({ ...n })) }));

  /** Builds subpaths from cubic segment runs: runs = [{closed, segs:[[p0,p1,p2,p3],...]}]. */
  Path.fromCubicRuns = (runs) =>
    runs.map((run) => {
      const nodes = [];
      run.segs.forEach((s, i) => {
        if (i === 0) nodes.push({ x: s[0][0], y: s[0][1], ix: s[0][0], iy: s[0][1], ox: s[1][0], oy: s[1][1], t: 'c' });
        else {
          const n = nodes[nodes.length - 1];
          n.ox = s[1][0];
          n.oy = s[1][1];
        }
        nodes.push({ x: s[3][0], y: s[3][1], ix: s[2][0], iy: s[2][1], ox: s[3][0], oy: s[3][1], t: 'c' });
      });
      if (run.closed && nodes.length > 1) {
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        if (Math.hypot(first.x - last.x, first.y - last.y) < 1e-6) {
          first.ix = last.ix;
          first.iy = last.iy;
          nodes.pop();
        }
      }
      const sub = { closed: !!run.closed, nodes };
      Path.inferTypes(sub);
      return sub;
    });

  Path.fromPolyline = (pts, closed) => ({ closed, nodes: pts.map((p) => Path.node(p[0], p[1])) });

  /** Marks nodes whose handles are collinear as smooth. */
  Path.inferTypes = (sub) => {
    for (const n of sub.nodes) {
      if (!Path.hasIn(n) || !Path.hasOut(n)) {
        n.t = 'c';
        continue;
      }
      const ax = n.x - n.ix;
      const ay = n.y - n.iy;
      const bx = n.ox - n.x;
      const by = n.oy - n.y;
      const la = Math.hypot(ax, ay);
      const lb = Math.hypot(bx, by);
      const cross = (ax * by - ay * bx) / (la * lb);
      const dot = (ax * bx + ay * by) / (la * lb);
      if (Math.abs(cross) < 0.02 && dot > 0) n.t = Math.abs(la - lb) < 0.01 * Math.max(la, lb) ? 'z' : 's';
      else n.t = 'c';
    }
    return sub;
  };

  /* ---------- SVG path data parsing ---------- */
  Path.parse = (d) => {
    const subs = [];
    if (!d) return subs;
    const tokens = String(d).match(/[a-df-z]|[+-]?(?:\d*\.\d+|\d+\.?)(?:[eE][+-]?\d+)?/gi) || [];
    let i = 0;
    let cmd = '';
    let cx = 0;
    let cy = 0;
    let sx = 0;
    let sy = 0;
    let cur = null;
    let lastC2 = null; // reflected control for S/T
    let lastQ = null;
    let prevCmd = '';
    const num = () => parseFloat(tokens[i++]);
    const isNum = () => i < tokens.length && !/^[a-z]$/i.test(tokens[i]);
    const start = (x, y) => {
      cur = { closed: false, nodes: [Path.node(x, y)] };
      subs.push(cur);
    };
    const ensure = () => {
      if (!cur) start(cx, cy);
    };
    const lineTo = (x, y) => {
      ensure();
      cur.nodes.push(Path.node(x, y));
    };
    const curveTo = (x1, y1, x2, y2, x, y) => {
      ensure();
      const last = cur.nodes[cur.nodes.length - 1];
      last.ox = x1;
      last.oy = y1;
      const n = Path.node(x, y);
      n.ix = x2;
      n.iy = y2;
      cur.nodes.push(n);
    };
    while (i < tokens.length) {
      if (/^[a-z]$/i.test(tokens[i])) cmd = tokens[i++];
      else if (!cmd) {
        i++;
        continue;
      }
      const rel = cmd === cmd.toLowerCase();
      const C = cmd.toUpperCase();
      if (C === 'Z') {
        if (cur) {
          cur.closed = true;
          cx = sx;
          cy = sy;
          cur = null;
        }
        prevCmd = 'Z';
        lastC2 = lastQ = null;
        continue;
      }
      if (!isNum()) {
        cmd = '';
        continue;
      }
      switch (C) {
        case 'M': {
          let x = num();
          let y = num();
          if (rel) {
            x += cx;
            y += cy;
          }
          start(x, y);
          cx = sx = x;
          cy = sy = y;
          cmd = rel ? 'l' : 'L';
          lastC2 = lastQ = null;
          break;
        }
        case 'L': {
          let x = num();
          let y = num();
          if (rel) {
            x += cx;
            y += cy;
          }
          lineTo(x, y);
          cx = x;
          cy = y;
          lastC2 = lastQ = null;
          break;
        }
        case 'H': {
          let x = num();
          if (rel) x += cx;
          lineTo(x, cy);
          cx = x;
          lastC2 = lastQ = null;
          break;
        }
        case 'V': {
          let y = num();
          if (rel) y += cy;
          lineTo(cx, y);
          cy = y;
          lastC2 = lastQ = null;
          break;
        }
        case 'C': {
          const a = [num(), num(), num(), num(), num(), num()];
          if (rel) for (let k = 0; k < 6; k += 2) (a[k] += cx), (a[k + 1] += cy);
          curveTo(...a);
          lastC2 = [a[2], a[3]];
          lastQ = null;
          cx = a[4];
          cy = a[5];
          break;
        }
        case 'S': {
          const a = [num(), num(), num(), num()];
          if (rel) for (let k = 0; k < 4; k += 2) (a[k] += cx), (a[k + 1] += cy);
          const r = lastC2 && /[CS]/i.test(prevCmd) ? [2 * cx - lastC2[0], 2 * cy - lastC2[1]] : [cx, cy];
          curveTo(r[0], r[1], a[0], a[1], a[2], a[3]);
          lastC2 = [a[0], a[1]];
          lastQ = null;
          cx = a[2];
          cy = a[3];
          break;
        }
        case 'Q': {
          const a = [num(), num(), num(), num()];
          if (rel) for (let k = 0; k < 4; k += 2) (a[k] += cx), (a[k + 1] += cy);
          curveTo(
            cx + (2 / 3) * (a[0] - cx), cy + (2 / 3) * (a[1] - cy),
            a[2] + (2 / 3) * (a[0] - a[2]), a[3] + (2 / 3) * (a[1] - a[3]),
            a[2], a[3]
          );
          lastQ = [a[0], a[1]];
          lastC2 = null;
          cx = a[2];
          cy = a[3];
          break;
        }
        case 'T': {
          const a = [num(), num()];
          if (rel) (a[0] += cx), (a[1] += cy);
          const q = lastQ && /[QT]/i.test(prevCmd) ? [2 * cx - lastQ[0], 2 * cy - lastQ[1]] : [cx, cy];
          curveTo(
            cx + (2 / 3) * (q[0] - cx), cy + (2 / 3) * (q[1] - cy),
            a[0] + (2 / 3) * (q[0] - a[0]), a[1] + (2 / 3) * (q[1] - a[1]),
            a[0], a[1]
          );
          lastQ = q;
          lastC2 = null;
          cx = a[0];
          cy = a[1];
          break;
        }
        case 'A': {
          const rx = num();
          const ry = num();
          const rot = num();
          const fa = num();
          const fs = num();
          let x = num();
          let y = num();
          if (rel) {
            x += cx;
            y += cy;
          }
          const curves = Path.arcToCubics(cx, cy, rx, ry, rot, fa, fs, x, y);
          if (!curves.length) lineTo(x, y);
          for (const c of curves) curveTo(c[0], c[1], c[2], c[3], c[4], c[5]);
          cx = x;
          cy = y;
          lastC2 = lastQ = null;
          break;
        }
        default:
          i++;
      }
      prevCmd = C;
    }
    // Merge a closing node that duplicates the start point.
    for (const s of subs) {
      if (s.closed && s.nodes.length > 1) {
        const f = s.nodes[0];
        const l = s.nodes[s.nodes.length - 1];
        if (Math.abs(f.x - l.x) < 1e-6 && Math.abs(f.y - l.y) < 1e-6) {
          f.ix = l.ix;
          f.iy = l.iy;
          s.nodes.pop();
        }
      }
      Path.inferTypes(s);
    }
    return subs.filter((s) => s.nodes.length > 0);
  };

  /** SVG elliptical arc → cubic segments [[x1,y1,x2,y2,x,y], ...]. */
  Path.arcToCubics = (x1, y1, rx, ry, angle, largeArc, sweep, x2, y2) => {
    if (rx === 0 || ry === 0) return [];
    if (x1 === x2 && y1 === y2) return [];
    rx = Math.abs(rx);
    ry = Math.abs(ry);
    const phi = (angle * Math.PI) / 180;
    const cp = Math.cos(phi);
    const sp = Math.sin(phi);
    const dx = (x1 - x2) / 2;
    const dy = (y1 - y2) / 2;
    const x1p = cp * dx + sp * dy;
    const y1p = -sp * dx + cp * dy;
    const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
    if (lam > 1) {
      rx *= Math.sqrt(lam);
      ry *= Math.sqrt(lam);
    }
    const sign = largeArc == sweep ? -1 : 1; // eslint-disable-line eqeqeq
    const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
    const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
    const co = sign * Math.sqrt(Math.max(0, num / den));
    const cxp = (co * rx * y1p) / ry;
    const cyp = (-co * ry * x1p) / rx;
    const cx = cp * cxp - sp * cyp + (x1 + x2) / 2;
    const cy = sp * cxp + cp * cyp + (y1 + y2) / 2;
    const ang = (ux, uy, vx, vy) => {
      const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
      return a;
    };
    let t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
    let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
    if (!sweep && dt > 0) dt -= 2 * Math.PI;
    else if (sweep && dt < 0) dt += 2 * Math.PI;
    const n = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2) - 1e-9));
    const d = dt / n;
    const k = (4 / 3) * Math.tan(d / 4);
    const out = [];
    const pt = (t) => [cx + rx * Math.cos(t) * cp - ry * Math.sin(t) * sp, cy + rx * Math.cos(t) * sp + ry * Math.sin(t) * cp];
    const der = (t) => [-rx * Math.sin(t) * cp - ry * Math.cos(t) * sp, -rx * Math.sin(t) * sp + ry * Math.cos(t) * cp];
    for (let i = 0; i < n; i++) {
      const a = t1 + i * d;
      const b = a + d;
      const pa = pt(a);
      const pb = pt(b);
      const da = der(a);
      const db = der(b);
      out.push([pa[0] + k * da[0], pa[1] + k * da[1], pb[0] - k * db[0], pb[1] - k * db[1], pb[0], pb[1]]);
    }
    // Snap the final point exactly.
    out[out.length - 1][4] = x2;
    out[out.length - 1][5] = y2;
    return out;
  };

  /* ---------- serialization ---------- */
  Path.toD = (subs, p = 2) => {
    let d = '';
    for (const s of subs) {
      const ns = s.nodes;
      if (!ns.length) continue;
      d += 'M' + fmt(ns[0].x, p) + ' ' + fmt(ns[0].y, p);
      const cnt = Path.segCount(s);
      for (let i = 0; i < cnt; i++) {
        const a = ns[i];
        const b = ns[(i + 1) % ns.length];
        const closing = s.closed && i === ns.length - 1;
        if (!Path.hasOut(a) && !Path.hasIn(b)) {
          if (!closing) d += 'L' + fmt(b.x, p) + ' ' + fmt(b.y, p);
        } else {
          d += 'C' + fmt(a.ox, p) + ' ' + fmt(a.oy, p) + ' ' + fmt(b.ix, p) + ' ' + fmt(b.iy, p) + ' ' + fmt(b.x, p) + ' ' + fmt(b.y, p);
        }
      }
      if (s.closed) d += 'Z';
    }
    return d;
  };

  /** Polylines → SVG path data. */
  Path.polysToD = (polys, p = 2) => {
    let d = '';
    for (const poly of polys) {
      const pts = poly.pts || poly;
      if (pts.length < 2) continue;
      d += 'M' + fmt(pts[0][0], p) + ' ' + fmt(pts[0][1], p);
      for (let i = 1; i < pts.length; i++) d += 'L' + fmt(pts[i][0], p) + ' ' + fmt(pts[i][1], p);
      if (poly.closed !== false) d += 'Z';
    }
    return d;
  };

  /* ---------- geometry ---------- */
  Path.transform = (subs, m) => {
    if (M2.isIdentity(m)) return Path.clone(subs);
    return subs.map((s) => ({
      closed: s.closed,
      nodes: s.nodes.map((n) => {
        const p = M2.apply(m, n.x, n.y);
        const i = M2.apply(m, n.ix, n.iy);
        const o = M2.apply(m, n.ox, n.oy);
        return { x: p[0], y: p[1], ix: i[0], iy: i[1], ox: o[0], oy: o[1], t: n.t };
      }),
    }));
  };

  Path.bbox = (subs) => {
    const r = V3D.Rect.empty();
    for (const s of subs) {
      if (!s.nodes.length) continue;
      for (const n of s.nodes) V3D.Rect.addPoint(r, n.x, n.y);
      const cnt = Path.segCount(s);
      for (let i = 0; i < cnt; i++) {
        const [p0, p1, p2, p3, line] = Path.seg(s, i);
        if (line) continue;
        for (const t of Bez.extrema(p0, p1, p2, p3)) {
          const q = Bez.point(p0, p1, p2, p3, t);
          V3D.Rect.addPoint(r, q[0], q[1]);
        }
      }
    }
    return r;
  };

  /** Flattens to polylines with max deviation `tol`. Returns [{closed, pts}]. */
  Path.flatten = (subs, tol = 0.25, maxSeg = Infinity) => {
    const tol2 = 16 * tol * tol;
    const out = [];
    for (const s of subs) {
      if (!s.nodes.length) continue;
      const pts = [[s.nodes[0].x, s.nodes[0].y]];
      const cnt = Path.segCount(s);
      const rec = (p0, p1, p2, p3, depth) => {
        if (depth > 14 || Bez.flatness(p0, p1, p2, p3) <= tol2) {
          pts.push(p3);
          return;
        }
        const [l, r] = Bez.split(p0, p1, p2, p3, 0.5);
        rec(l[0], l[1], l[2], l[3], depth + 1);
        rec(r[0], r[1], r[2], r[3], depth + 1);
      };
      for (let i = 0; i < cnt; i++) {
        const [p0, p1, p2, p3, line] = Path.seg(s, i);
        if (line) pts.push(p3);
        else rec(p0, p1, p2, p3, 0);
      }
      if (s.closed && pts.length > 1) {
        const f = pts[0];
        const l = pts[pts.length - 1];
        if (Math.abs(f[0] - l[0]) < 1e-9 && Math.abs(f[1] - l[1]) < 1e-9) pts.pop();
      }
      // Split very long straight runs so 3D depth sorting stays stable.
      let res = pts;
      if (isFinite(maxSeg)) {
        res = [];
        const n = pts.length;
        const segs = s.closed ? n : n - 1;
        for (let i = 0; i < n; i++) {
          res.push(pts[i]);
          if (i >= segs) continue;
          const a = pts[i];
          const b = pts[(i + 1) % n];
          const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
          const k = Math.ceil(L / maxSeg);
          for (let j = 1; j < k; j++) res.push([a[0] + ((b[0] - a[0]) * j) / k, a[1] + ((b[1] - a[1]) * j) / k]);
        }
      }
      out.push({ closed: s.closed, pts: res });
    }
    return out;
  };

  Path.reverse = (subs) =>
    subs.map((s) => ({
      closed: s.closed,
      nodes: s.nodes
        .slice()
        .reverse()
        .map((n) => ({ x: n.x, y: n.y, ix: n.ox, iy: n.oy, ox: n.ix, oy: n.iy, t: n.t })),
    }));

  /** Inserts a node into segment `seg` of subpath `sub` at parameter t. Returns new node index. */
  Path.splitSegment = (sub, seg, t) => {
    const n = sub.nodes.length;
    const a = sub.nodes[seg];
    const b = sub.nodes[(seg + 1) % n];
    const [p0, p1, p2, p3, line] = Path.seg(sub, seg);
    let node;
    if (line) {
      const x = p0[0] + (p3[0] - p0[0]) * t;
      const y = p0[1] + (p3[1] - p0[1]) * t;
      node = Path.node(x, y, 'c');
    } else {
      const [l, r] = Bez.split(p0, p1, p2, p3, t);
      a.ox = l[1][0];
      a.oy = l[1][1];
      b.ix = r[2][0];
      b.iy = r[2][1];
      node = { x: l[3][0], y: l[3][1], ix: l[2][0], iy: l[2][1], ox: r[1][0], oy: r[1][1], t: 's' };
    }
    sub.nodes.splice(seg + 1, 0, node);
    return seg + 1;
  };

  /** Closest point on the path to (x, y). */
  Path.nearest = (subs, x, y) => {
    let best = null;
    subs.forEach((s, si) => {
      const cnt = Path.segCount(s);
      for (let i = 0; i < cnt; i++) {
        const [p0, p1, p2, p3] = Path.seg(s, i);
        let bt = 0;
        let bd = Infinity;
        const N = 32;
        for (let k = 0; k <= N; k++) {
          const t = k / N;
          const q = Bez.point(p0, p1, p2, p3, t);
          const d = (q[0] - x) ** 2 + (q[1] - y) ** 2;
          if (d < bd) {
            bd = d;
            bt = t;
          }
        }
        let step = 1 / N;
        for (let it = 0; it < 12; it++) {
          step /= 2;
          for (const t of [bt - step, bt + step]) {
            if (t < 0 || t > 1) continue;
            const q = Bez.point(p0, p1, p2, p3, t);
            const d = (q[0] - x) ** 2 + (q[1] - y) ** 2;
            if (d < bd) {
              bd = d;
              bt = t;
            }
          }
        }
        if (!best || bd < best.d2) {
          const q = Bez.point(p0, p1, p2, p3, bt);
          best = { sub: si, seg: i, t: bt, d2: bd, x: q[0], y: q[1] };
        }
      }
    });
    if (best) best.d = Math.sqrt(best.d2);
    return best;
  };

  /** Point count, for status display. */
  Path.nodeCount = (subs) => subs.reduce((a, s) => a + s.nodes.length, 0);
})();
