"""The credits' computer: a 1994 home computer in One Must Fall 2097's own style, seen from the front at a seated eye
level, modeled and rendered in Blender (Cycles).

OMF edition: satin and brushed steel with the Stadium's rivets for the hardware, the game's menu panel (the navy grid
in its bright blue frame) backlit on the tower's front, the remaster's logo on the tower and the mousepad,
hazard stripes, navy keys with the menus' green legends and the fight keys in red and gold (the arrows, PUNCH and KICK),
a CD of the game with the main menu's painting, the main menu's robot framed on the wall, "97" on the turbo display.

A 15-inch CRT monitor with a slim bezel (its curved glass screen center-left), a pair of small multimedia speakers
either side of it, a classic tower on the right (where the credits' cards land), a full 101-key keyboard
(sculpted keycaps with printed legends), a two-button mouse on a printed 90s mousepad and two floppy disks with
handwritten labels, on an oak desk against a dark wall, lit warm by a desk lamp out of frame on the left. The textures
(the desk's wood, the labels, the sticky note, the wall: painted with an image generation model; the logo, the tower's
panel, the mousepad, the CD's cover and the poster: made from the game's own art) are read from --textures, as
<name>-tex.png; without them the scene falls back to procedural materials. The camera is level (no keystone: the
screen's sides stay vertical) and framed by lens shift.

Renders (into --out):
  on.png          the computer on: the screen glowing a soft cool white (it lights the bezel), the lights on
  off.png         the computer off: dark curved glass, no lights
  lit.png         (--only lit) the computer on with its screen dark, for a picture put on the glass afterwards
  dark.png        (--only dark) everything off, the keys' legends and the tower's panel too
  screen-mask.png the screen's glass where it shows (everything in front of it held out): white, anti-aliased
  screen-uv.png   the glass's own coordinates per pixel (16-bit: red = u across, green = v up the bezel's 4:3 opening),
                  to warp a picture onto the curved glass exactly (credits_screen_grid.py makes a grid of it)
Then credits_computer_post.py finishes them and makes the chroma-green picture, credits_screen_grid.py and
credits_layout.py measure the screen and the tower, and credits_computer_web.py makes the game's pictures of them
(public/credits/computer, for src/game/credits/computerRoom.ts).

Usage: blender -b --factory-startup -P tools/blender/credits_computer.py -- --out <folder> [--size 3840x2160]
       [--samples 512] [--only on,off,mask,uv] [--textures <folder>]
"""
import argparse
import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

# ---- arguments --------------------------------------------------------------------------------------------------------

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--out", required=True)
ap.add_argument("--size", default="3840x2160")
ap.add_argument("--samples", type=int, default=512)
ap.add_argument("--only", default="on,off,mask,uv")
ap.add_argument("--textures", default=os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                                                   ".captures", "credits-room", "textures"))
A = ap.parse_args(argv)
W, H = (int(v) for v in A.size.split("x"))
os.makedirs(A.out, exist_ok=True)

# ---- the layout (meters; the desk's top is z = 0, the bezel's front y = 0, the camera looks along +y) -----------------

SCREEN_W, SCREEN_H = 0.30, 0.225                 # the bezel's opening: the visible 4:3 screen
BEZEL_SIDE, BEZEL_TOP, BEZEL_BOTTOM = 0.021, 0.023, 0.06
CHAMFER = 0.011                                  # the bezel's sloped inner edge, down to the glass
MON_BASE = 0.045                                 # the monitor's bottom above the desk (its tilt-and-swivel base)
BEZEL_W = SCREEN_W + 2 * BEZEL_SIDE
BEZEL_H = SCREEN_H + BEZEL_TOP + BEZEL_BOTTOM
BEZEL_CZ = MON_BASE + BEZEL_H / 2
SCREEN_Z = MON_BASE + BEZEL_BOTTOM + SCREEN_H / 2
CAM_Z = 0.40                                     # a seated eye level, a little above the monitor
CAM_DIST = 1.5                                   # the camera to the bezel's front
LENS = 58.0
FRAME_W = CAM_DIST * 36 / LENS                   # the frame's width at the bezel's front
FRAME_H = FRAME_W * 9 / 16
SCREEN_FX, SCREEN_FY = 0.34, 0.385               # the screen's middle in the frame (from the left, from the top)
SHIFT_X = 0.5 - SCREEN_FX
SHIFT_Y = (SCREEN_Z - (0.5 - SCREEN_FY) * FRAME_H - CAM_Z) / FRAME_W
U = 0.01905                                      # a key's pitch


def frac_x(f):
    """x at the bezel's plane of a fraction of the frame's width."""
    return (f - SCREEN_FX) * FRAME_W


# ---- scene ------------------------------------------------------------------------------------------------------------

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    prefs = bpy.context.preferences.addons["cycles"].preferences
    for kind in ("OPTIX", "CUDA"):
        try:
            prefs.compute_device_type = kind
            prefs.get_devices()
            if any(d.type == kind for d in prefs.devices):
                for d in prefs.devices:
                    d.use = d.type == kind
                sc.cycles.device = "GPU"
                break
        except TypeError:
            continue
    sc.cycles.samples = A.samples
    sc.cycles.use_denoising = True
    sc.cycles.adaptive_threshold = 0.01
    sc.cycles.max_bounces = 8
    sc.render.resolution_x, sc.render.resolution_y = W, H
    sc.render.resolution_percentage = 100
    sc.view_settings.view_transform = "AgX"
    sc.view_settings.look = "AgX - Medium High Contrast"
    sc.view_settings.exposure = -0.2
    sc.render.film_transparent = False
    world = bpy.data.worlds.new("World")
    sc.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.004, 0.0035, 0.004, 1)
    bg.inputs["Strength"].default_value = 1.0
    return sc


def lin(hex_color):
    h = hex_color.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c)


def mat(name, color, rough=0.5, metal=0.0, coat=0.0, coat_rough=0.1, emit=None, strength=0.0, spec=0.5):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes["Principled BSDF"]
    p.inputs["Base Color"].default_value = (*color, 1)
    p.inputs["Roughness"].default_value = rough
    p.inputs["Metallic"].default_value = metal
    p.inputs["Specular IOR Level"].default_value = spec
    if coat:
        p.inputs["Coat Weight"].default_value = coat
        p.inputs["Coat Roughness"].default_value = coat_rough
    if emit:
        p.inputs["Emission Color"].default_value = (*emit, 1)
        p.inputs["Emission Strength"].default_value = strength
    return m


def _noise(nt, scale, detail=4.0, rough=0.55):
    n = nt.nodes.new("ShaderNodeTexNoise")
    n.inputs["Scale"].default_value = scale
    n.inputs["Detail"].default_value = detail
    n.inputs["Roughness"].default_value = rough
    return n


def plastic(name, base_hex, yellow_hex, rough=0.46, texture=0.035, grime=0.55, dust=0.22):
    """Old beige PC plastic: a gentle uneven yellowing, grime in its creases, a light film of dust on its upward faces, a
    varying sheen, a fine moulded texture."""
    m = mat(name, lin(base_hex), rough=rough)
    nt = m.node_tree
    p = nt.nodes["Principled BSDF"]
    coord = nt.nodes.new("ShaderNodeTexCoord")
    big = _noise(nt, 9.0, 1.0, 0.3)
    nt.links.new(coord.outputs["Object"], big.inputs["Vector"])
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.2
    ramp.color_ramp.elements[0].color = (*lin(base_hex), 1)
    ramp.color_ramp.elements[1].position = 0.85
    ramp.color_ramp.elements[1].color = (*lin(yellow_hex), 1)
    nt.links.new(big.outputs["Fac"], ramp.inputs["Fac"])
    # grime in the creases and corners (where a cloth never reaches): darker, browner where the surface is occluded
    ao = nt.nodes.new("ShaderNodeAmbientOcclusion")
    ao.samples = 8
    ao.inputs["Distance"].default_value = 0.01
    inv = nt.nodes.new("ShaderNodeMath")
    inv.operation = "SUBTRACT"
    inv.inputs[0].default_value = 1.0
    nt.links.new(ao.outputs["AO"], inv.inputs[1])
    amt = nt.nodes.new("ShaderNodeMath")
    amt.operation = "MULTIPLY"
    amt.inputs[1].default_value = grime
    nt.links.new(inv.outputs[0], amt.inputs[0])
    dirt = nt.nodes.new("ShaderNodeMix")
    dirt.data_type = "RGBA"
    nt.links.new(amt.outputs[0], dirt.inputs["Factor"])
    nt.links.new(ramp.outputs["Color"], dirt.inputs["A"])
    dirt.inputs["B"].default_value = (*lin("#6e6048"), 1)
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    nz = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(geo.outputs["Normal"], nz.inputs[0])
    up = nt.nodes.new("ShaderNodeMapRange")
    up.inputs["From Min"].default_value = 0.6
    up.inputs["From Max"].default_value = 0.95
    nt.links.new(nz.outputs["Z"], up.inputs["Value"])
    speck = _noise(nt, 70.0, 3.0, 0.6)
    nt.links.new(coord.outputs["Object"], speck.inputs["Vector"])
    patch = nt.nodes.new("ShaderNodeMath")
    patch.operation = "MULTIPLY"
    nt.links.new(up.outputs["Result"], patch.inputs[0])
    nt.links.new(speck.outputs["Fac"], patch.inputs[1])
    damt = nt.nodes.new("ShaderNodeMath")
    damt.operation = "MULTIPLY"
    damt.inputs[1].default_value = dust
    nt.links.new(patch.outputs[0], damt.inputs[0])
    dusty = nt.nodes.new("ShaderNodeMix")
    dusty.data_type = "RGBA"
    nt.links.new(damt.outputs[0], dusty.inputs["Factor"])
    nt.links.new(dirt.outputs["Result"], dusty.inputs["A"])
    dusty.inputs["B"].default_value = (*lin("#a39d90"), 1)
    nt.links.new(dusty.outputs["Result"], p.inputs["Base Color"])
    sheen = _noise(nt, 18.0, 2.0)
    nt.links.new(coord.outputs["Object"], sheen.inputs["Vector"])
    rmap = nt.nodes.new("ShaderNodeMapRange")
    rmap.inputs["To Min"].default_value = rough - 0.08
    rmap.inputs["To Max"].default_value = rough + 0.1
    nt.links.new(sheen.outputs["Fac"], rmap.inputs["Value"])
    nt.links.new(rmap.outputs["Result"], p.inputs["Roughness"])
    fine = _noise(nt, 2600.0, 2.0, 0.7)
    nt.links.new(coord.outputs["Object"], fine.inputs["Vector"])
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = texture
    bump.inputs["Distance"].default_value = 0.0004
    nt.links.new(fine.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], p.inputs["Normal"])
    return m


def steel(name, hex_color, rough=0.3, streaks=0.06, metal=1.0):
    """Brushed steel: its roughness and shade streaked along x (the brushing), a fine grain."""
    m = mat(name, lin(hex_color), rough=rough, metal=metal)
    nt = m.node_tree
    p = nt.nodes["Principled BSDF"]
    coord = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (6.0, 900.0, 900.0)
    nt.links.new(coord.outputs["Object"], mp.inputs["Vector"])
    n = _noise(nt, 1.0, 6.0, 0.6)
    nt.links.new(mp.outputs["Vector"], n.inputs["Vector"])
    rr = nt.nodes.new("ShaderNodeMapRange")
    rr.inputs["To Min"].default_value = rough - streaks
    rr.inputs["To Max"].default_value = rough + streaks
    nt.links.new(n.outputs["Fac"], rr.inputs["Value"])
    nt.links.new(rr.outputs["Result"], p.inputs["Roughness"])
    cr = nt.nodes.new("ShaderNodeMix")
    cr.data_type = "RGBA"
    cr.inputs["A"].default_value = (*lin(hex_color), 1)
    cr.inputs["B"].default_value = (*[c * 0.82 for c in lin(hex_color)], 1)
    nt.links.new(n.outputs["Fac"], cr.inputs["Factor"])
    nt.links.new(cr.outputs["Result"], p.inputs["Base Color"])
    return m


def plates_mat(name, tile=0.42):
    """The Stadium's riveted steel plates (its wall's painting), projected on every side of the object, a plate about
    tile / 2.5 across."""
    path = texture_path("steel-plates")
    if not path:
        return steel(name, "#9aa1ab")
    m = mat(name, (0.6, 0.6, 0.6), rough=0.33, metal=0.7)
    nt = m.node_tree
    p = nt.nodes["Principled BSDF"]
    coord = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (1 / tile, 1 / tile, 1 / tile)
    nt.links.new(coord.outputs["Object"], mp.inputs["Vector"])
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(path, check_existing=True)
    tex.projection = "BOX"
    tex.projection_blend = 0.15
    tex.interpolation = "Cubic"
    nt.links.new(mp.outputs["Vector"], tex.inputs["Vector"])
    nt.links.new(tex.outputs["Color"], p.inputs["Base Color"])
    b = nt.nodes.new("ShaderNodeBump")
    b.inputs["Strength"].default_value = 0.25
    b.inputs["Distance"].default_value = 0.0006
    nt.links.new(tex.outputs["Color"], b.inputs["Height"])
    nt.links.new(b.outputs["Normal"], p.inputs["Normal"])
    return m


def decal_mat(name, path, rough=0.35, emit=0.0):
    """A printed picture with its transparency (a logo), optionally lit from within."""
    m = mat(name, (1, 1, 1), rough=rough)
    nt = m.node_tree
    p = nt.nodes["Principled BSDF"]
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(path, check_existing=True)
    tex.interpolation = "Cubic"
    tex.extension = "CLIP"
    nt.links.new(tex.outputs["Color"], p.inputs["Base Color"])
    nt.links.new(tex.outputs["Alpha"], p.inputs["Alpha"])
    if emit:
        nt.links.new(tex.outputs["Color"], p.inputs["Emission Color"])
        p.inputs["Emission Strength"].default_value = emit
    return m


def glow_mat(name, rgb255, strength):
    c = tuple((v / 255) ** 2.2 for v in rgb255)
    return mat(name, c, rough=0.4, emit=c, strength=strength)


def rivets(name, points, normal, material, r=0.0016):
    """Domed rivets at `points` on a face whose outward normal is `normal` ('-y' facing the camera, '-x' facing left)."""
    bm = bmesh.new()
    rot = {"-y": (math.pi / 2, 0, 0), "-x": (0, -math.pi / 2, 0), "+z": (0, 0, 0)}[normal]
    from mathutils import Euler, Matrix
    R = Euler(rot).to_matrix().to_4x4()
    for p in points:
        M_ = Matrix.Translation(Vector(p)) @ R @ Matrix.Diagonal((r, r, r * 0.55, 1.0))
        bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=6, radius=1.0, matrix=M_)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for poly in me.polygons:
        poly.use_smooth = True
    ob = link(bpy.data.objects.new(name, me))
    me.materials.append(material)
    return ob


def texture_path(name):
    """A painted texture by name (cropped to what it shows: <name>-tex.png), or None."""
    for f in (f"{name}-tex.png", f"{name}_1.png", f"{name}.png"):
        p = os.path.join(A.textures, f)
        if os.path.exists(p):
            return p
    return None


def image_mat(name, path, rough=0.5, coat=0.0, coat_rough=0.1, bump=0.0, box=None, extension="EXTEND", plane="xy"):
    """A material from a painted texture: mapped by the object's own coordinates over box = (a0, b0, a1, b1) on the
    plane "xy" (a top view) or "xz" (a front view), default the UV map; its roughness `rough`, a bump from its
    luminance."""
    m = mat(name, (0.5, 0.5, 0.5), rough=rough, coat=coat, coat_rough=coat_rough)
    nt = m.node_tree
    p = nt.nodes["Principled BSDF"]
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(path, check_existing=True)
    tex.extension = extension
    tex.interpolation = "Cubic"
    if box:
        x0, y0, x1, y1 = box
        coord = nt.nodes.new("ShaderNodeTexCoord")
        mp = nt.nodes.new("ShaderNodeMapping")
        mp.inputs["Location"].default_value = (-x0 / (x1 - x0), -y0 / (y1 - y0), 0)
        mp.inputs["Scale"].default_value = (1 / (x1 - x0), 1 / (y1 - y0), 1)
        if plane == "xz":
            sep = nt.nodes.new("ShaderNodeSeparateXYZ")
            comb = nt.nodes.new("ShaderNodeCombineXYZ")
            nt.links.new(coord.outputs["Object"], sep.inputs[0])
            nt.links.new(sep.outputs["X"], comb.inputs["X"])
            nt.links.new(sep.outputs["Z"], comb.inputs["Y"])
            nt.links.new(comb.outputs[0], mp.inputs["Vector"])
        else:
            nt.links.new(coord.outputs["Object"], mp.inputs["Vector"])
        nt.links.new(mp.outputs["Vector"], tex.inputs["Vector"])
    nt.links.new(tex.outputs["Color"], p.inputs["Base Color"])
    if bump:
        b = nt.nodes.new("ShaderNodeBump")
        b.inputs["Strength"].default_value = bump
        b.inputs["Distance"].default_value = 0.0005
        nt.links.new(tex.outputs["Color"], b.inputs["Height"])
        nt.links.new(b.outputs["Normal"], p.inputs["Normal"])
    return m


def wood(name):
    path = texture_path("desk-wood")
    if path:
        return image_mat(name, path, rough=0.38, coat=0.4, coat_rough=0.16, bump=0.05, box=(-0.85, -0.45, 0.85, 0.62), extension="MIRROR")
    m = mat(name, lin("#7a5233"), rough=0.4, coat=0.4, coat_rough=0.16)
    return m


def wall(name):
    path = texture_path("wall")
    if path:
        m = image_mat(name, path, rough=0.92, bump=0.15, box=(-1.2, -0.3, 1.2, 1.3), plane="xz", extension="MIRROR")
        # (darker than the photograph: the wall is in the lamp's shadow)
        nt = m.node_tree
        tex = next(n for n in nt.nodes if n.type == "TEX_IMAGE")
        mul = nt.nodes.new("ShaderNodeMix")
        mul.data_type = "RGBA"
        mul.blend_type = "MULTIPLY"
        mul.inputs["Factor"].default_value = 1.0
        mul.inputs["B"].default_value = (0.2, 0.22, 0.32, 1)
        nt.links.new(tex.outputs["Color"], mul.inputs["A"])
        nt.links.new(mul.outputs["Result"], nt.nodes["Principled BSDF"].inputs["Base Color"])
        return m
    return mat(name, lin("#1d1a1e"), rough=0.92)


# ---- geometry ---------------------------------------------------------------------------------------------------------------

def link(ob):
    bpy.context.collection.objects.link(ob)
    return ob


def smooth(ob, angle=40):
    me = ob.data
    for p in me.polygons:
        p.use_smooth = True
    try:
        me.set_sharp_from_angle(angle=math.radians(angle))
    except AttributeError:
        pass


def rrect(w, h, r, cx=0.0, cz=0.0, n_arc=8, n_edge=6):
    """Points (a, b) of a rounded rectangle w x h (corner radius r) around (cx, cz), counter-clockwise from its top-right
    corner's arc; every rounded rectangle has the same number of points, so they loft into each other."""
    hw, hh = w / 2, h / 2
    r = max(1e-5, min(r, hw - 1e-5, hh - 1e-5))
    cs = [(hw - r, hh - r, 0.0), (-hw + r, hh - r, 90.0), (-hw + r, -hh + r, 180.0), (hw - r, -hh + r, 270.0)]
    pts = []
    for k, (ccx, ccz, a0) in enumerate(cs):
        arc = [(ccx + r * math.cos(math.radians(a0 + 90 * i / n_arc)), ccz + r * math.sin(math.radians(a0 + 90 * i / n_arc)))
               for i in range(n_arc + 1)]
        pts.extend(arc)
        nx, nz, na = cs[(k + 1) % 4]
        nxt = (nx + r * math.cos(math.radians(na)), nz + r * math.sin(math.radians(na)))
        for i in range(1, n_edge + 1):
            t = i / (n_edge + 1)
            pts.append((arc[-1][0] + (nxt[0] - arc[-1][0]) * t, arc[-1][1] + (nxt[1] - arc[-1][1]) * t))
    return [(x + cx, z + cz) for x, z in pts]


def ring_xz(w, h, r, y, cx=0.0, cz=0.0, **kw):
    """A rounded rectangle facing the camera (in x and z) at depth y."""
    return [(a, y, b) for a, b in rrect(w, h, r, cx, cz, **kw)]


def ring_xy(w, d, r, z, cx=0.0, cy=0.0, **kw):
    """A rounded rectangle lying flat (in x and y) at height z."""
    return [(a, b, z) for a, b in rrect(w, d, r, cx, cy, **kw)]


def loft(name, rings, material, cap_first=False, cap_last=False, angle=40, subd=0):
    """A mesh through rings of points (each the same count, corresponding), optionally capped."""
    bm = bmesh.new()
    vs = [[bm.verts.new(p) for p in ring] for ring in rings]
    n = len(vs[0])
    for a, b in zip(vs, vs[1:]):
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((a[i], a[j], b[j], b[i]))
    if cap_first:
        bm.faces.new(list(reversed(vs[0])))
    if cap_last:
        bm.faces.new(vs[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = link(bpy.data.objects.new(name, me))
    me.materials.append(material)
    smooth(ob, angle)
    if subd:
        s = ob.modifiers.new("subd", "SUBSURF")
        s.levels = s.render_levels = subd
    return ob


def box(name, size, loc, material, bevel=0.0, segments=4, parent=None):
    """A box (size x, y, z) centered at loc, its edges rounded by `bevel`."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        b = ob.modifiers.new("bevel", "BEVEL")
        b.width = bevel
        b.segments = segments
        b.limit_method = "ANGLE"
        b.harden_normals = True
    ob.data.materials.append(material)
    for poly in ob.data.polygons:
        poly.use_smooth = True
    if parent:
        ob.parent = parent
    return ob


def cylinder(name, r, depth, loc, material, axis="Y", verts=48, bevel=0.0):
    rot = {"Y": (math.pi / 2, 0, 0), "X": (0, math.pi / 2, 0), "Z": (0, 0, 0)}[axis]
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth, location=loc, rotation=rot)
    ob = bpy.context.active_object
    ob.name = name
    if bevel:
        b = ob.modifiers.new("bevel", "BEVEL")
        b.width = bevel
        b.segments = 3
        b.limit_method = "ANGLE"
        b.harden_normals = True
    ob.data.materials.append(material)
    for poly in ob.data.polygons:
        poly.use_smooth = True
    for e in ob.data.edges:
        f = [p for p in ob.data.polygons if e.key in p.edge_keys]
        if len(f) == 2 and f[0].normal.angle(f[1].normal) > math.radians(30):
            e.use_edge_sharp = True
    return ob


def cable(name, points, radius, material):
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = radius
    cu.bevel_resolution = 4
    sp = cu.splines.new("BEZIER")
    sp.bezier_points.add(len(points) - 1)
    for bp, p in zip(sp.bezier_points, points):
        bp.co = p
        bp.handle_left_type = bp.handle_right_type = "AUTO"
    ob = link(bpy.data.objects.new(name, cu))
    ob.data.materials.append(material)
    return ob


def plane(name, size, loc, rot, material):
    """A flat picture (its UVs 0..1): w x h, centered at loc, rotated by rot (radians)."""
    bpy.ops.mesh.primitive_plane_add(size=1, location=loc, rotation=rot)
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = (size[0], size[1], 1)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    ob.data.materials.append(material)
    return ob


FONT = None


def font():
    global FONT
    try:
        alive = FONT is not None and FONT.name in bpy.data.fonts
    except ReferenceError:
        alive = False
    if not alive:
        FONT = bpy.data.fonts.load("C:/Windows/Fonts/arial.ttf", check_existing=True)
    return FONT


def text(name, body, size, material, loc=(0, 0, 0), rot=(0, 0, 0), parent=None, align="LEFT"):
    cu = bpy.data.curves.new(name, "FONT")
    cu.body = body
    cu.font = font()
    cu.size = size
    cu.align_x = align
    ob = link(bpy.data.objects.new(name, cu))
    ob.location = loc
    ob.rotation_euler = rot
    ob.data.materials.append(material)
    if parent:
        ob.parent = parent
    return ob


# ---- the monitor --------------------------------------------------------------------------------------------------------------

def monitor(M, glass):
    oz = BEZEL_CZ
    # The bezel: the outer edge rounding back into the case, a narrow front face, a sloped chamfer down to the glass, the
    # opening's lip turning back behind the glass.
    hole = (SCREEN_W, SCREEN_H, 0.011)
    rings = [
        ring_xz(BEZEL_W, BEZEL_H, 0.02, 0.055, cz=oz),
        ring_xz(BEZEL_W, BEZEL_H, 0.02, 0.009, cz=oz),
        ring_xz(BEZEL_W - 0.005, BEZEL_H - 0.005, 0.0175, 0.0018, cz=oz),
        ring_xz(BEZEL_W - 0.013, BEZEL_H - 0.013, 0.0135, 0.0, cz=oz),
        ring_xz(SCREEN_W + 2 * CHAMFER + 0.002, SCREEN_H + 2 * CHAMFER + 0.002, hole[2] + CHAMFER, 0.0, cz=SCREEN_Z),
        ring_xz(SCREEN_W + 2 * CHAMFER, SCREEN_H + 2 * CHAMFER, hole[2] + CHAMFER, 0.0006, cz=SCREEN_Z),
        ring_xz(SCREEN_W + 0.003, SCREEN_H + 0.003, hole[2] + 0.0015, 0.0085, cz=SCREEN_Z),
        ring_xz(SCREEN_W, SCREEN_H, hole[2], 0.0105, cz=SCREEN_Z),
        ring_xz(SCREEN_W - 0.001, SCREEN_H - 0.001, hole[2], 0.03, cz=SCREEN_Z),
    ]
    loft("monitor_bezel", rings, M["beige"], angle=50)
    # the case behind it, tapering back (its seam with the bezel a small step)
    loft("monitor_case", [
        ring_xz(BEZEL_W - 0.004, BEZEL_H - 0.004, 0.018, 0.054, cz=oz),
        ring_xz(BEZEL_W - 0.012, BEZEL_H - 0.012, 0.016, 0.058, cz=oz),
        ring_xz(BEZEL_W - 0.014, BEZEL_H - 0.014, 0.016, 0.12, cz=oz),
        ring_xz(0.3, 0.27, 0.03, 0.25, cz=oz - 0.008),
        ring_xz(0.22, 0.2, 0.035, 0.37, cz=oz - 0.02),
    ], M["beige_case"], cap_last=True, angle=50)
    # the glass: a grid bulging toward the camera, larger than the opening (its edges behind the bezel); its u, v are the
    # opening's (0..1 across and up the opening, beyond it under the bezel)
    GW, GH = SCREEN_W + 0.022, SCREEN_H + 0.022
    bpy.ops.mesh.primitive_grid_add(x_subdivisions=120, y_subdivisions=90, size=1, location=(0, 0, 0))
    g = bpy.context.active_object
    g.name = "crt_glass"
    for v in g.data.vertices:
        a, c = v.co.x + 0.5, v.co.y + 0.5
        x, z = (a - 0.5) * GW, (c - 0.5) * GH
        bulge = 0.011 * (1 - (2 * a - 1) ** 2 * 0.85) * (1 - (2 * c - 1) ** 2 * 0.85)
        v.co = Vector((x, 0.0165 - bulge, SCREEN_Z + z))
    uvl = g.data.uv_layers.active.data
    for loop in g.data.loops:
        co = g.data.vertices[loop.vertex_index].co
        uvl[loop.index].uv = (co.x / SCREEN_W + 0.5, (co.z - SCREEN_Z) / SCREEN_H + 0.5)
    for poly in g.data.polygons:
        poly.use_smooth = True
    g.data.materials.append(glass)
    box("recess", (GW + 0.02, 0.01, GH + 0.02), (0.0, 0.034, SCREEN_Z), M["black"])
    # the controls on the bezel's chin: five small buttons, the power button and its light
    cz = MON_BASE + (BEZEL_BOTTOM - CHAMFER) / 2 + 0.002
    for i in range(5):
        box(f"mon_button{i}", (0.012, 0.005, 0.0065), (0.03 + i * 0.017, -0.0016, cz), M["beige_dark"], bevel=0.0018)
    box("power_button", (0.02, 0.007, 0.013), (0.148, -0.0025, cz), M["beige_dark"], bevel=0.0028)
    cylinder("power_led", 0.002, 0.004, (0.124, -0.0012, cz), M["led_red"])
    # the tilt-and-swivel base
    loft("monitor_base", [
        ring_xy(0.21, 0.19, 0.08, 0.0, cy=0.15),
        ring_xy(0.214, 0.194, 0.082, 0.006, cy=0.15),
        ring_xy(0.2, 0.18, 0.075, 0.02, cy=0.15),
        ring_xy(0.13, 0.12, 0.05, 0.03, cy=0.15),
        ring_xy(0.12, 0.11, 0.045, MON_BASE + 0.004, cy=0.15),
    ], M["beige_dark"], cap_first=True, cap_last=True, angle=50)


# ---- the speakers and the tower -----------------------------------------------------------------------------------------------------

def speakers(M):
    sw, sh, sd = 0.098, 0.208, 0.125
    for side, cx in (("left", -(BEZEL_W / 2 + 0.03 + sw / 2)), ("right", BEZEL_W / 2 + 0.03 + sw / 2)):
        y0 = 0.05
        box(f"speaker_{side}", (sw, sd, sh), (cx, y0 + sd / 2, sh / 2), M["beige_case"], bevel=0.009, segments=6)
        rivets(f"speaker_rivets_{side}", [(cx + sx * (sw / 2 - 0.0055), y0 - 0.0001, z) for sx in (-1, 1) for z in (0.012, 0.05, sh - 0.012)],
               "-y", M["beige"], r=0.0014)
        hz = texture_path("hazard")
        if hz:
            plane(f"hazard_{side}", (sw - 0.02, 0.012), (cx, y0 - 0.0006, 0.07), (math.pi / 2, 0, 0), image_mat(f"hazard_{side}", hz, rough=0.45))
        gz = sh - 0.074
        box(f"cavity_{side}", (sw - 0.02, 0.008, 0.124), (cx, y0 + 0.003, gz), M["slot"], bevel=0.003)
        cylinder(f"cone_{side}", 0.034, 0.004, (cx, y0 + 0.006, gz), M["grille"])
        for k in range(15):
            box(f"slat_{side}{k}", (sw - 0.024, 0.006, 0.0042), (cx, y0 - 0.001, gz - 0.058 + k * 0.0083), M["beige_dark"],
                bevel=0.0012, segments=2)
        # (a knurled knob: a ring of fine ridges)
        kx = cx + (0.018 if side == "right" else -0.018)
        cylinder(f"knob_{side}", 0.0105, 0.012, (kx, y0 - 0.005, 0.042), M["black"], verts=64, bevel=0.0015)
        for k in range(24):
            a = 2 * math.pi * k / 24
            box(f"knurl_{side}{k}", (0.0012, 0.011, 0.0012), (kx + 0.0106 * math.cos(a), y0 - 0.005, 0.042 + 0.0106 * math.sin(a)), M["black"])
        if side == "right":
            cylinder("speaker_led", 0.0018, 0.004, (cx - 0.024, y0 - 0.001, 0.042), M["led_green"])
        box(f"speaker_badge_{side}", (0.03, 0.003, 0.006), (cx, y0 - 0.001, 0.018), M["beige_dark"], bevel=0.001)


def tower(M):
    tw, th, td = 0.2, 0.37, 0.42
    tx = BEZEL_W / 2 + 0.03 + 0.098 + 0.035 + tw / 2
    front = -0.012
    box("tower", (tw, td, th), (tx, front + td / 2, th / 2), M["beige_case"], bevel=0.006)
    side_x = tx - tw / 2 - 0.0004
    rivets("tower_rivets_side", [(side_x, front + 0.012, z) for z in [0.02 + k * 0.035 for k in range(10)]] +
           [(side_x, front + 0.012 + k * 0.04, th - 0.012) for k in range(1, 10)] +
           [(side_x, front + 0.012 + k * 0.04, 0.012) for k in range(1, 10)], "-x", M["beige"])
    rivets("tower_rivets_front", [(tx + sx * (tw / 2 - 0.0045), front - 0.0002, z) for sx in (-1, 1) for z in [0.016 + k * 0.034 for k in range(11)]],
           "-y", M["beige"], r=0.0013)
    pp = texture_path("tower-panel")
    if pp:
        pm = image_mat("tower_panel", pp, rough=0.25)
        pn = pm.node_tree
        ptex = next(n for n in pn.nodes if n.type == "TEX_IMAGE")
        pn.links.new(ptex.outputs["Color"], pn.nodes["Principled BSDF"].inputs["Emission Color"])
        pn.nodes["Principled BSDF"].inputs["Emission Strength"].default_value = 0.9
        pn.nodes["Principled BSDF"].inputs["Coat Weight"].default_value = 1.0
        pn.nodes["Principled BSDF"].inputs["Coat Roughness"].default_value = 0.06
        plane("tower_panel", (tw - 0.016, th - 0.016), (tx, front - 0.0004, th / 2), (math.pi / 2, 0, 0), pm)
    logo = texture_path("omf-logo")
    if logo:
        plane("tower_logo", (0.14, 0.0697), (tx, front - 0.0012, th - 0.05), (math.pi / 2, 0, 0), decal_mat("tower_logo", logo, emit=0.6))
    bays_top = th - 0.102
    for i in range(2):
        cz = bays_top - i * 0.047 - 0.021
        box(f"bay{i}_frame", (0.152, 0.004, 0.044), (tx, front - 0.0005, cz), M["beige_dark"], bevel=0.002)
        if i == 0:      # a CD-ROM drive: its tray, the eject button, the busy light, a headphone socket and its volume
            box("cdrom", (0.146, 0.006, 0.04), (tx, front - 0.002, cz), M["beige_drive"], bevel=0.002)
            text("cdrom_label", "CD-ROM", 0.0028, M["print"], loc=(tx - 0.03, front - 0.0052, cz - 0.0125), rot=(math.pi / 2, 0, 0), align="CENTER")
            box("cdrom_tray", (0.13, 0.003, 0.016), (tx, front - 0.0055, cz + 0.007), M["beige_dark"], bevel=0.0012)
            box("cdrom_tray_gap", (0.132, 0.001, 0.0012), (tx, front - 0.0052, cz - 0.0016), M["slot"])
            box("cdrom_eject", (0.014, 0.006, 0.006), (tx + 0.056, front - 0.006, cz - 0.011), M["beige_dark"], bevel=0.0015)
            cylinder("cdrom_led", 0.0015, 0.004, (tx + 0.038, front - 0.006, cz - 0.011), M["led_amber"])
            cylinder("cdrom_jack", 0.0025, 0.004, (tx - 0.058, front - 0.006, cz - 0.011), M["slot"])
            cylinder("cdrom_vol", 0.0035, 0.004, (tx - 0.044, front - 0.006, cz - 0.011), M["black"])
        elif i == 1:    # a 5.25-inch floppy drive: its slot and latch
            box("floppy525", (0.146, 0.006, 0.04), (tx, front - 0.002, cz), M["beige_dark"], bevel=0.002)
            box("floppy525_slot", (0.11, 0.004, 0.004), (tx - 0.008, front - 0.005, cz + 0.004), M["slot"])
            box("floppy525_latch", (0.026, 0.008, 0.008), (tx + 0.058, front - 0.006, cz + 0.002), M["black"], bevel=0.002)
            cylinder("floppy525_led", 0.0015, 0.004, (tx - 0.058, front - 0.006, cz - 0.011), M["led_green"])
    fz = bays_top - 2 * 0.047 - 0.02
    box("floppy35_frame", (0.106, 0.004, 0.03), (tx, front - 0.0005, fz), M["beige_dark"], bevel=0.002)
    box("floppy35", (0.1, 0.006, 0.026), (tx, front - 0.002, fz), M["beige_dark"], bevel=0.002)
    box("floppy35_slot", (0.07, 0.004, 0.003), (tx - 0.005, front - 0.005, fz + 0.004), M["slot"])
    box("floppy35_eject", (0.01, 0.006, 0.006), (tx + 0.038, front - 0.006, fz - 0.006), M["beige"], bevel=0.0015)
    cylinder("floppy35_led", 0.0013, 0.004, (tx - 0.038, front - 0.006, fz - 0.007), M["led_green"])
    pz = fz - 0.05
    box("display_window", (0.04, 0.004, 0.022), (tx - 0.05, front - 0.002, pz), M["seg_window"], bevel=0.0015)
    seven(("9", "7"), (tx - 0.05, front - 0.0045, pz), 0.0085, M["seg"])
    for i, (name, m) in enumerate((("led_power", M["led_green"]), ("led_turbo", M["led_amber"]), ("led_disk", M["led_amber"]))):
        cylinder(name, 0.0016, 0.004, (tx - 0.016 + i * 0.012, front - 0.003, pz + 0.006), m)
    labels = (("POWER", tx - 0.016), ("TURBO", tx - 0.004), ("HDD", tx + 0.008))
    for name, x in labels:
        text(f"label_{name}", name, 0.0024, M["print"], loc=(x, front - 0.0021, pz - 0.0008), rot=(math.pi / 2, 0, 0), align="CENTER")
    box("turbo_button", (0.016, 0.008, 0.009), (tx + 0.035, front - 0.004, pz + 0.004), M["beige_dark"], bevel=0.0018)
    box("reset_button", (0.01, 0.008, 0.007), (tx + 0.06, front - 0.004, pz + 0.004), M["beige_dark"], bevel=0.0015)
    text("label_turbo_btn", "TURBO", 0.0024, M["print"], loc=(tx + 0.035, front - 0.0021, pz - 0.0065), rot=(math.pi / 2, 0, 0), align="CENTER")
    text("label_reset_btn", "RESET", 0.0024, M["print"], loc=(tx + 0.06, front - 0.0021, pz - 0.0065), rot=(math.pi / 2, 0, 0), align="CENTER")
    cylinder("keylock", 0.006, 0.006, (tx + 0.035, front - 0.004, pz - 0.03), M["metal"], bevel=0.001)
    box("keylock_slot", (0.0015, 0.004, 0.006), (tx + 0.035, front - 0.0075, pz - 0.03), M["slot"])
    box("power_switch", (0.034, 0.012, 0.024), (tx - 0.03, front - 0.005, pz - 0.034), M["beige_dark"], bevel=0.004)
    hz = texture_path("hazard")
    if hz:
        plane("tower_hazard", (tw - 0.03, 0.022), (tx, front - 0.0007, 0.032), (math.pi / 2, 0, 0), image_mat("tower_hazard", hz, rough=0.45))
    return tx


def seven(digits, center, height, material):
    """Seven-segment digits (each a few thin boxes), side by side around `center` (facing -y)."""
    SEG = {"6": "afedcg", "8": "abcdefg", "0": "abcdef", "9": "abcdfg", "7": "abc"}
    w = height * 0.55
    t = height * 0.13
    cx, cy, cz = center
    for k, d in enumerate(digits):
        ox = cx + (k - (len(digits) - 1) / 2) * (w + height * 0.35)
        h2 = height / 2
        pos = {
            "a": ((ox, cz + h2), (w, t)), "g": ((ox, cz), (w, t)), "d": ((ox, cz - h2), (w, t)),
            "f": ((ox - w / 2, cz + h2 / 2), (t, h2)), "b": ((ox + w / 2, cz + h2 / 2), (t, h2)),
            "e": ((ox - w / 2, cz - h2 / 2), (t, h2)), "c": ((ox + w / 2, cz - h2 / 2), (t, h2)),
        }
        for s in SEG[d]:
            (x, z), (sx, sz) = pos[s]
            box(f"seg{k}{s}", (sx, 0.001, sz), (x, cy, z), material)


# ---- the keyboard: a 101-key layout like IBM's Model M ------------------------------------------------------------------------

# Rows from the front: (label, width in keys) and gaps ("", width); a key two rows tall has height 2 (it rises from its row).
ROWS = [
    [("Ctrl", 1.5), ("", 1), ("Alt", 1.5), (" ", 7), ("Alt", 1.5), ("", 1), ("Ctrl", 1.5), ("", 0.5),
     ("←", 1), ("↓", 1), ("→", 1), ("", 0.5), ("0", 2), (".", 1)],
    [("Shift", 2.25), ("Z", 1), ("X", 1), ("C", 1), ("V", 1), ("B", 1), ("N", 1), ("M", 1), (",", 1), (".", 1), ("/", 1),
     ("Shift", 2.75), ("", 1.5), ("↑", 1), ("", 1.5), ("1", 1), ("2", 1), ("3", 1), ("Enter", 1, 2)],
    [("Caps Lock", 1.75), ("A", 1), ("S", 1), ("D", 1), ("F", 1), ("G", 1), ("H", 1), ("J", 1), ("K", 1), ("L", 1), (";", 1),
     ("'", 1), ("Enter", 2.25), ("", 4), ("4", 1), ("5", 1), ("6", 1)],
    [("Tab", 1.5), ("Q", 1), ("W", 1), ("E", 1), ("R", 1), ("T", 1), ("Y", 1), ("U", 1), ("I", 1), ("O", 1), ("P", 1), ("[", 1),
     ("]", 1), ("\\", 1.5), ("", 0.5), ("Del", 1), ("End", 1), ("PgDn", 1), ("", 0.5), ("7", 1), ("8", 1), ("9", 1), ("+", 1, 2)],
    [("`", 1), ("1", 1), ("2", 1), ("3", 1), ("4", 1), ("5", 1), ("6", 1), ("7", 1), ("8", 1), ("9", 1), ("0", 1), ("-", 1),
     ("=", 1), ("Backspace", 2), ("", 0.5), ("Ins", 1), ("Home", 1), ("PgUp", 1), ("", 0.5), ("Num", 1), ("/", 1), ("*", 1),
     ("-", 1)],
    [("Esc", 1), ("", 1), ("F1", 1), ("F2", 1), ("F3", 1), ("F4", 1), ("", 0.5), ("F5", 1), ("F6", 1), ("F7", 1), ("F8", 1),
     ("", 0.5), ("F9", 1), ("F10", 1), ("F11", 1), ("F12", 1), ("", 0.5), ("Print", 1), ("Scroll", 1), ("Pause", 1)],
]
DARK_KEYS = {"Ctrl", "Alt", "Shift", "Caps Lock", "Enter", "Tab", "Backspace", "Esc", "Num", "Ins", "Home", "PgUp", "Del",
             "End", "PgDn", "Print", "Scroll", "Pause", "←", "→", "↑", "↓", "+", "*"}
# the keys a fighting game wears shiny: the arrows, Enter, the Shifts, Ctrl, Alt and the space bar
WORN_KEYS = {"←", "→", "↑", "↓", "Enter", "Shift", "Ctrl", "Alt", " "}
# per row: the keycap's height (m) and how far its top faces the typist (degrees): a sculpted profile
PROFILE = [(0.0112, -2.0), (0.0102, 3.0), (0.0098, 6.0), (0.0104, 10.0), (0.0114, 14.0), (0.0114, 14.0)]
PLATE_TILT = math.radians(8.0)


def keycap_mesh(name, w_units, h_units, row, cache={}):
    key = (w_units, h_units, row)
    if key in cache:
        try:
            if cache[key].name in bpy.data.meshes:
                return cache[key]
        except ReferenceError:
            pass
    h, tilt = PROFILE[row]
    tilt = math.radians(tilt)
    bw, bd = w_units * U - 0.0012, h_units * U - 0.0012
    tw, td = bw - 0.0052, bd - 0.0054
    cy_top = 0.0008       # (the top leans back a little: the Model M's caps are taller at the front)
    bottom = ring_xy(bw, bd, 0.0012, 0.0, n_arc=3, n_edge=3)
    mid = [(x * (1 - 0.35 * 0.0052 / bw), y * (1 - 0.35 * 0.0054 / bd) + 0.0003, h * 0.6 + y * math.tan(tilt) * 0.6)
           for x, y, _ in bottom]
    top = [(x, y + cy_top, h + y * math.tan(tilt)) for x, y, _ in ring_xy(tw, td, 0.0022, 0.0, n_arc=3, n_edge=3)]
    bm = bmesh.new()
    vs = [[bm.verts.new(p) for p in ring] for ring in (bottom, mid, top)]
    n = len(bottom)
    for a, b in zip(vs, vs[1:]):
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((a[i], a[j], b[j], b[i]))
    bm.faces.new(vs[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    try:
        me.set_sharp_from_angle(angle=math.radians(35))
    except AttributeError:
        pass
    # (one material slot, filled per key on its object: the keys share their shapes, not their colors)
    me.materials.append(None)
    cache[key] = me
    return me


def keyboard(M, cx):
    """The keyboard, its main block's middle at x = cx: a wedge-shaped base, its top a plate tilted toward the typist
    that carries the keys inside a raised rim. Returns its right edge."""
    key_w, key_d = 23 * U, 6.4 * U
    mx, mf, mb = 0.016, 0.013, 0.022              # the rim's margins: sides, front, back
    case_w, case_d = key_w + 2 * mx, key_d + mf + mb
    y_front = -0.315
    xc = cx - 7.5 * U + key_w / 2                 # (the case's middle: the main block's middle is cx)
    t = PLATE_TILT
    z_front = 0.012
    # the base: its top on the plate's plane
    bpy.ops.mesh.primitive_cube_add(size=1, location=(xc, y_front + case_d / 2, z_front / 2))
    base = bpy.context.active_object
    base.name = "keyboard_base"
    base.scale = (case_w, case_d, z_front)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for v in base.data.vertices:
        if v.co.z > 0.001:
            v.co.z = z_front + (v.co.y - y_front) * math.tan(t)
    b = base.modifiers.new("bevel", "BEVEL")
    b.width = 0.0015
    b.segments = 2
    b.limit_method = "ANGLE"
    b.harden_normals = True
    base.data.materials.append(M["beige"])
    for p in base.data.polygons:
        p.use_smooth = True
    plate = link(bpy.data.objects.new("keyboard_plate", None))
    plate.location = (xc, y_front, z_front)
    plate.rotation_euler = (t, 0, 0)

    def on_plate(ob):
        ob.parent = plate
        return ob
    # the well under the keys, dark, and the rim around them (a frame: its outer edge rounded, its inner edge crisp)
    on_plate(box("keyboard_well", (key_w + 0.004, key_d + 0.004, 0.002), (0, mf + key_d / 2, 0.001), M["slot"]))
    rim = loft("keyboard_rim", [
        ring_xy(case_w, case_d, 0.008, 0.0, cy=case_d / 2),
        ring_xy(case_w, case_d, 0.008, 0.005, cy=case_d / 2),
        ring_xy(case_w - 0.004, case_d - 0.004, 0.006, 0.0078, cy=case_d / 2),
        ring_xy(key_w + 0.003, key_d + 0.003, 0.002, 0.0078, cy=mf + key_d / 2),
        ring_xy(key_w + 0.002, key_d + 0.002, 0.0015, 0.002, cy=mf + key_d / 2),
    ], M["beige"], angle=50)
    on_plate(rim)

    def fill(x0, x1, d0, d1, name):
        """The case's surface between key groups (flush with the rim's top)."""
        on_plate(box(name, (x1 - x0 - 0.0008, d1 - d0 - 0.0008, 0.006), ((x0 + x1) / 2, (d0 + d1) / 2, 0.0048), M["beige"], bevel=0.0006, segments=2))
    row_d = [mf + 0.001 + r * U + (0.4 * U if r == 5 else 0) for r in range(6)]
    for r, row in enumerate(ROWS):
        x = -key_w / 2
        for item in row:
            if not item[0]:
                fill(x, x + item[1] * U, row_d[r], row_d[r] + U, f"kb_fill_{r}_{x:.3f}")
            x += item[1] * U
        if r == 5 and x < key_w / 2 - 1e-6:
            fill(x, key_w / 2, row_d[r], row_d[r] + U, "kb_fill_numpad_top")
    fill(-key_w / 2, key_w / 2, row_d[4] + U, row_d[5], "kb_fill_frow_gap")
    for r, row in enumerate(ROWS):
        x = -key_w / 2
        d = mf + 0.001 + (r + 0.5) * U + (0.4 * U if r == 5 else 0)
        for item in row:
            label, wu = item[0], item[1]
            hu = item[2] if len(item) > 2 else 1
            if not label:
                x += wu * U
                continue
            prow = r
            me = keycap_mesh(f"cap_{wu}_{hu}_{prow}", wu, hu, prow)
            ob = on_plate(link(bpy.data.objects.new(f"key_{r}_{label}_{x:.3f}", me)))
            # (a key two rows tall reaches forward, into the row in front of it: the numeric pad's + and Enter)
            ob.location = (x + wu * U / 2, d - (hu - 1) * U / 2, 0.0035)
            dark = label in DARK_KEYS or (label.startswith("F") and len(label) > 1)
            body, lm = label, "print"
            if label in ("←", "→", "↑", "↓"):
                cap, lm = "key_red", "legend_white"
            elif label == "Enter" and wu == 2.25:
                cap, body, lm = "key_gold", "PUNCH", "legend_black"
            elif label == "Shift" and wu == 2.75:
                cap, body, lm = "key_gold", "KICK", "legend_black"
            elif (label.startswith("F") and len(label) > 1) or label == "Esc":
                cap, lm = "key_dark", "legend_gold"
            elif dark:
                cap, lm = "key_dark", "legend_dim"
            else:
                cap = "key"
            slot = ob.material_slots[0]
            slot.link = "OBJECT"
            slot.material = M[cap]
            bev = ob.modifiers.new("bevel", "BEVEL")
            bev.width = 0.0008
            bev.segments = 3
            bev.limit_method = "ANGLE"
            bev.angle_limit = math.radians(30)
            if label.strip():
                h, tilt = PROFILE[prow]
                big = len(body) == 1
                size = 0.0042 if big else (0.0027 if body in ("PUNCH", "KICK") else 0.0023)
                lx = -(wu * U - 0.0064) / 2 + 0.0012
                ly = 0.0008 + (hu * U - 0.0066) / 2 - (0.0051 if big else 0.0033)
                body = "Num\nLock" if label == "Num" else body
                tx = text(f"legend_{r}_{x:.3f}", body, size, M[lm],
                          loc=(lx, ly, h + ly * math.tan(math.radians(tilt)) + 0.00015), rot=(math.radians(tilt), 0, 0), parent=ob)
                tx.data.space_line = 0.85
                if label == "Num":
                    tx.location.y += 0.0016
            x += wu * U
    # the lock lights over the numeric pad (on the case's surface there, as on a Model M), their names under them
    for i, name in enumerate(("Num Lock", "Caps Lock", "Scroll Lock")):
        lx = -key_w / 2 + 19.5 * U + i * 1.15 * U
        ld = row_d[5] + 0.62 * U
        on_plate(box(f"kb_led{i}", (0.0045, 0.0024, 0.0012), (lx, ld, 0.0083), M["led_green"]))
        on_plate(text(f"kb_led_label{i}", name, 0.0018, M["print"], loc=(lx, ld - 0.0068, 0.00785), align="CENTER"))
    cable("keyboard_cable", [(cx, y_front + case_d - 0.005, 0.014), (cx - 0.02, 0.0, 0.004), (cx - 0.08, 0.12, 0.004)], 0.0026, M["cable"])
    return xc + case_w / 2


# ---- the mouse, its pad, the floppies, the sticky note ---------------------------------------------------------------------------

def mouse_mat():
    """The mouse's plastic, its two buttons' seams molded in (a lengthwise split and the line across their back)."""
    m = plastic("mouse_plastic", "#3a3f4a", "#353a44", rough=0.34, grime=0.3, dust=0.08)
    nt = m.node_tree
    p = nt.nodes["Principled BSDF"]
    coord = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(coord.outputs["Object"], sep.inputs[0])

    def band(axis, center, half, lo=None):
        d = nt.nodes.new("ShaderNodeMath")
        d.operation = "SUBTRACT"
        d.inputs[1].default_value = center
        nt.links.new(sep.outputs[axis], d.inputs[0])
        a = nt.nodes.new("ShaderNodeMath")
        a.operation = "ABSOLUTE"
        nt.links.new(d.outputs[0], a.inputs[0])
        lt = nt.nodes.new("ShaderNodeMath")
        lt.operation = "LESS_THAN"
        lt.inputs[1].default_value = half
        nt.links.new(a.outputs[0], lt.inputs[0])
        return lt
    split = band("X", 0.0, 0.0006)
    ahead = nt.nodes.new("ShaderNodeMath")
    ahead.operation = "GREATER_THAN"
    ahead.inputs[1].default_value = 0.004
    nt.links.new(sep.outputs["Y"], ahead.inputs[0])
    s1 = nt.nodes.new("ShaderNodeMath")
    s1.operation = "MULTIPLY"
    nt.links.new(split.outputs[0], s1.inputs[0])
    nt.links.new(ahead.outputs[0], s1.inputs[1])
    across = band("Y", 0.004, 0.0006)
    high = nt.nodes.new("ShaderNodeMath")
    high.operation = "GREATER_THAN"
    high.inputs[1].default_value = 0.016
    nt.links.new(sep.outputs["Z"], high.inputs[0])
    s2 = nt.nodes.new("ShaderNodeMath")
    s2.operation = "MULTIPLY"
    nt.links.new(across.outputs[0], s2.inputs[0])
    nt.links.new(high.outputs[0], s2.inputs[1])
    seam = nt.nodes.new("ShaderNodeMath")
    seam.operation = "MAXIMUM"
    nt.links.new(s1.outputs[0], seam.inputs[0])
    nt.links.new(s2.outputs[0], seam.inputs[1])
    base = p.inputs["Base Color"].links[0].from_socket
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    nt.links.new(seam.outputs[0], mix.inputs["Factor"])
    nt.links.new(base, mix.inputs["A"])
    mix.inputs["B"].default_value = (0.004, 0.004, 0.006, 1)
    nt.links.new(mix.outputs["Result"], p.inputs["Base Color"])
    bump = p.inputs["Normal"].links[0].from_node
    inv = nt.nodes.new("ShaderNodeMath")
    inv.operation = "SUBTRACT"
    inv.inputs[0].default_value = 1.0
    nt.links.new(seam.outputs[0], inv.inputs[1])
    b2 = nt.nodes.new("ShaderNodeBump")
    b2.inputs["Strength"].default_value = 0.9
    b2.inputs["Distance"].default_value = 0.0006
    nt.links.new(inv.outputs[0], b2.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], b2.inputs["Normal"])
    nt.links.new(b2.outputs["Normal"], p.inputs["Normal"])
    return m


def mouse(M, mx, my, angle=16.0):
    """A two-button mouse: high at the palm, sloping down to its buttons (away from the typist, toward +y), the cable
    out of its front; turned `angle` degrees, as a hand leaves it."""
    rings = [
        ring_xy(0.055, 0.094, 0.018, 0.0),
        ring_xy(0.059, 0.099, 0.02, 0.003),
        ring_xy(0.0602, 0.1, 0.022, 0.01),
        ring_xy(0.0592, 0.098, 0.022, 0.017, cy=-0.001),
        ring_xy(0.055, 0.088, 0.02, 0.024, cy=-0.006),
        ring_xy(0.047, 0.07, 0.018, 0.0292, cy=-0.012),
        ring_xy(0.034, 0.048, 0.014, 0.0328, cy=-0.016),
        ring_xy(0.016, 0.022, 0.007, 0.0346, cy=-0.018),
    ]
    ob = loft("mouse", rings, mouse_mat(), cap_first=True, cap_last=True, angle=80, subd=2)
    ob.location = (mx, my, 0.004)
    a = math.radians(angle)
    ob.rotation_euler = (0, 0, a)
    relief = cylinder("mouse_relief", 0.0035, 0.012, (0, 0.051, 0.011), M["cable"], axis="Y")
    relief.parent = ob
    fx, fy = mx - 0.056 * math.sin(a), my + 0.056 * math.cos(a)
    cable("mouse_cable", [(fx, fy, 0.015), (fx - 0.012, fy + 0.06, 0.005), (fx - 0.08, fy + 0.13, 0.004),
                          (fx - 0.16, 0.12, 0.004)], 0.0021, M["cable"])
    return ob


def mousepad(M, cx, cy):
    path = texture_path("mousepad-omf") or texture_path("mousepad")
    pw, pd = 0.235, 0.195
    m = image_mat("mousepad", path, rough=0.8, bump=0.08, box=(cx - pw / 2, cy - pd / 2, cx + pw / 2, cy + pd / 2)) if path else M["pad"]
    loft("mousepad", [ring_xy(pw, pd, 0.012, 0.0, cx=cx, cy=cy), ring_xy(pw, pd, 0.012, 0.0032, cx=cx, cy=cy),
                      ring_xy(pw - 0.002, pd - 0.002, 0.011, 0.004, cx=cx, cy=cy)], m, cap_first=True, cap_last=True, angle=35)


def floppies(M, cx, cy):
    for i, (hexc, dx, dy, rot, label) in enumerate((("#1d2f6b", 0.0, 0.0, 12, "label-disk1"), ("#202022", 0.03, 0.035, -9, "label-disk2"))):
        z = 0.0017 + i * 0.0034
        disk = box(f"floppy{i}", (0.09, 0.094, 0.0033), (cx + dx, cy + dy, z), mat(f"floppy{i}", lin(hexc), rough=0.35), bevel=0.0012)
        disk.rotation_euler = (0, 0, math.radians(rot))
        sh = box(f"floppy{i}_shutter", (0.05, 0.03, 0.0006), (0, 0.032, 0.0018), M["metal"])
        sh.parent = disk
        path = texture_path(label)
        lm = image_mat(f"label{i}", path, rough=0.7) if path else M["label"]
        lab = plane(f"floppy{i}_label", (0.07, 0.045), (0, -0.018, 0.0019), (0, 0, 0), lm)
        lab.parent = disk


def cd_case(M, cx, cy, angle=14.0):
    cover = texture_path("cd-cover")
    if not cover:
        return
    case = box("cd_case", (0.125, 0.142, 0.0045), (cx, cy, 0.0023), mat("cd_tray", lin("#101010"), rough=0.3), bevel=0.0008)
    case.rotation_euler = (0, 0, math.radians(angle))
    art = plane("cd_cover", (0.12, 0.12), (0.003, 0.0, 0.0047), (0, 0, 0), image_mat("cd_cover", cover, rough=0.3))
    art.parent = case
    lid = box("cd_lid", (0.125, 0.142, 0.0016), (0, 0, 0.0058), mat("cd_lid", (1, 1, 1), rough=0.04), bevel=0.0006)
    lm = lid.data.materials[0].node_tree.nodes["Principled BSDF"]
    lm.inputs["Transmission Weight"].default_value = 1.0
    lm.inputs["IOR"].default_value = 1.49
    lid.parent = case


def poster(M):
    path = texture_path("poster-main")
    if not path:
        return
    x, z, w, h = -0.335, 0.33, 0.165, 0.22
    box("poster_frame", (w + 0.014, 0.012, h + 0.014), (x, 0.589, z), mat("frame_black", lin("#0c0c0e"), rough=0.35), bevel=0.0015)
    plane("poster", (w, h), (x, 0.5825, z), (math.pi / 2, 0, 0), image_mat("poster", path, rough=0.25, coat=0.6, coat_rough=0.05))


def sticky_note(M):
    path = texture_path("sticky-note")
    m = image_mat("sticky", path, rough=0.75) if path else mat("note", lin("#e8d65a"), rough=0.75)
    x = SCREEN_W / 2 + CHAMFER - 0.004
    z = SCREEN_Z + SCREEN_H / 2 + 0.006
    note = plane("sticky_note", (0.038, 0.038), (x, -0.0016, z), (math.pi / 2, math.radians(9), 0), m)
    return note


# ---- the whole computer ------------------------------------------------------------------------------------------------------------------

def build(state):
    """state: 'on' (the lights and the screen on), 'off' (the screen and the lights off: the keys' legends and the
    tower's panel still glow), 'lit' (on, the screen dark: for a picture put on it afterwards) or 'dark' (all off)."""
    on = state in ("on", "lit")
    M = {
        "beige": steel("steel", "#a9b0ba", rough=0.3),
        "beige_case": steel("steel_case", "#8a919c", rough=0.36, metal=0.45),
        "beige_dark": steel("gunmetal", "#4b515c", rough=0.34),
        "beige_drive": steel("gunmetal_dark", "#2c3038", rough=0.32),
        "plates": plates_mat("plates"),
        "key": plastic("key_navy", "#18205e", "#151c55", rough=0.36, texture=0.02, grime=0.3, dust=0.06),
        "key_dark": plastic("key_navy_dark", "#0c1036", "#0b0e30", rough=0.36, texture=0.02, grime=0.3, dust=0.06),
        "key_red": plastic("key_red", "#b5141c", "#a8121a", rough=0.32, texture=0.02, grime=0.3, dust=0.04),
        "key_gold": plastic("key_gold", "#e8ae1c", "#dca218", rough=0.3, texture=0.02, grime=0.3, dust=0.04),
        "print": glow_mat("legend_green", (16, 229, 17), 1.6),
        "legend_dim": glow_mat("legend_dim", (8, 160, 9), 1.2),
        "legend_gold": glow_mat("legend_gold", (255, 200, 40), 1.4),
        "legend_white": mat("legend_white", (0.9, 0.9, 0.9), rough=0.4),
        "legend_black": mat("legend_black", (0.02, 0.02, 0.02), rough=0.4),
        "led_red": mat("led_red", lin("#300808"), rough=0.2, emit=(1.0, 0.06, 0.04) if on else None, strength=25.0 if on else 0.0),
        "black": mat("black_plastic", lin("#141414"), rough=0.4),
        "metal": mat("shutter", lin("#a8a9ab"), rough=0.3, metal=1.0),
        "label": mat("label", lin("#e9e6dc"), rough=0.7),
        "pad": mat("mousepad_plain", lin("#1d2a4a"), rough=0.85),
        "cable": mat("cable", lin("#b3a98f"), rough=0.5),
        "slot": mat("slot", (0.0, 0.0, 0.0), rough=0.8),
        "grille": mat("grille", lin("#1c1b1a"), rough=0.6, metal=0.3),
        "led_green": mat("led_green", lin("#103010"), rough=0.2, emit=(0.15, 1.0, 0.25) if on else None, strength=25.0 if on else 0.0),
        "led_amber": mat("led_amber", lin("#302008"), rough=0.2, emit=(1.0, 0.55, 0.05) if on else None, strength=18.0 if on else 0.0),
        "seg_window": mat("seg_window", lin("#1a0303"), rough=0.08, coat=1.0, coat_rough=0.03),
        "seg": mat("seg", lin("#2a0505"), rough=0.3, emit=(1.0, 0.05, 0.02) if on else None, strength=30.0 if on else 0.0),
    }
    screen = state == "on"
    glass = mat("crt_glass", lin("#0b0d0c") if not screen else lin("#1a2230"), rough=0.12, coat=1.0, coat_rough=0.04,
                emit=(0.55, 0.68, 1.0) if screen else None, strength=1.4 if screen else 0.0, spec=0.6)
    gn = glass.node_tree
    gp = gn.nodes["Principled BSDF"]
    gc = gn.nodes.new("ShaderNodeTexCoord")
    smudge = _noise(gn, 7.0, 8.0, 0.62)
    gn.links.new(gc.outputs["Object"], smudge.inputs["Vector"])
    sr = gn.nodes.new("ShaderNodeMapRange")
    sr.inputs["From Min"].default_value = 0.45
    sr.inputs["From Max"].default_value = 0.75
    sr.inputs["To Min"].default_value = 0.02
    sr.inputs["To Max"].default_value = 0.2
    gn.links.new(smudge.outputs["Fac"], sr.inputs["Value"])
    gn.links.new(sr.outputs["Result"], gp.inputs["Coat Roughness"])
    desk = box("desk", (2.8, 1.6, 0.035), (0.0, -0.2, -0.0175), wood("wood"), bevel=0.004)
    box("wall", (4.0, 0.05, 2.0), (0.0, 0.62, 0.7), wall("wall"))
    monitor(M, glass)
    speakers(M)
    tower(M)
    kb_right = keyboard(M, 0.0)
    mousepad(M, kb_right + 0.115, -0.2)
    mouse(M, kb_right + 0.11, -0.21)
    cd_case(M, -0.205, -0.085)
    poster(M)
    floppies(M, -0.24, -0.205)
    sticky_note(M)
    if state == "dark":
        # (nothing glows: the keys' legends, the tower's panel and its logo are dark too)
        for m in bpy.data.materials:
            p = m.node_tree.nodes.get("Principled BSDF") if m.use_nodes else None
            if p is not None:
                p.inputs["Emission Strength"].default_value = 0.0
            for n in (m.node_tree.nodes if m.use_nodes else []):
                if n.type == "EMISSION":
                    n.inputs["Strength"].default_value = 0.0
    return glass


# ---- lights and camera -------------------------------------------------------------------------------------------------------------

def aim(ob, target):
    d = Vector(target) - ob.location
    ob.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


def lights():
    sc = bpy.context.scene
    # the desk lamp out of frame on the left: warm, soft
    lamp = bpy.data.lights.new("desk_lamp", "SPOT")
    lamp.energy = 70.0
    lamp.color = (1.0, 0.79, 0.57)
    lamp.spot_size = math.radians(70)
    lamp.spot_blend = 1.0
    lamp.shadow_soft_size = 0.07
    ob = link(bpy.data.objects.new("desk_lamp", lamp))
    ob.location = (frac_x(-0.25), -0.5, 0.7)
    aim(ob, (-0.04, 0.0, 0.12))
    # a soft cool fill from the right front, low: the tower's front readable under the credits
    fill = bpy.data.lights.new("fill", "AREA")
    fill.energy = 2.6
    fill.size = 0.8
    fill.color = (0.75, 0.82, 1.0)
    ob = link(bpy.data.objects.new("fill", fill))
    ob.location = (frac_x(1.15), -1.0, 0.5)
    aim(ob, (frac_x(0.8), 0.0, 0.2))
    ob.visible_glossy = False
    # the lamp's warm spill on the wall behind, separating the computer from the dark
    spill = bpy.data.lights.new("wall_spill", "AREA")
    spill.energy = 38.0
    spill.size = 1.0
    spill.color = (1.0, 0.76, 0.52)
    ob = link(bpy.data.objects.new("wall_spill", spill))
    ob.location = (-0.25, 0.25, 0.85)
    aim(ob, (-0.05, 0.62, 0.45))
    ob.visible_glossy = False
    # a cool blue rim from behind on the right, as the main menu's night sky lights its robot
    rim = bpy.data.lights.new("rim", "AREA")
    rim.energy = 28.0
    rim.size = 0.7
    rim.color = (0.35, 0.5, 1.0)
    ob = link(bpy.data.objects.new("rim", rim))
    ob.location = (0.95, 0.85, 0.75)
    aim(ob, (0.15, 0.0, 0.2))
    ob.visible_camera = False
    # what the steel reflects: a soft box above the desk, the lamp's shade, and the dim room behind the camera
    bpy.ops.mesh.primitive_plane_add(size=1, location=(0.1, -0.7, 1.3), rotation=(math.radians(-35), 0, 0))
    soft = bpy.context.active_object
    soft.name = "softbox"
    soft.scale = (1.6, 0.8, 1.0)
    soft.data.materials.append(mat("softbox", (0.0, 0.0, 0.0), emit=(0.85, 0.9, 1.0), strength=0.9))
    for flag in ("visible_camera", "visible_diffuse", "visible_shadow", "visible_transmission", "visible_volume_scatter"):
        setattr(soft, flag, False)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.07, location=(frac_x(-0.25), -0.5, 0.7))
    shade = bpy.context.active_object
    shade.name = "lamp_shade"
    shade.data.materials.append(mat("shade", (0.0, 0.0, 0.0), emit=(1.0, 0.75, 0.5), strength=6.0))
    for flag in ("visible_camera", "visible_diffuse", "visible_shadow"):
        setattr(shade, flag, False)
    bpy.ops.mesh.primitive_plane_add(size=1, location=(0.0, -2.4, 0.5), rotation=(math.pi / 2, 0, 0))
    room = bpy.context.active_object
    room.name = "room_reflection"
    room.scale = (3.0, 1.6, 1.0)
    room.data.materials.append(mat("room", (0.0, 0.0, 0.0), emit=(1.0, 0.85, 0.7), strength=0.15))
    for flag in ("visible_camera", "visible_diffuse", "visible_shadow", "visible_transmission", "visible_volume_scatter"):
        setattr(room, flag, False)


def camera():
    sc = bpy.context.scene
    cam = bpy.data.cameras.new("cam")
    cam.lens = LENS
    cam.sensor_width = 36
    cam.sensor_fit = "HORIZONTAL"
    cam.shift_x = SHIFT_X
    cam.shift_y = SHIFT_Y
    cam.dof.use_dof = True
    cam.dof.focus_distance = CAM_DIST - 0.1
    cam.dof.aperture_fstop = 8.0
    ob = link(bpy.data.objects.new("cam", cam))
    ob.location = (0.0, -CAM_DIST, CAM_Z)
    ob.rotation_euler = (math.pi / 2, 0, 0)
    sc.camera = ob
    return ob


# ---- renders ----------------------------------------------------------------------------------------------------------------------------

def render(path):
    sc = bpy.context.scene
    sc.render.filepath = path
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGB"
    sc.render.image_settings.color_depth = "16" if path.endswith("uv.png") else "8"
    bpy.ops.render.render(write_still=True)
    print("RENDERED", path, flush=True)


def flat_pass(kind):
    """The glass alone, flat colors, no tone mapping (everything in front of it held out): its mask (white) or its
    u, v (red, green)."""
    sc = bpy.context.scene
    sc.view_settings.view_transform = "Raw"
    sc.view_settings.look = "None"
    sc.view_settings.exposure = 0.0
    sc.cycles.samples = 64
    sc.cycles.use_denoising = False
    sc.camera.data.dof.use_dof = False
    sc.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.0
    holdout = bpy.data.materials.new("holdout")
    holdout.use_nodes = True
    hn = holdout.node_tree
    for n in list(hn.nodes):
        hn.nodes.remove(n)
    ho = hn.nodes.new("ShaderNodeHoldout")
    hout = hn.nodes.new("ShaderNodeOutputMaterial")
    hn.links.new(ho.outputs["Holdout"], hout.inputs["Surface"])
    for ob in sc.objects:
        if ob.type == "LIGHT":
            ob.hide_render = True
        elif ob.type in ("MESH", "CURVE", "FONT") and ob.name != "crt_glass" and not ob.hide_render:
            if not ob.visible_camera:
                ob.hide_render = True
                continue
            ob.data.materials.clear()
            ob.data.materials.append(holdout)
    g = sc.objects["crt_glass"]
    m = bpy.data.materials.new(f"glass_{kind}")
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Strength"].default_value = 1.0
    if kind == "mask":
        em.inputs["Color"].default_value = (1, 1, 1, 1)
    else:
        uv = nt.nodes.new("ShaderNodeTexCoord")
        nt.links.new(uv.outputs["UV"], em.inputs["Color"])
    nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
    g.data.materials.clear()
    g.data.materials.append(m)
    sc.render.filter_size = 1.0


def main():
    wanted = set(A.only.split(","))
    for state in ("on", "off", "lit", "dark"):
        if state not in wanted:
            continue
        reset()
        build(state)
        lights()
        camera()
        render(os.path.join(A.out, f"{state}.png"))
    for kind in ("mask", "uv"):
        if kind not in wanted:
            continue
        reset()
        build("off")
        camera()
        flat_pass(kind)
        render(os.path.join(A.out, "screen-mask.png" if kind == "mask" else "screen-uv.png"))


main()
