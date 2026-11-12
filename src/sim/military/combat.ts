/** Strategic battles: contact detection, hourly auto-resolution, retreats, occupation and collateral damage. */
import type { BattleId, BattleView, CountryId, Ctx, LonLat } from '../../core/contracts';
import { bearingDeg, destination } from '../../core/geo';
import { UNITS } from './catalog';
import { type Apis3, clamp, dist, envOf, hostile, mod, r3, r4 } from './env';
import { allForms, formationsOf, removeFormation, S, strengthOf } from './forces';
import { orderMove } from './movement';
import type { Battle, Formation, Slot } from './types';

const CONTACT_KM = { land: 12, naval: 45 };
const K_LOSS = 0.025;

// ------------------------------------------------------------------ strength model

const GROUP_ATK: Record<string, string> = {
  infantry: 'mil.infantry.attack', armor: 'mil.armor.attack', artillery: 'mil.artillery.accuracy', air: 'mil.air.attack',
  naval: 'mil.naval.attack', missile: 'mil.missile.accuracy', support: 'mil.infantry.attack',
};
const GROUP_DEF: Record<string, string> = {
  infantry: 'mil.infantry.defense', armor: 'mil.armor.defense', artillery: 'mil.infantry.defense', air: 'mil.air.defense',
  naval: 'mil.naval.defense', missile: 'mil.infantry.defense', support: 'mil.infantry.defense',
};

class ModCache {
  private m = new Map<string, number>();
  constructor(private A: Apis3) {}
  get(c: CountryId, key: string): number {
    const k = c + key;
    let v = this.m.get(k);
    if (v === undefined) this.m.set(k, (v = mod(this.A, c, key)));
    return v;
  }
}

const readiness = (f: Formation) => (0.35 + 0.65 * f.o) * (0.55 + 0.45 * f.m) * (0.5 + 0.5 * Math.min(1, f.s * 1.4)) * (1 + 0.4 * f.x);

export interface SideProfile {
  hard: number;
  weight: number;
  entrench: number;
}

export function profileOf(forms: Formation[]): SideProfile {
  let k = 0, h = 0, w = 0, e = 0, ew = 0;
  for (const f of forms) for (const s of f.u) {
    const t = UNITS[s.t], kk = s.k * s.s;
    k += kk;
    h += kk * t.hardness;
    w += kk * t.def;
    e += f.e * kk;
    ew += kk;
  }
  return { hard: k > 0 ? h / k : 0, weight: w, entrench: ew > 0 ? e / ew : 0 };
}

/** Offensive power of a set of formations against a target profile. */
export function powerOf(forms: Formation[], vs: SideProfile, naval: boolean, mc: ModCache, rugged: number, extra: Slot[] = [], extraC?: CountryId): number {
  let p = 0;
  const one = (c: CountryId, s: Slot, r: number) => {
    const t = UNITS[s.t];
    let a = naval ? t.naval + 0.15 * t.hard : t.soft * (1 - vs.hard) + t.hard * vs.hard;
    if (!naval && t.group === 'armor') a *= 1 - 0.35 * rugged;
    const key = s.t === 'mech_infantry' ? 'mil.mech.attack' : s.t === 'drone' ? 'mil.drone.attack' : GROUP_ATK[t.group];
    p += s.k * s.s * a * r * (key ? mc.get(c, key) : 1);
  };
  for (const f of forms) {
    const r = readiness(f);
    for (const s of f.u) one(f.c, s, r);
  }
  if (extraC) for (const s of extra) one(extraC, s, 0.8);
  return p;
}

export function defenseOf(forms: Formation[], mc: ModCache, bonus: number): number {
  let d = 0;
  for (const f of forms) {
    const r = 0.5 + 0.5 * f.o;
    for (const s of f.u) {
      const t = UNITS[s.t];
      d += s.k * s.s * t.def * r * mc.get(f.c, GROUP_DEF[t.group] ?? 'mil.infantry.defense');
    }
  }
  return d * bonus;
}

function applyLoss(ctx: Ctx, b: Battle, forms: Formation[], lam: number, selfBal: number): void {
  for (const f of forms) {
    let men = 0;
    for (const s of f.u) {
      const t = UNITS[s.t];
      const ds = Math.min(s.s, lam * t.expo * (0.8 + 0.4 * ctx.rng.next()));
      s.s = r3(s.s - ds);
      men += ds * s.k * t.men * 0.45;
    }
    b.cas[f.c] = Math.round((b.cas[f.c] ?? 0) + men);
    f.o = r3(clamp(f.o - (0.008 + 1.6 * lam), 0, 1));
    f.m = r3(clamp(f.m - 1.4 * lam + 0.004 * selfBal, 0, 1));
    f.x = r3(Math.min(1, f.x + 0.0008));
    f.e = 0;
  }
}

function supportSlots(ctx: Ctx, side: CountryId[], pos: LonLat, mc: ModCache, exclude: Set<string>): Slot[] {
  const out: Slot[] = [];
  for (const c of side) for (const f of formationsOf(ctx, c)) {
    if (f.d !== 'land' || f.bt || f.cr || exclude.has(f.id) || f.s < 0.2) continue;
    for (const s of f.u) {
      const t = UNITS[s.t];
      if (t.group !== 'artillery' || s.s < 0.1) continue;
      if (dist(f.p, pos) <= t.range * mc.get(c, 'mil.artillery.range')) out.push({ t: s.t, k: s.k * 0.5, s: s.s });
    }
  }
  return out;
}

// ------------------------------------------------------------------ battle lifecycle

function newBattle(ctx: Ctx, A: Apis3, att: Formation, def: Formation, kind: Battle['kind']): void {
  const st = S(ctx);
  const id = `B${st.nextB++}`;
  const p: LonLat = [r4((att.p[0] + def.p[0]) / 2), r4((att.p[1] + def.p[1]) / 2)];
  const b: Battle = {
    id, p, pr: ctx.world.locateProvince(p[0], p[1]), kind, a: [att.id], d: [def.id], ac: [att.c], dc: [def.c],
    t0: ctx.state.time.hours, bal: 0, tac: false, cas: {},
  };
  st.battles[id] = b;
  att.bt = def.bt = id;
  ctx.bus.emit({ type: 'mil.battleStarted', battle: id, province: b.pr, pos: p, attackerCountries: b.ac, defenderCountries: b.dc });
  const where = { battle: id };
  ctx.news('military', 'mil.news.battleStarted', { a: att.c, d: def.c }, where, { countries: [att.c, def.c], importance: 1 });
  void A;
}

function join(b: Battle, f: Formation, side: 'a' | 'd'): void {
  b[side].push(f.id);
  f.bt = b.id;
  const cs = side === 'a' ? b.ac : b.dc;
  if (!cs.includes(f.c)) cs.push(f.c);
}

export function finishBattle(ctx: Ctx, b: Battle, winner: 'attackers' | 'defenders' | 'draw'): void {
  const st = S(ctx);
  for (const id of [...b.a, ...b.d]) {
    const f = st.forms[id];
    if (f) f.bt = null;
  }
  let ca = 0, cd = 0;
  for (const c of b.ac) ca += b.cas[c] ?? 0;
  for (const c of b.dc) cd += b.cas[c] ?? 0;
  delete st.battles[b.id];
  ctx.bus.emit({
    type: 'mil.battleEnded', battle: b.id, province: b.pr, pos: b.p, winner, attackerCountries: b.ac, defenderCountries: b.dc,
    casualties: { attackers: ca, defenders: cd, byCountry: b.cas },
  });
}

/** Moves a beaten formation away from the enemy. */
export function retreatFormation(ctx: Ctx, A: Apis3, f: Formation, from: LonLat): void {
  const away = destination(f.p, (bearingDeg(from, f.p) + (ctx.rng.next() - 0.5) * 40 + 360) % 360, f.d === 'naval' ? 120 : 45);
  const r = orderMove(ctx, A, f, away, { retreat: true });
  if (!r.ok) f.od = { k: 'idle' };
  f.bt = null;
}

function enemyCentroid(ctx: Ctx, ids: string[]): LonLat {
  const st = S(ctx);
  let x = 0, y = 0, n = 0;
  for (const id of ids) {
    const f = st.forms[id];
    if (f) (x += f.p[0]), (y += f.p[1]), n++;
  }
  return n ? [x / n, y / n] : [0, 0];
}

export function runBattles(ctx: Ctx, A: Apis3, dt: number): void {
  const st = S(ctx);
  const mc = new ModCache(A);
  for (const bid in st.battles) {
    const b = st.battles[bid];
    const A_ = b.a.map((i) => st.forms[i]).filter(Boolean) as Formation[];
    const D_ = b.d.map((i) => st.forms[i]).filter(Boolean) as Formation[];
    b.a = A_.map((f) => f.id);
    b.d = D_.map((f) => f.id);
    if (!A_.length || !D_.length) {
      finishBattle(ctx, b, A_.length ? 'attackers' : D_.length ? 'defenders' : 'draw');
      continue;
    }
    if (b.tac) continue;
    // Formations that drifted apart leave the battle.
    const reach = CONTACT_KM[b.kind] * 2.5;
    for (const f of [...A_, ...D_]) if (dist(f.p, b.p) > reach) f.bt = null;
    const stillA = A_.filter((f) => f.bt === b.id), stillD = D_.filter((f) => f.bt === b.id);
    if (!stillA.length || !stillD.length) {
      finishBattle(ctx, b, stillA.length ? 'attackers' : stillD.length ? 'defenders' : 'draw');
      continue;
    }
    const naval = b.kind === 'naval';
    const prov = b.pr ? ctx.world.provinceById.get(b.pr) : null;
    const rugged = prov ? prov.rugged : 0;
    const urban = !naval && nearCity(ctx, b) ? 0.35 : 0;
    const pa = profileOf(stillA), pd = profileOf(stillD);
    const ex = new Set([...b.a, ...b.d]);
    const supA = naval ? [] : supportSlots(ctx, b.ac, b.p, mc, ex), supD = naval ? [] : supportSlots(ctx, b.dc, b.p, mc, ex);
    const attP = powerOf(stillA, pd, naval, mc, rugged, supA, b.ac[0]);
    const defP = powerOf(stillD, pa, naval, mc, rugged, supD, b.dc[0]);
    const terr = naval ? 1 : 1 + 0.55 * rugged + urban + 0.6 * pd.entrench * mc.get(b.dc[0], 'mil.entrench');
    const attDef = defenseOf(stillA, mc, naval ? 1 : 1 + 0.2 * rugged + 0.3 * pa.entrench);
    const defDef = defenseOf(stillD, mc, terr);
    // Munitions: a dry side fights at 60 %.
    const ammo = (forms: Formation[], c: CountryId) => {
      if (!A.eco) return 1;
      let need = 0;
      for (const f of forms) if (f.c === c) for (const s of f.u) need += (UNITS[s.t].ammo * s.k * s.s * dt) / 24;
      return need > 0 && A.eco.consume(c, 'munitions', need) < need * 0.95 ? 0.6 : 1;
    };
    const ma = ammo(stillA, b.ac[0]), md = ammo(stillD, b.dc[0]);
    const noise = () => 0.85 + 0.3 * ctx.rng.next();
    const lamD = clamp((K_LOSS * dt * (attP * ma * noise())) / Math.max(0.01, defDef), 0, 0.15);
    const lamA = clamp((K_LOSS * dt * (defP * md * noise())) / Math.max(0.01, attDef), 0, 0.15);
    b.bal = r3(clamp((attP - defP) / Math.max(0.01, attP + defP), -1, 1));
    applyLoss(ctx, b, stillA, lamA, -b.bal);
    applyLoss(ctx, b, stillD, lamD, b.bal);
    collateral(ctx, A, b, lamA + lamD);
    // Retreats and destruction.
    for (const [side, forms, other] of [['a', stillA, stillD], ['d', stillD, stillA]] as const) {
      for (const f of forms) {
        const sv = strengthOf(f);
        if (sv < 0.05) {
          b[side] = b[side].filter((x) => x !== f.id);
          removeFormation(ctx, f, true);
        } else if (f.o < 0.18 || f.m < 0.18 || sv < 0.14) {
          b[side] = b[side].filter((x) => x !== f.id);
          retreatFormation(ctx, A, f, enemyCentroid(ctx, other.map((o) => o.id)));
        }
      }
    }
    const a2 = b.a.filter((i) => st.forms[i]), d2 = b.d.filter((i) => st.forms[i]);
    if (!a2.length || !d2.length) finishBattle(ctx, b, a2.length ? 'attackers' : d2.length ? 'defenders' : 'draw');
  }
}

function nearCity(ctx: Ctx, b: Battle): number | null {
  if (!b.pr) return null;
  for (const ci of ctx.world.citiesByProvince.get(b.pr) ?? []) {
    const c = ctx.world.cities[ci];
    if (dist(b.p, [c.lon, c.lat]) < 10) return ci;
  }
  return null;
}

function collateral(ctx: Ctx, A: Apis3, b: Battle, intensity: number): void {
  const dmg = Math.min(0.012, intensity * 0.35);
  if (dmg < 0.0005) return;
  const ci = nearCity(ctx, b);
  if (ci !== null) A.wd.damage('city', ci, dmg, 'mil.battle');
  const pl = b.pr ? ctx.world.plantsByProvince.get(b.pr) : null;
  if (pl) for (const i of pl) if (dist(b.p, [ctx.world.plants[i].lon, ctx.world.plants[i].lat]) < 7) A.wd.damage('plant', i, dmg * 0.6, 'mil.battle');
}

/** Applies a tactical-battle outcome: per-slot strength, morale, winner and collateral. */
export function applyOutcome(ctx: Ctx, A: Apis3, b: Battle, squads: { ref: string; strength: number; morale: number }[], winner: 'attackers' | 'defenders' | 'draw', collat?: number): void {
  const st = S(ctx);
  for (const q of squads) {
    const [fid, si] = q.ref.split(':');
    const f = st.forms[fid];
    const s = f?.u[Number(si)];
    if (!f || !s) continue;
    const before = s.s;
    s.s = r3(clamp(before * clamp(q.strength, 0, 1), 0, 1));
    b.cas[f.c] = Math.round((b.cas[f.c] ?? 0) + (before - s.s) * s.k * UNITS[s.t].men * 0.45);
    f.m = r3(clamp((f.m + q.morale) / 2, 0, 1));
    f.x = r3(Math.min(1, f.x + 0.03));
  }
  if (collat && collat > 0) {
    const ci = nearCity(ctx, b);
    if (ci !== null) A.wd.damage('city', ci, Math.min(0.5, collat * 0.4), 'mil.tactical');
  }
  for (const id of [...b.a, ...b.d]) {
    const f = st.forms[id];
    if (!f) continue;
    if (strengthOf(f) < 0.05) removeFormation(ctx, f, true);
  }
  const loserSide = winner === 'attackers' ? b.d : winner === 'defenders' ? b.a : [];
  const win = winner === 'attackers' ? b.a : b.d;
  for (const id of loserSide) {
    const f = st.forms[id];
    if (f) retreatFormation(ctx, A, f, enemyCentroid(ctx, win));
  }
  finishBattle(ctx, b, winner);
}

// ------------------------------------------------------------------ contact detection

const cell = (lon: number, lat: number) => Math.floor((lon + 180) / 0.2) * 2000 + Math.floor((lat + 90) / 0.2);
let hash = new Map<number, Formation[]>();

export function detectContacts(ctx: Ctx, A: Apis3): void {
  if (!A.dip && !hasRebels(ctx)) return;
  const st = S(ctx);
  const env = envOf(ctx.world);
  if (env.warring.until < ctx.state.time.hours || env.warring.until > ctx.state.time.hours + 3.5) {
    const set = new Set<CountryId>();
    if (A.dip) for (const wv of A.dip.wars()) for (const c of [...wv.attackers, ...wv.defenders]) set.add(c);
    env.warring = { until: ctx.state.time.hours + 3, set };
  }
  const isWarring = (c: CountryId) => env.warring.set.has(c);
  hash = new Map();
  const act: Formation[] = [];
  let rebels = false;
  for (const f of allForms(ctx)) if (f.reb) { rebels = true; env.warring.set.add(f.reb); }
  if (!rebels && env.warring.set.size === 0) return;
  for (const f of allForms(ctx)) {
    if (f.d === 'air' || f.cr || f.o < 0.03) continue;
    if (!f.reb && !isWarring(f.c)) continue;
    act.push(f);
    const k = cell(f.p[0], f.p[1]);
    const l = hash.get(k);
    if (l) l.push(f);
    else hash.set(k, [f]);
  }
  for (const f of act) {
    if (f.od.k === 'move' && f.od.retreat) continue;
    const cx = Math.floor((f.p[0] + 180) / 0.2), cy = Math.floor((f.p[1] + 90) / 0.2);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const l = hash.get((cx + dx) * 2000 + cy + dy);
      if (!l) continue;
      for (const g of l) {
        if (g.id <= f.id || g.d !== f.d || (g.od.k === 'move' && g.od.retreat)) continue;
        if (f.bt && f.bt === g.bt) continue;
        if (!hostile(A, f, g) || dist(f.p, g.p) > CONTACT_KM[f.d as 'land' | 'naval']) continue;
        const kind = f.d === 'naval' ? 'naval' : 'land';
        if (f.bt && !g.bt) {
          const b = st.battles[f.bt];
          if (b) join(b, g, b.a.includes(f.id) ? 'd' : 'a');
        } else if (g.bt && !f.bt) {
          const b = st.battles[g.bt];
          if (b) join(b, f, b.a.includes(g.id) ? 'd' : 'a');
        } else if (!f.bt && !g.bt) {
          const fa = f.od.k === 'move' || g.od.k !== 'move';
          if (fa) newBattle(ctx, A, f, g, kind);
          else newBattle(ctx, A, g, f, kind);
        }
      }
    }
  }
}

const hasRebels = (ctx: Ctx) => allForms(ctx).some((f) => f.reb);

// ------------------------------------------------------------------ occupation

export function occupationTick(ctx: Ctx, A: Apis3, dt: number): void {
  if (!A.dip) return;
  const st = S(ctx), w = ctx.world, ctl = ctx.state.world.controller, own = ctx.state.world.owner;
  if (hash.size === 0) return;
  for (const f of allForms(ctx)) {
    if (f.d !== 'land' || !f.pr || f.bt || f.cr || f.reb || f.o < 0.25) continue;
    const cur = ctl[f.pr];
    if (cur === undefined || cur === f.c) continue;
    if (!A.dip.atWar(f.c, cur)) continue;
    const mc = w.mainCityOf(f.pr);
    const anchor: LonLat = mc !== null ? [w.cities[mc].lon, w.cities[mc].lat] : w.provinceById.get(f.pr)!.centroid;
    if (dist(f.p, anchor) > 18) continue;
    const entry = (st.occ[f.pr] ??= { by: f.c, h: 0 });
    if (entry.by !== f.c) {
      entry.by = f.c;
      entry.h = 0;
    }
    if (contested(A, f, anchor)) continue;
    entry.h += dt;
    const need = 24 + Math.min(72, (mc !== null ? w.cities[mc].pop : 0) / 100_000);
    if (entry.h < need) continue;
    delete st.occ[f.pr];
    const owner = own[f.pr];
    const newCtl = owner !== f.c && A.dip.allied(f.c, owner) && A.dip.atWar(owner, cur) ? owner : f.c;
    A.wd.setController(f.pr, newCtl, 'mil.occupation');
    const capital = w.capitalCityOf(owner);
    ctx.bus.emit({
      type: 'mil.provinceOccupied', province: f.pr, by: newCtl, from: cur, owner,
      capital: capital !== null && w.cities[capital].provinceId === f.pr,
    });
    ctx.news('military', 'mil.news.occupied', { province: f.pr, by: newCtl }, { province: f.pr }, { countries: [newCtl, cur], importance: 1 });
  }
  for (const pid in st.occ) {
    // Progress that nobody maintains decays and eventually disappears.
    const e = st.occ[pid];
    if (ctl[pid] === e.by) delete st.occ[pid];
  }
}

function contested(A: Apis3, f: Formation, anchor: LonLat): boolean {
  const cx = Math.floor((anchor[0] + 180) / 0.2), cy = Math.floor((anchor[1] + 90) / 0.2);
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    const l = hash.get((cx + dx) * 2000 + cy + dy);
    if (!l) continue;
    for (const g of l) if (g.d === 'land' && g.o > 0.1 && hostile(A, f, g) && dist(g.p, anchor) < 15) return true;
  }
  return false;
}

export function battleView(ctx: Ctx, b: Battle): BattleView {
  return {
    id: b.id, pos: b.p, province: b.pr, attackers: b.a, defenders: b.d, attackerCountries: b.ac, defenderCountries: b.dc,
    startedHours: b.t0, balance: b.bal, tactical: b.tac, kind: b.kind, casualties: b.cas,
  };
}
export type { BattleId };
