/* Vector 3Dit — parametric shape generators and the built-in shape library. */
(function () {
  'use strict';
  const V3D = globalThis.V3D;
  const Path = V3D.Path;
  const { rad } = V3D.U;
  const K = 0.5522847498; // circle kappa

  const Shapes = (V3D.Shapes = {});

  Shapes.rect = (x, y, w, h, r = 0) => {
    r = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
    if (r <= 1e-6) {
      return [Path.fromPolyline([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], true)];
    }
    const k = r * (1 - K);
    const n = (px, py, ix, iy, ox, oy) => ({ x: px, y: py, ix, iy, ox, oy, t: 'c' });
    const x2 = x + w;
    const y2 = y + h;
    return [
      {
        closed: true,
        nodes: [
          n(x + r, y, x + r, y, x + r, y),
          n(x2 - r, y, x2 - r, y, x2 - k, y),
          n(x2, y + r, x2, y + k, x2, y + r),
          n(x2, y2 - r, x2, y2 - r, x2, y2 - k),
          n(x2 - r, y2, x2 - k, y2, x2 - r, y2),
          n(x + r, y2, x + r, y2, x + k, y2),
          n(x, y2 - r, x, y2 - k, x, y2 - r),
          n(x, y + r, x, y + r, x, y + k),
        ],
      },
    ].map((s) => {
      // The first node's incoming handle comes from the last corner arc.
      s.nodes[0].ix = x + k;
      s.nodes[0].iy = y;
      return s;
    });
  };

  Shapes.ellipse = (cx, cy, rx, ry) => {
    const kx = rx * K;
    const ky = ry * K;
    return [
      {
        closed: true,
        nodes: [
          { x: cx + rx, y: cy, ix: cx + rx, iy: cy - ky, ox: cx + rx, oy: cy + ky, t: 'z' },
          { x: cx, y: cy + ry, ix: cx + kx, iy: cy + ry, ox: cx - kx, oy: cy + ry, t: 'z' },
          { x: cx - rx, y: cy, ix: cx - rx, iy: cy + ky, ox: cx - rx, oy: cy - ky, t: 'z' },
          { x: cx, y: cy - ry, ix: cx - kx, iy: cy - ry, ox: cx + kx, oy: cy - ry, t: 'z' },
        ],
      },
    ];
  };

  /** Regular polygon or star centred on (cx, cy). `round` 0–1 bulges the corners. */
  Shapes.star = (cx, cy, opts) => {
    const { n = 5, r1 = 50, r2 = 25, rot = 0, star = true, round = 0 } = opts;
    const count = Math.max(3, Math.round(n));
    const pts = [];
    for (let i = 0; i < count; i++) {
      const a = rad(rot + (i * 360) / count - 90);
      pts.push([cx + r1 * Math.cos(a), cy + r1 * Math.sin(a)]);
      if (star) {
        const b = rad(rot + ((i + 0.5) * 360) / count - 90);
        pts.push([cx + r2 * Math.cos(b), cy + r2 * Math.sin(b)]);
      }
    }
    const sub = Path.fromPolyline(pts, true);
    if (round > 0) {
      const N = pts.length;
      sub.nodes.forEach((node, i) => {
        const p = pts[(i - 1 + N) % N];
        const q = pts[(i + 1) % N];
        let tx = q[0] - p[0];
        let ty = q[1] - p[1];
        const tl = Math.hypot(tx, ty) || 1;
        tx /= tl;
        ty /= tl;
        const len = (round * (Math.hypot(node.x - p[0], node.y - p[1]) + Math.hypot(q[0] - node.x, q[1] - node.y))) / 4;
        node.ix = node.x - tx * len;
        node.iy = node.y - ty * len;
        node.ox = node.x + tx * len;
        node.oy = node.y + ty * len;
        node.t = 'z';
      });
    }
    return [sub];
  };

  Shapes.gear = (cx, cy, r, teeth = 12, depth = 0.18, hole = 0.3) => {
    const pts = [];
    const ri = r * (1 - depth);
    const steps = teeth * 4;
    for (let i = 0; i < steps; i++) {
      const a = rad((i * 360) / steps - 90);
      const phase = i % 4;
      const rr = phase === 0 || phase === 1 ? r : ri;
      const off = rad((360 / steps) * (phase === 1 || phase === 2 ? -0.18 : 0.18));
      pts.push([cx + rr * Math.cos(a + off), cy + rr * Math.sin(a + off)]);
    }
    const subs = [Path.fromPolyline(pts, true)];
    if (hole > 0) subs.push(...Path.reverse(Shapes.ellipse(cx, cy, r * hole, r * hole)));
    return subs;
  };

  Shapes.flower = (cx, cy, r, petals = 6, inner = 0.45) => {
    const nodes = [];
    for (let i = 0; i < petals; i++) {
      const a0 = rad((i * 360) / petals - 90 - 180 / petals);
      const a1 = rad((i * 360) / petals - 90);
      const w = rad(180 / petals) * 1.4;
      const ri = r * inner;
      const p0 = [cx + ri * Math.cos(a0), cy + ri * Math.sin(a0)];
      const tip = [cx + r * Math.cos(a1), cy + r * Math.sin(a1)];
      const hl = r * 0.55;
      nodes.push({ x: p0[0], y: p0[1], ix: p0[0], iy: p0[1], ox: p0[0], oy: p0[1], t: 'c' });
      nodes.push({
        x: tip[0],
        y: tip[1],
        ix: tip[0] + hl * Math.cos(a1 - Math.PI / 2 - w * 0.2) * 0.6,
        iy: tip[1] + hl * Math.sin(a1 - Math.PI / 2 - w * 0.2) * 0.6,
        ox: tip[0] + hl * Math.cos(a1 + Math.PI / 2 + w * 0.2) * 0.6,
        oy: tip[1] + hl * Math.sin(a1 + Math.PI / 2 + w * 0.2) * 0.6,
        t: 's',
      });
    }
    return [{ closed: true, nodes }];
  };

  /** Library entries: d strings drawn in a 100×100 box (or generators). `profile` marks revolve-ready halves. */
  Shapes.library = [
    { id: 'heart', name: 'Heart', d: 'M50 90C22 70 4 53 4 32C4 17 15 7 29 7C39 7 46 13 50 21C54 13 61 7 71 7C85 7 96 17 96 32C96 53 78 70 50 90Z' },
    { id: 'star5', name: 'Star', gen: () => Shapes.star(50, 53, { n: 5, r1: 48, r2: 20 }) },
    { id: 'burst', name: 'Burst', gen: () => Shapes.star(50, 50, { n: 16, r1: 48, r2: 38 }) },
    { id: 'roundstar', name: 'Soft star', gen: () => Shapes.star(50, 53, { n: 5, r1: 48, r2: 24, round: 0.25 }) },
    { id: 'hex', name: 'Hexagon', gen: () => Shapes.star(50, 50, { n: 6, r1: 48, star: false, rot: 30 }) },
    { id: 'tri', name: 'Triangle', gen: () => Shapes.star(50, 58, { n: 3, r1: 50, star: false }) },
    { id: 'cloud', name: 'Cloud', d: 'M27 80C13 80 4 71 4 59C4 48 12 40 23 40C24 26 36 16 50 16C63 16 73 24 76 36C88 36 96 46 96 58C96 70 87 80 75 80Z' },
    { id: 'drop', name: 'Drop', d: 'M50 4C50 4 16 44 16 64C16 83 31 96 50 96C69 96 84 83 84 64C84 44 50 4 50 4Z' },
    { id: 'bolt', name: 'Lightning', d: 'M60 3L16 57L45 57L36 97L84 40L55 40L68 3Z' },
    { id: 'arrow', name: 'Arrow', d: 'M4 37L56 37L56 16L96 50L56 84L56 63L4 63Z' },
    { id: 'plus', name: 'Plus', d: 'M36 4L64 4L64 36L96 36L96 64L64 64L64 96L36 96L36 64L4 64L4 36L36 36Z' },
    { id: 'bubble', name: 'Speech', d: 'M16 8L84 8C91 8 96 13 96 20L96 60C96 67 91 72 84 72L46 72L24 92L28 72L16 72C9 72 4 67 4 60L4 20C4 13 9 8 16 8Z' },
    { id: 'shield', name: 'Shield', d: 'M50 4L90 17C90 57 76 81 50 96C24 81 10 57 10 17Z' },
    { id: 'leaf', name: 'Leaf', d: 'M8 92C8 40 40 8 92 8C92 60 60 92 8 92Z' },
    { id: 'moon', name: 'Moon', d: 'M60 5C36 10 19 31 19 55C19 80 39 97 63 97C76 97 87 92 95 84C88 87 80 89 72 89C48 89 30 71 30 47C30 29 42 13 60 5Z' },
    { id: 'pin', name: 'Map pin', d: 'M50 97C50 97 15 59 15 36C15 17 31 3 50 3C69 3 85 17 85 36C85 59 50 97 50 97ZM50 22C42 22 36 28 36 36C36 44 42 50 50 50C58 50 64 44 64 36C64 28 58 22 50 22Z' },
    { id: 'ring', name: 'Ring', d: 'M50 4C75 4 96 25 96 50C96 75 75 96 50 96C25 96 4 75 4 50C4 25 25 4 50 4ZM50 30C39 30 30 39 30 50C30 61 39 70 50 70C61 70 70 61 70 50C70 39 61 30 50 30Z' },
    { id: 'gear', name: 'Gear', gen: () => Shapes.gear(50, 50, 48, 12, 0.2, 0.32) },
    { id: 'flower', name: 'Flower', gen: () => Shapes.flower(50, 50, 48, 6, 0.42) },
    { id: 'squircle', name: 'Rounded square', gen: () => Shapes.rect(4, 4, 92, 92, 24) },
    { id: 'vase', name: 'Vase profile', profile: true, d: 'M0 4L30 4C30 10 24 14 24 24C24 38 46 46 46 68C46 86 38 96 28 96L0 96Z' },
    { id: 'bottle', name: 'Bottle profile', profile: true, d: 'M0 2L12 2L12 22C12 32 32 34 32 50L32 92C32 95 30 98 26 98L0 98Z' },
    { id: 'pawn', name: 'Pawn profile', profile: true, d: 'M0 4C9 4 16 11 16 20C16 26 13 30 9 33L18 38L10 42C12 58 20 70 30 80L34 86L34 96L0 96Z' },
    { id: 'goblet', name: 'Goblet profile', profile: true, d: 'M0 50C18 50 34 38 38 4L42 4C40 42 22 58 6 62L6 86C16 88 30 90 30 96L0 96Z' },
  ];

  Shapes.fromLibrary = (id) => {
    const e = Shapes.library.find((s) => s.id === id);
    if (!e) return null;
    return e.gen ? e.gen() : Path.parse(e.d);
  };
})();
