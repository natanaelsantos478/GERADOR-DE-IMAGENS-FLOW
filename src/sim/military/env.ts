/** Shared helpers: optional access to sibling APIs, per-world caches (never serialized), small utilities. */
import type {
  CountryId, Ctx, DiplomacyApi, EconomyApi, LonLat, ResearchApi, WorldDynApi, WorldStatic,
} from '../../core/contracts';
import { haversineKm } from '../../core/geo';
import type { Formation, MilitaryState } from './types';

export interface Apis3 {
  dip: DiplomacyApi | null;
  eco: EconomyApi | null;
  res: ResearchApi | null;
  wd: WorldDynApi;
}

/** Sibling systems may be absent (unit tests, partial builds): every use goes through these nullable handles. */
export function apisOf(ctx: Ctx): Apis3 {
  const g = <T>(f: () => T): T | null => {
    try {
      return f();
    } catch {
      return null;
    }
  };
  return { dip: g(() => ctx.api.diplomacy), eco: g(() => ctx.api.economy), res: g(() => ctx.api.research), wd: ctx.api.worldDyn };
}

export interface LegGeo {
  rt: object;
  i: number;
  pts: LonLat[];
  cum: number[];
}

export interface Env {
  comp: Int32Array | null;
  nodeProv: Int32Array;
  provIndex: Map<string, number>;
  seaCache: Map<string, number[]>;
  legs: Map<string, LegGeo>;
  /** Scratch caches rebuilt when the state object changes. */
  stateRef: MilitaryState | null;
  byCountry: Map<CountryId, Formation[]>;
  all: Formation[];
  warring: { until: number; set: Set<CountryId> };
  byCountryVer: number;
  ver: number;
  powerCache: Map<CountryId, { day: number; v: number; ref: object }>;
}

const envs = new WeakMap<WorldStatic, Env>();
export function envOf(world: WorldStatic): Env {
  let e = envs.get(world);
  if (!e) {
    const provIndex = new Map<string, number>();
    world.provinces.forEach((p, i) => provIndex.set(p.id, i));
    e = {
      comp: null, nodeProv: new Int32Array(world.roads.nodeCount).fill(-2), provIndex, seaCache: new Map(), legs: new Map(),
      stateRef: null, byCountry: new Map(), all: [], warring: { until: -1, set: new Set() }, byCountryVer: -1, ver: 0, powerCache: new Map(),
    };
    envs.set(world, e);
  }
  return e;
}

/** Connected components of the road graph (computed once per world). */
export function roadComponents(world: WorldStatic): Int32Array {
  const env = envOf(world);
  if (env.comp) return env.comp;
  const g = world.roads;
  const parent = new Int32Array(g.nodeCount);
  for (let i = 0; i < parent.length; i++) parent[i] = i;
  const find = (x: number) => {
    while (parent[x] !== x) x = parent[x] = parent[parent[x]];
    return x;
  };
  for (let e = 0; e < g.edgeCount; e++) parent[find(g.edgeA[e])] = find(g.edgeB[e]);
  const comp = new Int32Array(g.nodeCount);
  for (let i = 0; i < comp.length; i++) comp[i] = find(i);
  return (env.comp = comp);
}

/** Province index of a road node (-1 outside every province). */
export function nodeProvince(world: WorldStatic, node: number): number {
  const env = envOf(world);
  let v = env.nodeProv[node];
  if (v === -2) {
    const id = world.nearestProvince(world.roads.nodeLon[node], world.roads.nodeLat[node], 25);
    v = id === null ? -1 : (env.provIndex.get(id) ?? -1);
    env.nodeProv[node] = v;
  }
  return v;
}

export const r3 = (v: number) => Math.round(v * 1000) / 1000;
export const r4 = (v: number) => Math.round(v * 10000) / 10000;
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const dist = (a: LonLat, b: LonLat) => haversineKm(a[0], a[1], b[0], b[1]);

/** Hostility between two formations (rebels are hostile only to the government they rose against). */
export function hostile(A: Apis3, a: Formation, b: Formation): boolean {
  if (a.c === b.c) return false;
  if (a.reb || b.reb) return (a.reb ?? '') === b.c || (b.reb ?? '') === a.c;
  return A.dip ? A.dip.atWar(a.c, b.c) : false;
}

/** May country `c` move through territory controlled by `ctl`? */
export function mayEnter(A: Apis3, c: CountryId, ctl: CountryId): boolean {
  return c === ctl || (A.dip ? A.dip.access(c, ctl) : false);
}

/** Research multiplier (1 without research system). */
export const mod = (A: Apis3, c: CountryId, key: string): number => (A.res ? A.res.mod(c, key) : 1);

/** Unit availability: baseline units always, others need `unit.<id>` unlocked (all allowed without research system). */
export const unitUnlocked = (A: Apis3, c: CountryId, t: string): boolean => (A.res ? A.res.unlocked(c, `unit.${t}`) : true);
