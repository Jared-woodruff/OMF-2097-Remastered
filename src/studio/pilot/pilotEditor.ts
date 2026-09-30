// A pilot in OMF Studio: its overview (name, stats, colors, the original pilot it plays like, and how the pilot select
// screen shows it), its pictures (the portrait and the grid's face, drawn in the game's portrait colors and shown in
// each screen's), its words (bio, the VS screen's lines to and from every original pilot, victory lines, ending: laid
// out as the game does, words.ts) and how the computer fights as it (its personality, controller/personalities.ts).
import { modAi, storyPersonality } from '../../controller/personalities';
import { parseAF } from '../../formats/af';
import { parseBK } from '../../formats/bk';
import type { Palette } from '../../formats/palette';
import type { Sprite } from '../../formats/sprite';
import { PILOT_NAMES } from '../../game/constants';
import { MOD_ENDING } from '../../game/pilotWords';
import {
  endingEntries, endingPicture, FACE_SIZE, fitPicture, placePicture, PORTRAIT_ENTRIES, PORTRAIT_SIZE, type IndexedPicture,
} from '../../mods/portraits';
import { MOD_AI_RANGES, MOD_SEXES, type ModPilotAi, type ModPilotInfo } from '../../mods/types';
import { saveFile } from '../../platform/files';
import { getFile } from '../../resources/files';
import { decodePng, encodePng } from '../../util/png';
import type { Editor, StudioApp } from '../app';
import { indexedCanvas, rampColor, robotPalette } from '../colors';
import { field, fill, h, modal, numberInput, pickFiles, select, textInput, toast } from '../dom';
import { editPixels } from '../pixel';
import { freeContentId, type PilotDoc } from '../project';
import { pngToPixels } from '../sprites';
import { originalAnswer, originalName, originalPilot } from './originals';
import { BIO_BOX, ENDING_BOX, ENDING_LAST_BOX, endingPages, scenePalette, VICTORY_BOX, VS_BOX, wordsCanvas, wordsFit, type WordBox } from './words';

const TABS = [['overview', 'Overview'], ['pictures', 'Pictures'], ['words', 'Words'], ['computer', 'Computer']] as const;
type Tab = (typeof TABS)[number][0];
/** The tabs by number (checks open a pilot's words with 2). */
export const PILOT_TAB = { overview: 0, pictures: 1, words: 2, computer: 3 } as const;

let lastTab: Tab = 'overview';

interface Ctx {
  app: StudioApp;
  pilot: PilotDoc;
  info: ModPilotInfo;
  /** Draws the tab again. */
  redraw: () => void;
}

export function pilotEditor(app: StudioApp, pilot: PilotDoc, tabNumber?: number): Editor {
  let tab: Tab = tabNumber !== undefined ? TABS[tabNumber]?.[0] ?? lastTab : lastTab;
  const body = h('div', { style: { flex: '1', minHeight: '0', overflow: 'auto' } });
  const tabs = h('div', { class: 'tabs', style: { padding: '0 22px', margin: '0' } });
  const title = h('h1', { style: { margin: '0', font: '800 20px var(--title)', letterSpacing: '.06em' } });
  const el = h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%' } },
    h('div', { style: { padding: '14px 22px 0', display: 'flex', alignItems: 'center', gap: '12px' } }, title, h('span', { class: 'faint' }, `pilots/${pilot.id}`)),
    tabs, body);
  const show = () => {
    lastTab = tab;
    fill(title, pilot.info.name || 'Pilot');
    fill(tabs, TABS.map(([t, label]) => h('div', { class: `tab${tab === t ? ' sel' : ''}`, onclick: () => ((tab = t), show()) }, label)));
    const c: Ctx = { app, pilot, info: pilot.info, redraw: show };
    fill(body, tab === 'overview' ? overview(c, () => fill(title, pilot.info.name || 'Pilot')) : tab === 'pictures' ? pictures(c) : tab === 'words' ? words(c) : computer(c));
  };
  show();
  return { el };
}

// ---- pictures --------------------------------------------------------------------------------------------------------

/** An indexed picture drawn `k` times its size. */
function pictureCanvas(p: IndexedPicture, pal: Palette, k: number): HTMLCanvasElement {
  const c = indexedCanvas(p.data, p.w, p.h, pal);
  c.className = 'pix';
  c.style.width = `${p.w * k}px`;
  c.style.height = `${p.h * k}px`;
  return c;
}

/** The ending's portrait colors: those the original pilots' portraits use there. */
let endingColors: number[] | null = null;
function endingEntriesOf(): number[] {
  endingColors ??= endingEntries(parseBK(getFile('END1.BK')).anims[3]?.animation.sprites.map((s) => (s.isEmpty() ? null : s.pixels())) ?? []);
  return endingColors;
}

/** A box for a picture preview, with its caption. */
function previewBox(caption: string, content: HTMLElement | null, note = ''): HTMLElement {
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'flex-start' } },
    h('b', null, caption),
    h('div', { style: { background: '#070a13', padding: '8px', borderRadius: '6px', minWidth: '60px', minHeight: '40px' } }, content ?? h('span', { class: 'faint' }, 'None')),
    note ? h('span', { class: 'faint', style: { fontSize: '11px', maxWidth: '240px' } }, note) : null);
}

/** Pixels of a PNG in the portrait colors of the pilot select screen (for the pixel editor). */
async function portraitPixels(png: Uint8Array): Promise<{ pixels: Uint8Array; w: number; h: number; exact: boolean }> {
  return pngToPixels(png, scenePalette('MELEE.BK'), PORTRAIT_ENTRIES);
}

/** Indexed pixels as a true-color PNG in the pilot select screen's colors (0 see-through). */
function portraitPng(pixels: Uint8Array, w: number, hh: number): Promise<Uint8Array> {
  const pal = scenePalette('MELEE.BK');
  const rgba = new Uint8Array(w * hh * 4);
  for (let i = 0; i < pixels.length; i++) if (pixels[i]) rgba.set([pal.r(pixels[i]), pal.g(pixels[i]), pal.b(pixels[i]), 255], i * 4);
  return encodePng(w, hh, rgba);
}

/** A face (51 x 36) cut from a portrait: its top middle, scaled down to the width. */
async function faceFromPortrait(png: Uint8Array): Promise<Uint8Array> {
  const img = await decodePng(png);
  const { w: W, h: H } = FACE_SIZE;
  const k = Math.max(W / img.w, H / img.h);
  const out = new Uint8Array(W * H * 4);
  const ox = (img.w * k - W) / 2;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const sx = Math.min(img.w - 1, Math.floor((x + ox) / k)), sy = Math.min(img.h - 1, Math.floor(y / k));
      out.set(img.rgba.subarray((sy * img.w + sx) * 4, (sy * img.w + sx) * 4 + 4), (y * W + x) * 4);
    }
  }
  return encodePng(W, H, out);
}

function pictures(c: Ctx): HTMLElement {
  const { app, pilot, info } = c;
  const portraitRow = h('div', { class: 'row', style: { alignItems: 'flex-start', gap: '26px', flexWrap: 'wrap' } });
  const faceRow = h('div', { class: 'row', style: { alignItems: 'flex-start', gap: '26px', flexWrap: 'wrap' } });
  const draw = async () => {
    const img = pilot.portrait ? await decodePng(pilot.portrait) : null;
    const face = pilot.face ? await decodePng(pilot.face) : null;
    const melee = scenePalette('MELEE.BK'), vs = scenePalette('VS.BK'), end = scenePalette('END1.BK');
    const { w, h: ph } = PORTRAIT_SIZE;
    fill(portraitRow,
      previewBox('Pilot select screen', img && pictureCanvas(fitPicture(img, melee, PORTRAIT_ENTRIES, w, ph, 'fit'), melee, 2),
        img ? `${img.w} x ${img.h}${img.w > w || img.h > ph ? `: shown ${w} x ${ph} at most` : ''}` : ''),
      previewBox('VS screen', img && pictureCanvas(fitPicture(img, vs, PORTRAIT_ENTRIES, w, ph, 'fit'), vs, 2), 'the VS screen\'s colors'),
      previewBox('Ending', img && pictureCanvas(endingPicture(img, end, endingEntriesOf()), end, 2), 'the one-player game\'s ending, in its colors'));
    const grid = scenePalette('MELEE.BK');
    const cell = face ? placePicture(face, grid, PORTRAIT_ENTRIES, FACE_SIZE.w, FACE_SIZE.h) :
      img ? fitPicture(img, grid, PORTRAIT_ENTRIES, FACE_SIZE.w, FACE_SIZE.h, 'cover') : null;
    fill(faceRow,
      previewBox('In the pilot select grid', cell && pictureCanvas(cell, grid, 3),
        face ? 'its own face' : img ? 'cut from the portrait by the game (no face of its own)' : ''));
  };
  void draw();
  const changed = () => {
    app.changed(false);
    void draw();
  };
  const importPng = async (which: 'portrait' | 'face') => {
    const [f] = await pickFiles('.png,image/png');
    if (!f) return;
    const bytes = new Uint8Array(await f.arrayBuffer());
    const max = which === 'face' ? FACE_SIZE : { w: 160, h: 160 };
    try {
      const img = await decodePng(bytes);
      if (img.w > max.w || img.h > max.h) {
        toast(`The picture must be ${max.w} x ${max.h} at most.`, true);
        return;
      }
      pilot[which] = bytes;
      changed();
    } catch (err) {
      toast(`The picture could not be read: ${(err as Error)?.message ?? err}`, true);
    }
  };
  const exportPng = async (which: 'portrait' | 'face') => {
    const png = pilot[which];
    if (!png) return;
    const name = `${pilot.id}-${which}.png`;
    try {
      await saveFile(name, png, 'image/png');
      toast(`Saved ${name}`);
    } catch {
      toast('The picture could not be saved.', true);
    }
  };
  // The pixel editor, in the pilot select screen's portrait colors (the other screens take the nearest of theirs).
  const drawPixels = async (which: 'portrait' | 'face') => {
    const size = which === 'face' ? FACE_SIZE : PORTRAIT_SIZE;
    let pic: { pixels: Uint8Array; w: number; h: number; exact: boolean } = { pixels: new Uint8Array(size.w * size.h), w: size.w, h: size.h, exact: true };
    if (pilot[which]) pic = await portraitPixels(pilot[which]!);
    if (!pic.exact) toast('The picture\'s colors were matched to the game\'s portrait colors to draw on it.', false, 5000);
    const pal = scenePalette('MELEE.BK');
    const r = await editPixels({
      title: `${info.name || 'Pilot'}: ${which === 'face' ? 'face in the pilot select grid' : 'portrait'}`,
      picture: { pixels: pic.pixels, w: pic.w, h: pic.h, posX: 0, posY: 0 },
      palette: pal,
      entries: PORTRAIT_ENTRIES,
      groups: [{ label: 'The portrait colors (the pilot select screen\'s: the other screens show the nearest of theirs)', entries: PORTRAIT_ENTRIES }],
      fixed: { background: 0 },
      fileName: `${pilot.id}-${which}.png`,
    });
    if (!r) return;
    pilot[which] = await portraitPng(r.pixels, r.w, r.h);
    changed();
  };
  const actions = (which: 'portrait' | 'face') => h('div', { class: 'row', style: { marginTop: '10px', flexWrap: 'wrap' } },
    h('button', { class: 'btn small primary', onclick: () => void drawPixels(which) }, pilot[which] ? 'Draw' : `Draw a new one (${which === 'face' ? '51 x 36' : '88 x 69'})`),
    h('button', { class: 'btn small', onclick: () => void importPng(which) }, 'Import PNG'),
    pilot[which] ? h('button', { class: 'btn small', onclick: () => void exportPng(which) }, 'Export PNG') : null,
    which === 'face' && pilot.portrait ? h('button', { class: 'btn small', onclick: async () => {
      pilot.face = await faceFromPortrait(pilot.portrait!);
      c.redraw();
      changed();
    } }, 'Cut from the portrait') : null,
    pilot[which] ? h('button', { class: 'btn small danger', onclick: () => {
      pilot[which] = null;
      c.redraw();
      changed();
    } }, 'Remove') : null);
  return h('div', { class: 'page' },
    h('p', { class: 'lead' }, 'A portrait is a true-color PNG: every screen that shows the pilot draws it in its own portrait colors, as ' +
      'below. Drawn in Studio, it is in the pilot select screen\'s colors, pixel for pixel.'),
    h('div', { class: 'card' }, h('h2', null, 'PORTRAIT'),
      h('p', { class: 'muted', style: { marginTop: '0' } }, 'The pilot select, VS and victory screens show it up to 88 x 69 (a bigger picture, up to 160 x 160, ' +
        'is scaled down), the ending in the originals\' 86 x 61 frame.'),
      portraitRow, actions('portrait')),
    h('div', { class: 'card' }, h('h2', null, 'FACE'),
      h('p', { class: 'muted', style: { marginTop: '0' } }, 'The pilot select screen\'s grid shows a 51 x 36 face, see-through around the head like the ' +
        'originals\' (the cursor\'s color shows there). Without one, the game cuts it from the portrait.'),
      faceRow, actions('face')));
}

// ---- overview --------------------------------------------------------------------------------------------------------

let jaguarIdle: Sprite | null = null;

/** A robot to show the pilot's colors on: the mod's first, or JAGUAR. */
function colorRobot(app: StudioApp): { sprite: Sprite; name: string } {
  const r = app.project!.robots[0];
  const s = r?.af.moves[11]?.animation.sprites.find((x) => !x.isEmpty() && x.width < 1000);
  if (r && s) return { sprite: s, name: r.info.name };
  jaguarIdle ??= parseAF(getFile('FIGHTR0.AF')).moves[11]!.animation.sprites[0];
  return { sprite: jaguarIdle, name: 'JAGUAR' };
}

function overview(c: Ctx, retitle: () => void): HTMLElement {
  const { app, pilot, info } = c;
  const robotBox = h('div');
  const drawRobot = () => {
    const { sprite, name } = colorRobot(app);
    const cv = indexedCanvas(sprite.pixels(), sprite.width, sprite.height, robotPalette(info.colors));
    cv.className = 'pix';
    cv.style.width = `${sprite.width * 1.5}px`;
    cv.style.height = `${sprite.height * 1.5}px`;
    fill(robotBox, previewBox(name, cv));
  };
  drawRobot();
  const selectBox = h('div');
  const drawSelect = async () => {
    const img = pilot.portrait ? await decodePng(pilot.portrait) : null;
    const pal = scenePalette('MELEE.BK');
    const bar = (label: string, v: number) => h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px' } },
      h('span', { style: { width: '70px', color: '#6fd98a' } }, label),
      h('div', { style: { width: '100px', height: '6px', background: '#12301c', borderRadius: '2px' } },
        h('div', { style: { width: `${(v / 20) * 100}%`, height: '100%', background: '#6fd98a', borderRadius: '2px' } })));
    fill(selectBox, h('div', { style: { display: 'flex', gap: '16px', alignItems: 'flex-start', flexWrap: 'wrap' } },
      h('div', { style: { background: '#070a13', padding: '8px', borderRadius: '6px', minWidth: '180px', minHeight: '140px' } },
        img ? pictureCanvas(fitPicture(img, pal, PORTRAIT_ENTRIES, PORTRAIT_SIZE.w, PORTRAIT_SIZE.h, 'fit'), pal, 2) : h('span', { class: 'faint' }, 'No portrait yet')),
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'flex-start' } },
        h('b', { style: { font: '700 13px var(--title)', letterSpacing: '.08em' } }, info.name || 'Pilot'),
        bar('POWER', info.power), bar('AGILITY', info.agility), bar('ENDURANCE', info.endurance),
        wordsCanvas(BIO_BOX, info.bio), fitNote(BIO_BOX, info.bio))));
  };
  void drawSelect();
  const stat = (label: string, key: 'power' | 'agility' | 'endurance') =>
    field(label, numberInput(() => info[key], (v) => ((info[key] = v), app.changed(false), void drawSelect()), 1, 20), '1-20');
  const colorRow = (label: string, slot: 0 | 1 | 2) => h('div', { style: { display: 'flex', alignItems: 'center', gap: '2px', marginBottom: '3px' } },
    h('span', { class: 'faint', style: { width: '70px', fontSize: '12px' } }, label),
    Array.from({ length: 16 }, (_, k) => h('div', {
      title: `Color ${k}`,
      style: { width: '14px', height: '14px', borderRadius: '2px', cursor: 'pointer', background: rampColor(k),
        outline: info.colors[slot] === k ? '2px solid #fff' : '1px solid rgba(0,0,0,.5)' },
      onclick: () => {
        info.colors[slot] = k;
        app.changed(false);
        c.redraw();
      },
    })));
  return h('div', { class: 'page' },
    h('p', { class: 'lead' }, 'A pilot joins the pilot select screen (on the page after the original ten), fights in any robot, and plays ' +
      'the one-player game to its own ending. Its words and the way the computer fights as it are on the Words and Computer tabs.'),
    h('div', { class: 'grid2' },
      h('div', { class: 'card' }, h('h2', null, 'PILOT'),
        h('div', { class: 'grid2' },
          field('Name', textInput(() => info.name, (v) => ((info.name = v.slice(0, 16)), app.changed(true), retitle(), void drawSelect()), { maxLength: 16 }), 'as the game writes names ("Crystal")'),
          field('Sex', select<string>(MOD_SEXES.map((s) => [s, s === 'male' ? 'Male' : 'Female']), () => info.sex, (v) => ((info.sex = v as typeof info.sex), app.changed(false))), 'the news report\'s words'),
          field('Plays like', select<number>(PILOT_NAMES.map((n, i) => [i, n]), () => info.personality, (v) => ((info.personality = v), app.changed(false))),
            'the computer fights like them unless the Computer tab gives it a personality of its own; the originals talk to it like to them unless ' +
            'the Words tab gives them other words')),
        h('div', { class: 'grid3', style: { marginTop: '10px' } }, stat('Power', 'power'), stat('Agility', 'agility'), stat('Endurance', 'endurance'))),
      h('div', { class: 'card' }, h('h2', null, 'COLORS', h('span', { class: 'spacer' }),
        h('button', { class: 'btn small', title: 'Show the mod\'s robots in these colors in Studio', onclick: () => app.setColors([...info.colors] as [number, number, number]) },
          'Show robots in them')),
        h('p', { class: 'faint', style: { marginTop: '0' } }, 'The robot\'s colors when this pilot picks it.'),
        h('div', { style: { display: 'flex', gap: '20px', alignItems: 'flex-start', flexWrap: 'wrap' } },
          h('div', null, colorRow('Primary', 0), colorRow('Secondary', 1), colorRow('Tertiary', 2)), robotBox))),
    h('div', { class: 'card' }, h('h2', null, 'ON THE PILOT SELECT SCREEN'), selectBox),
    h('div', { class: 'card' }, h('h2', null, 'REMOVE'),
      h('button', { class: 'btn danger', onclick: () => void app.removeSelected() }, `Remove ${info.name || 'this pilot'} from the mod`)));
}

// ---- words -----------------------------------------------------------------------------------------------------------

/** "Fits" or how much of a text the screen cuts off. */
function fitNote(box: WordBox, s: string): HTMLElement {
  if (!s) return h('span', { class: 'faint', style: { fontSize: '11px' } }, 'Empty');
  return wordsFit(box, s) ? h('span', { class: 'badge ok' }, 'Fits') : h('span', { class: 'badge warn' }, 'Too long: the screen cuts it off');
}

/** A text area with the screen's rendering of its text under it, drawn again as it is typed. */
function wordsField(label: string, get: () => string, set: (v: string) => void, box: WordBox, o: { rows?: number; max?: number; hint?: string; placeholder?: string; pages?: boolean }): HTMLElement {
  const preview = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-start', marginTop: '6px' } });
  const render = () => {
    const v = get() || o.placeholder || '';
    if (!v) {
      fill(preview, h('span', { class: 'faint', style: { fontSize: '11px' } }, 'Empty: the screen shows nothing.'));
      return;
    }
    const shown = o.pages ? endingPages(v) : [v];
    fill(preview, shown.map((p, i) => h('div', { style: { display: 'flex', gap: '8px', alignItems: 'flex-start' } },
      o.pages ? h('span', { class: 'faint', style: { fontSize: '11px', width: '48px' } }, `page ${i + 1}`) : null,
      wordsCanvas(box, p), get() ? fitNote(box, p) : h('span', { class: 'faint', style: { fontSize: '11px' } }, 'the game\'s own words'))));
  };
  const t = h('textarea', { rows: o.rows ?? 2, maxLength: o.max ?? 160, placeholder: o.placeholder ?? '' }, get());
  t.addEventListener('input', () => {
    set(t.value);
    render();
  });
  render();
  return h('div', { style: { marginBottom: '12px' } }, field(label, t, o.hint ?? ''), preview);
}

function words(c: Ctx): HTMLElement {
  const { app, info } = c;
  const changed = () => app.changed(false);
  // The VS screen: the row being edited is shown as the screen shows it.
  const vsPreview = h('div', { style: { display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'flex-start' } });
  let vsRow = 10;
  const drawVs = () => {
    const b = vsRow;
    const line = info.vs.to[b] || info.vs.line, answer = info.vs.from[b] || originalAnswer(b, info.personality);
    fill(vsPreview,
      h('div', null, h('div', { class: 'faint', style: { fontSize: '11px', marginBottom: '4px' } }, `${info.name || 'The pilot'} says to ${originalName(b)}`),
        wordsCanvas(VS_BOX, line), h('div', null, fitNote(VS_BOX, line))),
      h('div', null, h('div', { class: 'faint', style: { fontSize: '11px', marginBottom: '4px' } }, `${originalName(b)} answers${info.vs.from[b] ? '' : ' (their answer to ' + originalName(info.personality) + ')'}`),
        wordsCanvas(VS_BOX, answer), h('div', null, fitNote(VS_BOX, answer))));
  };
  drawVs();
  const lineInput = (get: () => string, set: (v: string) => void, placeholder: () => string, b: number) => {
    const i = h('input', { type: 'text', value: get(), maxLength: 160, placeholder: placeholder(), style: { width: '100%' } });
    const mark = () => (i.style.borderColor = get() && !wordsFit(VS_BOX, get()) ? 'var(--warn)' : '');
    mark();
    i.addEventListener('focus', () => ((vsRow = b), drawVs()));
    i.addEventListener('input', () => {
      set(i.value);
      mark();
      vsRow = b;
      drawVs();
      changed();
    });
    return i;
  };
  const vsRows = PILOT_NAMES.map((_, b) => h('tr', null,
    h('td', { style: { whiteSpace: 'nowrap', paddingRight: '8px' } }, originalName(b)),
    h('td', { style: { width: '50%' } }, lineInput(() => info.vs.to[b] ?? '', (v) => (v ? (info.vs.to[b] = v) : delete info.vs.to[b]),
      () => info.vs.line || '(its line for anyone)', b)),
    h('td', { style: { width: '50%' } }, lineInput(() => info.vs.from[b] ?? '', (v) => (v ? (info.vs.from[b] = v) : delete info.vs.from[b]),
      () => originalAnswer(b, info.personality), b))));
  const quotesBox = h('div');
  const drawQuotes = () => fill(quotesBox, info.quotes.length
    ? info.quotes.map((q) => h('div', { style: { display: 'flex', gap: '8px', alignItems: 'flex-start', marginBottom: '4px' } }, wordsCanvas(VICTORY_BOX, q), fitNote(VICTORY_BOX, q)))
    : h('span', { class: 'faint' }, 'None: the victory screen says one of the lines anybody says ("Victory!").'));
  drawQuotes();
  const quotes = h('textarea', { rows: 4, maxLength: 1700 }, info.quotes.join('\n'));
  quotes.addEventListener('input', () => {
    info.quotes = quotes.value.split('\n').map((q) => q.trim()).filter(Boolean).slice(0, 10).map((q) => q.slice(0, 160));
    drawQuotes();
    changed();
  });
  return h('div', { class: 'page' },
    h('p', { class: 'lead' }, 'Everything the pilot says, drawn as the game draws it: its font, its boxes, their colors. A text too long for its ' +
      'box is cut off by the game; its hidden rows show faintly under a red line.'),
    h('div', { class: 'card' }, h('h2', null, 'BIO'),
      wordsField('On the pilot select screen', () => info.bio, (v) => ((info.bio = v), changed()), BIO_BOX, { rows: 3, max: 300 })),
    h('div', { class: 'card' }, h('h2', null, 'VS SCREEN'),
      h('p', { class: 'muted', style: { marginTop: '0' } }, 'In the one-player game the VS screen shows what the player\'s pilot says to the opponent (one of ' +
        'the original pilots), and the answer. Left empty, a line is its line for anyone, and an answer is what that pilot says to the pilot it plays ' +
        'like.'),
      wordsField('Its line for anyone', () => info.vs.line, (v) => ((info.vs.line = v), drawVs(), changed()), VS_BOX,
        { rows: 2, hint: 'what it says to an opponent it has no line of its own for (below)' }),
      h('div', { style: { margin: '6px 0 10px' } }, vsPreview),
      h('table', { style: { width: '100%', borderCollapse: 'separate', borderSpacing: '0 3px' } },
        h('thead', null, h('tr', { class: 'faint', style: { textAlign: 'left', fontSize: '12px' } },
          h('th', null, 'Opponent'), h('th', null, `${info.name || 'It'} says`), h('th', null, 'They answer'))),
        h('tbody', null, vsRows))),
    h('div', { class: 'card' }, h('h2', null, 'AFTER WINNING'),
      field('Lines, one a line (up to 10)', quotes, 'the victory screen shows one at random'),
      h('div', { style: { marginTop: '8px' } }, quotesBox)),
    h('div', { class: 'card' }, h('h2', null, 'ENDING'),
      h('p', { class: 'muted', style: { marginTop: '0' } }, 'After beating Major Kreissack in the one-player game: its story, a page a line under its ' +
        'portrait, then the last line as its ship flies to the moon. Left empty, the game\'s own words.'),
      wordsField('The story', () => info.ending[0], (v) => ((info.ending[0] = v), changed()), ENDING_BOX, { rows: 6, max: 1500, pages: true, placeholder: MOD_ENDING[0] }),
      wordsField('The last line', () => info.ending[1], (v) => ((info.ending[1] = v), changed()), ENDING_LAST_BOX, { rows: 2, max: 1500, pages: true, placeholder: MOD_ENDING[1] })));
}

// ---- the computer ----------------------------------------------------------------------------------------------------

const AI_GROUPS: { title: string; text: string; fields: [keyof ModPilotAi, string, string][] }[] = [
  {
    title: 'ATTITUDES', text: 'How it goes about a fight (0-100).',
    fields: [
      ['normal', 'Basic moves', 'fights with its basic moves, pushes at the walls'],
      ['hyper', 'Charging in', 'rushes in with charges and hyper attacks'],
      ['jump', 'Jumping in', 'jumps at the other robot'],
      ['defensive', 'Defending', 'blocks, holds back and counters'],
      ['sniper', 'Sniping', 'shoots projectiles from afar'],
    ],
  },
  {
    title: 'ATTACKS IT LIKES', text: 'Its taste in attacks when it picks one (-100 to 100).',
    fields: [
      ['throws', 'Throws', ''], ['specials', 'Special moves', ''], ['jumpAttacks', 'Jumping attacks', ''],
      ['high', 'High attacks', ''], ['low', 'Low attacks', ''], ['middle', 'Middle attacks', ''],
    ],
  },
  {
    title: 'MOVING', text: 'How much it likes to move about (-100 to 100).',
    fields: [['moveJump', 'Jumping', ''], ['moveForward', 'Walking forward', ''], ['moveBack', 'Walking back', '']],
  },
  {
    title: 'LEARNING', text: 'The computer learns a player\'s habits as they fight, and adapts.',
    fields: [
      ['learning', 'Learning', 'how readily it learns (the originals 0.7-3)'],
      ['forget', 'Forgetting', 'how readily it forgets (below 1 it is all the same; the originals 0.05-0.5)'],
    ],
  },
];

function computer(c: Ctx): HTMLElement {
  const { app, info } = c;
  const base = storyPersonality(info.personality);
  const baseAi = modAi(base);
  const own = h('input', { type: 'checkbox', checked: !!info.ai, onchange: (e: Event) => {
    info.ai = (e.target as HTMLInputElement).checked ? modAi(storyPersonality(info.personality)) : null;
    app.changed(false);
    c.redraw();
  } });
  const slider = (ai: ModPilotAi, key: keyof ModPilotAi, label: string, hint: string) => {
    const [min, max, whole] = MOD_AI_RANGES[key];
    const fmt = (v: number) => (whole ? String(v) : v.toFixed(2));
    const num = h('span', { style: { width: '44px', textAlign: 'right', fontFamily: 'var(--mono)' } }, fmt(ai[key]));
    const range = h('input', { type: 'range', min, max, step: whole ? 1 : 0.05, value: String(ai[key]), style: { flex: '1', minWidth: '140px' } });
    range.addEventListener('input', () => {
      ai[key] = Number(range.value);
      num.textContent = fmt(ai[key]);
      app.changed(false);
    });
    return h('div', { style: { display: 'grid', gridTemplateColumns: '140px minmax(140px, 1fr) 48px minmax(0, 1.2fr)', gap: '10px', alignItems: 'center', margin: '4px 0' } },
      h('span', null, label), range, num,
      h('span', { class: 'faint', style: { fontSize: '11px' } }, [hint, `${originalName(info.personality)}: ${fmt(baseAi[key])}`].filter(Boolean).join(' · ')));
  };
  return h('div', { class: 'page' },
    h('p', { class: 'lead' }, 'How the computer fights as this pilot: the personality every original pilot has (the game\'s own values below, as ' +
      'a start). The player\'s difficulty setting decides how well it fights; this decides how.'),
    h('div', { class: 'card' }, h('h2', null, 'PERSONALITY'),
      h('label', { class: 'muted', style: { display: 'block', marginBottom: '10px' } }, own, ' A personality of its own'),
      info.ai
        ? h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Start again from'),
          select<number>([[-1, 'an original pilot...'], ...PILOT_NAMES.map((n, i) => [i, n] as [number, string])], () => -1, (v) => {
            if (v < 0) return;
            info.ai = modAi(storyPersonality(v));
            app.changed(false);
            c.redraw();
          }))
        : h('p', { class: 'muted' }, `It fights like ${originalName(info.personality)}, the pilot it plays like (the Overview tab), as the game has them.`)),
    info.ai ? AI_GROUPS.map((g) => h('div', { class: 'card' }, h('h2', null, g.title),
      h('p', { class: 'muted', style: { marginTop: '0' } }, g.text),
      g.fields.map(([key, label, hint]) => slider(info.ai!, key, label, hint)))) : null);
}

// ---- a new pilot -----------------------------------------------------------------------------------------------------

export async function newPilotDialog(app: StudioApp): Promise<PilotDoc | null> {
  let start: 'copy' | 'blank' = 'copy';
  let from = 0;
  let name = '';
  const body = h('div');
  const render = () => {
    const choice = (s: typeof start, title: string, text: string) => h('div', {
      class: 'choice', style: { borderColor: start === s ? 'var(--accent)' : '', background: start === s ? '#13203a' : '' },
      onclick: () => ((start = s), render()),
    }, h('b', null, title), h('span', null, text));
    fill(body,
      h('div', { class: 'choices', style: { gridTemplateColumns: 'repeat(2, 1fr)', marginBottom: '14px' } },
        choice('copy', 'COPY ONE', 'Start from one of the game\'s pilots: their portrait and face, stats, colors, words, ending and personality.'),
        choice('blank', 'BLANK', 'A pilot with average stats and no portrait yet, who fights like Crystal.')),
      start === 'copy' ? h('div', { style: { marginBottom: '12px' } }, field('Pilot', select<number>(PILOT_NAMES.map((n, i) => [i, n]), () => from, (v) => (from = v)))) : null,
      field('Name', (() => {
        const i = h('input', { type: 'text', value: name, maxLength: 16, placeholder: start === 'copy' ? originalName(from) : 'New pilot' });
        i.addEventListener('input', () => (name = i.value));
        return i;
      })()));
  };
  render();
  const ok = await modal<boolean>((close) => h('div', { class: 'modal', style: { width: '620px' } },
    h('h2', null, 'New pilot'), body,
    h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => close(false) }, 'Cancel'),
      h('button', { class: 'btn primary', onclick: () => close(true) }, 'Make it'))));
  if (!ok) return null;
  const made = start === 'copy' ? await originalPilot(from) : {
    info: {
      name: '', sex: 'male', power: 10, agility: 10, endurance: 10, colors: [...app.colors] as [number, number, number], bio: '', personality: 0,
      ai: modAi(storyPersonality(0)), vs: { line: '', to: {}, from: {} }, quotes: [], ending: ['', ''],
    } as ModPilotInfo,
    portrait: null, face: null,
  };
  const clean = (name.trim() || (start === 'copy' ? originalName(from) : 'New pilot')).slice(0, 16);
  made.info.name = clean;
  return { id: freeContentId(clean, app.project!.pilots.map((p) => p.id)), ...made };
}
