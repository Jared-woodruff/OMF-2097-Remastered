// HD pictures rendered from a robot's 3D model. A robot built from the robot workshop's parts (or a copy of one of
// the remaster's robots, which are such parts) has the model its sprites were drawn from: OMF Studio renders each
// sprite again at the HD artwork scale on the GPU, like the game renders the remaster's own robots (gen/hdArtwork.ts),
// in the colors the pictures are painted in. Only sprites whose pixels are still the model's get a picture this way (a
// sprite drawn on since, or brought in, is left as it is): the model's sprites are made again and matched by their
// fingerprints, which also finds them in the moves they were copied to.
import { parseAF, saveAF, type AfFile } from '../../formats/af';
import { buildFighter, JUMP_PIVOT } from '../../gen/fighter/build';
import { HD_SX, HD_SY, HD_UNIT, HdPageSet, RobotHdRenderer } from '../../gen/hdRender';
import { ROW_H } from '../../gen/raster';
import type { PlacedShape } from '../../gen/robot';
import { fighterOf } from '../../gen/roster';
import { workshopRobot, WORKSHOP_FIRST_ID, type WorkshopSpec } from '../../gen/workshop';
import { robotBasePalette } from '../../mods/hdArt';
import { spriteHash } from '../../mods/package';
import { encodePng } from '../../util/png';
import type { StudioApp } from '../app';
import { fill, h, modal, toast } from '../dom';
import { compactPicture } from '../hd';
import { emptyHd, type RobotDoc } from '../project';

/** One sprite to render: where its pixels are in the model's world, and the shapes drawn there. */
export interface ModelJob {
  hash: string;
  /** The sprite the model made: its move, its place in the move, its rectangle (from the anchor) and magnification. */
  moveId: number;
  index: number;
  x: number;
  y: number;
  w: number;
  h: number;
  scale: number;
  shapes: PlacedShape[];
}

/**
 * The sprites of a robot's fighter file the model renders: each one whose pixels are a sprite the model makes, once.
 * `other`: how many of its sprites are not the model's (drawn on, brought in).
 */
export function modelJobs(spec: WorkshopSpec, af: AfFile): { jobs: ModelJob[]; other: number } {
  const fighter = fighterOf(workshopRobot(spec, WORKSHOP_FIRST_ID));
  const built = buildFighter(fighter);
  // (written and read again: copies of a picture resolve to it, as in the robot's file)
  const made = parseAF(saveAF(built.af));
  const byHash = new Map<string, ModelJob>();
  for (const m of fighter.moves) {
    const shapes = built.shapes.get(m.id);
    m.sprites.forEach((gs, i) => {
      const sp = made.moves[m.id]?.animation.sprites[i];
      if (!sp || sp.isEmpty() || !shapes?.[i]?.length) return;
      const hash = spriteHash(sp);
      if (byHash.has(hash)) return;
      byHash.set(hash, {
        hash, moveId: m.id, index: i, x: sp.posX, y: sp.posY - (m.id === 1 ? JUMP_PIVOT : 0), w: sp.width, h: sp.height,
        scale: gs.view?.scale ?? 1, shapes: shapes[i],
      });
    });
  }
  const jobs = new Map<string, ModelJob>();
  const other = new Set<string>();
  for (const m of af.moves) {
    for (const sp of m?.animation.sprites ?? []) {
      if (sp.isEmpty() || sp.width > 1000) continue;
      const hash = spriteHash(sp);
      const job = byHash.get(hash);
      if (job) jobs.set(hash, job);
      else other.add(hash);
    }
  }
  return { jobs: [...jobs.values()], other: other.size };
}

/** Premultiplied RGBA (what the renderer draws) as straight RGBA (what pictures hold), in place. */
export function unpremultiply(px: Uint8Array): void {
  for (let i = 0; i < px.length; i += 4) {
    const a = px[i + 3];
    if (a === 0 || a === 255) continue;
    for (let c = 0; c < 3; c++) px[i + c] = Math.min(255, Math.round((px[i + c] * 255) / a));
  }
}

/**
 * Renders the jobs' pictures (the sprite and `pad` native pixels around it, at the HD scale), colored with the robot
 * colors `colors`. Resolves to the pictures by fingerprint; `progress` hears of each; `cancelled` stops it early.
 */
export async function renderModel(jobs: ModelJob[], colors: [number, number, number], pad: number, progress: (done: number) => void,
  cancelled: () => boolean = () => false): Promise<Map<string, Uint8Array>> {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2', { antialias: false });
  if (!gl) throw new Error('this computer\'s browser cannot render them (it has no WebGL 2)');
  const out = new Map<string, Uint8Array>();
  const renderer = new RobotHdRenderer(gl);
  renderer.setPalette(robotBasePalette(colors));
  let pages = new HdPageSet(gl, 2048);
  try {
    for (const [n, j] of jobs.entries()) {
      if (cancelled()) break;
      const w = (j.w + 2 * pad) * HD_SX, h = (j.h + 2 * pad) * HD_SY;
      const rect = pages.allocate(w, h);
      // (the rectangle's top left corner in the model's world: like the game's renderings, gen/hdArtwork.ts)
      renderer.draw(rect, (j.x - pad) / j.scale, (-(j.y - pad) * ROW_H) / j.scale, j.shapes, HD_UNIT / j.scale);
      const px = new Uint8Array(w * h * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, rect.page.fbo);
      // (the renderer draws a picture's top row at the rectangle's first row: what is read back first)
      gl.readPixels(rect.x, rect.y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      unpremultiply(px);
      out.set(j.hash, await compactPicture(await encodePng(w, h, px)));
      progress(n + 1);
      // (a page filled: the pictures are read back already, the pages can go)
      if (pages.pages.length > 1) {
        pages.dispose();
        pages = new HdPageSet(gl, 2048);
      }
    }
  } finally {
    pages.dispose();
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
  return out;
}

/**
 * Renders a robot's HD pictures from its 3D model, after asking (how many, whether to replace the pictures its sprites
 * have), with the progress shown. Resolves to how many pictures it made.
 */
export async function renderModelDialog(app: StudioApp, robot: RobotDoc): Promise<number> {
  const spec = robot.info.workshop;
  if (!spec) return 0;
  // (making the model's sprites again takes a moment: say so first)
  toast('Looking at the 3D model…');
  await new Promise((r) => setTimeout(r, 50));
  const { jobs, other } = modelJobs(spec, robot.af);
  const hd = robot.hd ?? emptyHd();
  const have = jobs.filter((j) => hd.sprites.has(j.hash)).length;
  if (!jobs.length) {
    toast('None of its sprites are the 3D model\'s any more (they were drawn on or brought in).', true, 6000);
    return 0;
  }
  let replace = false;
  const ok = await modal<boolean>((close) => h('div', { class: 'modal', style: { width: '560px' } },
    h('h2', null, 'HD pictures from the 3D model'),
    h('p', { class: 'muted' }, `${jobs.length} of its pictures are the 3D model's: Studio renders them again at the HD size, like the game renders ` +
      'the remaster\'s own robots, in the colors the pictures are painted in (the HD ARTWORK card\'s).' +
      (other ? ` The other ${other} (drawn on or brought in) keep what they have.` : '')),
    have ? h('label', { class: 'muted', style: { display: 'block', margin: '8px 0' } },
      h('input', { type: 'checkbox', onchange: (e: Event) => (replace = (e.target as HTMLInputElement).checked) }),
      ` Replace the HD pictures ${have} of them have`) : null,
    h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => close(false) }, 'Cancel'),
      h('button', { class: 'btn primary', onclick: () => close(true) }, 'Render'))));
  if (!ok) return 0;
  const todo = replace ? jobs : jobs.filter((j) => !hd.sprites.has(j.hash));
  if (!todo.length) return 0;
  // The progress, until it is done or closed (the pictures made so far are kept).
  let cancelled = false;
  const bar = h('div', { style: { height: '100%', width: '0%', background: 'var(--accent)', borderRadius: '4px', transition: 'width .2s' } });
  const text = h('span', { class: 'muted' }, 'Starting…');
  let closeProgress: ((v: boolean | null) => void) | null = null;
  const shown = modal<boolean>((close) => {
    closeProgress = close;
    return h('div', { class: 'modal', style: { width: '480px' } }, h('h2', null, 'Rendering'),
      h('div', { style: { height: '10px', background: '#0b1224', borderRadius: '4px', margin: '12px 0' } }, bar), text,
      h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => close(null) }, 'Stop')));
  });
  void shown.then((v) => {
    if (v !== true) cancelled = true;
  });
  let made = new Map<string, Uint8Array>();
  try {
    made = await renderModel(todo, hd.colors, hd.pad, (n) => {
      bar.style.width = `${Math.round((n / todo.length) * 100)}%`;
      fill(text, `${n} of ${todo.length}`);
    }, () => cancelled);
  } catch (err) {
    toast(`The pictures could not be rendered: ${(err as Error)?.message ?? err}`, true, 7000);
  } finally {
    (closeProgress as ((v: boolean | null) => void) | null)?.(true);
  }
  for (const [hash, bytes] of made) hd.sprites.set(hash, bytes);
  if (made.size) {
    robot.hd = hd;
    app.changed(false);
    toast(`${made.size} HD picture${made.size === 1 ? '' : 's'} rendered from the 3D model.`);
  }
  return made.size;
}
