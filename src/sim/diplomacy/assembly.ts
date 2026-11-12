/** World assembly (sanction votes) and the diplomatic reaction to nuclear use. */
import type { Command, CommandResult, CountryId, Ctx, TextKey } from '../../core/contracts';
import { fail } from './actions';
import { DAY, YEAR, addRep, allied, atWar, isLive, modRelation, relation, sharedBlocs, st, optApi } from './relations';

const P5: readonly CountryId[] = ['USA', 'RUS', 'CHN', 'GBR', 'FRA'];

/** Opens a vote against `target`, proposed by the best-placed country (or `proposer`). Returns false if not possible. */
export function proposeSanction(ctx: Ctx, target: CountryId, victimOrProposer: CountryId, reason: TextKey): boolean {
  const s = st(ctx);
  const now = ctx.state.time.hours;
  if (s.vote || s.voteCooldown > now) return false;
  if ((s.sanctions[target] ?? 0) > now || !isLive(ctx, target)) return false;
  const proposer = victimOrProposer;
  if (proposer === target) return false;
  s.vote = { id: s.nextId++, target, proposer, reason, endsHours: now + 14 * DAY };
  s.voteCooldown = now + 60 * DAY;
  ctx.news('diplomacy', 'dip.news.voteOpened', { target, proposer }, { country: target }, {
    countries: [target, proposer], importance: target === ctx.state.meta.playerCountryId ? 2 : 1,
  });
  return true;
}

export function proposeSanctionCmd(ctx: Ctx, cmd: Command): CommandResult {
  const target = String(cmd.target ?? '');
  if (!ctx.world.countryById.has(target) || target === cmd.country) return fail('dip.err.unknownCountry');
  const s = st(ctx);
  if (s.vote) return fail('dip.err.voteOpen');
  if (s.voteCooldown > ctx.state.time.hours) return fail('dip.err.cooldown');
  if (allied(ctx, cmd.country, target)) return fail('dip.err.allied');
  if (!proposeSanction(ctx, target, cmd.country, 'dip.vote.proposed')) return fail('dip.err.cantSanction');
  modRelation(ctx, cmd.country, target, -20, 'dip.cause.sanctionProposed');
  return { ok: true };
}

export function voteCmd(ctx: Ctx, cmd: Command): CommandResult {
  const v = st(ctx).vote;
  if (!v) return fail('dip.err.noVote');
  if (cmd.country !== ctx.state.meta.playerCountryId) return fail('dip.err.notPlayer');
  v.player = cmd.yes === true;
  return { ok: true };
}

/** Deterministic ballot of an AI country: +1 yes, −1 no, 0 abstain. */
export function ballot(ctx: Ctx, c: CountryId, target: CountryId, proposer: CountryId): number {
  if (c === target) return -1;
  if (c === proposer) return 1;
  let s = -relation(ctx, c, target) * 0.6 + relation(ctx, c, proposer) * 0.4;
  if (allied(ctx, c, target)) s -= 60;
  if (sharedBlocs(ctx, c, target).economic) s -= 10;
  return s > 5 ? 1 : s < -5 ? -1 : 0;
}

export function closeVote(ctx: Ctx): void {
  const s = st(ctx);
  const v = s.vote;
  if (!v || v.endsHours > ctx.state.time.hours) return;
  s.vote = null;
  let yes = 0, no = 0;
  const player = ctx.state.meta.playerCountryId;
  for (const c of ctx.api.worldDyn.aliveCountries()) {
    if (!ctx.world.countryById.get(c)?.sovereign) continue;
    const b = c === player ? (v.player === undefined ? 0 : v.player ? 1 : -1) : ballot(ctx, c, v.target, v.proposer);
    if (b > 0) yes++;
    else if (b < 0) no++;
  }
  const vetoBy = P5.find((p) => p !== v.proposer && isLive(ctx, p) && p !== undefined && (allied(ctx, p, v.target) || relation(ctx, p, v.target) > 30));
  const passed = !vetoBy && yes > no && yes >= 20;
  ctx.news('diplomacy', passed ? 'dip.news.sanctionPassed' : vetoBy ? 'dip.news.sanctionVetoed' : 'dip.news.sanctionFailed', { target: v.target, yes, no, veto: vetoBy ?? '' }, { country: v.target }, {
    countries: [v.target, v.proposer], importance: v.target === player ? 2 : 1,
  });
  if (!passed) return;
  const until = ctx.state.time.hours + 2 * YEAR;
  s.sanctions[v.target] = until;
  addRep(ctx, v.target, -8);
  optApi(ctx, 'research')?.addModifier(v.target, 'eco.trade', 0.75, until, 'dip.sanction');
  ctx.bus.emit({ type: 'dip.sanctioned', country: v.target, until });
}

/** Called for any `mil.*` event that reports a nuclear detonation. */
export function onNuclearUse(ctx: Ctx, user: CountryId, victim?: CountryId): void {
  const s = st(ctx);
  const now = ctx.state.time.hours;
  const last = s.nukeUse[user];
  s.nukeUse[user] = now;
  if (last !== undefined && now - last < 6) return; // one reaction per salvo
  addRep(ctx, user, -35);
  const until = now + 3 * YEAR;
  optApi(ctx, 'research')?.addModifier(user, 'eco.trade', 0.7, until, 'dip.nukeStigma');
  if (victim && victim !== user) modRelation(ctx, user, victim, -60, 'dip.cause.nuked');
  // Allies of the victim and every defense bloc turn on the user.
  if (victim) {
    for (const c of ctx.api.worldDyn.aliveCountries()) {
      if (c !== user && c !== victim && allied(ctx, c, victim) && !atWar(ctx, c, user)) modRelation(ctx, c, user, -30, 'dip.cause.nukeUse');
    }
  }
  ctx.news('diplomacy', 'dip.news.nuclearUse', { country: user, victim: victim ?? '' }, victim ? { country: victim } : { country: user }, {
    countries: victim ? [user, victim] : [user], importance: 2,
  });
  s.voteCooldown = 0;
  proposeSanction(ctx, user, victim && victim !== user ? victim : pickProposer(ctx, user), 'dip.vote.nuclear');
}

function pickProposer(ctx: Ctx, target: CountryId): CountryId {
  let best = '';
  let bs = -Infinity;
  for (const c of ctx.api.worldDyn.aliveCountries()) {
    if (c === target || !ctx.world.countryById.get(c)?.sovereign || allied(ctx, c, target)) continue;
    const r = relation(ctx, c, target);
    if (r > -100 && -r > bs) { bs = -r; best = c; }
  }
  return best || target;
}
