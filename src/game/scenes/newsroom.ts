// Newsroom: the post-fight news report of single player and tournament games. Two report screens (win/lose texts
// picked by the remaining health) with fight photos, then the next opponent / ending / continue dialog, or the
// tournament's challenger and new champion reports. Port of the reference newsroom scene.
import { pilotWinBit } from '../roster';
import { unlock } from '../records/records';
import { newsReader, type NewsReadNames } from '../../audio/newsVoice';
import { createAiController } from '../../controller/ai';
import type { CtrlEvent } from '../../controller/controller';
import type { Pilot } from '../../formats/pilot';
import { bkGetInfo, harName, langGet } from '../../resources/resources';
import { globalRandom } from '../../util/random';
import { video } from '../../video/draw';
import type { Surface } from '../../video/surface';
import { ACT_ESC, ACT_KICK, ACT_PUNCH, HarId, PILOT_INFO, PilotId, SceneId } from '../constants';
import { registerScene, type FightStats, type GamePlayer, type GameState } from '../gameState';
import { Dialog, DialogResult, DialogStyle } from '../gui/dialog';
import { FontSize, HAlign, Text, VAlign } from '../gui/text';
import { menuBackground, MenuBackgroundStyle, menuShade } from '../gui/widgets';
import { arenaNewsName } from '../roster';
import { SCREENCAP_BLOW, SCREENCAP_H, SCREENCAP_POSE, SCREENCAP_W } from '../harScreencap';
import { paletteLoadPlayerColors, setPilotColors } from '../pilotColors';
import { Scene } from '../scene';
import { settings } from '../settings';

const NEWS_TEXT_COLOR = 0xcf;

// OMF 2097 language string ids (reference languages.h)
export const LANG_STR_HAR = 31;
export const LANG_STR_NEWSROOM_CHALLENGER1 = 77;
export const LANG_STR_NEWSROOM_CHALLENGER2 = 78;
export const LANG_STR_NEWSROOM_NEWCHAMPION = 79;
export const LANG_STR_PRONOUN = 81;
export const LANG_STR_NEWSROOM_TEXT = 87;
const LANG_STR_CONTINUE = 213; // "Do you wish to continue?"
const LANG_STR_ACCEPT_CHALLENGE = 76; // "Do you want to fight this challenger?"

const FINISH_SCRAP = 1;
const FINISH_DESTRUCTION = 2;

/** Every opponent (pilots 0..10) beaten, as bits 1..11 of GamePlayer.spWins. */
const ALL_PILOTS_BEATEN = 4094;
/** Every regular opponent (pilots 0..9) beaten: Kreissack is next. */
const ALL_REGULAR_PILOTS_BEATEN = 2046;

function possessivePronoun(sex: number): string {
  return langGet(LANG_STR_PRONOUN + sex);
}
function objectPronoun(sex: number): string {
  return langGet(LANG_STR_PRONOUN + 2 + sex);
}
function subjectPronoun(sex: number): string {
  return langGet(LANG_STR_PRONOUN + 4 + sex);
}

/** Drops trailing newlines and truncates to the reference's 9-byte scratch buffer (8 chars). */
function pronounStrip(pronoun: string, bufSize = 9): string {
  let len = pronoun.length;
  while (len && pronoun[len - 1] === '\n') len--;
  if (len >= bufSize) len = bufSize - 1;
  return pronoun.slice(0, len);
}

/** Upper-cases the first character and every character following a double space (sentence starts). */
export function newsroomFixupCapitalization(s: string): string {
  const c = s.split('').map((ch) => ch.charCodeAt(0));
  const str = () => String.fromCharCode(...c);
  let it = 0;
  while (it < c.length) {
    if (c[it] >= 0x61 && c[it] <= 0x7a) c[it] -= 0x20; // toupper() on 7-bit characters
    const next = str().indexOf('  ', it + 1);
    if (next < 0) break;
    it = next + 2;
  }
  return str();
}

/** Names and pronoun data substituted into the news texts (~1..~11). */
export interface NewsNames {
  pilot1: string;
  pilot2: string;
  har1: number;
  har2: number;
  sex1: number;
  sex2: number;
  /** The arena fought in (~5). The reference always says "Stadium"; the remaster names the real one. */
  arena?: number;
}

/** Fills a news text template (reference newsroom_fixup_str without the translation choice). */
export function newsroomFormat(template: string, n: NewsNames): string {
  let tmp = template;
  const rep = (key: string, value: string) => {
    tmp = tmp.split(key).join(value);
  };
  rep('~11', pronounStrip(subjectPronoun(n.sex2)));
  rep('~10', pronounStrip(objectPronoun(n.sex2)));
  rep('~9', pronounStrip(possessivePronoun(n.sex2)));
  rep('~8', pronounStrip(subjectPronoun(n.sex1)));
  rep('~7', pronounStrip(objectPronoun(n.sex1)));
  rep('~6', pronounStrip(possessivePronoun(n.sex1)));
  rep('~5', arenaNewsName(n.arena ?? 0));
  rep('~4', pronounStrip(harName(n.har2)));
  rep('~3', pronounStrip(harName(n.har1)));
  rep('~2', n.pilot2);
  rep('~1', n.pilot1);
  return newsroomFixupCapitalization(tmp);
}

/** The names a report is read aloud with: the ones newsroomFormat fills in. */
export function newsReadNames(n: NewsNames): NewsReadNames {
  return {
    pilot1: n.pilot1, pilot2: n.pilot2,
    robot1: pronounStrip(harName(n.har1)), robot2: pronounStrip(harName(n.har2)),
    arena: arenaNewsName(n.arena ?? 0), sex1: n.sex1, sex2: n.sex2,
  };
}

/** News text id: 0..46 (even); +1 is the second screen. Wins 0..22 by health bracket, losses 24..46. */
export function newsroomPickNewsId(won: boolean, health: number): number {
  if (health > 75 && won) return globalRandom.int(3) * 2;
  if (health > 50 && won) return 6 + globalRandom.int(3) * 2;
  if (health > 25 && won) return 12 + globalRandom.int(3) * 2;
  if (won) return 18 + globalRandom.int(3) * 2;
  if (health > 75) return 24 + globalRandom.int(3) * 2;
  if (health > 50) return 30 + globalRandom.int(3) * 2;
  if (health > 25) return 36 + globalRandom.int(3) * 2;
  return 42 + globalRandom.int(3) * 2;
}

/** GamePlayer.pilot is NULL in the reference between tournament fights (VS then picks the next opponent). */
function setPilot(p: GamePlayer, pilot: Pilot | null): void {
  (p as unknown as { pilot: Pilot | null }).pilot = pilot;
}

function pilotOf(p: GamePlayer): Pilot | null {
  return (p as unknown as { pilot: Pilot | null }).pilot;
}

/** Bit mask of the requirements an unranked tournament challenger meets (higher = better match). */
function challengerScore(p: Pilot | null, p1: GamePlayer, p2: GamePlayer, fs: FightStats): number {
  if (p === null) return -1;
  const chr = p1.chr!;
  const pilot1 = p1.pilot;
  const health = p1.score.health;
  let ret = 0;
  ret |= p.reqMaxRank && p.reqMaxRank >= pilot1.rank ? 1 : 0;
  ret |= (p.reqVitality && p.reqVitality <= health ? 1 : 0) << 1;
  ret |= (p.reqAccuracy && p.reqAccuracy <= fs.hitMissRatio[0] ? 1 : 0) << 2;
  ret |= (p.reqAvgDmg && p.reqAvgDmg <= fs.averageDamage[0] ? 1 : 0) << 3;
  ret |= (p.reqDifficulty && p.reqDifficulty <= pilot1.difficulty ? 1 : 0) << 4;
  ret |= (p.reqFighter && p.reqFighter === pilot1.harId ? 1 : 0) << 5;
  ret |= (p.reqScrap && fs.finish >= FINISH_SCRAP ? 1 : 0) << 6;
  ret |= (p.reqDestroy && fs.finish === FINISH_DESTRUCTION ? 1 : 0) << 7;
  ret |= (p.reqEnemy && chr.enemies[p.reqEnemy - 1]?.pilot === pilotOf(p2) ? 1 : 0) << 8;
  return ret;
}

export class NewsroomScene extends Scene {
  newsId: number;
  screen = 0;
  newsBg1: Surface;
  newsBg2: Surface;
  newsStr: Text;
  names: NewsNames = { pilot1: '', pilot2: '', har1: 0, har2: 0, sex1: 0, sex2: 0 };
  won = false;
  champion = false;
  challenger: Pilot | null = null;
  continueDialog: Dialog;
  acceptChallengeDialog: Dialog;

  constructor(gs: GameState) {
    super(gs, SceneId.NEWSROOM);
    this.newsId = globalRandom.int(24) * 2;
    this.newsBg1 = menuShade(280, 55);
    this.newsBg2 = menuBackground(280, 55, MenuBackgroundStyle.NEWSROOM);
    this.newsStr = new Text(FontSize.BIG, 280, 55)
      .setHAlign(HAlign.CENTER)
      .setVAlign(VAlign.MIDDLE)
      .setColor(NEWS_TEXT_COLOR)
      .setMargin({ left: 1, right: 1, top: 1, bottom: 1 });

    const p1 = gs.getPlayer(0);
    const p2 = gs.getPlayer(1);
    const p2pilot = pilotOf(p2);
    if (p1.chr && p2pilot && (p2pilot.onlyFightOnce || (p2pilot.secret && p2.spWins === 0))) {
      p2pilot.rank = p1.chr.pilot.enemiesIncUnranked + 1;
    }
    let health = 0;
    if (p2.spWins > 0) {
      this.won = false;
      health = p2.score.health;
    } else {
      this.won = true;
      const fs = gs.fightStats;
      if (p1.chr && fs.challenger) {
        this.challenger = fs.challenger;
        setPilot(p2, this.challenger);
        fs.challenger = null;
      } else if (p1.chr) {
        this.findChallenger(p1, p2, fs);
      }
      const opp = pilotOf(p2);
      if (!this.challenger && p1.chr && p1.chr.pilot.rank === 1 && opp && opp.rank === 2) this.champion = true;
      health = p1.score.health;
    }
    this.newsId = newsroomPickNewsId(this.won, health);

    const opp = pilotOf(p2)!;
    this.setNames(p1.pilot.name, opp.name, p1.pilot.harId, opp.harId, p1.pilot.sex, opp.sex, gs.fightStats.arena);
    this.fixupStr();
    this.speak();

    this.continueDialog = new Dialog(DialogStyle.YES_NO, langGet(LANG_STR_CONTINUE), 72, 60);
    this.acceptChallengeDialog = new Dialog(DialogStyle.YES_NO, langGet(LANG_STR_ACCEPT_CHALLENGE), 72, 60);
    this.continueDialog.userdata = this;
    this.continueDialog.clicked = (_d, r) => this.continueDialogClicked(r);
    this.acceptChallengeDialog.userdata = this;
    this.acceptChallengeDialog.clicked = (_d, r) => this.acceptChallengeDialogClicked(r);

    for (let i = 0; i < 2; i++) {
      const pilot = pilotOf(gs.getPlayer(i));
      if (pilot) paletteLoadPlayerColors(pilot.palette, i);
    }
    gs.playMusic('MENU.PSM');
  }

  /** Tournament: looks for an unranked pilot whose requirements this fight met (reference newsroom_create). */
  private findChallenger(p1: GamePlayer, p2: GamePlayer, fs: FightStats): void {
    const chr = p1.chr!;
    const pilot1 = p1.pilot;
    const health = p1.score.health;
    const opp = pilotOf(p2);
    for (let k = chr.pilot.enemiesExUnranked - 1; k < chr.pilot.enemiesIncUnranked; k++) {
      const enemy = chr.enemies[k];
      if (!enemy) continue;
      const p = enemy.pilot;
      if (p.rank !== 0) continue;
      const reqEnemyOk = (): boolean => chr.enemies[p.reqEnemy - 1]?.pilot === opp;
      if ((!p.reqRank || p.reqRank === pilot1.rank)
        && (!p.reqMaxRank || p.reqMaxRank >= pilot1.rank)
        && (!p.reqVitality || p.reqVitality <= health)
        && (!p.reqAccuracy || p.reqAccuracy <= fs.hitMissRatio[0])
        && (!p.reqAvgDmg || p.reqAvgDmg <= fs.averageDamage[0])
        && (!p.reqEnemy || reqEnemyOk())
        && (!p.reqDifficulty || p.reqDifficulty <= pilot1.difficulty)
        && (!p.reqFighter || p.reqFighter === pilot1.harId)
        && (!p.reqScrap || fs.finish >= FINISH_SCRAP)
        && (!p.reqDestroy || fs.finish === FINISH_DESTRUCTION)) {
        if (opp && (opp.secret === 0 || (p.reqEnemy && reqEnemyOk()))) {
          if (challengerScore(p, p1, p2, fs) > challengerScore(fs.challenger, p1, p2, fs)) fs.challenger = p;
        }
      }
    }
  }

  setNames(pilot1: string, pilot2: string, har1: number, har2: number, sex1: number, sex2: number, arena = 0): void {
    this.names = {
      pilot1: pilot1.replace(/\s+$/, ''),
      pilot2: pilot2.replace(/\s+$/, ''),
      har1, har2, sex1, sex2, arena,
    };
  }

  /** Language string id of the current screen. */
  translationId(): number {
    if (this.champion && this.screen >= 2) return LANG_STR_NEWSROOM_NEWCHAMPION;
    if (this.challenger && this.screen === 0) return LANG_STR_NEWSROOM_CHALLENGER1;
    if (this.challenger && this.screen >= 1) return LANG_STR_NEWSROOM_CHALLENGER2;
    return LANG_STR_NEWSROOM_TEXT + this.newsId + Math.min(this.screen, 1);
  }

  fixupStr(): void {
    this.newsStr.set(newsroomFormat(langGet(this.translationId()), this.names));
  }

  /** Has the newsreader read the report on screen (in the announcer's voice), or stop once the reports are over. */
  private speak(): void {
    if (this.screen <= 1 || (this.champion && this.screen === 2)) newsReader.say(this.translationId(), newsReadNames(this.names));
    else newsReader.stop();
  }

  private continueDialogClicked(result: DialogResult): void {
    const gs = this.gs;
    if (result === DialogResult.NO) {
      gs.setNext(SceneId.SCOREBOARD);
    } else if (result === DialogResult.YES_OK) {
      const p1 = gs.getPlayer(0);
      const p2 = gs.getPlayer(1);
      p2.spWins = 0;
      p1.score.resetWins();
      gs.setNext(SceneId.SCOREBOARD);
      gs.nextNextId = SceneId.VS;
    }
  }

  private acceptChallengeDialogClicked(result: DialogResult): void {
    const gs = this.gs;
    const p2 = gs.getPlayer(1);
    if (result === DialogResult.NO) {
      setPilot(p2, null);
      gs.setNext(SceneId.MECHLAB);
    } else if (result === DialogResult.YES_OK) {
      setPilot(p2, this.challenger);
      gs.setNext(SceneId.VS);
    }
  }

  /** Single player: picks the next opponent (a random pilot not beaten yet, then Kreissack). */
  private nextOpponent(p1: GamePlayer, p2: GamePlayer): void {
    const gs = this.gs;
    const pilot = p2.pilot;
    if (p1.spWins === (ALL_REGULAR_PILOTS_BEATEN ^ pilotWinBit(p1.pilot.pilotId))) {
      pilot.pilotId = PilotId.KREISSACK;
      pilot.harId = HarId.NOVA;
    } else {
      // The reference loops until it hits an eligible pilot; the guard only protects against corrupt win flags.
      for (let guard = 0; ; guard++) {
        const i = globalRandom.int(10);
        if (guard < 100000 && ((2 << i) & p1.spWins || i === p1.pilot.pilotId)) continue;
        pilot.pilotId = i;
        pilot.harId = globalRandom.int(10);
        break;
      }
    }
    const info = PILOT_INFO[pilot.pilotId];
    pilot.endurance = info.endurance;
    pilot.power = info.power;
    pilot.agility = info.agility;
    pilot.sex = info.sex;
    setPilotColors(pilot, info.color1, info.color2, info.color3);
    pilot.name = langGet(pilot.pilotId + 20);
    p2.setCtrl(createAiController(gs, settings().gameplay.difficulty, pilot, pilot.pilotId));
  }

  override startup(id: number): [boolean, boolean] {
    switch (id) {
      case 5:
      case 6:
        return [true, false];
    }
    return [false, false];
  }

  override staticTick(_paused: boolean): void {
    this.continueDialog.tick();
    this.acceptChallengeDialog.tick();
  }

  override inputPoll(): void {
    const gs = this.gs;
    const p1 = gs.getPlayer(0);
    const p2 = gs.getPlayer(1);
    const ev: CtrlEvent[] = [];
    gs.menuPoll(ev);
    for (const e of ev) {
      if (e.type !== 'action') continue;
      if (this.continueDialog.isVisible()) {
        this.continueDialog.event(e.action, e.source);
      } else if (this.acceptChallengeDialog.isVisible()) {
        this.acceptChallengeDialog.event(e.action, e.source);
      } else if (e.action === ACT_ESC || e.action === ACT_KICK || e.action === ACT_PUNCH) {
        this.screen++;
        this.fixupStr();
        this.speak();
        if (this.challenger) {
          if (this.screen >= 2) this.acceptChallengeDialog.show(true);
        } else if ((this.screen >= 2 && !this.champion) || this.screen >= 3) {
          if (this.won || p1.chr) {
            if (p1.chr) {
              setPilot(p2, null);
              p2.spWins = 0;
            } else if (p1.spWins === (ALL_PILOTS_BEATEN ^ pilotWinBit(p1.pilot.pilotId))) {
              unlock('campaign');
              gs.setNext(SceneId.END);
            } else {
              this.nextOpponent(p1, p2);
            }
            // (after SceneId.END was set, this second request is ignored by setNext)
            if (p1.chr && this.champion) {
              unlock('tournament');
              gs.setNext(SceneId.TRN_CUTSCENE);
            }
            else gs.setNext(SceneId.VS);
          } else {
            this.continueDialog.show(true);
          }
        }
      }
    }
  }

  override renderOverlay(): void {
    const gs = this.gs;
    if (!this.challenger) {
      const caps = gs.getPlayer(this.won ? 0 : 1).screencaps;
      const capId = this.screen === 0 ? SCREENCAP_POSE : SCREENCAP_BLOW;
      const cap = caps.cap[capId];
      if (caps.ok[capId] && cap) video.drawSize(cap, 165, 15, SCREENCAP_W, SCREENCAP_H);
    }
    video.drawRemap(this.newsBg1, 20, 131, 4, 1, 0);
    video.draw(this.newsBg2, 20, 131);
    this.newsStr.draw(20, 131);
    const overlays = bkGetInfo(this.bk, 4)?.ani;
    if (this.champion && this.screen >= 2) {
      const sp = overlays?.getSprite(1);
      if (sp?.surface) video.draw(sp.surface, sp.posX, sp.posY);
    }
    if (this.challenger) {
      const sp = overlays?.getSprite(0);
      if (sp?.surface) video.draw(sp.surface, sp.posX, sp.posY);
    }
    if (this.continueDialog.isVisible()) this.continueDialog.render();
    if (this.acceptChallengeDialog.isVisible()) this.acceptChallengeDialog.render();
  }

  override free(): void {
    newsReader.stop();
    this.continueDialog.free();
    this.acceptChallengeDialog.free();
  }
}

registerScene(SceneId.NEWSROOM, (gs) => new NewsroomScene(gs));
