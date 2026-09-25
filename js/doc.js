/* Vector 3Dit — document model, geometry access and SVG rendering of objects. */
(function () {
  'use strict';
  const V3D = globalThis.V3D;
  const { M2, Path, Shapes, Color } = V3D;
  const { fmt, uid, esc } = V3D.U;

  const Doc = (V3D.Doc = {});

  Doc.create = (opts = {}) => ({
    version: 1,
    name: opts.name || 'Untitled',
    width: opts.width || 1200,
    height: opts.height || 800,
    background: opts.background === undefined ? '#ffffff' : opts.background,
    objects: [],
    scene: { light: V3D.R3D.defaultLight(), seam: 1 },
  });

  Doc.defaultStyle = () => ({
    fill: '#f2a541',
    fillRule: 'nonzero',
    stroke: null,
    strokeWidth: 2,
    strokeJoin: 'round',
    strokeCap: 'round',
    dash: null,
    opacity: 1,
  });

  const TYPE_NAMES = { rect: 'Rectangle', ellipse: 'Ellipse', star: 'Star', path: 'Path', text: 'Text', group: 'Group', image: 'Image' };
  Doc.typeName = (o) => (o.type === 'star' && !o.star ? 'Polygon' : TYPE_NAMES[o.type] || o.type);

  /** Creates an object with sensible defaults. */
  Doc.make = (type, props = {}, style) => {
    const o = {
      id: uid(type[0]),
      type,
      name: props.name || '',
      visible: true,
      locked: false,
      transform: M2.identity(),
      style: Object.assign(Doc.defaultStyle(), style || {}),
      fx: null,
    };
    switch (type) {
      case 'rect':
        Object.assign(o, { x: 0, y: 0, w: 100, h: 100, r: 0 });
        break;
      case 'ellipse':
        Object.assign(o, { cx: 0, cy: 0, rx: 50, ry: 50 });
        break;
      case 'star':
        Object.assign(o, { cx: 0, cy: 0, n: 5, r1: 50, r2: 25, rot: 0, star: true, round: 0 });
        break;
      case 'path':
        Object.assign(o, { subs: [] });
        break;
      case 'text':
        Object.assign(o, { text: 'Text', x: 0, y: 0, family: 'Archivo Black', size: 96, weight: 400, italic: false, spacing: 0, align: 'start', lineHeight: 1.15 });
        break;
      case 'image':
        Object.assign(o, { href: '', x: 0, y: 0, w: 100, h: 100 });
        delete o.fx;
        break;
      case 'group':
        Object.assign(o, { children: [] });
        o.style = { opacity: 1 };
        delete o.fx;
        break;
    }
    Object.assign(o, props);
    if (props.fx) o.fx = V3D.R3D.normalize(props.fx);
    return o;
  };

  Doc.isShape = (o) => o && ['rect', 'ellipse', 'star', 'path', 'text'].includes(o.type);
  Doc.can3D = (o) => Doc.isShape(o);
  Doc.label = (o) => o.name || Doc.typeName(o) + (o.type === 'text' ? ' “' + String(o.text).slice(0, 18) + '”' : '');

  /* ---------- traversal ---------- */
  Doc.walk = (list, fn, parent = null) => {
    for (const o of list) {
      if (fn(o, parent) === false) return false;
      if (o.type === 'group' && Doc.walk(o.children, fn, o) === false) return false;
    }
    return true;
  };

  /** Builds id → {obj, parent} lookup. */
  Doc.index = (doc) => {
    const map = new Map();
    Doc.walk(doc.objects, (o, parent) => {
      map.set(o.id, { obj: o, parent });
    });
    return map;
  };

  Doc.listOf = (doc, parent) => (parent ? parent.children : doc.objects);

  /* ---------- geometry ---------- */
  /** Subpaths in the object's local coordinates. */
  Doc.localSubs = (o) => {
    switch (o.type) {
      case 'rect':
        return Shapes.rect(o.x, o.y, o.w, o.h, o.r || 0);
      case 'ellipse':
        return Shapes.ellipse(o.cx, o.cy, o.rx, o.ry);
      case 'star':
        return Shapes.star(o.cx, o.cy, o);
      case 'path':
        return o.subs;
      case 'text': {
        if (!V3D.Trace || typeof document === 'undefined') return [];
        const t = V3D.Trace.text(o);
        return Path.transform(t.subs, M2.translate(o.x, o.y));
      }
      case 'image':
        return Shapes.rect(o.x, o.y, o.w, o.h, 0);
      default:
        return [];
    }
  };

  Doc.worldSubs = (o, parentM) => Path.transform(Doc.localSubs(o), M2.mul(parentM || M2.identity(), o.transform));

  /** Accumulated parent matrix for an object (not including its own transform). */
  Doc.parentMatrix = (idx, id) => {
    const chain = [];
    let e = idx.get(id);
    while (e && e.parent) {
      chain.unshift(e.parent);
      e = idx.get(e.parent.id);
    }
    return chain.reduce((m, g) => M2.mul(m, g.transform), M2.identity());
  };

  /* ---------- styles → SVG attributes ---------- */
  const paintAttr = (paint, gradId) => {
    if (!paint) return 'none';
    if (typeof paint === 'string') return Color.normalize(paint, '#000000');
    return `url(#${gradId})`;
  };
  const alphaOf = (paint) => {
    if (typeof paint !== 'string') return 1;
    const c = Color.parse(paint);
    return c && c.a != null ? c.a : 1;
  };

  function gradientDef(g, id, W) {
    const stops = (g.stops || [])
      .map(
        (s) =>
          `<stop offset="${fmt(s.offset, 4)}" stop-color="${Color.normalize(s.color)}"${s.opacity != null && s.opacity < 1 ? ` stop-opacity="${fmt(s.opacity, 3)}"` : ''}/>`
      )
      .join('');
    if (g.units === 'user') {
      // Coordinates live in the object's local space; follow the object's transform.
      const m = M2.mul(W || M2.identity(), g.gt || M2.identity());
      const tr = M2.isIdentity(m) ? '' : ` gradientTransform="${M2.toString(m)}"`;
      if (g.type === 'radial')
        return `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${fmt(g.cx, 3)}" cy="${fmt(g.cy, 3)}" r="${fmt(g.r, 3)}"${tr}>${stops}</radialGradient>`;
      return `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${fmt(g.x1, 3)}" y1="${fmt(g.y1, 3)}" x2="${fmt(g.x2, 3)}" y2="${fmt(g.y2, 3)}"${tr}>${stops}</linearGradient>`;
    }
    if (g.type === 'radial')
      return `<radialGradient id="${id}" cx="${fmt(g.cx == null ? 0.5 : g.cx, 4)}" cy="${fmt(g.cy == null ? 0.5 : g.cy, 4)}" r="${fmt(g.r == null ? 0.5 : g.r, 4)}">${stops}</radialGradient>`;
    return `<linearGradient id="${id}" x1="${fmt(g.x1 || 0, 4)}" y1="${fmt(g.y1 || 0, 4)}" x2="${fmt(g.x2 == null ? 1 : g.x2, 4)}" y2="${fmt(g.y2 || 0, 4)}">${stops}</linearGradient>`;
  }
  Doc.gradientDef = gradientDef;

  /** Markup of a flat (non-3D) shape. */
  function shapeMarkup(o, subs, editor, W) {
    const s = o.style || {};
    let defs = '';
    const fillId = o.id + 'f';
    const strokeId = o.id + 's';
    if (s.fill && typeof s.fill === 'object') defs += gradientDef(s.fill, fillId, W);
    if (s.stroke && typeof s.stroke === 'object') defs += gradientDef(s.stroke, strokeId, W);
    if (s.blur > 0) defs += `<filter id="${o.id}b" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${fmt(s.blur, 2)}"/></filter>`;
    const d = Path.toD(subs, 2);
    let a = `d="${d}" fill="${paintAttr(s.fill, fillId)}"`;
    const fa = alphaOf(s.fill);
    if (fa < 1) a += ` fill-opacity="${fmt(fa, 3)}"`;
    if (s.fillRule === 'evenodd') a += ' fill-rule="evenodd"';
    if (s.stroke && s.strokeWidth > 0) {
      a += ` stroke="${paintAttr(s.stroke, strokeId)}" stroke-width="${fmt(s.strokeWidth, 2)}"`;
      const sa = alphaOf(s.stroke);
      if (sa < 1) a += ` stroke-opacity="${fmt(sa, 3)}"`;
      if (s.strokeJoin && s.strokeJoin !== 'miter') a += ` stroke-linejoin="${s.strokeJoin}"`;
      if (s.strokeCap && s.strokeCap !== 'butt') a += ` stroke-linecap="${s.strokeCap}"`;
      if (s.dash && s.dash.length) a += ` stroke-dasharray="${s.dash.map((v) => fmt(v, 2)).join(' ')}"`;
      if (s.seam) a += ' vector-effect="non-scaling-stroke"';
    }
    if (s.blur > 0) a += ` filter="url(#${o.id}b)"`;
    if (s.opacity != null && s.opacity < 1) a += ` opacity="${fmt(s.opacity, 3)}"`;
    let out = (defs ? `<defs>${defs}</defs>` : '') + `<path ${a}/>`;
    // Easier clicking on thin open paths in the editor.
    if (editor && (!s.fill || subs.some((sp) => !sp.closed)))
      out += `<path d="${d}" fill="none" stroke="transparent" stroke-width="10" vector-effect="non-scaling-stroke" class="hit"/>`;
    return out;
  }

  /* ---------- render cache ---------- */
  const cache = new Map();
  Doc.cache = cache;
  Doc.clearCache = () => cache.clear();

  /**
   * Renders one object (recursively for groups).
   * ctx: { parentM, quality, scene, editor, sceneVersion }
   * Returns { markup, bbox } where bbox is in doc space.
   */
  Doc.renderObject = (o, ctx) => {
    const pm = ctx.parentM || M2.identity();
    const pmKey = pm.map((v) => fmt(v, 5)).join(',');
    const quality = o.fx && ctx.quality === 'draft' && ctx.draftIds && ctx.draftIds.has(o.id) ? 'draft' : 'full';
    const stamp = `${pmKey}|${quality}|${ctx.sceneVersion || 0}|${ctx.editor ? 1 : 0}`;
    const c = cache.get(o.id);
    if (o.type !== 'group' && c && c.stamp === stamp) {
      if (c.rev === o._rev && o._rev !== undefined) return c;
      const sig = V3D.U.serialize(o);
      if (c.sig === sig) {
        c.rev = o._rev;
        return c;
      }
    }
    let res;
    if (o.type === 'group') {
      const m = M2.mul(pm, o.transform);
      let bbox = null;
      let inner = '';
      for (const ch of o.children) {
        if (ch.visible === false) continue;
        const r = Doc.renderObject(ch, Object.assign({}, ctx, { parentM: m }));
        inner += wrap(ch, r.markup, ctx);
        bbox = V3D.Rect.union(bbox, r.bbox);
      }
      const op = o.style && o.style.opacity != null && o.style.opacity < 1 ? ` opacity="${fmt(o.style.opacity, 3)}"` : '';
      res = { markup: op ? `<g${op}>${inner}</g>` : inner, bbox };
      return res;
    }
    if (o.type === 'image') {
      const m = M2.mul(pm, o.transform);
      const href = esc(o.href || '');
      const markup = `<image href="${href}" x="${fmt(o.x)}" y="${fmt(o.y)}" width="${fmt(o.w)}" height="${fmt(o.h)}" preserveAspectRatio="none"${
        M2.isIdentity(m) ? '' : ` transform="${M2.toString(m)}"`
      }${o.style && o.style.opacity < 1 ? ` opacity="${fmt(o.style.opacity, 3)}"` : ''}/>`;
      res = { markup, bbox: V3D.Rect.transform({ x: o.x, y: o.y, x2: o.x + o.w, y2: o.y + o.h }, m) };
    } else {
      const subs = Doc.worldSubs(o, pm);
      const geoBox = Path.bbox(subs);
      if (o.fx) {
        const W = M2.mul(pm, o.transform);
        const pivot = o.fx.pivot ? M2.apply(W, o.fx.pivot[0], o.fx.pivot[1]) : null;
        const r = V3D.R3D.render(subs, o.fx, o.style, ctx.scene, { id: o.id, quality, pivot });
        res = { markup: r.markup, bbox: r.bbox || geoBox, faces: r.faces, ms: r.ms, flatBox: geoBox };
      } else {
        const markup = subs.length ? shapeMarkup(o, subs, ctx.editor, M2.mul(pm, o.transform)) : '';
        let bbox = V3D.Rect.valid(geoBox) ? geoBox : null;
        if (bbox && o.style && o.style.stroke && o.style.strokeWidth) bbox = V3D.Rect.inflate(bbox, o.style.strokeWidth / 2);
        res = { markup, bbox, geoBox: V3D.Rect.valid(geoBox) ? geoBox : null };
      }
    }
    res.stamp = stamp;
    res.rev = o._rev;
    res.sig = V3D.U.serialize(o);
    cache.set(o.id, res);
    return res;
  };

  function wrap(o, inner, ctx) {
    if (!ctx.editor) return inner;
    return `<g data-id="${o.id}"${o.locked ? ' class="locked"' : ''}>${inner}</g>`;
  }
  Doc.wrap = wrap;

  /** Bounding box of an object in doc space (uses the render cache). */
  Doc.bbox = (o, ctx) => Doc.renderObject(o, ctx).bbox;

  /** Full standalone SVG for export. opts: { area: rect, background, scene, objects, meta } */
  Doc.toSVG = (doc, opts = {}) => {
    const objs = opts.objects || doc.objects;
    const ctx = { scene: doc.scene, quality: 'full', editor: false, sceneVersion: 'export' };
    let body = '';
    let bbox = null;
    for (const o of objs) {
      if (o.visible === false) continue;
      const r = Doc.renderObject(o, Object.assign({}, ctx, { parentM: opts.parentMatrices ? opts.parentMatrices.get(o.id) : null }));
      const label = o.name ? ` id="${esc(slug(o.name))}"` : '';
      body += `<g${label}>${r.markup}</g>`;
      bbox = V3D.Rect.union(bbox, r.bbox);
    }
    // Export renders must not pollute the editor cache.
    for (const o of objs) Doc.walk([o], (x) => void cache.delete(x.id));
    const area = opts.area || { x: 0, y: 0, x2: doc.width, y2: doc.height };
    const w = area.x2 - area.x;
    const h = area.y2 - area.y;
    const bg = opts.background !== undefined ? opts.background : doc.background;
    const bgRect = bg ? `<rect x="${fmt(area.x)}" y="${fmt(area.y)}" width="${fmt(w)}" height="${fmt(h)}" fill="${Color.normalize(bg)}"/>` : '';
    const meta = opts.meta ? `<metadata><vector3dit xmlns="urn:vector-3dit:project">${esc(opts.meta)}</vector3dit></metadata>` : '';
    // Seam strokes between 3D faces stay one display pixel wide at any size (apps that ignore this use 1 unit).
    const style = body.includes('class="obj3d"') ? '<style>.obj3d path{vector-effect:non-scaling-stroke}.obj3d path.e{vector-effect:none}</style>' : '';
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(w)}" height="${fmt(h)}" viewBox="${fmt(area.x)} ${fmt(area.y)} ${fmt(w)} ${fmt(h)}">` +
      `<title>${esc(doc.name || 'Vector 3Dit drawing')}</title>${meta}${style}${bgRect}${body}</svg>`
    );
  };

  const slug = (s) => String(s).trim().replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'obj';

  /** Deep copy with fresh ids. */
  Doc.cloneObject = (o) => {
    const c = V3D.U.clone(o);
    Doc.walk([c], (x) => {
      x.id = uid(x.type[0]);
    });
    return c;
  };

  /** Converts any shape to an editable path (keeps style, transform and 3D settings). */
  Doc.toPath = (o) => {
    if (o.type === 'path') return o;
    if (!Doc.isShape(o)) return o;
    const subs = Path.clone(Doc.localSubs(o));
    const p = Doc.make('path', { subs, name: o.name }, o.style);
    p.id = o.id;
    p.transform = o.transform.slice();
    p.fx = o.fx ? V3D.U.clone(o.fx) : null;
    p.visible = o.visible;
    p.locked = o.locked;
    if (o.type === 'text' && !o.style.fillRule) p.style.fillRule = 'evenodd';
    if (o.type === 'text') p.style.fillRule = 'evenodd';
    return p;
  };
})();
