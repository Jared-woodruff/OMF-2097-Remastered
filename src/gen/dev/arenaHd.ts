// Development tool (dev server only, ?genarenahd): renders the generated arenas' HD backgrounds on the GPU and saves
// them through the dev server's capture endpoint (.captures/ARENAn-WIDE.png); `npm run gen:hd` puts them in the new
// robots and arenas' mod package (public/mods).
import { GEN_ARENAS } from '../scene/arenas';
import { renderSceneGpu } from '../scene/gpu';

async function save(name: string, rgba: Uint8Array, w: number, h: number): Promise<void> {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  img.data.set(rgba);
  ctx.putImageData(img, 0, 0);
  const blob = await new Promise<Blob>((res) => canvas.toBlob((b) => res(b!), 'image/png'));
  await fetch(`/__debug/capture?name=${encodeURIComponent(name)}`, { method: 'POST', body: blob });
}

/** Renders every generated arena's widescreen HD background (2880x1200: the 4:3 screen shows its middle, x 640 to
 *  2240); reports progress to `log`. */
export async function renderArenaHd(gl: WebGL2RenderingContext, log: (s: string) => void, only?: string): Promise<void> {
  for (const a of GEN_ARENAS) {
    if (only && a.file !== only.toUpperCase()) continue;
    const scene = a.scene();
    const base = a.file.replace(/\.BK$/, '');
    const w = 576 * 5, h = 1200;
    log(`${base}: rendering ${w}x${h}…`);
    await new Promise((r) => setTimeout(r, 0));
    const t0 = performance.now();
    const px = renderSceneGpu(gl, scene, -128, 576, w, h, 3);
    await save(`${base}-WIDE.png`, px, w, h);
    log(`${base}: ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  }
  log('done');
}
