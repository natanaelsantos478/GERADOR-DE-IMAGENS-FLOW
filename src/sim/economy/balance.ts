/** Tunable constants and the construction catalog (data only). */
import type { Fuel, StockResource, StructureKind } from '../../core/contracts';

/** Capacity factor by fuel (fraction of nameplate MW delivered on average). */
export const CF: Record<Fuel, number> = {
  coal: 0.55, gas: 0.45, oil: 0.3, nuclear: 0.85, hydro: 0.42, wind: 0.3, solar: 0.2, biomass: 0.5, geothermal: 0.75, other: 0.4,
};
/** Capex in M USD per MW. */
export const CAPEX_PER_MW: Record<Fuel, number> = {
  coal: 2.0, gas: 1.0, oil: 0.9, nuclear: 7.0, hydro: 3.0, wind: 1.5, solar: 1.0, biomass: 2.5, geothermal: 4.0, other: 2.0,
};
export const PLANT_DAYS: Record<Fuel, number> = {
  coal: 900, gas: 600, oil: 500, nuclear: 2000, hydro: 1500, wind: 450, solar: 300, biomass: 600, geothermal: 900, other: 600,
};
/** Steel in thousand tonnes per MW of nameplate capacity. */
export const STEEL_PER_MW: Record<Fuel, number> = {
  coal: 0.06, gas: 0.03, oil: 0.03, nuclear: 0.12, hydro: 0.1, wind: 0.12, solar: 0.05, biomass: 0.05, geothermal: 0.06, other: 0.05,
};
export const BUILDABLE_FUELS: Fuel[] = ['coal', 'gas', 'oil', 'nuclear', 'hydro', 'wind', 'solar', 'biomass', 'geothermal'];
export const PLANT_SIZES = [50, 200, 500, 1000, 1500];

/** Reference price of one unit of each resource in M USD (see ResourceId units). */
export type Tradable = Exclude<StockResource, 'money'>;
export const PRICE0: Record<Tradable, number> = {
  oil: 0.08, food: 0.4, steel: 0.7, electronics: 1, rareEarth: 0.06, uranium: 0.18, munitions: 1, consumerGoods: 1,
};
/** MWh of electricity per 1000 barrels burned / per tonne of uranium. */
export const MWH_PER_KBBL = 600;
export const MWH_PER_TU = 43800;

export const DEFAULT_TAX = { income: 0.2, corporate: 0.2, consumption: 0.1 };
/** Share of GDP each tax base represents. */
export const TAX_BASE = { income: 0.5, corporate: 0.25, consumption: 0.6 };
/** Relative weight of each pillar in the non-defense budget at start. */
export const PILLAR_WEIGHT = { health: 0.22, education: 0.2, security: 0.09, infrastructure: 0.14, social: 0.3, research: 0.05 };
export const SPEND_MIN = 0, SPEND_MAX = 2;
export const TAX_MAX = 0.6;

export interface CatalogDef {
  kind: StructureKind;
  variant: string;
  nameKey: string;
  /** M USD (per MW for power plants). */
  capex: number;
  steel: number;
  electronics: number;
  days: number;
  /** Research unlock id required (omitted = baseline). */
  unlock: string;
  /** Placement rule. */
  needs?: 'coast' | 'city' | 'base' | 'pop';
  /** Annual GDP added per M USD of capex, when finished. */
  gdpYield?: number;
  /** Production per day added per M USD of capex (units of `resource`). */
  resource?: Tradable;
}

const def = (d: Partial<CatalogDef> & Pick<CatalogDef, 'kind' | 'variant' | 'capex' | 'days'>): CatalogDef => ({
  nameKey: `eco.build.${d.variant === d.kind ? d.kind : `${d.kind}.${d.variant}`}`,
  steel: d.capex * 0.05,
  electronics: 0,
  unlock: `build.${d.kind}`,
  ...d,
});

export const CATALOG: CatalogDef[] = [
  def({ kind: 'powerPlant', variant: 'plant', capex: 0, days: 0 }),
  def({ kind: 'civilFactory', variant: 'civilFactory', capex: 400, days: 360, gdpYield: 0.35 }),
  def({ kind: 'militaryFactory', variant: 'militaryFactory', capex: 600, days: 420, electronics: 40 }),
  def({ kind: 'refinery', variant: 'refinery', capex: 900, days: 540, gdpYield: 0.15, resource: 'oil' }),
  def({ kind: 'mine', variant: 'steel', capex: 500, days: 420, resource: 'steel' }),
  def({ kind: 'mine', variant: 'rareEarth', capex: 700, days: 540, resource: 'rareEarth', electronics: 20 }),
  def({ kind: 'mine', variant: 'uranium', capex: 800, days: 600, resource: 'uranium' }),
  def({ kind: 'mine', variant: 'oil', capex: 600, days: 480, resource: 'oil' }),
  def({ kind: 'farm', variant: 'farm', capex: 150, days: 240, resource: 'food', steel: 2 }),
  def({ kind: 'hospital', variant: 'hospital', capex: 120, days: 300, needs: 'city', electronics: 10 }),
  def({ kind: 'university', variant: 'university', capex: 250, days: 540, needs: 'city', electronics: 20 }),
  def({ kind: 'road', variant: 'road', capex: 3, days: 240, steel: 0.2 }),
  def({ kind: 'railway', variant: 'railway', capex: 8, days: 480, steel: 0.8 }),
  def({ kind: 'port', variant: 'port', capex: 400, days: 540, needs: 'coast' }),
  def({ kind: 'airport', variant: 'airport', capex: 350, days: 480 }),
  def({ kind: 'militaryBase', variant: 'militaryBase', capex: 300, days: 240 }),
  def({ kind: 'airDefense', variant: 'airDefense', capex: 120, days: 180, electronics: 30 }),
  def({ kind: 'radar', variant: 'radar', capex: 80, days: 150, electronics: 30 }),
  def({ kind: 'silo', variant: 'silo', capex: 900, days: 720, needs: 'base', electronics: 60, steel: 80 }),
  def({ kind: 'bunker', variant: 'bunker', capex: 40, days: 90, steel: 10 }),
];

export const FUEL_UNLOCK = (f: Fuel): string => `fuel.${f}`;
/** Max simultaneous projects, plus infrastructure spend level. */
export const BASE_CONCURRENT = 3;
/** Maintenance of finished structures, fraction of capex per year (charged monthly in the ledger). */
export const MAINT_RATE = 0.004;
export const RATING_NAMES = ['AAA', 'AA', 'A', 'BBB', 'BB', 'B', 'CCC', 'CC', 'C', 'D'];

/** Real-world producers of strategic minerals (approximate share of world output, public geology knowledge). */
export const RARE_EARTH_SHARE: Record<string, number> = {
  CHN: 60, USA: 12, MMR: 9, AUS: 6, THA: 2.5, IND: 2, RUS: 1.5, MDG: 1.2, VNM: 1, BRA: 0.8, MYS: 0.6, BDI: 0.3,
};
export const URANIUM_SHARE: Record<string, number> = {
  KAZ: 43, CAN: 15, NAM: 11, AUS: 9, UZB: 6, RUS: 5, NER: 4, CHN: 3, IND: 1, ZAF: 1, UKR: 0.8, USA: 0.6, BRA: 0.4,
};
/** Multipliers on industrial output for steel and electronics (real manufacturing weight). */
export const STEEL_BOOST: Record<string, number> = { CHN: 3.5, IND: 1.8, JPN: 1.5, USA: 1.2, RUS: 1.6, KOR: 1.6, DEU: 1.2, TUR: 1.5, BRA: 1.3, IRN: 1.6, UKR: 1.3 };
export const ELEC_BOOST: Record<string, number> = { CHN: 2.5, KOR: 3, JPN: 2, TWN: 4, USA: 1.5, DEU: 1.3, VNM: 2.5, MYS: 3, SGP: 3, MEX: 1.5, IND: 1.2, PHL: 2, THA: 1.5 };
