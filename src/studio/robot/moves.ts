// What OMF Studio knows about a robot's moves: the engine's reserved animations, the move categories, inputs as the
// player enters them, the victim's reactions the game's robots use, and the tags of animation strings.
import type { AfMoveData } from '../../formats/af';
import { REACT } from '../../gen/fighter/moveset';
import { MOVE_LABELS } from '../checks';

export const CATEGORIES: [number, string][] = [
  [0, 'Basic / other'], [2, 'Throw (close)'], [4, 'Low'], [5, 'Medium'], [6, 'High'], [7, 'Jumping'], [8, 'Projectile'],
  [9, 'Engine animation'], [11, 'Victory'], [12, 'Scrap (finisher)'], [13, 'Destruction (finisher)'],
];

/** Moves every robot shares (effects): the game uses the original game's when a robot has none of its own. */
export const SHARED_MOVES = [7, 8, 12, 13, 14, 55, 56, 57];

/** A move slot's name in the lists. */
export function moveLabel(id: number, m: AfMoveData | null): string {
  if (MOVE_LABELS[id]) return MOVE_LABELS[id];
  if (!m) return 'Empty';
  const cat = CATEGORIES.find(([c]) => c === m.category)?.[1] ?? `Category ${m.category}`;
  const input = inputText(m.moveString);
  return input ? `${cat} · ${input}` : cat;
}

const ARROWS: Record<string, string> = { '1': '↙', '2': '↓', '3': '↘', '4': '←', '5': '·', '6': '→', '7': '↖', '8': '↑', '9': '↗' };

/** A move string as the player enters it, facing right ("↓ ↘ → P"); '' for moves no input starts. */
export function inputText(moveString: string): string {
  if (!/^[PK][1-9]*$/.test(moveString)) return '';
  const dirs = [...moveString.slice(1)].reverse().map((d) => ARROWS[d]);
  return [...dirs, moveString[0] === 'P' ? 'Punch' : 'Kick'].join(' ');
}

/** The input builder's directions (numpad digits, facing right). */
export const DIRECTIONS: [string, string][] = [['7', ARROWS['7']], ['8', ARROWS['8']], ['9', ARROWS['9']], ['4', ARROWS['4']], ['5', '·'],
  ['6', ARROWS['6']], ['1', ARROWS['1']], ['2', ARROWS['2']], ['3', ARROWS['3']]];

/** The victim's reactions of the game's own robots (the footer string of a move: how the robot it hits reels). */
export const REACTIONS: [string, string][] = [
  ['High, light', REACT.highLight], ['High, medium', REACT.highMedium], ['High, heavy', REACT.highHeavy],
  ['Middle, light', REACT.midLight], ['Middle, medium', REACT.midMedium], ['Low, light', REACT.lowLight],
  ['Low, medium', REACT.lowMedium], ['In the air', REACT.air], ['Projectile', REACT.projectile],
  ['Knocked down', REACT.knockdown], ['Launched up', REACT.launch], ['Swept off the feet', REACT.sweep],
];

/** What the extra string selector picks (the animation's variant by the robot's upgrades). */
export const EXTRA_SELECTORS: [number, string][] = [[0, 'None'], [1, 'Arm speed'], [2, 'Leg speed'], [3, 'Special (arm)'], [4, 'Special (leg)'], [5, 'Special']];

/** What the tags of animation strings do, as far as they are known. */
export const TAG_HELP: Record<string, string> = {
  s: 'Play entry n of the sound table', l: 'Sound volume', sf: 'Sound pitch', sb: 'Sound pan', sp: 'Sound priority',
  sd: 'Do not repeat the sound', se: 'Sound pan end', sl: 'Sound pan start', sc: 'Sound channel', sa: 'Sound follows the robot',
  smo: 'Play music n', smf: 'Stop the music',
  q: 'This frame can hit', n: 'No collision with the other robot', cp: 'Pause the fight on a hit', bn: 'Cannot be blocked',
  i: 'Interrupted when blocked', ai: 'A hit launches the victim', af: 'Freeze the victim (stasis)', k: 'Extra damage (percent + 10)',
  zz: 'Invulnerable', zp: 'Invulnerable to projectiles', zj: 'Invulnerable to jumping attacks', zg: 'Invulnerable (ground)', zh: 'Invulnerable (high)',
  zl: 'Invulnerable (low)', zm: 'Invulnerable (middle)',
  jl: 'Low attacks may follow', jm: 'Middle attacks may follow', jh: 'High attacks may follow', jz: 'Any attack may follow',
  jj: 'Jumping attacks may follow', jg: 'Chain window', jf: 'Finisher window', jf2: 'Finisher window (2)', jn: 'Move n may follow', jp: 'Chain window (projectile)',
  bj: 'Jump to animation n', d: 'Go back to tick n', be: 'End of the round (finishers)',
  'x+': 'Move right by n (with v: speed)', 'x-': 'Move left by n (with v: speed)', 'x=': 'Set x', 'y+': 'Move down by n', 'y-': 'Move up by n', 'y=': 'Set y',
  x: 'Width scale (percent)', y: 'Height scale (percent)', v: 'x+ / y+ set a speed', cx: 'Horizontal control', cy: 'Vertical control',
  h: 'Stop moving', g: 'Snap to the ground', e: 'Move to the enemy', ab: 'Pass through walls', ax: 'Fall through the floor', un: 'No corner push',
  at: 'Teleport behind the enemy', ar: 'Turn around', ac: 'Face the arena\'s middle', ad: 'Turn toward the held direction',
  m: 'Spawn animation n', mx: 'Spawned animation\'s x', my: 'Spawned animation\'s y', mrx: 'Spawn x (random)', mry: 'Spawn y (random)',
  mm: 'Spawn: moves with', mi: 'Spawn instances', mg: 'Spawn gravity', mp: 'Spawn flags', md: 'Remove animation n',
  r: 'Mirror left to right', f: 'Mirror top to bottom', u: 'Draw in front', w: 'Draw behind', ub: 'Motion trail', br: 'Glow', bg: 'Additive',
  bt: 'Dark tint', by: 'No shadow', bo: 'Shadow correction', bb: 'Shake the screen up and down', bl: 'Shake the screen sideways',
  bs: 'Blend from', bf: 'Blend to', bpd: 'Palette: reference', bps: 'Palette: first entry', bpn: 'Palette: entries', bpp: 'Palette: levels',
  bpb: 'Palette: start level', bpf: 'Palette: the fighter\'s', bz: 'Tint', ox: 'Sprite x correction', oy: 'Sprite y correction',
  t: 'Only while the enemy is hit or blocks', aa: 'Reset the air attack', as: 'Wander about (the Fire Pit\'s orb)',
};

/** Tags for the "add a tag" list: the given ones first, then the documented ones. */
export function tagChoices(allNames: string[], first: string[] = []): string[] {
  const head = first.filter((n) => allNames.includes(n));
  const rest = allNames.filter((n) => !head.includes(n));
  return [...head, ...rest.filter((n) => TAG_HELP[n]), ...rest.filter((n) => !TAG_HELP[n])];
}
