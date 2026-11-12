/** Economy slice, commands, events and API additions (declaration merging into core contracts). */
import type {
  CountryId, Fuel, LedgerLine, ProvinceId, StockResource, StructureId, StructureKind, TextKey, UnrestTarget,
} from '../../core/contracts';

import type { Tradable } from './balance';
export type { Tradable };
export const RES_LIST: readonly Tradable[] = ['oil', 'food', 'steel', 'electronics', 'rareEarth', 'uranium', 'munitions', 'consumerGoods'];
export const resIndex = (r: StockResource): number => RES_LIST.indexOf(r as Tradable);

export type TaxKind = 'income' | 'corporate' | 'consumption';
export const TAX_KINDS: readonly TaxKind[] = ['income', 'corporate', 'consumption'];
export type Pillar = 'health' | 'education' | 'security' | 'infrastructure' | 'social' | 'defense' | 'research';
export const PILLARS: readonly Pillar[] = ['health', 'education', 'security', 'infrastructure', 'social', 'defense', 'research'];
export type Sector = 'agro' | 'industry' | 'services' | 'energy' | 'extraction';
export const SECTORS: readonly Sector[] = ['agro', 'industry', 'services', 'energy', 'extraction'];
export type InfraTarget = 'city' | 'plant' | 'airport' | 'port' | 'road';

/** Fixed per-country constants computed at game start from real statistics. */
export interface EcoBase {
  /** Baseline spending in M USD / year at level 1, per pillar. */
  spend: Record<Pillar, number>;
  /** Tax collection efficiency (rises with income). */
  collect: number;
  gdpPc0: number;
  pop0: number;
  /** Average demand in MW at start and the part not covered by catalogued plants. */
  demandMw0: number;
  unlistedMw: number;
  defaultTax: Record<TaxKind, number>;
  /** Per-day resource production / consumption at start (RES_LIST order). */
  prod: number[];
  cons: number[];
}

export interface EnergyState {
  supplyMw: number;
  demandMw: number;
  ratio: number;
  /** Generation in MW per fuel (FUELS order), including `other` = unlisted generation. */
  byFuel: number[];
  importMw: number;
  exportMw: number;
}

export interface CountryEco {
  treasury: number;
  debt: number;
  /** Annual GDP, M USD. */
  gdp: number;
  gdpPot: number;
  /** 0..1.2 productivity factor (energy, strikes, war...). */
  eff: number;
  /** Annualised real growth of the last month, %. */
  growth: number;
  pop: number;
  manpower: number;
  tax: Record<TaxKind, number>;
  /** Spending level per pillar (1 = baseline). */
  spend: Record<Pillar, number>;
  shares: Record<Sector, number>;
  base: EcoBase;
  stock: number[];
  /** Current per-day production / consumption (RES_LIST order). */
  prod: number[];
  cons: number[];
  /** Unmet fraction 0..1 of consumption on the last day. */
  short: number[];
  energy: EnergyState;
  /** Fuel availability 0..1 for oil and uranium plants. */
  fuelAvail: [number, number];
  inflation: number;
  /** 0 (AAA) .. 9 (default). */
  rating: number;
  stability: number;
  approval: number;
  warWeary: number;
  /** −1 (left) .. 1 (right). */
  ideo: number;
  strike: number;
  lowStabDays: number;
  nextElection: number;
  /** Money part of daily military upkeep (last weekly sample). */
  milUpkeep: number;
  /** Net trade income of last month (M USD). */
  tradeNet: number;
  /** Last monthly balance (M USD). */
  balance: number;
  /** Baseline territorial weight (Σ province weights owned at start). */
  w0: number;
  /** Last seen research productivity index (0 = not sampled yet). */
  modPrev: number;
}

export interface StructRec {
  id: StructureId;
  kind: StructureKind;
  variant: string;
  country: CountryId;
  province: ProvinceId;
  lon: number;
  lat: number;
  progress: number;
  /** Total build days. */
  days: number;
  /** Money paid. */
  paid: number;
  damage: number;
  fuel?: Fuel;
  mw?: number;
  nodes?: [number, number];
  startedHours: number;
}

export interface RepairJob {
  id: number;
  country: CountryId;
  infra: InfraTarget;
  index: number;
  daysLeft: number;
  perDay: number;
}

export interface UnrestItem {
  target: UnrestTarget;
  delta: number;
  reasonKey: TextKey;
  from: number;
  until: number;
}

export interface PowerContract {
  from: CountryId;
  to: CountryId;
  mw: number;
}

export interface HistoryPoint {
  hours: number;
  gdp: number;
  balance: number;
  treasury: number;
  supplyMw: number;
  demandMw: number;
  approval: number;
  stability: number;
}

export interface EconomyState {
  c: Record<CountryId, CountryEco>;
  /** Satisfaction per city index. */
  sat: number[];
  structures: Record<StructureId, StructRec>;
  nextStruct: number;
  repairs: RepairJob[];
  nextRepair: number;
  unrest: UnrestItem[];
  contracts: PowerContract[];
  /** Price index per resource (RES_LIST order), 1 = base. */
  prices: number[];
  /** embargo[a] = countries `a` refuses to trade with. */
  embargo: Record<CountryId, CountryId[]>;
  /** Blockaded country → until hours. */
  blockade: Record<CountryId, number>;
  history: HistoryPoint[];
}

export interface CityCause {
  key: TextKey;
  value: number;
}

export interface BuildOption {
  /** `kind` or `kind:variant`. */
  id: string;
  kind: StructureKind;
  variant: string;
  fuel?: Fuel;
  mw?: number;
  cost: Partial<Record<StockResource | 'money', number>>;
  days: number;
  /** i18n key explaining why it cannot be built now. */
  blocked?: TextKey;
  nameKey: TextKey;
}

declare module '../../core/contracts' {
  interface SliceMap {
    economy: EconomyState;
  }
  interface CommandMap {
    'eco.setTax': { tax: TaxKind; value: number };
    'eco.setSpend': { pillar: Pillar; level: number };
    'eco.build': { kind: StructureKind; variant?: string; province: ProvinceId; lon?: number; lat?: number; mw?: number; nodes?: [number, number] };
    'eco.cancelBuild': { id: StructureId };
    'eco.repair': { infra: InfraTarget; index: number };
    'eco.trade': { resource: StockResource; amount: number };
    'eco.setEmbargo': { target: CountryId; on: boolean };
    'eco.setBlockade': { target: CountryId; untilHours: number | null };
    'eco.borrow': { amount: number };
    'eco.repay': { amount: number };
    'eco.setPowerContract': { partner: CountryId; mw: number };
  }
  interface EventMap {
    'eco.blackout': { country: CountryId; ratio: number };
    'eco.structureStarted': { id: StructureId; kind: StructureKind; country: CountryId; province: ProvinceId };
    'eco.structureCompleted': { id: StructureId; kind: StructureKind; country: CountryId; province: ProvinceId; lon: number; lat: number };
    'eco.structureDamaged': { id: StructureId; amount: number };
    'eco.repairDone': { infra: InfraTarget; index: number; country: CountryId };
    'eco.strike': { country: CountryId; share: number };
    'eco.protest': { country: CountryId; province: ProvinceId | null; lon: number; lat: number };
    'eco.revolt': { country: CountryId; province: ProvinceId; lon: number; lat: number; strength: number };
    'eco.coup': { country: CountryId };
    'eco.election': { country: CountryId; approval: number; reelected: boolean };
    'eco.insolvent': { country: CountryId };
    'eco.refugees': { from: CountryId; to: CountryId; people: number };
    'eco.shortage': { country: CountryId; resource: StockResource; unmet: number };
    'eco.monthlyBudget': { country: CountryId; balance: number };
  }
  interface EconomyApi {
    gdp(c: CountryId): number;
    population(c: CountryId): number;
    debt(c: CountryId): number;
    inflation(c: CountryId): number;
    /** Current price per unit of a resource in M USD. */
    price(res: StockResource): number;
    /** Applies damage to a built structure (health = 1 − damage); returns damage applied. */
    damageStructure(id: StructureId, amount: number, cause: string): number;
    repairStructure(id: StructureId, amount: number): number;
    /** Whether a city is currently in blackout. */
    inBlackout(cityIdx: number): boolean;
    /** Add stock (production capture, loot, aid) without a price. */
    addStock(c: CountryId, res: StockResource, amount: number): void;
    /** Kills `n` people (city index or country) through nuclear strikes/bombardment. */
    killPopulation(target: { city: number } | { country: CountryId }, n: number, causeKey: TextKey): number;
    researchBudget(c: CountryId): number;
    isAutomated(c: CountryId, key: 'eco.budget' | 'eco.build' | 'eco.trade'): boolean;
  }
}

export type { LedgerLine };
