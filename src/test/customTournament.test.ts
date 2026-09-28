// Custom tournaments: made from an installed tournament, with fewer opponents (the champion always among them), the
// new robots and more prize money; listed with the other tournaments once registered.
import { beforeEach, describe, expect, it } from 'vitest';
import { SceneId } from '../game/constants';
import { EXTRA_HAR_IDS } from '../game/roster';
import { buildCustomTournament, customTournaments, fileNameOf, readTournamentSpec, resetCustomTournaments, setCustomTournament } from '../game/tournament/custom';
import { loadTournament } from '../resources/resources';
import { trnlistInit, trnLoad } from '../resources/trnmanager';
import { createGame, hasGameData } from './harness';

beforeEach(() => resetCustomTournaments());

describe('custom tournament files', () => {
  it('reads descriptions carefully', () => {
    expect(readTournamentSpec(42)).toBeNull();
    const s = readTournamentSpec({ name: 'grand prix!', base: 'war.trn', size: 7, robots: 2, prize: 3 })!;
    expect(s).toMatchObject({ name: 'GRAND PRIX', base: 'WAR.TRN', size: 0, robots: 2, prize: 3 });
    expect(readTournamentSpec({ base: '../x.trn' })!.base).not.toContain('..');
  });
});

describe.skipIf(!hasGameData)('custom tournaments', () => {
  it('keeps the champion and spreads the opponents over the ranks', () => {
    createGame(SceneId.MENU);
    const base = loadTournament('WORLD.TRN');
    const ranked = base.enemies.filter((p) => !p.secret);
    const t = buildCustomTournament({ v: 1, name: 'TEST CUP', base: 'WORLD.TRN', size: 0, robots: 2, prize: 3 }, 0, base);
    const mine = t.enemies.filter((p) => !p.secret);
    expect(mine.length).toBe(Math.min(6, ranked.length));
    expect(mine[0].name).toBe(ranked[0].name);
    expect(mine[mine.length - 1].name).toBe(ranked[ranked.length - 1].name);
    expect(t.enemies.filter((p) => p.secret).length).toBe(base.enemies.filter((p) => p.secret).length);
    for (const p of mine) expect(EXTRA_HAR_IDS).toContain(p.harId);
    expect(t.winningsMultiplier).toBeCloseTo(base.winningsMultiplier * 2);
    expect(t.locales[0].title).toBe('TEST CUP');
    // The base tournament is untouched.
    expect(base.enemies.filter((p) => !p.secret).map((p) => p.harId)).toEqual(ranked.map((p) => p.harId));
  });

  it('registers a stored tournament: listed and loadable like the others', () => {
    createGame(SceneId.MENU);
    expect(setCustomTournament(2, { v: 1, name: 'LOCAL LEAGUE', base: 'NORTH_AM.TRN', size: 1, robots: 1, prize: 1 })).toBe(true);
    expect(customTournaments()[2]?.name).toBe('LOCAL LEAGUE');
    const list = trnlistInit().map((t) => t.filename);
    expect(list).toContain(fileNameOf(2));
    expect(trnLoad(fileNameOf(2))?.locales[0].title).toBe('LOCAL LEAGUE');
    setCustomTournament(2, null);
    expect(trnlistInit().map((t) => t.filename)).not.toContain(fileNameOf(2));
  });
});
