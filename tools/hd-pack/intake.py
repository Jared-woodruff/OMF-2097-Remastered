"""HD asset import, step 2: turns the delivered *.hd.png files of the asset pack into runtime bundles.

Every image is resampled to its target size (5x wide, 6x tall per native pixel, in linear light with premultiplied
alpha), trimmed to its visible area and packed into texture atlases (WebP) per bundle: one per scene, per robot,
plus shared effects, arena graphics and portraits. Backgrounds and widescreen canvases are stored as whole images.
Writes <out>/index.json and the bundle files. Requires <pack>/intake_meta.json (tools/hd-pack/intake-meta.test.ts).

Bundles whose inputs did not change since the last import are kept (use --force to rebuild everything).

Usage: python tools/hd-pack/intake.py <pack folder> <output folder> [--quality 90] [--force] [--bundles a,b]
"""
import hashlib
import argparse
import base64
import json
import os
import shutil
import sys
import time
from multiprocessing import Pool

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
# Bump when the processing changes, so incremental imports rebuild every bundle.
BUILD_VERSION = 2
PAGE_MAX = 4096
# Gap between atlas images; half of it on each side is filled with the image's edge pixels (so mipmaps and filtering
# near an edge see the edge color, not the neighbor or transparency).
GUTTER = 8
EXTRUDE = GUTTER // 2


def srgb_to_linear(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(c):
    c = np.clip(c, 0.0, 1.0)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def resize_rgba(arr, w, h):
    """High-quality resize of an RGBA uint8 array: linear light, premultiplied alpha, Lanczos."""
    a = arr.astype(np.float32) / 255.0
    if a.shape[1] == w and a.shape[0] == h:
        return arr.copy()
    lin = srgb_to_linear(a[..., :3])
    alpha = a[..., 3]
    pm = lin * alpha[..., None]
    chans = [pm[..., 0], pm[..., 1], pm[..., 2], alpha]
    out = [np.asarray(Image.fromarray(np.ascontiguousarray(c), 'F').resize((w, h), Image.LANCZOS)) for c in chans]
    al = np.clip(out[3], 0.0, 1.0)
    safe = np.maximum(al, 1e-4)
    rgb = np.stack([out[0] / safe, out[1] / safe, out[2] / safe], -1)
    rgb = linear_to_srgb(rgb)
    res = np.concatenate([rgb, al[..., None]], -1)
    res = np.round(res * 255.0).astype(np.uint8)
    res[al < 1.0 / 255.0] = 0
    return res


def load_rgba(path):
    im = Image.open(path)
    im.load()
    return np.array(im.convert('RGBA'))


def process_sprite(args):
    """Resize one sprite image to its target size and trim its transparent border."""
    pack, e = args
    arr = load_rgba(os.path.join(pack, e['output']))
    arr = resize_rgba(arr, e['width'], e['height'])
    if not e['transparent']:
        arr[..., 3] = 255
    ys, xs = np.nonzero(arr[..., 3] > 0)
    if len(ys) == 0:
        tx = ty = 0
        crop = np.zeros((1, 1, 4), np.uint8)
    else:
        tx, ty = int(xs.min()), int(ys.min())
        crop = arr[ty:ys.max() + 1, tx:xs.max() + 1]
    return e['job'], tx, ty, np.ascontiguousarray(crop)


def process_background(args):
    pack, e = args
    arr = load_rgba(os.path.join(pack, e['output']))
    arr = resize_rgba(arr, e['width'], e['height'])[..., :3]
    wide = None
    if e.get('wide'):
        w = e['wide']
        warr = load_rgba(os.path.join(pack, w['output']))
        wide = resize_rgba(warr, w['width'], w['height'])[..., :3]
        # The center of the canvas is the background itself: use exactly the (resampled) background there.
        x0 = (wide.shape[1] - arr.shape[1]) // 2
        wide[:, x0:x0 + arr.shape[1]] = arr
    return e['job'], arr, wide


class Packer:
    """Shelf packer into pages of up to PAGE_MAX x PAGE_MAX."""

    def __init__(self):
        self.pages = []  # [ [shelves], width, height ]

    def pack(self, sizes):
        """sizes: list of (key, w, h). Returns {key: (page, x, y)} and page sizes."""
        order = sorted(sizes, key=lambda s: (-s[2], -s[1]))
        placed = {}
        E = EXTRUDE
        pages = []  # each: {'shelves': [[y, h, x]], 'h': used height}
        for key, w, h in order:
            W, H = w + GUTTER, h + GUTTER
            if W > PAGE_MAX or H > PAGE_MAX:
                raise ValueError(f'image too large for an atlas page: {key} {w}x{h}')
            done = False
            for pi, pg in enumerate(pages):
                for sh in pg['shelves']:
                    if sh[1] >= H and sh[2] + W <= PAGE_MAX:
                        placed[key] = (pi, sh[2] + E, sh[0] + E)
                        sh[2] += W
                        done = True
                        break
                if done:
                    break
                if pg['h'] + H <= PAGE_MAX:
                    pg['shelves'].append([pg['h'], H, W])
                    placed[key] = (pi, E, pg['h'] + E)
                    pg['h'] += H
                    done = True
                    break
            if not done:
                pages.append({'shelves': [[0, H, W]], 'h': H})
                placed[key] = (len(pages) - 1, E, E)
        sizes_out = []
        for pi, pg in enumerate(pages):
            used_w = max(sh[2] for sh in pg['shelves'])
            sizes_out.append((min(PAGE_MAX, used_w), pg['h']))
        return placed, sizes_out


def upscale_mask(mask, w, h, W, H):
    """Soft upscale of a native 0/1 mask to W x H (bilinear)."""
    m = Image.fromarray((mask.reshape(h, w) * 255).astype(np.uint8), 'L')
    return np.asarray(m.resize((W, H), Image.BILINEAR))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('pack')
    ap.add_argument('out')
    ap.add_argument('--quality', type=int, default=90)
    ap.add_argument('--bundles', default='', help='comma-separated bundle names to (re)build (default: all changed)')
    ap.add_argument('--force', action='store_true', help='rebuild every bundle')
    args = ap.parse_args()
    pack = os.path.abspath(args.pack)
    out = os.path.abspath(args.out)
    meta = json.load(open(os.path.join(pack, 'intake_meta.json'), encoding='utf-8'))
    sx, sy = meta['scale']['x'], meta['scale']['y']
    only = set(filter(None, args.bundles.split(',')))
    os.makedirs(out, exist_ok=True)
    index_path = os.path.join(out, 'index.json')
    index = {'format': 'omf2097-hd-assets', 'version': 1, 'scale': meta['scale'], 'palettes': meta['palettes'],
             'bundles': {}, 'entries': []}
    prev = None
    # (the bundles of the last import: their folders are the importer's to replace or remove)
    old_bundles = set(json.load(open(index_path, encoding='utf-8'))['bundles']) if os.path.exists(index_path) else set()
    if os.path.exists(index_path) and not args.force:
        prev = json.load(open(index_path, encoding='utf-8'))
        if prev.get('palettes') != meta['palettes']:
            prev = None  # palette table changed: entry palette ids are not comparable, rebuild everything
    if only and prev is None:
        # (the bundles not named would be dropped)
        sys.exit('--bundles needs the previous import with the same palette table: import everything (without --bundles)')

    by_bundle = {}
    for e in meta['entries']:
        by_bundle.setdefault(e['bundle'], []).append(e)
    derived_by_bundle = {}
    for d in meta['derived']:
        derived_by_bundle.setdefault(d['bundle'], []).append(d)
    jobs_by_id = {e['job']: e for e in meta['entries']}

    def signature(bundle):
        """Hash of everything a bundle is built from: its entries, their image files (size + mtime), derived items."""
        h = hashlib.sha1(f'{BUILD_VERSION}:{args.quality}'.encode())
        for e in sorted(by_bundle.get(bundle, []), key=lambda x: x['job']):
            h.update(json.dumps(e, sort_keys=True).encode())
            for path in [e['output']] + ([e['wide']['output']] if e.get('wide') else []):
                st = os.stat(os.path.join(pack, path))
                h.update(f'{path}:{st.st_size}:{st.st_mtime_ns}'.encode())
        for d in derived_by_bundle.get(bundle, []):
            h.update(json.dumps(d, sort_keys=True).encode())
            if d.get('source'):
                st = os.stat(os.path.join(pack, d['source']))
                h.update(f"{d['source']}:{st.st_size}:{st.st_mtime_ns}".encode())
        return h.hexdigest()

    t0 = time.time()
    total_bytes = 0
    with Pool(max(1, (os.cpu_count() or 4) - 2)) as pool:
        for bundle in sorted(by_bundle):
            sig = signature(bundle)
            bdir = os.path.join(out, bundle)
            keep = prev is not None and (bundle not in only if only else prev['bundles'].get(bundle, {}).get('sig') == sig) \
                and bundle in prev['bundles'] and os.path.isdir(bdir)
            if keep:
                # (With --bundles, the other bundles are declared current: their inputs are recorded as built.)
                index['bundles'][bundle] = {**prev['bundles'][bundle], 'sig': sig}
                index['entries'].extend(e for e in prev['entries'] if e['bundle'] == bundle)
                total_bytes += prev['bundles'][bundle].get('bytes', 0)
                continue
            if only and bundle not in only:
                continue
            if os.path.exists(bdir):
                shutil.rmtree(bdir)
            os.makedirs(bdir)
            entries = by_bundle[bundle]
            bgs = [e for e in entries if e['kind'] == 'background']
            sprites = [e for e in entries if e['kind'] != 'background']
            binfo = {'pages': [], 'images': []}
            # Backgrounds (+ widescreen canvases): whole images.
            bg_arrays = {}
            for job, arr, wide in pool.imap_unordered(process_background, [(pack, e) for e in bgs]):
                e = jobs_by_id[job]
                name = f"bg_{len(binfo['images'])}.webp"
                Image.fromarray(arr, 'RGB').save(os.path.join(bdir, name), 'WEBP', quality=min(100, args.quality + 2), method=6)
                img = {'file': name, 'w': arr.shape[1], 'h': arr.shape[0]}
                binfo['images'].append(img)
                entry = {'hash': e['hash'], 'bundle': bundle, 'kind': 'background', 'image': len(binfo['images']) - 1,
                         'palette': e['palette'], 'files': e['files'], 'native': e['native']}
                if wide is not None:
                    wname = f"wide_{len(binfo['images'])}.webp"
                    Image.fromarray(wide, 'RGB').save(os.path.join(bdir, wname), 'WEBP', quality=min(100, args.quality + 2), method=6)
                    binfo['images'].append({'file': wname, 'w': wide.shape[1], 'h': wide.shape[0]})
                    entry['wide'] = len(binfo['images']) - 1
                index['entries'].append(entry)
                bg_arrays[e['files'][0]] = arr
            # Sprites.
            crops = {}
            for job, tx, ty, crop in pool.imap_unordered(process_sprite, [(pack, e) for e in sprites], chunksize=2):
                crops[job] = (tx, ty, crop)
            # Derived images of this bundle.
            derived = []
            for i, d in enumerate(derived_by_bundle.get(bundle, [])):
                key = f'derived:{i}'
                n = d['native']
                if d['kind'] == 'bg-patch':
                    r = d['region']
                    src_file = d['files'][0]
                    bg = bg_arrays.get(src_file)
                    if bg is None:
                        bg = resize_rgba(load_rgba(os.path.join(pack, d['source'])), 320 * sx, 200 * sy)[..., :3]
                    W, H = r['w'] * sx, r['h'] * sy
                    rgb = bg[r['y'] * sy:r['y'] * sy + H, r['x'] * sx:r['x'] * sx + W]
                    mask = np.frombuffer(base64.b64decode(d['mask']), np.uint8)
                    alpha = upscale_mask(mask, n['w'], n['h'], W, H)
                    arr = np.concatenate([rgb, alpha[..., None]], -1)
                    crops[key] = (0, 0, np.ascontiguousarray(arr))
                    derived.append((key, d, W, H))
                elif d['kind'] == 'composite':
                    pad = n['pad']
                    W, H = (n['w'] + 2 * pad) * sx, (n['h'] + 2 * pad) * sy
                    canvas = Image.new('RGBA', (W, H))
                    for part in d['parts']:
                        pe = jobs_by_id[part['job']]
                        ptx, pty, pcrop = crops.get(part['job']) or process_sprite((pack, pe))[1:]
                        ppad = pe['native']['pad']
                        px = (part['x'] + pad - ppad) * sx + ptx
                        py = (part['y'] + pad - ppad) * sy + pty
                        canvas.alpha_composite(Image.fromarray(pcrop, 'RGBA'), (px, py))
                    arr = np.asarray(canvas)
                    ys, xs = np.nonzero(arr[..., 3] > 0)
                    tx, ty = int(xs.min()), int(ys.min())
                    crops[key] = (tx, ty, np.ascontiguousarray(arr[ty:ys.max() + 1, tx:xs.max() + 1]))
                    derived.append((key, d, W, H))
            if crops:
                sizes = [(k, c[2].shape[1], c[2].shape[0]) for k, c in crops.items()]
                placed, page_sizes = Packer().pack(sizes)
                pages = [np.zeros((h, w, 4), np.uint8) for (w, h) in page_sizes]
                E = EXTRUDE
                for k, (pi, x, y) in placed.items():
                    c = crops[k][2]
                    # The image plus its edge pixels repeated EXTRUDE times on every side.
                    ext = np.pad(c, ((E, E), (E, E), (0, 0)), mode='edge')
                    pg = pages[pi]
                    y0, x0 = y - E, x - E
                    y1, x1 = min(pg.shape[0], y0 + ext.shape[0]), min(pg.shape[1], x0 + ext.shape[1])
                    pg[y0:y1, x0:x1] = ext[:y1 - y0, :x1 - x0]
                for pi, pg in enumerate(pages):
                    name = f'page_{pi}.webp'
                    Image.fromarray(pg, 'RGBA').save(os.path.join(bdir, name), 'WEBP', quality=args.quality, method=6,
                                                     alpha_quality=100)
                    binfo['pages'].append({'file': name, 'w': pg.shape[1], 'h': pg.shape[0]})
                for e in sprites:
                    tx, ty, c = crops[e['job']]
                    pi, x, y = placed[e['job']]
                    index['entries'].append({
                        'hash': e['hash'], 'bundle': bundle, 'kind': e['kind'], 'page': pi, 'x': x, 'y': y,
                        'w': c.shape[1], 'h': c.shape[0], 'tx': tx, 'ty': ty, 'fw': e['width'], 'fh': e['height'],
                        'pad': e['native']['pad'], 'palette': e['palette'], 'files': e['files'], 'recolor': e['recolor'],
                    })
                for key, d, W, H in derived:
                    tx, ty, c = crops[key]
                    pi, x, y = placed[key]
                    index['entries'].append({
                        'hash': d['hash'], 'bundle': bundle, 'kind': d['kind'], 'page': pi, 'x': x, 'y': y,
                        'w': c.shape[1], 'h': c.shape[0], 'tx': tx, 'ty': ty, 'fw': W, 'fh': H,
                        'pad': d['native']['pad'], 'palette': d['palette'], 'files': d['files'], 'recolor': 'none',
                    })
            size = sum(os.path.getsize(os.path.join(bdir, f)) for f in os.listdir(bdir))
            total_bytes += size
            binfo['bytes'] = size
            binfo['pixels'] = sum(p['w'] * p['h'] for p in binfo['pages']) + sum(i['w'] * i['h'] for i in binfo['images'])
            binfo['sig'] = sig
            index['bundles'][bundle] = binfo
            print(f"{bundle:18s} {len(entries):4d} images  {len(binfo['pages'])} page(s)  {size / 1e6:6.1f} MB  "
                  f"{binfo['pixels'] / 1e6:6.1f} MP  ({time.time() - t0:.0f}s)", flush=True)
    with open(index_path, 'w', encoding='utf-8') as f:
        json.dump(index, f, separators=(',', ':'))
    # Bundles that no longer exist in the pack (other folders, e.g. the main menu's layers, are not the importer's).
    for name in old_bundles - set(index['bundles']):
        if os.path.isdir(os.path.join(out, name)):
            shutil.rmtree(os.path.join(out, name))
    print(f'done: {len(index["entries"])} entries in {len(index["bundles"])} bundles, {total_bytes / 1e6:.1f} MB, {time.time() - t0:.0f}s')


if __name__ == '__main__':
    sys.exit(main())
