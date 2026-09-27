"""Validates the delivered HD images of the asset pack against their sources.

For every job: size / aspect, transparency agreement with the source silhouette, color agreement (the HD image
scaled down to the source size vs the source), and for robot-colored images whether the blue / red / gold zones
kept their hue. Writes hd-pack/validation.json and prints a summary.

Usage: python tools/hd-pack/validate.py [hd-pack folder]
"""
import json
import os
import sys
from multiprocessing import Pool

import numpy as np
from PIL import Image

PACK = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else 'hd-pack')

# Reference robot color ramps (ALTPALS palette 0 ramps 0 / 1 / 13), used to classify source pixels into zones.
REF_HUES = {'primary': 205.0, 'secondary': 350.0, 'tertiary': 45.0}


def rgb_to_hsv(rgb):
    """rgb: float array (..., 3) in 0..1 -> hue degrees, saturation, value."""
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx = rgb.max(-1)
    mn = rgb.min(-1)
    d = mx - mn
    h = np.zeros_like(mx)
    m = d > 1e-6
    rc = np.where(m, (mx - r) / np.where(m, d, 1), 0)
    gc = np.where(m, (mx - g) / np.where(m, d, 1), 0)
    bc = np.where(m, (mx - b) / np.where(m, d, 1), 0)
    h = np.where(r == mx, bc - gc, np.where(g == mx, 2.0 + rc - bc, 4.0 + gc - rc))
    h = (h / 6.0) % 1.0 * 360.0
    s = np.where(mx > 1e-6, d / np.where(mx > 1e-6, mx, 1), 0)
    return np.where(m, h, 0), s, mx


def hue_dist(a, b):
    d = np.abs(a - b) % 360
    return np.minimum(d, 360 - d)


def downscale(img, w, h):
    """Area-average downscale of an RGBA float image (premultiplied) to w x h."""
    H, W = img.shape[:2]
    out = np.zeros((h, w, img.shape[2]), np.float64)
    ys = np.linspace(0, H, h + 1)
    xs = np.linspace(0, W, w + 1)
    # Integral image for exact box averages.
    ii = np.zeros((H + 1, W + 1, img.shape[2]))
    ii[1:, 1:] = img.cumsum(0).cumsum(1)

    def box(y0, y1, x0, x1):
        # fractional box via bilinear interpolation of the integral image
        def I(y, x):
            yi, xi = np.floor(y).astype(int), np.floor(x).astype(int)
            yi = np.clip(yi, 0, H - 1)
            xi = np.clip(xi, 0, W - 1)
            fy, fx = y - yi, x - xi
            a = ii[yi, xi]
            b = ii[yi, xi + 1]
            c = ii[yi + 1, xi]
            d = ii[yi + 1, xi + 1]
            return (a * (1 - fy)[..., None] * (1 - fx)[..., None] + b * (1 - fy)[..., None] * fx[..., None]
                    + c * fy[..., None] * (1 - fx)[..., None] + d * fy[..., None] * fx[..., None])
        return I(y1, x1) - I(y0, x1) - I(y1, x0) + I(y0, x0)

    Y0, X0 = np.meshgrid(ys[:-1], xs[:-1], indexing='ij')
    Y1, X1 = np.meshgrid(ys[1:], xs[1:], indexing='ij')
    area = (Y1 - Y0) * (X1 - X0)
    out = box(Y0, Y1, X0, X1) / area[..., None]
    return out


def check(job):
    res = {'id': job['id'], 'output': job['output'], 'tier': job['tier'], 'kind': job['id'].split('/')[0]}
    out_path = os.path.join(PACK, job['output'])
    src_path = os.path.join(PACK, job['source'])
    if not os.path.exists(out_path):
        res['missing'] = True
        return res
    try:
        hd = Image.open(out_path)
        hd.load()
    except Exception as e:  # noqa: BLE001
        res['error'] = str(e)
        return res
    res['size'] = list(hd.size)
    res['mode'] = hd.mode
    W, H = job['width'], job['height']
    res['scale'] = round(hd.size[0] / W, 3)
    res['aspect_err'] = round(abs((hd.size[0] / hd.size[1]) / (W / H) - 1), 4)
    src = Image.open(src_path).convert('RGBA')
    sw, sh = src.size
    # Widescreen canvas: the source has transparent sides; compare only the opaque center.
    s = np.asarray(src, np.float64) / 255.0
    h = np.asarray(hd.convert('RGBA'), np.float64) / 255.0
    hp = h.copy()
    hp[..., :3] *= hp[..., 3:4]
    small = downscale(hp, sw, sh)
    a_small = small[..., 3]
    rgb_small = np.where(a_small[..., None] > 1e-3, small[..., :3] / np.maximum(a_small[..., None], 1e-3), 0)
    src_a = s[..., 3] > 0.5
    if job['transparent']:
        hd_a = a_small > 0.5
        inter = np.logical_and(src_a, hd_a).sum()
        union = np.logical_or(src_a, hd_a).sum()
        res['alpha_iou'] = round(float(inter / union) if union else 1.0, 4)
        # opaque in HD where the source is transparent, more than one pixel away from the silhouette
        from_src = src_a.copy()
        dil = from_src.copy()
        dil[1:, :] |= from_src[:-1, :]
        dil[:-1, :] |= from_src[1:, :]
        dil[:, 1:] |= from_src[:, :-1]
        dil[:, :-1] |= from_src[:, 1:]
        res['spill'] = round(float(np.logical_and(a_small > 0.5, ~dil).sum() / max(1, src_a.sum())), 4)
        ero = from_src.copy()
        ero[1:, :] &= from_src[:-1, :]
        ero[:-1, :] &= from_src[1:, :]
        ero[:, 1:] &= from_src[:, :-1]
        ero[:, :-1] &= from_src[:, 1:]
        res['holes'] = round(float(np.logical_and(ero, a_small < 0.5).sum() / max(1, ero.sum())), 4)
        # alpha channel present at all and has partial values (soft edges)
        res['alpha_levels'] = int(len(np.unique((h[..., 3] * 255).astype(np.uint8))))
    cmp_mask = src_a & (a_small > 0.5)
    if cmp_mask.sum() > 0:
        d = np.abs(rgb_small - s[..., :3])[cmp_mask]
        res['color_mae'] = round(float(d.mean() * 255), 2)
        # brightness difference (mean luminance ratio)
        lum = lambda c: c[..., 0] * 0.299 + c[..., 1] * 0.587 + c[..., 2] * 0.114  # noqa: E731
        res['lum_src'] = round(float(lum(s[..., :3])[cmp_mask].mean() * 255), 1)
        res['lum_hd'] = round(float(lum(rgb_small)[cmp_mask].mean() * 255), 1)
        if job.get('recolored_in_game'):
            hs, ss, vs = rgb_to_hsv(s[..., :3])
            hh, sh_, vh = rgb_to_hsv(rgb_small)
            zres = {}
            for zone, zh in REF_HUES.items():
                zm = cmp_mask & (ss > 0.35) & (vs > 0.15) & (hue_dist(hs, zh) < 25)
                n = int(zm.sum())
                if n >= 8:
                    ok = (hue_dist(hh[zm], zh) < 30) & (sh_[zm] > 0.2)
                    zres[zone] = {'n': n, 'kept': round(float(ok.mean()), 3)}
            res['zones'] = zres
    return res


def main():
    jobs = [json.loads(line) for line in open(os.path.join(PACK, 'jobs.jsonl'), encoding='utf-8')]
    with Pool(max(1, os.cpu_count() - 2)) as pool:
        results = pool.map(check, jobs, chunksize=4)
    with open(os.path.join(PACK, 'validation.json'), 'w', encoding='utf-8') as f:
        json.dump(results, f, indent=1)
    # Summary
    missing = [r for r in results if r.get('missing')]
    errors = [r for r in results if r.get('error')]
    aspect = [r for r in results if r.get('aspect_err', 0) > 0.01]
    small = [r for r in results if r.get('scale', 1) < 0.999]
    print(f'jobs {len(results)}  missing {len(missing)}  unreadable {len(errors)}  aspect>1% {len(aspect)}  smaller-than-target {len(small)}')
    scales = sorted({r.get('scale') for r in results if 'scale' in r})
    print('scales:', scales[:20])
    tr = [r for r in results if 'alpha_iou' in r]
    if tr:
        ious = np.array([r['alpha_iou'] for r in tr])
        print(f'alpha IoU: median {np.median(ious):.3f}  p5 {np.percentile(ious, 5):.3f}  min {ious.min():.3f}  <0.8: {(ious < 0.8).sum()}  <0.9: {(ious < 0.9).sum()}')
        sp = np.array([r['spill'] for r in tr])
        print(f'spill: median {np.median(sp):.4f}  p95 {np.percentile(sp, 95):.4f}  >0.05: {(sp > 0.05).sum()}')
        ho = np.array([r['holes'] for r in tr])
        print(f'holes: median {np.median(ho):.4f}  p95 {np.percentile(ho, 95):.4f}  >0.05: {(ho > 0.05).sum()}')
        hard = [r for r in tr if r['alpha_levels'] <= 2]
        print(f'binary alpha (no soft edges): {len(hard)}')
    cm = np.array([r['color_mae'] for r in results if 'color_mae' in r])
    print(f'color MAE (0-255): median {np.median(cm):.1f}  p95 {np.percentile(cm, 95):.1f}  max {cm.max():.1f}  >30: {(cm > 30).sum()}')
    zk = [(r['id'], z, v) for r in results for z, v in r.get('zones', {}).items()]
    if zk:
        kept = np.array([v['kept'] for _, _, v in zk])
        print(f'robot color zones kept: median {np.median(kept):.3f}  p5 {np.percentile(kept, 5):.3f}  <0.8: {(kept < 0.8).sum()} of {len(kept)}')
    by_kind = {}
    for r in results:
        by_kind.setdefault(r['kind'], []).append(r)
    for k, rs in by_kind.items():
        c = [r['color_mae'] for r in rs if 'color_mae' in r]
        i = [r['alpha_iou'] for r in rs if 'alpha_iou' in r]
        print(f'  {k:10s} n={len(rs):5d}  color MAE median {np.median(c) if c else 0:.1f}  IoU median {np.median(i) if i else 1:.3f}')


if __name__ == '__main__':
    main()
