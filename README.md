# Vector 3Dit

Vector 3Dit is a browser-based vector drawing app, in the spirit of Inkscape, with real 3D tools built in.
Draw flat shapes, then **extrude**, **revolve** or **inflate** them, turn them in 3D, light them and
style them. The result stays **100% vector**: every face is an SVG shape you can export and edit anywhere.

![Workflow](https://img.shields.io/badge/draw-→%20extrude%20→%20light%20→%20export-f2a541)

## Run it

- **Single file:** open [`dist/vector-3dit.html`](dist/vector-3dit.html) in any modern browser (double-click works, no server needed).
- **From source:** open [`index.html`](index.html) directly, or serve this folder (`npx serve .`).

Everything runs locally in your browser. Your drawing autosaves in the browser; use **File › Save project** to keep a file.
Display fonts and the UI font load from Google Fonts when you're online, and fall back to system fonts offline.

### Inkscape extension

The same 3D effects are also available inside Inkscape (1.2 or newer): **Extensions › Vector 3Dit › Extrude / Revolve / Inflate / Flat tilt**,
plus **Rotate in 3D…**, a window with a drag-to-turn trackball and a live preview of the objects in place on the page.
See [`inkscape-extension/`](inkscape-extension/) for install steps.

## Quick start

1. **Draw a shape.** Rectangle (R), Ellipse (E), Star/Polygon (S), Pen (P), Pencil (N) or Text (T) — or **Object › Insert shape** for hearts, clouds, gears, arrows and revolve-ready profiles.
2. **Make it 3D.** Select it and pick **Extrude**, **Revolve** or **Inflate** in the 3D tab (or the context bar).
3. **Turn it.** Press **O** and drag the shape (Orbit tool), use the trackball in the 3D tab, or click a preset view (isometric left/right/top, off-axis, dimetric…).
4. **Light it.** Press **L** and drag to aim the light, or drag the sun on the light sphere. One scene light is shared by all objects, so everything matches.
5. **Style it.** Materials (Glossy, Clay, Toon, Poster, Chrome, Gold, Copper, Line art, Wireframe, Flat), bevels, colors per side, outlines and cast shadows.
6. **Export.** **File › Export** gives SVG (with the 3D settings embedded, so Vector 3Dit can reopen it) or PNG at 1–4×.

## Features

### 3D effects (all vector output)
| Effect | What it does | Controls |
| --- | --- | --- |
| **Extrude** | Pushes the shape back into a solid | Depth, end caps (solid/hollow), 6 bevel profiles (Classic, Round, Cove, Ogee, Step, Chisel), bevel width/height, front or both sides, inward/outward, smoothness |
| **Revolve** | Spins the shape around an axis like a lathe | Axis (left edge, center, right edge), angle (partial revolves with capped cut faces), offset from the axis, segments |
| **Inflate** | Puffs the shape up like a balloon or pillow | Puffiness, profile (Round, Pillow, Dome, Soft, Sharp), roundness, both sides or front only, detail |
| **Flat** | Keeps the art paper-thin and tilts it in space | — (great for laying art on isometric faces) |

- **Rotation:** tilt/turn/spin sliders, drag-to-rotate trackball, on-canvas Orbit tool, 12 preset views, perspective (0–160° field of view).
- **Lighting:** key light + fill light + ambient, adjustable highlight strength and gloss; shared scene light or per-object light.
- **Shading:** Flat, Matte, Glossy, Toon (cel bands), Metal, Line art, Wireframe. Optional color bands for a poster look.
- **Smooth gradients:** curved surfaces are drawn with exact per-face linear gradients (vector Gouraud shading), not bitmaps.
- **Colors:** front (fill), sides, bevel, back, tinted or custom shadow tone, highlight color. Gradient fills stay on the front face.
- **Outlines & shadows:** silhouette/crease edge lines or full wireframe; cast shadow onto the page or a soft floor shadow.
- **Groups:** select a group (an imported logo, traced art) and make every shape inside 3D at once; they turn together around the group's center.
- **Expand to paths:** converts a 3D object into plain editable vector shapes.

### Drawing & editing
- Select/transform (move, scale, rotate, Alt-drag to duplicate), node editing (corner/smooth/symmetric nodes, add/delete/break/join, bend segments), pen, pencil with smoothing, text (converted to real outlines), zoom, hand, eyedropper.
- Fill & stroke: solid, linear and radial gradients, opacity, stroke width/joins/caps/dashes, fill rule.
- Arrange: align & distribute, order, group/ungroup, flip, rotate, numeric position and size.
- Path operations: union, subtract, intersect, exclude, combine, break apart, object to path, stroke to path, outset/inset, simplify, reverse.
- **Trace bitmap:** import a PNG/JPG and turn it into layered vector shapes (black & white or multi-color).
- Square and **isometric grids**, snapping to grid, objects and page, rulers, light and dark themes, touch and pinch-zoom support.

### Files
- Import SVG (paths, basic shapes, text, gradients, CSS classes, transforms), PNG/JPG/WebP, or Vector 3Dit projects — via menu, drag & drop, or paste.
- Export SVG or PNG (page, drawing or selection; with or without background). Copy the drawing as SVG code to paste into Figma, Illustrator or Inkscape.
- Save/open `.vector3dit.json` project files; automatic local autosave; 150-step undo history.

## Keyboard shortcuts

| Tools | | Editing | |
| --- | --- | --- | --- |
| Select | V | Undo / redo | Ctrl+Z / Ctrl+Shift+Z |
| Edit nodes | A | Duplicate | Ctrl+D |
| Rectangle / Ellipse / Star | R / E / S | Group / ungroup | Ctrl+G / Ctrl+Shift+G |
| Pen / Pencil / Text | P / N / T | Combine / break apart | Ctrl+K / Ctrl+Shift+K |
| 3D orbit / Light | O / L | Object to path | Ctrl+Shift+C |
| Eyedropper / Zoom / Hand | I / Z / H | Nudge (×10 with Shift) | Arrow keys |
| Pan | Space + drag | Flip | Shift+H / Shift+V |
| Zoom | Ctrl + scroll, + / − | Export / save / open | Ctrl+E / Ctrl+S / Ctrl+O |

Press **?** in the app for the full list. On a Mac, use ⌘ instead of Ctrl.

## How the 3D stays vector

Each shape is flattened to contours and turned into a mesh (extrude rings with bevel offsets, a lathe sweep, or a
signed-distance height field for inflate). The mesh is rotated, projected (orthographic or perspective), back-face
culled and depth-sorted, then every visible face becomes an SVG `<path>`. Lighting is reduced to one scalar per
vertex and mapped through a color ramp, so the shading across a triangle is linear — which a single SVG
`linearGradient` reproduces exactly. Thin same-color strokes hide anti-aliasing seams between faces.

Known limits: each object is depth-sorted on its own and objects stack in layer order (like Illustrator's 3D effect);
very detailed shapes are simplified automatically to keep things responsive; boolean operations and text outlines
are traced from a high-resolution raster, so they are extremely close but not mathematically exact.

## Development

No build step or dependencies are required. The app is plain JavaScript modules loaded with `<script>` tags.

```
./
  index.html            entry point (loads css/ and js/)
  css/app.css           theme and layout
  js/                   core geometry, 3D engine, document model, tools and UI
  tests/                Node unit tests for geometry and the 3D engine
  tools/build.mjs       bundles everything into dist/vector-3dit.html
  inkscape-extension/   the 3D engine ported to Python as an Inkscape extension
```

```sh
node tests/core.test.cjs   # geometry, paths, curve fitting, tracing
node tests/mesh.test.cjs   # mesh builders and renderer
node tools/build.mjs       # rebuild dist/vector-3dit.html
python3 tests/inkscape.test.py   # Inkscape extension: parity with the JS engine, end-to-end runs, rotate window
```
