// Main menu scene (port of the reference scenes/mainmenu.c). The menus themselves are in ./mainmenu/.
import type { CtrlEvent } from '../../controller/controller';
import { isDown, onKey } from '../../controller/input';
import { KeyboardController } from '../../controller/keyboard';
import { Pilot } from '../../formats/pilot';
import { TAG_MENU, video } from '../../video/draw';
import { pulseMenuColors } from '../../video/vga';
import { CtrlType, SceneId } from '../constants';
import { registerScene, type GameState } from '../gameState';
import { Button, GuiFrame, mainMenuTheme, Menu } from '../gui/widgets';
import { Scene } from '../scene';
import { saveSettings, settings, type KeyBindings } from '../settings';
import { activeMenu } from './mainmenu/common';
import { helpOverlayOpen } from '../gui/helpOverlay';
import { menuMainCreate } from './mainmenu/menuMain';
import { menuExtrasCreate } from './mainmenu/menuExtras';
import { menuModesCreate } from './mainmenu/menuModes';
import { PresskeyMenu } from './mainmenu/menuPresskey';
import { randomArena } from '../roster';

/** keyboard_binds_key(): whether a key is one of the keyboard controller's bindings. */
function keyboardBindsKey(ctrl: KeyboardController, code: string): boolean {
  const binds = (k: KeyBindings) => Object.values(k).some((codes: unknown) => Array.isArray(codes) && codes.includes(code));
  return binds(ctrl.keys) || ctrl.extra.some(binds);
}

export class MainMenuScene extends Scene {
  frame: GuiFrame;
  /**
   * Menu input is ignored while this key is held: set after the custom keyboard setup captures a key (and for the
   * Alt+Enter hotkey), so that e.g. binding ENTER does not also press the menu entry under the cursor.
   */
  swallowKey: string | null = null;
  private lastKeyEvent: KeyboardEvent | null = null;
  private unsubscribeKeys: () => void;

  constructor(gs: GameState) {
    super(gs, SceneId.MENU);
    gs.matchSettingsReset();
    gs.training = false;
    gs.modeRun = null;
    gs.modeLabel = null;
    gs.credits = null;
    const player1 = gs.getPlayer(0);
    // Back from a tournament: drop the tournament character and start with a fresh pilot.
    if (player1.chr) {
      player1.chr = null;
      player1.pilot = new Pilot();
    } else if (player1.pilot.photo) {
      // Deviation: visiting the mechlab without a character leaves a tournament portrait on the arcade pilot, which
      // made later one/two player fights show a portrait instead of the round tokens (reference quirk).
      player1.pilot.photo = null;
    }
    // The reference also re-creates player 2's pilot: tournament code (VS / newsroom) clears it.
    const player2 = gs.getPlayer(1) as { pilot: Pilot | null };
    if (!player2.pilot) player2.pilot = new Pilot();
    gs.setSpeed(settings().gameplay.speed + 5);

    this.frame = new GuiFrame(mainMenuTheme(), 165, 5, 151, 119);
    const root = menuMainCreate(this);
    this.frame.setRoot(root);
    this.frame.layout();
    // Back from a screen of EXTRAS (a replay, the credits, a workshop robot tried out) or from a run or training of
    // MORE MODES: that menu is open again.
    if (gs.menuReturn) {
      const title = gs.menuReturn === 'extras' ? 'EXTRAS' : 'MORE MODES';
      const entry = root.items.find((c) => c instanceof Button && c.text.str === title);
      if (entry) {
        root.select(entry);
        root.setSubmenu(gs.menuReturn === 'extras' ? menuExtrasCreate(this) : menuModesCreate(this));
      }
    }
    gs.menuReturn = null;

    for (let i = 0; i < 2; i++) {
      const player = gs.getPlayer(i);
      // game_player_set_ctrl(player, NULL): the controllers are rebuilt by reconfigureControllers() below.
      player.spWins = 0;
      player.score.reset(true);
      player.score.resetWins();
    }
    gs.arena = randomArena();
    gs.reconfigureControllers();
    gs.playMusic('MENU.PSM');

    // Raw key events (help page keys, key capture). The engine may also forward them through Scene.keyEvent;
    // keyEvent() ignores the second delivery of the same event.
    this.unsubscribeKeys = onKey((code, e) => {
      if (this.gs.sc === this && !helpOverlayOpen()) this.keyEvent(code, e);
    });
  }

  /** mainmenu_startup(): the two background animations of MAIN.BK loop. */
  override startup(id: number): [boolean, boolean] {
    if (id === 10 || id === 11) return [true, true];
    return [false, false];
  }

  /** mainmenu_tick() */
  override dynamicTick(_paused: boolean): void {
    pulseMenuColors(Math.trunc(this.gs.tick / 8));
    this.frame.tick();
  }

  /** mainmenu_input_tick() */
  override inputPoll(): void {
    const ev: CtrlEvent[] = [];
    this.gs.menuPoll(ev);
    if (this.swallowKey !== null) {
      if (isDown(this.swallowKey)) return;
      this.swallowKey = null;
    }
    for (const e of ev) {
      if (e.type === 'action') this.frame.action(e.action, e.source);
    }
  }

  /** mainmenu_event() */
  override keyEvent(code: string, e: KeyboardEvent): boolean {
    if (e === this.lastKeyEvent) return true;
    this.lastKeyEvent = e;
    if (this.gs.thisId !== this.gs.nextId) return false; // fading out
    // Alt+Enter is the host's fullscreen hotkey: it should not also press the menu entry under the cursor.
    if (e.altKey && (code === 'Enter' || code === 'NumpadEnter')) {
      this.swallowKey = code;
      return true;
    }
    const root = this.frame.root;
    // The reference's key capture polls the keyboard state directly, so it sees every key.
    if (root instanceof Menu && activeMenu(root) instanceof PresskeyMenu) return this.frame.keyEvent(code, e);
    // With a gamepad, or for keys bound to player 1 (which drive the menu), key events are not passed to the GUI.
    const ctrl = this.gs.getPlayer(0).ctrl;
    if (ctrl.type === CtrlType.GAMEPAD || (ctrl instanceof KeyboardController && keyboardBindsKey(ctrl, code))) return true;
    return this.frame.keyEvent(code, e);
  }

  /** mainmenu_render() (render overlay callback) */
  override renderOverlay(): void {
    video.setTag(TAG_MENU);
    this.frame.render();
  }

  /** mainmenu_free() */
  override free(): void {
    this.unsubscribeKeys();
    this.frame.free();
    saveSettings();
  }
}

registerScene(SceneId.MENU, (gs) => new MainMenuScene(gs));
