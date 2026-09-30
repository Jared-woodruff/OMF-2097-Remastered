"""Imports a delivered consistency rework pack into the HD asset pack, step 1 (npm run rework:import runs it all).

Every delivered frame of the rework pack (tier2_fighters/<ROBOT>/mNN_<move>/fNNN.hd.png) replaces the painting of the
same name in the HD asset pack (./hd-pack), at its delivered size (the job's size, or 2x or 3x of it like the current
paintings), clipped to its source's silhouette (one native pixel of slack, soft edge). The painting it replaces is kept
in hd-pack/rework-backup/ under the same path (the first one only, so the original survives repeated imports) and
listed in hd-pack/rework-backup/replaced.json. The design sheets are references: they are not imported.
--restore puts the backed-up paintings back (all, or those of --robots) and removes their backups.

Partial deliveries work: whatever is missing keeps its current painting. Writes <pack>/import_report.txt (deliveries
worth a look) and, with --result <file>, what was done (the HD bundles to rebuild, for tools/rework/import.mjs).

Usage: python tools/rework/import.py [<pack folder>] [--robots A,B] [--restore] [--result file.json]
Needs Python 3 with numpy and Pillow.
"""
import argparse
import hashlib
import json
import os
import shutil
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

Image.MAX_IMAGE_PIXELS = None
ROOT = Path(__file__).resolve().parent.parent.parent
HD_PACK = ROOT / 'hd-pack'
BACKUP = HD_PACK / 'rework-backup'
SX, SY = 5, 6
# The robot color zones by hue (tools/hd-pack/validate.py): steel blue, red, gold.
ZONES = {'steel blue': 205.0, 'red': 350.0, 'gold': 45.0}


def sha1(path: Path) -> str:
    return hashlib.sha1(path.read_bytes()).hexdigest()


def hsv(rgb: np.ndarray):
    """rgb floats 0..1 -> hue (degrees), saturation, value."""
    mx, mn = rgb.max(-1), rgb.min(-1)
    d = mx - mn
    safe = np.where(d > 1e-6, d, 1)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    h = np.where(r == mx, (g - b) / safe, np.where(g == mx, 2 + (b - r) / safe, 4 + (r - g) / safe))
    h = np.where(d > 1e-6, (h / 6) % 1 * 360, 0)
    return h, np.where(mx > 1e-6, d / np.maximum(mx, 1e-6), 0), mx


def hue_dist(a, b):
    d = np.abs(a - b) % 360
    return np.minimum(d, 360 - d)


def zones_kept(rgba: np.ndarray, source: np.ndarray, k: int) -> list:
    """Color zones of the source that the painting (scaled down to the source) does not keep in their hue."""
    sh, sw = source.shape[:2]
    a = rgba.astype(np.float32) / 255
    a[..., :3] *= a[..., 3:4]
    small = a.reshape(sh, SY * k, sw, SX * k, 4).mean((1, 3))
    alpha = small[..., 3]
    rgb = np.where(alpha[..., None] > 1e-3, small[..., :3] / np.maximum(alpha[..., None], 1e-3), 0)
    s = source.astype(np.float32) / 255
    hs, ss, vs = hsv(s[..., :3])
    hh, sh_, _ = hsv(rgb)
    both = (s[..., 3] > 0.5) & (alpha > 0.5)
    out = []
    for name, hue in ZONES.items():
        zone = both & (ss > 0.35) & (vs > 0.15) & (hue_dist(hs, hue) < 25)
        if zone.sum() >= 20:
            kept = float(((hue_dist(hh[zone], hue) < 30) & (sh_[zone] > 0.2)).mean())
            if kept < 0.75:
                out.append(f'only {kept:.0%} of the {name} zone kept its color')
    return out


def import_frame(pack: Path, job: dict):
    """The delivered painting ready for the HD asset pack, and what is worth a look."""
    w, h = job['width'], job['height']
    img = Image.open(pack / job['output'])
    img.load()
    rgba = np.array(img.convert('RGBA'))
    H, W = rgba.shape[:2]
    problems = []
    if abs((W / H) / (w / h) - 1) > 0.01:
        problems.append(f'{W} x {H} does not have the shape of {w} x {h} (stretched)')
    if W < w:
        problems.append(f'{W} x {H} is smaller than {w} x {h} (enlarged)')
    # (the fallback for tools without transparency: a flat magenta background)
    if rgba[..., 3].min() == 255:
        corners = rgba[[0, 0, -1, -1], [0, -1, 0, -1], :3].astype(np.int32)
        if (np.abs(corners - (255, 0, 255)).sum(1) < 60).all():
            dist = np.abs(rgba[..., :3].astype(np.int32) - (255, 0, 255)).sum(-1)
            rgba[..., 3] = np.clip((dist - 60) * 255 / 90, 0, 255).astype(np.uint8)
            problems.append('magenta background keyed out')
    # Kept at its size when that is 1x, 2x or 3x the game's (larger paintings serve future imports).
    k = min(3, max(1, round(W / w)))
    size = (w * k, h * k)
    img = Image.fromarray(rgba, 'RGBA')
    if img.size != size:
        img = img.convert('RGBa').resize(size, Image.LANCZOS).convert('RGBA')
    source = Image.open(pack / job['source']).convert('RGBA')
    native = source.getchannel('A').point(lambda v: 255 if v else 0)
    # The silhouette at this size, and with one native pixel of slack and a soft edge.
    exact = np.asarray(native.resize(size, Image.NEAREST)) > 0
    slack = native.filter(ImageFilter.MaxFilter(3)).resize(size, Image.NEAREST).filter(ImageFilter.GaussianBlur(2 * k))
    keep = np.asarray(slack, np.float32) / 255
    rgba = np.array(img)
    alpha = rgba[..., 3].astype(np.float32) / 255
    if alpha.min() > 0.99:
        problems.append('no transparency (cut to the silhouette)')
    else:
        outside = float((alpha * (1 - keep)).sum() / max(1.0, alpha.sum()))
        if outside > 0.03:
            problems.append(f'{outside:.0%} drawn outside the silhouette (cut)')
        fill = float(((alpha > 0.5) & exact).sum() / max(1, exact.sum()))
        if fill < 0.85:
            problems.append(f'fills {fill:.0%} of the silhouette')
    rgba[..., 3] = np.round(alpha * keep * 255).astype(np.uint8)
    problems += zones_kept(rgba, np.asarray(source), k)
    return Image.fromarray(rgba, 'RGBA'), problems


def robot_of(output: str) -> str:
    return output.split('/')[1]


def load_log() -> dict:
    path = BACKUP / 'replaced.json'
    return json.loads(path.read_text(encoding='utf-8')) if path.exists() else {}


def save_log(log: dict) -> None:
    BACKUP.mkdir(parents=True, exist_ok=True)
    (BACKUP / 'replaced.json').write_text(json.dumps(log, indent=1, sort_keys=True), encoding='utf-8')


def restore(robots: set) -> dict:
    """The backed-up paintings back into the HD asset pack (moved, so they keep their dates)."""
    log = load_log()
    done = []
    for bak in sorted(BACKUP.rglob('*.hd.png')) if BACKUP.exists() else []:
        rel = bak.relative_to(BACKUP).as_posix()
        if robots and robot_of(rel) not in robots:
            continue
        os.replace(bak, HD_PACK / rel)
        log.pop(rel, None)
        done.append(rel)
    for d in sorted((p for p in BACKUP.rglob('*') if p.is_dir()), key=lambda p: -len(p.parts)) if BACKUP.exists() else []:
        if not any(d.iterdir()):
            d.rmdir()
    if log:
        save_log(log)
    elif (BACKUP / 'replaced.json').exists():
        (BACKUP / 'replaced.json').unlink()
        if not any(BACKUP.iterdir()):
            BACKUP.rmdir()
    touched = sorted({robot_of(r) for r in done})
    print(f'restored {len(done)} painting(s): ' + (', '.join(touched) if touched else 'nothing was backed up'))
    return {'restored': len(done), 'robots': touched, 'bundles': [f'fighter-{r}' for r in touched]}


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('pack', nargs='?', default=str(ROOT / 'rework-pack'))
    ap.add_argument('--robots', default='')
    ap.add_argument('--restore', action='store_true')
    ap.add_argument('--result', default='')
    args = ap.parse_args()
    robots = {r.strip().upper() for r in args.robots.split(',') if r.strip()}
    if not (HD_PACK / 'jobs.jsonl').exists():
        sys.exit(f'the rework is imported into the HD asset pack: {HD_PACK} not found')

    if args.restore:
        result = restore(robots)
    else:
        pack = Path(args.pack).resolve()
        manifest_path = pack / 'manifest.json'
        if not manifest_path.exists():
            sys.exit(f'{pack}: no manifest.json (make the pack with npm run rework:export)')
        manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
        if manifest.get('pack') != 'consistency-rework':
            sys.exit(f'{pack} is not a consistency rework pack (npm run rework:export)')
        frames = [j for j in manifest['jobs'] if j['mode'] == 'redraw' and (not robots or robot_of(j['output']) in robots)]
        delivered = [j for j in frames if (pack / j['output']).exists()]
        designs = [j for j in manifest['jobs'] if j['mode'] == 'design' and (pack / j['output']).exists()]
        log = load_log()
        report, counts = [], {}
        stamp = time.strftime('%Y-%m-%d %H:%M')
        for n, job in enumerate(delivered, 1):
            img, problems = import_frame(pack, job)
            if problems:
                report.append(f"{job['output']}: {'; '.join(problems)}")
            dst = HD_PACK / job['output']
            bak = BACKUP / job['output']
            if dst.exists() and not bak.exists():
                bak.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(dst, bak)
            img.save(dst)
            entry = log.setdefault(job['output'], {'original': sha1(bak) if bak.exists() else None, 'imports': []})
            entry['imports'].append({'date': stamp, 'delivered': sha1(pack / job['output']), 'size': list(img.size)})
            counts[robot_of(job['output'])] = counts.get(robot_of(job['output']), 0) + 1
            if n % 50 == 0:
                print(f'  {n} / {len(delivered)} frames', flush=True)
        if delivered:
            save_log(log)
        (pack / 'import_report.txt').write_text('\n'.join(report) + '\n' if report else 'nothing to report\n', encoding='utf-8')
        for h in sorted({robot_of(j['output']) for j in frames}):
            total = sum(1 for j in frames if robot_of(j['output']) == h)
            got = counts.get(h, 0)
            sheet = any(robot_of(j['output']) == h for j in designs)
            print(f"{h}: {got} of {total} frames delivered{' (the rest keep their paintings)' if 0 < got < total else ''}"
                  f"{', design sheet delivered' if sheet else ''}")
        if not delivered:
            print('nothing delivered yet (no fNNN.hd.png in the pack)')
        else:
            print(f'{len(delivered)} painting(s) replaced in {HD_PACK} (the replaced ones are in {BACKUP})')
        if report:
            print(f'{len(report)} delivery(ies) worth a look: {pack / "import_report.txt"}')
        result = {'imported': len(delivered), 'robots': sorted(counts), 'bundles': [f'fighter-{h}' for h in sorted(counts)]}
    if args.result:
        Path(args.result).write_text(json.dumps(result), encoding='utf-8')


if __name__ == '__main__':
    main()
