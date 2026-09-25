# Vector 3Dit for Inkscape

The Vector 3Dit 3D effects as an Inkscape extension. Select shapes in Inkscape and **extrude**, **revolve**,
**inflate** or **tilt** them into 3D. The result is plain vector art, with every face an SVG path. The extension
uses the same 3D engine as the web app, ported to Python, so both give the same look.

## Install

Requires **Inkscape 1.2 or newer**. Nothing else to install: Inkscape brings its own Python.

1. Find your user extensions folder. In Inkscape, open **Edit › Preferences › System** and look at **User extensions**. It is usually:
   - Windows: `%APPDATA%\inkscape\extensions`
   - macOS: `~/Library/Application Support/org.inkscape.Inkscape/config/inkscape/extensions`
   - Linux: `~/.config/inkscape/extensions` (Flatpak: `~/.var/app/org.inkscape.Inkscape/config/inkscape/extensions`; Snap: `~/snap/inkscape/current/.config/inkscape/extensions`)
2. Make a folder named `vector3dit` inside it and copy these files into that folder:
   - `vector3dit.py`, `vector3dit_engine.py`, `vector3dit_view.py`
   - `vector3dit_extrude.inx`, `vector3dit_revolve.inx`, `vector3dit_inflate.inx`, `vector3dit_flat.inx`, `vector3dit_rotate.inx`, `vector3dit_remove.inx`

   The `.inx` files and the `.py` files must sit in the same folder. It's fine to put them straight into `extensions` without the subfolder.
3. Quit Inkscape completely and start it again. The effects appear under **Extensions › Vector 3Dit**.

## Use

1. Select one or more shapes, or a group. Everything in a group turns together around the group's center.
2. Choose **Extensions › Vector 3Dit › Extrude…** (or Revolve, Inflate, Flat tilt).
3. Adjust the settings on the tabs. Tick **Live preview** to watch the changes. Then click **Apply**.

| Effect | What it does |
| --- | --- |
| **Extrude** | Pushes the shape back into a solid: depth, hollow or solid, 6 bevel profiles (Classic, Round, Cove, Ogee, Step, Chisel) |
| **Revolve** | Spins the shape around a vertical axis like a lathe. Draw half a profile, e.g. half a vase, with its straight side on the axis |
| **Inflate** | Puffs the shape up like a balloon or pillow (Round, Pillow, Dome, Soft, Sharp) |
| **Flat tilt** | Keeps the art paper-thin and tilts it in space. Handy for laying art on the faces of an isometric box |

### Rotate in 3D: turn objects by dragging

**Extensions › Vector 3Dit › Rotate in 3D…** opens a window for placing 3D objects by eye:

- **Trackball:** drag the cube to turn the objects. **Shift** locks one axis, **Alt** spins them flat, and the arrow keys turn in 5° steps. You can also drag in the preview itself.
- **Live preview:** the selected objects are shown in 3D, in place on the page, with the rest of your drawing faded behind them. This lets you line them up with other artwork. Scroll to zoom and right-drag to pan, or use **Fit selection** and **Fit page**.
- **Tilt, Turn, Spin and Perspective** sliders, a **Preset view** list and **Face front**.
- **Flat / Extrude / Revolve / Inflate** buttons, and a **Depth** (or **Puffiness**) slider.

Click **Apply** to write the result into the drawing, or **Cancel** to leave it unchanged. Plain shapes you select become extrusions. Objects that are already 3D keep their bevels, material and light.

The window uses GTK for Python, which comes with Inkscape on Windows and macOS. On Linux, if Inkscape says it's missing,
install it with your package manager (e.g. `sudo apt install python3-gi gir1.2-gtk-3.0 python3-gi-cairo`).
Everything else works without it.

### Settings dialogs

Each effect has the same shared tabs:

- **View:** 12 preset views (isometric left/right/top, off-axis, dimetric…) or your own tilt, turn and spin angles, plus perspective. By default, objects that are already 3D keep their rotation when you change other settings. Untick **Objects that are already 3D keep their rotation** to apply the angles to them too.
- **Surface:** material presets (Glossy, Clay, Toon, Poster, Chrome, Gold, Copper, Line art, Wireframe, Flat color), shading, color bands, side color, highlight color.
- **Light:** direction, height, intensity, ambient, fill light, highlight and gloss.
- **Outlines & shadow:** edge lines (outline or every facet), a cast shadow on the page or a soft floor shadow.

The front face keeps the shape's fill. A gradient fill is reduced to its average color. Shapes with no fill use their stroke color.
Lengths are in px (1/96 in) and are converted to your document's units.

### Change or undo the 3D

- **Change it:** select a 3D result and run any Vector 3Dit effect again. It re-renders from the original shape with the new settings instead of stacking a second effect on top. The settings dialog does not load the previous values, so set them again. The rotation is kept (see the View tab), so use **Rotate in 3D…** to change it.
- **Undo it:** **Extensions › Vector 3Dit › Remove 3D** puts the original flat shape back, with its id and style.
- **Edit the shape:** remove the 3D, edit the path, then apply the effect again.

Each result is a group named `3D <effect>: <shape>`. It holds the faces and a hidden copy of the original shape.
To make the art fully independent, ungroup it and delete the hidden `v3d-source` path. After that it can't be re-edited.

### Tips

- **Text:** convert text to paths first with **Path › Object to Path**. Text objects are skipped.
- **Images and clones** are skipped. Unlink a clone first with **Edit › Clone › Unlink Clone**.
- **Strokes:** the 3D is built from the shape's outline, so a stroke doesn't become part of the solid. Use **Path › Stroke to Path** to give a line thickness.
- **File size:** higher *Bevel smoothness*, *Segments* (Revolve) and *Detail* (Inflate) give smoother curves and larger files. Simplify very detailed paths first (**Path › Simplify**).
- **Joining several objects:** each 3D object is depth-sorted on its own, and objects stack in layer order (like Illustrator's 3D effect).

## Files

| File | Purpose |
| --- | --- |
| `vector3dit.py` | The Inkscape extension: reads the selection, runs the engine and writes the result group |
| `vector3dit_engine.py` | The 3D engine: mesh builders (extrude/bevel, lathe, inflate), lighting and SVG output. Pure Python, no dependencies |
| `vector3dit_view.py` | The Rotate in 3D window (GTK 3): trackball, sliders and a live preview of the engine's SVG output, shown through GTK's SVG image loader (no cairo bindings needed) |
| `vector3dit_*.inx` | The dialogs. Generated by `build_inx.py`, so edit that script and rerun it rather than editing the `.inx` files |

Tests (from the repository root): `python3 tests/inkscape.test.py`. They check that the Python engine matches the web app's engine
(needs Node), run the extension end to end (needs `pip install inkex`), and drive the Rotate in 3D window with a test
script (needs GTK 3 for Python and a display, or `xvfb-run`).
