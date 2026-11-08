// The pilot select screen's portraits (issue #18): a highlighted face sits where its sprite does (Christian's and
// Ibrahim's moved a pixel or two left), no portrait pixel is in the colors the screen changes (Steffan's eye highlight
// showed a menu's blue), and the remastered big portraits are mapped from the screen's own palette (VS's darkest grey
// turned a shadow on Raven's face black).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SceneId } from '../game/constants';
import type { MeleeScene } from '../game/scenes/melee';
import { bkGetInfo, loadBk } from '../resources/resources';
import { drawList } from '../video/draw';
import { pixelHash } from '../video/hd/pixelHash';
import { createGame, hasGameData, HeadlessRunner } from './harness';

/** The entries the pilot select screen changes while it shows: the cursors' colors and the menu colors. */
const LIVE = [0xf6, 0xf7, 0xf8, 0xfa, 0xfb, 0xfc, 0xfd, 0xfe, 0xff];

/** A one player game on a fresh pilot select screen. */
function startMelee() {
  const gs = createGame(SceneId.MELEE);
  gs.setupAi(1);
  gs.getPlayer(0).pilot.name = '';
  gs.getPlayer(1).pilot.name = '';
  gs.swapScene(SceneId.MELEE);
  const run = new HeadlessRunner(gs);
  run.advance(400);
  return { gs, run, sc: gs.sc as MeleeScene };
}

describe.skipIf(!hasGameData)("the pilot select screen's portraits", () => {
  it('draws a highlighted face where its sprite is', () => {
    const { gs, sc } = startMelee();
    const faces = bkGetInfo(loadBk('MELEE.BK'), 3)!.ani;
    // Christian (3) and Ibrahim (6) sit off the grid's corners; Crystal (0) on hers.
    for (const pilot of [3, 6, 0]) {
      const row = Math.trunc(pilot / 5), column = pilot % 5;
      sc.cursor[0].row = row;
      sc.cursor[0].column = column;
      drawList.begin();
      gs.render();
      const enabled = sc.pilotPortraits[pilot].enabled;
      const cmd = drawList.cmds.slice(0, drawList.count).find((c) => c.surf === enabled);
      const sprite = faces.getSprite(pilot)!;
      expect(cmd, `pilot ${pilot}`).toBeDefined();
      expect([cmd!.x, cmd!.y], `pilot ${pilot}`).toEqual([sprite.posX, sprite.posY]);
    }
    expect(faces.getSprite(3)!.posX).not.toBe(11 + 62 * 3);
    expect(faces.getSprite(6)!.posX).not.toBe(11 + 62 * 1);
  });

  it("keeps the portraits out of the colors the screen changes, in their own colors and with their artwork", () => {
    const { sc } = startMelee();
    const pal = sc.bk.palettes[0];
    const faces = bkGetInfo(loadBk('MELEE.BK'), 3)!.ani;
    const surfaces = [...sc.pilotPortraits.slice(0, 10).map((p) => p.enabled), ...bkGetInfo(sc.bk, 4)!.ani.sprites.map((s) => s.surface!)];
    for (const s of surfaces) expect(s.data.some((v) => LIVE.includes(v))).toBe(false);
    // Steffan's eye highlight (0xFB, white in the BK's palette): white still, drawn from his face's artwork.
    const original = faces.getSprite(1)!.surface!;
    const steffan = sc.pilotPortraits[1].enabled;
    const at = original.data.indexOf(0xfb);
    expect(at).toBeGreaterThanOrEqual(0);
    const v = steffan.data[at];
    expect([pal.r(v), pal.g(v), pal.b(v)]).toEqual([255, 255, 255]);
    // (the artwork is found by the original's pixels)
    expect(steffan.hdSource?.surf.data).toEqual(original.data);
    // A face without such pixels is drawn from its own artwork.
    expect(sc.pilotPortraits[0].enabled.hdSource).toBeNull();
  });

  it('maps the remastered big portraits from its own palette, not the VS screen\'s', () => {
    const index = JSON.parse(readFileSync('public/hd/index.json', 'utf8')) as {
      entries: { hash: string; bundle: string; palette: number }[];
    };
    const bk = loadBk('MELEE.BK');
    const hashOf = (s: { w: number; h: number; data: Uint8Array }) => pixelHash(s.w, s.h, s.data.subarray(0, s.w * s.h));
    const entry = (hash: string, bundle: string) => index.entries.find((e) => e.hash === hash && e.bundle === bundle);
    const facePalette = entry(hashOf(bkGetInfo(bk, 3)!.ani.getSprite(0)!.surface!), 'scene-MELEE')!.palette;
    for (let i = 0; i < 10; i++) {
      const hash = hashOf(bkGetInfo(bk, 4)!.ani.getSprite(i)!.surface!);
      // (the VS screen's artwork, made against its palette, which keeps it)
      expect(entry(hash, 'scene-VS')).toBeDefined();
      expect(entry(hash, 'scene-MELEE')?.palette, `big portrait ${i}`).toBe(facePalette);
    }
  });
});
