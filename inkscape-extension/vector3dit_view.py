"""The Rotate in 3D window for the Inkscape extension (GTK 3).

A trackball and sliders turn the selected objects while a live preview shows
them in place on the page, with the rest of the drawing faded behind them.
The preview paints the engine's own SVG output with cairo, so it matches what
Apply writes into the document.
"""

import json
import math
import os
import re

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("Gdk", "3.0")
from gi.repository import Gdk, GLib, Gtk  # noqa: E402

import cairo  # noqa: E402
from lxml import etree  # noqa: E402

import vector3dit_engine as E  # noqa: E402

KINDS = [("flat", "Flat"), ("extrude", "Extrude"), ("revolve", "Revolve"), ("inflate", "Inflate")]
VIEWS = [("", "Preset view…"), ("front", "Front"), ("offaxis", "Off-axis"), ("offaxis-l", "Off-axis left"),
         ("hero", "Low angle"), ("iso-l", "Isometric left"), ("iso-r", "Isometric right"), ("iso-t", "Isometric top"),
         ("top", "Top down"), ("turn-l", "Turned left"), ("turn-r", "Turned right"), ("tilt", "Tilted back"),
         ("dimetric", "Dimetric")]
AXIS_HEX = {"x": "#e5534b", "y": "#3fb950", "z": "#4c8df6", "p": "#f2a541"}

CSS = b"""
.v3d-panel { padding: 16px 16px 14px 16px; }
.v3d-kind button { padding: 6px 4px; min-width: 64px; }
.v3d-kind button:checked { background-image: none; background-color: #f2a541; color: #231503; border-color: #c77d1b; }
.v3d-head { font-weight: bold; letter-spacing: 1px; font-size: 0.92em; }
.v3d-hint { opacity: 0.72; font-size: 0.92em; }
.v3d-status { opacity: 0.8; font-size: 0.9em; }
scale.v3d-x trough highlight { background-color: #e5534b; border-color: #e5534b; }
scale.v3d-y trough highlight { background-color: #3fb950; border-color: #3fb950; }
scale.v3d-z trough highlight { background-color: #4c8df6; border-color: #4c8df6; }
scale.v3d-p trough highlight, scale.v3d-d trough highlight { background-color: #f2a541; border-color: #f2a541; }
.v3d-toolbar { padding: 6px 8px; }
.v3d-panel spinbutton button { padding: 2px 3px; min-width: 14px; }
.v3d-panel spinbutton entry { min-width: 0; }
"""


def rgb(hex_color, default=(0.6, 0.6, 0.6)):
    c = E.parse_color(hex_color)
    return (c[0] / 255.0, c[1] / 255.0, c[2] / 255.0) if c else default


def wrap180(a):
    a = (a + 180.0) % 360.0 - 180.0
    return 180.0 if a == -180.0 else a


# ---------------------------------------------------------------- painting engine output

_TOKEN = re.compile(r"[MLZmlz]|-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?")


def parse_d(d):
    """'M x y L x y ... Z' (the engine only writes absolute M/L/Z) -> [(points, closed)]."""
    subs, cur, nums = [], None, []
    for tok in _TOKEN.findall(d or ""):
        if tok in "MLZmlz":
            if tok in "Mm":
                cur = ([], False)
                subs.append(cur)
            elif tok in "Zz" and cur is not None:
                subs[-1] = (cur[0], True)
                cur = (cur[0], True)
            continue
        nums.append(float(tok))
        if len(nums) == 2:
            if cur is None:
                cur = ([], False)
                subs.append(cur)
            cur[0].append((nums[0], nums[1]))
            nums = []
    return [s for s in subs if len(s[0]) > 1]


def trace(cr, subs):
    for pts, closed in subs:
        cr.move_to(*pts[0])
        for p in pts[1:]:
            cr.line_to(*p)
        if closed:
            cr.close_path()


class Picture:
    """One render() result as cairo drawing operations."""

    def __init__(self, out, opacity=1.0):
        self.opacity = opacity
        self.bbox = out.get("bbox")
        self.seam = out.get("seam") or 0.0
        self.grads = {}
        self.ops = []
        for markup in out.get("defs") or []:
            try:
                el = etree.fromstring(markup)
            except etree.XMLSyntaxError:
                continue
            stops = [(float(s.get("offset", 0)), rgb(s.get("stop-color")), float(s.get("stop-opacity", 1)))
                     for s in el.iter("stop")]
            if el.tag == "linearGradient":
                g = cairo.LinearGradient(*(float(el.get(k, 0)) for k in ("x1", "y1", "x2", "y2")))
            elif el.tag == "radialGradient":
                g = cairo.RadialGradient(0, 0, 0, 0, 0, 1)  # objectBoundingBox, used by the floor shadow
            else:
                continue
            for off, c, a in stops:
                g.add_color_stop_rgba(off, c[0], c[1], c[2], a)
            self.grads[el.get("id")] = g
        body = etree.fromstring("<g>%s</g>" % (out.get("body") or ""))
        for el in body:
            if el.tag == "path":
                self.ops.append(("path", parse_d(el.get("d")), el.get("fill"), el.get("fill-rule") == "evenodd",
                                 el.get("stroke"), el.get("stroke-width")))
            elif el.tag == "g":
                path = el.find("path")
                if path is None:
                    continue
                std = 0.0
                if el.get("filter"):
                    blur = re.search(r'stdDeviation="([\d.]+)"', "".join(out.get("defs") or []))
                    std = float(blur.group(1)) if blur else 0.0
                self.ops.append(("shadow", parse_d(path.get("d")), rgb(path.get("fill")), float(el.get("opacity", 1)), std))
            elif el.tag == "ellipse":
                self.ops.append(("ellipse", [float(el.get(k)) for k in ("cx", "cy", "rx", "ry")],
                                 self.paint_of(el.get("fill")), float(el.get("opacity", 1))))

    def paint_of(self, value):
        if not value or value == "none":
            return None
        if value.startswith("url("):
            return self.grads.get(value[4:].strip("#)"))
        return rgb(value)

    @staticmethod
    def set_source(cr, paint):
        if isinstance(paint, tuple):
            cr.set_source_rgb(*paint)
        else:
            cr.set_source(paint)

    def paint(self, cr):
        if self.opacity < 0.999:
            cr.push_group()
        cr.set_line_join(cairo.LINE_JOIN_ROUND)
        cr.set_line_cap(cairo.LINE_CAP_ROUND)
        for op in self.ops:
            if op[0] == "path":
                _, subs, fill, evenodd, stroke, width = op
                trace(cr, subs)
                fp, sp = self.paint_of(fill), self.paint_of(stroke)
                w = float(width) if width else self.seam
                if fp is not None:
                    cr.set_fill_rule(cairo.FILL_RULE_EVEN_ODD if evenodd else cairo.FILL_RULE_WINDING)
                    self.set_source(cr, fp)
                    if sp is not None and w > 0:
                        cr.fill_preserve()
                    else:
                        cr.fill()
                if sp is not None and w > 0:
                    self.set_source(cr, sp)
                    cr.set_line_width(w)
                    cr.stroke()
                cr.new_path()
            elif op[0] == "shadow":
                paint_blurred(cr, op[1], op[2], op[3], op[4])
            elif op[0] == "ellipse":
                (cx, cy, rx, ry), pat, alpha = op[1], op[2], op[3]
                if pat is None or rx <= 0 or ry <= 0:
                    continue
                cr.save()
                cr.translate(cx, cy)
                cr.scale(rx, ry)
                cr.arc(0, 0, 1, 0, 2 * math.pi)
                cr.clip()
                self.set_source(cr, pat)
                cr.paint_with_alpha(alpha)
                cr.restore()
        if self.opacity < 0.999:
            cr.pop_group_to_source()
            cr.paint_with_alpha(self.opacity)


def paint_blurred(cr, subs, color, alpha, std):
    """Soft shadow: draw at low resolution, then scale it up with smoothing."""
    m = cr.get_matrix()
    blur = std * math.hypot(m.xx, m.yx)
    if blur < 1.5:
        trace(cr, subs)
        cr.set_source_rgba(color[0], color[1], color[2], alpha)
        cr.fill()
        return
    trace(cr, subs)
    x0, y0, x1, y1 = cr.fill_extents()
    cr.new_path()
    corners = [cr.user_to_device(x, y) for x, y in ((x0, y0), (x1, y0), (x0, y1), (x1, y1))]
    cx0, cy0, cx1, cy1 = cr.clip_extents()
    clip = [cr.user_to_device(x, y) for x, y in ((cx0, cy0), (cx1, cy1))]
    pad = blur * 2
    dx0 = max(min(p[0] for p in corners) - pad, min(c[0] for c in clip))
    dy0 = max(min(p[1] for p in corners) - pad, min(c[1] for c in clip))
    dx1 = min(max(p[0] for p in corners) + pad, max(c[0] for c in clip))
    dy1 = min(max(p[1] for p in corners) + pad, max(c[1] for c in clip))
    if dx1 <= dx0 or dy1 <= dy0:
        return
    f = max(1.0, blur / 1.6)
    w, h = int(math.ceil((dx1 - dx0) / f)) + 2, int(math.ceil((dy1 - dy0) / f)) + 2
    surf = cairo.ImageSurface(cairo.FORMAT_ARGB32, w, h)
    c2 = cairo.Context(surf)
    c2.set_matrix(cairo.Matrix(m.xx / f, m.yx / f, m.xy / f, m.yy / f, (m.x0 - dx0) / f, (m.y0 - dy0) / f))
    trace(c2, subs)
    c2.set_source_rgb(*color)
    c2.fill()
    cr.save()
    cr.identity_matrix()
    cr.translate(dx0, dy0)
    cr.scale(f, f)
    cr.set_source_surface(surf, 0, 0)
    cr.get_source().set_filter(cairo.FILTER_GOOD)
    cr.paint_with_alpha(alpha)
    cr.restore()


# ---------------------------------------------------------------- orientation cube

def cube_faces(rx, ry, rz, s, colors):
    R = E.from_euler(rx, ry, rz)
    faces = [
        ((0, 0, 1), [(-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1)], colors["front"]),
        ((0, 0, -1), [(1, -1, -1), (-1, -1, -1), (-1, 1, -1), (1, 1, -1)], colors["back"]),
        ((1, 0, 0), [(1, -1, 1), (1, -1, -1), (1, 1, -1), (1, 1, 1)], colors["side"]),
        ((-1, 0, 0), [(-1, -1, -1), (-1, -1, 1), (-1, 1, 1), (-1, 1, -1)], colors["side"]),
        ((0, 1, 0), [(-1, 1, 1), (1, 1, 1), (1, 1, -1), (-1, 1, -1)], colors["top"]),
        ((0, -1, 0), [(-1, -1, -1), (1, -1, -1), (1, -1, 1), (-1, -1, 1)], colors["top"]),
    ]
    out = []
    for n, verts, col in faces:
        nn = E.m_apply(R, list(n))
        if nn[2] <= 0.001:
            continue
        pts = [E.m_apply(R, [v[0] * s, v[1] * s, v[2] * s * 0.55]) for v in verts]
        k = 0.55 + 0.45 * nn[2]
        out.append((nn[2], [(p[0], -p[1]) for p in pts], tuple(min(1.0, c * k) for c in col)))
    out.sort(key=lambda f: f[0])
    return out


def axes(rx, ry, rz):
    R = E.from_euler(rx, ry, rz)
    res = []
    for name, v in (("x", [1, 0, 0]), ("y", [0, 1, 0]), ("z", [0, 0, 1])):
        p = E.m_apply(R, v)
        res.append((p[2], name, p[0], -p[1]))
    res.sort()
    return res


class Trackball(Gtk.DrawingArea):
    """Drag the cube to turn the objects. Shift locks one axis, Alt spins flat, arrow keys step 5°."""

    SIZE = 176

    def __init__(self, win):
        super().__init__()
        self.win = win
        self.set_size_request(self.SIZE, self.SIZE)
        self.set_can_focus(True)
        self.add_events(Gdk.EventMask.BUTTON_PRESS_MASK | Gdk.EventMask.BUTTON_RELEASE_MASK |
                        Gdk.EventMask.POINTER_MOTION_MASK | Gdk.EventMask.KEY_PRESS_MASK)
        self.set_tooltip_text("Drag to turn. Shift: one axis at a time. Alt: spin flat. Arrow keys: 5° steps.")
        self.connect("draw", self.on_draw)
        self.connect("button-press-event", lambda w, e: (self.grab_focus(), win.begin_turn(e.x, e.y))[1])
        self.connect("motion-notify-event", lambda w, e: win.turn_to(e.x, e.y, e.state, 0.8))
        self.connect("button-release-event", lambda w, e: win.end_turn())
        self.connect("key-press-event", self.on_key)

    def on_key(self, _w, e):
        step = {Gdk.KEY_Left: (0, -5), Gdk.KEY_Right: (0, 5), Gdk.KEY_Up: (-5, 0), Gdk.KEY_Down: (5, 0)}.get(e.keyval)
        if not step:
            return False
        self.win.nudge(*step)
        return True

    def on_draw(self, _w, cr):
        st = self.win.state
        size = self.SIZE
        c = size / 2.0
        cr.arc(c, c, c - 3, 0, 2 * math.pi)
        cr.set_source_rgb(0.11, 0.12, 0.15)
        cr.fill_preserve()
        cr.set_source_rgb(0.26, 0.28, 0.33)
        cr.set_line_width(2)
        cr.stroke()
        cr.arc(c, c, c - 14, 0, 2 * math.pi)
        cr.set_dash([4, 5])
        cr.set_line_width(1.2)
        cr.set_source_rgba(1, 1, 1, 0.18)
        cr.stroke()
        cr.set_dash([])
        ax = axes(st["rx"], st["ry"], st["rz"])
        r = size * 0.44

        def draw_axis(a):
            z, name, x, y = a
            col = rgb(AXIS_HEX[name])
            cr.set_source_rgba(col[0], col[1], col[2], 0.35 if z < 0 else 1.0)
            cr.set_line_width(1.6)
            cr.move_to(c, c)
            cr.line_to(c + x * r, c + y * r)
            cr.stroke()
            cr.select_font_face("Sans", cairo.FONT_SLANT_NORMAL, cairo.FONT_WEIGHT_BOLD)
            cr.set_font_size(11)
            ext = cr.text_extents(name.upper())
            cr.move_to(c + x * (r + 8) - ext.width / 2, c + y * (r + 8) + ext.height / 2)
            cr.show_text(name.upper())

        draw_axis(ax[0])
        front = self.win.cube_color
        colors = {"front": front, "back": (0.45, 0.47, 0.52), "side": (0.5, 0.52, 0.57), "top": (0.62, 0.64, 0.69)}
        for _, pts, col in cube_faces(st["rx"], st["ry"], st["rz"], size * 0.3, colors):
            cr.move_to(c + pts[0][0], c + pts[0][1])
            for p in pts[1:]:
                cr.line_to(c + p[0], c + p[1])
            cr.close_path()
            cr.set_source_rgb(*col)
            cr.fill_preserve()
            cr.set_source_rgb(0.08, 0.09, 0.11)
            cr.set_line_width(1.2)
            cr.set_line_join(cairo.LINE_JOIN_ROUND)
            cr.stroke()
        for a in ax[1:]:
            draw_axis(a)
        if self.has_focus():
            cr.arc(c, c, c - 2, 0, 2 * math.pi)
            cr.set_source_rgba(0.95, 0.65, 0.25, 0.9)
            cr.set_line_width(2)
            cr.stroke()


def kind_icon(kind):
    def draw(widget, cr):
        col = widget.get_style_context().get_color(widget.get_state_flags())
        cr.set_source_rgba(col.red, col.green, col.blue, col.alpha)
        cr.set_line_width(1.6)
        cr.set_line_join(cairo.LINE_JOIN_ROUND)
        cr.set_line_cap(cairo.LINE_CAP_ROUND)
        cr.translate(3, 3)
        if kind == "flat":
            cr.move_to(5, 5)
            cr.line_to(17, 5)
            cr.line_to(13, 13)
            cr.line_to(1, 13)
            cr.close_path()
        elif kind == "extrude":
            cr.move_to(9, 1)
            cr.line_to(16, 5)
            cr.line_to(16, 13)
            cr.line_to(9, 17)
            cr.line_to(2, 13)
            cr.line_to(2, 5)
            cr.close_path()
            cr.move_to(2, 5)
            cr.line_to(9, 9)
            cr.line_to(16, 5)
            cr.move_to(9, 9)
            cr.line_to(9, 17)
        elif kind == "revolve":
            cr.move_to(7, 1)
            cr.line_to(11, 1)
            cr.curve_to(11, 5, 16, 8, 15, 12)
            cr.curve_to(14, 16, 4, 16, 3, 12)
            cr.curve_to(2, 8, 7, 5, 7, 1)
            cr.close_path()
            cr.move_to(5, 12)
            cr.curve_to(7, 13, 11, 13, 13, 12)
        else:
            cr.move_to(4, 16)
            cr.curve_to(1, 12, 1, 5, 5, 2)
            cr.curve_to(8, 0, 12, 0, 14, 3)
            cr.curve_to(17, 7, 17, 12, 14, 16)
            cr.close_path()
        cr.stroke()
        return False

    area = Gtk.DrawingArea()
    area.set_size_request(24, 24)
    area.connect("draw", draw)
    return area


# ---------------------------------------------------------------- the window

class RotateWindow(Gtk.Window):
    def __init__(self, init, render_cb, context, pages, cube_color, count):
        super().__init__(title="Vector 3Dit · Rotate in 3D")
        self.state = dict(init)
        self.touched = set()
        self.render_cb = render_cb
        self.context = context
        self.pages = pages
        self.cube_color = cube_color
        self.pictures = []
        self.result = None
        self.drag = None
        self.pan = None
        self.view = None
        self._syncing = False
        self._idle = None
        self._full = None
        self._context_cache = None

        provider = Gtk.CssProvider()
        provider.load_from_data(CSS)
        Gtk.StyleContext.add_provider_for_screen(Gdk.Screen.get_default(), provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)

        self.set_default_size(1080, 700)
        self.set_position(Gtk.WindowPosition.CENTER)
        self.set_keep_above(True)
        self.connect("delete-event", lambda *a: self.finish(False) or True)
        self.connect("key-press-event", self.on_key)

        root = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL)
        self.add(root)

        # Preview
        left = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
        bar = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=6)
        bar.get_style_context().add_class("v3d-toolbar")
        self.status = Gtk.Label(xalign=0)
        self.status.get_style_context().add_class("v3d-status")
        self.status.set_text("%d object%s · drag to turn · right-drag to pan · scroll to zoom" % (count, "" if count == 1 else "s"))
        self.status.set_ellipsize(3)
        bar.pack_start(self.status, True, True, 0)
        self.show_ctx = Gtk.CheckButton(label="Other objects")
        self.show_ctx.set_active(True)
        self.show_ctx.set_tooltip_text("Show the rest of the drawing, faded, to help with placement")
        self.show_ctx.connect("toggled", lambda *_: self.preview.queue_draw())
        bar.pack_start(self.show_ctx, False, False, 6)
        for label, what in (("Fit selection", "sel"), ("Fit page", "page")):
            b = Gtk.Button(label=label)
            b.connect("clicked", lambda _b, w=what: self.fit(w))
            bar.pack_start(b, False, False, 0)
        left.pack_start(bar, False, False, 0)
        self.preview = Gtk.DrawingArea()
        self.preview.set_size_request(420, 360)
        self.preview.add_events(Gdk.EventMask.BUTTON_PRESS_MASK | Gdk.EventMask.BUTTON_RELEASE_MASK |
                                Gdk.EventMask.POINTER_MOTION_MASK | Gdk.EventMask.SCROLL_MASK |
                                Gdk.EventMask.SMOOTH_SCROLL_MASK)
        self.preview.connect("draw", self.on_preview_draw)
        self.preview.connect("button-press-event", self.on_preview_press)
        self.preview.connect("motion-notify-event", self.on_preview_motion)
        self.preview.connect("button-release-event", self.on_preview_release)
        self.preview.connect("scroll-event", self.on_scroll)
        self.preview.connect("size-allocate", lambda *_: setattr(self, "_context_cache", None))
        left.pack_start(self.preview, True, True, 0)
        root.pack_start(left, True, True, 0)
        root.pack_start(Gtk.Separator(orientation=Gtk.Orientation.VERTICAL), False, False, 0)

        # Controls
        panel = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=12)
        panel.get_style_context().add_class("v3d-panel")
        panel.set_size_request(390, -1)
        root.pack_start(panel, False, False, 0)

        kinds = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, homogeneous=True)
        kinds.get_style_context().add_class("linked")
        kinds.get_style_context().add_class("v3d-kind")
        self.kind_buttons = {}
        for kind, label in KINDS:
            b = Gtk.ToggleButton()
            box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=2)
            icon = kind_icon(kind)
            box.pack_start(icon, False, False, 0)
            icon.set_halign(Gtk.Align.CENTER)
            box.pack_start(Gtk.Label(label=label), False, False, 0)
            b.add(box)
            b.connect("toggled", self.on_kind, kind)
            kinds.pack_start(b, True, True, 0)
            self.kind_buttons[kind] = b
        panel.pack_start(kinds, False, False, 0)

        head = Gtk.Label(label="VIEW & ROTATION", xalign=0)
        head.get_style_context().add_class("v3d-head")
        panel.pack_start(head, False, False, 4)

        row = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=12)
        self.trackball = Trackball(self)
        row.pack_start(self.trackball, False, False, 0)
        side = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=10)
        hint = Gtk.Label(label="Drag the cube, or the preview, to turn the objects. Shift locks one axis, Alt spins it flat.",
                         xalign=0)
        hint.set_line_wrap(True)
        hint.set_max_width_chars(20)
        hint.get_style_context().add_class("v3d-hint")
        side.pack_start(hint, False, False, 0)
        face = Gtk.Button(label="↺  Face front")
        face.connect("clicked", lambda *_: self.set_rotation(0, 0, 0))
        side.pack_start(face, False, False, 0)
        self.preset = Gtk.ComboBoxText()
        for key, label in VIEWS:
            self.preset.append(key, label)
        self.preset.set_active(0)
        self.preset.connect("changed", self.on_preset)
        side.pack_start(self.preset, False, False, 0)
        side.set_valign(Gtk.Align.CENTER)
        row.pack_start(side, True, True, 0)
        panel.pack_start(row, False, False, 0)

        grid = Gtk.Grid(column_spacing=10, row_spacing=6)
        self.adjs = {}
        specs = [("rx", "Tilt", "x", -180, 180, "°"), ("ry", "Turn", "y", -180, 180, "°"),
                 ("rz", "Spin", "z", -180, 180, "°"), ("persp", "Perspective", "p", 0, 160, "°"),
                 ("depth", "Depth", "d", 0, 400, "px")]
        self.depth_widgets = []
        for i, (key, label, cls, lo, hi, unit) in enumerate(specs):
            lab = Gtk.Label(xalign=0)
            col = AXIS_HEX.get(cls)
            lab.set_markup('<span foreground="%s">%s</span>' % (col, label) if col and key != "persp" else label)
            adj = Gtk.Adjustment(value=float(self.state.get(key, 0)), lower=lo, upper=hi, step_increment=1, page_increment=10)
            scale = Gtk.Scale(orientation=Gtk.Orientation.HORIZONTAL, adjustment=adj)
            scale.set_draw_value(False)
            scale.set_hexpand(True)
            scale.get_style_context().add_class("v3d-" + cls)
            spin = Gtk.SpinButton(adjustment=adj, climb_rate=1, digits=0)
            spin.set_width_chars(4)
            spin.set_numeric(True)
            u = Gtk.Label(label=unit, xalign=0)
            adj.connect("value-changed", self.on_adj, key)
            for j, w in enumerate((lab, scale, spin, u)):
                grid.attach(w, j, i, 1, 1)
            self.adjs[key] = adj
            if key == "depth":
                self.depth_label = lab
                self.depth_widgets = [lab, scale, spin, u]
        panel.pack_start(grid, False, False, 0)

        panel.pack_start(Gtk.Box(), True, True, 0)
        note = Gtk.Label(xalign=0)
        note.set_markup("<small>Other settings (bevels, material, light) stay as they are. "
                        "Change them with the Extrude, Revolve or Inflate dialogs.</small>")
        note.set_line_wrap(True)
        note.set_max_width_chars(36)
        note.get_style_context().add_class("v3d-hint")
        panel.pack_start(note, False, False, 0)
        buttons = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
        cancel = Gtk.Button(label="Cancel")
        cancel.connect("clicked", lambda *_: self.finish(False))
        apply_btn = Gtk.Button(label="Apply")
        apply_btn.get_style_context().add_class("suggested-action")
        apply_btn.connect("clicked", lambda *_: self.finish(True))
        buttons.pack_end(apply_btn, False, False, 0)
        buttons.pack_end(cancel, False, False, 0)
        panel.pack_start(buttons, False, False, 0)

        self._syncing = True
        self.kind_buttons[self.state["kind"]].set_active(True)
        self._syncing = False
        self.update_depth_row()
        self.render(draft=False)
        self.fit("sel")

    # ---- state
    def on_kind(self, button, kind):
        if self._syncing:
            return
        if not button.get_active():
            if self.state["kind"] == kind:  # keep one pressed
                self._syncing = True
                button.set_active(True)
                self._syncing = False
            return
        self._syncing = True
        for k, b in self.kind_buttons.items():
            if k != kind:
                b.set_active(False)
        self._syncing = False
        self.state["kind"] = kind
        self.touched.add("kind")
        self.update_depth_row()
        self.changed()

    def update_depth_row(self):
        kind = self.state["kind"]
        show = kind in ("extrude", "inflate")
        for w in self.depth_widgets:
            w.set_visible(show)
            w.set_no_show_all(not show)
        self.depth_label.set_text("Puffiness" if kind == "inflate" else "Depth")

    def on_adj(self, adj, key):
        if self._syncing:
            return
        self.state[key] = adj.get_value()
        self.touched.add("depth" if key == "depth" else "rotation")
        if key != "depth":
            self.preset.set_active(0)
        self.changed(sync=False)

    def on_preset(self, combo):
        key = combo.get_active_id()
        if key and key in E.PRESETS:
            self.set_rotation(*E.PRESETS[key], keep_preset=True)

    def set_rotation(self, rx, ry, rz, keep_preset=False):
        self.state.update(rx=wrap180(rx), ry=wrap180(ry), rz=wrap180(rz))
        self.touched.add("rotation")
        if not keep_preset:
            self.preset.set_active(0)
        self.changed()

    def nudge(self, drx, dry):
        R = E.m_mul(E.m_mul(E.rot_x(drx), E.rot_y(dry)), E.from_euler(self.state["rx"], self.state["ry"], self.state["rz"]))
        self.set_rotation(*E.to_euler(R))

    def begin_turn(self, x, y):
        self.drag = {"x": x, "y": y, "R0": E.from_euler(self.state["rx"], self.state["ry"], self.state["rz"])}
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

    def changed(self, sync=True):
        if sync:
            self._syncing = True
            for key in ("rx", "ry", "rz", "persp", "depth"):
                if abs(self.adjs[key].get_value() - self.state[key]) > 1e-9:
                    self.adjs[key].set_value(self.state[key])
            self._syncing = False
        self.trackball.queue_draw()
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
        self.pictures = [Picture(out, op) for out, op in self.render_cb(self.state, self.touched, draft)]
        self.preview.queue_draw()

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
        boxes = [p.bbox for p in self.pictures if p.bbox]
        if not boxes:
            return None
        return [min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes)]

    def fit(self, what):
        alloc = self.preview.get_allocation()
        W, H = max(alloc.width, 420), max(alloc.height, 360)
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
        self._fit_size = (alloc.width, alloc.height)
        self._context_cache = None
        self.preview.queue_draw()

    def on_scroll(self, _w, e):
        if not self.view:
            return False
        if e.direction == Gdk.ScrollDirection.SMOOTH:
            ok, _dx, dy = e.get_scroll_deltas()
            k = math.pow(1.0015, -dy * 60)
        else:
            k = 1.15 if e.direction == Gdk.ScrollDirection.UP else 1 / 1.15 if e.direction == Gdk.ScrollDirection.DOWN else 1
        s, tx, ty = self.view
        self.view = [s * k, e.x - (e.x - tx) * k, e.y - (e.y - ty) * k]
        self._context_cache = None
        self.preview.queue_draw()
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
            self._context_cache = None
            self.preview.queue_draw()
            return True
        return False

    def on_preview_release(self, _w, e):
        self.pan = None
        return self.end_turn()

    def draw_context(self, cr, W, H):
        """Pages and the rest of the drawing, cached as an image until the view moves."""
        key = (W, H, tuple(self.view), self.show_ctx.get_active())
        if self._context_cache and self._context_cache[0] == key:
            cr.set_source_surface(self._context_cache[1], 0, 0)
            cr.paint()
            return
        surf = cairo.ImageSurface(cairo.FORMAT_ARGB32, W, H)
        c = cairo.Context(surf)
        s, tx, ty = self.view
        c.translate(tx, ty)
        c.scale(s, s)
        for x, y, w, h in self.pages:
            c.rectangle(x + 2 / s, y + 3 / s, w, h)
            c.set_source_rgba(0, 0, 0, 0.35)
            c.fill()
            c.rectangle(x, y, w, h)
            c.set_source_rgb(1, 1, 1)
            c.fill()
        if self.show_ctx.get_active() and self.context:
            c.push_group()
            c.set_line_join(cairo.LINE_JOIN_ROUND)
            for item in self.context:
                trace(c, item["subs"])
                if item.get("fill"):
                    c.set_source_rgb(*item["fill"])
                    c.set_fill_rule(cairo.FILL_RULE_EVEN_ODD if item.get("evenodd") else cairo.FILL_RULE_WINDING)
                    c.fill_preserve()
                if item.get("stroke"):
                    c.set_source_rgb(*item["stroke"])
                    c.set_line_width(max(item.get("width", 1.0), 0.6 / s))
                    if item.get("dash"):
                        c.set_dash([4 / s, 3 / s])
                    c.stroke_preserve()
                    c.set_dash([])
                c.new_path()
            c.pop_group_to_source()
            c.paint_with_alpha(0.38)
        self._context_cache = (key, surf)
        cr.set_source_surface(surf, 0, 0)
        cr.paint()

    def on_preview_draw(self, widget, cr):
        alloc = widget.get_allocation()
        W, H = alloc.width, alloc.height
        cr.set_source_rgb(0.17, 0.18, 0.21)
        cr.paint()
        if self.view is None or getattr(self, "_fit_size", None) in (None, (1, 1)):
            self.fit("sel")
        if self.view is None:
            return False
        self.draw_context(cr, W, H)
        s, tx, ty = self.view
        cr.translate(tx, ty)
        cr.scale(s, s)
        for p in self.pictures:
            p.paint(cr)
        return False


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
        win = RotateWindow(init, render_cb, context, pages, cube_color, count)
        win.show_all()
        win.update_depth_row()
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
        win.kind_buttons[script["kind"]].set_active(True)
    if script.get("preset"):
        win.preset.set_active_id(script["preset"])
    for dx, dy in script.get("drag", []):
        win.begin_turn(0, 0)
        win.turn_to(dx, dy, 0, 0.8)
        win.end_turn()
    if "depth" in script:
        win.adjs["depth"].set_value(script["depth"])

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
