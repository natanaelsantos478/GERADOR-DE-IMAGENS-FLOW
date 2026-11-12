import { describe, expect, it } from 'vitest';
import { createRng, hashSeed, rngFrom, seedRng } from './rng';

describe('rng', () => {
  it('is deterministic for a seed and differs across seeds', () => {
    const a = createRng(42), b = createRng(42), c = createRng(43);
    const sa = Array.from({ length: 20 }, () => a.next());
    expect(Array.from({ length: 20 }, () => b.next())).toEqual(sa);
    expect(Array.from({ length: 20 }, () => c.next())).not.toEqual(sa);
  });

  it('state survives JSON round-trip mid-stream', () => {
    const a = createRng(7);
    for (let i = 0; i < 100; i++) a.next();
    const copy = JSON.parse(JSON.stringify(a.state));
    const b = createRng(copy);
    for (let i = 0; i < 50; i++) expect(b.next()).toBe(a.next());
  });

  it('produces values in range with a sane distribution', () => {
    const r = createRng(1);
    const buckets = new Array(10).fill(0);
    for (let i = 0; i < 100_000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      buckets[Math.floor(v * 10)]++;
    }
    for (const b of buckets) expect(Math.abs(b - 10_000)).toBeLessThan(500);
    for (let i = 0; i < 1000; i++) {
      const n = r.int(-3, 3);
      expect(Number.isInteger(n) && n >= -3 && n <= 3).toBe(true);
    }
    let sum = 0, sq = 0;
    for (let i = 0; i < 20_000; i++) {
      const x = r.normal(5, 2);
      sum += x;
      sq += x * x;
    }
    const mean = sum / 20_000;
    expect(mean).toBeCloseTo(5, 1);
    expect(Math.sqrt(sq / 20_000 - mean * mean)).toBeCloseTo(2, 1);
  });

  it('pick/shuffle/weightedIndex/chance behave', () => {
    const r = createRng(3);
    const arr = [1, 2, 3, 4, 5];
    expect(r.shuffle([...arr]).sort()).toEqual(arr);
    expect(arr).toContain(r.pick(arr));
    expect(() => r.pick([])).toThrow();
    expect(r.weightedIndex([0, 0])).toBe(-1);
    for (let i = 0; i < 100; i++) expect(r.weightedIndex([0, 1, 0])).toBe(1);
    expect(r.chance(0)).toBe(false);
    expect(r.chance(1)).toBe(true);
  });

  it('rngFrom reads the state through the getter (swap on load)', () => {
    let st = seedRng(5);
    const r = rngFrom(() => st);
    const first = r.next();
    st = seedRng(5);
    expect(r.next()).toBe(first);
  });

  it('fork gives an independent deterministic stream', () => {
    const a = createRng(9), b = createRng(9);
    expect(a.fork()).toEqual(b.fork());
    expect(a.next()).toBe(b.next());
    expect(hashSeed('BRA')).toBe(hashSeed('BRA'));
    expect(hashSeed('BRA')).not.toBe(hashSeed('ARG'));
  });
});
