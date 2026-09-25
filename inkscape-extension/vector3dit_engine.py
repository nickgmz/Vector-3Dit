"""Vector 3Dit engine: turns flat vector shapes into 3D-looking vector art.

A pure-Python port of the Vector 3Dit web app's 3D engine (no third-party
dependencies). Input shapes are bezier subpaths in document coordinates:

    [{"closed": bool, "nodes": [{"x", "y", "ix", "iy", "ox", "oy"}, ...]}, ...]

where (ix, iy) is a node's incoming handle and (ox, oy) its outgoing handle.
`render()` returns SVG markup for the projected, lit and depth-sorted faces.
Curved surfaces are shaded with exact per-face linear gradients, so the output
stays 100% vector.
"""

import math

# --------------------------------------------------------------------------
# small helpers
# --------------------------------------------------------------------------


def clamp(v, a, b):
    return a if v < a else b if v > b else v


def fmt(v, p=2):
    r = round(v, p)
    if r == 0:
        r = 0.0
    s = ("%.*f" % (p, r)).rstrip("0").rstrip(".")
    return s if s not in ("", "-0") else "0"


def rad(d):
    return d * math.pi / 180.0


def deg(r):
    return r * 180.0 / math.pi


# ---- 3D vectors / rotation matrices (row-major 3x3 as flat lists) ----------


def v_add(a, b):
    return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]


def v_sub(a, b):
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]


def v_scale(a, s):
    return [a[0] * s, a[1] * s, a[2] * s]


def v_dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def v_len(a):
    return math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2])


def v_norm(a):
    l = v_len(a) or 1.0
    return [a[0] / l, a[1] / l, a[2] / l]


def light_dir(az, el):
    """Light direction from azimuth/elevation (view space: y up, z toward viewer)."""
    a, e = rad(az), rad(el)
    return [math.sin(a) * math.cos(e), math.sin(e), math.cos(a) * math.cos(e)]


def m_mul(a, b):
    r = [0.0] * 9
    for i in range(3):
        for j in range(3):
            r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j]
    return r


def m_apply(m, v):
    return [
        m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
        m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
        m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
    ]


def rot_x(d):
    c, s = math.cos(rad(d)), math.sin(rad(d))
    return [1, 0, 0, 0, c, -s, 0, s, c]


def rot_y(d):
    c, s = math.cos(rad(d)), math.sin(rad(d))
    return [c, 0, s, 0, 1, 0, -s, 0, c]


def rot_z(d):
    c, s = math.cos(rad(d)), math.sin(rad(d))
    return [c, -s, 0, s, c, 0, 0, 0, 1]


def from_euler(rx, ry, rz):
    """R = Rx(tilt) · Ry(turn) · Rz(spin)."""
    return m_mul(rot_x(rx), m_mul(rot_y(ry), rot_z(rz)))


def to_euler(m):
    sb = clamp(m[2], -1.0, 1.0)
    b = math.asin(sb)
    if abs(sb) < 0.99999:
        a = math.atan2(-m[5], m[8])
        c = math.atan2(-m[1], m[0])
    else:
        c = 0.0
        a = math.atan2(m[3], m[4]) if sb > 0 else -math.atan2(m[3], m[4])
    return [round(deg(a), 2), round(deg(b), 2), round(deg(c), 2)]


# ---- colors -----------------------------------------------------------------


def parse_color(s, default=None):
    """'#rgb' / '#rrggbb' / 'rgb(r,g,b)' -> (r, g, b) floats 0..255."""
    if s is None:
        return default
    if isinstance(s, (tuple, list)):
        return tuple(float(v) for v in s[:3])
    s = str(s).strip().lower()
    try:
        if s.startswith("#"):
            h = s[1:]
            if len(h) in (3, 4):
                h = "".join(c * 2 for c in h[:3])
            return (float(int(h[0:2], 16)), float(int(h[2:4], 16)), float(int(h[4:6], 16)))
        if s.startswith("rgb"):
            parts = s[s.index("(") + 1 : s.index(")")].replace("/", " ").replace(",", " ").split()
            return tuple(float(p[:-1]) * 2.55 if p.endswith("%") else float(p) for p in parts[:3])
    except (ValueError, IndexError):
        return default
    named = {"black": (0, 0, 0), "white": (255, 255, 255), "red": (255, 0, 0), "blue": (0, 0, 255),
             "green": (0, 128, 0), "yellow": (255, 255, 0), "gray": (128, 128, 128), "grey": (128, 128, 128),
             "orange": (255, 165, 0), "purple": (128, 0, 128)}
    if s in named:
        return tuple(float(v) for v in named[s])
    return default


def to_hex(c):
    return "#%02x%02x%02x" % tuple(int(round(clamp(v, 0, 255))) for v in c[:3])


def mix(a, b, t):
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t)


def cscale(c, k):
    return (c[0] * k, c[1] * k, c[2] * k)


def rgb_to_hsl(c):
    r, g, b = c[0] / 255.0, c[1] / 255.0, c[2] / 255.0
    mx, mn = max(r, g, b), min(r, g, b)
    l = (mx + mn) / 2
    h = s = 0.0
    if mx != mn:
        d = mx - mn
        s = d / (2 - mx - mn) if l > 0.5 else d / (mx + mn)
        if mx == r:
            h = (g - b) / d + (6 if g < b else 0)
        elif mx == g:
            h = (b - r) / d + 2
        else:
            h = (r - g) / d + 4
        h *= 60
    return h, s, l


def hsl_to_rgb(h, s, l):
    h = ((h % 360) + 360) % 360 / 360.0

    def f(p, q, t):
        if t < 0:
            t += 1
        if t > 1:
            t -= 1
        if t < 1 / 6:
            return p + (q - p) * 6 * t
        if t < 1 / 2:
            return q
        if t < 2 / 3:
            return p + (q - p) * (2 / 3 - t) * 6
        return p

    if s == 0:
        return (l * 255, l * 255, l * 255)
    q = l * (1 + s) if l < 0.5 else l + s - l * s
    p = 2 * l - q
    return (f(p, q, h + 1 / 3) * 255, f(p, q, h) * 255, f(p, q, h - 1 / 3) * 255)


def auto_shadow(base):
    """Deep, slightly cool core-shadow tone derived from a base color."""
    h, s, l = rgb_to_hsl(base)
    dh = ((245 - h + 540) % 360) - 180
    return hsl_to_rgb(h + dh * 0.22, min(1.0, s * 0.85 + 0.1), max(0.06, l * 0.28))


# ---- 2D geometry --------------------------------------------------------------


def bez_point(p0, p1, p2, p3, t):
    mt = 1 - t
    a, b, c, d = mt * mt * mt, 3 * mt * mt * t, 3 * mt * t * t, t * t * t
    return [a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]]


def bez_split(p0, p1, p2, p3, t):
    def l(a, b):
        return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]

    p01, p12, p23 = l(p0, p1), l(p1, p2), l(p2, p3)
    p012, p123 = l(p01, p12), l(p12, p23)
    m = l(p012, p123)
    return [p0, p01, p012, m], [m, p123, p23, p3]


def bez_extrema(p0, p1, p2, p3):
    ts = []
    for k in (0, 1):
        a = -p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]
        b = 2 * (p0[k] - 2 * p1[k] + p2[k])
        c = p1[k] - p0[k]
        if abs(a) < 1e-12:
            if abs(b) > 1e-12:
                ts.append(-c / b)
        else:
            disc = b * b - 4 * a * c
            if disc >= 0:
                sq = math.sqrt(disc)
                ts += [(-b + sq) / (2 * a), (-b - sq) / (2 * a)]
    return [t for t in ts if 0 < t < 1]


def flatness(p0, p1, p2, p3):
    ux = 3 * p1[0] - 2 * p0[0] - p3[0]
    uy = 3 * p1[1] - 2 * p0[1] - p3[1]
    vx = 3 * p2[0] - 2 * p3[0] - p0[0]
    vy = 3 * p2[1] - 2 * p3[1] - p0[1]
    return max(ux * ux, vx * vx) + max(uy * uy, vy * vy)


def has_in(n):
    return abs(n["ix"] - n["x"]) > 1e-9 or abs(n["iy"] - n["y"]) > 1e-9


def has_out(n):
    return abs(n["ox"] - n["x"]) > 1e-9 or abs(n["oy"] - n["y"]) > 1e-9


def seg_count(sub):
    n = len(sub["nodes"])
    return 0 if n < 2 else n if sub["closed"] else n - 1


def seg(sub, i):
    ns = sub["nodes"]
    a, b = ns[i], ns[(i + 1) % len(ns)]
    line = not has_out(a) and not has_in(b)
    return [a["x"], a["y"]], [a["ox"], a["oy"]], [b["ix"], b["iy"]], [b["x"], b["y"]], line


def translate_subs(subs, dx, dy):
    out = []
    for s in subs:
        out.append({"closed": s["closed"], "nodes": [
            {"x": n["x"] + dx, "y": n["y"] + dy, "ix": n["ix"] + dx, "iy": n["iy"] + dy,
             "ox": n["ox"] + dx, "oy": n["oy"] + dy} for n in s["nodes"]]})
    return out


def path_bbox(subs):
    xs, ys = [], []
    for s in subs:
        for n in s["nodes"]:
            xs.append(n["x"])
            ys.append(n["y"])
        for i in range(seg_count(s)):
            p0, p1, p2, p3, line = seg(s, i)
            if line:
                continue
            for t in bez_extrema(p0, p1, p2, p3):
                q = bez_point(p0, p1, p2, p3, t)
                xs.append(q[0])
                ys.append(q[1])
    if not xs:
        return None
    return [min(xs), min(ys), max(xs), max(ys)]


def flatten(subs, tol, max_seg=float("inf")):
    tol2 = 16 * tol * tol
    out = []
    for s in subs:
        if not s["nodes"]:
            continue
        pts = [[s["nodes"][0]["x"], s["nodes"][0]["y"]]]

        def rec(p0, p1, p2, p3, depth):
            if depth > 14 or flatness(p0, p1, p2, p3) <= tol2:
                pts.append(p3)
                return
            l, r = bez_split(p0, p1, p2, p3, 0.5)
            rec(l[0], l[1], l[2], l[3], depth + 1)
            rec(r[0], r[1], r[2], r[3], depth + 1)

        for i in range(seg_count(s)):
            p0, p1, p2, p3, line = seg(s, i)
            if line:
                pts.append(p3)
            else:
                rec(p0, p1, p2, p3, 0)
        if s["closed"] and len(pts) > 1:
            f, l = pts[0], pts[-1]
            if abs(f[0] - l[0]) < 1e-9 and abs(f[1] - l[1]) < 1e-9:
                pts.pop()
        res = pts
        if max_seg != float("inf"):
            res = []
            n = len(pts)
            segs = n if s["closed"] else n - 1
            for i in range(n):
                res.append(pts[i])
                if i >= segs:
                    continue
                a, b = pts[i], pts[(i + 1) % n]
                L = math.hypot(b[0] - a[0], b[1] - a[1])
                k = int(math.ceil(L / max_seg))
                for j in range(1, k):
                    res.append([a[0] + (b[0] - a[0]) * j / k, a[1] + (b[1] - a[1]) * j / k])
        out.append({"closed": s["closed"], "pts": res})
    return out


# ---- polygons -----------------------------------------------------------------


def area(pts):
    a = 0.0
    n = len(pts)
    j = n - 1
    for i in range(n):
        a += (pts[j][0] - pts[i][0]) * (pts[j][1] + pts[i][1])
        j = i
    return a / 2


def poly_bbox(pts):
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return [min(xs), min(ys), max(xs), max(ys)]


def contains(pts, x, y):
    inside = False
    n = len(pts)
    j = n - 1
    for i in range(n):
        xi, yi = pts[i]
        xj, yj = pts[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def interior_point(pts):
    n = len(pts)
    sgn = 1 if area(pts) >= 0 else -1
    for i in range(n):
        a, b = pts[i], pts[(i + 1) % n]
        dx, dy = b[0] - a[0], b[1] - a[1]
        l = math.hypot(dx, dy)
        if l < 1e-9:
            continue
        eps = max(1e-4, l * 1e-3)
        x = (a[0] + b[0]) / 2 + (-dy / l) * eps * sgn
        y = (a[1] + b[1]) / 2 + (dx / l) * eps * sgn
        if contains(pts, x, y):
            return [x, y]
    return pts[0]


def bbox_contains(o, i):
    return i[0] >= o[0] and i[2] <= o[2] and i[1] >= o[1] and i[3] <= o[3]


def classify(contours):
    """Even-odd nesting: outer rings counter-clockwise, holes clockwise (y-up)."""
    rings = []
    for pts in contours:
        if len(pts) >= 3 and abs(area(pts)) > 1e-9:
            rings.append({"pts": pts, "bbox": poly_bbox(pts), "abs": abs(area(pts))})
    for r in rings:
        p = interior_point(r["pts"])
        r["depth"] = 0
        r["parent"] = None
        best = float("inf")
        for o in rings:
            if o is r or o["abs"] < r["abs"] or not bbox_contains(o["bbox"], r["bbox"]):
                continue
            if contains(o["pts"], p[0], p[1]):
                r["depth"] += 1
                if o["abs"] < best:
                    best = o["abs"]
                    r["parent"] = o
        r["hole"] = r["depth"] % 2 == 1
        if (area(r["pts"]) > 0) == r["hole"]:
            r["pts"] = r["pts"][::-1]
    for r in rings:
        if r["hole"]:
            p = r["parent"]
            while p is not None and p["hole"]:
                p = p["parent"]
            r["parent"] = p
    return rings


def rdp(pts, eps):
    if len(pts) < 3:
        return list(pts)
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        s, e = stack.pop()
        ax, ay = pts[s]
        bx, by = pts[e]
        dx, dy = bx - ax, by - ay
        L = math.hypot(dx, dy)
        md, mi = -1.0, -1
        for i in range(s + 1, e):
            if L < 1e-12:
                d = math.hypot(pts[i][0] - ax, pts[i][1] - ay)
            else:
                d = abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / L
            if d > md:
                md, mi = d, i
        if md > eps:
            keep[mi] = True
            stack += [(s, mi), (mi, e)]
    return [p for p, k in zip(pts, keep) if k]


def ray_seg(ox, oy, dx, dy, ax, ay, bx, by):
    ex, ey = bx - ax, by - ay
    den = dx * ey - dy * ex
    if abs(den) < 1e-12:
        return float("inf")
    t = ((ax - ox) * ey - (ay - oy) * ex) / den
    u = ((ax - ox) * dy - (ay - oy) * dx) / den
    return t if t > 1e-9 and -1e-9 <= u <= 1 + 1e-9 else float("inf")


def miters(pts, limit=4.0):
    n = len(pts)
    out = []
    for i in range(n):
        p, c, q = pts[i - 1], pts[i], pts[(i + 1) % n]
        ax, ay = c[0] - p[0], c[1] - p[1]
        bx, by = q[0] - c[0], q[1] - c[1]
        la = math.hypot(ax, ay) or 1.0
        lb = math.hypot(bx, by) or 1.0
        ax, ay, bx, by = ax / la, ay / la, bx / lb, by / lb
        n1x, n1y, n2x, n2y = -ay, ax, -by, bx
        mx, my = n1x + n2x, n1y + n2y
        ml = math.hypot(mx, my)
        if ml < 1e-6:
            out.append([n1x, n1y])
            continue
        mx, my = mx / ml, my / ml
        s = 1.0 / max(mx * n1x + my * n1y, 1.0 / limit)
        out.append([mx * s, my * s])
    return out


def max_inset(rings, mits):
    edges = []
    for r in rings:
        n = len(r)
        for i in range(n):
            edges.append((r[i], r[(i + 1) % n]))
    res = []
    for ri, r in enumerate(rings):
        lim = []
        for i, pt in enumerate(r):
            m = mits[ri][i]
            ml = math.hypot(m[0], m[1]) or 1.0
            dx, dy = m[0] / ml, m[1] / ml
            best = float("inf")
            for a, b in edges:
                if a is pt or b is pt:
                    continue
                t = ray_seg(pt[0], pt[1], dx, dy, a[0], a[1], b[0], b[1])
                if t < best:
                    best = t
            lim.append(best * 0.5 / ml)
        res.append(lim)
    return res


def offset_ring(pts, mits, o, limits):
    n = len(pts)
    out = []
    for i in range(n):
        d = o
        if limits is not None and d > 0 and d > limits[i]:
            d = limits[i]
        out.append([pts[i][0] + mits[i][0] * d, pts[i][1] + mits[i][1] * d])
    if abs(o) < 1e-9:
        return out
    for _ in range(6):
        changed = False
        for i in range(n):
            j = (i + 1) % n
            ox, oy = pts[j][0] - pts[i][0], pts[j][1] - pts[i][1]
            nx, ny = out[j][0] - out[i][0], out[j][1] - out[i][1]
            if ox * nx + oy * ny < -1e-9:
                m = [(out[i][0] + out[j][0]) / 2, (out[i][1] + out[j][1]) / 2]
                out[i] = list(m)
                out[j] = list(m)
                changed = True
        if not changed:
            break
    return out


def clip_x(pts, x0, keep=1):
    def inside(p):
        return p[0] >= x0 - 1e-9 if keep > 0 else p[0] <= x0 + 1e-9

    out = []
    n = len(pts)
    for i in range(n):
        a, b = pts[i], pts[(i + 1) % n]
        ia, ib = inside(a), inside(b)
        if ia:
            out.append(a)
        if ia != ib:
            t = (x0 - a[0]) / (b[0] - a[0])
            out.append([x0, a[1] + (b[1] - a[1]) * t])
    return out


def dedupe(pts, eps=1e-7, closed=True):
    out = []
    for p in pts:
        if not out or abs(out[-1][0] - p[0]) > eps or abs(out[-1][1] - p[1]) > eps:
            out.append(p)
    if closed and len(out) > 1 and abs(out[-1][0] - out[0][0]) <= eps and abs(out[-1][1] - out[0][1]) <= eps:
        out.pop()
    return out


# --------------------------------------------------------------------------
# meshes: object space x right, y up, z toward the viewer, centred on origin
# --------------------------------------------------------------------------


def _arc(n, f):
    steps = max(1, n)
    return [f(i / steps * math.pi / 2) for i in range(steps + 1)]


def _ogee(n):
    h = max(2, int(math.ceil(n / 2)))
    a = _arc(h, lambda t: [1 - 0.5 * math.sin(t), 0.5 - 0.5 * math.cos(t)])
    b = _arc(h, lambda t: [0.5 * math.cos(t), 0.5 + 0.5 * math.sin(t)])
    return a + b[1:]


BEVELS = {
    "classic": lambda n: [[1, 0], [0, 1]],
    "round": lambda n: _arc(n, lambda t: [1 - math.sin(t), 1 - math.cos(t)]),
    "cove": lambda n: _arc(n, lambda t: [math.cos(t), math.sin(t)]),
    "ogee": _ogee,
    "step": lambda n: [[1, 0], [1, 0.5], [0.5, 0.5], [0.5, 1], [0, 1]],
    "chisel": lambda n: [[1, 0], [0.35, 0.18], [0, 1]],
}

INFLATE_PROFILES = {
    "round": lambda t: math.sqrt(max(0.0, 1 - (1 - t) * (1 - t))),
    "pillow": lambda t: 1 - (1 - t) * (1 - t),
    "dome": lambda t: math.sin(t * math.pi / 2),
    "soft": lambda t: t * t * (3 - 2 * t),
    "cone": lambda t: t,
}


def mesh_extrude(rings, open_runs, o):
    verts, faces = [], []
    D = max(0.0, o.get("depth", 0))
    zf, zb = D / 2, -D / 2
    bevel = o.get("bevel", "none")
    has_bevel = bevel != "none" and bevel in BEVELS and o.get("bevel_w", 0) > 0
    prof, Hb = [], 0.0
    if has_bevel:
        Hb = max(0.0, o.get("bevel_h", o["bevel_w"]))
        max_h = D / 2 if o.get("bevel_sides") == "both" else D
        Hb = min(Hb, max_h)
        prof = BEVELS[bevel](o.get("bevel_segs", 4))
    W = o.get("bevel_w", 0) if has_bevel else 0.0

    def off(ov):
        return (ov - 1) * W if o.get("bevel_out") else ov * W

    stack = []
    if has_bevel:
        for i, (ov, zv) in enumerate(prof):
            stack.append((off(ov), zf - zv * Hb, i == len(prof) - 1))
        if o.get("bevel_sides") == "both":
            for i, (ov, zv) in enumerate(prof[::-1]):
                stack.append((off(ov), zb + zv * Hb, i == 0))
        else:
            stack.append((off(0), zb, True))
    else:
        stack = [(0.0, zf, True), (0.0, zb, True)]
    rs = [r for i, r in enumerate(stack) if i == 0 or abs(r[0] - stack[i - 1][0]) > 1e-9 or abs(r[1] - stack[i - 1][1]) > 1e-9]

    all_pts = [r["pts"] for r in rings]
    mits = [miters(p) for p in all_pts]
    limits = max_inset(all_pts, mits) if any(r[0] > 1e-9 for r in rs) else None
    ring_idx = []
    for ri, ring in enumerate(rings):
        idx = []
        for ov, z, _ in rs:
            pts = ring["pts"] if abs(ov) < 1e-9 else offset_ring(ring["pts"], mits[ri], ov, limits[ri] if limits else None)
            base = len(verts)
            for p in pts:
                verts.append([p[0], p[1], z])
            idx.append(list(range(base, base + len(pts))))
        ring_idx.append(idx)
        n = len(ring["pts"])
        for k in range(len(rs) - 1):
            A, B = idx[k], idx[k + 1]
            mat = "side" if rs[k][2] and rs[k + 1][2] else "bevel"
            for i in range(n):
                j = (i + 1) % n
                faces.append({"loops": [[A[i], B[i], B[j], A[j]]], "mat": mat})
    if o.get("caps", True):
        for si, s in enumerate(rings):
            if s["hole"]:
                continue
            holes = [ri for ri, r in enumerate(rings) if r["hole"] and r["parent"] is s]
            front = [ring_idx[si][0]] + [ring_idx[h][0] for h in holes]
            back = [ring_idx[si][-1][::-1]] + [ring_idx[h][-1][::-1] for h in holes]
            faces.append({"loops": front, "mat": "front", "cap": "front"})
            faces.append({"loops": back, "mat": "back", "cap": "back"})
    for pts in open_runs or []:
        if len(pts) < 2:
            continue
        base = len(verts)
        for p in pts:
            verts.append([p[0], p[1], zf])
        for p in pts:
            verts.append([p[0], p[1], zb])
        n = len(pts)
        for i in range(n - 1):
            faces.append({"loops": [[base + i, base + n + i, base + n + i + 1, base + i + 1]], "mat": "side", "ds": True})
    closed = o.get("caps", True)
    if not closed:
        for f in faces:
            f["ds"] = True
    return {"verts": verts, "faces": faces, "closed": closed, "cap_exact": not has_bevel or bool(o.get("bevel_out")), "cap_z": [zf, zb]}


def _dedupe_loop(l):
    out = []
    for v in l:
        if not out or out[-1] != v:
            out.append(v)
    while len(out) > 1 and out[0] == out[-1]:
        out.pop()
    return out


def mesh_revolve(rings, open_runs, o):
    verts, faces = [], []
    A = max(1.0, min(360.0, o.get("angle", 360)))
    full = A >= 359.99
    N = max(3, int(round(o.get("segments", 48))))
    steps = N if full else N + 1

    def sweep(pts, closed_profile, mat, ds):
        idx = []
        for p in pts:
            r = max(0.0, p[0])
            if r < 1e-6:
                verts.append([0.0, p[1], 0.0])
                idx.append([len(verts) - 1] * steps)
                continue
            row = []
            for k in range(steps):
                t = rad(k * A / N)
                verts.append([r * math.cos(t), p[1], -r * math.sin(t)])
                row.append(len(verts) - 1)
            idx.append(row)
        n = len(pts)
        segs = n if closed_profile else n - 1
        for j in range(segs):
            a, b = idx[j], idx[(j + 1) % n]
            if a[0] == b[0] and a[1] == b[1]:
                continue
            for k in range(N):
                k2 = (k + 1) % N if full else k + 1
                loop = _dedupe_loop([a[k], a[k2], b[k2], b[k]])
                if len(loop) >= 3:
                    faces.append({"loops": [loop], "mat": mat, "ds": ds})
        return idx

    ring_idx = [sweep(r["pts"], True, "side", False) for r in rings]
    for run in open_runs or []:
        sweep(run, False, "side", True)
    if not full and o.get("caps", True):
        for si, s in enumerate(rings):
            if s["hole"]:
                continue
            holes = [ri for ri, r in enumerate(rings) if r["hole"] and r["parent"] is s]
            l0 = [[row[0] for row in ring_idx[si]]] + [[row[0] for row in ring_idx[h]] for h in holes]
            l1 = [[row[steps - 1] for row in ring_idx[si]][::-1]] + [[row[steps - 1] for row in ring_idx[h]][::-1] for h in holes]
            for loops in (l0, l1):
                loops = [x for x in (_dedupe_loop(l) for l in loops) if len(x) >= 3]
                if loops:
                    faces.append({"loops": loops, "mat": "front"})
    closed = (full or o.get("caps", True)) and not open_runs
    if not closed:
        for f in faces:
            f["ds"] = True
    return {"verts": verts, "faces": [f for f in faces if f["loops"] and len(f["loops"][0]) >= 3], "closed": closed}


def mesh_inflate(rings, o):
    verts, faces = [], []
    if not rings:
        return {"verts": verts, "faces": faces, "closed": True}
    bx0 = min(min(p[0] for p in r["pts"]) for r in rings)
    by0 = min(min(p[1] for p in r["pts"]) for r in rings)
    bx1 = max(max(p[0] for p in r["pts"]) for r in rings)
    by1 = max(max(p[1] for p in r["pts"]) for r in rings)
    Nd = max(8, min(160, int(round(o.get("detail", 40)))))
    size = max(bx1 - bx0, by1 - by0)
    cs = size / Nd
    x0, y0 = bx0 - cs, by0 - cs
    nx = int(math.ceil((bx1 - bx0) / cs)) + 3
    ny = int(math.ceil((by1 - by0) / cs)) + 3
    segs = []
    for r in rings:
        p = r["pts"]
        for i in range(len(p)):
            a, b = p[i], p[(i + 1) % len(p)]
            segs.append((a[0], a[1], b[0] - a[0], b[1] - a[1]))
    sd = [0.0] * (nx * ny)
    max_d = 0.0
    for j in range(ny):
        y = y0 + j * cs
        xs = sorted(ax + (y - ay) * dx / dy for ax, ay, dx, dy in segs if (ay > y) != (ay + dy > y))
        ci = 0
        for i in range(nx):
            x = x0 + i * cs
            while ci < len(xs) and xs[ci] < x:
                ci += 1
            best = float("inf")
            for ax, ay, dx, dy in segs:
                l2 = dx * dx + dy * dy
                t = ((x - ax) * dx + (y - ay) * dy) / l2 if l2 else 0.0
                t = 0.0 if t < 0 else 1.0 if t > 1 else t
                ex, ey = ax + t * dx - x, ay + t * dy - y
                d2 = ex * ex + ey * ey
                if d2 < best:
                    best = d2
            d = math.sqrt(best) * (1 if ci % 2 == 1 else -1)
            sd[j * nx + i] = d
            max_d = max(max_d, d)
    prof = INFLATE_PROFILES.get(o.get("profile", "round"), INFLATE_PROFILES["round"])
    R = max(1e-6, max_d * max(0.05, min(1.0, o.get("spread", 1.0))))
    H = o.get("height", 40.0)
    both = o.get("sides", "both") != "front"
    z_shift = 0.0 if both else -H / 2
    f_idx = {}
    b_idx = {}
    e_idx = {}

    def corner(i, j, front):
        g = j * nx + i
        store = f_idx if front else b_idx
        if g not in store:
            h = H * prof(min(1.0, max(0.0, sd[g]) / R))
            verts.append([x0 + i * cs, y0 + j * cs, (h if front else (-h if both else 0.0)) + z_shift])
            store[g] = len(verts) - 1
        return store[g]

    def edge_v(i1, j1, i2, j2):
        g1, g2 = j1 * nx + i1, j2 * nx + i2
        key = (min(g1, g2), max(g1, g2))
        if key not in e_idx:
            d1, d2 = sd[g1], sd[g2]
            t = d1 / (d1 - d2)
            verts.append([x0 + (i1 + (i2 - i1) * t) * cs, y0 + (j1 + (j2 - j1) * t) * cs, z_shift])
            e_idx[key] = len(verts) - 1
        return e_idx[key]

    for j in range(ny - 1):
        for i in range(nx - 1):
            c4 = [(i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)]
            ins = [sd[b * nx + a] > 0 for a, b in c4]
            cnt = sum(ins)
            if not cnt:
                continue

            def emit(poly, front):
                if len(poly) >= 3:
                    faces.append({"loops": [poly if front else poly[::-1]], "mat": "front" if front else "back"})

            if cnt == 2 and ins[0] == ins[2]:
                centre = (sd[j * nx + i] + sd[j * nx + i + 1] + sd[(j + 1) * nx + i + 1] + sd[(j + 1) * nx + i]) / 4
                if centre <= 0:
                    for front in (True, False):
                        for k in range(4):
                            if not ins[k]:
                                continue
                            a, b = c4[k]
                            pv, nv = c4[(k + 3) % 4], c4[(k + 1) % 4]
                            emit([edge_v(pv[0], pv[1], a, b), corner(a, b, front), edge_v(a, b, nv[0], nv[1])], front)
                    continue
            for front in (True, False):
                poly = []
                for k in range(4):
                    a, b = c4[k]
                    c, d = c4[(k + 1) % 4]
                    if ins[k]:
                        poly.append(corner(a, b, front))
                    if ins[k] != ins[(k + 1) % 4]:
                        poly.append(edge_v(a, b, c, d))
                emit(poly, front)
    return {"verts": verts, "faces": faces, "closed": True}


def mesh_flat(rings):
    verts, faces = [], []
    idx = []
    for r in rings:
        row = []
        for p in r["pts"]:
            verts.append([p[0], p[1], 0.0])
            row.append(len(verts) - 1)
        idx.append(row)
    for si, s in enumerate(rings):
        if s["hole"]:
            continue
        loops = [idx[si]] + [idx[ri] for ri, r in enumerate(rings) if r["hole"] and r["parent"] is s]
        faces.append({"loops": loops, "mat": "front", "cap": "front", "ds": True})
    return {"verts": verts, "faces": faces, "closed": False, "cap_exact": True, "cap_z": [0.0, 0.0]}


def finalize(mesh, smooth_deg=35.0):
    V = mesh["verts"]
    nV = len(V)

    def same(a, b):
        va, vb = V[a], V[b]
        return abs(va[0] - vb[0]) < 1e-7 and abs(va[1] - vb[1]) < 1e-7 and abs(va[2] - vb[2]) < 1e-7

    faces = []
    for f in mesh["faces"]:
        loops = []
        for l in f["loops"]:
            out = []
            for v in l:
                if not out or not same(out[-1], v):
                    out.append(v)
            while len(out) > 1 and same(out[0], out[-1]):
                out.pop()
            if len(out) >= 3:
                loops.append(out)
        if not loops:
            continue
        f["loops"] = loops
        l = loops[0]
        nx = ny = nz = 0.0
        for i in range(len(l)):
            a, b = V[l[i]], V[l[(i + 1) % len(l)]]
            nx += (a[1] - b[1]) * (a[2] + b[2])
            ny += (a[2] - b[2]) * (a[0] + b[0])
            nz += (a[0] - b[0]) * (a[1] + b[1])
        nl = math.sqrt(nx * nx + ny * ny + nz * nz)
        if nl < 1e-10:
            continue
        cx = cy = cz = 0.0
        cnt = 0
        for lp in loops:
            for v in lp:
                cx += V[v][0]
                cy += V[v][1]
                cz += V[v][2]
                cnt += 1
        f["n"] = [nx / nl, ny / nl, nz / nl]
        f["area"] = nl / 2
        f["c"] = [cx / cnt, cy / cnt, cz / cnt]
        faces.append(f)
    mesh["faces"] = faces
    mesh["radius"] = max((v_len(v) for v in V), default=1.0) or 1.0
    inc = [[] for _ in range(nV)]
    edges = {}
    for fi, f in enumerate(faces):
        for l in f["loops"]:
            for i in range(len(l)):
                a, b = l[i], l[(i + 1) % len(l)]
                inc[a].append(fi)
                key = (a, b) if a < b else (b, a)
                e = edges.get(key)
                if e is None:
                    e = edges[key] = {"a": a, "b": b, "f": []}
                e["f"].append(fi)
    mesh["edges"] = list(edges.values())
    cos_t = math.cos(rad(smooth_deg))
    for f in faces:
        if len(f["loops"]) != 1 or f.get("cap"):
            continue
        cn = []
        for v in f["loops"][0]:
            sx = sy = sz = 0.0
            for gi in set(inc[v]):
                g = faces[gi]
                if v_dot(g["n"], f["n"]) < cos_t:
                    continue
                w = math.sqrt(g["area"]) + 1e-9
                sx += g["n"][0] * w
                sy += g["n"][1] * w
                sz += g["n"][2] * w
            cn.append(v_norm([sx, sy, sz]))
        f["cn"] = cn
    return mesh


# --------------------------------------------------------------------------
# settings
# --------------------------------------------------------------------------

KINDS = ("flat", "extrude", "revolve", "inflate")
SHADINGS = ("flat", "matte", "plastic", "toon", "metal", "lineart", "wire")

ISO = 35.2644
PRESETS = {
    "front": (0, 0, 0),
    "offaxis": (20, -30, 0),
    "offaxis-l": (20, 30, 0),
    "hero": (-18, -32, 0),
    "iso-l": (ISO, -45, 0),
    "iso-r": (ISO, 45, 0),
    "iso-t": tuple(to_euler(m_mul(rot_x(ISO), m_mul(rot_y(-45), rot_x(-90))))),
    "top": (58, 0, 0),
    "turn-l": (0, 48, 0),
    "turn-r": (0, -48, 0),
    "tilt": (-40, 0, 0),
    "dimetric": (20.7, -41.4, 0),
}

MATERIALS = {
    "glossy": {"shading": "plastic", "smooth": True, "steps": 0, "edges": "none"},
    "clay": {"shading": "matte", "smooth": True, "steps": 0, "edges": "none"},
    "toon": {"shading": "toon", "steps": 3, "edges": "outline", "edge_width": 2.0, "edge_color": "#1b1c22"},
    "poster": {"shading": "matte", "steps": 2, "smooth": True, "edges": "none"},
    "chrome": {"shading": "metal", "steps": 0, "smooth": True, "edges": "none", "fill": "#c3cad6"},
    "gold": {"shading": "metal", "steps": 0, "smooth": True, "edges": "none", "fill": "#e2b44a"},
    "copper": {"shading": "metal", "steps": 0, "smooth": True, "edges": "none", "fill": "#d27b52"},
    "lineart": {"shading": "lineart", "edges": "outline", "edge_color": "#1b1c22", "edge_width": 1.6},
    "wire": {"shading": "wire", "edge_color": "#2f6fed", "edge_width": 0.8},
    "flat": {"shading": "flat", "edges": "none", "steps": 0},
}


def defaults(kind="extrude", size=200.0):
    depth = round(clamp(size * 0.22, 8, 90))
    bw = max(1, round(depth * 0.18))
    return {
        "kind": kind,
        "rx": 30 if kind == "flat" else 20, "ry": -25 if kind == "flat" else -30, "rz": 0, "persp": 0,
        "depth": depth, "caps": True, "bevel": "none", "bevel_w": bw, "bevel_h": bw,
        "bevel_sides": "front", "bevel_out": False, "bevel_segs": 5,
        "rev_angle": 360, "rev_axis": "left", "rev_offset": 0, "rev_segs": 48, "rev_caps": True,
        "inf_height": round(clamp(size * 0.2, 6, 80)), "inf_profile": "round", "inf_spread": 1.0,
        "inf_sides": "both", "inf_detail": 40,
        "shading": "plastic", "smooth": True, "smooth_angle": 35, "steps": 0,
        "side_color": None, "bevel_color": None, "back_color": None,
        "shadow_tint": "auto", "highlight": "#ffffff",
        "light": {"az": -45, "el": 40, "intensity": 1.0, "ambient": 0.35, "fill": 0.25, "specular": 0.45, "gloss": 55},
        "edges": "none", "edge_color": "#1b1c22", "edge_width": 1.5, "crease_angle": 40,
        "shadow": "none", "shadow_opacity": 0.28, "shadow_blur": 6, "shadow_dist": 40, "shadow_color": "#10121a",
        "seam": 1.0,
    }


# --------------------------------------------------------------------------
# geometry preparation
# --------------------------------------------------------------------------


def prepare(subs, fx):
    """World subpaths -> object-space contours (rings, open runs) for the chosen kind."""
    bb = path_bbox(subs)
    if not bb:
        return None
    diag = math.hypot(bb[2] - bb[0], bb[3] - bb[1]) or 1.0
    tol = max(0.05, diag * 0.0015)
    max_seg = float("inf")
    kind = fx["kind"]
    if kind == "extrude":
        max_seg = clamp(fx["depth"] * 1.4, diag / 70, diag / 8)
    budget = float("inf")
    if kind == "revolve":
        budget = 14000.0 / max(6, fx["rev_segs"])
    elif kind == "extrude":
        has_bevel = fx["bevel"] != "none" and fx["bevel_w"] > 0
        rings = fx["bevel_segs"] * (2 if fx["bevel_sides"] == "both" else 1) + 2 if has_bevel else 2
        budget = 10000.0 / rings
    elif kind == "flat":
        budget = 20000.0

    flat = flatten(subs, tol, max_seg)
    for _ in range(12):
        if sum(len(f["pts"]) for f in flat) <= budget:
            break
        if tol < diag * 0.02:
            tol *= 1.6
        elif max_seg != float("inf"):
            max_seg *= 1.8
        flat = flatten(subs, tol, max_seg)
        if sum(len(f["pts"]) for f in flat) > budget and tol >= diag * 0.02:
            flat = [{"closed": f["closed"], "pts": (rdp(f["pts"] + [f["pts"][0]], tol)[:-1] if f["closed"] else rdp(f["pts"], tol))} for f in flat]
            break

    cx, cy = (bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2
    closed_c, open_c = [], []
    start_angle = 0
    if kind == "revolve":
        axis = fx["rev_axis"]
        ax = bb[2] if axis == "right" else cx if axis == "center" else bb[0]
        sign = -1 if axis == "right" else 1
        start_angle = 180 if axis == "right" else 0
        off = fx["rev_offset"]
        for f in flat:
            pts = f["pts"]
            if axis == "center":
                pts = clip_x(pts, ax, 1) if f["closed"] else [[max(ax, p[0]), p[1]] for p in pts]
            prof = [[max(0.0, sign * (p[0] - ax) + off), cy - p[1]] for p in pts]
            if f["closed"]:
                dd = dedupe(prof)
                if len(dd) >= 3:
                    closed_c.append(dd)
            elif len(prof) >= 2:
                open_c.append(prof)
        cx = ax
    else:
        for f in flat:
            pts = [[p[0] - cx, cy - p[1]] for p in f["pts"]]
            if f["closed"]:
                dd = dedupe(pts)
                if len(dd) >= 3:
                    closed_c.append(dd)
            elif len(pts) >= 2:
                open_c.append(pts)
    cap_subs = []
    for s in subs:
        if not s["closed"]:
            continue
        cap_subs.append([{"x": n["x"] - cx, "y": cy - n["y"], "ix": n["ix"] - cx, "iy": cy - n["iy"],
                          "ox": n["ox"] - cx, "oy": cy - n["oy"]} for n in s["nodes"]])
    return {"rings": classify(closed_c), "open": open_c, "center": [cx, cy], "bbox": bb,
            "cap_subs": cap_subs, "start_angle": start_angle}


def build_mesh(geom, fx):
    k = fx["kind"]
    if k == "extrude":
        mesh = mesh_extrude(geom["rings"], geom["open"], {
            "depth": fx["depth"], "caps": fx["caps"], "bevel": fx["bevel"], "bevel_w": fx["bevel_w"],
            "bevel_h": fx["bevel_h"], "bevel_sides": fx["bevel_sides"], "bevel_out": fx["bevel_out"],
            "bevel_segs": fx["bevel_segs"]})
    elif k == "revolve":
        mesh = mesh_revolve(geom["rings"], geom["open"], {"angle": fx["rev_angle"], "segments": fx["rev_segs"], "caps": fx["rev_caps"]})
        if geom["start_angle"]:
            for v in mesh["verts"]:
                v[0], v[2] = -v[0], -v[2]
    elif k == "inflate":
        mesh = mesh_inflate(geom["rings"], {"height": fx["inf_height"], "profile": fx["inf_profile"],
                                            "spread": fx["inf_spread"], "sides": fx["inf_sides"], "detail": fx["inf_detail"]})
    else:
        mesh = mesh_flat(geom["rings"])
    return finalize(mesh, fx["smooth_angle"])


# --------------------------------------------------------------------------
# shading
# --------------------------------------------------------------------------

WHITE = (255.0, 255.0, 255.0)


def ramp(base, fx):
    sh = fx["shading"]
    if sh in ("flat", "lineart", "wire"):
        return [(0.0, base)]
    hi = parse_color(fx["highlight"], WHITE)
    if sh == "metal":
        return [(0, cscale(base, 0.1)), (0.32, cscale(base, 0.55)), (0.47, cscale(base, 0.22)),
                (0.53, mix(base, hi, 0.55)), (0.78, base), (1.0, mix(base, hi, 0.8)), (1.25, hi), (2, hi)]
    tint = fx["shadow_tint"]
    if tint == "black":
        shadow = (0.0, 0.0, 0.0)
    elif tint and tint != "auto":
        shadow = parse_color(tint) or auto_shadow(base)
    else:
        shadow = auto_shadow(base)
    return [(0.0, shadow), (1.0, base), (2.0, hi)]


def ramp_color(st, u):
    if u <= st[0][0]:
        return st[0][1]
    for i in range(1, len(st)):
        if u <= st[i][0]:
            a, b = st[i - 1], st[i]
            return mix(a[1], b[1], (u - a[0]) / ((b[0] - a[0]) or 1))
    return st[-1][1]


def light_rig(L0):
    L = light_dir(L0["az"], L0["el"])
    L2 = v_norm([-L[0], -L[1] * 0.3, max(0.25, L[2])])
    amb = clamp(L0["ambient"], 0, 1)
    ref = max(0.45, amb + (1 - amb) * (max(0.0, L[2]) + L0["fill"] * max(0.0, L2[2])))
    shin = 2 + (clamp(L0["gloss"], 0, 100) / 100.0) ** 2 * 180
    return {"L": L, "L2": L2, "amb": amb, "ref": ref, "I": L0["intensity"], "F": L0["fill"], "S": L0["specular"], "shin": shin}


def shade(n, V, rig, mode):
    if mode == "metal":
        nv = v_dot(n, V)
        r = [2 * nv * n[0] - V[0], 2 * nv * n[1] - V[1], 2 * nv * n[2] - V[2]]
        H = v_norm(v_add(rig["L"], V))
        return (r[1] + 1) / 2 + max(0.0, v_dot(n, H)) ** (rig["shin"] * 1.5) * rig["S"] * 1.6
    d = max(0.0, v_dot(n, rig["L"]))
    f = max(0.0, v_dot(n, rig["L2"]))
    u = (rig["amb"] + (1 - rig["amb"]) * (rig["I"] * d + rig["F"] * f)) / rig["ref"]
    u = min(u, 1.8)
    if mode in ("plastic", "toon"):
        H = v_norm(v_add(rig["L"], V))
        sp = max(0.0, v_dot(n, H)) ** rig["shin"] * rig["S"] * (1 if mode == "toon" else 1.2)
        u += (1 if sp > 0.35 else 0) if mode == "toon" else sp
    return u


def quant(u, steps):
    if not steps:
        return u
    bw = 2.0 / steps
    b = min(steps - 1, max(0, int(math.floor(u / bw))))
    return (b + 0.5) * bw


# --------------------------------------------------------------------------
# rendering
# --------------------------------------------------------------------------


def render(subs, fx_in, fill="#f2a541", opacity=1.0, id_prefix="v3d", pivot=None):
    """Render shapes with 3D settings `fx_in`. Returns dict(defs, body, bbox, faces).

    `defs` is a list of gradient/filter markup strings (place them in <defs>),
    `body` the markup of the faces (place it in a <g>). Coordinates are in the
    same space as `subs`.
    """
    fx = defaults(fx_in.get("kind", "extrude"))
    fx.update({k: v for k, v in fx_in.items() if k != "light"})
    fx["light"] = dict(defaults()["light"], **(fx_in.get("light") or {}))
    geom = prepare(subs, fx)
    if not geom or (not geom["rings"] and not geom["open"]):
        return {"defs": [], "body": "", "bbox": None, "faces": 0}
    mesh = build_mesh(geom, fx)
    gcx, gcy = geom["center"]
    cx, cy = pivot if pivot else geom["center"]
    off = [gcx - cx, cy - gcy, 0.0]
    has_off = abs(off[0]) > 1e-9 or abs(off[1]) > 1e-9
    R = from_euler(fx["rx"], fx["ry"], fx["rz"])
    fov = clamp(fx["persp"], 0, 160)
    persp = fov > 0.5
    radius = mesh["radius"] + math.hypot(off[0], off[1])
    dist = radius * (1.1 + 1 / math.tan(rad(fov / 2))) if persp else float("inf")
    cam = [0.0, 0.0, dist]

    def project(p):
        k = dist / max(1e-6, dist - p[2]) if persp else 1.0
        return [cx + p[0] * k, cy - p[1] * k]

    P, S = [], []
    xs, ys = [], []
    for v in mesh["verts"]:
        p = m_apply(R, [v[0] + off[0], v[1] + off[1], v[2]] if has_off else v)
        P.append(p)
        s = project(p)
        S.append(s)
        xs.append(s[0])
        ys.append(s[1])
    if not S:
        return {"defs": [], "body": "", "bbox": None, "faces": 0}
    bbox = [min(xs), min(ys), max(xs), max(ys)]

    def add_bbox(x, y):
        bbox[0], bbox[1] = min(bbox[0], x), min(bbox[1], y)
        bbox[2], bbox[3] = max(bbox[2], x), max(bbox[3], y)

    rig = light_rig(fx["light"])
    mode = fx["shading"]
    steps = (fx["steps"] or 3) if mode == "toon" else (fx["steps"] or 0)
    smooth = bool(fx["smooth"]) and mode not in ("flat", "lineart", "wire")
    base = parse_color(fill, (200.0, 200.0, 210.0))
    lineart = mode == "lineart"
    paper = WHITE if lineart else None
    mb = {"front": paper or base, "side": paper or parse_color(fx["side_color"]) or base}
    mb["bevel"] = paper or parse_color(fx["bevel_color"]) or mb["side"]
    mb["back"] = paper or parse_color(fx["back_color"]) or mb["front"]
    mb["inner"] = paper or mix(mb["side"], (0.0, 0.0, 0.0), 0.15)
    mats = {k: ramp(v, fx) for k, v in mb.items()}
    wire = mode == "wire"
    edges_mode = "outline" if lineart and fx["edges"] == "none" else fx["edges"]

    def view_dir(c):
        return v_norm(v_sub(cam, c)) if persp else [0.0, 0.0, 1.0]

    vis = []
    for fi, f in enumerate(mesh["faces"]):
        n = m_apply(R, f["n"])
        c = m_apply(R, [f["c"][0] + off[0], f["c"][1] + off[1], f["c"][2]] if has_off else f["c"])
        V = view_dir(c)
        flip = False
        if v_dot(n, V) <= 0:
            if not wire and mesh["closed"] and not f.get("ds"):
                continue
            flip = True
        mat = f["mat"]
        if flip:
            mat = "back" if (f["mat"] == "front" or fx["kind"] == "flat") else "inner"
        depth = -v_len(v_sub(cam, c)) if persp else c[2]
        vis.append({"f": f, "fi": fi, "n": v_scale(n, -1) if flip else n, "c": c, "V": V, "mat": mat, "flip": flip,
                    "key": float("inf") if f.get("cap") and not flip else depth})
    vis.sort(key=lambda v: v["key"])
    rank = {v["fi"]: i for i, v in enumerate(vis)}

    face_edges = {}
    if edges_mode == "outline" and not wire:
        cos_c = math.cos(rad(fx["crease_angle"]))
        for e in mesh["edges"]:
            vf = [fi for fi in e["f"] if fi in rank]
            if not vf:
                continue
            owner = -1
            if len(vf) == 1 or len(e["f"]) == 1:
                owner = vf[0]
            else:
                a, b = vis[rank[vf[0]]], vis[rank[vf[1]]]
                if v_dot(a["n"], b["n"]) < cos_c:
                    owner = vf[0] if rank[vf[0]] > rank[vf[1]] else vf[1]
            if owner >= 0:
                face_edges.setdefault(owner, []).append((e["a"], e["b"]))

    seam = fx["seam"]
    edge_color = to_hex(parse_color(fx["edge_color"], (27, 28, 34)))
    ew = fmt(fx["edge_width"], 2)
    all_edges = edges_mode == "all" or wire
    out, defs = [], []
    counter = [0]
    face_count = 0

    def pt(i):
        return fmt(S[i][0], 1) + " " + fmt(S[i][1], 1)

    def loop_d(loops):
        return "".join("M" + "L".join(pt(v) for v in l) + "Z" for l in loops)

    def stroke_for(color):
        if all_edges:
            return ' class="e" stroke="%s" stroke-width="%s" stroke-linejoin="round"' % (edge_color, ew)
        return ' stroke="%s"' % color if seam > 0 else ""

    def emit_edges(fi):
        lst = face_edges.get(fi)
        if not lst:
            return
        d = "".join("M" + pt(a) + "L" + pt(b) for a, b in lst)
        out.append('<path class="e" d="%s" fill="none" stroke="%s" stroke-width="%s" stroke-linecap="round" stroke-linejoin="round"/>' % (d, edge_color, ew))

    def plane_fit(pts, us):
        n = len(pts)
        mx = sum(p[0] for p in pts) / n
        my = sum(p[1] for p in pts) / n
        mu = sum(us) / n
        sxx = sxy = syy = sxu = syu = 0.0
        for (x, y), u in zip(pts, us):
            x, y, u = x - mx, y - my, u - mu
            sxx += x * x
            sxy += x * y
            syy += y * y
            sxu += x * u
            syu += y * u
        det = sxx * syy - sxy * sxy
        if abs(det) < 1e-9:
            return None
        gx = (sxu * syy - syu * sxy) / det
        gy = (syu * sxx - sxu * sxy) / det
        preds = [mu + gx * (p[0] - mx) + gy * (p[1] - my) for p in pts]
        return {"px": mx, "py": my, "u0": mu, "gx": gx, "gy": gy,
                "res": max(abs(a - b) for a, b in zip(preds, us)), "umin": min(preds), "umax": max(preds)}

    def grad_plane(st, pl):
        gx, gy, u0, umin, umax = pl["gx"], pl["gy"], pl["u0"], pl["umin"], pl["umax"]
        g2 = gx * gx + gy * gy
        if g2 < 1e-14 or umax - umin < 1e-6:
            return None
        x1 = pl["px"] + gx * (umin - u0) / g2
        y1 = pl["py"] + gy * (umin - u0) / g2
        x2 = pl["px"] + gx * (umax - u0) / g2
        y2 = pl["py"] + gy * (umax - u0) / g2
        span = umax - umin
        stops = []

        def add(u, c):
            stops.append('<stop offset="%s" stop-color="%s"/>' % (fmt((u - umin) / span, 3), to_hex(c)))

        if steps:
            bw = 2.0 / steps
            add(umin, ramp_color(st, quant(umin, steps)))
            b = (math.floor(umin / bw) + 1) * bw
            while b < umax:
                add(b, ramp_color(st, quant(b - 1e-6, steps)))
                add(b, ramp_color(st, quant(b + 1e-6, steps)))
                b += bw
            add(umax, ramp_color(st, quant(umax, steps)))
        else:
            add(umin, ramp_color(st, umin))
            for u, c in st:
                if umin < u < umax:
                    add(u, c)
            add(umax, ramp_color(st, umax))
        gid = "%sg%d" % (id_prefix, counter[0])
        counter[0] += 1
        defs.append('<linearGradient id="%s" gradientUnits="userSpaceOnUse" x1="%s" y1="%s" x2="%s" y2="%s">%s</linearGradient>'
                    % (gid, fmt(x1, 1), fmt(y1, 1), fmt(x2, 1), fmt(y2, 1), "".join(stops)))
        return gid

    def smooth_face(st, d, pts, us):
        pl = plane_fit(pts, us)
        g = grad_plane(st, pl) if pl else None
        if g:
            out.append('<path d="%s" fill="url(#%s)"%s/>' % (d, g, stroke_for("url(#%s)" % g)))
        else:
            c = to_hex(ramp_color(st, quant(sum(us) / len(us), steps)))
            out.append('<path d="%s" fill="%s"%s/>' % (d, c, stroke_for(c)))

    # Shadows first (behind the object).
    if fx["shadow"] == "drop" and not wire:
        L = list(rig["L"])
        L[2] = max(L[2], 0.2)
        zp = min(p[2] for p in P) - max(0.0, fx["shadow_dist"])
        d = ""
        for f in mesh["faces"]:
            n = m_apply(R, f["n"])
            if not (v_dot(n, L) > 0 or f.get("ds")):
                continue
            for l in f["loops"]:
                parts = []
                for vi in l:
                    p = P[vi]
                    t = (p[2] - zp) / L[2]
                    q = project([p[0] - L[0] * t, p[1] - L[1] * t, zp])
                    add_bbox(q[0], q[1])
                    parts.append(fmt(q[0], 1) + " " + fmt(q[1], 1))
                d += "M" + "L".join(parts) + "Z"
        filt = ""
        if fx["shadow_blur"] > 0.1:
            defs.append('<filter id="%ssh" x="-50%%" y="-50%%" width="200%%" height="200%%"><feGaussianBlur stdDeviation="%s"/></filter>'
                        % (id_prefix, fmt(fx["shadow_blur"], 1)))
            filt = ' filter="url(#%ssh)"' % id_prefix
        out.append('<g opacity="%s"%s><path d="%s" fill="%s"/></g>'
                   % (fmt(clamp(fx["shadow_opacity"], 0, 1), 2), filt, d, to_hex(parse_color(fx["shadow_color"], (0, 0, 0)))))
    elif fx["shadow"] == "floor" and not wire:
        w = bbox[2] - bbox[0]
        rx, ry = w * 0.46, max(3.0, w * 0.07)
        sx = (bbox[0] + bbox[2]) / 2 - rig["L"][0] * w * 0.12
        sy = bbox[3] + ry * 0.2
        col = to_hex(parse_color(fx["shadow_color"], (0, 0, 0)))
        defs.append('<radialGradient id="%sfl"><stop offset="0" stop-color="%s" stop-opacity="1"/><stop offset="1" stop-color="%s" stop-opacity="0"/></radialGradient>'
                    % (id_prefix, col, col))
        out.append('<ellipse cx="%s" cy="%s" rx="%s" ry="%s" fill="url(#%sfl)" opacity="%s"/>'
                   % (fmt(sx), fmt(sy), fmt(rx), fmt(ry), id_prefix, fmt(clamp(fx["shadow_opacity"] * 2, 0, 1), 2)))
        add_bbox(sx - rx, sy + ry)
        add_bbox(sx + rx, sy + ry)

    caps = {"front": [], "back": []}
    for v in vis:
        f = v["f"]
        if f.get("cap") and not v["flip"]:
            caps[f["cap"]].append(v)
            continue
        st = mats.get(v["mat"], mats["side"])
        if wire:
            out.append('<path class="e" d="%s" fill="none" stroke="%s" stroke-width="%s" stroke-linejoin="round"/>' % (loop_d(f["loops"]), edge_color, ew))
            face_count += 1
            continue
        loop = f["loops"][0]
        if smooth and f.get("cn") and len(f["loops"]) == 1:
            us = []
            for i, cn in enumerate(f["cn"]):
                nn = m_apply(R, cn)
                if v["flip"]:
                    nn = v_scale(nn, -1)
                us.append(shade(nn, v_norm(v_sub(cam, P[loop[i]])) if persp else v["V"], rig, mode))
            umin, umax = min(us), max(us)
            scr = [S[vi] for vi in loop]
            if umax - umin < 0.02:
                c = to_hex(ramp_color(st, quant((umin + umax) / 2, steps)))
                out.append('<path d="%s" fill="%s"%s/>' % (loop_d(f["loops"]), c, stroke_for(c)))
            else:
                pl = plane_fit(scr, us) if len(scr) > 3 else None
                if len(scr) == 3 or (pl and pl["res"] <= (0.012 if steps else 0.03)):
                    smooth_face(st, loop_d(f["loops"]), scr, us)
                else:
                    for i in range(1, len(scr) - 1):
                        smooth_face(st, "M%sL%sL%sZ" % (pt(loop[0]), pt(loop[i]), pt(loop[i + 1])),
                                    [scr[0], scr[i], scr[i + 1]], [us[0], us[i], us[i + 1]])
        else:
            c = to_hex(ramp_color(st, quant(shade(v["n"], v["V"], rig, mode), steps)))
            rule = ' fill-rule="evenodd"' if len(f["loops"]) > 1 else ""
            out.append('<path d="%s"%s fill="%s"%s/>' % (loop_d(f["loops"]), rule, c, stroke_for(c)))
        face_count += 1
        emit_edges(v["fi"])

    for side in ("back", "front"):
        lst = caps[side]
        if not lst:
            continue
        v0 = lst[0]
        st = mats.get(v0["mat"], mats["front"])
        if mesh.get("cap_exact") and geom["cap_subs"] and fx["kind"] != "revolve":
            z = mesh["cap_z"][0] if side == "front" else mesh["cap_z"][1]

            def pr(x, y):
                q = project(m_apply(R, [x + off[0], y + off[1], z]))
                return fmt(q[0], 2) + " " + fmt(q[1], 2)

            d = ""
            for ns in geom["cap_subs"]:
                if not ns:
                    continue
                d += "M" + pr(ns[0]["x"], ns[0]["y"])
                for i in range(len(ns)):
                    a, b = ns[i], ns[(i + 1) % len(ns)]
                    d += "C" + pr(a["ox"], a["oy"]) + " " + pr(b["ix"], b["iy"]) + " " + pr(b["x"], b["y"])
                d += "Z"
        else:
            d = "".join(loop_d(v["f"]["loops"]) for v in lst)
        if wire:
            out.append('<path class="e" d="%s" fill="none" stroke="%s" stroke-width="%s"/>' % (d, edge_color, ew))
            continue
        c = to_hex(ramp_color(st, quant(shade(v0["n"], v0["V"], rig, mode), steps)))
        out.append('<path d="%s" fill-rule="evenodd" fill="%s"%s/>' % (d, c, stroke_for(c) if all_edges else ""))
        face_count += 1
        for v in lst:
            emit_edges(v["fi"])

    return {"defs": defs, "body": "".join(out), "bbox": bbox, "faces": face_count,
            "seam": seam if (seam > 0 and not all_edges) else 0, "opacity": opacity}
