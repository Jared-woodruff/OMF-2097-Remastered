// The pose library shared by the generated robots: every pose is built from a robot's measurements and fighting
// style (fighter/body.ts), so one set of poses fits all of them. Screen coordinates: x forward from the object's
// position (the robot faces +x, toward its enemy), y above the floor; angles in degrees. As on the original robots,
// the viewer sees the robot's right side: the near limbs (F) are the rear ones, the far limbs (B) lead.
import type { Vec3 } from '../geometry';
import { stance, type Target } from '../pose';
import { jointTransforms, type Pose } from '../robot';
import type { Body } from './body';

export interface PoseOpts {
  /** Pelvis offset from its rest position (x forward, y up). */
  root?: [number, number];
  /** Extra pelvis drop (fraction of the leg length; fight() only). */
  drop?: number;
  /** Whole-body tilt around the pelvis (forward positive). */
  tilt?: number;
  /** Upper body: lean (forward positive), twist (rear shoulder forward positive), head nod (down positive). */
  lean?: number;
  twist?: number;
  nod?: number;
  /** Ankle / wrist targets; null = leave the limb to the joint angles. */
  footF?: Target | null;
  footB?: Target | null;
  footAngleF?: number;
  footAngleB?: number;
  handF?: Target | null;
  handB?: Target | null;
  joints?: Record<string, Vec3>;
  show?: string[];
  hide?: string[];
  attach?: Pose['attach'];
}

export const mixT = (a: Target, b: Target, t: number): Target => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Fighting-stance defaults for a body. */
export function guard(b: Body): { footF: Target; footB: Target; handF: Target; handB: Target; drop: number } {
  const s = b.style;
  return {
    footF: [-b.L * s.stance, b.ankle],
    footB: [b.L * s.stance, b.ankle],
    handF: [b.A * s.rearX, b.S - b.L * s.drop + b.A * s.rearY],
    handB: [b.A * s.guardX, b.S - b.L * s.drop + b.A * s.guardY],
    drop: s.drop,
  };
}

function upper(o: PoseOpts): Record<string, Vec3> {
  const lean = o.lean ?? 0, twist = o.twist ?? 0, nod = o.nod ?? 0;
  return {
    spine: [0, twist * 0.45, -lean * 0.4],
    chest: [0, twist * 0.55, -lean * 0.6],
    head: [0, -twist * 0.4, lean * 0.7 - nod],
    ...(o.joints ?? {}),
  };
}

/** A pose from explicit parts: IK only for the limbs given targets. */
export function free(b: Body, o: PoseOpts): Pose {
  return stance(b.model, {
    root: o.root ?? [0, 0],
    tilt: o.tilt ?? 0,
    footF: o.footF ?? undefined,
    footB: o.footB ?? undefined,
    footAngleF: o.footAngleF,
    footAngleB: o.footAngleB,
    handF: o.handF ?? undefined,
    handB: o.handB ?? undefined,
    joints: upper(o),
    show: o.show,
    hide: o.hide,
    attach: o.attach,
  });
}

/** A pose in the fighting stance, with overrides. */
export function fight(b: Body, o: PoseOpts = {}): Pose {
  const g = guard(b);
  const drop = g.drop + (o.drop ?? 0);
  const root = o.root ?? [0, 0];
  const pick = (v: Target | null | undefined, d: Target) => (v === null ? null : (v ?? d));
  return free(b, {
    ...o,
    root: [root[0], root[1] - drop * b.L],
    lean: b.style.lean + (o.lean ?? 0),
    footF: pick(o.footF, g.footF),
    footB: pick(o.footB, g.footB),
    handF: pick(o.handF, g.handF),
    handB: pick(o.handB, g.handB),
  });
}

/** Point relative to the guard's lead (far) fist. */
export function fromLead(b: Body, dx: number, dy: number): Target {
  const g = guard(b);
  return [g.handB[0] + dx, g.handB[1] + dy];
}

/** Point relative to the guard's rear (near) fist. */
export function fromRear(b: Body, dx: number, dy: number): Target {
  const g = guard(b);
  return [g.handF[0] + dx, g.handF[1] + dy];
}

/** Center of the robot's body (average of the main joints) on the screen. */
export function bodyCenter(b: Body, pose: Pose): Target {
  const xf = jointTransforms(b.model, pose);
  const names = ['pelvis', 'spine', 'chest', 'head', 'kneeF', 'kneeB', 'elbowF', 'elbowB'];
  let x = 0, y = 0;
  for (const n of names) {
    const p = xf.get(n)!.pos;
    x += p[0];
    y += p[1];
  }
  return [x / names.length, y / names.length];
}

/** Moves a pose so its body center lands on a screen point. */
export function centerAt(b: Body, pose: Pose, at: Target): Pose {
  const c = bodyCenter(b, pose);
  const r = pose.root ?? [0, 0, 0];
  return { ...pose, root: [r[0] + at[0] - c[0], r[1] + at[1] - c[1], r[2]] };
}

/** Lowest point of the robot's feet and main joints (for poses resting on the floor). */
export function lowestJoint(b: Body, pose: Pose): number {
  const xf = jointTransforms(b.model, pose);
  let y = Infinity;
  for (const n of ['footF', 'footB']) y = Math.min(y, xf.get(n)!.pos[1] - b.ankle);
  for (const n of ['pelvis', 'spine', 'chest', 'head', 'kneeF', 'kneeB', 'handF', 'handB', 'elbowF', 'elbowB']) {
    y = Math.min(y, xf.get(n)!.pos[1] - 4);
  }
  return y;
}

/** Moves a pose up or down so its lowest part touches the floor. */
export function onFloor(b: Body, pose: Pose, lift = 0): Pose {
  const y = lowestJoint(b, pose);
  const r = pose.root ?? [0, 0, 0];
  return { ...pose, root: [r[0], r[1] - y + lift, r[2]] };
}

// ---- stance, movement ----------------------------------------------------------------------------------------------

/** Idle breathing: t 0 (breath out, lowest) .. 1 (in). */
export function idle(b: Body, t: number): Pose {
  const k = t * 2 - 1;
  const bob = b.style.bob;
  return fight(b, {
    drop: (bob / b.L) * (1 - t),
    handB: fromLead(b, 1.2 * k, -bob * (1 - t) * 0.8),
    handF: fromRear(b, -0.8 * k, -bob * (1 - t)),
    nod: -1.5 * k,
  });
}

/** Walking shuffle (played forward and back): t 0 (stance) .. 1 (rear foot brought forward). */
export function walk(b: Body, t: number): Pose {
  const g = guard(b);
  const lift = Math.sin(t * Math.PI) * b.L * 0.12;
  return fight(b, {
    root: [b.L * 0.08 * t, lift * 0.25],
    drop: 0.03 * Math.sin(t * Math.PI),
    footF: [lerp(g.footF[0], g.footF[0] + b.L * 0.3, t), b.ankle + lift],
    footB: [lerp(g.footB[0], g.footB[0] + b.L * 0.1, t), b.ankle],
    footAngleF: 12 * Math.sin(t * Math.PI),
    handB: fromLead(b, 2 * t, -1),
    handF: fromRear(b, -2 * t, 0),
  });
}

export function crouch(b: Body, extra: PoseOpts = {}): Pose {
  const g = guard(b);
  return fight(b, {
    drop: 0.34,
    tilt: 8,
    lean: 4,
    footF: [g.footF[0] - 3, b.ankle],
    footB: [g.footB[0] + 3, b.ankle],
    handF: [g.handF[0] + 2, g.handF[1] - b.L * 0.34],
    handB: [g.handB[0], g.handB[1] - b.L * 0.34],
    ...extra,
  });
}

export function block(b: Body): Pose {
  const g = guard(b);
  return fight(b, {
    lean: -4,
    root: [-2, 0],
    nod: 6,
    handB: [g.handB[0] - 2, b.S - b.L * b.style.drop + b.A * 0.28],
    handF: [g.handF[0] + 4, b.S - b.L * b.style.drop + b.A * 0.22],
  });
}

export function crouchBlock(b: Body): Pose {
  const g = guard(b);
  const low = b.L * 0.34;
  return crouch(b, {
    nod: 8,
    handB: [g.handB[0] - 2, b.S - b.L * b.style.drop - low + b.A * 0.3],
    handF: [g.handF[0] + 4, b.S - b.L * b.style.drop - low + b.A * 0.24],
  });
}

/** Dazed wobble: t -1 .. 1. */
export function stunned(b: Body, t: number): Pose {
  return fight(b, {
    drop: 0.06,
    tilt: 4 * t,
    lean: 10,
    nod: 18,
    handF: [-2 + 3 * t, b.H * 0.72],
    handB: [6 + 3 * t, b.H * 0.78],
    joints: { head: [14 * t, 0, -10] },
  });
}

// ---- jumping -------------------------------------------------------------------------------------------------------

/** Height (world units) of the jump's rotation pivot: 60 rows above the feet, less a little (the tuck's center). */
const TUCK_CENTER = (60 - 5) * 1.2;

function tuck(b: Body, amount: number): Pose {
  return free(b, {
    lean: 18 * amount,
    nod: 10 * amount,
    joints: {
      hipF: [0, 0, 118 * amount], kneeF: [0, 0, -135 * amount], footF: [0, 0, 20 * amount],
      hipB: [0, 0, 105 * amount], kneeB: [0, 0, -128 * amount], footB: [0, 0, 22 * amount],
      shoulderF: [0, 0, 45 + 20 * amount], elbowF: [0, 0, 70 + 30 * amount],
      shoulderB: [0, 0, 55 + 15 * amount], elbowB: [0, 0, 80 + 20 * amount],
    },
  });
}

/** Jump frames A..H: 0 airborne, 1 knee up, 2 tucking, 3 tucked, 4..7 the tuck turned 45..180 degrees forward. */
export function jump(b: Body, k: number): Pose {
  if (k === 0) {
    return free(b, {
      root: [0, 10 - b.L * 0.04],
      lean: 2,
      footF: [-4, b.ankle + 8],
      footB: [5, b.ankle + 11],
      footAngleF: 35,
      footAngleB: 30,
      handF: [b.A * 0.2, b.S + 10 - b.A * 0.15],
      handB: [b.A * 0.45, b.S + 10 - b.A * 0.05],
    });
  }
  if (k === 1) {
    return free(b, {
      root: [0, 12],
      lean: 6,
      footF: [-3, b.ankle + 10],
      footB: [b.L * 0.35, b.ankle + 12 + b.L * 0.4],
      footAngleF: 40,
      footAngleB: 20,
      handF: [b.A * 0.3, b.S + 10],
      handB: [b.A * 0.5, b.S + 12],
    });
  }
  const amount = k === 2 ? 0.6 : 1;
  const base = tuck(b, amount);
  const turn = k <= 3 ? 0 : (k - 3) * 45;
  const turned: Pose = { ...base, j: { ...base.j, pelvis: [0, 0, -turn] } };
  return centerAt(b, turned, [4, TUCK_CENTER - (k === 2 ? 6 : 0)]);
}

// ---- getting hit: the damage sheet (anim 9) ----------------------------------------------------------------------

/**
 * The 24 damage sprites A..X every robot needs, in the meaning the engine and all robots' moves give them:
 * A-C standing hit high, D-F standing hit in the body, G-I crouching hit, J-L knocked back and falling, M landed,
 * N-O flat on the back, P lifted, Q arms thrown up (wall splat), R sitting propped up, S-W collapsing forward to lying
 * face down, X held horizontally overhead.
 */
export function damage(b: Body, letter: string): Pose {
  const g = guard(b);
  switch (letter) {
    case 'A': case 'B': case 'C': {
      const k = 'ABC'.indexOf(letter) + 1;
      return fight(b, {
        root: [-2 * k, 0],
        drop: 0.02 * k,
        lean: -8 - 7 * k,
        nod: -10 - 6 * k,
        handF: [g.handF[0] - 2 * k, g.handF[1] + 4 * k],
        handB: [g.handB[0] - 1, g.handB[1] + 6 * k],
      });
    }
    case 'D': case 'E': case 'F': {
      const k = 'DEF'.indexOf(letter) + 1;
      return fight(b, {
        root: [-2 * k, 0],
        drop: 0.04 + 0.03 * k,
        tilt: 4 * k,
        lean: 10 + 8 * k,
        nod: 8,
        handF: [g.handF[0] + 2, b.H * (0.95 - 0.06 * k)],
        handB: [g.handB[0] - 2, b.H * (1 - 0.06 * k)],
      });
    }
    case 'G': case 'H': case 'I': {
      const k = 'GHI'.indexOf(letter) + 1;
      return crouch(b, {
        root: [-1.5 * k, 0],
        lean: -4 - 7 * k,
        nod: -8 - 5 * k,
        handF: [g.handF[0] - 2 * k, g.handF[1] - b.L * 0.3 + 3 * k],
        handB: [g.handB[0] - 2, g.handB[1] - b.L * 0.3 + 4 * k],
      });
    }
    case 'J':
      return fight(b, {
        root: [-6, 0],
        tilt: -14,
        lean: -8,
        nod: -12,
        footF: [g.footF[0] - 8, b.ankle],
        footB: [g.footB[0] + 2, b.ankle + 3],
        handF: [b.A * 0.8, b.S + 2],
        handB: [b.A * 0.95, b.S + 6],
      });
    case 'K':
      return onFloor(b, free(b, {
        tilt: -38,
        lean: 18,
        nod: -8,
        joints: {
          hipF: [0, 0, 55], kneeF: [0, 0, -40], footF: [0, 0, 20],
          hipB: [0, 0, 75], kneeB: [0, 0, -60], footB: [0, 0, 25],
          shoulderF: [0, 0, 105], elbowF: [0, 0, 10], shoulderB: [0, 0, 115], elbowB: [0, 0, 10],
        },
      }), 6);
    case 'L':
      return onFloor(b, free(b, {
        tilt: -72,
        lean: 12,
        nod: -10,
        joints: {
          hipF: [0, 0, 45], kneeF: [0, 0, -35], footF: [0, 0, 10],
          hipB: [0, 0, 60], kneeB: [0, 0, -50], footB: [0, 0, 15],
          shoulderF: [0, 0, 150], elbowF: [0, 0, 20], shoulderB: [0, 0, 165], elbowB: [0, 0, 15],
        },
      }), 4);
    case 'M':
      return onFloor(b, free(b, {
        root: [-6, 0],
        tilt: -88,
        lean: 16,
        nod: 10,
        joints: {
          hipF: [0, 0, 70], kneeF: [0, 0, -110], footF: [0, 0, 40],
          hipB: [0, 0, 30], kneeB: [0, 0, -35], footB: [0, 0, 10],
          shoulderF: [0, 0, 60], elbowF: [0, 0, 70], shoulderB: [0, 0, 150], elbowB: [0, 0, 30],
        },
      }));
    case 'N': case 'O':
      return onFloor(b, free(b, {
        root: [-8, 0],
        tilt: -90,
        nod: letter === 'N' ? 4 : -4,
        joints: {
          hipF: [0, 0, letter === 'N' ? 16 : 8], kneeF: [0, 0, letter === 'N' ? -30 : -12], footF: [0, 0, 60],
          hipB: [0, 0, 6], kneeB: [0, 0, -8], footB: [0, 0, 70],
          shoulderF: [0, 0, 12], elbowF: [0, 0, 20], shoulderB: [0, 0, 170], elbowB: [0, 0, 10],
        },
      }));
    case 'P':
      return free(b, {
        root: [2, 14],
        lean: -6,
        nod: -18,
        joints: {
          hipF: [0, 0, 8], kneeF: [0, 0, -18], footF: [0, 0, 40],
          hipB: [0, 0, 18], kneeB: [0, 0, -30], footB: [0, 0, 45],
          shoulderF: [0, 0, 95], elbowF: [0, 0, 40], shoulderB: [0, 0, 105], elbowB: [0, 0, 35],
        },
      });
    case 'Q':
      return free(b, {
        root: [0, 5],
        lean: -10,
        nod: -20,
        footF: [-4, b.ankle + 3],
        footB: [4, b.ankle + 4],
        footAngleF: 30,
        footAngleB: 30,
        joints: { shoulderF: [0, 0, 170], elbowF: [0, 0, 15], shoulderB: [0, 0, 160], elbowB: [0, 0, 25] },
      });
    case 'R':
      return onFloor(b, free(b, {
        tilt: -32,
        lean: 12,
        nod: 6,
        joints: {
          hipF: [0, 0, 100], kneeF: [0, 0, -95], footF: [0, 0, 20],
          hipB: [0, 0, 80], kneeB: [0, 0, -60], footB: [0, 0, 10],
          shoulderF: [0, 0, -35], elbowF: [0, 0, 10], shoulderB: [0, 0, -25], elbowB: [0, 0, 10],
        },
      }));
    case 'S':
      return fight(b, {
        drop: 0.04,
        lean: 16,
        nod: 22,
        handF: [0, b.H * 0.78],
        handB: [8, b.H * 0.8],
      });
    case 'T':
      return fight(b, {
        drop: 0.18,
        tilt: 34,
        lean: 26,
        nod: 18,
        footF: [g.footF[0] + 2, b.ankle],
        footB: [g.footB[0] - 1, b.ankle],
        handF: [g.footB[0] + 4, b.H * 0.62],
        handB: [g.footB[0] + 6, b.H * 0.6],
      });
    case 'U':
      return onFloor(b, free(b, {
        tilt: 22,
        lean: 24,
        nod: 20,
        joints: {
          hipF: [0, 0, 5], kneeF: [0, 0, -95], footF: [0, 0, 60],
          hipB: [0, 0, 95], kneeB: [0, 0, -95], footB: [0, 0, 0],
          shoulderF: [0, 0, 35], elbowF: [0, 0, 25], shoulderB: [0, 0, 45], elbowB: [0, 0, 30],
        },
      }));
    case 'V':
      return onFloor(b, free(b, {
        tilt: 75,
        lean: 6,
        nod: -30,
        joints: {
          hipF: [0, 0, 80], kneeF: [0, 0, -85], footF: [0, 0, 70],
          hipB: [0, 0, 70], kneeB: [0, 0, -80], footB: [0, 0, 70],
          shoulderF: [0, 0, 80], elbowF: [0, 0, 20], shoulderB: [0, 0, 95], elbowB: [0, 0, 25],
        },
      }));
    case 'W':
      return onFloor(b, free(b, {
        root: [8, 0],
        tilt: 90,
        nod: -30,
        joints: {
          hipF: [0, 0, 4], kneeF: [0, 0, -10], footF: [0, 0, 80],
          hipB: [0, 0, 8], kneeB: [0, 0, -20], footB: [0, 0, 80],
          shoulderF: [0, 0, 160], elbowF: [0, 0, 10], shoulderB: [0, 0, 20], elbowB: [0, 0, 20],
        },
      }));
    case 'X':
    default: {
      const p = free(b, {
        tilt: -95,
        lean: -10,
        nod: -30,
        joints: {
          hipF: [0, 0, -25], kneeF: [0, 0, -40], footF: [0, 0, 20],
          hipB: [0, 0, -5], kneeB: [0, 0, -60], footB: [0, 0, 20],
          shoulderF: [0, 0, -70], elbowF: [0, 0, 20], shoulderB: [0, 0, -95], elbowB: [0, 0, 15],
        },
      });
      return centerAt(b, p, [8, 0]);
    }
  }
}

export const DAMAGE_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWX';

/** Getting up after a knockdown: 0 propped on the elbows .. 3 crouching. */
export function standup(b: Body, k: number): Pose {
  if (k === 0) {
    return onFloor(b, free(b, {
      root: [-4, 0],
      tilt: -70,
      lean: 10,
      nod: 20,
      joints: {
        hipF: [0, 0, 60], kneeF: [0, 0, -100], footF: [0, 0, 40],
        hipB: [0, 0, 40], kneeB: [0, 0, -50], footB: [0, 0, 20],
        shoulderF: [0, 0, -40], elbowF: [0, 0, 60], shoulderB: [0, 0, -30], elbowB: [0, 0, 70],
      },
    }));
  }
  if (k === 1) return damage(b, 'R');
  if (k === 2) {
    return onFloor(b, free(b, {
      tilt: 10,
      lean: 12,
      nod: 6,
      joints: {
        hipF: [0, 0, -5], kneeF: [0, 0, -100], footF: [0, 0, 60],
        hipB: [0, 0, 95], kneeB: [0, 0, -100], footB: [0, 0, 5],
        shoulderF: [0, 0, 30], elbowF: [0, 0, 50], shoulderB: [0, 0, 40], elbowB: [0, 0, 60],
      },
    }));
  }
  return crouch(b, { drop: 0.02, nod: 4 });
}

/** Standing tall with the arms lowered and a little apart (menu pictures). */
export function present(b: Body): Pose {
  return free(b, {
    root: [0, -b.L * 0.03],
    lean: -2,
    nod: -3,
    footF: [-b.L * 0.16, b.ankle],
    footB: [b.L * 0.16, b.ankle],
    footAngleF: -4,
    joints: {
      shoulderF: [-18, 0, 8], elbowF: [0, 0, 28], handF: [0, 0, 10],
      shoulderB: [18, 0, 8], elbowB: [0, 0, 28], handB: [0, 0, 10],
    },
  });
}

// ---- endings -------------------------------------------------------------------------------------------------------

/** Victory: 0 stance .. 6 fist raised high (held). */
export function victory(b: Body, k: number): Pose {
  const g = guard(b);
  const t = Math.min(1, k / 6);
  const up = Math.max(0, (k - 2) / 4);
  return fight(b, {
    drop: -g.drop * t * 0.8,
    footF: [lerp(g.footF[0], -b.L * 0.12, t), b.ankle],
    footB: [lerp(g.footB[0], b.L * 0.14, t), b.ankle],
    lean: -4 * t,
    nod: -8 * up,
    handB: mixT(g.handB, [b.A * 0.25, b.S + b.A * 0.9], up),
    handF: mixT(g.handF, [b.A * 0.1, b.H + 4], t),
  });
}

/** Defeated on the floor: 0 flat, 1 lifting the head and an arm. */
export function defeat(b: Body, k: number): Pose {
  if (k === 0) return damage(b, 'N');
  return onFloor(b, free(b, {
    root: [-8, 0],
    tilt: -84,
    lean: 12,
    nod: 14,
    joints: {
      hipF: [0, 0, 26], kneeF: [0, 0, -45], footF: [0, 0, 60],
      hipB: [0, 0, 8], kneeB: [0, 0, -10], footB: [0, 0, 70],
      shoulderF: [0, 0, 35], elbowF: [0, 0, 60], shoulderB: [0, 0, 150], elbowB: [0, 0, 20],
    },
  }));
}

// ---- attacks -------------------------------------------------------------------------------------------------------

/** Lead (far) straight punch: t -0.2 (pulled back) .. 1 (fully extended). */
export function jab(b: Body, t: number): Pose {
  const g = guard(b);
  const reach = b.A * 0.95 + b.L * b.style.stance * 0.6;
  const e = Math.max(0, t);
  return fight(b, {
    root: [3 * e, 0],
    lean: 6 * e,
    twist: -14 * e,
    handB: [g.handB[0] + (reach - g.handB[0]) * t, g.handB[1] + 3 * e],
    footAngleF: -8 * e,
  });
}

/** Rear (near) power punch: t -1 (wound up) .. 1 (fully extended). */
export function cross(b: Body, t: number): Pose {
  const g = guard(b);
  const reach = b.A * 0.95 + b.L * b.style.stance * 0.9;
  const e = Math.max(0, t), w = Math.max(0, -t);
  return fight(b, {
    root: [5 * e - 3 * w, 0],
    lean: 10 * e - 4 * w,
    twist: 30 * e - 16 * w,
    handF: t >= 0 ? mixT(g.handF, [reach, g.handB[1] + 2], e) : mixT(g.handF, [g.handF[0] - 8, g.handF[1] - 2], w),
    handB: mixT(g.handB, [g.handB[0] - 6, g.handB[1] + 3], e),
    footAngleF: -14 * e,
  });
}

/** Rear uppercut: t 0 (dipped, fist low) .. 1 (fist straight up). */
export function uppercut(b: Body, t: number): Pose {
  const fist: Target = t < 0.5
    ? mixT([b.A * 0.35, b.H * 0.9], [b.A * 0.7, b.S], t * 2)
    : mixT([b.A * 0.7, b.S], [b.A * 0.45, b.S + b.A * 0.95], (t - 0.5) * 2);
  return fight(b, {
    root: [3 * t, lerp(-b.L * 0.12, 4, t)],
    lean: lerp(14, -6, t),
    twist: lerp(-10, 26, t),
    nod: lerp(6, -12, t),
    handF: fist,
    footAngleF: -20 * t,
    footAngleB: -10 * t,
  });
}

/** Rear leg front kick: t 0 (guard) .. 0.4 (knee chambered) .. 1 (extended at chest height). */
export function frontKick(b: Body, t: number, height = 1.05): Pose {
  const g = guard(b);
  const chamber: Target = [b.L * 0.3, b.ankle + b.L * 0.6];
  const out: Target = [b.L * 1.05, b.H * height];
  const foot = t < 0.4 ? mixT(g.footF, chamber, t / 0.4) : mixT(chamber, out, (t - 0.4) / 0.6);
  return fight(b, {
    root: [-2 * t, b.L * 0.06 * Math.min(1, t * 2)],
    tilt: -12 * t,
    lean: -6 * t,
    footB: [g.footB[0] - b.L * 0.2 * Math.min(1, t * 2), b.ankle],
    footF: foot,
    footAngleF: -20 - 50 * t,
  });
}

/** Rear leg roundhouse: t 0 .. 1 (foot at head height), turning the body away. */
export function roundhouse(b: Body, t: number): Pose {
  const g = guard(b);
  const chamber: Target = [b.L * 0.15, b.ankle + b.L * 0.75];
  const out: Target = [b.L * 1.0, b.S + b.A * 0.05];
  const foot = t < 0.35 ? mixT(g.footF, chamber, t / 0.35) : mixT(chamber, out, (t - 0.35) / 0.65);
  return fight(b, {
    root: [-3 * t, b.L * 0.08 * Math.min(1, t * 2)],
    tilt: -26 * t,
    lean: -10 * t,
    twist: -20 * t,
    nod: 10 * t,
    footB: [g.footB[0] - b.L * 0.25 * Math.min(1, t * 2), b.ankle],
    footAngleB: 10 * t,
    footF: foot,
    footAngleF: -30 - 50 * t,
    handF: mixT(g.handF, [g.handF[0] - 6, g.handF[1] + 2], t),
    handB: mixT(g.handB, [g.handB[0] - 10, g.handB[1] - 4], t),
  });
}

/** Crouching punch: `rear` uses the near arm; t 0 .. 1 (extended at the given height fraction of H). */
export function crouchPunch(b: Body, t: number, rear: boolean, height = 0.95): Pose {
  const g = guard(b);
  const low = b.L * 0.34;
  const reach = b.A * 0.95 + b.L * b.style.stance * (rear ? 0.9 : 0.6);
  const fist: Target = [lerp(rear ? g.handF[0] : g.handB[0], reach, t), lerp(g.handB[1] - low, b.H * height, t)];
  return crouch(b, {
    root: [3 * t, 0],
    twist: (rear ? 24 : -12) * t,
    lean: 4 + 6 * t,
    handF: rear ? fist : [g.handF[0] - 2 * t, g.handF[1] - low],
    handB: rear ? [g.handB[0] - 4 * t, g.handB[1] - low + 2] : fist,
  });
}

/** Crouching kick along the floor: `rear` uses the near leg; t 0 .. 1 (extended). */
export function lowKick(b: Body, t: number, rear: boolean, reach = 1.1): Pose {
  const g = guard(b);
  const low = b.L * 0.34;
  const out: Target = [b.L * reach, b.ankle + b.L * 0.12];
  const start = rear ? g.footF : g.footB;
  const foot = mixT([start[0], b.ankle], out, t);
  return crouch(b, {
    root: [-4 * t, b.L * 0.06 * t],
    tilt: -6 * t,
    lean: -4 * t,
    footF: rear ? foot : [g.footF[0] - 3 - 4 * t, b.ankle],
    footB: rear ? [g.footB[0] - 2 - 6 * t, b.ankle] : foot,
    footAngleF: rear ? -60 * t : 0,
    footAngleB: rear ? 0 : -60 * t,
    handF: [g.handF[0], g.handF[1] - low + 2],
    handB: [g.handB[0] - 4 * t, g.handB[1] - low],
  });
}

/** Leg sweep: 0 crouch, 1 hand down, 2 leg behind, 3-4 sweeping forward along the floor, 5 back, 6 crouch. */
export function sweep(b: Body, k: number): Pose {
  const g = guard(b);
  const low = b.L * 0.42;
  const planted: Target = [g.footB[0] - 2, b.ankle];
  const foot: Target[] = [
    [g.footF[0] - 3, b.ankle],
    [g.footF[0] - 4, b.ankle],
    [-b.L * 0.8, b.ankle + 1],
    [b.L * 0.5, b.ankle + 1],
    [b.L * 1.15, b.ankle + 2],
    [b.L * 0.2, b.ankle],
    [g.footF[0] - 3, b.ankle],
  ];
  if (k === 0 || k === 6) return crouch(b);
  const handsDown = k === 1 || k === 5
    ? { handF: [g.handF[0], g.handF[1] - low] as Target, handB: [g.handB[0], g.handB[1] - low] as Target }
    : { handF: [b.A * 0.15, b.ankle + 2] as Target, handB: [b.A * 0.35, b.ankle + 3] as Target };
  return fight(b, {
    drop: 0.42,
    tilt: 20,
    lean: 10,
    nod: -6,
    root: [k >= 3 && k <= 4 ? -4 : 0, 0],
    footB: planted,
    footF: foot[k],
    footAngleF: k >= 3 && k <= 4 ? -60 : 0,
    ...handsDown,
  });
}

/** The throw (a suplex): 0 reach, 1 grab, 2 lift, 3 overhead, 4 slam behind. */
export function throwPose(b: Body, k: number): Pose {
  const g = guard(b);
  switch (k) {
    case 0:
      return fight(b, { lean: 12, root: [4, 0], handF: [b.A * 0.95, b.S - 6], handB: [b.A * 1.0, b.S - 2] });
    case 1:
      return fight(b, { lean: 16, drop: 0.08, root: [4, 0], handF: [b.A * 0.8, b.S - 12], handB: [b.A * 0.85, b.S - 8] });
    case 2:
      return fight(b, { lean: -6, drop: 0.04, handF: [b.A * 0.55, b.S + 8], handB: [b.A * 0.6, b.S + 12], nod: -10 });
    case 3:
      return fight(b, {
        lean: -24,
        tilt: -8,
        nod: -20,
        footF: [g.footF[0] - 4, b.ankle],
        handF: [-b.A * 0.1, b.S + b.A * 0.75],
        handB: [0, b.S + b.A * 0.8],
      });
    default:
      return fight(b, {
        drop: 0.3,
        lean: -30,
        tilt: -18,
        nod: -24,
        footF: [g.footF[0] - 6, b.ankle],
        footB: [g.footB[0] + 4, b.ankle],
        handF: [-b.A * 0.9, b.H * 0.7],
        handB: [-b.A * 0.8, b.H * 0.8],
      });
  }
}

/** Airborne pose base: feet above the floor, knees bent. */
function air(b: Body, o: PoseOpts): Pose {
  return free(b, { root: [0, 8], footAngleF: 40, footAngleB: 35, ...o });
}

/** Jumping punch downward: t 0 (tucked, fist back) .. 1 (fist forward and down). */
export function jumpPunch(b: Body, t: number): Pose {
  return air(b, {
    lean: 10 + 10 * t,
    twist: 20 * t,
    footF: [-6, b.ankle + 10],
    footB: [b.L * 0.25, b.ankle + 18],
    handF: mixT([b.A * 0.1, b.S], [b.A * 1.0, b.S - b.A * 0.6], t),
    handB: [b.A * 0.4, b.S + 4],
  });
}

/** Flying kick: t 0 (both knees tucked) .. 1 (lead leg straight forward and down). */
export function jumpKick(b: Body, t: number): Pose {
  return air(b, {
    root: [0, 10],
    lean: -8 * t,
    tilt: -8 * t,
    footF: [-4, b.ankle + 16 + 6 * t],
    footB: mixT([b.L * 0.3, b.ankle + b.L * 0.45], [b.L * 1.05, b.ankle + b.L * 0.2], t),
    footAngleB: -50 * t,
    handF: [b.A * 0.2, b.S + 2],
    handB: [b.A * 0.4, b.S + 6],
  });
}
