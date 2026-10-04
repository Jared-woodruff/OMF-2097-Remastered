// A new robot in OMF Studio: a copy of one of the game's robots (the originals, or the new robots of the mod that comes
// with the game, with their HD pictures), one built with the robot workshop's generator (the new robots are made the
// same way: a 3D model posed and drawn into every frame), or a blank one to draw.
import { parseAF, type AfFile } from '../../formats/af';
import { encodeSprite } from '../../formats/sprite';
import { GEN_ROBOTS, GEN_TACTICS } from '../../gen/roster';
import { buildWorkshopFighter, cleanName, PART_NAMES, SIZE_NAMES, WEIGHT_NAMES, workshopPreview, type WorkshopSpec } from '../../gen/workshop';
import { getFile } from '../../resources/files';
import { harName } from '../../resources/resources';
import { parseAnim } from '../anim';
import type { StudioApp } from '../app';
import { indexedCanvas, rampColor, robotPalette } from '../colors';
import { field, fill, h, modal, select, toast } from '../dom';
import { EXTRAS_ROBOTS, extrasPackage } from '../extras';
import { freeContentId, hdFromPackage, type RobotDoc } from '../project';
import { blankSprite } from '../sprites';
import { gameAf } from '../gamePictures';
import { copyRobot } from '../history';
import { afPicture, pictureChoice, type PictureGroup } from '../ui';
import { newMove } from './model';

/** Attacks that fire a projectile (they spawn a move of the projectile kind). */
function projectileMoves(af: AfFile): number[] {
  const out: number[] = [];
  af.moves.forEach((m, id) => {
    if (!m || id < 15 || !/^[PK]/.test(m.moveString)) return;
    const spawns = parseAnim(m.animation.animString).frames.flatMap((f) => f.tags.filter((t) => t.name === 'm').map((t) => t.value ?? -1));
    if (spawns.some((s) => af.moves[s]?.category === 8)) out.push(id);
  });
  return out;
}

type Start = 'copy' | 'workshop' | 'blank';

/** The copy choice's numbers of the mod's own robots (the game's are their HAR numbers). */
const MINE = 100;

export async function newRobotDialog(app: StudioApp): Promise<RobotDoc | null> {
  let start: Start = 'workshop';
  let copyFrom = 0;
  let name = 'NEW ROBOT';
  const spec: WorkshopSpec = { v: 1, name: 'NEW ROBOT', body: 0, head: 3, moves: 2, size: 1, weight: 1, colors: [...app.colors] as [number, number, number] };
  // What a copy starts from: the game's robots, and the new robots (their pictures once their mod's package is here).
  const game: PictureGroup<number> = { title: 'THE GAME\'S ROBOTS', items: Array.from({ length: 11 }, (_, i) => ({
    value: i, name: harName(i).toUpperCase() || `ROBOT ${i}`, picture: null })) };
  const extras: PictureGroup<number> = { title: 'THE NEW ROBOTS', items: EXTRAS_ROBOTS.map(([n, rname]) => ({ value: n, name: rname, picture: null })) };
  // (and the mod's own, to make a variant of one: numbered from MINE)
  const mine: PictureGroup<number> = { title: 'THIS MOD\'S ROBOTS', items: app.project!.robots.map((r, i) => ({
    value: MINE + i, name: r.info.name || r.id, picture: afPicture(r.af, app.colors) })) };
  const copies = pictureChoice('robot', [mine, game, extras], () => copyFrom, (v) => (copyFrom = v));
  let pictured = false;
  const drawCopies = () => {
    if (pictured) return;
    pictured = true;
    // (the originals at once, the new robots once their mod's package is here; a picture that fails keeps the icon)
    for (const group of [game, extras]) {
      void Promise.all(group.items.map(async (it) => {
        const af = await gameAf(it.value).catch(() => null);
        if (af) it.picture = afPicture(af, app.colors);
      })).then(() => copies.redraw());
    }
  };
  const body = h('div');
  const preview = h('div', { class: 'screen', style: { minHeight: '150px', display: 'grid', placeItems: 'center' } });
  const drawPreview = () => {
    try {
      const t = workshopPreview({ ...spec, name: cleanName(name) });
      const c = indexedCanvas(t.data, t.w, t.h, robotPalette(spec.colors));
      c.className = 'pix';
      c.style.height = '150px';
      fill(preview, c);
    } catch {
      fill(preview, h('span', { class: 'faint' }, 'No preview'));
    }
  };
  const render = () => {
    const choice = (s: Start, title: string, text: string) => h('div', {
      class: `choice${start === s ? ' sel' : ''}`,
      onclick: () => ((start = s), render()),
    }, h('b', null, title), h('span', null, text));
    const part = (label: string, key: 'body' | 'head' | 'moves') => field(label, select<number>(PART_NAMES.map((n, i) => [i, n]), () => spec[key], (v) => ((spec[key] = v), drawPreview())));
    fill(body,
      h('div', { class: 'choices', style: { gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: '14px' } },
        choice('workshop', 'BUILD ONE', 'Put a robot together from the remaster\'s parts: every frame is drawn from its 3D model.'),
        choice('copy', 'COPY ONE', `Start from one of the game's robots${app.project!.robots.length ? " or the mod's own" : ''}, every animation and move included.`),
        choice('blank', 'START BLANK', 'A plain figure in every animation the game needs, to draw over.')),
      field('Name', (() => {
        const i = h('input', { type: 'text', value: name, maxLength: 12 });
        i.addEventListener('input', () => ((name = i.value.toUpperCase()), start === 'workshop' && drawPreview()));
        return i;
      })(), 'up to 12 letters'),
      start === 'copy' ? h('div', { style: { marginTop: '14px' } }, copies.el) : null,
      start === 'workshop' ? h('div', { class: 'grid2', style: { marginTop: '12px', alignItems: 'start' } },
        h('div', { class: 'grid2' },
          part('Frame (body)', 'body'), part('Head', 'head'), part('Moves', 'moves'),
          field('Size', select<number>(SIZE_NAMES.map((n, i) => [i, n]), () => spec.size, (v) => ((spec.size = v), drawPreview()))),
          field('Weight', select<number>(WEIGHT_NAMES.map((n, i) => [i, n]), () => spec.weight, (v) => (spec.weight = v))),
          h('div', null, h('div', { class: 'muted', style: { fontSize: '12px', marginBottom: '4px' } }, 'Colors (as shown here)'),
            [0, 1, 2].map((slot) => h('div', { style: { display: 'flex', gap: '2px', marginBottom: '2px' } }, Array.from({ length: 16 }, (_, c) => h('div', {
              style: { width: '11px', height: '11px', borderRadius: '2px', cursor: 'pointer', background: rampColor(c),
                outline: spec.colors[slot] === c ? '2px solid #fff' : '1px solid rgba(0,0,0,.5)' },
              onclick: () => ((spec.colors[slot] = c), render()),
            })))))),
        preview) : null);
    if (start === 'workshop') drawPreview();
    if (start === 'copy') drawCopies();
  };
  render();
  const ok = await modal<boolean>((close) => h('div', { class: 'modal', style: { width: '760px' } },
    h('h2', null, 'New robot'), body,
    h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => close(false) }, 'Cancel'),
      h('button', { class: 'btn primary', onclick: () => close(true) }, 'Make it'))));
  if (!ok) return null;
  const taken = app.project!.robots.map((r) => r.id);
  const clean = name.trim().toUpperCase().slice(0, 12) || 'ROBOT';
  const id = freeContentId(clean, taken);
  try {
    if (start === 'workshop') {
      const w = { ...spec, name: cleanName(clean) };
      const af = parseAF(buildWorkshopFighter(w, 0));
      const g = GEN_ROBOTS[w.moves];
      return {
        id, af, hd: null,
        info: { name: clean, description: `Built from ${PART_NAMES[w.body]}'s frame, ${PART_NAMES[w.head]}'s head and ${PART_NAMES[w.moves]}'s moves.`,
          moves: { ...g.specialNames }, ai: structuredClone(GEN_TACTICS[g.name] ?? { projectile: [], charge: [], push: [] }), workshop: w },
      };
    }
    if (start === 'copy' && copyFrom >= MINE) {
      const c = copyRobot(app.project!.robots[copyFrom - MINE]);
      c.id = id;
      c.info.name = clean;
      return c;
    }
    if (start === 'copy') {
      // A new robot: its robot as its mod has it (the robot workshop's parts of one robot, their 3D model draws them),
      // its HD pictures too.
      const extra = EXTRAS_ROBOTS.find(([n]) => n === copyFrom);
      if (extra) {
        const r = (await extrasPackage()).robots.find((x) => x.id === extra[2]);
        if (!r) throw new Error(`the new robots have no ${extra[1]}`);
        const af = parseAF(r.af);
        return { id, af, hd: hdFromPackage(r.hd, af.moves), info: { ...structuredClone(r.info), name: clean } };
      }
      // (parsed again: the copy is the project's own)
      const af = parseAF(getFile(`FIGHTR${copyFrom}.AF`));
      return { id, af, hd: null, info: { name: clean, description: '', moves: {}, ai: { projectile: projectileMoves(af), charge: [], push: [] }, workshop: null } };
    }
    return { id, af: blankRobot(), hd: null, info: { name: clean, description: '', moves: {}, ai: { projectile: [], charge: [], push: [] }, workshop: null } };
  } catch (err) {
    toast(`The robot could not be made: ${(err as Error)?.message ?? err}`, true);
    return null;
  }
}

/** A plain figure (a head and a body in the robot's colors) standing on the floor, `lean` pixels sideways at the top. */
function figure(height: number, lean = 0): { pixels: Uint8Array; w: number; h: number } {
  const w = 44, h = height;
  const px = new Uint8Array(w * h);
  const put = (x: number, y: number, v: number) => x >= 0 && y >= 0 && x < w && y < h && (px[y * w + x] = v);
  for (let y = 0; y < h; y++) {
    const shift = Math.round((lean * (h - y)) / h);
    // head (primary ramp), body (secondary), legs (tertiary)
    if (y < 14) for (let x = 15; x < 29; x++) put(x + shift, y, 32 + 6 + ((x + y) % 3));
    else if (y < h * 0.62) for (let x = 8; x < 36; x++) put(x + shift, y, 16 + 5 + (x < 14 ? 4 : x > 30 ? 0 : 2));
    else for (const x0 of [10, 25]) for (let x = x0; x < x0 + 9; x++) put(x + shift, y, 4 + (x === x0 ? 4 : 2));
  }
  return { pixels: px, w, h };
}

/** A robot with every animation the game needs, each showing a plain figure. */
export function blankRobot(): AfFile {
  const af: AfFile = {
    fighterId: 0, execWindow: 10, endurance: 14080, upwardsJumpFrameLimit: 2, health: 215,
    forwardSpeed: 3.5, reverseSpeed: 2.9, jumpSpeed: -12, fallSpeed: 1, version1: 50, aiProjectileYThreshold: 0,
    // (the sounds every robot shares: hits, blocks, steps; from the original game's first robot)
    moves: new Array(70).fill(null), soundTable: parseAF(getFile('FIGHTR0.AF')).soundTable.slice(),
  };
  const sprite = (height: number, lean = 0, dy = 0) => {
    const f = figure(height, lean);
    const s = blankSprite(-22, -height + dy);
    s.setData(encodeSprite(f.pixels, f.w, f.h), f.w, f.h);
    return s;
  };
  const moves: [number, number, string, [number, number, number][], string][] = [
    // id, category, move string, sprites (height, lean, dy), animation
    [11, 9, '!', [[90, 0, 0], [89, 1, 0]], 'A6-B6'],
    [10, 9, '!', [[90, 3, 0], [90, -3, 0]], 'A4-B4'],
    [1, 7, '!', [[70, 0, 60]], 'A30'],
    [2, 9, '!', [[60, 0, 0], [90, 0, 0]], 'A5-B5'],
    [3, 9, '!', [[86, 6, 0], [86, -6, 0]], 'A8-B8'],
    [4, 9, '!', [[60, 0, 0]], 'A10'],
    [5, 9, '!', [[88, -4, 0]], 'A10'],
    [6, 9, '!', [[58, -4, 0]], 'A10'],
    [48, 11, '!', [[96, 0, 0]], 'A60'],
    [49, 9, '!', [[30, 0, 0]], 'A60'],
  ];
  for (const [id, cat, ms, sprites, anim] of moves) af.moves[id] = newMove(cat, ms, sprites.map(([hh, lean, dy]) => sprite(hh, lean, dy)), anim);
  // The damage sheet: the frames hits show by letter, A to X like the originals' (every robot's reaction strings
  // use them): A-F upright, G-I bent, J-L staggered, M-O down, P-Q thrown up, R-U getting up, V-X down again.
  const DAMAGE_HEIGHTS = [86, 86, 86, 86, 86, 86, 60, 60, 60, 72, 72, 70, 40, 32, 28, 88, 100, 60, 84, 54, 44, 32, 26, 40];
  const damage = DAMAGE_HEIGHTS.map((hh, i) => sprite(hh, i % 2 ? 5 : -5));
  af.moves[9] = newMove(9, '!', damage, 'A4');
  // One attack to fight with: a punch.
  const punch = [sprite(90, 4), sprite(90, 9)];
  af.moves[15] = newMove(5, 'P', punch, 'A3-q1B4-A3');
  af.moves[15]!.damageAmount = 6;
  af.moves[15]!.footerString = 'sp13s1l20sf0A1-B4-A3';
  af.moves[15]!.animation.coords = [{ x: 18, y: -60, nullValue: 0, frameId: 1 }];
  return af;
}
