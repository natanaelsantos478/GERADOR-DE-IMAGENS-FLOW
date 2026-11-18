import type { Order } from '../../sim/tactical/types';
/** Right click on an enemy unit: the sim's `attack` order takes the target SQUAD id (`Battle.squads` index), never the entity id. */
export const attackOrder = (targetSquad: number): Order => ({ kind: 'attack', target: targetSquad });
