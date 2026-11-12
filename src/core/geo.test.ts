import { describe, expect, it } from 'vitest';
import {
  alongPolyline, bboxAround, bboxContains, bboxIntersects, bboxOf, bearingDeg, destination, distanceKm, distanceToRingKm,
  flattenRing, greatCirclePoints, haversineKm, interpolateGreatCircle, normalizeLon, pointInPolygon, pointInRing,
} from './geo';
import type { LonLat } from './world-types';

const SP: LonLat = [-46.6333, -23.5505];
const RJ: LonLat = [-43.1729, -22.9068];

describe('geo', () => {
  it('haversine matches known distances', () => {
    expect(haversineKm(SP[0], SP[1], RJ[0], RJ[1])).toBeCloseTo(361, -1);
    expect(haversineKm(0, 0, 180, 0)).toBeCloseTo(Math.PI * 6371.0088, 3);
    expect(haversineKm(10, 10, 10, 10)).toBe(0);
  });

  it('bearing and destination are inverse', () => {
    expect(bearingDeg([0, 0], [0, 10])).toBeCloseTo(0);
    expect(bearingDeg([0, 0], [10, 0])).toBeCloseTo(90);
    const b = bearingDeg(SP, RJ);
    const d = distanceKm(SP, RJ);
    const p = destination(SP, b, d);
    expect(distanceKm(p, RJ)).toBeLessThan(0.01);
    const wrap = destination([179.5, 0], 90, 111.2);
    expect(wrap[0]).toBeCloseTo(-179.5, 1);
  });

  it('great-circle interpolation stays on the arc', () => {
    expect(interpolateGreatCircle(SP, RJ, 0)).toEqual([expect.closeTo(SP[0], 9), expect.closeTo(SP[1], 9)]);
    const mid = interpolateGreatCircle(SP, RJ, 0.5);
    expect(distanceKm(SP, mid)).toBeCloseTo(distanceKm(mid, RJ), 6);
    const pts = greatCirclePoints([0, 0], [90, 0], 9);
    expect(pts).toHaveLength(10);
    expect(pts[5][0]).toBeCloseTo(50);
    // Across the antimeridian the short way is taken.
    expect(Math.abs(interpolateGreatCircle([170, 0], [-170, 0], 0.5)[0])).toBeCloseTo(180);
  });

  it('walks along polylines', () => {
    const line: LonLat[] = [[0, 0], [1, 0], [1, 1]];
    const a = alongPolyline(line, 0);
    expect(a.pos).toEqual([0, 0]);
    const seg = distanceKm([0, 0], [1, 0]);
    const b = alongPolyline(line, seg + 1);
    expect(b.heading).toBeCloseTo(0);
    expect(b.done).toBe(false);
    expect(alongPolyline(line, 1e6).done).toBe(true);
  });

  it('bbox utilities', () => {
    const b = bboxOf([[0, 0], [2, -1], [1, 3]]);
    expect(b).toEqual([0, -1, 2, 3]);
    expect(bboxContains(b, 1, 1)).toBe(true);
    expect(bboxContains(b, 3, 1)).toBe(false);
    expect(bboxIntersects(b, [2, 3, 5, 5])).toBe(true);
    expect(bboxIntersects(b, [2.1, 3, 5, 5])).toBe(false);
    const around = bboxAround(0, 60, 111.2);
    expect(around[3] - 60).toBeCloseTo(1, 2);
    expect(around[2]).toBeCloseTo(2, 1);
    expect(normalizeLon(190)).toBe(-170);
    expect(normalizeLon(-190)).toBe(170);
  });

  it('point in polygon with holes and distance to ring', () => {
    const outer = flattenRing([[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]);
    const hole = flattenRing([[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]);
    expect(pointInRing(5, 5, outer)).toBe(true);
    expect(pointInPolygon(5, 5, [outer, hole])).toBe(false);
    expect(pointInPolygon(2, 2, [outer, hole])).toBe(true);
    expect(pointInPolygon(11, 2, [outer, hole])).toBe(false);
    expect(distanceToRingKm(11, 5, outer)).toBeCloseTo(110.8, 0);
  });
});
