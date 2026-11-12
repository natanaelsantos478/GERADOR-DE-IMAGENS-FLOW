/**
 * MERIDIANO — simulation contracts (PLANO §6). Owned by Fundação/Integração; other modules NEVER edit
 * this file. They extend it through TypeScript declaration merging from inside their own directory.
 *
 * ## Extension mechanism
 * Five interfaces here are intentionally open and meant to be augmented:
 *   - `SliceMap`   — the type of each module's slice of GameState (`state.economy`, …).
 *   - `CommandMap` — payloads of a module's commands, keyed by full type (`'eco.setTax'`).
 *   - `EventMap`   — payloads of a module's bus events, keyed by full type (`'mil.battleStarted'`).
 *   - `EconomyApi`, `DiplomacyApi`, `ResearchApi`, `MilitaryApi`, `TacticalApi`, `AiApi` and the
 *     `*View` interfaces — modules may ADD members (never change the ones declared here).
 * Unaugmented slices are `unknown`; unknown command/event types still type-check as the generic
 * `Command` / `GameEvent`.
 *
 * Example (in `src/sim/economy/types.ts`, which must be imported by the module so it is compiled):
 * ```ts
 * import type { CountryId } from '../../core/contracts';
 * export interface EconomyState { treasury: Record<CountryId, number> }
 * declare module '../../core/contracts' {
 *   interface SliceMap { economy: EconomyState }
 *   interface CommandMap { 'eco.setTax': { tax: 'income' | 'corporate' | 'consumption'; value: number } }
 *   interface EventMap { 'eco.blackout': { country: CountryId; ratio: number } }
 *   interface EconomyApi { gdp(c: CountryId): number }
 * }
 * ```
 * Then `ctx.state.economy` is `EconomyState`, `isCommand(cmd, 'eco.setTax')` narrows `cmd.value`,
 * `ctx.bus.on('eco.blackout', (e) => e.ratio)` is typed and `ctx.api.economy.gdp` exists.
 *
 * ## Registering a system
 * ```ts
 * // src/sim/economy/system.ts
 * import { defineSystem } from '../../core/registry';
 * export const economySystem = defineSystem({ id: 'economy', createSlice: (ctx) => ({ treasury: {} }),
 *   onDay(ctx) { … }, handle(ctx, cmd) { … }, api: (ctx) => ({ … }) });
 * ```
 * and add `economySystem` to the list in `src/app/systems.ts` (order there is irrelevant; the
 * registry enforces research → economy → diplomacy → military → tactical → ai).
 *
 * ## Rules recalled
 * - GameState is pure JSON (no Map/Set/class/typed array/undefined-as-value/NaN).
 * - No Math.random()/Date.now() in simulation: use `ctx.rng` and `ctx.state.time.hours`.
 * - APIs must read `ctx.state` on every call (never capture a slice): loading a save swaps it.
 */

import type { CountryId, InfraKind, LonLat, ProvinceId, WorldStatic } from './world-types';
import type { EventBus } from './bus';
import type { Rng, RngState } from './rng';

export type * from './world-types';
export { FUELS } from './world-types';
export type { EventBus } from './bus';
export type { Rng, RngState } from './rng';

// ---------------------------------------------------------------- ids

export type SystemId = 'economy' | 'diplomacy' | 'research' | 'military' | 'tactical' | 'ai';
/** Update order (PLANO §6). */
export const SYSTEM_ORDER: readonly SystemId[] = ['research', 'economy', 'diplomacy', 'military', 'tactical', 'ai'];
/** Command/event prefix owned by each system; `game`, `world`, `time` and `news` belong to core. */
export const SYSTEM_PREFIX = {
  economy: 'eco',
  diplomacy: 'dip',
  research: 'res',
  military: 'mil',
  tactical: 'tac',
  ai: 'ai',
} as const satisfies Record<SystemId, string>;
export type SystemPrefix = (typeof SYSTEM_PREFIX)[SystemId];
export type CorePrefix = 'game' | 'world' | 'time' | 'news';
export type Prefix = SystemPrefix | CorePrefix;

export type StructureId = string;
export type FormationId = string;
export type BattleId = string;
export type WarId = string;
export type TechId = string;
export type UnitTemplateId = string;
/** Namespaced modifier key, e.g. `eco.taxEfficiency`, `mil.armor.attack`. */
export type ModifierKey = string;
/** i18n key (pt-BR is the reference dictionary). */
export type TextKey = string;

export type Difficulty = 'sandbox' | 'normal' | 'hard';

// ---------------------------------------------------------------- resources & cost

/**
 * Resources (PLANO §6 economy). `energy` is a flow (MW), never stocked or charged.
 * Units: money = millions of USD; oil = thousand barrels; food, steel = thousand tonnes;
 * rareEarth, uranium = tonnes; electronics, consumerGoods, munitions = production lots
 * (1 lot ≈ 1 M USD of goods at 2026 prices).
 */
export type ResourceId =
  | 'money'
  | 'energy'
  | 'oil'
  | 'food'
  | 'steel'
  | 'electronics'
  | 'rareEarth'
  | 'uranium'
  | 'munitions'
  | 'consumerGoods';
export type StockResource = Exclude<ResourceId, 'energy'>;
export const RESOURCES: readonly ResourceId[] = [
  'money', 'energy', 'oil', 'food', 'steel', 'electronics', 'rareEarth', 'uranium', 'munitions', 'consumerGoods',
];
/** A price in stocked resources; missing entries are 0. */
export type Cost = Partial<Record<StockResource, number>>;

// ---------------------------------------------------------------- state

export const SAVE_VERSION = 1;

export interface GameMeta {
  /** Save format version (`SAVE_VERSION`). */
  version: number;
  dataHash: string;
  seed: number;
  playerCountryId: CountryId;
  difficulty: Difficulty;
  /** Optional automations, e.g. `eco.budget`, `eco.build`, `eco.trade`, `mil.production`. */
  automation: Record<string, boolean>;
  /** Next id for `NewsItem.id`. */
  nextNewsId: number;
}

/** 0 = stopped; 1..5 see `SPEED_HOURS_PER_SECOND` in clock.ts. */
export type Speed = 0 | 1 | 2 | 3 | 4 | 5;

export interface TimeState {
  /** Game hours since 2026-01-01T00:00Z. */
  hours: number;
  speed: Speed;
  paused: boolean;
}

/** Sparse damage map, infrastructure index → damage 0..1 (absent = 0). */
export type DamageMap = Record<number, number>;

export interface WorldDyn {
  owner: Record<ProvinceId, CountryId>;
  controller: Record<ProvinceId, CountryId>;
  alive: Record<CountryId, boolean>;
  /** Puppet → overlord. */
  overlord: Record<CountryId, CountryId>;
  cityDamage: DamageMap;
  plantDamage: DamageMap;
  airportDamage: DamageMap;
  portDamage: DamageMap;
  /** Keyed by road EDGE index. */
  roadDamage: DamageMap;
}

export type NewsKind = 'economy' | 'diplomacy' | 'research' | 'military' | 'tactical' | 'politics' | 'world' | 'disaster' | 'game';
/** 0 = minor (feed only), 1 = normal, 2 = alert (shown prominently). */
export type NewsImportance = 0 | 1 | 2;
export type NewsWhere =
  | { lon: number; lat: number }
  | { province: ProvinceId }
  | { country: CountryId }
  | { formation: FormationId }
  | { battle: BattleId };
export type NewsParams = Record<string, string | number | boolean>;

export interface NewsItem {
  id: number;
  hours: number;
  kind: NewsKind;
  textKey: TextKey;
  params: NewsParams;
  where?: NewsWhere;
  /** Countries involved (used for filtering "my news"). */
  countries?: CountryId[];
  importance: NewsImportance;
}
export const NEWS_LIMIT = 300;

/** Augment with `{ [systemId]: SliceType }` from each module. */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface SliceMap {}
export type Slice<K extends SystemId> = K extends keyof SliceMap ? SliceMap[K] : unknown;

export type GameState = {
  meta: GameMeta;
  time: TimeState;
  rng: RngState;
  world: WorldDyn;
  /** Newest last; at most NEWS_LIMIT. */
  news: NewsItem[];
} & { [K in SystemId]: Slice<K> };

// ---------------------------------------------------------------- commands

/** Augment with `{ 'pfx.action': Payload }`; `type` and `country` are added automatically. */
export interface CommandMap {
  'game.setSpeed': { speed: Speed };
  'game.pause': Record<never, never>;
  'game.resume': Record<never, never>;
  'game.togglePause': Record<never, never>;
  'game.setAutomation': { key: string; value: boolean };
}
export type CommandType = keyof CommandMap;
/** A concrete, typed command. */
export type CommandOf<T extends CommandType> = { type: T; country: CountryId } & CommandMap[T];
export type KnownCommand = { [T in CommandType]: CommandOf<T> }[CommandType];
/** Any command; the player and the AI issue exactly the same commands. */
export interface Command {
  type: `${Prefix}.${string}`;
  /** The country issuing the command. */
  country: CountryId;
  [k: string]: unknown;
}
export type CommandResult = { ok: true; [k: string]: unknown } | { ok: false; reason: TextKey; params?: NewsParams };

// ---------------------------------------------------------------- events

/** Augment with `{ 'pfx.name': Payload }`. */
export interface EventMap {
  'world.controllerChanged': { province: ProvinceId; from: CountryId; to: CountryId; cause?: string };
  'world.ownerChanged': { province: ProvinceId; from: CountryId; to: CountryId; cause?: string };
  'world.damaged': { kind: InfraKind; index: number; amount: number; total: number; cause: string };
  'world.repaired': { kind: InfraKind; index: number; amount: number; total: number };
  'world.countryKilled': { country: CountryId; by?: CountryId };
  'world.countryRevived': { country: CountryId };
  'world.overlordChanged': { country: CountryId; overlord: CountryId | null };
  'time.day': { hours: number };
  'time.week': { hours: number };
  'time.month': { hours: number; year: number; month: number };
  'time.year': { hours: number; year: number };
  'game.command': { command: Command; result: CommandResult };
  'game.speedChanged': { speed: Speed; paused: boolean };
  'game.loaded': { hours: number };
  'news.added': { item: NewsItem };
}
export type EventType = keyof EventMap;
export type EventOf<T extends EventType> = { type: T } & EventMap[T];
export type KnownEvent = { [T in EventType]: EventOf<T> }[EventType];
export interface GameEvent {
  type: `${Prefix}.${string}`;
  [k: string]: unknown;
}

// ---------------------------------------------------------------- public API views

export type StructureKind =
  | 'powerPlant'
  | 'civilFactory'
  | 'militaryFactory'
  | 'refinery'
  | 'mine'
  | 'farm'
  | 'hospital'
  | 'university'
  | 'road'
  | 'railway'
  | 'port'
  | 'airport'
  | 'militaryBase'
  | 'airDefense'
  | 'radar'
  | 'silo'
  | 'bunker';

/** A structure built during the game (static real infrastructure lives in WorldStatic). */
export interface StructureView {
  id: StructureId;
  kind: StructureKind;
  country: CountryId;
  province: ProvinceId;
  lon: number;
  lat: number;
  /** 0..1, 1 = complete. */
  progress: number;
  /** 1 − damage. */
  health: number;
  /** For power plants. */
  fuel?: import('./world-types').Fuel;
  /** For power plants. */
  mw?: number;
  /** For road/railway: the two road-graph nodes it links. */
  nodes?: [number, number];
}
export interface StructureFilter {
  country?: CountryId;
  province?: ProvinceId;
  kind?: StructureKind;
  /** Include structures still under construction (default true). */
  includeUnfinished?: boolean;
}

export interface EnergyBalance {
  supplyMw: number;
  demandMw: number;
  /** supply / demand, capped at 1 when demand is 0. */
  ratio: number;
}

export type UnrestTarget = { country: CountryId } | { province: ProvinceId } | { city: number };

export interface LedgerLine {
  /** i18n key of the line (e.g. `eco.ledger.incomeTax`). */
  key: TextKey;
  category: 'revenue' | 'expense';
  /** Millions of USD per month; positive for revenue, negative for expenses. */
  amount: number;
}

export interface WarView {
  id: WarId;
  attackers: CountryId[];
  defenders: CountryId[];
  /** War leader of each side. */
  attackerLeader: CountryId;
  defenderLeader: CountryId;
  startedHours: number;
  casusBelli: TextKey;
}
export type WarSide = 'attackers' | 'defenders';

export interface ResearchProgress {
  current: TechId | null;
  /** 0..1 of the current tech. */
  progress: number;
  pointsPerDay: number;
  queue: TechId[];
  researched: number;
}

export type Domain = 'land' | 'air' | 'naval';

export interface FormationUnitView {
  template: UnitTemplateId;
  /** Strength 0..1 of this unit. */
  strength: number;
  modelId: string;
}

export interface FormationView {
  id: FormationId;
  country: CountryId;
  name: string;
  domain: Domain;
  pos: LonLat;
  /** Degrees clockwise from north. */
  heading: number;
  /** Province under the formation (null at sea / in the air over sea). */
  province: ProvinceId | null;
  units: FormationUnitView[];
  /** All 0..1. */
  strength: number;
  organization: number;
  morale: number;
  experience: number;
  supply: number;
  /** Current order kind, e.g. `idle`, `move`, `attack`, `defend`, `patrol`. */
  order: string;
  destination: LonLat | null;
  battleId: BattleId | null;
}
export interface FormationFilter {
  country?: CountryId;
  domain?: Domain;
  province?: ProvinceId;
  bbox?: import('./world-types').BBox;
}

export interface BattleView {
  id: BattleId;
  pos: LonLat;
  province: ProvinceId | null;
  attackers: FormationId[];
  defenders: FormationId[];
  attackerCountries: CountryId[];
  defenderCountries: CountryId[];
  startedHours: number;
  /** −1 (defenders winning) .. 1 (attackers winning). */
  balance: number;
  /** True while the player commands it in tactical mode. */
  tactical: boolean;
}

export type SpawnWhere = { lon: number; lat: number } | { kind: 'city' | 'airport' | 'port'; index: number };

export interface StrikeCapability {
  cruiseMissiles: number;
  ballisticMissiles: number;
  nukes: number;
  bombers: number;
  drones: number;
  /** Longest strike range in km. */
  rangeKm: number;
}

export interface PathPreview {
  points: LonLat[];
  km: number;
  etaHours: number;
  mode: 'road' | 'offroad' | 'sea' | 'air' | 'mixed';
}

export interface TacticalBattleView {
  id: string;
  strategicBattleId: BattleId;
  center: LonLat;
  sizeM: number;
  /** 0 paused, 0.5, 1, 2, 4. */
  timeScale: number;
  elapsedS: number;
  finished: boolean;
}
export interface TacticalEntityView {
  id: number;
  side: 0 | 1;
  modelId: string;
  /** Local metres from the battle centre (x east, y north). */
  x: number;
  y: number;
  heading: number;
  hp: number;
  alive: boolean;
}
export interface TacticalSnapshot {
  battle: TacticalBattleView;
  entities: TacticalEntityView[];
}

export interface AdviceItem {
  key: TextKey;
  params: NewsParams;
  priority: number;
  /** Command that applies the advice, if it is directly actionable. */
  command?: Command;
  where?: NewsWhere;
}

// ---------------------------------------------------------------- public APIs (ctx.api.*)

export interface EconomyApi {
  /** Money in millions of USD. */
  treasury(c: CountryId): number;
  canAfford(c: CountryId, cost: Cost): boolean;
  /** Charges atomically; returns false and charges nothing if unaffordable (sandbox: always true for the player). */
  charge(c: CountryId, cost: Cost, reasonKey: TextKey): boolean;
  credit(c: CountryId, amount: number, reasonKey: TextKey): void;
  stock(c: CountryId, res: StockResource): number;
  /** Removes up to `amount`; returns what was actually consumed. */
  consume(c: CountryId, res: StockResource, amount: number): number;
  energy(c: CountryId): EnergyBalance;
  /** 0..100. */
  stability(c: CountryId): number;
  /** 0..100. */
  approval(c: CountryId): number;
  /** 0..100 for a city index. */
  citySatisfaction(cityIdx: number): number;
  addUnrest(target: UnrestTarget, delta: number, reasonKey: TextKey, days: number): void;
  manpower(c: CountryId): number;
  /** Returns how many were actually drawn. */
  drawManpower(c: CountryId, n: number): number;
  returnManpower(c: CountryId, n: number): void;
  /** Military-industry points per day. */
  militaryIndustry(c: CountryId): number;
  structures(filter?: StructureFilter): StructureView[];
  /** Nearest built structure within `radiusKm` (default 5), for picking/targeting. */
  structureAt(lon: number, lat: number, radiusKm?: number): StructureView | null;
  ledger(c: CountryId): LedgerLine[];
}

export interface DiplomacyApi {
  /** −100..100. */
  relation(a: CountryId, b: CountryId): number;
  atWar(a: CountryId, b: CountryId): boolean;
  allied(a: CountryId, b: CountryId): boolean;
  enemies(c: CountryId): CountryId[];
  wars(): WarView[];
  /** Whether `a` may move troops through `b`'s territory (own, allied, access treaty or war). */
  access(a: CountryId, b: CountryId): boolean;
  tradeDeal(a: CountryId, b: CountryId): boolean;
  modRelation(a: CountryId, b: CountryId, delta: number, reasonKey: TextKey): void;
  /** −100..100 from the point of view of `side`. */
  warScore(war: WarId, side: WarSide): number;
}

export interface ResearchApi {
  has(c: CountryId, tech: TechId): boolean;
  /** Product of tech effects and active temporary modifiers; 1 when none. */
  mod(c: CountryId, key: ModifierKey): number;
  /** Multiplicative factor (1.1 = +10%) active until `untilHours` (null = permanent) tagged by `source`. */
  addModifier(c: CountryId, key: ModifierKey, value: number, untilHours: number | null, source: string): void;
  progress(c: CountryId): ResearchProgress;
}

export interface MilitaryApi {
  formations(filter?: FormationFilter): FormationView[];
  formation(id: FormationId): FormationView | null;
  /** Aggregate military power score. */
  power(c: CountryId): number;
  upkeepPerDay(c: CountryId): Cost;
  battles(): BattleView[];
  battle(id: BattleId): BattleView | null;
  spawn(c: CountryId, template: UnitTemplateId, where: SpawnWhere): FormationId | null;
  strikeCapability(c: CountryId): StrikeCapability;
  pathPreview(formationId: FormationId, destination: LonLat): PathPreview | null;
}

export interface TacticalApi {
  active(): TacticalBattleView | null;
  start(battleId: BattleId): CommandResult;
  snapshot(): TacticalSnapshot | null;
}

export interface AiApi {
  /** Advisor suggestions for a (player) country, highest priority first. */
  advice(c: CountryId): AdviceItem[];
}

export interface WorldDynApi {
  setController(p: ProvinceId, c: CountryId, cause?: string): void;
  /** Sets owner (and controller too unless `keepController`). */
  setOwner(p: ProvinceId, c: CountryId, opts?: { keepController?: boolean; cause?: string }): void;
  /** Adds damage (clamped to 1); returns the damage actually applied. */
  damage(kind: InfraKind, index: number, amount: number, cause: string): number;
  /** Removes damage (clamped to 0); returns the damage actually removed. */
  repair(kind: InfraKind, index: number, amount: number): number;
  killCountry(c: CountryId, by?: CountryId): void;
  reviveCountry(c: CountryId): void;
  setOverlord(c: CountryId, overlord: CountryId | null): void;
  ownerOf(p: ProvinceId): CountryId;
  controllerOf(p: ProvinceId): CountryId;
  isOccupied(p: ProvinceId): boolean;
  provincesOwnedBy(c: CountryId): readonly ProvinceId[];
  provincesControlledBy(c: CountryId): readonly ProvinceId[];
  isAlive(c: CountryId): boolean;
  aliveCountries(): readonly CountryId[];
  overlordOf(c: CountryId): CountryId | null;
  puppetsOf(c: CountryId): CountryId[];
  damageOf(kind: InfraKind, index: number): number;
  /** 1 − damage. */
  effectiveHealth(kind: InfraKind, index: number): number;
}

export interface ApiMap {
  economy: EconomyApi;
  diplomacy: DiplomacyApi;
  research: ResearchApi;
  military: MilitaryApi;
  tactical: TacticalApi;
  ai: AiApi;
  worldDyn: WorldDynApi;
}
export type Apis = ApiMap;

// ---------------------------------------------------------------- ctx & systems

export interface NewsOptions {
  countries?: CountryId[];
  importance?: NewsImportance;
}

export interface Ctx {
  readonly world: WorldStatic;
  /** Current state; replaced (same ctx) when a save is loaded — always read it through ctx. */
  state: GameState;
  readonly rng: Rng;
  readonly bus: EventBus;
  /** Accessing the API of an unregistered system throws a descriptive error. */
  readonly api: Apis;
  dispatch(cmd: Command | KnownCommand): CommandResult;
  news(kind: NewsKind, textKey: TextKey, params?: NewsParams, where?: NewsWhere, opts?: NewsOptions): NewsItem;
}

export interface SimSystem<K extends SystemId = SystemId> {
  id: K;
  /** Builds the slice for a NEW game. Systems earlier in SYSTEM_ORDER already have their slice. */
  createSlice(ctx: Ctx): Slice<K>;
  /** Once per Game, after slices exist (new or loaded): subscribe to the bus here. */
  init?(ctx: Ctx): void;
  /** After a save is hydrated: rebuild non-serialized caches. */
  onLoad?(ctx: Ctx): void;
  /** Every substep (dtHours ≤ 1, never crossing an hour boundary). */
  update?(ctx: Ctx, dtHours: number): void;
  onDay?(ctx: Ctx): void;
  /** Mondays 00:00. */
  onWeek?(ctx: Ctx): void;
  /** 1st of the month 00:00. */
  onMonth?(ctx: Ctx): void;
  /** Commands whose prefix is SYSTEM_PREFIX[id]. Return undefined for "not mine/unknown action". */
  handle?(ctx: Ctx, cmd: Command): CommandResult | undefined;
  /** Public API, stored in ctx.api[id]. Called once per Game before any createSlice. */
  api(ctx: Ctx): ApiMap[K];
  /** Numbers/strings printed by the headless soak runner. */
  metrics?(ctx: Ctx): Record<string, number | string>;
}
export type AnySimSystem = { [K in SystemId]: SimSystem<K> }[SystemId];

/** Type guard narrowing a generic command to a typed one. */
export function isCommand<T extends CommandType>(cmd: Command | KnownCommand, type: T): cmd is CommandOf<T> & Command {
  return cmd.type === type;
}
/** Type guard narrowing a generic event to a typed one. */
export function isEvent<T extends EventType>(e: GameEvent | KnownEvent, type: T): e is EventOf<T> & GameEvent {
  return e.type === type;
}
