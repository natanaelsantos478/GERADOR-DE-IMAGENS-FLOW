/** Background diplomacy of AI countries: treaties, rare wars (difficulty-aware), peace-making. Sliced in time. */
import type { CountryId, Ctx } from '../../core/contracts';
import { evaluate, execute, type ActionId } from './actions';
import { casusBelliOptions, declareWar, proposePeace } from './wars';
import {
  DAY, allied, atWar, flagOn, isLive, modRelation, nukes, power, relation, rivalries, rivalryLevel, st, warsOf, clamp,
} from './relations';

const THINK_PER_DAY = 9;
const MAX_WORLD_WARS = 10;

function rollTreaty(ctx: Ctx, c: CountryId, to: CountryId, action: ActionId, minScore: number): void {
  const ev = evaluate(ctx, action, c, to);
  if (ev.blocked || ev.score < minScore) return;
  execute(ctx, { type: 'dip.auto', country: c, target: to }, action);
}

function think(ctx: Ctx, c: CountryId): void {
  const player = ctx.state.meta.playerCountryId;
  const diff = ctx.state.meta.difficulty;
  const info = ctx.world.countryById.get(c)!;
  const near = info.neighbors.filter((n) => isLive(ctx, n));

  // Friendly diplomacy with a neighbour or bloc partner.
  if (near.length && ctx.rng.chance(0.5)) {
    const to = ctx.rng.pick(near);
    if (!atWar(ctx, c, to)) {
      const rel = relation(ctx, c, to);
      if (rel > 15 && !flagOn(ctx, c, to, 'trade')) rollTreaty(ctx, c, to, 'trade', to === player ? 25 : 12);
      else if (rel > 35 && ctx.rng.chance(0.15)) rollTreaty(ctx, c, to, 'nap', to === player ? 20 : 10);
      else if (rel < 30 && rel > -10) modRelation(ctx, c, to, 2, 'dip.cause.contacts');
    }
  }

  // Opportunistic war: only rivals / hostile neighbours, one war at a time, global cap.
  if (warsOf(ctx, c).length > 0 || st(ctx).wars.length >= MAX_WORLD_WARS) return;
  const hostile = near.filter((n) => rivalryLevel(ctx, c, n) > 0 || relation(ctx, c, n) < -35);
  for (const rv of rivalries(ctx).get(c) ?? []) if (isLive(ctx, rv) && !hostile.includes(rv) && ctx.rng.chance(0.15)) hostile.push(rv);
  if (!hostile.length) return;
  const target = ctx.rng.pick(hostile);
  if (atWar(ctx, c, target) || allied(ctx, c, target) || flagOn(ctx, c, target, 'truce') || flagOn(ctx, c, target, 'nap')) return;
  if (target === player) {
    if (diff === 'sandbox') return;
  }
  const lvl = rivalryLevel(ctx, c, target);
  const ratio = power(ctx, c) / Math.max(0.1, power(ctx, target));
  if (nukes(ctx, target) > 0) return; // deterrence: nobody attacks a nuclear power at will
  const need = lvl >= 3 ? 0.9 : target === player && diff === 'hard' ? 1.5 : 1.3;
  if (ratio < need) return;
  let p = 0.0055 * (1 + lvl);
  if (target === player) p = diff === 'hard' ? 0.006 : 0.02;
  if (!ctx.rng.chance(p)) return;
  const best = casusBelliOptions(ctx, c, target)[0];
  if (best.strength < (target === player && diff === 'normal' ? 3 : 1)) return;
  declareWar(ctx, { type: 'dip.declareWar', country: c, target });
}

function dailyPeace(ctx: Ctx): void {
  const now = ctx.state.time.hours;
  for (const w of st(ctx).wars.slice()) {
    const days = (now - w.startedHours) / DAY;
    for (const side of ['attackers', 'defenders'] as const) {
      const view = side === 'attackers' ? w.score : -w.score;
      const p = clamp((days - 120) / 400000, 0, 0.0008) * (view > 25 ? 0.2 : 1) + (view < -35 ? 0.01 : 0);
      const leader = side === 'attackers' ? w.attackerLeader : w.defenderLeader;
      if (leader === ctx.state.meta.playerCountryId && ctx.state.meta.automation['ai.controlsPlayer'] !== true) continue;
      if (!ctx.rng.chance(p)) continue;
      proposePeace(ctx, { type: 'dip.proposePeace', country: leader, war: w.id, terms: view > 50 ? 'annexOccupied' : 'white' });
      if (!st(ctx).wars.includes(w)) break;
    }
  }
}

export function directorDay(ctx: Ctx): void {
  dailyPeace(ctx);
  const alive = ctx.api.worldDyn.aliveCountries().filter((c) => ctx.world.countryById.get(c)?.sovereign);
  if (!alive.length) return;
  const day = Math.floor(ctx.state.time.hours / 24);
  const player = ctx.state.meta.playerCountryId;
  for (let k = 0; k < THINK_PER_DAY; k++) {
    const c = alive[(day * THINK_PER_DAY + k) % alive.length];
    if (c === player && ctx.state.meta.automation['ai.controlsPlayer'] !== true) continue;
    think(ctx, c);
  }
}
