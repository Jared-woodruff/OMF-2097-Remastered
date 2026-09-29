"""Prepares the manual's pictures (tools/manual/img/, committed) from the game's HD artwork and screenshots.

Needs the HD asset pack (hd-pack/, the image model's deliveries: robots, pilots, the logo), the imported artwork
(public/hd, public/gen) and the trailer's footage (.captures/trailer2, recorded from the game). The manual itself is
built from img/ with `npm run manual`, so this only runs when the pictures change.

Usage: python tools/manual/prepare.py
"""
import json
import os

from PIL import Image, ImageDraw, ImageFilter, ImageEnhance

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
IMG = os.path.join(ROOT, 'tools', 'manual', 'img')
PACK = os.path.join(ROOT, 'hd-pack')
CAPS = os.path.join(ROOT, '.captures', 'trailer2')
os.makedirs(IMG, exist_ok=True)

ROBOTS = ['jaguar', 'shadow', 'thorn', 'pyros', 'electra', 'katana', 'shredder', 'flail', 'gargoyle', 'chronos', 'nova']


def save_jpg(img, name, width=None, q=84):
    if width and img.width > width:
        img = img.resize((width, round(img.height * width / img.width)), Image.LANCZOS)
    img.convert('RGB').save(os.path.join(IMG, name), 'JPEG', quality=q, optimize=True, progressive=True)


def panel(w, h, top=(22, 30, 60), bottom=(6, 8, 18)):
    """A dark blue studio backdrop with a soft light behind the subject."""
    bg = Image.new('RGB', (w, h))
    d = ImageDraw.Draw(bg)
    for y in range(h):
        t = y / max(1, h - 1)
        d.line([(0, y), (w, y)], fill=tuple(int(top[i] * (1 - t) + bottom[i] * t) for i in range(3)))
    glow = Image.new('L', (w, h), 0)
    ImageDraw.Draw(glow).ellipse([w * 0.1, h * 0.05, w * 0.9, h * 0.75], fill=90)
    glow = glow.filter(ImageFilter.GaussianBlur(w * 0.12))
    bg = Image.composite(Image.new('RGB', (w, h), (70, 100, 170)), bg, glow)
    return bg


def on_panel(fig, w, h, scale=0.92):
    """A transparent figure centered on a studio panel of w x h."""
    s = min(w * scale / fig.width, h * scale / fig.height)
    fig = fig.resize((round(fig.width * s), round(fig.height * s)), Image.LANCZOS)
    bg = panel(w, h).convert('RGBA')
    # A soft floor shadow.
    sh = Image.new('L', (w, h), 0)
    fy = (h + fig.height) // 2
    ImageDraw.Draw(sh).ellipse([w * 0.22, fy - h * 0.03, w * 0.78, fy + h * 0.02], fill=150)
    bg = Image.composite(Image.new('RGBA', (w, h), (0, 0, 0, 255)), bg, sh.filter(ImageFilter.GaussianBlur(14)))
    bg.alpha_composite(fig, ((w - fig.width) // 2, (h - fig.height) // 2))
    return bg


def menu_scene():
    """The painted main menu, stacked from the imported layers (public/hd/menu), as one picture."""
    base = os.path.join(ROOT, 'public', 'hd', 'menu')
    m = json.load(open(os.path.join(base, 'layers.json')))
    x0, y0, cw, ch = m['covers']
    sx = 5
    canvas = Image.new('RGBA', (cw * sx, ch * 6), (0, 0, 0, 255))
    for l in m['layers']:
        if l.get('litOf'):
            continue
        im = Image.open(os.path.join(base, l['file'])).convert('RGBA')
        x, y, w, h = l['rect']
        canvas.alpha_composite(im, (round((x - x0) * sx), round((y - y0) * 6)))
    return canvas.convert('RGB')


def main():
    # The logo (the intro's emblem, transparent) and the cover: the main menu's painted scene, cropped upright.
    logo = Image.open(os.path.join(PACK, 'tier3_scenes', 'INTRO', 'a15', 'f000.hd.png')).convert('RGBA')
    logo.thumbnail((760, 760), Image.LANCZOS)
    logo.save(os.path.join(IMG, 'logo.png'), optimize=True)
    scene = menu_scene()
    save_jpg(scene, 'menu-wide.jpg', 1800, 82)
    cw = int(scene.height * 5.5 / 8.5)
    cx = int(scene.width * 0.40)
    save_jpg(scene.crop((cx - cw // 2, 0, cx + cw // 2, scene.height)), 'cover.jpg', 1100, 86)

    # Robots: the select screen's full-body renders (default colors) on a studio panel; Nova from its fighter frames.
    for i, name in enumerate(ROBOTS):
        if name == 'nova':
            fig = Image.open(os.path.join(PACK, 'tier2_fighters', 'NOVA', 'm11_idle', 'f000.hd.png')).convert('RGBA')
        else:
            fig = Image.open(os.path.join(PACK, 'tier3_scenes', 'MELEE', f'a{18 + i}', 'f000.hd.png')).convert('RGBA')
        fig = fig.crop(fig.getbbox())
        save_jpg(on_panel(fig, 600, 820), f'robot-{name}.jpg', q=86)

    # The select screen's robot close-ups (a 5 x 2 sheet).
    sheet = Image.open(os.path.join(PACK, 'tier3_scenes', 'MELEE', 'a01', 'f000.hd.png')).convert('RGBA')
    cols, rows = 5, 2
    cw_, rh = sheet.width / cols, sheet.height / rows
    for i in range(10):
        c, r = i % cols, i // cols
        cell = sheet.crop((round(c * cw_), round(r * rh), round((c + 1) * cw_), round((r + 1) * rh)))
        bbox = cell.getbbox()
        if bbox:
            cell = cell.crop(bbox)
        bg = Image.new('RGBA', cell.size, (0, 0, 0, 255))
        bg.alpha_composite(cell)
        save_jpg(bg, f'face-{ROBOTS[i]}.jpg', 300, 86)

    # Pilots: the big portraits (10 pilots and Major Kreissack). The game shows the VS screen's on the select screen
    # too; MELEE's own set (a04) is unused and has the old Crystal.
    frames = sorted(f for f in os.listdir(os.path.join(PACK, 'tier3_scenes', 'VS', 'a04')) if f.endswith('.hd.png'))
    for i, f in enumerate(frames):
        p = Image.open(os.path.join(PACK, 'tier3_scenes', 'VS', 'a04', f)).convert('RGBA')
        bg = Image.new('RGBA', p.size, (12, 14, 24, 255))
        bg.alpha_composite(p)
        save_jpg(bg, f'pilot-{i}.jpg', 420, 86)

    # Arenas: the HD backgrounds (the new ones from public/gen).
    for a in range(9):
        path = (os.path.join(ROOT, 'public', 'hd', f'scene-ARENA{a}', 'bg_0.webp') if a < 5
                else os.path.join(ROOT, 'public', 'gen', f'ARENA{a}-HD.webp'))
        save_jpg(Image.open(path).convert('RGB'), f'arena-{a}.jpg', 720, 82)

    # Screenshots from the trailer footage.
    shots = {
        'shot-desert': 'desert_0100', 'shot-knockout': 'desert_0197', 'shot-powerplant': 'powerplant_0150',
        'shot-firepit': 'firepit_0120', 'shot-danger': 'danger_0160', 'shot-stadium': 'stadium_0120',
        'shot-orbital': 'orbital_0170', 'shot-icecave': 'icecave_0150', 'shot-rooftop': 'rooftop_0170', 'shot-abyss': 'abyss_0180',
        'shot-classic': 'wipe_c_0120', 'shot-remastered': 'wipe_0120', 'shot-menu': 'menulive_0120', 'shot-select': 'select_0120',
        'shot-vs': 'selectvs_0060', 'shot-training': 'training_0120', 'shot-replays': 'replays_0080', 'shot-replay': 'replayplay_0100',
        'shot-workshop': 'workshop_0027', 'shot-menus': 'menus_0200',
        # (the fought credits, from .captures/stills2: the scratchpad's rec/stills2.mjs)
        'shot-credits': '../stills2/credits_won2',
    }
    for name, frame in shots.items():
        p = os.path.join(CAPS, frame + '.jpg')
        if os.path.exists(p):
            save_jpg(Image.open(p), name + '.jpg', 1000, 80)
        else:
            print('missing', frame)
    # The pilot select screen with Crystal picked, cut to its 4:3 picture.
    save_jpg(Image.open(os.path.join(CAPS, 'select_0010.jpg')).crop((240, 0, 1680, 1080)), 'shot-pilotselect.jpg', 900, 82)
    print('manual pictures:', len(os.listdir(IMG)))


if __name__ == '__main__':
    main()
