// An arena in OMF Studio: its texts, music and ambience, and its background (320 x 200, and the widescreen sides
// around it: 576 x 200). A picture brought in becomes the arena's own 64 colors and the shading tables the game
// needs (the remaster's arenas are made the same way, gen/scene/build.ts).
import { parseBK, type BkFile } from '../../formats/bk';
import { MAX_BK_ANIMS } from '../../formats/bk';
import { Palette, RemapTables } from '../../formats/palette';
import { decodeSprite } from '../../formats/sprite';
import { saveWide } from '../../gen/scene/build';
import { buildRemaps, choosePalette, indexImage, OWN_COUNT, OWN_FIRST } from '../../gen/scene/palette';
import { GEN_ARENAS } from '../../gen/scene/arenas';
import { MOD_AMBIENCE, MOD_MUSIC } from '../../mods/types';
import { getFile } from '../../resources/files';
import { getGenerated } from '../../resources/generated';
import { langGet } from '../../resources/resources';
import { decodePng } from '../../util/png';
import type { Editor, StudioApp } from '../app';
import { arenaPalette, indexedCanvas, referenceArena } from '../colors';
import { field, fill, h, modal, pickFiles, select, textInput, toast } from '../dom';
import { freeContentId, type ArenaDoc } from '../project';

const ORIGINAL_NAMES = ['STADIUM', 'DANGER ROOM', 'POWER PLANT', 'FIRE PIT', 'DESERT'];
const BASES: [number, string][] = [[-1, 'None'], [0, 'Stadium (light on the robots)'], [1, 'Danger Room'], [2, 'Power Plant (electric walls)'],
  [3, 'Fire Pit (its fire hazards)'], [4, 'Desert (a palette for each round)']];
const MUSIC_NAMES: Record<string, string> = {
  'ARENA0.PSM': 'Stadium', 'ARENA1.PSM': 'Danger Room', 'ARENA2.PSM': 'Power Plant', 'ARENA3.PSM': 'Fire Pit', 'ARENA4.PSM': 'Desert',
  'MENU.PSM': 'Main menu', 'END.PSM': 'The ending',
};

/** The widescreen background of an arena, decoded ([pixels, 576, 200]), or null. */
function wide(a: ArenaDoc): Uint8Array | null {
  if (!a.wid || a.wid.length < 4) return null;
  const w = a.wid[0] | (a.wid[1] << 8), hh = a.wid[2] | (a.wid[3] << 8);
  return w === 576 && hh === 200 ? decodeSprite(a.wid.subarray(4), w, hh) : null;
}

export function arenaEditor(app: StudioApp, arena: ArenaDoc): Editor {
  const info = arena.info;
  const pictureBox = h('div');
  const drawPicture = () => {
    const pal = arenaPalette(arena.bk);
    const wpx = wide(arena);
    const c = wpx ? indexedCanvas(wpx, 576, 200, pal, true) : indexedCanvas(arena.bk.background, 320, 200, pal, true);
    c.className = 'pix';
    c.style.width = wpx ? '864px' : '480px';
    c.style.maxWidth = '100%';
    c.style.borderRadius = '6px';
    fill(pictureBox, c, h('p', { class: 'faint' }, wpx ? 'The middle 320 columns are the classic screen; the sides show in widescreen.' :
      'No widescreen sides: the game mirrors the picture\'s edges in widescreen, like the original arenas\'.'));
  };
  drawPicture();
  const anims = arena.bk.anims.map((a, id) => ({ a, id })).filter((x) => x.a);
  const el = h('div', { class: 'page' },
    h('h1', null, info.name || 'Arena'),
    h('p', { class: 'lead' }, 'The arena\'s scene file holds its background, its own 64 colors (the rest every arena shares) and its animations: ' +
      'hazards and things that move. The round announcements come from the original game\'s first arena.'),
    h('div', { class: 'grid2' },
      h('div', { class: 'card' }, h('h2', null, 'NAME AND TEXTS'),
        h('div', { class: 'grid2' },
          field('Name', textInput(() => info.name, (v) => ((info.name = v.toUpperCase().slice(0, 16)), app.changed(true)), { maxLength: 16 })),
          field('In the news', textInput(() => info.newsName, (v) => ((info.newsName = v.slice(0, 24)), app.changed(false)), { maxLength: 24 }), '"they traded blows in the ..."')),
        h('div', { style: { marginTop: '10px' } }, field('The VS screen\'s text', (() => {
          const t = h('textarea', { rows: 3, maxLength: 160 }, info.description);
          t.addEventListener('input', () => ((info.description = t.value), app.changed(false)));
          return t;
        })()))),
      h('div', { class: 'card' }, h('h2', null, 'SOUND AND LOOK'),
        h('div', { class: 'grid2' },
          field('Music', select<string>(MOD_MUSIC.map((m) => [m, MUSIC_NAMES[m] ?? m]), () => info.music, (v) => ((info.music = v as typeof info.music), app.changed(false)))),
          field('Ambience', select<string>(MOD_AMBIENCE.map((m) => [m, m === 'none' ? 'None' : m.replace(/\b\w/g, (c) => c.toUpperCase())]), () => info.ambience,
            (v) => ((info.ambience = v as typeof info.ambience), app.changed(false))), 'remastered effects and echo'),
          field('Behaves like', select<number>(BASES, () => info.base, (v) => ((info.base = v), app.changed(false))), 'an original arena\'s built-in rules')))),
    h('div', { class: 'card' }, h('h2', null, 'BACKGROUND', h('span', { class: 'spacer' }),
      h('button', { class: 'btn small primary', onclick: () => void replacePicture(app, arena).then((ok) => ok && drawPicture()) }, 'Replace from a PNG')),
      pictureBox),
    h('div', { class: 'card' }, h('h2', null, 'ANIMATIONS'),
      anims.length ? h('table', { style: { borderCollapse: 'collapse', width: '100%' } },
        h('thead', null, h('tr', { class: 'faint', style: { textAlign: 'left' } }, h('th', null, '#'), h('th', null, 'Sprites'), h('th', null, 'Appears'),
          h('th', null, 'Damage'), h('th', null, 'Animation'))),
        h('tbody', null, anims.map(({ a, id }) => h('tr', null,
          h('td', { class: 'faint' }, String(id)),
          h('td', null, String(a!.animation.sprites.length)),
          h('td', null, a!.probability === 1 ? 'Always (loops)' : a!.probability > 1 ? `1 in ${a!.probability} each tick (hazards on)` : 'When started'),
          h('td', null, a!.hazardDamage ? String(a!.hazardDamage) : ''),
          h('td', null, h('code', { class: 'faint', style: { fontSize: '11px' } }, a!.animation.animString.slice(0, 60))))))) :
        h('p', { class: 'faint' }, 'None: a still arena (the round announcements and dust are the game\'s).'),
      h('p', { class: 'faint', style: { fontSize: '11px' } }, 'Editing an arena\'s animations comes with the next version of OMF Studio.')),
    h('div', { class: 'card' }, h('h2', null, 'REMOVE'),
      h('button', { class: 'btn danger', onclick: () => void app.removeSelected() }, `Remove ${info.name || 'this arena'} from the mod`)));
  return { el };
}

/** An arena's background from a picture: its colors chosen for it, the classic screen and the widescreen sides. */
function fromPicture(bk: BkFile, rgb: Uint8Array, w: number, hh: number): Uint8Array | null {
  const ref = referenceArena();
  const image = { w, h: hh, rgb };
  const pal = choosePalette([image], ref.palettes[0]);
  const indexed = indexImage(image, pal);
  const extra = (w - 320) >> 1;
  const background = new Uint8Array(320 * 200);
  for (let y = 0; y < 200; y++) background.set(indexed.subarray(y * w + extra, y * w + extra + 320), y * 320);
  const remaps = buildRemaps(pal, ref.palettes[0], ref.remaps[0]);
  const own = new Palette();
  own.copyRange(pal, OWN_FIRST, OWN_COUNT);
  const ownRemaps = new RemapTables();
  for (const t of ownRemaps.tables) t.fill(0);
  remaps.tables.forEach((t, k) => ownRemaps.tables[k].set(t.subarray(OWN_FIRST), OWN_FIRST));
  bk.background = background;
  bk.palettes = [own];
  bk.remaps = [ownRemaps];
  return w === 576 ? saveWide(indexed, 576, 200) : null;
}

async function pictureFile(): Promise<{ rgb: Uint8Array; w: number; h: number } | null> {
  const [f] = await pickFiles('.png,image/png');
  if (!f) return null;
  const img = await decodePng(new Uint8Array(await f.arrayBuffer()));
  if (img.h !== 200 || (img.w !== 320 && img.w !== 576)) {
    toast('The picture must be 576 x 200 (widescreen) or 320 x 200 (the classic screen).', true, 6000);
    return null;
  }
  const rgb = new Uint8Array(img.w * img.h * 3);
  for (let i = 0; i < img.w * img.h; i++) rgb.set(img.rgba.subarray(i * 4, i * 4 + 3), i * 3);
  return { rgb, w: img.w, h: img.h };
}

async function replacePicture(app: StudioApp, arena: ArenaDoc): Promise<boolean> {
  const pic = await pictureFile();
  if (!pic) return false;
  try {
    arena.wid = fromPicture(arena.bk, pic.rgb, pic.w, pic.h);
    app.changed(false);
    if (arena.bk.anims.some((a) => a)) toast('The arena\'s colors changed with the picture: its animations are drawn in the new colors.', false, 6000);
    return true;
  } catch (err) {
    toast(`The picture could not be used: ${(err as Error)?.message ?? err}`, true);
    return false;
  }
}

type Start = 'copy' | 'picture';

export async function newArenaDialog(app: StudioApp): Promise<ArenaDoc | null> {
  let start: Start = 'copy';
  let from = 5;
  let name = 'NEW ARENA';
  const sources: [number, string][] = [
    ...ORIGINAL_NAMES.map((n, i) => [i, `${n} (original)`] as [number, string]),
    ...GEN_ARENAS.map((a) => [a.index, `${a.name} (the remaster's)`] as [number, string]),
  ];
  const body = h('div');
  const render = () => {
    const choice = (s: Start, title: string, text: string) => h('div', {
      class: 'choice', style: { borderColor: start === s ? 'var(--accent)' : '', background: start === s ? '#13203a' : '' },
      onclick: () => ((start = s), render()),
    }, h('b', null, title), h('span', null, text));
    fill(body,
      h('div', { class: 'choices', style: { gridTemplateColumns: 'repeat(2, 1fr)', marginBottom: '14px' } },
        choice('copy', 'COPY ONE', 'Start from one of the game\'s arenas: its background, colors and animations.'),
        choice('picture', 'FROM A PICTURE', 'A PNG of 576 x 200 (with the widescreen sides) or 320 x 200 becomes a still arena.')),
      field('Name', (() => {
        const i = h('input', { type: 'text', value: name, maxLength: 16 });
        i.addEventListener('input', () => (name = i.value.toUpperCase()));
        return i;
      })()),
      start === 'copy' ? h('div', { style: { marginTop: '12px' } }, field('Arena', select<number>(sources, () => from, (v) => (from = v)))) : null);
  };
  render();
  const ok = await modal<boolean>((close) => h('div', { class: 'modal', style: { width: '620px' } },
    h('h2', null, 'New arena'), body,
    h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => close(false) }, 'Cancel'),
      h('button', { class: 'btn primary', onclick: () => close(true) }, start === 'picture' ? 'Choose the picture' : 'Make it'))));
  if (!ok) return null;
  const clean = name.trim().toUpperCase().slice(0, 16) || 'ARENA';
  const id = freeContentId(clean, app.project!.arenas.map((a) => a.id));
  const info = { name: clean, description: '', newsName: clean.charAt(0) + clean.slice(1).toLowerCase(), music: 'ARENA0.PSM' as const, ambience: 'none' as const, base: -1 };
  if (start === 'copy') {
    const file = `ARENA${from}.BK`;
    const gen = GEN_ARENAS.find((a) => a.index === from);
    const bk = parseBK(gen ? getGenerated(file)! : getFile(file));
    const music = (gen?.music ?? `ARENA${from}.PSM`) as typeof info.music;
    const ambience = (['stadium', 'danger room', 'power plant', 'fire pit', 'desert', 'orbital', 'ice cave', 'rooftop', 'abyss'][from] ?? 'none') as typeof info.ambience;
    return {
      id, bk, wid: gen ? getGenerated(`ARENA${from}.WID`) : null,
      info: { ...info, music, ambience, base: from < 5 ? from : -1,
        description: from < 5 ? langGet(66 + from).replace(/\n$/, '') : gen?.description ?? '' },
    };
  }
  const pic = await pictureFile();
  if (!pic) return null;
  const bk: BkFile = {
    fileId: 0, unknownA: 0, width: 320, height: 200, anims: new Array(MAX_BK_ANIMS).fill(null), background: new Uint8Array(320 * 200),
    palettes: [], remaps: [], soundTable: new Uint8Array(30),
  };
  const wid = fromPicture(bk, pic.rgb, pic.w, pic.h);
  return { id, bk, wid, info };
}
