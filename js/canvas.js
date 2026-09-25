/* Vector 3Dit — canvas: viewport, artboard, grid, rulers, document layer and pointer routing. */
(function () {
  'use strict';
  const V3D = globalThis.V3D;
  const { fmt, clamp } = V3D.U;
  const NS = 'http://www.w3.org/2000/svg';

  V3D.Canvas = class {
    constructor(app, host) {
      this.app = app;
      this.host = host;
      this.zoom = 1;
      this.x = 0;
      this.y = 0;
      this.pointers = new Map();
      this.spaceDown = false;
      host.innerHTML = `
        <canvas class="ruler ruler-h" aria-hidden="true"></canvas>
        <canvas class="ruler ruler-v" aria-hidden="true"></canvas>
        <div class="ruler-corner" aria-hidden="true"></div>
        <div class="stage" tabindex="-1">
          <svg class="doc-svg" xmlns="${NS}">
            <defs>
              <pattern id="v3d-checker" width="16" height="16" patternUnits="userSpaceOnUse">
                <rect width="16" height="16" fill="#fff"/><rect width="8" height="8" fill="#e4e4e4"/><rect x="8" y="8" width="8" height="8" fill="#e4e4e4"/>
              </pattern>
              <filter id="v3d-page-shadow" x="-10%" y="-10%" width="120%" height="120%">
                <feDropShadow dx="0" dy="2" stdDeviation="6" flood-color="#000" flood-opacity=".28"/>
              </filter>
            </defs>
            <g class="viewport">
              <rect class="page-shadow" filter="url(#v3d-page-shadow)"/>
              <rect class="page"/>
              <g class="grid-layer"></g>
              <g class="doc-layer"></g>
              <rect class="page-outline" fill="none"/>
            </g>
          </svg>
          <svg class="overlay-svg" xmlns="${NS}"></svg>
        </div>`;
      this.stage = host.querySelector('.stage');
      this.svg = host.querySelector('.doc-svg');
      this.viewport = host.querySelector('.viewport');
      this.page = host.querySelector('.page');
      this.pageShadow = host.querySelector('.page-shadow');
      this.pageOutline = host.querySelector('.page-outline');
      this.gridLayer = host.querySelector('.grid-layer');
      this.docLayer = host.querySelector('.doc-layer');
      this.overlay = host.querySelector('.overlay-svg');
      this.rulerH = host.querySelector('.ruler-h');
      this.rulerV = host.querySelector('.ruler-v');
      this.bind();
      new ResizeObserver(() => this.resized()).observe(this.stage);
      const mq = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
      if (mq && mq.addEventListener) mq.addEventListener('change', () => this.themeChanged());
      new MutationObserver(() => this.themeChanged()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    }

    /* ---------- coordinates ---------- */
    rect() {
      return this.stage.getBoundingClientRect();
    }
    toDoc(clientX, clientY) {
      const r = this.rect();
      return [(clientX - r.left - this.x) / this.zoom, (clientY - r.top - this.y) / this.zoom];
    }
    toScreen(x, y) {
      return [x * this.zoom + this.x, y * this.zoom + this.y];
    }
    size() {
      const r = this.rect();
      return [r.width, r.height];
    }
    setView(zoom, x, y) {
      this.zoom = clamp(zoom, 0.02, 64);
      this.x = x;
      this.y = y;
      this.applyView();
    }
    zoomAt(factor, sx, sy) {
      const z = clamp(this.zoom * factor, 0.02, 64);
      const k = z / this.zoom;
      this.setView(z, sx - (sx - this.x) * k, sy - (sy - this.y) * k);
    }
    zoomCenter(factor) {
      const [w, h] = this.size();
      this.zoomAt(factor, w / 2, h / 2);
    }
    fit(rect, pad = 40) {
      if (!V3D.Rect.valid(rect)) return;
      const [w, h] = this.size();
      const rw = Math.max(1, V3D.Rect.w(rect));
      const rh = Math.max(1, V3D.Rect.h(rect));
      const z = clamp(Math.min((w - pad * 2) / rw, (h - pad * 2) / rh), 0.02, 16);
      this.setView(z, w / 2 - V3D.Rect.cx(rect) * z, h / 2 - V3D.Rect.cy(rect) * z);
    }
    fitPage() {
      const d = this.app.doc;
      this.fit({ x: 0, y: 0, x2: d.width, y2: d.height });
    }
    applyView() {
      this.viewport.setAttribute('transform', `translate(${fmt(this.x, 2)} ${fmt(this.y, 2)}) scale(${fmt(this.zoom, 5)})`);
      this.renderGrid();
      this.renderRulers();
      this.app.bus.emit('view');
      this.app.requestOverlay();
    }
    resized() {
      const r = this.rect();
      for (const [c, w, h] of [
        [this.rulerH, r.width, 20],
        [this.rulerV, 20, r.height],
      ]) {
        const dpr = window.devicePixelRatio || 1;
        c.width = Math.max(1, w * dpr);
        c.height = Math.max(1, h * dpr);
        c.style.width = w + 'px';
        c.style.height = h + 'px';
      }
      if (!this._fitted && r.width > 0) {
        this._fitted = true;
        this.fitPage();
      } else this.applyView();
    }

    themeChanged() {
      this._rulerColors = null;
      this.renderRulers();
      this.app.bus.emit('theme');
    }

    /* ---------- page, grid, rulers ---------- */
    renderPage() {
      const d = this.app.doc;
      for (const el of [this.page, this.pageShadow, this.pageOutline]) {
        el.setAttribute('width', d.width);
        el.setAttribute('height', d.height);
      }
      this.page.setAttribute('fill', d.background ? V3D.Color.normalize(d.background) : 'url(#v3d-checker)');
      this.pageShadow.setAttribute('fill', '#fff');
    }

    renderGrid() {
      const p = this.app.prefs;
      const d = this.app.doc;
      const s = p.gridSize || 20;
      if (p.grid === 'none' || s * this.zoom < 5) {
        this.gridLayer.innerHTML = '';
        return;
      }
      const sw = fmt(1 / this.zoom, 4);
      const col = 'var(--grid-line)';
      let pat;
      if (p.grid === 'iso') {
        const W = s * Math.sqrt(3);
        const H = s;
        pat = `<pattern id="v3d-grid" width="${fmt(W, 4)}" height="${fmt(H, 4)}" patternUnits="userSpaceOnUse">
          <path d="M0 ${fmt(H, 4)}L${fmt(W, 4)} 0M0 0L${fmt(W, 4)} ${fmt(H, 4)}M0 0V${fmt(H, 4)}M${fmt(W / 2, 4)} 0V${fmt(H, 4)}" stroke="${col}" stroke-width="${sw}" fill="none"/></pattern>`;
      } else {
        pat = `<pattern id="v3d-grid" width="${s}" height="${s}" patternUnits="userSpaceOnUse">
          <path d="M${s} 0H0V${s}" stroke="${col}" stroke-width="${sw}" fill="none"/></pattern>`;
      }
      this.gridLayer.innerHTML = `<defs>${pat}</defs><rect width="${d.width}" height="${d.height}" fill="url(#v3d-grid)" pointer-events="none"/>`;
    }

    renderRulers() {
      if (!this.app.prefs.rulers) return;
      const dpr = window.devicePixelRatio || 1;
      // Reading computed styles forces a style pass over the whole drawing, so cache the colors.
      if (!this._rulerColors) {
        const css = getComputedStyle(this.host);
        this._rulerColors = [css.getPropertyValue('--ruler-bg').trim() || '#1b1d24', css.getPropertyValue('--ruler-fg').trim() || '#8a90a0'];
      }
      const [bg, fg] = this._rulerColors;
      const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000];
      const step = steps.find((v) => v * this.zoom >= 60) || 5000;
      const minor = step / (String(step)[0] === '2' ? 4 : 5);
      const draw = (c, horizontal) => {
        const ctx = c.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const len = horizontal ? c.width / dpr : c.height / dpr;
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, horizontal ? len : 20, horizontal ? 20 : len);
        ctx.strokeStyle = fg;
        ctx.fillStyle = fg;
        ctx.lineWidth = 1;
        ctx.font = '9px "IBM Plex Mono", ui-monospace, monospace';
        const off = horizontal ? this.x : this.y;
        const start = Math.floor(-off / this.zoom / minor) * minor;
        const end = (len - off) / this.zoom;
        ctx.beginPath();
        for (let v = start; v <= end; v += minor) {
          const px = Math.round(v * this.zoom + off) + 0.5;
          const major = Math.abs(v / step - Math.round(v / step)) < 1e-6;
          const tl = major ? 20 : 5;
          if (horizontal) {
            ctx.moveTo(px, 20);
            ctx.lineTo(px, 20 - tl);
          } else {
            ctx.moveTo(20, px);
            ctx.lineTo(20 - tl, px);
          }
          if (major) {
            const label = String(Math.round(v));
            if (horizontal) ctx.fillText(label, px + 3, 9);
            else {
              ctx.save();
              ctx.translate(9, px + 3);
              ctx.rotate(-Math.PI / 2);
              ctx.fillText(label, 0, 0);
              ctx.restore();
            }
          }
        }
        ctx.stroke();
        // Selection extent marker.
        const sb = this.app.selectionBBox();
        if (sb) {
          ctx.fillStyle = 'rgba(242,165,65,.35)';
          const a = (horizontal ? sb.x : sb.y) * this.zoom + off;
          const b = (horizontal ? sb.x2 : sb.y2) * this.zoom + off;
          if (horizontal) ctx.fillRect(a, 16, b - a, 4);
          else ctx.fillRect(16, a, 4, b - a);
        }
      };
      draw(this.rulerH, true);
      draw(this.rulerV, false);
    }

    /* ---------- document layer ---------- */
    renderDoc(ctx) {
      const layer = this.docLayer;
      const existing = new Map();
      for (const el of Array.from(layer.children)) existing.set(el.getAttribute('data-id'), el);
      let prev = null;
      let stats = { faces: 0, ms: 0 };
      for (const o of this.app.doc.objects) {
        let el = existing.get(o.id);
        if (el) existing.delete(o.id);
        else {
          el = document.createElementNS(NS, 'g');
          el.setAttribute('data-id', o.id);
        }
        let r;
        try {
          r = V3D.Doc.renderObject(o, ctx);
        } catch (err) {
          console.error('[V3D] render failed for', o.id, err);
          r = { markup: '' };
        }
        if (r.faces) {
          stats.faces += r.faces;
          stats.ms += r.ms || 0;
        }
        if (el._markup !== r.markup) {
          el.innerHTML = r.markup;
          el._markup = r.markup;
        }
        el.style.display = o.visible === false ? 'none' : '';
        el.classList.toggle('locked', !!o.locked);
        if (el.getAttribute('transform')) el.removeAttribute('transform');
        const next = prev ? prev.nextSibling : layer.firstChild;
        if (next !== el) layer.insertBefore(el, next);
        prev = el;
      }
      for (const el of existing.values()) el.remove();
      return stats;
    }

    /** Fast visual translation of top-level objects during a drag. */
    previewTranslate(ids, dx, dy) {
      for (const id of ids) {
        const el = this.docLayer.querySelector(`:scope > g[data-id="${id}"]`);
        if (el) el.setAttribute('transform', `translate(${fmt(dx, 3)} ${fmt(dy, 3)})`);
      }
    }

    setOverlay(markup) {
      if (this._ov !== markup) {
        this.overlay.innerHTML = markup;
        this._ov = markup;
      }
    }

    /* ---------- hit testing ---------- */
    /** Object id under a DOM target; top-level unless deep. */
    idFromTarget(target, deep) {
      if (!target || !target.closest) return null;
      let g = target.closest('g[data-id]');
      if (!g || !this.docLayer.contains(g)) return null;
      if (g.classList.contains('locked')) return null;
      if (!deep) {
        while (g.parentNode && g.parentNode !== this.docLayer) {
          const up = g.parentNode.closest('g[data-id]');
          if (!up) break;
          g = up;
        }
      }
      return g.getAttribute('data-id');
    }
    hitAt(clientX, clientY, deep) {
      const els = document.elementsFromPoint(clientX, clientY);
      for (const el of els) {
        if (el === this.stage || el === this.svg) break;
        const id = this.idFromTarget(el, deep);
        if (id) return id;
      }
      return null;
    }

    /* ---------- events ---------- */
    mk(e) {
      const [x, y] = this.toDoc(e.clientX, e.clientY);
      const r = this.rect();
      return {
        x,
        y,
        sx: e.clientX - r.left,
        sy: e.clientY - r.top,
        cx: e.clientX,
        cy: e.clientY,
        shift: e.shiftKey,
        alt: e.altKey,
        mod: V3D.U.modKey(e),
        button: e.button,
        buttons: e.buttons,
        target: e.target,
        e,
      };
    }

    bind() {
      const st = this.stage;
      const app = this.app;
      st.addEventListener('pointerdown', (e) => {
        st.focus({ preventScroll: true });
        this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (this.pointers.size === 2) {
          // Two-finger pinch: cancel any tool drag.
          app.tool && app.tool.cancel && app.tool.cancel();
          this.pinch = this.pinchState();
          this.panning = null;
          return;
        }
        if (this.pointers.size > 2) return;
        if (e.button === 2) return;
        try {
          st.setPointerCapture(e.pointerId);
        } catch (err) {
          /* capture unsupported */
        }
        if (e.button === 1 || (e.button === 0 && (this.spaceDown || app.toolId === 'hand'))) {
          e.preventDefault();
          this.panning = { sx: e.clientX, sy: e.clientY, x: this.x, y: this.y };
          st.classList.add('panning');
          return;
        }
        if (e.button === 2) return;
        app.tool && app.tool.down && app.tool.down(this.mk(e));
      });
      st.addEventListener('pointermove', (e) => {
        if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (this.pinch && this.pointers.size === 2) {
          const now = this.pinchState();
          const r = this.rect();
          const k = now.d / this.pinch.d;
          this.zoomAt(k, now.cx - r.left, now.cy - r.top);
          this.setView(this.zoom, this.x + now.cx - this.pinch.cx, this.y + now.cy - this.pinch.cy);
          this.pinch = now;
          return;
        }
        if (this.panning) {
          this.setView(this.zoom, this.panning.x + e.clientX - this.panning.sx, this.panning.y + e.clientY - this.panning.sy);
          return;
        }
        const ev = this.mk(e);
        app.pointer = ev;
        app.tool && app.tool.move && app.tool.move(ev);
        app.bus.emit('pointer', ev);
      });
      const end = (e) => {
        this.pointers.delete(e.pointerId);
        if (this.pinch) {
          if (this.pointers.size < 2) this.pinch = null;
          return;
        }
        if (this.panning) {
          this.panning = null;
          st.classList.remove('panning');
          return;
        }
        app.tool && app.tool.up && app.tool.up(this.mk(e));
      };
      st.addEventListener('pointerup', end);
      st.addEventListener('pointercancel', (e) => {
        this.pointers.delete(e.pointerId);
        this.pinch = null;
        this.panning = null;
        app.tool && app.tool.cancel && app.tool.cancel();
      });
      st.addEventListener('pointerleave', () => app.bus.emit('pointer', null));
      st.addEventListener('dblclick', (e) => app.tool && app.tool.dblclick && app.tool.dblclick(this.mk(e)));
      st.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        app.ui && app.ui.showContextMenu(e);
      });
      st.addEventListener(
        'wheel',
        (e) => {
          e.preventDefault();
          const r = this.rect();
          let dy = e.deltaY;
          let dx = e.deltaX;
          if (e.deltaMode === 1) {
            dy *= 16;
            dx *= 16;
          }
          if (e.ctrlKey || e.metaKey) {
            this.zoomAt(Math.exp(-dy * 0.0022), e.clientX - r.left, e.clientY - r.top);
          } else if (e.shiftKey && !dx) {
            this.setView(this.zoom, this.x - dy, this.y);
          } else {
            this.setView(this.zoom, this.x - dx, this.y - dy);
          }
        },
        { passive: false }
      );
      // Drop files onto the canvas.
      st.addEventListener('dragover', (e) => {
        e.preventDefault();
        st.classList.add('dropping');
      });
      st.addEventListener('dragleave', () => st.classList.remove('dropping'));
      st.addEventListener('drop', (e) => {
        e.preventDefault();
        st.classList.remove('dropping');
        const files = Array.from(e.dataTransfer.files || []);
        if (files.length) V3D.IO.importFiles(app, files, this.toDoc(e.clientX, e.clientY));
      });
    }

    pinchState() {
      const [a, b] = Array.from(this.pointers.values());
      return { d: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
    }
  };
})();
