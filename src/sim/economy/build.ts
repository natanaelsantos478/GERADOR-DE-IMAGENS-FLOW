/** Construction catalog/queue, structure effects, infrastructure repair and builder automation. */
import type { CountryId, Ctx, Fuel, InfraKind, ProvinceId, StockResource, StructureId, StructureKind } from '../../core/contracts';
import { FUELS } from '../../core/contracts';
import { haversineKm } from '../../core/geo';
import {
  BASE_CONCURRENT, BUILDABLE_FUELS, CAPEX_PER_MW, CATALOG, CF, FUEL_UNLOCK, MAINT_RATE, PLANT_DAYS, PLANT_SIZES, PRICE0, STEEL_PER_MW, type CatalogDef,
} from './balance';
import type { BuildOption, CountryEco, InfraTarget, StructRec } from './types';
import { RES_LIST } from './types';
import { type Agg, cache, clamp, completeStructure, isAuto, isPlayer, rebuildStructures, structId, tryMod, tryUnlocked, warEnemies } from './util';

const defOf = (kind: StructureKind, variant: string): CatalogDef | undefined => CATALOG.find((d) => d.kind === kind && d.variant === variant);

function priceLevel(e: CountryEco): number {
  return clamp(0.5 + 0.5 * (e.base.gdpPc0 / 20000), 0.5, 1.3);
}

export interface Quote {
  cost: Partial<Record<StockResource, number>>;
  days: number;
}

export function quote(ctx: Ctx, c: CountryId, def: CatalogDef, opts: { fuel?: Fuel; mw?: number; km?: number }): Quote {
  const e = ctx.state.economy.c[c];
  const k = priceLevel(e) * tryMod(ctx, c, 'eco.buildCost');
  let money = def.capex, days = def.days, steel = def.steel;
  if (def.kind === 'powerPlant') {
    const fuel = opts.fuel!, mw = opts.mw!;
    money = mw * CAPEX_PER_MW[fuel];
    days = PLANT_DAYS[fuel] * (0.8 + 0.2 * Math.sqrt(mw / 500));
    steel = mw * STEEL_PER_MW[fuel];
  } else if (def.kind === 'road' || def.kind === 'railway') {
    const km = opts.km ?? 50;
    money = def.capex * km;
    steel = def.steel * km;
    days = def.kind === 'road' ? 60 + km * 2 : 90 + km * 4;
  }
  const cost: Quote['cost'] = { money: Math.round(money * k * 10) / 10 };
  if (steel > 0) cost.steel = Math.round(steel * k * 10) / 10;
  if (def.electronics > 0) cost.electronics = Math.round(def.electronics * k * 10) / 10;
  return { cost, days: Math.round(days / tryMod(ctx, c, 'eco.buildSpeed')) };
}

function ownsAndControls(ctx: Ctx, c: CountryId, p: ProvinceId): boolean {
  return ctx.api.worldDyn.ownerOf(p) === c && ctx.api.worldDyn.controllerOf(p) === c;
}

function blockedReason(ctx: Ctx, c: CountryId, def: CatalogDef, province: ProvinceId | null, fuel?: Fuel): string | undefined {
  if (!tryUnlocked(ctx, c, def.unlock, true)) return 'eco.err.techLocked';
  if (fuel && !tryUnlocked(ctx, c, FUEL_UNLOCK(fuel), ['coal', 'gas', 'oil', 'hydro'].includes(fuel))) return 'eco.err.techLocked';
  if (def.kind === 'silo' && !(cache(ctx).built.get(c) ?? []).some((s) => s.kind === 'militaryBase')) return 'eco.err.needsBase';
  const q = cache(ctx).building.get(c)?.length ?? 0;
  const e = ctx.state.economy.c[c];
  if (q >= maxConcurrent(e) * (def.kind === 'powerPlant' ? 4 : 1)) return 'eco.err.queueFull';
  if (province) {
    const p = ctx.world.provinceById.get(province);
    if (!p) return 'eco.err.badLocation';
    if (!ownsAndControls(ctx, c, province)) return 'eco.err.notOwned';
    if (def.needs === 'coast' && !p.coastal) return 'eco.err.needsCoast';
    if (def.needs === 'city') {
      const m = ctx.world.mainCityOf(province);
      if (m === null || ctx.world.cities[m].pop < 50000) return 'eco.err.needsCity';
    }
  }
  return undefined;
}

/** Everything the player can build in a province (with costs, durations and block reasons) for the UI. */
export function buildOptions(ctx: Ctx, c: CountryId, province: ProvinceId | null): BuildOption[] {
  const out: BuildOption[] = [];
  for (const def of CATALOG) {
    if (def.kind === 'powerPlant') {
      for (const fuel of BUILDABLE_FUELS) {
        for (const mw of PLANT_SIZES) {
          if (fuel === 'nuclear' && mw < 500) continue;
          const q = quote(ctx, c, def, { fuel, mw });
          out.push({ id: `powerPlant:${fuel}:${mw}`, kind: 'powerPlant', variant: fuel, fuel, mw, cost: q.cost, days: q.days, nameKey: `eco.build.plant.${fuel}`, blocked: blockedReason(ctx, c, def, province, fuel) });
        }
      }
      continue;
    }
    const q = quote(ctx, c, def, {});
    out.push({ id: def.variant === def.kind ? def.kind : `${def.kind}:${def.variant}`, kind: def.kind, variant: def.variant, cost: q.cost, days: q.days, nameKey: def.nameKey, blocked: blockedReason(ctx, c, def, province) });
  }
  return out;
}

export type StartResult = { ok: true; id: StructureId } | { ok: false; reason: string };

export function startBuild(
  ctx: Ctx, c: CountryId, a: { kind: StructureKind; variant?: string; province: ProvinceId; lon?: number; lat?: number; mw?: number; nodes?: [number, number] },
): StartResult {
  const e = ctx.state.economy.c[c];
  if (!e || !ctx.api.worldDyn.isAlive(c)) return { ok: false, reason: 'eco.err.noCountry' };
  const variant = a.variant ?? (a.kind === 'powerPlant' ? 'gas' : a.kind);
  const def = a.kind === 'powerPlant' ? CATALOG[0] : defOf(a.kind, variant);
  if (!def) return { ok: false, reason: 'eco.err.unknownKind' };
  const fuel = a.kind === 'powerPlant' ? (variant as Fuel) : undefined;
  if (fuel && !BUILDABLE_FUELS.includes(fuel)) return { ok: false, reason: 'eco.err.unknownKind' };
  const mw = fuel ? clamp(Math.round(a.mw ?? 200), fuel === 'nuclear' ? 500 : 1, 5000) : undefined;
  const bad = blockedReason(ctx, c, def, a.province, fuel);
  if (bad) return { ok: false, reason: bad };
  let lon: number, lat: number, km: number | undefined, nodes: [number, number] | undefined;
  const prov = ctx.world.provinceById.get(a.province)!;
  if (a.kind === 'road' || a.kind === 'railway') {
    const r = ctx.world.roads;
    if (!a.nodes || a.nodes[0] === a.nodes[1] || a.nodes.some((n) => !Number.isInteger(n) || n < 0 || n >= r.nodeCount)) return { ok: false, reason: 'eco.err.badNodes' };
    nodes = a.nodes;
    const [n1, n2] = nodes;
    for (const n of nodes) {
      const pr = ctx.world.locateProvince(r.nodeLon[n], r.nodeLat[n]);
      if (!pr || ctx.api.worldDyn.ownerOf(pr) !== c) return { ok: false, reason: 'eco.err.notOwned' };
    }
    km = haversineKm(r.nodeLon[n1], r.nodeLat[n1], r.nodeLon[n2], r.nodeLat[n2]) * 1.2;
    lon = (r.nodeLon[n1] + r.nodeLon[n2]) / 2; lat = (r.nodeLat[n1] + r.nodeLat[n2]) / 2;
  } else if (a.lon !== undefined && a.lat !== undefined) {
    if (ctx.world.locateProvince(a.lon, a.lat) !== a.province) return { ok: false, reason: 'eco.err.badLocation' };
    lon = a.lon; lat = a.lat;
  } else {
    const m = ctx.world.mainCityOf(a.province);
    if (m !== null) { lon = ctx.world.cities[m].lon; lat = ctx.world.cities[m].lat; }
    else [lon, lat] = prov.centroid;
  }
  const q = quote(ctx, c, def, { fuel, mw, km });
  // Missing steel / electronics is bought on the spot at 150 % of the reference price.
  for (const r of ['steel', 'electronics'] as const) {
    const need = q.cost[r] ?? 0, have = e.stock[RES_LIST.indexOf(r)];
    if (need > have) {
      q.cost.money = (q.cost.money ?? 0) + (need - have) * PRICE0[r] * 1.5;
      if (have > 0) q.cost[r] = have; else delete q.cost[r];
    }
  }
  if (!ctx.api.economy.charge(c, q.cost, 'eco.ledger.construction')) return { ok: false, reason: 'eco.err.noMoney' };
  const s = ctx.state.economy;
  const id = structId(s.nextStruct++);
  const rec: StructRec = {
    id, kind: a.kind, variant, country: c, province: a.province, lon, lat, progress: 0, days: Math.max(1, q.days), paid: q.cost.money ?? 0, damage: 0,
    startedHours: ctx.state.time.hours,
  };
  if (fuel) { rec.fuel = fuel; rec.mw = mw; }
  if (nodes) rec.nodes = nodes;
  s.structures[id] = rec;
  const b = cache(ctx).building;
  (b.get(c) ?? b.set(c, []).get(c)!).push(rec);
  ctx.bus.emit({ type: 'eco.structureStarted', id, kind: a.kind, country: c, province: a.province });
  return { ok: true, id };
}

export function cancelBuild(ctx: Ctx, c: CountryId, id: StructureId): string | null {
  const s = ctx.state.economy, rec = s.structures[id];
  if (!rec || rec.country !== c) return 'eco.err.unknownStructure';
  if (rec.progress >= 1) return 'eco.err.alreadyBuilt';
  ctx.api.economy.credit(c, rec.paid * 0.5 * (1 - rec.progress), 'eco.ledger.refund');
  delete s.structures[id];
  rebuildStructures(ctx);
  return null;
}

/** Daily: advance this country's construction queue and repair jobs. */
export function dailyBuild(ctx: Ctx, c: CountryId, e: CountryEco): void {
  const list = cache(ctx).building.get(c);
  if (!list || !list.length) return;
  const speed = clamp(Math.sqrt(e.spend.infrastructure), 0.5, 1.4) * (e.treasury < 0 ? 0.5 : 1) * tryMod(ctx, c, 'eco.buildSpeed');
  for (const s of list.slice()) {
    if (ctx.api.worldDyn.controllerOf(s.province) !== c) continue;
    s.progress = Math.min(1, s.progress + speed / s.days);
    if (s.progress >= 1) {
      completeStructure(ctx, s);
      ctx.bus.emit({ type: 'eco.structureCompleted', id: s.id, kind: s.kind, country: c, province: s.province, lon: s.lon, lat: s.lat });
      if (isPlayer(ctx, c)) {
        ctx.news('economy', 'eco.news.structureDone', { kind: s.kind, fuel: s.fuel ?? '', mw: s.mw ?? 0 }, { lon: s.lon, lat: s.lat }, { countries: [c], importance: 1 });
      }
    }
  }
}

export function getAgg(ctx: Ctx, c: CountryId): Agg {
  const ch = cache(ctx);
  let a = ch.agg.get(c);
  if (a) return a;
  a = { gdpAdd: 0, milFactories: 0, hospitals: 0, universities: 0, ports: 0, airports: 0, bases: 0, roads: 0, prodAdd: new Array<number>(RES_LIST.length).fill(0), maint: 0, n: 0 };
  for (const s of ch.built.get(c) ?? []) {
    const h = 1 - s.damage;
    const def = defOf(s.kind, s.kind === 'powerPlant' ? 'plant' : s.variant);
    a.n++;
    a.maint += (s.paid * MAINT_RATE) / 12;
    if (def?.gdpYield) a.gdpAdd += s.paid * def.gdpYield * h;
    if (def?.resource) {
      const i = RES_LIST.indexOf(def.resource);
      a.prodAdd[i] += (s.paid * 0.0015 * h) / PRICE0[def.resource];
    }
    switch (s.kind) {
      case 'militaryFactory': a.milFactories += h; break;
      case 'hospital': a.hospitals += h; break;
      case 'university': a.universities += h; break;
      case 'port': a.ports += h; break;
      case 'airport': a.airports += h; break;
      case 'militaryBase': a.bases += h; break;
      case 'road': case 'railway': a.roads += h; break;
      default:
    }
  }
  ch.agg.set(c, a);
  return a;
}

// ------------------------------------------------------------------ repair

const KIND_OF: Record<InfraTarget, InfraKind> = { city: 'city', plant: 'plant', airport: 'airport', port: 'port', road: 'road' };

export function infraCountry(ctx: Ctx, infra: InfraTarget, index: number): CountryId | null {
  const w = ctx.world;
  const prov = infra === 'city' ? w.cities[index]?.provinceId : infra === 'plant' ? w.plants[index]?.provinceId
    : infra === 'airport' ? w.airports[index]?.provinceId : infra === 'port' ? w.ports[index]?.provinceId : undefined;
  if (infra === 'road') {
    if (index < 0 || index >= w.roads.edgeCount) return null;
    const n = w.roads.edgeA[index];
    const p = w.locateProvince(w.roads.nodeLon[n], w.roads.nodeLat[n]);
    return p ? ctx.api.worldDyn.controllerOf(p) : null;
  }
  const item = infra === 'city' ? w.cities[index] : infra === 'plant' ? w.plants[index] : infra === 'airport' ? w.airports[index] : w.ports[index];
  if (!item) return null;
  return prov ? ctx.api.worldDyn.controllerOf(prov) : item.countryId;
}

function assetValue(ctx: Ctx, infra: InfraTarget, index: number): number {
  const w = ctx.world;
  switch (infra) {
    case 'city': return (w.cities[index].pop / 1000) * 0.5;
    case 'plant': return w.plants[index].mw * CAPEX_PER_MW[w.plants[index].fuel];
    case 'airport': return [20, 100, 400][w.airports[index].size];
    case 'port': return [20, 100, 400][w.ports[index].size];
    case 'road': return w.roads.edgeKm[index] * [8, 3, 2, 5, 4][w.roads.edgeCls[index]];
  }
}

export function repairQuote(ctx: Ctx, infra: InfraTarget, index: number): { cost: number; days: number; damage: number } {
  const damage = ctx.api.worldDyn.damageOf(KIND_OF[infra], index);
  return { cost: damage * assetValue(ctx, infra, index) * 0.5, days: Math.ceil(7 + damage * 60), damage };
}

export function startRepair(ctx: Ctx, c: CountryId, infra: InfraTarget, index: number): string | null {
  const s = ctx.state.economy;
  if (!Number.isInteger(index) || index < 0) return 'eco.err.badLocation';
  const owner = infraCountry(ctx, infra, index);
  if (owner === null) return 'eco.err.badLocation';
  if (owner !== c) return 'eco.err.notOwned';
  const q = repairQuote(ctx, infra, index);
  if (q.damage < 0.005) return 'eco.err.noDamage';
  if (s.repairs.some((r) => r.infra === infra && r.index === index)) return 'eco.err.alreadyRepairing';
  if (!ctx.api.economy.charge(c, { money: q.cost }, 'eco.ledger.repair')) return 'eco.err.noMoney';
  s.repairs.push({ id: s.nextRepair++, country: c, infra, index, daysLeft: q.days, perDay: q.damage / q.days });
  return null;
}

export function dailyRepairs(ctx: Ctx): void {
  const s = ctx.state.economy;
  if (!s.repairs.length) return;
  const keep = [];
  for (const r of s.repairs) {
    const mult = tryMod(ctx, r.country, 'eco.buildSpeed');
    ctx.api.worldDyn.repair(KIND_OF[r.infra], r.index, r.perDay * mult);
    r.daysLeft -= mult;
    if (r.daysLeft <= 0 || ctx.api.worldDyn.damageOf(KIND_OF[r.infra], r.index) <= 0.001) {
      ctx.api.worldDyn.repair(KIND_OF[r.infra], r.index, 1);
      ctx.bus.emit({ type: 'eco.repairDone', infra: r.infra, index: r.index, country: r.country });
    } else keep.push(r);
  }
  s.repairs = keep;
}

/** Weekly: automated countries queue repairs of their most valuable damaged assets. */
export function autoRepair(ctx: Ctx): void {
  const wd = ctx.state.world;
  const cand: Array<{ c: CountryId; infra: InfraTarget; idx: number; score: number }> = [];
  const scan = (infra: InfraTarget, map: Record<number, number>) => {
    for (const k in map) {
      const idx = +k;
      if (map[idx] < 0.03) continue;
      const c = infraCountry(ctx, infra, idx);
      if (!c || !isAuto(ctx, c, 'eco.build') || !ctx.state.economy.c[c]) continue;
      cand.push({ c, infra, idx, score: map[idx] * assetValue(ctx, infra, idx) });
    }
  };
  scan('plant', wd.plantDamage); scan('city', wd.cityDamage); scan('airport', wd.airportDamage); scan('port', wd.portDamage); scan('road', wd.roadDamage);
  cand.sort((a, b) => b.score - a.score);
  const per = new Map<CountryId, number>();
  for (const x of cand) {
    const n = per.get(x.c) ?? 0;
    if (n >= 4) continue;
    const e = ctx.state.economy.c[x.c];
    const q = repairQuote(ctx, x.infra, x.idx);
    if (e.treasury < q.cost * 3) continue;
    if (startRepair(ctx, x.c, x.infra, x.idx) === null) per.set(x.c, n + 1);
  }
}

// ------------------------------------------------------------------ structure damage & views

export function damageStructure(ctx: Ctx, id: StructureId, amount: number, cause: string): number {
  const rec = ctx.state.economy.structures[id];
  if (!rec || amount <= 0) return 0;
  const applied = Math.min(1 - rec.damage, amount);
  rec.damage += applied;
  cache(ctx).agg.delete(rec.country);
  shiftServiceIndex(ctx, rec, -applied);
  if (applied > 0) ctx.bus.emit({ type: 'eco.structureDamaged', id, amount: applied, cause });
  return applied;
}

export function repairStructure(ctx: Ctx, id: StructureId, amount: number): number {
  const rec = ctx.state.economy.structures[id];
  if (!rec || amount <= 0) return 0;
  const done = Math.min(rec.damage, amount);
  rec.damage -= done;
  cache(ctx).agg.delete(rec.country);
  shiftServiceIndex(ctx, rec, done);
  return done;
}

/** Keeps the per-city hospital/university index equal to what `rebuildStructures` (reload) would compute. */
function shiftServiceIndex(ctx: Ctx, rec: { kind: string; progress: number; province: string }, delta: number): void {
  if (rec.progress < 1 || (rec.kind !== 'hospital' && rec.kind !== 'university')) return;
  const ch = cache(ctx);
  const arr = rec.kind === 'hospital' ? ch.cityHosp : ch.cityUni;
  for (const ci of ctx.world.citiesByProvince.get(rec.province) ?? []) arr[ci] += delta;
}

// ------------------------------------------------------------------ automation

const FUEL_WEIGHT: Record<Fuel, number> = { coal: 0.5, gas: 1, oil: 0.1, nuclear: 0.25, hydro: 0.3, wind: 0.6, solar: 0.7, biomass: 0.05, geothermal: 0.05, other: 0 };

function pickProvince(ctx: Ctx, c: CountryId, pred?: (p: ProvinceId) => boolean): ProvinceId | null {
  const owned = ctx.api.worldDyn.provincesOwnedBy(c).filter((p) => ctx.api.worldDyn.controllerOf(p) === c && (!pred || pred(p)));
  if (!owned.length) return null;
  const ch = cache(ctx);
  const i = ctx.rng.weightedIndex(owned.map((p) => ch.provWeight.get(p) ?? 1));
  return owned[i < 0 ? 0 : i];
}

const roundMw = (mw: number): number => { const step = mw > 500 ? 50 : mw > 50 ? 10 : 1; return Math.ceil(mw / step) * step; };

export function maxConcurrent(e: CountryEco): number {
  return BASE_CONCURRENT + Math.round(e.spend.infrastructure * 2) + Math.floor(Math.log10(Math.max(1, e.gdp / 1e4)) * 2);
}

/** Monthly builder AI (also used for the player when `eco.build` automation is on). */
export function autoBuild(ctx: Ctx, c: CountryId, e: CountryEco): void {
  const ch = cache(ctx);
  const monthlySpend = Object.values(e.base.spend).reduce((a, b) => a + b, 0) / 12;
  const reserve = 1.5 * monthlySpend;
  const afford = (cost: Partial<Record<StockResource, number>>, mult = 1) => (cost.money ?? 0) * mult + reserve < e.treasury;
  const queue = () => ch.building.get(c) ?? [];
  // 1) Power: keep supply (incl. plants being built) above projected demand; up to 3 projects per cycle.
  for (let iter = 0; iter < 3 && queue().length < maxConcurrent(e) * 4; iter++) {
    let pending = 0;
    for (const s of queue()) if (s.kind === 'powerPlant') pending += (s.mw ?? 0) * CF[s.fuel ?? 'gas'];
    const need = e.energy.demandMw * 1.06 - (e.energy.supplyMw + pending);
    if (!(need > Math.max(0.5, e.energy.demandMw * 0.015) && e.energy.demandMw > 0)) break;
    const share = e.energy.byFuel;
    const total = Math.max(1, share.reduce((a, b) => a + b, 0));
    const weights = BUILDABLE_FUELS.map((f) => {
      const have = share[FUELS.indexOf(f)] / total;
      const locked = !tryUnlocked(ctx, c, FUEL_UNLOCK(f), ['coal', 'gas', 'oil', 'hydro'].includes(f));
      const big = f === 'nuclear' ? (e.gdp > 150000 ? 1 : 0) : 1;
      return locked ? 0 : (FUEL_WEIGHT[f] * 0.6 + have) * big * (f === 'oil' ? (e.stock[0] > 20 * e.cons[0] ? 1 : 0.1) : 1);
    });
    const wi = ctx.rng.weightedIndex(weights);
    const p = wi >= 0 ? pickProvince(ctx, c) : null;
    if (wi < 0 || !p) break;
    const fuel = BUILDABLE_FUELS[wi];
    const nameplate = clamp(roundMw((need * 1.25) / CF[fuel]), fuel === 'nuclear' ? 500 : 1, 5000);
    const q = quote(ctx, c, CATALOG[0], { fuel, mw: nameplate });
    const money = q.cost.money ?? 0;
    // Grid projects may be financed with debt when the treasury is short.
    const room = Math.max(0, e.gdp * 1.2 - e.debt) * 0.3;
    if (!(afford(q.cost, 1.2) || (money < e.treasury + room && e.rating < 7))) break;
    if (money * 1.05 > e.treasury) { const loan = money * 1.05 - e.treasury; e.debt += loan; e.treasury += loan; }
    if (!startBuild(ctx, c, { kind: 'powerPlant', variant: fuel, province: p, mw: nameplate }).ok) break;
  }
  if (queue().filter((s) => s.kind !== 'powerPlant').length >= maxConcurrent(e)) return;
  // 2) Food shortages.
  const food = RES_LIST.indexOf('food');
  if (e.short[food] > 0.02 || (e.cons[food] > 0 && e.stock[food] < 10 * e.cons[food])) {
    const p = pickProvince(ctx, c);
    const def = defOf('farm', 'farm')!;
    if (p && afford(quote(ctx, c, def, {}).cost, 1.5) && startBuild(ctx, c, { kind: 'farm', province: p }).ok) return;
  }
  const building = queue();
  const counts = (k: StructureKind) => (ch.built.get(c) ?? []).filter((s) => s.kind === k).length + building.filter((s) => s.kind === k).length;
  const surplus = e.balance > 0 && e.treasury > 6 * monthlySpend;
  const bigCity = (kind: StructureKind) => pickProvince(ctx, c, (p) => {
    const m = ctx.world.mainCityOf(p);
    return m !== null && ctx.world.cities[m].pop >= 80000 && !ch.provCount.has(`${p}|${kind}`) && !building.some((s) => s.province === p && s.kind === kind);
  });
  const tryKind = (kind: StructureKind, where: ProvinceId | null): boolean => {
    const def = defOf(kind, kind);
    if (!def || !where || blockedReason(ctx, c, def, where)) return false;
    return afford(quote(ctx, c, def, {}).cost, 2) && startBuild(ctx, c, { kind, province: where }).ok;
  };
  if (surplus && counts('hospital') < Math.floor(e.pop / 9e6) + 1 && tryKind('hospital', bigCity('hospital'))) return;
  if (surplus && counts('university') < Math.floor(e.pop / 14e6) + 1 && tryKind('university', bigCity('university'))) return;
  if (warEnemies(ctx, c).length > 0 && e.treasury > 4 * monthlySpend && counts('militaryFactory') < 6 && tryKind('militaryFactory', pickProvince(ctx, c))) return;
  if (surplus && e.approval < 70 && counts('civilFactory') < 40) tryKind('civilFactory', pickProvince(ctx, c));
}
