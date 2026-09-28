// Mechlab dashboards: the pilot/HAR stats dashboard (also used while picking a photo / difficulty and while
// browsing save games) and the SIM opponent dashboard. Port of the reference mechlab/lab_dash_main.c.
import { genRobot } from '../../../gen/roster';
import { ORIGINAL_HAR_TYPES } from '../../constants';
import { createAiController } from '../../../controller/ai';
import type { Pilot } from '../../../formats/pilot';
import { langGet } from '../../../resources/resources';
import { sgDelete, sgLoadAll } from '../../../resources/sgmanager';
import { Surface } from '../../../video/surface';
import { SceneId } from '../../constants';
import { gamePlayerGetPilot, gamePlayerSetPilot } from '../../gameState';
import { Gauge, GaugeType } from '../../gui/gauge';
import { Portrait, portraitLoad } from '../../gui/portrait';
import { SpriteImage } from '../../gui/spriteImage';
import { FontSize, HAlign, TEXT_DARK_GREEN, TEXT_MEDIUM_GREEN } from '../../gui/text';
import type { TrnMenu } from '../../gui/trnMenu';
import { Label, type Component } from '../../gui/widgets';
import { XYSizer } from '../../gui/xySizer';
import { paletteLoadPlayerColors } from '../../pilotColors';
import { scoreFormat } from '../../score';
import type { ChrFile } from '../../tournament/chr';
import type { MechlabScene } from '../mechlab';
import { MECHLAB_BRIGHT_GREEN, MECHLAB_DARK_GREEN, tournamentAiDifficulty } from './common';
import { MAX_ARM_POWER, MAX_ARM_SPEED, MAX_ARMOR, MAX_LEG_POWER, MAX_LEG_SPEED, MAX_STUN_RES } from './harEconomy';

/** Components of the current dashboard, for easy access (dashboard_widgets). */
export interface DashboardWidgets {
  scene: MechlabScene;
  pilot: Pilot | null;
  savegames: ChrFile[] | null;
  /** int16_t */
  index: number;
  /** uint8_t */
  simRank: number;
  photo: Portrait[];
  photoHighlight: SpriteImage | null;
  ranks: Label[];
  power: Gauge | null;
  agility: Gauge | null;
  endurance: Gauge | null;
  armPower: Gauge | null;
  armSpeed: Gauge | null;
  legPower: Gauge | null;
  legSpeed: Gauge | null;
  armor: Gauge | null;
  stunResistance: Gauge | null;
  name: Label | null;
  money: Label | null;
  rank: Label | null;
  wins: Label | null;
  losses: Label | null;
  tournament: Label | null;
  harName: Label | null;
  harMoves: Label | null;
}

export function dashboardWidgetsCreate(scene: MechlabScene): DashboardWidgets {
  return {
    scene, pilot: null, savegames: null, index: 0, simRank: 0, photo: [], photoHighlight: null, ranks: [],
    power: null, agility: null, endurance: null, armPower: null, armSpeed: null, legPower: null, legSpeed: null, armor: null,
    stunResistance: null, name: null, money: null, rank: null, wins: null, losses: null, tournament: null, harName: null,
    harMoves: null,
  };
}

function smallLabel(text: string, color: number): Label {
  const l = new Label(text);
  l.overrideColor = color;
  l.font = FontSize.SMALL;
  return l;
}

// ---- photo selection (new pilot) ------------------------------------------------------------------------------------

/** lab_dash_main_photo_select() */
export function labDashMainPhotoSelect(c: Component, _dw: DashboardWidgets): boolean {
  (c.parent as TrnMenu).finish();
  return true;
}

function photoChanged(dw: DashboardWidgets): void {
  const pilot = dw.pilot!;
  pilot.photoId = dw.photo[0].getSelected();
  pilot.photo = portraitLoad(pilot.palette, pilot.photoId);
  paletteLoadPlayerColors(pilot.palette, 0);
}

/** lab_dash_main_photo_left() */
export function labDashMainPhotoLeft(_c: Component, dw: DashboardWidgets): boolean {
  dw.photo[0].prev();
  photoChanged(dw);
  return true;
}

/** lab_dash_main_photo_right() */
export function labDashMainPhotoRight(_c: Component, dw: DashboardWidgets): boolean {
  dw.photo[0].next();
  photoChanged(dw);
  return true;
}

// ---- save game browsing (LOAD / DELETE) -----------------------------------------------------------------------------

/** lab_dash_main_chr_load(): the browsed character becomes the player's. */
export function labDashMainChrLoad(c: Component, dw: DashboardWidgets): boolean {
  const p1 = dw.scene.gs.getPlayer(0);
  const chr = dw.savegames?.[dw.index];
  if (chr) {
    // (the reference asserts that a character was loaded before and frees it; with none it would crash)
    p1.chr = chr;
    gamePlayerSetPilot(p1, chr.pilot);
  }
  dw.savegames = null; // the other characters of the list are freed
  (c.parent as TrnMenu).finish(); // We refer to the components sizer
  return true;
}

/** lab_dash_main_chr_delete(): deletes the save game of the browsed pilot. */
export function labDashMainChrDelete(c: Component, dw: DashboardWidgets): boolean {
  const pilot = gamePlayerGetPilot(dw.scene.gs.getPlayer(0));
  if (pilot) sgDelete(pilot.name);
  (c.parent as TrnMenu).finish();
  return true;
}

function showSavegame(dw: DashboardWidgets): void {
  const p1 = dw.scene.gs.getPlayer(0);
  const chr = dw.savegames?.[dw.index];
  if (chr) gamePlayerSetPilot(p1, chr.pilot);
  dw.scene.update();
}

/** lab_dash_main_chr_left() */
export function labDashMainChrLeft(_c: Component, dw: DashboardWidgets): boolean {
  dw.index = ((dw.index - 1) << 16) >> 16; // int16_t
  if (dw.index < 0) dw.index = (dw.savegames?.length ?? 0) - 1;
  showSavegame(dw);
  return true;
}

/** lab_dash_main_chr_right() */
export function labDashMainChrRight(_c: Component, dw: DashboardWidgets): boolean {
  dw.index = ((dw.index + 1) << 16) >> 16; // int16_t
  if (dw.index >= (dw.savegames?.length ?? 0)) dw.index = 0;
  showSavegame(dw);
  return true;
}

/** lab_dash_main_chr_init(): loads the other save games and shows the first one. */
export function labDashMainChrInit(_menu: TrnMenu, submenu: TrnMenu): void {
  const dw = submenu.getUserdata() as DashboardWidgets;
  const p1 = dw.scene.gs.getPlayer(0);
  // find the current character, if any, and exclude them
  const all = sgLoadAll();
  dw.savegames = all.filter((chr) => !(p1.chr && p1.chr.pilot.name === chr.pilot.name));
  dw.index = 0;
  // and set the first pilot in the list to be the loaded one (the reference crashes on an empty list)
  const chr = dw.savegames[0];
  if (chr) gamePlayerSetPilot(p1, chr.pilot);
  const pilot = gamePlayerGetPilot(p1);
  if (!p1.chr && pilot) dw.scene.mechlabLoadHar(pilot);
  dw.scene.update();
}

/**
 * lab_dash_main_chr_done(): whether the user selected something or backed out, the pilot goes back to the loaded
 * character, or to nothing when no character is loaded (player 1's pilot becomes null, like the reference).
 */
export function labDashMainChrDone(_menu: TrnMenu, submenu: TrnMenu): void {
  const dw = submenu.getUserdata() as DashboardWidgets;
  const p1 = dw.scene.gs.getPlayer(0);
  if (p1.chr) {
    // character is loaded, revert the pilot to it
    gamePlayerSetPilot(p1, p1.chr.pilot);
  } else if (gamePlayerGetPilot(p1)) {
    // no character is loaded, we need to go back to nothing
    if (dw.pilot) dw.pilot.photo = null;
    gamePlayerSetPilot(p1, null);
  }
  dw.savegames = null;
  dw.scene.update();
}

// ---- SIM dashboard --------------------------------------------------------------------------------------------------

/** lab_dash_sim_update_portraits(): the 5 photos around the selected rank. */
function labDashSimUpdatePortraits(dw: DashboardWidgets): void {
  const p1 = dw.scene.gs.getPlayer(0);
  const chr = p1.chr!;
  const pilot = p1.pilot;

  // try to center the opponent in the 5 element carousel
  let start = dw.simRank - 2;
  // (reference TODO: count other CHR pilots here)
  const totalCharacters = chr.pilot.enemiesExUnranked + 1;
  // make sure we don't go off the end of the list
  while (start + 4 > totalCharacters) start--;
  if (start < 1) start = 1;
  for (let i = start, j = 0; j < 5 && i <= totalCharacters; i++) {
    if (i < 1) continue;
    if (i === dw.simRank) dw.photoHighlight!.setPosHints(6 + j * 60, -1);
    dw.ranks[j].setText(`Rank\n${i}`);
    if (i === pilot.rank) {
      dw.photo[j].setFromSprite(pilot.photo);
      j++;
      continue;
    }
    for (let k = 0; k < chr.pilot.enemiesExUnranked; k++) {
      if (chr.enemies[k].pilot.rank === i) {
        dw.photo[j].setFromSprite(chr.enemies[k].pilot.photo);
        j++;
        break;
      }
    }
  }

  const parent = dw.photoHighlight!.parent!;
  parent.layout(parent.x, parent.y, parent.w, parent.h);
}

function simSelect(dw: DashboardWidgets): boolean {
  const p1 = dw.scene.gs.getPlayer(0);
  const chr = p1.chr!;
  if (dw.simRank === p1.pilot.rank) {
    labDashSimUpdate(dw.scene, dw, p1.pilot);
    // cannot select yourself
    return false;
  }
  for (let i = 0; i < chr.pilot.enemiesExUnranked; i++) {
    if (chr.enemies[i].pilot.rank === dw.simRank) labDashSimUpdate(dw.scene, dw, chr.enemies[i].pilot);
  }
  return true;
}

/** lab_dash_sim_left() */
export function labDashSimLeft(_c: Component, dw: DashboardWidgets): boolean {
  if (dw.simRank > 1) dw.simRank--;
  return simSelect(dw);
}

/** lab_dash_sim_right() */
export function labDashSimRight(_c: Component, dw: DashboardWidgets): boolean {
  const p1 = dw.scene.gs.getPlayer(0);
  if (dw.simRank <= p1.chr!.pilot.enemiesExUnranked) dw.simRank = (dw.simRank + 1) & 0xff;
  return simSelect(dw);
}

/** lab_dash_sim_init(): starts at the opponent ranked just above the player. */
export function labDashSimInit(_menu: TrnMenu, submenu: TrnMenu): void {
  const dw = submenu.getUserdata() as DashboardWidgets;
  const p1 = dw.scene.gs.getPlayer(0);
  const chr = p1.chr!;
  dw.simRank = (p1.pilot.rank - 1) & 0xff;
  if (dw.simRank === 0) dw.simRank = 2;
  for (let i = 0; i < chr.pilot.enemiesExUnranked; i++) {
    if (chr.enemies[i].pilot.rank === dw.simRank) {
      dw.pilot = chr.enemies[i].pilot;
      break;
    }
  }
  // (reference TODO: load the other CHR files and add them as unranked opponents)
  labDashSimUpdate(dw.scene, dw, dw.pilot!);
}

/** lab_dash_sim_done(): sets up the simulated fight (no money, rank or record changes) and goes to the VS screen. */
export function labDashSimDone(_menu: TrnMenu, submenu: TrnMenu): void {
  const dw = submenu.getUserdata() as DashboardWidgets;
  const gs = dw.scene.gs;
  gs.matchSettings.sim = true;
  const p1 = gs.getPlayer(0);
  const p2 = gs.getPlayer(1);
  const chr = p1.chr!;

  if (dw.simRank === p1.pilot.rank) {
    return;
  } else if (dw.simRank > chr.pilot.enemiesExUnranked + 1) {
    // (reference TODO: other player characters for a 2 player match)
    return;
  } else {
    for (let i = 0; i < chr.pilot.enemiesExUnranked; i++) {
      if (chr.enemies[i].pilot.rank === dw.simRank) gamePlayerSetPilot(p2, chr.enemies[i].pilot);
    }
    const difficulty = tournamentAiDifficulty(p1.pilot.difficulty);
    const p2Pilot = gamePlayerGetPilot(p2);
    if (!p2Pilot) return; // (no opponent with that rank: the reference would crash)
    const ctrl = createAiController(gs, difficulty, p2Pilot, p2Pilot.pilotId);
    p1.score.setDifficulty(difficulty);
    p2.setCtrl(ctrl);
  }

  // reset the score between matches in tournament mode; assume we used the score by now if we need it for
  // winnings calculations, etc
  p1.score.resetWins();
  p1.score.reset(true);
  // doesn't need to be selectable (sic: it is set selectable, so player 1 picks the arena)
  p2.selectable = true;
  gs.setNext(SceneId.VS);
}

// ---- dashboards -----------------------------------------------------------------------------------------------------

/** lab_dash_main_create(): pilot photo, record, money, HAR name/moves and the stat gauges. */
export function labDashMainCreate(s: MechlabScene, dw: DashboardWidgets): XYSizer {
  const xy = new XYSizer();

  dw.scene = s;
  const p1 = s.gs.getPlayer(0);
  const pilot = p1.pilot;
  dw.pilot = pilot;

  dw.savegames = null;
  dw.index = 0;

  // Pilot image
  dw.photo = [new Portrait(0)];
  if (pilot.photo) {
    dw.photo[0].setFromSprite(pilot.photo);
  } else {
    // selecting default pilot photo
    pilot.photoId = dw.photo[0].getSelected();
    pilot.photo = portraitLoad(pilot.palette, 0);
  }

  paletteLoadPlayerColors(pilot.palette, 0);

  xy.attachAt(dw.photo[0], 12, -1, -1, -1);

  // Texts
  dw.name = smallLabel('NO NAME', MECHLAB_BRIGHT_GREEN);
  dw.rank = smallLabel('RANK: 0', MECHLAB_DARK_GREEN);
  dw.wins = smallLabel('WINS: 0', MECHLAB_DARK_GREEN);
  dw.losses = smallLabel('LOSES: 0', MECHLAB_DARK_GREEN);
  dw.money = smallLabel('MONEY: $ 0K', MECHLAB_DARK_GREEN);
  dw.tournament = smallLabel('NO TOURNAMENT', MECHLAB_BRIGHT_GREEN);
  dw.harName = smallLabel('HAR NAME', MECHLAB_BRIGHT_GREEN);
  dw.harName.halign = HAlign.CENTER;
  dw.harMoves = smallLabel('HAR MOVES', MECHLAB_BRIGHT_GREEN);
  dw.harMoves.halign = HAlign.CENTER;

  xy.attachAt(dw.name, 12, 58, 200, 6);
  xy.attachAt(dw.rank, 18, 64, 200, 6);
  xy.attachAt(dw.wins, 18, 70, 200, 6);
  xy.attachAt(dw.losses, 12, 76, 200, 6);
  xy.attachAt(dw.money, 12, 82, 200, 6);
  xy.attachAt(dw.tournament, 12, 88, 200, 6);
  xy.attachAt(dw.harName, 220, 2, 100, 6);
  xy.attachAt(dw.harMoves, 220, 19, 100, 70);

  return labDashMainCreateGauges(xy, dw, pilot);
}

/** lab_dash_sim_create(): 5 photos with ranks around the selected opponent, its record and stat gauges. */
export function labDashSimCreate(s: MechlabScene, dw: DashboardWidgets): XYSizer {
  const xy = new XYSizer();

  dw.scene = s;
  const p1 = s.gs.getPlayer(0);
  const chr = p1.chr!;

  // Pilot image
  dw.simRank = (p1.pilot.rank - 1) & 0xff;
  if (dw.simRank < 1) dw.simRank = 2;
  for (let i = 0; i < chr.pilot.enemiesExUnranked; i++) {
    if (chr.enemies[i].pilot.rank === dw.simRank) {
      dw.pilot = chr.enemies[i].pilot;
      break;
    }
  }

  const sur = new Surface(60, 70, new Uint8Array(60 * 70).fill(0xf8), 0);
  sur.source = { kind: 'generated', key: 'mechlab/sim-highlight' };
  dw.photoHighlight = new SpriteImage(sur);
  dw.photoHighlight.setOwnsSprite(true);

  xy.attachAt(dw.photoHighlight, 6 + 2 * 60, -1, -1, -1);

  dw.photo = [];
  dw.ranks = [];
  for (let i = 0; i < 5; i++) {
    dw.photo[i] = new Portrait(0);
    xy.attachAt(dw.photo[i], 6 + i * 60, -1, -1, -1);
    const rank = smallLabel('NO RANK', TEXT_MEDIUM_GREEN);
    rank.halign = HAlign.CENTER;
    dw.ranks[i] = rank;
    xy.attachAt(rank, 6 + i * 60, 58, 50, -1);
  }

  labDashSimUpdatePortraits(dw);

  // Texts
  dw.name = smallLabel('NAME: NO NAME', TEXT_DARK_GREEN);
  dw.harName = smallLabel('MODEL: NO MODEL', TEXT_DARK_GREEN);
  dw.wins = smallLabel('WINS: 0', TEXT_DARK_GREEN);
  dw.losses = smallLabel('LOSES: 0', TEXT_DARK_GREEN);

  xy.attachAt(dw.name, 18, 70, 200, 6);
  xy.attachAt(dw.harName, 12, 76, 200, 6);
  xy.attachAt(dw.wins, 168, 70, 200, 6);
  xy.attachAt(dw.losses, 162, 76, 200, 6);

  return labDashMainCreateGauges(xy, dw, dw.pilot!);
}

/** The robot's special moves as the dashboard lists them (the remaster's robots name theirs in their definitions). */
function harMovesText(harId: number): string {
  if (harId < ORIGINAL_HAR_TYPES) return langGet(492 + harId);
  // (in the originals' style: "Ice Lance")
  const names = Object.values(genRobot(harId)?.specialNames ?? {}).map((n) => n.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()));
  return `SPECIAL MOVES:\n\n${names.join('\n\n')}`;
}

/** lab_dash_main_create_gauges(): pilot stats (small gauges) and HAR upgrades (big gauges, sized per HAR). */
export function labDashMainCreateGauges(xy: XYSizer, dw: DashboardWidgets, pilot: Pilot): XYSizer {
  const power = smallLabel('POWER', MECHLAB_DARK_GREEN);
  const agility = smallLabel('AGILITY', MECHLAB_DARK_GREEN);
  const endurance = smallLabel('ENDURANCE', MECHLAB_DARK_GREEN);
  const armPower = smallLabel('ARM POWER', MECHLAB_DARK_GREEN);
  const legPower = smallLabel('LEG POWER', MECHLAB_DARK_GREEN);
  const armor = smallLabel('ARMOR', MECHLAB_DARK_GREEN);
  const armSpeed = smallLabel('ARM SPEED', MECHLAB_DARK_GREEN);
  const legSpeed = smallLabel('LEG SPEED', MECHLAB_DARK_GREEN);
  const stunRes = smallLabel('STUN RES', MECHLAB_DARK_GREEN);
  const har = pilot.harId;

  // Bars and texts (bottom left side)
  xy.attachAt(power, 12, 95, 200, 6);
  dw.power = new Gauge(GaugeType.SMALL, 25, 3);
  xy.attachAt(dw.power, 12, 102, -1, -1);
  xy.attachAt(agility, 12, 106, 200, 6);
  dw.agility = new Gauge(GaugeType.SMALL, 25, 3);
  xy.attachAt(dw.agility, 12, 113, -1, -1);
  xy.attachAt(endurance, 12, 117, 200, 6);
  dw.endurance = new Gauge(GaugeType.SMALL, 25, 3);
  xy.attachAt(dw.endurance, 12, 124, -1, -1);

  // Bars and texts (bottom middle)
  xy.attachAt(armPower, 125, 95, 200, 6);
  dw.armPower = new Gauge(GaugeType.BIG, MAX_ARM_POWER[har] + 1, 3);
  xy.attachAt(dw.armPower, 125, 102, -1, -1);
  xy.attachAt(legPower, 125, 106, 200, 6);
  dw.legPower = new Gauge(GaugeType.BIG, MAX_LEG_POWER[har] + 1, 3);
  xy.attachAt(dw.legPower, 125, 113, -1, -1);
  xy.attachAt(armor, 125, 117, 200, 6);
  dw.armor = new Gauge(GaugeType.BIG, MAX_ARMOR[har] + 1, 3);
  xy.attachAt(dw.armor, 125, 124, -1, -1);

  // Bars and texts (bottom right side)
  xy.attachAt(armSpeed, 228, 95, 200, 6);
  dw.armSpeed = new Gauge(GaugeType.BIG, MAX_ARM_SPEED[har] + 1, 3);
  xy.attachAt(dw.armSpeed, 228, 102, -1, -1);
  xy.attachAt(legSpeed, 228, 106, 200, 6);
  dw.legSpeed = new Gauge(GaugeType.BIG, MAX_LEG_SPEED[har] + 1, 3);
  xy.attachAt(dw.legSpeed, 228, 113, -1, -1);
  xy.attachAt(stunRes, 228, 117, 200, 6);
  dw.stunResistance = new Gauge(GaugeType.BIG, MAX_STUN_RES[har] + 1, 3);
  xy.attachAt(dw.stunResistance, 228, 124, -1, -1);

  return xy;
}

/** lab_dash_main_update(): refreshes the stats dashboard from player 1's pilot. */
export function labDashMainUpdate(s: MechlabScene, dw: DashboardWidgets): void {
  // P1 is always the one being edited in tournament dashboard
  const pilot = s.gs.getPlayer(0).pilot;

  dw.rank!.setText(pilot.rank === 0 ? 'RANK: NO RANK' : `RANK: ${pilot.rank}`);
  dw.wins!.setText(`WINS: ${pilot.wins}`);
  dw.losses!.setText(`LOSES: ${pilot.losses}`);
  dw.money!.setText(`MONEY: $ ${scoreFormat(pilot.money)}K`);

  dw.harName!.setText(langGet(31 + pilot.harId));
  dw.harMoves!.setText(harMovesText(pilot.harId));

  // Tournament and player name
  dw.name!.setText(pilot.name);
  dw.tournament!.setText(pilot.trnDesc);

  if (pilot.photo) {
    dw.photo[0].setFromSprite(pilot.photo);
  } else {
    // Select pilot picture
    dw.photo[0].select(0);
  }

  // Palette
  paletteLoadPlayerColors(pilot.palette, 0);

  labDashMainUpdateGauges(dw, pilot);
}

/** lab_dash_sim_update(): shows an opponent on the SIM dashboard. */
export function labDashSimUpdate(_s: MechlabScene, dw: DashboardWidgets, pilot: Pilot): void {
  dw.wins!.setText(`WINS: ${pilot.wins}`);
  dw.losses!.setText(`LOSES: ${pilot.losses}`);
  dw.harName!.setText(`MODEL: ${langGet(31 + pilot.harId)}`.slice(0, 63));
  dw.name!.setText(`NAME: ${pilot.name}`.slice(0, 63));

  labDashSimUpdatePortraits(dw);

  labDashMainUpdateGauges(dw, pilot);
}

/** lab_dash_main_update_gauges(): lit segments are stat + 1. */
export function labDashMainUpdateGauges(dw: DashboardWidgets, pilot: Pilot): void {
  const har = pilot.harId;
  // Pilot stats
  dw.power!.setLit(pilot.power + 1);
  dw.agility!.setLit(pilot.agility + 1);
  dw.endurance!.setLit(pilot.endurance + 1);

  dw.armPower!.setSize(MAX_ARM_POWER[har] + 1);
  dw.legPower!.setSize(MAX_LEG_POWER[har] + 1);
  dw.armor!.setSize(MAX_ARMOR[har] + 1);
  dw.armSpeed!.setSize(MAX_ARM_SPEED[har] + 1);
  dw.legSpeed!.setSize(MAX_LEG_SPEED[har] + 1);
  dw.stunResistance!.setSize(MAX_STUN_RES[har] + 1);

  // Har stats
  dw.armPower!.setLit(pilot.armPower + 1);
  dw.legPower!.setLit(pilot.legPower + 1);
  dw.armor!.setLit(pilot.armor + 1);
  dw.armSpeed!.setLit(pilot.armSpeed + 1);
  dw.legSpeed!.setLit(pilot.legSpeed + 1);
  dw.stunResistance!.setLit(pilot.stunResistance + 1);
}
