// A sample mod made from the game's own generators, with no original art in it: a robot put together the robot
// workshop's way (GLACIER's frame, SPECTRE's head, HELIX's moves), an arena (the remaster's rooftop at dusk: its own
// colors changed, a warning light blinking on a mast and an electric arc now and then) and a pilot. The tests install
// and play it; OMF Studio offers it as an example.
import { parseBK, saveBK, type BkAnimData, type BkFile } from '../formats/bk';
import { AnimationData } from '../formats/animation';
import { encodeSprite, Sprite } from '../formats/sprite';
import { REACT } from '../gen/fighter/moveset';
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
  addAnimations(bk, full);
  return { bk: saveBK(bk), wid: getGenerated('ARENA7.WID') };
}

/** The sample arena's animations: slot 30 loops from the start (the light), slot 31 appears at random (the arc). */
export const SAMPLE_LIGHT = 30, SAMPLE_ARC = 31;

/** The nearest of the shared effect colors (0xA0-0xF9) to a color. */
function effect(pal: Palette, r: number, g: number, b: number): number {
  let best = 0xa0, bestD = Infinity;
  for (let i = 0xa0; i < 0xfa; i++) {
    const d = (pal.r(i) - r) ** 2 + (pal.g(i) - g) ** 2 + (pal.b(i) - b) ** 2;
    if (d < bestD) (bestD = d), (best = i);
  }
  return best;
}

function sprite(px: Uint8Array, w: number, h: number, x: number, y: number): Sprite {
  const s = new Sprite();
  s.posX = x;
  s.posY = y;
  s.setData(encodeSprite(px, w, h), w, h);
  return s;
}

function anim(sprites: Sprite[], animString: string, x: number, y: number): AnimationData {
  const a = new AnimationData();
  a.startX = x;
  a.startY = y;
  a.animString = animString;
  a.sprites = sprites;
  return a;
}

/** A warning light on a mast (blinking) and an electric arc striking the roof now and then (it hurts). */
function addAnimations(bk: BkFile, pal: Palette): void {
  // The light: a red glow on and off, 3 x 3.
  const on = effect(pal, 255, 60, 40), glow = effect(pal, 170, 20, 20), off = effect(pal, 70, 10, 12);
  const lit = new Uint8Array([glow, on, glow, on, on, on, glow, on, glow]);
  const dark = new Uint8Array([0, off, 0, off, off, off, 0, off, 0]);
  const light: BkAnimData = {
    nullValue: 0, chainHit: 0, chainNoHit: 0, repeat: 0, probability: 1, hazardDamage: 0, footerString: '',
    animation: anim([sprite(lit, 3, 3, -1, -1), sprite(dark, 3, 3, -1, -1)], 'A12-B18', 64, 58),
  };
  // The arc: a jagged bolt from above the roof down to it, in two shapes, 14 wide and 90 tall; its hit points along it.
  const white = effect(pal, 250, 250, 255), cyan = effect(pal, 90, 220, 255), blue = effect(pal, 40, 90, 220);
  const W = 14, H = 90;
  const bolt = (seed: number): { px: Uint8Array; hits: [number, number][] } => {
    const px = new Uint8Array(W * H);
    const hits: [number, number][] = [];
    let x = 7;
    for (let y = 0; y < H; y++) {
      if (y % 6 === 0) x = Math.max(2, Math.min(W - 3, x + (((y * 7 + seed * 13) % 5) - 2)));
      for (let dx = -2; dx <= 2; dx++) {
        const v = dx === 0 ? white : Math.abs(dx) === 1 ? cyan : blue;
        if (Math.abs(dx) === 2 && (y + seed) % 3) continue;
        px[y * W + x + dx] = v;
      }
      if (y % 10 === 5) hits.push([x - 7, y - H]);
    }
    return { px, hits };
  };
  const b1 = bolt(1), b2 = bolt(4);
  const arcAnim = anim([sprite(b1.px, W, H, -7, -H), sprite(b2.px, W, H, -7, -H)], 's20l80A2-B2-A2-B2-A2-B3-A3', 96, 190);
  arcAnim.coords = [
    ...b1.hits.map(([x, y]) => ({ x, y, nullValue: 0, frameId: 0 })),
    ...b2.hits.map(([x, y]) => ({ x, y, nullValue: 0, frameId: 1 })),
  ];
  const arc: BkAnimData = {
    nullValue: 0, chainHit: 0, chainNoHit: 0, repeat: 0, probability: 900, hazardDamage: 8, footerString: REACT.highMedium, animation: arcAnim,
  };
  bk.anims[SAMPLE_LIGHT] = light;
  bk.anims[SAMPLE_ARC] = arc;
  // (the arc's sound: the Power Plant's zap; the other entries are the original game's first arena's)
  bk.soundTable[20] = 33;
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
        loops: [SAMPLE_LIGHT],
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
        // A test pilot: she tries everything a machine can do, keeps her distance and learns fast.
        ai: {
          normal: 30, hyper: 20, jump: 35, defensive: 15, sniper: 40, throws: 10, specials: 80, jumpAttacks: 40, high: 10, low: 20,
          middle: 30, moveJump: 15, moveForward: 20, moveBack: 5, learning: 2.5, forget: 0.2,
        },
        vs: {
          line: 'I have flown worse machines than yours. Not many.',
          to: { 10: 'Your NOVA is the last machine on my test list, Major.' },
          from: { 10: 'A test pilot. Then let this be your final test.' },
        },
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
