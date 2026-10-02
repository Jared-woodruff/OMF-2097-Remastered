"""Imports the main menu's layers into the game: `npm run menu:import [-- <pack folder> [<output folder>]]`
(defaults: ./menu-pack, public/hd/menu).

Every layer comes from the pack's finished `<layer>/<layer>.hd.png` when it is there, else from the placeholder cut
from the current HD artwork (made by `npm run menu:export`). Layers on a flat magenta background (#FF00FF, the
fallback for tools without transparency) are keyed out. Each layer is cropped to what it shows and saved as WebP, with
`layers.json` describing where each one goes (native screen coordinates) and how deep it is (parallax).
Needs Python 3 with numpy and Pillow.
"""
import hashlib
import io
import json
import os
import sys

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PACK = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'menu-pack'))
OUT = os.path.abspath(sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, 'public', 'hd', 'menu'))

# Must match export.py.
SX, SY = 5, 6
CX0, CY0, CW, CH = -144, -6, 608, 212
OW, OH = CW * SX, CH * SY
LAYERS = [
    ('sky', 0.04, False),
    ('city', 0.14, True),
    ('tower_right', 0.3, True),
    ('tower_left', 0.36, True),
    ('robot', 0.5, True),
    ('robot_lit', 0.5, True),
    ('crowd_back', 0.78, True),
    ('crowd_front', 1.0, True),
]


def key_magenta(rgb):
    """Alpha from the distance to pure magenta, and the magenta spill removed from the edges."""
    f = rgb.astype(np.float32) / 255.0
    r, g, b = f[..., 0], f[..., 1], f[..., 2]
    # How magenta a pixel is: red and blue high, green low.
    m = np.clip(np.minimum(r, b) - g, 0, 1)
    alpha = np.clip(1.0 - (m - 0.25) / 0.5, 0, 1)
    # Remove the magenta mixed into partly transparent pixels: pull red and blue down toward green.
    spill = np.clip(np.minimum(r, b) - g, 0, 1) * (1 - alpha)
    f[..., 0] -= spill
    f[..., 2] -= spill
    return np.clip(f * 255, 0, 255).astype(np.uint8), (alpha * 255).astype(np.uint8)


def load_layer(name, transparent):
    """(RGBA image, native rect it covers, source) or None."""
    done = os.path.join(PACK, name, f'{name}.hd.png')
    if os.path.exists(done):
        im = Image.open(done)
        if im.size != (OW, OH):
            ratio = (im.width / im.height) / (OW / OH)
            if abs(ratio - 1) > 0.01:
                print(f'  {name}: {im.width}x{im.height} is not {OW}:{OH} (skipped; see OUTPUT_SPEC.md)')
                return None
            im = im.resize((OW, OH), Image.LANCZOS)
        if transparent:
            rgba = np.asarray(im.convert('RGBA'))
            if im.mode != 'RGBA' or rgba[..., 3].min() == 255:
                rgb, a = key_magenta(rgba[..., :3])
                rgba = np.dstack([rgb, a])
            im = Image.fromarray(rgba, 'RGBA')
        else:
            im = im.convert('RGBA')
        return im, [CX0, CY0, CW, CH], 'generated'
    ph = os.path.join(PACK, '.work', 'placeholder', f'{name}.png')
    if os.path.exists(ph):
        return Image.open(ph).convert('RGBA'), [0, 0, 320, 200], 'placeholder'
    return None


def main():
    os.makedirs(OUT, exist_ok=True)
    for f in os.listdir(OUT):
        if f.endswith('.webp') or f == 'layers.json':
            os.remove(os.path.join(OUT, f))
    layers = []
    sources = set()
    for name, depth, transparent in LAYERS:
        got = load_layer(name, transparent)
        if not got:
            continue
        im, rect, source = got
        sx, sy = im.width / rect[2], im.height / rect[3]
        if transparent:
            a = np.asarray(im)[..., 3]
            ys, xs = np.nonzero(a > 2)
            if len(xs) == 0:
                continue
            x0, x1 = max(xs.min() - 4, 0), min(xs.max() + 5, im.width)
            y0, y1 = max(ys.min() - 4, 0), min(ys.max() + 5, im.height)
            im = im.crop((x0, y0, x1, y1))
            rect = [rect[0] + x0 / sx, rect[1] + y0 / sy, (x1 - x0) / sx, (y1 - y0) / sy]
        # Named by content: the web version caches HD files for good (public/sw.js).
        buf = io.BytesIO()
        im.save(buf, 'WEBP', quality=90, alpha_quality=95, method=6)
        data = buf.getvalue()
        file = f'{name}.{hashlib.sha1(data).hexdigest()[:10]}.webp'
        open(os.path.join(OUT, file), 'wb').write(data)
        entry = {'name': name, 'file': file, 'rect': [round(v, 3) for v in rect], 'size': [im.width, im.height], 'depth': depth}
        if name == 'robot_lit':
            entry['litOf'] = 'robot'
        layers.append(entry)
        sources.add(source)
        print(f'  {name}: {source}, {im.width}x{im.height}')
    manifest = {
        'version': 1,
        'source': next(iter(sources)) if len(sources) == 1 else 'mixed',
        # The native area the layers were painted for (placeholders cover only the original 4:3 screen).
        'covers': [CX0, CY0, CW, CH] if 'placeholder' not in sources else [0, 0, 320, 200],
        'layers': layers,
    }
    json.dump(manifest, open(os.path.join(OUT, 'layers.json'), 'w', encoding='utf-8'), indent=1)
    total = sum(os.path.getsize(os.path.join(OUT, e['file'])) for e in layers)
    print(f'menu layers: {len(layers)} ({manifest["source"]}), {total / 1e6:.1f} MB in {OUT}')


if __name__ == '__main__':
    main()
