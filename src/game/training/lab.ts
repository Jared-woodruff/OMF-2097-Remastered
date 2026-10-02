// Training lab overlays: the frame meter with the frame data of the player's last move, and the hitbox view.
//
// Frame data counts game ticks (one "frame" of the fight): startup up to and including the first tick with hit
// points, active ticks, recovery until the robot can act again, and the advantage once both robots can act after a
// hit or a block. Hits are pixel exact in this game: an attack's hit points (drawn as red crosses) have to touch an
// opaque pixel of the other robot (outlined; the palette's effect colors from index 96 up do not count).
import { harCanAct } from '../../controller/dummy';
import { afGetMove } from '../../resources/resources';
import { drawList, TAG_HUD, video } from '../../video/draw';
import { Surface } from '../../video/surface';
import type { HarEvent } from '../../controller/controller';
import { CAT_CLOSE, HarEventType, HarState, OBJECT_FACE_LEFT } from '../constants';
import type { GameState } from '../gameState';
import { menuShade } from '../gui/widgets';
import { FontSize, GLYPH_SHADOW_BOTTOM, GLYPH_SHADOW_RIGHT, HAlign, Text } from '../gui/text';
import type { GameObject } from '../object';
import { harData } from '../objects/har';
import { projectileGetOwner } from '../objects/projectile';
import { Tag } from '../../script/tags';

export const enum FrameKind {
  IDLE,
  MOVE,
  STARTUP,
  ACTIVE,
  RECOVERY,
  HITSTUN,
  BLOCKSTUN,
  DOWN,
  THROW,
}

/** Palette colors of the frame kinds (the arenas share a fixed range of interface colors from 0xA0 up). */
const KIND_COLOR = [0xd3, 0xd7, 0xa6, 0xb6, 0xad, 0xcf, 0xcd, 0xbd, 0xf6];
const COLOR_HURT = 0xe6;
const COLOR_HIT = 0xb7;
const COLOR_HIT_CORE = 0xdf;
const TEXT = 0xe7;
const SHADOW = 0xf8;

/** Cells of the meter, and ticks both robots must be idle for the meter to stop (and start afresh). */
const CELLS = 80;
/** Where the meter goes: under the health bars, clear of the input display at the left. */
const METER_X = 40;
const METER_Y = 37;
const QUIET_STOP = 12;

/** A dot of one pixel (index 1) drawn at any size and color through the palette offset. */
let dot: Surface | null = null;
function drawBox(x: number, y: number, w: number, h: number, color: number): void {
  dot ??= new Surface(1, 1, new Uint8Array([1]), 0);
  video.drawFull(dot, x, y, w, h, 0, 0, color - 1, 255, 255, 0, 0);
}

/** The current frame of an object has hit points. */
export function hasHitPoints(obj: GameObject): boolean {
  const a = obj.curAnimation;
  if (!a || obj.hitPixelsDisabled || obj.curSpriteId < 0) return false;
  return a.collisionCoords.some((cc) => cc.frameIndex === obj.curSpriteId);
}

interface MoveTrack {
  /** The tick the move started (-1: no move tracked), the first and last ticks with hit points, active tick count. */
  start: number;
  firstActive: number;
  lastActive: number;
  active: number;
  throw: boolean;
  /** The move has ended (the robot can act): its data is final. */
  done: boolean;
}

export interface FrameData {
  startup: number;
  active: number;
  recovery: number;
  total: number;
  /** Advantage once both robots can act after the move touched (positive: the player acts first), or null. */
  advantage: number | null;
  contact: 'hit' | 'block' | null;
}

function newTrack(start: number): MoveTrack {
  return { start, firstActive: -1, lastActive: -1, active: 0, throw: false, done: false };
}

export class FrameMeter {
  private cells: [number[], number[]] = [[], []];
  private quiet = QUIET_STOP + 1;
  private track: [MoveTrack | null, MoveTrack | null] = [null, null];
  /** The player's move that touched the dummy, waiting for both to act again (advantage). */
  private exchange: { contact: 'hit' | 'block'; p1Free: number; p2Free: number } | null = null;
  /** The player's last move. */
  data: FrameData | null = null;
  private shade = menuShade(CELLS * 3 + 8, 21);
  private text = new Text(FontSize.SMALL, 320, 7, '').setColor(TEXT).setShadowColor(SHADOW)
    .setShadow(GLYPH_SHADOW_RIGHT | GLYPH_SHADOW_BOTTOM).setWordWrap(false).setHAlign(HAlign.CENTER);

  constructor(private gs: GameState) {}

  /** A robot started a move (the ATTACK event: input, not a follow-up of the same move). */
  onHarEvent(e: HarEvent): void {
    if (e.type !== HarEventType.ATTACK) return;
    const t = newTrack(this.gs.tick);
    t.throw = e.move?.category === CAT_CLOSE;
    this.track[e.playerId] = t;
    if (e.playerId === 0) this.exchange = null;
  }

  reset(): void {
    this.cells = [[], []];
    this.quiet = QUIET_STOP + 1;
    this.track = [null, null];
    this.exchange = null;
    this.data = null;
  }

  private kindOf(i: number, obj: GameObject): FrameKind {
    const h = harData(obj);
    const t = this.track[i];
    switch (h.state) {
      case HarState.BLOCKSTUN:
        return FrameKind.BLOCKSTUN;
      case HarState.STANDING_UP:
        return FrameKind.DOWN;
      case HarState.RECOIL:
      case HarState.STUNNED:
      case HarState.WALLDAMAGE:
        return FrameKind.HITSTUN;
    }
    if (t && !t.done) {
      if (t.throw) return FrameKind.THROW;
      const pjt = this.gs.getProjectiles().some((p) => projectileGetOwner(p) === i && hasHitPoints(p));
      if (hasHitPoints(obj) || pjt) return FrameKind.ACTIVE;
      return t.firstActive < 0 ? FrameKind.STARTUP : FrameKind.RECOVERY;
    }
    if (obj.isAirborne() || h.state === HarState.WALKTO || h.state === HarState.WALKFROM) return FrameKind.MOVE;
    return FrameKind.IDLE;
  }

  /** After each game tick. */
  tick(objs: GameObject[]): void {
    const tick = this.gs.tick;
    const kinds: FrameKind[] = [];
    for (let i = 0; i < 2; i++) {
      const obj = objs[i];
      const t = this.track[i];
      const kind = this.kindOf(i, obj);
      if (t && !t.done) {
        if (kind === FrameKind.ACTIVE || kind === FrameKind.THROW) {
          if (t.firstActive < 0) t.firstActive = tick;
          t.lastActive = tick;
          t.active++;
        }
        // The move is over when the robot can act again (or lands after an air attack).
        if (harCanAct(obj) || (!harData(obj).executingMove && !obj.isAirborne() && tick > t.start)) {
          t.done = true;
          if (i === 0) this.finishMove(t, tick);
        }
      }
      kinds.push(kind);
    }
    this.exchangeTick(objs, kinds, tick);

    // The meter runs while anything happens, stops after a moment of calm and starts afresh with the next action.
    const busy = kinds.some((k) => k !== FrameKind.IDLE && k !== FrameKind.MOVE);
    if (busy) {
      if (this.quiet > QUIET_STOP) this.cells = [[], []];
      this.quiet = 0;
    } else {
      this.quiet++;
    }
    if (this.quiet <= QUIET_STOP) {
      for (let i = 0; i < 2; i++) {
        const row = this.cells[i];
        row.push(kinds[i]);
        if (row.length > CELLS) row.shift();
      }
    }
  }

  private finishMove(t: MoveTrack, tick: number): void {
    const startup = t.firstActive >= 0 ? t.firstActive - t.start + 1 : 0;
    const total = tick - t.start;
    this.data = {
      startup,
      active: t.active,
      recovery: t.lastActive >= 0 ? Math.max(0, tick - t.lastActive - 1) : 0,
      total,
      advantage: null,
      contact: this.exchange?.contact ?? null,
    };
  }

  /** Contact of the player's move with the dummy, then the advantage when both can act again. */
  private exchangeTick(objs: GameObject[], kinds: FrameKind[], tick: number): void {
    const t = this.track[0];
    if (t && !t.done && (kinds[1] === FrameKind.HITSTUN || kinds[1] === FrameKind.BLOCKSTUN || kinds[1] === FrameKind.DOWN)) {
      const contact = kinds[1] === FrameKind.BLOCKSTUN ? 'block' : 'hit';
      if (!this.exchange) this.exchange = { contact, p1Free: -1, p2Free: -1 };
      else if (contact === 'hit') this.exchange.contact = 'hit';
    }
    const x = this.exchange;
    if (!x) return;
    if (x.p1Free < 0 && harCanAct(objs[0])) x.p1Free = tick;
    if (x.p2Free < 0 && harCanAct(objs[1])) x.p2Free = tick;
    if (!harCanAct(objs[0])) x.p1Free = -1;
    if (!harCanAct(objs[1])) x.p2Free = -1;
    if (x.p1Free >= 0 && x.p2Free >= 0) {
      if (this.data) {
        this.data.advantage = x.p2Free - x.p1Free;
        this.data.contact = x.contact;
      }
      this.exchange = null;
    }
  }

  render(): void {
    video.setTag(TAG_HUD);
    video.drawRemap(this.shade, METER_X - 4, METER_Y - 3, 4, 1, 0);
    for (let i = 0; i < 2; i++) {
      const row = this.cells[i];
      for (let c = 0; c < CELLS; c++) {
        const k = row[c];
        drawBox(METER_X + c * 3, METER_Y + i * 5, 2, 4, k === undefined ? 0xd1 : KIND_COLOR[k]);
      }
    }
    const d = this.data;
    let s = 'STARTUP -  ACTIVE -  RECOVERY -';
    if (d) {
      const adv = d.advantage === null ? '' : `  ON ${d.contact === 'block' ? 'BLOCK' : 'HIT'} ${d.advantage > 0 ? '+' : ''}${d.advantage}`;
      s = `STARTUP ${d.startup || '-'}  ACTIVE ${d.active || '-'}  RECOVERY ${d.recovery}  TOTAL ${d.total}${adv}`;
    }
    this.text.set(s);
    this.text.draw(0, METER_Y + 11);
  }
}

// ---- hitbox view ----------------------------------------------------------------------------------------------

/** Outline masks of sprites (the pixels that can be hit), made when first needed. */
const outlines = new WeakMap<Surface, Surface>();

function outlineOf(s: Surface, har: boolean): Surface {
  let o = outlines.get(s);
  if (o) return o;
  const { w, h, data, transparent } = s;
  const hurt = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return false;
    const p = data[y * w + x];
    return p !== transparent && (!har || p < 96);
  };
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (hurt(x, y) && (!hurt(x - 1, y) || !hurt(x + 1, y) || !hurt(x, y - 1) || !hurt(x, y + 1))) out[y * w + x] = 1;
    }
  }
  o = new Surface(w, h, out, 0);
  o.renderW = s.renderW;
  o.renderH = s.renderH;
  outlines.set(s, o);
  return o;
}

/** Hit points of the object's current frame, in native screen coordinates (as the hit test places them). */
function hitPoints(obj: GameObject): [number, number][] {
  const a = obj.curAnimation;
  if (!a || obj.hitPixelsDisabled || obj.curSpriteId < 0) return [];
  const r = obj.frameIsSet(Tag.R);
  const left = (obj.direction === OBJECT_FACE_LEFT && !r) || (obj.direction !== OBJECT_FACE_LEFT && r);
  const out: [number, number][] = [];
  for (const cc of a.collisionCoords) {
    if (cc.frameIndex !== obj.curSpriteId) continue;
    out.push([left ? obj.px() - cc.x : obj.px() + cc.x, obj.py() + cc.y]);
  }
  return out;
}

/** Draws what can be hit (outlines) and what hits (the active hit points) of both robots and the projectiles. */
export function renderHitboxes(gs: GameState): void {
  video.setTag(TAG_HUD);
  const objs: [GameObject, boolean][] = [];
  for (let i = 0; i < 2; i++) {
    const o = gs.findObject(gs.getPlayer(i).harObjId);
    if (o) objs.push([o, true]);
  }
  for (const p of gs.getProjectiles()) objs.push([p, false]);
  for (const [o, har] of objs) {
    const b = o.renderBounds();
    if (har && b) o.renderOver(outlineOf(b.surf, true), COLOR_HURT - 1);
  }
  for (const [o] of objs) {
    for (const [x, y] of hitPoints(o)) {
      o.renderAt(() => {
        drawBox(x - 1, y, 3, 1, COLOR_HIT);
        drawBox(x, y - 1, 1, 3, COLOR_HIT);
        drawBox(x, y, 1, 1, COLOR_HIT_CORE);
      });
    }
  }
  drawList.subX = 0;
  drawList.subY = 0;
}
