/** `militarySystem`: wires slice, hooks, commands and the public API (`ctx.api.military`). */
import type { CommandResult, CountryId, Ctx, GameEvent, MilitaryApi } from '../../core/contracts';
import { defineSystem } from '../../core/registry';
import { battleView, detectContacts, occupationTick, retreatFormation, runBattles } from './combat';
import { type Apis3, apisOf, dist, envOf, mod } from './env';
import {
  emptyState, formationsOf, initForces, listFormations, mergeFormations, S, spawnUnit, splitFormation, stockOf, touch, viewOf,
} from './forces';
import { blockadeRatio, logisticsDay, powerOfCountry, rebelsDay, spawnRebels, upkeepPerDay, visibleTo } from './logistics';
import { disembark, embark, orderMove, orderStop, planPending, stepMovers } from './movement';
import { previewOf } from './pathing';
import { autoProduce, cancel, enqueue, productionDay } from './production';
import { launch, orderStrike, processFlights } from './strikes';
import { applyTacticalOutcome, battleForces, setTacticalActive } from './tactical';
import { UNITS } from './catalog';
import type { Formation, MilitaryState, TacticalOutcome } from './types';

const fail = (reason: string): CommandResult => ({ ok: false, reason });
const PLAN_BUDGET = 150_000;

function forEach(ctx: Ctx, cmd: { country: CountryId; formations?: unknown; formation?: unknown }, fn: (f: Formation) => CommandResult): CommandResult {
  const ids = Array.isArray(cmd.formations) ? (cmd.formations as string[]) : typeof cmd.formation === 'string' ? [cmd.formation] : [];
  if (!ids.length) return fail('err.command.badArgs');
  let first: CommandResult | null = null, any = false;
  for (const id of ids) {
    const f = S(ctx).forms[id];
    const r = !f ? fail('err.mil.noSuchFormation') : f.c !== cmd.country ? fail('err.mil.notYours') : fn(f);
    if (r.ok) any = true;
    else first ??= r;
  }
  return any ? { ok: true } : (first ?? fail('err.command.badArgs'));
}

function retreatToCity(ctx: Ctx, A: Apis3, f: Formation): CommandResult {
  let best: [number, number] | null = null;
  for (const ci of ctx.world.citiesByCountry.get(f.c) ?? []) {
    const c = ctx.world.cities[ci];
    if (!c.provinceId || ctx.state.world.controller[c.provinceId] !== f.c) continue;
    const d = dist(f.p, [c.lon, c.lat]);
    if (d > 8 && d < 400 && (!best || d < best[0])) best = [d, ci];
  }
  if (f.bt) {
    const b = S(ctx).battles[f.bt];
    if (b) {
      b.a = b.a.filter((x) => x !== f.id);
      b.d = b.d.filter((x) => x !== f.id);
    }
    f.bt = null;
  }
  if (!best) {
    retreatFormation(ctx, A, f, f.p);
    return { ok: true };
  }
  const c = ctx.world.cities[best[1]];
  const r = orderMove(ctx, A, f, [c.lon, c.lat], { retreat: true });
  return r;
}

function handle(ctx: Ctx, cmd: { type: string; country: CountryId; [k: string]: unknown }): CommandResult | undefined {
  const A = apisOf(ctx);
  const st = S(ctx);
  const c = cmd.country;
  switch (cmd.type) {
    case 'mil.move': {
      const to = cmd.to as [number, number];
      if (!Array.isArray(to) || to.length !== 2) return fail('err.command.badArgs');
      return forEach(ctx, cmd, (f) => orderMove(ctx, A, f, to, { attack: !!cmd.attack }));
    }
    case 'mil.stop': return forEach(ctx, cmd, (f) => (orderStop(f), { ok: true }));
    case 'mil.defend':
      return forEach(ctx, cmd, (f) => {
        if (f.d !== 'land' || f.cr) return fail('err.mil.cannotDefend');
        orderStop(f);
        f.od = { k: 'defend' };
        return { ok: true };
      });
    case 'mil.retreat': return forEach(ctx, cmd, (f) => (f.cr ? fail('err.mil.embarked') : retreatToCity(ctx, A, f)));
    case 'mil.blockade':
      return forEach(ctx, cmd, (f) => {
        const port = ctx.world.ports[Number(cmd.port)];
        if (f.d !== 'naval' || !port) return fail('err.mil.badTarget');
        const owner = port.provinceId ? ctx.state.world.controller[port.provinceId] : null;
        if (!owner || !A.dip?.atWar(f.c, owner)) return fail('err.mil.notAtWar');
        f.od = { k: 'blockade', port: Number(cmd.port) };
        f.rt = null;
        f.pend = true;
        return { ok: true };
      });
    case 'mil.produce': return enqueue(ctx, A, c, String(cmd.template), Number(cmd.qty ?? 1), cmd.at as never);
    case 'mil.cancelProduction': return cancel(ctx, c, Number(cmd.id));
    case 'mil.merge': {
      const a = st.forms[String(cmd.a)], b = st.forms[String(cmd.b)];
      if (!a || !b) return fail('err.mil.noSuchFormation');
      if (a.c !== c || b.c !== c) return fail('err.mil.notYours');
      if (dist(a.p, b.p) > 15) return fail('err.mil.tooFar');
      return mergeFormations(ctx, a, b) ? { ok: true } : fail('err.mil.cannotMerge');
    }
    case 'mil.split': {
      const f = st.forms[String(cmd.formation)];
      if (!f) return fail('err.mil.noSuchFormation');
      if (f.c !== c) return fail('err.mil.notYours');
      const n = splitFormation(ctx, f, (cmd.slots as number[]) ?? []);
      return n ? { ok: true, formation: n.id } : fail('err.mil.cannotSplit');
    }
    case 'mil.rename': {
      const f = st.forms[String(cmd.formation)];
      if (!f || f.c !== c) return fail('err.mil.notYours');
      f.n = String(cmd.name).slice(0, 40);
      return { ok: true };
    }
    case 'mil.embark':
    case 'mil.disembark': {
      const f = st.forms[String(cmd.formation)];
      if (!f || f.c !== c) return fail('err.mil.notYours');
      if (cmd.type === 'mil.disembark') return disembark(ctx, A, f);
      const car = st.forms[String(cmd.carrier)];
      return car ? embark(ctx, f, car) : fail('err.mil.noSuchFormation');
    }
    case 'mil.strike': {
      const f = st.forms[String(cmd.formation)];
      if (!f || f.c !== c) return fail('err.mil.notYours');
      return orderStrike(ctx, A, f, cmd.target as never);
    }
    case 'mil.launch': return launch(ctx, A, c, cmd.weapon as never, cmd.target as never, cmd.from as never);
    case 'mil.setTactical': return setTacticalActive(ctx, String(cmd.battle), !!cmd.active);
    case 'mil.applyTacticalResult': return applyTacticalOutcome(ctx, cmd.result as TacticalOutcome);
  }
  return undefined;
}

export const militarySystem = defineSystem({
  id: 'military',
  createSlice(ctx): MilitaryState {
    const slice = emptyState();
    (ctx.state as unknown as { military: MilitaryState }).military = slice;
    initForces(ctx);
    return slice;
  },
  init(ctx) {
    ctx.bus.onPrefix('eco', (e: GameEvent) => {
      if (e.type === 'eco.revolt') {
        const r = e as unknown as { country: string; province: string; lon: number; lat: number; strength: number };
        spawnRebels(ctx, r.country, r.province, r.lon, r.lat, r.strength);
      }
    });
  },
  onLoad(ctx) {
    const env = envOf(ctx.world);
    env.legs.clear();
    env.powerCache.clear();
    env.stateRef = null;
    touch(ctx);
  },
  update(ctx, dt) {
    const A = apisOf(ctx);
    planPending(ctx, A, { left: PLAN_BUDGET });
    stepMovers(ctx, A, dt);
    processFlights(ctx, A, dt);
    detectContacts(ctx, A);
    runBattles(ctx, A, dt);
    occupationTick(ctx, A, dt);
  },
  onDay(ctx) {
    const A = apisOf(ctx);
    logisticsDay(ctx, A);
    productionDay(ctx, A);
    rebelsDay(ctx, A);
    const pc = ctx.state.meta.playerCountryId;
    if (ctx.state.meta.automation['mil.production']) autoProduce(ctx, A, pc);
  },
  handle: (ctx, cmd) => handle(ctx, cmd),
  api(ctx): MilitaryApi {
    return {
      formations: (filter) => listFormations(ctx, filter),
      formation: (id) => {
        const f = S(ctx).forms[id];
        return f ? viewOf(ctx, f) : null;
      },
      power: (c) => powerOfCountry(ctx, c),
      upkeepPerDay: (c) => upkeepPerDay(ctx, apisOf(ctx), c),
      battles: () => Object.values(S(ctx).battles).map((b) => battleView(ctx, b)),
      battle: (id) => {
        const b = S(ctx).battles[id];
        return b ? battleView(ctx, b) : null;
      },
      spawn: (c, template, where) => spawnUnit(ctx, c, template, where),
      strikeCapability(c) {
        const A = apisOf(ctx);
        const sk = stockOf(ctx, c);
        let bombers = 0, drones = 0;
        for (const f of formationsOf(ctx, c)) for (const s of f.u) {
          if (s.t === 'bomber') bombers += s.k * s.s;
          else if (s.t === 'drone') drones += s.k * s.s;
        }
        const r = sk.ballistic > 0 || sk.nuke > 0 ? UNITS.ballistic_missile.radius * mod(A, c, 'mil.missile.range') : sk.cruise > 0 ? UNITS.cruise_missile.radius * mod(A, c, 'mil.missile.range') : bombers > 0 ? UNITS.bomber.radius : 0;
        return { cruiseMissiles: sk.cruise, ballisticMissiles: sk.ballistic, nukes: sk.nuke, bombers: Math.round(bombers), drones: Math.round(drones), rangeKm: Math.round(r) };
      },
      pathPreview(id, dest) {
        const f = S(ctx).forms[id];
        return f ? previewOf(ctx, apisOf(ctx), f, dest) : null;
      },
      blockadeRatio: (c) => blockadeRatio(ctx, c),
      visibleTo: (viewer, id) => {
        const f = S(ctx).forms[id];
        return !!f && visibleTo(ctx, apisOf(ctx), viewer, f);
      },
      stock: (c) => ({ ...stockOf(ctx, c) }),
      battleForces: (id) => battleForces(ctx, id),
    };
  },
  metrics(ctx) {
    const st = S(ctx);
    const n = Object.keys(st.forms).length;
    return { formations: n, battles: Object.keys(st.battles).length, flights: st.flights.length, stateKB: Math.round(JSON.stringify(st).length / 1024) };
  },
});
