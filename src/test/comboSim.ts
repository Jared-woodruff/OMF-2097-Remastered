// Combo simulation for the combo trials (tests and the search in src/gen/dev/comboSearch.test.ts): a training fight
// with a scripted player 1 and a standing dummy; the script enters moves at exact ticks and the result tells which
// steps landed within one combo (as the game counts combos: until the victim's RECOVER event).
import { Controller, type CtrlEvent } from '../controller/controller';
import { DummyController, DummyMode, moveActions } from '../controller/dummy';
import { ACT_RIGHT, ACT_STOP, ACT_UP, ARENA_FLOOR, CAT_JUMPING, HarEventType, OBJECT_FACE_LEFT, OBJECT_FACE_RIGHT, SceneId } from '../game/constants';
import type { GameState } from '../game/gameState';
import { harData, harInstallHook } from '../game/objects/har';
import type { ArenaScene } from '../game/scenes/arena';
import { afGetMove } from '../resources/resources';
import { createGame } from './harness';

/** Plays actions at given ticks (several in one tick are taken one after the other). */
class ScriptController extends Controller {
  plan = new Map<number, number[]>();
  override poll(ev: CtrlEvent[]): number {
    const acts = this.plan.get(this.gs.tick);
    if (acts) for (const a of acts) ev.push({ type: 'action', action: a, source: this.type });
    else ev.push({ type: 'action', action: ACT_STOP, source: this.type });
    return 0;
  }
}

export interface ComboStep {
  /** The move (animation id). */
  move: number;
  /** Ticks after the previous step's first hit (the first step: after the start; a jump attack: after the jump). */
  delay: number;
}

export interface ComboSetup {
  har: number;
  dummy: number;
  /** Distance between the robots at the start. */
  distance: number;
  /** The first step is a jump attack: the jump (forward) happens at the start. */
  jump: boolean;
}

export interface ComboResult {
  /** Tick of the first hit of each step (-1: it did not land in the combo). */
  hits: number[];
  /** Damage of the combo (the dummy's health lost until the last step landed). */
  damage: number;
}

/** A training fight, ready to fight (the round has started). */
export class ComboSim {
  gs: GameState;
  private script: ScriptController;
  private startTick = 0;

  constructor(readonly har: number, readonly dummy: number) {
    const gs = createGame(SceneId.MENU, [0, 5], [har, dummy]);
    gs.training = true;
    gs.matchSettings.rounds = 0;
    gs.matchSettings.hazards = false;
    this.script = new ScriptController(gs);
    gs.getPlayer(0).setCtrl(this.script);
    gs.getPlayer(1).setCtrl(new DummyController(gs, DummyMode.STAND));
    gs.arena = 0;
    gs.swapScene(SceneId.ARENA0);
    this.gs = gs;
    // The round starts.
    for (let i = 0; i < 130; i++) gs.dynamicTick();
  }

  private get arena(): ArenaScene {
    return this.gs.sc as ArenaScene;
  }

  /** Runs a combo from fresh positions; returns which steps landed within one combo. */
  run(setup: ComboSetup, steps: ComboStep[], maxTicks = 400): ComboResult {
    const gs = this.gs;
    const arena = this.arena;
    arena.resetTrainingPositions();
    const p1 = gs.findObject(gs.getPlayer(0).harObjId)!;
    const p2 = gs.findObject(gs.getPlayer(1).harObjId)!;
    const center = 160;
    p1.setPos(center - setup.distance / 2, ARENA_FLOOR);
    p2.setPos(center + setup.distance / 2, ARENA_FLOOR);
    p1.direction = OBJECT_FACE_RIGHT;
    p2.direction = OBJECT_FACE_LEFT;
    const h1 = harData(p1);
    h1.inputs.fill('5');
    h1.punchValid = 0;
    h1.kickValid = 0;
    // Settle for a few ticks (idle animations, facing).
    for (let i = 0; i < 12; i++) gs.dynamicTick();
    this.startTick = gs.tick;
    const hits = steps.map(() => -1);
    const h2start = harData(p2).health;
    let damage = 0;
    let next = 0;
    let broken = false;
    let started = false;
    // The next step's move was entered (a hit of the step before, e.g. its second hit, does not count for it).
    let entered = false;
    const hook1 = (e: { type: HarEventType; move?: { id: number; damage: number } | null }) => {
      if (!e.move || broken) return;
      if (e.type === HarEventType.ATTACK) {
        if (next < steps.length && e.move.id === steps[next].move) entered = true;
        return;
      }
      // A projectile's hit counts for the move that threw it.
      const projectile = e.type === HarEventType.LAND_HIT_PROJECTILE;
      if (e.type !== HarEventType.LAND_HIT && !projectile) return;
      if (next < steps.length && entered && (projectile || e.move.id === steps[next].move)) {
        hits[next] = gs.tick;
        next++;
        entered = false;
        started = true;
        schedule();
      }
    };
    const hook2 = (e: { type: HarEventType }) => {
      if (e.type === HarEventType.RECOVER && started) broken = true;
    };
    harInstallHook(h1, hook1 as never);
    harInstallHook(harData(p2), hook2 as never);
    const plan = this.script.plan;
    plan.clear();
    const at = (tick: number, acts: number[]) => plan.set(tick, [...(plan.get(tick) ?? []), ...acts]);
    const af = h1.afData;
    const schedule = () => {
      if (next >= steps.length) return;
      const s = steps[next];
      const move = afGetMove(af, s.move);
      if (!move) return;
      const base = next === 0 ? this.startTick : hits[next - 1];
      at(base + s.delay, moveActions(move.moveString, OBJECT_FACE_RIGHT));
    };
    if (setup.jump) at(this.startTick, [ACT_UP | ACT_RIGHT]);
    schedule();
    const end = this.startTick + maxTicks;
    while (gs.tick < end && !broken && next < steps.length) gs.dynamicTick();
    // The last hit's damage is dealt within a few ticks (hit pause).
    for (let i = 0; i < 8 && !broken; i++) gs.dynamicTick();
    damage = Math.max(0, Math.round(h2start - harData(p2).health));
    // Let the last hit's move finish (a later RECOVER does not undo the combo).
    h1.hooks = h1.hooks.filter((f) => f !== (hook1 as never));
    const h2 = harData(p2);
    h2.hooks = h2.hooks.filter((f) => f !== (hook2 as never));
    if (broken) for (let i = next; i < hits.length; i++) hits[i] = -1;
    return { hits, damage };
  }

  isJump(move: number): boolean {
    const m = afGetMove(harData(this.gs.findObject(this.gs.getPlayer(0).harObjId)!).afData, move);
    return m?.category === CAT_JUMPING;
  }
}
