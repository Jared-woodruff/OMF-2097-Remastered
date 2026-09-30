"""Frame-to-frame consistency survey of the original robots' HD paintings (npm run rework:survey).

The robots' HD frames were painted one by one ("upscale" jobs of the HD asset pack, without a shared design
reference), so the same part of a robot can be painted differently from frame to frame (the number of wing ribs,
the armor plating) although its pixel source is the same. The survey measures that per robot, move and frame:

1. Pairs of frames: every pair within a move, and every frame against every idle frame.
2. Where the SOURCES agree: the two source sprites are matched block by block (12 x 12 native pixels, every 6
   pixels, searched +-8 pixels around the in-game offset; lightly blurred, premultiplied colors). A block counts when
   its colors differ by at most 8 / 255 on average (transparency included) and it has some structure. The sources
   are re-rendered for every frame, so matches are close but rarely pixel-identical.
3. How the PAINTINGS differ there: both paintings at the game's scale (5 x 6 HD pixels per native pixel), their fine
   detail (band-pass luminance, sigma 1 to 3 HD pixels: plate lines, ribs, bolts, rivets, edges), each block aligned
   within +-6 HD pixels (about one native pixel: the sources only fix positions to a pixel):
       D = sum((a - b)^2) / sum(a^2 + b^2)      0 = the same detail, about 1 = unrelated detail.
   The same for the two sources enlarged (bicubic) gives Ds, the difference the sources themselves explain.
   Inconsistency = D - Ds: painted detail that differs although the sources agree. T is the mean difference of the
   blurred colors there (0..255).
4. Pooled per pair, move, robot and frame; the per-block excess is painted onto the frames as hotspot maps.

The absolute level includes a noise floor (every painting has its own scratches and highlights, and alignment is
never perfect): about 0.1 for the most consistent robots; compare robots and moves with each other. Robots whose
sources are noisy (dithered textures, e.g. Pyros' flames) get fewer matched blocks: see the coverage.

Writes <out>/survey.json, <out>/ranking.txt, <out>/overview.jpg (every robot's idle, worst first),
<out>/sheets/<ROBOT>.jpg (contact sheets: source above HD, for the idle, the walk and the worst moves),
<out>/hotspots/<ROBOT>.jpg (where the paintings disagree) and <out>/pairs/<ROBOT>.jpg (the frames whose sources agree
most and whose paintings agree least).

Usage: python tools/rework/survey.py [--pack hd-pack] [--out .captures/consistency] [--robots GARGOYLE,JAGUAR]
Needs Python 3 with numpy and Pillow.
"""
import argparse
import json
import os
import sys
import time
from multiprocessing import Pool
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

Image.MAX_IMAGE_PIXELS = None
ROOT = Path(__file__).resolve().parent.parent.parent
ORIGINAL_ROBOTS = ['JAGUAR', 'SHADOW', 'THORN', 'PYROS', 'ELECTRA', 'KATANA', 'SHREDDER', 'FLAIL', 'GARGOYLE', 'CHRONOS', 'NOVA']
SX, SY = 5, 6            # HD pixels per native pixel
BLOCK, STRIDE = 12, 6    # source blocks (native pixels)
SEARCH = 8               # block search radius (native pixels) around the in-game offset
SRC_TOL = 8.0            # a block matches when its (blurred) colors differ by at most this much on average (0..255)
ALIGN = 6                # HD alignment search (HD pixels)
IDLE, WALK = 11, 10
MIN_BLOCKS = 12          # moves with fewer matched blocks are not ranked


# ---- The robots' frames ------------------------------------------------------------------------------------------

def load_manifest(pack: Path) -> dict:
    return json.loads((pack / 'manifest.json').read_text(encoding='utf-8'))


def robot_frames(pack: Path, robot: str, manifest: dict = None) -> dict:
    """The robot's own frames (HD asset pack jobs 'fighter/<ROBOT>/...') and its moves.

    Returns {'frames': {job id: job}, 'anims': {anim id: [job ids in play order]}, 'folders': {anim id: folder name},
    'body': [job ids of the robot itself, not its projectiles]}."""
    manifest = manifest or load_manifest(pack)
    frames = {j['id']: j for j in manifest['jobs'] if j['id'].startswith(f'fighter/{robot}/')}
    file = f'FIGHTR{ORIGINAL_ROBOTS.index(robot)}.AF' if robot in ORIGINAL_ROBOTS else None
    anims: dict = {}
    for j in frames.values():
        for u in j['usages']:
            if file is None or u['file'] == file:
                anims.setdefault(u['anim'], []).append((u['sprite'], j['id']))
    anims = {a: list(dict.fromkeys(jid for _, jid in sorted(v))) for a, v in sorted(anims.items())}
    folders = {}
    for d in (pack / 'tier2_fighters' / robot).iterdir():
        if d.is_dir() and d.name[:1] == 'm' and d.name[1:3].isdigit():
            folders[int(d.name[1:3])] = d.name
    body = [jid for jid, j in frames.items() if 'projectile' not in (j.get('group') or j['id'])]
    return {'frames': frames, 'anims': anims, 'folders': folders, 'body': body}


def load_source(pack: Path, job: dict) -> np.ndarray:
    return np.asarray(Image.open(pack / job['source']).convert('RGBA'))


def load_hd(pack: Path, job: dict, path: Path = None) -> np.ndarray:
    """A painting at the game's size (the job's width x height), premultiplied RGBA floats 0..1."""
    im = Image.open(path or pack / job['output']).convert('RGBA')
    size = (job['width'], job['height'])
    if im.size != size:
        im = im.convert('RGBa')
        im = im.resize(size, Image.BOX if im.width >= size[0] and im.height >= size[1] else Image.LANCZOS)
        return np.asarray(im, np.float32) / 255.0
    a = np.asarray(im, np.float32) / 255.0
    a[..., :3] *= a[..., 3:4]
    return a


def enlarged_source(pack: Path, job: dict) -> np.ndarray:
    """The source at the game's size (bicubic, premultiplied): a 'painting' that follows the source exactly."""
    im = Image.open(pack / job['source']).convert('RGBa').resize((job['width'], job['height']), Image.BICUBIC)
    return np.asarray(im, np.float32) / 255.0


def straight(hd: np.ndarray) -> Image.Image:
    a = hd[..., 3:4]
    rgb = np.where(a > 1e-4, hd[..., :3] / np.maximum(a, 1e-4), 0)
    return Image.fromarray(np.round(np.clip(np.concatenate([rgb, a], -1), 0, 1) * 255).astype(np.uint8), 'RGBA')


def gauss(img: np.ndarray, sigma: float) -> np.ndarray:
    """Separable Gaussian blur (zero outside the image, like transparency)."""
    r = max(1, int(3 * sigma + 0.5))
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2)
    k = (k / k.sum()).astype(np.float32)
    extra = ((0, 0),) * (img.ndim - 2)
    p = np.pad(img.astype(np.float32), ((r, r), (0, 0)) + extra)
    out = np.zeros(img.shape, np.float32)
    for i, w in enumerate(k):
        out += w * p[i:i + img.shape[0]]
    p = np.pad(out, ((0, 0), (r, r)) + extra)
    out = np.zeros(img.shape, np.float32)
    for i, w in enumerate(k):
        out += w * p[:, i:i + img.shape[1]]
    return out


# (a matched block of the other frame lies mostly inside it: padding for the rest and the alignment search)
PAD = (BLOCK + 2) * max(SX, SY) + ALIGN
TONE_STEP = 4


# The detail bands compared (band-pass luminance, sigmas in HD pixels): 'fine' = the pattern (plate lines, rivets,
# bolts, facets, texture), 'mid' = the structure (plates, ribs, spikes, coils).
BANDS = {'fine': (1.0, 3.0), 'mid': (2.0, 8.0)}


def detail(img: np.ndarray) -> dict:
    """The detail bands of a picture (band-pass luminance), padded for block extraction."""
    lum = img[..., 0] * 0.299 + img[..., 1] * 0.587 + img[..., 2] * 0.114
    blur = {s: gauss(lum, s) for s in sorted({s for band in BANDS.values() for s in band})}
    return {name: np.pad(blur[lo] - blur[hi], PAD) for name, (lo, hi) in BANDS.items()}


def tone(img: np.ndarray) -> np.ndarray:
    """Blurred colors (the tone), every TONE_STEP pixels, padded like detail()."""
    p = PAD // TONE_STEP + 2
    return np.pad(gauss(img[..., :3], 4.0)[::TONE_STEP, ::TONE_STEP], ((p, p), (p, p), (0, 0)))


def premultiplied(A: np.ndarray) -> np.ndarray:
    """A source's colors times its alpha (0..255), alpha kept."""
    out = A.astype(np.float32)
    out[..., :3] *= out[..., 3:4] / 255.0
    return out


# ---- Two frames --------------------------------------------------------------------------------------------------

def match_blocks(A: np.ndarray, B: np.ndarray, d0: tuple) -> list:
    """Blocks of source A that (nearly) reappear in source B: [(x, y, dx, dy, cost)] (native pixels, B = A + d)."""
    a, b = gauss(premultiplied(A), 0.7), gauss(premultiplied(B), 0.7)
    hA, wA = A.shape[:2]
    hB, wB = B.shape[:2]
    if hA < BLOCK or wA < BLOCK:
        return []
    M = SEARCH + max(abs(d0[0]), abs(d0[1])) + 1
    canvas = np.zeros((max(hA, hB) + 2 * M, max(wA, wB) + 2 * M, 4), np.float32)
    canvas[M:M + hB, M:M + wB] = b
    offs = [(d0[0] + dx, d0[1] + dy) for dy in range(-SEARCH, SEARCH + 1) for dx in range(-SEARCH, SEARCH + 1)]
    D = np.empty((len(offs), hA, wA), np.float32)
    for k, (dx, dy) in enumerate(offs):
        D[k] = np.abs(a - canvas[M + dy:M + dy + hA, M + dx:M + dx + wA]).mean(-1)
    cs = np.zeros((len(offs), hA + 1, wA + 1), np.float32)
    cs[:, 1:, 1:] = D.cumsum(1).cumsum(2)
    ys = np.arange(0, hA - BLOCK + 1, STRIDE)
    xs = np.arange(0, wA - BLOCK + 1, STRIDE)
    Y, X = np.meshgrid(ys, xs, indexing='ij')
    cost = (cs[:, Y + BLOCK, X + BLOCK] - cs[:, Y, X + BLOCK] - cs[:, Y + BLOCK, X] + cs[:, Y, X]) / (BLOCK * BLOCK)
    # (ties: the offset nearest the in-game one)
    dist = np.array([abs(dx - d0[0]) + abs(dy - d0[1]) for dx, dy in offs], np.float32)
    best = np.argmin(cost + 0.05 * dist[:, None, None], 0)
    bcost = np.take_along_axis(cost, best[None], 0)[0]
    aA = A[..., 3] > 0
    lum = A[..., :3].astype(np.float32) @ np.array([0.299, 0.587, 0.114], np.float32)
    out = []
    for i, j in zip(*np.nonzero(bcost <= SRC_TOL)):
        y, x = int(Y[i, j]), int(X[i, j])
        m = aA[y:y + BLOCK, x:x + BLOCK]
        # mostly opaque, with some structure (a flat area would match anywhere)
        if m.mean() >= 0.6 and lum[y:y + BLOCK, x:x + BLOCK][m].std() >= 6.0:
            dx, dy = offs[best[i, j]]
            out.append((x, y, dx, dy, float(bcost[i, j])))
    return out


def compare(fa: np.ndarray, fb: np.ndarray, blocks: list, ta: np.ndarray = None, tb: np.ndarray = None):
    """Detail difference of two pictures in the matched blocks, each aligned within +-ALIGN HD pixels.
    Returns per block (difference energy, energy of both, tone difference or 0, alignment)."""
    PW, PH, r = BLOCK * SX, BLOCK * SY, ALIGN
    pa = np.stack([fa[PAD + y * SY:PAD + y * SY + PH, PAD + x * SX:PAD + x * SX + PW] for x, y, *_ in blocks])
    pb = np.stack([fb[PAD + (y + dy) * SY - r:PAD + (y + dy) * SY + PH + r, PAD + (x + dx) * SX - r:PAD + (x + dx) * SX + PW + r]
                   for x, y, dx, dy, _ in blocks])
    best = np.full(len(blocks), np.inf, np.float32)
    arg = np.zeros((len(blocks), 2), np.int32)
    for oy in range(2 * r + 1):
        for ox in range(2 * r + 1):
            s = ((pa - pb[:, oy:oy + PH, ox:ox + PW]) ** 2).sum((1, 2))
            better = s < best
            best[better] = s[better]
            arg[better] = (oy, ox)
    out = []
    for k, (x, y, dx, dy, _) in enumerate(blocks):
        oy, ox = arg[k]
        b = pb[k, oy:oy + PH, ox:ox + PW]
        t = 0.0
        if ta is not None:
            q, p = TONE_STEP, PAD // TONE_STEP + 2
            h, w = PH // q, PW // q
            A = ta[p + y * SY // q:p + y * SY // q + h, p + x * SX // q:p + x * SX // q + w]
            Y0, X0 = p + ((y + dy) * SY + oy - r) // q, p + ((x + dx) * SX + ox - r) // q
            t = float(np.abs(A - tb[Y0:Y0 + h, X0:X0 + w]).mean() * 255)
        out.append((float(best[k]), float((pa[k] ** 2).sum() + (b ** 2).sum()), t, (int(ox - r), int(oy - r))))
    return out


# ---- A robot -----------------------------------------------------------------------------------------------------

def pooled(rs: list) -> dict:
    """Pairs pooled: per band D (the paintings' detail difference), Ds (the sources') and D - Ds; 'score' = the mean of
    the bands' D - Ds (the inconsistency)."""
    rs = [r for r in rs if r['n']]
    n = sum(r['n'] for r in rs)
    out = {}
    for band in BANDS:
        hd_den, src_den = sum(r['hd'][band][1] for r in rs), sum(r['src'][band][1] for r in rs)
        if hd_den and src_den:
            D, Ds = sum(r['hd'][band][0] for r in rs) / hd_den, sum(r['src'][band][0] for r in rs) / src_den
            out[band] = {'excess': round(D - Ds, 4), 'D': round(D, 4), 'Ds': round(Ds, 4)}
    score = round(float(np.mean([b['excess'] for b in out.values()])), 4) if out else None
    return {'score': score, **out, 'T': round(sum(r['tone'] * r['n'] for r in rs) / n, 2) if n else None,
            'pairs': len(rs), 'blocks': n}


def survey_robot(args) -> dict:
    pack, robot, tmp = args
    t0 = time.time()
    rf = robot_frames(pack, robot)
    frames, anims = rf['frames'], rf['anims']
    body = [j for j in sorted(rf['body'])]
    src = {j: load_source(pack, frames[j]) for j in body}
    fine, tones, shape = {}, {}, {}
    for j in body:
        hd = load_hd(pack, frames[j])
        fine[j], tones[j], shape[j] = detail(hd), tone(hd), hd.shape[:2]
    sfine = {j: detail(enlarged_source(pack, frames[j])) for j in body}
    pos = {j: (frames[j]['native']['posX'], frames[j]['native']['posY']) for j in body}

    # The pairs: every pair within a move, and every frame against every idle frame.
    pairs: dict = {}
    bodyset = set(body)
    for anim, ids in anims.items():
        ids = [i for i in ids if i in bodyset]
        for a in range(len(ids)):
            for b in range(a + 1, len(ids)):
                pairs.setdefault(tuple(sorted((ids[a], ids[b]))), set()).add(str(anim))
    idle = [i for i in anims.get(IDLE, []) if i in bodyset]
    for i in idle:
        for j in body:
            if j != i:
                pairs.setdefault(tuple(sorted((i, j))), set()).add('idle')

    heat = {j: np.zeros((2,) + shape[j], np.float32) for j in body}
    cover = {j: np.zeros(src[j].shape[:2], bool) for j in body}
    results = []
    for (a, b), tags in pairs.items():
        d0 = (pos[a][0] - pos[b][0], pos[a][1] - pos[b][1])
        blocks = match_blocks(src[a], src[b], d0)
        rec = {'a': a, 'b': b, 'tags': sorted(tags), 'n': len(blocks), 'hd': {}, 'src': {}, 'tone': 0.0,
               'cost': round(float(np.mean([blk[4] for blk in blocks])), 2) if blocks else None}
        if blocks:
            per_block = np.zeros(len(blocks))
            weight = np.zeros(len(blocks))
            for band in BANDS:
                h = compare(fine[a][band], fine[b][band], blocks, tones[a], tones[b])
                s = compare(sfine[a][band], sfine[b][band], blocks)
                rec['hd'][band] = [sum(v[0] for v in h), sum(v[1] for v in h)]
                rec['src'][band] = [sum(v[0] for v in s), sum(v[1] for v in s)]
                rec['tone'] = float(np.mean([v[2] for v in h]))
                per_block += np.array([hv[0] / max(hv[1], 1e-9) - sv[0] / max(sv[1], 1e-9) for hv, sv in zip(h, s)]) / len(BANDS)
                weight += np.array([hv[1] for hv in h])
            for (x, y, dx, dy, _), excess, w in zip(blocks, per_block, weight):
                hv = (0.0, w)
                for j, bx, by in ((a, x, y), (b, x + dx, y + dy)):
                    ys = slice(max(0, by * SY), max(0, (by + BLOCK) * SY))
                    xs = slice(max(0, bx * SX), max(0, (bx + BLOCK) * SX))
                    heat[j][0, ys, xs] += excess * hv[1]
                    heat[j][1, ys, xs] += hv[1]
                    cover[j][max(0, by):max(0, by + BLOCK), max(0, bx):max(0, bx + BLOCK)] = True
        results.append(rec)

    moves = {}
    for anim, ids in anims.items():
        own = [i for i in ids if i in bodyset]
        if not own:
            continue
        entry = pooled([r for r in results if str(anim) in r['tags']])
        entry['vs_idle'] = pooled([r for r in results if 'idle' in r['tags'] and (r['a'] in own) != (r['b'] in own)]) \
            if anim != IDLE else None
        entry.update(folder=rf['folders'].get(anim, f'm{anim:02d}'), frames=len(own))
        moves[str(anim)] = entry
    per_frame = {}
    for j in body:
        mine = [r for r in results if j in (r['a'], r['b'])]
        entry = pooled(mine)
        entry['vs_idle'] = pooled([r for r in mine if 'idle' in r['tags']])
        opaque = src[j][..., 3] > 0
        entry['coverage'] = round(float((cover[j] & opaque).sum() / max(1, opaque.sum())), 3)
        per_frame[j] = entry
    # The idle frame whose painting agrees best with the others: the robot's canonical look (see the rework pack).
    canon = sorted(idle, key=lambda j: per_frame[j]['score'] if per_frame[j]['score'] is not None else 9)
    idle_cover = [per_frame[j]['coverage'] for j in idle]
    np.savez_compressed(tmp / f'{robot}.npz', **{j.replace('/', '|'): np.where(
        heat[j][1] > 1e-9, heat[j][0] / np.maximum(heat[j][1], 1e-9), np.nan).astype(np.float32) for j in body})
    print(f'{robot}: {len(pairs)} pairs, {sum(r["n"] for r in results)} matched blocks, {time.time() - t0:.0f}s', flush=True)
    return {
        'robot': robot,
        'all': pooled(results),
        'within_moves': pooled([r for r in results if any(t != 'idle' for t in r['tags'])]),
        'vs_idle': pooled([r for r in results if 'idle' in r['tags']]),
        'idle_coverage': round(float(np.mean(idle_cover)), 3) if idle_cover else None,
        'idle_frames': idle,
        'canonical_idle': canon,
        'moves': moves,
        'move_frames': {str(k): [i for i in v if i in bodyset] for k, v in anims.items() if any(i in bodyset for i in v)},
        'frames': per_frame,
        'pairs': [{k: (round(v, 3) if isinstance(v, float) else v) for k, v in r.items()} for r in results],
    }


# ---- Pictures ----------------------------------------------------------------------------------------------------

BG = (34, 36, 44)
FG = (235, 235, 240)
DIM = (150, 155, 170)


def font(size: int):
    for name in ('arial.ttf', 'DejaVuSans.ttf'):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            pass
    return ImageFont.load_default(size=size)


def heat_overlay(hd: Image.Image, hot, size) -> Image.Image:
    """The painting in grey with the excess detail difference on top (yellow = some, red = unrelated detail)."""
    g = np.asarray(hd.convert('LA').convert('RGBA'), np.float32).copy()
    g[..., :3] *= 0.55
    if hot is not None:
        hmap = np.asarray(Image.fromarray(np.nan_to_num(hot, nan=-1.0)).resize(size, Image.NEAREST), np.float32)
        known = (hmap > -0.5) & (g[..., 3] > 0)
        t = np.clip(hmap / 0.6, 0, 1)
        color = np.stack([np.full_like(t, 255), 230 * (1 - t), 40 * (1 - t)], -1)
        g[..., :3] = np.where(known[..., None], g[..., :3] * 0.3 + color * 0.7, g[..., :3])
    return Image.fromarray(np.clip(g, 0, 255).astype(np.uint8), 'RGBA')


def move_strip(pack: Path, frames: dict, ids: list, scale: float, label: str, hot: dict = None) -> Image.Image:
    """One move: the sources (enlarged, pixelated) above the HD paintings, in play order, at one scale."""
    cells = []
    for jid in ids:
        job = frames[jid]
        W, H = job['width'], job['height']
        size = (max(1, round(W * scale)), max(1, round(H * scale)))
        s = Image.open(pack / job['source']).convert('RGBA').resize((W, H), Image.NEAREST).resize(size, Image.BOX)
        h = straight(load_hd(pack, job)).resize(size, Image.LANCZOS)
        row = [s, h] + ([heat_overlay(h, hot.get(jid), size)] if hot is not None else [])
        cells.append((row, jid.rsplit('/', 1)[1]))
    gap, top = 10, 34
    ch = max(c[0][0].height for c in cells)
    w = sum(c[0][0].width for c in cells) + gap * (len(cells) + 1)
    rows = len(cells[0][0])
    out = Image.new('RGBA', (max(w, 900), top + rows * (ch + gap) + 18), BG + (255,))
    d = ImageDraw.Draw(out)
    d.text((gap, 6), label, fill=FG, font=font(20))
    x = gap
    for row, name in cells:
        for k, im in enumerate(row):
            out.alpha_composite(im, (x, top + k * (ch + gap) + ch - im.height))
        d.text((x, top + rows * (ch + gap) - 4), name, fill=DIM, font=font(13))
        x += row[0].width + gap
    return out


def stack(images: list, title: str, subtitle: str) -> Image.Image:
    w = max(max(im.width for im in images), 1200)
    out = Image.new('RGB', (w, sum(im.height for im in images) + 90), BG)
    d = ImageDraw.Draw(out)
    d.text((12, 10), title, fill=FG, font=font(28))
    d.text((12, 50), subtitle, fill=DIM, font=font(17))
    y = 90
    for im in images:
        out.paste(im.convert('RGB'), (0, y))
        y += im.height
    return out


def fmt(m: dict) -> str:
    if not m or m.get('score') is None:
        return 'no matched blocks'
    bands = ', '.join(f"{b} {m[b]['excess']:.3f}" for b in BANDS if b in m)
    return f"inconsistency {m['score']:.3f} ({bands}), T {m['T']:.1f}, {m['blocks']} blocks"


def pair_excess(p: dict) -> float:
    return float(np.mean([p['hd'][b][0] / max(p['hd'][b][1], 1e-9) - p['src'][b][0] / max(p['src'][b][1], 1e-9)
                          for b in BANDS if b in p['hd']]))


def distinct_moves(r: dict) -> list:
    """The robot's moves, those with the same frames as an earlier one left out: [(anim, entry, [other folders])]."""
    first: dict = {}
    for a, m in sorted(r['moves'].items(), key=lambda t: int(t[0])):
        key = tuple(sorted(r['move_frames'][a]))
        if key in first:
            first[key][2].append(m['folder'])
        else:
            first[key] = (a, m, [])
    return list(first.values())


def sheets(pack: Path, out: Path, res: dict, hot: dict, rank: int, count: int) -> None:
    robot = res['robot']
    rf = robot_frames(pack, robot)
    frames, anims = rf['frames'], rf['anims']
    body = set(rf['body'])
    moves = res['moves']

    def ids_of(anim, limit=12):
        return [i for i in anims.get(anim, []) if i in body][:limit]

    ranked = [(int(a), m) for a, m, _ in distinct_moves(res) if m['score'] is not None and m['blocks'] >= MIN_BLOCKS and int(a) not in (IDLE, WALK)]
    worst = [a for a, _ in sorted(ranked, key=lambda t: -t[1]['score'])[:4]]
    strips = [move_strip(pack, frames, ids_of(a), 0.42, f"{moves[str(a)]['folder']}: {fmt(moves[str(a)])}")
              for a in [IDLE, WALK] + worst if ids_of(a)]
    a = res['all']
    (out / 'sheets').mkdir(parents=True, exist_ok=True)
    stack(strips, f"{robot}: rank {rank} of {count}, {fmt(a)}",
          'Each move: the sources (enlarged) above the HD paintings. Idle, walk, then the moves that score worst.'
          ).save(out / 'sheets' / f'{robot}.jpg', quality=88)

    hs = [move_strip(pack, frames, ids_of(a), 0.42, f"{moves[str(a)]['folder']}: {fmt(moves[str(a)])}", hot)
          for a in [IDLE, WALK] if ids_of(a)]
    if hs:
        (out / 'hotspots').mkdir(parents=True, exist_ok=True)
        stack(hs, f'{robot}: where the paintings disagree', 'Rows: source, HD painting, the excess detail difference '
              'where the sources match (yellow = small, red = unrelated detail; grey = no match found)').save(
            out / 'hotspots' / f'{robot}.jpg', quality=88)

    # The telling pairs: sources that agree most, paintings that agree least.
    cand = [p for p in res['pairs'] if p['n'] >= 6]
    for p in cand:
        p['_excess'] = pair_excess(p)
    cand.sort(key=lambda p: -(p['_excess'] - 0.02 * (p['cost'] or 8)))
    rows = []
    for p in cand[:3]:
        cells = []
        for j in (p['a'], p['b']):
            job = frames[j]
            W, H = job['width'], job['height']
            size = (round(W * 0.6), round(H * 0.6))
            cells.append((Image.open(pack / job['source']).convert('RGBA').resize((W, H), Image.NEAREST).resize(size, Image.BOX),
                          straight(load_hd(pack, job)).resize(size, Image.LANCZOS), j.split('/', 2)[2]))
        w = sum(c[0].width for c in cells) * 2 + 60
        hgt = max(c[0].height for c in cells) + 40
        im = Image.new('RGBA', (w, hgt), BG + (255,))
        d = ImageDraw.Draw(im)
        x = 10
        for s, _, name in cells:
            im.alpha_composite(s, (x, 30))
            d.text((x, 6), f'source {name}', fill=DIM, font=font(15))
            x += s.width + 10
        x += 20
        for _, h, name in cells:
            im.alpha_composite(h, (x, 30))
            d.text((x, 6), f'HD {name}', fill=FG, font=font(15))
            x += h.width + 10
        rows.append((im, p))
    if rows:
        (out / 'pairs').mkdir(parents=True, exist_ok=True)
        stack([r[0] for r in rows], f'{robot}: sources that agree, paintings that do not',
              ' | '.join(f"{r[1]['a'].split('/', 2)[2]} + {r[1]['b'].split('/', 2)[2]}: source difference "
                         f"{r[1]['cost']}/255, excess {r[1]['_excess']:.2f}" for r in rows)).save(out / 'pairs' / f'{robot}.jpg', quality=88)


def overview(pack: Path, out: Path, results: list) -> None:
    """Every robot's idle paintings in one picture, in ranking order (worst first)."""
    strips = []
    for k, res in enumerate(results, 1):
        rf = robot_frames(pack, res['robot'])
        ids = [i for i in rf['anims'].get(IDLE, []) if i in set(rf['body'])][:8]
        if not ids:
            continue
        strips.append(move_strip(pack, rf['frames'], ids, 0.3, f"{k}. {res['robot']}: {res['all']['score']:.3f}"
                                 f"  (idle {res['moves'].get(str(IDLE), {}).get('score') or 0:.3f})"))
    half = (len(strips) + 1) // 2
    cols = [strips[:half], strips[half:]]
    widths = [max(s.width for s in c) for c in cols]
    img = Image.new('RGB', (sum(widths), max(sum(s.height for s in c) for c in cols) + 70), BG)
    d = ImageDraw.Draw(img)
    d.text((12, 12), 'Idle paintings of the 11 original robots, most inconsistent first (sources above HD)', fill=FG, font=font(28))
    x = 0
    for c, cw in zip(cols, widths):
        y = 70
        for s in c:
            img.paste(s.convert('RGB'), (x, y))
            y += s.height
        x += cw
    img.save(out / 'overview.jpg', quality=85)


# ---- Main --------------------------------------------------------------------------------------------------------

def ranking_text(results: list) -> str:
    lines = [
        "Consistency survey of the original robots' HD paintings (tools/rework/survey.py)", '',
        'Where the source sprites of two frames match (12 x 12 native pixel blocks), how differently are they painted?',
        'Per detail band: D = painted detail that differs (0 = the same, ~1 = unrelated), Ds = the difference the',
        'sources themselves explain, excess = D - Ds. fine = pattern (plate lines, rivets, facets, texture), mid =',
        'structure (plates, ribs, spikes, coils). Score = the mean excess of both bands. Pooled over every pair of',
        'frames within a move and every frame against every idle frame. T = mean tone difference (0..255).',
        'Coverage = share of the idle frames covered by matched blocks. Moves sharing all their frames are listed once.', '',
        f"{'rank':>4}  {'robot':10s} {'score':>6} {'fine':>6} {'mid':>6} {'moves':>6} {'vsidle':>6} {'T':>5} {'blocks':>7} {'cover':>6}  worst moves",
    ]

    for k, r in enumerate(results, 1):
        a = r['all']
        mv = sorted(((m['score'], m['folder']) for _, m, _ in distinct_moves(r) if m['score'] is not None and m['blocks'] >= MIN_BLOCKS), reverse=True)
        lines.append(f"{k:>4}  {r['robot']:10s} {a['score']:6.3f} {a['fine']['excess']:6.3f} {a['mid']['excess']:6.3f} "
                     f"{r['within_moves']['score'] or 0:6.3f} {r['vs_idle']['score'] or 0:6.3f} {a['T']:5.1f} {a['blocks']:7d} "
                     f"{r['idle_coverage'] or 0:6.2f}  " + ', '.join(f'{f} {d:.3f}' for d, f in mv[:3]))
    lines += ['', f'Moves (at least {MIN_BLOCKS} matched blocks), worst first:']
    allm = [(m['score'], r['robot'], m, also) for r in results for _, m, also in distinct_moves(r) if m['score'] is not None and m['blocks'] >= MIN_BLOCKS]
    for s, robot, m, same in sorted(allm, key=lambda t: -t[0])[:45]:
        vi = m.get('vs_idle') or {}
        also = f" (= {', '.join(same)})" if same else ''
        lines.append(f"  {robot:10s} {m['folder'] + also:48s} {s:6.3f}  fine {m['fine']['excess']:.3f}, mid {m['mid']['excess']:.3f}, "
                     f"T {m['T']:5.1f}, {m['frames']:3d} frames, {m['pairs']:4d} pairs, {m['blocks']:5d} blocks; vs idle "
                     f"{vi.get('score') if vi.get('score') is not None else '-'}")
    lines += ['', 'Idle frames, the most agreeing (canonical) first:']
    for r in results:
        lines.append(f"  {r['robot']:10s} " + ', '.join(f"{j.split('/', 2)[2]} {r['frames'][j]['score'] or 0:.3f}" for j in r['canonical_idle']))
    return '\n'.join(lines) + '\n'


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('--pack', default=str(ROOT / 'hd-pack'))
    ap.add_argument('--out', default=str(ROOT / '.captures' / 'consistency'))
    ap.add_argument('--robots', default=','.join(ORIGINAL_ROBOTS))
    ap.add_argument('--no-pictures', action='store_true')
    ap.add_argument('--report', action='store_true', help='only redo ranking.txt and the pictures from the last survey')
    args = ap.parse_args()
    pack, out = Path(args.pack).resolve(), Path(args.out).resolve()
    robots = [r.strip().upper() for r in args.robots.split(',') if r.strip()]
    tmp = out / 'hotspot-data'
    tmp.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    path = out / 'survey.json'
    earlier = json.loads(path.read_text(encoding='utf-8'))['robots'] if path.exists() else []
    if args.report:
        results = [r for r in earlier if r['robot'] in robots]
    else:
        with Pool(min(len(robots), max(1, (os.cpu_count() or 4) - 2))) as pool:
            results = pool.map(survey_robot, [(pack, r, tmp) for r in robots], chunksize=1)
    # (a partial run keeps the other robots' earlier results)
    merged = {r['robot']: r for r in earlier}
    merged.update({r['robot']: r for r in results})
    everyone = sorted(merged.values(), key=lambda r: -(r['all']['score'] or 0))
    if not args.report:
        path.write_text(json.dumps({'generated': time.strftime('%Y-%m-%d %H:%M'), 'block': BLOCK, 'stride': STRIDE,
                                    'search': SEARCH, 'source_tolerance': SRC_TOL, 'align': ALIGN,
                                    'robots': everyone}, indent=1), encoding='utf-8')
    text = ranking_text(everyone)
    (out / 'ranking.txt').write_text(text, encoding='utf-8')
    print(text)
    if not args.no_pictures:
        names = [r['robot'] for r in everyone]
        for res in results:
            hot = {k.replace('|', '/'): v for k, v in np.load(tmp / f"{res['robot']}.npz").items()}
            sheets(pack, out, res, hot, names.index(res['robot']) + 1, len(everyone))
        if len(everyone) == len(ORIGINAL_ROBOTS):
            overview(pack, out, everyone)
    print(f'{out} ({time.time() - t0:.0f}s)')


if __name__ == '__main__':
    sys.exit(main())
