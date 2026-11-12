/** Military production queue: industry points + resources + manpower from the economy API. */
import type { CommandResult, CountryId, Ctx, LonLat, UnitTemplateId } from '../../core/contracts';
import { UNITS } from './catalog';
import { type Apis3, mod } from './env';
import { S, spawnUnit } from './forces';
import type { BaseRef } from './types';
import type { QueueItem } from './types';

const fail = (reason: string): CommandResult => ({ ok: false, reason });
const MAX_QUEUE = 30;

export function enqueue(ctx: Ctx, A: Apis3, c: CountryId, template: UnitTemplateId, qty: number, at?: BaseRef): CommandResult {
  const t = UNITS[template];
  if (!t) return fail('err.mil.unknownUnit');
  if (A.res && !A.res.unlocked(c, `unit.${template}`)) return fail('err.mil.locked');
  if (!(qty >= 1) || qty > 100) return fail('err.command.badArgs');
  if (at) {
    const arr = at.kind === 'city' ? ctx.world.cities : at.kind === 'airport' ? ctx.world.airports : ctx.world.ports;
    const o = arr[at.index];
    if (!o || o.countryId !== c) return fail('err.mil.badBase');
    if (!((t.domain === 'land' && at.kind === 'city') || (t.domain === 'air' && at.kind === 'airport') || (t.domain === 'naval' && at.kind === 'port') || t.domain === 'missile'))
      return fail('err.mil.badBase');
  }
  const q = (S(ctx).queue[c] ??= []);
  if (q.length >= MAX_QUEUE) return fail('err.mil.queueFull');
  const st = S(ctx);
  q.push({ id: st.nextQ++, t: template, qty: Math.floor(qty), left: 0, at: at ?? null });
  return { ok: true, id: q[q.length - 1].id };
}

export function cancel(ctx: Ctx, c: CountryId, id: number): CommandResult {
  const q = S(ctx).queue[c];
  const i = q?.findIndex((x) => x.id === id) ?? -1;
  if (i < 0) return fail('err.mil.noSuchItem');
  q.splice(i, 1);
  return { ok: true };
}

/** Default base for a template: best own city / airport / port. */
function defaultBase(ctx: Ctx, c: CountryId, d: string): { lon: number; lat: number } | { kind: 'city' | 'airport' | 'port'; index: number } | null {
  const w = ctx.world;
  const pick = (idx: number[] | undefined, score: (i: number) => number) => (idx?.length ? idx.reduce((a, b) => (score(b) > score(a) ? b : a)) : null);
  const ctl = ctx.state.world.controller;
  const mine = (pid: string | null) => !!pid && ctl[pid] === c;
  if (d === 'air') {
    const i = pick(w.airportsByCountry.get(c), (k) => (mine(w.airports[k].provinceId) ? 1000 : 0) + w.airports[k].size * 10 + (w.airports[k].military ? 5 : 0));
    if (i !== null) return { kind: 'airport', index: i };
  } else if (d === 'naval') {
    const i = pick(w.portsByCountry.get(c), (k) => (mine(w.ports[k].provinceId) ? 1000 : 0) + w.ports[k].size);
    if (i !== null) return { kind: 'port', index: i };
    return null;
  }
  const i = pick(w.citiesByCountry.get(c), (k) => (mine(w.cities[k].provinceId) ? 1e9 : 0) + w.cities[k].pop);
  if (i !== null) return { kind: 'city', index: i };
  const cap = w.countryById.get(c)!.capital;
  return { lon: cap.lon, lat: cap.lat };
}

function spawnFor(ctx: Ctx, c: CountryId, it: QueueItem): string | null {
  const t = UNITS[it.t];
  const where = it.at ? { kind: it.at.kind, index: it.at.index } : defaultBase(ctx, c, t.domain);
  if (!where) return null;
  return spawnUnit(ctx, c, it.t, where);
}

export function productionDay(ctx: Ctx, A: Apis3): void {
  const eco = A.eco;
  if (!eco) return;
  const st = S(ctx);
  for (const c in st.queue) {
    const q = st.queue[c];
    if (!q.length) continue;
    let budget = eco.militaryIndustry(c) * mod(A, c, 'mil.production');
    for (let guard = 0; guard < 60 && budget > 0.01 && q.length; guard++) {
      let progressed = false;
      for (let qi = 0; qi < q.length && budget > 0.01; qi++) {
        const it = q[qi], t = UNITS[it.t];
        if (it.left <= 0) {
          if (!eco.canAfford(c, t.cost)) continue;
          const men = Math.ceil(t.men);
          const got = men > 0 ? eco.drawManpower(c, men) : 0;
          if (got < men) {
            if (got > 0) eco.returnManpower(c, got);
            continue;
          }
          if (!eco.charge(c, t.cost, 'mil.cost.production')) {
            eco.returnManpower(c, got);
            continue;
          }
          it.left = t.pts;
        }
        const work = Math.min(budget, it.left);
        it.left -= work;
        budget -= work;
        progressed = true;
        if (it.left <= 1e-6) {
          const fid = spawnFor(ctx, c, it);
          ctx.bus.emit({ type: 'mil.unitProduced', country: c, template: it.t, formation: fid });
          it.left = 0;
          if (--it.qty <= 0) {
            q.splice(qi, 1);
            qi--;
          }
        }
        break;
      }
      if (!progressed) break;
    }
  }
}

/** Keeps a simple balanced queue for automated countries (player automation `mil.production`). */
export function autoProduce(ctx: Ctx, A: Apis3, c: CountryId): void {
  const q = (S(ctx).queue[c] ??= []);
  if (q.length >= 3) return;
  const menu: UnitTemplateId[] = ['infantry', 'mech_infantry', 'armor', 'artillery', 'air_defense', 'fighter', 'logistics'];
  const ok = menu.filter((t) => !A.res || A.res.unlocked(c, `unit.${t}`));
  if (ok.length) enqueue(ctx, A, c, ctx.rng.pick(ok), 2);
}

export type { LonLat };
