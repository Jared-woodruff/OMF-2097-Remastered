// ORBITAL: the hangar deck of a space station. Polished steel floor with glowing guide strips, a panoramic window
// onto the Earth and the stars, bulkheads with lights, cargo crates and a maintenance gantry.
import { ball, box, cylinder, wedge } from '../../robots/parts';
import { Pattern, place, type RGB, type SceneDef, type SceneMaterial, type SceneShape } from '../types';

const STEEL: SceneMaterial = { color: [0.16, 0.17, 0.2], color2: [0.03, 0.035, 0.045], pattern: Pattern.PANELS, size: 48, amount: 0.05, spec: 0.6, gloss: 40, mirror: 0.22 };
const WALL: SceneMaterial = { color: [0.15, 0.16, 0.19], color2: [0.04, 0.045, 0.055], pattern: Pattern.PANELS, size: 36, amount: 0.06, spec: 0.35, gloss: 24 };
const DARK: SceneMaterial = { color: [0.1, 0.11, 0.13], spec: 0.3, gloss: 16 };
const FRAME: SceneMaterial = { color: [0.34, 0.36, 0.4], spec: 0.7, gloss: 40 };
const HAZARD: SceneMaterial = { color: [0.75, 0.5, 0.08], color2: [0.05, 0.05, 0.05], pattern: Pattern.STRIPES, size: 10, amount: 0.5, spec: 0.3 };
const CRATE: SceneMaterial = { color: [0.42, 0.34, 0.2], color2: [0.2, 0.16, 0.09], pattern: Pattern.TILES, size: 22, amount: 0.12, spec: 0.2 };
const CRATE2: SceneMaterial = { color: [0.22, 0.3, 0.38], color2: [0.1, 0.13, 0.17], pattern: Pattern.TILES, size: 22, amount: 0.12, spec: 0.2 };
const GLOW: SceneMaterial = { color: [0.3, 0.9, 1.0], emit: 2.2 };
const LAMP: SceneMaterial = { color: [1.0, 0.85, 0.6], emit: 2.5 };
const EARTH: SceneMaterial = { color: [0.02, 0.08, 0.3], color2: [0.8, 0.85, 0.9], pattern: Pattern.NOISE, size: 160, amount: 1.1, emit: 0.9, emit2: 0.55 };

function crate(x: number, z: number, w: number, h: number, d: number, mat: SceneMaterial, y = 0, rot = 0): SceneShape {
  return place(box(w / 2 - 1, h / 2 - 1, d / 2 - 1, 1), [x, y + h / 2, z], mat, [0, rot, 0], true);
}

export function orbitalScene(): SceneDef {
  const s: SceneShape[] = [];
  // Floor and guide strips.
  s.push(place(box(520, 5, 360, 0.5), [0, -5, 20], STEEL));
  for (const z of [-150, 70]) s.push(place(box(520, 0.25, 2.5, 0.2), [0, 0.2, z], GLOW));
  // Back wall around the panoramic window (the window: x -250..250, y 40..200).
  const zb = -250;
  s.push(place(box(520, 20, 8, 1), [0, 20, zb], WALL));
  s.push(place(box(520, 60, 8, 1), [0, 260, zb], WALL));
  s.push(place(box(520, 3, 9, 1), [0, 42, zb + 2], HAZARD));
  for (const x of [-250, -125, 0, 125, 250]) s.push(place(box(6, 82, 10, 1.5), [x, 121, zb + 3], FRAME, [0, 0, 0], true));
  s.push(place(box(520, 5, 10, 1.5), [0, 202, zb + 3], FRAME));
  s.push(place(box(520, 3, 10, 1), [0, 120, zb + 4], FRAME));
  // Above the window: a light strip, vents and the station's emblem.
  s.push(place(box(520, 2, 4, 0.5), [0, 214, zb + 6], GLOW));
  for (const x of [-190, -110, 110, 190]) s.push(place(box(28, 10, 3, 1), [x, 250, zb + 6], DARK));
  s.push(place(cylinder(2, 26, 1.5), [0, 252, zb + 7], FRAME, [90, 0, 0]));
  s.push(place(cylinder(2.5, 20, 1.5), [0, 252, zb + 9], { color: [0.08, 0.2, 0.42], emit: 0.6 }, [90, 0, 0]));
  s.push(place(wedge(9, 14, 2, 0, 0.8), [0, 254, zb + 12], { color: [0.95, 0.75, 0.3], emit: 1.4 }));
  // Hazard edges along the deck near the camera, and wider glowing lanes.
  for (const x of [-235, 235]) s.push(place(box(6, 0.3, 300, 0.2), [x, 0.2, 60], HAZARD));
  // Beyond the window: the Earth, its glowing rim, a moon.
  s.push(place(ball(1500), [150, -1300, -3200], EARTH));
  s.push(place(ball(70), [-620, 420, -2600], { color: [0.55, 0.55, 0.58], color2: [0.3, 0.3, 0.33], pattern: Pattern.NOISE, size: 20, amount: 1, emit: 0.35, emit2: 0.3 }));
  // Side bulkheads, angled toward the window, with light panels.
  for (const side of [-1, 1]) {
    s.push(place(box(8, 150, 190, 1), [side * 300, 150, -80], WALL, [0, side * 18, 0]));
    s.push(place(box(3, 40, 70, 1), [side * 288, 150, -110], GLOW, [0, side * 18, 0]));
    s.push(place(box(20, 150, 20, 2), [side * 250, 150, -235], FRAME, [0, 0, 0], true));
    // Pipes along the bulkheads.
    s.push(place(cylinder(200, 5, 1.5), [side * 285, 24, -60], DARK, [90, side * 18, 0]));
    s.push(place(cylinder(200, 3.5, 1), [side * 283, 38, -60], FRAME, [90, side * 18, 0]));
  }
  // Ceiling with beams and lamps.
  s.push(place(box(520, 8, 360, 1), [0, 330, 20], DARK));
  for (const z of [-200, -110, -20]) {
    s.push(place(box(520, 7, 9, 1), [0, 312, z], FRAME));
    for (const x of [-160, 0, 160]) s.push(place(box(16, 2, 6, 1), [x, 304, z], LAMP));
  }
  // Cargo on the left, a gantry on the right.
  s.push(crate(-215, -175, 56, 44, 44, CRATE, 0, 8));
  s.push(crate(-212, -178, 40, 32, 36, CRATE2, 44, -6));
  s.push(crate(-160, -205, 44, 30, 40, CRATE2, 0, -14));
  s.push(place(wedge(10, 18, 30, 0, 1), [-150, 18, -150], HAZARD, [0, 60, 0], true));
  for (const x of [170, 240]) s.push(place(box(5, 95, 5, 1), [x, 95, -190], FRAME, [0, 0, 0], true));
  s.push(place(box(45, 4, 16, 1), [205, 190, -190], FRAME, [0, 0, 0], true));
  s.push(place(box(45, 3, 16, 1), [205, 110, -190], FRAME, [0, 0, 0], true));
  s.push(place(cylinder(8, 12, 2), [205, 175, -190], DARK, [0, 0, 0], true));
  s.push(place(ball(4), [205, 160, -190], GLOW));
  const lights = [
    { pos: [0, 290, -40] as [number, number, number], color: [1.1, 0.95, 0.8] as RGB, range: 520, shadow: true },
    { pos: [0, 130, -600] as [number, number, number], color: [0.35, 0.55, 1.1] as RGB, range: 1100 },
    { pos: [-290, 150, -110] as [number, number, number], color: [0.2, 0.6, 0.75] as RGB, range: 260 },
    { pos: [290, 150, -110] as [number, number, number], color: [0.2, 0.6, 0.75] as RGB, range: 260 },
    { pos: [0, 90, 300] as [number, number, number], color: [0.45, 0.45, 0.5] as RGB, range: 520 },
  ];
  return {
    shapes: s,
    lights,
    ambient: [0.025, 0.03, 0.045],
    skyTop: [0.0, 0.0, 0.01],
    skyHorizon: [0.01, 0.015, 0.04],
    stars: 1,
    exposure: 1.0,
  };
}
