"""Step 2 of `npm run menu:export`: the main menu's layer pack for an image generation AI.

The main menu (MAIN.BK) becomes a parallax scene: a painted master image of the whole scene, cut into depth layers
(sky, city, the two towers, the robot, two rows of crowd) that the game moves at different speeds and lights live.
This script splits the original 320x200 picture into those layers (masks from its palette and a few outlines), and
writes per layer a guide (the current HD artwork of that layer), a mask, a context image and a prompt, plus the docs.
It also cuts placeholder layers from the current HD artwork (with the hidden parts filled in) that the game uses until
the generated layers come back (tools/menu-pack/import.py).

Usage: python tools/menu-pack/export.py <pack folder>   (after dump.test.ts wrote <pack>/.work/mainbk.json)
"""
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PACK = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'menu-pack'))
WORK = os.path.join(PACK, '.work')
HD_ART = os.path.join(ROOT, 'public', 'hd', 'scene-MAIN', 'bg_0.webp')

# Output pixels per native pixel (native pixels are 1.2x taller than wide: 5 x 6 gives square pixels, as in the HD pack).
SX, SY = 5, 6
# The canvas in native coordinates: the 320x200 screen, the widest widescreen view (128 more columns on each side) and
# a margin for the parallax movement.
CX0, CY0, CW, CH = -144, -6, 608, 212
OW, OH = CW * SX, CH * SY
FRAME = ((0 - CX0) * SX, (0 - CY0) * SY, 320 * SX, 200 * SY)  # the original screen inside the canvas (x, y, w, h)

LAYERS = [
    # name, depth (parallax: 0 = infinitely far, 1 = the nearest layer), transparent
    ('sky', 0.04, False),
    ('city', 0.14, True),
    ('tower_right', 0.3, True),
    ('tower_left', 0.36, True),
    ('robot', 0.5, True),
    ('crowd_back', 0.78, True),
    ('crowd_front', 1.0, True),
]
LABEL = {name: i for i, (name, _, _) in enumerate(LAYERS)}

STYLE = ('Faithful high-resolution remaster of the original artwork: identical design, composition, pose, proportions, '
         'camera angle and color scheme, re-rendered with modern high-end 3D CGI quality — crisp clean edges, detailed '
         'hard-surface panels and bolts, physically based metal and painted materials with subtle wear, smooth gradients '
         '(no dithering or banding), soft realistic lighting and reflections consistent with the original light '
         'direction, sharp focus, 1990s sci-fi arcade aesthetic.')
NEGATIVE = ('pixel art, pixelated, dithering, color banding, jpeg artifacts, blurry, soft focus, lowres, noise, grain, '
            'text, letters, numbers, logo, watermark, signature, UI, frame, border, cropped subject, extra limbs, '
            'extra objects, changed pose, different design, redesigned character, different colors, cartoon, anime, '
            'cel shading, sketch, painterly brush strokes, deformed, distorted perspective')
SCENE = ('The main menu of One Must Fall 2097 at night: a giant battle robot stands on a stage in a futuristic city '
         'plaza, raising its right arm to the sky in triumph, between two skyscrapers — on the left a tower of stacked '
         'floor slabs, each turned a little from the one below; on the right a glass tower with horizontal window '
         'bands — under a deep blue night sky with long streaky clouds. Behind the stage: a long low building with '
         'horizontal bands and a flat dome. The dark silhouettes of a cheering crowd fill the foreground. Seen from low '
         'in the crowd, looking up at the robot.')
ROBOT = ('The robot (the Jaguar, about 90 feet tall) is built from simple tapered four-sided blocks in glossy deep '
         'cobalt-blue paint, joined by polished gold ball joints: a flat trapezoid head, wider at the top, with two gold '
         'triangular eyes, on a gold ball neck; a broad chest block, wider at the shoulders, carrying a large gold '
         'cat-mask emblem (two pointed ears, two slanted eye holes, a pointed chin); a thin blade sticking up and out '
         'from its left shoulder; two stacked pairs of gold balls at the waist; a tapered hip block; arms and legs of '
         'tapered blocks with gold balls at the shoulders, elbows, wrists, hips, knees and ankles; hands made of two '
         'crossed thin bars on the wrist ball; flat pointed feet turned outward. Pose: right arm raised high toward the '
         'upper left, left arm down and out to the side, feet planted wide, head slightly tilted.')


# ---- the original picture and its layers ---------------------------------------------------------------------------

def load_original():
    d = json.load(open(os.path.join(WORK, 'mainbk.json')))
    w, h = d['w'], d['h']
    idx = np.array(d['data'], dtype=np.int32).reshape(h, w)
    pal = np.array(d['palette'], dtype=np.uint8).reshape(256, 3)
    return idx, pal, d['anims']


def poly(points, w=320, h=200):
    im = Image.new('L', (w, h), 0)
    ImageDraw.Draw(im).polygon([tuple(p) for p in points], fill=1)
    return np.array(im, dtype=bool)


def components(mask):
    """8-connected component labels."""
    h, w = mask.shape
    lab = np.zeros(mask.shape, np.int32)
    n = 0
    for y0, x0 in zip(*np.nonzero(mask)):
        if lab[y0, x0]:
            continue
        n += 1
        stack = [(y0, x0)]
        lab[y0, x0] = n
        while stack:
            y, x = stack.pop()
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    yy, xx = y + dy, x + dx
                    if 0 <= yy < h and 0 <= xx < w and mask[yy, xx] and not lab[yy, xx]:
                        lab[yy, xx] = n
                        stack.append((yy, xx))
    return lab, n


def shift_stack(m, r):
    h, w = m.shape
    pad = np.pad(m, r, mode='edge')
    return [pad[r + dy:r + dy + h, r + dx:r + dx + w] for dy in range(-r, r + 1) for dx in range(-r, r + 1)]


def closing(m, r=1):
    dil = np.logical_or.reduce(shift_stack(m, r))
    return np.logical_and.reduce(shift_stack(dil, r))


def segment(idx):
    """Label per native pixel (index into LAYERS)."""
    h, w = idx.shape
    sky_c = idx <= 20
    bld_c = (idx >= 64) & (idx <= 94)
    rob_c = (idx >= 128) & (idx <= 217)
    # The robot: the largest blob of its colors, small holes filled.
    lab, _ = components(rob_c)
    sizes = np.bincount(lab.ravel())
    sizes[0] = 0
    robot = lab == sizes.argmax()
    inv, m = components(~robot)
    for k in range(1, m + 1):
        comp = inv == k
        ys, xs = np.nonzero(comp)
        if comp.sum() < 40 and ys.min() > 0 and xs.min() > 0 and ys.max() < h - 1 and xs.max() < w - 1:
            robot |= comp
    # The crowd: black silhouettes (and their rim colors) connected to the bottom edge, below the heads' outline.
    crowd_c = (np.isin(idx, [64, 65, 66]) | ((idx >= 128) & ~robot)) & ~robot
    ceiling = poly([(0, 156), (20, 156), (22, 130), (28, 122), (46, 121), (51, 129), (53, 150), (64, 156), (72, 166),
                    (80, 141), (320, 126), (320, 200), (0, 200)])
    lab, _ = components(crowd_c & ceiling)
    crowd = np.isin(lab, list(set(np.unique(lab[h - 1, :])) - {0}))
    tower_r = poly([(215, 38), (292, 49), (321, 106), (321, 201), (177, 201)]) & ~crowd & ~robot
    left = poly([(-1, 8), (60, 16), (73, 56), (66, 82), (57, 110), (49, 127), (43, 142), (38, 201), (-1, 201)])
    tower_l = closing(left & bld_c & ~crowd & ~robot) & left & ~crowd & ~robot
    city = bld_c & ~tower_l & ~tower_r & ~crowd & ~robot & (np.arange(h)[:, None] > 110)
    front = poly([(-1, 110), (72, 110), (72, 176), (330, 176), (330, 201), (-1, 201)])
    labels = np.zeros((h, w), np.int32)
    labels[city] = LABEL['city']
    labels[tower_r] = LABEL['tower_right']
    labels[tower_l] = LABEL['tower_left']
    labels[robot] = LABEL['robot']
    labels[crowd & ~front] = LABEL['crowd_back']
    labels[crowd & front] = LABEL['crowd_front']
    # Stray pixels (a few rim or dither pixels) join the layer around them: 3x3 majority, twice.
    for _ in range(2):
        stack = np.stack(shift_stack(labels, 1))
        counts = np.stack([(stack == k).sum(0) for k in range(len(LAYERS))])
        own = np.take_along_axis(counts, labels[None], 0)[0]
        labels = np.where(own <= 2, counts.argmax(0), labels)
    return labels


# ---- images ----------------------------------------------------------------------------------------------------------

def to_canvas(img, fill=(0, 0, 0, 0)):
    """Places a frame-sized (1600x1200) image in the middle of the canvas."""
    c = Image.new(img.mode if img.mode == 'RGBA' else 'RGBA', (OW, OH), fill)
    c.paste(img.convert('RGBA'), FRAME[:2])
    return c


def soft_mask(labels, which):
    """The layer's mask at the frame's output size, with smooth anti-aliased outlines (0..255)."""
    m = Image.fromarray((np.isin(labels, which) * 255).astype(np.uint8))
    m = m.resize((320 * SX, 200 * SY), Image.BICUBIC).filter(ImageFilter.GaussianBlur(1.6))
    a = np.asarray(m, dtype=np.float32) / 255.0
    a = np.clip((a - 0.5) * 2.2 + 0.5, 0, 1)
    return Image.fromarray((a * 255).astype(np.uint8))


def push_pull(rgb, alpha):
    """Fills the unknown pixels (alpha 0) of an image from the known ones (smooth, like a pyramid inpainting)."""
    levels = []
    c = rgb * alpha[..., None]
    a = alpha.copy()
    while min(a.shape) > 2:
        levels.append((c, a))
        h, w = a.shape
        h2, w2 = (h + 1) // 2, (w + 1) // 2
        cp = np.zeros((h2 * 2, w2 * 2, 3), np.float32)
        ap = np.zeros((h2 * 2, w2 * 2), np.float32)
        cp[:h, :w], ap[:h, :w] = c, a
        c = cp.reshape(h2, 2, w2, 2, 3).sum((1, 3))
        a = ap.reshape(h2, 2, w2, 2).sum((1, 3))
        norm = np.maximum(a, 1e-6)
        c = c / norm[..., None] * np.minimum(a, 1)[..., None]
        a = np.minimum(a, 1)
    col = c / np.maximum(a, 1e-6)[..., None]
    for c_l, a_l in reversed(levels):
        h, w = a_l.shape
        up = np.repeat(np.repeat(col, 2, 0), 2, 1)[:h, :w]
        up = np.asarray(Image.fromarray(np.clip(up, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1)), np.float32)
        col = c_l / np.maximum(a_l, 1e-6)[..., None] * a_l[..., None] + up * (1 - a_l[..., None])
    return col


def placeholders(labels, art):
    """Layers cut from the current HD artwork (frame-sized, RGBA), the parts hidden behind nearer layers filled in."""
    rgb = np.asarray(art.convert('RGB'), np.float32)
    out = {}
    for i, (name, _, transparent) in enumerate(LAYERS):
        if name == 'crowd_front':
            continue
        # The placeholder's crowd is one layer: its two rows were cut apart along a straight line, which would show
        # as the rows move against each other (the generated rows have their own outlines).
        which = [i, LABEL['crowd_front']] if name == 'crowd_back' else [i]
        own = np.asarray(soft_mask(labels, which), np.float32) / 255.0
        # What hides this layer: every nearer layer (where the layer may continue behind).
        nearer = np.asarray(soft_mask(labels, [k for k in range(i + 1, len(LAYERS)) if k not in which]), np.float32) / 255.0
        if name == 'sky':
            # The sky continues everywhere behind the rest (filled from pixels well inside the sky: its edges carry
            # the dark outlines of what is in front).
            core = Image.fromarray(((own > 0.99) * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(15))
            fill = push_pull(rgb, np.asarray(core, np.float32) / 255.0)
            out[name] = Image.fromarray(np.clip(fill, 0, 255).astype(np.uint8)).convert('RGBA')
            continue
        img = rgb.copy()
        alpha = own.copy()
        if name in ('city', 'tower_right', 'tower_left'):
            # Buildings go down to the ground behind the crowd: extend the lowest visible rows downward.
            cols = np.nonzero(own.max(0) > 0.5)[0]
            ext = np.zeros_like(own)
            for x in cols:
                ys = np.nonzero(own[:, x] > 0.5)[0]
                if len(ys) == 0:
                    continue
                y1 = ys.max()
                if y1 < own.shape[0] - 1 and nearer[min(y1 + 3, own.shape[0] - 1), x] > 0.5:
                    ext[y1:, x] = 1
                    img[y1:, x] = rgb[max(y1 - 2, 0), x]
            alpha = np.maximum(alpha, ext * (nearer > 0.02))
        out[name] = Image.fromarray(np.dstack([np.clip(img, 0, 255), alpha * 255]).astype(np.uint8), 'RGBA')
    return out


def dim_except(art, mask):
    """The whole scene, darkened and desaturated except the layer (for context.png)."""
    rgb = np.asarray(art.convert('RGB'), np.float32)
    grey = rgb.mean(2, keepdims=True)
    m = np.asarray(mask, np.float32)[..., None] / 255.0
    out = rgb * m + (grey * 0.25 + 12) * (1 - m)
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))


def original_image(idx, pal, anims=None, frames=(3, 4)):
    """The original picture at the output's proportions (5x6), optionally with the spotlight animation frames."""
    rgb = pal[idx].copy()
    if anims:
        for sprites, f in zip(anims, frames):
            s = sprites[f]
            data = np.array(s['data'], np.int32).reshape(s['h'], s['w'])
            for y in range(s['h']):
                for x in range(s['w']):
                    v = data[y, x]
                    X, Y = s['x'] + x, s['y'] + y
                    if v and 0 <= X < 320 and 0 <= Y < 200:
                        rgb[Y, X] = pal[v]
    return Image.fromarray(rgb).resize((320 * SX, 200 * SY), Image.NEAREST)


# ---- docs ------------------------------------------------------------------------------------------------------------

PROMPTS = {
    'master': (
        f'{SCENE} {ROBOT} Widescreen: the canvas is 2.4:1; its middle (the region outlined in guide.png) keeps the '
        'original composition exactly — the towers, the robot, the dome, the horizon and the crowd where they are — and '
        'the sides continue the city, the sky, the plaza and the crowd naturally. Night mood: deep navy blues, the '
        'robot lit by cool moonlight from the upper left, the crowd almost black. {STYLE}'),
    'sky': (
        'Only the night sky of the master image: deep navy blue, long horizontal streaks of cloud lit in blue, a few '
        'faint stars, slightly lighter along the horizon where the city lights glow. Remove every building, the robot '
        'and the crowd, and continue the sky behind them all the way to the bottom edge (no ground, no buildings). '
        'Opaque, the full canvas.'),
    'city': (
        'Only the far background of the master image: the long low building with horizontal bands (left of the '
        'middle), the flat dome behind the stage (right of the middle), the stage floor and the plaza, and along the '
        'horizon a distant skyline of towers with a few lit windows across the whole width. Continue them behind the '
        'robot and the crowd down to the bottom edge (solid dark plaza, no holes). Transparent: the sky above the '
        'skyline. Leave out the two big towers, the robot and the crowd.'),
    'tower_right': (
        'Only the glass skyscraper on the right of the master image: dark blue glass in horizontal bands between light '
        'grey-blue floor edges, its roof edge against the sky, a narrow darker side face on its left; slightly tilted '
        'by the upward view. Complete it down to the ground behind the crowd (its whole lower part), and extend it to '
        'the right edge of the canvas. Everything else transparent.'),
    'tower_left': (
        'Only the tower on the left of the master image: a stack of thick grey concrete floor slabs, each turned a '
        'little from the one below, dark recessed glass between them, lit from the upper left; it continues above the '
        'top edge of the canvas. Complete it down to the ground behind the crowd, and extend it to the left edge of '
        'the canvas. Everything else transparent.'),
    'robot': (
        f'Only the robot of the master image, standing on its stage. {ROBOT} Lighting: dim cool moonlight from the '
        'upper left and a thin blue rim light from behind — no spotlight (the game adds it). Complete the feet and '
        'lower legs hidden behind the crowd, with the edge of the stage under them. Everything else transparent.'),
    'robot_lit': (
        'The finished robot layer (robot/robot.hd.png) relit, with exactly the same outline, pose and position (every '
        'pixel lines up): a strong white theatre spotlight from the lower front left now falls on the whole robot — '
        'bright highlights on the glossy cobalt paint, shining gold joints and emblem, crisp shadows on the right sides '
        'of the blocks. The original spotlight is shown in reference/original_lit.png. Everything else transparent.'),
    'crowd_back': (
        'Only the spectators farther back (between the front row and the stage) of the master image: black '
        'silhouettes of heads and shoulders, some raising a fist, a faint cool rim light along their tops from the '
        'stage. Continue them across the whole width of the canvas; complete their bodies down to the bottom edge. '
        'Everything else transparent.'),
    'crowd_front': (
        'Only the nearest spectators at the bottom of the master image: large black silhouettes of heads, hair and '
        'shoulders, including the big figure on the left, almost pure black with a thin faint rim light. Continue them '
        'across the whole width. Keep the original\'s hidden joke: the words "your monitor\'s too bright!" written in '
        'very dark grey on the black of the big figure in the lower left, barely visible. Everything else transparent.'),
}

NOTES = {
    'master': 'Do this first: every layer is cut from it, so the whole scene keeps one look.',
    'sky': 'The game drifts the clouds; keep them as soft streaks.',
    'city': 'Keep the dome and the low building exactly where the guide shows them.',
    'tower_right': 'The menu box covers most of this tower on screen; its left edge and roof show.',
    'tower_left': 'The game sweeps a spotlight over its upper right slabs, as in the original.',
    'robot': 'Most important layer. Match guide.png\'s outline and the figurine (reference/robot_figurine.jpg if you add one).',
    'robot_lit': 'Make it from the finished robot.hd.png (image editing / relighting), not from scratch, so both line up.',
    'crowd_back': 'Silhouettes only: no faces, no detail but the rim light.',
    'crowd_front': 'The darkest layer; the rim light is subtle.',
}


def write_docs(jobs):
    rows = '\n'.join(f"| {j['order']} | `{j['folder']}/` | {j['title']} | `{j['output']}` | {'RGBA' if j['transparent'] else 'opaque RGB'} |"
                     for j in jobs)
    readme = f"""# One Must Fall 2097 — main menu layers

The remaster turns the main menu's picture (a robot on a stage between two towers at night, a cheering crowd in
front) into a **parallax scene**: a stack of image layers the game moves at different depths, with live lighting —
a spotlight sweeping over the robot, searchlights and drifting clouds, camera flashes in the crowd. This pack asks for
one painted **master** image of the whole scene and the **layers** cut from it.

## How to process it

1. Read [OUTPUT_SPEC.md](OUTPUT_SPEC.md) (hard rules).
2. Optional but recommended: add a photo of the robot figurine as `reference/robot_figurine.jpg` and use it as a
   design reference for the robot in every job.
3. Do the jobs **in order** (`jobs.json` has the same list):

| # | Folder | What | Output | Format |
| --- | --- | --- | --- | --- |
{rows}

4. Every job folder has `guide.png` (the current artwork of that part, placed on the canvas), `mask.png` (white where
   it is in the original picture), `context.png` (the whole scene with that part highlighted) and `prompt.md`.
5. Return the folder with the new `*.hd.png` files. Partial deliveries work: missing layers fall back to the current
   artwork.

## Why a master first

The old menu picture looked wrong because its pieces were generated separately and did not match. Paint the whole
scene once (`master`), then make each layer **from the master** with image editing (keep this part, remove the rest,
paint what was hidden behind the nearer layers). That keeps one style, palette and light across all layers.

## What each layer needs

- **Hidden parts:** each layer continues behind the layers in front of it (the towers go down to the ground behind
  the crowd; the sky continues behind everything). The game moves the layers a little against each other, so those
  parts show at the edges.
- **The sides:** the canvas is 2.4:1 widescreen, wider than the original 4:3 picture (outlined in `guide.png`).
  Continue every layer to the canvas edges.
- **Lighting:** night, cool moonlight from the upper left. No spotlight on the robot in `robot` (the game sweeps it
  live, blending in `robot_lit`).

## References

- `reference/original.png` — the 1994 picture (320x200, shown at the output's proportions).
- `reference/original_lit.png` — the same with the original's sweeping spotlight on the robot's chest and legs.
- `reference/current_hd.png` — the current HD artwork (4:3), the style to improve on.
- `reference/layers.png` — which part of the picture goes into which layer (colors listed in `jobs.json`).
"""
    spec = f"""# Output specification (hard requirements)

## Names

Save each result in its job folder under the job's `output` name (for example `robot/robot.hd.png`). Do not rename,
move or edit other files.

## Canvas

- Every job: exactly **{OW} × {OH} px** (2.4:1). If a tool cannot make that size, deliver the same aspect ratio
  (within 1%) at least {OW // 2} px wide; it is resampled.
- The original 4:3 picture sits at x = {FRAME[0]}–{FRAME[0] + FRAME[2]}, y = {FRAME[1]}–{FRAME[1] + FRAME[3]} of the canvas
  (outlined in every `guide.png`). Inside it, everything must line up with the guide within about 5 px: the towers'
  edges, the robot's outline, the dome, the horizon, the crowd's heads. Outside it, continue the scene.
- All layers share the canvas: laid over each other, they must form the master image. Do not shift, scale or crop
  a layer.

## Format

- PNG, 8 bits per channel, sRGB.
- `master` and `sky`: opaque RGB.
- All other layers: **RGBA with real transparency** (straight alpha), soft anti-aliased edges, no halos.
- Fallback only if a tool cannot output transparency: a flat pure magenta background (#FF00FF), with no magenta or
  pink in the subject; the import keys it out.

## Content

- No text, logos, signatures, watermarks, borders or frames (the only exception is the hidden joke in
  `crowd_front`, see its prompt).
- No menu, buttons or interface: the game draws the menu box over the right side.
- Same colors and mood as the original: deep navy night, cobalt-blue and gold robot, black crowd.
- `robot_lit` must match `robot` pixel for pixel in outline and position; only the lighting changes.

## Style

> {STYLE}

Negative prompt:

> {NEGATIVE}
"""
    open(os.path.join(PACK, 'README.md'), 'w', encoding='utf-8').write(readme)
    open(os.path.join(PACK, 'OUTPUT_SPEC.md'), 'w', encoding='utf-8').write(spec)


def main():
    os.makedirs(os.path.join(PACK, 'reference'), exist_ok=True)
    idx, pal, anims = load_original()
    labels = segment(idx)
    art = Image.open(HD_ART).convert('RGB')
    if art.size != (320 * SX, 200 * SY):
        art = art.resize((320 * SX, 200 * SY), Image.LANCZOS)

    colors = np.array([(20, 40, 140), (40, 160, 60), (0, 170, 200), (200, 170, 40), (230, 50, 50), (170, 60, 200), (255, 120, 220)], np.uint8)
    Image.fromarray(colors[labels]).resize((320 * SX, 200 * SY), Image.NEAREST).save(os.path.join(PACK, 'reference', 'layers.png'))
    original_image(idx, pal).save(os.path.join(PACK, 'reference', 'original.png'))
    original_image(idx, pal, anims).save(os.path.join(PACK, 'reference', 'original_lit.png'))
    art.save(os.path.join(PACK, 'reference', 'current_hd.png'))
    np.save(os.path.join(WORK, 'labels.npy'), labels)

    def outline(img):
        d = ImageDraw.Draw(img)
        x, y, w, h = FRAME
        d.rectangle([x - 2, y - 2, x + w + 1, y + h + 1], outline=(255, 210, 0, 255), width=3)
        return img

    jobs = []
    order = 0

    def job(name, title, transparent, guide, mask, context):
        nonlocal order
        folder = os.path.join(PACK, name)
        os.makedirs(folder, exist_ok=True)
        outline(guide.convert('RGBA')).save(os.path.join(folder, 'guide.png'))
        mask.save(os.path.join(folder, 'mask.png'))
        outline(context.convert('RGBA')).save(os.path.join(folder, 'context.png'))
        prompt = PROMPTS[name].replace('{STYLE}', STYLE)
        if name != 'master':
            prompt += f' {STYLE}'
        output = f'{name}.hd.png'
        md = (f"# {title}\n\n- **Output:** `{output}` — {OW} × {OH} px, {'RGBA with transparency' if transparent else 'opaque RGB'}\n"
              f"- **Reference:** `../master/master.hd.png` once it exists" + (" (this is the master itself)" if name == 'master' else '') +
              f", `guide.png`, `mask.png`, `context.png`\n\n## Prompt\n\n{prompt}\n\n## Negative prompt\n\n{NEGATIVE}\n\n## Notes\n\n- {NOTES[name]}\n"
              f"- The yellow outline in the guide and context images marks the original 4:3 picture; it is not part of the image.\n")
        open(os.path.join(folder, 'prompt.md'), 'w', encoding='utf-8').write(md)
        order += 1
        depth = next((d for n, d, _ in LAYERS if n == name), 0.5 if name == 'robot_lit' else None)
        jobs.append({'order': order, 'name': name, 'folder': name, 'title': title, 'output': f'{name}/{output}', 'width': OW, 'height': OH,
                     'transparent': transparent, 'depth': depth, 'prompt': prompt, 'negative_prompt': NEGATIVE})

    # The master: the whole picture, the new sides left to the model (white in the mask).
    master_mask = Image.new('L', (OW, OH), 255)
    master_mask.paste(0, (FRAME[0], FRAME[1], FRAME[0] + FRAME[2], FRAME[1] + FRAME[3]))
    job('master', 'Main menu — master image (whole scene)', False, to_canvas(art, (40, 40, 48, 255)), master_mask, to_canvas(art, (0, 0, 0, 255)))
    titles = {
        'sky': 'Layer: the night sky', 'city': 'Layer: the city behind the stage', 'tower_right': 'Layer: the glass tower (right)',
        'tower_left': 'Layer: the stacked tower (left)', 'robot': 'Layer: the robot on its stage', 'crowd_back': 'Layer: the crowd, back rows',
        'crowd_front': 'Layer: the crowd, front row',
    }
    for i, (name, _, transparent) in enumerate(LAYERS):
        m = soft_mask(labels, [i])
        cut = art.convert('RGBA')
        cut.putalpha(m)
        guide = Image.new('RGBA', (OW, OH), (40, 40, 48, 255))
        guide.alpha_composite(to_canvas(cut))
        job(name, titles[name], transparent, guide, to_canvas(m.convert('RGB'), (0, 0, 0, 255)).convert('L'), to_canvas(dim_except(art, m), (0, 0, 0, 255)))
        if name == 'robot':
            lit = original_image(idx, pal, anims).convert('RGBA')
            lit.putalpha(m)
            guide = Image.new('RGBA', (OW, OH), (40, 40, 48, 255))
            guide.alpha_composite(to_canvas(lit))
            job('robot_lit', 'Layer: the robot in the spotlight', True, guide, to_canvas(m.convert('RGB'), (0, 0, 0, 255)).convert('L'),
                to_canvas(dim_except(original_image(idx, pal, anims), m), (0, 0, 0, 255)))
    json.dump({'canvas': {'width': OW, 'height': OH, 'native': [CX0, CY0, CW, CH], 'frame': list(FRAME)}, 'jobs': jobs},
              open(os.path.join(PACK, 'jobs.json'), 'w', encoding='utf-8'), indent=2)
    write_docs(jobs)

    # Placeholder layers for the game (the current artwork cut into the layers).
    ph = os.path.join(WORK, 'placeholder')
    os.makedirs(ph, exist_ok=True)
    for f in os.listdir(ph):
        os.remove(os.path.join(ph, f))
    for name, img in placeholders(labels, art).items():
        img.save(os.path.join(ph, f'{name}.png'))
    print(f'menu pack: {len(jobs)} jobs in {PACK}')


if __name__ == '__main__':
    main()
