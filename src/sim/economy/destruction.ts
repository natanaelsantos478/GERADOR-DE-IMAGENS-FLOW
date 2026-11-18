/**
 * Strategic consequences of buildings destroyed in a tactical battle (`tac.buildingDestroyed`).
 * Events are only ACCUMULATED (O(1), per battle) and applied once when the battle ends (`tac.battleEnded`)
 * or, as a safety net for battles that never report an end, when the aggregate has been idle for 3 days.
 *  - territory owner: satisfaction (city damage + provincial unrest), rebuild cost, temporary production drag, displaced people;
 *  - attacker: world opinion (`diplomacy.rep`) and a light war-weariness bump;
 *  - recovery: a `Ruin` record repairs the city damage and pays the rebuild bill daily for months;
 *  - news: "Hospital destruído em <cidade>" and a summary line.
 * Pure JSON state (`economy.tacAgg`, `economy.ruins`), no randomness: save/load identical.
 */
import type { CountryId, Ctx, ProvinceId } from '../../core/contracts';
import { addRep } from '../diplomacy/relations';
import type { CountryEco, EconomyState, Ruin, TacAgg } from './types';
import { clamp, isSandboxPlayer, sys } from './util';

const UPFRONT = 0.3;
const PROT_KIND_KEY: Record<string, string> = { hospital: 'hospital', school: 'school', religious: 'religious' };

/** Rebuild cost in M USD of one destroyed building. */
export const rebuildCost = (floors: number, prot: boolean): number => 0.2 * (1 + floors) * (prot ? 3 : 1);

function aggOf(ctx: Ctx, battleId: string): TacAgg | null {
  const s: EconomyState = ctx.state.economy;
  const old = s.tacAgg?.[battleId];
  if (old) return old;
  const bv = sys(ctx, 'military')?.battle(battleId);
  if (!bv) return null;
  const a: TacAgg = {
    pr: bv.province, pos: bv.pos, sides: [bv.attackerCountries.slice(), bv.defenderCountries.slice()],
    n: 0, civ: 0, prot: 0, nProt: 0, floors: 0, cost: 0, w: [0, 0], wp: [0, 0], np: [0, 0], kinds: {}, last: ctx.state.time.hours,
  };
  (s.tacAgg ??= {})[battleId] = a;
  return a;
}

/** O(1) per destroyed building. */
export function onBuildingDestroyed(ctx: Ctx, e: { battleId: string; kind: string; floors: number; civil: boolean; prot: boolean; weight: number; side: 0 | 1 | -1 }): void {
  const a = aggOf(ctx, e.battleId);
  if (!a) return;
  a.n++;
  a.cost += rebuildCost(e.floors, e.prot);
  a.last = ctx.state.time.hours;
  if (!e.civil) return;
  a.civ += e.weight;
  a.floors += e.floors;
  if (e.prot) { a.prot += e.weight; a.nProt++; a.kinds[e.kind] = (a.kinds[e.kind] ?? 0) + 1; }
  if (e.side === 0 || e.side === 1) {
    a.w[e.side] += e.weight;
    if (e.prot) { a.wp[e.side] += e.weight; a.np[e.side]++; }
  }
}

function nearestCity(ctx: Ctx, pr: ProvinceId | null, pos: [number, number]): number {
  if (!pr) return -1;
  let best = -1, bd = Infinity;
  for (const i of ctx.world.citiesByProvince.get(pr) ?? []) {
    const c = ctx.world.cities[i];
    const d = (c.lon - pos[0]) ** 2 + (c.lat - pos[1]) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

/** Applies (and removes) the aggregate of one battle. */
export function flushBattle(ctx: Ctx, battleId: string): void {
  const s = ctx.state.economy;
  const a = s.tacAgg?.[battleId];
  if (!a) return;
  delete s.tacAgg![battleId];
  if (a.n === 0) return;
  const owner: CountryId | undefined = a.pr ? ctx.api.worldDyn.controllerOf(a.pr) : undefined;
  const eo: CountryEco | undefined = owner ? s.c[owner] : undefined;
  const city = nearestCity(ctx, a.pr, a.pos);
  const cityName = city >= 0 ? ctx.world.cities[city].name : a.pr ? ctx.world.provinceById.get(a.pr)?.name ?? a.pr : '?';
  const attackers = [...new Set<CountryId>([...(a.w[0] > 0 ? a.sides[0] : []), ...(a.w[1] > 0 ? a.sides[1] : [])])];

  if (owner && eo) {
    // --- territory owner
    const cityDmg = clamp(0.002 * a.civ + 0.004 * a.prot, 0, 0.3);
    if (city >= 0 && cityDmg > 0.0005) ctx.api.worldDyn.damage('city', city, cityDmg, 'tac.buildings');
    const unrest = clamp(0.05 * a.civ + 0.15 * a.prot, 0, 15);
    const days = Math.round(60 + Math.min(120, a.civ * 0.8));
    if (unrest > 0.05 && a.pr) ctx.api.economy.addUnrest({ province: a.pr }, unrest, 'eco.cause.buildingsLost', days);
    const displaced = a.floors * 10;
    if (displaced > 0) {
      eo.pop = Math.max(1, eo.pop - displaced * 0.25);
      if (a.n >= 12 && a.pr) ctx.api.economy.addUnrest({ province: a.pr }, clamp(displaced / 2000, 0, 6), 'eco.cause.refugees', days);
    }
    const upfront = a.cost * UPFRONT;
    if (!isSandboxPlayer(ctx, owner)) eo.treasury -= upfront;
    const rest = a.cost - upfront;
    const rd = days + 30;
    s.nextRuin = (s.nextRuin ?? 1) + 1;
    (s.ruins ??= []).push({
      id: s.nextRuin - 1, country: owner, province: a.pr ?? '', city, dmg: cityDmg, perDay: cityDmg / rd,
      pay: rest / rd, daysLeft: rd, days: rd, drag: clamp(a.civ * 0.00004, 0, 0.03),
    });
    if (s.ruins.length > 200) s.ruins.splice(0, s.ruins.length - 200);
  }

  // --- attacker: world opinion + domestic fatigue
  for (const side of [0, 1] as const) {
    if (a.w[side] <= 0) continue;
    const own = owner !== undefined && a.sides[side].includes(owner);
    const d = Math.min(25, 0.04 * a.w[side] + 0.25 * a.wp[side] + 0.8 * a.np[side]) * (own ? 0.5 : 1);
    for (const c of a.sides[side]) {
      if (d > 0.01) addRep(ctx, c, -d);
      const e = s.c[c];
      if (e) e.warWeary = Math.min(60, e.warWeary + Math.min(3, a.w[side] * 0.01));
    }
  }

  // --- news
  const involved = [...new Set<CountryId>([...(owner ? [owner] : []), ...attackers])];
  const player = ctx.state.meta.playerCountryId;
  const where = a.pr ? { province: a.pr } : { lon: a.pos[0], lat: a.pos[1] };
  const imp = (involved.includes(player) ? 2 : 1) as 1 | 2;
  const top = Object.entries(a.kinds).sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))[0];
  if (top && PROT_KIND_KEY[top[0]]) ctx.news('military', `eco.news.protDestroyed.${PROT_KIND_KEY[top[0]]}`, { city: cityName, n: a.nProt }, where, { countries: involved, importance: imp });
  else if (a.n >= 5) ctx.news('military', 'eco.news.buildingsDestroyed', { city: cityName, n: a.n }, where, { countries: involved, importance: involved.includes(player) ? 1 : 0 });
}

/** Daily: recovery of ruins (repairs paid from the treasury) and stale aggregates. */
export function dailyRuins(ctx: Ctx): void {
  const s = ctx.state.economy;
  if (s.tacAgg) {
    const now = ctx.state.time.hours;
    for (const id of Object.keys(s.tacAgg)) if (now - s.tacAgg[id].last > 72) flushBattle(ctx, id);
  }
  if (!s.ruins?.length) return;
  const keep: Ruin[] = [];
  for (const r of s.ruins) {
    const e = s.c[r.country];
    const sandbox = isSandboxPlayer(ctx, r.country);
    if (e && (sandbox || e.treasury >= r.pay)) {
      if (!sandbox) e.treasury -= r.pay;
      if (r.city >= 0) ctx.api.worldDyn.repair('city', r.city, r.perDay);
      r.daysLeft--;
    }
    if (r.daysLeft > 0 && e) keep.push(r);
  }
  s.ruins = keep;
}

/** Fraction (0..~0.03) of production a country loses to ruins still being rebuilt; fades as they are repaired. */
export function ruinDrag(ctx: Ctx, c: CountryId): number {
  const rs = ctx.state.economy.ruins;
  if (!rs?.length) return 0;
  let d = 0;
  for (const r of rs) if (r.country === c) d += r.drag * (r.daysLeft / r.days);
  return Math.min(0.1, d);
}
