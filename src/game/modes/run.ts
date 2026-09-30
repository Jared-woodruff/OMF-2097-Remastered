// Arcade, survival and time attack (EXTRAS): player 1 against a run of computer opponents, picked on the robot select
// screen like the one player game, with the VS screen before each fight but no news in between.
// - ARCADE: eight fights, the computer getting better up to the chosen difficulty, and Kreissack last. A lost fight is
//   fought again (a continue); the score and the time are kept.
// - SURVIVAL: one round per fight, health carried over (a quarter comes back after a win), the computer getting better
//   every two wins, until a fight is lost.
// - TIME ATTACK: five one round fights as fast as possible (the clock runs while fighting; a lost fight is fought again).
// - EXHIBITION: one fight (the workshop's FIGHT), then back to the workshop.
import { createAiController } from '../../controller/ai';
import { AiDifficulty, HarId, PILOT_INFO, PilotId, SceneId } from '../constants';
import type { GameState } from '../gameState';
import { setPilotColors } from '../pilotColors';
import { records, saveRecords, unlock } from '../records/records';
import { arenaCount, randomHarPool } from '../roster';
import { settings } from '../settings';
import { langGet } from '../../resources/resources';
import { globalRandom } from '../../util/random';
import { app } from '../../app';

export type RunKind = 'arcade' | 'survival' | 'timeattack' | 'exhibition';

export const RUN_NAMES: Record<RunKind, string> = { arcade: 'ARCADE', survival: 'SURVIVAL', timeattack: 'TIME ATTACK', exhibition: 'WORKSHOP' };

const ARCADE_FIGHTS = 8;
const TIME_ATTACK_FIGHTS = 5;
/** Survival: health that comes back after a win (percent of the full health). */
const SURVIVAL_REFILL = 25;
/** Time attack: three minutes of fighting for SPEED DEMON (milliseconds). */
const FAST_MS = 180_000;

export interface RunResult {
  kind: RunKind;
  /** The run was completed (arcade, time attack) or is over (survival). */
  cleared: boolean;
  wins: number;
  continues: number;
  ms: number;
  score: number;
  /** A new best (score, wins or time). */
  record: boolean;
}

export class ModeRun {
  /** Fights won, fights lost (continues), and the fight under way (0-based). */
  wins = 0;
  continues = 0;
  /** Time fought (ms of game time) and player 1's score. */
  ms = 0;
  score = 0;
  /** Survival: player 1's health at the start of the next fight (percent). */
  health = 100;
  private beaten: number[] = [];
  private lastPilot = -1;
  private lastHar = -1;
  /** The result, once the run is over. */
  result: RunResult | null = null;

  constructor(readonly kind: RunKind, readonly difficulty = settings().gameplay.difficulty) {}

  get label(): string {
    return RUN_NAMES[this.kind];
  }

  /** Fights in the run (null: no end but a loss). */
  get total(): number | null {
    return this.kind === 'arcade' ? ARCADE_FIGHTS : this.kind === 'timeattack' ? TIME_ATTACK_FIGHTS : this.kind === 'exhibition' ? 1 : null;
  }

  /** The number of the fight under way (1-based). */
  get fight(): number {
    return this.wins + 1;
  }

  /** One round per fight in survival and time attack (arcade follows the gameplay setting). */
  rounds(): number {
    return this.kind === 'arcade' || this.kind === 'exhibition' ? settings().gameplay.rounds : 0;
  }

  /** The computer's difficulty for the fight under way. */
  opponentDifficulty(): number {
    const d = this.difficulty;
    if (this.kind === 'survival') return Math.min(AiDifficulty.ULTIMATE, AiDifficulty.ROOKIE + Math.trunc(this.wins / 2));
    if (this.kind === 'timeattack') return d;
    if (this.wins === ARCADE_FIGHTS - 1) return Math.min(AiDifficulty.ULTIMATE, d + 1);
    // From two levels below the chosen difficulty up to it.
    const start = Math.max(AiDifficulty.ROOKIE, d - 2);
    return Math.min(d, start + Math.trunc((this.wins * (d - start + 1)) / (ARCADE_FIGHTS - 1)));
  }

  /** Sets up the opponent of the fight under way (after a lost fight: the same one again) and the arena. */
  setupOpponent(gs: GameState, again = false): void {
    const p1 = gs.getPlayer(0);
    const p2 = gs.getPlayer(1);
    const pilot = p2.pilot;
    let pilotId: number;
    let harId: number;
    if (again && this.lastPilot >= 0) {
      pilotId = this.lastPilot;
      harId = this.lastHar;
    } else if (this.kind === 'arcade' && this.wins === ARCADE_FIGHTS - 1) {
      pilotId = PilotId.KREISSACK;
      harId = HarId.NOVA;
    } else {
      const free = Array.from({ length: 10 }, (_, i) => i).filter((i) => i !== p1.pilot.pilotId && !this.beaten.includes(i));
      const pool = free.length ? free : Array.from({ length: 10 }, (_, i) => i).filter((i) => i !== p1.pilot.pilotId);
      pilotId = pool[globalRandom.int(pool.length)];
      const hars = randomHarPool();
      harId = hars[globalRandom.int(hars.length)];
      gs.arena = globalRandom.int(arenaCount());
    }
    this.lastPilot = pilotId;
    this.lastHar = harId;
    const info = PILOT_INFO[pilotId];
    pilot.pilotId = pilotId;
    pilot.harId = harId;
    pilot.endurance = info.endurance;
    pilot.power = info.power;
    pilot.agility = info.agility;
    pilot.sex = info.sex;
    pilot.name = langGet(pilotId + 20);
    setPilotColors(pilot, info.color1, info.color2, info.color3);
    p2.setCtrl(createAiController(gs, this.opponentDifficulty(), pilot, pilotId));
    p2.selectable = false;
    gs.matchSettings.rounds = this.rounds();
    gs.modeLabel = this.label;
  }

  /**
   * A fight is over: what comes next is set up (the next fight, the same one again, or the end of the run, with the
   * records). `ms` is the time fought, `health` player 1's health left (percent).
   */
  fightOver(gs: GameState, won: boolean, ms: number, health: number): void {
    this.ms += ms;
    this.score = gs.getPlayer(0).score.score;
    if (this.kind === 'exhibition') {
      // Back to the workshop.
      app.showWorkshop();
      gs.menuReturn = 'extras';
      gs.setNext(SceneId.MENU);
      return;
    }
    if (won) {
      this.wins++;
      if (this.lastPilot >= 0) this.beaten.push(this.lastPilot);
      if (this.kind === 'survival') this.health = Math.min(100, health + SURVIVAL_REFILL);
      if (this.total !== null && this.wins >= this.total) {
        this.finish(gs, true);
        return;
      }
      this.setupOpponent(gs);
    } else if (this.kind === 'survival') {
      this.finish(gs, false);
      return;
    } else {
      this.continues++;
      this.setupOpponent(gs, true);
    }
    gs.setNext(SceneId.VS);
  }

  /** The run is over: its records, and back to the menu (where the results show). */
  private finish(gs: GameState, cleared: boolean): void {
    const r = records();
    let record = false;
    if (this.kind === 'arcade' && cleared) {
      r.arcade.clears++;
      if (this.score > r.arcade.bestScore) {
        r.arcade.bestScore = this.score;
        record = true;
      }
      if (!r.arcade.fastest || this.ms < r.arcade.fastest) r.arcade.fastest = this.ms;
      unlock('arcade');
      if (this.continues === 0) unlock('arcade-clean');
    } else if (this.kind === 'survival') {
      if (this.wins > r.survival.best) {
        r.survival.best = this.wins;
        record = this.wins > 0;
      }
      if (this.wins >= 5) unlock('survival5');
      if (this.wins >= 10) unlock('survival10');
    } else if (this.kind === 'timeattack' && cleared) {
      if (!r.timeattack.best || this.ms < r.timeattack.best) {
        r.timeattack.best = this.ms;
        record = true;
      }
      unlock('timeattack');
      if (this.ms < FAST_MS) unlock('timeattack-fast');
    }
    saveRecords();
    this.result = { kind: this.kind, cleared, wins: this.wins, continues: this.continues, ms: this.ms, score: this.score, record };
    app.showRunResults(this.result);
    gs.menuReturn = 'modes';
    gs.setNext(SceneId.MENU);
  }
}

/** Minutes, seconds and tenths. */
export function formatMs(ms: number): string {
  const t = Math.max(0, Math.round(ms / 100));
  const s = Math.trunc(t / 10);
  return `${Math.trunc(s / 60)}:${String(s % 60).padStart(2, '0')}.${t % 10}`;
}
