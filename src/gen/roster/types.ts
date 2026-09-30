// A generated robot's full definition: model, fighting style, stats, reference colors, specials and finishers.
import type { RobotModel } from '../robot';
import type { Body, Style } from '../fighter/body';
import type { GenMove, GenStats } from '../fighter/build';
import type { FinisherSpec, Links } from '../fighter/moveset';

export type RGB = [number, number, number];

export interface GenRobot {
  /** HAR id (11 and up; the originals are 0..10). */
  id: number;
  name: string;
  model: RobotModel;
  style: Style;
  stats: GenStats;
  /** Reference colors (tertiary, secondary, primary): the HD renderings' base palette and the default look. */
  colors: [RGB, RGB, RGB];
  /** Robot-specific sound table entries (index: sound id + 1). */
  sounds: Record<number, number>;
  links: Links;
  /** Special moves (ids 15-19 on the ground, 34-35 in the air, 36-40 projectiles and effects). */
  specials(b: Body): GenMove[];
  finisher(b: Body): FinisherSpec;
  /** Names and inputs of the special moves for the move list (by move id). */
  specialNames: Record<number, string>;
  /** A robot built from the workshop's parts (gen/workshop.ts): the HAR ids of the generated robots whose frame and
   *  whose special moves and finisher it has, whose remastered effects go with them (fx/robotFx.ts). */
  bodyOf?: number;
  movesOf?: number;
}
