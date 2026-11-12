/** Orders and hourly movement along planned routes; embarking / disembarking. */
import type { CommandResult, Ctx, LonLat } from '../../core/contracts';
import { bearingDeg, destination, interpolateGreatCircle } from '../../core/geo';
import { UNITS } from './catalog';
import { type Apis3, clamp, dist, envOf, type LegGeo, mayEnter, r3, r4 } from './env';
import { allForms, S } from './forces';
import {
  airRadius, edgeSpeedFactor, legCount, legPoints, planAir, planLand, planSea, reliefFactor, speedOf, type Budget,
} from './pathing';
import { onStrikeArrival } from './strikes';
import type { Formation, Route } from './types';

const fail = (reason: string): CommandResult => ({ ok: false, reason });

export function nearestAirfield(ctx: Ctx, A: Apis3, f: Formation, p: LonLat, maxKm: number): number | null {
  let best: number | null = null, bd = maxKm;
  for (const a of ctx.world.airports) {
    if (Math.abs(a.lat - p[1]) > maxKm / 100) continue;
    const d = dist(p, [a.lon, a.lat]);
    if (d >= bd) continue;
    if (a.provinceId && !mayEnter(A, f.c, ctx.state.world.controller[a.provinceId] ?? f.c)) continue;
    if ((ctx.state.world.airportDamage[a.index] ?? 0) > 0.9) continue;
    bd = d;
    best = a.index;
  }
  return best;
}

/** Validates an order and queues path planning (done by `planPending` under the A* budget). */
export function orderMove(ctx: Ctx, A: Apis3, f: Formation, to: LonLat, opts: { attack?: boolean; retreat?: boolean } = {}): CommandResult {
  if (f.cr) return fail('err.mil.embarked');
  if (f.bt && !opts.retreat) return fail('err.mil.inBattle');
  if (!(Number.isFinite(to[0]) && Number.isFinite(to[1]))) return fail('err.command.badArgs');
  let dest = to;
  if (f.d === 'air') {
    const ai = nearestAirfield(ctx, A, f, to, 120);
    if (ai === null) return fail('err.mil.noAirbase');
    const a = ctx.world.airports[ai];
    dest = [a.lon, a.lat];
    if (dist(f.p, dest) > 2 * airRadius(A, f)) return fail('err.mil.outOfRange');
  }
  f.od = { k: 'move', to: [r4(dest[0]), r4(dest[1])] };
  if (opts.attack) f.od.attack = true;
  if (opts.retreat) f.od.retreat = true;
  f.rt = null;
  f.pend = true;
  f.e = 0;
  return { ok: true };
}

export function orderStop(f: Formation): void {
  if (f.od.k === 'strike') return;
  f.od = { k: 'idle' };
  f.rt = null;
  f.pend = false;
}

const blockadePos = (ctx: Ctx, port: number): LonLat | null => (ctx.world.ports[port] ? [ctx.world.ports[port].lon, ctx.world.ports[port].lat] : null);

export function planPending(ctx: Ctx, A: Apis3, budget: Budget): void {
  const st = S(ctx);
  for (const f of allForms(ctx)) {
    if (!f.pend) continue;
    if (budget.left <= 0) return;
    const to = f.od.k === 'move' ? f.od.to : f.od.k === 'blockade' ? blockadePos(ctx, f.od.port) : f.od.k === 'strike' ? ([f.rt?.w[f.rt.w.length - 2] ?? f.p[0], f.rt?.w[f.rt.w.length - 1] ?? f.p[1]] as LonLat) : null;
    f.pend = false;
    if (!to) continue;
    const r = f.d === 'land' ? planLand(ctx, A, f, to, budget) : f.d === 'naval' ? planSea(ctx, A, f, to, budget) : planAir(A, f, to);
    if (r.ok) f.rt = r.route;
    else {
      f.rt = null;
      f.od = { k: 'idle' };
      ctx.news('military', 'mil.news.noPath', { name: f.n, reason: r.reason }, { formation: f.id }, { countries: [f.c], importance: 1 });
    }
  }
}

function legGeo(ctx: Ctx, f: Formation, rt: Route): LegGeo {
  const env = envOf(ctx.world);
  let g = env.legs.get(f.id);
  if (!g || g.rt !== rt || g.i !== rt.i) {
    const pts = legPoints(ctx, rt, rt.i);
    const cum = [0];
    for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + dist(pts[k - 1], pts[k]));
    g = { rt, i: rt.i, pts, cum };
    env.legs.set(f.id, g);
  }
  return g;
}

function posAt(g: LegGeo, km: number): { pos: LonLat; hd: number } {
  const { pts, cum } = g;
  const n = pts.length;
  if (n === 1) return { pos: pts[0], hd: 0 };
  let k = 1;
  while (k < n - 1 && cum[k] < km) k++;
  const seg = cum[k] - cum[k - 1];
  const t = seg > 0 ? clamp((km - cum[k - 1]) / seg, 0, 1) : 1;
  return { pos: interpolateGreatCircle(pts[k - 1], pts[k], t), hd: bearingDeg(pts[k - 1], pts[k]) };
}

function legSpeed(ctx: Ctx, A: Apis3, f: Formation, rt: Route): number {
  if (rt.m === 'air') return speedOf(A, f, 'fly');
  if (rt.m === 'sea') return speedOf(A, f, 'sea');
  if (rt.m === 'offroad') return speedOf(A, f, 'off') * reliefFactor(ctx, f.pr);
  const i = rt.i;
  if (i === 0 || i > rt.ed.length) return speedOf(A, f, 'off') * reliefFactor(ctx, f.pr);
  return speedOf(A, f, 'road') * Math.max(0.04, edgeSpeedFactor(ctx, rt.ed[i - 1] >> 1));
}

/** Advances every moving formation by `dt` hours. */
export function stepMovers(ctx: Ctx, A: Apis3, dt: number): void {
  const st = S(ctx);
  const radiated = st.rad.length > 0;
  for (const f of allForms(ctx)) {
    if (f.cr) {
      const c = st.forms[f.cr];
      if (c) f.p = c.p;
      continue;
    }
    const rt = f.rt;
    if (!rt || f.bt) continue;
    const fuel = st.sh[f.c]?.[0] ?? 1;
    const mul = (0.55 + 0.45 * f.o) * (0.5 + 0.5 * fuel) * (f.s < 0.15 ? 0.5 : 1);
    let left = dt;
    let moved = false;
    while (left > 1e-6 && f.rt === rt) {
      const g = legGeo(ctx, f, rt);
      const total = g.cum[g.cum.length - 1];
      let v = legSpeed(ctx, A, f, rt) * mul;
      if (radiated) v *= 0.7;
      if (v <= 0) break;
      const room = total - rt.km;
      if (v * left < room) {
        rt.km += v * left;
        rt.dn += v * left;
        left = 0;
      } else {
        left -= room / v;
        rt.dn += room;
        rt.i++;
        rt.km = 0;
        if (rt.i >= legCount(rt)) {
          moved = true;
          arrive(ctx, A, f, g.pts[g.pts.length - 1]);
          break;
        }
        continue;
      }
      const at = posAt(g, rt.km);
      f.p = [r4(at.pos[0]), r4(at.pos[1])];
      f.h = Math.round(at.hd);
      moved = true;
    }
    if (moved && f.d !== 'air') {
      const pr = ctx.world.locateProvince(f.p[0], f.p[1]);
      if (pr !== f.pr) {
        f.pr = pr;
        if (pr && f.d === 'land' && !f.reb && !mayEnter(A, f.c, ctx.state.world.controller[pr] ?? f.c) && f.rt) {
          f.rt = null;
          f.od = { k: 'idle' };
          ctx.news('military', 'mil.news.halted', { name: f.n }, { formation: f.id }, { countries: [f.c], importance: 1 });
        }
      }
    }
  }
}

function arrive(ctx: Ctx, A: Apis3, f: Formation, end: LonLat): void {
  f.p = [r4(end[0]), r4(end[1])];
  f.rt = null;
  envOf(ctx.world).legs.delete(f.id);
  if (f.d !== 'air') f.pr = ctx.world.locateProvince(f.p[0], f.p[1]);
  if (f.od.k === 'strike') {
    onStrikeArrival(ctx, A, f);
    return;
  }
  if (f.d === 'air') {
    const ai = nearestAirfield(ctx, A, f, f.p, 8);
    if (ai !== null) f.home = { kind: 'airport', index: ai };
    f.pr = null;
  }
  if (f.od.k !== 'blockade') f.od = { k: 'idle' };
}

// ------------------------------------------------------------------ embark / disembark

const HEAVY = new Set(['armor', 'artillery', 'mlrs', 'air_defense', 'mech_infantry', 'logistics']);

export function carryCapacity(f: Formation): number {
  let c = 0;
  for (const s of f.u) c += UNITS[s.t].cap * s.k * s.s;
  return c;
}
export function carriedLoad(ctx: Ctx, carrier: Formation): number {
  let l = 0;
  for (const id in S(ctx).forms) {
    const o = S(ctx).forms[id];
    if (o.cr === carrier.id) l += o.u.reduce((a, s) => a + s.k, 0);
  }
  return l;
}

export function embark(ctx: Ctx, f: Formation, carrier: Formation): CommandResult {
  if (f.d !== 'land' || f.c !== carrier.c || f.bt || f.cr || carrier.d === 'land') return fail('err.mil.cannotEmbark');
  if (dist(f.p, carrier.p) > 30) return fail('err.mil.tooFar');
  if (carrier.d === 'air' && f.u.some((s) => HEAVY.has(s.t))) return fail('err.mil.tooHeavy');
  const need = f.u.reduce((a, s) => a + s.k, 0);
  if (carriedLoad(ctx, carrier) + need > carryCapacity(carrier)) return fail('err.mil.noCapacity');
  f.cr = carrier.id;
  f.rt = null;
  f.od = { k: 'idle' };
  f.p = carrier.p;
  return { ok: true };
}

export function disembark(ctx: Ctx, A: Apis3, f: Formation): CommandResult {
  const carrier = f.cr ? S(ctx).forms[f.cr] : null;
  if (!carrier) return fail('err.mil.notEmbarked');
  if (carrier.d === 'air') {
    if (carrier.rt || carrier.od.k !== 'idle') return fail('err.mil.carrierMoving');
    delete f.cr;
    return { ok: true };
  }
  for (let r = 5; r <= 60; r += 5)
    for (let a = 0; a < 360; a += 22.5) {
      const p = destination(carrier.p, a, r);
      if (ctx.world.isSea(p[0], p[1])) continue;
      const pr = ctx.world.locateProvince(p[0], p[1]);
      if (pr && !f.reb && !mayEnter(A, f.c, ctx.state.world.controller[pr] ?? f.c)) continue;
      delete f.cr;
      f.p = [r4(p[0]), r4(p[1])];
      f.pr = pr;
      f.o = r3(f.o * 0.7);
      return { ok: true };
    }
  return fail('err.mil.noLanding');
}
