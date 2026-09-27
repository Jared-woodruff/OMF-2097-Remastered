/** Deterministic LCG identical to the reference engine (seed * 1664525 + 1013904223). */
export class Random {
  seed: number;

  constructor(seed = 1) {
    this.seed = seed >>> 0;
  }

  setSeed(seed: number): void {
    this.seed = seed >>> 0;
  }

  intmax(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed;
  }

  /** Uniform integer in [0, upperbound). */
  int(upperbound: number): number {
    const ub = upperbound >>> 0;
    if (ub === 0) return 0; // C would divide by zero; guard instead.
    return this.intmax() % ub;
  }

  float(): number {
    return this.intmax() / 0xffffffff;
  }

  clone(): Random {
    return new Random(this.seed);
  }
}

/** Global (non-simulation) random source, e.g. for menus and cosmetic effects. */
export const globalRandom = new Random(Date.now() >>> 0);

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
