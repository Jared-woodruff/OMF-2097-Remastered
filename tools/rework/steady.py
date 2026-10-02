"""Steadies an original robot's HD paintings from frame to frame: the consistency rework done in the images.

The robots' frames were painted one by one, so the same part is painted differently from frame to frame although its
source sprite shows it the same way (tools/rework/survey.py measures it). This makes them agree. Frames are taken in an
order: the robot's canonical idle frame first, kept as it is; then the other idle frames; then every move's frames in
play order. Each frame, wherever a block of its source reappears in a frame steadied before it (the idle frames and the
frames of its moves: the survey's block matching, with smaller blocks), takes that frame's painting of it:
- by regions, not block by block: the blocks of a reference that match side by side and whose paintings line up at
  the same offset (the sprites were rendered frame by frame, so a part that did not move often matches a native pixel
  either way, the paintings' alignment making up for it) are one region, moved as one; small regions are left out
  (on long plain plates a block matches at many places);
- the regions taken in order of size (the canonical idle frame's a little ahead), each where no larger one is, so a
  part comes from one frame (averaging or patching paintings would blur them or break their lines), and only where the
  two sources agree pixel by pixel, a native pixel in from where they do not: the edges of a part that moved (a block
  can match although an arm crossing it moved a little) keep the frame's own painting, and the seams run along the
  parts' outlines;
- the painting moved whole, by whole painting pixels (no resampling: as sharp as it was);
- laid in with multi-band blending: broad shading hands over gradually (no step in tone), fine detail at the edge of
  the area taken (no detail doubled);
- paintings at another scale (2 to 9 painting pixels per game pixel) are resampled to the frame's.
Where nothing matches, the painting stays as it was. Silhouettes are untouched.

The frames were painted with parts drawn in different shapes (a bevel, a ball joint's rim), not only with different
texture, so where a region ends across such a part a seam can show (JAGUAR: a cut shoulder ball, a patch on a hip
ball, a blocky belt in some frames). With --seams T, each region's edge is first moved in, from outside, through every
pixel where the two paintings' shapes differ by more than T, so the seams fall only where the paintings agree:
T = 0.10 shows hardly any (thin parts can get small specks: FLAIL's gun barrels) but takes far less (JAGUAR's idle:
inconsistency 0.103 as painted, -0.007 without, 0.082 with --seams 0.10).

Writes the steadied paintings as a rework delivery (<out>/tier2_fighters/<ROBOT>/mNN_<move>/fNNN.hd.png, at the
paintings' own size, with the sources and a manifest), which `npm run rework:import -- <out> --robots <ROBOT>` puts in
the game (keeping the replaced paintings to restore) and `python tools/rework/survey.py --pack <out> --robots <ROBOT>`
measures.

Usage: python tools/rework/steady.py --robots JAGUAR [--pack hd-pack] [--out .captures/steady] [--moves 11,10]
       [--seams 0.10]
Needs Python 3 with numpy and Pillow.
"""
import argparse
import json
import os
import shutil
import sys
import time
from multiprocessing import Pool
from pathlib import Path

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
from survey import IDLE, SX, SY, gauss, load_manifest, load_source, premultiplied, robot_frames  # noqa: E402

# The paintings' detail, for aligning them: the picture less its blur at SPLIT game pixels (5 x 6 per native pixel).
SPLIT = 8.0
# How far a matched block's painting is aligned (game pixels: about a native pixel).
ALIGN = 6
# The blocks matched between sources (native pixels): smaller than the survey's (12, every 6, within 8 / 255), so
# moving parts find their match more often; how far around the in-game offset they are looked for.
BLOCK, STRIDE, SEARCH = 9, 3, 8
SRC_TOL = 8.0
# The broadest band of the blending hands over within about this many game pixels.
BLEND = 8.0
# Regions: how far apart (game pixels) neighbouring matches may lay a painting and still be one region; the fewest
# blocks a region needs; how much ahead the canonical frame's regions are; how much a native pixel of the two sources
# may differ (blurred like the blocks, 0..255) for it to be taken.
MERGE, MIN_BLOCKS, CANON_BIAS = 2, 3, 1.25
PIX_TOL = 24.0
# --seams: how much the two paintings' shapes (their detail at the game's size, blurred a little) may differ where a
# region's edge runs (None: regions are not moved in).
SEAMS = None


def match_blocks(A: np.ndarray, B: np.ndarray, d0: tuple) -> list:
    """Blocks of source A that (nearly) reappear in source B: [(x, y, dx, dy, cost)] (native pixels, B = A + d), as
    the survey matches them (tools/rework/survey.py), with this tool's block size and tolerance."""
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
        if m.mean() >= 0.5 and lum[y:y + BLOCK, x:x + BLOCK][m].std() >= 5.0:
            dx, dy = offs[best[i, j]]
            out.append((x, y, dx, dy, float(bcost[i, j])))
    return out


def load_painting(pack: Path, job: dict) -> np.ndarray:
    """A painting at its own size, straight RGBA floats 0..1."""
    return np.asarray(Image.open(pack / job['output']).convert('RGBA'), np.float32) / 255.0


def luma(rgb: np.ndarray) -> np.ndarray:
    return rgb[..., 0] * 0.299 + rgb[..., 1] * 0.587 + rgb[..., 2] * 0.114


def resized(a: np.ndarray, w: int, h: int, method=None) -> np.ndarray:
    """A float picture (H x W or H x W x C) resampled to w x h (Lanczos up, box down, unless told)."""
    if a.shape[1] == w and a.shape[0] == h:
        return a
    chans = [a] if a.ndim == 2 else [a[..., c] for c in range(a.shape[2])]
    m = method if method is not None else Image.LANCZOS if w >= a.shape[1] else Image.BOX
    out = [np.asarray(Image.fromarray(np.ascontiguousarray(c, np.float32), 'F').resize((w, h), m)) for c in chans]
    return out[0] if a.ndim == 2 else np.stack(out, -1)


def crop(a: np.ndarray, x: int, y: int, w: int, h: int) -> np.ndarray:
    """a[y:y + h, x:x + w], zero outside."""
    out = np.zeros((h, w) + a.shape[2:], a.dtype)
    x0, y0, x1, y1 = max(x, 0), max(y, 0), min(x + w, a.shape[1]), min(y + h, a.shape[0])
    if x1 > x0 and y1 > y0:
        out[y0 - y:y1 - y, x0 - x:x1 - x] = a[y0:y1, x0:x1]
    return out


def grown(m: np.ndarray, by: int) -> np.ndarray:
    """A mask grown (by > 0) or shrunk (by < 0) by |by| pixels, 8 ways."""
    out = m.copy()
    for _ in range(abs(by)):
        p = np.pad(out, 1, constant_values=by < 0)
        stack = [p[1 + ey:p.shape[0] - 1 + ey, 1 + ex:p.shape[1] - 1 + ex] for ey in (-1, 0, 1) for ex in (-1, 0, 1)]
        out = np.logical_or.reduce(stack) if by > 0 else np.logical_and.reduce(stack)
    return out


def down(a: np.ndarray) -> np.ndarray:
    """The next level of a picture pyramid (blurred, every other pixel)."""
    return gauss(a, 1.0)[::2, ::2]


def up(a: np.ndarray, shape: tuple) -> np.ndarray:
    """A pyramid level enlarged to the level below (twice the size)."""
    return resized(a, shape[1], shape[0], Image.BILINEAR)


class Frame:
    """A frame's source and painting (and, at the game's size, its detail and opacity for aligning)."""

    def __init__(self, pack: Path, job: dict):
        self.job = job
        self.src = load_source(pack, job)
        hd = load_painting(pack, job)
        self.k = hd.shape[1] / job['width']  # painting pixels per game pixel
        self.pos = (job['native']['posX'], job['native']['posY'])
        self.blur = gauss(premultiplied(self.src), 0.7)
        self.set(hd)

    def set(self, hd: np.ndarray) -> None:
        # (at the game's size, premultiplied while shrinking)
        w, h = self.job['width'], self.job['height']
        g = resized(np.concatenate([hd[..., :3] * hd[..., 3:4], hd[..., 3:4]], -1), w, h)
        a = np.clip(g[..., 3:4], 0, 1)
        rgb = np.where(a > 1e-4, g[..., :3] / np.maximum(a, 1e-4), 0)
        # (blurred with the transparent surroundings left out: colors do not darken toward the silhouette)
        num, den = gauss(rgb * a, SPLIT), gauss(a, SPLIT)
        low = np.where(den > 1e-4, num / np.maximum(den, 1e-4), rgb)
        self.align = luma(rgb - low) * a[..., 0]
        self.alpha = a[..., 0]
        # (kept compact: a robot's frames are all held at once)
        self.rgba = np.round(hd * 255).astype(np.uint8)
        self.scaled = {}

    @property
    def hd(self) -> np.ndarray:
        return self.rgba.astype(np.float32) / 255.0

    def at_scale(self, k: float) -> np.ndarray:
        """The painting (RGBA bytes) at k painting pixels per game pixel."""
        if abs(k - self.k) < 1e-6:
            return self.rgba
        if k not in self.scaled:
            w, h = int(round(self.job['width'] * k)), int(round(self.job['height'] * k))
            # (premultiplied while resampling: transparent pixels' colors do not bleed in)
            hd = self.hd
            pm = np.concatenate([hd[..., :3] * hd[..., 3:4], hd[..., 3:4]], -1)
            pm = np.clip(resized(pm, w, h), 0, 1)
            a = pm[..., 3:4]
            rgb = np.where(a > 1e-4, pm[..., :3] / np.maximum(a, 1e-4), 0)
            self.scaled[k] = np.round(np.clip(np.concatenate([rgb, a], -1), 0, 1) * 255).astype(np.uint8)
        return self.scaled[k]


def alignment_costs(frame: Frame, r: Frame, blocks: list) -> np.ndarray:
    """For blocks [(x, y, dx, dy, cost)] of the frame matched in r: how far r's detail is from the frame's at every
    offset within +-ALIGN game pixels (blocks x (2 ALIGN + 1)^2, offsets row by row)."""
    PW, PH, R = BLOCK * SX, BLOCK * SY, ALIGN
    P = R + BLOCK * max(SX, SY)
    ra = np.pad(r.align, P)
    pa = np.stack([crop(frame.align, x * SX, y * SY, PW, PH) for x, y, *_ in blocks])
    pb = np.stack([crop(ra, P + (x + dx) * SX - R, P + (y + dy) * SY - R, PW + 2 * R, PH + 2 * R) for x, y, dx, dy, _ in blocks])
    out = np.empty((len(blocks), (2 * R + 1) ** 2), np.float32)
    for oy in range(2 * R + 1):
        for ox in range(2 * R + 1):
            out[:, oy * (2 * R + 1) + ox] = ((pa - pb[:, oy:oy + PH, ox:ox + PW]) ** 2).sum((1, 2))
    return out


class Sets:
    """Union-find."""

    def __init__(self, n: int):
        self.up = list(range(n))

    def find(self, a: int) -> int:
        while self.up[a] != a:
            self.up[a] = self.up[self.up[a]]
            a = self.up[a]
        return a

    def join(self, a: int, b: int) -> None:
        self.up[self.find(a)] = self.find(b)


def agreement(frame: Frame, r: Frame, dx: int, dy: int) -> np.ndarray:
    """Where the frame's source and r's, moved by (dx, dy) native pixels, agree: native pixels (both opaque, colors
    within PIX_TOL, small gaps closed), a pixel in from where they do not; at the game's size."""
    hA, wA = frame.src.shape[:2]
    b = crop(r.blur, dx, dy, wA, hA)
    ok = (np.abs(frame.blur - b).mean(-1) <= PIX_TOL) & (frame.src[..., 3] > 0) & (crop(r.src[..., 3], dx, dy, wA, hA) > 0)
    ok = grown(grown(grown(ok, 1), -1), -1)
    return np.repeat(np.repeat(ok, SY, 0), SX, 1)


def regions(frame: Frame, r: Frame, canonical: bool) -> list:
    """The regions of the frame that reappear in r: [(score, (tx, ty) offset of r's painting in game pixels,
    blocks)] (see above)."""
    d0 = (frame.pos[0] - r.pos[0], frame.pos[1] - r.pos[1])
    blocks = match_blocks(frame.src, r.src, d0)
    if not blocks:
        return []
    at = {(b[0], b[1]): n for n, b in enumerate(blocks)}
    near = [(n, at[(b[0] + ex, b[1] + ey)]) for n, b in enumerate(blocks)
            for ex, ey in ((STRIDE, 0), (0, STRIDE), (STRIDE, STRIDE), (STRIDE, -STRIDE)) if (b[0] + ex, b[1] + ey) in at]
    # Blocks side by side with the same offset in the sources; each such group aligned as one (its blocks' costs
    # summed: plain blocks have no say), then neighbouring groups that lay the painting alike joined.
    same = Sets(len(blocks))
    for a, b in near:
        if blocks[a][2:4] == blocks[b][2:4]:
            same.join(a, b)
    costs = alignment_costs(frame, r, blocks)
    groups: dict = {}
    for n in range(len(blocks)):
        groups.setdefault(same.find(n), []).append(n)
    side = 2 * ALIGN + 1
    lay = {}
    for root, members in groups.items():
        o = int(np.argmin(costs[members].sum(0)))
        dx, dy = blocks[members[0]][2:4]
        lay[root] = (dx * SX + o % side - ALIGN, dy * SY + o // side - ALIGN)
    alike = Sets(len(blocks))
    for a, b in near:
        ta, tb = lay[same.find(a)], lay[same.find(b)]
        if max(abs(ta[0] - tb[0]), abs(ta[1] - tb[1])) <= MERGE:
            alike.join(a, b)
    out: dict = {}
    for n in range(len(blocks)):
        out.setdefault(alike.find(n), []).append(n)
    found = []
    for members in out.values():
        if len(members) < MIN_BLOCKS:
            continue
        # (the offset of its largest group)
        roots = [same.find(n) for n in members]
        t = lay[max(set(roots), key=roots.count)]
        quality = float(np.mean([1.0 - 0.6 * blocks[n][4] / SRC_TOL for n in members]))
        found.append((len(members) * quality * (CANON_BIAS if canonical else 1.0), t, [blocks[n] for n in members]))
    return found


def steadied(frame: Frame, refs: list) -> tuple:
    """The frame's painting with the paintings of the reference frames laid in wherever their sources match (see
    above); and the share of its opaque pixels that took them."""
    hd = frame.hd
    H, W = hd.shape[:2]
    k = frame.k
    w, h = frame.job['width'], frame.job['height']
    # The regions of every reference, largest first, each taking the game pixels its blocks cover where no larger one
    # has (and where both paintings are opaque); what is left of a region must still be a block's worth.
    found = sorted(((score, i, t, blocks) for i, r in enumerate(refs) for score, t, blocks in regions(frame, r, i == 0)),
                   key=lambda m: -m[0])
    BW, BH = BLOCK * SX, BLOCK * SY
    label = np.full((h, w), -1, np.int32)
    matches = []
    agree: dict = {}
    for score, i, (ox, oy), blocks in found:
        mine = np.zeros((h, w), bool)
        for x, y, dx, dy, _ in blocks:
            if (i, dx, dy) not in agree:
                agree[(i, dx, dy)] = agreement(frame, refs[i], dx, dy)
            win = (slice(y * SY, y * SY + BH), slice(x * SX, x * SX + BW))
            mine[win] |= agree[(i, dx, dy)][win]
        mine &= (label < 0) & (frame.alpha >= 0.5) & (crop(refs[i].alpha, ox, oy, w, h) >= 0.5)
        if SEAMS is not None and mine.any():
            # (the edge moved in through every pixel, reached from outside, where the shapes differ)
            ys, xs = np.nonzero(mine)
            y0, y1, x0, x1 = max(0, ys.min() - 2), min(h, ys.max() + 3), max(0, xs.min() - 2), min(w, xs.max() + 3)
            differ = gauss(np.abs(frame.align[y0:y1, x0:x1] - crop(refs[i].align, x0 + ox, y0 + oy, x1 - x0, y1 - y0)), 1.5) > SEAMS
            m = mine[y0:y1, x0:x1]
            while True:
                drop = m & differ & ~grown(m, -1)
                if not drop.any():
                    break
                m &= ~drop
            mine[y0:y1, x0:x1] = m
        if mine.sum() < BW * BH:
            continue
        label[mine] = len(matches)
        matches.append((i, (ox, oy), blocks))
    # Multi-band blending (Burt & Adelson) of the changes: every match's painting less the frame's, its Laplacian
    # pyramid weighted by the Gaussian pyramid of where it is taken.
    L = max(2, int(round(np.log2(BLEND * k))))
    m = 2 ** L
    Hp, Wp = -(-H // m) * m, -(-W // m) * m
    acc = [np.zeros((Hp >> l, Wp >> l, 3), np.float32) for l in range(L + 1)]
    gy = np.minimum((np.arange(Hp) / k).astype(int), h - 1)
    gx = np.minimum((np.arange(Wp) / k).astype(int), w - 1)
    for g, (i, (ox, oy), _) in enumerate(matches):
        mine = label == g
        if not mine.any():
            continue
        ys, xs = np.nonzero(mine)
        margin = 4 * m
        X0, Y0 = max(0, (int(xs.min() * k) - margin) // m * m), max(0, (int(ys.min() * k) - margin) // m * m)
        X1, Y1 = min(Wp, -(-(int((xs.max() + 1) * k) + margin) // m) * m), min(Hp, -(-(int((ys.max() + 1) * k) + margin) // m) * m)
        bw, bh = X1 - X0, Y1 - Y0
        M = mine[gy[Y0:Y1][:, None], gx[X0:X1][None, :]].astype(np.float32)
        ref = crop(refs[i].at_scale(k), X0 + int(round(ox * k)), Y0 + int(round(oy * k)), bw, bh).astype(np.float32) / 255.0
        own = crop(hd, X0, Y0, bw, bh)
        ok = ((ref[..., 3] >= 0.5) & (own[..., 3] >= 0.5) & (M > 0)).astype(np.float32)
        change = (ref[..., :3] - own[..., :3]) * ok[..., None]
        # (outside the region, or where either is transparent, only the broad change carried on from inside: the
        # reference's painting there shows other things, which the blending's broad bands would bring in as ghosts;
        # no dip toward the silhouette)
        s = BLEND * k / 2
        near = gauss(ok, s)
        fill = gauss(change, s) / np.maximum(near, 1e-3)[..., None]
        change = np.where(ok[..., None] > 0, change, fill * (near > 0.05)[..., None])
        G, GM = change, M
        for l in range(L):
            Gn, GMn = down(G), down(GM)
            acc[l][Y0 >> l:Y1 >> l, X0 >> l:X1 >> l] += GM[..., None] * (G - up(Gn, G.shape))
            G, GM = Gn, GMn
        acc[L][Y0 >> L:Y1 >> L, X0 >> L:X1 >> L] += GM[..., None] * G
    G = acc[L]
    for l in range(L - 1, -1, -1):
        G = acc[l] + up(G, acc[l].shape)
    out = hd.copy()
    out[..., :3] = np.clip(hd[..., :3] + G[:H, :W], 0, 1)
    opaque = hd[..., 3] > 0.5
    took = label[gy[:H][:, None], gx[:W][None, :]] >= 0
    return out, float(took[opaque].mean()) if opaque.any() else 0.0


def steady_robot(args) -> dict:
    pack, robot, out, moves = args
    t0 = time.time()
    rf = robot_frames(pack, robot)
    jobs, anims = rf['frames'], rf['anims']
    body = set(rf['body'])
    # The order: the idle first (its frame that the survey found most consistent with the others stays as it is,
    # see the rework pack's canonical frame; else its first), then every move in play order.
    canon = None
    survey_file = ROOT / '.captures' / 'consistency' / 'survey.json'
    if survey_file.exists():
        s = next((r for r in json.loads(survey_file.read_text(encoding='utf-8'))['robots'] if r['robot'] == robot), None)
        canon = s and (s.get('canonical_idle') or [None])[0]
    idle = [j for j in anims.get(IDLE, []) if j in body]
    if canon not in idle:
        canon = idle[0] if idle else None
    order = ([canon] if canon else []) + [j for j in idle if j != canon]
    for anim, ids in anims.items():
        if anim == IDLE or (moves and anim not in moves):
            continue
        order += [j for j in ids if j in body and j not in order]
    # A frame's mates: the frames of every move it is part of.
    mates = {j: list(dict.fromkeys(i for anim, ids in anims.items() if anim != IDLE and j in ids for i in ids)) for j in order}
    frames, done, report = {}, set(), {}
    for j in order:
        f = frames[j] = Frame(pack, jobs[j])
        if j != canon:
            refs = [frames[i] for i in dict.fromkeys(([canon] if canon else []) + idle + mates[j]) if i in done]
            hd, share = steadied(f, refs)
            f.set(hd)
            report[j] = round(share, 3)
        done.add(j)
        dest = out / jobs[j]['output']
        dest.parent.mkdir(parents=True, exist_ok=True)
        Image.fromarray(f.rgba, 'RGBA').save(dest)
    print(f'{robot}: {len(done)} frames steadied in {time.time() - t0:.0f} s', flush=True)
    return {'robot': robot, 'frames': report, 'canonical': canon}


def delivery(pack: Path, out: Path, robots: list) -> None:
    """Makes the output folder a pack of its own: the robots' jobs of the HD asset pack (the frames the steadying
    changed as a rework delivery, 'redraw' jobs, for npm run rework:import; every other job of the robots with its
    painting copied, so tools/rework/survey.py --pack <out> measures them) and their sources."""
    manifest = load_manifest(pack)
    keep = []
    for j in manifest['jobs']:
        if not any(j['id'].startswith(f'fighter/{r}/') for r in robots):
            continue
        steadied_file = out / j['output']
        for key in ('source', 'output'):
            (out / j[key]).parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(pack / j['source'], out / j['source'])
        if steadied_file.exists() and not np.array_equal(np.asarray(Image.open(steadied_file).convert('RGBA')),
                                                         np.asarray(Image.open(pack / j['output']).convert('RGBA'))):
            keep.append({**j, 'mode': 'redraw'})
        else:
            # (not steadied, or left as it was: the projectiles, the canonical frame, frames nothing matched; copied
            # for the survey, not delivered)
            shutil.copyfile(pack / j['output'], steadied_file)
            keep.append({**j, 'mode': 'copy'})
    (out / 'manifest.json').write_text(json.dumps({**manifest, 'pack': 'consistency-rework', 'jobs': keep}), encoding='utf-8')
    # (the folders survey.py lists the moves by)
    for r in robots:
        for d in (pack / 'tier2_fighters' / r).iterdir():
            if d.is_dir():
                (out / 'tier2_fighters' / r / d.name).mkdir(parents=True, exist_ok=True)


def main() -> None:
    global SRC_TOL, SEAMS
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('--robots', required=True)
    ap.add_argument('--pack', default=str(ROOT / 'hd-pack'))
    ap.add_argument('--out', default=str(ROOT / '.captures' / 'steady'))
    ap.add_argument('--moves', help='only these moves (and the idle)')
    ap.add_argument('--tol', type=float, default=SRC_TOL, help='source match tolerance (0..255)')
    ap.add_argument('--seams', type=float, default=SEAMS, help='move regions in where the paintings differ by more (see above)')
    a = ap.parse_args()
    SRC_TOL, SEAMS = a.tol, a.seams
    pack, out = Path(a.pack).resolve(), Path(a.out).resolve()
    robots = [r.strip().upper() for r in a.robots.split(',') if r.strip()]
    moves = {int(m) for m in a.moves.split(',')} if a.moves else None
    # (a robot per process, each one core)
    with Pool(min(len(robots), max(1, (os.cpu_count() or 2) // 2)), initializer=_tune, initargs=(SRC_TOL, SEAMS)) as pool:
        results = pool.map(steady_robot, [(pack, r, out, moves) for r in robots])
    (out / 'steady.json').write_text(json.dumps(results, indent=1), encoding='utf-8')
    delivery(pack, out, robots)
    print(out)


def _tune(tol: float, seams) -> None:
    """(the workers' settings: on Windows they start afresh)"""
    global SRC_TOL, SEAMS
    SRC_TOL, SEAMS = tol, seams


if __name__ == '__main__':
    main()
