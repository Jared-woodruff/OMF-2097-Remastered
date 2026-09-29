"""The new-art pack, step 2 (after tools/hd-pack/export.test.ts in its new-art mode wrote the robot jobs and the docs):
the arenas' guides from their current paintings, the reference sheets (the originals' HD artwork, the target; the new
content now), and the zip to hand to the image AI.

Usage: python tools/newart/prepare.py <pack folder>      (npm run newart:export runs it)
Needs Pillow. The originals' references come from the HD asset pack (hd-pack/), the arenas' paintings from public/gen.
"""
import json
import re
import shutil
import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent.parent
HD_PACK = ROOT / 'hd-pack'
GEN = ROOT / 'public' / 'gen'
# (the in-game comparison shots: a new robot beside an original in a new arena; made by the scratchpad recorder)
IN_GAME = ROOT / '.captures' / 'newcontent'

ARENA_W, ARENA_H = 2880, 1200
CLASSIC = (640, 2240)
FLOOR_Y = 190 * 6
WALLS = (640 + 20 * 5, 640 + 300 * 5)
HUD_Y = 34 * 6
ORIGINAL_ROBOTS = ['JAGUAR', 'SHADOW', 'THORN', 'PYROS', 'ELECTRA', 'KATANA', 'SHREDDER', 'FLAIL', 'GARGOYLE', 'CHRONOS', 'NOVA']
BACKGROUND = (18, 20, 26)


def layout(guide: Image.Image) -> Image.Image:
    """The guide with the fixed lines: the HUD band dimmed, the 4:3 screen, the fighting area, the floor line."""
    img = guide.convert('RGB').copy()
    band = img.crop((0, 0, ARENA_W, HUD_Y))
    img.paste(Image.blend(band, Image.new('RGB', band.size, (0, 0, 0)), 0.55), (0, 0))
    d = ImageDraw.Draw(img)
    d.rectangle((CLASSIC[0], 0, CLASSIC[1] - 1, ARENA_H - 1), outline=(255, 255, 255), width=4)
    for x in WALLS:
        for y in range(HUD_Y, FLOOR_Y, 24):
            d.line((x, y, x, min(y + 12, FLOOR_Y)), fill=(80, 220, 255), width=3)
    d.line((0, FLOOR_Y, ARENA_W, FLOOR_Y), fill=(255, 220, 40), width=4)
    return img


def grid(images: list, cols: int, cell_w: int, gap: int = 24) -> Image.Image:
    """Images scaled to one width, in rows."""
    scaled = [im.resize((cell_w, round(im.height * cell_w / im.width)), Image.LANCZOS) for im in images]
    cell_h = max(im.height for im in scaled)
    rows = (len(scaled) + cols - 1) // cols
    out = Image.new('RGB', (cols * cell_w + (cols + 1) * gap, rows * cell_h + (rows + 1) * gap), BACKGROUND)
    for k, im in enumerate(scaled):
        x = gap + (k % cols) * (cell_w + gap)
        y = gap + (k // cols) * (cell_h + gap)
        out.paste(im.convert('RGB'), (x, y))
    return out


def robot_lineup(frames: list, scale: float = 0.6, gap: int = 48) -> Image.Image:
    """Robots side by side at one scale (their sizes compare), standing on one line, in two rows."""
    scaled = []
    for f in frames:
        f = f.crop(f.getchannel('A').getbbox())
        scaled.append(f.resize((round(f.width * scale), round(f.height * scale)), Image.LANCZOS))
    half = (len(scaled) + 1) // 2
    rows = [scaled[:half], scaled[half:]]
    heights = [max(im.height for im in r) for r in rows]
    width = max(sum(im.width for im in r) + gap * (len(r) + 1) for r in rows)
    out = Image.new('RGBA', (width, sum(heights) + gap * (len(rows) + 1)), BACKGROUND + (255,))
    y = gap
    for r, h in zip(rows, heights):
        x = (width - (sum(im.width for im in r) + gap * (len(r) - 1))) // 2
        for im in r:
            out.alpha_composite(im, (x, y + h - im.height))
            x += im.width + gap
        y += h + gap
    return out.convert('RGB')


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    pack = Path(sys.argv[1]).resolve()
    manifest = json.loads((pack / 'manifest.json').read_text(encoding='utf-8'))
    ref = pack / 'reference'
    ref.mkdir(exist_ok=True)

    # The arenas' guides: their current paintings, and the same with the fixed lines.
    current = []
    for job in (j for j in manifest['jobs'] if j['kind'] == 'arena'):
        file = re.search(r'\((ARENA\d)\)', job['title']).group(1)
        painting = Image.open(GEN / f'{file}-WIDE.webp').convert('RGB')
        if painting.size != (ARENA_W, ARENA_H):
            painting = painting.resize((ARENA_W, ARENA_H), Image.LANCZOS)
        folder = pack / Path(job['guide']).parent
        folder.mkdir(parents=True, exist_ok=True)
        painting.save(folder / 'guide.png')
        layout(painting).save(folder / 'layout.png')
        current.append(painting)
        print(f'{job["id"]}: guide and layout from {file}-WIDE.webp')
    grid(current, 2, 1152).save(ref / 'current_arenas.png')

    # The target: the original robots and arenas in their HD artwork (from the HD asset pack's deliveries).
    frames = []
    for har in ORIGINAL_ROBOTS:
        # (the fighting stance; a robot whose idle frames are stored in shared folders: its first walking frame)
        idle = sorted((HD_PACK / 'tier2_fighters' / har / 'm11_idle').glob('f*.hd.png'))
        walk = sorted((HD_PACK / 'tier2_fighters' / har / 'm10_walk').glob('f*.hd.png'))
        if idle or walk:
            frames.append(Image.open(idle[len(idle) // 2] if idle else walk[0]).convert('RGBA'))
    if frames:
        robot_lineup(frames).save(ref / 'original_robots.png')
    arenas = [HD_PACK / 'tier1_backgrounds' / f'ARENA{i}' / 'widescreen' / 'canvas.hd.png' for i in range(5)]
    arenas = [Image.open(p) for p in arenas if p.exists()]
    if arenas:
        grid(arenas, 2, 1152).save(ref / 'original_arenas.png')
    print(f'references: {len(frames)} original robots, {len(arenas)} original arenas')

    # The new content now, in the game: a new robot (left) beside an original (right).
    shots = ['orbital_glacier_jaguar', 'icecave_tempest_electra', 'rooftop_helix_shredder', 'abyss_spectre_nova']
    for k, name in enumerate(shots, 1):
        src = IN_GAME / f'{name}.jpg'
        if src.exists():
            shutil.copyfile(src, ref / f'in_game_{k}_{name.split("_")[1]}.jpg')

    # The zip for the image AI.
    zip_path = shutil.make_archive(str(pack), 'zip', pack.parent, pack.name)
    print(f'{zip_path} ({Path(zip_path).stat().st_size // 1048576} MB)')


if __name__ == '__main__':
    main()
