/** Wartime decisions: front/goal choice, concentration, attack with local superiority, defence, retreat, strikes, peace, nukes. */
import type { CountryId, Ctx, FormationView, LonLat, WarView } from '../../core/contracts';
import { dipCommands } from '../diplomacy/index';
import { milCmd, type TargetRef } from '../military/index';
import type { AiState, Op } from './types';
import { bigCities, bigPlants, centroid, dist, landConnected, viewsOf, weight } from './util';

const DAY = 24;
const STRIKE_UNITS = new Set(['bomber', 'attack_heli', 'drone']);

function send(ctx: Ctx, s: AiState, cmd: ReturnType<(typeof milCmd)[keyof typeof milCmd]> | ReturnType<(typeof dipCommands)[keyof typeof dipCommands]>): boolean {
  s.stats.orders++;
  return ctx.dispatch(cmd as never).ok;
}

/** Formations not given a movement order in the last `days` (replanning paths is the most expensive thing the AI can do). */
function unordered(ctx: Ctx, s: AiState, fs: FormationView[], days = 4): FormationView[] {
  const now = ctx.state.time.hours;
  return fs.filter((f) => now - (s.ordered[f.id] ?? -1e9) >= days * DAY);
}
function stamp(ctx: Ctx, s: AiState, fs: FormationView[]): void {
  for (const f of fs) s.ordered[f.id] = ctx.state.time.hours;
}

/** Whether `city` is still held by someone at war with `c`. */
function heldByEnemy(ctx: Ctx, c: CountryId, ci: number): boolean {
  const pid = ctx.world.cities[ci].provinceId;
  if (!pid) return false;
  const ctl = ctx.api.worldDyn.controllerOf(pid);
  return ctl !== c && ctx.api.diplomacy.atWar(c, ctl);
}

function pickGoal(ctx: Ctx, s: AiState, c: CountryId, enemies: CountryId[], from: LonLat): number | null {
  const now = ctx.state.time.hours;
  const w = ctx.world;
  let best = -1, bs = 0;
  const consider = (ci: number, bonus: number) => {
    if ((s.bad[`${c}:${ci}`] ?? 0) > now || !heldByEnemy(ctx, c, ci)) return;
    const city = w.cities[ci];
    const d = dist(from, [city.lon, city.lat]);
    const sc = (bonus * (city.capital === 2 ? 3 : 1) * Math.sqrt(city.pop / 1e5 + 0.3)) / Math.pow(1 + d / 500, 2);
    if (sc > bs) (bs = sc), (best = ci);
  };
  for (const e of enemies) for (const ci of bigCities(ctx, e)) consider(ci, 1);
  for (const ci of bigCities(ctx, c)) consider(ci, 2.5); // reconquest first
  return best >= 0 ? best : null;
}

/** Strategic strikes with air wings and missiles against enemy infrastructure. */
function strikes(ctx: Ctx, s: AiState, c: CountryId, enemies: CountryId[], mine: FormationView[]): void {
  const w = ctx.world, wd = ctx.api.worldDyn;
  const targetsNear = (p: LonLat, rangeKm: number): TargetRef[] => {
    const out: { t: TargetRef; d: number }[] = [];
    for (const e of enemies) {
      for (const pi of bigPlants(ctx, e)) {
        const pl = w.plants[pi];
        if (pl.provinceId && wd.controllerOf(pl.provinceId) === e && wd.damageOf('plant', pi) < 0.7) {
          const d = dist(p, [pl.lon, pl.lat]);
          if (d < rangeKm) out.push({ t: { kind: 'plant', index: pi }, d });
        }
      }
    }
    return out.sort((a, b) => a.d - b.d).slice(0, 4).map((o) => o.t);
  };
  let n = 0;
  for (const f of mine) {
    if (n >= 2) break;
    if (f.domain !== 'air' || f.order !== 'idle' || f.strength < 0.5 || f.organization < 0.6 || !f.units.some((u) => STRIKE_UNITS.has(u.template))) continue;
    const tg = targetsNear(f.pos, 1300);
    if (!tg.length) continue;
    if (send(ctx, s, milCmd.strike(c, f.id, ctx.rng.pick(tg)))) (n++, s.stats.strikes++);
  }
  const cap = ctx.api.military.strikeCapability(c);
  const origin = w.countryById.get(c)!.capital;
  if (cap.cruiseMissiles > 2 && ctx.rng.chance(0.5)) {
    const tg = targetsNear([origin.lon, origin.lat], Math.max(300, cap.rangeKm));
    if (tg.length && send(ctx, s, milCmd.launch(c, 'cruise', ctx.rng.pick(tg)))) s.stats.launches++;
  }
}

function nuclear(ctx: Ctx, s: AiState, c: CountryId, enemies: CountryId[], enemyLand: FormationView[]): void {
  const cap = ctx.api.military.strikeCapability(c);
  if (cap.nukes <= 0) return;
  const now = ctx.state.time.hours;
  let victim: CountryId | null = null;
  const hit = s.nuked[c];
  if (hit && now - hit.at < 20 * DAY && enemies.includes(hit.by)) victim = hit.by; // retaliation only
  else if (ctx.state.meta.difficulty === 'hard') {
    const cp = ctx.world.countryById.get(c)!.capital;
    const close = enemyLand.filter((f) => dist(f.pos, [cp.lon, cp.lat]) < 150 && f.strength > 0.4).length;
    const war = ctx.api.diplomacy.wars().find((x) => x.attackers.includes(c) || x.defenders.includes(c));
    const side = war && war.attackers.includes(c) ? 'attackers' : 'defenders';
    if (close >= 3 && war && ctx.api.diplomacy.warScore(war.id, side) < -60) victim = war.attackerLeader === c ? war.defenderLeader : war.attackerLeader;
  }
  if (!victim) return;
  const ci = ctx.world.capitalCityOf(victim);
  if (ci !== null && send(ctx, s, milCmd.launch(c, 'nuke', { kind: 'city', index: ci }))) s.stats.launches++;
}

function peace(ctx: Ctx, s: AiState, c: CountryId, wars: WarView[]): void {
  const now = ctx.state.time.hours;
  if ((s.nextPeace[c] ?? 0) > now) return;
  s.nextPeace[c] = now + 10 * DAY;
  const d = ctx.api.diplomacy;
  for (const war of wars) {
    if (war.attackerLeader !== c && war.defenderLeader !== c) continue;
    const side = war.attackerLeader === c ? 'attackers' : 'defenders';
    const score = d.warScore(war.id, side);
    const days = (now - Math.max(war.startedHours, (s.seen[war.id] ??= now))) / DAY;
    if (score < -30 && days > 30) send(ctx, s, dipCommands.proposePeace(c, war.id, 'white'));
    else if (score > 40 && days > 60) send(ctx, s, dipCommands.proposePeace(c, war.id, 'annexOccupied'));
    else if (days > 270) send(ctx, s, dipCommands.proposePeace(c, war.id, 'white'));
  }
}

export function warThink(ctx: Ctx, s: AiState, c: CountryId, enemies: CountryId[]): void {
  const now = ctx.state.time.hours;
  s.stats.warThinks++;
  const mine = viewsOf(ctx, c);
  const land = mine.filter((f) => f.domain === 'land' && !f.rebel && !f.carriedBy);
  const enemyLand: FormationView[] = [];
  for (const e of enemies) for (const f of viewsOf(ctx, e)) if (f.domain === 'land' && !f.rebel && ctx.api.military.visibleTo(c, f.id)) enemyLand.push(f);
  const capInfo = ctx.world.countryById.get(c)!.capital;
  const capPos: LonLat = [capInfo.lon, capInfo.lat];

  // 1) Weak formations fall back to be reinforced.
  const weak = land.filter((f) => (f.strength < 0.3 || f.morale < 0.18) && now - (s.retreated[f.id] ?? -1e9) > 10 * DAY);
  if (weak.length) {
    for (const f of weak) s.retreated[f.id] = now;
    send(ctx, s, milCmd.retreat(c, weak.map((f) => f.id)));
  }
  const weakIds = new Set(weak.map((f) => f.id));
  let ready = land.filter((f) => !weakIds.has(f.id) && f.strength >= 0.35 && f.organization >= 0.35 && f.morale >= 0.2);

  // 2) Capital defence: nearest third hold the capital when an enemy approaches (or holds it).
  const capThreat = enemyLand.reduce((a, f) => (dist(f.pos, capPos) < 320 ? a + weight(f) : a), 0);
  const capLost = ctx.api.worldDyn.controllerOf(ctx.world.cities[ctx.world.capitalCityOf(c) ?? 0]?.provinceId ?? '') !== c;
  if (capThreat > 0 || capLost) {
    const near = [...ready].sort((a, b) => dist(a.pos, capPos) - dist(b.pos, capPos)).slice(0, Math.max(1, Math.ceil(ready.length * 0.3)));
    const go = unordered(ctx, s, near).filter((f) => dist(f.pos, capPos) > 40 && !(f.order === 'move' && f.destination && dist(f.destination, capPos) < 30));
    const stay = near.filter((f) => dist(f.pos, capPos) <= 40 && f.order === 'idle');
    if (go.length) (send(ctx, s, milCmd.move(c, go.map((f) => f.id), capPos, false)), stamp(ctx, s, go));
    if (stay.length) send(ctx, s, milCmd.defend(c, stay.map((f) => f.id)));
    const ids = new Set(near.map((f) => f.id));
    ready = ready.filter((f) => !ids.has(f.id));
  }

  // 3) Offensive operation (only against enemies reachable on foot; the rest is fought with air power and missiles).
  const reachable = enemies.filter((e) => landConnected(ctx, c, e));
  if (ready.length && reachable.length) offensive(ctx, s, c, reachable, ready, enemyLand);

  // 4) Air / missiles / nuclear, peace.
  strikes(ctx, s, c, enemies, mine);
  nuclear(ctx, s, c, enemies, enemyLand);
  peace(ctx, s, c, ctx.api.diplomacy.wars().filter((x) => x.attackers.includes(c) || x.defenders.includes(c)));
}

function offensive(ctx: Ctx, s: AiState, c: CountryId, enemies: CountryId[], ready: FormationView[], enemyLand: FormationView[]): void {
  const now = ctx.state.time.hours;
  const w = ctx.world;
  let op: Op | undefined = s.op[c];
  if (op && (!heldByEnemy(ctx, c, op.ci) || now - op.since > (op.mode === 'attack' ? 35 : 15) * DAY)) {
    if (heldByEnemy(ctx, c, op.ci)) s.bad[`${c}:${op.ci}`] = now + 60 * DAY; // timed out: probably unreachable
    delete s.op[c];
    op = undefined;
  }
  if (!op) {
    const ci = pickGoal(ctx, s, c, enemies, centroid(ready));
    if (ci === null) return;
    const goalPos: LonLat = [w.cities[ci].lon, w.cities[ci].lat];
    const front = [...ready].sort((a, b) => dist(a.pos, goalPos) - dist(b.pos, goalPos)).slice(0, Math.max(1, Math.ceil(ready.length / 2)));
    const cen = centroid(front);
    const rally = front.reduce((b, f) => (dist(f.pos, cen) < dist(b.pos, cen) ? f : b)).pos;
    op = s.op[c] = { ci, rally: [rally[0], rally[1]], mode: 'gather', since: now };
  }
  const goal: LonLat = [w.cities[op.ci].lon, w.cities[op.ci].lat];
  const nearRally = ready.filter((f) => dist(f.pos, op!.rally) < 130);
  const mine = ready.reduce((a, f) => a + weight(f), 0);
  const foe = enemyLand.reduce((a, f) => (dist(f.pos, goal) < 380 ? a + weight(f) : a), 0) + 0.4 + w.cities[op.ci].pop / 3e6;

  if (op.mode === 'gather') {
    const gathered = nearRally.length >= Math.ceil(ready.length * 0.6) || now - op.since > 10 * DAY;
    if (gathered && mine >= 1.1 * foe) (op.mode = 'attack'), (op.since = now);
    else {
      const far = unordered(ctx, s, ready).filter((f) => dist(f.pos, op!.rally) >= 130 && !(f.order === 'move' && f.destination && dist(f.destination, op!.rally) < 40));
      if (far.length) (send(ctx, s, milCmd.move(c, far.map((f) => f.id), op.rally, false)), stamp(ctx, s, far));
      const hold = nearRally.filter((f) => f.order === 'idle');
      if (hold.length) send(ctx, s, milCmd.defend(c, hold.map((f) => f.id)));
      return;
    }
  } else if (mine < 0.6 * foe) {
    // Outgunned locally: pull back to the rally point and regroup.
    op.mode = 'gather';
    op.since = now;
    const cen = centroid(ready);
    const rally = ready.reduce((b, f) => (dist(f.pos, cen) < dist(b.pos, cen) ? f : b)).pos;
    op.rally = [rally[0], rally[1]];
    return;
  }
  const go = unordered(ctx, s, ready).filter((f) => f.battleId === null && !(f.order === 'move' && f.destination && dist(f.destination, goal) < 40));
  if (go.length) stamp(ctx, s, go);
  if (go.length && !send(ctx, s, milCmd.move(c, go.map((f) => f.id), goal, true))) {
    s.bad[`${c}:${op.ci}`] = now + 60 * DAY;
    delete s.op[c];
  }
}
