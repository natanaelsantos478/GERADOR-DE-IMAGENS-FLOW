/** Weighted A* on the fine navigation grid (typed-array scratch, component pre-check, cost-aware string pulling). */
import { components, navCell, navCenter, snapCell, type NavRT } from './nav';
import type { Mobility } from './units';

const HW = 1.35, MAX_EXP = 220_000;
let N0 = 0, g = new Float32Array(0), from = new Int32Array(0), seen = new Uint32Array(0), done = new Uint32Array(0), gen = 0;
let hc = new Int32Array(1 << 16), hk = new Float32Array(1 << 16), hs = 0;
export const pathStats = { searches: 0, expanded: 0 };

function push(c: number, k: number): void {
  if (hs === hc.length) { const a = new Int32Array(hs * 2), b = new Float32Array(hs * 2); a.set(hc); b.set(hk); hc = a; hk = b; }
  let i = hs++;
  while (i > 0) { const p = (i - 1) >> 1; if (hk[p] <= k) break; hc[i] = hc[p]; hk[i] = hk[p]; i = p; }
  hc[i] = c; hk[i] = k;
}
function pop(): number {
  const top = hc[0], c = hc[--hs], k = hk[hs];
  let i = 0;
  for (;;) {
    const l = 2 * i + 1;
    if (l >= hs) break;
    const r = l + 1, s = r < hs && hk[r] < hk[l] ? r : l;
    if (hk[s] >= k) break;
    hc[i] = hc[s]; hk[i] = hk[s]; i = s;
  }
  hc[i] = c; hk[i] = k;
  return top;
}

/** Waypoints [x0,y0,...,x1,y1] from (x0,y0) to the goal (snapped to the nearest reachable passable cell), [] when unreachable. `inb`/`goalB`: buildings infantry may use. */
export function navPath(rt: NavRT, mob: Mobility, x0: number, y0: number, x1: number, y1: number, inb = 0, goalB = 0): number[] {
  if (mob === 'air') return [x1, y1];
  const n = rt.n, N = n * n, cs = rt.cs, spd = rt.spd[mob], bld = rt.bld;
  const fac = (c: number) => { const f = spd[c]; if (f === 0 && mob === 'foot') { const b = bld[c]; if (b && (b === inb || b === goalB)) return 0.5; } return f; };
  let sc = navCell(rt, x0, y0);
  if (!fac(sc)) { sc = snapCell(rt, mob, sc, 10, 0, inb); if (sc < 0) return []; }
  const lab = components(rt, mob);
  const comp = lab[sc];
  let gc = navCell(rt, x1, y1);
  const goalInBuilding = goalB !== 0 && bld[gc] === goalB;
  if (!goalInBuilding && (!fac(gc) || (comp && lab[gc] !== comp))) { gc = snapCell(rt, mob, gc, 90, comp, 0); if (gc < 0) return []; }
  if (N0 !== N) { N0 = N; g = new Float32Array(N); from = new Int32Array(N); seen = new Uint32Array(N); done = new Uint32Array(N); gen = 0; }
  gen++; hs = 0;
  let vmax = 0.5;
  for (let c = 0; c < N; c += 7) if (spd[c] > vmax) vmax = spd[c];
  const hmul = (cs / (vmax * Math.sqrt(vmax))) * HW;
  const gx = gc % n, gy = (gc - gx) / n;
  const hOf = (c: number) => { const cx = c % n, dx = Math.abs(cx - gx), dy = Math.abs((c - cx) / n - gy); return (Math.max(dx, dy) + 0.4142 * Math.min(dx, dy)) * hmul; };
  g[sc] = 0; from[sc] = -1; seen[sc] = gen; push(sc, hOf(sc));
  let exp = 0, found = false;
  while (hs) {
    const c = pop();
    if (done[c] === gen) continue;
    done[c] = gen;
    if (c === gc) { found = true; break; }
    if (++exp > MAX_EXP) break;
    const cx = c % n, cy = (c - cx) / n, gc0 = g[c];
    for (let d = 0; d < 8; d++) {
      const dx = d < 4 ? (d === 0 ? 1 : d === 1 ? -1 : 0) : (d & 1 ? 1 : -1), dy = d < 4 ? (d === 2 ? 1 : d === 3 ? -1 : 0) : (d < 6 ? 1 : -1);
      const X = cx + dx, Y = cy + dy;
      if (X < 0 || Y < 0 || X >= n || Y >= n) continue;
      const nc = Y * n + X;
      if (done[nc] === gen) continue;
      const f = fac(nc);
      if (!f) continue;
      let dist = cs;
      if (dx && dy) { if (!fac(cy * n + X) || !fac(Y * n + cx)) continue; dist = cs * 1.4142; }
      const ng = gc0 + dist / (f * Math.sqrt(f));
      if (seen[nc] !== gen || ng < g[nc]) { seen[nc] = gen; g[nc] = ng; from[nc] = c; push(nc, ng + hOf(nc)); }
    }
  }
  pathStats.searches++; pathStats.expanded += exp;
  if (!found) return [];
  const cells: number[] = [];
  for (let c = gc; c !== -1; c = from[c]) cells.push(c);
  cells.reverse();
  // string pulling: keep a straight shortcut only if it stays passable and no costlier than the grid path (so roads stay preferred)
  const cost = cells.map((c) => g[c]);
  const walk = (a: number, b: number): boolean => {
    // exact grid traversal (every cell the straight segment touches must be passable)
    const [ax, ay] = navCenter(rt, cells[a]), [bx, by] = navCenter(rt, cells[b]);
    const len = Math.hypot(bx - ax, by - ay);
    let cx = cells[a] % n, cy = (cells[a] - cx) / n;
    const ex = cells[b] % n, ey = (cells[b] - ex) / n;
    const dx = bx - ax, dy = by - ay, sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1;
    const tdx = dx ? Math.abs(cs / dx) : Infinity, tdy = dy ? Math.abs(cs / dy) : Infinity;
    let tx = dx ? 0.5 * tdx : Infinity, ty = dy ? 0.5 * tdy : Infinity, acc = 0, prevT = 0;
    for (let guard = 0; guard < 4 * n; guard++) {
      const f = fac(cy * n + cx);
      if (!f) return false;
      const t = Math.min(tx, ty, 1);
      acc += ((t - prevT) * len) / (f * Math.sqrt(f)); prevT = t;
      if (cx === ex && cy === ey) break;
      if (Math.abs(tx - ty) < 1e-9) { if (!fac(cy * n + cx + sx) || !fac((cy + sy) * n + cx)) return false; cx += sx; cy += sy; tx += tdx; ty += tdy; }
      else if (tx < ty) { cx += sx; tx += tdx; } else { cy += sy; ty += tdy; }
    }
    return acc <= (cost[b] - cost[a]) * 1.1 + cs;
  };
  const pts: number[] = [x0, y0];
  let anchor = 0;
  for (let i = 2; i < cells.length; i++) if (!walk(anchor, i)) { const [px, py] = navCenter(rt, cells[i - 1]); pts.push(px, py); anchor = i - 1; }
  const [cxg, cyg] = navCenter(rt, gc);
  const exact = navCell(rt, x1, y1) === gc;
  pts.push(exact ? x1 : cxg, exact ? y1 : cyg);
  return pts;
}
