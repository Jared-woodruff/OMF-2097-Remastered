"""Cuts HD pictures out of an HD asset folder's atlas pages (public/hd: index.json and its bundles) for the extras mod
(src/gen/dev/extras.test.ts): each picture is its sprite's whole frame, (w + 2 pad) x (h + 2 pad) native pixels at 5 x 6,
with the painted part where the atlas says, the rest see-through. Needs Python 3 with Pillow.

Usage: python tools/extras/crop.py <jobs.json>
jobs.json: {"hd": <HD folder>, "out": <folder>, "quality": <WebP quality, 0 lossless>, "jobs": [{"bundle", "page", "x", "y",
"w", "h", "tx", "ty", "fw", "fh", "file"}]}: writes <out>/<file> for each job.
"""
import json
import os
import sys

from PIL import Image


def main() -> None:
    spec = json.load(open(sys.argv[1], encoding='utf-8'))
    hd, out, quality = spec['hd'], spec['out'], int(spec.get('quality', 0))
    index = json.load(open(os.path.join(hd, 'index.json'), encoding='utf-8'))
    pages: dict = {}
    for job in spec['jobs']:
        key = (job['bundle'], job['page'])
        if key not in pages:
            name = index['bundles'][job['bundle']]['pages'][job['page']]['file']
            pages[key] = Image.open(os.path.join(hd, job['bundle'], name)).convert('RGBA')
        part = pages[key].crop((job['x'], job['y'], job['x'] + job['w'], job['y'] + job['h']))
        frame = Image.new('RGBA', (job['fw'], job['fh']), (0, 0, 0, 0))
        frame.paste(part, (job['tx'], job['ty']))
        path = os.path.join(out, job['file'])
        os.makedirs(os.path.dirname(path), exist_ok=True)
        if quality:
            frame.save(path, 'WEBP', quality=quality, method=6, exact=True)
        else:
            frame.save(path, 'WEBP', lossless=True, method=6, exact=True)
    print(f'{len(spec["jobs"])} pictures')


if __name__ == '__main__':
    main()
