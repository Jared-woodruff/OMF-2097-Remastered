// Development: the remaster's robots' spines, for the new-art import (tools/newart).
//   SPINE_CORES=cores.json npx vitest run src/gen/dev/spineCore.test.ts      (npm run newart:import runs it)
// A robot's waist is a stack of rings (gen/robots/parts.ts ribs()); in poses that lean or twist the torso, its narrow
// bottom leaves the rings and the sprite shows gaps there, which the image model painted as it saw them (and often
// wider, with thinner rings): the torso floating over the hips. For every sprite this renders a solid core through the
// spine (from inside the pelvis into the chest) at the paintings' resolution; the import draws it in behind the
// painting, so it shows only through the gaps (tools/newart/import.py). The sprites themselves stay as they are: hits
// are tested against their pixels.
import fs from 'node:fs';
import { it } from 'vitest';
import { hasGameData, loadGameData } from '../../test/harness';
import { spriteShapes } from '../fighter/build';
import { HD_SX, HD_SY } from '../hdRender';
import { ROW_H, traceShapes } from '../raster';
import type { RobotModel } from '../robot';
import { mat, part, prism } from '../robots/parts';
import { fighterOf, GEN_ROBOTS } from '../roster';

/** The core: dark metal (its shades are all the import uses). */
const CORE = mat(2, -0.2, 0.6);

/** The model with a core through the spine, narrower than its rings (`only`: the core alone). */
export function withSpineCore(model: RobotModel, only = false): RobotModel {
  const joints = model.joints.map((j) => ({ ...j, parts: only ? [] : [...j.parts] }));
  const spine = joints.find((j) => j.name === 'spine')!;
  const chest = joints.find((j) => j.name === 'chest')!;
  const rings = model.joints.find((j) => j.name === 'spine')!.parts;
  const radii = rings.map((p) => Math.min(p.shape.r, p.shape.b || p.shape.r)).filter((r) => r > 0);
  const r = 0.62 * Math.min(...radii);
  const y0 = -spine.offset[1] * 0.75, y1 = chest.offset[1] * 0.35;
  spine.parts.push(part(prism((y1 - y0) / 2, r, r, 8), [0, (y0 + y1) / 2, 0], CORE));
  return { ...model, joints };
}

interface SpriteCore {
  /** The sprite's size and silhouette (to find its picture in the pack): a row-major bit string, as hex. */
  w: number;
  h: number;
  mask: string;
  /** The core in half pixels of the painting, from the sprite's corner; its shades (0: none, else 1 + shade 0..15) in
   * two hex digits a pixel. */
  core: { x: number; y: number; w: number; h: number; shades: string };
}

it.skipIf(!hasGameData || !process.env.SPINE_CORES)('spine cores of the remaster robots', () => {
  loadGameData();
  const robots: Record<string, Record<number, SpriteCore[]>> = {};
  for (const r of GEN_ROBOTS) {
    const f = fighterOf(r);
    const coreOnly = withSpineCore(f.model, true);
    const moves: Record<number, SpriteCore[]> = {};
    for (const m of f.moves) {
      const list: SpriteCore[] = [];
      for (const gs of m.sprites) {
        if (!gs.pose || gs.view) continue;
        const a = traceShapes(spriteShapes(f.model, gs), 1, ROW_H);
        // Twice the paintings' resolution (5 x 6 per native pixel), for smooth edges.
        const c = traceShapes(spriteShapes(coreOnly, { ...gs, props: undefined }), 1 / (2 * HD_SX), ROW_H / (2 * HD_SY));
        if (!c.data.some((v) => v)) continue;
        let mask = '';
        for (let i = 0; i < a.data.length; i += 4) {
          let n = 0;
          for (let k = 0; k < 4; k++) n |= (i + k < a.data.length && a.data[i + k] ? 1 : 0) << (3 - k);
          mask += n.toString(16);
        }
        const shades = Array.from(c.data, (v) => (v ? 1 + (v % 16) : 0).toString(16).padStart(2, '0')).join('');
        list.push({ w: a.w, h: a.h, mask, core: { x: c.x - 2 * HD_SX * a.x, y: c.y - 2 * HD_SY * a.y, w: c.w, h: c.h, shades } });
      }
      if (list.length) moves[m.id] = list;
    }
    robots[r.model.name] = moves;
  }
  fs.writeFileSync(process.env.SPINE_CORES!, JSON.stringify({ robots }));
});
