import { BinaryReader, BinaryWriter, xorDecode } from '../util/reader';
import { Palette } from './palette';
import type { Sprite } from './sprite';

export const PILOT_QUOTE_COUNT = 10;
export const PILOT_BLOCK_LENGTH = 428;

/** Pilot record used by tournaments (TRN) and saved characters (CHR). */
export class Pilot {
  unknownA = 0;
  name = '';
  wins = 0;
  losses = 0;
  rank = 0;
  harId = 0;
  armPower = 0;
  legPower = 0;
  armSpeed = 0;
  legSpeed = 0;
  armor = 0;
  stunResistance = 0;
  power = 0;
  agility = 0;
  endurance = 0;
  offense = 0;
  defense = 0;
  money = 0;
  color3 = 0; // tertiary
  color2 = 0; // secondary
  color1 = 0; // primary
  trnName = '';
  trnDesc = '';
  trnImage = '';
  trnRankMoney = 0;
  trnWinningsMult = 0;
  pilotId = 0;
  unknownK = 0;
  forceArena = 0;
  difficulty = 0;
  unkBlockB = new Uint8Array(2);
  movement = 0;
  unkBlockC = new Uint8Array(6);
  enhancements = new Uint8Array(11);
  secret = 0;
  onlyFightOnce = 0;
  reqEnemy = 0;
  reqDifficulty = 0;
  reqRank = 0;
  reqVitality = 0;
  reqFighter = 0;
  reqAccuracy = 0;
  reqAvgDmg = 0;
  reqMaxRank = 0;
  reqScrap = 0;
  reqDestroy = 0;
  attNormal = 0;
  attHyper = 0;
  attJump = 0;
  attDef = 0;
  attSniper = 0;
  unkBlockD = new Uint8Array(4);
  apClose = 0;
  apThrow = 0;
  apSpecial = 0;
  apJump = 0;
  apHigh = 0;
  apLow = 0;
  apMiddle = 0;
  prefJump = 0;
  prefFwd = 0;
  prefBack = 0;
  unknownE = 0;
  learning = 0;
  forget = 0;
  sound1 = 0;
  sound2 = 0;
  sound3 = 0;
  unkBlockF = new Uint8Array(8);
  enemiesIncUnranked = 0;
  enemiesExUnranked = 0;
  unkDA = 0;
  harTrades = 0;
  winnings = 0;
  totalValue = 0;
  currentHealth = 0;
  maximumHealth = 0;
  unkFB = 0;
  palette = new Palette();
  isPlayer = 0;
  photoId = 0;
  quotes: string[] = new Array(PILOT_QUOTE_COUNT).fill('');
  sex = 0;
  photo: Sprite | null = null;

  clone(): Pilot {
    const p = new Pilot();
    Object.assign(p, this);
    p.unkBlockB = this.unkBlockB.slice();
    p.unkBlockC = this.unkBlockC.slice();
    p.enhancements = this.enhancements.slice();
    p.unkBlockD = this.unkBlockD.slice();
    p.unkBlockF = this.unkBlockF.slice();
    p.palette = this.palette.clone();
    p.quotes = this.quotes.slice();
    p.photo = this.photo ? this.photo.clone() : null;
    return p;
  }

  /** The 68-byte "player" portion shared by CHR enemy records. */
  loadPlayer(r: BinaryReader): void {
    this.name = r.fixedStr(18);
    this.wins = r.u16();
    this.losses = r.u16();
    this.rank = r.u8();
    this.harId = r.u8();
    const a = r.u16();
    const b = r.u16();
    const c = r.u16();
    const d = r.u8();
    this.armPower = a & 0x1f;
    this.legPower = (a >> 5) & 0x1f;
    this.armSpeed = (a >> 10) & 0x1f;
    this.legSpeed = b & 0x1f;
    this.armor = (b >> 5) & 0x1f;
    this.stunResistance = (b >> 10) & 0x1f;
    this.agility = c & 0x7f;
    this.power = (c >> 7) & 0x7f;
    this.endurance = d & 0x7f;
    r.skip(1);
    this.offense = r.u16();
    this.defense = r.u16();
    this.money = r.i32();
    // Colors are applied to the palette by the resource layer (needs ALTPALS / PLAYERS.PIC).
    this.color3 = r.u8();
    this.color2 = r.u8();
    this.color1 = r.u8();
  }

  savePlayer(w: BinaryWriter): void {
    w.fixedStr(this.name, 18);
    w.u16(this.wins);
    w.u16(this.losses);
    w.u8(this.rank);
    w.u8(this.harId);
    w.u16((this.armPower & 0x1f) | ((this.legPower & 0x1f) << 5) | ((this.armSpeed & 0x1f) << 10));
    w.u16((this.legSpeed & 0x1f) | ((this.armor & 0x1f) << 5) | ((this.stunResistance & 0x1f) << 10));
    w.u16((this.agility & 0x7f) | ((this.power & 0x7f) << 7));
    w.u8(this.endurance & 0x7f);
    w.u8(0);
    w.u16(this.offense);
    w.u16(this.defense);
    w.i32(this.money);
    w.u8(this.color3);
    w.u8(this.color2);
    w.u8(this.color1);
  }

  /** Full pilot block (already XOR-decoded). */
  loadFull(r: BinaryReader): void {
    this.unknownA = r.u32();
    this.loadPlayer(r);
    this.trnName = r.fixedStr(13);
    this.trnDesc = r.fixedStr(31);
    this.trnImage = r.fixedStr(13);
    this.trnRankMoney = r.f32();
    this.trnWinningsMult = r.f32();
    r.skip(40);
    this.pilotId = r.u8();
    this.unknownK = r.u8();
    this.forceArena = r.u16();
    this.difficulty = (r.u8() >> 3) & 0x3;
    this.unkBlockB = r.bytes(2).slice();
    this.movement = r.u8();
    this.unkBlockC = r.bytes(6).slice();
    this.enhancements = r.bytes(11).slice();
    r.skip(1);
    const reqFlags = r.u8();
    this.secret = reqFlags & 0x02 ? 1 : 0;
    this.onlyFightOnce = reqFlags & 0x08 ? 1 : 0;
    r.skip(1);
    const reqs = [r.u16(), r.u16(), r.u16(), r.u16(), r.u16()];
    this.reqRank = reqs[0] & 0xff;
    this.reqMaxRank = (reqs[0] >> 8) & 0xff;
    this.reqFighter = reqs[1] & 0x1f;
    this.reqDifficulty = (reqs[2] >> 8) & 0x0f;
    this.reqEnemy = reqs[2] & 0xff;
    this.reqVitality = reqs[3] & 0x7f;
    this.reqAccuracy = (reqs[3] >> 7) & 0x7f;
    this.reqAvgDmg = reqs[4] & 0x7f;
    this.reqScrap = reqs[4] & 0x80 ? 1 : 0;
    this.reqDestroy = (reqs[4] >> 8) & 0x01 ? 1 : 0;
    const att = [r.u16(), r.u16(), r.u16()];
    this.attNormal = (att[0] >> 4) & 0x7f;
    this.attHyper = att[1] & 0x7f;
    this.attJump = (att[1] >> 7) & 0x7f;
    this.attDef = att[2] & 0x7f;
    this.attSniper = (att[2] >> 7) & 0x7f;
    this.unkBlockD = r.bytes(4).slice();
    this.apClose = r.i16();
    this.apThrow = r.i16();
    this.apSpecial = r.i16();
    this.apJump = r.i16();
    this.apHigh = r.i16();
    this.apLow = r.i16();
    this.apMiddle = r.i16();
    this.prefJump = r.i16();
    this.prefFwd = r.i16();
    this.prefBack = r.i16();
    this.unknownE = r.u32();
    this.learning = r.f32();
    this.forget = r.f32();
    this.sound1 = r.i16();
    this.sound2 = r.i16();
    this.sound3 = r.i16();
    this.unkBlockF = r.bytes(8).slice();
    this.enemiesIncUnranked = r.u16();
    this.enemiesExUnranked = r.u16();
    this.unkDA = r.u16();
    this.harTrades = r.u32();
    this.winnings = r.u32();
    this.totalValue = r.u32();
    this.currentHealth = r.i16();
    this.maximumHealth = r.i16();
    this.unkFB = r.f32();
    r.skip(8);
    this.palette = new Palette();
    this.palette.loadRange(r, 0, 48);
    this.isPlayer = r.u16();
    this.photoId = r.u16() & 0x3ff;
  }

  saveFull(w: BinaryWriter): void {
    w.u32(this.unknownA);
    this.savePlayer(w);
    w.fixedStr(this.trnName, 13);
    w.fixedStr(this.trnDesc, 31);
    w.fixedStr(this.trnImage, 13);
    w.f32(this.trnRankMoney);
    w.f32(this.trnWinningsMult);
    w.fill(0, 40);
    w.u8(this.pilotId);
    w.u8(this.unknownK);
    w.u16(this.forceArena);
    w.u8((this.difficulty & 0x3) << 3);
    w.bytes(this.unkBlockB);
    w.u8(this.movement);
    w.bytes(this.unkBlockC);
    w.bytes(this.enhancements);
    w.u8(0);
    w.u8((this.secret ? 0x02 : 0) | (this.onlyFightOnce ? 0x08 : 0));
    w.u8(0);
    w.u16((this.reqRank & 0xff) | ((this.reqMaxRank & 0xff) << 8));
    w.u16(this.reqFighter & 0x1f);
    w.u16((this.reqEnemy & 0xff) | ((this.reqDifficulty & 0x0f) << 8));
    w.u16((this.reqVitality & 0x7f) | ((this.reqAccuracy & 0x7f) << 7));
    w.u16((this.reqAvgDmg & 0x7f) | ((this.reqScrap & 1) << 7) | ((this.reqDestroy & 1) << 8));
    w.u16((this.attNormal & 0x7f) << 4);
    w.u16((this.attHyper & 0x7f) | ((this.attJump & 0x7f) << 7));
    w.u16((this.attDef & 0x7f) | ((this.attSniper & 0x7f) << 7));
    w.bytes(this.unkBlockD);
    for (const v of [this.apClose, this.apThrow, this.apSpecial, this.apJump, this.apHigh, this.apLow, this.apMiddle,
      this.prefJump, this.prefFwd, this.prefBack]) w.i16(v);
    w.u32(this.unknownE);
    w.f32(this.learning);
    w.f32(this.forget);
    w.i16(this.sound1);
    w.i16(this.sound2);
    w.i16(this.sound3);
    w.bytes(this.unkBlockF);
    w.u16(this.enemiesIncUnranked);
    w.u16(this.enemiesExUnranked);
    w.u16(this.unkDA);
    w.u32(this.harTrades);
    w.u32(this.winnings);
    w.u32(this.totalValue);
    w.i16(this.currentHealth);
    w.i16(this.maximumHealth);
    w.f32(this.unkFB);
    w.fill(0, 8);
    this.palette.saveRange(w, 0, 48);
    w.u16(this.isPlayer);
    w.u16(this.photoId & 0x3ff);
  }

  /** Reads an XOR-obfuscated pilot block followed by the quote strings (TRN format). */
  static loadTrnPilot(r: BinaryReader): Pilot {
    const p = new Pilot();
    const block = xorDecode(r.bytes(PILOT_BLOCK_LENGTH), PILOT_BLOCK_LENGTH & 0xff);
    p.loadFull(new BinaryReader(block));
    for (let m = 0; m < PILOT_QUOTE_COUNT; m++) p.quotes[m] = r.paddedStr();
    return p;
  }
}
