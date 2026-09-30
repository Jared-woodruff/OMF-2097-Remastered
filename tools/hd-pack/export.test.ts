// Generates the HD asset pack: source images of every visual asset of the original game, guides, prompts and a
// manifest, for an image generation / upscaling AI. Run with `npm run hd:export` (sets OMF_HDPACK_OUT).
import { it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { GAMEDATA_DIR, hasGameData, loadGameData } from '../../src/test/harness';
import { langGet } from '../../src/resources/resources';
import { ALL_HAR_NAMES, buildCatalog, FIGHTER_RAMPS, HAR_NAMES, SCALE_X, SCALE_Y, SPRITE_PAD, WIDE_EXT, type AnimGroup, type ImageItem, type Recolor } from './catalog';
import { blit, encodePng, fill, indexedToRgba, newImage, pad, resizeCubic, scaleNearest, type Rgba } from './image';
import { describeMove, FIGHTERS, GAME_CONTEXT, NEGATIVE, NEGATIVE_BG_UI, NEGATIVE_SPRITE, SCENES, STYLE } from './prompts';
import { animNote, NEGATIVE_TEXT_SPRITE } from './notes';
import { writeDocs } from './docs';
import { deliveredRefusal } from './delivered.mjs';
import {
  ARENA_H, ARENA_W, arenaPrompt, designPrompt, effectPrompt, framePrompt, NEW_ARENAS, NEW_ROBOT_FILES, NEW_ROBOTS,
  NEWART_NEGATIVE_ARENA, NEWART_NEGATIVE_ROBOT, writeArenaPrompt, writeNewArtDocs,
} from './newart';

const OUT = process.env.OMF_HDPACK_OUT;
/** The new-art pack (`npm run newart:export`): only the remaster's robots, redrawn with new detail, and its arenas. */
const NEWART = process.env.OMF_HDPACK_NEWART === '1';
/** `-- --force`: empty the output folder even when it holds delivered paintings (*.hd.png). */
const FORCE = process.env.OMF_HDPACK_FORCE === '1';
const NEW_FILES = new Set(Object.values(NEW_ROBOT_FILES));

type Mode = 'recreate' | 'upscale' | 'outpaint' | 'design' | 'redraw';

export interface Job {
  id: string;
  tier: number;
  kind: string;
  title: string;
  source: string;
  guide: string | null;
  mask: string | null;
  output: string;
  width: number;
  height: number;
  transparent: boolean;
  mode: Mode;
  prompt: string;
  negativePrompt: string;
  promptFile: string;
  /** Animation folder (sheet + prompt) the frame belongs to. */
  group: string | null;
  /** Jobs that must look alike: process them with the same model, settings and seed. */
  consistencyGroup: string;
  frameIndex: number | null;
  frameCount: number | null;
  native: { w: number; h: number; posX: number; posY: number; pad: number };
  recolor: Recolor;
  hash: string;
  usages: { file: string; anim: number; sprite: number; key: string }[];
  bgOverlay?: { x: number; y: number; w: number; h: number; match: number };
}

const rel = (...p: string[]) => path.posix.join(...p);

function writePng(relPath: string, img: Rgba, opaque = false): void {
  const p = path.join(OUT!, relPath);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, encodePng(img, opaque));
}

function writeText(relPath: string, text: string): void {
  const p = path.join(OUT!, relPath);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text.replace(/\r?\n/g, '\r\n'));
}

function itemImage(item: ImageItem): Rgba {
  return indexedToRgba(item.w, item.h, item.pixels, item.palette, item.transparent);
}

/** Aspect-correct guide at the job's target size (square pixels, 4:3 like the game's display). */
function guideFor(img: Rgba): Rgba {
  return resizeCubic(img, img.w * SCALE_X, img.h * SCALE_Y);
}

const MODE_TEXT: Record<Mode, string> = {
  upscale: 'faithful upscale — low creativity (img2img denoise ≈ 0.2–0.35 or a dedicated AI upscaler)',
  recreate: 're-create in high resolution — medium creativity, composition locked (img2img denoise ≈ 0.35–0.55 or reference-guided generation)',
  outpaint: 'outpaint the masked sides only',
  design: 'design — high creativity for detail, silhouette and color zones locked (img2img denoise ≈ 0.6–0.75 from `guide.png`, or reference-guided generation)',
  redraw: 'redraw with new detail — pose, silhouette and color zones locked (img2img denoise ≈ 0.45–0.6 from the enlarged source with the design sheet as reference image, or reference-guided generation)',
};

const SPRITE_OUTPUT = 'one `fNNN.hd.png` next to each `fNNN.png` in this folder (exact sizes in `frames.csv`), PNG with transparent background';

function promptDoc(title: string, outputLine: string, mode: Mode, prompt: string, negative: string, notes: string[]): string {
  return [
    `# ${title}`,
    '',
    `- **Output:** ${outputLine}`,
    `- **Mode:** ${MODE_TEXT[mode]}`,
    '',
    '## Prompt',
    '',
    prompt,
    '',
    '## Negative prompt',
    '',
    negative,
    '',
    '## Notes',
    '',
    ...notes.map((n) => `- ${n}`),
    '',
  ].join('\n');
}

/** Contact sheet of an animation, frames aligned with their in-game offsets, in play order (row-major). */
function animationSheet(group: AnimGroup): Rgba {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const f of group.frames) {
    minX = Math.min(minX, f.posX);
    minY = Math.min(minY, f.posY);
    maxX = Math.max(maxX, f.posX + f.item.w);
    maxY = Math.max(maxY, f.posY + f.item.h);
  }
  const gap = 4;
  const cellW = maxX - minX + gap, cellH = maxY - minY + gap;
  const cols = Math.max(1, Math.min(group.frames.length, Math.floor(1600 / cellW), 10));
  const rows = Math.ceil(group.frames.length / cols);
  const sheet = newImage(cols * cellW + gap, rows * cellH + gap);
  group.frames.forEach((f, i) => {
    const cx = (i % cols) * cellW + gap, cy = Math.floor(i / cols) * cellH + gap;
    blit(sheet, itemImage(f.item), cx + f.posX - minX, cy + f.posY - minY);
  });
  return sheet;
}

const hdRect = (r: { x: number; y: number; w: number; h: number }) =>
  `x ${r.x * SCALE_X}–${(r.x + r.w) * SCALE_X}, y ${r.y * SCALE_Y}–${(r.y + r.h) * SCALE_Y}`;

it.skipIf(!hasGameData || !OUT)('export HD asset pack', () => {
  // Not over delivered paintings: they would be deleted just below (the run scripts check it first, this is for a
  // direct run).
  const refusal = FORCE ? null : deliveredRefusal(OUT!, NEWART ? 'newart:export' : 'hd:export');
  if (refusal) throw new Error(refusal);
  loadGameData();
  // Empty the output folder (its contents only: on Windows the folder itself may be another process's working directory).
  fs.mkdirSync(OUT!, { recursive: true });
  for (const e of fs.readdirSync(OUT!)) fs.rmSync(path.join(OUT!, e), { recursive: true, force: true });
  const cat = buildCatalog(GAMEDATA_DIR);
  const jobs: Job[] = [];

  // ---- Tier 1: backgrounds (+ widescreen extensions of the arenas) -------------------------------------------
  const arenaNames = ['ARENA0', 'ARENA1', 'ARENA2', 'ARENA3', 'ARENA4'];
  for (const { item, name } of NEWART ? [] : cat.backgrounds) {
    const info = SCENES[name] ?? { title: name, description: `Background of the ${name} scene.` };
    const img = itemImage(item);
    writePng(rel(item.dir, 'source.png'), img, true);
    const guide = guideFor(img);
    writePng(rel(item.dir, 'guide.png'), guide, true);
    const bgNegative = info.bgUi ? NEGATIVE_BG_UI : NEGATIVE;
    const prompt = `${info.description} Background plate: no fighters and no extra characters. ${info.bgUi ? 'Keep the interface boxes and lettering of the source exactly. ' : ''}${STYLE}`;
    const animRoot = arenaNames.includes(name) ? 'tier2_arenas' : 'tier3_scenes';
    const patches = cat.excluded.filter((e) => e.file === item.file && e.backgroundRegion);
    const job: Job = {
      id: item.id, tier: 1, kind: 'background', title: info.title, source: rel(item.dir, 'source.png'),
      guide: rel(item.dir, 'guide.png'), mask: null, output: rel(item.dir, 'source.hd.png'),
      width: guide.w, height: guide.h, transparent: false, mode: 'recreate', prompt, negativePrompt: bgNegative,
      promptFile: rel(item.dir, 'prompt.md'), group: null, consistencyGroup: item.id, frameIndex: null, frameCount: null,
      native: { w: item.w, h: item.h, posX: 0, posY: 0, pad: 0 }, recolor: 'none', hash: item.hash, usages: item.usages,
    };
    writeText(job.promptFile, promptDoc(`${info.title} — background (${item.file})`,
      `\`source.hd.png\` — ${guide.w} × ${guide.h} px, opaque PNG`, 'recreate', prompt, bgNegative, [
        ...(info.bgNotes ?? []),
        'Keep every structure, horizon and object exactly where it is: the result must line up with `guide.png` (same size).',
        '`source.png` is the original 320×200 image; on screen its pixels are 1.2× taller than wide, so take proportions from `guide.png`.',
        ...(arenaNames.includes(name) ? ['Robots fight in front of this background: keep the floor area readable and uncluttered; do not add people or robots.'] : []),
        `Animated parts of the scene (lights, flames, hazards, characters...) are separate sprites in \`${animRoot}/${name}/\` drawn on top of this plate; where they cover it, keep the plate as in the source.`,
        ...(patches.length ? [`The game also cuts ${patches.length} piece(s) out of this background to draw them in front of the fighters (${patches.map((p) => hdRect(p.backgroundRegion!)).join('; ')} in output pixels): keep those areas clean and consistent with their surroundings.`] : []),
      ]));
    jobs.push(job);

    if (arenaNames.includes(name)) {
      // Widescreen: the original (as its guide) in the center of a 2.4:1 canvas; sides to be generated.
      const W = (item.w + WIDE_EXT * 2) * SCALE_X, H = item.h * SCALE_Y;
      const canvas = newImage(W, H);
      blit(canvas, guide, WIDE_EXT * SCALE_X, 0);
      const mask = newImage(W, H);
      fill(mask, 255, 255, 255, 255);
      const keep = newImage(guide.w, guide.h);
      fill(keep, 0, 0, 0, 255);
      blit(mask, keep, WIDE_EXT * SCALE_X, 0);
      const dir = rel(item.dir, 'widescreen');
      writePng(rel(dir, 'canvas.png'), canvas);
      writePng(rel(dir, 'mask.png'), mask, true);
      const wprompt = `Wide panoramic version of the same scene: ${info.description} The scene continues naturally to the left and right with the same architecture or landscape, same perspective and horizon, same lighting and materials. ${STYLE}`;
      const wneg = `${NEGATIVE}, mirrored copy, symmetric duplicate, repeated pattern, visible seam, visible border`;
      const wjob: Job = {
        id: `bgwide/${name}`, tier: 1, kind: 'background-wide', title: `${info.title} (widescreen)`,
        source: rel(dir, 'canvas.png'), guide: null, mask: rel(dir, 'mask.png'), output: rel(dir, 'canvas.hd.png'),
        width: W, height: H, transparent: false, mode: 'outpaint', prompt: wprompt, negativePrompt: wneg,
        promptFile: rel(dir, 'prompt.md'), group: null, consistencyGroup: item.id, frameIndex: null, frameCount: null,
        native: { w: item.w + WIDE_EXT * 2, h: item.h, posX: -WIDE_EXT, posY: 0, pad: 0 }, recolor: 'none', hash: item.hash,
        usages: item.usages.map((u) => ({ ...u, key: `${u.key}#ext` })),
      };
      writeText(wjob.promptFile, promptDoc(`${info.title} — widescreen extension`,
        `\`canvas.hd.png\` — ${W} × ${H} px, opaque PNG`, 'outpaint', wprompt, wneg, [
          `Canvas ${W}×${H}: the center ${guide.w}×${guide.h} (x = ${WIDE_EXT * SCALE_X} to ${WIDE_EXT * SCALE_X + guide.w}) is the scene; the transparent sides (white in \`mask.png\`) must be generated.`,
          'Do this after the background: paste the finished `../source.hd.png` into the center of the canvas, then outpaint the sides around it. The center must stay identical to `../source.hd.png`.',
          'The sides must blend seamlessly into the center: same floor line, horizon, perspective and lighting.',
          'On 16:9 screens only about the inner 40% of each side is visible; the outer parts show on ultrawide monitors.',
          'Invent a believable continuation (more wall panels, stands, dunes, machinery...) — do not mirror the existing scene.',
        ]));
      jobs.push(wjob);
    }
  }

  // ---- Tier 1: portraits -------------------------------------------------------------------------------------
  for (const item of cat.items.filter((i) => !NEWART && i.kind === 'portrait')) {
    const img = itemImage(item);
    writePng(rel(item.dir, 'source.png'), img);
    const guide = guideFor(img);
    writePng(rel(item.dir, 'guide.png'), guide);
    const who = item.file === 'PLAYERS.PIC'
      ? 'a tournament pilot (a portrait players can choose for their own character)'
      : `a tournament opponent pilot (${SCENES[item.file.replace('.PIC', '')]?.title.replace('Tournament: ', '') ?? item.file} tournament)`;
    const prompt = `Head-and-shoulders portrait of ${who} from One Must Fall 2097: the same person — identical face, ` +
      'hairstyle, age, expression, clothing, head angle, framing and lighting as the source — rendered as a detailed, ' +
      'realistic high-resolution digital painting in the style of 1990s sci-fi game character art. Transparent pixels ' +
      `of the source stay transparent. ${STYLE}`;
    const job: Job = {
      id: item.id, tier: 1, kind: 'portrait', title: `Portrait ${item.file} #${item.frame}`, source: rel(item.dir, 'source.png'),
      guide: rel(item.dir, 'guide.png'), mask: null, output: rel(item.dir, 'source.hd.png'), width: guide.w, height: guide.h,
      transparent: true, mode: 'recreate', prompt, negativePrompt: NEGATIVE, promptFile: rel(item.dir, 'prompt.md'),
      group: null, consistencyGroup: 'portraits', frameIndex: null, frameCount: null,
      native: { w: item.w, h: item.h, posX: item.posX, posY: item.posY, pad: 0 }, recolor: 'none', hash: item.hash, usages: item.usages,
    };
    writeText(job.promptFile, promptDoc(job.title, `\`source.hd.png\` — ${guide.w} × ${guide.h} px, PNG with transparency`,
      'recreate', prompt, NEGATIVE, [
        'Keep the exact silhouette and framing: it replaces the original inside the same frame on screen.',
        'Keep the clothing and hair colors.',
        'All portraits should share one consistent painting style.',
        item.usages.length > 1 ? `Also used as: ${item.usages.slice(1).map((u) => `${u.file} #${u.sprite}`).join(', ')}.` : 'Used once.',
      ]));
    jobs.push(job);
  }

  // ---- Tier 2 (fighters, effects, arena animations) / tier 3 (other scenes): animation frames -----------------
  const written = new Set<string>();
  type Shared = { title: string; prompt: string; negative: string; mode: Mode; notes: string[]; list: { item: ImageItem; job: Job }[] };
  const sharedFolders = new Map<string, Shared>();
  const fighterRefs = new Map<string, { order: number; img: Rgba }[]>();
  const REF_ORDER = [11, 10, 1, 4, 48];
  for (const g of cat.groups) {
    if (NEWART && !NEW_FILES.has(g.file)) continue;
    const sheet = animationSheet(g);
    writePng(rel(g.dir, 'sheet.png'), sheet);
    writePng(rel(g.dir, 'sheet_preview.png'), resizeCubic(sheet, Math.round((sheet.w * SCALE_X) / 2), Math.round((sheet.h * SCALE_Y) / 2)));
    const n = g.frames.length;
    let title: string, groupPrompt: string, mode: Mode, consistency: string;
    let negative = NEGATIVE_SPRITE;
    let what = '', rest = '';
    const notes: string[] = [];
    const effectAnim = g.kind === 'fighter' && ([7, 8, 12, 13, 14, 55, 56, 57].includes(g.anim) || g.name.includes('_projectile'));
    if (effectAnim) {
      const har = ALL_HAR_NAMES[Number(g.file.replace(/\D/g, ''))];
      const info = FIGHTERS[har];
      const move = describeMove(g.name);
      const projectile = g.name.includes('_projectile');
      title = `${info.name} — ${projectile ? 'projectile' : move} (${g.file} move ${g.anim})`;
      groupPrompt = (projectile
        ? `A projectile or special-move effect fired by ${info.name} (${info.description}) in the robot fighting game One Must Fall 2097 — energy blast, fireball, missile, grenade, lightning or a detached robot part, exactly as shown in the source frame.`
        : `Visual effect sprite from the robot fighting game One Must Fall 2097: ${move}.`) +
        ` Isolated on a transparent background, same shape, size and colors as the source, crisp detailed high-resolution render. ${STYLE}`;
      mode = 'upscale';
      consistency = g.dir;
      notes.push(
        `${n} frame(s) in play order: see \`sheet.png\` (native) and \`sheet_preview.png\` (correct proportions). Keep all frames consistent (same model, settings and seed).`,
        'Parts in steel blue / red / gold are robot colors that the game recolors: keep them in the same hue families.',
        `Sources have a transparent margin of ${SPRITE_PAD} native pixels; keep it transparent.`,
      );
    } else if (g.kind === 'fighter') {
      const har = ALL_HAR_NAMES[Number(g.file.replace(/\D/g, ''))];
      const info = FIGHTERS[har];
      const move = describeMove(g.name);
      title = `${info.name} — ${move} (${g.file} move ${g.anim})`;
      groupPrompt = `${info.name}, ${info.description}, from the robot fighting game One Must Fall 2097. Animation: ${move}. ` +
        'Full-body side view exactly as in the source frame, same pose and facing direction, isolated on a transparent ' +
        'background. Color zones exactly as in the source: steel blue (primary armor), red (secondary), gold (tertiary), ' +
        `plus the original fixed colors (white, grey, black and effect colors). ${STYLE}`;
      mode = 'upscale';
      consistency = `tier2_fighters/${har}`;
      notes.push(
        `${n} frame(s) in play order: see \`sheet.png\` (native) and \`sheet_preview.png\` (correct proportions). Every frame must show the same machine — process all frames of this robot with the same model, settings and seed; see \`../reference_sheet.png\`.`,
        'The robot is recolored in game (players pick its colors): keep the blue / red / gold zones exactly where they are, in the same hue families, shaded with lighter and darker tones of the same hue.',
        `Sources have a transparent margin of ${SPRITE_PAD} native pixels; keep it transparent and keep the robot inside its original outline.`,
      );
      const order = REF_ORDER.indexOf(g.anim);
      if (order >= 0) {
        if (!fighterRefs.has(har)) fighterRefs.set(har, []);
        fighterRefs.get(har)!.push({ order, img: guideFor(itemImage(g.frames[Math.floor((n - 1) / 2)].item)) });
      }
    } else {
      const scene = g.file.replace('.BK', '');
      const info = SCENES[scene] ?? { title: scene, description: '' };
      const note = animNote(scene, g.anim);
      title = `${info.title} — animation ${g.anim}${note ? `: ${note.desc}` : ''} (${g.file})`;
      what = note ? `This image shows ${note.desc}.` : 'This is one animated element of the scene.';
      rest = 'Re-render it exactly as shown in the source frame, isolated on a transparent background (transparent pixels stay transparent).' +
        `${note?.text ? ' Reproduce the lettering exactly as in the source: same words, letter shapes and layout.' : ''} ${STYLE}`;
      groupPrompt = `${what} It belongs to the scene "${info.title}" of the robot fighting game One Must Fall 2097 ` +
        `(${info.description.replace(/\.$/, '')}). ${rest}`;
      if (note?.text) negative = NEGATIVE_TEXT_SPRITE;
      mode = n <= 2 && g.frames[0].item.w * g.frames[0].item.h > 2500 ? 'recreate' : 'upscale';
      consistency = g.dir;
      if (g.frames.some((f) => f.item.recolor !== 'none')) {
        notes.push("Robot colors: the steel blue / red / gold areas are the player's robot colors and are recolored by the game — keep them in the same places and hue families.");
      }
      const overlays = g.frames.map((f) => f.item.bgOverlay).filter((o) => o !== undefined);
      const overlay = overlays.length ? overlays.reduce((u, o) => {
        const x = Math.min(u.x, o.x), y = Math.min(u.y, o.y);
        return { x, y, w: Math.max(u.x + u.w, o.x + o.w) - x, h: Math.max(u.y + u.h, o.y + o.h) - y, match: Math.min(u.match, o.match) };
      }) : null;
      if (overlay) {
        notes.push(`This animation replaces part of the background (the area ${hdRect(overlay)} of \`tier1_backgrounds/${scene}/guide.png\`) with alternative states. Make it match the finished \`tier1_backgrounds/${scene}/source.hd.png\` exactly: best done by cropping that area of the finished background and editing it to match each frame.`);
      }
      if (scene === 'MELEE' && g.anim === 1) {
        notes.push('The black background of each cell is keyed out by the game (the selection highlight shows through): keep it perfectly flat, uniform black.');
      }
      notes.push(
        `${n} frame(s) in play order: see \`sheet.png\` (native) and \`sheet_preview.png\` (correct proportions). Keep all frames consistent (same model, settings and seed).`,
        'Drawn on top of the scene background at a fixed position: keep the outline and the position inside the frame.',
        `Sources have a transparent margin of ${SPRITE_PAD} native pixels; keep it transparent.`,
      );
      if (fs.existsSync(path.join(OUT!, 'tier1_backgrounds', scene))) notes.push(`Matching background: \`tier1_backgrounds/${scene}/guide.png\`.`);
    }
    if (NEWART && g.kind === 'fighter') {
      // The remaster's robots: every frame redrawn with new detail, from the robot's design sheet.
      const har = ALL_HAR_NAMES[Number(g.file.replace(/\D/g, ''))];
      const move = describeMove(g.name);
      groupPrompt = effectAnim ? effectPrompt(har, g.name.includes('_projectile') ? 'its projectile' : move) : framePrompt(har, move);
      negative = NEWART_NEGATIVE_ROBOT;
      mode = effectAnim ? 'recreate' : 'redraw';
      notes.length = 0;
      notes.push(
        `${n} frame(s) in play order: see \`sheet.png\` (native) and \`sheet_preview.png\` (correct proportions).`,
        effectAnim
          ? 'Keep the shape, size, position and colors of each source frame; add detail and glow.'
          : `Every frame is the robot of \`../design/design.hd.png\`: same parts, panel layout, materials and details. Process all frames of ${NEW_ROBOTS[har].name} with the same model, settings and seed, with the design sheet as reference image.`,
        'The game recolors the steel blue / red / gold zones (players pick the colors): keep them exactly where the source has them, in their hue families.',
        `Stay inside the source's outline (enlarged): it has a transparent margin of ${SPRITE_PAD} native pixels; keep it transparent.`,
      );
    }
    if (/(^|[-a-z])bt/.test(g.animString)) notes.push('In game these frames are also drawn as translucent "shadow" copies of the robot — nothing special to do.');

    const frameRows = ['frame_in_animation,source,output,width,height'];
    let ownFrames = 0;
    g.frames.forEach((f, i) => {
      const item = f.item;
      if (written.has(item.id)) return;
      written.add(item.id);
      const img = pad(itemImage(item), SPRITE_PAD);
      const src = rel(item.dir, `${item.stem}.png`);
      writePng(src, img);
      const W = img.w * SCALE_X, H = img.h * SCALE_Y;
      const job: Job = {
        id: item.id, tier: item.tier, kind: item.kind, title, source: src, guide: null, mask: null,
        output: rel(item.dir, `${item.stem}.hd.png`), width: W, height: H, transparent: true, mode,
        prompt: `${groupPrompt}${n > 1 ? ` Frame ${i + 1} of ${n}.` : ''}`, negativePrompt: negative, promptFile: rel(g.dir, 'prompt.md'),
        group: g.dir, consistencyGroup: consistency, frameIndex: i, frameCount: n,
        native: { w: item.w, h: item.h, posX: item.posX, posY: item.posY, pad: SPRITE_PAD },
        recolor: item.recolor, hash: item.hash, usages: item.usages, bgOverlay: item.bgOverlay,
      };
      jobs.push(job);
      if (item.dir !== g.dir) {
        // Shared image (effects of all robots, graphics of several scenes): generated once in its own folder.
        let sf = sharedFolders.get(item.dir);
        if (!sf) {
          const isEffect = item.kind === 'effect';
          const effectWhat = describeMove(item.dir.split('/').pop()!.replace(/^m\d+_/, ''));
          const context = item.dir.startsWith('tier2_arenas/')
            ? 'It is used in all five arenas of the robot fighting game One Must Fall 2097.'
            : 'It is used in several scenes of the robot fighting game One Must Fall 2097.';
          sf = isEffect
            ? {
              title: `Shared effect — ${effectWhat}`,
              prompt: `Visual effect sprite from the robot fighting game One Must Fall 2097: ${effectWhat} (flying metal debris, sparks, explosions or burning oil), isolated on a transparent background, same shape, size and colors as the source, crisp detailed high-resolution render. ${STYLE}`,
              negative: NEGATIVE_SPRITE, mode: 'upscale',
              notes: ['Used by every robot (debris, explosions, sparks, oil). Keep colors and outline; transparent background.',
                'Debris pieces show the robot colors (steel blue / red / gold) which the game recolors: keep them in the same hue families.'],
              list: [],
            }
            : {
              title: title.replace(/ \([A-Z0-9_]+\.BK\)$/, '').replace(/^[^—]+— /, item.dir.startsWith('tier2_arenas/') ? 'All five arenas — ' : 'Several scenes — '),
              prompt: `${what} ${context} ${rest}`, negative, mode, notes: [], list: [],
            };
          sharedFolders.set(item.dir, sf);
        }
        sf.list.push({ item, job });
      } else {
        ownFrames++;
        frameRows.push(`${i},${item.stem}.png,${item.stem}.hd.png,${W},${H}`);
      }
    });
    if (ownFrames < n) {
      notes.push(`${n - ownFrames} frame(s) of this animation are shared with other animations and stored once elsewhere (see \`manifest.json\`); only the \`fNNN.png\` files in this folder need processing here.`);
    }
    if (ownFrames > 0) {
      writeText(rel(g.dir, 'prompt.md'), promptDoc(title, SPRITE_OUTPUT, mode, groupPrompt, negative, notes));
      writeText(rel(g.dir, 'frames.csv'), frameRows.join('\n') + '\n');
    } else {
      writeText(rel(g.dir, 'prompt.md'), `# ${title}\n\nAll frames of this animation are stored in shared folders (see \`manifest.json\`). Nothing to process here; \`sheet.png\` is for reference.\n`);
    }
  }

  // Shared folders: own prompt, frame list and sheets.
  for (const [dir, sf] of sharedFolders) {
    const pseudo: AnimGroup = {
      kind: 'scene', tier: 2, dir, file: '', anim: -1, name: dir, animString: '',
      frames: sf.list.map(({ item }) => ({ item, posX: item.posX, posY: item.posY })),
    };
    const sheet = animationSheet(pseudo);
    writePng(rel(dir, 'sheet.png'), sheet);
    writePng(rel(dir, 'sheet_preview.png'), resizeCubic(sheet, Math.round((sheet.w * SCALE_X) / 2), Math.round((sheet.h * SCALE_Y) / 2)));
    const users = [...new Set(sf.list.flatMap(({ item }) => item.usages.map((u) => u.file)))];
    writeText(rel(dir, 'prompt.md'), promptDoc(sf.title, SPRITE_OUTPUT, sf.mode, sf.prompt, sf.negative, [
      ...sf.notes,
      `${sf.list.length} image(s): see \`sheet.png\` (native) and \`sheet_preview.png\` (correct proportions). Keep them consistent (same model, settings and seed).`,
      `Used by: ${users.join(', ')} — generated once here.`,
      `Sources have a transparent margin of ${SPRITE_PAD} native pixels; keep it transparent.`,
    ]));
    const rows = ['source,output,width,height'];
    for (const { item, job } of sf.list) {
      job.prompt = `${sf.prompt}${job.frameCount && job.frameCount > 1 ? ` Frame ${(job.frameIndex ?? 0) + 1} of ${job.frameCount}.` : ''}`;
      job.negativePrompt = sf.negative;
      job.promptFile = rel(dir, 'prompt.md');
      job.group = dir;
      job.consistencyGroup = dir;
      rows.push(`${item.stem}.png,${item.stem}.hd.png,${job.width},${job.height}`);
    }
    writeText(rel(dir, 'frames.csv'), rows.join('\n') + '\n');
  }

  // ---- Fighter reference sheets + per-fighter README ---------------------------------------------------------
  ALL_HAR_NAMES.forEach((har, h) => {
    // (the remaster's robots only when their fighter files were generated; only they in the new-art pack)
    if (!cat.groups.some((g) => g.kind === 'fighter' && g.file === `FIGHTR${h}.AF`)) return;
    if (NEWART && !NEW_ROBOT_FILES[har]) return;
    const info = FIGHTERS[har];
    const refs = (fighterRefs.get(har) ?? []).sort((a, b) => a.order - b.order).map((r) => r.img);
    if (refs.length) {
      const gap = 24;
      const W = refs.reduce((a, r) => a + r.w + gap, gap), H = Math.max(...refs.map((r) => r.h)) + gap * 2;
      const sheet = newImage(W, H);
      let x = gap;
      for (const r of refs) {
        blit(sheet, r, x, H - gap - r.h);
        x += r.w + gap;
      }
      writePng(rel('tier2_fighters', har, 'reference_sheet.png'), sheet);
    }
    const moves = cat.groups.filter((g) => g.kind === 'fighter' && g.file === `FIGHTR${h}.AF`).length;
    const frames = jobs.filter((j) => j.source.startsWith(`tier2_fighters/${har}/`)).length;
    if (NEWART) {
      // The design sheet: the fighting stance (the idle animation's middle frame) at twice the frame scale.
      const idle = cat.groups.find((g) => g.kind === 'fighter' && g.file === `FIGHTR${h}.AF` && g.anim === 11)!;
      const f = idle.frames[Math.floor((idle.frames.length - 1) / 2)];
      const src = pad(itemImage(f.item), SPRITE_PAD);
      const dir = rel('tier2_fighters', har, 'design');
      writePng(rel(dir, 'source.png'), src);
      const guide = resizeCubic(src, src.w * SCALE_X * 2, src.h * SCALE_Y * 2);
      writePng(rel(dir, 'guide.png'), guide);
      const r = NEW_ROBOTS[har];
      const job: Job = {
        id: `design/${har}`, tier: 2, kind: 'design', title: `${r.name} — design sheet`, source: rel(dir, 'source.png'),
        guide: rel(dir, 'guide.png'), mask: null, output: rel(dir, 'design.hd.png'), width: guide.w, height: guide.h,
        transparent: true, mode: 'design', prompt: designPrompt(har), negativePrompt: NEWART_NEGATIVE_ROBOT, promptFile: rel(dir, 'prompt.md'),
        group: null, consistencyGroup: `tier2_fighters/${har}`, frameIndex: null, frameCount: null,
        native: { w: f.item.w, h: f.item.h, posX: f.item.posX, posY: f.item.posY, pad: SPRITE_PAD }, recolor: f.item.recolor,
        hash: f.item.hash, usages: [],
      };
      writeText(job.promptFile, promptDoc(job.title, `\`design.hd.png\` — ${guide.w} × ${guide.h} px, PNG with transparency`, 'design',
        job.prompt, job.negativePrompt, [
          `Do this before the frames: it fixes ${r.name}'s detailed look, and every frame is redrawn from it.`,
          '`guide.png` is the source enlarged to the output size (the pose and silhouette to keep); `../reference_sheet.png` shows the key poses.',
          'Keep the silhouette, the pose, the facing direction and the color zones; everything else is yours to detail.',
          "Not used in the game: a reference for the frames (and for the game's author to approve).",
        ]));
      jobs.push(job);
      writeText(rel('tier2_fighters', har, 'README.md'), [
        `# ${r.name} (FIGHTR${h}.AF)`,
        '',
        r.concept,
        '',
        `Special moves: ${info.specials.join(', ')}.`,
        '',
        '1. `design/`: the design sheet (`design.hd.png`), first.',
        `2. ${moves} animations, ${frames} frames: each move folder has its own \`prompt.md\`, \`sheet.png\`, \`sheet_preview.png\` and \`frames.csv\`. Redraw every frame as the robot of the design sheet.`,
        '',
        `- Steel blue: ${r.zones.blue}. Red: ${r.zones.red}. Gold: ${r.zones.gold}. White, grey, black and effect colors are fixed.`,
        '- `reference_sheet.png`: key poses at the correct proportions (idle, walk, jump, crouch, victory).',
        '- Consistency: every frame the same machine, the same model, settings and seed for the whole robot.',
        '',
      ].join('\n'));
      return;
    }
    writeText(rel('tier2_fighters', har, 'README.md'), [
      `# ${info.name} (FIGHTR${h}.AF)`,
      '',
      `${info.name} is ${info.description}.`,
      '',
      `Special moves: ${info.specials.join(', ')}.`,
      '',
      `- ${moves} animations, ${frames} unique frames to process; each move folder has its own \`prompt.md\`, \`sheet.png\`, \`sheet_preview.png\` and \`frames.csv\`.`,
      "- `reference_sheet.png`: key poses at the correct proportions (idle, walk, jump, crouch, victory). Lock the robot's look with it before processing frames.",
      '- Colors: steel blue = primary armor, red = secondary, gold = tertiary (players recolor these zones in game); white/grey/black and effect colors are fixed.',
      '- Consistency matters more than extra detail: every frame must look like the same machine. Process all frames of this robot with the same model, settings and seed.',
      '',
    ].join('\n'));
  });

  // ---- The new-art pack's arenas, docs and job order -----------------------------------------------------------
  if (NEWART) {
    for (const a of NEW_ARENAS) {
      // (guide.png and layout.png: tools/newart/prepare.py, from the arena's current painting)
      jobs.push({
        id: `arena/${a.dir}`, tier: 1, kind: 'arena', title: `${a.title} (${a.file})`, source: rel('arenas', a.dir, 'guide.png'),
        guide: rel('arenas', a.dir, 'guide.png'), mask: null, output: rel('arenas', a.dir, 'arena.hd.png'), width: ARENA_W, height: ARENA_H,
        transparent: false, mode: 'recreate', prompt: arenaPrompt(a), negativePrompt: NEWART_NEGATIVE_ARENA, promptFile: rel('arenas', a.dir, 'prompt.md'),
        group: null, consistencyGroup: 'arenas', frameIndex: null, frameCount: null,
        native: { w: 576, h: 200, posX: -128, posY: 0, pad: 0 }, recolor: 'none', hash: '', usages: [],
      });
      writeArenaPrompt(OUT!, a);
    }
    const rank = (j: Job) => (j.kind === 'arena' ? 0 : j.kind === 'design' ? 1 : 2);
    jobs.sort((a, b) => rank(a) - rank(b));
    const frames = Object.fromEntries(Object.keys(NEW_ROBOT_FILES).map((h) => [h, jobs.filter((j) => j.source.startsWith(`tier2_fighters/${h}/m`)).length]));
    const px = jobs.filter((j) => j.kind === 'fighter').reduce((a, j) => a + j.width * j.height, 0);
    writeNewArtDocs(OUT!, { frames, frameMegapixels: px / 1e6 });
  }

  // ---- Docs, manifest, job lists -----------------------------------------------------------------------------
  if (!NEWART) writeDocs(OUT!, {
    jobs, excluded: cat.excluded, context: GAME_CONTEXT, style: STYLE, negative: NEGATIVE,
    negativeSprite: NEGATIVE_SPRITE, fighters: ALL_HAR_NAMES.filter((h, id) => cat.groups.some((g) => g.kind === 'fighter' && g.file === `FIGHTR${id}.AF`)).map((h) => ({ dir: h, ...FIGHTERS[h] })),
    scenes: SCENES, pilots: Array.from({ length: 11 }, (_, i) => langGet(20 + i)),
  });
  const tierCounts = [1, 2, 3].map((t) => jobs.filter((j) => j.tier === t).length);
  const manifest = {
    format: 'omf2097-hd-asset-pack',
    version: 1,
    pack: NEWART ? 'new-art' : 'originals',
    generated: new Date().toISOString().slice(0, 10),
    game: 'One Must Fall 2097',
    scale: { x: SCALE_X, y: SCALE_Y, note: 'native pixels are 1.2x taller than wide (320x200 shown at 4:3); outputs use square pixels at 5x wide, 6x tall' },
    spritePad: SPRITE_PAD,
    wideExtension: WIDE_EXT,
    fighterReferenceRamps: FIGHTER_RAMPS,
    counts: { jobs: jobs.length, tier1: tierCounts[0], tier2: tierCounts[1], tier3: tierCounts[2] },
    excluded: cat.excluded,
    jobs,
  };
  fs.writeFileSync(path.join(OUT!, 'manifest.json'), JSON.stringify(manifest, null, 1));
  fs.writeFileSync(path.join(OUT!, 'jobs.jsonl'), jobs.map((j) => JSON.stringify({
    id: j.id, tier: j.tier, mode: j.mode, source: j.source, guide: j.guide, mask: j.mask, output: j.output,
    width: j.width, height: j.height, transparent: j.transparent, prompt: j.prompt, negative_prompt: j.negativePrompt,
    prompt_file: j.promptFile, animation_folder: j.group, consistency_group: j.consistencyGroup, frame: j.frameIndex,
    frames: j.frameCount, recolored_in_game: j.recolor !== 'none',
  })).join('\n') + '\n');
  const csv = (v: string | number | boolean | null) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = ['id,tier,mode,source,guide,mask,output,width,height,transparent,consistency_group,prompt_file,prompt,negative_prompt'];
  for (const j of jobs) {
    lines.push([j.id, j.tier, j.mode, j.source, j.guide, j.mask, j.output, j.width, j.height, j.transparent, j.consistencyGroup,
      j.promptFile, j.prompt, j.negativePrompt].map(csv).join(','));
  }
  fs.writeFileSync(path.join(OUT!, 'jobs.csv'), lines.join('\r\n') + '\r\n');

  // Reference swatch of the robot color zones (primary / secondary / tertiary ramps, shades 1..15).
  const fighterPal = cat.items.find((i) => i.kind === 'fighter')!.palette;
  const sw = newImage(15 * 24, 3 * 32);
  [2, 1, 0].forEach((slot, row) => {
    for (let s = 1; s < 16; s++) {
      const idx = slot * 16 + s;
      const cell = newImage(24, 32);
      fill(cell, fighterPal[idx * 3], fighterPal[idx * 3 + 1], fighterPal[idx * 3 + 2]);
      blit(sw, cell, (s - 1) * 24, row * 32);
    }
  });
  writePng('reference/robot_color_zones.png', scaleNearest(sw, 2, 2), true);
  fs.copyFileSync(path.join(__dirname, 'make_inputs.py'), path.join(OUT!, 'make_inputs.py'));
}, 60 * 60 * 1000);
