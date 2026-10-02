// README / OUTPUT_SPEC / STYLE_GUIDE of the HD asset pack.
import fs from 'node:fs';
import path from 'node:path';
import { SCALE_X, SCALE_Y, SPRITE_PAD, WIDE_EXT, type Excluded } from './catalog';
import type { FighterInfo, SceneInfo } from './prompts';

interface DocJob {
  tier: number;
  kind: string;
  source: string;
  width: number;
  height: number;
}

export interface DocInput {
  jobs: DocJob[];
  excluded: Excluded[];
  context: string;
  style: string;
  negative: string;
  negativeSprite: string;
  fighters: (FighterInfo & { dir: string })[];
  scenes: Record<string, SceneInfo>;
  pilots: string[];
}

function write(out: string, name: string, text: string): void {
  fs.writeFileSync(path.join(out, name), text.replace(/\r?\n/g, '\r\n'));
}

export function writeDocs(out: string, d: DocInput): void {
  const { jobs } = d;
  const row = (tier: number, what: string, filter: (j: DocJob) => boolean) => {
    const js = jobs.filter(filter);
    const mp = js.reduce((a, j) => a + j.width * j.height, 0) / 1e6;
    return `| ${tier} | ${what} | ${js.length} | ${mp < 10 ? mp.toFixed(1) : mp.toFixed(0)} |`;
  };
  const under = (p: string) => (j: DocJob) => j.source.startsWith(p);

  write(out, 'README.md', `# One Must Fall 2097 — HD asset pack

This folder contains every image of the 1994 PC game **One Must Fall 2097** (backgrounds, pilot portraits, fighting
robots, effects, arena and menu animations) together with prompts and exact output requirements. The task: produce a
high-resolution remastered version of each image. The results are imported automatically into a remaster of the game,
so file names, sizes, alignment and transparency must follow **[OUTPUT_SPEC.md](OUTPUT_SPEC.md)** exactly.
Art direction and descriptions are in **[STYLE_GUIDE.md](STYLE_GUIDE.md)**.

## How to process the pack

1. Read \`OUTPUT_SPEC.md\` (hard rules) and \`STYLE_GUIDE.md\` (look and feel).
2. Take the jobs from **\`jobs.jsonl\`** (one JSON object per line) or **\`jobs.csv\`** (same data as a spreadsheet).
   \`manifest.json\` holds the same jobs plus technical metadata for the import; you do not need it.
3. For every job:
   - read \`source\` (and \`guide\` / \`mask\` when present),
   - generate with \`prompt\` and \`negative_prompt\` (the same text, with notes, is in \`prompt_file\`),
   - save the result to \`output\` at exactly \`width\` × \`height\` pixels.
4. Keep jobs with the same \`consistency_group\` visually consistent: same model, settings and seed (e.g. all frames of
   one robot).
5. Work in tier order; every tier is useful on its own.
6. Return the whole folder with the new \`*.hd.png\` files added. Do not rename, move or edit anything else.

| Tier | What | Jobs | Output megapixels |
| --- | --- | ---: | ---: |
${row(1, 'Scene backgrounds (`tier1_backgrounds/*/source.png`)', (j) => j.kind === 'background')}
${row(1, 'Widescreen extensions of the five arenas (`tier1_backgrounds/ARENA*/widescreen/`)', (j) => j.kind === 'background-wide')}
${row(1, 'Pilot portraits (`tier1_portraits/`)', (j) => j.kind === 'portrait')}
${row(2, 'Fighting robots, 11 robots (`tier2_fighters/`)', under('tier2_fighters/'))}
${row(2, 'Effects shared by all robots: debris, explosions (`tier2_effects/`)', under('tier2_effects/'))}
${row(2, 'Arena animations: hazards, announcements, lights (`tier2_arenas/`)', under('tier2_arenas/'))}
${row(3, 'Menus, intro, endings, tournaments, mech lab (`tier3_scenes/`)', under('tier3_scenes/'))}
| | **Total** | **${jobs.length}** | |

Tier 1 has the biggest visual impact per image. Tier 2 is everything seen during fights. Tier 3 covers menus and
cutscenes.

## Three kinds of jobs (\`mode\`)

- **recreate** — backgrounds, portraits and large static scene art. Re-render the picture in high resolution with
  modern detail while keeping the composition locked: use \`guide.png\` (the original enlarged to the target size with
  correct proportions) as the image-to-image input or as a strong reference. Suggested img2img denoise 0.35–0.55.
- **upscale** — animation frames (robots, effects, scene animations). Consistency across frames matters more than new
  detail: use a faithful AI upscaler, or img2img with low denoise (about 0.2–0.35), with the same model, settings and
  seed for the whole \`consistency_group\`. Each animation folder has \`sheet.png\` (all frames in play order) and
  \`sheet_preview.png\` (the same at correct proportions) to check consistency. For image-to-image tools that need an
  input at the output size, \`make_inputs.py\` (Python + Pillow) creates \`*.input.png\` files next to the sources.
- **outpaint** — widescreen arenas: a 2.4:1 canvas with the arena in the middle and transparent sides (white in
  \`mask.png\`). Generate only the sides so they continue the scene seamlessly. Do these after the matching
  background, and paste the finished \`source.hd.png\` into the middle first.

## Folder layout

- \`tier1_backgrounds/<SCENE>/\` — \`source.png\` (original 320×200), \`guide.png\` (1600×1200 input), \`prompt.md\`;
  output \`source.hd.png\`. Arenas also have \`widescreen/\` (\`canvas.png\`, \`mask.png\`, \`prompt.md\`; output \`canvas.hd.png\`).
- \`tier1_portraits/<FILE>_<NN>/\` — \`source.png\`, \`guide.png\`, \`prompt.md\`; output \`source.hd.png\`.
- \`tier2_fighters/<ROBOT>/\` — \`README.md\`, \`reference_sheet.png\` and one folder per move (\`mNN_<name>/\`) with frames
  \`fNNN.png\`, \`sheet.png\`, \`sheet_preview.png\`, \`frames.csv\` and \`prompt.md\`; outputs \`fNNN.hd.png\`.
- \`tier2_effects/<name>/\` — debris, explosions and sparks shared by all robots, same layout.
- \`tier2_arenas/<ARENA>/aNN/\` and \`tier3_scenes/<SCENE>/aNN/\` — scene animations, same layout; \`_SHARED/\` holds images
  used identically by several scenes (e.g. the ROUND / FIGHT / YOU WIN graphics of all five arenas).
- \`reference/robot_color_zones.png\` — the three recolorable color zones of the robots.
- \`make_inputs.py\` — optional helper, see above.

A frame is stored once even if the game uses it in several animations; the \`sheet.png\` files still show every
animation complete, so some folders contain fewer \`fNNN.png\` files than frames on their sheet.

## Not included (on purpose)

Fonts and interface text (rendered by the game), health bars and menus drawn by code, and ${d.excluded.length} items the
game derives from other images or draws as color effects (listed in \`manifest.json\` → \`excluded\`): glow masks, the
credits' text overlays, pieces of backgrounds that are cut from the finished backgrounds on import, and a dimmed copy
of the pilot portraits.

## If something cannot be done

Skip the job and list it in an optional \`NOTES.md\` at the root. Partial deliveries are fine: every finished
\`*.hd.png\` is used, and the game keeps its built-in upscaling for the rest.
`);

  write(out, 'OUTPUT_SPEC.md', `# Output specification (hard requirements)

The remaster imports the results automatically. Please follow these rules exactly.

## 1. Names and locations

- Save each result next to its source, with \`.hd\` inserted before \`.png\`:
  \`source.png\` → \`source.hd.png\`, \`canvas.png\` → \`canvas.hd.png\`, \`f003.png\` → \`f003.hd.png\`.
  The exact path of each output is the \`output\` field of the job.
- Do not modify, move, rename or delete any existing file.

## 2. Size and proportions

- Output size = the job's \`width\` × \`height\`. It is always **${SCALE_X}× the source width and ${SCALE_Y}× the source height**.
- Why not the same factor: the game runs at 320×200 but is displayed at 4:3, so its pixels are 1.2× taller than
  wide. At ${SCALE_X}× / ${SCALE_Y}× the result has square pixels and correct proportions. \`guide.png\`, \`sheet_preview.png\` and
  the \`*.input.png\` files from \`make_inputs.py\` show the correct proportions; \`source.png\`, \`fNNN.png\` and \`sheet.png\`
  look vertically squashed.
- If a tool cannot produce the exact size, deliver any size with the same aspect ratio (within 1%) and at least
  3× the source width; it will be resampled. Never crop, pad or change the aspect ratio.

## 3. Format and transparency

- PNG, 8 bits per channel, sRGB.
- Backgrounds and widescreen canvases: opaque RGB.
- Everything else (portraits, animation frames, effects): **RGBA with real transparency** (straight, not
  premultiplied alpha). Transparent in the source = transparent in the result. Soft, anti-aliased edges are welcome.
- Fallback only if a tool cannot output transparency: a flat pure magenta background (#FF00FF) with no magenta or
  pink tones in the subject.

## 4. Alignment

- The result must line up with the source: scaled down to the source size, every outline, object and horizon must be
  within about one source pixel of its original position. Nothing may move, grow, shrink or get cropped.
- Sprite sources have a ${SPRITE_PAD}-pixel transparent margin (${SPRITE_PAD * SCALE_X} px left/right and ${SPRITE_PAD * SCALE_Y} px top/bottom in the output):
  keep it transparent. Do not add glows, shadows or effects outside the original outline.
- Widescreen canvases: the central ${320 * SCALE_X}×${200 * SCALE_Y} region (x = ${WIDE_EXT * SCALE_X}–${WIDE_EXT * SCALE_X + 320 * SCALE_X}) must stay identical to the
  finished background (\`../source.hd.png\`); only the sides are new.

## 5. Colors

- Keep the colors of every area: same hues, similar brightness. No color grading, filters, tinting or added vignettes.
- **Robot colors:** on the robots (\`tier2_fighters\`), their debris and some menu/cutscene images of robots, the steel
  blue, red and gold areas are recolored by the game (players choose their robot's colors). Keep each of these areas
  in its hue family (blue stays blue, red stays red, gold stays gold) and shade it with lighter and darker tones of the
  same hue; do not mix the three. White, grey, black and effect colors (fire, lightning) are fixed and can be rendered
  freely. See \`reference/robot_color_zones.png\`. Jobs affected have \`recolored_in_game: true\`.

## 6. Content

- No text, letters, numbers, logos, signatures, watermarks, borders or frames, except where the source shows them
  (the game logo, fight announcements, captions, interface boxes): those must be reproduced exactly.
- Do not add objects, characters, debris or effects that are not in the source. Backgrounds stay empty (the robots
  are drawn on top of them).
- Keep the original light direction and mood.

## 7. Consistency

- Jobs with the same \`consistency_group\` must look alike: same design, materials, level of detail and lighting. Use
  the same model, settings and seed for the whole group (e.g. all frames of one robot).
- Portraits of the same pilot (several appear in more than one tournament) should look like the same person.

## 8. Delivery

- Return this folder with the \`*.hd.png\` files added (\`*.input.png\` files can stay or be deleted).
- Optional: \`NOTES.md\` at the root listing skipped or problematic jobs.
`);

  const sceneRows = Object.entries(d.scenes).map(([k, s]) => `| ${k} | ${s.title} | ${s.description} |`).join('\n');
  const fighterRows = d.fighters.map((f) => `| ${f.dir} | ${f.name} | ${f.description} | ${f.specials.join(', ')} |`).join('\n');
  write(out, 'STYLE_GUIDE.md', `# Style guide

## The game

${d.context}

Pilots: ${d.pilots.join(', ')}. Robots: ${d.fighters.map((f) => f.name).join(', ')}.

## Target look

A remaster, not a redesign: imagine the original 1994 artists re-rendering their own scenes and robots with today's
tools and resolution. Everything keeps its design, silhouette, composition, colors and lighting; what changes is
resolution and craft — clean anti-aliased edges, smooth gradients instead of dithering and color banding, crisp
hard-surface detail (panel lines, bolts, joints, cables), believable metal and painted-plastic materials with subtle
wear, soft realistic lighting and reflections. The mood stays 1990s sci-fi arcade: bold, saturated, slightly
theatrical.

Style block used in every prompt:

> ${d.style}

Negative prompt for backgrounds and portraits:

> ${d.negative}

Negative prompt for sprites (frames with transparent background):

> ${d.negativeSprite}

## By category

- **Backgrounds (tier 1).** Painted and pre-rendered environments. Add material detail and depth, keep the layout
  exactly (floor line, walls, horizon, light sources). The five arenas are what players look at most: give them the
  most care. Keep the floor area calm so the robots read clearly in front of it.
- **Widescreen extensions (tier 1).** Continue each arena sideways with the same architecture or landscape and
  perspective. Believable, not mirrored; the far edges may be a little darker and less detailed.
- **Portraits (tier 1).** Painted/rendered faces of pilots. Same person, expression and framing; realistic painted
  detail (skin, hair, fabric), not photographic, not anime. One consistent style for all portraits.
- **Robots (tier 2).** Giant piloted fighting robots, full body, side view, on transparent backgrounds. Render them as
  detailed mechanical models — articulated joints, armor plates, hydraulics, glowing sensors — but keep each robot's
  exact silhouette in every frame. Color zones: steel blue (primary), red (secondary), gold (tertiary) are recolored
  by the game; keep them.
- **Effects (tier 2).** Metal debris, bolts, screws, explosions, sparks, burning oil, projectiles: crisp and
  energetic, same shape and colors.
- **Arena animations (tier 2).** Hazards (spikes, fireballs, fighter jets), fight announcements (chrome lettering),
  lights and dust. Match the finished arena backgrounds.
- **Scene animations (tier 3).** Menu elements, logos, cutscene characters and robots, tournament intros. Match the
  finished background of the same scene; keep the frames of one animation consistent.

## Scenes

| Scene | Title | Description |
| --- | --- | --- |
${sceneRows}

## Robots

| Folder | Robot | Description | Special moves |
| --- | --- | --- | --- |
${fighterRows}
`);
}
