"""Builds the consistency rework pack (npm run rework:export): the original robots whose HD paintings disagree from
frame to frame, handed to the image AI again the way the new robots were painted (tools/newart): per robot one design
sheet first (the robot in its fighting stance at twice the frame scale, made from its best current painting and its
source: the definitive design), then every frame of the robot redrawn from it ('redraw' jobs). See the README in the
generated folder; the briefs are in tools/rework/briefs.py, the measurements in tools/rework/survey.py.

Everything comes from the HD asset pack (./hd-pack: the sources, the animation sheets, the current paintings) and the
consistency survey (.captures/consistency, run first when it is missing). Writes <out>/ and <out>.zip.

Usage: python tools/rework/export.py [--robots GARGOYLE,FLAIL,ELECTRA] [--out rework-pack] [--force]
       (--force: rebuild the folder although it holds deliveries, which are deleted)
Needs Python 3 with numpy and Pillow.
"""
import argparse
import csv
import io
import json
import shutil
import subprocess
import sys
import time
from pathlib import Path

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))
import briefs as B  # noqa: E402
import survey as S  # noqa: E402

Image.MAX_IMAGE_PIXELS = None
ROOT = Path(__file__).resolve().parent.parent.parent
HD_PACK = ROOT / 'hd-pack'
SURVEY = ROOT / '.captures' / 'consistency'
BG = (30, 32, 40)
PAD = 4  # the sources' transparent margin (native pixels), like the HD asset pack's

MODE_TEXT = {
    'design': 'design sheet — settle the robot\'s definitive look: img2img from `guide.png` at denoise ≈ 0.3–0.5 (correct '
              'it, do not reinvent it) or reference-guided generation; pose, silhouette, facing and color zones of '
              '`source.png` locked',
    'redraw': 'redraw from the design sheet — pose, silhouette, facing and color zones of the source locked, every detail '
              'from `../design/design.hd.png` (img2img denoise ≈ 0.45–0.6 from the enlarged source with the design '
              'sheet as the reference image, or reference-guided generation; parts that keep their shape can be '
              'carried over from the design sheet with rigid transforms)',
}


def write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(text.replace('\r\n', '\n').replace('\n', '\r\n').encode('utf-8'))


def prompt_doc(title: str, output: str, mode: str, prompt: str, negative: str, inputs: list, notes: list) -> str:
    return '\n'.join([
        f'# {title}', '',
        f'- **Output:** {output}',
        f'- **Mode:** {MODE_TEXT[mode]}', '',
        '## Inputs', '', *[f'- {i}' for i in inputs], '',
        '## Prompt', '', prompt, '',
        '## Negative prompt', '', negative, '',
        '## Notes', '', *[f'- {n}' for n in notes], '',
    ])


def painting(job: dict, size=None) -> Image.Image:
    """A current painting (straight RGBA) at the job's size or the given one."""
    im = S.straight(S.load_hd(HD_PACK, job))
    return im if size is None or im.size == size else im.convert('RGBa').resize(size, Image.LANCZOS).convert('RGBA')


def labeled_row(cells: list, title: str, scale: float, per_row: int = 8, with_source: bool = False) -> Image.Image:
    """Pictures side by side (in rows of per_row) with their names under them, on a dark background.
    cells: [(job, name)]."""
    font = S.font
    items = []
    for job, name in cells:
        size = (max(1, round(job['width'] * scale)), max(1, round(job['height'] * scale)))
        pics = [painting(job, size)]
        if with_source:
            pics.insert(0, Image.open(HD_PACK / job['source']).convert('RGBA').resize((job['width'], job['height']), Image.NEAREST).resize(size, Image.BOX))
        items.append((pics, name))
    gap = 12
    rows = [items[k:k + per_row] for k in range(0, len(items), per_row)]
    heights = [max(p.height for pics, _ in row for p in pics) for row in rows]
    n = len(items[0][0])
    width = max(max(sum(pics[0].width for pics, _ in row) + gap * (len(row) + 1) for row in rows), 700)
    # the title, wrapped to the width
    f = font(18)
    measure = ImageDraw.Draw(Image.new('RGB', (1, 1)))
    lines, line = [], ''
    for word in title.split():
        if line and measure.textlength(f'{line} {word}', font=f) > width - 2 * gap:
            lines.append(line)
            line = word
        else:
            line = f'{line} {word}'.strip()
    lines.append(line)
    top = 16 + 24 * len(lines)
    out = Image.new('RGBA', (width, top + sum(n * (h + gap) + 22 for h in heights) + gap), BG + (255,))
    d = ImageDraw.Draw(out)
    for k, text in enumerate(lines):
        d.text((gap, 10 + 24 * k), text, fill=(235, 235, 240), font=f)
    y = top
    for row, h in zip(rows, heights):
        x = gap
        for pics, name in row:
            for k, p in enumerate(pics):
                out.alpha_composite(p, (x, y + k * (h + gap) + h - p.height))
            d.text((x, y + n * (h + gap) - 6), name, fill=(150, 155, 170), font=font(13))
            x += pics[0].width + gap
        y += n * (h + gap) + 22
    return out


def lineup(jobs: list, scale: float = 0.8, gap: int = 48) -> Image.Image:
    """The robots side by side at one scale, standing on one line, in two rows (like tools/newart/prepare.py)."""
    pics = []
    for job in jobs:
        p = painting(job)
        p = p.crop(p.getchannel('A').getbbox())
        pics.append(p.resize((round(p.width * scale), round(p.height * scale)), Image.LANCZOS))
    half = (len(pics) + 1) // 2
    rows = [pics[:half], pics[half:]]
    heights = [max(p.height for p in r) for r in rows]
    width = max(sum(p.width for p in r) + gap * (len(r) + 1) for r in rows)
    out = Image.new('RGBA', (width, sum(heights) + gap * 3), BG + (255,))
    y = gap
    for r, h in zip(rows, heights):
        x = (width - (sum(p.width for p in r) + gap * (len(r) - 1))) // 2
        for p in r:
            out.alpha_composite(p, (x, y + h - p.height))
            x += p.width + gap
        y += h + gap
    return out.convert('RGB')


def generic_robot(h: str, frames: dict) -> B.Robot:
    """A robot without a written brief: its description from the HD asset pack, the design from its best painting."""
    some = next(iter(frames.values()))
    desc = some['prompt'].split(', from the robot fighting game')[0].split(', ', 1)[-1]
    name = h.capitalize()
    return B.Robot(
        name=name, file=f'FIGHTR{S.ORIGINAL_ROBOTS.index(h)}.AF', description=desc, design_frame=None,
        zones={'blue': 'the parts that are steel blue in the source', 'red': 'the parts that are red in the source',
               'gold': 'the parts that are gold in the source'},
        parts=['Every part as in `guide.png`, corrected where it disagrees with `source.png`: fix the number of every '
               'repeated part (ribs, spikes, rivets, segments), the plate lines, panel shapes, joints and bolts.'],
        summary='the design sheet\'s parts, counts, plate lines, panel shapes, joints and bolts',
        varies='the details of its armor (see reference/consistency)')


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('--robots', default=','.join(B.DEFAULT_ROBOTS))
    ap.add_argument('--out', default=str(ROOT / 'rework-pack'))
    ap.add_argument('--force', action='store_true')
    args = ap.parse_args()
    robots = [r.strip().upper() for r in args.robots.split(',') if r.strip()]
    for h in robots:
        if h not in S.ORIGINAL_ROBOTS:
            sys.exit(f'{h}: not one of the original robots ({", ".join(S.ORIGINAL_ROBOTS)})')
    out = Path(args.out).resolve()
    if not (HD_PACK / 'manifest.json').exists():
        sys.exit(f'the rework pack is made from the HD asset pack: {HD_PACK} not found')
    delivered = [p for p in out.rglob('*.hd.png')] + [p for p in out.rglob('design_notes.md')] if out.exists() else []
    if delivered and not args.force:
        sys.exit(f'{out} holds {len(delivered)} delivered file(s) ({delivered[0].relative_to(out)}, ...): import them first '
                 '(npm run rework:import), or pass --force to rebuild the pack without them')
    t0 = time.time()

    # The survey (scores, the evidence pictures): run it for the robots it has not measured yet.
    survey_path = SURVEY / 'survey.json'
    measured = {r['robot']: r for r in json.loads(survey_path.read_text(encoding='utf-8'))['robots']} if survey_path.exists() else {}
    missing = [h for h in robots if h not in measured]
    if missing:
        print(f'measuring {", ".join(missing)} first (tools/rework/survey.py)...', flush=True)
        subprocess.run([sys.executable, str(Path(__file__).with_name('survey.py')), '--robots', ','.join(missing)], check=True)
        measured = {r['robot']: r for r in json.loads(survey_path.read_text(encoding='utf-8'))['robots']}

    out.mkdir(parents=True, exist_ok=True)
    for e in out.iterdir():
        shutil.rmtree(e) if e.is_dir() else e.unlink()
    manifest = S.load_manifest(HD_PACK)
    jobs, design_jobs, counts, chosen = [], [], {}, {}
    for h in robots:
        rf = S.robot_frames(HD_PACK, h, manifest)
        frames = rf['frames']
        r = B.ROBOTS.get(h) or generic_robot(h, frames)
        res = measured.get(h)
        folder = lambda jid: frames[jid]['group'].rsplit('/', 1)[1]  # noqa: E731
        body = [j for j in rf['body'] if folder(j) not in r.effects]
        design_frame = r.design_frame or (res['canonical_idle'][0].split('/', 2)[2] if res else None)
        if design_frame is None:
            idle = rf['anims'][S.IDLE]
            design_frame = idle[(len(idle) - 1) // 2].split('/', 2)[2]
        djob = frames[f'fighter/{h}/{design_frame}']
        chosen[h] = design_frame
        base = out / 'tier2_fighters' / h

        # ---- The design sheet ----------------------------------------------------------------------------------
        ddir = base / 'design'
        ddir.mkdir(parents=True)
        shutil.copyfile(HD_PACK / djob['source'], ddir / 'source.png')
        src = Image.open(HD_PACK / djob['source'])
        size = (src.width * S.SX * 2, src.height * S.SY * 2)
        full = Image.open(HD_PACK / djob['output']).convert('RGBA')
        guide = full.convert('RGBa').resize(size, Image.LANCZOS).convert('RGBA') if full.size != size else full
        guide.save(ddir / 'guide.png', optimize=True)
        idle = [j for j in rf['anims'][S.IDLE] if j in body]
        labeled_row([(frames[j], j.split('/', 2)[2] + (' (guide.png)' if j == djob['id'] else '')) for j in idle],
                    f'{r.name}: the current idle paintings (sources above) disagree about {r.varies}.', 0.6, 5,
                    with_source=True).convert('RGB').save(ddir / 'current_idle.png', optimize=True)
        if (SURVEY / 'hotspots' / f'{h}.jpg').exists():
            shutil.copyfile(SURVEY / 'hotspots' / f'{h}.jpg', ddir / 'hotspots.jpg')
        dout = 'design/design.hd.png'
        prompt = B.design_prompt(r)
        design_job = {
            'id': f'design/{h}', 'tier': 2, 'kind': 'design', 'title': f'{r.name} — design sheet',
            'source': f'tier2_fighters/{h}/design/source.png', 'guide': f'tier2_fighters/{h}/design/guide.png', 'mask': None,
            'output': f'tier2_fighters/{h}/{dout}', 'width': size[0], 'height': size[1], 'transparent': True,
            'mode': 'design', 'prompt': prompt, 'negativePrompt': B.NEGATIVE, 'promptFile': f'tier2_fighters/{h}/design/prompt.md',
            'group': None, 'consistencyGroup': f'tier2_fighters/{h}', 'frameIndex': None, 'frameCount': None,
            'native': djob['native'], 'recolor': djob['recolor'], 'hash': djob['hash'], 'usages': [],
            'reference': None, 'current': f'tier2_fighters/{h}/design/current_idle.png', 'madeFrom': djob['id'],
        }
        write_text(ddir / 'prompt.md', prompt_doc(
            f'{r.name} — design sheet (the definitive design)', f'`design.hd.png` — {size[0]} × {size[1]} px, PNG with transparency',
            'design', prompt, B.NEGATIVE,
            ['`source.png`: the source frame (the idle stance, 4 transparent pixels around it): pose, silhouette, facing, color zones.',
             f'`guide.png`: the current painting of this frame (`{design_frame}`), enlarged to the output size: the painting '
             'that agrees best with the robot\'s other paintings and with its source. The starting point.',
             '`current_idle.png`: all current idle paintings with their sources: what disagrees.',
             *(['`hotspots.jpg`: where the current paintings disagree although their sources agree (red = unrelated detail).']
               if (ddir / 'hotspots.jpg').exists() else []),
             '`../reference_sheet.png`: the key poses; `../../../reference/original_robots.png`: all original robots, the finish.'],
            [f'Do this first: it fixes {r.name}\'s design for all {len(body)} frames. Have it approved by the game\'s author '
             'before the frames are painted.',
             'Keep what `guide.png` has where it matches `source.png`; correct it where it does not; make every repeated part '
             'regular and countable. Do not average the current paintings: decide.',
             'Keep the silhouette, the pose, the facing direction and the color zones of `source.png` (twice the frame scale: '
             f'{S.SX * 2} × {S.SY * 2} output pixels per source pixel).',
             f'Write down what you settled in `design_notes.md` (this folder): for {r.name}, the counts of every repeated part '
             '(ribs, spikes, fangs, turns, bolts), the plate lines and facets. Every frame copies it.',
             'Not used in the game: the reference for the frames.']))
        design_jobs.append(design_job)

        # ---- The frames, per move folder ----------------------------------------------------------------------
        by_folder: dict = {}
        for j in body:
            by_folder.setdefault(frames[j]['group'], []).append(j)
        for group in sorted(by_folder):
            ids = sorted(by_folder[group], key=lambda j: frames[j]['source'])
            move = group.rsplit('/', 1)[1]
            mdir = out / group
            mdir.mkdir(parents=True)
            for name in ('sheet.png', 'sheet_preview.png'):
                if (HD_PACK / group / name).exists():
                    shutil.copyfile(HD_PACK / group / name, mdir / name)
            rows = ['frame_in_animation,source,output,width,height']
            for j in ids:
                job = frames[j]
                shutil.copyfile(HD_PACK / job['source'], out / job['source'])
                rows.append(f"{job['frameIndex']},{Path(job['source']).name},{Path(job['output']).name},{job['width']},{job['height']}")
            write_text(mdir / 'frames.csv', '\n'.join(rows) + '\n')
            labeled_row([(frames[j], Path(frames[j]['source']).stem) for j in ids],
                        f'{r.name}, {move}: the current paintings (for the level of finish only: their details disagree)',
                        0.5).convert('RGB').save(mdir / 'current.png', optimize=True)
            anim = int(move[1:3])
            prompt = B.frame_prompt(r, move)
            n_anim = len(rf['anims'].get(anim, ids))
            for j in ids:
                job = frames[j]
                count = job['frameCount'] or 1
                jobs.append({
                    'id': j, 'tier': 2, 'kind': 'fighter', 'title': f'{r.name} — {B.describe_move(move)} ({r.file} move {anim})',
                    'source': job['source'], 'guide': None, 'mask': None, 'output': job['output'], 'width': job['width'],
                    'height': job['height'], 'transparent': True, 'mode': 'redraw',
                    'prompt': prompt + (f" Frame {job['frameIndex'] + 1} of {count}." if count > 1 else ''),
                    'negativePrompt': B.NEGATIVE, 'promptFile': f'{group}/prompt.md', 'group': group,
                    'consistencyGroup': f'tier2_fighters/{h}', 'frameIndex': job['frameIndex'], 'frameCount': job['frameCount'],
                    'native': job['native'], 'recolor': job['recolor'], 'hash': job['hash'], 'usages': job['usages'],
                    'reference': f'tier2_fighters/{h}/{dout}', 'current': f'{group}/current.png',
                })
            shared = n_anim - len(ids)
            write_text(mdir / 'prompt.md', prompt_doc(
                f'{r.name} — {B.describe_move(move)} ({r.file} move {anim})',
                'one `fNNN.hd.png` next to each `fNNN.png` in this folder (sizes in `frames.csv`, or exactly 2× or 3× them), '
                'PNG with transparent background', 'redraw', prompt, B.NEGATIVE,
                ['`fNNN.png`: the source frames (pose, silhouette, facing, color zones), 4 transparent pixels around them.',
                 '`../design/design.hd.png`: the robot\'s design sheet (and `../design/design_notes.md`): every detail.',
                 '`sheet.png` / `sheet_preview.png`: the whole animation in play order (native / correct proportions).',
                 '`current.png`: the current paintings of these frames: the level of finish only, their details disagree.'],
                [f'{len(ids)} frame(s) here' + (f'; {shared} more frame(s) of this animation are stored in other folders.' if shared > 0 else '.'),
                 f'Every frame is the robot of `../design/design.hd.png`: {r.summary}. Count the repeated parts against it.',
                 f'Process all frames of {r.name} with the same model, settings and seed, the design sheet as the reference image.',
                 'The game recolors the steel blue / red / gold zones (players pick the colors): keep them exactly where the '
                 'source has them, in their hue families.',
                 f'Stay inside the source\'s outline (enlarged); its transparent margin of {PAD} source pixels stays transparent.']))
        shutil.copyfile(HD_PACK / 'tier2_fighters' / h / 'reference_sheet.png', base / 'reference_sheet.png')
        score = res['all']['score'] if res else None
        write_text(base / 'README.md', B.robot_readme(h, len(by_folder), len(body), design_frame, score))
        counts[h] = {'frames': len(body), 'moves': len(by_folder), 'design_size': f'{size[0]} × {size[1]}'}
        print(f'{h}: design sheet from {design_frame}, {len(body)} frames in {len(by_folder)} folders', flush=True)

    # ---- Reference pictures, documents, job lists ------------------------------------------------------------------
    ref = out / 'reference'
    (ref / 'consistency').mkdir(parents=True)
    shutil.copyfile(HD_PACK / 'reference' / 'robot_color_zones.png', ref / 'robot_color_zones.png')
    canon = []
    for h in S.ORIGINAL_ROBOTS:
        res = measured.get(h)
        rf = S.robot_frames(HD_PACK, h, manifest)
        jid = res['canonical_idle'][0] if res and res['canonical_idle'] else rf['anims'][S.IDLE][0]
        canon.append(rf['frames'][jid])
    lineup(canon).save(ref / 'original_robots.png', optimize=True)
    for h in robots:
        for kind in ('pairs', 'hotspots'):
            if (SURVEY / kind / f'{h}.jpg').exists():
                shutil.copyfile(SURVEY / kind / f'{h}.jpg', ref / 'consistency' / f'{h}_{kind}.jpg')
    if (SURVEY / 'ranking.txt').exists():
        shutil.copyfile(SURVEY / 'ranking.txt', ref / 'consistency' / 'survey_ranking.txt')
    shutil.copyfile(ROOT / 'tools' / 'hd-pack' / 'make_inputs.py', out / 'make_inputs.py')

    scores = {h: f"{measured[h]['all']['score']:.3f}" for h in robots if h in measured}
    write_text(out / 'README.md', B.readme(robots, counts, scores))
    write_text(out / 'OUTPUT_SPEC.md', B.output_spec(robots))
    write_text(out / 'STYLE_GUIDE.md', B.style_guide(robots))

    all_jobs = design_jobs + jobs
    (out / 'manifest.json').write_text(json.dumps({
        'format': 'omf2097-hd-asset-pack', 'version': 1, 'pack': 'consistency-rework',
        'generated': time.strftime('%Y-%m-%d'), 'game': 'One Must Fall 2097',
        'scale': {'x': S.SX, 'y': S.SY, 'note': 'native pixels are 1.2x taller than wide (320x200 shown at 4:3); outputs use square pixels at 5x wide, 6x tall'},
        'spritePad': PAD,
        'robots': {h: {'designFrame': chosen[h], 'frames': counts[h]['frames'], 'moves': counts[h]['moves'],
                       'inconsistency': measured[h]['all']['score'] if h in measured else None} for h in robots},
        'counts': {'jobs': len(all_jobs), 'design': len(design_jobs), 'frames': len(jobs)},
        'jobs': all_jobs,
    }, indent=1), encoding='utf-8')
    with open(out / 'jobs.jsonl', 'w', encoding='utf-8', newline='\n') as f:
        for j in all_jobs:
            f.write(json.dumps({
                'id': j['id'], 'tier': j['tier'], 'mode': j['mode'], 'source': j['source'], 'guide': j['guide'],
                'mask': j['mask'], 'output': j['output'], 'width': j['width'], 'height': j['height'],
                'transparent': j['transparent'], 'prompt': j['prompt'], 'negative_prompt': j['negativePrompt'],
                'prompt_file': j['promptFile'], 'animation_folder': j['group'], 'consistency_group': j['consistencyGroup'],
                'frame': j['frameIndex'], 'frames': j['frameCount'], 'recolored_in_game': j['recolor'] != 'none',
                'reference_image': j['reference'], 'current_painting': j['current'],
            }) + '\n')
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator='\r\n')
    w.writerow(['id', 'tier', 'mode', 'source', 'guide', 'mask', 'output', 'width', 'height', 'transparent',
                'consistency_group', 'reference_image', 'prompt_file', 'prompt', 'negative_prompt'])
    for j in all_jobs:
        w.writerow([j['id'], j['tier'], j['mode'], j['source'], j['guide'] or '', '', j['output'], j['width'], j['height'],
                    'true', j['consistencyGroup'], j['reference'] or '', j['promptFile'], j['prompt'], j['negativePrompt']])
    (out / 'jobs.csv').write_text(buf.getvalue(), encoding='utf-8', newline='')

    # The zip for the image AI.
    zip_path = Path(shutil.make_archive(str(out), 'zip', out.parent, out.name))
    size = sum(p.stat().st_size for p in out.rglob('*') if p.is_file())
    print(f'{out}: {len(design_jobs)} design sheets + {len(jobs)} frames, {size / 1e6:.0f} MB; '
          f'{zip_path} ({zip_path.stat().st_size / 1e6:.0f} MB), {time.time() - t0:.0f}s')


if __name__ == '__main__':
    main()
