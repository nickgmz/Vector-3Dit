const assert = require('assert');
const load = require('./load.cjs');
const V3D = load(['util.js', 'math.js', 'color.js', 'path.js', 'shapes.js', 'poly.js', 'fit.js', 'trace.js']);
const near = (a, b, e = 1e-6, msg) => assert.ok(Math.abs(a - b) <= e, `${msg || ''} expected ${b} got ${a}`);

// Euler round-trip
for (const [rx, ry, rz] of [[10, 20, 30], [-35.26, 45, 0], [80, -60, 170], [0, 0, 0]]) {
  const e = V3D.M3.toEuler(V3D.M3.fromEuler(rx, ry, rz));
  const m1 = V3D.M3.fromEuler(rx, ry, rz), m2 = V3D.M3.fromEuler(e.rx, e.ry, e.rz);
  m1.forEach((v, i) => near(v, m2[i], 1e-3, 'euler'));
}
// M2 invert
const m = V3D.M2.mul(V3D.M2.rotate(30, 5, 7), V3D.M2.scale(2, 3));
const mi = V3D.M2.invert(m);
const p = V3D.M2.apply(mi, ...V3D.M2.apply(m, 3, 4));
near(p[0], 3); near(p[1], 4);

// Path parse / serialize
const subs = V3D.Path.parse('M10 10 L90 10 L90 90 Z m 20 20 c 10 0 20 10 20 20 s -10 20 -20 20 z');
assert.strictEqual(subs.length, 2);
assert.strictEqual(subs[0].nodes.length, 3);
assert.ok(subs[0].closed);
const d = V3D.Path.toD(subs);
const re = V3D.Path.parse(d);
assert.strictEqual(V3D.Path.toD(re), d);
// arcs
const arc = V3D.Path.parse('M0 0 A50 50 0 0 1 100 0');
const bb = V3D.Path.bbox(arc);
near(bb.y, -50, 0.5, 'arc top');
// ellipse bbox
const e = V3D.Shapes.ellipse(0, 0, 40, 20);
const eb = V3D.Path.bbox(e);
near(eb.x, -40, 1e-6); near(eb.y2, 20, 1e-6);
// flatten circle deviation
const fl = V3D.Path.flatten(V3D.Shapes.ellipse(0, 0, 100, 100), 0.25)[0].pts;
for (const q of fl) near(Math.hypot(q[0], q[1]), 100, 0.35, 'circle flatten');
// rounded rect sanity
const rr = V3D.Shapes.rect(0, 0, 100, 50, 10);
const rb = V3D.Path.bbox(rr);
near(rb.x, 0); near(rb.x2, 100); near(rb.y2, 50);

// Poly classify: square with hole
const outer = [[0, 0], [100, 0], [100, 100], [0, 100]];
const hole = [[25, 25], [75, 25], [75, 75], [25, 75]];
const rings = V3D.Poly.classify([outer, hole]);
assert.strictEqual(rings.filter(r => r.hole).length, 1);
assert.ok(V3D.Poly.area(rings.find(r => !r.hole).pts) > 0);
assert.ok(V3D.Poly.area(rings.find(r => r.hole).pts) < 0);
// offset inward of CCW square by 10 -> 80x80
const sq = rings.find(r => !r.hole).pts;
const mit = V3D.Poly.miters(sq);
const ins = V3D.Poly.offsetRing(sq, mit, 10);
near(Math.abs(V3D.Poly.area(ins)), 6400, 1e-6, 'inset area');

// Fit: circle points
const circ = [];
for (let i = 0; i < 200; i++) { const a = i / 200 * Math.PI * 2; circ.push([100 * Math.cos(a), 100 * Math.sin(a)]); }
const segs = V3D.Fit.closed(circ, 0.5);
assert.ok(segs.length >= 2 && segs.length <= 8, 'circle segs ' + segs.length);
for (const s of segs) for (let t = 0; t <= 1; t += 0.1) { const q = V3D.Bez.point(s[0], s[1], s[2], s[3], t); near(Math.hypot(q[0], q[1]), 100, 1.2, 'fit circle'); }
// Fit: square points keeps 4 corners
const sqp = [];
for (let i = 0; i < 100; i++) sqp.push([i, 0]);
for (let i = 0; i < 100; i++) sqp.push([100, i]);
for (let i = 0; i < 100; i++) sqp.push([100 - i, 100]);
for (let i = 0; i < 100; i++) sqp.push([0, 100 - i]);
const ss = V3D.Fit.closed(sqp, 0.5);
assert.strictEqual(ss.length, 4, 'square segs ' + ss.length);

// Marching squares on a disc field
const W = 64, H = 64, f = new Uint8Array(W * H);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const dd = Math.hypot(x + 0.5 - 32, y + 0.5 - 32);
  f[y * W + x] = Math.max(0, Math.min(255, (20 - dd) * 255 + 127.5));
}
const loops = V3D.Trace.contours(f, W, H);
assert.strictEqual(loops.length, 1);
for (const q of loops[0]) near(Math.hypot(q[0] - 32, q[1] - 32), 20, 0.1, 'ms radius');
// ring field -> 2 loops with opposite orientation
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const dd = Math.hypot(x + 0.5 - 32, y + 0.5 - 32);
  f[y * W + x] = dd < 25 && dd > 10 ? 255 : 0;
}
const l2 = V3D.Trace.contours(f, W, H);
assert.strictEqual(l2.length, 2);
assert.ok(Math.sign(V3D.Poly.area(l2[0])) !== Math.sign(V3D.Poly.area(l2[1])));
const sp = V3D.Trace.loopsToSubpaths(l2, { error: 0.3 });
assert.strictEqual(sp.length, 2);
// Color
assert.strictEqual(V3D.Color.normalize('rgb(255,0,0)'), '#ff0000');
assert.strictEqual(V3D.Color.normalize('#abc'), '#aabbcc');
console.log('core tests passed');
