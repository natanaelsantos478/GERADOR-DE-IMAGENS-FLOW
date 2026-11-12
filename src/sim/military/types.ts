/** MIL state, commands, events and API extensions (declaration merging into core contracts). */
import type {
  BattleId, BattleView, CountryId, Domain, FormationId, FormationView, LonLat, ProvinceId, UnitTemplateId,
} from '../../core/contracts';

export type MilDomain = Domain | 'missile';

/** Equipment/unit group inside a formation. `k` = battalion/squadron/ship equivalents, `s` = strength 0..1. */
export interface Slot {
  t: UnitTemplateId;
  k: number;
  s: number;
}

export type BaseRef = { kind: 'city' | 'airport' | 'port'; index: number };
export type TargetRef =
  | { kind: 'city' | 'plant' | 'airport' | 'port'; index: number }
  | { kind: 'road'; index: number }
  | { kind: 'formation'; id: FormationId };

export type Order =
  | { k: 'idle' }
  | { k: 'move'; to: LonLat; attack?: boolean; retreat?: boolean }
  | { k: 'defend' }
  | { k: 'blockade'; port: number }
  | { k: 'strike'; target: TargetRef; phase: 'out' | 'back' };

/** Compact route. Road routes: `w` = [approachFrom, roadStart, roadEnd, finalTo] (8 numbers) and `ed` = edge*2+reverse. */
export interface Route {
  m: 'road' | 'offroad' | 'sea' | 'air';
  w: number[];
  ed: number[];
  /** Current leg index and km travelled inside it. */
  i: number;
  km: number;
  /** Total km, km already covered, eta (game hours) at planning time. */
  tot: number;
  dn: number;
  eta: number;
}

export interface Formation {
  id: FormationId;
  c: CountryId;
  n: string;
  d: Domain;
  p: LonLat;
  h: number;
  pr: ProvinceId | null;
  u: Slot[];
  /** organization, morale, experience, supply, entrenchment (0..1). */
  o: number;
  m: number;
  x: number;
  s: number;
  e: number;
  od: Order;
  rt: Route | null;
  /** True while waiting for the path planner. */
  pend?: boolean;
  home: BaseRef | null;
  bt: BattleId | null;
  /** Carrier formation (embarked) — position follows it. */
  cr?: FormationId;
  /** Rebel formation hostile to this country. */
  reb?: CountryId;
}

export interface Battle {
  id: BattleId;
  p: LonLat;
  pr: ProvinceId | null;
  kind: 'land' | 'naval';
  a: FormationId[];
  d: FormationId[];
  ac: CountryId[];
  dc: CountryId[];
  t0: number;
  bal: number;
  tac: boolean;
  /** Casualties in men/crew by country, plus strength lost per side (0..). */
  cas: Record<CountryId, number>;
}

export interface QueueItem {
  id: number;
  t: UnitTemplateId;
  qty: number;
  /** Remaining industry points of the unit in progress (0 = not started). */
  left: number;
  at: BaseRef | null;
}

export interface Flight {
  id: number;
  c: CountryId;
  w: 'cruise' | 'ballistic' | 'nuke';
  from: LonLat;
  to: LonLat;
  target: TargetRef;
  t0: number;
  eta: number;
}

export interface StockState {
  cruise: number;
  ballistic: number;
  nuke: number;
}

export interface MilitaryState {
  forms: Record<FormationId, Formation>;
  battles: Record<BattleId, Battle>;
  queue: Record<CountryId, QueueItem[]>;
  stock: Record<CountryId, StockState>;
  flights: Flight[];
  /** Occupation progress: province → who and hours accumulated. */
  occ: Record<ProvinceId, { by: CountryId; h: number; t?: number }>;
  /** Fuel / ammo supply ratios by country (0..1). */
  sh: Record<CountryId, [number, number]>;
  /** Radiation zones. */
  rad: { p: LonLat; until: number }[];
  /** Blockaded port indices → until hours (refreshed hourly). */
  blk: Record<number, number>;
  /** Per-country spending on tacticalSuspend etc. not needed; counters: */
  /** Upkeep calibration per country (real defense budget ≈ 2× scaled upkeep), fixed at world creation. */
  upk: Record<CountryId, number>;
  nextF: number;
  nextB: number;
  nextQ: number;
  nextFl: number;
}

export interface MilCasualtyReport {
  attackers: number;
  defenders: number;
  byCountry: Record<CountryId, number>;
}

/** Result of a tactical battle. `ref` of a squad = `${formationId}:${slotIndex}` as given by `battleForces`. */
export interface TacticalOutcome {
  battle: BattleId;
  winner: 'attackers' | 'defenders' | 'draw';
  squads: { ref: string; strength: number; morale: number }[];
  /** 0..1 damage to the city/infrastructure at the location. */
  collateral?: number;
}

declare module '../../core/contracts' {
  interface SliceMap {
    military: MilitaryState;
  }
  interface CommandMap {
    'mil.move': { formations: FormationId[]; to: LonLat; attack?: boolean };
    'mil.stop': { formations: FormationId[] };
    'mil.defend': { formations: FormationId[] };
    'mil.retreat': { formations: FormationId[] };
    'mil.blockade': { formations: FormationId[]; port: number };
    'mil.produce': { template: UnitTemplateId; qty?: number; at?: BaseRef };
    'mil.cancelProduction': { id: number };
    'mil.merge': { a: FormationId; b: FormationId };
    'mil.split': { formation: FormationId; slots: number[] };
    'mil.embark': { formation: FormationId; carrier: FormationId };
    'mil.disembark': { formation: FormationId };
    'mil.strike': { formation: FormationId; target: TargetRef };
    'mil.launch': { weapon: 'cruise' | 'ballistic' | 'nuke'; target: TargetRef; from?: LonLat };
    'mil.setTactical': { battle: BattleId; active: boolean };
    'mil.applyTacticalResult': { result: TacticalOutcome };
    'mil.rename': { formation: FormationId; name: string };
  }
  interface EventMap {
    'mil.battleStarted': { battle: BattleId; province: ProvinceId | null; pos: LonLat; attackerCountries: CountryId[]; defenderCountries: CountryId[] };
    'mil.battleEnded': {
      battle: BattleId; province: ProvinceId | null; pos: LonLat; winner: 'attackers' | 'defenders' | 'draw';
      attackerCountries: CountryId[]; defenderCountries: CountryId[];
      casualties: { attackers: number; defenders: number; byCountry: Record<CountryId, number> };
    };
    'mil.provinceOccupied': { province: ProvinceId; by: CountryId; from: CountryId; owner: CountryId; capital: boolean };
    'mil.formationDestroyed': { formation: FormationId; country: CountryId; pos: LonLat };
    'mil.formationCreated': { formation: FormationId; country: CountryId };
    'mil.unitProduced': { country: CountryId; template: UnitTemplateId; formation: FormationId | null };
    'mil.strike': {
      attacker: CountryId; defender: CountryId | null; weapon: string; target: TargetRef; pos: LonLat;
      intercepted: boolean; damage: number;
    };
    'mil.missileLaunched': { flight: number; attacker: CountryId; weapon: 'cruise' | 'ballistic' | 'nuke'; from: LonLat; to: LonLat; eta: number };
    'mil.nukeDetonated': { attacker: CountryId; defender: CountryId | null; country: CountryId; targetCountry: CountryId | null; pos: LonLat; province: ProvinceId | null; killedEstimate: number };
    'mil.rebelsSpawned': { province: ProvinceId; country: CountryId; formation: FormationId };
    'mil.rebelsDefeated': { province: ProvinceId; country: CountryId };
    'mil.rebelsHold': { province: ProvinceId; country: CountryId };
  }
  interface MilitaryApi {
    /** Fraction 0..1 of the country's port capacity under enemy blockade. */
    blockadeRatio(c: CountryId): number;
    /** Whether `viewer` sees the formation (own, allied, or inside vision/radar range). */
    visibleTo(viewer: CountryId, f: FormationId): boolean;
    stock(c: CountryId): StockState;
    battleForces(b: BattleId): import('./tactical').BattleForces | null;
  }
  interface FormationView {
    /** 0..1 fraction of the route covered, when moving. */
    routeProgress?: number;
    carriedBy?: FormationId | null;
    rebel?: boolean;
  }
  interface BattleView {
    kind?: 'land' | 'naval';
    casualties?: Record<CountryId, number>;
  }
}

export type { BattleId, BattleView, FormationView };
