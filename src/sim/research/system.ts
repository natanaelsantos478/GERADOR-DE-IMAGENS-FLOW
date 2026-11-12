import type { Command, CommandResult, Ctx, CountryId, ResearchProgress, TechId, WorldStatic } from '../../core/contracts';
import { defineSystem } from '../../core/registry';
import { BASELINE_UNLOCKS } from './catalog';
import { MAX_TIER, TECHS, TECH_BY_ID } from './techs';
import type { CountryResearch, ResearchState, TechView, TempModifier } from './types';

const EMPTY: readonly TechId[] = [];
const BASE_SET = new Set(BASELINE_UNLOCKS);

interface Cache {
  slice: ResearchState | null;
  tech: Map<CountryId, { n: number; mods: Record<string, number>; unlocks: Set<string>; set: Set<TechId> }>;
  rate: Map<CountryId, number>;
  holders: Map<TechId, number>;
  rateDay: number;
}
const cache: Cache = { slice: null, tech: new Map(), rate: new Map(), holders: new Map(), rateDay: -99 };

const ok = (): CommandResult => ({ ok: true });
const fail = (reason: string, params?: Record<string, string | number>): CommandResult => ({ ok: false, reason, ...(params ? { params } : {}) });
const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);

function slice(ctx: Ctx): ResearchState {
  return ctx.state.research;
}
function sync(ctx: Ctx): ResearchState {
  const s = slice(ctx);
  if (cache.slice !== s) {
    cache.slice = s;
    cache.tech.clear();
    cache.rate.clear();
    cache.holders.clear();
    cache.rateDay = -99;
    for (const r of Object.values(s.c)) for (const t of r.done) cache.holders.set(t, (cache.holders.get(t) ?? 0) + 1);
  }
  return s;
}
function techInfo(ctx: Ctx, c: CountryId) {
  const s = sync(ctx);
  const r = s.c[c];
  let e = cache.tech.get(c);
  if (!r) return { n: 0, mods: {} as Record<string, number>, unlocks: BASE_SET, set: new Set<TechId>() };
  if (!e || e.n !== r.done.length) {
    const mods: Record<string, number> = {};
    const unlocks = new Set(BASE_SET);
    for (const id of r.done) {
      const t = TECH_BY_ID.get(id);
      if (!t) continue;
      for (const [k, v] of Object.entries(t.mods)) mods[k] = (mods[k] ?? 1) * v;
      for (const u of t.unlocks) unlocks.add(u);
    }
    e = { n: r.done.length, mods, unlocks, set: new Set(r.done) };
    cache.tech.set(c, e);
  }
  return e;
}

const noEconomy = new WeakSet<object>();
/** Economy API when registered (the probe is cached: a miss throws). */
function economyApi(ctx: Ctx) {
  if (noEconomy.has(ctx)) return null;
  try {
    return ctx.api.economy;
  } catch {
    noEconomy.add(ctx);
    return null;
  }
}

const isSovereign = (w: WorldStatic, c: CountryId) => w.countryById.get(c)?.sovereign === true;

export function costOf(ctx: Ctx, tech: TechId): number {
  sync(ctx);
  const t = TECH_BY_ID.get(tech);
  if (!t) return Infinity;
  const diffusion = Math.min(1, (cache.holders.get(tech) ?? 0) / 20);
  return Math.round(t.cost * (1 - 0.4 * diffusion));
}

function universities(ctx: Ctx, c: CountryId): number {
  return economyApi(ctx)?.structures({ country: c, kind: 'university', includeUnfinished: false }).length ?? 0;
}

function pointsPerDay(ctx: Ctx, c: CountryId): number {
  const day = Math.floor(ctx.state.time.hours / 24);
  if (cache.rateDay !== day && day % 7 === 0) {
    cache.rate.clear();
    cache.rateDay = day;
  }
  let r = cache.rate.get(c);
  if (r === undefined) {
    const gdpBn = Math.max(0.1, (ctx.world.stats[c]?.gdpUsd ?? 0) / 1e9);
    const budget = (economyApi(ctx) as unknown as { researchBudget?: (c: CountryId) => number } | null)?.researchBudget?.(c) ?? 1;
    const uni = 1 + 0.08 * Math.min(universities(ctx, c), 20);
    r = (1 + 0.09 * Math.sqrt(gdpBn)) * uni * clamp(Number.isFinite(budget) ? budget : 1, 0.2, 3) * modOf(ctx, c, 'eco.research');
    cache.rate.set(c, r);
  }
  return r;
}

function available(ctx: Ctx, c: CountryId): TechId[] {
  const e = techInfo(ctx, c);
  return TECHS.filter((t) => !e.set.has(t.id) && t.requires.every((q) => e.set.has(q))).map((t) => t.id);
}

function grant(ctx: Ctx, c: CountryId, tech: TechId, emit = true) {
  const s = sync(ctx);
  const r = s.c[c];
  if (!r || r.done.includes(tech)) return;
  r.done.push(tech);
  delete r.partial[tech];
  cache.holders.set(tech, (cache.holders.get(tech) ?? 0) + 1);
  if (emit) {
    ctx.bus.emit({ type: 'res.techDone', country: c, tech });
    if (c === ctx.state.meta.playerCountryId) ctx.news('research', 'res.news.done', { tech }, { country: c }, { countries: [c], importance: 1 });
  }
}

function pickNext(ctx: Ctx, c: CountryId): TechId | null {
  const list = available(ctx, c);
  if (!list.length) return null;
  const r = sync(ctx).c[c];
  const bl = branchLevels(ctx.world, c);
  let best: TechId | null = null;
  let bestScore = -Infinity;
  for (const id of list) {
    const t = TECH_BY_ID.get(id)!;
    // Special weapons are not picked by automation; they are a deliberate player/AI-war choice.
    if (id === 'm_warhead' && (ctx.world.military[c]?.nukes ?? 0) <= 0) continue;
    if (id === 'm_mirv' && (ctx.world.military[c]?.nukes ?? 0) < 50) continue;
    const score = bl[t.branch] * 6 - t.tier * 0.8 + (r.partial[id] ? 3 : 0) + (t.unlocks.length ? 1 : 0) + ctx.rng.next() * 1.5;
    if (score > bestScore) {
      bestScore = score;
      best = id;
    }
  }
  return best;
}

// ------------------------------------------------------------------ initial tech by real level

type Levels = Record<'army' | 'air' | 'navy' | 'strategic' | 'economy' | 'society', number>;

export function branchLevels(world: WorldStatic, c: CountryId): Levels {
  const st = world.stats[c];
  const mi = world.military[c];
  const pop = Math.max(1, st?.pop ?? 1);
  const gdpPc = Math.max(300, (st?.gdpUsd ?? 0) / pop);
  const dev = clamp((Math.log10(gdpPc) - Math.log10(300)) / (Math.log10(70000) - Math.log10(300)), 0, 1);
  const mil = clamp((Math.log10(Math.max(1, st?.milExpUsd ?? 0)) - 6) / (11.9 - 6), 0, 1);
  const air = clamp(Math.log10(1 + (mi?.fighters ?? 0) + (mi?.bombers ?? 0)) / Math.log10(2000), 0, 1);
  const navyScore = (mi?.destroyers ?? 0) + 0.5 * (mi?.frigates ?? 0) + (mi?.subs ?? 0) + 3 * (mi?.carriers ?? 0);
  const navy = clamp(Math.log10(1 + navyScore) / Math.log10(120), 0, 1);
  const nuke = (mi?.nukes ?? 0) > 0;
  return {
    economy: dev,
    society: dev * 0.9,
    army: 0.55 * mil + 0.45 * dev,
    air: navyScore + (mi?.fighters ?? 0) + (mi?.bombers ?? 0) === 0 ? 0.3 * dev : 0.5 * mil + 0.5 * air,
    navy: navyScore === 0 ? 0 : 0.4 * mil + 0.6 * navy,
    strategic: 0.3 * mil + 0.3 * dev + (nuke ? 0.4 : 0),
  };
}

const INVENTORY_TECH: [keyof NonNullable<WorldStatic['military'][string]>, TechId][] = [
  ['tanks', 'a_armor'], ['ifv', 'a_mech'], ['artillery', 'a_artillery'], ['mlrs', 'a_mlrs'], ['sam', 'f_sam'],
  ['fighters', 'f_jet'], ['bombers', 'f_bomber'], ['attackHelis', 'f_attack_heli'], ['transports', 'f_airlift'],
  ['drones', 'f_drone'], ['destroyers', 'n_destroyer'], ['frigates', 'n_frigate'], ['subs', 'n_submarine'],
  ['carriers', 'n_carrier'], ['nukes', 'm_warhead'],
];

/** Highest tier a branch level reaches at game start (convex: only the top countries reach tiers 5-6). */
const maxTier = (level: number): number => Math.min(MAX_TIER - 1, Math.floor(Math.pow(level, 2) * (MAX_TIER + 0.3)));

export function initialTechs(world: WorldStatic, c: CountryId): TechId[] {
  const done = new Set<TechId>();
  const addWithPrereqs = (id: TechId) => {
    if (done.has(id)) return;
    const t = TECH_BY_ID.get(id);
    if (!t) return;
    for (const q of t.requires) addWithPrereqs(q);
    done.add(id);
  };
  const mi = world.military[c];
  if (mi) for (const [k, tech] of INVENTORY_TECH) if (Number(mi[k] ?? 0) > 0) addWithPrereqs(tech);
  const lv = branchLevels(world, c);
  for (const t of TECHS) {
    if (t.id === 'm_warhead' || t.id === 'm_mirv') continue; // warheads: only the 9 real nuclear powers (inventory rule above)
    if (t.tier <= maxTier(lv[t.branch])) {
      // Only if every prerequisite is also within reach (never pull deep chains for weak countries).
      if (t.requires.every((q) => done.has(q) || (TECH_BY_ID.get(q)!.tier <= maxTier(lv[TECH_BY_ID.get(q)!.branch]) && q !== 'm_warhead'))) {
        addWithPrereqs(t.id);
      }
    }
  }
  if ((mi?.nukes ?? 0) >= 100) addWithPrereqs('m_mirv');
  return [...done];
}

// ------------------------------------------------------------------ API

function modOf(ctx: Ctx, c: CountryId, key: string): number {
  let v = techInfo(ctx, c).mods[key] ?? 1;
  const temp = slice(ctx).temp[c];
  if (temp) {
    const now = ctx.state.time.hours;
    for (const m of temp) if (m.key === key && (m.until === null || m.until > now)) v *= m.value;
  }
  return v;
}

export const researchSystem = defineSystem({
  id: 'research',
  createSlice(ctx): ResearchState {
    const c: Record<CountryId, CountryResearch> = {};
    for (const country of ctx.world.countries) {
      c[country.id] = { done: isSovereign(ctx.world, country.id) ? initialTechs(ctx.world, country.id) : [], current: null, partial: {}, queue: [] };
    }
    return { c, temp: {} };
  },
  onLoad(ctx) {
    sync(ctx);
  },
  onDay(ctx) {
    const s = sync(ctx);
    const now = ctx.state.time.hours;
    const auto = ctx.state.meta.automation['res.auto'] !== false;
    const player = ctx.state.meta.playerCountryId;
    const wd = ctx.api.worldDyn;
    // Expire temporary modifiers.
    for (const [c, list] of Object.entries(s.temp)) {
      const keep = list.filter((m) => m.until === null || m.until > now);
      if (keep.length === list.length) continue;
      if (keep.length) s.temp[c] = keep;
      else delete s.temp[c];
    }
    for (const country of ctx.world.countries) {
      const c = country.id;
      if (!country.sovereign || !wd.isAlive(c)) continue;
      const r = s.c[c];
      if (!r) continue;
      if (r.current === null) {
        while (r.queue.length) {
          const next = r.queue.shift()!;
          const tt = techInfo(ctx, c);
          const def = TECH_BY_ID.get(next);
          if (def && !tt.set.has(next) && def.requires.every((q) => tt.set.has(q))) {
            r.current = next;
            break;
          }
        }
        if (r.current === null && (c !== player || auto)) r.current = pickNext(ctx, c);
      }
      if (r.current === null) continue;
      const cost = costOf(ctx, r.current);
      const have = (r.partial[r.current] ?? 0) + pointsPerDay(ctx, c);
      if (have >= cost) {
        const done = r.current;
        r.current = null;
        grant(ctx, c, done);
      } else r.partial[r.current] = have;
    }
  },
  handle(ctx, cmd: Command): CommandResult | undefined {
    const s = sync(ctx);
    const r = s.c[cmd.country];
    if (!r) return fail('res.err.noCountry');
    const tech = String(cmd.tech ?? '');
    const def = TECH_BY_ID.get(tech);
    switch (cmd.type) {
      case 'res.queue': {
        if (!def) return fail('res.err.unknownTech');
        const e = techInfo(ctx, cmd.country);
        if (e.set.has(tech)) return fail('res.err.alreadyDone');
        if (r.queue.includes(tech) || r.current === tech) return fail('res.err.alreadyQueued');
        // Prerequisites may be done, current, or queued earlier.
        const pending = new Set([...(r.current ? [r.current] : []), ...r.queue]);
        const missing = def.requires.filter((q) => !e.set.has(q) && !pending.has(q));
        if (missing.length) return fail('res.err.prereq', { missing: missing.join(',') });
        r.queue.push(tech);
        return ok();
      }
      case 'res.unqueue': {
        const i = r.queue.indexOf(tech);
        if (i < 0) return fail('res.err.notQueued');
        // Drop dependents queued after it as well.
        const drop = new Set([tech]);
        for (const q of r.queue.slice(i + 1)) if (TECH_BY_ID.get(q)!.requires.some((x) => drop.has(x))) drop.add(q);
        r.queue = r.queue.filter((q) => !drop.has(q));
        return ok();
      }
      case 'res.start': {
        if (!def) return fail('res.err.unknownTech');
        const e = techInfo(ctx, cmd.country);
        if (e.set.has(tech)) return fail('res.err.alreadyDone');
        if (def.requires.some((q) => !e.set.has(q))) return fail('res.err.prereq');
        if (r.current && r.current !== tech) r.queue.unshift(r.current);
        r.queue = r.queue.filter((q) => q !== tech);
        r.current = tech;
        return ok();
      }
      default:
        return undefined;
    }
  },
  api(ctx) {
    const a: import('../../core/contracts').ResearchApi = {
      has(c, tech) {
        return techInfo(ctx, c).set.has(tech);
      },
      mod: (c, key) => modOf(ctx, c, key),
      addModifier(c, key, value, untilHours, source) {
        if (!Number.isFinite(value) || value <= 0) return;
        const s = slice(ctx);
        const list: TempModifier[] = (s.temp[c] ??= []);
        // Same source+key replaces the previous entry (refreshing a timed effect).
        const i = list.findIndex((m) => m.source === source && m.key === key);
        const m = { key, value, until: untilHours, source };
        if (i >= 0) list[i] = m;
        else list.push(m);
        cache.rate.delete(c);
      },
      progress(c): ResearchProgress {
        const r = slice(ctx).c[c];
        if (!r) return { current: null, progress: 0, pointsPerDay: 0, queue: [], researched: 0 };
        const cur = r.current;
        return {
          current: cur,
          progress: cur ? clamp((r.partial[cur] ?? 0) / costOf(ctx, cur), 0, 1) : 0,
          pointsPerDay: pointsPerDay(ctx, c),
          queue: [...r.queue],
          researched: r.done.length,
        };
      },
      unlocked: (c, id) => techInfo(ctx, c).unlocks.has(id),
      researched: (c) => slice(ctx).c[c]?.done ?? EMPTY,
      available: (c) => available(ctx, c),
      cost: (c, tech) => {
        void c;
        return costOf(ctx, tech);
      },
      tree(c) {
        const r = slice(ctx).c[c];
        const e = techInfo(ctx, c);
        return TECHS.map((t): TechView => {
          const missing = t.requires.filter((q) => !e.set.has(q));
          const status = e.set.has(t.id) ? 'done' : r?.current === t.id ? 'current' : r?.queue.includes(t.id) ? 'queued' : missing.length ? 'locked' : 'available';
          const cost = costOf(ctx, t.id);
          return {
            id: t.id, branch: t.branch, tier: t.tier, requires: t.requires, unlocks: t.unlocks, mods: t.mods, cost, status, missing,
            progress: status === 'done' ? 1 : clamp((r?.partial[t.id] ?? 0) / cost, 0, 1),
          };
        });
      },
    };
    return a;
  },
  metrics(ctx) {
    const s = slice(ctx);
    const player = s.c[ctx.state.meta.playerCountryId];
    let total = 0, n = 0;
    for (const r of Object.values(s.c)) if (r.done.length) { total += r.done.length; n++; }
    return { 'techs/país': n ? +(total / n).toFixed(1) : 0, 'techs jogador': player?.done.length ?? 0 };
  },
});
