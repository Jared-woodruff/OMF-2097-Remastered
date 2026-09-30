"""HD pictures of a generated robot's sprites, rendered in Blender from its glTF export (npm run blender:export).

Every pose of the export (one keyframe per sprite) is rendered with an orthographic camera looking down the game's
view axis, framed on its sprite's rectangle plus a margin, at the HD artwork's scale (5 x 6 pixels per native pixel,
times --scale), so each picture lies exactly over its sprite like the HD packs' paintings. The lights come from where
the game's renderer has them (a key from the upper left front, a weak fill from the right), plus a rim light and a
studio for the metal to reflect. A second pass renders the color zones as flat emission: the zone mask, R = secondary
(red zone), G = tertiary (gold), B = primary (blue), alpha = coverage; effect colors (not recolored) have alpha only.

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

# The game's lights (src/gen/raster.ts LIGHT_KEY, LIGHT_FILL; the rim is gen/hdRender.ts' "back" reflection), toward the
# light in the game's axes: x forward, y up, z toward the viewer.
LIGHT_KEY = (-0.45, 0.65, 0.62)
LIGHT_FILL = (0.75, 0.1, 0.65)
LIGHT_RIM = (0.85, 0.35, -0.4)
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
    """Imports the export into an empty scene; returns the armature and the mesh objects."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    # (no bone shapes: an icosphere the importer adds for showing bones, in a hidden collection)
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(path), disable_bone_shape=True)
    arm = next(ob for ob in bpy.context.scene.objects if ob.type == "ARMATURE")
    meshes = [ob for ob in bpy.context.scene.objects if ob.type == "MESH"]
    return arm, meshes


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


def finish_materials(meshes, bevel, grime=0.18, saturation=1.2):
    """The look on top of the export's materials, all of it fixed to the parts, so it is the same in every frame:
    edges rounded at render time (catching highlights like machined metal) and a little lighter (worn paint),
    occlusion darkening the gaps between parts, and grime from a noise pattern in the rest pose's coordinates
    (Generated: they move with the parts, the pattern does not swim). Colors a little more saturated."""
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
                # Paint reflects less than bare metal: plates facing up, seen at a grazing angle from the side, would
                # mirror the bright studio above as white.
                socket(bsdf, "Specular IOR Level", "Specular").default_value = 0.2
                bsdf.inputs["Coat Weight"].default_value = min(bsdf.inputs["Coat Weight"].default_value, 0.15)
            omf = mat.get("omf")
            base_in = bsdf.inputs["Base Color"]
            if (omf is not None and omf.get("glow")) or base_in.is_linked:
                continue
            base = new("ShaderNodeRGB")
            # (a little more saturated: white highlights and reflections of the grey studio take some away)
            base.outputs[0].default_value = saturated(tuple(base_in.default_value), saturation)
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
            ao.inputs["Distance"].default_value = bevel * 7
            occ = new("ShaderNodeMapRange")
            occ.inputs["To Min"].default_value = 0.3
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


def studio_world(strength=0.5, reflected=1.0):
    """A studio for the metal to reflect (like gen/hdRender.ts envLight): bright above, a dark band at the horizon,
    a dim floor. Reflections see it at `reflected`, diffuse light at `strength` (bright chrome, deep shadows)."""
    scene = bpy.context.scene
    world = bpy.data.worlds.new("Studio")
    scene.world = world
    if not getattr(world, "use_nodes", True):
        world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()
    coord = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    height = nt.nodes.new("ShaderNodeMath")
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.name = "Background"
    out = nt.nodes.new("ShaderNodeOutputWorld")
    nt.links.new(coord.outputs["Generated"], sep.inputs[0])
    # The direction's height (-1 straight down .. 1 up) to 0..1: the horizon at 0.5.
    height.operation = "MULTIPLY_ADD"
    height.inputs[1].default_value = 0.5
    height.inputs[2].default_value = 0.5
    nt.links.new(sep.outputs["Z"], height.inputs[0])
    nt.links.new(height.outputs["Value"], ramp.inputs["Fac"])
    cr = ramp.color_ramp
    cr.elements[0].position, cr.elements[0].color = 0.0, (0.05, 0.05, 0.06, 1)
    cr.elements[1].position, cr.elements[1].color = 1.0, (1.0, 1.0, 1.0, 1)
    for pos, c in ((0.45, (0.04, 0.04, 0.05, 1)), (0.52, (0.012, 0.012, 0.016, 1)), (0.62, (0.55, 0.57, 0.62, 1)), (0.8, (0.95, 0.95, 1.0, 1))):
        e = cr.elements.new(pos)
        e.color = c
    nt.links.new(ramp.outputs["Color"], bg.inputs["Color"])
    bg.inputs["Strength"].default_value = strength
    shiny = nt.nodes.new("ShaderNodeBackground")
    nt.links.new(ramp.outputs["Color"], shiny.inputs["Color"])
    shiny.inputs["Strength"].default_value = reflected
    path = nt.nodes.new("ShaderNodeLightPath")
    mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(path.outputs["Is Glossy Ray"], mix.inputs["Fac"])
    nt.links.new(bg.outputs["Background"], mix.inputs[1])
    nt.links.new(shiny.outputs["Background"], mix.inputs[2])
    nt.links.new(mix.outputs["Shader"], out.inputs["Surface"])
    return world


def light_like_the_game(key=3.2, fill=0.3, rim=2.0, env=0.2, reflected=1.4):
    # The key lights the surfaces; its reflection is a wider, weaker light of its own, so flat plates turned toward it
    # show a soft highlight instead of flashing white.
    sun("Key", LIGHT_KEY, key, 14, glossy=False)
    sun("Key highlight", LIGHT_KEY, key * 0.3, 45, shadows=False, diffuse=False)
    sun("Fill", LIGHT_FILL, fill, 20, shadows=False)
    # (the rim lights edges; mirrored in flat plates it would flash them white)
    sun("Rim", LIGHT_RIM, rim, 6, shadows=False, glossy=False)
    studio_world(env, reflected)


def sprite_camera(info, rect, pad, scale):
    """An orthographic camera on a sprite's rectangle (native pixels from the robot's floor position) plus `pad`
    pixels around it; returns the picture's size (HD pixels)."""
    scene = bpy.context.scene
    cam = scene.camera
    if cam is None:
        cam = bpy.data.objects.new("Camera", bpy.data.cameras.new("Camera"))
        scene.collection.objects.link(cam)
        scene.camera = cam
    x, y, w, h = rect
    mpu, row = info["metersPerUnit"], info["rowHeight"]
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
    p.add_argument("--light", default="3.2,0.3,2,0.2,1.4", help="strengths: key, fill and rim suns, the studio (diffuse, reflected)")
    p.add_argument("--grime", type=float, default=0.18, help="how much the grime darkens (0: none)")
    p.add_argument("--saturation", type=float, default=1.2, help="the materials' saturation, times this")
    p.add_argument("--exposure", type=float, default=0.5)
    p.add_argument("--view", default="Standard", help="view transform (Standard keeps the palette's colors; 'Khronos PBR Neutral' also softens highlights)")
    p.add_argument("--no-masks", action="store_true")
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
    finish_materials(meshes, a.bevel * info["metersPerUnit"], a.grime, a.saturation)
    light_like_the_game(*(float(v) for v in a.light.split(",")))
    scene = bpy.context.scene
    scene.view_settings.view_transform = a.view
    scene.view_settings.exposure = a.exposure

    def out_path(f, mask):
        if names:
            rel = names[f["name"]]
            return os.path.join(a.out, rel[:-len(".hd.png")] + ".mask.png" if mask else rel)
        return os.path.join(a.out, f"{f['name']}.mask.png" if mask else f"{f['name']}.png")

    t1 = time.time()
    for f in frames:
        scene.frame_set(f["frame"])
        sprite_camera(info, f["rect"], pad, a.scale)
        render_to(out_path(f, False))
    t2 = time.time()
    if a.save_blend and frames:
        scene.frame_set(frames[0]["frame"])
        sprite_camera(info, frames[0]["rect"], pad, a.scale)
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(a.save_blend))
    if not a.no_masks:
        apply_zone_masks(meshes)
        mask_settings(scene)
        for f in frames:
            scene.frame_set(f["frame"])
            sprite_camera(info, f["rect"], pad, a.scale)
            render_to(out_path(f, True))
    t3 = time.time()
    print("RENDER_FRAMES " + json.dumps({
        "robot": info["robot"], "frames": len(frames), "device": device, "scale": a.scale,
        "seconds": {"setup": round(t1 - t0, 1), "beauty": round(t2 - t1, 1), "masks": round(t3 - t2, 1)},
        "out": os.path.abspath(a.out),
    }))


if __name__ == "__main__":
    main()
