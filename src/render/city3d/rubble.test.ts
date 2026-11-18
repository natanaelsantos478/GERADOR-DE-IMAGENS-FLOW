import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { collapsePose, generateRubble, triangles, inRing, RUBBLE_BY, RUBBLE_MATS, rubbleHeight, validateRubble, type RubbleInput } from './rubble';

const spec = validateRubble(JSON.parse(readFileSync('public/data/styles/rubble.json', 'utf8')));
const box = (w: number, d: number, x = 0, y = 0) => [x - w / 2, y - d / 2, x + w / 2, y - d / 2, x + w / 2, y + d / 2, x - w / 2, y + d / 2];
const input = (o: Partial<RubbleInput> = {}): RubbleInput => ({ id: 17, mat: 'brick', fl: 3, ring: box(20, 14, 50, 80), ...o });

describe('rubble pattern (public/data/styles/rubble.json)', () => {
  it('shipped pattern validates and covers every material and cause', () => {
    for (const m of RUBBLE_MATS) expect(spec.materials[m].pieces.length).toBeGreaterThan(0);
    for (const b of RUBBLE_BY) expect(spec.collapse[b].duration).toBeGreaterThanOrEqual(0.5);
  });
  it('rejects bad edits with a readable error', () => {
    const raw = () => JSON.parse(readFileSync('public/data/styles/rubble.json', 'utf8'));
    const a = raw(); delete a.materials.brick; expect(() => validateRubble(a)).toThrow(/materials.brick/);
    const b = raw(); b.materials.light.palette = [[1, 2]]; expect(() => validateRubble(b)).toThrow(/palette/);
    const c = raw(); c.collapse.bomb.duration = 0; expect(() => validateRubble(c)).toThrow(/duration/);
    const d = raw(); d.materials.concrete.maxPieces = 5000; expect(() => validateRubble(d)).toThrow(/maxPieces/);
  });
});

describe('rubble generator', () => {
  it('is deterministic: same id and footprint give the identical model; another id differs', () => {
    const a = generateRubble(spec, input()), b = generateRubble(spec, input());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(generateRubble(spec, input({ id: 18 })))).not.toBe(JSON.stringify(a));
  });
  it('is independent of where the footprint is (only relative geometry matters)', () => {
    const a = generateRubble(spec, input()), b = generateRubble(spec, input({ ring: box(20, 14, -300, 12) }));
    expect(b.pieces.map((p) => [p.kind, +p.x.toFixed(6), +p.y.toFixed(6), +p.z.toFixed(6)])).toEqual(a.pieces.map((p) => [p.kind, +p.x.toFixed(6), +p.y.toFixed(6), +p.z.toFixed(6)]));
  });
  it('keeps the triangle count bounded for every material, even for a skyscraper footprint', () => {
    for (const m of RUBBLE_MATS) {
      const s = spec.materials[m];
      for (const [fl, w, d] of [[1, 5, 5], [4, 20, 14], [40, 120, 90], [120, 400, 300]] as const) {
        const r = generateRubble(spec, input({ mat: m, fl, ring: box(w, d) }));
        expect(r.pieces.length).toBeLessThanOrEqual(s.maxPieces);
        expect(r.pieces.length).toBeGreaterThanOrEqual(s.minPieces);
        expect(r.tris).toBe(triangles(r.pieces.length, r.mound));
        expect(r.tris).toBeLessThanOrEqual(s.maxPieces * 12 + 200);
      }
    }
  });
  it('heap height grows with floors and with footprint, inside the material limits', () => {
    for (const m of RUBBLE_MATS) {
      const s = spec.materials[m];
      expect(rubbleHeight(s, 6, 200)).toBeGreaterThanOrEqual(rubbleHeight(s, 2, 200));
      expect(rubbleHeight(s, 4, 900)).toBeGreaterThanOrEqual(rubbleHeight(s, 4, 100));
      expect(rubbleHeight(s, 1, 10)).toBeGreaterThanOrEqual(s.minHeight);
      expect(rubbleHeight(s, 200, 5000)).toBeLessThanOrEqual(s.maxHeight);
    }
    const low = generateRubble(spec, input({ fl: 1, mat: 'brick' })), tall = generateRubble(spec, input({ fl: 5, mat: 'brick' }));
    expect(tall.height).toBeGreaterThan(low.height);
  });
  it('keeps the heap on the footprint and its pieces near the heap', () => {
    const r = generateRubble(spec, input({ ring: box(30, 20, 5, 5) }));
    for (const [px, py] of r.mound.pts) expect(Math.hypot(px, py)).toBeLessThanOrEqual(r.radius + r.spill + 1e-6);
    for (const p of r.pieces) {
      expect(inRing(box(30, 20, 5, 5), r.cx + p.x, r.cy + p.y) || Math.hypot(p.x, p.y) < r.radius + r.spill + 1).toBe(true);
      expect(p.z).toBeLessThanOrEqual(r.height * 1.05 + p.sz);
      expect(p.z).toBeGreaterThan(0);
    }
  });
  it('heap is 25-40% of the (capped) original height: house of 2 floors 2-3 m, 8-floor block 5-8 m', () => {
    const house = generateRubble(spec, input({ mat: 'brick', fl: 2, h: 6.4, ring: box(12, 10) }));
    expect(house.height).toBeGreaterThanOrEqual(2); expect(house.height).toBeLessThanOrEqual(3);
    const tower = generateRubble(spec, input({ mat: 'reinforced', fl: 8, h: 25.6, ring: box(30, 24) }));
    expect(tower.height).toBeGreaterThanOrEqual(5); expect(tower.height).toBeLessThanOrEqual(8);
    const sky = generateRubble(spec, input({ mat: 'reinforced', fl: 60, h: 220, ring: box(40, 40) }));
    expect(sky.height).toBeLessThanOrEqual(spec.materials.reinforced.maxHeight);
  });
  it('covers the whole footprint and overflows 1-3 m into the street', () => {
    const ring = box(16, 12), r = generateRubble(spec, input({ mat: 'concrete', fl: 4, ring }));
    expect(r.spill).toBeGreaterThanOrEqual(1); expect(r.spill).toBeLessThanOrEqual(3.01);
    // every footprint corner (within the fill) lies inside the heap outline; some of the heap is outside the footprint
    const inside = (x: number, y: number) => inRing(r.mound.pts.flat(), x, y);
    for (const [x, y] of [[-6, -4], [6, -4], [6, 4], [-6, 4], [0, 0]]) expect(inside(x * 0.8, y * 0.8)).toBe(true);
    expect(r.mound.pts.some(([x, y]) => !inRing(ring, r.cx + x, r.cy + y))).toBe(true);
    // the ground stain reaches beyond the heap everywhere
    r.decal.pts.forEach(([x, y], i) => expect(Math.hypot(x, y)).toBeGreaterThan(Math.hypot(...r.mound.pts[i]) + 1.5));
  });
  it('leaves standing wall fragments with a facade texture, vertical-ish and bigger than a loose block', () => {
    const r = generateRubble(spec, input({ mat: 'brick', fl: 4, h: 12.8, ring: box(20, 14) })), walls = r.pieces.filter((p) => p.kind === 'wall');
    expect(walls.length).toBeGreaterThanOrEqual(spec.materials.brick.walls.min);
    expect(walls.length).toBeLessThanOrEqual(spec.materials.brick.walls.max);
    for (const w of walls) { expect(w.tex).toMatch(/^facade_/); expect(w.sz).toBeGreaterThan(1.5); expect(w.sy).toBeGreaterThan(2); expect(Math.abs(w.pitch)).toBeLessThan(0.2); }
  });
  it('pieces are bigger than before: slabs of a concrete block reach several metres', () => {
    const r = generateRubble(spec, input({ mat: 'concrete', fl: 6, h: 19, ring: box(40, 30) }));
    expect(Math.max(...r.pieces.filter((p) => p.kind === 'slab').map((p) => p.sx))).toBeGreaterThan(3);
  });
  it('dust pattern: cloud lasts 8-15 s, residual smoke 30-60 s, bounded puff count', () => {
    expect(spec.dust.cloudLife).toEqual([8, 15]); expect(spec.dust.smokeTime).toEqual([30, 60]);
    expect(spec.dust.maxPuffs).toBeLessThanOrEqual(200);
    const bad = JSON.parse(readFileSync('public/data/styles/rubble.json', 'utf8')); delete bad.dust;
    expect(() => validateRubble(bad)).toThrow(/dust/);
  });
  it('handles an L-shaped (concave) footprint and a degenerate sliver without NaN', () => {
    const L = [0, 0, 20, 0, 20, 8, 8, 8, 8, 20, 0, 20];
    for (const ring of [L, box(40, 0.4), [0, 0, 12, 9]]) { // the last one: a 2-point 'ring' (degenerate footprint)
      const r = generateRubble(spec, input({ ring }));
      expect(JSON.stringify(r)).not.toMatch(/null|NaN/);
    }
  });
});

describe('collapse animation pose', () => {
  it('the building sinks monotonically to shrinkTo while the heap grows to full height', () => {
    for (const b of RUBBLE_BY) {
      const c = spec.collapse[b];
      let sink = 2, grow = -1;
      for (let i = 0; i <= 20; i++) {
        const p = collapsePose(c, i / 20, 3);
        expect(p.sink).toBeLessThanOrEqual(sink + 1e-9); expect(p.grow).toBeGreaterThanOrEqual(grow - 1e-9);
        sink = p.sink; grow = p.grow;
      }
      expect(collapsePose(c, 0).sink).toBe(1);
      expect(collapsePose(c, 1).sink).toBeCloseTo(c.shrinkTo, 6);
      expect(collapsePose(c, 1).grow).toBe(1);
      expect(Math.abs(collapsePose(c, 1).shx)).toBeLessThan(1e-9);
    }
  });
  it('a breach leans the wall further than a bomb and falls faster', () => {
    const b = collapsePose(spec.collapse.breach, 0.5), o = collapsePose(spec.collapse.bomb, 0.5);
    expect(b.tilt).toBeGreaterThan(o.tilt);
    expect(spec.collapse.breach.duration).toBeLessThan(spec.collapse.bomb.duration);
  });
});
