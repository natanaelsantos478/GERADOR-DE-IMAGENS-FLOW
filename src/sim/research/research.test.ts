import { describe, expect, it } from 'vitest';
import { findJsonIssues } from '../../core/json';
import { dataMissing, makeGame } from '../diplomacy/dip.test-util';
import { BASELINE_UNLOCKS, FUEL_IDS, MODIFIER_KEYS, STRUCTURE_IDS, UNIT_IDS } from './catalog';
import { TECHS, TECH_BY_ID } from './techs';
import { researchPt } from './i18n.pt';
import { queueTech, selectTechTree, startTech } from './index';

describe('árvore tecnológica (dados)', () => {
  it('≥ 60 techs em 6 ramos, ids/pré-requisitos/desbloqueios/modificadores coerentes e sem ciclos', () => {
    expect(TECHS.length).toBeGreaterThanOrEqual(60);
    expect(new Set(TECHS.map((t) => t.branch)).size).toBe(6);
    const unlockOk = new Set<string>([...UNIT_IDS.map((u) => `unit.${u}`), ...STRUCTURE_IDS.map((s) => `build.${s}`), ...FUEL_IDS.map((f) => `fuel.${f}`)]);
    const keys = new Set<string>(MODIFIER_KEYS);
    for (const t of TECHS) {
      expect(researchPt[`tech.${t.id}`], t.id).toBeTruthy();
      for (const q of t.requires) expect(TECH_BY_ID.has(q), `${t.id} requer ${q}`).toBe(true);
      for (const u of t.unlocks) expect(unlockOk.has(u), u).toBe(true);
      for (const k of Object.keys(t.mods)) expect(keys.has(k), k).toBe(true);
    }
    // acíclico: resolução topológica completa
    const done = new Set<string>();
    for (let n = 0; n < TECHS.length; n++) for (const t of TECHS) if (t.requires.every((q) => done.has(q))) done.add(t.id);
    expect(done.size).toBe(TECHS.length);
    // toda unidade (exceto infantaria) e construção não-baseline tem uma tech que a libera
    const all = new Set(TECHS.flatMap((t) => t.unlocks));
    for (const u of UNIT_IDS) if (u !== 'infantry') expect(all.has(`unit.${u}`), u).toBe(true);
    for (const s of STRUCTURE_IDS) if (!BASELINE_UNLOCKS.includes(`build.${s}`)) expect(all.has(`build.${s}`), s).toBe(true);
  });
});

describe.skipIf(dataMissing.length > 0)('pesquisa (dados reais)', () => {
  it('tecnologias iniciais seguem o nível real; só os países nucleares têm ogivas', async () => {
    const g = await makeGame();
    const r = g.ctx.api.research;
    const nuclear = g.ctx.world.countries.filter((c) => r.unlocked(c.id, 'unit.nuke')).map((c) => c.id);
    const real = g.ctx.world.countries.filter((c) => (g.ctx.world.military[c.id]?.nukes ?? 0) > 0).map((c) => c.id);
    expect(real.length).toBe(9);
    expect(nuclear.sort()).toEqual(real.sort());
    expect(r.researched('USA').length).toBeGreaterThan(r.researched('BRA').length);
    expect(r.researched('BRA').length).toBeGreaterThan(r.researched('HTI').length);
    expect(r.unlocked('BRA', 'unit.armor')).toBe(true);
    expect(r.unlocked('BRA', 'unit.nuke')).toBe(false);
    expect(r.unlocked('HTI', 'unit.infantry')).toBe(true);
    // inventário real implica desbloqueio: quem tem porta-aviões pode construir
    for (const c of g.ctx.world.countries) if ((g.ctx.world.military[c.id]?.carriers ?? 0) > 0) expect(r.unlocked(c.id, 'unit.carrier'), c.id).toBe(true);
  });

  it('modificadores: padrão 1, temporário expira, tech aplica, fila e comandos funcionam', async () => {
    const g = await makeGame();
    const r = g.ctx.api.research;
    expect(r.mod('BRA', 'mil.nonexistent')).toBe(1);
    r.addModifier('BRA', 'eco.industry', 1.5, 48, 'teste');
    const base = r.mod('BRA', 'eco.industry');
    expect(base).toBeGreaterThan(1.4);
    g.advanceHours(24 * 3);
    expect(r.mod('BRA', 'eco.industry')).toBeLessThan(base / 1.4);
    expect(g.dispatch(queueTech('BRA', 'm_warhead')).ok).toBe(false);
    const avail = r.available('BRA');
    expect(avail.length).toBeGreaterThan(0);
    expect(g.dispatch(startTech('BRA', avail[0])).ok).toBe(true);
    expect(r.progress('BRA').current).toBe(avail[0]);
    expect(g.dispatch(queueTech('BRA', avail[1] ?? avail[0])).ok).toBe(avail.length > 1);
    const n0 = r.researched('BRA').length;
    g.advanceHours(24 * 400);
    expect(r.researched('BRA').length).toBeGreaterThan(n0);
    expect(Number.isFinite(r.progress('BRA').pointsPerDay)).toBe(true);
    const tree = selectTechTree(g.ctx, 'BRA');
    expect(tree.length).toBe(6);
    expect(findJsonIssues(g.state.research)).toEqual([]);
  }, 120_000);
});
