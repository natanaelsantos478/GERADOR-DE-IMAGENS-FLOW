/** Build a TacticalMap (~8x8 km) around a lon/lat from the real world data. */
import type { LonLat, WorldStatic } from '../../core/contracts';
import { hashSeed } from '../../core/rng';
import type { TacticalMap } from './types';

export interface MapOptions {
  sizeM?: number;
  n?: number;
  /** Real terrain heights sampled by the renderer (n*n, row-major from the SOUTH-west cell, metres). Replaces the elevation model. */
  heights?: number[];
}

const M_PER_DEG = 111_320;
const hash2 = (seed: number, x: number, y: number) => {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ seed;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b); h ^= h >>> 13;
  return ((h >>> 0) % 100000) / 100000;
};
function vnoise(seed: number, x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash2(seed, xi, yi), b = hash2(seed, xi + 1, yi), c = hash2(seed, xi, yi + 1), d = hash2(seed, xi + 1, yi + 1);
  return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
}

/**
 * Macro elevation comes from the real 0.25° grid; meso relief (fractal noise scaled by the province
 * ruggedness) refines it because the grid is ~28 km per cell; cities, roads and sea come from real data.
 * Forest/scrub patches are procedural (no land-cover dataset), denser in rugged, non-arid terrain.
 */
export function buildMapFromWorld(world: WorldStatic, lon: number, lat: number, opts: MapOptions = {}): TacticalMap {
  const sizeM = opts.sizeM ?? 8000, n = opts.n ?? 64, cs = sizeM / n;
  const mPerLon = M_PER_DEG * Math.cos((lat * Math.PI) / 180);
  const seed = hashSeed(`${lon.toFixed(3)},${lat.toFixed(3)}`);
  const prov = world.nearestProvince(lon, lat, 150);
  const rugged = prov ? (world.provinceById.get(prov)?.rugged ?? 0.3) : 0.3;
  const amp = 8 + rugged * 160;
  const N = n * n;
  const heights = new Array<number>(N), cover = new Array<number>(N).fill(0), road = new Array<number>(N).fill(0), water = new Array<number>(N).fill(0);
  const ll = (cx: number, cy: number): LonLat => [lon + ((cx + 0.5) * cs - sizeM / 2) / mPerLon, lat + ((cy + 0.5) * cs - sizeM / 2) / M_PER_DEG];
  for (let cy = 0; cy < n; cy++) for (let cx = 0; cx < n; cx++) {
    const i = cy * n + cx;
    const [lo, la] = ll(cx, cy);
    const base = opts.heights ? opts.heights[i] : Math.max(0, world.elevationAt(lo, la));
    const rel = opts.heights ? 0 : (vnoise(seed, cx / 12, cy / 12) * 0.65 + vnoise(seed + 1, cx / 5, cy / 5) * 0.25 + vnoise(seed + 2, cx / 2.2, cy / 2.2) * 0.1 - 0.5) * 2 * amp;
    heights[i] = base + rel;
    if (world.isSea(lo, la) && base <= 1) water[i] = 1;
    const f = vnoise(seed + 3, cx / 7, cy / 7);
    if (f > 0.62 - rugged * 0.12 && !water[i]) cover[i] = 1;
  }
  // real cities -> urban footprints
  const cities = world.cities;
  for (let ci = 0; ci < cities.length; ci++) {
    const c = cities[ci];
    const dx = (c.lon - lon) * mPerLon, dy = (c.lat - lat) * M_PER_DEG;
    const rad = 250 + Math.sqrt(c.pop) * 1.1;
    if (Math.abs(dx) > sizeM / 2 + rad || Math.abs(dy) > sizeM / 2 + rad) continue;
    for (let cy = 0; cy < n; cy++) for (let cx = 0; cx < n; cx++) {
      const px = (cx + 0.5) * cs - sizeM / 2, py = (cy + 0.5) * cs - sizeM / 2;
      if (Math.hypot(px - dx, py - dy) < rad * (0.75 + 0.5 * hash2(seed + 4, cx, cy))) { cover[cy * n + cx] = 2; water[cy * n + cx] = 0; }
    }
  }
  // real roads: rasterize polylines crossing the window
  const rg = world.roads;
  const loMin = lon - sizeM / 2 / mPerLon, loMax = lon + sizeM / 2 / mPerLon, laMin = lat - sizeM / 2 / M_PER_DEG, laMax = lat + sizeM / 2 / M_PER_DEG;
  for (let e = 0; e < rg.edgeCount; e++) {
    if (rg.edgeCls[e] > 2) continue;
    const s = rg.edgeGeomStart[e], len = rg.edgeGeomLen[e];
    for (let k = 0; k + 1 < len; k++) {
      const ax = rg.geom[(s + k) * 2], ay = rg.geom[(s + k) * 2 + 1], bx = rg.geom[(s + k + 1) * 2], by = rg.geom[(s + k + 1) * 2 + 1];
      if ((ax < loMin && bx < loMin) || (ax > loMax && bx > loMax) || (ay < laMin && by < laMin) || (ay > laMax && by > laMax)) continue;
      const lenM = Math.hypot((bx - ax) * mPerLon, (by - ay) * M_PER_DEG), steps = Math.max(1, Math.ceil(lenM / (cs * 0.4)));
      for (let q = 0; q <= steps; q++) {
        const x = ((ax + (bx - ax) * (q / steps) - lon) * mPerLon) + sizeM / 2, y = ((ay + (by - ay) * (q / steps) - lat) * M_PER_DEG) + sizeM / 2;
        if (x < 0 || y < 0 || x >= sizeM || y >= sizeM) continue;
        const i = Math.floor(y / cs) * n + Math.floor(x / cs);
        road[i] = 1; water[i] = 0;
      }
    }
  }
  return { sizeM, n, heights: heights.map((h) => Math.round(h * 10) / 10), cover, road, water };
}

/** Three control points: centre, plus two flank points in the defender's half (moved to passable cells). */
export function defaultObjectives(map: TacticalMap, attacker: 0 | 1): { name: string; x: number; y: number }[] {
  const dy = attacker === 0 ? 1 : -1, s = map.sizeM;
  const pts = [[0, 0], [-0.26 * s, dy * 0.2 * s], [0.26 * s, dy * 0.2 * s]];
  return pts.map(([x, y], i) => {
    let best = [x, y], bd = 1e18;
    const cs = map.sizeM / map.n;
    for (let c = 0; c < map.n * map.n; c++) {
      if (map.water[c]) continue;
      const cx = ((c % map.n) + 0.5) * cs - s / 2, cy = (Math.floor(c / map.n) + 0.5) * cs - s / 2;
      const d = Math.hypot(cx - x, cy - y) - (map.cover[c] === 2 ? 150 : 0);
      if (d < bd) { bd = d; best = [cx, cy]; }
    }
    return { name: ['A', 'B', 'C'][i], x: best[0], y: best[1] };
  });
}
