// The player's records (EXTRAS > RECORDS): fight statistics, the best results of the arcade, survival and time attack
// modes, and achievements. They are kept in the browser's storage (like the settings) and only track what was done:
// nothing is locked behind them.
import { showAchievement } from '../../platform/achievementBanner';
import { HAR_NAMES } from '../constants';
import { settings } from '../settings';
import { tr, trKey } from '../../i18n/i18n';

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
  { id: 'first-win', title: trKey('FIRST VICTORY'), text: trKey('Win a fight.') },
  { id: 'perfect', title: trKey('UNTOUCHABLE'), text: trKey('Win a round without a scratch.') },
  { id: 'scrap', title: trKey('SCRAP METAL'), text: trKey('Finish a fight with a scrap move.') },
  { id: 'destruction', title: trKey('TOTAL DESTRUCTION'), text: trKey('Finish a fight with a destruction move.') },
  { id: 'combo3', title: trKey('COMBO ARTIST'), text: trKey('Land a three hit combo.') },
  { id: 'combo5', title: trKey('COMBO MASTER'), text: trKey('Land a five hit combo.') },
  { id: 'giant', title: trKey('GIANT KILLER'), text: trKey('Beat the computer on DEADLY or ULTIMATE.') },
  { id: 'all-robots', title: trKey('ALL ROUNDER'), text: trKey('Win with each of the ten original robots.') },
  { id: 'arcade', title: trKey('ARCADE CHAMPION'), text: trKey('Clear the arcade mode.') },
  { id: 'arcade-clean', title: trKey('ONE CREDIT'), text: trKey('Clear the arcade mode without losing a fight.') },
  { id: 'survival5', title: trKey('SURVIVOR'), text: trKey('Win five fights in a row in survival.') },
  { id: 'survival10', title: trKey('IRON WILL'), text: trKey('Win ten fights in a row in survival.') },
  { id: 'timeattack', title: trKey('AGAINST THE CLOCK'), text: trKey('Finish the time attack.') },
  { id: 'timeattack-fast', title: trKey('SPEED DEMON'), text: trKey('Finish the time attack in under three minutes.') },
  { id: 'campaign', title: trKey('WORLD SAVIOR'), text: trKey('Beat Kreissack in the one player game.') },
  { id: 'tournament', title: trKey('CHAMPION'), text: trKey('Win a tournament.') },
  { id: 'trials10', title: trKey('STUDENT'), text: trKey('Complete ten combo trials.') },
  { id: 'trials-robot', title: trKey('LAB GRADUATE'), text: trKey('Complete every trial of a robot.') },
  { id: 'clip', title: trKey('DIRECTOR'), text: trKey('Save a clip of a replay.') },
  { id: 'veteran', title: trKey('VETERAN'), text: trKey('Fight a hundred fights.') },
];

/** Notified when an achievement is earned (the game shows a notice). */
let onUnlock: (a: Achievement) => void = (a) => showAchievement(tr(a.title), tr(a.text));

export function setUnlockHandler(fn: (a: Achievement) => void): void {
  onUnlock = fn;
}

/** OMF Studio's tests play in the game's page: what happens in them is not the player's (no records, no achievements). */
let suspended = false;

export function suspendRecords(on: boolean): void {
  suspended = on;
}

export function unlock(id: string): void {
  if (suspended) return;
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
  if (!f.human || suspended) return;
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
