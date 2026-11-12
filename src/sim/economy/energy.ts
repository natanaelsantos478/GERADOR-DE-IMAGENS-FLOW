/** Power grid: real plants × capacity factor × health × fuel availability, demand, blackouts, interconnector trade. */
import type { CountryId, Ctx } from '../../core/contracts';
import { FUELS } from '../../core/contracts';
import { CF, MWH_PER_KBBL, MWH_PER_TU } from './balance';
import type { CountryEco } from './types';
import { RES_LIST } from './types';
import { cache, clamp, isAuto, isPlayer, plantsOf, sys, tryMod, weightOf } from './util';

const FI = (f: string) => FUELS.indexOf(f as never);
const OIL = RES_LIST.indexOf('oil'), URA = RES_LIST.indexOf('uranium');
const I_OIL = FI('oil'), I_NUC = FI('nuclear'), I_WIND = FI('wind'), I_SOLAR = FI('solar'), I_OTHER = FI('other');

export function territoryFactor(ctx: Ctx, c: CountryId, e: CountryEco): number {
  return e.w0 > 0 ? clamp(weightOf(ctx, c) / e.w0, 0.02, 1.6) : 1;
}

export function demandMw(ctx: Ctx, c: CountryId, e: CountryEco, tf: number): number {
  const gdpPc = (e.gdpPot * 1e6) / Math.max(1, e.pop);
  const growth = Math.pow(Math.max(0.3, gdpPc / e.base.gdpPc0), 0.45);
  return e.base.demandMw0 * (e.pop / e.base.pop0) * growth * tryMod(ctx, c, 'eco.energyDemand') * tf;
}

const NF = FUELS.length;
/** Undamaged generation (MW × capacity factor) per fuel for the plants the country controls (cached). */
function staticGen(ctx: Ctx, c: CountryId): Float64Array {
  const ch = cache(ctx);
  let g = ch.gen.get(c);
  if (!g) {
    g = new Float64Array(NF);
    for (const pi of plantsOf(ctx, c)) g[ch.plantFuel[pi]] += ch.plantGen[pi];
    ch.gen.set(c, g);
  }
  return g;
}

/** Plant damage corrections for today: country → per-fuel MW lost (built once per day from the sparse damage map). */
export function plantDamageToday(ctx: Ctx): Map<CountryId, Float64Array> {
  const out = new Map<CountryId, Float64Array>();
  const ch = cache(ctx), dm = ctx.state.world.plantDamage;
  for (const k in dm) {
    const pi = +k, p = ctx.world.plants[pi];
    const c = p.provinceId ? ctx.api.worldDyn.controllerOf(p.provinceId) : p.countryId;
    if (!c) continue;
    let a = out.get(c);
    if (!a) out.set(c, (a = new Float64Array(NF)));
    a[ch.plantFuel[pi]] += ch.plantGen[pi] * dm[pi];
  }
  return out;
}

/** Daily grid update for one country. */
export function updateEnergy(ctx: Ctx, c: CountryId, e: CountryEco, dmg?: Float64Array): void {
  const tf = territoryFactor(ctx, c, e);
  const gen = e.energy.byFuel;
  const st = staticGen(ctx, c);
  for (let i = 0; i < NF; i++) gen[i] = dmg ? st[i] - dmg[i] : st[i];
  const solar = tryMod(ctx, c, 'eco.solar'), wind = tryMod(ctx, c, 'eco.wind'), nuc = tryMod(ctx, c, 'eco.nuclear');
  const built = cache(ctx).built.get(c);
  if (built) {
    for (const s of built) {
      if (s.kind === 'powerPlant' && s.fuel && s.mw) gen[FI(s.fuel)] += s.mw * CF[s.fuel] * (1 - s.damage);
    }
  }
  gen[I_SOLAR] *= solar; gen[I_WIND] *= wind; gen[I_NUC] *= nuc;
  gen[I_OIL] *= e.fuelAvail[0]; gen[I_NUC] *= e.fuelAvail[1];
  gen[I_OTHER] += e.base.unlistedMw * tf;
  // Fuel burn: oil plants (kbbl) and nuclear plants (t U) draw on the national stock.
  const oilNeed = (gen[I_OIL] * 24) / MWH_PER_KBBL, uraNeed = (gen[I_NUC] * 24) / MWH_PER_TU;
  if (oilNeed > 0) {
    const used = Math.min(oilNeed, e.stock[OIL]);
    e.stock[OIL] -= used;
    e.fuelAvail[0] = used / oilNeed;
  } else e.fuelAvail[0] = 1;
  if (uraNeed > 0) {
    const used = Math.min(uraNeed, e.stock[URA]);
    e.stock[URA] -= used;
    e.fuelAvail[1] = used / uraNeed;
  } else e.fuelAvail[1] = 1;

  const loss = 1 + (1 - tryMod(ctx, c, 'eco.gridLoss'));
  let supply = 0;
  for (let i = 0; i < NF; i++) supply += gen[i];
  supply = supply * loss + e.energy.importMw - e.energy.exportMw;
  const demand = demandMw(ctx, c, e, tf);
  const prev = e.energy.ratio;
  e.energy.supplyMw = supply;
  e.energy.demandMw = demand;
  e.energy.ratio = demand > 1e-9 ? supply / demand : 1;
  if (prev >= 0.97 && e.energy.ratio < 0.97) {
    ctx.bus.emit({ type: 'eco.blackout', country: c, ratio: e.energy.ratio });
    if (isPlayer(ctx, c)) ctx.news('economy', 'eco.news.blackout', { ratio: Math.round(e.energy.ratio * 100) }, { country: c }, { countries: [c], importance: 2 });
  }
}

export function cityInBlackout(ctx: Ctx, cityIdx: number): boolean {
  const city = ctx.world.cities[cityIdx];
  if (!city) return false;
  const c = city.provinceId ? ctx.api.worldDyn.controllerOf(city.provinceId) : city.countryId;
  const e = c ? ctx.state.economy.c[c] : undefined;
  if (!e) return false;
  const r = e.energy.ratio;
  return r < 1 && cache(ctx).prio[cityIdx] > r;
}

const PRICE_MWH_WEEK = (40 * 24 * 7) / 1e6; // M USD per MW-week at 40 USD/MWh

/** Weekly: settle last week's flows, then renegotiate interconnector contracts. */
export function energyWeekly(ctx: Ctx): void {
  const s = ctx.state.economy;
  const wd = ctx.api.worldDyn;
  const flows: Array<[CountryId, CountryId, number]> = [];
  for (const [id, e] of Object.entries(s.c)) {
    if (e.energy.importMw <= 0 && e.energy.exportMw <= 0) continue;
    e.energy.importMw = 0; e.energy.exportMw = 0;
  }
  // Surplus available for export per country.
  const surplus = new Map<CountryId, number>();
  const sur = (c: CountryId): number => {
    let v = surplus.get(c);
    if (v === undefined) {
      const e = s.c[c];
      const gen = e.energy.byFuel.reduce((a, b) => a + b, 0);
      v = Math.max(0, gen - e.energy.demandMw * 1.04);
      surplus.set(c, v);
    }
    return v;
  };
  const link = (from: CountryId, to: CountryId, mw: number) => {
    const a = s.c[from], b = s.c[to];
    if (!a || !b || mw <= 0 || !wd.isAlive(from) || !wd.isAlive(to)) return 0;
    const m = Math.min(mw, sur(from) * 0.9);
    if (m < 1) return 0;
    surplus.set(from, sur(from) - m);
    a.energy.exportMw += m; b.energy.importMw += m;
    flows.push([from, to, m]);
    return m;
  };
  for (const k of s.contracts) link(k.from, k.to, k.mw);
  for (const [id, e] of Object.entries(s.c)) {
    if (!wd.isAlive(id) || !isAuto(ctx, id, 'eco.trade')) continue;
    const gen = e.energy.byFuel.reduce((a, b) => a + b, 0);
    let deficit = e.energy.demandMw * 1.02 - (gen + e.energy.importMw - e.energy.exportMw);
    if (deficit <= 1) continue;
    const country = ctx.world.countryById.get(id);
    for (const n of country?.neighbors ?? []) {
      if (deficit <= 1) break;
      if (!s.c[n] || s.embargo[n]?.includes(id) || s.embargo[id]?.includes(n)) continue;
      if (sys(ctx, 'diplomacy')?.atWar(id, n)) continue;
      deficit -= link(n, id, Math.min(deficit, 3000));
    }
  }
  s.contracts = s.contracts.filter((k) => s.c[k.from] && s.c[k.to]);
  // Payment for the (previous) agreed flows is settled at renegotiation using the new flows as proxy.
  for (const [from, to, mw] of flows) {
    const money = mw * PRICE_MWH_WEEK;
    s.c[from].treasury += money; s.c[to].treasury -= money;
    s.c[from].tradeNet += money; s.c[to].tradeNet -= money;
  }
}
