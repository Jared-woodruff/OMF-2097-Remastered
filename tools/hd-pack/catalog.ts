// HD asset pack: enumerates every visual asset of the original game, deduplicates identical images and
// classifies them into generation jobs (backgrounds, portraits, scene animations, fighters, shared effects).
import fs from 'node:fs';
import path from 'node:path';
import { parseAF } from '../../src/formats/af';
import type { AnimationData } from '../../src/formats/animation';
import { parseBK, type BkFile } from '../../src/formats/bk';
import { parseAltPals, parsePic } from '../../src/formats/misc';
import { Palette } from '../../src/formats/palette';

/** Remastered resolution relative to the native 320x200 grid: 5x wide, 6x tall = square pixels at 4:3. */
export const SCALE_X = 5;
export const SCALE_Y = 6;
/** Transparent margin added around sprite sources (native pixels) so upscalers have room at the edges. */
export const SPRITE_PAD = 4;
/** Native pixels shown on each side of the 320-wide playfield by the widescreen renderer. */
export const WIDE_EXT = 128;

export const HAR_NAMES = ['JAGUAR', 'SHADOW', 'THORN', 'PYROS', 'ELECTRA', 'KATANA', 'SHREDDER', 'FLAIL', 'GARGOYLE', 'CHRONOS', 'NOVA'];
/** The remaster's robots (HARs 11..14): their fighter files are made by `npm run gen` into public/gen. */
export const GEN_HAR_NAMES = ['GLACIER', 'TEMPEST', 'HELIX', 'SPECTRE'];
/** Every robot by HAR id. */
export const ALL_HAR_NAMES = [...HAR_NAMES, ...GEN_HAR_NAMES];

/** The robots' fighter files: the original ones, and the remaster's when they have been generated. */
export function fighterFiles(gameDir: string): { id: number; name: string; data: Uint8Array }[] {
  const genDir = path.resolve(gameDir, '..', 'gen');
  const out = HAR_NAMES.map((name, id) => ({ id, name, data: read(gameDir, `FIGHTR${id}.AF`) }));
  GEN_HAR_NAMES.forEach((name, i) => {
    const id = HAR_NAMES.length + i;
    const f = path.join(genDir, `FIGHTR${id}.AF`);
    if (fs.existsSync(f)) out.push({ id, name, data: new Uint8Array(fs.readFileSync(f)) });
  });
  return out;
}

/**
 * Player-color ramps used to render fighter sources (ALTPALS palette 0 ramp numbers). Fighters are recolored in
 * game, so their sources use three clearly different hues that intake can separate again.
 */
export const FIGHTER_RAMPS = { primary: 0, secondary: 1, tertiary: 13 } as const;

export type JobKind = 'background' | 'background-wide' | 'portrait' | 'scene' | 'fighter' | 'effect';

/**
 * How the game colors an image: 'none' = fixed colors; 'player' = palette entries 1..47 are the robot's three
 * 16-shade color ramps (recolored per player); 'player-expanded' = the same three ramps expanded to 32 shades at
 * entries 1..95 (tournament cutscenes).
 */
export type Recolor = 'none' | 'player' | 'player-expanded';

export interface Excluded {
  file: string;
  anim: number;
  /** Sprite index inside the animation, when only some frames are excluded. */
  sprite?: number;
  reason: string;
  /** For frames that are exact copies of the background: the region they copy (native pixels). */
  backgroundRegion?: { x: number; y: number; w: number; h: number };
}

export interface Usage {
  file: string;
  anim: number;
  sprite: number;
  /** Runtime surface key (see createAnimation / loadBk). */
  key: string;
}

export interface ImageItem {
  /** Stable id, also the folder/file stem inside the pack. */
  id: string;
  kind: JobKind;
  tier: 1 | 2 | 3;
  /** Pack-relative folder of the job. */
  dir: string;
  /** File stem of the source/output inside `dir` (source = `${stem}.png`, output = `${stem}.hd.png`). */
  stem: string;
  file: string;
  anim: number;
  frame: number;
  w: number;
  h: number;
  posX: number;
  posY: number;
  pixels: Uint8Array;
  /** Palette index rendered transparent, or -1 for opaque images. */
  transparent: number;
  palette: Uint8Array;
  paletteName: string;
  /** Some pixels use the player color ramps and are recolored in game (see `recolor`). */
  colorable: boolean;
  recolor: Recolor;
  hash: string;
  usages: Usage[];
  /**
   * Scene frames drawn over the scene background where they partly repeat it (e.g. the news anchor's blinking eyes):
   * the background region they cover (native pixels) and the fraction of their pixels equal to the background.
   */
  bgOverlay?: { x: number; y: number; w: number; h: number; match: number };
}

export interface AnimGroup {
  kind: JobKind;
  tier: 1 | 2 | 3;
  dir: string;
  file: string;
  anim: number;
  /** Human-readable name (for folders and prompts). */
  name: string;
  /** All frames in play order (items may live in another group's folder when shared). */
  frames: { item: ImageItem; posX: number; posY: number }[];
  /** Animation string (tags / timing), for reference. */
  animString: string;
}

export interface Catalog {
  items: ImageItem[];
  groups: AnimGroup[];
  backgrounds: { item: ImageItem; bk: BkFile; name: string }[];
  excluded: Excluded[];
}

function fnv(data: Uint8Array, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < data.length; i++) h = Math.imul(h ^ data[i], 0x01000193);
  return h >>> 0;
}

export function contentHash(w: number, h: number, pixels: Uint8Array, palette: Uint8Array, transparent: number): string {
  const head = new Uint8Array([w & 255, w >> 8, h & 255, h >> 8, transparent & 255]);
  const a = fnv(pixels, fnv(head, 0x811c9dc5));
  const b = fnv(palette, fnv(pixels, 0x9747b28c));
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

/** Hash of how an image looks (rendered colors + transparency), independent of the palette slots used. */
export function visualHash(w: number, h: number, pixels: Uint8Array, palette: Uint8Array, transparent: number): string {
  const rgb = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const c = pixels[i];
    if (c === transparent) continue;
    rgb[i * 4] = palette[c * 3];
    rgb[i * 4 + 1] = palette[c * 3 + 1];
    rgb[i * 4 + 2] = palette[c * 3 + 2];
    rgb[i * 4 + 3] = 1;
  }
  const head = new Uint8Array([w & 255, w >> 8, h & 255, h >> 8]);
  const a = fnv(rgb, fnv(head, 0x811c9dc5));
  const b = fnv(rgb, (0x9747b28c ^ w ^ (h << 16)) >>> 0);
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

/** Fraction of a sprite's opaque pixels that equal the background at the given position. */
function backgroundMatch(bg: Uint8Array, bw: number, bh: number, px: Uint8Array, w: number, h: number, ox: number, oy: number): number {
  let opaque = 0, match = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = px[y * w + x];
      if (!v) continue;
      opaque++;
      const bx = ox + x, by = oy + y;
      if (bx >= 0 && by >= 0 && bx < bw && by < bh && bg[by * bw + bx] === v) match++;
    }
  }
  return opaque ? match / opaque : 0;
}

function read(dir: string, f: string): Uint8Array {
  return new Uint8Array(fs.readFileSync(path.join(dir, f)));
}

/** Names of the fighters' moves with a fixed meaning (reference ANIM_* ids). */
const FIGHTER_ANIM_NAMES: Record<number, string> = {
  1: 'jump', 2: 'stand_up', 3: 'stunned', 4: 'crouch', 5: 'block', 6: 'crouch_block', 7: 'burning_oil',
  8: 'block_spark', 9: 'hit_reaction', 10: 'walk', 11: 'idle', 12: 'scrap_metal', 13: 'bolt', 14: 'screw',
  48: 'victory', 49: 'defeat', 55: 'blast_1', 56: 'blast_2', 57: 'blast_3',
};
const CATEGORY_NAMES: Record<number, string> = {
  0: 'misc', 2: 'close_attack', 4: 'low_attack', 5: 'medium_attack', 6: 'high_attack', 7: 'jump_attack',
  8: 'projectile', 9: 'basic', 10: 'hazard', 11: 'victory', 12: 'scrap_finisher', 13: 'destruction_finisher',
};

function safe(s: string): string {
  return s.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

export function fighterMoveName(id: number, category: number, moveString: string): string {
  if (FIGHTER_ANIM_NAMES[id]) return FIGHTER_ANIM_NAMES[id];
  const cat = CATEGORY_NAMES[category] ?? `category${category}`;
  const input = safe(moveString.trim());
  return input ? `${cat}_${input}` : cat;
}

/** Scene animations that are drawn as color effects (remap glows, index-add overlays) rather than as images. */
function effectOnly(anim: AnimationData): string | null {
  if (/(^|[-a-z])br/.test(anim.animString)) return 'glow effect mask (drawn through the remap tables, not as colors)';
  if (/(^|[-a-z])bg/.test(anim.animString)) return 'index-add overlay (credits text effect)';
  return null;
}

/** Scenes whose indices 1..47 show player 1's robot colors (16-shade ramps). */
const SCENES_PLAYER_RAMPS = new Set(['MELEE', 'VS', 'MECHLAB']);
/** Tournament cutscenes: player colors expanded to three 32-shade ramps at 1..95 (reference palette_set_player_expanded_color). */
const SCENES_EXPANDED_RAMPS = new Set(['NORTH_AM', 'KATUSHAI', 'WAR']);
/** Scene animations derived by the game from other images (not generated). */
const DERIVED_ANIMS: Record<string, string> = {
  'MELEE.BK:0': 'dimmed copy of the pilot portraits (MELEE a03) made with palette tricks; derived from the HD portraits on import',
};

function expandedRamps(ramps: Palette): Palette {
  const f = Math.fround;
  const out = new Palette();
  for (let j = 0; j < 3; j++) {
    for (let i = 0; i < 32; i++) {
      const position = f(f(i * 15.0) / 31.0);
      const lowerIndex = Math.trunc(position);
      const t = f(position - lowerIndex);
      const upperIndex = Math.min(lowerIndex + 1, 15);
      for (let k = 0; k < 3; k++) {
        const v = f(f(f(f(1.0 - t) * ramps.colors[(lowerIndex + j * 16) * 3 + k]) + f(t * ramps.colors[(upperIndex + j * 16) * 3 + k])) + 0.5);
        out.colors[(i + j * 32) * 3 + k] = Math.trunc(v) & 0xff;
      }
    }
  }
  return out;
}

function referenceFighterPalette(arena0: BkFile, altpal: Palette): Palette {
  const pal = arena0.palettes[0].clone();
  const load = (ramp: number, slot: number) => {
    const c0 = [pal.colors[0], pal.colors[1], pal.colors[2]];
    pal.copyFrom(altpal, ramp * 16, slot * 16, 16);
    pal.colors.set(c0, 0);
  };
  load(FIGHTER_RAMPS.tertiary, 0);
  load(FIGHTER_RAMPS.secondary, 1);
  load(FIGHTER_RAMPS.primary, 2);
  return pal;
}

export function buildCatalog(gameDir: string): Catalog {
  const items: ImageItem[] = [];
  const groups: AnimGroup[] = [];
  const backgrounds: Catalog['backgrounds'] = [];
  const excluded: Catalog['excluded'] = [];
  const files = fs.readdirSync(gameDir);
  const bkFiles = files.filter((f) => f.endsWith('.BK')).sort();
  const bks = new Map<string, BkFile>();
  for (const f of bkFiles) bks.set(f, parseBK(read(gameDir, f)));
  const altpal = parseAltPals(read(gameDir, 'ALTPALS.DAT'))[0];

  // ---- Backgrounds -------------------------------------------------------------------------------------------
  for (const f of bkFiles) {
    const bk = bks.get(f)!;
    const px = bk.background;
    let uniform = true;
    for (let i = 1; i < px.length; i++) if (px[i] !== px[0]) { uniform = false; break; }
    if (uniform) {
      excluded.push({ file: f, anim: -1, reason: 'background is a single flat color' });
      continue;
    }
    const scene = f.replace('.BK', '');
    const pal = bk.palettes[0].colors;
    const item: ImageItem = {
      id: `bg/${scene}`, kind: 'background', tier: 1, dir: `tier1_backgrounds/${scene}`, stem: 'source',
      file: f, anim: -1, frame: 0, w: bk.width, h: bk.height, posX: 0, posY: 0, pixels: px, transparent: -1,
      palette: pal, paletteName: `${f} palette 0`, colorable: false, recolor: 'none', hash: contentHash(bk.width, bk.height, px, pal, -1),
      usages: [{ file: f, anim: -1, sprite: 0, key: `${f}/bg` }],
    };
    items.push(item);
    backgrounds.push({ item, bk, name: scene });
  }

  // ---- Portraits (PIC files) ---------------------------------------------------------------------------------
  const mechlabPal = bks.get('MECHLAB.BK')!.palettes[0];
  const picSeen = new Map<string, ImageItem>();
  for (const f of files.filter((x) => x.endsWith('.PIC')).sort((a, b) => (a === 'PLAYERS.PIC' ? -1 : b === 'PLAYERS.PIC' ? 1 : a.localeCompare(b)))) {
    const photos = parsePic(read(gameDir, f));
    photos.forEach((p, i) => {
      if (p.sprite.isEmpty()) return;
      const pal = mechlabPal.clone();
      pal.copyRange(p.palette, 0, 48);
      const px = p.sprite.pixels();
      const hash = contentHash(p.sprite.width, p.sprite.height, px, pal.colors, 0);
      const usage: Usage = { file: f, anim: -1, sprite: i, key: `${f}/${i}` };
      const prev = picSeen.get(hash);
      if (prev) {
        prev.usages.push(usage);
        return;
      }
      const stemDir = `${f.replace('.PIC', '')}_${String(i).padStart(2, '0')}`;
      const item: ImageItem = {
        id: `portrait/${stemDir}`, kind: 'portrait', tier: 1, dir: `tier1_portraits/${stemDir}`, stem: 'source',
        file: f, anim: -1, frame: i, w: p.sprite.width, h: p.sprite.height, posX: p.sprite.posX, posY: p.sprite.posY,
        pixels: px, transparent: 0, palette: pal.colors, paletteName: `${f} photo palette + MECHLAB.BK palette 0`,
        colorable: false, recolor: 'none', hash, usages: [usage],
      };
      picSeen.set(hash, item);
      items.push(item);
    });
  }

  // ---- Scene animations (BK) ---------------------------------------------------------------------------------
  const refRamps = referenceFighterPalette(bks.get('ARENA0.BK')!, altpal);
  const scenePalette = (f: string): { pal: Uint8Array; name: string } => {
    const scene = f.replace('.BK', '');
    const pal = bks.get(f)!.palettes[0].clone();
    if (SCENES_PLAYER_RAMPS.has(scene)) {
      pal.copyFrom(refRamps, 1, 1, 47);
      return { pal: pal.colors, name: `${f} palette 0 + reference robot colors at 1..47` };
    }
    if (SCENES_EXPANDED_RAMPS.has(scene)) {
      pal.copyFrom(expandedRamps(refRamps), 1, 1, 95);
      return { pal: pal.colors, name: `${f} palette 0 + reference robot colors expanded to 32 shades at 1..95` };
    }
    return { pal: pal.colors, name: `${f} palette 0` };
  };
  // Images drawn identically by several scenes (e.g. the ROUND / FIGHT / YOU WIN graphics of every arena) are generated once.
  const sceneFiles = new Map<string, Set<string>>();
  for (const f of bkFiles) {
    const { pal } = scenePalette(f);
    bks.get(f)!.anims.forEach((a, animId) => {
      if (!a || effectOnly(a.animation) || DERIVED_ANIMS[`${f}:${animId}`]) return;
      a.animation.sprites.forEach((s) => {
        if (s.isEmpty()) return;
        const k = visualHash(s.width, s.height, s.pixels(), pal, 0);
        if (!sceneFiles.has(k)) sceneFiles.set(k, new Set());
        sceneFiles.get(k)!.add(f);
      });
    });
  }
  const sharedScene = new Map<string, ImageItem>();
  for (const f of bkFiles) {
    const bk = bks.get(f)!;
    const scene = f.replace('.BK', '');
    const isArena = scene.startsWith('ARENA');
    const sceneTier = isArena ? 2 : 3;
    const sceneRoot = isArena ? 'tier2_arenas' : 'tier3_scenes';
    const { pal, name: palName } = scenePalette(f);
    const bg = backgrounds.find((b) => b.bk === bk) ? bk.background : null;
    const seen = new Map<string, ImageItem>();
    bk.anims.forEach((a, animId) => {
      if (!a) return;
      const why = effectOnly(a.animation) ?? DERIVED_ANIMS[`${f}:${animId}`] ?? null;
      if (why) {
        excluded.push({ file: f, anim: animId, reason: why });
        return;
      }
      const name = `a${String(animId).padStart(2, '0')}`;
      const group: AnimGroup = {
        kind: 'scene', tier: sceneTier, dir: `${sceneRoot}/${scene}/${name}`, file: f, anim: animId, name,
        frames: [], animString: a.animation.animString,
      };
      a.animation.sprites.forEach((s, si) => {
        if (s.isEmpty()) return;
        const px = s.pixels();
        // Frames that repeat (part of) the scene background where they are drawn.
        const at = { x: a.animation.startX + s.posX, y: a.animation.startY + s.posY };
        const match = bg ? backgroundMatch(bg, bk.width, bk.height, px, s.width, s.height, at.x, at.y) : 0;
        if (match >= 0.999) {
          excluded.push({
            file: f, anim: animId, sprite: si,
            reason: 'exact copy of a background region (drawn again for layering): cut from the finished HD background on import',
            backgroundRegion: { x: at.x, y: at.y, w: s.width, h: s.height },
          });
          return;
        }
        const hash = visualHash(s.width, s.height, px, pal, 0);
        const usage: Usage = { file: f, anim: animId, sprite: si, key: `${f}/${animId}/${si}` };
        const files = sceneFiles.get(hash)!;
        const multiFile = files.size > 1;
        let item = multiFile ? sharedScene.get(hash) : seen.get(hash);
        if (item) {
          item.usages.push(usage);
        } else {
          const recolorMode: Recolor = SCENES_EXPANDED_RAMPS.has(scene) ? 'player-expanded' : SCENES_PLAYER_RAMPS.has(scene) ? 'player' : 'none';
          const limit = recolorMode === 'player-expanded' ? 96 : recolorMode === 'player' ? 48 : 1;
          let player = 0;
          for (const v of px) if (v && v < limit) player++;
          const stem = `f${String(si).padStart(3, '0')}`;
          // Shared by several scenes: generated once (with the arenas if any arena uses it).
          const anyArena = [...files].some((x) => x.startsWith('ARENA'));
          const sharedRoot = anyArena ? 'tier2_arenas' : 'tier3_scenes';
          const dir = multiFile ? `${sharedRoot}/_SHARED/${name}` : group.dir;
          item = {
            id: multiFile ? `scene/_SHARED/${name}/${stem}` : `scene/${scene}/${name}/${stem}`,
            kind: 'scene', tier: multiFile && anyArena ? 2 : sceneTier, dir, stem, file: f, anim: animId, frame: si,
            w: s.width, h: s.height, posX: s.posX, posY: s.posY, pixels: px, transparent: 0, palette: pal, paletteName: palName,
            colorable: player > 0, recolor: player > 0 ? recolorMode : 'none', hash, usages: [usage],
            bgOverlay: match > 0.5 ? { x: at.x, y: at.y, w: s.width, h: s.height, match } : undefined,
          };
          if (multiFile) sharedScene.set(hash, item);
          else seen.set(hash, item);
          items.push(item);
        }
        group.frames.push({ item, posX: s.posX, posY: s.posY });
      });
      if (group.frames.length) groups.push(group);
    });
  }

  // ---- Fighters (AF) + shared effects ------------------------------------------------------------------------
  const fighterPal = referenceFighterPalette(bks.get('ARENA0.BK')!, altpal);
  const pal = fighterPal.colors;
  // First pass: which images appear in more than one fighter file (debris, explosions, sparks...)?
  const perHash = new Map<string, Set<number>>();
  const fighters = fighterFiles(gameDir);
  const afs = fighters.map((f) => parseAF(f.data));
  afs.forEach((af, h) => af.moves.forEach((m) => m?.animation.sprites.forEach((s) => {
    if (s.isEmpty()) return;
    const k = contentHash(s.width, s.height, s.pixels(), pal, 0);
    if (!perHash.has(k)) perHash.set(k, new Set());
    perHash.get(k)!.add(h);
  })));
  const shared = new Map<string, ImageItem>();
  afs.forEach((af, k) => {
    const har = fighters[k].name;
    const f = `FIGHTR${fighters[k].id}.AF`;
    const seen = new Map<string, ImageItem>();
    af.moves.forEach((m, moveId) => {
      if (!m) return;
      const name = `m${String(moveId).padStart(2, '0')}_${fighterMoveName(moveId, m.category, m.moveString)}`;
      const isEffectAnim = [7, 8, 12, 13, 14, 55, 56, 57].includes(moveId);
      const group: AnimGroup = {
        kind: 'fighter', tier: 2, dir: `tier2_fighters/${har}/${name}`, file: f, anim: moveId, name, frames: [],
        animString: m.animation.animString,
      };
      m.animation.sprites.forEach((s, si) => {
        if (s.isEmpty()) return;
        const px = s.pixels();
        const hash = contentHash(s.width, s.height, px, pal, 0);
        const usage: Usage = { file: f, anim: moveId, sprite: si, key: `${f}/${moveId}/${si}` };
        const multiFile = (perHash.get(hash)?.size ?? 0) > 1;
        let item = multiFile ? shared.get(hash) : seen.get(hash);
        if (item) {
          item.usages.push(usage);
        } else {
          let player = 0;
          for (const v of px) if (v && v < 48) player++;
          const stem = `f${String(si).padStart(3, '0')}`;
          const effect = multiFile || isEffectAnim;
          const dir = multiFile ? `tier2_effects/${name}` : group.dir;
          item = {
            id: multiFile ? `effect/${name}/${stem}` : `fighter/${har}/${name}/${stem}`,
            kind: effect ? 'effect' : 'fighter', tier: 2, dir, stem, file: f, anim: moveId, frame: si, w: s.width, h: s.height,
            posX: s.posX, posY: s.posY, pixels: px, transparent: 0, palette: pal,
            paletteName: 'ARENA0.BK palette 0 + reference fighter ramps (ALTPALS 0: primary 0, secondary 1, tertiary 13)',
            colorable: player > 0, recolor: player > 0 ? 'player' : 'none', hash, usages: [usage],
          };
          if (multiFile) shared.set(hash, item);
          else seen.set(hash, item);
          items.push(item);
        }
        group.frames.push({ item, posX: s.posX, posY: s.posY });
      });
      if (group.frames.length) groups.push(group);
    });
  });
  return { items, groups, backgrounds, excluded };
}
