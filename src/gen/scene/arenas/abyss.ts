// ABYSS: a glass dome on the sea floor. A round tiled floor with a glowing ring, the dome's steel ribs and lamps;
// outside, deep blue water over sand, rocks and swaying kelp.
import { ball, box, cylinder, limb } from '../../robots/parts';
import { hash3 } from '../render';
import { Pattern, place, type SceneDef, type SceneMaterial, type SceneShape } from '../types';

const FLOOR: SceneMaterial = { color: [0.12, 0.24, 0.27], color2: [0.04, 0.08, 0.1], pattern: Pattern.TILES, size: 30, amount: 0.07, spec: 0.6, gloss: 40, mirror: 0.2 };
const RING: SceneMaterial = { color: [0.2, 0.95, 0.9], emit: 2 };
const RIB: SceneMaterial = { color: [0.25, 0.3, 0.32], spec: 0.8, gloss: 40 };
const LAMP: SceneMaterial = { color: [0.6, 1.0, 0.95], emit: 2.2 };
const SAND: SceneMaterial = { color: [0.3, 0.3, 0.24], color2: [0.18, 0.18, 0.15], pattern: Pattern.NOISE, size: 40, amount: 1, spec: 0.1 };
const ROCK: SceneMaterial = { color: [0.1, 0.13, 0.14], color2: [0.2, 0.25, 0.24], pattern: Pattern.NOISE, size: 30, amount: 1, spec: 0.2 };
const KELP: SceneMaterial = { color: [0.12, 0.3, 0.12], color2: [0.2, 0.42, 0.14], pattern: Pattern.NOISE, size: 12, amount: 1, spec: 0.3 };

/** The dome's radius and center. */
const R = 360;
const CZ = -120;

export function abyssScene(): SceneDef {
  const s: SceneShape[] = [];
  // Sand outside, the dome's floor, its glowing ring.
  s.push(place(box(1400, 5, 1400, 0.5), [0, -9, -600], SAND));
  s.push(place(cylinder(5, R, 1), [0, -5, CZ], FLOOR));
  s.push(place(cylinder(0.4, 200, 0.3), [0, 0.2, CZ], RING));
  s.push(place(cylinder(0.5, 192, 0.3), [0, 0.5, CZ], FLOOR));
  // Ribs: arcs from the floor to the top, and two rings around.
  // Only the dome's far half is built: the camera looks into it like into a stage.
  const back = (phi: number) => Math.cos(phi) < 0.15;
  for (let k = 0; k < 12; k++) {
    const phi = (k / 12) * Math.PI * 2;
    if (!back(phi)) continue;
    for (let i = 0; i < 9; i++) {
      const a0 = (i / 9) * (Math.PI / 2), a1 = ((i + 1) / 9) * (Math.PI / 2), am = (a0 + a1) / 2;
      const r = R * Math.cos(am), y = R * Math.sin(am);
      const len = R * (a1 - a0);
      // Tangent to the arc: the box's long (y) axis tilted by the elevation, turned to the rib's azimuth.
      s.push(place(box(3, len / 2 + 1, 4, 1), [Math.sin(phi) * r, y, CZ + Math.cos(phi) * r], RIB, [-(am * 180) / Math.PI, (phi * 180) / Math.PI, 0]));
    }
    s.push(place(ball(3.5), [Math.sin(phi) * R * 0.94, R * 0.34, CZ + Math.cos(phi) * R * 0.94], LAMP));
  }
  for (const elev of [0.35, 0.72]) {
    const r = R * Math.cos(elev), y = R * Math.sin(elev);
    for (let k = 0; k < 36; k++) {
      const phi = ((k + 0.5) / 36) * Math.PI * 2;
      if (!back(phi)) continue;
      const len = (2 * Math.PI * r) / 36;
      s.push(place(box(len / 2 + 1, 2.5, 3, 1), [Math.sin(phi) * r, y, CZ + Math.cos(phi) * r], RIB, [0, (phi * 180) / Math.PI, 0]));
    }
  }
  // Pipes along the dome's base.
  for (const side of [-1, 1]) s.push(place(cylinder(120, 6, 2), [side * 260, 14, CZ - 60], RIB, [90, side * 35, 0], true));
  // Outside: rocks and kelp.
  for (let i = 0; i < 14; i++) {
    const a = hash3(i, 1, 9) * Math.PI - Math.PI / 2 - Math.PI / 2;
    const d = R + 80 + hash3(i, 2, 9) * 500;
    const x = Math.sin(a) * d * 1.3, z = CZ + Math.cos(a) * d * -1;
    s.push(place(ball(30 + hash3(i, 3, 9) * 50, 20 + hash3(i, 4, 9) * 40, 30 + hash3(i, 5, 9) * 40), [x, 0, z], ROCK));
  }
  for (let i = 0; i < 30; i++) {
    const x = -700 + hash3(i, 6, 4) * 1400, z = -500 - hash3(i, 7, 4) * 500;
    let y = 0, dx = 0;
    const h = 60 + hash3(i, 8, 4) * 160;
    for (let k = 0; k < 4; k++) {
      const seg = h / 4;
      const bend = (hash3(i, k, 5) - 0.5) * 30;
      s.push(place(limb(seg / 2, 3.5 - k * 0.6, 3 - k * 0.6), [x + dx, y + seg / 2, z], KELP, [0, 0, bend]));
      y += seg;
      dx -= Math.sin((bend * Math.PI) / 180) * seg;
    }
  }
  return {
    shapes: s,
    lights: [
      { pos: [0, 700, -300], color: [0.5, 0.85, 0.95], range: 1600, shadow: true },
      { pos: [-220, 120, -150], color: [0.25, 0.8, 0.75], range: 280 },
      { pos: [220, 120, -150], color: [0.25, 0.8, 0.75], range: 280 },
      { pos: [0, 100, 300], color: [0.3, 0.42, 0.45], range: 520 },
    ],
    ambient: [0.02, 0.05, 0.06],
    skyTop: [0.0, 0.03, 0.08],
    skyHorizon: [0.03, 0.2, 0.26],
    fog: { color: [0.03, 0.16, 0.2], density: 0.0012 },
    exposure: 1.2,
  };
}
