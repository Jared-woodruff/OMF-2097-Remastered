// The robot workshop: a robot put together from the new robots' parts becomes a working fighter (it moves, attacks and
// lands its special moves), and robot files are read carefully.
import { beforeEach, describe, expect, it } from 'vitest';
import { harMoveList } from '../game/gui/moveList';
import { HAR_NAMES } from '../game/constants';
import { harData } from '../game/objects/har';
import { ensureWorkshopRobot, harIdOf, readyWorkshopHars, resetWorkshop, setWorkshopSpec, workshopReady } from '../game/workshop/registry';
import { defaultSpec, readSpec, scaleShape, workshopPreview, type WorkshopSpec } from '../gen/workshop';
import { ShapeKind } from '../gen/geometry';
import { genRobot } from '../gen/roster';
import { langGet } from '../resources/resources';
import { ComboSim } from './comboSim';
import { hasGameData } from './harness';

beforeEach(() => resetWorkshop());

describe('workshop files', () => {
  it('reads robot files, filling in and limiting what is wrong', () => {
    expect(readSpec(null)).toBeNull();
    expect(readSpec('robot')).toBeNull();
    const s = readSpec({ name: 'my robot!!', body: 2, head: 9, moves: -1, size: 2, weight: 0, colors: [1, 2, 99] })!;
    expect(s.name).toBe('MY ROBOT');
    expect([s.body, s.head, s.moves, s.size, s.weight]).toEqual([2, defaultSpec().head, defaultSpec().moves, 2, 0]);
    expect(s.colors).toEqual([1, 2, defaultSpec().colors[2]]);
  });

  it('scales shapes but not their proportions', () => {
    const prism = scaleShape({ kind: ShapeKind.PRISM, a: 2, b: 3, c: 0.5, r: 4, k: 6 }, 2);
    expect(prism).toEqual({ kind: ShapeKind.PRISM, a: 4, b: 6, c: 0.5, r: 8, k: 6 });
    const tbox = scaleShape({ kind: ShapeKind.TBOX, a: 1, b: 1, c: 1, r: 0.5, k: 0.7 }, 1.5);
    expect(tbox.k).toBe(0.7);
    expect(tbox.c).toBe(1.5);
  });
});

describe.skipIf(!hasGameData)('workshop robots', () => {
  it('builds a mixed robot into a fighter that lands its special moves', () => {
    const spec: WorkshopSpec = { ...defaultSpec(), name: 'MIXER', body: 0, head: 3, moves: 2, size: 2, weight: 2, colors: [1, 2, 3] };
    setWorkshopSpec(0, spec);
    const id = harIdOf(0);
    expect(workshopReady(id)).toBe(false);
    expect(ensureWorkshopRobot(0)).toBe(true);
    expect(workshopReady(id)).toBe(true);
    expect(readyWorkshopHars()).toEqual([id]);
    expect(HAR_NAMES[id]).toBe('MIXER');
    expect(genRobot(id)?.name).toBe('MIXER');
    expect(workshopPreview(spec).h).toBeGreaterThan(100);

    // Its special moves (HELIX's) land on a standing dummy from some distance, as HELIX's own do.
    const landing = (har: number) => {
      const sim = new ComboSim(har, 0);
      const af = harData(sim.gs.findObject(sim.gs.getPlayer(0).harObjId)!).afData;
      const specials = harMoveList(af).filter((e) => e.kind === 'SPECIAL')
        .map((e) => af.moves.find((m) => m && m.moveString === e.moveString && m.category === e.category)!);
      return specials.filter((move) => [40, 70, 100, 130].some((d) =>
        sim.run({ har, dummy: 0, distance: d, jump: false }, [{ move: move.id, delay: 0 }]).hits[0] >= 0)).map((m) => m.moveString);
    };
    const own = landing(13);
    expect(own.length).toBeGreaterThan(0);
    expect(landing(id)).toEqual(own);
    expect(langGet(31 + id)).toBe('Mixer');
    // Changing it means building it again.
    setWorkshopSpec(0, { ...spec, weight: 0 });
    expect(workshopReady(id)).toBe(false);
  }, 120_000);
});
