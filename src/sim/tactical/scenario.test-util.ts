import type { WorldStatic } from '../../core/contracts';
import { defaultObjectives } from './mapWorld';
import type { SideInput, SquadInput, TacticalBattleInput, TacticalMap } from './types';

const sq = (ref: string, kind: SquadInput['kind'], count: number, o: Partial<SquadInput> = {}): SquadInput => ({ ref, kind, count, morale: 0.8, ammo: 1, ...o });
export function sideForce(prefix: string, big = false): SideInput {
  return {
    country: prefix, support: { artillery: 2, airstrike: 1, drone: 1 },
    squads: [
      sq(`${prefix}-mbt1`, 'mbt', big ? 12 : 8), sq(`${prefix}-mbt2`, 'mbt', big ? 12 : 6),
      sq(`${prefix}-mech1`, 'mech', big ? 12 : 8, { cargo: 6 }), sq(`${prefix}-inf1`, 'infantry', 12), sq(`${prefix}-inf2`, 'infantry', 12),
      sq(`${prefix}-spec`, 'special', 6), sq(`${prefix}-rec`, 'recon', 4), sq(`${prefix}-art`, 'artillery', 6), sq(`${prefix}-sam`, 'sam', 3),
      sq(`${prefix}-log`, 'logistics', 3), sq(`${prefix}-eng`, 'engineer', 6),
    ],
  };
}
export function scenarioInput(map: TacticalMap, id = 't', big = false): TacticalBattleInput {
  return { id, strategicBattleId: 'b1', center: [0, 0], map, sides: [sideForce('A', big), sideForce('B', big)], attacker: 0, objectives: defaultObjectives(map, 0), player: null };
}
export function flatMap(n = 64, sizeM = 8000): TacticalMap {
  const N = n * n;
  return { sizeM, n, heights: new Array(N).fill(100), cover: new Array(N).fill(0), road: new Array(N).fill(0), water: new Array(N).fill(0) };
}
export type { WorldStatic };
