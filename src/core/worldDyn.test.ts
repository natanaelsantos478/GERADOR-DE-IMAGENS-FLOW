import { describe, expect, it } from 'vitest';
import { fixtureWorld } from '../data/fixture.test-util';
import type { KnownEvent } from './contracts';
import { createGame } from './game';

const setup = () => {
  const game = createGame(fixtureWorld(), { systems: [], playerCountryId: 'AAA' });
  const events: KnownEvent[] = [];
  game.bus.onPrefix('world', (e) => events.push(e as KnownEvent));
  return { game, wd: game.ctx.api.worldDyn, events };
};

describe('worldDyn', () => {
  it('starts with real ownership', () => {
    const { wd } = setup();
    expect(wd.provincesOwnedBy('AAA')).toEqual(['AAA-1', 'AAA-2']);
    expect(wd.provincesControlledBy('BBB')).toEqual(['BBB-1']);
    expect(wd.aliveCountries()).toEqual(['AAA', 'BBB']);
    expect(wd.isOccupied('AAA-1')).toBe(false);
  });

  it('setController/setOwner update indices and emit events', () => {
    const { wd, events } = setup();
    wd.setController('AAA-2', 'BBB', 'battle');
    expect(wd.controllerOf('AAA-2')).toBe('BBB');
    expect(wd.isOccupied('AAA-2')).toBe(true);
    expect(wd.provincesControlledBy('BBB')).toEqual(['AAA-2', 'BBB-1']);
    expect(wd.provincesOwnedBy('AAA')).toEqual(['AAA-1', 'AAA-2']);
    expect(events).toEqual([{ type: 'world.controllerChanged', province: 'AAA-2', from: 'AAA', to: 'BBB', cause: 'battle' }]);
    wd.setController('AAA-2', 'BBB');
    expect(events).toHaveLength(1);
    wd.setOwner('AAA-2', 'BBB', { cause: 'peace' });
    expect(wd.provincesOwnedBy('BBB')).toEqual(['AAA-2', 'BBB-1']);
    expect(events.map((e) => e.type)).toEqual(['world.controllerChanged', 'world.ownerChanged']);
    wd.setOwner('AAA-1', 'BBB', { keepController: true });
    expect(wd.controllerOf('AAA-1')).toBe('AAA');
    expect(() => wd.setController('NOPE', 'AAA')).toThrow();
    expect(() => wd.setController('AAA-1', 'ZZZ')).toThrow();
  });

  it('damage/repair clamp to 0..1, stay sparse and emit', () => {
    const { wd, game, events } = setup();
    expect(wd.effectiveHealth('plant', 0)).toBe(1);
    expect(wd.damage('plant', 0, 0.7, 'bomb')).toBeCloseTo(0.7);
    expect(wd.damage('plant', 0, 0.7, 'bomb')).toBeCloseTo(0.3);
    expect(wd.damage('plant', 0, 0.7, 'bomb')).toBe(0);
    expect(wd.damageOf('plant', 0)).toBe(1);
    expect(wd.repair('plant', 0, 0.25)).toBeCloseTo(0.25);
    expect(wd.effectiveHealth('plant', 0)).toBeCloseTo(0.25);
    expect(wd.repair('plant', 0, 5)).toBeCloseTo(0.75);
    expect(game.state.world.plantDamage).toEqual({});
    wd.damage('road', 1, 0.5, 'missile');
    expect(game.state.world.roadDamage).toEqual({ 1: 0.5 });
    expect(events.filter((e) => e.type === 'world.damaged')).toHaveLength(3);
    expect(events.filter((e) => e.type === 'world.repaired')).toHaveLength(2);
  });

  it('kill/revive countries and puppets', () => {
    const { wd, events } = setup();
    wd.setOverlord('BBB', 'AAA');
    expect(wd.overlordOf('BBB')).toBe('AAA');
    expect(wd.puppetsOf('AAA')).toEqual(['BBB']);
    expect(() => wd.setOverlord('AAA', 'AAA')).toThrow();
    wd.killCountry('AAA', 'BBB');
    expect(wd.isAlive('AAA')).toBe(false);
    expect(wd.overlordOf('BBB')).toBeNull();
    expect(wd.aliveCountries()).toEqual(['BBB']);
    wd.setOwner('AAA-1', 'AAA');
    expect(wd.isAlive('AAA')).toBe(true);
    expect(events.map((e) => e.type)).toContain('world.countryRevived');
  });

  it('reads stay correct after loading a save', () => {
    const { game, wd } = setup();
    const save = game.serialize();
    wd.setController('AAA-1', 'BBB');
    expect(wd.provincesControlledBy('BBB')).toContain('AAA-1');
    game.hydrate(save);
    expect(wd.provincesControlledBy('BBB')).toEqual(['BBB-1']);
  });
});
