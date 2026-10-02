"""HD pictures of a generated robot's sprites, rendered in Blender from its glTF export (npm run blender:export).

Every sprite of the export (one keyframe each: the objects it shows in their places, the others scaled to nothing and
left out of the render) is rendered with an orthographic camera looking down the game's view axis, framed on the
sprite's rectangle plus a margin, at the HD artwork's scale (5 x 6 pixels per sprite pixel, times --scale), so each
picture lies exactly over its sprite like the HD packs' paintings. The menu pictures' sprites are magnified views: their
pixels cover less of the world (the frame's `unit`). The key light comes from the upper left like the game's, more
from the side (like the paintings' light), with a weak fill from the right, a rim from behind and a studio of
softboxes for the metal and the glossy paint to reflect; detail.py lays the surface detail on every part. A second
pass renders the color zones as flat emission: the zone mask, R = secondary (red zone), G = tertiary (gold), B =
primary (blue), alpha = coverage; effect colors (not recolored) have alpha only. grade.py then gives the pictures
the paintings' tones and colors (npm run blender:render runs both). frames.json in the output folder says which
frame each picture is.

    blender -b --factory-startup -P tools/blender/render_frames.py -- --glb <out>/helix.glb --out <folder>
        [--frames m11s0,m10s2] [--moves 11,10] [--scale 1] [--samples 128] [--no-masks] [--pack newart-pack]

With --pack, the pictures take the names of the pack's jobs for the robot (tier2_fighters/<ROBOT>/mNN_<move>/fNNN.hd.png,
the mask next to it as fNNN.mask.png), for the checks of the HD packs (tools/blender/score.py runs them).
Uses the render kit's studio helpers when they are there (RENDER_KIT, default ~/.claude/skills/render-kit/scripts/blender).
Prints RENDER_FRAMES {json} at the end.
"""
import argparse
import colorsys
import json
import math
import os
import struct
import sys
import time

import bpy
from mathutils import Vector

KIT = os.environ.get("RENDER_KIT", os.path.join(os.path.expanduser("~"), ".claude", "skills", "render-kit", "scripts", "blender"))
if os.path.isdir(KIT) and KIT not in sys.path:
    sys.path.insert(0, KIT)
try:
    import studio as S  # noqa: E402
except ImportError:
    S = None
HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import detail  # noqa: E402

# The game's lights (src/gen/raster.ts LIGHT_KEY, LIGHT_FILL; the rim is gen/hdRender.ts' "back" reflection), toward the
# light in the game's axes: x forward, y up, z toward the viewer.
LIGHT_KEY = (-0.45, 0.65, 0.62)
LIGHT_FILL = (0.75, 0.1, 0.65)
LIGHT_RIM = (0.85, 0.35, -0.4)
# The HD pictures' key: from the same side, but more from the side than the game's, like the paintings' light: the
# faces turned to the viewer stay a deep shade, the sides and tops facing the light catch it.
LIGHT_KEY_HD = (-0.75, 0.6, 0.4)
# The zone mask's colors.
ZONE_COLORS = {"secondary": (1, 0, 0), "tertiary": (0, 1, 0), "primary": (0, 0, 1), "effect": (0, 0, 0)}


def game_to_blender(v):
    """Game axes (glTF's) to Blender's: x stays, the viewer's +z becomes -Y, up becomes +Z."""
    return Vector((v[0], -v[2], v[1]))


def read_glb_json(path):
    with open(path, "rb") as f:
        magic, version, _ = struct.unpack("<III", f.read(12))
        if magic != 0x46546C67 or version != 2:
            raise ValueError(f"{path} is not a glTF 2.0 binary")
        length, _ = struct.unpack("<II", f.read(8))
        return json.loads(f.read(length).decode("utf-8"))


def export_info(path):
    """The export's information (robot, units, frames: the scene extras of tools/blender/robotGltf.ts)."""
    doc = read_glb_json(path)
    return doc["scenes"][doc.get("scene", 0)]["extras"]["omf"]


def import_robot(path):
    """Imports the export into an empty scene; returns the armature (the skinned export's) and the mesh objects."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    # (no bone shapes: an icosphere the importer adds for showing bones, in a hidden collection)
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(path), disable_bone_shape=True)
    arm = next((ob for ob in bpy.context.scene.objects if ob.type == "ARMATURE"), None)
    meshes = [ob for ob in bpy.context.scene.objects if ob.type == "MESH"]
    return arm, meshes


def show_frame(scene, frame, meshes, followers=()):
    """Poses the scene at a sprite's keyframe; objects scaled to nothing (not in this sprite) or replaced by detail.py's
    geometry are left out, and the replacements follow their parts."""
    scene.frame_set(frame)
    for ob in meshes:
        ob.hide_render = bool(ob.get("omf_hidden")) or ob.matrix_world.to_scale().length < 1e-6
    detail.follow(followers)


def material_zone(mat):
    """A material's color zone: its glTF extras (omf.zone), else the start of its name."""
    omf = mat.get("omf") if mat else None
    if omf is not None and "zone" in omf:
        return str(omf["zone"])
    name = (mat.name if mat else "").split("_")[0].split(".")[0]
    return name if name in ZONE_COLORS else "effect"


def principled(mat):
    return next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None) if mat and mat.node_tree else None


def socket(node, *names, output=False):
    """A node's socket by name (the first of the names it has: some were renamed between Blender versions)."""
    sockets = node.outputs if output else node.inputs
    return next(s for name in names for s in sockets if s.name == name)


def saturated(rgba, k):
    """A linear color with its saturation scaled by k (its brightness kept)."""
    h, s_, v = colorsys.rgb_to_hsv(*rgba[:3])
    return (*colorsys.hsv_to_rgb(h, min(1.0, s_ * k), v), rgba[3])


def finish_materials(meshes, bevel, grime=0.18, saturation=1.2, coat=0.0, metal=(1.1, 0.92)):
    """The look on top of the export's materials, all of it fixed to the parts, so it is the same in every frame:
    edges rounded at render time (catching highlights like machined metal) and a little lighter (worn paint),
    occlusion darkening the gaps between parts, and grime from a noise pattern in the rest pose's coordinates
    (Generated: they move with the parts, the pattern does not swim). Colors a little more saturated; the paint
    under a clear coat (`coat`), bare metal's color at `metal` (saturation, brightness) times its own."""
    done = set()
    for ob in meshes:
        for mat in ob.data.materials:
            if not mat or mat.name in done:
                continue
            done.add(mat.name)
            bsdf = principled(mat)
            if not bsdf:
                continue
            nt = mat.node_tree
            new, link = nt.nodes.new, nt.links.new
            bev = new("ShaderNodeBevel")
            bev.samples = 8
            bev.inputs["Radius"].default_value = bevel
            link(bev.outputs["Normal"], bsdf.inputs["Normal"])
            if "Coat Normal" in bsdf.inputs:
                link(bev.outputs["Normal"], bsdf.inputs["Coat Normal"])
            if material_zone(mat) == "primary":
                # Glossy paint: the softboxes show on its rounded edges and on faces turned toward them. Not on faces
                # seen edge-on: their mirror-like grazing reflections would grey whole side panels (paintings keep
                # them a deep, saturated shade).
                facing = new("ShaderNodeLayerWeight")
                link(bev.outputs["Normal"], facing.inputs["Normal"])
                gloss = new("ShaderNodeMapRange")
                gloss.interpolation_type = "SMOOTHSTEP"
                gloss.inputs["From Min"].default_value, gloss.inputs["From Max"].default_value = 0.5, 0.8
                gloss.inputs["To Min"].default_value, gloss.inputs["To Max"].default_value = 1.0, 0.0
                link(socket(facing, "Facing", output=True), gloss.inputs["Value"])
                for name, value in (("Specular IOR Level", 0.8), ("Coat Weight", coat)):
                    k = new("ShaderNodeMath")
                    k.operation = "MULTIPLY"
                    k.inputs[1].default_value = value
                    link(socket(gloss, "Result", output=True), k.inputs[0])
                    link(k.outputs[0], socket(bsdf, name))
                bsdf.inputs["Coat Roughness"].default_value = 0.14
                # (its reflections in its own color: grey ones would wash out the dark shades)
                c = tuple(bsdf.inputs["Base Color"].default_value)[:3]
                top = max(max(c), 1e-6)
                bsdf.inputs["Specular Tint"].default_value = (*(v / top for v in c), 1)
            elif material_zone(mat) == "secondary":
                # (lacquered: white highlights on the deep red, where bare red metal only reflects red)
                bsdf.inputs["Coat Weight"].default_value = 0.6
                bsdf.inputs["Coat Roughness"].default_value = 0.08
            omf = mat.get("omf")
            base_in = bsdf.inputs["Base Color"]
            if omf is not None and omf.get("glow") and material_zone(mat) != "effect":
                # (the robot's own lights, eyes and lenses: their color, not a white blur, and only their own light: lit
                # by the key they would show its shading instead; effects' flashes stay bright)
                bsdf.inputs["Emission Strength"].default_value = 1.1
                if not base_in.is_linked:
                    base_in.default_value = (0.02, 0.02, 0.02, 1)
            if (omf is not None and omf.get("glow")) or base_in.is_linked:
                continue
            base = new("ShaderNodeRGB")
            # (a little more saturated: white highlights and reflections of the grey studio take some away)
            # (metal: its look comes from what it reflects)
            bare = material_zone(mat) in ("tertiary", "secondary")
            rgba = saturated(tuple(base_in.default_value), metal[0] if bare else saturation)
            base.outputs[0].default_value = tuple(min(1.0, c * metal[1]) for c in rgba[:3]) + (1,) if bare else rgba
            # Worn edges: where the rounded normal leaves the face's own.
            geo = new("ShaderNodeNewGeometry")
            dot = new("ShaderNodeVectorMath")
            dot.operation = "DOT_PRODUCT"
            link(bev.outputs["Normal"], dot.inputs[0])
            link(socket(geo, "Normal", output=True), dot.inputs[1])
            edge = new("ShaderNodeMapRange")
            edge.inputs["From Min"].default_value, edge.inputs["From Max"].default_value = 1.0, 0.97
            link(socket(dot, "Value", output=True), edge.inputs["Value"])
            # The gaps between parts.
            ao = new("ShaderNodeAmbientOcclusion")
            ao.samples = 12
            ao.inputs["Distance"].default_value = bevel * 25
            occ = new("ShaderNodeMapRange")
            occ.inputs["To Min"].default_value = 0.12
            link(socket(ao, "AO", output=True), occ.inputs["Value"])
            # Grime in the rest pose's coordinates.
            coord = new("ShaderNodeTexCoord")
            noise = new("ShaderNodeTexNoise")
            noise.inputs["Scale"].default_value = 70.0
            noise.inputs["Detail"].default_value = 8.0
            link(coord.outputs["Generated"], noise.inputs["Vector"])
            dirt = new("ShaderNodeMapRange")
            dirt.inputs["From Min"].default_value, dirt.inputs["From Max"].default_value = 0.45, 0.75
            dirt.inputs["To Min"].default_value, dirt.inputs["To Max"].default_value = 1.0, 1.0 - grime
            link(socket(noise, "Factor", "Fac", output=True), dirt.inputs["Value"])
            shade = new("ShaderNodeMath")
            shade.operation = "MULTIPLY"
            link(socket(occ, "Result", output=True), shade.inputs[0])
            link(socket(dirt, "Result", output=True), shade.inputs[1])
            dark = new("ShaderNodeVectorMath")
            dark.operation = "SCALE"
            link(base.outputs[0], dark.inputs[0])
            link(shade.outputs[0], socket(dark, "Scale"))
            lift = new("ShaderNodeVectorMath")
            lift.operation = "SCALE"
            link(base.outputs[0], lift.inputs[0])
            link(socket(edge, "Result", output=True), socket(lift, "Scale"))
            total = new("ShaderNodeVectorMath")
            total.operation = "MULTIPLY_ADD"
            link(socket(lift, "Vector", output=True), total.inputs[0])
            total.inputs[1].default_value = (0.35, 0.35, 0.35)
            link(socket(dark, "Vector", output=True), total.inputs[2])
            link(socket(total, "Vector", output=True), base_in)
            rough = bsdf.inputs["Roughness"]
            if not rough.is_linked:
                # (grimy spots a little rougher)
                r = new("ShaderNodeMath")
                r.operation = "MULTIPLY_ADD"
                r.inputs[1].default_value = -0.6
                r.inputs[2].default_value = rough.default_value + 0.6
                link(socket(dirt, "Result", output=True), r.inputs[0])
                link(r.outputs[0], rough)


def zone_materials():
    """Flat emission materials, one per zone (the mask pass)."""
    out = {}
    for zone, color in ZONE_COLORS.items():
        m = bpy.data.materials.new(f"mask_{zone}")
        if not getattr(m, "use_nodes", True):
            m.use_nodes = True
        nt = m.node_tree
        nt.nodes.clear()
        em = nt.nodes.new("ShaderNodeEmission")
        em.inputs["Color"].default_value = (*color, 1)
        em.inputs["Strength"].default_value = 1.0
        outn = nt.nodes.new("ShaderNodeOutputMaterial")
        nt.links.new(em.outputs["Emission"], outn.inputs["Surface"])
        out[zone] = m
    return out


def apply_zone_masks(objects):
    """Swaps every material of the objects for its zone's flat emission; returns how to swap them back."""
    masks = zone_materials()
    undo = []
    for ob in objects:
        for i, slot in enumerate(ob.material_slots):
            undo.append((ob, i, slot.material))
            slot.material = masks[material_zone(slot.material)]
    return lambda: [setattr(ob.material_slots[i], "material", m) for ob, i, m in undo]


def mask_settings(scene):
    """Render settings for the zone mask: linear output (coverage adds up), no denoising, no lights needed."""
    # (the color configuration's view transforms are not all listed by the property: try it)
    try:
        scene.view_settings.view_transform = "Raw"
    except TypeError:
        scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = 0
    scene.cycles.use_denoising = False
    if scene.world:
        for n in scene.world.node_tree.nodes:
            if n.type == "BACKGROUND":
                n.inputs["Strength"].default_value = 0.0


def sun(name, direction, strength, angle_deg, shadows=True, diffuse=True, glossy=True):
    ld = bpy.data.lights.new(name, "SUN")
    ld.energy = strength
    ld.angle = math.radians(angle_deg)
    ld.use_shadow = shadows
    ob = bpy.data.objects.new(name, ld)
    bpy.context.scene.collection.objects.link(ob)
    ob.rotation_euler = game_to_blender(direction).normalized().to_track_quat("Z", "Y").to_euler()
    ob.visible_diffuse, ob.visible_glossy = diffuse, glossy
    return ob


# The studio's softboxes, what shiny surfaces reflect: (toward it in the game's axes, angular radius and soft edge in
# degrees, brightness). A big one where the key light is, a soft one on the viewer's side for faces turned toward the
# camera, a strip above and strips behind on either side for the edges; dark between them, so metal shows contrast.
SOFTBOXES = (
    (LIGHT_KEY_HD, 26, 14, 1.4),
    ((0.15, 0.35, 1.0), 34, 26, 0.22),
    ((0.0, 1.0, 0.05), 16, 10, 0.75),
    (LIGHT_RIM, 11, 6, 1.1),
    ((-0.85, 0.25, -0.45), 9, 6, 0.45),
)


def studio_world(strength=0.5, reflected=1.0, softboxes=SOFTBOXES):
    """A photo studio (like gen/hdRender.ts envLight, with softboxes): a dark room, a dim floor, bright softboxes.
    Reflections see it at `reflected`, diffuse light at `strength` (bright chrome, deep shadows)."""
    scene = bpy.context.scene
    world = bpy.data.worlds.new("Studio")
    scene.world = world
    if not getattr(world, "use_nodes", True):
        world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()
    coord = nt.nodes.new("ShaderNodeTexCoord")
    direction = nt.nodes.new("ShaderNodeVectorMath")
    direction.operation = "NORMALIZE"
    nt.links.new(coord.outputs["Generated"], direction.inputs[0])
    # The room: a little light from the floor (below the horizon), darker above.
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(direction.outputs["Vector"], sep.inputs[0])
    room = nt.nodes.new("ShaderNodeMapRange")
    room.interpolation_type = "SMOOTHSTEP"
    room.inputs["From Min"].default_value, room.inputs["From Max"].default_value = -0.25, 0.05
    room.inputs["To Min"].default_value, room.inputs["To Max"].default_value = 0.035, 0.008
    nt.links.new(sep.outputs["Z"], room.inputs["Value"])
    total = room.outputs["Result"]
    for toward, radius, soft, bright in softboxes:
        d = game_to_blender(toward).normalized()
        dot = nt.nodes.new("ShaderNodeVectorMath")
        dot.operation = "DOT_PRODUCT"
        nt.links.new(direction.outputs["Vector"], dot.inputs[0])
        dot.inputs[1].default_value = tuple(d)
        box = nt.nodes.new("ShaderNodeMapRange")
        box.interpolation_type = "SMOOTHSTEP"
        box.inputs["From Min"].default_value = math.cos(math.radians(radius + soft))
        box.inputs["From Max"].default_value = math.cos(math.radians(radius))
        box.inputs["To Min"].default_value, box.inputs["To Max"].default_value = 0.0, bright
        nt.links.new(socket(dot, "Value", output=True), box.inputs["Value"])
        add = nt.nodes.new("ShaderNodeMath")
        add.operation = "ADD"
        nt.links.new(total, add.inputs[0])
        nt.links.new(box.outputs["Result"], add.inputs[1])
        total = add.outputs["Value"]
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.name = "Background"
    out = nt.nodes.new("ShaderNodeOutputWorld")
    nt.links.new(total, bg.inputs["Color"])
    bg.inputs["Strength"].default_value = strength
    shiny = nt.nodes.new("ShaderNodeBackground")
    nt.links.new(total, shiny.inputs["Color"])
    shiny.inputs["Strength"].default_value = reflected
    path = nt.nodes.new("ShaderNodeLightPath")
    mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(path.outputs["Is Glossy Ray"], mix.inputs["Fac"])
    nt.links.new(bg.outputs["Background"], mix.inputs[1])
    nt.links.new(shiny.outputs["Background"], mix.inputs[2])
    nt.links.new(mix.outputs["Shader"], out.inputs["Surface"])
    return world


def light_like_the_game(key=5.5, fill=0.15, rim=2.5, env=0.08, reflected=2.4, key_dir=LIGHT_KEY_HD):
    # The suns light the surfaces (and cast the shadows); what shiny surfaces reflect is the studio's softboxes, the
    # key's among them, so flat plates turned toward it show a soft highlight instead of flashing white.
    sun("Key", key_dir, key, 14, glossy=False)
    sun("Fill", LIGHT_FILL, fill, 20, shadows=False, glossy=False)
    sun("Rim", LIGHT_RIM, rim, 6, shadows=False, glossy=False)
    studio_world(env, reflected, tuple((key_dir if d is LIGHT_KEY_HD else d, *rest) for d, *rest in SOFTBOXES))


def sprite_camera(info, rect, pad, scale, unit=1.0):
    """An orthographic camera on a sprite's rectangle (its pixels from the robot's floor position; each `unit` world
    units wide) plus `pad` pixels around it; returns the picture's size (HD pixels)."""
    scene = bpy.context.scene
    cam = scene.camera
    if cam is None:
        cam = bpy.data.objects.new("Camera", bpy.data.cameras.new("Camera"))
        scene.collection.objects.link(cam)
        scene.camera = cam
    x, y, w, h = rect
    mpu, row = info["metersPerUnit"] * unit, info["rowHeight"]
    sx, sy = info["hd"]["sx"], info["hd"]["sy"]
    left, right = (x - pad) * mpu, (x + w + pad) * mpu
    top, bottom = -(y - pad) * row * mpu, -(y + h + pad) * row * mpu
    cd = cam.data
    cd.type = "ORTHO"
    cd.sensor_fit = "HORIZONTAL"
    cd.ortho_scale = right - left
    cd.clip_start, cd.clip_end = 0.01, 100.0
    cam.location = ((left + right) / 2, -10.0, (top + bottom) / 2)
    cam.rotation_euler = (math.radians(90), 0, 0)
    width, height = (w + 2 * pad) * sx * scale, (h + 2 * pad) * sy * scale
    scene.render.resolution_x, scene.render.resolution_y = width, height
    scene.render.resolution_percentage = 100
    scene.render.pixel_aspect_x = scene.render.pixel_aspect_y = 1
    return width, height


def setup_render(samples):
    scene = bpy.context.scene
    if S:
        device = S.use_cycles(samples=samples, denoise=True)
        S.color_management(view="Standard", look="None")
    else:
        scene.render.engine = "CYCLES"
        scene.cycles.samples = samples
        scene.cycles.use_denoising = True
        scene.view_settings.view_transform = "Standard"
        device = "CPU"
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    # The same noise pattern in every frame.
    scene.cycles.seed = 0
    scene.cycles.use_animated_seed = False
    return device


def render_to(path):
    scene = bpy.context.scene
    scene.render.filepath = os.path.abspath(path)
    os.makedirs(os.path.dirname(scene.render.filepath) or ".", exist_ok=True)
    bpy.ops.render.render(write_still=True)


def pack_outputs(pack, robot, frames):
    """Frame name -> the pack's job output path (relative), for the pack's jobs of the robot."""
    manifest = json.load(open(os.path.join(pack, "manifest.json"), encoding="utf-8"))
    names = {f["name"] for f in frames}
    out = {}
    for job in manifest["jobs"]:
        if not job["id"].startswith(f"fighter/{robot}/"):
            continue
        for u in job.get("usages", []):
            name = f"m{u['anim']}s{u['sprite']}"
            if name in names:
                out.setdefault(name, job["output"])
                break
    return out


def parse():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser(prog="render_frames.py", description=__doc__.split("\n\n")[0])
    p.add_argument("--glb", required=True)
    p.add_argument("--out", required=True, help="output folder")
    p.add_argument("--frames", help="frame names (m11s0,...); default all")
    p.add_argument("--moves", help="move ids (11,10,...); default all")
    p.add_argument("--scale", type=int, default=1, help="HD pictures at this multiple of 5 x 6 pixels per native pixel")
    p.add_argument("--pad", type=int, help="native pixels around the sprite (default: the export's, 4)")
    p.add_argument("--samples", type=int, default=128)
    p.add_argument("--bevel", type=float, default=0.3, help="rounded edges' radius at render time, world units")
    p.add_argument("--light", default="5.5,0.15,2.5,0.08,2.4", help="strengths: key, fill and rim suns, the studio (diffuse, reflected)")
    p.add_argument("--grime", type=float, default=0.18, help="how much the grime darkens (0: none)")
    p.add_argument("--saturation", type=float, default=1.2, help="the paint's saturation, times this")
    p.add_argument("--coat", type=float, default=0.0, help="the paint's clear coat (its reflections are white)")
    p.add_argument("--metal", default="1.1,0.92", help="bare metal's color: saturation, brightness (times the palette's)")
    p.add_argument("--key-dir", help="toward the key light, in the game's axes (default %s; the game's sprites: %s)" % (LIGHT_KEY_HD, LIGHT_KEY))
    p.add_argument("--exposure", type=float, default=0.45)
    p.add_argument("--view", default="Standard", help="view transform (Standard keeps the palette's colors; 'Khronos PBR Neutral' also softens highlights)")
    p.add_argument("--no-masks", action="store_true")
    p.add_argument("--no-detail", action="store_true", help="the parts as they are (no seams, rivets, grooves: detail.py)")
    p.add_argument("--pack", help="name the pictures after this HD pack's jobs (and only render those)")
    p.add_argument("--save-blend", help="also save the scene (posed at the first frame)")
    return p.parse_args(argv)


def main():
    a = parse()
    t0 = time.time()
    info = export_info(a.glb)
    frames = info["frames"]
    if a.frames:
        want = set(a.frames.split(","))
        frames = [f for f in frames if f["name"] in want]
    if a.moves:
        want = {int(m) for m in a.moves.split(",")}
        frames = [f for f in frames if f.get("move") in want]
    names = None
    if a.pack:
        names = pack_outputs(a.pack, info["robot"], frames)
        frames = [f for f in frames if f["name"] in names]
    pad = info.get("pad", 4) if a.pad is None else a.pad

    arm, meshes = import_robot(a.glb)
    device = setup_render(a.samples)
    finish_materials(meshes, a.bevel * info["metersPerUnit"], a.grime, a.saturation, a.coat,
                     tuple(float(v) for v in a.metal.split(",")))
    detailed, followers = (0, []) if a.no_detail else detail.detail_robot(meshes, info["robot"])
    light_like_the_game(*(float(v) for v in a.light.split(",")),
                        key_dir=tuple(float(v) for v in a.key_dir.split(",")) if a.key_dir else LIGHT_KEY_HD)
    scene = bpy.context.scene
    scene.view_settings.view_transform = a.view
    scene.view_settings.exposure = a.exposure

    def out_path(f, mask):
        if names:
            rel = names[f["name"]]
            return os.path.join(a.out, rel[:-len(".hd.png")] + ".mask.png" if mask else rel)
        return os.path.join(a.out, f"{f['name']}.mask.png" if mask else f"{f['name']}.png")

    # Which frame each picture is (grade.py cuts the menu pictures to their frames; the pack's names do not say).
    os.makedirs(a.out, exist_ok=True)
    index = os.path.join(a.out, "frames.json")
    known = json.load(open(index, encoding="utf-8")) if os.path.exists(index) else {}
    known.update({os.path.relpath(out_path(f, False), a.out).replace(os.sep, "/"): f["name"] for f in frames})
    with open(index, "w", encoding="utf-8") as fh:
        json.dump(known, fh, indent=0, sort_keys=True)

    t1 = time.time()
    for f in frames:
        show_frame(scene, f["frame"], meshes, followers)
        sprite_camera(info, f["rect"], pad, a.scale, f.get("unit", 1.0))
        render_to(out_path(f, False))
    t2 = time.time()
    if a.save_blend and frames:
        show_frame(scene, frames[0]["frame"], meshes, followers)
        sprite_camera(info, frames[0]["rect"], pad, a.scale, frames[0].get("unit", 1.0))
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(a.save_blend))
    if not a.no_masks:
        apply_zone_masks(meshes + [ob for ob, _, _ in followers])
        mask_settings(scene)
        for f in frames:
            show_frame(scene, f["frame"], meshes, followers)
            sprite_camera(info, f["rect"], pad, a.scale, f.get("unit", 1.0))
            render_to(out_path(f, True))
    t3 = time.time()
    print("RENDER_FRAMES " + json.dumps({
        "robot": info["robot"], "frames": len(frames), "device": device, "scale": a.scale, "detailed": detailed,
        "seconds": {"setup": round(t1 - t0, 1), "beauty": round(t2 - t1, 1), "masks": round(t3 - t2, 1)},
        "out": os.path.abspath(a.out),
    }))


if __name__ == "__main__":
    main()
