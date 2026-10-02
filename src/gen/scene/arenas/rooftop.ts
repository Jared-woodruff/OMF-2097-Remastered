// ROOFTOP: a skyscraper roof at night in the rain. The wet roof mirrors the neon signs; a water tank, air conditioning
// units and an antenna mast stand around; beyond the parapet, the city's towers with their lit windows.
import { ball, box, cylinder, wedge } from '../../robots/parts';
import { hash3 } from '../render';
import { Pattern, place, type SceneDef, type SceneMaterial, type SceneShape } from '../types';

const ROOF: SceneMaterial = { color: [0.075, 0.075, 0.09], color2: [0.14, 0.13, 0.15], pattern: Pattern.NOISE, size: 22, amount: 0.9, spec: 1.1, gloss: 70, mirror: 0.46 };
const CONCRETE: SceneMaterial = { color: [0.2, 0.19, 0.2], color2: [0.12, 0.11, 0.12], pattern: Pattern.NOISE, size: 14, amount: 0.8, spec: 0.3, gloss: 20 };
const METAL: SceneMaterial = { color: [0.2, 0.22, 0.25], spec: 0.8, gloss: 40 };
const RUST: SceneMaterial = { color: [0.28, 0.17, 0.12], color2: [0.12, 0.09, 0.08], pattern: Pattern.STRIPES, size: 12, amount: 0.15, spec: 0.4 };
const MAGENTA: SceneMaterial = { color: [1.0, 0.2, 0.75], emit: 2.4 };
const CYAN: SceneMaterial = { color: [0.2, 0.95, 1.0], emit: 2.2 };
const AMBER: SceneMaterial = { color: [1.0, 0.65, 0.2], emit: 2 };
const RED_LIGHT: SceneMaterial = { color: [1.0, 0.15, 0.1], emit: 2.5 };

function tower(x: number, z: number, w: number, h: number, d: number, hue: number): SceneShape[] {
  const window: [number, number, number] = hue > 0.66 ? [1.0, 0.8, 0.5] : hue > 0.33 ? [0.6, 0.85, 1.0] : [1.0, 0.95, 0.75];
  const mat: SceneMaterial = {
    color: [0.035, 0.035, 0.05], color2: window, pattern: Pattern.WINDOWS, size: 12, amount: 0.3 + 0.35 * hue, emit2: 1.1, spec: 0.4, gloss: 30,
  };
  const out = [place(box(w / 2, h / 2, d / 2, 0.5), [x, h / 2 - 120, z], mat)];
  if (hue > 0.5) out.push(place(box(w / 2 + 1, 1.2, d / 2 + 1, 0.3), [x, h - 118, z], hue > 0.75 ? MAGENTA : CYAN));
  if (hue < 0.25) out.push(place(cylinder(h * 0.12, 1.2, 0.3), [x, h - 120 + h * 0.12, z], METAL), place(ball(2.5), [x, h - 120 + h * 0.24, z], RED_LIGHT));
  return out;
}

export function rooftopScene(): SceneDef {
  const s: SceneShape[] = [];
  s.push(place(box(560, 5, 420, 0.5), [0, -5, -30], ROOF));
  // Parapet and railing at the roof's edge.
  const ze = -200;
  s.push(place(box(560, 14, 7, 1), [0, 14, ze], CONCRETE, [0, 0, 0], true));
  s.push(place(cylinder(560, 1.6, 0.5), [0, 48, ze + 2], METAL, [0, 0, 90]));
  for (let x = -270; x <= 270; x += 45) s.push(place(cylinder(17, 1.3, 0.4), [x, 31, ze + 2], METAL));
  // Water tank on the left, AC units and the sign on the right, an antenna mast.
  s.push(place(cylinder(34, 40, 3), [-205, 88, -150], RUST, [0, 0, 0], true));
  s.push(place(wedge(42, 16, 42, 0, 2), [-205, 138, -150], RUST, [0, 45, 0], true));
  for (const [dx, dz] of [[-28, -28], [28, -28], [-28, 28], [28, 28]]) s.push(place(cylinder(27, 2.5, 0.8), [-205 + dx, 27, -150 + dz], METAL, [0, 0, 0], true));
  s.push(place(box(34, 18, 24, 2), [190, 18, -120], METAL, [0, -12, 0], true));
  s.push(place(box(26, 14, 20, 2), [230, 14, -60], METAL, [0, 8, 0], true));
  s.push(place(cylinder(1.5, 12, 1), [190, 37, -120], { color: [0.08, 0.08, 0.1] }, [0, 0, 0]));
  s.push(place(cylinder(95, 2, 0.6), [120, 95, -185], METAL, [0, 0, 0], true));
  s.push(place(ball(3.5), [120, 192, -185], RED_LIGHT));
  // The neon sign: a ring and bars on a frame above the roof.
  s.push(place(box(2, 45, 2, 0.5), [215, 45, -180], METAL, [0, 0, 0], true));
  s.push(place(box(2, 45, 2, 0.5), [275, 45, -180], METAL, [0, 0, 0], true));
  s.push(place(cylinder(1.6, 26, 1.2), [245, 125, -179], MAGENTA, [90, 0, 0]));
  s.push(place(cylinder(1.8, 21, 1.2), [245, 125, -177], { color: [0.03, 0.02, 0.04], spec: 0.5 }, [90, 0, 0]));
  s.push(place(box(3, 12, 1.5, 1), [245, 125, -175], CYAN));
  s.push(place(box(34, 3, 2, 1), [245, 92, -178], CYAN));
  s.push(place(box(28, 2.5, 2, 1), [245, 84, -178], AMBER));
  // A helipad marking where the robots fight.
  s.push(place(cylinder(0.2, 118, 0.1), [0, 0.1, -80], { color: [0.75, 0.6, 0.12], spec: 0.8, gloss: 40, mirror: 0.3 }));
  s.push(place(cylinder(0.25, 110, 0.1), [0, 0.2, -80], ROOF));
  // A billboard on the next tower.
  s.push(place(box(60, 28, 2, 1), [-120, 250, -470], { color: [0.9, 0.2, 0.7], color2: [0.1, 0.9, 1.0], pattern: Pattern.STRIPES, size: 16, amount: 0.35, emit: 1.6, emit2: 1.8 }));
  // The city beyond the edge.
  for (let i = 0; i < 26; i++) {
    const h1 = hash3(i, 3, 1), h2 = hash3(i, 7, 2), h3 = hash3(i, 11, 3);
    const x = -760 + i * 62 + (h1 - 0.5) * 30;
    const z = -420 - h2 * 900;
    s.push(...tower(x, z, 50 + h3 * 70, 180 + h1 * 520, 60 + h2 * 50, h3));
  }
  return {
    shapes: s,
    lights: [
      { pos: [245, 125, -165], color: [1.2, 0.25, 0.9], range: 330 },
      { pos: [-120, 150, 60], color: [0.25, 0.9, 1.0], range: 380, shadow: true },
      { pos: [0, 120, -900], color: [0.5, 0.25, 0.6], range: 1500 },
      { pos: [0, 90, 300], color: [0.35, 0.33, 0.42], range: 520 },
    ],
    ambient: [0.03, 0.025, 0.045],
    skyTop: [0.02, 0.015, 0.045],
    skyHorizon: [0.2, 0.08, 0.2],
    stars: 0.15,
    fog: { color: [0.12, 0.06, 0.14], density: 0.0007 },
    exposure: 1.05,
  };
}
