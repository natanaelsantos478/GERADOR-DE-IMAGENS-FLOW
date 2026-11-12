/** economySystem: wires every economy module into the SimSystem contract and exposes `EconomyApi`. */
import type { Cost, CountryId, Ctx, EconomyApi, StockResource, StructureView } from '../../core/contracts';
import { haversineKm } from '../../core/geo';
import { defineSystem } from '../../core/registry';
import { monthlyBudget, budgetLines } from './budget';
import { autoBuild, autoRepair, dailyBuild, dailyRepairs, damageStructure, getAgg, repairStructure } from './build';
import { handleCommand } from './commands';
import { cityInBlackout, energyWeekly, plantDamageToday, updateEnergy } from './energy';
import { createEconomySlice } from './init';
import { dailyStocks, marketStep, refreshFlows } from './resources';
import { dailySocial, monthlySocial, weeklySocial } from './social';
import type { CountryEco, EconomyState, StructRec } from './types';
import { RES_LIST, resIndex } from './types';
import { cache, clamp, hash01, invalidateTerritory, isAuto, isPlayer, isSandboxPlayer, sys, tryMod } from './util';
import { PRICE0 } from './balance';


function view(ctx: Ctx, s: StructRec): StructureView {
  const v: StructureView = { id: s.id, kind: s.kind, country: s.country, province: s.province, lon: s.lon, lat: s.lat, progress: s.progress, health: 1 - s.damage };
  if (s.fuel) { v.fuel = s.fuel; v.mw = s.mw; }
  if (s.nodes) v.nodes = s.nodes;
  return v;
}

function pruneUnrest(ctx: Ctx): void {
  const s = ctx.state.economy, ch = cache(ctx), now = ctx.state.time.hours;
  if (s.unrest.length) s.unrest = s.unrest.filter((u) => u.until > now);
  ch.unrestCity.clear(); ch.unrestProv.clear(); ch.unrestCountry.clear();
  for (const u of s.unrest) {
    const fade = clamp((u.until - now) / Math.max(24, (u.until - u.from) * 0.25), 0, 1);
    const v = u.delta * fade;
    const t = u.target;
    if ('city' in t) ch.unrestCity.set(t.city, (ch.unrestCity.get(t.city) ?? 0) + v);
    else if ('province' in t) ch.unrestProv.set(t.province, (ch.unrestProv.get(t.province) ?? 0) + v);
    else ch.unrestCountry.set(t.country, (ch.unrestCountry.get(t.country) ?? 0) + v);
  }
}

const slots = new Map<string, number>();
const slot = (c: CountryId): number => {
  let v = slots.get(c);
  if (v === undefined) slots.set(c, (v = Math.floor(hash01(`m${c}`) * 30)));
  return v;
};

function weeklyCountry(ctx: Ctx, c: CountryId, e: CountryEco): void {
  weeklySocial(ctx, c, e);
  e.milUpkeep = sys(ctx, 'military')?.upkeepPerDay(c).money ?? 0;
}

/** The monthly cycle of one country; staggered over the 30-day cycle to keep every day cheap. */
function monthlyCountry(ctx: Ctx, c: CountryId, e: CountryEco): void {
  getAgg(ctx, c);
  monthlyBudget(ctx, c, e);
  refreshFlows(ctx, c, e);
  monthlySocial(ctx, c, e);
  if (isAuto(ctx, c, 'eco.build')) autoBuild(ctx, c, e);
  for (const r of ['food', 'oil'] as const) {
    const i = resIndex(r);
    if (e.short[i] > 0.25 && isPlayer(ctx, c)) {
      ctx.bus.emit({ type: 'eco.shortage', country: c, resource: r, unmet: e.short[i] });
      ctx.news('economy', 'eco.news.shortage', { resource: r, pct: Math.round(e.short[i] * 100) }, { country: c }, { countries: [c], importance: 1 });
    }
  }
}

export const economySystem = defineSystem({
  id: 'economy',
  createSlice: (ctx): EconomyState => createEconomySlice(ctx),

  init(ctx) {
    const terr = (e: { from: CountryId; to: CountryId }) => invalidateTerritory(ctx, e.from, e.to);
    ctx.bus.on('world.controllerChanged', terr);
    ctx.bus.on('world.ownerChanged', terr);
    ctx.bus.on('world.damaged', (e) => {
      if (e.kind !== 'city') return;
      const city = ctx.world.cities[e.index];
      const s = ctx.state.economy;
      if (!city || !s) return;
      const c = city.provinceId ? ctx.api.worldDyn.controllerOf(city.provinceId) : city.countryId;
      const eco = c ? s.c[c] : undefined;
      if (!eco) return;
      const killed = city.pop * (eco.pop / eco.base.pop0) * e.amount * 0.03;
      eco.pop = Math.max(1, eco.pop - killed);
      s.sat[e.index] = clamp(s.sat[e.index] - e.amount * 25, 0, 100);
      eco.warWeary = Math.min(60, eco.warWeary + e.amount * 4);
    });
  },

  onDay(ctx) {
    pruneUnrest(ctx);
    const s = ctx.state.economy;
    const dmg = plantDamageToday(ctx);
    const day = Math.floor(ctx.state.time.hours / 24);
    if (day % 30 === 0) cache(ctx).agg.clear();
    for (const c of ctx.api.worldDyn.aliveCountries()) {
      const e = s.c[c];
      if (!e) continue;
      dailyStocks(e);
      updateEnergy(ctx, c, e, dmg.get(c));
      dailySocial(ctx, c, e);
      dailyBuild(ctx, c, e);
      if ((day + slot(c)) % 30 === 0) monthlyCountry(ctx, c, e);
      if ((day + slot(c)) % 7 === 0) weeklyCountry(ctx, c, e);
    }
    dailyRepairs(ctx);
    marketStep(ctx, day % RES_LIST.length);
  },

  onWeek(ctx) {
    energyWeekly(ctx);
    autoRepair(ctx);
  },

  onMonth(ctx) {
    const s = ctx.state.economy;
    const p = ctx.state.meta.playerCountryId, pe = s.c[p];
    if (pe) {
      s.history.push({ hours: ctx.state.time.hours, gdp: pe.gdp, balance: pe.balance, treasury: pe.treasury, supplyMw: pe.energy.supplyMw, demandMw: pe.energy.demandMw, approval: pe.approval, stability: pe.stability });
      if (s.history.length > 240) s.history.splice(0, s.history.length - 240);
    }
  },

  handle: (ctx, cmd) => handleCommand(ctx, cmd),

  api(ctx): EconomyApi {
    const S = (): EconomyState => ctx.state.economy;
    const canPay = (c: CountryId, cost: Cost): boolean => {
      if (isSandboxPlayer(ctx, c)) return true;
      const e = S().c[c];
      if (!e) return false;
      for (const k of Object.keys(cost) as StockResource[]) {
        const v = cost[k] ?? 0;
        if (v <= 0) continue;
        if (k === 'money' ? e.treasury < v : e.stock[resIndex(k)] < v) return false;
      }
      return true;
    };
    const api: EconomyApi = {
      treasury: (c) => S().c[c]?.treasury ?? 0,
      canAfford: (c, cost) => canPay(c, cost),
      charge(c, cost, _reason) {
        if (!canPay(c, cost)) return false;
        if (isSandboxPlayer(ctx, c)) return true;
        const e = S().c[c];
        for (const k of Object.keys(cost) as StockResource[]) {
          const v = cost[k] ?? 0;
          if (v <= 0) continue;
          if (k === 'money') e.treasury -= v; else e.stock[resIndex(k)] -= v;
        }
        return true;
      },
      credit(c, amount, _reason) {
        const e = S().c[c];
        if (e && Number.isFinite(amount)) e.treasury += amount;
      },
      stock(c, res) {
        const e = S().c[c];
        if (!e) return 0;
        return res === 'money' ? e.treasury : e.stock[resIndex(res)] ?? 0;
      },
      consume(c, res, amount) {
        const e = S().c[c];
        if (!e || !(amount > 0)) return 0;
        if (res === 'money') {
          const got = Math.min(Math.max(0, e.treasury), amount);
          e.treasury -= got;
          return got;
        }
        const i = resIndex(res);
        const got = Math.min(e.stock[i], amount);
        e.stock[i] -= got;
        return got;
      },
      energy(c) {
        const en = S().c[c]?.energy;
        return en ? { supplyMw: en.supplyMw, demandMw: en.demandMw, ratio: en.ratio } : { supplyMw: 0, demandMw: 0, ratio: 1 };
      },
      stability: (c) => S().c[c]?.stability ?? 0,
      approval: (c) => S().c[c]?.approval ?? 0,
      citySatisfaction: (i) => S().sat[i] ?? 50,
      addUnrest(target, delta, reasonKey, days) {
        if (!Number.isFinite(delta) || !(days > 0)) return;
        const s = S(), now = ctx.state.time.hours;
        s.unrest.push({ target, delta, reasonKey, from: now, until: now + days * 24 });
        if (s.unrest.length > 400) s.unrest.splice(0, s.unrest.length - 400);
      },
      manpower: (c) => S().c[c]?.manpower ?? 0,
      drawManpower(c, n) {
        const e = S().c[c];
        if (!e || !(n > 0)) return 0;
        const got = Math.min(Math.floor(n), Math.floor(e.manpower));
        e.manpower -= got;
        return got;
      },
      returnManpower(c, n) {
        const e = S().c[c];
        if (e && n > 0) e.manpower = Math.min(e.pop * 0.05, e.manpower + n);
      },
      militaryIndustry(c) {
        const e = S().c[c];
        if (!e) return 0;
        const envelope = Math.max(0, (e.base.spend.defense * e.spend.defense) / 365 - e.milUpkeep);
        const factories = getAgg(ctx, c).milFactories;
        return envelope * 0.12 + 3 * factories;
      },
      structures(filter) {
        const out: StructureView[] = [];
        const ch = cache(ctx);
        const f = filter ?? {};
        const lists = f.country ? [ch.built.get(f.country), f.includeUnfinished === false ? undefined : ch.building.get(f.country)] : [...ch.built.values(), ...(f.includeUnfinished === false ? [] : [...ch.building.values()])];
        for (const l of lists) {
          if (!l) continue;
          for (const s of l) {
            if (f.province && s.province !== f.province) continue;
            if (f.kind && s.kind !== f.kind) continue;
            out.push(view(ctx, s));
          }
        }
        return out.sort((a, b) => (a.id < b.id ? -1 : 1));
      },
      structureAt(lon, lat, radiusKm = 5) {
        let best: StructRec | null = null, bd = radiusKm;
        for (const s of Object.values(S().structures)) {
          const d = haversineKm(lon, lat, s.lon, s.lat);
          if (d <= bd) { bd = d; best = s; }
        }
        return best ? view(ctx, best) : null;
      },
      ledger: (c) => (S().c[c] ? budgetLines(ctx, c, S().c[c]) : []),
      gdp: (c) => S().c[c]?.gdp ?? 0,
      population: (c) => S().c[c]?.pop ?? 0,
      debt: (c) => S().c[c]?.debt ?? 0,
      inflation: (c) => S().c[c]?.inflation ?? 0,
      price: (res) => (res === 'money' ? 1 : PRICE0[res] * S().prices[resIndex(res)]),
      damageStructure: (id, a, cause) => damageStructure(ctx, id, a, cause),
      repairStructure: (id, a) => repairStructure(ctx, id, a),
      inBlackout: (i) => cityInBlackout(ctx, i),
      addStock(c, res, amount) {
        const e = S().c[c];
        if (!e || !Number.isFinite(amount)) return;
        if (res === 'money') e.treasury += amount; else e.stock[resIndex(res)] = Math.max(0, e.stock[resIndex(res)] + amount);
      },
      researchBudget: (c) => clamp(S().c[c]?.spend.research ?? 1, 0.2, 3),
      killPopulation(target, n, _cause) {
        if (!(n > 0)) return 0;
        let c: CountryId | null | undefined;
        let share = 1;
        if ('city' in target) {
          const city = ctx.world.cities[target.city];
          if (!city) return 0;
          c = city.provinceId ? ctx.api.worldDyn.controllerOf(city.provinceId) : city.countryId;
          const e0 = c ? S().c[c] : undefined;
          if (e0) share = Math.min(1, n / Math.max(1, city.pop * (e0.pop / e0.base.pop0)));
          S().sat[target.city] = clamp((S().sat[target.city] ?? 50) - share * 60, 0, 100);
        } else c = target.country;
        const e = c ? S().c[c] : undefined;
        if (!e) return 0;
        const killed = Math.min(n, e.pop - 1);
        e.pop -= killed;
        e.warWeary = Math.min(60, e.warWeary + (killed / Math.max(1, e.pop)) * 400);
        return killed;
      },
      isAutomated: (c, key) => isAuto(ctx, c, key),
    };
    return api;
  },

  metrics(ctx) {
    const s = ctx.state.economy;
    let gdp = 0, debt = 0, appr = 0, n = 0, dark = 0, treasury = 0;
    for (const c of ctx.api.worldDyn.aliveCountries()) {
      const e = s.c[c];
      if (!e) continue;
      gdp += e.gdp; debt += e.debt; treasury += e.treasury; appr += e.approval; n++;
      if (e.energy.ratio < 0.9) dark++;
    }
    const p = s.c[ctx.state.meta.playerCountryId];
    return {
      worldGdpTUsd: gdp / 1e6, worldDebtTUsd: debt / 1e6, meanApproval: n ? appr / n : 0, countriesInBlackout: dark,
      structures: Object.keys(s.structures).length, playerGdpBn: p ? p.gdp / 1e3 : 0, playerBalanceM: p ? p.balance : 0,
      playerEnergyRatio: p ? p.energy.ratio : 0, playerApproval: p ? p.approval : 0,
    };
  },
});
void RES_LIST;
