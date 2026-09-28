// Development previews of the generated content (ROBOT_PREVIEW=<dir> [ROBOT=name] npx vitest run src/gen/dev/preview):
// PNG sheets of robot poses. Skipped in normal test runs.
import path from 'node:path';
import { describe, it } from 'vitest';
import { renderRobot, type IndexedSprite } from '../raster';
import { rampColors, writeSheet } from './png';
import { measure, type Style } from '../fighter/body';
import * as P from '../fighter/poses';
import { GLACIER } from '../robots/glacier';
import { TEMPEST } from '../robots/tempest';
import { HELIX } from '../robots/helix';
import { SPECTRE } from '../robots/spectre';
import type { Pose, RobotModel } from '../robot';

const OUT = process.env.ROBOT_PREVIEW;
const ONLY = process.env.ROBOT?.toUpperCase();

const STYLE: Style = { stance: 0.3, drop: 0.1, lean: 6, guardX: 0.55, guardY: -0.05, rearX: 0.25, rearY: -0.12, bob: 1.2 };

const ROBOTS: [RobotModel, [number, number, number][]][] = [
  [GLACIER, [[120, 220, 255], [150, 160, 180], [60, 110, 220]]],
  [TEMPEST, [[255, 240, 120], [140, 150, 160], [40, 170, 120]]],
  [HELIX, [[230, 230, 230], [90, 90, 100], [240, 170, 30]]],
  [SPECTRE, [[255, 60, 200], [60, 60, 80], [150, 150, 200]]],
];

describe.skipIf(!OUT)('robot previews', () => {
  it('renders poses', () => {
    for (const [model, colors] of ROBOTS) {
      if (ONLY && model.name !== ONLY) continue;
      const b = measure(model, STYLE);
      const sheets: Record<string, Pose[]> = {
        basic: [P.idle(b, 0), P.idle(b, 1), P.walk(b, 0.5), P.walk(b, 1), P.crouch(b), P.block(b), P.crouchBlock(b), P.stunned(b, -1), P.stunned(b, 1)],
        jump: [0, 1, 2, 3, 4, 5, 6, 7].map((k) => P.jump(b, k)),
        damage: [...P.DAMAGE_LETTERS].map((l) => P.damage(b, l)),
        misc: [0, 1, 2, 3].map((k) => P.standup(b, k)).concat([0, 3, 6].map((k) => P.victory(b, k)), [0, 1].map((k) => P.defeat(b, k))),
        attack1: [P.jab(b, -0.2), P.jab(b, 1), P.cross(b, -1), P.cross(b, 1), P.uppercut(b, 0), P.uppercut(b, 0.5), P.uppercut(b, 1), P.frontKick(b, 0.4), P.frontKick(b, 1), P.roundhouse(b, 0.35), P.roundhouse(b, 1)],
        attack2: [P.crouchPunch(b, 1, true), P.crouchPunch(b, 1, false, 0.7), P.lowKick(b, 1, false), P.lowKick(b, 1, true), P.sweep(b, 2), P.sweep(b, 4), P.throwPose(b, 0), P.throwPose(b, 2), P.throwPose(b, 3), P.throwPose(b, 4), P.jumpPunch(b, 1), P.jumpKick(b, 0), P.jumpKick(b, 1)],
      };
      for (const [name, poses] of Object.entries(sheets)) {
        const sprites: IndexedSprite[] = poses.map((p) => renderRobot(model, p));
        writeSheet(path.join(OUT!, `${model.name.toLowerCase()}-${name}.png`), sprites, 3, 6, rampColors(colors));
      }
    }
  });
});
