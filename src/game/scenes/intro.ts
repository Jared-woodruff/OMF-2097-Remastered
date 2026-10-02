// Intro: the INTRO.BK sequence (logo, robots, title). Everything is driven by BK animation 25 (which spawns the
// other animations and triggers sounds, palette fades and the menu music); any key skips to the main menu.
// Port of the reference intro scene.
import type { CtrlEvent } from '../../controller/controller';
import { ACT_ESC, ACT_KICK, ACT_PUNCH, RENDER_LAYER_TOP, SceneId } from '../constants';
import { registerScene, type GameState } from '../gameState';
import { Scene } from '../scene';

/** The sequence is 2520 ticks long; the reference cuts to the menu slightly before the end. */
const INTRO_TICKS = 2500;

export class IntroScene extends Scene {
  ticks = 0;

  constructor(gs: GameState) {
    super(gs, SceneId.INTRO);
  }

  override startup(id: number): [boolean, boolean] {
    switch (id) {
      case 25:
        return [true, false];
    }
    return [false, false];
  }

  override prioOverride(id: number): number {
    switch (id) {
      case 25:
        return RENDER_LAYER_TOP;
    }
    return -1;
  }

  override dynamicTick(_paused: boolean): void {
    this.ticks++;
    if (this.ticks > INTRO_TICKS) this.gs.setNext(SceneId.MENU);
  }

  override inputPoll(): void {
    const ev: CtrlEvent[] = [];
    this.gs.menuPoll(ev);
    for (const e of ev) {
      if (e.type !== 'action') continue;
      if (e.action === ACT_ESC || e.action === ACT_KICK || e.action === ACT_PUNCH) this.gs.setNext(SceneId.MENU);
    }
  }
}

registerScene(SceneId.INTRO, (gs) => new IntroScene(gs));
