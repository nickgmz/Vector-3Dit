/* Vector 3Dit — side panels: 3D, Fill & Stroke, Arrange, Layers. */
(function () {
  'use strict';
  const V3D = globalThis.V3D;
  const { h, fmt } = V3D.U;
  const { W, Doc, R3D, Color } = V3D;

  class Panel {
    constructor(app) {
      this.app = app;
      this.el = h('div.panel-body');
      this.controls = [];
      this.key = null;
    }
    add(c) {
      this.controls.push(c);
      return c;
    }
    sync() {
      for (const c of this.controls) c.sync && c.sync();
    }
    update(force) {
      const k = this.structureKey();
      if (force || k !== this.key) {
        this.key = k;
        this.controls = [];
        const scroll = this.el.parentNode ? this.el.parentNode.scrollTop : 0;
        this.el.innerHTML = '';
        this.build();
        if (this.el.parentNode) this.el.parentNode.scrollTop = scroll;
      } else this.sync();
    }
  }
  V3D.Panel = Panel;

  const empty = (icon, title, text, ...extra) =>
    h('div.empty', h('div.empty-ico', { html: V3D.icon(icon) }), h('div.empty-title', title), h('p.empty-text', text), extra);

  /* =============================== 3D =============================== */
  // The same tabs, in the same order, as the 3D Editor of the Inkscape extension.
  const FX_TABS = [
    ['view', 'View', 'orbit'],
    ['shape', 'Shape', 'cube'],
    ['surface', 'Surface', 'sparkle'],
    ['colors', 'Colors', 'palette'],
    ['light', 'Light', 'light'],
    ['outline', 'Outline', 'shadow'],
    ['style', 'Style', 'sliders'],
  ];
  const TURN_TIPS = ['Rotate around the horizontal axis (X)', 'Rotate around the vertical axis (Y)', 'Rotate within the drawing plane (Z)'];

  class Panel3D extends Panel {
    constructor(app) {
      super(app);
      this.fxTab = V3D.U.storage.get('vector3dit.fxtab', 'view');
      if (!FX_TABS.some((t) => t[0] === this.fxTab)) this.fxTab = 'view';
    }
    target() {
      const objs = this.app.fxTargets(true);
      return objs.length ? objs[objs.length - 1] : null;
    }
    fx() {
      const t = this.target();
      return t ? t.fx : null;
    }
    structureKey() {
      const a = this.app;
      const t = this.target();
      const f = t && t.fx;
      const shapes = a.fxTargets().length;
      const lbl = !f && a.primary() ? Doc.label(a.primary()) : '';
      const view = f
        ? [
            this.fxTab,
            f.kind,
            f.useSceneLight !== false,
            f.shading,
            f.edges,
            f.shadow,
            f.bevel !== 'none',
            f.shadowTint === 'auto' || f.shadowTint === 'black' ? f.shadowTint : 'c',
            f.revAngle >= 360,
            a.lockedCamera(),
            Object.keys(a.doc.scene.cameras || {}).join('/'),
            a.placementShown(t),
            a.turnMode,
          ].join('|')
        : 'none';
      return [a.sel.join(','), shapes, lbl, view].join('#');
    }
    build() {
      const app = this.app;
      const t = this.target();
      const shapes = app.fxTargets();
      if (!t) {
        if (!app.sel.length) this.buildEmpty();
        else if (!shapes.length) this.el.append(empty('image', 'Images aren’t shapes yet', 'Trace the image into vector shapes first (Path › Trace bitmap), then make those 3D.'));
        else this.buildChooser(shapes);
        return;
      }
      this.buildEditor(t);
    }
    buildEmpty() {
      const app = this.app;
      this.el.append(
        empty(
          'cube',
          'Select a shape to give it depth',
          'Draw a shape (or pick one below), select it, then choose Extrude, Revolve or Inflate.',
          h(
            'div.lib-grid',
            V3D.Shapes.library.slice(0, 12).map((s) =>
              h(
                'button.lib-btn',
                {
                  type: 'button',
                  title: 'Add ' + s.name.toLowerCase(),
                  onclick: () => app.ui.addLibraryShape(s.id),
                },
                h('span', { html: libThumb(s.id) }),
                h('span.lib-name', s.name)
              )
            )
          )
        )
      );
      this.el.append(W.section('scenelight', 'Scene light', this.lightKids(true)));
    }
    buildChooser(shapes) {
      const app = this.app;
      const cards = Object.keys(R3D.kinds).filter((k) => k !== 'flat');
      cards.push('flat');
      this.el.append(
        h(
          'div.chooser-head',
          h('div.chooser-title', 'Make it 3D'),
          h('p.muted', app.selected().some((o) => o.type === 'group') ? `${shapes.length} shape${shapes.length === 1 ? '' : 's'} in the selection — they turn together as one object` : shapes.length > 1 ? `${shapes.length} shapes selected` : Doc.label(shapes[0]))
        ),
        h(
          'div.kind-cards',
          cards.map((k) =>
            h(
              'button.kind-card',
              { type: 'button', onclick: () => app.apply3D(k) },
              h('span.kc-ico', { html: V3D.icon(k === 'flat' ? 'flat' : k) }),
              h('span.kc-name', R3D.kinds[k].name),
              h('span.kc-hint', R3D.kinds[k].hint)
            )
          )
        ),
        h('p.tip', 'Tip: with the Orbit tool (O) you can just drag any shape to spin it in 3D.')
      );
    }
    buildEditor(t) {
      const app = this.app;
      const fx = () => this.fx() || R3D.defaults();
      const add = this.add.bind(this);

      // Header: the object and the kind switcher, above the tabs.
      const kind = add(
        W.segmented({
          label: '3D effect',
          cls: 'kinds',
          options: ['flat', 'extrude', 'revolve', 'inflate'].map((k) => ({ value: k, label: R3D.kinds[k].name, icon: k, title: R3D.kinds[k].hint })),
          get: () => fx().kind,
          set: (v) => app.setFxMany({ kind: v }, R3D.kinds[v].name),
        })
      );
      const count = app.fxTargets(true).length;
      this.el.append(
        h('div.fx-head', h('div.fx-title', h('span', { html: V3D.icon('cube') }), h('span', count > 1 ? `${count} 3D shapes` : Doc.label(t))), W.iconButton('close', 'Remove 3D', () => app.remove3D(), 'danger')),
        kind
      );

      // Tabs, one group of tools each.
      const bar = h('div.fx-tabs', { role: 'tablist', 'aria-label': '3D settings' });
      for (const [id, label, icon] of FX_TABS) {
        const b = h('button.fx-tab' + (id === this.fxTab ? '.on' : ''), { type: 'button', role: 'tab', 'aria-selected': String(id === this.fxTab) }, h('span', { html: V3D.icon(icon) }), h('span', label));
        b.addEventListener('click', () => {
          if (this.fxTab === id) return;
          this.fxTab = id;
          V3D.U.storage.set('vector3dit.fxtab', id);
          this.update(true);
          if (this.el.parentNode) this.el.parentNode.scrollTop = 0;
        });
        bar.append(b);
      }
      const page = h('div.fx-page', { role: 'tabpanel' });
      const kids = { view: this.tabView, shape: this.tabShape, surface: this.tabSurface, colors: this.tabColors, light: this.tabLight, outline: this.tabOutline, style: this.tabStyle }[this.fxTab].call(this, t);
      page.append(...kids.filter(Boolean));
      this.el.append(bar, page);

      this.el.append(
        h(
          'div.fx-actions',
          W.button({ icon: 'expand', label: 'Expand to paths', title: 'Turn the 3D result into plain editable vector shapes, named like “Fill - Light Blue - Front”', onClick: () => app.expand3D() }),
          W.button({ icon: 'copy', label: 'Copy style', title: 'Copy these 3D settings', onClick: () => app.copy3D() }),
          W.button({ icon: 'sparkle', label: 'Paste style', title: 'Apply copied 3D settings to the selection', onClick: () => app.paste3D() })
        )
      );
      this.statsEl = h('p.fx-stats.muted');
      this.el.append(this.statsEl);
      this.updateStats();
    }

    /* ---- View: camera, rotation, perspective, preset views ---- */
    tabView(t) {
      const app = this.app;
      const add = this.add.bind(this);
      const out = [];
      const cams = Object.keys(app.doc.scene.cameras || {}).sort();
      const locked = app.lockedCamera();
      const camSel = add(
        W.select({
          bare: true,
          label: 'Camera',
          options: [{ value: '', label: 'Own view (not locked)' }].concat(cams.map((n) => ({ value: n, label: 'Locked: ' + n }))),
          get: () => app.lockedCamera(),
          set: (v) => app.useCamera(v),
        })
      );
      camSel.title = 'Lock the selected objects to a saved camera, so they share one vantage point';
      const save = W.button({ label: 'Save…', cls: 'small', title: 'Save the current view as a camera and lock the selected objects to it', onClick: () => this.saveCameraPopover(save) });
      const del = locked ? W.button({ label: 'Delete', cls: 'small ghost', title: 'Delete this camera. Objects locked to it keep their current look.', onClick: () => app.deleteCamera() }) : null;
      out.push(W.row('Camera', h('div.cam-ctl', camSel, h('div.cam-btns', save, del))));
      if (locked)
        out.push(h('p.tip', `Locked to the camera “${locked}”. Every object locked to it is seen from the same point, with the same angles and perspective. Turning the scene camera turns them all; pick This object to turn or push back only the selection.`));
      if (app.fxTargets(true).length > 1 || app.parentOf(t.id))
        out.push(
          add(
            W.toggle({
              label: 'Turn together as one object',
              title: 'On: every shape rotates around the group’s centre. Off: each shape spins around its own centre.',
              get: () => !!(this.fx() && this.fx().pivot),
              set: (v) => app.groupRotate(v),
            })
          )
        );
      const placement = app.placementShown(t);
      if (placement)
        out.push(
          W.row(
            'Turn',
            add(
              W.segmented({
                options: [
                  { value: 'camera', label: 'Scene camera', title: 'Turn the camera: every object locked to it turns along' },
                  { value: 'object', label: 'This object', title: 'Turn only the selected objects, inside the scene' },
                ],
                get: () => app.turnMode,
                set: (v) => app.setTurnMode(v),
              })
            )
          )
        );
      const turn = () => {
        const o = this.target();
        return o ? app.getTurn(app.turnTarget(o)) : [0, 0, 0];
      };
      const tb = add(W.trackball({ get: turn, set: (r, final) => app.turnSelection(r, final) }));
      out.push(
        h(
          'div.tb-row',
          tb,
          h(
            'div.tb-side',
            h('p.muted.small', 'Drag the cube to turn the object. Shift locks one axis, Alt spins it flat.'),
            W.button({ label: 'Face front', cls: 'small', icon: 'rotCCW', title: 'Reset rotation', onClick: () => app.turnSelection([0, 0, 0], true, 'Reset rotation') })
          )
        )
      );
      ['Tilt', 'Turn', 'Spin'].forEach((label, i) =>
        out.push(
          add(
            W.slider({
              label,
              axis: 'xyz'[i],
              title: TURN_TIPS[i],
              min: -180,
              max: 180,
              step: 1,
              unit: '°',
              def: 0,
              get: () => turn()[i],
              set: (v, final) => {
                const r = turn();
                r[i] = v;
                app.turnSelection(r, final);
              },
            })
          )
        )
      );
      out.push(
        add(
          W.slider({
            label: 'Perspective',
            min: 0,
            max: 160,
            step: 1,
            unit: '°',
            def: 0,
            title: 'Camera field of view. 0 = no perspective (parallel lines stay parallel).',
            get: () => app.perspective(),
            set: (v, final) => app.setPerspective(v, final),
          })
        )
      );
      if (placement)
        out.push(
          add(
            W.slider({
              label: 'Push back',
              min: -1000,
              max: 1000,
              step: 1,
              unit: 'px',
              def: 0,
              title: 'Move the selected objects deeper into the scene (below 0: toward you), without moving the camera. It shows with Perspective above 0.',
              get: () => this.fx().objPush || 0,
              set: (v, final) => app.setFx('objPush', v, final),
            })
          )
        );
      const presets = h(
        'div.presets',
        R3D.presets.map((p) =>
          h(
            'button.preset',
            { type: 'button', title: p.name, onclick: () => app.turnSelection(p.r.slice(), true, 'View: ' + p.name) },
            h('span.preset-thumb'),
            h('span.preset-name', p.name)
          )
        )
      );
      paintPresetThumbs(presets);
      out.push(h('div.sub-label', 'Preset views'), presets);
      return out;
    }
    saveCameraPopover(anchor) {
      const app = this.app;
      const name = h('input.text', { type: 'text', placeholder: 'Camera name, e.g. Street view', 'aria-label': 'Camera name', maxlength: 60 });
      const around = h('select.select', { 'aria-label': 'Turn everything around' }, h('option', { value: 'page' }, 'The page’s center'), h('option', { value: 'selection' }, 'The selection’s center'));
      const ok = W.button({
        label: 'Save camera',
        primary: true,
        onClick: () => {
          const n = name.value.trim();
          if (!n) return name.focus();
          W.closePopover();
          app.saveCamera(n, around.value);
        },
      });
      name.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') ok.click();
      });
      W.popover(anchor, h('div.cam-pop', h('div.cp-title', 'Save as camera'), name, h('div.sub-label', 'Turn everything around'), around, ok), { label: 'Save as camera' });
      setTimeout(() => name.focus());
    }

    /* ---- Shape: the settings of the current kind ---- */
    tabShape() {
      const app = this.app;
      const fx = () => this.fx();
      const set = (prop) => (v, final) => app.setFx(prop, v, final);
      const add = this.add.bind(this);
      const f = fx();
      const out = [];
      if (f.kind === 'extrude') {
        out.push(add(W.slider({ label: 'Depth', min: 0, max: 1000, step: 1, unit: 'px', hardMin: 0, get: () => fx().depth, set: set('depth') })));
        out.push(add(W.toggle({ label: 'Solid (end caps)', title: 'Turn off for a hollow tube', get: () => fx().caps !== false, set: set('caps') })));
        out.push(W.row('Bevel', add(W.bevelPicker({ get: () => fx().bevel, set: (v) => app.setFxMany({ bevel: v }, 'Bevel') }))));
        if (f.bevel !== 'none') {
          out.push(add(W.slider({ label: 'Bevel width', min: 0, max: 60, step: 0.5, unit: 'px', hardMin: 0, get: () => fx().bevelW, set: set('bevelW') })));
          out.push(add(W.slider({ label: 'Bevel height', min: 0, max: 60, step: 0.5, unit: 'px', hardMin: 0, get: () => fx().bevelH, set: set('bevelH') })));
          out.push(W.row('Bevel on', add(W.segmented({ options: [{ value: 'front', label: 'Front' }, { value: 'both', label: 'Front & back' }], get: () => fx().bevelSides, set: set('bevelSides') }))));
          out.push(
            W.row(
              'Direction',
              add(W.segmented({ options: [{ value: false, label: 'Inward', title: 'Carve the bevel into the shape' }, { value: true, label: 'Outward', title: 'Grow the bevel outside the shape' }], get: () => !!fx().bevelOut, set: set('bevelOut') }))
            )
          );
          out.push(add(W.slider({ label: 'Smoothness', min: 1, max: 12, step: 1, get: () => fx().bevelSegs, set: set('bevelSegs') })));
        }
      } else if (f.kind === 'revolve') {
        out.push(h('p.tip', 'The shape spins around a vertical axis. Draw half a profile (like half a vase) with its straight side on the axis.'));
        out.push(
          W.row(
            'Axis',
            add(
              W.segmented({
                options: [
                  { value: 'left', label: 'Left edge' },
                  { value: 'center', label: 'Center' },
                  { value: 'right', label: 'Right edge' },
                ],
                get: () => fx().revAxis,
                set: set('revAxis'),
              })
            )
          )
        );
        out.push(add(W.slider({ label: 'Angle', min: 1, max: 360, step: 1, unit: '°', def: 360, get: () => fx().revAngle, set: set('revAngle') })));
        out.push(add(W.slider({ label: 'Offset', min: 0, max: 300, step: 1, unit: 'px', def: 0, title: 'Distance from the axis — makes rings and hollow shapes', get: () => fx().revOffset, set: set('revOffset') })));
        out.push(add(W.slider({ label: 'Segments', min: 6, max: 128, step: 1, def: 48, title: 'More segments = smoother, larger file', get: () => fx().revSegs, set: set('revSegs') })));
        if (f.revAngle < 360) out.push(add(W.toggle({ label: 'Cap the cut ends', get: () => fx().revCaps !== false, set: set('revCaps') })));
      } else if (f.kind === 'inflate') {
        out.push(add(W.slider({ label: 'Puffiness', min: 0, max: 1000, step: 1, unit: 'px', get: () => fx().infH, set: set('infH') })));
        out.push(
          W.row(
            'Profile',
            add(W.select({ bare: true, label: 'Profile', options: Object.keys(V3D.Mesh.inflateProfiles).map((k) => ({ value: k, label: V3D.Mesh.inflateProfiles[k].name })), get: () => fx().infProfile, set: set('infProfile') }))
          )
        );
        out.push(add(W.slider({ label: 'Roundness', min: 5, max: 100, step: 1, unit: '%', def: 100, title: 'How far in from the edge the surface keeps rising', get: () => Math.round(fx().infSpread * 100), set: (v, fl) => app.setFx('infSpread', v / 100, fl) })));
        out.push(W.row('Sides', add(W.segmented({ options: [{ value: 'both', label: 'Both sides' }, { value: 'front', label: 'Front only' }], get: () => fx().infSides, set: set('infSides') }))));
        out.push(add(W.slider({ label: 'Detail', min: 12, max: 120, step: 1, def: 40, title: 'Mesh resolution. Higher is smoother but slower and larger', get: () => fx().infDetail, set: set('infDetail') })));
      } else {
        out.push(h('p.tip', 'Flat keeps the artwork paper-thin — tilt it with the view controls to lay it on a floor, wall or box side.'));
      }
      return out;
    }

    /* ---- Surface: material and shading ---- */
    tabSurface() {
      const app = this.app;
      const fx = () => this.fx();
      const set = (prop) => (v, final) => app.setFx(prop, v, final);
      const add = this.add.bind(this);
      const mats = h(
        'div.materials',
        V3D.Presets.materials.map((m) =>
          h(
            'button.mat',
            {
              type: 'button',
              title: m.name,
              onclick: () => {
                const props = Object.assign({ edges: 'none', steps: 0 }, m.fx);
                if (m.fill) app.setStyle({ fill: m.fill }, false);
                app.setFxMany(props, 'Material: ' + m.name);
              },
            },
            h('span.mat-ball', { 'data-mat': m.id, style: { '--c': m.fill || 'var(--mat-base)' } }),
            h('span.mat-name', m.name)
          )
        )
      );
      const out = [mats, add(W.select({ label: 'Shading', options: Object.keys(R3D.shadings).map((k) => ({ value: k, label: R3D.shadings[k].name })), get: () => fx().shading, set: set('shading') }))];
      if (!['flat', 'lineart', 'wire'].includes(fx().shading)) {
        out.push(add(W.toggle({ label: 'Smooth gradients', title: 'Draw curved surfaces with vector gradients instead of flat facets', get: () => fx().smooth, set: set('smooth') })));
        out.push(add(W.slider({ label: 'Color bands', min: 0, max: 10, step: 1, def: 0, title: '0 = continuous shading. 2–6 gives a poster / cel look.', get: () => fx().steps, set: set('steps') })));
        out.push(add(W.slider({ label: 'Smoothing angle', min: 0, max: 90, step: 1, unit: '°', def: 35, title: 'Edges sharper than this stay crisp', get: () => fx().smoothAngle, set: set('smoothAngle') })));
      }
      return out;
    }

    /* ---- Colors: front, sides, bevel, back, shadow tone, highlight ---- */
    tabColors(t) {
      const app = this.app;
      const fx = () => this.fx();
      const add = this.add.bind(this);
      const f = fx();
      const out = [
        add(
          W.colorButton({
            label: 'Front',
            title: 'Main color (the shape’s fill)',
            get: () => t.style.fill,
            set: (c, final) => app.setStyle({ fill: c || '#cccccc' }, final, 'Fill color'),
          })
        ),
      ];
      const autoColor = (prop, label, title) =>
        add(
          W.colorButton({
            label,
            title,
            allowNone: true,
            autoLabel: 'Auto',
            onAuto: () => app.setFxMany({ [prop]: null }, label + ' color'),
            get: () => fx()[prop],
            fallback: () => R3D.solidOf(t.style.fill) || '#888888',
            set: (c, final) => app.setFx(prop, c, final),
          })
        );
      if (f.kind === 'extrude' || f.kind === 'revolve') out.push(autoColor('sideColor', 'Sides', 'Color of the extruded sides (Auto = same as front)'));
      if (f.kind === 'extrude' && f.bevel !== 'none') out.push(autoColor('bevelColor', 'Bevel', 'Color of the bevel (Auto = same as sides)'));
      out.push(autoColor('backColor', 'Back', 'Color of the back face'));
      if (!['flat', 'lineart', 'wire'].includes(f.shading)) {
        out.push(
          W.row(
            'Shadow tone',
            add(
              W.segmented({
                options: [
                  { value: 'auto', label: 'Tinted', title: 'Shadows shift toward a deep cool tone of the base color' },
                  { value: 'black', label: 'Black' },
                  { value: 'custom', label: 'Custom' },
                ],
                get: () => (fx().shadowTint === 'auto' || fx().shadowTint === 'black' ? fx().shadowTint : 'custom'),
                set: (v) => app.setFxMany({ shadowTint: v === 'custom' ? '#2a2350' : v }, 'Shadow tone'),
              })
            )
          )
        );
        if (f.shadowTint !== 'auto' && f.shadowTint !== 'black') out.push(add(W.colorButton({ label: 'Shadow color', get: () => fx().shadowTint, set: (c, fl) => app.setFx('shadowTint', c || 'auto', fl) })));
        out.push(add(W.colorButton({ label: 'Highlight', title: 'Color of the brightest spots', get: () => fx().highlight, set: (c, fl) => app.setFx('highlight', c || '#ffffff', fl) })));
      }
      return out;
    }

    /* ---- Light ---- */
    tabLight(t) {
      return this.lightKids(false, t);
    }

    /* ---- Outline: edge lines and shadow ---- */
    tabOutline() {
      const app = this.app;
      const fx = () => this.fx();
      const set = (prop) => (v, final) => app.setFx(prop, v, final);
      const add = this.add.bind(this);
      const f = fx();
      const out = [];
      out.push(
        W.row(
          'Edge lines',
          add(
            W.segmented({
              options: [
                { value: 'none', label: 'None' },
                { value: 'outline', label: 'Outline', title: 'Silhouette and sharp edges' },
                { value: 'all', label: 'All', title: 'Every facet edge' },
              ],
              get: () => fx().edges,
              set: set('edges'),
            })
          )
        )
      );
      if (f.edges !== 'none' || f.shading === 'lineart' || f.shading === 'wire') {
        out.push(add(W.colorButton({ label: 'Line color', get: () => fx().edgeColor, set: (c, fl) => app.setFx('edgeColor', c || '#1b1c22', fl) })));
        out.push(add(W.slider({ label: 'Line width', min: 0.2, max: 8, step: 0.1, unit: 'px', get: () => fx().edgeWidth, set: set('edgeWidth') })));
        out.push(add(W.slider({ label: 'Crease angle', min: 5, max: 120, step: 1, unit: '°', def: 40, title: 'Only edges sharper than this get a line', get: () => fx().creaseAngle, set: set('creaseAngle') })));
      }
      out.push(
        W.row(
          'Shadow',
          add(
            W.segmented({
              options: [
                { value: 'none', label: 'None' },
                { value: 'drop', label: 'Cast', title: 'Shadow cast onto the page by the light' },
                { value: 'floor', label: 'Floor', title: 'Soft contact shadow underneath' },
              ],
              get: () => fx().shadow,
              set: set('shadow'),
            })
          )
        )
      );
      if (f.shadow !== 'none') {
        out.push(add(W.slider({ label: 'Opacity', min: 0, max: 100, step: 1, unit: '%', get: () => Math.round(fx().shadowOpacity * 100), set: (v, fl) => app.setFx('shadowOpacity', v / 100, fl) })));
        out.push(add(W.slider({ label: 'Softness', min: 0, max: 40, step: 0.5, unit: 'px', get: () => fx().shadowBlur, set: set('shadowBlur') })));
        if (f.shadow === 'drop') out.push(add(W.slider({ label: 'Distance', min: 0, max: 300, step: 1, unit: 'px', get: () => fx().shadowDist, set: set('shadowDist') })));
        out.push(add(W.colorButton({ label: 'Shadow', get: () => fx().shadowColor, set: (c, fl) => app.setFx('shadowColor', c || '#000000', fl) })));
      }
      return out;
    }

    /* ---- Style: fill, stroke (the edge lines), opacity and part names ---- */
    tabStyle(t) {
      const app = this.app;
      const fx = () => this.fx();
      const set = (prop) => (v, final) => app.setFx(prop, v, final);
      const add = this.add.bind(this);
      const stroked = fx().edges && fx().edges !== 'none';
      const out = [h('div.sub-label', 'Fill')];
      out.push(add(W.colorButton({ label: 'Fill', title: 'The shape’s color (the front of the 3D object)', get: () => t.style.fill, set: (c, final) => app.setStyle({ fill: c || '#cccccc' }, final, 'Fill color') })));
      out.push(h('div.sub-label', 'Stroke'));
      out.push(
        add(
          W.colorButton({
            label: 'Stroke',
            allowNone: true,
            title: 'Lines around the 3D object: its outline and sharp edges. None removes them.',
            get: () => (fx().edges && fx().edges !== 'none' ? fx().edgeColor : null),
            set: (c, final) => app.setStyle(c ? { stroke: c, strokeWidth: fx().edgeWidth } : { stroke: null }, final, 'Stroke'),
          })
        )
      );
      if (stroked) {
        out.push(add(W.slider({ label: 'Width', min: 0.2, max: 8, step: 0.1, unit: 'px', get: () => fx().edgeWidth, set: (v, final) => app.setStyle({ strokeWidth: v }, final, 'Stroke width') })));
        out.push(
          W.row(
            'Draw on',
            add(
              W.segmented({
                options: [
                  { value: 'outline', label: 'Outline', title: 'Silhouette and sharp edges' },
                  { value: 'all', label: 'All edges', title: 'Every facet edge' },
                ],
                get: () => fx().edges,
                set: set('edges'),
              })
            )
          )
        );
        if (fx().edges === 'outline') out.push(add(W.slider({ label: 'Crease angle', min: 5, max: 120, step: 1, unit: '°', def: 40, title: 'Only edges sharper than this get a line', get: () => fx().creaseAngle, set: set('creaseAngle') })));
      }
      out.push(h('div.sub-label', 'Opacity'));
      out.push(
        add(
          W.slider({
            label: 'Opacity',
            min: 0,
            max: 100,
            step: 1,
            unit: '%',
            def: 100,
            get: () => Math.round((t.style.opacity == null ? 1 : t.style.opacity) * 100),
            set: (v, fl) => app.setStyle({ opacity: v / 100 }, fl, 'Opacity'),
          })
        )
      );
      out.push(h('div.sub-label', 'Names'));
      out.push(
        h(
          'p.tip',
          'Every part of the result is named for what it is, its color and where it sits, like “Fill - Light Blue - Front” or “Line - Black - Top”. Fills and lines are kept in separate groups when you export SVG or expand to paths.'
        )
      );
      out.push(
        W.row(
          'Colors as',
          add(
            W.segmented({
              options: [
                { value: 'names', label: 'Names', title: 'Like “Light Blue”' },
                { value: 'cmyk', label: 'CMYK codes', title: 'Like “C75 M49 Y0 K5”' },
              ],
              get: () => (fx().nameColors === 'cmyk' ? 'cmyk' : 'names'),
              set: set('nameColors'),
            })
          )
        )
      );
      return out;
    }

    updateStats() {
      if (!this.statsEl) return;
      const t = this.target();
      const c = t && Doc.cache.get(t.id);
      if (c && c.faces != null) this.statsEl.textContent = `${c.faces} vector faces · rendered in ${Math.max(1, Math.round(c.ms || 0))} ms`;
    }
    /** The light controls: the scene light, or the object's own light when it doesn't share it. */
    lightKids(sceneOnly, t) {
      const app = this.app;
      const kids = [];
      const usesScene = () => sceneOnly || !t || !t.fx || t.fx.useSceneLight !== false;
      const L = () => (usesScene() ? app.doc.scene.light : t.fx.light);
      const setL = (k) => (v, final) => {
        if (usesScene()) app.setSceneLight({ [k]: v }, final);
        else app.setFx('light.' + k, v, final);
      };
      if (!sceneOnly)
        kids.push(
          this.add(
            W.toggle({
              label: 'Shared scene light',
              title: 'On: every 3D object uses the same light, so the scene looks consistent',
              get: () => t.fx.useSceneLight !== false,
              set: (v) => {
                const extra = v ? {} : { light: Object.assign({}, app.doc.scene.light) };
                app.setFxMany(Object.assign({ useSceneLight: v }, extra), v ? 'Use scene light' : 'Custom light');
              },
            })
          )
        );
      const sphere = this.add(
        W.lightSphere({
          get: () => L(),
          set: (v, final) => {
            if (usesScene()) app.setSceneLight(v, final);
            else {
              app.setFx('light.az', v.az, false);
              app.setFx('light.el', v.el, final);
            }
          },
        })
      );
      const sl = (k, label, min, max, step, title, scale = 100) =>
        this.add(
          W.slider({
            label,
            min,
            max,
            step,
            unit: scale === 100 ? '%' : '',
            title,
            get: () => Math.round(L()[k] * scale * 10) / 10,
            set: (v, fl) => setL(k)(v / scale, fl),
          })
        );
      kids.push(
        h(
          'div.tb-row',
          sphere,
          h(
            'div.tb-side',
            h('p.muted.small', usesScene() ? 'Drag the sun. This light is shared by all 3D objects.' : 'Drag the sun. This light only affects the selected object.'),
            W.button({ icon: 'light', label: 'Light tool', cls: 'small ghost', title: 'Aim the light directly on the canvas (L)', onClick: () => app.setTool('light') })
          )
        )
      );
      kids.push(sl('intensity', 'Intensity', 0, 200, 1, 'Strength of the main light'));
      kids.push(sl('ambient', 'Ambient', 0, 100, 1, 'Light that reaches every side'));
      kids.push(sl('fill', 'Fill light', 0, 100, 1, 'A soft second light from the opposite side'));
      kids.push(sl('specular', 'Highlight', 0, 150, 1, 'Brightness of shiny highlights'));
      kids.push(sl('gloss', 'Gloss', 0, 100, 1, 'Smaller, sharper highlights', 1));
      return kids;
    }
  }

  function paintPresetThumbs(root) {
    const th = W.theme();
    const col = { front: th.accent, back: th.side, side: th.side, top: th.top, edge: th.edge };
    root.querySelectorAll('.preset').forEach((b, i) => {
      const p = R3D.presets[i];
      b.firstChild.innerHTML = `<svg viewBox="0 0 30 30" width="30" height="30">${R3D.cubeMarkup(p.r[0], p.r[1], p.r[2], 30, col)}</svg>`;
    });
  }

  const thumbCache = new Map();
  function libThumb(id) {
    if (thumbCache.has(id)) return thumbCache.get(id);
    const subs = V3D.Shapes.fromLibrary(id);
    const svg = `<svg viewBox="-4 -4 108 108" width="34" height="34"><path d="${V3D.Path.toD(subs, 1)}" fill="currentColor" fill-rule="evenodd"/></svg>`;
    thumbCache.set(id, svg);
    return svg;
  }
  V3D.libThumb = libThumb;

  /* =============================== Fill & stroke =============================== */
  class PanelStyle extends Panel {
    target() {
      return this.app.primary();
    }
    style() {
      const t = this.target();
      if (!t) return this.app.style;
      if (t.type === 'group') {
        let found = null;
        Doc.walk([t], (x) => {
          if (!found && x.style && x.type !== 'group') found = x.style;
        });
        return Object.assign({}, found || Doc.defaultStyle(), { opacity: t.style.opacity == null ? 1 : t.style.opacity });
      }
      return t.style;
    }
    structureKey() {
      const t = this.target();
      const s = this.style();
      const ft = !s.fill ? 'none' : typeof s.fill === 'string' ? 'solid' : s.fill.type;
      const stops = typeof s.fill === 'object' && s.fill ? s.fill.stops.length : 0;
      return [this.app.sel.join(','), t ? t.type : '-', ft, stops, !!s.stroke, t && t.type === 'star' ? t.star : ''].join('|');
    }
    build() {
      const app = this.app;
      const t = this.target();
      const st = () => this.style();
      const add = this.add.bind(this);
      if (!t) this.el.append(h('p.note', 'Nothing selected — these settings apply to the next shapes you draw.'));
      if (t && t.type === 'image') {
        this.el.append(
          empty('image', 'Image', 'Images stay as pictures. Trace it to turn it into vector shapes you can make 3D.', W.button({ icon: 'trace', label: 'Trace bitmap…', primary: true, onClick: () => app.ui.showTrace() }))
        );
        this.el.append(W.section('opacity-img', 'Opacity', [add(W.slider({ label: 'Opacity', min: 0, max: 100, step: 1, unit: '%', get: () => Math.round((t.style.opacity == null ? 1 : t.style.opacity) * 100), set: (v, fl) => app.setStyle({ opacity: v / 100 }, fl, 'Opacity') }))]));
        return;
      }
      // Shape-specific properties first: they are what people reach for.
      if (t && t.type === 'text') this.el.append(this.textSection(t));
      if (t && ['rect', 'ellipse', 'star'].includes(t.type)) this.el.append(this.shapeSection(t));

      // Fill.
      const s = st();
      const ftype = !s.fill ? 'none' : typeof s.fill === 'string' ? 'solid' : s.fill.type;
      const fillKids = [];
      fillKids.push(
        add(
          W.segmented({
            label: 'Fill type',
            options: [
              { value: 'none', label: 'None' },
              { value: 'solid', label: 'Solid' },
              { value: 'linear', label: 'Linear' },
              { value: 'radial', label: 'Radial' },
            ],
            get: () => {
              const f = st().fill;
              return !f ? 'none' : typeof f === 'string' ? 'solid' : f.type;
            },
            set: (v) => {
              const cur = st().fill;
              const base = R3D.solidOf(cur) || '#f2a541';
              let fill;
              if (v === 'none') fill = null;
              else if (v === 'solid') fill = base;
              else {
                const stops = cur && typeof cur === 'object' ? cur.stops : [{ offset: 0, color: base }, { offset: 1, color: Color.toHex(Color.mix(Color.parse(base), { r: 20, g: 20, b: 40 }, 0.55)) }];
                fill = v === 'linear' ? { type: 'linear', x1: 0, y1: 0, x2: 1, y2: 0, stops } : { type: 'radial', cx: 0.5, cy: 0.5, r: 0.5, stops };
              }
              app.setStyle({ fill }, true, 'Fill type');
            },
          })
        )
      );
      if (ftype === 'solid') fillKids.push(add(W.colorButton({ label: 'Color', get: () => st().fill, set: (c, fl) => app.setStyle({ fill: c }, fl, 'Fill color') })));
      if (ftype === 'linear' || ftype === 'radial') fillKids.push(this.gradientEditor());
      if (t && t.type !== 'text')
        fillKids.push(
          W.row(
            'Overlaps',
            add(
              W.segmented({
                options: [
                  { value: 'nonzero', label: 'Fill all', title: 'Overlapping parts are filled (nonzero)' },
                  { value: 'evenodd', label: 'Make holes', title: 'Overlapping parts become holes (even-odd)' },
                ],
                get: () => st().fillRule || 'nonzero',
                set: (v) => app.setStyle({ fillRule: v }, true, 'Fill rule'),
              })
            )
          )
        );
      this.el.append(W.section('fill', 'Fill', fillKids));

      // Stroke.
      const strokeKids = [];
      strokeKids.push(add(W.colorButton({ label: 'Outline', allowNone: true, get: () => st().stroke, set: (c, fl) => app.setStyle({ stroke: c, strokeWidth: st().strokeWidth || 2 }, fl, 'Outline color') })));
      if (s.stroke) {
        strokeKids.push(add(W.slider({ label: 'Width', min: 0, max: 40, step: 0.25, unit: 'px', hardMin: 0, get: () => st().strokeWidth, set: (v, fl) => app.setStyle({ strokeWidth: v }, fl, 'Outline width') })));
        strokeKids.push(
          W.row(
            'Corners',
            add(
              W.segmented({
                options: [
                  { value: 'miter', label: 'Sharp' },
                  { value: 'round', label: 'Round' },
                  { value: 'bevel', label: 'Bevel' },
                ],
                get: () => st().strokeJoin || 'miter',
                set: (v) => app.setStyle({ strokeJoin: v }, true, 'Outline corners'),
              })
            )
          )
        );
        strokeKids.push(
          W.row(
            'Ends',
            add(
              W.segmented({
                options: [
                  { value: 'butt', label: 'Flat' },
                  { value: 'round', label: 'Round' },
                  { value: 'square', label: 'Square' },
                ],
                get: () => st().strokeCap || 'butt',
                set: (v) => app.setStyle({ strokeCap: v }, true, 'Outline ends'),
              })
            )
          )
        );
        strokeKids.push(
          W.row(
            'Dashes',
            add(
              W.segmented({
                options: [
                  { value: 'solid', label: 'Solid' },
                  { value: 'dash', label: 'Dashed' },
                  { value: 'dot', label: 'Dotted' },
                ],
                get: () => {
                  const d = st().dash;
                  if (!d || !d.length) return 'solid';
                  return d[0] < 1 ? 'dot' : 'dash';
                },
                set: (v) => {
                  const w = st().strokeWidth || 2;
                  app.setStyle({ dash: v === 'solid' ? null : v === 'dash' ? [w * 3, w * 2] : [0.01, w * 2], strokeCap: v === 'dot' ? 'round' : st().strokeCap }, true, 'Dashes');
                },
              })
            )
          )
        );
      }
      this.el.append(W.section('stroke', 'Outline (stroke)', strokeKids));
      this.el.append(
        W.section('opacity', 'Opacity', [
          add(W.slider({ label: 'Opacity', min: 0, max: 100, step: 1, unit: '%', def: 100, get: () => Math.round((st().opacity == null ? 1 : st().opacity) * 100), set: (v, fl) => app.setStyle({ opacity: v / 100 }, fl, 'Opacity') })),
        ])
      );
      if (t && t.fx) this.el.append(h('p.tip', 'This shape is 3D: its fill is the main color. Side, bevel and shadow colors live in the 3D tab.'));
    }
    gradientEditor() {
      const app = this.app;
      const g = () => this.style().fill;
      const setG = (patch, final, label = 'Gradient') => {
        const cur = g();
        const next = Object.assign({}, cur, patch);
        app.setStyle({ fill: next }, final, label);
      };
      const bar = h('div.grad-bar');
      const paintBar = () => {
        bar.style.setProperty('--g', W.gradCss(Object.assign({}, g(), { type: 'linear' })));
      };
      paintBar();
      const list = h('div.grad-stops');
      const stops = () => g().stops.slice().sort((a, b) => a.offset - b.offset);
      stops().forEach((s, i) => {
        const cb = W.colorButton({
          bare: true,
          get: () => stops()[i].color,
          set: (c, fl) => {
            const ss = stops();
            ss[i] = Object.assign({}, ss[i], { color: c || '#000000' });
            setG({ stops: ss }, fl);
            paintBar();
          },
        });
        const off = W.slider({
          label: `Stop ${i + 1}`,
          min: 0,
          max: 100,
          step: 1,
          unit: '%',
          get: () => Math.round((stops()[i] ? stops()[i].offset : 0) * 100),
          set: (v, fl) => {
            const ss = stops();
            ss[i] = Object.assign({}, ss[i], { offset: v / 100 });
            setG({ stops: ss }, fl);
            paintBar();
          },
        });
        const rm =
          g().stops.length > 2
            ? W.iconButton('minus', 'Remove stop', () => {
                const ss = stops();
                ss.splice(i, 1);
                setG({ stops: ss }, true);
              })
            : null;
        this.add(cb);
        this.add(off);
        list.append(h('div.grad-stop', cb, off, rm));
      });
      const kids = [bar, list, W.button({ icon: 'plus', label: 'Add stop', cls: 'small ghost', onClick: () => {
        const ss = stops();
        const a = ss[ss.length - 2] || ss[0];
        const b = ss[ss.length - 1];
        ss.splice(ss.length - 1, 0, { offset: (a.offset + b.offset) / 2, color: Color.toHex(Color.mix(Color.parse(a.color), Color.parse(b.color), 0.5)) });
        setG({ stops: ss }, true);
      } })];
      if (g().type === 'linear') {
        kids.push(
          this.add(
            W.slider({
              label: 'Angle',
              min: 0,
              max: 360,
              step: 1,
              unit: '°',
              get: () => {
                const f = g();
                return Math.round((V3D.U.deg(Math.atan2(f.y2 - f.y1, f.x2 - f.x1)) + 360) % 360);
              },
              set: (v, fl) => {
                const a = V3D.U.rad(v);
                setG({ x1: 0.5 - Math.cos(a) / 2, y1: 0.5 - Math.sin(a) / 2, x2: 0.5 + Math.cos(a) / 2, y2: 0.5 + Math.sin(a) / 2 }, fl);
              },
            })
          )
        );
      } else {
        kids.push(this.add(W.slider({ label: 'Radius', min: 5, max: 150, step: 1, unit: '%', get: () => Math.round((g().r || 0.5) * 100), set: (v, fl) => setG({ r: v / 100 }, fl) })));
      }
      bar.sync = paintBar;
      this.add(bar);
      return h('div.grad-editor', kids);
    }
    textSection(t) {
      const app = this.app;
      const add = this.add.bind(this);
      const setT = (k) => (v, final) => app.setProps([t], { [k]: v }, final, 'Text');
      const ta = h('textarea.text-input', { rows: 2, 'aria-label': 'Text' });
      ta.value = t.text;
      ta.addEventListener('input', () => app.setProps([t], { text: ta.value }, false));
      ta.addEventListener('change', () => app.commit('Edit text'));
      ta.sync = () => {
        if (document.activeElement !== ta) ta.value = t.text;
      };
      add(ta);
      const fonts = V3D.Presets.fonts.map((f) => ({ value: f.family, label: f.family, style: `font-family:${V3D.Trace.quoteFamily(f.family)}` }));
      if (!fonts.some((f) => f.value === t.family)) fonts.unshift({ value: t.family, label: t.family });
      const fam = add(
        W.select({
          label: 'Font',
          options: fonts,
          get: () => t.family,
          set: (v) => {
            const f = V3D.Presets.fonts.find((x) => x.family === v);
            app.setProps([t], { family: v, weight: f ? f.weight : t.weight }, true, 'Font');
            app.ui.loadFont(v);
          },
        })
      );
      return W.section('text', 'Text', [
        ta,
        fam,
        add(W.slider({ label: 'Size', min: 6, max: 400, step: 1, unit: 'px', hardMin: 1, get: () => t.size, set: setT('size') })),
        add(W.slider({ label: 'Weight', min: 100, max: 900, step: 100, get: () => t.weight, set: setT('weight') })),
        add(W.slider({ label: 'Letter spacing', min: -20, max: 100, step: 1, unit: '%', def: 0, get: () => t.spacing, set: setT('spacing') })),
        add(W.slider({ label: 'Line height', min: 0.6, max: 3, step: 0.05, def: 1.15, get: () => t.lineHeight || 1.15, set: setT('lineHeight') })),
        W.row(
          'Align',
          add(
            W.segmented({
              options: [
                { value: 'start', label: 'Left' },
                { value: 'middle', label: 'Center' },
                { value: 'end', label: 'Right' },
              ],
              get: () => t.align,
              set: setT('align'),
            })
          )
        ),
        add(W.toggle({ label: 'Italic', get: () => t.italic, set: setT('italic') })),
      ]);
    }
    shapeSection(t) {
      const app = this.app;
      const add = this.add.bind(this);
      const setP = (k) => (v, final) => app.setProps([t], { [k]: v }, final, 'Shape');
      const kids = [];
      if (t.type === 'rect') {
        kids.push(add(W.slider({ label: 'Width', min: 1, max: 2000, step: 1, unit: 'px', hardMin: 0.1, get: () => t.w, set: setP('w') })));
        kids.push(add(W.slider({ label: 'Height', min: 1, max: 2000, step: 1, unit: 'px', hardMin: 0.1, get: () => t.h, set: setP('h') })));
        kids.push(add(W.slider({ label: 'Corner radius', min: 0, max: Math.max(1, Math.round(Math.min(t.w, t.h) / 2)), step: 0.5, unit: 'px', hardMin: 0, def: 0, get: () => t.r || 0, set: setP('r') })));
      } else if (t.type === 'ellipse') {
        kids.push(add(W.slider({ label: 'Radius X', min: 1, max: 1000, step: 1, unit: 'px', hardMin: 0.1, get: () => t.rx, set: setP('rx') })));
        kids.push(add(W.slider({ label: 'Radius Y', min: 1, max: 1000, step: 1, unit: 'px', hardMin: 0.1, get: () => t.ry, set: setP('ry') })));
      } else if (t.type === 'star') {
        kids.push(
          W.row(
            'Type',
            add(
              W.segmented({
                options: [
                  { value: true, label: 'Star' },
                  { value: false, label: 'Polygon' },
                ],
                get: () => t.star,
                set: setP('star'),
              })
            )
          )
        );
        kids.push(add(W.slider({ label: 'Corners', min: 3, max: 40, step: 1, get: () => t.n, set: setP('n') })));
        if (t.star) kids.push(add(W.slider({ label: 'Spoke ratio', min: 5, max: 100, step: 1, unit: '%', get: () => Math.round((t.r2 / t.r1) * 100), set: (v, fl) => app.setProps([t], { r2: (t.r1 * v) / 100 }, fl, 'Shape') })));
        kids.push(add(W.slider({ label: 'Rounded', min: 0, max: 100, step: 1, unit: '%', def: 0, get: () => Math.round((t.round || 0) * 100), set: (v, fl) => app.setProps([t], { round: v / 100 }, fl, 'Shape') })));
        kids.push(add(W.slider({ label: 'Radius', min: 1, max: 1000, step: 1, unit: 'px', get: () => t.r1, set: (v, fl) => app.setProps([t], { r1: v, r2: (t.r2 / t.r1) * v }, fl, 'Shape') })));
      }
      kids.push(W.button({ icon: 'toPath', label: 'Convert to path', cls: 'small ghost', title: 'Edit individual nodes (Ctrl+Shift+C)', onClick: () => app.convertToPath() }));
      return W.section('shapeprops', Doc.typeName(t), kids);
    }
  }

  /* =============================== Arrange =============================== */
  class PanelArrange extends Panel {
    structureKey() {
      return [this.app.sel.length ? 'sel' : 'none', this.app.sel.length > 1 ? 'multi' : 'one'].join('|');
    }
    build() {
      const app = this.app;
      const add = this.add.bind(this);
      if (!app.sel.length) {
        this.buildDocument();
        return;
      }
      const box = () => app.selectionBBox();
      const num = (label, k, unit) =>
        add(
          W.number({
            label,
            unit,
            get: () => {
              const b = box();
              if (!b) return null;
              return { x: b.x, y: b.y, w: b.x2 - b.x, h: b.y2 - b.y }[k];
            },
            set: (v) => {
              const b = box();
              if (!b) return;
              if ((k === 'w' || k === 'h') && app.prefs.lockRatio) {
                const w = b.x2 - b.x;
                const hh = b.y2 - b.y;
                if (k === 'w') app.setSelectionBox({ w: v, h: (hh * v) / (w || 1) });
                else app.setSelectionBox({ h: v, w: (w * v) / (hh || 1) });
              } else app.setSelectionBox({ [k]: v });
            },
          })
        );
      this.el.append(
        W.section('transform', 'Position & size', [
          h('div.xywh', num('X', 'x'), num('Y', 'y'), num('W', 'w'), num('H', 'h')),
          add(W.toggle({ label: 'Keep proportions', get: () => app.prefs.lockRatio, set: (v) => app.setPref('lockRatio', v) })),
          h(
            'div.btn-row',
            W.iconButton('rotCCW', 'Rotate 90° left', () => app.rotateSelection(-90)),
            W.iconButton('rotCW', 'Rotate 90° right', () => app.rotateSelection(90)),
            W.iconButton('flipH', 'Flip horizontal (Shift+H)', () => app.flip('h')),
            W.iconButton('flipV', 'Flip vertical (Shift+V)', () => app.flip('v'))
          ),
        ])
      );
      const rel = h('p.muted.small', app.sel.length > 1 ? 'Aligns to the selection. Hold Shift to align to the page.' : 'One object aligns to the page.');
      const al = (icon, how, title) => W.iconButton(icon, title, (e) => app.align(how, e && e.shiftKey));
      this.el.append(
        W.section('align', 'Align & distribute', [
          h(
            'div.btn-row',
            al('alignLeft', 'left', 'Align left'),
            al('alignHCenter', 'hcenter', 'Align centers horizontally'),
            al('alignRight', 'right', 'Align right'),
            al('alignTop', 'top', 'Align top'),
            al('alignVCenter', 'vcenter', 'Align centers vertically'),
            al('alignBottom', 'bottom', 'Align bottom')
          ),
          h('div.btn-row', W.button({ icon: 'distH', label: 'Space horizontally', cls: 'small', onClick: () => app.distribute('h') }), W.button({ icon: 'distV', label: 'Space vertically', cls: 'small', onClick: () => app.distribute('v') })),
          rel,
        ])
      );
      this.el.append(
        W.section('order', 'Order & grouping', [
          h(
            'div.btn-row',
            W.iconButton('front', 'Bring to front (Home)', () => app.arrange('top')),
            W.iconButton('forward', 'Bring forward (Page Up)', () => app.arrange('up')),
            W.iconButton('backward', 'Send backward (Page Down)', () => app.arrange('down')),
            W.iconButton('back', 'Send to back (End)', () => app.arrange('bottom'))
          ),
          h('div.btn-row', W.button({ icon: 'group', label: 'Group', cls: 'small', onClick: () => app.group() }), W.button({ icon: 'ungroup', label: 'Ungroup', cls: 'small', onClick: () => app.ungroup() })),
        ])
      );
      const op = (icon, label, fn, title) => W.button({ icon, label, cls: 'small tile', title, onClick: fn });
      this.el.append(
        W.section('pathops', 'Combine shapes', [
          h(
            'div.tile-grid',
            op('union', 'Union', () => app.boolean('union'), 'Merge shapes into one (Ctrl+Shift++)'),
            op('difference', 'Subtract', () => app.boolean('difference'), 'Cut the upper shapes out of the bottom one'),
            op('intersection', 'Intersect', () => app.boolean('intersection'), 'Keep only the overlap'),
            op('exclusion', 'Exclude', () => app.boolean('exclusion'), 'Keep everything except the overlap'),
            op('combine', 'Combine', () => app.combine(), 'Join into one path, overlaps become holes (Ctrl+K)'),
            op('breakApart', 'Break apart', () => app.breakApart(), 'Split a path into separate shapes (Ctrl+Shift+K)')
          ),
        ])
      );
      const offAmt = h('input.num', { type: 'number', value: 6, min: 0.5, step: 0.5, 'aria-label': 'Offset distance' });
      this.el.append(
        W.section('pathtools', 'Path tools', [
          h(
            'div.tile-grid',
            op('toPath', 'To path', () => app.convertToPath(), 'Convert shapes and text to editable paths'),
            op('strokeToPath', 'Stroke → fill', () => app.strokeToPath(), 'Turn an outline into a filled shape (great before 3D)'),
            op('simplify', 'Simplify', () => app.simplify(), 'Reduce the number of nodes'),
            op('reverse', 'Reverse', () => app.reversePath(), 'Reverse path direction'),
            op('outset', 'Outset', () => app.offsetPath(+offAmt.value || 6), 'Grow the shape'),
            op('inset', 'Inset', () => app.offsetPath(-(+offAmt.value || 6)), 'Shrink the shape')
          ),
          h('label.w-number', h('span', 'Offset'), offAmt, h('span.unit', 'px')),
        ])
      );
    }
    buildDocument() {
      const app = this.app;
      const d = () => app.doc;
      const add = this.add.bind(this);
      const sizes = [
        ['1200 × 800', 1200, 800],
        ['Square 1080', 1080, 1080],
        ['HD 1920 × 1080', 1920, 1080],
        ['Story 1080 × 1920', 1080, 1920],
        ['A4 portrait', 794, 1123],
        ['Letter', 816, 1056],
        ['Icon 512', 512, 512],
      ];
      const setDoc = (props, label) => {
        Object.assign(app.doc, props);
        app.canvas.renderPage();
        app.canvas.renderGrid();
        app.requestRender();
        app.commit(label);
        app.bus.emit('doc');
      };
      const name = h('input.text', { type: 'text', value: d().name, 'aria-label': 'Drawing name' });
      name.addEventListener('change', () => setDoc({ name: name.value.trim() || 'Untitled' }, 'Rename'));
      name.sync = () => {
        if (document.activeElement !== name) name.value = d().name;
      };
      add(name);
      this.el.append(
        W.section('doc', 'Page', [
          h('label.w-text', h('span.s-label', 'Name'), name),
          add(
            W.select({
              label: 'Size',
              options: [{ value: 'custom', label: 'Custom' }].concat(sizes.map((s) => ({ value: s[1] + 'x' + s[2], label: s[0] }))),
              get: () => {
                const k = d().width + 'x' + d().height;
                return sizes.some((s) => s[1] + 'x' + s[2] === k) ? k : 'custom';
              },
              set: (v) => {
                if (v === 'custom') return;
                const [w, hh] = v.split('x').map(Number);
                setDoc({ width: w, height: hh }, 'Page size');
                app.canvas.fitPage();
              },
            })
          ),
          h(
            'div.xywh',
            add(W.number({ label: 'W', digits: 0, get: () => d().width, set: (v) => setDoc({ width: Math.max(16, Math.round(v)) }, 'Page size') })),
            add(W.number({ label: 'H', digits: 0, get: () => d().height, set: (v) => setDoc({ height: Math.max(16, Math.round(v)) }, 'Page size') }))
          ),
          add(W.colorButton({ label: 'Background', allowNone: true, get: () => d().background, set: (c, fl) => {
            app.doc.background = c;
            app.canvas.renderPage();
            if (fl) {
              app.commit('Background');
              app.bus.emit('doc');
            }
          } })),
        ])
      );
      this.el.append(
        W.section('gridsnap', 'Grid & snapping', [
          W.row(
            'Grid',
            add(
              W.segmented({
                options: [
                  { value: 'none', label: 'Off' },
                  { value: 'square', label: 'Square', icon: 'grid' },
                  { value: 'iso', label: 'Isometric', icon: 'isoGrid' },
                ],
                get: () => app.prefs.grid,
                set: (v) => app.setPref('grid', v),
              })
            )
          ),
          add(W.slider({ label: 'Grid size', min: 4, max: 100, step: 1, unit: 'px', get: () => app.prefs.gridSize, set: (v) => app.setPref('gridSize', v) })),
          add(W.toggle({ label: 'Snap to grid', get: () => app.prefs.snapGrid, set: (v) => app.setPref('snapGrid', v) })),
          add(W.toggle({ label: 'Snap to objects & page', get: () => app.prefs.snapObjects, set: (v) => app.setPref('snapObjects', v) })),
          add(W.toggle({ label: 'Rulers', get: () => app.prefs.rulers, set: (v) => app.setPref('rulers', v) })),
        ])
      );
      this.el.append(
        W.section('scene', 'Rendering', [
          add(
            W.slider({
              label: 'Seam fix',
              min: 0,
              max: 2,
              step: 0.1,
              unit: 'px',
              title: 'Hairline strokes that hide anti-aliasing gaps between 3D faces',
              get: () => d().scene.seam,
              set: (v, fl) => {
                app.doc.scene.seam = v;
                app.sceneChanged();
                app.requestRender();
                if (fl) app.commit('Seam fix');
              },
            })
          ),
        ], { open: false })
      );
    }
  }

  /* =============================== Layers =============================== */
  class PanelLayers extends Panel {
    constructor(app) {
      super(app);
      this.collapsed = new Set();
    }
    structureKey() {
      return 'L' + Math.random();
    }
    build() {
      const app = this.app;
      const list = h('ul.layers', { role: 'tree', 'aria-label': 'Objects' });
      const row = (o, depth) => {
        const sel = app.sel.includes(o.id);
        const isGroup = o.type === 'group';
        const li = h('li.layer' + (sel ? '.sel' : '') + (o.visible === false ? '.hidden' : '') + (o.locked ? '.locked' : ''), { role: 'treeitem', 'aria-selected': String(sel), draggable: 'true', 'data-id': o.id, style: { '--d': depth } });
        const caret = isGroup
          ? h('button.caret' + (this.collapsed.has(o.id) ? '' : '.open'), { type: 'button', title: 'Expand', html: V3D.icon('chevRight'), onclick: (e) => {
              e.stopPropagation();
              if (this.collapsed.has(o.id)) this.collapsed.delete(o.id);
              else this.collapsed.add(o.id);
              this.update(true);
            } })
          : h('span.caret-sp');
        const icon = o.fx ? 'cube' : { rect: 'rect', ellipse: 'ellipse', star: 'star', path: 'pen', text: 'text', group: 'group', image: 'image' }[o.type] || 'shapes';
        const sw = o.style && o.type !== 'group' && o.type !== 'image' ? h('span.l-sw', { style: { '--c': R3D.solidOf(o.style.fill) || 'transparent' } }) : null;
        const name = h('span.l-name', Doc.label(o));
        name.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          const input = h('input.text.l-rename', { type: 'text', value: o.name || Doc.label(o) });
          name.replaceWith(input);
          input.focus();
          input.select();
          const done = (ok) => {
            if (ok) {
              o.name = input.value.trim();
              app.touch(o);
              app.commit('Rename');
            }
            this.update(true);
          };
          input.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter') done(true);
            if (ev.key === 'Escape') done(false);
            ev.stopPropagation();
          });
          input.addEventListener('blur', () => done(true));
        });
        const parts = [
          caret,
          h('span.l-ico', { html: V3D.icon(icon) }),
          sw,
          name,
          o.fx ? h('span.l-badge', { title: R3D.kinds[o.fx.kind].name }, '3D') : null,
          W.iconButton(o.visible === false ? 'eyeOff' : 'eye', o.visible === false ? 'Show' : 'Hide', (e) => {
            e.stopPropagation();
            app.toggleVisible([o]);
          }, 'l-btn'),
          W.iconButton(o.locked ? 'lock' : 'unlock', o.locked ? 'Unlock' : 'Lock', (e) => {
            e.stopPropagation();
            app.toggleLock([o]);
          }, 'l-btn' + (o.locked ? ' on' : '')),
        ];
        li.append(...parts.filter(Boolean));
        li.addEventListener('click', (e) => {
          if (o.locked) return;
          if (e.shiftKey || V3D.U.modKey(e)) app.toggleSelect(o.id);
          else app.setSelection([o.id]);
        });
        li.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('text/x-v3d-id', o.id);
          e.dataTransfer.effectAllowed = 'move';
          this.dragId = o.id;
        });
        li.addEventListener('dragover', (e) => {
          if (!this.dragId || this.dragId === o.id) return;
          e.preventDefault();
          const r = li.getBoundingClientRect();
          const into = isGroup && e.clientY > r.top + r.height * 0.3 && e.clientY < r.bottom - r.height * 0.3;
          li.classList.toggle('drop-into', into);
          li.classList.toggle('drop-above', !into && e.clientY < r.top + r.height / 2);
          li.classList.toggle('drop-below', !into && e.clientY >= r.top + r.height / 2);
        });
        li.addEventListener('dragleave', () => li.classList.remove('drop-above', 'drop-below', 'drop-into'));
        li.addEventListener('drop', (e) => {
          e.preventDefault();
          const mode = li.classList.contains('drop-into') ? 'into' : li.classList.contains('drop-above') ? 'above' : 'below';
          li.classList.remove('drop-above', 'drop-below', 'drop-into');
          this.move(this.dragId, o.id, mode);
          this.dragId = null;
        });
        list.append(li);
        if (isGroup && !this.collapsed.has(o.id)) for (let i = o.children.length - 1; i >= 0; i--) row(o.children[i], depth + 1);
      };
      for (let i = app.doc.objects.length - 1; i >= 0; i--) row(app.doc.objects[i], 0);
      if (!app.doc.objects.length) this.el.append(empty('layers', 'No objects yet', 'Shapes you draw appear here, topmost first. Drag rows to reorder them.'));
      else this.el.append(h('p.muted.small.layers-hint', 'Topmost first · drag to reorder · double-click to rename'), list);
    }
    move(dragId, targetId, mode) {
      const app = this.app;
      if (!dragId || dragId === targetId) return;
      const drag = app.get(dragId);
      const target = app.get(targetId);
      if (!drag || !target) return;
      // Refuse to drop a group into itself.
      let p = target;
      while (p) {
        if (p === drag) return;
        p = app.parentOf(p.id);
      }
      const [detached] = app.detach([drag]);
      detached.id = drag.id;
      const srcList = app.listOf(dragId);
      srcList.splice(srcList.indexOf(drag), 1);
      app.reindex();
      let destList;
      let at;
      let parentM = V3D.M2.identity();
      if (mode === 'into') {
        destList = target.children;
        at = destList.length;
        parentM = V3D.M2.mul(app.parentMatrix(target.id), target.transform);
      } else {
        destList = app.listOf(targetId);
        const pr = app.parentOf(targetId);
        if (pr) parentM = V3D.M2.mul(app.parentMatrix(pr.id), pr.transform);
        at = destList.indexOf(target) + (mode === 'above' ? 1 : 0);
      }
      detached.transform = V3D.M2.mul(V3D.M2.invert(parentM), detached.transform);
      destList.splice(at, 0, detached);
      app.reindex();
      app.touch(detached);
      Doc.cache.delete(detached.id);
      app.setSelection([detached.id], true);
      app.requestRender();
      app.commit('Reorder');
      this.update(true);
    }
  }

  V3D.Panels = { Panel3D, PanelStyle, PanelArrange, PanelLayers };
})();
