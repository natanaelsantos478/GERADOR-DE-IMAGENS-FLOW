/** Route planning: land (A* on the road graph + off-road), sea (A* on the navgrid, cached) and air (great circle). */
import { aStar } from '../../core/astar';
import type { Ctx, LonLat, PathPreview } from '../../core/contracts';
import { greatCirclePoints, interpolateGreatCircle } from '../../core/geo';
import { UNITS } from './catalog';
import { type Apis3, clamp, dist, envOf, mayEnter, mod, nodeProvince, roadComponents } from './env';
import type { Formation, Route } from './types';

export const CLS_FAC = [1, 0.85, 0.6, 0.95, 0.25];

export interface Budget {
  left: number;
}
export type PlanResult = { ok: true; route: Route } | { ok: false; reason: string };

/** Slowest relevant unit speed (km/h) of a formation for a movement kind. */
export function speedOf(A: Apis3, f: Formation, kind: 'road' | 'off' | 'sea' | 'fly'): number {
  let v = Infinity;
  for (const s of f.u) if (s.s > 0.04) {
    const t = UNITS[s.t];
    if (t[kind] > 0 && t[kind] < v) v = t[kind];
  }
  if (v === Infinity) v = 0;
  const m = kind === 'sea' ? mod(A, f.c, 'mil.naval.speed') : kind === 'fly' ? 1 : mod(A, f.c, 'mil.speed');
  return v * m;
}

/** Province ruggedness factor for off-road movement. */
export function reliefFactor(ctx: Ctx, provinceId: string | null): number {
  const p = provinceId ? ctx.world.provinceById.get(provinceId) : null;
  return 1 / (1 + 1.6 * (p ? p.rugged : 0.3));
}

const roadDmgFac = (ctx: Ctx, e: number) => 1 - 0.95 * (ctx.state.world.roadDamage[e] ?? 0);
export const edgeSpeedFactor = (ctx: Ctx, e: number) => CLS_FAC[ctx.world.roads.edgeCls[e]] * roadDmgFac(ctx, e);

function makeRoute(m: Route['m'], w: number[], ed: number[], tot: number, eta: number): Route {
  return { m, w, ed, i: 0, km: 0, tot: Math.round(tot), dn: 0, eta: Math.round(eta * 10) / 10 };
}

// ------------------------------------------------------------------ land

/** Samples a straight line: false when it crosses sea or forbidden territory; also returns mean relief. */
function straightLand(ctx: Ctx, A: Apis3, f: Formation, a: LonLat, b: LonLat): { ok: boolean; relief: number } {
  const km = dist(a, b);
  const n = Math.max(1, Math.ceil(km / 12));
  let relief = 0;
  for (let i = 0; i <= n; i++) {
    const p = interpolateGreatCircle(a, b, i / n);
    if (ctx.world.isSea(p[0], p[1])) return { ok: false, relief: 0 };
    const pid = ctx.world.nearestProvince(p[0], p[1], 20);
    if (pid && !f.reb) {
      if (!mayEnter(A, f.c, ctx.state.world.controller[pid] ?? f.c)) return { ok: false, relief: 0 };
    }
    relief += reliefFactor(ctx, pid);
  }
  return { ok: true, relief: relief / (n + 1) };
}

/** Same-hour cache of road searches (hour-exact so reloaded saves replay identically) shared by formations of one country with the same endpoints (groups ordered together). */
let pathDay = -1;
const pathCache = new Map<string, ReturnType<typeof aStar>>();

export function planLand(ctx: Ctx, A: Apis3, f: Formation, to: LonLat, budget: Budget): PlanResult {
  const w = ctx.world, g = w.roads;
  const vRoad = speedOf(A, f, 'road'), vOff = speedOf(A, f, 'off');
  if (vOff <= 0) return { ok: false, reason: 'err.mil.cannotMove' };
  const total = dist(f.p, to);
  const dest = w.nearestProvince(to[0], to[1], 30);
  if (dest && !f.reb && !mayEnter(A, f.c, ctx.state.world.controller[dest] ?? f.c)) return { ok: false, reason: 'err.mil.noAccess' };
  if (w.isSea(to[0], to[1])) return { ok: false, reason: 'err.mil.destSea' };

  let offHours = Infinity;
  if (total <= 700) {
    const s = straightLand(ctx, A, f, f.p, to);
    if (s.ok) offHours = total / (vOff * s.relief);
  }
  let roadRoute: Route | null = null;
  let roadHours = Infinity;
  const na = w.nearestRoadNode(f.p[0], f.p[1], 200), nz = w.nearestRoadNode(to[0], to[1], 200);
  if (na !== null && nz !== null && vRoad > 0 && offHours > 8) {
    const comp = roadComponents(w);
    if (comp[na] === comp[nz]) {
      const zLon = g.nodeLon[nz], zLat = g.nodeLat[nz];
      const access = new Map<number, boolean>();
      const okNode = (n: number) => {
        if (f.reb) return true;
        const pi = nodeProvince(w, n);
        if (pi < 0) return true;
        let v = access.get(pi);
        if (v === undefined) {
          v = mayEnter(A, f.c, ctx.state.world.controller[w.provinces[pi].id] ?? f.c);
          access.set(pi, v);
        }
        return v;
      };
      const edgeHours = (e: number) => g.edgeKm[e] / (vRoad * Math.max(0.04, edgeSpeedFactor(ctx, e)));
      const day = ctx.state.time.hours;
      if (day !== pathDay || pathCache.size > 600) (pathDay = day), pathCache.clear();
      const ck = `${f.c}|${na}|${nz}|${Math.round(vRoad)}|${f.reb ? 1 : 0}`;
      const hit = pathCache.get(ck);
      const res = hit !== undefined ? hit : aStar(
        {
          neighbors(n, visit) {
            for (let k = g.adjStart[n]; k < g.adjStart[n + 1]; k++) {
              const e = g.adjEdge[k], o = g.otherEnd(e, n);
              if (okNode(o)) visit(o, edgeHours(e));
            }
          },
          heuristic: (n) => dist([g.nodeLon[n], g.nodeLat[n]], [zLon, zLat]) / vRoad,
          isGoal: (n) => n === nz,
        },
        na,
        { nodeCount: g.nodeCount, maxExpanded: Math.max(2000, Math.min(250_000, budget.left)) },
      );
      if (hit === undefined) {
        pathCache.set(ck, res);
        budget.left -= res ? res.expanded : 250_000;
      }
      if (res) {
        const ed: number[] = [];
        let km = 0;
        for (let i = 1; i < res.path.length; i++) {
          const a = res.path[i - 1], b = res.path[i];
          let best = -1, bc = Infinity;
          for (let k = g.adjStart[a]; k < g.adjStart[a + 1]; k++) {
            const e = g.adjEdge[k];
            if (g.otherEnd(e, a) === b && edgeHours(e) < bc) (bc = edgeHours(e)), (best = e);
          }
          ed.push(best * 2 + (g.edgeB[best] === a && g.edgeA[best] !== a ? 1 : 0));
          km += g.edgeKm[best];
        }
        const ap = dist(f.p, [g.nodeLon[na], g.nodeLat[na]]), fp = dist([zLon, zLat], to);
        roadHours = res.cost + ap / vOff + fp / vOff;
        roadRoute = makeRoute('road', [f.p[0], f.p[1], g.nodeLon[na], g.nodeLat[na], zLon, zLat, to[0], to[1]], ed, km + ap + fp, roadHours);
      }
    }
  }
  if (offHours === Infinity && !roadRoute) return { ok: false, reason: total > 700 || na === null ? 'err.mil.noLandPath' : 'err.mil.noLandPath' };
  if (offHours <= roadHours) return { ok: true, route: makeRoute('offroad', [f.p[0], f.p[1], to[0], to[1]], [], total, offHours) };
  return { ok: true, route: roadRoute! };
}

// ------------------------------------------------------------------ sea

function nearestSeaCell(ctx: Ctx, p: LonLat, maxR = 6): [number, number] | null {
  const ng = ctx.world.navGrid;
  const [cx, cy] = ng.cellOf(p[0], p[1]);
  if (ng.isSeaCell(cx, cy)) return [cx, cy];
  for (let r = 1; r <= maxR; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = (cx + dx + ng.w) % ng.w, y = clamp(cy + dy, 0, ng.h - 1);
        if (ng.isSeaCell(x, y)) return [x, y];
      }
  return null;
}

function seaLos(ctx: Ctx, a: LonLat, b: LonLat): boolean {
  const ng = ctx.world.navGrid;
  const km = dist(a, b);
  if (km > 350) return false;
  const n = Math.ceil(km / 12);
  for (let i = 1; i < n; i++) {
    const p = interpolateGreatCircle(a, b, i / n);
    const [x, y] = ng.cellOf(p[0], p[1]);
    if (!ng.isSeaCell(x, y)) return false;
  }
  return true;
}

export function planSea(ctx: Ctx, A: Apis3, f: Formation, to: LonLat, budget: Budget): PlanResult {
  const ng = ctx.world.navGrid;
  const env = envOf(ctx.world);
  const v = speedOf(A, f, 'sea');
  if (v <= 0) return { ok: false, reason: 'err.mil.cannotMove' };
  const s = nearestSeaCell(ctx, f.p), g = nearestSeaCell(ctx, to);
  if (!s || !g) return { ok: false, reason: 'err.mil.noSeaPath' };
  const key = `${s[0]},${s[1]}>${g[0]},${g[1]}`;
  let cells = env.seaCache.get(key);
  if (!cells) {
    const W = ng.w;
    const goalC = ng.cellCenter(g[0], g[1]);
    const res = aStar(
      {
        neighbors(n, visit) {
          const x = n % W, y = (n - x) / W;
          const c = ng.cellCenter(x, y);
          for (let dy = -1; dy <= 1; dy++) {
            const ny = y + dy;
            if (ny < 0 || ny >= ng.h) continue;
            for (let dx = -1; dx <= 1; dx++) {
              if (!dx && !dy) continue;
              const nx = (x + dx + W) % W;
              if (!ng.isSeaCell(nx, ny)) continue;
              if (dx && dy && (!ng.isSeaCell(nx, y) || !ng.isSeaCell(x, ny))) continue;
              visit(ny * W + nx, dist(c, ng.cellCenter(nx, ny)));
            }
          }
        },
        heuristic: (n) => dist(ng.cellCenter(n % W, (n / W) | 0), goalC),
        isGoal: (n) => n === g[1] * W + g[0],
      },
      s[1] * W + s[0],
      { maxExpanded: Math.max(5000, Math.min(400_000, budget.left)) },
    );
    budget.left -= res ? res.expanded : 400_000;
    if (!res) return { ok: false, reason: 'err.mil.noSeaPath' };
    // Visibility smoothing keeps few waypoints (flat lon,lat pairs).
    const pts = res.path.map((n) => ng.cellCenter(n % W, (n / W) | 0));
    const out: number[] = [];
    let i = 0;
    while (i < pts.length - 1) {
      let j = Math.min(pts.length - 1, i + 1);
      for (let k = pts.length - 1; k > i + 1; k--) if (seaLos(ctx, pts[i], pts[k])) { j = k; break; }
      out.push(pts[j][0], pts[j][1]);
      i = j;
    }
    cells = out.map((n) => Math.round(n * 1000) / 1000);
    if (env.seaCache.size > 300) env.seaCache.delete(env.seaCache.keys().next().value as string);
    env.seaCache.set(key, cells);
  }
  const w = [f.p[0], f.p[1], ...cells, to[0], to[1]];
  let km = 0;
  for (let i = 2; i < w.length; i += 2) km += dist([w[i - 2], w[i - 1]], [w[i], w[i + 1]]);
  return { ok: true, route: makeRoute('sea', w, [], km, km / v) };
}

// ------------------------------------------------------------------ air

export function planAir(A: Apis3, f: Formation, to: LonLat): PlanResult {
  const v = speedOf(A, f, 'fly');
  if (v <= 0) return { ok: false, reason: 'err.mil.cannotMove' };
  const km = dist(f.p, to);
  return { ok: true, route: makeRoute('air', [f.p[0], f.p[1], to[0], to[1]], [], km, km / v) };
}

/** Max one-way ferry/combat radius (km) of an air formation (shortest-range unit decides). */
export function airRadius(A: Apis3, f: Formation): number {
  let r = Infinity;
  for (const s of f.u) if (s.s > 0.04 && UNITS[s.t].radius > 0) r = Math.min(r, UNITS[s.t].radius);
  return (r === Infinity ? 0 : r) * mod(A, f.c, 'mil.air.range');
}

// ------------------------------------------------------------------ geometry & preview

/** Polyline of one route leg. Road routes: leg 0 approach, 1..n edges, n+1 final. */
export function legPoints(ctx: Ctx, rt: Route, i: number): LonLat[] {
  const g = ctx.world.roads, w = rt.w;
  if (rt.m === 'road') {
    if (i === 0) return [[w[0], w[1]], [w[2], w[3]]];
    if (i > rt.ed.length) return [[w[4], w[5]], [w[6], w[7]]];
    const code = rt.ed[i - 1];
    const pts = g.edgeGeometry(code >> 1);
    return code & 1 ? pts.slice().reverse() : pts;
  }
  const out: LonLat[] = [];
  for (let k = 0; k < w.length; k += 2) out.push([w[k], w[k + 1]]);
  return out;
}
export const legCount = (rt: Route) => (rt.m === 'road' ? rt.ed.length + 2 : 1);

export function routePolyline(ctx: Ctx, rt: Route, maxPoints = 300): LonLat[] {
  if (rt.m === 'air') return greatCirclePoints([rt.w[0], rt.w[1]], [rt.w[rt.w.length - 2], rt.w[rt.w.length - 1]], 24);
  const all: LonLat[] = [];
  for (let i = rt.i; i < legCount(rt); i++) for (const p of legPoints(ctx, rt, i)) all.push(p);
  const step = Math.max(1, Math.ceil(all.length / maxPoints));
  const out = all.filter((_, k) => k % step === 0);
  const last = all[all.length - 1];
  if (last && out[out.length - 1] !== last) out.push(last);
  return out;
}

export function previewOf(ctx: Ctx, A: Apis3, f: Formation, to: LonLat): PathPreview | null {
  const budget = { left: 120_000 };
  const r = f.d === 'land' ? planLand(ctx, A, f, to, budget) : f.d === 'naval' ? planSea(ctx, A, f, to, budget) : planAir(A, f, to);
  if (!r.ok) return null;
  const rt = r.route;
  const mode: PathPreview['mode'] = rt.m === 'road' ? 'road' : rt.m === 'offroad' ? 'offroad' : rt.m === 'sea' ? 'sea' : 'air';
  return { points: routePolyline(ctx, rt, 200), km: rt.tot, etaHours: rt.eta, mode };
}
