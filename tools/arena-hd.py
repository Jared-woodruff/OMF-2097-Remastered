"""Puts the generated arenas' HD backgrounds in their mod's package: the widescreen renders the dev tool saved
(npm run dev, then open http://localhost:5173/?genarenahd; files .captures/ARENAn-WIDE.png) become WebP images
(.captures/arena-hd/ARENAn-WIDE.webp) that `npm run extras -- --arena-hd .captures/arena-hd` puts in the package
(public/mods; this runs it). Arenas painted by the image AI (src/gen/scene/art/ARENAn.png, from npm run newart:import)
keep their paintings unless --force. Needs Pillow."""
import pathlib
import shutil
import subprocess
import sys

from PIL import Image

root = pathlib.Path(__file__).resolve().parent.parent
src = root / '.captures'
dst = src / 'arena-hd'
art = root / 'src' / 'gen' / 'scene' / 'art'
shutil.rmtree(dst, ignore_errors=True)  # (only this run's renders go in the package)
dst.mkdir(parents=True)
done = 0
for png in sorted(src.glob('ARENA*-WIDE.png')):
    stem = png.stem.upper()
    if (art / f"{stem.split('-')[0]}.png").exists() and '--force' not in sys.argv:
        print(f'{png.name}: skipped (the arena has a painting)')
        continue
    out = dst / f'{stem}.webp'
    Image.open(png).convert('RGB').save(out, 'WEBP', quality=90, method=6)
    print(f'{png.name} -> {out.relative_to(root)} ({out.stat().st_size // 1024} KB)')
    done += 1
if not done:
    sys.exit('no renders to put in the package (open the dev server with ?genarenahd first)')
sys.exit(subprocess.run(['node', 'tools/extras-mod.mjs', '--arena-hd', str(dst)], cwd=root, shell=sys.platform == 'win32').returncode)
