// Fire and Ice: the original game's hidden one-player opponents, as its program (MASTER.DAT) sets them up.
//
// On CHAMPION or harder, a destruction in the Fire Pit followed by the winner's Fire & Ice move (the robot's move with
// position bit 0x40; its animation's `b1` frame opens the way, `b2` breaks the floor) sends the robot through the
// floor: the next fight is against FIRE, an enhanced Katana, in the flames version of the Fire Pit (ARENA3.BK palette
// 1). On ULTIMATE the floor there is still a grille, and the same against Fire leads to ICE, an enhanced and translucent
// Shadow, in the frozen Fire Pit (palette 2). Their stages score 5 and 50 times as much. They are bonus fights: losing
// one costs nothing (the game goes on as after the fight that led there), and beating one closes the Fire Pit's floor
// for the rest of the game: no more globes there, and no way down.
//
// Reverse engineered from the original program (see docs/ARCHITECTURE.md, "Fire and Ice"): the fight setup writes
// Fire's and Ice's pilot record over the beaten opponent's (0x31033-0x31212), the arena takes the stage as its palette,
// remap tables and animation variant (0x1b0ee, 0x28699, 0x29428) and draws the three sprites of its animation 5 into
// the background (0x3161d), and a robot's condition mask (0x112aa) holds the bits its moves' position constraints ask for.
import { AiDifficulty, HarId } from './constants';
import { color6to8, type Palette } from '../formats/palette';
import type { Pilot } from '../formats/pilot';
import { langGet, type Bk } from '../resources/resources';
import { applyPersonality, type Personality } from '../controller/personalities';
import type { FightStats } from './gameState';
import type { HarScreencaps } from './harScreencap';

/** The arena with the way down. */
export const FIRE_PIT = 3;

/** The remastered ambience of Ice's frozen Fire Pit (fx/arenas.ts: ICE_CAVE). */
export const ICE_LOOK = 6;

/** The secret fight under way (the original's REC byte): none, Fire's or Ice's. */
export const enum SecretStage {
  NONE = 0,
  FIRE = 1,
  ICE = 2,
}

/** Move position-constraint bits of the original's robot condition mask (8 << arena: the arena the fight is in). */
export const POS_ARENA_BITS = 0xf8;
/** The way down is open in this fight. */
export const POS_WAY_DOWN = 0x2000;
/** The opponent was destroyed (a destruction was done). */
export const POS_DESTROYED = 0x4000;
/** A Fire & Ice move: one that needs the Fire Pit (8 << 3). */
export const POS_FIRE_PIT = 0x40;

/** A pilot record's draw flags (its word at 0xF4, OR'd into its robot's sprite flags): 0x400 is `bt`, translucent. */
export const PILOT_DRAW_TRANSLUCENT = 0x400;

/** One secret opponent as the original writes it over the beaten pilot's record. */
interface Secret {
  /** ENGLISH.DAT entry of the name ("FIRE", "ICE"). */
  nameText: number;
  harId: HarId;
  power: number;
  agility: number;
  endurance: number;
  offense: number;
  defense: number;
  /** Move preferences (the rest of the personality stays the beaten pilot's, as in the original). */
  ai: Partial<Personality>;
  drawFlags: number;
  /** Score multiplier on top of the stage before (Fire 5, Ice 10 more: 50). */
  scoreFactor: number;
  /** The tint of the player's robot on this stage: 6-bit color and level out of 64 (the original's palette effect). */
  tint: [number, number, number];
  tintLevel: number;
}

const SECRETS: Record<SecretStage.FIRE | SecretStage.ICE, Secret> = {
  [SecretStage.FIRE]: {
    nameText: 189, harId: HarId.KATANA, power: 24, agility: 26, endurance: 30, offense: 130, defense: 130,
    ai: { apThrow: 50, apSpecial: 20, apJump: 10, apHigh: -5, apLow: 10, apMiddle: 10, prefJump: -20, prefFwd: 100, prefBack: 10 },
    drawFlags: 0, scoreFactor: 5, tint: [63, 35, 0], tintLevel: 16,
  },
  [SecretStage.ICE]: {
    nameText: 190, harId: HarId.SHADOW, power: 30, agility: 30, endurance: 33, offense: 170, defense: 170,
    ai: { apThrow: 50, apSpecial: 50, apJump: 20, apHigh: 2, apLow: 20, apMiddle: 20, prefJump: 0, prefFwd: 10, prefBack: 100 },
    drawFlags: PILOT_DRAW_TRANSLUCENT, scoreFactor: 10, tint: [0, 20, 63], tintLevel: 19,
  },
};

/** The enhancement level the secret opponents fight with (their robots' third: Fire's fireball, Ice's ice freeze). */
const SECRET_ENHANCEMENT = 3;

/** The Fire Pit as one fight has it. */
export interface FirePit {
  stage: SecretStage;
  /** The Fire & Ice move can be done (player 1's, after a destruction). */
  wayDown: boolean;
  /** The floor's grille is covered (Fire beaten; the secret stages, except Fire's on ULTIMATE). */
  solidFloor: boolean;
  /** No globes (no fireballs): the secret stages, and after Fire was beaten. */
  noGlobes: boolean;
}

/** What a one-player game remembers: the secret fight under way, Fire beaten, and the fight the way down started from. */
export interface FireIceRun {
  stage: SecretStage;
  fireBeaten: boolean;
  resume: FireIceResume | null;
}

/** The fight the way down started from: put back when the secret fights are over (the news are about it). */
export interface FireIceResume {
  pilot: Pilot;
  spWins: [number, number];
  arena: number;
  fightStats: FightStats;
  screencaps: [HarScreencaps, HarScreencaps];
}

export function newFireIceRun(): FireIceRun {
  return { stage: SecretStage.NONE, fireBeaten: false, resume: null };
}

/**
 * The Fire Pit of a live one-player fight (the original's [0x847b4] and the setup at 0x314b3): the way down needs
 * CHAMPION or harder and opens once per game; from Fire's stage only on ULTIMATE; never from Ice's.
 */
export function firePitLive(run: FireIceRun, difficulty: number, storyFight: boolean): FirePit {
  const stage = storyFight ? run.stage : SecretStage.NONE;
  const fireBeaten = storyFight && run.fireBeaten;
  let wayDown = storyFight && difficulty >= AiDifficulty.CHAMPION;
  if (stage === SecretStage.NONE && fireBeaten) wayDown = false;
  if (stage === SecretStage.FIRE && difficulty !== AiDifficulty.ULTIMATE) wayDown = false;
  if (stage === SecretStage.ICE) wayDown = false;
  return {
    stage,
    wayDown,
    solidFloor: stage !== SecretStage.NONE ? difficulty <= AiDifficulty.DEADLY || stage === SecretStage.ICE : fireBeaten,
    noGlobes: stage !== SecretStage.NONE || fireBeaten,
  };
}

/** The Fire Pit of a recorded fight: its stage (REC header) and its flags (the replay's Fire Pit record, if any). */
export function firePitRecorded(stage: number, flags: number | null): FirePit {
  const s = stage === SecretStage.FIRE || stage === SecretStage.ICE ? stage : SecretStage.NONE;
  if (flags === null) return { stage: s, wayDown: false, solidFloor: s !== SecretStage.NONE, noGlobes: s !== SecretStage.NONE };
  return { stage: s, wayDown: (flags & PIT_WAY_DOWN) !== 0, solidFloor: (flags & PIT_SOLID_FLOOR) !== 0, noGlobes: (flags & PIT_NO_GLOBES) !== 0 };
}

/** The Fire Pit record's flags (REC extended record 'F', see formats/rec.ts). */
export const PIT_WAY_DOWN = 1;
export const PIT_SOLID_FLOOR = 2;
export const PIT_NO_GLOBES = 4;

export function firePitFlags(pit: FirePit): number {
  return (pit.wayDown ? PIT_WAY_DOWN : 0) | (pit.solidFloor ? PIT_SOLID_FLOOR : 0) | (pit.noGlobes ? PIT_NO_GLOBES : 0);
}

/** The Fire Pit's BK has the secret stages' palettes and sprites (a mod could replace the file). */
export function firePitUsable(bk: Bk): boolean {
  const a5 = bk.infos.get(5);
  return bk.palettes.length >= 3 && bk.remaps.length >= 3 && !!a5 && a5.ani.sprites.length >= 3 && bk.infos.has(12);
}

/**
 * Fire's or Ice's pilot record: the beaten opponent's, with what the original writes over it (name, robot, stats,
 * move preferences, the third enhancement, Ice's translucency), and the colors of the stage's palette (its player 2
 * colors: Fire's flames, Ice's ice).
 */
export function secretPilot(beaten: Pilot, stage: SecretStage.FIRE | SecretStage.ICE, bk: Bk): Pilot {
  const s = SECRETS[stage];
  const p = beaten.clone();
  p.name = langGet(s.nameText).trim() || (stage === SecretStage.FIRE ? 'FIRE' : 'ICE');
  p.harId = s.harId;
  p.power = s.power;
  p.agility = s.agility;
  p.endurance = s.endurance;
  p.offense = s.offense;
  p.defense = s.defense;
  p.enhancements[s.harId] = SECRET_ENHANCEMENT;
  setPilotDrawFlags(p, s.drawFlags);
  applyPersonality(p, s.ai);
  const pal = bk.palettes[stage];
  if (pal) p.palette.colors.set(pal.colors.subarray(48 * 3, 96 * 3), 0);
  return p;
}

/** Fire's and Ice's move preferences again, after their computer player set the beaten pilot's personality. */
export function secretPersonality(pilot: Pilot, stage: SecretStage): void {
  if (stage === SecretStage.FIRE || stage === SecretStage.ICE) applyPersonality(pilot, SECRETS[stage].ai);
}

/** The score multiplier of a stage (on top of the difficulty's). */
export function stageScoreFactor(stage: SecretStage): number {
  if (stage === SecretStage.FIRE) return SECRETS[SecretStage.FIRE].scoreFactor;
  if (stage === SecretStage.ICE) return SECRETS[SecretStage.FIRE].scoreFactor * SECRETS[SecretStage.ICE].scoreFactor;
  return 1;
}

/** A pilot record's draw flags (word 0xF4: the 7th and 8th bytes of its unknown block F). */
export function pilotDrawFlags(p: Pilot): number {
  return p.unkBlockF[6] | (p.unkBlockF[7] << 8);
}

export function setPilotDrawFlags(p: Pilot, flags: number): void {
  p.unkBlockF[6] = flags & 0xff;
  p.unkBlockF[7] = (flags >> 8) & 0xff;
}

/**
 * The original's palette effect in its colorize mode (MASTER.DAT 0x5ec68 with mode 1, in 6-bit VGA values): each color
 * moves toward `rgb` by level/64, scaled by its brightest channel (bright colors take more of it).
 */
export function paletteColorize(pal: Palette, start: number, count: number, rgb: readonly [number, number, number], level: number): void {
  const c = pal.colors;
  for (let i = start; i < start + count; i++) {
    const o = i * 3;
    const base = [c[o] >> 2, c[o + 1] >> 2, c[o + 2] >> 2];
    const max = Math.max(base[0], base[1], base[2]);
    for (let k = 0; k < 3; k++) {
      const d = (((rgb[k] - base[k]) * level) >> 6) * max >> 6;
      c[o + k] = color6to8(Math.max(0, Math.min(63, base[k] + d)));
    }
  }
}

/** The player's robot on a secret stage: lit by its flames or its ice (the colors of player 1, 1..47, in `pal`). */
export function tintForStage(pal: Palette, stage: SecretStage): void {
  if (stage !== SecretStage.FIRE && stage !== SecretStage.ICE) return;
  const s = SECRETS[stage];
  paletteColorize(pal, 1, 47, s.tint, s.tintLevel);
}
