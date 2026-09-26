#!/usr/bin/env python3
"""Vector 3Dit for Inkscape: extrude, revolve, inflate and tilt shapes into vector 3D.

Each result is a group that keeps a hidden copy of the original shape and the
settings used, so running any Vector 3Dit effect on the result again
re-renders it instead of stacking a second 3D effect on top.
"""

import json
import math
import re

import inkex
from inkex import Group, PathElement, Transform
from lxml import etree

import vector3dit_engine as E

try:  # Parse generated markup into inkex element classes.
    from inkex.elements._parser import SVG_PARSER as _PARSER
except ImportError:  # pragma: no cover - very old inkex
    _PARSER = None

SVG_NS = "http://www.w3.org/2000/svg"
RESULT_ATTR = "data-v3d"
PREFIX_ATTR = "data-v3d-prefix"
SOURCE_CLASS = "v3d-source"
CAMERAS_ATTR = "data-v3d-cameras"  # saved scene cameras, on the document root

ROTATION = ("rx", "ry", "rz", "persp")
PLACEMENT = ("obj_rx", "obj_ry", "obj_rz", "obj_push")  # an object's own turn and push back inside a scene camera
CONTEXT_SKIP = {"defs", "metadata", "namedview", "clipPath", "mask", "pattern", "marker", "symbol", "title",
                "desc", "style", "script", "linearGradient", "radialGradient", "filter"}

# Settings measured in px: scaled to the document's user units.
LENGTHS = ("depth", "bevel_w", "bevel_h", "rev_offset", "inf_height", "edge_width",
           "shadow_blur", "shadow_dist", "seam", "obj_push")
KIND_NAMES = {"flat": "Flat", "extrude": "Extrude", "revolve": "Revolve", "inflate": "Inflate"}


def parse_fragment(markup):
    root = etree.fromstring('<g xmlns="%s">%s</g>' % (SVG_NS, markup), parser=_PARSER)
    return list(root)


def slug(text):
    """A readable id part: "Fill - Light Blue - Front" -> "fill-light-blue-front"."""
    s = re.sub(r"[^a-z0-9]+", "-", str(text).lower()).strip("-")[:48].strip("-") or "shape"
    return s if s[0].isalpha() else "shape-" + s


def color_hex(c):
    """inkex.Color (or string) -> '#rrggbb'."""
    try:
        return str(inkex.Color(c).to_rgb())
    except Exception:  # noqa: BLE001 - malformed colors fall back to the default
        return None


class Vector3Dit(inkex.EffectExtension):
    _ids = None  # every id in the document, collected on first use

    def add_arguments(self, pars):
        pars.add_argument("--tab", default="shape")
        pars.add_argument("--kind", default="extrude")
        # view
        pars.add_argument("--view", default="custom")
        pars.add_argument("--keep_rotation", type=inkex.Boolean, default=True)
        pars.add_argument("--rx", type=float, default=20.0)
        pars.add_argument("--ry", type=float, default=-30.0)
        pars.add_argument("--rz", type=float, default=0.0)
        pars.add_argument("--persp", type=float, default=0.0)
        # extrude
        pars.add_argument("--depth", type=float, default=40.0)
        pars.add_argument("--caps", type=inkex.Boolean, default=True)
        pars.add_argument("--bevel", default="none")
        pars.add_argument("--bevel_w", type=float, default=6.0)
        pars.add_argument("--bevel_h", type=float, default=6.0)
        pars.add_argument("--bevel_sides", default="front")
        pars.add_argument("--bevel_out", type=inkex.Boolean, default=False)
        pars.add_argument("--bevel_segs", type=int, default=5)
        # revolve
        pars.add_argument("--rev_axis", default="left")
        pars.add_argument("--rev_angle", type=float, default=360.0)
        pars.add_argument("--rev_offset", type=float, default=0.0)
        pars.add_argument("--rev_segs", type=int, default=48)
        pars.add_argument("--rev_caps", type=inkex.Boolean, default=True)
        # inflate
        pars.add_argument("--inf_height", type=float, default=40.0)
        pars.add_argument("--inf_profile", default="round")
        pars.add_argument("--inf_spread", type=float, default=100.0)
        pars.add_argument("--inf_sides", default="both")
        pars.add_argument("--inf_detail", type=int, default=40)
        # surface
        pars.add_argument("--material", default="custom")
        pars.add_argument("--shading", default="plastic")
        pars.add_argument("--smooth", type=inkex.Boolean, default=True)
        pars.add_argument("--steps", type=int, default=0)
        pars.add_argument("--smooth_angle", type=float, default=35.0)
        pars.add_argument("--use_side_color", type=inkex.Boolean, default=False)
        pars.add_argument("--side_color", type=inkex.Color, default=inkex.Color("#c4741a"))
        pars.add_argument("--shadow_tint", default="auto")
        pars.add_argument("--highlight", type=inkex.Color, default=inkex.Color("#ffffff"))
        # light
        pars.add_argument("--light_az", type=float, default=-45.0)
        pars.add_argument("--light_el", type=float, default=40.0)
        pars.add_argument("--intensity", type=float, default=100.0)
        pars.add_argument("--ambient", type=float, default=35.0)
        pars.add_argument("--fill_light", type=float, default=25.0)
        pars.add_argument("--specular", type=float, default=45.0)
        pars.add_argument("--gloss", type=float, default=55.0)
        # outlines & shadow
        pars.add_argument("--edges", default="none")
        pars.add_argument("--edge_color", type=inkex.Color, default=inkex.Color("#1b1c22"))
        pars.add_argument("--edge_width", type=float, default=1.5)
        pars.add_argument("--crease_angle", type=float, default=40.0)
        pars.add_argument("--shadow", default="none")
        pars.add_argument("--shadow_opacity", type=float, default=28.0)
        pars.add_argument("--shadow_blur", type=float, default=6.0)
        pars.add_argument("--shadow_dist", type=float, default=40.0)
        pars.add_argument("--shadow_color", type=inkex.Color, default=inkex.Color("#10121a"))
        pars.add_argument("--seam", type=float, default=1.0)
        pars.add_argument("--name_colors", default="names")

    # ---------------------------------------------------------------- settings
    def settings(self):
        o = self.options
        fx = {
            "kind": o.kind,
            "rx": o.rx, "ry": o.ry, "rz": o.rz, "persp": o.persp,
            "depth": o.depth, "caps": o.caps, "bevel": o.bevel, "bevel_w": o.bevel_w, "bevel_h": o.bevel_h,
            "bevel_sides": o.bevel_sides, "bevel_out": o.bevel_out, "bevel_segs": o.bevel_segs,
            "rev_axis": o.rev_axis, "rev_angle": o.rev_angle, "rev_offset": o.rev_offset,
            "rev_segs": o.rev_segs, "rev_caps": o.rev_caps,
            "inf_height": o.inf_height, "inf_profile": o.inf_profile, "inf_spread": o.inf_spread / 100.0,
            "inf_sides": o.inf_sides, "inf_detail": o.inf_detail,
            "shading": o.shading, "smooth": o.smooth, "steps": o.steps, "smooth_angle": o.smooth_angle,
            "side_color": color_hex(o.side_color) if o.use_side_color else None,
            "shadow_tint": o.shadow_tint, "highlight": color_hex(o.highlight) or "#ffffff",
            "light": {"az": o.light_az, "el": o.light_el, "intensity": o.intensity / 100.0,
                      "ambient": o.ambient / 100.0, "fill": o.fill_light / 100.0,
                      "specular": o.specular / 100.0, "gloss": o.gloss},
            "edges": o.edges, "edge_color": color_hex(o.edge_color) or "#1b1c22", "edge_width": o.edge_width,
            "crease_angle": o.crease_angle,
            "shadow": o.shadow, "shadow_opacity": o.shadow_opacity / 100.0, "shadow_blur": o.shadow_blur,
            "shadow_dist": o.shadow_dist, "shadow_color": color_hex(o.shadow_color) or "#10121a",
            "seam": o.seam, "name_colors": o.name_colors,
        }
        if o.view in E.PRESETS:
            fx["rx"], fx["ry"], fx["rz"] = E.PRESETS[o.view]
        material_fill = None
        if o.material in E.MATERIALS:
            m = dict(E.MATERIALS[o.material])
            material_fill = m.pop("fill", None)
            fx.update(m)
        # Lengths are entered in px; convert to the document's user units.
        k = self.svg.unittouu("1px")
        for key in LENGTHS:
            if key in fx:
                fx[key] = fx[key] * k
        return fx, material_fill

    # ---------------------------------------------------------------- geometry
    @staticmethod
    def world_subpaths(elem):
        """Element outline as engine subpaths in document (root) coordinates."""
        path = elem.path.transform(elem.composed_transform()).to_absolute()
        closed_flags = []
        for seg in path:
            letter = seg.letter.upper()
            if letter == "M":
                closed_flags.append(False)
            elif letter == "Z" and closed_flags:
                closed_flags[-1] = True
        subs = []
        csp = path.to_superpath()
        for si, sp in enumerate(csp):
            if len(sp) < 2:
                continue
            nodes = [{"x": p[1][0], "y": p[1][1], "ix": p[0][0], "iy": p[0][1], "ox": p[2][0], "oy": p[2][1]} for p in sp]
            closed = closed_flags[si] if si < len(closed_flags) and len(closed_flags) == len(csp) else False
            first, last = nodes[0], nodes[-1]
            same = abs(first["x"] - last["x"]) < 1e-6 and abs(first["y"] - last["y"]) < 1e-6
            if same and len(nodes) > 2:
                closed = True
            if closed and same and len(nodes) > 1:
                first["ix"], first["iy"] = last["ix"], last["iy"]
                nodes.pop()
            subs.append({"closed": closed, "nodes": nodes})
        return subs

    def fill_of(self, elem):
        style = elem.specified_style()
        fill = style.get("fill")
        if fill and str(fill).startswith("url("):
            ref = self.svg.getElementById(str(fill)[4:].strip("#)'\" "))
            stops = []
            seen = 0
            while ref is not None and seen < 8:
                stops = ref.findall("{%s}stop" % SVG_NS)
                if stops:
                    break
                href = ref.get("xlink:href") or ref.get("href")
                ref = self.svg.getElementById(href.lstrip("#")) if href else None
                seen += 1
            cols = [E.parse_color(color_hex(s.specified_style().get("stop-color") or s.get("stop-color") or "#000")) for s in stops]
            cols = [c for c in cols if c]
            if cols:
                return E.to_hex(tuple(sum(c[i] for c in cols) / len(cols) for i in range(3)))
            return "#f2a541"
        if not fill or fill == "none":
            stroke = style.get("stroke")
            return color_hex(stroke) if stroke and stroke != "none" else "#f2a541"
        return color_hex(fill) or "#f2a541"

    # ---------------------------------------------------------------- targets
    @staticmethod
    def result_of(elem):
        """The Vector 3Dit result group containing elem (or elem itself), if any."""
        node = elem
        while node is not None and isinstance(node, inkex.BaseElement):
            if node.get(RESULT_ATTR) is not None:
                return node
            node = node.getparent()
        return None

    def collect(self):
        """(source element, result group or None, pivot key) for every shape to render."""
        targets, skipped_text, seen = [], 0, set()

        def add_shape(el, pivot_key):
            nonlocal skipped_text
            res = self.result_of(el)
            if res is not None:
                if res.get("id") in seen:
                    return
                seen.add(res.get("id"))
                src = res.find(".//{%s}path[@class='%s']" % (SVG_NS, SOURCE_CLASS))
                if src is not None:
                    targets.append((src, res, pivot_key))
                return
            if isinstance(el, (inkex.TextElement, inkex.FlowRoot)):
                skipped_text += 1
                return
            if isinstance(el, Group):
                for child in el:
                    if isinstance(child, inkex.ShapeElement):
                        add_shape(child, pivot_key)
                return
            if isinstance(el, inkex.ShapeElement) and not isinstance(el, (inkex.Image, inkex.Use)):
                try:
                    el.path  # noqa: B018 - raises for elements without an outline
                except (AttributeError, TypeError, NotImplementedError):
                    return
                if el.get("id") in seen:
                    return
                seen.add(el.get("id"))
                targets.append((el, None, pivot_key))

        for el in self.svg.selection.values():
            is_group = isinstance(el, Group) and el.get(RESULT_ATTR) is None
            add_shape(el, el.get("id") if is_group else None)
        return targets, skipped_text

    # ---------------------------------------------------------------- effect
    def effect(self):
        if self.options.kind == "remove":
            self.remove_3d()
            return None
        if self.options.kind in ("editor", "rotate"):
            return self.editor_window()
        fx, material_fill = self.settings()
        plan, skipped_text = self.plan()
        for src, res, subs, pivot in plan:
            fx_one = fx
            if res is not None:  # the dialogs don't show an object's place in its scene, so it stays
                stored = self.stored_settings(res)
                fx_one = dict(fx, **{k: stored[k] for k in PLACEMENT if k in stored})
            if res is not None and self.options.keep_rotation:
                fx_one.update({k: stored[k] for k in ROTATION if k in stored})
                cams = self.load_cameras()
                if stored.get("camera") in cams:
                    pivot = self.use_camera(fx_one, stored["camera"], cams[stored["camera"]])
            self.render_one(src, res, subs, fx_one, material_fill, pivot)
        if skipped_text:
            self.msg("Skipped %d text object(s): convert text to paths first (Path › Object to Path)." % skipped_text)
        return None

    def plan(self):
        """[(source, result or None, world subpaths, pivot)] for the selection, and the number of skipped texts."""
        if not self.svg.selection:
            raise inkex.AbortExtension("Select one or more shapes first (text: use Path › Object to Path).")
        targets, skipped_text = self.collect()
        if not targets:
            msg = "Nothing to make 3D in the selection."
            if skipped_text:
                msg += " Convert text to paths first (Path › Object to Path)."
            raise inkex.AbortExtension(msg)

        # Shapes reached through a selected group turn together around the group's centre.
        worlds = [self.world_subpaths(src) for src, _, _ in targets]
        pivots = {}
        for (src, _, key), subs in zip(targets, worlds):
            if key is None:
                continue
            bb = E.path_bbox(subs)
            if bb:
                p = pivots.get(key)
                pivots[key] = bb if p is None else [min(p[0], bb[0]), min(p[1], bb[1]), max(p[2], bb[2]), max(p[3], bb[3])]

        plan = []
        for (src, res, key), subs in zip(targets, worlds):
            if not subs:
                continue
            pivot = None
            if key in pivots and len([t for t in targets if t[2] == key]) > 1:
                b = pivots[key]
                pivot = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]
            elif res is not None:
                pivot = self.stored_pivot(res, subs)
            plan.append((src, res, subs, pivot))
        return plan, skipped_text

    def stored_pivot(self, res, subs):
        """The point a result turns around, if it was made as part of a group (kept relative to the shape)."""
        off = self.stored_settings(res).get("pivot_offset")
        bb = E.path_bbox(subs)
        if not off or not bb:
            return None
        return [(bb[0] + bb[2]) / 2 + off[0], (bb[1] + bb[3]) / 2 + off[1]]

    @staticmethod
    def stored_settings(res):
        try:
            data = json.loads(res.get(RESULT_ATTR) or "{}")
        except ValueError:
            data = {}
        return data if isinstance(data, dict) else {}

    def render_one(self, src, res, subs, fx, material_fill, pivot):
        fill = material_fill or self.fill_of(src)
        style = src.specified_style()
        try:
            opacity = float(style.get("opacity", 1) or 1)
        except ValueError:
            opacity = 1.0

        if res is None:
            parent = src.getparent()
            res = Group()
            parent.insert(parent.index(src), res)
            # A readable id, like "heart-3d"; the parts inside are named after it ("heart-3d-fill-red-front").
            gid = self.new_id(slug(src.label or src.get("id") or "shape") + "-3d")
            res.set("id", gid)
            prefix = gid + "-"
            res.set(PREFIX_ATTR, prefix)
            src_copy = PathElement()
            src_copy.set("d", str(src.path.transform(src.composed_transform())))
            src_copy.style = inkex.Style(dict(src.specified_style()))
            src_copy.label = src.label or src.get("id")
            orig_id = src.get("id")
            src.getparent().remove(src)
            if orig_id:
                src_copy.set("id", orig_id)  # Remove 3D restores the shape under its original id.
            source = src_copy
        else:
            if not res.get("id"):
                res.set("id", self.new_id(slug(src.label or "shape") + "-3d"))
            # The parts and gradients are named after the group's id, which stays unique even when the group
            # was duplicated (a duplicate carries the original's prefix, so its gradients are left alone).
            old = res.get(PREFIX_ATTR)
            prefix = res.get("id") + "-"
            if old and old != prefix and not self.prefix_shared(old, res):
                self.remove_defs(old)
            res.set(PREFIX_ATTR, prefix)
            # Keep the stored original, in world coordinates, through any moves of the result.
            src.set("d", str(src.path.transform(src.composed_transform())))
            src.style = inkex.Style(dict(src.specified_style()))
            source = src
            self.remove_defs(prefix)
            for child in list(res):
                res.remove(child)

        out = E.render(subs, fx, fill=fill, opacity=opacity, id_prefix=prefix, pivot=pivot)
        parent_ct = res.getparent().composed_transform()
        res.transform = -parent_ct
        data = {k: v for k, v in fx.items() if k not in ("fill", "pivot_offset")}
        bb = E.path_bbox(subs)
        if pivot and bb:  # remember the group's turning point relative to this shape, so moves carry it along
            data["pivot_offset"] = [round(pivot[0] - (bb[0] + bb[2]) / 2, 4), round(pivot[1] - (bb[1] + bb[3]) / 2, 4)]
        if material_fill:
            data["fill"] = material_fill  # a material's own color, kept for later re-renders
        res.set(RESULT_ATTR, json.dumps(data, separators=(",", ":")))
        res.label = "3D %s: %s" % (KIND_NAMES.get(fx["kind"], fx["kind"]), source.label or "shape")
        res.style = inkex.Style({"opacity": E.fmt(opacity, 3)} if opacity < 1 else {})

        source.set("class", SOURCE_CLASS)
        source.style["display"] = "none"
        source.transform = Transform()
        res.append(source)
        # Shadow, Fills and Lines groups, with every part labelled like "Fill - Light Blue - Front".
        parts = parse_fragment(out["body"])
        self.name_parts(parts, prefix)
        for el in parts:
            res.append(el)
        for el in parse_fragment("".join(out["defs"])):
            self.svg.defs.append(el)

    def prefix_shared(self, prefix, res):
        """True when another 3D result still uses these gradient names (a duplicated group)."""
        return any(r is not res and r.get(PREFIX_ATTR) == prefix for r in self.svg.xpath("//*[@%s]" % PREFIX_ATTR))

    def new_id(self, base):
        """An id nothing in the document uses yet, not even as the start of its parts' ids: base, base-2, base-3..."""
        if self._ids is None:
            self._ids = set(self.svg.xpath("//@id"))
        n = 1
        while True:
            cand = base if n == 1 else "%s-%d" % (base, n)
            head = cand + "-"
            if cand not in self._ids and not any(i.startswith(head) for i in self._ids):
                self._ids.add(cand)
                return cand
            n += 1

    @staticmethod
    def name_parts(parts, prefix):
        """The engine's data-name becomes each part's label (as shown in Layers and Objects) and a readable id."""
        used = {}
        for top in parts:
            for el in top.iter():
                name = el.get("data-name")
                if name is None:
                    continue
                del el.attrib["data-name"]
                el.set("{http://www.inkscape.org/namespaces/inkscape}label", name)
                base = prefix + slug(name)
                used[base] = used.get(base, 0) + 1
                el.set("id", base if used[base] == 1 else "%s-%d" % (base, used[base]))

    # ---------------------------------------------------------------- 3D editor window
    # The window shows lengths in px and fractions as %; the document stores user units and 0-1 fractions.
    PERCENT = ("inf_spread", "shadow_opacity")
    LIGHT_PERCENT = ("intensity", "ambient", "fill", "specular")
    INTEGERS = ("bevel_segs", "rev_segs", "inf_detail", "steps")

    def to_ui(self, fx):
        px = self.svg.unittouu("1px")
        state = {}
        for key, value in fx.items():
            if key == "light":
                for lk, lv in (value or {}).items():
                    state["light_" + lk] = lv * 100 if lk in self.LIGHT_PERCENT else lv
            elif key in LENGTHS:
                state[key] = value / px
            elif key in self.PERCENT:
                state[key] = value * 100
            else:
                state[key] = value
        return state

    def from_ui(self, state, keys):
        px = self.svg.unittouu("1px")
        fx, light = {}, {}
        for key in keys:
            value = state[key]
            if key in ("fill", "opacity", "camera", "cameras", "shared_light", "turn_mode"):
                continue
            if key.startswith("light_"):
                lk = key[6:]
                light[lk] = value / 100.0 if lk in self.LIGHT_PERCENT else value
            elif key in LENGTHS:
                fx[key] = value * px
            elif key in self.PERCENT:
                fx[key] = value / 100.0
            elif key in self.INTEGERS:
                fx[key] = int(round(value))
            else:
                fx[key] = value
        return fx, light

    @staticmethod
    def scale_of(elem):
        t = elem.composed_transform()
        return math.sqrt(abs(t.a * t.d - t.b * t.c)) or 1.0

    def stroke_settings(self, src):
        """A plain shape's own stroke becomes the 3D object's outline."""
        style = src.specified_style()
        stroke = style.get("stroke")
        if not stroke or str(stroke) == "none" or str(stroke).startswith("url("):
            return {}
        color = color_hex(stroke)
        sw = str(style.get("stroke-width", "1"))
        try:
            width = float(sw)  # unitless: already user units
        except ValueError:
            width = self.svg.unittouu(sw)
        width *= self.scale_of(src)
        if not color or width <= 0:
            return {}
        return {"edges": "outline", "edge_color": color, "edge_width": width}

    # ---------------------------------------------------------------- scene cameras
    def load_cameras(self):
        try:
            cams = json.loads(self.svg.get(CAMERAS_ATTR) or "{}")
        except ValueError:
            cams = {}
        return cams if isinstance(cams, dict) else {}

    def save_cameras(self, cams):
        if cams:
            self.svg.set(CAMERAS_ATTR, json.dumps(cams, separators=(",", ":")))
        elif self.svg.get(CAMERAS_ATTR) is not None:
            self.svg.attrib.pop(CAMERAS_ATTR)

    @staticmethod
    def use_camera(fx, name, cam):
        """Lock fx to a saved camera: its angles, one turning point and one camera distance for every object."""
        fx.update({k: cam[k] for k in ROTATION if k in cam})
        fx["camera"] = name
        fx["scene_radius"] = cam["reach"]
        return list(cam["pivot"])

    @staticmethod
    def drop_camera(fx):
        fx.pop("camera", None)  # keeps its camera distance, so unlocking never changes how it looks

    def relink(self, cams, changed, skip):
        """Re-render every other 3D object locked to a camera that changed (or was deleted)."""
        for res in self.svg.xpath("//svg:g[@%s]" % RESULT_ATTR):
            if res in skip:
                continue
            fx = self.stored_settings(res)
            name = fx.get("camera")
            if not name or name not in changed:
                continue
            src = res.find(".//{%s}path[@class='%s']" % (SVG_NS, SOURCE_CLASS))
            if src is None:
                continue
            subs = self.world_subpaths(src)
            if not subs:
                continue
            fill = fx.pop("fill", None)
            if name in cams:
                pivot = self.use_camera(fx, name, cams[name])
            else:  # the camera was deleted: keep the object where it is, on its own view
                self.drop_camera(fx)
                pivot = self.stored_pivot(res, subs)
            self.render_one(src, res, subs, fx, fill, pivot)

    def camera_places(self, plan):
        """Where a new camera can turn around: the page's center or the selection's center, and the scene's reach."""
        pages = self.page_rects()
        boxes = [E.path_bbox(subs) for _, _, subs, _ in plan]
        boxes = [b for b in boxes if b]
        sel = [min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes)]
        page = [pages[0][0], pages[0][1], pages[0][0] + pages[0][2], pages[0][1] + pages[0][3]] if pages else sel
        center = lambda b: [round((b[0] + b[2]) / 2, 4), round((b[1] + b[3]) / 2, 4)]  # noqa: E731
        reach = max(math.hypot(page[2] - page[0], page[3] - page[1]), math.hypot(sel[2] - sel[0], sel[3] - sel[1])) / 2
        return {"page": center(page), "selection": center(sel)}, round(reach, 4)

    def editor_window(self):
        """Extensions › Vector 3Dit › 3D Editor…: every setting in one window with a trackball and a live preview."""
        plan, _ = self.plan()
        try:
            import warnings

            warnings.simplefilter("ignore", ImportWarning)
            import vector3dit_view as V  # GTK is only needed for this window.
        except (ImportError, ValueError) as err:
            raise inkex.AbortExtension(
                "The 3D Editor window needs GTK 3 for Python (PyGObject). It comes with Inkscape on Windows and "
                "macOS. On Linux, install it with your package manager, e.g. `sudo apt install python3-gi "
                "gir1.2-gtk-3.0`.\n\nYou can still use Extensions › Vector 3Dit › Classic dialogs.\n\n(%s)" % err)

        defaults, material_fill = self.settings()
        defaults["kind"] = "extrude"  # plain shapes start as an extrusion
        for key, value in E.defaults().items():  # settings the dialogs don't have (placement in a scene)
            defaults.setdefault(key, value)
        items = []
        for src, res, subs, pivot in plan:
            base = self.stored_settings(res) if res is not None else self.stroke_settings(src)
            fill = base.pop("fill", None) if res is not None else material_fill
            base = dict(defaults, **base)
            base["light"] = dict(defaults["light"], **(base.get("light") or {}))
            try:
                opacity = float(src.specified_style().get("opacity", 1) or 1)
            except ValueError:
                opacity = 1.0
            items.append({"src": src, "res": res, "subs": subs, "pivot": pivot, "base": base, "fill": fill,
                          "color": fill or self.fill_of(src), "opacity": opacity, "cache": {}})

        cams = self.load_cameras()
        # Other 3D objects locked to a saved camera turn along in the preview when that camera changes.
        chosen = {item["res"] for item in items if item["res"] is not None}
        passive = []
        for res in self.svg.xpath("//svg:g[@%s]" % RESULT_ATTR):
            base = self.stored_settings(res)
            if res in chosen or base.get("camera") not in cams:
                continue
            src = res.find(".//{%s}path[@class='%s']" % (SVG_NS, SOURCE_CLASS))
            subs = self.world_subpaths(src) if src is not None else None
            if not subs:
                continue
            fill = base.pop("fill", None)
            base = dict(defaults, **base)
            base["light"] = dict(defaults["light"], **(base.get("light") or {}))
            try:
                opacity = float(src.specified_style().get("opacity", 1) or 1)
            except ValueError:
                opacity = 1.0
            passive.append({"src": src, "res": res, "subs": subs, "pivot": None, "base": base, "fill": fill,
                            "color": fill or self.fill_of(src), "opacity": opacity, "cache": {}, "passive": True})

        first = items[0]
        init = self.to_ui(first["base"])
        init["camera"] = first["base"].get("camera") if first["base"].get("camera") in cams else ""
        init["cameras"] = json.loads(json.dumps(cams))
        init["camera_places"], init["camera_reach"] = self.camera_places(plan)
        if init.get("kind") not in E.KINDS:
            init["kind"] = "extrude"
        init["fill"] = first["color"]
        init["opacity"] = first["opacity"] * 100

        def settings_for(item, state, touched):
            """(settings, turning point) for an object with the window's current state."""
            fx = dict(item["base"])
            if not item.get("passive"):
                updates, light = self.from_ui(state, touched)
                fx.update(updates)
                fx["light"] = dict(item["base"]["light"], **light)
                name = state.get("camera") if "camera" in touched else fx.get("camera")
            else:
                name = fx.get("camera")
            cameras = state.get("cameras") or {}
            if name and name in cameras:
                return fx, self.use_camera(fx, name, cameras[name])
            self.drop_camera(fx)
            return fx, item["pivot"]

        def look(item, state, touched):
            if item.get("passive"):
                return item["color"], item["opacity"]
            color = state["fill"] if "fill" in touched else item["color"]
            opacity = state["opacity"] / 100.0 if "opacity" in touched else item["opacity"]
            return color, max(0.0, min(1.0, opacity))

        def render(state, touched, draft):
            outs = []
            for i, item in enumerate(items + passive):
                fx, pivot = settings_for(item, state, touched)
                if draft:  # while dragging: flat shading and no seam strokes, about twice as fast
                    fx["smooth"] = False
                    fx["seam"] = 0
                color, opacity = look(item, state, touched)
                out = E.render(item["subs"], fx, fill=color, opacity=opacity, id_prefix="p%d" % i,
                               pivot=pivot, mesh_cache=item["cache"])
                outs.append((out, opacity))
            return outs

        selected = set()
        for item in items + passive:
            selected.add(item["res"] if item["res"] is not None else item["src"])
        context = self.context_shapes(selected)
        try:
            result = V.run(init, render, context, self.page_rects(), V.rgb(first["color"]), len(items))
        except RuntimeError as err:
            raise inkex.AbortExtension("The 3D Editor window can't open: %s. You can still use Extensions › "
                                       "Vector 3Dit › Classic dialogs." % err)
        if result is None:
            return False  # Cancel: leave the document untouched.
        state, touched = result
        if not touched:
            return False
        for item in items:
            src = item["src"]
            material = item["fill"]
            color, opacity = look(item, state, touched)
            if "fill" in touched:
                src.style["fill"] = color  # the shape keeps its new color, also after Remove 3D
                material = None
            if "opacity" in touched:
                src.style["opacity"] = E.fmt(opacity, 3)
            if touched & {"edges", "edge_color", "edge_width"}:  # the shape keeps its stroke, also after Remove 3D
                fx = settings_for(item, state, touched)[0]
                if fx.get("edges", "none") == "none":
                    src.style["stroke"] = "none"
                else:
                    src.style["stroke"] = fx["edge_color"]
                    src.style["stroke-width"] = E.fmt(fx["edge_width"] / max(1e-9, self.scale_of(src)), 4)
            fx, pivot = settings_for(item, state, touched)
            self.render_one(src, item["res"], item["subs"], fx, material, pivot)
        # Saved cameras live in the document; objects locked to a changed camera follow it.
        new_cams = state.get("cameras") or {}
        changed = {n for n in set(cams) | set(new_cams) if cams.get(n) != new_cams.get(n)}
        if changed:
            self.save_cameras(new_cams)
            self.relink(new_cams, changed, [item["res"] for item in items])
        light_keys = [k for k in touched if k.startswith("light_")]
        if state.get("shared_light", True) and light_keys:
            self.share_light(self.from_ui(state, light_keys)[1], [item["res"] for item in items])
        return None

    def share_light(self, light, skip):
        """Shared scene light: give every other 3D object in the drawing the same light."""
        done = {id(r) for r in skip if r is not None}
        for res in self.svg.xpath("//svg:g[@%s]" % RESULT_ATTR):
            if id(res) in done or res in skip:
                continue
            src = res.find(".//{%s}path[@class='%s']" % (SVG_NS, SOURCE_CLASS))
            if src is None:
                continue
            subs = self.world_subpaths(src)
            if not subs:
                continue
            fx = self.stored_settings(res)
            fill = fx.pop("fill", None)
            fx["light"] = dict((fx.get("light") or E.defaults()["light"]), **light)
            self.render_one(src, res, subs, fx, fill, self.stored_pivot(res, subs))

    def page_rects(self):
        rects = []
        try:
            for page in self.svg.namedview.get_pages():
                rects.append((float(page.x), float(page.y), float(page.width), float(page.height)))
        except Exception:  # noqa: BLE001 - older inkex or unusual documents: fall back to the viewBox
            rects = []
        if not rects:
            try:
                x, y, w, h = self.svg.get_viewbox()
                if w > 0 and h > 0:
                    rects.append((x, y, w, h))
            except Exception:  # noqa: BLE001
                pass
        return rects

    def context_shapes(self, exclude, limit=4000):
        """The rest of the drawing as flat outlines, for the preview's placement backdrop."""
        items, paints = [], {}

        def paint(value):
            if not value or value == "none":
                return None
            value = str(value)
            if value not in paints:
                if value.startswith("url("):
                    probe = PathElement()
                    probe.style["fill"] = value
                    self.svg.append(probe)
                    paints[value] = self.fill_of(probe)
                    self.svg.remove(probe)
                else:
                    paints[value] = color_hex(value)
            c = E.parse_color(paints[value]) if paints[value] else None
            return (c[0] / 255.0, c[1] / 255.0, c[2] / 255.0) if c else None

        def walk(node, t):
            for ch in node:
                if len(items) >= limit:
                    return
                if not isinstance(ch, inkex.BaseElement) or ch in exclude:
                    continue
                tag = etree.QName(ch).localname
                if tag in CONTEXT_SKIP or ch.get("class") == SOURCE_CLASS:
                    continue
                own = ch.style
                if (own.get("display") or ch.get("display")) == "none" or own.get("visibility") == "hidden":
                    continue
                ct = t @ ch.transform
                if isinstance(ch, Group) or tag in ("a", "switch"):
                    walk(ch, ct)
                    continue
                try:
                    if isinstance(ch, (inkex.TextElement, inkex.FlowRoot, inkex.Image, inkex.Use)):
                        bb = ch.bounding_box(t)
                        if bb is None:
                            continue
                        box = [(bb.left, bb.top), (bb.right, bb.top), (bb.right, bb.bottom), (bb.left, bb.bottom)]
                        items.append({"subs": [(box, True)], "fill": None, "stroke": (0.35, 0.37, 0.42), "width": 0,
                                      "dash": True})
                        continue
                    if not isinstance(ch, inkex.ShapeElement):
                        continue
                    style = ch.specified_style()
                    fill, stroke = paint(style.get("fill", "black")), paint(style.get("stroke"))
                    if fill is None and stroke is None:
                        continue
                    subs = []
                    for sp in ch.path.transform(ct).to_superpath():
                        if len(sp) < 2:
                            continue
                        pts = [tuple(sp[0][1])]
                        for a, b in zip(sp, sp[1:]):
                            p0, p1, p2, p3 = a[1], a[2], b[0], b[1]
                            if p1 == p0 and p2 == p3:
                                pts.append(tuple(p3))
                                continue
                            for i in range(1, 9):
                                pts.append(E.bez_point(p0, p1, p2, p3, i / 8.0))
                        pts = [(p[0], p[1]) for p in pts]
                        subs.append((pts, pts[0] == pts[-1] or fill is not None))
                    sw = str(style.get("stroke-width", "1"))
                    try:
                        width = float(sw)  # unitless: already user units
                    except ValueError:
                        width = self.svg.unittouu(sw)
                    width *= math.sqrt(abs(ct.a * ct.d - ct.b * ct.c))
                    items.append({"subs": subs, "fill": fill, "stroke": stroke, "width": width,
                                  "evenodd": style.get("fill-rule") == "evenodd"})
                except Exception:  # noqa: BLE001 - the backdrop is best effort; skip anything odd
                    continue

        walk(self.svg, Transform())
        return items

    def remove_defs(self, prefix):
        for el in list(self.svg.defs):
            eid = el.get("id") or ""
            if eid.startswith(prefix + "g") or eid in (prefix + "sh", prefix + "fl"):
                self.svg.defs.remove(el)

    def remove_3d(self):
        """Put the original flat shapes back in place of their 3D results."""
        done = 0
        for el in self.svg.selection.values():
            results = [el] if el.get(RESULT_ATTR) is not None else []
            if not results:
                r = self.result_of(el)
                if r is not None:
                    results = [r]
                elif isinstance(el, Group):
                    results = [g for g in el.iter("{%s}g" % SVG_NS) if g.get(RESULT_ATTR) is not None]
            for res in results:
                src = res.find(".//{%s}path[@class='%s']" % (SVG_NS, SOURCE_CLASS))
                parent = res.getparent()
                if src is None or parent is None:
                    continue
                world = src.path.transform(src.composed_transform())
                src.set("d", str(world.transform(-parent.composed_transform())))
                src.transform = Transform()
                src.style.pop("display", None)
                src.attrib.pop("class", None)
                parent.insert(parent.index(res), src)
                prefix = res.get(PREFIX_ATTR)
                if prefix and not self.prefix_shared(prefix, res):
                    self.remove_defs(prefix)
                parent.remove(res)
                done += 1
        if not done:
            raise inkex.AbortExtension("Select a Vector 3Dit result to turn back into a flat shape.")


if __name__ == "__main__":
    Vector3Dit().run()
