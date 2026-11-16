/** Officer corps: deterministic generation, assignment, experience, casualties, loyalty and coup plots. */
import type { CommandResult, CountryId, Ctx, Domain, FormationId, OfficerView } from '../../core/contracts';
import { type Apis3, clamp, r3 } from './env';
import { formationsOf, S, strengthOf } from './forces';
import { RANK_PT } from './i18n.pt';
import { makeName, poolKeyOf } from './names';
import type { CommandState, Formation, Officer, TraitId } from './types';

export const RANK_KEYS = ['brigadier', 'major', 'lieutenant', 'general', 'marshal'];
export const TRAITS: TraitId[] = ['armor', 'urban', 'mountain', 'winter', 'stubborn', 'aggressive', 'logistic', 'air', 'sea'];
const ROSTER_CAP = 30;

function mix(a: number, b: number, c = 0): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35) ^ Math.imul(c + 0x165667b1, 0x27d4eb2f);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return (h ^ (h >>> 15)) >>> 0;
}
const strHash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};
/** Small seeded stream: next() in [0,1). */
function stream(seed: number, key: number): () => number {
  let n = 0;
  return () => mix(seed, key, n++) / 4294967296;
}

export const cmdState = (ctx: Ctx): CommandState => {
  const st = S(ctx);
  return (st.cmd ??= { off: {}, nx: 1, ws: {} });
};

function pickTraits(r: () => number, d: Domain): TraitId[] {
  const pool: TraitId[] = d === 'air' ? ['air', 'air', 'aggressive', 'stubborn', 'logistic'] : d === 'naval' ? ['sea', 'sea', 'aggressive', 'stubborn', 'logistic'] : ['armor', 'urban', 'mountain', 'winter', 'stubborn', 'aggressive', 'logistic'];
  const out: TraitId[] = [pool[Math.floor(r() * pool.length)]];
  if (r() < 0.4) {
    const t = pool[Math.floor(r() * pool.length)];
    if (!out.includes(t) && !(t === 'aggressive' && out[0] === 'stubborn') && !(t === 'stubborn' && out[0] === 'aggressive')) out.push(t);
  }
  return out;
}

export function makeOfficer(ctx: Ctx, c: CountryId, d: Domain, rk: number, serial: number, id: string): Officer {
  const country = ctx.world.countryById.get(c);
  const pool = country ? poolKeyOf(country) : 'en';
  const r = stream(ctx.state.meta?.seed ?? 0, mix(strHash(c), serial, rk));
  const sk = () => clamp(Math.round(2 + 3 * r() + 3 * r() + 0.6 * rk * r() + 0.5 * r() * 2), 1, 10);
  return {
    id, c, n: makeName(pool, Math.floor(r() * 1000), Math.floor(r() * 1000)), d, rk,
    a: sk(), df: sk(), l: sk(), m: sk(), tr: pickTraits(r, d),
    x: r3(0.04 * rk + 0.12 * r()), ly: r3(0.55 + 0.4 * r()), s: 0, u: 0, f: null, b: 0, w: 0, h: [],
  };
}

const rankFor = (i: number, n: number) => (i === 0 && n >= 8 ? 4 : i < n * 0.1 ? 3 : i < n * 0.3 ? 2 : i < n * 0.55 ? 1 : 0);

export function initCommanders(ctx: Ctx): void {
  const cs = cmdState(ctx);
  const per = new Map<CountryId, Record<Domain, number>>();
  for (const f of Object.values(S(ctx).forms)) {
    if (f.reb) continue;
    const m = per.get(f.c) ?? { land: 0, naval: 0, air: 0 };
    m[f.d]++;
    per.set(f.c, m);
  }
  const cids = [...per.keys()].sort();
  for (const c of cids) {
    const m = per.get(c)!;
    for (const d of ['land', 'naval', 'air'] as Domain[]) {
      const n = Math.min(ROSTER_CAP, m[d]);
      for (let i = 0; i < n; i++) addOfficer(ctx, c, d, rankFor(i, n));
    }
    cs.ws[c] ??= 65;
  }
  for (const c of cids) autoAssign(ctx, c);
}

function addOfficer(ctx: Ctx, c: CountryId, d: Domain, rk: number): Officer {
  const cs = cmdState(ctx);
  const serial = cs.nx++;
  const o = makeOfficer(ctx, c, d, rk, serial, `O${serial}`);
  cs.off[o.id] = o;
  return o;
}

export const officerOf = (ctx: Ctx, f: Formation): Officer | null => {
  const o = f.cm ? S(ctx).cmd?.off[f.cm] : undefined;
  return o && o.s === 0 && o.f === f.id ? o : null;
};

const note = (ctx: Ctx, o: Officer, code: string, arg?: string) => {
  o.h.push(arg ? [Math.round(ctx.state.time.hours), code, arg] : [Math.round(ctx.state.time.hours), code]);
  if (o.h.length > 8) o.h.shift();
};

function detach(ctx: Ctx, o: Officer): void {
  if (!o.f) return;
  const f = S(ctx).forms[o.f];
  if (f && f.cm === o.id) delete f.cm;
  o.f = null;
}

function attach(ctx: Ctx, o: Officer, f: Formation): void {
  detach(ctx, o);
  if (f.cm) {
    const prev = S(ctx).cmd?.off[f.cm];
    if (prev && prev.f === f.id) prev.f = null;
  }
  f.cm = o.id;
  o.f = f.id;
}

/** Fills every empty or invalid post of country `c` with the best free officer (bigger formations first). */
export function autoAssign(ctx: Ctx, c: CountryId, pool?: Officer[]): void {
  const cs = cmdState(ctx);
  const need: Formation[] = [];
  for (const f of formationsOf(ctx, c)) if (!f.reb && !f.cr && !officerOf(ctx, f)) need.push(f);
  if (!need.length) return;
  const free: Record<Domain, Officer[]> = { land: [], naval: [], air: [] };
  if (pool) {
    for (const o of pool) if (o.s === 0 && !o.f) free[o.d].push(o);
  } else {
    for (const id in cs.off) {
      const o = cs.off[id];
      if (o.c === c && o.s === 0 && !o.f) free[o.d].push(o);
    }
  }
  if (!free.land.length && !free.naval.length && !free.air.length) return;
  const score = (o: Officer) => o.rk * 4 + o.a + o.df + o.l + o.m + 4 * o.x;
  for (const d of ['land', 'naval', 'air'] as Domain[]) free[d].sort((a, b) => score(b) - score(a) || (a.id < b.id ? -1 : 1));
  need.sort((a, b) => b.u.length * strengthOf(b) - a.u.length * strengthOf(a) || (a.id < b.id ? -1 : 1));
  for (const f of need) {
    const o = free[f.d].shift();
    if (!o) continue;
    if (f.cm) delete f.cm;
    attach(ctx, o, f);
  }
}

export function assignCommander(ctx: Ctx, country: CountryId, formation: FormationId, officer: string | null): CommandResult {
  const f = S(ctx).forms[formation];
  if (!f || f.c !== country) return { ok: false, reason: 'err.mil.notYours' };
  if (officer === null) {
    const cur = f.cm ? cmdState(ctx).off[f.cm] : null;
    if (cur) detach(ctx, cur);
    delete f.cm;
    return { ok: true };
  }
  const o = cmdState(ctx).off[officer];
  if (!o || o.c !== country) return { ok: false, reason: 'err.mil.noSuchOfficer' };
  if (o.s !== 0) return { ok: false, reason: 'err.mil.officerUnavailable' };
  if (o.d !== f.d) return { ok: false, reason: 'err.mil.wrongDomain' };
  const old = o.f ? S(ctx).forms[o.f] : null;
  const displaced = f.cm ? cmdState(ctx).off[f.cm] : null;
  attach(ctx, o, f);
  // Swap: the displaced commander takes the post the new one left.
  if (old && old !== f && displaced && displaced.s === 0 && displaced.d === old.d) attach(ctx, displaced, old);
  return { ok: true };
}

// ------------------------------------------------------------------ effective skills and traits

export interface Skill { a: number; d: number; l: number; m: number }
export const skillOf = (o: Officer): Skill => ({ a: o.a + 2.5 * o.x, d: o.df + 2.5 * o.x, l: o.l + 2.5 * o.x, m: o.m + 2.5 * o.x });
const has = (o: Officer, t: TraitId) => o.tr.includes(t);

export interface Terrain { rugged: number; urban: boolean; cold: boolean; naval: boolean }

/** Attack / defense multipliers of an officer in given conditions (1 = average commander). */
export function commanderMul(o: Officer | null, f: Formation, e: Terrain): { atk: number; def: number } {
  if (!o) return { atk: 0.93, def: 0.95 };
  const s = skillOf(o);
  let atk = 1 + 0.03 * (s.a - 5), def = 1 + 0.03 * (s.d - 5);
  if (has(o, 'armor')) {
    let ar = 0, n = 0;
    for (const sl of f.u) { n += sl.k; if (sl.t === 'armor' || sl.t === 'mech_infantry') ar += sl.k; }
    if (n > 0 && ar / n > 0.3) (atk += 0.12), (def += 0.06);
  }
  if (has(o, 'urban') && e.urban) (atk += 0.1), (def += 0.12);
  if (has(o, 'mountain') && e.rugged > 0.5) (atk += 0.1), (def += 0.1);
  if (has(o, 'winter') && e.cold) (atk += 0.1), (def += 0.1);
  if (has(o, 'air') && f.d === 'air') (atk += 0.12), (def += 0.08);
  if (has(o, 'sea') && f.d === 'naval') (atk += 0.12), (def += 0.08);
  if (has(o, 'stubborn')) def += 0.1;
  if (has(o, 'aggressive')) (atk += 0.08), (def -= 0.05);
  return { atk, def };
}

/** Movement multiplier and morale-loss multiplier (<1 = resilient). */
export function commanderMove(o: Officer | null): number {
  return o ? 1 + 0.012 * (skillOf(o).m - 5) : 0.97;
}
export function commanderResolve(o: Officer | null): number {
  if (!o) return 1.05;
  return clamp(1 - 0.015 * (skillOf(o).d - 5) - (has(o, 'stubborn') ? 0.2 : 0), 0.6, 1.3);
}
export function commanderSupply(o: Officer | null): number {
  return o ? 0.02 * (skillOf(o).l - 5) + (has(o, 'logistic') ? 0.05 : 0) : 0;
}
/** Fatigue accumulation multiplier from the commander (logistics, traits). */
export function commanderFatigue(o: Officer | null, coldStress: number): number {
  if (!o) return 1.05;
  return clamp(1 - 0.02 * (skillOf(o).l - 5) - (has(o, 'logistic') ? 0.08 : 0) - (has(o, 'winter') ? 0.6 * coldStress : 0), 0.5, 1.2);
}

// ------------------------------------------------------------------ views

const STATUS = ['active', 'wounded', 'captured', 'dead'] as const;
const viewCaches = new WeakMap<CommandState, { h: number; m: Map<string, OfficerView> }>();
/** Views are cached per game hour and per game (officer fields change on battles / daily ticks). */
export function officerView(ctx: Ctx, o: Officer): OfficerView {
  const cs = cmdState(ctx);
  const h = Math.floor(ctx.state.time.hours);
  let c = viewCaches.get(cs);
  if (!c || c.h !== h) viewCaches.set(cs, (c = { h, m: new Map() }));
  const key = `${o.id}|${o.f ?? ''}|${o.s}`;
  let v = c.m.get(key);
  if (!v) c.m.set(key, (v = buildView(ctx, o)));
  return v;
}

function buildView(ctx: Ctx, o: Officer): OfficerView {
  const s = skillOf(o);
  const fm = o.f ? S(ctx).forms[o.f] : null;
  const neutral = commanderMul(o, fm ?? ({ u: [], d: o.d } as unknown as Formation), { rugged: 0.3, urban: false, cold: false, naval: o.d === 'naval' });
  const R = (v: number) => Math.round(v * 10) / 10;
  return {
    id: o.id, country: o.c, name: o.n, domain: o.d, rank: o.rk, rankKey: `${RANK_KEYS[o.rk]}.${o.d}`,
    attack: R(s.a), defense: R(s.d), logistics: R(s.l), maneuver: R(s.m), traits: o.tr.slice(), experience: o.x, loyalty: o.ly,
    status: STATUS[o.s], formation: o.f, battles: o.b, wins: o.w,
    history: o.h.map((h) => ({ hours: h[0], code: h[1], ...(h[2] ? { arg: h[2] } : {}) })),
    mods: { attack: r3(neutral.atk), defense: r3(neutral.def), speed: r3(commanderMove(o)), morale: r3(commanderResolve(o)) },
  };
}

export function officersOf(ctx: Ctx, c: CountryId): OfficerView[] {
  const out: Officer[] = [];
  const off = S(ctx).cmd?.off ?? {};
  for (const id in off) if (off[id].c === c) out.push(off[id]);
  out.sort((a, b) => b.rk - a.rk || b.a + b.df + b.l + b.m - (a.a + a.df + a.l + a.m) || (a.id < b.id ? -1 : 1));
  return out.map((o) => officerView(ctx, o));
}

// ------------------------------------------------------------------ battles: experience and fate

export function battleExperience(ctx: Ctx, f: Formation, won: boolean | null): void {
  const o = officerOf(ctx, f);
  if (!o) return;
  o.b++;
  if (won) o.w++;
  o.x = r3(Math.min(1, o.x + (won ? 0.03 : won === false ? 0.012 : 0.015) * (1 - 0.5 * o.x)));
  o.ly = r3(clamp(o.ly + (won ? 0.02 : won === false ? -0.03 : 0), 0, 1));
  if (won && o.w % 4 === 0 && o.rk < 3 && o.x > 0.2 * (o.rk + 1)) {
    o.rk++;
    note(ctx, o, 'promoted', String(o.rk));
  }
}

/** Chance of wound / capture / death for the commander of a beaten or destroyed formation. */
export function commanderFate(ctx: Ctx, A: Apis3, f: Formation, destroyed: boolean): void {
  const o = officerOf(ctx, f);
  if (!o) return;
  const pW = destroyed ? 0.15 : 0.07, pC = destroyed ? 0.2 : 0.035, pD = (destroyed ? 0.12 : 0.025) * (has(o, 'stubborn') ? 1.6 : 1);
  const r = ctx.rng.next();
  let fate: 'wounded' | 'captured' | 'killed' | null = null;
  if (r < pD) fate = 'killed';
  else if (r < pD + pC) fate = 'captured';
  else if (r < pD + pC + pW) fate = 'wounded';
  if (!fate) return;
  detach(ctx, o);
  delete f.cm;
  if (fate === 'wounded') {
    o.s = 1;
    o.u = ctx.state.time.hours + 24 * (20 + Math.round(60 * ctx.rng.next()));
  } else o.s = fate === 'captured' ? 2 : 3;
  note(ctx, o, fate);
  ctx.bus.emit({ type: 'mil.officerFell', officer: o.id, country: o.c, fate });
  if (o.c === ctx.state.meta.playerCountryId) {
    ctx.news('military', `mil.news.officer.${fate}`, { name: o.n, rank: RANK_PT[`${RANK_KEYS[o.rk]}.${o.d}`] }, { formation: f.id }, { countries: [o.c], importance: 1 });
  }
  void A;
}

// ------------------------------------------------------------------ daily

const dayOf = (ctx: Ctx) => Math.floor(ctx.state.time.hours / 24);

const lists = new WeakMap<CommandState, { n: number; arr: Officer[] }>();
/** Officers as a flat array (iterating the id-keyed record is slow); rebuilt when officers are added. */
export function officerList(cs: CommandState): Officer[] {
  let l = lists.get(cs);
  if (!l || l.n !== cs.nx) {
    l = { n: cs.nx, arr: Object.values(cs.off) };
    lists.set(cs, l);
  }
  return l.arr;
}

export function commandersDay(ctx: Ctx, A: Apis3): void {
  const cs = cmdState(ctx);
  const day = dayOf(ctx), now = ctx.state.time.hours;
  const eco = A.eco;
  const all = officerList(cs);
  const byC = new Map<CountryId, Officer[]>();
  for (let i = 0; i < all.length; i++) {
    const o = all[i];
    if (o.s === 1 && now >= o.u) { o.s = 0; o.u = 0; note(ctx, o, 'recovered'); }
    if (o.s >= 2) continue;
    const l = byC.get(o.c);
    if (l) l.push(o);
    else byC.set(o.c, [o]);
  }
  const countries = [...byC.keys()].sort();
  for (const c of countries) {
    const list = byC.get(c)!;
    if (!ctx.state.world.alive[c]) continue;
    const h = strHash(c);
    const stab = eco ? eco.stability(c) : 60;
    const ws = cs.ws[c] ?? 65;
    // Loyalty drifts to a level set by stability and war support (every 4th day, scaled); disloyal generals feed the economy's coup path.
    if ((day + h) % 4 === 0) {
      const target = clamp(0.3 + 0.6 * (stab / 100) + 0.1 * ((ws - 50) / 50), 0.05, 0.98);
      for (const o of list) o.ly = r3(clamp(o.ly + (target - o.ly) * 0.08, 0, 1));
    }
    if ((day + h) % 7 === 0 || stab < 30) {
      let plotters = 0, plotter: Officer | null = null;
      for (const o of list) if (o.ly < 0.25 && o.rk >= 2 && o.s === 0) { plotters++; plotter ??= o; }
      if (plotter) {
        if ((day + h) % 7 === 0) eco?.addUnrest({ country: c }, Math.min(4, 0.8 * plotters), 'mil.cause.generalsPlot', 7);
        if (stab < 30 && ctx.rng.chance(0.004 * plotters * ((30 - stab) / 30))) {
          note(ctx, plotter, 'plot');
          ctx.bus.emit({ type: 'mil.generalsPlot', country: c, officer: plotter.id });
          eco?.addUnrest({ country: c }, 5, 'mil.cause.generalsPlot', 20);
          if (c === ctx.state.meta.playerCountryId) ctx.news('politics', 'mil.news.plot', { name: plotter.n }, { country: c }, { countries: [c], importance: 2 });
        }
      }
    }
    // Replacement: one new brigadier every ~12 days for a domain that has formations without commanders.
    if ((day + h) % 12 === 0) {
      for (const d of ['land', 'naval', 'air'] as Domain[]) {
        const have = list.filter((o) => o.d === d).length;
        if (have >= ROSTER_CAP) continue;
        let bare = 0;
        for (const f of formationsOf(ctx, c)) if (f.d === d && !f.reb && !f.cr && !f.cm) bare++;
        if (bare > 0 && !list.some((o) => o.d === d && o.s === 0 && !o.f)) addOfficer(ctx, c, d, 0);
      }
    }
    if ((day + h) % 3 === 0) autoAssign(ctx, c, list);
  }
}

/** Government purge after a coup: disloyal senior officers are removed, the rest swear loyalty again. */
export function onCoup(ctx: Ctx, c: CountryId): void {
  const cs = cmdState(ctx);
  for (const o of officerList(cs)) {
    if (o.c !== c || o.s === 3) continue;
    if (o.ly < 0.4 && o.rk >= 1) {
      detach(ctx, o);
      o.s = 3;
      note(ctx, o, 'purged');
    } else o.ly = r3(Math.max(o.ly, 0.6));
  }
}
