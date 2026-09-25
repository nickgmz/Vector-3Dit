/* Vector 3Dit — material presets, starter templates and the showcase drawing. */
(function () {
  'use strict';
  const V3D = globalThis.V3D;
  const { Doc, R3D, Shapes, Path, M2 } = V3D;

  const Presets = (V3D.Presets = {});

  Presets.materials = [
    { id: 'glossy', name: 'Glossy', fx: { shading: 'plastic', smooth: true, steps: 0, edges: 'none' } },
    { id: 'clay', name: 'Clay', fx: { shading: 'matte', smooth: true, steps: 0, edges: 'none' } },
    { id: 'toon', name: 'Toon', fx: { shading: 'toon', steps: 3, edges: 'outline', edgeWidth: 2, edgeColor: '#1b1c22' } },
    { id: 'poster', name: 'Poster', fx: { shading: 'matte', steps: 2, smooth: true, edges: 'none' } },
    { id: 'chrome', name: 'Chrome', fill: '#c3cad6', fx: { shading: 'metal', steps: 0, smooth: true, edges: 'none' } },
    { id: 'gold', name: 'Gold', fill: '#e2b44a', fx: { shading: 'metal', steps: 0, smooth: true, edges: 'none' } },
    { id: 'copper', name: 'Copper', fill: '#d27b52', fx: { shading: 'metal', steps: 0, smooth: true, edges: 'none' } },
    { id: 'lineart', name: 'Line art', fx: { shading: 'lineart', edges: 'outline', edgeColor: '#1b1c22', edgeWidth: 1.6 } },
    { id: 'wire', name: 'Wireframe', fx: { shading: 'wire', edgeColor: '#2f6fed', edgeWidth: 0.8 } },
    { id: 'flat', name: 'Flat color', fx: { shading: 'flat', edges: 'none', steps: 0 } },
  ];

  /** Display fonts offered in the text tool (loaded from Google Fonts when online). */
  Presets.fonts = [
    { family: 'Titan One', weight: 400, web: true },
    { family: 'Bungee', weight: 400, web: true },
    { family: 'Luckiest Guy', weight: 400, web: true },
    { family: 'Rubik', weight: 800, web: true },
    { family: 'Fredoka', weight: 700, web: true },
    { family: 'Anton', weight: 400, web: true },
    { family: 'Bebas Neue', weight: 400, web: true },
    { family: 'Righteous', weight: 400, web: true },
    { family: 'Pacifico', weight: 400, web: true },
    { family: 'Lobster', weight: 400, web: true },
    { family: 'Abril Fatface', weight: 400, web: true },
    { family: 'Archivo Black', weight: 400, web: true },
    { family: 'Arial Black', weight: 800 },
    { family: 'Impact', weight: 400 },
    { family: 'Georgia', weight: 700 },
    { family: 'Verdana', weight: 700 },
    { family: 'Courier New', weight: 700 },
    { family: 'sans-serif', weight: 800 },
    { family: 'serif', weight: 700 },
    { family: 'monospace', weight: 700 },
  ];

  const fx = (kind, size, props) => Object.assign(R3D.defaults(kind, size), props);
  const place = (subs, x, y, s) => Path.transform(subs, [s, 0, 0, s, x, y]);

  /** The drawing shown on first launch: one example of each 3D effect. */
  Presets.showcase = () => {
    const d = Doc.create({ name: 'Vector 3Dit showcase', background: '#f3f4f7' });
    const add = (o) => (d.objects.push(o), o);
    add(
      Doc.make('text', {
        name: 'Title',
        text: 'Vector 3Dit',
        x: 600,
        y: 205,
        family: 'Titan One',
        weight: 400,
        size: 118,
        align: 'middle',
        fx: fx('extrude', 700, { depth: 34, bevel: 'round', bevelW: 5, bevelH: 5, bevelSegs: 5, rx: 16, ry: -14, shading: 'plastic' }),
      }, { fill: '#f2a541' })
    );
    add(
      Doc.make('path', {
        name: 'Gold star',
        subs: place(Shapes.star(50, 53, { n: 5, r1: 48, r2: 21, round: 0.08 }), 110, 330, 2.3),
        fx: fx('extrude', 230, { depth: 34, bevel: 'classic', bevelW: 10, bevelH: 9, rx: 22, ry: -28, shading: 'metal' }),
      }, { fill: '#e2b44a' })
    );
    add(
      Doc.make('path', {
        name: 'Balloon heart',
        subs: place(Path.parse(Shapes.library.find((s) => s.id === 'heart').d), 395, 355, 2.1),
        fx: fx('inflate', 210, { infH: 46, rx: 14, ry: -20, shading: 'plastic', infDetail: 44, shadow: 'floor', shadowOpacity: 0.22 }),
      }, { fill: '#e8505b' })
    );
    add(
      Doc.make('path', {
        name: 'Vase profile',
        subs: place(Path.parse(Shapes.library.find((s) => s.id === 'vase').d), 745, 330, 2.5),
        fx: fx('revolve', 250, { rx: 14, ry: 0, revSegs: 56, shading: 'plastic', shadow: 'floor', shadowOpacity: 0.2 }),
      }, { fill: '#4d7cf0' })
    );
    add(
      Doc.make('rect', {
        name: 'Iso tile',
        x: 930,
        y: 395,
        w: 150,
        h: 150,
        r: 30,
        fx: fx('extrude', 150, { depth: 40, rx: 35.26, ry: 45, shading: 'toon', steps: 3, edges: 'outline', edgeWidth: 2, edgeColor: '#1b1c22' }),
      }, { fill: '#52c7a0' })
    );
    add(
      Doc.make('text', {
        name: 'Iso label',
        text: '3D',
        x: 1005,
        y: 492,
        family: 'Titan One',
        weight: 400,
        size: 70,
        align: 'middle',
        fx: fx('extrude', 110, { depth: 10, rx: 35.26, ry: 45, shading: 'toon', steps: 3, edges: 'outline', edgeWidth: 2, edgeColor: '#1b1c22' }),
      }, { fill: '#ffffff' })
    );
    add(
      Doc.make('text', {
        name: 'Caption',
        text: 'Extrude  ·  Inflate  ·  Revolve  ·  Isometric',
        x: 600,
        y: 700,
        family: 'Rubik',
        weight: 700,
        size: 30,
        align: 'middle',
      }, { fill: '#6b7080' })
    );
    return d;
  };

  /** Starter templates for the welcome screen. */
  Presets.templates = [
    { id: 'blank', name: 'Blank canvas', desc: 'A clean 1200 × 800 page', make: () => Doc.create({ name: 'Untitled' }) },
    { id: 'showcase', name: 'Showcase', desc: 'One example of every 3D effect', make: () => Presets.showcase() },
    {
      id: 'title',
      name: '3D title',
      desc: 'Bold extruded lettering with a bevel',
      make: () => {
        const d = Doc.create({ name: '3D title', background: '#1d2130' });
        d.objects.push(
          Doc.make('text', {
            text: 'BIG IDEA',
            x: 600,
            y: 450,
            family: 'Bungee',
            weight: 400,
            size: 150,
            align: 'middle',
            fx: fx('extrude', 900, { depth: 60, bevel: 'classic', bevelW: 5, bevelH: 5, rx: 18, ry: -18, persp: 40, shading: 'plastic', sideColor: '#c2410c', shadow: 'drop', shadowDist: 60, shadowBlur: 10, shadowOpacity: 0.45 }),
          }, { fill: '#fb923c' })
        );
        return d;
      },
    },
    {
      id: 'iso',
      name: 'Isometric kit',
      desc: 'Iso grid plus shapes on each face',
      grid: 'iso',
      make: () => {
        const d = Doc.create({ name: 'Isometric kit', background: '#f7f7f2' });
        const iso = (x, y, preset, color, name, shape) => {
          const p = R3D.presets.find((q) => q.id === preset).r;
          const o = shape();
          o.name = name;
          o.style.fill = color;
          o.fx = fx('extrude', 150, { depth: 30, rx: p[0], ry: p[1], rz: p[2], shading: 'toon', steps: 3, edges: 'outline', edgeWidth: 1.6 });
          o.transform = M2.translate(x, y);
          d.objects.push(o);
        };
        iso(250, 400, 'iso-l', '#ff7a59', 'Left face', () => Doc.make('rect', { x: -70, y: -70, w: 140, h: 140, r: 18 }));
        iso(600, 400, 'iso-t', '#4dabf7', 'Top face', () => Doc.make('star', { cx: 0, cy: 0, r1: 80, r2: 36, n: 5 }));
        iso(950, 400, 'iso-r', '#51cf66', 'Right face', () => Doc.make('ellipse', { cx: 0, cy: 0, rx: 70, ry: 70 }));
        return d;
      },
    },
    {
      id: 'lathe',
      name: 'Lathe studio',
      desc: 'Profiles ready to revolve into objects',
      make: () => {
        const d = Doc.create({ name: 'Lathe studio', background: '#eef1f6' });
        const items = [
          ['bottle', '#2f9e44', 180],
          ['goblet', '#c9a227', 480],
          ['pawn', '#343a40', 780],
        ];
        for (const [id, color, x] of items) {
          const lib = Shapes.library.find((s) => s.id === id);
          d.objects.push(
            Doc.make('path', {
              name: lib.name,
              subs: place(Path.parse(lib.d), x, 220, 3),
              fx: fx('revolve', 300, { rx: 12, ry: 0, shading: id === 'goblet' ? 'metal' : 'plastic', shadow: 'floor', shadowOpacity: 0.2 }),
            }, { fill: color })
          );
        }
        return d;
      },
    },
    {
      id: 'balloon',
      name: 'Balloon letters',
      desc: 'Puffy inflated text',
      make: () => {
        const d = Doc.create({ name: 'Balloon letters', background: '#fff4f8' });
        d.objects.push(
          Doc.make('text', {
            text: 'yay!',
            x: 600,
            y: 480,
            family: 'Luckiest Guy',
            weight: 400,
            size: 230,
            align: 'middle',
            spacing: 4,
            fx: fx('inflate', 700, { infH: 40, infDetail: 70, rx: 10, ry: -16, shading: 'plastic', shadow: 'floor', shadowOpacity: 0.18 }),
          }, { fill: '#ff5fa2' })
        );
        return d;
      },
    },
  ];
})();
