import { afterEach, describe, expect, it } from 'vitest';
import { setKeyState } from '../controller/input';
import { ACT_DOWN, ACT_KICK, ACT_LEFT, ACT_PUNCH, ACT_RIGHT, ACT_STOP, ACT_UP, HarId, PILOT_INFO, PilotId, SceneId } from '../game/constants';
import type { GameState } from '../game/gameState';
import type { MeleeScene } from '../game/scenes/melee';
import type { VsScene } from '../game/scenes/vs';
import { langGet, loadBk } from '../resources/resources';
import { drawList } from '../video/draw';
import { vga } from '../video/vga';
import { createGame, hasGameData, HeadlessRunner } from './harness';

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

/** A game sitting on a fresh pilot-select melee screen (names cleared like the main menu does). */
function startMelee(onePlayer: boolean): { gs: GameState; run: HeadlessRunner; sc: MeleeScene } {
  const gs = createGame(SceneId.MELEE);
  if (onePlayer) gs.setupAi(1);
  gs.getPlayer(0).pilot.name = '';
  gs.getPlayer(1).pilot.name = '';
  gs.swapScene(SceneId.MELEE);
  const run = new HeadlessRunner(gs);
  run.advance(400); // scenes ignore input for their first 25 static ticks
  return { gs, run, sc: gs.sc as MeleeScene };
}

/** Advances until the scene changes (or the time runs out). */
function waitScene(run: HeadlessRunner, id: SceneId, maxMs = 2000): void {
  for (let t = 0; t < maxMs && run.gs.thisId !== id; t += 50) run.advance(50);
}

afterEach(() => {
  for (const k of held) setKeyState(k, false);
  held.clear();
});

describe.skipIf(!hasGameData)('melee (headless)', () => {
  it('one player: picks pilot and HAR, rolls a CPU opponent, VS, then the arena', () => {
    const { gs, run, sc } = startMelee(true);
    expect(sc.page).toBe(0);
    expect(gs.getPlayer(0).pilot.power).toBe(PILOT_INFO[PilotId.CRYSTAL].power);

    press(run, 'ArrowRight'); // Steffan
    expect(sc.cursorIndex(0)).toBe(1);
    expect(sc.pilotIdA).toBe(PilotId.STEFFAN);
    expect(gs.getPlayer(0).pilot.power).toBe(PILOT_INFO[PilotId.STEFFAN].power);
    expect(gs.getPlayer(0).pilot.agility).toBe(PILOT_INFO[PilotId.STEFFAN].agility);
    expect(sc.barStat[0][0].percentage).toBe((PILOT_INFO[PilotId.STEFFAN].power * 100) / 20);

    press(run, 'Enter');
    expect(sc.page).toBe(1); // HAR select, cursor stays on the same grid slot
    expect(gs.getPlayer(0).pilot.color1).toBe(PILOT_INFO[PilotId.STEFFAN].color1);
    // player 1 HAR colors are loaded into palette indices 1..47
    expect(Array.from(vga.base.colors.subarray(3, 3 * 48))).toEqual(Array.from(gs.getPlayer(0).pilot.palette.colors.subarray(3, 3 * 48)));

    press(run, 'ArrowDown'); // row 1, column 1 = Shredder
    expect(sc.har[0].curAnimation!.id).toBe(18 + HarId.SHREDDER);
    expect(sc.harTitle.str).toBe('SHREDDER');
    run.advance(500); // HAR preview animates
    press(run, 'Enter');
    expect(gs.nextId).toBe(SceneId.VS);

    const p1 = gs.getPlayer(0).pilot;
    const p2 = gs.getPlayer(1).pilot;
    expect(p1.pilotId).toBe(PilotId.STEFFAN);
    expect(p1.harId).toBe(HarId.SHREDDER);
    expect(p1.name).toBe('Steffan');
    expect(p2.pilotId).not.toBe(PilotId.STEFFAN);
    expect(p2.pilotId).toBeGreaterThanOrEqual(0);
    expect(p2.pilotId).toBeLessThan(10);
    expect(p2.harId).toBeGreaterThanOrEqual(0);
    expect(p2.harId).toBeLessThan(10);
    expect(p2.name).toBe(lang(20 + p2.pilotId));
    expect(p2.color1).toBe(PILOT_INFO[p2.pilotId].color1);

    waitScene(run, SceneId.VS);
    expect(gs.thisId).toBe(SceneId.VS);
    const vs = gs.sc as VsScene;
    expect(vs.vsText!.str).toBe(`Steffan VS. ${lang(20 + p2.pilotId)}`);
    expect(vs.insults[0]!.str).toBe(lang(749 + 11 * p1.pilotId + p2.pilotId));
    expect(vs.insults[1]!.str).toBe(lang(870 + 11 * p2.pilotId + p1.pilotId));
    expect(gs.arena).toBe(0); // 1 player mode cycles through the arenas; nothing chosen here
    run.advance(400);
    press(run, 'ArrowRight'); // arena selection is two-player only
    expect(gs.arena).toBe(0);
    press(run, 'Enter');
    waitScene(run, SceneId.ARENA0);
    expect(gs.thisId).toBe(SceneId.ARENA0);
  });

  it('two players: both choose pilots and HARs, player 1 picks the arena', () => {
    const { gs, run, sc } = startMelee(false);
    expect(sc.page).toBe(0);
    expect(sc.cursorIndex(1)).toBe(PilotId.SHIRRO);

    press(run, 'ArrowRight'); // P1 -> Steffan
    press(run, 'KeyA'); // P2 -> Christian
    expect(sc.pilotIdB).toBe(PilotId.CHRISTIAN);
    expect(sc.playerName[1].str).toBe(lang(20 + PilotId.CHRISTIAN));
    expect(gs.getPlayer(1).pilot.endurance).toBe(PILOT_INFO[PilotId.CHRISTIAN].endurance);
    press(run, 'Enter');
    expect(sc.page).toBe(0); // waits for player 2
    expect(sc.cursor[0].done).toBe(true);
    press(run, 'ArrowLeft'); // ignored once done
    expect(sc.cursorIndex(0)).toBe(1);
    press(run, 'KeyF');
    expect(sc.page).toBe(1);
    expect(sc.harTitle.str).toBe('SHADOW VS. PYROS');
    expect(sc.har[1].palOffset).toBe(48);

    press(run, 'KeyD'); // P2 -> Electra
    expect(sc.harTitle.str).toBe('SHADOW VS. ELECTRA');
    press(run, 'KeyF');
    press(run, 'Enter');
    expect(gs.nextId).toBe(SceneId.VS);
    const p1 = gs.getPlayer(0).pilot;
    const p2 = gs.getPlayer(1).pilot;
    expect([p1.pilotId, p1.harId, p2.pilotId, p2.harId]).toEqual([PilotId.STEFFAN, HarId.SHADOW, PilotId.CHRISTIAN, HarId.ELECTRA]);
    expect([p1.name, p2.name]).toEqual(['Steffan', 'Christian']);

    waitScene(run, SceneId.VS);
    const vs = gs.sc as VsScene;
    expect(gs.arena).toBe(0);
    expect(vs.arenaName!.str).toBe(lang(56));
    run.advance(400);
    press(run, 'ArrowRight');
    press(run, 'ArrowRight');
    press(run, 'ArrowLeft');
    expect(gs.arena).toBe(1);
    expect(gs.findObject(vs.arenaSelectObjId)!.curSpriteId).toBe(1);
    expect(vs.arenaName!.str).toBe(lang(57));
    expect(vs.arenaDesc!.str).toBe(lang(67));
    press(run, 'ArrowLeft');
    press(run, 'ArrowLeft');
    expect(gs.arena).toBe(4); // wraps
    press(run, 'ArrowRight');
    expect(gs.arena).toBe(0);
    press(run, 'ArrowRight');
    press(run, 'Enter');
    waitScene(run, SceneId.ARENA1);
    expect(gs.thisId).toBe(SceneId.ARENA1);
  });

  it('returns from VS to the HAR page with the chosen HARs selected', () => {
    const { gs, run } = startMelee(false);
    press(run, 'Enter');
    press(run, 'KeyF');
    press(run, 'ArrowDown'); // P1 -> row 1 col 0 = Katana
    press(run, 'Enter');
    press(run, 'KeyF');
    waitScene(run, SceneId.VS);
    run.advance(400);
    press(run, 'Escape');
    waitScene(run, SceneId.MELEE);
    expect(gs.thisId).toBe(SceneId.MELEE);
    const sc = gs.sc as MeleeScene;
    expect(sc.page).toBe(1);
    expect(sc.cursorIndex(0)).toBe(HarId.KATANA);
    expect(sc.cursorIndex(1)).toBe(PilotId.SHIRRO); // P2 kept HAR 4 (same slot as its pilot)
    expect(sc.pilotIdA).toBe(PilotId.CRYSTAL);
    run.advance(400);
    press(run, 'Escape'); // back to the pilot page
    expect(sc.page).toBe(0);
    expect(sc.cursorIndex(0)).toBe(PilotId.CRYSTAL);
    press(run, 'Escape');
    expect(gs.nextId).toBe(SceneId.MENU);
  });

  it('faces Kreissack after beating everyone else', () => {
    const { gs, run, sc } = startMelee(true);
    press(run, 'Enter'); // Crystal
    gs.getPlayer(0).spWins = 2046 ^ (2 << PilotId.CRYSTAL);
    press(run, 'Enter');
    const p2 = gs.getPlayer(1).pilot;
    expect(p2.pilotId).toBe(PilotId.KREISSACK);
    expect(p2.harId).toBe(HarId.NOVA);
    expect(p2.name).toBe(lang(30));
    expect(sc.pilotIdB).toBe(PilotId.KREISSACK);
  });

  it('only picks opponents that were not beaten yet', () => {
    for (let n = 0; n < 5; n++) {
      const { gs, run } = startMelee(true);
      press(run, 'Enter'); // Crystal
      const beaten = (2 << 1) | (2 << 2) | (2 << 3) | (2 << 5) | (2 << 6) | (2 << 7) | (2 << 9);
      gs.getPlayer(0).spWins = beaten;
      press(run, 'Enter');
      expect([PilotId.SHIRRO, PilotId.COSSETTE]).toContain(gs.getPlayer(1).pilot.pilotId);
    }
  });

  it('pilot stat cheat and NOVA selection cheat', () => {
    const { gs, run, sc } = startMelee(false);
    const p = gs.getPlayer(0).pilot;
    // wrap around both rows while visiting every pilot
    for (let i = 0; i < 5; i++) sc.handleAction(0, ACT_RIGHT);
    sc.handleAction(0, ACT_DOWN);
    for (let i = 0; i < 5; i++) sc.handleAction(0, ACT_RIGHT);
    expect(sc.cheatPilotStats[0]).toBe(3);
    expect(sc.cursorIndex(0)).toBe(5);
    const total = p.power + p.agility + p.endurance;
    sc.handleAction(0, ACT_KICK); // enables the cheat and highlights POWER instead of confirming
    expect(sc.cursor[0].done).toBe(false);
    expect(sc.barStat[0][0].highlight).toBe(true);
    const power = p.power;
    sc.handleAction(0, ACT_KICK | ACT_RIGHT);
    expect(p.power).toBe(power + 2);
    expect(p.power + p.agility + p.endurance).toBe(total);
    sc.handleAction(0, ACT_KICK | ACT_DOWN); // select AGILITY
    expect(sc.cheatPilotStatsStat[0]).toBe(1);
    sc.handleAction(0, ACT_KICK | ACT_LEFT);
    expect(p.power + p.agility + p.endurance).toBe(total);
    sc.handleAction(0, ACT_STOP);
    expect(sc.barStat[0][1].highlight).toBe(false);
    sc.handleAction(0, ACT_KICK | ACT_UP);
    expect(sc.cheatPilotStatsStat[0]).toBe(0);

    // NOVA: press down 11 times on Katana's slot, having visited every HAR slot
    sc.handleAction(0, ACT_PUNCH);
    sc.handleAction(1, ACT_PUNCH);
    expect(sc.page).toBe(1);
    sc.handleAction(0, ACT_UP);
    for (let i = 0; i < 5; i++) sc.handleAction(0, ACT_RIGHT);
    sc.handleAction(0, ACT_DOWN);
    for (let i = 0; i < 5; i++) sc.handleAction(0, ACT_RIGHT);
    for (let i = 0; i < 11; i++) sc.handleAction(0, ACT_DOWN);
    expect(sc.katanaDownCount[0]).toBe(11);
    sc.handleAction(0, ACT_RIGHT);
    sc.handleAction(0, ACT_RIGHT); // Flail's slot selects NOVA
    sc.handleAction(0, ACT_PUNCH);
    sc.handleAction(1, ACT_PUNCH);
    expect(gs.getPlayer(0).pilot.harId).toBe(HarId.NOVA);
    expect(gs.getPlayer(1).pilot.harId).toBe(PilotId.SHIRRO);
    run.advance(100);
  });

  it('color cheat: keys 1-6 cycle the HAR colors on the HAR page', () => {
    const { gs, sc } = startMelee(false);
    const key = (code: string) => sc.keyEvent(code, { type: 'keydown', code } as KeyboardEvent);
    const p1 = gs.getPlayer(0).pilot;
    const p2 = gs.getPlayer(1).pilot;
    const before = p1.color3;
    key('Digit1'); // ignored on the pilot page
    expect(p1.color3).toBe(before);
    sc.handleAction(0, ACT_PUNCH);
    sc.handleAction(1, ACT_PUNCH);
    expect(sc.page).toBe(1);
    const c3 = p1.color3;
    key('Digit1'); // player 1 tertiary
    expect(p1.color3).toBe((c3 + 1) % 16);
    key('Digit3'); // player 1 primary
    expect(p1.color1).toBe((PILOT_INFO[PilotId.CRYSTAL].color1 + 1) % 16);
    key('Digit5'); // player 2 secondary
    expect(p2.color2).toBe((PILOT_INFO[PilotId.SHIRRO].color2 + 1) % 16);
    // loaded into player 2's slot of the live palette (indices 49..95)
    expect(Array.from(vga.base.colors.subarray(49 * 3, 96 * 3))).toEqual(Array.from(p2.palette.colors.subarray(3, 48 * 3)));
  });

  it('renders both pages', () => {
    const { gs, run, sc } = startMelee(false);
    drawList.begin();
    gs.render();
    const pilotPage = drawList.count;
    expect(pilotPage).toBeGreaterThan(30);
    press(run, 'Enter');
    press(run, 'KeyF');
    expect(sc.page).toBe(1);
    run.advance(300);
    drawList.begin();
    gs.render();
    expect(drawList.count).toBeGreaterThan(10);
    // the grayscale HAR sheet and the dimmed palette must not leak into the BK data shared with later loads
    const fresh = loadBk('MELEE.BK');
    const sheet = fresh.infos.get(1)!.ani.sprites[0].surface!.data;
    expect(sheet.some((v) => v > 0 && v < 0x60)).toBe(true);
    const own = sc.bk.infos.get(1)!.ani.sprites[0].surface!.data;
    expect(own.some((v) => v > 0 && v < 0x60)).toBe(false);
    const range = (c: Uint8Array) => Array.from(c.subarray(3, 3 * 0x60));
    expect(range(fresh.palettes[0].colors)).not.toEqual(range(sc.bk.palettes[0].colors));
  });
});
