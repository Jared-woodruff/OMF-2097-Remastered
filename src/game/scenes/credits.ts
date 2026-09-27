// Credits: the CREDITS.BK sequence shown when quitting the game (port of the reference credits scene).
// The names are drawn with additive palette indices; GameState switches the framebuffer to FBUFOPT_CREDITS for
// this scene so they resolve through the palette without remapping. Ends by quitting (SceneId.NONE).
import type { CtrlEvent } from '../../controller/controller';
import { ACT_ESC, ACT_KICK, ACT_PUNCH, SceneId } from '../constants';
import { registerScene, type GameState } from '../gameState';
import { Scene } from '../scene';

const CREDITS_TICKS = 4500;

export class CreditsScene extends Scene {
  ticks = 0;

  constructor(gs: GameState) {
    super(gs, SceneId.CREDITS);
  }

  override startup(id: number): [boolean, boolean] {
    switch (id) {
      case 20:
        return [true, false];
    }
    return [false, false];
  }

  override dynamicTick(_paused: boolean): void {
    this.ticks++;
    if (this.ticks > CREDITS_TICKS) this.gs.setNext(SceneId.NONE);
  }

  override inputPoll(): void {
    const ev: CtrlEvent[] = [];
    this.gs.menuPoll(ev);
    for (const e of ev) {
      if (e.type !== 'action') continue;
      if (e.action === ACT_ESC || e.action === ACT_KICK || e.action === ACT_PUNCH) this.gs.setNext(SceneId.NONE);
    }
  }
}

registerScene(SceneId.CREDITS, (gs) => new CreditsScene(gs));
