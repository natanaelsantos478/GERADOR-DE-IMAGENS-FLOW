import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolveModel, setVariants } from './variants';

const v = JSON.parse(readFileSync('public/models/variants.json', 'utf8'));
const mf = JSON.parse(readFileSync('public/models/manifest.json', 'utf8'));
beforeAll(() => setVariants(v));

describe('resolveModel', () => {
  it('USA mbt -> Abrams', () => expect(resolveModel('mbt', 'USA', 'f1', { mf })).toBe('mbt_m1abrams'));
  it('RUS mbt -> T-72/T-90', () => {
    const ids = new Set(Array.from({ length: 30 }, (_, i) => resolveModel('mbt', 'RUS', `f${i}`, { mf })));
    expect([...ids].every((x) => x === 'mbt_t72' || x === 'mbt_t90')).toBe(true);
    expect(ids.size).toBe(2);
  });
  it('country without entry -> class default', () => expect(resolveModel('ifv', 'ZZZ', 'f1', { mf })).toBe(v.ifv.default));
  it('REB and unknown generics -> generic', () => {
    expect(resolveModel('mbt', 'REB', 'f1', { mf })).toBe('mbt');
    expect(resolveModel('truck', 'USA', 'f1', { mf })).toBe('truck');
  });
  it('stable per seed', () => {
    expect(resolveModel('fighter', 'USA', 'abc', { mf })).toBe(resolveModel('fighter', 'USA', 'abc', { mf }));
  });
  it('needAnim only yields animated soldiers', () => {
    for (let i = 0; i < 20; i++) expect(mf[resolveModel('soldier', 'USA', `s${i}`, { mf, needAnim: true })].animations?.length ?? 0).toBeGreaterThan(0);
  });
});
