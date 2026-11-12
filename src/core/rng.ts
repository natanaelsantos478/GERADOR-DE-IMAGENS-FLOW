/**
 * Deterministic PRNG (sfc32) whose whole state is four uint32 stored as plain JSON in GameState.
 * `Rng` is a stateless view over a state getter, so swapping `state` on load keeps working.
 */

export interface RngState {
  a: number;
  b: number;
  c: number;
  d: number;
}

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [min, max] (inclusive). */
  int(min: number, max: number): number;
  /** Uniform float in [min, max). */
  float(min: number, max: number): number;
  /** True with probability p. */
  chance(p: number): boolean;
  /** Random element (throws on empty array). */
  pick<T>(arr: readonly T[]): T;
  /** Fisher–Yates in place; returns the same array. */
  shuffle<T>(arr: T[]): T[];
  /** Gaussian (Box–Muller). */
  normal(mean?: number, sd?: number): number;
  /** Index drawn proportionally to non-negative weights; −1 if all are 0. */
  weightedIndex(weights: readonly number[]): number;
  /** A new independent state derived from this stream (advances it). */
  fork(): RngState;
}

/** splitmix32 — expands a seed into well-mixed words. */
function splitmix32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    return (z ^ (z >>> 16)) >>> 0;
  };
}

export function seedRng(seed: number): RngState {
  const sm = splitmix32(Number.isFinite(seed) ? Math.floor(seed) : 0);
  const st: RngState = { a: sm(), b: sm(), c: sm(), d: sm() };
  // Discard the first outputs (sfc32 recommendation).
  for (let i = 0; i < 12; i++) nextU32(st);
  return st;
}

/** Hash a string into a 32-bit seed (FNV-1a). */
export function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function nextU32(s: RngState): number {
  const a = s.a >>> 0, b = s.b >>> 0, c = s.c >>> 0, d = s.d >>> 0;
  const t = (((a + b) >>> 0) + d) >>> 0;
  s.d = (d + 1) >>> 0;
  s.a = (b ^ (b >>> 9)) >>> 0;
  s.b = (c + (c << 3)) >>> 0;
  const cr = ((c << 21) | (c >>> 11)) >>> 0;
  s.c = (cr + t) >>> 0;
  return t;
}

/** Rng view over a state obtained from `get` on every call. */
export function rngFrom(get: () => RngState): Rng {
  const next = () => nextU32(get()) / 4294967296;
  const rng: Rng = {
    next,
    int(min, max) {
      if (max < min) throw new Error(`rng.int: max ${max} < min ${min}`);
      return min + Math.floor(next() * (Math.floor(max) - Math.ceil(min) + 1));
    },
    float: (min, max) => min + next() * (max - min),
    chance: (p) => next() < p,
    pick(arr) {
      if (arr.length === 0) throw new Error('rng.pick: empty array');
      return arr[Math.floor(next() * arr.length)];
    },
    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        const t = arr[i];
        arr[i] = arr[j];
        arr[j] = t;
      }
      return arr;
    },
    normal(mean = 0, sd = 1) {
      const u = 1 - next();
      const v = next();
      return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    weightedIndex(weights) {
      let total = 0;
      for (const w of weights) if (w > 0) total += w;
      if (total <= 0) return -1;
      let r = next() * total;
      for (let i = 0; i < weights.length; i++) {
        const w = weights[i];
        if (w <= 0) continue;
        if (r < w) return i;
        r -= w;
      }
      for (let i = weights.length - 1; i >= 0; i--) if (weights[i] > 0) return i;
      return -1;
    },
    fork() {
      const s = get();
      return seedRng((nextU32(s) ^ Math.imul(nextU32(s), 0x27d4eb2d)) >>> 0);
    },
  };
  return rng;
}

/** Convenience: an Rng owning its own state object (tests, tactical sub-sims). */
export function createRng(seedOrState: number | RngState): Rng & { state: RngState } {
  const state = typeof seedOrState === 'number' ? seedRng(seedOrState) : seedOrState;
  return Object.assign(rngFrom(() => state), { state });
}
