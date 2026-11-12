/**
 * Stable vocabulary shared with ECO/MIL: unlock ids and modifier keys produced by the tech tree.
 * Query unlocks with `ctx.api.research.unlocked(country, id)` and multipliers with
 * `ctx.api.research.mod(country, key)` (product of tech effects and temporary modifiers, 1 when none).
 * Multiplier convention: 1.10 = +10 %; cost-like keys (`*.cost`, `*.upkeep`, `eco.energyDemand`…) are < 1 when improved.
 */
import type { StructureKind } from '../../core/contracts';

export const UNIT_IDS = [
  'infantry', 'mech_infantry', 'armor', 'recon', 'artillery', 'mlrs', 'air_defense', 'engineer', 'logistics',
  'special_forces', 'attack_heli', 'transport_heli', 'fighter', 'bomber', 'air_transport', 'drone', 'destroyer',
  'frigate', 'submarine', 'carrier', 'landing_ship', 'cruise_missile', 'ballistic_missile', 'nuke',
] as const;
export type UnitId = (typeof UNIT_IDS)[number];

export const STRUCTURE_IDS: readonly StructureKind[] = [
  'powerPlant', 'civilFactory', 'militaryFactory', 'refinery', 'mine', 'farm', 'hospital', 'university', 'road',
  'railway', 'port', 'airport', 'militaryBase', 'airDefense', 'radar', 'silo', 'bunker',
];

export const FUEL_IDS = ['coal', 'gas', 'oil', 'nuclear', 'hydro', 'wind', 'solar', 'biomass', 'geothermal'] as const;

/** Unlock id builders: `unit.armor`, `build.silo`, `fuel.nuclear`. */
export const unitUnlock = (u: UnitId): string => `unit.${u}`;
export const buildUnlock = (k: StructureKind): string => `build.${k}`;
export const fuelUnlock = (f: (typeof FUEL_IDS)[number]): string => `fuel.${f}`;

/** Available to everybody from day one (no tech needed). */
export const BASELINE_UNLOCKS: readonly string[] = [
  'unit.infantry',
  ...(['powerPlant', 'civilFactory', 'militaryFactory', 'road', 'port', 'airport', 'militaryBase'] as StructureKind[]).map(buildUnlock),
  ...(['coal', 'gas', 'oil', 'hydro'] as const).map(fuelUnlock),
];

/** Every modifier key used by the tree (documentation + UI labels + test of completeness). */
export const MODIFIER_KEYS = [
  // economy
  'eco.industry', 'eco.agri', 'eco.mining', 'eco.oil', 'eco.electronics', 'eco.rareEarth', 'eco.taxEfficiency',
  'eco.trade', 'eco.buildSpeed', 'eco.buildCost', 'eco.manpower', 'eco.research', 'eco.stability', 'eco.approval',
  'eco.unrest', 'eco.health', 'eco.popGrowth', 'eco.energyDemand', 'eco.gridLoss', 'eco.solar', 'eco.wind',
  'eco.nuclear', 'eco.storage', 'eco.cyberDefense', 'eco.disasterResist',
  // military generic
  'mil.org', 'mil.supply', 'mil.speed', 'mil.production', 'mil.upkeep', 'mil.entrench', 'mil.vision', 'mil.cyber', 'mil.ew',
  // land
  'mil.infantry.attack', 'mil.infantry.defense', 'mil.mech.attack', 'mil.armor.attack', 'mil.armor.defense',
  'mil.artillery.accuracy', 'mil.artillery.range',
  // air
  'mil.air.attack', 'mil.air.defense', 'mil.air.range', 'mil.sam.intercept', 'mil.radar.range', 'mil.drone.attack',
  // naval
  'mil.naval.attack', 'mil.naval.defense', 'mil.naval.detect', 'mil.naval.speed', 'mil.sub.stealth', 'mil.blockade', 'mil.amphibious',
  // missiles / nuclear
  'mil.missile.accuracy', 'mil.missile.range', 'mil.missile.speed', 'mil.abm.intercept', 'mil.nuke.yield',
] as const;
export type KnownModifierKey = (typeof MODIFIER_KEYS)[number];

export type Branch = 'army' | 'air' | 'navy' | 'strategic' | 'economy' | 'society';
export const BRANCHES: readonly Branch[] = ['army', 'air', 'navy', 'strategic', 'economy', 'society'];
