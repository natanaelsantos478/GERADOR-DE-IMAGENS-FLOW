/** Public surface of the economy module: types, command creators and UI selectors. */
import type { Command, CountryId, Ctx, Fuel, LedgerLine, ProvinceId, StockResource, StructureId, StructureKind } from '../../core/contracts';
import { FUELS } from '../../core/contracts';
import { budgetLines, interestRate, ratingName, taxIndex } from './budget';
import { buildOptions, repairQuote } from './build';
import { CATALOG, PRICE0 } from './balance';
import { citySatCauses, countryCausesAvg } from './social';
import type { BuildOption, CityCause, InfraTarget, Pillar, Sector, TaxKind } from './types';
import { RES_LIST, SECTORS } from './types';
export * from './types';
export { CATALOG } from './balance';
export { economySystem } from './system';
export { economyPt } from './i18n.pt';
export { citySatCauses, countryCausesAvg } from './social';
export { buildOptions, repairQuote } from './build';

// ---- command creators (UI and AI use the same commands)
export const setTax = (country: CountryId, tax: TaxKind, value: number): Command => ({ type: 'eco.setTax', country, tax, value });
export const setSpend = (country: CountryId, pillar: Pillar, level: number): Command => ({ type: 'eco.setSpend', country, pillar, level });
export const build = (country: CountryId, kind: StructureKind, province: ProvinceId, extra: { variant?: string; mw?: number; lon?: number; lat?: number; nodes?: [number, number] } = {}): Command =>
  ({ type: 'eco.build', country, kind, province, ...extra });
export const cancelBuild = (country: CountryId, id: StructureId): Command => ({ type: 'eco.cancelBuild', country, id });
export const repair = (country: CountryId, infra: InfraTarget, index: number): Command => ({ type: 'eco.repair', country, infra, index });
export const trade = (country: CountryId, resource: StockResource, amount: number): Command => ({ type: 'eco.trade', country, resource, amount });
export const setEmbargo = (country: CountryId, target: CountryId, on: boolean): Command => ({ type: 'eco.setEmbargo', country, target, on });
export const borrow = (country: CountryId, amount: number): Command => ({ type: 'eco.borrow', country, amount });
export const repay = (country: CountryId, amount: number): Command => ({ type: 'eco.repay', country, amount });
export const setPowerContract = (country: CountryId, partner: CountryId, mw: number): Command => ({ type: 'eco.setPowerContract', country, partner, mw });
export const setEcoAutomation = (country: CountryId, key: 'eco.budget' | 'eco.build' | 'eco.trade', value: boolean): Command => ({ type: 'game.setAutomation', country, key, value });

// ---- UI selectors
export interface CountrySummary {
  gdp: number; gdpGrowth: number; population: number; treasury: number; debt: number; inflation: number; rating: string; interest: number;
  balance: number; stability: number; approval: number; manpower: number; energy: { supplyMw: number; demandMw: number; ratio: number };
  taxes: Record<TaxKind, number>; taxBurden: number; spending: Record<Pillar, number>; sectors: Record<Sector, number>;
  stocks: Array<{ res: StockResource; stock: number; prodPerDay: number; consPerDay: number; unmet: number; price: number }>;
  nextElectionHours: number; warWeariness: number;
}

export function countrySummary(ctx: Ctx, c: CountryId): CountrySummary | null {
  const e = ctx.state.economy.c[c];
  if (!e) return null;
  const lines = budgetLines(ctx, c, e);
  return {
    gdp: e.gdp, gdpGrowth: e.growth, population: e.pop, treasury: e.treasury, debt: e.debt, inflation: e.inflation, rating: ratingName(e), interest: interestRate(e),
    balance: lines.reduce((a, l) => a + l.amount, 0), stability: e.stability, approval: e.approval, manpower: e.manpower,
    energy: { supplyMw: e.energy.supplyMw, demandMw: e.energy.demandMw, ratio: e.energy.ratio },
    taxes: { ...e.tax }, taxBurden: taxIndex(e), spending: { ...e.spend }, sectors: { ...e.shares },
    stocks: RES_LIST.map((r, i) => ({ res: r, stock: e.stock[i], prodPerDay: e.prod[i], consPerDay: e.cons[i], unmet: e.short[i], price: PRICE0[r] * ctx.state.economy.prices[i] })),
    nextElectionHours: e.nextElection, warWeariness: e.warWeary,
  };
}

export const ledgerOf = (ctx: Ctx, c: CountryId): LedgerLine[] => ctx.api.economy.ledger(c);

/** Generation in MW per fuel (including `other` = non-catalogued generation). */
export function energyByFuel(ctx: Ctx, c: CountryId): Array<{ fuel: Fuel; mw: number }> {
  const e = ctx.state.economy.c[c];
  return e ? FUELS.map((f, i) => ({ fuel: f, mw: e.energy.byFuel[i] })).filter((x) => x.mw > 0.01) : [];
}

export const cityCauses = (ctx: Ctx, cityIdx: number): CityCause[] => citySatCauses(ctx, cityIdx);
export const countryCauses = (ctx: Ctx, c: CountryId): CityCause[] => countryCausesAvg(ctx, c);
export const sectorList = SECTORS;

export interface ConstructionCatalogEntry { kind: StructureKind; variant: string; nameKey: string; unlock: string }
export const constructionCatalog = (): ConstructionCatalogEntry[] =>
  CATALOG.map((d) => ({ kind: d.kind, variant: d.variant, nameKey: d.nameKey, unlock: d.unlock }));

/** What can be built in a province, with cost, duration and block reasons. */
export const constructionOptions = (ctx: Ctx, c: CountryId, province: ProvinceId | null): BuildOption[] => buildOptions(ctx, c, province);
export const repairCost = repairQuote;
