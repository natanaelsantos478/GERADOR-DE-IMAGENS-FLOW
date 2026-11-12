/** Air strikes, drone/cruise/ballistic missiles in flight, nuclear detonations, interception. */
import type { CommandResult, CountryId, Ctx, LonLat } from '../../core/contracts';
import { UNITS } from './catalog';
import { type Apis3, clamp, dist, mod, r3, r4 } from './env';
import { formationsOf, removeFormation, S, stockOf, strengthOf } from './forces';
import { airRadius, planAir } from './pathing';
import type { Flight, Formation, TargetRef } from './types';

const fail = (reason: string): CommandResult => ({ ok: false, reason });

export function targetPos(ctx: Ctx, t: TargetRef): LonLat | null {
  const w = ctx.world;
  switch (t.kind) {
    case 'city': return w.cities[t.index] ? [w.cities[t.index].lon, w.cities[t.index].lat] : null;
    case 'plant': return w.plants[t.index] ? [w.plants[t.index].lon, w.plants[t.index].lat] : null;
    case 'airport': return w.airports[t.index] ? [w.airports[t.index].lon, w.airports[t.index].lat] : null;
    case 'port': return w.ports[t.index] ? [w.ports[t.index].lon, w.ports[t.index].lat] : null;
    case 'road': {
      const g = w.roads;
      if (t.index < 0 || t.index >= g.edgeCount) return null;
      const a = g.edgeA[t.index], b = g.edgeB[t.index];
      return [(g.nodeLon[a] + g.nodeLon[b]) / 2, (g.nodeLat[a] + g.nodeLat[b]) / 2];
    }
    case 'formation': return S(ctx).forms[t.id]?.p ?? null;
  }
}

export function targetCountry(ctx: Ctx, t: TargetRef): CountryId | null {
  const w = ctx.world, ctl = ctx.state.world.controller;
  if (t.kind === 'formation') return S(ctx).forms[t.id]?.c ?? null;
  const pos = targetPos(ctx, t);
  if (!pos) return null;
  const arr = t.kind === 'city' ? w.cities : t.kind === 'plant' ? w.plants : t.kind === 'airport' ? w.airports : t.kind === 'port' ? w.ports : null;
  const pid = arr ? arr[t.index].provinceId : w.nearestProvince(pos[0], pos[1], 30);
  return pid ? (ctl[pid] ?? null) : null;
}

/** Air-defence intensity around a point for country `def` (≈ number of effective SAM battalions). */
function defenseIntensity(ctx: Ctx, A: Apis3, def: CountryId, pos: LonLat, missile: boolean): number {
  let sam = 0, cap = 0;
  for (const f of formationsOf(ctx, def)) {
    if (f.d === 'naval' && dist(f.p, pos) < 60) {
      for (const s of f.u) if (UNITS[s.t].air >= 5) sam += s.k * s.s * 0.4;
      continue;
    }
    const d = dist(f.p, pos);
    if (f.d === 'land' && d < 80) for (const s of f.u) if (s.t === 'air_defense') sam += s.k * s.s;
    if (f.d === 'air' && d < 350 && !missile) for (const s of f.u) if (s.t === 'fighter') cap += s.k * s.s * 0.25;
    if (f.d === 'air' && d < 350 && missile) for (const s of f.u) if (s.t === 'fighter') cap += s.k * s.s * 0.04;
  }
  if (A.eco) for (const st of A.eco.structures({ country: def, kind: 'airDefense', includeUnfinished: false })) if (dist(pos, [st.lon, st.lat]) < 70) sam += 1.5 * st.health;
  return (sam * mod(A, def, 'mil.sam.intercept') + cap) * (A.eco ? 1 : 1);
}

const WARHEAD = { cruise: 0.1, ballistic: 0.2, nuke: 1, drone: 0.04, bomber: 0.12, heli: 0.03, fighter: 0.015 } as const;
const TARGET_FACTOR = { city: 0.6, plant: 1.2, airport: 1.3, port: 1.1, road: 1.5, formation: 1.5 } as const;

function applyHit(ctx: Ctx, A: Apis3, attacker: CountryId, t: TargetRef, amount: number, cause: string): number {
  const dmg = clamp(amount * TARGET_FACTOR[t.kind], 0, 1);
  if (t.kind === 'formation') {
    const f = S(ctx).forms[t.id];
    if (!f) return 0;
    for (const s of f.u) s.s = r3(Math.max(0, s.s - dmg * 0.8 * UNITS[s.t].expo));
    f.o = r3(Math.max(0, f.o - dmg * 0.6));
    f.m = r3(Math.max(0, f.m - dmg * 0.3));
    if (strengthOf(f) < 0.05) removeFormation(ctx, f, true);
    return dmg;
  }
  const pos = targetPos(ctx, t)!;
  const done = A.wd.damage(t.kind, t.index, dmg, cause);
  if (A.eco) {
    const st = A.eco.structureAt(pos[0], pos[1], 3);
    if (st) A.eco.damageStructure(st.id, dmg, cause);
  }
  void attacker;
  return done;
}

function emitStrike(ctx: Ctx, attacker: CountryId, def: CountryId | null, weapon: string, target: TargetRef, pos: LonLat, intercepted: boolean, damage: number): void {
  ctx.bus.emit({ type: 'mil.strike', attacker, defender: def, weapon, target, pos, intercepted, damage: r3(damage) });
  if (!intercepted && damage > 0.02 && target.kind !== 'formation')
    ctx.news('military', 'mil.news.strike', { a: attacker, d: def ?? '', kind: target.kind }, { lon: pos[0], lat: pos[1] }, { countries: def ? [attacker, def] : [attacker], importance: 1 });
}

// ------------------------------------------------------------------ air missions

export function orderStrike(ctx: Ctx, A: Apis3, f: Formation, target: TargetRef): CommandResult {
  if (f.d !== 'air' || f.cr || f.bt) return fail('err.mil.notAir');
  if (f.od.k === 'strike') return fail('err.mil.onMission');
  const pos = targetPos(ctx, target), def = targetCountry(ctx, target);
  if (!pos || !def) return fail('err.mil.badTarget');
  if (def === f.c || !A.dip?.atWar(f.c, def)) return fail('err.mil.notAtWar');
  if (f.o < 0.4) return fail('err.mil.lowOrg');
  if (dist(f.p, pos) > airRadius(A, f)) return fail('err.mil.outOfRange');
  if (!f.u.some((s) => UNITS[s.t].soft + UNITS[s.t].hard > 4 && s.s > 0.1)) return fail('err.mil.noStrikeUnits');
  const r = planAir(A, f, pos);
  if (!r.ok) return fail(r.reason);
  f.od = { k: 'strike', target, phase: 'out' };
  f.rt = r.route;
  f.pend = false;
  return { ok: true };
}

/** Called when an air formation reaches its target (phase out) or home (phase back). */
export function onStrikeArrival(ctx: Ctx, A: Apis3, f: Formation): void {
  const od = f.od;
  if (od.k !== 'strike') return;
  if (od.phase === 'back') {
    f.od = { k: 'idle' };
    return;
  }
  const pos = targetPos(ctx, od.target), def = targetCountry(ctx, od.target);
  if (pos && def) {
    const I = defenseIntensity(ctx, A, def, pos, false);
    const lossFrac = clamp(0.06 * I, 0, 0.6);
    let power = 0;
    for (const s of f.u) {
      const t = UNITS[s.t];
      const key = s.t === 'bomber' ? 'bomber' : s.t === 'drone' ? 'drone' : s.t === 'attack_heli' ? 'heli' : s.t === 'fighter' ? 'fighter' : null;
      if (key) power += s.k * s.s * WARHEAD[key] * mod(A, f.c, t.group === 'air' ? 'mil.air.attack' : 'mil.missile.accuracy');
      s.s = r3(Math.max(0, s.s * (1 - lossFrac * (s.t === 'drone' ? 1.5 : 1))));
    }
    const dmg = applyHit(ctx, A, f.c, od.target, power * (1 - clamp(0.1 * I, 0, 0.8)), 'mil.airStrike');
    emitStrike(ctx, f.c, def, 'air', od.target, pos, false, dmg);
    f.x = r3(Math.min(1, f.x + 0.01));
  }
  f.o = r3(f.o * 0.8);
  if (strengthOf(f) < 0.05) return void removeFormation(ctx, f, true);
  const home = f.home ? ctx.world.airports[f.home.index] : null;
  const back: LonLat = home ? [home.lon, home.lat] : f.p;
  const r = planAir(A, f, back);
  f.od = { k: 'strike', target: od.target, phase: 'back' };
  if (r.ok) f.rt = r.route;
  else f.od = { k: 'idle' };
}

// ------------------------------------------------------------------ missiles

const MISSILE_RANGE = { cruise: 'cruise_missile', ballistic: 'ballistic_missile', nuke: 'ballistic_missile' } as const;

function origins(ctx: Ctx, c: CountryId, weapon: 'cruise' | 'ballistic' | 'nuke', A: Apis3): LonLat[] {
  const out: LonLat[] = [];
  const w = ctx.world, ctl = ctx.state.world.controller;
  for (const ci of w.citiesByCountry.get(c) ?? []) {
    const city = w.cities[ci];
    if (city.pop > 400_000 && city.provinceId && ctl[city.provinceId] === c) out.push([city.lon, city.lat]);
  }
  const cap = w.countryById.get(c)!.capital;
  out.push([cap.lon, cap.lat]);
  if (A.eco) for (const s of A.eco.structures({ country: c, kind: 'silo', includeUnfinished: false })) out.push([s.lon, s.lat]);
  if (weapon === 'cruise')
    for (const f of formationsOf(ctx, c)) if (f.d === 'naval' && f.u.some((s) => ['destroyer', 'frigate', 'submarine'].includes(s.t) && s.s > 0.2)) out.push(f.p);
  return out;
}

export function launch(ctx: Ctx, A: Apis3, c: CountryId, weapon: 'cruise' | 'ballistic' | 'nuke', target: TargetRef, from?: LonLat): CommandResult {
  const pos = targetPos(ctx, target), def = targetCountry(ctx, target);
  if (!pos || !def) return fail('err.mil.badTarget');
  if (def === c) return fail('err.mil.ownTarget');
  if (weapon !== 'nuke' && !A.dip?.atWar(c, def)) return fail('err.mil.notAtWar');
  if (weapon === 'nuke' && target.kind === 'formation') return fail('err.mil.badTarget');
  const sk = stockOf(ctx, c);
  if (weapon === 'cruise' ? sk.cruise < 1 : weapon === 'ballistic' ? sk.ballistic < 1 : sk.nuke < 1 || sk.ballistic < 1) return fail('err.mil.noMissiles');
  const rng = UNITS[MISSILE_RANGE[weapon]].radius * mod(A, c, 'mil.missile.range');
  let best: LonLat | null = null, bd = Infinity;
  for (const o of from ? [from] : origins(ctx, c, weapon, A)) {
    const d = dist(o, pos);
    if (d < bd) (bd = d), (best = o);
  }
  if (!best || bd > rng) return fail('err.mil.outOfRange');
  if (weapon === 'cruise') sk.cruise--;
  else if (weapon === 'ballistic') sk.ballistic--;
  else (sk.nuke--, sk.ballistic--);
  const v = UNITS[MISSILE_RANGE[weapon]].fly * mod(A, c, 'mil.missile.speed');
  const eta = ctx.state.time.hours + Math.max(0.3, bd / v);
  const fl: Flight = { id: S(ctx).nextFl++, c, w: weapon, from: [r4(best[0]), r4(best[1])], to: [r4(pos[0]), r4(pos[1])], target, t0: ctx.state.time.hours, eta: r3(eta) };
  S(ctx).flights.push(fl);
  ctx.bus.emit({ type: 'mil.missileLaunched', flight: fl.id, attacker: c, weapon, from: fl.from, to: fl.to, eta: fl.eta });
  return { ok: true, flight: fl.id, eta: fl.eta };
}

export function processFlights(ctx: Ctx, A: Apis3, dt: number): void {
  const st = S(ctx);
  if (st.rad.length) st.rad = st.rad.filter((r) => r.until > ctx.state.time.hours);
  if (!st.flights.length) return;
  const now = ctx.state.time.hours + dt;
  const keep: Flight[] = [];
  for (const fl of st.flights) {
    if (fl.eta > now) {
      keep.push(fl);
      continue;
    }
    const def = targetCountry(ctx, fl.target);
    const pos = targetPos(ctx, fl.target) ?? fl.to;
    const I = def ? defenseIntensity(ctx, A, def, pos, true) : 0;
    const abm = fl.w === 'cruise' ? mod(A, def ?? '', 'mil.sam.intercept') : mod(A, def ?? '', 'mil.abm.intercept');
    const pInt = 1 - Math.exp(-(fl.w === 'cruise' ? 0.35 : fl.w === 'ballistic' ? 0.12 : 0.1) * I * (fl.w === 'cruise' ? 1 : abm));
    if (ctx.rng.chance(clamp(pInt, 0, 0.92))) {
      emitStrike(ctx, fl.c, def, fl.w, fl.target, pos, true, 0);
      continue;
    }
    if (fl.w === 'nuke') {
      detonate(ctx, A, fl.c, def, pos);
      continue;
    }
    const dmg = applyHit(ctx, A, fl.c, fl.target, WARHEAD[fl.w] * mod(A, fl.c, 'mil.missile.accuracy'), `mil.${fl.w}`);
    emitStrike(ctx, fl.c, def, fl.w, fl.target, pos, false, dmg);
  }
  st.flights = keep;
}

export function detonate(ctx: Ctx, A: Apis3, attacker: CountryId, def: CountryId | null, pos: LonLat): void {
  const w = ctx.world, st = S(ctx);
  const y = mod(A, attacker, 'mil.nuke.yield');
  const R = 30 * Math.sqrt(y);
  const falloff = (d: number) => (d <= 0.35 * R ? 1 : d <= 0.7 * R ? 0.7 : d <= R ? 0.4 : 0);
  let killed = 0;
  w.cities.forEach((c) => {
    if (Math.abs(c.lat - pos[1]) > R / 100) return;
    const d = dist(pos, [c.lon, c.lat]);
    const k = falloff(d);
    if (k > 0) {
      A.wd.damage('city', c.index, k, 'mil.nuke');
      killed += c.pop * k * 0.45;
    }
  });
  const infra = [['plant', w.plants], ['airport', w.airports], ['port', w.ports]] as const;
  for (const [kind, arr] of infra) for (const o of arr) {
    if (Math.abs(o.lat - pos[1]) > R / 100) continue;
    const k = falloff(dist(pos, [o.lon, o.lat]));
    if (k > 0) A.wd.damage(kind, o.index, k, 'mil.nuke');
  }
  const nn = w.nearestRoadNode(pos[0], pos[1], R);
  if (nn !== null) for (let k = w.roads.adjStart[nn]; k < w.roads.adjStart[nn + 1]; k++) A.wd.damage('road', w.roads.adjEdge[k], 1, 'mil.nuke');
  for (const id of Object.keys(st.forms)) {
    const f = st.forms[id];
    if (f && f.d !== 'air' && dist(f.p, pos) < R * 0.7) {
      for (const s of f.u) s.s = r3(s.s * 0.1);
      f.o = 0;
      if (strengthOf(f) < 0.05) removeFormation(ctx, f, true);
    }
  }
  st.rad.push({ p: [r4(pos[0]), r4(pos[1])], until: ctx.state.time.hours + 24 * 30 });
  if (st.rad.length > 40) st.rad.shift();
  const province = w.locateProvince(pos[0], pos[1]);
  ctx.bus.emit({ type: 'mil.nukeDetonated', attacker, defender: def, country: attacker, targetCountry: def, pos, province, killedEstimate: Math.round(killed) });
  ctx.news('military', 'mil.news.nuke', { a: attacker, d: def ?? '' }, { lon: pos[0], lat: pos[1] }, { countries: def ? [attacker, def] : [attacker], importance: 2 });
  if (def && A.eco) A.eco.addUnrest({ country: def }, 25, 'mil.news.nuke', 60);
}

/** Targets an attacker may legitimately hit (at war), within `rangeKm` of `from`. */
export function validTargets(ctx: Ctx, A: Apis3, c: CountryId, from: LonLat, rangeKm: number, limit = 200): TargetRef[] {
  const out: { t: TargetRef; d: number }[] = [];
  const w = ctx.world, ctl = ctx.state.world.controller;
  const at = (pid: string | null) => !!pid && ctl[pid] !== c && !!A.dip?.atWar(c, ctl[pid]);
  const scan = <T extends { lon: number; lat: number; provinceId: string | null; index: number }>(arr: T[], kind: 'city' | 'plant' | 'airport' | 'port', min = 0) => {
    for (const o of arr) {
      if (Math.abs(o.lat - from[1]) > rangeKm / 100 || !at(o.provinceId)) continue;
      if ((o as unknown as { pop?: number }).pop !== undefined && (o as unknown as { pop: number }).pop < min) continue;
      const d = dist(from, [o.lon, o.lat]);
      if (d <= rangeKm) out.push({ t: { kind, index: o.index }, d });
    }
  };
  scan(w.cities, 'city', 100_000);
  scan(w.plants.filter((p) => p.mw >= 300), 'plant');
  scan(w.airports, 'airport');
  scan(w.ports, 'port');
  const st = S(ctx);
  for (const id in st.forms) {
    const f = st.forms[id];
    if (f.c !== c && A.dip?.atWar(c, f.c) && dist(from, f.p) <= rangeKm) out.push({ t: { kind: 'formation', id }, d: dist(from, f.p) });
  }
  return out.sort((a, b) => a.d - b.d).slice(0, limit).map((o) => o.t);
}
