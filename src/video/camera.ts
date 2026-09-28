// The fight camera (GAMEPLAY > NEW CONTENT > FIGHT CAMERA; remastered graphics): the view comes closer when the robots
// are close and follows them, keeping the floor at the bottom and their heads in view (jumps pull it back out). The
// HUD is not affected. It eases in and out smoothly and stays out before and after the fight.
import { ARENA_FLOOR } from '../game/constants';
import type { GameState } from '../game/gameState';
import { ARENA_STATE_FIGHTING } from '../game/objects/har';

/** The closest view, and the distance between the robots from which it starts to come closer. */
const MAX_ZOOM = 1.22;
const NEAR = 60;
const FAR = 190;
/** How much room above a robot's feet stays in view (its height and some air). */
const HEADROOM = 118;

export class FightCamera {
  zoom = 1;
  x = 160;
  y = 100;
  private last = 0;

  /** Per frame: the camera for this frame (zoom 1 when off or not fighting). */
  update(gs: GameState, now: number, enabled: boolean): { zoom: number; x: number; y: number } {
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0;
    this.last = now;
    let zoom = 1;
    let x = 160;
    const sc = gs.sc as { arenaGetState?: () => number; menuVisible?: boolean };
    if (enabled && gs.sc.isArena() && !gs.hideUi) {
      const a = gs.findObject(gs.getPlayer(0).harObjId);
      const b = gs.findObject(gs.getPlayer(1).harObjId);
      if (a && b && sc.arenaGetState?.() === ARENA_STATE_FIGHTING) {
        const dist = Math.abs(a.posX - b.posX);
        const t = Math.max(0, Math.min(1, (FAR - dist) / (FAR - NEAR)));
        zoom = 1 + (MAX_ZOOM - 1) * t * t * (3 - 2 * t);
        // Heads stay in view: the view's top edge (the floor stays at the bottom) above the highest robot's head.
        const top = Math.min(a.posY, b.posY, ARENA_FLOOR) - HEADROOM;
        const visible = 200 - Math.max(0, top);
        zoom = Math.max(1, Math.min(zoom, 200 / Math.max(1, visible)));
        x = (a.posX + b.posX) / 2;
      }
    }
    // Ease towards it (about a third of a second).
    const k = dt > 0 ? 1 - Math.exp(-dt * 3.2) : 1;
    this.zoom += (zoom - this.zoom) * k;
    this.x += (x - this.x) * k;
    // The floor stays at the bottom of the view.
    this.y = 200 - 100 / this.zoom;
    return { zoom: this.zoom, x: this.x, y: this.y };
  }
}
