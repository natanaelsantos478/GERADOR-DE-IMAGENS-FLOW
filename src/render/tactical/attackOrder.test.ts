import { describe, expect, it } from 'vitest';
import { createBattle } from '../../sim/tactical/core';
import { issueOrder } from '../../sim/tactical/orders';
import { flatMap, scenarioInput } from '../../sim/tactical/scenario.test-util';
import { attackOrder } from './attackOrder';

describe('right click attack order', () => {
  it('targets the enemy SQUAD: the sim stores that squad id and rejects an entity id that is not a squad', () => {
    const b = createBattle({ ...scenarioInput(flatMap(), 'a'), player: 0 }, 2);
    b.phase = 'combat';
    const mine = b.squads.find((s) => s.side === 0)!, foe = b.squads.find((s) => s.side === 1)!;
    const ent = b.ents.find((e) => e.side === 1 && e.sq === foe.id)!;
    expect(attackOrder(foe.id)).toEqual({ kind: 'attack', target: foe.id });
    expect(issueOrder(b, 0, [mine.id], attackOrder(foe.id)).ok).toBe(true);
    expect(mine.order).toBe('attack'); expect(mine.target).toBe(foe.id);
    // the entity id of a unit of that squad is generally another number: it must not be what we send
    expect(ent.id === foe.id).toBe(false);
  });
});
