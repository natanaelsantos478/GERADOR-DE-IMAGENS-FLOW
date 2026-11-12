/** City satisfaction (with causes), approval, stability, unrest, strikes, revolts, coups, elections, population. */
import type { CountryId, Ctx } from '../../core/contracts';
import { taxIndex } from './budget';
import { territoryFactor } from './energy';
import type { CityCause, CountryEco } from './types';
import { RES_LIST } from './types';
import { cache, citiesOf, clamp, isPlayer, tryMod, warEnemies } from './util';

export const CAUSE_KEYS = [
  'eco.cause.tax', 'eco.cause.jobs', 'eco.cause.energy', 'eco.cause.food', 'eco.cause.goods', 'eco.cause.health',
  'eco.cause.education', 'eco.cause.security', 'eco.cause.war', 'eco.cause.ideology', 'eco.cause.events',
] as const;
const NC = CAUSE_KEYS.length;
const FOOD = RES_LIST.indexOf('food'), GOODS = RES_LIST.indexOf('consumerGoods');
const BASE_SAT = 52;
const scratch = new Float64Array(NC);

interface K {
  tax: number; jobs: number; energy: number; food: number; goods: number; health: number; education: number;
  security: number; war: number; ideology: number; ratio: number; unrestC: number; unrestMod: number;
  /** Sum of the country-level causes. */
  sum: number;
}
const KS: K = { tax: 0, jobs: 0, energy: 0, food: 0, goods: 0, health: 0, education: 0, security: 0, war: 0, ideology: 0, ratio: 1, unrestC: 0, unrestMod: 1, sum: 0 };

function countryCauses(ctx: Ctx, c: CountryId, e: CountryEco, tf: number, k: K = KS): K {
  const gdpPc = (e.gdp * 1e6) / Math.max(1, e.pop);
  const foodDays = e.cons[FOOD] > 0 ? e.stock[FOOD] / e.cons[FOOD] : 99;
  const pol = clamp((1 - e.spend.social) * 2.5, -1, 1);
  k.tax = clamp(-(taxIndex(e) - 1) * 14, -15, 8);
  k.jobs = clamp(4 * Math.log10(Math.max(gdpPc, 300) / 4000), -6, 6) + (e.eff - 1) * 40 + clamp(e.growth, -10, 10) * 0.4 - e.strike * 8;
  k.energy = -Math.max(0, 1 - e.energy.ratio) * 10;
  k.food = -e.short[FOOD] * 60 - (foodDays < 15 ? (15 - foodDays) * 0.5 : 0);
  k.goods = -e.short[GOODS] * 30;
  k.health = (e.spend.health - 1) * 10 + (tryMod(ctx, c, 'eco.health') - 1) * 20;
  k.education = (e.spend.education - 1) * 7;
  k.security = (e.spend.security - 1) * 9;
  k.war = -e.warWeary * 0.5 - (1 - Math.min(1, tf)) * 25;
  k.ideology = 4 - 4 * Math.abs(e.ideo - pol);
  k.ratio = e.energy.ratio;
  k.unrestC = cache(ctx).unrestCountry.get(c) ?? 0;
  k.unrestMod = tryMod(ctx, c, 'eco.unrest');
  k.sum = BASE_SAT + k.tax + k.jobs + k.energy + k.food + k.goods + k.health + k.education + k.security + k.war + k.ideology - k.unrestC * k.unrestMod;
  return k;
}

/** Target satisfaction of a city; fills `scratch` with the per-cause breakdown when `fill` is set. */
function cityTarget(ctx: Ctx, k: K, idx: number, fill = false): number {
  const ch = cache(ctx);
  const dmg = ctx.state.world.cityDamage[idx] ?? 0;
  let energy = 0;
  if (k.ratio < 1 && ch.prio[idx] > k.ratio) energy = -Math.min(25, 10 + (1 - k.ratio) * 40);
  const hosp = Math.min(6, 3 * Math.round(ch.cityHosp[idx] * 1e4) / 1e4), uni = Math.min(4, 2 * Math.round(ch.cityUni[idx] * 1e4) / 1e4);
  const war = -dmg * 45 - ch.cityForeign[idx] * 10;
  let local = 0;
  if (ch.unrestCity.size || ch.unrestProv.size) {
    const p = ctx.world.cities[idx].provinceId;
    local = ((ch.unrestCity.get(idx) ?? 0) + (p ? ch.unrestProv.get(p) ?? 0 : 0)) * k.unrestMod;
  }
  if (fill) {
    const s = scratch;
    s[0] = k.tax; s[1] = k.jobs; s[2] = k.energy + energy; s[3] = k.food; s[4] = k.goods; s[5] = k.health + hosp; s[6] = k.education + uni;
    s[7] = k.security; s[8] = k.war + war; s[9] = k.ideology; s[10] = -(k.unrestC * k.unrestMod + local);
  }
  const t = k.sum + energy + hosp + uni + war - local;
  return t < 0 ? 0 : t > 100 ? 100 : t;
}

/** Visible causes of a city's satisfaction (UI). */
export function citySatCauses(ctx: Ctx, idx: number): CityCause[] {
  const city = ctx.world.cities[idx];
  if (!city) return [];
  const c = city.provinceId ? ctx.api.worldDyn.controllerOf(city.provinceId) : city.countryId;
  const e = c ? ctx.state.economy.c[c] : undefined;
  if (!c || !e) return [];
  cityTarget(ctx, countryCauses(ctx, c, e, territoryFactor(ctx, c, e)), idx, true);
  return CAUSE_KEYS.map((key, i) => ({ key, value: scratch[i] }));
}

/** Population-weighted average of city causes for a country (UI). */
export function countryCausesAvg(ctx: Ctx, c: CountryId): CityCause[] {
  const e = ctx.state.economy.c[c];
  if (!e) return [];
  const k = countryCauses(ctx, c, e, territoryFactor(ctx, c, e), { ...KS });
  const acc = new Float64Array(NC);
  let tp = 0;
  for (const i of citiesOf(ctx, c)) {
    const p = ctx.world.cities[i].pop;
    cityTarget(ctx, k, i, true);
    for (let j = 0; j < NC; j++) acc[j] += scratch[j] * p;
    tp += p;
  }
  return CAUSE_KEYS.map((key, j) => ({ key, value: tp > 0 ? acc[j] / tp : 0 }));
}

/** Daily: city satisfaction, approval, stability, manpower. */
export function dailySocial(ctx: Ctx, c: CountryId, e: CountryEco): void {
  const s = ctx.state.economy.sat;
  const tf = territoryFactor(ctx, c, e);
  const k = countryCauses(ctx, c, e, tf);
  const cities = citiesOf(ctx, c);
  const popRatio = e.pop / e.base.pop0;
  const pops = cache(ctx).cityPop;
  let sumSat = 0, sumPop = 0, strikePop = 0;
  for (let n = 0; n < cities.length; n++) {
    const i = cities[n];
    const t = cityTarget(ctx, k, i);
    const v = s[i] + (t - s[i]) * 0.06;
    s[i] = v;
    const p = pops[i] * popRatio;
    sumSat += v * p; sumPop += p;
    if (v < 30) strikePop += p;
  }
  let target: number;
  if (sumPop > 0) target = sumSat / sumPop;
  else target = clamp(BASE_SAT + k.tax + k.jobs + k.food + k.health + k.security + k.war + k.ideology, 0, 100);
  const am = tryMod(ctx, c, 'eco.approval');
  e.approval = clamp(target * am, 0, 100);
  e.strike = sumPop > 0 ? strikePop / sumPop : 0;
  const warPen = Math.min(20, e.warWeary * 0.4);
  const stTarget = clamp(0.65 * e.approval + 0.35 * 60 - warPen - (e.treasury < 0 ? 8 : 0) - e.strike * 15 + (tryMod(ctx, c, 'eco.stability') - 1) * 50, 0, 100);
  e.stability += (stTarget - e.stability) * 0.04;
  // Manpower pool regenerates ~0.4 %/year of the population, capped at 3 %.
  e.manpower = Math.min(e.pop * 0.03, e.manpower + e.pop * 0.00001 * tryMod(ctx, c, 'eco.manpower') * (e.stability > 25 ? 1 : 0.3));
  if (e.stability < 15) e.lowStabDays++; else e.lowStabDays = Math.max(0, e.lowStabDays - 1);
}

/** Weekly: war weariness. */
export function weeklySocial(ctx: Ctx, c: CountryId, e: CountryEco): void {
  const atWar = warEnemies(ctx, c).length > 0;
  e.warWeary = clamp(e.warWeary + (atWar ? 2.5 : -3.5), 0, 60);
}

export function popGrowth(ctx: Ctx, c: CountryId, e: CountryEco): number {
  const st = ctx.world.stats[c];
  const f = clamp((75 - (st?.lifeExp ?? 70)) / 25, 0, 1);
  let g = 0.0005 + 0.026 * f;
  g *= tryMod(ctx, c, 'eco.popGrowth') * (1 + (e.spend.health - 1) * 0.15);
  g -= e.short[FOOD] * 0.03 + e.warWeary * 0.00008;
  return g;
}

/** Monthly: population, refugees, strikes, protests, revolts, coups, elections. */
export function monthlySocial(ctx: Ctx, c: CountryId, e: CountryEco): void {
  const hours = ctx.state.time.hours;
  const player = isPlayer(ctx, c);
  e.pop = Math.max(1, e.pop * (1 + popGrowth(ctx, c, e) / 12));
  // Ideology follows the government's policy mix slowly.
  const pol = clamp((1 - e.spend.social) * 2.5, -1, 1);
  e.ideo = clamp(e.ideo + (pol - e.ideo) * 0.01, -1, 1);

  const tf = territoryFactor(ctx, c, e);
  const sevWar = Math.max(0, 1 - tf) + e.warWeary / 120;
  if (sevWar > 0.12 && e.pop > 1e5) {
    const out = e.pop * 0.0012 * sevWar;
    const best = pickRefugeeHost(ctx, c);
    if (best) {
      const host = ctx.state.economy.c[best];
      e.pop -= out; host.pop += out;
      ctx.bus.emit({ type: 'eco.refugees', from: c, to: best, people: Math.round(out) });
      ctx.api.economy.addUnrest({ country: best }, Math.min(3, out / Math.max(1, host.pop) * 400), 'eco.cause.refugees', 60);
    }
  }
  if (e.strike > 0.15 && player) {
    ctx.bus.emit({ type: 'eco.strike', country: c, share: e.strike });
    ctx.news('economy', 'eco.news.strike', { pct: Math.round(e.strike * 100) }, { country: c }, { countries: [c], importance: 1 });
  }
  if (e.approval < 35) {
    const cap = ctx.world.capitalCityOf(c);
    const city = cap !== null ? ctx.world.cities[cap] : null;
    const lon = city?.lon ?? ctx.world.countryById.get(c)?.capital.lon ?? 0, lat = city?.lat ?? ctx.world.countryById.get(c)?.capital.lat ?? 0;
    ctx.bus.emit({ type: 'eco.protest', country: c, province: city?.provinceId ?? null, lon, lat });
    if (player) ctx.news('politics', 'eco.news.protest', { approval: Math.round(e.approval) }, { lon, lat }, { countries: [c], importance: 1 });
  }
  if (e.stability < 25 && e.approval < 35) revolt(ctx, c, e);
  if (e.lowStabDays >= 20) {
    e.lowStabDays = 0;
    e.stability = 45; e.warWeary *= 0.5; e.ideo = -e.ideo;
    e.tax = { ...e.base.defaultTax };
    e.spend = { health: 1, education: 1, security: 1, infrastructure: 1, social: 1, defense: 1, research: 1 };
    e.treasury -= Math.max(0, e.treasury) * 0.1;
    const s = ctx.state.economy.sat;
    for (const i of citiesOf(ctx, c)) s[i] = Math.min(100, s[i] + 12);
    ctx.bus.emit({ type: 'eco.coup', country: c });
    ctx.news('politics', 'eco.news.coup', { country: ctx.world.countryById.get(c)?.namePt ?? c }, { country: c }, { countries: [c], importance: player ? 2 : 1 });
  }
  if (hours >= e.nextElection) {
    e.nextElection = hours + 4 * 365 * 24;
    const win = e.approval >= 45 || ctx.rng.chance(clamp((e.approval - 20) / 50, 0.05, 0.9));
    if (!win) {
      e.ideo = -e.ideo;
      for (const k of ['income', 'corporate', 'consumption'] as const) e.tax[k] = clamp(e.tax[k] + (e.ideo > 0 ? -0.01 : 0.01), 0.05, 0.5);
      e.spend.social = clamp(e.spend.social + (e.ideo > 0 ? -0.1 : 0.1), 0.5, 1.5);
      e.stability = Math.max(0, e.stability - 3);
    }
    ctx.bus.emit({ type: 'eco.election', country: c, approval: e.approval, reelected: win });
    if (player) ctx.news('politics', win ? 'eco.news.electionWon' : 'eco.news.electionLost', { approval: Math.round(e.approval) }, { country: c }, { countries: [c], importance: 2 });
  }
}

function pickRefugeeHost(ctx: Ctx, c: CountryId): CountryId | null {
  const s = ctx.state.economy;
  let best: CountryId | null = null, bestScore = -1;
  for (const n of ctx.world.countryById.get(c)?.neighbors ?? []) {
    const o = s.c[n];
    if (!o || !ctx.api.worldDyn.isAlive(n) || o.warWeary > 20) continue;
    if (warEnemies(ctx, c).includes(n)) continue;
    const score = o.approval + o.stability * 0.5;
    if (score > bestScore) { bestScore = score; best = n; }
  }
  return best;
}

function revolt(ctx: Ctx, c: CountryId, e: CountryEco): void {
  const sat = ctx.state.economy.sat;
  let low = -1, lv = 101;
  for (const i of citiesOf(ctx, c)) if (sat[i] < lv && ctx.world.cities[i].provinceId) { lv = sat[i]; low = i; }
  if (low < 0 || lv > 25) return;
  const city = ctx.world.cities[low];
  const strength = clamp((35 - e.approval) / 35, 0.05, 1);
  ctx.bus.emit({ type: 'eco.revolt', country: c, province: city.provinceId!, lon: city.lon, lat: city.lat, strength });
  ctx.news('politics', 'eco.news.revolt', { city: city.name }, { lon: city.lon, lat: city.lat }, { countries: [c], importance: isPlayer(ctx, c) ? 2 : 0 });
}
