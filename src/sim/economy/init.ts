/** New-game economy slice built from the real country statistics. */
import type { CountryId, Ctx } from '../../core/contracts';
import { FUELS } from '../../core/contracts';
import { CF, DEFAULT_TAX, ELEC_BOOST, MWH_PER_KBBL, MWH_PER_TU, PILLAR_WEIGHT, PRICE0, RARE_EARTH_SHARE, STEEL_BOOST, TAX_BASE, URANIUM_SHARE } from './balance';
import type { CountryEco, EconomyState, Pillar, Sector } from './types';
import { PILLARS, RES_LIST } from './types';
import { clamp, hash01, ownedWeight } from './util';

const R = (r: string) => RES_LIST.indexOf(r as never);

export function createEconomySlice(ctx: Ctx): EconomyState {
  const w = ctx.world;
  const nR = RES_LIST.length;
  const cs: Record<CountryId, CountryEco> = {};
  const plantUseOil: Record<string, number> = {};
  let nuclearTU = 0;

  // Pass 1: per-country basics.
  for (const country of w.countries) {
    const id = country.id;
    const st = w.stats[id];
    const pop = Math.max(1, st?.pop ?? 1000);
    const gdp = Math.max(1, (st?.gdpUsd ?? 5e7) / 1e6);
    const gdpPc = (gdp * 1e6) / pop;
    const collect = clamp(0.55 + 0.45 * Math.log10(Math.max(gdpPc, 300) / 1000) * 1.0, 0.35, 1.5);
    const rev0 = gdp * (TAX_BASE.income * DEFAULT_TAX.income + TAX_BASE.corporate * DEFAULT_TAX.corporate + TAX_BASE.consumption * DEFAULT_TAX.consumption) * collect;
    const milExp = (st?.milExpUsd ?? 0) / 1e6;
    const defense = milExp;
    const pool = Math.max(rev0 * 0.985 - defense, rev0 * 0.4);
    const spend = { defense } as Record<Pillar, number>;
    for (const k of PILLARS) if (k !== 'defense') spend[k] = pool * PILLAR_WEIGHT[k];

    const oilVal = ((st?.oilProdBpd ?? 0) * 80 * 365) / 1e6;
    const extraction = clamp(oilVal / gdp + 0.01, 0.01, 0.6);
    const agro = clamp(0.4 * Math.pow(gdpPc / 500, -0.55), 0.005, 0.4);
    const industry = clamp(0.27 * (1 - extraction), 0.05, 0.35);
    const energy = 0.03;
    const shares: Record<Sector, number> = { agro, industry, energy, extraction, services: Math.max(0.05, 1 - agro - industry - energy - extraction) };

    const demandMw0 = (pop * (st?.electricityKwhPc ?? 500)) / 1000 / 8760;
    let supply = 0;
    for (const pi of w.plantsByCountry.get(id) ?? []) {
      const p = w.plants[pi];
      supply += p.mw * CF[p.fuel];
      if (p.fuel === 'oil') plantUseOil[id] = (plantUseOil[id] ?? 0) + (p.mw * CF.oil * 24) / MWH_PER_KBBL;
      if (p.fuel === 'nuclear') nuclearTU += (p.mw * CF.nuclear * 24) / MWH_PER_TU;
    }
    const unlistedMw = Math.max(0, demandMw0 * 1.02 - supply);
    const byFuel = new Array<number>(FUELS.length).fill(0);
    for (const pi of w.plantsByCountry.get(id) ?? []) byFuel[FUELS.indexOf(w.plants[pi].fuel)] += w.plants[pi].mw * CF[w.plants[pi].fuel];
    byFuel[FUELS.indexOf('other')] += unlistedMw;

    const prod = new Array<number>(nR).fill(0);
    const cons = new Array<number>(nR).fill(0);
    const day = gdp / 365;
    const techF = clamp(Math.log10(Math.max(gdpPc, 500) / 1000) + 0.6, 0.15, 2);
    prod[R('oil')] = (st?.oilProdBpd ?? 0) / 1000;
    prod[R('food')] = (day * agro * 0.72) / PRICE0.food;
    prod[R('steel')] = (day * industry * 0.05 * (STEEL_BOOST[id] ?? 1)) / PRICE0.steel;
    prod[R('electronics')] = day * industry * 0.12 * techF * (ELEC_BOOST[id] ?? 1);
    prod[R('munitions')] = (spend.defense / 365) * 0.25;
    prod[R('consumerGoods')] = day * industry * 0.35;
    cons[R('oil')] = day * (0.6 + 0.4 * (industry / 0.27));
    cons[R('food')] = (pop * 1.1) / 1e6;
    cons[R('steel')] = day * (0.3 + industry);
    cons[R('electronics')] = day * (0.5 + 0.5 * techF);
    cons[R('consumerGoods')] = day * 0.5 + (pop * 4e-6);

    const ph = hash01(id);
    cs[id] = {
      treasury: rev0 / 6, debt: 0, gdp, gdpPot: gdp, eff: 1, growth: st?.gdpGrowth ?? 2, pop, manpower: pop * 0.008,
      tax: { ...DEFAULT_TAX }, spend: { health: 1, education: 1, security: 1, infrastructure: 1, social: 1, defense: 1, research: 1 }, shares,
      base: { spend, collect, gdpPc0: gdpPc, pop0: pop, demandMw0, unlistedMw, defaultTax: { ...DEFAULT_TAX }, prod, cons },
      stock: new Array<number>(nR).fill(0), prod: prod.slice(), cons: cons.slice(), short: new Array<number>(nR).fill(0),
      energy: { supplyMw: demandMw0 * 1.02, demandMw: demandMw0, ratio: 1.02, byFuel, importMw: 0, exportMw: 0 },
      fuelAvail: [1, 1], inflation: 0.02, rating: 2, stability: 60, approval: 55, warWeary: 0, ideo: ph * 2 - 1, strike: 0, lowStabDays: 0,
      nextElection: (1 + Math.floor(hash01(id + 'e') * 1461)) * 24, milUpkeep: 0, tradeNet: 0, balance: 0, w0: 0, modPrev: 0,
    };
  }

  // Pass 2: strategic minerals from real producer shares; world balance of the rest.
  const ids = w.countries.map((c) => c.id);
  const sum = (f: (id: string) => number) => ids.reduce((a, id) => a + f(id), 0);
  const reSum = sum((id) => RARE_EARTH_SHARE[id] ?? 0), uSum = sum((id) => URANIUM_SHARE[id] ?? 0);
  const worldRE = 1000; // tonnes/day
  const worldU = Math.max(0.5, (nuclearTU * 1.1) / 1); // tonnes/day
  for (const id of ids) {
    const e = cs[id];
    e.base.prod[R('rareEarth')] = ((RARE_EARTH_SHARE[id] ?? 0) / reSum) * worldRE;
    e.base.prod[R('uranium')] = ((URANIUM_SHARE[id] ?? 0) / uSum) * worldU;
    e.base.cons[R('rareEarth')] = e.base.cons[R('electronics')];
  }
  // Poor countries are near subsistence in food and basic goods (they cannot finance big imports).
  const SUBS: Array<[typeof RES_LIST[number], number]> = [['food', 0.99], ['consumerGoods', 0.9]];
  const subsistent = new Set<string>();
  for (const id of ids) if (cs[id].base.gdpPc0 < 8000) subsistent.add(id);
  for (const [r, f] of SUBS) {
    const i = R(r);
    for (const id of subsistent) cs[id].base.cons[i] = cs[id].base.prod[i] > 0 ? Math.min(cs[id].base.cons[i], cs[id].base.prod[i] * f) : cs[id].base.cons[i];
  }
  for (const r of ['oil', 'food', 'steel', 'electronics', 'rareEarth', 'consumerGoods'] as const) {
    const i = R(r);
    const sub = r === 'food' || r === 'consumerGoods';
    const fixed = (id: string) => sub && subsistent.has(id);
    const P = sum((id) => cs[id].base.prod[i]);
    const useOil = r === 'oil' ? sum((id) => plantUseOil[id] ?? 0) : 0;
    const Dfix = sum((id) => (fixed(id) ? cs[id].base.cons[i] : 0));
    const D = sum((id) => (fixed(id) ? 0 : cs[id].base.cons[i]));
    const s = D > 0 ? Math.max(0.001, (P - useOil - Dfix) / D) : 0;
    for (const id of ids) if (!fixed(id)) cs[id].base.cons[i] *= s;
  }
  for (const id of ids) {
    const e = cs[id];
    e.w0 = ownedWeight(ctx, id);
    e.prod = e.base.prod.slice();
    e.cons = e.base.cons.slice();
    for (let i = 0; i < nR; i++) {
      const r = RES_LIST[i];
      const flow = r === 'uranium' ? e.base.prod[i] * 400 : r === 'munitions' ? e.base.prod[i] * 30 : (e.cons[i] + (r === 'oil' ? plantUseOil[id] ?? 0 : 0)) * 45;
      e.stock[i] = flow;
    }
    // Nuclear countries start with ~3 years of fuel.
    let tu = 0;
    for (const pi of w.plantsByCountry.get(id) ?? []) if (w.plants[pi].fuel === 'nuclear') tu += (w.plants[pi].mw * CF.nuclear * 24) / MWH_PER_TU;
    e.stock[R('uranium')] = Math.max(e.stock[R('uranium')], tu * 1100);
  }

  const sat = new Array<number>(w.cities.length).fill(55);
  return {
    c: cs, sat, structures: {}, nextStruct: 1, repairs: [], nextRepair: 1, unrest: [], contracts: [],
    prices: new Array<number>(nR).fill(1), embargo: {}, blockade: {}, history: [],
  };
}
