import { beforeEach, describe, expect, it } from 'vitest';
import { Controller } from '../controller/controller';
import { setKeyState } from '../controller/input';
import { CtrlType, HarId, PilotId, SceneId } from '../game/constants';
import type { GameState } from '../game/gameState';
import { ScoreboardScene, scoreRow } from '../game/scenes/scoreboard';
import {
  createScoreboard, SCORE_ENTRIES, SCORE_PAGES, scoresClear, scoresDeleteFile, SCORES_FILE_SIZE, scoresLoadFile, scoresRead,
  scoresWrite, sdScoreLoad, sdScoreSave,
} from '../game/scores';
import { settings } from '../game/settings';
import { vga } from '../video/vga';
import { createGame, hasGameData, HeadlessRunner, installBrowserShims } from './harness';

function tap(run: HeadlessRunner, code = 'Enter'): void {
  setKeyState(code, true);
  run.advance(60);
  setKeyState(code, false);
  run.advance(60);
}

function key(ch: string, code?: string): KeyboardEvent {
  return { key: ch, code: code ?? (ch.length === 1 ? `Key${ch.toUpperCase()}` : ch), ctrlKey: false, altKey: false, metaKey: false, repeat: false } as KeyboardEvent;
}

function type(gs: GameState, text: string): void {
  for (const ch of text) gs.sc.keyEvent(ch === ' ' ? 'Space' : `Key${ch.toUpperCase()}`, key(ch, ch === ' ' ? 'Space' : undefined));
}

/** Game over with a single player score waiting to be entered. */
function pendingGame(score: number): GameState {
  const gs = createGame(SceneId.MENU, [PilotId.MILANO, PilotId.STEFFAN], [HarId.SHADOW, HarId.KATANA]);
  const ai = new Controller(gs);
  ai.type = CtrlType.AI;
  gs.getPlayer(1).setCtrl(ai);
  gs.getPlayer(0).score.score = score;
  return gs;
}

function board(gs: GameState): ScoreboardScene {
  expect(gs.sc).toBeInstanceOf(ScoreboardScene);
  return gs.sc as ScoreboardScene;
}

describe('high score table storage', () => {
  beforeEach(() => {
    installBrowserShims();
    scoresDeleteFile();
  });

  it('round-trips the SCORES.DAT layout', () => {
    const sb = createScoreboard();
    sb.entries[0][0] = { score: 4000000, pilotId: PilotId.KREISSACK, harId: HarId.NOVA, name: 'MAJOR' };
    sb.entries[3][19] = { score: 1, pilotId: 9, harId: 63, name: 'FIFTEEN CHARS!!' };
    const bytes = sdScoreSave(sb);
    expect(bytes.length).toBe(SCORES_FILE_SIZE);
    expect(SCORES_FILE_SIZE).toBe(SCORE_PAGES * SCORE_ENTRIES * 24);
    // u32 score, char[16] name, u32 har_id | pilot_id << 6
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(0, true)).toBe(4000000);
    expect(String.fromCharCode(...bytes.subarray(4, 9))).toBe('MAJOR');
    expect(bytes[9]).toBe(0);
    expect(view.getUint32(20, true)).toBe(HarId.NOVA | (PilotId.KREISSACK << 6));
    const back = sdScoreLoad(bytes);
    expect(back).toEqual(sb);
    expect(() => sdScoreLoad(bytes.subarray(0, 100))).toThrow();
  });

  it('persists through localStorage', () => {
    const sb = createScoreboard();
    expect(scoresRead(sb)).toBe(1); // nothing stored yet
    sb.entries[1][0] = { score: 12345, pilotId: 2, harId: 7, name: 'ABC' };
    expect(scoresWrite(sb)).toBe(0);
    expect(scoresLoadFile()!.length).toBe(SCORES_FILE_SIZE);
    const again = createScoreboard();
    expect(scoresRead(again)).toBe(0);
    expect(again.entries[1][0]).toEqual({ score: 12345, pilotId: 2, harId: 7, name: 'ABC' });
    scoresClear(again);
    expect(again.entries[1][0].score).toBe(0);
  });

  it('formats rows like the reference printf', () => {
    expect(scoreRow('PLAYER NAME', 'ROBOT', 'PILOT', 'SCORE'))
      .toBe('PLAYER NAME       ROBOT    PILOT          SCORE');
    expect(scoreRow('ABCDEFGHIJKLMNOPQRS', 'JAGUAR', 'CRYSTAL', '1,234,567'))
      .toBe('ABCDEFGHIJKLMNOP  JAGUAR   CRYSTAL    1,234,567');
  });
});

describe.skipIf(!hasGameData)('scoreboard scene (headless)', () => {
  beforeEach(() => {
    installBrowserShims();
    scoresDeleteFile();
    settings().gameplay.rounds = 1;
  });

  it('enters a new high score with the keyboard and saves it', () => {
    const sb = createScoreboard();
    sb.entries[1][0] = { score: 900000, pilotId: 0, harId: 0, name: 'FIRST' };
    sb.entries[1][1] = { score: 100, pilotId: 1, harId: 1, name: 'LAST' };
    scoresWrite(sb);
    const gs = pendingGame(250000);
    gs.swapScene(SceneId.SCOREBOARD);
    const sc = board(gs);
    expect(sc.page).toBe(1);
    expect(sc.title.str).toBe('SCOREBOARD - BEST 2 OF 3');
    expect(sc.hasPendingData).toBe(true);
    expect(sc.newScoreSlot).toBe(1);
    expect(gs.getPlayer(0).score.score).toBe(0); // consumed
    expect(sc.scores[0].str).toBe(scoreRow('FIRST', 'JAGUAR', 'CRYSTAL', '900,000'));
    expect(sc.scores[1].str).toBe(scoreRow('', 'SHADOW', 'MILANO', '250,000'));
    expect(sc.scores[2].str).toBe(scoreRow('LAST', 'SHADOW', 'STEFFAN', '100'));
    const run = new HeadlessRunner(gs);
    run.advance(400);
    type(gs, 'Ace Rimmer');
    expect(sc.ti!.buf).toBe('Ace Rimmer');
    gs.sc.keyEvent('Backspace', key('Backspace'));
    gs.sc.keyEvent('Backspace', key('Backspace'));
    type(gs, '~@x'); // not allowed in names, then a letter
    expect(sc.ti!.buf).toBe('Ace Rimmx');
    tap(run, 'ArrowLeft'); // caret movement goes through the menu actions
    type(gs, 'e');
    expect(sc.ti!.buf).toBe('Ace Rimmex');
    type(gs, 'ABCDEFGHIJ'); // max 14 characters
    expect(sc.ti!.buf.length).toBe(14);
    tap(run); // Enter: save
    expect(sc.hasPendingData).toBe(false);
    expect(sc.data.entries[1][1].name).toBe(sc.ti!.buf.trim());
    expect(sc.scores[1].str.startsWith('Ace Rimme')).toBe(true);
    const saved = createScoreboard();
    expect(scoresRead(saved)).toBe(0);
    expect(saved.entries[1].map((e) => e.score).slice(0, 3)).toEqual([900000, 250000, 100]);
    expect(saved.entries[1][1]).toMatchObject({ pilotId: PilotId.MILANO, harId: HarId.SHADOW });
    // then back to the scene queued by whoever opened the scoreboard
    tap(run);
    expect(gs.nextId).toBe(gs.nextNextId);
  });

  it('keeps typed spaces as text instead of confirming', () => {
    const gs = pendingGame(5000);
    gs.swapScene(SceneId.SCOREBOARD);
    const sc = board(gs);
    const run = new HeadlessRunner(gs);
    run.advance(400);
    type(gs, 'A');
    setKeyState('Space', true);
    gs.sc.keyEvent('Space', key(' ', 'Space'));
    run.advance(60);
    setKeyState('Space', false);
    run.advance(60);
    type(gs, 'B');
    expect(sc.hasPendingData).toBe(true);
    expect(sc.ti!.buf).toBe('A B');
    tap(run, 'ShiftRight'); // kick also confirms
    expect(sc.hasPendingData).toBe(false);
    expect(sc.data.entries[1][0].name).toBe('A B');
  });

  it('drops the entry when no name is given', () => {
    const gs = pendingGame(5000);
    gs.swapScene(SceneId.SCOREBOARD);
    const sc = board(gs);
    const run = new HeadlessRunner(gs);
    run.advance(400);
    type(gs, '   ');
    tap(run);
    expect(sc.hasPendingData).toBe(false);
    expect(sc.data.entries[1][0].score).toBe(0);
    expect(scoresLoadFile()).toBe(null);
  });

  it('skips name entry when the score does not make the top 20', () => {
    const sb = createScoreboard();
    for (let i = 0; i < SCORE_ENTRIES; i++) sb.entries[1][i] = { score: 100000 - i, pilotId: 0, harId: 0, name: `P${i}` };
    scoresWrite(sb);
    const gs = pendingGame(50);
    gs.swapScene(SceneId.SCOREBOARD);
    const sc = board(gs);
    expect(sc.hasPendingData).toBe(false);
    expect(sc.frame).toBe(null);
    expect(gs.getPlayer(0).score.score).toBe(0);
  });

  it('does not offer an entry outside single player', () => {
    const gs = createGame(SceneId.MENU);
    gs.getPlayer(0).score.score = 99999;
    gs.swapScene(SceneId.SCOREBOARD);
    expect(board(gs).hasPendingData).toBe(false);
    expect(gs.getPlayer(0).score.score).toBe(99999);
  });

  it('pages through the round types and leaves to the queued scene', () => {
    const gs = createGame(SceneId.MENU);
    gs.setNext(SceneId.SCOREBOARD);
    gs.nextNextId = SceneId.VS;
    const run = new HeadlessRunner(gs);
    run.advance(700);
    const sc = board(gs);
    expect(sc.page).toBe(1);
    // palette darkened to a quarter (0xEF.. untouched)
    const bkPal = sc.bk.palettes[0].colors;
    for (const i of [1, 100, 0xee]) expect(vga.base.colors[i * 3]).toBe(Math.trunc(bkPal[i * 3] * 0.25));
    expect(vga.base.colors[0xef * 3]).toBe(bkPal[0xef * 3]);
    expect(sc.title.str).toBe('SCOREBOARD - BEST 2 OF 3');
    tap(run, 'ArrowLeft');
    expect(sc.title.str).toBe('SCOREBOARD - ONE ROUND');
    tap(run, 'ArrowLeft');
    expect(sc.page).toBe(0);
    for (let i = 0; i < 5; i++) {
      tap(run, 'ArrowRight');
      run.advance(400); // menu key repeat delay
    }
    expect(sc.page).toBe(3);
    expect(sc.title.str).toBe('SCOREBOARD - BEST 4 OF 7');
    tap(run, 'Escape');
    expect(gs.nextId).toBe(SceneId.VS);
  });
});
