/** Resource stocks (daily), production/consumption refresh (monthly) and the global market (weekly). */
import type { CountryId, Ctx } from '../../core/contracts';
import { FUELS } from '../../core/contracts';
import { MWH_PER_KBBL, MWH_PER_TU, PRICE0 } from './balance';
import { territoryFactor } from './energy';
import type { CountryEco, Tradable } from './types';
import { RES_LIST, resIndex } from './types';
import { cache, clamp, isAuto, isPlayer, sys, tryMod, warEnemies } from './util';

const R = (r: Tradable) => RES_LIST.indexOf(r);
const OIL = R('oil'), FOOD = R('food'), STEEL = R('steel'), ELEC = R('electronics'), RARE = R('rareEarth'), URA = R('uranium'), MUN = R('munitions'), GOODS = R('consumerGoods');
const NO_TRADE = new Set([MUN]);
/** Share of trade flows that passes through the treasury (tariffs, state traders); the rest is private. */
const STATE_SHARE = 0.12;

/** Daily consumption of power plants for fuel resources (units/day). */
const F_OIL = FUELS.indexOf('oil'), F_NUC = FUELS.indexOf('nuclear');
export function plantFuelUse(e: CountryEco, i: number): number {
  if (i === OIL) return (e.energy.byFuel[F_OIL] * 24) / MWH_PER_KBBL;
  if (i === URA) return (e.energy.byFuel[F_NUC] * 24) / MWH_PER_TU;
  return 0;
}

export function dailyStocks(e: CountryEco): void {
  for (let i = 0; i < RES_LIST.length; i++) {
    const net = e.prod[i] - e.cons[i];
    let s = e.stock[i] + net;
    if (s < 0) {
      e.short[i] = e.cons[i] > 0 ? clamp(-s / e.cons[i], 0, 1) : 0;
      s = 0;
    } else e.short[i] = 0;
    const cap = (i === URA || i === MUN ? 500 : 110) * Math.max(e.cons[i] + plantFuelUse(e, i), e.prod[i], e.base.cons[i], e.base.prod[i], 1e-6);
    e.stock[i] = Math.min(s, cap);
  }
}

/** Monthly: recompute production and consumption rates from base, GDP, energy, territory, structures and techs. */
export function refreshFlows(ctx: Ctx, c: CountryId, e: CountryEco): void {
  const g0 = (e.base.gdpPc0 * e.base.pop0) / 1e6;
  const gs = Math.max(0.05, e.gdpPot / g0);
  const tf = territoryFactor(ctx, c, e);
  const energyF = 1 - 0.8 * Math.max(0, 1 - e.energy.ratio);
  const eff = e.eff * energyF;
  const add = cache(ctx).agg.get(c)?.prodAdd;
  const m = (k: string) => tryMod(ctx, c, k);
  const b = e.base;
  const mulProd: number[] = [m('eco.oil'), m('eco.agri'), m('eco.mining') * m('eco.industry'), m('eco.electronics') * m('eco.industry'), m('eco.mining') * m('eco.rareEarth'), m('eco.mining'), 1, m('eco.industry')];
  for (let i = 0; i < RES_LIST.length; i++) {
    let p = b.prod[i] * Math.pow(gs, 0.9) * tf * mulProd[i];
    if (i === OIL || i === URA || i === RARE) p *= Math.min(1, e.eff + 0.1);
    else if (i === FOOD) p *= clamp(e.eff * (0.7 + 0.3 * energyF), 0, 1.1);
    else p *= eff;
    if (i === MUN) p = b.prod[i] * e.spend.defense * tf * eff + (add ? add[i] : 0);
    else if (add) p += add[i];
    e.prod[i] = p;
    const scale = i === FOOD ? e.pop / e.base.pop0 : Math.pow(gs, 0.8);
    e.cons[i] = b.cons[i] * scale * tf * (i === OIL ? m('eco.energyDemand') ** 0.5 : 1);
  }
}

/** Global market clearing for one resource (one resource per day: each clears every 8 days). */
export function marketStep(ctx: Ctx, only: number): void {
  const s = ctx.state.economy;
  const wd = ctx.api.worldDyn;
  const alive = wd.aliveCountries();
  const dip = sys(ctx, 'diplomacy'), mil = sys(ctx, 'military');
  const anyEmbargo = Object.keys(s.embargo).length > 0;
  const portH = new Map<CountryId, number>();
  const portHealth = (c: CountryId) => {
    let v = portH.get(c);
    if (v === undefined) {
      const list = ctx.world.portsByCountry.get(c) ?? [];
      if (!list.length) v = ctx.world.countryById.get(c)?.coastal ? 0.5 : 1;
      else { let a = 0; for (const pi of list) a += 1 - (ctx.state.world.portDamage[pi] ?? 0); v = a / list.length; }
      portH.set(c, v);
    }
    return v;
  };
  for (let i = 0; i < RES_LIST.length; i++) {
    if (i !== only || NO_TRADE.has(i)) continue;
    const price = PRICE0[RES_LIST[i]] * s.prices[i];
    const sell = new Map<CountryId, number>();
    const want = new Map<CountryId, number>();
    let E = 0, W = 0;
    for (const c of alive) {
      const e = s.c[c];
      if (!e || !isAuto(ctx, c, 'eco.trade')) continue;
      const use = e.cons[i] + plantFuelUse(e, i);
      const throughput = Math.max(use, 0.25 * e.prod[i]);
      if (throughput <= 0 && e.stock[i] <= 0) continue;
      const target = 45 * throughput;
      const blockaded = (s.blockade[c] ?? 0) > ctx.state.time.hours;
      if (e.stock[i] > 1.4 * target && !blockaded) {
        const q = (e.stock[i] - 1.4 * target) * 0.4;
        sell.set(c, q); E += q;
      } else if (use > 0 && e.stock[i] < target && !blockaded) {
        const gap = target - e.stock[i];
        const urgent = e.stock[i] < 12 * use ? 1 : 0.5;
        const sanction = dip ? clamp(1 - dip.sanctionLevel(c), 0, 1) : 1;
        const sea = mil ? clamp(1 - mil.blockadeRatio(c), 0, 1) : 1;
        const q = Math.min(gap * urgent, 14 * use) * (0.3 + 0.7 * portHealth(c)) * tryMod(ctx, c, 'eco.trade') * sanction * sea;
        if (q > 1e-9) { want.set(c, q); W += q; }
      }
    }
    const pr = clamp((W + 1e-6) / (E + 1e-6), 0.3, 3);
    let bought = 0;
    const filled = new Map<CountryId, number>();
    for (const [c, q] of want) {
      let avail = E;
      for (const en of warEnemies(ctx, c)) avail -= sell.get(en) ?? 0;
      if (anyEmbargo) for (const [sc, v] of sell) if (s.embargo[c]?.includes(sc) || s.embargo[sc]?.includes(c)) avail -= v;
      const got = q * clamp(avail / Math.max(W, 1e-9), 0, 1);
      if (got > 0) { filled.set(c, got); bought += got; }
    }
    // Sellers share the quantity actually traded.
    const soldFrac = E > 0 ? Math.min(1, bought / E) : 0;
    for (const [c, got] of filled) {
      const e = s.c[c], cost = got * price;
      e.stock[i] += got; e.treasury -= cost * STATE_SHARE; e.tradeNet -= cost * STATE_SHARE;
    }
    for (const [c, q] of sell) {
      const e = s.c[c], sold = q * soldFrac, gain = sold * price;
      e.stock[i] -= sold; e.treasury += gain * STATE_SHARE; e.tradeNet += gain * STATE_SHARE;
    }
    s.prices[i] += (Math.pow(pr, 0.5) - s.prices[i]) * 0.2;
    s.prices[i] = clamp(s.prices[i], 0.3, 3);
  }
}

/** Player-initiated spot trade; positive = buy. Returns an error key or null. */
export function spotTrade(ctx: Ctx, c: CountryId, res: Tradable, amount: number): string | null {
  const s = ctx.state.economy, e = s.c[c];
  const i = resIndex(res);
  if (!e || i < 0 || !Number.isFinite(amount) || amount === 0) return 'eco.err.invalidAmount';
  if ((s.blockade[c] ?? 0) > ctx.state.time.hours) return 'eco.err.blockaded';
  const price = PRICE0[res] * s.prices[i];
  if (amount > 0) {
    const cost = amount * price * 1.08;
    if (!(isPlayerFree(ctx, c))) { if (e.treasury < cost) return 'eco.err.noMoney'; e.treasury -= cost; e.tradeNet -= cost; }
    e.stock[i] += amount;
    s.prices[i] = clamp(s.prices[i] * (1 + 0.002 * Math.min(50, amount / Math.max(1e-6, e.cons[i] * 10 + 1))), 0.3, 3);
  } else {
    const q = Math.min(-amount, e.stock[i]);
    if (q <= 0) return 'eco.err.noStock';
    e.stock[i] -= q;
    const gain = q * price * 0.92;
    e.treasury += gain; e.tradeNet += gain;
  }
  return null;
}

function isPlayerFree(ctx: Ctx, c: CountryId): boolean {
  return isPlayer(ctx, c) && ctx.state.meta.difficulty === 'sandbox';
}
