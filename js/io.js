/* Vector 3Dit — import and export: SVG, PNG, project files, images. */
(function () {
  'use strict';
  const V3D = globalThis.V3D;
  const { M2, Path, Doc, Shapes, Color } = V3D;
  const U = V3D.U;
  const IO = (V3D.IO = {});

  const SVGNS = 'http://www.w3.org/2000/svg';

  /* ---------------- project files ---------------- */
  IO.projectJSON = (app) => U.serialize(Object.assign({ app: 'Vector 3Dit', format: 1 }, app.doc));

  IO.fileBase = (app) => (app.doc.name || 'drawing').trim().replace(/[^\w\- ]+/g, '').replace(/\s+/g, '-') || 'drawing';

  /** Reports a save outcome; returns true when the caller should offer a fallback. */
  IO.saveOutcome = (app, result, name) => {
    if (result === 'saved') app.toast('Saved ' + name);
    else if (result === 'declined') app.toast('Save cancelled');
    else if (result === 'busy') app.toast('A save prompt is already open');
    return result === 'blocked';
  };

  IO.saveProject = async (app) => {
    const name = IO.fileBase(app) + '.vector3dit.json';
    const json = IO.projectJSON(app);
    const r = await U.saveFile(name, json, 'application/json');
    if (IO.saveOutcome(app, r, name)) app.ui.showCode('Project file', json, `Saving files is blocked here. Copy the text below into a file named ${name}.`);
  };

  IO.openProjectText = (app, text) => {
    const data = JSON.parse(text);
    app.loadDoc(data);
    app.toast('Opened ' + (app.doc.name || 'drawing'));
  };

  /* ---------------- export ---------------- */
  IO.exportArea = (app, which) => {
    if (which === 'selection') {
      const b = app.selectionBBox();
      if (b) return V3D.Rect.inflate(b, 2);
    }
    if (which === 'drawing') {
      let b = null;
      for (const o of app.doc.objects) if (o.visible !== false) b = V3D.Rect.union(b, app.bboxOf(o));
      if (b) return V3D.Rect.inflate(b, 2);
    }
    return { x: 0, y: 0, x2: app.doc.width, y2: app.doc.height };
  };

  IO.buildSVG = (app, opts = {}) => {
    const area = IO.exportArea(app, opts.area || 'page');
    const objects = opts.area === 'selection' && app.sel.length ? app.selected() : app.doc.objects;
    const pm = new Map(objects.map((o) => [o.id, app.parentMatrix(o.id)]));
    const svg = Doc.toSVG(app.doc, {
      area,
      objects,
      parentMatrices: pm,
      background: opts.background === false ? null : app.doc.background,
      meta: opts.editable ? IO.projectJSON(app) : null,
    });
    app.requestRender();
    return svg;
  };

  IO.svgToPNG = (svg, width, height, scale) =>
    new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      img.onload = () => {
        try {
          const cv = document.createElement('canvas');
          cv.width = Math.max(1, Math.round(width * scale));
          cv.height = Math.max(1, Math.round(height * scale));
          const ctx = cv.getContext('2d');
          ctx.drawImage(img, 0, 0, cv.width, cv.height);
          URL.revokeObjectURL(url);
          cv.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))), 'image/png');
        } catch (e) {
          reject(e);
        }
      };
      img.onerror = () => reject(new Error('Could not rasterize the drawing'));
      img.src = url;
    });

  /* ---------------- import ---------------- */
  IO.importFiles = async (app, files, at) => {
    for (const f of files) {
      const name = f.name || 'file';
      try {
        if (/\.json$/i.test(name)) {
          const text = await U.readFile(f);
          const ok = await app.ui.confirm('Open this drawing?', 'It replaces the current drawing. Save first if you want to keep it.', 'Open');
          if (ok) IO.openProjectText(app, text);
        } else if (/\.svg$/i.test(name) || f.type === 'image/svg+xml') {
          const text = await U.readFile(f);
          IO.importSVGText(app, text, name.replace(/\.svg$/i, ''), at);
        } else if (/^image\//.test(f.type)) {
          const url = await U.readFile(f, 'dataurl');
          await IO.addImage(app, url, name, at);
        } else app.toast(`“${name}” isn’t a file type Vector 3Dit can open`, 'error');
      } catch (e) {
        console.error(e);
        app.toast(`Couldn’t open “${name}”: ${e.message}`, 'error');
      }
    }
  };

  IO.addImage = (app, url, name, at) =>
    new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const d = app.doc;
        const k = Math.min(1, (d.width * 0.6) / img.naturalWidth, (d.height * 0.6) / img.naturalHeight);
        const w = img.naturalWidth * k;
        const h = img.naturalHeight * k;
        const c = at || [d.width / 2, d.height / 2];
        const o = Doc.make('image', { href: url, x: c[0] - w / 2, y: c[1] - h / 2, w, h, name: name || 'Image', natW: img.naturalWidth, natH: img.naturalHeight });
        app.addObject(o, { label: 'Import image' });
        app.toast('Image added. Use Path › Trace bitmap to turn it into vector shapes.');
        resolve(o);
      };
      img.onerror = () => {
        app.toast('That image could not be read', 'error');
        resolve(null);
      };
      img.src = url;
    });

  /** Imports SVG markup as objects (grouped when there are several). */
  IO.importSVGText = (app, text, name, at) => {
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    const root = doc.documentElement;
    if (!root || root.nodeName.toLowerCase() !== 'svg' || doc.getElementsByTagName('parsererror').length) {
      app.toast('That doesn’t look like a valid SVG file', 'error');
      return;
    }
    // Our own exports carry the full editable project.
    const meta = root.getElementsByTagNameNS('urn:vector-3dit:project', 'vector3dit')[0] || root.getElementsByTagName('vector3dit')[0];
    if (meta && meta.textContent.trim().startsWith('{')) {
      app.ui
        .confirm('This SVG was made in Vector 3Dit', 'Open it with all its 3D settings (replaces the current drawing), or insert it as plain shapes?', 'Open with 3D', 'Insert shapes')
        .then((ok) => {
          if (ok) IO.openProjectText(app, meta.textContent);
          else finishImport(app, root, name, at);
        });
      return;
    }
    finishImport(app, root, name, at);
  };

  function finishImport(app, root, name, at) {
    const objs = IO.parseSVG(root);
    if (!objs.length) {
      app.toast('No shapes found in that SVG', 'error');
      return;
    }
    let obj = objs.length === 1 ? objs[0] : Doc.make('group', { children: objs, name: name || 'Imported SVG' });
    app.addObject(obj, { commit: false });
    // Fit into the page and centre on the drop point.
    const b = app.bboxOf(obj);
    if (b) {
      const d = app.doc;
      const k = Math.min(1, (d.width * 0.8) / Math.max(1, V3D.Rect.w(b)), (d.height * 0.8) / Math.max(1, V3D.Rect.h(b)));
      const c = at || [d.width / 2, d.height / 2];
      const M = M2.mul(M2.translate(c[0], c[1]), M2.mul(M2.scale(k, k), M2.translate(-V3D.Rect.cx(b), -V3D.Rect.cy(b))));
      obj.transform = M2.mul(M, obj.transform);
      app.touch(obj);
    }
    app.requestRender();
    app.commit('Import SVG');
    app.toast(objs.length === 1 ? 'Imported 1 shape' : `Imported ${objs.length} shapes as a group`);
  }

  /* ---------- SVG parsing ---------- */
  const INHERIT = ['fill', 'stroke', 'stroke-width', 'fill-rule', 'stroke-linejoin', 'stroke-linecap', 'stroke-dasharray', 'fill-opacity', 'stroke-opacity', 'font-family', 'font-size', 'font-weight', 'font-style', 'visibility'];
  const LOCAL = ['opacity', 'display'];

  function cssRules(root) {
    const rules = [];
    for (const st of Array.from(root.getElementsByTagName('style'))) {
      const txt = st.textContent.replace(/\/\*[\s\S]*?\*\//g, '');
      const re = /([^{}]+)\{([^}]*)\}/g;
      let m;
      while ((m = re.exec(txt))) {
        const decl = parseDecl(m[2]);
        for (const sel of m[1].split(',')) rules.push({ sel: sel.trim(), decl });
      }
    }
    return rules;
  }
  function parseDecl(s) {
    const out = {};
    for (const part of String(s || '').split(';')) {
      const i = part.indexOf(':');
      if (i < 0) continue;
      out[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim().replace(/\s*!important$/, '');
    }
    return out;
  }
  function matches(el, sel) {
    if (!sel || /[\s>+~:[]/.test(sel)) return false;
    const m = /^([a-zA-Z]*)((?:[.#][\w-]+)*)$/.exec(sel);
    if (!m) return false;
    if (m[1] && el.nodeName.toLowerCase() !== m[1].toLowerCase()) return false;
    const parts = m[2].match(/[.#][\w-]+/g) || [];
    for (const p of parts) {
      if (p[0] === '#' && el.getAttribute('id') !== p.slice(1)) return false;
      if (p[0] === '.' && !(' ' + (el.getAttribute('class') || '') + ' ').includes(' ' + p.slice(1) + ' ')) return false;
    }
    return true;
  }

  function lengthOf(v, def = 0) {
    if (v == null || v === '') return def;
    const n = parseFloat(v);
    return isFinite(n) ? n : def;
  }

  IO.parseSVG = (root) => {
    const rules = cssRules(root);
    const ids = new Map();
    for (const el of Array.from(root.querySelectorAll('[id]'))) ids.set(el.getAttribute('id'), el);

    const styleOf = (el, inherited) => {
      const st = Object.assign({}, inherited);
      delete st.opacity;
      delete st.display;
      const apply = (decl) => {
        for (const k in decl) if (INHERIT.includes(k) || LOCAL.includes(k)) st[k] = decl[k];
      };
      const attrs = {};
      for (const k of INHERIT.concat(LOCAL)) if (el.hasAttribute(k)) attrs[k] = el.getAttribute(k);
      apply(attrs);
      for (const r of rules) if (matches(el, r.sel)) apply(r.decl);
      apply(parseDecl(el.getAttribute('style')));
      return st;
    };

    const gradientFrom = (ref, bboxLocal) => {
      const m = /url\(\s*['"]?#([^'")]+)['"]?\s*\)/.exec(ref || '');
      if (!m) return null;
      let g = ids.get(m[1]);
      if (!g) return null;
      const attrs = {};
      let stopsEl = null;
      // Follow href chains for inherited attributes and stops.
      for (let cur = g, guard = 0; cur && guard < 8; guard++) {
        for (const a of ['x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'gradientUnits', 'gradientTransform']) if (!(a in attrs) && cur.hasAttribute(a)) attrs[a] = cur.getAttribute(a);
        if (!stopsEl && cur.getElementsByTagName('stop').length) stopsEl = cur;
        const href = cur.getAttribute('href') || cur.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
        cur = href && href[0] === '#' ? ids.get(href.slice(1)) : null;
      }
      if (!stopsEl) return null;
      const stops = Array.from(stopsEl.getElementsByTagName('stop')).map((s) => {
        const sd = parseDecl(s.getAttribute('style'));
        const off = s.getAttribute('offset') || '0';
        const o = off.endsWith('%') ? parseFloat(off) / 100 : parseFloat(off);
        const color = sd['stop-color'] || s.getAttribute('stop-color') || '#000';
        const op = sd['stop-opacity'] || s.getAttribute('stop-opacity');
        return { offset: U.clamp(o || 0, 0, 1), color: Color.normalize(color), opacity: op == null ? 1 : parseFloat(op) };
      });
      const type = g.nodeName.toLowerCase().includes('radial') ? 'radial' : 'linear';
      const frac = (v, def) => {
        if (v == null) return def;
        return String(v).endsWith('%') ? parseFloat(v) / 100 : parseFloat(v);
      };
      if (attrs.gradientUnits === 'userSpaceOnUse') {
        const out = { type, units: 'user', stops };
        if (type === 'linear') Object.assign(out, { x1: frac(attrs.x1, 0), y1: frac(attrs.y1, 0), x2: frac(attrs.x2, 1), y2: frac(attrs.y2, 0) });
        else Object.assign(out, { cx: frac(attrs.cx, 0.5), cy: frac(attrs.cy, 0.5), r: frac(attrs.r, 0.5) });
        if (attrs.gradientTransform) out.gt = M2.parse(attrs.gradientTransform);
        void bboxLocal;
        return out;
      }
      if (type === 'linear') return { type, stops, x1: frac(attrs.x1, 0), y1: frac(attrs.y1, 0), x2: frac(attrs.x2, 1), y2: frac(attrs.y2, 0) };
      return { type, stops, cx: frac(attrs.cx, 0.5), cy: frac(attrs.cy, 0.5), r: frac(attrs.r, 0.5) };
    };

    const paint = (v, opacity) => {
      if (!v || v === 'none' || v === 'transparent') return null;
      if (v.startsWith('url')) return v;
      if (v === 'currentColor') return '#000000';
      const c = Color.parse(v);
      if (!c) return null;
      const a = (c.a == null ? 1 : c.a) * (opacity == null ? 1 : parseFloat(opacity));
      return a < 1 ? Color.toHexA({ r: c.r, g: c.g, b: c.b, a }) : Color.toHex(c);
    };

    const toStyle = (st, subs) => {
      const style = Doc.defaultStyle();
      const fillV = st.fill == null ? '#000000' : st.fill;
      const f = paint(fillV, st['fill-opacity']);
      style.fill = f && f.startsWith('url') ? gradientFrom(f, subs) || '#888888' : f;
      const s = paint(st.stroke, st['stroke-opacity']);
      style.stroke = s && s.startsWith('url') ? gradientFrom(s, subs) || '#444444' : s;
      style.strokeWidth = lengthOf(st['stroke-width'], 1);
      style.fillRule = st['fill-rule'] === 'evenodd' ? 'evenodd' : 'nonzero';
      style.strokeJoin = st['stroke-linejoin'] || 'miter';
      style.strokeCap = st['stroke-linecap'] || 'butt';
      if (st['stroke-dasharray'] && st['stroke-dasharray'] !== 'none')
        style.dash = st['stroke-dasharray'].split(/[\s,]+/).map(parseFloat).filter((v) => isFinite(v));
      style.opacity = st.opacity == null ? 1 : U.clamp(parseFloat(st.opacity), 0, 1);
      return style;
    };

    const out = [];
    const walk = (el, M, inherited, list, depth) => {
      if (depth > 60) return;
      const tag = el.nodeName.toLowerCase().replace(/^svg:/, '');
      if (['defs', 'style', 'title', 'desc', 'metadata', 'clippath', 'mask', 'symbol', 'pattern', 'lineargradient', 'radialgradient', 'filter', 'marker', 'script'].includes(tag)) return;
      const st = styleOf(el, inherited);
      if (st.display === 'none' || st.visibility === 'hidden') return;
      let m = M;
      if (el.hasAttribute('transform')) m = M2.mul(M, M2.parse(el.getAttribute('transform')));
      const nameOf = () => el.getAttribute('inkscape:label') || el.getAttribute('id') || '';
      const push = (type, props, subsForStyle) => {
        const o = Doc.make(type, Object.assign({ name: nameOf() }, props), toStyle(st, subsForStyle));
        o.transform = m;
        list.push(o);
        return o;
      };
      switch (tag) {
        case 'svg':
        case 'g':
        case 'a':
        case 'switch': {
          let mm = m;
          if (tag === 'svg' && depth > 0) {
            const x = lengthOf(el.getAttribute('x'));
            const y = lengthOf(el.getAttribute('y'));
            mm = M2.mul(mm, M2.translate(x, y));
          }
          if (tag === 'svg') {
            const vb = (el.getAttribute('viewBox') || '').split(/[\s,]+/).map(parseFloat);
            const w = lengthOf(el.getAttribute('width'), vb[2] || 0);
            const h = lengthOf(el.getAttribute('height'), vb[3] || 0);
            if (vb.length === 4 && vb.every(isFinite) && vb[2] > 0 && vb[3] > 0 && w && h) {
              const k = Math.min(w / vb[2], h / vb[3]);
              mm = M2.mul(mm, M2.mul(M2.scale(k, k), M2.translate(-vb[0], -vb[1])));
            }
          }
          const kids = [];
          for (const c of Array.from(el.children)) walk(c, tag === 'g' || tag === 'a' ? M2.identity() : mm, st, kids, depth + 1);
          if (!kids.length) return;
          if (tag === 'g' || tag === 'a') {
            const g = Doc.make('group', { children: kids, name: nameOf() });
            g.transform = m;
            g.style.opacity = st.opacity == null ? 1 : parseFloat(st.opacity);
            if (kids.length === 1 && g.style.opacity === 1 && !g.name) {
              kids[0].transform = M2.mul(m, kids[0].transform);
              list.push(kids[0]);
            } else list.push(g);
          } else list.push(...kids);
          return;
        }
        case 'path': {
          const subs = Path.parse(el.getAttribute('d'));
          if (subs.length) push('path', { subs });
          return;
        }
        case 'rect': {
          const w = lengthOf(el.getAttribute('width'));
          const h = lengthOf(el.getAttribute('height'));
          if (w <= 0 || h <= 0) return;
          const rx = lengthOf(el.getAttribute('rx'), lengthOf(el.getAttribute('ry')));
          push('rect', { x: lengthOf(el.getAttribute('x')), y: lengthOf(el.getAttribute('y')), w, h, r: rx });
          return;
        }
        case 'circle': {
          const r = lengthOf(el.getAttribute('r'));
          if (r > 0) push('ellipse', { cx: lengthOf(el.getAttribute('cx')), cy: lengthOf(el.getAttribute('cy')), rx: r, ry: r });
          return;
        }
        case 'ellipse': {
          const rx = lengthOf(el.getAttribute('rx'));
          const ry = lengthOf(el.getAttribute('ry'));
          if (rx > 0 && ry > 0) push('ellipse', { cx: lengthOf(el.getAttribute('cx')), cy: lengthOf(el.getAttribute('cy')), rx, ry });
          return;
        }
        case 'line': {
          const pts = [
            [lengthOf(el.getAttribute('x1')), lengthOf(el.getAttribute('y1'))],
            [lengthOf(el.getAttribute('x2')), lengthOf(el.getAttribute('y2'))],
          ];
          const o = push('path', { subs: [Path.fromPolyline(pts, false)] });
          o.style.fill = null;
          if (!o.style.stroke) o.style.stroke = '#000000';
          return;
        }
        case 'polyline':
        case 'polygon': {
          const nums = (el.getAttribute('points') || '').match(/[+-]?(?:\d*\.\d+|\d+\.?)(?:[eE][+-]?\d+)?/g) || [];
          const pts = [];
          for (let i = 0; i + 1 < nums.length; i += 2) pts.push([+nums[i], +nums[i + 1]]);
          if (pts.length < 2) return;
          push('path', { subs: [Path.fromPolyline(pts, tag === 'polygon')] });
          return;
        }
        case 'text': {
          const txt = el.textContent.trim();
          if (!txt) return;
          const size = lengthOf(st['font-size'], 16);
          const fam = (st['font-family'] || 'sans-serif').replace(/['"]/g, '');
          const anchor = el.getAttribute('text-anchor') || (parseDecl(el.getAttribute('style'))['text-anchor'] || 'start');
          const ts = el.getElementsByTagName('tspan')[0];
          const x = lengthOf(el.getAttribute('x'), ts ? lengthOf(ts.getAttribute('x')) : 0);
          const y = lengthOf(el.getAttribute('y'), ts ? lengthOf(ts.getAttribute('y')) : 0);
          const weight = st['font-weight'] === 'bold' ? 700 : parseInt(st['font-weight'], 10) || 400;
          push('text', { text: txt, x, y, size, family: fam, weight, italic: st['font-style'] === 'italic', align: anchor === 'middle' ? 'middle' : anchor === 'end' ? 'end' : 'start' });
          return;
        }
        case 'image': {
          const href = el.getAttribute('href') || el.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
          if (!href) return;
          push('image', { href, x: lengthOf(el.getAttribute('x')), y: lengthOf(el.getAttribute('y')), w: lengthOf(el.getAttribute('width'), 100), h: lengthOf(el.getAttribute('height'), 100) });
          return;
        }
        case 'use': {
          const href = el.getAttribute('href') || el.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
          const ref = href && href[0] === '#' && ids.get(href.slice(1));
          if (!ref) return;
          const mm = M2.mul(m, M2.translate(lengthOf(el.getAttribute('x')), lengthOf(el.getAttribute('y'))));
          const kids = [];
          const refTag = ref.nodeName.toLowerCase();
          if (refTag === 'symbol') for (const c of Array.from(ref.children)) walk(c, mm, st, kids, depth + 1);
          else walk(ref, mm, st, kids, depth + 1);
          list.push(...kids);
          return;
        }
        default:
          return;
      }
    };
    walk(root, M2.identity(), {}, out, 0);
    return out;
  };

  /** Rendered 3D markup → a group of editable path objects (in the given parent space). */
  IO.markupToGroup = (markup, parentM) => {
    const doc = new DOMParser().parseFromString(`<svg xmlns="${SVGNS}">${markup}</svg>`, 'image/svg+xml');
    const Pi = M2.invert(parentM || M2.identity());
    const defs = new Map();
    for (const el of Array.from(doc.querySelectorAll('linearGradient,radialGradient,filter'))) defs.set(el.getAttribute('id'), el);
    const grad = (ref) => {
      const m = /url\(#([^)]+)\)/.exec(ref || '');
      const g = m && defs.get(m[1]);
      if (!g) return null;
      const stops = Array.from(g.getElementsByTagName('stop')).map((s) => ({
        offset: parseFloat(s.getAttribute('offset')) || 0,
        color: Color.normalize(s.getAttribute('stop-color')),
        opacity: s.hasAttribute('stop-opacity') ? parseFloat(s.getAttribute('stop-opacity')) : 1,
      }));
      if (g.nodeName === 'radialGradient') {
        if (g.getAttribute('gradientUnits') === 'userSpaceOnUse') {
          const gt = g.hasAttribute('gradientTransform') ? M2.parse(g.getAttribute('gradientTransform')) : M2.identity();
          return { type: 'radial', units: 'user', stops, cx: +g.getAttribute('cx'), cy: +g.getAttribute('cy'), r: +g.getAttribute('r'), gt: M2.mul(Pi, gt) };
        }
        return { type: 'radial', stops, cx: 0.5, cy: 0.5, r: 0.5 };
      }
      const gt = g.hasAttribute('gradientTransform') ? M2.parse(g.getAttribute('gradientTransform')) : M2.identity();
      return { type: 'linear', units: 'user', stops, x1: +g.getAttribute('x1'), y1: +g.getAttribute('y1'), x2: +g.getAttribute('x2'), y2: +g.getAttribute('y2'), gt: M2.mul(Pi, gt) };
    };
    const kids = [];
    // Named groups (Shadow, Fills, Lines) stay groups; every part keeps its name, like "Fill - Light Blue - Front".
    const walk = (el, opacity, blur, inh, list) => {
      for (const c of Array.from(el.children)) {
        const tag = c.nodeName;
        if (tag === 'defs') continue;
        if (tag === 'g') {
          const op = c.hasAttribute('opacity') ? parseFloat(c.getAttribute('opacity')) : 1;
          let b = blur;
          const fm = /url\(#([^)]+)\)/.exec(c.getAttribute('filter') || '');
          if (fm && defs.get(fm[1])) {
            const gb = defs.get(fm[1]).getElementsByTagName('feGaussianBlur')[0];
            if (gb) b = parseFloat(gb.getAttribute('stdDeviation')) || 0;
          }
          const inh2 = {
            sw: c.hasAttribute('stroke-width') ? parseFloat(c.getAttribute('stroke-width')) : inh.sw,
            join: c.getAttribute('stroke-linejoin') || inh.join,
          };
          if (c.hasAttribute('data-name')) {
            const inner = [];
            walk(c, opacity * op, b, inh2, inner);
            if (inner.length) list.push(Doc.make('group', { children: inner, name: c.getAttribute('data-name') }));
          } else walk(c, opacity * op, b, inh2, list);
          continue;
        }
        let subs;
        if (tag === 'path') subs = Path.parse(c.getAttribute('d'));
        else if (tag === 'ellipse')
          subs = Shapes.ellipse(+c.getAttribute('cx'), +c.getAttribute('cy'), +c.getAttribute('rx'), +c.getAttribute('ry'));
        else continue;
        if (!subs.length) continue;
        const fill = c.getAttribute('fill');
        const stroke = c.getAttribute('stroke');
        const style = Doc.defaultStyle();
        style.fill = !fill || fill === 'none' ? null : fill.startsWith('url') ? grad(fill) : Color.normalize(fill);
        const sw = c.hasAttribute('stroke-width') ? parseFloat(c.getAttribute('stroke-width')) : inh.sw || 1;
        style.stroke = !stroke || stroke === 'none' ? null : stroke.startsWith('url') ? grad(stroke) : Color.normalize(stroke);
        style.strokeWidth = sw;
        style.strokeJoin = c.getAttribute('stroke-linejoin') || inh.join || 'miter';
        style.strokeCap = c.getAttribute('stroke-linecap') || 'butt';
        style.fillRule = c.getAttribute('fill-rule') === 'evenodd' ? 'evenodd' : 'nonzero';
        // A stroke painted like the fill is a seam cover: keep it one screen pixel wide.
        if (c.getAttribute('vector-effect') === 'non-scaling-stroke' || (stroke && stroke === fill)) style.seam = true;
        const op = (c.hasAttribute('opacity') ? parseFloat(c.getAttribute('opacity')) : 1) * opacity;
        style.opacity = op;
        if (c.hasAttribute('fill-opacity') && typeof style.fill === 'string') {
          const fc = Color.parse(style.fill);
          fc.a = parseFloat(c.getAttribute('fill-opacity'));
          style.fill = Color.toHexA(fc);
        }
        if (blur) style.blur = blur;
        list.push(Doc.make('path', { subs: Path.transform(subs, Pi), name: c.getAttribute('data-name') || '' }, style));
      }
    };
    walk(doc.documentElement, 1, 0, { sw: 0, join: null }, kids);
    return Doc.make('group', { children: kids });
  };
})();
