/** Squad order execution (pathing, anchor movement) and element movement toward formation slots. */
import { stepBreach } from './buildings';
import { incidentPace } from './incidents';
import { cellFactor, cellOf, findPath, inside, moveFactor } from './grid';
import { mudMult, SURFACE_RULES } from './terrainRules';
import { navCell, navCenter, navFactor, navOf, snapCell } from './nav';
import type { Battle, Ent, Squad } from './types';
import { UNITS, type Mobility } from './units';
import { DT, cacheOf, def, isAir, slotPos, wrapPi } from './util';

export function edgePoint(b: Battle, s: Squad): [number, number] {
  const half = b.map.sizeM / 2;
  return [Math.max(-half + 60, Math.min(half - 60, s.x)), s.side === 0 ? -half + 90 : half - 90];
}

/** Searches allowed per tick on a fine nav map; extra requests wait in `Squad.pend` (serialized, so the schedule is deterministic). */
const SEARCHES_PER_TICK = 3;
const used = new WeakMap<Battle, { k: number; n: number }>();
function takeSearch(b: Battle): boolean {
  const k = b.tick + (b.phase === 'deploy' ? 0.5 : 0);
  let u = used.get(b);
  if (!u || u.k !== k) { u = { k, n: 0 }; used.set(b, u); }
  return u.n++ < SEARCHES_PER_TICK;
}

export function setPath(b: Battle, s: Squad, x: number, y: number, force = false): boolean {
  const rt = navOf(b.map);
  if (rt && !force && !takeSearch(b)) { s.pend = [x, y]; s.path = []; s.pi = 0; return true; }
  delete s.pend;
  const p = findPath(b.map, UNITS[s.kind].mob, s.x, s.y, x, y, rt ? s.inb ?? 0 : 0, rt && s.order === 'occupy' ? s.inb ?? 0 : 0, !!s.breach);
  if (!p.length) { s.path = []; s.pi = 0; return false; }
  s.path = p; s.pi = 2; s.repath = b.t;
  return true;
}

/** Start the next marked leg (searched now, on demand); legs with no path are skipped. False when the route is over. */
export function nextLeg(b: Battle, s: Squad): boolean {
  while (s.route && s.route.length >= 2) {
    const x = s.route[0], y = s.route[1];
    s.route = s.route.slice(2);
    s.ox = x; s.oy = y; s.repath = b.t;
    if (setPath(b, s, x, y)) { if (!s.route.length) delete s.route; return true; }
  }
  delete s.route;
  return false;
}
/** Search again toward the current leg; when it is unreachable, go on with the next one; else the order ends. */
function replan(b: Battle, s: Squad): void {
  if (setPath(b, s, s.ox, s.oy, true) || nextLeg(b, s)) return;
  s.order = 'idle'; s.path = []; s.pi = 0; delete s.breach; delete s.brk;
}
/** The order is over: forget the marked route and breach flag. */
export function endMove(s: Squad): void { delete s.route; delete s.breach; delete s.brk; }

/** Free a garrisoned building (the squad keeps `inb` until all its elements are out). */
export function ungarrison(b: Battle, s: Squad): void {
  if (s.gar === undefined) return;
  const l = b.garr?.[s.gar];
  if (l) b.garr![s.gar] = l.filter((q) => q !== s.id);
  delete s.gar;
}
function garrison(b: Battle, s: Squad): void {
  s.gar = s.inb;
  const g = (b.garr ??= {});
  (g[s.gar!] ??= []).push(s.id);
  s.order = 'hold'; s.path = []; s.pi = 0; s.digging = false; s.dug = 0;
}

/** Squad speed multiplier: commander, fatigue and mud. */
export const squadPace = (b: Battle, s: Squad): number => incidentPace(b, s) * (s.fx?.spd ?? 1) * (1 - 0.35 * s.fg) * (1 - 0.3 * (b.wx?.mud ?? 0) * (UNITS[s.kind].mob === 'foot' ? 0.5 : 1));

export function stepSquads(b: Battle): void {
  const c = cacheOf(b);
  for (const s of b.squads) {
    const alive = c.sqEnts[s.id];
    if (!alive.length) continue;
    const d = UNITS[s.kind];
    if (s.pend && takeSearch(b)) {
      const [px, py] = s.pend;
      if (!setPath(b, s, px, py, true) && (s.order === 'move' || s.order === 'amove' || s.order === 'occupy') && !nextLeg(b, s)) { s.order = 'idle'; endMove(s); }
    }
    if (s.routed && s.order !== 'retreat') { s.order = 'retreat'; ungarrison(b, s); }
    if (s.order === 'retreat' && !s.path.length && !s.pend) { const [ex, ey] = edgePoint(b, s); if (!setPath(b, s, ex, ey)) { s.x = ex; s.y = ey; } }
    if (s.order === 'attack') {
      const tgt = b.squads[s.target];
      const tn = tgt ? c.sqEnts[tgt.id].length : 0;
      if (!tn) { s.order = 'idle'; s.path = []; }
      else if (!s.pend && (!s.path.length || b.t - s.repath > 6)) {
        const reach = Math.max(...d.w.filter((w) => !w.ind).map((w) => w.r), 100) * 0.6;
        const dist = Math.hypot(c.sqCx[tgt.id] - s.x, c.sqCy[tgt.id] - s.y);
        if (dist > reach) setPath(b, s, c.sqCx[tgt.id], c.sqCy[tgt.id]); else { s.path = []; s.repath = b.t; }
      }
    }
    const moving = (s.order === 'move' || s.order === 'amove' || s.order === 'retreat' || s.order === 'attack' || s.order === 'occupy') && s.path.length > 0 && s.pi < s.path.length;
    if (!moving) {
      if (s.path.length && s.pi >= s.path.length) {
        s.path = []; s.pi = 0;
        if ((s.order === 'move' || s.order === 'amove') && !nextLeg(b, s)) { s.order = 'idle'; endMove(s); }
        if (s.order === 'occupy') garrison(b, s);
        if (s.order === 'retreat' && (Math.abs(s.y) > b.map.sizeM / 2 - 140)) withdraw(b, s);
      }
      continue;
    }
    if (s.order === 'amove' && c.sqEngaged[s.id] && !s.routed) continue; // stand and fight
    if (c.sqSupp[s.id] > 0.8 && d.mob === 'foot') continue;
    const rt = navOf(b.map);
    const tx = s.path[s.pi], ty = s.path[s.pi + 1];
    const dx = tx - s.x, dy = ty - s.y, dist = Math.hypot(dx, dy);
    if (dist < 4) { s.pi += 2; continue; }
    const hx = dx / dist, hy = dy / dist;
    const lag = Math.min(1, Math.max(0.25, 1 - ((s.lag ?? 0) - 40) / 120));
    const sp = d.spd * moveFactor(b.map, s.x, s.y, hx, hy, d.mob, s.inb ?? 0) * (rt && b.wx?.mud && d.mob !== 'air' ? mudMult(SURFACE_RULES[rt.surf[navCell(rt, s.x, s.y)]], b.wx.mud, d.mob === 'foot' ? 0 : 1) : 1) * lag * (s.order === 'retreat' ? 1.1 : 1) * squadPace(b, s);
    const step = Math.min(dist, sp * DT);
    if (s.breach && rt && stepBreach(b, rt, s, hx, hy, step)) continue; // demolishing a small building in the way
    if (rt && d.mob !== 'air' && navFactor(rt, navCell(rt, s.x + hx * step, s.y + hy * step), d.mob, s.inb ?? 0) === 0) {
      // clipped a corner of an impassable cell: re-plan instead of walking into it
      if (s.order === 'move' || s.order === 'amove' || s.order === 'occupy') replan(b, s); else s.path = [];
      continue;
    }
    s.x += hx * step; s.y += hy * step;
    if (s.order !== 'attack' || dist > 20) s.face = Math.atan2(hx, hy);
    s.digging = false; s.dug = 0;
    if (s.order === 'retreat' && Math.abs(s.y) > b.map.sizeM / 2 - 100) { withdraw(b, s); }
  }
}

function withdraw(b: Battle, s: Squad): void {
  for (const e of b.ents) if (e.sq === s.id && e.alive) e.gone = true;
  s.path = []; s.order = 'idle';
}

/** Slot of element i on a nav map: building cells when garrisoned, else the formation slot moved to the nearest passable cell. */
function fitSlot(b: Battle, rt: NonNullable<ReturnType<typeof navOf>>, s: Squad, i: number, n: number, sp: number, mob: Mobility): [number, number] {
  if (s.gar !== undefined) {
    const cells = rt.bcells[s.gar];
    if (cells && cells.length) { const [x, y] = navCenter(rt, cells[i % cells.length]); const k = Math.floor(i / cells.length); return [x + k * 2, y + k * 2]; }
  }
  const [sx, sy] = slotPos(s, i, n, sp);
  const raw = navCell(rt, sx, sy);
  if (mob === 'air' || navFactor(rt, raw, mob, s.inb ?? 0) > 0) return [sx, sy];
  // pure function of (cell, mobility, building) -> safe to memoise per entity
  const key = raw * 8 + (s.inb ? 4 : 0) + (mob === 'foot' ? 0 : mob === 'wheel' ? 1 : 2);
  let m = snapMemo.get(b);
  if (!m) { m = new Map(); snapMemo.set(b, m); }
  const mk = key * 4096 + (i & 4095);
  let cc = m.get(mk);
  if (cc === undefined) { cc = snapCell(rt, mob, raw, 8, 0, s.inb ?? 0); m.set(mk, cc); if (m.size > 200_000) m.clear(); }
  return cc < 0 ? [sx, sy] : navCenter(rt, cc);
}
const snapMemo = new WeakMap<Battle, Map<number, number>>();

export function stepEnts(b: Battle): void {
  const c = cacheOf(b);
  const rt = navOf(b.map);
  c.sqLag.fill(0);
  for (const s of b.squads) {
    const ids = c.sqEnts[s.id];
    const n = ids.length;
    if (!n) { s.lag = 0; continue; }
    const d = UNITS[s.kind];
    let lag = 0;
    for (let i = 0; i < n; i++) {
      const e = b.ents[ids[i]];
      const [sx, sy] = rt ? fitSlot(b, rt, s, i, n, d.sp, d.mob) : slotPos(s, i, n, d.sp);
      const dx = sx - e.x, dy = sy - e.y, dist = Math.hypot(dx, dy);
      lag += dist;
      const pinned = d.mob === 'foot' && e.supp > 0.8;
      if (dist > 1.5 && !pinned) {
        const hx = dx / dist, hy = dy / dist;
        const f = moveFactor(b.map, e.x, e.y, hx, hy, d.mob, s.inb ?? 0);
        const step = Math.min(dist, d.spd * f * 1.3 * DT * squadPace(b, s));
        let nx = e.x + hx * step, ny = e.y + hy * step;
        const ok = (px: number, py: number) => isAir(e) || (inside(b.map, px, py) && (rt ? navFactor(rt, navCell(rt, px, py), d.mob, s.inb ?? 0) : cellFactor(b.map, cellOf(b.map, px, py), d.mob)) > 0);
        let go = ok(nx, ny);
        if (!go && rt) { if (ok(nx, e.y)) { ny = e.y; go = true; } else if (ok(e.x, ny)) { nx = e.x; go = true; } } // slide along obstacles
        if (go) {
          e.x = nx; e.y = ny;
          e.moving = true; e.still = 0;
          if (dist > 5) turn(e, Math.atan2(hx, hy), d.turn);
        } else { e.moving = false; e.still += DT; }
      } else {
        e.moving = false; e.still += DT;
        const ti = e.tg[0] >= 0 ? e.tg[0] : e.tg[1];
        if (e.still > 0.5 && s.fireFree && ti >= 0 && d.arm[0] > 150 && d.w[0] && !d.w[0].ind) {
          const t = b.ents[ti];
          turn(e, Math.atan2(t.x - e.x, t.y - e.y), d.turn);
        } else if (e.still > 0.5 && !(d.arm[0] > 150)) turn(e, s.face, d.turn);
        else if (e.still > 3 && !s.fireFree) turn(e, s.face, d.turn);
      }
    }
    c.sqLag[s.id] = s.lag = lag / n;
    if (rt && s.inb && s.gar === undefined && s.order !== 'occupy' && !ids.some((id) => rt.bld[navCell(rt, b.ents[id].x, b.ents[id].y)] === s.inb)) delete s.inb;
  }
}

function turn(e: Ent, to: number, rate: number): void {
  const diff = wrapPi(to - e.h), m = rate * DT;
  e.h = Math.abs(diff) <= m ? to : e.h + Math.sign(diff) * m;
}
