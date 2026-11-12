import { existsSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { createGame, type Game } from '../../core/game';
import { DATA_FILES, loadWorldStatic } from '../../data/loadWorld';
import { DEFAULT_DATA_DIR, nodeFetchJson } from '../../data/fetchNode';
import type { WorldStatic } from '../../core/world-types';
import { researchSystem } from '../research/system';
import { economySystem } from '../economy/system';
import { diplomacySystem } from '../diplomacy/system';
import { militarySystem } from './system';
import { spawnRebels } from './logistics';
import { milCmd } from './index';

const missing = DATA_FILES.filter((f) => !existsSync(path.join(DEFAULT_DATA_DIR, f)));

describe.skipIf(missing.length > 0)('military (dados reais + sistemas reais)', () => {
  let world: WorldStatic;
  let game: Game;
  beforeAll(async () => {
    world = await loadWorldStatic(nodeFetchJson());
    game = createGame(world, { systems: [researchSystem, economySystem, diplomacySystem, militarySystem], playerCountryId: 'BRA', paused: false });
  }, 120_000);

  it('cria forças iniciais compactas e JSON puro', () => {
    const st = game.state.military;
    const n = Object.keys(st.forms).length;
    const kb = JSON.stringify(st).length / 1024;
    console.log(`formações=${n} estado=${Math.round(kb)} KB`);
    expect(n).toBeGreaterThan(300);
    expect(n).toBeLessThan(2600);
    expect(JSON.parse(JSON.stringify(st))).toEqual(st);
    expect(game.ctx.api.military.formations({ country: 'BRA', domain: 'land' }).length).toBeGreaterThan(5);
  });

  it('São Paulo -> Brasília por estrada em tempo plausível', () => {
    const m = game.ctx.api.military;
    const id = m.spawn('BRA', 'mech_infantry', { lon: -46.63, lat: -23.55 })!;
    const p = m.pathPreview(id, [-47.88, -15.79])!;
    expect(p).not.toBeNull();
    expect(p.mode).toBe('road');
    expect(p.km).toBeGreaterThan(850);
    expect(p.km).toBeLessThan(1500);
    expect(p.etaHours).toBeGreaterThan(15);
    expect(p.etaHours).toBeLessThan(120);
  });

  it('Lisboa -> Nova York: impossível por terra, possível por mar', () => {
    const m = game.ctx.api.military;
    const land = m.spawn('PRT', 'armor', { lon: -9.14, lat: 38.72 })!;
    expect(m.pathPreview(land, [-74, 40.7])).toBeNull();
    let best = -1, bd = 1e9;
    world.ports.forEach((p) => { const d = Math.hypot(p.lon + 9.14, p.lat - 38.72); if (d < bd) (bd = d), (best = p.index); });
    const ship = m.spawn('PRT', 'destroyer', { kind: 'port', index: best })!;
    const p = m.pathPreview(ship, [-74.0, 40.5])!;
    expect(p.mode).toBe('sea');
    expect(p.km).toBeGreaterThan(5000);
    expect(p.km).toBeLessThan(8500);
  });

  it('rebeldes contra tropas do governo geram batalha, baixas e fim', () => {
    const g = createGame(world, { systems: [researchSystem, economySystem, diplomacySystem, militarySystem], playerCountryId: 'BRA' });
    const m = g.ctx.api.military;
    const gov = g.ctx.world.cities[g.ctx.world.capitalCityOf('BRA')!];
    const id = m.spawn('BRA', 'infantry', { lon: gov.lon, lat: gov.lat })!;
    const events: string[] = [];
    g.bus.onPrefix('mil', (e) => events.push(e.type));
    spawnRebels(g.ctx, 'BRA', gov.provinceId!, gov.lon + 0.02, gov.lat, 0.3);
    g.advanceHours(24 * 8);
    expect(events).toContain('mil.battleStarted');
    expect(events).toContain('mil.battleEnded');
    void id;
  });

  it('comandos: mover formação, fila de produção e resultado tático', () => {
    const m = game.ctx.api.military;
    const id = m.spawn('BRA', 'infantry', { lon: -46.63, lat: -23.55 })!;
    expect(game.dispatch(milCmd.move('BRA', [id], [-46.3, -23.4]))).toMatchObject({ ok: true });
    game.advanceHours(48);
    expect(m.formation(id)!.pos[0]).toBeGreaterThan(-46.5);
    expect(game.dispatch(milCmd.produce('BRA', 'infantry', 2)).ok).toBe(true);
    expect(game.dispatch(milCmd.applyTacticalResult('BRA', { battle: 'nope', winner: 'draw', squads: [] })).ok).toBe(false);
  });

  it('guerra POL x BLR: batalhas, ocupação e interface tática', () => {
    const g = createGame(world, { systems: [researchSystem, economySystem, diplomacySystem, militarySystem], playerCountryId: 'POL', difficulty: 'sandbox' });
    expect(g.dispatch({ type: 'dip.declareWar', country: 'POL', target: 'BLR', force: true }).ok).toBe(true);
    const m = g.ctx.api.military;
    const ev: string[] = [];
    g.bus.onPrefix('mil', (e) => ev.push(e.type));
    const targets = m.formations({ country: 'BLR', domain: 'land' });
    const mine = m.formations({ country: 'POL', domain: 'land' });
    targets.forEach((t, i) => g.dispatch(milCmd.move('POL', [mine[i % mine.length].id], t.pos, true)));
    let tacChecked = false;
    for (let d = 0; d < 60; d++) {
      g.advanceHours(24);
      const b = m.battles()[0];
      if (b && !tacChecked) {
        const bf = m.battleForces(b.id)!;
        expect(bf.attackers.units.length + bf.defenders.units.length).toBeGreaterThan(0);
        expect(g.dispatch(milCmd.setTactical('POL', b.id, true)).ok).toBe(true);
        expect(m.battle(b.id)!.tactical).toBe(true);
        expect(g.dispatch(milCmd.setTactical('POL', b.id, false)).ok).toBe(true);
        tacChecked = true;
      }
    }
    expect(ev).toContain('mil.battleStarted');
    expect(ev).toContain('mil.battleEnded');
    expect(ev).toContain('mil.provinceOccupied');
    expect(tacChecked).toBe(true);
  }, 120_000);

  it('soak: 60 dias do mundo com sistemas reais, tempo por dia e estado', () => {
    const g = createGame(world, { systems: [researchSystem, economySystem, diplomacySystem, militarySystem], playerCountryId: 'BRA' });
    const t0 = performance.now();
    g.advanceHours(24 * 60);
    const mil = g.state.military;
    // Tempo isolado do militar.
    const per = (performance.now() - t0) / 60;
    const kb = JSON.stringify(mil).length / 1024;
    console.log(`mundo completo ${per.toFixed(1)} ms/dia; militar: batalhas=${Object.keys(mil.battles).length} estado=${Math.round(kb)} KB`);
    expect(JSON.stringify(g.state)).not.toMatch(/NaN|Infinity/);
  }, 240_000);
});
