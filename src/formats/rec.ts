// Match recordings (REC files): both pilots, the match settings, and every change of the players' input with the tick
// it happened on (port of the reference formats/rec.c). A recording replays a whole match: the engine is deterministic,
// so feeding the same inputs from the same random seed plays the same fight. The remaster saves every fight as one.
import { BinaryReader, BinaryWriter } from '../util/reader';
import { Pilot } from './pilot';
import { Sprite } from './sprite';

/** Action bytes of lookup 2 records (reference sd_action). */
export const SD_ACT_NONE = 0x00;
export const SD_ACT_PUNCH = 0x01;
export const SD_ACT_KICK = 0x02;
export const SD_ACT_UPUP = 0x10;
export const SD_ACT_UPRIGHT = 0x20;
export const SD_ACT_RIGHTRIGHT = 0x30;
export const SD_ACT_DOWNRIGHT = 0x40;
export const SD_ACT_DOWNDOWN = 0x50;
export const SD_ACT_DOWNLEFT = 0x60;
export const SD_ACT_LEFTLEFT = 0x70;
export const SD_ACT_UPLEFT = 0x80;

/** Lookup ids used by the engine: 2 = an input, 10 = extended records (random seed, assertions). */
export const REC_LOOKUP_ACTION = 2;
export const REC_LOOKUP_EXTENDED = 10;
export const REC_LOOKUP10_SETRANDOM = 4;
export const REC_LOOKUP10_ASSERT = 0x41; // 'A'

export const REC_CONTROLLER_KEYBOARD1 = 1;
export const REC_CONTROLLER_KEYBOARD2 = 2;
export const REC_CONTROLLER_JOYSTICK1 = 3;
export const REC_CONTROLLER_JOYSTICK2 = 4;
export const REC_CONTROLLER_AI = 5;
export const REC_CONTROLLER_NETWORK = 6;
export const REC_CONTROLLER_REPLAY = 9;

export const REC_GAMEMODE_TOURNAMENT = 1;
export const REC_GAMEMODE_ARCADE = 2;

export interface RecMove {
  tick: number;
  lookupId: number;
  playerId: number;
  /** Extra data (length by lookup id, recExtraLen). */
  extra: Uint8Array;
}

export interface RecPilot {
  info: Pilot;
  unknownA: number;
  unknownB: number;
}

export interface RecFile {
  pilots: [RecPilot, RecPilot];
  /** Scores at the start of the match. */
  scores: [number, number];
  unknownA: number;
  arenaPalette: number;
  gameMode: number;
  throwRange: number;
  hitPause: number;
  blockDamage: number;
  vitality: number;
  jumpHeight: number;
  p1Controller: number;
  p2Controller: number;
  p2ControllerStatic: number;
  knockDown: number;
  rehitMode: number;
  defThrows: number;
  arenaId: number;
  power: [number, number];
  hazards: number;
  roundType: number;
  unknownL: number;
  hyperMode: number;
  unknownM: number;
  moves: RecMove[];
}

/** Length of a record's extra data by lookup id (must match the original game's table). */
export function recExtraLen(key: number): number {
  switch (key) {
    case 0: case 11: case 12: case 16: case 17: case 19:
      return 0;
    case 14:
      return 2;
    case 21:
      return 3;
    case 7:
      return 4;
    case 4: case 10: case 18:
      return 8;
    case 15:
      return 20;
    case 6:
      return 60;
    case 20:
      return 144;
  }
  return key < 0x60 ? 1 : 10;
}

export function recCreate(): RecFile {
  const pilot = (): RecPilot => ({ info: new Pilot(), unknownA: 0, unknownB: 0 });
  return {
    pilots: [pilot(), pilot()], scores: [0, 0], unknownA: 0, arenaPalette: 0, gameMode: REC_GAMEMODE_ARCADE,
    throwRange: 100, hitPause: 4, blockDamage: 0, vitality: 100, jumpHeight: 100,
    p1Controller: REC_CONTROLLER_KEYBOARD1, p2Controller: REC_CONTROLLER_KEYBOARD2, p2ControllerStatic: REC_CONTROLLER_KEYBOARD2,
    knockDown: 0, rehitMode: 0, defThrows: 0, arenaId: 0, power: [5, 5], hazards: 1, roundType: 0, unknownL: 0, hyperMode: 0,
    unknownM: 0, moves: [],
  };
}

export function recMove(tick: number, lookupId: number, playerId: number): RecMove {
  return { tick, lookupId, playerId, extra: new Uint8Array(recExtraLen(lookupId)) };
}

/** Reads a REC file (sd_rec_load). */
export function recParse(data: Uint8Array): RecFile {
  if (data.length < 1224) throw new Error('REC file too short');
  const r = new BinaryReader(data);
  const rec = recCreate();
  for (let i = 0; i < 2; i++) {
    const info = Pilot.loadTrnPilot(r);
    const p = rec.pilots[i];
    p.info = info;
    p.unknownA = r.u8();
    p.unknownB = r.u16();
    info.palette.loadRange(r, 0, 48);
    if (r.u8()) info.photo = Sprite.load(r);
  }
  rec.scores = [r.u32(), r.u32()];
  rec.unknownA = r.i8();
  rec.arenaPalette = r.i8();
  rec.gameMode = r.i8();
  rec.throwRange = r.i16();
  rec.hitPause = r.i16();
  rec.blockDamage = r.i16();
  rec.vitality = r.i16();
  rec.jumpHeight = r.i16();
  rec.p1Controller = r.i16();
  rec.p2Controller = r.i16();
  rec.p2ControllerStatic = r.i16();
  const bits = r.u32();
  rec.knockDown = bits & 0x03;
  rec.rehitMode = (bits >> 2) & 0x01;
  rec.defThrows = (bits >> 3) & 0x01;
  rec.arenaId = (bits >> 4) & 0x1f;
  rec.power = [(bits >> 9) & 0x1f, (bits >> 14) & 0x1f];
  rec.hazards = (bits >> 19) & 0x01;
  rec.roundType = (bits >> 20) & 0x03;
  rec.unknownL = (bits >> 22) & 0x03;
  rec.hyperMode = (bits >> 24) & 0x01;
  rec.unknownM = r.i8();
  const maxMoves = Math.floor((data.length - r.pos) / 6);
  while (rec.moves.length < maxMoves && r.pos < data.length) {
    const tick = r.u32();
    const lookupId = r.u8();
    const playerId = r.u8();
    const len = recExtraLen(lookupId);
    rec.moves.push({ tick, lookupId, playerId, extra: len > 0 ? r.bytes(len).slice() : new Uint8Array(0) });
  }
  return rec;
}

/** Writes a REC file (sd_rec_save). */
export function recSerialize(rec: RecFile): Uint8Array {
  const w = new BinaryWriter(4096);
  for (const p of rec.pilots) {
    p.info.saveTrnPilot(w);
    w.u8(p.unknownA);
    w.u16(p.unknownB);
    p.info.palette.saveRange(w, 0, 48);
    w.u8(p.info.photo ? 1 : 0);
    p.info.photo?.save(w);
  }
  w.u32(rec.scores[0] >>> 0);
  w.u32(rec.scores[1] >>> 0);
  w.i8(rec.unknownA);
  w.i8(rec.arenaPalette);
  w.i8(rec.gameMode);
  w.i16(rec.throwRange);
  w.i16(rec.hitPause);
  w.i16(rec.blockDamage);
  w.i16(rec.vitality);
  w.i16(rec.jumpHeight);
  w.i16(rec.p1Controller);
  w.i16(rec.p2Controller);
  w.i16(rec.p2ControllerStatic);
  let bits = 0;
  bits |= (rec.knockDown & 0x3) << 0;
  bits |= (rec.rehitMode & 0x1) << 2;
  bits |= (rec.defThrows & 0x1) << 3;
  bits |= (rec.arenaId & 0x1f) << 4;
  bits |= (rec.power[0] & 0x1f) << 9;
  bits |= (rec.power[1] & 0x1f) << 14;
  bits |= (rec.hazards & 0x1) << 19;
  bits |= (rec.roundType & 0x3) << 20;
  bits |= (rec.unknownL & 0x3) << 22;
  bits |= (rec.hyperMode & 0x1) << 24;
  w.u32(bits >>> 0);
  w.i8(rec.unknownM);
  for (const m of rec.moves) {
    w.u32(m.tick >>> 0);
    w.u8(m.lookupId);
    w.u8(m.playerId);
    const len = recExtraLen(m.lookupId);
    const extra = new Uint8Array(len);
    extra.set(m.extra.subarray(0, len));
    w.bytes(extra);
  }
  return w.toBytes();
}

/** Inserts a record after the records of the same or earlier ticks (sd_rec_insert_action_at_tick). */
export function recInsertAtTick(rec: RecFile, move: RecMove): void {
  let i = 0;
  while (i < rec.moves.length && move.tick >= rec.moves[i].tick) i++;
  rec.moves.splice(i, 0, move);
}

/** Marks the end of the match: a final "no input" record (sd_rec_finish). */
export function recFinish(rec: RecFile, ticks: number): void {
  const m = recMove(ticks, REC_LOOKUP_ACTION, 0);
  m.extra[0] = SD_ACT_NONE;
  rec.moves.push(m);
}

/** The random seed record at tick 1 (set when the match starts). */
export function recSeedMove(seed: number): RecMove {
  const m = recMove(1, REC_LOOKUP_EXTENDED, 0);
  m.extra[0] = REC_LOOKUP10_SETRANDOM;
  new DataView(m.extra.buffer).setUint32(4, seed >>> 0, true);
  return m;
}

/** The seed of a SETRANDOM record, or null. */
export function recSeedOf(m: RecMove): number | null {
  if (m.lookupId !== REC_LOOKUP_EXTENDED || m.extra[0] !== REC_LOOKUP10_SETRANDOM) return null;
  return new DataView(m.extra.buffer, m.extra.byteOffset).getUint32(4, true);
}

/** The last tick with an input or extended record: the length of the recording. */
export function recLastTick(rec: RecFile): number {
  let t = 0;
  for (const m of rec.moves) if ((m.lookupId === REC_LOOKUP_ACTION || m.lookupId === REC_LOOKUP_EXTENDED) && m.tick > t) t = m.tick;
  return t;
}
