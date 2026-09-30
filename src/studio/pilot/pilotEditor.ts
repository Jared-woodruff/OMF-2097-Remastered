// A pilot in OMF Studio: name, stats, colors, fighting style, bio, lines, the one-player game's ending, and the
// portrait and face the select and VS screens show (drawn by the game in each screen's colors).
import { PILOT_NAMES } from '../../game/constants';
import { MOD_SEXES } from '../../mods/types';
import { parseBK } from '../../formats/bk';
import { getFile } from '../../resources/files';
import { decodePng, encodePng } from '../../util/png';
import type { Editor, StudioApp } from '../app';
import { rampColor } from '../colors';
import { field, fill, h, modal, numberInput, pickFiles, select, textInput, toast } from '../dom';
import { freeContentId, type PilotDoc } from '../project';
import { nearestColor, PORTRAIT_FIRST, PORTRAIT_LAST } from '../../mods/portraits';

/** A picture drawn as the pilot select screen shows it (MELEE.BK's portrait colors), scaled `k` times. */
async function gamePicture(png: Uint8Array | null, k: number): Promise<HTMLElement> {
  if (!png) return h('div', { class: 'faint', style: { padding: '20px' } }, 'None');
  const img = await decodePng(png);
  const pal = parseBK(getFile('MELEE.BK')).palettes[0];
  const c = document.createElement('canvas');
  c.width = img.w;
  c.height = img.h;
  const data = new ImageData(img.w, img.h);
  for (let i = 0; i < img.w * img.h; i++) {
    if (img.rgba[i * 4 + 3] < 128) continue;
    const v = nearestColor(pal, PORTRAIT_FIRST, PORTRAIT_LAST, img.rgba[i * 4], img.rgba[i * 4 + 1], img.rgba[i * 4 + 2]);
    data.data.set([pal.r(v), pal.g(v), pal.b(v), 255], i * 4);
  }
  c.getContext('2d')!.putImageData(data, 0, 0);
  c.className = 'pix';
  c.style.width = `${img.w * k}px`;
  c.style.height = `${img.h * k}px`;
  return c;
}

/** A face (51 x 36) cut from a portrait: its top middle, scaled down to the width. */
async function faceFromPortrait(png: Uint8Array): Promise<Uint8Array> {
  const img = await decodePng(png);
  const W = 51, H = 36;
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

export function pilotEditor(app: StudioApp, pilot: PilotDoc): Editor {
  const info = pilot.info;
  const pictures = h('div', { class: 'row', style: { alignItems: 'flex-start', gap: '30px' } });
  const drawPictures = async () => {
    fill(pictures,
      h('div', null, h('b', null, 'Portrait'), h('p', { class: 'faint', style: { margin: '2px 0 6px' } }, 'up to 88 x 69 shown as it is (160 x 160 at most)'),
        h('div', { style: { background: '#070a13', padding: '8px', borderRadius: '6px' } }, await gamePicture(pilot.portrait, 2)),
        h('div', { class: 'row', style: { marginTop: '6px' } },
          h('button', { class: 'btn small', onclick: () => void load('portrait', 160, 160) }, 'Import PNG'),
          pilot.portrait ? h('button', { class: 'btn small danger', onclick: () => ((pilot.portrait = null), app.changed(false), void drawPictures()) }, 'Remove') : null)),
      h('div', null, h('b', null, 'Face in the select grid'), h('p', { class: 'faint', style: { margin: '2px 0 6px' } }, '51 x 36; see-through around the head like the originals\''),
        h('div', { style: { background: '#070a13', padding: '8px', borderRadius: '6px' } }, await gamePicture(pilot.face, 3)),
        h('div', { class: 'row', style: { marginTop: '6px' } },
          h('button', { class: 'btn small', onclick: () => void load('face', 51, 36) }, 'Import PNG'),
          pilot.portrait ? h('button', { class: 'btn small', onclick: async () => {
            pilot.face = await faceFromPortrait(pilot.portrait!);
            app.changed(false);
            void drawPictures();
          } }, 'Cut from the portrait') : null)));
  };
  const load = async (which: 'portrait' | 'face', w: number, hh: number) => {
    const [f] = await pickFiles('.png,image/png');
    if (!f) return;
    const bytes = new Uint8Array(await f.arrayBuffer());
    try {
      const img = await decodePng(bytes);
      if (img.w > w || img.h > hh) {
        toast(`The picture must be ${w} x ${hh} at most.`, true);
        return;
      }
      pilot[which] = bytes;
      app.changed(false);
      void drawPictures();
    } catch (err) {
      toast(`The picture could not be read: ${(err as Error)?.message ?? err}`, true);
    }
  };
  void drawPictures();
  const stat = (label: string, key: 'power' | 'agility' | 'endurance') => field(label, numberInput(() => info[key], (v) => ((info[key] = v), app.changed(false)), 1, 20), '1-20');
  const colorRow = (label: string, slot: 0 | 1 | 2) => h('div', { style: { display: 'flex', alignItems: 'center', gap: '2px', marginBottom: '3px' } },
    h('span', { class: 'faint', style: { width: '70px', fontSize: '12px' } }, label),
    Array.from({ length: 16 }, (_, c) => h('div', {
      style: { width: '14px', height: '14px', borderRadius: '2px', cursor: 'pointer', background: rampColor(c),
        outline: info.colors[slot] === c ? '2px solid #fff' : '1px solid rgba(0,0,0,.5)' },
      onclick: () => {
        info.colors[slot] = c;
        app.changed(false);
        app.refresh();
      },
    })));
  const area = (label: string, get: () => string, set: (v: string) => void, rows: number, max: number, hint = '') => field(label, (() => {
    const t = h('textarea', { rows, maxLength: max }, get());
    t.addEventListener('input', () => (set(t.value), app.changed(false)));
    return t;
  })(), hint);
  const el = h('div', { class: 'page' },
    h('h1', null, info.name || 'Pilot'),
    h('p', { class: 'lead' }, 'A pilot joins the pilot select screen (below the original ten) and fights in any robot. The computer fights as ' +
      'the pilot in the style of the original pilot named below.'),
    h('div', { class: 'grid2' },
      h('div', { class: 'card' }, h('h2', null, 'PILOT'),
        h('div', { class: 'grid2' },
          field('Name', textInput(() => info.name, (v) => ((info.name = v.slice(0, 16)), app.changed(true)), { maxLength: 16 }), 'as written ("Crystal")'),
          field('Sex', select<string>(MOD_SEXES.map((s) => [s, s === 'male' ? 'Male' : 'Female']), () => info.sex, (v) => ((info.sex = v as typeof info.sex), app.changed(false))), 'the news report\'s words'),
          field('Fights like', select<number>(PILOT_NAMES.map((n, i) => [i, n]), () => info.personality, (v) => ((info.personality = v), app.changed(false))))),
        h('div', { class: 'grid3', style: { marginTop: '10px' } }, stat('Power', 'power'), stat('Agility', 'agility'), stat('Endurance', 'endurance'))),
      h('div', { class: 'card' }, h('h2', null, 'COLORS'), h('p', { class: 'faint', style: { marginTop: '0' } }, 'The robot\'s colors when this pilot picks it.'),
        colorRow('Primary', 0), colorRow('Secondary', 1), colorRow('Tertiary', 2))),
    h('div', { class: 'card' }, h('h2', null, 'PICTURES'), pictures),
    h('div', { class: 'card' }, h('h2', null, 'WORDS'),
      area('Bio', () => info.bio, (v) => (info.bio = v), 3, 300, 'the pilot select screen'),
      h('div', { style: { marginTop: '10px' } }, area('Lines, one a line', () => info.quotes.join('\n'), (v) => (info.quotes = v.split('\n').map((q) => q.trim()).filter(Boolean).slice(0, 10)), 4, 1600,
        'the first on the VS screen, all after winning')),
      h('div', { class: 'grid2', style: { marginTop: '10px' } },
        area('Ending: the story', () => info.ending[0], (v) => (info.ending[0] = v), 6, 1500, 'after beating Kreissack'),
        area('Ending: the last line', () => info.ending[1], (v) => (info.ending[1] = v), 6, 1500))),
    h('div', { class: 'card' }, h('h2', null, 'REMOVE'),
      h('button', { class: 'btn danger', onclick: () => void app.removeSelected() }, `Remove ${info.name || 'this pilot'} from the mod`)));
  return { el };
}

export async function newPilotDialog(app: StudioApp): Promise<PilotDoc | null> {
  let name = 'New pilot';
  const ok = await modal<boolean>((close) => h('div', { class: 'modal', style: { width: '420px' } },
    h('h2', null, 'New pilot'),
    field('Name', (() => {
      const i = h('input', { type: 'text', value: name, maxLength: 16 });
      i.addEventListener('input', () => (name = i.value));
      return i;
    })()),
    h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => close(false) }, 'Cancel'),
      h('button', { class: 'btn primary', onclick: () => close(true) }, 'Make it'))));
  if (!ok) return null;
  const clean = name.trim().slice(0, 16) || 'Pilot';
  return {
    id: freeContentId(clean, app.project!.pilots.map((p) => p.id)),
    info: { name: clean, sex: 'male', power: 10, agility: 10, endurance: 10, colors: [...app.colors] as [number, number, number], bio: '', personality: 0, quotes: [], ending: ['', ''] },
    portrait: null, face: null,
  };
}
