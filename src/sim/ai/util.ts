import type { CountryId, Ctx, FormationView, LonLat } from '../../core/contracts';
import { distanceKm } from '../../core/geo';

export const dist = distanceKm;

export function isAiControlled(ctx: Ctx, c: CountryId): boolean {
  const m = ctx.state.meta;
  return c !== m.playerCountryId || m.automation['ai.controlsPlayer'] === true;
}

export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) % 100000;
}

// Per-day cache of formation views (derived, never serialized).
let cache: { state: unknown; day: number; map: Map<CountryId, FormationView[]> } | null = null;
export function viewsOf(ctx: Ctx, c: CountryId): FormationView[] {
  const day = Math.floor(ctx.state.time.hours / 24);
  if (!cache || cache.state !== ctx.state || cache.day !== day) cache = { state: ctx.state, day, map: new Map() };
  let v = cache.map.get(c);
  if (!v) cache.map.set(c, (v = ctx.api.military.formations({ country: c })));
  return v;
}
export function dropViews(): void {
  cache = null;
}

/** Fighting weight of a land/air formation. */
export const weight = (f: FormationView): number => f.strength * f.units.length * (0.5 + 0.5 * f.organization) * (0.6 + 0.4 * f.morale);

export function centroid(fs: FormationView[]): LonLat {
  let x = 0, y = 0, w = 0;
  for (const f of fs) {
    const k = Math.max(0.05, f.strength);
    x += f.pos[0] * k; y += f.pos[1] * k; w += k;
  }
  return w > 0 ? [x / w, y / w] : [0, 0];
}

const compCache = new WeakMap<object, Map<CountryId, number>>();
/** Whether two countries share a land-connected mass (via any chain of land borders): armies cannot walk between different ones. */
export function landConnected(ctx: Ctx, a: CountryId, b: CountryId): boolean {
  let comp = compCache.get(ctx.world);
  if (!comp) {
    comp = new Map();
    let n = 0;
    for (const c of ctx.world.countries) {
      if (comp.has(c.id)) continue;
      const stack = [c.id];
      comp.set(c.id, n);
      while (stack.length) {
        for (const o of ctx.world.countryById.get(stack.pop()!)?.neighbors ?? []) if (!comp.has(o)) (comp.set(o, n), stack.push(o));
      }
      n++;
    }
    compCache.set(ctx.world, comp);
  }
  return comp.get(a) === comp.get(b);
}

const bigCache = new WeakMap<object, Map<CountryId, number[]>>();
/** Top cities (by population) of a country's original territory; capital always included. */
export function bigCities(ctx: Ctx, c: CountryId): number[] {
  let m = bigCache.get(ctx.world);
  if (!m) bigCache.set(ctx.world, (m = new Map()));
  let l = m.get(c);
  if (!l) {
    const all = ctx.world.citiesByCountry.get(c) ?? [];
    l = all.filter((i) => ctx.world.cities[i].pop >= 80_000 || ctx.world.cities[i].capital >= 1).sort((a, b) => ctx.world.cities[b].pop - ctx.world.cities[a].pop).slice(0, 40);
    m.set(c, l);
  }
  return l;
}

const plantCache = new WeakMap<object, Map<CountryId, number[]>>();
/** Largest power plants of a country (strategic bombing / missile targets). */
export function bigPlants(ctx: Ctx, c: CountryId): number[] {
  let m = plantCache.get(ctx.world);
  if (!m) plantCache.set(ctx.world, (m = new Map()));
  let l = m.get(c);
  if (!l) {
    l = [...(ctx.world.plantsByCountry.get(c) ?? [])].sort((a, b) => ctx.world.plants[b].mw - ctx.world.plants[a].mw).slice(0, 12);
    m.set(c, l);
  }
  return l;
}
