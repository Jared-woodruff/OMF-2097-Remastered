"""The credits' computer for the game (src/game/credits/computerRoom.ts): from credits_computer_post.py's finished
folder (computer-on.png, computer-off.png, screen-mask.png, screen-grid.json) and credits_layout.py's layout.json.

Writes into <out> (public/credits/computer):
  room.webp, room-1920.webp   the computer on, its screen's glass dark (as switched off: where the fights' picture does
                              not reach, and when it switches off), at 3840 and 1920 wide
  fill.webp                   the room blurred and small, filling a window of another shape around it
  screen-mask.png             the glass seen through the bezel (white, its alpha the mask), over the screen's 4:3 picture
  glass.webp                  the glass's reflections (the lamp, the room), to lay over the picture (their color, their
                              strength as alpha)
and prints the picture's places for computerRoom.ts: the screen's 4:3 picture (the glass's own corners) and the tower.

Usage: python tools/blender/credits_computer_web.py <finished folder> <out>
"""
import json
import os
import sys

import numpy as np
from PIL import Image, ImageFilter

IN, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
on = Image.open(os.path.join(IN, 'computer-on.png')).convert('RGB')
off = Image.open(os.path.join(IN, 'computer-off.png')).convert('RGB')
mask = Image.open(os.path.join(IN, 'screen-mask.png')).convert('L')
W, H = on.size
grid = json.load(open(os.path.join(IN, 'screen-grid.json')))
layout = json.load(open(os.path.join(IN, 'layout.json')))
pts, C, R = grid['points'], grid['cols'], grid['rows']
corners = [pts[0], pts[C - 1], pts[(R - 1) * C], pts[-1]]
# The picture's rectangle: the glass's corners (its curve bends the middle by under 6 pixels of 3840: a flat rectangle)
x0 = (corners[0][0] + corners[2][0]) / 2
x1 = (corners[1][0] + corners[3][0]) / 2
y0 = (corners[0][1] + corners[1][1]) / 2
y1 = (corners[2][1] + corners[3][1]) / 2

# The room: the glass dark, as switched off
a = np.asarray(mask, np.float32)[..., None] / 255
room = np.asarray(on, np.float32) * (1 - a) + np.asarray(off, np.float32) * a
room = Image.fromarray(np.clip(room + 0.5, 0, 255).astype(np.uint8))
room.save(os.path.join(OUT, 'room.webp'), quality=86, method=6)
room.resize((W // 2, H // 2), Image.LANCZOS).save(os.path.join(OUT, 'room-1920.webp'), quality=86, method=6)
room.resize((W // 20, H // 20), Image.LANCZOS).filter(ImageFilter.GaussianBlur(3)).save(os.path.join(OUT, 'fill.webp'), quality=80)

# Over the picture: the mask, and the glass's reflections (what the dark glass shows above its own black)
size = (round(x1 - x0), round(y1 - y0))
crop = lambda im, resample: im.transform(size, Image.EXTENT, (x0, y0, x1, y1), resample)
m = crop(mask, Image.BICUBIC).point(lambda v: 0 if v < 4 else 255 if v > 251 else v)
white = Image.new('L', size, 255)
Image.merge('RGBA', (white, white, white, m)).save(os.path.join(OUT, 'screen-mask.png'), optimize=True)
# (soft and at half size: the reflections are blurry, and the film grain stays out of them)
half = (size[0] // 2, size[1] // 2)
g = np.asarray(off.transform(half, Image.EXTENT, (x0, y0, x1, y1), Image.BICUBIC).filter(ImageFilter.GaussianBlur(2.5)), np.float32) / 255
refl = np.clip((g - 0.035) * 0.7, 0, 1)
# (only on the glass: not the sticky note's paper, nor the bezel round its corners)
glass_mask = np.asarray(m.resize(half, Image.BILINEAR), np.float32)[..., None] / 255
alpha = refl.max(axis=2, keepdims=True) * glass_mask
refl = refl * glass_mask
color = np.where(alpha > 1e-4, refl / np.maximum(alpha, 1e-4), 0)
glass = np.concatenate([color, alpha], axis=2)
Image.fromarray((glass * 255 + 0.5).astype(np.uint8), 'RGBA').save(os.path.join(OUT, 'glass.webp'), quality=90, method=6)

f = lambda v: round(v, 5)
places = {
    'size': [W, H],
    'screen': {'x': f(x0 / W), 'y': f(y0 / H), 'w': f((x1 - x0) / W), 'h': f((y1 - y0) / H)},
    'tower': layout['panel'],
    'credit': layout['text'],
}
print(json.dumps(places))
for name in sorted(os.listdir(OUT)):
    print(f'{name}: {os.path.getsize(os.path.join(OUT, name)) // 1024} KB')
