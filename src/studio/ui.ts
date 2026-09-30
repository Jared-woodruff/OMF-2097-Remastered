// OMF Studio's shared pieces: the small pictures of a project's robots, arenas and pilots (lists, the mod's page, the
// editors' heads), a choice between pictures (what a new robot or arena is copied from), the editors' head (the
// picture, the name, what the checks say, testing it) and the start screen's title (the remaster's logo over "STUDIO").
import type { AfFile } from '../formats/af';
import type { BkFile } from '../formats/bk';
import type { StudioApp } from './app';
import { arenaPalette, indexedCanvas, robotPalette } from './colors';
import { fill, h, icon } from './dom';
import type { ArenaDoc, PilotDoc, RobotDoc } from './project';

/** A fighter file's idle frame in the colors robots are shown in, or null (no idle animation yet). */
export function afPicture(af: AfFile, colors: [number, number, number]): HTMLCanvasElement | null {
  const s = af.moves[11]?.animation.sprites.find((x) => !x.isEmpty() && x.width < 1000);
  if (!s) return null;
  const c = indexedCanvas(s.pixels(), s.width, s.height, robotPalette(colors));
  c.className = 'pix';
  return c;
}

/** A robot's idle frame in the colors robots are shown in, or null (no idle animation yet). */
export const robotPicture = (r: RobotDoc, colors: [number, number, number]): HTMLCanvasElement | null => afPicture(r.af, colors);

/** A scene file's background (the classic screen). */
export function bkPicture(bk: BkFile): HTMLCanvasElement {
  const c = indexedCanvas(bk.background, 320, 200, arenaPalette(bk), true);
  c.className = 'pix';
  return c;
}

/** An arena's background (the classic screen). */
export const arenaPicture = (a: ArenaDoc): HTMLCanvasElement => bkPicture(a.bk);

/** A group of pictures to choose from, under its title (`picture`: null shows the kind's icon, until it is made). */
export interface PictureGroup<T> {
  title: string;
  items: { value: T; name: string; picture: HTMLElement | null }[];
}

/**
 * Pictures to choose one of (the game's robots or arenas a new one is copied from), in groups, the chosen one marked
 * (arenas' backgrounds in wider tiles). `redraw()` shows pictures made since.
 */
export function pictureChoice<T>(kind: ContentKind, groups: PictureGroup<T>[], get: () => T, set: (v: T) => void): { el: HTMLElement; redraw: () => void } {
  const el = h('div', { class: 'pick' });
  const wide = kind === 'arena';
  const redraw = () => fill(el, groups.filter((g) => g.items.length).map((g) => h('div', null,
    h('div', { class: 'kind-head' }, g.title),
    h('div', { class: `tiles${wide ? ' wide' : ''}` }, g.items.map((it) => h('button', {
      type: 'button', class: `tile${get() === it.value ? ' sel' : ''}`, title: it.name, 'aria-pressed': String(get() === it.value),
      onclick: () => {
        set(it.value);
        redraw();
      },
    }, h('div', { class: `pic${wide ? ' cover' : ''}` }, it.picture ?? icon(kind)), h('div', { class: 'label' }, h('span', null, it.name))))))));
  redraw();
  return { el, redraw };
}

/** Addresses of pilots' pictures (kept: a list drawn again shows them at once). */
const pictureUrls = new WeakMap<Uint8Array, string>();

/** A pilot's face (the pilot select grid's), else its portrait, or null. */
export function pilotPicture(p: PilotDoc, portraitFirst = false): HTMLImageElement | null {
  const bytes = portraitFirst ? p.portrait ?? p.face : p.face ?? p.portrait;
  if (!bytes) return null;
  let url = pictureUrls.get(bytes);
  if (!url) pictureUrls.set(bytes, (url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/png' }))));
  return h('img', { class: 'pix', alt: '', src: url });
}

export type ContentKind = 'robot' | 'arena' | 'pilot';

/** The picture of a robot, arena or pilot of the project, or its kind's icon. `cover`: an arena fills its box. */
export function contentPicture(app: StudioApp, kind: ContentKind, index: number, portrait = false): { el: HTMLElement; cover: boolean } {
  const p = app.project!;
  const pic = kind === 'robot' ? robotPicture(p.robots[index], app.colors) : kind === 'arena' ? arenaPicture(p.arenas[index]) : pilotPicture(p.pilots[index], portrait);
  return { el: pic ?? icon(kind), cover: kind === 'arena' };
}

export const KIND_LABEL: Record<ContentKind, string> = { robot: 'Robot', arena: 'Arena', pilot: 'Pilot' };
/** "a robot", "an arena", "a pilot". */
export const A: Record<ContentKind, string> = { robot: 'a robot', arena: 'an arena', pilot: 'a pilot' };

/**
 * An editor's head: its picture, its name (`title`, kept by the editor to rename it), its kind and folder, what the
 * checks say about it (kept up to date) and a button that tests it in the game. `extra` goes before the button.
 */
export function editorHead(app: StudioApp, kind: ContentKind, index: number, title: HTMLElement, folder: string, extra: HTMLElement | null = null): HTMLElement {
  const pic = contentPicture(app, kind, index, true);
  const status = h('span');
  app.watchStatus(status, kind, index);
  const test = kind === 'robot' ? 'Fight with it' : kind === 'arena' ? 'Fight in it' : 'Play as them';
  return h('div', { class: 'ed-head' },
    h('div', { class: `ed-thumb${pic.cover ? ' cover' : ''}` }, pic.el),
    h('div', { class: 'ed-titles' }, title,
      h('div', { class: 'ed-sub' }, h('span', { class: 'kind' }, KIND_LABEL[kind].toUpperCase()), h('span', null, folder), status)),
    h('span', { class: 'spacer' }),
    extra,
    h('button', { class: 'btn go', title: `Test it in the game: the test's settings with this ${kind} chosen`, onclick: () => void app.test({ kind, index }) },
      `▶ ${test}`));
}

/** The folding cards the author opened (they stay open on other pages and robots). */
const opened = new Set<string>();

/**
 * A card that folds away (for what most mods leave as it is): its title and a short note of what is in it, opened by a
 * click; `key` keeps it open once opened. Returns the card and its note (to change it).
 */
export function foldCard(key: string, title: string, note: string, ...content: HTMLElement[]): { el: HTMLDetailsElement; note: HTMLElement } {
  const noteEl = h('span', { class: 'note' }, note);
  const el = h('details', { class: 'card fold' }, h('summary', null, title, noteEl), h('div', { class: 'fold-body' }, content));
  el.open = opened.has(key);
  el.addEventListener('toggle', () => (el.open ? opened.add(key) : opened.delete(key)));
  return { el, note: noteEl };
}

/** "2 minutes ago", for when projects were saved. */
export function timeAgo(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
  const hours = Math.round(m / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const d = Math.round(hours / 24);
  if (d < 14) return `${d} day${d === 1 ? '' : 's'} ago`;
  return new Date(ms).toLocaleDateString();
}

/** The start screen's title: the remaster's logo over "STUDIO", and a line under it. */
export function hero(tag: string): HTMLElement {
  return h('div', { class: 'hero' },
    h('img', { class: 'hero-logo', src: 'brand/logo.webp', alt: 'One Must Fall 2097 Remastered', draggable: false }),
    h('div', { class: 'hero-word' }, 'STUDIO'),
    h('p', { class: 'tag' }, tag));
}
