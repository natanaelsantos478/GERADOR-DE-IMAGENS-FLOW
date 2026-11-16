/** Binary min-heap and generic A* over integer node ids (road nodes, navgrid cells, tactical cells…). */

export class MinHeap<T = number> {
  private keys: number[] = [];
  private vals: T[] = [];

  get size(): number {
    return this.keys.length;
  }

  push(key: number, val: T): void {
    const k = this.keys, v = this.vals;
    let i = k.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p];
      v[i] = v[p];
      i = p;
    }
    k[i] = key;
    v[i] = val;
  }

  peekKey(): number | undefined {
    return this.keys[0];
  }

  /** Removes and returns the value with the smallest key (undefined when empty). */
  pop(): T | undefined {
    const k = this.keys, v = this.vals;
    if (k.length === 0) return undefined;
    const top = v[0];
    const lk = k.pop()!, lv = v.pop()!;
    const n = k.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lk) break;
        k[i] = k[c];
        v[i] = v[c];
        i = c;
      }
      k[i] = lk;
      v[i] = lv;
    }
    return top;
  }

  clear(): void {
    this.keys.length = 0;
    this.vals.length = 0;
  }
}

export interface AStarGraph {
  /** Calls `visit(next, cost)` for each traversable neighbour; cost must be ≥ 0. */
  neighbors(node: number, visit: (next: number, cost: number) => void): void;
  /** Admissible estimate of the remaining cost from `node` (0 turns A* into Dijkstra). */
  heuristic(node: number): number;
  /** Goal test. */
  isGoal(node: number): boolean;
}

export interface AStarOptions {
  /** If known, enables typed-array bookkeeping (much faster on big grids). */
  nodeCount?: number;
  /** Abort after expanding this many nodes (returns null). Default 1e6. */
  maxExpanded?: number;
  /** Give up on paths costlier than this. */
  maxCost?: number;
}

export interface AStarResult {
  /** Node ids from start to goal (inclusive). */
  path: number[];
  cost: number;
  expanded: number;
}

interface Pool {
  n: number;
  stamp: number;
  seen: Int32Array; // == stamp when g/p/h are valid for this search
  closed: Int32Array; // == stamp when closed
  g: Float64Array;
  h: Float64Array;
  p: Int32Array;
}
let pool: Pool | null = null;

/** A* from one or many start nodes; ties broken by insertion order (deterministic). With `nodeCount` the typed buffers are reused across searches (stamped, never cleared). */
export function aStar(graph: AStarGraph, start: number | readonly number[], opts: AStarOptions = {}): AStarResult | null {
  const n = opts.nodeCount;
  if (!n) return aStarMap(graph, start, opts);
  const maxExpanded = opts.maxExpanded ?? 1_000_000;
  const maxCost = opts.maxCost ?? Infinity;
  if (!pool || pool.n !== n) pool = { n, stamp: 0, seen: new Int32Array(n), closed: new Int32Array(n), g: new Float64Array(n), h: new Float64Array(n), p: new Int32Array(n) };
  const P = pool;
  const st = ++P.stamp;
  const { seen, closed, g: gArr, h: hArr, p: pArr } = P;
  const heur = (x: number) => {
    if (seen[x] !== st) { seen[x] = st; gArr[x] = Infinity; pArr[x] = -1; hArr[x] = graph.heuristic(x); }
    return hArr[x];
  };
  const getG = (x: number) => (seen[x] === st ? gArr[x] : Infinity);

  const open = new MinHeap<number>();
  const starts = typeof start === 'number' ? [start] : start;
  for (const s of starts) {
    if (getG(s) === 0) continue;
    const h = heur(s);
    gArr[s] = 0;
    pArr[s] = -1;
    open.push(h, s);
  }
  let expanded = 0;
  let cur = -1;
  let curG = 0;
  const relax = (next: number, cost: number) => {
    if (closed[next] === st) return;
    const g = curG + cost;
    if (g > maxCost) return;
    const h = heur(next);
    if (g >= gArr[next]) return;
    gArr[next] = g;
    pArr[next] = cur;
    open.push(g + h, next);
  };
  while (open.size > 0) {
    const node = open.pop()!;
    if (closed[node] === st) continue;
    if (graph.isGoal(node)) {
      const path: number[] = [];
      for (let x = node; x !== -1; x = pArr[x]) path.push(x);
      path.reverse();
      return { path, cost: gArr[node], expanded };
    }
    closed[node] = st;
    if (++expanded > maxExpanded) return null;
    cur = node;
    curG = gArr[node];
    graph.neighbors(node, relax);
  }
  return null;
}

function aStarMap(graph: AStarGraph, start: number | readonly number[], opts: AStarOptions = {}): AStarResult | null {
  const maxExpanded = opts.maxExpanded ?? 1_000_000;
  const maxCost = opts.maxCost ?? Infinity;
  const n = opts.nodeCount;
  const gArr = n ? new Float64Array(n).fill(Infinity) : null;
  const pArr = n ? new Int32Array(n).fill(-1) : null;
  const closedArr = n ? new Uint8Array(n) : null;
  const gMap = n ? null : new Map<number, number>();
  const pMap = n ? null : new Map<number, number>();
  const closedSet = n ? null : new Set<number>();

  const getG = (x: number) => (gArr ? gArr[x] : (gMap!.get(x) ?? Infinity));
  const setG = (x: number, g: number) => (gArr ? (gArr[x] = g) : gMap!.set(x, g));
  const setP = (x: number, p: number) => (pArr ? (pArr[x] = p) : pMap!.set(x, p));
  const getP = (x: number) => (pArr ? pArr[x] : (pMap!.get(x) ?? -1));
  const isClosed = (x: number) => (closedArr ? closedArr[x] === 1 : closedSet!.has(x));
  const close = (x: number) => (closedArr ? (closedArr[x] = 1) : closedSet!.add(x));

  const open = new MinHeap<number>();
  const starts = typeof start === 'number' ? [start] : start;
  for (const s of starts) {
    if (getG(s) === 0) continue;
    setG(s, 0);
    setP(s, -1);
    open.push(graph.heuristic(s), s);
  }

  let expanded = 0;
  let cur = -1;
  const relax = (next: number, cost: number) => {
    if (isClosed(next)) return;
    const g = getG(cur) + cost;
    if (g >= getG(next) || g > maxCost) return;
    setG(next, g);
    setP(next, cur);
    open.push(g + graph.heuristic(next), next);
  };

  while (open.size > 0) {
    const node = open.pop()!;
    if (isClosed(node)) continue;
    if (graph.isGoal(node)) {
      const path: number[] = [];
      for (let x = node; x !== -1; x = getP(x)) path.push(x);
      path.reverse();
      return { path, cost: getG(node), expanded };
    }
    close(node);
    if (++expanded > maxExpanded) return null;
    cur = node;
    graph.neighbors(node, relax);
  }
  return null;
}
