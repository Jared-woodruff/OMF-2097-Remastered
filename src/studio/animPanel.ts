// The animation panel of OMF Studio's editors: one animation of a file (a robot's move, an arena's animation) with a
// preview at the game's pace (its hit points, onion skin), its frames and their tags, its raw string, and its sprites,
// drawn in the pixel editor. What differs between robots and arenas comes from the host: the stage (robots stand on a
// floor; an arena's animations are placed over its background), the palette and the colors sprites may use, and the
// cards with the host's own fields.
import type { AnimationData } from '../formats/animation';
import type { Palette } from '../formats/palette';
import type { Sprite } from '../formats/sprite';
import { decodeScript } from '../script/script';
import { TAG_TABLE } from '../script/tags';
import { saveFile } from '../platform/files';
import {
  fixSeparators, formatAnim, frameAtTick, newFrame, newTag, parseAnim, setFrame, tagHasValue, totalTicks, type AnimTokens,
} from './anim';
import { indexedCanvas } from './colors';
import { field, fill, h, modal, numberInput, pickFiles, select, toast } from './dom';
import { editPixels } from './pixel';
import { TAG_HELP, tagChoices } from './robot/moves';
import { blankSprite, copySprite, detach, pngToPixels, setPicture, sharedGroup, spritePng, trim } from './sprites';

/** Milliseconds a tick lasts at the game's default speed (settings speed 5: 8 + 60 - 5/15 * 60). */
export const TICK_MS = 48;

/** How the preview shows an animation. */
export interface StageSetup {
  /** The stage's size (the game's screen: 320 x 210 for robots, 320 x 200 for arenas; wider with the widescreen sides). */
  width: number;
  height: number;
  /** Left edge of the stage (arenas with widescreen sides start at -128). */
  left: number;
  /** The point sprite positions and hit points are relative to. */
  origin: [number, number];
  /** Floor line (robots), or null. */
  floor: number | null;
  /** A picture behind (an arena's background), drawn at (x, y) on the stage. */
  backdrop: { canvas: HTMLCanvasElement; x: number; y: number } | null;
  /** A picture (the select and VS screens'): shown centred, alone. */
  centred: boolean;
  /** The view: the whole stage, or zoomed on the animation's sprites. */
  whole: boolean;
}

/** What the pixel editor needs from the host for this animation's sprites. */
export interface PixelSetup {
  entries: number[];
  groups: { label: string; entries: number[] }[];
  /** A picture of fixed size (the select screen's cell): its see-through color. */
  fixed?: { background: number };
  /** Whether its sprites have hit points to edit. */
  hitPoints: boolean;
  /** Where the floor is from the animation's origin (robots: 0; the jump: 60), or null. */
  floorY: number | null;
}

export interface AnimPanelHost {
  /** Every animation of the file, by slot (a picture stored once for several sprites is found through them). */
  all(): (AnimationData | null | undefined)[];
  /** The animation in a slot, or null. */
  get(id: number): AnimationData | null;
  palette(): Palette;
  stage(id: number): StageSetup;
  pixel(id: number): PixelSetup;
  /** Titles and file names for a sprite ("SENTINEL: move 15, sprite C"). */
  spriteTitle(id: number, sprite: number): string;
  spriteFile(id: number, sprite: number): string;
  /** Where sprites brought in as PNG pictures go, from the origin, for a picture w x h. */
  importPosition(id: number, w: number, h: number): [number, number];
  /** The host's own cards for the animation (after the frame card). */
  cards(id: number, anim: AnimationData): HTMLElement[];
  /** The card of an empty slot. */
  emptyCard(id: number): HTMLElement;
  /** The project changed (structure: lists and sidebars change too). */
  changed(structure: boolean): void;
  /** "move" or "animation" (for messages). */
  noun: string;
  /** The tags its animations use most, listed first when a tag is added. */
  tags?: string[];
}

export class AnimPanel {
  el: HTMLElement;
  id = 0;
  private tokens: AnimTokens = { frames: [], trailing: [] };
  private frame = 0;
  private spriteSel = 0;
  private playing = false;
  private tick = 0;
  private raf = 0;
  private lastTime = 0;
  private speed = 1;
  private onion = false;
  private showHits = true;
  private zoomed = true;
  private stageCanvas = h('canvas', { class: 'pix', style: { width: '100%', height: '100%', display: 'block' } });
  private center = h('div', { class: 'col', style: { flex: '1 1 480px', minWidth: '0', padding: '12px 12px 20px' } });
  private right = h('div', { style: { flex: '0 0 340px', minWidth: '0', padding: '0 12px 20px' } });
  private timeline = h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '4px' } });
  private sprites = h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '8px' } });
  private tickInfo = h('span', { class: 'muted' });
  private images = new Map<Sprite, HTMLCanvasElement>();
  private resize = new ResizeObserver(() => this.draw());
  private playButton = h('button', { class: 'btn small', onclick: () => this.togglePlay() }, '▶ Play');

  constructor(private host: AnimPanelHost) {
    const stageBox = h('div', { style: { height: '340px', background: '#070a13', border: '1px solid var(--line)', borderRadius: '8px', overflow: 'hidden' } }, this.stageCanvas);
    this.resize.observe(stageBox);
    const controls = h('div', { class: 'row', style: { alignItems: 'center' } },
      this.playButton,
      h('button', { class: 'btn small', onclick: () => this.step(-1), title: 'Previous frame' }, '◀'),
      h('button', { class: 'btn small', onclick: () => this.step(1), title: 'Next frame' }, '▶'),
      select<number>([[0.25, '¼ speed'], [0.5, '½ speed'], [1, 'Game speed'], [2, 'Fast']], () => this.speed, (v) => (this.speed = v)),
      h('label', { class: 'muted' }, h('input', { type: 'checkbox', checked: this.showHits, onchange: (e: Event) => ((this.showHits = (e.target as HTMLInputElement).checked), this.draw()) }), ' Hit points'),
      h('label', { class: 'muted' }, h('input', { type: 'checkbox', onchange: (e: Event) => ((this.onion = (e.target as HTMLInputElement).checked), this.draw()) }), ' Onion skin'),
      h('label', { class: 'muted', title: 'Zoom on the animation, or show the whole stage' },
        h('input', { type: 'checkbox', checked: this.zoomed, onchange: (e: Event) => ((this.zoomed = (e.target as HTMLInputElement).checked), this.draw()) }), ' Zoom'),
      this.tickInfo);
    fill(this.center, stageBox, controls,
      h('div', { class: 'card', style: { marginBottom: '0' } }, h('h2', null, 'FRAMES', h('span', { class: 'spacer' }),
        h('button', { class: 'btn small', onclick: () => this.addFrame(), title: 'A frame after this one' }, '+ Frame'),
        h('button', { class: 'btn small', onclick: () => this.moveFrame(-1), title: 'Move the frame earlier' }, '←'),
        h('button', { class: 'btn small', onclick: () => this.moveFrame(1), title: 'Move the frame later' }, '→'),
        h('button', { class: 'btn small danger', onclick: () => this.deleteFrame() }, 'Delete frame')), this.timeline),
      h('div', { class: 'card', style: { marginBottom: '0' } }, h('h2', null, 'SPRITES', h('span', { class: 'spacer' }),
        h('button', { class: 'btn small primary', onclick: () => void this.editSprite(), title: 'Draw the selected sprite (double click one)' }, 'Draw'),
        h('button', { class: 'btn small', onclick: () => this.addSprite(false), title: 'An empty sprite' }, '+ Empty'),
        h('button', { class: 'btn small', onclick: () => this.addSprite(true), title: 'A copy of the selected sprite' }, 'Duplicate'),
        h('button', { class: 'btn small', onclick: () => void this.importSprites(), title: 'New sprites from PNG pictures' }, 'Import PNG'),
        h('button', { class: 'btn small', onclick: () => void this.exportSprite(), title: 'Save the selected sprite as a PNG' }, 'Export PNG'),
        h('button', { class: 'btn small danger', onclick: () => void this.deleteSprite() }, 'Delete')), this.sprites));
    // (the frame panel goes under the preview when the window is narrow)
    this.el = h('div', { style: { overflow: 'auto', minWidth: '0' } }, h('div', { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start' } }, this.center, this.right));
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.resize.disconnect();
  }

  get anim(): AnimationData | null {
    return this.host.get(this.id);
  }

  /** Shows the animation in a slot. */
  load(id: number): void {
    this.id = id;
    this.frame = 0;
    this.spriteSel = 0;
    this.tick = 0;
    this.stop();
    this.images.clear();
    const a = this.anim;
    this.tokens = a ? parseAnim(a.animString) : { frames: [], trailing: [] };
    this.renderAll();
  }

  /** Redraws everything (after the host changed the animation or the colors). */
  refresh(): void {
    this.images.clear();
    const a = this.anim;
    this.tokens = a ? parseAnim(a.animString) : { frames: [], trailing: [] };
    this.frame = Math.max(0, Math.min(this.frame, this.tokens.frames.length - 1));
    this.renderAll();
  }

  private renderAll(): void {
    this.renderTimeline();
    this.renderSprites();
    this.renderRight();
    this.draw();
  }

  /** The animation string changed (tokens edited): write it back, keep the selection in range. */
  private commitAnim(): void {
    const a = this.anim;
    if (!a) return;
    fixSeparators(this.tokens);
    a.animString = formatAnim(this.tokens);
    this.frame = Math.max(0, Math.min(this.frame, this.tokens.frames.length - 1));
    this.host.changed(false);
    this.renderTimeline();
    this.renderRight();
    this.draw();
  }

  // ---- preview ---------------------------------------------------------------------------------------------------

  private image(s: Sprite): HTMLCanvasElement | null {
    if (s.isEmpty()) return null;
    let c = this.images.get(s);
    if (!c) {
      c = indexedCanvas(s.pixels(), s.width, s.height, this.host.palette());
      this.images.set(s, c);
    }
    return c;
  }

  private spriteOf(frameIndex: number): Sprite | null {
    const f = this.tokens.frames[frameIndex];
    return f ? this.anim?.sprites[f.sprite] ?? null : null;
  }

  /** The part of the stage the preview shows: [x, y, w, h]. */
  private viewRect(st: StageSetup): [number, number, number, number] {
    const a = this.anim;
    if (st.centred || !a || st.whole || !this.zoomed) return [st.left, 0, st.width, st.height];
    const [x0o, y0o] = st.origin;
    let x0 = x0o - 40, x1 = x0o + 40, y0 = y0o - 60, y1 = y0o + 8;
    if (st.floor !== null) {
      y0 = Math.min(y0, st.floor - 100);
      y1 = Math.max(y1, st.floor + 8);
    }
    // (the sprites' box: the view leaves the stage only where they do)
    let sx0 = x0o, sx1 = x0o, sy0 = y0o, sy1 = y0o;
    for (const s of a.sprites) {
      if (s.isEmpty() || s.width > 1000) continue;
      sx0 = Math.min(sx0, x0o + s.posX);
      sx1 = Math.max(sx1, x0o + s.posX + s.width);
      sy0 = Math.min(sy0, y0o + s.posY);
      sy1 = Math.max(sy1, y0o + s.posY + s.height);
    }
    const pad = 12;
    x0 = Math.max(Math.min(x0, sx0) - pad, Math.min(st.left, sx0 - 2));
    x1 = Math.min(Math.max(x1, sx1) + pad, Math.max(st.left + st.width, sx1 + 2));
    y0 = Math.max(Math.min(y0, sy0) - pad, Math.min(0, sy0 - 2));
    y1 = Math.min(Math.max(y1, sy1) + pad, Math.max(st.height, sy1 + 2));
    return [x0, y0, x1 - x0, y1 - y0];
  }

  draw(): void {
    const c = this.stageCanvas;
    const r = c.getBoundingClientRect();
    if (!r.width) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(r.width * dpr);
    c.height = Math.round(r.height * dpr);
    const g = c.getContext('2d')!;
    const st = this.host.stage(this.id);
    // The view as big as fits in whole pixels.
    const [vx, vy, vw, vh] = this.viewRect(st);
    const k = Math.max(1, Math.floor(Math.min(c.width / vw, c.height / vh)));
    const ox = Math.round((c.width - vw * k) / 2 - vx * k), oy = Math.round((c.height - vh * k) / 2 - vy * k);
    g.imageSmoothingEnabled = false;
    const floor = st.floor ?? st.height;
    const grad = g.createLinearGradient(0, 0, 0, oy + floor * k);
    grad.addColorStop(0, '#0a1122');
    grad.addColorStop(1, '#16223f');
    g.fillStyle = grad;
    g.fillRect(0, 0, c.width, c.height);
    if (st.backdrop) {
      g.drawImage(st.backdrop.canvas, ox + st.backdrop.x * k, oy + st.backdrop.y * k, st.backdrop.canvas.width * k, st.backdrop.canvas.height * k);
      // (the classic screen's edges, when the widescreen sides are shown)
      if (st.left < 0) {
        g.strokeStyle = 'rgba(255, 255, 255, .25)';
        g.setLineDash([4, 4]);
        g.strokeRect(ox + 0.5, oy + 0.5, 320 * k, 200 * k);
        g.setLineDash([]);
      }
    }
    if (st.floor !== null) {
      g.fillStyle = '#1b2440';
      g.fillRect(0, oy + st.floor * k, c.width, c.height);
      g.strokeStyle = 'rgba(255, 183, 64, .5)';
      g.beginPath();
      g.moveTo(0, oy + st.floor * k + 0.5);
      g.lineTo(c.width, oy + st.floor * k + 0.5);
      g.stroke();
    }
    const a = this.anim;
    const [x0, y0] = st.origin;
    const put = (s: Sprite | null, alpha: number) => {
      if (!s) return;
      const img = this.image(s);
      if (!img) return;
      g.globalAlpha = alpha;
      const px = st.centred ? st.left + (st.width - s.width) / 2 : x0 + s.posX, py = st.centred ? (st.height - s.height) / 2 : y0 + s.posY;
      g.drawImage(img, ox + px * k, oy + py * k, s.width * k, s.height * k);
      g.globalAlpha = 1;
    };
    if (a && this.tokens.frames.length) {
      if (this.onion && this.frame > 0) put(this.spriteOf(this.frame - 1), 0.3);
      put(this.spriteOf(this.frame), 1);
      const spriteIndex = this.tokens.frames[this.frame]?.sprite ?? -1;
      if (this.showHits && !st.centred) {
        for (const p of a.coords) {
          if (p.frameId !== spriteIndex) continue;
          const px = ox + (x0 + p.x) * k + k / 2, py = oy + (y0 + p.y) * k + k / 2;
          g.fillStyle = 'rgba(255, 70, 60, .95)';
          g.beginPath();
          g.arc(px, py, Math.max(2.5, k * 1.2), 0, Math.PI * 2);
          g.fill();
        }
      }
    }
    if (!st.centred) {
      // Where it is placed.
      g.strokeStyle = 'rgba(60, 195, 255, .8)';
      g.beginPath();
      g.moveTo(ox + x0 * k - 6 * k, oy + y0 * k + 0.5);
      g.lineTo(ox + x0 * k + 6 * k, oy + y0 * k + 0.5);
      g.moveTo(ox + x0 * k + 0.5, oy + y0 * k - 6 * k);
      g.lineTo(ox + x0 * k + 0.5, oy + y0 * k + 6 * k);
      g.stroke();
    }
    const total = totalTicks(this.tokens);
    const f = this.tokens.frames[this.frame];
    const nothing = f && f.sprite >= (this.anim?.sprites.length ?? 0) ? ' (nothing)' : '';
    this.tickInfo.textContent = f ? `Frame ${this.frame + 1} of ${this.tokens.frames.length} · sprite ${String.fromCharCode(65 + f.sprite)}${nothing} · ` +
      `${f.ticks} ticks · the ${this.host.noun} lasts ${total} ticks (${((total * TICK_MS) / 1000).toFixed(2)} s)` : 'No frames';
  }

  private togglePlay(): void {
    if (this.playing) this.stop();
    else this.play();
  }

  private play(): void {
    if (!this.tokens.frames.length) return;
    this.playing = true;
    this.playButton.textContent = '⏸ Pause';
    this.tick = this.tokens.frames.slice(0, this.frame).reduce((acc, f) => acc + f.ticks, 0);
    this.lastTime = performance.now();
    const loop = (now: number) => {
      if (!this.playing) return;
      this.tick += ((now - this.lastTime) / TICK_MS) * this.speed;
      this.lastTime = now;
      const total = totalTicks(this.tokens);
      if (total > 0) {
        const f = frameAtTick(this.tokens, this.tick % total);
        if (f !== this.frame) {
          this.frame = f;
          this.markTimeline();
          this.draw();
        }
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private stop(): void {
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.playButton.textContent = '▶ Play';
  }

  private step(d: number): void {
    this.stop();
    const n = this.tokens.frames.length;
    if (!n) return;
    this.frame = (this.frame + d + n) % n;
    this.spriteSel = this.tokens.frames[this.frame].sprite;
    this.markTimeline();
    this.renderRight();
    this.renderSprites();
    this.draw();
  }

  // ---- frames ----------------------------------------------------------------------------------------------------

  private renderTimeline(): void {
    if (!this.anim) {
      fill(this.timeline, h('span', { class: 'muted' }, `This slot has no ${this.host.noun}.`));
      return;
    }
    fill(this.timeline, this.tokens.frames.map((f, i) => {
      const tags = f.tags.filter((t) => t.name).length;
      return h('div', {
        class: 'btn small', 'data-frame': String(i), title: f.tags.map((t) => t.raw).join(' ') || 'No tags',
        style: { fontFamily: 'var(--mono)', minWidth: '52px', justifyContent: 'center' },
        onclick: () => {
          this.stop();
          this.frame = i;
          this.spriteSel = f.sprite;
          this.markTimeline();
          this.renderRight();
          this.renderSprites();
          this.draw();
        },
      }, `${String.fromCharCode(65 + f.sprite)}${f.ticks}`, tags ? h('span', { class: 'badge', style: { padding: '0 5px' } }, String(tags)) : null);
    }));
    this.markTimeline();
  }

  private markTimeline(): void {
    this.timeline.querySelectorAll<HTMLElement>('[data-frame]').forEach((el) => el.classList.toggle('active', Number(el.dataset.frame) === this.frame));
  }

  private addFrame(): void {
    if (!this.anim) return;
    const cur = this.tokens.frames[this.frame];
    this.tokens.frames.splice(this.frame + 1, 0, newFrame(cur?.sprite ?? 0, cur?.ticks ?? 4));
    this.frame = Math.min(this.frame + 1, this.tokens.frames.length - 1);
    this.commitAnim();
  }

  private moveFrame(d: number): void {
    const i = this.frame, j = i + d;
    if (j < 0 || j >= this.tokens.frames.length) return;
    const fr = this.tokens.frames;
    [fr[i], fr[j]] = [fr[j], fr[i]];
    // (the separators stay in place: a frame that became the last may keep one, which the engine ignores)
    this.frame = j;
    this.commitAnim();
  }

  private deleteFrame(): void {
    if (this.tokens.frames.length <= 1) {
      toast(`A ${this.host.noun} needs one frame at least.`, true);
      return;
    }
    this.tokens.frames.splice(this.frame, 1);
    this.commitAnim();
  }

  // ---- the right side: the frame, the host's cards, the raw string ---------------------------------------------

  renderRight(): void {
    const a = this.anim;
    if (!a) {
      fill(this.right, this.host.emptyCard(this.id));
      return;
    }
    fill(this.right, this.frameCard(a), ...this.host.cards(this.id, a), this.stringCard(a));
  }

  private frameCard(a: AnimationData): HTMLElement {
    const f = this.tokens.frames[this.frame];
    if (!f) return h('div', { class: 'card', style: { marginTop: '12px' } }, h('h2', null, 'FRAME'), h('p', { class: 'muted' }, 'No frames.'));
    const letters: [number, string][] = a.sprites.map((_, i) => [i, String.fromCharCode(65 + i)]);
    // (a letter the animation has no sprite for shows nothing: the originals use Z)
    for (const n of new Set([f.sprite, 25])) if (n >= a.sprites.length) letters.push([n, `${String.fromCharCode(65 + n)} (nothing)`]);
    letters.sort((p, q) => p[0] - q[0]);
    const allTags = tagChoices(TAG_TABLE.map(([n]) => n), this.host.tags);
    let newTagName = allTags[0];
    const tagRows = f.tags.map((t, i) => h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', margin: '3px 0' } },
      t.name ? h('code', { style: { minWidth: '36px', color: 'var(--accent)' } }, t.name) : h('code', { class: 'faint', title: 'The game skips this text' }, t.raw),
      t.name && t.value !== null ? numberInput(() => t.value!, (v) => {
        f.tags[i] = newTag(t.name, v);
        this.commitAnim();
      }, -32768, 32767) : null,
      h('span', { class: 'faint', style: { flex: '1', fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: TAG_HELP[t.name] ?? '' },
        t.name ? TAG_HELP[t.name] ?? '' : 'skipped by the game'),
      h('button', { class: 'btn small', onclick: () => {
        f.tags.splice(i, 1);
        this.commitAnim();
      } }, '✕')));
    return h('div', { class: 'card', style: { marginTop: '12px' } },
      h('h2', null, `FRAME ${this.frame + 1}`),
      h('div', { class: 'row' },
        field('Sprite', select<number>(letters, () => f.sprite, (v) => {
          setFrame(f, v, f.ticks);
          this.spriteSel = v;
          this.commitAnim();
          this.renderSprites();
        })),
        field('Ticks', numberInput(() => f.ticks, (v) => {
          setFrame(f, f.sprite, v);
          this.commitAnim();
        }, 0, 9999), `${TICK_MS} ms each`)),
      h('div', { style: { marginTop: '10px' } }, h('div', { class: 'muted', style: { fontSize: '12px', marginBottom: '4px' } }, 'Tags (what happens on this frame)'),
        tagRows.length ? tagRows : h('div', { class: 'faint' }, 'None'),
        h('div', { class: 'row', style: { marginTop: '6px', alignItems: 'center' } },
          select<string>(allTags.map((n) => [n, `${n}${TAG_HELP[n] ? ` — ${TAG_HELP[n]}` : ''}`]), () => newTagName, (v) => (newTagName = v)),
          h('button', { class: 'btn small', onclick: () => {
            f.tags.push(newTag(newTagName, tagHasValue(newTagName) ? 0 : null));
            this.commitAnim();
          } }, 'Add tag'))));
  }

  /** The animation string as the file stores it (edited directly: checked like the game reads it). */
  private stringCard(a: AnimationData): HTMLElement {
    const raw = h('textarea', { class: 'code', rows: 4 }, a.animString);
    raw.addEventListener('change', () => {
      try {
        decodeScript(raw.value);
        a.animString = raw.value;
        this.tokens = parseAnim(raw.value);
        this.commitAnim();
      } catch {
        toast('That is not an animation string the game reads.', true);
        raw.value = a.animString;
      }
    });
    return h('details', { class: 'card' },
      h('summary', { style: { cursor: 'pointer', font: '700 12px var(--title)', letterSpacing: '.14em', color: '#a9c4ff' } }, 'ANIMATION STRING'),
      h('div', { style: { marginTop: '10px' } }, field('As the file stores it', raw, 'frames: a sprite letter and ticks, "-" between them, tags before')));
  }

  // ---- sprites ---------------------------------------------------------------------------------------------------

  renderSprites(): void {
    const a = this.anim;
    if (!a) {
      fill(this.sprites);
      return;
    }
    const all = this.host.all();
    fill(this.sprites, a.sprites.map((s, i) => {
      const img = this.image(s);
      const box = h('div', {
        style: {
          width: '76px', height: '92px', border: `1px solid ${i === this.spriteSel ? 'var(--accent)' : 'var(--line)'}`, borderRadius: '6px',
          background: '#070a13', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between', padding: '4px', cursor: 'pointer',
        },
        onclick: () => {
          this.spriteSel = i;
          this.renderSprites();
        },
        ondblclick: () => {
          this.spriteSel = i;
          void this.editSprite();
        },
      });
      if (img) {
        const k = Math.min(64 / s.width, 64 / s.height, 2);
        img.className = 'pix';
        img.style.width = `${Math.max(1, s.width * k)}px`;
        img.style.height = `${Math.max(1, s.height * k)}px`;
        box.append(h('div', { style: { flex: '1', display: 'grid', placeItems: 'center' } }, img));
      } else box.append(h('div', { class: 'faint', style: { flex: '1', display: 'grid', placeItems: 'center' } }, 'empty'));
      const shared = sharedGroup(all, s).length;
      box.append(h('div', { style: { fontSize: '11px', display: 'flex', gap: '4px' } }, h('b', null, String.fromCharCode(65 + i)),
        shared > 1 ? h('span', { class: 'badge', title: `The same picture as ${shared - 1} other sprite(s) of the file` }, `×${shared}`) : null));
      return box;
    }));
  }

  private async editSprite(): Promise<void> {
    const a = this.anim;
    const s = a?.sprites[this.spriteSel];
    if (!a || !s) return;
    const all = this.host.all();
    const group = sharedGroup(all, s);
    let everywhere = true;
    if (group.length > 1) {
      const choice = await modal<'all' | 'one'>((close) => h('div', { class: 'modal', style: { width: '480px' } },
        h('h2', null, 'A shared picture'),
        h('p', { class: 'muted' }, `This picture is also shown by ${group.length - 1} other sprite(s) (the file stores it once). ` +
          'Change it everywhere, or make this sprite a picture of its own?'),
        h('div', { class: 'actions' },
          h('button', { class: 'btn', onclick: () => close(null) }, 'Cancel'),
          h('button', { class: 'btn', onclick: () => close('one') }, 'This one only'),
          h('button', { class: 'btn primary', onclick: () => close('all') }, 'Everywhere'))));
      if (!choice) return;
      everywhere = choice === 'all';
    }
    const px = this.host.pixel(this.id);
    const prev = this.frame > 0 ? this.spriteOf(this.frame - 1) : null;
    const onionSprite = prev && prev !== s && !prev.isEmpty() && !px.fixed ? prev : null;
    const empty = s.isEmpty();
    const coords = a.coords.filter((c) => c.frameId === this.spriteSel);
    const result = await editPixels({
      title: this.host.spriteTitle(this.id, this.spriteSel),
      picture: { pixels: empty ? new Uint8Array(1) : s.pixels(), w: empty ? 1 : s.width, h: empty ? 1 : s.height, posX: s.posX, posY: s.posY },
      palette: this.host.palette(),
      entries: px.entries,
      groups: px.groups,
      fixed: px.fixed,
      onion: onionSprite ? { pixels: onionSprite.pixels(), w: onionSprite.width, h: onionSprite.height, posX: onionSprite.posX, posY: onionSprite.posY } : null,
      hitPoints: px.hitPoints ? coords.map((c) => ({ x: c.x, y: c.y })) : null,
      floorY: px.floorY,
      fileName: this.host.spriteFile(this.id, this.spriteSel),
    });
    if (!result) return;
    const dx = result.posX - s.posX, dy = result.posY - s.posY;
    if (everywhere) {
      setPicture(group, result.pixels, result.w, result.h);
      for (const x of group) {
        x.posX += dx;
        x.posY += dy;
      }
    } else {
      detach(all, s);
      setPicture([s], result.pixels, result.w, result.h);
      s.posX = result.posX;
      s.posY = result.posY;
    }
    if (result.hitPoints) {
      const other = a.coords.filter((c) => c.frameId !== this.spriteSel);
      a.coords = [...other, ...result.hitPoints.map((p) => ({ x: p.x, y: p.y, nullValue: 0, frameId: this.spriteSel }))];
    }
    this.images.clear();
    this.host.changed(true);
    this.renderSprites();
    this.draw();
  }

  private addSprite(copy: boolean): void {
    const a = this.anim;
    if (!a) return;
    if (a.sprites.length >= 26) {
      toast('An animation can show 26 sprites (A to Z).', true);
      return;
    }
    const cur = a.sprites[this.spriteSel];
    const [x, y] = this.host.importPosition(this.id, 40, 80);
    a.sprites.push(copy && cur ? copySprite(cur) : blankSprite(cur?.posX ?? x, cur?.posY ?? y));
    this.spriteSel = a.sprites.length - 1;
    this.host.changed(true);
    this.renderSprites();
    this.renderRight();
  }

  private async importSprites(): Promise<void> {
    const a = this.anim;
    if (!a) return;
    const files = await pickFiles('.png,image/png', true);
    let n = 0;
    for (const f of files.sort((p, q) => p.name.localeCompare(q.name))) {
      if (a.sprites.length >= 26) break;
      try {
        const img = await pngToPixels(new Uint8Array(await f.arrayBuffer()), this.host.palette(), this.host.pixel(this.id).entries);
        const [px, w, hh, dx, dy] = trim(img.pixels, img.w, img.h);
        const [x, y] = this.host.importPosition(this.id, img.w, img.h);
        const s = blankSprite(x + dx, y + dy);
        setPicture([s], px, w, hh);
        a.sprites.push(s);
        n++;
      } catch (err) {
        toast(`${f.name}: ${(err as Error)?.message ?? err}`, true);
      }
    }
    if (!n) return;
    this.spriteSel = a.sprites.length - 1;
    this.images.clear();
    this.host.changed(true);
    this.renderSprites();
    this.renderRight();
    toast(`${n} sprite${n === 1 ? '' : 's'} imported: set their frames' sprite letters to show them.`);
  }

  private async exportSprite(): Promise<void> {
    const s = this.anim?.sprites[this.spriteSel];
    if (!s) return;
    const name = this.host.spriteFile(this.id, this.spriteSel);
    try {
      await saveFile(name, await spritePng(s, this.host.palette()), 'image/png');
      toast(`Saved ${name}`);
    } catch {
      toast('The picture could not be saved.', true);
    }
  }

  private async deleteSprite(): Promise<void> {
    const a = this.anim;
    if (!a) return;
    const i = this.spriteSel;
    if (this.tokens.frames.some((f) => f.sprite === i)) {
      toast('A frame shows this sprite: give the frames another sprite first.', true);
      return;
    }
    if (a.sprites.length <= 1) return;
    // (its copies keep the picture)
    detach(this.host.all(), a.sprites[i]);
    a.sprites.splice(i, 1);
    // Letters after it move up one; so do their hit points (the frames that show nothing keep their letter).
    for (const f of this.tokens.frames) if (f.sprite > i && f.sprite <= a.sprites.length) setFrame(f, f.sprite - 1, f.ticks);
    a.coords = a.coords.filter((c) => c.frameId !== i).map((c) => (c.frameId > i ? { ...c, frameId: c.frameId - 1 } : c));
    this.spriteSel = Math.max(0, i - 1);
    this.commitAnim();
    this.host.changed(true);
    this.renderSprites();
  }
}
