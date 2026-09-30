// What would keep a project from playing well, for OMF Studio's checks: errors keep the game from loading the mod
// (the same rules the game applies, mods/package.ts), warnings are things the game makes up for.
import { encodeSprite } from '../formats/sprite';
import { CONTENT_ID_PATTERN, ID_PATTERN, PICTURE_MOVES, REQUIRED_MOVES } from '../mods/types';
import { parseAnim } from './anim';
import type { Project } from './project';

export type Target = { kind: 'mod' } | { kind: 'robot' | 'arena' | 'pilot'; index: number; move?: number };

export interface Problem {
  level: 'error' | 'warning';
  text: string;
  target: Target;
}

export const MOVE_LABELS: Record<number, string> = {
  1: 'Jump', 2: 'Stand up', 3: 'Stunned', 4: 'Crouch', 5: 'Block', 6: 'Crouching block', 7: 'Burning oil', 8: 'Block scrape',
  9: 'Damage', 10: 'Walk', 11: 'Idle', 12: 'Scrap metal', 13: 'Bolt', 14: 'Screw', 48: 'Victory', 49: 'Defeat',
  55: 'Blast 1', 56: 'Blast 2', 57: 'Blast 3', 60: 'Select picture', 61: 'VS picture',
};

/** The largest sprite a fighter file can hold (its encoded length is 16 bits). */
const MAX_SPRITE_BYTES = 65535;

export function projectProblems(p: Project): Problem[] {
  const out: Problem[] = [];
  const mod = { kind: 'mod' } as const;
  if (!ID_PATTERN.test(p.manifest.id)) out.push({ level: 'error', text: 'The mod\'s id may only have lower case letters, digits, ".", "-" and "_".', target: mod });
  if (!p.manifest.name.trim()) out.push({ level: 'error', text: 'The mod has no name.', target: mod });
  if (!p.robots.length && !p.arenas.length && !p.pilots.length) out.push({ level: 'error', text: 'The mod has no robots, arenas or pilots yet.', target: mod });
  if (!p.manifest.author.trim()) out.push({ level: 'warning', text: 'The mod names no author.', target: mod });
  const ids = (list: { id: string }[], what: string, kind: 'robot' | 'arena' | 'pilot') => {
    list.forEach((x, index) => {
      if (!CONTENT_ID_PATTERN.test(x.id)) out.push({ level: 'error', text: `A ${what}'s folder name "${x.id}" is not valid.`, target: { kind, index } });
      if (list.findIndex((y) => y.id === x.id) !== index) out.push({ level: 'error', text: `Two ${what}s share the folder name "${x.id}".`, target: { kind, index } });
    });
  };
  ids(p.robots, 'robot', 'robot');
  ids(p.arenas, 'arena', 'arena');
  ids(p.pilots, 'pilot', 'pilot');

  p.robots.forEach((r, index) => {
    const name = r.info.name || 'A robot';
    const target = (move?: number): Target => ({ kind: 'robot', index, move });
    for (const id of REQUIRED_MOVES) {
      if (!r.af.moves[id]) out.push({ level: 'error', text: `${name} has no ${MOVE_LABELS[id].toLowerCase()} animation (move ${id}).`, target: target(id) });
    }
    if (!r.af.health || !r.af.endurance) out.push({ level: 'error', text: `${name} has no health or endurance.`, target: target() });
    for (const id of [PICTURE_MOVES.cell, PICTURE_MOVES.vs]) {
      if (!r.af.moves[id]?.animation.sprites.some((s) => !s.isEmpty())) {
        out.push({ level: 'warning', text: `${name} has no ${MOVE_LABELS[id].toLowerCase()}: the game makes one from its idle animation.`, target: target(id) });
      }
    }
    r.af.moves.forEach((m, id) => {
      if (!m) return;
      const t = parseAnim(m.animation.animString);
      const max = m.animation.sprites.length;
      if (t.frames.some((f) => f.sprite >= max)) {
        out.push({ level: 'error', text: `${name}, move ${id}: a frame shows a sprite the move does not have.`, target: target(id) });
      }
      if (!t.frames.length) out.push({ level: 'error', text: `${name}, move ${id}: its animation has no frames.`, target: target(id) });
      if (m.animation.animString.length >= 1024) out.push({ level: 'error', text: `${name}, move ${id}: its animation string is longer than 1023 characters.`, target: target(id) });
      if (m.animation.sprites.length > 255) out.push({ level: 'error', text: `${name}, move ${id}: more than 255 sprites.`, target: target(id) });
      for (const s of m.animation.sprites) {
        if (!s.missing && s.data && s.data.length > MAX_SPRITE_BYTES) {
          out.push({ level: 'error', text: `${name}, move ${id}: a sprite is too big to store (make it smaller).`, target: target(id) });
        }
      }
      if (id >= 15 && id !== 60 && id !== 61 && m.moveString && !/^[PK][1-9]*$|^[!0n]/.test(m.moveString)) {
        out.push({ level: 'warning', text: `${name}, move ${id}: its input "${m.moveString}" is not one the game reads.`, target: target(id) });
      }
    });
    if (!Object.keys(r.info.moves).length) out.push({ level: 'warning', text: `${name}'s special moves have no names (the move list shows their kind).`, target: target() });
  });

  p.pilots.forEach((pl, index) => {
    if (!pl.portrait) out.push({ level: 'warning', text: `${pl.info.name || 'A pilot'} has no portrait.`, target: { kind: 'pilot', index } });
  });
  return out;
}

/** Whether a sprite's pixels fit a fighter file (for the pixel editor). */
export function spriteFits(pixels: Uint8Array, w: number, h: number): boolean {
  return encodeSprite(pixels, w, h).length <= MAX_SPRITE_BYTES;
}
