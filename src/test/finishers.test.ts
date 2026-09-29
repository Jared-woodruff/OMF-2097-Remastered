// The finishing moves connect: AI fights played through their scrap and destruction (src/test/finisherPlay.ts), one
// per robot as the winner plus the situations that once broke: a robot driven into the right wall by Flail's finishers
// (reported as the left wall, it was moved across the arena), Shadow's corner walk with the beaten robot at a wall (it
// never arrived and the fight never ended), the new robots' finishers (their victim scripts never held on to the
// beaten robot).
import { describe, expect, it } from 'vitest';
import { HarId } from '../game/constants';
import { playFinish } from './finisherPlay';
import { hasGameData } from './harness';

/** [winner, loser, arena, seed] */
const FIGHTS: [number, number, number, number][] = [
  ...Array.from({ length: 15 }, (_, w): [number, number, number, number] => [w, (w + 5) % 15, w % 9, 1]),
  [HarId.FLAIL, HarId.JAGUAR, 0, 1],
  [HarId.SHADOW, HarId.KATANA, 1, 2],
  [HarId.GLACIER, HarId.JAGUAR, 1, 2],
];

describe.skipIf(!hasGameData)('finishing moves', () => {
  it.each(FIGHTS)('robot %i beats robot %i in arena %i (seed %i) and finishes it', (w, l, arena, seed) => {
    const r = playFinish(w, l, arena, seed);
    expect(r.over, 'the fight ends').toBe(true);
    expect(r.winner).toBe(0);
    expect(r.finishers.length, 'a finishing move').toBeGreaterThan(0);
    for (const f of r.finishers) {
      expect(f.caught, `${f.kind} catches the beaten robot`).toBeGreaterThanOrEqual(0);
      expect(f.maxJump, `${f.kind} keeps the beaten robot in place`).toBeLessThan(150);
      // (Shadow's shadows do the catching, from the corner it walks to first)
      if (w !== HarId.SHADOW) expect(f.minGap, `${f.kind} touches the beaten robot`).toBeLessThanOrEqual(1);
      else expect(f.winnerJump, 'Shadow walks to its corner').toBeLessThan(30);
    }
  });
});
