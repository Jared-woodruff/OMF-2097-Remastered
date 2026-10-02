// Pilot photo component (port of the reference gui/portrait.c). Photos come from PLAYERS.PIC.
import type { Palette } from '../../formats/palette';
import type { Sprite } from '../../formats/sprite';
import { loadPic } from '../../resources/resources';
import { video } from '../../video/draw';
import { Surface } from '../../video/surface';
import { Component } from './widgets';

const PLAYERS_PIC = 'PLAYERS.PIC';

// Photo sprites are immutable: convert each one to a surface only once (the reference creates a new surface every
// time a portrait is set, which would only churn the renderer's texture atlas here).
const surfaceCache = new WeakMap<Sprite, Surface>();

/** sprite_create(): a drawable surface for a photo sprite (null for a missing sprite). */
export function photoSurface(spr: Sprite | null, key = 'photo'): Surface | null {
  if (!spr) return null;
  let s = surfaceCache.get(spr);
  if (!s) {
    s = Surface.fromSprite(spr);
    s.source = { kind: 'photo', key };
    surfaceCache.set(spr, s);
  }
  return s;
}

/**
 * portrait_load(): a copy of photo `pilotId` of PLAYERS.PIC, whose 48 palette colors are copied into `pal`.
 * (The reference fills an existing sprite in place; here the copy is returned.) Null if the photo does not exist.
 */
export function portraitLoad(pal: Palette, pilotId: number): Sprite | null {
  let pics;
  try {
    pics = loadPic(PLAYERS_PIC);
  } catch (e) {
    console.error(`Could not load PIC file ${PLAYERS_PIC}`, e);
    return null;
  }
  const photo = pics[pilotId];
  if (!photo) return null;
  pal.copyRange(photo.palette, 0, 48);
  return photo.sprite.clone();
}

export class Portrait extends Component {
  img: Surface | null = null;
  max = 0;
  selectedId = 0;

  /** portrait_create() */
  constructor(pilotId: number) {
    super();
    this.supportsDisable = false;
    this.supportsSelect = false;
    this.select(pilotId);
  }

  override render(): void {
    if (this.img) video.draw(this.img, this.x, this.y);
  }

  /** portrait_select(): shows photo `pilotId` of PLAYERS.PIC. */
  select(pilotId: number): void {
    let spr: Sprite | null = null;
    try {
      spr = loadPic(PLAYERS_PIC)[pilotId]?.sprite ?? null;
    } catch (e) {
      console.error(`Could not load PIC file ${PLAYERS_PIC}`, e);
    }
    this.img = photoSurface(spr, `${PLAYERS_PIC}/${pilotId}`);
    // Position and size hints for the gui component (set on the layout call)
    this.setSizeHints(this.img ? this.img.w : 0, this.img ? this.img.h : 0);
    this.selectedId = pilotId;
    this.max = 4; // (reference TODO: the number of photos)
  }

  /** portrait_next() */
  next(): void {
    let select = this.selectedId + 1;
    if (select >= this.max) select = 0;
    this.select(select);
  }

  /** portrait_prev() */
  prev(): void {
    let select = this.selectedId - 1;
    if (select < 0) select = this.max - 1;
    this.select(select);
  }

  /** portrait_selected() */
  getSelected(): number {
    return this.selectedId;
  }

  /** portrait_set_from_sprite() */
  setFromSprite(spr: Sprite | null): void {
    this.img = photoSurface(spr);
    this.setSizeHints(this.img ? this.img.w : 0, this.img ? this.img.h : 0);
  }
}
