"""Cut-outs of an arena painting for its moving scenery to pass behind (src/gen/scene/scenery.ts): the parts of the
painting nearer than a depth (window bars, a dome's ribs, the rocks around a cave's mouth) in a rectangle, as the HD
picture of a sprite the arena draws over its moving pieces. The game makes the sprite's native pixels from the arena's
own background where the picture covers them, so the classic look matches pixel for pixel too.

The depth is MoGe's (the monocular geometry model the arenas' geometry maps come from, run in a local ComfyUI; see
tools/arena-geo.py): the painting's parts with a normalized disparity (0 far .. 255 near) above --near are cut out; the
edge is then fitted to the painting's own edges (a guided filter), so thin bars keep their crisp outlines.

Writes <out>.webp, the HD picture: the rectangle and the sprites' margin (hd.json's pad, 4 native pixels) at the
painting's own scale (5 x 6 HD pixels per native pixel), a crop of the painting with the cut-out as its alpha (lossless:
its pixels must stay the painting's); and <out>.png, the sprite's native pixels that are cut out (w x h, opaque where
the picture covers at least half of one).

Usage: python tools/scenery-cutout.py <arena folder> --rect x,y,w,h --near 55 [--soft 6] [--out <file, no extension>]
       [--mod public/mods/omf2097r.extras.omfmod] [--comfy http://127.0.0.1:8188] [--preview <file>]
  e.g. python tools/scenery-cutout.py orbital --rect -14,54,328,46 --near 55
The rectangle is in native pixels (x -128..448, y 0..200), its top left corner the sprite's position in scenery.ts.
Needs Python 3 with numpy and Pillow, and ComfyUI with the MoGe model (see tools/arena-geo.py).
"""
import argparse
import importlib.util
import io
import zipfile
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
X0 = -128
HD_X, HD_Y, PAD = 5, 6, 4


def arena_geo():
    spec = importlib.util.spec_from_file_location('arena_geo', ROOT / 'tools' / 'arena-geo.py')
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def box(a: np.ndarray, r: int) -> np.ndarray:
    """Mean over (2r + 1)^2 windows (edges clamped), over the first two axes."""
    p = np.pad(a, [(r + 1, r), (r + 1, r)] + [(0, 0)] * (a.ndim - 2), mode='edge').astype(np.float64)
    c = p.cumsum(0).cumsum(1)
    n = 2 * r + 1
    return (c[n:, n:] - c[:-n, n:] - c[n:, :-n] + c[:-n, :-n]) / (n * n)


def guided(guide: np.ndarray, p: np.ndarray, r: int, eps: float) -> np.ndarray:
    """He et al.'s guided filter with a color guide: p's edges moved onto the guide's."""
    mi = box(guide, r)
    mp = box(p, r)
    cov_ip = box(guide * p[..., None], r) - mi * mp[..., None]
    var = np.empty(guide.shape[:2] + (3, 3))
    for i in range(3):
        for j in range(3):
            var[..., i, j] = box(guide[..., i] * guide[..., j], r) - mi[..., i] * mi[..., j]
    var += eps * np.eye(3)
    a = np.linalg.solve(var, cov_ip[..., None])[..., 0]
    b = mp - (a * mi).sum(-1)
    return (box(a, r) * guide).sum(-1) + box(b, r)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('arena', help="the arena's folder in the mod package (orbital, abyss...)")
    ap.add_argument('--rect', required=True, help='native x,y,w,h')
    ap.add_argument('--near', type=float, required=True, help='disparity (0..255) above which the painting is cut out')
    ap.add_argument('--soft', type=float, default=6, help='width of the depth step (disparity)')
    ap.add_argument('--out', help='default src/gen/scene/scenery/<arena>-cutout (.webp and .png)')
    ap.add_argument('--mod', default=str(ROOT / 'public' / 'mods' / 'omf2097r.extras.omfmod'))
    ap.add_argument('--comfy', default='http://127.0.0.1:8188')
    ap.add_argument('--model', default='moge_3_vitl_fp16.safetensors')
    ap.add_argument('--depth', help="the painting's MoGe depth picture, if already made (else ComfyUI makes it)")
    ap.add_argument('--preview', help='also write the cut-out over a checkerboard here')
    a = ap.parse_args()
    x, y, w, h = (int(v) for v in a.rect.split(','))

    z = zipfile.ZipFile(a.mod)
    painting = Image.open(io.BytesIO(z.read(f'arenas/{a.arena}/hd/background.webp'))).convert('RGB')
    if painting.size != (576 * HD_X, 200 * HD_Y):
        raise SystemExit(f'{a.arena}: the painting is {painting.size}, not the widescreen 2880 x 1200')
    depth = Image.open(a.depth) if a.depth else arena_geo().Comfy(a.comfy).geometry(painting, f'cutout-{a.arena}', a.model)[0]
    d = np.asarray(depth.convert('L').resize(painting.size, Image.BILINEAR), np.float64)
    rgb = np.asarray(painting, np.float64) / 255

    # The picture's rectangle (the sprite and its margin), in painting pixels; the filter sees a little more around it.
    px0, py0 = (x - PAD - X0) * HD_X, (y - PAD) * HD_Y
    pw, ph = (w + 2 * PAD) * HD_X, (h + 2 * PAD) * HD_Y
    r = 6
    gx0, gy0 = max(0, px0 - 2 * r), max(0, py0 - 2 * r)
    gx1, gy1 = min(painting.width, px0 + pw + 2 * r), min(painting.height, py0 + ph + 2 * r)
    near = np.clip((d[gy0:gy1, gx0:gx1] - (a.near - a.soft)) / (2 * a.soft), 0, 1)
    alpha = np.clip(guided(rgb[gy0:gy1, gx0:gx1], near, r, 1e-3), 0, 1)
    # (sharpened a little: the filter leaves soft ramps where the painting's edge is soft)
    alpha = np.clip((alpha - 0.5) * 1.6 + 0.5, 0, 1)

    full = np.zeros((ph, pw), np.float64)
    sx0, sy0 = max(px0, gx0), max(py0, gy0)
    sx1, sy1 = min(px0 + pw, gx1), min(py0 + ph, gy1)
    full[sy0 - py0:sy1 - py0, sx0 - px0:sx1 - px0] = alpha[sy0 - gy0:sy1 - gy0, sx0 - gx0:sx1 - gx0]
    # Only the rectangle itself is cut out (the margin stays clear: the sprite's native pixels end at its edge).
    inner = np.zeros_like(full)
    inner[PAD * HD_Y:(PAD + h) * HD_Y, PAD * HD_X:(PAD + w) * HD_X] = 1
    full *= inner
    crop = np.zeros((ph, pw, 3), np.float64)
    cy0, cx0 = max(0, -py0), max(0, -px0)
    cy1, cx1 = min(ph, painting.height - py0), min(pw, painting.width - px0)
    crop[cy0:cy1, cx0:cx1] = rgb[py0 + cy0:py0 + cy1, px0 + cx0:px0 + cx1]
    out = np.concatenate([crop, full[..., None]], -1)
    img = Image.fromarray(np.round(out * 255).astype(np.uint8), 'RGBA')
    dest = Path(a.out) if a.out else ROOT / 'src' / 'gen' / 'scene' / 'scenery' / f'{a.arena}-cutout'
    dest.parent.mkdir(parents=True, exist_ok=True)
    img.save(dest.with_suffix('.webp'), 'WEBP', lossless=True, quality=100, method=6)
    cells = full[PAD * HD_Y:(PAD + h) * HD_Y, PAD * HD_X:(PAD + w) * HD_X].reshape(h, HD_Y, w, HD_X).mean((1, 3))
    mask = np.zeros((h, w, 4), np.uint8)
    mask[cells >= 0.5] = 255
    Image.fromarray(mask, 'RGBA').save(dest.with_suffix('.png'), optimize=True)
    print(f'{dest}.webp: {pw} x {ph}; {dest}.png: {int((cells >= 0.5).sum())} of {w * h} native pixels cut out')
    if a.preview:
        yy, xx = np.mgrid[0:ph, 0:pw]
        board = np.where(((xx // 12 + yy // 12) % 2)[..., None] == 0, [1.0, 0.2, 0.8], [0.15, 0.9, 0.3])
        prev = crop * full[..., None] + board * (1 - full[..., None])
        Image.fromarray(np.round(prev * 255).astype(np.uint8), 'RGB').save(a.preview)


main()
