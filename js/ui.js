/* Vector 3Dit — application shell: menus, toolbar, context bar, panels, footer, dialogs. */
(function () {
  'use strict';
  const V3D = globalThis.V3D;
  const { h, fmt } = V3D.U;
  const { W, Doc, R3D, IO } = V3D;

  const TOOL_GROUPS = [
    ['select', 'node'],
    ['rect', 'ellipse', 'star'],
    ['pen', 'pencil', 'text'],
    ['orbit', 'light'],
    ['eyedropper', 'zoom', 'hand'],
  ];
  const TOOL_ICONS = { select: 'select', node: 'node', rect: 'rect', ellipse: 'ellipse', star: 'star', pen: 'pen', pencil: 'pencil', text: 'text', orbit: 'orbit', light: 'light', eyedropper: 'eyedropper', zoom: 'zoom', hand: 'hand' };

  class UI {
    constructor(app, root) {
      this.app = app;
      this.root = root;
      root.classList.add('v3d-app');
      root.innerHTML = '';
      this.menubar = h('header.menubar', { role: 'menubar' });
      this.ctxbar = h('div.ctxbar', { role: 'toolbar', 'aria-label': 'Tool options' });
      this.toolbar = h('nav.toolbar', { 'aria-label': 'Tools' });
      this.canvasHost = h('main.canvas-host', { 'aria-label': 'Canvas' });
      this.panel = h('aside.panel', { 'aria-label': 'Properties' });
      this.footer = h('footer.footer');
      this.toasts = h('div.toasts', { 'aria-live': 'polite' });
      root.append(this.menubar, this.ctxbar, this.toolbar, this.canvasHost, this.panel, this.footer, this.toasts);
      this.fileInput = h('input', { type: 'file', hidden: true, multiple: true });
      root.append(this.fileInput);
      this.fileInput.addEventListener('change', () => {
        const files = Array.from(this.fileInput.files || []);
        this.fileInput.value = '';
        if (files.length) IO.importFiles(this.app, files);
      });
    }

    build() {
      this.buildMenubar();
      this.buildToolbar();
      this.buildPanel();
      this.buildFooter();
      const app = this.app;
      const refreshPanels = V3D.U.rafThrottle(() => this.refreshPanels());
      app.bus.on('selection', () => {
        this.refreshPanels(true);
        this.buildCtx();
      });
      app.bus.on('change', refreshPanels);
      app.bus.on('fx', refreshPanels);
      app.bus.on('doc', refreshPanels);
      app.bus.on('style', () => {
        this.refreshPanels();
        this.syncStyleIndicator();
      });
      app.bus.on('doc:replaced', () => {
        this.refreshPanels(true);
        this.buildCtx();
        this.loadDocFonts();
      });
      app.bus.on('structure', () => this.refreshLayers());
      app.bus.on('history', () => {
        this.syncHistoryButtons();
        this.refreshLayers();
      });
      app.bus.on('tool', () => {
        this.syncToolbar();
        this.buildCtx();
        this.setStatus(null);
      });
      app.bus.on('status', (t, transient) => this.setStatus(t, transient));
      app.bus.on('view', () => this.syncZoom());
      app.bus.on('rendered', () => {
        this.panels['3d'] && this.panels['3d'].updateStats && this.panels['3d'].updateStats();
      });
      app.bus.on('nodes', () => this.buildCtx());
      app.bus.on('prefs', () => this.refreshPanels());
      app.bus.on('theme', () => {
        W.themeChanged();
        this.refreshPanels(true);
        if (this.panels[this.tab]) this.panels[this.tab].update(true);
      });
      this.buildCtx();
      this.syncToolbar();
      this.syncHistoryButtons();
      this.refreshPanels(true);
      this.loadDocFonts();
      this.setStatus(null);
      this.syncZoom();
      // Close menus on outside click.
      document.addEventListener('pointerdown', (e) => {
        if (this.openMenuEl && !this.openMenuEl.contains(e.target) && !this.menubar.contains(e.target)) this.closeMenu();
        if (this.ctxMenu && !this.ctxMenu.contains(e.target)) this.closeContextMenu();
      });
    }

    /* ---------------- menubar ---------------- */
    menus() {
      const app = this.app;
      const has = () => app.sel.length > 0;
      const shapes = () => app.selected().some((o) => Doc.isShape(o));
      const has3D = () => app.fxTargets(true).length > 0;
      const mod = V3D.U.modName();
      return [
        {
          label: 'File',
          items: [
            { label: 'New drawing', icon: 'plus', action: () => this.newDrawing() },
            { label: 'Start from a template…', icon: 'sparkle', action: () => this.showWelcome() },
            { sep: true },
            { label: 'Open project…', icon: 'folder', key: mod + '+O', action: () => this.openFile('project') },
            { label: 'Import SVG or image…', icon: 'upload', key: mod + '+I', action: () => this.openFile('import') },
            { sep: true },
            { label: 'Save project', icon: 'save', key: mod + '+S', action: () => IO.saveProject(app) },
            { label: 'Export SVG / PNG…', icon: 'download', key: mod + '+E', action: () => this.showExport() },
            { label: 'Copy drawing as SVG', icon: 'copy', action: () => this.copySVG() },
          ],
        },
        {
          label: 'Edit',
          items: [
            { label: 'Undo', icon: 'undo', key: mod + '+Z', enabled: () => app.history.canUndo, action: () => app.history.undo() },
            { label: 'Redo', icon: 'redo', key: mod + '+Shift+Z', enabled: () => app.history.canRedo, action: () => app.history.redo() },
            { sep: true },
            { label: 'Cut', key: mod + '+X', enabled: has, action: () => app.cut() },
            { label: 'Copy', key: mod + '+C', enabled: has, action: () => app.copy() },
            { label: 'Paste', key: mod + '+V', enabled: () => !!app.clipboard, action: () => app.paste(false) },
            { label: 'Paste in place', key: mod + '+Shift+V', enabled: () => !!app.clipboard, action: () => app.paste(true) },
            { label: 'Duplicate', key: mod + '+D', enabled: has, action: () => app.duplicateSelection() },
            { label: 'Delete', key: 'Del', enabled: has, action: () => app.deleteSelection() },
            { sep: true },
            { label: 'Select all', key: mod + '+A', action: () => app.selectAll() },
            { label: 'Deselect', key: 'Esc', enabled: has, action: () => app.setSelection([]) },
          ],
        },
        {
          label: 'Object',
          items: [
            { label: 'Insert shape…', icon: 'shapes', action: () => this.showLibrary() },
            { sep: true },
            { label: 'Group', icon: 'group', key: mod + '+G', enabled: has, action: () => app.group() },
            { label: 'Ungroup', icon: 'ungroup', key: mod + '+Shift+G', enabled: () => app.selected().some((o) => o.type === 'group'), action: () => app.ungroup() },
            { sep: true },
            { label: 'Bring to front', icon: 'front', key: 'Home', enabled: has, action: () => app.arrange('top') },
            { label: 'Bring forward', icon: 'forward', key: 'PgUp', enabled: has, action: () => app.arrange('up') },
            { label: 'Send backward', icon: 'backward', key: 'PgDn', enabled: has, action: () => app.arrange('down') },
            { label: 'Send to back', icon: 'back', key: 'End', enabled: has, action: () => app.arrange('bottom') },
            { sep: true },
            { label: 'Flip horizontal', icon: 'flipH', key: 'Shift+H', enabled: has, action: () => app.flip('h') },
            { label: 'Flip vertical', icon: 'flipV', key: 'Shift+V', enabled: has, action: () => app.flip('v') },
            { label: 'Rotate 90° right', icon: 'rotCW', enabled: has, action: () => app.rotateSelection(90) },
            { label: 'Rotate 90° left', icon: 'rotCCW', enabled: has, action: () => app.rotateSelection(-90) },
            { sep: true },
            { label: 'Lock / unlock', icon: 'lock', enabled: has, action: () => app.toggleLock() },
            { label: 'Hide / show', icon: 'eyeOff', enabled: has, action: () => app.toggleVisible() },
          ],
        },
        {
          label: 'Path',
          items: [
            { label: 'Object to path', icon: 'toPath', key: mod + '+Shift+C', enabled: shapes, action: () => app.convertToPath() },
            { label: 'Stroke to path', icon: 'strokeToPath', enabled: shapes, action: () => app.strokeToPath() },
            { sep: true },
            { label: 'Union', icon: 'union', key: mod + '+Shift++', enabled: shapes, action: () => app.boolean('union') },
            { label: 'Subtract', icon: 'difference', enabled: shapes, action: () => app.boolean('difference') },
            { label: 'Intersect', icon: 'intersection', enabled: shapes, action: () => app.boolean('intersection') },
            { label: 'Exclude', icon: 'exclusion', enabled: shapes, action: () => app.boolean('exclusion') },
            { sep: true },
            { label: 'Combine', icon: 'combine', key: mod + '+K', enabled: shapes, action: () => app.combine() },
            { label: 'Break apart', icon: 'breakApart', key: mod + '+Shift+K', enabled: shapes, action: () => app.breakApart() },
            { sep: true },
            { label: 'Outset by 6 px', icon: 'outset', enabled: shapes, action: () => app.offsetPath(6) },
            { label: 'Inset by 6 px', icon: 'inset', enabled: shapes, action: () => app.offsetPath(-6) },
            { label: 'Simplify', icon: 'simplify', enabled: shapes, action: () => app.simplify() },
            { label: 'Reverse direction', icon: 'reverse', enabled: shapes, action: () => app.reversePath() },
            { sep: true },
            { label: 'Trace bitmap…', icon: 'trace', enabled: () => app.selected().some((o) => o.type === 'image'), action: () => this.showTrace() },
          ],
        },
        {
          label: '3D',
          items: [
            { label: 'Extrude', icon: 'extrude', enabled: shapes, action: () => app.apply3D('extrude') },
            { label: 'Revolve', icon: 'revolve', enabled: shapes, action: () => app.apply3D('revolve') },
            { label: 'Inflate', icon: 'inflate', enabled: shapes, action: () => app.apply3D('inflate') },
            { label: 'Flat tilt', icon: 'flat', enabled: shapes, action: () => app.apply3D('flat') },
            { label: 'Remove 3D', icon: 'close', enabled: has3D, action: () => app.remove3D() },
            { sep: true },
            { header: 'View presets' },
            ...R3D.presets.map((p) => ({ label: p.name, enabled: has3D, action: () => app.setFxMany({ rx: p.r[0], ry: p.r[1], rz: p.r[2] }, 'View: ' + p.name) })),
            { sep: true },
            { label: 'Expand to paths', icon: 'expand', enabled: has3D, action: () => app.expand3D() },
            { label: 'Copy 3D style', icon: 'copy', enabled: has3D, action: () => app.copy3D() },
            { label: 'Paste 3D style', icon: 'sparkle', enabled: () => !!app.fxClipboard && shapes(), action: () => app.paste3D() },
          ],
        },
        {
          label: 'View',
          items: [
            { label: 'Zoom in', icon: 'zoom', key: '+', action: () => app.canvas.zoomCenter(1.25) },
            { label: 'Zoom out', key: '−', action: () => app.canvas.zoomCenter(0.8) },
            { label: 'Actual size', key: '1', action: () => app.canvas.setView(1, app.canvas.x, app.canvas.y) },
            { label: 'Fit page', icon: 'fit', key: '5', action: () => app.canvas.fitPage() },
            { label: 'Fit drawing', key: '4', action: () => app.zoomDrawing() },
            { label: 'Fit selection', key: '3', enabled: has, action: () => app.canvas.fit(app.selectionBBox()) },
            { sep: true },
            { label: 'No grid', checked: () => app.prefs.grid === 'none', action: () => app.setPref('grid', 'none') },
            { label: 'Square grid', icon: 'grid', key: '#', checked: () => app.prefs.grid === 'square', action: () => app.setPref('grid', 'square') },
            { label: 'Isometric grid', icon: 'isoGrid', checked: () => app.prefs.grid === 'iso', action: () => app.setPref('grid', 'iso') },
            { label: 'Snap to grid', icon: 'magnet', checked: () => app.prefs.snapGrid, action: () => app.setPref('snapGrid', !app.prefs.snapGrid) },
            { label: 'Snap to objects', checked: () => app.prefs.snapObjects, action: () => app.setPref('snapObjects', !app.prefs.snapObjects) },
            { label: 'Rulers', checked: () => app.prefs.rulers, action: () => app.setPref('rulers', !app.prefs.rulers) },
            { sep: true },
            { label: 'Theme: follow system', icon: 'theme', checked: () => app.prefs.theme === 'system', action: () => app.setPref('theme', 'system') },
            { label: 'Theme: dark', checked: () => app.prefs.theme === 'dark', action: () => app.setPref('theme', 'dark') },
            { label: 'Theme: light', checked: () => app.prefs.theme === 'light', action: () => app.setPref('theme', 'light') },
          ],
        },
        {
          label: 'Help',
          items: [
            { label: 'Quick start', icon: 'help', action: () => this.showWelcome('guide') },
            { label: 'Keyboard shortcuts', key: '?', action: () => this.showShortcuts() },
            { label: 'About Vector 3Dit', icon: 'cube', action: () => this.showAbout() },
          ],
        },
      ];
    }

    buildMenubar() {
      const app = this.app;
      const logo = h('div.logo', { title: 'Vector 3Dit' }, h('span.logo-mark', { html: logoMark() }), h('span.logo-word', 'Vector 3Dit'));
      const menus = h('div.menus');
      this.menuDefs = this.menus();
      this.menuDefs.forEach((m, i) => {
        const b = h('button.menu-btn', { type: 'button', role: 'menuitem', 'aria-haspopup': 'true', 'aria-expanded': 'false' }, m.label);
        b.addEventListener('click', () => (this.openMenuIdx === i ? this.closeMenu() : this.openMenu(i, b)));
        b.addEventListener('pointerenter', () => {
          if (this.openMenuIdx != null && this.openMenuIdx !== i) this.openMenu(i, b);
        });
        menus.appendChild(b);
      });
      this.docTitle = h('input.doc-title', { type: 'text', 'aria-label': 'Drawing name', spellcheck: false });
      this.docTitle.addEventListener('change', () => {
        app.doc.name = this.docTitle.value.trim() || 'Untitled';
        app.commit('Rename drawing');
      });
      this.docTitle.addEventListener('keydown', (e) => e.key === 'Enter' && this.docTitle.blur());
      app.bus.on('doc:replaced', () => (this.docTitle.value = app.doc.name));
      app.bus.on('history', () => {
        if (document.activeElement !== this.docTitle) this.docTitle.value = app.doc.name;
      });
      this.docTitle.value = app.doc.name;
      this.undoBtn = W.iconButton('undo', 'Undo (' + V3D.U.modName() + '+Z)', () => app.history.undo());
      this.redoBtn = W.iconButton('redo', 'Redo (' + V3D.U.modName() + '+Shift+Z)', () => app.history.redo());
      const exportBtn = W.button({ icon: 'download', label: 'Export', primary: true, title: 'Export SVG or PNG (' + V3D.U.modName() + '+E)', onClick: () => this.showExport() });
      this.panelToggle = W.iconButton('sliders', 'Show properties', () => this.root.classList.toggle('panel-open'), 'panel-toggle');
      this.menubar.append(logo, menus, h('div.title-wrap', this.docTitle), h('div.mb-right', this.undoBtn, this.redoBtn, this.panelToggle, exportBtn));
    }
    openMenu(i, btn) {
      this.closeMenu();
      const m = this.menuDefs[i];
      const list = h('div.menu', { role: 'menu' });
      for (const it of m.items) {
        if (it.sep) {
          list.append(h('div.menu-sep', { role: 'separator' }));
          continue;
        }
        if (it.header) {
          list.append(h('div.menu-head', it.header));
          continue;
        }
        const enabled = it.enabled ? it.enabled() : true;
        const checked = it.checked ? it.checked() : null;
        const b = h(
          'button.menu-item',
          { type: 'button', role: checked == null ? 'menuitem' : 'menuitemcheckbox', 'aria-checked': checked == null ? null : String(checked), disabled: !enabled },
          h('span.mi-ico', { html: checked ? V3D.icon('check') : it.icon ? V3D.icon(it.icon) : '' }),
          h('span.mi-label', it.label),
          it.key ? h('kbd.mi-key', it.key) : null
        );
        b.addEventListener('click', () => {
          this.closeMenu();
          it.action();
        });
        list.append(b);
      }
      list.addEventListener('keydown', (e) => {
        const items = Array.from(list.querySelectorAll('.menu-item:not([disabled])'));
        const idx = items.indexOf(document.activeElement);
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          (items[idx + 1] || items[0]).focus();
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          (items[idx - 1] || items[items.length - 1]).focus();
        } else if (e.key === 'Escape') {
          this.closeMenu();
          btn.focus();
        } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          const n = this.menuDefs.length;
          const j = (i + (e.key === 'ArrowRight' ? 1 : n - 1)) % n;
          const nb = this.menubar.querySelectorAll('.menu-btn')[j];
          this.openMenu(j, nb);
        }
      });
      document.body.append(list);
      const r = btn.getBoundingClientRect();
      list.style.left = Math.min(r.left, innerWidth - list.offsetWidth - 8) + 'px';
      list.style.top = r.bottom + 2 + 'px';
      list.style.maxHeight = innerHeight - r.bottom - 12 + 'px';
      btn.classList.add('open');
      btn.setAttribute('aria-expanded', 'true');
      this.openMenuEl = list;
      this.openMenuIdx = i;
      this.openMenuBtn = btn;
      const first = list.querySelector('.menu-item:not([disabled])');
      if (first) first.focus({ preventScroll: true });
    }
    closeMenu() {
      if (this.openMenuEl) this.openMenuEl.remove();
      if (this.openMenuBtn) {
        this.openMenuBtn.classList.remove('open');
        this.openMenuBtn.setAttribute('aria-expanded', 'false');
      }
      this.openMenuEl = null;
      this.openMenuIdx = null;
      this.openMenuBtn = null;
    }
    syncHistoryButtons() {
      const hs = this.app.history;
      if (!this.undoBtn) return;
      this.undoBtn.disabled = !hs.canUndo;
      this.redoBtn.disabled = !hs.canRedo;
      this.undoBtn.title = hs.canUndo ? `Undo ${hs.undoLabel.toLowerCase()} (${V3D.U.modName()}+Z)` : 'Nothing to undo';
      this.redoBtn.title = hs.canRedo ? `Redo ${hs.redoLabel.toLowerCase()} (${V3D.U.modName()}+Shift+Z)` : 'Nothing to redo';
    }

    /* ---------------- toolbar ---------------- */
    buildToolbar() {
      this.toolBtns = {};
      TOOL_GROUPS.forEach((g, gi) => {
        if (gi) this.toolbar.append(h('div.tool-sep'));
        for (const id of g) {
          const t = V3D.Tools[id];
          const b = h('button.tool', { type: 'button', title: `${t.name} (${t.shortcut})`, 'aria-label': t.name, 'aria-pressed': 'false', html: V3D.icon(TOOL_ICONS[id]) });
          b.appendChild(h('span.tool-key', t.shortcut));
          b.addEventListener('click', () => this.app.setTool(id));
          this.toolbar.append(b);
          this.toolBtns[id] = b;
        }
      });
    }
    syncToolbar() {
      for (const id in this.toolBtns) {
        const on = id === this.app.toolId;
        this.toolBtns[id].classList.toggle('on', on);
        this.toolBtns[id].setAttribute('aria-pressed', String(on));
      }
    }

    /* ---------------- context bar ---------------- */
    buildCtx() {
      const app = this.app;
      const t = app.tool;
      const bar = this.ctxbar;
      bar.innerHTML = '';
      this.ctxControls = [];
      const addc = (c) => (this.ctxControls.push(c), c);
      bar.append(h('div.ctx-name', h('span', { html: V3D.icon(TOOL_ICONS[app.toolId] || 'select') }), h('span', t ? t.name : '')));
      const grp = (...k) => h('div.ctx-grp', k);
      const append = bar.append.bind(bar);
      bar.append = (...kids) => append(...kids.filter((k) => k != null && k !== false));
      const opts = app.toolOpts;
      switch (app.toolId) {
        case 'select': {
          if (!app.sel.length) {
            bar.append(h('span.ctx-hint', 'Click a shape to select it · drag on empty space to select several'));
            break;
          }
          const box = () => app.selectionBBox();
          const num = (label, k) =>
            addc(
              W.number({
                label,
                get: () => {
                  const b = box();
                  return b ? { x: b.x, y: b.y, w: b.x2 - b.x, h: b.y2 - b.y }[k] : null;
                },
                set: (v) => app.setSelectionBox({ [k]: v }),
              })
            );
          bar.append(grp(num('X', 'x'), num('Y', 'y'), num('W', 'w'), num('H', 'h')));
          bar.append(
            grp(
              W.iconButton('rotCCW', 'Rotate 90° left', () => app.rotateSelection(-90)),
              W.iconButton('rotCW', 'Rotate 90° right', () => app.rotateSelection(90)),
              W.iconButton('flipH', 'Flip horizontal', () => app.flip('h')),
              W.iconButton('flipV', 'Flip vertical', () => app.flip('v'))
            )
          );
          bar.append(grp(W.iconButton('front', 'Bring to front', () => app.arrange('top')), W.iconButton('back', 'Send to back', () => app.arrange('bottom'))));
          if (app.fxTargets().length)
            bar.append(
              grp(
                h('span.ctx-label', '3D'),
                W.button({ icon: 'extrude', label: 'Extrude', cls: 'small', onClick: () => app.apply3D('extrude') }),
                W.button({ icon: 'revolve', label: 'Revolve', cls: 'small', onClick: () => app.apply3D('revolve') }),
                W.button({ icon: 'inflate', label: 'Inflate', cls: 'small', onClick: () => app.apply3D('inflate') })
              )
            );
          break;
        }
        case 'node': {
          const tool = V3D.Tools.node;
          const o = tool.target();
          if (!o) {
            bar.append(h('span.ctx-hint', 'Click a shape to edit its nodes'));
            break;
          }
          if (o.type !== 'path') {
            const msg = o.type === 'text' ? 'Text keeps its letters editable. Convert it to a path to reshape individual letters.' : 'Drag the yellow handles to change this ' + Doc.typeName(o).toLowerCase() + ', or convert it to edit every node.';
            bar.append(h('span.ctx-hint', msg), W.button({ icon: 'toPath', label: 'Convert to path', cls: 'small', onClick: () => app.convertToPath([o]) }));
            break;
          }
          const n = tool.sel.size;
          bar.append(
            grp(
              W.button({ label: 'Corner', cls: 'small', title: 'Make selected nodes sharp corners', onClick: () => tool.setType('c') }),
              W.button({ label: 'Smooth', cls: 'small', title: 'Make selected nodes smooth', onClick: () => tool.setType('s') }),
              W.button({ label: 'Symmetric', cls: 'small', title: 'Smooth with equal handles', onClick: () => tool.setType('z') })
            ),
            grp(
              W.button({ label: 'Line', cls: 'small', title: 'Straighten segments between selected nodes', onClick: () => tool.segments('line') }),
              W.button({ label: 'Curve', cls: 'small', title: 'Curve segments between selected nodes', onClick: () => tool.segments('curve') })
            ),
            grp(
              W.iconButton('plus', 'Add node between selected nodes', () => tool.insertNodes()),
              W.iconButton('trash', 'Delete selected nodes (Del)', () => tool.deleteNodes()),
              W.button({ label: 'Break', cls: 'small', title: 'Split the path at the selected node', onClick: () => tool.breakAtNodes() }),
              W.button({ label: 'Join', cls: 'small', title: 'Join two end nodes', onClick: () => tool.joinNodes() }),
              W.button({ label: 'Open/close', cls: 'small', title: 'Open or close the path', onClick: () => tool.toggleClosed() })
            ),
            h('span.ctx-hint', n ? `${n} node${n === 1 ? '' : 's'} selected` : 'Click or drag around nodes to select them')
          );
          break;
        }
        case 'rect':
          bar.append(grp(addc(W.number({ label: 'Corner radius', unit: 'px', min: 0, get: () => opts.rect.r, set: (v) => (opts.rect.r = Math.max(0, v)) }))), h('span.ctx-hint', 'Shift: square · Alt: from center'));
          break;
        case 'ellipse':
          bar.append(h('span.ctx-hint', 'Shift: circle · Alt: from center'));
          break;
        case 'star':
          bar.append(
            grp(
              addc(W.segmented({ options: [{ value: true, label: 'Star', icon: 'star' }, { value: false, label: 'Polygon', icon: 'shapes' }], get: () => opts.star.star, set: (v) => (opts.star.star = v) })),
              addc(W.number({ label: 'Corners', min: 3, max: 60, digits: 0, get: () => opts.star.n, set: (v) => (opts.star.n = Math.max(3, Math.round(v))) })),
              addc(W.number({ label: 'Spoke ratio', unit: '%', min: 5, max: 100, digits: 0, get: () => Math.round(opts.star.ratio * 100), set: (v) => (opts.star.ratio = Math.min(1, Math.max(0.05, v / 100))) })),
              addc(W.number({ label: 'Rounded', unit: '%', min: 0, max: 100, digits: 0, get: () => Math.round(opts.star.round * 100), set: (v) => (opts.star.round = Math.min(1, Math.max(0, v / 100))) }))
            ),
            W.button({ icon: 'shapes', label: 'Shape library…', cls: 'small ghost', onClick: () => this.showLibrary() })
          );
          break;
        case 'pencil':
          bar.append(grp(addc(W.number({ label: 'Smoothing', min: 0, max: 20, digits: 0, get: () => opts.pencil.smooth, set: (v) => (opts.pencil.smooth = Math.min(20, Math.max(0, v))) }))), h('span.ctx-hint', 'End near the start to close the shape'));
          break;
        case 'text': {
          const ts = opts.text;
          const sel = app.selected().filter((o) => o.type === 'text');
          const apply = (props) => {
            Object.assign(ts, props);
            if (sel.length) app.setProps(sel, props, true, 'Text');
          };
          const fonts = V3D.Presets.fonts.map((f) => ({ value: f.family, label: f.family }));
          bar.append(
            grp(
              addc(
                W.select({
                  label: 'Font',
                  bare: true,
                  options: fonts,
                  get: () => (sel[0] ? sel[0].family : ts.family),
                  set: (v) => {
                    const f = V3D.Presets.fonts.find((x) => x.family === v);
                    apply({ family: v, weight: f ? f.weight : 700 });
                    this.loadFont(v);
                  },
                })
              ),
              addc(W.number({ label: 'Size', unit: 'px', min: 4, digits: 0, get: () => (sel[0] ? sel[0].size : ts.size), set: (v) => apply({ size: Math.max(4, v) }) })),
              addc(W.segmented({ options: [{ value: 'start', label: 'Left' }, { value: 'middle', label: 'Center' }, { value: 'end', label: 'Right' }], get: () => (sel[0] ? sel[0].align : ts.align), set: (v) => apply({ align: v }) }))
            ),
            h('span.ctx-hint', 'Text turns into outlines, so it works with every 3D effect')
          );
          break;
        }
        case 'orbit': {
          const has = app.fxTargets(true).length > 0;
          bar.append(
            grp(
              W.select({
                label: 'View preset',
                bare: true,
                options: [{ value: '', label: 'Preset view…' }].concat(R3D.presets.map((p) => ({ value: p.id, label: p.name }))),
                get: () => '',
                set: (v) => {
                  const p = R3D.presets.find((x) => x.id === v);
                  if (!p) return;
                  if (!app.fxTargets(true).length) app.apply3D('extrude');
                  app.setFxMany({ rx: p.r[0], ry: p.r[1], rz: p.r[2] }, 'View: ' + p.name);
                  this.buildCtx();
                },
              }),
              W.button({ icon: 'rotCCW', label: 'Reset', cls: 'small', onClick: () => app.setFxMany({ rx: 0, ry: 0, rz: 0 }, 'Reset rotation') })
            ),
            has
              ? grp(
                  addc(
                    W.number({
                      label: 'Perspective',
                      unit: '°',
                      min: 0,
                      max: 160,
                      digits: 0,
                      get: () => {
                        const o = app.fxTargets(true).pop();
                        return o ? o.fx.persp : null;
                      },
                      set: (v) => app.setFx('persp', Math.max(0, Math.min(160, v)), true),
                    })
                  )
                )
              : null,
            h('span.ctx-hint', 'Shift: one axis · Alt: spin flat')
          );
          break;
        }
        case 'light':
          bar.append(
            grp(
              addc(W.number({ label: 'Intensity', unit: '%', min: 0, max: 200, digits: 0, get: () => Math.round(V3D.Tools.light.targetLight().light.intensity * 100), set: (v) => {
                const tl = V3D.Tools.light.targetLight();
                if (tl.scene) app.setSceneLight({ intensity: v / 100 });
                else app.setFx('light.intensity', v / 100, true);
              } })),
              addc(W.number({ label: 'Ambient', unit: '%', min: 0, max: 100, digits: 0, get: () => Math.round(V3D.Tools.light.targetLight().light.ambient * 100), set: (v) => {
                const tl = V3D.Tools.light.targetLight();
                if (tl.scene) app.setSceneLight({ ambient: v / 100 });
                else app.setFx('light.ambient', v / 100, true);
              } }))
            ),
            h('span.ctx-hint', 'Drag on the canvas to aim the light')
          );
          break;
        case 'zoom':
          bar.append(grp(W.iconButton('minus', 'Zoom out', () => app.canvas.zoomCenter(0.8)), W.iconButton('plus', 'Zoom in', () => app.canvas.zoomCenter(1.25)), W.button({ icon: 'fit', label: 'Fit page', cls: 'small', onClick: () => app.canvas.fitPage() })));
          break;
        default:
          bar.append(h('span.ctx-hint', t ? t.hint : ''));
      }
    }

    /* ---------------- panel ---------------- */
    buildPanel() {
      const app = this.app;
      this.panels = {
        '3d': new V3D.Panels.Panel3D(app),
        style: new V3D.Panels.PanelStyle(app),
        arrange: new V3D.Panels.PanelArrange(app),
        layers: new V3D.Panels.PanelLayers(app),
      };
      const tabs = [
        ['3d', '3D', 'cube'],
        ['style', 'Style', 'palette'],
        ['arrange', 'Arrange', 'alignHCenter'],
        ['layers', 'Layers', 'layers'],
      ];
      this.tab = V3D.U.storage.get('vector3dit.tab', '3d');
      const tabbar = h('div.tabs', { role: 'tablist' });
      this.tabBtns = {};
      for (const [id, label, icon] of tabs) {
        const b = h('button.tab', { type: 'button', role: 'tab', 'aria-selected': 'false', id: 'tab-' + id }, h('span', { html: V3D.icon(icon) }), h('span', label));
        b.addEventListener('click', () => this.setTab(id));
        tabbar.append(b);
        this.tabBtns[id] = b;
      }
      this.panelScroll = h('div.panel-scroll', { role: 'tabpanel' });
      this.panel.append(tabbar, this.panelScroll, W.iconButton('close', 'Close properties', () => this.root.classList.remove('panel-open'), 'panel-close'));
      this.setTab(this.tab);
      void app;
    }
    setTab(id) {
      this.tab = id;
      V3D.U.storage.set('vector3dit.tab', id);
      for (const k in this.tabBtns) {
        this.tabBtns[k].classList.toggle('on', k === id);
        this.tabBtns[k].setAttribute('aria-selected', String(k === id));
      }
      this.panelScroll.innerHTML = '';
      this.panelScroll.setAttribute('aria-labelledby', 'tab-' + id);
      const p = this.panels[id];
      this.panelScroll.append(p.el);
      p.update(true);
    }
    refreshPanels(force) {
      const p = this.panels && this.panels[this.tab];
      if (!p) return;
      if (this.tab === 'layers') {
        if (force) p.update(true);
        return;
      }
      p.update(force && this.tab !== '3d' ? false : false);
      if (this.ctxControls) for (const c of this.ctxControls) c.sync && c.sync();
      this.syncStyleIndicator();
    }
    refreshLayers() {
      if (this.tab === 'layers') this.panels.layers.update(true);
      else this.refreshPanels();
    }

    /* ---------------- footer ---------------- */
    buildFooter() {
      const app = this.app;
      this.fillInd = h('button.ind-fill', { type: 'button', title: 'Fill color of the selection (or of new shapes)' });
      this.strokeInd = h('button.ind-stroke', { type: 'button', title: 'Outline color' });
      const cur = () => {
        const o = app.primary();
        return o && o.style ? o.style : app.style;
      };
      this.fillInd.addEventListener('click', () =>
        W.colorPicker(this.fillInd, { value: V3D.R3D.solidOf(cur().fill) || '#f2a541', allowNone: true, label: 'Fill', onInput: (c) => app.setStyle({ fill: c }, false), onChange: (c) => app.setStyle({ fill: c }, true, 'Fill color') })
      );
      this.strokeInd.addEventListener('click', () =>
        W.colorPicker(this.strokeInd, { value: typeof cur().stroke === 'string' ? cur().stroke : '#1b1c22', allowNone: true, label: 'Outline', onInput: (c) => app.setStyle({ stroke: c, strokeWidth: cur().strokeWidth || 2 }, false), onChange: (c) => app.setStyle({ stroke: c, strokeWidth: cur().strokeWidth || 2 }, true, 'Outline color') })
      );
      const ind = h('div.style-ind', this.fillInd, this.strokeInd);
      const pal = h('div.palette', { role: 'list', 'aria-label': 'Color palette: click for fill, Shift-click for outline' });
      pal.append(
        h('button.pal-sw.none', { type: 'button', title: 'No color (Shift-click: no outline)', onclick: (e) => app.applyColor(null, e.shiftKey ? 'stroke' : 'fill') })
      );
      for (const c of W.palette) pal.append(h('button.pal-sw', { type: 'button', title: `${c} — click: fill, Shift-click: outline`, style: { '--c': c }, onclick: (e) => app.applyColor(c, e.shiftKey ? 'stroke' : 'fill') }));
      this.statusEl = h('div.status', { 'aria-live': 'polite' });
      this.zoomEl = h('button.zoom-val', { type: 'button', title: 'Zoom — click to fit the page', onclick: () => app.canvas.fitPage() });
      this.footer.append(
        ind,
        pal,
        this.statusEl,
        h('div.zoom', W.iconButton('minus', 'Zoom out', () => app.canvas.zoomCenter(0.8)), this.zoomEl, W.iconButton('plus', 'Zoom in', () => app.canvas.zoomCenter(1.25)))
      );
      this.syncStyleIndicator();
    }
    syncStyleIndicator() {
      if (!this.fillInd) return;
      const o = this.app.primary();
      const s = o && o.style && o.type !== 'group' ? o.style : this.app.style;
      const f = s.fill;
      this.fillInd.style.setProperty('--c', !f ? 'transparent' : typeof f === 'object' ? W.gradCss(f) : f);
      this.fillInd.classList.toggle('none', !f);
      this.strokeInd.style.setProperty('--c', s.stroke && typeof s.stroke === 'string' ? s.stroke : 'transparent');
      this.strokeInd.classList.toggle('none', !s.stroke);
    }
    setStatus(text, transient) {
      if (!this.statusEl) return;
      if (text) {
        this.statusEl.textContent = text;
        this.statusEl.classList.toggle('transient', !!transient);
        return;
      }
      const t = this.app.tool;
      this.statusEl.textContent = t ? t.hint : '';
      this.statusEl.classList.remove('transient');
    }
    syncZoom() {
      if (this.zoomEl) this.zoomEl.textContent = Math.round(this.app.canvas.zoom * 100) + '%';
    }

    /* ---------------- toasts & dialogs ---------------- */
    toast(msg, kind) {
      const t = h('div.toast' + (kind ? '.' + kind : ''), msg);
      this.toasts.append(t);
      while (this.toasts.children.length > 3) this.toasts.firstChild.remove();
      setTimeout(() => t.classList.add('out'), kind === 'error' ? 4200 : 2400);
      setTimeout(() => t.remove(), kind === 'error' ? 4600 : 2800);
    }
    modal({ title, body, actions = [], wide, cls, onClose }) {
      W.closePopover();
      const prevFocus = document.activeElement;
      const close = () => {
        overlay.remove();
        document.removeEventListener('keydown', onKey, true);
        onClose && onClose();
        if (prevFocus && prevFocus.focus) prevFocus.focus({ preventScroll: true });
      };
      const onKey = (e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          e.preventDefault();
          close();
        }
      };
      const acts = h(
        'div.dlg-actions',
        actions.map((a) =>
          W.button({
            label: a.label,
            icon: a.icon,
            primary: a.primary,
            cls: a.cls,
            onClick: () => {
              const r = a.onClick ? a.onClick() : null;
              if (r !== false) close();
            },
          })
        )
      );
      const dlg = h(
        'div.dialog' + (wide ? '.wide' : '') + (cls ? '.' + cls : ''),
        { role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
        h('div.dlg-head', h('h2', title), W.iconButton('close', 'Close', close)),
        h('div.dlg-body', body),
        actions.length ? acts : null
      );
      const overlay = h('div.overlay', dlg);
      overlay.addEventListener('pointerdown', (e) => {
        if (e.target === overlay) close();
      });
      document.addEventListener('keydown', onKey, true);
      document.body.append(overlay);
      const f = dlg.querySelector('.dlg-body input, .dlg-body button, .dlg-actions .primary');
      if (f) f.focus({ preventScroll: true });
      return { close, el: dlg };
    }
    confirm(title, text, yes = 'OK', no = 'Cancel') {
      return new Promise((resolve) => {
        let done = false;
        this.modal({
          title,
          body: h('p', text),
          actions: [
            { label: no, onClick: () => ((done = true), resolve(false)) },
            { label: yes, primary: true, onClick: () => ((done = true), resolve(true)) },
          ],
          onClose: () => !done && resolve(false),
        });
      });
    }
    showCode(title, text, note) {
      const ta = h('textarea.code', { readonly: true, rows: 14, spellcheck: false });
      ta.value = text;
      this.modal({
        title,
        wide: true,
        body: h('div', note ? h('p.muted', note) : null, ta),
        actions: [
          {
            label: 'Copy',
            icon: 'copy',
            primary: true,
            onClick: () => {
              V3D.U.copyText(text).then((ok) => {
                if (!ok) {
                  ta.select();
                  this.toast('Press ' + V3D.U.modName() + '+C to copy the selected text');
                } else this.toast('Copied to clipboard');
              });
              return false;
            },
          },
          { label: 'Close' },
        ],
      });
      setTimeout(() => ta.select(), 50);
    }
    async copySVG() {
      const svg = IO.buildSVG(this.app, { area: 'page', editable: false });
      const ok = await V3D.U.copyText(svg);
      if (ok) this.toast('Copied the drawing as SVG — paste it into Figma, Illustrator or Inkscape');
      else this.showCode('SVG code', svg, 'Copy this SVG markup.');
    }

    openFile(kind) {
      this.fileInput.accept = kind === 'project' ? '.json,.vector3dit.json,.svg,application/json,image/svg+xml' : '.svg,image/svg+xml,image/png,image/jpeg,image/webp,image/gif';
      this.fileInput.click();
    }
    async newDrawing() {
      const ok = await this.confirm('Start a new drawing?', 'The current drawing will be replaced. Save it first if you want to keep it.', 'New drawing');
      if (ok) this.app.newDoc();
    }

    showWelcome(tab) {
      const app = this.app;
      let dlg;
      const cards = h(
        'div.tpl-grid',
        V3D.Presets.templates.map((t) => {
          const card = h(
            'button.tpl',
            {
              type: 'button',
              onclick: () => {
                app.loadDoc(t.make());
                if (t.grid) app.setPref('grid', t.grid);
                app.prefs.welcomed = true;
                app.savePrefs();
                dlg.close();
              },
            },
            h('span.tpl-thumb', { 'data-tpl': t.id }),
            h('span.tpl-name', t.name),
            h('span.tpl-desc', t.desc)
          );
          return card;
        })
      );
      const guide = h(
        'ol.guide',
        h('li', h('strong', 'Draw a shape.'), ' Use the rectangle, ellipse, star, pen or text tools on the left — or pick one from Object › Insert shape.'),
        h('li', h('strong', 'Make it 3D.'), ' With the shape selected, open the 3D tab and choose Extrude, Revolve or Inflate.'),
        h('li', h('strong', 'Turn it.'), ' Press O for the Orbit tool and drag the shape, or use the view presets. Press L to aim the light.'),
        h('li', h('strong', 'Style it.'), ' Pick a material (Glossy, Toon, Gold…), add a bevel, outlines or a cast shadow.'),
        h('li', h('strong', 'Export.'), ' Everything stays vector: export SVG for any design tool, or PNG at up to 4×.')
      );
      dlg = this.modal({
        title: tab === 'guide' ? 'Quick start' : 'Welcome to Vector 3Dit',
        wide: true,
        cls: 'welcome',
        body: h(
          'div.welcome-body',
          h('p.lede', 'Draw flat vector shapes, then extrude, revolve and inflate them into 3D — the result is still 100% vector art.'),
          guide,
          h('h3', 'Start from'),
          cards
        ),
        actions: [
          {
            label: 'Keep current drawing',
            primary: true,
            onClick: () => {
              app.prefs.welcomed = true;
              app.savePrefs();
            },
          },
        ],
        onClose: () => {
          app.prefs.welcomed = true;
          app.savePrefs();
        },
      });
      // Render template thumbnails after the dialog is visible.
      setTimeout(() => {
        for (const t of V3D.Presets.templates) {
          const el = dlg.el.querySelector(`[data-tpl="${t.id}"]`);
          if (!el) continue;
          try {
            const d = t.make();
            const svg = Doc.toSVG(d, {});
            el.innerHTML = svg.replace('<svg ', '<svg preserveAspectRatio="xMidYMid meet" ');
          } catch (e) {
            console.warn(e);
          }
        }
        app.requestRender();
      }, 60);
    }

    showShortcuts() {
      const mod = V3D.U.modName();
      const rows = [
        ['Tools', ''],
        ...Object.values(V3D.Tools)
          .filter((t) => t && t.shortcut)
          .map((t) => [t.name, t.shortcut]),
        ['Editing', ''],
        ['Undo / redo', `${mod}+Z / ${mod}+Shift+Z`],
        ['Copy, cut, paste', `${mod}+C, X, V`],
        ['Duplicate', `${mod}+D`],
        ['Group / ungroup', `${mod}+G / ${mod}+Shift+G`],
        ['Combine / break apart', `${mod}+K / ${mod}+Shift+K`],
        ['Object to path', `${mod}+Shift+C`],
        ['Nudge (×10 with Shift)', 'Arrow keys'],
        ['Raise / lower', 'PgUp / PgDn'],
        ['To front / to back', 'Home / End'],
        ['Flip', 'Shift+H / Shift+V'],
        ['Alt-drag', 'Duplicate while moving'],
        ['View', ''],
        ['Pan', 'Space+drag, middle mouse, or scroll'],
        ['Zoom', `${mod}+scroll, + / −`],
        ['100% · selection · drawing · page', '1 · 3 · 4 · 5'],
        ['Toggle grid', '#'],
        ['Files', ''],
        ['Open · import · save · export', `${mod}+O · ${mod}+I · ${mod}+S · ${mod}+E`],
      ];
      const table = h(
        'table.keys',
        h(
          'tbody',
          rows.map(([a, b]) => (b ? h('tr', h('td', a), h('td', h('kbd', b))) : h('tr.kh', h('th', { colspan: 2 }, a))))
        )
      );
      this.modal({ title: 'Keyboard shortcuts', body: h('div.keys-wrap', table), actions: [{ label: 'Close', primary: true }] });
    }

    showAbout() {
      this.modal({
        title: 'About Vector 3Dit',
        body: h(
          'div.about',
          h('div.about-logo', { html: logoMark(64) }),
          h('p', 'Vector 3Dit is a vector illustration app with real 3D tools. Extrude, revolve and inflate flat shapes, light them, and export clean SVG — every face stays a vector shape you can edit anywhere.'),
          h('p.muted', 'Your work is saved in this browser automatically. Use File › Save project to keep a copy, and File › Export for SVG or PNG.')
        ),
        actions: [{ label: 'Close', primary: true }],
      });
    }

    showLibrary() {
      const grid = h(
        'div.lib-grid.big',
        V3D.Shapes.library.map((s) =>
          h(
            'button.lib-btn',
            {
              type: 'button',
              title: s.profile ? s.name + ' — made for Revolve' : s.name,
              onclick: () => {
                this.addLibraryShape(s.id);
                dlg.close();
              },
            },
            h('span', { html: V3D.libThumb(s.id) }),
            h('span.lib-name', s.name),
            s.profile ? h('span.lib-tag', 'revolve') : null
          )
        )
      );
      const dlg = this.modal({ title: 'Insert a shape', wide: true, body: h('div', h('p.muted', 'Profiles marked “revolve” are half-shapes: revolve them around their left edge to make vases, bottles and chess pieces.'), grid) });
    }
    addLibraryShape(id) {
      const app = this.app;
      const lib = V3D.Shapes.library.find((s) => s.id === id);
      const subs = V3D.Shapes.fromLibrary(id);
      const d = app.doc;
      const size = Math.min(d.width, d.height) * 0.3;
      const k = size / 100;
      const [w, hh] = app.canvas.size();
      const [cx, cy] = app.canvas.toDoc(app.canvas.rect().left + w / 2, app.canvas.rect().top + hh / 2);
      const placed = V3D.Path.transform(subs, [k, 0, 0, k, cx - 50 * k, cy - 50 * k]);
      const o = Doc.make('path', { subs: placed, name: lib.name }, app.newStyle());
      if (lib.id === 'ring' || lib.id === 'pin' || lib.id === 'gear') o.style.fillRule = 'evenodd';
      if (lib.profile) {
        o.fx = R3D.defaults('revolve', size);
        o.fx.rx = 12;
        o.fx.ry = 0;
      }
      if (!o.style.fill) o.style.fill = '#f2a541';
      app.setTool('select');
      app.addObject(o, { label: 'Insert ' + lib.name.toLowerCase() });
      if (lib.profile) this.toast('Profile inserted and revolved — change the axis or angle in the 3D tab');
    }

    showExport() {
      const app = this.app;
      const st = Object.assign({ format: 'svg', area: app.sel.length ? 'selection' : 'page', bg: true, scale: 2, editable: true }, this.exportState || {});
      if (!app.sel.length && st.area === 'selection') st.area = 'page';
      this.exportState = st;
      const preview = h('div.exp-preview');
      const info = h('p.muted.small.exp-info');
      const refresh = () => {
        const svg = IO.buildSVG(app, { area: st.area, background: st.bg, editable: false });
        preview.innerHTML = svg.replace(/<svg /, '<svg preserveAspectRatio="xMidYMid meet" ');
        const area = IO.exportArea(app, st.area);
        const w = Math.round(area.x2 - area.x);
        const hh = Math.round(area.y2 - area.y);
        info.textContent = st.format === 'svg' ? `${w} × ${hh} px · ${(svg.length / 1024).toFixed(0)} KB of SVG` : `${Math.round(w * st.scale)} × ${Math.round(hh * st.scale)} px PNG`;
        pngOnly.hidden = st.format !== 'png';
        svgOnly.hidden = st.format !== 'svg';
      };
      const seg = (label, key, options) =>
        W.row(
          label,
          W.segmented({
            options,
            get: () => st[key],
            set: (v) => {
              st[key] = v;
              refresh();
            },
          })
        );
      const pngOnly = h('div', seg('Scale', 'scale', [1, 2, 3, 4].map((s) => ({ value: s, label: s + '×' }))));
      const svgOnly = h(
        'div',
        W.toggle({ label: 'Keep editable 3D data', title: 'Embeds the project so Vector 3Dit can reopen this SVG with all 3D settings', get: () => st.editable, set: (v) => (st.editable = v) })
      );
      const body = h(
        'div.export',
        preview,
        h(
          'div.exp-opts',
          seg('Format', 'format', [
            { value: 'svg', label: 'SVG (vector)' },
            { value: 'png', label: 'PNG (image)' },
          ]),
          seg('Area', 'area', [
            { value: 'page', label: 'Page' },
            { value: 'drawing', label: 'Drawing' },
            { value: 'selection', label: 'Selection', title: app.sel.length ? '' : 'Select something first' },
          ]),
          W.toggle({ label: 'Include page background', get: () => st.bg, set: (v) => ((st.bg = v), refresh()) }),
          pngOnly,
          svgOnly,
          info
        )
      );
      const base = IO.fileBase(app);
      this.modal({
        title: 'Export',
        wide: true,
        body,
        actions: [
          {
            label: 'Copy SVG code',
            icon: 'copy',
            onClick: () => {
              const svg = IO.buildSVG(app, { area: st.area, background: st.bg, editable: st.editable });
              V3D.U.copyText(svg).then((ok) => (ok ? this.toast('SVG copied to clipboard') : this.showCode('SVG code', svg)));
              return false;
            },
          },
          {
            label: 'Download',
            icon: 'download',
            primary: true,
            onClick: async () => {
              if (st.format === 'svg') {
                const svg = IO.buildSVG(app, { area: st.area, background: st.bg, editable: st.editable });
                const r = await V3D.U.saveFile(base + '.svg', svg, 'image/svg+xml');
                if (IO.saveOutcome(app, r, base + '.svg')) this.showCode('SVG code', svg, 'Saving files is blocked here — copy the SVG code instead.');
              } else {
                const svg = IO.buildSVG(app, { area: st.area, background: st.bg, editable: false });
                const area = IO.exportArea(app, st.area);
                try {
                  const blob = await IO.svgToPNG(svg, area.x2 - area.x, area.y2 - area.y, st.scale);
                  const r = await V3D.U.saveFile(base + '.png', blob, 'image/png');
                  if (IO.saveOutcome(app, r, base + '.png')) this.showImage(blob);
                } catch (e) {
                  this.toast(e.message, 'error');
                }
              }
            },
          },
        ],
      });
      refresh();
    }
    showImage(blob) {
      const url = URL.createObjectURL(blob);
      this.modal({ title: 'Your PNG', wide: true, body: h('div', h('p.muted', 'Downloads are blocked here. Right-click (or long-press) the image to save it.'), h('img.exp-png', { src: url, alt: 'Exported drawing' })), onClose: () => URL.revokeObjectURL(url) });
    }

    showTrace() {
      const app = this.app;
      const imgObj = app.selected().find((o) => o.type === 'image');
      if (!imgObj) {
        this.toast('Select an image first (File › Import)');
        return;
      }
      const st = { mode: 'colors', threshold: 128, colors: 4, smooth: 1, detail: 0.8, ignoreBg: true, invert: false };
      const preview = h('div.exp-preview.trace-preview');
      const info = h('p.muted.small');
      let result = null;
      const img = new Image();
      const run = V3D.U.debounce(() => {
        try {
          result = V3D.Trace.bitmap(img, { mode: st.mode, threshold: st.threshold, colors: st.colors, smooth: st.smooth, error: 1.6 - st.detail * 1.4, ignoreBg: st.ignoreBg, invert: st.invert });
          const w = result.width;
          const hh = result.height;
          let body = '';
          let n = 0;
          for (const l of result.layers) {
            body += `<path d="${V3D.Path.toD(l.subs, 1)}" fill="${l.color}" fill-rule="nonzero"/>`;
            n += V3D.Path.nodeCount(l.subs);
          }
          preview.innerHTML = `<svg viewBox="0 0 ${w} ${hh}" preserveAspectRatio="xMidYMid meet">${body}</svg>`;
          info.textContent = `${result.layers.length} layer${result.layers.length === 1 ? '' : 's'} · ${n} nodes`;
        } catch (e) {
          console.error(e);
          info.textContent = 'Tracing failed on this image.';
        }
      }, 120);
      img.onload = run;
      img.src = imgObj.href;
      const ctl = [];
      const modeSeg = W.row(
        'Mode',
        W.segmented({
          options: [
            { value: 'mono', label: 'Black & white' },
            { value: 'colors', label: 'Colors' },
          ],
          get: () => st.mode,
          set: (v) => {
            st.mode = v;
            thr.hidden = v !== 'mono';
            cols.hidden = v !== 'colors';
            run();
          },
        })
      );
      const thr = W.slider({ label: 'Threshold', min: 1, max: 254, step: 1, get: () => st.threshold, set: (v) => ((st.threshold = v), run()) });
      const cols = h(
        'div',
        W.slider({ label: 'Colors', min: 2, max: 10, step: 1, get: () => st.colors, set: (v) => ((st.colors = v), run()) }),
        W.toggle({ label: 'Skip background color', get: () => st.ignoreBg, set: (v) => ((st.ignoreBg = v), run()) })
      );
      thr.hidden = st.mode !== 'mono';
      cols.hidden = st.mode !== 'colors';
      ctl.push(
        modeSeg,
        thr,
        cols,
        W.slider({ label: 'Smoothing', min: 0, max: 4, step: 1, get: () => st.smooth, set: (v) => ((st.smooth = v), run()) }),
        W.slider({ label: 'Detail', min: 0, max: 100, step: 1, unit: '%', get: () => Math.round(st.detail * 100), set: (v) => ((st.detail = v / 100), run()) }),
        info
      );
      this.modal({
        title: 'Trace bitmap',
        wide: true,
        body: h('div.export', preview, h('div.exp-opts', ctl)),
        actions: [
          { label: 'Cancel' },
          {
            label: 'Create vector shapes',
            primary: true,
            onClick: () => {
              if (!result || !result.layers.length) return false;
              const W0 = V3D.M2.mul(app.parentMatrix(imgObj.id), imgObj.transform);
              const sx = imgObj.w / result.width;
              const sy = imgObj.h / result.height;
              const M = V3D.M2.mul(W0, [sx, 0, 0, sy, imgObj.x, imgObj.y]);
              const kids = result.layers.map((l, i) => Doc.make('path', { subs: V3D.Path.transform(l.subs, M), name: 'Layer ' + (i + 1) }, { fill: l.color, stroke: null }));
              const g = Doc.make('group', { children: kids, name: 'Traced ' + (imgObj.name || 'image') });
              const list = app.listOf(imgObj.id);
              list.splice(list.indexOf(imgObj) + 1, 0, g);
              imgObj.visible = false;
              app.touch(imgObj);
              app.reindex();
              app.touch(g);
              app.setSelection([g.id]);
              app.requestRender();
              app.commit('Trace bitmap');
              this.toast('Traced! The original image is hidden in Layers. Ungroup to make parts 3D.');
            },
          },
        ],
      });
    }

    /* ---------------- context menu ---------------- */
    showContextMenu(e) {
      const app = this.app;
      const id = app.canvas.idFromTarget(e.target, false) || app.canvas.hitAt(e.clientX, e.clientY, false);
      if (id && !app.sel.includes(id)) app.setSelection([id]);
      const has = app.sel.length > 0;
      const shapes = app.fxTargets().length > 0;
      const has3D = app.fxTargets(true).length > 0;
      const items = has
        ? [
            shapes && !has3D ? { label: 'Extrude', icon: 'extrude', action: () => app.apply3D('extrude') } : null,
            shapes && !has3D ? { label: 'Revolve', icon: 'revolve', action: () => app.apply3D('revolve') } : null,
            shapes && !has3D ? { label: 'Inflate', icon: 'inflate', action: () => app.apply3D('inflate') } : null,
            has3D ? { label: 'Rotate in 3D (Orbit tool)', icon: 'orbit', action: () => app.setTool('orbit') } : null,
            has3D ? { label: 'Expand to paths', icon: 'expand', action: () => app.expand3D() } : null,
            has3D ? { label: 'Remove 3D', icon: 'close', action: () => app.remove3D() } : null,
            { sep: true },
            { label: 'Cut', action: () => app.cut() },
            { label: 'Copy', icon: 'copy', action: () => app.copy() },
            { label: 'Duplicate', action: () => app.duplicateSelection() },
            { label: 'Delete', icon: 'trash', action: () => app.deleteSelection() },
            { sep: true },
            { label: 'Group', icon: 'group', action: () => app.group() },
            app.selected().some((o) => o.type === 'group') ? { label: 'Ungroup', icon: 'ungroup', action: () => app.ungroup() } : null,
            { label: 'Bring to front', icon: 'front', action: () => app.arrange('top') },
            { label: 'Send to back', icon: 'back', action: () => app.arrange('bottom') },
            shapes ? { label: 'Object to path', icon: 'toPath', action: () => app.convertToPath() } : null,
            { label: 'Lock', icon: 'lock', action: () => app.toggleLock() },
          ]
        : [
            { label: 'Paste', enabled: !!app.clipboard, action: () => app.paste(false) },
            { label: 'Select all', action: () => app.selectAll() },
            { label: 'Insert shape…', icon: 'shapes', action: () => this.showLibrary() },
            { sep: true },
            { label: 'Fit page', icon: 'fit', action: () => app.canvas.fitPage() },
          ];
      this.closeContextMenu();
      const m = h('div.menu.ctx-menu', { role: 'menu' });
      for (const it of items) {
        if (!it) continue;
        if (it.sep) {
          if (m.lastChild && !m.lastChild.classList.contains('menu-sep')) m.append(h('div.menu-sep'));
          continue;
        }
        const b = h('button.menu-item', { type: 'button', role: 'menuitem', disabled: it.enabled === false }, h('span.mi-ico', { html: it.icon ? V3D.icon(it.icon) : '' }), h('span.mi-label', it.label));
        b.addEventListener('click', () => {
          this.closeContextMenu();
          it.action();
        });
        m.append(b);
      }
      document.body.append(m);
      m.style.left = Math.min(e.clientX, innerWidth - m.offsetWidth - 6) + 'px';
      m.style.top = Math.min(e.clientY, innerHeight - m.offsetHeight - 6) + 'px';
      this.ctxMenu = m;
    }
    closeContextMenu() {
      if (this.ctxMenu) this.ctxMenu.remove();
      this.ctxMenu = null;
    }

    /* ---------------- inline text editor ---------------- */
    textEditorOpen() {
      return !!this.textEd;
    }
    openTextEditor(o, isNew) {
      const app = this.app;
      this.closeTextEditor();
      const ta = h('textarea.te-input', { rows: 2, spellcheck: false, 'aria-label': 'Type your text', placeholder: 'Type here…' });
      ta.value = o.text;
      const done = W.button({ label: 'Done', primary: true, cls: 'small', onClick: () => this.closeTextEditor() });
      const box = h('div.text-editor', h('div.te-head', h('span', 'Text'), h('span.muted.small', 'Enter for a new line · Esc when done')), ta, h('div.te-foot', done));
      this.canvasHost.append(box);
      const place = () => {
        const b = app.bboxOf(o);
        const r = this.canvasHost.getBoundingClientRect();
        let x;
        let y;
        if (b) {
          const [sx, sy] = app.canvas.toScreen(b.x, b.y2);
          const [, top] = app.canvas.toScreen(b.x, b.y);
          x = sx;
          y = sy + 32;
          // Keep the text itself visible: go above it when there is no room below.
          if (y + box.offsetHeight > r.height - 8) y = top - box.offsetHeight - 12;
        } else {
          const [sx, sy] = app.canvas.toScreen(o.x, o.y);
          x = sx;
          y = sy + 12;
        }
        x = Math.max(28, Math.min(x, r.width - box.offsetWidth - 8));
        y = Math.max(28, Math.min(y, r.height - box.offsetHeight - 8));
        box.style.left = x + 'px';
        box.style.top = y + 'px';
      };
      ta.addEventListener('input', () => {
        o.text = ta.value;
        app.touch(o);
        app.requestRender();
        requestAnimationFrame(place);
      });
      ta.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          this.closeTextEditor();
        }
        e.stopPropagation();
      });
      this.textEd = { box, o, isNew, place };
      place();
      this.loadFont(o.family);
      setTimeout(() => {
        ta.focus();
        ta.select();
      }, 20);
      this.textViewOff = app.bus.on('view', place);
    }
    closeTextEditor() {
      const te = this.textEd;
      if (!te) return;
      this.textEd = null;
      te.box.remove();
      this.textViewOff && this.textViewOff();
      const app = this.app;
      if (!te.o.text.trim()) {
        app.removeObjects([te.o.id], { commit: !te.isNew, label: 'Delete text' });
        return;
      }
      app.commit(te.isNew ? 'Add text' : 'Edit text');
    }

    handleKey(e) {
      if (e.key === 'Escape' && this.openMenuEl) {
        this.closeMenu();
        return true;
      }
      if (e.key === 'Escape' && this.ctxMenu) {
        this.closeContextMenu();
        return true;
      }
      return false;
    }

    /* ---------------- fonts ---------------- */
    loadFont(family) {
      const f = V3D.Presets.fonts.find((x) => x.family === family);
      if (!f || !f.web) return;
      this.loadedFonts = this.loadedFonts || new Set();
      if (this.loadedFonts.has(family)) return;
      this.loadedFonts.add(family);
      const href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}:wght@${f.weight}&display=block`;
      const link = h('link', { rel: 'stylesheet', href });
      link.addEventListener('load', () => {
        if (document.fonts && document.fonts.load)
          document.fonts.load(`${f.weight} 72px "${family}"`).then(() => {
            V3D.Trace.clearTextCache();
            Doc.walk(this.app.doc.objects, (o) => {
              if (o.type === 'text' && o.family === family) {
                Doc.cache.delete(o.id);
                this.app.touch(o);
              }
            });
            this.app.requestRender();
          }).catch(() => {
            /* Offline or blocked: the text keeps using a fallback font. */
          });
      });
      link.addEventListener('error', () => this.loadedFonts.delete(family));
      document.head.append(link);
    }
    loadDocFonts() {
      Doc.walk(this.app.doc.objects, (o) => {
        if (o.type === 'text') this.loadFont(o.family);
      });
      this.loadFont(this.app.toolOpts.text.family);
    }
  }

  /** Vector 3Dit mark: a three-tone cube whose corners carry vector node handles. */
  function logoMark(size = 26) {
    const node = (x, y) => `<rect x="${x - 2.2}" y="${y - 2.2}" width="4.4" height="4.4" rx=".8" fill="var(--logo-node)" stroke="var(--logo-edge)" stroke-width="1.2"/>`;
    return `<svg viewBox="0 0 32 32" width="${size}" height="${size}" aria-hidden="true"><path d="M16 4 27 10.3 16 16.6 5 10.3z" fill="var(--logo-top)"/><path d="M5 10.3 16 16.6V29L5 22.7z" fill="var(--logo-left)"/><path d="M27 10.3 16 16.6V29l11-6.3z" fill="var(--logo-right)"/><path d="M16 4 27 10.3v12.4L16 29 5 22.7V10.3zM5 10.3 16 16.6 27 10.3M16 16.6V29" fill="none" stroke="var(--logo-edge)" stroke-width="1.2" stroke-linejoin="round"/>${node(16, 4)}${node(5, 22.7)}${node(27, 22.7)}</svg>`;
  }

  V3D.UI = UI;
})();
