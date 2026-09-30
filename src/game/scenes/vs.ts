// VS: the pre-fight screen with both pilots and HARs, insults, and the arena selection of two-player games; in
// tournament mode it also doubles as the post-fight "Plug" financial report (player 2 has no pilot).
// Port of the reference vs scene.
import type { CtrlEvent } from '../../controller/controller';
import { isDown } from '../../controller/input';
import type { Pilot } from '../../formats/pilot';
import type { Sprite } from '../../formats/sprite';
import { Animation, RSprite } from '../../resources/animation';
import { bkGetInfo, harPicture, langGet, loadBk } from '../../resources/resources';
import { arenaDescription, arenaList, arenaName, extraRobotsEnabled, EXTRA_HAR_IDS, nextArena, pilotStyle, randomArena } from '../roster';
import { addPilotPortrait } from '../../mods/portraits';
import { modPilot, modQuote } from '../../mods/registry';
import { MOVE } from '../../gen/fighter/moveset';
import { globalRandom } from '../../util/random';
import { TAG_MENU, video } from '../../video/draw';
import { Surface } from '../../video/surface';
import {
  ACT_DOWN, ACT_ESC, ACT_KICK, ACT_LEFT, ACT_PUNCH, ACT_RIGHT, ACT_UP, CtrlType, OBJECT_FACE_LEFT, OBJECT_FACE_RIGHT,
  ORIGINAL_ARENAS, ORIGINAL_HAR_TYPES, PilotId, RENDER_LAYER_MIDDLE, RENDER_LAYER_TOP, SceneId,
} from '../constants';
import { registerScene, type FightStats, type GamePlayer, type GameState } from '../gameState';
import { Dialog, DialogResult, DialogStyle } from '../gui/dialog';
import { FontSize, GLYPH_SHADOW_BOTTOM, GLYPH_SHADOW_RIGHT, HAlign, Text, TEXT_DARK_GREEN, VAlign } from '../gui/text';
import { menuBackground, MenuBackgroundStyle } from '../gui/widgets';
import { GameObject } from '../object';
import { paletteLoadPlayerColors } from '../pilotColors';
import { Scene } from '../scene';
import { scoreFormat } from '../score';
import { settings } from '../settings';
import { calculateTradeValue, harPrice } from './mechlab/harEconomy';

const TEXT_GREEN = 0xa7;
const COLOR_GREEN = 0xa7;
const COLOR_YELLOW = 0xcf;

// fight_stats.h
export const PLUG_TEXT_START = 587;
export const PLUG_ENHANCEMENT = 0;
export const PLUG_WIN_BIG = 13;

/** lang_get(): the reference trims the trailing linebreak of every ENGLISH.DAT string when loading the language. */
function lang(id: number): string {
  const s = langGet(id);
  return s.endsWith('\n') ? s.slice(0, -1) : s;
}

/**
 * `player->pilot` can be NULL in the reference: tournament code clears player 2's pilot to request the Plug report
 * screen, and a cancelled tournament match clears it before returning to the mechlab. `GamePlayer.pilot` is typed
 * non-null in this port, so it is read defensively here: null (or undefined) means "no pilot".
 */
export function playerPilot(p: GamePlayer): Pilot | null {
  return (p.pilot as Pilot | null | undefined) ?? null;
}

function clearPlayerPilot(p: GamePlayer): void {
  (p as { pilot: Pilot | null }).pilot = null;
}

/** is_spectator() */
function isSpectator(gs: GameState): boolean {
  return gs.getPlayer(0).ctrl.type === CtrlType.SPECTATOR;
}

/** Pilot names never end in a linebreak in the reference (see lang()); strip one left by other code paths. */
function pilotName(p: Pilot): string {
  return p.name.endsWith('\n') ? p.name.slice(0, -1) : p.name;
}

/** Minimal snprintf for the language strings (%s, %d, %u, %%), truncated like a 256 byte buffer. */
function cFormat(fmt: string, ...args: (string | number)[]): string {
  let ai = 0;
  const out = fmt.replace(/%([%sdui])/g, (_m, c: string) => {
    if (c === '%') return '%';
    const a = args[ai++];
    if (c === 's') return String(a ?? '');
    return String(Math.trunc(Number(a ?? 0)));
  });
  return out.slice(0, 255);
}

/** printf("%u") */
function fmtU(n: number): string {
  return String(Math.trunc(n) >>> 0);
}

/** printf("%.1f") of a C float: exact binary value, ties rounded to even like glibc. */
function fmtF1(v: number): string {
  let f = Math.fround(v);
  const neg = f < 0;
  if (neg) f = -f;
  const scaled = f * 10; // exact in double for float32 inputs
  let r = Math.floor(scaled);
  const frac = scaled - r;
  if (frac > 0.5 || (frac === 0.5 && r % 2 !== 0)) r += 1;
  return `${neg && r !== 0 ? '-' : ''}${Math.trunc(r / 10)}.${r % 10}`;
}

/**
 * Even indexes go to the left, odd to the right. Welder does an additional roll for the 3 places on the torso.
 */
function spawnPosition(index: number, scientist: boolean): [number, number] {
  switch (index) {
    case 0:
      // top left gantry
      if (scientist) return [90, 80];
      switch (globalRandom.int(3)) {
        case 0:
          return [90, 80]; // middle
        case 1:
          return [30, 80]; // left arm
        case 2:
          return [120, 80]; // right arm
      }
      break;
    case 1:
      // top right gantry
      if (scientist) return [230, 80];
      switch (globalRandom.int(3)) {
        case 0:
          return [230, 80]; // middle
        case 1:
          return [200, 80]; // left arm
        case 2:
          return [260, 80]; // right arm
      }
      break;
    case 2:
      return [90, 118]; // middle left gantry
    case 3:
      return [230, 118]; // middle right gantry
    // only welder can use the following
    case 4:
      return [90, 150]; // bottom left gantry
    case 5:
      return [230, 150]; // bottom right gantry
  }
  return [160, 200];
}

interface ReportCard {
  plugWhine: Text;
  reportTitle: Text;
  reportLeft: Text;
  reportRight: Text;
  statsTitle: Text;
  statsSelfLeft: Text;
  statsSelfRight: Text;
  opponentTitle: Text;
  opponentRight: Text;
}

/** Text for the end-of-tournament stats titles */
function createTitleText(str: string): Text {
  return new Text(FontSize.SMALL, 150, 30, str).setColor(TEXT_GREEN).setHAlign(HAlign.CENTER);
}

/** Text for the end-of-tournament stats labels */
function createLabelsText(str: string): Text {
  return new Text(FontSize.SMALL, 150, 30, str).setColor(TEXT_DARK_GREEN).setLineSpacing(1).setHAlign(HAlign.RIGHT);
}

/** Text for the end-of-tournament stats values (money, etc.) */
function createValuesText(str: string): Text {
  return new Text(FontSize.SMALL, 150, 30, str).setColor(TEXT_GREEN).setLineSpacing(1).setHAlign(HAlign.LEFT);
}

/** Statistics texts for the tournament Plug screen. */
function createReportCard(fs: FightStats): ReportCard {
  const plugWhine = new Text(FontSize.SMALL, 200, 55)
    .setColor(COLOR_YELLOW)
    .setShadow(GLYPH_SHADOW_RIGHT | GLYPH_SHADOW_BOTTOM)
    .setShadowColor(202)
    .setHAlign(HAlign.CENTER);
  plugWhine.set(cFormat(lang(fs.plugText + PLUG_TEXT_START), fs.sold));

  // These are all static. Note that for opponent labels, we reuse the own stats label.
  const money = [fs.winnings, fs.bonuses, fs.repairCost, fs.profit].map((m) => scoreFormat(m));
  return {
    plugWhine,
    reportTitle: createTitleText('FINANCIAL REPORT'),
    statsTitle: createTitleText('FIGHT\nSTATISTICS'),
    opponentTitle: createTitleText('OPPONENT'),
    reportLeft: createLabelsText('WINNINGS:\nBONUSES:\nREPAIR COST:\nPROFIT:'),
    statsSelfLeft: createLabelsText('HITS LANDED:\nAVERAGE DAMAGE:\nFAILED ATTACKS:\nHIT/MISS RATIO:'),
    reportRight: createValuesText(`$ ${money[0]}K\n$ ${money[1]}K\n$ ${money[2]}K\n$ ${money[3]}K`),
    statsSelfRight: createValuesText(
      `${fmtU(fs.hitsLanded[0])}\n${fmtF1(fs.averageDamage[0])}\n${fmtU(fs.totalAttacks[0] - fs.hitsLanded[0])}\n${fmtU(fs.hitMissRatio[0])}%`,
    ),
    opponentRight: createValuesText(
      `${fmtU(fs.hitsLanded[1])}\n${fmtF1(fs.averageDamage[1])}\n${fmtU(fs.totalAttacks[1] - fs.hitsLanded[1])}\n${fmtU(fs.hitMissRatio[1])}%`,
    ),
  };
}

/** The top "X VS. Y" title. */
function createVsText(str: string): Text {
  return new Text(FontSize.SMALL, 320, 6, str)
    .setHAlign(HAlign.CENTER)
    .setColor(COLOR_YELLOW)
    .setShadowColor(202)
    .setShadow(GLYPH_SHADOW_RIGHT | GLYPH_SHADOW_BOTTOM);
}

/** Arena name and description in two-player games. */
function createArenaText(str: string, w: number, h: number): Text {
  return new Text(FontSize.SMALL, w, h, str).setHAlign(HAlign.CENTER).setVAlign(VAlign.MIDDLE).setColor(COLOR_GREEN);
}

function createInsultText(str: string, w: number, h: number): Text {
  return new Text(FontSize.SMALL, w, h, str).setHAlign(HAlign.CENTER).setVAlign(VAlign.MIDDLE).setColor(COLOR_YELLOW);
}

/** sprite_create(photo) + create_animation_from_single(): a portrait object animation made of one photo. */
function photoAnimation(photo: Sprite | null, key: string): Animation {
  let surf: Surface | null = null;
  if (photo && photo.width > 0 && photo.height > 0) {
    surf = Surface.fromSprite(photo);
    surf.source = { kind: 'photo', key };
  }
  return Animation.fromSingle(new RSprite(-1, photo?.posX ?? 0, photo?.posY ?? 0, surf), 0, 0);
}

export class VsScene extends Scene {
  arenaSelectObjId = 0;
  arenaSelectBg: Surface;
  quitDialog: Dialog;
  tooPatheticDialog: Dialog;

  vsText: Text | null = null;
  insults: (Text | null)[] = [null, null];
  arenaName: Text | null = null;
  arenaDesc: Text | null = null;

  report: ReportCard | null = null;

  /** vs_create */
  constructor(gs: GameState) {
    super(gs, SceneId.VS);

    // Initialize Demo
    if (gs.isDemoplay()) gs.initDemo();

    const player1 = gs.getPlayer(0);
    const player2 = gs.getPlayer(1);
    const p2Pilot = playerPilot(player2);

    if (p2Pilot === null) {
      // display the financial report with your host Plug!

      // generate a new HAR trade list based on your HAR's value and your money
      // TODO (reference) figure out how this really works, but this'll do for now
      const tradeValue = calculateTradeValue(player1.pilot);
      // (the remaster's robots too, when they are turned on)
      const tradeable = [...Array.from({ length: 11 }, (_, i) => i), ...(extraRobotsEnabled() ? EXTRA_HAR_IDS : [])];
      const trades: number[] = new Array(tradeable.length).fill(-1);
      let tradecount = 0;

      // collect all the HARs we can afford that are not the current model
      for (const i of tradeable) {
        if (i === player1.pilot.harId) continue; // don't trade for the current HAR
        if (harPrice(i) < tradeValue + player1.pilot.money) {
          trades[tradecount] = i;
          tradecount++;
        }
      }

      // choose 5 random ones and pack them into the bitmask
      let newTrades = 0;
      for (let i = 0; i < Math.min(5, tradecount); ) {
        const choice = globalRandom.int(tradecount);
        if (trades[choice] !== -1) {
          newTrades |= 1 << trades[choice];
          trades[choice] = -1;
          i++;
        }
      }
      player1.pilot.harTrades = newTrades & 0xffff;
    } else {
      // snprintf(title, 128, "%s VS. %s", ...)
      this.vsText = createVsText(`${pilotName(player1.pilot)} VS. ${pilotName(p2Pilot)}`.slice(0, 127));
    }

    // Set player palettes
    paletteLoadPlayerColors(player1.pilot.palette, 0);
    if (p2Pilot) paletteLoadPlayerColors(p2Pilot.palette, 1);

    // HAR
    let ani = bkGetInfo(this.bk, 5)!.ani;
    // The robots' images carry pieces of the holding bay around them (shadows, stripes, railings): the remastered
    // renderer shows only the robots of their artwork, over the HD holding bay.
    for (const sp of ani.sprites) if (sp.surface) sp.surface.hdOwnColors = true;
    // The remaster's robots (HARs 11 and up) bring their big image in their fighter files.
    for (const id of [player1.pilot.harId, p2Pilot?.harId ?? -1]) {
      // (VS.BK has an empty placeholder in slot 11: the new robots always bring theirs.)
      if (id < ORIGINAL_HAR_TYPES) continue;
      const pic = harPicture(id, MOVE.PORTRAIT_VS);
      if (!pic) continue;
      while (ani.sprites.length < id) ani.sprites.push(new RSprite(ani.sprites.length, 0, 0, null));
      ani.sprites[id] = new RSprite(id, -(pic.surface.w + 12), 152 - pic.surface.h, pic.surface);
    }
    const player1Har = new GameObject(gs, 160, 0);
    player1Har.setAnimation(ani);
    player1Har.selectSprite(player1.pilot.harId);
    player1Har.setHalt(1);
    gs.addObject(player1Har, RENDER_LAYER_MIDDLE, false, false);

    if (p2Pilot) {
      const player2Har = new GameObject(gs, 160, 0);
      player2Har.setAnimation(ani);
      player2Har.selectSprite(p2Pilot.harId);
      player2Har.direction = OBJECT_FACE_LEFT;
      player2Har.palOffset = 48;
      player2Har.palLimit = 96;
      player2Har.setHalt(1);
      gs.addObject(player2Har, RENDER_LAYER_MIDDLE, false, false);

      // PLAYER
      const player1Portrait = new GameObject(gs, -10, 150);
      ani = bkGetInfo(this.bk, 4)!.ani;
      // (mod pilots bring their portraits)
      for (const id of [player1.pilot.pilotId, p2Pilot.pilotId]) addPilotPortrait(ani, id, this.bk.palettes[0]);
      if (player1.chr) {
        player1Portrait.setSpriteOverride(true);
        player1Portrait.setAnimation(photoAnimation(player1.chr.photo, `photo/${player1.chr.pilot.photoId}`));
        player1Portrait.curSpriteId = 0;
      } else {
        player1Portrait.setAnimation(ani);
        player1Portrait.selectSprite(player1.pilot.pilotId);
      }
      player1Portrait.setHalt(1);
      gs.addObject(player1Portrait, RENDER_LAYER_TOP, false, false);

      const player2Portrait = new GameObject(gs, 330, 150);
      if (player1.chr) {
        player2Portrait.setSpriteOverride(true);
        player2Portrait.setAnimation(photoAnimation(p2Pilot.photo, `photo/${p2Pilot.photoId}`));
        player2Portrait.curSpriteId = 0;
      } else {
        player2Portrait.setAnimation(ani);
        player2Portrait.selectSprite(p2Pilot.pilotId);
      }
      player2Portrait.direction = OBJECT_FACE_LEFT;
      player2Portrait.setHalt(1);
      gs.addObject(player2Portrait, RENDER_LAYER_TOP, false, false);
    } else {
      // plug time!
      const fightStats = gs.fightStats;
      const plug = new GameObject(gs, -10, 150);
      ani = bkGetInfo(this.bk, 2)!.ani;
      plug.setAnimation(ani);
      // plug should be happy, sometimes? he is happy on frame 1
      if (fightStats.plugText === PLUG_ENHANCEMENT || fightStats.plugText === PLUG_WIN_BIG) plug.selectSprite(1);
      else plug.selectSprite(0);
      plug.setHalt(1);
      gs.addObject(plug, RENDER_LAYER_TOP, false, false);
      this.report = createReportCard(fightStats); // statistics texts to the right side of the scene

      // Let's add some scrapes (on a private copy of the sprite: loadBk() shares decoded pixels between loads)
      const harSprite = player1Har.curAnimation!.getSprite(player1.pilot.harId);
      ani = bkGetInfo(this.bk, 9)!.ani;
      const nScrapes = fightStats.maxHp !== 0 ? Math.trunc(((fightStats.maxHp - fightStats.hp) * 170) / fightStats.maxHp) : 0;
      if (harSprite && harSprite.surface) {
        const surf = harSprite.surface.clone();
        surf.source = { kind: 'generated', key: `vs/scraped-har/${player1.pilot.harId}` };
        harSprite.surface = surf;
        for (let n = 0; n < nScrapes; n++) {
          const scrapeNo = globalRandom.int(ani.spriteCount());
          // (C leaves the evaluation order of the two position rolls unspecified; x is rolled first here)
          const x = globalRandom.int(160);
          const y = globalRandom.int(120);
          const decal = ani.getSprite(scrapeNo)?.surface;
          if (decal) surf.multiplyDecal(decal, x, y);
        }
      }
    }

    if (p2Pilot !== null) {
      // clone the left side of the background image, mirrored, onto the right side
      // (the reference edits the scene background in place; loadBk() shares its pixels between loads)
      const bg = this.bk.background.clone();
      bg.blit(this.bk.background, 160, 0, 0, 0, 160, 200, true);
      bg.source = { kind: 'background', key: `${this.bk.file}/bg#mirror` };
      // (the remastered renderer mirrors the original's artwork the same way)
      bg.hdSource = { surf: this.bk.background, x: 0, y: 0, gray: false, mirror: true };
      this.bk.background = bg;
    }

    if (player2.selectable && !isSpectator(gs)) {
      // player1 gets to choose, start at arena 0
      gs.arena = 0;
      this.arenaName = createArenaText(arenaName(gs.arena), 211 - 74, 6);
      this.arenaDesc = createArenaText(arenaDescription(gs.arena), 211 - 74, 50);
    } else if (p2Pilot && p2Pilot.pilotId === PilotId.KREISSACK) {
      // force arena 0 when fighting Kreissack in 1 player mode
      gs.arena = 0;
    } else if (gs.isTournament() || gs.isDemoplay()) {
      // pick random arenas (the remaster's arenas too when they are turned on, and the mods')
      gs.arena = randomArena();
    } else if (isSpectator(gs)) {
      this.arenaName = createArenaText(arenaName(gs.arena), 211 - 74, 6);
      this.arenaDesc = createArenaText(arenaDescription(gs.arena), 211 - 74, 50);
    } else {
      // 1 player mode cycles through the arenas (the arena scene advances gs.arena after each win)
    }

    // Insults
    const easyKreissack = p2Pilot !== null && p2Pilot.pilotId === PilotId.KREISSACK && settings().gameplay.difficulty < 2 && !gs.modeRun;
    if (easyKreissack) {
      // kreissack, but not on Veteran or higher
      this.insults = [null, createInsultText(lang(747), 170, 60)];
    } else if (player1.chr && p2Pilot) {
      // tournament mode
      this.insults = [null, createInsultText(p2Pilot.quotes[0] ?? '', 150, 60)];
    } else if (p2Pilot) {
      // 1 player (a mod pilot says its own lines; the originals speak to it as to the pilot it plays like)
      const a = player1.pilot.pilotId, b = p2Pilot.pilotId;
      this.insults = [
        createInsultText(modPilot(a) ? modQuote(a, 0) : lang(749 + 11 * a + pilotStyle(b)), 150, 30),
        createInsultText(modPilot(b) ? modQuote(b, 1) : lang(870 + 11 * b + pilotStyle(a)), 150, 30),
      ];
    }

    // Arena
    if (player2.selectable) {
      ani = bkGetInfo(this.bk, 3)!.ani;
      this.addArenaThumbnails(ani);
      const arenaSelect = new GameObject(gs, 59, 155);
      this.arenaSelectObjId = arenaSelect.id;
      arenaSelect.setAnimation(ani);
      arenaSelect.selectSprite(gs.arena);
      arenaSelect.setHalt(1);
      gs.addObject(arenaSelect, RENDER_LAYER_TOP, false, false);
    }

    // SCIENTIST
    let scientistpos = globalRandom.int(4);
    if (!p2Pilot && scientistpos % 2 === 1) {
      // there is no right hand gantry so if the position is odd, sub 1 to force it to the left side
      scientistpos -= 1;
    }
    const scientistcoord = spawnPosition(scientistpos, true);
    if (scientistpos % 2) scientistcoord[0] += 50;
    else scientistcoord[0] -= 50;
    const oScientist = new GameObject(gs, scientistcoord[0], scientistcoord[1]);
    ani = bkGetInfo(this.bk, 8)!.ani;
    oScientist.setAnimation(ani);
    oScientist.selectSprite(0);
    oScientist.direction = scientistpos % 2 ? OBJECT_FACE_LEFT : OBJECT_FACE_RIGHT;
    gs.addObject(oScientist, RENDER_LAYER_MIDDLE, false, false);

    // WELDER
    let welderpos = globalRandom.int(6);
    // On non-tournament mode, the welder cannot be on the same gantry or the same *side* as the scientist; he also
    // can't be on the same 'level' but he has 10 possible starting positions
    if (p2Pilot) {
      while (
        welderpos % 2 === scientistpos % 2 ||
        (scientistpos < 2 && welderpos < 2) ||
        (scientistpos > 1 && welderpos > 1 && welderpos < 4)
      ) {
        welderpos = globalRandom.int(6);
      }
    } else {
      // On tournament mode, the welder cannot be on the same level as the scientist.
      while (welderpos % 2 === 1 || scientistpos === welderpos) welderpos = globalRandom.int(3) * 2;
    }
    const welderCoord = spawnPosition(welderpos, false);
    const oWelder = new GameObject(gs, welderCoord[0], welderCoord[1]);
    ani = bkGetInfo(this.bk, 7)!.ani;
    oWelder.setAnimation(ani);
    oWelder.selectSprite(0);
    oWelder.animationState.spawn = (p, id, x, y, vx, vy, mp) => this.vsSpawnObject(p, id, x, y, vx, vy, mp);
    oWelder.animationState.destroy = (p, id) => this.vsDestroyObject(p, id);
    oWelder.direction = welderpos % 2 ? OBJECT_FACE_LEFT : OBJECT_FACE_RIGHT;
    gs.addObject(oWelder, RENDER_LAYER_MIDDLE, false, false);

    // GANTRIES
    const oGantryA = new GameObject(gs, 0, 0);
    ani = bkGetInfo(this.bk, 11)!.ani;
    oGantryA.setAnimation(ani);
    oGantryA.selectSprite(0);
    gs.addObject(oGantryA, RENDER_LAYER_TOP, false, false);

    if (p2Pilot) {
      const oGantryB = new GameObject(gs, 320, 0);
      oGantryB.setAnimation(ani);
      oGantryB.selectSprite(0);
      oGantryB.direction = OBJECT_FACE_LEFT;
      gs.addObject(oGantryB, RENDER_LAYER_TOP, false, false);
    }

    // Background tex
    this.arenaSelectBg = menuBackground(211, 50, MenuBackgroundStyle.MELEE_VS);

    // Quit Dialog
    this.quitDialog = new Dialog(DialogStyle.YES_NO, 'Are you sure you want to quit this game?', 72, 60);
    this.quitDialog.userdata = this;
    this.quitDialog.clicked = (dlg, result) => this.quitDialogClicked(dlg, result);

    // Too Pathetic Dialog
    let insult = lang(748);
    insult = insult.replace('%s', () => lang(345));
    insult = insult.replace('%s', () => lang(30));
    // XXX HACK (reference): Remove newline after kreissack's name until we clean up our string tables
    insult = insult.split('\n.').join('.');
    this.tooPatheticDialog = new Dialog(DialogStyle.OK, insult, 40, 40);
    this.tooPatheticDialog.userdata = this;
    this.tooPatheticDialog.clicked = (dlg, result) => this.tooPatheticDialogClicked(dlg, result);

    if (easyKreissack) {
      // kreissack, but not on Veteran or higher
      this.tooPatheticDialog.show(true);
    }
  }

  /** cb_vs_spawn_object */
  private vsSpawnObject(parent: GameObject, id: number, x: number, y: number, vx: number, vy: number, _mpFlags: number): void {
    // Get next animation
    const info = bkGetInfo(this.bk, id);
    if (!info) return;
    const obj = new GameObject(parent.gs, x + parent.px(), y + parent.py(), vx, vy);
    obj.soundTranslationTable = parent.soundTranslationTable;
    obj.setAnimation(info.ani);
    obj.animationState.spawn = (p, sid, sx, sy, svx, svy, smp) => this.vsSpawnObject(p, sid, sx, sy, svx, svy, smp);
    obj.animationState.destroy = (p, did) => this.vsDestroyObject(p, did);
    this.gs.addObject(obj, RENDER_LAYER_MIDDLE, false, false);
  }

  /** cb_vs_destroy_object */
  private vsDestroyObject(_parent: GameObject, id: number): void {
    this.gs.delAnimation(id);
  }

  /** vs_handle_action */
  /** Mouse (not in the original game): a click continues like the punch button; dialogs get their own clicks first. */
  override pointer(_x: number, _y: number, kind: import('../../controller/mouse').PointerKind): boolean {
    if (kind !== 'click') return false;
    this.handleAction(ACT_PUNCH, CtrlType.KEYBOARD);
    return true;
  }

  handleAction(action: number, source: CtrlType): void {
    const gs = this.gs;
    if (this.tooPatheticDialog.isVisible()) {
      this.tooPatheticDialog.event(action, source);
    } else if (this.quitDialog.isVisible()) {
      this.quitDialog.event(action, source);
    } else {
      const player2 = gs.getPlayer(1);
      switch (action) {
        case ACT_KICK:
        case ACT_PUNCH:
          if (playerPilot(player2)) {
            gs.setNext(SceneId.ARENA0 + gs.arena);
          } else {
            clearPlayerPilot(player2);
            if (gs.fightStats.challenger) {
              // unranked challenger time
              gs.setNext(SceneId.NEWSROOM);
            } else {
              gs.setNext(SceneId.MECHLAB);
            }
          }
          break;
        case ACT_UP:
        case ACT_LEFT:
          if (player2.selectable) {
            gs.arena = nextArena(gs.arena, -1);
            this.arenaChanged();
          }
          break;
        case ACT_DOWN:
        case ACT_RIGHT:
          if (player2.selectable) {
            gs.arena = nextArena(gs.arena);
            this.arenaChanged();
          }
          break;
      }
    }
  }

  private arenaChanged(): void {
    const gs = this.gs;
    gs.findObject(this.arenaSelectObjId)?.selectSprite(gs.arena);
    this.arenaName?.set(arenaName(gs.arena));
    this.arenaDesc?.set(arenaDescription(gs.arena));
  }

  /**
   * Preview pictures for the remaster's arenas and the mods', like the originals' (64x40, in the originals' grey
   * shades): their backgrounds shrunk five times.
   */
  private addArenaThumbnails(ani: Animation): void {
    const extra = arenaList().filter((a) => a >= ORIGINAL_ARENAS);
    if (!extra.length) return;
    const pal = this.bk.palettes[0];
    // The shades the original previews are drawn with, darkest to brightest.
    const shades = new Set<number>();
    for (const sp of ani.sprites) if (sp.surface) for (const v of sp.surface.data) shades.add(v);
    const lum = (i: number) => pal.r(i) * 0.3 + pal.g(i) * 0.59 + pal.b(i) * 0.11;
    const ramp = [...shades].filter((v) => v > 0).sort((a, b) => lum(a) - lum(b));
    if (ramp.length === 0) return;
    for (const index of extra) {
      if (ani.sprites[index]?.surface) continue;
      const bk = loadBk(`ARENA${index}.BK`);
      const src = bk.background, apal = bk.palettes[0];
      const thumb = new Surface(64, 40, undefined, -1);
      for (let y = 0; y < 40; y++) {
        for (let x = 0; x < 64; x++) {
          let l = 0;
          for (let dy = 0; dy < 5; dy++) {
            for (let dx = 0; dx < 5; dx++) {
              const v = src.data[(y * 5 + dy) * 320 + x * 5 + dx];
              l += apal.r(v) * 0.3 + apal.g(v) * 0.59 + apal.b(v) * 0.11;
            }
          }
          l /= 25;
          // Nearest shade by brightness (the previews are grey).
          let best = ramp[0];
          for (const v of ramp) if (Math.abs(lum(v) - l * 1.15) < Math.abs(lum(best) - l * 1.15)) best = v;
          thumb.data[y * 64 + x] = best;
        }
      }
      thumb.source = { kind: 'generated', key: `vs/arena-thumb/${index}` };
      while (ani.sprites.length < index) ani.sprites.push(new RSprite(ani.sprites.length, 0, 0, null));
      ani.sprites[index] = new RSprite(index, 0, 0, thumb);
    }
  }

  // vs_dynamic_tick only forwards the extra events of network controllers; netplay is not part of this port.

  /** vs_static_tick */
  override staticTick(_paused: boolean): void {
    if (this.tooPatheticDialog.isVisible()) this.tooPatheticDialog.tick();
    else if (this.quitDialog.isVisible()) this.quitDialog.tick();
  }

  /** vs_input_tick */
  override inputPoll(): void {
    const gs = this.gs;
    const player1 = gs.getPlayer(0);
    const menuEv: CtrlEvent[] = [];
    gs.menuPoll(menuEv, { playerScene: true });

    // game_state_handle_event(): in demo mode ESC returns to the main menu and ENTER skips straight to a random
    // arena, before the scene sees the input. The TS game state has no such hook, so it is emulated here.
    if (gs.isDemoplay()) {
      if (menuEv.some((e) => e.type === 'action' && e.action === ACT_ESC)) {
        gs.setNext(SceneId.MENU);
        return;
      }
      if (isDown('Enter') && menuEv.some((e) => e.type === 'action' && e.action === ACT_PUNCH)) {
        gs.setNext(SceneId.ARENA0 + randomArena()); // rand_arena()
        return;
      }
    }

    for (const i of menuEv) {
      if (i.type === 'action' && i.action === ACT_ESC) {
        if (this.tooPatheticDialog.isVisible()) {
          this.tooPatheticDialog.event(i.action, i.source);
        } else if (this.quitDialog.isVisible()) {
          this.quitDialog.event(i.action, i.source);
        } else if (gs.isSingleplayer() && (player1.spWins !== 0 || gs.modeRun) && !player1.chr) {
          // there's an active singleplayer campaign, confirm quitting
          this.quitDialog.show(true);
        } else if (player1.chr) {
          // Match cancelled, no winner
          gs.fightStats.winner = -1;
          // null out the p2 pilot
          clearPlayerPilot(gs.getPlayer(1));
          gs.setNext(SceneId.MECHLAB);
        } else if (isSpectator(gs)) {
          gs.setNext(SceneId.LOBBY);
        } else {
          gs.setNext(SceneId.MELEE);
        }
      }
    }

    const p1: CtrlEvent[] = [];
    player1.ctrl.poll(p1);
    for (const i of p1) {
      if (i.type === 'action') this.handleAction(i.action, i.source);
      else if (i.type === 'close') gs.setNext(SceneId.MENU);
    }
  }

  /** Only called if the scene is the Plug end-of-match screen. */
  private renderFightStats(): void {
    const card = this.report;
    if (!card) return;
    card.plugWhine.draw(90, 156);

    card.reportTitle.draw(163, 6);
    card.reportLeft.draw(250 - 150 - 6, 16);
    card.reportRight.draw(250, 16);

    card.statsTitle.draw(163, 60);
    card.statsSelfLeft.draw(276 - 150 - 6, 79);
    card.statsSelfRight.draw(276, 79);

    card.opponentTitle.draw(163, 108);
    card.statsSelfLeft.draw(276 - 150 - 6, 115);
    card.opponentRight.draw(276, 115);
  }

  /** vs_render (drawn after the background, before the scene objects) */
  override render(): void {
    const gs = this.gs;
    const player1 = gs.getPlayer(0);
    const player2 = gs.getPlayer(1);
    const p2Pilot = playerPilot(player2);
    video.setTag(TAG_MENU); // texts and the arena selection box are menu UI (informational tag)

    if (p2Pilot) this.vsText?.draw(0, 3);

    if (player2.selectable) {
      // arena selection
      video.draw(this.arenaSelectBg, 55, 150);
      this.arenaName?.draw(56 + 72, 152);
      this.arenaDesc?.draw(56 + 72, 153);
    } else if (p2Pilot && p2Pilot.pilotId === PilotId.KREISSACK && settings().gameplay.difficulty < 2) {
      // kreissack, but not on Veteran or higher
      this.insults[1]?.draw(80, 165);
    } else if (player1.chr && p2Pilot) {
      // tournament insults
      this.insults[1]?.draw(100, 145);
    } else if (p2Pilot === null) {
      // plug screen fight stats
      if (gs.fightStats.winner >= 0) this.renderFightStats();
    } else {
      // 1 player mode insults
      this.insults[0]?.draw(77, 150);
      this.insults[1]?.draw(110, 170);
    }
  }

  /** vs_render_overlay */
  override renderOverlay(): void {
    video.setTag(TAG_MENU);
    if (this.quitDialog.isVisible()) this.quitDialog.render();
    if (this.tooPatheticDialog.isVisible()) this.tooPatheticDialog.render();
  }

  private quitDialogClicked(dlg: Dialog, result: DialogResult): void {
    if (result === DialogResult.YES_OK) {
      // A run (arcade, survival, time attack) ends: back to MORE MODES.
      if (this.gs.modeRun) this.gs.menuReturn = 'modes';
      this.gs.setNext(this.gs.modeRun ? SceneId.MENU : SceneId.MELEE);
    } else {
      dlg.show(false);
    }
  }

  private tooPatheticDialogClicked(_dlg: Dialog, _result: DialogResult): void {
    this.gs.setNext(SceneId.SCOREBOARD);
  }

  /** vs_free */
  override free(): void {
    this.quitDialog.free();
    this.tooPatheticDialog.free();
  }
}

registerScene(SceneId.VS, (gs) => new VsScene(gs));
