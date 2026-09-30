// An arena in OMF Studio: its overview (texts, music and ambience, its background: 320 x 200, and the widescreen sides
// around it, 576 x 200; its sounds) and its animations (animEditor.ts). A picture brought in becomes the arena's own 64
// colors and the shading tables the game needs (the remaster's arenas are made the same way, gen/scene/build.ts).
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
import { decodePng, encodeIndexedPng } from '../../util/png';
import { encodeSprite } from '../../formats/sprite';
import { saveFile } from '../../platform/files';
import { soundsCard } from '../robot/sounds';
import { sharedGroup } from '../sprites';
import { ARENA_EFFECTS, ARENA_OWN, ArenaAnimEditor } from './animEditor';
import type { Editor, StudioApp } from '../app';
import { arenaPalette, indexedCanvas, nearestEntry, referenceArena } from '../colors';
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

export function arenaEditor(app: StudioApp, arena: ArenaDoc, anim?: number): Editor {
  let tab: 'overview' | 'anims' = anim !== undefined ? 'anims' : 'overview';
  let anims: ArenaAnimEditor | null = null;
  const body = h('div', { style: { flex: '1', minHeight: '0' } });
  const tabs = h('div', { class: 'tabs', style: { padding: '0 22px', margin: '0' } });
  const el = h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%' } },
    h('div', { style: { padding: '14px 22px 0', display: 'flex', alignItems: 'center', gap: '12px' } },
      h('h1', { style: { margin: '0', font: '800 20px var(--title)', letterSpacing: '.06em' } }, arena.info.name || 'Arena'),
      h('span', { class: 'faint' }, `arenas/${arena.id}`)),
    tabs, body);
  const renderTabs = () => {
    const count = arena.bk.anims.filter((a) => a).length;
    fill(tabs,
      h('div', { class: `tab${tab === 'overview' ? ' sel' : ''}`, onclick: () => ((tab = 'overview'), show()) }, 'Overview'),
      h('div', { class: `tab${tab === 'anims' ? ' sel' : ''}`, onclick: () => ((tab = 'anims'), show()) }, `Animations (${count})`));
  };
  const show = () => {
    anims?.destroy();
    anims = null;
    renderTabs();
    if (tab === 'anims') {
      anims = new ArenaAnimEditor(app, arena, anim ?? -1, renderTabs);
      body.style.overflow = 'hidden';
      fill(body, anims.el);
    } else {
      body.style.overflow = 'auto';
      fill(body, overview(app, arena, (id) => {
        anim = id;
        tab = 'anims';
        show();
      }));
    }
  };
  show();
  return { el, close: () => anims?.destroy() };
}

function overview(app: StudioApp, arena: ArenaDoc, openAnim: (id: number) => void): HTMLElement {
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
  const hazards = arena.bk.anims.map((a, id) => ({ a, id })).filter((x) => x.a && x.a.probability > 1);
  const loops = [...new Set([...info.loops, ...(info.base === 3 ? [1, 2, 3, 4] : [])])].filter((id) => arena.bk.anims[id]);
  return h('div', { class: 'page' },
    h('p', { class: 'lead' }, 'The arena\'s scene file holds its background, its own 64 colors (the rest every arena shares), its animations ' +
      '(hazards and things that move) and its sounds. The round announcements and dust come from the original game\'s first arena ' +
      'unless it has its own.'),
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
      h('button', { class: 'btn small primary', onclick: () => void replacePicture(app, arena).then((ok) => ok && drawPicture()) }, 'Replace from a PNG'),
      h('button', { class: 'btn small', onclick: () => void exportPicture(arena) }, 'Export PNG')),
      pictureBox),
    h('div', { class: 'card' }, h('h2', null, 'WHAT MOVES', h('span', { class: 'spacer' }),
      h('button', { class: 'btn small', onclick: () => openAnim(-1) }, 'Animations')),
      h('p', { class: 'muted', style: { marginTop: '0' } }, loops.length || hazards.length
        ? [loops.length ? `Looping from the start: ${loops.map((i) => `animation ${i}`).join(', ')}.` : '',
          hazards.length ? `At random during fights (hazards on): ${hazards.map(({ a, id }) => `animation ${id} (1 in ${a!.probability}${a!.hazardDamage && a!.animation.coords.length ? `, ${a!.hazardDamage} damage` : ''})`).join(', ')}.` : '']
          .filter(Boolean).join(' ')
        : 'Nothing yet: a still arena. Its Animations tab adds looping animations and hazards.')),
    soundsCard(arena.bk.soundTable, () => app.changed(false), {
      strings: arena.bk.anims.flatMap((a) => (a ? [a.animation.animString, ...a.animation.extraStrings] : [])),
      shared: (i) => [1, 2, 3, 10, 11, 12, 13, 14, 15, 16].includes(i),
      help: `A frame's "s n" tag plays entry n: one of the game's sound effects. An entry left at "The original's" plays the original game's ` +
        'first arena\'s (the round announcements and dust use some); the game sets entries 3, 14 and 15 itself.',
      fallback: referenceArena().soundTable,
    }),
    h('div', { class: 'card' }, h('h2', null, 'REMOVE'),
      h('button', { class: 'btn danger', onclick: () => void app.removeSelected() }, `Remove ${info.name || 'this arena'} from the mod`)));
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
    const before = arenaPalette(arena.bk);
    arena.wid = fromPicture(arena.bk, pic.rgb, pic.w, pic.h);
    // The animations keep their look: their pixels in the arena's own colors take the nearest of the new ones.
    const after = arenaPalette(arena.bk);
    const map = new Map<number, number>();
    const entries = [...ARENA_OWN, ...ARENA_EFFECTS];
    for (const a of arena.bk.anims) {
      for (const sp of a?.animation.sprites ?? []) {
        if (sp.isEmpty() || sp.missing) continue;
        const px = sp.pixels().slice();
        let changedPx = false;
        for (let i = 0; i < px.length; i++) {
          const v = px[i];
          if (v < 0x60 || v > 0x9f) continue;
          let t = map.get(v);
          if (t === undefined) map.set(v, (t = nearestEntry(after, entries, before.r(v), before.g(v), before.b(v))));
          if (t !== v) {
            px[i] = t;
            changedPx = true;
          }
        }
        if (changedPx) {
          const data = encodeSprite(px, sp.width, sp.height);
          // (copies of the picture elsewhere in the file follow it)
          for (const x of sharedGroup(arena.bk.anims.map((b) => b?.animation), sp)) x.setData(data, sp.width, sp.height);
        }
      }
    }
    app.changed(false);
    if (arena.bk.anims.some((a) => a)) toast('The arena\'s colors changed with the picture: its animations\' colors were matched to the new ones.', false, 6000);
    return true;
  } catch (err) {
    toast(`The picture could not be used: ${(err as Error)?.message ?? err}`, true);
    return false;
  }
}

/** The background (with its widescreen sides) as an indexed PNG with the arena's palette: paint programs keep the indices. */
async function exportPicture(arena: ArenaDoc): Promise<void> {
  const pal = arenaPalette(arena.bk);
  const wpx = wide(arena);
  const png = wpx ? await encodeIndexedPng(576, 200, wpx, pal.colors) : await encodeIndexedPng(320, 200, arena.bk.background, pal.colors);
  const name = `${arena.id}-background.png`;
  try {
    await saveFile(name, png, 'image/png');
    toast(`Saved ${name}`);
  } catch {
    toast('The picture could not be saved.', true);
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
  const info = { name: clean, description: '', newsName: clean.charAt(0) + clean.slice(1).toLowerCase(), music: 'ARENA0.PSM' as const, ambience: 'none' as const, base: -1,
    loops: [] as number[] };
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
