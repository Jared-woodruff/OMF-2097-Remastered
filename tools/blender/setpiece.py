"""Set pieces for the new arenas' moving scenery, modeled and rendered in Blender (src/gen/scene/scenery.ts).

Each piece renders its frames as the HD pictures of its sprites (src/gen/scene/scenery/<piece>-<frame>.png: the sprite
and its margin, at 5 x 6 HD pixels per native pixel times --scale), transparent; the game's sprites are made from them.
- car (ROOFTOP): a hover-car with a dark gunmetal body, a tinted canopy, a neon stripe, twin thrusters, a pink
  underglow and navigation lights, lit like the arena's night (a cool key light from above, a pink rim, the city's glow
  from below). Frame A: navigation lights on, thrusters bright; B: lights off, thrusters dimmer.
- shuttle (ORBITAL): a spaceplane passing outside the hangar's window, white with a black belly, lit by the sun and the
  Earth below. Frame A: its strobe on; B: off.
- sub (ABYSS): a yellow research submersible passing outside the dome, its headlights' beams in the water, tinted by
  the deep sea. Frame A: its beacon on; B: off.
- meteor (ICE CAVE): a shooting star (drawn, not modeled: a glowing streak, no Blender scene). Frames A and B flicker.

Usage: blender -b --factory-startup -P tools/blender/setpiece.py -- <car|shuttle|sub|meteor> [--out src/gen/scene/scenery]
       [--samples 96] [--scale 2]
"""
import argparse
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Euler, Vector

KIT = os.environ.get("RENDER_KIT", os.path.join(os.path.expanduser("~"), ".claude", "skills", "render-kit", "scripts", "blender"))
if os.path.isdir(KIT) and KIT not in sys.path:
    sys.path.insert(0, KIT)
try:
    import studio as S  # noqa: E402
except ImportError:
    S = None

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
# The margin the pictures cover around the sprites (hd.json's pad), HD pixels per native pixel.
PAD = 4
HD_X, HD_Y = 5, 6


def material(name, color, metallic=0.0, rough=0.45, coat=0.0, emission=None, strength=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes["Principled BSDF"]
    p.inputs["Base Color"].default_value = (*color, 1)
    p.inputs["Metallic"].default_value = metallic
    p.inputs["Roughness"].default_value = rough
    if coat:
        p.inputs["Coat Weight"].default_value = coat
        p.inputs["Coat Roughness"].default_value = 0.08
    if emission:
        p.inputs["Emission Color"].default_value = (*emission, 1)
        p.inputs["Emission Strength"].default_value = strength
    return m


def two_tone(name, top, bottom, rough=0.5, mottle=0.0, split=(0.3, 0.42)):
    """A paint whose downward-facing surfaces are `bottom` (a heat shield, a hull's underside) and the rest `top` (the
    change between `split`, of the surface's normal's z mapped to 0..1); `mottle` darkens it in patches (tiles, wear)
    by up to that much."""
    m = material(name, top, rough=rough)
    nodes, links = m.node_tree.nodes, m.node_tree.links
    geo = nodes.new("ShaderNodeNewGeometry")
    sep = nodes.new("ShaderNodeSeparateXYZ")
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = split[0]
    ramp.color_ramp.elements[0].color = (*bottom, 1)
    ramp.color_ramp.elements[1].position = split[1]
    ramp.color_ramp.elements[1].color = (*top, 1)
    links.new(geo.outputs["Normal"], sep.inputs[0])
    # (normal z -1..1 to 0..1)
    half = nodes.new("ShaderNodeMath")
    half.operation = "MULTIPLY_ADD"
    half.inputs[1].default_value = 0.5
    half.inputs[2].default_value = 0.5
    links.new(sep.outputs["Z"], half.inputs[0])
    links.new(half.outputs[0], ramp.inputs["Fac"])
    color = ramp.outputs["Color"]
    if mottle:
        noise = nodes.new("ShaderNodeTexNoise")
        noise.inputs["Scale"].default_value = 9.0
        noise.inputs["Detail"].default_value = 3.0
        shade = nodes.new("ShaderNodeValToRGB")
        shade.color_ramp.elements[0].position = 0.38
        shade.color_ramp.elements[0].color = (1 - mottle, 1 - mottle, 1 - mottle, 1)
        shade.color_ramp.elements[1].position = 0.62
        shade.color_ramp.elements[1].color = (1, 1, 1, 1)
        links.new(noise.outputs["Fac"], shade.inputs["Fac"])
        mix = nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.blend_type = "MULTIPLY"
        mix.inputs["Factor"].default_value = 1.0
        sock = lambda socks, name: next(x for x in socks if x.name == name and x.type == "RGBA")
        links.new(color, sock(mix.inputs, "A"))
        links.new(shade.outputs["Color"], sock(mix.inputs, "B"))
        color = sock(mix.outputs, "Result")
    links.new(color, nodes["Principled BSDF"].inputs["Base Color"])
    return m


def beam_material(name, color, strength, length, peak=0.55):
    """A light's beam in the water: emission fading along the cone (from its apex at the object's origin, along -z) and
    towards its silhouette, the rest transparent."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nodes, links = m.node_tree.nodes, m.node_tree.links
    nodes.clear()
    out = nodes.new("ShaderNodeOutputMaterial")
    mix = nodes.new("ShaderNodeMixShader")
    tr = nodes.new("ShaderNodeBsdfTransparent")
    em = nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = (*color, 1)
    em.inputs["Strength"].default_value = strength
    tc = nodes.new("ShaderNodeTexCoord")
    sep = nodes.new("ShaderNodeSeparateXYZ")
    along = nodes.new("ShaderNodeMapRange")
    along.inputs["From Min"].default_value = 0.0
    along.inputs["From Max"].default_value = -length
    along.inputs["To Min"].default_value = 1.0
    along.inputs["To Max"].default_value = 0.0
    sq = nodes.new("ShaderNodeMath")
    sq.operation = "POWER"
    sq.inputs[1].default_value = 1.6
    lw = nodes.new("ShaderNodeLayerWeight")
    lw.inputs["Blend"].default_value = 0.5
    inv = nodes.new("ShaderNodeMath")
    inv.operation = "SUBTRACT"
    inv.inputs[0].default_value = 1.0
    edge = nodes.new("ShaderNodeMath")
    edge.operation = "POWER"
    edge.inputs[1].default_value = 2.0
    mul = nodes.new("ShaderNodeMath")
    mul.operation = "MULTIPLY"
    k = nodes.new("ShaderNodeMath")
    k.operation = "MULTIPLY"
    k.inputs[1].default_value = peak
    k.use_clamp = True
    links.new(tc.outputs["Object"], sep.inputs[0])
    links.new(sep.outputs["Z"], along.inputs["Value"])
    links.new(along.outputs["Result"], sq.inputs[0])
    links.new(lw.outputs["Facing"], inv.inputs[1])
    links.new(inv.outputs[0], edge.inputs[0])
    links.new(sq.outputs[0], mul.inputs[0])
    links.new(edge.outputs[0], mul.inputs[1])
    links.new(mul.outputs[0], k.inputs[0])
    links.new(k.outputs[0], mix.inputs["Fac"])
    links.new(tr.outputs[0], mix.inputs[1])
    links.new(em.outputs[0], mix.inputs[2])
    links.new(mix.outputs[0], out.inputs["Surface"])
    return m


def part(prim, name, mat, location=(0, 0, 0), scale=(1, 1, 1), rotation=(0, 0, 0), bevel=0.0, **kw):
    getattr(bpy.ops.mesh, prim)(location=location, rotation=rotation, **kw)
    o = bpy.context.active_object
    o.name = name
    o.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    if bevel:
        b = o.modifiers.new("bevel", "BEVEL")
        b.width = bevel
        b.segments = 3
        b.limit_method = "ANGLE"
    bpy.ops.object.shade_smooth() if prim in ("primitive_uv_sphere_add", "primitive_cylinder_add") else None
    o.data.materials.append(mat)
    return o


def slab(name, mat, outline, thickness, z=0.0, axis="z", bevel=0.0):
    """A flat piece (a wing, a fin) from its outline, `thickness` thick: outline in (x, y) for axis z (a wing lying
    flat at height z), or in (x, z) for axis y (a fin standing up)."""
    verts, n = [], len(outline)
    for side in (-0.5, 0.5):
        for a, b in outline:
            verts.append((a, b, z + side * thickness) if axis == "z" else (a, side * thickness, b))
    faces = [list(range(n)), list(range(2 * n - 1, n - 1, -1))]
    faces += [[i, (i + 1) % n, n + (i + 1) % n, n + i] for i in range(n)]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    o = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(o)
    o.data.materials.append(mat)
    if bevel:
        b = o.modifiers.new("bevel", "BEVEL")
        b.width = bevel
        b.segments = 2
    return o


def join(objects, active):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objects:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active
    bpy.ops.object.join()
    return bpy.context.active_object


def light(name, kind, location, rotation, color, energy, size=1.0):
    data = bpy.data.lights.new(name, kind)
    data.color = color
    data.energy = energy
    if kind == "AREA":
        data.size = size
    o = bpy.data.objects.new(name, data)
    o.location = location
    o.rotation_euler = rotation
    bpy.context.scene.collection.objects.link(o)
    return o


def towards(direction):
    """The rotation that points a light's -z along `direction`."""
    return Vector(direction).normalized().to_track_quat("-Z", "Y").to_euler()


# ---- the hover-car (ROOFTOP) ---------------------------------------------------------------------------------------

def build_car():
    """The hover-car, nose towards -x (it flies to the left of the screen), up = +z."""
    paint = material("paint", (0.05, 0.055, 0.075), metallic=0.8, rough=0.28, coat=0.6)
    dark = material("dark", (0.015, 0.015, 0.02), metallic=0.5, rough=0.45)
    glass = material("glass", (0.02, 0.09, 0.14), metallic=0.3, rough=0.06, coat=1.0, emission=(0.05, 0.35, 0.5), strength=0.6)
    neon = material("neon", (0.1, 0.8, 1.0), emission=(0.15, 0.85, 1.0), strength=6)
    under = material("underglow", (1.0, 0.2, 0.75), emission=(1.0, 0.18, 0.72), strength=2.2)
    head = material("headlight", (1, 1, 1), emission=(1.0, 0.95, 0.85), strength=9)
    tail = material("taillight", (1, 0.05, 0.05), emission=(1.0, 0.06, 0.04), strength=7)
    thrust = material("thrust", (1, 0.3, 0.9), emission=(1.0, 0.25, 0.85), strength=5)
    beacon = material("beacon", (1, 0.08, 0.05), emission=(1.0, 0.08, 0.05), strength=10)

    # Hull: long and low, the nose a wedge; a cabin raised towards the back with the canopy.
    hull = part("primitive_cube_add", "hull", paint, scale=(2.2, 0.8, 0.26), bevel=0.08)
    for v in hull.data.vertices:
        if v.co.x < 0:
            k = min(1.0, -v.co.x / 2.2)
            if v.co.z > 0:
                v.co.z -= 0.2 * k
            v.co.y *= 1 - 0.3 * k
    cabin = part("primitive_cube_add", "cabin", paint, location=(0.55, 0, 0.32), scale=(1.15, 0.62, 0.2), bevel=0.1)
    for v in cabin.data.vertices:
        if v.co.x < 0 and v.co.z > 0:
            v.co.x += 0.35
    part("primitive_uv_sphere_add", "canopy", glass, location=(-0.15, 0, 0.36), scale=(0.95, 0.5, 0.24), segments=48, ring_count=24)
    part("primitive_cube_add", "keel", dark, location=(0.2, 0, -0.27), scale=(1.9, 0.6, 0.07), bevel=0.03)
    for side in (-1, 1):
        part("primitive_cube_add", f"stripe{side}", neon, location=(-0.1, side * 0.805, 0.02), scale=(1.85, 0.012, 0.025))
        # Engine pods along the sides at the back, glowing rings at their ends.
        part("primitive_cylinder_add", f"pod{side}", paint, location=(1.55, side * 0.95, 0.05), rotation=(0, math.pi / 2, 0),
             scale=(0.26, 0.26, 0.75), vertices=48, bevel=0.03)
        part("primitive_torus_add", f"ring{side}", thrust, location=(2.32, side * 0.95, 0.05), rotation=(0, math.pi / 2, 0),
             major_radius=0.19, minor_radius=0.045, major_segments=48, minor_segments=12)
        part("primitive_cylinder_add", f"nozzle{side}", dark, location=(2.3, side * 0.95, 0.05), rotation=(0, math.pi / 2, 0),
             scale=(0.15, 0.15, 0.02), vertices=48)
        part("primitive_cube_add", f"strut{side}", dark, location=(1.35, side * 0.83, 0.05), scale=(0.3, 0.12, 0.05))
        part("primitive_cube_add", f"tail{side}", tail, location=(1.72, side * 0.55, 0.46), scale=(0.04, 0.12, 0.03))
    part("primitive_uv_sphere_add", "headlight", head, location=(-2.18, 0, -0.04), scale=(0.04, 0.38, 0.035), segments=24, ring_count=12)
    part("primitive_cube_add", "underglow", under, location=(0.1, 0, -0.35), scale=(1.5, 0.14, 0.008))
    # Navigation lights at the pods' noses (seen from below), blinking.
    for side, color in ((-1, (1.0, 0.08, 0.05)), (1, (0.1, 1.0, 0.3))):
        m = beacon if side < 0 else material("nav", color, emission=color, strength=10)
        part("primitive_uv_sphere_add", f"nav{side}", m, location=(0.95, side * 1.22, -0.06), scale=(0.08, 0.08, 0.08), segments=24, ring_count=12)
        if side > 0:
            nav_green = m
    # (the whole car turned towards the viewer: its nose and side both show; seen a little from below)
    bpy.ops.object.select_all(action="SELECT")
    for o in bpy.context.selected_objects:
        o.select_set(o.type == "MESH")
    bpy.ops.object.join()
    car = bpy.context.active_object
    car.name = "hovercar"
    car.rotation_euler = (math.radians(-6), 0, math.radians(-28))
    return {"beacon": beacon, "nav": nav_green, "thrust": thrust}


def stage_car(scene):
    # The night: a dim purple sky for the reflections.
    world_color(scene, (0.03, 0.012, 0.05))
    light("key", "AREA", (-1.5, -3.0, 5.0), (math.radians(35), 0, math.radians(-20)), (0.62, 0.72, 1.0), 900, 4)
    light("rim", "AREA", (3.0, 4.0, 3.0), (math.radians(-60), 0, math.radians(150)), (1.0, 0.4, 0.82), 700, 3)
    light("city", "AREA", (0.0, -2.0, -4.0), (math.radians(160), 0, 0), (0.8, 0.3, 0.95), 300, 6)
    light("glow", "POINT", (0.2, 0.0, -0.9), (0, 0, 0), (1.0, 0.2, 0.75), 60)
    # A side view from a little below; the car fills the sprite (the margin is for its glow).
    return (0.0, -20.0, -3.5), (math.radians(90 + 10), 0, 0), 5.3


def frames_car(mats, frame):
    beacon, thrust = {"A": (12, 2.8), "B": (0.3, 1.1)}[frame]
    emit(mats["beacon"], beacon)
    emit(mats["nav"], beacon)
    emit(mats["thrust"], thrust)


# ---- the shuttle (ORBITAL) -----------------------------------------------------------------------------------------

def build_shuttle():
    """A spaceplane, nose towards +x (it crosses the window from left to right), up = +z."""
    hull = two_tone("hull", (0.8, 0.8, 0.78), (0.035, 0.035, 0.04), rough=0.55, mottle=0.22)
    dark = material("dark", (0.02, 0.02, 0.025), metallic=0.4, rough=0.35)
    glass = material("windows", (0.01, 0.012, 0.02), metallic=0.2, rough=0.05, coat=1.0)
    bell = material("bells", (0.12, 0.12, 0.13), metallic=0.9, rough=0.3)
    flame = material("engines", (0.6, 0.8, 1.0), emission=(0.55, 0.78, 1.0), strength=7)
    strobe = material("strobe", (1, 1, 1), emission=(1.0, 1.0, 1.0), strength=30)
    red = material("nav_red", (1, 0.05, 0.04), emission=(1.0, 0.06, 0.04), strength=12)
    green = material("nav_green", (0.1, 1, 0.3), emission=(0.1, 1.0, 0.3), strength=12)

    body = part("primitive_cylinder_add", "fuselage", hull, location=(-0.1, 0, 0), rotation=(0, math.pi / 2, 0),
                scale=(0.36, 0.42, 1.5), vertices=64)
    parts = [body]
    parts.append(part("primitive_uv_sphere_add", "nose", hull, location=(1.4, 0, -0.02), scale=(0.95, 0.42, 0.35), segments=64, ring_count=32))
    parts.append(part("primitive_uv_sphere_add", "cockpit", glass, location=(1.66, 0, 0.17), scale=(0.27, 0.27, 0.065), segments=48, ring_count=24))
    parts.append(part("primitive_cube_add", "bay", dark, location=(-0.1, 0, 0.355), scale=(1.15, 0.012, 0.004)))
    for side in (-1, 1):
        parts.append(slab(f"wing{side}", hull, [(0.75, 0), (-1.55, 0), (-1.5, side * 1.75), (-1.05, side * 1.75)], 0.07, z=-0.2, bevel=0.02))
        parts.append(part("primitive_uv_sphere_add", f"pod{side}", hull, location=(-1.25, side * 0.3, 0.3), scale=(0.45, 0.14, 0.13),
                          segments=32, ring_count=16))
        parts.append(part("primitive_cone_add", f"bell{side}", bell, location=(-1.78, side * 0.17, -0.04), rotation=(0, math.pi / 2, 0),
                          radius1=0.16, radius2=0.08, depth=0.32, vertices=32))
        parts.append(part("primitive_cylinder_add", f"flame{side}", flame, location=(-1.95, side * 0.17, -0.04), rotation=(0, math.pi / 2, 0),
                          scale=(0.13, 0.13, 0.01), vertices=32))
        parts.append(part("primitive_uv_sphere_add", f"nav{side}", red if side < 0 else green, location=(-1.28, side * 1.76, -0.2),
                          scale=(0.05, 0.05, 0.05), segments=16, ring_count=8))
    parts.append(part("primitive_cone_add", "bell0", bell, location=(-1.78, 0, 0.22), rotation=(0, math.pi / 2, 0),
                      radius1=0.16, radius2=0.08, depth=0.32, vertices=32))
    parts.append(part("primitive_cylinder_add", "flame0", flame, location=(-1.95, 0, 0.22), rotation=(0, math.pi / 2, 0),
                      scale=(0.13, 0.13, 0.01), vertices=32))
    parts.append(slab("fin", hull, [(-0.75, 0.3), (-1.6, 0.3), (-1.78, 1.28), (-1.45, 1.28)], 0.06, axis="y", bevel=0.015))
    parts.append(part("primitive_uv_sphere_add", "strobe", strobe, location=(-1.62, 0, 1.31), scale=(0.05, 0.05, 0.05), segments=16, ring_count=8))
    ship = join(parts, body)
    ship.name = "shuttle"
    # Faint exhaust plumes behind the engines (separate objects: their fade is along their own axis).
    for i, (y, z) in enumerate(((-0.17, -0.04), (0.17, -0.04), (0.0, 0.22))):
        bpy.ops.mesh.primitive_cone_add(vertices=32, radius1=0.02, radius2=0.12, depth=1.1, location=(0, 0, 0))
        b = bpy.context.active_object
        b.name = f"plume{i}"
        for v in b.data.vertices:
            v.co.z -= 0.55
        b.data.materials.append(beam_material(f"plume{i}", (0.55, 0.78, 1.0), 3.0, 1.1))
        b.location = (-1.95, y, z)
        b.rotation_euler = towards((-1.0, 0, 0))
        b.parent = ship
    # (turned a little towards the viewer, seen a little from above: its back and the near wing show)
    ship.rotation_euler = (math.radians(4), 0, math.radians(-16))
    return {"strobe": strobe, "flame": flame}


def stage_shuttle(scene):
    world_color(scene, (0.0015, 0.002, 0.004))
    # The sun from the upper right (as on the painting's moon and Earth), the Earth's blue light from below.
    sun = light("sun", "SUN", (0, 0, 0), towards((-0.6, 0.35, -0.7)), (1.0, 0.97, 0.92), 4.5)
    sun.data.angle = math.radians(0.6)
    light("earth", "AREA", (0.0, -1.0, -6.0), towards((0, 0, 1)), (0.35, 0.55, 1.0), 900, 12)
    light("rim", "AREA", (-4.0, 6.0, 2.0), towards((0.6, -0.9, -0.2)), (0.6, 0.75, 1.0), 120, 4)
    return None, (math.radians(90 - 17), 0, 0), None


def frames_shuttle(mats, frame):
    emit(mats["strobe"], 30 if frame == "A" else 0)


# ---- the submersible (ABYSS) ---------------------------------------------------------------------------------------

def build_sub():
    """A research submersible, white above and orange below, nose towards -x (it crosses from right to left), up = +z:
    its pressure sphere at the front, lit from inside, lamps on booms, thrusters at the stern, a folded arm."""
    hull = two_tone("hull", (0.86, 0.87, 0.84), (0.98, 0.28, 0.02), rough=0.45, split=(0.47, 0.53), mottle=0.1)
    white = material("white", (0.82, 0.83, 0.8), rough=0.5)
    dark = material("dark", (0.03, 0.035, 0.04), metallic=0.5, rough=0.4)
    metal = material("metal", (0.45, 0.47, 0.5), metallic=0.9, rough=0.35)
    port = material("port", (0.015, 0.03, 0.04), metallic=0.1, rough=0.03, coat=1.0, emission=(1.0, 0.62, 0.3), strength=0.9)
    lamp = material("lamp", (1, 1, 1), emission=(1.0, 0.95, 0.82), strength=40)
    beacon = material("beacon", (1, 0.5, 0.1), emission=(1.0, 0.45, 0.08), strength=20)

    center, radii = Vector((0.3, 0, 0.08)), Vector((1.75, 0.58, 0.55))
    body = part("primitive_uv_sphere_add", "hull", hull, location=center, scale=radii, segments=96, ring_count=48)
    parts = [body]

    def on_hull(direction, inset=0.0):
        """The point of the hull's surface in `direction` from its center, and the rotation facing out there."""
        u = Vector(direction).normalized()
        n = Vector((u.x / radii.x, u.y / radii.y, u.z / radii.z)).normalized()
        return center + Vector((radii.x * u.x, radii.y * u.y, radii.z * u.z)) - n * inset, n.to_track_quat("Z", "Y").to_euler()

    parts.append(part("primitive_cube_add", "sail", hull, location=(0.45, 0, 0.68), scale=(0.5, 0.18, 0.14), bevel=0.11))
    parts.append(part("primitive_cylinder_add", "mast", metal, location=(0.62, 0, 0.92), scale=(0.022, 0.022, 0.12), vertices=16))
    parts.append(part("primitive_uv_sphere_add", "beacon", beacon, location=(0.62, 0, 1.06), scale=(0.055, 0.055, 0.055), segments=16, ring_count=8))
    parts.append(part("primitive_cylinder_add", "antenna", metal, location=(0.3, 0, 0.95), scale=(0.01, 0.01, 0.2), vertices=8))
    # The pressure sphere's viewports in the nose, lit by the crew's lamps inside.
    for i, d in enumerate(((-0.92, -0.3, -0.25), (-0.8, -0.52, -0.3), (-0.93, 0.0, -0.36))):
        at, rot = on_hull(d, inset=0.015)
        r = 0.11 if i == 0 else 0.075
        parts.append(part("primitive_cylinder_add", f"viewport{i}", port, location=at, rotation=rot, scale=(r, r, 0.03), vertices=32))
        parts.append(part("primitive_torus_add", f"rim{i}", metal, location=at, rotation=rot,
                          major_radius=r + 0.012, minor_radius=0.022, major_segments=32, minor_segments=8))
    # The frame and skids below, the folded arm under the nose.
    parts.append(part("primitive_cube_add", "frame", dark, location=(0.25, 0, -0.52), scale=(1.1, 0.38, 0.035), bevel=0.02))
    parts.append(part("primitive_cylinder_add", "arm1", metal, location=(-1.05, -0.3, -0.5), rotation=(0, math.radians(70), 0),
                      scale=(0.03, 0.03, 0.26), vertices=12))
    parts.append(part("primitive_cylinder_add", "arm2", metal, location=(-1.27, -0.3, -0.64), rotation=(0, math.radians(-25), 0),
                      scale=(0.026, 0.026, 0.14), vertices=12))
    for side in (-1, 1):
        parts.append(part("primitive_cube_add", f"skid{side}", dark, location=(0.25, side * 0.36, -0.62), scale=(1.05, 0.025, 0.025)))
        # Shrouded thrusters at the stern's sides.
        parts.append(part("primitive_torus_add", f"duct{side}", white, location=(1.35, side * 0.72, 0.05), rotation=(0, math.pi / 2, 0),
                          major_radius=0.17, minor_radius=0.05, major_segments=32, minor_segments=10))
        parts.append(part("primitive_cylinder_add", f"hub{side}", dark, location=(1.35, side * 0.72, 0.05), rotation=(0, math.pi / 2, 0),
                          scale=(0.05, 0.05, 0.08), vertices=16))
        parts.append(part("primitive_cube_add", f"pylon{side}", metal, location=(1.2, side * 0.6, 0.05), scale=(0.08, 0.14, 0.03)))
        # Lamps on booms at the front.
        parts.append(part("primitive_cylinder_add", f"boom{side}", metal, location=(-1.2, side * 0.42, -0.42), rotation=(0, math.pi / 2, 0),
                          scale=(0.02, 0.02, 0.2), vertices=8))
        parts.append(part("primitive_cylinder_add", f"housing{side}", dark, location=(-1.42, side * 0.42, -0.42), rotation=(0, math.pi / 2, 0),
                          scale=(0.07, 0.07, 0.06), vertices=24))
        parts.append(part("primitive_cylinder_add", f"lamp{side}", lamp, location=(-1.485, side * 0.42, -0.42), rotation=(0, math.pi / 2, 0),
                          scale=(0.06, 0.06, 0.008), vertices=24))
    # The stern: a tail fin and the main propeller's shroud.
    parts.append(slab("finv", white, [(1.35, 0.3), (1.85, 0.3), (1.95, 0.72), (1.7, 0.72)], 0.04, axis="y"))
    parts.append(part("primitive_torus_add", "shroud", white, location=(1.92, 0, 0.08), rotation=(0, math.pi / 2, 0),
                      major_radius=0.25, minor_radius=0.05, major_segments=48, minor_segments=12))
    parts.append(part("primitive_cylinder_add", "prop", dark, location=(1.9, 0, 0.08), rotation=(0, math.pi / 2, 0),
                      scale=(0.06, 0.06, 0.14), vertices=16))
    sub = join(parts, body)
    sub.name = "sub"
    # The lamps' beams in the water: cones from the lamps, forward and a little down (separate objects: their fade is
    # along their own axis).
    for side in (-1, 1):
        bpy.ops.mesh.primitive_cone_add(vertices=48, radius1=0.7, radius2=0.05, depth=3.2, location=(0, 0, 0))
        b = bpy.context.active_object
        b.name = f"beam{side}"
        for v in b.data.vertices:
            v.co.z -= 1.6
        b.data.materials.append(beam_material(f"beam{side}", (1.0, 0.94, 0.78), 3.0, 3.2, peak=0.8))
        b.location = (-1.49, side * 0.42, -0.42)
        b.rotation_euler = towards((-1.0, side * 0.08, -0.2))
        b.parent = sub
    sub.rotation_euler = (0, math.radians(2), math.radians(16))
    return {"beacon": beacon}


def stage_sub(scene):
    world_color(scene, (0.01, 0.04, 0.05))
    # Light from the surface far above, teal; a dim fill from the dome's lamps in front.
    light("surface", "AREA", (0.5, 0.0, 6.0), (0, 0, 0), (0.45, 0.8, 0.85), 1100, 8)
    light("dome", "AREA", (0.0, -6.0, -1.0), towards((0, 1, 0.15)), (0.9, 0.8, 0.6), 220, 6)
    return None, (math.radians(90 - 4), 0, 0), None


def frames_sub(mats, frame):
    emit(mats["beacon"], 20 if frame == "A" else 0)


def sea(pixels):
    """The deep sea between the dome and the submersible: its colors pulled towards the water's and darkened a little."""
    rgb, a = pixels[..., :3], pixels[..., 3:4]
    water = np.array([0.03, 0.2, 0.24])
    straight = np.where(a > 1e-4, rgb / np.maximum(a, 1e-4), 0)
    straight = straight * 0.88 * (1 - 0.2) + water * 0.2
    pixels[..., :3] = straight * a
    return pixels


# ---- the shooting star (ICE CAVE) ----------------------------------------------------------------------------------

def draw_meteor(w, h, frame):
    """A shooting star in a w x h picture (premultiplied RGBA, rows top down): a white head and a tail tapering up and
    to the left, along the way it flies (native (115, 40): down and to the right, in the picture's square pixels)."""
    angle = math.atan2(40 * HD_Y, 115 * HD_X)
    d = np.array([math.cos(angle), math.sin(angle)])
    head = np.array([w * 0.72, h * 0.5]) + d * w * 0.08
    length = w * 0.62
    tail = head - d * length
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float64) + 0.5
    px, py = xx - tail[0], yy - tail[1]
    t = np.clip((px * d[0] + py * d[1]) / length, 0, 1)
    dist = np.hypot(px - t * d[0] * length, py - t * d[1] * length)
    k = h / 264
    width = (1.2 + 5.0 * t ** 1.5) * k
    tail_i = np.exp(-0.5 * (dist / width) ** 2) * t ** 2.2
    glow = np.exp(-0.5 * (np.hypot(xx - head[0], yy - head[1]) / (14 * k)) ** 2)
    core = np.exp(-0.5 * (np.hypot(xx - head[0], yy - head[1]) / (4.5 * k)) ** 2)
    bright = 1.0 if frame == "A" else 0.78
    a = np.clip((tail_i * 0.95 + glow * 0.55 + core) * bright, 0, 1)
    white, ice = np.array([1.0, 1.0, 1.0]), np.array([0.62, 0.84, 1.0])
    mix = np.clip(core + glow * 0.5, 0, 1)[..., None]
    rgb = ice * (1 - mix) + white * mix
    return np.concatenate([rgb * a[..., None], a[..., None]], -1)


# ---- rendering -----------------------------------------------------------------------------------------------------

PIECES = {
    # name: native sprite size, picture file prefix, build, stage, frame setup, post-processing
    "car": ((40, 14), "rooftop-car", build_car, stage_car, frames_car, None),
    "shuttle": ((40, 14), "orbital-shuttle", build_shuttle, stage_shuttle, frames_shuttle, None),
    "sub": ((64, 22), "abyss-sub", build_sub, stage_sub, frames_sub, sea),
    "meteor": ((32, 12), "ice-cave-meteor", None, None, None, None),
}


def emit(mat, strength):
    mat.node_tree.nodes["Principled BSDF"].inputs["Emission Strength"].default_value = strength


def world_color(scene, color):
    world = bpy.data.worlds.new("world")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (*color, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 1.0
    scene.world = world


def scene_setup(native, scale, samples):
    scene = bpy.context.scene
    if S:
        S.use_cycles(samples=samples, denoise=True)
    else:
        scene.render.engine = "CYCLES"
        scene.cycles.samples = samples
        scene.cycles.use_denoising = True
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.cycles.seed = 0
    w, h = (native[0] + 2 * PAD) * HD_X * scale, (native[1] + 2 * PAD) * HD_Y * scale
    scene.render.resolution_x, scene.render.resolution_y = w, h
    scene.render.resolution_percentage = 100
    return scene, w, h


def camera(scene, location, rotation, width, native, scale, w):
    """An orthographic camera; `width` scene units span the sprite's width less two native pixels. Without a location
    and width: framed on the piece (its meshes' bounds centered, filling the sprite less a native pixel each side)."""
    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    if location is None:
        rot = Euler(rotation).to_matrix()
        right, up, forward = rot @ Vector((1, 0, 0)), rot @ Vector((0, 1, 0)), rot @ Vector((0, 0, -1))
        bpy.context.view_layer.update()
        us, vs = [], []
        for o in scene.objects:
            if o.type == "MESH":
                for corner in o.bound_box:
                    p = o.matrix_world @ Vector(corner)
                    us.append(p.dot(right))
                    vs.append(p.dot(up))
        cu, cv = (min(us) + max(us)) / 2, (min(vs) + max(vs)) / 2
        location = right * cu + up * cv - forward * 20
        # (the width that fits both the bounds' width and, at the pictures' square pixels, their height)
        width = max(max(us) - min(us), (max(vs) - min(vs)) * (native[0] - 2) * HD_X / ((native[1] - 2) * HD_Y))
    cam_data.ortho_scale = width * w / ((native[0] - 2) * HD_X * scale)
    cam = bpy.data.objects.new("cam", cam_data)
    cam.location = location
    cam.rotation_euler = rotation
    scene.collection.objects.link(cam)
    scene.camera = cam


def save_pixels(path, pixels):
    """Writes premultiplied RGBA (rows top down) as a straight-alpha PNG."""
    h, w = pixels.shape[:2]
    a = pixels[..., 3:4]
    straight = np.concatenate([np.where(a > 1e-4, pixels[..., :3] / np.maximum(a, 1e-4), 0), a], -1)
    img = bpy.data.images.new(os.path.basename(path), w, h, alpha=True)
    img.pixels.foreach_set(np.clip(straight[::-1], 0, 1).astype(np.float32).ravel())
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    bpy.data.images.remove(img)


def load_pixels(path):
    """A PNG as premultiplied RGBA (rows top down)."""
    img = bpy.data.images.load(path)
    w, h = img.size
    px = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    px = px.reshape(h, w, 4)[::-1].astype(np.float64)
    px[..., :3] *= px[..., 3:4]
    return px


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("piece", choices=sorted(PIECES))
    p.add_argument("--out", default=os.path.join(ROOT, "src", "gen", "scene", "scenery"))
    p.add_argument("--samples", type=int, default=96)
    p.add_argument("--scale", type=int, default=2)
    a = p.parse_args(argv)
    native, prefix, build, stage, frames, post = PIECES[a.piece]
    os.makedirs(a.out, exist_ok=True)
    w, h = (native[0] + 2 * PAD) * HD_X * a.scale, (native[1] + 2 * PAD) * HD_Y * a.scale
    if build is None:
        for frame in ("A", "B"):
            path = os.path.join(a.out, f"{prefix}-{frame}.png")
            save_pixels(path, draw_meteor(w, h, frame))
            print(f"{path}: {w} x {h}")
        return
    bpy.ops.wm.read_factory_settings(use_empty=True)
    mats = build()
    scene, w, h = scene_setup(native, a.scale, a.samples)
    location, rotation, width = stage(scene)
    camera(scene, location, rotation, width, native, a.scale, w)
    for frame in ("A", "B"):
        frames(mats, frame)
        path = os.path.join(a.out, f"{prefix}-{frame}.png")
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        if post:
            save_pixels(path, post(load_pixels(path)))
        print(f"{path}: {w} x {h}")


main()
