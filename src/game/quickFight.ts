// Development: a quick fight from URL parameters (?fight=0&p1=0&p2=1&h1=0&h2=5, &ai for the computer as player 2), and
// a seeded one, the same every time (for recordings: the README trailer's takes, found by src/gen/dev/trailerFights.test.ts):
// &seed=N puts the computer on both sides (at &ai=N's difficulty, ULTIMATE by default), a single round under the match
// rules' defaults with &power=a,b (6,6), &speed=n (10: the game's normal speed) and &hyper, both random generators
// seeded before the arena opens.
import { AiDifficulty, ARENA_COUNT, PILOT_INFO, SceneId } from './constants';
import type { GameState } from './gameState';
import { setPilotColors } from './pilotColors';
import { langGet } from '../resources/resources';
import { globalRandom } from '../util/random';

/** The players' pilots and robots (in their pilots' colors), and the arena to fight in. */
export function setupQuickFight(gs: GameState, params: URLSearchParams): SceneId {
  const arena = Math.max(0, Math.min(ARENA_COUNT - 1, parseInt(params.get('fight') ?? '0', 10) || 0));
  for (let i = 0; i < 2; i++) {
    const p = gs.getPlayer(i);
    const pilotId = parseInt(params.get(`p${i + 1}`) ?? String(i), 10) || 0;
    const harId = parseInt(params.get(`h${i + 1}`) ?? String(i === 0 ? 0 : 5), 10) || 0;
    const info = PILOT_INFO[pilotId];
    p.pilot.pilotId = pilotId;
    p.pilot.harId = harId;
    p.pilot.power = info.power;
    p.pilot.agility = info.agility;
    p.pilot.endurance = info.endurance;
    p.pilot.name = langGet(20 + pilotId);
    setPilotColors(p.pilot, info.color1, info.color2, info.color3);
  }
  return SceneId.ARENA0 + arena;
}

/** The seeded fight's rules, the computer on both sides and the seeds (call just before the arena opens). */
export function seedQuickFight(gs: GameState, params: URLSearchParams): void {
  const seed = parseInt(params.get('seed') ?? '1', 10) || 1;
  const [power1, power2] = (params.get('power') ?? '6,6').split(',').map((v) => parseInt(v, 10) || 6);
  gs.matchSettingsDefaults();
  gs.matchSettings.rounds = 0;
  gs.matchSettings.power1 = power1;
  gs.matchSettings.power2 = power2 ?? power1;
  gs.matchSettings.fightMode = params.has('hyper') ? 1 : 0;
  gs.setSpeed(parseFloat(params.get('speed') ?? '10') || 10);
  const ai = parseInt(params.get('ai') ?? '', 10);
  for (let i = 0; i < 2; i++) {
    gs.setupAi(i, Number.isFinite(ai) && ai > 0 ? ai : AiDifficulty.ULTIMATE);
    gs.getPlayer(i).score.reset(true);
  }
  globalRandom.setSeed(seed);
  gs.rand.setSeed(seed * 7 + 3);
}
