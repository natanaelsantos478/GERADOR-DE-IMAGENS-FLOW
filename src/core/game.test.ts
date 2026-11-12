import { describe, expect, it } from 'vitest';
import { fixtureWorld } from '../data/fixture.test-util';
import { SYSTEM_ORDER } from './contracts';
import { createGame, loadGame, SaveError } from './game';
import { findJsonIssues } from './json';
import { counterSystem, type CounterSlice } from './testSystems.test-util';

const world = fixtureWorld();
const allSystems = (log?: string[]) => SYSTEM_ORDER.map((id) => counterSystem(id, log));

describe('Game', () => {
  it('creates a JSON-pure state with null slices for unregistered systems', () => {
    const game = createGame(world, { systems: [counterSystem('economy')], playerCountryId: 'AAA', seed: 1 });
    expect(findJsonIssues(game.state)).toEqual([]);
    expect(game.state.military).toBeNull();
    expect(game.state.economy).toMatchObject({ ticks: 0 });
    expect(game.state.meta).toMatchObject({ dataHash: world.dataHash, playerCountryId: 'AAA', difficulty: 'normal' });
    expect(() => createGame(world, { systems: [], playerCountryId: 'ZZZ' })).toThrow();
  });

  it('runs systems in plan order with ≤1h substeps and calendar triggers', () => {
    const log: string[] = [];
    const game = createGame(world, { systems: allSystems(log).reverse(), playerCountryId: 'AAA' });
    game.advanceHours(24);
    expect(log.slice(0, 6)).toEqual(SYSTEM_ORDER.map((id) => `${id}.update`));
    expect(log.filter((l) => l.endsWith('.day'))).toEqual(SYSTEM_ORDER.map((id) => `${id}.day`));
    const eco = game.state.economy as unknown as CounterSlice;
    expect(eco.ticks).toBe(24);
    expect(eco.hoursSeen).toBeCloseTo(24);
    game.advanceHours(24 * 365);
    expect(eco.days).toBe(366);
    expect(eco.months).toBe(12); // Feb 1 … Dec 1 + Jan 1 2027
    expect(eco.weeks).toBe(52);
    expect(game.state.time.hours).toBe(24 * 366);
  });

  it('step() honours pause and the speed table, clamping long frames', () => {
    const game = createGame(world, { systems: [], playerCountryId: 'AAA' });
    expect(game.step(1)).toBe(0);
    game.dispatch({ type: 'game.resume', country: 'AAA' });
    expect(game.step(0.1)).toBeCloseTo(0.1);
    game.dispatch({ type: 'game.setSpeed', country: 'AAA', speed: 5 });
    expect(game.step(0.1)).toBeCloseTo(9.6);
    expect(game.step(10)).toBeCloseTo(24); // clamped to 0.25 s
    game.dispatch({ type: 'game.setSpeed', country: 'AAA', speed: 0 });
    expect(game.step(0.1)).toBe(0);
  });

  it('news helper keeps the newest 300', () => {
    const game = createGame(world, { systems: [], playerCountryId: 'AAA' });
    for (let i = 0; i < 310; i++) game.ctx.news('world', 'k', { i }, { country: 'AAA' }, { countries: ['AAA'], importance: 2 });
    expect(game.state.news).toHaveLength(300);
    expect(game.state.news[0].params.i).toBe(10);
    expect(game.state.news[299]).toMatchObject({ id: 310, importance: 2, where: { country: 'AAA' }, countries: ['AAA'] });
  });

  it('serialize → hydrate is identical and the simulation stays deterministic', () => {
    const a = createGame(world, { systems: allSystems(), playerCountryId: 'AAA', seed: 99 });
    a.advanceHours(24 * 40 + 7.5);
    a.ctx.api.worldDyn.damage('city', 0, 0.4, 'test');
    const save = JSON.parse(JSON.stringify(a.serialize()));
    const b = loadGame(world, allSystems(), save);
    expect(JSON.stringify(b.state)).toBe(JSON.stringify(a.state));
    a.advanceHours(24 * 70);
    b.advanceHours(24 * 70);
    expect(JSON.stringify(b.state)).toBe(JSON.stringify(a.state));
    // In-place hydrate rewinds the same Game.
    const c = createGame(world, { systems: allSystems(), playerCountryId: 'BBB', seed: 1 });
    c.hydrate(save);
    expect(c.state.meta.playerCountryId).toBe('AAA');
    c.advanceHours(24 * 70);
    expect(JSON.stringify(c.state)).toBe(JSON.stringify(b.state));
  });

  it('rejects bad saves with clear codes and creates slices for newly registered systems', () => {
    const a = createGame(world, { systems: [counterSystem('economy')], playerCountryId: 'AAA' });
    const save = a.serialize();
    const err = (fn: () => void) => {
      try {
        fn();
      } catch (e) {
        return (e as SaveError).code;
      }
      return null;
    };
    expect(err(() => a.hydrate({ nope: 1 }))).toBe('format');
    expect(err(() => a.hydrate({ ...save, version: 999 }))).toBe('version');
    expect(err(() => a.hydrate({ ...save, dataHash: 'x' }))).toBe('dataHash');
    expect(err(() => a.hydrate({ ...save, dataHash: 'x' }, { ignoreDataHash: true }))).toBeNull();
    const b = loadGame(world, [counterSystem('economy'), counterSystem('ai')], save);
    expect(b.state.ai).toMatchObject({ ticks: 0 });
  });
});
