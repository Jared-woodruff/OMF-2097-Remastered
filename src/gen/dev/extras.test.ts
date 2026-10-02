// Makes the remaster's new robots and arenas into the mod that comes with the game (src/mods/extras.ts): its package,
// <out>/omf2097r.extras.omfmod, and <out>/index.json (the mods the game comes with: the MODS page lists them before
// their packages are fetched). EXTRAS_OUT=<folder> npx vitest run src/gen/dev/extras (`npm run extras` writes them to
// public/mods). Each part is taken from the package already there, unless given:
// - EXTRAS_GEN=<folder>: the fighter and scene files (FIGHTR11.AF .. FIGHTR14.AF, ARENA5.BK .. ARENA8.BK and their
//   .WID: `npm run gen`'s output);
// - EXTRAS_HD=<an HD asset folder>: the robots' HD pictures, cut out of its fighter-GLACIER... bundles by
//   tools/extras/crop.py (Python 3 with Pillow);
// - EXTRAS_BLENDER=<folder>: the robots' HD pictures rendered in Blender (docs/BLENDER_SPRITES.md: `npm run
//   blender:render` writes <folder>/<robot>.glb and <folder>/<robot>/hd/m11s0.png ...), for the robots it has (every
//   sprite's picture, or the robot is left as it was; the mechlab's turning robot too, mech0..mech19.png), before
//   EXTRAS_HD's;
// - EXTRAS_ARENA_HD=<folder>: the arenas' HD backgrounds (ARENA5-WIDE.webp ...).
// - EXTRAS_ARENA_GEO=<folder>: the arenas' geometry maps (tools/arena-geo.py --mod: orbital.webp and .json ...); a map
//   the package already has stays while its background does.
// A robot's HD picture goes with its sprite's fingerprint: a sprite that changed loses its picture (the game renders it
// from the robot's 3D model instead). Needs the original game data (the palettes the pictures are checked against).
// Skipped in normal test runs.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseAF } from '../../formats/af';
import { parseBK, saveBK } from '../../formats/bk';
import { decodeSprite } from '../../formats/sprite';
import { EXTRAS_FILE, EXTRAS_MOD_ID, EXTRAS_NUMBERS } from '../../mods/extras';
import { robotBasePalette } from '../../mods/hdArt';
import { readModPackage, spriteHash, writeModPackage, type ModArenaData, type ModHd, type ModPackage, type ModRobotData } from '../../mods/package';
import {
  HD_PAD, HD_REFERENCE_COLORS, HD_SCALE, MOD_FORMAT, type ModArenaInfo, type ModHdFrame, type ModHdInfo, type ModHdSprite, type ModManifest,
  type ModRobotInfo,
} from '../../mods/types';
import { APP_VERSION } from '../../platform/versionLabel';
import { hasGameData, loadGameData } from '../../test/harness';
import { imageSize } from '../../util/imageSize';
import { pixelHash } from '../../video/hd/pixelHash';
import { boundingRadius } from '../geometry';
import { turntable } from '../mechlabModel';
import { ROW_H, traceShapes } from '../raster';
import { placeShapes } from '../robot';
import { readPng } from './png';
import { GEN_DESCRIPTIONS, GEN_ROBOTS, GEN_TACTICS } from '../roster';
import { GEN_ARENAS } from '../scene/arenas';
import { SCENERY, sceneryAnim } from '../scene/scenery';

const OUT = process.env.EXTRAS_OUT;
const GEN = process.env.EXTRAS_GEN;
const HD = process.env.EXTRAS_HD;
const BLENDER = process.env.EXTRAS_BLENDER;
const ARENA_HD = process.env.EXTRAS_ARENA_HD;
const ARENA_GEO = process.env.EXTRAS_ARENA_GEO;
/** WebP quality of the robots' pictures (0: lossless). */
const QUALITY = Number(process.env.EXTRAS_QUALITY ?? 92);

const MANIFEST: Omit<ModManifest, 'robots' | 'arenas' | 'pilots'> = {
  format: MOD_FORMAT,
  id: EXTRAS_MOD_ID,
  name: 'New robots and arenas',
  version: '1.0',
  author: 'OMF 2097 Remastered',
  description: 'Made for the remaster: four robots with their own special moves and finishers, and four arenas with their own weather ' +
    'and echo.',
  game: APP_VERSION || '0.0.0',
};

/** The arenas' ambience (remastered effects and echo): their own, by the order of GEN_ARENAS. */
const AMBIENCE: ModArenaInfo['ambience'][] = ['orbital', 'ice cave', 'rooftop', 'abyss'];

const folderOf = (kind: 'robot' | 'arena', n: number): string => Object.entries(EXTRAS_NUMBERS[kind]).find(([, v]) => v === n)![0];

/** A robot sprite's picture's file name stem: "m11-a" (move 11, sprite A); past Z by number. */
const stem = (anim: number, sprite: number): string => `m${anim}-${sprite < 26 ? String.fromCharCode(97 + sprite) : sprite}`;

/** A file of the generated content: EXTRAS_GEN's, else the package's. */
function part(name: string, had: Uint8Array | null | undefined): Uint8Array {
  if (GEN && fs.existsSync(path.join(GEN, name))) return new Uint8Array(fs.readFileSync(path.join(GEN, name)));
  if (had) return had;
  throw new Error(`${name}: give EXTRAS_GEN=<npm run gen's output> (there is no package to take it from yet).`);
}

interface HdEntry {
  hash: string; bundle: string; page: number; x: number; y: number; w: number; h: number; tx: number; ty: number; fw: number; fh: number;
  pad: number; palette: number;
}

type CropJob =
  | { bundle: string; page: number; x: number; y: number; w: number; h: number; tx: number; ty: number; fw: number; fh: number; file: string }
  | { src: string; fw: number; fh: number; file: string };

/** The scene extras of a glTF binary (tools/blender's exports: the robot's frames and colors). */
function glbExtras(file: string): { robot: string; palette: { primary: number; secondary: number; tertiary: number }; frames: { name: string; kind: string; rect: number[] }[] } {
  const b = fs.readFileSync(file);
  if (b.readUInt32LE(0) !== 0x46546c67) throw new Error(`${file} is not a glTF binary`);
  const doc = JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString('utf8'));
  return doc.scenes[doc.scene ?? 0].extras.omf;
}

/**
 * A robot's HD pictures rendered in Blender (EXTRAS_BLENDER), queued in `jobs`, or null when the folder has none of
 * it. Every sprite needs its picture, of its frame's size, from an export of the same sprites (the export's copy of
 * each sprite, <robot>/sprites/m11s0.png, is checked pixel by pixel), in the export's colors.
 */
function blenderHd(r: (typeof GEN_ROBOTS)[number], folder: string, af: Uint8Array, jobs: CropJob[], log: string[]):
  { info: ModHdInfo; files: Map<string, string | Uint8Array> } | null {
  const dir = path.join(BLENDER!, r.name.toLowerCase(), 'hd');
  const glb = path.join(BLENDER!, `${r.name.toLowerCase()}.glb`);
  if (!fs.existsSync(dir) || !fs.existsSync(glb)) return null;
  const ex = glbExtras(glb);
  const frames = new Map(ex.frames.map((f) => [f.name, f]));
  const colors: [number, number, number] = [ex.palette.primary, ex.palette.secondary, ex.palette.tertiary];
  const palette = robotBasePalette(colors);
  const f = parseAF(af);
  const sprites: ModHdSprite[] = [];
  const files = new Map<string, string | Uint8Array>();
  const fileOf = new Map<string, string>();
  f.moves.forEach((m, anim) => m?.animation.sprites.forEach((sp, i) => {
    if (sp.isEmpty() || sp.width > 1000) return;
    const name = `m${anim}s${i}`;
    const src = path.join(dir, `${name}.png`);
    const frame = frames.get(name);
    if (!frame || !fs.existsSync(src)) throw new Error(`${r.name}: no Blender picture of move ${anim} sprite ${i} (${src}); render all of its frames`);
    // (the same sprite: its size and every pixel, but for a menu picture's background, which its HD picture leaves
    // see-through like the paintings; where the game draws it is the fighter file's business)
    const copy = readPng(path.join(BLENDER!, r.name.toLowerCase(), 'sprites', `${name}.png`));
    const px = sp.pixels();
    const menu = frame.kind === 'menu';
    let differ = frame.rect[2] !== sp.width || frame.rect[3] !== sp.height || copy.w !== sp.width + 2 * HD_PAD ? 1 : 0;
    for (let y = 0; y < sp.height && !differ; y++) {
      for (let x = 0; x < sp.width; x++) {
        const v = px[y * sp.width + x], o = ((y + HD_PAD) * copy.w + x + HD_PAD) * 4;
        const same = copy.rgba[o + 3] === 0 ? v === 0 || menu
          : copy.rgba[o + 3] === 255 && v !== 0 && copy.rgba[o] === palette[v * 3] && copy.rgba[o + 1] === palette[v * 3 + 1] && copy.rgba[o + 2] === palette[v * 3 + 2];
        if (!same) differ++;
      }
    }
    if (differ) throw new Error(`${r.name}, move ${anim} sprite ${i}: the export's sprite is not the fighter file's (export the robot again and render it: npm run blender:render -- ${r.name})`);
    const fw = (sp.width + 2 * HD_PAD) * HD_SCALE.x, fh = (sp.height + 2 * HD_PAD) * HD_SCALE.y;
    const size = imageSize(new Uint8Array(fs.readFileSync(src)));
    if (!size || size.w !== fw || size.h !== fh) throw new Error(`${r.name}, move ${anim} sprite ${i}: ${src} is not ${fw} x ${fh}`);
    const hash = spriteHash(sp);
    let file = fileOf.get(hash);
    if (!file) {
      fileOf.set(hash, (file = `hd/${stem(anim, i)}.webp`));
      jobs.push({ src, fw, fh, file: `${folder}/${file.slice(3)}` });
      files.set(file, `${folder}/${file.slice(3)}`);
    }
    sprites.push({ anim, sprite: i, file, hash });
  }));
  // The mechlab's turning robot: each frame's picture, for the fingerprint of the frame the game draws (all of them or
  // none: the game renders the frames itself unless the mod has every one).
  const mech: ModHdFrame[] = [];
  const tt = turntable(r);
  const turns = tt.models.filter((_, k) => fs.existsSync(path.join(dir, `mech${k}.png`))).length;
  if (turns && turns < tt.models.length) throw new Error(`${r.name}: Blender pictures of ${turns} of the mechlab's ${tt.models.length} frames; render all of its frames`);
  if (turns) {
    tt.models.forEach((model, k) => {
      const t = traceShapes(placeShapes(model, tt.pose, boundingRadius), 1 / tt.scale, ROW_H / tt.scale);
      const copy = readPng(path.join(BLENDER!, r.name.toLowerCase(), 'sprites', `mech${k}.png`));
      let differ = copy.w !== t.w + 2 * HD_PAD || copy.h !== t.h + 2 * HD_PAD ? 1 : 0;
      for (let y = 0; y < t.h && !differ; y++) {
        for (let x = 0; x < t.w; x++) {
          const v = t.data[y * t.w + x], o = ((y + HD_PAD) * copy.w + x + HD_PAD) * 4;
          if (v ? copy.rgba[o + 3] !== 255 || copy.rgba[o] !== palette[v * 3] || copy.rgba[o + 1] !== palette[v * 3 + 1] || copy.rgba[o + 2] !== palette[v * 3 + 2]
            : copy.rgba[o + 3] !== 0) differ++;
        }
      }
      if (differ) throw new Error(`${r.name}: the export's mechlab frame ${k} is not the game's (export the robot again and render it: npm run blender:render -- ${r.name})`);
      const src = path.join(dir, `mech${k}.png`);
      const fw = (t.w + 2 * HD_PAD) * HD_SCALE.x, fh = (t.h + 2 * HD_PAD) * HD_SCALE.y;
      const size = imageSize(new Uint8Array(fs.readFileSync(src)));
      if (!size || size.w !== fw || size.h !== fh) throw new Error(`${r.name}: ${src} is not ${fw} x ${fh}`);
      const file = `hd/mech-${k}.webp`;
      jobs.push({ src, fw, fh, file: `${folder}/${file.slice(3)}` });
      files.set(file, `${folder}/${file.slice(3)}`);
      mech.push({ file, hash: pixelHash(t.w, t.h, t.data) });
    });
  }
  log.push(`${r.name}: ${sprites.length} sprites with Blender pictures (${files.size} pictures, ${mech.length} of the mechlab), painted in colors ${colors.join(',')}`);
  return { info: { colors, pad: HD_PAD, sprites, background: null, portrait: null, face: null, mech }, files };
}

/** The pilot colors (primary, secondary, tertiary) whose ramps a base palette of the HD index has, or null. */
function colorsOf(hex: string): [number, number, number] | null {
  const want = new Uint8Array(hex.match(/../g)!.map((x) => parseInt(x, 16)));
  const same = (c: [number, number, number]) => {
    const p = robotBasePalette(c);
    for (let i = 3; i < 48 * 3; i++) if (p[i] !== want[i]) return false;
    return true;
  };
  if (same(HD_REFERENCE_COLORS)) return [...HD_REFERENCE_COLORS];
  for (let a = 0; a < 16; a++) for (let b = 0; b < 16; b++) for (let c = 0; c < 16; c++) if (same([a, b, c])) return [a, b, c];
  return null;
}

/** A robot's HD pictures: cut from EXTRAS_HD's bundle for it (queued in `jobs`), else kept from its old package. */
function robotHd(r: (typeof GEN_ROBOTS)[number], folder: string, af: Uint8Array, old: ModRobotData | undefined, jobs: CropJob[],
  index: { palettes: string[]; entries: HdEntry[] } | null, log: string[]): { info: ModHdInfo; files: Map<string, string | Uint8Array> } | null {
  const f = parseAF(af);
  const sprites: ModHdSprite[] = [];
  const mech: ModHdFrame[] = [];
  const files = new Map<string, string | Uint8Array>();
  const fileOf = new Map<string, string>();
  let colors: [number, number, number] = [...HD_REFERENCE_COLORS];
  let missing = 0;
  // (an HD folder without this robot's bundle, a partial delivery: its pictures stay the package's)
  const entries = index?.entries.filter((e) => e.bundle === `fighter-${r.name}`) ?? [];
  if (index && entries.length) {
    const byHash = new Map(entries.map((e) => [e.hash, e]));
    const palettes = new Set(entries.map((e) => e.palette));
    if (palettes.size !== 1) throw new Error(`${r.name}: its pictures are painted against ${palettes.size} palettes`);
    const c = colorsOf(index.palettes[[...palettes][0]]);
    if (!c) throw new Error(`${r.name}: its pictures' palette is not three pilot color choices`);
    colors = c;
    f.moves.forEach((m, anim) => m?.animation.sprites.forEach((sp, i) => {
      if (sp.isEmpty() || sp.width > 1000) return;
      const hash = spriteHash(sp);
      const e = byHash.get(hash);
      if (!e) {
        missing++;
        return;
      }
      if (e.pad !== HD_PAD || e.fw !== (sp.width + 2 * HD_PAD) * HD_SCALE.x || e.fh !== (sp.height + 2 * HD_PAD) * HD_SCALE.y) {
        throw new Error(`${r.name}, move ${anim} sprite ${i}: its picture is ${e.fw} x ${e.fh} with a margin of ${e.pad}`);
      }
      let file = fileOf.get(hash);
      if (!file) {
        fileOf.set(hash, (file = `hd/${stem(anim, i)}.webp`));
        jobs.push({ bundle: e.bundle, page: e.page, x: e.x, y: e.y, w: e.w, h: e.h, tx: e.tx, ty: e.ty, fw: e.fw, fh: e.fh, file: `${folder}/${file.slice(3)}` });
        files.set(file, `${folder}/${file.slice(3)}`);
      }
      sprites.push({ anim, sprite: i, file, hash });
    }));
  } else if (old?.hd) {
    // (kept by fingerprint: the old package's sprites tell which picture is whose)
    const oldAf = parseAF(old.af);
    const byHash = new Map<string, string>();
    for (const e of old.hd.info.sprites) {
      const sp = oldAf.moves[e.anim]?.animation.sprites[e.sprite];
      const hash = e.hash ?? (sp ? spriteHash(sp) : null);
      if (hash) byHash.set(hash, e.file);
    }
    colors = old.hd.info.colors;
    f.moves.forEach((m, anim) => m?.animation.sprites.forEach((sp, i) => {
      if (sp.isEmpty() || sp.width > 1000) return;
      const hash = spriteHash(sp);
      const had = byHash.get(hash);
      if (!had) {
        missing++;
        return;
      }
      files.set(had, old.hd!.files.get(had)!);
      sprites.push({ anim, sprite: i, file: had, hash });
    }));
    // (the mechlab's pictures stay: the frames are the robot's own, not the fighter file's)
    for (const e of old.hd.info.mech) {
      files.set(e.file, old.hd.files.get(e.file)!);
      mech.push(e);
    }
  } else {
    return null;
  }
  log.push(`${r.name}: ${sprites.length} sprites with pictures (${files.size} pictures), ${missing} without, painted in colors ${colors.join(',')}`);
  return { info: { colors, pad: HD_PAD, sprites, background: null, portrait: null, face: null, mech }, files };
}

describe.skipIf(!OUT || !hasGameData)('the extras mod', () => {
  it('writes its package and the list of the mods that come with the game', async () => {
    loadGameData();
    fs.mkdirSync(OUT!, { recursive: true });
    const target = path.join(OUT!, EXTRAS_FILE);
    const old: ModPackage | null = fs.existsSync(target) ? await readModPackage(new Uint8Array(fs.readFileSync(target))) : null;
    const index = HD ? JSON.parse(fs.readFileSync(path.join(HD, 'index.json'), 'utf8')) as { palettes: string[]; entries: HdEntry[] } : null;
    const log: string[] = [];
    const jobs: CropJob[] = [];

    const robots: (ModRobotData & { pending: Map<string, string | Uint8Array> | null })[] = GEN_ROBOTS.map((r, k) => {
      const folder = folderOf('robot', r.id);
      const had = old?.robots.find((x) => x.id === folder);
      const af = part(`FIGHTR${r.id}.AF`, had?.af);
      const info: ModRobotInfo = {
        name: r.name, description: GEN_DESCRIPTIONS[r.name], moves: { ...r.specialNames }, ai: structuredClone(GEN_TACTICS[r.name]),
        workshop: { v: 1, name: r.name, body: k, head: k, moves: k, size: 1, weight: 1, colors: [...HD_REFERENCE_COLORS] },
      };
      const hd = (BLENDER ? blenderHd(r, folder, af, jobs, log) : null) ?? robotHd(r, folder, af, had, jobs, index, log);
      return { id: folder, info, af, hd: hd ? { info: hd.info, files: new Map() } : null, pending: hd?.files ?? null };
    });

    // The pictures cut out of the HD folder's atlas pages.
    let cut: string | null = null;
    if (jobs.length) {
      cut = fs.mkdtempSync(path.join(os.tmpdir(), 'omf-extras-'));
      const spec = path.join(cut, 'jobs.json');
      fs.writeFileSync(spec, JSON.stringify({ hd: HD ? path.resolve(HD) : null, out: cut, quality: QUALITY, jobs }));
      const py = spawnSync(process.platform === 'win32' ? 'python' : 'python3', [path.resolve('tools/extras/crop.py'), spec], { encoding: 'utf8' });
      if (py.status !== 0) throw new Error(`tools/extras/crop.py failed: ${py.stderr || py.stdout}`);
    }
    for (const r of robots) {
      for (const [file, from] of r.pending ?? []) {
        r.hd!.files.set(file, typeof from === 'string' ? new Uint8Array(fs.readFileSync(path.join(cut!, from))) : from);
      }
    }
    if (cut) fs.rmSync(cut, { recursive: true, force: true });

    const arenas: ModArenaData[] = GEN_ARENAS.map((a, k) => {
      const folder = folderOf('arena', a.index);
      const had = old?.arenas.find((x) => x.id === folder);
      let bk = part(a.file, had?.bk);
      const wid = part(a.file.replace(/\.BK$/, '.WID'), had?.wid);
      const parsed = parseBK(bk);
      // Its moving scenery (scene/scenery.ts): animations of its own that loop from the start, with their HD pictures
      // (cut-outs of the painting take their native pixels from its widescreen background).
      const pieces = SCENERY.filter((p) => p.arena === a.file);
      const sceneryHd: { anim: number; sprite: number; file: string; hash: string; data: Uint8Array }[] = [];
      const wide = decodeSprite(wid.subarray(4), wid[0] | (wid[1] << 8), wid[2] | (wid[3] << 8));
      for (const p of pieces) {
        const dir = path.resolve('src/gen/scene/scenery');
        const pictures = p.frames.map((f) => readPng(path.join(dir, p.cutout ? f.replace(/\.webp$/, '.png') : f)));
        parsed.anims[p.slot] = sceneryAnim(p, pictures, parsed.palettes[0], wide);
        p.frames.forEach((f, i) => sceneryHd.push({
          anim: p.slot, sprite: i, file: `hd/a${p.slot}-${String.fromCharCode(97 + i)}${path.extname(f)}`,
          hash: spriteHash(parsed.anims[p.slot]!.animation.sprites[i]), data: new Uint8Array(fs.readFileSync(path.join(dir, f))),
        }));
      }
      if (pieces.length) bk = saveBK(parsed);
      const own = parsed.anims.map((x, id) => ({ x, id })).filter(({ x }) => x);
      log.push(`${a.name}: ${own.length} animations of its own${own.some(({ x }) => x!.probability > 1) ? ' (hazards!)' : ''}`);
      const info: ModArenaInfo = {
        name: a.name, description: a.description, newsName: a.newsName, music: a.music as ModArenaInfo['music'], ambience: AMBIENCE[k], base: -1,
        loops: pieces.map((p) => p.slot),
      };
      const given = ARENA_HD && path.join(ARENA_HD, `${a.file.replace(/\.BK$/, '')}-WIDE.webp`);
      const background = given && fs.existsSync(given) ? new Uint8Array(fs.readFileSync(given)) : had?.hd?.info.background ? had.hd.files.get(had.hd.info.background)! : null;
      let hd: ModHd | null = null;
      if (background) {
        const size = imageSize(background);
        expect(size && size.w / size.h).toBeCloseTo((576 * HD_SCALE.x) / (200 * HD_SCALE.y), 2);
        hd = { info: { colors: [...HD_REFERENCE_COLORS], pad: HD_PAD, sprites: [], background: 'hd/background.webp', portrait: null, face: null, mech: [] },
          files: new Map([['hd/background.webp', background]]) };
        // Its geometry map: a new one, or the one it had while the background is the same.
        const geoFile = ARENA_GEO && path.join(ARENA_GEO, `${folder}.webp`);
        const oldGeo = had?.hd?.info.geometry;
        const oldBg = had?.hd?.info.background ? had.hd.files.get(had.hd.info.background) : undefined;
        if (geoFile && fs.existsSync(geoFile)) {
          const g = JSON.parse(fs.readFileSync(geoFile.replace(/\.webp$/, '.json'), 'utf8')) as { floor: number; far: number; parallax: number };
          hd.info.geometry = { file: 'hd/geometry.webp', floor: g.floor, far: g.far, parallax: g.parallax };
          hd.files.set('hd/geometry.webp', new Uint8Array(fs.readFileSync(geoFile)));
        } else if (oldGeo && oldBg && Buffer.compare(Buffer.from(oldBg), Buffer.from(background)) === 0 && had!.hd!.files.has(oldGeo.file)) {
          hd.info.geometry = { ...oldGeo, file: 'hd/geometry.webp' };
          hd.files.set('hd/geometry.webp', had!.hd!.files.get(oldGeo.file)!);
        }
      }
      if (sceneryHd.length) {
        hd ??= { info: { colors: [...HD_REFERENCE_COLORS], pad: HD_PAD, sprites: [], background: null, portrait: null, face: null, mech: [] }, files: new Map() };
        for (const e of sceneryHd) {
          hd.info.sprites.push({ anim: e.anim, sprite: e.sprite, file: e.file, hash: e.hash });
          hd.files.set(e.file, e.data);
        }
      }
      const moving = pieces.filter((p) => !p.cutout).length, cutouts = pieces.length - moving;
      log.push(`${a.name}: ${hd ? `an HD background${hd.info.geometry ? ' and its geometry map' : ''}` : 'no HD background'}${
        moving ? `, ${moving} piece(s) of moving scenery${cutouts ? ` passing behind ${cutouts} cut-out(s) of the painting` : ''}` : ''}`);
      return { id: folder, info, bk, wid, hd };
    });

    const pkg: ModPackage = {
      manifest: { ...MANIFEST, robots: robots.map((r) => r.id), arenas: arenas.map((a) => a.id), pilots: [] },
      robots: robots.map(({ pending: _, ...r }) => r),
      arenas,
      pilots: [],
    };
    const bytes = await writeModPackage(pkg);
    // (read back like the game reads it: every picture of the right shape, every file playable)
    const back = await readModPackage(bytes, APP_VERSION);
    expect(back.robots.map((r) => r.hd?.info.sprites.length ?? 0)).toEqual(pkg.robots.map((r) => r.hd?.info.sprites.length ?? 0));
    fs.writeFileSync(target, bytes);
    const list = {
      format: 1,
      mods: [{
        file: EXTRAS_FILE, id: EXTRAS_MOD_ID, name: MANIFEST.name, version: MANIFEST.version, author: MANIFEST.author, description: MANIFEST.description,
        robots: pkg.robots.map((r) => r.info.name), arenas: pkg.arenas.map((a) => a.info.name), pilots: [], bytes: bytes.length,
        // (its content's fingerprint: the game asks for file?sig, which a browser may keep for good)
        sig: createHash('sha1').update(bytes).digest('hex').slice(0, 12),
      }],
    };
    fs.writeFileSync(path.join(OUT!, 'index.json'), `${JSON.stringify(list, null, 2)}\n`);
    console.log([...log, `${EXTRAS_FILE}: ${(bytes.length / 1048576).toFixed(1)} MB`].join('\n'));
  }, 1_800_000);
});
