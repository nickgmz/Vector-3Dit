/* Vector 3Dit — color parsing, conversion and mixing. */
(function () {
  'use strict';
  const V3D = globalThis.V3D;
  const { clamp } = V3D.U;

  const NAMED = {
    black: '#000000', white: '#ffffff', red: '#ff0000', lime: '#00ff00', green: '#008000', blue: '#0000ff',
    yellow: '#ffff00', cyan: '#00ffff', aqua: '#00ffff', magenta: '#ff00ff', fuchsia: '#ff00ff', gray: '#808080',
    grey: '#808080', silver: '#c0c0c0', maroon: '#800000', olive: '#808000', purple: '#800080', teal: '#008080',
    navy: '#000080', orange: '#ffa500', pink: '#ffc0cb', brown: '#a52a2a', gold: '#ffd700', coral: '#ff7f50',
    crimson: '#dc143c', indigo: '#4b0082', violet: '#ee82ee', turquoise: '#40e0d0', tomato: '#ff6347',
    salmon: '#fa8072', khaki: '#f0e68c', orchid: '#da70d6', plum: '#dda0dd', tan: '#d2b48c', beige: '#f5f5dc',
    ivory: '#fffff0', lavender: '#e6e6fa', chocolate: '#d2691e', skyblue: '#87ceeb', steelblue: '#4682b4',
    slategray: '#708090', darkgray: '#a9a9a9', lightgray: '#d3d3d3', darkgreen: '#006400', darkblue: '#00008b',
    darkred: '#8b0000', hotpink: '#ff69b4', deeppink: '#ff1493', dodgerblue: '#1e90ff', royalblue: '#4169e1',
    forestgreen: '#228b22', seagreen: '#2e8b57', firebrick: '#b22222', goldenrod: '#daa520', sienna: '#a0522d',
    peru: '#cd853f', wheat: '#f5deb3', mintcream: '#f5fffa', whitesmoke: '#f5f5f5', gainsboro: '#dcdcdc',
    dimgray: '#696969', lightblue: '#add8e6', lightgreen: '#90ee90', limegreen: '#32cd32', midnightblue: '#191970',
    darkorange: '#ff8c00', orangered: '#ff4500', yellowgreen: '#9acd32', cornflowerblue: '#6495ed', transparent: '#00000000',
  };

  const Color = (V3D.Color = {});

  /** Parses any CSS color into {r,g,b,a} (0–255, alpha 0–1); returns null when unparseable. */
  Color.parse = (str) => {
    if (!str) return null;
    if (typeof str === 'object') return str;
    let s = String(str).trim().toLowerCase();
    if (NAMED[s]) s = NAMED[s];
    let m;
    if ((m = /^#([0-9a-f]{3,8})$/.exec(s))) {
      let h = m[1];
      if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
      if (h.length !== 6 && h.length !== 8) return null;
      return {
        r: parseInt(h.slice(0, 2), 16),
        g: parseInt(h.slice(2, 4), 16),
        b: parseInt(h.slice(4, 6), 16),
        a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
      };
    }
    if ((m = /^rgba?\(([^)]+)\)$/.exec(s))) {
      const p = m[1].split(/[\s,/]+/).filter(Boolean);
      const ch = (v) => (v.endsWith('%') ? (parseFloat(v) * 255) / 100 : parseFloat(v));
      return {
        r: clamp(ch(p[0]), 0, 255),
        g: clamp(ch(p[1]), 0, 255),
        b: clamp(ch(p[2]), 0, 255),
        a: p[3] == null ? 1 : clamp(p[3].endsWith('%') ? parseFloat(p[3]) / 100 : parseFloat(p[3]), 0, 1),
      };
    }
    if ((m = /^hsla?\(([^)]+)\)$/.exec(s))) {
      const p = m[1].split(/[\s,/]+/).filter(Boolean);
      const rgb = Color.hslToRgb(parseFloat(p[0]), parseFloat(p[1]) / 100, parseFloat(p[2]) / 100);
      rgb.a = p[3] == null ? 1 : parseFloat(p[3]);
      return rgb;
    }
    if (typeof document !== 'undefined') {
      // Let the browser resolve anything else (full named-color list etc.).
      const ctx = Color._ctx || (Color._ctx = document.createElement('canvas').getContext('2d'));
      ctx.fillStyle = '#010203';
      ctx.fillStyle = s;
      if (ctx.fillStyle !== '#010203') return Color.parse(ctx.fillStyle);
    }
    return null;
  };

  const hex2 = (v) => {
    const h = Math.round(clamp(v, 0, 255)).toString(16);
    return h.length < 2 ? '0' + h : h;
  };
  Color.toHex = (c) => '#' + hex2(c.r) + hex2(c.g) + hex2(c.b);
  Color.toHexA = (c) => Color.toHex(c) + (c.a != null && c.a < 1 ? hex2(c.a * 255) : '');
  Color.normalize = (str, fallback = '#000000') => {
    const c = Color.parse(str);
    return c ? Color.toHex(c) : fallback;
  };

  Color.mix = (a, b, t) => ({
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
    a: (a.a == null ? 1 : a.a) + ((b.a == null ? 1 : b.a) - (a.a == null ? 1 : a.a)) * t,
  });
  Color.scale = (c, k) => ({ r: c.r * k, g: c.g * k, b: c.b * k, a: c.a });

  Color.rgbToHsl = ({ r, g, b }) => {
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    let h = 0;
    let s = 0;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return { h, s, l };
  };

  Color.hslToRgb = (h, s, l) => {
    h = (((h % 360) + 360) % 360) / 360;
    const f = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    if (s === 0) return { r: l * 255, g: l * 255, b: l * 255, a: 1 };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    return { r: f(p, q, h + 1 / 3) * 255, g: f(p, q, h) * 255, b: f(p, q, h - 1 / 3) * 255, a: 1 };
  };

  Color.rgbToHsv = ({ r, g, b }) => {
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    if (d) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    return { h, s: max ? d / max : 0, v: max };
  };

  Color.hsvToRgb = (h, s, v) => {
    const f = (n) => {
      const k = (n + h / 60) % 6;
      return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
    };
    return { r: f(5) * 255, g: f(3) * 255, b: f(1) * 255, a: 1 };
  };

  Color.luminance = (c) => {
    const lin = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  };

  /** Deep, slightly cool tone used as the default "core shadow" of a material. */
  Color.autoShadow = (base) => {
    const hsl = Color.rgbToHsl(base);
    const target = 245;
    let dh = ((target - hsl.h + 540) % 360) - 180;
    const h = hsl.h + dh * 0.22;
    const s = Math.min(1, hsl.s * 0.85 + 0.1);
    const l = Math.max(0.06, hsl.l * 0.28);
    return Color.hslToRgb(h, s, l);
  };

  /** Warm, desaturated tint used as the default highlight. */
  Color.autoHighlight = (base) => {
    const white = { r: 255, g: 252, b: 245, a: 1 };
    return Color.mix(base, white, 0.82);
  };

  Color.readableOn = (hex) => (Color.luminance(Color.parse(hex) || { r: 0, g: 0, b: 0 }) > 0.35 ? '#15161b' : '#ffffff');

  Color.random = () => Color.toHex(Color.hslToRgb(Math.random() * 360, 0.6 + Math.random() * 0.3, 0.5 + Math.random() * 0.15));
})();
