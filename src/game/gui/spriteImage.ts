// A plain image component (port of the reference gui/spriteimage.c). It has no size hints of its own and is drawn
// at its position regardless of its laid out size.
import { video } from '../../video/draw';
import type { Surface } from '../../video/surface';
import { Component } from './widgets';

export class SpriteImage extends Component {
  /** Kept for API parity (spriteimage_set_owns_sprite); memory is garbage collected here. */
  ownsSprite = false;

  constructor(public img: Surface | null) {
    super();
    this.disabled = true;
    this.supportsDisable = true;
    this.supportsSelect = false;
  }

  setOwnsSprite(owns: boolean): void {
    this.ownsSprite = owns;
  }

  override render(): void {
    if (this.img) video.draw(this.img, this.x, this.y);
  }
}
