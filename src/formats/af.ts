import { BinaryReader } from '../util/reader';
import { AnimationData, resolveMissingSprites } from './animation';

export const MAX_AF_MOVES = 70;

/** A HAR move: an animation plus combat metadata. */
export interface AfMoveData {
  animation: AnimationData;
  aiFlags: number;
  posConstraint: number;
  unknown: number[]; // unknown_4 .. unknown_11
  playIfHit: number;
  category: number;
  blockDamage: number;
  blockStun: number;
  successorId: number;
  damageAmount: number;
  throwDuration: number;
  extraStringSelector: number;
  points: number;
  moveString: string;
  footerString: string;
}

/** Fighter (HAR) definition file: FIGHTRn.AF */
export interface AfFile {
  fighterId: number;
  execWindow: number;
  endurance: number;
  upwardsJumpFrameLimit: number;
  health: number;
  forwardSpeed: number;
  reverseSpeed: number;
  jumpSpeed: number;
  fallSpeed: number;
  version1: number;
  aiProjectileYThreshold: number;
  moves: (AfMoveData | null)[];
  soundTable: Uint8Array;
}

export function parseAF(data: Uint8Array): AfFile {
  const r = new BinaryReader(data);
  const af: AfFile = {
    fighterId: r.u16(),
    execWindow: r.u16(),
    endurance: r.u32(),
    upwardsJumpFrameLimit: r.u8(),
    health: r.u16(),
    forwardSpeed: r.i32() / 256,
    reverseSpeed: r.i32() / 256,
    jumpSpeed: r.i32() / 256,
    fallSpeed: r.i32() / 256,
    version1: r.u8(),
    aiProjectileYThreshold: r.u8(),
    moves: new Array<AfMoveData | null>(MAX_AF_MOVES).fill(null),
    soundTable: new Uint8Array(30),
  };
  while (r.ok()) {
    const moveNo = r.u8();
    if (moveNo >= MAX_AF_MOVES) break;
    const animation = AnimationData.load(r);
    const move: AfMoveData = {
      animation,
      aiFlags: r.u16(),
      posConstraint: r.u16(),
      unknown: [r.u8(), r.u8(), r.u8(), r.u8(), r.u8(), r.u8(), r.u8(), r.u8()],
      playIfHit: r.u8(),
      category: r.u8(),
      blockDamage: r.u8(),
      blockStun: r.u8(),
      successorId: r.u8(),
      damageAmount: r.u8(),
      throwDuration: r.u8(),
      extraStringSelector: r.u8(),
      points: r.u8(),
      moveString: r.fixedStr(21),
      footerString: r.paddedStr(512),
    };
    af.moves[moveNo] = move;
  }
  af.soundTable.set(r.bytes(30));
  resolveMissingSprites(af.moves.filter((m): m is AfMoveData => m !== null).map((m) => m.animation));
  return af;
}
