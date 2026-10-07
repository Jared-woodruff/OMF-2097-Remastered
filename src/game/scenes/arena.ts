// Arena: the fight itself — rounds, HUD, hazards, wall slams, victory/defeat flow (port of the reference arena scene).
import type { CtrlEvent } from '../../controller/controller';
import { Animation, RSprite } from '../../resources/animation';
import { afGetMove, bkGetInfo, harName, langGet } from '../../resources/resources';
import { Tag } from '../../script/tags';
import { globalRandom } from '../../util/random';
import { paletteDarken, vga } from '../../video/vga';
import { defaultSoundOpts } from '../../audio/soundOpts';
import { Surface } from '../../video/surface';
import {
  ACT_DOWN, ACT_ESC, ACT_KICK, ACT_LEFT, ACT_PUNCH, ACT_RIGHT, ACT_UP, ANIM_DAMAGE, ANIM_DEFEAT, ANIM_SCRAP_METAL, ANIM_VICTORY, ARENA_FLOOR, ARENA_LEFT_WALL, ARENA_RIGHT_WALL, CtrlType,
  GROUP_ANNOUNCEMENT, GROUP_HAZARD, GROUP_PROJECTILE, GROUP_SCRAP, HarEventType, HarId, HarState, LAYER_HAR, LAYER_HAZARD,
  LAYER_SCRAP, MAX_ARENAS, OBJECT_FACE_LEFT, OBJECT_FACE_RIGHT, PilotId, RENDER_LAYER_BOTTOM, RENDER_LAYER_MIDDLE, RENDER_LAYER_TOP, SceneId,
} from '../constants';
import type { HarEvent } from '../../controller/controller';
import {
  emptyFightStats, FINISH_DESTRUCTION, gamePlayerGetPilot, gamePlayerSetPilot, PLUG_ENHANCEMENT, PLUG_FORFEIT, PLUG_KICK_OUT,
  PLUG_LOSE, PLUG_SOLD_UPGRADE, PLUG_WARNING, PLUG_WIN, PLUG_WIN_BIG, PLUG_WIN_OK, registerScene, type GameState,
} from '../gameState';
import { sgSave } from '../../resources/sgmanager';
import { pilotExitTournament } from '../tournament/chr';
import { calculateTradeValue, calculateWinnings, sellHighestValueUpgrade } from './mechlab/harEconomy';
import { GameObject } from '../object';
import { emitFx, FxType } from '../fx';
import { hazardCreate } from '../objects/hazard';
import {
  ARENA_STATE_ENDING, ARENA_STATE_FIGHTING, ARENA_STATE_STARTING, harCreate, harData, harFaceEnemy, harHealthPercent,
  harInstallHook, harReset, harSetAni, type ArenaLike,
} from '../objects/har';
import { scrapCreate } from '../objects/scrap';
import { paletteLoadPlayerColors } from '../pilotColors';
import { Scene } from '../scene';
import { settings } from '../settings';
import { ProgressBar, PROGRESSBAR_LEFT, PROGRESSBAR_RIGHT, THEME_ENDURANCE, THEME_HEALTH } from '../gui/progressbar';
import { HAlign, hudText, type Text } from '../gui/text';
import { DummyController, DUMMY_MODE_NAMES, DummyMode } from '../../controller/dummy';
import { ArenaPauseMenu } from '../gui/pauseMenu';
import { InputDisplay } from '../gui/inputDisplay';
import type { Af } from '../../resources/resources';
import { arenaScreengrabWinner, harScreencapsCompress, harScreencapsReset, SCREENCAP_BLOW, SCREENCAP_POSE } from '../harScreencap';
import { arenaBase, arenaMusic, nextArena, pilotWinBit } from '../roster';
import { modArena } from '../../mods/registry';
import { recSerialize } from '../../formats/rec';
import { Recorder } from '../replay/recorder';
import { ReplayHud } from '../replay/hud';
import { storeFight, type ReplayMeta } from '../replay/store';
import { workshopDesign } from '../workshop/registry';
import { app } from '../../app';
import type { PointerKind } from '../../controller/mouse';
import { TrainingLab } from '../training/session';
import { winLine } from '../../audio/announcer';
import { recordFight } from '../records/records';
import { formatMs } from '../modes/run';
import { AiController } from '../../controller/ai';
import { leaveNetGame } from '../../net/netplay';

const HAR1_START_POS = 110;
const HAR2_START_POS = 210;
const ARENA_CROSSFADE_TICKS = 30;
const WALL_SLAM_TOLERANCE_DEFAULT = 7;
const WALL_SLAM_TOLERANCE_POWERPLANT = 5;
/** A sound translation table that plays nothing. */
const SILENT_TABLE = new Uint8Array(32);

const enum WinState {
  NONE = 0,
  YOULOSE,
  YOUWIN,
  DONE,
}

export class ArenaScene extends Scene implements ArenaLike {
  state = ARENA_STATE_STARTING;
  stateTicks = 0;
  healthBars: ProgressBar[] = [];
  enduranceBars: ProgressBar[] = [];
  playerName: Text[] = [];
  playerHar: Text[] = [];
  round = 0;
  rounds = 1;
  over = 0;
  /** A round's end is still playing out: a finishing move or the score going on (the credits' cards wait for it). */
  finishing = false;
  winner = 0;
  /** The fight was given up (the pause menu's QUIT). */
  private quitting = false;
  /** Player 1's health at the start in percent, when less than full (survival). */
  private startHealth: number | undefined;
  tournament = false;
  winState = WinState.NONE;
  playerRounds: number[][] = [[0, 0, 0, 0], [0, 0, 0, 0]];
  reinEnabled = false;
  menuVisible = false;
  pauseMenu: ArenaPauseMenu;
  /** arenaEnd() already ran (see the note there). */
  private ended = false;
  /** Training mode (see menuTraining.ts): per player, health seen last tick, tick of the last damage, damage stats. */
  readonly training: boolean;
  private trnHealth = [0, 0];
  private trnHitTick = [-1000, -1000];
  private trnLastHit = [0, 0];
  private trnCombo = [0, 0];
  private trnReeling = [false, false];
  private trnText: Text | null = null;
  /** Training: player 1's recent inputs. */
  private inputDisplay: InputDisplay | null = null;
  /** Training: frame data, hitboxes, recording the dummy, reversals (see training/session.ts). */
  lab: TrainingLab | null = null;
  /** Game time fought (arcade, survival, time attack) and the run's line under the scores. */
  private runMs = 0;
  private runText: Text | null = null;
  /** Hits of each player's combo under way, and their longest combo (the records). */
  private comboHits = [0, 0];
  private bestCombo = [0, 0];
  /** The fight's recording (saved as a replay when the fight is over). */
  private recorder: Recorder | null = null;
  /** Watching a replay: its controls. */
  private replayHud: ReplayHud | null = null;

  constructor(gs: GameState, id: SceneId) {
    super(gs, id);
    // The credits' fights are set up as their arena opens (the same fight every time).
    gs.credits?.setupFight();
    // A network game's fight starts from the same random seed in both games.
    if (gs.net) gs.rand.setSeed(gs.net.fightSeed());
    this.training = gs.training;
    const bk = this.bk;
    // memset(fight_stats, 0): this also clears a pending tournament challenger
    gs.fightStats = emptyFightStats();
    gs.fightStats.arena = id - SceneId.ARENA0;
    const music: Record<number, string> = { 8: 'ARENA0.PSM', 16: 'ARENA1.PSM', 32: 'ARENA2.PSM', 64: 'ARENA3.PSM', 128: 'ARENA4.PSM' };
    // (a mod arena names its song; the credits play theirs)
    const track = arenaMusic(gs.fightStats.arena) ?? music[bk.fileId];
    if (track && !gs.credits) gs.playMusic(track);
    this.rounds = [1, 3, 5, 7][gs.matchSettings.rounds] ?? 1;
    let palIndex = 0;
    // A replay uses the recorded palette (the desert's time of day in tournaments).
    if (gs.replay) palIndex = gs.replay.rec.arenaPalette;
    else if (bk.fileId === 128 && gs.isTournament()) palIndex = globalRandom.int(bk.palettes.length);
    if (palIndex > 0 && palIndex < bk.palettes.length) vga.setBasePaletteRange(bk.palettes[palIndex], 0x60, 0x60, 0x40);

    const pos = [HAR1_START_POS, HAR2_START_POS];
    const dir = [OBJECT_FACE_RIGHT, OBJECT_FACE_LEFT];
    for (let i = 0; i < 2; i++) {
      const player = gs.getPlayer(i);
      if (i === 0 && (player.chr || gs.replay?.tournament)) {
        this.rounds = 1;
        this.tournament = true;
      }
      paletteLoadPlayerColors(player.pilot.palette, i);
      const af = this.loadHar(i);
      const obj = new GameObject(gs, pos[i], ARENA_FLOOR);
      harCreate(obj, af, dir[i], player.pilot.harId, player.pilot.pilotId, i);
      if (bk.fileId === 8) obj.addAnimationEffects(0x4 /* EFFECT_POSITIONAL_LIGHTING */);
      gs.addObject(obj, RENDER_LAYER_MIDDLE, false, false);
      player.harObjId = obj.id;
      player.ctrl.harObjId = obj.id;
      if (player.pilot.photo) {
        const x = i === 0 ? 107 : 213;
        const portrait = new GameObject(gs, x, 5);
        const surf = new Surface(player.pilot.photo.width, player.pilot.photo.height, player.pilot.photo.pixels(), 0);
        surf.source = { kind: 'photo', key: `photo/${player.pilot.photoId}` };
        const sp = new RSprite(-1, player.pilot.photo.posX, player.pilot.photo.posY, surf);
        portrait.xPercent = 0.7;
        portrait.yPercent = 0.7;
        portrait.setSpriteOverride(true);
        portrait.setAnimation(Animation.fromSingle(sp, i === 0 ? 105 : 213, 0));
        if (i === 1) portrait.direction = OBJECT_FACE_LEFT;
        portrait.curSpriteId = 0;
        portrait.hudLayer = true;
        gs.addObject(portrait, RENDER_LAYER_TOP, false, false);
      } else {
        const tokenInfo = bkGetInfo(bk, 27);
        for (let j = 0; j < 4; j++) {
          if (j < Math.ceil(this.rounds / 2) && tokenInfo) {
            const xoff = i === 1 ? 210 - 9 * j - 3 - j : 110 + 9 * j + 3 + j;
            const token = new GameObject(gs, xoff, 9);
            this.playerRounds[i][j] = token.id;
            token.setAnimation(tokenInfo.ani);
            token.selectSprite(1);
            token.setSpriteOverride(true);
            token.hudLayer = true;
            gs.addObject(token, RENDER_LAYER_TOP, false, false);
          } else {
            this.playerRounds[i][j] = 0;
          }
        }
      }
    }
    const p0 = gs.getPlayer(0), p1 = gs.getPlayer(1);
    p0.ctrl.setRepeat(1);
    p1.ctrl.setRepeat(1);
    const h0 = gs.findObject(p0.harObjId)!, h1 = gs.findObject(p1.harObjId)!;
    h0.animationState.enemyObjId = p1.harObjId;
    h1.animationState.enemyObjId = p0.harObjId;
    harInstallHook(harData(h0), (e) => this.harHook(e));
    harInstallHook(harData(h1), (e) => this.harHook(e));
    for (let i = 0; i < 2; i++) {
      const p = gs.getPlayer(i);
      this.playerName.push(hudText(p.pilot.name, 0xe7, 0xf8, 155, 5));
      this.playerHar.push(hudText(gs.credits?.hudLine(i) ?? harName(p.pilot.harId), 0xe7, 0xf8, 155, 5));
    }
    this.playerName[1].setHAlign(HAlign.RIGHT);
    this.playerHar[1].setHAlign(HAlign.RIGHT);

    this.healthBars = [new ProgressBar(THEME_HEALTH, PROGRESSBAR_RIGHT, 100), new ProgressBar(THEME_HEALTH, PROGRESSBAR_LEFT, 100)];
    this.healthBars[0].layout(4, 4, 100, 8);
    this.healthBars[1].layout(216, 4, 100, 8);
    for (const b of this.healthBars) {
      b.damageTrail = true;
      b.warnBelow = 25;
    }
    this.enduranceBars = [new ProgressBar(THEME_ENDURANCE, PROGRESSBAR_RIGHT, 100), new ProgressBar(THEME_ENDURANCE, PROGRESSBAR_LEFT, 100)];
    this.enduranceBars[0].layout(4, 13, 100, 4);
    this.enduranceBars[1].layout(216, 13, 100, 4);
    p0.score.setPos(4, 32, OBJECT_FACE_RIGHT);
    p1.score.setPos(316, 32, OBJECT_FACE_LEFT);
    p0.score.setTournamentMode(this.tournament);
    p1.score.setTournamentMode(this.tournament);
    p0.score.reset(gs.isTournament());
    p1.score.reset(true);
    if (gs.isSingleplayer()) {
      p0.score.resetWins();
      p1.score.resetWins();
    }
    harScreencapsReset(p0.screencaps);
    harScreencapsReset(p1.screencaps);
    bk.soundTranslationTable[14] = 10;
    bk.soundTranslationTable[15] = 16;
    bk.soundTranslationTable[3] = 23 + this.round;
    if (arenaBase(id - SceneId.ARENA0) === 3) bk.soundTranslationTable[20] = 0;
    this.pauseMenu = new ArenaPauseMenu(gs, this);
    if (this.training) {
      this.inputDisplay = new InputDisplay();
      this.trnText = hudText('', 0xe7, 0xf8, 320, 6).setHAlign(HAlign.CENTER);
      for (let i = 0; i < 2; i++) this.trnHealth[i] = harData(this.harObj(i)).health;
      this.lab = new TrainingLab(gs, {
        harObj: (i) => this.harObj(i),
        resetTrainingPositions: () => this.resetTrainingPositions(),
        setTrainingDummy: (m) => this.setTrainingDummy(m),
        trainingDummy: () => this.trainingDummy(),
      });
    }
    // Survival: player 1 starts with the health left from the fight before (a replay of such a fight, as recorded).
    const run = gs.modeRun;
    if (run) this.runText = hudText('', 0xe7, 0xf8, 320, 6).setHAlign(HAlign.CENTER);
    const startHealth = gs.replay ? gs.replay.record.meta.startHealth : run?.kind === 'survival' ? run.health : undefined;
    if (startHealth !== undefined && startHealth < 100) {
      const h = harData(this.harObj(0));
      h.health = Math.max(1, (h.healthMax * startHealth) / 100);
      this.startHealth = startHealth;
    }
    // Last, like the reference (arena_create records the random seed when the fight is ready).
    if (gs.replay) this.replayHud = new ReplayHud(gs.replay);
    // (OMF Studio's test fights are not the player's: no replay, no records)
    else if (!this.training && !gs.isDemoplay() && !gs.modTest && settings().gameplay.saveReplays) this.recorder = new Recorder(gs, id - SceneId.ARENA0, palIndex);
  }

  // ---- ArenaLike ---------------------------------------------------------------
  arenaGetState(): number {
    return this.state;
  }
  arenaIsOver(): number {
    return this.over ? this.winner : -1;
  }
  arenaSetState(s: number): void {
    this.state = s;
  }

  override startup(id: number): [boolean, boolean] {
    if (this.bk.fileId === 64 && id >= 1 && id <= 4) return [true, true];
    // (a mod arena's own looping animations)
    if (modArena(this.id - SceneId.ARENA0)?.info.loops.includes(id)) return [true, true];
    return [false, false];
  }

  wallSlamTolerance(): number {
    if (this.gs.matchSettings.hazards && arenaBase(this.gs.thisId - SceneId.ARENA0) === 2) return WALL_SLAM_TOLERANCE_POWERPLANT;
    return WALL_SLAM_TOLERANCE_DEFAULT;
  }

  private harObj(i: number): GameObject {
    return this.gs.findObject(this.gs.getPlayer(i).harObjId)!;
  }

  // ---- announcements ------------------------------------------------------------
  private addAnnouncement(animId: number, layer: number, onFinish?: (o: GameObject) => void): GameObject | null {
    const info = bkGetInfo(this.bk, animId);
    if (!info) return null;
    const obj = new GameObject(this.gs, info.ani.startX, info.ani.startY);
    // The announcements (READY, ROUND, the number, FIGHT, YOU WIN, YOU LOSE) each say their word in the original game's
    // voice; while the remaster's announcer speaks, they are silent (the two would talk over each other).
    obj.soundTranslationTable = settings().sound.announcer === 'off' ? this.bk.soundTranslationTable : SILENT_TABLE;
    obj.setAnimation(info.ani);
    if (onFinish) obj.onFinish = onFinish;
    obj.hudLayer = true;
    this.gs.addObject(obj, layer, false, false);
    return obj;
  }

  private createRoundstartAnim(): void {
    const readyDone = (parent: GameObject) => {
      this.tickTimer.add(10, () => {
        this.addAnnouncement(10, RENDER_LAYER_TOP);
        this.gs.announce('fight');
      });
      parent.setFinished(true);
    };
    // The announcer: the round (the last possible one is the final round), or the arcade's last fight.
    const run = this.gs.modeRun;
    if (run?.kind === 'arcade' && run.total !== null && run.fight === run.total && this.round === 0) this.gs.announce('finalfight');
    else if (this.rounds === 1) this.gs.announce('ready');
    else this.gs.announce(this.round === this.rounds - 1 ? 'final' : `round${this.round + 1}`);
    if (this.rounds === 1) {
      const o = this.addAnnouncement(11, RENDER_LAYER_TOP, readyDone);
      if (o) o.group = GROUP_ANNOUNCEMENT;
    } else {
      const o = this.addAnnouncement(6, RENDER_LAYER_TOP, readyDone);
      if (o) o.group = GROUP_ANNOUNCEMENT;
      const n = this.addAnnouncement(7, RENDER_LAYER_TOP);
      if (n) {
        n.selectSprite(this.round);
        n.setSpriteOverride(true);
        n.group = GROUP_ANNOUNCEMENT;
      }
    }
  }

  /** The announcer after a round: "you win" / "you lose" against the computer, else the winning robot. */
  private announceWinner(): void {
    const gs = this.gs;
    const winnerId = gs.fightStats.winner;
    const vsCpu = gs.getPlayer(0).ctrl.type !== CtrlType.AI && gs.getPlayer(1).ctrl.type === CtrlType.AI;
    if (vsCpu) gs.announce(winnerId === 0 ? 'youwin' : 'youlose');
    else gs.announce(winLine(gs.getPlayer(winnerId).pilot.harId));
  }

  private youWinStart(): void {
    this.announceWinner();
    this.addAnnouncement(9, RENDER_LAYER_MIDDLE, (p) => {
      p.setFinished(true);
      this.winState = WinState.DONE;
    });
  }

  private youLoseStart(): void {
    this.announceWinner();
    this.addAnnouncement(8, RENDER_LAYER_MIDDLE, (p) => {
      p.setFinished(true);
      this.winState = WinState.DONE;
    });
  }

  // ---- round flow -------------------------------------------------------------------
  arenaReset(): void {
    const gs = this.gs;
    this.state = ARENA_STATE_STARTING;
    this.stateTicks = 0;
    gs.clearObjects(GROUP_PROJECTILE | GROUP_HAZARD | GROUP_SCRAP | GROUP_ANNOUNCEMENT);
    const pos = [HAR1_START_POS, HAR2_START_POS];
    const dir = [OBJECT_FACE_RIGHT, OBJECT_FACE_LEFT];
    for (let i = 0; i < 2; i++) {
      const player = gs.getPlayer(i);
      const obj = this.harObj(i);
      harReset(obj);
      obj.setPos(pos[i], ARENA_FLOOR);
      obj.setVel(0, 0);
      obj.direction = dir[i];
      player.score.clearDone();
    }
    this.tickTimer.clear();
    this.bk.soundTranslationTable[14] = 10;
    this.bk.soundTranslationTable[15] = 16;
    this.bk.soundTranslationTable[3] = 23 + this.round;
    if (this.bk.fileId === 128 && this.round < this.bk.palettes.length) {
      vga.setBasePaletteRange(this.bk.palettes[this.round], 0x60, 0x60, 0x40);
    }
  }

  /**
   * arena_end(): records the result. In tournament mode: ranks (secret pilots do not move ranks), repair costs,
   * winnings, money and Plug's comment (debts sell upgrades, then get the pilot kicked out), then the character is
   * saved. The same statistics/comment code also runs in single player and demo games (RNG order).
   */
  private arenaEnd(): void {
    // Deviation: the ENDING state calls arena_end on every dynamic tick until the next static tick swaps the scene.
    // At normal speed that is once, but at high game speeds (or warp speed) several dynamic ticks can run in between
    // and the reference then counts the result (wins, money, rank) several times. It runs once here.
    if (this.ended) return;
    this.ended = true;
    const gs = this.gs;
    // A replay stops at the end of the fight (no results, no next screen).
    if (gs.replay) {
      gs.replay.finish();
      return;
    }
    // The credits go on to their next fight (or their end titles).
    if (gs.credits) {
      gs.credits.fightOver();
      return;
    }
    const fs = gs.fightStats;
    const f32 = Math.fround;
    const winnerId = this.winner;
    const loserId = winnerId ? 0 : 1;
    const playerWinner = gs.getPlayer(winnerId);
    const playerLoser = gs.getPlayer(loserId);
    // (two player games clear the names below: the victory screen still names the winner)
    const winnerName = playerWinner.pilot.name;
    const winnerHar = harData(this.harObj(winnerId));
    fs.hp = winnerHar.health;
    fs.maxHp = winnerHar.healthMax;
    this.recordResult();
    // Arcade, survival, time attack: the run goes on (or ends) instead of the one player game's news.
    if (gs.modeRun) {
      const p1 = harData(this.harObj(0));
      gs.modeRun.fightOver(gs, winnerId === 0, this.runMs, Math.round((Math.max(0, p1.health) / p1.healthMax) * 100), this.quitting);
      this.victoryScreen();
      return;
    }

    if (gs.isTournament() && this.winner === 0) {
      // tournament player won
      const winnerPilot = playerWinner.pilot;
      const loserPilot = gamePlayerGetPilot(playerLoser)!;
      const chr = playerWinner.chr!;
      // secret players have no rank, and don't increase your own ranking
      if (!gs.matchSettings.sim && loserPilot.rank > 0) {
        winnerPilot.rank = (winnerPilot.rank - 1) & 0xff; // uint8_t
        if (winnerPilot.rank < 1) winnerPilot.rank = 1;
        for (let i = 0; i < chr.pilot.enemiesIncUnranked; i++) {
          if (chr.enemies[i].pilot.rank === winnerPilot.rank) {
            chr.enemies[i].pilot.rank += 1;
            break;
          }
        }
      }
      // (reference TODO: the repair costs formula here is completely bogus)
      const tradeValue = Math.trunc(calculateTradeValue(winnerPilot) / 100);
      const hpPercentage = f32(f32(winnerHar.health) / f32(winnerHar.healthMax));
      fs.repairCost = Math.trunc(f32(f32(1.0 - hpPercentage) * tradeValue));
      fs.winnings = Math.trunc(calculateWinnings(winnerPilot, loserPilot, chr.winningsMultiplier));
    } else if (gs.isTournament() && this.winner === 1) {
      // tournament player lost
      const loserPilot = playerLoser.pilot;
      const winnerPilot = gamePlayerGetPilot(playerWinner)!;
      const chr = playerLoser.chr!;
      // secret players have no rank, and don't decrease your own ranking
      if (loserPilot.rank <= loserPilot.enemiesExUnranked && !gs.matchSettings.sim && winnerPilot.rank > 0) {
        loserPilot.rank = (loserPilot.rank + 1) & 0xff;
        if (loserPilot.rank > chr.pilot.enemiesExUnranked + 1) loserPilot.rank = chr.pilot.enemiesExUnranked + 1;
        for (let i = 0; i < chr.pilot.enemiesIncUnranked; i++) {
          if (chr.enemies[i].pilot.rank === loserPilot.rank) {
            chr.enemies[i].pilot.rank -= 1;
            break;
          }
        }
      }
      fs.repairCost = Math.trunc(calculateTradeValue(loserPilot) / 100);
    }

    if (!gs.matchSettings.sim) {
      playerWinner.score.wins++;
      playerWinner.pilot.wins++;
      playerLoser.pilot.losses++;
    }

    // Switch scene
    if (gs.isSingleplayer() || gs.isTournament() || gs.isDemoplay()) {
      const p1 = gs.getPlayer(0);
      const p2 = gs.getPlayer(1);
      const p1Har = harData(this.harObj(0));
      const p2Har = harData(this.harObj(1));

      // Convert screen captures to grayscale
      const caps = (fs.winner === 0 ? p1 : p2).screencaps;
      harScreencapsCompress(caps, this.bk.palettes[0], SCREENCAP_BLOW);
      harScreencapsCompress(caps, this.bk.palettes[0], SCREENCAP_POSE);

      // Set the fight statistics and Plug McEllis's complaints
      fs.bonuses = Math.trunc(p1.score.score / 1000);
      fs.profit = fs.bonuses + fs.winnings - fs.repairCost;
      const warningGiven = p1.pilot.money < 0;

      if (!gs.matchSettings.sim) p1.pilot.money = (p1.pilot.money + fs.profit) | 0;
      if (fs.hitsLanded[0] !== 0) fs.averageDamage[0] = f32(f32(p2Har.healthMax - p2Har.health) / f32(fs.hitsLanded[0]));
      if (fs.totalAttacks[0] !== 0) fs.hitMissRatio[0] = Math.trunc((100 * fs.hitsLanded[0]) / fs.totalAttacks[0]);
      if (fs.hitsLanded[1] !== 0) fs.averageDamage[1] = f32(f32(p1Har.healthMax - p1Har.health) / f32(fs.hitsLanded[1]));
      if (fs.totalAttacks[1] !== 0) fs.hitMissRatio[1] = Math.trunc((100 * fs.hitsLanded[1]) / fs.totalAttacks[1]);
      // Quirk kept: fight_stats.winner (set by the defeat) is 0 after a forfeit, so a forfeit gets a "win" comment.
      if (fs.winner === 0) {
        const hpLeftPercent = harHealthPercent(p1Har);
        const p1Pilot = p1.pilot;
        const p2Pilot = gamePlayerGetPilot(p2)!;
        const har = p1Pilot.harId;
        // check if this is an unranked challenger with an enhancement we don't have
        if (p2Pilot.rank === 0 && fs.finish === FINISH_DESTRUCTION && p2Pilot.enhancements[har] === p1Pilot.enhancements[har] + 1) {
          p1Pilot.enhancements[har] = p2Pilot.enhancements[har];
          fs.plugText = PLUG_ENHANCEMENT;
        } else if (hpLeftPercent >= 70) {
          fs.plugText = PLUG_WIN_BIG + globalRandom.int(3);
        } else if (hpLeftPercent >= 30) {
          fs.plugText = PLUG_WIN_OK + globalRandom.int(3);
        } else {
          fs.plugText = PLUG_WIN + globalRandom.int(3);
        }
      } else {
        const sold = p1.pilot.money < 0 ? sellHighestValueUpgrade(p1.pilot) : null;
        if (sold !== null) {
          fs.sold = sold;
          fs.plugText = PLUG_SOLD_UPGRADE;
        } else if (warningGiven && p1.pilot.money < 0) {
          fs.plugText = PLUG_KICK_OUT;
          p1.pilot.money = 0;
          pilotExitTournament(p1.pilot);
        } else if (p1.pilot.money < 0) {
          fs.plugText = PLUG_WARNING;
        } else {
          fs.plugText = PLUG_LOSE + globalRandom.int(5);
        }
      }

      if (p1.chr && !sgSave(p1.chr)) console.error(`Failed to save pilot ${p1.chr.pilot.name}`);
      if (gs.isDemoplay()) {
        gs.setNext(SceneId.VS);
      } else if (gs.matchSettings.sim) {
        gamePlayerSetPilot(p2, null);
        gs.setNext(SceneId.MECHLAB);
      } else {
        gs.setNext(SceneId.NEWSROOM);
      }
    } else {
      playerWinner.pilot.name = '';
      playerLoser.pilot.name = '';
      gs.setNext(SceneId.MELEE);
    }

    if (gs.isSingleplayer() && winnerId === 0) {
      // cycle the maps in singleplayer
      gs.arena = nextArena(gs.arena);
    }
    this.victoryScreen(winnerName);
  }

  /** The victory screen (scenes/victory.ts) comes first, then what was set to come next. */
  private victoryScreen(winnerName?: string): void {
    const gs = this.gs;
    if (!settings().gameplay.victoryScreens || gs.isTournament() || gs.isDemoplay() || this.training || this.quitting) return;
    if (gs.getPlayer(0).ctrl.type === CtrlType.AI && gs.getPlayer(1).ctrl.type === CtrlType.AI) return;
    if (gs.nextId === gs.thisId || gs.nextId === SceneId.VICTORY) return;
    const w = Math.max(0, this.winner), fs = gs.fightStats;
    const winnerHar = harData(this.harObj(w));
    gs.victoryStats = {
      rounds: [gs.getPlayer(w).score.rounds, gs.getPlayer(1 - w).score.rounds],
      hits: fs.hitsLanded[w],
      accuracy: fs.totalAttacks[w] ? Math.round((100 * fs.hitsLanded[w]) / fs.totalAttacks[w]) : 0,
      bestCombo: Math.max(this.bestCombo[w], this.comboHits[w]),
      seconds: Math.round((gs.tick * gs.msPerDyntick()) / 1000),
      perfect: winnerHar.health >= winnerHar.healthMax,
      finish: fs.finish,
      name: winnerName ?? gs.getPlayer(w).pilot.name,
    };
    gs.victoryNext = gs.nextId;
    gs.nextId = SceneId.VICTORY;
  }

  /** game_menu_quit(): quit (or forfeit a tournament fight: Plug then calls you a chicken on the VS screen). */
  quitFight(): void {
    const gs = this.gs;
    if (this.training) {
      gs.setNext(SceneId.MENU);
      return;
    }
    // A network game is left (the other player is told, and both go back to the menu).
    if (gs.net) {
      leaveNetGame(gs);
      return;
    }
    this.winner = 1;
    gs.fightStats.plugText = PLUG_FORFEIT;
    gs.getPlayer(0).score.reset(true);
    gs.getPlayer(1).score.reset(true);

    const player1 = gs.getPlayer(0);
    if (player1.chr) {
      // quit back to VS for plug to call you a chicken
      if (gs.matchSettings.sim) gs.setNext(SceneId.MECHLAB);
      else gs.setNext(SceneId.VS);
    } else {
      gs.setNext(SceneId.MENU);
    }

    // (a fight given up has no victory screen: it would credit the player who quit; fightStats.winner stays as the
    // reference leaves it, for Plug's comment)
    this.quitting = true;
    this.arenaEnd();

    if (player1.chr) gamePlayerSetPilot(gs.getPlayer(1), null);
  }

  // ---- training mode -----------------------------------------------------------------

  /** The training dummy's current behavior. */
  trainingDummy(): DummyMode {
    const ctrl = this.gs.getPlayer(1).ctrl;
    return ctrl instanceof DummyController ? ctrl.mode : DummyMode.CPU;
  }

  /** Changes what the training dummy does (from the pause menu). */
  setTrainingDummy(mode: DummyMode): void {
    const gs = this.gs;
    const player = gs.getPlayer(1);
    const ctrl = player.ctrl;
    if (mode === DummyMode.CPU) {
      if (!(ctrl instanceof DummyController)) return;
      gs.setupAi(1);
    } else if (ctrl instanceof DummyController) {
      ctrl.mode = mode;
      return;
    } else {
      player.setCtrl(new DummyController(gs, mode));
    }
    player.ctrl.harObjId = player.harObjId;
    player.ctrl.setRepeat(1);
    this.lab?.configureDummy();
  }

  /** Puts both robots back at their start positions with full health. */
  resetTrainingPositions(): void {
    const gs = this.gs;
    gs.clearObjects(GROUP_PROJECTILE | GROUP_SCRAP);
    const pos = [HAR1_START_POS, HAR2_START_POS];
    const dir = [OBJECT_FACE_RIGHT, OBJECT_FACE_LEFT];
    for (let i = 0; i < 2; i++) {
      const obj = this.harObj(i);
      harReset(obj);
      obj.setPos(pos[i], ARENA_FLOOR);
      obj.setVel(0, 0);
      obj.direction = dir[i];
      const h = harData(obj);
      h.health = h.healthMax;
      h.endurance = 0;
      this.trnHealth[i] = h.health;
      this.trnHitTick[i] = -1000;
    }
  }

  /** Training: damage readout, and health/stun refill once a robot is back on its feet after a combo. */
  private trainingTick(objs: GameObject[]): void {
    const tick = this.gs.tick;
    for (let i = 0; i < 2; i++) {
      const h = harData(objs[i]);
      const recovering = h.state === HarState.RECOIL || h.state === HarState.STUNNED || h.state === HarState.STANDING_UP ||
        h.state === HarState.WALLDAMAGE || objs[i].isAirborne();
      if (h.health < this.trnHealth[i]) {
        // A combo: hits landing while the robot is still reeling from the previous one.
        const dmg = this.trnHealth[i] - h.health;
        this.trnCombo[i] = (this.trnReeling[i] ? this.trnCombo[i] : 0) + dmg;
        this.trnLastHit[i] = dmg;
        this.trnHitTick[i] = tick;
      }
      this.trnReeling[i] = recovering || h.state === HarState.BLOCKSTUN;
      if (tick - this.trnHitTick[i] > 70 && !recovering && (h.health < h.healthMax || h.endurance > 0)) {
        h.health = h.healthMax;
        h.endurance = 0;
      }
      this.trnHealth[i] = h.health;
    }
    const d = this.trnLastHit[1];
    const mode = DUMMY_MODE_NAMES[this.trainingDummy()] ?? '';
    this.trnText?.set(`DUMMY: ${mode}    LAST HIT: ${d}    COMBO: ${this.trnCombo[1]}`);
    this.lab?.tick(objs);
  }

  // ---- HAR event hooks ------------------------------------------------------------
  private harHook(event: HarEvent): void {
    this.lab?.onHarEvent(event);
    // Combos, as the game counts them: hits until the victim recovers.
    if (event.type === HarEventType.LAND_HIT) this.comboHits[event.playerId]++;
    if (event.type === HarEventType.RECOVER) {
      const a = event.playerId ? 0 : 1;
      this.bestCombo[a] = Math.max(this.bestCombo[a], this.comboHits[a]);
      this.comboHits[a] = 0;
    }
    const gs = this.gs;
    const fs = gs.fightStats;
    const score = gs.getPlayer(event.playerId).score;
    const obj = this.harObj(event.playerId);
    const har = harData(obj);
    switch (event.type) {
      case HarEventType.TAKE_HIT:
      case HarEventType.TAKE_HIT_PROJECTILE:
        this.takeHitHook(event.playerId, event.move!);
        break;
      case HarEventType.HIT_WALL:
        this.hitWallHook(event.playerId, event.wall ?? 0);
        break;
      case HarEventType.ATTACK:
        fs.totalAttacks[event.playerId]++;
        if (obj.isAirborne()) har.airAttacked = 1;
        break;
      case HarEventType.AIR_ATTACK_DONE:
        har.airAttacked = 0;
        break;
      case HarEventType.RECOVER: {
        const other = gs.getPlayer(event.playerId ? 0 : 1);
        const oh = this.harObj(event.playerId ? 0 : 1);
        other.score.endCombo(oh.px());
        break;
      }
      case HarEventType.DEFEAT:
        if (this.state !== ARENA_STATE_ENDING) {
          this.state = ARENA_STATE_ENDING;
          this.stateTicks = 0;
          this.defeatHook(event.playerId);
        }
        break;
      case HarEventType.SCRAP:
        fs.finish = 1;
        score.setScrap();
        gs.announce('scrap');
        break;
      case HarEventType.DESTRUCTION:
        fs.finish = 2;
        score.setDestruction();
        gs.announce('destruction');
        break;
      case HarEventType.DONE:
        score.setDone();
        break;
    }
  }

  private takeHitHook(hittee: number, move: { points: number }): void {
    const gs = this.gs;
    const fs = gs.fightStats;
    const hitter = hittee ? 0 : 1;
    fs.hitsLanded[hitter]++;
    if (fs.hitsLanded[hitter] > fs.totalAttacks[hitter]) fs.totalAttacks[hitter] = fs.hitsLanded[hitter];
    const score = gs.getPlayer(hitter).score;
    const other = gs.getPlayer(hittee).score;
    const hitHar = this.harObj(hittee);
    if (move.points !== 0) {
      const hide = !gs.getPlayer(hitter).selectable;
      score.hit(hide ? 0 : move.points);
    }
    other.interrupt(hitHar.px());
  }

  private canWallslam(playerId: number): boolean {
    const o = this.harObj(playerId);
    const h = harData(o);
    const o2 = this.harObj(playerId ? 0 : 1);
    if (o2.frameIsSet(Tag.CW)) return true;
    if (h.isGrabbed) return false;
    if (o.posY >= ARENA_FLOOR - 10) return false;
    return true;
  }

  private hitWallHook(playerId: number, wall: number): void {
    const gs = this.gs;
    const o = this.harObj(playerId);
    const h = harData(o);
    const o2 = this.harObj(playerId ? 0 : 1);
    if (!this.canWallslam(playerId)) return;
    let absVel = Math.abs(o.velX) / o.horizontalVelocityModifier;
    if (o2.frameIsSet(Tag.CW)) absVel = 7;
    if (absVel <= 2) return;
    const tolerance = this.wallSlamTolerance();
    if (absVel + 0.5 > tolerance && (h.state === HarState.RECOIL || h.state === HarState.DEFEAT)) {
      h.state = HarState.WALLDAMAGE;
      if (o.posY === ARENA_FLOOR) o.posY -= 10;
      let info = bkGetInfo(this.bk, 20 + wall);
      if (info) {
        const obj = new GameObject(gs, info.ani.startX, info.ani.startY);
        obj.soundTranslationTable = this.bk.soundTranslationTable;
        obj.setAnimation(info.ani);
        obj.playerInitSpawned();
        gs.addObject(obj, RENDER_LAYER_BOTTOM, true, false);
      }
      info = bkGetInfo(this.bk, 22);
      if (info) {
        const obj2 = new GameObject(gs, o.px(), o.py());
        obj2.soundTranslationTable = this.bk.soundTranslationTable;
        obj2.setAnimation(info.ani);
        obj2.attachTo(o);
        obj2.playerInitSpawned();
        gs.addObject(obj2, RENDER_LAYER_TOP, false, false);
      }
      const amount = globalRandom.int(2) + 3;
      for (let i = 0; i < amount; i++) {
        const variance = globalRandom.int(20) - 10;
        const animNo = globalRandom.int(2) + 24;
        const py = o.py() - o.size()[1] + variance + i * 25;
        const dinfo = bkGetInfo(this.bk, animNo);
        if (!dinfo) continue;
        const dust = new GameObject(gs, o.px(), py);
        dust.soundTranslationTable = this.bk.soundTranslationTable;
        dust.setAnimation(dinfo.ani);
        dust.playerInitSpawned();
        gs.addObject(dust, RENDER_LAYER_MIDDLE, false, false);
      }
      const opts = defaultSoundOpts();
      opts.panning = Math.max(-100, Math.min(100, Math.trunc((o.px() * 100) / 640) - 25));
      gs.playSound(36, opts);
      o.setAnimation(afGetMove(h.afData, ANIM_DAMAGE)!.ani);
      o.setRepeat(false);
      gs.screenShakeHorizontal = Math.trunc(3 * Math.abs(o.velX));
      emitFx(FxType.WALL_SLAM, wall === 1 ? ARENA_RIGHT_WALL : ARENA_LEFT_WALL, o.py() - 40, absVel * 5, wall === 1 ? 1 : -1, playerId, gs.thisId);
      o.setCustomString('hQ1-hQ7-x-3Q5-x-2L5-x-2M900');
      if (wall === 1) {
        o.posX = ARENA_RIGHT_WALL - 2;
        o.direction = OBJECT_FACE_RIGHT;
      } else {
        o.posX = ARENA_LEFT_WALL + 2;
        o.direction = OBJECT_FACE_LEFT;
      }
    } else {
      const info = bkGetInfo(this.bk, 20 + wall);
      if (info && info.hazardDamage === 0) {
        const obj = new GameObject(gs, info.ani.startX, info.ani.startY);
        obj.soundTranslationTable = this.bk.soundTranslationTable;
        obj.setAnimation(info.ani);
        obj.setCustomString('brwA1-brwB1-brwD1-brwE0-brwD4-brwC2-brwB2-brwA2');
        obj.playerInitSpawned();
        gs.addObject(obj, RENDER_LAYER_BOTTOM, true, false);
      }
    }
  }

  private defeatHook(loserId: number): void {
    const gs = this.gs;
    const winnerId = loserId ? 0 : 1;
    const pw = gs.getPlayer(winnerId);
    const pl = gs.getPlayer(loserId);
    const winner = this.harObj(winnerId);
    const loser = this.harObj(loserId);
    const wh = harData(winner);
    gs.fightStats.winner = winnerId;
    gs.announce(wh.health >= wh.healthMax ? 'perfect' : 'ko');
    const score = pw.score;
    // (the credits show the winner's card instead of "you lose")
    if (gs.credits) this.winState = WinState.DONE;
    // (OMF Studio's test of the computer against itself: the winner's banner, as between two players)
    else if (gs.modTest && gs.isDemoplay()) this.winState = WinState.YOUWIN;
    else if (gs.isDemoplay()) this.winState = WinState.YOULOSE;
    else if (!gs.isSingleplayer()) this.winState = WinState.YOUWIN;
    else this.winState = loserId === 1 ? WinState.YOUWIN : WinState.YOULOSE;
    const token = gs.findObject(this.playerRounds[winnerId][score.rounds] ?? 0);
    if (token) {
      token.setSpriteOverride(false);
      token.selectSprite(0);
      token.setSpriteOverride(true);
    }
    score.rounds++;
    if (pw.ctrl.type !== CtrlType.AI && pl.ctrl.type === CtrlType.AI) score.victory(harHealthPercent(wh));
    if (score.rounds >= Math.ceil(this.rounds / 2)) {
      wh.state = HarState.VICTORY;
      if (wh.executingMove === 0 && this.defeatedAtRest(loser)) {
        harFaceEnemy(winner, loser);
        harSetAni(winner, ANIM_VICTORY, false);
      }
      this.over = 1;
      this.winner = winnerId;
      if (gs.isSingleplayer()) {
        // (the beaten pilot's bit; a mod pilot has none, so the computer beating one sets bit 0, which the newsroom reads
        // as the player's loss: a shift past 31 would wrap)
        pw.spWins |= pilotWinBit(pl.pilot.pilotId) || (winnerId === 1 ? 1 : 0);
        if (pl.pilot.pilotId === PilotId.KREISSACK && pl.pilot.harId === HarId.NOVA) {
          wh.state = HarState.DONE;
          harData(loser).customDefeatAnimation = 47;
        }
      }
    } else {
      wh.state = HarState.DONE;
    }
  }

  private harInDefeatAnimation(obj: GameObject): boolean {
    const h = harData(obj);
    return obj.curAnimation!.id === (h.customDefeatAnimation ? h.customDefeatAnimation : ANIM_DEFEAT);
  }

  defeatedAtRest(obj: GameObject): boolean {
    return this.harInDefeatAnimation(obj) && !obj.isAirborne() && obj.velX === 0;
  }

  private winnerNeedsVictoryPose(obj: GameObject): boolean {
    const h = harData(obj);
    return !obj.isAirborne() && (h.state === HarState.DONE || h.state === HarState.VICTORY) && obj.curAnimation!.id !== ANIM_VICTORY;
  }

  private harIsScrapWalking(obj: GameObject): boolean {
    const h = harData(obj);
    return h.walkDestination > 0 && !!h.walkDoneAnim;
  }

  private pushPlayers(): void {
    const o1 = this.harObj(0), o2 = this.harObj(1);
    const h1 = harData(o1), h2 = harData(o2);
    if (!(o1.posY === ARENA_FLOOR || o2.posY === ARENA_FLOOR) || h1.health <= 0 || h2.health <= 0) return;
    const clearance = o1.posY < o2.posY ? h1.height : h2.height;
    let guard = 0;
    while (Math.abs(o1.px() - o2.px()) < 30 && Math.abs(o1.py() - o2.py()) < clearance && !h1.throwDuration && !h2.throwDuration && guard++ < 400) {
      let p1x = o1.posX, p2x = o2.posX;
      if (p1x < p2x) {
        p1x -= 1;
        p2x += 1;
      } else {
        p1x += 1;
        p2x -= 1;
      }
      o1.posX = Math.max(ARENA_LEFT_WALL, Math.min(ARENA_RIGHT_WALL, p1x));
      o2.posX = Math.max(ARENA_LEFT_WALL, Math.min(ARENA_RIGHT_WALL, p2x));
    }
  }

  private spawnHazards(): void {
    const gs = this.gs;
    // A mod arena's draws come from the high bits of the random numbers: their lowest bit alternates from one number to
    // the next, so with an even count of draws a tick a hazard can land on even numbers only, and one needing 1 never
    // appears. The original arenas keep the game's draws (and so their replays).
    const draw = modArena(this.id - SceneId.ARENA0) ? (n: number) => (gs.rand.intmax() >>> 8) % n : (n: number) => gs.rand.int(n);
    for (const [id, info] of this.bk.infos) {
      if (info.probability > 1 && draw(info.probability) === 1) {
        const obj = new GameObject(gs, info.ani.startX, info.ani.startY);
        obj.soundTranslationTable = this.bk.soundTranslationTable;
        obj.setAnimation(info.ani);
        obj.orbVal = gs.rand.int(255) - 127;
        if (arenaBase(this.id - SceneId.ARENA0) === 3 && id === 0) obj.setCustomString('Z3-mx+160my+100m15mp10Z1-Z300');
        hazardCreate(obj);
        obj.playerInitSpawned();
        if (gs.addObject(obj, RENDER_LAYER_BOTTOM, true, false)) {
          obj.layers = LAYER_HAZARD | LAYER_HAR;
          obj.group = GROUP_HAZARD;
          obj.userdata = this.bk;
          if (info.ani.extraStrings.length > 0) {
            const r = draw(info.ani.extraStrings.length);
            if (r > 0) obj.setCustomString(info.ani.extraStrings[r]);
          }
        }
      }
    }
  }

  // ---- ticks ---------------------------------------------------------------------------
  override dynamicTick(paused: boolean): void {
    if (paused) return;
    const gs = this.gs;
    const objs = [this.harObj(0), this.harObj(1)];
    const hars = objs.map(harData);
    this.pushPlayers();
    this.stateTicks++;
    gs.getPlayer(0).score.tick();
    gs.getPlayer(1).score.tick();
    for (let i = 0; i < 2; i++) {
      const hp = hars[i].health / hars[i].healthMax;
      let en = 0;
      if (hars[i].endurance >= 0) en = Math.max(0, Math.min(1, (hars[i].enduranceMax - hars[i].endurance) / hars[i].enduranceMax));
      this.healthBars[i].setProgress(hp * 100, !gs.warpSpeed);
      this.enduranceBars[i].setProgress(en * 100, !gs.warpSpeed);
      this.enduranceBars[i].setFlashing(en * 100 < 50, 8);
      this.healthBars[i].tick();
      this.enduranceBars[i].tick();
    }
    if (this.training) this.trainingTick(objs);
    if (gs.modeRun && this.state === ARENA_STATE_FIGHTING) this.runMs += gs.msPerDyntick();
    if (this.state === ARENA_STATE_FIGHTING) {
      if (gs.matchSettings.hazards) this.spawnHazards();
    } else if (this.state === ARENA_STATE_STARTING) {
      // (the credits' fights start later: their VS card first)
      const ready = gs.credits?.readyTick ?? ARENA_CROSSFADE_TICKS;
      if (this.stateTicks === ready) this.createRoundstartAnim();
      else if (this.stateTicks === ready + 60) {
        this.state = ARENA_STATE_FIGHTING;
        this.stateTicks = 0;
      }
    } else if (this.state === ARENA_STATE_ENDING) {
      if (this.defeatedAtRest(objs[0]) && this.winnerNeedsVictoryPose(objs[1])) {
        harFaceEnemy(objs[1], objs[0]);
        harSetAni(objs[1], ANIM_VICTORY, false);
      } else if (this.defeatedAtRest(objs[1]) && this.winnerNeedsVictoryPose(objs[0])) {
        harFaceEnemy(objs[0], objs[1]);
        harSetAni(objs[0], ANIM_VICTORY, false);
      }
      const s1 = gs.getPlayer(0).score, s2 = gs.getPlayer(1).score;
      const finishing = objs[0].frameIsSet(Tag.BE) || objs[1].frameIsSet(Tag.BE) || s1.onscreen() || s2.onscreen() ||
        this.harIsScrapWalking(objs[0]) || this.harIsScrapWalking(objs[1]);
      this.finishing = finishing;
      if (this.winState && this.winState !== WinState.DONE && (this.defeatedAtRest(objs[0]) || this.defeatedAtRest(objs[1]))) {
        if (this.winState === WinState.YOULOSE) this.youLoseStart();
        else if (this.winState === WinState.YOUWIN) this.youWinStart();
        this.winState = WinState.NONE;
      } else if (this.winState === WinState.DONE) {
        if (finishing) {
          // The credits' fights are DONE from the knockout on, so their long ending only waits for a finishing move
          // to be over (some victory poses loop on a waiting frame, which would hold it forever).
          this.stateTicks = gs.credits ? Math.min(this.stateTicks, this.endTick() - 30) : 50;
        }
      }
      const targetEnd = this.endTick();
      if (this.stateTicks >= targetEnd) {
        if (this.stateTicks === targetEnd) arenaScreengrabWinner(gs);
        const progress = this.stateTicks - targetEnd;
        if (progress >= ARENA_CROSSFADE_TICKS) {
          if (this.over) {
            this.arenaEnd();
          } else {
            this.round++;
            this.arenaReset();
          }
        }
      }
    }
    if (this.reinEnabled && globalRandom.float() > 0.65) {
      const x = globalRandom.int(320);
      for (let n = 0; n < 2; n++) {
        const hObj = objs[n];
        const h = hars[n];
        const rv = globalRandom.float() - 0.5;
        let vely = -12 * Math.sin(rv);
        if (vely < 0.1 && vely > -0.1) vely += 0.21;
        const move = afGetMove(h.afData, globalRandom.int(3) + ANIM_SCRAP_METAL);
        if (!move) continue;
        const scrap = new GameObject(gs, x, -10, rv, vely);
        scrap.setAnimation(move.ani);
        scrap.gravity = 0.4;
        scrap.palOffset = hObj.palOffset;
        scrap.palLimit = hObj.palLimit;
        scrap.layers = LAYER_SCRAP;
        scrap.castShadow = true;
        scrap.group = GROUP_SCRAP;
        scrapCreate(scrap);
        scrap.playerInitSpawned();
        gs.addObject(scrap, RENDER_LAYER_TOP, false, false);
      }
    }
  }

  override staticTick(): void {
    this.pauseMenu.tick();
    if (this.gs.replay) this.replayControls();
  }

  /** Watching a replay: the menu keys and pad buttons control the playback (see replay/hud.ts). */
  private replayControls(): void {
    const s = this.gs.replay!;
    const ev: CtrlEvent[] = [];
    this.gs.menuPoll(ev);
    for (const e of ev) {
      if (e.type !== 'action') continue;
      if (s.exporting) {
        // Saving a clip: pause / go on, or cancel.
        if (e.action & ACT_ESC) app.cancelExport();
        else if (e.action & ACT_PUNCH && !s.ended) s.setPaused(!s.paused);
        continue;
      }
      if (e.action & ACT_ESC) {
        s.exit();
        return;
      }
      if (e.action & ACT_PUNCH) this.replayToggle();
      if (e.action & ACT_KICK) s.hud = !s.hud;
      if (e.action & ACT_UP) s.changeSpeed(1);
      if (e.action & ACT_DOWN) s.changeSpeed(-1);
      if (e.action & (ACT_LEFT | ACT_RIGHT)) this.replayMove(e.action & ACT_RIGHT ? 1 : -1);
    }
  }

  private replayToggle(): void {
    const s = this.gs.replay!;
    if (s.ended) s.restart();
    else s.setPaused(!s.paused);
  }

  /** Paused: one tick forward or back. Playing: five seconds. */
  private replayMove(dir: 1 | -1): void {
    const s = this.gs.replay!;
    if (s.paused) {
      if (dir > 0) s.step();
      else s.seek(this.gs.tick - 1);
    } else {
      s.seek(this.gs.tick + dir * 300);
    }
  }

  override keyEvent(code: string, e: KeyboardEvent): boolean {
    if (this.lab && e.type === 'keydown' && !e.repeat && !this.menuVisible && this.lab.keyEvent(code)) return true;
    const s = this.gs.replay;
    if (!s || e.type !== 'keydown' || e.repeat) return false;
    const tick = this.gs.tick;
    if (s.exporting) {
      if (code === 'Space' && !s.ended) s.setPaused(!s.paused);
      return true;
    }
    switch (code) {
      case 'Space':
        this.replayToggle();
        return true;
      case 'KeyR':
        s.restart();
        return true;
      case 'KeyH':
        s.hud = !s.hud;
        return true;
      case 'KeyI':
        s.markIn = tick;
        if (s.markOut >= 0 && s.markOut <= tick) s.markOut = -1;
        this.replayHud?.flash('CLIP START');
        return true;
      case 'KeyO':
        s.markOut = tick;
        if (s.markIn >= tick) s.markIn = -1;
        this.replayHud?.flash('CLIP END');
        return true;
      case 'KeyC':
        s.markIn = s.markOut = -1;
        return true;
      case 'KeyV':
        app.exportReplay('video');
        return true;
      case 'KeyG':
        app.exportReplay('gif');
        return true;
      case 'KeyK':
        void s.keep().then((kept) => this.replayHud?.flash(kept ? 'KEPT' : 'NOT KEPT'));
        return true;
    }
    return false;
  }

  override pointer(x: number, y: number, kind: PointerKind): boolean {
    if (this.gs.replay?.exporting) return true;
    return this.replayHud?.pointer(x, y, kind) ?? false;
  }

  override inputPoll(): void {
    const gs = this.gs;
    if (!gs.paused) {
      for (let i = 0; i < 2; i++) {
        const player = gs.getPlayer(i);
        const ev: CtrlEvent[] = [];
        player.ctrl.poll(ev);
        const har = gs.findObject(player.harObjId);
        for (const e of ev) {
          if (e.type === 'action') {
            har?.act(e.action);
            this.recorder?.record(gs.tick, i, e.action);
          } else if (e.type === 'close') {
            // The recorded inputs ran out: the replay is over.
            if (gs.replay) gs.replay.finish();
            else gs.setNext(SceneId.MENU);
          }
        }
        const actions = this.training ? ev.filter((e) => e.type === 'action').map((e) => e.action) : [];
        this.lab?.record(i, actions);
        // The player's inputs (on the dummy's robot while recording it).
        if (i === (this.lab?.recording ? 1 : 0) && this.inputDisplay) {
          this.inputDisplay.record(actions, har?.direction === OBJECT_FACE_LEFT);
        }
      }
    }
    // A replay's controls are polled by the static tick (they keep their pace at any playback speed).
    if (gs.replay) return;
    const menuEv: CtrlEvent[] = [];
    // In a running fight the pads' buttons belong to the players; the Menu button pauses (and resumes). The credits'
    // fights are the computer's: their buttons skip ahead and go back.
    gs.menuPoll(menuEv, { playerScene: !this.menuVisible && !gs.credits, startIsEsc: true });
    for (const e of menuEv) {
      if (e.type !== 'action') continue;
      if (gs.credits) {
        // (the credits take the keyboard's presses as they come: a tap may fall between two polls)
        if (e.source === CtrlType.GAMEPAD) gs.credits.action(e.action);
      } else if (e.action === ACT_ESC && gs.isDemoplay()) {
        gs.setNext(SceneId.MENU);
      } else if (e.action === ACT_ESC && this.menuVisible && this.pauseMenu.back()) {
        // ESC on a page of the pause menu (the move list) goes back to the menu.
      } else if (e.action === ACT_ESC && this.lab?.recording) {
        // Pause stops recording the dummy first.
        this.lab.stopRecording();
      } else if (e.action === ACT_ESC) {
        // (ESC resumes like the menu's own close: what was changed in it is saved)
        if (this.menuVisible) this.pauseMenu.close();
        else {
          this.menuVisible = true;
          // (a network game goes on: the other game's player is still fighting, and the local robot stands still)
          if (!gs.net) gs.paused = true;
          this.pauseMenu.open();
        }
      } else if (this.menuVisible) {
        this.pauseMenu.action(e.action);
      }
    }
  }

  /** A player's robot and its name, for the move list of the pause menu. */
  robot(player: number): { af: Af; name: string } | null {
    const p = this.gs.getPlayer(player);
    const obj = this.gs.findObject(p.harObjId);
    return obj ? { af: harData(obj).afData, name: harName(p.pilot.harId) } : null;
  }

  /** Pauses a running fight when the player switches away (not demos, which just keep playing). */
  override focusLost(): void {
    const gs = this.gs;
    if (gs.replay) {
      gs.replay.setPaused(true);
      return;
    }
    // (a network game goes on: the robot stands still while the window is away, its keys let go)
    if (this.menuVisible || gs.isDemoplay() || this.over || gs.net) return;
    this.lab?.stopRecording();
    this.menuVisible = true;
    gs.paused = true;
    this.pauseMenu.open();
  }

  /** When a round's end fades out (the credits' fights linger on their winner). */
  private endTick(): number {
    return this.gs.credits?.endTicks ?? 80;
  }

  override paletteTransform(): void {
    let target: number;
    // (the credits bring their fights in themselves: the arena shows at once under the VS card, held still)
    if (this.state === ARENA_STATE_STARTING && this.gs.credits) return;
    // (the fade stands still while paused: the pause menu would stay dark until it was closed blind)
    if (this.menuVisible) return;
    if (this.state === ARENA_STATE_STARTING) target = 0;
    else if (this.state === ARENA_STATE_ENDING) target = this.endTick() + ARENA_CROSSFADE_TICKS;
    else return;
    if (!settings().video.crossfade) return;
    const progress = Math.abs(this.stateTicks - target);
    if (progress >= ARENA_CROSSFADE_TICKS) return;
    this.gs.enablePaletteTransform((pal) => paletteDarken(pal, 255 - Math.trunc((progress * 255) / ARENA_CROSSFADE_TICKS)));
  }

  override renderOverlay(): void {
    const gs = this.gs;
    if (gs.hideUi) return;
    this.lab?.renderWorld();
    for (let i = 0; i < 2; i++) {
      this.healthBars[i].render();
      this.enduranceBars[i].render();
    }
    this.playerName[0].draw(4, 18);
    this.playerHar[0].draw(4, 25);
    this.playerName[1].draw(161, 18);
    this.playerHar[1].draw(161, 25);
    // (after a credits fight's knockout its credit's card has the top of the screen: the bonuses are not drawn under it)
    if (!(gs.credits && this.state === ARENA_STATE_ENDING)) {
      gs.getPlayer(0).score.render(gs.getPlayer(0).selectable);
      gs.getPlayer(1).score.render(gs.getPlayer(1).selectable);
    }
    if (this.trnText && !this.menuVisible) this.trnText.draw(0, 191);
    const run = gs.modeRun;
    if (run && this.runText) {
      const of = run.total ? `/${run.total}` : '';
      const time = run.kind === 'timeattack' ? `   ${formatMs(run.ms + this.runMs)}` : '';
      const wins = run.kind === 'survival' ? `WINS ${run.wins}` : run.kind === 'exhibition' ? 'TEST FIGHT' : `FIGHT ${run.fight}${of}`;
      this.runText.set(`${run.label}   ${wins}${time}`);
      this.runText.draw(0, 34);
    }
    // (below the frame meter when it shows)
    if (this.inputDisplay && settings().training.inputDisplay) this.inputDisplay.render(4, settings().training.frameData ? 60 : 44);
    if (!this.menuVisible) this.lab?.render();
    if (this.menuVisible) this.pauseMenu.render();
    this.replayHud?.render();
  }

  /** The fight in the player's records (not training, demos, replays or OMF Studio's tests). */
  private recordResult(): void {
    const gs = this.gs;
    if (this.training || gs.isDemoplay() || gs.replay || gs.modTest) return;
    // (in a network game, the player at this computer: player 2 when they joined the game)
    const me = gs.net?.localPlayer ?? 0;
    const p1 = gs.getPlayer(me), p2 = gs.getPlayer(1 - me);
    const won = this.winner === me;
    const winnerHar = harData(this.harObj(this.winner));
    const finish = gs.fightStats.finish;
    recordFight({
      human: p1.ctrl.type !== CtrlType.AI,
      versus: p2.ctrl.type !== CtrlType.AI,
      won,
      harId: p1.pilot.harId,
      cpuDifficulty: p2.ctrl instanceof AiController ? p2.ctrl.difficulty : -1,
      perfect: winnerHar.health >= winnerHar.healthMax,
      finish: finish === 1 ? 'scrap' : finish === 2 ? 'destruction' : 'none',
      bestCombo: Math.max(this.bestCombo[me], this.comboHits[me]),
      ticks: gs.tick,
    });
  }

  /** Stores the finished fight's recording as a replay (fights shorter than a second are not kept). */
  private saveRecording(): void {
    const rec = this.recorder;
    const gs = this.gs;
    this.recorder = null;
    if (!rec || gs.tick < 60) return;
    // The pilots as they started the fight (tournament screens may have dropped player 2's by now).
    const player = (i: number) => {
      const p = rec.rec.pilots[i].info;
      return { name: p.name.trim() || `PLAYER ${i + 1}`, harId: p.harId, pilotId: p.pilotId };
    };
    const meta: ReplayMeta = {
      created: Date.now(),
      mode: gs.modeLabel ?? (gs.isTournament() ? 'TOURNAMENT' : gs.isSingleplayer() ? 'ONE PLAYER' : 'TWO PLAYER'),
      players: [player(0), player(1)],
      arena: this.id - SceneId.ARENA0,
      winner: this.over ? this.winner : -1,
      rounds: [gs.getPlayer(0).score.rounds, gs.getPlayer(1).score.rounds],
      ticks: gs.tick,
      kept: false,
    };
    if (this.startHealth !== undefined) meta.startHealth = this.startHealth;
    const designs = meta.players.map((p) => workshopDesign(p.harId) ?? null);
    if (designs.some((d) => d !== null)) meta.designs = designs;
    storeFight(meta, recSerialize(rec.finish(gs.tick)));
  }

  override free(): void {
    const gs = this.gs;
    this.saveRecording();
    gs.paused = false;
    for (let i = 0; i < 2; i++) {
      const p = gs.getPlayer(i);
      p.harObjId = 0;
      p.ctrl.setRepeat(0);
    }
    // (the music the credits play goes on from fight to fight; a replay's step back or seek replays the fight in a new
    // arena, and its music goes on)
    if (!gs.credits && !gs.replay?.seeking) gs.stopMusic();
  }
}

// Every arena number has the arena scene (the game's own and mods' arenas: a number without its files is never chosen).
for (let i = 0; i < MAX_ARENAS; i++) {
  const id = SceneId.ARENA0 + i;
  registerScene(id, (gs) => new ArenaScene(gs, id));
}
