import { existsSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Game } from '../../core/game';
import { createGame, loadGame } from '../../core/game';
import { findJsonIssues, findNonFinite } from '../../core/json';
import { DATA_FILES, loadWorldStatic } from '../../data/loadWorld';
import { DEFAULT_DATA_DIR, nodeFetchJson } from '../../data/fetchNode';
import type { WorldStatic } from '../../core/contracts';
import { researchSystem } from '../research/system';
import { economySystem } from './system';
import { build, countrySummary, energyByFuel, setTax, constructionOptions, trade, cityCauses } from './index';
import { economyPt } from './i18n.pt';
import { taxIndex } from './budget';

const missing = DATA_FILES.filter((f) => !existsSync(path.join(DEFAULT_DATA_DIR, f)));
const HERE = path.dirname(new URL(import.meta.url).pathname);
const withResearch = existsSync(path.join(HERE, '../research/system.ts'));

describe.skipIf(missing.length > 0)('economy (dados reais)', () => {
  let world: WorldStatic;
  const mk = (extra = {}): Game =>
    createGame(world, { systems: withResearch ? [researchSystem, economySystem] : [economySystem], playerCountryId: 'BRA', automation: { 'ai.controlsPlayer': true }, ...extra });
  beforeAll(async () => {
    world = await loadWorldStatic(nodeFetchJson());
  }, 120_000);

  it('slice inicial é JSON puro e parte de dados reais', () => {
    const g = mk();
    expect(findJsonIssues(g.state)).toEqual([]);
    const s = countrySummary(g.ctx, 'BRA')!;
    expect(s.gdp).toBeCloseTo(world.stats.BRA.gdpUsd / 1e6, 0);
    expect(s.energy.ratio).toBeGreaterThan(1);
    expect(energyByFuel(g.ctx, 'BRA').find((x) => x.fuel === 'hydro')!.mw).toBeGreaterThan(10000);
    expect(taxIndex(g.state.economy.c.BRA)).toBeCloseTo(1, 5);
  });

  it('comandos: imposto, construção, comércio, erros', () => {
    const g = mk({ automation: {} });
    expect(g.dispatch(setTax('BRA', 'income', 0.3)).ok).toBe(true);
    expect(g.state.economy.c.BRA.tax.income).toBe(0.3);
    const prov = world.provincesByCountry.get('BRA')![0];
    const opts = constructionOptions(g.ctx, 'BRA', prov);
    expect(opts.find((o) => o.id === 'powerPlant:gas:500')!.cost.money).toBeGreaterThan(100);
    const before = g.ctx.api.economy.treasury('BRA');
    const r = g.dispatch(build('BRA', 'powerPlant', prov, { variant: 'solar', mw: 200 }));
    expect(r.ok).toBe(true);
    expect(g.ctx.api.economy.treasury('BRA')).toBeLessThan(before);
    expect(g.ctx.api.economy.structures({ country: 'BRA' })).toHaveLength(1);
    const bad = g.dispatch(build('BRA', 'port', world.provincesByCountry.get('BRA')!.find((p) => !world.provinceById.get(p)!.coastal) ?? prov));
    if (!bad.ok) expect(economyPt[bad.reason]).toBeTruthy();
    expect(g.dispatch(trade('BRA', 'steel', 5)).ok).toBe(true);
    expect(g.dispatch({ type: 'eco.setTax', country: 'BRA', tax: 'x', value: 1 }).ok).toBe(false);
  });

  it('dano a usina reduz energia; causas de cidade aparecem', () => {
    const g = mk();
    g.advanceHours(24 * 3);
    const e0 = g.ctx.api.economy.energy('BRA').supplyMw;
    for (const pi of world.plantsByCountry.get('BRA')!) if (world.plants[pi].fuel === 'hydro') g.ctx.api.worldDyn.damage('plant', pi, 0.8, 'test');
    g.advanceHours(24);
    expect(g.ctx.api.economy.energy('BRA').supplyMw).toBeLessThan(e0 * 0.8);
    const city = world.citiesByCountry.get('BRA')![0];
    expect(cityCauses(g.ctx, city).length).toBeGreaterThan(5);
  });

  it('10 anos no automático: sem NaN, país estável, save/load determinístico', () => {
    const g = mk();
    g.advanceHours(24 * 365 * 10);
    expect(findNonFinite(g.state)).toEqual([]);
    expect(findJsonIssues(g.state)).toEqual([]);
    for (const c of ['BRA', 'USA', 'CHN', 'NGA']) {
      const e = g.state.economy.c[c];
      console.log(c, 'PIB', (e.gdp / 1e6).toFixed(2), 'T saldo', e.balance.toFixed(0), 'energia', e.energy.ratio.toFixed(2), 'aprovação', e.approval.toFixed(0));
      expect(e.approval).toBeGreaterThan(35);
      expect(e.energy.ratio).toBeGreaterThan(0.9);
      expect(e.treasury).toBeGreaterThan(0);
    }
    const reloaded = loadGame(world, g.registry.systems, JSON.parse(JSON.stringify(g.serialize())));
    g.advanceHours(48);
    reloaded.advanceHours(48);
    expect(JSON.stringify(reloaded.state.economy)).toBe(JSON.stringify(g.state.economy));
  }, 240_000);
});
