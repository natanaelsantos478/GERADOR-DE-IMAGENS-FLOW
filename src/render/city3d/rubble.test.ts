import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { collapsePose, generateRubble, inRing, RUBBLE_BY, RUBBLE_MATS, rubbleHeight, validateRubble, type RubbleInput } from './rubble';

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
        expect(r.tris).toBe(r.pieces.length * 12 + r.mound.pts.length * 5);
        expect(r.tris).toBeLessThanOrEqual(s.maxPieces * 12 + 60);
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
    for (const [px, py] of r.mound.pts) expect(Math.hypot(px, py)).toBeLessThanOrEqual(r.radius + 1e-6);
    for (const p of r.pieces) {
      expect(inRing(box(30, 20, 5, 5), r.cx + p.x, r.cy + p.y) || Math.hypot(p.x, p.y) < 12).toBe(true);
      expect(p.z).toBeLessThanOrEqual(r.height * 1.05 + p.sz);
      expect(p.z).toBeGreaterThan(0);
    }
  });
  it('handles an L-shaped (concave) footprint and a degenerate sliver without NaN', () => {
    const L = [0, 0, 20, 0, 20, 8, 8, 8, 8, 20, 0, 20];
    for (const ring of [L, box(40, 0.4)]) {
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
