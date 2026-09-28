// Cosmetic effect events from the fight logic (hits, blocks, impacts, knockouts) for the remastered effects and
// gamepad rumble. Listeners only observe: they must not change game state or draw from the game's random generators,
// so the simulation stays exactly the original's whether effects are on or off.

export const enum FxType {
  /** A HAR was hit by the other HAR. */
  HIT = 1,
  /** A hit (HAR or projectile) was blocked. */
  BLOCK,
  /** A HAR was hit by a projectile. */
  PROJECTILE_HIT,
  /** A HAR was hit by an arena hazard. */
  HAZARD_HIT,
  /** A HAR was slammed into a wall. */
  WALL_SLAM,
  /** A HAR landed hard on the floor (knockdowns, falls). */
  LANDING,
  /** The hit that ended a round. */
  KO,
}

export interface FxEvent {
  type: FxType;
  /** Native (320x200) position of the impact. */
  x: number;
  y: number;
  /** Impact strength: the move's base damage (0..~60), or a comparable value. */
  power: number;
  /** Direction the impact travels (1 = right, -1 = left, 0 = none). */
  dir: number;
  /** Player whose HAR received the impact (0 or 1), -1 when unknown. */
  playerId: number;
  /** Scene the event happened in (arena id for effects tuned per arena). */
  sceneId: number;
}

type FxListener = (e: FxEvent) => void;
let listeners: FxListener[] = [];

/** Subscribes to effect events; returns the unsubscribe function. */
export function onFx(fn: FxListener): () => void {
  listeners.push(fn);
  return () => {
    listeners = listeners.filter((l) => l !== fn);
  };
}

let muted = false;

/** Stops effect events (a replay jumping to a moment runs the fight without effects). */
export function setFxMuted(m: boolean): void {
  muted = m;
}

export function emitFx(type: FxType, x: number, y: number, power: number, dir: number, playerId: number, sceneId: number): void {
  if (listeners.length === 0 || muted) return;
  const e: FxEvent = { type, x, y, power, dir, playerId, sceneId };
  for (const l of listeners) {
    try {
      l(e);
    } catch (err) {
      console.error('[fx] listener failed:', err);
    }
  }
}
