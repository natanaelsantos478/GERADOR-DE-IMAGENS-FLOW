/** Destructible buildings: hit points from the rules, blast damage, collapse into rubble (incremental nav patch), breach (tanks demolishing small buildings) and route invalidation. */
import type { NavBuilding } from '../../data/vector/nav';
import { damage } from './combat';
import { applyRubble, navCell, navCenter, navOf, type NavRT } from './nav';
import { BREACH, BUILDING_DMG_K, BUILDING_MIN_AREA, buildingInfo, civilWeight, COLLAPSE_DMG, COLLATERAL_PER_WEIGHT, type BuildingInfo } from './terrainRules';
import type { Battle, Proj, Rubble, Squad } from './types';
import { UNITS } from './units';
import { DT, cacheOf } from './util';

const infoCache = new WeakMap<NavBuilding, BuildingInfo>();
/** Rules-derived stats (floors, material, hit points, civil/protected, breachable) of a nav building. */
export function infoOf(bd: NavBuilding): BuildingInfo {
  let i = infoCache.get(bd);
  if (!i) { i = buildingInfo(bd); infoCache.set(bd, i); }
  return i;
}
/** Hit points left of a building (full when never hit); 0 when it already fell. */
export function buildingHp(b: Battle, rt: NavRT, id: number): number {
  const bd = rt.data.buildings[id - 1];
  if (!bd || rt.rub.has(id)) return 0;
  return b.bldHp?.[id] ?? infoOf(bd).hp;
}
export const isDestroyed = (b: Battle, id: number): boolean => !!navOf(b.map)?.rub.has(id);

/** Reduce a building's hit points; at 0 it collapses. Returns true when it fell. */
export function damageBuilding(b: Battle, rt: NavRT, id: number, dmg: number, by: Rubble['by'], side: 0 | 1 | -1): boolean {
  const bd = rt.data.buildings[id - 1];
  if (!bd || rt.rub.has(id) || dmg <= 0) return false;
  const hp = (b.bldHp?.[id] ?? infoOf(bd).hp) - dmg;
  if (hp > 0) { (b.bldHp ??= {})[id] = Math.round(hp * 100) / 100; return false; }
  if (b.bldHp) delete b.bldHp[id];
  destroyBuilding(b, rt, id, by, side);
  return true;
}

/** Blast of a projectile on the buildings within its radius (no-op for bullets and small blasts). */
export function hitBuildings(b: Battle, rt: NavRT, p: Proj, c: number): void {
  const k = BUILDING_DMG_K[p.kind];
  if (!k || p.ar < BUILDING_MIN_AREA) return;
  const R = Math.max(1, Math.ceil(p.ar / rt.cs)), n = rt.n, cx = c % n, cy = (c - cx) / n;
  let seen: number[] | null = null;
  for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) {
    const X = cx + i, Y = cy + j;
    if (X < 0 || Y < 0 || X >= n || Y >= n) continue;
    const q = Y * n + X, id = rt.bld[q];
    if (!id || (seen && seen.includes(id))) continue;
    // distance from the impact to the nearest footprint cell centre of that building
    let dmin = 1e9;
    const x1 = p.x1, y1 = p.y1;
    for (const bc of rt.bcells[id]) { const [qx, qy] = navCenter(rt, bc); const d = Math.hypot(qx - x1, qy - y1); if (d < dmin) dmin = d; }
    (seen ??= []).push(id);
    if (dmin > p.ar) continue;
    damageBuilding(b, rt, id, p.dmg * k * (0.35 + 0.65 * (1 - dmin / p.ar)), p.kind === 'bullet' ? 'shell' : p.kind, p.side);
  }
}

/** Collapse: record the rubble, patch only the footprint cells, hurt whoever is inside, drop stale paths, raise the event. */
export function destroyBuilding(b: Battle, rt: NavRT, id: number, by: Rubble['by'], side: 0 | 1 | -1): void {
  const bd = rt.data.buildings[id - 1];
  if (!bd || rt.rub.has(id)) return;
  const info = infoOf(bd), cells = rt.bcells[id];
  // people inside when the roof comes down (before the footprint stops being a building)
  const inside = b.ents.filter((e) => e.alive && !e.gone && UNITS[e.kind].mob !== 'air' && rt.bld[navCell(rt, e.x, e.y)] === id);
  for (const e of inside) damage(b, e, COLLAPSE_DMG.base + COLLAPSE_DMG.perFloor * info.floors, 0, 2, 0.8, side === -1 ? 0 : side);
  // squads garrisoned / entering the ruin
  for (const s of b.squads) {
    if (s.gar === id) { const l = b.garr?.[id]; if (l) delete b.garr![id]; delete s.gar; delete s.inb; if (s.order === 'occupy') s.order = 'idle'; }
    else if (s.inb === id) { delete s.inb; if (s.order === 'occupy') { s.order = 'idle'; s.path = []; s.pi = 0; delete s.pend; } }
    if (s.brk === id) delete s.brk;
  }
  if (b.garr?.[id]) delete b.garr[id];
  const rec: Rubble = { id, t: Math.round(b.t * 100) / 100, x: Math.round(bd.cx * 10) / 10, y: Math.round(bd.cy * 10) / 10, h: Math.round(bd.h * 10) / 10, fl: info.floors, m: info.mat, by };
  if (bd.kind) rec.k = bd.kind;
  (b.map.rub ??= []).push(rec);
  applyRubble(rt, id);
  rt.owner = b.map; // the runtime now carries this battle's destruction
  invalidateRoutes(b, rt, cells);
  const weight = Math.round(civilWeight(info) * 100) / 100;
  b.urbanHits += weight * COLLATERAL_PER_WEIGHT;
  (b.ev ??= []).push({ k: 'buildingDestroyed', id, x: rec.x, y: rec.y, kind: bd.kind ?? 'house', floors: info.floors, h: rec.h, civil: info.civil, prot: info.prot, weight, by, side, t: b.t });
}

/** Squads whose remaining path passes near the patched cells search again (deferred, under the per-tick search budget). */
export function invalidateRoutes(b: Battle, rt: NavRT, cells: number[]): void {
  if (!cells.length) return;
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const c of cells) { const [x, y] = navCenter(rt, c); if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const m = rt.cs * 3;
  x0 -= m; y0 -= m; x1 += m; y1 += m;
  for (const s of b.squads) {
    if (!s.path.length) continue;
    let hit = false;
    for (let i = Math.max(0, s.pi - 2); i + 3 < s.path.length && !hit; i += 2) hit = segBox(s.path[i], s.path[i + 1], s.path[i + 2], s.path[i + 3], x0, y0, x1, y1);
    if (!hit && s.pi + 1 < s.path.length) hit = segBox(s.x, s.y, s.path[s.pi], s.path[s.pi + 1], x0, y0, x1, y1);
    if (!hit) continue;
    if (s.order === 'move' || s.order === 'amove') { s.pend = [s.ox, s.oy]; s.path = []; s.pi = 0; } else { s.path = []; s.pi = 0; s.repath = -99; }
  }
}
/** Segment vs axis-aligned box (Liang-Barsky). */
function segBox(ax: number, ay: number, bx: number, by: number, x0: number, y0: number, x1: number, y1: number): boolean {
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dy = by - ay;
  for (const [p, q] of [[-dx, ax - x0], [dx, x1 - ax], [-dy, ay - y0], [dy, y1 - ay]] as [number, number][]) {
    if (p === 0) { if (q < 0) return false; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
  }
  return true;
}

/**
 * A breaching tracked squad whose anchor is about to enter a small building: stand and demolish it (time + light damage to the vehicles).
 * Returns true while the squad is busy (the caller skips movement).
 */
export function stepBreach(b: Battle, rt: NavRT, s: Squad, hx: number, hy: number, step: number): boolean {
  if (s.brk !== undefined) {
    const id = s.brk;
    if (rt.rub.has(id)) { delete s.brk; return false; }
    return work(b, rt, s, id);
  }
  const ahead = navCell(rt, s.x + hx * (step + rt.cs * 0.5), s.y + hy * (step + rt.cs * 0.5));
  if (!rt.brk[ahead]) return false;
  const id = rt.bld[ahead];
  if (!id) return false;
  s.brk = id; s.face = Math.atan2(hx, hy);
  return work(b, rt, s, id);
}
function work(b: Battle, rt: NavRT, s: Squad, id: number): boolean {
  const c = cacheOf(b), dps = BREACH.dps[s.kind] ?? 15, ents = c.sqEnts[s.id] ?? [];
  const veh = ents.map((i) => b.ents[i]);
  for (const e of veh) e.hp = Math.max(1, e.hp - UNITS[e.kind].hp * BREACH.selfDps * DT);
  const fell = damageBuilding(b, rt, id, dps * (veh.length || 1) ** 0.5 * DT, 'breach', s.side);
  if (fell) { for (const e of veh) e.hp = Math.max(1, e.hp - UNITS[e.kind].hp * BREACH.selfDone); delete s.brk; return false; }
  s.digging = false; s.dug = 0;
  return true;
}
