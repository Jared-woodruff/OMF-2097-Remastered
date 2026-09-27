"""Optional helper: creates image-to-image inputs at the exact output size for jobs that have no `guide`.

Sprites are delivered at their original resolution (`fNNN.png`) with non-square pixels. Image-to-image tools
usually generate at the size of their input, so this script resizes each source to the job's `width` x `height`
(bicubic; Pillow resamples RGBA with premultiplied alpha, so edges get no dark fringes) and saves it as
`<name>.input.png` next to the source. The outputs to deliver are still `<name>.hd.png`.

Usage (Python 3 with Pillow):
    python make_inputs.py                          # every job without a guide
    python make_inputs.py tier2_fighters/JAGUAR    # only jobs whose source path starts with this prefix
"""
import json
import os
import sys

from PIL import Image

root = os.path.dirname(os.path.abspath(__file__))
prefix = sys.argv[1] if len(sys.argv) > 1 else ''
count = 0
with open(os.path.join(root, 'jobs.jsonl'), encoding='utf-8') as f:
    for line in f:
        job = json.loads(line)
        if job['guide'] or job['mask'] or not job['source'].startswith(prefix):
            continue
        src = os.path.join(root, job['source'])
        img = Image.open(src).convert('RGBA')
        img.resize((job['width'], job['height']), Image.BICUBIC).save(src[:-4] + '.input.png')
        count += 1
print(f'{count} input image(s) written')
