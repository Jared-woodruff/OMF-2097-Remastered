"""The new robots and arenas' mod package (public/mods/omf2097r.extras.omfmod, `npm run extras`) for the art tools:
its arenas' HD backgrounds (each the whole widescreen painting, 2880 x 1200: the 4:3 screen is its middle, x 640 to
2240). Needs Pillow."""
import io
import zipfile
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent.parent
PACKAGE = ROOT / 'public' / 'mods' / 'omf2097r.extras.omfmod'
# The arenas' folders in the package, by the scene file names they play under (src/mods/extras.ts).
FOLDERS = {'ARENA5': 'orbital', 'ARENA6': 'ice-cave', 'ARENA7': 'rooftop', 'ARENA8': 'abyss'}
CLASSIC = (640, 2240)


def arena_background(file: str) -> Image.Image:
    """An arena's HD background (file: 'ARENA5'...), the whole widescreen painting."""
    with zipfile.ZipFile(PACKAGE) as z:
        return Image.open(io.BytesIO(z.read(f'arenas/{FOLDERS[file]}/hd/background.webp'))).convert('RGB')


def arena_background_4_3(file: str) -> Image.Image:
    """The part of an arena's HD background the classic 4:3 screen shows."""
    img = arena_background(file)
    return img.crop((CLASSIC[0], 0, CLASSIC[1], img.height))
