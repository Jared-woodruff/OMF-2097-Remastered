// Development previews of the generated arenas (ARENA_PREVIEW=<dir> [ARENA=name] npx vitest run src/gen/dev/arenaPreview):
// full-color renders of their scenes, 320x200 and widescreen.
import path from 'node:path';
import { describe, it } from 'vitest';
import { renderScene } from '../scene/render';
import { orbitalScene } from '../scene/arenas/orbital';
import { icecaveScene } from '../scene/arenas/icecave';
import { rooftopScene } from '../scene/arenas/rooftop';
import { abyssScene } from '../scene/arenas/abyss';
import { writePng } from './png';

const OUT = process.env.ARENA_PREVIEW;
const SCENES: Record<string, () => import('../scene/types').SceneDef> = { orbital: orbitalScene, icecave: icecaveScene, rooftop: rooftopScene, abyss: abyssScene };

describe.skipIf(!OUT)('arena previews', () => {
  it('renders', () => {
    for (const [name, make] of Object.entries(SCENES)) {
      if (process.env.ARENA && process.env.ARENA !== name) continue;
      const t0 = performance.now();
      const wide = process.env.WIDE === '1';
      const img = renderScene(make(), wide ? -128 : 0, wide ? 576 : 320, 200, Number(process.env.SS ?? 1));
      const rgba = new Uint8Array(img.w * img.h * 4);
      for (let i = 0; i < img.w * img.h; i++) rgba.set([img.rgb[i * 3], img.rgb[i * 3 + 1], img.rgb[i * 3 + 2], 255], i * 4);
      writePng(path.join(OUT!, `arena-${name}${wide ? '-wide' : ''}.png`), img.w, img.h, rgba);
      console.log(name, (performance.now() - t0).toFixed(0), 'ms');
    }
  }, 600000);
});
