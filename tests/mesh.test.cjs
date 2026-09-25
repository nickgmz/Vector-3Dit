const assert = require('assert');
const load = require('./load.cjs');
const V3D = load(['util.js', 'math.js', 'color.js', 'path.js', 'shapes.js', 'poly.js', 'fit.js', 'trace.js', 'mesh.js', 'render3d.js']);
const { V3 } = V3D;

function checkOutward(mesh, name) {
  // For each face, the normal should point away from the mesh centroid on average (convex-ish shapes).
  let c = [0, 0, 0];
  for (const v of mesh.verts) c = V3.add(c, v);
  c = V3.scale(c, 1 / mesh.verts.length);
  let bad = 0;
  for (const f of mesh.faces) {
    const d = V3.dot(f.n, V3.sub(f.c, c));
    if (d < -1e-6) bad++;
  }
  assert.ok(bad === 0, `${name}: ${bad}/${mesh.faces.length} faces point inward`);
}
const fx = (o) => V3D.R3D.normalize(Object.assign(V3D.R3D.defaults(o.kind), o));

// Extrude a square (convex) with/without bevel
for (const bevel of ['none', 'classic', 'round', 'cove', 'ogee', 'step', 'chisel']) {
  for (const sides of ['front', 'both']) {
    for (const out of [false, true]) {
      const f = fx({ kind: 'extrude', depth: 40, bevel, bevelW: 8, bevelH: 8, bevelSides: sides, bevelOut: out });
      const geom = V3D.R3D.prepare(V3D.Shapes.rect(0, 0, 100, 100), f, 'full');
      const mesh = V3D.R3D.buildMesh(geom, f, 'full');
      if (bevel === 'none' || bevel === 'classic' || bevel === 'round') checkOutward(mesh, `extrude ${bevel} ${sides} ${out}`);
      assert.ok(mesh.faces.every(fc => fc.n.every(Number.isFinite)));
    }
  }
}
// Extrude circle
{
  const f = fx({ kind: 'extrude', depth: 30, bevel: 'round', bevelW: 10, bevelH: 10 });
  const mesh = V3D.R3D.buildMesh(V3D.R3D.prepare(V3D.Shapes.ellipse(0, 0, 60, 60), f, 'full'), f, 'full');
  checkOutward(mesh, 'extrude circle');
  const caps = mesh.faces.filter(fc => fc.cap);
  assert.strictEqual(caps.length, 2);
  assert.ok(caps.find(c => c.cap === 'front').n[2] > 0.99);
  assert.ok(caps.find(c => c.cap === 'back').n[2] < -0.99);
}
// Extrude ring with hole: hole walls should face into the hole (toward the axis)
{
  const f = fx({ kind: 'extrude', depth: 30 });
  const subs = V3D.Shapes.fromLibrary('ring');
  const mesh = V3D.R3D.buildMesh(V3D.R3D.prepare(subs, f, 'full'), f, 'full');
  let inner = 0, innerBad = 0;
  for (const fc of mesh.faces) {
    if (fc.cap) continue;
    const r = Math.hypot(fc.c[0], fc.c[1]);
    const radial = V3.dot(fc.n, V3.norm([fc.c[0], fc.c[1], 0]));
    if (r < 30) { inner++; if (radial > 0) innerBad++; } else if (radial < 0) innerBad++;
  }
  assert.ok(inner > 0 && innerBad === 0, 'ring walls ' + innerBad);
}
// Revolve a rectangle around its left edge -> cylinder
for (const axis of ['left', 'right', 'center']) {
  for (const angle of [360, 270]) {
    const f = fx({ kind: 'revolve', revAxis: axis, revAngle: angle, revSegs: 32 });
    const mesh = V3D.R3D.buildMesh(V3D.R3D.prepare(V3D.Shapes.rect(0, 0, 50, 100), f, 'full'), f, 'full');
    if (angle === 360) checkOutward(mesh, `revolve ${axis}`);
    assert.ok(mesh.faces.length > 30, 'revolve faces');
  }
}
// Revolve sphere from a circle around the center axis
{
  const f = fx({ kind: 'revolve', revAxis: 'center', revSegs: 32 });
  const mesh = V3D.R3D.buildMesh(V3D.R3D.prepare(V3D.Shapes.ellipse(0, 0, 50, 50), f, 'full'), f, 'full');
  checkOutward(mesh, 'sphere');
  for (const v of mesh.verts) assert.ok(Math.abs(V3.len(v) - 50) < 0.5, 'sphere radius ' + V3.len(v));
}
// Inflate a circle and star
for (const lib of ['heart', 'star5', 'ring']) {
  for (const sides of ['both', 'front']) {
    const f = fx({ kind: 'inflate', infSides: sides, infDetail: 30 });
    const mesh = V3D.R3D.buildMesh(V3D.R3D.prepare(V3D.Shapes.fromLibrary(lib), f, 'full'), f, 'full');
    assert.ok(mesh.faces.length > 100, 'inflate faces');
    // Count inward faces: front faces should have n.z >= -small
    const front = mesh.faces.filter(fc => fc.mat === 'front');
    const badFront = front.filter(fc => fc.n[2] < -0.2).length;
    assert.ok(badFront === 0, `inflate ${lib} front faces inward ${badFront}`);
    // closedness: every edge with 2 faces
    const open = mesh.edges.filter(e => e.f.length !== 2).length;
    assert.ok(open === 0, `inflate ${lib} ${sides} open edges ${open}`);
  }
}
// Render all kinds; no NaN in output
const kinds = [
  { kind: 'extrude', bevel: 'round', shading: 'plastic' },
  { kind: 'extrude', bevel: 'classic', shading: 'toon', edges: 'outline' },
  { kind: 'revolve', shading: 'metal' },
  { kind: 'inflate', shading: 'matte', shadow: 'drop' },
  { kind: 'flat', shading: 'plastic', persp: 60 },
  { kind: 'extrude', shading: 'wire' },
  { kind: 'extrude', shading: 'lineart', persp: 90 },
];
for (const k of kinds) {
  const r = V3D.R3D.render(V3D.Shapes.fromLibrary('heart'), fx(k), { fill: '#e2574c' }, { light: V3D.R3D.defaultLight(), seam: 0.5 }, { id: 't' });
  assert.ok(r.markup.length > 100 && !/NaN|Infinity/.test(r.markup), 'render ' + JSON.stringify(k));
  console.log(k.kind, k.shading, 'faces', r.faces, 'ms', r.ms.toFixed(1), 'bytes', r.markup.length);
}
// Shared pivot: a shape rotated around a far-away pivot moves, around its own centre it stays put.
{
  const f = fx({ kind: 'extrude', depth: 20, rx: 0, ry: 90, rz: 0 });
  const subs = V3D.Shapes.rect(0, 0, 40, 40);
  const own = V3D.R3D.render(subs, f, { fill: '#888' }, { light: V3D.R3D.defaultLight() }, { id: 'p1' });
  const piv = V3D.R3D.render(subs, f, { fill: '#888' }, { light: V3D.R3D.defaultLight() }, { id: 'p2', pivot: [220, 20] });
  const cx = (b) => (b.x + b.x2) / 2;
  assert.ok(Math.abs(cx(own.bbox) - 20) < 1, 'own centre ' + cx(own.bbox));
  assert.ok(Math.abs(cx(piv.bbox) - 220) < 12, 'pivot moves the shape onto the axis ' + cx(piv.bbox));
}
// Complexity budget keeps revolved detailed art bounded.
{
  let subs = [];
  for (let i = 0; i < 30; i++) subs = subs.concat(V3D.Path.transform(V3D.Shapes.fromLibrary('gear'), [0.5, 0, 0, 0.5, (i % 6) * 60, Math.floor(i / 6) * 60]));
  const r = V3D.R3D.render(subs, fx({ kind: 'revolve' }), { fill: '#888' }, { light: V3D.R3D.defaultLight() }, { id: 'b' });
  assert.ok(r.faces < 9000, 'revolve budget ' + r.faces);
}
console.log('mesh tests passed');
