#!/usr/bin/env python3
"""Tests for the Inkscape extension (inkscape-extension/).

1. Parity: the Python engine must produce the same meshes as the web app's JavaScript engine (needs Node).
2. End to end: run the extension on a small SVG, re-edit the result, then Remove 3D (needs inkex:
   `pip install inkex`, or run with Inkscape's bundled Python).
3. The Rotate in 3D window, driven by a test script (needs GTK 3 for Python and a display or xvfb-run).

    python3 tests/inkscape.test.py
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXT = os.path.join(ROOT, "inkscape-extension")
sys.path.insert(0, EXT)

import vector3dit_engine as E  # noqa: E402

failures = 0


def check(ok, name, detail=""):
    global failures
    print(("ok   " if ok else "FAIL ") + name + ((" — " + detail) if detail and not ok else ""))
    if not ok:
        failures += 1


def test_parity():
    if not shutil.which("node"):
        print("skip parity (node not found)")
        return
    keymap = {"bevelW": "bevel_w", "bevelH": "bevel_h", "bevelSides": "bevel_sides", "bevelOut": "bevel_out",
              "revAxis": "rev_axis", "revAngle": "rev_angle", "infSides": "inf_sides", "infProfile": "inf_profile"}
    effects = [
        {"kind": "extrude"},
        {"kind": "extrude", "bevel": "round", "bevelW": 6, "bevelH": 6, "bevelSides": "both"},
        {"kind": "extrude", "bevel": "ogee", "bevelW": 5, "bevelH": 8, "bevelOut": True, "edges": "outline", "persp": 60},
        {"kind": "revolve"},
        {"kind": "revolve", "revAxis": "center", "revAngle": 270},
        {"kind": "inflate"},
        {"kind": "inflate", "infSides": "front", "infProfile": "pillow", "shadow": "drop"},
        {"kind": "flat", "rx": 40, "ry": 20, "shading": "toon"},
    ]
    cases = [{"lib": lib, "fx": fx} for lib in ["heart", "star5", "ring", "vase", "cloud", "gear"] for fx in effects]
    js = json.loads(subprocess.run(["node", os.path.join(ROOT, "tests", "engine_parity.cjs")], input=json.dumps(cases),
                                   capture_output=True, text=True, check=True).stdout)
    bad = []
    for c, j in zip(cases, js):
        fx = E.defaults(c["fx"]["kind"], 200)
        fx.update({keymap.get(k, k): v for k, v in c["fx"].items()})
        r = E.render(j["subs"], fx, fill="#e2574c")
        err = max(abs(a - b) for a, b in zip(r["bbox"], j["bbox"]))
        if r["faces"] != j["faces"] or err > 0.5:
            bad.append("%s %s: py %d faces, js %d, bbox err %.3f" % (c["lib"], c["fx"], r["faces"], j["faces"], err))
    check(not bad, "engine parity with the web app (%d cases)" % len(cases), "; ".join(bad[:3]))


SVG = """<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"
  width="210mm" height="150mm" viewBox="0 0 210 150">
  <g id="layer1" inkscape:groupmode="layer" inkscape:label="Layer 1" transform="translate(5,5)">
    <path id="heart" style="fill:#e8505b" d="M 40,30 C 40,15 20,10 15,25 C 10,40 30,55 40,65 C 50,55 70,40 65,25 C 60,10 40,15 40,30 Z"/>
    <rect id="box" x="100" y="20" width="50" height="35" rx="4" style="fill:#3d7bf2" transform="rotate(10 125 37)"/>
    <text id="label" x="20" y="120">Hi</text>
  </g>
</svg>
"""


def run_ext(args, src, dst):
    cmd = [sys.executable, os.path.join(EXT, "vector3dit.py")] + args + ["--output=" + dst, src]
    return subprocess.run(cmd, capture_output=True, text=True)


def test_extension():
    try:
        import inkex  # noqa: F401
    except ImportError:
        print("skip end-to-end (inkex not installed)")
        return
    from lxml import etree
    ns = {"svg": "http://www.w3.org/2000/svg"}
    tmp = tempfile.mkdtemp()
    src, out1, out2, out3 = (os.path.join(tmp, n) for n in ("in.svg", "1.svg", "2.svg", "3.svg"))
    with open(src, "w") as f:
        f.write(SVG)

    p = run_ext(["--kind=extrude", "--bevel=round", "--id=heart", "--id=box", "--id=label"], src, out1)
    check(p.returncode == 0, "extrude runs", p.stderr[-500:])
    check("text" in p.stderr.lower(), "text is skipped with a message")
    doc = etree.parse(out1)
    results = doc.xpath("//svg:g[@data-v3d]", namespaces=ns)
    check(len(results) == 2, "two 3D results", str(len(results)))
    heart = doc.xpath("//*[@id='heart']", namespaces=ns)
    check(len(heart) == 1 and "v3d-source" in (heart[0].get("class") or ""), "original kept hidden inside the result")
    faces = sum(len(r.xpath(".//svg:g[@class='v3d-faces']/*", namespaces=ns)) for r in results)
    check(faces > 20, "faces drawn", str(faces))
    res_id = results[0].get("id")

    p = run_ext(["--kind=inflate", "--material=toon", "--id=" + res_id], out1, out2)
    check(p.returncode == 0, "re-edit runs", p.stderr[-500:])
    doc = etree.parse(out2)
    check(len(doc.xpath("//svg:g[@data-v3d]", namespaces=ns)) == 2, "re-edit replaces instead of stacking")
    settings = json.loads(doc.xpath("//*[@id='%s']" % res_id, namespaces=ns)[0].get("data-v3d"))
    check(settings.get("kind") == "inflate", "re-edit stores the new settings", str(settings.get("kind")))

    p = run_ext(["--kind=remove", "--id=" + res_id], out2, out3)
    check(p.returncode == 0, "remove 3D runs", p.stderr[-500:])
    doc = etree.parse(out3)
    check(len(doc.xpath("//svg:g[@data-v3d]", namespaces=ns)) == 1, "one result left after remove")
    heart = doc.xpath("//*[@id='heart']", namespaces=ns)
    ok = len(heart) == 1 and heart[0].getparent().get("id") == "layer1" and "#e8505b" in heart[0].get("style", "")
    check(ok, "remove 3D restores the original shape, id and style")
    shutil.rmtree(tmp)


def gtk_command():
    """A Python that has inkex and GTK 3, plus a virtual display when there's no screen; None to skip."""
    probe = "import gi, inkex; gi.require_version('Gtk', '3.0'); from gi.repository import Gtk"
    for exe in [sys.executable, shutil.which("python3")] + ["/usr/bin/python3.%d" % v for v in range(14, 7, -1)]:
        if exe and os.path.exists(exe) and subprocess.run([exe, "-c", probe], capture_output=True).returncode == 0:
            if os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY"):
                return [exe]
            if shutil.which("xvfb-run"):
                return ["xvfb-run", "-a", "-s", "-screen 0 1280x800x24", exe]
            return None
    return None


def test_rotate_window():
    cmd = gtk_command()
    if not cmd:
        print("skip Rotate in 3D window (needs inkex, GTK 3 for Python and a display or xvfb-run)")
        return
    from lxml import etree
    ns = {"svg": "http://www.w3.org/2000/svg"}
    tmp = tempfile.mkdtemp()
    src, out1, out2, out3, out4 = (os.path.join(tmp, n) for n in ("in.svg", "1.svg", "2.svg", "3.svg", "4.svg"))
    with open(src, "w") as f:
        f.write(SVG)
    p = run_ext(["--kind=extrude", "--bevel=classic", "--id=heart"], src, out1)
    check(p.returncode == 0, "setup: extrude the heart", p.stderr[-300:])
    res_id = etree.parse(out1).xpath("//svg:g[@data-v3d]", namespaces=ns)[0].get("id")

    def run_window(script, args, inp, out):
        env = dict(os.environ, VECTOR3DIT_AUTOTEST=json.dumps(script))
        return subprocess.run(cmd + [os.path.join(EXT, "vector3dit.py"), "--kind=rotate"] + args + ["--output=" + out, inp],
                              capture_output=True, text=True, env=env, timeout=120)

    p = run_window({"drag": [[40, -20]], "apply": True}, ["--id=" + res_id, "--id=box"], out1, out2)
    check(p.returncode == 0 and not p.stderr.strip(), "rotate window applies without errors", p.stderr[-500:])
    doc = etree.parse(out2)
    results = {g.get("id"): json.loads(g.get("data-v3d")) for g in doc.xpath("//svg:g[@data-v3d]", namespaces=ns)}
    check(len(results) == 2, "rotate window makes the plain box 3D too", str(len(results)))
    heart = results.get(res_id, {})
    check(heart.get("bevel") == "classic" and heart.get("kind") == "extrude", "rotate window keeps other settings")
    turned = [r for r in results.values() if abs(r["rx"] - 20) > 1 or abs(r["ry"] + 30) > 1]
    check(len(turned) == 2, "both objects turned by the drag", str([(r["rx"], r["ry"]) for r in results.values()]))
    check(all(r["kind"] in ("extrude", "flat", "revolve", "inflate") for r in results.values()), "valid kinds stored")

    p = run_window({"drag": [[90, 0]], "apply": False}, ["--id=" + res_id], out2, out3)
    check(p.returncode == 0 and not os.path.exists(out3), "cancel leaves the document unchanged", p.stderr[-300:])

    rx = heart.get("rx")
    p = run_ext(["--kind=extrude", "--bevel=round", "--id=" + res_id], out2, out4)
    stored = json.loads(etree.parse(out4).xpath("//*[@id='%s']" % res_id, namespaces=ns)[0].get("data-v3d"))
    check(p.returncode == 0 and stored.get("bevel") == "round" and abs(stored.get("rx", 0) - rx) < 1e-6,
          "re-editing in a dialog keeps the rotation set in the window")
    shutil.rmtree(tmp)


if __name__ == "__main__":
    test_parity()
    test_extension()
    test_rotate_window()
    print("%d failure(s)" % failures if failures else "all passed")
    sys.exit(1 if failures else 0)
