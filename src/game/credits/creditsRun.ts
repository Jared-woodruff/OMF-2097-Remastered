// EXTRAS > CREDITS: the remaster's credits as fights (battles.ts). A title first while Hadal Static's song starts; then
// the fights one after another, each credit in its own colors, winning (the arena opens on a VS card and lingers on the
// credit's card at the end, creditsView.ts); last, the end titles. ENTER / A skips ahead, ESC / B goes back to the main
// menu. The arena asks for what it needs through GameState.credits (CreditsHooks); the cards follow the arena's state.
import { audio } from '../../audio/audio';
import { onKey } from '../../controller/input';
import { langGet } from '../../resources/resources';
import { ACT_DOWN, ACT_ESC, ACT_KICK, ACT_LEFT, ACT_PUNCH, ACT_RIGHT, ACT_UP, isArenaScene, SceneId } from '../constants';
import type { GameState } from '../gameState';
import { helpOverlayOpen } from '../gui/helpOverlay';
import { ARENA_STATE_ENDING, ARENA_STATE_STARTING } from '../objects/har';
import { CREDIT_BATTLES, CREDITS_END_TICKS, CREDITS_READY_TICK, setupCreditsBattle } from './battles';
import { openCreditsView, type CreditsView, type Song } from './creditsView';

/** What the arena asks of the credits' fights (GameState.credits while they run). */
export interface CreditsHooks {
  /** The arena opens: the fight is set up (pilots, robots, colors, the computer players, the seeds). */
  setupFight(): void;
  /** The HUD's second line under a player's name. */
  hudLine(player: number): string;
  /** The tick the round starts on (after the VS card), and the tick a won fight fades out on (after the credit's card). */
  readonly readyTick: number;
  readonly endTicks: number;
  /** The fight has faded out: the next one, or the end titles. */
  fightOver(): void;
  /** A pad's menu action: A skips ahead, B leaves, the d-pad turns the end titles (keys: see CreditsRun.key). */
  action(action: number): void;
}

/** The credits' song (the game's ending theme when it cannot be played). */
const SONG = 'audio/credits/twenty-ninety-seven-remix.mp3';
const FALLBACK_MUSIC = 'END.PSM';
/** The title's time on screen, a skip's fade to black, an end title's time and the last one's (ms). */
const INTRO_MS = 5600;
const WIPE_MS = 280;
const SLIDE_MS = 8500;
const LAST_SLIDE_MS = 9000;
/** Arena ticks: the VS card leaves a little before the round starts; the credit's card comes as the loser falls. */
const VS_LEAVES = CREDITS_READY_TICK - 6;
const CARD_COMES = 24;

type Phase = 'intro' | 'fights' | 'finale' | 'done';

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

export class CreditsRun implements CreditsHooks {
  readonly readyTick = CREDITS_READY_TICK;
  readonly endTicks = CREDITS_END_TICKS;
  phase: Phase = 'intro';
  /** The fight on screen (set up last), and the next one to set up. */
  fighting = -1;
  private next = 0;
  /** The fight the credits moved on from last (a fight ends once, whether it faded out or was skipped). */
  private leftFight = -1;
  /** Development: the end titles as soon as the first arena is open. */
  private finaleAtOnce = false;
  private view: CreditsView | null = null;
  private song: Song | null = null;
  private introLeft = INTRO_MS;
  private wipeLeft = -1;
  private slide = 0;
  private slideLeft = 0;
  /** Time the end titles have been up (ms). */
  private finaleFor = 0;
  private raf = 0;
  private last = 0;
  private unsubscribeKeys: (() => void) | null = null;
  /** When the credits opened (the key press that opened them is not theirs). */
  private openedAt = 0;

  constructor(private gs: GameState, start = 0) {
    if (start > 0) {
      this.phase = 'fights';
      this.next = Math.min(start, CREDIT_BATTLES.length) - 1;
      this.finaleAtOnce = start > CREDIT_BATTLES.length;
    }
  }

  /** The song and the view (the browser: not in tests, which run the fights headless). */
  open(links: boolean): void {
    audio.stopMusic();
    this.song = audio.playTrack(SONG, () => {
      this.song?.stop(0);
      this.song = null;
      this.view?.songFailed();
      if (this.phase !== 'done') audio.playMusic(FALLBACK_MUSIC);
    });
    if (!this.song) audio.playMusic(FALLBACK_MUSIC);
    this.view = openCreditsView({
      links,
      song: this.song,
      harName: (harId) => langGet(harId + 31),
      onNext: () => this.skip(),
      onPrevious: () => this.turn(-1),
      onExit: () => this.exit(),
    });
    if (this.phase === 'intro') this.view.intro(true);
    this.unsubscribeKeys = onKey((code, e) => this.key(code, e));
    this.openedAt = this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  /** The first fight's arena opens (under the title). */
  begin(): void {
    this.gs.setNext(SceneId.ARENA0 + CREDIT_BATTLES[this.next].arena);
  }

  // ---- CreditsHooks ------------------------------------------------------------------------------------------------
  setupFight(): void {
    const gs = this.gs;
    this.fighting = this.next;
    setupCreditsBattle(gs, CREDIT_BATTLES[this.fighting]);
    // (the fight waits under the title, the end titles or, when the credits were left meanwhile, for the menu)
    if (this.phase === 'intro' || this.phase === 'done') gs.paused = true;
    if (this.finaleAtOnce) {
      this.finaleAtOnce = false;
      this.leftFight = this.fighting;
      this.startFinale();
    }
    this.view?.wipe(false);
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
    else if (this.phase === 'finale' && action & (ACT_RIGHT | ACT_DOWN)) this.turn(1);
    else if (this.phase === 'finale' && action & (ACT_LEFT | ACT_UP)) this.turn(-1);
  }

  /** The keyboard: ENTER / SPACE skip ahead, ESC leaves, the arrows turn the end titles (not while F1 help is up). */
  private key(code: string, e: KeyboardEvent): void {
    if (e.repeat || e.altKey || helpOverlayOpen() || e.timeStamp <= this.openedAt) return;
    if (code === 'Escape') this.exit();
    else if (code === 'Enter' || code === 'NumpadEnter' || code === 'Space') this.skip();
    else if (code === 'ArrowRight' || code === 'ArrowDown' || code === 'PageDown') this.turn(1);
    else if (code === 'ArrowLeft' || code === 'ArrowUp' || code === 'PageUp') this.turn(-1);
  }

  // ---- the run -----------------------------------------------------------------------------------------------------
  /** ENTER / A: past the title, on to the next fight (under a quick fade to black), or the next end title. */
  skip(): void {
    if (this.phase === 'intro') this.endIntro();
    else if (this.phase === 'finale') this.turn(1);
    else if (this.phase === 'fights' && this.fighting >= 0 && this.leftFight !== this.fighting && this.wipeLeft < 0) {
      if (!this.view) {
        this.advance();
        return;
      }
      this.view.wipe(true);
      this.wipeLeft = WIPE_MS;
    }
  }

  private endIntro(): void {
    if (this.phase !== 'intro') return;
    this.phase = 'fights';
    this.view?.intro(false);
    if (isArenaScene(this.gs.thisId)) this.gs.paused = false;
  }

  /** The next fight's arena, or the end titles after the last. */
  private advance(): void {
    if (this.leftFight === this.fighting) return;
    this.leftFight = this.fighting;
    this.next = this.fighting + 1;
    if (this.next < CREDIT_BATTLES.length) this.gs.setNext(SceneId.ARENA0 + CREDIT_BATTLES[this.next].arena);
    else this.startFinale();
  }

  private startFinale(): void {
    this.phase = 'finale';
    this.finaleFor = 0;
    this.gs.paused = true;
    this.turnTo(0);
    this.view?.wipe(false);
  }

  /** The end titles, a slide forward or back (past the last: back to the menu). */
  private turn(dir: number): void {
    if (this.phase !== 'finale') return;
    const n = this.view?.slides ?? 1;
    if (this.slide + dir >= n) this.exit();
    else this.turnTo(Math.max(0, this.slide + dir));
  }

  private turnTo(slide: number): void {
    this.slide = slide;
    this.slideLeft = slide === (this.view?.slides ?? 1) - 1 ? LAST_SLIDE_MS : SLIDE_MS;
    this.view?.finale(slide);
  }

  /** ESC / B, or the end: back to the main menu (EXTRAS), once the fight on its way (if any) has opened. */
  exit(): void {
    if (this.phase === 'done') return;
    this.phase = 'done';
    this.unsubscribeKeys?.();
    this.unsubscribeKeys = null;
    this.song?.stop(this.slide > 0 ? 2 : 0.9);
    this.song = null;
    this.view?.dispose();
    this.view = null;
    this.gs.menuReturn = 'extras';
    if (!this.raf) this.leave();
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
      if (!audio.music) gs.playMusic('MENU.PSM');
      return true;
    }
    if (gs.thisId === gs.nextId && gs.nextWaitTicks <= 0) gs.setNext(SceneId.MENU);
    return false;
  }

  /** The title or the end titles cover the whole screen, faded in (the game under them need not be drawn). */
  coversScreen(): boolean {
    return (this.phase === 'intro' && INTRO_MS - this.introLeft > 1000) || (this.phase === 'finale' && this.finaleFor > 1000);
  }

  /** The arena on screen, for the cards (its state and ticks, and whether the fight is won). */
  private arena(): { state: number; stateTicks: number; over: number } | null {
    const gs = this.gs;
    if (!isArenaScene(gs.thisId) || this.fighting < 0) return null;
    return gs.sc as unknown as { state: number; stateTicks: number; over: number };
  }

  private frame = (now: number): void => {
    const dt = Math.min(100, now - this.last);
    this.last = now;
    if (this.phase === 'done') {
      this.raf = this.leave() ? 0 : requestAnimationFrame(this.frame);
      return;
    }
    this.raf = requestAnimationFrame(this.frame);
    const gs = this.gs;
    if (this.phase === 'intro') {
      if (isArenaScene(gs.thisId)) gs.paused = true;
      if ((this.introLeft -= dt) <= 0) this.endIntro();
    } else if (this.phase === 'finale') {
      gs.paused = true;
      this.finaleFor += dt;
      if ((this.slideLeft -= dt) <= 0) this.turn(1);
    }
    if (this.wipeLeft >= 0 && (this.wipeLeft -= dt) < 0 && this.phase === 'fights') this.advance();
    if (!this.view) return;
    // The cards follow the fight on screen: the VS card until the round starts, the credit's card once it is won.
    let vs = false;
    let won = false;
    const a = this.arena();
    if (this.phase === 'fights' && a && this.leftFight !== this.fighting) {
      if (a.state === ARENA_STATE_STARTING) vs = a.stateTicks < VS_LEAVES;
      else if (a.state === ARENA_STATE_ENDING && a.over) won = a.stateTicks >= CARD_COMES && a.stateTicks < this.endTicks + 6;
    }
    this.view.cards(this.fighting, vs, won);
    this.view.frame(dt / 1000);
  };
}
