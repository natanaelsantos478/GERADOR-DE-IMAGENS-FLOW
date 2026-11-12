import type { Command, CountryId, Ctx, WarId, WarSide } from '../../core/contracts';
import { ACTION_COMMAND, evaluate, type ActionId } from './actions';
import { currentEvent, EVENTS } from './events';
import { casusBelliOptions, joinChance, peaceEval, peaceOptionsFor, type CbOption } from './wars';
import { atWar, getPair, relation, sideOf, st, warsOf, baseRelation } from './relations';
import type { ActionEval, Conference, PeaceOption, Proposal, Vote, WarState, WorldEventView } from './types';

export { diplomacySystem } from './system';
export { diplomacyPt } from './i18n.pt';
export { EVENTS } from './events';
export { evaluate } from './actions';
export type { ActionId } from './actions';
export type { Cause, Conference, DiplomacyState, PeaceOption, Proposal, Vote, WarState, WorldEventView } from './types';

// ---- command creators
const t = (type: Command['type'], country: CountryId, extra: Record<string, unknown> = {}): Command => ({ type, country, ...extra });
export const dipCommands = {
  improveRelations: (c: CountryId, target: CountryId) => t('dip.improveRelations', c, { target }),
  proposeTrade: (c: CountryId, target: CountryId) => t('dip.proposeTrade', c, { target }),
  proposeNap: (c: CountryId, target: CountryId) => t('dip.proposeNap', c, { target }),
  requestAccess: (c: CountryId, target: CountryId) => t('dip.requestAccess', c, { target }),
  proposeAlliance: (c: CountryId, target: CountryId) => t('dip.proposeAlliance', c, { target }),
  guarantee: (c: CountryId, target: CountryId) => t('dip.guarantee', c, { target }),
  embargo: (c: CountryId, target: CountryId) => t('dip.embargo', c, { target }),
  liftEmbargo: (c: CountryId, target: CountryId) => t('dip.liftEmbargo', c, { target }),
  cancelTreaty: (c: CountryId, target: CountryId, kind: 'trade' | 'nap' | 'alliance' | 'access' | 'guarantee') => t('dip.cancelTreaty', c, { target, kind }),
  demandTribute: (c: CountryId, target: CountryId) => t('dip.demand', c, { target, kind: 'tribute' }),
  demandTerritory: (c: CountryId, target: CountryId, province: string) => t('dip.demand', c, { target, kind: 'territory', province }),
  supportRebels: (c: CountryId, target: CountryId) => t('dip.supportRebels', c, { target }),
  declareWar: (c: CountryId, target: CountryId, casusBelli?: string, force?: boolean) => t('dip.declareWar', c, { target, ...(casusBelli ? { casusBelli } : {}), ...(force ? { force } : {}) }),
  callAllies: (c: CountryId, war: WarId) => t('dip.callAllies', c, { war }),
  joinWar: (c: CountryId, war: WarId, side: WarSide) => t('dip.joinWar', c, { war, side }),
  proposePeace: (c: CountryId, war: WarId, terms: 'white' | 'annexOccupied' = 'white') => t('dip.proposePeace', c, { war, terms }),
  peaceChoose: (c: CountryId, conference: number, option: PeaceOption) => t('dip.peaceChoose', c, { conference, option }),
  respond: (c: CountryId, proposal: number, accept: boolean) => t('dip.respond', c, { proposal, accept }),
  proposeSanction: (c: CountryId, target: CountryId) => t('dip.proposeSanction', c, { target }),
  vote: (c: CountryId, yes: boolean) => t('dip.vote', c, { yes }),
  eventChoose: (c: CountryId, event: number, choice: string) => t('dip.eventChoose', c, { event, choice }),
};

// ---- UI selectors
const ACTIONS: ActionId[] = ['improve', 'trade', 'nap', 'access', 'alliance', 'guarantee', 'embargo', 'tribute', 'territory', 'rebels'];

/** All bilateral actions `from` could take against `to`, with block reason (i18n key), acceptance chance, factors and cost. */
export function selectActionsAgainst(ctx: Ctx, from: CountryId, to: CountryId, province?: string): (ActionEval & { id: ActionId })[] {
  return ACTIONS.filter((a) => a !== 'territory' || province).map((id) => ({ id, ...evaluate(ctx, id, from, to, { province }) }));
}
export interface WarDeclarationInfo {
  options: CbOption[];
  blocked?: string;
  command: string;
}
export function selectWarDeclaration(ctx: Ctx, from: CountryId, to: CountryId): WarDeclarationInfo {
  const options = casusBelliOptions(ctx, from, to);
  const blocked = atWar(ctx, from, to) ? 'dip.err.atWar' : undefined;
  return { options, command: 'dip.declareWar', ...(blocked ? { blocked } : {}) };
}
export interface WarSummary {
  war: WarState;
  side: WarSide | null;
  /** −100..100 from the viewer's side (attackers' score when not a participant). */
  score: number;
  days: number;
}
export function selectWars(ctx: Ctx, viewer?: CountryId): WarSummary[] {
  const list = viewer ? warsOf(ctx, viewer) : st(ctx).wars;
  return list.map((war) => {
    const side = viewer ? sideOf(war, viewer) : null;
    return { war, side, score: side === 'defenders' ? -war.score : war.score, days: Math.floor((ctx.state.time.hours - war.startedHours) / 24) };
  });
}
/** Peace offer evaluation (what the enemy leader would answer). */
export function selectPeaceChance(ctx: Ctx, from: CountryId, war: WarId, terms: 'white' | 'annexOccupied' = 'white') {
  const w = st(ctx).wars.find((x) => x.id === war);
  if (!w) return null;
  const side = sideOf(w, from);
  if (!side) return null;
  return peaceEval(ctx, w, from, side === 'attackers' ? w.defenderLeader : w.attackerLeader, terms);
}
/** Chance an ally would join a side of a war (for the "call allies" button). */
export const selectJoinChance = joinChance;
export const selectProposals = (ctx: Ctx, country: CountryId): Proposal[] => st(ctx).inbox.filter((p) => p.to === country);
export const selectConferences = (ctx: Ctx, country: CountryId): (Conference & { options: PeaceOption[] })[] =>
  st(ctx).conferences.filter((c) => c.receiver === country).map((c) => ({ ...c, options: peaceOptionsFor(c) }));
export const selectPendingEvent = (ctx: Ctx): WorldEventView | null => currentEvent(ctx);
export const selectVote = (ctx: Ctx): Vote | null => st(ctx).vote;
/** Why two countries feel the way they do: structural base + dynamic delta + last causes. */
export function selectRelationBreakdown(ctx: Ctx, a: CountryId, b: CountryId) {
  const p = getPair(ctx, a, b);
  return { total: relation(ctx, a, b), base: Math.round(baseRelation(ctx, a, b) * 10) / 10, dynamic: Math.round((p?.rel ?? 0) * 10) / 10, causes: [...(p?.cs ?? [])].reverse(), treaties: Object.keys(p?.fl ?? {}) };
}
export const DIP_EVENT_TYPES: readonly string[] = EVENTS.map((e) => e.id);
export { ACTION_COMMAND };
