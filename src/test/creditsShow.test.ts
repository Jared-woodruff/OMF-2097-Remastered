// The credits' show on its song (src/game/credits): the song's grid, and a headless run on the credits' own time (as
// without audio) checking the timetable: VS cards on downbeats, final blows landing on their half bar, cuts on downbeats,
// every fight's stored ticks, and the end titles' cut to the song's ending and their end.
import { describe, expect, it } from 'vitest';
import { SceneId } from '../game/constants';
import { CREDIT_BATTLES, CREDITS_RULES } from '../game/credits/battles';
import { CreditsRun, FINALE_MIN_BARS, TITLE_END_BAR } from '../game/credits/creditsRun';
import { barAt, barTime, BEAT, ENDING_BAR, nextBar, SECTIONS, SONG_LENGTH } from '../game/credits/song';
import { createGame, hasGameData, HeadlessRunner } from './harness';

const onGrid = (x: number, step: number) => Math.abs(x / step - Math.round(x / step)) < 1e-3;

describe('the credits song', () => {
  it('has its final hit on bar 168, inside the song, and bars that go back and forth', () => {
    expect(barTime(SECTIONS.finalHit)).toBeCloseTo(293.09, 1);
    expect(barTime(SECTIONS.finalHit)).toBeLessThan(SONG_LENGTH);
    expect(barTime(SECTIONS.drop)).toBeCloseTo(28.71, 1);
    for (const k of [0, 16, 20.5, 152]) expect(barAt(barTime(k))).toBeCloseTo(k, 6);
    expect(barTime(1) - barTime(0)).toBeCloseTo(4 * BEAT, 9);
    expect(nextBar(barTime(20))).toBe(20);
    expect(nextBar(barTime(20) + 0.01)).toBe(21);
  });
});

describe.skipIf(!hasGameData)('the credits show (headless, on its own time)', () => {
  it('lands every VS card on a downbeat and every final blow on its beat, and cuts on downbeats', () => {
    const gs = createGame(SceneId.MENU);
    const run = new CreditsRun(gs);
    gs.credits = run;
    run.begin();
    const runner = new HeadlessRunner(gs);
    const blows: number[] = CREDIT_BATTLES.map(() => -1);
    const opened: number[] = CREDIT_BATTLES.map(() => -1);
    let ticks = 0, prevTick = gs.intTick, fight = -1;
    for (let ms = 0; ms < 400_000 && run.phase !== 'finale'; ms += 10) {
      runner.advance(10);
      const d = gs.intTick - prevTick;
      prevTick = gs.intTick;
      if (run.fighting !== fight) {
        fight = run.fighting;
        ticks = 0;
      }
      if (fight < 0) continue;
      if (opened[fight] < 0 && !gs.paused) opened[fight] = run.clock.time;
      ticks += d > 0 && !gs.paused ? d : 0;
      // (the final blow: the game's slow motion on it)
      if (blows[fight] < 0 && gs.speed < CREDITS_RULES.speed - 1) {
        blows[fight] = run.clock.time;
        expect(ticks).toBe(CREDIT_BATTLES[fight].blow);
      }
    }
    expect(run.phase).toBe('finale');
    expect(run.fights[0]!.vs).toBeCloseTo(barTime(TITLE_END_BAR), 6);
    run.fights.forEach((f, i) => {
      expect(f).not.toBeNull();
      expect(onGrid(barAt(f!.vs), 1)).toBe(true);
      expect(onGrid(barAt(f!.blow), 0.5)).toBe(true);
      expect(onGrid(barAt(f!.cut), 1)).toBe(true);
      expect(f!.go).toBeGreaterThan(f!.vs);
      expect(opened[i]).toBeCloseTo(f!.go, 1);
      // (the blow lands on its beat: within a tick or two)
      expect(Math.abs(blows[i] - f!.blow)).toBeLessThan(0.045);
      expect(f!.cut).toBeGreaterThan(f!.blow + 5);
      if (i > 0) expect(f!.vs).toBeGreaterThanOrEqual(run.fights[i - 1]!.cut);
    });
  }, 120_000);

  it('cut the end titles to the song ending on a downbeat, finish after its final hit and go back to EXTRAS', () => {
    const gs = createGame(SceneId.MENU);
    const run = new CreditsRun(gs, CREDIT_BATTLES.length + 1);
    gs.credits = run;
    run.begin();
    const runner = new HeadlessRunner(gs);
    runner.advance(500);
    expect(run.phase).toBe('finale');
    const f = run.finale!;
    expect(f.jumpBar % 4).toBe(0);
    expect(f.jumpBar).toBeGreaterThanOrEqual(Math.round(barAt(f.start)) + FINALE_MIN_BARS);
    // (the credits' own time jumps to the ending's bar on the cut)
    let jumped = -1;
    for (let ms = 0; ms < 120_000 && gs.credits === run; ms += 10) {
      const before = run.clock.time;
      runner.advance(10);
      if (jumped < 0 && run.clock.time - before > 1) jumped = before;
    }
    expect(jumped).toBeCloseTo(f.jump, 1);
    expect(gs.thisId).toBe(SceneId.MENU);
    expect(gs.credits).toBeNull();
  }, 120_000);

  it('skip the title to the drop, then to the fights on the next downbeat', () => {
    const gs = createGame(SceneId.MENU);
    const run = new CreditsRun(gs);
    gs.credits = run;
    run.begin();
    const runner = new HeadlessRunner(gs);
    runner.advance(2000);
    run.skip();
    expect(run.clock.time).toBeCloseTo(barTime(SECTIONS.drop) - 0.25, 3);
    runner.advance(500);
    run.skip();
    expect(onGrid(barAt(run.titleEnd), 1)).toBe(true);
    expect(run.titleEnd).toBeLessThan(barTime(TITLE_END_BAR));
    runner.advance(3000);
    expect(run.phase).toBe('fights');
    expect(run.fights[0]!.vs).toBeCloseTo(run.titleEnd, 6);
    expect(barTime(ENDING_BAR)).toBeGreaterThan(run.titleEnd);
  });
});
