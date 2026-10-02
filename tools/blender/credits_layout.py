"""Where the credits' computer's tower is in its picture (credits_computer.py's camera): its front panel, and the area
on it under the logo and above the hazard stripes where the credits land, as fractions of the picture.

Writes <folder>/layout.json: {"panel": {x, y, w, h}, "text": {x, y, w, h}} (from the top left).

Usage: blender -b --factory-startup --python tools/blender/credits_layout.py -- <folder>
"""
import json
import os
import runpy
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
folder = sys.argv[sys.argv.index("--") + 1]
sys.argv = [sys.argv[0], "--", "--out", folder, "--only", "none"]
g = runpy.run_path(os.path.join(HERE, "credits_computer.py"))
g["reset"]()
g["build"]("on")
cam = g["camera"]()
import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

sc = bpy.context.scene
bpy.context.view_layer.update()
tx = bpy.data.objects["tower"].matrix_world.translation.x
# (the tower's front, its height and its panel's half width: see credits_computer.py's tower())
FRONT, TH, HALF = -0.012, 0.37, 0.092


def frac(p):
    v = world_to_camera_view(sc, cam, Vector(p))
    return v.x, 1 - v.y


def rect(x0, x1, z0, z1):
    a, b = frac((x0, FRONT - 0.0004, z1)), frac((x1, FRONT - 0.0004, z0))
    return {"x": round(a[0], 5), "y": round(a[1], 5), "w": round(b[0] - a[0], 5), "h": round(b[1] - a[1], 5)}


out = {
    "panel": rect(tx - HALF, tx + HALF, 0.008, TH - 0.008),
    # (under the logo, whose bottom is at TH - 0.085, to above the hazard stripes' top at 0.043)
    "text": rect(tx - HALF + 0.006, tx + HALF - 0.006, 0.052, TH - 0.093),
}
with open(os.path.join(folder, "layout.json"), "w") as f:
    json.dump(out, f, indent=1)
print("LAYOUT", json.dumps(out))
