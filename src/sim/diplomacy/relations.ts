/** Pair store, relation formula, treaties and cached war lookups. All functions read ctx.state on every call. */
import type { CountryId, Ctx, TextKey, WarId, WarSide, WorldStatic } from '../../core/contracts';
import type { Cause, DiplomacyState, Pair, WarState } from './types';

const HOUR_PER_DAY = 24;
export const DAY = HOUR_PER_DAY;
export const YEAR = 365 * HOUR_PER_DAY;

export const st = (ctx: Ctx): DiplomacyState => ctx.state.diplomacy;
export const pairKey = (a: CountryId, b: CountryId): string => (a < b ? `${a}|${b}` : `${b}|${a}`);
export const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x);
export const round1 = (x: number): number => Math.round(x * 10) / 10;

// ------------------------------------------------------------------ static indices (derived from WorldStatic)

interface StaticIdx {
  memberOf: Map<CountryId, number[]>;
  sets: Set<CountryId>[];
  rivalry: Map<string, number>;
  rivals: Map<CountryId, CountryId[]>;
}
const staticCache = new WeakMap<WorldStatic, StaticIdx>();
export function sidx(w: WorldStatic): StaticIdx {
  let s = staticCache.get(w);
  if (s) return s;
  const memberOf = new Map<CountryId, number[]>();
  const sets: Set<CountryId>[] = [];
  w.alliances.alliances.forEach((al, i) => {
    sets.push(new Set(al.members));
    for (const m of al.members) {
      let l = memberOf.get(m);
      if (!l) memberOf.set(m, (l = []));
      l.push(i);
    }
  });
  const rivalry = new Map<string, number>();
  const rivals = new Map<CountryId, CountryId[]>();
  for (const r of w.alliances.rivalries) {
    rivalry.set(pairKey(r.a, r.b), r.level);
    for (const [x, y] of [[r.a, r.b], [r.b, r.a]]) {
      let l = rivals.get(x);
      if (!l) rivals.set(x, (l = []));
      l.push(y);
    }
  }
  s = { memberOf, sets, rivalry, rivals };
  staticCache.set(w, s);
  return s;
}
export const rivalries = (ctx: Ctx): Map<CountryId, CountryId[]> => sidx(ctx.world).rivals;
export const rivalryLevel = (ctx: Ctx, a: CountryId, b: CountryId): number => sidx(ctx.world).rivalry.get(pairKey(a, b)) ?? 0;

/** Shared alliance summary: best defense membership and number of other shared blocs (economic/political). */
export function sharedBlocs(ctx: Ctx, a: CountryId, b: CountryId): { defense: boolean; economic: boolean; other: number } {
  const ix = sidx(ctx.world);
  const la = ix.memberOf.get(a);
  const out = { defense: false, economic: false, other: 0 };
  if (!la) return out;
  for (const i of la) {
    if (!ix.sets[i].has(b)) continue;
    const kind = ctx.world.alliances.alliances[i].kind;
    if (kind === 'defense') out.defense = true;
    else {
      out.other++;
      if (kind === 'economic') out.economic = true;
    }
  }
  return out;
}

// ------------------------------------------------------------------ pairs & flags

export function getPair(ctx: Ctx, a: CountryId, b: CountryId, create = false): Pair | undefined {
  const k = pairKey(a, b);
  const pairs = st(ctx).pairs;
  let p = pairs[k];
  if (!p && create) p = pairs[k] = { rel: 0, cs: [], fl: {}, cd: {} };
  return p;
}
export function flagOn(ctx: Ctx, a: CountryId, b: CountryId, key: string): boolean {
  const v = getPair(ctx, a, b)?.fl[key];
  return v !== undefined && (v === 0 || v > ctx.state.time.hours);
}
export function setFlag(ctx: Ctx, a: CountryId, b: CountryId, key: string, untilHours: number | null): void {
  getPair(ctx, a, b, true)!.fl[key] = untilHours ?? 0;
}
export function clearFlag(ctx: Ctx, a: CountryId, b: CountryId, key: string): void {
  const p = getPair(ctx, a, b);
  if (p) delete p.fl[key];
}
export function onCooldown(ctx: Ctx, a: CountryId, b: CountryId, action: string): boolean {
  return (getPair(ctx, a, b)?.cd[`${action}.${a}`] ?? 0) > ctx.state.time.hours;
}
export function setCooldown(ctx: Ctx, a: CountryId, b: CountryId, action: string, days: number): void {
  getPair(ctx, a, b, true)!.cd[`${action}.${a}`] = ctx.state.time.hours + days * DAY;
}

// ------------------------------------------------------------------ wars (cached indices)

interface WarIdx {
  state: DiplomacyState | null;
  n: number;
  sig: string;
  enemies: Map<CountryId, Set<CountryId>>;
  byCountry: Map<CountryId, WarState[]>;
}
const warIdx: WarIdx = { state: null, n: -1, sig: '', enemies: new Map(), byCountry: new Map() };
export function invalidateWars(): void {
  warIdx.state = null;
}
function wIdx(ctx: Ctx): WarIdx {
  const s = st(ctx);
  // Cheap validity key: same slice object, same war count and same member totals.
  let sig = 0;
  for (const w of s.wars) sig += w.attackers.length * 7 + w.defenders.length * 13 + w.capitulated.length;
  const key = `${s.wars.length}:${sig}:${s.wars.length ? s.wars[s.wars.length - 1].id : ''}`;
  if (warIdx.state === s && warIdx.sig === key) return warIdx;
  warIdx.state = s;
  warIdx.sig = key;
  warIdx.enemies.clear();
  warIdx.byCountry.clear();
  for (const w of s.wars) {
    for (const [side, other] of [[w.attackers, w.defenders], [w.defenders, w.attackers]]) {
      for (const c of side) {
        let e = warIdx.enemies.get(c);
        if (!e) warIdx.enemies.set(c, (e = new Set()));
        for (const o of other) e.add(o);
        let l = warIdx.byCountry.get(c);
        if (!l) warIdx.byCountry.set(c, (l = []));
        l.push(w);
      }
    }
  }
  return warIdx;
}
export const atWar = (ctx: Ctx, a: CountryId, b: CountryId): boolean => wIdx(ctx).enemies.get(a)?.has(b) === true;
export const enemiesOf = (ctx: Ctx, c: CountryId): CountryId[] => [...(wIdx(ctx).enemies.get(c) ?? [])];
export const warsOf = (ctx: Ctx, c: CountryId): WarState[] => wIdx(ctx).byCountry.get(c) ?? [];
export const sideOf = (w: WarState, c: CountryId): WarSide | null => (w.attackers.includes(c) ? 'attackers' : w.defenders.includes(c) ? 'defenders' : null);
export const warById = (ctx: Ctx, id: WarId): WarState | undefined => st(ctx).wars.find((w) => w.id === id);
export const warBetween = (ctx: Ctx, a: CountryId, b: CountryId): WarState | undefined =>
  warsOf(ctx, a).find((w) => sideOf(w, a) !== sideOf(w, b) && sideOf(w, b) !== null);

// ------------------------------------------------------------------ reputation, stigma, sanctions

export const rep = (ctx: Ctx, c: CountryId): number => st(ctx).rep[c] ?? 0;
export function addRep(ctx: Ctx, c: CountryId, d: number): void {
  const s = st(ctx);
  s.rep[c] = clamp((s.rep[c] ?? 0) + d, -100, 100);
}
/** 0..1 stigma of having used nuclear weapons, fading linearly over 6 years. */
export function nukeStigma(ctx: Ctx, c: CountryId): number {
  const h = st(ctx).nukeUse[c];
  return h === undefined ? 0 : clamp(1 - (ctx.state.time.hours - h) / (6 * YEAR), 0, 1);
}
export function sanctionLevel(ctx: Ctx, c: CountryId): number {
  const s = st(ctx);
  const until = s.sanctions[c];
  const sanc = until !== undefined && until > ctx.state.time.hours ? 0.6 : 0;
  return clamp(sanc + 0.4 * nukeStigma(ctx, c) + clamp(-rep(ctx, c) / 200, 0, 0.3), 0, 1);
}

// ------------------------------------------------------------------ relation

export function puppetLink(ctx: Ctx, a: CountryId, b: CountryId): boolean {
  const wd = ctx.state.world.overlord;
  return wd[a] === b || wd[b] === a;
}

export function baseRelation(ctx: Ctx, a: CountryId, b: CountryId): number {
  const bl = sharedBlocs(ctx, a, b);
  let r = (bl.defense ? 30 : 0) + Math.min(2, bl.other) * 7;
  r -= rivalryLevel(ctx, a, b) * 14;
  if (puppetLink(ctx, a, b)) r += 40;
  const ca = ctx.world.countryById.get(a);
  const cb = ctx.world.countryById.get(b);
  if (ca && cb) {
    if (ca.continent === cb.continent) r += 2;
    if (ca.neighbors.includes(b)) r -= 2;
  }
  if (!bl.defense) r += (rep(ctx, a) + rep(ctx, b)) * 0.12 - 25 * (nukeStigma(ctx, a) + nukeStigma(ctx, b));
  return r;
}
export function relation(ctx: Ctx, a: CountryId, b: CountryId): number {
  if (a === b) return 100;
  const p = getPair(ctx, a, b);
  return round1(clamp(baseRelation(ctx, a, b) + (p ? p.rel : 0), -100, 100));
}
export function modRelation(ctx: Ctx, a: CountryId, b: CountryId, delta: number, reasonKey: TextKey): void {
  if (a === b || !Number.isFinite(delta) || delta === 0) return;
  const p = getPair(ctx, a, b, true)!;
  p.rel = clamp(p.rel + delta, -100, 100);
  if (Math.abs(delta) >= 0.5) {
    const c: Cause = { h: ctx.state.time.hours, key: reasonKey, v: round1(delta) };
    p.cs.push(c);
    if (p.cs.length > 6) p.cs.shift();
  }
}

// ------------------------------------------------------------------ treaties as seen by other modules

export function allied(ctx: Ctx, a: CountryId, b: CountryId): boolean {
  if (a === b) return true;
  if (atWar(ctx, a, b)) return false;
  if (puppetLink(ctx, a, b)) return true;
  if (sharedBlocs(ctx, a, b).defense) return true;
  return flagOn(ctx, a, b, 'alliance');
}
export function access(ctx: Ctx, a: CountryId, b: CountryId): boolean {
  if (a === b || atWar(ctx, a, b)) return true;
  return allied(ctx, a, b) || flagOn(ctx, a, b, `acc.${a}`);
}
export function tradeDeal(ctx: Ctx, a: CountryId, b: CountryId): boolean {
  if (a === b) return true;
  return flagOn(ctx, a, b, 'trade') || sharedBlocs(ctx, a, b).economic || allied(ctx, a, b);
}
export function embargo(ctx: Ctx, a: CountryId, b: CountryId): boolean {
  return flagOn(ctx, a, b, `emb.${a}`);
}
export function tradeFactor(ctx: Ctx, a: CountryId, b: CountryId): number {
  if (a === b) return 1;
  if (atWar(ctx, a, b) || embargo(ctx, a, b) || embargo(ctx, b, a)) return 0;
  const sanc = 1 - 0.7 * Math.max(sanctionLevel(ctx, a), sanctionLevel(ctx, b));
  const base = tradeDeal(ctx, a, b) ? 1.25 : 0.85;
  return round1(base * sanc * 100) / 100;
}

// ------------------------------------------------------------------ optional collaborators

const absentApis = new WeakMap<object, Set<string>>();
/** Optional collaborator API (null when its system is not registered; the probe is cached because a miss throws). */
export function optApi<K extends 'economy' | 'military' | 'research'>(ctx: Ctx, k: K): Ctx['api'][K] | null {
  let s = absentApis.get(ctx);
  if (!s) absentApis.set(ctx, (s = new Set()));
  if (s.has(k)) return null;
  try {
    return ctx.api[k];
  } catch {
    s.add(k);
    return null;
  }
}
export function tryApi<T>(f: () => T): T | null {
  try {
    return f();
  } catch {
    return null;
  }
}
/** Military power: real MIL api when registered, otherwise a static estimate from real stats. */
export function power(ctx: Ctx, c: CountryId): number {
  const mil = optApi(ctx, 'military')?.power(c) ?? null;
  if (mil !== null && Number.isFinite(mil) && mil > 0) return mil;
  const s = ctx.world.stats[c];
  const m = ctx.world.military[c];
  return Math.sqrt((s?.milExpUsd ?? 0) / 1e9) * 10 + (s?.armedForces ?? 0) / 50000 + (m?.nukes ?? 0) * 0.05 + 0.5;
}
export function treasury(ctx: Ctx, c: CountryId): number | null {
  return optApi(ctx, 'economy')?.treasury(c) ?? null;
}
export function monthlyGdp(ctx: Ctx, c: CountryId): number {
  return (ctx.world.stats[c]?.gdpUsd ?? 0) / 1e6 / 12;
}
export function nukes(ctx: Ctx, c: CountryId): number {
  return ctx.world.military[c]?.nukes ?? 0;
}
const conflictActors = new WeakMap<WorldStatic, Set<CountryId>>();
/** Sovereign countries plus the non-sovereign parties of real conflicts (e.g. PSX). */
export function isActor(ctx: Ctx, c: CountryId): boolean {
  const info = ctx.world.countryById.get(c);
  if (!info) return false;
  if (info.sovereign) return true;
  let set = conflictActors.get(ctx.world);
  if (!set) {
    set = new Set(ctx.world.alliances.conflicts.flatMap((x) => [x.a, x.b]));
    conflictActors.set(ctx.world, set);
  }
  return set.has(c);
}
export const isLive = (ctx: Ctx, c: CountryId): boolean => isActor(ctx, c) && ctx.api.worldDyn.isAlive(c);
