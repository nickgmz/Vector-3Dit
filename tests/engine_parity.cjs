// Renders test cases with the web app's engine so the Inkscape extension's Python port can be compared to it.
// Reads a JSON list of {lib, fx, pivot} from stdin; writes [{subs, faces, bbox, names, lines}] to stdout.
const load = require('./load.cjs');
const V3D = load(['util.js', 'math.js', 'color.js', 'path.js', 'shapes.js', 'poly.js', 'fit.js', 'trace.js', 'mesh.js', 'render3d.js']);
const cases = JSON.parse(require('fs').readFileSync(0, 'utf8'));
const out = cases.map((c) => {
  const subs = V3D.Path.transform(V3D.Shapes.fromLibrary(c.lib), [2, 0, 0, 2, 100, 100]);
  const fx = V3D.R3D.normalize(Object.assign(V3D.R3D.defaults(c.fx.kind, 200), c.fx));
  const r = V3D.R3D.render(subs, fx, { fill: '#e2574c' }, { light: V3D.R3D.defaultLight(), seam: 1 }, { id: 'x', pivot: c.pivot });
  const names = [...new Set([...r.markup.matchAll(/data-name="([^"]+)"/g)].map((m) => m[1]))].sort();
  const lines = (r.markup.match(/<path class="e" d="[^"]*"/g) || []).join('').split('L').length - 1;
  return { subs, faces: r.faces, bbox: [r.bbox.x, r.bbox.y, r.bbox.x2, r.bbox.y2], names, lines };
});
process.stdout.write(JSON.stringify(out));
