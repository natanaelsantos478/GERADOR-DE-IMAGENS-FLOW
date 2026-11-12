/** Taxes, budget pillars, ledger, debt, rating, inflation, GDP dynamics and budget automation. */
import type { CountryId, Ctx, LedgerLine } from '../../core/contracts';
import { DEFAULT_TAX, RATING_NAMES, TAX_BASE, TAX_MAX } from './balance';
import { getAgg } from './build';
import { territoryFactor } from './energy';
import type { CountryEco, Pillar, TaxKind } from './types';
import { PILLARS, TAX_KINDS } from './types';
import { cache, clamp, isAuto, isPlayer, tryMod } from './util';

export const taxIndex = (e: CountryEco): number => {
  let a = 0, b = 0;
  for (const k of TAX_KINDS) { a += TAX_BASE[k] * e.tax[k]; b += TAX_BASE[k] * e.base.defaultTax[k]; }
  return a / b;
};
/** Evasion makes rates above 30% progressively less productive (Laffer). */
const evade = (rate: number) => 1 - Math.max(0, rate - 0.3) * 1.2;

export function interestRate(e: CountryEco): number {
  return 0.025 + 0.012 * e.rating + e.inflation * 0.5;
}

/** Expected monthly budget lines (M USD) for the current policy. */
export function budgetLines(ctx: Ctx, c: CountryId, e: CountryEco): LedgerLine[] {
  const lines: LedgerLine[] = [];
  const te = tryMod(ctx, c, 'eco.taxEfficiency');
  const gsc = e.gdp / ((e.base.gdpPc0 * e.base.pop0) / 1e6);
  const goodsF = 1 - 0.3 * (e.short[7] ?? 0);
  const rev = (k: TaxKind, key: string) => {
    const f = k === 'consumption' ? goodsF : 1;
    lines.push({ key, category: 'revenue', amount: (e.gdp * TAX_BASE[k] * e.tax[k] * evade(e.tax[k]) * e.base.collect * te * f) / 12 });
  };
  rev('income', 'eco.ledger.incomeTax');
  rev('corporate', 'eco.ledger.corporateTax');
  rev('consumption', 'eco.ledger.consumptionTax');
  lines.push({ key: 'eco.ledger.trade', category: e.tradeNet >= 0 ? 'revenue' : 'expense', amount: e.tradeNet });
  const defEnv = (e.base.spend.defense * e.spend.defense * Math.pow(Math.max(0.2, gsc), 0.9)) / 12;
  // Unit upkeep reported by the military module, capped at what an economy can plausibly carry.
  const upkeep = Math.min(e.milUpkeep * 30, Math.max(1.25 * defEnv, (0.05 * e.gdp) / 12));
  for (const p of PILLARS) {
    let v = (e.base.spend[p] * e.spend[p] * Math.pow(Math.max(0.2, gsc), 0.9)) / 12;
    // Unit upkeep is paid out of the defense envelope (it is never double counted).
    if (p === 'defense') v = Math.max(0, v - upkeep);
    lines.push({ key: `eco.ledger.${p}`, category: 'expense', amount: -v });
  }
  lines.push({ key: 'eco.ledger.militaryUpkeep', category: 'expense', amount: -upkeep });
  lines.push({ key: 'eco.ledger.interest', category: 'expense', amount: -(e.debt * interestRate(e)) / 12 });
  const ag = cache(ctx).agg.get(c);
  lines.push({ key: 'eco.ledger.maintenance', category: 'expense', amount: -(ag?.maint ?? 0) });
  return lines;
}

export const balanceOf = (lines: LedgerLine[]): number => lines.reduce((a, l) => a + l.amount, 0);

/** Spending level multiplier actually applied (budget pillars fund outcomes only if treasury is not negative). */
export function pillarLevel(e: CountryEco, p: Pillar): number {
  return e.treasury < 0 ? e.spend[p] * 0.7 : e.spend[p];
}

function autoBudget(ctx: Ctx, c: CountryId, e: CountryEco, lines: LedgerLine[]): void {
  const spend = -lines.filter((l) => l.amount < 0).reduce((a, l) => a + l.amount, 0);
  const bal = balanceOf(lines);
  const month = Math.max(1, spend);
  const d = e.base.defaultTax;
  if (bal < -0.01 * month && e.treasury < 3 * month) {
    if (e.tax.income < 0.34) e.tax.income += 0.005;
    else if (e.tax.consumption < 0.22) e.tax.consumption += 0.005;
    else if (e.tax.corporate < 0.32) e.tax.corporate += 0.005;
    else for (const p of ['research', 'infrastructure'] as Pillar[]) e.spend[p] = Math.max(0.6, e.spend[p] - 0.03);
  } else if (e.treasury > 6 * month && bal > 0) {
    if (e.approval < 55 && (e.tax.income > d.income * 0.7)) e.tax.income -= 0.005;
    else for (const p of ['health', 'education', 'social', 'infrastructure'] as Pillar[]) e.spend[p] = Math.min(1.4, e.spend[p] + 0.015);
  } else if (bal > 0.03 * month) {
    // Drift tax rates back towards the defaults when comfortably in surplus.
    for (const k of TAX_KINDS) e.tax[k] += clamp(d[k] - e.tax[k], -0.003, 0.003);
  }
  if (e.approval < 40 && e.treasury > 2 * month) e.spend.social = Math.min(1.5, e.spend.social + 0.03);
  for (const k of TAX_KINDS) e.tax[k] = clamp(e.tax[k], 0.02, TAX_MAX);
}

export function monthlyBudget(ctx: Ctx, c: CountryId, e: CountryEco): void {
  const ag = getAgg(ctx, c);
  const tf = territoryFactor(ctx, c, e);
  // ---- GDP dynamics
  const stat = ctx.world.stats[c]?.gdpGrowth ?? 2;
  const gdpPc = (e.gdpPot * 1e6) / Math.max(1, e.pop);
  let g = (clamp(stat, 0, 6) * 0.5 + 2.5 * 0.5) / 100;
  g += (e.spend.education - 1) * 0.006 + (e.spend.infrastructure - 1) * 0.006 + (e.spend.research - 1) * 0.003;
  g += 0.01 * clamp(Math.log10(10000 / Math.max(gdpPc, 1)), 0, 1);
  g -= 0.04 * Math.max(0, taxIndex(e) - 1.2) + Math.max(0, e.inflation - 0.06) * 0.3;
  g = clamp(g, -0.15, 0.08);
  e.gdpPot *= Math.pow(1 + g, 1 / 12);
  // New technologies lift productivity once (the starting tech level is already inside the real GDP).
  const mi = tryMod(ctx, c, 'eco.industry') * tryMod(ctx, c, 'eco.research') ** 0.5 * tryMod(ctx, c, 'eco.trade') ** 0.5;
  if (e.modPrev > 0) e.gdpPot *= Math.pow(mi / e.modPrev, 0.25);
  e.modPrev = mi;
  const energyF = 1 - 0.7 * Math.max(0, 1 - e.energy.ratio);
  const damageF = 1 - 0.5 * Math.min(1, e.warWeary / 60);
  const targetEff = clamp(energyF * (1 - e.strike * 0.3) * damageF * (e.treasury < 0 ? 0.97 : 1), 0.2, 1.05);
  e.eff += (targetEff - e.eff) * 0.3;
  const prevGdp = e.gdp;
  e.gdp = Math.max(1, (e.gdpPot + ag.gdpAdd) * tf * e.eff);
  e.growth = clamp((Math.pow(e.gdp / Math.max(1, prevGdp), 12) - 1) * 100, -90, 90);

  // ---- budget
  let lines = budgetLines(ctx, c, e);
  if (isAuto(ctx, c, 'eco.budget')) {
    autoBudget(ctx, c, e, lines);
    lines = budgetLines(ctx, c, e);
  }
  const bal = balanceOf(lines);
  e.balance = bal;
  if (!(isPlayer(ctx, c) && ctx.state.meta.difficulty === 'sandbox')) e.treasury += bal;
  else e.treasury = Math.max(e.treasury, 1e6);
  e.tradeNet = 0;

  // ---- debt, rating, inflation
  const spendM = Math.max(1, -lines.filter((l) => l.amount < 0).reduce((a, l) => a + l.amount, 0));
  const limit = e.gdp * clamp(1.6 - e.inflation * 4, 0.3, 1.6);
  if (e.treasury < 0) {
    const want = -e.treasury + spendM * 0.5;
    const take = Math.max(0, Math.min(want, limit - e.debt));
    e.debt += take; e.treasury += take;
    if (e.treasury < 0 && e.rating >= 8) {
      ctx.bus.emit({ type: 'eco.insolvent', country: c });
      if (isPlayer(ctx, c)) ctx.news('economy', 'eco.news.insolvent', {}, { country: c }, { countries: [c], importance: 2 });
    }
  } else if (e.debt > 0 && e.treasury > 4 * spendM && isAuto(ctx, c, 'eco.budget')) {
    const pay = Math.min(e.debt, e.treasury - 4 * spendM);
    e.debt -= pay; e.treasury -= pay;
  }
  const ratio = e.debt / Math.max(1, e.gdp);
  const rt = clamp(Math.floor(ratio / 0.25) + (bal < 0 ? 1 : 0) + (e.treasury < 0 ? 2 : 0) + (e.inflation > 0.15 ? 1 : 0), 0, 9);
  e.rating += Math.sign(rt - e.rating) * Math.min(1, Math.abs(rt - e.rating));
  const deficitPush = Math.max(0, (-bal * 12) / Math.max(1, e.gdp) - 0.03) * 1.2;
  const shortage = ((e.short[1] ?? 0) + (e.short[7] ?? 0)) * 0.04 + Math.max(0, 1 - e.energy.ratio) * 0.05;
  e.inflation += (clamp(0.02 + deficitPush + shortage, 0, 0.5) - e.inflation) * 0.2;
  ctx.bus.emit({ type: 'eco.monthlyBudget', country: c, balance: bal });
}

export const ratingName = (e: CountryEco): string => RATING_NAMES[clamp(Math.round(e.rating), 0, 9)];
export { DEFAULT_TAX };
