"""The credits' computer's screen as a warp grid: where each point of the screen's 4:3 picture lands in the render,
from credits_computer.py's 16-bit UV pass (read here, in Blender, as floats: browsers read PNGs at 8 bits).

Writes <folder>/screen-grid.json: {"size": [w, h], "cols": C, "rows": R, "points": [[x, y], ...]} with the pixel
position of the picture's point (i / (C - 1), j / (R - 1)) for j from the top row down and i left to right, to warp a
picture onto the curved glass. (The game puts its picture on the screen's rectangle, from the grid's corners: the curve
bends the middle by under 6 pixels of 3840; see credits_computer_web.py.)

Usage: blender -b --factory-startup --python tools/blender/credits_screen_grid.py -- <folder> [cols] [rows]
"""
import json
import os
import sys

import bpy
import numpy as np

argv = sys.argv[sys.argv.index("--") + 1:]
folder = argv[0]
C = int(argv[1]) if len(argv) > 1 else 33
R = int(argv[2]) if len(argv) > 2 else 25
img = bpy.data.images.load(os.path.join(folder, "screen-uv.png"))
img.colorspace_settings.name = "Non-Color"
w, h = img.size
px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)[::-1]     # (Blender's rows go bottom-up)
u, v = px[..., 0], px[..., 1]
mask = np.asarray(bpy.data.images.load(os.path.join(folder, "screen-mask.png")).pixels[:], dtype=np.float32).reshape(h, w, 4)[::-1][..., 0]
inside = mask > 0.999
ys, xs = np.nonzero(inside)
uu, vv = u[inside], v[inside]
# A plane fit per point from the pixels nearest to it in (u, v): x and y as functions of u and v, locally linear.
points = []
for j in range(R):
    tv = 1 - j / (R - 1)
    for i in range(C):
        tu = i / (C - 1)
        d = (uu - tu) ** 2 + (vv - tv) ** 2
        k = np.argpartition(d, 64)[:64]
        A = np.stack([np.ones(len(k)), uu[k] - tu, vv[k] - tv], axis=1)
        cx = np.linalg.lstsq(A, xs[k] + 0.5, rcond=None)[0][0]
        cy = np.linalg.lstsq(A, ys[k] + 0.5, rcond=None)[0][0]
        points.append([round(float(cx), 2), round(float(cy), 2)])
with open(os.path.join(folder, "screen-grid.json"), "w") as f:
    json.dump({"size": [w, h], "cols": C, "rows": R, "points": points}, f)
print("GRID", len(points), "points; corners", points[0], points[C - 1], points[-C], points[-1])
