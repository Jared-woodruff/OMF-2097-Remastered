// CPU opponent controller: faithful port of the reference engine's AI (controller/ai_controller.c).
//
// The AI plays through the normal controller path. On every input poll (`poll`, called by the arena once per dynamic
// tick) it emits actions with `cmd()` (port of `controller_cmd`) which the arena feeds to the HAR exactly like keyboard
// input; special moves are typed out from their AF move strings (`charToAct`/`processSelectedMove`) and charge, push,
// trip and projectile specials are entered as hard-coded joystick sequences per HAR. HAR events reach the AI through
// `harHook` (reference `ai_har_event`) and drive tactic selection, counter-blocking, chained tactics and learning.
//
// Randomness: the reference AI only uses the *global* RNG (`rand_int`), so every roll here is `globalRandom.int`. RNG
// call order is preserved (short-circuit evaluation and loop order match the C code).
//
// Difficulty: `difficulty` is the AI_DIFFICULTY_* value (0 PUNCHING BAG .. 6 ULTIMATE); internally the reference works
// with `difficulty + 1` (1..7).
//
// The reference AI does not use the AF `ai_flags`/`pos_constraint` move fields; move selection is driven by move
// category, move string, damage, measured hit distances (learning) and pilot preferences.
import type { Pilot } from '../formats/pilot';
import {
  ACT_DOWN, ACT_KICK, ACT_LEFT, ACT_PUNCH, ACT_RIGHT, ACT_STOP, ACT_UP, CAT_BASIC, CAT_CLOSE, CAT_DESTRUCTION, CAT_HIGH,
  CAT_JUMPING, CAT_LOW, CAT_MEDIUM, CAT_PROJECTILE, CAT_SCRAP, CAT_VICTORY, CtrlType, HarEventType, HarId, HarState,
  OBJECT_FACE_LEFT, OBJECT_FACE_RIGHT, SceneId,
} from '../game/constants';
import type { GameState } from '../game/gameState';
import type { GameObject } from '../game/object';
import { ARENA_STATE_ENDING, ARENA_STATE_FIGHTING, harData, harIsCrouching, type ArenaLike, type Har } from '../game/objects/har';
import { projectileGetOwner } from '../game/objects/projectile';
import { afGetMove, type AfMove } from '../resources/resources';
import { Tag } from '../script/tags';
import { globalRandom } from '../util/random';
import { modPilot, modRobot } from '../mods/registry';
import { Controller, type CtrlEvent, type HarEvent } from './controller';

/* times thrown before we AI learns its lesson */
const MAX_TIMES_THROWN = 3;
/* times shot before we AI learns its lesson */
const MAX_TIMES_SHOT = 4;
/* base likelihood to change movement action (lower is more likely) */
const BASE_ACT_CHANCE = 5;
/* base timer before we can consider changing movement action */
const BASE_ACT_TIMER = 28;
/* base likelihood to jump while moving forwards (lower is more likely) */
const BASE_FWD_JUMP_CHANCE = 5;
/* base likelihood to jump while moving backwards (lower is more likely) */
const BASE_BACK_JUMP_CHANCE = 5;
/* base likelihood to jump while standing still (lower is more likely) */
const BASE_STILL_JUMP_CHANCE = 40;
/* number of move ticks before bailing on tactic */
const TACTIC_MOVE_TIMER_MAX = 30;
/* number of attack attempt ticks before bailing on tactic */
const TACTIC_ATTACK_TIMER_MAX = 3;
/* number of jump attack attempt ticks before bailing on tactic */
const TACTIC_JUMP_ATTACK_TIMER_MAX = 12;
/* likelihood of attempting a random attack/tactic (lower is more likely) */
const RANDOM_ATTACK_CHANCE = 10;

/** Number of move slots in an AF file. */
const MAX_MOVES = 70;

// Tactics
export const TACTIC_ESCAPE = 1; // escape from enemy
export const TACTIC_TURTLE = 2; // block attacks
export const TACTIC_GRAB = 3; // charge and grab enemy
export const TACTIC_SPAM = 4; // spam the same attack
export const TACTIC_SHOOT = 5; // shoot a projectile
export const TACTIC_TRIP = 6; // trip enemy
export const TACTIC_QUICK = 7; // quick attack
export const TACTIC_CLOSE = 8; // close with the enemy
export const TACTIC_FLY = 9; // fly towards the enemy
export const TACTIC_PUSH = 10; // spam power moves to push them back
export const TACTIC_COUNTER = 11; // block then attack

// Tactic movement types
export const MOVE_CLOSE = 1; // close distance
export const MOVE_AVOID = 2; // gain distance
export const MOVE_JUMP = 3; // jump towards
export const MOVE_HIGH_JUMP = 4; // high-jump towards
export const MOVE_BLOCK = 5; // hold block

// Tactic attack types
export const ATTACK_ID = 1; // attack by id
export const ATTACK_TRIP = 2; // trip attack
export const ATTACK_GRAB = 3; // grab/throw attack
export const ATTACK_LIGHT = 4; // light/quick attack
export const ATTACK_HEAVY = 5; // heavy/power attack
export const ATTACK_JUMP = 6; // jumping attack
export const ATTACK_RANGED = 7; // ranged attack
export const ATTACK_CHARGE = 8; // charge attack
export const ATTACK_PUSH = 9; // push attack
export const ATTACK_RANDOM = 10; // random attack

// Enemy range classes (30px units)
export const RANGE_CRAMPED = 0;
export const RANGE_CLOSE = 1;
export const RANGE_MID = 2;
export const RANGE_FAR = 3;

const MOVE_DIR_STILL = 0;
const MOVE_DIR_FWD = 1;
const MOVE_DIR_BACK = 2;

interface MoveStat {
  maxHitDist: number;
  minHitDist: number;
  value: number;
  attempts: number;
  consecutive: number;
  lastDist: number;
}

interface TacticState {
  tacticType: number;
  lastTactic: number;
  moveType: number;
  moveTimer: number;
  attackType: number;
  attackId: number;
  attackTimer: number;
  /** HarEventType the attack phase waits for (0 = none). */
  attackOn: number;
  chainHitOn: number;
  chainHitTactic: number;
}

/** The reference `ai` struct (controller private data). */
export interface Ai {
  /** AI_DIFFICULTY_* + 1 (1..7). */
  difficulty: number;
  actTimer: number;
  curAct: number;
  /** number of polls to wait per move string input */
  inputLag: number;
  inputLagTimer: number;
  // move stats
  selectedMove: AfMove | null;
  lastMoveId: number;
  moveStrPos: number;
  moveStats: MoveStat[];
  blocked: number;
  /** times thrown by enemy */
  thrown: number;
  /** times shot by enemy */
  shot: number;
  // tactical state
  tactic: TacticState;
  pilot: Pilot;
  /** all projectiles currently on screen */
  activeProjectiles: GameObject[];
  // finisher extension (not in the reference, see `AiController.finishers`)
  /** HAR state (VICTORY/SCRAP) the current finisher decision was rolled for, 0 = none */
  finisherState: number;
  /** whether the AI goes for the scrap/destruction in the current window */
  finisherGo: boolean;
  /**
   * Tournament extension (see `AiController.tournamentPersonalities`): the pilot record's own AI preferences, captured
   * at creation; "forgetting" restores these instead of the hard-coded story personality. Null for story pilots.
   */
  basePersonality: Personality | null;
}

/** The pilot fields `reset_pilot_personality` manages. */
export type Personality = Pick<Pilot,
  'attNormal' | 'attHyper' | 'attJump' | 'attDef' | 'attSniper' | 'apThrow' | 'apSpecial' | 'apJump' | 'apHigh' |
  'apLow' | 'apMiddle' | 'prefJump' | 'prefFwd' | 'prefBack' | 'learning' | 'forget'>;

function capturePersonality(p: Pilot): Personality {
  return {
    attNormal: p.attNormal, attHyper: p.attHyper, attJump: p.attJump, attDef: p.attDef, attSniper: p.attSniper,
    apThrow: p.apThrow, apSpecial: p.apSpecial, apJump: p.apJump, apHigh: p.apHigh, apLow: p.apLow, apMiddle: p.apMiddle,
    prefJump: p.prefJump, prefFwd: p.prefFwd, prefBack: p.prefBack, learning: p.learning, forget: p.forget,
  };
}

/**
 * `reset_pilot_personality` as used by the AI: story pilots get the reference's hard-coded personality, tournament
 * pilots (extension) get the preferences from their own record back.
 */
function resetAiPersonality(a: Ai): void {
  if (a.basePersonality) {
    Object.assign(a.pilot, a.basePersonality);
  } else {
    resetPilotPersonality(a.pilot);
  }
}

// BACK / DOWNBACK / UPBACK / FORWARD / DOWNFORWARD / UPFORWARD macros (relative to the HAR's facing).
function back(o: GameObject): number {
  return o.direction === OBJECT_FACE_RIGHT ? ACT_LEFT : ACT_RIGHT;
}
function downBack(o: GameObject): number {
  return back(o) | ACT_DOWN;
}
function upBack(o: GameObject): number {
  return back(o) | ACT_UP;
}
function forward(o: GameObject): number {
  return o.direction === OBJECT_FACE_RIGHT ? ACT_RIGHT : ACT_LEFT;
}
function downForward(o: GameObject): number {
  return forward(o) | ACT_DOWN;
}
function upForward(o: GameObject): number {
  return forward(o) | ACT_UP;
}

/**
 * Converts the move string character at `a.moveStrPos` into a controller action (move strings are stored in reverse
 * input order, with the punch/kick button first). Buttons that follow the direction are merged into the same action
 * and consumed (the position is decremented), like the reference `char_to_act(str, direction, &position)`.
 */
export function charToAct(a: Ai, ch: string, direction: number): number {
  let action = 0;
  switch (ch[a.moveStrPos]) {
    case '8':
      action = ACT_UP;
      break;
    case '2':
      action = ACT_DOWN;
      break;
    case '6':
      action = direction === OBJECT_FACE_LEFT ? ACT_LEFT : ACT_RIGHT;
      break;
    case '4':
      action = direction === OBJECT_FACE_LEFT ? ACT_RIGHT : ACT_LEFT;
      break;
    case '7':
      action = direction === OBJECT_FACE_LEFT ? ACT_UP | ACT_RIGHT : ACT_UP | ACT_LEFT;
      break;
    case '9':
      action = direction === OBJECT_FACE_LEFT ? ACT_UP | ACT_LEFT : ACT_UP | ACT_RIGHT;
      break;
    case '1':
      action = direction === OBJECT_FACE_LEFT ? ACT_DOWN | ACT_RIGHT : ACT_DOWN | ACT_LEFT;
      break;
    case '3':
      action = direction === OBJECT_FACE_LEFT ? ACT_DOWN | ACT_LEFT : ACT_DOWN | ACT_RIGHT;
      break;
    case 'K':
      action = ACT_KICK;
      break;
    case 'P':
      action = ACT_PUNCH;
      break;
    case '5':
      return ACT_STOP;
    default:
      break;
  }

  // it's possible there's a kick/punch, or both, chained on here, so check the next 2 characters
  for (let i = 0; i < 2 && a.moveStrPos > 0; i++) {
    // this is a lookahead, so use - 1 to look at the previous character in the string (move strings are in reverse
    // order)
    switch (ch[a.moveStrPos - 1]) {
      case 'K':
        action |= ACT_KICK;
        a.moveStrPos--;
        break;
      case 'P':
        action |= ACT_PUNCH;
        a.moveStrPos--;
        break;
      default:
        // don't keep going
        return action;
    }
  }

  return action;
}

/** Chain an array of controller commands in sequence. */
function chainControllerCmd(ctrl: AiController, commands: number[], ev: CtrlEvent[]): void {
  for (const c of commands) ctrl.cmd(c, ev);
}

/**
 * The controller commands that enter a move string, oldest input first, the button with the last direction (like the
 * tactics below type the originals' specials), for the robot facing `o`'s way.
 */
export function moveStringCommands(o: GameObject, moveString: string): number[] {
  const left = o.direction === OBJECT_FACE_LEFT;
  const dirs: Record<string, number> = {
    '8': ACT_UP, '2': ACT_DOWN, '6': left ? ACT_LEFT : ACT_RIGHT, '4': left ? ACT_RIGHT : ACT_LEFT,
    '7': ACT_UP | (left ? ACT_RIGHT : ACT_LEFT), '9': ACT_UP | (left ? ACT_LEFT : ACT_RIGHT),
    '1': ACT_DOWN | (left ? ACT_RIGHT : ACT_LEFT), '3': ACT_DOWN | (left ? ACT_LEFT : ACT_RIGHT), '5': ACT_STOP,
  };
  const cmds = [...moveString.slice(1)].reverse().map((c) => dirs[c] ?? ACT_STOP);
  const button = moveString[0] === 'K' ? ACT_KICK : ACT_PUNCH;
  if (!cmds.length || cmds[cmds.length - 1] === ACT_STOP) cmds.push(button);
  else cmds[cmds.length - 1] |= button;
  return cmds;
}

/** A mod robot's special for a tactic (its robot.json names them): typed out like the originals'. False: it has none. */
function modTactic(ctrl: AiController, kind: 'projectile' | 'charge' | 'push', ev: CtrlEvent[]): boolean {
  const [o, h] = aiHar(ctrl);
  const ids = modRobot(h.id)?.info.ai[kind];
  if (!ids?.length) return false;
  const move = afGetMove(h.afData, ids.length > 1 ? ids[globalRandom.int(ids.length)] : ids[0]);
  if (!move || !/^[PK][1-9]*$/.test(move.moveString)) return false;
  chainControllerCmd(ctrl, moveStringCommands(o, move.moveString), ev);
  return true;
}

/** Convenience method to roll '1 in x' chance. */
function rollChance(rollX: number): boolean {
  return rollX <= 1 ? true : globalRandom.int(rollX) === 1;
}

/** Roll chance for pilot preference (-100 to 100). */
function rollPref(prefVal: number): boolean {
  const randRoll = globalRandom.int(200);
  const prefThresh = prefVal + 100;
  return randRoll <= prefThresh;
}

/** Determine whether the AI is smart enough to usually go ahead with an action. */
function smartUsually(a: Ai): boolean {
  if (a.difficulty >= 6) {
    // at highest difficulty 92% chance to be smart
    return !rollChance(12);
  } else if (a.difficulty >= 3) {
    return rollChance(7 - a.difficulty);
  }
  return false;
}

/** Determine whether the AI is dumb enough to usually go ahead with an action. */
function dumbUsually(a: Ai): boolean {
  if (a.difficulty === 1) {
    // at lowest difficulty 92% chance to be dumb
    return !rollChance(12);
  }
  if (a.difficulty <= 2) {
    return rollChance(a.difficulty + 1);
  }
  return false;
}

/** Determine whether the AI is smart enough to sometimes go ahead with an action. */
function smartSometimes(a: Ai): boolean {
  if (a.difficulty >= 2) {
    return rollChance(10 - a.difficulty);
  }
  return false;
}

/** Determine whether the AI is dumb enough to sometimes go ahead with an action. */
function dumbSometimes(a: Ai): boolean {
  if (a.difficulty <= 2) {
    return rollChance(a.difficulty + 2);
  }
  return false;
}

/** Determine whether AI will proceed with an action using exponentially scaling roll. */
function diffScale(a: Ai): boolean {
  const roll = globalRandom.int(36);
  return roll <= a.difficulty * a.difficulty;
}

/** Determine whether AI will learn from this moment. */
function learningMoment(a: Ai): boolean {
  const roll = globalRandom.int(diffScale(a) ? 8 : 15);
  return roll <= a.pilot.learning;
}

/** Determine whether AI will forget something. */
function forgetful(a: Ai): boolean {
  const roll = globalRandom.int(diffScale(a) ? 3 : 2);
  return roll <= a.pilot.forget;
}

function aiHar(ctrl: AiController): [GameObject, Har] {
  const o = ctrl.gs.findObject(ctrl.harObjId)!;
  return [o, harData(o)];
}

function enemyHarObj(ctrl: AiController, h: Har): GameObject {
  return ctrl.gs.findObject(ctrl.gs.getPlayer(h.playerId === 1 ? 0 : 1).harObjId)!;
}

/** Determine the current range classification. */
function getEnemyRange(ctrl: AiController): number {
  const [o, h] = aiHar(ctrl);
  const oEnemy = enemyHarObj(ctrl, h);

  const rangeUnits = Math.trunc(Math.abs(oEnemy.posX - o.posX) / 30);
  switch (rangeUnits) {
    case 0:
    case 1:
      return RANGE_CRAMPED;
    case 2:
      return RANGE_CLOSE;
    case 3:
    case 4:
      return RANGE_MID;
    default:
      return RANGE_FAR;
  }
}

function enemyIsStunnedOrStasis(ctrl: AiController): boolean {
  const [, h] = aiHar(ctrl);
  const hEnemy = harData(enemyHarObj(ctrl, h));
  return hEnemy.state === HarState.STUNNED || hEnemy.inStasisTicks !== 0;
}

const BASIC_MOVE_STRINGS = new Set(['K', 'K1', 'K2', 'K3', 'K4', 'K6', 'P', 'P1', 'P2', 'P3', 'P4', 'P6']);

/** Convenience method to check whether the provided move is a special move. */
export function isSpecialMove(move: AfMove): boolean {
  return !BASIC_MOVE_STRINGS.has(move.moveString);
}

/** Convenience method to check whether a HAR has projectiles. */
export function harHasProjectiles(harId: number): boolean {
  switch (harId) {
    case HarId.JAGUAR:
    case HarId.SHADOW:
    case HarId.ELECTRA:
    case HarId.SHREDDER:
    case HarId.CHRONOS:
    case HarId.NOVA:
    // The remaster's robots: ICE LANCE, GALE BLAST, DRILL BIT, PHOTON BEAM.
    case HarId.GLACIER:
    case HarId.TEMPEST:
    case HarId.HELIX:
    case HarId.SPECTRE:
      return true;
  }
  return (modRobot(harId)?.info.ai.projectile.length ?? 0) > 0;
}

/** Convenience method to check whether a HAR has a charge attack. */
export function harHasCharge(harId: number): boolean {
  switch (harId) {
    case HarId.JAGUAR:
    case HarId.SHADOW:
    case HarId.KATANA:
    case HarId.FLAIL:
    case HarId.THORN:
    case HarId.PYROS:
    case HarId.ELECTRA:
    case HarId.SHREDDER:
    case HarId.CHRONOS:
    case HarId.GARGOYLE:
    case HarId.GLACIER:
    case HarId.TEMPEST:
    case HarId.HELIX:
    case HarId.SPECTRE:
      return true;
  }
  return (modRobot(harId)?.info.ai.charge.length ?? 0) > 0;
}

/** Convenience method to check whether a HAR has a push attack. */
export function harHasPush(harId: number): boolean {
  switch (harId) {
    case HarId.JAGUAR:
    case HarId.KATANA:
    case HarId.FLAIL:
    case HarId.THORN:
    case HarId.PYROS:
    case HarId.ELECTRA:
    case HarId.NOVA:
    case HarId.GLACIER:
    case HarId.TEMPEST:
    case HarId.HELIX:
      return true;
  }
  return (modRobot(harId)?.info.ai.push.length ?? 0) > 0;
}

/** Determine whether the AI would like to use the specified tactic. */
function likesTactic(ctrl: AiController, tacticType: number): boolean {
  const a = ctrl.data;
  const [, h] = aiHar(ctrl);
  const pilot = a.pilot;

  if ((a.tactic.lastTactic === tacticType && rollChance(2)) || h.state === HarState.JUMPING) {
    return false;
  }

  const enemyClose = !!h.close;
  const enemyRange = getEnemyRange(ctrl);
  const wallClose = !!h.isWallhugging;

  switch (tacticType) {
    case TACTIC_SHOOT:
      if (harHasProjectiles(h.id) && rollPref(pilot.attSniper) && enemyRange > RANGE_CRAMPED &&
        (h.id !== HarId.SHREDDER || ((enemyRange <= RANGE_MID && smartUsually(a)) || dumbSometimes(a))) // shredder prefers to be close-mid range
      ) {
        return true;
      }
      break;
    case TACTIC_CLOSE:
      if (enemyRange > RANGE_CRAMPED && (harHasCharge(h.id) || rollChance(4)) && rollPref(pilot.attHyper)) {
        return true;
      }
      break;
    case TACTIC_QUICK:
      if (enemyRange > RANGE_CRAMPED && enemyRange < RANGE_FAR &&
        ((rollPref(pilot.attSniper) && rollChance(3)) || (rollPref(pilot.attHyper) && rollChance(6)) ||
          (rollPref(pilot.attNormal) && rollChance(8)))) {
        return true;
      }
      break;
    case TACTIC_GRAB:
      if ((a.thrown <= MAX_TIMES_THROWN || rollChance(2)) &&
        ((rollPref(pilot.attHyper) && rollChance(3)) ||
          ((h.id === HarId.FLAIL || h.id === HarId.THORN) && rollChance(3)))) {
        return true;
      }
      break;
    case TACTIC_TURTLE:
      if (a.thrown <= MAX_TIMES_THROWN && rollPref(pilot.attDef) && rollChance(3)) {
        return true;
      }
      break;
    case TACTIC_COUNTER:
      if (a.thrown < MAX_TIMES_THROWN && rollPref(pilot.attDef) && rollChance(3)) {
        return true;
      }
      break;
    case TACTIC_ESCAPE:
      if ((rollPref(pilot.attJump) && rollChance(3)) || (rollPref(pilot.attDef) && rollChance(5))) {
        return true;
      }
      break;
    case TACTIC_FLY:
      if ((rollPref(a.pilot.attJump) || (a.shot > MAX_TIMES_SHOT && learningMoment(a)) ||
        (h.id === HarId.GARGOYLE || h.id === HarId.PYROS)) &&
        ((wallClose && rollChance(2)) || rollChance(4))) {
        return true;
      }
      break;
    case TACTIC_PUSH:
      if ((enemyRange <= RANGE_CLOSE ||
        ((h.id === HarId.THORN || h.id === HarId.KATANA) && enemyRange <= RANGE_MID)) &&
        ((harHasPush(h.id) && smartUsually(a)) &&
          ((rollPref(pilot.attHyper) && rollChance(2)) || (rollPref(pilot.attDef) && rollChance(4)) ||
            (wallClose && rollChance(5))))) {
        return true;
      }
      break;
    case TACTIC_TRIP:
      if (enemyRange <= RANGE_MID &&
        ((rollPref(pilot.attDef) && rollChance(4)) || (rollPref(pilot.attSniper) && rollChance(6)))) {
        return true;
      }
      break;
    case TACTIC_SPAM:
      if ((enemyClose || dumbUsually(a)) && (wallClose || rollChance(6)) && rollPref(pilot.attNormal)) {
        return true;
      }
      break;
  }

  return false;
}

/** Queue the specified tactic in AI tactical state object. */
function queueTactic(ctrl: AiController, tacticType: number): void {
  const a = ctrl.data;
  const [, h] = aiHar(ctrl);
  const tactic = a.tactic;

  tactic.lastTactic = tactic.tacticType > 0 ? tactic.tacticType : 0;
  tactic.tacticType = tacticType;

  const enemyClose = !!h.close;
  const wallClose = !!h.isWallhugging;
  const enemyRange = getEnemyRange(ctrl);

  let doCharge = false;

  // set move tactic
  switch (tacticType) {
    // aggressive tactics
    case TACTIC_GRAB:
    case TACTIC_TRIP:
    case TACTIC_QUICK:
    case TACTIC_CLOSE:
      if (enemyClose) {
        tactic.moveType = 0;
      } else if ((tacticType === TACTIC_CLOSE || (tacticType === TACTIC_QUICK && rollChance(3))) &&
        smartUsually(a) && harHasCharge(h.id)) {
        // smart AI will try to use charge attacks
        tactic.moveType = 0;
        doCharge = true;
      } else if (smartUsually(a) && rollPref(a.pilot.prefJump)) {
        // smart AI that likes to jump will close via jump
        tactic.moveType = MOVE_JUMP;
      } else {
        tactic.moveType = MOVE_CLOSE;
      }
      break;
    // jumping tactics
    case TACTIC_FLY:
      tactic.moveType = MOVE_HIGH_JUMP;
      break;
    // ranged tactics
    case TACTIC_SHOOT:
      tactic.moveType = enemyRange === RANGE_CRAMPED && !wallClose ? MOVE_AVOID : 0;
      break;
    // stalling tactics
    case TACTIC_PUSH:
    case TACTIC_SPAM:
      tactic.moveType = 0;
      break;
    // evasive tactics
    case TACTIC_ESCAPE:
      tactic.moveType = wallClose ? MOVE_JUMP : MOVE_AVOID;
      break;
    // goading tactics
    case TACTIC_TURTLE:
      if (enemyRange === RANGE_CRAMPED) {
        // at this range they might grab/throw so we need to use escape tactic
        tactic.moveType = wallClose ? MOVE_JUMP : MOVE_AVOID;
      } else {
        tactic.moveType = MOVE_BLOCK;
      }
      break;
    case TACTIC_COUNTER:
      tactic.moveType = enemyRange > RANGE_CRAMPED ? MOVE_BLOCK : 0;
      break;
  }

  // set tactic move timer
  if (tactic.moveType > 0) {
    tactic.moveTimer = TACTIC_MOVE_TIMER_MAX;
  }

  if (doCharge) {
    // set charge attack
    tactic.attackType = ATTACK_CHARGE;
    tactic.attackId = 0;
  } else {
    // set attack tactics
    switch (tacticType) {
      // aggressive tactics
      case TACTIC_GRAB:
        tactic.attackType = ATTACK_GRAB;
        tactic.attackId = 0;
        break;
      case TACTIC_TRIP:
        tactic.attackType = ATTACK_TRIP;
        tactic.attackId = 0;
        // if we are jumping we wait for land to trip
        if (tactic.moveType === MOVE_JUMP) {
          tactic.attackOn = HarEventType.LAND;
        }
        break;
      case TACTIC_QUICK:
        tactic.attackType = ATTACK_LIGHT;
        tactic.attackId = 0;
        break;
      case TACTIC_FLY:
        // smart AI will try for a jumping attack
        tactic.attackType = smartUsually(a) ? ATTACK_JUMP : 0;
        tactic.attackId = 0;
        break;
      case TACTIC_SHOOT:
        tactic.attackType = ATTACK_RANGED;
        tactic.attackId = 0;
        break;
      case TACTIC_PUSH:
        if (harHasPush(h.id)) { // && smart_sometimes(a)
          tactic.attackType = ATTACK_PUSH;
        } else {
          tactic.attackType = ATTACK_HEAVY;
        }
        tactic.attackId = 0;
        break;
      case TACTIC_SPAM:
        if (a.lastMoveId > 0) {
          tactic.attackType = ATTACK_ID;
          tactic.attackId = a.lastMoveId;
        } else {
          tactic.attackType = ATTACK_LIGHT;
          tactic.attackId = 0;
        }
        break;
      case TACTIC_COUNTER:
        // Note: the reference leaves attack_id untouched here.
        tactic.attackType = rollChance(3) ? ATTACK_TRIP : ATTACK_HEAVY;
        // we only wait for block if they're not in range to grab/throw
        if (enemyRange > RANGE_CRAMPED) {
          tactic.attackOn = HarEventType.BLOCK;
        }
        break;
      case TACTIC_CLOSE:
        tactic.attackType = ATTACK_RANDOM;
        tactic.attackId = 0;
        break;
      case TACTIC_ESCAPE:
      case TACTIC_TURTLE:
        tactic.attackType = 0;
        tactic.attackId = 0;
    }
  }

  // set tactic attack timer
  if (tactic.attackType > 0) {
    if (tactic.moveType === MOVE_JUMP || tactic.moveType === MOVE_HIGH_JUMP) {
      tactic.attackTimer = TACTIC_JUMP_ATTACK_TIMER_MAX;
    } else {
      tactic.attackTimer = TACTIC_ATTACK_TIMER_MAX;
    }
  }
}

/** Consider each of the provided tactics in order and queue one we like. */
function chainConsiderTactics(ctrl: AiController, tactics: number[]): void {
  for (const t of tactics) {
    if (likesTactic(ctrl, t)) {
      queueTactic(ctrl, t);
      return;
    }
  }
}

function resetTacticState(a: Ai): void {
  const t = a.tactic;
  t.lastTactic = t.tacticType ? t.tacticType : 0;
  t.tacticType = 0;
  t.moveType = 0;
  t.moveTimer = 0;
  t.attackType = 0;
  t.attackId = 0;
  t.attackTimer = 0;
  t.attackOn = 0;
  t.chainHitOn = 0;
  t.chainHitTactic = 0;
}

/**
 * Reset pilot personality. This is hard-coded per story-mode pilot id in the reference; pilots with other ids
 * (tournament opponents) keep the preferences loaded from their TRN/CHR records. Fields a case does not mention keep
 * their current value (as in the reference).
 */
export function resetPilotPersonality(pilot: Pilot): void {
  // (a mod pilot fights like the original pilot its pilot.json names)
  switch (modPilot(pilot.pilotId)?.info.personality ?? pilot.pilotId) {
    case 0:
      // crystal
      pilot.attNormal = 30;
      pilot.attHyper = 10;
      pilot.attJump = 10;
      pilot.attSniper = 20;
      pilot.apThrow = 100;
      pilot.apSpecial = 75;
      pilot.apJump = -30;
      pilot.apHigh = -50;
      pilot.apLow = -50;
      pilot.apMiddle = -50;
      pilot.prefJump = -10;
      pilot.prefFwd = 30;
      pilot.prefBack = 10;
      pilot.learning = Math.fround(1.5);
      pilot.forget = Math.fround(0.25);
      break;
    case 1:
      // steffan
      pilot.attNormal = 40;
      pilot.attHyper = 60;
      pilot.attJump = 30;
      pilot.apThrow = 25;
      pilot.apSpecial = 20;
      pilot.apHigh = -75;
      pilot.apLow = 75;
      pilot.apMiddle = 50;
      pilot.prefJump = 6;
      pilot.prefFwd = 20;
      pilot.prefBack = -9;
      pilot.learning = Math.fround(1.0);
      pilot.forget = Math.fround(0.4);
      break;
    case 2:
      // milano
      pilot.attNormal = 20;
      pilot.attHyper = 30;
      pilot.attJump = 40;
      pilot.attSniper = 20;
      pilot.apThrow = -50;
      pilot.apSpecial = -50;
      pilot.apJump = -50;
      pilot.apHigh = 50;
      pilot.apLow = 50;
      pilot.apMiddle = 50;
      pilot.prefJump = 8;
      pilot.prefFwd = 30;
      pilot.prefBack = -3;
      pilot.learning = Math.fround(0.9);
      pilot.forget = Math.fround(0.1);
      break;
    case 3:
      // christian
      pilot.attNormal = 20;
      pilot.attHyper = 15;
      pilot.attDef = 30;
      pilot.attSniper = 10;
      pilot.apThrow = 30;
      pilot.apSpecial = 25;
      pilot.apJump = 30;
      pilot.apLow = -25;
      pilot.apMiddle = 20;
      pilot.prefJump = 2;
      pilot.prefFwd = 10;
      pilot.prefBack = -10;
      pilot.learning = Math.fround(2.5);
      pilot.forget = Math.fround(0.35);
      break;
    case 4:
      // shirro
      pilot.attNormal = 15;
      pilot.attHyper = 5;
      pilot.attJump = 5;
      pilot.attDef = 20;
      pilot.attSniper = 4;
      pilot.apThrow = 75;
      pilot.apSpecial = 50;
      pilot.apJump = -50;
      pilot.apHigh = -50;
      pilot.apLow = -50;
      pilot.apMiddle = -50;
      pilot.prefJump = -20;
      pilot.prefFwd = 10;
      pilot.prefBack = 10;
      pilot.learning = Math.fround(2.0);
      pilot.forget = Math.fround(0.2);
      break;
    case 5:
      // jean-paul
      pilot.attNormal = 20;
      pilot.attHyper = 10;
      pilot.attJump = 20;
      pilot.attDef = 30;
      pilot.attSniper = 45;
      pilot.apThrow = -50;
      pilot.apSpecial = 75;
      pilot.apJump = 100;
      pilot.apHigh = -50;
      pilot.apLow = 100;
      pilot.apMiddle = -50;
      pilot.prefFwd = 20;
      pilot.learning = Math.fround(1.2);
      pilot.forget = Math.fround(0.07);
      break;
    case 6:
      // ibrahim
      pilot.attNormal = 40;
      pilot.attHyper = 5;
      pilot.attJump = 5;
      pilot.attDef = 50;
      pilot.attSniper = 7;
      pilot.apSpecial = 50;
      pilot.apJump = -50;
      pilot.apHigh = 50;
      pilot.apLow = 50;
      pilot.apMiddle = 50;
      pilot.prefJump = 2;
      pilot.prefFwd = 10;
      pilot.prefBack = -10;
      pilot.learning = Math.fround(2.5);
      pilot.forget = Math.fround(0.05);
      break;
    case 7:
      // angel
      pilot.attNormal = 40;
      pilot.attHyper = 60;
      pilot.attJump = 30;
      pilot.apThrow = 25;
      pilot.apSpecial = 20;
      pilot.apJump = 100;
      pilot.apHigh = -75;
      pilot.apLow = 75;
      pilot.apMiddle = 50;
      pilot.prefJump = 40;
      pilot.prefFwd = 40;
      pilot.prefBack = -9;
      pilot.learning = Math.fround(3.0);
      pilot.forget = Math.fround(0.15);
      break;
    case 8:
      // cossette
      pilot.attNormal = 50;
      pilot.attHyper = 5;
      pilot.attJump = 5;
      pilot.attDef = 5;
      pilot.attSniper = 5;
      pilot.apThrow = 25;
      pilot.apSpecial = -50;
      pilot.apJump = -50;
      pilot.apHigh = -25;
      pilot.apLow = 10;
      pilot.apMiddle = -50;
      pilot.prefJump = -10;
      pilot.prefBack = 10;
      pilot.learning = Math.fround(0.7);
      pilot.forget = Math.fround(0.2);
      break;
    case 9:
      // raven
      pilot.attNormal = 30;
      pilot.attHyper = 40;
      pilot.apThrow = 100;
      pilot.apSpecial = 100;
      pilot.apJump = 100;
      pilot.apHigh = 100;
      pilot.apLow = 100;
      pilot.apMiddle = 100;
      pilot.prefJump = 12;
      pilot.prefFwd = 30;
      pilot.prefBack = -7;
      pilot.learning = Math.fround(3.0);
      pilot.forget = Math.fround(0.5);
      break;
    case 10:
      // kreissack
      // special
      pilot.attNormal = 30;
      pilot.attHyper = 75;
      pilot.attSniper = 25;
      pilot.apThrow = 100;
      pilot.apSpecial = 100;
      pilot.learning = Math.fround(3.0);
      pilot.forget = Math.fround(0.25);
      break;
  }
}

/** Reset the base movement act timer. */
function resetActTimer(a: Ai): void {
  a.actTimer = BASE_ACT_TIMER - a.difficulty * 2 - globalRandom.int(3);
}

/** Determine whether a pilot dislikes a move. Used for random attacks. */
function dislikesMove(a: Ai, move: AfMove): boolean {
  // check for non-projectile special moves
  if (isSpecialMove(move)) {
    // pilots with bad special ability dislike special moves
    return !rollPref(a.pilot.apSpecial);
  }

  switch (move.category) {
    case CAT_BASIC:
      // smart AI dislike basic moves
      return !rollPref(a.pilot.attNormal) && smartUsually(a);
    case CAT_LOW:
      // pilots with bad low ability dislike low moves
      return !rollPref(a.pilot.attNormal) && !rollPref(a.pilot.apLow);
    case CAT_MEDIUM:
      // pilots with bad middle ability dislike middle moves
      return !rollPref(a.pilot.attNormal) && !rollPref(a.pilot.apMiddle);
    case CAT_HIGH:
      // pilots with bad high ability dislike high moves
      return !rollPref(a.pilot.attNormal) && !rollPref(a.pilot.apHigh);
    case CAT_CLOSE:
      // non-hyper pilots with bad throw ability dislike throw moves
      return !rollPref(a.pilot.attHyper) && !rollPref(a.pilot.apThrow);
    case CAT_JUMPING:
      // non-jumper pilots with bad jump ability dislike jump moves
      return !rollPref(a.pilot.attJump) && !rollPref(a.pilot.apJump);
    case CAT_PROJECTILE:
      // non-sniper pilots with bad special ability dislike projectile moves
      return !rollPref(a.pilot.attSniper) && !rollPref(a.pilot.apSpecial);
  }

  return false;
}

/** Determine whether a move is too powerful for AI difficulty. */
function moveTooPowerful(a: Ai, move: AfMove): boolean {
  return isSpecialMove(move) && dumbUsually(a);
}

/** HAR event hook (reference `ai_har_event`). */
function aiHarEvent(ctrl: AiController, event: HarEvent): number {
  const a = ctrl.data;
  const [, h] = aiHar(ctrl);
  const pilot = a.pilot;
  let ms: MoveStat;

  let hasQueuedTactic = a.tactic.tacticType > 0;

  if (hasQueuedTactic) {
    switch (event.type) {
      case HarEventType.BLOCK:
      case HarEventType.BLOCK_PROJECTILE:
        if (a.tactic.tacticType !== TACTIC_COUNTER && a.tactic.tacticType !== TACTIC_TURTLE &&
          a.tactic.tacticType !== TACTIC_TRIP && a.tactic.tacticType !== TACTIC_PUSH &&
          a.tactic.tacticType !== TACTIC_SPAM && a.tactic.tacticType !== TACTIC_FLY &&
          (a.tactic.tacticType !== TACTIC_GRAB || rollChance(2)) &&
          (a.tactic.chainHitOn === 0 || a.tactic.chainHitOn !== event.move!.category)) {
          resetTacticState(a);
          hasQueuedTactic = false;
        }
        break;
      case HarEventType.TAKE_HIT:
        if (a.tactic.tacticType === TACTIC_CLOSE || a.tactic.tacticType === TACTIC_FLY ||
          a.tactic.tacticType === TACTIC_COUNTER ||
          (a.tactic.tacticType === TACTIC_TURTLE && !pilot.attDef)) {
          resetTacticState(a);
          hasQueuedTactic = false;
        }
        break;
      case HarEventType.ENEMY_STUN:
        if (a.tactic.tacticType === TACTIC_GRAB || a.tactic.tacticType === TACTIC_CLOSE ||
          a.tactic.tacticType === TACTIC_TRIP) {
          // Extend tactic move timer to capitalize on stun
          a.tactic.moveTimer = TACTIC_MOVE_TIMER_MAX;
        } else if (a.tactic.tacticType !== TACTIC_SHOOT) {
          resetTacticState(a);
          hasQueuedTactic = false;
        }
        break;
    }
  }

  switch (event.type) {
    case HarEventType.ATTACK:
    case HarEventType.ENEMY_BLOCK:
    case HarEventType.ENEMY_BLOCK_PROJECTILE:
    case HarEventType.LAND_HIT:
    case HarEventType.LAND_HIT_PROJECTILE:
      a.selectedMove = null;
      break;
  }

  switch (event.type) {
    case HarEventType.LAND_HIT:
    case HarEventType.LAND_HIT_PROJECTILE: {
      const move = event.move!;
      ms = a.moveStats[move.id];

      // in the heat of the moment they might forget what they have learnt
      if (rollChance(2) && forgetful(a)) {
        resetAiPersonality(a);
        a.blocked = 0;
        a.thrown = 0;
        a.shot = 0;
      }

      if (ms.maxHitDist === -1 || ms.lastDist > ms.maxHitDist) {
        ms.maxHitDist = ms.lastDist;
      }

      if (ms.minHitDist === -1 || ms.lastDist < ms.minHitDist) {
        ms.minHitDist = ms.lastDist;
      }

      ms.value++;
      if (ms.value > 10) {
        ms.value = 10;
      }

      a.lastMoveId = move.id;

      if (a.tactic.chainHitOn === move.category) {
        // Queueing chained tactic
        queueTactic(ctrl, a.tactic.chainHitTactic);
        break;
      }

      if (hasQueuedTactic || !smartUsually(a)) {
        break;
      }

      if (event.type === HarEventType.LAND_HIT_PROJECTILE) {
        // we hit with a projectile
        chainConsiderTactics(ctrl, [TACTIC_FLY, TACTIC_TURTLE, TACTIC_CLOSE, TACTIC_SHOOT]);
      } else {
        // we hit with a HAR attack
        chainConsiderTactics(ctrl, [TACTIC_QUICK, TACTIC_TRIP, TACTIC_GRAB, TACTIC_PUSH,
          TACTIC_CLOSE, TACTIC_SHOOT, TACTIC_TURTLE, TACTIC_SPAM]);
      }
      break;
    }

    case HarEventType.ENEMY_BLOCK:
    case HarEventType.ENEMY_BLOCK_PROJECTILE: {
      const move = event.move!;
      ms = a.moveStats[move.id];
      if (!a.blocked) {
        a.blocked = 1;
        ms.value--;

        a.lastMoveId = move.id;

        if (hasQueuedTactic || !smartUsually(a)) {
          break;
        }

        if (event.type === HarEventType.ENEMY_BLOCK_PROJECTILE) {
          // enemy blocked our projectile
          chainConsiderTactics(ctrl, [TACTIC_FLY, TACTIC_ESCAPE, TACTIC_TURTLE, TACTIC_CLOSE, TACTIC_SHOOT]);
        } else {
          // enemy blocked our HAR attack
          chainConsiderTactics(ctrl, [TACTIC_GRAB, TACTIC_TRIP, TACTIC_PUSH, TACTIC_COUNTER, TACTIC_TURTLE,
            TACTIC_ESCAPE, TACTIC_FLY, TACTIC_QUICK, TACTIC_SPAM]);
        }
      }
      break;
    }

    case HarEventType.BLOCK:
    case HarEventType.BLOCK_PROJECTILE: {
      if (hasQueuedTactic && a.tactic.attackOn === HarEventType.BLOCK) {
        // do the attack now (attempting counter move)
        a.tactic.moveTimer = 0;
        break;
      }

      if (hasQueuedTactic || !smartUsually(a)) {
        break;
      }

      if (event.type === HarEventType.BLOCK_PROJECTILE) {
        // count this as being shot to respond to spam quicker
        a.shot++;
        // we blocked a projectile
        chainConsiderTactics(ctrl, [TACTIC_FLY, TACTIC_SHOOT, TACTIC_CLOSE, TACTIC_TURTLE]);
      } else {
        // we blocked a HAR attack
        chainConsiderTactics(ctrl, [TACTIC_TRIP, TACTIC_PUSH, TACTIC_TURTLE, TACTIC_GRAB,
          TACTIC_ESCAPE, TACTIC_QUICK, TACTIC_SPAM]);
      }
      break;
    }

    case HarEventType.LAND: {
      if (hasQueuedTactic && a.tactic.attackOn === HarEventType.LAND && h.state === HarState.STANDING) {
        // do the attack now (attempting landing move)
        a.tactic.moveTimer = 0;
        a.tactic.attackOn = 0;
        break;
      } else {
        a.actTimer = 0;

        if (!hasQueuedTactic && smartUsually(a)) {
          chainConsiderTactics(ctrl, [TACTIC_TRIP, TACTIC_QUICK, TACTIC_PUSH, TACTIC_GRAB,
            TACTIC_SHOOT, TACTIC_COUNTER, TACTIC_TURTLE, TACTIC_CLOSE]);
        }
      }
      break;
    }

    case HarEventType.ATTACK:
      a.tactic.moveTimer = 0;
      break;

    case HarEventType.HIT_WALL: {
      if (hasQueuedTactic || !smartUsually(a)) {
        break;
      }

      chainConsiderTactics(ctrl, [TACTIC_SHOOT, TACTIC_PUSH, TACTIC_TURTLE, TACTIC_TRIP,
        TACTIC_FLY, TACTIC_ESCAPE, TACTIC_COUNTER, TACTIC_CLOSE]);
      break;
    }

    case HarEventType.TAKE_HIT:
    case HarEventType.TAKE_HIT_PROJECTILE: {
      const move = event.move!;
      // if enemy is cheesing the AI will try to adjust
      if (move.category === CAT_CLOSE) {
        // keep track of how many times we have been thrown
        a.thrown++;
        if (learningMoment(a) && a.thrown >= MAX_TIMES_THROWN) {
          // AI adjusting in response to repeated throws.
          // avoid defensive tactics
          if (pilot.attDef > 90) {
            pilot.attDef = 10;
          }
          // favor sniper tactics
          if (pilot.attSniper < 90) {
            pilot.attSniper += 10;
          }
          // favor jumping tactics
          if (pilot.attJump < 90) {
            pilot.attJump += 10;
          }
          // favor jumping movement
          if (pilot.prefJump < 90) {
            pilot.prefJump += 10;
          }
          // favor backwards movement
          if (pilot.prefBack < 90) {
            pilot.prefBack += 10;
          }
          if (pilot.prefFwd > 90) {
            pilot.prefFwd -= 10;
          }
        }
      } else if (event.type === HarEventType.TAKE_HIT_PROJECTILE) {
        // keep track of how many times we have been shot
        a.shot++;
        if (learningMoment(a) && a.shot >= MAX_TIMES_SHOT) {
          // AI adjusting in response to repeated projectiles.
          // avoid defensive tactics
          if (pilot.attDef > 90) {
            pilot.attDef = 10;
          }
          // favor shooting tactics (sic: the reference assigns instead of adding)
          if (pilot.attSniper < 90) {
            pilot.attSniper = 10;
          }
          // favor aggressive tactics (sic)
          if (pilot.attHyper < 90) {
            pilot.attHyper = 10;
          }
          // favor jumping tactics
          if (pilot.attJump < 20) {
            pilot.attJump += 20;
          }
          if (pilot.prefJump < 90) {
            pilot.prefJump += 10;
          }
          // favor forwards movement
          if (pilot.prefFwd < 90) {
            pilot.prefFwd += 10;
          }
          if (pilot.prefBack > 90) {
            pilot.prefBack -= 10;
          }
        }
      }

      if (hasQueuedTactic || !smartUsually(a)) {
        break;
      }

      if (move.category === CAT_CLOSE) {
        // distance gaining tactics
        chainConsiderTactics(ctrl, [TACTIC_ESCAPE, TACTIC_PUSH, TACTIC_FLY]);
      } else if (event.type === HarEventType.TAKE_HIT_PROJECTILE) {
        // aggressive tactics
        chainConsiderTactics(ctrl, [TACTIC_CLOSE, TACTIC_FLY, TACTIC_SHOOT, TACTIC_GRAB]);
      } else {
        // defensive tactics
        chainConsiderTactics(ctrl, [TACTIC_COUNTER, TACTIC_TURTLE, TACTIC_ESCAPE, TACTIC_PUSH,
          TACTIC_TRIP, TACTIC_QUICK, TACTIC_SPAM]);
      }
      break;
    }

    case HarEventType.RECOVER: {
      if (hasQueuedTactic || !smartUsually(a)) {
        break;
      }

      chainConsiderTactics(ctrl, [TACTIC_SHOOT, TACTIC_COUNTER, TACTIC_TURTLE, TACTIC_ESCAPE]);
      break;
    }

    case HarEventType.ENEMY_HAZARD_HIT: {
      if (hasQueuedTactic || !smartUsually(a)) {
        break;
      }

      // HAR capitalize on hazard
      chainConsiderTactics(ctrl, [TACTIC_GRAB, TACTIC_TRIP, TACTIC_QUICK, TACTIC_CLOSE, TACTIC_SHOOT]);
      break;
    }

    case HarEventType.ENEMY_STUN: {
      if (hasQueuedTactic || !smartUsually(a)) {
        break;
      }

      // HAR capitalize on stun
      chainConsiderTactics(ctrl, [TACTIC_GRAB, TACTIC_CLOSE, TACTIC_TRIP, TACTIC_SHOOT]);
      break;
    }

    default:
      break;
  }

  return 0;
}

/** Check whether a move is valid and can be initiated. */
function isValidMove(move: AfMove, h: Har, forceAllowProjectile: boolean): boolean {
  // If category is any of these, and bot is not close, then
  // do not try to execute any of them. This attempts
  // to make the HARs close up instead of standing in place
  // wawing their hands towards each other. Not a perfect solution.
  switch (move.category) {
    case CAT_CLOSE:
    case CAT_LOW:
    case CAT_MEDIUM:
    case CAT_HIGH:
      // Only allow handwaving if close or jumping
      if (!h.close && h.state !== HarState.JUMPING) {
        return false;
      }
  }
  if (move.category === CAT_JUMPING && h.state !== HarState.JUMPING) {
    // not jumping but trying to execute a jumping move
    return false;
  }
  if (move.category !== CAT_JUMPING && h.state === HarState.JUMPING) {
    // jumping but this move is not a jumping move
    return false;
  }
  if (move.category === CAT_SCRAP && h.state !== HarState.VICTORY) {
    return false;
  }
  if (move.category === CAT_DESTRUCTION && h.state !== HarState.SCRAP) {
    return false;
  }
  if (move.category === CAT_VICTORY) {
    return false;
  }

  // XXX check for chaining?

  const moveStr = move.moveString;
  const moveStrLen = moveStr.length;
  for (let i = 0; i < moveStrLen; i++) {
    const tmp = moveStr[i];
    if (!((tmp >= '1' && tmp <= '9') || tmp === 'K' || tmp === 'P')) {
      if (forceAllowProjectile && move.category === CAT_PROJECTILE) {
        return true; // projectile is always true
      }
      return false;
    }
  }

  if ((move.damage > 0 || move.category === CAT_PROJECTILE || move.category === CAT_SCRAP ||
    move.category === CAT_DESTRUCTION) && moveStrLen > 0) {
    return true;
  }

  return false;
}

/** Sets the selected move. */
function setSelectedMove(ctrl: AiController, selectedMove: AfMove): void {
  const a = ctrl.data;
  const [o, h] = aiHar(ctrl);

  a.moveStats[selectedMove.id].attempts++;
  a.moveStats[selectedMove.id].consecutive++;

  // do the move
  a.selectedMove = selectedMove;
  a.moveStrPos = selectedMove.moveString.length - 1;
  const oEnemy = enemyHarObj(ctrl, h);
  a.moveStats[selectedMove.id].lastDist = Math.trunc(Math.abs(o.posX - oEnemy.posX));
  a.blocked = 0;
}

/** Halves every move's consecutive-use counter (after a new move has been picked). */
function decayConsecutive(a: Ai): void {
  for (let i = 0; i < MAX_MOVES; i++) {
    a.moveStats[i].consecutive = Math.trunc(a.moveStats[i].consecutive / 2);
  }
}

/** Assigns a move by category identifier. */
function assignMoveByCat(ctrl: AiController, category: number, highestDamage: boolean): boolean {
  const a = ctrl.data;
  const [, h] = aiHar(ctrl);

  let selectedMove: AfMove | null = null;
  let topValue = 0;

  // Attack
  for (let i = 0; i < MAX_MOVES; i++) {
    const move = afGetMove(h.afData, i);
    if (move) {
      // category filter
      if (category !== move.category) {
        continue;
      }

      const ms = a.moveStats[i];
      if (isValidMove(move, h, true)) {
        let value: number;
        if (highestDamage) {
          // evaluate the move based purely on damage
          value = Math.trunc(move.damage) * 10;
        } else {
          // evaluate the move based on learning reinforcement
          value = ms.value + globalRandom.int(10);
          if (learningMoment(a) && ms.minHitDist !== -1) {
            if (ms.lastDist < ms.maxHitDist + 5 && ms.lastDist > ms.minHitDist + 5) {
              value += 2;
            } else if (ms.lastDist > ms.maxHitDist + 10) {
              value -= 3;
            }
          }

          // smart AI will slightly favor high damage moves
          if (smartUsually(a)) {
            value += Math.trunc(Math.trunc(move.damage) / 3);
          }

          value -= Math.trunc(ms.attempts / 2);
          value -= ms.consecutive * 2;
        }

        if (selectedMove === null) {
          selectedMove = move;
          topValue = value;
        } else if (value > topValue) {
          selectedMove = move;
          topValue = value;
        }
      }
    }
  }

  if (selectedMove) {
    decayConsecutive(a);
    setSelectedMove(ctrl, selectedMove);
    return true;
  }

  return false;
}

/** Assigns a move by move_id. */
function assignMoveById(ctrl: AiController, moveId: number): boolean {
  const [, h] = aiHar(ctrl);

  for (let i = 0; i < MAX_MOVES; i++) {
    const move = afGetMove(h.afData, i);
    if (move) {
      if (isValidMove(move, h, true)) {
        // move_id filter
        if (moveId !== move.id) {
          continue;
        }

        setSelectedMove(ctrl, move);
        return true;
      }
    }
  }

  return false;
}

/** Make AI attempt to block an attack. Returns whether the attack is being blocked. */
function aiBlockHar(ctrl: AiController, ev: CtrlEvent[]): number {
  const a = ctrl.data;
  const [o, h] = aiHar(ctrl);
  const oEnemy = enemyHarObj(ctrl, h);
  const hEnemy = harData(oEnemy);

  // XXX TODO get maximum move distance from the animation object
  if (Math.abs(oEnemy.posX - o.posX) < 100 && hEnemy.executingMove && smartUsually(a)) {
    if (harIsCrouching(hEnemy)) {
      a.curAct = downBack(o);
      ctrl.cmd(a.curAct, ev);
    } else {
      a.curAct = back(o);
      ctrl.cmd(a.curAct, ev);
    }
    return 1;
  }
  return 0;
}

/** Make AI attempt to block projectiles. Returns whether a projectile is being blocked. */
function aiBlockProjectile(ctrl: AiController, ev: CtrlEvent[]): number {
  const a = ctrl.data;
  const [o, h] = aiHar(ctrl);

  const rememberShooting = learningMoment(a) && a.shot >= MAX_TIMES_SHOT;

  for (const oPrj of a.activeProjectiles) {
    if (projectileGetOwner(oPrj) === h.playerId) {
      continue;
    }
    if (oPrj.curSpriteId >= 0 && (smartUsually(a) || rememberShooting)) {
      const curSprite = oPrj.curAnimation?.getSprite(oPrj.curSpriteId) ?? null;
      if (curSprite) {
        let posPrjX = oPrj.px() + curSprite.posX;
        const [sizePrjX] = oPrj.size();
        if (oPrj.direction === OBJECT_FACE_LEFT) {
          posPrjX = oPrj.px() + (curSprite.posX * -1 - sizePrjX);
        }
        if (Math.abs(posPrjX - o.posX) < 120) {
          a.curAct = downBack(o);
          ctrl.cmd(a.curAct, ev);
          return 1;
        }
      }
    }
  }

  return 0;
}

/** Process (type out) the current selected move. */
function processSelectedMove(ctrl: AiController, ev: CtrlEvent[]): void {
  const a = ctrl.data;
  const [o] = aiHar(ctrl);
  const move = a.selectedMove!;

  if (a.inputLagTimer > 0) {
    a.inputLagTimer--;
  } else {
    a.moveStrPos--;
    if (a.moveStrPos <= 0) {
      a.moveStrPos = 0;
    }
    a.inputLagTimer = a.inputLag;
  }

  ctrl.cmd(charToAct(a, move.moveString, o.direction), ev);

  if (a.moveStrPos === 0) {
    a.selectedMove = null;
  }
}

/** Handle the AI's movement. */
function handleMovement(ctrl: AiController, ev: CtrlEvent[]): void {
  const a = ctrl.data;
  const [o, h] = aiHar(ctrl);

  // default mid-action jump chance
  let jumpChance = 100;
  if (rollPref(a.pilot.prefJump)) {
    jumpChance -= 10;
  }
  if (diffScale(a)) {
    jumpChance -= 10;
  }

  // Change action after act_timer runs out
  if (a.actTimer <= 0 && (rollChance(BASE_ACT_CHANCE) || diffScale(a))) {
    const enemyRange = getEnemyRange(ctrl);

    let moveDir = MOVE_DIR_STILL;
    if (!h.isWallhugging && enemyRange === RANGE_CRAMPED) {
      // we are face-hugging already so no need to go forward
      moveDir = rollPref(a.pilot.prefBack) ? MOVE_DIR_BACK : MOVE_DIR_STILL;
    } else if (rollPref(a.pilot.prefFwd)) {
      // pilot prefers forward
      moveDir = MOVE_DIR_FWD;
    } else if (!h.isWallhugging && rollPref(a.pilot.prefBack)) {
      // pilot prefers backward
      moveDir = MOVE_DIR_BACK;
    } else if ((h.id === HarId.FLAIL || h.id === HarId.THORN || h.id === HarId.NOVA) && smartUsually(a)) {
      // brawlers are more likely to face-hug
      moveDir = MOVE_DIR_FWD;
    }

    switch (moveDir) {
      case MOVE_DIR_FWD:
        // walk forward
        a.curAct = forward(o);
        jumpChance = BASE_FWD_JUMP_CHANCE;
        if (diffScale(a)) {
          jumpChance -= 2;
        }
        break;
      case MOVE_DIR_BACK:
        // walk backward
        a.curAct = back(o);
        jumpChance = BASE_BACK_JUMP_CHANCE;
        if (diffScale(a)) {
          jumpChance -= 2;
        }
        break;
      case MOVE_DIR_STILL:
      default:
        if (smartUsually(a) || rollPref(a.pilot.attDef)) {
          // crouch and block
          a.curAct = downBack(o);
          jumpChance = 0;
        } else {
          // do nothing
          a.curAct = ACT_STOP;
          jumpChance = BASE_STILL_JUMP_CHANCE;
          if (diffScale(a)) {
            jumpChance -= 5;
          }
        }
        break;
    }

    resetActTimer(a);
    ctrl.cmd(a.curAct, ev);
  }

  // Jump once in a while if they like to jump
  if (jumpChance > 0 && rollChance(jumpChance) && rollPref(a.pilot.prefJump)) {
    if (smartUsually(a) && rollPref(a.pilot.attJump)) {
      // double jump
      ctrl.cmd(ACT_DOWN, ev);
    }
    if (o.velX < 0) {
      ctrl.cmd(ACT_UP | ACT_LEFT, ev);
    } else if (o.velX > 0) {
      ctrl.cmd(ACT_UP | ACT_RIGHT, ev);
    } else {
      ctrl.cmd(ACT_UP, ev);
    }
    // release the jump button
    ctrl.cmd(ACT_STOP, ev);
  }
}

/** Attempt to select a random attack. */
function attemptAttack(ctrl: AiController, highestDamage: boolean): boolean {
  const a = ctrl.data;
  const [, h] = aiHar(ctrl);

  const enemyRange = getEnemyRange(ctrl);
  const inAttemptRange = enemyRange <= RANGE_CLOSE || (enemyRange === RANGE_MID && dumbSometimes(a));

  let selectedMove: AfMove | null = null;
  let topValue = 0;

  // Attack
  for (let i = 0; i < MAX_MOVES; i++) {
    const move = afGetMove(h.afData, i);
    if (move) {
      const ms = a.moveStats[i];
      if (isValidMove(move, h, false)) {
        // smart AI will bail out unless close enough to hit
        if (!inAttemptRange && (move.category === CAT_BASIC || move.category === CAT_LOW ||
          move.category === CAT_MEDIUM || move.category === CAT_HIGH)) {
          continue;
        }

        let value: number;
        if (highestDamage) {
          // evaluate the move based purely on damage
          value = Math.trunc(move.damage) * 10;
        } else {
          // evaluate the move based on learning reinforcement
          value = ms.value + globalRandom.int(10);
          if (learningMoment(a) && ms.minHitDist !== -1) {
            if (ms.lastDist < ms.maxHitDist + 5 && ms.lastDist > ms.minHitDist + 5) {
              value += 2;
            } else if (ms.lastDist > ms.maxHitDist + 10) {
              value -= 3;
            }
          }

          // AI is less likely to use exact same move as last attack
          if (a.lastMoveId > 0 && a.lastMoveId === move.id) {
            value -= globalRandom.int(10);
          }

          // smart AI will slightly favor high damage moves
          if (smartUsually(a)) {
            value += Math.trunc(Math.trunc(move.damage) / 4);
          }

          // AI is less likely to use disliked moves
          if (dislikesMove(a, move)) {
            value -= globalRandom.int(10);
          }

          value -= Math.trunc(ms.attempts / 2);
          value -= ms.consecutive * 2;

          // sometimes skip move if it is too powerful for difficulty
          if (moveTooPowerful(a, move)) {
            continue;
          }
        }

        if (selectedMove === null) {
          selectedMove = move;
          topValue = value;
        } else if (value > topValue) {
          selectedMove = move;
          topValue = value;
        }
      }
    }
  }

  if (selectedMove) {
    decayConsecutive(a);
    setSelectedMove(ctrl, selectedMove);
    return true;
  }

  return false;
}

/**
 * Stops walking/crouching before a hard-coded special (`attempt_*_attack` prologue). Returns false when the HAR is in a
 * state where the special can't be entered.
 */
function prepareGroundSpecial(ctrl: AiController, h: Har, ev: CtrlEvent[]): boolean {
  switch (h.state) {
    case HarState.WALKTO:
    case HarState.WALKFROM:
    case HarState.CROUCHBLOCK:
    case HarState.CROUCHING:
      ctrl.cmd(ACT_STOP, ev);
      break;
    case HarState.STANDING:
      break;
    default:
      return false;
  }
  return true;
}

/** Attempt to initiate a charge attack using direct keyboard combinations. */
function attemptChargeAttack(ctrl: AiController, ev: CtrlEvent[]): boolean {
  const a = ctrl.data;
  const [o, h] = aiHar(ctrl);

  const enemyRange = getEnemyRange(ctrl);

  if (!prepareGroundSpecial(ctrl, h, ev)) {
    return false;
  }

  switch (h.id) {
    case HarId.JAGUAR: {
      if (enemyRange >= RANGE_MID && rollPref(a.pilot.apSpecial) && diffScale(a)) {
        // Shadow Leap : B,D,F+P
        chainControllerCmd(ctrl, [back(o), downBack(o)], ev);
      }
      // Jaguar Leap : D,F+P
      chainControllerCmd(ctrl, [ACT_DOWN, downForward(o), forward(o) | ACT_PUNCH], ev);
      break;
    }
    case HarId.SHADOW: {
      // Shadow Grab : D,D+P
      chainControllerCmd(ctrl, [ACT_DOWN, ACT_STOP, ACT_DOWN | ACT_PUNCH], ev);
      break;
    }
    case HarId.KATANA: {
      if (rollChance(2) && rollPref(a.pilot.apLow)) {
        // Trip-Slide attack : D+B+K
        chainControllerCmd(ctrl, [downBack(o) | ACT_KICK], ev);
      } else {
        if (enemyRange >= RANGE_MID && rollChance(2)) {
          // Foward Razor Spin : D,F+K
          chainControllerCmd(ctrl, [ACT_DOWN, downForward(o), forward(o) | ACT_KICK], ev);
        } else {
          // Rising Blade
          if (enemyRange >= RANGE_CLOSE && rollPref(a.pilot.apSpecial) && diffScale(a)) {
            // Triple Blade : B,D,F+P
            chainControllerCmd(ctrl, [back(o), downBack(o)], ev);
          }
          // Rising Blade : D,F+P
          chainControllerCmd(ctrl, [ACT_DOWN, downForward(o), forward(o) | ACT_PUNCH], ev);
        }
      }
      break;
    }
    case HarId.FLAIL: {
      if (enemyRange > RANGE_MID && rollPref(a.pilot.apSpecial) && diffScale(a)) {
        // Shadow Punch : D,B,B,P
        chainControllerCmd(ctrl, [ACT_DOWN, downBack(o), back(o), ACT_STOP, back(o) | ACT_PUNCH], ev);
      } else {
        // Charging Punch : B,B,P
        chainControllerCmd(ctrl, [back(o), ACT_STOP, back(o) | ACT_PUNCH], ev);
      }
      break;
    }
    case HarId.THORN: {
      // Spike-Charge : F,F+P
      chainControllerCmd(ctrl, [forward(o), ACT_STOP, forward(o) | ACT_PUNCH], ev);
      break;
    }
    case HarId.PYROS: {
      if (enemyRange > RANGE_MID && rollPref(a.pilot.apSpecial) && diffScale(a)) {
        // Shadow Thrust : F,F,F+P
        chainControllerCmd(ctrl, [forward(o), ACT_STOP], ev);
      }
      // Super Thrust : F,F+P
      chainControllerCmd(ctrl, [forward(o), ACT_STOP, forward(o) | ACT_PUNCH], ev);
      break;
    }
    case HarId.ELECTRA: {
      if (enemyRange >= RANGE_MID && rollPref(a.pilot.apSpecial) && diffScale(a)) {
        // Super R.T. : B,D,F,F+P
        chainControllerCmd(ctrl, [ACT_DOWN, downForward(o)], ev);
      }
      // Rolling Thunder : F,F+P
      chainControllerCmd(ctrl, [forward(o), ACT_STOP, forward(o) | ACT_PUNCH], ev);
      break;
    }
    case HarId.CHRONOS: {
      if (enemyRange >= RANGE_MID && rollPref(a.pilot.apSpecial) && diffScale(a)) {
        // Teleportation : D,P
        chainControllerCmd(ctrl, [ACT_DOWN, ACT_PUNCH], ev);
        // follow up with a close-range tactic
        chainConsiderTactics(ctrl, [TACTIC_GRAB, TACTIC_PUSH, TACTIC_SHOOT, TACTIC_SPAM, TACTIC_TRIP]);
      } else {
        // Trip-Slide attack : D,B+K
        chainControllerCmd(ctrl, [downBack(o) | ACT_KICK], ev);
      }
      break;
    }
    case HarId.SHREDDER: {
      if (enemyRange > RANGE_MID && rollPref(a.pilot.attJump) && diffScale(a)) {
        // Flip Kick : D,D+K
        chainControllerCmd(ctrl, [ACT_DOWN, ACT_STOP, ACT_DOWN | ACT_KICK], ev);
      } else {
        // Head-butt
        if (enemyRange >= RANGE_MID && rollPref(a.pilot.apSpecial) && diffScale(a)) {
          // Shadow Head-Butt : B,D,F+P
          chainControllerCmd(ctrl, [back(o), downBack(o)], ev);
        }
        // Head-Butt : D,F+P
        chainControllerCmd(ctrl, [ACT_DOWN, downForward(o), forward(o) | ACT_PUNCH], ev);
      }
      break;
    }
    case HarId.GARGOYLE: {
      if (enemyRange > RANGE_MID && rollPref(a.pilot.attJump) && diffScale(a)) {
        // Wing Charge : F,F,P
        chainControllerCmd(ctrl, [forward(o), ACT_STOP, forward(o), ACT_PUNCH], ev);
      } else {
        // Talon
        if (enemyRange >= RANGE_MID && rollPref(a.pilot.apSpecial) && diffScale(a)) {
          // Shadow Talon : B,D,F,P
          chainControllerCmd(ctrl, [back(o), downBack(o)], ev);
        }
        // Flying Talon : D,F,P
        chainControllerCmd(ctrl, [ACT_DOWN, downForward(o), forward(o), ACT_PUNCH], ev);
      }
      break;
    }
    case HarId.GLACIER: {
      // Glacial Ram : D,B+K
      chainControllerCmd(ctrl, [ACT_DOWN, downBack(o), back(o) | ACT_KICK], ev);
      break;
    }
    case HarId.TEMPEST: {
      // Cyclone Kick : D,F+K
      chainControllerCmd(ctrl, [ACT_DOWN, downForward(o), forward(o) | ACT_KICK], ev);
      break;
    }
    case HarId.HELIX: {
      // Drill Rush : D,F+P
      chainControllerCmd(ctrl, [ACT_DOWN, downForward(o), forward(o) | ACT_PUNCH], ev);
      break;
    }
    case HarId.SPECTRE: {
      if (enemyRange >= RANGE_MID && rollPref(a.pilot.apSpecial) && diffScale(a)) {
        // Phase Shift : D,B+K (behind the enemy), then a close-range tactic
        chainControllerCmd(ctrl, [ACT_DOWN, downBack(o), back(o) | ACT_KICK], ev);
        chainConsiderTactics(ctrl, [TACTIC_GRAB, TACTIC_PUSH, TACTIC_SPAM, TACTIC_TRIP]);
      } else {
        // Shadow Strike : D,F+K
        chainControllerCmd(ctrl, [ACT_DOWN, downForward(o), forward(o) | ACT_KICK], ev);
      }
      break;
    }
    default:
      return modTactic(ctrl, 'charge', ev);
  }

  return true;
}

/** Attempt to initiate a push attack using direct keyboard combinations. */
function attemptPushAttack(ctrl: AiController, ev: CtrlEvent[]): boolean {
  const a = ctrl.data;
  const [o, h] = aiHar(ctrl);

  const enemyRange = getEnemyRange(ctrl);

  if (!prepareGroundSpecial(ctrl, h, ev)) {
    return false;
  }

  switch (h.id) {
    case HarId.JAGUAR: {
      // High Kick : B+K
      chainControllerCmd(ctrl, [back(o) | ACT_KICK], ev);
      break;
    }
    case HarId.KATANA: {
      // Rising Blade
      if (enemyRange >= RANGE_CLOSE && rollPref(a.pilot.apSpecial) && diffScale(a)) {
        // Triple Blade : B,D,F+P
        chainControllerCmd(ctrl, [back(o), downBack(o)], ev);
      }
      // Rising Blade : D,F+P
      chainControllerCmd(ctrl, [ACT_DOWN, downForward(o), forward(o) | ACT_PUNCH], ev);
      break;
    }
    case HarId.FLAIL: {
      if (rollChance(3)) {
        // Slow Swing Chain : D,K
        chainControllerCmd(ctrl, [ACT_DOWN, ACT_KICK], ev);
      } else {
        // Swinging Chains : D,P
        chainControllerCmd(ctrl, [ACT_DOWN, ACT_PUNCH], ev);
      }
      break;
    }
    case HarId.THORN: {
      // Speed Kick
      if (enemyRange >= RANGE_CLOSE && rollPref(a.pilot.apSpecial) && diffScale(a)) {
        // Shadow Kick : B,D,F+K
        chainControllerCmd(ctrl, [back(o), downBack(o)], ev);
      }
      // Speed Kick : D,F+K
      chainControllerCmd(ctrl, [ACT_DOWN, downForward(o), forward(o) | ACT_KICK], ev);
      break;
    }
    case HarId.PYROS: {
      // Fire Spin : D,P
      chainControllerCmd(ctrl, [ACT_DOWN, ACT_PUNCH], ev);
      break;
    }
    case HarId.ELECTRA: {
      // Electric Shards : D,F+P
      chainControllerCmd(ctrl, [ACT_DOWN, downForward(o), forward(o) | ACT_PUNCH], ev);
      break;
    }
    case HarId.NOVA: {
      if (diffScale(a)) {
        // Earthquake Slam : D,D+P
        chainControllerCmd(ctrl, [ACT_DOWN, ACT_STOP, ACT_DOWN | ACT_PUNCH], ev);
      } else {
        // Heavy Kick : B+K
        chainControllerCmd(ctrl, [back(o) | ACT_KICK], ev);
      }
      break;
    }
    case HarId.GLACIER: {
      // Frost Spikes : D,F+K
      chainControllerCmd(ctrl, [ACT_DOWN, downForward(o), forward(o) | ACT_KICK], ev);
      break;
    }
    case HarId.TEMPEST: {
      // Cyclone Kick : D,F+K
      chainControllerCmd(ctrl, [ACT_DOWN, downForward(o), forward(o) | ACT_KICK], ev);
      break;
    }
    case HarId.HELIX: {
      // Corkscrew : F,D,F+P
      chainControllerCmd(ctrl, [forward(o), ACT_DOWN, downForward(o) | ACT_PUNCH], ev);
      break;
    }
    default:
      return modTactic(ctrl, 'push', ev);
  }

  return true;
}

/** Attempt to initiate a trip attack using direct keyboard combinations. */
function attemptTripAttack(ctrl: AiController, ev: CtrlEvent[]): boolean {
  const [o, h] = aiHar(ctrl);

  if (!prepareGroundSpecial(ctrl, h, ev)) {
    return false;
  }

  // Standard Trip : D+B+K
  chainControllerCmd(ctrl, [downBack(o) | ACT_KICK], ev);

  return true;
}

/** Attempt to initiate a projectile attack using direct keyboard combinations. */
function attemptProjectileAttack(ctrl: AiController, ev: CtrlEvent[]): boolean {
  const [o, h] = aiHar(ctrl);
  const enemyRange = getEnemyRange(ctrl);

  if (h.state === HarState.WALKTO || h.state === HarState.WALKFROM || h.state === HarState.CROUCHBLOCK) {
    ctrl.cmd(ACT_STOP, ev);
  }

  switch (h.id) {
    case HarId.JAGUAR: // Concussion Cannon : D, B+P
    case HarId.ELECTRA: // Ball Lightning : D, B+P
    case HarId.SHREDDER: { // Flying Hands : D, B+P
      if (h.id === HarId.SHREDDER && enemyRange > RANGE_MID) {
        return false;
      }
      chainControllerCmd(ctrl, [ACT_DOWN, downBack(o), back(o) | ACT_PUNCH], ev);
      return true;
    }
    case HarId.SHADOW: {
      chainControllerCmd(ctrl, [ACT_DOWN, downBack(o), back(o)], ev);
      if (rollChance(2)) {
        // Shadow Punch : D,B+P
        chainControllerCmd(ctrl, [ACT_PUNCH], ev);
      } else {
        // Shadow Kick : D,B+K
        chainControllerCmd(ctrl, [ACT_KICK], ev);
      }
      return true;
    }
    case HarId.CHRONOS: {
      if (enemyRange < RANGE_MID || enemyIsStunnedOrStasis(ctrl)) {
        // stasis does no damage, so don't use it on a stunned or already frozen enemy
        return false;
      }
      // Stasis : D, B, P
      chainControllerCmd(ctrl, [ACT_DOWN, downBack(o), back(o) | ACT_PUNCH], ev);
      return true;
    }
    case HarId.GLACIER: // Ice Lance : D,F+P
    case HarId.SPECTRE: { // Photon Beam : D,F+P
      chainControllerCmd(ctrl, [ACT_DOWN, downForward(o), forward(o) | ACT_PUNCH], ev);
      return true;
    }
    case HarId.TEMPEST: // Gale Blast : D,B+P
    case HarId.HELIX: { // Drill Bit : D,B+P
      chainControllerCmd(ctrl, [ACT_DOWN, downBack(o), back(o) | ACT_PUNCH], ev);
      return true;
    }
    case HarId.NOVA: {
      ctrl.cmd(ACT_DOWN, ev);
      if (rollChance(3) && enemyRange >= RANGE_MID) {
        // Mini-Grenade : D, B, P
        chainControllerCmd(ctrl, [ACT_DOWN, downBack(o), back(o) | ACT_PUNCH], ev);
      } else {
        // Missile : D, F, P
        chainControllerCmd(ctrl, [ACT_DOWN, downForward(o), forward(o) | ACT_PUNCH], ev);
      }
      return true;
    }
  }

  return modTactic(ctrl, 'projectile', ev);
}

/** Handle the next phase of the currently queued tactic. Returns whether the AI moved or attacked. */
function handleQueuedTactic(ctrl: AiController, ev: CtrlEvent[]): boolean {
  const a = ctrl.data;
  const [o, h] = aiHar(ctrl);
  const tactic = a.tactic;
  const enemyClose = !!h.close;
  const enemyRange = getEnemyRange(ctrl);
  const wallClose = !!h.isWallhugging;

  let acted = false;
  if (tactic.moveType > 0 && tactic.moveTimer > 0) {
    acted = true;
    // handle movement phase of tactic
    switch (tactic.moveType) {
      case MOVE_CLOSE:
        if (!enemyClose) {
          // take a step closer
          a.curAct = forward(o);
          ctrl.cmd(a.curAct, ev);
          tactic.moveTimer--;
        } else {
          tactic.moveTimer = 0;
          // movement close success
          if (tactic.attackType === 0 && smartUsually(a)) {
            queueTactic(ctrl, TACTIC_GRAB);
          }
        }
        break;
      case MOVE_AVOID:
        if (enemyRange === RANGE_FAR) {
          tactic.moveTimer = 0;
          acted = false;
        } else {
          if (enemyRange === RANGE_CRAMPED || !rollPref(a.pilot.prefJump)) {
            // take a step away
            a.curAct = back(o);
          } else {
            if (smartUsually(a)) {
              // do super jump
              ctrl.cmd(ACT_DOWN, ev);
            }
            // jump away
            a.curAct = upBack(o);
          }

          ctrl.cmd(a.curAct, ev);
          ctrl.cmd(ACT_STOP, ev);
          tactic.moveTimer--;
        }
        break;
      case MOVE_JUMP:
      case MOVE_HIGH_JUMP:
        if (enemyRange > RANGE_CRAMPED) {
          if ((enemyRange === RANGE_FAR && smartUsually(a)) || tactic.moveType === MOVE_HIGH_JUMP) {
            // do high jump
            ctrl.cmd(ACT_DOWN, ev);
          }
          // jump closer
          a.curAct = upForward(o);
          ctrl.cmd(a.curAct, ev);
          ctrl.cmd(ACT_STOP, ev);
          if (rollPref(a.pilot.prefJump)) {
            tactic.moveTimer--;
          } else {
            tactic.moveTimer = 0;
          }
        } else if (tactic.tacticType === TACTIC_FLY) {
          if (rollPref(a.pilot.attJump) && smartSometimes(a)) {
            // do high jump
            ctrl.cmd(ACT_DOWN, ev);
          }
          // jump over enemy
          a.curAct = upForward(o);
          ctrl.cmd(a.curAct, ev);
          ctrl.cmd(ACT_STOP, ev);
          tactic.moveTimer = 0;
        } else {
          tactic.moveTimer = 0;
        }
        break;
      case MOVE_BLOCK:
        if (wallClose || harIsCrouching(h)) {
          // crouch & block
          a.curAct = downBack(o);
        } else {
          // retreat & block
          a.curAct = back(o);
        }

        ctrl.cmd(a.curAct, ev);
        tactic.moveTimer--;
        break;
      default:
        // Flushing invalid move type
        tactic.moveType = 0;
        tactic.moveTimer = 0;
        acted = false;
    }
  } else if (tactic.attackType > 0 && tactic.attackTimer > 0) {
    // handle attack phase of tactic
    const inAttemptRange = enemyRange <= RANGE_CLOSE || (enemyRange <= RANGE_MID && dumbSometimes(a));
    acted = true;
    tactic.attackTimer--;
    if (tactic.attackOn === 0) {
      let attackCat = 0;
      switch (tactic.attackType) {
        case ATTACK_ID: {
          if (!inAttemptRange) {
            break;
          }

          if (assignMoveById(ctrl, tactic.attackId)) {
            resetTacticState(a);
          }
          break;
        }
        case ATTACK_TRIP: {
          if (attemptTripAttack(ctrl, ev)) {
            resetTacticState(a);

            // chain another tactic
            chainConsiderTactics(ctrl, [TACTIC_QUICK, TACTIC_GRAB, TACTIC_ESCAPE, TACTIC_SHOOT]);
            if (a.tactic.tacticType > 0) {
              a.tactic.chainHitOn = CAT_LOW;
            }
          }
          break;
        }
        case ATTACK_GRAB: {
          if (!enemyClose) {
            break;
          }

          if (assignMoveByCat(ctrl, CAT_CLOSE, true)) {
            attackCat = CAT_CLOSE;
          }

          if (attackCat > 0) {
            resetTacticState(a);

            // chain another tactic
            if (smartSometimes(a)) {
              if (likesTactic(ctrl, TACTIC_PUSH)) {
                // set chain tactic to push if attack hits
                a.tactic.chainHitOn = attackCat;
                a.tactic.chainHitTactic = TACTIC_PUSH;
              } else if (likesTactic(ctrl, TACTIC_FLY)) {
                // set chain tactic to fly if attack hits
                a.tactic.chainHitOn = attackCat;
                a.tactic.chainHitTactic = TACTIC_FLY;
              } else if (likesTactic(ctrl, TACTIC_COUNTER)) {
                // set chain tactic to counter if attack hits
                a.tactic.chainHitOn = attackCat;
                a.tactic.chainHitTactic = TACTIC_COUNTER;
              } else if (likesTactic(ctrl, TACTIC_SHOOT)) {
                // set chain tactic to shoot if attack hits
                a.tactic.chainHitOn = attackCat;
                a.tactic.chainHitTactic = TACTIC_SHOOT;
              }
            }
          }
          break;
        }
        case ATTACK_LIGHT: {
          if (!inAttemptRange) {
            break;
          }

          const lightCat = rollChance(2) ? CAT_BASIC : CAT_MEDIUM;
          if (assignMoveByCat(ctrl, lightCat, false)) {
            resetTacticState(a);

            // chain another tactic
            if (smartSometimes(a)) {
              if (likesTactic(ctrl, TACTIC_PUSH)) {
                // set chain tactic to push if attack hits
                a.tactic.chainHitOn = lightCat;
                a.tactic.chainHitTactic = TACTIC_PUSH;
              } else if (likesTactic(ctrl, TACTIC_TRIP)) {
                // set chain tactic to trip if attack hits
                a.tactic.chainHitOn = lightCat;
                a.tactic.chainHitTactic = TACTIC_TRIP;
              } else if (likesTactic(ctrl, TACTIC_FLY)) {
                // set chain tactic to fly if attack hits
                a.tactic.chainHitOn = lightCat;
                a.tactic.chainHitTactic = TACTIC_FLY;
              }
            }
          }
          break;
        }
        case ATTACK_HEAVY: {
          if (!inAttemptRange) {
            break;
          }

          const heavyCat = rollChance(2) ? CAT_MEDIUM : CAT_HIGH;
          if (assignMoveByCat(ctrl, heavyCat, true)) {
            resetTacticState(a);

            // chain another tactic
            if (smartSometimes(a)) {
              if (likesTactic(ctrl, TACTIC_TRIP)) {
                // set chain tactic to trip if attack hits
                a.tactic.chainHitOn = heavyCat;
                a.tactic.chainHitTactic = TACTIC_TRIP;
              } else if (likesTactic(ctrl, TACTIC_COUNTER)) {
                // set chain tactic to counter if attack hits
                a.tactic.chainHitOn = heavyCat;
                a.tactic.chainHitTactic = TACTIC_COUNTER;
              } else if (likesTactic(ctrl, TACTIC_QUICK)) {
                // set chain tactic to quick if attack hits
                a.tactic.chainHitOn = heavyCat;
                a.tactic.chainHitTactic = TACTIC_QUICK;
              }
            }
          }
          break;
        }
        case ATTACK_JUMP: {
          if (!inAttemptRange && a.tactic.attackTimer > 0) {
            // Waiting for jump attack range:
            // when not in range we wait until last tick of attack timer
            // that way the attack won't fizzle out before we reach them
            return acted;
          }

          if (attemptAttack(ctrl, false)) {
            resetTacticState(a);

            // chain another tactic
            if (smartUsually(a)) {
              if (likesTactic(ctrl, TACTIC_TRIP)) {
                // set chain tactic to trip if jumping attack hits
                a.tactic.chainHitOn = a.selectedMove!.category;
                a.tactic.chainHitTactic = TACTIC_TRIP;
              } else if (likesTactic(ctrl, TACTIC_GRAB)) {
                // set chain tactic to grab if jumping attack hits
                a.tactic.chainHitOn = a.selectedMove!.category;
                a.tactic.chainHitTactic = TACTIC_GRAB;
              } else if (likesTactic(ctrl, TACTIC_PUSH)) {
                // set chain tactic to push if jumping attack hits
                a.tactic.chainHitOn = a.selectedMove!.category;
                a.tactic.chainHitTactic = TACTIC_PUSH;
              }
            }
          }
          break;
        }
        case ATTACK_RANGED: {
          if (attemptProjectileAttack(ctrl, ev)) {
            resetTacticState(a);

            // chain another tactic
            if (smartSometimes(a)) {
              if (a.pilot.attSniper && likesTactic(ctrl, TACTIC_SHOOT)) {
                // set chain tactic to shoot if projectile hits
                a.tactic.chainHitOn = CAT_PROJECTILE;
                a.tactic.chainHitTactic = TACTIC_SHOOT;
              } else if (likesTactic(ctrl, TACTIC_FLY)) {
                // set chain tactic to fly if projectile hits
                a.tactic.chainHitOn = CAT_PROJECTILE;
                a.tactic.chainHitTactic = TACTIC_FLY;
              } else if (likesTactic(ctrl, TACTIC_COUNTER)) {
                // set chain tactic to counter if projectile hits
                a.tactic.chainHitOn = CAT_PROJECTILE;
                a.tactic.chainHitTactic = TACTIC_COUNTER;
              }
            }
          }
          break;
        }
        case ATTACK_CHARGE: {
          if (attemptChargeAttack(ctrl, ev)) {
            resetTacticState(a);

            if (h.id === HarId.SHADOW) {
              // shadow charge is long range
              // use this free time to consider a new tactic
              chainConsiderTactics(ctrl, [TACTIC_SHOOT, TACTIC_GRAB, TACTIC_FLY]);
            }
          }
          break;
        }
        case ATTACK_PUSH: {
          if (attemptPushAttack(ctrl, ev)) {
            resetTacticState(a);
          }
          break;
        }
        case ATTACK_RANDOM: {
          if (attemptAttack(ctrl, false)) {
            resetTacticState(a);

            // chain another tactic
            if (smartUsually(a)) {
              if (likesTactic(ctrl, TACTIC_TRIP)) {
                a.tactic.chainHitOn = a.selectedMove!.category;
                a.tactic.chainHitTactic = TACTIC_TRIP;
              } else if (likesTactic(ctrl, TACTIC_GRAB)) {
                a.tactic.chainHitOn = a.selectedMove!.category;
                a.tactic.chainHitTactic = TACTIC_GRAB;
              } else if (likesTactic(ctrl, TACTIC_PUSH)) {
                a.tactic.chainHitOn = a.selectedMove!.category;
                a.tactic.chainHitTactic = TACTIC_PUSH;
              }
            }
          }
          break;
        }
        default:
          // Flushing invalid attack type
          tactic.attackType = 0;
          tactic.attackTimer = 0;
      }
    }
  } else {
    // reset queued tactic (flushing failed tactic queue)
    resetTacticState(a);
  }

  return acted;
}

/** Duck-typed access to the arena scene (avoids importing the scene module). */
function arenaOf(gs: GameState): ArenaLike | null {
  const sc = gs.sc as unknown as Partial<ArenaLike>;
  return typeof sc.arenaGetState === 'function' && typeof sc.arenaIsOver === 'function' ? (sc as ArenaLike) : null;
}

/**
 * Finisher extension (not in the reference, see `AiController.finishers`): decides whether the AI keeps running after
 * the arena left the FIGHTING state. That is only the case when the match is over, this AI's HAR won it and it is in
 * the scrap (VICTORY) or destruction (SCRAP) window. Whether the AI goes for it is rolled once per window with the
 * reference's difficulty-scaled `diff_scale` roll (PUNCHING BAG 2/36 .. DEADLY/ULTIMATE always).
 */
function finisherAttempt(a: Ai, arena: ArenaLike, h: Har): boolean {
  const inWindow = arena.arenaGetState() === ARENA_STATE_ENDING && arena.arenaIsOver() === h.playerId &&
    (h.state === HarState.VICTORY || h.state === HarState.SCRAP);
  if (!inWindow) {
    a.finisherState = 0;
    return false;
  }
  if (a.finisherState !== h.state) {
    a.finisherState = h.state;
    a.finisherGo = diffScale(a);
  }
  return a.finisherGo;
}

/**
 * Finisher extension: types the HAR's scrap move (in VICTORY) or destruction move (in SCRAP), chosen with the
 * reference's `assign_move_by_cat` and entered with `process_selected_move` like any other move string. It keeps
 * retyping until the move connects (the HAR only accepts it inside the animation's JF/JF2 window). Only these move
 * categories are typed, so the AI can't accidentally re-trigger a scrap while one is running.
 */
function finisherPoll(ctrl: AiController, o: GameObject, h: Har, ev: CtrlEvent[]): void {
  const a = ctrl.data;
  if (!a.selectedMove && finisherReachable(ctrl, o, h)) {
    assignMoveByCat(ctrl, h.state === HarState.VICTORY ? CAT_SCRAP : CAT_DESTRUCTION, false);
  }
  if (a.selectedMove) {
    processSelectedMove(ctrl, ev);
  }
}

/**
 * Engine workaround for the finisher extension: Shadow's scrap walks to the corner the defeated enemy faces (`CF`
 * walk-to tag: destination = wall + x offset, which unlike the `AM`+`E` walk-to is not clamped to the arena). When
 * both HARs face right (e.g. the enemy was wall-slammed on the right wall and faces it) the destination lies beyond
 * ARENA_RIGHT_WALL, the walk can never finish and the arena waits forever (the reference engine has the same code).
 * The AI doesn't start the scrap in that geometry.
 */
function finisherReachable(ctrl: AiController, o: GameObject, h: Har): boolean {
  if (h.id !== HarId.SHADOW || h.state !== HarState.VICTORY) {
    return true;
  }
  const oEnemy = enemyHarObj(ctrl, h);
  return !(oEnemy.direction === OBJECT_FACE_RIGHT && o.direction === OBJECT_FACE_RIGHT);
}

/** Input poll (reference `ai_controller_poll`). */
function aiControllerPoll(ctrl: AiController, ev: CtrlEvent[]): number {
  const a = ctrl.data;
  const gs = ctrl.gs;
  const o = gs.findObject(ctrl.harObjId);
  const scene = gs.sc;
  if (scene.id === SceneId.VS || scene.id === SceneId.NEWSROOM) {
    if (gs.warpSpeed || (scene.staticTicksSinceStart + 1) % 256 === 0) {
      ctrl.cmd(ACT_PUNCH, ev);
    }
  }
  if (!o) {
    return 1;
  }

  const h = harData(o);

  // Do not run AI while the game is paused
  if (gs.paused) {
    return 0;
  }

  // Do not run AI while match is starting or ending
  // XXX (reference) this prevents the AI from doing scrap/destruction moves
  // XXX (reference) this could be fixed by providing a "scene changed" event
  const arena = arenaOf(gs);
  if (scene.isArena() && arena && arena.arenaGetState() !== ARENA_STATE_FIGHTING) {
    if (AiController.finishers && finisherAttempt(a, arena, h)) {
      // extension: scrap/destruction attempt after winning the match
      finisherPoll(ctrl, o, h, ev);
      return 0;
    }
    // null out selected move to fix the "AI not moving problem"
    a.selectedMove = null;
    return 0;
  }
  a.finisherState = 0;

  // decrement act_timer
  a.actTimer--;

  // Grab all projectiles on screen
  a.activeProjectiles = gs.getProjectiles();

  // Try to block har
  if (aiBlockHar(ctrl, ev)) {
    return 0;
  }

  // Try to block projectiles
  if (aiBlockProjectile(ctrl, ev)) {
    return 0;
  }

  // handle selected move
  if (a.selectedMove) {
    // finish doing the selected move first
    processSelectedMove(ctrl, ev);
    return 0;
  }

  const canMove = h.state === HarState.STANDING || h.state === HarState.WALKTO || h.state === HarState.WALKFROM ||
    h.state === HarState.CROUCHING || h.state === HarState.CROUCHBLOCK;

  const canInteruptTactic = a.tactic.tacticType === 0 ||
    !(a.tactic.attackType === ATTACK_CHARGE || a.tactic.attackType === ATTACK_PUSH ||
      a.tactic.attackType === ATTACK_TRIP);

  const enemy = gs.findObject(o.animationState.enemyObjId);
  // UJ tag signals to the AI it should probably jump
  if (canMove && canInteruptTactic && enemy !== null && enemy.frameIsSet(Tag.UJ) && smartSometimes(a)) {
    resetTacticState(a);
    ctrl.cmd(ACT_UP, ev);
    ctrl.cmd(ACT_STOP, ev);
    return 0;
  }

  // be wary of repeated throws while attempting to complete a tactic
  if (canMove && canInteruptTactic && a.thrown > 1 && a.difficulty > 2) {
    // attempt a quick attack to disrupt their grab/throw
    const enemyRange = getEnemyRange(ctrl);
    if ((enemyRange === RANGE_CRAMPED || (enemyRange === RANGE_CLOSE && a.thrown >= 2)) &&
      (assignMoveByCat(ctrl, CAT_LOW, false) || attemptAttack(ctrl, false))) {
      // Spamming random attacks to avoid being thrown
      resetTacticState(a);
      return 0;
    }
  }

  // attempt queued tactic
  if (a.tactic.tacticType > 0 &&
    (canMove || (a.tactic.attackType === ATTACK_JUMP && h.state === HarState.JUMPING))) {
    const acted = handleQueuedTactic(ctrl, ev);
    // check if tactic is complete
    if (a.tactic.tacticType === 0) {
      // reset movement act timer
      // set higher than zero to avoid glitching when bailing on tactics
      a.actTimer = 3;
    }

    if (acted) {
      return 0; // wait for next poll
    }
  }

  const enemyRange = getEnemyRange(ctrl);

  // attempt a random attack
  if ((rollChance(RANDOM_ATTACK_CHANCE) || diffScale(a)) && (enemyRange <= RANGE_CLOSE || dumbSometimes(a)) &&
    attemptAttack(ctrl, false)) {
    // reset movement act timer
    resetActTimer(a);
    return 0;
  }

  // handle movement
  if (canMove) {
    handleMovement(ctrl, ev);
  }

  // queue a random tactic for next poll
  if ((a.lastMoveId === 0 || a.tactic.tacticType === 0 || (rollChance(RANDOM_ATTACK_CHANCE) && diffScale(a))) &&
    canMove) {
    chainConsiderTactics(ctrl, [TACTIC_SHOOT, TACTIC_CLOSE, TACTIC_FLY, TACTIC_PUSH, TACTIC_TRIP, TACTIC_GRAB, TACTIC_QUICK]);
  }

  return 0;
}

const TACTIC_NAMES = ['?', 'escape', 'turtle', 'grab', 'spam', 'shoot', 'trip', 'quick', 'close', 'fly', 'push', 'counter'];
const MOVE_NAMES = ['?', 'close', 'avoid', 'jump', 'high_jump', 'block'];
const ATTACK_NAMES = ['?', 'id', 'trip', 'grab', 'light', 'heavy', 'jump', 'ranged', 'charge', 'push', 'random'];

export class AiController extends Controller {
  /**
   * Deviation from the reference (enabled by default): after winning the match the AI may attempt its scrap and then
   * its destruction move (difficulty-scaled, see `finisherAttempt`/`finisherPoll`; the move is picked with the
   * reference's `assign_move_by_cat` and typed like any other move string). The reference blocks the AI in every
   * non-FIGHTING arena state and notes that this "prevents the AI from doing scrap/destruction moves".
   * Set to false for strict reference behavior.
   */
  static finishers = true;

  /**
   * Deviation from the reference (enabled by default): in tournament play (`gs.isTournament()`) the opponent keeps
   * the AI preferences of its own TRN/CHR pilot record, and "forgetting" restores those. The reference applies its
   * hard-coded story personalities by pilot id ("until we start reading them from binary"); since every TRN pilot has
   * pilot id 0, all tournament opponents would otherwise get Crystal's personality written over their own.
   * Set to false for strict reference behavior.
   */
  static tournamentPersonalities = true;

  /** Reference `ai` private data. */
  data: Ai;

  /**
   * @param difficulty AI_DIFFICULTY_* (0 PUNCHING BAG .. 6 ULTIMATE).
   * @param pilot The player's pilot record; the AI keeps a reference to it and (like the reference) overwrites its
   *   personality fields for story-mode pilot ids and adjusts them while learning.
   */
  constructor(gs: GameState, public difficulty: number, public pilot: Pilot, public pilotId: number) {
    super(gs);
    // ai_controller_create
    const moveStats: MoveStat[] = [];
    for (let i = 0; i < MAX_MOVES; i++) {
      moveStats.push({ maxHitDist: -1, minHitDist: -1, value: 0, attempts: 0, consecutive: 0, lastDist: -1 });
    }
    pilot.pilotId = pilotId & 0xff; // uint8_t pilot_id
    this.data = {
      difficulty: difficulty + 1,
      actTimer: 0,
      curAct: 0,
      inputLag: 3,
      inputLagTimer: 3,
      selectedMove: null,
      lastMoveId: 0,
      moveStrPos: 0,
      moveStats,
      blocked: 0,
      thrown: 0,
      shot: 0,
      tactic: {
        tacticType: 0, lastTactic: 0, moveType: 0, moveTimer: 0, attackType: 0, attackId: 0, attackTimer: 0, attackOn: 0,
        chainHitOn: 0, chainHitTactic: 0,
      },
      pilot,
      activeProjectiles: [],
      finisherState: 0,
      finisherGo: false,
      basePersonality: null,
    };

    if (AiController.tournamentPersonalities && typeof gs.isTournament === 'function' && gs.isTournament()) {
      // extension: tournament opponents use the preferences from their own pilot record
      this.data.basePersonality = capturePersonality(pilot);
    } else {
      // set pilot personality manually until we start reading them from binary
      resetPilotPersonality(pilot);
    }

    // set initial tactical state
    resetTacticState(this.data);

    this.type = CtrlType.AI;
  }

  override poll(ev: CtrlEvent[]): number {
    return aiControllerPoll(this, ev);
  }

  override harHook(event: HarEvent): number {
    return aiHarEvent(this, event);
  }

  override free(): void {
    this.data.activeProjectiles = [];
    super.free();
  }

  /** Debug summary: "<tactic> <move> <attack> <last move id>" (reference `ai_controller_print_state`). */
  printState(): string {
    const t = this.data.tactic;
    return `${TACTIC_NAMES[t.tacticType] ?? '?'} ${MOVE_NAMES[t.moveType] ?? '?'} ${ATTACK_NAMES[t.attackType] ?? '?'} ${this.data.lastMoveId}`;
  }
}

export function createAiController(gs: GameState, difficulty: number, pilot: Pilot, pilotId: number): Controller {
  return new AiController(gs, difficulty, pilot, pilotId);
}
