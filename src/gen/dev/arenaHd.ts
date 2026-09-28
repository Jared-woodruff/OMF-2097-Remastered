// Development tool (dev server only, ?genarenahd): renders the generated arenas' HD backgrounds on the GPU and saves
// them through the dev server's capture endpoint (.captures/ARENAn-HD.png and ARENAn-WIDE.png); `npm run gen:hd`
// turns them into the WebP images in public/gen.
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

/** Renders every generated arena (HD 1600x1200 and widescreen 2880x1200); reports progress to `log`. */
export async function renderArenaHd(gl: WebGL2RenderingContext, log: (s: string) => void, only?: string): Promise<void> {
  for (const a of GEN_ARENAS) {
    if (only && a.file !== only.toUpperCase()) continue;
    const scene = a.scene();
    const base = a.file.replace(/\.BK$/, '');
    for (const [suffix, x0, nw] of [['HD', 0, 320], ['WIDE', -128, 576]] as const) {
      const w = nw * 5, h = 1200;
      log(`${base} ${suffix}: rendering ${w}x${h}…`);
      await new Promise((r) => setTimeout(r, 0));
      const t0 = performance.now();
      const px = renderSceneGpu(gl, scene, x0, nw, w, h, 3);
      await save(`${base}-${suffix}.png`, px, w, h);
      log(`${base} ${suffix}: ${((performance.now() - t0) / 1000).toFixed(1)} s`);
    }
  }
  log('done');
}
