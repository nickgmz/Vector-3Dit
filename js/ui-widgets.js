/* Vector 3Dit — UI widgets. Every bound control exposes sync() to refresh from its getter. */
(function () {
  'use strict';
  const V3D = globalThis.V3D;
  const { h, clamp, fmt } = V3D.U;
  const { Color, M3, V3 } = V3D;
  const W = (V3D.W = {});
  let uidN = 0;
  let themeCache = null;
  /** Theme token values, cached: computed-style reads force a style pass over the whole drawing. */
  W.theme = () => {
    if (!themeCache) {
      const css = getComputedStyle(document.documentElement);
      const g = (k, d) => css.getPropertyValue(k).trim() || d;
      themeCache = {
        accent: g('--accent', '#f2a541'),
        side: g('--tb-side', '#8b90a0'),
        top: g('--tb-top', '#b9bdc8'),
        edge: g('--tb-edge', '#1b1c22'),
        sphere: g('--sphere', '#c9ccd4'),
      };
    }
    return themeCache;
  };
  W.themeChanged = () => {
    themeCache = null;
  };
  const wid = (p) => `w-${p}-${++uidN}`;

  W.button = ({ icon, label, title, onClick, cls, primary, disabled }) => {
    const b = h('button.btn' + (primary ? '.primary' : '') + (cls ? '.' + cls.split(' ').join('.') : ''), {
      type: 'button',
      title: title || null,
      'aria-label': !label ? title : null,
      disabled: !!disabled,
      onclick: onClick,
    });
    if (icon) b.appendChild(V3D.iconEl(icon));
    if (label) b.appendChild(h('span', label));
    return b;
  };
  W.iconButton = (icon, title, onClick, cls) => W.button({ icon, title, onClick, cls: 'icon ' + (cls || '') });

  /** Collapsible panel section; remembers open state per id. */
  W.section = (id, title, kids, opts = {}) => {
    const key = 'vector3dit.sec.' + id;
    let open = V3D.U.storage.get(key, opts.open !== false);
    const body = h('div.sec-body', kids);
    const head = h('button.sec-head', { type: 'button', 'aria-expanded': String(open) }, V3D.iconEl('chevRight', 'chev'), h('span', title), opts.badge ? h('span.sec-badge', opts.badge) : null);
    const sec = h('section.sec' + (open ? '.open' : ''), { 'data-sec': id }, head, body);
    head.addEventListener('click', () => {
      open = !open;
      sec.classList.toggle('open', open);
      head.setAttribute('aria-expanded', String(open));
      V3D.U.storage.set(key, open);
    });
    return sec;
  };

  W.row = (label, ...controls) => h('div.row', label ? h('span.row-label', label) : null, h('div.row-ctl', controls));

  W.slider = (o) => {
    const id = wid('s');
    const range = h('input.range', { type: 'range', id, min: o.min, max: o.max, step: o.step || 1 });
    const num = h('input.num', { type: 'number', min: o.min, max: o.max, step: o.step || 1, 'aria-label': o.label + (o.unit ? ` (${o.unit})` : '') });
    const lab = h('label.s-label', { for: id, title: o.title || (o.def != null ? 'Double-click to reset' : null) }, o.label);
    const el = h('div.w-slider' + (o.axis ? '.axis-' + o.axis : ''), lab, range, h('div.num-wrap', num, o.unit ? h('span.unit', o.unit) : null));
    const soft = (v) => clamp(v, o.hardMin == null ? -Infinity : o.hardMin, o.hardMax == null ? Infinity : o.hardMax);
    const fill = () => {
      const p = ((+range.value - o.min) / (o.max - o.min)) * 100;
      range.style.setProperty('--p', clamp(p, 0, 100) + '%');
    };
    range.addEventListener('input', () => {
      num.value = fmtNum(+range.value, o.step);
      fill();
      o.set(+range.value, false);
    });
    range.addEventListener('change', () => o.set(+range.value, true));
    num.addEventListener('change', () => {
      const v = soft(parseFloat(num.value));
      if (!isFinite(v)) return el.sync();
      range.value = v;
      fill();
      o.set(v, true);
    });
    lab.addEventListener('dblclick', () => {
      if (o.def == null) return;
      o.set(o.def, true);
      el.sync();
    });
    el.sync = () => {
      const v = o.get();
      if (v == null || !isFinite(v)) return;
      if (document.activeElement !== num) num.value = fmtNum(v, o.step);
      range.value = v;
      fill();
    };
    el.sync();
    return el;
  };
  const fmtNum = (v, step) => {
    const d = step && step < 1 ? Math.min(3, Math.ceil(-Math.log10(step))) : 0;
    return String(fmt(v, d));
  };

  W.segmented = (o) => {
    const el = h('div.seg' + (o.cls ? '.' + o.cls : ''), { role: 'radiogroup', 'aria-label': o.label || null });
    const btns = o.options.map((opt) => {
      const b = h('button.seg-btn', { type: 'button', role: 'radio', title: opt.title || opt.label || null, 'data-v': String(opt.value) });
      if (opt.icon) b.appendChild(V3D.iconEl(opt.icon));
      if (opt.label && !o.iconsOnly) b.appendChild(h('span', opt.label));
      b.addEventListener('click', () => {
        o.set(opt.value, true);
        el.sync();
      });
      el.appendChild(b);
      return [b, opt];
    });
    el.sync = () => {
      const v = o.get();
      for (const [b, opt] of btns) {
        const on = opt.value === v;
        b.classList.toggle('on', on);
        b.setAttribute('aria-checked', String(on));
      }
    };
    el.sync();
    return el;
  };

  W.toggle = (o) => {
    const id = wid('t');
    const input = h('input', { type: 'checkbox', id, role: 'switch' });
    const el = h('label.toggle', { for: id, title: o.title || null }, input, h('span.track', h('span.knob')), h('span.t-label', o.label));
    input.addEventListener('change', () => o.set(input.checked, true));
    el.sync = () => {
      input.checked = !!o.get();
    };
    el.sync();
    return el;
  };

  W.select = (o) => {
    const id = wid('sel');
    const sel = h('select.select', { id, 'aria-label': o.label || null });
    for (const opt of o.options) {
      const op = h('option', { value: String(opt.value) }, opt.label);
      if (opt.style) op.setAttribute('style', opt.style);
      sel.appendChild(op);
    }
    sel.addEventListener('change', () => {
      const opt = o.options.find((x) => String(x.value) === sel.value);
      o.set(opt ? opt.value : sel.value, true);
    });
    const el = o.label && !o.bare ? h('div.w-select', h('label.s-label', { for: id }, o.label), sel) : sel;
    el.sync = () => {
      sel.value = String(o.get());
    };
    el.sync();
    return el;
  };

  W.number = (o) => {
    const id = wid('n');
    const input = h('input.num', { type: 'number', id, step: o.step || 1, min: o.min, max: o.max });
    const el = h('label.w-number', { for: id, title: o.title || null }, h('span', o.label), input, o.unit ? h('span.unit', o.unit) : null);
    input.addEventListener('change', () => {
      const v = parseFloat(input.value);
      if (isFinite(v)) o.set(v, true);
      else el.sync();
    });
    el.sync = () => {
      const v = o.get();
      if (document.activeElement === input) return;
      input.value = v == null || !isFinite(v) ? '' : String(fmt(v, o.digits == null ? 1 : o.digits));
      input.disabled = v == null;
    };
    el.sync();
    return el;
  };

  /* ---------------- popovers ---------------- */
  let openPop = null;
  W.closePopover = () => {
    if (openPop) {
      const p = openPop;
      openPop = null;
      p.remove();
      p._onClose && p._onClose();
    }
  };
  W.popover = (anchor, content, opts = {}) => {
    W.closePopover();
    const pop = h('div.popover' + (opts.cls ? '.' + opts.cls : ''), { role: 'dialog', 'aria-label': opts.label || null }, content);
    document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect();
    const pr = pop.getBoundingClientRect();
    let x = r.left;
    let y = r.bottom + 6;
    if (x + pr.width > innerWidth - 8) x = Math.max(8, innerWidth - pr.width - 8);
    if (y + pr.height > innerHeight - 8) y = Math.max(8, r.top - pr.height - 6);
    pop.style.left = x + 'px';
    pop.style.top = y + 'px';
    pop._onClose = opts.onClose;
    openPop = pop;
    setTimeout(() => {
      const away = (e) => {
        if (!openPop || openPop !== pop) return document.removeEventListener('pointerdown', away, true);
        if (!pop.contains(e.target) && !anchor.contains(e.target)) {
          document.removeEventListener('pointerdown', away, true);
          W.closePopover();
        }
      };
      document.addEventListener('pointerdown', away, true);
    });
    return pop;
  };
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && openPop) {
      W.closePopover();
      e.stopPropagation();
    }
  });

  /* ---------------- color picker ---------------- */
  W.palette = [
    '#1b1c22', '#4a4e5a', '#8a8f9c', '#c9ccd4', '#ffffff',
    '#e8505b', '#f2a541', '#ffd23f', '#52c7a0', '#2fb5c9',
    '#4d7cf0', '#7b61ff', '#c65ad8', '#ff8fab', '#a0522d',
    '#8b1e3f', '#c2410c', '#e2b44a', '#2f9e44', '#0b7285',
    '#1e3a8a', '#3b2a8f', '#6b2d5c', '#f7e1c9', '#d6e8ff',
  ];
  const recent = V3D.U.storage.get('vector3dit.recentColors', []);
  W.remember = (c) => {
    if (!c || typeof c !== 'string') return;
    const i = recent.indexOf(c);
    if (i >= 0) recent.splice(i, 1);
    recent.unshift(c);
    recent.length = Math.min(recent.length, 10);
    V3D.U.storage.set('vector3dit.recentColors', recent);
  };

  /** Opens an HSV color picker. opts: { value, allowNone, label, onInput(hex|null), onChange(hex|null) } */
  W.colorPicker = (anchor, opts) => {
    let c = Color.parse(opts.value) || { r: 242, g: 165, b: 65, a: 1 };
    let hsv = Color.rgbToHsv(c);
    let alpha = c.a == null ? 1 : c.a;
    const sv = h('canvas.cp-sv', { width: 232, height: 140, 'aria-label': 'Saturation and brightness' });
    const svDot = h('div.cp-dot');
    const svWrap = h('div.cp-sv-wrap', sv, svDot);
    const hue = h('input.cp-hue', { type: 'range', min: 0, max: 360, step: 1, 'aria-label': 'Hue' });
    const alp = h('input.cp-alpha', { type: 'range', min: 0, max: 100, step: 1, 'aria-label': 'Opacity' });
    const hex = h('input.cp-hex', { type: 'text', maxlength: 9, spellcheck: false, 'aria-label': 'Hex color' });
    const chip = h('div.cp-chip');
    const out = () => {
      const rgb = Color.hsvToRgb(hsv.h, hsv.s, hsv.v);
      rgb.a = alpha;
      return alpha < 1 ? Color.toHexA(rgb) : Color.toHex(rgb);
    };
    const paint = () => {
      const ctx = sv.getContext('2d');
      const base = Color.toHex(Color.hsvToRgb(hsv.h, 1, 1));
      let g = ctx.createLinearGradient(0, 0, sv.width, 0);
      g.addColorStop(0, '#fff');
      g.addColorStop(1, base);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, sv.width, sv.height);
      g = ctx.createLinearGradient(0, 0, 0, sv.height);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, '#000');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, sv.width, sv.height);
      svDot.style.left = hsv.s * 100 + '%';
      svDot.style.top = (1 - hsv.v) * 100 + '%';
      hue.value = Math.round(hsv.h);
      alp.value = Math.round(alpha * 100);
      const solid = Color.toHex(Color.hsvToRgb(hsv.h, hsv.s, hsv.v));
      alp.style.setProperty('--c', solid);
      chip.style.setProperty('--c', out());
      if (document.activeElement !== hex) hex.value = out();
    };
    const emit = (final) => {
      paint();
      const v = out();
      if (final) {
        W.remember(v);
        opts.onChange && opts.onChange(v);
      } else opts.onInput && opts.onInput(v);
    };
    const svDrag = (e) => {
      const r = sv.getBoundingClientRect();
      hsv.s = clamp((e.clientX - r.left) / r.width, 0, 1);
      hsv.v = clamp(1 - (e.clientY - r.top) / r.height, 0, 1);
      emit(false);
    };
    svWrap.addEventListener('pointerdown', (e) => {
      svWrap.setPointerCapture(e.pointerId);
      svDrag(e);
      const mv = (ev) => svDrag(ev);
      const up = () => {
        svWrap.removeEventListener('pointermove', mv);
        svWrap.removeEventListener('pointerup', up);
        emit(true);
      };
      svWrap.addEventListener('pointermove', mv);
      svWrap.addEventListener('pointerup', up);
    });
    hue.addEventListener('input', () => {
      hsv.h = +hue.value;
      emit(false);
    });
    hue.addEventListener('change', () => emit(true));
    alp.addEventListener('input', () => {
      alpha = +alp.value / 100;
      emit(false);
    });
    alp.addEventListener('change', () => emit(true));
    hex.addEventListener('change', () => {
      const p = Color.parse(hex.value.trim().startsWith('#') || /^[0-9a-f]{3,8}$/i.test(hex.value.trim()) ? (hex.value.trim()[0] === '#' ? hex.value.trim() : '#' + hex.value.trim()) : hex.value);
      if (!p) return paint();
      hsv = Color.rgbToHsv(p);
      alpha = p.a == null ? 1 : p.a;
      emit(true);
    });
    const swatch = (col) =>
      h('button.cp-sw', {
        type: 'button',
        title: col,
        style: { '--c': col },
        onclick: () => {
          const p = Color.parse(col);
          hsv = Color.rgbToHsv(p);
          alpha = 1;
          emit(true);
        },
      });
    const tools = h('div.cp-tools', chip, hex);
    if (globalThis.EyeDropper)
      tools.appendChild(
        W.iconButton('eyedropper', 'Pick a color from the screen', async () => {
          try {
            const r = await new globalThis.EyeDropper().open();
            const p = Color.parse(r.sRGBHex);
            hsv = Color.rgbToHsv(p);
            emit(true);
          } catch (e) {
            /* cancelled */
          }
        })
      );
    if (opts.allowNone)
      tools.appendChild(
        W.button({
          label: 'None',
          cls: 'small',
          title: 'No color',
          onClick: () => {
            opts.onChange && opts.onChange(null);
            W.closePopover();
          },
        })
      );
    const content = h(
      'div.cp',
      opts.label ? h('div.cp-title', opts.label) : null,
      svWrap,
      h('div.cp-sliders', hue, h('div.cp-alpha-wrap', alp)),
      tools,
      recent.length ? h('div.cp-row-label', 'Recent') : null,
      recent.length ? h('div.cp-swatches', recent.map(swatch)) : null,
      h('div.cp-row-label', 'Palette'),
      h('div.cp-swatches', W.palette.map(swatch))
    );
    W.popover(anchor, content, { label: opts.label || 'Color', cls: 'cp-pop' });
    paint();
  };

  /** Swatch button bound to a color value (string | null | 'auto'). */
  W.colorButton = (o) => {
    const b = h('button.swatch-btn', { type: 'button', title: o.title || o.label || 'Choose color' });
    const chip = h('span.swatch-chip');
    const txt = h('span.swatch-txt');
    b.append(chip, txt);
    b.addEventListener('click', () => {
      const v = o.get();
      W.colorPicker(b, {
        value: typeof v === 'string' && v !== 'auto' ? v : o.fallback ? o.fallback() : '#888888',
        allowNone: o.allowNone,
        label: o.label,
        onInput: (c) => o.set(c, false),
        onChange: (c) => {
          o.set(c, true);
          b.sync();
        },
      });
    });
    b.sync = () => {
      const v = o.get();
      const none = v == null || v === 'none';
      const auto = v === 'auto';
      const solid = typeof v === 'object' && v ? V3D.R3D.solidOf(v) : v;
      chip.classList.toggle('none', none && !o.autoLabel);
      chip.classList.toggle('auto', (auto || (none && !!o.autoLabel)));
      chip.style.setProperty('--c', none || auto ? 'transparent' : typeof v === 'object' && v ? gradCss(v) : solid);
      txt.textContent = auto || (none && o.autoLabel) ? o.autoLabel || 'Auto' : none ? 'None' : typeof v === 'object' ? 'Gradient' : String(v).toUpperCase();
    };
    b.sync();
    const wrap = o.label && !o.bare ? h('div.w-color', h('span.s-label', o.label), b) : b;
    wrap.sync = b.sync;
    if (o.autoLabel && o.onAuto) {
      const autoBtn = W.button({ label: o.autoLabel, cls: 'small ghost', title: 'Use the automatic color', onClick: () => o.onAuto() });
      wrap.appendChild(autoBtn);
    }
    return wrap;
  };
  const gradCss = (g) => {
    const stops = (g.stops || []).map((s) => `${s.color} ${Math.round(s.offset * 100)}%`).join(',');
    return g.type === 'radial' ? `radial-gradient(${stops})` : `linear-gradient(90deg,${stops})`;
  };
  W.gradCss = gradCss;

  /* ---------------- trackball (3D orientation) ---------------- */
  W.trackball = (o) => {
    const size = 132;
    const svg = h('div.trackball', { tabindex: 0, role: 'slider', 'aria-label': 'Drag to rotate in 3D. Arrow keys rotate by 5°.' });
    let lastKey = '';
    const draw = (force) => {
      const [rx, ry, rz] = o.get();
      const th = W.theme();
      const key = [rx, ry, rz, th.accent, th.side].join(',');
      if (key === lastKey && force !== true) return;
      lastKey = key;
      const acc = th.accent;
      const side = th.side;
      const top = th.top;
      const edge = th.edge;
      const axes = V3D.R3D.axes(rx, ry, rz)
        .sort((a, b) => a.z - b.z)
        .map((a) => {
          const r = size * 0.44;
          const x2 = size / 2 + a.x * r;
          const y2 = size / 2 + a.y * r;
          return `<line x1="${size / 2}" y1="${size / 2}" x2="${fmt(x2, 1)}" y2="${fmt(y2, 1)}" class="tb-axis ax-${a.axis}" opacity="${a.z < 0 ? 0.35 : 1}"/><text x="${fmt(size / 2 + a.x * (r + 7), 1)}" y="${fmt(size / 2 + a.y * (r + 7) + 3, 1)}" class="tb-lbl ax-${a.axis}">${a.axis.toUpperCase()}</text>`;
        });
      svg.innerHTML = `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - 3}" class="tb-ring"/>${axes
        .filter((_, i) => i < 1)
        .join('')}${V3D.R3D.cubeMarkup(rx, ry, rz, size, { front: acc, back: side, side, top, edge })}${axes.filter((_, i) => i >= 1).join('')}</svg>`;
    };
    let drag = null;
    svg.addEventListener('pointerdown', (e) => {
      svg.setPointerCapture(e.pointerId);
      const [rx, ry, rz] = o.get();
      drag = { x: e.clientX, y: e.clientY, R0: M3.fromEuler(rx, ry, rz), moved: false };
      svg.classList.add('dragging');
    });
    svg.addEventListener('pointermove', (e) => {
      if (!drag) return;
      let dx = e.clientX - drag.x;
      let dy = e.clientY - drag.y;
      if (e.shiftKey) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      const Rd = e.altKey ? M3.rotZ(-dx * 0.8) : M3.mul(M3.rotX(dy * 0.8), M3.rotY(dx * 0.8));
      const eu = M3.toEuler(M3.mul(Rd, drag.R0));
      drag.moved = true;
      o.set([eu.rx, eu.ry, eu.rz], false);
      draw();
    });
    const end = () => {
      if (!drag) return;
      const moved = drag.moved;
      drag = null;
      svg.classList.remove('dragging');
      if (moved) o.set(o.get(), true);
    };
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);
    svg.addEventListener('keydown', (e) => {
      const d = { ArrowLeft: [0, -5], ArrowRight: [0, 5], ArrowUp: [-5, 0], ArrowDown: [5, 0] }[e.key];
      if (!d) return;
      e.preventDefault();
      const [rx, ry, rz] = o.get();
      const eu = M3.toEuler(M3.mul(M3.mul(M3.rotX(d[0]), M3.rotY(d[1])), M3.fromEuler(rx, ry, rz)));
      o.set([eu.rx, eu.ry, eu.rz], true);
      draw();
    });
    svg.sync = draw;
    draw();
    return svg;
  };

  /* ---------------- light sphere ---------------- */
  W.lightSphere = (o) => {
    const S = 112;
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    const cv = h('canvas.lsphere', { width: S * dpr, height: S * dpr, style: { width: S + 'px', height: S + 'px' } });
    const el = h('div.lsphere-wrap', { tabindex: 0, role: 'slider', 'aria-label': 'Light direction. Drag the sun, or use arrow keys.' }, cv);
    let lastKey = '';
    const draw = () => {
      const L0 = o.get();
      const key = L0.az + ',' + L0.el + ',' + W.theme().sphere;
      if (key === lastKey) return;
      lastKey = key;
      const L = V3.fromAngles(L0.az, L0.el);
      const ctx = cv.getContext('2d');
      const N = S * dpr;
      const img = ctx.createImageData(N, N);
      const R = N / 2 - 2 * dpr;
      const base = Color.parse(W.theme().sphere);
      const H = V3.norm(V3.add(L, [0, 0, 1]));
      for (let y = 0; y < N; y++)
        for (let x = 0; x < N; x++) {
          const nx = (x - N / 2) / R;
          const ny = -(y - N / 2) / R;
          const d = nx * nx + ny * ny;
          const i = (y * N + x) * 4;
          if (d > 1) {
            img.data[i + 3] = 0;
            continue;
          }
          const nz = Math.sqrt(1 - d);
          const lam = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]);
          const sp = Math.pow(Math.max(0, nx * H[0] + ny * H[1] + nz * H[2]), 40) * 0.8;
          const k = 0.22 + 0.78 * lam;
          img.data[i] = clamp(base.r * k + 255 * sp, 0, 255);
          img.data[i + 1] = clamp(base.g * k + 255 * sp, 0, 255);
          img.data[i + 2] = clamp(base.b * k + 255 * sp, 0, 255);
          img.data[i + 3] = d > 0.985 ? 255 * (1 - (d - 0.985) / 0.015) : 255;
        }
      ctx.putImageData(img, 0, 0);
      // Sun marker.
      let px = N / 2 + L[0] * R;
      let py = N / 2 - L[1] * R;
      const behind = L[2] < 0;
      if (behind) {
        const len = Math.hypot(L[0], L[1]) || 1;
        px = N / 2 + (L[0] / len) * R;
        py = N / 2 - (L[1] / len) * R;
      }
      ctx.beginPath();
      ctx.arc(px, py, 6.5 * dpr, 0, Math.PI * 2);
      ctx.fillStyle = behind ? 'rgba(255,214,102,.45)' : '#ffd666';
      ctx.fill();
      ctx.lineWidth = 1.5 * dpr;
      ctx.strokeStyle = '#3a2a05';
      ctx.stroke();
    };
    const fromEvent = (e, final) => {
      const r = cv.getBoundingClientRect();
      let x = (e.clientX - r.left - r.width / 2) / (r.width / 2 - 2);
      let y = -(e.clientY - r.top - r.height / 2) / (r.height / 2 - 2);
      const d = Math.hypot(x, y);
      let z;
      if (d <= 1) z = Math.sqrt(1 - d * d);
      else {
        x /= d;
        y /= d;
        z = -Math.min(1, (d - 1) * 2);
        const s = Math.sqrt(Math.max(0, 1 - z * z));
        x *= s;
        y *= s;
      }
      const a = V3.toAngles([x, y, z]);
      o.set({ az: Math.round(a.az), el: Math.round(clamp(a.el, -89, 89)) }, final);
      draw();
    };
    let dragging = false;
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      dragging = true;
      fromEvent(e, false);
    });
    el.addEventListener('pointermove', (e) => dragging && fromEvent(e, false));
    el.addEventListener('pointerup', (e) => {
      if (!dragging) return;
      dragging = false;
      fromEvent(e, true);
    });
    el.addEventListener('keydown', (e) => {
      const d = { ArrowLeft: [-5, 0], ArrowRight: [5, 0], ArrowUp: [0, 5], ArrowDown: [0, -5] }[e.key];
      if (!d) return;
      e.preventDefault();
      const L = o.get();
      o.set({ az: L.az + d[0], el: clamp(L.el + d[1], -89, 89) }, true);
      draw();
    });
    el.sync = draw;
    draw();
    return el;
  };

  /* ---------------- bevel profile picker ---------------- */
  W.bevelThumb = (id, size = 36) => {
    if (id === 'none') return `<svg viewBox="0 0 36 36" width="${size}" height="${size}"><path d="M2 7H28V35H2Z" class="bv-fill"/><path d="M2 7H28V35" class="bv-line"/></svg>`;
    const prof = V3D.Mesh.bevels[id].pts(8);
    const pts = prof.map(([o, z]) => [8 + 20 * (1 - o), 7 + 20 * z]);
    const d = 'M2 7H8' + pts.map((p) => 'L' + fmt(p[0], 2) + ' ' + fmt(p[1], 2)).join('') + 'V35';
    return `<svg viewBox="0 0 36 36" width="${size}" height="${size}"><path d="${d}H2Z" class="bv-fill"/><path d="${d}" class="bv-line"/></svg>`;
  };
  W.bevelPicker = (o) => {
    const opts = ['none'].concat(Object.keys(V3D.Mesh.bevels));
    const b = h('button.bevel-btn', { type: 'button', title: 'Bevel profile', 'aria-haspopup': 'true' });
    b.addEventListener('click', () => {
      const grid = h(
        'div.bevel-grid',
        opts.map((id) =>
          h(
            'button.bevel-opt' + (o.get() === id ? '.on' : ''),
            {
              type: 'button',
              title: id === 'none' ? 'No bevel' : V3D.Mesh.bevels[id].name,
              onclick: () => {
                o.set(id, true);
                b.sync();
                W.closePopover();
              },
            },
            h('span', { html: W.bevelThumb(id) }),
            h('span.bv-name', id === 'none' ? 'None' : V3D.Mesh.bevels[id].name)
          )
        )
      );
      W.popover(b, grid, { label: 'Bevel profile' });
    });
    b.sync = () => {
      const v = o.get() || 'none';
      b.innerHTML = W.bevelThumb(v, 28) + `<span>${v === 'none' ? 'No bevel' : V3D.Mesh.bevels[v].name}</span>` + V3D.icon('chevDown', 'small');
    };
    b.sync();
    return b;
  };
})();
