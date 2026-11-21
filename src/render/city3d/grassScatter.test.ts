import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CELL, hash3, pickRule, scatterGrass, tuftVertices, validateGrass, type GrassRule } from './grassScatter';

const rules: GrassRule[] = [
  { id: 'dry', match: { cover: ['grass'], maxAbsLat: 30 }, density: 1, height: [0.2, 0.4], radius: 0.3, blades: 6, colors: [[120, 120, 60]], tip: 0.3 },
  { id: 'any', match: {}, density: 1, height: [0.2, 0.4], radius: 0.3, blades: 6, colors: [[80, 130, 50], [90, 140, 60]], tip: 0.3 },
];
const base = { cx: 0, cy: 0, radius: 60, half: 700, seed: 123, maxTufts: 100000, fadeFrom: 0.5, rules, accept: () => 1 };

describe('grass distribution', () => {
  it('is deterministic: same input, same tufts', () => {
    const a = scatterGrass(base), b = scatterGrass(base);
    expect(a.length).toBeGreaterThan(1000);
    expect(b).toEqual(a);
  });
  it('does not depend on where the camera was before: a point has the same tufts from another camera position when both discs cover it', () => {
    const a = scatterGrass({ ...base, cx: 0, cy: 0, radius: 40, fadeFrom: 1 }), b = scatterGrass({ ...base, cx: 10, cy: 5, radius: 40, fadeFrom: 1 });
    const key = (t: { x: number; y: number }) => `${t.x.toFixed(4)},${t.y.toFixed(4)}`;
    const inB = new Set(b.map(key));
    const common = a.filter((t) => Math.hypot(t.x - 10, t.y - 5) < 28 && Math.hypot(t.x, t.y) < 28);
    expect(common.length).toBeGreaterThan(100);
    expect(common.every((t) => inB.has(key(t)))).toBe(true);
  });
  it('a different seed (another tile) gives a different pattern', () => {
    expect(scatterGrass({ ...base, seed: 124 })).not.toEqual(scatterGrass(base));
  });
  it('density follows the rule: about density * area tufts at full density', () => {
    const n = scatterGrass({ ...base, radius: 30, fadeFrom: 1 }).length, area = Math.PI * 30 * 30;
    expect(n / area).toBeGreaterThan(0.8);
    expect(n / area).toBeLessThan(1.25);
  });
  it('thins out with the distance: more tufts in the inner half than in the outer ring per area', () => {
    const t = scatterGrass({ ...base, radius: 100, fadeFrom: 0.3 });
    const inner = t.filter((q) => Math.hypot(q.x, q.y) < 30).length / (Math.PI * 30 * 30), outer = t.filter((q) => Math.hypot(q.x, q.y) > 70).length / (Math.PI * (100 * 100 - 70 * 70));
    expect(inner).toBeGreaterThan(outer * 2);
  });
  it('never exceeds the budget and keeps the nearest cells', () => {
    const t = scatterGrass({ ...base, maxTufts: 500 });
    expect(t.length).toBe(500);
    expect(Math.max(...t.map((q) => Math.hypot(q.x, q.y)))).toBeLessThan(25);
  });
  it('only where accepted: nothing on rejected ground (road, water, building...)', () => {
    const t = scatterGrass({ ...base, accept: (x, y) => (x > 0 && y > 0 ? 0 : -1) });
    expect(t.length).toBeGreaterThan(100);
    expect(t.every((q) => q.x > 0 && q.y > 0)).toBe(true);
    expect(scatterGrass({ ...base, accept: () => -1 })).toEqual([]);
  });
  it('radius 0 or a budget of 0 (low profile) gives nothing', () => {
    expect(scatterGrass({ ...base, radius: 0 })).toEqual([]);
    expect(scatterGrass({ ...base, maxTufts: 0 })).toEqual([]);
  });
  it('stays inside the tile', () => {
    const t = scatterGrass({ ...base, half: 40, cx: 30, cy: 30, radius: 50 });
    expect(t.every((q) => Math.abs(q.x) < 40 && Math.abs(q.y) < 40)).toBe(true);
  });
  it('each tuft has valid size and colour from its rule', () => {
    const t = scatterGrass(base);
    for (const q of t.slice(0, 200)) { expect(q.h).toBeGreaterThanOrEqual(0.2); expect(q.h).toBeLessThanOrEqual(0.4); expect(q.blades).toBe(6); expect(rules[q.rule].colors).toContainEqual(q.color); }
  });
  it('CELL and hash are stable', () => {
    expect(CELL).toBe(3);
    expect(hash3(1, 2, 3)).toBe(hash3(1, 2, 3));
    expect(hash3(1, 2, 3)).not.toBe(hash3(2, 1, 3));
  });
});

describe('grass rules', () => {
  it('first match wins, catch-all last', () => {
    expect(pickRule(rules, { cover: 'grass', absLat: 20, elev: 10 })).toBe(0);
    expect(pickRule(rules, { cover: 'grass', absLat: 45, elev: 10 })).toBe(1);
    expect(pickRule(rules, { cover: 'park', absLat: 20, elev: 10 })).toBe(1);
  });
  it('the shipped pattern file is valid and every profile is consistent', () => {
    const g = validateGrass(JSON.parse(readFileSync('public/data/styles/grass.json', 'utf8')));
    expect(g.profiles.low.radius).toBe(0); // off in the low profile
    expect(g.profiles.mobile.radius).toBeLessThanOrEqual(50);
    expect(g.profiles.high.radius).toBeLessThanOrEqual(120);
    expect(pickRule(g.rules, { cover: 'grass', absLat: 48, elev: 100 })).toBe(g.rules.length - 1);
  });
  it('rejects broken patterns with a clear message', () => {
    const ok = JSON.parse(readFileSync('public/data/styles/grass.json', 'utf8'));
    expect(() => validateGrass({ ...ok, version: 2 })).toThrow(/version/);
    expect(() => validateGrass({ ...ok, rules: ok.rules.slice(0, 2) })).toThrow(/catch-all/);
    expect(() => validateGrass({ ...ok, rules: [{ ...ok.rules[5], colors: [[1, 2]] }] })).toThrow(/colors/);
  });
});

describe('tuft vertices', () => {
  it('3 vertices per blade, base on the ground, tip at the blade height, sway weight 0 at the base and 1 at the tip', () => {
    const j = (n: number) => hash3(n, 5, 1) * 2 - 1;
    const v = tuftVertices({ x: 5, y: 7, yaw: 0.3, h: 0.4, r: 0.3, rule: 0, color: [100, 140, 60], blades: 6 }, 0.3, 10, j);
    expect(v.p.length).toBe(6 * 9);
    expect(v.w.slice(0, 3)).toEqual([0, 0, 1]);
    for (let b = 0; b < 6; b++) { expect(v.p[b * 9 + 2]).toBeLessThan(10); expect(v.p[b * 9 + 8]).toBeGreaterThan(10.1); expect(v.p[b * 9 + 8]).toBeLessThanOrEqual(10.41); }
  });
});
