// EXTRAS > CREDITS: the remaster's credits, scored to Hadal Static's "Twenty Ninety-Seven (Remix)". Everything keeps time
// with the song (song.ts; conductor.ts is the clock): the title over the city at night through the song's intro, the logo
// struck by lightning on the drop; then the fights (battles.ts), each credit in its own colors winning its fight: every
// arena opens held, its VS card slams on a downbeat, and it is let go at the moment that lands its final blow on the beat
// (the fights take the same number of ticks every time; small drifts are caught up by nudging the game's speed); the
// cut to the next fight comes on a downbeat once the credit's card has had its moment. Last, the end titles at dawn: the
// winners, then a cut on a downbeat to the song's last chorus (its own file, see song.ts) so that they finish on its
// final hit, whenever the fights ended. ENTER / A skips ahead, ESC / B goes back to the main menu. The arena asks for
// what it needs through GameState.credits (CreditsHooks); creditsView.ts draws the show from its timetable.
import { audio, type Track } from '../../audio/audio';
import { onKey } from '../../controller/input';
import { langGet } from '../../resources/resources';
import { ACT_DOWN, ACT_ESC, ACT_KICK, ACT_LEFT, ACT_PUNCH, ACT_RIGHT, ACT_UP, isArenaScene, SceneId, STATIC_TICKS } from '../constants';
import type { GameState } from '../gameState';
import { helpOverlayOpen } from '../gui/helpOverlay';
import { CREDIT_BATTLES, CREDITS_END_TICKS, CREDITS_READY_TICK, CREDITS_RULES, CREDITS_TICK_MS, setupCreditsBattle } from './battles';
import { Conductor } from './conductor';
import { openCreditsView, type CreditsView } from './creditsView';
import { barAt, barTime, BEAT, ENDING_BAR, ENDING_FILE, ENDING_PREROLL, nextBar, SECTIONS } from './song';

/** What the arena asks of the credits' fights (GameState.credits while they run). */
export interface CreditsHooks {
  /** The arena opens: the fight is set up (pilots, robots, colors, the computer players, the seeds), held. */
  setupFight(): void;
  /** The HUD's second line under a player's name. */
  hudLine(player: number): string;
  /** The tick the round starts on (after the VS card), and the tick a won fight fades out on (never: see cut). */
  readonly readyTick: number;
  readonly endTicks: number;
  /** The fight has faded out by itself (it does not: the credits cut away first). */
  fightOver(): void;
  /** A pad's menu action: A skips ahead, B leaves. */
  action(action: number): void;
  /** Every static tick of the game (10 ms): the credits' clock and timetable. */
  staticTick(): void;
}

/** A fight's timetable (song seconds): its VS card slams, its arena is let go, its final blow lands, the cut. */
export interface FightTimes {
  vs: number;
  go: number;
  blow: number;
  cut: number;
}

/** The end titles' timetable (song seconds). */
export interface FinaleTimes {
  /** They begin (the last fight's cut). */
  start: number;
  /** The cut to the song's ending (its bar ENDING_BAR), and the bar it happens on; `done` once it happened. */
  jump: number;
  jumpBar: number;
  jumped: boolean;
  /** The song's final hit, and the end (the ring-out, the picture switching off). */
  hit: number;
  end: number;
}

export type Phase = 'title' | 'fights' | 'finale' | 'done';

/** The show at a moment, for the view. */
export interface CreditsShow {
  /** The song's position (s). */
  t: number;
  phase: Phase;
  /** The title's end: the first fight's VS card. */
  titleEnd: number;
  /** The fight on screen (-1 before the first) and the fights' timetables so far. */
  fighting: number;
  fights: (FightTimes | null)[];
  finale: FinaleTimes | null;
  /** When the credits started to leave (ESC, or their end), or null. */
  leaving: number | null;
  /** The fighters' feet on the screen (native coordinates), while a fight is on. */
  fighters: [number, number][] | null;
}

/** The credits' song (the game's ending theme when it cannot be played). */
const SONG = 'audio/credits/twenty-ninety-seven-remix.flac';
const FALLBACK_MUSIC = 'END.PSM';
/** The title ends, and the first fight's VS card slams, on this bar: four bars after the drop. */
export const TITLE_END_BAR = SECTIONS.drop + 4;
/** Seconds: from planning a fight to its VS card (at least), and the freeze under the card before the arena goes. */
const VS_LEAD = 0.35;
const HOLD_MIN = 0.25;
/** Seconds after the final blow before the cut (at least, at most): the fall, a finishing move, the credit's card. */
const AFTER_MIN = 5.2;
const AFTER_MAX = 8.6;
/** Bars of the end titles before the cut to the song's ending (at least): the winners, one a bar. */
export const FINALE_MIN_BARS = 10;
/** Seconds after the final hit: the ring-out and the last picture, then the picture switches off. */
const END_HOLD = 5.6;
const SWITCH_OFF = 0.9;
/** A song that has not started playing after this long (s) is given up (the game's ending theme plays instead). */
const SONG_START_WAIT = 4;
/** The winner's picture for the end titles, this long (s) before the cut (posing, the finishing move over). */
const STILL_BEFORE = 0.45;
/** Game speeds a tick shorter and a tick longer (19 and 21 ms): the final blow kept on its beat. */
const SPEED_FAST = CREDITS_RULES.speed + 0.25;
const SPEED_SLOW = CREDITS_RULES.speed - 0.25;

export interface CreditsStart {
  /** Links open in the browser (the web version; the desktop app shows them as text). */
  links: boolean;
  /** Development: start at the n-th fight (1..), or at the end titles (past the last fight). */
  start?: number;
}

/** Starts the credits (EXTRAS > CREDITS). */
export function startCredits(gs: GameState, opts: CreditsStart): void {
  if (gs.credits) return;
  const run = new CreditsRun(gs, opts.start ?? 0);
  gs.credits = run;
  run.open(opts.links);
  run.begin();
}

/** The first half bar (a downbeat or a third beat) at or after time t. */
function nextHalfBar(t: number): number {
  return barTime(Math.ceil(barAt(t) * 2 - 1e-6) / 2);
}

export class CreditsRun implements CreditsHooks {
  readonly readyTick = CREDITS_READY_TICK;
  readonly endTicks = CREDITS_END_TICKS;
  phase: Phase = 'title';
  /** The fight on screen (set up last), and the next one to set up. */
  fighting = -1;
  private next = 0;
  /** The fight the credits moved on from last (a fight is left once). */
  private leftFight = -1;
  readonly fights: (FightTimes | null)[] = CREDIT_BATTLES.map(() => null);
  finale: FinaleTimes | null = null;
  titleEnd = barTime(TITLE_END_BAR);
  private leaving: number | null = null;
  clock = new Conductor(null);
  private track: Track | null = null;
  private ending: AudioBuffer | null = null;
  private view: CreditsView | null = null;
  private opened = 0;
  private raf = 0;
  private lastFrameT = 0;
  private unsubscribeKeys: (() => void) | null = null;
  /** The fight on screen: let go (its tick then), its blow landed, its winner's picture taken. */
  private released = false;
  private goTick = 0;
  private blown = false;
  private still = false;
  /** Development: straight to the end titles once the first arena is open. */
  private finaleAtOnce = false;

  constructor(private gs: GameState, start = 0) {
    if (start > 0) {
      this.phase = 'fights';
      this.titleEnd = 0;
      this.next = Math.min(start, CREDIT_BATTLES.length) - 1;
      this.finaleAtOnce = start > CREDIT_BATTLES.length;
    }
  }

  /** The song and the view (the browser: not in tests, which run the fights headless on the credits' own time). */
  open(links: boolean): void {
    audio.stopMusic();
    // (skipping straight to the fights, the song starts at the drop)
    const at = this.phase === 'title' ? 0 : barTime(SECTIONS.drop);
    this.track = audio.playTrack(SONG, () => this.songFailed(), this.phase === 'title' ? 0.4 : 0.8);
    if (this.track) {
      if (at > 0) this.track.seek(at);
      this.clock = new Conductor(this.track);
      void audio.loadBuffer(ENDING_FILE).then((b) => (this.ending = b));
    } else {
      audio.playMusic(FALLBACK_MUSIC);
      this.clock.jump(at);
    }
    this.view = openCreditsView({
      links,
      song: this.track,
      harName: (harId) => langGet(harId + 31),
      onNext: () => this.skip(),
      onExit: () => this.exit(),
    });
    this.unsubscribeKeys = onKey((code, e) => this.key(code, e));
    this.opened = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  /** The first fight's arena opens (held, under the title). */
  begin(): void {
    this.gs.setNext(SceneId.ARENA0 + CREDIT_BATTLES[this.next].arena);
  }

  /** The song could not be played: the game's ending theme instead, and the credits' own time. */
  private songFailed(): void {
    this.track?.stop(0);
    this.track = null;
    this.clock.ownTime();
    this.view?.songFailed();
    if (this.phase !== 'done') audio.playMusic(FALLBACK_MUSIC);
  }

  /** The show now, for the view. */
  show(): CreditsShow {
    let fighters: [number, number][] | null = null;
    if (this.phase === 'fights' && isArenaScene(this.gs.thisId)) {
      fighters = [0, 1].map((i) => {
        const o = this.gs.findObject(this.gs.getPlayer(i).harObjId);
        return [o?.posX ?? 160, o?.posY ?? 190] as [number, number];
      });
    }
    return {
      t: this.clock.time, phase: this.phase, titleEnd: this.titleEnd, fighting: this.fighting, fights: this.fights,
      finale: this.finale, leaving: this.leaving, fighters,
    };
  }

  // ---- CreditsHooks ------------------------------------------------------------------------------------------------
  setupFight(): void {
    const gs = this.gs;
    this.fighting = this.next;
    setupCreditsBattle(gs, CREDIT_BATTLES[this.fighting]);
    // (held until its time: the timetable is made at the next tick, once the arena's artwork is in)
    gs.paused = true;
    this.released = this.blown = this.still = false;
    this.fights[this.fighting] = null;
    if (this.finaleAtOnce) {
      this.finaleAtOnce = false;
      this.leftFight = this.fighting;
      this.startFinale(this.clock.time);
    }
  }

  hudLine(player: number): string {
    const b = CREDIT_BATTLES[Math.max(0, this.fighting)];
    return (player === 0 ? b.winner : b.loser).line2;
  }

  fightOver(): void {
    if (this.phase === 'fights') this.advance();
  }

  action(action: number): void {
    if (action & ACT_ESC) this.exit();
    else if (action & (ACT_PUNCH | ACT_KICK)) this.skip();
    else if (action & (ACT_LEFT | ACT_RIGHT | ACT_UP | ACT_DOWN)) this.view?.wake();
  }

  /** The keyboard: ENTER / SPACE skip ahead, ESC leaves (not while F1 help is up). */
  private key(code: string, e: KeyboardEvent): void {
    if (e.repeat || e.altKey || helpOverlayOpen() || e.timeStamp <= this.opened) return;
    if (code === 'Escape') this.exit();
    else if (code === 'Enter' || code === 'NumpadEnter' || code === 'Space') this.skip();
  }

  // ---- the timetable -----------------------------------------------------------------------------------------------
  staticTick(): void {
    this.clock.tick(STATIC_TICKS);
    this.clock.sync();
    this.schedule();
  }

  /** Keeps the show on its timetable: the title's end, the fights' holds, blows and cuts, the end titles' cut and end. */
  private schedule(): void {
    const t = this.clock.time;
    const gs = this.gs;
    // A song that never starts (still loading after a while: a slow connection) is given up.
    if (this.track && this.clock.time === 0 && this.track.position() === null && performance.now() - this.opened > SONG_START_WAIT * 1000) {
      this.songFailed();
    }
    if (this.phase === 'title') {
      if (isArenaScene(gs.thisId)) gs.paused = true;
      if (t >= this.titleEnd - VS_LEAD) this.phase = 'fights';
    }
    if (this.phase === 'fights') this.scheduleFight(t);
    if (this.phase === 'finale') this.scheduleFinale(t);
    if (this.phase === 'done') this.leave();
  }

  private scheduleFight(t: number): void {
    const gs = this.gs;
    const i = this.fighting;
    if (i < 0 || this.leftFight === i || !isArenaScene(gs.thisId)) return;
    const b = CREDIT_BATTLES[i];
    let f = this.fights[i];
    if (!f) {
      // The VS card on a downbeat (the title's end for the first fight), the blow on the first half bar it can reach, the
      // arena let go that many ticks before, and the cut on a downbeat after the blow's aftermath.
      const vs = t < this.titleEnd ? this.titleEnd : barTime(nextBar(t + VS_LEAD));
      const toBlow = (b.blow * CREDITS_TICK_MS) / 1000;
      const blow = nextHalfBar(vs + HOLD_MIN + toBlow);
      const after = Math.min(AFTER_MAX, Math.max(AFTER_MIN, ((b.done - b.blow) * CREDITS_TICK_MS) / 1000 - 1.2));
      f = this.fights[i] = { vs, go: blow - toBlow, blow, cut: barTime(nextBar(blow + after)) };
    }
    if (!this.released) {
      gs.paused = true;
      if (t >= f.go) {
        gs.paused = false;
        this.released = true;
        this.goTick = gs.intTick;
      }
    } else if (!this.blown) {
      // Keeping the blow on its beat: the game a tick faster or slower while it would land late or early.
      const left = b.blow - (gs.intTick - this.goTick);
      if (left <= 3) {
        this.blown = true;
        gs.setSpeed(CREDITS_RULES.speed);
      } else {
        const miss = t + (left * CREDITS_TICK_MS) / 1000 - f.blow;
        gs.setSpeed(miss > 0.012 ? SPEED_FAST : miss < -0.012 ? SPEED_SLOW : CREDITS_RULES.speed);
      }
    }
    if (t >= f.cut) this.advance();
  }

  /** The next fight's arena, or the end titles after the last. */
  private advance(): void {
    if (this.leftFight === this.fighting) return;
    this.leftFight = this.fighting;
    this.next = this.fighting + 1;
    this.gs.setSpeed(CREDITS_RULES.speed);
    if (this.next < CREDIT_BATTLES.length) this.gs.setNext(SceneId.ARENA0 + CREDIT_BATTLES[this.next].arena);
    else this.startFinale(this.clock.time);
  }

  private startFinale(t: number): void {
    this.phase = 'finale';
    this.gs.paused = true;
    const start = barTime(Math.max(nextBar(t - 0.05), 0));
    const jumpBar = Math.ceil((barAt(start) + FINALE_MIN_BARS) / 4 - 1e-6) * 4;
    const hit = barTime(SECTIONS.finalHit);
    this.finale = { start, jump: barTime(jumpBar), jumpBar, jumped: jumpBar === ENDING_BAR, hit, end: hit + END_HOLD };
  }

  private scheduleFinale(t: number): void {
    const f = this.finale!;
    if (!f.jumped) {
      if (this.clock.following) {
        // (the song's ending not loaded yet: four bars later)
        if (!this.ending || !this.track?.cutTo(this.ending, f.jump, barTime(ENDING_BAR), barTime(ENDING_BAR) - ENDING_PREROLL)) {
          if (t > f.jump - 0.06) this.postponeJump(t);
        } else {
          f.jumped = true;
        }
      } else if (t >= f.jump) {
        this.clock.jump(barTime(ENDING_BAR) + (t - f.jump));
        f.jumped = true;
      }
    }
    // (after the jump, the song's position runs from bar ENDING_BAR: the final hit, then the end)
    if (f.jumped && t >= f.end && this.clock.time >= barTime(ENDING_BAR)) this.exit(true);
  }

  private postponeJump(t: number): void {
    const f = this.finale!;
    f.jumpBar = Math.ceil((barAt(t) + 1) / 4) * 4;
    f.jump = barTime(f.jumpBar);
    if (f.jumpBar >= ENDING_BAR) f.jumped = true;
  }

  // ---- skipping and leaving ------------------------------------------------------------------------------------
  /** ENTER / A: on through the title (to its drop, then to the fights), to the next fight, or to the end titles' end. */
  skip(): void {
    const t = this.clock.time;
    this.view?.wake();
    if (this.phase === 'title') {
      const drop = barTime(SECTIONS.drop);
      if (t < drop - 0.4) {
        // (to just before the drop: the logo's strike comes at once)
        const to = drop - 0.25;
        this.track?.seek(to);
        this.clock.jump(to);
      } else {
        this.titleEnd = barTime(nextBar(t + VS_LEAD));
      }
    } else if (this.phase === 'fights' && this.fighting >= 0 && this.leftFight !== this.fighting) {
      const f = this.fights[this.fighting];
      if (f) f.cut = Math.min(f.cut, t + 0.12 + (BEAT - ((t + 0.12 - barTime(0)) % BEAT)));
      else this.advance();
    } else if (this.phase === 'finale' && this.finale) {
      const f = this.finale;
      if (!f.jumped && f.jump > t + 1) {
        f.jumpBar = Math.max(Math.ceil(barAt(t) + 0.3), Math.floor(barAt(f.start)) + 1);
        f.jump = barTime(f.jumpBar);
      } else if (f.jumped) {
        this.exit();
      }
    }
  }

  /** ESC / B, or the end: the song fades, the picture switches off, back to the main menu (EXTRAS). */
  exit(ended = false): void {
    if (this.phase === 'done' || this.leaving !== null) return;
    this.leaving = this.clock.time;
    this.unsubscribeKeys?.();
    this.unsubscribeKeys = null;
    this.track?.stop(ended ? 1.2 : 0.9);
    this.view?.leave();
    this.gs.menuReturn = 'extras';
    const done = () => {
      this.phase = 'done';
      this.view?.dispose();
      this.view = null;
      if (!this.raf) this.leave();
    };
    if (this.view) window.setTimeout(done, SWITCH_OFF * 1000);
    else done();
  }

  /** While leaving: to the menu as soon as no other scene change is under way. Returns true once back. */
  private leave(): boolean {
    const gs = this.gs;
    if (gs.thisId === SceneId.MENU && gs.nextId === SceneId.MENU) {
      // (the main menu was never left: the credits end here, EXTRAS still open)
      if (gs.credits === this) {
        gs.credits = null;
        gs.menuReturn = null;
      }
      gs.paused = false;
      if (!audio.music) gs.playMusic('MENU.PSM');
      return true;
    }
    if (gs.thisId === gs.nextId && gs.nextWaitTicks <= 0) gs.setNext(SceneId.MENU);
    return false;
  }

  /** The title or the end titles cover the whole screen (the game under them need not be drawn). */
  coversScreen(): boolean {
    const t = this.clock.time;
    if (this.phase === 'title') return t > 0.2 && t < this.titleEnd - 0.05;
    return this.phase === 'finale' && !!this.finale && t > this.finale.start + 0.5;
  }

  /** After the game drew a frame: the winner's picture for the end titles, as the fight's aftermath ends. */
  rendered(canvas: HTMLCanvasElement): void {
    const f = this.fights[this.fighting];
    if (!this.view || this.still || !f || this.phase !== 'fights' || this.clock.time < f.cut - STILL_BEFORE) return;
    this.still = true;
    const i = this.fighting;
    // The winner framed (3:2, the HUD above left out): the game's 320 x 200 picture in the canvas, as the renderer fits it.
    const W = canvas.width, H = canvas.height;
    let sy = H / 200, sx = sy * (5 / 6);
    if (320 * sx > W) {
      sx = W / 320;
      sy = sx * 1.2;
    }
    const ox = (W - 320 * sx) / 2, oy = (H - 200 * sy) / 2;
    const o = this.gs.findObject(this.gs.getPlayer(0).harObjId);
    const h = Math.min(H, 132 * sy), w = Math.min(W, h * 1.5);
    const cx = ox + (o?.posX ?? 160) * sx, bottom = oy + Math.min(200, (o?.posY ?? 190) + 8) * sy;
    const x0 = Math.max(0, Math.min(W - w, cx - w / 2)), y0 = Math.max(0, Math.min(H - h, bottom - h));
    const c = document.createElement('canvas');
    c.width = 720;
    c.height = 480;
    c.getContext('2d')?.drawImage(canvas, x0, y0, w, h, 0, 0, 720, 480);
    c.toBlob((blob) => blob && this.view?.still(i, URL.createObjectURL(blob)), 'image/jpeg', 0.88);
  }

  private frame = (): void => {
    if (this.phase === 'done') {
      this.raf = this.leave() ? 0 : requestAnimationFrame(this.frame);
      return;
    }
    this.raf = requestAnimationFrame(this.frame);
    this.clock.sync();
    const show = this.show();
    const dt = Math.max(0, Math.min(0.25, show.t - this.lastFrameT));
    this.lastFrameT = show.t;
    this.view?.update(show, dt);
  };
}
