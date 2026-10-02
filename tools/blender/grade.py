"""Grades Blender renderings of a robot's sprites (render_frames.py): each color zone gets the paintings' tones and
colors, the same way in every frame.

The zone mask next to each picture (R = secondary, G = tertiary, B = primary) tells which pixels are which zone. With a
look (tools/blender/looks/<robot>.json, made by --calibrate from the robot's paintings), a zone's brightness
goes through a fixed tone curve that gives the renderings the paintings' distribution of shades (their deep shadows
and bright edges), and each shade takes the paintings' average color at that brightness (brass browner in the
shadows and paler in the highlights, red deep, blue toward indigo in the dark). Without one, the zone's shades take
the colors of its ramp (the export's `ramps`, the palette's shades: the way the sprites are colored). Either way the
mapping is one curve per zone for all of the robot's frames, so nothing flickers, and the colors stay those of the
zone (the game recolors every HD pixel through the sprite pixel whose color it matches: src/video/hd/artShaders.ts).
Effect colors (alpha only in the mask) keep the rendering's colors. The menu pictures are cut to their frame like their
sprites (the select cell and the VS picture show part of a magnified robot).

    python tools/blender/grade.py --glb <export.glb> --renders <folder> [--look <json>] [--ramp 0..1] [--out <folder>]
    python tools/blender/grade.py --glb <export.glb> --renders <folder> --calibrate <paintings.omfmod>

(a package with the paintings: `npm run extras -- --hd <painted bundles> --out <folder>`; the package in public/mods
holds the renderings themselves now)

Grades every picture that has a zone mask next to it (<name>.mask.png beside <name>.png, or beside <name>.hd.png in an
HD pack's layout), in place (keeping the rendering as <name>.raw.png, which later runs grade again) or into --out.
--calibrate compares the renderings (named like the export's frames, m11s0...) with the package's pictures of the same
sprites and writes the look. Needs Python 3 with numpy and Pillow.
"""
import argparse
import io
import json
import os
import re
import struct
import sys
import zipfile

import numpy as np
from PIL import Image

LUMA = np.array([0.299, 0.587, 0.114])
# The mask's channels.
ZONES = (("secondary", 0), ("tertiary", 1), ("primary", 2))
HERE = os.path.dirname(os.path.abspath(__file__))
# The tone curve's points (quantiles) and the color table's brightness steps.
QUANTILES = 64
BINS = 24


def export_info(path):
    with open(path, "rb") as f:
        magic, version, _ = struct.unpack("<III", f.read(12))
        if magic != 0x46546C67 or version != 2:
            raise ValueError(f"{path} is not a glTF 2.0 binary")
        length, _ = struct.unpack("<II", f.read(8))
        doc = json.loads(f.read(length).decode("utf-8"))
    return doc["scenes"][doc.get("scene", 0)]["extras"]["omf"]


class Ramp:
    """A zone's ramp as a function of brightness: its shades by luma (0..1), interpolated in sRGB, going on to white
    above the brightest and to black below the darkest."""

    def __init__(self, colors):
        shades = sorted((float(np.dot(np.array(c) / 255, LUMA)), tuple(np.array(c) / 255)) for c in colors)
        # (a shade no brighter than the one before it breaks the order: left out)
        kept = []
        for luma, c in shades:
            if not kept or luma > kept[-1][0] + 1e-4:
                kept.append((luma, c))
        self.l = np.array([0.0] + [k[0] for k in kept] + [1.0])
        self.c = np.array([(0.0, 0.0, 0.0)] + [k[1] for k in kept] + [(1.0, 1.0, 1.0)])

    def __call__(self, luma):
        return np.stack([np.interp(luma, self.l, self.c[:, k]) for k in range(3)], -1)


class Look:
    """A zone's look: the tone curve (renderings' brightness quantiles to the paintings') and the paintings' average
    color offset from grey (chroma) at each brightness."""

    def __init__(self, d):
        self.src, self.dst = np.array(d["tone"][0]), np.array(d["tone"][1])
        table = np.array(d["chroma"])
        self.l, self.c = table[:, 0], table[:, 1:]

    def tone(self, luma):
        return np.interp(luma, self.src, self.dst)

    def __call__(self, luma):
        chroma = np.stack([np.interp(luma, self.l, self.c[:, k]) for k in range(3)], -1)
        return np.clip(luma[..., None] + chroma, 0, 1)


def grade(beauty, mask, ramps, looks, mix):
    """The graded picture (RGBA uint8) of a rendering and its zone mask (RGBA uint8 each)."""
    b = beauty.astype(np.float64) / 255
    m = mask.astype(np.float64) / 255
    rgb, alpha = b[..., :3], b[..., 3]
    luma = rgb @ LUMA
    # The zones' shares of the pixel's covered part: the mask's colors (straight alpha like the rendering's: linear
    # coverage, adding up to 1 where zones meet; the rest is effect colors).
    total = np.zeros(luma.shape)
    graded = np.zeros(rgb.shape)
    for zone, ch in ZONES:
        w = m[..., ch]
        look = looks.get(zone)
        t = look.tone(luma) if look else luma
        color = look(t) if look else ramps[zone](t)
        if ramps.get(zone) is not None and look and mix[zone] > 0:
            color = color * (1 - mix[zone]) + ramps[zone](t) * mix[zone]
        graded += w[..., None] * color
        total += w
    out = graded + rgb * (1 - np.clip(total, 0, 1))[..., None]
    res = np.concatenate([np.clip(out, 0, 1), alpha[..., None]], -1)
    return (res * 255 + 0.5).astype(np.uint8)


def cut_to_frame(rgba, frame, pad):
    """A menu picture without the margin around its frame (its sprite is cut there)."""
    x, y, w, h = frame["rect"]
    H, W = rgba.shape[:2]
    mx, my = round(pad * W / (w + 2 * pad)), round(pad * H / (h + 2 * pad))
    out = rgba.copy()
    out[:my, :, 3] = 0
    out[H - my:, :, 3] = 0
    out[:, :mx, 3] = 0
    out[:, W - mx:, 3] = 0
    return out


def dilate(mask, rx, ry):
    """A boolean mask grown by rx columns and ry rows."""
    out = mask.copy()
    for dx in range(-rx, rx + 1):
        for dy in range(-ry, ry + 1):
            if dx or dy:
                out |= np.roll(np.roll(mask, dy, 0), dx, 1)
    return out


def reconcile(rgba, sprite, painting, sx=5, sy=6):
    """An original robot's picture made to cover exactly what its sprite covers (its model is fitted, not exact): the
    rendering cut a native pixel beyond the sprite (the game recolors a picture's pixels through the sprite's pixels
    next to them), and where it leaves the sprite uncovered, the painting of the sprite (or, without one, the
    rendering's nearest colors). `sprite`: the sprite's RGBA at native size with the export's margin."""
    H, W = rgba.shape[:2]
    s = np.asarray(Image.fromarray(sprite).resize((W, H), Image.NEAREST))[..., 3] > 127
    out = rgba.copy()
    out[~dilate(s, sx, sy), 3] = 0
    missing = s & (out[..., 3] < 128)
    if missing.any():
        if painting is not None and painting.shape[:2] == (H, W):
            out[missing] = painting[missing]
        else:
            # (the nearest rendered colors, grown into the gaps)
            filled = out.copy()
            have = filled[..., 3] >= 128
            for _ in range(24):
                if not (missing & ~have).any():
                    break
                grow = dilate(have, 1, 1) & ~have
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    src = np.roll(np.roll(filled, dy, 0), dx, 1)
                    srch = np.roll(np.roll(have, dy, 0), dx, 1)
                    take = grow & srch & ~have
                    filled[take] = src[take]
                    have = have | take
            out[missing] = filled[missing]
            out[missing, 3] = 255
    return out


def per_zone(value, default):
    """'0.6' or 'primary=0.6,tertiary=0.8' -> a value per zone."""
    out = {z: default for z, _ in ZONES}
    if value is None:
        return out
    for part in value.split(","):
        if "=" in part:
            z, v = part.split("=")
            out[z.strip()] = float(v)
        else:
            out = {z: float(part) for z in out}
    return out


def pictures(folder):
    """(picture, its path without the extension, frame name) of every picture with a zone mask under the folder (the
    frame names from render_frames.py's frames.json, else the file names)."""
    index = os.path.join(folder, "frames.json")
    names = json.load(open(index, encoding="utf-8")) if os.path.exists(index) else {}
    for root, _, files in os.walk(folder):
        for f in sorted(files):
            if not f.endswith(".mask.png"):
                continue
            base = os.path.join(root, f[:-len(".mask.png")])
            pic = next((p for p in (base + ".hd.png", base + ".png") if os.path.exists(p)), None)
            if pic:
                yield pic, base, names.get(os.path.relpath(pic, folder).replace(os.sep, "/"), os.path.basename(base))


# The reference colors' hues (the HD pictures' palette: primary blue, secondary red, tertiary gold).
REF_HUES = {"primary": 205.0, "secondary": 350.0, "tertiary": 45.0}


def hue_zone(rgb):
    """Each pixel's zone by its hue ("" where it is too grey or dark to tell)."""
    mx, mn = rgb.max(-1), rgb.min(-1)
    d = mx - mn
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    h = np.zeros(mx.shape)
    m = d > 1e-6
    h = np.where(m & (mx == r), ((g - b) / np.maximum(d, 1e-6)) % 6, h)
    h = np.where(m & (mx == g) & (mx != r), (b - r) / np.maximum(d, 1e-6) + 2, h)
    h = np.where(m & (mx == b) & (mx != r) & (mx != g), (r - g) / np.maximum(d, 1e-6) + 4, h)
    h = h * 60
    sat = np.where(mx > 0, d / np.maximum(mx, 1e-6), 0)
    out = np.full(mx.shape, "", dtype=object)
    ok = (sat > 0.25) & (mx > 0.12)
    for zone, ref in REF_HUES.items():
        dist = np.abs(((h - ref) + 180) % 360 - 180)
        out[ok & (dist < 30)] = zone
    return out


def package_paintings(robot, package):
    """(move, sprite) -> a function loading the mod package's painting of that sprite (RGBA, 5 x 6 per pixel)."""
    z = zipfile.ZipFile(package)
    folder = robot.lower()
    hd = json.loads(z.read(f"robots/{folder}/hd.json"))
    return {(s["anim"], s["sprite"]): (lambda f=s["file"]: Image.open(io.BytesIO(z.read(f"robots/{folder}/{f}"))).convert("RGBA"))
            for s in hd["sprites"]}


def pack_paintings(robot, pack):
    """(move, sprite) -> a function loading an HD asset pack's painting of that sprite (an original robot's: the pack's
    deliveries are 15 x 18 per pixel, scaled down to the renderings' 5 x 6)."""
    manifest = json.load(open(os.path.join(pack, "manifest.json"), encoding="utf-8"))
    out = {}
    for job in manifest["jobs"]:
        if not job["id"].startswith(f"fighter/{robot}/"):
            continue
        path = os.path.join(pack, job["output"])
        if not os.path.exists(path):
            continue
        for u in job.get("usages", []):
            def load(path=path):
                im = Image.open(path).convert("RGBA")
                return im.resize((im.width // 3, im.height // 3), Image.LANCZOS)
            out.setdefault((u["anim"], u["sprite"]), load)
    return out


def calibrate(robot, renders, paintings, source):
    """The look of a robot's paintings (`paintings`: (move, sprite) -> picture) for its renderings: per zone, the tone
    curve and the color table (see Look), from the pixels both cover that the mask gives wholly to the zone."""
    files = paintings
    ours = {zone: [] for zone, _ in ZONES}
    theirs = {zone: [] for zone, _ in ZONES}
    frames = 0
    for pic, base, name in pictures(renders):
        match = re.fullmatch(r"m(\d+)s(\d+)", name)
        if not match or (int(match[1]), int(match[2])) not in files:
            continue
        raw = base + ".raw.png"
        r = np.asarray(Image.open(raw if os.path.exists(raw) else pic).convert("RGBA"), np.float64) / 255
        p = np.asarray(files[int(match[1]), int(match[2])](), np.float64) / 255
        m = np.asarray(Image.open(base + ".mask.png").convert("RGBA"), np.float64) / 255
        if p.shape != r.shape:
            continue
        both = (r[..., 3] > 0.95) & (p[..., 3] > 0.95) & (m[..., 3] > 0.95)
        hue = hue_zone(p[..., :3])
        for zone, ch in ZONES:
            # (where the painting shows the same zone: a fitted model's zones do not always lie where the painting's do)
            sel = both & (m[..., ch] > 0.95) & ((hue == zone) | (hue == ""))
            ours[zone].append(r[..., :3][sel] @ LUMA)
            theirs[zone].append(p[..., :3][sel])
        frames += 1
    look = {"robot": robot, "frames": frames, "source": source, "zones": {}}
    qs = np.linspace(0, 1, QUANTILES + 1)
    for zone, _ in ZONES:
        a = np.concatenate(ours[zone]) if ours[zone] else np.zeros(0)
        b = np.concatenate(theirs[zone]) if theirs[zone] else np.zeros((0, 3))
        if len(a) < 1000:
            continue
        bl = b @ LUMA
        src, dst = np.quantile(a, qs), np.quantile(bl, qs)
        # (strictly rising, so the curve is a function; the ends pinned to black and white)
        src = np.maximum.accumulate(src + np.arange(len(src)) * 1e-6)
        dst = np.maximum.accumulate(dst)
        src, dst = np.concatenate([[0.0], src, [1.0 + 1e-6]]), np.concatenate([[0.0], dst, [max(dst[-1], 1.0)]])
        # The color table: the paintings' mean chroma in each brightness step (steps without enough pixels take their
        # neighbors').
        edges = np.linspace(0, 1, BINS + 1)
        rows = []
        for i in range(BINS):
            sel = (bl >= edges[i]) & (bl < edges[i + 1])
            if sel.sum() >= 50:
                rows.append([float(bl[sel].mean())] + list((b[sel] - bl[sel][:, None]).mean(0)))
        look["zones"][zone] = {"tone": [np.round(src, 5).tolist(), np.round(dst, 5).tolist()],
                               "chroma": np.round(np.array(rows), 5).tolist(), "pixels": int(len(a))}
    return look


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--glb", required=True, help="the export (its robot, ramps and frames)")
    ap.add_argument("--renders", required=True)
    ap.add_argument("--out", help="default: in place (keeping the renderings as <name>.raw.png)")
    ap.add_argument("--frames", help="frame names (m11s0,...); default all")
    ap.add_argument("--look", help="default: tools/blender/looks/<robot>.json if there is one ('none': the ramps)")
    ap.add_argument("--ramp", help="with a look, how much of the ramp's colors to mix in (0..1), for all zones or per zone")
    ap.add_argument("--calibrate", metavar="PACKAGE", help="write the look of this mod package's pictures of the robot instead")
    ap.add_argument("--calibrate-pack", metavar="PACK", help="the same from an HD asset pack's paintings (the original robots: hd-pack)")
    ap.add_argument("--paintings", metavar="PACK", help="original robots: the HD asset pack whose paintings fill what the fitted model leaves uncovered")
    a = ap.parse_args()
    info = export_info(a.glb)
    robot = info["robot"]
    look_path = a.look or os.path.join(HERE, "looks", f"{robot.lower()}.json")
    if a.calibrate or a.calibrate_pack:
        look = calibrate(robot, a.renders, package_paintings(robot, a.calibrate) if a.calibrate else pack_paintings(robot, a.calibrate_pack),
                         os.path.basename(os.path.normpath(a.calibrate or a.calibrate_pack)))
        os.makedirs(os.path.dirname(look_path), exist_ok=True)
        with open(look_path, "w", encoding="utf-8") as f:
            json.dump(look, f, separators=(",", ":"))
            f.write("\n")
        print(f"{look_path}: {robot}'s look from {look['frames']} frames, zones " +
              ", ".join(f"{z} ({v['pixels']} pixels)" for z, v in look["zones"].items()))
        return
    ramps = {z: Ramp(c) for z, c in info.get("ramps", {}).items()}
    looks = {}
    if a.look != "none" and os.path.exists(look_path):
        looks = {z: Look(d) for z, d in json.load(open(look_path, encoding="utf-8"))["zones"].items()}
    if not ramps and not looks:
        sys.exit(f"{a.glb} has no ramps (export it again) and there is no look")
    frames = {f["name"]: f for f in info["frames"]}
    pad = info.get("pad", 4)
    # (an original robot's export: its sprites are the fighter file's, its model fitted to them)
    original = bool(info.get("original"))
    sprites_dir = os.path.join(os.path.dirname(a.glb), robot.lower(), "sprites")
    paintings = pack_paintings(robot, a.paintings) if original and a.paintings else {}
    mix = per_zone(a.ramp, 0.0)
    want = set(a.frames.split(",")) if a.frames else None
    done = 0
    for pic, base, name in pictures(a.renders):
        if want and name not in want:
            continue
        raw = base + ".raw.png"
        src = raw if not a.out and os.path.exists(raw) else pic  # (graded before: grade the rendering again)
        beauty = np.asarray(Image.open(src).convert("RGBA"))
        if not a.out and src == pic:
            Image.fromarray(beauty).save(raw)
        out = grade(beauty, np.asarray(Image.open(base + ".mask.png").convert("RGBA")), ramps, looks, mix)
        frame = frames.get(name) if re.fullmatch(r"m\d+s\d+", name) else None
        if frame and frame.get("kind") == "menu":
            out = cut_to_frame(out, frame, pad)
        if original and frame and os.path.exists(os.path.join(sprites_dir, name + ".png")):
            key = (frame.get("move"), frame.get("sprite"))
            painting = np.asarray(paintings[key]()) if key in paintings else None
            out = reconcile(out, np.asarray(Image.open(os.path.join(sprites_dir, name + ".png")).convert("RGBA")), painting)
        dest = pic if not a.out else os.path.join(a.out, os.path.relpath(pic, a.renders))
        os.makedirs(os.path.dirname(dest) or ".", exist_ok=True)
        Image.fromarray(out).save(dest)
        done += 1
    print(f"graded {done} pictures" + (f" into {a.out}" if a.out else "") +
          (f" with {os.path.relpath(look_path)}" if looks else " along the ramps"))


if __name__ == "__main__":
    main()
