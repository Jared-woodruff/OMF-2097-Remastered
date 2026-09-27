import { describe, expect, it } from 'vitest';
import { setKeyState } from '../controller/input';
import { RENDER_LAYER_TOP, SceneId } from '../game/constants';
import { IntroScene } from '../game/scenes/intro';
import { drawList } from '../video/draw';
import { createGame, hasGameData, HeadlessRunner } from './harness';

function tap(run: HeadlessRunner, code: string): void {
  setKeyState(code, true);
  run.advance(60);
  setKeyState(code, false);
  run.advance(60);
}

describe.skipIf(!hasGameData)('intro (headless)', () => {
  it('plays the INTRO.BK sequence and ends in the main menu', () => {
    const gs = createGame(SceneId.MENU);
    gs.swapScene(SceneId.INTRO);
    expect(gs.sc).toBeInstanceOf(IntroScene);
    // Only animation 25 is started, on the top layer; it spawns the rest of the sequence.
    expect(gs.objects.map((r) => r.obj.curAnimation?.id)).toEqual([25]);
    expect(gs.objects[0].layer).toBe(RENDER_LAYER_TOP);
    const sounds: [number, number][] = [];
    const music: [number, string][] = [];
    let ms = 0;
    gs.playSound = (id) => void sounds.push([ms, id]);
    gs.playMusic = (name) => void music.push([ms, name]);
    const run = new HeadlessRunner(gs);
    const seen = new Set<number>();
    for (; ms < 24000; ms += 500) {
      run.advance(500);
      for (const r of gs.objects) if (r.obj.curAnimation) seen.add(r.obj.curAnimation.id);
      expect(gs.thisId).toBe(SceneId.INTRO);
    }
    // Logos (5, 6), the OMF logo (15), the 2097 digits (11..14) and their sparks/bolts (16, 17).
    for (const id of [5, 6, 11, 12, 13, 14, 15, 16, 17]) expect(seen.has(id)).toBe(true);
    // Sound effects from the animation strings (s1 -> sound translation table -> sound id), and the menu music
    // started by the last "2097" digit (smo2) roughly 12 seconds in.
    expect(sounds.length).toBeGreaterThanOrEqual(7);
    expect(new Set(sounds.map(([, id]) => id))).toContain(gs.sc.bk.soundTranslationTable[1] - 1);
    expect(music.map(([, name]) => name)).toEqual(['MENU.PSM']);
    expect(music[0][0]).toBeGreaterThan(10000);
    expect(music[0][0]).toBeLessThan(15000);
    expect(drawList.count).toBeGreaterThan(1);
    // 2500 dynamic ticks (10 ms each) -> main menu.
    run.advance(1200);
    expect(gs.nextId).toBe(SceneId.MENU);
    expect((gs.sc as IntroScene).ticks).toBeGreaterThan(2500);
  });

  it('is skipped with punch / kick / escape', () => {
    for (const key of ['Enter', 'ShiftRight', 'Escape']) {
      const gs = createGame(SceneId.MENU);
      gs.swapScene(SceneId.INTRO);
      const run = new HeadlessRunner(gs);
      run.advance(1000);
      tap(run, key);
      expect(gs.nextId).toBe(SceneId.MENU);
      expect((gs.sc as IntroScene).ticks).toBeLessThan(200);
    }
  });

  it('ignores other keys', () => {
    const gs = createGame(SceneId.MENU);
    gs.swapScene(SceneId.INTRO);
    const run = new HeadlessRunner(gs);
    run.advance(1000);
    tap(run, 'ArrowUp');
    tap(run, 'ArrowLeft');
    run.advance(500);
    expect(gs.nextId).toBe(SceneId.INTRO);
  });
});
