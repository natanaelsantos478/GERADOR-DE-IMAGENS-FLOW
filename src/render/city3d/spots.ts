/**
 * Where a unit can stand in the loaded 3D city: on streets (land) or on taxiways / aprons (aircraft), inside military
 * areas first (barracks, bases), never inside a building footprint. Used by units/strategic.ts to place the 3D models
 * of a formation; null when no city tile covers the point (the caller then scatters them on open terrain).
 */
import * as Cesium from 'cesium';
import type { VectorArea, VPoly } from '../../data/vector/types';
import { badgeCanvas, svgImage } from '../units/common';
import { polyCentroid } from './buildings';
import { projector, tileXY, TZ, type TileRef } from './geo';
import type { Ground } from './ground';
import { inPolyEvenOdd } from './trees';

/** Icons over the hospitals, military areas (barracks, bases) and airfields of a city tile, visible over the buildings. */
export class PlaceMarks {
  private col: Cesium.BillboardCollection;
  private dead = false;
  count = 0;
  constructor(private scene: Cesium.Scene, tile: TileRef, area: VectorArea, ground: Ground) {
    this.col = scene.primitives.add(new Cesium.BillboardCollection({ scene })) as Cesium.BillboardCollection;
    const half = tile.sizeM / 2, proj = projector(tile), put: { x: number; y: number; k: string }[] = [];
    const add = (x: number, y: number, k: string, minGap: number) => {
      if (Math.abs(x) > half || Math.abs(y) > half || put.some((q) => q.k === k && Math.hypot(q.x - x, q.y - y) < minGap)) return;
      put.push({ x, y, k });
    };
    const big = (p: VPoly) => { const [x0, y0, x1, y1] = bbox(p); return (x1 - x0) * (y1 - y0); };
    const mil = area.landuse.filter((p) => p.cls === 'military');
    for (const p of area.landuse) {
      if (p.cls === 'airport' && big(p) > 40_000) {
        const [cx, cy] = polyCentroid(p);
        add(cx, cy, mil.some((m) => { const [mx, my] = polyCentroid(m); return inPolyEvenOdd(p, mx, my); }) ? 'airbase' : 'airport', 1500);
      }
    }
    for (const p of mil) if (big(p) > 2000) { const [cx, cy] = polyCentroid(p); add(cx, cy, 'military', 400); }
    for (const p of area.landuse) if (p.cls === 'hospital') { const [cx, cy] = polyCentroid(p); add(cx, cy, 'hospital', 200); }
    for (const b of area.buildings) if (b.kind === 'hospital' && big(b) > 300) { const [cx, cy] = polyCentroid(b); add(cx, cy, 'hospital', 200); }
    for (const q of area.pois) if (q.kind === 'hospital') add(q.x, q.y, 'hospital', 200);
    const LOOK: Record<string, [string, string]> = { hospital: ['hospital', '#e84545'], military: ['base', '#3fae4a'], airbase: ['airport', '#3fae4a'], airport: ['airport', '#6f8aa3'] };
    for (const q of put) {
      const [lon, lat] = proj.lonLat(q.x, q.y), [icon, ring] = LOOK[q.k];
      const b = this.col.add({
        position: Cesium.Cartesian3.fromDegrees(lon, lat, ground(q.x, q.y) + 30), width: 26, height: 26,
        disableDepthTestDistance: 6000, distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 8000), show: false,
      });
      void svgImage(icon, '#fff').then((g) => { if (this.dead) return; b.setImage(`${icon}|${ring}`, badgeCanvas(g, ring, 40)); b.show = true; this.scene.requestRender(); });
    }
    this.count = put.length;
  }
  dispose() { this.dead = true; this.scene.primitives.remove(this.col); }
}

export interface SpotTile { ref: TileRef; area: VectorArea | null; ground: Ground | null; state: string }
/** City tiles alive now (tile.ts adds/removes). */
export const LIVE = new Set<SpotTile>();
export interface Spot { lon: number; lat: number; h: number; hdg: number }

const NO_ROAD = /foot|path|steps|cycle|track|bridle|rail|pedestrian|corridor|ferry|sidewalk|crossing/;
const MAJOR = /motorway|trunk|primary|secondary|tertiary/;
const cache = new Map<string, Spot[] | null>();
let sig = '';

function bbox(p: VPoly) {
  const r = p.rings[0]; let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < r.length; i += 2) { x0 = Math.min(x0, r[i]); x1 = Math.max(x1, r[i]); y0 = Math.min(y0, r[i + 1]); y1 = Math.max(y1, r[i + 1]); }
  return [x0, y0, x1, y1];
}

/**
 * Up to `n` spots around lon/lat, at least `gap` m apart, within `radius` m.
 * `air`: taxiways, aprons and runways of the airfield instead of streets.
 */
export function streetSpots(lon: number, lat: number, n: number, gap: number, air = false, radius = 900): Spot[] | null {
  const ready = [...LIVE].filter((t) => t.state === 'ready' && t.area && t.ground);
  const s = ready.map((t) => t.ref.key).sort().join();
  if (s !== sig) { sig = s; cache.clear(); }
  const key = `${lon.toFixed(5)},${lat.toFixed(5)},${n},${gap},${air}`;
  if (cache.has(key)) return cache.get(key)!;
  const cand: { x: number; y: number; sc: number; hdg: number; t: SpotTile }[] = [];
  let covered = false;
  for (const t of ready) {
    const [gx, gy] = tileXY(lon, lat, TZ), half = t.ref.sizeM / 2;
    const px = (gx - (t.ref.x + 0.5)) * t.ref.sizeM, py = -(gy - (t.ref.y + 0.5)) * t.ref.sizeM;
    if (Math.abs(px) > half + radius || Math.abs(py) > half + radius) continue;
    if (Math.abs(px) <= half && Math.abs(py) <= half) covered = true;
    const a = t.area!, inTile = (x: number, y: number) => Math.abs(x) <= half && Math.abs(y) <= half;
    const near = (x0: number, y0: number, x1: number, y1: number) => x1 > px - radius && x0 < px + radius && y1 > py - radius && y0 < py + radius;
    // building footprints around the point, bucketed on a 40 m grid
    const cells = new Map<number, VPoly[]>(), C = 40, ck = (i: number, j: number) => i * 100003 + j;
    for (const b of a.buildings) {
      const [x0, y0, x1, y1] = bbox(b);
      if (!near(x0, y0, x1, y1)) continue;
      for (let i = Math.floor(x0 / C); i <= Math.floor(x1 / C); i++) for (let j = Math.floor(y0 / C); j <= Math.floor(y1 / C); j++) (cells.get(ck(i, j)) ?? cells.set(ck(i, j), []).get(ck(i, j))!).push(b);
    }
    const inBuilding = (x: number, y: number) => {
      for (const b of cells.get(ck(Math.floor(x / C), Math.floor(y / C))) ?? []) if (inPolyEvenOdd(b, x, y)) return true;
      return false;
    };
    const mil = a.landuse.filter((p) => p.cls === 'military' && near(...(bbox(p) as [number, number, number, number])));
    const inMil = (x: number, y: number) => mil.some((p) => inPolyEvenOdd(p, x, y));
    const lines = air ? a.aeroways : a.roads.filter((r) => !NO_ROAD.test(`${r.cls} ${r.sub ?? ''}`) && r.brunnel !== 'tunnel' && r.brunnel !== 'bridge');
    for (const r of lines) {
      const P = r.pts, pen = air ? (/taxi|apron/.test(r.cls + (r.sub ?? '')) ? 0 : 150) : MAJOR.test(r.cls + (r.sub ?? '')) ? 0 : 60;
      for (let i = 0; i + 3 < P.length; i += 2) {
        const x0 = P[i], y0 = P[i + 1], dx = P[i + 2] - x0, dy = P[i + 3] - y0, L = Math.hypot(dx, dy);
        if (L < 1) continue;
        const hdg = (Math.atan2(dx, dy) * 180) / Math.PI;
        for (let s = 0; s < L; s += 8) {
          const x = x0 + (dx * s) / L, y = y0 + (dy * s) / L, d = Math.hypot(x - px, y - py);
          if (d > radius || !inTile(x, y) || inBuilding(x, y)) continue;
          cand.push({ x, y, sc: d + pen - (inMil(x, y) ? 600 : 0), hdg, t });
        }
      }
    }
    // open ground inside military areas (parade grounds, motor pools)
    if (!air) for (const p of mil) {
      const [x0, y0, x1, y1] = bbox(p);
      for (let x = x0; x <= x1; x += 15) for (let y = y0; y <= y1; y += 15) {
        const d = Math.hypot(x - px, y - py);
        if (d > radius || !inTile(x, y) || !inPolyEvenOdd(p, x, y) || inBuilding(x, y)) continue;
        cand.push({ x, y, sc: d - 650, hdg: 0, t });
      }
    }
  }
  if (!covered) { cache.set(key, null); return null; }
  cand.sort((u, v) => u.sc - v.sc);
  const out: Spot[] = [], picked: { lon: number; lat: number }[] = [], g2 = gap * gap;
  const mPerDeg = 111_320, k = Math.cos((lat * Math.PI) / 180);
  for (const c of cand) {
    if (out.length >= n) break;
    const [lo, la] = projector(c.t.ref).lonLat(c.x, c.y);
    if (picked.some((q) => ((q.lon - lo) * k * mPerDeg) ** 2 + ((q.lat - la) * mPerDeg) ** 2 < g2)) continue;
    picked.push({ lon: lo, lat: la });
    out.push({ lon: lo, lat: la, h: c.t.ground!(c.x, c.y), hdg: c.hdg });
  }
  const res = out.length ? out : null;
  cache.set(key, res);
  return res;
}
