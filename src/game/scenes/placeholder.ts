// Placeholder for scenes that are not implemented yet: shows the scene background; any key returns to the menu.
import type { CtrlEvent } from '../../controller/controller';
import { ACT_STOP, SceneId } from '../constants';
import { hasScene, registerScene } from '../gameState';
import { Scene } from '../scene';

export function registerPlaceholders(): void {
  for (let id = SceneId.INTRO; id <= SceneId.SCOREBOARD; id++) {
    if (hasScene(id) || id === SceneId.OPENOMF || id === SceneId.TRN_CUTSCENE) continue;
    const sid = id;
    registerScene(sid, (gs) => {
      const sc = new Scene(gs, sid);
      sc.inputPoll = () => {
        const ev: CtrlEvent[] = [];
        gs.menuPoll(ev);
        if (ev.some((e) => e.type === 'action' && e.action !== ACT_STOP)) gs.setNext(sid === SceneId.MENU ? SceneId.ARENA0 : SceneId.MENU);
      };
      return sc;
    });
  }
}
