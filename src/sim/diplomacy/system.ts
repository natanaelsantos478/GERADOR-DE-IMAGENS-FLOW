import type { Command, CommandResult, CountryId, Ctx, DiplomacyApi, GameEvent } from '../../core/contracts';
import { defineSystem } from '../../core/registry';
import { ACTION_COMMAND, applyTreaty, cancelTreaty, execute, fail, respond, type ActionId } from './actions';
import { closeVote, onNuclearUse, proposeSanctionCmd, voteCmd } from './assembly';
import { directorDay } from './director';
import { dailyEvents, eventChoose } from './events';
import {
  DAY, access, addRep, allied, atWar, embargo, enemiesOf, flagOn, getPair, modRelation, pairKey, relation, rep, sanctionLevel, sideOf, st, tradeDeal, tradeFactor,
  warById, warsOf, invalidateWars,
} from './relations';
import type { DiplomacyState, Pair, WarState } from './types';
import {
  callAllies, dailyConferences, dailyWars, declareWar, endedByDeath, joinWarCmd, makePeace, onBattleResult, onCapture, peaceChoose, proposePeace,
} from './wars';

const BATTLE_END = /battle.*(end|finish|result|resolv|won|over)/i;
const NUKE_EVENT = /nuke|nuclear|detonat/i;
const NUKE_IGNORE = /ready|armed|built|produc|queue|research|alert|stock|train/i;

function createSlice(ctx: Ctx): DiplomacyState {
  const s: DiplomacyState = {
    pairs: {}, rep: {}, wars: [], inbox: [], conferences: [], vote: null, sanctions: {}, nukeUse: {}, event: null,
    nextPlayerEvent: 20 * DAY, voteCooldown: 0, nextId: 1, stats: { warsStarted: 0, warsEnded: 0, events: 0 },
  };
  // Real wars at the start of 2026 (alliances.json `conflicts`); no auto-recruited allies: the data lists co-belligerents explicitly.
  const seen = new Set<string>();
  for (const c of ctx.world.alliances.conflicts) {
    const a = ctx.world.countryById.get(c.a), b = ctx.world.countryById.get(c.b);
    const k = pairKey(c.a, c.b);
    if (!a || !b || seen.has(k)) continue;
    seen.add(k);
    const w: WarState = {
      id: `W${s.nextId++}`, attackers: [c.a], defenders: [c.b], attackerLeader: c.a, defenderLeader: c.b, startedHours: -24 * 365,
      casusBelli: 'dip.cb.historical', score: 0, tallyA: 0, tallyD: 0, occA: 0, occD: 0, capitulated: [],
    };
    s.wars.push(w);
    s.stats.warsStarted++;
    const p: Pair = { rel: -45, cs: [{ h: 0, key: 'dip.cause.war', v: -45 }], fl: {}, cd: {} };
    s.pairs[k] = p;
  }
  return s;
}

function decay(ctx: Ctx): void {
  const s = st(ctx);
  const now = ctx.state.time.hours;
  for (const [k, p] of Object.entries(s.pairs)) {
    p.rel *= 0.9965;
    for (const [f, until] of Object.entries(p.fl)) if (until !== 0 && until <= now) delete p.fl[f];
    for (const [f, until] of Object.entries(p.cd)) if (until <= now) delete p.cd[f];
    if (Math.abs(p.rel) < 0.2 && !Object.keys(p.fl).length && !Object.keys(p.cd).length) delete s.pairs[k];
    else if (Math.abs(p.rel) < 0.2) p.rel = 0;
  }
  for (const [c, v] of Object.entries(s.rep)) {
    const n = v > 0 ? Math.max(0, v - 0.04) : Math.min(0, v + 0.04);
    if (Math.abs(n) < 0.3) delete s.rep[c];
    else s.rep[c] = n;
  }
  for (const [c, until] of Object.entries(s.sanctions)) if (until <= now) delete s.sanctions[c];
  s.inbox = s.inbox.filter((p) => p.until > now);
}

function sniff(ctx: Ctx, e: GameEvent): void {
  const t = e.type;
  const isId = (x: unknown): x is CountryId => typeof x === 'string' && ctx.world.countryById.has(x);
  if (NUKE_EVENT.test(t) && !NUKE_IGNORE.test(t)) {
    const user = [e.country, e.by, e.attacker, e.launcher].find(isId);
    const victim = [e.targetCountry, e.target, e.victim, e.defender].find(isId);
    if (user) onNuclearUse(ctx, user, victim);
    return;
  }
  if (BATTLE_END.test(t)) {
    const att = Array.isArray(e.attackerCountries) ? (e.attackerCountries as unknown[]).filter(isId) : [];
    const def = Array.isArray(e.defenderCountries) ? (e.defenderCountries as unknown[]).filter(isId) : [];
    const winner = e.winner === 'attackers' || e.winner === 'defenders' ? e.winner : typeof e.balance === 'number' ? (e.balance > 0 ? 'attackers' : e.balance < 0 ? 'defenders' : null) : null;
    onBattleResult(ctx, att, def, winner);
  }
}

export const diplomacySystem = defineSystem({
  id: 'diplomacy',
  createSlice,
  init(ctx) {
    ctx.bus.on('world.controllerChanged', (e) => onCapture(ctx, e.province, e.from, e.to));
    ctx.bus.on('world.countryKilled', (e) => endedByDeath(ctx, e.country));
    ctx.bus.onPrefix('mil', (e) => sniff(ctx, e as GameEvent));
  },
  onLoad() {
    invalidateWars();
  },
  onDay(ctx) {
    decay(ctx);
    dailyWars(ctx);
    dailyConferences(ctx);
    closeVote(ctx);
    directorDay(ctx);
    dailyEvents(ctx);
  },
  handle(ctx, cmd: Command): CommandResult | undefined {
    const from = cmd.country;
    const act = (a: ActionId) => execute(ctx, cmd, a);
    switch (cmd.type) {
      case 'dip.improveRelations': return act('improve');
      case 'dip.proposeTrade': return act('trade');
      case 'dip.proposeNap': return act('nap');
      case 'dip.requestAccess': return act('access');
      case 'dip.proposeAlliance': return act('alliance');
      case 'dip.guarantee': return act('guarantee');
      case 'dip.embargo': return act('embargo');
      case 'dip.supportRebels': return act('rebels');
      case 'dip.demand': return act(cmd.kind === 'territory' ? 'territory' : 'tribute');
      case 'dip.liftEmbargo': {
        const to = String(cmd.target ?? '');
        if (!flagOn(ctx, from, to, `emb.${from}`)) return fail('dip.err.noTreaty');
        delete getPair(ctx, from, to)!.fl[`emb.${from}`];
        modRelation(ctx, from, to, 3, 'dip.cause.embargoLifted');
        return { ok: true };
      }
      case 'dip.cancelTreaty': return cancelTreaty(ctx, from, String(cmd.target ?? ''), String(cmd.kind ?? ''));
      case 'dip.declareWar': return declareWar(ctx, cmd);
      case 'dip.callAllies': return callAllies(ctx, cmd);
      case 'dip.joinWar': return joinWarCmd(ctx, cmd);
      case 'dip.proposePeace': return proposePeace(ctx, cmd);
      case 'dip.peaceChoose': return peaceChoose(ctx, cmd);
      case 'dip.proposeSanction': return proposeSanctionCmd(ctx, cmd);
      case 'dip.vote': return voteCmd(ctx, cmd);
      case 'dip.eventChoose': return eventChoose(ctx, cmd);
      case 'dip.respond': {
        const p = st(ctx).inbox.find((x) => x.id === Number(cmd.proposal));
        if (p && p.kind === 'peace' && p.to === from) {
          st(ctx).inbox = st(ctx).inbox.filter((x) => x !== p);
          const w = p.war ? warById(ctx, p.war) : undefined;
          if (cmd.accept === true && w) makePeace(ctx, w, p.from, p.to, 'white');
          return { ok: true, accepted: cmd.accept === true };
        }
        return respond(ctx, cmd);
      }
      default:
        return undefined;
    }
  },
  api(ctx): DiplomacyApi {
    return {
      relation: (a, b) => relation(ctx, a, b),
      atWar: (a, b) => atWar(ctx, a, b),
      allied: (a, b) => allied(ctx, a, b),
      enemies: (c) => enemiesOf(ctx, c),
      wars: () => st(ctx).wars,
      access: (a, b) => access(ctx, a, b),
      tradeDeal: (a, b) => tradeDeal(ctx, a, b),
      modRelation: (a, b, d, r) => modRelation(ctx, a, b, d, r),
      warScore(war, side) {
        const w = warById(ctx, war);
        return w ? (side === 'attackers' ? w.score : -w.score) : 0;
      },
      reputation: (c) => Math.round(rep(ctx, c) * 10) / 10,
      sanctionLevel: (c) => sanctionLevel(ctx, c),
      embargo: (a, b) => embargo(ctx, a, b),
      tradeFactor: (a, b) => tradeFactor(ctx, a, b),
      partners(c) {
        const out = new Set<CountryId>();
        for (const x of ctx.world.countries) if (x.id !== c && allied(ctx, c, x.id)) out.add(x.id);
        return [...out];
      },
      warsOf: (c) => warsOf(ctx, c),
      sideOf: (war, c) => {
        const w = warById(ctx, war);
        return w ? sideOf(w, c) : null;
      },
      treaty: (a, b, kind) => (kind === 'alliance' ? allied(ctx, a, b) : flagOn(ctx, a, b, kind)),
      lastCauses: (a, b) => getPair(ctx, a, b)?.cs ?? [],
    };
  },
  metrics(ctx) {
    const s = st(ctx);
    const player = ctx.state.meta.playerCountryId;
    return {
      guerras: s.wars.length,
      'guerras iniciadas': s.stats.warsStarted,
      'guerras encerradas': s.stats.warsEnded,
      pares: Object.keys(s.pairs).length,
      eventos: s.stats.events,
      'rep jogador': Math.round(rep(ctx, player)),
      sanções: Object.keys(s.sanctions).length,
    };
  },
});

export { applyTreaty, addRep, ACTION_COMMAND };
