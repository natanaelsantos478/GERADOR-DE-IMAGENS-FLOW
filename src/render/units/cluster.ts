/** Screen-space grouping of unit icons with `supercluster`: used by the strategic markers (far and near) and by the tactical battle. */
import Supercluster from 'supercluster';

export interface ClusterItem<T = unknown> { x: number; y: number; side: string; kind: string; weight: number; ref: T }
export interface ClusterGroup<T = unknown> { side: string; /** most frequent kind (by weight) */ kind: string; members: ClusterItem<T>[]; /** mean screen position */ x: number; y: number; count: number }
export interface ClusterResult<T = unknown> { groups: ClusterGroup<T>[]; singles: ClusterItem<T>[] }

// supercluster works on lon/lat in a mercator world; screen pixels are mapped linearly into that world at zoom Z (world = 512 * 2^Z px)
const Z = 4, WORLD = 512 * 2 ** Z;
const toLng = (px: number) => (px / WORLD - 0.5) * 360;
const toLat = (py: number) => (360 / Math.PI) * Math.atan(Math.exp(((0.5 - py / WORLD) * 2 * Math.PI))) - 90;
interface Props { i: number; kw: Record<string, number> }

/**
 * Groups items closer than `radiusPx` on screen (per side). Groups have >= `minCount` members; everything else stays single.
 * Pure function of the screen positions: the same view always gives the same groups, and zooming in (positions spreading) dissolves them.
 */
export function clusterScreen<T>(items: ClusterItem<T>[], radiusPx = 46, minCount = 2): ClusterResult<T> {
  const out: ClusterResult<T> = { groups: [], singles: [] };
  const bySide = new Map<string, ClusterItem<T>[]>();
  for (const it of items) (bySide.get(it.side) ?? bySide.set(it.side, []).get(it.side)!).push(it);
  for (const [side, list] of bySide) {
    if (list.length < minCount) { out.singles.push(...list); continue; }
    const idx = new Supercluster<Props, Props>({
      radius: radiusPx, extent: 512, minZoom: Z, maxZoom: Z,
      map: (p) => ({ i: p.i, kw: p.kw }),
      reduce: (acc, p) => { for (const k in p.kw) acc.kw[k] = (acc.kw[k] ?? 0) + p.kw[k]; },
    });
    idx.load(list.map((it, i) => ({ type: 'Feature' as const, properties: { i, kw: { [it.kind]: it.weight } }, geometry: { type: 'Point' as const, coordinates: [toLng(it.x), toLat(it.y)] } })));
    for (const f of idx.getClusters([-180, -85, 180, 85], Z)) {
      const p = f.properties as Props & { cluster?: boolean; cluster_id?: number; point_count?: number };
      if (!p.cluster) { out.singles.push(list[p.i]); continue; }
      const members = idx.getLeaves(p.cluster_id!, Infinity).map((l) => list[(l.properties as Props).i]);
      if (members.length < minCount) { out.singles.push(...members); continue; }
      let kind = members[0].kind, best = -1;
      for (const [k, w] of Object.entries(p.kw)) if (w > best) { best = w; kind = k; }
      let x = 0, y = 0;
      for (const m of members) { x += m.x; y += m.y; }
      out.groups.push({ side, kind, members, x: x / members.length, y: y / members.length, count: members.length });
    }
  }
  return out;
}
