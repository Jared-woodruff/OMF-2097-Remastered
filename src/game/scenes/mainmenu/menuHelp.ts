// Help pages (port of the reference mainmenu/menu_help.c): the 13 formatted help texts of the language file.
import { video } from '../../../video/draw';
import type { Surface } from '../../../video/surface';
import { ACT_DOWN, ACT_ESC, ACT_UP, type CtrlType } from '../../constants';
import { drawDocument, FontSize, GLYPH_SHADOW_NONE, HAlign, type Text, TEXT_BRIGHT_GREEN, textDocument } from '../../gui/text';
import { Menu, MenuBackgroundStyle, menuBackground, menuShade } from '../../gui/widgets';
import type { MainMenuScene } from '../mainmenu';
import { lang } from './common';

const TEXT_SHADOW_GREEN = 254;
const NUM_PAGES = 13;

/** A menu without entries: renders the current page and turns pages with up/down (or PAGE UP / PAGE DOWN keys). */
export class HelpMenu extends Menu {
  page = 0;
  doc: Text[] = [];
  private readonly background1: Surface = menuShade(290, 170);
  private readonly background2: Surface = menuBackground(290, 170, MenuBackgroundStyle.MENU);

  constructor() {
    super();
    this.helpMenuUpdate();
  }

  /** help_menu_update() */
  private helpMenuUpdate(): void {
    this.doc = textDocument(lang(this.page), FontSize.BIG, 280, 170, TEXT_BRIGHT_GREEN, TEXT_SHADOW_GREEN, HAlign.LEFT,
      GLYPH_SHADOW_NONE, 1);
    for (const t of this.doc) t.setMargin({ left: 10 }); // text_margin {10, 0, 0, 0}
  }

  /** menu_help_render() */
  override render(): void {
    video.drawRemap(this.background1, 15, 15, 4, 1, 0);
    video.draw(this.background2, 15, 15);
    drawDocument(this.doc, 15, 20);
  }

  /** menu_help_event(): PAGE UP / PAGE DOWN (only reach here when not bound to player 1, see MainMenuScene.keyEvent). */
  override keyEvent(code: string, _e: KeyboardEvent): boolean {
    if (code === 'PageUp' && this.page > 0) {
      this.page--;
      this.helpMenuUpdate();
      return true;
    } else if (code === 'PageDown' && this.page < NUM_PAGES - 1) {
      this.page++;
      this.helpMenuUpdate();
    }
    return false;
  }

  /** menu_help_action() */
  override action(action: number, _source: CtrlType): number {
    if (action === ACT_UP && this.page > 0) {
      this.page--;
      this.helpMenuUpdate();
      return 1;
    } else if (action === ACT_DOWN && this.page < NUM_PAGES - 1) {
      this.page++;
      this.helpMenuUpdate();
      return 1;
    } else if (action === ACT_ESC) {
      this.finished = true;
    }
    return 0;
  }
}

export function menuHelpCreate(_s: MainMenuScene): Menu {
  return new HelpMenu();
}
