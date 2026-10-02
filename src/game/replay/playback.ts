// Watching a saved fight: the recording's pilots, match settings and arena are set up, and both robots are driven by
// the recorded inputs (controller/rec.ts). Playback can pause, step one game tick at a time, change speed and jump to
// any moment: the fight is played again from the start up to it, quickly and without sound or effects.
import type { Controller } from '../../controller/controller';
import { RecController, recWasAi } from '../../controller/rec';
import type { Pilot } from '../../formats/pilot';
import { recLastTick, recParse, recSeedOf, REC_GAMEMODE_TOURNAMENT, type RecFile } from '../../formats/rec';
import type { ChrFile } from '../tournament/chr';
import { setFxMuted } from '../fx';
import { CtrlType, SceneId } from '../constants';
import type { GameState, MatchSettings } from '../gameState';
import { setPilotColors } from '../pilotColors';
import { setReplayKept, type ReplayRecord } from './store';

/** Playback speeds (the up / down keys step through them). */
export const REPLAY_SPEEDS = [0.25, 0.5, 1, 2, 4];

interface SavedPlayer {
  pilot: Pilot;
  ctrl: Controller;
  chr: ChrFile | null;
  selectable: boolean;
  spWins: number;
}

export class ReplaySession {
  readonly rec: RecFile;
  /** The last tick of the recording. */
  readonly endTick: number;
  /** A tournament fight (tournament rules for damage and robot stats). */
  readonly tournament: boolean;
  speed = 1;
  paused = false;
  /** The playback controls are shown. */
  hud = true;
  /** The recording has played to its end. */
  ended = false;
  /** Clip marks for exporting (ticks), -1 when unset. */
  markIn = -1;
  markOut = -1;
  /** Jumping to a moment (the fight runs without sound or effects). */
  seeking = false;
  /** Being saved as a video or a GIF (platform/clipExport.ts): only pausing and cancelling are possible. */
  exporting: 'video' | 'gif' | null = null;
  private saved: SavedPlayer[] = [];
  private savedSettings: MatchSettings | null = null;
  private savedArena = 0;
  private active = false;

  constructor(readonly gs: GameState, readonly record: ReplayRecord, private onExit: (gs: GameState) => void) {
    this.rec = recParse(record.data);
    this.endTick = recLastTick(this.rec);
    this.tournament = this.rec.gameMode === REC_GAMEMODE_TOURNAMENT;
  }

  get arenaScene(): SceneId {
    return SceneId.ARENA0 + this.rec.arenaId;
  }

  /** Starts watching: saves the players and settings (restored on exit) and switches to the recorded arena. */
  start(): void {
    const gs = this.gs;
    this.saved = gs.players.map((p) => ({ pilot: p.pilot, ctrl: p.ctrl, chr: p.chr, selectable: p.selectable, spWins: p.spWins }));
    this.savedSettings = { ...gs.matchSettings };
    this.savedArena = gs.arena;
    this.active = true;
    gs.replay = this;
    this.install();
    gs.setNext(this.arenaScene);
  }

  /** Players, controllers, match settings and random seed from the recording. */
  private install(): void {
    const gs = this.gs;
    const rec = this.rec;
    rec.pilots.forEach((rp, i) => {
      const p = gs.players[i];
      const pilot = rp.info.clone();
      setPilotColors(pilot, pilot.color1, pilot.color2, pilot.color3);
      p.pilot = pilot;
      p.chr = null;
      const ai = recWasAi(i === 0 ? rec.p1Controller : rec.p2Controller);
      // The old controller is kept for the exit (setCtrl would free it).
      p.ctrl = new RecController(gs, i, rec, ai ? CtrlType.AI : CtrlType.KEYBOARD, ai);
      p.selectable = !ai;
    });
    gs.matchSettings = {
      throwRange: rec.throwRange, hitPause: rec.hitPause, blockDamage: rec.blockDamage, vitality: rec.vitality,
      jumpHeight: rec.jumpHeight, knockDown: rec.knockDown, rehit: rec.rehitMode === 1, defensiveThrows: rec.defThrows === 1,
      power1: rec.power[0], power2: rec.power[1], hazards: rec.hazards === 1, rounds: rec.roundType, fightMode: rec.hyperMode, sim: false,
    };
    gs.arena = rec.arenaId;
    gs.training = false;
    const seed = rec.moves.map(recSeedOf).find((s) => s !== null);
    if (seed !== undefined && seed !== null) gs.rand.setSeed(seed);
    this.ended = false;
  }

  /** Game time per tick at the playback speed. */
  scaleTickMs(ms: number): number {
    return this.seeking ? 1 : ms / this.speed;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.gs.paused = paused;
  }

  changeSpeed(dir: 1 | -1): void {
    const i = REPLAY_SPEEDS.indexOf(this.speed);
    this.speed = REPLAY_SPEEDS[Math.max(0, Math.min(REPLAY_SPEEDS.length - 1, (i < 0 ? 2 : i) + dir))];
  }

  /** Advances one game tick while paused (hit pauses run through). */
  step(): void {
    const gs = this.gs;
    const t = gs.tick;
    gs.paused = false;
    for (let i = 0; i < 64 && gs.tick === t && gs.sc.isArena(); i++) gs.dynamicTick();
    gs.paused = this.paused;
  }

  /** Jumps to a tick: the fight is played again from the start, without sound or effects, up to it. */
  seek(tick: number): void {
    const gs = this.gs;
    const target = Math.max(0, Math.min(tick, this.endTick));
    this.seeking = true;
    gs.silent = true;
    setFxMuted(true);
    try {
      this.install();
      gs.swapScene(this.arenaScene);
      gs.paused = false;
      for (let guard = 0; gs.tick < target && gs.sc.isArena() && gs.nextId === gs.thisId && guard < 200000; guard++) gs.dynamicTick();
    } finally {
      this.seeking = false;
      gs.silent = false;
      setFxMuted(false);
      gs.paused = this.paused;
    }
  }

  restart(): void {
    this.seek(0);
  }

  /** Keeps the replay for good (or lets it go with the automatic ones again); resolves to the new state. */
  async keep(): Promise<boolean> {
    const r = this.record;
    const kept = !r.meta.kept;
    if (r.id !== undefined) await setReplayKept(r.id, kept);
    r.meta.kept = kept;
    return kept;
  }

  /** The recording is over (the arena's fight ended, or the recorded inputs ran out): playback stops at the end. */
  finish(): void {
    if (this.ended || this.seeking) return;
    this.ended = true;
    this.setPaused(true);
  }

  /** Stops watching: the players and settings come back, and the replay list opens again. */
  exit(): void {
    if (!this.active) return;
    this.active = false;
    const gs = this.gs;
    for (const p of gs.players) p.ctrl.free();
    this.saved.forEach((s, i) => {
      const p = gs.players[i];
      p.pilot = s.pilot;
      p.ctrl = s.ctrl;
      p.chr = s.chr;
      p.selectable = s.selectable;
      p.spWins = s.spWins;
    });
    if (this.savedSettings) gs.matchSettings = this.savedSettings;
    gs.arena = this.savedArena;
    gs.paused = false;
    gs.replay = null;
    this.onExit(gs);
  }
}
