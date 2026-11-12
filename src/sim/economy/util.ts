/** Shared runtime helpers and the non-serialized cache (rebuilt lazily whenever the state object changes). */
import type { CountryId, Ctx, ProvinceId, StructureId } from '../../core/contracts';
import { FUELS } from '../../core/contracts';
import { hashSeed } from '../../core/rng';
import { CF } from './balance';
import type { CountryEco, EconomyState, StructRec } from './types';

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
/** Deterministic 0..1 from text. */
export const hash01 = (s: string): number => (hashSeed(s) >>> 0) / 4294967296;
export const eco = (ctx: Ctx): EconomyState => ctx.state.economy;
export const ce = (ctx: Ctx, c: CountryId): CountryEco | undefined => ctx.state.economy.c[c];

export interface Agg {
  /** Annual GDP added by finished production structures. */
  gdpAdd: number;
  milFactories: number;
  hospitals: number;
  universities: number;
  ports: number;
  airports: number;
  bases: number;
  roads: number;
  /** Production per day added, RES_LIST order. */
  prodAdd: number[];
  /** Maintenance M USD / month. */
  maint: number;
  /** Count of all finished structures. */
  n: number;
}

export interface Cache {
  stateRef: unknown;
  plants: Map<CountryId, number[]>;
  cities: Map<CountryId, number[]>;
  /** Territory weight of provinces controlled (sum), per country. */
  weight: Map<CountryId, number>;
  built: Map<CountryId, StructRec[]>;
  building: Map<CountryId, StructRec[]>;
  agg: Map<CountryId, Agg>;
  provCount: Map<string, number>;
  unrestCity: Map<number, number>;
  unrestProv: Map<ProvinceId, number>;
  unrestCountry: Map<CountryId, number>;
  provWeight: Map<ProvinceId, number>;
  prio: Float32Array;
  orphanPlants: Map<CountryId, number[]>;
  orphanCities: Map<CountryId, number[]>;
  cityCountry: Map<number, CountryId>;
  subscribed: boolean;
  /** Resolved system APIs (null = not registered). */
  apis: Record<string, unknown>;
  /** Static generation per fuel (MW × capacity factor, undamaged) of the plants a country controls. */
  gen: Map<CountryId, Float64Array>;
  plantFuel: Uint8Array;
  plantGen: Float32Array;
  cityForeign: Uint8Array;
  cityHosp: Float32Array;
  cityUni: Float32Array;
  cityPop: Float64Array;
}

const caches = new WeakMap<Ctx, Cache>();

function fresh(ctx: Ctx): Cache {
  const w = ctx.world;
  const prio = new Float32Array(w.cities.length);
  for (let i = 0; i < prio.length; i++) {
    const city = w.cities[i];
    // Capitals and large cities are the last to be cut off.
    prio[i] = city.capital === 2 ? 0.01 : clamp(hash01(`b${i}`) * 0.9 + 0.05 - Math.min(0.3, city.pop / 5e7), 0.02, 0.99);
  }
  const provWeight = new Map<ProvinceId, number>();
  for (const p of w.provinces) {
    let pop = 0;
    for (const ci of w.citiesByProvince.get(p.id) ?? []) pop += w.cities[ci].pop;
    provWeight.set(p.id, 1 + pop / 1e5);
  }
  const orphanPlants = new Map<CountryId, number[]>();
  for (const p of w.plants) if (p.provinceId === null && p.countryId) (orphanPlants.get(p.countryId) ?? orphanPlants.set(p.countryId, []).get(p.countryId)!).push(p.index);
  const orphanCities = new Map<CountryId, number[]>();
  for (const p of w.cities) if (p.provinceId === null && p.countryId) (orphanCities.get(p.countryId) ?? orphanCities.set(p.countryId, []).get(p.countryId)!).push(p.index);
  return {
    stateRef: null, plants: new Map(), cities: new Map(), weight: new Map(), built: new Map(), building: new Map(), agg: new Map(),
    provCount: new Map(), unrestCity: new Map(), unrestProv: new Map(), unrestCountry: new Map(), provWeight, prio,
    orphanPlants, orphanCities, cityCountry: new Map(), subscribed: false, apis: {}, gen: new Map(),
    plantFuel: Uint8Array.from(w.plants, (p) => FUELS.indexOf(p.fuel)), plantGen: Float32Array.from(w.plants, (p) => p.mw * CF[p.fuel]),
    cityForeign: new Uint8Array(w.cities.length), cityHosp: new Float32Array(w.cities.length), cityUni: new Float32Array(w.cities.length), cityPop: Float64Array.from(w.cities, (x) => x.pop),
  };
}

/** Cache for this ctx; structural indices are rebuilt when the state object was replaced (load). */
export function cache(ctx: Ctx): Cache {
  let c = caches.get(ctx);
  if (!c) caches.set(ctx, (c = fresh(ctx)));
  if (c.stateRef !== ctx.state) {
    c.stateRef = ctx.state;
    c.plants.clear(); c.cities.clear(); c.weight.clear(); c.agg.clear(); c.gen.clear();
    rebuildStructures(ctx, c);
  }
  return c;
}

export function invalidateTerritory(ctx: Ctx, ...cs: CountryId[]): void {
  const c = cache(ctx);
  for (const k of cs) { c.plants.delete(k); c.cities.delete(k); c.weight.delete(k); c.gen.delete(k); }
}

export function rebuildStructures(ctx: Ctx, c: Cache = cache(ctx)): void {
  c.built.clear(); c.building.clear(); c.agg.clear(); c.provCount.clear(); c.cityHosp.fill(0); c.cityUni.fill(0);
  const list = Object.values(ctx.state.economy?.structures ?? {});
  list.sort(byId);
  for (const s of list) {
    const m = s.progress >= 1 ? c.built : c.building;
    (m.get(s.country) ?? m.set(s.country, []).get(s.country)!).push(s);
    if (s.progress >= 1) {
      const k = `${s.province}|${s.kind}`;
      c.provCount.set(k, (c.provCount.get(k) ?? 0) + 1);
      if (s.kind === 'hospital' || s.kind === 'university') {
        const arr = s.kind === 'hospital' ? c.cityHosp : c.cityUni;
        for (const ci of ctx.world.citiesByProvince.get(s.province) ?? []) arr[ci] += 1 - s.damage;
      }
    }
  }
}

export function plantsOf(ctx: Ctx, c: CountryId): number[] {
  const ch = cache(ctx);
  let l = ch.plants.get(c);
  if (!l) {
    l = [];
    for (const p of ctx.api.worldDyn.provincesControlledBy(c)) for (const i of ctx.world.plantsByProvince.get(p) ?? []) l.push(i);
    for (const i of ch.orphanPlants.get(c) ?? []) l.push(i);
    ch.plants.set(c, l);
  }
  return l;
}

export function citiesOf(ctx: Ctx, c: CountryId): number[] {
  const ch = cache(ctx);
  let l = ch.cities.get(c);
  if (!l) {
    l = [];
    for (const p of ctx.api.worldDyn.provincesControlledBy(c)) { const foreign = ctx.api.worldDyn.ownerOf(p) !== c ? 1 : 0; for (const i of ctx.world.citiesByProvince.get(p) ?? []) { l.push(i); ch.cityForeign[i] = foreign; } }
    for (const i of ch.orphanCities.get(c) ?? []) { l.push(i); ch.cityForeign[i] = 0; }
    ch.cities.set(c, l);
  }
  return l;
}

/** Territory weight under control of `c` (provinces weighted by city population). */
export function weightOf(ctx: Ctx, c: CountryId): number {
  const ch = cache(ctx);
  let w = ch.weight.get(c);
  if (w === undefined) {
    w = 0;
    for (const p of ctx.api.worldDyn.provincesControlledBy(c)) w += ch.provWeight.get(p) ?? 1;
    ch.weight.set(c, w);
  }
  return w;
}

export function ownedWeight(ctx: Ctx, c: CountryId): number {
  const ch = cache(ctx);
  let w = 0;
  for (const p of ctx.api.worldDyn.provincesOwnedBy(c)) w += ch.provWeight.get(p) ?? 1;
  return w;
}

/** Resolves a sibling system API once (null when that system is not registered). */
export function sys<K extends 'research' | 'diplomacy' | 'military'>(ctx: Ctx, id: K): Ctx['api'][K] | null {
  const a = cache(ctx).apis;
  if (!(id in a)) {
    try { a[id] = ctx.api[id]; } catch { a[id] = null; }
  }
  return a[id] as Ctx['api'][K] | null;
}

export function tryMod(ctx: Ctx, c: CountryId, key: string): number {
  const r = sys(ctx, 'research');
  if (!r) return 1;
  const v = r.mod(c, key);
  return Number.isFinite(v) && v > 0 ? v : 1;
}

export function tryUnlocked(ctx: Ctx, c: CountryId, id: string, fallback: boolean): boolean {
  const r = sys(ctx, 'research') as unknown as { unlocked?: (c: CountryId, id: string) => boolean } | null;
  return r?.unlocked ? r.unlocked(c, id) : fallback;
}

/** True when the country's economic decision `key` is run by the system (AI countries always, player on request). */
export function isAuto(ctx: Ctx, c: CountryId, key: string): boolean {
  const m = ctx.state.meta;
  return c !== m.playerCountryId || m.automation[key] === true || m.automation['ai.controlsPlayer'] === true;
}

export function isSandboxPlayer(ctx: Ctx, c: CountryId): boolean {
  return ctx.state.meta.difficulty === 'sandbox' && c === ctx.state.meta.playerCountryId;
}

export function isPlayer(ctx: Ctx, c: CountryId): boolean {
  return c === ctx.state.meta.playerCountryId;
}

export function warEnemies(ctx: Ctx, c: CountryId): CountryId[] {
  return sys(ctx, 'diplomacy')?.enemies(c) ?? [];
}

export const byId = (a: StructRec, b: StructRec): number => +a.id.slice(1) - +b.id.slice(1);

export function structId(n: number): StructureId {
  return `S${n}`;
}

/** Moves a just-finished structure from the building list to the built list and updates the derived indices. */
export function completeStructure(ctx: Ctx, s: StructRec): void {
  const c = cache(ctx);
  const b = c.building.get(s.country);
  if (b) { const i = b.indexOf(s); if (i >= 0) b.splice(i, 1); }
  const bl = c.built.get(s.country) ?? c.built.set(s.country, []).get(s.country)!;
  bl.push(s);
  bl.sort(byId);
  const k = `${s.province}|${s.kind}`;
  c.provCount.set(k, (c.provCount.get(k) ?? 0) + 1);
  if (s.kind === 'hospital' || s.kind === 'university') {
    const arr = s.kind === 'hospital' ? c.cityHosp : c.cityUni;
    for (const ci of ctx.world.citiesByProvince.get(s.province) ?? []) arr[ci] += 1 - s.damage;
  }
  c.agg.delete(s.country);
  if (s.kind === 'powerPlant') c.gen.delete(s.country);
}
