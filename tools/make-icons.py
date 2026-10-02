#!/usr/bin/env python3
"""Renders the app icon and the installer artwork from their vector sources in tools/brand:

  tools/brand/icon.svg        the icon (48 px and up)
  tools/brand/icon-small.svg  the icon simplified for 16 to 40 px
  tools/brand/sidebar.html    installer welcome / finish page image (164x314)
  tools/brand/header.html     installer page header image (150x57)

Outputs: src-tauri/icons/* (via `npx tauri icon`, keeping the desktop icons, then a hand-built icon.ico with a crisp
image per size),
src-tauri/installer/sidebar.bmp and header.bmp, public/favicon.png and the web app icons (public/icon-*.png).

Everything is rendered at 1024 px (or 4x) with Microsoft Edge (or Chrome) in headless mode and scaled down with
Lanczos filtering. Needs Python 3 with Pillow, and Edge or Chrome.

Usage: python tools/make-icons.py
"""
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
BRAND = ROOT / 'tools' / 'brand'
ICONS = ROOT / 'src-tauri' / 'icons'
INSTALLER = ROOT / 'src-tauri' / 'installer'
PUBLIC = ROOT / 'public'


def find_browser() -> str:
    candidates = [
        os.environ.get('BROWSER_EXE', ''),
        r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
        r'C:\Program Files\Microsoft\Edge\Application\msedge.exe',
        r'C:\Program Files\Google\Chrome\Application\chrome.exe',
        shutil.which('msedge') or '', shutil.which('google-chrome') or '', shutil.which('chromium') or '',
    ]
    for c in candidates:
        if c and Path(c).exists():
            return c
    sys.exit('Microsoft Edge or Google Chrome is needed (set BROWSER_EXE to its path).')


BROWSER = find_browser()


def render(page: str, w: int, h: int, query: str = '') -> Image.Image:
    """Screenshot of tools/brand/<page> at w x h with a transparent background."""
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / 'shot.png'
        url = (BRAND / page).as_uri() + (f'?{query}' if query else '')
        subprocess.run([
            BROWSER, '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
            '--default-background-color=00000000', '--virtual-time-budget=3000', f'--window-size={w},{h}',
            f'--screenshot={out}', url,
        ], check=True, capture_output=True)
        img = Image.open(out).convert('RGBA')
        img.load()
        if img.size != (w, h):
            sys.exit(f'{page}: the browser rendered {img.size}, expected {(w, h)}')
        return img


def scaled(img: Image.Image, w: int, h: int | None = None, sharpen: bool = False) -> Image.Image:
    out = img.resize((w, h or w), Image.LANCZOS)
    if sharpen:
        out = out.filter(ImageFilter.UnsharpMask(radius=0.8, percent=45, threshold=1))
    return out


def main() -> None:
    print(f'Rendering with {BROWSER}')
    big = render('render.html', 1024, 1024, 'img=icon.svg')
    small = render('render.html', 1024, 1024, 'img=icon-small.svg')

    # Platform icon set from the 1024 px source, then the Windows .ico with a crisp image per size.
    ICONS.mkdir(parents=True, exist_ok=True)
    big.save(ICONS / 'source.png')
    npx = 'npx.cmd' if os.name == 'nt' else 'npx'
    subprocess.run([npx, 'tauri', 'icon', str(ICONS / 'source.png')], cwd=ROOT, check=True)
    # (tauri icon also makes Windows Store, Android and iOS icons: no build uses them)
    for extra in ['android', 'ios', 'StoreLogo.png', '64x64.png', *(f.name for f in ICONS.glob('Square*Logo.png'))]:
        target = ICONS / extra
        if target.is_dir():
            shutil.rmtree(target)
        elif target.exists():
            target.unlink()
    frames = {s: scaled(small, s, sharpen=True) for s in (16, 20, 24, 32, 40)}
    frames.update({s: scaled(big, s, sharpen=s <= 64) for s in (48, 64, 96, 128, 256)})
    frames[256].save(ICONS / 'icon.ico', format='ICO', sizes=[(s, s) for s in frames],
                     append_images=[frames[s] for s in frames if s != 256])
    frames[32].save(ICONS / '32x32.png')

    # Web: favicon (shown at 16-32 px: the simplified icon), app icons, and a maskable icon with a full background.
    scaled(small, 64, sharpen=True).save(PUBLIC / 'favicon.png')
    scaled(big, 192).save(PUBLIC / 'icon-192.png')
    scaled(big, 512).save(PUBLIC / 'icon-512.png')
    mask = Image.new('RGBA', (512, 512), (11, 15, 26, 255))
    emblem = scaled(big, 372)
    mask.alpha_composite(emblem, ((512 - 372) // 2, (512 - 372) // 2))
    mask.save(PUBLIC / 'icon-maskable-512.png')

    # Installer artwork: 24-bit bitmaps at the sizes the installer shows them.
    INSTALLER.mkdir(parents=True, exist_ok=True)
    sidebar = render('sidebar.html', 656, 1256)
    scaled(sidebar, 164, 314).convert('RGB').save(INSTALLER / 'sidebar.bmp')
    header = render('header.html', 600, 228)
    scaled(header, 150, 57).convert('RGB').save(INSTALLER / 'header.bmp')
    print('Icons and installer artwork written.')


if __name__ == '__main__':
    main()
