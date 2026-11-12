/** Daily logistics: supply, fuel, attrition, recovery, reinforcement, upkeep, blockades, fog of war, rebels, power. */
import type { CountryId, Cost, Ctx, LonLat } from '../../core/contracts';
import { UNITS } from './catalog';
import { type Apis3, clamp, dist, envOf, mod, r3 } from './env';
import { allForms, createFormation, formationsOf, removeFormation, S, stockOf, strengthOf } from './forces';
import type { Formation } from './types';

const STRIDE = 3;
const dayOf = (ctx: Ctx) => Math.floor(ctx.state.time.hours / 24);

/** Friendly = own, or allied (shares depots). */
const friendly = (A: Apis3, c: CountryId, ctl: CountryId | undefined) => ctl === c || (!!ctl && !!A.dip?.allied(c, ctl));

function landSupplyTarget(ctx: Ctx, A: Apis3, f: Formation): number {
  const ctl = ctx.state.world.controller;
  if (!f.pr) return 0.6;
  if (friendly(A, f.c, ctl[f.pr])) return 1;
  // Distance to the closest friendly-controlled province (BFS over neighbours, 4 rings).
  const w = ctx.world;
  let ring = [f.pr];
  const seen = new Set(ring);
  let best = Infinity;
  for (let depth = 0; depth < 4 && best === Infinity; depth++) {
    const next: string[] = [];
    for (const pid of ring) for (const n of w.provinceById.get(pid)?.neighbors ?? []) {
      if (seen.has(n)) continue;
      seen.add(n);
      if (friendly(A, f.c, ctl[n])) best = Math.min(best, dist(f.p, w.provinceById.get(n)!.centroid));
      else next.push(n);
    }
    ring = next;
  }
  return best === Infinity ? 0 : clamp(1.05 - best / 450, 0, 1);
}

function navalSupplyTarget(ctx: Ctx, A: Apis3, f: Formation): number {
  let d = Infinity;
  const ports = ctx.world.ports;
  for (const pi of ctx.world.portsByCountry.get(f.c) ?? []) d = Math.min(d, dist(f.p, [ports[pi].lon, ports[pi].lat]));
  if (d === Infinity) return 0.5;
  return clamp(1.1 - d / 5000, 0.35, 1) * (1 + 0.0 * mod(A, f.c, 'mil.supply'));
}

export function logisticsDay(ctx: Ctx, A: Apis3): void {
  const st = S(ctx);
  const byC = new Map<CountryId, { fuel: number; cost: Cost }>();
  // Each formation is processed every STRIDE days (deltas scaled) to keep the daily cost low.
  const day = dayOf(ctx);
  const list = allForms(ctx).slice();
  for (let i = 0; i < list.length; i++) {
    const f = list[i];
    if ((i + day) % STRIDE) continue;
    if (f.reb) {
      f.s = 0.7;
      continue;
    }
    const moving = !!f.rt;
    let fuel = 0;
    let logi = 0;
    for (const s of f.u) {
      fuel += UNITS[s.t].fuel * s.k * s.s * (moving ? 1 : 0.04) * STRIDE;
      if (s.t === 'logistics') logi += s.k * s.s;
    }
    const a = byC.get(f.c) ?? { fuel: 0, cost: {} };
    a.fuel += fuel;
    byC.set(f.c, a);
    const sh = st.sh[f.c] ?? [1, 1];
    let target: number;
    if (f.cr) target = 0.9;
    else if (f.d === 'air') target = f.home && friendly(A, f.c, ctx.state.world.controller[ctx.world.airports[f.home.index]?.provinceId ?? '']) ? 1 : 0.5;
    else if (f.d === 'naval') target = navalSupplyTarget(ctx, A, f);
    else target = Math.min(1, landSupplyTarget(ctx, A, f) + Math.min(0.3, 0.1 * logi));
    target = clamp(target * (0.6 + 0.4 * sh[0]) * (0.6 + 0.4 * sh[1]) * Math.min(1.15, mod(A, f.c, 'mil.supply')), 0, 1);
    f.s = r3(f.s + clamp(target - f.s, -0.15 * STRIDE, 0.2 * STRIDE));
    const still = !f.rt && !f.bt;
    if (still) {
      f.o = r3(Math.min(1, f.o + 0.12 * STRIDE * f.s * mod(A, f.c, 'mil.org')));
      f.m = r3(Math.min(1, f.m + (0.02 + 0.02 * f.s) * STRIDE));
      if (f.d === 'land') f.e = r3(Math.min(1, f.e + (f.od.k === 'defend' ? 0.4 : 0.2) * STRIDE * mod(A, f.c, 'mil.entrench')));
    }
    if (f.s < 0.25 && !f.cr) {
      f.o = r3(Math.max(0, f.o - 0.06 * STRIDE));
      for (const s of f.u) s.s = r3(Math.max(0, s.s - 0.004 * STRIDE));
      if (strengthOf(f) < 0.05) removeFormation(ctx, f, true);
    }
  }
  // Fuel and ammunition stocks per country.
  for (const [c, a] of byC) {
    const eco = A.eco;
    if (!eco) continue;
    const got = a.fuel > 0 ? eco.consume(c, 'oil', a.fuel) : 0;
    st.sh[c] = [a.fuel > 0.01 ? clamp(got / a.fuel, 0, 1) : 1, eco.stock(c, 'munitions') > 0.5 ? 1 : 0.4];
  }
  reinforceDay(ctx, A);
  blockadeDay(ctx, A);
}

function reinforceDay(ctx: Ctx, A: Apis3): void {
  const eco = A.eco;
  if (!eco) return;
  const st = S(ctx);
  const day = dayOf(ctx);
  const list = allForms(ctx).slice();
  for (let i = 0; i < list.length; i++) {
    const f = list[i];
    if ((i + day) % STRIDE || f.reb || f.bt || f.rt || f.cr || f.s < 0.5 || f.od.k === 'strike') continue;
    let miss = 0, men = 0, money = 0;
    for (const s of f.u) {
      const t = UNITS[s.t];
      if (s.s >= 0.999) continue;
      const d = Math.min(1 - s.s, 0.02 * STRIDE);
      miss += d;
      men += d * s.k * t.men * 0.5;
      money += d * s.k * (t.cost.money ?? 0) * 0.3;
    }
    if (miss <= 0) continue;
    const home = f.d === 'land' ? !!f.pr && ctx.state.world.controller[f.pr] === f.c : !!f.home;
    if (!home) continue;
    if (!eco.canAfford(f.c, { money })) continue;
    const need = Math.ceil(men);
    const got = need > 0 ? eco.drawManpower(f.c, need) : 0;
    const ratio = need > 0 ? got / need : 1;
    if (ratio <= 0.01) continue;
    eco.charge(f.c, { money: money * ratio }, 'mil.cost.reinforce');
    for (const s of f.u) if (s.s < 0.999) s.s = r3(Math.min(1, s.s + Math.min(1 - s.s, 0.02 * STRIDE) * ratio));
  }
}

function blockadeDay(ctx: Ctx, A: Apis3): void {
  const st = S(ctx), now = ctx.state.time.hours;
  for (const k in st.blk) if (st.blk[k] < now) delete st.blk[k];
  const hit = new Map<CountryId, Set<CountryId>>();
  for (const id in st.forms) {
    const f = st.forms[id];
    if (f.od.k !== 'blockade' || f.rt || f.d !== 'naval' || f.o < 0.3) continue;
    const port = ctx.world.ports[f.od.port];
    if (!port || dist(f.p, [port.lon, port.lat]) > 120) continue;
    const owner = port.provinceId ? ctx.state.world.controller[port.provinceId] : null;
    if (!owner || !A.dip?.atWar(f.c, owner)) continue;
    const warships = f.u.reduce((a, s) => a + (UNITS[s.t].naval > 0 ? s.k * s.s : 0), 0);
    if (warships < 0.5) continue;
    st.blk[f.od.port] = now + 60;
    (hit.get(owner) ?? hit.set(owner, new Set()).get(owner)!).add(f.c);
  }
  for (const [victim, by] of hit) {
    if (blockadeRatio(ctx, victim) < 0.5) continue;
    for (const c of by) ctx.dispatch({ type: 'eco.setBlockade', country: c, target: victim, untilHours: now + 60 });
  }
}

/** Share of the country's port capacity (size-weighted) currently blockaded. */
export function blockadeRatio(ctx: Ctx, c: CountryId): number {
  const st = S(ctx);
  let all = 0, blocked = 0;
  for (const pi of ctx.world.portsByCountry.get(c) ?? []) {
    const p = ctx.world.ports[pi];
    if (!p.provinceId || ctx.state.world.controller[p.provinceId] !== c) continue;
    const w = 1 + p.size * 2;
    all += w;
    if (st.blk[pi] !== undefined) blocked += w;
  }
  return all > 0 ? blocked / all : 0;
}

export function upkeepPerDay(ctx: Ctx, A: Apis3, c: CountryId): Cost {
  let money = 0;
  for (const f of formationsOf(ctx, c)) for (const s of f.u) money += UNITS[s.t].upkeep * s.k * (0.4 + 0.6 * s.s);
  const sk = stockOf(ctx, c);
  money += sk.cruise * UNITS.cruise_missile.upkeep + sk.ballistic * UNITS.ballistic_missile.upkeep + sk.nuke * UNITS.nuke.upkeep;
  return { money: r3(money * mod(A, c, 'mil.upkeep')) };
}

export function powerOfCountry(ctx: Ctx, c: CountryId): number {
  const env = envOf(ctx.world), day = dayOf(ctx);
  const hit = env.powerCache.get(c);
  if (hit && hit.day === day && hit.ref === S(ctx)) return hit.v;
  let v = 0;
  for (const f of formationsOf(ctx, c)) for (const s of f.u) v += (s.k * s.s * UNITS[s.t].pts * (0.5 + 0.5 * f.o)) / 10;
  const sk = stockOf(ctx, c);
  v += sk.cruise * 0.2 + sk.ballistic + sk.nuke * 20;
  v = Math.round(v);
  env.powerCache.set(c, { day, v, ref: S(ctx) });
  return v;
}

// ------------------------------------------------------------------ fog of war

interface Vision {
  until: number;
  cells: Map<number, true>;
}
const visCache = new WeakMap<object, Map<CountryId, Vision>>();
const vcell = (lon: number, lat: number) => Math.floor(lon) * 1000 + Math.floor(lat);

function buildVision(ctx: Ctx, A: Apis3, viewer: CountryId): Vision {
  const cells = new Map<number, true>();
  const add = (p: LonLat, km: number) => {
    const dLat = km / 111, dLon = km / (111 * Math.max(0.2, Math.cos((p[1] * Math.PI) / 180)));
    for (let x = Math.floor(p[0] - dLon); x <= Math.floor(p[0] + dLon); x++)
      for (let y = Math.floor(p[1] - dLat); y <= Math.floor(p[1] + dLat); y++) cells.set(vcell(((x + 180) % 360 + 360) % 360 - 180, y), true);
  };
  const vm = mod(A, viewer, 'mil.vision');
  for (const f of formationsOf(ctx, viewer)) {
    let r = 0;
    for (const s of f.u) r = Math.max(r, UNITS[s.t].vis);
    add(f.p, r * vm);
  }
  for (const ally of ctx.world.countries) if (ally.id !== viewer && A.dip?.allied(viewer, ally.id)) for (const f of formationsOf(ctx, ally.id)) add(f.p, 15 * vm);
  if (A.eco) for (const s of A.eco.structures({ country: viewer, kind: 'radar', includeUnfinished: false })) add([s.lon, s.lat], 300 * mod(A, viewer, 'mil.radar.range'));
  for (const pid of ctx.api.worldDyn.provincesControlledBy(viewer)) {
    const p = ctx.world.provinceById.get(pid);
    if (p) cells.set(vcell(p.centroid[0], p.centroid[1]), true);
  }
  return { until: ctx.state.time.hours + 6, cells };
}

export function visibleTo(ctx: Ctx, A: Apis3, viewer: CountryId, f: Formation): boolean {
  if (f.c === viewer) return true;
  if (!f.reb && A.dip?.allied(viewer, f.c)) return true;
  if (f.pr && ctx.state.world.controller[f.pr] === viewer) return true;
  let m = visCache.get(ctx);
  if (!m) visCache.set(ctx, (m = new Map()));
  let v = m.get(viewer);
  if (!v || v.until < ctx.state.time.hours || ctx.state.time.hours < v.until - 6) m.set(viewer, (v = buildVision(ctx, A, viewer)));
  return v.cells.has(vcell(f.p[0], f.p[1]));
}

// ------------------------------------------------------------------ rebels

export function spawnRebels(ctx: Ctx, country: CountryId, province: string, lon: number, lat: number, strength: number): void {
  const st = S(ctx);
  for (const id in st.forms) if (st.forms[id].reb && st.forms[id].pr === province) return;
  const k = clamp(Math.round(strength * 6) + 1, 1, 14);
  const f = createFormation(ctx, 'REB', 'land', [lon, lat], [{ t: 'infantry', k, s: 1 }, { t: 'special_forces', k: Math.max(1, k >> 3), s: 0.8 }], null, { exp: 0.1, name: 'Rebeldes' });
  f.reb = country;
  f.pr = province;
  f.m = 0.8;
  ctx.bus.emit({ type: 'mil.rebelsSpawned', province, country, formation: f.id });
  ctx.news('military', 'mil.news.rebels', { country, province }, { province }, { countries: [country], importance: 2 });
}

export function rebelsDay(ctx: Ctx, A: Apis3): void {
  const st = S(ctx);
  for (const id of Object.keys(st.forms)) {
    const f = st.forms[id];
    if (!f?.reb) continue;
    if (!f.pr) continue;
    // Rebels hold the ground once no government troops are near for a while; they wither if starved of recruits.
    let gov = false;
    for (const g of formationsOf(ctx, f.reb)) if (g.d === 'land' && dist(g.p, f.p) < 40) gov = true;
    f.e = r3(Math.min(1, f.e + 0.2));
    f.o = r3(Math.min(1, f.o + 0.05));
    if (!gov && ctx.rng.chance(0.15)) ctx.bus.emit({ type: 'mil.rebelsHold', province: f.pr, country: f.reb });
    if (ctx.rng.chance(0.01)) for (const s of f.u) s.s = r3(s.s * 0.9);
  }
  void A;
}
