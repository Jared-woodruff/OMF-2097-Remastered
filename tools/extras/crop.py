"""Cuts HD pictures out of an HD asset folder's atlas pages (public/hd: index.json and its bundles) for the extras mod
(src/gen/dev/extras.test.ts): each picture is its sprite's whole frame, (w + 2 pad) x (h + 2 pad) native pixels at 5 x 6,
with the painted part where the atlas says, the rest see-through. Pictures that are whole frames already (Blender's:
a job with "src") are only converted. The pictures are made on every core. Needs Python 3 with Pillow.

Usage: python tools/extras/crop.py <jobs.json>
jobs.json: {"hd": <HD folder>, "out": <folder>, "quality": <WebP quality, 0 lossless>, "jobs": [{"bundle", "page", "x", "y",
"w", "h", "tx", "ty", "fw", "fh", "file"} or {"src", "fw", "fh", "file"}]}: writes <out>/<file> for each job.
"""
import json
import os
import sys
from concurrent.futures import ProcessPoolExecutor

from PIL import Image

# (each worker's atlas pages, opened once)
_pages: dict = {}


def make(spec: dict, index: dict | None, job: dict) -> str | None:
    """Writes one job's picture; returns what is wrong, or None."""
    hd, out, quality = spec['hd'], spec['out'], int(spec.get('quality', 0))
    if 'src' in job:
        frame = Image.open(job['src']).convert('RGBA')
        if frame.size != (job['fw'], job['fh']):
            return f"{job['src']} is {frame.size[0]} x {frame.size[1]}, not {job['fw']} x {job['fh']}"
    else:
        key = (job['bundle'], job['page'])
        if key not in _pages:
            name = index['bundles'][job['bundle']]['pages'][job['page']]['file']
            _pages[key] = Image.open(os.path.join(hd, job['bundle'], name)).convert('RGBA')
        part = _pages[key].crop((job['x'], job['y'], job['x'] + job['w'], job['y'] + job['h']))
        frame = Image.new('RGBA', (job['fw'], job['fh']), (0, 0, 0, 0))
        frame.paste(part, (job['tx'], job['ty']))
    save(frame, os.path.join(out, job['file']), quality)
    return None


def save(frame: Image.Image, path: str, quality: int) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if quality:
        frame.save(path, 'WEBP', quality=quality, method=6, exact=True)
    else:
        frame.save(path, 'WEBP', lossless=True, method=6, exact=True)


def main() -> None:
    spec = json.load(open(sys.argv[1], encoding='utf-8'))
    hd = spec['hd']
    index = json.load(open(os.path.join(hd, 'index.json'), encoding='utf-8')) if hd else None
    jobs = spec['jobs']
    # (the jobs of one atlas page together, so a worker opens few pages)
    jobs.sort(key=lambda j: (j.get('bundle', ''), j.get('page', 0)))
    with ProcessPoolExecutor() as pool:
        problems = [p for p in pool.map(make, [spec] * len(jobs), [index] * len(jobs), jobs, chunksize=8) if p]
    if problems:
        sys.exit('\n'.join(problems))
    print(f'{len(jobs)} pictures')


if __name__ == '__main__':
    main()
