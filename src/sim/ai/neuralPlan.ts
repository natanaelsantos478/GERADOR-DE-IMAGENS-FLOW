/**
 * Neural strategic layer. Rules keep the legal option sets and the traps; the net outputs a residual "plan" on top of the
 * rule priors (so zero output == the rule AI): production mix logits, production intensity, defence/research/security
 * spending targets, peace eagerness and diplomatic outreach propensity.
 */
import type { CountryId, Ctx } from '../../core/contracts';
import { dipCommands } from '../diplomacy/index';
import { setSpend } from '../economy/index';
import { chooseIndex } from '../neural/mlp';
import { netOf } from '../neural/pack';
import { temperatureOf } from '../neural/engine';
import { extOf, viewsOf } from './util';

export const MIX_UNITS = ['infantry', 'mech_infantry', 'armor', 'artillery', 'air_defense', 'mlrs', 'fighter', 'bomber', 'attack_heli', 'drone', 'logistics'] as const;
export const STRAT_CORE = 20;
export const STRAT_EXT = 4;
export const STRAT_IN = STRAT_CORE + STRAT_EXT;
export const STRAT_OUT = MIX_UNITS.length + 6;

export interface Plan {
  /** Additive logits over MIX_UNITS (added to log of the rule mix). */
  mixLogit: Float64Array;
  intensity: number;
  defense: number; research: number; security: number;
  peaceShift: number;
  outreach: number;
}

const X = new Float64Array(STRAT_IN);
const sig = (v: number) => 1 / (1 + Math.exp(-v));
const lg = (v: number) => Math.log10(Math.max(1e-3, v));
const cl = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/** Tap for behaviour/diagnostics: (features) => void. */
export const stratTap: { rec: ((x: Float64Array) => void) | null } = { rec: null };

export function planFor(ctx: Ctx, c: CountryId, atWar: boolean, enemies: CountryId[]): Plan | null {
  const net = netOf('strat', STRAT_IN);
  if (!net) return null;
  const e = ctx.state.economy.c[c];
  if (!e) return null;
  const sm = { gdp: e.gdp, gdpGrowth: e.growth, treasury: e.treasury, debt: e.debt, approval: e.approval, stability: e.stability, energy: e.energy, manpower: e.manpower, inflation: e.inflation, balance: e.balance, warWeariness: e.warWeary };
  const d = ctx.api.diplomacy, mil = ctx.api.military;
  const own = mil.power(c);
  let threat = 0, hostile = 0, nb = 0;
  for (const n of ctx.world.countryById.get(c)!.neighbors) {
    if (!ctx.api.worldDyn.isAlive(n)) continue;
    nb++;
    const rel = d.relation(c, n);
    if (!d.allied(c, n) && (rel < -10 || d.atWar(c, n))) { threat += mil.power(n); if (rel < -40) hostile++; }
  }
  let ws = 0, days = 0;
  const now = ctx.state.time.hours;
  for (const w of d.wars()) {
    const side = w.attackers.includes(c) ? 'attackers' : w.defenders.includes(c) ? 'defenders' : null;
    if (!side) continue;
    const s = d.warScore(w.id, side);
    if (Math.abs(s) >= Math.abs(ws)) { ws = s; days = (now - w.startedHours) / 24; }
  }
  const fs = viewsOf(ctx, c);
  let st = 0, fat = 0, cmd = 0, wear = 0, wxs = 0;
  for (const f of fs) { const e = extOf(f); st += f.strength; cmd += e[0]; fat += e[1]; wxs += e[2]; wear += e[3]; }
  const nf = Math.max(1, fs.length);
  const dif = ctx.state.meta.difficulty;
  let i = 0;
  X[i++] = lg(sm.gdp) / 6; X[i++] = sm.gdpGrowth / 5; X[i++] = cl(sm.treasury / Math.max(1, sm.gdp), -1, 2);
  X[i++] = cl(sm.debt / Math.max(1, sm.gdp), 0, 3); X[i++] = sm.approval / 100; X[i++] = sm.stability / 100;
  X[i++] = cl(sm.energy.ratio, 0, 2); X[i++] = lg(sm.manpower) / 7; X[i++] = lg(own); X[i++] = cl(lg(threat) - lg(own), -3, 3);
  X[i++] = hostile / Math.max(1, nb); X[i++] = enemies.length; X[i++] = ws / 100; X[i++] = cl(days / 200, 0, 3);
  X[i++] = atWar ? 1 : 0; X[i++] = cl(sm.inflation * 5, 0, 2); X[i++] = cl(sm.balance / Math.max(1, sm.gdp) * 100, -2, 2);
  X[i++] = cl(sm.warWeariness / 60, 0, 2); X[i++] = st / nf; X[i++] = dif === 'hard' ? 1 : dif === 'sandbox' ? -1 : 0;
  X[i++] = cl(cmd / nf, 0, 2); X[i++] = cl(fat / nf, 0, 1); X[i++] = cl(wxs / nf, 0, 1); X[i++] = cl(wear / nf, 0, 1);
  stratTap.rec?.(X);
  const o = net.forward(X);
  const mix = new Float64Array(MIX_UNITS.length);
  for (let k = 0; k < mix.length; k++) mix[k] = cl(o[k], -3, 3);
  const m = MIX_UNITS.length;
  return {
    mixLogit: mix, intensity: 1 + 0.6 * Math.tanh(o[m]),
    defense: 1 + 0.35 * Math.tanh(o[m + 1]), research: 1.05 + 0.4 * Math.tanh(o[m + 2]), security: 1 + 0.25 * Math.tanh(o[m + 3]),
    peaceShift: 25 * Math.tanh(o[m + 4]), outreach: 0.5 * sig(o[m + 5]),
  };
}

/** Spending targets, moved gently and never against the traps (no military build-up while approval/finances are weak). */
export function applySpending(ctx: Ctx, c: CountryId, plan: Plan, atWar: boolean): void {
  const sm = ctx.state.economy.c[c];
  if (!sm) return;
  const weak = sm.approval < 45 || sm.treasury < 0 || sm.stability < 35;
  const move = (pillar: 'defense' | 'research' | 'security', target: number, lo: number, hi: number) => {
    let t = cl(target, lo, hi);
    const cur = sm.spend[pillar];
    if (weak && t > cur) t = cur;
    if (pillar === 'defense' && atWar) t = Math.max(t, 1);
    const next = cur + cl(t - cur, -0.04, 0.04);
    if (Math.abs(next - cur) > 1e-3) ctx.dispatch(setSpend(c, pillar, next));
  };
  move('defense', plan.defense, 0.7, 1.4);
  move('research', plan.research, 0.75, 1.5);
  move('security', plan.security, 0.8, 1.3);
}

/** Friendly diplomacy initiative towards a neighbour (never a war declaration: those stay with the diplomacy director's rules). */
export function outreach(ctx: Ctx, c: CountryId, plan: Plan): void {
  if (ctx.rng.next() >= plan.outreach) return;
  const d = ctx.api.diplomacy;
  const ns = ctx.world.countryById.get(c)!.neighbors.filter((n) => ctx.api.worldDyn.isAlive(n) && !d.atWar(c, n));
  if (!ns.length) return;
  const n = ctx.rng.pick(ns);
  const rel = d.relation(c, n);
  if (rel > 30) ctx.dispatch(dipCommands.proposeNap(c, n));
  else if (rel > 10) ctx.dispatch(dipCommands.proposeTrade(c, n));
  else if (rel > -25) ctx.dispatch(dipCommands.improveRelations(c, n));
}

export { chooseIndex, temperatureOf };
