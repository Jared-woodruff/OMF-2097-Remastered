"""Packs the generated arenas' HD backgrounds for the game: the PNG renders the dev tool saved
(npm run dev, then open http://localhost:5173/?genarenahd; files .captures/ARENAn-HD.png and
ARENAn-WIDE.png) become public/gen/ARENAn-HD.webp and ARENAn-WIDE.webp. Arenas painted by the image AI
(src/gen/scene/art/ARENAn.png, from npm run newart:import) keep their paintings unless --force. Needs Pillow."""
import pathlib
import sys

from PIL import Image

root = pathlib.Path(__file__).resolve().parent.parent
src = root / '.captures'
dst = root / 'public' / 'gen'
art = root / 'src' / 'gen' / 'scene' / 'art'
dst.mkdir(parents=True, exist_ok=True)
done = 0
for png in sorted(src.glob('ARENA*-*.png')):
    stem = png.stem.upper()
    if not (stem.endswith('-HD') or stem.endswith('-WIDE')):
        continue
    if (art / f"{stem.split('-')[0]}.png").exists() and '--force' not in sys.argv:
        print(f'{png.name}: skipped (the arena has a painting)')
        continue
    out = dst / f'{stem}.webp'
    Image.open(png).convert('RGB').save(out, 'WEBP', quality=90, method=6)
    print(f'{png.name} -> {out.relative_to(root)} ({out.stat().st_size // 1024} KB)')
    done += 1
if not done:
    sys.exit('no renders found in .captures (open the dev server with ?genarenahd first)')
