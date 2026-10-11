// The generated arenas (arenas 5-8, after the original five): their scenes and how the game presents them.
import type { SceneDef } from '../types';
import { abyssScene } from './abyss';
import { icecaveScene } from './icecave';
import { orbitalScene } from './orbital';
import { rooftopScene } from './rooftop';
import { trKey } from '../../../i18n/i18n';

export interface GenArena {
  /** Arena number (scene SceneId.ARENA0 + index). */
  index: number;
  name: string;
  /** Scene file name the game loads it by. */
  file: string;
  /** BK file id (the originals use 8..128; code keyed by it leaves these alone). */
  fileId: number;
  /** Music (one of the original arena tracks). */
  music: string;
  /** Text of the VS screen's arena selection. */
  description: string;
  /** How the news report names it ("they traded blows in the ~"). */
  newsName: string;
  scene: () => SceneDef;
}

export const GEN_ARENAS: GenArena[] = [
  {
    index: 5,
    name: trKey('ORBITAL'),
    file: 'ARENA5.BK',
    fileId: 256,
    music: 'ARENA2.PSM',
    description: trKey('The hangar deck of an orbital station. Low gravity, high stakes: the Earth is watching.'),
    newsName: trKey('Orbital Station'),
    scene: orbitalScene,
  },
  {
    index: 6,
    name: trKey('ICE CAVE'),
    file: 'ARENA6.BK',
    fileId: 512,
    music: 'ARENA4.PSM',
    description: trKey('A frozen cavern high in the mountains, lit by glowing crystals and the aurora outside. Mind your footing.'),
    newsName: trKey('Ice Cave'),
    scene: icecaveScene,
  },
  {
    index: 7,
    name: trKey('ROOFTOP'),
    file: 'ARENA7.BK',
    fileId: 1024,
    music: 'ARENA1.PSM',
    description: trKey('A skyscraper roof in the rain, high above the neon city. The lightning is free.'),
    newsName: trKey('Rooftop Arena'),
    scene: rooftopScene,
  },
  {
    index: 8,
    name: trKey('ABYSS'),
    file: 'ARENA8.BK',
    fileId: 2048,
    music: 'ARENA3.PSM',
    description: trKey('A glass dome on the sea floor, miles below the surface. One crack and the ocean comes in.'),
    newsName: trKey('Abyss'),
    scene: abyssScene,
  },
];

export function genArena(index: number): GenArena | undefined {
  return GEN_ARENAS.find((a) => a.index === index);
}

export function genArenaByFile(file: string): GenArena | undefined {
  const f = file.toUpperCase();
  return GEN_ARENAS.find((a) => a.file === f);
}
