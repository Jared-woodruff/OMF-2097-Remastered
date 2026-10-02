"""The arenas' geometry maps: each HD arena painting's surface direction and depth, estimated with MoGe (a monocular
geometry model, run in a local ComfyUI), for the remastered renderer's parallax and lighting (src/video/hd/geometry.ts).

For every arena painting (the widescreen one, 2880 x 1200: native x -128..448, y 0..200), writes
public/hd/geometry/<NAME>.<content hash>.webp (named by its content, like the other HD files the web version keeps
offline; lossless, half size: RGB = the surface normal, OpenGL convention, x right, y up, z
towards the viewer; A = depth as normalized disparity, 1 near .. 0 far) and its entry in public/hd/geometry/index.json,
keyed by the painting's pixel hash (the key the HD artwork is found by): the file, the disparity of the floor the
robots stand on (native y 186..192, x 40..280: the fighting plane), `far`, how far the farthest painted parts still
are (the disparity offset the renderer adds: about 0 for a sky, more for a closed room), and `parallax`, how much of
it the renderer gives the camera's moves (less for arenas full of thin things in front of far ones).

The depth is smoothed for the parallax (the background is moved pixel by pixel by its depth: where thin near things
stand in front of far ones, a sharp depth step would tear them): near depth spread a little past its edges first, so
thin things keep theirs, then blurred. The normals stay sharp for the lighting.

A mod's arenas (--mod <package>): their maps go to a folder instead (--out, default .captures/arena-geo:
<arena folder>.webp and .json, its floor, far and parallax), which `npm run extras -- --arena-geo <folder>` puts in the
new arenas' mod (hd.json's "geometry"; see docs/MODDING.md).

Usage: python tools/arena-geo.py [--arenas ARENA0,ARENA3] [--far ARENA3=0.25,...] [--comfy http://127.0.0.1:8188]
       [--model moge_3_vitl_fp16.safetensors]
       python tools/arena-geo.py --mod public/mods/omf2097r.extras.omfmod [--out .captures/arena-geo] [--far orbital=0.02]
       [--parallax rooftop=0.5]
Needs Python 3 with numpy and Pillow, and ComfyUI (0.38 or later: its MoGe nodes) with the MoGe model in
models/geometry_estimation (https://huggingface.co/Comfy-Org/MoGe).
"""
import argparse
import hashlib
import io
import json
import time
import zipfile
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
HD = ROOT / 'public' / 'hd'
OUT = HD / 'geometry'
# The geometry maps' size (half the widescreen painting's), and for an arena with only a 4:3 painting (a mod's).
SIZE = (1440, 600)
SIZE_43 = (800, 600)
# Native widescreen frame the paintings cover.
X0, NATIVE_W, NATIVE_H = -128, 576, 200
# How far the farthest parts of each original arena are (see above): skies are at infinity, rooms are not; and how
# much parallax each gets (the Power Plant none: its fences and nets in front of a far landscape bend however smooth
# the depth; it keeps the light by its shape).
FAR = {'ARENA0': 0.3, 'ARENA1': 0.35, 'ARENA2': 0.08, 'ARENA3': 0.3, 'ARENA4': 0.02}
PARALLAX = {'ARENA2': 0.0}
# The depth's smoothing (native pixels): near depth spread by SPREAD, then blurred by SMOOTH.
SPREAD, SMOOTH = 2, 3.0


class Comfy:
    def __init__(self, url: str):
        self.url = url.rstrip('/')

    def post(self, path: str, data: bytes, headers: dict) -> dict:
        req = urllib.request.Request(self.url + path, data=data, headers=headers, method='POST')
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read())

    def upload(self, img: Image.Image, name: str) -> str:
        buf = io.BytesIO()
        img.save(buf, 'PNG')
        b = uuid.uuid4().hex
        body = (f'--{b}\r\nContent-Disposition: form-data; name="image"; filename="{name}"\r\nContent-Type: image/png\r\n\r\n').encode() \
            + buf.getvalue() + (f'\r\n--{b}\r\nContent-Disposition: form-data; name="subfolder"\r\n\r\narena-geo\r\n'
                                f'--{b}\r\nContent-Disposition: form-data; name="overwrite"\r\n\r\ntrue\r\n--{b}--\r\n').encode()
        r = self.post('/upload/image', body, {'Content-Type': f'multipart/form-data; boundary={b}'})
        return f"{r['subfolder']}/{r['name']}"

    def view(self, im: dict) -> Image.Image:
        q = (f"{self.url}/view?filename={urllib.parse.quote(im['filename'])}&subfolder={urllib.parse.quote(im['subfolder'])}"
             f"&type={im['type']}")
        with urllib.request.urlopen(q) as r:
            return Image.open(io.BytesIO(r.read()))

    def geometry(self, img: Image.Image, tag: str, model: str) -> tuple:
        """MoGe on a picture: (normalized disparity, normals), as MoGeRender gives them (8-bit pictures)."""
        g = {
            'img': {'class_type': 'LoadImage', 'inputs': {'image': self.upload(img, f'{tag}.png')}},
            'model': {'class_type': 'LoadMoGeModel', 'inputs': {'model_name': model}},
            'geo': {'class_type': 'MoGeInference', 'inputs': {'moge_model': ['model', 0], 'image': ['img', 0], 'resolution_level': 9,
                                                              'fov_x_degrees': 0.0, 'batch_size': 1, 'force_projection': True,
                                                              'apply_mask': False, 'refine_steps': 3}},
        }
        for out in ('depth', 'normal_opengl'):
            g[f'r_{out}'] = {'class_type': 'MoGeRender', 'inputs': {'moge_geometry': ['geo', 0], 'output': out}}
            g[f's_{out}'] = {'class_type': 'SaveImage', 'inputs': {'images': [f'r_{out}', 0], 'filename_prefix': f'arena-geo/{tag}_{out}'}}
        pid = self.post('/prompt', json.dumps({'prompt': g, 'client_id': 'arena-geo'}).encode(), {'Content-Type': 'application/json'})['prompt_id']
        while True:
            with urllib.request.urlopen(f'{self.url}/history/{pid}') as r:
                h = json.loads(r.read())
            if pid in h:
                st = h[pid].get('status', {})
                if st.get('status_str') == 'error':
                    raise RuntimeError(json.dumps(st.get('messages'))[:2000])
                if len(h[pid].get('outputs', {})) >= 2:
                    break
            time.sleep(0.5)
        o = h[pid]['outputs']
        return self.view(o['s_depth']['images'][0]), self.view(o['s_normal_opengl']['images'][0])


def spread(d: np.ndarray, r: int) -> np.ndarray:
    """Each pixel the largest value within r pixels (nearer depth grown past its edges)."""
    out = d.copy()
    for axis in (0, 1):
        p = np.pad(out, [(r, r) if a == axis else (0, 0) for a in (0, 1)], mode='edge')
        out = np.max([np.take(p, range(k, k + d.shape[axis]), axis=axis) for k in range(2 * r + 1)], 0)
    return out


def blur(d: np.ndarray, sigma: float) -> np.ndarray:
    r = max(1, int(3 * sigma + 0.5))
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2)
    k /= k.sum()
    for axis in (0, 1):
        p = np.pad(d, [(r, r) if a == axis else (0, 0) for a in (0, 1)], mode='edge')
        d = sum(w * np.take(p, range(i, i + d.shape[axis]), axis=axis) for i, w in enumerate(k))
    return d


def pack(depth: Image.Image, normal: Image.Image, wide: bool = True) -> tuple:
    """The geometry map (RGBA at SIZE: the widescreen frame; a classic 4:3 painting's at SIZE_43, its x 0..320) and the
    floor's disparity."""
    size, x0, nw = (SIZE, X0, NATIVE_W) if wide else (SIZE_43, 0, 320)
    d = np.asarray(depth.convert('L').resize(size, Image.BOX), np.float32) / 255
    k = size[0] / nw
    d = blur(spread(d, int(round(SPREAD * k))), SMOOTH * k)
    n = np.asarray(normal.convert('RGB').resize(size, Image.BOX), np.float32) / 255 * 2 - 1
    n /= np.maximum(np.linalg.norm(n, axis=-1, keepdims=True), 1e-6)
    rgba = np.concatenate([(n * 0.5 + 0.5), d[..., None]], -1)
    sx, sy = size[0] / nw, size[1] / NATIVE_H
    floor = d[int(186 * sy):int(193 * sy), int((40 - x0) * sx):int((280 - x0) * sx)]
    return Image.fromarray(np.round(np.clip(rgba, 0, 1) * 255).astype(np.uint8), 'RGBA'), float(np.median(floor))


def mod_maps(comfy: Comfy, package: Path, out: Path, far: dict, par: dict, model: str) -> None:
    """The maps of a mod package's arenas (those with an HD background): <out>/<arena folder>.webp and .json."""
    z = zipfile.ZipFile(package)
    manifest = json.loads(z.read('mod.json'))
    out.mkdir(parents=True, exist_ok=True)
    for arena in manifest.get('arenas', []):
        try:
            hd = json.loads(z.read(f'arenas/{arena}/hd.json'))
        except KeyError:
            hd = {}
        if not hd.get('background'):
            print(f'{arena}: no HD background, skipped')
            continue
        painting = Image.open(io.BytesIO(z.read(f'arenas/{arena}/{hd["background"]}'))).convert('RGB')
        t0 = time.time()
        depth, normal = comfy.geometry(painting, arena, model)
        img, floor = pack(depth, normal, painting.width / painting.height > 2)
        img.save(out / f'{arena}.webp', 'WEBP', lossless=True, quality=100, method=6)
        key = arena.upper()
        info = {'floor': round(floor, 4), 'far': far.get(key, 0.25), 'parallax': par.get(key, 1.0)}
        (out / f'{arena}.json').write_text(json.dumps(info) + '\n', encoding='utf-8')
        print(f'{arena}: {info}, {(out / f"{arena}.webp").stat().st_size // 1024} KB, {time.time() - t0:.0f} s', flush=True)
    print(out)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('--arenas', default='ARENA0,ARENA1,ARENA2,ARENA3,ARENA4')
    ap.add_argument('--far', default='', help='per arena, e.g. ARENA3=0.25,ARENA4=0.02')
    ap.add_argument('--comfy', default='http://127.0.0.1:8188')
    ap.add_argument('--model', default='moge_3_vitl_fp16.safetensors')
    ap.add_argument('--mod', help="a mod package: its arenas' maps, into --out")
    ap.add_argument('--out', default=str(ROOT / '.captures' / 'arena-geo'))
    ap.add_argument('--parallax', default='', help='per arena, e.g. ARENA2=0 (a mod: by arena folder, rooftop=0.5)')
    a = ap.parse_args()
    far, par = dict(FAR), dict(PARALLAX)
    for table, text in ((far, a.far), (par, a.parallax)):
        for kv in filter(None, text.split(',')):
            k, v = kv.split('=')
            table[k.strip().upper()] = float(v)
    comfy = Comfy(a.comfy)
    if a.mod:
        mod_maps(comfy, Path(a.mod), Path(a.out), far, par, a.model)
        return
    index_path = OUT / 'index.json'
    index = json.loads(index_path.read_text(encoding='utf-8')) if index_path.exists() else {}
    hd = json.loads((HD / 'index.json').read_text(encoding='utf-8'))
    OUT.mkdir(parents=True, exist_ok=True)
    for name in [s.strip().upper() for s in a.arenas.split(',') if s.strip()]:
        entry = next((e for e in hd['entries'] if e.get('bundle') == f'scene-{name}' and e.get('kind') == 'background'), None)
        if entry is None or entry.get('wide') is None:
            print(f'{name}: no widescreen painting in public/hd, skipped')
            continue
        bundle = hd['bundles'][f'scene-{name}']
        painting = Image.open(HD / f'scene-{name}' / bundle['images'][entry['wide']]['file']).convert('RGB')
        t0 = time.time()
        depth, normal = comfy.geometry(painting, name, a.model)
        img, floor = pack(depth, normal)
        buf = io.BytesIO()
        img.save(buf, 'WEBP', lossless=True, quality=100, method=6)
        file = f'{name}.{hashlib.sha1(buf.getvalue()).hexdigest()[:10]}.webp'
        for old in list(OUT.glob(f'{name}.webp')) + list(OUT.glob(f'{name}.*.webp')):
            old.unlink()
        (OUT / file).write_bytes(buf.getvalue())
        index = {h: v for h, v in index.items() if not v.get('file', '').startswith(f'{name}.')}
        index[entry['hash']] = {'file': file, 'floor': round(floor, 4), 'far': far.get(name, 0.25), 'parallax': par.get(name, 1.0)}
        print(f'{name}: floor {floor:.3f}, {len(buf.getvalue()) // 1024} KB, {time.time() - t0:.0f} s', flush=True)
    index_path.write_text(json.dumps(index, indent=1, sort_keys=True) + '\n', encoding='utf-8')
    print(index_path)


if __name__ == '__main__':
    main()
