#!/usr/bin/env python3
"""Vector 3Dit for Inkscape: extrude, revolve, inflate and tilt shapes into vector 3D.

Each result is a group that keeps a hidden copy of the original shape and the
settings used, so running any Vector 3Dit effect on the result again
re-renders it instead of stacking a second 3D effect on top.
"""

import json
import math

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

# Settings measured in px: scaled to the document's user units.
LENGTHS = ("depth", "bevel_w", "bevel_h", "rev_offset", "inf_height", "edge_width",
           "shadow_blur", "shadow_dist", "seam")


def parse_fragment(markup):
    root = etree.fromstring('<g xmlns="%s">%s</g>' % (SVG_NS, markup), parser=_PARSER)
    return list(root)


def color_hex(c):
    """inkex.Color (or string) -> '#rrggbb'."""
    try:
        return str(inkex.Color(c).to_rgb())
    except Exception:  # noqa: BLE001 - malformed colors fall back to the default
        return None


class Vector3Dit(inkex.EffectExtension):
    def add_arguments(self, pars):
        pars.add_argument("--tab", default="shape")
        pars.add_argument("--kind", default="extrude")
        # view
        pars.add_argument("--view", default="custom")
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
            "seam": o.seam,
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
            return
        if not self.svg.selection:
            raise inkex.AbortExtension("Select one or more shapes first (text: use Path › Object to Path).")
        targets, skipped_text = self.collect()
        if not targets:
            msg = "Nothing to make 3D in the selection."
            if skipped_text:
                msg += " Convert text to paths first (Path › Object to Path)."
            raise inkex.AbortExtension(msg)
        fx, material_fill = self.settings()

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

        for (src, res, key), subs in zip(targets, worlds):
            if not subs:
                continue
            pivot = None
            if key in pivots and len([t for t in targets if t[2] == key]) > 1:
                b = pivots[key]
                pivot = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]
            self.render_one(src, res, subs, fx, material_fill, pivot)
        if skipped_text:
            self.msg("Skipped %d text object(s): convert text to paths first (Path › Object to Path)." % skipped_text)

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
            prefix = self.svg.get_unique_id("v3d")
            res.set(PREFIX_ATTR, prefix)
            res.set("id", self.svg.get_unique_id(prefix + "-3d"))
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
            prefix = res.get(PREFIX_ATTR) or self.svg.get_unique_id("v3d")
            res.set(PREFIX_ATTR, prefix)
            if not res.get("id"):
                res.set("id", self.svg.get_unique_id(prefix + "-3d"))
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
        res.set(RESULT_ATTR, json.dumps({k: v for k, v in fx.items()}, separators=(",", ":")))
        res.label = "3D %s: %s" % (fx["kind"], source.label or "shape")
        res.style = inkex.Style({"stroke-width": E.fmt(out["seam"], 3), "stroke-linejoin": "round"} if out["seam"] else {})

        source.set("class", SOURCE_CLASS)
        source.style["display"] = "none"
        source.transform = Transform()
        res.append(source)
        faces = Group()
        faces.set("class", "v3d-faces")
        if opacity < 1:
            faces.style["opacity"] = E.fmt(opacity, 3)
        for el in parse_fragment(out["body"]):
            faces.append(el)
        res.append(faces)
        for el in parse_fragment("".join(out["defs"])):
            self.svg.defs.append(el)

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
                self.remove_defs(res.get(PREFIX_ATTR) or "~")
                parent.remove(res)
                done += 1
        if not done:
            raise inkex.AbortExtension("Select a Vector 3Dit result to turn back into a flat shape.")


if __name__ == "__main__":
    Vector3Dit().run()
