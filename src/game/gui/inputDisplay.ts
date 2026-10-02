// Training input display: the player's recent inputs, most recent first, as the robot receives them (directions
// relative to its facing, like the move list), with punch and kick presses and how many game ticks each lasted.
import { ACT_DOWN, ACT_KICK, ACT_LEFT, ACT_PUNCH, ACT_RIGHT, ACT_UP } from '../constants';
import { drawDir } from './inputIcons';
import { FontSize, GLYPH_SHADOW_BOTTOM, GLYPH_SHADOW_RIGHT, HAlign, Text } from './text';

const ROWS = 11;
const ROW_H = 8;
const COLOR_TICKS = 0xda;
const COLOR_ARROW = 0xdf;
const COLOR_NEUTRAL = 0xd6;
const COLOR_SHADOW = 0xd1;
const COLOR_PUNCH = 0xf2;
const COLOR_KICK = 0xe7;

const MIRROR: Record<string, string> = { '1': '3', '3': '1', '4': '6', '6': '4', '7': '9', '9': '7' };

interface Row {
  dir: string;
  buttons: string;
  ticks: number;
}

/** Numpad direction of an action (6 = right). */
export function actionDir(action: number): string {
  const h = action & ACT_LEFT ? -1 : action & ACT_RIGHT ? 1 : 0;
  const v = action & ACT_UP ? 1 : action & ACT_DOWN ? -1 : 0;
  return String(5 + h + 3 * v);
}

export class InputDisplay {
  readonly rows: Row[] = [];
  private texts = new Map<string, Text>();

  /**
   * Records one game tick of a player's actions (none when the controller's input delay holds them back). Facing left,
   * directions are mirrored so that 6 is always forward.
   */
  record(actions: number[], facingLeft: boolean): void {
    const top = this.rows[0];
    if (actions.length === 0) {
      if (top && top.ticks < 99) top.ticks++;
      return;
    }
    let dir = actionDir(actions[actions.length - 1]);
    if (facingLeft) dir = MIRROR[dir] ?? dir;
    let buttons = '';
    if (actions.some((a) => a & ACT_PUNCH)) buttons += 'P';
    if (actions.some((a) => a & ACT_KICK)) buttons += 'K';
    if (!top || top.dir !== dir || buttons) {
      this.rows.unshift({ dir, buttons, ticks: 1 });
      if (this.rows.length > ROWS) this.rows.length = ROWS;
    } else if (top.ticks < 99) {
      top.ticks++;
    }
  }

  clear(): void {
    this.rows.length = 0;
  }

  private text(s: string, font: FontSize, color: number, w = 0xffff): Text {
    const key = `${s}/${font}/${color}`;
    let t = this.texts.get(key);
    if (!t) {
      t = new Text(font, w, 0xffff, s).setColor(color).setShadowColor(COLOR_SHADOW).setShadow(GLYPH_SHADOW_RIGHT | GLYPH_SHADOW_BOTTOM)
        .setWordWrap(false);
      if (w !== 0xffff) t.setHAlign(HAlign.RIGHT);
      this.texts.set(key, t);
    }
    return t;
  }

  render(x: number, y: number): void {
    this.rows.forEach((r, i) => {
      const ry = y + i * ROW_H;
      this.text(String(r.ticks), FontSize.SMALL, COLOR_TICKS, 12).draw(x, ry + 1);
      drawDir(r.dir, x + 15, ry, r.dir === '5' ? COLOR_NEUTRAL : COLOR_ARROW, COLOR_SHADOW);
      let bx = x + 24;
      for (const b of r.buttons) {
        this.text(b, FontSize.BIG, b === 'P' ? COLOR_PUNCH : COLOR_KICK).draw(bx, ry);
        bx += 9;
      }
    });
  }
}
