import type { CountryId, TextKey, WarId, WarView, WarSide, NewsParams } from '../../core/contracts';

export interface Cause {
  /** Game hours. */
  h: number;
  key: TextKey;
  v: number;
}
/** Sparse bilateral record, keyed by `pairKey(a,b)`. */
export interface Pair {
  /** Dynamic relation delta (decays toward 0). */
  rel: number;
  /** Last causes, newest last (max 6). */
  cs: Cause[];
  /** Treaties/flags → expiry hours (0 = permanent): trade, nap, alliance, truce, acc.<X>, emb.<X>, guar.<X>, cb.<X>. */
  fl: Record<string, number>;
  /** Action cooldowns → hours. */
  cd: Record<string, number>;
}

export interface WarState extends WarView {
  /** Attackers' point of view, −100..100. */
  score: number;
  tallyA: number;
  tallyD: number;
  /** Share (0..1) of the enemy side's provinces held by each side. */
  occA: number;
  occD: number;
  capitulated: CountryId[];
}

export type ProposalKind = 'trade' | 'nap' | 'access' | 'alliance' | 'guarantee' | 'peace';
export interface Proposal {
  id: number;
  from: CountryId;
  to: CountryId;
  kind: ProposalKind;
  until: number;
  war?: WarId;
}

export type PeaceOption = 'annexAll' | 'annexOccupied' | 'puppet' | 'regime' | 'reparations' | 'white';
export const PEACE_OPTIONS: readonly PeaceOption[] = ['annexAll', 'annexOccupied', 'puppet', 'regime', 'reparations', 'white'];
export interface Conference {
  id: number;
  war: WarId;
  loser: CountryId;
  winners: CountryId[];
  /** Winner leader who decides. */
  receiver: CountryId;
  /** Whether the loser led its side (the war ends). */
  warEnds: boolean;
  /** Share of the loser's provinces occupied by the winners. */
  occupied: number;
  until: number;
}

export interface Vote {
  id: number;
  target: CountryId;
  proposer: CountryId;
  reason: TextKey;
  endsHours: number;
  /** The player's ballot, if cast (AI ballots are derived when the vote closes). */
  player?: boolean;
}

export interface PendingEvent {
  id: number;
  type: string;
  country: CountryId;
  other?: CountryId;
  since: number;
  until: number;
}

export interface DiplomacyState {
  pairs: Record<string, Pair>;
  /** Sparse international opinion −100..100 (absent = 0). */
  rep: Record<CountryId, number>;
  wars: WarState[];
  inbox: Proposal[];
  conferences: Conference[];
  vote: Vote | null;
  /** Country → hours when the world-assembly sanction expires. */
  sanctions: Record<CountryId, number>;
  /** Country → hours of its last nuclear use. */
  nukeUse: Record<CountryId, number>;
  event: PendingEvent | null;
  /** Next hour at which the player may get a random event. */
  nextPlayerEvent: number;
  voteCooldown: number;
  nextId: number;
  /** Counters for metrics. */
  stats: { warsStarted: number; warsEnded: number; events: number };
}

export interface ActionEval {
  action: string;
  /** Command type to dispatch. */
  command: string;
  /** i18n key explaining why the action is unavailable. */
  blocked?: TextKey;
  blockedParams?: NewsParams;
  /** 0..1 probability of acceptance (1 for unilateral actions). */
  chance: number;
  score: number;
  factors: { key: TextKey; value: number }[];
  cost: number;
}

export interface WorldEventView {
  id: number;
  type: string;
  country: CountryId;
  other?: CountryId;
  choices: { id: string; key: TextKey }[];
  until: number;
}

declare module '../../core/contracts' {
  interface SliceMap {
    diplomacy: DiplomacyState;
  }
  interface CommandMap {
    'dip.improveRelations': { target: CountryId };
    'dip.proposeTrade': { target: CountryId };
    'dip.proposeNap': { target: CountryId };
    'dip.requestAccess': { target: CountryId };
    'dip.proposeAlliance': { target: CountryId };
    'dip.guarantee': { target: CountryId };
    'dip.embargo': { target: CountryId };
    'dip.liftEmbargo': { target: CountryId };
    'dip.cancelTreaty': { target: CountryId; kind: 'trade' | 'nap' | 'alliance' | 'access' | 'guarantee' };
    'dip.demand': { target: CountryId; kind: 'tribute' | 'territory'; province?: string };
    'dip.supportRebels': { target: CountryId };
    'dip.declareWar': { target: CountryId; casusBelli?: string; force?: boolean };
    'dip.callAllies': { war: WarId };
    'dip.joinWar': { war: WarId; side: WarSide };
    'dip.proposePeace': { war: WarId; terms?: 'white' | 'annexOccupied' };
    'dip.peaceChoose': { conference: number; option: PeaceOption };
    'dip.respond': { proposal: number; accept: boolean };
    'dip.proposeSanction': { target: CountryId };
    'dip.vote': { yes: boolean };
    'dip.eventChoose': { event: number; choice: string };
  }
  interface EventMap {
    'dip.warDeclared': { war: WarId; attacker: CountryId; defender: CountryId; casusBelli: string };
    'dip.warJoined': { war: WarId; country: CountryId; side: WarSide };
    'dip.warEnded': { war: WarId; winner: WarSide | null; option: string };
    'dip.treaty': { a: CountryId; b: CountryId; kind: string; on: boolean };
    'dip.sanctioned': { country: CountryId; until: number };
    'dip.worldEvent': { event: string; country: CountryId };
  }
  interface DiplomacyApi {
    /** International opinion −100..100. */
    reputation(c: CountryId): number;
    /** 0..1: how hard the world assembly / nuclear stigma squeezes the country's trade. */
    sanctionLevel(c: CountryId): number;
    /** True if `a` has an embargo on `b`. */
    embargo(a: CountryId, b: CountryId): boolean;
    /** Trade multiplier of a bilateral flow: 0 (war/embargo) .. ~1.3 (deal), reduced by sanctions. */
    tradeFactor(a: CountryId, b: CountryId): number;
    /** Allied + puppets + guarantors that would defend `c` (for AI planning). */
    partners(c: CountryId): CountryId[];
    /** Wars a country takes part in. */
    warsOf(c: CountryId): WarView[];
    sideOf(war: WarId, c: CountryId): WarSide | null;
    /** Treaty / flag check, e.g. `treaty(a,b,'nap')`. */
    treaty(a: CountryId, b: CountryId, kind: 'trade' | 'nap' | 'alliance' | 'truce'): boolean;
    lastCauses(a: CountryId, b: CountryId): Cause[];
  }
}
