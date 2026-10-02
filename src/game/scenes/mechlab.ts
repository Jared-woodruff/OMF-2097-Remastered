// Mechlab: the tournament mode hub. The upper half shows a dashboard (pilot and HAR stats, name entry, tournament
// choice, SIM opponents), the lower half the current tournament menu; the pilot's HAR spins in between.
// New pilots go through name -> photo -> difficulty -> tournament; the character is saved to a CHR save game.
// Port of the reference scenes/mechlab.c (menus and dashboards are in ./mechlab/).
import { HAR_NAMES, ORIGINAL_HAR_TYPES } from '../constants';
import { mechAnimation } from '../../gen/mechlabModel';
import type { CtrlEvent } from '../../controller/controller';
import { isDown } from '../../controller/input';
import { KeyboardController } from '../../controller/keyboard';
import { Pilot } from '../../formats/pilot';
import { Animation, RSprite } from '../../resources/animation';
import { bkGetInfo, hasFighter, langGet } from '../../resources/resources';
import { sgLoadPilot, sgSave } from '../../resources/sgmanager';
import { TAG_BACKGROUND, TAG_MENU, TAG_NONE, video } from '../../video/draw';
import type { Surface } from '../../video/surface';
import { ACT_ESC, ACT_PUNCH, ACT_STOP, CtrlType, SceneId } from '../constants';
import { gamePlayerGetPilot, gamePlayerSetPilot, registerScene, type GameState } from '../gameState';
import { FontSize, HAlign, Text, TEXT_MEDIUM_GREEN, VAlign } from '../gui/text';
import type { TrnMenu } from '../gui/trnMenu';
import { GuiFrame, Label, menuBackground, MenuBackgroundStyle, menuShade, type GuiTheme } from '../gui/widgets';
import { GameObject } from '../object';
import { Scene } from '../scene';
import { settings, type KeyBindings } from '../settings';
import { chrCreate, chrFromTrn, type ChrEnemy } from '../tournament/chr';
import { cFormat, DashboardType, MECHLAB_YELLOW } from './mechlab/common';
import {
  dashboardWidgetsCreate, labDashMainChrDelete, labDashMainChrDone, labDashMainChrInit, labDashMainChrLeft, labDashMainChrLoad,
  labDashMainChrRight, labDashMainCreate, labDashMainPhotoLeft, labDashMainPhotoRight, labDashMainPhotoSelect, labDashMainUpdate,
  labDashSimCreate, labDashSimDone, labDashSimInit, labDashSimLeft, labDashSimRight, labDashSimUpdate, type DashboardWidgets,
} from './mechlab/labDashMain';
import { labDashNewplayerCreate, type NewplayerWidgets } from './mechlab/labDashNewplayer';
import {
  labDashTrnselectCreate, labDashTrnselectLeft, labDashTrnselectRight, labDashTrnselectSelect, labDashTrnselectSelected,
  type TrnselectWidgets,
} from './mechlab/labDashTrnselect';
import { labMenuDifficultyselectCreate } from './mechlab/labMenuDifficultyselect';
import { labMenuMainCreate } from './mechlab/labMenuMain';
import { labMenuSelectCreate } from './mechlab/labMenuSelect';

export { DashboardType, MECHLAB_BRIGHT_GREEN, MECHLAB_DARK_GREEN, MECHLAB_YELLOW } from './mechlab/common';

// Colors specific to palette used by mechlab
const TEXT_PRIMARY_COLOR = 0xfe;
const TEXT_SECONDARY_COLOR = 0xfd;
const TEXT_DISABLED_COLOR = 0xc0;
const TEXT_ACTIVE_COLOR = 0xff;
const TEXT_INACTIVE_COLOR = 0xfe;
const TEXT_SHADOW_COLOR = 0xc0;

const POPUP_TEXT_W = 200;
const POPUP_TEXT_H = 48;
const POPUP_BG_W = POPUP_TEXT_W + 40;
const POPUP_BG_H = POPUP_TEXT_H;
const POPUP_CENTERY = 70;
const NATIVE_W = 320;

/** mechlab_theme() */
export function mechlabTheme(): GuiTheme {
  return {
    borderColor: TEXT_MEDIUM_GREEN,
    font: FontSize.BIG,
    primaryColor: TEXT_PRIMARY_COLOR,
    secondaryColor: TEXT_SECONDARY_COLOR,
    disabledColor: TEXT_DISABLED_COLOR,
    activeColor: TEXT_ACTIVE_COLOR,
    inactiveColor: TEXT_INACTIVE_COLOR,
    shadowColor: TEXT_SHADOW_COLOR,
  };
}

/** keyboard_binds_key(): whether a key is one of the keyboard controller's bindings. */
function keyboardBindsKey(ctrl: KeyboardController, code: string): boolean {
  const binds = (k: KeyBindings) => Object.values(k).some((codes: unknown) => Array.isArray(codes) && codes.includes(code));
  return binds(ctrl.keys) || ctrl.extra.some(binds);
}

/** mechlab_mech_finished_cb(): the HAR stops facing the viewer (color selection). */
function mechlabMechFinishedCb(obj: GameObject): void {
  obj.playerReset();
  obj.playerRun();
  obj.setHalt(1);
}

export class MechlabScene extends Scene {
  dashtype = DashboardType.NONE;
  bgObj: GameObject[] = [];
  frame!: GuiFrame;
  dashboard: GuiFrame | null = null;
  mech: GameObject | null = null;
  dw: DashboardWidgets = dashboardWidgetsCreate(this);
  nw: NewplayerWidgets = { input: null };
  tw: TrnselectWidgets = { trnselect: null };
  selling = false;
  hint: Label;
  /** Required by the hint component */
  theme: GuiTheme;
  popup: Text | null = null;
  popupBg1: Surface;
  popupBg2: Surface;

  /** mechlab_create() */
  constructor(gs: GameState) {
    super(gs, SceneId.MECHLAB);
    this.selling = false;

    // Default theme for mechlab
    this.theme = mechlabTheme();

    // reset the match settings and override the settings that don't apply in tournament mode
    gs.matchSettingsReset();
    gs.matchSettings.power1 = 5;
    gs.matchSettings.power2 = 5;
    gs.matchSettings.vitality = 100;
    gs.matchSettings.rounds = 0;

    // so the TRN_CUTSCENE cheat skips the VS screen
    gs.fightStats.winner = -1;

    // Init the background (the three parts of BK animation 14, drawn by the scene)
    const bgAni = bkGetInfo(this.bk, 14)!.ani;
    for (let i = 0; i < 3; i++) {
      const src = bgAni.getSprite(i)!;
      const spr = new RSprite(src.id, src.posX, src.posY, src.surface); // sprite_copy (pixels are shared, read only)
      const obj = new GameObject(gs, 0, 0);
      obj.setAnimation(Animation.fromSingle(spr, spr.posX, spr.posY));
      obj.selectSprite(0);
      obj.setRepeat(true);
      this.bgObj.push(obj);
    }

    this.hint = new Label('HINTY');
    this.hint.font = FontSize.SMALL;
    this.hint.halign = HAlign.CENTER;
    this.hint.valign = VAlign.MIDDLE;
    this.hint.overrideColor = MECHLAB_YELLOW;
    this.hint.setPosHints(32, 131);
    this.hint.setSizeHints(248, 13);
    this.hint.init(this.theme);
    this.hint.layout(32, 131, 248, 13);

    const found = this.findLastPlayer();
    this.selectDashboard(DashboardType.STATS);

    this.popupBg1 = menuShade(POPUP_BG_W, POPUP_BG_H);
    this.popupBg2 = menuBackground(POPUP_BG_W, POPUP_BG_H, MenuBackgroundStyle.NEWSROOM);

    // Create main menu
    this.frame = new GuiFrame(this.theme, 0, 0, 320, 200);
    this.frame.setRoot(labMenuMainCreate(this, found));
    this.frame.layout();
  }

  private rootMenu(): TrnMenu {
    return this.frame.root as TrnMenu;
  }

  /** A spinning HAR preview (BK animation 15 + HAR id; rendered by the generator for the remaster's robots), ticked and drawn by the scene. */
  private createMech(harId: number): GameObject | null {
    this.mechHar = harId;
    const ani = harId < ORIGINAL_HAR_TYPES ? bkGetInfo(this.bk, 15 + harId)?.ani : mechAnimation(harId);
    if (!ani) return null;
    const obj = new GameObject(this.gs, 0, 0);
    obj.setAnimation(ani);
    obj.setRepeat(true);
    obj.dynamicTick();
    return obj;
  }

  private freeMech(): void {
    this.mech?.free();
    this.mech = null;
    this.mechHar = -1;
  }

  /** The robot the turning one on the pedestal was made for. */
  private mechHar = -1;

  /**
   * mechlab_find_last_player(): loads the last played character (settings tournament.last_name) unless one is
   * loaded already; returns whether a character is loaded.
   */
  findLastPlayer(): boolean {
    // Find last saved game ...
    const p1 = this.gs.getPlayer(0);
    let lastName: string | null = settings().tournament.lastName;
    if (!lastName) lastName = null;

    // ... and attempt to load it, if one was found and we don't have one already loaded
    if (!p1.chr && lastName !== null) {
      const chr = sgLoadPilot(lastName);
      if (!chr) {
        console.error(`Could not load saved game for pilot '${lastName}'!`);
        lastName = null;
      } else {
        p1.chr = chr;
      }
    }

    // Either initialize a new tournament if no savegame is found, or just show old savegame stats directly if it was.
    this.dashtype = DashboardType.NONE;
    if (p1.chr === null) {
      this.freeMech();
      const pilot = gamePlayerGetPilot(p1);
      if (pilot) {
        pilot.money = 0;
        pilot.harId = 0;
      }
      return false;
    }
    // Load HAR
    this.freeMech();
    this.mech = this.createMech(p1.chr.pilot.harId);
    if (p1.chr.pilot !== gamePlayerGetPilot(p1)) gamePlayerSetPilot(p1, p1.chr.pilot);
    return true;
  }

  /** mechlab_load_har() */
  mechlabLoadHar(pilot: Pilot): void {
    this.freeMech();
    this.mech = this.createMech(pilot.harId);
  }

  setSelling(selling: boolean): void {
    this.selling = selling;
  }

  getSelling(): boolean {
    return this.selling;
  }

  /** mechlab_set_hint() */
  setHint(hint: string): void {
    this.hint.setText(hint);
  }

  /**
   * Whether a fight's robots are in the game (a mod's robot is not while its mod is off, say the new robots a pilot
   * fights in or was put against): if not, the hint says which and where to turn it on.
   */
  robotsThere(harIds: number[]): boolean {
    const missing = harIds.find((id) => !hasFighter(id));
    if (missing === undefined) return true;
    this.setHint(`${(HAR_NAMES[missing] ?? 'ITS ROBOT').toUpperCase()} IS FROM A MOD THAT IS OFF: TURN IT ON IN EXTRAS > MODS.`);
    return false;
  }

  /** mechlab_spin_har(): stop (after finishing the current turn, facing front) or resume the HAR rotation. */
  spinHar(spin: boolean): void {
    const mech = this.mech;
    if (!mech) return;
    if (spin) {
      mech.setHaltTicks(mech.halt);
      mech.setRepeat(true);
    } else {
      mech.haltTicks = 0;
      mech.onFinish = mechlabMechFinishedCb;
      mech.setRepeat(false);
    }
  }

  /** mechlab_next_opponent(): the enemy ranked right above the player (none for the champion). */
  nextOpponent(): ChrEnemy | null {
    const chr = this.gs.getPlayer(0).chr;
    if (!chr || chr.pilot.rank === 1) return null;
    for (let i = 0; i < chr.pilot.enemiesIncUnranked; i++) {
      if (chr.enemies[i].pilot.rank === chr.pilot.rank - 1) return chr.enemies[i];
    }
    return null;
  }

  /** mechlab_free(): saves the character. */
  override free(): void {
    const player1 = this.gs.getPlayer(0);
    // save the character file
    if (player1.chr !== null && !sgSave(player1.chr)) console.error(`Failed to save pilot ${player1.chr.pilot.name}`);

    for (const o of this.bgObj) o.free();
    this.popup = null;
    this.frame.free();
    this.dashboard?.free();
    this.dashboard = null;
    this.freeMech();
    this.hint.free();

    // Deviation: backing out of LOAD without a loaded character leaves player 1 without a pilot (the reference then
    // crashes in the main menu's player setup); give them a fresh one.
    if (!gamePlayerGetPilot(player1)) gamePlayerSetPilot(player1, new Pilot());
  }

  /** mechlab_enter_trnselect_menu() */
  enterTrnselectMenu(): void {
    const tw = this.tw;
    const menu = labMenuSelectCreate(this, (c) => labDashTrnselectSelect(c, tw), (c) => labDashTrnselectLeft(c, tw),
      (c) => labDashTrnselectRight(c, tw), langGet(486), true);
    this.frame.setRoot(menu);
    this.frame.layout();
  }

  /** mechlab_chrload_menu_create() */
  chrloadMenuCreate(): TrnMenu {
    const dw = this.dw;
    const menu = labMenuSelectCreate(this, (c) => labDashMainChrLoad(c, dw), (c) => labDashMainChrLeft(c, dw),
      (c) => labDashMainChrRight(c, dw), langGet(225), true);
    menu.setSubmenuInitCb(labDashMainChrInit);
    menu.setSubmenuDoneCb(labDashMainChrDone);
    menu.setUserdata(dw);
    return menu;
  }

  /** mechlab_chrdelete_menu_create() */
  chrdeleteMenuCreate(): TrnMenu {
    const dw = this.dw;
    const menu = labMenuSelectCreate(this, (c) => labDashMainChrDelete(c, dw), (c) => labDashMainChrLeft(c, dw),
      (c) => labDashMainChrRight(c, dw), langGet(226), true);
    menu.setSubmenuInitCb(labDashMainChrInit);
    menu.setSubmenuDoneCb(labDashMainChrDone);
    menu.setUserdata(dw);
    return menu;
  }

  /**
   * mechlab_sim_menu_create(). Quirk kept: SELECT runs the save game *delete* callback (lab_dash_main_chr_delete) on
   * the player's own pilot; the character is saved again when the mechlab is left for the fight.
   */
  simMenuCreate(): TrnMenu {
    const dw = this.dw;
    const menu = labMenuSelectCreate(this, (c) => labDashMainChrDelete(c, dw), (c) => labDashSimLeft(c, dw),
      (c) => labDashSimRight(c, dw), langGet(227), true);
    menu.setSubmenuInitCb(labDashSimInit);
    menu.setSubmenuDoneCb(labDashSimDone);
    menu.setUserdata(dw);
    this.dashtype = DashboardType.SIM;
    return menu;
  }

  /** mechlab_open_popup(): a message box closed by any key; the scene does not tick meanwhile. */
  openPopup(message: string): void {
    this.popup = new Text(FontSize.BIG, POPUP_TEXT_W, POPUP_TEXT_H, message).setVAlign(VAlign.MIDDLE).setHAlign(HAlign.CENTER);
  }

  /** mechlab_update(): follows HAR changes and refreshes the dashboard. */
  update(): void {
    const p1 = this.gs.getPlayer(0);
    const pilot = gamePlayerGetPilot(p1);
    if (pilot) {
      // (another robot: its own turning model; the same one keeps turning, a new robot's too: theirs is not in the BK)
      if (this.mech && this.mechHar !== pilot.harId) {
        this.mech.free();
        this.mech = this.createMech(pilot.harId);
      }
      switch (this.dashtype) {
        // Dashboard with the gauges etc.
        case DashboardType.STATS:
          labDashMainUpdate(this, this.dw);
          break;
        case DashboardType.SIM:
          labDashSimUpdate(this, this.dw, pilot);
          break;
        default:
          break;
      }
    } else {
      this.freeMech();
    }
  }

  private newFrame(root: TrnMenu): void {
    this.frame.free();
    this.frame = new GuiFrame(mechlabTheme(), 0, 0, 320, 200);
    this.frame.setRoot(root);
    this.frame.layout();
  }

  /** mechlab_tick() (dynamic tick): the menus, the HAR preview, and the flow when the root menu finishes. */
  override dynamicTick(_paused: boolean): void {
    if (this.popup) return;

    this.frame.tick();
    this.dashboard?.tick();
    this.mech?.dynamicTick();

    // Check if root is finished
    const root = this.rootMenu();
    if (!root.isFinished()) return;
    const player1 = this.gs.getPlayer(0);
    if (this.dashtype === DashboardType.NEW_PLAYER) {
      const selectPhoto = cFormat(64, langGet(224), player1.pilot.name);
      this.selectDashboard(DashboardType.SELECT_NEW_PIC);
      const dw = this.dw;
      this.newFrame(labMenuSelectCreate(this, (c) => labDashMainPhotoSelect(c, dw), (c) => labDashMainPhotoLeft(c, dw),
        (c) => labDashMainPhotoRight(c, dw), selectPhoto, true));
    } else if (this.dashtype === DashboardType.SELECT_NEW_PIC) {
      this.selectDashboard(DashboardType.SELECT_DIFFICULTY);
      this.newFrame(labMenuDifficultyselectCreate(this));
    } else if (this.dashtype === DashboardType.SELECT_DIFFICULTY) {
      this.selectDashboard(DashboardType.SELECT_TOURNAMENT);
      this.frame.free();
      this.frame = new GuiFrame(mechlabTheme(), 0, 0, 320, 200);
      this.enterTrnselectMenu();
    } else if (this.dashtype === DashboardType.SELECT_TOURNAMENT) {
      const trn = labDashTrnselectSelected(this.tw);
      const pilot = player1.pilot;
      if (trn) {
        if (pilot.money < trn.registrationFee) pilot.money = 0;
        else pilot.money = pilot.money - trn.registrationFee;
        const oldchr = player1.chr;
        const chr = chrCreate();
        chr.pilot = pilot.clone(); // memcpy(&chr->pilot, player1->pilot)
        chrFromTrn(chr, trn, pilot);
        player1.chr = chr;
        if (oldchr) {
          if (pilot !== oldchr.pilot) pilot.photo = null;
          else gamePlayerSetPilot(player1, null);
        }
        if (!sgSave(chr)) console.error(`Failed to save pilot ${chr.pilot.name}`);
        // force the character to reload because its just easier
        player1.chr = null;
      }
      const found = this.findLastPlayer();
      this.selectDashboard(DashboardType.STATS);
      this.newFrame(labMenuMainCreate(this, found));
    } else {
      this.gs.setNext(SceneId.MENU);
    }
  }

  /** mechlab_select_dashboard() */
  selectDashboard(type: DashboardType): void {
    const player1 = this.gs.getPlayer(0);
    if (type === this.dashtype) return; // No change

    // Free old dashboard if set
    this.dashboard?.free();

    // Switch to new dashboard
    this.dashtype = type;
    const theme = mechlabTheme();
    switch (type) {
      // Dashboard with the gauges etc.
      case DashboardType.STATS:
      case DashboardType.SELECT_DIFFICULTY:
      case DashboardType.SELECT_NEW_PIC:
        this.dashboard = new GuiFrame(theme, 0, 0, 320, 200);
        this.dashboard.setRoot(labDashMainCreate(this, this.dw));
        labDashMainUpdate(this, this.dw);
        this.dashboard.layout();
        break;
      case DashboardType.SIM:
        this.dashboard = new GuiFrame(theme, 0, 0, 320, 200);
        this.dashboard.setRoot(labDashSimCreate(this, this.dw));
        labDashSimUpdate(this, this.dw, player1.pilot);
        this.dashboard.layout();
        break;
      // Dashboard for new player
      case DashboardType.NEW_PLAYER: {
        if (player1.chr) {
          if (player1.chr.pilot === gamePlayerGetPilot(player1)) gamePlayerSetPilot(player1, new Pilot());
          player1.chr = null;
        }
        this.dashboard = new GuiFrame(theme, 0, 0, 320, 200);
        // new pilots have 2000 credits (memset(player1->pilot, 0, ...): the pilot is reset in place)
        let pilot = gamePlayerGetPilot(player1);
        if (pilot) Object.assign(pilot, new Pilot());
        else gamePlayerSetPilot(player1, (pilot = new Pilot())); // (the reference would crash on a NULL pilot)
        pilot.money = 2000;
        // and a jaguar
        pilot.harId = 0;
        // with no altpals yet
        pilot.color1 = 16;
        pilot.color2 = 16;
        pilot.color3 = 16;
        this.freeMech();
        this.mech = this.createMech(pilot.harId);

        this.dashboard.setRoot(labDashNewplayerCreate(this, this.nw));
        this.dashboard.layout();
        break;
      }
      case DashboardType.SELECT_TOURNAMENT:
        this.dashboard = new GuiFrame(theme, 0, 0, 320, 200);
        this.dashboard.setRoot(labDashTrnselectCreate(this, this.tw));
        this.dashboard.layout();
        break;
      // No dashboard selection. This shouldn't EVER happen.
      case DashboardType.NONE:
        console.error('No dashboard selected; this should not happen!');
        this.dashboard = null;
        break;
    }
  }

  /**
   * mechlab_event(): raw key events. Keys bound to player 1 are handled by polling; "E" replays the tournament
   * ending cutscene of a champion; the rest goes to the text input (new pilot) or the menus.
   */
  override keyEvent(code: string, e: KeyboardEvent): boolean {
    const player1 = this.gs.getPlayer(0);
    if (player1.ctrl.type === CtrlType.GAMEPAD || (player1.ctrl instanceof KeyboardController && keyboardBindsKey(player1.ctrl, code))) {
      // these events will be handled by polling
      return true;
    }
    if (this.dashtype === DashboardType.STATS && (e.key ?? '').toLowerCase() === 'e') {
      // user is trying to use the cutscene replay cheat.
      const pilot = gamePlayerGetPilot(player1);
      if (!player1.chr || player1.chr.bkName === '' || !pilot || pilot.rank !== 1) {
        console.info("Can't replay cutscene");
      } else {
        this.gs.fightStats.winner = -1;
        this.gs.setNext(SceneId.TRN_CUTSCENE);
        return true;
      }
    }
    if (this.dashtype === DashboardType.NEW_PLAYER) return this.dashboard?.keyEvent(code, e) ?? false;
    return this.frame.keyEvent(code, e);
  }

  /** mechlab_render() (drawn over the scene background) */
  override render(): void {
    const dashtype = this.dashtype;
    video.setTag(TAG_BACKGROUND);
    for (let i = 0; i < this.bgObj.length; i++) {
      if ((dashtype === DashboardType.SELECT_TOURNAMENT || dashtype === DashboardType.SIM) && i > 0) continue;
      this.bgObj[i].render();
    }

    // Render dashboard
    video.setTag(TAG_MENU);
    this.frame.render();

    if (dashtype !== DashboardType.NEW_PLAYER && this.mech !== null) {
      if (dashtype !== DashboardType.SELECT_TOURNAMENT && dashtype !== DashboardType.SIM) {
        video.setTag(TAG_NONE);
        this.mech.render();
        video.setTag(TAG_MENU);
      }
    }

    if (dashtype === DashboardType.STATS && this.mech !== null) this.dashboard?.render();
    else if (dashtype !== DashboardType.STATS) this.dashboard?.render();
    this.hint.render();

    if (this.popup) {
      video.drawRemap(this.popupBg1, Math.trunc((NATIVE_W - POPUP_BG_W) / 2), POPUP_CENTERY - Math.trunc(POPUP_BG_H / 2), 4, 1, 0);
      video.draw(this.popupBg2, Math.trunc((NATIVE_W - POPUP_BG_W) / 2), POPUP_CENTERY - Math.trunc(POPUP_BG_H / 2));
      this.popup.draw(Math.trunc((NATIVE_W - POPUP_TEXT_W) / 2), POPUP_CENTERY - Math.trunc(POPUP_TEXT_H / 2));
    }
    video.setTag(TAG_NONE);
  }

  /** Back to the stats dashboard and the main menu (ESC from the new pilot / photo / difficulty / tournament / SIM). */
  private backToMainMenu(): void {
    const found = this.findLastPlayer();
    this.selectDashboard(DashboardType.STATS);
    this.frame.setRoot(labMenuMainCreate(this, found));
    this.frame.layout();
  }

  /**
   * Deviation: our menu polling also maps Backspace to ESC and Space to PUNCH (the reference only polls Escape and
   * Return); while a pilot name is typed those keys edit the text instead.
   */
  private isTypingKey(action: number): boolean {
    if (action === ACT_ESC) return isDown('Backspace') && !isDown('Escape');
    if (action === ACT_PUNCH) return isDown('Space') && !isDown('Enter') && !isDown('NumpadEnter');
    return false;
  }

  /** mechlab_input_tick() */
  override inputPoll(): void {
    const player1 = this.gs.getPlayer(0);
    // Poll the controller
    const ev: CtrlEvent[] = [];
    this.gs.menuPoll(ev);
    for (const i of ev) {
      if (i.type !== 'action') continue;
      const action = i.action;
      if (this.popup) {
        if (action !== ACT_STOP) this.popup = null;
        continue;
      } else if (this.dashtype === DashboardType.NEW_PLAYER) {
        // If inputting text for new player name is done, switch to next view. If ESC, exit view.
        // Otherwise handle text input.
        if (this.isTypingKey(action)) continue;
        if (action === ACT_ESC) {
          this.backToMainMenu();
        } else if (action === ACT_PUNCH) {
          const input = this.nw.input;
          const name = input ? input.value() : '';
          if (name.length > 0) {
            player1.pilot.name = name;
            this.rootMenu().finish(); // This will trigger the next view in dynamicTick
          }
        } else {
          this.dashboard?.action(action, i.source);
        }
      } else if (this.dashtype === DashboardType.SELECT_NEW_PIC && action === ACT_ESC) {
        this.backToMainMenu();
      } else if (this.dashtype === DashboardType.SELECT_DIFFICULTY && action === ACT_ESC) {
        this.backToMainMenu();
      } else if (this.dashtype === DashboardType.SELECT_TOURNAMENT && action === ACT_ESC) {
        this.backToMainMenu();
      } else if (this.dashtype === DashboardType.SIM && action === ACT_ESC) {
        this.backToMainMenu();
      } else {
        this.frame.action(action, i.source);
      }
    }
  }
}

registerScene(SceneId.MECHLAB, (gs) => new MechlabScene(gs));
