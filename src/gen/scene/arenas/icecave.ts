// ICE CAVE: a frozen cavern high in the mountains. A glassy ice floor, rock walls glazed with ice, hanging stalactites
// and glowing crystal clusters; through the cave mouth, snowy peaks under an aurora.
import { ball, box, cone, wedge } from '../../robots/parts';
import { Pattern, place, type SceneDef, type SceneMaterial, type SceneShape } from '../types';

const ICE_FLOOR: SceneMaterial = { color: [0.46, 0.62, 0.76], color2: [0.8, 0.9, 0.98], pattern: Pattern.NOISE, size: 30, amount: 1, spec: 1, gloss: 80, mirror: 0.14 };
const ROCK: SceneMaterial = { color: [0.2, 0.27, 0.36], color2: [0.32, 0.43, 0.55], pattern: Pattern.NOISE, size: 22, amount: 0.45, spec: 0.9, gloss: 55 };
const ROCK_DARK: SceneMaterial = { color: [0.08, 0.1, 0.14], color2: [0.16, 0.21, 0.28], pattern: Pattern.NOISE, size: 20, amount: 0.45, spec: 0.5, gloss: 30 };
const ICE: SceneMaterial = { color: [0.45, 0.8, 0.95], spec: 1, gloss: 90, emit: 0.3 };
const ICE_DEEP: SceneMaterial = { color: [0.15, 0.45, 0.75], spec: 0.9, gloss: 60, emit: 0.18 };
const SNOW: SceneMaterial = { color: [0.55, 0.62, 0.72], color2: [0.28, 0.33, 0.42], pattern: Pattern.NOISE, size: 120, amount: 1, emit: 0.12 };

/** A cluster of crystals pointing up and outward. */
function crystals(x: number, z: number, scale: number, out: SceneShape[]): void {
  const list: [number, number, number, number][] = [[0, 0, 1, 0], [-9, 4, 0.7, 18], [8, -3, 0.8, -16], [-4, -8, 0.55, 30], [6, 8, 0.5, -30]];
  for (const [dx, dz, h, lean] of list) {
    const len = 34 * h * scale;
    out.push(place(cone(len / 2, 5 * scale * (0.6 + h * 0.4), 0.4), [x + dx * scale, len / 2 - 2, z + dz * scale], h > 0.75 ? ICE : ICE_DEEP, [lean * 0.4, 0, lean], true));
  }
}

export function icecaveScene(): SceneDef {
  const s: SceneShape[] = [];
  s.push(place(box(560, 5, 420, 0.5), [0, -5, -40], ICE_FLOOR));
  // Walls: overlapping boulders glazed with ice.
  for (const side of [-1, 1]) {
    const rocks: [number, number, number, number][] = [
      [300, 60, 60, 110], [290, 140, -40, 120], [270, 70, -150, 95], [250, 200, -200, 110], [300, 260, 30, 130], [215, 40, -250, 70],
      [235, 20, -110, 45], [262, 30, -20, 50], [200, 150, -280, 60], [190, 12, -175, 30],
    ];
    rocks.forEach(([x, y, z, r], i) => {
      s.push(place(ball(r, r * (0.9 + 0.3 * ((i * 37) % 7) / 7), r * 0.85), [side * x, y, z], y > 180 ? ROCK_DARK : ROCK, [(i * 23) % 40 - 20, side * 20 + i * 11, (i * 17) % 30 - 15], true));
    });
    crystals(side * 185, -215, 1.2, s);
    crystals(side * 230, -90, 0.9, s);
  }
  // Ceiling with the cave mouth at the back, stalactites hanging from it.
  s.push(place(ball(420, 90, 260), [0, 390, 40], ROCK_DARK));
  s.push(place(ball(170, 130, 90), [-230, 300, -300], ROCK_DARK));
  s.push(place(ball(170, 130, 90), [230, 300, -300], ROCK_DARK));
  const tips: [number, number, number, number][] = [[-150, -60, 60, 7], [-60, -120, 45, 6], [40, -40, 70, 8], [120, -140, 50, 6], [180, 20, 40, 6], [-190, 40, 55, 7], [-20, 60, 35, 5]];
  for (const [x, z, len, r] of tips) s.push(place(cone(len / 2, 0.4, r), [x, 305 - len / 2, z], len > 50 ? ICE : ICE_DEEP, [0, 0, 0], true));
  // Outside: snowy peaks under the aurora.
  s.push(place(cone(260, 330, 2), [-160, 90, -1500], SNOW));
  s.push(place(cone(320, 380, 2), [260, 120, -1800], SNOW));
  s.push(place(cone(200, 300, 2), [40, 40, -1300], SNOW));
  // Ice pillars framing the fighting area.
  s.push(place(ball(18, 120, 18), [-128, 100, -250], ICE_DEEP, [0, 0, 4], true));
  s.push(place(ball(15, 100, 15), [135, 80, -240], ICE_DEEP, [0, 0, -5], true));
  s.push(place(wedge(20, 40, 8, 3, 2), [-40, 35, -280], ICE, [0, 30, 0], true));
  return {
    shapes: s,
    lights: [
      { pos: [0, 380, -700], color: [0.45, 0.8, 0.8], range: 1400, shadow: true },
      { pos: [0, 220, -60], color: [0.35, 0.5, 0.65], range: 420 },
      { pos: [-185, 50, -190], color: [0.2, 0.7, 0.9], range: 190 },
      { pos: [185, 50, -190], color: [0.2, 0.7, 0.9], range: 190 },
      { pos: [0, 150, 280], color: [0.35, 0.4, 0.55], range: 560 },
    ],
    ambient: [0.03, 0.05, 0.08],
    skyTop: [0.004, 0.01, 0.035],
    skyHorizon: [0.03, 0.08, 0.13],
    stars: 0.8,
    aurora: { color: [0.2, 1.0, 0.55], strength: 0.55 },
    fog: { color: [0.05, 0.1, 0.15], density: 0.0009 },
    exposure: 1.1,
  };
}
