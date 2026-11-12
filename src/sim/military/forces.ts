/** Formation lifecycle: creation, initial national forces from military.json, merge/split, views, aggregates. */
import type {
  BBox, CountryId, Ctx, Domain, FormationFilter, FormationId, FormationView, LonLat, SpawnWhere, UnitTemplateId,
} from '../../core/contracts';
import { UNITS } from './catalog';
import { type Env, envOf, r3, r4 } from './env';
import type { BaseRef, Formation, MilitaryState, Slot, StockState } from './types';

export const S = (ctx: Ctx): MilitaryState => ctx.state.military;

export function emptyState(): MilitaryState {
  return { forms: {}, battles: {}, queue: {}, stock: {}, flights: [], occ: {}, sh: {}, rad: [], blk: {}, nextF: 1, nextB: 1, nextQ: 1, nextFl: 1 };
}

const KIND_NAME: Record<string, string> = {
  infantry: 'Bda de Infantaria', mech_infantry: 'Bda Mecanizada', armor: 'Bda Blindada', artillery: 'Grupo de Artilharia',
  mlrs: 'Grupo de Foguetes', air_defense: 'Grupo Antiaéreo', special_forces: 'Forças Especiais', recon: 'Rg Reconhecimento',
  fighter: 'Ala de Caça', bomber: 'Ala de Bombardeio', attack_heli: 'Ala de Helicópteros', transport_heli: 'Ala de Helicópteros',
  air_transport: 'Ala de Transporte', drone: 'Esq. de Drones', destroyer: 'Esquadra', frigate: 'Esquadra', submarine: 'Flotilha de Submarinos',
  carrier: 'Grupo Aeronaval', landing_ship: 'Esq. Anfíbio', engineer: 'Btl de Engenharia', logistics: 'Btl de Logística',
};

/** Formation power weight of a slot (industry points as common currency). */
export const slotWeight = (s: Slot) => s.k * UNITS[s.t].pts;

export function strengthOf(f: Formation): number {
  let a = 0, b = 0;
  for (const s of f.u) {
    const w = slotWeight(s);
    a += s.s * w;
    b += w;
  }
  return b > 0 ? a / b : 0;
}

export function dominant(slots: Slot[]): string {
  let best = slots[0]?.t ?? 'infantry', bw = -1;
  for (const s of slots) {
    const w = slotWeight(s);
    if (UNITS[s.t].domain !== 'missile' && w > bw && !['logistics', 'engineer'].includes(s.t)) (bw = w), (best = s.t);
  }
  return best;
}

export function touch(ctx: Ctx): void {
  envOf(ctx.world).ver++;
}

export function createFormation(
  ctx: Ctx, c: CountryId, d: Domain, p: LonLat, slots: Slot[], home: BaseRef | null, opts: { exp?: number; name?: string } = {},
): Formation {
  const st = S(ctx);
  const id = `F${st.nextF++}`;
  const f: Formation = {
    id, c, n: opts.name ?? `${(st.nextF % 47) + 1}ª ${KIND_NAME[dominant(slots)] ?? 'Formação'}`, d,
    p: [r4(p[0]), r4(p[1])], h: 0, pr: ctx.world.locateProvince(p[0], p[1]),
    u: slots, o: 1, m: r3(0.7 + ctx.rng.next() * 0.2), x: r3(opts.exp ?? ctx.rng.next() * 0.4), s: 1, e: 0,
    od: { k: 'idle' }, rt: null, home, bt: null,
  };
  st.forms[id] = f;
  touch(ctx);
  ctx.bus.emit({ type: 'mil.formationCreated', formation: id, country: c });
  return f;
}

export function removeFormation(ctx: Ctx, f: Formation, destroyed: boolean): void {
  const st = S(ctx);
  if (f.bt) {
    const b = st.battles[f.bt];
    if (b) {
      b.a = b.a.filter((x) => x !== f.id);
      b.d = b.d.filter((x) => x !== f.id);
    }
  }
  for (const o of Object.values(st.forms)) if (o.cr === f.id) delete o.cr;
  delete st.forms[f.id];
  envOf(ctx.world).legs.delete(f.id);
  touch(ctx);
  if (destroyed) {
    ctx.bus.emit({ type: 'mil.formationDestroyed', formation: f.id, country: f.c, pos: f.p });
    if (f.reb && f.pr) ctx.bus.emit({ type: 'mil.rebelsDefeated', province: f.pr, country: f.reb });
  }
}

function reindex(ctx: Ctx): Env {
  const env = envOf(ctx.world);
  const st = S(ctx);
  if (env.stateRef !== st || env.byCountryVer !== env.ver) {
    env.byCountry.clear();
    env.all = [];
    for (const id in st.forms) {
      const f = st.forms[id];
      env.all.push(f);
      let l = env.byCountry.get(f.c);
      if (!l) env.byCountry.set(f.c, (l = []));
      l.push(f);
    }
    env.stateRef = st;
    env.byCountryVer = env.ver;
  }
  return env;
}

/** Array of every formation (cached; rebuilt when formations are created/removed). Do not mutate. */
export const allForms = (ctx: Ctx): Formation[] => reindex(ctx).all;

export function formationsOf(ctx: Ctx, c: CountryId): Formation[] {
  return reindex(ctx).byCountry.get(c) ?? [];
}

export function stockOf(ctx: Ctx, c: CountryId): StockState {
  const st = S(ctx);
  return (st.stock[c] ??= { cruise: 0, ballistic: 0, nuke: 0 });
}

export function whereToPos(ctx: Ctx, where: SpawnWhere): { pos: LonLat; base: BaseRef | null } | null {
  const w = ctx.world;
  if ('kind' in where) {
    const arr = where.kind === 'city' ? w.cities : where.kind === 'airport' ? w.airports : w.ports;
    const o = arr[where.index];
    return o ? { pos: [o.lon, o.lat], base: { kind: where.kind, index: where.index } } : null;
  }
  return { pos: [where.lon, where.lat], base: null };
}

/** Creates a single-battalion formation (or adds to the national missile stock). */
export function spawnUnit(ctx: Ctx, c: CountryId, template: UnitTemplateId, where: SpawnWhere): FormationId | null {
  const t = UNITS[template];
  const loc = whereToPos(ctx, where);
  if (!t || !loc) return null;
  if (t.domain === 'missile') {
    const sk = stockOf(ctx, c);
    if (template === 'cruise_missile') sk.cruise += 1;
    else if (template === 'ballistic_missile') sk.ballistic += 1;
    else sk.nuke += 1;
    return null;
  }
  const d = t.domain as Domain;
  // Reinforce an idle formation of the same domain at the same base instead of fragmenting the map.
  for (const o of formationsOf(ctx, c)) {
    if (o.d === d && !o.bt && o.od.k === 'idle' && !o.reb && o.u.length < 10 && o.u.reduce((a, s) => a + s.k, 0) < 30) {
      if (Math.abs(o.p[0] - loc.pos[0]) < 0.05 && Math.abs(o.p[1] - loc.pos[1]) < 0.05) {
        const slot = o.u.find((s) => s.t === template);
        if (slot) {
          slot.s = r3((slot.s * slot.k + 1) / (slot.k + 1));
          slot.k += 1;
        } else o.u.push({ t: template, k: 1, s: 1 });
        return o.id;
      }
    }
  }
  const f = createFormation(ctx, c, d, loc.pos, [{ t: template, k: 1, s: 1 }], loc.base, { exp: 0.1 });
  return f.id;
}

export function mergeFormations(ctx: Ctx, a: Formation, b: Formation): boolean {
  if (a.c !== b.c || a.d !== b.d || a.bt || b.bt || a.id === b.id) return false;
  for (const s of b.u) {
    const t = a.u.find((x) => x.t === s.t);
    if (t) {
      t.s = r3((t.s * t.k + s.s * s.k) / (t.k + s.k));
      t.k += s.k;
    } else a.u.push(s);
  }
  const wa = a.u.length, wb = b.u.length;
  a.o = r3((a.o * wa + b.o * wb) / (wa + wb));
  a.m = r3((a.m * wa + b.m * wb) / (wa + wb));
  a.s = r3(Math.min(a.s, b.s));
  removeFormation(ctx, b, false);
  return true;
}

export function splitFormation(ctx: Ctx, f: Formation, idxs: number[]): Formation | null {
  const pick = [...new Set(idxs)].filter((i) => i >= 0 && i < f.u.length);
  if (!pick.length || f.bt) return null;
  let moved: Slot[];
  if (pick.length === f.u.length) {
    // Everything selected: take half of every divisible slot.
    moved = [];
    for (const s of f.u) {
      const half = Math.floor(s.k / 2);
      if (half >= 1) {
        moved.push({ t: s.t, k: half, s: s.s });
        s.k -= half;
      }
    }
    if (!moved.length) return null;
  } else {
    moved = f.u.filter((_, i) => pick.includes(i));
    f.u = f.u.filter((_, i) => !pick.includes(i));
  }
  const dom = f.d;
  const n = createFormation(ctx, f.c, dom, f.p, moved, f.home, { exp: f.x });
  n.o = f.o;
  n.m = f.m;
  n.s = f.s;
  return n;
}

// ------------------------------------------------------------------ views

export function viewOf(ctx: Ctx, f: Formation): FormationView {
  const dest = f.od.k === 'move' ? f.od.to : f.od.k === 'strike' && f.rt ? ([f.rt.w[f.rt.w.length - 2], f.rt.w[f.rt.w.length - 1]] as LonLat) : null;
  return {
    id: f.id, country: f.c, name: f.n, domain: f.d, pos: f.p, heading: f.h, province: f.pr,
    units: f.u.map((s) => ({ template: s.t, strength: s.s, modelId: UNITS[s.t].modelId })),
    strength: strengthOf(f), organization: f.o, morale: f.m, experience: f.x, supply: f.s,
    order: f.od.k, destination: dest, battleId: f.bt,
    routeProgress: f.rt ? Math.min(1, f.rt.dn / Math.max(1, f.rt.tot)) : 0, carriedBy: f.cr ?? null, rebel: !!f.reb,
  };
}

export function listFormations(ctx: Ctx, filter?: FormationFilter): FormationView[] {
  const out: FormationView[] = [];
  const st = S(ctx);
  const bb: BBox | undefined = filter?.bbox;
  const src = filter?.country ? formationsOf(ctx, filter.country) : null;
  const visit = (f: Formation) => {
    if (filter?.domain && f.d !== filter.domain) return;
    if (filter?.province && f.pr !== filter.province) return;
    if (bb && (f.p[0] < bb[0] || f.p[0] > bb[2] || f.p[1] < bb[1] || f.p[1] > bb[3])) return;
    out.push(viewOf(ctx, f));
  };
  if (src) src.forEach(visit);
  else for (const id in st.forms) visit(st.forms[id]);
  return out;
}

// ------------------------------------------------------------------ initial forces

const place = (ctx: Ctx, c: CountryId, kind: 'city' | 'airport' | 'port'): { pos: LonLat; base: BaseRef }[] => {
  const w = ctx.world;
  const idx = kind === 'city' ? w.citiesByCountry.get(c) : kind === 'airport' ? w.airportsByCountry.get(c) : w.portsByCountry.get(c);
  if (!idx?.length) return [];
  const arr = kind === 'city' ? w.cities : kind === 'airport' ? w.airports : w.ports;
  const score = (i: number) => {
    const o = arr[i] as { pop?: number; size?: number; military?: boolean };
    return kind === 'city' ? (o.pop ?? 0) : (o.size ?? 0) * 10 + (o.military ? 5 : 0);
  };
  return [...idx].sort((a, b) => score(b) - score(a) || a - b).map((i) => ({ pos: [arr[i].lon, arr[i].lat] as LonLat, base: { kind, index: i } }));
};

function distribute(totals: [UnitTemplateId, number][], n: number): Slot[][] {
  const buckets: Slot[][] = Array.from({ length: n }, () => []);
  totals.forEach(([t, k], ti) => {
    if (k <= 0) return;
    const base = Math.floor(k / n), rem = k % n;
    for (let b = 0; b < n; b++) {
      const q = base + ((b + ti * 3) % n < rem ? 1 : 0);
      if (q > 0) buckets[b].push({ t, k: q, s: 1 });
    }
  });
  return buckets.filter((b) => b.length);
}

const jitter = (ctx: Ctx, v: number) => v + (ctx.rng.next() - 0.5) * 0.12;

function emitGroup(ctx: Ctx, c: CountryId, d: Domain, buckets: Slot[][], sites: { pos: LonLat; base: BaseRef }[], fallback: LonLat, exp: number) {
  buckets.forEach((slots, i) => {
    const site = sites.length ? sites[i % sites.length] : null;
    const pos: LonLat = site ? [jitter(ctx, site.pos[0]), jitter(ctx, site.pos[1])] : fallback;
    // Jittered land points may fall in the sea: keep the exact base position then.
    const ok = d === 'naval' ? true : !ctx.world.isSea(pos[0], pos[1]);
    createFormation(ctx, c, d, ok && d !== 'naval' ? pos : (site?.pos ?? fallback), slots, site?.base ?? null, { exp: exp + ctx.rng.next() * 0.15 });
  });
}

export function initForces(ctx: Ctx): void {
  const w = ctx.world, st = S(ctx);
  for (const country of w.countries) {
    const c = country.id;
    const inv = w.military[c];
    if (!inv || !ctx.state.world.alive[c]) continue;
    const af = w.stats[c]?.armedForces ?? 0;
    const exp = Math.min(0.55, 0.15 + (w.stats[c]?.milExpUsd ?? 0) / 4e11);
    const cap = country.capital;
    const num = (v: unknown) => (typeof v === 'number' ? v : 0);

    const inf = Math.round((af * 0.55) / 800);
    const armor = Math.round(num(inv.tanks) / 44), mech = Math.round(num(inv.ifv) / 45);
    const arty = Math.round(num(inv.artillery) / 24), mlrs = Math.round(num(inv.mlrs) / 12), sam = Math.round(num(inv.sam) / 12);
    const core = inf + armor + mech + arty + mlrs + sam;
    const landTot: [UnitTemplateId, number][] = [
      ['infantry', core === 0 && af > 0 ? 1 : inf], ['mech_infantry', mech], ['armor', armor], ['artillery', arty], ['mlrs', mlrs], ['air_defense', sam],
      ['recon', Math.round((armor + mech) * 0.1)], ['engineer', Math.round(inf / 12)], ['logistics', Math.round(core * 0.1)],
      ['special_forces', Math.round(inf / 40)],
    ];
    const L = landTot.reduce((a, [, k]) => a + k, 0);
    if (L > 0) {
      const n = Math.max(1, Math.min(70, Math.round(0.85 * Math.sqrt(L))));
      emitGroup(ctx, c, 'land', distribute(landTot, n), place(ctx, c, 'city'), [cap.lon, cap.lat], exp);
    }
    const airTot: [UnitTemplateId, number][] = [
      ['fighter', Math.ceil(num(inv.fighters) / 18)], ['bomber', Math.ceil(num(inv.bombers) / 12)],
      ['attack_heli', Math.ceil(num(inv.attackHelis) / 16)], ['air_transport', Math.round((num(inv.transports) * 0.5) / 12)],
      ['transport_heli', Math.round((num(inv.transports) * 0.5) / 16)], ['drone', Math.round(num(inv.drones) / 24)],
    ];
    const A = airTot.reduce((a, [, k]) => a + k, 0);
    if (A > 0) {
      const n = Math.max(1, Math.min(35, Math.round(0.8 * Math.sqrt(A))));
      const sites = place(ctx, c, 'airport');
      emitGroup(ctx, c, 'air', distribute(airTot, n), sites.length ? sites : place(ctx, c, 'city'), [cap.lon, cap.lat], exp);
    }
    const ships = num(inv.destroyers) + num(inv.frigates) + num(inv.subs) + num(inv.carriers);
    const ports = place(ctx, c, 'port');
    if (ships > 0 && ports.length) {
      const navTot: [UnitTemplateId, number][] = [
        ['carrier', num(inv.carriers)], ['destroyer', num(inv.destroyers)], ['frigate', num(inv.frigates)], ['submarine', num(inv.subs)],
        ['landing_ship', Math.round(ships * 0.15 + num(inv.carriers))],
      ];
      emitGroup(ctx, c, 'naval', distribute(navTot, Math.max(1, Math.min(16, Math.ceil(ships / 6)))), ports, [cap.lon, cap.lat], exp);
    }
    const nukes = num(inv.nukes);
    const cruise = Math.round(num(inv.destroyers) * 8 + num(inv.frigates) * 4 + num(inv.subs) * 3 + num(inv.bombers) * 2);
    const ballistic = nukes > 0 ? Math.round(nukes * 0.6) : Math.round(num(inv.mlrs) * 0.3);
    if (cruise + ballistic + nukes > 0) st.stock[c] = { cruise, ballistic, nuke: nukes };
  }
}

export { r3 };
export type { Env };
