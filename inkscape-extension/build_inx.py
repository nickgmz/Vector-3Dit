#!/usr/bin/env python3
"""Generates the Inkscape dialog files (vector3dit_*.inx) so every effect shares
the same View / Surface / Light / Outline tabs. Run after changing parameters:

    python3 build_inx.py
"""

import os
from xml.sax.saxutils import escape

HERE = os.path.dirname(os.path.abspath(__file__))


def rgba(hex_color):
    """'#rrggbb' -> Inkscape's color default (unsigned RGBA integer)."""
    return str(int(hex_color.lstrip("#") + "ff", 16))


def num(name, text, default, lo, hi, kind="float", precision=1, slider=True, tip=None):
    attrs = 'name="%s" type="%s" min="%s" max="%s" gui-text="%s"' % (name, kind, lo, hi, escape(text))
    if kind == "float":
        attrs += ' precision="%d"' % precision
    if slider:
        attrs += ' appearance="full"'
    if tip:
        attrs += ' gui-description="%s"' % escape(tip)
    return "<param %s>%s</param>" % (attrs, default)


def boolean(name, text, default, tip=None):
    t = ' gui-description="%s"' % escape(tip) if tip else ""
    return '<param name="%s" type="bool" gui-text="%s"%s>%s</param>' % (name, escape(text), t, "true" if default else "false")


def choice(name, text, options, default, tip=None, combo=True):
    t = ' gui-description="%s"' % escape(tip) if tip else ""
    look = ' appearance="combo"' if combo else ""
    # The first option is the default in Inkscape, so put the default first.
    opts_sorted = [o for o in options if o[0] == default] + [o for o in options if o[0] != default]
    opts = "".join('<option value="%s">%s</option>' % (v, escape(l)) for v, l in opts_sorted)
    return '<param name="%s" type="optiongroup"%s gui-text="%s"%s>%s</param>' % (name, look, escape(text), t, opts)


def color(name, text, default, tip=None):
    t = ' gui-description="%s"' % escape(tip) if tip else ""
    return '<param name="%s" type="color" appearance="colorbutton" gui-text="%s"%s>%s</param>' % (name, escape(text), t, rgba(default))


def label(text, header=False):
    return '<label%s>%s</label>' % (' appearance="header"' if header else "", escape(text))


def page(name, text, items):
    return '<page name="%s" gui-text="%s">%s</page>' % (name, escape(text), "".join(items))


BEVELS = [("none", "None"), ("classic", "Classic"), ("round", "Round"), ("cove", "Cove"), ("ogee", "Ogee"),
          ("step", "Step"), ("chisel", "Chisel")]
VIEWS = [("custom", "Use the angles below"), ("offaxis", "Off-axis"), ("offaxis-l", "Off-axis left"), ("front", "Front"),
         ("hero", "Low angle"), ("iso-l", "Isometric left"), ("iso-r", "Isometric right"), ("iso-t", "Isometric top"),
         ("top", "Top down"), ("turn-l", "Turned left"), ("turn-r", "Turned right"), ("tilt", "Tilted back"),
         ("dimetric", "Dimetric")]
MATERIALS = [("custom", "Use the settings below"), ("glossy", "Glossy"), ("clay", "Clay"), ("toon", "Toon"),
             ("poster", "Poster"), ("chrome", "Chrome"), ("gold", "Gold"), ("copper", "Copper"),
             ("lineart", "Line art"), ("wire", "Wireframe"), ("flat", "Flat color")]
SHADINGS = [("plastic", "Glossy"), ("matte", "Matte"), ("toon", "Toon"), ("metal", "Metal"), ("flat", "Flat"),
            ("lineart", "Line art"), ("wire", "Wireframe")]

SHAPE_PAGES = {
    "extrude": [
        label("Push the shape back into a solid.", True),
        num("depth", "Depth (px)", 40, 0, 1000),
        boolean("caps", "Solid (end caps)", True, "Turn off for a hollow tube"),
        choice("bevel", "Bevel", BEVELS, "none"),
        num("bevel_w", "Bevel width (px)", 6, 0, 200),
        num("bevel_h", "Bevel height (px)", 6, 0, 200),
        choice("bevel_sides", "Bevel on", [("front", "Front"), ("both", "Front and back")], "front"),
        boolean("bevel_out", "Grow the bevel outward", False),
        num("bevel_segs", "Bevel smoothness", 5, 1, 12, kind="int"),
    ],
    "revolve": [
        label("Spin the shape around a vertical axis, like a lathe. Draw half a profile with its straight side on the axis.", True),
        choice("rev_axis", "Axis", [("left", "Left edge"), ("center", "Center"), ("right", "Right edge")], "left"),
        num("rev_angle", "Angle (°)", 360, 1, 360),
        num("rev_offset", "Offset from axis (px)", 0, 0, 1000),
        num("rev_segs", "Segments", 48, 6, 128, kind="int", tip="More segments: smoother surface, larger file"),
        boolean("rev_caps", "Cap the cut ends (partial turns)", True),
    ],
    "inflate": [
        label("Puff the shape up like a balloon.", True),
        num("inf_height", "Puffiness (px)", 40, 0, 1000),
        choice("inf_profile", "Profile", [("round", "Round"), ("pillow", "Pillow"), ("dome", "Dome"), ("soft", "Soft"), ("cone", "Sharp")], "round"),
        num("inf_spread", "Roundness (%)", 100, 5, 100),
        choice("inf_sides", "Sides", [("both", "Both sides"), ("front", "Front only")], "both"),
        num("inf_detail", "Detail", 40, 12, 120, kind="int", tip="Mesh resolution: higher is smoother but slower and larger"),
    ],
    "flat": [
        label("Keeps the artwork paper-thin and tilts it in space: lay art on a floor, a wall or the side of an isometric box.", True),
    ],
}

TITLES = {"extrude": "Extrude", "revolve": "Revolve", "inflate": "Inflate", "flat": "Flat tilt"}

VIEW_PAGE = page("view", "View", [
    choice("view", "Preset view", VIEWS, "custom"),
    num("rx", "Tilt (X, °)", 20, -180, 180),
    num("ry", "Turn (Y, °)", -30, -180, 180),
    num("rz", "Spin (Z, °)", 0, -180, 180),
    num("persp", "Perspective (field of view, °)", 0, 0, 160, tip="0 = no perspective"),
])

SURFACE_PAGE = page("surface", "Surface", [
    choice("material", "Material preset", MATERIALS, "custom", tip="A preset overrides the shading settings below"),
    choice("shading", "Shading", SHADINGS, "plastic"),
    boolean("smooth", "Smooth gradients on curved surfaces", True),
    num("steps", "Color bands (0 = smooth)", 0, 0, 10, kind="int"),
    num("smooth_angle", "Smoothing angle (°)", 35, 0, 90),
    boolean("use_side_color", "Custom side color", False, "Off: the sides use the shape's own fill"),
    color("side_color", "Side color", "#c4741a"),
    choice("shadow_tint", "Shadow tone", [("auto", "Tinted"), ("black", "Black")], "auto"),
    color("highlight", "Highlight color", "#ffffff"),
])

LIGHT_PAGE = page("light", "Light", [
    num("light_az", "Direction (°, 0 = front, − = left)", -45, -180, 180),
    num("light_el", "Height (°)", 40, -89, 89),
    num("intensity", "Intensity (%)", 100, 0, 200),
    num("ambient", "Ambient (%)", 35, 0, 100),
    num("fill_light", "Fill light (%)", 25, 0, 100),
    num("specular", "Highlight (%)", 45, 0, 150),
    num("gloss", "Gloss", 55, 0, 100),
])

EXTRAS_PAGE = page("extras", "Outlines & shadow", [
    choice("edges", "Edge lines", [("none", "None"), ("outline", "Outline and sharp edges"), ("all", "Every facet")], "none"),
    color("edge_color", "Line color", "#1b1c22"),
    num("edge_width", "Line width (px)", 1.5, 0.1, 20),
    num("crease_angle", "Crease angle (°)", 40, 5, 120),
    choice("shadow", "Shadow", [("none", "None"), ("drop", "Cast onto the page"), ("floor", "Soft floor shadow")], "none"),
    num("shadow_opacity", "Shadow opacity (%)", 28, 0, 100),
    num("shadow_blur", "Shadow softness (px)", 6, 0, 100),
    num("shadow_dist", "Shadow distance (px)", 40, 0, 1000),
    color("shadow_color", "Shadow color", "#10121a"),
    num("seam", "Seam fix (px)", 1, 0, 3, tip="Hairline strokes that hide gaps between faces"),
])

HELP_PAGE = page("help", "Help", [
    label("Select shapes (or a group) and run the effect. Text must be converted first: Path › Object to Path."),
    label("The result is a group of plain vector faces. It keeps the original shape hidden inside, so running any Vector 3Dit effect on it again re-renders it with the new settings."),
    label("Extensions › Vector 3Dit › Remove 3D puts the original flat shape back."),
    label("Tip: tick Live preview to see changes as you edit."),
])


def effect_inx(kind):
    pages = [page("shape", "Shape", SHAPE_PAGES[kind]), VIEW_PAGE, SURFACE_PAGE, LIGHT_PAGE, EXTRAS_PAGE, HELP_PAGE]
    return """<?xml version="1.0" encoding="UTF-8"?>
<inkscape-extension xmlns="http://www.inkscape.org/namespace/inkscape/extension">
  <name>%s</name>
  <id>org.vector3dit.%s</id>
  <param name="kind" type="string" gui-hidden="true">%s</param>
  <param name="tab" type="notebook">%s</param>
  <effect needs-live-preview="true">
    <object-type>all</object-type>
    <effects-menu>
      <submenu name="Vector 3Dit"/>
    </effects-menu>
  </effect>
  <script>
    <command location="inx" interpreter="python">vector3dit.py</command>
  </script>
</inkscape-extension>
""" % (TITLES[kind], kind, kind, "".join(pages))


REMOVE_INX = """<?xml version="1.0" encoding="UTF-8"?>
<inkscape-extension xmlns="http://www.inkscape.org/namespace/inkscape/extension">
  <name>Remove 3D</name>
  <id>org.vector3dit.remove</id>
  <param name="kind" type="string" gui-hidden="true">remove</param>
  <effect needs-live-preview="false">
    <object-type>all</object-type>
    <effects-menu>
      <submenu name="Vector 3Dit"/>
    </effects-menu>
  </effect>
  <script>
    <command location="inx" interpreter="python">vector3dit.py</command>
  </script>
</inkscape-extension>
"""

if __name__ == "__main__":
    for k in SHAPE_PAGES:
        with open(os.path.join(HERE, "vector3dit_%s.inx" % k), "w", encoding="utf-8") as f:
            f.write(effect_inx(k))
    with open(os.path.join(HERE, "vector3dit_remove.inx"), "w", encoding="utf-8") as f:
        f.write(REMOVE_INX)
    print("wrote", len(SHAPE_PAGES) + 1, "inx files")
