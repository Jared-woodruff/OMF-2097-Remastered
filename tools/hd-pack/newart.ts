// The new-art pack (`npm run newart:export`): the remaster's own robots and arenas, made by the game's generator from
// simple 3D shapes, handed to the image AI to be redrawn at the level of the originals' HD artwork. The robots' frames
// are jobs of the same kind as the HD asset pack's (tools/hd-pack/export.test.ts writes them, in its new-art mode),
// with a design sheet per robot first; the arenas are one widescreen painting each. This module holds the briefs and
// the pack's documents; tools/newart/prepare.py adds the arena guides and the reference sheets.
import fs from 'node:fs';
import path from 'node:path';

/** The generated fighter files, by robot. */
export const NEW_ROBOT_FILES: Record<string, string> = { GLACIER: 'FIGHTR11.AF', TEMPEST: 'FIGHTR12.AF', HELIX: 'FIGHTR13.AF', SPECTRE: 'FIGHTR14.AF' };

/** Canvas of an arena painting: the widescreen background (576 x 200 native pixels at 5 x 6). */
export const ARENA_W = 2880;
export const ARENA_H = 1200;
/** Where the classic 4:3 screen (native x 0..320) sits in the canvas, the floor line the robots stand on, the walls. */
export const ARENA_CLASSIC = { x0: 640, x1: 2240 };
export const ARENA_FLOOR_Y = 190 * 6;
export const ARENA_WALLS = { left: 640 + 20 * 5, right: 640 + 300 * 5 };

export interface RobotBrief {
  name: string;
  concept: string;
  /** Which parts are in which recolored zone. */
  zones: { blue: string; red: string; gold: string };
  /** What the redraw should add. */
  details: string[];
}

export const NEW_ROBOTS: Record<string, RobotBrief> = {
  GLACIER: {
    name: 'Glacier',
    concept: 'A heavy ice juggernaut, the biggest of the new robots, slow and strong: faceted armor plates over a slim ' +
      'mechanical frame, broad shoulders crowned with ice crystals, a glowing crystal core in the chest, heavy gauntlets ' +
      'and boots.',
    zones: {
      blue: 'the armor plates (chest, shoulders, gauntlets, thighs, boots, helmet)',
      red: 'the ice crystals on the shoulders and the glowing chest core (render them as translucent crystal, but keep them in the red hue family)',
      gold: 'the joints, the frame between the plates, the knee and elbow hinges',
    },
    details: [
      'thick beveled armor plates with panel seams, recessed bolts and frost-worn edges',
      'the crystals as faceted, translucent, internally glowing ice spikes with sharp highlights',
      'visible mechanics between the plates: pistons, cable bundles, ribbed joint sleeves',
      'a helmet with a narrow glowing visor slit and a crest of small crystals',
    ],
  },
  TEMPEST: {
    name: 'Tempest',
    concept: 'A slender aerial robot built around wind turbines, light, fast and agile in the air: a narrow V-shaped ' +
      'torso with a turbine intake, two swept wing blades on its back, a finned helmet, forearm fins and jet boosters on ' +
      'its calves.',
    zones: {
      blue: 'the armor shells (torso, helmet, upper arms, thighs, shins)',
      red: 'the fins and wing blades and the glowing turbine and booster exhausts',
      gold: 'the joints, the turbine housing ring and the skeletal frame',
    },
    details: [
      'an aerodynamic, streamlined armor with sharp swept edges and fine panel lines',
      'a turbine in the chest with visible fan blades behind a grille, glowing faintly',
      'wing blades with rib structure, flap segments and worn leading edges',
      'jet boosters on the calves with nozzle petals and heat discoloration',
    ],
  },
  HELIX: {
    name: 'Helix',
    concept: 'An industrial drilling robot, stocky and tough: a barrel chest with a grille and twin exhaust stacks, a ' +
      'squat faceted head with a single round eye and an antenna, a giant spiral drill for its right hand and a ' +
      'three-fingered claw on the left, hydraulic pistons on its limbs and heavy tread boots.',
    zones: {
      blue: 'the armor (barrel chest, head, shoulders, forearm housings, boots)',
      red: 'the drill bit and the steel of the claw and the glowing eye',
      gold: 'the joints, the pistons and the frame; the darker gold for the treads and the mechanics',
    },
    details: [
      'heavy-duty industrial plating with rivets, hazard wear, scratches and oil stains',
      'a machined spiral drill with sharp cutting edges and a polished metal finish',
      'hydraulic pistons with chrome rods and hoses, a chest grille with depth, exhaust stacks with soot',
      'tread boots with individual tread links',
    ],
  },
  SPECTRE: {
    name: 'Spectre',
    concept: 'A phantom-like laser robot, tall and thin: skeletal limbs, a narrow V-shaped torso with a glowing emblem, a ' +
      'pointed hood with a visor slit, a cloak of long blades hanging from its back, forearm blades with laser emitters ' +
      'and pointed feet.',
    zones: {
      blue: 'the armor (hood, torso, shoulders, forearm shells, shins)',
      red: 'the blades (the cloak and the forearm blades) and the glowing emblem, visor and laser emitters',
      gold: 'the skeletal limbs and the joints',
    },
    details: [
      'sleek, sinister armor with sharp angles, thin panel lines and a satin finish',
      'the cloak as a layered fan of long, sharp, slightly translucent blades',
      'a skeletal frame with fine mechanical detail: tendons, thin pistons, segmented spine',
      'glowing parts (visor slit, chest emblem, emitters) with a soft bloom',
    ],
  },
};

export interface ArenaBrief {
  /** Folder name in the pack. */
  dir: string;
  file: string;
  title: string;
  description: string;
  /** What stays exactly where it is. */
  keep: string[];
  /** What the painting should add. */
  details: string[];
}

export const NEW_ARENAS: ArenaBrief[] = [
  {
    dir: 'ORBITAL', file: 'ARENA5', title: 'Orbital Station',
    description: 'The hangar deck of a space station: a polished steel floor with glowing guide strips, a panoramic ' +
      'window onto the Earth and the stars, bulkheads with lights, cargo crates and a maintenance gantry.',
    keep: ['the window frame and the Earth behind it', 'the floor plane and its guide strips', 'the crates and the gantry', 'the ceiling lights'],
    details: ['hard-surface sci-fi paneling with seams, bolts, vents and warning stripes', 'reflections on the polished floor',
      'the Earth with clouds and a thin blue atmosphere glow, a dense star field', 'cables, pipes and labels-free markings on the bulkheads'],
  },
  {
    dir: 'ICE_CAVE', file: 'ARENA6', title: 'Ice Cave',
    description: 'A frozen cavern high in the mountains: a glassy ice floor, rock walls glazed with ice, hanging ' +
      'stalactites and glowing crystal clusters; through the cave mouth, snowy peaks under an aurora.',
    keep: ['the cave mouth and the aurora sky', 'the ice floor', 'the rock masses on both sides', 'the crystal clusters'],
    details: ['layered rock with frost, ice glaze and icicles', 'translucent, glowing crystals with internal light',
      'a glassy ice floor with cracks, trapped bubbles and reflections', 'snowy peaks and a flowing green aurora'],
  },
  {
    dir: 'ROOFTOP', file: 'ARENA7', title: 'Rooftop Arena',
    description: 'A skyscraper roof at night in the rain: the wet roof mirrors the neon signs; a water tank, air ' +
      'conditioning units and an antenna mast stand around; beyond the parapet, the city\'s towers with their lit windows.',
    keep: ['the roof surface and the parapet', 'the water tank, the AC units, the antenna', 'the neon signs (their shapes, colors and places, without letters)', 'the skyline'],
    details: ['wet concrete and tar with puddles reflecting the neon', 'a rusty water tank with rivets and ladders',
      'a detailed skyline with thousands of lit windows, rooftop lights and haze', 'rain streaks and misty glow around the lights'],
  },
  {
    dir: 'ABYSS', file: 'ARENA8', title: 'Abyss',
    description: 'A glass dome on the sea floor: a round tiled floor with a glowing ring, the dome\'s steel ribs and ' +
      'lamps; outside, deep blue water over sand, rocks and swaying kelp.',
    keep: ['the dome\'s ribs and their curve', 'the round floor and its glowing ring', 'the horizon of the sea floor outside'],
    details: ['riveted steel ribs with lamps, glass reflections and water streaks on the glass',
      'a tiled floor with wear and the glowing ring', 'the deep sea outside: light rays, particles, rocks, kelp, a distant wreck or fish in silhouette'],
  },
];

/** The robots' look: the originals' remastered artwork. */
export const NEWART_STYLE =
  'High-end 3D CGI render in the style of the remastered One Must Fall 2097 artwork: detailed hard-surface modeling ' +
  '(panel seams, bolts, rivets, pistons, cables), physically based painted metal, chrome and rubber with subtle wear ' +
  'and scratches, crisp edges, soft realistic lighting with strong highlights and a rim light, rich but controlled ' +
  'color, sharp focus, 1990s sci-fi arcade aesthetic.';

/** The arenas' look: the originals' remastered arena paintings. */
export const NEWART_ARENA_STYLE =
  'High-end 3D CGI environment render in the style of the remastered One Must Fall 2097 arenas: every surface ' +
  'detailed and textured, physically based materials with subtle wear, atmospheric depth and haze, soft realistic ' +
  'lighting with glowing light sources, bloom and reflections, rich but controlled color, sharp focus, 1990s sci-fi ' +
  'arcade aesthetic.';

export const NEWART_NEGATIVE_ROBOT =
  'pixel art, pixelated, low poly, flat shading, plain untextured surfaces, toy-like, plastic look, blurry, lowres, noise, ' +
  'text, letters, logo, watermark, signature, frame, border, background, floor, shadow on the ground, extra limbs, ' +
  'extra objects, changed pose, different silhouette, different facing direction, cropped, cartoon, anime, cel shading, sketch';

export const NEWART_NEGATIVE_ARENA =
  'pixel art, low poly, flat shading, plain untextured surfaces, blurry, lowres, noise, text, letters, numbers, logo, ' +
  'watermark, signature, UI, frame, border, robots, people, characters, creatures in the foreground, changed layout, ' +
  'moved horizon, tilted camera, fisheye, cartoon, anime, sketch';

/** The design sheet's prompt for a robot. */
export function designPrompt(har: string): string {
  const r = NEW_ROBOTS[har];
  return `${r.name}, a combat robot from the robot fighting game One Must Fall 2097. ${r.concept} Design sheet: a detailed ` +
    'full-body hero render of the robot in exactly the pose, silhouette and facing direction of the source frame (its ' +
    `fighting stance), isolated on a transparent background. Add: ${r.details.join('; ')}. Color zones as in the source: ` +
    `steel blue for ${r.zones.blue}; red for ${r.zones.red}; gold for ${r.zones.gold}; white, grey and black parts ` +
    `fixed. ${NEWART_STYLE}`;
}

/** An animation frame's prompt for a robot. */
export function framePrompt(har: string, move: string): string {
  const r = NEW_ROBOTS[har];
  return `${r.name}, a combat robot from the robot fighting game One Must Fall 2097 (${r.concept.replace(/\.$/, '')}). ` +
    `Animation: ${move}. Redraw the source frame as a detailed high-resolution render of the robot exactly as designed in ` +
    '`../design/design.hd.png` (same parts, panel layout, materials and details), in the pose, silhouette and facing ' +
    'direction of the source frame, isolated on a transparent background. Color zones exactly as in the source: steel ' +
    `blue for ${r.zones.blue}; red for ${r.zones.red}; gold for ${r.zones.gold}. ${NEWART_STYLE}`;
}

/** A robot's special-move effect or projectile. */
export function effectPrompt(har: string, what: string): string {
  const r = NEW_ROBOTS[har];
  return `A special-move effect of ${r.name} (${r.concept.replace(/\.$/, '')}) in the robot fighting game One Must Fall ` +
    `2097: ${what}. Redraw the source frame as a detailed high-resolution effect sprite with the same shape, size, position ` +
    'and colors, isolated on a transparent background: energy, ice, wind, light or metal rendered with depth, glow and ' +
    `fine detail. ${NEWART_STYLE}`;
}

/** An arena's prompt. */
export function arenaPrompt(a: ArenaBrief): string {
  return `${a.title}, a fighting arena of the robot fighting game One Must Fall 2097. ${a.description} Paint the empty ` +
    'arena as a detailed widescreen background with the composition of `guide.png`; these stay where they are: ' +
    `${a.keep.join('; ')}. Add: ${a.details.join('; ')}. The fight takes place on the floor in the middle: leave it ` +
    `clear. ${NEWART_ARENA_STYLE}`;
}

function write(out: string, rel: string, text: string): void {
  const p = path.join(out, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text.replace(/\r?\n/g, '\r\n'));
}

export interface NewArtCounts {
  /** Frames per robot. */
  frames: Record<string, number>;
  /** Output megapixels of all robot frames. */
  frameMegapixels: number;
}

/** The pack's README, OUTPUT_SPEC and STYLE_GUIDE. */
export function writeNewArtDocs(out: string, counts: NewArtCounts): void {
  const robots = Object.keys(NEW_ROBOTS);
  const total = robots.reduce((a, h) => a + counts.frames[h], 0);
  write(out, 'README.md', [
    '# One Must Fall 2097 Remastered — new robots and arenas',
    '',
    'The remaster adds four robots (**Glacier, Tempest, Helix, Spectre**) and four arenas (**Orbital Station, Ice Cave,',
    'Rooftop Arena, Abyss**) to the 1994 game. They were made by the game\'s own generator from simple 3D shapes, and next',
    'to the original robots and arenas, whose artwork was already remastered in HD (see `reference/`), they look plain:',
    'flat surfaces, little detail, simple lighting. This pack asks for their artwork at the level of the originals.',
    '',
    '## How to process it',
    '',
    '1. Read [OUTPUT_SPEC.md](OUTPUT_SPEC.md) (hard rules) and [STYLE_GUIDE.md](STYLE_GUIDE.md) (the look, each robot and arena).',
    '2. Compare `reference/original_robots.png` and `reference/original_arenas.png` (the originals in their HD artwork:',
    '   the quality to reach) with `reference/in_game_*.jpg` (each new robot, left, beside an original, right, in a new',
    '   arena, as the game shows them now) and `reference/current_arenas.png`.',
    '3. **Arenas** (4 jobs): `arenas/<NAME>/` → `arena.hd.png`, one widescreen painting each.',
    '4. **Robots**, one at a time (`tier2_fighters/<ROBOT>/`):',
    "   1. the **design sheet** first (`design/` → `design.hd.png`): it fixes the robot's detailed look;",
    '   2. then **every frame** (`mNN_<move>/fNNN.png` → `fNNN.hd.png`), each the same machine as the design sheet, in the',
    '      pose of its source frame.',
    '5. Take the jobs from `jobs.jsonl` or `jobs.csv` (same data). Return the folder with the new `*.hd.png` files. Partial',
    '   deliveries work: anything missing keeps its current artwork.',
    '',
    '| Part | Folder | Jobs | Output |',
    '| --- | --- | ---: | --- |',
    `| Arenas | \`arenas/\` | 4 | ${ARENA_W} × ${ARENA_H}, opaque |`,
    '| Design sheets | `tier2_fighters/<ROBOT>/design/` | 4 | transparent |',
    ...robots.map((h) => `| ${NEW_ROBOTS[h].name}, frames | \`tier2_fighters/${h}/\` | ${counts.frames[h]} | transparent, sizes in \`frames.csv\` |`),
    `| **Total** | | **${8 + total}** | robot frames: ${counts.frameMegapixels.toFixed(0)} megapixels |`,
    '',
    'A robot folder is like the originals\' in the HD asset pack: `README.md`, `reference_sheet.png` (key poses), and per',
    'move `fNNN.png` (source frames), `sheet.png` / `sheet_preview.png` (the whole animation), `frames.csv` and',
    '`prompt.md`. For image-to-image tools that need inputs at the output size, `make_inputs.py` (Python + Pillow) makes',
    '`*.input.png` files next to the sources.',
    '',
    '## Why a design sheet first',
    '',
    'The new robots\' frames come from simple shapes, so a faithful upscale stays plain: each frame needs new detail. To',
    'keep ~130 frames per robot looking like one machine, design the detail once on the design sheet, then redraw every',
    'frame from it (as a reference image, same model, settings and seed for the whole robot). Showing the four design',
    'sheets to the game\'s author before the frames saves rework.',
    '',
  ].join('\n'));

  write(out, 'OUTPUT_SPEC.md', [
    '# Output specification (hard requirements)',
    '',
    '## Names',
    '',
    'Save each result under the job\'s `output` path (next to its source). Do not rename, move or edit other files.',
    '',
    '## Arenas',
    '',
    `- Exactly **${ARENA_W} × ${ARENA_H} px**, opaque RGB PNG (8 bits per channel, sRGB).`,
    `- The canvas is the arena seen by the widescreen game. The classic 4:3 screen is x = ${ARENA_CLASSIC.x0}–${ARENA_CLASSIC.x1}`,
    '  (outlined in `layout.png`); both parts matter.',
    `- **Layout locked:** the floor the robots stand on meets their feet at y = ${ARENA_FLOOR_Y} (the yellow line in`,
    `  \`layout.png\`); they fight between x = ${ARENA_WALLS.left} and x = ${ARENA_WALLS.right}. The horizon, the big shapes and`,
    '  the landmarks named in the prompt stay where `guide.png` has them (within about 10 px): the game\'s lighting and',
    '  weather effects are placed on them.',
    '- The top band (dimmed in `layout.png`) is under the health bars and names: keep it free of important detail.',
    '- Empty arena: no robots, people, text, letters or logos (neon signs keep their shapes and colors, without letters).',
    '',
    '## Robots',
    '',
    '- Each frame exactly the `width` × `height` in `frames.csv` (5× the source\'s width, 6× its height: the game\'s pixels',
    '  are taller than wide), PNG RGBA with **real transparency** (straight alpha), soft anti-aliased edges, no halos, no',
    '  background, no ground shadow.',
    '- **Silhouette locked:** the robot stays inside the outline of its source frame (enlarged) and keeps its pose and',
    '  facing direction exactly. The game draws each frame at the source\'s position and maps every HD pixel onto the',
    '  source\'s pixels to recolor it: anything outside the outline would not take the player\'s colors.',
    '- **Color zones locked:** steel blue, red and gold are the three colors players choose for their robot (see',
    '  `reference/robot_color_zones.png`). Keep each zone exactly where the source has it and in its own hue family,',
    '  shaded with lighter and darker tones of the same hue; do not mix them. White, grey, black and effect colors (fire,',
    '  lightning, lasers) are fixed.',
    '- Sources have a transparent margin (4 source pixels): keep it transparent.',
    '- **Consistency:** every frame of a robot is the machine of its design sheet: same parts, panel layout, materials,',
    '  wear and lighting (the lighting of its design sheet in every frame).',
    '- The design sheet (`design/design.hd.png`) is the robot in its fighting stance at twice the frame scale, with the',
    '  same rules; it is a reference and is not used in the game.',
    '',
    '## Delivery',
    '',
    '- Return this folder with the `*.hd.png` files added (`*.input.png` files can stay or be deleted).',
    '- Optional: `NOTES.md` at the root listing skipped or problematic jobs.',
    '',
  ].join('\n'));

  write(out, 'STYLE_GUIDE.md', [
    '# Style guide',
    '',
    '## The look',
    '',
    `Robots: ${NEWART_STYLE}`,
    '',
    `Arenas: ${NEWART_ARENA_STYLE}`,
    '',
    'The original robots of One Must Fall 2097 were rendered from 3D models in 1994; their remastered artwork',
    '(`reference/original_robots.png`) keeps those designs and renders them with modern detail: every surface has',
    'structure (plates, seams, bolts, vents), the metal shows its material, the edges catch the light. The new robots and',
    'arenas must sit next to them without standing out.',
    '',
    'Negative prompt, robots:',
    '',
    `> ${NEWART_NEGATIVE_ROBOT}`,
    '',
    'Negative prompt, arenas:',
    '',
    `> ${NEWART_NEGATIVE_ARENA}`,
    '',
    '## The robots',
    '',
    ...Object.entries(NEW_ROBOTS).flatMap(([h, r]) => [
      `### ${r.name} (\`tier2_fighters/${h}/\`)`,
      '',
      r.concept,
      '',
      `- Steel blue: ${r.zones.blue}.`,
      `- Red: ${r.zones.red}.`,
      `- Gold: ${r.zones.gold}.`,
      `- Add: ${r.details.join('; ')}.`,
      '',
    ]),
    '## The arenas',
    '',
    ...NEW_ARENAS.flatMap((a) => [
      `### ${a.title} (\`arenas/${a.dir}/\`)`,
      '',
      a.description,
      '',
      `- Keep in place: ${a.keep.join('; ')}.`,
      `- Add: ${a.details.join('; ')}.`,
      '',
    ]),
  ].join('\n'));
}

/** An arena job's prompt file. */
export function writeArenaPrompt(out: string, a: ArenaBrief): void {
  write(out, `arenas/${a.dir}/prompt.md`, [
    `# ${a.title} (${a.file})`,
    '',
    `**Output:** \`arena.hd.png\`, ${ARENA_W} × ${ARENA_H} px, opaque RGB.`,
    '',
    '**Mode:** re-create — high creativity for detail, layout locked (img2img from `guide.png` at denoise ≈ 0.5–0.7, or',
    'reference-guided generation with `guide.png` as the structure).',
    '',
    '**Inputs:** `guide.png` (the current painting, same size), `layout.png` (the same with the fixed lines: the 4:3',
    'screen, the floor line, the fighting area, the HUD band).',
    '',
    '## Prompt',
    '',
    arenaPrompt(a),
    '',
    '## Negative prompt',
    '',
    NEWART_NEGATIVE_ARENA,
    '',
  ].join('\n'));
}
