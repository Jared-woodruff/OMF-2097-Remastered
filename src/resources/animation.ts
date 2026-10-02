import type { AnimationData } from '../formats/animation';
import { Surface } from '../video/surface';

export interface CollisionCoordR {
  x: number;
  y: number;
  frameIndex: number;
}

/** A positioned sprite frame of an animation. `surface` may be shared between animations. */
export class RSprite {
  constructor(
    public id: number,
    public posX: number,
    public posY: number,
    public surface: Surface | null,
  ) {}

  width(): number {
    return this.surface ? this.surface.w : 0;
  }

  height(): number {
    return this.surface ? this.surface.h : 0;
  }

  copy(): RSprite {
    return new RSprite(this.id, this.posX, this.posY, this.surface ? this.surface.clone() : null);
  }
}

/** Runtime animation: frames, hit coordinates and the (mutable per-scene) animation string. */
export class Animation {
  id: number;
  startX: number;
  startY: number;
  collisionCoords: CollisionCoordR[];
  animationString: string;
  extraStrings: string[];
  sprites: RSprite[];

  constructor(id: number, startX = 0, startY = 0) {
    this.id = id;
    this.startX = startX;
    this.startY = startY;
    this.collisionCoords = [];
    this.animationString = '';
    this.extraStrings = [];
    this.sprites = [];
  }

  getSprite(i: number): RSprite | null {
    return i >= 0 && i < this.sprites.length ? this.sprites[i] : null;
  }

  spriteCount(): number {
    return this.sprites.length;
  }

  fixupCoordinates(fx: number, fy: number): void {
    for (const s of this.sprites) {
      s.posX += fx;
      s.posY += fy;
    }
    for (const c of this.collisionCoords) {
      c.x += fx;
      c.y += fy;
    }
  }

  static fromSingle(sprite: RSprite, x: number, y: number): Animation {
    const a = new Animation(-1, x, y);
    a.animationString = 'A9999999999';
    a.sprites.push(sprite);
    return a;
  }
}

/**
 * Builds a runtime animation from file data. `shared` maps sprite index -> surface for resolving
 * "missing" sprites (they reuse the image of an earlier sprite with the same index in the same file).
 */
export function createAnimation(
  src: AnimationData,
  id: number,
  shared: Map<number, Surface | null>,
  sourceKey: string,
): Animation {
  const a = new Animation(id, src.startX, src.startY);
  a.animationString = src.animString;
  a.extraStrings = src.extraStrings.slice();
  a.collisionCoords = src.coords.map((c) => ({ x: c.x, y: c.y, frameIndex: c.frameId }));
  src.sprites.forEach((s, i) => {
    if (s.missing) {
      a.sprites.push(new RSprite(i, s.posX, s.posY, shared.get(s.index) ?? null));
      return;
    }
    let surf: Surface | null = null;
    if (s.width > 0 && s.height > 0) {
      // Empty sprites become a single transparent pixel (their stored size is garbage).
      // Pixels are copied: scenes may edit a loaded sprite (e.g. grayscale previews) without affecting later loads.
      surf = s.isEmpty() ? new Surface(1, 1, undefined, 0) : new Surface(s.width, s.height, s.pixels().slice(), 0);
      surf.source = { kind: 'sprite', key: `${sourceKey}/${id}/${i}` };
    }
    if (s.index) shared.set(s.index, surf);
    a.sprites.push(new RSprite(i, s.posX, s.posY, surf));
  });
  return a;
}
