// Animation-string tags. Order and parameter flags follow the reference tag table.
// Descriptions are brief notes on the (reverse engineered) meaning.

export enum Tag {
  AA, AB, AC, AD, AE, AF, AG, AI, AM, AO, AS, AT, AW, AX, AR, AL,
  B, B1, B2, BB, BE, BF, BH, BL, BM, BJ, BS, BU, BW, BX,
  BPD, BPS, BPN, BPF, BPP, BPB, BPO, BZ, BA, BC, BD, BG, BI, BK, BN, BO, BR, BT, BY,
  CF, CG, CL, CP, CW, CX, CY,
  D, E, F, G, H, I,
  JF2, JF, JG, JH, JJ, JL, JM, JP, JZ, JN,
  K, L,
  MA, MC, MD, MG, MI, MM, MN, MO, MP, MRX, MRY, MS, MU, MX, MY, M,
  N, OX, OY,
  PA, PB, PC, PD, PE, PH, PP, PS, PTD, PTP, PTR,
  Q, R, S, SA, SB, SC, SD, SE, SF, SL, SMF, SMO, SP, SW,
  T, U, UA, UB, UC, UD, UE, UF, UG, UH, UJ, UL, UN, UR, US, UZ,
  V, VSX, VSY, W,
  X_MINUS, X_PLUS, X_EQ, X, Y_MINUS, Y_PLUS, Y_EQ, Y,
  ZG, ZH, ZJ, ZL, ZM, ZP, ZZ,
  INVALID = 0xff,
}

/** [name, hasParam] indexed by Tag. */
export const TAG_TABLE: ReadonlyArray<readonly [string, boolean]> = [
  ['aa', false], // reset air attack state
  ['ab', false], // allow passing through walls
  ['ac', false], // face arena center
  ['ad', false], // allow turning in held direction
  ['ae', false],
  ['af', false], // freeze opponent
  ['ag', false],
  ['ai', false], // hit will launch
  ['am', false],
  ['ao', false],
  ['as', false], // fire orb wander
  ['at', false], // teleport behind enemy (Chronos)
  ['aw', false],
  ['ax', false], // fall through floor
  ['ar', false], // reverse direction
  ['al', false],
  ['b', false],
  ['b1', false],
  ['b2', false],
  ['bb', true], // vertical screen shake
  ['be', false], // block end of round (scrap/destruct)
  ['bf', true], // blend finish
  ['bh', false],
  ['bl', true], // horizontal screen shake
  ['bm', true],
  ['bj', true], // jump to animation n
  ['bs', true], // blend start
  ['bu', false],
  ['bw', false],
  ['bx', false],
  ['bpd', true], // palette reference index
  ['bps', true], // palette start index
  ['bpn', true], // palette entry count
  ['bpf', false], // fighter palette selection
  ['bpp', true], // initial and final color level
  ['bpb', true], // initial color level
  ['bpo', false], // palette copy trick (credits)
  ['bz', false], // tint effect
  ['ba', true],
  ['bc', true],
  ['bd', false],
  ['bg', false], // additive
  ['bi', true],
  ['bk', true],
  ['bn', false], // unblockable
  ['bo', true], // shadow correction
  ['br', false], // glow
  ['bt', false], // dark tint
  ['by', false], // shadow off
  ['cf', false],
  ['cg', false],
  ['cl', false],
  ['cp', false], // hit pause
  ['cw', false],
  ['cx', true], // horizontal control
  ['cy', true], // vertical control
  ['d', true], // re-enter at tick n
  ['e', false], // position at enemy
  ['f', false], // flip vertical
  ['g', false], // snap to ground
  ['h', false], // zero velocity
  ['i', false], // interrupted on block
  ['jf2', false],
  ['jf', false],
  ['jg', false],
  ['jh', false],
  ['jj', false],
  ['jl', false],
  ['jm', false],
  ['jp', false],
  ['jz', false],
  ['jn', true],
  ['k', true], // knockback
  ['l', true], // sound loudness
  ['ma', true],
  ['mc', false],
  ['md', true], // destroy animation n
  ['mg', true], // spawn gravity
  ['mi', true], // spawn instances
  ['mm', true],
  ['mn', true],
  ['mo', false],
  ['mp', true], // spawn flags
  ['mrx', true],
  ['mry', true],
  ['ms', false],
  ['mu', true],
  ['mx', true], // spawn x
  ['my', true], // spawn y
  ['m', true], // spawn animation n
  ['n', false], // no collision
  ['ox', true], // sprite x correction
  ['oy', true], // sprite y correction
  ['pa', false],
  ['pb', true],
  ['pc', true],
  ['pd', true],
  ['pe', false],
  ['ph', false],
  ['pp', true],
  ['ps', false],
  ['ptd', true],
  ['ptp', true],
  ['ptr', true],
  ['q', true], // enable hit
  ['r', false], // flip horizontal
  ['s', true], // play sound n
  ['sa', false],
  ['sb', true], // sound pan start
  ['sc', true],
  ['sd', false],
  ['se', true],
  ['sf', true], // sound frequency
  ['sl', true],
  ['smf', true], // stop music
  ['smo', true], // play music
  ['sp', true],
  ['sw', true],
  ['t', false],
  ['u', false], // bring to front
  ['ua', false],
  ['ub', false], // motion trail
  ['uc', false],
  ['ud', false],
  ['ue', false],
  ['uf', false],
  ['ug', false],
  ['uh', false],
  ['uj', false],
  ['ul', false],
  ['un', false], // disable corner push
  ['ur', false],
  ['us', false],
  ['uz', false],
  ['v', false], // velocity mode for x+/y+
  ['vsx', false],
  ['vsy', false],
  ['w', false], // push to back
  ['x-', true],
  ['x+', true],
  ['x=', true],
  ['x', true], // x scale %
  ['y-', true],
  ['y+', true],
  ['y=', true],
  ['y', true], // y scale %
  ['zg', false],
  ['zh', false],
  ['zj', false], // invulnerable to jumping attacks
  ['zl', false],
  ['zm', false],
  ['zp', false], // invulnerable to projectiles
  ['zz', false], // invulnerable
];

const lookup = new Map<string, number>();
TAG_TABLE.forEach(([name], i) => lookup.set(name, i));

export function tagLookup(name: string): number | undefined {
  return lookup.get(name);
}

export function tagName(tag: number): string {
  return TAG_TABLE[tag]?.[0] ?? '?';
}
