import { describe, expect, it } from 'vitest';
import type { Game } from '../../core/game';
import { createGame, loadGame } from '../../core/game';
import { findJsonIssues } from '../../core/json';
import { loadWorldStatic } from '../../data/loadWorld';
import { nodeFetchJson } from '../../data/fetchNode';
import { SYSTEMS } from '../../app/systems';
import { dipCommands } from '../diplomacy';

/** Real war and real strategic battle; the tactical `buildingDestroyed` events go through the real bus. */
async function scenario() {
  const world = await loadWorldStatic(nodeFetchJson());
  const mk = (): Game => createGame(world, { systems: SYSTEMS, playerCountryId: 'BRA', seed: 7, difficulty: 'hard' });
  const g = mk();
  expect(g.dispatch(dipCommands.declareWar('BRA', 'ARG')).ok).toBe(true);
  const mil = (g.state as unknown as { military: { forms: Record<string, { c: string; d: string; cr?: unknown; p: [number, number]; rt: unknown; od: unknown }> } }).military;
  const forms = Object.values(mil.forms);
  const mine = forms.find((f) => f.c === 'BRA' && f.d === 'land' && !f.cr)!;
  const foe = forms.find((f) => f.c === 'ARG' && f.d === 'land' && !f.cr)!;
  foe.p = [mine.p[0] + 0.03, mine.p[1] + 0.02]; foe.rt = null; foe.od = { k: 'idle' };
  for (let i = 0; i < 24 * 10 && !g.ctx.api.military.battles().length; i++) g.advanceHours(1);
  const bv = g.ctx.api.military.battles()[0];
  expect(bv.province).not.toBeNull();
  return { g, bv, world };
}

type G = Game;
function destroy(g: G, battleId: string, kind: string, n: number, side: 0 | 1, prot: boolean, floors = 2): void {
  const weight = (1 + floors * 0.15) * (prot ? 6 : 1);
  for (let i = 0; i < n; i++) g.ctx.bus.emit({ type: 'tac.buildingDestroyed', battleId, id: i + 1, x: 0, y: 0, kind, floors, civil: true, prot, weight, by: 'shell', side });
}
const snap = (g: G, owner: string, att: string, prov: string) => ({
  treasury: g.state.economy.c[owner].treasury,
  sat: (() => { let s = 0, n = 0; for (const i of g.ctx.world.citiesByProvince.get(prov) ?? []) { s += g.state.economy.sat[i]; n++; } return n ? s / n : NaN; })(),
  rep: g.state.diplomacy.rep[att] ?? 0,
  ruins: g.state.economy.ruins?.length ?? 0,
});

async function run(prot: boolean, count = 30) {
  const { g, bv } = await scenario();
  const owner = g.ctx.api.worldDyn.controllerOf(bv.province!);
  const att = bv.attackerCountries[0];
  const before = snap(g, owner, att, bv.province!);
  destroy(g, bv.id, prot ? 'hospital' : 'house', count, 0, prot, prot ? 4 : 2);
  g.ctx.bus.emit({ type: 'tac.battleEnded', battleId: bv.id, result: null });
  return { g, bv, owner, att, before, after: snap(g, owner, att, bv.province!) };
}

describe('destruição tática → camada estratégica', () => {
  it('prédios destruídos: dinheiro e satisfação do dono caem, atacante perde opinião, notícia sai, recupera com o tempo', async () => {
    const r = await run(false, 40);
    const { g } = r;
    expect(r.after.treasury).toBeLessThan(r.before.treasury);
    expect(r.after.rep).toBeLessThan(r.before.rep);
    expect(r.after.ruins).toBe(1);
    expect(g.state.economy.tacAgg?.[r.bv.id]).toBeUndefined();
    expect(g.state.news.some((n) => n.textKey === 'eco.news.buildingsDestroyed')).toBe(true);
    const ruin = g.state.economy.ruins![0];
    const dmg0 = g.state.world.cityDamage[ruin.city] ?? 0;
    expect(ruin.city).toBeGreaterThanOrEqual(0);
    expect(dmg0).toBeGreaterThan(0);
    const ctl = await scenario();
    const ctlBase = ctl.g.state.world.cityDamage[ruin.city] ?? 0;
    for (let d = 0; d < ruin.days + 5; d++) { g.advanceHours(24); ctl.g.advanceHours(24); }
    const extraDmg = dmg0 - ctlBase;
    expect(g.state.economy.ruins?.length ?? 0).toBe(0);
    // same war without the destruction (control): what is left above the control is what recovered
    const dmg1 = g.state.world.cityDamage[ruin.city] ?? 0, ctlEnd = ctl.g.state.world.cityDamage[ruin.city] ?? 0;
    expect(dmg1 - ctlEnd).toBeLessThan(extraDmg * 0.15);
    expect(findJsonIssues(g.state)).toEqual([]);
    console.log(`casas x40: tesouro ${r.before.treasury.toFixed(0)} -> ${r.after.treasury.toFixed(0)}, sat ${r.before.sat.toFixed(1)} -> ${r.after.sat.toFixed(1)}, rep ${r.before.rep.toFixed(2)} -> ${r.after.rep.toFixed(2)}, dano cidade ${dmg0.toFixed(3)} -> ${dmg1.toFixed(3)}`);
  }, 180_000);

  it('protegido pesa mais (opinião, satisfação, notícia "Hospital destruído")', async () => {
    const a = await run(false, 4), b = await run(true, 4);
    expect(b.after.rep - b.before.rep).toBeLessThan(a.after.rep - a.before.rep);
    const ua = a.g.state.economy.unrest.reduce((s, u) => s + u.delta, 0), ub = b.g.state.economy.unrest.reduce((s, u) => s + u.delta, 0);
    expect(ub).toBeGreaterThan(ua);
    expect(b.g.state.news.some((n) => n.textKey === 'eco.news.protDestroyed.hospital')).toBe(true);
    console.log(`4 casas: rep ${(a.after.rep - a.before.rep).toFixed(2)} unrest ${ua.toFixed(2)} | 4 hospitais: rep ${(b.after.rep - b.before.rep).toFixed(2)} unrest ${ub.toFixed(2)}`);
  }, 180_000);

  it('determinístico e save/load idêntico', async () => {
    const a = await run(true, 10), b = await run(true, 10);
    expect(JSON.stringify(a.g.state.economy.ruins)).toBe(JSON.stringify(b.g.state.economy.ruins));
    expect(JSON.stringify(a.g.state.diplomacy.rep)).toBe(JSON.stringify(b.g.state.diplomacy.rep));
    const world = a.g.ctx.world;
    const l = loadGame(world, SYSTEMS, JSON.parse(JSON.stringify(a.g.serialize())));
    for (let i = 0; i < 40; i++) { a.g.advanceHours(24); l.advanceHours(24); }
    expect(JSON.stringify(l.state.economy)).toBe(JSON.stringify(a.g.state.economy));
  }, 240_000);

  it('agregado por batalha: mid-battle nada muda; dispara só no fim', async () => {
    const { g, bv } = await scenario();
    const t0 = g.state.economy.c[g.ctx.api.worldDyn.controllerOf(bv.province!)].treasury;
    destroy(g, bv.id, 'house', 20, 0, false);
    expect(g.state.economy.c[g.ctx.api.worldDyn.controllerOf(bv.province!)].treasury).toBe(t0);
    expect(g.state.economy.tacAgg![bv.id].n).toBe(20);
  }, 180_000);
});
