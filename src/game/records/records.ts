// The player's records (EXTRAS > RECORDS): fight statistics, the best results of the arcade, survival and time attack
// modes, and achievements. They are kept in the browser's storage (like the settings) and only track what was done:
// nothing is locked behind them.
import { showAchievement } from '../../platform/achievementBanner';
import { HAR_NAMES } from '../constants';
import { settings } from '../settings';

const STORAGE_KEY = 'omf2097r.records';

export interface Records {
  fights: number;
  wins: number;
  losses: number;
  /** Player 1's fights and wins with each robot (against the computer or a second player). */
  robots: Record<number, { fights: number; wins: number }>;
  perfects: number;
  scraps: number;
  destructions: number;
  /** Most hits and damage in one combo. */
  bestCombo: number;
  /** Game ticks fought. */
  ticks: number;
  arcade: { clears: number; bestScore: number; fastest: number };
  survival: { best: number };
  timeattack: { best: number };
  /** Achievement id -> when (ms since 1970). */
  achievements: Record<string, number>;
  clips: number;
}

function empty(): Records {
  return {
    fights: 0, wins: 0, losses: 0, robots: {}, perfects: 0, scraps: 0, destructions: 0, bestCombo: 0, ticks: 0,
    arcade: { clears: 0, bestScore: 0, fastest: 0 }, survival: { best: 0 }, timeattack: { best: 0 }, achievements: {}, clips: 0,
  };
}

let current: Records | null = null;

export function records(): Records {
  if (!current) {
    current = empty();
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
      if (raw) {
        const saved = JSON.parse(raw) as Partial<Records>;
        current = { ...current, ...saved, arcade: { ...current.arcade, ...saved.arcade }, survival: { ...current.survival, ...saved.survival },
          timeattack: { ...current.timeattack, ...saved.timeattack }, achievements: { ...saved.achievements }, robots: { ...saved.robots } };
      }
    } catch {
      // unreadable: start afresh
    }
  }
  return current;
}

export function saveRecords(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records()));
  } catch {
    // storage unavailable: kept for this session
  }
}

/** Forgets everything (tests). */
export function resetRecords(): void {
  current = empty();
}

// ---- achievements ------------------------------------------------------------------------------------------------

export interface Achievement {
  id: string;
  title: string;
  text: string;
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first-win', title: 'FIRST VICTORY', text: 'Win a fight.' },
  { id: 'perfect', title: 'UNTOUCHABLE', text: 'Win a round without a scratch.' },
  { id: 'scrap', title: 'SCRAP METAL', text: 'Finish a fight with a scrap move.' },
  { id: 'destruction', title: 'TOTAL DESTRUCTION', text: 'Finish a fight with a destruction move.' },
  { id: 'combo3', title: 'COMBO ARTIST', text: 'Land a three hit combo.' },
  { id: 'combo5', title: 'COMBO MASTER', text: 'Land a five hit combo.' },
  { id: 'giant', title: 'GIANT KILLER', text: 'Beat the computer on DEADLY or ULTIMATE.' },
  { id: 'all-robots', title: 'ALL ROUNDER', text: 'Win with each of the ten original robots.' },
  { id: 'arcade', title: 'ARCADE CHAMPION', text: 'Clear the arcade mode.' },
  { id: 'arcade-clean', title: 'ONE CREDIT', text: 'Clear the arcade mode without losing a fight.' },
  { id: 'survival5', title: 'SURVIVOR', text: 'Win five fights in a row in survival.' },
  { id: 'survival10', title: 'IRON WILL', text: 'Win ten fights in a row in survival.' },
  { id: 'timeattack', title: 'AGAINST THE CLOCK', text: 'Finish the time attack.' },
  { id: 'timeattack-fast', title: 'SPEED DEMON', text: 'Finish the time attack in under three minutes.' },
  { id: 'campaign', title: 'WORLD SAVIOR', text: 'Beat Kreissack in the one player game.' },
  { id: 'tournament', title: 'CHAMPION', text: 'Win a tournament.' },
  { id: 'trials10', title: 'STUDENT', text: 'Complete ten combo trials.' },
  { id: 'trials-robot', title: 'LAB GRADUATE', text: 'Complete every trial of a robot.' },
  { id: 'clip', title: 'DIRECTOR', text: 'Save a clip of a replay.' },
  { id: 'veteran', title: 'VETERAN', text: 'Fight a hundred fights.' },
];

/** Notified when an achievement is earned (the game shows a notice). */
let onUnlock: (a: Achievement) => void = (a) => showAchievement(a.title, a.text);

export function setUnlockHandler(fn: (a: Achievement) => void): void {
  onUnlock = fn;
}

export function unlock(id: string): void {
  const r = records();
  if (r.achievements[id]) return;
  const a = ACHIEVEMENTS.find((x) => x.id === id);
  if (!a) return;
  r.achievements[id] = Date.now();
  saveRecords();
  onUnlock(a);
}

// ---- what happened ------------------------------------------------------------------------------------------------

export interface FightResult {
  /** Player 1 is a person (else a CPU fight, not counted). */
  human: boolean;
  /** Player 2 is a person too. */
  versus: boolean;
  /** Player 1 won. */
  won: boolean;
  harId: number;
  /** The computer's difficulty (-1: a person). */
  cpuDifficulty: number;
  perfect: boolean;
  finish: 'none' | 'scrap' | 'destruction';
  /** Player 1's longest combo (hits). */
  bestCombo: number;
  ticks: number;
}

/** A fight ended (not training, replays or demos). */
export function recordFight(f: FightResult): void {
  if (!f.human) return;
  const r = records();
  r.fights++;
  r.ticks += f.ticks;
  const robot = (r.robots[f.harId] ??= { fights: 0, wins: 0 });
  robot.fights++;
  if (f.won) {
    r.wins++;
    robot.wins++;
    if (f.perfect) r.perfects++;
    if (f.finish === 'scrap') r.scraps++;
    if (f.finish === 'destruction') r.destructions++;
  } else if (!f.versus) {
    r.losses++;
  }
  r.bestCombo = Math.max(r.bestCombo, f.bestCombo);
  saveRecords();
  if (f.won) unlock('first-win');
  if (f.won && f.perfect) unlock('perfect');
  if (f.won && f.finish === 'scrap') unlock('scrap');
  if (f.won && f.finish === 'destruction') unlock('destruction');
  if (f.bestCombo >= 3) unlock('combo3');
  if (f.bestCombo >= 5) unlock('combo5');
  if (f.won && f.cpuDifficulty >= 5) unlock('giant');
  if (f.won && HAR_NAMES.slice(0, 10).every((_, id) => (r.robots[id]?.wins ?? 0) > 0)) unlock('all-robots');
  if (r.fights >= 100) unlock('veteran');
}

/** Combo trials done (training). */
export function recordTrials(done: string[], trialsPerRobot: (harId: number) => number): void {
  if (done.length >= 10) unlock('trials10');
  const byRobot = new Map<number, number>();
  for (const k of done) {
    const har = Number(k.split(':')[0]);
    byRobot.set(har, (byRobot.get(har) ?? 0) + 1);
  }
  for (const [har, n] of byRobot) if (n >= trialsPerRobot(har) && n > 0) unlock('trials-robot');
}

export function recordClip(): void {
  records().clips++;
  saveRecords();
  unlock('clip');
}

/** The game's difficulty setting (for the records of the modes). */
export function difficulty(): number {
  return settings().gameplay.difficulty;
}
