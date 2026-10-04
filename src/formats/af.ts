import { BinaryReader, BinaryWriter } from '../util/reader';
import { AnimationData, LENIENT_STRING_MAX, resolveMissingSprites } from './animation';

export const MAX_AF_MOVES = 70;
/** A move's reaction string field (read up to 511 bytes, its NUL included). */
const FOOTER_MAX = 512;

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

/** Reads an AF file; `lenient`: past the format's string and hit point limits too (see AnimationData.load). */
export function parseAF(data: Uint8Array, lenient = false): AfFile {
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
    const animation = AnimationData.load(r, lenient);
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
      footerString: r.paddedStr(lenient ? LENIENT_STRING_MAX : FOOTER_MAX),
    };
    af.moves[moveNo] = move;
  }
  af.soundTable.set(r.bytes(30));
  resolveMissingSprites(af.moves.filter((m): m is AfMoveData => m !== null).map((m) => m.animation));
  return af;
}

/** Writes an AF file (the inverse of parseAF; used for the generated robots). */
export function saveAF(af: AfFile): Uint8Array {
  const w = new BinaryWriter(1 << 16);
  w.u16(af.fighterId);
  w.u16(af.execWindow);
  w.u32(af.endurance);
  w.u8(af.upwardsJumpFrameLimit);
  w.u16(af.health);
  w.i32(Math.round(af.forwardSpeed * 256));
  w.i32(Math.round(af.reverseSpeed * 256));
  w.i32(Math.round(af.jumpSpeed * 256));
  w.i32(Math.round(af.fallSpeed * 256));
  w.u8(af.version1);
  w.u8(af.aiProjectileYThreshold);
  af.moves.forEach((m, id) => {
    if (!m) return;
    // (refused rather than written past what parseAF reads back)
    if (m.footerString.length >= FOOTER_MAX - 1) {
      throw new Error(`move ${id}: a reaction string of ${m.footerString.length} characters (${FOOTER_MAX - 2} at most)`);
    }
    w.u8(id);
    try {
      m.animation.save(w);
    } catch (err) {
      throw new Error(`move ${id}: ${(err as Error).message}`);
    }
    w.u16(m.aiFlags);
    w.u16(m.posConstraint);
    for (let i = 0; i < 8; i++) w.u8(m.unknown[i] ?? 0);
    w.u8(m.playIfHit);
    w.u8(m.category);
    w.u8(m.blockDamage);
    w.u8(m.blockStun);
    w.u8(m.successorId);
    w.u8(m.damageAmount);
    w.u8(m.throwDuration);
    w.u8(m.extraStringSelector);
    w.u8(m.points);
    w.fixedStr(m.moveString, 21);
    w.paddedStr(m.footerString);
  });
  w.u8(250);
  w.bytes(af.soundTable);
  return w.toBytes();
}
