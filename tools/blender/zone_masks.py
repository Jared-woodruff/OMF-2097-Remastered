"""The zone mask of a saved Blender scene holding a robot export: a second pass over the same camera and frame.

Every material becomes a flat emission of its color zone (render_frames.py: R = secondary, G = tertiary, B = primary,
alpha = coverage; effect colors alpha only), the shadow catchers and lights stop counting, and the scene renders
again with linear output. For scenes saved by the render kit (render_asset.py --save-blend) or render_frames.py.

    blender -b scene.blend -P tools/blender/zone_masks.py -- --out mask.png
"""
import argparse
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import render_frames as R  # noqa: E402


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser(prog="zone_masks.py", description=__doc__.split("\n\n")[0])
    p.add_argument("--out", required=True)
    p.add_argument("--samples", type=int, default=64)
    a = p.parse_args(argv)
    scene = bpy.context.scene
    robot = [ob for ob in scene.objects if ob.type == "MESH" and not ob.is_shadow_catcher and any(s.material for s in ob.material_slots)]
    for ob in scene.objects:
        if ob.type == "MESH" and ob not in robot:
            ob.hide_render = True
    R.apply_zone_masks(robot)
    R.mask_settings(scene)
    scene.cycles.samples = a.samples
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    R.render_to(a.out)
    print(f"ZONE_MASKS {os.path.abspath(a.out)}")


if __name__ == "__main__":
    main()
