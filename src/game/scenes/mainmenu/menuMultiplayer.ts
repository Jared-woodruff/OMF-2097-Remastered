// MAIN MENU > MULTIPLAYER (the original's TWO PLAYER GAME, and network play): two players on this computer, on two
// computers of the local network, or (later) over the internet.
import { app } from '../../../app';
import { lanBackend } from '../../../net/lan';
import { toast } from '../../../platform/toast';
import { Button, Label, Menu } from '../../gui/widgets';
import type { MainMenuScene } from '../mainmenu';
import { menuDone } from './common';
import { mainmenu1v2 } from './menuMain';

/** An entry for what is still to come: dimmed like a disabled one, but it can be picked to read its help. */
class SoonButton extends Button {
  override render(): void {
    const disabled = this.disabled;
    this.disabled = !this.selected;
    super.render();
    this.disabled = disabled;
  }
}

export function menuMultiplayerCreate(s: MainMenuScene): Menu {
  const menu = new Menu();
  menu.attach(Label.title('MULTIPLAYER'));
  menu.attach(new Button('LOCAL', 'Two players on this computer, like the original two player game: share the keyboard, or ' +
    'plug in controllers.', false, false, () => mainmenu1v2(s)));
  menu.attach(new Button('LAN', lanBackend()
    ? 'Fight a friend on another computer of your home network: host a game, or join one.'
    : 'Fight a friend on another computer of your home network, in the desktop app (a browser cannot reach other ' +
      'computers by itself).', false, false, () => app.showLan()));
  menu.attach(new SoonButton('ONLINE', 'Coming soon: fight anyone over the internet.', false, false,
    () => toast('Online play is coming soon.', 3500)));
  menu.attach(new Button('DONE', 'Go back to the main menu.', false, false, menuDone));
  return menu;
}
