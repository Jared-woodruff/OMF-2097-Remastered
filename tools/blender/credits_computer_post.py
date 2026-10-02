"""The credits' computer, finished: tools/blender/credits_computer.py's renders with a film look, and what the game
needs to put the fights on its screen.

From <in> (on.png, off.png, screen-mask.png, screen-uv.png) into <out>:
  computer-on.png      the computer on, a gentle glow around its lights and its screen, film grain, a vignette
  computer-off.png     the same, switched off
  computer-green.png   computer-on.png with the screen's glass flat chroma green (#00FF00), for keying in other tools
  screen-mask.png      the screen's glass (8-bit alpha, anti-aliased): where the fights go
  screen-uv.png        the glass's own coordinates (16-bit: red = across 0..1, green = up 0..1), to warp a picture onto
                       its curve
  screen.json          the screen's box in pixels and as fractions of the picture, and the files' sizes

Usage: python tools/blender/credits_computer_post.py <in> <out>
"""
import json
import os
import shutil
import sys

import numpy as np
from PIL import Image, ImageFilter

IN, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)


def load(name):
    return np.asarray(Image.open(os.path.join(IN, name)).convert('RGB'), np.float32) / 255


def glow(img, threshold=0.72, radius=0.012, amount=0.35):
    """Bright parts bleeding into the air around them (a lens's veiling glow): the highlights over `threshold`,
    blurred by `radius` of the picture's width, added back."""
    h, w, _ = img.shape
    hi = np.clip((img - threshold) / (1 - threshold), 0, 1) ** 1.5
    pic = Image.fromarray((hi * 255).astype(np.uint8))
    wide = np.asarray(pic.filter(ImageFilter.GaussianBlur(w * radius)), np.float32) / 255
    near = np.asarray(pic.filter(ImageFilter.GaussianBlur(w * radius * 0.25)), np.float32) / 255
    return img + amount * (0.6 * wide + 0.4 * near)


def vignette(img, strength=0.28):
    h, w, _ = img.shape
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    d = ((xx - w / 2) / (w / 2)) ** 2 + ((yy - h / 2) / (h / 2)) ** 2
    return img * (1 - strength * np.clip(d / 2, 0, 1) ** 1.3)[..., None]


def grain(img, amount=0.018, seed=7):
    """Film grain: fine, a little coarser in the shadows."""
    h, w, _ = img.shape
    rng = np.random.default_rng(seed)
    g = rng.normal(0, 1, (h // 2, w // 2)).astype(np.float32)
    g = np.asarray(Image.fromarray(((g * 0.25 + 0.5).clip(0, 1) * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC), np.float32) / 255 - 0.5
    lum = img.mean(axis=2, keepdims=True)
    return img + amount * 4 * g[..., None] * (1.2 - 0.7 * lum)


def finish(img, seed):
    return np.clip(grain(vignette(glow(img)), seed=seed), 0, 1)


def save(img, name):
    Image.fromarray((img * 255 + 0.5).astype(np.uint8)).save(os.path.join(OUT, name), optimize=True)
    print('wrote', name)


on, off = load('on.png'), load('off.png')
mask = np.asarray(Image.open(os.path.join(IN, 'screen-mask.png')).convert('L'), np.float32) / 255
on_f = finish(on, 7)
off_f = finish(off, 7)
save(on_f, 'computer-on.png')
save(off_f, 'computer-off.png')
# (the green exactly flat inside the glass; its edge anti-aliased by the mask)
a = mask[..., None]
green = on_f * (1 - a) + np.array([0.0, 1.0, 0.0], np.float32) * a
save(green, 'computer-green.png')
Image.fromarray((mask * 255 + 0.5).astype(np.uint8)).save(os.path.join(OUT, 'screen-mask.png'), optimize=True)
shutil.copyfile(os.path.join(IN, 'screen-uv.png'), os.path.join(OUT, 'screen-uv.png'))
h, w = mask.shape
ys, xs = np.where(mask > 0.5)
box = {'x0': int(xs.min()), 'y0': int(ys.min()), 'x1': int(xs.max()) + 1, 'y1': int(ys.max()) + 1}
info = {
    'size': [w, h],
    'screen': {**box, 'fraction': [round(box['x0'] / w, 4), round(box['y0'] / h, 4), round(box['x1'] / w, 4), round(box['y1'] / h, 4)]},
    'uv': 'screen-uv.png: 16-bit RGB, red = u (0 left .. 1 right), green = v (0 bottom .. 1 top) across the bezel\'s 4:3 opening',
}
with open(os.path.join(OUT, 'screen.json'), 'w') as f:
    json.dump(info, f, indent=1)
print(json.dumps(info))
