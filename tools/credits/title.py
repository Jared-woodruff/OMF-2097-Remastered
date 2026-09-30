"""The credits' title art: the original intro's logo, lightning and digits (INTRO.BK) cut out of the remaster's HD
artwork (public/hd/scene-INTRO) into their own pictures, public/credits/title/<name>.webp, and title.json: each picture's
size and where it sits in its sprite, in the game's native pixels (the HD artwork keeps a margin around a sprite, and is
trimmed). The credits (src/game/credits/titleCard.ts) place the sprites where the 1994 intro drew them.

Usage: python tools/credits/title.py      (Python 3 with Pillow)
"""
import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
HD = ROOT / 'public' / 'hd'
OUT = ROOT / 'public' / 'credits' / 'title'

# The sprites, by the fingerprint of their original pixels (hd index.json), and their native size (w, h).
SPRITES = {
    'badge': ('3124a3357108a2a1', 306, 192),
    'strike': ('bf1be3808777b44a', 265, 200),
    'bolt2': ('198974a523e19f90', 139, 120),
    'bolt0': ('84cbdc17c328f034', 136, 135),
    'bolt9': ('6876153c182b3e4f', 118, 136),
    'bolt7': ('3420841416003d5b', 177, 96),
    'digit2': ('e1501a8d20a3abba', 18, 15),
    'digit0': ('06b462f9d8562daa', 20, 15),
    'digit9': ('9bd52e9c9cb316f9', 19, 15),
    'digit7': ('5a2ded95a707c91e', 18, 15),
}


def main():
    index = json.loads((HD / 'index.json').read_text(encoding='utf-8'))
    entries = {e['hash']: e for e in index['entries'] if e.get('bundle') == 'scene-INTRO'}
    pages = {}
    OUT.mkdir(parents=True, exist_ok=True)
    placements = {}
    for name, (h, w, hh) in SPRITES.items():
        e = entries[h]
        bundle = index['bundles'][e['bundle']]
        page = pages.get(e['page'])
        if page is None:
            page = pages[e['page']] = Image.open(HD / e['bundle'] / bundle['pages'][e['page']]['file']).convert('RGBA')
        crop = page.crop((e['x'], e['y'], e['x'] + e['w'], e['y'] + e['h']))
        crop.save(OUT / f'{name}.webp', quality=92, method=6)
        # (renderer.ts writeHdQuad: native pixels per HD pixel, and the stored rectangle's corner in the sprite)
        pad = e.get('pad', 0)
        kx, ky = (w + 2 * pad) / e['fw'], (hh + 2 * pad) / e['fh']
        placements[name] = {
            'x': round(-pad + e['tx'] * kx, 4), 'y': round(-pad + e['ty'] * ky, 4),
            'w': round(e['w'] * kx, 4), 'h': round(e['h'] * ky, 4),
        }
        print(f'{name}: {crop.size[0]}x{crop.size[1]} -> {placements[name]}')
    (OUT / 'title.json').write_text(json.dumps(placements, indent=1) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
