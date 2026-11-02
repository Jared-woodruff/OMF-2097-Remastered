// The help overlay with a gamepad (issue #16): B, View or Menu close the controls screen (KEYS AND BUTTONS), B or A the
// help pages, B a page over the main menu (replays, mods...) once it has no question open, and the game goes on when the
// button is let go. update() took the pads' state as the last one before its close checks, so no button could close.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PadButton } from '../controller/input';
import { SceneId } from '../game/constants';
import { detectKeyLayout } from '../game/controls';
import { HelpOverlay, helpOverlayHeld } from '../game/gui/helpOverlay';
import { Page } from '../game/gui/page';
import { defaultSettings, settings } from '../game/settings';
import { createGame, hasGameData } from './harness';

let pads: unknown[] = [];

/** A standard pad with these buttons down. */
function pad(pressed: number[] = []) {
  return {
    index: 0, connected: true, id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b12)', mapping: 'standard',
    buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i) })), axes: [0, 0, 0, 0],
  };
}

/** A page with a question open, as the replays' delete confirmation: B answers it before it closes the page. */
class AskingPage extends Page {
  asking = true;

  override back(): boolean {
    const was = this.asking;
    this.asking = false;
    return was;
  }
}

describe.skipIf(!hasGameData)('the help overlay with a gamepad', () => {
  let paused: boolean[] = [];

  beforeEach(() => {
    pads = [];
    paused = [];
    vi.stubGlobal('navigator', { getGamepads: () => pads });
    createGame(SceneId.MENU);
    Object.assign(settings(), defaultSettings());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Object.assign(settings(), defaultSettings());
  });

  /** Opens it, and lets go of the buttons (open() counts each one as held until then). */
  function opened(kind: 'help' | 'controls' | Page): HelpOverlay {
    const help = new HelpOverlay((p) => paused.push(p));
    help.open(kind);
    help.update();
    expect(help.isOpen()).toBe(true);
    return help;
  }

  /** Presses buttons for a frame, then lets go for one. */
  function press(help: HelpOverlay, buttons: number[]): void {
    pads = [pad(buttons)];
    help.update();
    pads = [pad()];
    help.update();
  }

  it('B, View or Menu close the controls screen; A changes its layout and the d-pad its page', () => {
    for (const button of [PadButton.B, PadButton.VIEW, PadButton.MENU]) {
      const help = opened('controls');
      try {
        const layout = detectKeyLayout();
        press(help, [PadButton.A]);
        expect(detectKeyLayout()).not.toBe(layout);
        press(help, [PadButton.RIGHT]);
        expect(help.isOpen()).toBe(true);
        press(help, [button]);
        expect(help.isOpen()).toBe(false);
      } finally {
        help.close(null);
      }
    }
  });

  it('B or A close the help pages', () => {
    for (const button of [PadButton.B, PadButton.A]) {
      const help = opened('help');
      try {
        press(help, [button]);
        expect(help.isOpen()).toBe(false);
      } finally {
        help.close(null);
      }
    }
  });

  it("B answers a page's question first, then closes the page", () => {
    const page = new AskingPage();
    const help = opened(page);
    try {
      press(help, [PadButton.B]);
      expect(page.asking).toBe(false);
      expect(help.isOpen()).toBe(true);
      press(help, [PadButton.B]);
      expect(help.isOpen()).toBe(false);
    } finally {
      help.close(null);
    }
  });

  it('the game goes on once the closing button is let go, so the screen under it does not take the press', () => {
    const help = opened(new AskingPage());
    try {
      press(help, [PadButton.B]);
      pads = [pad([PadButton.B])];
      help.update();
      expect(help.isOpen()).toBe(false);
      expect(helpOverlayHeld()).toBe(true);
      expect(paused.at(-1)).toBe(true);
      pads = [pad()];
      help.update();
      expect(helpOverlayHeld()).toBe(false);
      expect(paused.at(-1)).toBe(false);
    } finally {
      help.close(null);
    }
  });
});
