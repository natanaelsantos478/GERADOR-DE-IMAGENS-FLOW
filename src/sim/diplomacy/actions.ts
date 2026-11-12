/** Bilateral actions: transparent acceptance functions (ActionEval) and the execution of each `dip.*` action. */
import type { Command, CommandResult, CountryId, Ctx, TextKey } from '../../core/contracts';
import {
  DAY, YEAR, addRep, atWar, allied, clearFlag, flagOn, getPair, isLive, modRelation, monthlyGdp, nukes, onCooldown, power, puppetLink,
  relation, rep, rivalryLevel, setCooldown, setFlag, sharedBlocs, st, optApi, treasury, warsOf, clamp,
} from './relations';
import type { ActionEval, Proposal, ProposalKind } from './types';

export const fail = (reason: string, params?: Record<string, string | number | boolean>): CommandResult => ({ ok: false, reason, ...(params ? { params } : {}) });
const chanceOf = (score: number) => clamp(0.5 + score / 60, 0.02, 0.97);

export type ActionId = 'improve' | 'trade' | 'nap' | 'access' | 'alliance' | 'guarantee' | 'embargo' | 'tribute' | 'territory' | 'rebels';
export const ACTION_COMMAND: Record<ActionId, string> = {
  improve: 'dip.improveRelations', trade: 'dip.proposeTrade', nap: 'dip.proposeNap', access: 'dip.requestAccess', alliance: 'dip.proposeAlliance',
  guarantee: 'dip.guarantee', embargo: 'dip.embargo', tribute: 'dip.demand', territory: 'dip.demand', rebels: 'dip.supportRebels',
};
const ACTION_COOLDOWN: Record<ActionId, number> = { improve: 45, trade: 60, nap: 90, access: 60, alliance: 180, guarantee: 90, embargo: 0, tribute: 120, territory: 180, rebels: 60 };
const TREATY_KIND: Partial<Record<ActionId, ProposalKind>> = { trade: 'trade', nap: 'nap', access: 'access', alliance: 'alliance', guarantee: 'guarantee' };

type Factors = ActionEval['factors'];
const f = (list: Factors, key: TextKey, value: number) => {
  if (Math.abs(value) >= 0.05) list.push({ key, value: Math.round(value * 10) / 10 });
};

function costOf(ctx: Ctx, action: ActionId, from: CountryId): number {
  const g = monthlyGdp(ctx, from);
  if (action === 'improve') return Math.round(clamp(g * 0.0003, 1, 150));
  if (action === 'rebels') return Math.round(clamp(g * 0.002, 5, 800));
  return 0;
}

/** Power ratio from/to, with nuclear deterrence counted in favour of the nuclear side. */
function ratio(ctx: Ctx, a: CountryId, b: CountryId): number {
  const nA = nukes(ctx, a) > 0 ? 3 : 1;
  const nB = nukes(ctx, b) > 0 ? 3 : 1;
  return (power(ctx, a) * nA) / Math.max(0.1, power(ctx, b) * nB);
}

export function evaluate(ctx: Ctx, action: ActionId, from: CountryId, to: CountryId, params: { province?: string } = {}): ActionEval {
  const ev: ActionEval = { action, command: ACTION_COMMAND[action], chance: 1, score: 0, factors: [], cost: costOf(ctx, action, from) };
  const block = (key: TextKey, p?: Record<string, string | number>) => {
    ev.blocked = key;
    if (p) ev.blockedParams = p;
    ev.chance = 0;
    return ev;
  };
  if (from === to) return block('dip.err.self');
  if (!isLive(ctx, from)) return block('dip.err.dead');
  if (!isLive(ctx, to)) return block('dip.err.targetDead');
  const sc = ev.factors;
  const rel = relation(ctx, from, to);
  const war = atWar(ctx, from, to);
  const wd = ctx.api.worldDyn;
  const treaty = TREATY_KIND[action];

  if (action !== 'embargo' && action !== 'rebels' && war) return block('dip.err.atWar');
  if (onCooldown(ctx, from, to, action)) return block('dip.err.cooldown');
  if (ev.cost > 0) {
    const t = treasury(ctx, from);
    if (t !== null && t < ev.cost && !(ctx.state.meta.difficulty === 'sandbox' && from === ctx.state.meta.playerCountryId)) return block('dip.err.noMoney', { cost: ev.cost });
  }
  if (wd.overlordOf(from) === to) return block('dip.err.overlord');
  if (treaty === 'trade' && flagOn(ctx, from, to, 'trade')) return block('dip.err.already');
  if (action === 'trade' && flagOn(ctx, from, to, `emb.${to}`)) return block('dip.err.embargoed');
  if (action === 'trade' && flagOn(ctx, from, to, `emb.${from}`)) return block('dip.err.embargoing');
  if (action === 'nap' && flagOn(ctx, from, to, 'nap')) return block('dip.err.already');
  if (action === 'access' && (allied(ctx, from, to) || flagOn(ctx, from, to, `acc.${from}`))) return block('dip.err.already');
  if (action === 'alliance') {
    if (allied(ctx, from, to)) return block('dip.err.already');
    if (rel < 30) return block('dip.err.relationTooLow', { need: 30 });
  }
  if (action === 'guarantee' && flagOn(ctx, from, to, `guar.${from}`)) return block('dip.err.already');
  if (action === 'embargo' && flagOn(ctx, from, to, `emb.${from}`)) return block('dip.err.already');
  if ((action === 'embargo' || action === 'rebels' || action === 'tribute' || action === 'territory') && allied(ctx, from, to)) return block('dip.err.allied');
  if (action === 'territory') {
    const prov = params.province ? ctx.world.provinceById.get(params.province) : undefined;
    if (!prov || wd.ownerOf(prov.id) !== to) return block('dip.err.badProvince');
    const touches = prov.neighbors.some((n) => wd.ownerOf(n) === from);
    if (!touches) return block('dip.err.notAdjacent');
  }

  const rivalry = rivalryLevel(ctx, from, to);
  const bl = sharedBlocs(ctx, from, to);
  const r = ratio(ctx, from, to);
  switch (action) {
    case 'improve':
      ev.chance = 1;
      f(sc, 'dip.f.relation', rel);
      break;
    case 'trade':
      f(sc, 'dip.f.relation', rel * 0.6);
      f(sc, 'dip.f.base', 10);
      f(sc, 'dip.f.bloc', bl.economic ? 12 : bl.other * 4);
      f(sc, 'dip.f.rivalry', -rivalry * 12);
      f(sc, 'dip.f.reputation', rep(ctx, from) * 0.15);
      break;
    case 'nap':
      f(sc, 'dip.f.relation', rel * 0.5);
      f(sc, 'dip.f.base', -5);
      f(sc, 'dip.f.rivalry', -rivalry * 10);
      f(sc, 'dip.f.reputation', rep(ctx, from) * 0.15);
      break;
    case 'access':
      f(sc, 'dip.f.relation', rel * 0.7);
      f(sc, 'dip.f.base', -20);
      f(sc, 'dip.f.bloc', bl.other * 5);
      f(sc, 'dip.f.rivalry', -rivalry * 20);
      break;
    case 'alliance': {
      f(sc, 'dip.f.relation', rel * 0.8);
      f(sc, 'dip.f.base', -35);
      f(sc, 'dip.f.bloc', bl.other * 6);
      const sharedEnemies = enemiesInCommon(ctx, from, to);
      f(sc, 'dip.f.commonEnemies', sharedEnemies * 15);
      f(sc, 'dip.f.rivalry', -rivalry * 25);
      break;
    }
    case 'guarantee':
      f(sc, 'dip.f.base', 15);
      f(sc, 'dip.f.relation', rel * 0.3);
      f(sc, 'dip.f.rivalry', -rivalry * 20);
      break;
    case 'embargo':
    case 'rebels':
      ev.chance = 1;
      f(sc, 'dip.f.relation', rel);
      break;
    case 'tribute':
      f(sc, 'dip.f.power', (r - 1.5) * 25);
      f(sc, 'dip.f.relation', rel * 0.1);
      f(sc, 'dip.f.base', -20);
      f(sc, 'dip.f.atWar', warsOf(ctx, to).length * 8);
      break;
    case 'territory':
      f(sc, 'dip.f.power', (r - 3) * 25);
      f(sc, 'dip.f.relation', rel * 0.1);
      f(sc, 'dip.f.base', -40);
      f(sc, 'dip.f.atWar', warsOf(ctx, to).length * 8);
      break;
  }
  ev.score = Math.round(sc.reduce((s, x) => s + x.value, 0) * 10) / 10;
  if (action !== 'improve' && action !== 'embargo' && action !== 'rebels') ev.chance = Math.round(chanceOf(ev.score) * 100) / 100;
  return ev;
}

function enemiesInCommon(ctx: Ctx, a: CountryId, b: CountryId): number {
  let n = 0;
  for (const w of warsOf(ctx, a)) {
    const sa = w.attackers.includes(a);
    const mates = sa ? w.attackers : w.defenders;
    if (mates.includes(b)) n++;
  }
  return n;
}

// ------------------------------------------------------------------ effects

export function applyTreaty(ctx: Ctx, kind: ProposalKind, from: CountryId, to: CountryId): void {
  const now = ctx.state.time.hours;
  switch (kind) {
    case 'trade': setFlag(ctx, from, to, 'trade', null); modRelation(ctx, from, to, 5, 'dip.cause.tradeDeal'); break;
    case 'nap': setFlag(ctx, from, to, 'nap', now + 10 * YEAR); modRelation(ctx, from, to, 4, 'dip.cause.nap'); break;
    case 'access': setFlag(ctx, from, to, `acc.${from}`, null); modRelation(ctx, from, to, 3, 'dip.cause.access'); break;
    case 'alliance':
      setFlag(ctx, from, to, 'alliance', null);
      setFlag(ctx, from, to, 'trade', null);
      modRelation(ctx, from, to, 15, 'dip.cause.alliance');
      break;
    case 'guarantee': setFlag(ctx, from, to, `guar.${from}`, null); modRelation(ctx, from, to, 8, 'dip.cause.guarantee'); break;
    default: return;
  }
  ctx.bus.emit({ type: 'dip.treaty', a: from, b: to, kind, on: true });
}

export function cancelTreaty(ctx: Ctx, from: CountryId, to: CountryId, kind: string): CommandResult {
  const keys: Record<string, string[]> = { trade: ['trade'], nap: ['nap'], alliance: ['alliance'], access: [`acc.${to}`, `acc.${from}`], guarantee: [`guar.${from}`, `guar.${to}`] };
  const list = keys[kind];
  if (!list) return fail('dip.err.unknownTreaty');
  const had = list.filter((k) => flagOn(ctx, from, to, k));
  if (!had.length) return fail('dip.err.noTreaty');
  for (const k of had) clearFlag(ctx, from, to, k);
  if (kind === 'nap' || kind === 'alliance') addRep(ctx, from, -3);
  modRelation(ctx, from, to, kind === 'trade' ? -4 : -10, 'dip.cause.cancelled');
  ctx.bus.emit({ type: 'dip.treaty', a: from, b: to, kind, on: false });
  return { ok: true };
}

const eco = (ctx: Ctx) => optApi(ctx, 'economy');

export function execute(ctx: Ctx, cmd: Command, action: ActionId): CommandResult {
  const from = cmd.country;
  const to = String(cmd.target ?? '');
  if (!ctx.world.countryById.has(to)) return fail('dip.err.unknownCountry');
  const player = ctx.state.meta.playerCountryId;
  const params = { province: cmd.province as string | undefined };
  const ev = evaluate(ctx, action, from, to, params);
  if (ev.blocked) return fail(ev.blocked, ev.blockedParams);
  const treaty = TREATY_KIND[action];

  // Proposals addressed to the player wait in their inbox.
  if (to === player && from !== player) {
    if (!treaty) {
      if (action === 'tribute' || action === 'territory') return fail('dip.err.notOnPlayer');
    } else {
      const s = st(ctx);
      if (s.inbox.some((p) => p.from === from && p.kind === treaty)) return fail('dip.err.already');
      if (s.inbox.length >= 8) return fail('dip.err.inboxFull');
      const p: Proposal = { id: s.nextId++, from, to, kind: treaty, until: ctx.state.time.hours + 30 * DAY };
      s.inbox.push(p);
      setCooldown(ctx, from, to, action, ACTION_COOLDOWN[action]);
      return { ok: true, pending: true, proposal: p.id };
    }
  }
  if (ev.cost > 0 && !eco(ctx)?.charge(from, { money: ev.cost }, `dip.cost.${action}`) && eco(ctx)) return fail('dip.err.noMoney', { cost: ev.cost });
  setCooldown(ctx, from, to, action, ACTION_COOLDOWN[action]);

  switch (action) {
    case 'improve':
      modRelation(ctx, from, to, relation(ctx, from, to) > 40 ? 4 : 8, 'dip.cause.improve');
      return { ok: true, accepted: true };
    case 'embargo':
      setFlag(ctx, from, to, `emb.${from}`, null);
      modRelation(ctx, from, to, -12, 'dip.cause.embargo');
      return { ok: true };
    case 'rebels': {
      eco(ctx)?.addUnrest({ country: to }, 4, 'dip.unrest.rebels', 120);
      modRelation(ctx, from, to, -18, 'dip.cause.rebels');
      if (ctx.rng.chance(0.35)) {
        addRep(ctx, from, -3);
        setFlag(ctx, to, from, `cb.${to}`, ctx.state.time.hours + 2 * YEAR);
        ctx.news('diplomacy', 'dip.news.rebelsExposed', { a: from, b: to }, { country: to }, { countries: [from, to], importance: to === player ? 2 : 1 });
      }
      return { ok: true };
    }
    default:
      break;
  }
  if (!ctx.rng.chance(ev.chance)) {
    if (action === 'tribute' || action === 'territory') {
      modRelation(ctx, from, to, action === 'tribute' ? -15 : -25, 'dip.cause.demandRefused');
      setFlag(ctx, from, to, `cb.${from}`, ctx.state.time.hours + YEAR);
    }
    return fail('dip.err.refused', { chance: Math.round(ev.chance * 100) });
  }
  if (treaty) applyTreaty(ctx, treaty, from, to);
  else if (action === 'tribute') {
    const t = treasury(ctx, to) ?? 0;
    const amount = Math.round(Math.max(0, t) * 0.12);
    if (amount > 0 && eco(ctx)?.charge(to, { money: amount }, 'dip.cost.tribute')) eco(ctx)?.credit(from, amount, 'dip.income.tribute');
    modRelation(ctx, from, to, -20, 'dip.cause.tribute');
    addRep(ctx, from, -1);
  } else if (action === 'territory') {
    ctx.api.worldDyn.setOwner(String(params.province), from, { cause: 'dip.demand' });
    modRelation(ctx, from, to, -35, 'dip.cause.territory');
    addRep(ctx, from, -4);
    ctx.news('diplomacy', 'dip.news.territoryCeded', { a: to, b: from, province: String(params.province) }, { province: String(params.province) }, { countries: [from, to], importance: 2 });
  }
  return { ok: true, accepted: true };
}

/** Player answers a proposal from the inbox. */
export function respond(ctx: Ctx, cmd: Command): CommandResult {
  const s = st(ctx);
  const i = s.inbox.findIndex((p) => p.id === Number(cmd.proposal));
  if (i < 0) return fail('dip.err.noProposal');
  const p = s.inbox[i];
  if (p.to !== cmd.country) return fail('dip.err.noProposal');
  s.inbox.splice(i, 1);
  if (cmd.accept === true && p.kind !== 'peace') {
    applyTreaty(ctx, p.kind, p.from, p.to);
    return { ok: true, accepted: true };
  }
  if (cmd.accept !== true) modRelation(ctx, p.from, p.to, -1, 'dip.cause.declined');
  return { ok: true, accepted: false, kind: p.kind, war: p.war ?? '' };
}

export { puppetLink, getPair };
