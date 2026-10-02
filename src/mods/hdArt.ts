// HD pictures of the mods' robots, arenas and pilots (their hd.json, see types.ts ModHdInfo) for the remastered look:
// loaded when a screen needs them and registered with the HD artwork by the fingerprints of what they stand for
// (video/hd/assets.ts), like the generated robots' renderings, so the remastered renderer draws them like the installed
// artwork: in the players' colors, faded, flashed. Until a picture is there the renderer upscales as usual.
import type { Palette } from '../formats/palette';
import { altPalettes, fighterFile, loadBk, type Bk } from '../resources/resources';
import { imageSize } from '../util/imageSize';
import type { HdAssets, HdTexture } from '../video/hd/assets';
import { arenaGeometry } from '../video/hd/geometry';
import { pixelHash } from '../video/hd/pixelHash';
import type { Surface } from '../video/surface';
import { spriteHash, type ModHd } from './package';
import { setPortraitHook, type PortraitPart } from './portraits';
import { modArena, modPilot, modRobot } from './registry';
import { HD_SCALE } from './types';

/** Screens a set of pictures is kept for after the last one that wanted it. */
const KEEP_SCENES = 2;

interface ArtSet {
  /** Its pictures' textures (loading or loaded), by file name. */
  textures: Map<string, Promise<HdTexture | null>>;
  /** Its registrations, by fingerprint: each registers its picture (again) once it is loaded. */
  regs: Map<string, () => void>;
  /** Pictures still loading. */
  pending: number;
  /** The screen that last wanted it (see ModArtwork.sceneChanged). */
  wanted: number;
  /** Robots: the moves asked for so far (null: all of them). */
  moves: Set<number> | null;
}

let arena0: Palette | null = null;

/** A robot's base palette: the colors its pictures are painted in, and the colors every fight shares (hdArtwork.ts). */
export function robotBasePalette(colors: [number, number, number]): Uint8Array {
  const rgb = new Uint8Array(768);
  const alt = altPalettes()[0];
  // (the tertiary, secondary and primary ramps at 1-15, 16-31 and 32-47)
  [colors[2], colors[1], colors[0]].forEach((src, ramp) => {
    for (let k = ramp === 0 ? 1 : 0; k < 16; k++) {
      const j = src * 16 + k;
      rgb.set([alt.r(j), alt.g(j), alt.b(j)], (ramp * 16 + k) * 3);
    }
  });
  arena0 ??= loadBk('ARENA0.BK').palettes[0];
  for (let i = 0x60; i < 0x100; i++) rgb.set([arena0.r(i), arena0.g(i), arena0.b(i)], i * 3);
  return rgb;
}

/**
 * A portrait's base palette: the screen's, with the entries the pilot select screen dims portraits into (1-0x5F)
 * holding the bright colors they copy, so a dimmed face drawn from the face's picture comes out dimmed.
 */
export function portraitBasePalette(pal: Palette): Uint8Array {
  const rgb = pal.colors.slice(0, 768);
  for (let i = 1; i < 0x60; i++) rgb.set(pal.colors.subarray((i + 0xa0) * 3, (i + 0xa0) * 3 + 3), i * 3);
  return rgb;
}

/** The region of an HD picture (tw x th) that stands for a part of the picture (pw x ph) it is the HD version of. */
export function hdRegion(part: PortraitPart['crop'], pw: number, ph: number, tw: number, th: number): [number, number, number, number] {
  if (!part) return [0, 0, tw, th];
  const kx = tw / pw, ky = th / ph;
  return [part.x * kx, part.y * ky, part.w * kx, part.h * ky];
}

/** The largest side a picture of nw x nh native pixels is loaded at: twice the remaster's resolution. */
function sideLimit(nw: number, nh: number): number {
  return 2 * Math.max(nw * HD_SCALE.x, nh * HD_SCALE.y);
}

export class ModArtwork {
  private sets = new Map<string, ArtSet>();
  private rows = new Map<string, number>();
  private scene = 0;

  /** `active`: whether pictures are wanted at all (the remastered look, with HD artwork on). */
  constructor(private hd: HdAssets, private active: () => boolean) {
    setPortraitHook((pilotId, surf, pal, part) => this.portrait(pilotId, surf, pal, part));
  }

  /** A new screen (after it was made): sets no screen wanted for a while are freed. */
  sceneChanged(): void {
    this.scene++;
    for (const [key, set] of [...this.sets]) if (this.scene - set.wanted > KEEP_SCENES && !set.pending) this.free(key, set);
  }

  /** Whether pictures this screen wants are still loading (a screen's portraits are wanted while it is made). */
  get loading(): boolean {
    for (const set of this.sets.values()) if (set.pending && this.scene - set.wanted <= 1) return true;
    return false;
  }

  /** The mod robots' pictures: all of their moves, or some (the select screen's cell and idle animation). */
  want(harIds: number[], moves?: number[]): void {
    if (!this.active()) return;
    for (const id of harIds) {
      const r = modRobot(id);
      if (!r?.hd?.info.sprites.length) continue;
      const set = this.set(`robot/${id}`);
      if (set.moves === null) continue;
      const fresh = moves ? moves.filter((m) => !set.moves!.has(m)) : null;
      if (fresh && !fresh.length) continue;
      const add = r.hd.info.sprites.filter((e) => (fresh ? fresh.includes(e.anim) : !set.moves!.has(e.anim)));
      if (fresh) for (const m of fresh) set.moves.add(m);
      else set.moves = null;
      const af = fighterFile(id);
      const row = this.row(robotBasePalette(r.hd.info.colors));
      for (const e of add) {
        const sp = af.moves[e.anim]?.animation.sprites[e.sprite];
        if (sp && !sp.isEmpty()) this.sprite(set, r.hd, e.file, spriteHash(sp), sp.width, sp.height, r.hd.info.pad, row);
      }
    }
  }

  /** The mod robots' pictures of their mechlab turning robots (the frames the game draws of them, gen/mechlabModel.ts). */
  wantMech(harIds: number[]): void {
    if (!this.active()) return;
    for (const id of harIds) {
      const r = modRobot(id);
      if (!r?.hd?.info.mech.length) continue;
      const set = this.set(`mech/${id}`);
      const row = this.row(robotBasePalette(r.hd.info.colors));
      for (const e of r.hd.info.mech) {
        const size = imageSize(r.hd.files.get(e.file)!);
        if (size) this.sprite(set, r.hd, e.file, e.hash, size.w / HD_SCALE.x - 2 * r.hd.info.pad, size.h / HD_SCALE.y - 2 * r.hd.info.pad, r.hd.info.pad, row);
      }
    }
  }

  /** A mod arena's pictures: its background (with its widescreen sides) and its animations' sprites. */
  wantArena(index: number, bk: Bk): void {
    if (!this.active()) return;
    const a = modArena(index);
    if (!a?.hd) return;
    const set = this.set(`arena/${index}`);
    if (set.textures.size) return;
    const row = this.row(bk.palettes[0].colors.slice(0, 768));
    for (const e of a.hd.info.sprites) {
      const s = bk.infos.get(e.anim)?.ani.sprites[e.sprite]?.surface;
      if (s) this.sprite(set, a.hd, e.file, pixelHash(s.w, s.h, s.data.subarray(0, s.w * s.h)), s.w, s.h, a.hd.info.pad, row);
    }
    const file = a.hd.info.background;
    const size = file ? imageSize(a.hd.files.get(file)!) : null;
    if (file && size) {
      const bg = bk.background;
      const hash = pixelHash(bg.w, bg.h, bg.data.subarray(0, bg.w * bg.h));
      // (a picture of the whole widescreen background: the renderer draws the widescreen canvas from it)
      const wide = size.w / size.h > 2;
      this.register(set, hash, () => void this.picture(set, a.hd!, file, sideLimit(wide ? 576 : 320, 200)).then((t) => {
        if (t) this.hd.registerBackground(hash, t, wide ? t : undefined, row);
      }));
      // (its geometry map: parallax and light by its shape, found by the same fingerprint)
      const geo = a.hd.info.geometry;
      const data = geo && a.hd.files.get(geo.file);
      if (geo && data) arenaGeometry.registerData(hash, data, geo.floor, geo.far, geo.parallax);
    }
  }

  /** A portrait surface made for a mod pilot: the same part of its HD picture stands for it. */
  private portrait(pilotId: number, surf: Surface, pal: Palette, part: PortraitPart): void {
    if (!this.active()) return;
    const p = modPilot(pilotId);
    const file = part.kind === 'face' ? p?.hd?.info.face : p?.hd?.info.portrait;
    const picture = part.kind === 'face' ? p?.face : p?.portrait;
    if (!p?.hd || !file || !picture) return;
    const set = this.set(`pilot/${pilotId}`);
    const hash = pixelHash(surf.w, surf.h, surf.data.subarray(0, surf.w * surf.h));
    const row = this.row(portraitBasePalette(pal));
    set.regs.delete(hash);
    this.register(set, hash, () => void this.picture(set, p.hd!, file, sideLimit(picture.w, picture.h)).then((t) => {
      if (!t) return;
      const [x, y, w, h] = hdRegion(part.crop, picture.w, picture.h, t.w, t.h);
      this.hd.registerSprite(hash, t, x, y, w, h, 0, row);
    }));
  }

  private set(key: string): ArtSet {
    let set = this.sets.get(key);
    if (!set) this.sets.set(key, (set = { textures: new Map(), regs: new Map(), pending: 0, wanted: this.scene, moves: new Set() }));
    set.wanted = this.scene;
    return set;
  }

  /** A sprite's picture (of a w x h sprite, covering `pad` pixels around it), registered for its fingerprint once loaded. */
  private sprite(set: ArtSet, hd: ModHd, file: string, hash: string, w: number, h: number, pad: number, row: number): void {
    if (set.regs.has(hash)) return;
    this.register(set, hash, () => void this.picture(set, hd, file, sideLimit(w + 2 * pad, h + 2 * pad)).then((t) => {
      if (t) this.hd.registerSprite(hash, t, 0, 0, t.w, t.h, pad, row);
    }));
  }

  private register(set: ArtSet, hash: string, reg: () => void): void {
    set.regs.set(hash, reg);
    reg();
  }

  /** A picture's texture, loaded once per set (scaled down beyond `limit` pixels a side). */
  private picture(set: ArtSet, hd: ModHd, file: string, limit: number): Promise<HdTexture | null> {
    let t = set.textures.get(file);
    if (t) return t;
    const data = hd.files.get(file);
    const size = data && imageSize(data);
    if (!data || !size) return Promise.resolve(null);
    set.pending++;
    t = this.hd.loadBlob(new Blob([data as BlobPart]), size.w, size.h, true, limit)
      .catch((err) => {
        console.warn(`[mods] an HD picture could not be loaded (${file}):`, err);
        return null;
      })
      .finally(() => set.pending--);
    set.textures.set(file, t);
    return t;
  }

  /** A base palette's row with the HD artwork (added once). */
  private row(rgb: Uint8Array): number {
    const key = pixelHash(256, 3, rgb);
    let row = this.rows.get(key);
    if (row === undefined) this.rows.set(key, (row = this.hd.addBasePalette(rgb)));
    return row;
  }

  private free(key: string, set: ArtSet): void {
    this.sets.delete(key);
    for (const h of set.regs.keys()) {
      this.hd.unregister(h);
      // (a picture another set has too, two robots sharing a sprite: it registers its own again)
      for (const other of this.sets.values()) other.regs.get(h)?.();
    }
    for (const t of set.textures.values()) void t.then((x) => x && this.hd.freeTexture(x));
  }
}
