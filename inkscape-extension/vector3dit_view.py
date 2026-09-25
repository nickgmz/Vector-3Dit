"""The 3D Editor window for the Inkscape extension (GTK 3).

Every Vector 3Dit setting in one window: kind, a trackball and preset views,
shape, surface and material, colors, light, outlines and shadow, and style,
with a live preview of the objects in place on the page and the rest of the
drawing faded behind them.

Everything on screen is drawn as SVG and shown through GdkPixbuf's SVG loader
(the one GTK uses for its own icons), so the preview is the engine's own output
and the window needs no cairo bindings, which are broken in some Inkscape builds.
"""

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

KINDS = [("flat", "Flat"), ("extrude", "Extrude"), ("revolve", "Revolve"), ("inflate", "Inflate")]
VIEWS = [("", "Preset view…"), ("front", "Front"), ("offaxis", "Off-axis"), ("offaxis-l", "Off-axis left"),
         ("hero", "Low angle"), ("iso-l", "Isometric left"), ("iso-r", "Isometric right"), ("iso-t", "Isometric top"),
         ("top", "Top down"), ("turn-l", "Turned left"), ("turn-r", "Turned right"), ("tilt", "Tilted back"),
         ("dimetric", "Dimetric")]
AXIS_HEX = {"x": "#e5534b", "y": "#3fb950", "z": "#4c8df6", "p": "#f2a541"}
SVG_NS = 'xmlns="http://www.w3.org/2000/svg"'
DESK = "#2b2e35"
KIND_ICONS = {
    "flat": "M8 8H20L16 16H4Z",
    "extrude": "M12 4 19 8V16L12 20 5 16V8Z M5 8 12 12 19 8 M12 12V20",
    "revolve": "M10 4H14C14 8 19 11 18 15C17 19 7 19 6 15C5 11 10 8 10 4Z M8 15C10 16 14 16 16 15",
    "inflate": "M7 19C4 15 4 8 8 5C11 3 15 3 17 6C20 10 20 15 17 19Z",
}
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
.v3d-sub { font-weight: bold; opacity: 0.7; font-size: 0.88em; }
.v3d-chip { padding: 3px 4px; min-height: 0; }
.v3d-section { padding: 4px 0; }
"""

def rgb(hex_color, default=(0.6, 0.6, 0.6)):
    c = E.parse_color(hex_color)
    return (c[0] / 255.0, c[1] / 255.0, c[2] / 255.0) if c else default


def hexc(c):
    return "#%02x%02x%02x" % tuple(int(round(max(0.0, min(1.0, v)) * 255)) for v in c)


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
    out.sort(key=lambda face: face[0])
    return out


def axes(rx, ry, rz):
    R = E.from_euler(rx, ry, rz)
    res = []
    for name, v in (("x", [1, 0, 0]), ("y", [0, 1, 0]), ("z", [0, 0, 1])):
        p = E.m_apply(R, v)
        res.append((p[2], name, p[0], -p[1]))
    res.sort()
    return res


def trackball_svg(size, rx, ry, rz, front, focused):
    c = size / 2.0
    r = size * 0.44
    out = ['<svg %s width="%d" height="%d" viewBox="0 0 %d %d">' % (SVG_NS, size, size, size, size),
           '<circle cx="%s" cy="%s" r="%s" fill="#1c1f26" stroke="%s" stroke-width="2"/>'
           % (f(c), f(c), f(c - 3), "#f2a541" if focused else "#43474f"),
           '<circle cx="%s" cy="%s" r="%s" fill="none" stroke="#ffffff" stroke-opacity="0.18" stroke-width="1.2" '
           'stroke-dasharray="4 5"/>' % (f(c), f(c), f(c - 14))]

    def axis(a):
        z, name, x, y = a
        op = "0.35" if z < 0 else "1"
        col = AXIS_HEX[name]
        return ('<line x1="%s" y1="%s" x2="%s" y2="%s" stroke="%s" stroke-opacity="%s" stroke-width="1.6"/>'
                '<text x="%s" y="%s" fill="%s" fill-opacity="%s" font-family="sans-serif" font-weight="bold" '
                'font-size="11" text-anchor="middle">%s</text>'
                % (f(c), f(c), f(c + x * r), f(c + y * r), col, op, f(c + x * (r + 8)), f(c + y * (r + 8) + 4), col, op,
                   name.upper()))

    ax = axes(rx, ry, rz)
    out.append(axis(ax[0]))
    colors = {"front": front, "back": (0.45, 0.47, 0.52), "side": (0.5, 0.52, 0.57), "top": (0.62, 0.64, 0.69)}
    for _, pts, col in cube_faces(rx, ry, rz, size * 0.3, colors):
        out.append('<path d="M%sZ" fill="%s" stroke="#14161b" stroke-width="1.2" stroke-linejoin="round"/>'
                   % ("L".join("%s %s" % (f(c + p[0]), f(c + p[1])) for p in pts), hexc(col)))
    out.extend(axis(a) for a in ax[1:])
    out.append("</svg>")
    return "".join(out)


class Trackball(Gtk.EventBox):
    """Drag the cube to turn the objects. Shift locks one axis, Alt spins flat, arrow keys step 5°."""

    SIZE = 176

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
        self.connect("focus-in-event", lambda *_: self.redraw())
        self.connect("focus-out-event", lambda *_: self.redraw())
        self._key = None

    def on_key(self, _w, e):
        step = {Gdk.KEY_Left: (0, -5), Gdk.KEY_Right: (0, 5), Gdk.KEY_Up: (-5, 0), Gdk.KEY_Down: (5, 0)}.get(e.keyval)
        if not step:
            return False
        self.win.nudge(*step)
        return True

    def redraw(self):
        st = self.win.state
        key = (st["rx"], st["ry"], st["rz"], self.has_focus())
        if key == self._key:
            return False
        self._key = key
        self.image.set_from_pixbuf(svg_pixbuf(trackball_svg(self.SIZE, st["rx"], st["ry"], st["rz"],
                                                            self.win.cube_color, self.has_focus())))
        return False


def kind_icon(kind, color):
    return svg_pixbuf('<svg %s width="24" height="24" viewBox="0 0 24 24"><path d="%s" fill="none" stroke="%s" '
                      'stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>'
                      % (SVG_NS, KIND_ICONS[kind], color))


# ---------------------------------------------------------------- light sphere

def light_sphere_svg(size, az, el):
    L = E.light_dir(az, el)
    c = size / 2.0
    R = c - 3
    hx, hy = c + L[0] * R * 0.55, c - L[1] * R * 0.55
    first = "#fbfbfc" if L[2] >= 0 else "#8d929c"
    px, py = c + L[0] * R, c - L[1] * R
    behind = L[2] < 0
    if behind:
        n = math.hypot(L[0], L[1]) or 1.0
        px, py = c + L[0] / n * R, c - L[1] / n * R
    return ('<svg %s width="%d" height="%d" viewBox="0 0 %d %d"><defs><radialGradient id="g" gradientUnits="userSpaceOnUse" '
            'cx="%s" cy="%s" fx="%s" fy="%s" r="%s"><stop offset="0" stop-color="%s"/><stop offset="0.3" stop-color="#b3b8c2"/>'
            '<stop offset="1" stop-color="#262930"/></radialGradient></defs>'
            '<circle cx="%s" cy="%s" r="%s" fill="url(#g)" stroke="#43474f" stroke-width="1.5"/>'
            '<circle cx="%s" cy="%s" r="6.5" fill="#ffd666" fill-opacity="%s" stroke="#3a2a05" stroke-width="1.5"/></svg>'
            % (SVG_NS, size, size, size, size, f(hx), f(hy), f(hx), f(hy), f(R * 1.25), first, f(c), f(c), f(R),
               f(px), f(py), "0.45" if behind else "1"))


class LightSphere(Gtk.EventBox):
    """Drag the sun to aim the light. Past the rim, the light moves behind the object."""

    SIZE = 124

    def __init__(self, win):
        super().__init__()
        self.win = win
        self.image = Gtk.Image()
        self.add(self.image)
        self.set_size_request(self.SIZE, self.SIZE)
        self.add_events(Gdk.EventMask.BUTTON_PRESS_MASK | Gdk.EventMask.BUTTON_RELEASE_MASK |
                        Gdk.EventMask.POINTER_MOTION_MASK)
        self.set_tooltip_text("Drag to aim the light")
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
        R = c - 3
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
            self.image.set_from_pixbuf(svg_pixbuf(light_sphere_svg(self.SIZE, *key)))


def preset_icon(rx, ry, rz, front):
    size = 40
    c = size / 2.0
    colors = {"front": front, "back": (0.45, 0.47, 0.52), "side": (0.5, 0.52, 0.57), "top": (0.62, 0.64, 0.69)}
    out = ['<svg %s width="%d" height="%d" viewBox="0 0 %d %d">' % (SVG_NS, size, size, size, size)]
    for _, pts, col in cube_faces(rx, ry, rz, size * 0.3, colors):
        out.append('<path d="M%sZ" fill="%s" stroke="#14161b" stroke-width="1" stroke-linejoin="round"/>'
                   % ("L".join("%s %s" % (f(c + p[0]), f(c + p[1])) for p in pts), hexc(col)))
    out.append("</svg>")
    return svg_pixbuf("".join(out))


# ---------------------------------------------------------------- settings layout

BEVELS = [("none", "None"), ("classic", "Classic"), ("round", "Round"), ("cove", "Cove"), ("ogee", "Ogee"),
          ("step", "Step"), ("chisel", "Chisel")]
SHAPE_ROWS = {
    "extrude": [("slider", "depth", "Depth", 0, 400, "px"), ("check", "caps", "Solid (end caps)"),
                ("combo", "bevel", "Bevel", BEVELS), ("slider", "bevel_w", "Bevel width", 0, 60, "px"),
                ("slider", "bevel_h", "Bevel height", 0, 60, "px"),
                ("combo", "bevel_sides", "Bevel on", [("front", "Front"), ("both", "Front and back")]),
                ("check", "bevel_out", "Grow the bevel outward"), ("slider", "bevel_segs", "Bevel smoothness", 1, 12, "")],
    "revolve": [("label", "Spins the shape around a vertical axis, like a lathe. Draw half a profile with its straight side "
                          "on the axis."),
                ("combo", "rev_axis", "Axis", [("left", "Left edge"), ("center", "Center"), ("right", "Right edge")]),
                ("slider", "rev_angle", "Angle", 1, 360, "°"), ("slider", "rev_offset", "Offset from axis", 0, 400, "px"),
                ("slider", "rev_segs", "Segments", 6, 128, ""), ("check", "rev_caps", "Cap the cut ends")],
    "inflate": [("slider", "inf_height", "Puffiness", 0, 400, "px"),
                ("combo", "inf_profile", "Profile", [("round", "Round"), ("pillow", "Pillow"), ("dome", "Dome"),
                                                     ("soft", "Soft"), ("cone", "Sharp")]),
                ("slider", "inf_spread", "Roundness", 5, 100, "%"),
                ("combo", "inf_sides", "Sides", [("both", "Both sides"), ("front", "Front only")]),
                ("slider", "inf_detail", "Detail", 12, 120, "")],
    "flat": [("label", "Keeps the artwork paper-thin and tilts it in space: lay art on a floor, a wall or the side of an "
                       "isometric box.")],
}
MATERIAL_NAMES = [("glossy", "Glossy"), ("clay", "Clay"), ("toon", "Toon"), ("poster", "Poster"), ("chrome", "Chrome"),
                  ("gold", "Gold"), ("copper", "Copper"), ("lineart", "Line art"), ("wire", "Wireframe"), ("flat", "Flat")]
PRESET_NAMES = [("front", "Front"), ("offaxis", "Off-axis"), ("offaxis-l", "Off-axis left"), ("hero", "Low angle"),
                ("iso-l", "Isometric left"), ("iso-r", "Isometric right"), ("iso-t", "Isometric top"), ("top", "Top down"),
                ("turn-l", "Turned left"), ("turn-r", "Turned right"), ("tilt", "Tilted back"), ("dimetric", "Dimetric")]
SURFACE_ROWS = [("combo", "shading", "Shading", [("plastic", "Glossy"), ("matte", "Matte"), ("toon", "Toon"),
                                                 ("metal", "Metal"), ("flat", "Flat"), ("lineart", "Line art"),
                                                 ("wire", "Wireframe")]),
                ("check", "smooth", "Smooth gradients on curved surfaces"),
                ("slider", "steps", "Color bands", 0, 10, ""), ("slider", "smooth_angle", "Smoothing angle", 0, 90, "°")]
COLOR_ROWS = [("color", "fill", "Front"), ("optcolor", "side_color", "Sides"), ("optcolor", "bevel_color", "Bevel"),
              ("optcolor", "back_color", "Back"), ("color", "highlight", "Highlight"),
              ("combo", "shadow_tint", "Shadow tone", [("auto", "Tinted"), ("black", "Black")])]
LIGHT_ROWS = [("slider", "light_az", "Direction", -180, 180, "°"), ("slider", "light_el", "Height", -89, 89, "°"),
              ("slider", "light_intensity", "Intensity", 0, 200, "%"), ("slider", "light_ambient", "Ambient", 0, 100, "%"),
              ("slider", "light_fill", "Fill light", 0, 100, "%"), ("slider", "light_specular", "Highlight", 0, 150, "%"),
              ("slider", "light_gloss", "Gloss", 0, 100, "")]
OUTLINE_ROWS = [("combo", "edges", "Edge lines", [("none", "None"), ("outline", "Outline and sharp edges"),
                                                  ("all", "Every facet")]),
                ("color", "edge_color", "Line color"), ("slider", "edge_width", "Line width", 0.1, 20, "px"),
                ("slider", "crease_angle", "Crease angle", 5, 120, "°"),
                ("combo", "shadow", "Shadow", [("none", "None"), ("drop", "Cast onto the page"), ("floor", "Soft floor shadow")]),
                ("slider", "shadow_opacity", "Shadow opacity", 0, 100, "%"),
                ("slider", "shadow_blur", "Shadow softness", 0, 100, "px"),
                ("slider", "shadow_dist", "Shadow distance", 0, 1000, "px"), ("color", "shadow_color", "Shadow color"),
                ("slider", "seam", "Seam fix", 0, 3, "px")]
STYLE_ROWS = [("color", "fill", "Fill"), ("outline", "edges", "Outline"), ("color", "edge_color", "Outline color"),
              ("slider", "edge_width", "Outline width", 0.1, 20, "px"), ("slider", "opacity", "Opacity", 0, 100, "%")]
ROTATION_KEYS = ("rx", "ry", "rz", "persp")
FINE = {"bevel_w", "bevel_h", "edge_width", "seam", "shadow_blur"}


def to_rgba(hex_color):
    c = Gdk.RGBA()
    if not c.parse(hex_color or "#808080"):
        c.parse("#808080")
    return c


# ---------------------------------------------------------------- the window

class EditorWindow(Gtk.Window):
    def __init__(self, init, render_cb, context, pages, cube_color, count):
        super().__init__(title="Vector 3Dit · 3D Editor")
        self.state = dict(init)
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
        self.bind = {}  # key -> [setter(value)] that update widgets without feedback
        self.sections = {}
        for item in self.context:
            item["d"] = "".join("M" + "L".join("%s %s" % (f(x), f(y)) for x, y in pts) + ("Z" if closed else "")
                                for pts, closed in item["subs"] if len(pts) > 1)

        provider = Gtk.CssProvider()
        provider.load_from_data(CSS)
        Gtk.StyleContext.add_provider_for_screen(Gdk.Screen.get_default(), provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)

        width, height = 1240, 820
        try:  # fit smaller laptop screens
            display = Gdk.Display.get_default()
            monitor = display.get_primary_monitor() or display.get_monitor(0)
            area = monitor.get_workarea()
            width, height = min(width, area.width - 40), min(height, area.height - 60)
        except Exception:  # noqa: BLE001
            pass
        self.set_default_size(max(900, width), max(560, height))
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

    # ---- building
    def build_preview(self, count):
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
        self.show_ctx.connect("toggled", lambda *_: self.queue_preview())
        bar.pack_start(self.show_ctx, False, False, 6)
        for label, what in (("Fit selection", "sel"), ("Fit page", "page")):
            b = Gtk.Button(label=label)
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
        panel = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=10)
        panel.get_style_context().add_class("v3d-panel")
        panel.set_size_request(430, -1)

        kinds = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, homogeneous=True)
        kinds.get_style_context().add_class("linked")
        kinds.get_style_context().add_class("v3d-kind")
        self.kind_buttons, self.kind_icons = {}, {}
        self.icon_color = "#555a66"
        for kind, label in KINDS:
            b = Gtk.ToggleButton()
            box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=2)
            icon = Gtk.Image.new_from_pixbuf(kind_icon(kind, self.icon_color))
            icon.set_halign(Gtk.Align.CENTER)
            box.pack_start(icon, False, False, 0)
            box.pack_start(Gtk.Label(label=label), False, False, 0)
            b.add(box)
            b.connect("toggled", self.on_kind, kind)
            kinds.pack_start(b, True, True, 0)
            self.kind_buttons[kind] = b
            self.kind_icons[kind] = icon
        panel.pack_start(kinds, False, False, 0)

        scroll = Gtk.ScrolledWindow()
        scroll.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC)
        sections = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=4)
        sections.get_style_context().add_class("v3d-sections")
        scroll.add(sections)
        panel.pack_start(scroll, True, True, 0)

        sections.pack_start(self.section("View & rotation", self.build_view(), True), False, False, 0)
        self.shape_stack = Gtk.Stack()
        self.shape_stack.set_vhomogeneous(False)
        self.shape_stack.set_transition_type(Gtk.StackTransitionType.NONE)
        for kind, rows in SHAPE_ROWS.items():
            self.shape_stack.add_named(self.grid(rows), kind)
        sections.pack_start(self.section("Shape", self.shape_stack, True), False, False, 0)
        surface = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=8)
        surface.pack_start(self.sublabel("Material presets"), False, False, 0)
        surface.pack_start(self.chips([(k, l, None) for k, l in MATERIAL_NAMES], self.apply_material, 5), False, False, 0)
        surface.pack_start(self.grid(SURFACE_ROWS), False, False, 0)
        sections.pack_start(self.section("Surface & material", surface, False), False, False, 0)
        sections.pack_start(self.section("Colors", self.grid(COLOR_ROWS), False), False, False, 0)
        light = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=8)
        self.light_sphere = LightSphere(self)
        self.light_sphere.set_halign(Gtk.Align.CENTER)
        light.pack_start(self.light_sphere, False, False, 0)
        light.pack_start(self.grid(LIGHT_ROWS), False, False, 0)
        sections.pack_start(self.section("Light", light, False), False, False, 0)
        sections.pack_start(self.section("Outlines & shadow", self.grid(OUTLINE_ROWS), False), False, False, 0)
        sections.pack_start(self.section("Style", self.grid(STYLE_ROWS), True), False, False, 0)

        note = Gtk.Label(xalign=0)
        note.set_markup("<small>Changes apply to every selected object. Settings you don't touch stay as each object "
                        "has them.</small>")
        note.set_line_wrap(True)
        note.set_max_width_chars(44)
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
        return panel

    def build_view(self):
        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=10)
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
        side.set_valign(Gtk.Align.CENTER)
        row.pack_start(side, True, True, 0)
        box.pack_start(row, False, False, 0)
        box.pack_start(self.grid([("slider", "rx", "Tilt", -180, 180, "°", "x"), ("slider", "ry", "Turn", -180, 180, "°", "y"),
                                  ("slider", "rz", "Spin", -180, 180, "°", "z"),
                                  ("slider", "persp", "Perspective", 0, 160, "°", "p")]), False, False, 0)
        box.pack_start(self.sublabel("Preset views"), False, False, 0)
        chips = [(k, l, preset_icon(*E.PRESETS[k], self.cube_color)) for k, l in PRESET_NAMES]
        flow = self.chips(chips, lambda k: self.set_rotation(*E.PRESETS[k]), 6)
        self.preset_images = [(k, child.get_child().get_child()) for (k, _l, _p), child in zip(chips, flow.get_children())]
        box.pack_start(flow, False, False, 0)
        return box

    def section(self, title, child, expanded):
        exp = Gtk.Expander()
        lab = Gtk.Label(label=title.upper(), xalign=0)
        lab.get_style_context().add_class("v3d-head")
        exp.set_label_widget(lab)
        exp.set_expanded(expanded)
        child.set_margin_top(8)
        child.set_margin_bottom(10)
        child.set_margin_start(4)
        exp.add(child)
        exp.get_style_context().add_class("v3d-section")
        self.sections[title.upper()] = exp
        return exp

    @staticmethod
    def sublabel(text):
        lab = Gtk.Label(label=text, xalign=0)
        lab.get_style_context().add_class("v3d-sub")
        return lab

    def chips(self, items, on_click, per_line):
        flow = Gtk.FlowBox()
        flow.set_selection_mode(Gtk.SelectionMode.NONE)
        flow.set_max_children_per_line(per_line)
        flow.set_min_children_per_line(min(per_line, 4))
        flow.set_homogeneous(True)
        flow.set_column_spacing(4)
        flow.set_row_spacing(4)
        for key, label, pixbuf in items:
            b = Gtk.Button()
            b.get_style_context().add_class("v3d-chip")
            b.set_tooltip_text(label)
            if pixbuf is not None:
                b.add(Gtk.Image.new_from_pixbuf(pixbuf))
            else:
                b.set_label(label)
            b.connect("clicked", lambda _b, k=key: on_click(k))
            flow.add(b)
        return flow

    def grid(self, rows):
        grid = Gtk.Grid(column_spacing=10, row_spacing=6)
        for i, row in enumerate(rows):
            kind, key = row[0], row[1]
            if kind == "label":
                lab = Gtk.Label(label=key, xalign=0)
                lab.set_line_wrap(True)
                lab.set_max_width_chars(44)
                lab.get_style_context().add_class("v3d-hint")
                grid.attach(lab, 0, i, 4, 1)
                continue
            text = row[2]
            if kind == "slider":
                lo, hi, unit = row[3], row[4], row[5]
                cls = row[6] if len(row) > 6 else "d"
                lab = Gtk.Label(xalign=0)
                col = AXIS_HEX.get(cls) if cls in ("x", "y", "z") else None
                lab.set_markup('<span foreground="%s">%s</span>' % (col, text) if col else text)
                value = float(self.state.get(key, lo) or 0)
                digits = 1 if key in FINE else 0
                adj = Gtk.Adjustment(value=value, lower=min(lo, value), upper=max(hi, value),
                                     step_increment=0.1 if digits else 1, page_increment=1 if digits else 10)
                scale = Gtk.Scale(orientation=Gtk.Orientation.HORIZONTAL, adjustment=adj)
                scale.set_draw_value(False)
                scale.set_hexpand(True)
                scale.get_style_context().add_class("v3d-" + cls)
                spin = Gtk.SpinButton(adjustment=adj, climb_rate=1, digits=digits)
                spin.set_width_chars(4)
                spin.set_numeric(True)
                adj.connect("value-changed", lambda a, k=key: self.on_widget(k, a.get_value()))
                self.bind.setdefault(key, []).append(lambda v, a=adj: a.set_value(float(v)) if v is not None else None)
                for j, w in enumerate((lab, scale, spin, Gtk.Label(label=unit, xalign=0))):
                    grid.attach(w, j, i, 1, 1)
            elif kind == "check":
                chk = Gtk.CheckButton(label=text)
                chk.connect("toggled", lambda c, k=key: self.on_widget(k, c.get_active()))
                self.bind.setdefault(key, []).append(lambda v, c=chk: c.set_active(bool(v)))
                grid.attach(chk, 0, i, 4, 1)
            elif kind == "outline":
                chk = Gtk.CheckButton(label="Draw the outline and sharp edges")
                chk.connect("toggled", lambda c: self.on_widget("edges", "outline" if c.get_active() else "none"))
                self.bind.setdefault("edges", []).append(lambda v, c=chk: c.set_active(v not in (None, "none")))
                grid.attach(Gtk.Label(label=text, xalign=0), 0, i, 1, 1)
                grid.attach(chk, 1, i, 3, 1)
            elif kind == "combo":
                combo = Gtk.ComboBoxText()
                for value, label in row[3]:
                    combo.append(value, label)
                combo.connect("changed", lambda c, k=key: c.get_active_id() and self.on_widget(k, c.get_active_id()))
                self.bind.setdefault(key, []).append(lambda v, c=combo: c.set_active_id(str(v)))
                grid.attach(Gtk.Label(label=text, xalign=0), 0, i, 1, 1)
                grid.attach(combo, 1, i, 3, 1)
            elif kind in ("color", "optcolor"):
                btn = Gtk.ColorButton()
                btn.set_hexpand(True)
                if kind == "optcolor":
                    chk = Gtk.CheckButton(label=text)
                    chk.set_tooltip_text("Off: use the front color")

                    def toggled(c, k=key, b=btn):
                        b.set_sensitive(c.get_active())
                        self.on_widget(k, hexc((b.get_rgba().red, b.get_rgba().green, b.get_rgba().blue)) if c.get_active() else None)

                    chk.connect("toggled", toggled)
                    btn.connect("color-set", lambda b, k=key, c=chk: c.get_active() and self.on_widget(
                        k, hexc((b.get_rgba().red, b.get_rgba().green, b.get_rgba().blue))))

                    def setter(v, c=chk, b=btn):
                        c.set_active(bool(v))
                        b.set_sensitive(bool(v))
                        b.set_rgba(to_rgba(v or self.state.get("fill")))  # off: shows the front color

                    self.bind.setdefault(key, []).append(setter)
                    grid.attach(chk, 0, i, 1, 1)
                else:
                    btn.connect("color-set", lambda b, k=key: self.on_widget(
                        k, hexc((b.get_rgba().red, b.get_rgba().green, b.get_rgba().blue))))
                    self.bind.setdefault(key, []).append(lambda v, b=btn: v and b.set_rgba(to_rgba(v)))
                    grid.attach(Gtk.Label(label=text, xalign=0), 0, i, 1, 1)
                grid.attach(btn, 1, i, 3, 1)
        return grid

    # ---- state
    def on_widget(self, key, value):
        if not self._syncing:
            self.set_values({key: value}, from_widget=True)
        return False

    def set_values(self, values, from_widget=False):
        for key, value in values.items():
            self.state[key] = value
            self.touched.add(key)
        self.sync(values.keys())
        if "fill" in values:  # the cube icons show the front color
            self.cube_color = rgb(values["fill"], self.cube_color)
            self.trackball._key = None
            for k, img in self.preset_images:
                img.set_from_pixbuf(preset_icon(*E.PRESETS[k], self.cube_color))
        self.changed()

    def sync(self, keys):
        self._syncing = True
        try:
            for key in keys:
                for setter in self.bind.get(key, []):
                    setter(self.state.get(key))
        finally:
            self._syncing = False

    def sync_all(self):
        self.sync(list(self.bind.keys()))
        self._syncing = True
        self.kind_buttons[self.state["kind"]].set_active(True)
        self._syncing = False
        self.shape_stack.set_visible_child_name(self.state["kind"])
        self.update_kind_icons()
        self.trackball.redraw()
        self.light_sphere.redraw()

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
        self.shape_stack.set_visible_child_name(kind)
        self.set_values({"kind": kind})
        self.update_kind_icons()

    def update_kind_icons(self):
        fg = self.kind_buttons["flat"].get_style_context().get_color(Gtk.StateFlags.NORMAL)
        self.icon_color = hexc((fg.red, fg.green, fg.blue))  # the theme's button text color
        for k, icon in self.kind_icons.items():
            icon.set_from_pixbuf(kind_icon(k, "#231503" if k == self.state["kind"] else self.icon_color))

    def apply_material(self, name):
        values = dict(E.MATERIALS.get(name, {}))
        self.set_values(values)

    def set_rotation(self, rx, ry, rz):
        self.set_values({"rx": wrap180(rx), "ry": wrap180(ry), "rz": wrap180(rz)})

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
        key = (self._size, tuple(self.view), self.show_ctx.get_active())
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
            out.append('<g opacity="0.38" stroke-linejoin="round">')
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
        win.kind_buttons[script["kind"]].set_active(True)
    if script.get("preset"):
        win.set_rotation(*E.PRESETS[script["preset"]])
    for dx, dy in script.get("drag", []):
        win.begin_turn(0, 0)
        win.turn_to(dx, dy, 0, 0.8)
        win.end_turn()
    if script.get("material"):
        win.apply_material(script["material"])
    if script.get("set"):
        win.set_values(script["set"])
    for name in script.get("expand", []):
        win.sections[name.upper()].set_expanded(True)
    for name in script.get("collapse", []):
        win.sections[name.upper()].set_expanded(False)

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
