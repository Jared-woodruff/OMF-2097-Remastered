// Fire and Ice (game/fireIce.ts) and the finisher keys (controller/finisher.ts): one-player fights in the Fire Pit played
// through the destruction and the Fire & Ice move into Fire's and Ice's fights, the floor and the globes after them, the
// stages' look and score, their replays; and every original robot's destruction from one key.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Controller } from '../controller/controller';
import { PadButton, setKeyState } from '../controller/input';
import { GamepadController } from '../controller/keyboard';
import { moveActions } from '../controller/dummy';
import { Palette, color6to8 } from '../formats/palette';
import { recFirePitFlags, recParse, recSerialize, REC_LOOKUP10_FIRE_PIT, REC_LOOKUP_EXTENDED } from '../formats/rec';
import {
  ACT_DOWN, ACT_KICK, ACT_PUNCH, ACT_STOP, ACT_UP, AiDifficulty, CtrlType, EFFECT_DARK_TINT, HarId, HarState, OBJECT_FACE_RIGHT,
  PilotId, SceneId,
} from '../game/constants';
import {
  firePitLive, firePitRecorded, FIRE_PIT, newFireIceRun, paletteColorize, PIT_NO_GLOBES, PIT_SOLID_FLOOR, PIT_WAY_DOWN,
  pilotDrawFlags, PILOT_DRAW_TRANSLUCENT, SecretStage, secretPilot,
} from '../game/fireIce';
import type { GameState } from '../game/gameState';
import { ARENA_STATE_FIGHTING, harData } from '../game/objects/har';
import { ReplaySession } from '../game/replay/playback';
import { setReplaySink, type ReplayMeta } from '../game/replay/store';
import type { ArenaScene } from '../game/scenes/arena';
import { settings } from '../game/settings';
import { loadAf, loadBk } from '../resources/resources';
import { harMoveList } from '../game/gui/moveList';
import { globalRandom } from '../util/random';
import { vga } from '../video/vga';
import { createGame, hasGameData, HeadlessRunner } from './harness';

const KEYS = ['ArrowRight', 'ArrowLeft', 'Enter', 'ShiftRight', 'Comma', 'Period', 'Semicolon', 'Slash'];
const saved = { difficulty: 0, finisherKeys: false, saveReplays: true };

afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of KEYS) setKeyState(k, false);
  settings().gameplay.difficulty = saved.difficulty;
  settings().keys.finisherKeys = saved.finisherKeys;
  settings().gameplay.saveReplays = saved.saveReplays;
});

/** A computer "player" that never does anything (keeps the fights the same every time). */
function idleAi(gs: GameState): Controller {
  const c = new Controller(gs);
  c.type = CtrlType.AI;
  return c;
}

/** A one-player game in the Fire Pit: Crystal on `har` against Steffan, the finisher keys on. */
function storyGame(difficulty: number, har: HarId = HarId.JAGUAR): GameState {
  saved.difficulty = settings().gameplay.difficulty;
  saved.finisherKeys = settings().keys.finisherKeys;
  saved.saveReplays = settings().gameplay.saveReplays;
  globalRandom.setSeed(77);
  const gs = createGame(SceneId.MENU, [PilotId.CRYSTAL, PilotId.STEFFAN], [har, HarId.THORN]);
  gs.setupKeyboard(0, 0);
  gs.getPlayer(1).setCtrl(idleAi(gs));
  gs.matchSettings.rounds = 0;
  gs.rand.setSeed(99);
  gs.fireIce = newFireIceRun();
  gs.getPlayer(0).score.setDifficulty(difficulty);
  settings().gameplay.difficulty = difficulty;
  settings().keys.finisherKeys = true;
  return gs;
}

function arena(gs: GameState): ArenaScene {
  expect(gs.sc.isArena()).toBe(true);
  return gs.sc as ArenaScene;
}

/** A key held as a player holds it (long enough for a game tick even in the knockout's slow motion). */
function press(run: HeadlessRunner, code: string): void {
  setKeyState(code, true);
  run.advance(200);
  setKeyState(code, false);
  run.advance(100);
}

/** The computer's robot of this fight does nothing (Fire's and Ice's fight against the player otherwise). */
function idleOpponent(gs: GameState): void {
  const p2 = gs.getPlayer(1);
  const c = idleAi(gs);
  c.harObjId = p2.harObjId;
  p2.setCtrl(c);
}

/** Knocks player 2 out: down to 1 health, then player 1 walks in punching. */
function knockOut(gs: GameState, run: HeadlessRunner): void {
  for (let t = 0; t < 10000 && arena(gs).state !== ARENA_STATE_FIGHTING; t += 50) run.advance(50);
  harData(gs.findObject(gs.getPlayer(1).harObjId)!).health = 1;
  for (let i = 0; i < 150 && arena(gs).arenaIsOver() < 0; i++) {
    setKeyState('ArrowRight', true);
    run.advance(150);
    setKeyState('ArrowRight', false);
    press(run, i % 2 ? 'ShiftRight' : 'Enter');
  }
  expect(arena(gs).arenaIsOver()).toBe(0);
}

/** Plays on until the next scene opens. */
function untilNextScene(gs: GameState, run: HeadlessRunner, maxMs = 90000): void {
  const s = gs.sceneSerial;
  for (let t = 0; t < maxMs && gs.sceneSerial === s; t += 50) run.advance(50);
  expect(gs.sceneSerial, 'a new scene opens').not.toBe(s);
}

describe('Fire and Ice rules', () => {
  it('opens the way down on CHAMPION and harder, once per game, and on from Fire only on ULTIMATE', () => {
    const run = newFireIceRun();
    expect(firePitLive(run, AiDifficulty.WORLD_CLASS, true).wayDown).toBe(false);
    expect(firePitLive(run, AiDifficulty.CHAMPION, true)).toEqual({ stage: 0, wayDown: true, solidFloor: false, noGlobes: false });
    expect(firePitLive(run, AiDifficulty.ULTIMATE, false).wayDown, 'not outside the one-player game').toBe(false);
    run.stage = SecretStage.FIRE;
    expect(firePitLive(run, AiDifficulty.DEADLY, true)).toEqual({ stage: 1, wayDown: false, solidFloor: true, noGlobes: true });
    expect(firePitLive(run, AiDifficulty.ULTIMATE, true)).toEqual({ stage: 1, wayDown: true, solidFloor: false, noGlobes: true });
    run.stage = SecretStage.ICE;
    expect(firePitLive(run, AiDifficulty.ULTIMATE, true)).toEqual({ stage: 2, wayDown: false, solidFloor: true, noGlobes: true });
    run.stage = SecretStage.NONE;
    run.fireBeaten = true;
    expect(firePitLive(run, AiDifficulty.ULTIMATE, true)).toEqual({ stage: 0, wayDown: false, solidFloor: true, noGlobes: true });
  });

  it("plays a recording without its Fire Pit record (the original's) with Fire's way down open, as on ULTIMATE", () => {
    expect(firePitRecorded(SecretStage.FIRE, null)).toEqual({ stage: 1, wayDown: true, solidFloor: false, noGlobes: true });
    expect(firePitRecorded(SecretStage.ICE, null)).toEqual({ stage: 2, wayDown: false, solidFloor: true, noGlobes: true });
    expect(firePitRecorded(SecretStage.NONE, null)).toEqual({ stage: 0, wayDown: false, solidFloor: false, noGlobes: false });
    // (the record says, where there is one)
    expect(firePitRecorded(SecretStage.FIRE, PIT_SOLID_FLOOR | PIT_NO_GLOBES)).toEqual({ stage: 1, wayDown: false, solidFloor: true, noGlobes: true });
  });

  it('tints with the original palette effect: each color toward the tint by its brightest channel', () => {
    const pal = new Palette();
    const set6 = (i: number, r: number, g: number, b: number) => pal.set(i, color6to8(r), color6to8(g), color6to8(b));
    set6(1, 32, 16, 8);
    set6(2, 0, 0, 0);
    paletteColorize(pal, 1, 2, [63, 35, 0], 16);
    // r: ((63 - 32) * 16 >> 6) * 32 >> 6 = 7 * 32 >> 6 = 3; g: (19 * 16 >> 6) * 32 >> 6 = 2; b: (-8 * 16 >> 6) * 32 >> 6 = -1
    expect([1, 2, 3].map((k) => pal.colors[3 + k - 1] >> 2)).toEqual([35, 18, 7]);
    // (black has no bright channel: unchanged)
    expect([0, 1, 2].map((k) => pal.colors[6 + k])).toEqual([0, 0, 0]);
  });

  it('enters a move that ends on the neutral position with its button after it (live as in its replay)', () => {
    expect(moveActions('P5252', OBJECT_FACE_RIGHT)).toEqual([ACT_DOWN, ACT_STOP, ACT_DOWN, ACT_STOP, ACT_PUNCH]);
    expect(moveActions('K258', OBJECT_FACE_RIGHT)).toEqual([ACT_UP, ACT_STOP, ACT_DOWN | ACT_KICK]);
  });
});

describe.skipIf(!hasGameData)('Fire and Ice', () => {
  it('writes Fire and Ice over the beaten pilot as the original does', () => {
    const gs = createGame(SceneId.MENU, [PilotId.CRYSTAL, PilotId.STEFFAN], [HarId.JAGUAR, HarId.THORN]);
    const bk = loadBk('ARENA3.BK');
    const beaten = gs.getPlayer(1).pilot;
    const fire = secretPilot(beaten, SecretStage.FIRE, bk);
    expect([fire.name, fire.harId, fire.power, fire.agility, fire.endurance, fire.offense, fire.defense])
      .toEqual(['FIRE', HarId.KATANA, 24, 26, 30, 130, 130]);
    expect(fire.enhancements[HarId.KATANA]).toBe(3);
    expect([fire.apThrow, fire.apSpecial, fire.prefFwd, fire.prefBack]).toEqual([50, 20, 100, 10]);
    expect(fire.pilotId).toBe(PilotId.STEFFAN);
    // Fire's colors: the flames palette's player 2 colors (one red to yellow ramp)
    expect(Array.from(fire.palette.colors.subarray(15 * 3, 16 * 3))).toEqual(Array.from(bk.palettes[1].colors.subarray(63 * 3, 64 * 3)));
    expect(pilotDrawFlags(fire)).toBe(0);
    const ice = secretPilot(beaten, SecretStage.ICE, bk);
    expect([ice.name, ice.harId, ice.power, ice.agility, ice.endurance, ice.offense, ice.defense]).toEqual(['ICE', HarId.SHADOW, 30, 30, 33, 170, 170]);
    expect(ice.enhancements[HarId.SHADOW]).toBe(3);
    expect(pilotDrawFlags(ice) & PILOT_DRAW_TRANSLUCENT).toBeTruthy();
    expect(beaten.name, 'the beaten pilot stays as it was').not.toBe('FIRE');
  });

  it('goes down to Fire after a destruction and the Fire & Ice move, and comes back to the news after her', () => {
    const gs = storyGame(AiDifficulty.CHAMPION);
    gs.swapScene(SceneId.ARENA0 + FIRE_PIT);
    const run = new HeadlessRunner(gs);
    expect(arena(gs).firePit).toEqual({ stage: 0, wayDown: true, solidFloor: false, noGlobes: false });
    knockOut(gs, run);
    // (the destruction's bonus, though the Fire & Ice move cuts it short)
    const score = gs.getPlayer(0).score;
    let bonus = false;
    const setDone = score.setDone.bind(score);
    score.setDone = () => {
      if (score.destruction) bonus = true;
      setDone();
    };
    // One key: the scrap, the destruction, then the Fire & Ice move.
    press(run, 'Semicolon');
    untilNextScene(gs, run);
    expect(gs.thisId).toBe(SceneId.ARENA0 + FIRE_PIT);
    expect(bonus, 'the destruction bonus').toBe(true);
    const sc = arena(gs);
    expect(gs.fireIce.stage).toBe(SecretStage.FIRE);
    expect(sc.firePit).toEqual({ stage: 1, wayDown: false, solidFloor: true, noGlobes: true });
    const fire = gs.getPlayer(1).pilot;
    expect([fire.name, fire.harId, fire.enhancements[HarId.KATANA]]).toEqual(['FIRE', HarId.KATANA, 3]);
    expect(gs.getPlayer(0).score.stageMultiplier).toBe(5);
    // The flames palette's arena colors, the player's robot lit by them.
    expect(Array.from(vga.base.colors.subarray(0x70 * 3, 0x71 * 3))).toEqual(Array.from(loadBk('ARENA3.BK').palettes[1].colors.subarray(0x70 * 3, 0x71 * 3)));
    // Fire's fight: won, then the news of the fight before.
    idleOpponent(gs);
    knockOut(gs, run);
    untilNextScene(gs, run);
    expect(gs.thisId).toBe(SceneId.NEWSROOM);
    expect(gs.fireIce.stage).toBe(SecretStage.NONE);
    expect(gs.fireIce.fireBeaten).toBe(true);
    expect(gs.getPlayer(1).pilot.name).toBe('Steffan');
    expect(gs.getPlayer(1).pilot.harId).toBe(HarId.THORN);
    expect(gs.getPlayer(1).spWins).toBe(0);
    expect(gs.getPlayer(0).spWins & (2 << PilotId.STEFFAN)).toBeTruthy();
    expect(gs.fightStats.arena).toBe(FIRE_PIT);
  });

  it('closes the Fire Pit once Fire was beaten: solid floor, no globes, no way down', () => {
    const gs = storyGame(AiDifficulty.ULTIMATE);
    gs.fireIce.fireBeaten = true;
    gs.swapScene(SceneId.ARENA0 + FIRE_PIT);
    const sc = arena(gs);
    expect(sc.firePit).toEqual({ stage: 0, wayDown: false, solidFloor: true, noGlobes: true });
    const har = harData(gs.findObject(gs.getPlayer(0).harObjId)!);
    // (the robot's Fire & Ice move is left out)
    expect(har.afData.moves[28]?.moveString).toBe('!');
    const run = new HeadlessRunner(gs);
    for (let t = 0; t < 30000; t += 100) run.advance(100);
    expect(gs.objects.some((r) => r.obj.curAnimation?.id === 15), 'no globes').toBe(false);
  });

  it('only does the scrap and the destruction below CHAMPION, and the game goes on to the news', () => {
    const gs = storyGame(AiDifficulty.WORLD_CLASS);
    gs.swapScene(SceneId.ARENA0 + FIRE_PIT);
    const run = new HeadlessRunner(gs);
    expect(arena(gs).firePit?.wayDown).toBe(false);
    knockOut(gs, run);
    press(run, 'Semicolon');
    untilNextScene(gs, run);
    expect(gs.thisId === SceneId.NEWSROOM || gs.thisId === SceneId.VICTORY).toBe(true);
    expect(gs.fightStats.finish).toBe(2);
    expect(gs.fireIce.stage).toBe(SecretStage.NONE);
  });

  it('goes on from Fire to Ice on ULTIMATE: a translucent Shadow in the frozen Fire Pit, 50 times the score', () => {
    const gs = storyGame(AiDifficulty.ULTIMATE);
    gs.swapScene(SceneId.ARENA0 + FIRE_PIT);
    const run = new HeadlessRunner(gs);
    knockOut(gs, run);
    press(run, 'Semicolon');
    untilNextScene(gs, run);
    expect(arena(gs).firePit).toEqual({ stage: 1, wayDown: true, solidFloor: false, noGlobes: true });
    idleOpponent(gs);
    knockOut(gs, run);
    press(run, 'Semicolon');
    untilNextScene(gs, run);
    const sc = arena(gs);
    expect(gs.fireIce.stage).toBe(SecretStage.ICE);
    expect(sc.firePit).toEqual({ stage: 2, wayDown: false, solidFloor: true, noGlobes: true });
    expect(sc.fxLook()).toBe(6);
    const ice = gs.getPlayer(1).pilot;
    expect([ice.name, ice.harId]).toEqual(['ICE', HarId.SHADOW]);
    expect(gs.findObject(gs.getPlayer(1).harObjId)!.hasEffect(EFFECT_DARK_TINT)).toBe(true);
    expect(gs.getPlayer(0).score.stageMultiplier).toBe(50);
    // (the frozen shimmer runs)
    expect(gs.objects.some((r) => r.obj.curAnimation?.id === 5 && r.obj.spritelessPaletteFx)).toBe(true);
  });

  it('costs nothing to lose to Fire: the game goes on to the news of the fight before', () => {
    const gs = storyGame(AiDifficulty.CHAMPION);
    gs.swapScene(SceneId.ARENA0 + FIRE_PIT);
    const run = new HeadlessRunner(gs);
    knockOut(gs, run);
    press(run, 'Semicolon');
    untilNextScene(gs, run);
    expect(gs.fireIce.stage).toBe(SecretStage.FIRE);
    // Player 1 is knocked out by Fire.
    for (let t = 0; t < 10000 && arena(gs).state !== ARENA_STATE_FIGHTING; t += 50) run.advance(50);
    harData(gs.findObject(gs.getPlayer(0).harObjId)!).health = 1;
    for (let t = 0; t < 120000 && arena(gs).arenaIsOver() < 0; t += 100) run.advance(100);
    expect(arena(gs).arenaIsOver()).toBe(1);
    untilNextScene(gs, run);
    expect(gs.thisId).toBe(SceneId.NEWSROOM);
    expect(gs.fireIce.fireBeaten).toBe(false);
    expect(gs.getPlayer(1).spWins, 'the news are of a win').toBe(0);
  });

  it("records Fire's fight with its stage and floor, and plays it back the same", () => {
    let rec: { meta: ReplayMeta; data: Uint8Array } | null = null;
    setReplaySink(async (meta, data) => {
      rec = { meta, data };
    });
    const gs = storyGame(AiDifficulty.CHAMPION);
    settings().gameplay.saveReplays = true;
    gs.swapScene(SceneId.ARENA0 + FIRE_PIT);
    const run = new HeadlessRunner(gs);
    knockOut(gs, run);
    press(run, 'Semicolon');
    untilNextScene(gs, run);
    rec = null;
    idleOpponent(gs);
    knockOut(gs, run);
    untilNextScene(gs, run);
    expect(rec).not.toBeNull();
    const parsed = recParse(rec!.data);
    expect(parsed.secretStage).toBe(SecretStage.FIRE);
    expect(recFirePitFlags(parsed)).toBe(PIT_SOLID_FLOOR | PIT_NO_GLOBES);
    expect(recParse(recSerialize(parsed)).secretStage).toBe(SecretStage.FIRE);
    // Played back: Fire's stage and colors again.
    globalRandom.setSeed(5);
    const gs2 = createGame(SceneId.MENU);
    const session = new ReplaySession(gs2, rec!, () => {});
    session.start();
    const run2 = new HeadlessRunner(gs2);
    for (let t = 0; t < 5000 && !gs2.sc.isArena(); t += 20) run2.advance(20);
    expect(arena(gs2).firePit).toEqual({ stage: 1, wayDown: false, solidFloor: true, noGlobes: true });
    expect(harData(gs2.findObject(gs2.getPlayer(0).harObjId)!).afData.moves[28]?.moveString, 'no way down').toBe('!');
    expect(gs2.getPlayer(1).pilot.name).toBe('FIRE');
    expect(Array.from(gs2.getPlayer(1).pilot.palette.colors.subarray(3, 48 * 3)))
      .toEqual(Array.from(loadBk('ARENA3.BK').palettes[1].colors.subarray(49 * 3, 96 * 3)));
    for (let t = 0; t < 200000 && !session.ended; t += 100) run2.advance(100);
    expect(session.ended).toBe(true);
    expect(arena(gs2).winner).toBe(0);
  });

  it("plays an ULTIMATE Fire fight recorded without its Fire Pit record (as the original's) with the way down open", () => {
    let rec: { meta: ReplayMeta; data: Uint8Array } | null = null;
    setReplaySink(async (meta, data) => {
      rec = { meta, data };
    });
    const gs = storyGame(AiDifficulty.ULTIMATE);
    settings().gameplay.saveReplays = true;
    gs.swapScene(SceneId.ARENA0 + FIRE_PIT);
    const run = new HeadlessRunner(gs);
    knockOut(gs, run);
    press(run, 'Semicolon');
    untilNextScene(gs, run);
    rec = null;
    idleOpponent(gs);
    knockOut(gs, run);
    untilNextScene(gs, run);
    expect(rec).not.toBeNull();
    const parsed = recParse(rec!.data);
    expect(recFirePitFlags(parsed)).toBe(PIT_WAY_DOWN | PIT_NO_GLOBES);
    // Without the record, as the original game (and the remaster before Fire and Ice) records a fight.
    parsed.moves = parsed.moves.filter((m) => !(m.lookupId === REC_LOOKUP_EXTENDED && m.extra[0] === REC_LOOKUP10_FIRE_PIT));
    expect(recFirePitFlags(parsed)).toBeNull();
    globalRandom.setSeed(5);
    const gs2 = createGame(SceneId.MENU);
    const session = new ReplaySession(gs2, { meta: rec!.meta, data: recSerialize(parsed) }, () => {});
    session.start();
    const run2 = new HeadlessRunner(gs2);
    for (let t = 0; t < 5000 && !gs2.sc.isArena(); t += 20) run2.advance(20);
    expect(arena(gs2).firePit).toEqual({ stage: 1, wayDown: true, solidFloor: false, noGlobes: true });
    // The player's Fire & Ice move is there (Jaguar's: up, neutral, down + kick), as in a fight that went on to Ice.
    const me = harData(gs2.findObject(gs2.getPlayer(0).harObjId)!);
    expect(me.wayDown).toBe(true);
    expect(me.afData.moves[28]?.moveString).toBe('K258');
  });
});

describe.skipIf(!hasGameData)('finisher keys', () => {
  it.each([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])('robot %i: the destruction key does the scrap and the destruction', (har) => {
    const gs = storyGame(AiDifficulty.ROOKIE, har as HarId);
    gs.swapScene(SceneId.ARENA0);
    const run = new HeadlessRunner(gs);
    knockOut(gs, run);
    press(run, 'Period');
    let state = HarState.NONE;
    for (let t = 0; t < 60000 && gs.fightStats.finish !== 2; t += 50) {
      run.advance(50);
      if (gs.sc.isArena()) state = harData(gs.findObject(gs.getPlayer(0).harObjId)!).state;
    }
    expect(gs.fightStats.finish, `the destruction (last state ${state})`).toBe(2);
  });

  it('the special button does the next finishing move; with the finisher keys off, nothing', () => {
    const gs = storyGame(AiDifficulty.ROOKIE, HarId.JAGUAR);
    gs.swapScene(SceneId.ARENA0);
    const run = new HeadlessRunner(gs);
    knockOut(gs, run);
    const me = () => harData(gs.findObject(gs.getPlayer(0).harObjId)!);
    for (let t = 0; t < 20000 && me().state !== HarState.SCRAP; t += 100) {
      press(run, 'Slash');
      run.advance(60);
    }
    expect(me().state).toBe(HarState.SCRAP);
    for (let t = 0; t < 20000 && gs.fightStats.finish !== 2; t += 100) {
      press(run, 'Slash');
      run.advance(60);
    }
    expect(gs.fightStats.finish).toBe(2);

    const gs2 = storyGame(AiDifficulty.ROOKIE, HarId.JAGUAR);
    settings().keys.finisherKeys = false;
    gs2.swapScene(SceneId.ARENA0);
    const run2 = new HeadlessRunner(gs2);
    knockOut(gs2, run2);
    press(run2, 'Period');
    for (let t = 0; t < 4000; t += 100) run2.advance(100);
    expect(gs2.fightStats.finish).toBe(0);
  });

  it('a tap of the special button in a hit pause still counts: on the keyboard and on a gamepad', () => {
    for (const device of ['keyboard', 'gamepad']) {
      const gs = storyGame(AiDifficulty.ROOKIE, HarId.JAGUAR);
      gs.swapScene(SceneId.ARENA0);
      const run = new HeadlessRunner(gs);
      knockOut(gs, run);
      const me = () => harData(gs.findObject(gs.getPlayer(0).harObjId)!);
      for (let t = 0; t < 20000 && me().state !== HarState.VICTORY; t += 50) run.advance(50);
      expect(me().state).toBe(HarState.VICTORY);
      const pad = { index: 0, connected: true, id: 'Xbox', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false })) };
      if (device === 'gamepad') {
        vi.stubGlobal('navigator', { getGamepads: () => [pad] });
        const c = new GamepadController(gs, 0);
        c.harObjId = gs.getPlayer(0).harObjId;
        gs.getPlayer(0).setCtrl(c);
      }
      const hold = (down: boolean) => {
        if (device === 'gamepad') pad.buttons[PadButton.LT].pressed = down;
        else setKeyState('Slash', down);
      };
      // Down and up while the game stands still (no input poll), then it goes on.
      gs.hitPauseTicks = 1000;
      hold(true);
      run.advance(60);
      hold(false);
      run.advance(60);
      expect(gs.hitPauseTicks, 'still in the pause').toBeGreaterThan(0);
      gs.hitPauseTicks = 0;
      for (let t = 0; t < 10000 && me().state !== HarState.SCRAP; t += 50) run.advance(50);
      expect(me().state, device).toBe(HarState.SCRAP);
      vi.unstubAllGlobals();
    }
  });

  it('lists the Fire & Ice move where it can be done, and only there', () => {
    const list = (gs: GameState) => harMoveList(harData(gs.findObject(gs.getPlayer(0).harObjId)!).afData);
    const open = storyGame(AiDifficulty.CHAMPION, HarId.JAGUAR);
    open.swapScene(SceneId.ARENA0 + FIRE_PIT);
    const fi = list(open).filter((e) => e.kind === 'FIRE & ICE');
    expect(fi.map((e) => [e.inputs.join(''), e.button])).toEqual([['852', 'K']]);
    const shut = storyGame(AiDifficulty.CHAMPION, HarId.JAGUAR);
    shut.swapScene(SceneId.ARENA0);
    expect(list(shut).some((e) => e.kind === 'FIRE & ICE')).toBe(false);
    // (the manual's lists: every robot's but Nova's)
    for (let har = 0; har <= 10; har++) expect(harMoveList(loadAf(har)).some((e) => e.kind === 'FIRE & ICE'), `robot ${har}`).toBe(har !== HarId.NOVA);
  });

  it('do nothing before the fight is won (the original inputs of the Fire & Ice move neither)', () => {
    const gs = storyGame(AiDifficulty.ULTIMATE, HarId.JAGUAR);
    gs.swapScene(SceneId.ARENA0 + FIRE_PIT);
    const run = new HeadlessRunner(gs);
    for (let t = 0; t < 10000 && arena(gs).state !== ARENA_STATE_FIGHTING; t += 50) run.advance(50);
    press(run, 'Semicolon');
    press(run, 'Period');
    // Jaguar's Fire & Ice move by hand: up, neutral, down + kick.
    const o = gs.findObject(gs.getPlayer(0).harObjId)!;
    for (const a of moveActions('K258', o.direction)) o.act(a);
    run.advance(200);
    expect(o.curAnimation?.id).not.toBe(28);
    expect(arena(gs).arenaIsOver()).toBe(-1);
  });
});
