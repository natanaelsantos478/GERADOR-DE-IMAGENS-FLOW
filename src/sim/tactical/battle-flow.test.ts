import { describe, expect, it } from 'vitest';
import { createGame } from '../../core/game';
import { loadWorldStatic } from '../../data/loadWorld';
import { nodeFetchJson } from '../../data/fetchNode';
import { SYSTEMS } from '../../app/systems';
import { dipCommands } from '../diplomacy';

/** Whole chain on real data: war → strategic battle → tactical (commanded by the auto-commander) → result applied → back to the map. */
async function scenario() {
  const world = await loadWorldStatic(nodeFetchJson());
  const g = createGame(world, { systems: SYSTEMS, playerCountryId: 'BRA', seed: 7, difficulty: 'hard' });
  expect(g.dispatch(dipCommands.declareWar('BRA', 'ARG')).ok).toBe(true);
  const mil = (g.state as unknown as { military: { forms: Record<string, { c: string; d: string; cr?: unknown; p: [number, number]; rt: unknown; od: unknown }> } }).military;
  const forms = Object.values(mil.forms);
  const mine = forms.find((f) => f.c === 'BRA' && f.d === 'land' && !f.cr)!;
  const foe = forms.find((f) => f.c === 'ARG' && f.d === 'land' && !f.cr)!;
  foe.p = [mine.p[0] + 0.03, mine.p[1] + 0.02]; foe.rt = null; foe.od = { k: 'idle' };
  for (let i = 0; i < 24 * 10 && !g.ctx.api.military.battles().length; i++) g.advanceHours(1);
  return g;
}

describe('batalha tática completa', () => {
  it('termina em ≤ 25 min (×1), aplica o resultado à batalha estratégica e devolve ao mapa', async () => {
    const g = await scenario();
    const bid = g.ctx.api.military.battles()[0].id;
    expect(g.dispatch({ type: 'tac.start', country: 'BRA', battleId: bid } as never).ok).toBe(true);
    expect(g.state.tactical.battle).not.toBeNull();
    g.dispatch({ type: 'tac.ready', country: 'BRA' } as never);
    g.dispatch({ type: 'tac.auto', country: 'BRA', value: true } as never);
    const tac = g.ctx.api.tactical;
    let t = 0;
    while (g.state.tactical.battle!.phase !== 'ended' && t < 3600) { tac.advance(0.5); t += 0.5; }
    const b = g.state.tactical.battle!;
    expect(b.phase).toBe('ended');
    expect(b.t).toBeLessThanOrEqual(25 * 60);
    expect(b.result!.casualties[0] + b.result!.casualties[1]).toBeGreaterThan(0);
    expect(g.state.tactical.applied).toBe(true);
    // Result applied: the strategic battle no longer runs under tactical control.
    const sb = g.ctx.api.military.battle(bid);
    expect(sb === null || !sb.tactical || g.state.tactical.last?.strategicBattleId === bid).toBe(true);
    expect(g.dispatch({ type: 'tac.exit', country: 'BRA' } as never).ok).toBe(true);
    expect(g.state.tactical.battle).toBeNull();
    console.log(`batalha terminou em ${Math.round(b.t)} s de jogo (${b.result!.reason}), baixas ${b.result!.casualties.join('/')}, strategic ${sb ? JSON.stringify({ tactical: sb.tactical }) : 'encerrada'}`);
  }, 120_000);

  it('"Resolver automaticamente" devolve a batalha à auto-resolução estratégica e retoma o tempo', async () => {
    const g = await scenario();
    const bid = g.ctx.api.military.battles()[0].id;
    g.dispatch({ type: 'tac.start', country: 'BRA', battleId: bid } as never);
    g.dispatch({ type: 'game.pause', country: 'BRA' });
    expect(g.ctx.api.military.battle(bid)!.tactical).toBe(true);
    expect(g.dispatch({ type: 'tac.exit', country: 'BRA', resolve: 'auto' } as never).ok).toBe(true);
    expect(g.state.tactical.battle).toBeNull();
    expect(g.ctx.api.military.battle(bid)!.tactical).toBe(false);
    expect(g.state.time.paused).toBe(false);
    for (let i = 0; i < 24 * 60 && g.ctx.api.military.battle(bid); i++) g.advanceHours(1);
    expect(g.ctx.api.military.battle(bid)).toBeNull();
  }, 120_000);
});
