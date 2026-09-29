// The remaster's credits as fights (EXTRAS > CREDITS): every credit pilots a robot in its own colors and wins its fight
// against something the remaster had to beat. The fights are quick and brutal: the game's own computer fights at its
// top level, in HYPER mode, sped up, the blows heavy. They are set up the same way every time (seeds, a single round,
// player 1 hitting harder), so the credit on the left always wins; a test checks every fight
// (src/test/creditsBattles.test.ts). The robots and the arenas are the original game's, the robots painted in the
// credits' colors. creditsRun.ts runs the fights, creditsView.ts shows the cards.
import type { Pilot } from '../../formats/pilot';
import { AiDifficulty, HarId, PILOT_INFO } from '../constants';
import type { GameState } from '../gameState';
import { PRIMARY, SECONDARY, TERTIARY, setPilotColors } from '../pilotColors';
import { globalRandom } from '../../util/random';

export interface CreditFighter {
  /** The HUD's two lines: the name, then the role (or the robot). */
  name: string;
  line2: string;
  /** One of the original game's robots. */
  har: number;
  /** Primary, secondary and tertiary colors (#rrggbb): the armor, the accents and the joints. */
  colors?: [string, string, string];
  /** Or the original colors of a pilot (PILOT_INFO). */
  pilotColors?: number;
}

/** The picture on a credit's card (see creditsView.ts). */
export type CreditEmblem = 'avatar' | 'chip' | 'prism' | 'wave' | 'cover' | 'code' | 'disk';

export interface CreditBattle {
  /** The credit: what they did, who, and a line about it. */
  role: string;
  title: string;
  detail: string;
  /** Accent color of the credit's cards. */
  accent: string;
  emblem: CreditEmblem;
  /** A link on the credit's cards (the web version opens it). */
  link?: { href: string; label: string };
  winner: CreditFighter;
  loser: CreditFighter;
  arena: number;
  seed: number;
}

const HAR = HarId;

export const CREDIT_BATTLES: CreditBattle[] = [
  {
    role: 'HUMAN CODER', title: 'JARED WOODRUFF', detail: 'The idea, the direction and every call along the way', accent: '#6f9be0',
    emblem: 'avatar', link: { href: 'https://github.com/Jared-woodruff', label: 'github.com/Jared-woodruff' },
    winner: { name: 'JARED WOODRUFF', line2: 'HUMAN CODER', har: HAR.JAGUAR, colors: ['#2f5d9e', '#c9d6ea', '#e0b070'] },
    loser: { name: 'TECH DEBT', line2: 'GARGOYLE', har: HAR.GARGOYLE, colors: ['#6e5a4a', '#8a4a2c', '#3c3530'] },
    arena: 0, seed: 16,
  },
  {
    role: 'AI CODER', title: 'CLAUDE OPUS 5.5', detail: 'Max Mode. Wrote the engine, the renderer, the new robots and this screen', accent: '#d97757',
    emblem: 'chip',
    winner: { name: 'CLAUDE OPUS 5.5', line2: 'AI CODER', har: HAR.KATANA, colors: ['#d97757', '#f4efe6', '#3d2b24'] },
    loser: { name: 'SPAGHETTI CODE', line2: 'FLAIL', har: HAR.FLAIL, colors: ['#c0392b', '#f2c94c', '#7a2a1d'] },
    arena: 2, seed: 1,
  },
  {
    role: 'AI IMAGE RENDERING', title: 'OPENAI GPT6-ASTRA', detail: 'Ultra Mode. Redrew 3,200 images of the original in HD', accent: '#10a37f',
    emblem: 'prism',
    winner: { name: 'OPENAI GPT6-ASTRA', line2: 'AI IMAGE RENDERING', har: HAR.SHADOW, colors: ['#2a2a2a', '#f2f2f2', '#10a37f'] },
    loser: { name: 'PIXEL NOISE', line2: 'THORN', har: HAR.THORN, colors: ['#c2185b', '#00bcd4', '#fdd835'] },
    arena: 4, seed: 23,
  },
  {
    role: 'THE ANNOUNCERS', title: 'ELEVENLABS', detail: 'Victor and Kristen, performed with Eleven v4', accent: '#e8e8e8',
    emblem: 'wave',
    winner: { name: 'ELEVENLABS', line2: 'VICTOR & KRISTEN', har: HAR.PYROS, colors: ['#1c1c1c', '#f5f5f5', '#8a8a8a'] },
    loser: { name: 'DEAD AIR', line2: 'GARGOYLE', har: HAR.GARGOYLE, colors: ['#6b6a3a', '#a39a5a', '#3d3c22'] },
    arena: 3, seed: 22,
  },
  {
    role: "THE CREDITS' SONG", title: 'HADAL STATIC', detail: '"Twenty Ninety-Seven (Remix)", the song playing now', accent: '#e83e8c',
    emblem: 'cover', link: { href: 'https://www.hadalstatic.com/releases/twenty-ninety-seven/', label: 'hadalstatic.com' },
    winner: { name: 'HADAL STATIC', line2: 'TWENTY NINETY-SEVEN', har: HAR.ELECTRA, colors: ['#b8bec8', '#e83e8c', '#3db5f5'] },
    loser: { name: 'SILENCE', line2: 'KATANA', har: HAR.KATANA, colors: ['#9a9a9a', '#cfcfcf', '#6a6a6a'] },
    arena: 0, seed: 14,
  },
  {
    role: 'REVERSE ENGINEERING', title: 'OPENOMF', detail: 'The open-source project whose research this port follows', accent: '#ffff55',
    emblem: 'code',
    winner: { name: 'OPENOMF', line2: 'OPEN SOURCE', har: HAR.SHREDDER, colors: ['#2255aa', '#aaaaaa', '#ffff55'] },
    loser: { name: 'BLACK BOX', line2: 'SHADOW', har: HAR.SHADOW, colors: ['#262626', '#e07a1f', '#3a3a3a'] },
    arena: 1, seed: 19,
  },
  {
    role: 'THE ORIGINAL GAME', title: 'DIVERSIONS ENTERTAINMENT', detail: 'One Must Fall 2097, 1994. Published by Epic MegaGames', accent: '#f0a030',
    emblem: 'disk',
    winner: { name: 'DIVERSIONS ENTMT', line2: 'ONE MUST FALL 1994', har: HAR.NOVA, pilotColors: 10 },
    loser: { name: 'TIME', line2: 'CHRONOS', har: HAR.CHRONOS, colors: ['#8a6d46', '#c9ae82', '#4a3b28'] },
    arena: 3, seed: 32,
  },
];

/** How the credits' fights are fought (the same whatever the player's settings). */
export interface CreditsRules {
  /** Player 1's and player 2's POWER (1..8): each sets how much the other robot can take; the credit hits harder. */
  power: [number, number];
  /** The computer's skill, on both sides (AiDifficulty). */
  ai: number;
  /** The game speed (GAMEPLAY > SPEED + 5). */
  speed: number;
  /** HYPER mode: the moves' faster, harder versions. */
  hyper: boolean;
}

/** Quick and brutal: ULTIMATE against ULTIMATE in HYPER mode, at SPEED 7, the blows heavy. */
export const CREDITS_RULES: CreditsRules = { power: [8, 6], ai: AiDifficulty.ULTIMATE, speed: 12, hyper: true };
/** Game ticks (20 ms at that speed): the round starts once the VS card has had its moment (the arena's usual 30)... */
export const CREDITS_READY_TICK = 95;
/** ...and a won fight lingers on its winner, the credit's card, before it fades out (the usual 80). */
export const CREDITS_END_TICKS = 210;

/** A 16-shade ramp of a color, like the game's own: dark, the pure color at shade 9, then highlights. */
export function colorRamp(hex: string): [number, number, number][] {
  const v = parseInt(hex.slice(1), 16);
  const base = [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  const out: [number, number, number][] = [];
  for (let k = 0; k < 16; k++) {
    let c: number[];
    if (k <= 9) {
      const t = 0.1 + 0.9 * Math.pow(k / 9, 0.85);
      c = base.map((x) => x * t);
    } else {
      const t = 0.72 * Math.pow((k - 9) / 6, 1.25);
      c = base.map((x) => x + (255 - x) * t);
    }
    out.push(c.map((x) => Math.max(0, Math.min(255, Math.round(x)))) as [number, number, number]);
  }
  return out;
}

/** Paints a pilot's robot in the fighter's colors. */
export function paintFighter(pilot: Pilot, f: CreditFighter): void {
  if (f.pilotColors !== undefined) {
    const info = PILOT_INFO[f.pilotColors];
    setPilotColors(pilot, info.color1, info.color2, info.color3);
    return;
  }
  const [primary, secondary, tertiary] = f.colors!;
  for (const [slot, hex] of [[PRIMARY, primary], [SECONDARY, secondary], [TERTIARY, tertiary]] as [number, string][]) {
    colorRamp(hex).forEach(([r, g, b], k) => {
      // (the tertiary ramp's first shade is the transparent color)
      if (slot === TERTIARY && k === 0) return;
      pilot.palette.set(slot * 16 + k, r, g, b);
    });
  }
}

/**
 * Sets up a credits fight: both robots in the computer's hands, the seeds, a single round, the power settings and the
 * game speed, the names and colors. Called as the fight's arena opens (nothing may draw random numbers in between).
 */
export function setupCreditsBattle(gs: GameState, b: CreditBattle, rules = CREDITS_RULES): void {
  gs.matchSettingsDefaults();
  gs.matchSettings.rounds = 0;
  gs.matchSettings.power1 = rules.power[0];
  gs.matchSettings.power2 = rules.power[1];
  gs.matchSettings.fightMode = rules.hyper ? 1 : 0;
  gs.setSpeed(rules.speed);
  globalRandom.setSeed(b.seed);
  gs.rand.setSeed(b.seed * 7 + 3);
  [b.winner, b.loser].forEach((f, i) => {
    const p = gs.getPlayer(i);
    const info = PILOT_INFO[0];
    p.pilot.pilotId = 0;
    p.pilot.harId = f.har;
    p.pilot.power = info.power;
    p.pilot.agility = info.agility;
    p.pilot.endurance = info.endurance;
    p.pilot.name = f.name;
    p.pilot.photo = null;
    p.score.reset(true);
    paintFighter(p.pilot, f);
    gs.setupAi(i, rules.ai);
    p.selectable = false;
  });
}
