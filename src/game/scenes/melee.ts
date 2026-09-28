// Melee: the pilot and HAR selection screen of one- and two-player games (port of the reference melee scene).
//
// Page 1 (PILOT_SELECT) shows the 5x2 pilot grid with bios and power/agility/endurance bars; page 2 (HAR_SELECT)
// shows the HAR grid with animated previews. With the remaster's robots on, the HAR grid has a third row (HARs
// 11-14 in columns 1-4, so DOWN on KATANA still stays there for the NOVA cheat) that the two visible rows scroll to. In one-player mode the CPU opponent of the first fight is chosen here
// (from player 1's single-player wins); afterwards the newsroom picks the following ones. Confirming the HAR goes
// to the VS scene.
import type { CtrlEvent } from '../../controller/controller';
import { onKey } from '../../controller/input';
import type { Pilot } from '../../formats/pilot';
import type { Animation } from '../../resources/animation';
import { afGetMove, bkGetInfo, harPicture, langGet, loadAf } from '../../resources/resources';
import { CELL_BACKGROUND, MOVE } from '../../gen/fighter/moveset';
import { globalRandom } from '../../util/random';
import { TAG_MENU, video } from '../../video/draw';
import { Surface } from '../../video/surface';
import { vga } from '../../video/vga';
import {
  ACT_DOWN, ACT_ESC, ACT_KICK, ACT_LEFT, ACT_PUNCH, ACT_RIGHT, ACT_STOP, ACT_UP, ANIM_IDLE, CtrlType, HAR_NAMES, HarId,
  NUMBER_OF_HAR_TYPES, OBJECT_FACE_LEFT, PILOT_INFO, PilotId, PSM_FILES, SceneId,
} from '../constants';
import { registerScene, type GameState } from '../gameState';
import { ProgressBar, PROGRESSBAR_LEFT, THEME_MELEE } from '../gui/progressbar';
import {
  FontSize, GLYPH_SHADOW_BOTTOM, GLYPH_SHADOW_LEFT, GLYPH_SHADOW_RIGHT, GLYPH_SHADOW_TOP, HAlign, Text, VAlign,
} from '../gui/text';
import { menuBackground, MenuBackgroundStyle, playMenuSound } from '../gui/widgets';
import { GameObject } from '../object';
import { paletteLoadPlayerColors, PRIMARY, SECONDARY, setPilotColor, TERTIARY } from '../pilotColors';
import { EXTRA_HAR_IDS, extraRobotsEnabled, randomHarPool } from '../roster';
import { Scene } from '../scene';

const MAX_STAT = 20;
const TEXT_GREEN = 0xa6;
const TEXT_SHADOW_GREEN = 0xa2;
const TEXT_BLACK = 0xd1;
const TEXT_SHADOW_BLACK = 0xd7;
const RED_CURSOR_INDEX = 0xf6;
const BLUE_CURSOR_INDEX = 0xf7;
const VIOLET_CURSOR_INDEX = 0xf8;

interface Portrait {
  x: number;
  y: number;
  disabledOffset: number;
  enabled: Surface;
  disabled: Surface | null;
}

interface CursorData {
  row: number;
  column: number;
  done: boolean;
}

const PILOT_SELECT = 0;
const HAR_SELECT = 1;

const STAT_POWER = 0;
const STAT_AGILITY = 1;
const STAT_ENDURANCE = 2;
const STAT_COUNT = 3;

/**
 * lang_get(): the reference trims the trailing linebreak of every ENGLISH.DAT string when loading the language
 * (lang_init); `langGet` returns the raw strings, so trim here to get identical texts (e.g. pilot names).
 */
function lang(id: number): string {
  const s = langGet(id);
  return s.endsWith('\n') ? s.slice(0, -1) : s;
}

/** har_get_name() */
function harGetName(id: number): string {
  return id >= 0 && id < NUMBER_OF_HAR_TYPES ? HAR_NAMES[id] : '';
}

function ticksToBlinky(ticks: number): number {
  // float math like the reference (cosf/roundf); the value is always positive so Math.round == roundf.
  const rate = Math.fround(Math.fround(ticks) / 25.0);
  return Math.round(Math.fround((Math.fround(Math.cos(rate)) + 1.0) * 64.0));
}

function setCursorColors(aTicks: number, bTicks: number, aDone: boolean, bDone: boolean): void {
  const base = 120;
  const aOffset = ticksToBlinky(aTicks);
  const bOffset = ticksToBlinky(bTicks);
  vga.setBaseIndex(RED_CURSOR_INDEX, (base + (aDone ? 64 : aOffset)) & 0xff, 0, 0);
  vga.setBaseIndex(BLUE_CURSOR_INDEX, 0, 0, (base + (bDone ? 64 : bOffset)) & 0xff);
  vga.setBaseIndex(VIOLET_CURSOR_INDEX, (base + aOffset) & 0xff, 0, (base + aOffset) & 0xff);
}

/** get_pilot_stat(): the reference returns a pointer to the uint8 field; here a getter/setter pair. */
function getPilotStat(p: Pilot, stat: number): number {
  switch (stat) {
    case STAT_POWER:
      return p.power;
    case STAT_AGILITY:
      return p.agility;
    case STAT_ENDURANCE:
    default:
      return p.endurance;
  }
}

function setPilotStat(p: Pilot, stat: number, value: number): void {
  const v = value & 0xff; // uint8_t
  switch (stat) {
    case STAT_POWER:
      p.power = v;
      break;
    case STAT_AGILITY:
      p.agility = v;
      break;
    case STAT_ENDURANCE:
    default:
      p.endurance = v;
  }
}

/** sd_pilot_get_player_color() */
function getPilotColor(p: Pilot, index: number): number {
  if (index === TERTIARY) return p.color3;
  if (index === SECONDARY) return p.color2;
  return p.color1;
}

function createGreenText(w: number, h: number, str: string): Text {
  return new Text(FontSize.SMALL, w, h, str)
    .setColor(TEXT_GREEN)
    .setShadow(GLYPH_SHADOW_RIGHT | GLYPH_SHADOW_BOTTOM)
    .setShadowColor(TEXT_SHADOW_GREEN)
    .setHAlign(HAlign.CENTER)
    .setVAlign(VAlign.MIDDLE);
}

function createBlackText(w: number, h: number, str: string): Text {
  return new Text(FontSize.SMALL, w, h, str)
    .setColor(TEXT_BLACK)
    .setShadow(GLYPH_SHADOW_TOP | GLYPH_SHADOW_LEFT)
    .setShadowColor(TEXT_SHADOW_BLACK)
    .setHAlign(HAlign.CENTER)
    .setVAlign(VAlign.MIDDLE);
}

export class MeleeScene extends Scene {
  cursor: [CursorData, CursorData] = [
    { row: 0, column: 0, done: false },
    { row: 0, column: 0, done: false },
  ];
  page = PILOT_SELECT;

  bigPortrait1!: GameObject;
  bigPortrait2: GameObject | null = null;
  player2Placeholder!: GameObject;
  unselectedPilotPortraits!: GameObject;
  unselectedHarPortraits!: GameObject;

  pilotPortraits: Portrait[] = [];
  harPortraits: Portrait[] = [];

  /** The remaster's robots are on: the HAR grid has a third row (row 2). */
  extraRow = false;
  /** First HAR grid row on screen (0: rows 0-1, 1: rows 1-2). */
  viewTop = 0;
  /** Unselected cells when scrolled: the original sheet's second row, and the new robots' row. */
  private rowGray: Surface | null = null;
  private extraGray: { back: Surface; cells: { surf: Surface; x: number }[] } | null = null;
  private idleAnims = new Map<number, Animation>();

  har: [GameObject, GameObject];

  barStat: ProgressBar[][] = [[], []];

  pilotIdA = 0;
  pilotIdB = 0;

  bgPlayerStats!: Surface;
  bgPlayerBio!: Surface;
  selectHilight!: Surface;

  ticks = 0;
  tickbase = [0, 0];

  wins: (Text | null)[] = [null, null];
  harTitle!: Text;
  titles: Text[] = [];
  playerName: Text[] = [];
  playerBio: Text[] = [];
  playerStats: Text[] = [];

  // nova selection cheat
  cheatSelected: [Uint8Array, Uint8Array] = [new Uint8Array(10), new Uint8Array(10)];
  katanaDownCount = [0, 0];
  // pilot stat cheat: wrap around on both rows and select every pilot, then hold KICK to adjust stats.
  cheatPilotStats = [0, 0];
  cheatPilotStatsStat = [0, 0]; // which stat is selected

  networkGame = false;

  private lastKeyEvent: KeyboardEvent | null = null;
  private unsubscribeKeys: (() => void) | null = null;

  /** melee_create */
  constructor(gs: GameState) {
    super(gs, SceneId.MELEE);
    // load_pilot_portraits_palette() edits the BK palette in place. The reference reloads the BK for every scene,
    // but loadBk() shares the parsed palettes between loads, so work on a private copy.
    this.bk.palettes = this.bk.palettes.map((p) => p.clone());
    // Local objects (never added to the game state). The reference keeps har[1] as a zeroed struct in 1P mode.
    this.har = [new GameObject(gs, 0, 0), new GameObject(gs, 0, 0)];

    const player1 = gs.getPlayer(0);
    const player2 = gs.getPlayer(1);
    this.extraRow = extraRobotsEnabled();

    this.networkGame = false;
    if (player1.ctrl && player2.ctrl) {
      if (player1.ctrl.type === CtrlType.NETWORK || player2.ctrl.type === CtrlType.NETWORK) this.networkGame = true;
    }

    // if we already have a pilot name, we're coming back from VS.
    if (!this.networkGame && player1.pilot.name.length > 0 && (player2.pilot.name.length > 0 || !player2.selectable)) {
      this.page = HAR_SELECT;
      this.pilotIdA = player1.pilot.pilotId;
      this.pilotIdB = player2.pilot.pilotId;
      this.restoreCursorsTo(player1.pilot.harId, player2.pilot.harId);
      paletteLoadPlayerColors(player1.pilot.palette, 0);
      paletteLoadPlayerColors(player2.pilot.palette, 1);
    } else {
      this.page = PILOT_SELECT;
      this.pilotIdA = PilotId.CRYSTAL;
      this.pilotIdB = PilotId.SHIRRO;
      this.restoreCursorsTo(this.pilotIdA, this.pilotIdB);
      this.loadPilotPortraitsPalette();
    }

    this.bgPlayerStats = menuBackground(90, 61, MenuBackgroundStyle.MELEE_VS);
    this.bgPlayerBio = menuBackground(160, 43, MenuBackgroundStyle.MELEE_VS);

    // Player bio boxes and names for both players
    for (let i = 0; i < 2; i++) {
      this.playerBio[i] = createGreenText(156, 34, lang(135 + this.cursorIndex(i)));
      this.playerName[i] = createBlackText(66, 6, lang(20 + this.cursorIndex(i)));
      this.playerBio[i].setMargin({ left: 2, right: 2, top: 0, bottom: 0 });
    }
    // Stats texts (POWER, AGILITY, ENDURANCE)
    for (let i = 0; i < 3; i++) this.playerStats[i] = createGreenText(85, 6, lang(216 + i));

    // Page titles. These are static.
    this.titles[0] = createGreenText(160, 6, lang(187)); // 'choose your pilot'
    this.titles[1] = createGreenText(160, 6, lang(186)); // 'choose your robot'

    // This is used to either show the selected HAR name or both in the "X VS. Y" format.
    this.harTitle = createBlackText(320, 6, harGetName(this.cursorIndex(0)));

    // A black surface for the highlight box; the cursor color comes from the palette offset at render time.
    this.selectHilight = new Surface(51, 36, new Uint8Array(51 * 36), -1);
    this.selectHilight.source = { kind: 'generated', key: 'melee/highlight' };

    // (The reference installs controller hooks here for network games; netplay is not part of this port.)

    // Load HAR and Pilot face portraits and har sprites for the selection grid
    this.loadPilotPortraits();
    this.loadHarPortraits();
    this.loadHars(player2.selectable);

    // Load the big faces on the top corners
    const pilotBigPortraits = bkGetInfo(this.bk, 4)!.ani;
    this.bigPortrait1 = new GameObject(gs, 0, 0);
    this.bigPortrait1.setAnimation(pilotBigPortraits);
    this.bigPortrait1.selectSprite(0);

    if (player2.selectable) {
      const s1 = gs.getPlayer(0).score;
      const s2 = gs.getPlayer(1).score;
      this.wins[0] = createBlackText(160 - 8, 6, `Wins: ${s1.wins}`).setHAlign(HAlign.LEFT);
      this.wins[1] = createBlackText(160 - 8, 6, `Wins: ${s2.wins}`).setHAlign(HAlign.RIGHT);

      this.bigPortrait2 = new GameObject(gs, 320, 0);
      this.bigPortrait2.setAnimation(pilotBigPortraits);
      this.bigPortrait2.selectSprite(4);
      this.bigPortrait2.direction = OBJECT_FACE_LEFT;
    }

    // This contains the big logo and the frames
    const miscStuff = bkGetInfo(this.bk, 5)!.ani;
    this.player2Placeholder = new GameObject(gs, 0, 0);
    this.player2Placeholder.setAnimation(miscStuff);
    this.player2Placeholder.selectSprite(player2.selectable ? 0 : 1);

    for (let i = 0; i < 2; i++) {
      const x = i === 0 ? 74 : 320 - 66 - this.bgPlayerStats.w;
      for (let stat = 0; stat < STAT_COUNT; stat++) {
        const y = 12 + stat * 18;
        const bar = new ProgressBar(THEME_MELEE, PROGRESSBAR_LEFT, 50);
        bar.layout(x, y, 20 * 4, 8);
        this.barStat[i][stat] = bar;
      }
    }

    this.loadPilotStats(0);
    this.loadPilotStats(1);
    setCursorColors(0, 0, false, false);

    // initialize cheats
    this.cheatSelected = [new Uint8Array(10), new Uint8Array(10)];
    this.katanaDownCount = [0, 0];
    this.cheatPilotStats = [0, 0];

    // Play correct music
    gs.playMusic(PSM_FILES.MENU);

    // scene->event = melee_event_cb: raw key events (the color cheat). The engine may also forward them through
    // Scene.keyEvent; keyEvent() ignores a second delivery of the same event.
    this.unsubscribeKeys = onKey((code, e) => {
      if (this.gs.sc === this) this.keyEvent(code, e);
    });
  }

  /** melee_free */
  override free(): void {
    this.unsubscribeKeys?.();
    this.unsubscribeKeys = null;
  }

  /** CURSOR_INDEX(local, player) */
  cursorIndex(player: number): number {
    return 5 * this.cursor[player].row + this.cursor[player].column;
  }

  /** The HAR under a player's cursor on the HAR page (row 2 holds the remaster's robots, from column 1). */
  harIndex(player: number): number {
    const c = this.cursor[player];
    return c.row === 2 ? EXTRA_HAR_IDS[c.column - 1] : 5 * c.row + c.column;
  }

  /** The grid scrolls to show the row a cursor moved to. */
  private follow(cur: CursorData): void {
    if (cur.row === 2) this.viewTop = 1;
    else if (cur.row === 0) this.viewTop = 0;
  }

  /** Screen row of a grid row on the current page, or -1 when scrolled out of view. */
  private screenRow(row: number): number {
    const r = this.page === HAR_SELECT ? row - this.viewTop : row;
    return r >= 0 && r <= 1 ? r : -1;
  }

  /** The idle animation shown for a robot (the original robots' previews are in MELEE.BK). */
  private previewAnim(harId: number): Animation {
    if (harId < 10) return bkGetInfo(this.bk, 18 + harId)!.ani;
    let ani = this.idleAnims.get(harId);
    if (!ani) {
      ani = afGetMove(loadAf(harId), ANIM_IDLE)!.ani;
      this.idleAnims.set(harId, ani);
    }
    return ani;
  }

  private cursorsMatch(): boolean {
    return this.cursor[0].column === this.cursor[1].column && this.cursor[0].row === this.cursor[1].row;
  }

  private cursorNovaSelect(player: number): boolean {
    return this.cursor[player].row === 1 && this.cursor[player].column === 2;
  }

  /** Which page is shown (0 = pilot select, 1 = HAR select). */
  get currentPage(): number {
    return this.page;
  }

  private loadPilotPortraitsPalette(): void {
    const bkPal = this.bk.palettes[0];
    // copy and dim for unselected pilot portraits
    for (let idx = 0x01; idx < 0x60; idx++) {
      const srcIdx = idx + 0xa0;
      bkPal.set(idx, bkPal.r(srcIdx) >> 1, bkPal.g(srcIdx) >> 1, bkPal.b(srcIdx) >> 1);
    }
    vga.setBasePaletteRange(bkPal, 0x00, 0x00, 0x60);
  }

  private checkPilotStatCheat(playerId: number): boolean {
    if (this.networkGame) return false;
    // if we haven't enabled the cheat yet, check the rules
    if (this.cheatPilotStats[playerId] !== 0xff) {
      if (this.cheatPilotStats[playerId] !== 3) return false; // haven't wrapped around both rows
      if (this.cheatSelected[playerId].includes(0)) return false; // not all pilots have been selected
      // mark cheat as enabled
      this.cheatPilotStats[playerId] = 0xff;
      // select POWER stat.
      this.cheatPilotStatsStat[playerId] = 0;
    }
    // disable KICK debouncing
    const player = this.gs.getPlayer(playerId);
    player.ctrl.last &= ~ACT_KICK;
    return true;
  }

  /** melee_tick (dynamic tick) */
  override dynamicTick(_paused: boolean): void {
    // (Extra controller events only exist for network controllers, which this port does not have.)
    const player2 = this.gs.getPlayer(1);
    if (this.page === HAR_SELECT && this.ticks % 10 === 1) {
      this.har[0].dynamicTick();
      if (player2.selectable) this.har[1].dynamicTick();
    }
    // Tick cursor colors
    setCursorColors(this.ticks - this.tickbase[0], this.ticks - this.tickbase[1], this.cursor[0].done, this.cursor[1].done);
    this.ticks++;
  }

  private refreshPilotStats(playerId: number): void {
    const player = this.gs.getPlayer(playerId);
    for (let stat = 0; stat < STAT_COUNT; stat++) {
      this.barStat[playerId][stat].setProgress(Math.trunc((getPilotStat(player.pilot, stat) * 100) / MAX_STAT), false);
    }
  }

  private updateHar(player: number): void {
    if (this.page !== HAR_SELECT) return;
    const player2 = this.gs.getPlayer(1);
    const har = this.har[player];
    const ani = this.previewAnim(this.harIndex(player));
    har.setAnimation(ani);
    har.selectSprite(0);
    har.setRepeat(true);
    if (player2.selectable) {
      this.harTitle.set(`${harGetName(this.harIndex(0))} VS. ${harGetName(this.harIndex(1))}`);
    } else {
      this.harTitle.set(harGetName(this.harIndex(0)));
    }
  }

  private resetCursorBlinky(player: number): void {
    if (this.cursorsMatch() || player === 0) this.tickbase[0] = this.ticks;
    if (this.cursorsMatch() || player === 1) this.tickbase[1] = this.ticks;
  }

  private loadPilotStats(playerId: number): void {
    const player = this.gs.getPlayer(playerId);
    const pilotId = playerId === 0 ? this.pilotIdA : this.pilotIdB;
    const pA = PILOT_INFO[pilotId];
    if (player.selectable) {
      const bigPortrait = playerId === 0 ? this.bigPortrait1 : this.bigPortrait2;
      bigPortrait?.selectSprite(pilotId);
      this.playerBio[playerId].set(lang(135 + pilotId));
      this.playerName[playerId].set(lang(20 + pilotId));
      bigPortrait?.selectSprite(pilotId);
    }
    player.pilot.endurance = pA.endurance;
    player.pilot.power = pA.power;
    player.pilot.agility = pA.agility;
    player.pilot.sex = pA.sex;
    this.refreshPilotStats(playerId);
  }

  private loadPilotColors(playerId: number): void {
    const player = this.gs.getPlayer(playerId);
    const pilotId = playerId === 0 ? this.pilotIdA : this.pilotIdB;
    const pA = PILOT_INFO[pilotId];
    // update the player palette
    setPilotColor(player.pilot, PRIMARY, pA.color1);
    setPilotColor(player.pilot, SECONDARY, pA.color2);
    setPilotColor(player.pilot, TERTIARY, pA.color3);
    paletteLoadPlayerColors(player.pilot.palette, playerId);
  }

  /** handle_action */
  handleAction(player: number, action: number): void {
    const gs = this.gs;
    const player1 = gs.getPlayer(0);
    const player2 = gs.getPlayer(1);
    const cur = this.cursor[player];
    if (cur.done) return;

    const oldRow = cur.row;
    const oldColumn = cur.column;

    switch (action) {
      case ACT_STOP:
        this.barStat[player][this.cheatPilotStatsStat[player]].highlight = false;
        break;
      case ACT_LEFT:
        cur.column--;
        if (cur.column < (cur.row === 2 ? 1 : 0)) {
          cur.column = 4;
          if (this.page === PILOT_SELECT) this.cheatPilotStats[player] |= cur.row + 1;
        }
        this.resetCursorBlinky(player);
        break;
      case ACT_RIGHT:
        cur.column++;
        if (cur.column > 4) {
          cur.column = cur.row === 2 ? 1 : 0;
          if (this.page === PILOT_SELECT) this.cheatPilotStats[player] |= cur.row + 1;
        }
        this.resetCursorBlinky(player);
        break;
      case ACT_UP:
        if (cur.row > 0) cur.row--;
        this.follow(cur);
        this.resetCursorBlinky(player);
        break;
      case ACT_DOWN:
        if (cur.row === 0) cur.row = 1;
        else if (cur.row === 1 && cur.column > 0 && this.page === HAR_SELECT && this.extraRow) cur.row = 2;
        this.follow(cur);
        this.resetCursorBlinky(player);
        // nova selection cheat
        if (cur.row === 1 && cur.column === 0) {
          this.katanaDownCount[player]++;
          if (this.katanaDownCount[player] > 11) this.katanaDownCount[player] = 11;
        }
        break;
      case ACT_KICK | ACT_UP:
        if (this.page === PILOT_SELECT && this.checkPilotStatCheat(player) && this.cheatPilotStatsStat[player] > 0) {
          this.barStat[player][this.cheatPilotStatsStat[player]].highlight = false;
          this.cheatPilotStatsStat[player]--;
        }
        break;
      case ACT_KICK | ACT_DOWN:
        if (this.page === PILOT_SELECT && this.checkPilotStatCheat(player) && this.cheatPilotStatsStat[player] < 2) {
          this.barStat[player][this.cheatPilotStatsStat[player]].highlight = false;
          this.cheatPilotStatsStat[player]++;
        }
        break;
      case ACT_KICK | ACT_LEFT:
        if (this.page === PILOT_SELECT && this.checkPilotStatCheat(player)) {
          const pilot = gs.getPlayer(player).pilot;
          const stat = this.cheatPilotStatsStat[player];
          // reallocate points to other stats from selected stat
          for (let other = 0; other < STAT_COUNT; other++) {
            if (other === stat || getPilotStat(pilot, other) >= MAX_STAT || getPilotStat(pilot, stat) <= 0) continue;
            setPilotStat(pilot, other, getPilotStat(pilot, other) + 1);
            setPilotStat(pilot, stat, getPilotStat(pilot, stat) - 1);
          }
          this.refreshPilotStats(player);
        }
        break;
      case ACT_KICK | ACT_RIGHT:
        if (this.page === PILOT_SELECT && this.checkPilotStatCheat(player)) {
          const pilot = gs.getPlayer(player).pilot;
          const stat = this.cheatPilotStatsStat[player];
          // reallocate points from other stats into selected stat
          for (let other = 0; other < STAT_COUNT; other++) {
            if (other === stat || getPilotStat(pilot, other) <= 0 || getPilotStat(pilot, stat) >= MAX_STAT) continue;
            setPilotStat(pilot, other, getPilotStat(pilot, other) - 1);
            setPilotStat(pilot, stat, getPilotStat(pilot, stat) + 1);
          }
          this.refreshPilotStats(player);
        }
        break;
      case ACT_KICK:
      case ACT_PUNCH:
        // ACT_KICK falls through to ACT_PUNCH unless the pilot stat cheat is active.
        if (action === ACT_KICK && this.page === PILOT_SELECT && this.checkPilotStatCheat(player)) {
          this.barStat[player][this.cheatPilotStatsStat[player]].highlight = true;
          break;
        }
        cur.done = true;
        playMenuSound(20, 0);
        if (this.cursor[0].done && (this.cursor[1].done || !player2.selectable)) {
          this.cursor[0].done = false;
          this.cursor[1].done = false;
          if (this.page === PILOT_SELECT) {
            this.page = HAR_SELECT;
            this.updateHar(0);
            this.updateHar(1);
            this.pilotIdA = this.cursorIndex(0);
            this.pilotIdB = this.cursorIndex(1);

            // prepare for nova selection cheat
            this.cheatSelected[0].fill(0);
            this.cheatSelected[1].fill(0);
            this.cheatSelected[0][this.pilotIdA] = 1;
            this.cheatSelected[1][this.pilotIdB] = 1;

            this.loadPilotColors(0);
            if (player2.selectable) this.loadPilotColors(1);
          } else {
            const novaActivated = [true, true];
            for (let i = 0; i < 2; i++) {
              novaActivated[i] = this.katanaDownCount[i] >= 11 && !this.cheatSelected[i].includes(0);
            }
            if (novaActivated[0] && this.cursorNovaSelect(0)) player1.pilot.harId = HarId.NOVA;
            else player1.pilot.harId = this.harIndex(0);
            player1.pilot.pilotId = this.pilotIdA;
            if (player2.selectable) {
              if (novaActivated[1] && this.cursorNovaSelect(1)) player2.pilot.harId = HarId.NOVA;
              else player2.pilot.harId = this.harIndex(1);
              player2.pilot.pilotId = this.pilotIdB;
            } else {
              if (player1.spWins === (2046 ^ (2 << player1.pilot.pilotId))) {
                // everyone but kreissack
                player2.pilot.pilotId = PilotId.KREISSACK;
                player2.pilot.harId = HarId.NOVA;
              } else if (!this.hasUnbeatenOpponent(player1.spWins, player1.pilot.pilotId)) {
                // The reference loops forever here (no pilot left to pick); fight Kreissack instead of hanging.
                player2.pilot.pilotId = PilotId.KREISSACK;
                player2.pilot.harId = HarId.NOVA;
              } else {
                // pick an opponent we have not yet beaten
                for (;;) {
                  const i = globalRandom.int(10);
                  if ((2 << i) & player1.spWins || i === player1.pilot.pilotId) continue;
                  player2.pilot.pilotId = i;
                  // The original ten robots (the reference's int(10)), and the remaster's when they are on.
                  const pool = randomHarPool();
                  player2.pilot.harId = pool[globalRandom.int(pool.length)];
                  break;
                }
              }
              this.pilotIdB = player2.pilot.pilotId;
              // QUIRK (reference): this reloads the stats of the acting player (player 1), so the CPU opponent keeps
              // the stats loaded for it when the scene started (Shirro's); the newsroom sets proper stats later.
              this.loadPilotStats(player);
              this.loadPilotColors(1);
            }
            if (!this.networkGame) {
              player1.pilot.name = lang(player1.pilot.pilotId + 20);
              player2.pilot.name = lang(player2.pilot.pilotId + 20);
            }
            gs.setNext(SceneId.VS);
          }
        }
        break;
    }

    if (oldRow !== cur.row || oldColumn !== cur.column) {
      // column 0..5 → panning -50..+50
      const panning = Math.trunc((cur.column * 100) / 5) - 50;
      playMenuSound(19, panning);
      if (this.page === PILOT_SELECT) {
        if (player === 0) this.pilotIdA = this.cursorIndex(player);
        else this.pilotIdB = this.cursorIndex(player);
        this.loadPilotStats(player);
      } else {
        this.updateHar(player);
      }
    }

    if (cur.row < 2) this.cheatSelected[player][5 * cur.row + cur.column] = 1;
  }

  /** True when the reference's random opponent loop can terminate. */
  private hasUnbeatenOpponent(spWins: number, pilotId: number): boolean {
    for (let i = 0; i < 10; i++) if (!((2 << i) & spWins) && i !== pilotId) return true;
    return false;
  }

  /** Move cursors to select Pilot or HARs specified by A and B. */
  private restoreCursorsTo(a: number, b: number): void {
    // note: a/b can be HAR_NOVA (10) when returning from VS,
    // which the original game handles surprisingly elegantly.
    if (a === HarId.NOVA) a = HarId.FLAIL;
    if (b === HarId.NOVA) b = HarId.FLAIL;
    [a, b].forEach((id, i) => {
      const c = this.cursor[i];
      const extra = this.page === HAR_SELECT ? EXTRA_HAR_IDS.indexOf(id) : -1;
      if (extra >= 0 && this.extraRow) {
        c.row = 2;
        c.column = extra + 1;
      } else if (id >= 10) {
        // A remaster robot while they are turned off: back to the first cell.
        c.row = 0;
        c.column = 0;
      } else {
        c.column = id % 5;
        c.row = Math.trunc(id / 5);
      }
      c.done = false;
    });
    this.viewTop = this.cursor[0].row === 2 ? 1 : 0;
  }

  /** Mouse (not in the original game): player 1 points at a portrait to move the cursor there and clicks to pick it. */
  override pointer(x: number, y: number, kind: import('../../controller/mouse').PointerKind): boolean {
    const cur = this.cursor[0];
    if (cur.done) return false;
    const column = Math.floor((x - 11) / 62), screenRow = Math.floor((y - 115) / 42);
    if (column < 0 || column > 4 || screenRow < 0 || screenRow > 1 || x - 11 - column * 62 > 52 || y - 115 - screenRow * 42 > 38) return false;
    const row = screenRow + (this.page === HAR_SELECT ? this.viewTop : 0);
    if (row === 2 && column === 0) return false;
    if (kind !== 'move' && kind !== 'click') return false;
    if (row !== cur.row || column !== cur.column) {
      // Step the cursor like the arrow keys would (sounds, stats and cheat bookkeeping included).
      while (cur.row !== row) this.handleAction(0, row > cur.row ? ACT_DOWN : ACT_UP);
      while (cur.column !== column) this.handleAction(0, column > cur.column ? ACT_RIGHT : ACT_LEFT);
    }
    if (kind === 'click') this.handleAction(0, ACT_PUNCH);
    return true;
  }

  /** melee_input_tick */
  override inputPoll(): void {
    const gs = this.gs;
    const player1 = gs.getPlayer(0);
    const player2 = gs.getPlayer(1);
    const p1: CtrlEvent[] = [];
    const p2: CtrlEvent[] = [];
    player1.ctrl.poll(p1);
    player2.ctrl.poll(p2);
    for (const i of p1) {
      if (i.type === 'action') this.handleAction(0, i.action);
      else if (i.type === 'close') gs.setNext(SceneId.MENU);
    }
    for (const i of p2) {
      if (i.type === 'action') this.handleAction(1, i.action);
      else if (i.type === 'close') gs.setNext(SceneId.MENU);
    }

    const menuEv: CtrlEvent[] = [];
    gs.menuPoll(menuEv, { playerScene: true });
    for (const i of menuEv) {
      if (i.type === 'action' && i.action === ACT_ESC) {
        playMenuSound(20, 0);
        if (this.page === HAR_SELECT) {
          // restore the player selection
          this.restoreCursorsTo(this.pilotIdA, this.pilotIdB);
          this.page = PILOT_SELECT;
          this.loadPilotPortraitsPalette();
        } else {
          // (the reference returns to the network lobby when it came from there; no netplay in this port)
          gs.setNext(SceneId.MENU);
        }
      }
    }
  }

  private drawHighlight(cursor: CursorData, offset: number): void {
    const r = this.screenRow(cursor.row);
    if (r < 0) return;
    const x = 11 + 62 * cursor.column;
    const y = 115 + 42 * r;
    video.drawOffset(this.selectHilight, x, y, offset, 255);
  }

  private renderHighlights(player2IsSelectable: boolean): void {
    if (player2IsSelectable && this.cursorsMatch()) {
      this.drawHighlight(this.cursor[0], VIOLET_CURSOR_INDEX);
    } else {
      if (player2IsSelectable) this.drawHighlight(this.cursor[1], BLUE_CURSOR_INDEX);
      this.drawHighlight(this.cursor[0], RED_CURSOR_INDEX);
    }
  }

  private renderEnabledPortrait(portraits: Portrait[], cursor: CursorData, player: number): void {
    const r = this.screenRow(cursor.row);
    const p = portraits[cursor.row === 2 ? EXTRA_HAR_IDS[cursor.column - 1] : 5 * cursor.row + cursor.column];
    if (!p || r < 0) return;
    const x = 11 + 62 * cursor.column, y = 115 + 42 * r;
    if (player < 0) video.draw(p.enabled, x, y);
    else video.drawOffset(p.enabled, x, y, player * 48, (player + 1) * 48);
  }

  private renderPilotSelect(player2IsSelectable: boolean): void {
    video.draw(this.bgPlayerStats, 70, 0);
    video.draw(this.bgPlayerBio, 0, 62);

    this.playerName[0].draw(0, 52);
    this.playerBio[0].draw(4, 66);
    this.playerStats[0].draw(74, 4);
    this.playerStats[1].draw(74, 22);
    this.playerStats[2].draw(74, 40);

    for (let stat = 0; stat < STAT_COUNT; stat++) this.barStat[0][stat].render();

    this.player2Placeholder.render();

    if (player2IsSelectable) {
      video.draw(this.bgPlayerStats, 320 - 70 - this.bgPlayerStats.w, 0);
      video.draw(this.bgPlayerBio, 320 - this.bgPlayerBio.w, 62);

      this.playerName[1].draw(320 - 66, 52);
      this.playerBio[1].draw(320 - this.bgPlayerBio.w + 4, 66);
      this.playerStats[0].draw(320 - 66 - this.bgPlayerStats.w, 4);
      this.playerStats[1].draw(320 - 66 - this.bgPlayerStats.w, 22);
      this.playerStats[2].draw(320 - 66 - this.bgPlayerStats.w, 40);

      for (let stat = 0; stat < STAT_COUNT; stat++) this.barStat[1][stat].render();
    } else {
      this.titles[0].draw(160, 97);
    }

    this.unselectedPilotPortraits.render();
    this.renderHighlights(player2IsSelectable);
    this.renderEnabledPortrait(this.pilotPortraits, this.cursor[0], -1);
    this.bigPortrait1.render();
    if (player2IsSelectable) {
      this.renderEnabledPortrait(this.pilotPortraits, this.cursor[1], -1);
      this.bigPortrait2?.render();
    }
  }

  private renderHarSelect(player2IsSelectable: boolean): void {
    this.player2Placeholder.render();

    // render the unselected HAR portraits before anything so we can render anything else on top of them
    if (this.viewTop === 0 || !this.rowGray || !this.extraGray) {
      this.unselectedHarPortraits.render();
    } else {
      video.draw(this.rowGray, 11, 115);
      video.draw(this.extraGray.back, 11, 157);
      for (const c of this.extraGray.cells) video.draw(c.surf, 11 + c.x, 157);
    }
    this.renderHighlights(player2IsSelectable);

    // currently selected player
    this.bigPortrait1.render();

    // currently selected HAR
    this.renderEnabledPortrait(this.harPortraits, this.cursor[0], 0);
    this.har[0].render();

    // player 1 name
    this.playerName[0].draw(0, 52);

    if (player2IsSelectable) {
      // player 2 name
      this.playerName[1].draw(320 - 66, 52);
      // currently selected player
      this.bigPortrait2?.render();
      // currently selected HAR
      this.renderEnabledPortrait(this.harPortraits, this.cursor[1], 1);
      this.har[1].render();
      // render HAR name (Har1 VS. Har2)
      this.harTitle.draw(0, 107);
    } else {
      // 'choose your Robot'
      this.titles[1].draw(160, 97);
      // render HAR name
      this.harTitle.draw(0, 107);
    }
  }

  /** melee_render */
  override render(): void {
    const player2 = this.gs.getPlayer(1);
    video.setTag(TAG_MENU); // everything the scene draws over its background is menu UI (informational tag)
    if (this.page === PILOT_SELECT) this.renderPilotSelect(player2.selectable);
    else this.renderHarSelect(player2.selectable);
    if (player2.selectable) {
      this.wins[0]?.draw(8, 107);
      this.wins[1]?.draw(160, 107);
    }
  }

  private loadPilotPortraits(): void {
    const pilotsEnabled = bkGetInfo(this.bk, 3)!.ani;
    for (let i = 0; i < 10; i++) {
      const current = pilotsEnabled.getSprite(i)!;
      // Copy the face image in full color (shown when selected)
      const enabled = current.surface!.clone();
      // Copy the face image in dimmed color (shown when not selected). Built like the reference, which never
      // draws it: the unselected faces come from the dimmed palette of the grid sprite (BK animation 0).
      const disabled = enabled.clone();
      disabled.source = null;
      disabled.compressIndexBlocks(0x60, 0xa0, 64, 16);
      disabled.compressIndexBlocks(0xa0, 0xd0, 8, 3);
      disabled.compressIndexBlocks(0xd0, 0xe0, 16, 3);
      disabled.compressIndexBlocks(0xe0, 0xf0, 8, 2);
      disabled.compressRemap(0xf0, 0xf7, 0xb6, 3);
      this.pilotPortraits[i] = { x: current.posX, y: current.posY, disabledOffset: 0, enabled, disabled };
    }
    const harPortraits = bkGetInfo(this.bk, 0)!.ani;
    this.unselectedPilotPortraits = new GameObject(this.gs, 0, 0);
    this.unselectedPilotPortraits.setAnimation(harPortraits);
    this.unselectedPilotPortraits.selectSprite(0);
  }

  private loadHarPortraits(): void {
    const harPortraits = bkGetInfo(this.bk, 1)!.ani;
    const sheet = harPortraits.getSprite(0)!;
    const sheetSurface = sheet.surface!;
    for (let i = 0; i < 10; i++) {
      const row = Math.trunc(i / 5);
      const col = i % 5;
      // Copy the HAR image in full color (shown when selected)
      const enabled = new Surface(51, 36, undefined, sheetSurface.transparent);
      enabled.blit(sheetSurface, 0, 0, 62 * col, 42 * row, 51, 36);
      enabled.transparent = 0xd0;
      enabled.source = { kind: 'generated', key: `melee/har-portrait/${i}` };
      enabled.hdSource = { surf: sheetSurface, x: 62 * col, y: 42 * row, gray: false };
      this.harPortraits[i] = { x: sheet.posX + 62 * col, y: sheet.posY + 42 * row, disabledOffset: 0, enabled, disabled: null };
    }
    // convert BK's sheet sprite to grayscale and use it for the unselected_har_portraits
    // (on a copy: loadBk() shares decoded sprite pixels between loads)
    const gray = sheetSurface.clone();
    gray.convertHarToGrayscale(8);
    gray.source = { kind: 'generated', key: 'melee/har-sheet-gray' };
    gray.hdSource = { surf: sheetSurface, x: 0, y: 0, gray: true };
    sheet.surface = gray;
    this.unselectedHarPortraits = new GameObject(this.gs, 0, 0);
    this.unselectedHarPortraits.setAnimation(harPortraits);
    this.unselectedHarPortraits.selectSprite(0);
    if (this.extraRow) this.loadExtraPortraits(sheetSurface, gray);
  }

  /** The remaster robots' cells (from their fighter files) and the unselected rows shown when the grid scrolls. */
  private loadExtraPortraits(sheet: Surface, gray: Surface): void {
    this.rowGray = new Surface(sheet.w, 36, undefined, gray.transparent);
    this.rowGray.blit(gray, 0, 0, 0, 42, sheet.w, 36);
    this.rowGray.source = { kind: 'generated', key: 'melee/har-row2-gray' };
    this.rowGray.hdSource = { surf: sheet, x: 0, y: 42, gray: true };
    // The row's black cell backgrounds (the first cell, below KATANA, stays empty).
    const back = new Surface(sheet.w, 36, undefined, 0);
    for (let i = 0; i < 5; i++) back.fillRect(62 * i, 0, 51, 36, CELL_BACKGROUND);
    back.source = { kind: 'generated', key: 'melee/har-row3-back' };
    const cells: { surf: Surface; x: number }[] = [];
    EXTRA_HAR_IDS.forEach((id, i) => {
      const pic = harPicture(id, MOVE.PORTRAIT_CELL);
      if (!pic) return;
      const enabled = pic.surface;
      enabled.transparent = CELL_BACKGROUND;
      this.harPortraits[id] = { x: 11 + 62 * (i + 1), y: 157, disabledOffset: 0, enabled, disabled: null };
      // Unselected: the cell in grey, which the remastered renderer draws from the colored cell's artwork in grey
      // (like the original rows).
      const g = new Surface(enabled.w, enabled.h, enabled.data.slice(), CELL_BACKGROUND);
      g.convertHarToGrayscale(8);
      g.source = { kind: 'generated', key: `melee/har-cell-gray/${id}` };
      g.hdSource = { surf: enabled, x: 0, y: 0, gray: true };
      cells.push({ surf: g, x: 62 * (i + 1) });
    });
    this.extraGray = { back, cells };
  }

  private loadHars(player2IsSelectable: boolean): void {
    this.har[0] = new GameObject(this.gs, 110, 95);
    this.updateHar(0);
    if (player2IsSelectable) {
      this.har[1] = new GameObject(this.gs, 210, 95);
      this.updateHar(1);
      this.har[1].direction = OBJECT_FACE_LEFT;
      this.har[1].palOffset = 48;
      this.har[1].palLimit = 96;
    }
  }

  /** melee_event_cb: color cheat — keys 1-3 change player 1's colors, 4-6 player 2's (HAR page). */
  override keyEvent(code: string, e: KeyboardEvent): boolean {
    if (e === this.lastKeyEvent) return false;
    this.lastKeyEvent = e;
    if (this.page === HAR_SELECT && e.type === 'keydown' && /^Digit[1-6]$/.test(code)) {
      if (!this.networkGame) {
        const idx = code.charCodeAt(5) - 0x31;
        const palId = idx % 3;
        const playerId = Math.trunc(idx / 3);
        const player = this.gs.getPlayer(playerId);
        let color = getPilotColor(player.pilot, palId);
        color = (color + 1) % 16;
        setPilotColor(player.pilot, palId, color);
        paletteLoadPlayerColors(player.pilot.palette, playerId);
      }
    }
    return false;
  }
}

registerScene(SceneId.MELEE, (gs) => new MeleeScene(gs));
