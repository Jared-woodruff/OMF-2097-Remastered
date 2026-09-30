// A robot's moves in OMF Studio: the seventy slots of its fighter file, and for the selected one its animation (a
// preview at the game's pace with the hit points, the frames and their tags), what it does in a fight (its input,
// kind, damage, the victim's reaction...) and its sprites, drawn in the pixel editor.
import type { AfMoveData } from '../../formats/af';
import type { Sprite } from '../../formats/sprite';
import { decodeScript } from '../../script/script';
import { TAG_TABLE } from '../../script/tags';
import { REQUIRED_MOVES } from '../../mods/types';
import {
  fixSeparators, formatAnim, frameAtTick, newFrame, newTag, parseAnim, setFrame, tagHasValue, totalTicks, type AnimTokens,
} from '../anim';
import type { StudioApp } from '../app';
import { indexedCanvas, RAMP_ENTRIES, robotPalette, ROBOT_ENTRIES } from '../colors';
import { confirmDialog, field, fill, h, modal, numberInput, pickFiles, select, toast } from '../dom';
import { editPixels } from '../pixel';
import type { RobotDoc } from '../project';
import { blankSprite, copySprite, detach, pngToPixels, setPicture, sharedGroup, spritePng, trim } from '../sprites';
import { saveFile } from '../../platform/files';
import { CATEGORIES, DIRECTIONS, EXTRA_SELECTORS, inputText, moveLabel, REACTIONS, SHARED_MOVES, TAG_HELP, tagChoices } from './moves';
import { CELL_BACKGROUND, copyMove, newMove } from './model';

/** Where robots stand in the preview (the game's floor) and the preview's size. */
const STAGE_W = 320, STAGE_H = 210, FLOOR = 190;
/** Milliseconds a tick lasts at the game's default speed (settings speed 5: 8 + 60 - 5/15 * 60). */
const TICK_MS = 48;
/** Jump sprites are stored 60 pixels lower (the game moves them up when it loads the move). */
const JUMP_ADJUST = 60;

/** What the engine's own animations are for. */
const ENGINE_MOVES: Record<number, string> = {
  1: 'Played while the robot jumps. Its sprites are stored 60 pixels lower than they show (the game moves them up); the preview shows them where they play.',
  2: 'Getting up after being knocked down.',
  3: 'Stunned (dizzy) after too many hits.',
  4: 'Crouching.',
  5: 'Blocking standing.',
  6: 'Blocking crouched.',
  7: 'The burning oil effect (shared by every robot: the original game\'s is used when the robot has none).',
  8: 'The sparks of a blocked hit (shared).',
  9: 'The damage sheet: the frames other robots\' hits show. A hit\'s reaction string (in the move that hits) picks them: A-F standing, L-M knocked down, and so on.',
  10: 'Walking (played forwards and backwards).',
  11: 'Standing still.',
  12: 'Scrap metal flying off (shared).',
  13: 'A bolt flying off (shared).',
  14: 'A screw flying off (shared).',
  48: 'The victory pose after winning a round.',
  49: 'Knocked out.',
  55: 'A blast (shared).',
  56: 'A blast (shared).',
  57: 'A blast (shared).',
  60: 'The robot select screen\'s picture (51 x 36, its background color see-through there).',
  61: 'The VS screen\'s picture.',
};

export class MoveEditor {
  el: HTMLElement;
  private moveId: number;
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
  private stage = h('canvas', { class: 'pix', style: { width: '100%', height: '100%', display: 'block' } });
  private list = h('div', { style: { overflow: 'auto', borderRight: '1px solid var(--line)' } });
  private center = h('div', { class: 'col', style: { flex: '1 1 480px', minWidth: '0', padding: '12px 12px 20px' } });
  private right = h('div', { style: { flex: '0 0 340px', minWidth: '0', padding: '0 12px 20px' } });
  private timeline = h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '4px' } });
  private sprites = h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '8px' } });
  private tickInfo = h('span', { class: 'muted' });
  private images = new Map<Sprite, HTMLCanvasElement>();
  private resize = new ResizeObserver(() => this.draw());
  private playButton = h('button', { class: 'btn small', onclick: () => this.togglePlay() }, '▶ Play');

  constructor(private app: StudioApp, private robot: RobotDoc, moveId = 11) {
    this.moveId = moveId;
    const stageBox = h('div', { style: { height: '340px', background: '#070a13', border: '1px solid var(--line)', borderRadius: '8px', overflow: 'hidden' } }, this.stage);
    this.resize.observe(stageBox);
    const controls = h('div', { class: 'row', style: { alignItems: 'center' } },
      this.playButton,
      h('button', { class: 'btn small', onclick: () => this.step(-1), title: 'Previous frame' }, '◀'),
      h('button', { class: 'btn small', onclick: () => this.step(1), title: 'Next frame' }, '▶'),
      select<number>([[0.25, '¼ speed'], [0.5, '½ speed'], [1, 'Game speed'], [2, 'Fast']], () => this.speed, (v) => (this.speed = v)),
      h('label', { class: 'muted' }, h('input', { type: 'checkbox', checked: this.showHits, onchange: (e: Event) => ((this.showHits = (e.target as HTMLInputElement).checked), this.draw()) }), ' Hit points'),
      h('label', { class: 'muted' }, h('input', { type: 'checkbox', onchange: (e: Event) => ((this.onion = (e.target as HTMLInputElement).checked), this.draw()) }), ' Onion skin'),
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
    // (the frame and move panel goes under the preview when the window is narrow)
    this.el = h('div', { style: { display: 'grid', gridTemplateColumns: '220px minmax(0, 1fr)', height: '100%', minHeight: '0' } },
      this.list, h('div', { style: { overflow: 'auto', minWidth: '0' } }, h('div', { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start' } }, this.center, this.right)));
    this.load(moveId);
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.resize.disconnect();
  }

  private get move(): AfMoveData | null {
    return this.robot.af.moves[this.moveId] ?? null;
  }

  private get pal() {
    return robotPalette(this.app.colors);
  }

  // ---- the move list ---------------------------------------------------------------------------------------------

  private renderList(): void {
    const af = this.robot.af;
    const row = (id: number) => {
      const m = af.moves[id];
      const required = REQUIRED_MOVES.includes(id);
      const shared = SHARED_MOVES.includes(id) && !m;
      return h('div', {
        class: `item${id === this.moveId ? ' sel' : ''}`, style: { padding: '4px 10px', gap: '6px', opacity: m ? '1' : '.55' },
        onclick: () => this.load(id), title: shared ? 'The original game\'s is used when the robot has none' : '',
      },
      h('span', { class: 'faint', style: { width: '20px', textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '11px' } }, String(id)),
      h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis' } }, moveLabel(id, m) + (shared ? ' (shared)' : '')),
      required && !m ? h('span', { class: 'badge bad', style: { marginLeft: 'auto' } }, 'needed') : null,
      this.robot.info.moves[id] ? h('span', { class: 'badge', style: { marginLeft: 'auto' } }, this.robot.info.moves[id]) : null);
    };
    const used = [...Array(70).keys()].filter((id) => af.moves[id] || REQUIRED_MOVES.includes(id) || SHARED_MOVES.includes(id) || id === 60 || id === 61);
    const free = [...Array(70).keys()].filter((id) => id >= 15 && !af.moves[id] && !used.includes(id));
    fill(this.list,
      h('div', { style: { padding: '8px 10px', display: 'flex', gap: '6px' } },
        h('button', { class: 'btn small', onclick: () => void this.newMoveDialog(free) }, '+ New move')),
      used.map(row));
    this.list.querySelector('.item.sel')?.scrollIntoView({ block: 'nearest' });
  }

  // ---- loading a move --------------------------------------------------------------------------------------------

  load(id: number): void {
    this.moveId = id;
    this.frame = 0;
    this.spriteSel = 0;
    this.tick = 0;
    this.stop();
    const m = this.move;
    this.tokens = m ? parseAnim(m.animation.animString) : { frames: [], trailing: [] };
    this.renderList();
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
    const m = this.move;
    if (!m) return;
    fixSeparators(this.tokens);
    m.animation.animString = formatAnim(this.tokens);
    this.frame = Math.max(0, Math.min(this.frame, this.tokens.frames.length - 1));
    this.app.changed(false);
    this.renderTimeline();
    this.renderRight();
    this.draw();
  }

  // ---- preview ---------------------------------------------------------------------------------------------------

  private image(s: Sprite): HTMLCanvasElement | null {
    if (s.isEmpty()) return null;
    let c = this.images.get(s);
    if (!c) {
      c = indexedCanvas(s.pixels(), s.width, s.height, this.pal);
      this.images.set(s, c);
    }
    return c;
  }

  private spriteOf(frameIndex: number): Sprite | null {
    const f = this.tokens.frames[frameIndex];
    return f ? this.move?.animation.sprites[f.sprite] ?? null : null;
  }

  private draw(): void {
    const c = this.stage;
    const r = c.getBoundingClientRect();
    if (!r.width) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(r.width * dpr);
    c.height = Math.round(r.height * dpr);
    const g = c.getContext('2d')!;
    // The view: the move's sprites (all of them, so it does not jump while playing) and the floor, as big as fits in
    // whole pixels.
    const [vx, vy, vw, vh] = this.viewRect();
    const k = Math.max(1, Math.floor(Math.min(c.width / vw, c.height / vh)));
    const ox = Math.round((c.width - vw * k) / 2 - vx * k), oy = Math.round((c.height - vh * k) / 2 - vy * k);
    g.imageSmoothingEnabled = false;
    const grad = g.createLinearGradient(0, 0, 0, oy + FLOOR * k);
    grad.addColorStop(0, '#0a1122');
    grad.addColorStop(1, '#16223f');
    g.fillStyle = grad;
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#1b2440';
    g.fillRect(0, oy + FLOOR * k, c.width, c.height);
    g.strokeStyle = 'rgba(255, 183, 64, .5)';
    g.beginPath();
    g.moveTo(0, oy + FLOOR * k + 0.5);
    g.lineTo(c.width, oy + FLOOR * k + 0.5);
    g.stroke();
    const m = this.move;
    const x0 = 160, y0 = FLOOR - (this.moveId === 1 ? JUMP_ADJUST : 0);
    const isPicture = this.moveId === 60 || this.moveId === 61;
    const put = (s: Sprite | null, alpha: number) => {
      if (!s) return;
      const img = this.image(s);
      if (!img) return;
      g.globalAlpha = alpha;
      const px = isPicture ? (STAGE_W - s.width) / 2 : x0 + s.posX, py = isPicture ? (STAGE_H - s.height) / 2 : y0 + s.posY;
      g.drawImage(img, ox + px * k, oy + py * k, s.width * k, s.height * k);
      g.globalAlpha = 1;
    };
    if (m && this.tokens.frames.length) {
      if (this.onion && this.frame > 0) put(this.spriteOf(this.frame - 1), 0.3);
      const s = this.spriteOf(this.frame);
      put(s, 1);
      const spriteIndex = this.tokens.frames[this.frame]?.sprite ?? -1;
      if (this.showHits && !isPicture) {
        for (const p of m.animation.coords) {
          if (p.frameId !== spriteIndex) continue;
          const px = ox + (x0 + p.x) * k + k / 2, py = oy + (y0 + p.y) * k + k / 2;
          g.fillStyle = 'rgba(255, 70, 60, .95)';
          g.beginPath();
          g.arc(px, py, Math.max(2.5, k * 1.2), 0, Math.PI * 2);
          g.fill();
        }
      }
    }
    if (!isPicture) {
      g.strokeStyle = 'rgba(60, 195, 255, .7)';
      g.beginPath();
      g.moveTo(ox + x0 * k - 6 * k, oy + FLOOR * k + 0.5);
      g.lineTo(ox + x0 * k + 6 * k, oy + FLOOR * k + 0.5);
      g.stroke();
    }
    const total = totalTicks(this.tokens);
    const f = this.tokens.frames[this.frame];
    this.tickInfo.textContent = f ? `Frame ${this.frame + 1} of ${this.tokens.frames.length} · sprite ${String.fromCharCode(65 + f.sprite)} · ` +
      `${f.ticks} ticks · the move lasts ${total} ticks (${((total * TICK_MS) / 1000).toFixed(2)} s)` : 'No frames';
  }

  /** The part of the stage the preview shows: [x, y, w, h]. */
  private viewRect(): [number, number, number, number] {
    const m = this.move;
    if (this.moveId === 60 || this.moveId === 61 || !m) return [0, 0, STAGE_W, STAGE_H];
    const dy = this.moveId === 1 ? -JUMP_ADJUST : 0;
    let x0 = 160 - 40, x1 = 160 + 40, y0 = FLOOR - 100, y1 = FLOOR + 8;
    for (const s of m.animation.sprites) {
      if (s.isEmpty() || s.width > 1000) continue;
      x0 = Math.min(x0, 160 + s.posX);
      x1 = Math.max(x1, 160 + s.posX + s.width);
      y0 = Math.min(y0, FLOOR + dy + s.posY);
      y1 = Math.max(y1, FLOOR + dy + s.posY + s.height);
    }
    const pad = 12;
    return [x0 - pad, y0 - pad, x1 - x0 + 2 * pad, y1 - y0 + 2 * pad];
  }

  private togglePlay(): void {
    if (this.playing) this.stop();
    else this.play();
  }

  private play(): void {
    if (!this.tokens.frames.length) return;
    this.playing = true;
    this.playButton.textContent = '⏸ Pause';
    this.tick = this.tokens.frames.slice(0, this.frame).reduce((a, f) => a + f.ticks, 0);
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
    this.markTimeline();
    this.renderRight();
    this.draw();
  }

  // ---- frames ----------------------------------------------------------------------------------------------------

  private renderTimeline(): void {
    const m = this.move;
    if (!m) {
      fill(this.timeline, h('span', { class: 'muted' }, 'This slot has no move.'));
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
    if (!this.move) return;
    const cur = this.tokens.frames[this.frame];
    const f = newFrame(cur?.sprite ?? 0, cur?.ticks ?? 4);
    this.tokens.frames.splice(this.frame + 1, 0, f);
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
      toast('A move needs one frame at least.', true);
      return;
    }
    this.tokens.frames.splice(this.frame, 1);
    this.commitAnim();
  }

  // ---- the right panel: the frame and the move -------------------------------------------------------------------

  private renderRight(): void {
    const m = this.move;
    if (!m) {
      fill(this.right, h('div', { class: 'card', style: { marginTop: '12px' } }, h('h2', null, `MOVE ${this.moveId}`),
        h('p', { class: 'muted' }, SHARED_MOVES.includes(this.moveId)
          ? 'The robot has none of its own: the game uses the original robots\' (an effect every robot shares). A move of its own here replaces it.'
          : 'This slot is empty.'),
        h('button', { class: 'btn primary', onclick: () => this.createHere() }, 'Make a move here')));
      return;
    }
    fill(this.right, this.frameCard(m), this.moveCard(m), this.advancedCard(m));
  }

  private frameCard(m: AfMoveData): HTMLElement {
    const f = this.tokens.frames[this.frame];
    if (!f) return h('div', { class: 'card', style: { marginTop: '12px' } }, h('h2', null, 'FRAME'), h('p', { class: 'muted' }, 'No frames.'));
    const letters: [number, string][] = m.animation.sprites.map((_, i) => [i, String.fromCharCode(65 + i)]);
    const allTags = tagChoices(TAG_TABLE.map(([n]) => n));
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

  private moveCard(m: AfMoveData): HTMLElement {
    const id = this.moveId;
    const input = h('div', { class: 'row', style: { alignItems: 'center', gap: '6px' } });
    const renderInput = () => {
      const text = inputText(m.moveString);
      fill(input, h('code', { style: { minWidth: '120px', fontSize: '14px' } }, text || (m.moveString ? `"${m.moveString}"` : 'none')));
    };
    renderInput();
    // The input builder: directions in the order they are entered, then the button.
    const dirs: string[] = /^[PK][1-9]*$/.test(m.moveString) ? [...m.moveString.slice(1)].reverse() : [];
    let button = m.moveString[0] === 'K' ? 'K' : 'P';
    const write = () => {
      m.moveString = button + [...dirs].reverse().join('');
      renderInput();
      this.app.changed(false);
      this.renderList();
    };
    const pad = h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 30px)', gap: '3px' } },
      DIRECTIONS.map(([d, arrow]) => h('button', { class: 'btn small', style: { padding: '0', justifyContent: 'center' }, onclick: () => {
        dirs.push(d);
        write();
      } }, arrow)));
    const named = this.robot.info.moves[id] ?? '';
    const nameInput = h('input', { type: 'text', value: named, maxLength: 24, placeholder: 'e.g. ICE LANCE' });
    nameInput.addEventListener('input', () => {
      const v = nameInput.value.trim().toUpperCase();
      if (v) this.robot.info.moves[id] = v;
      else delete this.robot.info.moves[id];
      this.app.changed(false);
    });
    const react = h('textarea', { class: 'code', rows: 2 }, m.footerString);
    react.addEventListener('change', () => {
      try {
        decodeScript(react.value);
        m.footerString = react.value;
        this.app.changed(false);
      } catch {
        toast('That is not an animation string the game reads.', true);
        react.value = m.footerString;
      }
    });
    const attack = id >= 15 && id !== 48 && id !== 49 && id !== 60 && id !== 61;
    if (!attack) {
      return h('div', { class: 'card' },
        h('h2', null, `MOVE ${id}`, h('span', { class: 'spacer' }),
          !REQUIRED_MOVES.includes(id) ? h('button', { class: 'btn small danger', onclick: () => void this.deleteMove() }, 'Delete move') : null),
        h('p', { class: 'muted', style: { margin: '0' } }, ENGINE_MOVES[id] ?? 'An animation other moves start (their tags name it).'));
    }
    return h('div', { class: 'card' },
      h('h2', null, `MOVE ${id}`, h('span', { class: 'spacer' }),
        !REQUIRED_MOVES.includes(id) ? h('button', { class: 'btn small danger', onclick: () => void this.deleteMove() }, 'Delete move') : null),
      attack ? h('div', null,
        field('Input', h('div', null, input, h('div', { class: 'row', style: { marginTop: '6px', alignItems: 'flex-start' } }, pad,
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
            select<string>([['P', 'Punch'], ['K', 'Kick']], () => button, (v) => ((button = v), write())),
            h('button', { class: 'btn small', onclick: () => {
              dirs.length = 0;
              write();
            } }, 'Clear'),
            h('button', { class: 'btn small', onclick: () => {
              dirs.pop();
              write();
            } }, 'Back')))), 'facing right'),
        h('div', { style: { marginTop: '8px' } }, field('Special move name', nameInput, 'the move list shows it'))) : null,
      h('div', { class: 'grid2', style: { marginTop: '10px' } },
        field('Kind', select<number>(CATEGORIES, () => m.category, (v) => ((m.category = v), this.app.changed(false), this.renderList()))),
        field('Damage', numberInput(() => m.damageAmount, (v) => ((m.damageAmount = v), this.app.changed(false)), 0, 255)),
        field('Block stun', numberInput(() => m.blockStun, (v) => ((m.blockStun = v), this.app.changed(false)), 0, 255)),
        field('Points', numberInput(() => m.points, (v) => ((m.points = v), this.app.changed(false)), 0, 255), '× 400')),
      h('div', { style: { marginTop: '10px' } }, field('The victim\'s reaction when it hits', h('div', null, react,
        h('div', { class: 'row', style: { marginTop: '4px' } }, select<string>([['', 'Use a reaction of the game\'s robots…'], ...REACTIONS.map(([n, s]) => [s, n] as [string, string])],
          () => '', (v) => {
            if (!v) return;
            react.value = v;
            m.footerString = v;
            this.app.changed(false);
          }))), 'frames of its damage animation (move 9)')));
  }

  private advancedCard(m: AfMoveData): HTMLElement {
    const flag = (bit: number, label: string) => h('label', { class: 'muted', style: { display: 'block' } },
      h('input', { type: 'checkbox', checked: !!(m.posConstraint & bit), onchange: (e: Event) => {
        m.posConstraint = (e.target as HTMLInputElement).checked ? m.posConstraint | bit : m.posConstraint & ~bit;
        this.app.changed(false);
      } }), ` ${label}`);
    const raw = h('textarea', { class: 'code', rows: 4 }, m.animation.animString);
    raw.addEventListener('change', () => {
      try {
        decodeScript(raw.value);
        m.animation.animString = raw.value;
        this.tokens = parseAnim(raw.value);
        this.commitAnim();
      } catch {
        toast('That is not an animation string the game reads.', true);
        raw.value = m.animation.animString;
      }
    });
    return h('details', { class: 'card' },
      h('summary', { style: { cursor: 'pointer', font: '700 12px var(--title)', letterSpacing: '.14em', color: '#a9c4ff' } }, 'MORE'),
      h('div', { class: 'grid2', style: { marginTop: '10px' } },
        field('Next move on a hit', numberInput(() => m.playIfHit, (v) => ((m.playIfHit = v), this.app.changed(false)), 0, 69)),
        field('Successor / throw range', numberInput(() => m.successorId, (v) => ((m.successorId = v), this.app.changed(false)), 0, 255)),
        field('Throw duration', numberInput(() => m.throwDuration, (v) => ((m.throwDuration = v), this.app.changed(false)), 0, 255)),
        field('Variant by upgrades', select<number>(EXTRA_SELECTORS, () => m.extraStringSelector, (v) => ((m.extraStringSelector = v), this.app.changed(false))))),
      h('div', { style: { marginTop: '8px' } }, flag(0x01, 'Only at a wall'), flag(0x02, 'Only as a chain (not from standing)'), flag(0x40, 'Turned off')),
      h('div', { style: { marginTop: '8px' } }, field('Animation string', raw, 'as the file stores it')),
      h('p', { class: 'faint', style: { fontSize: '11px' } }, `${m.animation.extraStrings.length} variant string(s) for upgraded robots.`));
  }

  // ---- sprites ---------------------------------------------------------------------------------------------------

  private renderSprites(): void {
    const m = this.move;
    if (!m) {
      fill(this.sprites);
      return;
    }
    const anims = this.robot.af.moves.map((x) => x?.animation);
    fill(this.sprites, m.animation.sprites.map((s, i) => {
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
      const shared = sharedGroup(anims, s).length;
      box.append(h('div', { style: { fontSize: '11px', display: 'flex', gap: '4px' } }, h('b', null, String.fromCharCode(65 + i)),
        shared > 1 ? h('span', { class: 'badge', title: `The same picture as ${shared - 1} other sprite(s) of the robot` }, `×${shared}`) : null));
      return box;
    }));
  }

  private async editSprite(): Promise<void> {
    const m = this.move;
    const s = m?.animation.sprites[this.spriteSel];
    if (!m || !s) return;
    const anims = this.robot.af.moves.map((x) => x?.animation);
    const group = sharedGroup(anims, s);
    let everywhere = true;
    if (group.length > 1) {
      const choice = await modal<'all' | 'one'>((close) => h('div', { class: 'modal', style: { width: '480px' } },
        h('h2', null, 'A shared picture'),
        h('p', { class: 'muted' }, `This picture is also shown by ${group.length - 1} other sprite(s) of the robot (the file stores it once). ` +
          'Change it everywhere, or make this sprite a picture of its own?'),
        h('div', { class: 'actions' },
          h('button', { class: 'btn', onclick: () => close(null) }, 'Cancel'),
          h('button', { class: 'btn', onclick: () => close('one') }, 'This one only'),
          h('button', { class: 'btn primary', onclick: () => close('all') }, 'Everywhere'))));
      if (!choice) return;
      everywhere = choice === 'all';
    }
    const isCell = this.moveId === 60, isVs = this.moveId === 61;
    const prev = this.frame > 0 ? this.spriteOf(this.frame - 1) : null;
    const onionSprite = prev && prev !== s && !prev.isEmpty() ? prev : null;
    const empty = s.isEmpty();
    const coords = m.animation.coords.filter((c) => c.frameId === this.spriteSel);
    const result = await editPixels({
      title: `${this.robot.info.name}: move ${this.moveId}, sprite ${String.fromCharCode(65 + this.spriteSel)}`,
      picture: { pixels: empty ? new Uint8Array(1) : s.pixels(), w: empty ? 1 : s.width, h: empty ? 1 : s.height, posX: s.posX, posY: s.posY },
      palette: this.pal,
      entries: isCell ? [...ROBOT_ENTRIES, CELL_BACKGROUND] : ROBOT_ENTRIES,
      groups: [
        { label: 'Tertiary color (the pilot\'s third choice)', entries: RAMP_ENTRIES.slice(0, 15) },
        { label: 'Secondary color', entries: RAMP_ENTRIES.slice(15, 31) },
        { label: 'Primary color', entries: RAMP_ENTRIES.slice(31, 47) },
        { label: 'Effects (the same in every fight)', entries: ROBOT_ENTRIES.slice(47) },
      ],
      fixed: isCell ? { background: CELL_BACKGROUND } : undefined,
      onion: onionSprite && !isCell && !isVs ? { pixels: onionSprite.pixels(), w: onionSprite.width, h: onionSprite.height, posX: onionSprite.posX, posY: onionSprite.posY } : null,
      hitPoints: isCell || isVs ? null : coords.map((c) => ({ x: c.x, y: c.y })),
      floorY: isCell || isVs ? null : this.moveId === 1 ? JUMP_ADJUST : 0,
      fileName: `${this.robot.id}-move${this.moveId}-${String.fromCharCode(97 + this.spriteSel)}.png`,
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
      detach(anims, s);
      setPicture([s], result.pixels, result.w, result.h);
      s.posX = result.posX;
      s.posY = result.posY;
    }
    if (result.hitPoints) {
      const other = m.animation.coords.filter((c) => c.frameId !== this.spriteSel);
      m.animation.coords = [...other, ...result.hitPoints.map((p) => ({ x: p.x, y: p.y, nullValue: 0, frameId: this.spriteSel }))];
    }
    this.images.clear();
    this.app.changed(true);
    this.renderSprites();
    this.draw();
  }

  private addSprite(copy: boolean): void {
    const m = this.move;
    if (!m) return;
    if (m.animation.sprites.length >= 26) {
      toast('A move can show 26 sprites (A to Z).', true);
      return;
    }
    const cur = m.animation.sprites[this.spriteSel];
    m.animation.sprites.push(copy && cur ? copySprite(cur) : blankSprite(cur?.posX ?? -20, cur?.posY ?? -80));
    this.spriteSel = m.animation.sprites.length - 1;
    this.app.changed(true);
    this.renderSprites();
    this.renderRight();
  }

  private async importSprites(): Promise<void> {
    const m = this.move;
    if (!m) return;
    const files = await pickFiles('.png,image/png', true);
    let n = 0;
    for (const f of files.sort((a, b) => a.name.localeCompare(b.name))) {
      if (m.animation.sprites.length >= 26) break;
      try {
        const img = await pngToPixels(new Uint8Array(await f.arrayBuffer()), this.pal, ROBOT_ENTRIES);
        const [px, w, hh, dx, dy] = trim(img.pixels, img.w, img.h);
        // Placed like the robot's other frames: standing on the floor, centred on where it stands.
        const s = blankSprite(-(img.w >> 1) + dx, -img.h + dy);
        setPicture([s], px, w, hh);
        m.animation.sprites.push(s);
        n++;
      } catch (err) {
        toast(`${f.name}: ${(err as Error)?.message ?? err}`, true);
      }
    }
    if (!n) return;
    this.spriteSel = m.animation.sprites.length - 1;
    this.images.clear();
    this.app.changed(true);
    this.renderSprites();
    this.renderRight();
    toast(`${n} sprite${n === 1 ? '' : 's'} imported: set their frames' sprite letters to show them.`);
  }

  private async exportSprite(): Promise<void> {
    const s = this.move?.animation.sprites[this.spriteSel];
    if (!s) return;
    const name = `${this.robot.id}-move${this.moveId}-${String.fromCharCode(97 + this.spriteSel)}.png`;
    try {
      await saveFile(name, await spritePng(s, this.pal), 'image/png');
      toast(`Saved ${name}`);
    } catch {
      toast('The picture could not be saved.', true);
    }
  }

  private async deleteSprite(): Promise<void> {
    const m = this.move;
    if (!m) return;
    const i = this.spriteSel;
    if (this.tokens.frames.some((f) => f.sprite === i)) {
      toast('A frame shows this sprite: give the frames another sprite first.', true);
      return;
    }
    if (m.animation.sprites.length <= 1) return;
    const s = m.animation.sprites[i];
    // (its copies keep the picture)
    detach(this.robot.af.moves.map((x) => x?.animation), s);
    m.animation.sprites.splice(i, 1);
    // Letters after it move up one; so do their hit points.
    for (const f of this.tokens.frames) if (f.sprite > i) setFrame(f, f.sprite - 1, f.ticks);
    m.animation.coords = m.animation.coords.filter((c) => c.frameId !== i).map((c) => (c.frameId > i ? { ...c, frameId: c.frameId - 1 } : c));
    this.spriteSel = Math.max(0, i - 1);
    this.commitAnim();
    this.app.changed(true);
    this.renderSprites();
  }

  // ---- whole moves -----------------------------------------------------------------------------------------------

  private createHere(): void {
    const idle = this.robot.af.moves[11];
    const s = idle?.animation.sprites.find((x) => !x.isEmpty());
    this.robot.af.moves[this.moveId] = newMove(this.moveId >= 15 ? 5 : 9, this.moveId >= 15 ? 'P' : '!', [s ? copySprite(s) : blankSprite(-20, -80)], 'A4');
    this.app.changed(true);
    this.load(this.moveId);
  }

  private async newMoveDialog(free: number[]): Promise<void> {
    if (!free.length) {
      toast('Every slot has a move.', true);
      return;
    }
    const af = this.robot.af;
    const sources: [number, string][] = [[-1, 'One frame of the idle animation'], ...af.moves.map((m, id) => (m ? [id, `A copy of move ${id}: ${moveLabel(id, m)}`] : null))
      .filter((x): x is [number, string] => !!x)];
    let slot = free[0], from = -1;
    const ok = await modal<boolean>((close) => h('div', { class: 'modal', style: { width: '520px' } },
      h('h2', null, 'New move'),
      h('p', { class: 'muted' }, 'Attacks take slots 15 to 69; the game tries their inputs in that order (an input that begins like another\'s ' +
        'should come first).'),
      h('div', { class: 'grid2' },
        field('Slot', select<number>(free.map((id) => [id, String(id)]), () => slot, (v) => (slot = v))),
        field('Start from', select<number>(sources, () => from, (v) => (from = v)))),
      h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => close(false) }, 'Cancel'),
        h('button', { class: 'btn primary', onclick: () => close(true) }, 'Make it'))));
    if (!ok) return;
    if (from >= 0 && af.moves[from]) af.moves[slot] = copyMove(af.moves[from]!);
    else {
      const s = af.moves[11]?.animation.sprites.find((x) => !x.isEmpty());
      af.moves[slot] = newMove(5, 'P', [s ? copySprite(s) : blankSprite(-20, -80)], 'A4');
    }
    this.app.changed(true);
    this.load(slot);
  }

  private async deleteMove(): Promise<void> {
    if (!(await confirmDialog('Delete move', `Delete move ${this.moveId}? Its sprites go with it.`, 'Delete', true))) return;
    const anims = this.robot.af.moves.map((x) => x?.animation);
    // (sprites of other moves that show its pictures keep them)
    for (const s of this.move?.animation.sprites ?? []) detach(anims, s);
    this.robot.af.moves[this.moveId] = null;
    delete this.robot.info.moves[this.moveId];
    this.app.changed(true);
    this.load(this.moveId);
  }
}
