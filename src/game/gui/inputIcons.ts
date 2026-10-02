// Direction arrows and a neutral dot for the move list and the training input display (the original fonts have no
// arrows). They are drawn like font glyphs (ink index 1), so they take any palette color and get the remastered text
// rendering. Directions use numpad notation: 6 is forward, 8 up, 5 neutral.
import { Surface } from '../../video/surface';
import { drawGlyph } from './text';

export const ICON_SIZE = 7;

const RIGHT = [
  '...#...',
  '...##..',
  '######.',
  '#######',
  '######.',
  '...##..',
  '...#...',
];
const UP_RIGHT = [
  '...####',
  '....###',
  '...####',
  '..###.#',
  '.###...',
  '###....',
  '.#.....',
];
const NEUTRAL = [
  '.......',
  '.......',
  '..###..',
  '..###..',
  '..###..',
  '.......',
  '.......',
];

type Grid = string[];
const mirrorX = (g: Grid): Grid => g.map((r) => [...r].reverse().join(''));
const mirrorY = (g: Grid): Grid => [...g].reverse();
/** Quarter turn counterclockwise. */
const turnLeft = (g: Grid): Grid => g.map((_, r) => g.map((row) => row[g.length - 1 - r]).join(''));

const GRIDS: Record<string, Grid> = {
  '6': RIGHT,
  '4': mirrorX(RIGHT),
  '8': turnLeft(RIGHT),
  '2': mirrorY(turnLeft(RIGHT)),
  '9': UP_RIGHT,
  '7': mirrorX(UP_RIGHT),
  '3': mirrorY(UP_RIGHT),
  '1': mirrorX(mirrorY(UP_RIGHT)),
  '5': NEUTRAL,
};

const icons = new Map<string, Surface>();

/** The icon of a direction ('1'..'9'). */
export function dirIcon(dir: string): Surface | null {
  let s = icons.get(dir);
  if (!s) {
    const g = GRIDS[dir];
    if (!g) return null;
    const data = new Uint8Array(ICON_SIZE * ICON_SIZE);
    g.forEach((row, y) => [...row].forEach((ch, x) => (data[y * ICON_SIZE + x] = ch === '#' ? 1 : 0)));
    s = new Surface(ICON_SIZE, ICON_SIZE, data, 0);
    s.source = { kind: 'font', key: `icon/dir${dir}` };
    icons.set(dir, s);
  }
  return s;
}

/** Draws a direction icon in a palette color, with an optional one pixel shadow (bottom right). */
export function drawDir(dir: string, x: number, y: number, color: number, shadow = -1): void {
  const s = dirIcon(dir);
  if (!s) return;
  if (shadow >= 0) drawGlyph(s, x + 1, y + 1, shadow);
  drawGlyph(s, x, y, color);
}
