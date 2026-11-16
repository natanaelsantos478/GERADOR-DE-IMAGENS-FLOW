/** Forced regional war scenarios on the real world: one side neural, the other rule-based, everyone else rule-based. */
import type { Game } from '../../src/core/game';
import { createGame } from '../../src/core/game';
import type { WorldStatic } from '../../src/core/contracts';
import { SYSTEMS } from '../../src/app/systems';
import { dipCommands } from '../../src/sim/diplomacy';
import { setPolicyPack, type PolicyPack } from '../../src/sim/neural/pack';

export interface Pair { a: string; b: string }
export interface WarScenario extends Pair { seed: number; neuralIs: 'a' | 'b' }
export interface WarTask { kind: 'war'; pack: PolicyPack; scenarios: WarScenario[]; days: number; /** engine of the "neural" side: 'rules' makes a pure-rules control run */ engine?: 'neural' | 'rules' }
export interface WarOutcome { fit: number; ws: number; dProv: number; dForce: number; eco: number; ended: boolean }

const forceOf = (g: Game, c: string) => g.ctx.api.military.formations({ country: c }).reduce((a, f) => a + f.strength * f.units.length, 0);
const gdpOf = (g: Game, c: string) => g.ctx.api.economy.gdp(c);
const provsOf = (g: Game, c: string) => g.ctx.api.worldDyn.provincesControlledBy(c).length;

export function newGame(world: WorldStatic, seed: number, rulesFor: string[], neural: string[]): Game {
  const automation: Record<string, boolean> = { 'ai.controlsPlayer': true, 'ai.engine.neural': false };
  for (const c of neural) automation[`ai.engine.neural.${c}`] = true;
  for (const c of rulesFor) automation[`ai.engine.neural.${c}`] = false;
  return createGame(world, { systems: SYSTEMS, playerCountryId: neural[0] ?? rulesFor[0], seed, difficulty: 'hard', automation });
}

/** Neighbour pairs with comparable strength and enough land forces, deterministic order. */
export function listPairs(world: WorldStatic): Pair[] {
  const g = newGame(world, 1, ['BRA'], []);
  const out: Pair[] = [];
  for (const c of world.countries) {
    if (!c.sovereign) continue;
    for (const n of c.neighbors) {
      if (n <= c.id || !world.countryById.get(n)?.sovereign) continue;
      const pa = g.ctx.api.military.power(c.id), pb = g.ctx.api.military.power(n);
      const fa = g.ctx.api.military.formations({ country: c.id, domain: 'land' }).length, fb = g.ctx.api.military.formations({ country: n, domain: 'land' }).length;
      if (fa >= 6 && fb >= 6 && pa / pb > 0.4 && pa / pb < 2.5 && !g.ctx.api.diplomacy.atWar(c.id, n) && g.ctx.api.military.strikeCapability(c.id).nukes === 0 && g.ctx.api.military.strikeCapability(n).nukes === 0) out.push({ a: c.id, b: n });
    }
  }
  return out;
}

export function playWar(world: WorldStatic, sc: WarScenario, days: number, neuralEngine = true): WarOutcome {
  const me = sc.neuralIs === 'a' ? sc.a : sc.b, foe = sc.neuralIs === 'a' ? sc.b : sc.a;
  const g = newGame(world, sc.seed, neuralEngine ? [foe] : [me, foe], neuralEngine ? [me] : []);
  const s0 = { me: { f: forceOf(g, me), p: provsOf(g, me), g: gdpOf(g, me) }, foe: { f: forceOf(g, foe), p: provsOf(g, foe), g: gdpOf(g, foe) } };
  const r = g.dispatch(dipCommands.declareWar(sc.a, sc.b, undefined, true));
  if (!r.ok) return { fit: 0, ws: 0, dProv: 0, dForce: 0, eco: 0, ended: true };
  let ws = 0, ended = false;
  for (let d = 0; d < days; d++) {
    g.advanceHours(24);
    if (d % 5 === 0 || d === days - 1) {
      const w = g.ctx.api.diplomacy.wars().find((x) => (x.attackers.includes(me) && x.defenders.includes(foe)) || (x.attackers.includes(foe) && x.defenders.includes(me)));
      if (w) ws = g.ctx.api.diplomacy.warScore(w.id, w.attackers.includes(me) ? 'attackers' : 'defenders'); else ended = true;
    }
  }
  const cl = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
  const dProv = cl((provsOf(g, me) - s0.me.p) / Math.max(1, s0.me.p) - (provsOf(g, foe) - s0.foe.p) / Math.max(1, s0.foe.p), -1, 1);
  const dForce = cl(forceOf(g, me) / Math.max(1e-6, s0.me.f) - forceOf(g, foe) / Math.max(1e-6, s0.foe.f), -1, 1);
  const eco = cl(5 * (gdpOf(g, me) / s0.me.g - gdpOf(g, foe) / s0.foe.g), -1, 1);
  const app = cl(((g.ctx.state.economy.c[me]?.approval ?? 50) - 50) / 50, -1, 1);
  return { fit: 0.4 * (ws / 100) + 0.25 * dProv + 0.2 * dForce + 0.1 * eco + 0.05 * app, ws, dProv, dForce, eco, ended };
}

export async function handleWar(w: WorldStatic, m: WarTask): Promise<WarOutcome[]> {
  setPolicyPack(m.pack);
  return m.scenarios.map((s) => playWar(w, s, m.days, (m.engine ?? 'neural') === 'neural'));
}
