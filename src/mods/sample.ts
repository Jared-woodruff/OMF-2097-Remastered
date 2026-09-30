// A sample mod made from the game's own generators, with no original art in it: a robot put together the robot
// workshop's way (GLACIER's frame, SPECTRE's head, HELIX's moves), an arena (the remaster's rooftop at dusk: its own
// colors changed) and a pilot. The tests install and play it; OMF Studio offers it as an example.
import { parseBK, saveBK } from '../formats/bk';
import { Palette } from '../formats/palette';
import { MOVE } from '../gen/fighter/moveset';
import { GEN_ROBOTS } from '../gen/roster';
import { buildRemaps, OWN_COUNT, OWN_FIRST } from '../gen/scene/palette';
import { buildWorkshopFighter, type WorkshopSpec } from '../gen/workshop';
import { getFile } from '../resources/files';
import { getGenerated } from '../resources/generated';
import { APP_VERSION } from '../platform/versionLabel';
import { encodePng } from '../util/png';
import type { ModPackage } from './package';
import { MOD_FORMAT } from './types';

/** The sample mod's id. */
export const SAMPLE_MOD_ID = 'omf2097r.sample';

const ROBOT: WorkshopSpec = { v: 1, name: 'SENTINEL', body: 0, head: 3, moves: 2, size: 1, weight: 1, colors: [5, 11, 8] };

/** Colors toward dusk: hues turned toward orange and violet, a little darker. */
function dusk(r: number, g: number, b: number): [number, number, number] {
  const l = 0.3 * r + 0.59 * g + 0.11 * b;
  const warm = [l * 1.25 + 18, l * 0.72 + 6, l * 0.95 + 26];
  return warm.map((v, i) => Math.max(0, Math.min(252, Math.round((v * 0.7 + [r, g, b][i] * 0.3) * 0.92)))) as [number, number, number];
}

/** The rooftop at dusk (needs the generated arenas' files and the original ARENA0.BK, like the game). */
function duskRooftop(): { bk: Uint8Array; wid: Uint8Array | null } {
  const src = getGenerated('ARENA7.BK');
  if (!src) throw new Error('The remaster\'s arenas are not there (public/gen).');
  const bk = parseBK(src);
  const ref = parseBK(getFile('ARENA0.BK'));
  const full = ref.palettes[0].clone();
  full.copyRange(bk.palettes[0], OWN_FIRST, OWN_COUNT);
  for (let i = OWN_FIRST; i < OWN_FIRST + OWN_COUNT; i++) full.set(i, ...dusk(full.r(i), full.g(i), full.b(i)));
  const own = new Palette();
  own.copyRange(full, OWN_FIRST, OWN_COUNT);
  const remaps = buildRemaps(full, ref.palettes[0], ref.remaps[0]);
  const ownRemaps = bk.remaps[0].clone();
  for (const t of ownRemaps.tables) t.fill(0);
  remaps.tables.forEach((t, k) => ownRemaps.tables[k].set(t.subarray(OWN_FIRST), OWN_FIRST));
  bk.palettes = [own];
  bk.remaps = [ownRemaps];
  return { bk: saveBK(bk), wid: getGenerated('ARENA7.WID') };
}

/**
 * VEGA's helmet: a flight helmet with its visor down, lit from the left, `size` pixels tall, drawn into a w x h RGBA
 * picture at (cx, top); with `shoulders`, her shoulders below it.
 */
function drawHelmet(rgba: Uint8Array, w: number, h: number, cx: number, top: number, size: number, shoulders: boolean): void {
  const put = (x: number, y: number, r: number, g: number, b: number) => rgba.set([r, g, b, 255], (y * w + x) * 4);
  const k = size / 42;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sy = (y - top - 26 * k * 1.65) / k, sx = (x - cx) / k;
      if (shoulders && sy > -6 && (sx * sx) / 900 + (sy * sy) / 120 < 1) put(x, y, 70, 64, 90);
      const hx = (x - cx) / (17 * k), hy = (y - top - 21 * k) / (21 * k);
      if (hx * hx + hy * hy >= 1) continue;
      const light = Math.max(0, Math.min(1, 0.85 - 0.55 * hx - 0.25 * hy));
      put(x, y, 150 * light + 40, 150 * light + 38, 170 * light + 50);
      // the visor: a band across the eyes, amber, with a highlight
      if (hy > -0.35 && hy < 0.2 && Math.abs(hx) < 0.85) {
        const glow = 1 - Math.abs(hy + 0.08) * 3;
        put(x, y, 200 + 50 * glow, 120 + 60 * glow, 30);
      }
      // a stripe over the top
      if (Math.abs(hx) < 0.12 && hy < -0.35) put(x, y, 220, 70, 60);
    }
  }
}

/** VEGA's portrait (64 x 64) on the dark blue of the originals' portraits. Drawn here so the sample holds no art from elsewhere. */
export function samplePortrait(): Promise<Uint8Array> {
  const W = 64, H = 64;
  const rgba = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) rgba.set([10, 14 + (40 * (H - y)) / H, 40 + (50 * (H - y)) / H, 255], (y * W + x) * 4);
  }
  drawHelmet(rgba, W, H, 32, 7, 42, true);
  return encodePng(W, H, rgba);
}

/** VEGA's face in the pilot select grid (51 x 36): the helmet alone, see-through around it like the originals' faces. */
export function sampleFace(): Promise<Uint8Array> {
  const W = 51, H = 36;
  const rgba = new Uint8Array(W * H * 4);
  drawHelmet(rgba, W, H, 25, 2, 34, false);
  return encodePng(W, H, rgba);
}

export async function buildSampleMod(): Promise<ModPackage> {
  const moves = GEN_ROBOTS[ROBOT.moves].specialNames;
  const arena = duskRooftop();
  return {
    manifest: {
      format: MOD_FORMAT,
      id: SAMPLE_MOD_ID,
      name: 'Sample mod',
      version: '1.0',
      author: 'OMF 2097 Remastered',
      description: 'An example of what a mod holds: the robot SENTINEL, the arena DUSK ROOFTOP and the pilot VEGA.',
      // (the game version that made it: it needs no newer one)
      game: APP_VERSION || '0.0.0',
      robots: ['sentinel'],
      arenas: ['dusk-rooftop'],
      pilots: ['vega'],
    },
    robots: [{
      id: 'sentinel',
      info: {
        name: 'SENTINEL',
        description: 'A heavy frame with a drill arm: it rushes in, bores through blocks and fires its drill bit.',
        moves,
        // HELIX's specials: DRILL RUSH (a charge), CORKSCREW (a rising push), DRILL BIT (a projectile).
        ai: { projectile: [MOVE.SPECIAL3], charge: [MOVE.SPECIAL1], push: [MOVE.SPECIAL2] },
      },
      af: buildWorkshopFighter(ROBOT, 0),
    }],
    arenas: [{
      id: 'dusk-rooftop',
      info: {
        name: 'DUSK ROOFTOP',
        description: 'The skyscraper roof as the sun goes down over the neon city. The storm has passed; the fight has not.',
        newsName: 'Dusk Rooftop',
        music: 'ARENA1.PSM',
        ambience: 'rooftop',
        base: -1,
      },
      bk: arena.bk,
      wid: arena.wid,
    }],
    pilots: [{
      id: 'vega',
      info: {
        name: 'Vega',
        sex: 'female',
        power: 11,
        agility: 13,
        endurance: 9,
        colors: [5, 11, 8],
        bio: 'A test pilot from the orbital yards, VEGA flies every new frame before anyone else is allowed to.',
        personality: 0,
        quotes: ['I have flown worse machines than yours. Not many.', 'Another one for the test report.'],
        ending: [
          'The orbital yards send their congratulations, and a new frame to fly. VEGA files the last test report of the ' +
            'tournament herself: every robot she met is in it, with a note on how it lost.\nKreissack\'s is the shortest.',
          'As you fly towards the moon, you are already sketching the next machine.',
        ],
      },
      portrait: await samplePortrait(),
      face: await sampleFace(),
    }],
  };
}
