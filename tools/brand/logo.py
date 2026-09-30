"""The remaster's logo lettering (as in the trailer): chrome ONE MUST FALL, a burning 2097 and REMASTERED, glowing, on
transparency. Written to public/brand/logo.webp for the loading screen and the first start's setup screen.

Needs Windows' Bahnschrift font (C:/Windows/Fonts/bahnschrift.ttf), Pillow and numpy.
Usage: python tools/brand/logo.py
"""
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'public', 'brand', 'logo.webp')
FONT = 'C:/Windows/Fonts/bahnschrift.ttf'

CHROME = [(0.0, (250, 252, 255)), (0.38, (205, 214, 228)), (0.5, (255, 255, 255)), (0.53, (62, 72, 92)),
          (0.7, (140, 152, 172)), (0.9, (225, 232, 242)), (1.0, (150, 160, 180))]
HOT = [(0.0, (255, 250, 210)), (0.35, (255, 214, 90)), (0.6, (255, 120, 30)), (1.0, (200, 30, 10))]


def font(size, style='Bold Condensed'):
    f = ImageFont.truetype(FONT, size)
    f.set_variation_by_name(style)
    return f


def text_mask(text, fnt, tracking=0):
    """Anti-aliased coverage mask (L) of a line of text, with extra letter spacing."""
    widths = [fnt.getbbox(ch)[2] for ch in text]
    asc, desc = fnt.getmetrics()
    m = Image.new('L', (int(sum(widths) + tracking * (len(text) - 1)) + 8, asc + desc + 8), 0)
    d = ImageDraw.Draw(m)
    x = 4
    for ch, cw in zip(text, widths):
        d.text((x, 4), ch, font=fnt, fill=255)
        x += cw + tracking
    bbox = m.getbbox()
    return m.crop(bbox) if bbox else m


def gradient(h, stops):
    ys = np.linspace(0, 1, h)
    out = np.zeros((h, 3), np.float32)
    for c in range(3):
        out[:, c] = np.interp(ys, [s[0] for s in stops], [s[1][c] for s in stops])
    return out


def styled(text, fnt, fill, tracking=0, outline=3, outline_color=(14, 16, 24), glow=None, glow_radius=14, glow_strength=0.9,
           bevel=True):
    """Gradient-filled lettering with a bevel, a dark outline and a colored glow (RGBA)."""
    m = text_mask(text, fnt, tracking)
    pad = max(glow_radius * 3 if glow else 0, 24)
    w, h = m.width + 2 * pad, m.height + 2 * pad
    mask = Image.new('L', (w, h), 0)
    mask.paste(m, (pad, pad))
    a = np.asarray(mask, np.float32) / 255.0
    out = np.zeros((h, w, 4), np.float32)

    def over(rgb, alpha):
        out[..., :3] = rgb * alpha[..., None] + out[..., :3] * (1 - alpha[..., None])
        out[..., 3] = alpha + out[..., 3] * (1 - alpha)

    if glow:
        g = mask.filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.GaussianBlur(glow_radius))
        over(np.broadcast_to(np.array(glow, np.float32) / 255.0, (h, w, 3)).copy(),
             np.clip(np.asarray(g, np.float32) / 255.0 * 1.6, 0, 1) * glow_strength)
    if outline:
        ol = mask.filter(ImageFilter.MaxFilter(outline * 2 + 1))
        over(np.broadcast_to(np.array(outline_color, np.float32) / 255.0, (h, w, 3)).copy(), np.asarray(ol, np.float32) / 255.0)
    ys = np.nonzero(a.max(axis=1) > 0.1)[0]
    y0, y1 = (ys[0], ys[-1]) if len(ys) else (0, h - 1)
    grad = np.zeros((h, 3), np.float32)
    grad[y0:y1 + 1] = gradient(y1 - y0 + 1, fill) / 255.0
    grad[:y0] = grad[y0]
    grad[y1 + 1:] = grad[y1]
    rgb = np.broadcast_to(grad[:, None, :], (h, w, 3)).copy()
    if bevel:
        b = np.asarray(mask.filter(ImageFilter.GaussianBlur(2.2)), np.float32) / 255.0
        light = np.roll(b, (2, 2), axis=(0, 1)) - np.roll(b, (-2, -2), axis=(0, 1))
        rgb = np.clip(rgb - light[..., None] * 0.55, 0, 1)
    over(rgb, a)
    rgba = np.zeros((h, w, 4), np.uint8)
    alpha = np.clip(out[..., 3], 1e-6, 1)
    rgba[..., :3] = np.clip(out[..., :3] / alpha[..., None] * 255, 0, 255)
    rgba[..., 3] = np.clip(out[..., 3] * 255, 0, 255)
    img = Image.fromarray(rgba, 'RGBA')
    return img.crop(img.getbbox())


def logo(s=1.0):
    t1 = styled('ONE MUST FALL', font(int(178 * s)), CHROME, tracking=4, outline=5, glow=(40, 90, 255), glow_radius=22,
                glow_strength=0.55)
    t2 = styled('2097', font(int(226 * s)), HOT, tracking=14, outline=6, outline_color=(40, 6, 2), glow=(255, 60, 10),
                glow_radius=30, glow_strength=0.95)
    t3 = styled('R E M A S T E R E D', font(int(64 * s), 'SemiBold'), [(0, (235, 245, 255)), (1, (235, 245, 255))],
                tracking=8, outline=0, glow=(90, 170, 255), glow_radius=14, glow_strength=0.8, bevel=False)
    w = max(t1.width, t2.width, t3.width)
    y2 = t1.height - int(58 * s)
    y3 = y2 + t2.height - int(96 * s)
    img = Image.new('RGBA', (w, y3 + t3.height), (0, 0, 0, 0))
    img.alpha_composite(t2, ((w - t2.width) // 2, y2))
    img.alpha_composite(t1, ((w - t1.width) // 2, 0))
    img.alpha_composite(t3, ((w - t3.width) // 2, y3))
    return img.crop(img.getbbox())


if __name__ == '__main__':
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    img = logo(1.0)
    img.save(OUT, 'WEBP', quality=90, method=6)
    print(os.path.relpath(OUT, ROOT), img.size, os.path.getsize(OUT) // 1024, 'KB')
