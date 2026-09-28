// EXTRAS > CREDITS: the remaster's credits (creditsView.ts) as a page of the help overlay, which pauses the game and
// brings the menu actions: UP / DOWN scroll, ENTER / A pauses the titles, ESC / B goes back.
import { ACT_DOWN, ACT_PUNCH, ACT_UP, type CtrlType } from '../constants';
import { Page } from '../gui/page';
import { openCreditsView, type CreditsView } from './creditsView';

export class RemasterCreditsPage extends Page {
  private view: CreditsView | null = null;
  override readonly opaque = true;

  /** `links`: the links open in the browser (the web version); `start`: development, open at a card or section. */
  constructor(private links: boolean, private start = 0) {
    super();
  }

  override onOpen(): void {
    this.view = openCreditsView({ links: this.links, start: this.start, onExit: () => (this.finished = true) });
  }

  override onClose(): void {
    this.view?.dispose();
    this.view = null;
  }

  override render(): void {
    // (the credits are drawn in HTML over the game)
  }

  override action(action: number, _source: CtrlType): number {
    if (action === ACT_UP) this.view?.step(-1);
    else if (action === ACT_DOWN) this.view?.step(1);
    else if (action === ACT_PUNCH) this.view?.toggleAuto();
    return 0;
  }

  override key(code: string): boolean {
    if (code === 'PageUp' || code === 'PageDown') this.view?.step(code === 'PageUp' ? -3 : 3);
    else if (code === 'Home' || code === 'End') this.view?.jump(code === 'Home' ? -1 : 1);
    else return false;
    return true;
  }
}
