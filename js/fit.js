/* Vector 3Dit — fits smooth cubic beziers to point sequences
 * (Schneider, "An Algorithm for Automatically Fitting Digitized Curves", Graphics Gems 1990),
 * with corner detection so traced shapes keep their sharp corners. */
(function () {
  'use strict';
  const V3D = globalThis.V3D;
  const Fit = (V3D.Fit = {});

  const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
  const mul = (a, s) => [a[0] * s, a[1] * s];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
  const len = (a) => Math.hypot(a[0], a[1]);
  const norm = (a) => {
    const l = len(a) || 1;
    return [a[0] / l, a[1] / l];
  };

  const bez = (b, t) => {
    const mt = 1 - t;
    const a = mt * mt * mt;
    const c = 3 * mt * mt * t;
    const d = 3 * mt * t * t;
    const e = t * t * t;
    return [a * b[0][0] + c * b[1][0] + d * b[2][0] + e * b[3][0], a * b[0][1] + c * b[1][1] + d * b[2][1] + e * b[3][1]];
  };
  const bezD1 = (b, t) => {
    const mt = 1 - t;
    return [
      3 * mt * mt * (b[1][0] - b[0][0]) + 6 * mt * t * (b[2][0] - b[1][0]) + 3 * t * t * (b[3][0] - b[2][0]),
      3 * mt * mt * (b[1][1] - b[0][1]) + 6 * mt * t * (b[2][1] - b[1][1]) + 3 * t * t * (b[3][1] - b[2][1]),
    ];
  };
  const bezD2 = (b, t) => {
    const mt = 1 - t;
    return [
      6 * mt * (b[2][0] - 2 * b[1][0] + b[0][0]) + 6 * t * (b[3][0] - 2 * b[2][0] + b[1][0]),
      6 * mt * (b[2][1] - 2 * b[1][1] + b[0][1]) + 6 * t * (b[3][1] - 2 * b[2][1] + b[1][1]),
    ];
  };

  function chordParams(d, first, last) {
    const u = [0];
    for (let i = first + 1; i <= last; i++) u.push(u[u.length - 1] + len(sub(d[i], d[i - 1])));
    const total = u[u.length - 1] || 1;
    return u.map((v) => v / total);
  }

  function generate(d, first, last, u, t1, t2) {
    const p0 = d[first];
    const p3 = d[last];
    let c00 = 0;
    let c01 = 0;
    let c11 = 0;
    let x0 = 0;
    let x1 = 0;
    for (let i = 0; i < u.length; i++) {
      const t = u[i];
      const mt = 1 - t;
      const b0 = mt * mt * mt;
      const b1 = 3 * mt * mt * t;
      const b2 = 3 * mt * t * t;
      const b3 = t * t * t;
      const a1 = mul(t1, b1);
      const a2 = mul(t2, b2);
      c00 += dot(a1, a1);
      c01 += dot(a1, a2);
      c11 += dot(a2, a2);
      const tmp = sub(d[first + i], add(mul(p0, b0 + b1), mul(p3, b2 + b3)));
      x0 += dot(a1, tmp);
      x1 += dot(a2, tmp);
    }
    const det = c00 * c11 - c01 * c01;
    let al = 0;
    let ar = 0;
    if (Math.abs(det) > 1e-12) {
      al = (x0 * c11 - x1 * c01) / det;
      ar = (c00 * x1 - c01 * x0) / det;
    }
    const segLen = len(sub(p3, p0));
    const eps = 1e-6 * segLen;
    if (al < eps || ar < eps || al > segLen * 3 || ar > segLen * 3) {
      const dist = segLen / 3;
      return [p0, add(p0, mul(t1, dist)), add(p3, mul(t2, dist)), p3];
    }
    return [p0, add(p0, mul(t1, al)), add(p3, mul(t2, ar)), p3];
  }

  function maxError(d, first, last, b, u) {
    let max = 0;
    let split = Math.floor((first + last) / 2);
    for (let i = first + 1; i < last; i++) {
      const p = bez(b, u[i - first]);
      const e = (p[0] - d[i][0]) ** 2 + (p[1] - d[i][1]) ** 2;
      if (e >= max) {
        max = e;
        split = i;
      }
    }
    return [max, split];
  }

  function reparam(d, first, last, u, b) {
    return u.map((t, i) => {
      const p = d[first + i];
      const q = bez(b, t);
      const q1 = bezD1(b, t);
      const q2 = bezD2(b, t);
      const num = (q[0] - p[0]) * q1[0] + (q[1] - p[1]) * q1[1];
      const den = q1[0] * q1[0] + q1[1] * q1[1] + (q[0] - p[0]) * q2[0] + (q[1] - p[1]) * q2[1];
      if (Math.abs(den) < 1e-12) return t;
      const r = t - num / den;
      return r < 0 ? 0 : r > 1 ? 1 : r;
    });
  }

  function fitCubic(d, first, last, t1, t2, err, out, depth, span) {
    const n = last - first + 1;
    if (n === 2 || depth > 40) {
      const dist = len(sub(d[last], d[first])) / 3;
      out.push([d[first], add(d[first], mul(t1, dist)), add(d[last], mul(t2, dist)), d[last]]);
      return;
    }
    let u = chordParams(d, first, last);
    let b = generate(d, first, last, u, t1, t2);
    let [me, split] = maxError(d, first, last, b, u);
    const err2 = err * err;
    // Newton reparameterization rescues most fits that chord-length parameters miss.
    for (let it = 0; it < 8 && me >= err2; it++) {
      const up = reparam(d, first, last, u, b);
      const b2 = generate(d, first, last, up, t1, t2);
      const [me2, split2] = maxError(d, first, last, b2, up);
      if (me2 >= me * 0.995) break;
      b = b2;
      me = me2;
      split = split2;
      u = up;
    }
    if (me < err2) {
      out.push(b);
      return;
    }
    if (split <= first) split = first + 1;
    if (split >= last) split = last - 1;
    // Tangent at the split from points about `span` away on either side (robust to pixel noise).
    const a = walkIdx(d, split, -1, span, first);
    const c = walkIdx(d, split, 1, span, last);
    let tc = sub(d[a], d[c]);
    if (len(tc) < 1e-12) tc = sub(d[split - 1], d[split + 1]);
    tc = norm(tc);
    fitCubic(d, first, split, t1, tc, err, out, depth + 1, span);
    fitCubic(d, split, last, mul(tc, -1), t2, err, out, depth + 1, span);
  }

  function walkIdx(d, i, dir, span, bound) {
    let acc = 0;
    let j = i;
    while (acc < span && j !== bound) {
      const k = j + dir;
      acc += len(sub(d[k], d[j]));
      j = k;
    }
    return j;
  }

  /** Tangent sampling distance: long enough to average out jitter, short enough to stay local. */
  function tanSpan(run, minSpan) {
    let L = 0;
    for (let i = 1; i < run.length; i++) L += len(sub(run[i], run[i - 1]));
    return Math.max(minSpan, Math.min(L * 0.04, 24));
  }

  /**
   * Tangent at index i pointing along `dir`, sampled ~`span` away. Richardson
   * extrapolation (2·chord(s/2) − chord(s)) cancels the bias a plain chord has on curves.
   */
  function tangentAt(d, i, dir, span) {
    const n = d.length;
    const walk = (target) => {
      let acc = 0;
      let j = i;
      while (acc < target) {
        const k = j + dir;
        if (k < 0 || k >= n) break;
        acc += len(sub(d[k], d[j]));
        j = k;
      }
      return j;
    };
    const jf = walk(span);
    if (jf === i) return dir > 0 ? [1, 0] : [-1, 0];
    const jh = walk(span / 2);
    const cf = norm(sub(d[jf], d[i]));
    if (jh === i || jh === jf) return cf;
    const ch = norm(sub(d[jh], d[i]));
    const t = [2 * ch[0] - cf[0], 2 * ch[1] - cf[1]];
    return len(t) > 1e-9 ? norm(t) : cf;
  }

  /** Makes nearly straight cubics into exact lines (handles collapse onto the nodes). */
  function straighten(segs, tol) {
    for (const s of segs) {
      const [p0, p1, p2, p3] = s;
      const L = len(sub(p3, p0));
      if (L < 1e-9) continue;
      const dl = (p) => Math.abs((p3[0] - p0[0]) * (p0[1] - p[1]) - (p0[0] - p[0]) * (p3[1] - p0[1])) / L;
      const along = (p) => dot(sub(p, p0), sub(p3, p0)) / (L * L);
      if (dl(p1) < tol && dl(p2) < tol && along(p1) > -0.05 && along(p2) < 1.05) {
        s[1] = p0.slice();
        s[2] = p3.slice();
      }
    }
    return segs;
  }

  /** Fits an open polyline; corners (turns sharper than cornerDeg) stay sharp. */
  Fit.open = (pts, err = 1, opts = {}) => {
    const d = dedupe(pts, 1e-6);
    if (d.length < 2) return [];
    if (d.length === 2) return [[d[0], d[0].slice(), d[1].slice(), d[1]]];
    const corners = opts.cornerDeg ? findCorners(d, opts.cornerDeg, false, opts.span || err * 3) : [];
    const breaks = [0, ...corners.filter((c) => c > 0 && c < d.length - 1), d.length - 1];
    const out = [];
    const span = opts.span || Math.max(err * 2, 1.5);
    for (let k = 0; k < breaks.length - 1; k++) {
      const a = breaks[k];
      const b = breaks[k + 1];
      if (b - a < 1) continue;
      const run = d.slice(a, b + 1);
      const ts = tanSpan(run, span);
      const t1 = tangentAt(run, 0, 1, ts);
      const t2 = tangentAt(run, run.length - 1, -1, ts);
      fitCubic(run, 0, run.length - 1, t1, t2, err, out, 0, ts);
    }
    return straighten(out, Math.max(err * 0.3, 0.05));
  };

  /** Fits a closed loop. Returns cubic segments forming a closed run. */
  Fit.closed = (pts, err = 1, opts = {}) => {
    const d = dedupe(pts, 1e-6, true);
    if (d.length < 3) return [];
    const span = opts.span || Math.max(err * 2, 1.5);
    const corners = findCorners(d, opts.cornerDeg || 60, true, span);
    const n = d.length;
    const out = [];
    if (!corners.length) {
      // No corners: start anywhere with a shared tangent measured across the seam.
      const ring = d.concat([d[0]]);
      const ts = tanSpan(ring, span);
      const k = Math.max(1, walkIdx(ring, 0, 1, ts, ring.length - 1));
      const back = d.slice().reverse();
      const kb = Math.max(1, walkIdx(back, 0, 1, ts, back.length - 1));
      const tanFwd = norm(sub(d[k], back[kb]));
      fitCubic(ring, 0, ring.length - 1, tanFwd, mul(tanFwd, -1), err, out, 0, ts);
      return straighten(out, Math.max(err * 0.3, 0.05));
    }
    for (let k = 0; k < corners.length; k++) {
      const a = corners[k];
      const b = corners[(k + 1) % corners.length];
      const run = [];
      let i = a;
      for (;;) {
        run.push(d[i]);
        if (i === b && run.length > 1) break;
        i = (i + 1) % n;
        if (run.length > n + 1) break;
      }
      if (run.length < 2) continue;
      const ts = tanSpan(run, span);
      const t1 = tangentAt(run, 0, 1, ts);
      const t2 = tangentAt(run, run.length - 1, -1, ts);
      fitCubic(run, 0, run.length - 1, t1, t2, err, out, 0, ts);
    }
    return straighten(out, Math.max(err * 0.3, 0.05));
  };

  function dedupe(pts, eps, closed) {
    const out = [];
    for (const p of pts) {
      const l = out[out.length - 1];
      if (!l || Math.abs(l[0] - p[0]) > eps || Math.abs(l[1] - p[1]) > eps) out.push([p[0], p[1]]);
    }
    if (closed && out.length > 2) {
      const f = out[0];
      const l = out[out.length - 1];
      if (Math.abs(l[0] - f[0]) <= eps && Math.abs(l[1] - f[1]) <= eps) out.pop();
    }
    return out;
  }

  /** Indices where the direction turns by more than `deg`, measured over ~`span` of arc length. */
  function findCorners(d, deg, closed, span) {
    const n = d.length;
    const cosT = Math.cos((deg * Math.PI) / 180);
    const turn = new Float64Array(n);
    const walk = (i, dir) => {
      let acc = 0;
      let j = i;
      let steps = 0;
      while (acc < span && steps < n / 2) {
        let k = j + dir;
        if (closed) k = (k + n) % n;
        else if (k < 0 || k >= n) break;
        acc += len(sub(d[k], d[j]));
        j = k;
        steps++;
      }
      return j;
    };
    for (let i = 0; i < n; i++) {
      if (!closed && (i === 0 || i === n - 1)) continue;
      const a = walk(i, -1);
      const b = walk(i, 1);
      if (a === i || b === i) continue;
      const v1 = norm(sub(d[i], d[a]));
      const v2 = norm(sub(d[b], d[i]));
      turn[i] = 1 - dot(v1, v2); // 0 straight … 2 reversal
    }
    const thr = 1 - cosT;
    const res = [];
    for (let i = 0; i < n; i++) {
      if (turn[i] <= thr) continue;
      // Keep only the local maximum within the span window.
      let isMax = true;
      for (let k = -3; k <= 3 && isMax; k++) {
        if (!k) continue;
        let j = i + k;
        if (closed) j = (j + n) % n;
        else if (j < 0 || j >= n) continue;
        if (turn[j] > turn[i] || (turn[j] === turn[i] && j < i)) isMax = false;
      }
      if (isMax) res.push(i);
    }
    return res;
  }
  Fit.findCorners = findCorners;
})();
