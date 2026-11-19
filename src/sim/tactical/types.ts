/**
 * Tactical battle (PLANO 7.7) — pure, JSON-serializable state. Local metres: origin = battle centre,
 * x east, y north. Headings are radians clockwise from north (forward = (sin h, cos h)).
 */
import type { BattleId, CountryId, LonLat } from '../../core/contracts';
import type { RngState } from '../../core/rng';
import type { NavData } from '../../data/vector/nav';
import type { Incident, IncidentLog } from './incidents';

export type Side = 0 | 1;
export type AiEngine = 'neural' | 'rules';
export type UnitKind =
  | 'infantry' | 'special' | 'engineer' | 'mech' | 'mbt' | 'recon'
  | 'artillery' | 'mlrs' | 'sam' | 'logistics' | 'attackHeli';
export type FormationKind = 'line' | 'column' | 'wedge' | 'scatter';
export type SupportKind = 'artillery' | 'airstrike' | 'drone';
export type Phase = 'deploy' | 'combat' | 'ended';
export type Support = Record<SupportKind, number>;

/** Row-major grids (`y*n+x`, y grows north). cover: 0 open, 1 forest/scrub, 2 urban. */
export interface TacticalMap {
  sizeM: number;
  n: number;
  heights: number[];
  cover: number[];
  road: number[];
  water: number[];
  /** Fine real-world raster (OpenStreetMap vectors): when present, it drives passability, cover, roads and line of sight. */
  nav?: NavData;
  /**
   * Destroyed buildings, in order (part of the save). The nav raster stays untouched; the runtime patches the footprints of these
   * buildings into rubble (`SURF_RUBBLE`) when it is built and when a building falls. See `Rubble`.
   */
  rub?: Rubble[];
}
/**
 * One collapsed building, compact: `id` is the nav building id (`map.nav.buildings[id - 1]` has the footprint polygon `poly`, `h`, `cx`, `cy`, `area`, `kind`),
 * so the render can raise the debris from an editable pattern (footprint + height + material + how it fell).
 */
export interface Rubble {
  id: number;
  /** Battle time (s) it fell: drives the collapse animation (progress = (t_now - t) / duration). */
  t: number;
  /** Centre (local metres), height (m), floors, function kind (when known), material class. */
  x: number; y: number; h: number; fl: number; k?: string; m: 'light' | 'brick' | 'concrete' | 'reinforced';
  /** What brought it down. */
  by: 'shell' | 'rocket' | 'bomb' | 'missile' | 'breach' | 'fire';
}

/** Commander / condition modifiers computed by the strategic layer (all multipliers, 1 = neutral). */
export interface SquadFx {
  /** Fire accuracy, movement speed, morale resilience (loss multiplier) and recovery. */
  acc: number;
  spd: number;
  resolve: number;
  /** Starting fatigue 0..1. */
  fatigue: number;
}
/** Local weather as seen by the tactical layer. */
export interface TacticalWeather { vis: number; rain: number; fog: number; mud: number }

export interface SquadInput {
  /** Opaque back-reference (strategic formation/unit) echoed in the result. */
  ref: string;
  name?: string;
  kind: UnitKind;
  /** Number of 3D elements (vehicles / fire teams). */
  count: number;
  /** 0..1 */
  morale: number;
  /** 0..1 fraction of full ammunition. */
  ammo: number;
  /** Infantry elements carried (mech only) that can be dismounted. */
  cargo?: number;
  modelId?: string;
  /** Owner country (render picks a real-world model variant). */
  country?: string;
  /** Controlled by the AI even on the player's side (allies). */
  ai?: boolean;
  fx?: SquadFx;
}
export interface Rect { x: number; y: number; w: number; h: number }
export interface SideInput {
  country: CountryId;
  squads: SquadInput[];
  support: Support;
  /** Deployment rectangle (centre x,y, size w,h). Default: south band for side 0, north for side 1. */
  deploy?: Rect;
}
export interface ObjectiveInput { name?: string; x: number; y: number; r?: number; value?: number }
export interface TacticalBattleInput {
  id: string;
  strategicBattleId: BattleId;
  center: LonLat;
  map: TacticalMap;
  sides: [SideInput, SideInput];
  /** Side that attacks (the other holds the objectives at start). */
  attacker: Side;
  objectives?: ObjectiveInput[];
  timeLimitS?: number;
  deployLimitS?: number;
  /** Side commanded by a human (null: AI × AI). Non-player sides always use the AI. */
  player?: Side | null;
  weather?: TacticalWeather;
  engine?: [AiEngine, AiEngine];
  aiTemp?: number;
}

// ---------------------------------------------------------------- state
export interface Ent {
  id: number; sq: number; side: Side; kind: UnitKind;
  x: number; y: number; h: number;
  hp: number; alive: boolean; supp: number;
  am: number[]; cd: number[]; tg: number[];
  /** Seconds standing still. */
  still: number;
  moving: boolean;
  /** Last time an enemy saw it (indirect fire needs this). */
  spotT: number;
  gone: boolean;
}
export type OrderKind = 'idle' | 'move' | 'amove' | 'attack' | 'hold' | 'retreat' | 'occupy';
export interface Squad {
  id: number; ref: string; name: string; side: Side; kind: UnitKind; modelId: string; country?: string;
  /** Mean distance (m) of its elements from their slots, measured by the last entity step; part of the saved state (drives the formation pace). */
  lag?: number;
  form: FormationKind; face: number;
  x: number; y: number;
  order: OrderKind; ox: number; oy: number; target: number;
  path: number[]; pi: number; repath: number;
  /** Marked route: remaining waypoints [x,y,...] after the current leg (whose target is `ox,oy`); each leg is searched on demand when the previous one ends. */
  route?: number[];
  /** Breach order: a tracked squad may demolish small buildings in its way (`brk` = building being demolished, nav id). */
  breach?: boolean; brk?: number;
  fireFree: boolean;
  /** Building (nav id) occupied / being entered or left by this infantry squad; `gar` = garrisoned inside. */
  inb?: number; gar?: number;
  /** Path request deferred by the per-tick search budget (target x,y). */
  pend?: [number, number];
  dug: number; digging: boolean;
  morale: number; routed: boolean; ai: boolean;
  n0: number; smoke: number; cargo: number;
  engagedT: number;
  /** Commander modifiers (absent = neutral) and fatigue 0..1. */
  fx?: SquadFx;
  fg: number;
  /** Next time (battle s) the neural AI re-evaluates this squad. */
  nt?: number;
  /** Field incident slowing/stopping it (incidents.ts), squad leader entity (-1 = killed) and last "surrounded" report. */
  inc?: Incident; lead?: number; encT?: number;
  /** AI: reached its envelopment position and is now closing in (ai.ts). */
  ring?: boolean;
  /** Battle time until which a player's order overrides the AI on this squad (system.ts / ai.ts). */
  man?: number;
}
export interface Proj {
  id: number; kind: 'bullet' | 'shell' | 'missile' | 'rocket' | 'bomb';
  x0: number; y0: number; x1: number; y1: number; t0: number; t1: number;
  side: Side; tgt: number; hit: boolean; dmg: number; pen: number; ar: number; supp: number; face: number; air: boolean;
}
export interface Smoke { x: number; y: number; r: number; until: number }
export interface Pending { kind: SupportKind; side: Side; x: number; y: number; at: number; n: number; done: number }
export interface Objective { id: number; name: string; x: number; y: number; r: number; value: number; owner: Side | -1; cap: number }

export interface SquadResult {
  ref: string; side: Side; kind: UnitKind; initial: number; alive: number;
  /** 0..1 remaining strength (sum hp / initial hp). */
  strength: number; morale: number; ammo: number; withdrawn: boolean;
  /** Fatigue at the end (0..1, worst of the squad's rows). */
  fatigue?: number;
}
export interface TacticalResult {
  winner: Side | null;
  reason: 'destruction' | 'morale' | 'points' | 'withdrawn' | 'aborted';
  elapsedS: number;
  score: [number, number];
  squads: SquadResult[];
  casualties: [number, number];
  /** 0..1 damage to the surrounding city/infrastructure from explosions in urban cells. */
  collateral: number;
}

export interface Battle {
  v: 1;
  id: string; strategicBattleId: BattleId; center: LonLat;
  map: TacticalMap;
  country: [CountryId, CountryId];
  rng: RngState;
  t: number; acc: number; tick: number;
  phase: Phase; deployLimit: number; timeLimit: number;
  attacker: Side; player: Side | null;
  auto: [boolean, boolean]; ready: [boolean, boolean]; withdrawing: [boolean, boolean];
  deploy: [Rect, Rect];
  ents: Ent[]; squads: Squad[]; proj: Proj[]; smokes: Smoke[]; pend: Pending[]; objs: Objective[];
  support: [Support, Support];
  score: [number, number];
  urbanHits: number;
  /** Real-terrain effects: pending events for the system, bridge/structure hit points, fires, outages. */
  ev?: ({ k: 'protectedHit'; kind: string; x: number; y: number; side: Side; t: number } | { k: 'bridgeDestroyed'; x: number; y: number; t: number } | { k: 'infraDestroyed'; kind: string; effect: string; x: number; y: number; t: number } | { k: 'buildingDestroyed'; id: number; x: number; y: number; kind: string; floors: number; h: number; civil: boolean; prot: boolean; weight: number; by: Rubble['by']; side: Side | -1; t: number })[];
  /** Hit points left of damaged buildings (nav id -> hp); absent = intact. */
  bldHp?: Record<string, number>;
  prot?: Record<string, number>; bhp?: Record<string, number>; infraHp?: Record<string, number>;
  fires?: { c: number; until: number }[]; burnt?: number[];
  blackout?: number; commsDown?: number;
  /** Garrisoned buildings: nav building id -> squad id. */
  garr?: Record<string, number[]>;
  nextProj: number;
  result: TacticalResult | null;
  /** Disables the tactical AI entirely (scripted scenarios/tests). */
  noAi?: boolean;
  /** Last field incidents / morale shocks (incidents.ts), newest last. */
  incLog?: IncidentLog[];
  /** AI engine per side; undefined = rules; the game sets it from `ai.engine.neural`. */
  engine?: [AiEngine, AiEngine];
  /** Softmax temperature of the neural choice (difficulty); 0 = argmax. */
  aiTemp?: number;
  /** Local weather (absent = clear). */
  wx?: TacticalWeather;
}

// ---------------------------------------------------------------- orders
export type Order =
  /** `via`: intermediate waypoints [x,y,...] visited in order before (x,y); `breach`: tracked vehicles may demolish small buildings. */
  | { kind: 'move'; x: number; y: number; via?: number[]; breach?: boolean }
  | { kind: 'attackMove'; x: number; y: number; via?: number[]; breach?: boolean }
  | { kind: 'attack'; target: number }
  | { kind: 'hold' }
  | { kind: 'retreat' }
  | { kind: 'formation'; form: FormationKind; facing?: number }
  | { kind: 'face'; facing: number }
  | { kind: 'fire'; free: boolean }
  | { kind: 'dig' }
  | { kind: 'occupy'; building: number }
  | { kind: 'smoke'; x?: number; y?: number }
  | { kind: 'dismount' }
  | { kind: 'ready' }
  | { kind: SupportKind; x: number; y: number };
export type OrderResult = { ok: true } | { ok: false; reason: string };

// ---------------------------------------------------------------- slice of GameState
export interface TacticalState {
  battle: Battle | null;
  timeScale: number;
  paused: boolean;
  counter: number;
  /** Countries on each strategic side (0 = attackers, 1 = defenders) of the active battle. */
  countries: [string[], string[]];
  /** The strategic clock was paused by `start` and must be resumed on exit. */
  resume: boolean;
  /** Result already pushed to the strategic layer. */
  applied: boolean;
  last: { strategicBattleId: string; winner: Side | null; reason: string } | null;
}

declare module '../../core/contracts' {
  interface SliceMap { tactical: TacticalState }
  interface CommandMap {
    'tac.start': { battleId: string };
    'tac.order': { squads: number[]; order: Order };
    'tac.ready': Record<never, never>;
    'tac.speed': { scale: number };
    'tac.pause': { paused?: boolean };
    'tac.auto': { value: boolean };
    'tac.withdraw': Record<never, never>;
    'tac.exit': { resolve?: 'auto' };
  }
  interface EventMap {
    'tac.battleStarted': { battleId: string; tacticalId: string };
    'tac.battleEnded': { battleId: string; result: TacticalResult | null };
    /** Area fire or direct hit on a hospital / school / place of worship / cemetery (DIP/ECO may listen: reputation, population support). */
    'tac.protectedHit': { battleId: string; kind: string; x: number; y: number; side: 0 | 1 };
    'tac.bridgeDestroyed': { battleId: string; x: number; y: number };
    'tac.infraDestroyed': { battleId: string; kind: string; effect: string; x: number; y: number };
    /**
     * A building collapsed. `kind` = function ('house' when unknown); `civil`: the strategic layer may lower satisfaction / raise damages (`weight` > 0 scales it,
     * bigger for taller buildings and x6 for protected sites such as hospitals, schools and worship); `prot`: protected site; `side` = who did it (-1: unknown).
     */
    'tac.buildingDestroyed': { battleId: string; id: number; x: number; y: number; kind: string; floors: number; civil: boolean; prot: boolean; weight: number; by: string; side: 0 | 1 | -1 };
  }
  interface TacticalApi {
    /** Advance real time (seconds); applies timeScale/pause. Called by the render/UI loop each frame. */
    advance(dtRealS: number): void;
    /** Full simulation state of the active battle (read-only use) for UI queries. */
    battle(): Battle | null;
  }
  interface TacticalBattleView {
    phase: Phase;
    paused: boolean;
    auto: boolean;
    player: 0 | 1 | null;
    result: TacticalResult | null;
  }
  interface TacticalEntityView {
    squad: number;
    kind: UnitKind;
    moving: boolean;
    suppressed: boolean;
  }
  interface TacticalSnapshot {
    squads: TacSquadView[];
    projectiles: TacProjView[];
    smokes: Smoke[];
    objectives: Objective[];
    deploy: [Rect, Rect];
    score: [number, number];
    support: [Support, Support];
  }
}
export interface TacSquadView {
  id: number; side: Side; kind: UnitKind; name: string; x: number; y: number; face: number;
  alive: number; n0: number; morale: number; fatigue: number; routed: boolean; order: OrderKind; route?: number[]; breach?: boolean; brk?: number; form: FormationKind; dug: number; smoke: number; fireFree: boolean; ai: boolean; cargo: number;
}
export interface TacProjView { id: number; kind: Proj['kind']; x0: number; y0: number; x1: number; y1: number; t0: number; t1: number }

/** Payload sent to MIL's `mil.applyTacticalResult` (structurally identical to MIL's `TacticalOutcome`). */
export interface TacticalOutcomeLike {
  battle: string;
  winner: 'attackers' | 'defenders' | 'draw';
  squads: { ref: string; strength: number; morale: number; fatigue?: number }[];
  collateral?: number;
}
