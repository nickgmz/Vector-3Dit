"""The 3D Editor window for the Inkscape extension (GTK 3).

Every Vector 3Dit setting in one window, organised in tabs and styled like the
Vector 3Dit web app: kind, view and rotation (trackball and preset views),
shape, surface and material, colors, light, outlines and shadow, and style,
next to a live preview of the objects in place on the page.

Everything drawn by the window (preview, trackball, light sphere, thumbnails,
icons) is SVG shown through GdkPixbuf's SVG loader, the one GTK uses for its
own icons, so no cairo bindings are needed (they are broken in some Inkscape
builds on Windows).
"""

import colorsys
import json
import math
import os
import warnings

warnings.simplefilter("ignore", ImportWarning)  # some Inkscape builds warn about gi's importer on stderr

import gi  # noqa: E402

gi.require_version("Gtk", "3.0")
gi.require_version("Gdk", "3.0")
gi.require_version("GdkPixbuf", "2.0")
from gi.repository import Gdk, GdkPixbuf, GLib, Gtk  # noqa: E402

import vector3dit_engine as E  # noqa: E402

# The web app's dark theme ("warm orange on graphite").
T = {
    "bg": "#131419", "canvas": "#0e0f13", "panel": "#1a1c22", "panel2": "#22252d", "panel3": "#2b2f39",
    "line": "#2c303a", "line2": "#3b404d", "text": "#ecebe6", "text2": "#b7bbc5", "muted": "#8a8f9c",
    "accent": "#f2a541", "accent_text": "#ffc275", "accent_ink": "#241504",
    "x": "#ef6461", "y": "#62c26a", "z": "#5b9cf5",
    "tb_side": "#7f8494", "tb_top": "#b5b9c5", "tb_edge": "#0f1014", "sphere": "#c9ccd4", "mat_base": "#a3acbf",
}
DESK = T["canvas"]
SVG_NS = 'xmlns="http://www.w3.org/2000/svg"'
FONT = "'IBM Plex Sans', 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
MONO = "'IBM Plex Mono', Consolas, Menlo, 'DejaVu Sans Mono', monospace"

# Icons from the web app (24×24, stroked with currentColor).
ICONS = {
    "flat": '<path d="M3.5 15.5L10 6.5h10.5l-6.5 9z"/><path d="M8 11h3.5" opacity=".6"/>',
    "extrude": '<path d="M4 8.5L12 4l8 4.5v7L12 20l-8-4.5z"/><path d="M4 8.5l8 4.5 8-4.5M12 13v7"/>',
    "revolve": '<path d="M9 3.5h6c0 2-2 3-2 5 0 2.5 4 3.5 4 8 0 2.4-2.2 4-5 4s-5-1.6-5-4c0-4.5 4-5.5 4-8 0-2-2-3-2-5z"/>'
               '<path d="M3.5 12.5c0 1.5 1.5 2.5 3.5 3" stroke-dasharray="1.6 1.8"/><path d="M20.5 12.5c0 1.5-1.5 2.5-3.5 3"/>',
    "inflate": '<path d="M5.5 9.5C5.5 6 8 4.5 12 4.5s6.5 1.5 6.5 5c0 1.6-.6 2.4-.6 3.6 0 1.5 1.1 2.4 1.1 4 0 2.4-3 3.4-7 3.4s-7-1-7-3.4'
               'c0-1.6 1.1-2.5 1.1-4 0-1.2-.6-2-.6-3.6z"/><path d="M8.5 8.3c.8-1 2-1.4 3.2-1.4" opacity=".6"/>',
    "orbit": '<path d="M12 7.5l4.3 2.4v4.8L12 17.1l-4.3-2.4V9.9z"/><path d="M12 12.3l4.3-2.4M12 12.3v4.8M12 12.3L7.7 9.9"/>'
             '<path d="M4.2 8.2A9 9 0 0 1 17 4.4"/><path d="M15.8 2.6L17.4 4.5 15.4 6"/><path d="M19.8 15.8A9 9 0 0 1 7 19.6"/>'
             '<path d="M8.2 21.4L6.6 19.5 8.6 18"/>',
    "cube": '<path d="M12 2.8l8 4.6v9.2l-8 4.6-8-4.6V7.4z"/><path d="M4 7.4l8 4.6 8-4.6M12 12v9.2"/>',
    "sparkle": '<path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9z"/><path d="M18.5 16l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>',
    "palette": '<path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.3 0 1.8-.8 1.8-1.6 0-1.2-1-1.4-1-2.5 0-1 .8-1.6 1.8-1.6H17a3.5 3.5 0 0 0 3.5-3.5'
               'c0-4.3-3.8-7.8-8.5-7.8z"/><circle cx="7.8" cy="11" r="1.2" fill="currentColor"/><circle cx="10" cy="7.3" r="1.2" '
               'fill="currentColor"/><circle cx="14.5" cy="7.5" r="1.2" fill="currentColor"/>',
    "light": '<circle cx="12" cy="12" r="3.8"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7'
             'M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/>',
    "shadow": '<circle cx="10" cy="9.5" r="5"/><ellipse cx="13" cy="19" rx="7" ry="1.8" fill="currentColor" fill-opacity=".35"/>',
    "sliders": '<path d="M5 4v16M12 4v16M19 4v16"/><circle cx="5" cy="15" r="2" fill="currentColor"/><circle cx="12" cy="8" r="2" '
               'fill="currentColor"/><circle cx="19" cy="13" r="2" fill="currentColor"/>',
    "rotCCW": '<path d="M5 12a7 7 0 1 0 2.2-5.1"/><path d="M6.5 3v4.5H11"/>',
    "chevDown": '<path d="M6 9.5l6 6 6-6"/>',
    "fit": '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
}

CSS = ("""
.v3d, .v3d-pop, .v3d-pop contents { background-color: %(panel)s; color: %(text)s; }
.v3d * { font-family: %(font)s; }
.v3d label { color: %(text2)s; font-size: 12px; }
.v3d .muted, .v3d .muted label { color: %(muted)s; font-size: 11.5px; }
.v3d .sub-label { color: %(muted)s; font-size: 11px; font-weight: 600; letter-spacing: 1px; margin-top: 4px; }
.v3d .tip { background-color: rgba(242, 165, 65, 0.14); border-radius: 7px; padding: 8px 10px; }
.v3d .tip label { color: %(text2)s; }
.v3d .preview-bar { background-color: %(panel)s; border-bottom: 1px solid %(line)s; padding: 6px 10px; }
.v3d .panel-head { padding: 12px 14px 0 14px; }
.v3d .brand { color: %(text)s; font-size: 13px; font-weight: 700; }
.v3d .tabs { padding: 6px; border-bottom: 1px solid %(line)s; }
.v3d .page { padding: 12px 14px 16px 14px; }
.v3d .footer { border-top: 1px solid %(line)s; padding: 10px 14px; }
.v3d separator { background-color: %(line)s; min-width: 1px; min-height: 1px; }
.v3d button { background-image: none; box-shadow: none; text-shadow: none; outline-color: %(accent)s; }
.v3d .tab { background-color: transparent; border: none; border-radius: 7px; padding: 5px 2px 4px 2px; min-height: 0; }
.v3d .tab label { color: %(muted)s; font-size: 11.5px; font-weight: 500; }
.v3d .tab:hover { background-color: %(panel3)s; }
.v3d .tab:hover label { color: %(text)s; }
.v3d .tab:checked { background-color: rgba(242, 165, 65, 0.14); }
.v3d .tab:checked label { color: %(accent_text)s; }
.v3d .seg { background-color: %(panel2)s; border: 1px solid %(line2)s; border-radius: 7px; padding: 2px; }
.v3d .seg button { background-color: transparent; border: none; border-radius: 5px; padding: 3px 6px; min-height: 0; min-width: 0; }
.v3d .seg button label { color: %(text2)s; font-size: 12px; }
.v3d .seg button:hover { background-color: %(panel3)s; }
.v3d .seg button:hover label { color: %(text)s; }
.v3d .seg button:checked { background-color: %(accent)s; }
.v3d .seg button:checked label { color: %(accent_ink)s; font-weight: 600; }
.v3d .kinds button { padding: 6px 2px 5px 2px; }
.v3d .kinds button label { font-size: 11.5px; }
.v3d .tile, .v3d-pop .tile { background-color: %(panel2)s; border: 1px solid %(line)s; border-radius: 7px; padding: 5px 2px 4px 2px; min-height: 0; min-width: 0; }
.v3d .tile label, .v3d-pop .tile label { color: %(text2)s; font-size: 10.5px; }
.v3d .tile:hover, .v3d-pop .tile:hover, .v3d-pop .tile:checked { border-color: %(accent)s; }
.v3d .tile:hover label, .v3d-pop .tile:hover label { color: %(text)s; }
.v3d-pop .tile { background-color: %(panel)s; font-size: 11px; }
.v3d-pop { border: 1px solid %(line2)s; border-radius: 9px; padding: 6px; }
.v3d .btn { background-color: %(panel2)s; border: 1px solid %(line2)s; border-radius: 7px; padding: 0 11px; min-height: 28px; }
.v3d .btn label { color: %(text)s; font-size: 12.5px; }
.v3d .btn:hover { background-color: %(panel3)s; }
.v3d .btn.small { min-height: 26px; padding: 0 9px; }
.v3d .btn.small label { font-size: 12px; }
.v3d .btn.ghost { background-color: transparent; border-color: transparent; }
.v3d .btn.ghost:hover { background-color: %(panel3)s; }
.v3d .btn.primary { background-color: %(accent)s; border-color: %(accent)s; }
.v3d .btn.primary label { color: %(accent_ink)s; font-weight: 600; }
.v3d .btn.primary:hover { background-color: #ffbe63; }
.v3d .swatch { background-color: %(panel2)s; border: 1px solid %(line2)s; border-radius: 7px; padding: 0 8px 0 4px; min-height: 28px; }
.v3d .swatch:hover { border-color: %(muted)s; }
.v3d .swatch label { font-family: %(mono)s; font-size: 11.5px; color: %(text2)s; }
.v3d .bevel-btn { background-color: %(panel2)s; border: 1px solid %(line2)s; border-radius: 7px; padding: 0 8px 0 3px; min-height: 34px; }
.v3d .bevel-btn label { color: %(text)s; font-size: 12.5px; }
.v3d spinbutton { color: %(text)s; background-color: %(panel2)s; border: 1px solid %(line2)s; border-radius: 6px; box-shadow: none; min-height: 24px; }
.v3d spinbutton:focus-within { border-color: %(accent)s; }
.v3d spinbutton text, .v3d spinbutton entry text { color: %(text)s; }
.v3d spinbutton entry { background-color: transparent; border: none; box-shadow: none; color: %(text)s; font-family: %(mono)s;
                        font-size: 12px; padding: 1px 2px 1px 5px; min-height: 0; min-width: 0; }
.v3d spinbutton button { background-color: transparent; border: none; color: %(muted)s; padding: 0; min-width: 13px; min-height: 0;
                         -gtk-icon-transform: scale(0.62); }
.v3d spinbutton button:hover { color: %(text)s; }
.v3d scale { padding: 6px 0; }
.v3d scale trough { background-color: %(line2)s; border: none; border-radius: 4px; min-height: 4px; }
.v3d scale highlight { background-color: %(accent)s; border: none; border-radius: 4px; }
.v3d scale.ax-x highlight { background-color: %(x)s; }
.v3d scale.ax-y highlight { background-color: %(y)s; }
.v3d scale.ax-z highlight { background-color: %(z)s; }
.v3d scale slider { background-color: %(text)s; background-image: none; border: 2px solid %(panel)s; border-radius: 50%%;
                    box-shadow: 0 0 0 1px %(line2)s; min-width: 14px; min-height: 14px; margin: -7px; }
.v3d combobox button, .v3d combobox box.linked button { background-color: %(panel2)s; border: 1px solid %(line2)s; border-radius: 6px;
                                                       min-height: 26px; padding: 0 6px; }
.v3d combobox button label, .v3d combobox cellview { color: %(text)s; font-size: 12px; }
.v3d switch { background-color: %(line2)s; background-image: none; border: none; border-radius: 10px; min-width: 30px; min-height: 17px;
              font-size: 0; box-shadow: none; }
.v3d switch:checked { background-color: %(accent)s; }
.v3d switch slider { background-color: %(text)s; background-image: none; border: none; border-radius: 50%%; min-width: 13px;
                     min-height: 13px; margin: 2px; box-shadow: none; }
.v3d switch:checked slider { background-color: %(accent_ink)s; }
.v3d switch image { color: transparent; }
.v3d .toggle label { color: %(text2)s; font-size: 12.5px; }
.v3d check { background-color: %(panel2)s; background-image: none; border: 1px solid %(line2)s; border-radius: 4px; color: %(accent_ink)s; }
.v3d check:checked { background-color: %(accent)s; border-color: %(accent)s; }
.v3d checkbutton label { color: %(text2)s; }
.v3d scrollbar { background-color: transparent; border: none; }
.v3d scrollbar slider { background-color: %(line2)s; min-width: 6px; border-radius: 3px; }
.v3d-pop label { color: %(text2)s; font-size: 12px; }
.v3d-pop .cp-title { color: %(text)s; font-weight: 600; }
.v3d-pop entry { background-color: %(panel2)s; background-image: none; border: 1px solid %(line2)s; border-radius: 6px; color: %(text)s;
                 font-family: %(mono)s; font-size: 12px; min-height: 26px; box-shadow: none; }
.v3d-pop entry:focus { border-color: %(accent)s; }
.v3d-pop scale.hue trough { background-image: linear-gradient(to right, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000);
                            background-color: transparent; border: none; border-radius: 5px; min-height: 10px; }
.v3d-pop scale.hue highlight { background: none; border: none; }
.v3d-pop scale slider { background-color: %(text)s; background-image: none; border: 2px solid %(panel)s; border-radius: 50%%;
                        box-shadow: 0 0 0 1px %(line2)s; min-width: 14px; min-height: 14px; margin: -4px; }
.v3d-pop .cp-sw { background: none; border: none; box-shadow: none; padding: 1px; min-width: 0; min-height: 0; border-radius: 6px; }
.v3d-pop .cp-sw:hover { background-color: %(panel3)s; }
.v3d-pop .btn { background-color: %(panel2)s; border: 1px solid %(line2)s; border-radius: 7px; padding: 0 9px; min-height: 26px; }
.v3d-pop .btn label { color: %(text)s; }
.v3d .axis-x { color: %(x)s; } .v3d .axis-y { color: %(y)s; } .v3d .axis-z { color: %(z)s; }
""" % dict(T, font=FONT, mono=MONO)).encode("utf-8")


def rgb(hex_color, default=(0.6, 0.6, 0.6)):
    c = E.parse_color(hex_color)
    return (c[0] / 255.0, c[1] / 255.0, c[2] / 255.0) if c else default


def hexc(c):
    return "#%02x%02x%02x" % tuple(int(round(max(0.0, min(1.0, v)) * 255)) for v in c)


def mix(a, b, p):
    """CSS color-mix(in srgb, a p, b)."""
    ca, cb = rgb(a), rgb(b)
    return hexc(tuple(x * p + y * (1 - p) for x, y in zip(ca, cb)))


def wrap180(a):
    a = (a + 180.0) % 360.0 - 180.0
    return 180.0 if a == -180.0 else a


def f(v):
    return E.fmt(v, 2)


def svg_supported():
    try:
        return any(fm.get_name() == "svg" for fm in GdkPixbuf.Pixbuf.get_formats())
    except Exception:  # noqa: BLE001
        return False


def svg_pixbuf(markup):
    loader = GdkPixbuf.PixbufLoader.new_with_mime_type("image/svg+xml")
    loader.write(markup.encode("utf-8"))
    loader.close()
    return loader.get_pixbuf()


def svg_image(markup):
    return Gtk.Image.new_from_pixbuf(svg_pixbuf(markup))


def icon_svg(name, color, size=20):
    return ('<svg %s viewBox="0 0 24 24" width="%d" height="%d" fill="none" stroke="%s" stroke-width="1.7" stroke-linecap="round" '
            'stroke-linejoin="round">%s</svg>' % (SVG_NS, size, size, color, ICONS[name].replace("currentColor", color)))


# ---------------------------------------------------------------- drawings in the web app's style

def cube_faces(rx, ry, rz, s):
    R = E.from_euler(rx, ry, rz)
    cols = {"front": T["accent"], "back": T["tb_side"], "side": T["tb_side"], "top": T["tb_top"]}
    faces = [
        ((0, 0, 1), [(-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1)], "front"),
        ((0, 0, -1), [(1, -1, -1), (-1, -1, -1), (-1, 1, -1), (1, 1, -1)], "back"),
        ((1, 0, 0), [(1, -1, 1), (1, -1, -1), (1, 1, -1), (1, 1, 1)], "side"),
        ((-1, 0, 0), [(-1, -1, -1), (-1, -1, 1), (-1, 1, 1), (-1, 1, -1)], "side"),
        ((0, 1, 0), [(-1, 1, 1), (1, 1, 1), (1, 1, -1), (-1, 1, -1)], "top"),
        ((0, -1, 0), [(-1, -1, -1), (1, -1, -1), (1, -1, 1), (-1, -1, 1)], "top"),
    ]
    out = []
    for n, verts, role in faces:
        nn = E.m_apply(R, list(n))
        if nn[2] <= 0.001:
            continue
        pts = [E.m_apply(R, [v[0] * s, v[1] * s, v[2] * s * 0.55]) for v in verts]
        k = 0.55 + 0.45 * nn[2]
        out.append((nn[2], [(p[0], -p[1]) for p in pts], hexc(tuple(min(1.0, c * k) for c in rgb(cols[role])))))
    out.sort(key=lambda face: face[0])
    return out


def cube_markup(rx, ry, rz, size):
    c = size / 2.0
    return "".join('<path d="M%sZ" fill="%s" stroke="%s" stroke-width="1" stroke-linejoin="round"/>'
                   % ("L".join("%s %s" % (f(c + p[0]), f(c + p[1])) for p in pts), col, T["tb_edge"])
                   for _, pts, col in cube_faces(rx, ry, rz, size * 0.3))


def axes(rx, ry, rz):
    R = E.from_euler(rx, ry, rz)
    res = []
    for name, v in (("x", [1, 0, 0]), ("y", [0, 1, 0]), ("z", [0, 0, 1])):
        p = E.m_apply(R, v)
        res.append((p[2], name, p[0], -p[1]))
    res.sort()
    return res


def trackball_svg(size, rx, ry, rz):
    c = size / 2.0
    r = size * 0.44

    def axis(a):
        z, name, x, y = a
        return ('<line x1="%s" y1="%s" x2="%s" y2="%s" stroke="%s" stroke-width="2" stroke-linecap="round" opacity="%s"/>'
                '<text x="%s" y="%s" fill="%s" font-family="%s" font-weight="600" font-size="9" text-anchor="middle">%s</text>'
                % (f(c), f(c), f(c + x * r), f(c + y * r), T[name], "0.35" if z < 0 else "1", f(c + x * (r + 7)),
                   f(c + y * (r + 7) + 3), T[name], MONO.replace("'", ""), name.upper()))

    ax = axes(rx, ry, rz)
    return ('<svg %s width="%d" height="%d" viewBox="0 0 %d %d"><defs><radialGradient id="bg" cx="0.4" cy="0.35" r="0.5">'
            '<stop offset="0" stop-color="%s"/><stop offset="0.7" stop-color="%s"/><stop offset="1" stop-color="%s"/>'
            '</radialGradient></defs><circle cx="%s" cy="%s" r="%s" fill="url(#bg)"/>'
            '<circle cx="%s" cy="%s" r="%s" fill="none" stroke="%s" stroke-dasharray="3 4"/>%s%s%s</svg>'
            % (SVG_NS, size, size, size, size, T["panel3"], T["panel2"], T["panel2"], f(c), f(c), f(c), f(c), f(c), f(c - 3),
               T["line2"], axis(ax[0]), cube_markup(rx, ry, rz, size), "".join(axis(a) for a in ax[1:])))


def light_sphere_pixbuf(size, az, el):
    """The web app's light sphere: per-pixel Lambert plus a specular spot, and the sun marker."""
    L = E.light_dir(az, el)
    H = E.v_norm([L[0], L[1], L[2] + 1.0])
    base = rgb(T["sphere"])
    R = size / 2.0 - 2
    data = bytearray(size * size * 4)
    for y in range(size):
        ny = -(y + 0.5 - size / 2.0) / R
        for x in range(size):
            nx = (x + 0.5 - size / 2.0) / R
            d = nx * nx + ny * ny
            if d > 1:
                continue
            nz = math.sqrt(1 - d)
            lam = max(0.0, nx * L[0] + ny * L[1] + nz * L[2])
            sp = math.pow(max(0.0, nx * H[0] + ny * H[1] + nz * H[2]), 40) * 0.8
            k = 0.22 + 0.78 * lam
            i = (y * size + x) * 4
            data[i] = int(min(255, base[0] * 255 * k + 255 * sp))
            data[i + 1] = int(min(255, base[1] * 255 * k + 255 * sp))
            data[i + 2] = int(min(255, base[2] * 255 * k + 255 * sp))
            data[i + 3] = 255 if d <= 0.985 else int(255 * (1 - (d - 0.985) / 0.015))
    pb = GdkPixbuf.Pixbuf.new_from_bytes(GLib.Bytes.new(bytes(data)), GdkPixbuf.Colorspace.RGB, True, 8, size, size, size * 4)
    px, py = size / 2.0 + L[0] * R, size / 2.0 - L[1] * R
    behind = L[2] < 0
    if behind:
        n = math.hypot(L[0], L[1]) or 1.0
        px, py = size / 2.0 + L[0] / n * R, size / 2.0 - L[1] / n * R
    sun = svg_pixbuf('<svg %s width="%d" height="%d"><circle cx="%s" cy="%s" r="6.5" fill="%s" stroke="#3a2a05" '
                     'stroke-width="1.5"/></svg>' % (SVG_NS, size, size, f(px), f(py),
                                                      "rgba(255,214,102,0.45)" if behind else "#ffd666"))
    sun.composite(pb, 0, 0, size, size, 0, 0, 1, 1, GdkPixbuf.InterpType.NEAREST, 255)
    return pb


def bevel_thumb(bevel, size=36):
    fill = '<path d="%sH2Z" fill="%s" fill-opacity="0.14"/><path d="%s" fill="none" stroke="%s" stroke-width="2" stroke-linejoin="round"/>'
    if bevel == "none" or bevel not in E.BEVELS:
        body = ('<path d="M2 7H28V35H2Z" fill="%s" fill-opacity="0.14"/><path d="M2 7H28V35" fill="none" stroke="%s" '
                'stroke-width="2" stroke-linejoin="round"/>' % (T["accent"], T["accent_text"]))
    else:
        pts = [(8 + 20 * (1 - o), 7 + 20 * z) for o, z in E.BEVELS[bevel](8)]
        d = "M2 7H8" + "".join("L%s %s" % (f(x), f(y)) for x, y in pts) + "V35"
        body = fill % (d, T["accent"], d, T["accent_text"])
    return '<svg %s viewBox="0 0 36 36" width="%d" height="%d">%s</svg>' % (SVG_NS, size, size, body)


def material_ball(mat, c, size=24):
    """The web app's material swatches, drawn as SVG."""
    r = size / 2.0
    ink, deep = "#1b1c22", "#151530"
    g = ""
    extra = ""
    if mat == "glossy":
        g = ('<radialGradient id="m" cx="0.35" cy="0.3" r="0.8"><stop offset="0" stop-color="#ffffff"/><stop offset="0.28" '
             'stop-color="%s"/><stop offset="1" stop-color="%s"/></radialGradient>' % (c, mix(c, "#000000", 0.45)))
    elif mat == "clay":
        g = ('<radialGradient id="m" cx="0.35" cy="0.3" r="0.8"><stop offset="0" stop-color="%s"/><stop offset="0.45" '
             'stop-color="%s"/><stop offset="1" stop-color="%s"/></radialGradient>'
             % (mix(c, "#ffffff", 0.6), c, mix(c, "#1a1a3a", 0.4)))
    elif mat == "toon":
        g = ('<linearGradient id="m" x1="0" y1="0" x2="1" y2="1"><stop offset="0.35" stop-color="%s"/><stop offset="0.35" '
             'stop-color="%s"/><stop offset="0.7" stop-color="%s"/><stop offset="0.7" stop-color="%s"/></linearGradient>'
             % (mix(c, "#ffffff", 0.55), c, c, mix(c, deep, 0.5)))
        extra = '<circle cx="%s" cy="%s" r="%s" fill="none" stroke="%s" stroke-width="1.5"/>' % (r, r, r - 0.75, ink)
    elif mat == "poster":
        g = ('<linearGradient id="m" x1="0" y1="0" x2="1" y2="1"><stop offset="0.55" stop-color="%s"/><stop offset="0.55" '
             'stop-color="%s"/></linearGradient>' % (c, mix(c, deep, 0.55)))
    elif mat in ("chrome", "gold", "copper"):
        g = ('<linearGradient id="m" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="%s"/><stop offset="0.4" stop-color="%s"/>'
             '<stop offset="0.5" stop-color="%s"/><stop offset="0.54" stop-color="%s"/><stop offset="0.8" stop-color="%s"/>'
             '<stop offset="1" stop-color="%s"/></linearGradient>'
             % (mix(c, "#ffffff", 0.3), c, mix(c, "#000000", 0.25), mix(c, "#ffffff", 0.7), c, mix(c, "#000000", 0.4)))
    elif mat == "lineart":
        extra = '<circle cx="%s" cy="%s" r="%s" fill="none" stroke="%s" stroke-width="1.5"/>' % (r, r, r - 0.75, ink)
    elif mat == "wire":
        lines = "".join('<path d="M0 %sH%sM%s 0V%s" stroke="#2f6fed" stroke-width="1"/>' % (v, size, v, size)
                        for v in (4.5, 9.5, 14.5, 19.5))
        extra = ('<g clip-path="url(#clip)">%s</g><circle cx="%s" cy="%s" r="%s" fill="none" stroke="#2f6fed" stroke-width="1.5"/>'
                 % (lines, r, r, r - 0.75))
    paint = {"lineart": "#ffffff", "wire": "none", "flat": c}.get(mat, "url(#m)")
    return ('<svg %s width="%d" height="%d" viewBox="0 0 %d %d"><defs>%s<clipPath id="clip"><circle cx="%s" cy="%s" r="%s"/>'
            '</clipPath></defs><circle cx="%s" cy="%s" r="%s" fill="%s"/>%s</svg>'
            % (SVG_NS, size, size, size, size, g, r, r, r, r, r, r, paint, extra))


def chip_svg(color, size=20, none=False):
    if none:
        return ('<svg %s width="%d" height="%d"><rect x="0.5" y="0.5" width="%d" height="%d" rx="5" fill="%s" stroke="%s"/>'
                '<path d="M4 %dL%d 4" stroke="#ff7b7b" stroke-width="2" stroke-linecap="round"/></svg>'
                % (SVG_NS, size, size, size - 1, size - 1, T["panel2"], T["line2"], size - 4, size - 4))
    if not color:
        return ('<svg %s width="%d" height="%d"><rect x="0.5" y="0.5" width="%d" height="%d" rx="5" fill="%s" stroke="%s" '
                'stroke-dasharray="2 2"/></svg>' % (SVG_NS, size, size, size - 1, size - 1, T["panel3"], T["muted"]))
    return ('<svg %s width="%d" height="%d"><rect width="%d" height="%d" rx="5" fill="%s"/><rect x="0.5" y="0.5" width="%d" '
            'height="%d" rx="4.5" fill="none" stroke="#000000" stroke-opacity="0.25"/></svg>'
            % (SVG_NS, size, size, size, size, color, size - 1, size - 1))


# ---------------------------------------------------------------- custom widgets

class Trackball(Gtk.EventBox):
    """Drag the cube to turn the objects. Shift locks one axis, Alt spins flat, arrow keys step 5°."""

    SIZE = 132

    def __init__(self, win):
        super().__init__()
        self.win = win
        self.image = Gtk.Image()
        self.add(self.image)
        self.set_size_request(self.SIZE, self.SIZE)
        self.set_can_focus(True)
        self.add_events(Gdk.EventMask.BUTTON_PRESS_MASK | Gdk.EventMask.BUTTON_RELEASE_MASK |
                        Gdk.EventMask.POINTER_MOTION_MASK | Gdk.EventMask.KEY_PRESS_MASK)
        self.set_tooltip_text("Drag to turn. Shift: one axis at a time. Alt: spin flat. Arrow keys: 5° steps.")
        self.connect("button-press-event", lambda w, e: (self.grab_focus(), win.begin_turn(e.x, e.y))[1])
        self.connect("motion-notify-event", lambda w, e: win.turn_to(e.x, e.y, e.state, 0.8))
        self.connect("button-release-event", lambda w, e: win.end_turn())
        self.connect("key-press-event", self.on_key)
        self._key = None

    def on_key(self, _w, e):
        step = {Gdk.KEY_Left: (0, -5), Gdk.KEY_Right: (0, 5), Gdk.KEY_Up: (-5, 0), Gdk.KEY_Down: (5, 0)}.get(e.keyval)
        if not step:
            return False
        self.win.nudge(*step)
        return True

    def redraw(self):
        st = self.win.state
        key = tuple(float(st.get(k) or 0) for k in turn_keys(st))
        if key != self._key:
            self._key = key
            self.image.set_from_pixbuf(svg_pixbuf(trackball_svg(self.SIZE, *key)))


class LightSphere(Gtk.EventBox):
    """Drag the sun to aim the light. Past the rim, the light moves behind the object."""

    SIZE = 112

    def __init__(self, win):
        super().__init__()
        self.win = win
        self.image = Gtk.Image()
        self.add(self.image)
        self.set_size_request(self.SIZE, self.SIZE)
        self.add_events(Gdk.EventMask.BUTTON_PRESS_MASK | Gdk.EventMask.BUTTON_RELEASE_MASK |
                        Gdk.EventMask.POINTER_MOTION_MASK)
        self.set_tooltip_text("Drag the sun to aim the light")
        self.dragging = False
        self.connect("button-press-event", self.on_press)
        self.connect("motion-notify-event", lambda w, e: self.dragging and self.aim(e.x, e.y))
        self.connect("button-release-event", self.on_release)
        self._key = None

    def on_press(self, _w, e):
        self.dragging = True
        self.aim(e.x, e.y)
        return True

    def on_release(self, _w, _e):
        self.dragging = False
        return True

    def aim(self, x, y):
        c = self.SIZE / 2.0
        R = c - 2
        nx, ny = (x - c) / R, -(y - c) / R
        d = math.hypot(nx, ny)
        if d <= 1:
            z = math.sqrt(max(0.0, 1 - d * d))
        else:
            nx, ny = nx / d, ny / d
            z = -min(1.0, (d - 1) * 2)
            k = math.sqrt(max(0.0, 1 - z * z))
            nx, ny = nx * k, ny * k
        el = max(-89.0, min(89.0, math.degrees(math.asin(max(-1.0, min(1.0, ny))))))
        az = math.degrees(math.atan2(nx, z))
        self.win.set_values({"light_az": round(az, 1), "light_el": round(el, 1)})
        return True

    def redraw(self):
        st = self.win.state
        key = (st["light_az"], st["light_el"])
        if key != self._key:
            self._key = key
            self.image.set_from_pixbuf(light_sphere_pixbuf(self.SIZE, *key))


PALETTE = ["#1b1c22", "#4a4e5a", "#8a8f9c", "#c9ccd4", "#ffffff",
           "#e8505b", "#f2a541", "#ffd23f", "#52c7a0", "#2fb5c9",
           "#4d7cf0", "#7b61ff", "#c65ad8", "#ff8fab", "#a0522d",
           "#8b1e3f", "#c2410c", "#e2b44a", "#2f9e44", "#0b7285",
           "#1e3a8a", "#3b2a8f", "#6b2d5c", "#f7e1c9", "#d6e8ff"]
RECENT = []


class ColorPopover(Gtk.Popover):
    """The web app's color picker, inside the editor window (a separate dialog could open behind it)."""

    SV_W, SV_H = 220, 140

    def __init__(self, anchor, title, value, allow_none, on_input, on_change):
        super().__init__()
        self.set_relative_to(anchor)
        self.set_position(Gtk.PositionType.LEFT)
        styled(self, "v3d-pop")
        self.on_input, self.on_change = on_input, on_change
        c = rgb(value or "#888888")
        self.hsv = list(colorsys.rgb_to_hsv(*c))
        self._syncing = False
        self._dragging = False

        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=8)
        box.set_margin_start(4)
        box.set_margin_end(4)
        box.set_margin_top(4)
        box.set_margin_bottom(4)
        box.pack_start(label(title, "cp-title"), False, False, 0)
        self.sv = Gtk.EventBox()
        self.sv_image = Gtk.Image()
        self.sv.add(self.sv_image)
        self.sv.add_events(Gdk.EventMask.BUTTON_PRESS_MASK | Gdk.EventMask.BUTTON_RELEASE_MASK |
                           Gdk.EventMask.POINTER_MOTION_MASK)
        self.sv.connect("button-press-event", self.sv_press)
        self.sv.connect("motion-notify-event", lambda w, e: self._dragging and self.sv_at(e.x, e.y, False))
        self.sv.connect("button-release-event", self.sv_release)
        box.pack_start(self.sv, False, False, 0)
        self.hue = Gtk.Scale(orientation=Gtk.Orientation.HORIZONTAL,
                             adjustment=Gtk.Adjustment(value=0, lower=0, upper=360, step_increment=1, page_increment=10))
        self.hue.set_draw_value(False)
        styled(self.hue, "hue")
        self.hue.connect("value-changed", self.hue_changed)
        self.hue.connect("button-release-event", lambda *_: self.emit_color(True) and False)
        box.pack_start(self.hue, False, False, 0)
        tools = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
        self.chip = Gtk.Image()
        tools.pack_start(self.chip, False, False, 0)
        self.hex = Gtk.Entry()
        self.hex.set_width_chars(9)
        self.hex.set_max_length(9)
        self.hex.connect("activate", self.hex_entered)
        self.hex.connect("focus-out-event", lambda *_: self.hex_entered(self.hex) and False)
        tools.pack_start(self.hex, True, True, 0)
        if allow_none:
            none = styled(Gtk.Button(label="None"), "btn")
            none.set_tooltip_text("No color")
            none.connect("clicked", self.choose_none)
            tools.pack_start(none, False, False, 0)
        box.pack_start(tools, False, False, 0)
        if RECENT:
            box.pack_start(label("RECENT", "sub-label"), False, False, 0)
            box.pack_start(self.swatches(RECENT), False, False, 0)
        box.pack_start(label("PALETTE", "sub-label"), False, False, 0)
        box.pack_start(self.swatches(PALETTE), False, False, 0)
        box.show_all()
        self.add(box)
        self.paint()

    def swatches(self, colors):
        grid = Gtk.Grid(column_spacing=4, row_spacing=4)
        for i, col in enumerate(colors):
            b = styled(Gtk.Button(), "cp-sw")
            b.set_tooltip_text(col)
            b.add(Gtk.Image.new_from_pixbuf(svg_pixbuf(chip_svg(col, 24))))
            b.connect("clicked", lambda _b, c=col: self.set_hex(c, True))
            grid.attach(b, i % 10 if len(colors) <= 10 else i % 5, i // (10 if len(colors) <= 10 else 5), 1, 1)
        return grid

    def value(self):
        return hexc(colorsys.hsv_to_rgb(*self.hsv))

    def paint(self):
        h, sat, val = self.hsv
        base = hexc(colorsys.hsv_to_rgb(h, 1, 1))
        x, y = sat * self.SV_W, (1 - val) * self.SV_H
        self.sv_image.set_from_pixbuf(svg_pixbuf(
            '<svg %s width="%d" height="%d"><defs><clipPath id="c"><rect width="%d" height="%d" rx="6"/></clipPath>'
            '<linearGradient id="a"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="%s"/></linearGradient>'
            '<linearGradient id="b" x2="0" y2="1"><stop offset="0" stop-color="#000000" stop-opacity="0"/><stop offset="1" '
            'stop-color="#000000"/></linearGradient></defs><g clip-path="url(#c)"><rect width="%d" height="%d" fill="url(#a)"/>'
            '<rect width="%d" height="%d" fill="url(#b)"/></g><circle cx="%s" cy="%s" r="7" fill="none" stroke="#000000" '
            'stroke-opacity="0.45" stroke-width="1"/><circle cx="%s" cy="%s" r="6" fill="none" stroke="#ffffff" stroke-width="2"/></svg>'
            % (SVG_NS, self.SV_W, self.SV_H, self.SV_W, self.SV_H, base, self.SV_W, self.SV_H, self.SV_W, self.SV_H,
               f(x), f(y), f(x), f(y))))
        self._syncing = True
        self.hue.set_value(h * 360)
        self._syncing = False
        v = self.value()
        self.chip.set_from_pixbuf(svg_pixbuf(chip_svg(v, 26)))
        if not self.hex.has_focus():
            self.hex.set_text(v.upper())

    def emit_color(self, final):
        self.paint()
        v = self.value()
        if final:
            if v in RECENT:
                RECENT.remove(v)
            RECENT.insert(0, v)
            del RECENT[10:]
            self.on_change(v)
        else:
            self.on_input(v)
        return True

    def sv_at(self, x, y, final):
        self.hsv[1] = max(0.0, min(1.0, x / self.SV_W))
        self.hsv[2] = max(0.0, min(1.0, 1 - y / self.SV_H))
        return self.emit_color(final)

    def sv_press(self, _w, e):
        self._dragging = True
        return self.sv_at(e.x, e.y, False)

    def sv_release(self, _w, e):
        self._dragging = False
        return self.sv_at(e.x, e.y, True)

    def hue_changed(self, scale):
        if self._syncing:
            return
        self.hsv[0] = (scale.get_value() % 360) / 360.0
        self.emit_color(False)

    def set_hex(self, value, final):
        c = E.parse_color(value)
        if c is None:
            return False
        self.hsv = list(colorsys.rgb_to_hsv(c[0] / 255.0, c[1] / 255.0, c[2] / 255.0))
        return self.emit_color(final)

    def hex_entered(self, entry):
        text = entry.get_text().strip()
        if text and not text.startswith("#"):
            text = "#" + text
        if not self.set_hex(text, True):
            self.paint()
        return False

    def choose_none(self, _b):
        self.on_change(None)
        self.popdown()


# ---------------------------------------------------------------- choices (labels as in the web app)

KINDS = [("flat", "Flat"), ("extrude", "Extrude"), ("revolve", "Revolve"), ("inflate", "Inflate")]
TABS = [("view", "View", "orbit"), ("shape", "Shape", "cube"), ("surface", "Surface", "sparkle"), ("colors", "Colors", "palette"),
        ("light", "Light", "light"), ("outline", "Outline", "shadow"), ("style", "Style", "sliders")]
PRESET_NAMES = [("front", "Front"), ("offaxis", "Off-axis"), ("offaxis-l", "Off-axis left"), ("hero", "Low angle"),
                ("iso-l", "Isometric left"), ("iso-r", "Isometric right"), ("iso-t", "Isometric top"), ("top", "Top down"),
                ("turn-l", "Turned left"), ("turn-r", "Turned right"), ("tilt", "Tilted back"), ("dimetric", "Dimetric")]
MATERIALS = [("glossy", "Glossy", None), ("clay", "Clay", None), ("toon", "Toon", None), ("poster", "Poster", None),
             ("chrome", "Chrome", "#c3cad6"), ("gold", "Gold", "#e2b44a"), ("copper", "Copper", "#d27b52"),
             ("lineart", "Line art", None), ("wire", "Wireframe", None), ("flat", "Flat color", None)]
BEVEL_NAMES = [("none", "None"), ("classic", "Classic"), ("round", "Round"), ("cove", "Cove"), ("ogee", "Ogee"),
               ("step", "Step"), ("chisel", "Chisel")]
SHADINGS = [("plastic", "Glossy"), ("matte", "Matte"), ("toon", "Toon"), ("metal", "Metal"), ("flat", "Flat"),
            ("lineart", "Line art"), ("wire", "Wireframe")]
PROFILES = [("round", "Round"), ("pillow", "Pillow"), ("dome", "Dome"), ("soft", "Soft"), ("cone", "Sharp")]
PLAIN_SHADINGS = ("flat", "lineart", "wire")
CAMERA_TURN = ("rx", "ry", "rz")
OBJECT_TURN = ("obj_rx", "obj_ry", "obj_rz")
UI_ONLY = ("shared_light", "turn_mode")  # window settings that are never written to the objects
LOGO = os.path.join(os.path.dirname(os.path.abspath(__file__)), "vector3dit_logo.png")


def placement_shown(s):
    """The object's own turn and push back apply inside a scene camera (and stay visible while they're in use)."""
    return bool(s.get("camera")) or any(s.get(k) for k in OBJECT_TURN + ("obj_push",))


def object_mode(s):
    return s.get("turn_mode") == "object" and placement_shown(s)


def turn_keys(s):
    return OBJECT_TURN if object_mode(s) else CAMERA_TURN


def to_rgba(hex_color):
    c = Gdk.RGBA()
    if not c.parse(hex_color or "#808080"):
        c.parse("#808080")
    return c


def label(text, cls=None, xalign=0.0, wrap=False, width=None):
    lab = Gtk.Label(label=text, xalign=xalign)
    if cls:
        for c in cls.split():
            lab.get_style_context().add_class(c)
    if wrap:
        lab.set_line_wrap(True)
        lab.set_max_width_chars(width or 40)
    return lab


def styled(widget, *classes):
    for c in classes:
        widget.get_style_context().add_class(c)
    return widget


# ---------------------------------------------------------------- the window

class EditorWindow(Gtk.Window):
    def __init__(self, init, render_cb, context, pages, cube_color, count):
        super().__init__(title="Vector 3Dit · 3D Editor")
        self.state = dict(init)
        self.state.setdefault("shared_light", True)
        self.state.setdefault("cameras", {})
        self.state.setdefault("camera", "")
        self.state.setdefault("turn_mode", "camera")
        self.touched = set()
        self.render_cb = render_cb
        self.context = context
        self.pages = pages
        self.cube_color = cube_color
        self.outs = []
        self.result = None
        self.drag = None
        self.pan = None
        self.view = None
        self._syncing = False
        self._idle = None
        self._full = None
        self._context_cache = None
        self._redraw_id = None
        self._size = (0, 0)
        self.bind = {}    # key -> [setter(value)] that update widgets without feedback
        self.rules = []   # (widget, predicate(state)) for controls that only apply sometimes
        self.icons = []   # (image, icon name, button) repainted when a toggle changes state
        self.color_buttons = {}
        self.color_popover = None
        for item in self.context:
            item["d"] = "".join("M" + "L".join("%s %s" % (f(x), f(y)) for x, y in pts) + ("Z" if closed else "")
                                for pts, closed in item["subs"] if len(pts) > 1)

        settings = Gtk.Settings.get_default()
        if settings is not None:
            settings.set_property("gtk-application-prefer-dark-theme", True)
        provider = Gtk.CssProvider()
        provider.load_from_data(CSS)
        Gtk.StyleContext.add_provider_for_screen(Gdk.Screen.get_default(), provider, Gtk.STYLE_PROVIDER_PRIORITY_USER)
        styled(self, "v3d")

        width, height = 1180, 780
        try:  # fit smaller laptop screens
            display = Gdk.Display.get_default()
            monitor = display.get_primary_monitor() or display.get_monitor(0)
            area = monitor.get_workarea()
            width, height = min(width, area.width - 40), min(height, area.height - 60)
        except Exception:  # noqa: BLE001
            pass
        self.set_default_size(max(900, width), max(560, height))
        if os.path.exists(LOGO):
            try:
                self.set_icon_from_file(LOGO)
            except GLib.Error:
                pass
        self.set_position(Gtk.WindowPosition.CENTER)
        self.set_keep_above(True)
        self.connect("delete-event", lambda *a: self.finish(False) or True)
        self.connect("key-press-event", self.on_key)

        root = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL)
        self.add(root)
        root.pack_start(self.build_preview(count), True, True, 0)
        root.pack_start(Gtk.Separator(orientation=Gtk.Orientation.VERTICAL), False, False, 0)
        root.pack_start(self.build_panel(), False, False, 0)

        self.sync_all()
        self.render(draft=False)

    # ---- building blocks
    def icon_button(self, button, name, text, size, box_orientation=Gtk.Orientation.VERTICAL):
        box = Gtk.Box(orientation=box_orientation, spacing=2 if box_orientation == Gtk.Orientation.VERTICAL else 6)
        img = Gtk.Image()
        img.set_halign(Gtk.Align.CENTER)
        box.pack_start(img, False, False, 0)
        box.pack_start(label(text, xalign=0.5), False, False, 0)
        box.set_halign(Gtk.Align.CENTER)
        button.add(box)
        self.icons.append((img, name, button, size))
        return button

    def paint_icons(self):
        for img, name, button, size in self.icons:
            ctx = button.get_style_context()
            if ctx.has_class("tab"):
                color = T["accent_text"] if button.get_active() else T["muted"]
            elif isinstance(button, Gtk.ToggleButton):
                color = T["accent_ink"] if button.get_active() else T["text2"]
            else:
                color = T["text"]
            img.set_from_pixbuf(svg_pixbuf(icon_svg(name, color, size)))

    def page(self):
        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=9)
        return styled(box, "page")

    def row(self, text, widget):
        box = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
        lab = label(text)
        lab.set_size_request(84, -1)
        lab.set_ellipsize(3)
        box.pack_start(lab, False, False, 0)
        widget.set_hexpand(True)
        box.pack_start(widget, True, True, 0)
        return box

    def slider(self, key, text, lo, hi, step=1.0, unit="", axis=None, tip=None):
        box = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
        lab = label(text)
        lab.set_size_request(84, -1)
        if axis:
            lab.set_markup('<span foreground="%s">%s</span>' % (T[axis], text))
        box.pack_start(lab, False, False, 0)
        value = float(self.state.get(key, lo) or 0)
        digits = 0 if step >= 1 else 1
        adj = Gtk.Adjustment(value=value, lower=min(lo, value), upper=max(hi, value), step_increment=step,
                             page_increment=step * 10)
        scale = Gtk.Scale(orientation=Gtk.Orientation.HORIZONTAL, adjustment=adj)
        scale.set_draw_value(False)
        scale.set_hexpand(True)
        if axis:
            styled(scale, "ax-" + axis)
        spin = Gtk.SpinButton(adjustment=adj, climb_rate=1, digits=digits)
        spin.set_width_chars(4)
        spin.set_numeric(True)
        box.pack_start(scale, True, True, 0)
        box.pack_start(spin, False, False, 0)
        u = label(unit)
        u.set_size_request(14, -1)
        box.pack_start(u, False, False, 0)
        adj.connect("value-changed", lambda a: self.on_widget(key, a.get_value()))
        self.bind.setdefault(key, []).append(lambda v: v is not None and adj.set_value(float(v)))
        if tip:
            box.set_tooltip_text(tip)
        return box

    def toggle(self, key, text, tip=None, getter=None, setter=None):
        box = styled(Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=9), "toggle")
        sw = Gtk.Switch()
        sw.set_valign(Gtk.Align.CENTER)
        box.pack_start(sw, False, False, 0)
        box.pack_start(label(text), False, False, 0)
        get = getter or (lambda v: bool(v))
        sw.connect("notify::active", lambda s, _p: self.on_widget(key, setter(s.get_active()) if setter else s.get_active()))
        self.bind.setdefault(key, []).append(lambda v: sw.set_active(get(v)))
        if tip:
            box.set_tooltip_text(tip)
        return box

    def seg(self, key, options, cls=None, icons=False):
        box = styled(Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=2, homogeneous=True), "seg")
        if cls:
            styled(box, cls)
        buttons = {}
        for value, text, *rest in options:
            b = Gtk.ToggleButton()
            if icons:
                self.icon_button(b, rest[0], text, 20)
            else:
                b.add(label(text, xalign=0.5))
            if rest and not icons and rest[0]:
                b.set_tooltip_text(rest[0])
            b.connect("toggled", self.on_seg, key, value, buttons)
            box.pack_start(b, True, True, 0)
            buttons[value] = b

        def set_value(v):
            for val, b in buttons.items():
                b.set_active(val == v)

        self.bind.setdefault(key, []).append(set_value)
        return box

    def on_seg(self, button, key, value, buttons):
        if self._syncing:
            return
        if not button.get_active():  # keep one pressed
            if self.state.get(key) == value:
                self._syncing = True
                button.set_active(True)
                self._syncing = False
            return
        self.on_widget(key, value)

    def select(self, key, options):
        combo = Gtk.ComboBoxText()
        for value, text in options:
            combo.append(value, text)
        combo.connect("changed", lambda c: c.get_active_id() and self.on_widget(key, c.get_active_id()))
        self.bind.setdefault(key, []).append(lambda v: combo.set_active_id(str(v)))
        return combo

    def color(self, key, text, auto=False, fallback="fill", tip=None, allow_none=False):
        btn = styled(Gtk.Button(), "swatch")
        box = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
        chip = Gtk.Image()
        txt = label("", xalign=0)
        box.pack_start(chip, False, False, 0)
        box.pack_start(txt, True, True, 0)
        btn.add(box)
        btn.set_hexpand(True)
        if tip:
            btn.set_tooltip_text(tip)

        def show(v):
            if v:
                chip.set_from_pixbuf(svg_pixbuf(chip_svg(v)))
                txt.set_text(v.upper())
            elif allow_none:
                chip.set_from_pixbuf(svg_pixbuf(chip_svg(None, none=True)))
                txt.set_text("None")
            else:
                chip.set_from_pixbuf(svg_pixbuf(chip_svg(self.state.get(fallback) or self.state.get("fill") or "#888888")))
                txt.set_text("Auto")

        def pick(_b):
            start = self.value_for(key) or self.state.get(fallback) or self.state.get("fill") or "#888888"
            pop = ColorPopover(btn, text, start, allow_none, lambda v: self.on_widget(key, v), lambda v: self.on_widget(key, v))
            self.color_popover = pop
            pop.popup()

        btn.connect("clicked", pick)
        self.color_buttons.setdefault(key, btn)
        self.bind.setdefault(key, []).append(show)
        row = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=6)
        row.pack_start(btn, True, True, 0)
        if auto:
            reset = styled(Gtk.Button(label="Auto"), "btn", "small", "ghost")
            reset.set_tooltip_text("Use the automatic color")
            reset.connect("clicked", lambda _b: self.on_widget(key, None))
            row.pack_start(reset, False, False, 0)
            self.rules.append((reset, lambda s, k=key: bool(s.get(k))))
        return self.row(text, row)

    def tip(self, text):
        box = styled(Gtk.Box(), "tip")
        box.pack_start(label(text, wrap=True, width=46), True, True, 0)
        return box

    def sub(self, text):
        return label(text.upper(), "sub-label")

    def tiles(self, items, per_line, on_click):
        grid = Gtk.Grid(column_spacing=4, row_spacing=4, column_homogeneous=True)
        for i, (key, text, image) in enumerate(items):
            b = styled(Gtk.Button(), "tile")
            b.set_tooltip_text(text)
            box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=3)
            box.pack_start(image, False, False, 0)
            box.pack_start(label(text, xalign=0.5), False, False, 0)
            b.add(box)
            b.connect("clicked", lambda _b, k=key: on_click(k))
            grid.attach(b, i % per_line, i // per_line, 1, 1)
        return grid

    def when(self, widget, predicate):
        self.rules.append((widget, predicate))
        return widget

    # ---- layout
    def build_preview(self, count):
        left = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
        bar = styled(Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8), "preview-bar")
        if os.path.exists(LOGO):
            try:
                bar.pack_start(Gtk.Image.new_from_pixbuf(GdkPixbuf.Pixbuf.new_from_file_at_size(LOGO, 22, 22)), False, False, 0)
            except GLib.Error:
                pass
        bar.pack_start(label("Vector 3Dit", "brand"), False, False, 0)
        self.status = label("%d object%s · drag to turn · right-drag to pan · scroll to zoom"
                            % (count, "" if count == 1 else "s"), "muted")
        self.status.set_ellipsize(3)
        bar.pack_start(self.status, True, True, 0)
        self.show_ctx = Gtk.CheckButton(label="Other objects")
        self.show_ctx.set_active(True)
        self.show_ctx.set_tooltip_text("Show the rest of the drawing, faded, to help with placement")
        self.show_ctx.connect("toggled", lambda *_: self.queue_preview())
        bar.pack_start(self.show_ctx, False, False, 4)
        self.full_ctx = Gtk.CheckButton(label="Full color")
        self.full_ctx.set_active(False)
        self.full_ctx.set_tooltip_text("Show the rest of the drawing in its real colors instead of faded")
        self.full_ctx.connect("toggled", lambda *_: self.queue_preview())
        self.show_ctx.connect("toggled", lambda b: self.full_ctx.set_sensitive(b.get_active()))
        bar.pack_start(self.full_ctx, False, False, 4)
        for text, what in (("Fit selection", "sel"), ("Fit page", "page")):
            b = styled(Gtk.Button(label=text), "btn", "small")
            b.connect("clicked", lambda _b, w=what: self.fit(w))
            bar.pack_start(b, False, False, 0)
        left.pack_start(bar, False, False, 0)
        # The preview is an image inside a Layout, so the image never forces the window's size.
        self.preview = Gtk.EventBox()
        self.canvas = Gtk.Layout()
        self.canvas.set_size_request(420, 360)
        self.image = Gtk.Image()
        self.canvas.put(self.image, 0, 0)
        self.preview.add(self.canvas)
        self.preview.add_events(Gdk.EventMask.BUTTON_PRESS_MASK | Gdk.EventMask.BUTTON_RELEASE_MASK |
                                Gdk.EventMask.POINTER_MOTION_MASK | Gdk.EventMask.SCROLL_MASK |
                                Gdk.EventMask.SMOOTH_SCROLL_MASK)
        self.preview.connect("button-press-event", self.on_preview_press)
        self.preview.connect("motion-notify-event", self.on_preview_motion)
        self.preview.connect("button-release-event", self.on_preview_release)
        self.preview.connect("scroll-event", self.on_scroll)
        self.canvas.connect("size-allocate", self.on_canvas_size)
        left.pack_start(self.preview, True, True, 0)
        return left

    def build_panel(self):
        panel = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
        panel.set_size_request(372, -1)
        panel.set_hexpand(False)  # stretchy sliders inside must not make the panel take the preview's space

        head = styled(Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=10), "panel-head")
        head.pack_start(self.seg("kind", [(k, t, k) for k, t in KINDS], "kinds", icons=True), False, False, 0)
        panel.pack_start(head, False, False, 0)

        tabs = styled(Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=2, homogeneous=True), "tabs")
        self.stack = Gtk.Stack()
        self.stack.set_transition_type(Gtk.StackTransitionType.NONE)
        self.tab_buttons = {}
        builders = {"view": self.build_view, "shape": self.build_shape, "surface": self.build_surface,
                    "colors": self.build_colors, "light": self.build_light, "outline": self.build_outline,
                    "style": self.build_style}
        for key, text, icon in TABS:
            b = styled(Gtk.ToggleButton(), "tab")
            self.icon_button(b, icon, text, 19)
            b.connect("toggled", self.on_tab, key)
            tabs.pack_start(b, True, True, 0)
            self.tab_buttons[key] = b
            scroll = Gtk.ScrolledWindow()
            scroll.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC)
            scroll.add(builders[key]())
            self.stack.add_named(scroll, key)
        panel.pack_start(tabs, False, False, 0)
        panel.pack_start(self.stack, True, True, 0)

        foot = styled(Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8), "footer")
        note = label("Changes apply to every selected object.", "muted", wrap=True, width=24)
        foot.pack_start(note, True, True, 0)
        cancel = styled(Gtk.Button(label="Cancel"), "btn")
        cancel.connect("clicked", lambda *_: self.finish(False))
        apply_btn = styled(Gtk.Button(label="Apply"), "btn", "primary")
        apply_btn.connect("clicked", lambda *_: self.finish(True))
        foot.pack_start(cancel, False, False, 0)
        foot.pack_start(apply_btn, False, False, 0)
        panel.pack_start(foot, False, False, 0)
        self._syncing = True
        self.tab_buttons["view"].set_active(True)
        self._syncing = False
        return panel

    def on_tab(self, button, key):
        if self._syncing:
            return
        if not button.get_active():
            if self.stack.get_visible_child_name() == key:
                self._syncing = True
                button.set_active(True)
                self._syncing = False
            return
        self.show_tab(key)

    def show_tab(self, key):
        self._syncing = True
        for k, b in self.tab_buttons.items():
            b.set_active(k == key)
        self._syncing = False
        self.stack.set_visible_child_name(key)
        self.paint_icons()

    def build_camera(self):
        """Saved scene cameras: lock several objects to one vantage point."""
        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=8)
        row = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=6)
        self.cam_combo = Gtk.ComboBoxText()
        self.cam_combo.set_tooltip_text("Lock the selected objects to a saved camera, so they share one vantage point")
        self.cam_combo.connect("changed", self.on_camera_combo)
        row.pack_start(self.cam_combo, True, True, 0)

        save = styled(Gtk.MenuButton(), "btn", "small")
        save.add(label("Save…", xalign=0.5))
        save.set_tooltip_text("Save the current view as a camera and lock the selected objects to it")
        pop = Gtk.Popover()
        styled(pop, "v3d-pop")
        form = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=8)
        for m in ("start", "end", "top", "bottom"):
            getattr(form, "set_margin_" + m)(6)
        form.pack_start(label("Save as camera", "cp-title"), False, False, 0)
        self.cam_name = Gtk.Entry()
        self.cam_name.set_placeholder_text("Camera name, e.g. Street view")
        self.cam_name.set_width_chars(24)
        form.pack_start(self.cam_name, False, False, 0)
        form.pack_start(label("Turn everything around", "sub-label"), False, False, 0)
        self.cam_around = Gtk.ComboBoxText()
        self.cam_around.append("page", "The page's center")
        self.cam_around.append("selection", "The selection's center")
        self.cam_around.set_active_id("page")
        form.pack_start(self.cam_around, False, False, 0)
        ok = styled(Gtk.Button(label="Save camera"), "btn", "primary")

        def do_save(*_):
            name = self.cam_name.get_text().strip()
            if name:
                self.save_camera(name, self.cam_around.get_active_id() or "page")
                pop.popdown()

        ok.connect("clicked", do_save)
        self.cam_name.connect("activate", do_save)
        form.pack_start(ok, False, False, 0)
        form.show_all()
        pop.add(form)
        save.set_popover(pop)
        self.cam_save_button = save
        row.pack_start(save, False, False, 0)

        delete = styled(Gtk.Button(label="Delete"), "btn", "small", "ghost")
        delete.set_tooltip_text("Delete this camera. Objects locked to it keep their current look.")
        delete.connect("clicked", lambda *_: self.delete_camera())
        row.pack_start(self.when(delete, lambda s: bool(s.get("camera"))), False, False, 0)
        box.pack_start(self.row("Camera", row), False, False, 0)
        self.cam_note = label("", wrap=True, width=46)
        note = styled(Gtk.Box(), "tip")
        note.pack_start(self.cam_note, True, True, 0)
        box.pack_start(self.when(note, lambda s: bool(s.get("camera"))), False, False, 0)
        self.refresh_cameras()
        return box

    def refresh_cameras(self):
        self._syncing = True
        self.cam_combo.remove_all()
        self.cam_combo.append("", "Own view (not locked)")
        for name in sorted(self.state.get("cameras") or {}):
            self.cam_combo.append(name, "Locked: " + name)
        self.cam_combo.set_active_id(self.state.get("camera") or "")
        self._syncing = False
        name = self.state.get("camera")
        if name:
            self.cam_note.set_text("Locked to the camera \u201c%s\u201d. Every object locked to it is seen from the same "
                                   "point, with the same angles and perspective. Turning the scene camera turns them all; "
                                   "pick This object to turn or push back only the selection." % name)

    def on_camera_combo(self, combo):
        if self._syncing:
            return
        name = combo.get_active_id() or ""
        cam = (self.state.get("cameras") or {}).get(name)
        values = {"camera": name}
        if cam:
            values.update({k: cam[k] for k in ("rx", "ry", "rz", "persp")})
        self.set_values(values)
        self.refresh_cameras()

    def save_camera(self, name, around):
        cams = self.state.setdefault("cameras", {})
        cams[name] = {"rx": self.state["rx"], "ry": self.state["ry"], "rz": self.state["rz"], "persp": self.state["persp"],
                      "pivot": list(self.state["camera_places"][around]), "reach": self.state["camera_reach"]}
        self.touched.add("cameras")
        self.set_values({"camera": name})
        self.refresh_cameras()

    def delete_camera(self):
        name = self.state.get("camera")
        if not name:
            return
        (self.state.get("cameras") or {}).pop(name, None)
        self.touched.add("cameras")
        self.set_values({"camera": ""})
        self.refresh_cameras()

    def build_view(self):
        page = self.page()
        page.pack_start(self.build_camera(), False, False, 0)
        turn = self.seg("turn_mode", [("camera", "Scene camera", "Turn the camera: every object locked to it turns along"),
                                      ("object", "This object", "Turn only the selected objects, inside the scene")])
        page.pack_start(self.when(self.row("Turn", turn), placement_shown), False, False, 0)
        row = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=12)
        self.trackball = Trackball(self)
        row.pack_start(self.trackball, False, False, 0)
        side = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=6)
        side.pack_start(label("Drag the cube to turn the object. Shift locks one axis, Alt spins it flat.", "muted",
                              wrap=True, width=22), False, False, 0)
        face = styled(Gtk.Button(), "btn", "small")
        self.icon_button(face, "rotCCW", "Face front", 16, Gtk.Orientation.HORIZONTAL)
        face.set_tooltip_text("Reset rotation")
        face.connect("clicked", lambda *_: self.set_rotation(0, 0, 0))
        face.set_halign(Gtk.Align.START)
        side.pack_start(face, False, False, 0)
        side.set_valign(Gtk.Align.CENTER)
        row.pack_start(side, True, True, 0)
        page.pack_start(row, False, False, 0)
        for keys, pred in ((CAMERA_TURN, lambda s: not object_mode(s)), (OBJECT_TURN, object_mode)):
            for key, text, axis, tip in zip(keys, ("Tilt", "Turn", "Spin"), "xyz",
                                            ("Rotate around the horizontal axis (X)", "Rotate around the vertical axis (Y)",
                                             "Rotate within the drawing plane (Z)")):
                page.pack_start(self.when(self.slider(key, text, -180, 180, 1, "°", axis, tip), pred), False, False, 0)
        page.pack_start(self.slider("persp", "Perspective", 0, 160, 1, "°",
                                    tip="Camera field of view. 0 = no perspective (parallel lines stay parallel)."), False, False, 0)
        page.pack_start(self.when(self.slider("obj_push", "Push back", -1000, 1000, 1, "px",
                                              tip="Move the selected objects deeper into the scene (below 0: toward you), "
                                                  "without moving the camera. It shows with Perspective above 0."),
                                  placement_shown), False, False, 0)
        page.pack_start(self.sub("Preset views"), False, False, 0)
        items = [(k, t, svg_image('<svg %s width="30" height="30" viewBox="0 0 30 30">%s</svg>'
                                  % (SVG_NS, cube_markup(*E.PRESETS[k], 30)))) for k, t in PRESET_NAMES]
        page.pack_start(self.tiles(items, 4, lambda k: self.set_rotation(*E.PRESETS[k])), False, False, 0)
        return page

    def build_shape(self):
        page = self.page()
        self.shape_stack = Gtk.Stack()
        self.shape_stack.set_vhomogeneous(False)
        self.shape_stack.set_transition_type(Gtk.StackTransitionType.NONE)
        has_bevel = lambda s: s.get("bevel", "none") != "none"  # noqa: E731

        ex = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=9)
        ex.pack_start(self.slider("depth", "Depth", 0, 1000, 1, "px"), False, False, 0)
        ex.pack_start(self.toggle("caps", "Solid (end caps)", "Turn off for a hollow tube"), False, False, 0)
        ex.pack_start(self.row("Bevel", self.bevel_picker()), False, False, 0)
        for w in (self.slider("bevel_w", "Bevel width", 0, 60, 0.5, "px"), self.slider("bevel_h", "Bevel height", 0, 60, 0.5, "px"),
                  self.row("Bevel on", self.seg("bevel_sides", [("front", "Front"), ("both", "Front & back")])),
                  self.row("Direction", self.seg("bevel_out", [(False, "Inward", "Carve the bevel into the shape"),
                                                               (True, "Outward", "Grow the bevel outside the shape")])),
                  self.slider("bevel_segs", "Smoothness", 1, 12, 1)):
            ex.pack_start(self.when(w, has_bevel), False, False, 0)
        self.shape_stack.add_named(ex, "extrude")

        rv = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=9)
        rv.pack_start(self.tip("The shape spins around a vertical axis. Draw half a profile (like half a vase) with its straight "
                               "side on the axis."), False, False, 0)
        rv.pack_start(self.row("Axis", self.seg("rev_axis", [("left", "Left edge"), ("center", "Center"), ("right", "Right edge")])),
                      False, False, 0)
        rv.pack_start(self.slider("rev_angle", "Angle", 1, 360, 1, "°"), False, False, 0)
        rv.pack_start(self.slider("rev_offset", "Offset", 0, 300, 1, "px",
                                  tip="Distance from the axis — makes rings and hollow shapes"), False, False, 0)
        rv.pack_start(self.slider("rev_segs", "Segments", 6, 128, 1, tip="More segments = smoother, larger file"), False, False, 0)
        rv.pack_start(self.when(self.toggle("rev_caps", "Cap the cut ends"), lambda s: float(s.get("rev_angle", 360)) < 360),
                      False, False, 0)
        self.shape_stack.add_named(rv, "revolve")

        inf = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=9)
        inf.pack_start(self.slider("inf_height", "Puffiness", 0, 1000, 1, "px"), False, False, 0)
        inf.pack_start(self.row("Profile", self.select("inf_profile", PROFILES)), False, False, 0)
        inf.pack_start(self.slider("inf_spread", "Roundness", 5, 100, 1, "%",
                                   tip="How far in from the edge the surface keeps rising"), False, False, 0)
        inf.pack_start(self.row("Sides", self.seg("inf_sides", [("both", "Both sides"), ("front", "Front only")])), False, False, 0)
        inf.pack_start(self.slider("inf_detail", "Detail", 12, 120, 1,
                                   tip="Mesh resolution. Higher is smoother but slower and larger"), False, False, 0)
        self.shape_stack.add_named(inf, "inflate")

        fl = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=9)
        fl.pack_start(self.tip("Flat keeps the artwork paper-thin — tilt it with the view controls to lay it on a floor, wall or "
                               "box side."), False, False, 0)
        self.shape_stack.add_named(fl, "flat")
        page.pack_start(self.shape_stack, False, False, 0)
        return page

    def bevel_picker(self):
        btn = styled(Gtk.MenuButton(), "bevel-btn")
        self.bevel_button = btn
        box = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
        thumb = Gtk.Image()
        name = label("", xalign=0)
        chev = Gtk.Image.new_from_pixbuf(svg_pixbuf(icon_svg("chevDown", T["muted"], 14)))
        box.pack_start(thumb, False, False, 0)
        box.pack_start(name, True, True, 0)
        box.pack_start(chev, False, False, 0)
        btn.add(box)
        pop = Gtk.Popover()
        styled(pop, "v3d-pop")
        grid = Gtk.Grid(column_spacing=4, row_spacing=4)
        tiles = {}
        for i, (key, text) in enumerate(BEVEL_NAMES):
            b = styled(Gtk.ToggleButton(), "tile")
            b.set_size_request(64, -1)
            v = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=2)
            v.pack_start(svg_image(bevel_thumb(key, 36)), False, False, 0)
            v.pack_start(label(text, xalign=0.5), False, False, 0)
            b.add(v)

            def chosen(tb, k=key):
                if self._syncing or not tb.get_active():
                    return
                pop.popdown()
                self.on_widget("bevel", k)

            b.connect("toggled", chosen)
            grid.attach(b, i % 4, i // 4, 1, 1)
            tiles[key] = b
        grid.show_all()
        pop.add(grid)
        btn.set_popover(pop)

        def show(v):
            v = v or "none"
            thumb.set_from_pixbuf(svg_pixbuf(bevel_thumb(v, 28)))
            name.set_text("No bevel" if v == "none" else dict(BEVEL_NAMES).get(v, v))
            for k, b in tiles.items():
                b.set_active(k == v)

        self.bind.setdefault("bevel", []).append(show)
        return btn

    def build_surface(self):
        page = self.page()
        items = [(k, t, svg_image(material_ball(k, fill or T["mat_base"]))) for k, t, fill in MATERIALS]
        page.pack_start(self.tiles(items, 5, self.apply_material), False, False, 0)
        page.pack_start(self.row("Shading", self.select("shading", SHADINGS)), False, False, 0)
        shaded = lambda s: s.get("shading") not in PLAIN_SHADINGS  # noqa: E731
        page.pack_start(self.when(self.toggle("smooth", "Smooth gradients",
                                              "Draw curved surfaces with vector gradients instead of flat facets"), shaded),
                        False, False, 0)
        page.pack_start(self.when(self.slider("steps", "Color bands", 0, 10, 1,
                                              tip="0 = continuous shading. 2–6 gives a poster / cel look."), shaded), False, False, 0)
        page.pack_start(self.when(self.slider("smooth_angle", "Smoothing angle", 0, 90, 1, "°",
                                              tip="Edges sharper than this stay crisp"), shaded), False, False, 0)
        return page

    def build_colors(self):
        page = self.page()
        page.pack_start(self.color("fill", "Front", tip="Main color (the shape's fill)"), False, False, 0)
        page.pack_start(self.when(self.color("side_color", "Sides", auto=True,
                                             tip="Color of the extruded sides (Auto = same as front)"),
                                  lambda s: s.get("kind") in ("extrude", "revolve")), False, False, 0)
        page.pack_start(self.when(self.color("bevel_color", "Bevel", auto=True, fallback="side_color",
                                             tip="Color of the bevel (Auto = same as sides)"),
                                  lambda s: s.get("kind") == "extrude" and s.get("bevel", "none") != "none"), False, False, 0)
        page.pack_start(self.color("back_color", "Back", auto=True, tip="Color of the back face"), False, False, 0)
        shaded = lambda s: s.get("shading") not in PLAIN_SHADINGS  # noqa: E731
        tone = self.seg("shadow_tone", [("auto", "Tinted", "Shadows shift toward a deep cool tone of the base color"),
                                        ("black", "Black", None), ("custom", "Custom", None)])
        page.pack_start(self.when(self.row("Shadow tone", tone), shaded), False, False, 0)
        page.pack_start(self.when(self.color("shadow_tint", "Shadow color"),
                                  lambda s: shaded(s) and s.get("shadow_tint") not in ("auto", "black", None)), False, False, 0)
        page.pack_start(self.when(self.color("highlight", "Highlight", tip="Color of the brightest spots"), shaded),
                        False, False, 0)
        return page

    def build_light(self):
        page = self.page()
        page.pack_start(self.toggle("shared_light", "Shared scene light",
                                    "On: every 3D object in the drawing gets this light, so the scene looks consistent"),
                        False, False, 0)
        row = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=12)
        self.light_sphere = LightSphere(self)
        row.pack_start(self.light_sphere, False, False, 0)
        side = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=6)
        self.light_note = label("", "muted", wrap=True, width=22)
        side.pack_start(self.light_note, False, False, 0)
        side.set_valign(Gtk.Align.CENTER)
        row.pack_start(side, True, True, 0)
        page.pack_start(row, False, False, 0)
        for key, text, hi, tip, unit in (("light_intensity", "Intensity", 200, "Strength of the main light", "%"),
                                         ("light_ambient", "Ambient", 100, "Light that reaches every side", "%"),
                                         ("light_fill", "Fill light", 100, "A soft second light from the opposite side", "%"),
                                         ("light_specular", "Highlight", 150, "Brightness of shiny highlights", "%"),
                                         ("light_gloss", "Gloss", 100, "Smaller, sharper highlights", "")):
            page.pack_start(self.slider(key, text, 0, hi, 1, unit, tip=tip), False, False, 0)
        return page

    def build_outline(self):
        page = self.page()
        page.pack_start(self.row("Edge lines", self.seg("edges", [("none", "None", None),
                                                                  ("outline", "Outline", "Silhouette and sharp edges"),
                                                                  ("all", "All", "Every facet edge")])), False, False, 0)
        lines = lambda s: s.get("edges") != "none" or s.get("shading") in ("lineart", "wire")  # noqa: E731
        page.pack_start(self.when(self.color("edge_color", "Line color"), lines), False, False, 0)
        page.pack_start(self.when(self.slider("edge_width", "Line width", 0.2, 8, 0.1, "px"), lines), False, False, 0)
        page.pack_start(self.when(self.slider("crease_angle", "Crease angle", 5, 120, 1, "°",
                                              tip="Only edges sharper than this get a line"), lines), False, False, 0)
        page.pack_start(self.row("Shadow", self.seg("shadow", [("none", "None", None),
                                                               ("drop", "Cast", "Shadow cast onto the page by the light"),
                                                               ("floor", "Floor", "Soft contact shadow underneath")])),
                        False, False, 0)
        shadow = lambda s: s.get("shadow") != "none"  # noqa: E731
        page.pack_start(self.when(self.slider("shadow_opacity", "Opacity", 0, 100, 1, "%"), shadow), False, False, 0)
        page.pack_start(self.when(self.slider("shadow_blur", "Softness", 0, 40, 0.5, "px"), shadow), False, False, 0)
        page.pack_start(self.when(self.slider("shadow_dist", "Distance", 0, 300, 1, "px"), lambda s: s.get("shadow") == "drop"),
                        False, False, 0)
        page.pack_start(self.when(self.color("shadow_color", "Shadow"), shadow), False, False, 0)
        return page

    def build_style(self):
        page = self.page()
        page.pack_start(self.sub("Fill"), False, False, 0)
        page.pack_start(self.color("fill", "Fill", tip="The shape's color (the front of the 3D object)"), False, False, 0)
        page.pack_start(self.sub("Stroke"), False, False, 0)
        page.pack_start(self.color("stroke", "Stroke", allow_none=True,
                                   tip="Lines around the 3D object: its outline and sharp edges. None removes them."),
                        False, False, 0)
        stroked = lambda s: s.get("edges") not in (None, "none")  # noqa: E731
        page.pack_start(self.when(self.slider("edge_width", "Width", 0.2, 8, 0.1, "px"), stroked), False, False, 0)
        page.pack_start(self.when(self.row("Draw on", self.seg("edges", [("outline", "Outline", "Silhouette and sharp edges"),
                                                                      ("all", "All edges", "Every facet edge")])), stroked),
                        False, False, 0)
        page.pack_start(self.when(self.slider("crease_angle", "Crease angle", 5, 120, 1, "°",
                                              tip="Only edges sharper than this get a line"),
                                  lambda s: s.get("edges") == "outline"), False, False, 0)
        page.pack_start(self.sub("Opacity"), False, False, 0)
        page.pack_start(self.slider("opacity", "Opacity", 0, 100, 1, "%"), False, False, 0)
        page.pack_start(self.sub("Names"), False, False, 0)
        page.pack_start(self.tip("Every part of the result is named for what it is, its color and where it sits, like "
                                 "\u201cFill - Light Blue - Front\u201d or \u201cLine - Black - Top\u201d. Fills and lines are "
                                 "kept in separate groups. Find them under Object \u203a Layers and Objects."), False, False, 0)
        page.pack_start(self.row("Colors as", self.seg("name_colors", [("names", "Names", "Like \u201cLight Blue\u201d"),
                                                                       ("cmyk", "CMYK codes", "Like \u201cC75 M49 Y0 K5\u201d")])),
                        False, False, 0)
        return page

    # ---- state
    def on_widget(self, key, value):
        if not self._syncing:
            self.set_values({key: value})
        return False

    def set_values(self, values):
        values = dict(values)
        if "stroke" in values:  # Style › Stroke edits the edge lines
            stroke = values.pop("stroke")
            if stroke:
                values["edge_color"] = stroke
                if self.state.get("edges") in (None, "none"):
                    values["edges"] = "outline"
            else:
                values["edges"] = "none"
        if "shadow_tone" in values:  # the Tinted / Black / Custom buttons edit shadow_tint
            tone = values.pop("shadow_tone")
            values["shadow_tint"] = tone if tone in ("auto", "black") else (
                self.state.get("shadow_tint") if self.state.get("shadow_tint") not in ("auto", "black", None) else "#2a2350")
        for key, value in values.items():
            self.state[key] = value
            if key not in UI_ONLY:
                self.touched.add(key)
        cam = (self.state.get("cameras") or {}).get(self.state.get("camera") or "")
        if cam is not None and any(k in values for k in ("rx", "ry", "rz", "persp")):
            cam.update({k: self.state[k] for k in ("rx", "ry", "rz", "persp")})  # turning a locked object turns the camera
            self.touched.add("cameras")
        keys = set(values)
        if keys & {"edges", "edge_color"}:
            keys.add("stroke")
        if "shadow_tint" in keys:
            keys.add("shadow_tone")
        if "fill" in keys:  # Auto colors show the front color
            keys.update(("side_color", "bevel_color", "back_color"))
        if "side_color" in keys:
            keys.add("bevel_color")
        self.sync(keys)
        if "kind" in values:
            self.shape_stack.set_visible_child_name(values["kind"])
        self.changed()

    def value_for(self, key):
        if key == "stroke":
            return self.state.get("edge_color") if self.state.get("edges") not in (None, "none") else None
        if key == "shadow_tone":
            tint = self.state.get("shadow_tint")
            return tint if tint in ("auto", "black") else "custom"
        return self.state.get(key)

    def sync(self, keys):
        self._syncing = True
        try:
            for key in keys:
                for setter in self.bind.get(key, []):
                    setter(self.value_for(key))
        finally:
            self._syncing = False
        self.apply_rules()
        self.paint_icons()

    def apply_rules(self):
        for widget, predicate in self.rules:
            show = bool(predicate(self.state))
            widget.set_no_show_all(not show)
            if show:
                widget.show_all()
            else:
                widget.hide()
        shared = self.state.get("shared_light", True)
        self.light_note.set_text("Drag the sun. This light is shared by all 3D objects." if shared
                                 else "Drag the sun. This light only affects the selected objects.")

    def sync_all(self):
        self.sync(list(self.bind.keys()))
        self.shape_stack.set_visible_child_name(self.state["kind"])
        self.trackball.redraw()
        self.light_sphere.redraw()

    def apply_material(self, name):
        values = {"edges": "none", "steps": 0}
        values.update(E.MATERIALS.get(name, {}))
        self.set_values(values)

    def set_rotation(self, rx, ry, rz):
        """Sets the turn being edited: the camera's (or the object's own view), or the object's turn in its scene."""
        self.set_values(dict(zip(turn_keys(self.state), (wrap180(rx), wrap180(ry), wrap180(rz)))))

    def turn_matrix(self):
        return E.from_euler(*[float(self.state.get(k) or 0) for k in turn_keys(self.state)])

    def nudge(self, drx, dry):
        R = E.m_mul(E.m_mul(E.rot_x(drx), E.rot_y(dry)), self.turn_matrix())
        self.set_rotation(*E.to_euler(R))

    def begin_turn(self, x, y):
        self.drag = {"x": x, "y": y, "R0": self.turn_matrix()}
        return True

    def turn_to(self, x, y, mods, speed):
        if not self.drag:
            return False
        dx, dy = x - self.drag["x"], y - self.drag["y"]
        if mods & Gdk.ModifierType.SHIFT_MASK:
            if abs(dx) > abs(dy):
                dy = 0
            else:
                dx = 0
        if mods & Gdk.ModifierType.MOD1_MASK:
            Rd = E.rot_z(-dx * speed)
        else:
            Rd = E.m_mul(E.rot_x(dy * speed), E.rot_y(dx * speed))
        self.set_rotation(*E.to_euler(E.m_mul(Rd, self.drag["R0"])))
        return True

    def end_turn(self):
        self.drag = None
        return True

    def changed(self):
        self.trackball.redraw()
        self.light_sphere.redraw()
        if self._idle is None:
            self._idle = GLib.idle_add(self._draft)
        if self._full is not None:
            GLib.source_remove(self._full)
        self._full = GLib.timeout_add(220, self._final)

    def _draft(self):
        self._idle = None
        self.render(draft=True)
        return False

    def _final(self):
        self._full = None
        self.render(draft=False)
        return False

    def render(self, draft):
        self.outs = list(self.render_cb(self.state, self.touched, draft))
        self.redraw_preview()

    def finish(self, apply):
        self.result = (dict(self.state), set(self.touched)) if apply else None
        Gtk.main_quit()

    def on_key(self, _w, e):
        if e.keyval == Gdk.KEY_Escape:
            self.finish(False)
            return True
        if e.keyval in (Gdk.KEY_Return, Gdk.KEY_KP_Enter) and e.state & Gdk.ModifierType.CONTROL_MASK:
            self.finish(True)
            return True
        return False

    # ---- preview
    def sel_bounds(self):
        boxes = [out["bbox"] for out, _ in self.outs if out.get("bbox")]
        if not boxes:
            return None
        return [min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes)]

    def fit(self, what):
        W, H = self._size
        if W < 2 or H < 2:
            return
        b = None
        if what == "page" and self.pages:
            b = [min(p[0] for p in self.pages), min(p[1] for p in self.pages),
                 max(p[0] + p[2] for p in self.pages), max(p[1] + p[3] for p in self.pages)]
        if b is None:
            b = self.sel_bounds()
            if b is not None:
                w, h = b[2] - b[0], b[3] - b[1]
                m = max(w, h) * 0.35 + 1e-6
                b = [b[0] - m, b[1] - m, b[2] + m, b[3] + m]
        if b is None:
            return
        w, h = max(b[2] - b[0], 1e-6), max(b[3] - b[1], 1e-6)
        s = min((W - 40) / w, (H - 40) / h)
        self.view = [s, W / 2 - s * (b[0] + b[2]) / 2, H / 2 - s * (b[1] + b[3]) / 2]
        self.queue_preview()

    def on_canvas_size(self, _w, alloc):
        size = (alloc.width, alloc.height)
        if size == self._size:
            return
        first = self._size[0] < 2
        self._size = size
        if first or self.view is None:
            GLib.idle_add(lambda: self.fit("sel") and False)
        else:
            self.queue_preview()

    def on_scroll(self, _w, e):
        if not self.view:
            return False
        if e.direction == Gdk.ScrollDirection.SMOOTH:
            _ok, _dx, dy = e.get_scroll_deltas()
            k = math.pow(1.0015, -dy * 60)
        else:
            k = 1.15 if e.direction == Gdk.ScrollDirection.UP else 1 / 1.15 if e.direction == Gdk.ScrollDirection.DOWN else 1
        s, tx, ty = self.view
        self.view = [s * k, e.x - (e.x - tx) * k, e.y - (e.y - ty) * k]
        self.queue_preview()
        return True

    def on_preview_press(self, _w, e):
        if e.button == 1 and not (e.state & Gdk.ModifierType.CONTROL_MASK):
            return self.begin_turn(e.x, e.y)
        if self.view:
            self.pan = (e.x, e.y, self.view[1], self.view[2])
        return True

    def on_preview_motion(self, _w, e):
        if self.drag:
            return self.turn_to(e.x, e.y, e.state, 0.5)
        if self.pan:
            x0, y0, tx, ty = self.pan
            self.view[1], self.view[2] = tx + e.x - x0, ty + e.y - y0
            self.queue_preview()
            return True
        return False

    def on_preview_release(self, _w, e):
        self.pan = None
        return self.end_turn()

    def queue_preview(self):
        if self._redraw_id is None:
            self._redraw_id = GLib.idle_add(self._redraw_idle)

    def _redraw_idle(self):
        self._redraw_id = None
        self.redraw_preview()
        return False

    def viewbox(self):
        s, tx, ty = self.view
        W, H = self._size
        return '<svg %s width="%d" height="%d" viewBox="%s %s %s %s">' % (SVG_NS, W, H, f(-tx / s), f(-ty / s), f(W / s), f(H / s))

    def context_pixbuf(self):
        """Desk, pages and the rest of the drawing, cached until the view moves."""
        full = self.full_ctx.get_active()
        key = (self._size, tuple(self.view), self.show_ctx.get_active(), full)
        if self._context_cache and self._context_cache[0] == key:
            return self._context_cache[1]
        s, tx, ty = self.view
        W, H = self._size
        out = [self.viewbox(), '<rect x="%s" y="%s" width="%s" height="%s" fill="%s"/>'
               % (f(-tx / s - 1), f(-ty / s - 1), f(W / s + 2), f(H / s + 2), DESK)]
        for x, y, w, h in self.pages:
            out.append('<rect x="%s" y="%s" width="%s" height="%s" fill="#000000" fill-opacity="0.35"/>'
                       % (f(x + 2 / s), f(y + 3 / s), f(w), f(h)))
            out.append('<rect x="%s" y="%s" width="%s" height="%s" fill="#ffffff"/>' % (f(x), f(y), f(w), f(h)))
        if self.show_ctx.get_active() and self.context:
            out.append('<g opacity="%s" stroke-linejoin="round">' % ("1" if full else "0.32"))
            for item in self.context:
                if not item.get("d"):
                    continue
                fill = hexc(item["fill"]) if item.get("fill") else "none"
                attrs = ' fill="%s"' % fill
                if item.get("evenodd"):
                    attrs += ' fill-rule="evenodd"'
                if item.get("stroke"):
                    attrs += ' stroke="%s" stroke-width="%s"' % (hexc(item["stroke"]), f(max(item.get("width", 1.0), 0.6 / s)))
                    if item.get("dash"):
                        attrs += ' stroke-dasharray="%s %s"' % (f(4 / s), f(3 / s))
                out.append('<path d="%s"%s/>' % (item["d"], attrs))
            out.append("</g>")
        out.append("</svg>")
        pb = svg_pixbuf("".join(out))
        self._context_cache = (key, pb)
        return pb

    def redraw_preview(self):
        W, H = self._size
        if W < 2 or H < 2 or self.view is None:
            return
        base = self.context_pixbuf().copy()
        defs, groups = [], []
        for out, opacity in self.outs:
            if not out.get("body"):
                continue
            defs.extend(out.get("defs") or [])
            attrs = ' stroke-linejoin="round"'
            if out.get("seam"):
                attrs += ' stroke-width="%s"' % E.fmt(out["seam"], 3)
            if opacity < 0.999:
                attrs += ' opacity="%s"' % E.fmt(opacity, 3)
            groups.append("<g%s>%s</g>" % (attrs, out["body"]))
        if groups:
            try:
                objects = svg_pixbuf(self.viewbox() + "<defs>%s</defs>%s</svg>" % ("".join(defs), "".join(groups)))
                objects.composite(base, 0, 0, W, H, 0, 0, 1, 1, GdkPixbuf.InterpType.NEAREST, 255)
            except GLib.Error:
                pass
        self.image.set_from_pixbuf(base)


def run(init, render_cb, context, pages, cube_color, count):
    """Open the window; returns (state, touched) on Apply or None on Cancel."""
    # Inkscape shows anything written to stderr in a message box, so keep GTK's
    # harmless theme and icon warnings out of it (set VECTOR3DIT_DEBUG to see them).
    saved = None
    if not os.environ.get("VECTOR3DIT_DEBUG"):
        try:
            saved = os.dup(2)
            devnull = os.open(os.devnull, os.O_WRONLY)
            os.dup2(devnull, 2)
            os.close(devnull)
        except OSError:
            saved = None
    try:
        if not svg_supported():
            raise RuntimeError("GTK's SVG image loader (gdk-pixbuf svg / librsvg) is not available")
        win = EditorWindow(init, render_cb, context, pages, cube_color, count)
        win.show_all()
        script = os.environ.get("VECTOR3DIT_AUTOTEST")
        if script:
            GLib.timeout_add(500, _autotest, win, json.loads(script))
        Gtk.main()
        return win.result
    finally:
        if saved is not None:
            os.dup2(saved, 2)
            os.close(saved)


def _autotest(win, script):
    """Test hook: drive the window from a JSON script, screenshot it, then apply or cancel."""
    if script.get("kind"):
        win.set_values({"kind": script["kind"]})
    if script.get("preset"):
        win.set_rotation(*E.PRESETS[script["preset"]])
    for dx, dy in script.get("drag", []):
        win.begin_turn(0, 0)
        win.turn_to(dx, dy, 0, 0.8)
        win.end_turn()
    if script.get("material"):
        win.apply_material(script["material"])
    if script.get("save_camera"):
        win.save_camera(script["save_camera"], script.get("around", "page"))
    if "use_camera" in script:
        win.cam_combo.set_active_id(script["use_camera"])
    if script.get("delete_camera"):
        win.delete_camera()
    if script.get("set"):
        win.set_values(script["set"])
    for dx, dy in script.get("drag_after", []):  # a drag after the settings above (e.g. in This object mode)
        win.begin_turn(0, 0)
        win.turn_to(dx, dy, 0, 0.8)
        win.end_turn()
    if script.get("tab"):
        win.show_tab(script["tab"])
    if script.get("bevel_menu"):
        win.bevel_button.set_active(True)
    if script.get("full_color"):
        win.full_ctx.set_active(True)
    if script.get("color_picker"):
        win.color_buttons[script["color_picker"]].clicked()
        if script.get("pick"):
            win.color_popover.set_hex(script["pick"], True)

    def finish():
        win.render(draft=False)
        while Gtk.events_pending():
            Gtk.main_iteration()
        if script.get("screenshot"):
            gw = win.get_window()
            pb = Gdk.pixbuf_get_from_window(gw, 0, 0, gw.get_width(), gw.get_height())
            pb.savev(script["screenshot"], "png", [], [])
        win.finish(bool(script.get("apply", True)))
        return False

    GLib.timeout_add(600, finish)
    return False
