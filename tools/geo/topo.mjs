// Edge-hash topology helpers: adjacency (shared segments) and unshared-edge extraction.
import { polygonsOf } from './lib.mjs';

const key = (a, b, d) => {
  const x1 = a[0].toFixed(d), y1 = a[1].toFixed(d), x2 = b[0].toFixed(d), y2 = b[1].toFixed(d);
  return x1 < x2 || (x1 === x2 && y1 <= y2) ? `${x1},${y1};${x2},${y2}` : `${x2},${y2};${x1},${y1}`;
};

function* edges(geom) {
  for (const poly of polygonsOf(geom)) for (const ring of poly) for (let i = 0; i < ring.length - 1; i++) yield [ring[i], ring[i + 1]];
}

/** features: array of {geometry}. Returns {adj: Array<Set<number>>, owner: Map<key, idx|-1>}. */
export function buildTopology(features, digits = 3) {
  const owner = new Map();
  const adj = features.map(() => new Set());
  features.forEach((f, idx) => {
    for (const [a, b] of edges(f.geometry)) {
      if (a[0] === b[0] && a[1] === b[1]) continue;
      const k = key(a, b, digits);
      const o = owner.get(k);
      if (o === undefined) owner.set(k, idx);
      else if (o >= 0 && o !== idx) { adj[o].add(idx); adj[idx].add(o); owner.set(k, -1); }
      else if (o === -1) {
        // third feature on the same segment (overlap): link to everyone is unnecessary
      }
    }
  });
  return { adj, owner, key: (a, b) => key(a, b, digits) };
}

/** Iterates segments of feature idx that no other feature shares. */
export function* unsharedSegments(topo, feature, idx) {
  for (const [a, b] of edges(feature.geometry)) {
    if (topo.owner.get(topo.key(a, b)) === idx) yield [a, b];
  }
}
