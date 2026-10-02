// HD asset import, step 1: game-side metadata for every job of the pack (pixel fingerprints of the original images,
// the palettes their sources were rendered with, bundles) plus the images the game derives from others (background
// pieces, the dimmed pilot portraits). Writes <pack>/intake_meta.json for tools/hd-pack/intake.py.
// Images without delivered artwork (no job in the pack, or no *.hd.png yet: e.g. the remaster's robots until their
// frames come back from the new-art pack) are left out; the game upscales or renders those itself.
// Run with `npm run hd:import` (sets OMF_HDPACK_DIR).
import { it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseBK } from '../../src/formats/bk';
import { GAMEDATA_DIR, hasGameData } from '../../src/test/harness';
import { pixelHash } from '../../src/video/hd/pixelHash';
import { buildCatalog, SCALE_X, SCALE_Y, SPRITE_PAD, WIDE_EXT, type ImageItem } from './catalog';

const PACK = process.env.OMF_HDPACK_DIR;

export interface MetaEntry {
  job: string;
  /** Pixel fingerprint of the original indexed image (runtime lookup key). */
  hash: string;
  bundle: string;
  kind: string;
  /** Pack-relative path of the delivered HD image. */
  output: string;
  /** Target size of the HD image (padded native size x 5 / x 6). */
  width: number;
  height: number;
  native: { w: number; h: number; pad: number };
  transparent: boolean;
  /** Index into `palettes`: the palette the source image was rendered with. */
  palette: number;
  recolor: string;
  /** Scene files using the image (to disambiguate identical pixels drawn with different palettes). */
  files: string[];
  /** For backgrounds of the arenas: the widescreen canvas (extended background, WIDE_EXT native pixels per side). */
  wide?: { output: string; width: number; height: number };
}

export interface DerivedEntry {
  hash: string;
  bundle: string;
  kind: 'bg-patch' | 'composite';
  native: { w: number; h: number; pad: number };
  palette: number;
  files: string[];
  /** bg-patch: region of the background (native pixels) and the patch's own mask (1 = opaque), row-major. */
  region?: { x: number; y: number; w: number; h: number };
  source?: string;
  mask?: string;
  /** composite: HD images (by job) placed at native offsets inside this image. */
  parts?: { job: string; x: number; y: number }[];
}

/**
 * Preferred artwork for pixel-identical images: job prefix -> job prefix. The large pilot portraits of the pilot
 * select screen (MELEE) are the same images as on the VS screen; the delivered MELEE versions show the female pilots
 * (Crystal, Angel, Cossette) as men, the VS versions are right, so both screens use the VS versions.
 */
const ALIASES: Record<string, string> = {
  'scene/MELEE/a04/': 'scene/VS/a04/',
};

function bundleOf(dir: string): string {
  const [root, sub] = dir.split('/');
  switch (root) {
    case 'tier1_backgrounds':
      return `scene-${sub}`;
    case 'tier1_portraits':
      return 'portraits';
    case 'tier2_fighters':
      return `fighter-${sub}`;
    case 'tier2_effects':
      return 'effects';
    case 'tier2_arenas':
      return sub === '_SHARED' ? 'arenas-shared' : `scene-${sub}`;
    case 'tier3_scenes':
      return sub === '_SHARED' ? 'scenes-shared' : `scene-${sub}`;
    default:
      throw new Error(`Unknown pack folder ${dir}`);
  }
}

it.skipIf(!hasGameData || !PACK)('HD asset import metadata', () => {
  const cat = buildCatalog(GAMEDATA_DIR);
  const jobs = new Map<string, { output: string; width: number; height: number; transparent: boolean }>();
  for (const line of fs.readFileSync(path.join(PACK!, 'jobs.jsonl'), 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const j = JSON.parse(line);
    jobs.set(j.id, j);
  }
  const palettes: string[] = [];
  const paletteIds = new Map<string, number>();
  const paletteId = (p: Uint8Array) => {
    const hex = Buffer.from(p).toString('hex');
    let id = paletteIds.get(hex);
    if (id === undefined) {
      id = palettes.length;
      palettes.push(hex);
      paletteIds.set(hex, id);
    }
    return id;
  };

  const entries: MetaEntry[] = [];
  const delivered = (output: string) => fs.existsSync(path.join(PACK!, output));
  /** Images without artwork, by bundle. */
  const missing = new Map<string, number>();
  const add = (item: ImageItem) => {
    const job = jobs.get(item.id);
    if (!job || !delivered(job.output)) {
      missing.set(bundleOf(item.dir), (missing.get(bundleOf(item.dir)) ?? 0) + 1);
      return;
    }
    const e: MetaEntry = {
      job: item.id,
      hash: pixelHash(item.w, item.h, item.pixels),
      bundle: bundleOf(item.dir),
      kind: item.kind,
      output: job.output,
      width: job.width,
      height: job.height,
      native: { w: item.w, h: item.h, pad: item.kind === 'background' || item.kind === 'portrait' ? 0 : SPRITE_PAD },
      transparent: job.transparent,
      palette: paletteId(item.palette),
      recolor: item.recolor,
      files: [...new Set(item.usages.map((u) => u.file))],
    };
    if (item.kind === 'background') {
      const wide = jobs.get(`bgwide/${item.dir.split('/')[1]}`);
      if (wide && delivered(wide.output)) e.wide = { output: wide.output, width: wide.width, height: wide.height };
    }
    entries.push(e);
  };
  for (const item of cat.items) add(item);

  // Aliases: images drawn from pixel-identical sources in two scenes, where one delivered version is preferred for
  // both (consistency, or because the other is wrong). The alias keeps its own bundle and file list but uses the
  // preferred artwork, made against the preferred job's palette (the renderer maps it to the live palette).
  const byJob = new Map(entries.map((e) => [e.job, e]));
  for (const [from, to] of Object.entries(ALIASES)) {
    for (const e of entries) {
      if (!e.job.startsWith(from)) continue;
      const target = byJob.get(to + e.job.slice(from.length));
      if (!target || target.hash !== e.hash) throw new Error(`Alias ${e.job}: no pixel-identical ${to} image`);
      e.output = target.output;
      e.palette = target.palette;
    }
  }

  // Identical pixels used with different palettes (separate HD images): report, the runtime disambiguates by file.
  const byHash = new Map<string, MetaEntry[]>();
  for (const e of entries) byHash.set(e.hash, [...(byHash.get(e.hash) ?? []), e]);
  const collisions = [...byHash.values()].filter((l) => l.length > 1).map((l) => l.map((e) => e.job));

  // ---- Derived images ------------------------------------------------------------------------------------------
  const derived: DerivedEntry[] = [];
  const bks = new Map<string, ReturnType<typeof parseBK>>();
  const bk = (f: string) => {
    let b = bks.get(f);
    if (!b) {
      b = parseBK(new Uint8Array(fs.readFileSync(path.join(GAMEDATA_DIR, f))));
      bks.set(f, b);
    }
    return b;
  };
  // Background pieces redrawn in front of the fighters: cut from the HD background.
  for (const ex of cat.excluded) {
    if (!ex.backgroundRegion || ex.sprite === undefined) continue;
    const s = bk(ex.file).anims[ex.anim]!.animation.sprites[ex.sprite];
    const px = s.pixels();
    const bgItem = cat.backgrounds.find((b) => b.item.file === ex.file)!.item;
    if (!byJob.has(bgItem.id)) continue;
    derived.push({
      hash: pixelHash(s.width, s.height, px),
      bundle: bundleOf(bgItem.dir),
      kind: 'bg-patch',
      native: { w: s.width, h: s.height, pad: 0 },
      palette: paletteId(bgItem.palette),
      files: [ex.file],
      region: ex.backgroundRegion,
      source: jobs.get(bgItem.id)!.output,
      mask: Buffer.from(px.map((v) => (v ? 1 : 0))).toString('base64'),
    });
  }
  // MELEE: the dimmed grid of pilot portraits (animation 0) is the small portraits (animation 3) with every index
  // moved down by 0xA0 (the scene loads a dimmed copy of those colors there). Composite the HD portraits.
  {
    const melee = bk('MELEE.BK');
    const grid = melee.anims[0]!.animation;
    const faces = melee.anims[3]!.animation;
    const g = grid.sprites[0];
    const gpx = g.pixels();
    const parts: { job: string; x: number; y: number }[] = [];
    let covered = 0, matched = 0;
    // (only when every portrait has its artwork)
    let complete = true;
    faces.sprites.forEach((s, si) => {
      if (s.isEmpty()) return;
      const item = cat.items.find((it2) => it2.kind === 'scene' && it2.usages.some((u) => u.file === 'MELEE.BK' && u.anim === 3 && u.sprite === si));
      if (!item) return;
      if (!byJob.has(item.id)) complete = false;
      const ox = s.posX + faces.startX - (g.posX + grid.startX);
      const oy = s.posY + faces.startY - (g.posY + grid.startY);
      const px = s.pixels();
      for (let y = 0; y < s.height; y++) {
        for (let x = 0; x < s.width; x++) {
          const v = px[y * s.width + x];
          const gx = ox + x, gy = oy + y;
          if (!v || gx < 0 || gy < 0 || gx >= g.width || gy >= g.height) continue;
          covered++;
          if (gpx[gy * g.width + gx] === v - 0xa0) matched++;
        }
      }
      parts.push({ job: item.id, x: ox, y: oy });
    });
    if (!complete) {
      // (left to the game's upscaling)
    } else if (covered > 0 && matched / covered > 0.9) {
      // Base palette: the MELEE palette with 1..0x5F holding the (undimmed) colors of 0xA1..0xFF.
      const pal = bk('MELEE.BK').palettes[0].colors.slice();
      for (let i = 1; i < 0x60; i++) pal.set(pal.subarray((i + 0xa0) * 3, (i + 0xa0) * 3 + 3), i * 3);
      derived.push({
        hash: pixelHash(g.width, g.height, gpx),
        bundle: 'scene-MELEE',
        kind: 'composite',
        native: { w: g.width, h: g.height, pad: SPRITE_PAD },
        palette: paletteId(pal),
        files: ['MELEE.BK'],
        parts,
      });
    } else {
      console.warn(`MELEE dimmed portraits: composite does not match (${matched}/${covered})`);
    }
  }

  const meta = {
    format: 'omf2097-hd-intake-meta',
    version: 1,
    scale: { x: SCALE_X, y: SCALE_Y },
    spritePad: SPRITE_PAD,
    wideExtension: WIDE_EXT,
    palettes,
    entries,
    derived,
    collisions,
  };
  fs.writeFileSync(path.join(PACK!, 'intake_meta.json'), JSON.stringify(meta));
  console.log(`intake meta: ${entries.length} entries, ${derived.length} derived, ${palettes.length} palettes, ${collisions.length} pixel-identical groups`);
  if (missing.size) console.log(`no artwork (left to the game): ${[...missing].map(([b, n]) => `${b} ${n}`).join(', ')}`);
}, 10 * 60 * 1000);
