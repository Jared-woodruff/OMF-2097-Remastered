"""Imports the new-art pack's deliveries into the game, step 1 (npm run newart:import [-- <pack folder>] runs it all):

- Arenas (arenas/<NAME>/arena.hd.png): the painting becomes the arena's HD backgrounds (public/gen/ARENAn-WIDE.webp,
  and its 4:3 middle ARENAn-HD.webp) and, scaled to the native 576 x 200, the picture its scene file is made from
  (src/gen/scene/art/ARENAn.png: `npm run gen` rebuilds ARENAn.BK and .WID from it, the classic graphics and the
  colors the HD painting is recolored through).
- Robots (tier2_fighters/<ROBOT>/mNN_<move>/fNNN.hd.png): each frame at its size and clipped to its source's
  silhouette (one native pixel of slack), copied into the HD asset pack (./hd-pack, whose jobs.jsonl gets their jobs),
  to be imported with it.

Partial deliveries work: whatever is missing keeps its current artwork. Writes <pack>/import.json (what was imported,
for tools/newart/import.mjs) and <pack>/import_report.txt (deliveries worth a look).
Usage: python tools/newart/import.py <pack folder>          Needs Python 3 with numpy and Pillow.
"""
import json
import re
import shutil
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

Image.MAX_IMAGE_PIXELS = None
ROOT = Path(__file__).resolve().parent.parent.parent
GEN = ROOT / 'public' / 'gen'
ART = ROOT / 'src' / 'gen' / 'scene' / 'art'
HD_PACK = ROOT / 'hd-pack'

ARENA_W, ARENA_H = 2880, 1200
CLASSIC = (640, 2240)
NATIVE = (576, 200)
SX, SY = 5, 6


def import_arena(pack: Path, job: dict, report: list) -> str:
    file = re.search(r'\((ARENA\d)\)', job['title']).group(1)
    img = Image.open(pack / job['output']).convert('RGB')
    if img.size != (ARENA_W, ARENA_H):
        if abs(img.width / img.height / (ARENA_W / ARENA_H) - 1) > 0.02:
            report.append(f"{job['output']}: {img.width} x {img.height}, not {ARENA_W} x {ARENA_H}: stretched to fit")
        img = img.resize((ARENA_W, ARENA_H), Image.LANCZOS)
    # (the composition should be the guide's: compare the big shapes)
    small = lambda im: np.asarray(im.convert('L').resize((144, 60), Image.BOX), np.float32).ravel()
    similarity = np.corrcoef(small(img), small(Image.open(pack / job['guide'])))[0, 1]
    if similarity < 0.4:
        report.append(f"{job['output']}: the composition differs from guide.png (similarity {similarity:.2f}): check the floor line and the landmarks")
    img.save(GEN / f'{file}-WIDE.webp', 'WEBP', quality=90, method=6)
    img.crop((CLASSIC[0], 0, CLASSIC[1], ARENA_H)).save(GEN / f'{file}-HD.webp', 'WEBP', quality=90, method=6)
    ART.mkdir(parents=True, exist_ok=True)
    img.resize(NATIVE, Image.LANCZOS).save(ART / f'{file}.png', optimize=True)
    print(f"{job['id']}: {file}-WIDE.webp, {file}-HD.webp, src/gen/scene/art/{file}.png")
    return file


def import_frame(pack: Path, job: dict, report: list) -> None:
    w, h = job['width'], job['height']
    img = Image.open(pack / job['output']).convert('RGBA')
    if img.size != (w, h):
        img = img.resize((w, h), Image.LANCZOS)
    native = Image.open(pack / job['source']).convert('RGBA').getchannel('A').point(lambda a: 255 if a else 0)
    # The silhouette at the HD size, and with one native pixel of slack and a soft edge.
    exact = np.asarray(native.resize((w, h), Image.NEAREST)) > 0
    slack = native.filter(ImageFilter.MaxFilter(3)).resize((w, h), Image.NEAREST).filter(ImageFilter.GaussianBlur(2))
    keep = np.asarray(slack, np.float32) / 255
    rgba = np.array(img)
    alpha = rgba[..., 3].astype(np.float32) / 255
    problems = []
    if alpha.min() > 0.99:
        problems.append('no transparency (cut to the silhouette)')
    else:
        outside = float((alpha * (1 - keep)).sum() / max(1.0, alpha.sum()))
        if outside > 0.03:
            problems.append(f'{outside:.0%} drawn outside the silhouette (cut)')
        fill = float(((alpha > 0.5) & exact).sum() / max(1, exact.sum()))
        if fill < 0.85:
            problems.append(f'fills {fill:.0%} of the silhouette')
    if problems:
        report.append(f"{job['output']}: {'; '.join(problems)}")
    rgba[..., 3] = np.round(alpha * keep * 255).astype(np.uint8)
    dst = HD_PACK / job['output']
    dst.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(rgba, 'RGBA').save(dst)


def bundle_of(output: str) -> str:
    """The HD bundle an image goes to (like tools/hd-pack/intake-meta.test.ts)."""
    root, sub = output.split('/')[:2]
    return f'fighter-{sub}' if root == 'tier2_fighters' else 'effects'


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    pack = Path(sys.argv[1]).resolve()
    manifest = json.loads((pack / 'manifest.json').read_text(encoding='utf-8'))
    if manifest.get('pack') != 'new-art':
        sys.exit(f'{pack} is not a new-art pack (npm run newart:export)')
    report: list = []
    delivered = lambda job: (pack / job['output']).exists()

    arenas = [import_arena(pack, j, report) for j in manifest['jobs'] if j['kind'] == 'arena' and delivered(j)]

    # The robots' frames: the jobs of the catalog's images (not the design sheets), as jobs.jsonl has them.
    lines = [line for line in (pack / 'jobs.jsonl').read_text(encoding='utf-8').splitlines() if line.strip()]
    frames = [(line, json.loads(line)) for line in lines]
    frames = [(line, j) for line, j in frames if j['id'].startswith(('fighter/', 'effect/')) and delivered(j)]
    bundles: dict = {}
    if frames:
        if not (HD_PACK / 'jobs.jsonl').exists():
            sys.exit(f'the robots are imported with the HD asset pack: {HD_PACK} not found')
        for k, (_, job) in enumerate(frames):
            import_frame(pack, job, report)
            b = bundle_of(job['output'])
            bundles[b] = bundles.get(b, 0) + 1
            if (k + 1) % 100 == 0:
                print(f'  {k + 1} / {len(frames)} frames', flush=True)
        # Their jobs into the HD asset pack's list (replacing earlier ones; the list before the first merge is kept).
        jobs_path = HD_PACK / 'jobs.jsonl'
        backup = HD_PACK / 'jobs.before-newart.jsonl'
        if not backup.exists():
            shutil.copyfile(jobs_path, backup)
        merged = {json.loads(line)['id']: line for line in jobs_path.read_text(encoding='utf-8').splitlines() if line.strip()}
        for line, job in frames:
            merged[job['id']] = line
        jobs_path.write_text('\n'.join(merged.values()) + '\n', encoding='utf-8')
        print('frames: ' + ', '.join(f'{b} {n}' for b, n in sorted(bundles.items())) + ' (copied into hd-pack)')

    (pack / 'import.json').write_text(json.dumps({'arenas': arenas, 'bundles': sorted(bundles)}, indent=1), encoding='utf-8')
    (pack / 'import_report.txt').write_text('\n'.join(report) + '\n' if report else 'nothing to report\n', encoding='utf-8')
    if not arenas and not frames:
        print('nothing delivered yet (no *.hd.png in the pack)')
    if report:
        print(f'{len(report)} delivery(ies) worth a look: {pack / "import_report.txt"}')


if __name__ == '__main__':
    main()
