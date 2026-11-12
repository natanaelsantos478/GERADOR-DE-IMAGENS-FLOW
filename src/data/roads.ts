/** roads.json → RoadGraph (typed arrays + CSR adjacency) and a 1° bucket grid for nearest-node queries. */
import type { LonLat, RoadGraph } from '../core/world-types';
import { haversineKm } from '../core/geo';
import { DataFormatError, numArray } from './decode';

const F = 'roads.json';

export function buildRoadGraph(json: unknown): RoadGraph {
  const j = json as {
    nodes?: { lon?: unknown; lat?: unknown };
    edges?: Record<string, unknown>;
    geom?: unknown;
  } | null;
  if (!j || !j.nodes || !j.edges) throw new DataFormatError(F, 'esperado { nodes, edges, geom }');
  const lon = numArray(F, 'nodes.lon', j.nodes.lon);
  const lat = numArray(F, 'nodes.lat', j.nodes.lat);
  if (lon.length !== lat.length) throw new DataFormatError(F, 'nodes.lon e nodes.lat com tamanhos diferentes');
  const e = j.edges;
  const a = numArray(F, 'edges.a', e.a), b = numArray(F, 'edges.b', e.b), km = numArray(F, 'edges.km', e.km), cls = numArray(F, 'edges.cls', e.cls);
  const gs = numArray(F, 'edges.geomStart', e.geomStart), gl = numArray(F, 'edges.geomLen', e.geomLen);
  const geomIn = j.geom === undefined ? [] : numArray(F, 'geom', j.geom);
  const nodeCount = lon.length, edgeCount = a.length;
  for (const [name, arr] of [['b', b], ['km', km], ['cls', cls], ['geomStart', gs], ['geomLen', gl]] as const)
    if (arr.length !== edgeCount) throw new DataFormatError(F, `edges.${name} tem ${arr.length} valores, esperado ${edgeCount}`);

  // geomStart may count points (pairs) or raw floats; detect from the furthest edge end.
  let maxEnd = 0, maxEndPairs = 0;
  for (let i = 0; i < edgeCount; i++) {
    maxEnd = Math.max(maxEnd, gs[i] + gl[i]);
    maxEndPairs = Math.max(maxEndPairs, gs[i] + 2 * gl[i]);
  }
  const startIsFloatIndex = maxEnd * 2 > geomIn.length && maxEndPairs <= geomIn.length;
  if (!startIsFloatIndex && maxEnd * 2 > geomIn.length) throw new DataFormatError(F, 'geomStart/geomLen apontam para fora de geom');

  const g: RoadGraph = {
    nodeCount,
    edgeCount,
    nodeLon: Float64Array.from(lon),
    nodeLat: Float64Array.from(lat),
    edgeA: Int32Array.from(a),
    edgeB: Int32Array.from(b),
    edgeKm: Float32Array.from(km),
    edgeCls: Uint8Array.from(cls),
    edgeGeomStart: Int32Array.from(startIsFloatIndex ? gs.map((s) => s / 2) : gs),
    edgeGeomLen: Int32Array.from(gl),
    geom: Float64Array.from(geomIn),
    adjStart: new Int32Array(nodeCount + 1),
    adjEdge: new Int32Array(edgeCount * 2),
    edgeGeometry(edge: number): LonLat[] {
      const s = g.edgeGeomStart[edge], n = g.edgeGeomLen[edge];
      if (n < 2) {
        const A = g.edgeA[edge], B = g.edgeB[edge];
        return [[g.nodeLon[A], g.nodeLat[A]], [g.nodeLon[B], g.nodeLat[B]]];
      }
      const pts: LonLat[] = new Array(n);
      for (let i = 0; i < n; i++) pts[i] = [g.geom[2 * (s + i)], g.geom[2 * (s + i) + 1]];
      // Orient from A to B if the stored polyline runs the other way.
      const A = g.edgeA[edge];
      const dFirst = haversineKm(pts[0][0], pts[0][1], g.nodeLon[A], g.nodeLat[A]);
      const dLast = haversineKm(pts[n - 1][0], pts[n - 1][1], g.nodeLon[A], g.nodeLat[A]);
      return dLast < dFirst ? pts.reverse() : pts;
    },
    otherEnd(edge: number, node: number) {
      return g.edgeA[edge] === node ? g.edgeB[edge] : g.edgeA[edge];
    },
  };
  for (let i = 0; i < edgeCount; i++) {
    if (a[i] < 0 || a[i] >= nodeCount || b[i] < 0 || b[i] >= nodeCount) throw new DataFormatError(F, `aresta ${i} referencia nó inexistente`);
    g.adjStart[a[i] + 1]++;
    g.adjStart[b[i] + 1]++;
  }
  for (let n = 0; n < nodeCount; n++) g.adjStart[n + 1] += g.adjStart[n];
  const fill = g.adjStart.slice(0, nodeCount);
  for (let i = 0; i < edgeCount; i++) {
    g.adjEdge[fill[a[i]]++] = i;
    g.adjEdge[fill[b[i]]++] = i;
  }
  return g;
}

/** Nearest road node via 1° buckets with expanding rings. */
export function createNearestRoadNode(g: RoadGraph): (lon: number, lat: number, maxKm?: number) => number | null {
  const W = 360, H = 180;
  const cell = (lon: number, lat: number) => {
    let x = Math.floor(lon + 180) % W;
    if (x < 0) x += W;
    const y = Math.min(H - 1, Math.max(0, Math.floor(lat + 90)));
    return y * W + x;
  };
  const start = new Int32Array(W * H + 1);
  for (let n = 0; n < g.nodeCount; n++) start[cell(g.nodeLon[n], g.nodeLat[n]) + 1]++;
  for (let c = 0; c < W * H; c++) start[c + 1] += start[c];
  const items = new Int32Array(g.nodeCount);
  const fill = start.slice(0, W * H);
  for (let n = 0; n < g.nodeCount; n++) items[fill[cell(g.nodeLon[n], g.nodeLat[n])]++] = n;

  return (lon, lat, maxKm = 500) => {
    if (g.nodeCount === 0) return null;
    const cx = Math.floor(lon + 180), cy = Math.floor(lat + 90);
    let best = -1, bestKm = Infinity;
    for (let r = 0; r <= 180; r++) {
      // Lower bound of the distance to any cell of ring r (conservative at high latitudes).
      const cosMax = Math.max(0.02, Math.cos((Math.min(89.9, Math.abs(lat) + r) * Math.PI) / 180));
      const bound = Math.max(0, r - 1) * 110.57 * cosMax;
      if (bound > bestKm || bound > maxKm) break;
      for (let dy = -r; dy <= r; dy++) {
        const y = cy + dy;
        if (y < 0 || y >= H) continue;
        const ring = Math.abs(dy) === r;
        for (let dx = -r; dx <= r; dx += ring ? 1 : 2 * r || 1) {
          let x = (cx + dx) % W;
          if (x < 0) x += W;
          const c = y * W + x;
          for (let k = start[c]; k < start[c + 1]; k++) {
            const n = items[k];
            const d = haversineKm(lon, lat, g.nodeLon[n], g.nodeLat[n]);
            if (d < bestKm || (d === bestKm && n < best)) {
              bestKm = d;
              best = n;
            }
          }
        }
      }
      if (r >= W / 2) break;
    }
    return best >= 0 && bestKm <= maxKm ? best : null;
  };
}
