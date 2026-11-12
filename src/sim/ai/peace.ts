/** Peacetime / background decisions: proportional military production, border garrisons, answering proposals. */
import type { CountryId, Ctx, FormationView, LonLat } from '../../core/contracts';
import { selectProposals, dipCommands } from '../diplomacy/index';
import { UNITS, milCmd, productionQueue, unitCatalog } from '../military/index';
import type { AiState } from './types';
import { bigCities, dist, hash, viewsOf } from './util';

const DAY = 24;
const MIX_WAR: Record<string, number> = { infantry: 3, mech_infantry: 2, armor: 2, artillery: 2, air_defense: 1, mlrs: 1, fighter: 1, bomber: 0.5, attack_heli: 0.5, drone: 0.7 };
const MIX_PEACE: Record<string, number> = { infantry: 2, mech_infantry: 1.5, armor: 1.5, artillery: 1, air_defense: 1, fighter: 1, logistics: 0.5 };

/** Sum of the military power of hostile-ish land neighbours. */
function neighbourThreat(ctx: Ctx, c: CountryId): number {
  const d = ctx.api.diplomacy, wd = ctx.api.worldDyn;
  let t = 0;
  for (const n of ctx.world.countryById.get(c)!.neighbors) {
    if (!wd.isAlive(n) || d.allied(c, n)) continue;
    const rel = d.relation(c, n);
    if (rel < -10 || d.atWar(c, n)) t += ctx.api.military.power(n) * (rel < -40 ? 1 : 0.5);
  }
  return t;
}

export function production(ctx: Ctx, s: AiState, c: CountryId, atWar: boolean): void {
  const eco = ctx.api.economy;
  const ind = eco.militaryIndustry(c);
  if (!(ind > 0)) return;
  const queue = productionQueue(ctx, c);
  let pts = 0;
  for (const q of queue) pts += (UNITS[q.t].pts * q.qty) - (q.left > 0 ? UNITS[q.t].pts - q.left : 0);
  if (pts > ind * (atWar ? 22 : 12) || queue.length >= 5) return;
  const own = ctx.api.military.power(c);
  const threat = neighbourThreat(ctx, c);
  if (!atWar && own > 1.5 * threat + 2 && ctx.rng.next() > 0.12) return; // enough for peacetime
  if (eco.treasury(c) < 200 && !atWar) return;
  const mix = atWar ? MIX_WAR : MIX_PEACE;
  const opts = unitCatalog(ctx, c).filter((u) => u.available && mix[u.id]);
  if (!opts.length) return;
  const i = ctx.rng.weightedIndex(opts.map((u) => mix[u.id]));
  const u = opts[Math.max(0, i)];
  if (!eco.canAfford(c, { money: (u.cost.money ?? 0) * 3 })) return;
  if (ctx.dispatch(milCmd.produce(c, u.id, atWar ? 2 : 1)).ok) s.stats.produced++;
}

/** Keeps a few formations on the border facing the most threatening neighbour. */
export function garrison(ctx: Ctx, s: AiState, c: CountryId): void {
  const now = ctx.state.time.hours;
  if ((s.nextGarrison[c] ?? 0) > now) return;
  s.nextGarrison[c] = now + 90 * DAY + (hash(c) % 30) * DAY;
  const d = ctx.api.diplomacy;
  let rival: CountryId | null = null, worst = -35;
  for (const n of ctx.world.countryById.get(c)!.neighbors) {
    if (!ctx.api.worldDyn.isAlive(n) || d.allied(c, n)) continue;
    const rel = d.relation(c, n);
    if (rel < worst) (worst = rel), (rival = n);
  }
  if (!rival) return;
  const rc = ctx.world.countryById.get(rival)!.capital;
  const cities = bigCities(ctx, c).filter((ci) => ctx.api.worldDyn.controllerOf(ctx.world.cities[ci].provinceId ?? '') === c);
  if (!cities.length) return;
  let spot: LonLat | null = null, bd = Infinity;
  for (const ci of cities) {
    const k = ctx.world.cities[ci], dd = dist([k.lon, k.lat], [rc.lon, rc.lat]);
    if (dd < bd) (bd = dd), (spot = [k.lon, k.lat]);
  }
  if (!spot) return;
  const land = viewsOf(ctx, c).filter((f) => f.domain === 'land' && !f.rebel && f.order === 'idle' && f.strength > 0.5 && now - (s.ordered[f.id] ?? -1e9) > 30 * DAY);
  const want = Math.min(4, Math.max(1, Math.round((worst < -60 ? 0.25 : 0.12) * viewsOf(ctx, c).length)));
  const here = land.filter((f) => dist(f.pos, spot!) < 120).length;
  if (here >= want) return;
  const pick: FormationView[] = land.filter((f) => dist(f.pos, spot!) >= 120).sort((a, b) => dist(a.pos, spot!) - dist(b.pos, spot!)).slice(0, want - here);
  if (pick.length) {
    for (const f of pick) s.ordered[f.id] = now;
    ctx.dispatch(milCmd.move(c, pick.map((f) => f.id), spot, false));
    s.stats.orders++;
  }
}

/** When the AI runs the player's country it must answer the inbox. */
export function answerProposals(ctx: Ctx, c: CountryId): void {
  const d = ctx.api.diplomacy;
  for (const p of selectProposals(ctx, c)) {
    const rel = d.relation(c, p.from);
    const kind = String(p.kind);
    const ok = !d.atWar(c, p.from) && (kind.includes('alliance') ? rel > 25 : rel > -15);
    ctx.dispatch(dipCommands.respond(c, p.id, ok));
  }
}
