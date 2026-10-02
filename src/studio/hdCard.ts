// OMF Studio's HD artwork cards: a robot's or arena's sprites (how many have HD pictures, templates to paint over as a
// zip, bringing pictures in by their names) and single pictures (a sprite's, an arena's background, a pilot's portrait
// and face): a preview, bringing one in, its template, removing it. See hd.ts.
import type { Palette } from '../formats/palette';
import type { Sprite } from '../formats/sprite';
import { spriteHash } from '../mods/package';
import { HD_REFERENCE_COLORS, HD_SCALE } from '../mods/types';
import { saveFile } from '../platform/files';
import { zip } from '../util/zip';
import type { StudioApp } from './app';
import { rampColor } from './colors';
import { fill, h, modal, pickFiles, toast } from './dom';
import { compactPicture, hdBitmap, hdProblem, hdTemplate, parseStem, picturesFromFiles, spriteStem } from './hd';
import { emptyHd, type HdDoc } from './project';
import { foldCard } from './ui';

type Anims = ({ animation: { sprites: Sprite[] } } | null | undefined)[];

/** Where a card finds a robot's or arena's HD pictures. */
export interface HdSprites {
  app: StudioApp;
  /** "m" (a robot's moves) or "a" (an arena's animations): picture names' prefix. */
  prefix: 'm' | 'a';
  anims: () => Anims;
  get: () => HdDoc | null;
  set: (hd: HdDoc | null) => void;
  /** The colors templates are drawn in. */
  palette: () => Palette;
  /** The zip's name ("sentinel-hd-templates.zip"). */
  name: string;
  /** Robots: the colors the pictures are painted in may be chosen. */
  colors: boolean;
  changed: () => void;
  /** More ways to make pictures (a robot's 3D model), shown when they can be used. */
  actions?: { label: string; title: string; available: () => boolean; run: () => Promise<unknown>; hint?: string }[];
}

/** A picture's preview, `max` pixels a side at most. */
export function hdThumb(bytes: Uint8Array | null, max = 96): HTMLElement {
  const box = h('div', { style: { minWidth: '40px', minHeight: '40px', display: 'grid', placeItems: 'center' } }, h('span', { class: 'faint', style: { fontSize: '11px' } }, bytes ? '…' : 'none'));
  if (bytes) {
    void hdBitmap(bytes).then((bmp) => {
      if (!bmp) return fill(box, h('span', { class: 'badge bad' }, 'damaged'));
      const k = Math.min(max / bmp.width, max / bmp.height, 1);
      const c = h('canvas', { width: Math.max(1, Math.round(bmp.width * k)), height: Math.max(1, Math.round(bmp.height * k)) });
      c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
      fill(box, c);
    });
  }
  return box;
}

/** The unique sprites of the animations: each picture once (by fingerprint), named after where it is first. */
function uniqueSprites(anims: Anims, prefix: 'm' | 'a'): { hash: string; sprite: Sprite; stem: string }[] {
  const seen = new Set<string>();
  const out: { hash: string; sprite: Sprite; stem: string }[] = [];
  anims.forEach((a, anim) => a?.animation.sprites.forEach((s, i) => {
    if (s.isEmpty() || s.width > 1000) return;
    const hash = spriteHash(s);
    if (seen.has(hash)) return;
    seen.add(hash);
    out.push({ hash, sprite: s, stem: spriteStem(prefix, anim, i) });
  }));
  return out;
}

async function saveZip(name: string, files: [string, Uint8Array][]): Promise<void> {
  try {
    await saveFile(name, await zip(files), 'application/zip');
    toast(`Saved ${name}`);
  } catch {
    toast('The file could not be saved.', true);
  }
}

/** A list of what went wrong bringing pictures in. */
async function report(title: string, lines: string[]): Promise<void> {
  if (!lines.length) return;
  await modal<boolean>((close) => h('div', { class: 'modal', style: { width: '560px' } }, h('h2', null, title),
    h('ul', { style: { maxHeight: '320px', overflow: 'auto', paddingLeft: '18px' } }, lines.slice(0, 200).map((l) => h('li', { class: 'muted' }, l))),
    h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: () => close(true) }, 'OK'))));
}

/** How to paint HD pictures, for the templates' zip. */
function readme(o: HdSprites, pad: number): string {
  return [
    'HD pictures for OMF 2097 Remastered (OMF Studio)',
    '',
    `Each template is a sprite blown up to the remastered look's size: ${HD_SCALE.x} x ${HD_SCALE.y} pixels for every pixel of the`,
    `sprite, with ${pad} of its pixels of margin all round (for soft edges, glows). Paint the HD picture over it, keeping`,
    'the canvas (any size of the same shape works: twice as big is sharper), and the file name.',
    o.colors ? 'Keep the robot\'s colors of the template: the game recolors the pictures to each pilot\'s colors from them.' :
      'Keep the arena\'s colors: the game fades and lights the pictures through them.',
    '',
    'Bring them into Studio with "Import pictures" (PNG or WebP, one by one or in a zip). A picture goes with its',
    'sprite\'s pixels: when a sprite is redrawn, redo its picture.',
    '',
  ].join('\r\n');
}

export function hdSpritesCard(o: HdSprites): HTMLElement {
  const body = h('div');
  const card = foldCard('hd', 'HD ARTWORK', '', body);
  const render = () => {
    const hd = o.get();
    const list = uniqueSprites(o.anims(), o.prefix);
    const have = list.filter((x) => hd?.sprites.has(x.hash)).length;
    const hints = have < list.length ? (o.actions ?? []).filter((a) => a.available() && a.hint).map((a) => a.hint!) : [];
    fill(card.note, [`${have} of ${list.length} sprites have an HD picture`, ...hints].join(' · '));
    const colorRow = (label: string, slot: 0 | 1 | 2) => h('div', { style: { display: 'flex', alignItems: 'center', gap: '2px', marginBottom: '3px' } },
      h('span', { class: 'faint', style: { width: '70px', fontSize: '12px' } }, label),
      Array.from({ length: 16 }, (_, k) => h('div', {
        title: `Color ${k}`,
        style: { width: '13px', height: '13px', borderRadius: '2px', cursor: 'pointer', background: rampColor(k),
          outline: (hd?.colors ?? HD_REFERENCE_COLORS)[slot] === k ? '2px solid #fff' : '1px solid rgba(0,0,0,.5)' },
        onclick: () => {
          const doc = o.get() ?? emptyHd();
          doc.colors[slot] = k;
          o.set(doc);
          o.changed();
          render();
        },
      })));
    fill(body,
      h('p', { class: 'muted', style: { marginTop: '0' } },
        `${have} of its ${list.length} pictures have an HD picture for the remastered look (the others are upscaled by the game). ` +
        'Export the templates, paint over them (or run them through an upscaler), and bring the pictures back in by their names.'),
      o.colors ? h('div', { style: { margin: '0 0 10px' } },
        h('div', { class: 'faint', style: { fontSize: '12px', marginBottom: '4px' } }, 'The robot colors the pictures are painted in (the templates\' colors; the game recolors ' +
          'them to each pilot\'s): three clearly different hues work best.' +
          (have ? ' Choose them before painting: the pictures you have are taken as painted in these.' : '')),
        colorRow('Primary', 0), colorRow('Secondary', 1), colorRow('Tertiary', 2)) : null,
      h('div', { class: 'row', style: { flexWrap: 'wrap' } },
        (o.actions ?? []).filter((a) => a.available()).map((a) => h('button', { class: 'btn small primary', title: a.title, onclick: () => void a.run().then(render) }, a.label)),
        h('button', { class: 'btn small', onclick: () => void exportTemplates() }, 'Export templates'),
        h('button', { class: 'btn small primary', onclick: () => void importPictures() }, 'Import pictures'),
        have ? h('button', { class: 'btn small danger', onclick: () => {
          const doc = o.get();
          if (doc) doc.sprites.clear();
          o.changed();
          render();
        } }, 'Remove them') : null));
  };
  const exportTemplates = async () => {
    const hd = o.get() ?? emptyHd();
    const pal = o.palette();
    const list = uniqueSprites(o.anims(), o.prefix);
    const files: [string, Uint8Array][] = [['README.txt', new TextEncoder().encode(readme(o, hd.pad))]];
    for (const x of list) files.push([`${x.stem}.png`, await hdTemplate(x.sprite.pixels(), x.sprite.width, x.sprite.height, pal, hd.pad)]);
    await saveZip(o.name, files);
  };
  const importPictures = async () => {
    const files = await pickFiles('.png,.webp,.zip,image/png,image/webp,application/zip', true);
    if (!files.length) return;
    const pictures = await picturesFromFiles(files);
    const anims = o.anims();
    const hd = o.get() ?? emptyHd();
    const problems: string[] = [];
    let n = 0;
    for (const [name, data] of pictures) {
      const at = parseStem(o.prefix, name);
      const s = at && anims[at[0]]?.animation.sprites[at[1]];
      if (!at || !s || s.isEmpty()) {
        problems.push(`${name}: no sprite has that name (like ${spriteStem(o.prefix, 11, 0)}: ${o.prefix === 'm' ? 'move' : 'animation'} 11, sprite A).`);
        continue;
      }
      const problem = hdProblem(data, s.width + 2 * hd.pad, s.height + 2 * hd.pad);
      if (problem) {
        problems.push(`${name}: ${problem}.`);
        continue;
      }
      hd.sprites.set(spriteHash(s), await compactPicture(data));
      n++;
    }
    if (n) {
      o.set(hd);
      o.changed();
    }
    render();
    toast(`${n} HD picture${n === 1 ? '' : 's'} brought in.`, !n);
    await report(`${problems.length} picture${problems.length === 1 ? '' : 's'} left out`, problems);
  };
  render();
  return card.el;
}

export interface HdPicture {
  /** What it stands for, in words ("the background"). */
  what: string;
  get: () => Uint8Array | null;
  set: (bytes: Uint8Array | null) => void;
  /** The native size it stands for (null: nothing to make one for yet). */
  native: () => [number, number] | null;
  template: () => Promise<Uint8Array | null>;
  /** The template's file name. */
  file: string;
  changed: () => void;
}

/** One HD picture: its preview, bringing one in, its template, removing it. */
export function hdPictureRow(o: HdPicture): HTMLElement {
  const row = h('div', { style: { display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' } });
  const render = () => {
    const native = o.native();
    const bytes = o.get();
    fill(row,
      h('div', { class: 'screen', style: { padding: '4px' } }, hdThumb(bytes)),
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
        h('span', { class: 'muted', style: { fontSize: '12px' } }, native
          ? `HD: ${native[0] * HD_SCALE.x} x ${native[1] * HD_SCALE.y} (or any size of that shape)` : 'HD: nothing to make one for yet'),
        h('div', { class: 'row', style: { flexWrap: 'wrap' } },
          h('button', { class: 'btn small', disabled: !native, onclick: () => void bringIn() }, bytes ? 'Replace HD' : 'Import HD'),
          h('button', { class: 'btn small', disabled: !native, onclick: () => void saveTemplate() }, 'HD template'),
          bytes ? h('button', { class: 'btn small danger', onclick: () => {
            o.set(null);
            o.changed();
            render();
          } }, 'Remove HD') : null)));
  };
  const bringIn = async () => {
    const native = o.native();
    const [f] = await pickFiles('.png,.webp,image/png,image/webp');
    if (!f || !native) return;
    const data = new Uint8Array(await f.arrayBuffer());
    const problem = hdProblem(data, native[0], native[1]);
    if (problem) {
      toast(`${f.name} cannot be the HD picture of ${o.what}: ${problem}.`, true, 7000);
      return;
    }
    o.set(await compactPicture(data));
    o.changed();
    render();
  };
  const saveTemplate = async () => {
    const t = await o.template();
    if (!t) return;
    try {
      await saveFile(o.file, t, 'image/png');
      toast(`Saved ${o.file}`);
    } catch {
      toast('The picture could not be saved.', true);
    }
  };
  render();
  return row;
}
