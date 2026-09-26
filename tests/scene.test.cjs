// Named output, outlines on top, object placement inside a scene camera, and named SVG export.
const assert = require('assert');
const load = require('./load.cjs');
const V3D = load(['util.js', 'math.js', 'color.js', 'path.js', 'shapes.js', 'poly.js', 'fit.js', 'trace.js', 'mesh.js', 'render3d.js', 'doc.js']);
const { R3D, Shapes, Path, Doc } = V3D;
const fx = (o) => R3D.normalize(Object.assign(R3D.defaults(o.kind || 'extrude'), o));
const scene = { light: R3D.defaultLight(), seam: 1 };
const names = (markup) => [...new Set([...markup.matchAll(/data-name="([^"]+)"/g)].map((m) => m[1]))];

// Color names: basic names with Light/Dark, the CMYK code when no basic name fits or when asked.
const cn = (hex, mode) => R3D.colorName(V3D.Color.parse(hex), mode);
assert.strictEqual(cn('#3d7bf2'), 'Blue');
assert.strictEqual(cn('#add8e6'), 'Light Blue');
assert.strictEqual(cn('#1b1c22'), 'Black');
assert.strictEqual(cn('#808080'), 'Gray');
assert.strictEqual(cn('#8b4513'), 'Brown');
assert.strictEqual(cn('#e2574c'), 'Red');
assert.strictEqual(cn('#6e7887'), 'C19 M11 Y0 K47', 'muted color gets its CMYK code');
assert.strictEqual(cn('#3d7bf2', 'cmyk'), 'C75 M49 Y0 K5');

// Every part is named "Fill - <color> - <position>" or "Line - <color> - <position>"; lines come last, in their own group.
const heart = Path.transform(Shapes.fromLibrary('heart'), [2, 0, 0, 2, 100, 100]);
const r = R3D.render(heart, fx({ edges: 'outline', shadow: 'drop', rx: 20, ry: -30 }), { fill: '#3d7bf2' }, scene, { id: 't' });
const n = names(r.markup);
assert.ok(n.includes('Fills') && n.includes('Lines') && n.includes('Shadow'), n.join(', '));
assert.ok(n.includes('Fill - Blue - Front'), n.join(', '));
assert.ok(n.some((x) => /^Fill - .+ - (Top|Bottom|Left Side|Right Side)$/.test(x)), n.join(', '));
assert.ok(n.some((x) => /^Line - Black - /.test(x)), n.join(', '));
assert.ok(n.includes('Fill - Black - Cast Shadow'), n.join(', '));
const at = (k) => r.markup.indexOf(k);
assert.ok(at('v3d-shadow') < at('v3d-fills') && at('v3d-fills') < at('v3d-lines'), 'shadow, then fills, then lines on top');
assert.ok(!/<g class="v3d-lines"[\s\S]*<path(?![^>]*class="e")/.test(r.markup.slice(at('v3d-lines'))), 'only lines in the Lines group');

// Hidden lines: a line under a later face is hidden, half under it is cut in half, one along its edge stays.
const sq = (x0, y0, x1, y1) => ({ n: 4, x0, y0, x1, y1, E: Float64Array.from([x0, y1, x0, y0, x0, y0, x1, y0, x1, y0, x1, y1, x1, y1, x0, y1]), grid: null });
const faces = [null, sq(0, 0, 10, 10)];
const seg = (x0, y0, x1, y1) => ({ x0, y0, x1, y1, r: 0, adj: [0] });
const vis = R3D.hideLines([seg(2, 5, 8, 5), seg(-5, 5, 5, 5), seg(0, -5, 0, 5), seg(-5, 20, 15, 20)], faces, 0.01);
const bySeg = (i) => vis.filter((v) => v[4] === i);
assert.strictEqual(bySeg(0).length, 0, 'covered line is hidden');
assert.ok(bySeg(1).length === 1 && Math.abs(bySeg(1)[0][2] - 0) < 1e-6, 'half-covered line is cut at the face');
assert.ok(bySeg(2).length === 1 && Math.abs(bySeg(2)[0][3] - 5) < 1e-6, 'a line along a face edge stays visible');
assert.ok(bySeg(3).length === 1, 'a line clear of every face stays whole');

// Object placement inside a scene camera: no placement = the same result; turning and pushing move only this object.
const star = Path.transform(Shapes.fromLibrary('star5'), [1, 0, 0, 1, 300, 200]);
const cam = { kind: 'extrude', depth: 40, rx: 20, ry: -30, persp: 60, sceneRadius: 400, edges: 'outline' };
const base = R3D.render(star, fx(cam), { fill: '#e2574c' }, scene, { id: 'a', pivot: [200, 200] });
const same = R3D.render(star, fx(Object.assign({ objRx: 0, objRy: 0, objPush: 0 }, cam)), { fill: '#e2574c' }, scene, { id: 'a', pivot: [200, 200] });
assert.strictEqual(same.markup, base.markup, 'zero placement changes nothing');
const pushed = R3D.render(star, fx(Object.assign({ objPush: 300 }, cam)), { fill: '#e2574c' }, scene, { id: 'b', pivot: [200, 200] });
const w = (b) => b.x2 - b.x;
assert.ok(w(pushed.bbox) < w(base.bbox) * 0.95, 'pushed back looks smaller in perspective');
const turned = R3D.render(star, fx(Object.assign({ objRy: 60 }, cam)), { fill: '#e2574c' }, scene, { id: 'c', pivot: [200, 200] });
assert.notStrictEqual(turned.markup, base.markup);
const pulled = R3D.render(star, fx(Object.assign({ objPush: -2000 }, cam)), { fill: '#e2574c' }, scene, { id: 'd', pivot: [200, 200] });
assert.ok(!/NaN|Infinity/.test(pulled.markup), 'pulled past the camera stays finite');

// A camera an object is locked to gives it the camera's view, turning point and distance.
const doc = Doc.create({ width: 800, height: 600 });
const o = Doc.make('path', { subs: star, name: 'Star' }, Doc.defaultStyle());
o.fx = fx({ kind: 'extrude', rx: 1, ry: 2, camera: 'Street' });
doc.objects.push(o);
doc.scene.cameras.Street = { rx: 30, ry: -40, rz: 0, persp: 50, pivot: [400, 300], reach: 500 };
const v = Doc.view3D(o, V3D.M2.identity(), doc.scene);
assert.deepStrictEqual([v.fx.rx, v.fx.ry, v.fx.persp, v.fx.sceneRadius, v.pivot[0]], [30, -40, 50, 500, 400]);
delete doc.scene.cameras.Street;
assert.strictEqual(Doc.view3D(o, V3D.M2.identity(), doc.scene).fx.rx, 1, 'a missing camera falls back to the own view');

// SVG export: readable unique ids and Inkscape labels.
const svg = Doc.toSVG(doc);
const ids = [...svg.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
assert.strictEqual(new Set(ids).size, ids.length, 'unique ids');
assert.ok(svg.includes('xmlns:inkscape=') && svg.includes('inkscape:label="3D Extrude: Star"') && /inkscape:label="Fill - Light Red - Front"|inkscape:label="Fill - [^"]+ - Front"/.test(svg), 'labels');
assert.ok(ids.includes('Star-3d') && ids.some((i) => /^Star-3d-fill-/.test(i)), ids.slice(0, 5).join(' '));
assert.ok(!svg.includes('data-name'), 'no leftover data-name');

console.log('scene tests passed');
