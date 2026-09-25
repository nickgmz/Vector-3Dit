// Renders a grid of 3D configurations into an HTML page for visual inspection.
const fs = require('fs');
const load = require('./load.cjs');
const V3D = load(['util.js', 'math.js', 'color.js', 'path.js', 'shapes.js', 'poly.js', 'fit.js', 'trace.js', 'mesh.js', 'render3d.js']);
const out = process.argv[2];
const scene = { light: V3D.R3D.defaultLight(), seam: 1 };
const cells = [
  ['star5', { kind: 'extrude', depth: 30, shading: 'plastic' }, '#f2a541'],
  ['star5', { kind: 'extrude', depth: 30, bevel: 'round', bevelW: 8, bevelH: 8, shading: 'plastic' }, '#f2a541'],
  ['heart', { kind: 'extrude', depth: 25, bevel: 'classic', bevelW: 6, bevelH: 6, bevelSides: 'both', shading: 'matte' }, '#e2574c'],
  ['heart', { kind: 'inflate', shading: 'plastic' }, '#e2574c'],
  ['cloud', { kind: 'inflate', shading: 'toon', steps: 3, rx: 10, ry: -20 }, '#8ecae6'],
  ['vase', { kind: 'revolve', shading: 'plastic', rx: 15, ry: 0 }, '#5b8def'],
  ['vase', { kind: 'revolve', shading: 'metal', rx: 15, ry: 0, revAngle: 270 }, '#c9a227'],
  ['ring', { kind: 'extrude', depth: 30, bevel: 'round', bevelW: 5, bevelH: 5, shading: 'plastic', persp: 60 }, '#43aa8b'],
  ['gear', { kind: 'extrude', depth: 20, shading: 'lineart', rx: 35.26, ry: -45 }, '#999999'],
  ['bolt', { kind: 'extrude', depth: 20, shading: 'toon', edges: 'outline', edgeWidth: 2 }, '#ffd23f'],
  ['pin', { kind: 'extrude', depth: 25, bevel: 'cove', bevelW: 6, bevelH: 6, shading: 'plastic', shadow: 'drop' }, '#ef476f'],
  ['squircle', { kind: 'flat', shading: 'plastic', rx: 45, ry: -30, persp: 70 }, '#7b61ff'],
  ['moon', { kind: 'inflate', infProfile: 'pillow', shading: 'metal' }, '#b0b8c8'],
  ['flower', { kind: 'extrude', depth: 18, bevel: 'ogee', bevelW: 6, bevelH: 8, shading: 'plastic', smooth: true }, '#ff8fab'],
  ['hex', { kind: 'extrude', depth: 50, bevel: 'step', bevelW: 8, bevelH: 10, shading: 'matte', rx: 35.26, ry: 45 }, '#4cc9f0'],
  ['pawn', { kind: 'revolve', shading: 'plastic', rx: 10, ry: 0, shadow: 'floor' }, '#2b2d42'],
  ['star5', { kind: 'extrude', depth: 30, shading: 'wire' }, '#333'],
  ['drop', { kind: 'revolve', revAxis: 'center', shading: 'plastic', rx: 10 }, '#3a86ff'],
  ['leaf', { kind: 'inflate', infProfile: 'cone', shading: 'matte', rx: 20, ry: 30 }, '#52b788'],
  ['arrow', { kind: 'extrude', depth: 30, bevel: 'chisel', bevelW: 5, bevelH: 8, shading: 'plastic', rx: 20, ry: 30, edges: 'outline', edgeWidth: 1 }, '#fb8500'],
];
let html = '<!doctype html><meta charset=utf-8><body style="margin:0;background:#eee;display:grid;grid-template-columns:repeat(5,240px);gap:4px;padding:4px;font:11px sans-serif">';
for (const [lib, fxo, color] of cells) {
  const subs = V3D.Path.transform(V3D.Shapes.fromLibrary(lib), [1.3, 0, 0, 1.3, 55, 50]);
  const fx = V3D.R3D.normalize(Object.assign(V3D.R3D.defaults(fxo.kind, 130), fxo));
  const r = V3D.R3D.render(subs, fx, { fill: color }, scene, { id: lib + Math.random().toString(36).slice(2, 6) });
  html += `<div style="background:#fff"><svg width="240" height="240" viewBox="0 0 240 240">${r.markup}</svg><div>${lib} ${fxo.kind} ${fxo.shading} f=${r.faces} ${r.ms.toFixed(0)}ms ${(r.markup.length / 1024).toFixed(0)}k</div></div>`;
}
fs.writeFileSync(out, html);
