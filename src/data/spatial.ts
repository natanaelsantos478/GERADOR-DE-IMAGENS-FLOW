/** Province polygon index: rbush over each polygon part's bbox + exact point-in-polygon. */
import RBush from 'rbush';
import type { GeoFeatureCollection } from '../core/world-types';
import { bboxAround, bboxOfFlat, distanceToRingKm, flattenRing, normalizeLon, pointInPolygon } from '../core/geo';

interface Part {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** Index of the owning feature in the id list. */
  owner: number;
  /** Outer ring first, then holes. */
  rings: Float64Array[];
}

export interface PolygonIndex {
  ids: string[];
  /** Id whose polygon contains the point, or null. */
  locate(lon: number, lat: number): string | null;
  /**
   * Containing id, else the id with the nearest border within `maxKm`. `prefer` (optional) is
   * consulted for border candidates: the nearest preferred id wins if within `maxKm`.
   */
  nearest(lon: number, lat: number, maxKm: number, prefer?: (id: string) => boolean): string | null;
  /** Id (among those accepted by `filter`) whose outer border is nearest within `maxKm`, ignoring containment. */
  nearestBorder(lon: number, lat: number, maxKm: number, filter?: (id: string) => boolean): string | null;
}

export function buildPolygonIndex(fc: GeoFeatureCollection, file: string): PolygonIndex {
  if (!fc || fc.type !== 'FeatureCollection' || !Array.isArray(fc.features)) throw new Error(`public/data/${file}: FeatureCollection inválida`);
  const ids: string[] = [];
  const parts: Part[] = [];
  for (const f of fc.features) {
    const id = f.properties?.id;
    if (typeof id !== 'string') throw new Error(`public/data/${file}: feature sem properties.id`);
    const owner = ids.length;
    ids.push(id);
    const g = f.geometry;
    if (!g) continue;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    for (const poly of polys) {
      if (!poly.length || poly[0].length < 3) continue;
      const rings = poly.map((r) => flattenRing(r));
      const [w, s, e, n] = bboxOfFlat(rings[0]);
      parts.push({ minX: w, minY: s, maxX: e, maxY: n, owner, rings });
    }
  }
  const tree = new RBush<Part>();
  tree.load(parts);

  const locate = (lonIn: number, lat: number): string | null => {
    const lon = normalizeLon(lonIn);
    const cands = tree.search({ minX: lon, minY: lat, maxX: lon, maxY: lat });
    let hit = -1;
    for (const p of cands) {
      // Lowest owner index wins if parts overlap (deterministic).
      if ((hit < 0 || p.owner < hit) && pointInPolygon(lon, lat, p.rings)) hit = p.owner;
    }
    return hit >= 0 ? ids[hit] : null;
  };

  const nearestBorder = (lonIn: number, lat: number, maxKm: number, filter?: (id: string) => boolean): string | null => {
    const lon = normalizeLon(lonIn);
    const [w, s, e, n] = bboxAround(lon, lat, maxKm);
    let best = -1, bestKm = Infinity;
    for (const p of tree.search({ minX: w, minY: s, maxX: e, maxY: n })) {
      if (filter && !filter(ids[p.owner])) continue;
      const d = distanceToRingKm(lon, lat, p.rings[0]);
      if (d <= maxKm && (d < bestKm || (d === bestKm && p.owner < best))) {
        bestKm = d;
        best = p.owner;
      }
    }
    return best >= 0 ? ids[best] : null;
  };

  return {
    ids,
    locate,
    nearestBorder,
    nearest(lon, lat, maxKm, prefer) {
      const inside = locate(lon, lat);
      if (inside !== null) return inside;
      return (prefer && nearestBorder(lon, lat, maxKm, prefer)) || nearestBorder(lon, lat, maxKm);
    },
  };
}
