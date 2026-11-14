import { describe, expect, it } from 'vitest';
import { createGame } from '../../core/game';
import { loadWorldStatic } from '../../data/loadWorld';
import { nodeFetchJson } from '../../data/fetchNode';
import { researchSystem } from '../research/system';
import { economySystem } from '../economy/system';
import { diplomacySystem } from '../diplomacy/system';
import { militarySystem } from '../military/system';
import { milCmd } from '../military';
import { tacticalSystem } from './system';
import { dataMissing } from '../diplomacy/dip.test-util';

describe.skipIf(dataMissing.length > 0)('tactical system: player side end to end', () => {
  it('ready -> combat -> attack orders -> ended and result applied to the strategic battle', async () => {
    const world = await loadWorldStatic(nodeFetchJson());
    const g = createGame(world, { systems: [researchSystem, economySystem, diplomacySystem, militarySystem, tacticalSystem], playerCountryId: 'POL', difficulty: 'sandbox', paused: false });
    expect(g.dispatch({ type: 'dip.declareWar', country: 'POL', target: 'BLR', force: true }).ok).toBe(true);
    const m = g.ctx.api.military;
    const targets = m.formations({ country: 'BLR', domain: 'land' });
    const mine = m.formations({ country: 'POL', domain: 'land' });
    targets.forEach((t, i) => g.dispatch(milCmd.move('POL', [mine[i % mine.length].id], t.pos, true)));
    let bid = '';
    for (let d = 0; d < 80 && !bid; d++) { g.advanceHours(24); bid = m.battles()[0]?.id ?? ''; }
    expect(bid).not.toBe('');
    const tac = g.ctx.api.tactical;
    expect(tac.start(bid).ok).toBe(true);
    const b = tac.battle()!;
    expect(b.player).not.toBeNull();
    const me = b.player!;
    expect(b.phase).toBe('deploy');
    tac.advance(1);
    expect(b.phase).toBe('deploy'); // player side not ready yet
    expect(g.dispatch({ type: 'tac.ready', country: 'POL' }).ok).toBe(true);
    tac.advance(0.2);
    expect(b.phase).toBe('combat');
    const mySquads = b.squads.filter((s) => s.side === me).map((s) => s.id);
    for (let i = 0; i < 4000 && b.phase !== 'ended'; i++) {
      if (i % 40 === 0) {
        for (const s of b.squads.filter((q) => q.side === me)) {
          const foe = b.ents.find((e) => e.side !== me && e.alive && !e.gone);
          if (foe) g.dispatch({ type: 'tac.order', country: 'POL', squads: [s.id], order: { kind: 'attack', target: foe.id } } as never);
        }
      }
      tac.advance(0.5);
    }
    expect(mySquads.length).toBeGreaterThan(0);
    expect(b.phase).toBe('ended');
    expect(g.state.tactical.applied).toBe(true);
    expect(g.state.tactical.last?.strategicBattleId).toBe(bid);
  }, 240_000);
});
