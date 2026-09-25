/* Vector 3Dit — shared helpers.
 * Every module hangs off the global `V3D` namespace so the app runs from
 * plain <script> tags (works from file:// with no build step). */
(function () {
  'use strict';
  const V3D = (globalThis.V3D = globalThis.V3D || {});
  const U = (V3D.U = {});

  U.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  U.lerp = (a, b, t) => a + (b - a) * t;
  U.rad = (d) => (d * Math.PI) / 180;
  U.deg = (r) => (r * 180) / Math.PI;
  U.round = (v, p = 2) => {
    const m = Math.pow(10, p);
    return Math.round(v * m) / m;
  };
  /** Compact number formatting for SVG output: trims zeros, never "-0". */
  U.fmt = (v, p = 2) => {
    const m = Math.pow(10, p);
    let r = Math.round(v * m) / m;
    if (r === 0) r = 0;
    return String(r);
  };
  U.isNum = (v) => typeof v === 'number' && isFinite(v);

  let counter = 0;
  U.uid = (prefix = 'o') =>
    prefix + (Date.now() % 1e8).toString(36) + (++counter).toString(36) + Math.random().toString(36).slice(2, 5);

  U.clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));

  /** JSON without transient (underscore-prefixed) fields. */
  U.stripTransient = (key, value) => (key && key[0] === '_' ? undefined : value);
  U.serialize = (o) => JSON.stringify(o, U.stripTransient);

  U.debounce = (fn, ms) => {
    let t = null;
    const d = (...a) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...a), ms);
    };
    d.cancel = () => clearTimeout(t);
    return d;
  };

  /** Coalesces calls into one per animation frame. */
  U.rafThrottle = (fn) => {
    let queued = false;
    let args = null;
    const raf = globalThis.requestAnimationFrame || ((f) => setTimeout(f, 16));
    return (...a) => {
      args = a;
      if (queued) return;
      queued = true;
      raf(() => {
        queued = false;
        fn(...args);
      });
    };
  };

  U.Emitter = class {
    constructor() {
      this._h = {};
    }
    on(evt, fn) {
      (this._h[evt] = this._h[evt] || []).push(fn);
      return () => this.off(evt, fn);
    }
    off(evt, fn) {
      const l = this._h[evt];
      if (l) this._h[evt] = l.filter((f) => f !== fn);
    }
    emit(evt, ...args) {
      const l = this._h[evt];
      if (!l) return;
      for (const f of l.slice()) {
        try {
          f(...args);
        } catch (err) {
          console.error('[V3D] handler for', evt, 'failed', err);
        }
      }
    }
  };

  /** Escapes text for XML attribute/text content. */
  U.esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /** Fast 2x32-bit hash of a number stream, used for geometry cache keys. */
  U.Hasher = class {
    constructor() {
      this.a = 2166136261 | 0;
      this.b = 5381 | 0;
    }
    num(v, scale = 1000) {
      const n = Math.round(v * scale) | 0;
      this.a = Math.imul(this.a ^ n, 16777619);
      this.b = (Math.imul(this.b, 33) + n) | 0;
      return this;
    }
    str(s) {
      for (let i = 0; i < s.length; i++) this.num(s.charCodeAt(i), 1);
      return this;
    }
    get key() {
      return (this.a >>> 0).toString(36) + '.' + (this.b >>> 0).toString(36);
    }
  };

  U.storage = {
    get(key, fallback = null) {
      try {
        const v = globalThis.localStorage && localStorage.getItem(key);
        return v == null ? fallback : JSON.parse(v);
      } catch (e) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch (e) {
        return false;
      }
    },
    remove(key) {
      try {
        localStorage.removeItem(key);
      } catch (e) {
        /* storage unavailable */
      }
    },
  };

  /** Triggers a file download. Returns false where the host blocks downloads. */
  U.download = (filename, data, mime = 'application/octet-stream') => {
    // Sandboxed hosts ignore script-started downloads; callers then offer copy/preview instead.
    if (globalThis.V3D_NO_DOWNLOAD) return false;
    try {
      const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      return true;
    } catch (e) {
      return false;
    }
  };

  /**
   * Saves a file: through the embedding host's download capability when there is one,
   * otherwise a normal browser download. Resolves 'saved' | 'declined' | 'busy' | 'blocked'.
   */
  let hostDownloads;
  U.saveFile = async (filename, data, mime) => {
    const host = globalThis.claude;
    if (host && typeof host.use === 'function') {
      if (hostDownloads === undefined) {
        try {
          hostDownloads = await host.use('downloads');
        } catch (e) {
          hostDownloads = null;
        }
      }
      if (hostDownloads) {
        try {
          await hostDownloads.save({ filename, data });
          return 'saved';
        } catch (e) {
          if (e && e.code === 'declined') return 'declined';
          if (e && e.code === 'rate_limited') return 'busy';
        }
      }
    }
    return U.download(filename, data, mime) ? 'saved' : 'blocked';
  };

  U.copyText = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      return false;
    }
  };

  U.readFile = (file, as = 'text') =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      if (as === 'dataurl') r.readAsDataURL(file);
      else r.readAsText(file);
    });

  /** Hyperscript-style DOM builder: h('div.cls#id', {attrs}, ...children). */
  U.h = (sel, props, ...kids) => {
    const m = /^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i.exec(sel) || [];
    const el = document.createElement(m[1] || 'div');
    (m[2] || '').replace(/([.#])([\w-]+)/g, (_, t, n) => {
      if (t === '.') el.classList.add(n);
      else el.id = n;
      return '';
    });
    if (props && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) {
      kids.unshift(props);
      props = null;
    }
    if (props) {
      for (const k in props) {
        const v = props[k];
        if (v == null || v === false) continue;
        if (k === 'class') el.className += (el.className ? ' ' : '') + v;
        else if (k === 'style' && typeof v === 'object') {
          for (const sk in v) {
            if (sk.startsWith('--')) el.style.setProperty(sk, v[sk]);
            else el.style[sk] = v[sk];
          }
        }
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'html') el.innerHTML = v;
        else if (k === 'text') el.textContent = v;
        else if (k in el && typeof v !== 'string') el[k] = v;
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    const add = (c) => {
      if (c == null || c === false) return;
      if (Array.isArray(c)) c.forEach(add);
      else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
    };
    kids.forEach(add);
    return el;
  };
  U.$ = (sel, root) => (root || document).querySelector(sel);
  U.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  U.isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  U.modKey = (e) => (U.isMac() ? e.metaKey : e.ctrlKey);
  U.modName = () => (U.isMac() ? '⌘' : 'Ctrl');
})();
