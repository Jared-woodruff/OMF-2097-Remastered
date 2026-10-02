// The original robots as fitted 3D models (tools/blender/originals): run by `npm run blender:originals -- [<robot>]
// [<out folder>] [--mode fit|refine|export] [--moves 11,10]`, which sets the variables: OMF_ORIG_ROBOT=JAGUAR,
// OMF_ORIG_OUT=<folder>, OMF_ORIG_MODE=fit (default), OMF_ORIG_MOVES=11,10 (default: every move with the robot in it).
// A starting point: only JAGUAR is modeled, and its renderings are not yet as good as its paintings (the poses fitted
// to the sprites are the hard part: overlapping parts, turns).
//   fit: each sprite's pose, from the move's previous sprite (the first from the idle stance): <out>/<robot>.fit.json,
//        <out>/<robot>/fit/m11s0.png (the sprite against the model: green both, red the sprite's only, blue the model's
//        only, yellow other zones)
//   refine: the model refined against fitted sprites: <out>/<robot>.model.json (used by the other modes from then on)
//   export: the fitted sprites as a scene for render_frames.py (like the new robots' export): <out>/<robot>.glb, and
//        each sprite as the game draws it, <out>/<robot>/sprites/m11s0.png
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { writePng } from '../../../src/gen/dev/png';
import { fighterFile } from '../../../src/resources/resources';
import { hasGameData, loadGameData } from '../../../src/test/harness';
import { pixelHash } from '../../../src/video/hd/pixelHash';
import { centered, evaluate, fitSprite, hardError, rasterZones, refineModel, searchSprite, shapesOf, spriteZones, target, type Fit, type Target } from './fit';
import { JAGUAR, jaguarDecor } from './models/jaguar';
import type { RobotModel } from '../../../src/gen/robot';
import { robotBasePalette } from '../../../src/mods/hdArt';
import { FIGHTER_RAMPS } from '../../hd-pack/catalog';
import { keyedShapes, sceneGlb, type SceneFrame } from '../sceneGltf';

/**
 * The original robots modeled so far: their HAR, model, and anchors: sprites whose turn is known (the robot facing
 * the viewer: -90), which pin down the model's proportions seen from the front.
 */
export const ORIGINALS: Record<string, {
  har: number; model: RobotModel; anchors: Record<string, number>;
  /** Parts only the renderings show (added to the refined model for the export). */
  decor?: (model: RobotModel) => { joint: string; part: RobotModel['joints'][number]['parts'][number] }[];
}> = {
  // (its idle and walk turned like the new robots', which were made to stand like the originals; the victory facing the
  // viewer)
  JAGUAR: {
    har: 0, model: JAGUAR, decor: jaguarDecor,
    anchors: {
      m11s0: -38, m11s1: -38, m11s2: -38, m11s3: -38, m11s4: -38, m10s0: -38, m10s1: -38, m10s2: -38, m10s3: -38, m10s4: -38,
      m48s2: -90, m48s3: -90, m48s4: -90, m48s5: -90, m48s6: -90, m48s7: -90,
    },
  },
};

const OUT = process.env.OMF_ORIG_OUT;
const ROBOT = (process.env.OMF_ORIG_ROBOT || 'JAGUAR').toUpperCase();
const MODE = process.env.OMF_ORIG_MODE || 'fit';
const MOVES = process.env.OMF_ORIG_MOVES ? process.env.OMF_ORIG_MOVES.split(',').map(Number) : null;
/** Moves that are effects, not the robot (the fighter file's shared and projectile moves). */
const EFFECTS = new Set([7, 8, 12, 13, 14, 55, 56, 57]);

const ZONE_RGB = [[0, 0, 0], [200, 160, 40], [200, 50, 60], [50, 110, 220], [150, 150, 150]];

function overlay(file: string, t: Target, m: Uint8Array): void {
  const rgba = new Uint8Array(t.w * t.h * 4);
  for (let i = 0; i < m.length; i++) {
    const a = t.z[i], b = m[i];
    let c: number[] | null = null;
    if (a && b) c = a === b ? ZONE_RGB[a].map((v) => Math.round(v * 0.75)) : [240, 220, 40];
    else if (a) c = [255, 30, 30];
    else if (b) c = [40, 80, 255];
    if (c) rgba.set([c[0], c[1], c[2], 255], i * 4);
    else rgba.set([16, 18, 26, 255], i * 4);
  }
  writePng(file, t.w, t.h, rgba);
}

/** Starting stances for a robot's first sprite: legs either way round, turned a little more or less. */
function stances(model: RobotModel): Fit[] {
  const out: Fit[] = [];
  for (const swap of [1, -1]) {
    for (const turn of [-38, -15, -60]) {
      const f = stance(model);
      for (const [a, b] of [['hipF', 'hipB'], ['kneeF', 'kneeB']]) {
        if (swap < 0) [f.pose.j[a], f.pose.j[b]] = [f.pose.j[b], f.pose.j[a]];
      }
      out.push({ ...f, turn });
    }
  }
  return out;
}

/** The starting stance: legs a little apart, arms a little forward, turned like the originals' idle. */
function stance(model: RobotModel): Fit {
  const j: Record<string, [number, number, number]> = {};
  for (const jt of model.joints) j[jt.name] = [0, 0, 0];
  j.hipF = [0, 0, 18];
  j.kneeF = [0, 0, -14];
  j.hipB = [0, 0, -18];
  j.kneeB = [0, 0, -6];
  j.shoulderF = [0, 0, 30];
  j.elbowF = [0, 0, 60];
  j.shoulderB = [0, 0, 20];
  j.elbowB = [0, 0, 50];
  return { pose: { j, root: [0, -3, 0] }, turn: -38 };
}

describe.skipIf(!OUT || !hasGameData)('original robots', () => {
  it(`${MODE}s ${ROBOT}`, () => {
    loadGameData();
    const robot = { ...ORIGINALS[ROBOT] };
    expect(robot.model, `no model of ${ROBOT}`).toBeTruthy();
    // (refined against its sprites: see `refine`)
    const refined = path.join(OUT!, `${ROBOT.toLowerCase()}.model.json`);
    // (refine goes on from it too: delete it to start again from the model's source)
    if (fs.existsSync(refined)) robot.model = JSON.parse(fs.readFileSync(refined, 'utf8'));
    const af = fighterFile(robot.har);
    const dir = path.join(OUT!, ROBOT.toLowerCase(), 'fit');
    fs.mkdirSync(dir, { recursive: true });
    if (MODE === 'export') {
      const fits = Object.values(JSON.parse(fs.readFileSync(path.join(OUT!, `${ROBOT.toLowerCase()}.fit.json`), 'utf8')) as
        Record<string, { move: number; sprite: number; fit: Fit; iou: number }>);
      const palette = robotBasePalette([FIGHTER_RAMPS.primary, FIGHTER_RAMPS.secondary, FIGHTER_RAMPS.tertiary]);
      const sdir = path.join(OUT!, ROBOT.toLowerCase(), 'sprites');
      fs.mkdirSync(sdir, { recursive: true });
      const frames: SceneFrame[] = [];
      // (the refined model with its decor)
      const shown: RobotModel = JSON.parse(JSON.stringify(robot.model));
      for (const d of robot.decor?.(shown) ?? []) shown.joints.find((j) => j.name === d.joint)?.parts.push(d.part);
      for (const e of fits.sort((a, b) => a.move - b.move || a.sprite - b.sprite)) {
        const sp = af.moves[e.move]!.animation.sprites[e.sprite];
        const name = `m${e.move}s${e.sprite}`;
        const shapes = keyedShapes({ ...shown, turn: e.fit.turn }, { pose: e.fit.pose });
        frames.push({ name, shapes, info: { move: e.move, sprite: e.sprite, kind: 'pose', rect: [sp.posX, sp.posY, sp.width, sp.height], iou: e.iou } });
        // (the sprite as the game draws it, 4 transparent pixels around)
        const w = sp.width + 8, h = sp.height + 8, px = sp.pixels();
        const rgba = new Uint8Array(w * h * 4);
        for (let r = 0; r < sp.height; r++) {
          for (let c = 0; c < sp.width; c++) {
            const v = px[r * sp.width + c];
            if (v) rgba.set([palette[v * 3], palette[v * 3 + 1], palette[v * 3 + 2], 255], ((r + 4) * w + c + 4) * 4);
          }
        }
        writePng(path.join(sdir, `${name}.png`), w, h, rgba);
      }
      const ramp = (first: number, count: number) => Array.from({ length: count }, (_, k) => [...palette.subarray((first + k) * 3, (first + k) * 3 + 3)]);
      const { glb, objects, triangles } = sceneGlb(ROBOT, frames, {
        palette,
        extras: {
          har: robot.har, pad: 4, original: true,
          palette: { primary: FIGHTER_RAMPS.primary, secondary: FIGHTER_RAMPS.secondary, tertiary: FIGHTER_RAMPS.tertiary },
          ramps: { tertiary: ramp(1, 15), secondary: ramp(16, 16), primary: ramp(32, 16) },
        },
      });
      fs.writeFileSync(path.join(OUT!, `${ROBOT.toLowerCase()}.glb`), glb);
      console.log(`${ROBOT}: ${frames.length} sprites, ${objects} objects, ${triangles} triangles`);
      return;
    }
    if (MODE === 'refine') {
      // The model refined against the fitted sprites (every move's, at most `count`, the best fitted first), the poses
      // fitted again, twice: <out>/<robot>.model.json, which `fit` uses from then on.
      const fitsFile = path.join(OUT!, `${ROBOT.toLowerCase()}.fit.json`);
      const fits = Object.values(JSON.parse(fs.readFileSync(fitsFile, 'utf8')) as Record<string, { move: number; sprite: number; fit: Fit; iou: number }>);
      const byMove = new Map<number, typeof fits>();
      for (const e of fits) byMove.set(e.move, [...(byMove.get(e.move) ?? []), e]);
      // (every move's best two, so no pose dominates)
      // (only sprites fitted well: a wrong pose would teach the model wrong measures)
      const picked = [...byMove.values()].flatMap((es) => es.filter((e) => e.iou >= 0.72).sort((a, b) => b.iou - a.iou).slice(0, 2));
      for (const e of fits) if (robot.anchors[`m${e.move}s${e.sprite}`] !== undefined && !picked.includes(e)) picked.push(e);
      let model = robot.model;
      const samples = picked.map((e) => ({ t: target(spriteZones(af.moves[e.move]!.animation.sprites[e.sprite])), fit: e.fit }));
      for (let round = 0; round < 3; round++) {
        const r = refineModel(model, samples, ORIGINALS[ROBOT].model, 400, 6, 7 + round);
        model = r.model;
        samples.forEach((smp, k) => {
          const fixed = robot.anchors[`m${picked[k].move}s${picked[k].sprite}`] !== undefined;
          samples[k] = { ...smp, fit: fitSprite(model, smp.t, smp.fit, 0.5, 3 + k, undefined, fixed).fit };
        });
        const ious = samples.map((smp) => evaluate(model, smp.t, smp.fit).iou);
        console.log(`round ${round}: loss ${r.before.toFixed(0)} -> ${r.after.toFixed(0)}, IoU mean ${(ious.reduce((a, b) => a + b, 0) / ious.length).toFixed(3)}`);
        fs.writeFileSync(path.join(OUT!, `${ROBOT.toLowerCase()}.model.json`), JSON.stringify(model));
      }
      // The samples as fitted last (their pictures, and their fits kept: the next fit starts from them).
      const all = JSON.parse(fs.readFileSync(fitsFile, 'utf8'));
      samples.forEach((smp, k) => {
        const name = `m${picked[k].move}s${picked[k].sprite}`;
        overlay(path.join(dir, `refine-${name}.png`), smp.t, rasterZones(shapesOf(model, smp.fit), smp.t.x, smp.t.y, smp.t.w, smp.t.h));
        const sc = evaluate(model, smp.t, smp.fit);
        all[name] = { ...all[name], fit: smp.fit, iou: Math.round(sc.iou * 1000) / 1000, zones: Math.round(sc.zones * 1000) / 1000 };
      });
      fs.writeFileSync(fitsFile, JSON.stringify(all));
      return;
    }
    if (MODE === 'probe') {
      // (TEMPORARY) the idle fitted with its turn fixed at several values, against the free fit
      const sp = af.moves[11]!.animation.sprites[0];
      const t = target(spriteZones(sp));
      for (const turn of [-60, -45, -30, -15]) {
        const r = searchSprite(robot.model, t, { ...stance(robot.model), turn }, 5, true);
        const j = r.fit.pose.j;
        console.log(`turn ${turn}: loss ${r.score.loss.toFixed(0)}, IoU ${r.score.iou.toFixed(3)}, zones ${r.score.zones.toFixed(3)}, chest ${j.chest.map(Math.round)}, spine ${j.spine.map(Math.round)}`);
        overlay(path.join(dir, `probe${turn}.png`), t, rasterZones(shapesOf(robot.model, r.fit), t.x, t.y, t.w, t.h));
      }
      return;
    }
    if (MODE === 'pose') {
      // (the model in its starting stance and at rest over the idle and a victory sprite, for modeling)
      for (const [name, fit] of [['stance', stance(robot.model)], ['rest', { pose: { j: {}, root: [0, 0, 0] }, turn: -90 }]] as const) {
        for (const [mv, si] of [[11, 0], [48, 5]]) {
          const sp = af.moves[mv]!.animation.sprites[si];
          const t = target(spriteZones(sp));
          overlay(path.join(dir, `${name}-m${mv}s${si}.png`), t, rasterZones(shapesOf(robot.model, fit as Fit), t.x, t.y, t.w, t.h));
        }
      }
      return;
    }
    // (OMF_ORIG_TAG: several runs side by side, each its own file of fits, merged by the next run without a tag)
    const tag = process.env.OMF_ORIG_TAG;
    const file = path.join(OUT!, `${ROBOT.toLowerCase()}.fit${tag ? '.' + tag : ''}.json`);
    if (!tag) {
      for (const f of fs.readdirSync(OUT!).filter((n) => n.startsWith(`${ROBOT.toLowerCase()}.fit.`) && n !== `${ROBOT.toLowerCase()}.fit.json`)) {
        const part = JSON.parse(fs.readFileSync(path.join(OUT!, f), 'utf8'));
        const all = fs.existsSync(path.join(OUT!, `${ROBOT.toLowerCase()}.fit.json`)) ? JSON.parse(fs.readFileSync(path.join(OUT!, `${ROBOT.toLowerCase()}.fit.json`), 'utf8')) : {};
        fs.writeFileSync(path.join(OUT!, `${ROBOT.toLowerCase()}.fit.json`), JSON.stringify({ ...all, ...part }));
        fs.rmSync(path.join(OUT!, f));
      }
    }
    const done: Record<string, { move: number; sprite: number; hash: string; fit: Fit; iou: number; zones: number; hard?: number }> =
      fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
    const byHash = new Map(Object.values(done).map((e) => [e.hash, e]));
    const moves = af.moves.map((m, id) => ({ m, id })).filter(({ m, id }) => m && !EFFECTS.has(id) && (!MOVES || MOVES.includes(id)));
    // The idle first: the other moves start from its first frame.
    moves.sort((a, b) => (a.id === 11 ? -1 : b.id === 11 ? 1 : a.id - b.id));
    let idle: Fit | null = done.m11s0?.fit ?? null;
    const library: Fit[] = Object.values(done).map((e) => e.fit);
    const t0 = performance.now();
    for (const { m, id } of moves) {
      let prev: Fit | null = null;
      m!.animation.sprites.forEach((sp, i) => {
        if (sp.isEmpty() || sp.width > 1000) return;
        const name = `m${id}s${i}`;
        const hash = pixelHash(sp.width, sp.height, sp.pixels());
        const t = target(spriteZones(sp));
        const had = byHash.get(hash);
        let fit: Fit;
        const anchor = robot.anchors[name];
        if (had && had.fit) {
          fit = had.fit;
        } else if (anchor !== undefined) {
          // (its turn known: the search with it fixed, from the previous pose or the stance)
          fit = searchSprite(robot.model, t, { ...(prev ?? stance(robot.model)), turn: anchor }, 1 + i, true).fit;
        } else {
          // Starting points: the move's previous sprite, and the fitted sprites (or stances) whose poses already come
          // closest to this one; the best of the fits from them.
          // (each also turned other ways: the robots face the viewer in some moves)
          const pool = (library.length ? library : stances(robot.model)).flatMap((f) => [f, ...[-150, -90, -38, 0, 60, 120, 180].map((turn) => ({ ...f, turn }))]);
          const near = pool.map((f) => centered(robot.model, t, f)).map((f) => ({ f, loss: evaluate(robot.model, t, f).loss }))
            .sort((a, b) => a.loss - b.loss).slice(0, 3).map((c) => c.f);
          const starts = prev ? [prev, ...near] : near;
          let best: { fit: Fit; score: { loss: number; iou: number } } | null = null;
          starts.forEach((start, k) => {
            // (from the previous sprite, its pose is kept where this one allows; the others are judged on the
            // picture alone, and need to fit clearly better to win: then the pose did change)
            const fromPrev = !!prev && k === 0;
            const r = fitSprite(robot.model, t, start, library.length ? 1 : 2, 1 + i + k * 100, fromPrev ? prev! : undefined);
            const judged = { ...r, score: { ...r.score, loss: r.score.loss * (fromPrev ? 0.95 : 1) } };
            if (!best || judged.score.loss < best.score.loss) best = judged;
          });
          // A move's first sprite, or one no nearby pose explains: the wider search too.
          if (!prev || best!.score.iou < 0.8) {
            const r = searchSprite(robot.model, t, best!.fit, 1 + i);
            if (r.score.loss < best!.score.loss) best = r;
          }
          fit = best!.fit;
        }
        library.push(fit);
        const s = evaluate(robot.model, t, fit);
        const picture = rasterZones(shapesOf(robot.model, fit), t.x, t.y, t.w, t.h);
        const hard = Math.round(hardError(t, picture) * 1000) / 1000;
        done[name] = { move: id, sprite: i, hash, fit, iou: Math.round(s.iou * 1000) / 1000, zones: Math.round(s.zones * 1000) / 1000, hard };
        byHash.set(hash, done[name]);
        overlay(path.join(dir, `${name}.png`), t, picture);
        console.log(`${name}: IoU ${s.iou.toFixed(3)}, zones ${s.zones.toFixed(3)}, off by more than a pixel ${hard} (${((performance.now() - t0) / 1000).toFixed(0)} s)`);
        prev = fit;
        if (id === 11 && i === 0) idle = fit;
        fs.writeFileSync(file, JSON.stringify(done));
      });
    }
  }, 24 * 3600_000);
});
