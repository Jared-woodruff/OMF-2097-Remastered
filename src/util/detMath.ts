// Sine and cosine that give the same result on every JavaScript engine. A fight must play out the same in two games
// that may run on different engines: a network game between the Windows app (V8) and the macOS or Linux app (WebKit's
// JavaScriptCore), and replays. Math.sin and Math.cos are only required to be close to the true value, and the engines'
// libraries now and then differ in the last bit; a difference there moves a Fire Pit orb or a spawned object a tiny bit,
// and the two games drift apart. These are fdlibm's (Sun's freely distributable math library, which most engines'
// started from): only + - * / on doubles, which every engine rounds the same way, and integer operations on the
// numbers' halves. They are within an ulp of the true value.
//
// The fight code's angles use these (object.ts: the AS and MA tags); the rest of the game (drawing, screen shake, menus,
// the credits) keeps Math.sin and Math.cos: it is not part of a fight's state.

/** A double and its two 32-bit halves (the high one holds the sign, the exponent and the top of the mantissa). */
const f64 = new Float64Array(1);
const i32 = new Int32Array(f64.buffer);
/** Which half is the high one: the second on little-endian machines (all of today's), the first on the others. */
const HI = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1 ? 1 : 0;
const LO = 1 - HI;

function highWord(x: number): number {
  f64[0] = x;
  return i32[HI];
}

/** The double of two halves. */
function fromWords(hi: number, lo: number): number {
  i32[HI] = hi;
  i32[LO] = lo;
  return f64[0];
}

// ---- the kernels: |x| <= pi/4 --------------------------------------------------------------------------------------

const S1 = -1.66666666666666324348e-01; // 0xBFC55555 0x55555549
const S2 = 8.33333333332248946124e-03; // 0x3F811111 0x1110F8A6
const S3 = -1.98412698298579493134e-04; // 0xBF2A01A0 0x19C161D5
const S4 = 2.75573137070700676789e-06; // 0x3EC71DE3 0x57B1FE7D
const S5 = -2.50507602534068634195e-08; // 0xBE5AE5E6 0x8A2B9CEB
const S6 = 1.58969099521155010221e-10; // 0x3DE5D93A 0x5ACFD57C

/** __kernel_sin: sin(x + y) for |x| <= pi/4, y the tail of x (iy 0: there is none). */
function kernelSin(x: number, y: number, iy: number): number {
  // (|x| < 2^-27: sin x is x)
  if ((highWord(x) & 0x7fffffff) < 0x3e400000) return x;
  const z = x * x;
  const v = z * x;
  const r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  if (iy === 0) return x + v * (S1 + z * r);
  return x - ((z * (0.5 * y - v * r) - y) - v * S1);
}

const C1 = 4.16666666666666019037e-02; // 0x3FA55555 0x5555554C
const C2 = -1.38888888888741095749e-03; // 0xBF56C16C 0x16C15177
const C3 = 2.48015872894767294178e-05; // 0x3EFA01A0 0x19CB1590
const C4 = -2.75573143513906633035e-07; // 0xBE927E4F 0x809C52AD
const C5 = 2.08757232129817482790e-09; // 0x3E21EE9E 0xBDB4B1C4
const C6 = -1.13596475577881948265e-11; // 0xBDA8FAE9 0xBE8838D4

/** __kernel_cos: cos(x + y) for |x| <= pi/4, y the tail of x. */
function kernelCos(x: number, y: number): number {
  const ix = highWord(x) & 0x7fffffff;
  // (|x| < 2^-27: cos x is 1)
  if (ix < 0x3e400000) return 1;
  const z = x * x;
  const r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  // (|x| < 0.3)
  if (ix < 0x3fd33333) return 1 - (0.5 * z - (z * r - x * y));
  // 1 - x*x/2 loses bits for bigger x: 1 - qx first, with qx about x*x/8 (x/4 cut to its high half, or 0.28125)
  const qx = ix > 0x3fe90000 ? 0.28125 : fromWords(ix - 0x00200000, 0);
  const hz = 0.5 * z - qx;
  const a = 1 - qx;
  return a - (hz - (z * r - x * y));
}

// ---- x - n pi/2 ------------------------------------------------------------------------------------------------------

const INVPIO2 = 6.36619772367581382433e-01; // 0x3FE45F30 0x6DC9C883: 2/pi, 53 bits
// pi/2 in three parts of 33 bits (each times n is exact for n < 2^20), and what is left after one, two and three
const PIO2_1 = 1.57079632673412561417e+00; // 0x3FF921FB 0x54400000
const PIO2_1T = 6.07710050650619224932e-11; // 0x3DD0B461 0x1A626331
const PIO2_2 = 6.07710050630396597660e-11; // 0x3DD0B461 0x1A600000
const PIO2_2T = 2.02226624879595063154e-21; // 0x3BA3198A 0x2E037073
const PIO2_3 = 2.02226624871116645580e-21; // 0x3BA3198A 0x2E000000
const PIO2_3T = 8.47842766036889956997e-32; // 0x397B839A 0x252049C1

/** The high halves of n pi/2 for n = 1..32: an x close to one of them may lose bits in the reduction. */
const NPIO2_HW = [
  0x3ff921fb, 0x400921fb, 0x4012d97c, 0x401921fb, 0x401f6a7a, 0x4022d97c, 0x4025fdbb, 0x402921fb, 0x402c463a, 0x402f6a7a,
  0x4031475c, 0x4032d97c, 0x40346b9c, 0x4035fdbb, 0x40378fdb, 0x403921fb, 0x403ab41b, 0x403c463a, 0x403dd85a, 0x403f6a7a,
  0x40407e4c, 0x4041475c, 0x4042106c, 0x4042d97c, 0x4043a28c, 0x40446b9c, 0x404534ac, 0x4045fdbb, 0x4046c6cb, 0x40478fdb,
  0x404858eb, 0x404921fb,
];

/**
 * __ieee754_rem_pio2: x - n pi/2 as y[0] + y[1] (|y| <= pi/4), returns n (only n mod 4 matters). fdlibm's own way up to
 * |x| = 2^19 pi/2 (the fights' angles are far below); past that an exact reduction of the slow kind (remPio2Large).
 * (|x| <= pi/4 needs none: the callers take it themselves.)
 */
function remPio2(x: number, y: Float64Array): number {
  const hx = highWord(x);
  const ix = hx & 0x7fffffff;
  // (|x| < 3pi/4: n is 1 or -1; 33 + 53 bits of pi/2 are enough, but close to pi/2 itself 33 + 33 + 53)
  if (ix < 0x4002d97c) {
    if (hx > 0) {
      let z = x - PIO2_1;
      if (ix !== 0x3ff921fb) {
        y[0] = z - PIO2_1T;
        y[1] = (z - y[0]) - PIO2_1T;
      } else {
        z -= PIO2_2;
        y[0] = z - PIO2_2T;
        y[1] = (z - y[0]) - PIO2_2T;
      }
      return 1;
    }
    let z = x + PIO2_1;
    if (ix !== 0x3ff921fb) {
      y[0] = z + PIO2_1T;
      y[1] = (z - y[0]) + PIO2_1T;
    } else {
      z += PIO2_2;
      y[0] = z + PIO2_2T;
      y[1] = (z - y[0]) + PIO2_2T;
    }
    return -1;
  }
  if (ix > 0x413921fb) return remPio2Large(x, y);
  // (|x| <= 2^19 pi/2: the medium size)
  const t = Math.abs(x);
  const n = (t * INVPIO2 + 0.5) | 0;
  let r = t - n * PIO2_1;
  // (the first round is good to 85 bits)
  let w = n * PIO2_1T;
  if (n < 32 && ix !== NPIO2_HW[n - 1]) {
    // (no cancellation: x is not close to n pi/2)
    y[0] = r - w;
  } else {
    const j = ix >> 20;
    y[0] = r - w;
    let i = j - ((highWord(y[0]) >> 20) & 0x7ff);
    if (i > 16) {
      // (a second round, good to 118 bits)
      let u = r;
      w = n * PIO2_2;
      r = u - w;
      w = n * PIO2_2T - ((u - r) - w);
      y[0] = r - w;
      i = j - ((highWord(y[0]) >> 20) & 0x7ff);
      if (i > 49) {
        // (a third, 151 bits: enough for every case)
        u = r;
        w = n * PIO2_3;
        r = u - w;
        w = n * PIO2_3T - ((u - r) - w);
        y[0] = r - w;
      }
    }
  }
  y[1] = (r - y[0]) - w;
  if (hx < 0) {
    y[0] = -y[0];
    y[1] = -y[1];
    return -n;
  }
  return n;
}

// ---- past the medium size: exact, in whole numbers -------------------------------------------------------------------
// (never in a fight; here so that any argument gives the same result everywhere)

/** Bits of 2/pi kept: a double's exponent goes up to 971, and 300 bits are left after the point even then. */
const BITS = 1300;
let tables: { twoOverPi: bigint; pio2: bigint } | null = null;

/** 2/pi times 2^BITS, and pi/2 times 2^128 (made the first time they are needed: pi by Machin's formula). */
function reductionTables(): { twoOverPi: bigint; pio2: bigint } {
  if (tables) return tables;
  // pi = 16 atan(1/5) - 4 atan(1/239), times 2^g (64 bits more than needed: each term's rounding is far below)
  const g = BigInt(BITS + 64);
  const one = 1n << g;
  const atanInv = (k: bigint): bigint => {
    let sum = 0n;
    let sign = 1n;
    const k2 = k * k;
    for (let term = one / k, n = 1n; term !== 0n; term /= k2, n += 2n, sign = -sign) sum += sign * (term / n);
    return sum;
  };
  const pi = 16n * atanInv(5n) - 4n * atanInv(239n);
  tables = { twoOverPi: (1n << (g + BigInt(BITS) + 1n)) / pi, pio2: pi >> (g - 127n) };
  return tables;
}

/** v times 2^k (in steps that keep each power of two a normal double). */
function scaleBy(v: number, k: number): number {
  for (; k > 1000; k -= 1000) v *= fromWords((1000 + 1023) << 20, 0);
  for (; k < -1000; k += 1000) v *= fromWords((-1000 + 1023) << 20, 0);
  return v * fromWords((k + 1023) << 20, 0);
}

/** remPio2 for any finite |x| past 2^19 pi/2: x times 2/pi in whole numbers, its fraction times pi/2 as two doubles. */
function remPio2Large(x: number, y: Float64Array): number {
  const hx = highWord(x);
  const ix = hx & 0x7fffffff;
  if (ix >= 0x7ff00000) {
    // (infinite or NaN: the callers take these first)
    y[0] = y[1] = NaN;
    return 0;
  }
  const { twoOverPi, pio2 } = reductionTables();
  f64[0] = x;
  const lo = i32[LO] >>> 0;
  // |x| = m 2^e (x is a normal number this big)
  const e = (ix >>> 20) - 1075;
  const m = (BigInt((ix & 0xfffff) | 0x100000) << 32n) | BigInt(lo);
  // |x| 2/pi = p 2^-s: n is its nearest whole number, frac what is left (|frac| <= 2^(s-1))
  const s = BigInt(BITS - e);
  const p = m * twoOverPi;
  const n = (p + (1n << (s - 1n))) >> s;
  let frac = p - (n << s);
  const negative = frac < 0n;
  if (negative) frac = -frac;
  // frac 2^-s pi/2 = r 2^-(s + 128): its top 130 bits as a double and the rest (106 bits are plenty)
  const r = frac * pio2;
  const shift = Math.max(0, r.toString(2).length - 130);
  const top = r >> BigInt(shift);
  const head = Number(top);
  const tail = Number(top - BigInt(head));
  const k = shift - Number(s) - 128;
  y[0] = scaleBy(head, k);
  y[1] = scaleBy(tail, k);
  // (the sign of the rest, then of x)
  let q = Number(n & 3n);
  if (negative !== hx < 0) {
    y[0] = -y[0];
    y[1] = -y[1];
  }
  if (hx < 0) q = (4 - q) & 3;
  return q;
}

// ---- sin and cos -----------------------------------------------------------------------------------------------------

const reduced = new Float64Array(2);

/** sin(x), the same on every engine. */
export function detSin(x: number): number {
  const ix = highWord(x) & 0x7fffffff;
  // (|x| ~<= pi/4)
  if (ix <= 0x3fe921fb) return kernelSin(x, 0, 0);
  // (infinite or NaN)
  if (ix >= 0x7ff00000) return NaN;
  const y = reduced;
  switch (remPio2(x, y) & 3) {
    case 0: return kernelSin(y[0], y[1], 1);
    case 1: return kernelCos(y[0], y[1]);
    case 2: return -kernelSin(y[0], y[1], 1);
    default: return -kernelCos(y[0], y[1]);
  }
}

/** cos(x), the same on every engine. */
export function detCos(x: number): number {
  const ix = highWord(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) return kernelCos(x, 0);
  if (ix >= 0x7ff00000) return NaN;
  const y = reduced;
  switch (remPio2(x, y) & 3) {
    case 0: return kernelCos(y[0], y[1]);
    case 1: return -kernelSin(y[0], y[1], 1);
    case 2: return -kernelCos(y[0], y[1]);
    default: return kernelSin(y[0], y[1], 1);
  }
}
