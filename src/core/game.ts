/** The Game: owns ctx, the clock loop, command dispatch and save/load of GameState. */
import type {
  AnySimSystem, ApiMap, Command, CommandResult, CountryId, Ctx, Difficulty, GameState, KnownCommand,
  Speed, SystemId, WorldStatic,
} from './contracts';
import { SAVE_VERSION, SYSTEM_ORDER } from './contracts';
import { createBus, type EventBus } from './bus';
import { boundaryAt, forEachSubstep, hoursToDate, MAX_REAL_DT_SECONDS, SPEED_HOURS_PER_SECOND } from './clock';
import { jsonClone } from './json';
import { pushNews } from './news';
import { createRegistry, prefixOf, type Registry } from './registry';
import { rngFrom, seedRng } from './rng';
import { createWorldDyn, createWorldDynApi, type WorldDynInternal } from './worldDyn';

export interface NewGameOptions {
  systems: readonly AnySimSystem[];
  playerCountryId: CountryId;
  seed?: number;
  difficulty?: Difficulty;
  automation?: Record<string, boolean>;
  /** Default 1. */
  speed?: Speed;
  /** Default true. */
  paused?: boolean;
}

export const SAVE_FORMAT = 'meridiano-save';

export interface SaveFile {
  format: typeof SAVE_FORMAT;
  version: number;
  dataHash: string;
  hours: number;
  playerCountryId: CountryId;
  state: GameState;
}

export class SaveError extends Error {
  constructor(
    public readonly code: 'format' | 'version' | 'dataHash' | 'state',
    message: string,
  ) {
    super(message);
    this.name = 'SaveError';
  }
}

export interface GamePerf {
  /** Wall-clock ms of the last `step`/`advanceHours`. */
  lastStepMs: number;
  /** Exponential average of wall-clock ms per simulated game day. */
  msPerDay: number;
}

export interface Game {
  readonly world: WorldStatic;
  readonly ctx: Ctx;
  readonly bus: EventBus;
  readonly registry: Registry;
  readonly state: GameState;
  readonly perf: GamePerf;
  /** Advance by real seconds at the current speed (no-op while paused). Returns game hours advanced. */
  step(dtRealSeconds: number): number;
  /** Advance exactly `hours` of game time regardless of pause/speed (headless runner, tests). */
  advanceHours(hours: number): void;
  dispatch(cmd: Command | KnownCommand): CommandResult;
  serialize(): SaveFile;
  /** Replaces the state with a save (same Game, same ctx). Throws SaveError. */
  hydrate(save: unknown, opts?: { ignoreDataHash?: boolean }): void;
}

const DEFAULT_SEED = 20260101;

function buildState(world: WorldStatic, o: NewGameOptions): GameState {
  const seed = (o.seed ?? DEFAULT_SEED) >>> 0;
  const base = {
    meta: {
      version: SAVE_VERSION,
      dataHash: world.dataHash,
      seed,
      playerCountryId: o.playerCountryId,
      difficulty: o.difficulty ?? 'normal',
      automation: { ...(o.automation ?? {}) },
      nextNewsId: 1,
    },
    time: { hours: 0, speed: o.speed ?? 1, paused: o.paused ?? true },
    rng: seedRng(seed),
    world: createWorldDyn(world),
    news: [],
  };
  // Slices of unregistered systems stay null (JSON-pure placeholder).
  const slices = Object.fromEntries(SYSTEM_ORDER.map((id) => [id, null]));
  return { ...base, ...slices } as unknown as GameState;
}

/** New game. */
export function createGame(world: WorldStatic, opts: NewGameOptions): Game {
  if (!world.countryById.has(opts.playerCountryId)) throw new Error(`createGame: unknown player country '${opts.playerCountryId}'`);
  return assemble(world, opts.systems, buildState(world, opts), true);
}

/** Game from a save file (validated like `hydrate`). */
export function loadGame(world: WorldStatic, systems: readonly AnySimSystem[], save: unknown, opts?: { ignoreDataHash?: boolean }): Game {
  const s = validateSave(world, save, opts);
  return assemble(world, systems, jsonClone(s.state), false);
}

export function validateSave(world: WorldStatic, save: unknown, opts?: { ignoreDataHash?: boolean }): SaveFile {
  const s = save as Partial<SaveFile> | null;
  if (!s || typeof s !== 'object' || s.format !== SAVE_FORMAT) throw new SaveError('format', 'Arquivo não é um save do MERIDIANO');
  if (s.version !== SAVE_VERSION) throw new SaveError('version', `Versão de save ${s.version} incompatível (esperada ${SAVE_VERSION})`);
  if (!opts?.ignoreDataHash && s.dataHash !== world.dataHash)
    throw new SaveError('dataHash', `Save feito com outros dados (${s.dataHash} ≠ ${world.dataHash})`);
  const st = s.state as GameState | undefined;
  if (!st || !st.meta || !st.time || !st.rng || !st.world || !Array.isArray(st.news))
    throw new SaveError('state', 'Estado do save incompleto');
  if (!world.countryById.has(st.meta.playerCountryId)) throw new SaveError('state', `País do jogador desconhecido: ${st.meta.playerCountryId}`);
  return s as SaveFile;
}

function assemble(world: WorldStatic, systemList: readonly AnySimSystem[], initial: GameState, isNew: boolean): Game {
  const registry = createRegistry(systemList);
  const bus = createBus();
  const apis: Partial<ApiMap> = {};
  const apiProxy = {} as ApiMap;
  for (const id of [...SYSTEM_ORDER, 'worldDyn'] as (SystemId | 'worldDyn')[]) {
    Object.defineProperty(apiProxy, id, {
      enumerable: true,
      get() {
        const a = apis[id];
        if (!a) throw new Error(`API '${id}' indisponível: sistema não registrado em src/app/systems.ts`);
        return a;
      },
    });
  }

  const ctx: Ctx = {
    world,
    state: initial,
    rng: rngFrom(() => ctx.state.rng),
    bus,
    api: apiProxy,
    dispatch: (cmd) => dispatch(cmd),
    news: (kind, textKey, params, where, opts) => pushNews(ctx.state, bus, kind, textKey, params, where, opts),
  };

  const worldDyn: WorldDynInternal = createWorldDynApi(ctx);
  apis.worldDyn = worldDyn;
  for (const sys of registry.systems) (apis as Record<string, unknown>)[sys.id] = sys.api(ctx);

  const ensureSlices = (all: boolean) => {
    const st = ctx.state as unknown as Record<string, unknown>;
    for (const sys of registry.systems) if (all || st[sys.id] === null || st[sys.id] === undefined) st[sys.id] = sys.createSlice(ctx);
    for (const id of SYSTEM_ORDER) if (st[id] === undefined) st[id] = null;
  };
  ensureSlices(isNew);
  for (const sys of registry.systems) sys.init?.(ctx);
  if (!isNew) for (const sys of registry.systems) sys.onLoad?.(ctx);

  const perf: GamePerf = { lastStepMs: 0, msPerDay: 0 };

  function handleCore(cmd: Command): CommandResult {
    const t = ctx.state.time;
    const emitSpeed = () => bus.emit({ type: 'game.speedChanged', speed: t.speed, paused: t.paused });
    switch (cmd.type) {
      case 'game.setSpeed': {
        const s = Number(cmd.speed);
        if (!Number.isInteger(s) || s < 0 || s >= SPEED_HOURS_PER_SECOND.length) return { ok: false, reason: 'err.game.badSpeed' };
        t.speed = s as Speed;
        emitSpeed();
        return { ok: true };
      }
      case 'game.pause':
      case 'game.resume':
      case 'game.togglePause':
        t.paused = cmd.type === 'game.pause' ? true : cmd.type === 'game.resume' ? false : !t.paused;
        emitSpeed();
        return { ok: true };
      case 'game.setAutomation': {
        if (typeof cmd.key !== 'string' || typeof cmd.value !== 'boolean') return { ok: false, reason: 'err.command.badArgs' };
        ctx.state.meta.automation[cmd.key] = cmd.value;
        return { ok: true };
      }
    }
    return { ok: false, reason: 'err.command.unknown', params: { type: cmd.type } };
  }

  function dispatch(input: Command | KnownCommand): CommandResult {
    const cmd = input as Command;
    let result: CommandResult;
    if (!cmd || typeof cmd.type !== 'string') result = { ok: false, reason: 'err.command.badArgs' };
    else if (!world.countryById.has(cmd.country)) result = { ok: false, reason: 'err.command.unknownCountry', params: { country: String(cmd.country) } };
    else if (prefixOf(cmd.type) === 'game') {
      result = cmd.country === ctx.state.meta.playerCountryId ? handleCore(cmd) : { ok: false, reason: 'err.command.notPlayer' };
    } else result = registry.route(ctx, cmd);
    bus.emit({ type: 'game.command', command: cmd, result });
    return result;
  }

  function onBoundary(h: number) {
    const b = boundaryAt(h);
    if (!b.day) return;
    bus.emit({ type: 'time.day', hours: h });
    for (const s of registry.systems) s.onDay?.(ctx);
    if (b.week) {
      bus.emit({ type: 'time.week', hours: h });
      for (const s of registry.systems) s.onWeek?.(ctx);
    }
    if (b.month) {
      const g = hoursToDate(h);
      bus.emit({ type: 'time.month', hours: h, year: g.year, month: g.month });
      for (const s of registry.systems) s.onMonth?.(ctx);
    }
    if (b.year) bus.emit({ type: 'time.year', hours: h, year: hoursToDate(h).year });
  }

  function advanceHours(hours: number) {
    if (!(hours > 0)) return;
    const t0 = performance.now();
    const from = ctx.state.time.hours;
    forEachSubstep(from, from + hours, (dt, newHours, landed) => {
      for (const s of registry.systems) s.update?.(ctx, dt);
      ctx.state.time.hours = newHours;
      if (landed !== null) onBoundary(landed);
    });
    const ms = performance.now() - t0;
    perf.lastStepMs = ms;
    const perDay = (ms * 24) / hours;
    perf.msPerDay = perf.msPerDay === 0 ? perDay : perf.msPerDay * 0.9 + perDay * 0.1;
  }

  const game: Game = {
    world,
    ctx,
    bus,
    registry,
    perf,
    get state() {
      return ctx.state;
    },
    step(dtRealSeconds) {
      const t = ctx.state.time;
      if (t.paused || t.speed === 0 || !(dtRealSeconds > 0)) return 0;
      const hours = Math.min(dtRealSeconds, MAX_REAL_DT_SECONDS) * SPEED_HOURS_PER_SECOND[t.speed];
      advanceHours(hours);
      return hours;
    },
    advanceHours,
    dispatch,
    serialize() {
      return {
        format: SAVE_FORMAT,
        version: SAVE_VERSION,
        dataHash: world.dataHash,
        hours: ctx.state.time.hours,
        playerCountryId: ctx.state.meta.playerCountryId,
        state: jsonClone(ctx.state),
      };
    },
    hydrate(save, opts) {
      const s = validateSave(world, save, opts);
      ctx.state = jsonClone(s.state);
      ctx.state.meta.dataHash = world.dataHash;
      worldDyn.invalidate();
      ensureSlices(false);
      for (const sys of registry.systems) sys.onLoad?.(ctx);
      bus.emit({ type: 'game.loaded', hours: ctx.state.time.hours });
    },
  };
  return game;
}
