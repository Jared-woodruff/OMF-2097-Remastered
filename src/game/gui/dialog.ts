// Modal yes/no, ok or cancel dialog (port of the reference gui dialog).
import { NATIVE_H, NATIVE_W } from '../../video/draw';
import { ACT_ESC, CtrlType } from '../constants';
import { FontSize, Text, TEXT_BRIGHT_GREEN, TEXT_MEDIUM_GREEN } from './text';
import { Button, Filler, GuiFrame, Label, Menu, type GuiTheme } from './widgets';

export const enum DialogStyle {
  YES_NO,
  OK,
  CANCEL,
}

export const enum DialogResult {
  CANCEL,
  YES_OK,
  NO,
}

export type DialogClickedCb = (dlg: Dialog, result: DialogResult) => void;

export class Dialog {
  x: number;
  y: number;
  frame: GuiFrame;
  visible = false;
  userdata: unknown = null;
  clicked: DialogClickedCb | null = null;

  /** dialog_create_h: a titled menu with a centered row of bordered buttons. */
  constructor(style: DialogStyle, text: string, x: number, y: number, h = 60) {
    const theme: GuiTheme = {
      borderColor: TEXT_MEDIUM_GREEN,
      font: FontSize.BIG,
      primaryColor: TEXT_MEDIUM_GREEN,
      secondaryColor: TEXT_BRIGHT_GREEN,
      activeColor: TEXT_BRIGHT_GREEN,
      inactiveColor: TEXT_MEDIUM_GREEN,
      disabledColor: 0,
      shadowColor: 0,
    };
    const w = NATIVE_W - 2 * x;
    // Messages longer than the reference's fixed height allows get a taller dialog (they were cut off), moved up if
    // needed to stay on screen.
    const probe = new Text(FontSize.BIG, w, 0xffff, text).setMargin({ left: 2, right: 2, top: 2, bottom: 2 });
    h = Math.max(h, probe.height() + 3 + 8 + 3 + 12 + 3 + 8);
    if (y + h > NATIVE_H - 4) y = Math.max(4, NATIVE_H - 4 - h);
    this.x = x;
    this.y = y;
    const menu = new Menu();
    const title = Label.title(text);
    title.text.setMargin({ left: 2, right: 2, top: 2, bottom: 2 });
    title.setSizeHints(w, -1);
    menu.attach(title);
    menu.attach(new Filler());
    const menu2 = new Menu();
    menu2.horizontal = true;
    menu2.background = false;
    menu2.centered = true;
    menu2.marginTop = 0;
    menu2.padding = 20;
    menu.attach(menu2);
    menu2.setSizeHints(-1, 12);
    if (style === DialogStyle.CANCEL) {
      menu2.attach(new Button('CANCEL', null, false, true, () => this.cancel()));
    } else if (style === DialogStyle.YES_NO) {
      menu2.attach(new Button('YES', null, false, true, () => this.yesOk()));
      menu2.attach(new Button('NO', null, false, true, () => this.no()));
    } else if (style === DialogStyle.OK) {
      menu2.attach(new Button('OK', null, false, true, () => this.yesOk()));
    }
    this.frame = new GuiFrame(theme, x, y, w, h);
    this.frame.setRoot(menu);
    this.frame.layout();
  }

  private cancel(): void {
    this.clicked?.(this, DialogResult.CANCEL);
  }

  private no(): void {
    this.clicked?.(this, DialogResult.NO);
  }

  private yesOk(): void {
    this.clicked?.(this, DialogResult.YES_OK);
  }

  show(visible: boolean): void {
    this.visible = visible;
  }

  isVisible(): boolean {
    return this.visible;
  }

  render(): void {
    if (!this.visible) return;
    this.frame.render();
  }

  tick(): void {
    if (!this.visible) return;
    this.frame.tick();
  }

  event(action: number, source: CtrlType = CtrlType.KEYBOARD): void {
    if (!this.visible) return;
    this.frame.action(action, source);
    if (action === ACT_ESC && this.clicked) this.clicked(this, DialogResult.CANCEL);
  }

  free(): void {
    this.frame.free();
  }
}
