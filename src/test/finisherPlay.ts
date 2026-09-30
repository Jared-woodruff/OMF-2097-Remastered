// Plays AI fights through to the finishing moves and measures them (src/test/finishers.test.ts and the survey
// src/gen/dev/finisherCheck.test.ts): the credits' setup (ULTIMATE AI, which always goes for the finishers), and for
// every scrap or destruction whether it catches the beaten robot, how close the two robots come as drawn (the gap
// between their pixels) and whether the winner runs into a wall.
import { ARENA_LEFT_WALL, ARENA_RIGHT_WALL, HarEventType, HarState, OBJECT_FACE_LEFT, SceneId } from '../game/constants';
import { CREDITS_OWN_END_TICKS, CREDITS_READY_TICK, CREDITS_RULES, setupCreditsBattle, type CreditBattle } from '../game/credits/battles';
import type { GameObject } from '../game/object';
import { harData, harInstallHook } from '../game/objects/har';
import { Tag } from '../script/tags';
import { FLIP_HORIZONTAL, FLIP_VERTICAL } from '../video/draw';
import { createGame, HeadlessRunner } from './harness';

export interface Finisher {
  kind: 'SCRAP' | 'DESTRUCTION';
  /** The robots' positions when it started. */
  wx: number;
  lx: number;
  /** Tick the beaten robot was caught (taken over by the finisher's script or slammed into a wall), or -1. */
  caught: number;
  /** Ticks after the catch, those with the robots touching (gap <= 1) and the smallest gap. */
  ticks: number;
  touching: number;
  minGap: number;
  /** The winner at a wall while it ran. */
  wall: boolean;
  /** The largest distance the beaten robot (and the winner) moved from one tick to the next while it ran. */
  maxJump: number;
  winnerJump: number;
}

export interface FinishResult {
  /** The winning player (0, 1), -1 if nobody won. */
  winner: number;
  /** The fight reached its end (the arena closed). */
  over: boolean;
  finishers: Finisher[];
}

/** Where a robot's opaque pixels are drawn: per screen row, the leftmost and rightmost column. */
function spans(ob: GameObject): Map<number, [number, number]> {
  const out = new Map<number, [number, number]>();
  const b = ob.renderBounds();
  if (!b) return out;
  let flip = ob.spriteState.flipmode;
  if (ob.direction === OBJECT_FACE_LEFT) flip ^= FLIP_HORIZONTAL;
  const s = b.surf;
  for (let y = 0; y < s.h; y++) {
    let lo = -1, hi = -1;
    for (let x = 0; x < s.w; x++) {
      if (s.data[y * s.w + x] === s.transparent) continue;
      if (lo < 0) lo = x;
      hi = x;
    }
    if (lo < 0) continue;
    const sy = Math.trunc(b.y) + (flip & FLIP_VERTICAL ? s.h - 1 - y : y);
    const [x0, x1] = flip & FLIP_HORIZONTAL ? [s.w - 1 - hi, s.w - 1 - lo] : [lo, hi];
    out.set(sy, [Math.trunc(b.x) + x0, Math.trunc(b.x) + x1]);
  }
  return out;
}

/** The horizontal gap between two robots as drawn (0: touching or overlapping; 999: no shared rows). */
export function gapBetween(a: GameObject, b: GameObject): number {
  const sa = spans(a), sb = spans(b);
  let gap = 999;
  for (const [y, [a0, a1]] of sa) {
    const r = sb.get(y);
    if (!r) continue;
    gap = Math.min(gap, Math.max(0, r[0] - a1 - 1, a0 - r[1] - 1));
  }
  return gap;
}

/** A robot's state, animation, frame, position and tags (for traces). */
export function describeHar(ob: GameObject): string {
  const hd = harData(ob);
  const f = ob.animationState.reader.frame();
  const tags = f ? f.tags.map((t) => `${Tag[t.key]}${t.value ? t.value : ''}`).join(' ') : '';
  return `${HarState[hd.state]} a${ob.curAnimation?.id} ${f ? String.fromCharCode(65 + f.sprite) : '-'} x${ob.posX.toFixed(1)} ` +
    `y${ob.posY.toFixed(1)} d${ob.direction} [${tags}]`;
}

/**
 * Plays robot `w` against robot `l` in an arena with a seed until the fight is over (or `credit`: one of the credits'
 * own fights, with its rules). The winner-to-be gets POWER 8 against 1. `trace` receives a line per tick from the
 * knockout on.
 */
export function playFinish(w: number, l: number, arena: number, seed: number, opts: { credit?: CreditBattle; trace?: string[] } = {}): FinishResult {
  const b: CreditBattle = opts.credit ?? {
    role: '', title: '', detail: '', accent: '#fff', emblem: 'chip',
    winner: { name: 'W', line2: '', har: w, colors: ['#2f5d9e', '#c9d6ea', '#e0b070'] },
    loser: { name: 'L', line2: '', har: l, colors: ['#6e5a4a', '#8a4a2c', '#3c3530'] },
    arena, seed, blow: 0, done: 0,
  };
  const gs = createGame(SceneId.MENU);
  let over = false;
  gs.credits = {
    readyTick: CREDITS_READY_TICK,
    endTicks: CREDITS_OWN_END_TICKS,
    setupFight: () => setupCreditsBattle(gs, b, opts.credit ? CREDITS_RULES : { ...CREDITS_RULES, power: [8, 1] }),
    hudLine: () => '',
    fightOver: () => (over = true),
    action: () => undefined,
    staticTick: () => undefined,
  };
  gs.swapScene(SceneId.ARENA0 + b.arena);
  const run = new HeadlessRunner(gs);
  const arenaSc = () => gs.sc as unknown as { arenaIsOver(): number };
  const finishers: Finisher[] = [];
  let hooked = false;
  let winner = -1;
  let lastTick = -1;
  let lastX = NaN, lastWx = NaN;
  for (let ms = 0; ms < 120_000 && !over; ms += 1000 / 60) {
    run.advance(1000 / 60);
    const o = [0, 1].map((i) => gs.findObject(gs.getPlayer(i).harObjId));
    if (!o[0] || !o[1]) continue;
    if (!hooked) {
      hooked = true;
      [0, 1].forEach((i) => harInstallHook(harData(o[i]!), (e) => {
        if (e.type !== HarEventType.SCRAP && e.type !== HarEventType.DESTRUCTION) return;
        finishers.push({
          kind: e.type === HarEventType.SCRAP ? 'SCRAP' : 'DESTRUCTION', wx: Math.round(o[i]!.posX), lx: Math.round(o[1 - i]!.posX),
          caught: -1, ticks: 0, touching: 0, minGap: 999, wall: false, maxJump: 0, winnerJump: 0,
        });
      }));
    }
    if (winner < 0 && arenaSc().arenaIsOver() >= 0) winner = arenaSc().arenaIsOver();
    if (winner < 0 || gs.tick === lastTick) continue;
    lastTick = gs.tick;
    const wo = o[winner]!, lo = o[1 - winner]!;
    opts.trace?.push(`${gs.tick}: W ${describeHar(wo)} | L ${describeHar(lo)} | gap ${gapBetween(wo, lo)}`);
    const f = finishers[finishers.length - 1];
    const h = harData(wo);
    const jump = Math.abs(lo.posX - lastX), wJump = Math.abs(wo.posX - lastWx);
    lastX = lo.posX;
    lastWx = wo.posX;
    if (!f || (h.state !== HarState.SCRAP && h.state !== HarState.DESTRUCTION)) continue;
    if (jump > f.maxJump) f.maxJump = jump;
    if (wJump > f.winnerJump) f.winnerJump = wJump;
    if (wo.posX <= ARENA_LEFT_WALL || wo.posX >= ARENA_RIGHT_WALL) f.wall = true;
    const ls = harData(lo).state;
    if (f.caught < 0 && (ls === HarState.RECOIL || ls === HarState.WALLDAMAGE)) f.caught = gs.tick;
    if (f.caught >= 0) {
      const gap = gapBetween(wo, lo);
      f.ticks++;
      if (gap <= 1) f.touching++;
      f.minGap = Math.min(f.minGap, gap);
    }
  }
  return { winner, over, finishers };
}
