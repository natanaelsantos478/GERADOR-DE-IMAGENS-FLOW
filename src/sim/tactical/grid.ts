/** Terrain queries, line of sight and grid pathfinding on a TacticalMap. */
import type { Mobility } from './units';
import type { Smoke, TacticalMap } from './types';

export const cellSize = (m: TacticalMap) => m.sizeM / m.n;
export function cellOf(m: TacticalMap, x: number, y: number): number {
  const cs = m.sizeM / m.n;
  const cx = Math.min(m.n - 1, Math.max(0, Math.floor((x + m.sizeM / 2) / cs)));
  const cy = Math.min(m.n - 1, Math.max(0, Math.floor((y + m.sizeM / 2) / cs)));
  return cy * m.n + cx;
}
export function cellCenter(m: TacticalMap, c: number): [number, number] {
  const cs = m.sizeM / m.n;
  return [((c % m.n) + 0.5) * cs - m.sizeM / 2, (Math.floor(c / m.n) + 0.5) * cs - m.sizeM / 2];
}
export const inside = (m: TacticalMap, x: number, y: number) => Math.abs(x) <= m.sizeM / 2 && Math.abs(y) <= m.sizeM / 2;

/** Bilinear terrain height (m). */
export function heightAt(m: TacticalMap, x: number, y: number): number {
  const n = m.n, cs = m.sizeM / n;
  const fx = Math.min(n - 1.001, Math.max(0, (x + m.sizeM / 2) / cs - 0.5));
  const fy = Math.min(n - 1.001, Math.max(0, (y + m.sizeM / 2) / cs - 0.5));
  const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
  const h = m.heights, i = y0 * n + x0;
  return (h[i] * (1 - tx) + h[i + 1] * tx) * (1 - ty) + (h[i + n] * (1 - tx) + h[i + n + 1] * tx) * ty;
}
export const coverAt = (m: TacticalMap, x: number, y: number) => m.cover[cellOf(m, x, y)];
const OBST = [0, 8, 12];

/** Line of sight over relief, trees/buildings and smoke. `e0`/`e1` are eye/target heights above ground. */
export function los(m: TacticalMap, smokes: Smoke[], t: number, x0: number, y0: number, e0: number, x1: number, y1: number, e1: number): boolean {
  const d = Math.hypot(x1 - x0, y1 - y0);
  const cs = m.sizeM / m.n;
  const steps = Math.max(1, Math.ceil(d / (cs * 0.5)));
  const a = heightAt(m, x0, y0) + e0, b = heightAt(m, x1, y1) + e1;
  const live = smokes.filter((s) => s.until > t);
  for (let i = 1; i < steps; i++) {
    const f = i / steps, x = x0 + (x1 - x0) * f, y = y0 + (y1 - y0) * f, dd = d * f;
    for (const s of live) if ((x - s.x) ** 2 + (y - s.y) ** 2 < s.r * s.r) return false;
    if (dd < cs * 1.2 || d - dd < cs * 1.2) continue;
    if (heightAt(m, x, y) + OBST[m.cover[cellOf(m, x, y)]] > a + (b - a) * f) return false;
  }
  return true;
}

// ---------------------------------------------------------------- mobility
const MAXSLOPE: Record<Mobility, number> = { foot: 0.8, track: 0.6, wheel: 0.4, air: 9 };
const OFFROAD: Record<Mobility, number> = { foot: 1, track: 0.7, wheel: 0.5, air: 1 };
const FOREST: Record<Mobility, number> = { foot: 0.8, track: 0.6, wheel: 0.4, air: 1 };
const URBAN: Record<Mobility, number> = { foot: 0.9, track: 0.6, wheel: 0.5, air: 1 };

/** Speed multiplier of a cell for a mobility class (0 = impassable), ignoring slope. */
export function cellFactor(m: TacticalMap, c: number, mob: Mobility): number {
  if (mob === 'air') return 1;
  if (m.road[c]) return mob === 'foot' ? 1 : 1.35;
  if (m.water[c]) return 0;
  return OFFROAD[mob] * (m.cover[c] === 1 ? FOREST[mob] : m.cover[c] === 2 ? URBAN[mob] : 1);
}
/** Speed multiplier at a point given slope along heading (rise over ~30 m). */
export function moveFactor(m: TacticalMap, x: number, y: number, hx: number, hy: number, mob: Mobility): number {
  if (mob === 'air') return 1;
  const f = cellFactor(m, cellOf(m, x, y), mob);
  if (f === 0) return 0;
  const slope = (heightAt(m, x + hx * 30, y + hy * 30) - heightAt(m, x, y)) / 30;
  return f * Math.max(0.2, 1 - Math.max(0, Math.abs(slope) - 0.05) / MAXSLOPE[mob]);
}

const DIRS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

/** A* over cells for a mobility class. Returns flat waypoints [x,y,...] (smoothed), [] if unreachable. */
export function findPath(m: TacticalMap, mob: Mobility, x0: number, y0: number, x1: number, y1: number): number[] {
  if (mob === 'air') return [x1, y1];
  const n = m.n, cs = m.sizeM / n, N = n * n;
  const start = cellOf(m, x0, y0);
  let goal = cellOf(m, x1, y1);
  if (cellFactor(m, goal, mob) === 0) {
    let best = -1, bd = 1e18;
    for (let c = 0; c < N; c++) if (cellFactor(m, c, mob) > 0) {
      const [cx, cy] = cellCenter(m, c); const d = (cx - x1) ** 2 + (cy - y1) ** 2;
      if (d < bd) { bd = d; best = c; }
    }
    if (best < 0) return [];
    goal = best;
  }
  const g = new Float64Array(N).fill(Infinity), from = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
  const heap: number[] = [], key: number[] = [];
  const push = (c: number, f: number) => {
    heap.push(c); key.push(f);
    let i = heap.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (key[p] <= key[i]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; [key[p], key[i]] = [key[i], key[p]]; i = p; }
  };
  const pop = () => {
    const top = heap[0]; const lc = heap.pop()!, lk = key.pop()!;
    if (heap.length) {
      heap[0] = lc; key[0] = lk; let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let s = i;
        if (l < heap.length && key[l] < key[s]) s = l;
        if (r < heap.length && key[r] < key[s]) s = r;
        if (s === i) break;
        [heap[s], heap[i]] = [heap[i], heap[s]]; [key[s], key[i]] = [key[i], key[s]]; i = s;
      }
    }
    return top;
  };
  const [gx, gy] = cellCenter(m, goal);
  g[start] = 0; push(start, 0);
  while (heap.length) {
    const c = pop();
    if (closed[c]) continue;
    closed[c] = 1;
    if (c === goal) break;
    const cx = c % n, cy = (c - cx) / n;
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
      const nc = ny * n + nx;
      if (closed[nc]) continue;
      const f = cellFactor(m, nc, mob);
      if (f === 0) continue;
      const dist = cs * (dx && dy ? 1.4142 : 1);
      const slope = Math.abs(m.heights[nc] - m.heights[c]) / dist;
      if (slope > MAXSLOPE[mob]) continue;
      const cost = dist / (Math.min(f, 1.35) * Math.max(0.2, 1 - slope / MAXSLOPE[mob])) ;
      const ng = g[c] + cost;
      if (ng < g[nc]) {
        g[nc] = ng; from[nc] = c;
        const [px, py] = cellCenter(m, nc);
        push(nc, ng + Math.hypot(px - gx, py - gy) / 1.35);
      }
    }
  }
  if (!closed[goal]) return [];
  const cells: number[] = [];
  for (let c = goal; c !== -1; c = from[c]) cells.push(c);
  cells.reverse();
  // string-pulling: skip waypoints while the straight segment stays passable and cheap
  const pts: number[] = [x0, y0];
  let anchor = 0;
  const walk = (a: number, b: number) => {
    if (mob !== 'foot') for (let j = a; j <= b; j++) if (m.road[cells[j]]) return false;
    const [ax, ay] = cellCenter(m, cells[a]), [bx, by] = cellCenter(m, cells[b]);
    const len = Math.hypot(bx - ax, by - ay), k = Math.ceil(len / (cs * 0.5));
    let prev = cells[a];
    for (let i = 1; i <= k; i++) {
      const c = cellOf(m, ax + ((bx - ax) * i) / k, ay + ((by - ay) * i) / k);
      if (cellFactor(m, c, mob) === 0 || Math.abs(m.heights[c] - m.heights[prev]) / cs > MAXSLOPE[mob] * 0.8) return false;
      prev = c;
    }
    return true;
  };
  for (let i = 2; i < cells.length; i++) {
    if (!walk(anchor, i)) { const [px, py] = cellCenter(m, cells[i - 1]); pts.push(px, py); anchor = i - 1; }
  }
  pts.push(Math.abs(x1) <= m.sizeM / 2 ? x1 : gx, Math.abs(y1) <= m.sizeM / 2 ? y1 : gy);
  if (cellFactor(m, cellOf(m, x1, y1), mob) === 0) { pts[pts.length - 2] = gx; pts[pts.length - 1] = gy; }
  return pts;
}
