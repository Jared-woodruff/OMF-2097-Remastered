"""Scores Blender renderings of a robot against its current HD paintings with the HD packs' own checks.

For one robot of an HD pack (the new-art pack for the remaster's robots), two packs of its frames are put together
in the output folder, the same sources and jobs, only the pictures differ:
  blender/   the renderings (tools/blender/render_frames.py --pack <pack>: the jobs' names, masks next to them)
  current/   the current paintings (the HD asset pack's, as the game has them)
and both go through tools/rework/survey.py (how consistently each frame shows what its source shows, from frame to
frame; 0 = the same detail) and tools/hd-pack/validate.py (silhouette, colors, color zones against the sources).
The renderings' zone masks are checked against the sources' color zones too. Writes <out>/score.json and prints a
comparison.

Usage: python tools/blender/score.py --robot HELIX --renders <folder> [--pack newart-pack] [--current hd-pack]
       [--out .captures/blender/score]          Needs Python 3 with numpy and Pillow.
"""
import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT / 'tools' / 'hd-pack'))
from validate import REF_HUES, downscale, hue_dist, rgb_to_hsv  # noqa: E402

# The zone masks' channels (render_frames.py): R = secondary, G = tertiary, B = primary.
MASK_CHANNEL = {'secondary': 0, 'tertiary': 1, 'primary': 2}


def make_pack(src: Path, ids: set, pictures: Path, out: Path) -> list:
    """A pack of the given jobs: the source pack's manifest entries, job lines and sources, with the given pictures."""
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    manifest = json.loads((src / 'manifest.json').read_text(encoding='utf-8'))
    (out / 'manifest.json').write_text(json.dumps({**manifest, 'jobs': [j for j in manifest['jobs'] if j['id'] in ids]}), encoding='utf-8')
    lines = [line for line in (src / 'jobs.jsonl').read_text(encoding='utf-8').splitlines() if line.strip() and json.loads(line)['id'] in ids]
    for line in lines:
        job = json.loads(line)
        for key in ('source', 'output'):
            (out / job[key]).parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src / job['source'], out / job['source'])
        shutil.copyfile(pictures / job['output'], out / job['output'])
    (out / 'jobs.jsonl').write_text('\n'.join(lines) + '\n', encoding='utf-8')
    return [json.loads(line) for line in lines]


def mask_agreement(pack: Path, renders: Path, jobs: list) -> dict:
    """Share of the sources' zone pixels (classified by hue, like validate.py) that their mask covers and shows as the
    same zone. A frame whose mask is missing counts as missing all of its zone pixels (and is listed)."""
    hit = total = 0
    worst, missing = [], []
    for job in jobs:
        src = np.asarray(Image.open(pack / job['source']).convert('RGBA'), np.float64) / 255
        hs, ss, vs = rgb_to_hsv(src[..., :3])
        zones = {zone: (src[..., 3] > 0.5) & (ss > 0.35) & (vs > 0.15) & (hue_dist(hs, zh) < 25) for zone, zh in REF_HUES.items()}
        n = sum(int(m.sum()) for m in zones.values())
        h = 0
        mask_path = renders / (job['output'][:-len('.hd.png')] + '.mask.png')
        if mask_path.exists():
            mask = np.asarray(Image.open(mask_path).convert('RGBA'), np.float64) / 255
            mask[..., :3] *= mask[..., 3:4]
            small = downscale(mask, src.shape[1], src.shape[0])[..., :3]
            # Only where the zones cover most of the pixel: uncovered pixels (all channels 0) would pick channel 0.
            covered = small.sum(-1) > 0.5
            best = small.argmax(-1)
            h = sum(int((m & covered & (best == MASK_CHANNEL[zone])).sum()) for zone, m in zones.items())
        else:
            missing.append(job['id'])
        hit, total = hit + h, total + n
        worst.append((h / max(1, n), job['id']))
    worst.sort()
    return {'agreement': round(hit / max(1, total), 4), 'pixels': total, 'missing': missing,
            'worst': [(round(a, 3), j) for a, j in worst[:5]]}


def validation_summary(pack: Path) -> dict:
    res = [r for r in json.loads((pack / 'validation.json').read_text(encoding='utf-8')) if 'alpha_iou' in r]
    med = lambda k: round(float(np.median([r[k] for r in res])), 4)  # noqa: E731
    zones = [v['kept'] for r in res for v in r.get('zones', {}).values()]
    return {'frames': len(res), 'alpha_iou': med('alpha_iou'), 'spill': med('spill'), 'holes': med('holes'),
            'color_mae': med('color_mae'), 'lum_src': med('lum_src'), 'lum_hd': med('lum_hd'),
            'zones_kept': round(float(np.median(zones)), 3) if zones else None,
            'zones_below_0.8': int(sum(z < 0.8 for z in zones))}


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('--robot', required=True)
    ap.add_argument('--renders', required=True, help='render_frames.py --pack output folder')
    ap.add_argument('--pack', default=str(ROOT / 'newart-pack'))
    ap.add_argument('--current', default=str(ROOT / 'hd-pack'), help='where the current paintings are (same job paths)')
    ap.add_argument('--out', default=str(ROOT / '.captures' / 'blender' / 'score'))
    ap.add_argument('--no-pictures', action='store_true', help="skip survey.py's contact sheets and hotspot maps")
    a = ap.parse_args()
    robot, out = a.robot.upper(), Path(a.out).resolve()
    renders = Path(a.renders).resolve()
    src, current = Path(a.pack).resolve(), Path(a.current).resolve()
    # The robot's frames that have both a rendering and a current painting (the renderings leave out the effects and
    # the menu pictures): the same jobs in both packs.
    manifest = json.loads((src / 'manifest.json').read_text(encoding='utf-8'))
    ids = {j['id'] for j in manifest['jobs'] if j['id'].startswith(f'fighter/{robot}/')
           and (renders / j['output']).exists() and (current / j['output']).exists()}
    if not ids:
        sys.exit(f'no renderings of {robot} under {renders} with paintings under {current}')
    result = {'robot': robot}
    for name, pictures in (('blender', renders), ('current', current)):
        pack = out / name
        jobs = make_pack(src, ids, pictures, pack)
        print(f'{name}: {len(jobs)} frames', flush=True)
        survey = [sys.executable, str(ROOT / 'tools' / 'rework' / 'survey.py'), '--pack', str(pack), '--out',
                  str(pack / 'survey'), '--robots', robot] + (['--no-pictures'] if a.no_pictures else [])
        subprocess.run(survey, check=True, stdout=subprocess.DEVNULL)
        subprocess.run([sys.executable, str(ROOT / 'tools' / 'hd-pack' / 'validate.py'), str(pack)], check=True,
                       stdout=subprocess.DEVNULL)
        s = next(r for r in json.loads((pack / 'survey' / 'survey.json').read_text(encoding='utf-8'))['robots'] if r['robot'] == robot)
        al = s['all']
        result[name] = {
            'survey': {'score': al['score'], 'fine': al.get('fine', {}).get('excess'), 'mid': al.get('mid', {}).get('excess'),
                       'T': al['T'], 'blocks': al['blocks'], 'vs_idle': s['vs_idle']['score'], 'idle_coverage': s['idle_coverage']},
            'validate': validation_summary(pack),
        }
        if name == 'blender':
            result[name]['masks'] = mask_agreement(pack, renders, jobs)
    (out / 'score.json').write_text(json.dumps(result, indent=1), encoding='utf-8')
    b, c = result['blender'], result['current']
    rows = [('inconsistency (survey score, 0 = same)', 'survey', 'score'), ('  fine detail band', 'survey', 'fine'),
            ('  structure band', 'survey', 'mid'), ('  against the idle frames', 'survey', 'vs_idle'),
            ('silhouette IoU (median)', 'validate', 'alpha_iou'), ('drawn outside the source (spill)', 'validate', 'spill'),
            ('holes in the silhouette', 'validate', 'holes'), ('color MAE vs source (0-255)', 'validate', 'color_mae'),
            ('brightness (the sources: {src})', 'validate', 'lum_hd'), ('color zones kept (median)', 'validate', 'zones_kept'),
            ('zones below 0.8', 'validate', 'zones_below_0.8')]
    print(f"\n{robot}: {b['validate']['frames']} frames{'':22s}{'Blender':>10s}{'current':>10s}")
    fmt = lambda v: '-' if v is None else f'{v:.3f}' if isinstance(v, float) else str(v)  # noqa: E731
    for label, group, key in rows:
        print(f"{label.format(src=b['validate']['lum_src']):42s}{fmt(b[group][key]):>10s}{fmt(c[group][key]):>10s}")
    m = b['masks']
    print(f"zone masks agreeing with the sources' zones: {m['agreement']:.3f} of {m['pixels']} pixels")
    if m['missing']:
        print(f"{len(m['missing'])} zone masks missing (counted as disagreeing), e.g. {m['missing'][0]}")
    print(out / 'score.json')


if __name__ == '__main__':
    main()
