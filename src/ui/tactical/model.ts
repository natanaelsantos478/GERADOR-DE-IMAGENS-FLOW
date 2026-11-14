import type { Game } from '../../core/game';
import { UNITS } from '../../sim/tactical/units';
import type { FormationKind, Objective, OrderKind, Support, TacticalResult, UnitKind } from '../../sim/tactical/types';

export interface SquadCard {
  id: number; side: 0 | 1; kind: UnitKind; name: string; alive: number; n0: number; morale: number; ammo: number;
  routed: boolean; order: OrderKind; form: FormationKind; dug: number; smoke: number; fireFree: boolean; ai: boolean; cargo: number; x: number; y: number;
}
export interface TacModel {
  id: string; strategic: string; phase: 'deploy' | 'combat' | 'ended'; t: number; timeLimit: number; deployLimit: number;
  player: 0 | 1 | null; auto: boolean; ready: boolean; score: [number, number];
  objs: Pick<Objective, 'id' | 'name' | 'owner' | 'cap' | 'value'>[]; support: Support; timeScale: number; paused: boolean;
  squads: SquadCard[]; result: TacticalResult | null; center: [number, number]; countries: [string[], string[]]; withdrawing: boolean;
}

/** Light read-model of the running tactical battle (no entity lists, so structural comparison stays cheap). */
export function tacModel(g: Game): TacModel | null {
  const s = g.state.tactical, b = s?.battle;
  if (!s || !b) return null;
  const alive = new Array<number>(b.squads.length).fill(0), ammo = new Array<number>(b.squads.length).fill(0);
  for (const e of b.ents) {
    if (!e.alive || e.gone) continue;
    alive[e.sq]++;
    const w = UNITS[e.kind].w[0];
    ammo[e.sq] += w?.n ? Math.min(1, e.am[0] / w.n) : 1;
  }
  const ps = b.player ?? 0;
  const r2 = (v: number) => Math.round(v * 100) / 100;
  return {
    id: b.id, strategic: b.strategicBattleId, phase: b.phase, t: Math.round(b.t), timeLimit: b.timeLimit, deployLimit: b.deployLimit, player: b.player,
    auto: b.player === null ? true : b.auto[b.player], ready: b.ready[ps], score: [Math.round(b.score[0]), Math.round(b.score[1])],
    objs: b.objs.map((o) => ({ id: o.id, name: o.name, owner: o.owner, cap: r2(o.cap), value: o.value })), support: b.support[ps], timeScale: s.timeScale, paused: s.paused,
    squads: b.squads.map((q) => ({
      id: q.id, side: q.side, kind: q.kind, name: q.name, alive: alive[q.id], n0: q.n0, morale: r2(q.morale), ammo: alive[q.id] ? r2(ammo[q.id] / alive[q.id]) : 0,
      routed: q.routed, order: q.order, form: q.form, dug: r2(q.dug), smoke: q.smoke, fireFree: q.fireFree, ai: q.ai, cargo: q.cargo, x: Math.round(q.x), y: Math.round(q.y),
    })),
    result: b.result, center: b.center, countries: s.countries, withdrawing: b.withdrawing[ps],
  };
}
