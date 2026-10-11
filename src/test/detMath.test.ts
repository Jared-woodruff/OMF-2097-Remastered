// The fights' sine and cosine (util/detMath.ts): fdlibm's, the same to the last bit on every JavaScript engine (a
// network game between the Windows app and the macOS or Linux app plays the same fight in both). They agree with the
// engine's own to an ulp, and the expected bits below are what any engine must give.
import { describe, expect, it } from 'vitest';
import { detCos, detSin } from '../util/detMath';

const f64 = new Float64Array(1);
const u64 = new BigUint64Array(f64.buffer);

/** A double's bits, as hex. */
function bits(x: number): string {
  f64[0] = x;
  return u64[0].toString(16).padStart(16, '0');
}

/** How many doubles apart two numbers are. */
function ulps(a: number, b: number): number {
  const order = (x: number) => {
    f64[0] = x;
    const v = u64[0];
    return v >> 63n ? -(v & 0x7fffffffffffffffn) : v;
  };
  const d = order(a) - order(b);
  return Number(d < 0n ? -d : d);
}

describe('the deterministic sine and cosine', () => {
  it('agree with the engine\'s own to an ulp over the fights\' angles', () => {
    // The Fire Pit's orbs (a few thousand radians at most in a long fight, either sign) and the spawn angles (whole
    // numbers), from a fixed sequence.
    const xs: number[] = [];
    let seed = 2097;
    for (let i = 0; i < 50000; i++) {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      xs.push((seed / 0x100000000 - 0.5) * 40000);
    }
    for (let i = -2000; i <= 2000; i++) xs.push(i, i / 64);
    let worst = 0;
    for (const x of xs) worst = Math.max(worst, ulps(detSin(x), Math.sin(x)), ulps(detCos(x), Math.cos(x)));
    expect(worst).toBeLessThanOrEqual(1);
  });

  it('give fdlibm\'s bits, whatever the engine', () => {
    const expected: [number, string, string][] = [
      [0.25, '3fcfaaeed4f31577', '3fef01549f7deea1'],
      [-0.5, 'bfdeaee8744b05f0', '3fec1528065b7d50'],
      [1, '3feaed548f090cee', '3fe14a280fb5068c'],
      [2, '3fed18f6ead1b446', 'bfdaa22657537205'],
      [3, '3fc210386db6d55b', 'bfefae04be85e5d2'],
      [17, 'bfeec3c4ac42882b', 'bfd19c46b07f58e7'],
      [-127, 'bfef1fc9173d3292', '3fcdbdf16c129974'],
      [255, 'bfe0345c3adeff43', 'bfeb97fdbc5b6f12'],
      [-381.25, '3fecc3eb695964d8', 'bfdc0a2d0abc0592'],
      // (cos 1000 is fdlibm's: an ulp from the nearest double to the true value, 3fe1ff026793f1bb)
      [1000, '3fea75cc150a206b', '3fe1ff026793f1bc'],
      [4321.123, 'bfefb2767a795fa9', 'bfc191bef0d36ed5'],
      [12345.678, 'bfe687d5890974a5', '3fe6b94c3bbe24b8'],
      [Math.PI / 2, '3ff0000000000000', '3c91a62633145c07'],
      [Math.PI, '3ca1a62633145c07', 'bff0000000000000'],
    ];
    for (const [x, sin, cos] of expected) {
      expect(bits(detSin(x)), `sin ${x}`).toBe(sin);
      expect(bits(detCos(x)), `cos ${x}`).toBe(cos);
    }
  });

  it('reduce any argument exactly, the huge ones too (never in a fight)', () => {
    const expected: [number, string, string][] = [
      [1e6, 'bfd6664b2568d867', '3fedf9df9906d32c'],
      [1e22, 'bfeb453ab76bf397', '3fe0be2cef01c8f4'],
    ];
    for (const [x, sin, cos] of expected) {
      expect(bits(detSin(x)), `sin ${x}`).toBe(sin);
      expect(bits(detCos(x)), `cos ${x}`).toBe(cos);
      expect(bits(detSin(-x)), `sin ${-x}`).toBe(bits(-detSin(x)));
      expect(detCos(-x)).toBe(detCos(x));
    }
    for (const x of [823550, 823551, 1e7, 1e10, 1e15, 2 ** 52 + 1, 1e100, 1e300, Number.MAX_VALUE]) {
      for (const v of [x, -x]) {
        expect(ulps(detSin(v), Math.sin(v)), `sin ${v}`).toBeLessThanOrEqual(1);
        expect(ulps(detCos(v), Math.cos(v)), `cos ${v}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('keep the signs of zero and say NaN for what has no sine', () => {
    expect(Object.is(detSin(-0), -0)).toBe(true);
    expect(Object.is(detSin(0), 0)).toBe(true);
    expect(detCos(-0)).toBe(1);
    for (const x of [NaN, Infinity, -Infinity]) {
      expect(detSin(x)).toBeNaN();
      expect(detCos(x)).toBeNaN();
    }
  });
});
