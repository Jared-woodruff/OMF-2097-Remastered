// Runs scenes with the sound system active. Other tests leave audio uninitialized, and then every sound is dropped
// before the mixer's channel logic runs, so bugs there (e.g. an animation forcing a channel the mixer doesn't have)
// only showed up in the real game. In Node there is no Web Audio: init() fails after loading the sounds, and the
// channel logic still runs for every sound.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { audio } from '../audio/audio';
import { SceneId } from '../game/constants';
import { getFile } from '../resources/files';
import { soundBank } from '../resources/resources';
import { globalRandom } from '../util/random';
import { createGame, hasGameData, HeadlessRunner, installBrowserShims, loadGameData } from './harness';

describe.skipIf(!hasGameData)('scenes with sound', () => {
  let played = 0;
  beforeAll(async () => {
    installBrowserShims();
    loadGameData();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await audio.init(soundBank(), (name) => getFile(name));
    const playSound = audio.playSound.bind(audio);
    vi.spyOn(audio, 'playSound').mockImplementation((id, opts) => {
      const handle = playSound(id, opts);
      if (handle) played++;
      return handle;
    });
  });

  it('plays the intro into the main menu', () => {
    const gs = createGame(SceneId.INTRO);
    const run = new HeadlessRunner(gs);
    let reachedMenu = false;
    for (let t = 0; t < 40_000 && !reachedMenu; t += 100) {
      run.advance(100);
      reachedMenu = gs.thisId === SceneId.MENU;
    }
    expect(reachedMenu).toBe(true);
    run.advance(3000);
  });

  it('plays fights in every arena', () => {
    played = 0;
    for (let arena = 0; arena < 5; arena++) {
      // Fixed seeds: the AI fights (and so the number of sounds) are the same on every run.
      globalRandom.setSeed(1000 + arena);
      const gs = createGame(SceneId.ARENA0 + arena, [arena, arena + 3], [arena * 2, 10 - arena]);
      gs.rand.setSeed(77 + arena);
      gs.arena = arena;
      gs.setupAi(0, 4);
      gs.setupAi(1, 4);
      new HeadlessRunner(gs).advance(30_000);
    }
    expect(played).toBeGreaterThan(50);
  });

  it('plays the other scenes', () => {
    for (const id of [SceneId.MENU, SceneId.MELEE, SceneId.VS, SceneId.NEWSROOM, SceneId.END, SceneId.END1, SceneId.END2, SceneId.CREDITS, SceneId.SCOREBOARD]) {
      const gs = createGame(id);
      new HeadlessRunner(gs).advance(15_000);
    }
  });
});
