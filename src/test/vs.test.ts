import { afterEach, describe, expect, it } from 'vitest';
import { setKeyState } from '../controller/input';
import type { Pilot } from '../formats/pilot';
import { CtrlType, HarId, ORIGINAL_HAR_TYPES, PilotId, SceneId } from '../game/constants';
import type { GameState } from '../game/gameState';
import { settings } from '../game/settings';
import type { ChrFile } from '../game/tournament/chr';
import { PLUG_WIN_BIG, playerPilot, type VsScene } from '../game/scenes/vs';
import { langGet, loadBk, loadPic } from '../resources/resources';
import { drawList } from '../video/draw';
import { createGame, hasGameData, HeadlessRunner, loadExtras } from './harness';
import { resetMods } from '../mods/registry';
import { arenaList, EXTRA_HAR_IDS, randomHarPool } from '../game/roster';
import { globalRandom } from '../util/random';

const lang = (id: number) => langGet(id).replace(/\n$/, '');
const held = new Set<string>();

function press(run: HeadlessRunner, code: string): void {
  setKeyState(code, true);
  held.add(code);
  run.advance(60);
  setKeyState(code, false);
  held.delete(code);
  run.advance(60);
}

function waitScene(run: HeadlessRunner, id: SceneId, maxMs = 4000): void {
  for (let t = 0; t < maxMs && run.gs.thisId !== id; t += 50) run.advance(50);
}

/** Opens the VS scene after `setup` configured the players (starting from the melee scene, which we own). */
function openVs(setup: (gs: GameState) => void): { gs: GameState; run: HeadlessRunner; vs: VsScene } {
  const gs = createGame(SceneId.MELEE);
  setup(gs);
  gs.swapScene(SceneId.VS);
  const run = new HeadlessRunner(gs);
  run.advance(400); // input is ignored for the first 25 static ticks
  return { gs, run, vs: gs.sc as VsScene };
}

function renderCount(gs: GameState): number {
  drawList.begin();
  gs.render();
  return drawList.count;
}

function fakeChr(pilot: Pilot, photo: ChrFile['photo']): ChrFile {
  return {
    pilot, pal: pilot.palette, unknownB: 0, photo, winningsMultiplier: 1, enemies: [], bkName: '', tournamentId: 0, cutsceneText: [],
  };
}

afterEach(() => {
  for (const k of held) setKeyState(k, false);
  held.clear();
  settings().gameplay.difficulty = 1;
});

describe.skipIf(!hasGameData)('vs (headless)', () => {
  it('demo mode: random pilots and arena, the CPU starts the fight', () => {
    const { gs, run, vs } = openVs((g) => g.initDemo());
    expect(gs.isDemoplay()).toBe(true);
    for (let i = 0; i < 2; i++) {
      const p = gs.getPlayer(i).pilot;
      expect(p.pilotId).toBeLessThan(10);
      expect(randomHarPool(true)).toContain(p.harId);
      expect(gs.getPlayer(i).ctrl.type).toBe(CtrlType.AI);
    }
    expect(gs.arena).toBeGreaterThanOrEqual(0);
    expect(gs.arena).toBeLessThan(arenaList().length);
    expect(vs.arenaName).toBeNull(); // nobody chooses the arena
    expect(renderCount(gs)).toBeGreaterThan(10);
    const arena = SceneId.ARENA0 + gs.arena;
    run.advance(1500);
    expect(gs.thisId).toBe(SceneId.VS);
    // the AI controller presses PUNCH every 256 static ticks on the VS screen
    waitScene(run, arena, 3000);
    expect(gs.thisId).toBe(arena);
  });

  it('demo mode: escape returns to the main menu', () => {
    const { gs, run } = openVs((g) => g.initDemo());
    press(run, 'Escape');
    expect(gs.nextId).toBe(SceneId.MENU);
  });

  it('one player vs Kreissack on a low difficulty shows the "too pathetic" dialog', () => {
    settings().gameplay.difficulty = 1;
    const { gs, run, vs } = openVs((g) => {
      g.setupAi(1);
      const p2 = g.getPlayer(1).pilot;
      p2.pilotId = PilotId.KREISSACK;
      p2.harId = HarId.NOVA;
      p2.name = lang(30);
      g.arena = 3;
    });
    expect(gs.arena).toBe(0); // forced for Kreissack
    expect(vs.tooPatheticDialog.isVisible()).toBe(true);
    expect(vs.insults[1]!.str).toBe(lang(747));
    expect(vs.vsText!.str).toBe(`${lang(20)} VS. ${lang(30)}`);
    expect(renderCount(gs)).toBeGreaterThan(10);
    press(run, 'Enter');
    expect(gs.nextId).toBe(SceneId.SCOREBOARD);
  });

  it('one player vs Kreissack on Veteran fights in the first arena', () => {
    settings().gameplay.difficulty = 2;
    const { gs, run, vs } = openVs((g) => {
      g.setupAi(1);
      const p2 = g.getPlayer(1).pilot;
      p2.pilotId = PilotId.KREISSACK;
      p2.harId = HarId.NOVA;
      g.arena = 2;
    });
    expect(vs.tooPatheticDialog.isVisible()).toBe(false);
    expect(vs.insults[0]!.str).toBe(lang(749 + 11 * 0 + PilotId.KREISSACK));
    expect(vs.insults[1]!.str).toBe(lang(870 + 11 * PilotId.KREISSACK + 0));
    press(run, 'Enter');
    expect(gs.nextId).toBe(SceneId.ARENA0);
  });

  it('one player: the arena rotation is kept and escape asks before abandoning a campaign', () => {
    const { gs, run, vs } = openVs((g) => {
      g.setupAi(1);
      g.arena = 3;
      g.getPlayer(0).spWins = 2 << PilotId.SHIRRO;
    });
    expect(gs.arena).toBe(3);
    press(run, 'Escape');
    expect(vs.quitDialog.isVisible()).toBe(true);
    press(run, 'ArrowRight'); // NO
    press(run, 'Enter');
    expect(vs.quitDialog.isVisible()).toBe(false);
    expect(gs.nextId).toBe(SceneId.VS);
    press(run, 'Escape');
    expect(vs.quitDialog.isVisible()).toBe(true);
    press(run, 'ArrowLeft'); // YES
    press(run, 'Enter');
    expect(gs.nextId).toBe(SceneId.MELEE);
  });

  it('one player: escape on the quit dialog activates its selected button (reference menu behavior)', () => {
    const { gs, run, vs } = openVs((g) => {
      g.setupAi(1);
      g.getPlayer(0).spWins = 2 << PilotId.SHIRRO;
    });
    press(run, 'Escape');
    expect(vs.quitDialog.isVisible()).toBe(true);
    press(run, 'Escape');
    expect(vs.quitDialog.isVisible()).toBe(false);
    expect(gs.nextId).toBe(SceneId.MELEE);
  });

  it('one player without wins: escape goes straight back to the melee', () => {
    const { gs, run } = openVs((g) => g.setupAi(1));
    press(run, 'Escape');
    expect(gs.nextId).toBe(SceneId.MELEE);
  });

  it('mirrors the background for the second gantry without touching the shared BK data', () => {
    const pristine = loadBk('VS.BK').background.data.slice();
    const { vs } = openVs(() => undefined);
    const bg = vs.bk.background;
    for (const [x, y] of [[0, 0], [37, 50], [159, 199], [100, 120]]) {
      expect(bg.getPixel(319 - x, y)).toBe(bg.getPixel(x, y));
    }
    expect(Array.from(loadBk('VS.BK').background.data)).toEqual(Array.from(pristine));
  });

  it('tournament plug screen: report card, trades and exits', () => {
    const { gs, run, vs } = openVs((g) => {
      const p1 = g.getPlayer(0);
      p1.pilot.harId = HarId.PYROS;
      p1.pilot.money = 30000;
      p1.pilot.armPower = 3;
      p1.chr = fakeChr(p1.pilot, null);
      (g.getPlayer(1) as unknown as { pilot: Pilot | null }).pilot = null;
      Object.assign(g.fightStats, {
        winner: 0, plugText: PLUG_WIN_BIG, sold: '', winnings: 20000, bonuses: 5300, repairCost: 1200, profit: 24100, hp: 40, maxHp: 100,
        hitsLanded: [12, 7], averageDamage: [5.25, 3.35], totalAttacks: [20, 15], hitMissRatio: [60, 46], challenger: null,
      });
    });
    const p1 = gs.getPlayer(0).pilot;
    expect(vs.vsText).toBeNull();
    const card = vs.report!;
    expect(card.plugWhine.str).toBe(lang(587 + PLUG_WIN_BIG));
    expect(card.reportRight.str).toBe('$ 20,000K\n$ 5,300K\n$ 1,200K\n$ 24,100K');
    expect(card.statsSelfRight.str).toBe('12\n5.2\n8\n60%'); // %.1f rounds the exact 5.25 to even
    expect(card.opponentRight.str).toBe('7\n3.3\n8\n46%');
    // up to 5 affordable trades, never the current HAR
    const trades = p1.harTrades;
    expect(trades & (1 << HarId.PYROS)).toBe(0);
    let bits = 0;
    for (let i = 0; i < 11; i++) if (trades & (1 << i)) bits++;
    expect(bits).toBe(5);
    expect(trades & (1 << HarId.NOVA)).toBe(0); // 75000 is not affordable
    // the scraped HAR sprite is a private copy
    const fresh = loadBk('VS.BK').infos.get(5)!.ani.sprites[HarId.PYROS].surface!;
    const own = vs.bk.infos.get(5)!.ani.sprites[HarId.PYROS].surface!;
    expect(own).not.toBe(fresh);
    expect(Array.from(own.data)).not.toEqual(Array.from(fresh.data));
    expect(renderCount(gs)).toBeGreaterThan(20);
    press(run, 'Enter');
    expect(gs.nextId).toBe(SceneId.MECHLAB);
    expect(playerPilot(gs.getPlayer(1))).toBeNull();
  });

  it('Plug offers the remaster\'s robots only when their mod is on', async () => {
    const offers = (): number => {
      let all = 0;
      for (let seed = 1; seed <= 12; seed++) {
        globalRandom.setSeed(seed);
        const { gs } = openVs((g) => {
          const p1 = g.getPlayer(0);
          p1.pilot.money = 60000;
          p1.chr = fakeChr(p1.pilot, null);
          (g.getPlayer(1) as unknown as { pilot: Pilot | null }).pilot = null;
        });
        const trades = gs.getPlayer(0).pilot.harTrades;
        expect(trades & (1 << HarId.JAGUAR)).toBe(0);
        all |= trades;
      }
      return all;
    };
    try {
      expect(offers() >>> ORIGINAL_HAR_TYPES).toBe(0);
      await loadExtras();
      const all = offers();
      expect(all >>> 15).toBe(0);
      expect(EXTRA_HAR_IDS.some((id) => all & (1 << id))).toBe(true);
    } finally {
      resetMods();
    }
  });

  it('tournament plug screen goes to the newsroom when a challenger waits', () => {
    const { gs, run } = openVs((g) => {
      const p1 = g.getPlayer(0);
      p1.chr = fakeChr(p1.pilot, null);
      g.fightStats.challenger = g.getPlayer(1).pilot;
      (g.getPlayer(1) as unknown as { pilot: Pilot | null }).pilot = null;
    });
    press(run, 'Enter');
    expect(gs.nextId).toBe(SceneId.NEWSROOM);
    gs.fightStats.challenger = null;
  });

  it('tournament match: photos, the opponent quote, random arena; escape cancels the match', () => {
    const photos = loadPic('PLAYERS.PIC');
    const { gs, run, vs } = openVs((g) => {
      const p1 = g.getPlayer(0);
      const p2 = g.getPlayer(1);
      g.setupAi(1);
      p1.chr = fakeChr(p1.pilot, photos[0].sprite);
      p2.pilot.photo = photos[3].sprite;
      p2.pilot.quotes[0] = 'You will not leave this arena in one piece.';
    });
    expect(gs.isTournament()).toBe(true);
    expect(vs.insults[0]).toBeNull();
    expect(vs.insults[1]!.str).toBe('You will not leave this arena in one piece.');
    const portraits = gs.findObjects((o) => o.curAnimation?.id === -1);
    expect(portraits.length).toBe(2);
    expect(portraits[0].curAnimation!.sprites[0].surface!.w).toBe(photos[0].sprite.width);
    expect(renderCount(gs)).toBeGreaterThan(10);
    press(run, 'Escape');
    expect(gs.fightStats.winner).toBe(-1);
    expect(playerPilot(gs.getPlayer(1))).toBeNull();
    expect(gs.nextId).toBe(SceneId.MECHLAB);
  });
});
