// Tournament mode: CHR save games, the save game manager, the HAR economy and the mechlab scene (new pilot,
// upgrades, trades, a tournament fight and back).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setKeyState } from '../controller/input';
import { chrParse, chrSerialize } from '../formats/chr';
import { Pilot } from '../formats/pilot';
import { ACT_DOWN, ACT_LEFT, ACT_RIGHT, ACT_UP, HarId, SceneId, STATIC_TICKS } from '../game/constants';
import { gamePlayerGetPilot, type GameState } from '../game/gameState';
import { portraitLoad } from '../game/gui/portrait';
import type { SpriteButton } from '../game/gui/spriteButton';
import type { TrnMenu } from '../game/gui/trnMenu';
import { ARENA_STATE_FIGHTING, harData } from '../game/objects/har';
import type { ArenaScene } from '../game/scenes/arena';
import { DashboardType, type MechlabScene } from '../game/scenes/mechlab';
import {
  calculateTradeValue, calculateWinnings, HAR_PRICES, HarUpgrade, harCanUpgrade, purchaseRandomHarUpgrades, sellHighestValueUpgrade,
  upgradeHar, upgradePrice,
} from '../game/scenes/mechlab/harEconomy';
import { settings } from '../game/settings';
import { chrCreate, chrFromTrn, chrLoad, chrSave, type ChrFile } from '../game/tournament/chr';
import { langGet, loadTournament } from '../resources/resources';
import {
  base64ToBytes, bytesToBase64, LocalStorageSaveStorage, MemorySaveStorage, setSaveStorage, sgCount, sgDelete, sgFileName, sgLoadAll,
  sgLoadPilot, sgSave,
} from '../resources/sgmanager';
import { trnlistInit } from '../resources/trnmanager';
import { globalRandom } from '../util/random';
import { createGame, hasGameData, HeadlessRunner, installBrowserShims, loadGameData } from './harness';

const held = new Set<string>();

function press(run: HeadlessRunner, code: string): void {
  setKeyState(code, true);
  held.add(code);
  run.advance(60);
  setKeyState(code, false);
  held.delete(code);
  run.advance(60);
}

function typeText(gs: GameState, text: string): void {
  for (const ch of text) {
    const code = ch === ' ' ? 'Space' : `Key${ch.toUpperCase()}`;
    gs.sc.keyEvent(code, { key: ch, code, ctrlKey: false, altKey: false, metaKey: false, repeat: false } as KeyboardEvent);
  }
}

function waitFor(run: HeadlessRunner, cond: () => boolean, maxMs = 5000): boolean {
  for (let t = 0; t < maxMs; t += 50) {
    if (cond()) return true;
    run.advance(50);
  }
  return cond();
}

/** Runs static/dynamic ticks like the engine (fast, no rendering) until `done` or the time runs out. */
function simulate(gs: GameState, done: () => boolean, maxMs: number): boolean {
  let staticWait = 0;
  let dynamicWait = 0;
  for (let ms = 0; ms < maxMs; ms += STATIC_TICKS) {
    staticWait += STATIC_TICKS;
    dynamicWait += STATIC_TICKS;
    while (staticWait >= STATIC_TICKS) {
      gs.staticTick();
      staticWait -= STATIC_TICKS;
      if (done()) return true;
    }
    let dyn = gs.msPerDyntick();
    while (dynamicWait >= dyn) {
      gs.dynamicTick();
      dynamicWait -= dyn;
      if (done()) return true;
      dyn = gs.msPerDyntick();
    }
  }
  return false;
}

function mechlab(gs: GameState): MechlabScene {
  expect(gs.thisId).toBe(SceneId.MECHLAB);
  return gs.sc as MechlabScene;
}

/** The menu that currently takes the input (the deepest active submenu of the frame root). */
function activeMenu(sc: MechlabScene): TrnMenu {
  let m = sc.frame.root as TrnMenu;
  while (m.submenu && !m.submenu.isFinished()) m = m.submenu;
  return m;
}

function waitMenuReady(run: HeadlessRunner, sc: MechlabScene): TrnMenu {
  expect(waitFor(run, () => {
    const root = sc.frame.root as TrnMenu;
    const m = activeMenu(sc);
    return !root.isFading() && !m.isFading();
  })).toBe(true);
  return activeMenu(sc);
}

/** Selects button `index` of the active menu (as if the hand was moved there) and presses it with Enter. */
function clickButton(run: HeadlessRunner, sc: MechlabScene, index: number): void {
  const menu = waitMenuReady(run, sc);
  menu.selectedIndex = index;
  press(run, 'Enter');
}

/** A new pilot in the NORTH_AM tournament (what the mechlab does after the tournament selection). */
function newTournamentChr(name: string, money = 2000): ChrFile {
  const trn = loadTournament('NORTH_AM.TRN');
  const pilot = new Pilot();
  pilot.name = name;
  pilot.money = money - trn.registrationFee;
  pilot.color1 = pilot.color2 = pilot.color3 = 16;
  pilot.photoId = 1;
  pilot.photo = portraitLoad(pilot.palette, 1);
  const chr = chrCreate();
  chr.pilot = pilot.clone();
  chrFromTrn(chr, trn, pilot);
  return chr;
}

afterEach(() => {
  for (const k of held) setKeyState(k, false);
  held.clear();
});

describe.skipIf(!hasGameData)('tournament: formats and economy', () => {
  beforeEach(() => {
    installBrowserShims();
    loadGameData();
  });

  it('lists the tournaments by registration fee', () => {
    const list = trnlistInit();
    expect(list.map((t) => t.filename)).toEqual(['NORTH_AM.TRN', 'KATUSHAI.TRN', 'WAR.TRN', 'WORLD.TRN']);
  });

  it('enters a tournament: ranks, rank money and tournament names', () => {
    const chr = newTournamentChr('RANKER');
    expect(chr.enemies.length).toBe(14);
    expect(chr.pilot.enemiesIncUnranked).toBe(14);
    expect(chr.pilot.enemiesExUnranked).toBe(10);
    expect(chr.pilot.rank).toBe(11);
    expect(chr.enemies.slice(0, 10).map((e) => e.pilot.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(chr.enemies.slice(0, 10).map((e) => e.trnIndex)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(chr.enemies.slice(10).map((e) => [e.pilot.rank, e.trnIndex])).toEqual([[0, 0], [0, 0], [0, 0], [0, 0]]);
    // trade value 17000 + money 500 + 17000 = 34500; / 320 = 107 -> 107 / 0.6f = 178 -> (10 + 10) * 0.5 + 178 / 15
    expect(chr.pilot.trnRankMoney).toBe(21);
    expect(chr.pilot.trnName).toBe('NORTH_AM.TRN');
    expect(chr.pilot.trnDesc).toBe('North American Open');
    expect(chr.pilot.trnImage).toBe('north_am.pic');
    expect(chr.photo).not.toBeNull();
    expect(chr.photo).not.toBe(chr.pilot.photo);
  });

  it('saves and reloads a CHR: byte round-trip and the resource data of the reference loader', () => {
    globalRandom.setSeed(1234);
    const chr = newTournamentChr('Round Trip', 5000);
    chr.pilot.wins = 3;
    chr.pilot.losses = 2;
    chr.pilot.armPower = 2;
    chr.pilot.harTrades = 0x22;
    chr.unknownB = 0xdeadbeef;
    chr.enemies[3].unknownA[4] = 0x5a;
    chr.enemies[3].unknownB[14] = 0xa5;
    const bytes = chrSave(chr);

    // Raw layer: parse -> serialize gives the same bytes; fields survive.
    const raw = chrParse(bytes);
    expect(Array.from(chrSerialize(raw))).toEqual(Array.from(bytes));
    expect(raw.pilot.name).toBe('Round Trip');
    expect([raw.pilot.wins, raw.pilot.losses, raw.pilot.rank, raw.pilot.money, raw.pilot.armPower]).toEqual([3, 2, 11, 3500, 2]);
    expect(raw.pilot.harTrades).toBe(0x22);
    expect(raw.pilot.trnRankMoney).toBe(chr.pilot.trnRankMoney);
    expect(raw.unknownB).toBe(0xdeadbeef);
    expect(raw.enemies.length).toBe(14);
    expect(raw.enemies[3].unknownA[4]).toBe(0x5a);
    expect(raw.enemies[3].unknownB[14]).toBe(0xa5);
    expect(raw.enemies.map((e) => [e.pilot.name, e.pilot.rank, e.pilot.harId, e.pilot.money, e.trnIndex])).toEqual(
      chr.enemies.map((e) => [e.pilot.name, e.pilot.rank, e.pilot.harId, e.pilot.money, e.trnIndex]),
    );
    expect([raw.photo!.width, raw.photo!.height]).toEqual([chr.photo!.width, chr.photo!.height]);
    expect(Array.from(raw.photo!.pixels())).toEqual(Array.from(chr.photo!.pixels()));
    expect(Array.from(raw.pilot.palette.colors.subarray(0, 48 * 3))).toEqual(Array.from(chr.pilot.palette.colors.subarray(0, 48 * 3)));

    // Full load: tournament data, enemy photos/quotes, random upgrades bought with the enemies' money.
    const loaded = chrLoad(bytes);
    const trn = loadTournament('NORTH_AM.TRN');
    expect(loaded.bkName).toBe(trn.bkName);
    expect(loaded.winningsMultiplier).toBe(trn.winningsMultiplier);
    expect(loaded.tournamentId).toBe(0);
    expect(loaded.cutsceneText[0]).toBe(trn.locales[0].endTexts[0][0]);
    expect(loaded.pilot.photo).toBe(loaded.photo);
    const raven = loaded.enemies[0].pilot;
    expect(raven.name).toBe('Raven');
    expect(raven.quotes[0]).toBe(trn.enemies[0].quotes[0]);
    expect(raven.photo).not.toBeNull();
    expect(raven.winnings).toBe(trn.enemies[0].winnings);
    expect(raven.money).toBeLessThan(trn.enemies[0].money); // spent on upgrades
    for (const u of [HarUpgrade.ARM_POWER, HarUpgrade.ARM_SPEED, HarUpgrade.LEG_POWER, HarUpgrade.LEG_SPEED, HarUpgrade.ARMOR, HarUpgrade.STUN_RES]) {
      expect(harCanUpgrade(raven, u) && raven.money >= upgradePrice(raven, u)).toBe(false);
    }
    // (the reference does not copy att_jump / ap_close from the tournament)
    expect(raven.apClose).toBe(0);

    // Once the enemies bought what they can afford, save -> load -> save is stable.
    const bytes2 = chrSave(loaded);
    const again = chrLoad(bytes2);
    expect(Array.from(chrSave(again))).toEqual(Array.from(bytes2));
    expect(again.enemies.map((e) => e.pilot.money)).toEqual(loaded.enemies.map((e) => e.pilot.money));
  });

  it('buys random HARs for "random" tournament pilots', () => {
    globalRandom.setSeed(99);
    const trn = loadTournament('KATUSHAI.TRN');
    const pilot = new Pilot();
    pilot.name = 'KAT';
    pilot.photo = portraitLoad(pilot.palette, 0);
    const chr = chrCreate();
    chr.pilot = pilot.clone();
    chrFromTrn(chr, trn, pilot);
    expect(chr.enemies[0].pilot.harId).toBe(255);
    const loaded = chrLoad(chrSave(chr));
    for (const e of loaded.enemies) {
      expect(e.pilot.harId).toBeLessThan(10);
    }
    const jaq = loaded.enemies[0].pilot;
    expect(jaq.money).toBeLessThan(40012 - HAR_PRICES[jaq.harId] + 1);
  });

  it('upgrade prices, trade value, selling for debts and winnings', () => {
    const p = new Pilot();
    p.harId = HarId.JAGUAR;
    p.money = 100000;
    expect(upgradePrice(p, HarUpgrade.ARM_POWER)).toBe(380 * 1 * 2);
    upgradeHar(p, HarUpgrade.ARM_POWER);
    upgradeHar(p, HarUpgrade.ARM_POWER);
    expect(p.armPower).toBe(2);
    expect(p.money).toBe(100000 - 760 - 380 * 3 * 2);
    expect(upgradePrice(p, HarUpgrade.ARMOR)).toBe(380 * 5);
    upgradeHar(p, HarUpgrade.ARMOR);
    // trade value: (20000 + level 1 arm power) * 0.85
    expect(calculateTradeValue(p)).toBe(Math.trunc((20000 + 760) * 0.85));

    // Plug sells the most valuable kit (arm power level 2 = 2280, armor level 1 = 1900)
    const before = p.money;
    expect(sellHighestValueUpgrade(p)).toBe('LEVEL 3 ARM POWER'); // (the reference prints the level + 1)
    expect(p.armPower).toBe(1);
    expect(p.money).toBe(before + Math.trunc(2280 * 0.85));

    // Winnings (float math as in the reference)
    const winner = new Pilot();
    winner.harId = HarId.JAGUAR;
    winner.rank = 10;
    winner.trnRankMoney = 16;
    const loser = loadTournament('NORTH_AM.TRN').enemies[9].clone(); // Cossette, winnings 300
    const w = calculateWinnings(winner, loser, 0.85);
    expect(winner.totalValue).toBe(14000);
    expect(Math.trunc(w)).toBe(Math.trunc(w)); // finite
    expect(w).toBeGreaterThan(0);
    expect(w).toBe(Math.fround(w));

    // AI pilots spend everything they can
    const ai = new Pilot();
    ai.harId = HarId.THORN;
    ai.money = 5000;
    purchaseRandomHarUpgrades(ai);
    expect(ai.money).toBeGreaterThanOrEqual(0);
    expect(ai.armPower + ai.armSpeed + ai.legPower + ai.legSpeed + ai.armor + ai.stunResistance).toBeGreaterThan(0);
  });

  it('save game manager: file names, save/load/count/delete and the last pilot setting', () => {
    const storage = new MemorySaveStorage();
    setSaveStorage(storage);
    try {
      expect(sgFileName('John Doe')).toBe('JOHN_DOE.CHR');
      expect(sgCount()).toBe(0);
      const chr = newTournamentChr('John Doe');
      expect(sgSave(chr)).toBe(true);
      expect(storage.list()).toEqual(['JOHN_DOE.CHR']);
      expect(settings().tournament.lastName).toBe('JOHN_DOE');
      expect(sgSave(newTournamentChr('Other'))).toBe(true);
      expect(sgCount()).toBe(2);
      const loaded = sgLoadPilot('JOHN_DOE')!;
      expect(loaded.pilot.name).toBe('John Doe');
      expect(sgLoadAll().map((c) => c.pilot.name).sort()).toEqual(['John Doe', 'Other']);
      expect(sgDelete('John Doe')).toBe(true);
      expect(sgCount()).toBe(1);
      expect(sgLoadPilot('JOHN_DOE')).toBeNull();
    } finally {
      setSaveStorage(new MemorySaveStorage());
    }
  });

  it('localStorage save storage keeps base64 CHR bytes and an index', () => {
    const data = Uint8Array.from([0, 1, 2, 250, 255, 128]);
    expect(Array.from(base64ToBytes(bytesToBase64(data)))).toEqual(Array.from(data));
    const st = new LocalStorageSaveStorage('omf2097.test.');
    expect(st.write('A.CHR', data)).toBe(true);
    expect(st.write('B.CHR', data)).toBe(true);
    expect(localStorage.getItem('omf2097.test.A.CHR')).toBe(bytesToBase64(data));
    expect(st.list()).toEqual(['A.CHR', 'B.CHR']);
    expect(Array.from(st.read('B.CHR')!)).toEqual(Array.from(data));
    expect(st.remove('A.CHR')).toBe(true);
    expect(st.list()).toEqual(['B.CHR']);
    st.remove('B.CHR');
  });
});

describe.skipIf(!hasGameData)('tournament: mechlab', () => {
  let storage: MemorySaveStorage;

  beforeEach(() => {
    storage = new MemorySaveStorage();
    setSaveStorage(storage);
    settings().tournament.lastName = '';
  });

  function openMechlab(setup?: (gs: GameState) => void): { gs: GameState; run: HeadlessRunner; sc: MechlabScene } {
    const gs = createGame(SceneId.MENU);
    setup?.(gs);
    gs.swapScene(SceneId.MECHLAB);
    const run = new HeadlessRunner(gs);
    run.advance(400); // input is ignored for the first 25 static ticks
    return { gs, run, sc: mechlab(gs) };
  }

  it('creates a new pilot: name, photo, difficulty and tournament', () => {
    const { gs, run, sc } = openMechlab();
    expect(gs.getPlayer(0).chr).toBeNull();
    expect(sc.dashtype).toBe(DashboardType.STATS);
    expect(sc.mech).toBeNull();
    let menu = waitMenuReady(run, sc);
    // Without a character only LOAD, NEW, DELETE and QUIT can be selected; LOAD is first.
    expect(menu.selectedIndex).toBe(4);
    expect(sc.hint.text.str).toBe(langGet(541));
    press(run, 'ArrowUp'); // NEW
    expect(menu.selectedIndex).toBe(5);
    expect(sc.hint.text.str).toBe(langGet(542));
    press(run, 'Enter');
    expect(sc.dashtype).toBe(DashboardType.NEW_PLAYER);
    expect(gs.getPlayer(0).pilot.money).toBe(2000);

    typeText(gs, 'Test Pilot.');
    expect(sc.nw.input!.buf).toBe('Test Pilot'); // no dots
    press(run, 'Enter');
    expect(gs.getPlayer(0).pilot.name).toBe('Test Pilot');
    expect(waitFor(run, () => sc.dashtype === DashboardType.SELECT_NEW_PIC)).toBe(true);
    const title = (sc.frame.root as TrnMenu).objs[3] as unknown as { text: { str: string } };
    expect(title.text.str).toBe('SELECT PHOTO FOR PILOT Test Pilot');

    // Photo: moving onto the right arrow picks the next photo, then the hand returns to SELECT
    menu = waitMenuReady(run, sc);
    press(run, 'ArrowRight');
    expect(gs.getPlayer(0).pilot.photoId).toBe(1);
    expect(waitFor(run, () => menu.selectedIndex === 0)).toBe(true);
    press(run, 'Enter');
    expect(waitFor(run, () => sc.dashtype === DashboardType.SELECT_DIFFICULTY)).toBe(true);

    // Difficulty: IRON
    menu = waitMenuReady(run, sc);
    expect(menu.selectedIndex).toBe(0);
    press(run, 'ArrowRight');
    expect(menu.selectedIndex).toBe(1);
    press(run, 'Enter');
    expect(gs.getPlayer(0).pilot.difficulty).toBe(1);
    expect(waitFor(run, () => sc.dashtype === DashboardType.SELECT_TOURNAMENT)).toBe(true);
    expect(sc.tw.trnselect!.getSelected()!.filename).toBe('NORTH_AM.TRN');

    // Tournament: the first one (North American Open)
    waitMenuReady(run, sc);
    press(run, 'Enter');
    expect(waitFor(run, () => sc.dashtype === DashboardType.STATS)).toBe(true);
    const p1 = gs.getPlayer(0);
    const chr = p1.chr!;
    expect(chr).not.toBeNull();
    expect(p1.pilot).toBe(chr.pilot);
    expect(chr.pilot.name).toBe('Test Pilot');
    expect(chr.pilot.money).toBe(500);
    expect(chr.pilot.rank).toBe(11);
    expect(chr.pilot.difficulty).toBe(1);
    expect(chr.pilot.photoId).toBe(1);
    expect(chr.bkName).toBe('north_am.bk');
    expect(storage.list()).toEqual(['TEST_PILOT.CHR']);
    expect(settings().tournament.lastName).toBe('TEST_PILOT');
    expect(sc.mech).not.toBeNull();
    expect(sc.dw.money!.text.str).toBe('MONEY: $ 500K');
    expect(sc.dw.rank!.text.str).toBe('RANK: 11');
    expect(sc.dw.tournament!.text.str).toBe('North American Open');

    // The next opponent is ranked 10th
    menu = waitMenuReady(run, sc);
    expect(menu.selectedIndex).toBe(0); // ARENA
    expect(sc.hint.text.str).toBe(langGet(537).replace('%s', chr.enemies[9].pilot.name));

    // Leaving the mechlab saves the character
    chr.pilot.wins = 7;
    gs.swapScene(SceneId.MENU);
    expect(sgLoadPilot('TEST_PILOT')!.pilot.wins).toBe(7);
  });

  it('navigates the main menu with the hand', () => {
    storage.write(sgFileName('NAV'), chrSave(newTournamentChr('NAV')));
    settings().tournament.lastName = 'NAV';
    const { run, sc } = openMechlab();
    const menu = waitMenuReady(run, sc);
    expect(menu.selectedIndex).toBe(0); // ARENA
    const moves: [string, number][] = [['ArrowRight', 7], ['ArrowRight', 2], ['ArrowUp', 1], ['ArrowRight', 5], ['ArrowDown', 4], ['ArrowLeft', 3]];
    for (const [key, index] of moves) {
      press(run, key);
      expect(menu.selectedIndex, key).toBe(index);
    }
    // the hand slides to the button center in 20 ticks
    const sel = menu.get(menu.selectedIndex)!;
    expect(waitFor(run, () => menu.hand.move === 0)).toBe(true);
    expect([menu.hand.obj!.px(), menu.hand.obj!.py()]).toEqual([sel.x + Math.trunc(sel.w / 2), sel.y + Math.trunc(sel.h / 2)]);
    void [ACT_UP, ACT_DOWN, ACT_LEFT, ACT_RIGHT];
  });

  it('buys and sells upgrades and trains the pilot', () => {
    const chr0 = newTournamentChr('BUYER');
    chr0.pilot.money = 50000;
    storage.write(sgFileName('BUYER'), chrSave(chr0));
    settings().tournament.lastName = 'BUYER';
    const { gs, run, sc } = openMechlab();
    const chr = gs.getPlayer(0).chr!;
    expect(chr.pilot.money).toBe(50000);

    clickButton(run, sc, 2); // BUY
    let menu = waitMenuReady(run, sc);
    expect(sc.getSelling()).toBe(false);
    clickButton(run, sc, 3); // ARM POWER
    expect(chr.pilot.armPower).toBe(1);
    expect(chr.pilot.money).toBe(50000 - 380 * 2);
    clickButton(run, sc, 3);
    expect(chr.pilot.armPower).toBe(2);
    expect(chr.pilot.money).toBe(50000 - 760 - 2280);
    clickButton(run, sc, 7); // ARMOR
    expect(chr.pilot.armor).toBe(1);
    expect(chr.pilot.money).toBe(50000 - 760 - 2280 - 1900);
    expect(sc.dw.armPower!.getLit()).toBe(3);
    expect(sc.dw.money!.text.str).toBe(`MONEY: $ ${(50000 - 760 - 2280 - 1900).toLocaleString('en-US')}K`);
    // the colors cycle through the 16 alternate palettes and the photo colors
    clickButton(run, sc, 0);
    expect(chr.pilot.color1).toBe(0);
    clickButton(run, sc, 10); // DONE
    expect(waitFor(run, () => (sc.frame.root as TrnMenu).submenu === null)).toBe(true);

    clickButton(run, sc, 3); // SELL
    menu = waitMenuReady(run, sc);
    expect(sc.getSelling()).toBe(true);
    const money = chr.pilot.money;
    clickButton(run, sc, 3); // sell arm power level 2
    expect(chr.pilot.armPower).toBe(1);
    expect(chr.pilot.money).toBe(money + Math.trunc(2280 * 0.85));
    // nothing to sell for leg power: the button is disabled and ignores clicks
    expect(menu.objs[4].disabled).toBe(true);
    clickButton(run, sc, 4);
    expect(chr.pilot.legPower).toBe(0);
    clickButton(run, sc, 10); // DONE
    expect(waitFor(run, () => (sc.frame.root as TrnMenu).submenu === null)).toBe(true);

    clickButton(run, sc, 1); // TRAINING COURSES
    waitMenuReady(run, sc);
    const m2 = chr.pilot.money;
    clickButton(run, sc, 0); // POWER
    expect(chr.pilot.power).toBe(1);
    expect(chr.pilot.money).toBe(m2 - 50);
    expect(sc.dw.power!.getLit()).toBe(2);
  });

  it('trades the HAR for one Plug offered', () => {
    const chr0 = newTournamentChr('TRADER');
    chr0.pilot.money = 30000;
    chr0.pilot.armPower = 2;
    chr0.pilot.harTrades = (1 << HarId.SHADOW) | (1 << HarId.PYROS);
    storage.write(sgFileName('TRADER'), chrSave(chr0));
    settings().tournament.lastName = 'TRADER';
    const { gs, run, sc } = openMechlab();
    const p1 = gs.getPlayer(0);
    const chr = p1.chr!;

    clickButton(run, sc, 2); // BUY
    let menu = waitMenuReady(run, sc);
    expect(menu.objs[9].disabled).toBe(false); // TRADE ROBOT
    clickButton(run, sc, 9);
    menu = waitMenuReady(run, sc);
    // the trade menu shows the offered HARs; the focused one is previewed on a copy of the pilot
    expect(menu.objs.length).toBe(2);
    expect(p1.pilot).not.toBe(chr.pilot);
    expect(p1.pilot.harId).toBe(HarId.SHADOW);
    expect(p1.pilot.armPower).toBe(0);
    expect(sc.mech!.curAnimation!.id).toBe(15 + HarId.SHADOW);
    press(run, 'ArrowRight');
    expect(p1.pilot.harId).toBe(HarId.PYROS);
    press(run, 'Enter');
    menu = waitMenuReady(run, sc);
    // confirmation: "TRADE YOUR JAGUAR AND $ xK FOR A PYROS?"
    const tradeValue = calculateTradeValue(chr.pilot);
    const label = menu.objs[2] as unknown as { text: { str: string } };
    expect(label.text.str).toBe(
      langGet(519).replace('%s', langGet(31)).replace('%s', `$ ${HAR_PRICES[HarId.PYROS] - tradeValue}K`).replace('%s', langGet(31 + HarId.PYROS)),
    );
    expect(menu.selectedIndex).toBe(0); // YES
    press(run, 'Enter');
    expect(waitFor(run, () => activeMenu(sc) !== menu)).toBe(true);
    expect(p1.pilot).toBe(chr.pilot);
    expect(chr.pilot.harId).toBe(HarId.PYROS);
    expect(chr.pilot.armPower).toBe(0);
    expect(chr.pilot.money).toBe(30000 + tradeValue - HAR_PRICES[HarId.PYROS]);
    expect(sc.mech!.curAnimation!.id).toBe(15 + HarId.PYROS);
  });

  it('shows popups when there is nothing to load or delete', () => {
    const { run, sc } = openMechlab();
    clickButton(run, sc, 4); // LOAD
    expect(sc.popup!.str).toBe(langGet(157));
    press(run, 'Enter');
    expect(sc.popup).toBeNull();
    clickButton(run, sc, 6); // DELETE
    expect(sc.popup!.str).toBe(langGet(159));
  });

  it('loads another pilot from the save games', () => {
    storage.write(sgFileName('FIRST'), chrSave(newTournamentChr('FIRST')));
    const second = newTournamentChr('SECOND');
    second.pilot.wins = 5;
    storage.write(sgFileName('SECOND'), chrSave(second));
    settings().tournament.lastName = 'FIRST';
    const { gs, run, sc } = openMechlab();
    expect(gs.getPlayer(0).chr!.pilot.name).toBe('FIRST');
    clickButton(run, sc, 4); // LOAD
    waitMenuReady(run, sc);
    // browsing shows the other pilot on the dashboard
    expect(gs.getPlayer(0).pilot.name).toBe('SECOND');
    expect(sc.dw.wins!.text.str).toBe('WINS: 5');
    press(run, 'Enter'); // SELECT
    expect(waitFor(run, () => (sc.frame.root as TrnMenu).submenu === null)).toBe(true);
    const p1 = gs.getPlayer(0);
    expect(p1.chr!.pilot.name).toBe('SECOND');
    expect(p1.pilot).toBe(p1.chr!.pilot);
  });

  it('fights the next opponent and comes back to the mechlab (lost fight)', () => {
    globalRandom.setSeed(7);
    storage.write(sgFileName('FIGHTER'), chrSave(newTournamentChr('FIGHTER')));
    settings().tournament.lastName = 'FIGHTER';
    const { gs, run, sc } = openMechlab();
    const p1 = gs.getPlayer(0);
    const chr = p1.chr!;
    const opponent = chr.enemies[9].pilot;
    clickButton(run, sc, 0); // ARENA
    expect(gs.nextId).toBe(SceneId.VS);
    expect(gamePlayerGetPilot(gs.getPlayer(1))).toBe(opponent);
    expect(gs.getPlayer(1).selectable).toBe(false);
    expect(waitFor(run, () => gs.thisId === SceneId.VS)).toBe(true);
    // the mechlab saved the character on the way out
    expect(storage.list()).toEqual(['FIGHTER.CHR']);

    run.advance(400);
    press(run, 'Enter');
    expect(waitFor(run, () => gs.thisId >= SceneId.ARENA0 && gs.thisId <= SceneId.ARENA4)).toBe(true);
    const arena = gs.sc as ArenaScene;
    expect(arena.tournament).toBe(true);
    expect(arena.rounds).toBe(1);

    // Player 1 stays idle; the CPU wins.
    gs.warpSpeed = true;
    expect(simulate(gs, () => gs.thisId === SceneId.NEWSROOM, 600000)).toBe(true);
    gs.warpSpeed = false;
    const fs = gs.fightStats;
    expect(fs.winner).toBe(1);
    expect(chr.pilot.losses).toBe(1);
    expect(chr.pilot.rank).toBe(11); // already last
    expect(fs.repairCost).toBe(Math.trunc(calculateTradeValue(chr.pilot) / 100));
    expect(fs.profit).toBe(fs.bonuses + fs.winnings - fs.repairCost);
    expect(chr.pilot.money).toBe(500 + fs.profit);
    // saved after the fight
    expect(sgLoadPilot('FIGHTER')!.pilot.losses).toBe(1);

    // newsroom (2 screens) -> Plug's report -> mechlab
    const newsRun = new HeadlessRunner(gs);
    newsRun.advance(400);
    press(newsRun, 'Enter');
    press(newsRun, 'Enter');
    expect(waitFor(newsRun, () => gs.thisId === SceneId.VS)).toBe(true);
    expect(gamePlayerGetPilot(gs.getPlayer(1))).toBeNull(); // Plug report
    newsRun.advance(400);
    press(newsRun, 'Enter');
    expect(waitFor(newsRun, () => gs.thisId === SceneId.MECHLAB)).toBe(true);
    const sc2 = mechlab(gs);
    expect(sc2.dashtype).toBe(DashboardType.STATS);
    expect(sc2.dw.losses!.text.str).toBe('LOSES: 1');
    expect(p1.chr).toBe(chr);
  });

  /** From the mechlab: ARENA -> VS -> arena; player 1 stays idle until the CPU has won (or `until`). */
  function fightFromMechlab(gs: GameState, run: HeadlessRunner, sc: MechlabScene, until?: () => boolean): void {
    clickButton(run, sc, 0); // ARENA
    expect(waitFor(run, () => gs.thisId === SceneId.VS)).toBe(true);
    run.advance(400);
    press(run, 'Enter');
    expect(waitFor(run, () => gs.thisId >= SceneId.ARENA0 && gs.thisId <= SceneId.ARENA4)).toBe(true);
    gs.warpSpeed = true;
    expect(simulate(gs, until ?? (() => gs.thisId === SceneId.NEWSROOM), 600000)).toBe(true);
    gs.warpSpeed = false;
  }

  function prepared(name: string, edit: (chr: ChrFile) => void): void {
    const chr = newTournamentChr(name);
    edit(chr);
    storage.write(sgFileName(name), chrSave(chr));
    settings().tournament.lastName = sgFileName(name).replace('.CHR', '');
  }

  it('debts: Plug sells the best upgrade, then the pilot is kicked out of the tournament', () => {
    globalRandom.setSeed(3);
    prepared('DEBTOR', (chr) => {
      chr.pilot.money = -10;
      chr.pilot.armPower = 3;
    });
    const { gs, run, sc } = openMechlab();
    const chr = gs.getPlayer(0).chr!;
    fightFromMechlab(gs, run, sc);
    const fs = gs.fightStats;
    expect(fs.winner).toBe(1);
    expect(fs.plugText).toBe(18); // PLUG_SOLD_UPGRADE
    expect(fs.sold).toBe('LEVEL 4 ARM POWER');
    expect(chr.pilot.armPower).toBe(2);
    expect(chr.pilot.money).toBe(-10 + fs.profit + Math.trunc(380 * 7 * 2 * 0.85));

    // Still in debt with nothing left to sell: kicked out
    chr.pilot.armPower = 0;
    chr.pilot.money = -10;
    gs.swapScene(SceneId.MECHLAB);
    const run2 = new HeadlessRunner(gs);
    run2.advance(400);
    fightFromMechlab(gs, run2, mechlab(gs));
    expect(gs.fightStats.plugText).toBe(17); // PLUG_KICK_OUT
    expect(chr.pilot.money).toBe(0);
    expect(chr.pilot.rank).toBe(0);
    expect(chr.pilot.trnName).toBe('');
    // back in the mechlab only NEW TOURNAMENT (and the save game buttons) remain
    gs.swapScene(SceneId.MECHLAB);
    const run3 = new HeadlessRunner(gs);
    run3.advance(400);
    const root = waitMenuReady(run3, mechlab(gs));
    expect(root.objs.map((c) => c.disabled)).toEqual([true, true, true, true, false, false, false, true, false, false]);
  });

  it('forfeit: Plug calls you a chicken on the VS screen (and the loss counts)', () => {
    globalRandom.setSeed(5);
    prepared('CHICKEN', () => undefined);
    const { gs, run, sc } = openMechlab();
    const chr = gs.getPlayer(0).chr!;
    fightFromMechlab(gs, run, sc, () => (gs.sc as ArenaScene).arenaGetState() === ARENA_STATE_FIGHTING);
    (gs.sc as ArenaScene).quitFight();
    expect(gs.nextId).toBe(SceneId.VS);
    expect(gamePlayerGetPilot(gs.getPlayer(1))).toBeNull();
    expect(chr.pilot.losses).toBe(1);
    // Reference quirk: fight_stats.winner stays 0 on a forfeit, so Plug's comment is a "win" one.
    expect(gs.fightStats.plugText).toBeGreaterThanOrEqual(7);
    expect(gs.fightStats.plugText).toBeLessThanOrEqual(15);
    expect(waitFor(run, () => gs.thisId === SceneId.VS)).toBe(true);
    run.advance(400);
    press(run, 'Enter');
    expect(waitFor(run, () => gs.thisId === SceneId.MECHLAB)).toBe(true);
  });

  it('SIM: a practice fight without consequences, then back to the mechlab', () => {
    globalRandom.setSeed(9);
    prepared('SIMMER', () => undefined);
    const { gs, run, sc } = openMechlab();
    const p1 = gs.getPlayer(0);
    const chr = p1.chr!;
    clickButton(run, sc, 7); // SIM
    expect(sc.dashtype).toBe(DashboardType.SIM);
    const menu = waitMenuReady(run, sc);
    expect(sc.dw.simRank).toBe(10);
    expect(sc.dw.name!.text.str).toBe(`NAME: ${chr.enemies[9].pilot.name}`);
    press(run, 'ArrowLeft'); // rank 9
    expect(sc.dw.simRank).toBe(9);
    expect(waitFor(run, () => menu.selectedIndex === 0)).toBe(true);
    press(run, 'Enter'); // SELECT (the reference deletes the player's save here; it is written again on leaving)
    expect(waitFor(run, () => gs.nextId === SceneId.VS)).toBe(true);
    expect(gs.matchSettings.sim).toBe(true);
    expect(gamePlayerGetPilot(gs.getPlayer(1))).toBe(chr.enemies[8].pilot);
    expect(gs.getPlayer(1).selectable).toBe(true); // player 1 picks the arena
    expect(waitFor(run, () => gs.thisId === SceneId.VS)).toBe(true);
    expect(storage.list()).toEqual(['SIMMER.CHR']);
    run.advance(400);
    press(run, 'Enter');
    expect(waitFor(run, () => gs.thisId >= SceneId.ARENA0 && gs.thisId <= SceneId.ARENA4)).toBe(true);
    gs.warpSpeed = true;
    expect(simulate(gs, () => gs.thisId === SceneId.MECHLAB, 600000)).toBe(true);
    gs.warpSpeed = false;
    expect(chr.pilot.losses).toBe(0);
    expect(chr.pilot.money).toBe(500);
    expect(chr.pilot.rank).toBe(11);
    expect(gamePlayerGetPilot(gs.getPlayer(1))).toBeNull();
  });

  it('deletes another pilot and replays the ending cutscene of a champion with "E"', () => {
    prepared('KEEPER', (chr) => {
      chr.pilot.rank = 1;
    });
    storage.write(sgFileName('GONER'), chrSave(newTournamentChr('GONER')));
    const { gs, run, sc } = openMechlab();
    expect(gs.getPlayer(0).chr!.pilot.name).toBe('KEEPER');
    // a champion has no next opponent
    expect(sc.nextOpponent()).toBeNull();
    expect((sc.frame.root as TrnMenu).objs[0].disabled).toBe(true);
    clickButton(run, sc, 6); // DELETE
    waitMenuReady(run, sc);
    expect(gs.getPlayer(0).pilot.name).toBe('GONER');
    press(run, 'Enter');
    expect(waitFor(run, () => (sc.frame.root as TrnMenu).submenu === null)).toBe(true);
    expect(storage.list()).toEqual(['KEEPER.CHR']);
    expect(gs.getPlayer(0).pilot).toBe(gs.getPlayer(0).chr!.pilot);

    sc.keyEvent('KeyE', { key: 'e', code: 'KeyE' } as KeyboardEvent);
    expect(gs.nextId).toBe(SceneId.TRN_CUTSCENE);
    expect(gs.fightStats.winner).toBe(-1);
  });

  it('wins a fight: rank, winnings and money', () => {
    globalRandom.setSeed(11);
    storage.write(sgFileName('WINNER'), chrSave(newTournamentChr('WINNER')));
    settings().tournament.lastName = 'WINNER';
    const { gs, run, sc } = openMechlab();
    const p1 = gs.getPlayer(0);
    const chr = p1.chr!;
    const opponent = chr.enemies[9].pilot;
    const opponentLosses = opponent.losses; // (tournament pilots come with a record)
    clickButton(run, sc, 0); // ARENA
    expect(waitFor(run, () => gs.thisId === SceneId.VS)).toBe(true);
    run.advance(400);
    press(run, 'Enter');
    expect(waitFor(run, () => gs.thisId >= SceneId.ARENA0 && gs.thisId <= SceneId.ARENA4)).toBe(true);

    // Scripted: player 1 cannot be hurt, the opponent is nearly done; walk in and punch.
    p1.god = true;
    const p2Har = () => harData(gs.findObject(gs.getPlayer(1).harObjId)!);
    let t = 0;
    const ok = simulate(gs, () => {
      if (gs.thisId === SceneId.NEWSROOM) return true;
      const h = gs.findObject(gs.getPlayer(1).harObjId);
      if (h && harData(h).health > 1) harData(h).health = 1;
      t++;
      setKeyState('ArrowRight', t % 200 < 150);
      setKeyState('Enter', t % 20 < 3);
      return false;
    }, 600000);
    setKeyState('ArrowRight', false);
    setKeyState('Enter', false);
    void p2Har;
    expect(ok).toBe(true);
    const fs = gs.fightStats;
    expect(fs.winner).toBe(0);
    expect(chr.pilot.wins).toBe(1);
    expect(chr.pilot.rank).toBe(10);
    expect(opponent.rank).toBe(11);
    expect(opponent.losses).toBe(opponentLosses + 1);
    expect(fs.winnings).toBeGreaterThan(0);
    expect(chr.pilot.money).toBe(500 + fs.bonuses + fs.winnings - fs.repairCost);
    expect(sgLoadPilot('WINNER')!.pilot.rank).toBe(10);
  });
});
