import { describe, expect, it } from 'vitest';
import { Controller } from '../controller/controller';
import { setKeyState } from '../controller/input';
import { Palette } from '../formats/palette';
import { Pilot } from '../formats/pilot';
import { CtrlType, HarId, PILOT_SEX_FEMALE, PILOT_SEX_MALE, PilotId, SceneId } from '../game/constants';
import type { GameState } from '../game/gameState';
import { SCREENCAP_BLOW, SCREENCAP_H, SCREENCAP_POSE, SCREENCAP_W } from '../game/harScreencap';
import { harData } from '../game/objects/har';
import {
  LANG_STR_NEWSROOM_CHALLENGER1, LANG_STR_NEWSROOM_CHALLENGER2, LANG_STR_NEWSROOM_NEWCHAMPION, LANG_STR_NEWSROOM_TEXT,
  NewsroomScene, newsroomFixupCapitalization, newsroomFormat, newsroomPickNewsId, type NewsNames,
} from '../game/scenes/newsroom';
import type { ChrFile } from '../game/tournament/chr';
import { langGet } from '../resources/resources';
import { globalRandom } from '../util/random';
import { drawList } from '../video/draw';
import { createGame, hasGameData, HeadlessRunner } from './harness';

function tap(run: HeadlessRunner, code = 'Enter'): void {
  setKeyState(code, true);
  run.advance(60);
  setKeyState(code, false);
  run.advance(60);
}

/** A CPU "player" that never does anything (keeps fights deterministic). */
function idleAi(gs: GameState): Controller {
  const c = new Controller(gs);
  c.type = CtrlType.AI;
  return c;
}

/** Single player setup: Crystal (Jaguar) vs Steffan (Katana). */
function singlePlayer(): GameState {
  globalRandom.setSeed(1234);
  const gs = createGame(SceneId.MENU, [PilotId.CRYSTAL, PilotId.STEFFAN], [HarId.JAGUAR, HarId.KATANA]);
  gs.getPlayer(0).pilot.sex = PILOT_SEX_FEMALE;
  gs.getPlayer(1).pilot.sex = PILOT_SEX_MALE;
  gs.getPlayer(1).setCtrl(idleAi(gs));
  return gs;
}

function news(gs: GameState): NewsroomScene {
  expect(gs.sc).toBeInstanceOf(NewsroomScene);
  return gs.sc as NewsroomScene;
}

const CRYSTAL_VS_STEFFAN: NewsNames = { pilot1: 'Crystal', pilot2: 'Steffan', har1: HarId.JAGUAR, har2: HarId.KATANA, sex1: PILOT_SEX_FEMALE, sex2: PILOT_SEX_MALE };

describe.skipIf(!hasGameData)('newsroom text generation', () => {
  it('fills names, robots, pronouns and the stadium', () => {
    createGame(SceneId.MENU);
    // big win, first screen
    expect(newsroomFormat(langGet(87), CRYSTAL_VS_STEFFAN))
      .toBe(' Crystal showed incredible abilities with the Jaguar as Steffan became little more than a punching bag.');
    // possessive pronouns of pilot 1, capitalized after a sentence break; ~5 is the stadium
    expect(newsroomFormat(langGet(95), CRYSTAL_VS_STEFFAN))
      .toBe(' Crystal was looking good this evening.  Her Jaguar left the Stadium with only a few scars from her overmatched opponent.');
    // opponent's subject pronoun (~11) and pilot 1's object pronoun (~7)
    expect(newsroomFormat(langGet(97), CRYSTAL_VS_STEFFAN))
      .toBe(' The Stadium was rocked tonight by the impressive Crystal.  Steffan needs some more practice before he can beat the likes of her.');
    // opponent's robot (~4)
    expect(newsroomFormat(langGet(98), CRYSTAL_VS_STEFFAN))
      .toBe(" Katana parts littered the floor after repeated blows like this.  Almost makes me feel sorry for Steffan's repair crew.");
    // a loss text with pilot 1 male: ~6 his, ~7 him, ~8 he
    const steffanLost: NewsNames = { pilot1: 'Steffan', pilot2: 'Crystal', har1: HarId.THORN, har2: HarId.JAGUAR, sex1: PILOT_SEX_MALE, sex2: PILOT_SEX_FEMALE };
    expect(newsroomFormat(langGet(114), steffanLost))
      .toBe(" Steffan and his ill-fated Thorn.  Steffan should start making bets against himself if he's gonna take dives like this one.");
    // ~10: opponent's object pronoun
    expect(newsroomFormat(langGet(102), CRYSTAL_VS_STEFFAN))
      .toBe(' Steffan held in there for a while, but Crystal simply out-performed him with moves like this.');
    // tournament texts
    expect(newsroomFormat(langGet(LANG_STR_NEWSROOM_CHALLENGER1), CRYSTAL_VS_STEFFAN))
      .toBe("And in other news, after Crystal's fight tonight, Steffan, an unranked competitor, has issued a public challenge to Crystal.");
    expect(newsroomFormat(langGet(LANG_STR_NEWSROOM_CHALLENGER2), CRYSTAL_VS_STEFFAN))
      .toBe("Well, if she accepts the challenge, you can bet your life I'll be there to watch the fight!");
    expect(newsroomFormat(langGet(LANG_STR_NEWSROOM_NEWCHAMPION), CRYSTAL_VS_STEFFAN)).toContain('NEW CHAMPION');
    // Pronouns and robot names are clipped to the reference's 8 character scratch buffer.
    const gargoyle: NewsNames = { ...CRYSTAL_VS_STEFFAN, har1: HarId.GARGOYLE, har2: HarId.SHREDDER };
    expect(newsroomFormat('~3/~4', gargoyle)).toBe('Gargoyle/Shredder');
  });

  it('names the arena fought in and the new robots (remaster)', () => {
    const gs = createGame(SceneId.MENU);
    expect(newsroomFormat(langGet(131), { ...CRYSTAL_VS_STEFFAN, arena: 4 }))
      .toBe('Wow, this was a close one.  Crystal and Steffan traded blows in the Desert until...');
    expect(newsroomFormat(langGet(97), { ...CRYSTAL_VS_STEFFAN, arena: 8 }))
      .toBe(' The Abyss was rocked tonight by the impressive Crystal.  Steffan needs some more practice before he can beat the likes of her.');
    expect(newsroomFormat(langGet(89), { ...CRYSTAL_VS_STEFFAN, arena: 5 })).toContain('at the Orbital Station.');
    expect(newsroomFormat(langGet(87), { ...CRYSTAL_VS_STEFFAN, har1: HarId.HELIX }))
      .toBe(' Crystal showed incredible abilities with the Helix as Steffan became little more than a punching bag.');
    // The arena scene records where the fight is: single player moves on to the next arena before the report.
    gs.swapScene(SceneId.ARENA6);
    expect(gs.fightStats.arena).toBe(6);
  });

  it('capitalizes the first letter and sentence starts after double spaces', () => {
    expect(newsroomFixupCapitalization('his robot.  her robot.  ok')).toBe('His robot.  Her robot.  Ok');
    expect(newsroomFixupCapitalization(' a.   b')).toBe(' a.   b');
    expect(newsroomFixupCapitalization('x.  été')).toBe('X.  été');
  });

  it('picks the report by outcome and remaining health', () => {
    globalRandom.setSeed(7);
    const range = (won: boolean, health: number) => {
      const s = new Set<number>();
      for (let i = 0; i < 60; i++) s.add(newsroomPickNewsId(won, health));
      return [...s].sort((a, b) => a - b);
    };
    expect(range(true, 100)).toEqual([0, 2, 4]);
    expect(range(true, 60)).toEqual([6, 8, 10]);
    expect(range(true, 30)).toEqual([12, 14, 16]);
    expect(range(true, 5)).toEqual([18, 20, 22]);
    expect(range(false, 90)).toEqual([24, 26, 28]);
    expect(range(false, 51)).toEqual([30, 32, 34]);
    expect(range(false, 26)).toEqual([36, 38, 40]);
    expect(range(false, 0)).toEqual([42, 44, 46]);
  });
});

describe.skipIf(!hasGameData)('newsroom scene (headless)', () => {
  it('reports a win on two screens, then picks a new opponent and goes to VS', () => {
    const gs = singlePlayer();
    const p1 = gs.getPlayer(0);
    const p2 = gs.getPlayer(1);
    p1.spWins = 2 << PilotId.STEFFAN;
    p1.score.health = 90;
    gs.swapScene(SceneId.NEWSROOM);
    const sc = news(gs);
    expect(sc.won).toBe(true);
    expect([0, 2, 4]).toContain(sc.newsId);
    expect(sc.newsStr.str).toBe(newsroomFormat(langGet(LANG_STR_NEWSROOM_TEXT + sc.newsId), CRYSTAL_VS_STEFFAN));
    expect(sc.newsStr.str).not.toMatch(/~\d/);
    const run = new HeadlessRunner(gs);
    run.advance(500);
    tap(run);
    expect(sc.screen).toBe(1);
    expect(sc.newsStr.str).toBe(newsroomFormat(langGet(LANG_STR_NEWSROOM_TEXT + sc.newsId + 1), CRYSTAL_VS_STEFFAN));
    expect(gs.nextId).toBe(SceneId.NEWSROOM);
    tap(run);
    expect(gs.nextId).toBe(SceneId.VS);
    const next = p2.pilot;
    expect(next.pilotId).not.toBe(PilotId.CRYSTAL);
    expect(next.pilotId).not.toBe(PilotId.STEFFAN);
    expect(next.pilotId).toBeLessThan(10);
    expect(next.harId).toBeLessThan(10);
    expect(next.name).toBe(langGet(20 + next.pilotId));
    expect(p2.ctrl.type).toBe(CtrlType.AI);
  });

  it('sends Kreissack in his Nova after the ten regular pilots', () => {
    const gs = singlePlayer();
    gs.getPlayer(0).spWins = 2046 ^ (2 << PilotId.CRYSTAL);
    gs.getPlayer(0).score.health = 40;
    gs.swapScene(SceneId.NEWSROOM);
    expect([12, 14, 16]).toContain(news(gs).newsId);
    const run = new HeadlessRunner(gs);
    run.advance(500);
    tap(run);
    tap(run);
    expect(gs.nextId).toBe(SceneId.VS);
    expect(gs.getPlayer(1).pilot.pilotId).toBe(PilotId.KREISSACK);
    expect(gs.getPlayer(1).pilot.harId).toBe(HarId.NOVA);
    expect(gs.getPlayer(1).pilot.name).toBe(langGet(30));
  });

  it('goes to the ending after beating Kreissack', () => {
    const gs = singlePlayer();
    gs.getPlayer(0).spWins = 4094 ^ (2 << PilotId.CRYSTAL);
    gs.swapScene(SceneId.NEWSROOM);
    const run = new HeadlessRunner(gs);
    run.advance(500);
    tap(run);
    tap(run);
    expect(gs.nextId).toBe(SceneId.END);
    run.advance(700);
    expect(gs.thisId).toBe(SceneId.END);
  });

  it('asks to continue after a loss (yes: scoreboard then VS rematch)', () => {
    const gs = singlePlayer();
    const p1 = gs.getPlayer(0);
    const p2 = gs.getPlayer(1);
    p2.spWins = 2 << PilotId.CRYSTAL;
    p1.score.wins = 1;
    gs.swapScene(SceneId.NEWSROOM);
    const sc = news(gs);
    expect(sc.won).toBe(false);
    expect(sc.newsId).toBeGreaterThanOrEqual(24);
    const run = new HeadlessRunner(gs);
    run.advance(500);
    tap(run);
    tap(run);
    expect(sc.continueDialog.isVisible()).toBe(true);
    expect(gs.nextId).toBe(SceneId.NEWSROOM);
    tap(run); // YES is preselected
    expect(gs.nextId).toBe(SceneId.SCOREBOARD);
    expect(gs.nextNextId).toBe(SceneId.VS);
    expect(p2.spWins).toBe(0);
    expect(p1.score.wins).toBe(0);
    expect(p2.pilot.pilotId).toBe(PilotId.STEFFAN);
  });

  it('asks to continue after a loss (no: scoreboard then main menu)', () => {
    const gs = singlePlayer();
    gs.getPlayer(1).spWins = 2 << PilotId.CRYSTAL;
    gs.swapScene(SceneId.NEWSROOM);
    const sc = news(gs);
    const run = new HeadlessRunner(gs);
    run.advance(500);
    tap(run);
    tap(run);
    expect(sc.continueDialog.isVisible()).toBe(true);
    tap(run, 'ArrowRight');
    tap(run);
    expect(gs.nextId).toBe(SceneId.SCOREBOARD);
    expect(gs.nextNextId).toBe(SceneId.MENU);
    expect(gs.getPlayer(1).spWins).not.toBe(0);
  });

  it('reports a tournament challenger and lets the player accept the fight', () => {
    const gs = singlePlayer();
    const p1 = gs.getPlayer(0);
    const chrPilot = new Pilot();
    chrPilot.rank = 5;
    chrPilot.enemiesIncUnranked = 1;
    const chr: ChrFile = {
      pilot: chrPilot, pal: new Palette(), unknownB: 0, photo: null, winningsMultiplier: 1, enemies: [],
      bkName: 'NORTH_AM.BK', tournamentId: 0, cutsceneText: [],
    };
    p1.chr = chr;
    const challenger = new Pilot();
    challenger.name = 'Challenger';
    challenger.harId = HarId.GARGOYLE;
    challenger.sex = PILOT_SEX_MALE;
    gs.fightStats.challenger = challenger;
    gs.swapScene(SceneId.NEWSROOM);
    const sc = news(gs);
    expect(sc.challenger).toBe(challenger);
    expect(gs.fightStats.challenger).toBe(null);
    expect(sc.translationId()).toBe(LANG_STR_NEWSROOM_CHALLENGER1);
    expect(sc.newsStr.str).toContain('Challenger, an unranked competitor');
    const run = new HeadlessRunner(gs);
    run.advance(500);
    tap(run);
    expect(sc.translationId()).toBe(LANG_STR_NEWSROOM_CHALLENGER2);
    tap(run);
    expect(sc.acceptChallengeDialog.isVisible()).toBe(true);
    tap(run); // YES
    expect(gs.nextId).toBe(SceneId.VS);
    expect(gs.getPlayer(1).pilot).toBe(challenger);
  });

  it('crowns a new tournament champion on a third screen', () => {
    const gs = singlePlayer();
    const chrPilot = new Pilot();
    chrPilot.rank = 1;
    gs.getPlayer(0).chr = {
      pilot: chrPilot, pal: new Palette(), unknownB: 0, photo: null, winningsMultiplier: 1, enemies: [],
      bkName: 'NORTH_AM.BK', tournamentId: 0, cutsceneText: ['page'],
    };
    gs.getPlayer(1).pilot.rank = 2;
    gs.swapScene(SceneId.NEWSROOM);
    const sc = news(gs);
    expect(sc.champion).toBe(true);
    const run = new HeadlessRunner(gs);
    run.advance(500);
    tap(run);
    tap(run);
    expect(sc.translationId()).toBe(LANG_STR_NEWSROOM_NEWCHAMPION);
    expect(gs.nextId).toBe(SceneId.NEWSROOM);
    tap(run);
    expect(gs.nextId).toBe(SceneId.TRN_CUTSCENE);
    expect((gs.getPlayer(1) as unknown as { pilot: Pilot | null }).pilot).toBe(null);
  });

  it('shows the fight photos taken in the arena', () => {
    const gs = singlePlayer();
    gs.matchSettings.rounds = 0;
    gs.swapScene(SceneId.ARENA0);
    const run = new HeadlessRunner(gs);
    run.advance(3500);
    const enemy = gs.findObject(gs.getPlayer(1).harObjId)!;
    harData(enemy).health = 1;
    setKeyState('ArrowRight', true);
    run.advance(1200);
    setKeyState('ArrowRight', false);
    for (let i = 0; i < 40 && gs.thisId !== SceneId.NEWSROOM; i++) {
      tap(run);
      run.advance(500);
    }
    expect(gs.thisId).toBe(SceneId.NEWSROOM);
    const caps = gs.getPlayer(0).screencaps;
    expect(caps.ok).toEqual([true, true]);
    const pose = caps.cap[SCREENCAP_POSE]!;
    const blow = caps.cap[SCREENCAP_BLOW]!;
    expect([pose.w, pose.h]).toEqual([SCREENCAP_W, SCREENCAP_H]);
    expect(blow.w).toBeGreaterThanOrEqual(SCREENCAP_W);
    expect(caps.raw).toEqual([null, null]); // compressed at the end of the fight
    // Background turned to the gray ramp, HAR colors (< 0x60) kept.
    let har = 0;
    for (const v of pose.data) {
      expect(v < 0x60 || (v >= 0xd0 && v <= 0xdf)).toBe(true);
      if (v > 0 && v < 0x60) har++;
    }
    expect(har).toBeGreaterThan(200);
    const sc = news(gs);
    expect(sc.won).toBe(true);
    run.advance(200);
    const photo = () => drawList.cmds.slice(0, drawList.count).find((c) => c.x === 165 && c.y === 15);
    expect(photo()?.surf).toBe(pose);
    expect([photo()!.w, photo()!.h]).toEqual([SCREENCAP_W, SCREENCAP_H]);
    tap(run);
    run.advance(100);
    expect(photo()?.surf).toBe(blow);
  });
});
