// An arena's animations in OMF Studio: the fifty slots of its scene file. The game plays them in a few ways: at random
// during fights while hazards are on (one chance in N every tick: the Danger Room's spikes, the Desert's planes),
// looping from the start (the Fire Pit's flames; a mod arena lists them), started by another animation's `m` tag, or
// by the game itself (the walls, dust and round announcements in the reserved slots). An animation hurts a robot its
// hit points touch (its damage, the robot reeling as its reaction string says), can turn into another animation when
// it hits a robot or ends, or when a robot's attack hits it. The panel (animPanel.ts) edits its frames and sprites over
// the arena's background.
import { AnimationData } from '../../formats/animation';
import { parseBK, type BkAnimData, type BkFile } from '../../formats/bk';
import type { Palette } from '../../formats/palette';
import { encodeSprite, Sprite } from '../../formats/sprite';
import { getFile } from '../../resources/files';
import { formatAnim, parseAnim, tagText } from '../anim';
import { AnimPanel, type AnimPanelHost, TICK_MS } from '../animPanel';
import { spriteStem } from '../hd';
import type { StudioApp } from '../app';
import { arenaPalette, indexedCanvas, nearestEntry, referenceArena } from '../colors';
import { confirmDialog, field, fill, h, modal, numberInput, pickFiles, select, toast } from '../dom';
import type { ArenaDoc } from '../project';
import { reactionField } from '../robot/moveEditor';
import { blankSprite, detach, pngToPixels, setPicture, trim } from '../sprites';

/** The arena's own colors and the effect colors every arena shares: what its sprites may use. */
export const ARENA_OWN = Array.from({ length: 0x40 }, (_, i) => 0x60 + i);
export const ARENA_EFFECTS = Array.from({ length: 0xfa - 0xa0 }, (_, i) => 0xa0 + i);
const ARENA_ENTRIES = [...ARENA_OWN, ...ARENA_EFFECTS];

/** The slots the game uses itself. */
export const RESERVED_ANIMS: Record<number, string> = {
  6: 'ROUND (the announcement)', 7: 'The round\'s number', 8: 'YOU LOSE', 9: 'YOU WIN', 10: 'FIGHT!', 11: 'READY',
  20: 'Left wall: a robot slammed into it', 21: 'Right wall: a robot slammed into it', 22: 'Wall slam: on the slammed robot',
  24: 'Wall dust', 25: 'Wall dust', 26: 'Landing dust', 27: 'Round token',
};
/** Of those, the ones the game takes from the original game's first arena when an arena has none. */
const SHARED = [6, 7, 8, 9, 10, 11, 24, 25, 26, 27];
/** Where the floor is on the screen. */
const FLOOR = 190;
/** The tags the original arenas' animations use (sounds, spawning, placing, drawing), listed first. */
const ARENA_TAGS = ['s', 'l', 'sb', 'se', 'sf', 'sp', 'm', 'mx', 'my', 'mrx', 'mry', 'mp', 'md', 'x=', 'y=', 'x+', 'x-', 'y+', 'y-', 'v',
  'w', 'u', 'r', 'f', 'br', 'bg', 'bt', 'bz', 'bps', 'bpn', 'bpp', 'bpb', 'bpd', 'bs', 'bf', 'bb', 'bl', 'd', 'as'];

const ORIGINAL_ARENA_NAMES = ['STADIUM', 'DANGER ROOM', 'POWER PLANT', 'FIRE PIT', 'DESERT'];

/** A new scene animation: one frame of its sprites. */
export function newArenaAnim(sprites: Sprite[], animString = 'A4', x = 160, y = 100): BkAnimData {
  const animation = new AnimationData();
  animation.startX = x;
  animation.startY = y;
  animation.animString = animString;
  animation.sprites = sprites;
  return { nullValue: 0, chainHit: 0, chainNoHit: 0, repeat: 0, probability: 0, hazardDamage: 0, footerString: '', animation };
}

/**
 * A copy of another scene file's animation, its sprites pictures of their own; the source arena's own colors
 * (0x60-0x9F) matched to the nearest of this arena's (the shared colors mean the same in every arena).
 */
export function copyArenaAnim(a: BkAnimData, from: Palette | null, to: Palette): BkAnimData {
  const animation = new AnimationData();
  animation.startX = a.animation.startX;
  animation.startY = a.animation.startY;
  animation.animString = a.animation.animString;
  animation.coords = a.animation.coords.map((c) => ({ ...c }));
  animation.extraStrings = a.animation.extraStrings.slice();
  const map = new Map<number, number>();
  animation.sprites = a.animation.sprites.map((s) => {
    const c = new Sprite();
    c.posX = s.posX;
    c.posY = s.posY;
    if (s.isEmpty()) {
      c.width = s.width;
      c.height = s.height;
      c.data = s.data ? s.data.slice() : null;
      return c;
    }
    const px = s.pixels().slice();
    if (from) {
      for (let i = 0; i < px.length; i++) {
        const v = px[i];
        if (v < 0x60 || v > 0x9f) continue;
        let t = map.get(v);
        if (t === undefined) map.set(v, (t = nearestEntry(to, ARENA_ENTRIES, from.r(v), from.g(v), from.b(v))));
        px[i] = t;
      }
    }
    c.setData(encodeSprite(px, s.width, s.height), s.width, s.height);
    return c;
  });
  return { ...a, animation };
}

/**
 * The animations one needs with it: the ones it starts (m tags) or turns into (its chains), and theirs, itself first
 * (not the shared ones: every arena has those).
 */
export function relatedAnims(anims: (BkAnimData | null)[], id: number): number[] {
  const out = [id];
  const visit = (i: number) => {
    if (out.includes(i) || !anims[i] || SHARED.includes(i)) return;
    out.push(i);
    walk(i);
  };
  const walk = (i: number) => {
    const a = anims[i]!;
    for (const c of [a.chainHit, a.chainNoHit]) if (c) visit(c);
    for (const s of [a.animation.animString, ...a.animation.extraStrings]) {
      for (const f of parseAnim(s).frames) for (const t of f.tags) if (t.name === 'm' && t.value !== null) visit(t.value);
    }
  };
  if (anims[id]) walk(id);
  return out;
}

/** An animation string with the animations it starts and removes (m, md) renumbered. */
export function renumberString(s: string, map: Map<number, number>): string {
  const t = parseAnim(s);
  let changed = false;
  for (const f of t.frames) {
    for (const g of f.tags) {
      if ((g.name !== 'm' && g.name !== 'md') || g.value === null) continue;
      const to = map.get(g.value);
      if (to === undefined || to === g.value) continue;
      g.value = to;
      g.raw = tagText(g.name, to);
      changed = true;
    }
  }
  return changed ? formatAnim(t) : s;
}

/**
 * Copies animation `id` of another scene file into slot `at` of this one, with the ones it starts or turns into when
 * `related` (in the same slots when they are free here, else in free ones, the references numbered again). Returns the
 * slots used (there: here), or null when there are not enough free slots.
 */
export function copyAnims(to: BkFile, from: BkFile, id: number, at: number, related: boolean): Map<number, number> | null {
  const ids = related ? relatedAnims(from.anims, id) : [id];
  const map = new Map<number, number>([[id, at]]);
  const taken = new Set([at]);
  const free = (i: number) => !to.anims[i] && !taken.has(i) && !RESERVED_ANIMS[i];
  for (const s of ids.slice(1)) {
    const slot = free(s) ? s : [...Array(50).keys()].find(free);
    if (slot === undefined) return null;
    map.set(s, slot);
    taken.add(slot);
  }
  // (an original arena's colors are its first palette's; ARENA0's shared parts are the same everywhere)
  const fromPal = from.palettes[0] ?? referenceArena().palettes[0];
  const pal = arenaPalette(to);
  for (const [s, slot] of map) {
    const a = copyArenaAnim(from.anims[s]!, fromPal, pal);
    // (a chain of 0 is none)
    if (a.chainHit) a.chainHit = map.get(a.chainHit) ?? a.chainHit;
    if (a.chainNoHit) a.chainNoHit = map.get(a.chainNoHit) ?? a.chainNoHit;
    a.animation.animString = renumberString(a.animation.animString, map);
    a.animation.extraStrings = a.animation.extraStrings.map((x) => renumberString(x, map));
    to.anims[slot] = a;
  }
  return map;
}

/** A short line about how an animation plays, for the list. */
function summary(id: number, a: BkAnimData, loops: boolean): string {
  const parts: string[] = [];
  if (loops) parts.push('loops from the start');
  else if (a.probability > 1) parts.push(`1 in ${a.probability}`);
  else if (a.probability === 1) parts.push('loops');
  if (a.hazardDamage && a.animation.coords.length) parts.push(`${a.hazardDamage} damage`);
  if (RESERVED_ANIMS[id]) parts.unshift(RESERVED_ANIMS[id]);
  return parts.join(' · ') || 'started by another';
}

export class ArenaAnimEditor {
  el: HTMLElement;
  private list = h('div', { style: { overflow: 'auto', borderRight: '1px solid var(--line)' } });
  private panel: AnimPanel;
  private backdrop: HTMLCanvasElement | null = null;

  /** `counted`: the number of animations changed (the tab shows it). */
  constructor(private app: StudioApp, private arena: ArenaDoc, id = -1, private counted: () => void = () => {}) {
    const arenaRef = arena;
    const host: AnimPanelHost = {
      noun: 'animation',
      tags: ARENA_TAGS,
      hd: {
        get: () => arenaRef.hd,
        set: (hd) => (arenaRef.hd = hd),
        palette: () => arenaPalette(arenaRef.bk),
        stem: (id, sprite) => spriteStem('a', id, sprite),
      },
      all: () => arenaRef.bk.anims.map((a) => a?.animation),
      get: (i) => arenaRef.bk.anims[i]?.animation ?? null,
      palette: () => arenaPalette(arenaRef.bk),
      stage: (i) => {
        const a = arenaRef.bk.anims[i]?.animation;
        const wide = !!arenaRef.wid;
        return {
          width: wide ? 576 : 320, height: 200, left: wide ? -128 : 0, origin: [a?.startX ?? 160, a?.startY ?? 100], floor: null,
          backdrop: { canvas: this.backdropCanvas(), x: wide ? -128 : 0, y: 0 }, centred: false, whole: false,
        };
      },
      pixel: (i) => ({
        entries: ARENA_ENTRIES,
        groups: [
          { label: 'The arena\'s own colors', entries: ARENA_OWN },
          { label: 'Effects (the same in every arena)', entries: ARENA_EFFECTS },
        ],
        hitPoints: true,
        // (the arena's floor, from where the animation is placed)
        floorY: FLOOR - (arenaRef.bk.anims[i]?.animation.startY ?? 0),
      }),
      spriteTitle: (i, sprite) => `${arenaRef.info.name}: animation ${i}, sprite ${String.fromCharCode(65 + sprite)}`,
      spriteFile: (i, sprite) => `${arenaRef.id}-anim${i}-${String.fromCharCode(97 + sprite)}.png`,
      importPosition: (_i, w, hh) => [-(w >> 1), -(hh >> 1)],
      cards: (i) => [this.animCard(i, arenaRef.bk.anims[i]!)],
      emptyCard: (i) => h('div', { class: 'card', style: { marginTop: '12px' } }, h('h2', null, `ANIMATION ${i}`),
        h('p', { class: 'muted' }, SHARED.includes(i)
          ? `${RESERVED_ANIMS[i]}: the arena has none of its own, so the game uses the original game's first arena's. One of its own here replaces it.`
          : RESERVED_ANIMS[i] ? `${RESERVED_ANIMS[i]}: the arena has none (the game shows nothing here).` : 'This slot is empty.'),
        h('button', { class: 'btn primary', onclick: () => void this.newAnimDialog(i) }, 'Make an animation here')),
      changed: (structure) => {
        this.app.changed(structure);
        this.renderList();
      },
    };
    this.panel = new AnimPanel(host);
    this.el = h('div', { style: { display: 'grid', gridTemplateColumns: '250px minmax(0, 1fr)', height: '100%', minHeight: '0' } }, this.list, this.panel.el);
    const first = id >= 0 ? id : arena.bk.anims.findIndex((a, i) => a && !RESERVED_ANIMS[i]);
    this.load(first >= 0 ? first : 0);
  }

  destroy(): void {
    this.panel.destroy();
  }

  /** The background changed (a new picture): the preview draws it again. */
  refresh(): void {
    this.backdrop = null;
    this.panel.refresh();
    this.renderList();
  }

  private backdropCanvas(): HTMLCanvasElement {
    if (!this.backdrop) {
      const pal = arenaPalette(this.arena.bk);
      const wid = this.arena.wid;
      if (wid && wid.length > 4) {
        const w = wid[0] | (wid[1] << 8), hh = wid[2] | (wid[3] << 8);
        const s = new Sprite();
        s.setData(wid.subarray(4), w, hh);
        this.backdrop = indexedCanvas(s.pixels(), w, hh, pal, true);
      } else {
        this.backdrop = indexedCanvas(this.arena.bk.background, 320, 200, pal, true);
      }
    }
    return this.backdrop;
  }

  private load(id: number): void {
    this.panel.load(id);
    this.renderList();
  }

  private get loops(): number[] {
    return this.arena.info.loops;
  }

  // ---- the list --------------------------------------------------------------------------------------------------

  private renderList(): void {
    const anims = this.arena.bk.anims;
    const shown = [...Array(50).keys()].filter((i) => anims[i] || RESERVED_ANIMS[i]);
    const row = (i: number) => {
      const a = anims[i];
      return h('div', {
        class: `item${i === this.panel.id ? ' sel' : ''}`, style: { padding: '4px 10px', gap: '6px', opacity: a ? '1' : '.55' },
        onclick: () => this.load(i),
      },
      h('span', { class: 'faint', style: { width: '20px', textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '11px' } }, String(i)),
      h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', fontSize: '12px' } },
        a ? summary(i, a, this.loops.includes(i) || (this.arena.info.base === 3 && i >= 1 && i <= 4)) : `${RESERVED_ANIMS[i]}${SHARED.includes(i) ? ' (the original\'s)' : ''}`),
      a && a.hazardDamage && a.animation.coords.length ? h('span', { class: 'badge warn', style: { marginLeft: 'auto' } }, 'hazard') : null);
    };
    fill(this.list,
      h('div', { style: { padding: '8px 10px', display: 'flex', gap: '6px' } },
        h('button', { class: 'btn small', onclick: () => void this.newAnimDialog(-1) }, '+ New animation')),
      shown.map(row));
    this.list.querySelector('.item.sel')?.scrollIntoView({ block: 'nearest' });
  }

  // ---- the animation's card --------------------------------------------------------------------------------------

  private animCard(id: number, a: BkAnimData): HTMLElement {
    const changed = (structure = false) => {
      this.app.changed(structure);
      this.renderList();
    };
    // How it appears: started by another (0), looping when started (1), at random during fights (N: one in N).
    type Mode = 'started' | 'loop' | 'random';
    const mode: Mode = a.probability > 1 ? 'random' : a.probability === 1 ? 'loop' : 'started';
    const chance = h('div');
    const renderChance = () => fill(chance, a.probability > 1 ? field('One chance in', numberInput(() => a.probability, (v) => ((a.probability = v), changed()), 2, 65535),
      `every tick (${TICK_MS} ms at the default speed): about every ${((a.probability * TICK_MS) / 1000).toFixed(0)} s`) : null);
    renderChance();
    const baseLoops = this.arena.info.base === 3 && id >= 1 && id <= 4;
    const loopBox = h('input', {
      type: 'checkbox', checked: this.loops.includes(id) || baseLoops, disabled: baseLoops, onchange: (e: Event) => {
        const on = (e.target as HTMLInputElement).checked;
        this.arena.info.loops = on ? [...this.loops.filter((x) => x !== id), id].sort((p, q) => p - q) : this.loops.filter((x) => x !== id);
        changed();
      },
    });
    const anims = this.arena.bk.anims;
    const targets: [number, string][] = [[0, 'Nothing'], ...[...Array(50).keys()].filter((i) => i !== id && anims[i]).map((i) => [i, `Animation ${i}`] as [number, string])];
    const spawns = [...new Set([a.animation.animString, ...a.animation.extraStrings].flatMap((s) => parseAnim(s).frames)
      .flatMap((f) => f.tags.filter((t) => t.name === 'm' && t.value !== null).map((t) => t.value!)))].sort((p, q) => p - q);
    return h('div', { class: 'card' },
      h('h2', null, `ANIMATION ${id}`, h('span', { class: 'spacer' }),
        h('button', { class: 'btn small danger', onclick: () => void this.deleteAnim(id) }, 'Delete')),
      RESERVED_ANIMS[id] ? h('p', { class: 'muted', style: { marginTop: '0' } }, `The game plays it: ${RESERVED_ANIMS[id].toLowerCase()}.`) : null,
      h('label', { class: 'muted', style: { display: 'block', marginBottom: '8px' } }, loopBox,
        baseLoops ? ' Starts with the scene and loops (the Fire Pit\'s rule, which this arena follows)' : ' Starts with the scene and loops'),
      field('Otherwise', select<Mode>([['started', 'Started by another animation or by the game'], ['loop', 'Loops once another starts it'],
        ['random', 'Appears at random during fights (hazards on)']], () => mode, (v) => {
        a.probability = v === 'random' ? Math.max(2, a.probability > 1 ? a.probability : 500) : v === 'loop' ? 1 : 0;
        changed();
        renderChance();
      })),
      chance,
      h('div', { class: 'grid2', style: { marginTop: '10px' } },
        field('Placed at x', numberInput(() => a.animation.startX, (v) => ((a.animation.startX = v), changed(), this.panel.draw()), -512, 1023), 'the screen is 0-319'),
        field('Placed at y', numberInput(() => a.animation.startY, (v) => ((a.animation.startY = v), changed(), this.panel.draw()), -512, 1023), 'the floor is at 190'),
        field('Damage', numberInput(() => a.hazardDamage, (v) => ((a.hazardDamage = v), changed()), 0, 255), 'to a robot its hit points touch'),
        field('When it hits a robot or ends', select<number>(targets, () => a.chainNoHit, (v) => ((a.chainNoHit = v), changed())), 'it becomes'),
        field('When a robot\'s attack hits it', select<number>(targets, () => a.chainHit, (v) => ((a.chainHit = v), changed())), 'it becomes')),
      a.hazardDamage ? h('div', { style: { marginTop: '10px' } }, reactionField(a.footerString, (v) => ((a.footerString = v), changed()), 'The robot\'s reaction when it is hit')) : null,
      a.hazardDamage && !a.animation.coords.length && !spawns.length
        ? h('p', { class: 'badge warn', style: { marginTop: '8px' } }, 'It has no hit points yet: draw them on its sprites (the pixel editor\'s ✖ tool).') : null,
      // (the game makes the looping ones scenery: only the ones appearing at random, and those they start, can hurt)
      a.hazardDamage && a.probability <= 1 && (this.loops.includes(id) || baseLoops)
        ? h('p', { class: 'faint', style: { fontSize: '11px' } }, 'Looping from the start, it is scenery: its damage counts when it appears at random, or when an animation that ' +
          'appears at random starts it.') : null,
      spawns.length ? h('p', { class: 'faint', style: { fontSize: '11px' } }, `It starts animation${spawns.length > 1 ? 's' : ''} ${spawns.join(', ')} (its m tags).`) : null,
      this.variants(a, changed));
  }

  /** Variants of the animation string: the game picks one at random when the animation appears at random. */
  private variants(a: BkAnimData, changed: () => void): HTMLElement {
    const list = h('div');
    const render = () => fill(list, a.animation.extraStrings.map((s, i) => {
      const t = h('textarea', { class: 'code', rows: 2 }, s);
      t.addEventListener('change', () => {
        a.animation.extraStrings[i] = t.value;
        changed();
      });
      return h('div', { style: { display: 'flex', gap: '6px', alignItems: 'flex-start', marginBottom: '4px' } },
        h('span', { class: 'faint', style: { width: '18px' } }, String(i)), t,
        h('button', { class: 'btn small', onclick: () => {
          a.animation.extraStrings.splice(i, 1);
          changed();
          render();
        } }, '✕'));
    }));
    render();
    return h('details', { class: 'card', style: { marginTop: '10px', marginBottom: '0' } },
      h('summary', { style: { cursor: 'pointer', font: '700 12px var(--title)', letterSpacing: '.14em', color: '#a9c4ff' } },
        `VARIANTS (${a.animation.extraStrings.length})`),
      h('p', { class: 'faint', style: { fontSize: '11px' } }, 'When it appears at random, the game plays one of these instead of its animation string (variant 0 never: ' +
        'it keeps the animation string then).'),
      list,
      h('button', { class: 'btn small', onclick: () => {
        if (a.animation.extraStrings.length >= 10) return;
        a.animation.extraStrings.push(a.animation.animString);
        changed();
        render();
      } }, '+ Variant'));
  }

  // ---- new and deleted animations --------------------------------------------------------------------------------

  private async newAnimDialog(slot: number): Promise<void> {
    const anims = this.arena.bk.anims;
    const free = [...Array(50).keys()].filter((i) => !anims[i]);
    if (!free.length) {
      toast('Every slot has an animation.', true);
      return;
    }
    let at = slot >= 0 && !anims[slot] ? slot : free.find((i) => !RESERVED_ANIMS[i]) ?? free[0];
    type Source = 'empty' | 'png' | 'this' | 'other';
    let source: Source = 'empty';
    let fromThis = Math.max(0, anims.findIndex((a) => a));
    let otherArena = 3, otherAnim = 1, withRelated = true;
    const others: [number, string][] = [...ORIGINAL_ARENA_NAMES.map((n, i) => [i, n] as [number, string]),
      ...this.app.project!.arenas.filter((x) => x !== this.arena).map((x, i) => [100 + i, `${x.info.name} (this mod)`] as [number, string])];
    const otherFile = (k: number): BkFile => (k >= 100 ? this.app.project!.arenas.filter((x) => x !== this.arena)[k - 100].bk : parseBK(getFile(`ARENA${k}.BK`)));
    const body = h('div');
    const render = () => {
      const choice = (s: Source, title: string, text: string) => h('div', {
        class: 'choice', style: { borderColor: source === s ? 'var(--accent)' : '', background: source === s ? '#13203a' : '' },
        onclick: () => ((source = s), render()),
      }, h('b', null, title), h('span', null, text));
      const otherAnims = otherFile(otherArena).anims.map((a, i) => (a ? [i, `Animation ${i}${RESERVED_ANIMS[i] ? `: ${RESERVED_ANIMS[i]}` : ''}`] : null))
        .filter((x): x is [number, string] => !!x);
      if (!otherAnims.some(([i]) => i === otherAnim)) otherAnim = otherAnims[0]?.[0] ?? 0;
      const rel = relatedAnims(otherFile(otherArena).anims, otherAnim).slice(1);
      const relBox = h('input', { type: 'checkbox', checked: withRelated, onchange: (e: Event) => (withRelated = (e.target as HTMLInputElement).checked) });
      fill(body,
        field('Slot', select<number>(free.map((i) => [i, RESERVED_ANIMS[i] ? `${i}: ${RESERVED_ANIMS[i]}` : String(i)]), () => at, (v) => (at = v))),
        h('div', { class: 'choices', style: { gridTemplateColumns: 'repeat(2, 1fr)', margin: '12px 0' } },
          choice('empty', 'EMPTY', 'One sprite to draw.'),
          choice('png', 'FROM PICTURES', 'PNG pictures become its frames, in the order of their names.'),
          choice('this', 'A COPY', 'Of another animation of this arena.'),
          choice('other', 'FROM ANOTHER ARENA', 'A copy of another arena\'s animation, its colors matched to this arena\'s.')),
        source === 'this' ? field('Animation', select<number>(anims.map((a, i) => (a ? [i, `Animation ${i}`] : null)).filter((x): x is [number, string] => !!x),
          () => fromThis, (v) => (fromThis = v))) : null,
        source === 'other' ? h('div', { class: 'grid2' },
          field('Arena', select<number>(others, () => otherArena, (v) => ((otherArena = v), render()))),
          field('Animation', select<number>(otherAnims, () => otherAnim, (v) => ((otherAnim = v), render())))) : null,
        source === 'other' && rel.length ? h('label', { class: 'muted', style: { display: 'block', marginTop: '10px' } }, relBox,
          ` With the animation${rel.length > 1 ? 's' : ''} it starts or turns into: ${rel.join(', ')} (numbered again where this arena's are taken)`) : null);
    };
    render();
    const ok = await modal<boolean>((close) => h('div', { class: 'modal', style: { width: '640px' } },
      h('h2', null, 'New animation'), body,
      h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => close(false) }, 'Cancel'),
        h('button', { class: 'btn primary', onclick: () => close(true) }, 'Make it'))));
    if (!ok) return;
    const pal = arenaPalette(this.arena.bk);
    let made: BkAnimData | null = null;
    let loops = false;
    if (source === 'empty') made = newArenaAnim([blankSprite(-8, -8, 16, 16)]);
    else if (source === 'this' && anims[fromThis]) {
      made = copyArenaAnim(anims[fromThis]!, null, pal);
      loops = this.loops.includes(fromThis) || (this.arena.info.base === 3 && fromThis >= 1 && fromThis <= 4);
    } else if (source === 'other') {
      if (!this.copyFrom(otherFile(otherArena), otherArena, otherAnim, at, withRelated)) return;
      this.counted();
      return;
    } else if (source === 'png') {
      const files = (await pickFiles('.png,image/png', true)).sort((p, q) => p.name.localeCompare(q.name)).slice(0, 26);
      const sprites: Sprite[] = [];
      for (const f of files) {
        try {
          const img = await pngToPixels(new Uint8Array(await f.arrayBuffer()), pal, ARENA_ENTRIES);
          const [px, w, hh, dx, dy] = trim(img.pixels, img.w, img.h);
          const s = blankSprite(-(img.w >> 1) + dx, -(img.h >> 1) + dy);
          setPicture([s], px, w, hh);
          sprites.push(s);
        } catch (err) {
          toast(`${f.name}: ${(err as Error)?.message ?? err}`, true);
        }
      }
      if (sprites.length) made = newArenaAnim(sprites, sprites.map((_, i) => `${String.fromCharCode(65 + i)}4`).join('-'));
    }
    if (!made) return;
    anims[at] = made;
    if (loops) this.arena.info.loops = [...this.loops, at].sort((p, q) => p - q);
    this.app.changed(true);
    this.counted();
    this.load(at);
  }

  /**
   * Copies another arena's animation into slot `at` (with the ones it starts or turns into, when `related`: in the same
   * slots when they are free here, else in free ones, the references numbered again). `k`: the original arena's
   * number, or 100 + a mod arena's in the project. Those that loop from the start there loop here too.
   */
  private copyFrom(file: BkFile, k: number, id: number, at: number, related: boolean): boolean {
    const map = copyAnims(this.arena.bk, file, id, at, related);
    if (!map) {
      toast(`There are not enough free slots for animation ${id} and the ones it needs.`, true);
      return false;
    }
    // (those looping from the start there loop here too)
    const other = k >= 100 ? this.app.project!.arenas.filter((x) => x !== this.arena)[k - 100] : null;
    const loopsThere = (s: number) => (other ? other.info.loops.includes(s) || (other.info.base === 3 && s >= 1 && s <= 4) : k === 3 && s >= 1 && s <= 4);
    const loops = new Set(this.loops);
    for (const [s, slot] of map) if (loopsThere(s)) loops.add(slot);
    this.arena.info.loops = [...loops].sort((p, q) => p - q);
    this.app.changed(true);
    this.load(at);
    if (map.size > 1) toast(`Copied animation ${id} with ${[...map].slice(1).map(([s, to]) => (s === to ? `${s}` : `${s} (now ${to})`)).join(', ')}.`, false, 6000);
    return true;
  }

  private async deleteAnim(id: number): Promise<void> {
    if (!(await confirmDialog('Delete animation', `Delete animation ${id}? Its sprites go with it.`, 'Delete', true))) return;
    const all = this.arena.bk.anims.map((a) => a?.animation);
    for (const s of this.arena.bk.anims[id]?.animation.sprites ?? []) detach(all, s);
    this.arena.bk.anims[id] = null;
    this.arena.info.loops = this.loops.filter((x) => x !== id);
    this.app.changed(true);
    this.counted();
    this.load(id);
  }
}
