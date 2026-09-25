/* Vector 3Dit — raster tracing.
 * Marching squares with sub-pixel interpolation turns an anti-aliased coverage
 * mask into smooth contours; the curve fitter then turns those into beziers.
 * Text outlines, boolean operations, stroke-to-path, offsets and bitmap tracing
 * all use this pipeline: rasterize with the browser, trace back to vectors. */
(function () {
  'use strict';
  const V3D = globalThis.V3D;
  const Trace = (V3D.Trace = {});

  /**
   * Contours of `field` (length W*H, row-major) at level `iso`.
   * Pixel (x, y) is sampled at its centre (x + .5, y + .5). Out-of-range samples count as 0.
   * Returns closed loops [[x, y], ...] in pixel coordinates.
   */
  Trace.contours = (field, W, H, iso = 127.5) => {
    const W2 = W + 2;
    const get = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : field[y * W + x]);
    const hKey = (x, y) => ((y + 1) * W2 + (x + 1)) * 2;
    const vKey = (x, y) => ((y + 1) * W2 + (x + 1)) * 2 + 1;
    const next = new Map();
    const pts = new Map();
    const lerp = (a, b) => {
      const d = b - a;
      return Math.abs(d) < 1e-9 ? 0.5 : Math.min(1, Math.max(0, (iso - a) / d));
    };
    for (let y = -1; y < H; y++) {
      for (let x = -1; x < W; x++) {
        const tl = get(x, y);
        const tr = get(x + 1, y);
        const br = get(x + 1, y + 1);
        const bl = get(x, y + 1);
        const c = (tl > iso ? 8 : 0) | (tr > iso ? 4 : 0) | (br > iso ? 2 : 0) | (bl > iso ? 1 : 0);
        if (c === 0 || c === 15) continue;
        const T = () => {
          const k = hKey(x, y);
          if (!pts.has(k)) pts.set(k, [x + lerp(tl, tr) + 0.5, y + 0.5]);
          return k;
        };
        const B = () => {
          const k = hKey(x, y + 1);
          if (!pts.has(k)) pts.set(k, [x + lerp(bl, br) + 0.5, y + 1.5]);
          return k;
        };
        const L = () => {
          const k = vKey(x, y);
          if (!pts.has(k)) pts.set(k, [x + 0.5, y + lerp(tl, bl) + 0.5]);
          return k;
        };
        const R = () => {
          const k = vKey(x + 1, y);
          if (!pts.has(k)) pts.set(k, [x + 1.5, y + lerp(tr, br) + 0.5]);
          return k;
        };
        const seg = (a, b) => next.set(a(), b());
        switch (c) {
          case 1: seg(L, B); break;
          case 2: seg(B, R); break;
          case 3: seg(L, R); break;
          case 4: seg(R, T); break;
          case 6: seg(B, T); break;
          case 7: seg(L, T); break;
          case 8: seg(T, L); break;
          case 9: seg(T, B); break;
          case 11: seg(T, R); break;
          case 12: seg(R, L); break;
          case 13: seg(R, B); break;
          case 14: seg(B, L); break;
          case 5:
            if ((tl + tr + br + bl) / 4 > iso) {
              seg(L, T);
              seg(R, B);
            } else {
              seg(L, B);
              seg(R, T);
            }
            break;
          case 10:
            if ((tl + tr + br + bl) / 4 > iso) {
              seg(T, R);
              seg(B, L);
            } else {
              seg(T, L);
              seg(B, R);
            }
            break;
        }
      }
    }
    const loops = [];
    const seen = new Set();
    for (const start of next.keys()) {
      if (seen.has(start)) continue;
      const loop = [];
      let k = start;
      let guard = 0;
      while (k != null && !seen.has(k) && guard++ < 1e7) {
        seen.add(k);
        loop.push(pts.get(k));
        k = next.get(k);
      }
      if (loop.length >= 3) loops.push(loop);
    }
    return loops;
  };

  /** Contours → fitted bezier subpaths, mapped through `map(x, y) → [x, y]`. */
  Trace.loopsToSubpaths = (loops, opts = {}) => {
    const err = opts.error == null ? 0.45 : opts.error;
    const minArea = opts.minArea == null ? 2 : opts.minArea;
    const map = opts.map || ((x, y) => [x, y]);
    const runs = [];
    for (let loop of loops) {
      if (Math.abs(V3D.Poly.area(loop)) < minArea) continue;
      let segs;
      // One light smoothing pass removes the sub-pixel jitter of marching squares.
      if (opts.smooth !== false && loop.length > 8) {
        const n = loop.length;
        const passes = opts.smoothPasses == null ? 0 : opts.smoothPasses;
        for (let k = 0; k < passes; k++) {
          const src = loop;
          loop = src.map((p, i) => {
            const a = src[(i - 1 + n) % n];
            const b = src[(i + 1) % n];
            return [(a[0] + 2 * p[0] + b[0]) / 4, (a[1] + 2 * p[1] + b[1]) / 4];
          });
        }
      }
      if (opts.polygon) {
        const simp = V3D.Poly.rdp(loop.concat([loop[0]]), err).slice(0, -1);
        segs = simp.map((p, i) => {
          const q = simp[(i + 1) % simp.length];
          return [p, p, q, q];
        });
      } else {
        segs = V3D.Fit.closed(loop, err, { cornerDeg: opts.cornerDeg || 55, span: opts.span || 2.5 });
      }
      if (!segs.length) continue;
      runs.push({
        closed: true,
        segs: segs.map((s) => s.map((p) => map(p[0], p[1]))),
      });
    }
    return V3D.Path.fromCubicRuns(runs);
  };

  /* ---------------- browser rasterization helpers ---------------- */

  const canvasOf = (w, h) => {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w));
    c.height = Math.max(1, Math.ceil(h));
    return c;
  };
  const alphaField = (ctx, w, h) => {
    const data = ctx.getImageData(0, 0, w, h).data;
    const f = new Uint8Array(w * h);
    for (let i = 0; i < f.length; i++) f[i] = data[i * 4 + 3];
    return f;
  };

  /**
   * Rasterizes via draw(ctx) over doc-space rect `bounds`, traces the coverage
   * and returns subpaths in doc space.
   */
  Trace.traceDrawing = (bounds, draw, opts = {}) => {
    const R = V3D.Rect;
    const w = Math.max(R.w(bounds), 1e-3);
    const h = Math.max(R.h(bounds), 1e-3);
    const target = opts.resolution || 1800;
    const s = Math.min(60, Math.max(0.25, target / Math.max(w, h)));
    const pad = 4;
    const W = Math.ceil(w * s) + pad * 2;
    const H = Math.ceil(h * s) + pad * 2;
    const cv = canvasOf(W, H);
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.setTransform(s, 0, 0, s, pad - bounds.x * s, pad - bounds.y * s);
    draw(ctx, s);
    const field = alphaField(ctx, W, H);
    const loops = Trace.contours(field, W, H, 127.5);
    return Trace.loopsToSubpaths(loops, {
      error: opts.error || 0.6,
      minArea: opts.minArea == null ? 3 : opts.minArea,
      map: (x, y) => [(x - pad) / s + bounds.x, (y - pad) / s + bounds.y],
    });
  };

  const path2d = (subs) => new Path2D(V3D.Path.toD(subs, 4) || 'M0 0');

  /**
   * Boolean operation over shapes [{subs, rule}] (doc space, bottom → top).
   * op: 'union' | 'difference' | 'intersection' | 'exclusion'.
   */
  Trace.boolean = (op, shapes, opts = {}) => {
    let bounds = null;
    for (const s of shapes) bounds = V3D.Rect.union(bounds, V3D.Path.bbox(s.subs));
    if (!V3D.Rect.valid(bounds)) return [];
    return Trace.traceDrawing(
      bounds,
      (ctx) => {
        ctx.fillStyle = '#000';
        shapes.forEach((s, i) => {
          if (i === 0) ctx.globalCompositeOperation = 'source-over';
          else
            ctx.globalCompositeOperation = {
              union: 'source-over',
              difference: 'destination-out',
              intersection: 'destination-in',
              exclusion: 'xor',
            }[op];
          ctx.fill(path2d(s.subs), s.rule || 'nonzero');
        });
      },
      opts
    );
  };

  /** Outline of a stroke as a filled shape. */
  Trace.strokeToPath = (subs, width, style = {}, opts = {}) => {
    const b = V3D.Rect.inflate(V3D.Path.bbox(subs), width * 1.5 + 1);
    return Trace.traceDrawing(
      b,
      (ctx) => {
        ctx.lineWidth = width;
        ctx.lineJoin = style.join || 'round';
        ctx.lineCap = style.cap || 'round';
        ctx.miterLimit = 4;
        if (style.dash && style.dash.length) ctx.setLineDash(style.dash);
        ctx.strokeStyle = '#000';
        ctx.stroke(path2d(subs));
      },
      opts
    );
  };

  /** Grows (d > 0) or shrinks (d < 0) a filled shape by |d| with round joins. */
  Trace.offset = (subs, d, rule = 'nonzero', opts = {}) => {
    const b = V3D.Rect.inflate(V3D.Path.bbox(subs), Math.max(0, d) * 1.2 + 1);
    return Trace.traceDrawing(
      b,
      (ctx) => {
        const p = path2d(subs);
        ctx.fillStyle = '#000';
        ctx.strokeStyle = '#000';
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.lineWidth = Math.abs(d) * 2;
        ctx.fill(p, rule);
        if (d > 0) ctx.stroke(p);
        else {
          ctx.globalCompositeOperation = 'destination-out';
          ctx.stroke(p);
        }
      },
      opts
    );
  };

  /* ---------------- text outlines ---------------- */

  const textCache = new Map();
  /**
   * Outlines for a text block in local units: origin at the first baseline,
   * x anchored per `align` ('start' | 'middle' | 'end').
   */
  Trace.text = (t) => {
    const key = JSON.stringify([t.text, t.family, t.size, t.weight, t.italic, t.spacing, t.align, t.lineHeight]);
    if (textCache.has(key)) return textCache.get(key);
    const lines = String(t.text || '').split('\n');
    const size = t.size || 72;
    const fam = quoteFamily(t.family || 'sans-serif');
    const generic = /(^|,\s*)(serif|sans-serif|monospace|cursive|fantasy|system-ui)\s*$/.test(fam) ? '' : ', sans-serif';
    const fontFor = (px) => `${t.italic ? 'italic ' : ''}${t.weight || 400} ${px}px ${fam}${generic}`;
    const probe = canvasOf(8, 8).getContext('2d');
    // Choose a raster size that keeps detail but caps the canvas width.
    let S = 220;
    probe.font = fontFor(S);
    const spacingPx = (em) => ((t.spacing || 0) / 100) * em;
    const measure = (ctx, line, em) => {
      if (!t.spacing) return ctx.measureText(line).width;
      let w = 0;
      for (const ch of line) w += ctx.measureText(ch).width + spacingPx(em);
      return w - (line.length ? spacingPx(em) : 0);
    };
    const maxW = Math.max(1, ...lines.map((l) => measure(probe, l, S)));
    if (maxW > 6000) S = Math.max(24, (S * 6000) / maxW);
    const lh = (t.lineHeight || 1.2) * S;
    const cv = canvasOf(8, 8);
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.font = fontFor(S);
    const widths = lines.map((l) => measure(ctx, l, S));
    const W = Math.ceil(Math.max(1, ...widths) + S * 0.8);
    const H = Math.ceil(lh * (lines.length - 1) + S * 1.6);
    cv.width = W;
    cv.height = H;
    ctx.font = fontFor(S);
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#000';
    const ox = S * 0.4;
    const oy = S * 1.1;
    const maxWidth = Math.max(...widths);
    lines.forEach((line, i) => {
      let x = ox;
      if (t.align === 'middle') x += (maxWidth - widths[i]) / 2;
      else if (t.align === 'end') x += maxWidth - widths[i];
      const y = oy + i * lh;
      if (!t.spacing) ctx.fillText(line, x, y);
      else
        for (const ch of line) {
          ctx.fillText(ch, x, y);
          x += ctx.measureText(ch).width + spacingPx(S);
        }
    });
    const field = alphaField(ctx, W, H);
    const k = size / S;
    let anchor = 0;
    if (t.align === 'middle') anchor = maxWidth / 2;
    else if (t.align === 'end') anchor = maxWidth;
    const loops = Trace.contours(field, W, H, 127.5);
    const subs = Trace.loopsToSubpaths(loops, {
      error: 0.35,
      minArea: 1.5,
      span: 2.2,
      cornerDeg: 50,
      map: (x, y) => [(x - ox - anchor) * k, (y - oy) * k],
    });
    const res = { subs, width: maxWidth * k, lines: lines.length };
    if (textCache.size > 200) textCache.delete(textCache.keys().next().value);
    textCache.set(key, res);
    return res;
  };
  Trace.clearTextCache = () => textCache.clear();

  function quoteFamily(f) {
    return f
      .split(',')
      .map((s) => {
        s = s.trim();
        return /^(serif|sans-serif|monospace|cursive|fantasy|system-ui)$/.test(s) || /^["']/.test(s) ? s : `"${s}"`;
      })
      .join(', ');
  }
  Trace.quoteFamily = quoteFamily;

  /* ---------------- bitmap tracing ---------------- */

  /**
   * Traces an image into stacked color layers.
   * opts: { mode: 'mono' | 'colors', threshold 0–255, colors N, smooth px, detail 0–1, invert, ignoreBg }
   * Returns [{ subs, color }] in image pixel space scaled to (w, h).
   */
  Trace.bitmap = (img, opts = {}) => {
    const maxSide = opts.maxSide || 900;
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    const s = Math.min(1, maxSide / Math.max(iw, ih));
    const W = Math.max(1, Math.round(iw * s));
    const H = Math.max(1, Math.round(ih * s));
    const cv = canvasOf(W, H);
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, W, H);
    const data = ctx.getImageData(0, 0, W, H).data;
    const N = W * H;
    const err = opts.error == null ? 0.8 : opts.error;
    const minArea = opts.minArea == null ? 6 : opts.minArea;
    const map = (x, y) => [x / s, y / s];
    const blur = (f, r) => (r > 0 ? boxBlur(f, W, H, r) : f);
    const layers = [];
    if (opts.mode !== 'colors') {
      const thr = opts.threshold == null ? 128 : opts.threshold;
      const f = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        const a = data[i * 4 + 3] / 255;
        const lum = (0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]) * a + 255 * (1 - a);
        let v = (thr - lum) * 4 + 127.5;
        if (opts.invert) v = 255 - v;
        f[i] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
      const subs = Trace.loopsToSubpaths(Trace.contours(blur(f, opts.smooth || 1), W, H, 127.5), { error: err, minArea, map });
      layers.push({ subs, color: opts.color || '#1d1d24' });
      return { layers, width: iw, height: ih };
    }
    // Colors: k-means palette, then cumulative masks from light to dark so layers stack without gaps.
    const k = Math.max(2, Math.min(12, opts.colors || 4));
    const palette = kmeans(data, N, k);
    palette.sort((a, b) => lumOf(b) - lumOf(a));
    const assign = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      let best = 0;
      let bd = Infinity;
      const r = data[i * 4];
      const g = data[i * 4 + 1];
      const b = data[i * 4 + 2];
      for (let c = 0; c < palette.length; c++) {
        const p = palette[c];
        const d = (p[0] - r) ** 2 + (p[1] - g) ** 2 + (p[2] - b) ** 2;
        if (d < bd) {
          bd = d;
          best = c;
        }
      }
      assign[i] = data[i * 4 + 3] < 40 ? 255 : best;
    }
    const start = opts.ignoreBg ? 1 : 0;
    for (let c = start; c < palette.length; c++) {
      const f = new Float32Array(N);
      for (let i = 0; i < N; i++) f[i] = assign[i] !== 255 && assign[i] >= c ? 255 : 0;
      const subs = Trace.loopsToSubpaths(Trace.contours(blur(f, opts.smooth == null ? 1 : opts.smooth), W, H, 127.5), {
        error: err,
        minArea,
        map,
      });
      if (subs.length) layers.push({ subs, color: V3D.Color.toHex({ r: palette[c][0], g: palette[c][1], b: palette[c][2] }) });
    }
    return { layers, width: iw, height: ih };
  };

  const lumOf = (p) => 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2];

  function kmeans(data, N, k) {
    const step = Math.max(1, Math.floor(N / 6000));
    const samples = [];
    for (let i = 0; i < N; i += step) if (data[i * 4 + 3] > 40) samples.push([data[i * 4], data[i * 4 + 1], data[i * 4 + 2]]);
    if (!samples.length) return [[0, 0, 0]];
    // k-means++ style spread seeding.
    const cents = [samples[Math.floor(samples.length / 2)].slice()];
    while (cents.length < k) {
      let far = samples[0];
      let fd = -1;
      for (const s of samples) {
        let d = Infinity;
        for (const c of cents) d = Math.min(d, (c[0] - s[0]) ** 2 + (c[1] - s[1]) ** 2 + (c[2] - s[2]) ** 2);
        if (d > fd) {
          fd = d;
          far = s;
        }
      }
      cents.push(far.slice());
    }
    for (let it = 0; it < 10; it++) {
      const acc = cents.map(() => [0, 0, 0, 0]);
      for (const s of samples) {
        let best = 0;
        let bd = Infinity;
        for (let c = 0; c < cents.length; c++) {
          const d = (cents[c][0] - s[0]) ** 2 + (cents[c][1] - s[1]) ** 2 + (cents[c][2] - s[2]) ** 2;
          if (d < bd) {
            bd = d;
            best = c;
          }
        }
        const a = acc[best];
        a[0] += s[0];
        a[1] += s[1];
        a[2] += s[2];
        a[3]++;
      }
      acc.forEach((a, c) => {
        if (a[3]) cents[c] = [a[0] / a[3], a[1] / a[3], a[2] / a[3]];
      });
    }
    return cents;
  }

  function boxBlur(f, W, H, r) {
    const tmp = new Float32Array(W * H);
    const out = new Float32Array(W * H);
    const R = Math.max(1, Math.round(r));
    for (let y = 0; y < H; y++) {
      let acc = 0;
      for (let x = -R; x <= R; x++) acc += f[y * W + Math.min(W - 1, Math.max(0, x))];
      for (let x = 0; x < W; x++) {
        tmp[y * W + x] = acc / (2 * R + 1);
        const xa = Math.max(0, x - R);
        const xb = Math.min(W - 1, x + R + 1);
        acc += f[y * W + xb] - f[y * W + xa];
      }
    }
    for (let x = 0; x < W; x++) {
      let acc = 0;
      for (let y = -R; y <= R; y++) acc += tmp[Math.min(H - 1, Math.max(0, y)) * W + x];
      for (let y = 0; y < H; y++) {
        out[y * W + x] = acc / (2 * R + 1);
        const ya = Math.max(0, y - R);
        const yb = Math.min(H - 1, y + R + 1);
        acc += tmp[yb * W + x] - tmp[ya * W + x];
      }
    }
    return out;
  }
})();
