import { describe, expect, it } from 'vitest';
import { fixtureWorld } from '../data/fixture.test-util';
import { createGame } from './game';
import { createRegistry, prefixOf } from './registry';
import { counterSystem } from './testSystems.test-util';

describe('registry', () => {
  it('orders systems research → economy → diplomacy → military → tactical → ai', () => {
    const reg = createRegistry(['ai', 'military', 'economy', 'research', 'tactical', 'diplomacy'].map((id) => counterSystem(id as never)));
    expect(reg.systems.map((s) => s.id)).toEqual(['research', 'economy', 'diplomacy', 'military', 'tactical', 'ai']);
    expect(reg.byPrefix('mil')?.id).toBe('military');
    expect(reg.byPrefix('xyz')).toBeUndefined();
    expect(prefixOf('eco.build')).toBe('eco');
  });

  it('rejects duplicates and unknown ids', () => {
    expect(() => createRegistry([counterSystem('economy'), counterSystem('economy')])).toThrow(/twice/);
    expect(() => createRegistry([counterSystem('bogus' as never)])).toThrow(/unknown/);
  });

  it('routes commands by prefix and reports unknown routes', () => {
    const world = fixtureWorld();
    const game = createGame(world, { systems: [counterSystem('economy'), counterSystem('military')], playerCountryId: 'AAA' });
    const seen: string[] = [];
    game.bus.on('game.command', (e) => seen.push(`${e.command.type}:${e.result.ok}`));
    expect(game.dispatch({ type: 'eco.ping', country: 'BBB' })).toEqual({ ok: true });
    expect((game.state.economy as { log: string[] }).log).toEqual(['ping:BBB']);
    expect(game.dispatch({ type: 'mil.ping', country: 'AAA' }).ok).toBe(true);
    expect(game.dispatch({ type: 'dip.ping', country: 'AAA' })).toMatchObject({ ok: false, reason: 'err.command.systemMissing' });
    expect(game.dispatch({ type: 'eco.nothing', country: 'AAA' })).toMatchObject({ ok: false, reason: 'err.command.unknown' });
    expect(game.dispatch({ type: 'eco.ping', country: 'ZZZ' })).toMatchObject({ ok: false, reason: 'err.command.unknownCountry' });
    expect(game.dispatch({ type: 'xyz.ping', country: 'AAA' } as never)).toMatchObject({ ok: false, reason: 'err.command.unknownPrefix' });
    expect(seen[0]).toBe('eco.ping:true');
    expect(seen).toHaveLength(6);
  });

  it('handles core game.* commands for the player only', () => {
    const game = createGame(fixtureWorld(), { systems: [], playerCountryId: 'AAA' });
    expect(game.state.time.paused).toBe(true);
    expect(game.dispatch({ type: 'game.resume', country: 'AAA' }).ok).toBe(true);
    expect(game.dispatch({ type: 'game.setSpeed', country: 'AAA', speed: 4 }).ok).toBe(true);
    expect(game.dispatch({ type: 'game.setSpeed', country: 'AAA', speed: 9 as never }).ok).toBe(false);
    expect(game.dispatch({ type: 'game.pause', country: 'BBB' })).toMatchObject({ ok: false, reason: 'err.command.notPlayer' });
    expect(game.state.time).toMatchObject({ speed: 4, paused: false });
    expect(game.dispatch({ type: 'game.setAutomation', country: 'AAA', key: 'eco.budget', value: true }).ok).toBe(true);
    expect(game.state.meta.automation['eco.budget']).toBe(true);
  });

  it('throws a clear error when using the API of an unregistered system', () => {
    const game = createGame(fixtureWorld(), { systems: [counterSystem('economy')], playerCountryId: 'AAA' });
    expect(() => game.ctx.api.military).toThrow(/military.*não registrado/);
    expect((game.ctx.api.economy as unknown as { ticks(): number }).ticks()).toBe(0);
  });
});
